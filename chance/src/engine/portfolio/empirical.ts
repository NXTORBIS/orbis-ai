/**
 * Risk functionals of an *empirical* loss distribution (a finite, equally
 * weighted set of scenarios), plus the order-statistic weight vectors that make
 * them spectral measures.
 *
 * Loss convention (the same as `engine/risk/risk.ts`): a loss is a **positive**
 * number and a gain is negative. Value at Risk at level α is the α-quantile of
 * the loss distribution.
 *
 * Definitions used here are the ones that are exact for a discrete
 * distribution, not interpolated approximations:
 *
 *   VaR_α(L) = inf{x : F(x) ≥ α} = x_(⌈αn⌉)        (an actual scenario value)
 *   ES_α(L)  = (1/(1−α)) ∫_α^1 q(u) du             (exact for the step quantile)
 *
 * The integral form matters: with n(1−α) not a whole number, the plain average
 * of the ⌈n(1−α)⌉ worst scenarios is *not* ES, and the difference is exactly
 * where empirical ES implementations usually disagree.
 */
import { EngineError } from '../core/result';
import { brentRoot, logSumExp, stableSum } from '../core/numeric';

export function assertLevel(alpha: number, field = 'level'): void {
  if (!Number.isFinite(alpha) || !(alpha > 0) || !(alpha < 1)) {
    throw new EngineError(`The confidence ${field} must be greater than 0 and less than 1; received ${alpha}.`, 'range');
  }
}

export function assertSorted(sorted: ArrayLike<number>, min = 1): void {
  if (sorted.length < min) {
    throw new EngineError(`At least ${min} scenario${min === 1 ? '' : 's'} are needed; received ${sorted.length}.`, 'insufficient');
  }
  for (let i = 0; i < sorted.length; i++) {
    if (!Number.isFinite(sorted[i])) throw new EngineError('Every scenario loss must be a finite number.', 'finite');
  }
}

/**
 * Weights on the ascending order statistics x_(1) … x_(n) such that
 * Σ wᵢ x_(i) = (1/(b−a)) ∫_a^b q(u) du, where q is the empirical quantile
 * function. Exact — the empirical quantile is a step function, so the integral
 * is the overlap of each step with (a, b].
 */
export function quantileIntegralWeights(n: number, a: number, b: number): Float64Array {
  if (!(b > a)) throw new EngineError(`The probability range must satisfy a < b; received a = ${a}, b = ${b}.`, 'range');
  if (a < 0 || b > 1) throw new EngineError(`The probability range must lie inside [0, 1]; received [${a}, ${b}].`, 'range');
  const w = new Float64Array(n);
  const span = b - a;
  for (let i = 0; i < n; i++) {
    const lo = i / n;
    const hi = (i + 1) / n;
    const overlap = Math.min(hi, b) - Math.max(lo, a);
    if (overlap > 0) w[i] = overlap / span;
  }
  return w;
}

/**
 * Weights on the ascending order statistics for the distortion risk measure
 * ρ_g(L) = ∫_0^1 q(u) dg̃(u) with g applied to the exceedance probability.
 * g must be increasing with g(0) = 0 and g(1) = 1; g concave ⟺ the measure is
 * coherent.
 */
export function distortionWeights(n: number, g: (t: number) => number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // Order statistic i (0-based) covers u ∈ (i/n, (i+1)/n]; its exceedance
    // probabilities run from 1 − i/n down to 1 − (i+1)/n.
    w[i] = g(1 - i / n) - g(1 - (i + 1) / n);
  }
  return w;
}

export function applyWeights(sorted: ArrayLike<number>, weights: ArrayLike<number>): number {
  const terms = new Float64Array(sorted.length);
  for (let i = 0; i < sorted.length; i++) terms[i] = sorted[i] * weights[i];
  return stableSum(terms);
}

/** VaR of the empirical distribution: the ⌈αn⌉-th smallest loss. */
export function empiricalVar(sorted: ArrayLike<number>, alpha: number): number {
  assertLevel(alpha);
  assertSorted(sorted);
  const n = sorted.length;
  const idx = Math.min(n - 1, Math.max(0, Math.ceil(alpha * n) - 1));
  return sorted[idx];
}

/** Number of scenarios strictly beyond VaR_α — reported so a thin tail is visible. */
export function tailCount(sorted: ArrayLike<number>, alpha: number): number {
  const v = empiricalVar(sorted, alpha);
  let c = 0;
  for (let i = 0; i < sorted.length; i++) if (sorted[i] >= v) c++;
  return c;
}

/** Exact ES of the empirical distribution. */
export function empiricalEs(sorted: ArrayLike<number>, alpha: number): number {
  assertLevel(alpha);
  assertSorted(sorted);
  return applyWeights(sorted, quantileIntegralWeights(sorted.length, alpha, 1));
}

/** Left-tail VaR (the "best case" counterpart of ES): (1/α)∫_0^α q(u) du. */
export function empiricalLeftTailVar(sorted: ArrayLike<number>, alpha: number): number {
  assertLevel(alpha);
  assertSorted(sorted);
  return applyWeights(sorted, quantileIntegralWeights(sorted.length, 0, alpha));
}

/** Range Value at Risk: the average quantile over (α, β). */
export function empiricalRangeVar(sorted: ArrayLike<number>, alpha: number, beta: number): number {
  assertSorted(sorted);
  if (!(alpha >= 0 && beta <= 1 && beta > alpha)) {
    throw new EngineError(`Range VaR needs 0 ≤ α < β ≤ 1; received α = ${alpha}, β = ${beta}.`, 'range');
  }
  return applyWeights(sorted, quantileIntegralWeights(sorted.length, alpha, beta));
}

/** Median shortfall: the median of the losses beyond VaR_α, i.e. VaR_{(1+α)/2}. */
export function empiricalMedianShortfall(sorted: ArrayLike<number>, alpha: number): number {
  assertLevel(alpha);
  return empiricalVar(sorted, (1 + alpha) / 2);
}

/** Entropic risk measure (1/θ)·log E[e^{θL}], computed in log space. */
export function empiricalEntropic(sorted: ArrayLike<number>, theta: number): number {
  assertSorted(sorted);
  if (!(theta > 0)) throw new EngineError(`The entropic risk aversion θ must be greater than 0; received ${theta}.`, 'range');
  const n = sorted.length;
  const scaled = new Float64Array(n);
  for (let i = 0; i < n; i++) scaled[i] = theta * sorted[i];
  const ls = logSumExp(scaled);
  if (!Number.isFinite(ls)) {
    throw new EngineError(
      `The entropic risk measure overflowed at θ = ${theta}: the exponential moment E[e^{θL}] is not representable for these losses. Reduce θ.`,
      'numerical',
    );
  }
  return (ls - Math.log(n)) / theta;
}

/**
 * τ-expectile: the unique solution of τ·E[(L − e)₊] = (1 − τ)·E[(e − L)₊].
 * e_{1/2} is exactly the mean; e_τ is coherent for τ ≥ 1/2, and it is the only
 * coherent risk measure that is also elicitable.
 */
export function empiricalExpectile(sorted: ArrayLike<number>, tau: number): number {
  assertSorted(sorted);
  if (!(tau > 0 && tau < 1)) throw new EngineError(`The expectile level τ must be strictly between 0 and 1; received ${tau}.`, 'range');
  const n = sorted.length;
  const lo = sorted[0];
  const hi = sorted[n - 1];
  if (hi === lo) return lo;
  const h = (e: number): number => {
    let up = 0;
    let down = 0;
    for (let i = 0; i < n; i++) {
      const d = sorted[i] - e;
      if (d > 0) up += d;
      else down -= d;
    }
    return tau * up - (1 - tau) * down;
  };
  // h is continuous, strictly decreasing, h(min) ≥ 0 ≥ h(max): the bracket is
  // guaranteed, so no fallback value is ever invented.
  return brentRoot(h, lo, hi, { tol: 1e-15 });
}

export function sampleMean(sorted: ArrayLike<number>): number {
  assertSorted(sorted);
  const a = Float64Array.from(sorted as ArrayLike<number>);
  return stableSum(a) / a.length;
}

/** Population standard deviation (the spread of the scenario distribution itself). */
export function populationSd(sorted: ArrayLike<number>): number {
  const m = sampleMean(sorted);
  let s = 0;
  for (let i = 0; i < sorted.length; i++) s += (sorted[i] - m) * (sorted[i] - m);
  return Math.sqrt(s / sorted.length);
}

/** Upper semideviation: √E[((L − E L)₊)²] — only losses above the mean count. */
export function upperSemideviation(sorted: ArrayLike<number>): number {
  const m = sampleMean(sorted);
  let s = 0;
  for (let i = 0; i < sorted.length; i++) {
    const d = sorted[i] - m;
    if (d > 0) s += d * d;
  }
  return Math.sqrt(s / sorted.length);
}
