/**
 * Halton sequence, and the scrambling it needs to be usable.
 *
 * The radical-inverse (van der Corput) sequence in base b maps the index n,
 * written in base b, to 0.d_0 d_1 d_2 … reversed about the radix point. The
 * Halton sequence uses the j-th prime as the base for coordinate j.
 *
 * ## The documented failure
 *
 * Plain Halton degrades badly in higher dimensions. Two coordinates with large
 * prime bases b_1 < b_2 agree digit-for-digit for the first b_1 indices, so the
 * two-dimensional projection lies on a few parallel lines: for the primes near
 * dimension 30 (113, 127, …) the first hundred-odd points of that projection
 * are almost perfectly linearly correlated. This is not a subtlety; it is
 * visible in a scatter plot and it produces confidently wrong integrals. The
 * module measures it (`maxAbsPairCorrelation` in `halton.ts` tests, and
 * `discrepancy.ts` generally) rather than hiding it.
 *
 * Two standard repairs are implemented:
 *   - digit scrambling: a random permutation π_j of {0,…,b_j−1} fixing 0 is
 *     applied to every digit of coordinate j (random-permutation / "scrambled"
 *     Halton, in the spirit of Braaten–Weller and Owen). This breaks the digit
 *     alignment between coordinates.
 *   - leaping: take every L-th point, with L a prime not among the bases
 *     (Kocis & Whiten 1997). Leaping alone reduces, but does not remove, the
 *     correlation; it is offered together with scrambling.
 *
 * Neither repair makes plain Halton competitive with Sobol in 30 dimensions.
 * Use Sobol or a lattice rule there.
 */
import { EngineError } from '../core/result';
import { Xoshiro128, type Seed } from '../random/rng';
import type { PointSequence } from './types';

/** First primes, enough for the dimensions this module supports. */
export const PRIMES: readonly number[] = (() => {
  const out: number[] = [];
  for (let n = 2; out.length < 512; n++) {
    let prime = true;
    for (let i = 0; i < out.length && out[i] * out[i] <= n; i++) {
      if (n % out[i] === 0) {
        prime = false;
        break;
      }
    }
    if (prime) out.push(n);
  }
  return out;
})();

export const HALTON_MAX_DIMENSION = PRIMES.length;

export interface HaltonOptions {
  dimension: number;
  /** Apply a random digit permutation per coordinate. Needs a seed. */
  scramble?: boolean;
  /** Take every `leap`-th index. Must be a positive integer; primes are best. */
  leap?: number;
  /** Skip the first `skip` indices (index 0 is the origin). */
  skip?: number;
  seed?: Seed;
}

export class HaltonSequence implements PointSequence {
  readonly name: string;
  readonly dimension: number;
  readonly randomised: boolean;
  private readonly bases: Int32Array;
  private readonly perms: (Int32Array | null)[];
  private readonly leap: number;
  private readonly skip: number;

  constructor(options: HaltonOptions) {
    const { dimension } = options;
    if (!Number.isInteger(dimension) || dimension < 1) {
      throw new EngineError('Halton dimension must be a whole number of at least 1.', 'range');
    }
    if (dimension > HALTON_MAX_DIMENSION) {
      throw new EngineError(
        `Halton dimension ${dimension} exceeds the ${HALTON_MAX_DIMENSION} prime bases available in this build.`,
        'dimension',
      );
    }
    const leap = options.leap ?? 1;
    if (!Number.isInteger(leap) || leap < 1) {
      throw new EngineError('Halton leap must be a whole number of at least 1.', 'range');
    }
    const skip = options.skip ?? 0;
    if (!Number.isInteger(skip) || skip < 0) {
      throw new EngineError('Halton skip must be a non-negative whole number.', 'range');
    }
    const scramble = options.scramble ?? false;
    if (scramble && options.seed === undefined) {
      throw new EngineError('Scrambled Halton needs a seed so the digit permutations can be reproduced.', 'required');
    }
    this.dimension = dimension;
    this.leap = leap;
    this.skip = skip;
    this.randomised = scramble;
    this.bases = Int32Array.from(PRIMES.slice(0, dimension));
    this.perms = new Array<Int32Array | null>(dimension).fill(null);
    if (scramble) {
      const rng = new Xoshiro128(`halton:${String(options.seed)}`);
      for (let j = 0; j < dimension; j++) {
        const b = this.bases[j];
        const perm = new Int32Array(b);
        for (let i = 0; i < b; i++) perm[i] = i;
        // Shuffle digits 1..b-1, keeping π(0) = 0 so the sequence still starts
        // at the origin and remains a radical-inverse construction.
        for (let i = b - 1; i > 1; i--) {
          const k = 1 + (rng.nextUint32() % i);
          const t = perm[i];
          perm[i] = perm[k];
          perm[k] = t;
        }
        this.perms[j] = perm;
      }
    }
    const parts = [`Halton (${dimension}-d`];
    if (scramble) parts.push('random digit permutations');
    if (leap > 1) parts.push(`leap ${leap}`);
    this.name = `${parts.join(', ')})`;
  }

  fill(index: number, out: Float64Array): void {
    if (!Number.isInteger(index) || index < 0) {
      throw new EngineError('Halton point index must be a non-negative whole number.', 'range');
    }
    const n = this.skip + index * this.leap;
    for (let j = 0; j < this.dimension; j++) {
      out[j] = radicalInverse(n, this.bases[j], this.perms[j]);
    }
  }

  point(index: number): Float64Array {
    const out = new Float64Array(this.dimension);
    this.fill(index, out);
    return out;
  }
}

/** Radical inverse of n in base b, with an optional digit permutation. */
export function radicalInverse(n: number, base: number, perm: Int32Array | null = null): number {
  let f = 1 / base;
  let result = 0;
  let k = n;
  // 64 digits is far more than double precision can hold for any base ≥ 2.
  while (k > 0 && f > 0) {
    const digit = k % base;
    result += (perm ? perm[digit] : digit) * f;
    k = Math.floor(k / base);
    f /= base;
  }
  // Guard the open interval: with a permutation fixing 0 the value cannot reach 1.
  return result < 1 ? result : 1 - Number.EPSILON;
}

export function haltonSequence(options: HaltonOptions): HaltonSequence {
  return new HaltonSequence(options);
}
