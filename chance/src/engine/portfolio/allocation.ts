/**
 * Risk allocation: which exposure is responsible for the portfolio's risk?
 *
 * For a positively homogeneous measure ρ, Euler's theorem gives
 *     ρ(w) = Σᵢ wᵢ ∂ρ/∂wᵢ,
 * so the gradient terms are the unique allocation that adds up to the total and
 * satisfies the usual fairness requirements (full allocation, and consistency
 * with the risk-adjusted performance of each exposure). For a spectral measure
 * the derivative is a weighted tail average of the exposure's own losses, and
 * the allocation adds up to the total **exactly** — which is asserted in the
 * tests, because an allocation that does not add up is not an allocation.
 *
 * Three distinct quantities are kept apart here, because they are routinely
 * conflated:
 *
 *   component risk   wᵢ·∂ρ/∂wᵢ — the exposure's share of the total. Adds up.
 *   marginal risk    ∂ρ/∂wᵢ — the effect of a *small* increase in the
 *                    exposure, per unit. Does not add up to anything.
 *   incremental risk ρ(portfolio) − ρ(portfolio without exposure i) — the
 *                    effect of removing the exposure *entirely*. Does NOT add
 *                    up to the total, and generally understates each part,
 *                    because removing one exposure changes which scenarios are
 *                    in the tail.
 */
import { EngineError, type Exactness } from '../core/result';
import { stableSum } from '../core/numeric';
import { quadraticForm, type CovarianceCheck } from './numerics';
import { checkCovariance } from './numerics';
import type { Matrix } from '../stats/linalg';
import type { RiskMeasure } from './measures';
import { populationSd } from './empirical';
import { normalQuantile } from '../special/gamma';

export interface ScenarioSet {
  /** scenarios[s][i] = loss of exposure i in scenario s (positive = loss). */
  scenarios: number[][];
  /** Exposure labels. */
  labels: string[];
}

export function makeScenarioSet(scenarios: number[][], labels?: string[]): ScenarioSet {
  if (!scenarios.length) throw new EngineError('At least one scenario is required.', 'required');
  const d = scenarios[0].length;
  if (!d) throw new EngineError('Each scenario must contain at least one exposure.', 'required');
  for (let s = 0; s < scenarios.length; s++) {
    if (scenarios[s].length !== d) {
      throw new EngineError(`Scenario ${s + 1} has ${scenarios[s].length} exposures but scenario 1 has ${d}. Every scenario must cover the same exposures.`, 'shape');
    }
    for (let i = 0; i < d; i++) {
      if (!Number.isFinite(scenarios[s][i])) throw new EngineError(`Scenario ${s + 1}, exposure ${i + 1} is not a finite number.`, 'finite');
    }
  }
  const lab = labels ?? Array.from({ length: d }, (_, i) => `Exposure ${i + 1}`);
  if (lab.length !== d) throw new EngineError(`${lab.length} labels were given for ${d} exposures.`, 'shape');
  return { scenarios, labels: lab };
}

export function portfolioLosses(set: ScenarioSet, weights: number[]): Float64Array {
  const d = set.labels.length;
  if (weights.length !== d) throw new EngineError(`${weights.length} weights were given for ${d} exposures.`, 'shape');
  for (const w of weights) if (!Number.isFinite(w)) throw new EngineError('Every weight must be a finite number.', 'finite');
  const out = new Float64Array(set.scenarios.length);
  for (let s = 0; s < set.scenarios.length; s++) {
    let acc = 0;
    for (let i = 0; i < d; i++) acc += weights[i] * set.scenarios[s][i];
    out[s] = acc;
  }
  return out;
}

export interface AllocationResult {
  measureId: string;
  measureName: string;
  labels: string[];
  weights: number[];
  /** wᵢ·∂ρ/∂wᵢ — adds up to `total`. */
  componentRisk: number[];
  /** ∂ρ/∂wᵢ — per unit of exposure. */
  marginalRisk: number[];
  /** Share of the total, as a fraction. */
  share: number[];
  total: number;
  sumOfComponents: number;
  /** total − Σ components. Exactly 0 up to floating point for a spectral measure. */
  residual: number;
  method: string;
  exactness: Exactness;
  notes: string[];
}

function sortedIndices(losses: Float64Array): number[] {
  return Array.from({ length: losses.length }, (_, i) => i).sort((a, b) => losses[a] - losses[b]);
}

/**
 * Euler / gradient allocation of a spectral risk measure (ES, Range VaR, Wang,
 * proportional hazards, …). Exact: the component figures are the same weighted
 * combination of scenarios as the total, so they add up to it identically.
 */
export function eulerAllocation(set: ScenarioSet, weights: number[], measure: RiskMeasure): AllocationResult {
  const losses = portfolioLosses(set, weights);
  const n = losses.length;
  const spec = measure.spectralWeights(n);
  if (!spec) {
    throw new EngineError(
      `${measure.name} is not a spectral risk measure, so it has no tail-average gradient and no exact Euler allocation. Value at Risk is allocated with componentValueAtRisk (a single-scenario derivative); the entropic and mean–variance functionals need their own gradients.`,
      'unsupported',
    );
  }
  const order = sortedIndices(losses);
  const d = set.labels.length;
  const component = new Array<number>(d).fill(0);
  for (let r = 0; r < n; r++) {
    const wr = spec[r];
    if (wr === 0) continue;
    const row = set.scenarios[order[r]];
    for (let i = 0; i < d; i++) component[i] += wr * row[i];
  }
  const componentRisk = component.map((c, i) => weights[i] * c);
  const total = measure.evaluate(Float64Array.from(order.map((o) => losses[o])));
  const sum = stableSum(componentRisk);
  return {
    measureId: measure.id,
    measureName: measure.name,
    labels: set.labels,
    weights: [...weights],
    componentRisk,
    marginalRisk: component,
    share: componentRisk.map((c) => (total !== 0 ? c / total : NaN)),
    total,
    sumOfComponents: sum,
    residual: total - sum,
    method:
      'Euler allocation: ∂ρ/∂wᵢ = Σ_s φ(s)·Xᵢ(s) with the same spectral weights φ that define ρ, evaluated on scenarios ordered by portfolio loss. The decomposition is an identity, so it adds up exactly.',
    exactness: 'empirical',
    notes: [
      'The allocation is a decomposition of THIS portfolio\'s risk at THESE weights. It is not what the risk would be if an exposure were removed — see incrementalRiskContributions for that.',
      'Each component depends on which scenarios are in the tail, so with few tail scenarios the allocation is unstable even when the total is not.',
      'A negative component means the exposure pays off in the scenarios that hurt the portfolio: it is a hedge at the current weights.',
    ],
  };
}

export interface ComponentVarResult extends AllocationResult {
  level: number;
  /** The scenario whose portfolio loss equals VaR; the allocation is read off it. */
  varScenarioIndex: number;
  /** A smoothed version averaging scenarios near the VaR, and its own residual. */
  smoothed: { componentRisk: number[]; scenariosUsed: number; sumOfComponents: number; residual: number };
}

/**
 * Component VaR. Because VaR is the loss in one particular scenario, its
 * gradient is that scenario's exposure losses, and the components add to VaR
 * exactly. They are also extremely noisy — one scenario decides everything —
 * so a neighbourhood-averaged version is reported alongside, with its own
 * residual shown rather than rescaled away.
 */
export function componentValueAtRisk(set: ScenarioSet, weights: number[], level: number, smoothingWindow = 0.01): ComponentVarResult {
  if (!(level > 0 && level < 1)) throw new EngineError(`The confidence level must be strictly between 0 and 1; received ${level}.`, 'range');
  const losses = portfolioLosses(set, weights);
  const n = losses.length;
  const order = sortedIndices(losses);
  const k = Math.min(n - 1, Math.max(0, Math.ceil(level * n) - 1));
  const idx = order[k];
  const d = set.labels.length;
  const marginal = set.scenarios[idx].slice();
  const componentRisk = marginal.map((x, i) => weights[i] * x);
  const total = losses[idx];
  const half = Math.max(1, Math.round(smoothingWindow * n));
  const lo = Math.max(0, k - half);
  const hi = Math.min(n - 1, k + half);
  const smooth = new Array<number>(d).fill(0);
  for (let r = lo; r <= hi; r++) {
    const row = set.scenarios[order[r]];
    for (let i = 0; i < d; i++) smooth[i] += row[i] / (hi - lo + 1);
  }
  const smoothComponent = smooth.map((x, i) => weights[i] * x);
  const smoothSum = stableSum(smoothComponent);
  return {
    measureId: 'var',
    measureName: `Value at Risk at ${(level * 100).toPrecision(4)}%`,
    labels: set.labels,
    weights: [...weights],
    componentRisk,
    marginalRisk: marginal,
    share: componentRisk.map((c) => (total !== 0 ? c / total : NaN)),
    total,
    sumOfComponents: stableSum(componentRisk),
    residual: total - stableSum(componentRisk),
    level,
    varScenarioIndex: idx,
    smoothed: { componentRisk: smoothComponent, scenariosUsed: hi - lo + 1, sumOfComponents: smoothSum, residual: total - smoothSum },
    method:
      'Component VaR: ∂VaR/∂wᵢ = E[Xᵢ | L = VaR], estimated by the single scenario whose portfolio loss is the VaR order statistic. The components therefore add to VaR exactly.',
    exactness: 'empirical',
    notes: [
      'This allocation rests on ONE scenario. Re-running with a different seed, or adding scenarios, can change it completely while barely moving the total.',
      'The smoothed figures average the scenarios around the VaR. They are more stable but no longer add exactly to VaR; the residual is reported rather than hidden by rescaling.',
      'Because VaR is not subadditive, its "allocation" can be perverse: an exposure can be assigned a negative component while genuinely increasing the risk of the whole.',
    ],
  };
}

export interface IncrementalResult {
  labels: string[];
  measureName: string;
  total: number;
  /** ρ(all) − ρ(all but i). */
  incremental: number[];
  /** wᵢ·∂ρ/∂wᵢ, for comparison. */
  component: number[] | null;
  sumOfIncremental: number;
  /** Σ incremental − total. Non-zero by nature; this is the point of the comparison. */
  additivityGap: number;
  notes: string[];
}

/**
 * Incremental contributions: the change in risk from removing each exposure
 * entirely. These do **not** add up to the total, and the gap is reported.
 */
export function incrementalRiskContributions(set: ScenarioSet, weights: number[], measure: RiskMeasure): IncrementalResult {
  const d = set.labels.length;
  const full = measure.evaluate(sortedLosses(set, weights));
  const incremental = new Array<number>(d).fill(0);
  for (let i = 0; i < d; i++) {
    const w = weights.slice();
    w[i] = 0;
    incremental[i] = full - measure.evaluate(sortedLosses(set, w));
  }
  let component: number[] | null = null;
  if (measure.spectralWeights(set.scenarios.length)) component = eulerAllocation(set, weights, measure).componentRisk;
  const sum = stableSum(incremental);
  return {
    labels: set.labels,
    measureName: measure.name,
    total: full,
    incremental,
    component,
    sumOfIncremental: sum,
    additivityGap: sum - full,
    notes: [
      'Marginal (component) and incremental contributions answer different questions. The component figures are derivatives at the current weights and add up to the total; the incremental figures are the effect of a full removal and do not.',
      'For a subadditive measure the incremental contributions normally sum to LESS than the total: each exposure looks cheap on its own because the others still carry the tail.',
      'Quoting incremental contributions as if they were shares of the total — a common error — understates the risk of the portfolio.',
    ],
  };
}

function sortedLosses(set: ScenarioSet, weights: number[]): Float64Array {
  const l = portfolioLosses(set, weights);
  const copy = Float64Array.from(l);
  copy.sort();
  return copy;
}

export interface ShapleyResult {
  labels: string[];
  measureName: string;
  shapley: number[];
  total: number;
  sumOfShapley: number;
  residual: number;
  subsetsEvaluated: number;
  exactness: Exactness;
  method: string;
  notes: string[];
}

export const SHAPLEY_MAX_EXPOSURES = 16;

/**
 * Exact Shapley allocation by enumeration of all 2^d subsets. Refused above
 * `SHAPLEY_MAX_EXPOSURES` exposures rather than silently approximated — a
 * sampled Shapley value is a different quantity with its own error, and
 * presenting it as the exact one would be misleading.
 */
export function shapleyAllocation(set: ScenarioSet, weights: number[], measure: RiskMeasure): ShapleyResult {
  const d = set.labels.length;
  if (d > SHAPLEY_MAX_EXPOSURES) {
    throw new EngineError(
      `An exact Shapley allocation enumerates 2^${d} = ${Math.pow(2, d).toLocaleString('en-US')} subsets, which is beyond the supported limit of 2^${SHAPLEY_MAX_EXPOSURES}. Use the Euler allocation, which is exact for a spectral measure and costs one pass, or group the ${d} exposures into at most ${SHAPLEY_MAX_EXPOSURES} blocks.`,
      'limit',
    );
  }
  if (weights.length !== d) throw new EngineError(`${weights.length} weights were given for ${d} exposures.`, 'shape');
  const subsets = 1 << d;
  const value = new Float64Array(subsets);
  const scratch = new Array<number>(d).fill(0);
  for (let mask = 0; mask < subsets; mask++) {
    for (let i = 0; i < d; i++) scratch[i] = mask & (1 << i) ? weights[i] : 0;
    value[mask] = mask === 0 ? 0 : measure.evaluate(sortedLosses(set, scratch));
  }
  // Shapley: φᵢ = Σ_{S ⊆ N∖{i}} |S|!(d−|S|−1)!/d! · (v(S ∪ {i}) − v(S)).
  const logFact = new Float64Array(d + 1);
  for (let i = 1; i <= d; i++) logFact[i] = logFact[i - 1] + Math.log(i);
  const shapley = new Array<number>(d).fill(0);
  for (let i = 0; i < d; i++) {
    const bit = 1 << i;
    let acc = 0;
    for (let mask = 0; mask < subsets; mask++) {
      if (mask & bit) continue;
      const size = popcount(mask);
      const weight = Math.exp(logFact[size] + logFact[d - size - 1] - logFact[d]);
      acc += weight * (value[mask | bit] - value[mask]);
    }
    shapley[i] = acc;
  }
  const total = value[subsets - 1];
  const sum = stableSum(shapley);
  return {
    labels: set.labels,
    measureName: measure.name,
    shapley,
    total,
    sumOfShapley: sum,
    residual: total - sum,
    subsetsEvaluated: subsets,
    exactness: 'empirical',
    method: `Exact enumeration of all 2^${d} = ${subsets} sub-portfolios, averaging each exposure's marginal effect over every order of inclusion.`,
    notes: [
      'The Shapley value allocates the whole risk (efficiency), treats interchangeable exposures identically (symmetry) and gives a riskless exposure only its own figure (dummy). It is the unique allocation with those properties.',
      'Unlike the Euler allocation it does not depend on differentiability, so it applies to Value at Risk and to the entropic measure too.',
      'It costs 2^d evaluations, which is why it is a tool for a handful of blocks rather than for hundreds of positions.',
    ],
  };
}

function popcount(x: number): number {
  let c = 0;
  let v = x;
  while (v) {
    v &= v - 1;
    c++;
  }
  return c;
}

export interface GaussianAllocationResult {
  labels: string[];
  weights: number[];
  portfolioSd: number;
  /** wᵢ·(Σw)ᵢ/σ — adds to σ exactly. */
  componentSd: number[];
  marginalSd: number[];
  componentVar: number[];
  componentEs: number[];
  level: number;
  totalVar: number;
  totalEs: number;
  covarianceCheck: CovarianceCheck;
  exactness: Exactness;
  method: string;
  notes: string[];
}

/**
 * Closed-form Euler allocation under a normal model: every risk measure that is
 * a multiple of the standard deviation allocates in proportion to
 * wᵢ·(Σw)ᵢ/σ. Exact, and a useful check on the scenario-based allocation.
 */
export function gaussianEulerAllocation(sigma: Matrix, weights: number[], mu: number[], level: number): GaussianAllocationResult {
  const check = checkCovariance(sigma);
  if (weights.length !== check.n) throw new EngineError(`${weights.length} weights were given for a ${check.n}×${check.n} covariance matrix.`, 'shape');
  if (mu.length !== check.n) throw new EngineError(`${mu.length} expected losses were given for ${check.n} exposures.`, 'shape');
  if (!(level > 0 && level < 1)) throw new EngineError(`The confidence level must be strictly between 0 and 1; received ${level}.`, 'range');
  const sd = Math.sqrt(quadraticForm(sigma, weights));
  if (!(sd > 0)) throw new EngineError('The portfolio has zero variance at these weights, so no standard-deviation allocation is defined.', 'degenerate');
  const marginal = sigma.map((row) => row.reduce((a, v, j) => a + v * weights[j], 0) / sd);
  const componentSd = marginal.map((m, i) => weights[i] * m);
  const z = normalQuantile(level);
  const phi = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
  const esFactor = phi / (1 - level);
  const portfolioMean = mu.reduce((a, m, i) => a + m * weights[i], 0);
  return {
    labels: sigma.map((_, i) => `Exposure ${i + 1}`),
    weights: [...weights],
    portfolioSd: sd,
    componentSd,
    marginalSd: marginal,
    componentVar: componentSd.map((c, i) => weights[i] * mu[i] + z * c),
    componentEs: componentSd.map((c, i) => weights[i] * mu[i] + esFactor * c),
    level,
    totalVar: portfolioMean + z * sd,
    totalEs: portfolioMean + esFactor * sd,
    covarianceCheck: check,
    exactness: 'exact',
    method: 'Euler allocation under a normal model: ∂σ/∂wᵢ = (Σw)ᵢ/σ, VaR = μ_p + Φ⁻¹(α)·σ, ES = μ_p + φ(Φ⁻¹(α))/(1 − α)·σ. All closed form.',
    notes: [
      'This allocation inherits the normal assumption. If the real losses are skewed or heavy tailed it allocates the wrong amounts even when the total happens to look plausible.',
      'The components add exactly to the total because the standard deviation is positively homogeneous of degree 1 in the weights.',
    ],
  };
}

export function riskParityCheck(sigma: Matrix, weights: number[]): { componentShare: number[]; maxDeviation: number; portfolioSd: number } {
  const sd = Math.sqrt(quadraticForm(sigma, weights));
  const comp = sigma.map((row, i) => (weights[i] * row.reduce((a, v, j) => a + v * weights[j], 0)) / sd);
  const share = comp.map((c) => c / sd);
  const target = 1 / weights.length;
  return { componentShare: share, maxDeviation: Math.max(...share.map((s) => Math.abs(s - target))), portfolioSd: sd };
}

export function scenarioSd(set: ScenarioSet, weights: number[]): number {
  return populationSd(sortedLosses(set, weights));
}
