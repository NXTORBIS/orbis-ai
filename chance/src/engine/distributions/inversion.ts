/**
 * Generic numerical quantile inversion used by distributions without a
 * closed-form inverse CDF.
 */
import { brentRoot } from '../core/numeric';
import { EngineError } from '../core/result';

type Fn = (x: number) => number;

/**
 * Validate a quantile level. Closed-form quantiles need this as much as the
 * numerical ones: without it, q outside [0, 1] silently produces a value
 * outside the support (uniform.quantile(1.5) returned 1.5) or NaN.
 */
export function assertQuantileLevel(q: number): void {
  if (!(q >= 0 && q <= 1)) {
    throw new EngineError(`Quantile level must be between 0 and 1; received ${q}.`, 'range');
  }
}

/**
 * Continuous quantile by Brent's method. For q > 0.5 the survival function is
 * inverted instead of the CDF so that upper-tail quantiles keep full precision.
 */
export function invertContinuous(
  q: number,
  cdf: Fn,
  sf: Fn,
  support: { min: number; max: number },
  guess: { center: number; scale: number },
): number {
  if (q < 0 || q > 1 || Number.isNaN(q)) throw new EngineError('Quantile level must be between 0 and 1.', 'range');
  if (q === 0) return support.min;
  if (q === 1) return support.max;
  const useSf = q > 0.5;
  const target = useSf ? 1 - q : q;
  const g = useSf ? (x: number) => target - sf(x) : (x: number) => cdf(x) - target;
  // Bracket expansion starting from the guess.
  const scale = guess.scale > 0 && Number.isFinite(guess.scale) ? guess.scale : 1;
  let lo = Number.isFinite(support.min) ? support.min : guess.center - scale;
  let hi = Number.isFinite(support.max) ? support.max : guess.center + scale;
  if (!Number.isFinite(support.min)) {
    let step = scale;
    for (let i = 0; i < 2000 && g(lo) > 0; i++) {
      lo -= step;
      step *= 2;
    }
  }
  if (!Number.isFinite(support.max)) {
    let step = scale;
    for (let i = 0; i < 2000 && g(hi) < 0; i++) {
      hi += step;
      step *= 2;
    }
  }
  // Tighten: for semi-infinite support starting at 0, try a geometric bracket near 0 first
  // so that tiny quantiles are located with relative precision.
  if (support.min === 0 && g(Math.min(hi, guess.center)) > 0) {
    let h = Math.min(hi, guess.center);
    let l = h / 2;
    for (let i = 0; i < 1100 && g(l) > 0; i++) {
      h = l;
      l /= 2;
    }
    if (g(l) <= 0) {
      lo = l;
      hi = h;
    }
  }
  // Brent already applies a relative tolerance of 2·ε·|b| at each step. Adding
  // an absolute floor scaled to the *bracket* would swamp a root many orders of
  // magnitude smaller than the bracket — as happens for a gamma distribution
  // with a tiny shape parameter, whose median can be around 1e-302. Passing the
  // smallest positive double lets the relative term govern instead.
  return brentRoot(g, lo, hi, { tol: Number.MIN_VALUE, maxIter: 500 });
}

/**
 * Discrete generalised inverse: the smallest integer k in the support with
 * F(k) ≥ q, found by exponential search then bisection.
 *
 * The comparison is exact against the computed CDF — no tolerance is applied
 * to q. An earlier version allowed a relative slack of 1e-12, which looks
 * harmless but is a tolerance on a *probability* that behaves like a
 * tolerance on a *count*: for a support of n values it shifts the answer
 * whenever q lies within 1e-12·n counts of a jump, returning the integer
 * below the correct one. Comparing exactly matches the definition and agrees
 * with SciPy.
 *
 * The result is therefore the generalised inverse of the CDF *as computed*.
 * Where q falls within the CDF's own numerical error of a jump (around 1e-15
 * relative) the answer can differ by one from the exact mathematical inverse;
 * that is inherent to evaluating the CDF in floating point.
 *
 * The upper tail is inverted through the survival function so that quantiles
 * close to 1 keep their precision.
 */
export function invertDiscrete(
  q: number,
  cdf: Fn,
  sf: Fn,
  support: { min: number; max: number },
  start: number,
): number {
  if (q < 0 || q > 1 || Number.isNaN(q)) throw new EngineError('Quantile level must be between 0 and 1.', 'range');
  if (q === 0) return support.min;
  const reached = q > 0.5 ? (k: number) => sf(k) <= 1 - q : (k: number) => cdf(k) >= q;
  if (q === 1) {
    // With unbounded support no finite value attains probability 1.
    return support.max;
  }
  let lo = support.min;
  let hi = Math.min(support.max, Math.max(lo, Math.round(start)));
  if (reached(lo)) return lo;
  // Exponential search for an upper bound.
  let step = Math.max(1, Math.abs(hi - lo));
  while (!reached(hi)) {
    lo = hi;
    hi = Math.min(support.max, hi + step);
    step *= 2;
    if (hi === support.max && !reached(hi)) return support.max;
    if (!Number.isFinite(hi) || step > 2 ** 52) throw new EngineError('Quantile search did not converge.', 'numerical');
  }
  // Invariant: !reached(lo) (or lo === support.min handled), reached(hi).
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (reached(mid)) hi = mid;
    else lo = mid;
  }
  return reached(lo) ? lo : hi;
}
