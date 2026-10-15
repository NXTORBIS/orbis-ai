/**
 * Portfolio loss aggregation: combining marginal exposures into the
 * distribution of their sum, under an **explicitly named** dependence
 * assumption.
 *
 * Risks do not add. The aggregate risk of several exposures depends on their
 * joint distribution, and the marginals alone do not determine it. Every result
 * here therefore states which dependence assumption produced it, and when
 * dependence is unknown the result is a pair of **bounds**, never a point
 * figure.
 *
 * The assumptions supported, and what each is for:
 *
 *   independence       exact convolution (direct or FFT on a lattice). An
 *                      assumption, never a default.
 *   comonotonic        perfect positive dependence. Quantiles add, so
 *                      VaR and ES of the sum are the sums of the marginal
 *                      figures — exactly. This is the worst case for every
 *                      comonotone-additive coherent measure, so it is both a
 *                      useful bound and a decisive test of the code.
 *   countermonotonic   perfect negative dependence; defined for two exposures
 *                      only (no three variables can be mutually
 *                      countermonotonic), and refused for more.
 *   correlation        a Gaussian copula with a given correlation matrix,
 *                      evaluated by simulation.
 *   unknown            Fréchet–Hoeffding / standard bounds: the range the
 *                      aggregate risk can take over *all* joint distributions
 *                      with these marginals.
 */
import { EngineError, type Exactness } from '../core/result';
import { stableSum } from '../core/numeric';
import { Random, Xoshiro128 } from '../random/rng';
import { choleskyWithCheck, type Matrix } from '../stats/linalg';
import { sortedCopy } from '../stats/descriptive';
import { normalCdf } from '../special/gamma';
import { assertLevel, empiricalEs, empiricalVar, populationSd, sampleMean } from './empirical';
import {
  isIntegerLattice,
  marginalLattice,
  marginalQuantile,
  marginalRisk,
  marginalSd,
  type Marginal,
} from './marginal';
import { convolveLattice, latticeToLaw, lawEs, lawMean, lawVar, makeLaw, type DiscreteLaw } from './discrete';
import { checkCovariance } from './numerics';

export type DependenceAssumption =
  | { kind: 'independence' }
  | { kind: 'comonotonic' }
  | { kind: 'countermonotonic' }
  | { kind: 'correlation'; matrix: Matrix; copula: 'gaussian'; trials?: number; seed?: string }
  | { kind: 'unknown' };

export interface AggregateLevelRow {
  level: number;
  /** The aggregate figure, or null when dependence is unknown (then bounds are given). */
  valueAtRisk: number | null;
  expectedShortfall: number | null;
  /** Range over all joint distributions with these marginals (always reported). */
  varBounds: { lower: number; upper: number };
  esBounds: { lower: number; upper: number };
  /** Σ of the individual figures — what "adding risks up" would have given. */
  sumOfMarginalVar: number;
  sumOfMarginalEs: number;
  /** Σ of the parts minus the risk of the whole. Positive = diversification helped. */
  diversificationBenefitVar: number | null;
  diversificationBenefitEs: number | null;
  /** Sampling uncertainty of the ESTIMATE (simulation only) — not the risk measure itself. */
  estimation: {
    trials: number;
    varStandardError: number | null;
    esStandardError: number | null;
    varInterval95: { low: number; high: number } | null;
    esInterval95: { low: number; high: number } | null;
    tailScenarioCount: number;
  } | null;
  warnings: string[];
}

export interface AggregateRiskResult {
  dependenceKind: DependenceAssumption['kind'];
  dependenceAssumption: string;
  exactness: Exactness;
  method: string;
  labels: string[];
  mean: number;
  rows: AggregateLevelRow[];
  /** Present when the aggregate law was constructed explicitly. */
  aggregateSd: number | null;
  notes: string[];
  limitations: string[];
}

function marginalSummaries(marginals: Marginal[], level: number) {
  return marginals.map((m) => marginalRisk(m, level));
}

function assertMarginals(marginals: Marginal[]): void {
  if (marginals.length < 1) throw new EngineError('At least one exposure is required.', 'required');
  if (marginals.length > 64) throw new EngineError(`At most 64 exposures are supported; received ${marginals.length}.`, 'limit');
}

/* ------------------------------------------------------------------ *
 * Fréchet–Hoeffding / standard bounds                                 *
 * ------------------------------------------------------------------ */

export interface AggregateBounds {
  level: number;
  /** Σ LTVaR_α(Xᵢ) ≤ VaR_α(ΣXᵢ) ≤ Σ ES_α(Xᵢ) — holds for every joint distribution. */
  varLower: number;
  varUpper: number;
  /** E[ΣXᵢ] ≤ ES_α(ΣXᵢ) ≤ Σ ES_α(Xᵢ); the upper bound is attained by comonotonicity. */
  esLower: number;
  esUpper: number;
  exactness: Exactness;
  justification: string[];
}

/**
 * The standard (model-free) bounds on aggregate VaR and ES given only the
 * marginals. These are the honest answer when the dependence is unknown.
 *
 * Upper bound on VaR: ES is subadditive and dominates VaR, so
 * VaR_α(S) ≤ ES_α(S) ≤ Σ ES_α(Xᵢ). This is the "dual bound"; it is sharp as
 * the number of exposures grows.
 * Lower bound on VaR: left-tail VaR is *super*additive and is dominated by
 * VaR, so VaR_α(S) ≥ LTVaR_α(S) ≥ Σ LTVaR_α(Xᵢ).
 * ES bounds: the upper bound is attained exactly by comonotonic dependence
 * (Σ ES); the lower bound is the portfolio mean, attained when the tail parts
 * can be mixed to a constant (complete mixability).
 */
export function aggregateBounds(marginals: Marginal[], level: number): AggregateBounds {
  assertMarginals(marginals);
  assertLevel(level);
  const parts = marginalSummaries(marginals, level);
  const exact = parts.every((p) => p.exactness === 'exact');
  return {
    level,
    varLower: stableSum(parts.map((p) => p.leftTailVar)),
    varUpper: stableSum(parts.map((p) => p.expectedShortfall)),
    esLower: stableSum(parts.map((p) => p.mean)),
    esUpper: stableSum(parts.map((p) => p.expectedShortfall)),
    exactness: exact ? 'exact' : 'numerical',
    justification: [
      'VaR upper bound: VaR_α(S) ≤ ES_α(S) ≤ Σ ES_α(Xᵢ), because ES dominates VaR at the same level and ES is subadditive. The bound is attained in the limit of many exposures and is the standard worst-case VaR bound.',
      'VaR lower bound: VaR_α(S) ≥ LTVaR_α(S) ≥ Σ LTVaR_α(Xᵢ), because left-tail VaR is superadditive and is dominated by VaR.',
      'ES upper bound: Σ ES_α(Xᵢ), attained exactly under comonotonic dependence, since ES is comonotone additive.',
      'ES lower bound: the portfolio mean E[S], which every ES dominates; it is attained when the tail parts are completely mixable, i.e. the sum can be made constant on the tail.',
      'These bounds hold for EVERY joint distribution with the given marginals. The width of the interval is the price of not knowing the dependence — it is not a defect of the calculation.',
    ],
  };
}

/* ------------------------------------------------------------------ *
 * Aggregation under each assumption                                   *
 * ------------------------------------------------------------------ */

function rowFromLaw(
  law: DiscreteLaw,
  level: number,
  parts: { valueAtRisk: number; expectedShortfall: number }[],
  bounds: AggregateBounds,
  warnings: string[],
): AggregateLevelRow {
  const v = lawVar(law, level);
  const es = lawEs(law, level);
  const sumVar = stableSum(parts.map((p) => p.valueAtRisk));
  const sumEs = stableSum(parts.map((p) => p.expectedShortfall));
  return {
    level,
    valueAtRisk: v,
    expectedShortfall: es,
    varBounds: { lower: bounds.varLower, upper: bounds.varUpper },
    esBounds: { lower: bounds.esLower, upper: bounds.esUpper },
    sumOfMarginalVar: sumVar,
    sumOfMarginalEs: sumEs,
    diversificationBenefitVar: sumVar - v,
    diversificationBenefitEs: sumEs - es,
    estimation: null,
    warnings,
  };
}

export interface IndependenceOptions {
  /** Lattice cells per marginal standard deviation. Higher = finer and slower. */
  resolution?: number;
  tailProbability?: number;
}

/** Exact convolution of independent marginals. */
export function aggregateIndependent(marginals: Marginal[], levels: number[], opts: IndependenceOptions = {}): AggregateRiskResult {
  assertMarginals(marginals);
  for (const l of levels) assertLevel(l);
  const allInteger = marginals.every(isIntegerLattice);
  const warnings: string[] = [];
  let law: DiscreteLaw;
  let exactness: Exactness;
  let method: string;
  if (allInteger) {
    const lattices = marginals.map((m) => marginalLattice(m, 1));
    let acc = lattices[0];
    for (let i = 1; i < lattices.length; i++) acc = convolveLattice(acc, lattices[i]);
    law = latticeToLaw(acc);
    exactness = 'exact';
    method = 'Exact convolution of integer-valued marginals on the unit lattice (direct sums below 4·10⁶ products, FFT above).';
  } else {
    const resolution = opts.resolution ?? 200;
    if (!(resolution >= 10)) throw new EngineError(`The lattice resolution must be at least 10 cells per standard deviation; received ${resolution}.`, 'range');
    const sds = marginals.map(marginalSd);
    const step = Math.min(...sds) / resolution;
    if (!(step > 0)) throw new EngineError('At least one marginal has zero spread, so no lattice step can be derived from it.', 'range');
    const lattices = marginals.map((m) => marginalLattice(m, step, opts.tailProbability ?? 1e-12));
    const totalCells = lattices.reduce((a, l) => a + l.mass.length, 0);
    if (totalCells > 8_000_000) {
      throw new EngineError(`Convolving these marginals needs ${totalCells} lattice cells, above the limit of 8,000,000. Reduce the resolution.`, 'limit');
    }
    let acc = lattices[0];
    for (let i = 1; i < lattices.length; i++) acc = convolveLattice(acc, lattices[i]);
    law = latticeToLaw(acc);
    exactness = 'numerical';
    method = `Convolution on a common lattice of step ${step.toExponential(3)} (${resolution} cells per smallest marginal standard deviation); each lattice point carries the probability of the interval around it, so any reported quantile is accurate to within half a step per marginal.`;
    warnings.push(`Aggregate quantiles carry a discretisation error of at most ${(step / 2).toExponential(3)} from the lattice step.`);
  }
  const rows = levels.map((level) => {
    const parts = marginalSummaries(marginals, level);
    return rowFromLaw(law, level, parts, aggregateBounds(marginals, level), [...warnings]);
  });
  return {
    dependenceKind: 'independence',
    dependenceAssumption: 'INDEPENDENCE: the exposures are assumed to be statistically independent. This is an assumption you have chosen, not a property of the data.',
    exactness,
    method,
    labels: marginals.map((m) => m.label),
    mean: lawMean(law),
    rows,
    aggregateSd: Math.sqrt(law.values.reduce((a, v, i) => a + law.probs[i] * v * v, 0) - lawMean(law) ** 2),
    notes: [
      'Independence is the strongest diversification assumption available short of negative dependence. If the exposures share any common driver — one market, one supplier, one weather system — the real aggregate risk is larger than this.',
      'Compare this figure with the comonotonic one and with the unknown-dependence bounds to see how much of the answer rests on the assumption.',
    ],
    limitations: [
      'No test of the data can establish independence; it can only fail to reject it. Treat this figure as a conditional statement.',
    ],
  };
}

/** Comonotonic (perfect positive) dependence: quantiles add. */
export function aggregateComonotonic(marginals: Marginal[], levels: number[]): AggregateRiskResult {
  assertMarginals(marginals);
  for (const l of levels) assertLevel(l);
  let allExact = true;
  const rows = levels.map((level) => {
    const parts = marginalSummaries(marginals, level);
    if (!parts.every((p) => p.exactness === 'exact')) allExact = false;
    const bounds = aggregateBounds(marginals, level);
    const sumVar = stableSum(parts.map((p) => p.valueAtRisk));
    const sumEs = stableSum(parts.map((p) => p.expectedShortfall));
    return {
      level,
      valueAtRisk: sumVar,
      expectedShortfall: sumEs,
      varBounds: { lower: bounds.varLower, upper: bounds.varUpper },
      esBounds: { lower: bounds.esLower, upper: bounds.esUpper },
      sumOfMarginalVar: sumVar,
      sumOfMarginalEs: sumEs,
      diversificationBenefitVar: 0,
      diversificationBenefitEs: 0,
      estimation: null,
      warnings: [],
    } satisfies AggregateLevelRow;
  });
  return {
    dependenceKind: 'comonotonic',
    dependenceAssumption:
      'COMONOTONIC: the exposures are assumed perfectly positively dependent — all driven by the same underlying uniform, so they are all extreme together. There is no diversification at all.',
    exactness: allExact ? 'exact' : 'numerical',
    method:
      'Under comonotonicity the quantile function of the sum is the sum of the quantile functions, so VaR_α(S) = Σ VaR_α(Xᵢ) and, because ES is comonotone additive, ES_α(S) = Σ ES_α(Xᵢ). Both identities are exact, not approximations.',
    labels: marginals.map((m) => m.label),
    mean: stableSum(marginals.map((m) => marginalRisk(m, 0.5).mean)),
    rows,
    aggregateSd: null,
    notes: [
      'This is the worst case for Expected Shortfall and for every other comonotone-additive coherent measure: no joint distribution with these marginals has a larger ES.',
      'It is NOT the worst case for VaR. Because VaR is not subadditive, VaR of the sum can exceed the comonotonic value; the unknown-dependence upper bound covers that.',
      'Simply adding up individual VaRs or ESs — the most common way of aggregating risk — is exactly this assumption, usually made without knowing it.',
    ],
    limitations: ['Diversification benefit is zero by construction here; the figure is a bound, not a forecast.'],
  };
}

/** Countermonotonic (perfect negative) dependence — two exposures only. */
export function aggregateCountermonotonic(marginals: Marginal[], levels: number[], gridSize = 200_000): AggregateRiskResult {
  assertMarginals(marginals);
  if (marginals.length !== 2) {
    throw new EngineError(
      `Countermonotonicity is only defined for two exposures; ${marginals.length} were given. No three or more random variables can be mutually countermonotonic, so there is no such assumption to apply here. Use the unknown-dependence bounds instead.`,
      'unsupported',
    );
  }
  for (const l of levels) assertLevel(l);
  const [a, b] = marginals;
  let law: DiscreteLaw;
  let exactness: Exactness;
  let method: string;
  if (a.kind === 'sample' && b.kind === 'sample' && a.values.length === b.values.length) {
    const xa = sortedCopy(a.values);
    const xb = sortedCopy(b.values);
    const n = xa.length;
    const vals = new Array<number>(n);
    for (let i = 0; i < n; i++) vals[i] = xa[i] + xb[n - 1 - i];
    law = makeLaw(vals, new Array<number>(n).fill(1 / n));
    exactness = 'exact';
    method = 'The two samples are paired largest-with-smallest, which is the exact countermonotonic coupling of two equally sized empirical marginals.';
  } else {
    if (!(Number.isInteger(gridSize) && gridSize >= 1000)) throw new EngineError('The countermonotonic grid must have at least 1000 points.', 'range');
    const vals = new Array<number>(gridSize);
    for (let i = 0; i < gridSize; i++) {
      const u = (i + 0.5) / gridSize;
      vals[i] = marginalQuantile(a, u) + marginalQuantile(b, 1 - u);
    }
    law = makeLaw(vals, new Array<number>(gridSize).fill(1 / gridSize));
    exactness = 'numerical';
    method = `The sum q_A(u) + q_B(1 − u) is evaluated on ${gridSize} equally spaced probability points, which is the countermonotonic coupling discretised in u.`;
  }
  const rows = levels.map((level) => rowFromLaw(law, level, marginalSummaries(marginals, level), aggregateBounds(marginals, level), []));
  return {
    dependenceKind: 'countermonotonic',
    dependenceAssumption: 'COUNTERMONOTONIC: the two exposures are assumed perfectly negatively dependent — when one is at its worst the other is at its best.',
    exactness,
    method,
    labels: marginals.map((m) => m.label),
    mean: lawMean(law),
    rows,
    aggregateSd: Math.sqrt(Math.max(0, law.values.reduce((s, v, i) => s + law.probs[i] * v * v, 0) - lawMean(law) ** 2)),
    notes: [
      'This is the best case for dispersion between two exposures, but it is not the minimum of every risk measure: for VaR the minimum over all couplings can be lower still.',
      'Countermonotonicity does not extend beyond two exposures, which is why a "maximally diversified" portfolio of many exposures is not simply the negative-dependence case.',
    ],
    limitations: ['Perfect negative dependence is as strong an assumption as perfect positive dependence, and as rarely true.'],
  };
}

/** Gaussian copula with a given correlation matrix, by simulation. */
export function aggregateGaussianCopula(
  marginals: Marginal[],
  levels: number[],
  correlation: Matrix,
  opts: { trials?: number; seed?: string } = {},
): AggregateRiskResult {
  assertMarginals(marginals);
  for (const l of levels) assertLevel(l);
  const d = marginals.length;
  if (correlation.length !== d) {
    throw new EngineError(`The correlation matrix has ${correlation.length} rows but there are ${d} exposures.`, 'shape');
  }
  for (let i = 0; i < d; i++) {
    if (Math.abs(correlation[i][i] - 1) > 1e-9) {
      throw new EngineError(`A correlation matrix must have 1 on the diagonal; entry (${i + 1}, ${i + 1}) is ${correlation[i][i]}.`, 'range');
    }
    for (let j = 0; j < d; j++) {
      if (!(Math.abs(correlation[i][j]) <= 1)) {
        throw new EngineError(`Correlation (${i + 1}, ${j + 1}) is ${correlation[i][j]}, which is outside [−1, 1].`, 'range');
      }
    }
  }
  // Names the offending eigenvalue when the matrix is not a valid correlation matrix.
  const check = checkCovariance(correlation, 'correlation matrix');
  const chol = choleskyWithCheck(correlation);
  if (!chol.ok) throw new EngineError('The correlation matrix could not be factorised even though its eigenvalues are positive; it is numerically too close to singular to simulate from.', 'notPositiveDefinite');
  const trials = opts.trials ?? 100_000;
  if (!Number.isInteger(trials) || trials < 1000) throw new EngineError(`At least 1000 trials are needed for a tail estimate; received ${trials}.`, 'range');
  const rng = new Random(new Xoshiro128(opts.seed ?? 'portfolio-gaussian-copula'));
  const sums = new Float64Array(trials);
  const z = new Float64Array(d);
  for (let t = 0; t < trials; t++) {
    for (let i = 0; i < d; i++) z[i] = rng.normal();
    let s = 0;
    for (let i = 0; i < d; i++) {
      let corr = 0;
      for (let j = 0; j <= i; j++) corr += chol.L[i][j] * z[j];
      const u = normalCdf(corr);
      s += marginalQuantile(marginals[i], Math.min(1 - 1e-15, Math.max(1e-15, u)));
    }
    sums[t] = s;
  }
  const sorted = sortedCopy(sums);
  const rows = levels.map((level) => {
    const parts = marginalSummaries(marginals, level);
    const bounds = aggregateBounds(marginals, level);
    const v = empiricalVar(sorted, level);
    const es = empiricalEs(sorted, level);
    const sumVar = stableSum(parts.map((p) => p.valueAtRisk));
    const sumEs = stableSum(parts.map((p) => p.expectedShortfall));
    const est = estimationUncertainty(sorted, level);
    const warnings: string[] = [];
    if (est.tailScenarioCount < 100) {
      warnings.push(
        `Only ${est.tailScenarioCount} of ${trials} simulated outcomes lie at or beyond VaR at this level, so both figures are imprecise. Increase the number of trials.`,
      );
    }
    return {
      level,
      valueAtRisk: v,
      expectedShortfall: es,
      varBounds: { lower: bounds.varLower, upper: bounds.varUpper },
      esBounds: { lower: bounds.esLower, upper: bounds.esUpper },
      sumOfMarginalVar: sumVar,
      sumOfMarginalEs: sumEs,
      diversificationBenefitVar: sumVar - v,
      diversificationBenefitEs: sumEs - es,
      estimation: {
        trials,
        varStandardError: est.varStandardError,
        esStandardError: est.esStandardError,
        varInterval95: est.varStandardError === null ? null : { low: v - 1.96 * est.varStandardError, high: v + 1.96 * est.varStandardError },
        esInterval95: est.esStandardError === null ? null : { low: es - 1.96 * est.esStandardError, high: es + 1.96 * est.esStandardError },
        tailScenarioCount: est.tailScenarioCount,
      },
      warnings,
    } satisfies AggregateLevelRow;
  });
  return {
    dependenceKind: 'correlation',
    dependenceAssumption: `GAUSSIAN COPULA with the correlation matrix you supplied (condition number ${check.conditionNumber.toPrecision(4)}). The dependence is normal-shaped: the tails become independent as the level rises, whatever the correlation.`,
    exactness: 'empirical',
    method: `${trials.toLocaleString('en-US')} simulated draws: correlated normals from the Cholesky factor, mapped through Φ and then through each marginal's quantile function (inverse-transform sampling).`,
    labels: marginals.map((m) => m.label),
    mean: sampleMean(sorted),
    rows,
    aggregateSd: populationSd(sorted),
    notes: [
      'A Gaussian copula has asymptotically independent tails: with any correlation below 1, extreme joint losses are much rarer than under a t or Clayton copula with the same correlation. If joint extremes are the concern, this assumption understates them.',
      'The correlation matrix fixes only pairwise linear association of the normal scores. Many different joint distributions share it.',
      'The figures are simulation estimates. The standard errors reported alongside describe how precisely THIS model was evaluated; they say nothing about whether the model is right.',
    ],
    limitations: [
      'Monte Carlo error falls only as 1/√trials, so a 99.9% figure needs very many trials.',
      'Tail dependence, if present in the real exposures, is absent from this assumption by construction.',
    ],
  };
}

function estimationUncertainty(sorted: Float64Array, level: number): { varStandardError: number | null; esStandardError: number | null; tailScenarioCount: number } {
  const n = sorted.length;
  const v = empiricalVar(sorted, level);
  let tail = 0;
  let tailSum = 0;
  let tailSumSq = 0;
  for (let i = 0; i < n; i++) {
    if (sorted[i] >= v) {
      tail++;
      tailSum += sorted[i];
      tailSumSq += sorted[i] * sorted[i];
    }
  }
  // VaR standard error: √(α(1−α)/n)/f(q), with f estimated from order-statistic spacing.
  const k = Math.min(n - 1, Math.max(1, Math.round(level * n)));
  const window = Math.max(1, Math.round(0.02 * n));
  const lo = Math.max(0, k - window);
  const hi = Math.min(n - 1, k + window);
  const spread = sorted[hi] - sorted[lo];
  const varSe = spread > 0 ? Math.sqrt((level * (1 - level)) / n) / ((hi - lo) / n / spread) : null;
  const esSe = tail > 1 ? Math.sqrt(Math.max(0, tailSumSq / tail - (tailSum / tail) ** 2) / tail) : null;
  return { varStandardError: varSe, esStandardError: esSe, tailScenarioCount: tail };
}

/** Unknown dependence: bounds only. No point figure is invented. */
export function aggregateUnknownDependence(marginals: Marginal[], levels: number[]): AggregateRiskResult {
  assertMarginals(marginals);
  for (const l of levels) assertLevel(l);
  let allExact = true;
  const rows = levels.map((level) => {
    const parts = marginalSummaries(marginals, level);
    if (!parts.every((p) => p.exactness === 'exact')) allExact = false;
    const bounds = aggregateBounds(marginals, level);
    return {
      level,
      valueAtRisk: null,
      expectedShortfall: null,
      varBounds: { lower: bounds.varLower, upper: bounds.varUpper },
      esBounds: { lower: bounds.esLower, upper: bounds.esUpper },
      sumOfMarginalVar: stableSum(parts.map((p) => p.valueAtRisk)),
      sumOfMarginalEs: stableSum(parts.map((p) => p.expectedShortfall)),
      diversificationBenefitVar: null,
      diversificationBenefitEs: null,
      estimation: null,
      warnings: ['No single aggregate figure exists without a dependence assumption; the interval is the complete answer the marginals support.'],
    } satisfies AggregateLevelRow;
  });
  return {
    dependenceKind: 'unknown',
    dependenceAssumption: 'UNKNOWN DEPENDENCE: no assumption has been made about how the exposures move together, so the result is a range rather than a number.',
    exactness: allExact ? 'exact' : 'numerical',
    method: aggregateBounds(marginals, levels[0] ?? 0.95).justification.join(' '),
    labels: marginals.map((m) => m.label),
    mean: stableSum(marginals.map((m) => marginalRisk(m, 0.5).mean)),
    rows,
    aggregateSd: null,
    notes: [
      'The interval is wide because the marginals genuinely do not determine the aggregate. Narrowing it requires information about the dependence, not more computation.',
      'A point figure here would be a choice of dependence presented as a fact.',
    ],
    limitations: ['The VaR bounds are the standard bounds; they are sharp asymptotically but may not be attained exactly for a small number of exposures.'],
  };
}

export function aggregateRisk(marginals: Marginal[], assumption: DependenceAssumption, levels: number[], opts: IndependenceOptions = {}): AggregateRiskResult {
  switch (assumption.kind) {
    case 'independence':
      return aggregateIndependent(marginals, levels, opts);
    case 'comonotonic':
      return aggregateComonotonic(marginals, levels);
    case 'countermonotonic':
      return aggregateCountermonotonic(marginals, levels);
    case 'correlation':
      return aggregateGaussianCopula(marginals, levels, assumption.matrix, { trials: assumption.trials, seed: assumption.seed });
    case 'unknown':
      return aggregateUnknownDependence(marginals, levels);
  }
}

export interface DependenceComparison {
  levels: number[];
  results: AggregateRiskResult[];
  /** The ordering that must always hold, checked numerically. */
  orderingHolds: boolean;
  orderingNote: string;
}

/**
 * Aggregate under every available assumption so the span of the answer is
 * visible. The diversification benefit of each is reported in its rows.
 */
export function compareDependenceAssumptions(
  marginals: Marginal[],
  levels: number[],
  opts: { independence?: IndependenceOptions; correlation?: Matrix; trials?: number; seed?: string } = {},
): DependenceComparison {
  const results: AggregateRiskResult[] = [aggregateUnknownDependence(marginals, levels), aggregateComonotonic(marginals, levels)];
  let independent: AggregateRiskResult | null = null;
  try {
    independent = aggregateIndependent(marginals, levels, opts.independence ?? {});
    results.push(independent);
  } catch (e) {
    if (!(e instanceof EngineError)) throw e;
    // An exposure that cannot be put on a lattice simply has no exact
    // independent aggregation; that is reported, not papered over.
  }
  if (marginals.length === 2) {
    try {
      results.push(aggregateCountermonotonic(marginals, levels));
    } catch (e) {
      if (!(e instanceof EngineError)) throw e;
    }
  }
  if (opts.correlation) {
    results.push(aggregateGaussianCopula(marginals, levels, opts.correlation, { trials: opts.trials, seed: opts.seed }));
  }
  let ordering = true;
  const como = results.find((r) => r.dependenceKind === 'comonotonic')!;
  for (let i = 0; i < levels.length; i++) {
    const c = como.rows[i];
    const cEs = c.expectedShortfall;
    if (cEs === null) continue;
    if (!(c.esBounds.lower <= cEs + 1e-9 && cEs <= c.esBounds.upper + 1e-9)) ordering = false;
    if (independent) {
      const iEs = independent.rows[i].expectedShortfall;
      if (iEs === null) continue;
      if (!(c.esBounds.lower <= iEs + 1e-6 && iEs <= cEs + 1e-6)) ordering = false;
    }
  }
  return {
    levels,
    results,
    orderingHolds: ordering,
    orderingNote:
      'For Expected Shortfall the ordering mean ≤ independent ≤ comonotonic = upper bound must hold at every level, because ES is subadditive and comonotone additive. A failure indicates a bug, not an interesting finding.',
  };
}
