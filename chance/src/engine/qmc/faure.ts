/**
 * Faure sequence: a digital (0,d)-sequence in base b, where b is the smallest
 * prime ≥ max(d, 2).
 *
 * Coordinate j (0-based) applies the j-th power of the upper-triangular Pascal
 * matrix C, with entries C_{kl} = binom(l,k) mod b, to the base-b digit vector
 * of the index, then reads the result back through the radix point. j = 0 is
 * the plain van der Corput sequence in base b.
 *
 * Faure's advantage over Halton is that one base is shared by all coordinates,
 * so no pair of coordinates can drift into the digit-alignment failure that
 * ruins high-dimensional Halton. Its disadvantage is that the base grows with
 * the dimension, so the point set only becomes well distributed once N is
 * comparable with b^2 — for d = 30 that is b = 31 and N in the thousands. The
 * module reports this as a warning rather than letting a user read a
 * meaningless 100-point Faure estimate.
 *
 * A random digit shift (add an independent random digit vector mod b to every
 * coordinate's digits) is available for randomised QMC.
 */
import { EngineError } from '../core/result';
import { Xoshiro128, type Seed } from '../random/rng';
import { PRIMES } from './halton';
import type { PointSequence } from './types';

export interface FaureOptions {
  dimension: number;
  /** Random digit shift modulo the base. Needs a seed. */
  randomise?: boolean;
  seed?: Seed;
  /** Digits of resolution; default 24, which is ample for N below b^24. */
  digits?: number;
}

function smallestPrimeAtLeast(n: number): number {
  for (const p of PRIMES) if (p >= n) return p;
  throw new EngineError(`No prime base available for dimension ${n} in this build.`, 'dimension');
}

export class FaureSequence implements PointSequence {
  readonly name: string;
  readonly dimension: number;
  readonly randomised: boolean;
  readonly base: number;
  private readonly digits: number;
  /** powers[j][k*r + l] = (C^j)_{kl} mod b. */
  private readonly powers: Int32Array[];
  private readonly shift: Int32Array;
  private readonly digitBuf: Int32Array;

  constructor(options: FaureOptions) {
    const { dimension } = options;
    if (!Number.isInteger(dimension) || dimension < 1) {
      throw new EngineError('Faure dimension must be a whole number of at least 1.', 'range');
    }
    if (dimension > 128) {
      throw new EngineError('Faure dimension above 128 is not supported by this build.', 'dimension');
    }
    const digits = options.digits ?? 24;
    if (!Number.isInteger(digits) || digits < 1 || digits > 48) {
      throw new EngineError('Faure digit count must be a whole number between 1 and 48.', 'range');
    }
    const randomise = options.randomise ?? false;
    if (randomise && options.seed === undefined) {
      throw new EngineError('A randomised Faure sequence needs a seed so the digit shift can be reproduced.', 'required');
    }
    this.dimension = dimension;
    this.digits = digits;
    this.base = smallestPrimeAtLeast(Math.max(dimension, 2));
    this.randomised = randomise;
    const b = this.base;
    const r = digits;
    // Pascal matrix mod b.
    const pascal = new Int32Array(r * r);
    for (let l = 0; l < r; l++) {
      pascal[0 * r + l] = 1;
      for (let k = 1; k <= l; k++) {
        pascal[k * r + l] = (pascal[(k - 1) * r + (l - 1)] + pascal[k * r + (l - 1)]) % b;
      }
    }
    this.powers = [];
    let current = new Int32Array(r * r);
    for (let k = 0; k < r; k++) current[k * r + k] = 1; // identity
    for (let j = 0; j < dimension; j++) {
      this.powers.push(current);
      const next = new Int32Array(r * r);
      for (let k = 0; k < r; k++) {
        for (let m = k; m < r; m++) {
          const a = current[k * r + m];
          if (a === 0) continue;
          for (let l = m; l < r; l++) next[k * r + l] = (next[k * r + l] + a * pascal[m * r + l]) % b;
        }
      }
      current = next;
    }
    this.shift = new Int32Array(dimension * r);
    if (randomise) {
      const rng = new Xoshiro128(`faure:${String(options.seed)}`);
      for (let i = 0; i < this.shift.length; i++) this.shift[i] = rng.nextUint32() % b;
    }
    this.digitBuf = new Int32Array(r);
    this.name = `Faure base ${b} (${dimension}-d${randomise ? ', random digit shift' : ', unrandomised'})`;
  }

  fill(index: number, out: Float64Array): void {
    if (!Number.isInteger(index) || index < 0) {
      throw new EngineError('Faure point index must be a non-negative whole number.', 'range');
    }
    const b = this.base;
    const r = this.digits;
    const a = this.digitBuf;
    let k = index;
    for (let i = 0; i < r; i++) {
      a[i] = k % b;
      k = Math.floor(k / b);
    }
    if (k !== 0) {
      throw new EngineError(`Faure point index ${index} needs more than ${r} base-${b} digits; raise the digit count.`, 'range');
    }
    for (let j = 0; j < this.dimension; j++) {
      const mat = this.powers[j];
      let value = 0;
      let f = 1 / b;
      for (let row = 0; row < r; row++) {
        let acc = 0;
        for (let col = row; col < r; col++) {
          const c = mat[row * r + col];
          if (c !== 0) acc += c * a[col];
        }
        const digit = (acc + this.shift[j * r + row]) % b;
        value += digit * f;
        f /= b;
      }
      out[j] = value < 1 ? value : 1 - Number.EPSILON;
    }
  }

  point(index: number): Float64Array {
    const out = new Float64Array(this.dimension);
    this.fill(index, out);
    return out;
  }

  /** Points needed before a Faure set in this base is reasonably distributed. */
  get recommendedMinimumPoints(): number {
    return this.base * this.base;
  }
}

export function faureSequence(options: FaureOptions): FaureSequence {
  return new FaureSequence(options);
}
