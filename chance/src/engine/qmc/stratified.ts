/**
 * Stratified designs: Latin hypercube sampling, orthogonal-array LHS,
 * one-dimensional stratification with proportional and Neyman allocation, and
 * systematic sampling.
 *
 * Latin hypercube sampling splits each coordinate into N equal strata and
 * places exactly one point in each stratum of each coordinate — the defining
 * property, asserted in the tests. It removes the sampling variance of every
 * additive (main-effect) part of the integrand, which is usually most of it;
 * it does nothing for pure interaction terms. LHS keeps an honest, if slightly
 * conservative, i.i.d.-style error estimate because distinct LHS designs are
 * independent of one another.
 *
 * Iman–Conover (1982) imposes a target RANK correlation on the columns of a
 * design without changing the marginals: it reorders each column. The target
 * matrix must be positive definite — a request that is not is refused, not
 * quietly projected onto something feasible.
 */
import { EngineError } from '../core/result';
import { Random, Xoshiro128, type Seed } from '../random/rng';
import { normalQuantile } from '../special/gamma';
import { choleskyWithCheck, type Matrix } from '../stats/linalg';
import { mean, ranks, spearman } from '../stats/descriptive';
import { materialise } from './discrepancy';
import type { PointSet } from './types';

export interface LhsOptions {
  dimension: number;
  count: number;
  seed: Seed;
  /** 'centred' puts each point at its stratum midpoint; 'jittered' (default) draws within it. */
  placement?: 'centred' | 'jittered';
  /**
   * Target RANK (Spearman) correlation matrix, applied by Iman–Conover.
   * Must be symmetric with unit diagonal and positive definite.
   */
  targetRankCorrelation?: Matrix;
}

/** Latin hypercube design in [0,1)^d, row-major. */
export function latinHypercube(options: LhsOptions): PointSet {
  const { dimension: d, count: n } = options;
  if (!Number.isInteger(d) || d < 1) throw new EngineError('LHS dimension must be a whole number of at least 1.', 'range');
  if (!Number.isInteger(n) || n < 1) throw new EngineError('LHS needs a whole number of at least 1 sample.', 'range');
  const placement = options.placement ?? 'jittered';
  const rng = new Random(new Xoshiro128(`lhs:${String(options.seed)}`));
  const values = new Float64Array(n * d);
  const order = new Array<number>(n);
  for (let k = 0; k < d; k++) {
    for (let i = 0; i < n; i++) order[i] = i;
    rng.shuffle(order);
    for (let i = 0; i < n; i++) {
      const offset = placement === 'centred' ? 0.5 : rng.uniform();
      values[i * d + k] = (order[i] + offset) / n;
    }
  }
  const set: PointSet = {
    name: `Latin hypercube (${d}-d, ${placement})`,
    dimension: d,
    count: n,
    randomised: true,
    values,
  };
  if (!options.targetRankCorrelation) return set;
  return imanConover(set, options.targetRankCorrelation, options.seed);
}

/**
 * Iman–Conover rank-correlation restriction. Returns a point set with the same
 * values in every column (so the Latin hypercube property survives) but
 * reordered so that the column rank correlations approximate the target.
 */
export function imanConover(design: PointSet, target: Matrix, seed: Seed): PointSet {
  const d = design.dimension;
  const n = design.count;
  if (target.length !== d || target.some((row) => row.length !== d)) {
    throw new EngineError(`The target correlation matrix must be ${d}×${d} to match the design.`, 'length');
  }
  for (let i = 0; i < d; i++) {
    if (Math.abs(target[i][i] - 1) > 1e-9) {
      throw new EngineError('A correlation matrix must have 1 on the diagonal.', 'range');
    }
    for (let j = 0; j < d; j++) {
      if (Math.abs(target[i][j] - target[j][i]) > 1e-9) {
        throw new EngineError('The target correlation matrix must be symmetric.', 'symmetry');
      }
      if (target[i][j] < -1 || target[i][j] > 1) {
        throw new EngineError('Every target correlation must lie between −1 and 1.', 'range');
      }
    }
  }
  const chol = choleskyWithCheck(target);
  if (!chol.ok) {
    throw new EngineError(
      'The requested correlation matrix is not positive definite, so no joint distribution has those correlations. Check for a set of correlations that cannot hold simultaneously (for example ρ(A,B) = ρ(A,C) = 0.9 with ρ(B,C) = −0.9).',
      'not-positive-definite',
    );
  }
  const rng = new Random(new Xoshiro128(`iman-conover:${String(seed)}`));
  // Van der Waerden scores, randomly permuted per column: a reference sample
  // with (approximately) the identity correlation and known marginals.
  const scores = new Float64Array(n);
  for (let i = 0; i < n; i++) scores[i] = normalQuantile((i + 1) / (n + 1));
  const ref: number[][] = [];
  for (let k = 0; k < d; k++) {
    const col = Array.from(scores);
    rng.shuffle(col);
    ref.push(col);
  }
  // Decorrelate the reference by its own Cholesky factor, then recorrelate to
  // the target. This is the step Iman & Conover add to remove the accidental
  // correlation of the random permutations.
  const sampleCorr: Matrix = Array.from({ length: d }, () => new Array<number>(d).fill(0));
  for (let a = 0; a < d; a++) {
    for (let b = 0; b < d; b++) sampleCorr[a][b] = pearsonArrays(ref[a], ref[b]);
  }
  const refChol = choleskyWithCheck(sampleCorr);
  if (!refChol.ok) {
    throw new EngineError('The reference scores were degenerate; use more samples than dimensions for Iman–Conover.', 'numerical');
  }
  const qInv = invertLowerTriangular(refChol.L);
  const transform = multiply(chol.L, qInv);
  const targetScores: number[][] = Array.from({ length: d }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < d; a++) {
      let s = 0;
      for (let b = 0; b <= a; b++) s += transform[a][b] * ref[b][i];
      targetScores[a][i] = s;
    }
  }
  // Reorder each original column so its ranks match the target score ranks.
  const values = new Float64Array(n * d);
  for (let k = 0; k < d; k++) {
    const original = new Array<number>(n);
    for (let i = 0; i < n; i++) original[i] = design.values[i * d + k];
    original.sort((p, q) => p - q);
    const r = ranks(targetScores[k]);
    for (let i = 0; i < n; i++) {
      // ranks() gives average ranks starting at 1; scores are distinct here.
      values[i * d + k] = original[Math.round(r[i]) - 1];
    }
  }
  return { ...design, name: `${design.name} + Iman–Conover`, values };
}

function pearsonArrays(x: number[], y: number[]): number {
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < x.length; i++) {
    const a = x[i] - mx;
    const b = y[i] - my;
    sxy += a * b;
    sxx += a * a;
    syy += b * b;
  }
  if (sxx <= 0 || syy <= 0) return 0;
  return sxy / Math.sqrt(sxx * syy);
}

function invertLowerTriangular(l: Matrix): Matrix {
  const n = l.length;
  const inv: Matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    if (l[i][i] === 0) throw new EngineError('Singular triangular factor in Iman–Conover.', 'numerical');
    inv[i][i] = 1 / l[i][i];
    for (let j = 0; j < i; j++) {
      let s = 0;
      for (let k = j; k < i; k++) s += l[i][k] * inv[k][j];
      inv[i][j] = -s / l[i][i];
    }
  }
  return inv;
}

function multiply(a: Matrix, b: Matrix): Matrix {
  const n = a.length;
  const out: Matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < n; k++) {
      const aik = a[i][k];
      if (aik === 0) continue;
      for (let j = 0; j < n; j++) out[i][j] += aik * b[k][j];
    }
  }
  return out;
}

/** Observed Spearman rank-correlation matrix of a design's columns. */
export function rankCorrelationMatrix(design: PointSet): Matrix {
  const d = design.dimension;
  const n = design.count;
  const cols: Float64Array[] = [];
  for (let k = 0; k < d; k++) {
    const col = new Float64Array(n);
    for (let i = 0; i < n; i++) col[i] = design.values[i * d + k];
    cols.push(col);
  }
  return Array.from({ length: d }, (_, a) => Array.from({ length: d }, (_, b) => (a === b ? 1 : spearman(cols[a], cols[b]))));
}

/**
 * Orthogonal-array-based Latin hypercube ("Sudoku LHS") for a prime p.
 *
 * Bose's construction gives a strength-2 orthogonal array OA(p², p+1, p, 2):
 * rows indexed by (u, v) ∈ Z_p², column 0 = u, column 1 = v, column k+2 =
 * u + k·v mod p. Every pair of columns contains each of the p² level
 * combinations exactly once, so the design is balanced in every two-dimensional
 * projection as well as every one-dimensional one — which plain LHS is not.
 * The OA levels are then expanded into p² distinct LHS strata.
 */
export function orthogonalArrayLhs(options: { prime: number; dimension: number; seed: Seed }): PointSet {
  const { prime: p, dimension: d } = options;
  if (!isPrime(p) || p < 2) {
    throw new EngineError(`Orthogonal-array LHS needs a prime number of levels; ${p} is not prime.`, 'range');
  }
  if (!Number.isInteger(d) || d < 2 || d > p + 1) {
    throw new EngineError(
      `Bose's construction with ${p} levels supports 2 to ${p + 1} dimensions; ${d} was requested.`,
      'dimension',
    );
  }
  const n = p * p;
  const rng = new Random(new Xoshiro128(`oa-lhs:${String(options.seed)}`));
  const levels = new Int32Array(n * d);
  for (let u = 0; u < p; u++) {
    for (let v = 0; v < p; v++) {
      const row = u * p + v;
      for (let k = 0; k < d; k++) {
        levels[row * d + k] = k === 0 ? u : k === 1 ? v : (u + (k - 1) * v) % p;
      }
    }
  }
  const values = new Float64Array(n * d);
  for (let k = 0; k < d; k++) {
    // Within each of the p levels, hand out the p sub-strata in random order.
    const used = new Int32Array(p);
    const subOrder: number[][] = [];
    for (let l = 0; l < p; l++) {
      const o = Array.from({ length: p }, (_, i) => i);
      rng.shuffle(o);
      subOrder.push(o);
    }
    for (let row = 0; row < n; row++) {
      const l = levels[row * d + k];
      const sub = subOrder[l][used[l]++];
      const stratum = l * p + sub;
      values[row * d + k] = (stratum + rng.uniform()) / n;
    }
  }
  return {
    name: `Orthogonal-array LHS, Bose OA(${n}, ${d}, ${p}, 2)`,
    dimension: d,
    count: n,
    randomised: true,
    values,
  };
}

function isPrime(n: number): boolean {
  if (!Number.isInteger(n) || n < 2) return false;
  for (let i = 2; i * i <= n; i++) if (n % i === 0) return false;
  return true;
}

/** Stratum definition on a single dimension. */
export interface Stratum {
  /** Lower edge in [0,1). */
  from: number;
  /** Upper edge in (0,1]. */
  to: number;
  /** Known or assumed population weight; defaults to the stratum width. */
  weight?: number;
  /** Known or estimated within-stratum standard deviation, for Neyman allocation. */
  sd?: number;
}

export interface AllocationResult {
  counts: number[];
  weights: number[];
  rule: 'proportional' | 'neyman';
  /** Explanation of what the allocation assumed. */
  note: string;
}

/**
 * Allocate `total` samples across strata.
 *  - proportional: n_h ∝ W_h.
 *  - neyman (optimal): n_h ∝ W_h σ_h, which minimises the variance of the
 *    stratified mean. It needs the within-stratum standard deviations; if they
 *    are not supplied this refuses rather than pretending they are equal
 *    (equal σ would make Neyman identical to proportional and the "optimal"
 *    label a lie).
 */
export function allocateStrata(strata: Stratum[], total: number, rule: 'proportional' | 'neyman'): AllocationResult {
  if (!strata.length) throw new EngineError('At least one stratum is required.', 'length');
  if (!Number.isInteger(total) || total < strata.length) {
    throw new EngineError(`Allocate at least one sample per stratum: total must be a whole number of at least ${strata.length}.`, 'range');
  }
  const weights = strata.map((s, i) => {
    const w = s.weight ?? s.to - s.from;
    if (!(w > 0) || !Number.isFinite(w)) throw new EngineError(`Stratum ${i + 1} has a non-positive weight.`, 'range');
    return w;
  });
  const wSum = weights.reduce((a, b) => a + b, 0);
  const norm = weights.map((w) => w / wSum);
  let key: number[];
  let note: string;
  if (rule === 'proportional') {
    key = norm;
    note = 'Proportional allocation: samples in proportion to stratum weight. Needs no knowledge of within-stratum variability.';
  } else {
    const sds = strata.map((s, i) => {
      if (s.sd === undefined || !(s.sd >= 0) || !Number.isFinite(s.sd)) {
        throw new EngineError(
          `Neyman (optimal) allocation needs a within-stratum standard deviation for every stratum; stratum ${i + 1} has none. Supply estimates, or use proportional allocation.`,
          'required',
        );
      }
      return s.sd;
    });
    const prod = norm.map((w, i) => w * sds[i]);
    const ps = prod.reduce((a, b) => a + b, 0);
    if (!(ps > 0)) {
      throw new EngineError('Every within-stratum standard deviation is zero, so Neyman allocation is undefined.', 'range');
    }
    key = prod.map((p) => p / ps);
    note = 'Neyman (optimal) allocation: samples proportional to W_h·σ_h, which minimises the variance of the stratified mean. The σ_h used are the supplied estimates, so the optimality is conditional on them.';
  }
  // Largest-remainder rounding with a floor of one sample per stratum.
  const ideal = key.map((k) => k * total);
  const counts = ideal.map((v) => Math.max(1, Math.floor(v)));
  const order = ideal
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac)
    .map((e) => e.i);
  let sum = counts.reduce((a, b) => a + b, 0);
  let guard = 0;
  while (sum > total && guard++ < 10 * total) {
    let worst = -1;
    for (const i of [...order].reverse()) {
      if (counts[i] > 1) {
        worst = i;
        break;
      }
    }
    if (worst < 0) break;
    counts[worst]--;
    sum--;
  }
  let at = 0;
  while (sum < total) {
    counts[order[at % order.length]]++;
    at++;
    sum++;
  }
  return { counts, weights: norm, rule, note };
}

/** Draw a stratified sample on [0,1) given strata and an allocation. */
export function stratifiedSample(strata: Stratum[], counts: number[], seed: Seed): { values: Float64Array; strataIndex: Int32Array } {
  if (strata.length !== counts.length) throw new EngineError('One count per stratum is required.', 'length');
  const rng = new Random(new Xoshiro128(`stratified:${String(seed)}`));
  const total = counts.reduce((a, b) => a + b, 0);
  const values = new Float64Array(total);
  const strataIndex = new Int32Array(total);
  let at = 0;
  for (let h = 0; h < strata.length; h++) {
    const { from, to } = strata[h];
    if (!(to > from)) throw new EngineError(`Stratum ${h + 1} is empty: "to" must exceed "from".`, 'range');
    for (let i = 0; i < counts[h]; i++) {
      values[at] = from + (to - from) * rng.uniform();
      strataIndex[at] = h;
      at++;
    }
  }
  return { values, strataIndex };
}

/** Equal-width strata covering [0,1). */
export function equalStrata(count: number): Stratum[] {
  if (!Number.isInteger(count) || count < 1) throw new EngineError('Stratum count must be a positive whole number.', 'range');
  return Array.from({ length: count }, (_, i) => ({ from: i / count, to: (i + 1) / count }));
}

/**
 * Systematic sampling on [0,1): one random start in [0, 1/N) then a fixed step
 * of 1/N. Cheap and perfectly balanced in one dimension, but it is a single
 * random draw, so the N values are completely dependent: the usual s/√N
 * standard error is invalid for a systematic sample from one start. Replicate
 * the start to get an error estimate.
 */
export function systematicSample(count: number, seed: Seed): Float64Array {
  if (!Number.isInteger(count) || count < 1) throw new EngineError('Systematic sample size must be a positive whole number.', 'range');
  const rng = new Random(new Xoshiro128(`systematic:${String(seed)}`));
  const start = rng.uniform() / count;
  const out = new Float64Array(count);
  for (let i = 0; i < count; i++) out[i] = start + i / count;
  return out;
}

/** The i.i.d. baseline: N independent uniform points, as a PointSet. */
export function uniformPointSet(dimension: number, count: number, seed: Seed): PointSet {
  if (!Number.isInteger(dimension) || dimension < 1) throw new EngineError('Dimension must be a positive whole number.', 'range');
  const rng = new Xoshiro128(`mc:${String(seed)}`);
  return materialise(
    {
      name: `Independent uniform (${dimension}-d)`,
      dimension,
      randomised: true,
      fill: (_i, out) => {
        for (let k = 0; k < dimension; k++) out[k] = rng.next();
      },
    },
    count,
  );
}
