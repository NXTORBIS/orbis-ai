/**
 * Scenario aggregation, stress testing, drawdown analysis, the Cornish–Fisher
 * expansion (with its validity domain) and risk-measure backtesting.
 *
 * The scenario aggregator is a **generator** that yields between chunks, for
 * the same reason as `simulationSteps` in engine/simulation/runner.ts: a worker
 * stuck inside a synchronous loop can never receive a cancel message.
 */
import { EngineError, type Exactness } from '../core/result';
import { stableSum } from '../core/numeric';
import { Random, Xoshiro128 } from '../random/rng';
import { choleskyWithCheck, solve, type Matrix } from '../stats/linalg';
import { sortedCopy } from '../stats/descriptive';
import { normalQuantile, normalSf } from '../special/gamma';
import { assertLevel, empiricalEs, empiricalVar, populationSd, sampleMean } from './empirical';
import { checkCovariance, chiSquareSf, dot, quadraticForm } from './numerics';
import { portfolioLosses, type ScenarioSet } from './allocation';
import type { RiskMeasure } from './measures';

export interface ScenarioRiskRow {
  level: number;
  valueAtRisk: number;
  expectedShortfall: number;
  tailScenarioCount: number;
  /** Sampling uncertainty of the ESTIMATE, not the risk measure itself. */
  varStandardError: number | null;
  esStandardError: number | null;
  varInterval95: { low: number; high: number } | null;
  esInterval95: { low: number; high: number } | null;
}

export interface ScenarioRiskResult {
  scenarios: number;
  source: 'historical' | 'monteCarlo';
  mean: number;
  standardDeviation: number;
  worst: number;
  best: number;
  rows: ScenarioRiskRow[];
  exactness: Exactness;
  dependenceAssumption: string;
  notes: string[];
}

export interface ScenarioAggregationOptions {
  chunkSize?: number;
  source?: 'historical' | 'monteCarlo';
  /** Minimum number of scenarios that must lie in the tail; below it the computation is refused. */
  minimumTailScenarios?: number;
}

/**
 * Aggregate a scenario matrix into portfolio risk measures, yielding the
 * fraction completed between chunks so the caller can report progress and
 * cancel.
 */
export function* scenarioAggregationSteps(
  set: ScenarioSet,
  weights: number[],
  levels: number[],
  opts: ScenarioAggregationOptions = {},
): Generator<number, ScenarioRiskResult, void> {
  for (const l of levels) assertLevel(l);
  const n = set.scenarios.length;
  const d = set.labels.length;
  if (weights.length !== d) throw new EngineError(`${weights.length} weights were given for ${d} exposures.`, 'shape');
  const minTail = opts.minimumTailScenarios ?? 5;
  for (const level of levels) {
    const expected = (1 - level) * n;
    if (expected < minTail) {
      throw new EngineError(
        `At level ${level} only ${expected.toFixed(2)} of the ${n} scenarios lie in the tail, fewer than the ${minTail} required for an Expected Shortfall estimate. No figure is reported; supply more scenarios or use a lower level.`,
        'insufficient',
      );
    }
  }
  const chunk = opts.chunkSize ?? 4096;
  if (!Number.isInteger(chunk) || chunk < 1) throw new EngineError('The chunk size must be a whole number of at least 1.', 'range');
  const losses = new Float64Array(n);
  let done = 0;
  while (done < n) {
    const end = Math.min(n, done + chunk);
    for (; done < end; done++) {
      let acc = 0;
      const row = set.scenarios[done];
      for (let i = 0; i < d; i++) acc += weights[i] * row[i];
      if (!Number.isFinite(acc)) throw new EngineError(`Scenario ${done + 1} produced a non-finite portfolio loss.`, 'finite');
      losses[done] = acc;
    }
    // Yielding here is what makes cancellation possible; do not remove it.
    yield done / n;
  }
  const sorted = sortedCopy(losses);
  const source = opts.source ?? 'historical';
  const rows = levels.map((level) => {
    const v = empiricalVar(sorted, level);
    const es = empiricalEs(sorted, level);
    let tail = 0;
    let tailSum = 0;
    let tailSq = 0;
    for (let i = 0; i < n; i++) {
      if (sorted[i] >= v) {
        tail++;
        tailSum += sorted[i];
        tailSq += sorted[i] * sorted[i];
      }
    }
    const k = Math.min(n - 1, Math.max(1, Math.round(level * n)));
    const window = Math.max(1, Math.round(0.02 * n));
    const lo = Math.max(0, k - window);
    const hi = Math.min(n - 1, k + window);
    const spread = sorted[hi] - sorted[lo];
    const varSe = spread > 0 ? Math.sqrt((level * (1 - level)) / n) / ((hi - lo) / n / spread) : null;
    const esSe = tail > 1 ? Math.sqrt(Math.max(0, tailSq / tail - (tailSum / tail) ** 2) / tail) : null;
    return {
      level,
      valueAtRisk: v,
      expectedShortfall: es,
      tailScenarioCount: tail,
      varStandardError: varSe,
      esStandardError: esSe,
      varInterval95: varSe === null ? null : { low: v - 1.96 * varSe, high: v + 1.96 * varSe },
      esInterval95: esSe === null ? null : { low: es - 1.96 * esSe, high: es + 1.96 * esSe },
    } satisfies ScenarioRiskRow;
  });
  return {
    scenarios: n,
    source,
    mean: sampleMean(sorted),
    standardDeviation: populationSd(sorted),
    worst: sorted[n - 1],
    best: sorted[0],
    rows,
    exactness: 'empirical',
    dependenceAssumption:
      source === 'historical'
        ? 'HISTORICAL: the dependence between exposures is whatever occurred in the observed scenarios. Nothing is assumed, but nothing outside the sample is represented either — including every joint extreme that has not yet happened.'
        : 'SIMULATED: the dependence is whatever the simulation model imposed. The figures describe that model, not the world.',
    notes: [
      'The confidence intervals describe how precisely these scenarios pin down the measure. They are sampling uncertainty about an ESTIMATE, and are a different statement from the risk measure itself, which is a quantile of the loss distribution.',
      'With historical scenarios the effective sample size in the tail is small by construction: a 99% figure from 500 scenarios rests on 5 observations.',
    ],
  };
}

export function scenarioAggregate(set: ScenarioSet, weights: number[], levels: number[], opts: ScenarioAggregationOptions = {}): ScenarioRiskResult {
  const steps = scenarioAggregationSteps(set, weights, levels, opts);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

/* ------------------------------------------------------------------ *
 * Stress testing                                                      *
 * ------------------------------------------------------------------ */

export interface Shock {
  label: string;
  /** Added to every scenario of the named exposure (index → shift). */
  meanShift?: number[];
  /** Multiplies each exposure's deviation from its own mean. */
  volatilityMultiplier?: number[];
  /** Re-couples the exposures to this correlation matrix, keeping each marginal unchanged. */
  correlation?: Matrix;
  seed?: string;
}

export interface StressResult {
  label: string;
  base: Record<string, number>;
  stressed: Record<string, number>;
  change: Record<string, number>;
  relativeChange: Record<string, number>;
  description: string;
  exactness: Exactness;
}

function applyShock(set: ScenarioSet, shock: Shock): ScenarioSet {
  const n = set.scenarios.length;
  const d = set.labels.length;
  const check = (a: number[] | undefined, what: string): void => {
    if (a && a.length !== d) throw new EngineError(`Shock "${shock.label}": ${what} has ${a.length} entries but there are ${d} exposures.`, 'shape');
  };
  check(shock.meanShift, 'the mean shift');
  check(shock.volatilityMultiplier, 'the volatility multiplier');
  if (shock.volatilityMultiplier) {
    for (const m of shock.volatilityMultiplier) {
      if (!(m >= 0)) throw new EngineError(`Shock "${shock.label}": a volatility multiplier must be 0 or greater; received ${m}.`, 'range');
    }
  }
  const columnMeans = new Array<number>(d).fill(0);
  for (const row of set.scenarios) for (let i = 0; i < d; i++) columnMeans[i] += row[i] / n;
  let scenarios = set.scenarios.map((row) =>
    row.map((v, i) => {
      const scaled = columnMeans[i] + (v - columnMeans[i]) * (shock.volatilityMultiplier?.[i] ?? 1);
      return scaled + (shock.meanShift?.[i] ?? 0);
    }),
  );
  if (shock.correlation) {
    if (shock.correlation.length !== d) throw new EngineError(`Shock "${shock.label}": the correlation matrix has ${shock.correlation.length} rows but there are ${d} exposures.`, 'shape');
    checkCovariance(shock.correlation, `correlation matrix of shock "${shock.label}"`);
    const chol = choleskyWithCheck(shock.correlation);
    if (!chol.ok) throw new EngineError(`Shock "${shock.label}": the correlation matrix could not be factorised.`, 'notPositiveDefinite');
    // Re-couple by rank: each column keeps its own values (its marginal is
    // untouched) but is reordered to follow the ranks of a Gaussian draw with
    // the shocked correlation.
    const rng = new Random(new Xoshiro128(shock.seed ?? `stress-${shock.label}`));
    const target: number[][] = [];
    const z = new Float64Array(d);
    for (let s = 0; s < n; s++) {
      for (let i = 0; i < d; i++) z[i] = rng.normal();
      const row = new Array<number>(d).fill(0);
      for (let i = 0; i < d; i++) {
        let acc = 0;
        for (let j = 0; j <= i; j++) acc += chol.L[i][j] * z[j];
        row[i] = acc;
      }
      target.push(row);
    }
    const reordered: number[][] = Array.from({ length: n }, () => new Array<number>(d).fill(0));
    for (let i = 0; i < d; i++) {
      const column = scenarios.map((row) => row[i]).sort((a, b) => a - b);
      const rank = Array.from({ length: n }, (_, s) => s).sort((a, b) => target[a][i] - target[b][i]);
      for (let r = 0; r < n; r++) reordered[rank[r]][i] = column[r];
    }
    scenarios = reordered;
  }
  return { scenarios, labels: set.labels };
}

/** Apply named shocks and report the change in every supplied risk measure. */
export function stressTest(set: ScenarioSet, weights: number[], shocks: Shock[], measures: RiskMeasure[]): StressResult[] {
  if (!measures.length) throw new EngineError('At least one risk measure is required for a stress test.', 'required');
  const baseSorted = sortedCopy(portfolioLosses(set, weights));
  const base: Record<string, number> = {};
  for (const m of measures) base[m.name] = m.evaluate(baseSorted);
  return shocks.map((shock) => {
    const shocked = applyShock(set, shock);
    const sorted = sortedCopy(portfolioLosses(shocked, weights));
    const stressed: Record<string, number> = {};
    const change: Record<string, number> = {};
    const relative: Record<string, number> = {};
    for (const m of measures) {
      const v = m.evaluate(sorted);
      stressed[m.name] = v;
      change[m.name] = v - base[m.name];
      relative[m.name] = base[m.name] !== 0 ? (v - base[m.name]) / Math.abs(base[m.name]) : NaN;
    }
    const parts: string[] = [];
    if (shock.meanShift) parts.push('a shift in expected losses');
    if (shock.volatilityMultiplier) parts.push('a change in volatility');
    if (shock.correlation) parts.push('a re-coupling of the exposures to a different correlation matrix, with each marginal left unchanged');
    return {
      label: shock.label,
      base,
      stressed,
      change,
      relativeChange: relative,
      description: `Shock "${shock.label}" applies ${parts.join(' and ') || 'no change'}. A stress result is a conditional statement: it says what this model gives IF the shock happens, and attaches no probability to it.`,
      exactness: 'empirical',
    };
  });
}

export interface ReverseStressResult {
  targetLoss: number;
  /** Smallest shock (in Mahalanobis norm) to the factors that produces the target loss. */
  factorShock: number[];
  /** Distance of that shock from the centre, in standard deviations of the factor distribution. */
  mahalanobisDistance: number;
  /** Under a joint normal factor model, how extreme that distance is. */
  equivalentNormalProbability: number;
  exactness: Exactness;
  method: string;
  notes: string[];
}

/**
 * Reverse stress test: "what would have to happen for us to lose X?"
 *
 * For a linear exposure L = wᵀz with factor covariance Σ, the smallest shock
 * (in Mahalanobis norm) achieving L = target is z* = target·Σw/(wᵀΣw), with
 * distance |target|/√(wᵀΣw). Closed form, therefore exact for the linear model.
 */
export function reverseStressTest(exposures: number[], factorCovariance: Matrix, targetLoss: number): ReverseStressResult {
  const check = checkCovariance(factorCovariance, 'factor covariance matrix');
  if (exposures.length !== check.n) throw new EngineError(`${exposures.length} exposures were given for a ${check.n}×${check.n} factor covariance matrix.`, 'shape');
  if (!Number.isFinite(targetLoss)) throw new EngineError('The target loss must be a finite number.', 'finite');
  const sw = factorCovariance.map((row) => dot(row, exposures));
  const denom = dot(exposures, sw);
  if (!(denom > 0)) {
    throw new EngineError('The exposure vector has zero variance under this factor model, so no factor shock can change the portfolio loss and the target can never be reached.', 'degenerate');
  }
  const shock = sw.map((v) => (targetLoss * v) / denom);
  const distance = Math.abs(targetLoss) / Math.sqrt(denom);
  return {
    targetLoss,
    factorShock: shock,
    mahalanobisDistance: distance,
    equivalentNormalProbability: normalSf(distance),
    exactness: 'exact',
    method: 'Minimum-norm solution of wᵀz = target under the Mahalanobis norm zᵀΣ⁻¹z: z* = target·Σw/(wᵀΣw).',
    notes: [
      'This is the *most plausible* way to lose the target amount under the stated factor model, not the only way. Any shock on the hyperplane wᵀz = target does it; this one is the closest to normal conditions.',
      'The equivalent probability assumes jointly normal factors. With heavy-tailed or tail-dependent factors the same loss is far more likely than the figure suggests.',
      'The answer is only as good as the linear exposure assumption: optionality, non-linear payoffs and liquidity effects are not represented.',
    ],
  };
}


/** Among a set of scenarios, the ones closest to a target portfolio loss. */
export function reverseStressScenarios(set: ScenarioSet, weights: number[], targetLoss: number, count = 5): { scenarioIndex: number; loss: number; contributions: number[] }[] {
  const losses = portfolioLosses(set, weights);
  const idx = Array.from({ length: losses.length }, (_, i) => i).sort((a, b) => Math.abs(losses[a] - targetLoss) - Math.abs(losses[b] - targetLoss));
  if (!Number.isInteger(count) || count < 1) throw new EngineError('At least one scenario must be requested.', 'range');
  return idx.slice(0, count).map((i) => ({
    scenarioIndex: i,
    loss: losses[i],
    contributions: set.scenarios[i].map((v, j) => weights[j] * v),
  }));
}

/* ------------------------------------------------------------------ *
 * Drawdown                                                           *
 * ------------------------------------------------------------------ */

export interface DrawdownEpisode {
  peakIndex: number;
  troughIndex: number;
  recoveryIndex: number | null;
  depth: number;
  duration: number;
  recovered: boolean;
}

export interface DrawdownResult {
  maximumDrawdown: number;
  maximumDrawdownPeak: number;
  maximumDrawdownTrough: number;
  averageDrawdown: number;
  /** Conditional Drawdown at Risk: the average of the worst (1 − α) share of the drawdown series. */
  conditionalDrawdownAtRisk: number;
  level: number;
  drawdownSeries: number[];
  episodes: DrawdownEpisode[];
  durationQuantiles: { p: number; value: number }[];
  longestDuration: number;
  calmarRatio: number | null;
  relative: boolean;
  exactness: Exactness;
  notes: string[];
}

/**
 * Drawdown analysis of an equity (or cumulative value) path.
 * `relative` measures the decline as a fraction of the previous peak; otherwise
 * it is measured in the units of the path.
 */
export function drawdownAnalysis(
  path: ArrayLike<number>,
  opts: { level?: number; relative?: boolean; periodsPerYear?: number } = {},
): DrawdownResult {
  const n = path.length;
  if (n < 2) throw new EngineError('A drawdown analysis needs at least 2 points on the path.', 'insufficient');
  for (let i = 0; i < n; i++) if (!Number.isFinite(path[i])) throw new EngineError(`Point ${i + 1} of the path is not a finite number.`, 'finite');
  const relative = opts.relative ?? true;
  if (relative) {
    for (let i = 0; i < n; i++) {
      if (!(path[i] > 0)) throw new EngineError(`A relative drawdown needs a strictly positive path; point ${i + 1} is ${path[i]}. Use relative: false for a path that can be zero or negative.`, 'range');
    }
  }
  const level = opts.level ?? 0.95;
  assertLevel(level);
  const dd = new Array<number>(n).fill(0);
  let peak = path[0];
  let peakIndex = 0;
  const episodes: DrawdownEpisode[] = [];
  let current: DrawdownEpisode | null = null;
  for (let i = 0; i < n; i++) {
    if (path[i] >= peak) {
      if (current) {
        current.recoveryIndex = i;
        current.recovered = true;
        current.duration = i - current.peakIndex;
        episodes.push(current);
        current = null;
      }
      peak = path[i];
      peakIndex = i;
      dd[i] = 0;
      continue;
    }
    const decline = relative ? (peak - path[i]) / peak : peak - path[i];
    dd[i] = decline;
    if (!current) current = { peakIndex, troughIndex: i, recoveryIndex: null, depth: decline, duration: i - peakIndex, recovered: false };
    else if (decline > current.depth) {
      current.depth = decline;
      current.troughIndex = i;
    }
    current.duration = i - current.peakIndex;
  }
  if (current) episodes.push(current);
  let maxDd = 0;
  let maxTrough = 0;
  for (let i = 0; i < n; i++) {
    if (dd[i] > maxDd) {
      maxDd = dd[i];
      maxTrough = i;
    }
  }
  let maxPeak = 0;
  for (const e of episodes) if (e.troughIndex === maxTrough) maxPeak = e.peakIndex;
  const sortedDd = sortedCopy(dd);
  const durations = episodes.map((e) => e.duration).sort((a, b) => a - b);
  const durationQuantiles = [0.5, 0.75, 0.9, 1].map((p) => ({
    p,
    value: durations.length ? durations[Math.min(durations.length - 1, Math.max(0, Math.ceil(p * durations.length) - 1))] : 0,
  }));
  let calmar: number | null = null;
  if (opts.periodsPerYear !== undefined) {
    if (!(opts.periodsPerYear > 0)) throw new EngineError('Periods per year must be greater than 0.', 'range');
    if (!relative) {
      throw new EngineError('The Calmar ratio is a return divided by a relative drawdown; it needs relative: true (a positive path).', 'unsupported');
    }
    const years = (n - 1) / opts.periodsPerYear;
    if (years > 0 && maxDd > 0) {
      const annualised = Math.pow(path[n - 1] / path[0], 1 / years) - 1;
      calmar = annualised / maxDd;
    }
  }
  return {
    maximumDrawdown: maxDd,
    maximumDrawdownPeak: maxPeak,
    maximumDrawdownTrough: maxTrough,
    averageDrawdown: sampleMean(sortedDd),
    conditionalDrawdownAtRisk: empiricalEs(sortedDd, level),
    level,
    drawdownSeries: dd,
    episodes,
    durationQuantiles,
    longestDuration: durations.length ? durations[durations.length - 1] : 0,
    calmarRatio: calmar,
    relative,
    exactness: 'exact',
    notes: [
      'Maximum drawdown is the worst peak-to-trough decline actually observed on this path. It is a single realisation, not an expectation: a different path from the same process would give a different figure, and the spread is wide.',
      'Conditional Drawdown at Risk averages the worst share of the drawdown series, so unlike maximum drawdown it is not decided by one point.',
      'An unrecovered final episode is flagged as such; its duration is a lower bound, because the recovery has not happened yet.',
      'The Calmar ratio divides an annualised return by the single worst decline, so it is as unstable as that one number.',
    ],
  };
}

/**
 * Exact expected maximum drawdown of a **driftless** random walk / Brownian
 * motion: E[MDD] = √(π/2)·σ·√T (Magdon-Ismail, Atiya, Pratap & Abu-Mostafa 2004).
 * With drift there is no such elementary closed form, and it is refused rather
 * than approximated.
 */
export function expectedMaximumDrawdownDriftless(sigmaPerStep: number, steps: number, drift = 0): { expected: number; exactness: Exactness; formula: string } {
  if (!(sigmaPerStep > 0)) throw new EngineError(`The per-step standard deviation must be greater than 0; received ${sigmaPerStep}.`, 'range');
  if (!(Number.isInteger(steps) && steps > 0)) throw new EngineError(`The number of steps must be a positive whole number; received ${steps}.`, 'range');
  if (drift !== 0) {
    throw new EngineError(
      `The expected maximum drawdown has a closed form only for a driftless walk; a drift of ${drift} was supplied. Estimate it by simulation instead — the drifted case involves an infinite series, and a figure from the driftless formula would be wrong.`,
      'unsupported',
    );
  }
  return {
    expected: Math.sqrt(Math.PI / 2) * sigmaPerStep * Math.sqrt(steps),
    exactness: 'exact',
    formula: 'E[MDD] = √(π/2)·σ·√T for a driftless Brownian motion observed over T (≈ 1.2533·σ·√T).',
  };
}

/* ------------------------------------------------------------------ *
 * Cornish–Fisher                                                      *
 * ------------------------------------------------------------------ */

export interface CornishFisherResult {
  quantiles: { level: number; value: number; normalValue: number }[];
  skewness: number;
  excessKurtosis: number;
  /** The expansion is monotone in z over the whole line. */
  globallyMonotone: boolean;
  /** Smallest value of the derivative over the real line (−∞ when unbounded). */
  minimumDerivative: number;
  exactness: Exactness;
  method: string;
  notes: string[];
}

/**
 * Cornish–Fisher quantile expansion from the first four moments:
 *   q(α) ≈ μ + σ·[z + (z²−1)S/6 + (z³−3z)K/24 − (2z³−5z)S²/36]
 *
 * The expansion is a cubic in z and is **not monotone** for large skewness or
 * kurtosis: outside its validity domain it returns quantiles that decrease as
 * the confidence level rises, which is not a distribution at all. The domain is
 * checked exactly (the derivative is a quadratic in z, so its minimum is known
 * in closed form) and the expansion is refused outside it.
 */
export function cornishFisherQuantiles(
  mean: number,
  sd: number,
  skewness: number,
  excessKurtosis: number,
  levels: number[],
  opts: { requireGlobalMonotonicity?: boolean } = {},
): CornishFisherResult {
  if (!Number.isFinite(mean)) throw new EngineError('The mean must be a finite number.', 'finite');
  if (!(sd > 0)) throw new EngineError(`The standard deviation must be greater than 0; received ${sd}.`, 'range');
  if (!Number.isFinite(skewness) || !Number.isFinite(excessKurtosis)) throw new EngineError('Skewness and excess kurtosis must be finite numbers.', 'finite');
  if (excessKurtosis < -2) throw new EngineError(`An excess kurtosis of ${excessKurtosis} is impossible (the lower bound is −2).`, 'range');
  // The moment inequality K ≥ S² − 2 must hold for any distribution.
  if (excessKurtosis < skewness * skewness - 2) {
    throw new EngineError(
      `Skewness ${skewness} and excess kurtosis ${excessKurtosis} are jointly impossible: every distribution satisfies excess kurtosis ≥ skewness² − 2 (here ${(skewness * skewness - 2).toPrecision(4)}).`,
      'range',
    );
  }
  for (const l of levels) assertLevel(l);
  const S = skewness;
  const K = excessKurtosis;
  // d/dz of the expansion: a·z² + b·z + c.
  const a = K / 8 - (S * S) / 6;
  const b = S / 3;
  const c = 1 - K / 8 + (5 * S * S) / 36;
  let minDeriv: number;
  if (a > 0) minDeriv = c - (b * b) / (4 * a);
  else if (a === 0) minDeriv = b === 0 ? c : -Infinity;
  else minDeriv = -Infinity;
  const monotone = minDeriv >= 0;
  if ((opts.requireGlobalMonotonicity ?? true) && !monotone) {
    throw new EngineError(
      `The Cornish–Fisher expansion is outside its validity domain for skewness ${S} and excess kurtosis ${K}: the expansion is not monotone (its derivative falls to ${minDeriv === -Infinity ? '−∞' : minDeriv.toPrecision(4)}), so it would return quantiles that decrease as the confidence level rises. No quantile is reported. Fit a distribution with these moments, or use the empirical quantiles, instead of extending the expansion beyond where it is valid.`,
      'outsideValidityDomain',
    );
  }
  const quantiles = levels.map((level) => {
    const z = normalQuantile(level);
    const adj = z + ((z * z - 1) * S) / 6 + ((z * z * z - 3 * z) * K) / 24 - ((2 * z * z * z - 5 * z) * S * S) / 36;
    return { level, value: mean + sd * adj, normalValue: mean + sd * z };
  });
  return {
    quantiles,
    skewness: S,
    excessKurtosis: K,
    globallyMonotone: monotone,
    minimumDerivative: minDeriv,
    exactness: 'numerical',
    method:
      'Cornish–Fisher expansion to the fourth moment. Validity is checked exactly: the derivative with respect to z is the quadratic (K/8 − S²/6)z² + (S/3)z + (1 − K/8 + 5S²/36), whose minimum over the real line is known in closed form, and a negative minimum means the expansion is non-monotone and is refused.',
    notes: [
      'Four moments do not determine a distribution. The expansion is an approximation whose error is not bounded by anything computed here.',
      'At zero skewness and zero excess kurtosis the expansion reduces exactly to the normal quantile — a useful check, and a reminder that it is a perturbation of the normal.',
      'Accuracy degrades well before monotonicity fails; treat a large adjustment as a warning that the moment-based route is the wrong one.',
    ],
  };
}

/* ------------------------------------------------------------------ *
 * Backtesting                                                        *
 * ------------------------------------------------------------------ */

export interface KupiecResult {
  observations: number;
  exceptions: number;
  expectedExceptions: number;
  exceptionRate: number;
  expectedRate: number;
  statistic: number;
  pValue: number;
  rejectedAt5Percent: boolean;
  interpretation: string;
}

/** Kupiec's proportion-of-failures (unconditional coverage) test. */
export function kupiecTest(exceptions: number, observations: number, expectedRate: number): KupiecResult {
  if (!Number.isInteger(observations) || observations < 1) throw new EngineError('The number of observations must be a positive whole number.', 'range');
  if (!Number.isInteger(exceptions) || exceptions < 0 || exceptions > observations) {
    throw new EngineError(`The number of exceptions must be a whole number between 0 and ${observations}; received ${exceptions}.`, 'range');
  }
  if (!(expectedRate > 0 && expectedRate < 1)) throw new EngineError(`The expected exception rate must be strictly between 0 and 1; received ${expectedRate}.`, 'range');
  const n = observations;
  const x = exceptions;
  const p = expectedRate;
  const pHat = x / n;
  let lr: number;
  if (x === 0) lr = -2 * n * Math.log(1 - p);
  else if (x === n) lr = -2 * n * Math.log(p);
  else {
    lr = -2 * ((n - x) * Math.log((1 - p) / (1 - pHat)) + x * Math.log(p / pHat));
  }
  const pValue = chiSquareSf(lr, 1);
  return {
    observations: n,
    exceptions: x,
    expectedExceptions: n * p,
    exceptionRate: pHat,
    expectedRate: p,
    statistic: lr,
    pValue,
    rejectedAt5Percent: pValue < 0.05,
    interpretation:
      pValue < 0.05
        ? `The observed exception rate of ${(pHat * 100).toPrecision(3)}% is inconsistent with the stated ${(p * 100).toPrecision(3)}% (p = ${pValue.toPrecision(3)}). The model is rejected: it is ${pHat > p ? 'understating' : 'overstating'} the risk.`
        : `The observed exception rate of ${(pHat * 100).toPrecision(3)}% is consistent with the stated ${(p * 100).toPrecision(3)}% (p = ${pValue.toPrecision(3)}). Not rejecting is not the same as being right — with ${n} observations this test has limited power.`,
  };
}

export interface ChristoffersenResult {
  transitions: { n00: number; n01: number; n10: number; n11: number };
  independenceStatistic: number;
  independencePValue: number;
  conditionalCoverageStatistic: number;
  conditionalCoveragePValue: number;
  clustered: boolean;
  interpretation: string;
}

/**
 * Christoffersen's independence test and the conditional-coverage test
 * (= Kupiec + independence, χ² with 2 degrees of freedom).
 */
export function christoffersenTest(exceedances: ArrayLike<number | boolean>, expectedRate: number): ChristoffersenResult {
  const n = exceedances.length;
  if (n < 10) throw new EngineError(`At least 10 observations are needed for an independence test; received ${n}.`, 'insufficient');
  if (!(expectedRate > 0 && expectedRate < 1)) throw new EngineError('The expected exception rate must be strictly between 0 and 1.', 'range');
  const ind: number[] = Array.from({ length: n }, (_, i) => (exceedances[i] ? 1 : 0));
  let n00 = 0;
  let n01 = 0;
  let n10 = 0;
  let n11 = 0;
  for (let i = 1; i < n; i++) {
    const prev = ind[i - 1];
    const cur = ind[i];
    if (prev === 0 && cur === 0) n00++;
    else if (prev === 0 && cur === 1) n01++;
    else if (prev === 1 && cur === 0) n10++;
    else n11++;
  }
  const pi01 = n00 + n01 > 0 ? n01 / (n00 + n01) : 0;
  const pi11 = n10 + n11 > 0 ? n11 / (n10 + n11) : 0;
  const pi = (n01 + n11) / (n00 + n01 + n10 + n11);
  const logL = (p: number, ones: number, zeros: number): number => (ones > 0 ? ones * Math.log(p) : 0) + (zeros > 0 ? zeros * Math.log(1 - p) : 0);
  const unrestricted = logL(pi01, n01, n00) + logL(pi11, n11, n10);
  const restricted = logL(pi, n01 + n11, n00 + n10);
  const lrInd = Number.isFinite(unrestricted) && Number.isFinite(restricted) ? Math.max(0, -2 * (restricted - unrestricted)) : 0;
  const exceptions = ind.reduce((a, b) => a + b, 0);
  const lrUc = kupiecTest(exceptions, n, expectedRate).statistic;
  const lrCc = lrUc + lrInd;
  const pInd = chiSquareSf(lrInd, 1);
  const pCc = chiSquareSf(lrCc, 2);
  return {
    transitions: { n00, n01, n10, n11 },
    independenceStatistic: lrInd,
    independencePValue: pInd,
    conditionalCoverageStatistic: lrCc,
    conditionalCoveragePValue: pCc,
    clustered: pInd < 0.05,
    interpretation:
      pInd < 0.05
        ? `Exceptions are clustered (p = ${pInd.toPrecision(3)}): a breach makes the next breach more likely. Even with the right average rate, the model is missing the volatility dynamics, and losses arrive together.`
        : `No evidence of clustering (p = ${pInd.toPrecision(3)}). With ${exceptions} exceptions this test has little power; absence of evidence is not evidence of independence.`,
  };
}

export interface TrafficLightResult {
  exceptions: number;
  observations: number;
  cumulativeProbability: number;
  zone: 'green' | 'yellow' | 'red';
  interpretation: string;
}

/** The Basel traffic-light test: the cumulative binomial probability of the observed exception count. */
export function trafficLightTest(exceptions: number, observations: number, expectedRate: number): TrafficLightResult {
  if (!Number.isInteger(observations) || observations < 1) throw new EngineError('The number of observations must be a positive whole number.', 'range');
  if (!Number.isInteger(exceptions) || exceptions < 0 || exceptions > observations) {
    throw new EngineError(`The number of exceptions must be between 0 and ${observations}; received ${exceptions}.`, 'range');
  }
  if (!(expectedRate > 0 && expectedRate < 1)) throw new EngineError('The expected exception rate must be strictly between 0 and 1.', 'range');
  // P(X ≤ exceptions − 1) under the binomial null, as in the Basel framework.
  let cum = 0;
  let term = Math.pow(1 - expectedRate, observations);
  for (let k = 0; k < exceptions; k++) {
    cum += term;
    term *= ((observations - k) / (k + 1)) * (expectedRate / (1 - expectedRate));
  }
  const zone: TrafficLightResult['zone'] = cum < 0.95 ? 'green' : cum < 0.9999 ? 'yellow' : 'red';
  return {
    exceptions,
    observations,
    cumulativeProbability: cum,
    zone,
    interpretation:
      zone === 'green'
        ? 'Green zone: the exception count is not unusual for a correct model.'
        : zone === 'yellow'
          ? 'Yellow zone: more exceptions than a correct model would usually produce. Under the Basel framework this attracts a capital add-on and an explanation.'
          : 'Red zone: the exception count is almost impossible for a correct model. The model is wrong, not unlucky.',
  };
}

export interface EsBacktestResult {
  observations: number;
  exceptions: number;
  /** Acerbi–Székely Z₂ statistic; 0 under a correct model, positive when ES is understated. */
  z2: number;
  exactness: Exactness;
  interpretation: string;
  notes: string[];
}

/**
 * Acerbi–Székely (2014) Z₂ test for Expected Shortfall.
 *   Z₂ = Σ_t L_t·1{L_t > VaR_t} / (n(1−α)·ES_t) − 1
 * Z₂ ≈ 0 under a correct model and Z₂ > 0 when ES is understated. Its
 * distribution is not standard: a p-value requires simulating from the
 * predictive distributions, so none is invented here.
 */
export function esBacktestZ2(losses: ArrayLike<number>, varForecasts: ArrayLike<number>, esForecasts: ArrayLike<number>, level: number): EsBacktestResult {
  const n = losses.length;
  if (n < 10) throw new EngineError(`At least 10 observations are needed for an ES backtest; received ${n}.`, 'insufficient');
  if (varForecasts.length !== n || esForecasts.length !== n) throw new EngineError('One VaR and one ES forecast is needed for each observation.', 'shape');
  assertLevel(level);
  let acc = 0;
  let exceptions = 0;
  for (let t = 0; t < n; t++) {
    if (!(esForecasts[t] > 0)) {
      throw new EngineError(`The ES forecast at observation ${t + 1} is ${esForecasts[t]}; the Z₂ statistic divides by it, so it must be greater than 0. With losses that can be negative, shift the convention or use an absolute test.`, 'range');
    }
    if (losses[t] > varForecasts[t]) {
      exceptions++;
      acc += losses[t] / esForecasts[t];
    }
  }
  const z2 = acc / (n * (1 - level)) - 1;
  return {
    observations: n,
    exceptions,
    z2,
    exactness: 'empirical',
    interpretation:
      z2 > 0.1
        ? `Z₂ = ${z2.toPrecision(3)} > 0: the realised tail losses are larger than the predicted Expected Shortfall, so the model understates tail severity.`
        : z2 < -0.1
          ? `Z₂ = ${z2.toPrecision(3)} < 0: the realised tail losses are smaller than predicted, so the model overstates tail severity.`
          : `Z₂ = ${z2.toPrecision(3)}, close to 0, which is what a correct model gives.`,
    notes: [
      'No p-value is reported because the distribution of Z₂ depends on the predicted distributions; obtaining one requires simulating from them. A fabricated p-value here would be worse than none.',
      'This is the practical cost of ES not being elicitable: the test needs the whole predicted distribution, not just an exception indicator, and it has less power than a VaR exception test on the same data.',
      `The statistic rests on the ${exceptions} exceptions only. With few exceptions it is very noisy.`,
    ],
  };
}

export interface VarBacktestReport {
  level: number;
  observations: number;
  exceptions: number;
  kupiec: KupiecResult;
  christoffersen: ChristoffersenResult;
  trafficLight: TrafficLightResult;
  exceedances: boolean[];
  notes: string[];
}

/** Run the full VaR backtest suite on a realised loss series against its forecasts. */
export function backtestVar(losses: ArrayLike<number>, varForecasts: ArrayLike<number>, level: number): VarBacktestReport {
  const n = losses.length;
  if (varForecasts.length !== n) throw new EngineError(`${varForecasts.length} VaR forecasts were given for ${n} realised losses.`, 'shape');
  assertLevel(level);
  if (n < 10) throw new EngineError(`At least 10 observations are needed to backtest a VaR model; received ${n}.`, 'insufficient');
  const exceedances: boolean[] = [];
  for (let t = 0; t < n; t++) {
    if (!Number.isFinite(losses[t]) || !Number.isFinite(varForecasts[t])) throw new EngineError(`Observation ${t + 1} has a non-finite loss or forecast.`, 'finite');
    exceedances.push(losses[t] > varForecasts[t]);
  }
  const exceptions = exceedances.filter(Boolean).length;
  return {
    level,
    observations: n,
    exceptions,
    kupiec: kupiecTest(exceptions, n, 1 - level),
    christoffersen: christoffersenTest(exceedances, 1 - level),
    trafficLight: trafficLightTest(exceptions, n, 1 - level),
    exceedances,
    notes: [
      'A VaR model that has never been backtested is an unverified claim. These tests are the minimum.',
      'The unconditional test asks whether the exception RATE is right; the independence test asks whether exceptions arrive in clusters. A model can pass the first and fail the second, and that failure is the dangerous one.',
      'All three tests are low-powered on short series. Failing to reject a model after one year of daily data is weak evidence in its favour.',
    ],
  };
}

/** Helper: solve Σx = b, exposed for factor-model work. Returns null when singular. */
export function solveLinear(a: Matrix, b: number[]): number[] | null {
  return solve(a, b);
}

/** Portfolio variance helper used by the stress reports. */
export function portfolioVariance(sigma: Matrix, weights: number[]): number {
  return quadraticForm(sigma, weights);
}

export { stableSum };
