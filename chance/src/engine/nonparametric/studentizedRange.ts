/**
 * The studentised range distribution, computed numerically.
 *
 * For k independent standard normals and an independent s² with ν degrees of
 * freedom, the range of the normals divided by s has distribution
 *
 *   P(Q ≤ q) = ∫₀^∞ f_ν(s) · k ∫ φ(z)[Φ(z) − Φ(z − q·s)]^{k−1} dz ds,
 *
 * where f_ν is the density of s = √(χ²_ν/ν). Both integrals are evaluated by
 * Gauss–Legendre quadrature: the inner one over z ∈ [−9, 9], the outer over
 * s ∈ (0, s_max] with s_max far enough into the tail that the omitted mass is
 * below 1e-14. With ν = ∞ the outer integral disappears (s ≡ 1).
 *
 * Accuracy is checked against two independent references: for k = 2 the
 * distribution reduces analytically to that of √2·|t_ν|, and the 5% critical
 * values reproduce the published studentised range tables.
 */
import { brentRoot } from '../core/numeric';
import { EngineError } from '../core/result';
import { logGamma, normalCdf, normalPdf } from '../special/gamma';

const nodeCache = new Map<number, { x: Float64Array; w: Float64Array }>();

/** Gauss–Legendre nodes and weights on [−1, 1], by Newton iteration. */
function gaussLegendre(n: number): { x: Float64Array; w: Float64Array } {
  const cached = nodeCache.get(n);
  if (cached) return cached;
  const x = new Float64Array(n);
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // Initial guess (Abramowitz & Stegun 25.4.30).
    let z = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5));
    let pp = 0;
    for (let iter = 0; iter < 100; iter++) {
      let p0 = 1;
      let p1 = 0;
      for (let j = 0; j < n; j++) {
        const p2 = p1;
        p1 = p0;
        p0 = ((2 * j + 1) * z * p1 - j * p2) / (j + 1);
      }
      pp = (n * (z * p0 - p1)) / (z * z - 1);
      const dz = p0 / pp;
      z -= dz;
      if (Math.abs(dz) < 1e-15) break;
    }
    x[i] = z;
    w[i] = 2 / ((1 - z * z) * pp * pp);
  }
  const out = { x, w };
  nodeCache.set(n, out);
  return out;
}

function integrate(f: (t: number) => number, a: number, b: number, n: number): number {
  const { x, w } = gaussLegendre(n);
  const half = (b - a) / 2;
  const mid = (a + b) / 2;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += w[i] * f(mid + half * x[i]);
  return sum * half;
}

/**
 * Inner integral, with the node-dependent quantities Φ(z) and φ(z) cached
 * because only Φ(z − w) changes between calls.
 */
const INNER_NODES = 128;
const INNER_LO = -9;
const INNER_HI = 9;
const innerGrid = (() => {
  const { x, w } = gaussLegendre(INNER_NODES);
  const half = (INNER_HI - INNER_LO) / 2;
  const mid = (INNER_HI + INNER_LO) / 2;
  const z = new Float64Array(INNER_NODES);
  const weight = new Float64Array(INNER_NODES);
  const phi = new Float64Array(INNER_NODES);
  const Phi = new Float64Array(INNER_NODES);
  for (let i = 0; i < INNER_NODES; i++) {
    z[i] = mid + half * x[i];
    weight[i] = w[i] * half;
    phi[i] = normalPdf(z[i]);
    Phi[i] = normalCdf(z[i]);
  }
  return { z, weight, phi, Phi };
})();

/** k·∫ φ(z)[Φ(z) − Φ(z − w)]^{k−1} dz: P(range of k normals ≤ w). */
function normalRangeCdf(w: number, k: number): number {
  if (w <= 0) return 0;
  const { z, weight, phi, Phi } = innerGrid;
  let sum = 0;
  for (let i = 0; i < INNER_NODES; i++) {
    const inner = Phi[i] - normalCdf(z[i] - w);
    if (inner <= 0) continue;
    sum += weight[i] * phi[i] * Math.exp((k - 1) * Math.log(inner));
  }
  return Math.min(1, Math.max(0, k * sum));
}

/** P(Q ≤ q) for the studentised range with k means and ν degrees of freedom. */
export function studentizedRangeCdf(q: number, k: number, df: number): number {
  if (!(k >= 2) || !Number.isInteger(k)) throw new EngineError('The studentised range needs an integer k ≥ 2.', 'range');
  if (!(df > 0)) throw new EngineError('The studentised range needs positive degrees of freedom.', 'range');
  if (!(q > 0)) return 0;
  if (!Number.isFinite(df)) return normalRangeCdf(q, k);
  // Density of s = √(χ²_ν/ν), in logs for stability.
  const logConst = (df / 2) * Math.log(df) - logGamma(df / 2) - (df / 2 - 1) * Math.LN2;
  const density = (s: number) => Math.exp(logConst + (df - 1) * Math.log(s) - (df * s * s) / 2);
  const sMax = Math.min(25, 1 + 14 / Math.sqrt(df));
  const value = integrate((s) => (s <= 0 ? 0 : density(s) * normalRangeCdf(q * s, k)), 1e-12, sMax, 192);
  return Math.min(1, Math.max(0, value));
}

/** P(Q > q): the p-value of an observed studentised range. */
export function studentizedRangeSf(q: number, k: number, df: number): number {
  return Math.min(1, Math.max(0, 1 - studentizedRangeCdf(q, k, df)));
}

const quantileCache = new Map<string, number>();

/** The p-quantile of the studentised range distribution, by root finding. */
export function studentizedRangeQuantile(p: number, k: number, df: number): number {
  if (!(p > 0 && p < 1)) throw new EngineError('The quantile level must be strictly between 0 and 1.', 'range');
  const key = `${p}|${k}|${df}`;
  const hit = quantileCache.get(key);
  if (hit !== undefined) return hit;
  const value = brentRoot((q) => studentizedRangeCdf(q, k, df) - p, 1e-8, 200, { tol: 1e-7 });
  quantileCache.set(key, value);
  return value;
}
