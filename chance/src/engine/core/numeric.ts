/**
 * Numerical utilities shared across the engine: stable sums, log-space helpers,
 * root finding and formatting of numbers for display.
 */
import { EngineError } from './result';

/** Machine epsilon for IEEE-754 doubles. */
export const EPS = Number.EPSILON;

/** Neumaier (improved Kahan) compensated summation. */
export function stableSum(values: ArrayLike<number>): number {
  let sum = 0;
  let c = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const t = sum + v;
    if (Math.abs(sum) >= Math.abs(v)) c += sum - t + v;
    else c += v - t + sum;
    sum = t;
  }
  return sum + c;
}

/** log(exp(a) + exp(b)) without overflow. */
export function logAddExp(a: number, b: number): number {
  if (a === -Infinity) return b;
  if (b === -Infinity) return a;
  const m = Math.max(a, b);
  return m + Math.log1p(Math.exp(-Math.abs(a - b)));
}

/** log(sum(exp(x_i))) without overflow. */
export function logSumExp(xs: ArrayLike<number>): number {
  let m = -Infinity;
  for (let i = 0; i < xs.length; i++) if (xs[i] > m) m = xs[i];
  if (m === -Infinity) return -Infinity;
  if (m === Infinity) return Infinity;
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += Math.exp(xs[i] - m);
  return m + Math.log(s);
}

/** log(1 - exp(x)) for x <= 0, accurate near both ends (Mächler 2012). */
export function log1mExp(x: number): number {
  if (x > 0) return NaN;
  return x > -Math.LN2 ? Math.log(-Math.expm1(x)) : Math.log1p(-Math.exp(x));
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Clamp a probability that may have drifted outside [0, 1] by rounding error. */
export function clampProbability(p: number): number {
  if (Number.isNaN(p)) return p;
  return clamp(p, 0, 1);
}

/**
 * Brent's method for finding a root of f in [a, b]. f(a) and f(b) must have
 * opposite signs (or one of them is zero).
 */
export function brentRoot(
  f: (x: number) => number,
  a: number,
  b: number,
  options: { tol?: number; maxIter?: number } = {},
): number {
  const tol = options.tol ?? 1e-14;
  const maxIter = options.maxIter ?? 300;
  let fa = f(a);
  let fb = f(b);
  if (fa === 0) return a;
  if (fb === 0) return b;
  if (Number.isNaN(fa) || Number.isNaN(fb) || fa * fb > 0) {
    throw new EngineError('Root finding failed: the interval does not bracket a solution.', 'numerical');
  }
  let c = a;
  let fc = fa;
  let d = b - a;
  let e = d;
  for (let iter = 0; iter < maxIter; iter++) {
    if (fb * fc > 0) {
      c = a;
      fc = fa;
      d = b - a;
      e = d;
    }
    if (Math.abs(fc) < Math.abs(fb)) {
      a = b;
      b = c;
      c = a;
      fa = fb;
      fb = fc;
      fc = fa;
    }
    const tol1 = 2 * EPS * Math.abs(b) + 0.5 * tol;
    const xm = 0.5 * (c - b);
    if (Math.abs(xm) <= tol1 || fb === 0) return b;
    if (Math.abs(e) >= tol1 && Math.abs(fa) > Math.abs(fb)) {
      const s = fb / fa;
      let p: number;
      let q: number;
      if (a === c) {
        p = 2 * xm * s;
        q = 1 - s;
      } else {
        const qq = fa / fc;
        const r = fb / fc;
        p = s * (2 * xm * qq * (qq - r) - (b - a) * (r - 1));
        q = (qq - 1) * (r - 1) * (s - 1);
      }
      if (p > 0) q = -q;
      p = Math.abs(p);
      const min1 = 3 * xm * q - Math.abs(tol1 * q);
      const min2 = Math.abs(e * q);
      if (2 * p < Math.min(min1, min2)) {
        e = d;
        d = p / q;
      } else {
        d = xm;
        e = d;
      }
    } else {
      d = xm;
      e = d;
    }
    a = b;
    fa = fb;
    b += Math.abs(d) > tol1 ? d : xm > 0 ? tol1 : -tol1;
    fb = f(b);
  }
  return b;
}

/** Format a number with a given count of significant digits, avoiding "-0". */
export function formatNumber(x: number, sig = 6): string {
  if (Number.isNaN(x)) return 'undefined';
  if (x === Infinity) return '∞';
  if (x === -Infinity) return '−∞';
  if (x === 0) return '0';
  const abs = Math.abs(x);
  if (abs >= 1e-4 && abs < 1e15) {
    const s = Number(x.toPrecision(sig));
    return s.toLocaleString('en-US', { maximumSignificantDigits: sig, useGrouping: abs >= 1e4 });
  }
  return x.toExponential(Math.max(0, sig - 1)).replace(/\.?0+e/, 'e').replace('e+', 'e');
}

/** Format a probability as a percentage. */
export function formatPercent(p: number, sig = 4): string {
  if (Number.isNaN(p)) return 'undefined';
  if (p === 0) return '0%';
  if (p === 1) return '100%';
  const pct = p * 100;
  if (Math.abs(pct) < 1e-4) return `${formatNumber(pct, sig)}%`;
  return `${Number(pct.toPrecision(sig)).toString()}%`;
}

/** Express a probability as "1 in N" (N rounded to 3 significant digits). */
export function formatOneIn(p: number): string | null {
  if (!(p > 0) || p > 1) return null;
  const n = 1 / p;
  if (!Number.isFinite(n)) return null;
  const rounded = n >= 100 ? Number(n.toPrecision(3)) : Math.round(n * 100) / 100;
  return `about 1 in ${rounded.toLocaleString('en-US')}`;
}

/** Linear sequence of n points from a to b inclusive. */
export function linspace(a: number, b: number, n: number): number[] {
  if (n < 2) return [a];
  const out = new Array<number>(n);
  const step = (b - a) / (n - 1);
  for (let i = 0; i < n; i++) out[i] = a + step * i;
  out[n - 1] = b;
  return out;
}

export function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}
