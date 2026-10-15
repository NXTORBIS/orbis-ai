/**
 * Exact discrete distributions by convolution.
 *
 * For n independent identically distributed draws from a finite outcome set,
 * the distribution of the sum is the n-fold convolution of the single-draw
 * distribution. This is computed with exact repeated convolution (by squaring)
 * so the result is limited only by floating-point rounding, not by sampling
 * error — it gives the theoretical curve to compare simulated frequencies
 * against.
 *
 * Values are required to lie on a common lattice (all integers, or all a fixed
 * step apart) because the convolution is indexed by position. Non-lattice
 * values are rejected rather than silently rounded.
 */
import { EngineError } from '../core/result';

export interface DiscreteRow {
  value: number;
  probability: number;
}

export interface DiscreteDistributionTable {
  rows: DiscreteRow[];
  exact: boolean;
  method: string;
}

/** Largest number of lattice points we will build. */
export const MAX_LATTICE_POINTS = 2_000_000;

interface Lattice {
  offset: number;
  step: number;
  weights: Float64Array;
}

function toLattice(rows: DiscreteRow[]): Lattice | null {
  const values = rows.map((r) => r.value);
  const min = Math.min(...values);
  // Determine a step as the greatest common divisor of the gaps, if the values
  // are equally spaced on some lattice.
  const scaled = values.map((v) => v - min);
  let step = 0;
  for (const v of scaled) {
    if (v === 0) continue;
    step = step === 0 ? v : gcdFloat(step, v);
    if (step < 1e-9) return null;
  }
  if (step === 0) step = 1;
  const size = Math.round(Math.max(...scaled) / step) + 1;
  if (!Number.isFinite(size) || size > MAX_LATTICE_POINTS) return null;
  const weights = new Float64Array(size);
  for (const r of rows) {
    const idx = Math.round((r.value - min) / step);
    if (Math.abs(idx * step + min - r.value) > 1e-9 * Math.max(1, Math.abs(r.value))) return null;
    weights[idx] += r.probability;
  }
  return { offset: min, step, weights };
}

function gcdFloat(a: number, b: number): number {
  // GCD on values that are multiples of a common step, tolerant of rounding.
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y > 1e-9) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

function convolve(a: Float64Array, b: Float64Array): Float64Array {
  const out = new Float64Array(a.length + b.length - 1);
  for (let i = 0; i < a.length; i++) {
    const ai = a[i];
    if (ai === 0) continue;
    for (let j = 0; j < b.length; j++) {
      if (b[j] === 0) continue;
      out[i + j] += ai * b[j];
    }
  }
  return out;
}

/**
 * Exact distribution of the sum of `n` independent draws from `single`.
 * Returns null when the lattice would be too large to compute.
 */
export function exactSumDistribution(single: DiscreteRow[], n: number): DiscreteDistributionTable | null {
  if (n < 1 || !Number.isInteger(n)) throw new EngineError('Number of draws must be a whole number of at least 1.', 'range');
  const lat = toLattice(single);
  if (!lat) return null;
  const finalSize = (lat.weights.length - 1) * n + 1;
  if (finalSize > MAX_LATTICE_POINTS) return null;
  // Exponentiation by squaring on the convolution operation.
  let result = new Float64Array([1]);
  let base = lat.weights;
  let e = n;
  while (e > 0) {
    if (e & 1) result = convolve(result, base);
    e >>>= 1;
    if (e > 0) base = convolve(base, base);
  }
  const rows: DiscreteRow[] = [];
  for (let i = 0; i < result.length; i++) {
    if (result[i] > 0) rows.push({ value: lat.offset * n + i * lat.step, probability: result[i] });
  }
  return {
    rows,
    exact: true,
    method: `Exact ${n}-fold convolution of the single-draw distribution (no sampling involved)`,
  };
}

/** Summary statistics of a discrete table. */
export function tableSummary(table: DiscreteDistributionTable): { mean: number; variance: number; total: number } {
  let mean = 0;
  let total = 0;
  for (const r of table.rows) {
    mean += r.value * r.probability;
    total += r.probability;
  }
  let variance = 0;
  for (const r of table.rows) variance += (r.value - mean) ** 2 * r.probability;
  return { mean, variance, total };
}
