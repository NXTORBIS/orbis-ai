/**
 * Complex numbers, because quantum amplitudes are complex and nothing else here works without them.
 *
 * ## Why a plain pair rather than a class
 *
 * A state vector for ten qubits holds 1,024 amplitudes, and every gate rewrites all of them. A class with
 * methods allocates two objects per multiplication; a pair of numbers in a flat array allocates nothing. The
 * state vector in `state.ts` therefore stores interleaved real and imaginary parts, and this file exists for the
 * places where a single amplitude is read, written or shown.
 *
 * ## Nothing is rounded on the way through
 *
 * Rounding belongs at the edge, where a number is displayed. An engine that rounds internally accumulates error
 * and then disagrees with itself — the Bloch sphere saying one thing and the probability table another. Every
 * comparison here takes an explicit tolerance instead.
 */

export interface Complex {
  re: number
  im: number
}

export const complex = (re: number, im = 0): Complex => ({ re, im })

export const ZERO: Complex = Object.freeze({ re: 0, im: 0 })
export const ONE: Complex = Object.freeze({ re: 1, im: 0 })
export const I: Complex = Object.freeze({ re: 0, im: 1 })

export const add = (a: Complex, b: Complex): Complex => ({ re: a.re + b.re, im: a.im + b.im })
export const sub = (a: Complex, b: Complex): Complex => ({ re: a.re - b.re, im: a.im - b.im })

export const mul = (a: Complex, b: Complex): Complex => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re
})

export const scale = (a: Complex, k: number): Complex => ({ re: a.re * k, im: a.im * k })

/** The conjugate: the sign of the imaginary part flipped. What a bra is to a ket. */
export const conj = (a: Complex): Complex => ({ re: a.re, im: -a.im })

/** |z|², which for an amplitude is a probability. Cheaper than `abs` and what is almost always wanted. */
export const norm2 = (a: Complex): number => a.re * a.re + a.im * a.im

/** |z|, the length. */
export const abs = (a: Complex): number => Math.hypot(a.re, a.im)

/** The phase in radians, from −π to π. Zero for a zero amplitude, which has no meaningful phase. */
export const phase = (a: Complex): number => (a.re === 0 && a.im === 0 ? 0 : Math.atan2(a.im, a.re))

/** e^(iθ) — a pure phase, which is what every phase gate multiplies by. */
export const expI = (theta: number): Complex => ({ re: Math.cos(theta), im: Math.sin(theta) })

export const div = (a: Complex, b: Complex): Complex => {
  const d = norm2(b)
  if (d === 0) return { re: Number.NaN, im: Number.NaN }
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d }
}

/**
 * Whether two complex numbers are the same to within a tolerance.
 *
 * The tolerance is explicit and defaults to 1e-9. Floating-point arithmetic over a few hundred gates leaves
 * errors around 1e-15, so a tolerance this loose is generous — and declaring two mathematically identical
 * results different because of the fifteenth decimal place is the commonest way a quantum test lies.
 */
export const near = (a: Complex, b: Complex, tol = 1e-9): boolean =>
  Math.abs(a.re - b.re) <= tol && Math.abs(a.im - b.im) <= tol

export const nearNumber = (a: number, b: number, tol = 1e-9): boolean => Math.abs(a - b) <= tol

/**
 * A complex number as somebody would write it.
 *
 * `digits` decides the rounding, and the rounding happens here — at the edge, where a number is shown — rather
 * than in the arithmetic.
 */
export function show(a: Complex, digits = 3): string {
  const re = Number(a.re.toFixed(digits))
  const im = Number(a.im.toFixed(digits))
  if (im === 0) return `${re}`
  if (re === 0) return im === 1 ? 'i' : im === -1 ? '-i' : `${im}i`
  const sign = im < 0 ? '-' : '+'
  const size = Math.abs(im)
  return `${re} ${sign} ${size === 1 ? '' : size}i`
}

/** 1/√2, written out once because it appears in nearly every circuit in the course. */
export const INV_SQRT2 = Math.SQRT1_2
