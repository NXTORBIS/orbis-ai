/**
 * Discrepancy measures, so "these points are better distributed" is a measured
 * number and not an assertion.
 *
 * Two closed-form L2 discrepancies are computed. Both are O(N²d), which is why
 * `maxPoints` exists: the functions refuse rather than silently subsampling.
 *
 * L2 star discrepancy (Warnock's formula):
 *   D*₂(P)² = 3^{−d} − (2^{1−d}/N) Σ_i Π_k (1 − x_ik²)
 *             + (1/N²) Σ_i Σ_j Π_k (1 − max(x_ik, x_jk))
 *
 * Centred L2 discrepancy (Hickernell 1998), which is invariant under reflection
 * about the centre of the cube and is the more informative of the two for
 * comparing designs:
 *   CD₂(P)² = (13/12)^d − (2/N) Σ_i Π_k (1 + |u_ik|/2 − u_ik²/2)
 *             + (1/N²) Σ_i Σ_j Π_k (1 + |u_ik|/2 + |u_jk|/2 − |x_ik − x_jk|/2)
 *   with u = x − 1/2.
 *
 * For reference, i.i.d. uniform points have E[D*₂²] = (2^{−d} − 3^{−d})/N, so
 * `expectedRandomStarDiscrepancy` gives the baseline to compare against.
 */
import { EngineError } from '../core/result';
import { stableSum } from '../core/numeric';
import type { PointSet } from './types';

function check(points: PointSet, maxPoints: number): void {
  if (points.count < 1) {
    throw new EngineError('Discrepancy needs at least one point.', 'range');
  }
  if (points.count > maxPoints) {
    throw new EngineError(
      `Discrepancy is an O(N²) computation; ${points.count} points exceeds the limit of ${maxPoints}. Raise maxPoints deliberately or compare smaller point sets.`,
      'limit',
    );
  }
  const v = points.values;
  for (let i = 0; i < points.count * points.dimension; i++) {
    const x = v[i];
    if (!(x >= 0 && x < 1)) {
      throw new EngineError(`Discrepancy needs every coordinate in [0,1); found ${x}.`, 'range');
    }
  }
}

export function starDiscrepancyL2(points: PointSet, maxPoints = 4096): number {
  check(points, maxPoints);
  const { count: n, dimension: d, values } = points;
  const single = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let p = 1;
    for (let k = 0; k < d; k++) {
      const x = values[i * d + k];
      p *= 1 - x * x;
    }
    single[i] = p;
  }
  const pair = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let rowSum = 0;
    for (let j = 0; j < n; j++) {
      let p = 1;
      for (let k = 0; k < d; k++) {
        const a = values[i * d + k];
        const b = values[j * d + k];
        p *= 1 - (a > b ? a : b);
      }
      rowSum += p;
    }
    pair[i] = rowSum;
  }
  const term1 = 3 ** -d;
  const term2 = (2 ** (1 - d) / n) * stableSum(single);
  const term3 = stableSum(pair) / (n * n);
  return Math.sqrt(Math.max(0, term1 - term2 + term3));
}

export function centredDiscrepancyL2(points: PointSet, maxPoints = 4096): number {
  check(points, maxPoints);
  const { count: n, dimension: d, values } = points;
  const single = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let p = 1;
    for (let k = 0; k < d; k++) {
      const u = Math.abs(values[i * d + k] - 0.5);
      p *= 1 + u / 2 - (u * u) / 2;
    }
    single[i] = p;
  }
  const pair = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let rowSum = 0;
    for (let j = 0; j < n; j++) {
      let p = 1;
      for (let k = 0; k < d; k++) {
        const a = values[i * d + k];
        const b = values[j * d + k];
        p *= 1 + Math.abs(a - 0.5) / 2 + Math.abs(b - 0.5) / 2 - Math.abs(a - b) / 2;
      }
      rowSum += p;
    }
    pair[i] = rowSum;
  }
  const term1 = (13 / 12) ** d;
  const term2 = (2 / n) * stableSum(single);
  const term3 = stableSum(pair) / (n * n);
  return Math.sqrt(Math.max(0, term1 - term2 + term3));
}

/** E[D*₂²]^{1/2} for N i.i.d. uniform points in d dimensions. */
export function expectedRandomStarDiscrepancy(n: number, d: number): number {
  if (!Number.isInteger(n) || n < 1) throw new EngineError('Point count must be a positive whole number.', 'range');
  if (!Number.isInteger(d) || d < 1) throw new EngineError('Dimension must be a positive whole number.', 'range');
  return Math.sqrt((2 ** -d - 3 ** -d) / n);
}

/**
 * Largest absolute Pearson correlation over all coordinate pairs. This is the
 * blunt instrument that exposes high-dimensional Halton's digit alignment.
 */
export function maxAbsPairCorrelation(points: PointSet): { value: number; i: number; j: number } {
  const { count: n, dimension: d, values } = points;
  if (n < 3) throw new EngineError('Pairwise correlation needs at least three points.', 'range');
  if (d < 2) throw new EngineError('Pairwise correlation needs at least two dimensions.', 'range');
  const means = new Float64Array(d);
  for (let i = 0; i < n; i++) for (let k = 0; k < d; k++) means[k] += values[i * d + k];
  for (let k = 0; k < d; k++) means[k] /= n;
  let best = 0;
  let bi = 0;
  let bj = 1;
  for (let a = 0; a < d; a++) {
    for (let b = a + 1; b < d; b++) {
      let sab = 0;
      let saa = 0;
      let sbb = 0;
      for (let i = 0; i < n; i++) {
        const da = values[i * d + a] - means[a];
        const db = values[i * d + b] - means[b];
        sab += da * db;
        saa += da * da;
        sbb += db * db;
      }
      if (saa <= 0 || sbb <= 0) continue;
      const r = Math.abs(sab / Math.sqrt(saa * sbb));
      if (r > best) {
        best = r;
        bi = a;
        bj = b;
      }
    }
  }
  return { value: best, i: bi, j: bj };
}

/** Materialise the first `count` points of a sequence into a PointSet. */
export function materialise(
  seq: { name: string; dimension: number; randomised: boolean; fill(i: number, out: Float64Array): void },
  count: number,
): PointSet {
  if (!Number.isInteger(count) || count < 1) {
    throw new EngineError('Point count must be a whole number of at least 1.', 'range');
  }
  const d = seq.dimension;
  const values = new Float64Array(count * d);
  const buf = new Float64Array(d);
  for (let i = 0; i < count; i++) {
    seq.fill(i, buf);
    for (let k = 0; k < d; k++) {
      const x = buf[k];
      if (!Number.isFinite(x) || x < 0 || x >= 1) {
        throw new EngineError(`Sequence "${seq.name}" produced coordinate ${x} at point ${i}, dimension ${k + 1}; coordinates must lie in [0,1).`, 'internal');
      }
      values[i * d + k] = x;
    }
  }
  return { name: seq.name, dimension: d, count, randomised: seq.randomised, values };
}
