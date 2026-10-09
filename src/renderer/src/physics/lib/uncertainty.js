// Uncertainty & error propagation. Deterministic, no AI.
// For y = f(x1..xn) with independent uncertainties u(xi), the propagated
// uncertainty is sqrt( Σ (∂f/∂xi · u(xi))² ) — computed numerically via
// central finite differences so any JS function works.

export function absError(num, exact) { return Math.abs(num - exact); }
export function relError(num, exact) { return exact === 0 ? NaN : Math.abs(num - exact) / Math.abs(exact); }
export function pctError(num, exact) { return 100 * relError(num, exact); }

// Combine independent uncertainties in quadrature.
export function combineUncertainties(us = []) {
  return Math.sqrt(us.reduce((s, u) => s + u * u, 0));
}

// Propagate uncertainty through f(x) where x is an array of { value, unc }.
// Returns { y, uy } using numerical partial derivatives (central differences).
export function propagate(f, vars, opts = {}) {
  const h = opts.h || 1e-6;
  const xs = vars.map((v) => v.value);
  const y = f(...xs);
  let sum = 0;
  for (let i = 0; i < vars.length; i++) {
    const xp = xs.slice(); xp[i] += h;
    const xm = xs.slice(); xm[i] -= h;
    const df = (f(...xp) - f(...xm)) / (2 * h);
    sum += (df * vars[i].unc) ** 2;
  }
  return { y, uy: Math.sqrt(sum) };
}

// Standard descriptive uncertainty of a sample.
export function sampleStats(arr = []) {
  const n = arr.length;
  if (!n) return { n: 0 };
  const mean = arr.reduce((s, x) => s + x, 0) / n;
  const sq = arr.reduce((s, x) => s + (x - mean) ** 2, 0);
  const sd = n > 1 ? Math.sqrt(sq / (n - 1)) : 0;       // sample std (Bessel)
  const sdm = n > 1 ? sd / Math.sqrt(n) : 0;            // std of the mean
  const min = Math.min(...arr), max = Math.max(...arr);
  return { n, mean, sd, sdm, min, max, range: max - min };
}

// 95% confidence interval (Student t ≈ 2 for moderate n) on the mean.
export function confidenceInterval(arr, level = 0.95) {
  const s = sampleStats(arr);
  if (s.n < 2) return { ...s, lo: s.mean, hi: s.mean };
  const t = level === 0.99 ? 3.0 : level === 0.90 ? 1.7 : 2.0;
  const m = t * s.sdm;
  return { ...s, lo: s.mean - m, hi: s.mean + m, margin: m };
}