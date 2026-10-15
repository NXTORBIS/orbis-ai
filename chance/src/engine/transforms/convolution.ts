/**
 * Exact and FFT convolution of lattice (arithmetic) distributions, and the
 * n-fold convolution by binary powering.
 *
 * A lattice distribution here is a probability vector on an arithmetic grid
 * origin, origin + step, origin + 2·step, … Both convolution routes are
 * offered because they fail in different ways:
 *
 *  - **Direct summation** is exact up to floating-point rounding, costs
 *    O(n·m), and a log-space variant keeps the far tail accurate where the
 *    linear one underflows to a flat zero.
 *  - **FFT** costs O(N log N) with N ≥ n + m − 1, but it computes a *cyclic*
 *    convolution: if the transform length were shorter than n + m − 1 the far
 *    tail would be folded back on to the head, which looks like a perfectly
 *    ordinary probability vector and is wrong. This module always pads to at
 *    least n + m − 1, so no wrap-around occurs, and it reports the rounding
 *    error it measured instead of claiming exactness.
 *
 * Which route ran is always reported, because the accuracy of the answer is a
 * property of that choice.
 */
import { EngineError } from '../core/result';
import type { Exactness } from '../core/result';
import { logSumExp, stableSum } from '../core/numeric';
import { getDistribution } from '../distributions/registry';
import type { Params } from '../distributions/types';
import { fft, nextPowerOfTwo } from './complex';

export interface Lattice {
  /** p[i] is the probability at value origin + i·step. */
  p: Float64Array;
  /** ln p[i], kept alongside so deep tails survive repeated convolution. */
  logP: Float64Array;
  origin: number;
  step: number;
}

export type ConvolutionRoute = 'direct' | 'direct-log' | 'fft';

export interface ConvolutionResult {
  lattice: Lattice;
  route: ConvolutionRoute;
  exactness: Exactness;
  /** Length of the FFT actually used, when the FFT route ran. */
  fftLength?: number;
  /** Largest magnitude of the imaginary/negative residue the FFT left behind. */
  roundingResidual?: number;
  /** Total mass of the result; a drift from 1 signals truncation upstream. */
  totalMass: number;
  notes: string[];
}

/** Beyond this many multiply-adds the direct route is considered too slow. */
export const DIRECT_CONVOLUTION_BUDGET = 4_000_000;

export function latticeValues(l: Lattice): number[] {
  const out = new Array<number>(l.p.length);
  for (let i = 0; i < l.p.length; i++) out[i] = l.origin + i * l.step;
  return out;
}

function logsOf(p: ArrayLike<number>): Float64Array {
  const out = new Float64Array(p.length);
  for (let i = 0; i < p.length; i++) out[i] = p[i] > 0 ? Math.log(p[i]) : -Infinity;
  return out;
}

export function makeLattice(p: ArrayLike<number>, origin: number, step: number, logP?: ArrayLike<number>): Lattice {
  if (p.length === 0) throw new EngineError('A lattice distribution needs at least one point.', 'invalid');
  if (!(step > 0) || !Number.isFinite(step)) throw new EngineError('The lattice step must be a finite positive number.', 'range');
  if (!Number.isFinite(origin)) throw new EngineError('The lattice origin must be finite.', 'finite');
  const arr = new Float64Array(p.length);
  for (let i = 0; i < p.length; i++) {
    const v = p[i];
    if (!Number.isFinite(v) || v < 0) {
      throw new EngineError(
        `Lattice probability at index ${i} is ${v}; a probability vector must hold finite non-negative values. No distribution is reported.`,
        'invalid',
      );
    }
    arr[i] = v;
  }
  const lg = logP ? Float64Array.from(logP) : logsOf(arr);
  if (lg.length !== arr.length) throw new EngineError('The lattice log-probability vector has a different length from the probability vector.', 'invalid');
  return { p: arr, logP: lg, origin, step };
}

/**
 * Discretise a registry discrete distribution on to its own integer lattice,
 * truncated so that at most `tailMass` is left out. The truncation is reported
 * so that a convolution built on it never claims more accuracy than its input.
 */
export function latticeFromDiscrete(
  id: string,
  params: Params,
  options: { tailMass?: number; maxPoints?: number } = {},
): { lattice: Lattice; omittedMass: number; lower: number; upper: number } {
  const def = getDistribution(id);
  if (def.kind !== 'discrete') {
    throw new EngineError(`"${id}" is continuous; use a discretisation method from the compound module instead of treating it as a lattice.`, 'invalid');
  }
  const tail = options.tailMass ?? 1e-15;
  const maxPoints = options.maxPoints ?? 2_000_000;
  const sup = def.support(params);
  const lo = Math.round(Number.isFinite(sup.min) ? sup.min : def.quantile(tail / 2, params));
  const hi = Math.round(Number.isFinite(sup.max) ? sup.max : def.quantile(1 - tail / 2, params));
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    throw new EngineError(`The support of "${id}" could not be truncated to a finite lattice at tail mass ${tail}.`, 'numerical');
  }
  const n = hi - lo + 1;
  if (n > maxPoints) {
    throw new EngineError(
      `Representing "${id}" on a lattice to tail mass ${tail} needs ${n} points, beyond the limit of ${maxPoints}. Raise the tolerated tail mass or use a transform method that does not need the full vector.`,
      'too-large',
    );
  }
  const p = new Float64Array(n);
  const lg = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    lg[i] = def.logPdf(lo + i, params);
    p[i] = lg[i] === -Infinity ? 0 : Math.exp(lg[i]);
  }
  const mass = stableSum(p);
  return {
    lattice: { p, logP: lg, origin: lo, step: 1 },
    omittedMass: Math.max(0, 1 - mass),
    lower: lo,
    upper: hi,
  };
}

function assertCompatible(a: Lattice, b: Lattice): void {
  const rel = Math.abs(a.step - b.step) / Math.max(a.step, b.step);
  if (rel > 1e-12) {
    throw new EngineError(
      `The two distributions live on different lattices (steps ${a.step} and ${b.step}). A convolution on a common grid needs the same step; no result is reported. Re-discretise one of them on to the other's step.`,
      'incompatible',
    );
  }
  // The origins must be commensurate with the step, or the convolved support
  // does not land on a single arithmetic grid.
  const originRatio = (a.origin + b.origin) / a.step;
  if (Number.isFinite(originRatio) && Math.abs(originRatio - Math.round(originRatio)) > 1e-9 * Math.max(1, Math.abs(originRatio))) {
    // This is permitted: the sum's origin is simply a.origin + b.origin.
    // Nothing to do, the grid is still arithmetic with the same step.
  }
}

/** Exact convolution by direct summation, in linear and in log space. */
function convolveDirect(a: Lattice, b: Lattice): ConvolutionResult {
  const n = a.p.length;
  const m = b.p.length;
  const out = new Float64Array(n + m - 1);
  const outLog = new Float64Array(n + m - 1);
  for (let k = 0; k < out.length; k++) {
    const iLo = Math.max(0, k - (m - 1));
    const iHi = Math.min(n - 1, k);
    const terms: number[] = [];
    const logTerms: number[] = [];
    for (let i = iLo; i <= iHi; i++) {
      terms.push(a.p[i] * b.p[k - i]);
      const l = a.logP[i] + b.logP[k - i];
      if (l !== -Infinity) logTerms.push(l);
    }
    out[k] = stableSum(terms);
    outLog[k] = logTerms.length ? logSumExp(logTerms) : -Infinity;
    // Where the linear value has underflowed to exactly zero but the log-space
    // value is finite, the log value is the only truthful one; the linear entry
    // stays 0 and callers reading the tail must use logP.
  }
  return {
    lattice: { p: out, logP: outLog, origin: a.origin + b.origin, step: a.step },
    route: 'direct-log',
    exactness: 'exact',
    totalMass: stableSum(out),
    notes: [
      `Direct summation over ${n}×${m} = ${n * m} products: exact up to floating-point rounding, with no wrap-around.`,
      'The log-space vector is computed alongside by log-sum-exp, so entries that underflow to 0 in the linear vector are still available as logP. A naive linear convolution would report those tail probabilities as exactly zero.',
    ],
  };
}

/** Convolution by zero-padded FFT; no wrap-around, but rounding error. */
function convolveFft(a: Lattice, b: Lattice): ConvolutionResult {
  const n = a.p.length;
  const m = b.p.length;
  const need = n + m - 1;
  const N = nextPowerOfTwo(need);
  if (N > 1 << 25) {
    throw new EngineError(
      `An FFT convolution of lengths ${n} and ${m} needs a transform length of ${N}, beyond the limit of ${1 << 25}. No result is reported.`,
      'too-large',
    );
  }
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const re2 = new Float64Array(N);
  const im2 = new Float64Array(N);
  re.set(a.p);
  re2.set(b.p);
  fft(re, im, false);
  fft(re2, im2, false);
  for (let i = 0; i < N; i++) {
    const pr = re[i] * re2[i] - im[i] * im2[i];
    const pi = re[i] * im2[i] + im[i] * re2[i];
    re[i] = pr;
    im[i] = pi;
  }
  fft(re, im, true);

  const out = new Float64Array(need);
  let residual = 0;
  for (let k = 0; k < need; k++) {
    residual = Math.max(residual, Math.abs(im[k]));
    const v = re[k];
    if (v < 0) {
      residual = Math.max(residual, -v);
      out[k] = 0;
    } else {
      out[k] = v;
    }
  }
  // Mass that leaked past index need-1 would be wrap-around; with this padding
  // it must be rounding only, so it is measured and reported.
  let leak = 0;
  for (let k = need; k < N; k++) leak = Math.max(leak, Math.abs(re[k]));
  residual = Math.max(residual, leak);

  return {
    lattice: { p: out, logP: logsOf(out), origin: a.origin + b.origin, step: a.step },
    route: 'fft',
    exactness: 'numerical',
    fftLength: N,
    roundingResidual: residual,
    totalMass: stableSum(out),
    notes: [
      `FFT convolution at transform length ${N} ≥ n + m − 1 = ${need}, so the cyclic convolution equals the linear one and no probability wraps around.`,
      `Measured rounding residue (largest spurious imaginary part, negative entry or out-of-range leak) is ${residual.toExponential(3)}. Any tail probability smaller than that figure is noise, not signal: for far-tail work use the direct route's log-space vector or a saddlepoint approximation.`,
      leak > 1e-9 ? `WARNING: the out-of-range leak ${leak.toExponential(3)} is large enough to indicate material wrap-around; treat the tail as unusable.` : 'No material wrap-around detected.',
    ],
  };
}

export interface ConvolveOptions {
  /** Force a route instead of choosing by size. */
  route?: 'direct' | 'fft';
}

/**
 * Convolve two lattice distributions, choosing the route by problem size and
 * reporting which one ran.
 */
export function convolveLattice(a: Lattice, b: Lattice, options: ConvolveOptions = {}): ConvolutionResult {
  assertCompatible(a, b);
  const cost = a.p.length * b.p.length;
  if (options.route === 'direct') return convolveDirect(a, b);
  if (options.route === 'fft') return convolveFft(a, b);
  if (cost <= DIRECT_CONVOLUTION_BUDGET) {
    const r = convolveDirect(a, b);
    r.notes.push(`Route chosen automatically: ${cost} products is within the direct budget of ${DIRECT_CONVOLUTION_BUDGET}, so the exact route was used.`);
    return r;
  }
  const r = convolveFft(a, b);
  r.notes.push(`Route chosen automatically: the direct route would need ${cost} products, beyond the budget of ${DIRECT_CONVOLUTION_BUDGET}, so the FFT route was used and the result is numerical rather than exact.`);
  return r;
}

/** Convolve a list of independent lattice distributions, left to right. */
export function convolveAll(parts: readonly Lattice[], options: ConvolveOptions = {}): ConvolutionResult {
  if (parts.length === 0) throw new EngineError('Convolving an empty list of distributions is undefined.', 'invalid');
  if (parts.length === 1) {
    return {
      lattice: parts[0],
      route: 'direct',
      exactness: 'exact',
      totalMass: stableSum(parts[0].p),
      notes: ['A single component needs no convolution.'],
    };
  }
  let acc = parts[0];
  let route: ConvolutionRoute = 'direct';
  let exactness: Exactness = 'exact';
  const notes: string[] = [];
  let residual = 0;
  for (let i = 1; i < parts.length; i++) {
    const r = convolveLattice(acc, parts[i], options);
    acc = r.lattice;
    route = r.route;
    if (r.exactness !== 'exact') exactness = 'numerical';
    residual = Math.max(residual, r.roundingResidual ?? 0);
    notes.push(`step ${i}: ${r.route}`);
  }
  return {
    lattice: acc,
    route,
    exactness,
    roundingResidual: residual > 0 ? residual : undefined,
    totalMass: stableSum(acc.p),
    notes: [
      `Convolved ${parts.length} independent components in sequence (${notes.join(', ')}).`,
      'Independence is assumed across the components. It is an assumption about the inputs, not a result of the transform.',
    ],
  };
}

export interface PowerResult extends ConvolutionResult {
  /** Number of pairwise convolutions actually performed. */
  convolutions: number;
  exponent: number;
}

/**
 * The n-fold convolution of a lattice distribution by binary powering:
 * ⌊log₂ n⌋ squarings plus one multiply per set bit, so O(log n) convolutions
 * rather than n − 1.
 */
export function convolvePower(a: Lattice, n: number, options: ConvolveOptions = {}): PowerResult {
  if (!Number.isInteger(n) || n < 1) {
    throw new EngineError('The convolution exponent n must be a whole number of at least 1.', 'range');
  }
  if (n === 1) {
    return {
      lattice: a,
      route: 'direct',
      exactness: 'exact',
      totalMass: stableSum(a.p),
      convolutions: 0,
      exponent: 1,
      notes: ['n = 1 needs no convolution.'],
    };
  }
  let result: Lattice | null = null;
  let base = a;
  let e = n;
  let count = 0;
  let exactness: Exactness = 'exact';
  let route: ConvolutionRoute = 'direct';
  let residual = 0;
  while (e > 0) {
    if (e & 1) {
      if (result === null) {
        result = base;
      } else {
        const r = convolveLattice(result, base, options);
        result = r.lattice;
        count++;
        route = r.route;
        if (r.exactness !== 'exact') exactness = 'numerical';
        residual = Math.max(residual, r.roundingResidual ?? 0);
      }
    }
    e >>= 1;
    if (e > 0) {
      const r = convolveLattice(base, base, options);
      base = r.lattice;
      count++;
      route = r.route;
      if (r.exactness !== 'exact') exactness = 'numerical';
      residual = Math.max(residual, r.roundingResidual ?? 0);
    }
  }
  if (result === null) throw new EngineError('Internal: binary powering produced no result.', 'numerical');
  return {
    lattice: result,
    route,
    exactness,
    roundingResidual: residual > 0 ? residual : undefined,
    totalMass: stableSum(result.p),
    convolutions: count,
    exponent: n,
    notes: [
      `${n}-fold convolution by binary powering: ${count} pairwise convolutions instead of ${n - 1}.`,
      'The components are assumed independent and identically distributed.',
      exactness === 'exact'
        ? 'Every step used the exact direct route, so the result is exact up to floating-point rounding.'
        : `At least one step used the FFT route; the largest measured rounding residue is ${residual.toExponential(3)}.`,
    ],
  };
}
