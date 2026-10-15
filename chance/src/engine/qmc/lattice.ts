/**
 * Rank-1 lattice rules.
 *
 * The point set is x_i = frac(i·z/N + Δ), i = 0 … N−1, for an integer
 * generating vector z ∈ Z^d and a shift Δ. Lattice rules are the natural QMC
 * construction for periodic-ish smooth integrands and, unlike digital nets,
 * work for any N.
 *
 * The generating vector is NOT hard-coded from a table: it is searched here, by
 * component-by-component (CBC) construction, minimising the shift-averaged
 * worst-case error in the weighted Korobov/Sobolev space of smoothness α = 2,
 * which has the closed form
 *
 *   ê²(z) = −1 + (1/N) Σ_{i=0}^{N−1} Π_{j=1}^{d} ( 1 + γ_j B_2({ i z_j / N }) ),
 *   B_2(x) = x² − x + 1/6
 *
 * (Sloan & Joe 1994; Nuyens & Cools 2006). The achieved figure of merit is
 * returned with the point set, so the quality claim is a measured number.
 *
 * Randomisation is a random shift Δ (Cranley–Patterson 1976), which is exact
 * and unbiased and is what makes an error estimate across replications legal.
 */
import { EngineError } from '../core/result';
import { Xoshiro128, type Seed } from '../random/rng';
import type { PointSequence } from './types';

export interface LatticeOptions {
  dimension: number;
  /** Number of points; the lattice is defined for exactly this N. */
  count: number;
  /** Random shift (Cranley–Patterson). Needs a seed. */
  randomShift?: boolean;
  seed?: Seed;
  /**
   * Product weights γ_j. Default 0.9^j: later coordinates matter less, which is
   * the usual assumption and must be stated because the searched vector depends
   * on it.
   */
  weights?: number[];
  /** Candidate multipliers examined per coordinate (default 256). */
  candidates?: number;
}

function gcd(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

const bernoulli2 = (x: number): number => x * x - x + 1 / 6;

export interface LatticeSearchResult {
  generator: Int32Array;
  /** Shift-averaged worst-case error ê(z); smaller is better. */
  figureOfMerit: number;
  weights: number[];
}

/**
 * The CBC search costs one pass over the N points for every candidate
 * multiplier in every coordinate, so its work is d · (candidates) · N. It runs
 * synchronously on whatever thread asks for it, and a search of more than a
 * few tens of millions of products holds that thread for seconds. Past this
 * budget the search refuses rather than freezing the caller, and the message
 * names the three inputs that set the cost.
 */
export const LATTICE_SEARCH_WORK_LIMIT = 4e7;

/** CBC search for a rank-1 generating vector. */
export function searchLatticeGenerator(
  dimension: number,
  count: number,
  weights: number[],
  candidateLimit = 256,
  workLimit = LATTICE_SEARCH_WORK_LIMIT,
): LatticeSearchResult {
  const n = count;
  const coprime: number[] = [];
  for (let a = 1; a < n; a++) if (gcd(a, n) === 1) coprime.push(a);
  if (!coprime.length) {
    throw new EngineError(`No multiplier is coprime to N = ${n}; a lattice rule needs N ≥ 2.`, 'range');
  }
  const stride = Math.max(1, Math.floor(coprime.length / candidateLimit));
  const candidates: number[] = [];
  for (let i = 0; i < coprime.length; i += stride) candidates.push(coprime[i]);
  const work = dimension * candidates.length * n;
  if (work > workLimit) {
    throw new EngineError(
      `The generating-vector search costs dimension × candidates × N = ${dimension} × ${candidates.length} × ${n} = ${work.toExponential(2)} products, above the limit of ${workLimit.toExponential(2)} this build will run on one thread. It would stop the page responding for seconds. Reduce the dimension, the point count N, or the number of candidate multipliers.`,
      'limit',
    );
  }

  const generator = new Int32Array(dimension);
  const product = new Float64Array(n).fill(1);
  const trial = new Float64Array(n);
  for (let j = 0; j < dimension; j++) {
    const g = weights[j];
    let best = candidates[0];
    let bestValue = Infinity;
    for (const a of candidates) {
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const frac = (i * a) % n / n;
        sum += product[i] * (1 + g * bernoulli2(frac));
      }
      const value = -1 + sum / n;
      if (value < bestValue) {
        bestValue = value;
        best = a;
      }
    }
    generator[j] = best;
    for (let i = 0; i < n; i++) {
      trial[i] = product[i] * (1 + g * bernoulli2(((i * best) % n) / n));
    }
    product.set(trial);
  }
  let sum = 0;
  for (let i = 0; i < n; i++) sum += product[i];
  const squared = -1 + sum / n;
  return { generator, figureOfMerit: Math.sqrt(Math.max(0, squared)), weights };
}

/**
 * The number of candidate multipliers the generating-vector search tries when
 * a caller names none. It is exported because the search dominates the cost of
 * building a lattice rule, so anything budgeting that work before it starts
 * has to use the same number — see `integrationWork` in ./integrate.ts. Two
 * copies of this value would let the guard under-count, which is the defect it
 * exists to prevent.
 */
export const DEFAULT_LATTICE_CANDIDATES = 256;

export class LatticeRule implements PointSequence {
  readonly name: string;
  readonly dimension: number;
  readonly randomised: boolean;
  readonly count: number;
  readonly generator: Int32Array;
  readonly figureOfMerit: number;
  private readonly shift: Float64Array;

  constructor(options: LatticeOptions) {
    const { dimension, count } = options;
    if (!Number.isInteger(dimension) || dimension < 1) {
      throw new EngineError('Lattice dimension must be a whole number of at least 1.', 'range');
    }
    if (!Number.isInteger(count) || count < 2) {
      throw new EngineError('A lattice rule needs a whole number of at least 2 points.', 'range');
    }
    if (count > 1 << 20) {
      throw new EngineError('Lattice point counts above 2^20 are not supported by the generator search in this build.', 'limit');
    }
    const randomShift = options.randomShift ?? false;
    if (randomShift && options.seed === undefined) {
      throw new EngineError('A randomly shifted lattice needs a seed so the shift can be reproduced.', 'required');
    }
    const weights = options.weights ?? Array.from({ length: dimension }, (_, j) => 0.9 ** (j + 1));
    if (weights.length < dimension) {
      throw new EngineError('One lattice weight per dimension is required.', 'length');
    }
    for (const w of weights) {
      if (!Number.isFinite(w) || w <= 0) throw new EngineError('Lattice weights must be finite and positive.', 'range');
    }
    this.dimension = dimension;
    this.count = count;
    const searched = searchLatticeGenerator(dimension, count, weights, options.candidates ?? DEFAULT_LATTICE_CANDIDATES);
    this.generator = searched.generator;
    this.figureOfMerit = searched.figureOfMerit;
    this.randomised = randomShift;
    this.shift = new Float64Array(dimension);
    if (randomShift) {
      const rng = new Xoshiro128(`lattice:${String(options.seed)}`);
      for (let j = 0; j < dimension; j++) this.shift[j] = rng.next();
    }
    this.name = `Rank-1 lattice, N = ${count} (${dimension}-d${randomShift ? ', random shift' : ', unrandomised'})`;
  }

  fill(index: number, out: Float64Array): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.count) {
      throw new EngineError(`Lattice point index must be between 0 and ${this.count - 1}; this rule has exactly ${this.count} points.`, 'range');
    }
    for (let j = 0; j < this.dimension; j++) {
      const v = ((index * this.generator[j]) % this.count) / this.count + this.shift[j];
      const f = v - Math.floor(v);
      out[j] = f < 1 ? f : 0;
    }
  }

  point(index: number): Float64Array {
    const out = new Float64Array(this.dimension);
    this.fill(index, out);
    return out;
  }
}

export function latticeRule(options: LatticeOptions): LatticeRule {
  return new LatticeRule(options);
}
