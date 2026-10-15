/**
 * Semi-parametric tail index estimators.
 *
 * Both estimate the extreme value index ξ = 1/α for a heavy (regularly
 * varying) tail, using only the k largest observations.
 *
 *  - Hill (1975): ξ̂_k = (1/k) Σ_{i=1..k} ln(X_(i)/X_(k+1)) with X_(1) ≥ … ≥ X_(n).
 *    Valid only for ξ > 0 and strictly positive data; it cannot detect a light
 *    or bounded tail, so a Hill estimate near zero is not evidence of ξ = 0.
 *  - Pickands (1975): ξ̂_k = ln((X_(k) − X_(2k))/(X_(2k) − X_(4k)))/ln 2, which
 *    works for any sign of ξ but is noisier.
 *
 * Both are consistent as k → ∞ with k/n → 0, and both have a bias/variance
 * trade-off in k exactly like the POT threshold: the Hill plot is there to be
 * looked at, not to produce one number automatically.
 */
import { type EngineResult, type Explanation, fail, ok } from '../core/result';
import { normalQuantile } from '../special/gamma';

function descending(data: ArrayLike<number>): number[] {
  const values: number[] = [];
  for (let i = 0; i < data.length; i++) if (Number.isFinite(data[i])) values.push(data[i]);
  return values.sort((a, b) => b - a);
}

export interface TailIndexEstimate {
  /** Number of upper order statistics used. */
  k: number;
  /** ξ̂, the extreme value (tail) index. */
  tailIndex: number;
  /** α̂ = 1/ξ̂, the Pareto tail exponent; null when ξ̂ ≤ 0. */
  paretoExponent: number | null;
  /** Asymptotic standard error ξ̂/√k (Hill only); null for Pickands. */
  standardError: number | null;
  /** Asymptotic confidence limits, when a standard error is available. */
  lower: number | null;
  upper: number | null;
  estimator: 'hill' | 'pickands';
  explanation: Explanation;
}

/** Hill estimator of ξ from the k largest of strictly positive observations. */
export function hillEstimator(
  data: ArrayLike<number>,
  k: number,
  options: { level?: number } = {},
): EngineResult<TailIndexEstimate> {
  const sorted = descending(data);
  const n = sorted.length;
  if (!Number.isInteger(k) || k < 2) {
    return fail('The Hill estimator needs k to be a whole number of at least 2.');
  }
  if (k >= n) {
    return fail(`The Hill estimator needs k < n: k = ${k} was requested but only ${n} usable observations exist.`);
  }
  if (!(sorted[k] > 0)) {
    return fail(
      'The Hill estimator requires strictly positive observations in the tail (it works on log ratios). Shift the data so the tail is positive, or use the Pickands estimator, which does not need this.',
    );
  }
  const logThreshold = Math.log(sorted[k]);
  let sum = 0;
  for (let i = 0; i < k; i++) sum += Math.log(sorted[i]) - logThreshold;
  const xi = sum / k;
  if (!Number.isFinite(xi)) return fail('The Hill estimator produced a non-finite value; the tail data are degenerate.');
  const se = xi / Math.sqrt(k);
  const level = options.level ?? 0.95;
  const z = normalQuantile((1 + level) / 2);
  return ok({
    k,
    tailIndex: xi,
    paretoExponent: xi > 0 ? 1 / xi : null,
    standardError: se,
    lower: xi - z * se,
    upper: xi + z * se,
    estimator: 'hill',
    explanation: {
      method: 'Hill estimator of the tail index',
      formula: 'ξ̂_k = (1/k) Σ_{i=1..k} ln(X_(i) / X_(k+1)), with X_(1) ≥ … ≥ X_(n)',
      steps: [
        { label: 'Order statistics used', value: String(k) },
        { label: 'Anchor X_(k+1)', value: sorted[k].toPrecision(6) },
        { label: 'ξ̂', value: xi.toPrecision(6) },
        { label: 'α̂ = 1/ξ̂', value: xi > 0 ? (1 / xi).toPrecision(6) : 'undefined for ξ̂ ≤ 0' },
      ],
      assumptions: [
        'The tail is regularly varying with a positive index (Pareto-type).',
        'The observations in the tail are independent.',
      ],
      limitations: [
        'The Hill estimator assumes ξ > 0 by construction. It cannot report a light or bounded tail, so a small value is not evidence against one.',
        'The answer depends on k. The standard error ξ̂/√k ignores the bias that grows as k grows: read the Hill plot rather than one k.',
      ],
      exactness: 'numerical',
    },
  });
}

/** Pickands estimator of ξ; works for any sign of ξ and needs 4k ≤ n. */
export function pickandsEstimator(data: ArrayLike<number>, k: number): EngineResult<TailIndexEstimate> {
  const sorted = descending(data);
  const n = sorted.length;
  if (!Number.isInteger(k) || k < 1) return fail('The Pickands estimator needs k to be a whole number of at least 1.');
  if (4 * k > n) {
    return fail(
      `The Pickands estimator needs 4k ≤ n: k = ${k} requires at least ${4 * k} observations but only ${n} are usable.`,
    );
  }
  // 1-based order statistics X_(k), X_(2k), X_(4k) from the descending list.
  const xk = sorted[k - 1];
  const x2k = sorted[2 * k - 1];
  const x4k = sorted[4 * k - 1];
  const numerator = xk - x2k;
  const denominator = x2k - x4k;
  if (!(numerator > 0) || !(denominator > 0)) {
    return fail(
      `The Pickands estimator needs X_(k) > X_(2k) > X_(4k) with strict gaps; at k = ${k} the spacings are ${numerator} and ${denominator} (ties in the tail). Choose a different k.`,
    );
  }
  const xi = Math.log(numerator / denominator) / Math.LN2;
  if (!Number.isFinite(xi)) return fail('The Pickands estimator produced a non-finite value.');
  return ok({
    k,
    tailIndex: xi,
    paretoExponent: xi > 0 ? 1 / xi : null,
    standardError: null,
    lower: null,
    upper: null,
    estimator: 'pickands',
    explanation: {
      method: 'Pickands estimator of the tail index',
      formula: 'ξ̂_k = ln((X_(k) − X_(2k)) / (X_(2k) − X_(4k))) / ln 2',
      steps: [
        { label: 'k', value: String(k) },
        { label: 'X_(k), X_(2k), X_(4k)', value: `${xk.toPrecision(6)}, ${x2k.toPrecision(6)}, ${x4k.toPrecision(6)}` },
        { label: 'ξ̂', value: xi.toPrecision(6) },
      ],
      assumptions: ['The upper tail is in the domain of attraction of an extreme value distribution.'],
      limitations: [
        'Based on three order statistics only, so it is considerably noisier than the Hill or maximum-likelihood estimators.',
        'No closed-form standard error is reported here; none is computed, rather than a plausible-looking one being supplied.',
      ],
      exactness: 'numerical',
    },
  });
}

export interface TailIndexPlotPoint {
  k: number;
  tailIndex: number;
  lower: number | null;
  upper: number | null;
}

export interface TailIndexPlot {
  points: TailIndexPlotPoint[];
  estimator: 'hill' | 'pickands';
  skipped: { k: number; reason: string }[];
  explanation: Explanation;
}

/** Hill plot data: ξ̂_k against k, with asymptotic limits. */
export function hillPlot(
  data: ArrayLike<number>,
  options: { kMin?: number; kMax?: number; level?: number } = {},
): EngineResult<TailIndexPlot> {
  const sorted = descending(data);
  const n = sorted.length;
  if (n < 20) return fail(`A Hill plot needs at least 20 usable observations; ${n} were supplied.`);
  const kMin = options.kMin ?? 5;
  const kMax = Math.min(options.kMax ?? Math.floor(n / 2), n - 1);
  if (kMax <= kMin) return fail(`The Hill plot range is empty: kMin = ${kMin}, kMax = ${kMax}.`);
  const points: TailIndexPlotPoint[] = [];
  const skipped: { k: number; reason: string }[] = [];
  for (let k = kMin; k <= kMax; k++) {
    const e = hillEstimator(sorted, k, { level: options.level });
    if (!e.ok) {
      skipped.push({ k, reason: e.errors.map((i) => i.message).join(' ') });
      continue;
    }
    points.push({ k, tailIndex: e.value.tailIndex, lower: e.value.lower, upper: e.value.upper });
  }
  if (points.length === 0) return fail('No value of k produced a Hill estimate, so no Hill plot can be drawn.');
  return ok({
    points,
    estimator: 'hill',
    skipped,
    explanation: {
      method: 'Hill plot: the Hill estimate of ξ against the number of upper order statistics k',
      steps: [
        { label: 'k range', value: `${points[0].k} to ${points[points.length - 1].k}` },
        { label: 'Observations', value: String(n) },
      ],
      assumptions: ['Positive, regularly varying upper tail with ξ > 0.'],
      limitations: [
        'Read the plot for a region where the estimate is level. Small k is noisy, large k is biased; there is no automatic choice.',
        'Successive points share nearly all their data, so the curve is smooth by construction.',
      ],
      exactness: 'numerical',
    },
  });
}
