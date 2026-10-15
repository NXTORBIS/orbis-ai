/**
 * Complex arithmetic and the discrete Fourier transform used by every
 * transform method in this module.
 *
 * The radix-2 butterfly itself is NOT reimplemented here: `fftRadix2` in
 * `../timeseries/spectral` is already an in-place iterative Cooley–Tukey
 * transform over separate real and imaginary `Float64Array`s, which is exactly
 * the signature a complex FFT needs. This file adds what that module does not
 * have and does not need: the inverse transform, a Bluestein (chirp-z) path so
 * that a non-power-of-two length works without falling back to an O(n²) DFT,
 * and Parseval's identity as a self-check.
 *
 * Transform convention (shared with `spectral.ts`):
 *   forward:  X_k = Σ_t x_t e^{−2πi k t / n}
 *   inverse:  x_t = (1/n) Σ_k X_k e^{+2πi k t / n}
 */
import { EngineError } from '../core/result';
import { stableSum } from '../core/numeric';
import { fftRadix2 } from '../timeseries/spectral';

export interface Complex {
  re: number;
  im: number;
}

export const complex = (re: number, im = 0): Complex => ({ re, im });

export const ZERO: Complex = { re: 0, im: 0 };
export const ONE: Complex = { re: 1, im: 0 };

export function cAdd(a: Complex, b: Complex): Complex {
  return { re: a.re + b.re, im: a.im + b.im };
}

export function cSub(a: Complex, b: Complex): Complex {
  return { re: a.re - b.re, im: a.im - b.im };
}

export function cMul(a: Complex, b: Complex): Complex {
  return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}

export function cScale(a: Complex, s: number): Complex {
  return { re: a.re * s, im: a.im * s };
}

export function cConj(a: Complex): Complex {
  return { re: a.re, im: -a.im };
}

/**
 * Complex division by Smith's algorithm, which avoids overflow in |b|² when
 * the two parts of the denominator differ hugely in magnitude.
 */
export function cDiv(a: Complex, b: Complex): Complex {
  if (b.re === 0 && b.im === 0) {
    throw new EngineError('Complex division by zero: the denominator is exactly 0, so no quotient exists.', 'range');
  }
  if (Math.abs(b.re) >= Math.abs(b.im)) {
    const r = b.im / b.re;
    const d = b.re + b.im * r;
    return { re: (a.re + a.im * r) / d, im: (a.im - a.re * r) / d };
  }
  const r = b.re / b.im;
  const d = b.re * r + b.im;
  return { re: (a.re * r + a.im) / d, im: (a.im * r - a.re) / d };
}

export function cAbs(a: Complex): number {
  return Math.hypot(a.re, a.im);
}

export function cArg(a: Complex): number {
  return Math.atan2(a.im, a.re);
}

/** e^z. */
export function cExp(a: Complex): Complex {
  const m = Math.exp(a.re);
  return { re: m * Math.cos(a.im), im: m * Math.sin(a.im) };
}

/** Principal branch of log z; the branch cut is the negative real axis. */
export function cLog(a: Complex): Complex {
  if (a.re === 0 && a.im === 0) {
    throw new EngineError('Complex logarithm of 0 is undefined (−∞); no value is reported.', 'range');
  }
  return { re: Math.log(cAbs(a)), im: Math.atan2(a.im, a.re) };
}

/** z^p for real p, via the principal logarithm. */
export function cPowReal(a: Complex, p: number): Complex {
  if (a.re === 0 && a.im === 0) {
    if (p > 0) return { ...ZERO };
    throw new EngineError('0 raised to a non-positive power is undefined; no value is reported.', 'range');
  }
  return cExp(cScale(cLog(a), p));
}

/** e^{iθ}. */
export function cUnit(theta: number): Complex {
  return { re: Math.cos(theta), im: Math.sin(theta) };
}

function isPowerOfTwo(n: number): boolean {
  return n >= 1 && (n & (n - 1)) === 0;
}

/** Smallest power of two that is >= n. */
export function nextPowerOfTwo(n: number): number {
  if (n <= 1) return 1;
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * In-place complex FFT of any length >= 1. Power-of-two lengths go through the
 * shared radix-2 kernel; other lengths go through Bluestein's chirp-z
 * algorithm, which is O(n log n) rather than the O(n²) direct DFT.
 */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  if (im.length !== n) {
    throw new EngineError('FFT input: the real and imaginary arrays differ in length.', 'invalid');
  }
  if (n === 0) throw new EngineError('FFT input is empty; there is nothing to transform.', 'invalid');
  if (n === 1) return;

  if (inverse) {
    // x = conj(FFT(conj(X))) / n.
    for (let i = 0; i < n; i++) im[i] = -im[i];
    fft(re, im, false);
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] = -im[i] / n;
    }
    return;
  }

  if (isPowerOfTwo(n)) {
    fftRadix2(re, im);
    return;
  }
  bluestein(re, im);
}

/**
 * Bluestein's algorithm. Writing k t = (k² + t² − (k − t)²)/2, the DFT becomes
 * a convolution with the chirp w^{−(k−t)²/2}, which is evaluated by two
 * power-of-two FFTs and one inverse. The chirp angle is reduced modulo 2n
 * before the trigonometric call so that large indices do not lose precision.
 */
function bluestein(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  const m = nextPowerOfTwo(2 * n - 1);
  if (m > 1 << 24) {
    throw new EngineError(
      `A Bluestein transform of length ${n} needs a working length of ${m}, which exceeds the limit of ${1 << 24}. Use a shorter or power-of-two length.`,
      'too-large',
    );
  }

  const cosT = new Float64Array(n);
  const sinT = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // (i² mod 2n) keeps the argument small; the chirp has period 2n in i².
    const j = (i * i) % (2 * n);
    const ang = (Math.PI * j) / n;
    cosT[i] = Math.cos(ang);
    sinT[i] = Math.sin(ang);
  }

  // a_i = x_i · e^{−iπ i²/n}
  const ar = new Float64Array(m);
  const ai = new Float64Array(m);
  for (let i = 0; i < n; i++) {
    ar[i] = re[i] * cosT[i] + im[i] * sinT[i];
    ai[i] = -re[i] * sinT[i] + im[i] * cosT[i];
  }

  // b_i = e^{+iπ i²/n}, extended symmetrically so the cyclic convolution of
  // length m reproduces the linear convolution we want.
  const br = new Float64Array(m);
  const bi = new Float64Array(m);
  for (let i = 0; i < n; i++) {
    br[i] = cosT[i];
    bi[i] = sinT[i];
    if (i > 0) {
      br[m - i] = cosT[i];
      bi[m - i] = sinT[i];
    }
  }

  fftRadix2(ar, ai);
  fftRadix2(br, bi);
  for (let i = 0; i < m; i++) {
    const pr = ar[i] * br[i] - ai[i] * bi[i];
    const pi = ar[i] * bi[i] + ai[i] * br[i];
    ar[i] = pr;
    ai[i] = pi;
  }
  // Inverse transform of the product, by the conjugate trick on the kernel.
  for (let i = 0; i < m; i++) ai[i] = -ai[i];
  fftRadix2(ar, ai);
  for (let i = 0; i < m; i++) {
    ar[i] /= m;
    ai[i] = -ai[i] / m;
  }

  // X_k = e^{−iπ k²/n} · (a ∗ b)_k
  for (let k = 0; k < n; k++) {
    re[k] = ar[k] * cosT[k] + ai[k] * sinT[k];
    im[k] = -ar[k] * sinT[k] + ai[k] * cosT[k];
  }
}

/** Convenience wrapper: transform an array of `Complex` and return a new array. */
export function fftComplex(x: readonly Complex[], inverse = false): Complex[] {
  const n = x.length;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    re[i] = x[i].re;
    im[i] = x[i].im;
  }
  fft(re, im, inverse);
  const out = new Array<Complex>(n);
  for (let i = 0; i < n; i++) out[i] = { re: re[i], im: im[i] };
  return out;
}

export interface ParsevalCheck {
  /** Σ |x_t|². */
  timeEnergy: number;
  /** (1/n) Σ |X_k|². */
  frequencyEnergy: number;
  absoluteError: number;
  relativeError: number;
  /** True when the relative error is within `tolerance`. */
  holds: boolean;
  tolerance: number;
}

/**
 * Parseval's identity Σ|x_t|² = (1/n) Σ|X_k|², used as a self-check on a
 * transform. It is not a proof of correctness, but a transform that violates it
 * is certainly wrong, so every FFT-based route in this module can report it.
 */
export function parseval(x: readonly Complex[], X: readonly Complex[], tolerance = 1e-12): ParsevalCheck {
  if (x.length !== X.length) {
    throw new EngineError("Parseval's identity needs the time and frequency arrays to have the same length.", 'invalid');
  }
  const n = x.length;
  const timeEnergy = stableSum(x.map((z) => z.re * z.re + z.im * z.im));
  const frequencyEnergy = stableSum(X.map((z) => z.re * z.re + z.im * z.im)) / n;
  const absoluteError = Math.abs(timeEnergy - frequencyEnergy);
  const scale = Math.max(timeEnergy, frequencyEnergy);
  const relativeError = scale > 0 ? absoluteError / scale : 0;
  return { timeEnergy, frequencyEnergy, absoluteError, relativeError, holds: relativeError <= tolerance, tolerance };
}
