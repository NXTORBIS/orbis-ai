/** Shared numerics for the physics labs: integrators, linear solvers and check helpers. */

export { clamp, fmt, bisect, derivative, secondDerivative, lerp, mean, rmsOf } from '@jarvis/components/toolkit/engineering/sim/core';

export const TAU = Math.PI * 2;

export const linspace = (from, to, count) => Array.from({ length: count }, (_, i) => from + ((to - from) * i) / (count - 1 || 1));

export const relErr = (a, b) => (Math.abs(b) > 1e-12 ? Math.abs(a - b) / Math.abs(b) : Math.abs(a - b));

/** Classic fourth-order Runge-Kutta for a state vector. */
export function rk4(fn, y, t, dt) {
  const n = y.length;
  const add = (state, k, h) => state.map((value, i) => value + h * k[i]);
  const k1 = fn(y, t);
  const k2 = fn(add(y, k1, dt / 2), t + dt / 2);
  const k3 = fn(add(y, k2, dt / 2), t + dt / 2);
  const k4 = fn(add(y, k3, dt), t + dt);
  const out = new Array(n);
  for (let i = 0; i < n; i += 1) out[i] = y[i] + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
  return out;
}

/** Gaussian elimination with partial pivoting; returns null when the system is singular. */
export function solveLinear(matrix, rhs) {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    if (Math.abs(a[pivot][col]) < 1e-14) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let row = col + 1; row < n; row += 1) {
      const factor = a[row][col] / a[col][col];
      for (let k = col; k <= n; k += 1) a[row][k] -= factor * a[col][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let row = n - 1; row >= 0; row -= 1) {
    let sum = a[row][n];
    for (let col = row + 1; col < n; col += 1) sum -= a[row][col] * x[col];
    x[row] = sum / a[row][row];
  }
  return x;
}

/** Trapezoidal rule over sampled (xs, ys). */
export function trapz(xs, ys) {
  let sum = 0;
  for (let i = 1; i < xs.length; i += 1) sum += ((xs[i] - xs[i - 1]) * (ys[i] + ys[i - 1])) / 2;
  return sum;
}

/** Numeric root of a scalar function by bisection over a bracket. */
export function rootBracket(fn, a, b, iterations = 80) {
  let lo = a;
  let hi = b;
  let fl = fn(lo);
  for (let i = 0; i < iterations; i += 1) {
    const mid = (lo + hi) / 2;
    const fm = fn(mid);
    if (fl * fm <= 0) { hi = mid; } else { lo = mid; fl = fm; }
  }
  return (lo + hi) / 2;
}

/** A single check row; every lab's verify() returns a list of these. */
export const check = (label, ok, detail) => ({ label, ok: !!ok, detail });

/** Turn a tolerance comparison into a check row. */
export const closeCheck = (label, value, reference, tolerance, digits = 6) => check(
  label,
  relErr(value, reference) <= tolerance,
  `${Number(value).toFixed(digits)} vs ${Number(reference).toFixed(digits)}`,
);

/** Format a value with a fixed number of significant digits for readouts. */
export const sig = (value, digits = 4) => {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  const magnitude = Math.pow(10, digits - Math.ceil(Math.log10(Math.abs(value))));
  return String(Math.round(value * magnitude) / magnitude);
};