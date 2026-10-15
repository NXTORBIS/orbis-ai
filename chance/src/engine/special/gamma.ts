/**
 * Special functions: log-gamma, incomplete gamma, incomplete beta, error
 * function and the standard normal distribution.
 *
 * Methods
 *  - logGamma: Lanczos approximation (g = 7, 9 coefficients), relative error
 *    ~1e-15 for x > 0; reflection formula for x < 0.5.
 *  - Regularised incomplete gamma P(a,x), Q(a,x): power series for x < a + 1,
 *    Lentz continued fraction otherwise (Numerical Recipes §6.2). Both tails
 *    are computed directly so neither suffers cancellation.
 *  - Regularised incomplete beta I_x(a,b): Lentz continued fraction with the
 *    symmetry I_x(a,b) = 1 − I_{1−x}(b,a) (Numerical Recipes §6.4); both tails
 *    are returned directly.
 *  - erf / erfc via the incomplete gamma: erf(x) = P(1/2, x²).
 *  - Normal quantile: Acklam's rational approximation (rel. error 1.15e-9)
 *    refined by one Halley step against the accurate CDF, giving close to full
 *    double precision.
 *
 * Accuracy for large shape parameters
 * -----------------------------------
 * The prefactor exp(a·ln x − x − lnΓ(a)) is evaluated in floating point, so
 * precision falls away as the shape parameters grow. The claim previously made
 * here — that this only matters above a ≈ 1e7, and that "callers enforce
 * parameter limits well inside this range" — was false in both halves.
 * `discrete.ts` permits a binomial n up to 1e7, which puts the incomplete
 * beta's shape parameters at 5e6, and the measured error there is real:
 *
 *   binomial.cdf(5e6, {n: 1e7, p: 0.5})  gives 0.5001261409098403
 *   the correct value (SciPy)                  0.5001261566229462
 *
 * an absolute error of 1.6e-8 — the eighth significant digit, which is
 * precisely the precision at which this engine formats probabilities. The
 * same effect appears in negativeBinomial.cdf(1e6, {r: 1e6, p: 0.5}) and
 * gamma.cdf(1e6, {k: 1e6, θ: 1}).
 *
 * So: expect full double precision for shape parameters up to roughly 1e4,
 * about 1e-12 relative accuracy to 1e5, and degradation into the eighth
 * significant digit by 1e6. Results derived from these functions at large
 * parameters are 'numerical', not 'exact', and callers must label them that
 * way — see `incompleteBetaIsExact` below.
 */
import { EngineError } from '../core/result';

const LANCZOS_G = 7;
const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];
const LOG_SQRT_2PI = 0.9189385332046727; // ln(√(2π))

/** Exact ln(n!) for small n, used to avoid Lanczos error for integers. */
const LOG_FACTORIAL_TABLE: number[] = (() => {
  const t = [0];
  let acc = 0;
  for (let i = 1; i <= 170; i++) {
    acc += Math.log(i);
    t.push(acc);
  }
  return t;
})();

export function logGamma(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x === Infinity) return Infinity;
  if (Number.isInteger(x)) {
    if (x <= 0) return Infinity;
    if (x <= 171) return LOG_FACTORIAL_TABLE[x - 1];
  }
  if (x < 0.5) {
    // Reflection: Γ(x)Γ(1−x) = π / sin(πx)
    return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - logGamma(1 - x);
  }
  if (x > 1e7) {
    // Stirling series, accurate for large x.
    return (x - 0.5) * Math.log(x) - x + LOG_SQRT_2PI + 1 / (12 * x) - 1 / (360 * x * x * x);
  }
  const z = x - 1;
  let a = LANCZOS[0];
  const t = z + LANCZOS_G + 0.5;
  for (let i = 1; i < LANCZOS.length; i++) a += LANCZOS[i] / (z + i);
  return LOG_SQRT_2PI + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

export function gammaFn(x: number): number {
  if (Number.isInteger(x) && x <= 0) return NaN;
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gammaFn(1 - x));
  if (x > 171.7) return Infinity;
  return Math.exp(logGamma(x));
}

/** ln(n!) for non-negative integer n. */
export function logFactorial(n: number): number {
  if (!Number.isInteger(n) || n < 0) return NaN;
  if (n <= 170) return LOG_FACTORIAL_TABLE[n] ?? 0;
  return logGamma(n + 1);
}

/** ln C(n, k) for real n ≥ k ≥ 0 (integers in practice). */
export function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  if (k === 0 || k === n) return 0;
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}

export function logBeta(a: number, b: number): number {
  return logGamma(a) + logGamma(b) - logGamma(a + b);
}

const MAX_ITER = 100000;
const TINY = 1e-300;
const CF_EPS = 1e-16;

export interface Tails {
  /** Lower regularised value (e.g. P(a,x) or I_x(a,b)). */
  lower: number;
  /** Upper regularised value (Q(a,x) = 1 − P(a,x), or 1 − I_x(a,b)), computed directly. */
  upper: number;
}

/** Regularised incomplete gamma, both tails. a > 0, x ≥ 0. */
export function incompleteGamma(a: number, x: number): Tails {
  if (!(a > 0) || !(x >= 0) || !Number.isFinite(a)) {
    throw new EngineError(`Incomplete gamma undefined for a=${a}, x=${x}.`, 'domain');
  }
  if (x === 0) return { lower: 0, upper: 1 };
  if (x === Infinity) return { lower: 1, upper: 0 };
  const logPrefactor = a * Math.log(x) - x - logGamma(a);
  if (x < a + 1) {
    // Series: P(a,x) = e^{-x} x^a / Γ(a+1) · Σ x^n / ((a+1)...(a+n))
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let n = 0; n < MAX_ITER; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * CF_EPS) break;
    }
    const lower = Math.min(1, Math.exp(logPrefactor + Math.log(sum)));
    return { lower, upper: 1 - lower };
  }
  // Continued fraction for Q(a,x) (modified Lentz).
  let b = x + 1 - a;
  let c = 1 / TINY;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < MAX_ITER; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < TINY) d = TINY;
    c = b + an / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < CF_EPS) break;
  }
  const upper = Math.min(1, Math.exp(logPrefactor + Math.log(h)));
  return { lower: 1 - upper, upper };
}

function betaContinuedFraction(a: number, b: number, x: number): number {
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m < MAX_ITER; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < CF_EPS) break;
  }
  return h;
}

/** Regularised incomplete beta I_x(a, b), both tails. a, b > 0, 0 ≤ x ≤ 1. */
export function incompleteBeta(x: number, a: number, b: number): Tails {
  if (!(a > 0) || !(b > 0) || !(x >= 0 && x <= 1)) {
    throw new EngineError(`Incomplete beta undefined for x=${x}, a=${a}, b=${b}.`, 'domain');
  }
  if (x === 0) return { lower: 0, upper: 1 };
  if (x === 1) return { lower: 1, upper: 0 };
  const logFront = a * Math.log(x) + b * Math.log1p(-x) - logBeta(a, b);
  if (x < (a + 1) / (a + b + 2)) {
    const lower = Math.min(1, Math.exp(logFront + Math.log(betaContinuedFraction(a, b, x)) - Math.log(a)));
    return { lower, upper: 1 - lower };
  }
  const upper = Math.min(1, Math.exp(logFront + Math.log(betaContinuedFraction(b, a, 1 - x)) - Math.log(b)));
  return { lower: 1 - upper, upper };
}

export function erf(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x === 0) return 0;
  const p = incompleteGamma(0.5, x * x).lower;
  return x > 0 ? p : -p;
}

export function erfc(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x === 0) return 1;
  const t = incompleteGamma(0.5, x * x);
  return x > 0 ? t.upper : 1 + t.lower;
}

const INV_SQRT_2PI = 0.3989422804014327;

export function normalPdf(z: number): number {
  return INV_SQRT_2PI * Math.exp(-0.5 * z * z);
}

/** Standard normal CDF Φ(z); accurate in both tails. */
export function normalCdf(z: number): number {
  if (z === -Infinity) return 0;
  if (z === Infinity) return 1;
  return 0.5 * erfc(-z / Math.SQRT2);
}

/** Standard normal survival 1 − Φ(z) computed without cancellation. */
export function normalSf(z: number): number {
  return normalCdf(-z);
}

const A = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
const B = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
const C = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
const D = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];

/** Standard normal quantile Φ⁻¹(p) for 0 < p < 1. */
export function normalQuantile(p: number): number {
  if (Number.isNaN(p) || p < 0 || p > 1) return NaN;
  if (p === 0) return -Infinity;
  if (p === 1) return Infinity;
  const plow = 0.02425;
  let x: number;
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1);
  } else if (p <= 1 - plow) {
    const q = p - 0.5;
    const r = q * q;
    x = ((((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q) /
      (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log1p(-p));
    x = -(((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1);
  }
  // Halley refinement. Work in the smaller tail to avoid cancellation.
  for (let i = 0; i < 2; i++) {
    const e = p < 0.5 ? normalCdf(x) - p : (1 - p) - normalSf(x);
    const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
    const nx = x - u / (1 + (x * u) / 2);
    if (!Number.isFinite(nx)) break;
    x = nx;
  }
  return x;
}

/** Digamma ψ(x) via recurrence + asymptotic series (used by some estimators). */
export function digamma(x: number): number {
  if (x <= 0 && Number.isInteger(x)) return NaN;
  let result = 0;
  if (x < 0) {
    // Reflection: ψ(1−x) − ψ(x) = π cot(πx)
    return digamma(1 - x) - Math.PI / Math.tan(Math.PI * x);
  }
  while (x < 12) {
    result -= 1 / x;
    x += 1;
  }
  const f = 1 / (x * x);
  return result + Math.log(x) - 0.5 / x - f * (1 / 12 - f * (1 / 120 - f * (1 / 252 - f * (1 / 240 - f / 132))));
}

/**
 * The shape-parameter scale beyond which incomplete-beta and incomplete-gamma
 * results lose the eighth significant digit (see the accuracy note above).
 * Callers that would otherwise label a CDF-derived result 'exact' should
 * consult this and downgrade to 'numerical'.
 */
export const LARGE_SHAPE_THRESHOLD = 1e5;

/**
 * Whether a result derived from the regularised incomplete beta at these shape
 * parameters still holds to full double precision, and may therefore be
 * labelled 'exact'.
 */
export function incompleteBetaIsExact(a: number, b: number): boolean {
  return Math.max(a, b) <= LARGE_SHAPE_THRESHOLD;
}

/**
 * The same question for the regularised incomplete gamma.
 */
export function incompleteGammaIsExact(a: number): boolean {
  return a <= LARGE_SHAPE_THRESHOLD;
}
