/**
 * Seeded pseudorandom number generation.
 *
 * Generator: xoshiro128** (Blackman & Vigna, 2018), a fast 32-bit generator
 * with period 2^128 − 1 and good statistical quality. It is NOT
 * cryptographically secure and must never be used for security purposes.
 *
 * Seeding: a seed is any string or integer. It is hashed with cyrb128 into the
 * 128-bit state so that similar seeds give unrelated streams. The same seed and
 * the same sequence of calls always reproduce the same values on every
 * platform, because only 32-bit integer operations are used.
 */

/** cyrb128 string hash → four 32-bit words. */
function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

export type Seed = string | number;

export interface RandomSource {
  /** Uniform 32-bit unsigned integer. */
  nextUint32(): number;
  /** Uniform double in [0, 1) with 53 bits of randomness. */
  next(): number;
}

export class Xoshiro128 implements RandomSource {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  constructor(seed: Seed) {
    [this.s0, this.s1, this.s2, this.s3] = cyrb128(String(seed));
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1;
  }

  nextUint32(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5), 7), 9) >>> 0;
    const t = this.s1 << 9;
    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  next(): number {
    const hi = this.nextUint32() >>> 5; // 27 bits
    const lo = this.nextUint32() >>> 6; // 26 bits
    return (hi * 67108864 + lo) / 9007199254740992;
  }

  /** Snapshot of internal state, used to fork independent sub-streams. */
  state(): [number, number, number, number] {
    return [this.s0, this.s1, this.s2, this.s3];
  }
}

function rotl(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k));
}

/**
 * Random utilities built on a RandomSource. All samplers are exact algorithms
 * (no normal approximations to discrete laws).
 */
export class Random {
  readonly source: RandomSource;
  private spareNormal: number | null = null;

  constructor(seedOrSource: Seed | RandomSource) {
    this.source =
      typeof seedOrSource === 'object' ? seedOrSource : new Xoshiro128(seedOrSource);
  }

  /** Uniform in [0, 1). */
  uniform(): number {
    return this.source.next();
  }

  /** Uniform in the open interval (0, 1); never returns 0. */
  uniformOpen(): number {
    let u = 0;
    while (u === 0) u = this.source.next();
    return u;
  }

  uniformRange(a: number, b: number): number {
    return a + (b - a) * this.source.next();
  }

  /** Uniform integer in [lo, hi] inclusive, unbiased (rejection sampling). */
  int(lo: number, hi: number): number {
    const span = hi - lo + 1;
    if (span <= 0) throw new RangeError('Invalid integer range.');
    if (span <= 0x100000000) {
      const limit = Math.floor(0x100000000 / span) * span;
      let x: number;
      do x = this.source.nextUint32();
      while (x >= limit);
      return lo + (x % span);
    }
    return lo + Math.floor(this.source.next() * span);
  }

  bernoulli(p: number): boolean {
    return this.source.next() < p;
  }

  /** Standard normal by the Marsaglia polar method. */
  normal(): number {
    if (this.spareNormal !== null) {
      const v = this.spareNormal;
      this.spareNormal = null;
      return v;
    }
    let u: number, v: number, s: number;
    do {
      u = 2 * this.source.next() - 1;
      v = 2 * this.source.next() - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const m = Math.sqrt((-2 * Math.log(s)) / s);
    this.spareNormal = v * m;
    return u * m;
  }

  exponential(rate = 1): number {
    return -Math.log(this.uniformOpen()) / rate;
  }

  /** Gamma(shape, scale=1) by Marsaglia & Tsang (2000). */
  gamma(shape: number): number {
    if (shape < 1) {
      // Boost: Gamma(a) = Gamma(a+1) · U^{1/a}
      const g = this.gamma(shape + 1);
      return g * Math.pow(this.uniformOpen(), 1 / shape);
    }
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x: number, v: number;
      do {
        x = this.normal();
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      const u = this.uniformOpen();
      if (u < 1 - 0.0331 * x * x * x * x) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }

  beta(a: number, b: number): number {
    const x = this.gamma(a);
    const y = this.gamma(b);
    return x / (x + y);
  }

  /** Poisson(λ): multiplication method for λ < 30, PTRS (Hörmann 1993) otherwise. */
  poisson(lambda: number): number {
    if (lambda <= 0) return 0;
    if (lambda < 30) {
      const L = Math.exp(-lambda);
      let k = 0;
      let p = this.source.next();
      while (p > L) {
        k++;
        p *= this.source.next();
      }
      return k;
    }
    const slam = Math.sqrt(lambda);
    const loglam = Math.log(lambda);
    const b = 0.931 + 2.53 * slam;
    const a = -0.059 + 0.02483 * b;
    const invalpha = 1.1239 + 1.1328 / (b - 3.4);
    const vr = 0.9277 - 3.6224 / (b - 2);
    for (;;) {
      const U = this.source.next() - 0.5;
      const V = this.uniformOpen();
      const us = 0.5 - Math.abs(U);
      const k = Math.floor(((2 * a) / us + b) * U + lambda + 0.43);
      if (us >= 0.07 && V <= vr) return k;
      if (k < 0 || (us < 0.013 && V > us)) continue;
      if (Math.log(V) + Math.log(invalpha) - Math.log(a / (us * us) + b) <= -lambda + k * loglam - logFactorialSmall(k)) {
        return k;
      }
    }
  }

  /**
   * Binomial(n, p). For n·min(p,1−p) < 30 uses inversion (sequential search);
   * otherwise samples via the beta–binomial recursion (Knuth, TAOCP 3.4.1),
   * which is exact and runs in O(log n) gamma draws.
   */
  binomial(n: number, p: number): number {
    if (p <= 0 || n === 0) return 0;
    if (p >= 1) return n;
    if (p > 0.5) return n - this.binomial(n, 1 - p);
    if (n * p < 30) {
      // Inversion by sequential search from 0.
      const q = 1 - p;
      const s = p / q;
      let prob = Math.pow(q, n);
      let cdf = prob;
      const u = this.source.next();
      let k = 0;
      while (u > cdf && k < n) {
        prob *= (s * (n - k)) / (k + 1);
        cdf += prob;
        k++;
        if (prob === 0 && cdf < u) break;
      }
      return k;
    }
    // Knuth's recursive method using order statistics of uniforms.
    const a = 1 + Math.floor(n / 2);
    const b = n + 1 - a;
    const x = this.beta(a, b);
    if (x >= p) return this.binomial(a - 1, p / x);
    return a + this.binomial(b - 1, (p - x) / (1 - x));
  }

  /** Number of failures before the first success, success probability p. */
  geometricFailures(p: number): number {
    if (p >= 1) return 0;
    return Math.floor(Math.log(this.uniformOpen()) / Math.log1p(-p));
  }

  /** Fisher–Yates shuffle in place. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  /** Index sampled from a discrete distribution given by non-negative weights. */
  categorical(cumulative: ArrayLike<number>): number {
    const total = cumulative[cumulative.length - 1];
    const u = this.source.next() * total;
    let lo = 0;
    let hi = cumulative.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (cumulative[mid] > u) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }
}

const LOG_FACT: number[] = [0];
function logFactorialSmall(k: number): number {
  for (let i = LOG_FACT.length; i <= k; i++) LOG_FACT[i] = LOG_FACT[i - 1] + Math.log(i);
  return LOG_FACT[k];
}

/** Alias table (Walker/Vose) for O(1) sampling from a fixed discrete distribution. */
export class AliasTable {
  private readonly prob: Float64Array;
  private readonly alias: Int32Array;

  constructor(weights: ArrayLike<number>) {
    const n = weights.length;
    let total = 0;
    for (let i = 0; i < n; i++) {
      if (!(weights[i] >= 0)) throw new RangeError('Weights must be non-negative.');
      total += weights[i];
    }
    if (!(total > 0)) throw new RangeError('At least one weight must be positive.');
    this.prob = new Float64Array(n);
    this.alias = new Int32Array(n);
    const scaled = new Float64Array(n);
    const small: number[] = [];
    const large: number[] = [];
    for (let i = 0; i < n; i++) {
      scaled[i] = (weights[i] * n) / total;
      (scaled[i] < 1 ? small : large).push(i);
    }
    while (small.length && large.length) {
      const s = small.pop()!;
      const l = large.pop()!;
      this.prob[s] = scaled[s];
      this.alias[s] = l;
      scaled[l] = scaled[l] + scaled[s] - 1;
      (scaled[l] < 1 ? small : large).push(l);
    }
    for (const i of large) this.prob[i] = 1;
    for (const i of small) this.prob[i] = 1;
  }

  sample(rng: Random): number {
    const n = this.prob.length;
    const i = Math.floor(rng.uniform() * n);
    return rng.uniform() < this.prob[i] ? i : this.alias[i];
  }
}

/** Generate a fresh random seed string for a new run (not security-sensitive). */
export function randomSeed(): string {
  const bytes = new Uint32Array(2);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else {
    bytes[0] = Math.floor(Math.random() * 0xffffffff);
    bytes[1] = Math.floor(Math.random() * 0xffffffff);
  }
  return (bytes[0].toString(36) + bytes[1].toString(36)).slice(0, 10);
}
