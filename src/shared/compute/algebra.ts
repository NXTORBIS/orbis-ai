/**
 * Exact arithmetic, polynomials, complex numbers, sequences and the assumptions that make symbolic work honest.
 *
 * The foundation the other mathematics modules stand on. `expression.ts` parses and differentiates; this holds the
 * number systems that let an answer stay exact instead of becoming 0.30000000000000004.
 *
 * ## Why rationals are bigints
 *
 * A rational built from two `number`s overflows quietly. Adding sevenths thirty times gives a denominator past 2^53 and
 * the result stops being exact without saying so -- which is the one failure an exact type exists to prevent. Bigints
 * cost speed and buy the guarantee.
 *
 * ## Why assumptions are stored rather than inferred
 *
 * `sqrt(x^2)` is `x` when `x >= 0` and `|x|` otherwise. A simplifier that picks the first is wrong half the time and
 * silent about it. So a symbol carries what is known about it, `simplifyRadical` and the rest ask, and a simplification
 * that needs an assumption nobody made does not happen.
 *
 * ## Exact until asked
 *
 * `sqrt(8)` stays `2*sqrt(2)`. `1/3` stays a third. A decimal is something a caller asks for, with a stated precision,
 * rather than something that happens on the way past.
 */

export interface AlgebraError {
  error: string
  message: string
}

export const isAlgebraError = (value: unknown): value is AlgebraError =>
  typeof value === 'object' && value !== null && 'error' in value && 'message' in value

const fail = (error: string, message: string): AlgebraError => ({ error, message })

export const ALGEBRA_LIMITS: Readonly<Record<'degree' | 'digits' | 'terms' | 'setSize' | 'iterations' | 'variables', number>> =
  Object.freeze({
    degree: 512,
    digits: 5_000,
    terms: 4_096,
    setSize: 100_000,
    iterations: 10_000,
    variables: 32
  })

// ---------------------------------------------------------------- rationals

/** An exact rational. Always reduced, and the sign always lives on the numerator. */
export interface Rational {
  n: bigint
  d: bigint
}

const gcdBig = (a: bigint, b: bigint): bigint => {
  let x = a < 0n ? -a : a
  let y = b < 0n ? -b : b
  while (y !== 0n) {
    const t = x % y
    x = y
    y = t
  }
  return x
}

/** A rational in lowest terms. The one constructor; nothing else builds the struct directly. */
export function rational(n: bigint | number, d: bigint | number = 1n): Rational | AlgebraError {
  const num = typeof n === 'bigint' ? n : BigInt(Math.trunc(n))
  const den = typeof d === 'bigint' ? d : BigInt(Math.trunc(d))
  if (typeof n === 'number' && !Number.isInteger(n)) return fail('invalid-argument', 'A rational is built from whole numbers. Use fromDecimal for a decimal.')
  if (typeof d === 'number' && !Number.isInteger(d)) return fail('invalid-argument', 'A rational is built from whole numbers.')
  if (den === 0n) return fail('division-by-zero', 'A rational cannot have a denominator of zero.')
  const g = gcdBig(num, den)
  const sign = den < 0n ? -1n : 1n
  return { n: (sign * num) / (g === 0n ? 1n : g), d: (sign * den) / (g === 0n ? 1n : g) }
}

export const ZERO: Rational = Object.freeze({ n: 0n, d: 1n })
export const ONE: Rational = Object.freeze({ n: 1n, d: 1n })

export const isZero = (one: Rational): boolean => one.n === 0n
export const isInteger = (one: Rational): boolean => one.d === 1n

export const addRational = (a: Rational, b: Rational): Rational => reduce(a.n * b.d + b.n * a.d, a.d * b.d)
export const subtractRational = (a: Rational, b: Rational): Rational => reduce(a.n * b.d - b.n * a.d, a.d * b.d)
export const multiplyRational = (a: Rational, b: Rational): Rational => reduce(a.n * b.n, a.d * b.d)

export function divideRational(a: Rational, b: Rational): Rational | AlgebraError {
  if (isZero(b)) return fail('division-by-zero', 'Nothing can be divided by zero.')
  return reduce(a.n * b.d, a.d * b.n)
}

export const negateRational = (one: Rational): Rational => ({ n: -one.n, d: one.d })
export const absRational = (one: Rational): Rational => ({ n: one.n < 0n ? -one.n : one.n, d: one.d })

/** Reduced, with the sign on the numerator. Internal, because it cannot fail for a non-zero denominator. */
function reduce(n: bigint, d: bigint): Rational {
  if (d === 0n) return ZERO
  const g = gcdBig(n, d)
  const sign = d < 0n ? -1n : 1n
  return { n: (sign * n) / (g === 0n ? 1n : g), d: (sign * d) / (g === 0n ? 1n : g) }
}

export function powerRational(base: Rational, exponent: number): Rational | AlgebraError {
  if (!Number.isInteger(exponent)) return fail('invalid-argument', 'An exact power needs a whole exponent. Use a decimal for anything else.')
  if (Math.abs(exponent) > ALGEBRA_LIMITS.degree) return fail('too-large', `An exponent past ${ALGEBRA_LIMITS.degree} is refused: the result would have more digits than Orbis holds.`)
  if (exponent === 0) {
    // 0^0 is left undefined rather than given the convenient answer. Which convention applies depends on the context,
    // and picking one here would make an ambiguity invisible.
    if (isZero(base)) return fail('undefined', 'Zero to the power zero has no single agreed value, so Orbis does not pick one.')
    return ONE
  }
  if (exponent < 0) {
    if (isZero(base)) return fail('division-by-zero', 'Zero has no negative power.')
    return reduce(base.d ** BigInt(-exponent), base.n ** BigInt(-exponent))
  }
  return reduce(base.n ** BigInt(exponent), base.d ** BigInt(exponent))
}

export function compareRational(a: Rational, b: Rational): -1 | 0 | 1 {
  const left = a.n * b.d
  const right = b.n * a.d
  return left < right ? -1 : left > right ? 1 : 0
}

export const equalRational = (a: Rational, b: Rational): boolean => a.n === b.n && a.d === b.d

/** The value as a double, which is a conversion and is named like one. */
export const toNumber = (one: Rational): number => Number(one.n) / Number(one.d)

/** A rational from a decimal string, exactly. `0.1` becomes one tenth, not the nearest double to one tenth. */
export function fromDecimal(source: string): Rational | AlgebraError {
  const trimmed = source.trim()
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(trimmed)
  if (!match || (match[2] === '' && (match[3] ?? '') === '')) {
    return fail('invalid-argument', `"${source}" is not a decimal number.`)
  }
  const sign = match[1] === '-' ? -1n : 1n
  const whole = match[2] === '' ? '0' : match[2]
  const fraction = match[3] ?? ''
  if (whole.length + fraction.length > ALGEBRA_LIMITS.digits) {
    return fail('too-large', `That has more than the ${ALGEBRA_LIMITS.digits} digits Orbis reads at once.`)
  }
  const exponent = match[4] === undefined ? 0 : Number(match[4])
  if (!Number.isFinite(exponent) || Math.abs(exponent) > ALGEBRA_LIMITS.digits) {
    return fail('too-large', 'That exponent is larger than Orbis handles.')
  }

  let n = sign * BigInt(whole + fraction)
  let d = 10n ** BigInt(fraction.length)
  if (exponent > 0) n *= 10n ** BigInt(exponent)
  else if (exponent < 0) d *= 10n ** BigInt(-exponent)
  return reduce(n, d)
}

/** A rational as a fraction, or as a whole number when it is one. */
export function rationalToText(one: Rational): string {
  return one.d === 1n ? one.n.toString() : `${one.n}/${one.d}`
}

export interface DecimalResult {
  text: string
  /** Whether the expansion terminates. A recurring decimal is marked rather than silently truncated. */
  exact: boolean
  /** The repeating part, when there is one. */
  repeating: string
}

/**
 * A rational as a decimal, with the recurrence found rather than rounded away.
 *
 * Long division, remembering the remainders. When a remainder repeats, everything since the first time it appeared is
 * the repeating block -- which is why a third comes back as `0.(3)` and not `0.3333333333`.
 */
export function toDecimal(one: Rational, maxDigits = 30): DecimalResult {
  const negative = one.n < 0n
  let n = negative ? -one.n : one.n
  const d = one.d
  const whole = n / d
  n %= d

  if (n === 0n) return { text: `${negative ? '-' : ''}${whole}`, exact: true, repeating: '' }

  const digits: string[] = []
  const seen = new Map<string, number>()
  let repeatFrom = -1
  for (let i = 0; i < maxDigits; i++) {
    const key = n.toString()
    if (seen.has(key)) {
      repeatFrom = seen.get(key) as number
      break
    }
    seen.set(key, i)
    n *= 10n
    digits.push((n / d).toString())
    n %= d
    if (n === 0n) break
  }

  const sign = negative ? '-' : ''
  if (repeatFrom >= 0) {
    const before = digits.slice(0, repeatFrom).join('')
    const cycle = digits.slice(repeatFrom).join('')
    return { text: `${sign}${whole}.${before}(${cycle})`, exact: false, repeating: cycle }
  }
  if (n !== 0n) {
    // Ran out of digits without terminating or repeating within the limit.
    return { text: `${sign}${whole}.${digits.join('')}...`, exact: false, repeating: '' }
  }
  return { text: `${sign}${whole}.${digits.join('')}`, exact: true, repeating: '' }
}

// ---------------------------------------------------------------- radicals

export interface Radical {
  /** The rational multiplier outside the root. */
  coefficient: Rational
  /** What is left under the root, always square-free. `1n` means there is no root left. */
  radicand: bigint
  index: 2
}

/**
 * A square root in its exact simplified form.
 *
 * `sqrt(8)` is `2*sqrt(2)`, not 2.8284271247461903. The square factors are pulled out by trial division, which is
 * enough for the sizes a person types and honest about its limit: past the bound the radicand is left as it is rather
 * than a partial factorisation being presented as complete.
 */
export function simplifyRadical(value: bigint): Radical | AlgebraError {
  if (value < 0n) return fail('not-real', 'The square root of a negative number is not real. Use a complex number for it.')
  if (value === 0n) return { coefficient: ZERO, radicand: 1n, index: 2 }

  let outside = 1n
  let inside = value
  // Trial division by squares. The bound is where this stops being fast, and past it the radicand is simply left.
  for (let factor = 2n; factor * factor <= inside && factor < 1_000_000n; factor++) {
    const square = factor * factor
    while (inside % square === 0n) {
      inside /= square
      outside *= factor
    }
  }

  const coefficient = rational(outside)
  if (isAlgebraError(coefficient)) return coefficient
  return { coefficient, radicand: inside, index: 2 }
}

export function radicalToText(one: Radical): string {
  if (one.radicand === 1n) return rationalToText(one.coefficient)
  if (equalRational(one.coefficient, ONE)) return `sqrt(${one.radicand})`
  if (isZero(one.coefficient)) return '0'
  return `${rationalToText(one.coefficient)}*sqrt(${one.radicand})`
}

/** Whether a bigint is a perfect square, and its root when it is. Newton's method on integers, so it is exact. */
export function integerSquareRoot(value: bigint): { root: bigint; exact: boolean } | AlgebraError {
  if (value < 0n) return fail('not-real', 'A negative number has no real square root.')
  if (value < 2n) return { root: value, exact: true }
  let x = value
  let y = (x + 1n) / 2n
  while (y < x) {
    x = y
    y = (x + value / x) / 2n
  }
  return { root: x, exact: x * x === value }
}

// ---------------------------------------------------------------- complex numbers

export interface Complex {
  re: number
  im: number
}

export const complex = (re: number, im = 0): Complex => ({ re, im })

export const addComplex = (a: Complex, b: Complex): Complex => ({ re: a.re + b.re, im: a.im + b.im })
export const subtractComplex = (a: Complex, b: Complex): Complex => ({ re: a.re - b.re, im: a.im - b.im })
export const multiplyComplex = (a: Complex, b: Complex): Complex => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re
})

export function divideComplex(a: Complex, b: Complex): Complex | AlgebraError {
  const denominator = b.re * b.re + b.im * b.im
  if (denominator === 0) return fail('division-by-zero', 'Nothing can be divided by zero.')
  return { re: (a.re * b.re + a.im * b.im) / denominator, im: (a.im * b.re - a.re * b.im) / denominator }
}

export const conjugate = (one: Complex): Complex => ({ re: one.re, im: -one.im })
export const modulus = (one: Complex): number => Math.hypot(one.re, one.im)
/** The principal argument, in (-pi, pi]. Undefined at the origin, where `atan2` returns 0 and the angle has no meaning. */
export const argument = (one: Complex): number => Math.atan2(one.im, one.re)

export function powerComplex(base: Complex, exponent: number): Complex {
  const r = modulus(base)
  const theta = argument(base)
  const scaled = r ** exponent
  return { re: scaled * Math.cos(theta * exponent), im: scaled * Math.sin(theta * exponent) }
}

/**
 * Every nth root of a complex number, not just the principal one.
 *
 * A number has n of them, evenly spaced around a circle, and returning one would hide the others. The rotation by
 * `2*pi*k/n` is what produces them.
 */
export function rootsOfComplex(value: Complex, n: number): Complex[] | AlgebraError {
  if (!Number.isInteger(n) || n < 1) return fail('invalid-argument', 'An nth root needs a whole n of at least one.')
  if (n > 1000) return fail('too-large', 'Orbis finds at most 1000 roots at once.')
  const r = modulus(value) ** (1 / n)
  const theta = argument(value)
  return Array.from({ length: n }, (_, k) => {
    const angle = (theta + 2 * Math.PI * k) / n
    return { re: r * Math.cos(angle), im: r * Math.sin(angle) }
  })
}

export function complexToText(one: Complex, digits = 6): string {
  const re = Number(one.re.toPrecision(digits))
  const im = Number(one.im.toPrecision(digits))
  if (im === 0) return String(re)
  if (re === 0) return im === 1 ? 'i' : im === -1 ? '-i' : `${im}i`
  const sign = im < 0 ? '-' : '+'
  const magnitude = Math.abs(im)
  return `${re} ${sign} ${magnitude === 1 ? '' : magnitude}i`
}

// ---------------------------------------------------------------- polynomials

/** Coefficients from the constant term upward, exactly. Index `i` is the coefficient of `x^i`. */
export interface Polynomial {
  coefficients: Rational[]
  variable: string
}

/** A polynomial with trailing zeros removed, so the degree is the degree. */
export function polynomial(coefficients: readonly Rational[], variable = 'x'): Polynomial | AlgebraError {
  if (coefficients.length > ALGEBRA_LIMITS.degree + 1) {
    return fail('too-large', `A polynomial of degree past ${ALGEBRA_LIMITS.degree} is refused.`)
  }
  const trimmed = [...coefficients]
  while (trimmed.length > 1 && isZero(trimmed[trimmed.length - 1])) trimmed.pop()
  if (trimmed.length === 0) trimmed.push(ZERO)
  return { coefficients: trimmed, variable }
}

/** The degree. `-1` for the zero polynomial, which has no degree and should not be reported as having degree zero. */
export const degreeOf = (one: Polynomial): number =>
  one.coefficients.length === 1 && isZero(one.coefficients[0]) ? -1 : one.coefficients.length - 1

export function addPolynomials(a: Polynomial, b: Polynomial): Polynomial | AlgebraError {
  const length = Math.max(a.coefficients.length, b.coefficients.length)
  const out: Rational[] = []
  for (let i = 0; i < length; i++) {
    out.push(addRational(a.coefficients[i] ?? ZERO, b.coefficients[i] ?? ZERO))
  }
  return polynomial(out, a.variable)
}

export function subtractPolynomials(a: Polynomial, b: Polynomial): Polynomial | AlgebraError {
  const length = Math.max(a.coefficients.length, b.coefficients.length)
  const out: Rational[] = []
  for (let i = 0; i < length; i++) {
    out.push(subtractRational(a.coefficients[i] ?? ZERO, b.coefficients[i] ?? ZERO))
  }
  return polynomial(out, a.variable)
}

export function multiplyPolynomials(a: Polynomial, b: Polynomial): Polynomial | AlgebraError {
  const length = a.coefficients.length + b.coefficients.length - 1
  if (length > ALGEBRA_LIMITS.degree + 1) {
    return fail('too-large', `Multiplying those gives a polynomial of degree ${length - 1}, past the ${ALGEBRA_LIMITS.degree} allowed.`)
  }
  const out: Rational[] = new Array(length).fill(ZERO)
  for (let i = 0; i < a.coefficients.length; i++) {
    for (let j = 0; j < b.coefficients.length; j++) {
      out[i + j] = addRational(out[i + j], multiplyRational(a.coefficients[i], b.coefficients[j]))
    }
  }
  return polynomial(out, a.variable)
}

export interface Division {
  quotient: Polynomial
  remainder: Polynomial
  describe: string
}

/** Long division, exactly. The remainder is kept rather than discarded; it is half the answer. */
export function dividePolynomials(a: Polynomial, b: Polynomial): Division | AlgebraError {
  if (degreeOf(b) < 0) return fail('division-by-zero', 'A polynomial cannot be divided by zero.')
  if (degreeOf(a) < degreeOf(b)) {
    const quotient = polynomial([ZERO], a.variable)
    if (isAlgebraError(quotient)) return quotient
    return { quotient, remainder: a, describe: 'The divisor has a higher degree, so the quotient is zero and everything is remainder.' }
  }

  const work = [...a.coefficients]
  const divisorDegree = degreeOf(b)
  const lead = b.coefficients[divisorDegree]
  const quotient: Rational[] = new Array(degreeOf(a) - divisorDegree + 1).fill(ZERO)

  for (let i = degreeOf(a); i >= divisorDegree; i--) {
    const factor = divideRational(work[i], lead)
    if (isAlgebraError(factor)) return factor
    quotient[i - divisorDegree] = factor
    if (isZero(factor)) continue
    for (let j = 0; j <= divisorDegree; j++) {
      work[i - divisorDegree + j] = subtractRational(work[i - divisorDegree + j], multiplyRational(factor, b.coefficients[j]))
    }
  }

  const q = polynomial(quotient, a.variable)
  if (isAlgebraError(q)) return q
  const r = polynomial(work.slice(0, divisorDegree), a.variable)
  if (isAlgebraError(r)) return r
  return {
    quotient: q,
    remainder: r,
    describe: degreeOf(r) < 0 ? 'The division is exact; there is no remainder.' : `There is a remainder of ${polynomialToText(r)}.`
  }
}

/** The value at a point, by Horner's method: fewest multiplications and least growth in the intermediate numbers. */
export function evaluatePolynomial(one: Polynomial, at: Rational): Rational {
  let result = ZERO
  for (let i = one.coefficients.length - 1; i >= 0; i--) {
    result = addRational(multiplyRational(result, at), one.coefficients[i])
  }
  return result
}

export function derivativeOf(one: Polynomial): Polynomial | AlgebraError {
  if (degreeOf(one) <= 0) return polynomial([ZERO], one.variable)
  const out: Rational[] = []
  for (let i = 1; i < one.coefficients.length; i++) {
    const power = rational(i)
    if (isAlgebraError(power)) return power
    out.push(multiplyRational(one.coefficients[i], power))
  }
  return polynomial(out, one.variable)
}

/** The antiderivative with a constant of zero. The constant is not invented; it is stated as chosen. */
export function antiderivativeOf(one: Polynomial): Polynomial | AlgebraError {
  const out: Rational[] = [ZERO]
  for (let i = 0; i < one.coefficients.length; i++) {
    const divisor = rational(i + 1)
    if (isAlgebraError(divisor)) return divisor
    const term = divideRational(one.coefficients[i], divisor)
    if (isAlgebraError(term)) return term
    out.push(term)
  }
  return polynomial(out, one.variable)
}

export interface RootFinding {
  /** Roots found exactly, as rationals. */
  rational: Rational[]
  /** Roots found numerically, including complex ones. */
  numeric: Complex[]
  /** The part that could not be factored over the rationals. */
  remaining: Polynomial
  /** Whether every root was found. A quintic with no rational roots is honest about not being solvable by radicals. */
  complete: boolean
  method: string[]
  notes: string[]
}

/**
 * The roots of a polynomial: exactly where that is possible, numerically where it is not.
 *
 * Rational roots first, by the rational root theorem -- every rational root has a numerator dividing the constant term
 * and a denominator dividing the leading one, so the candidates are a finite list to test exactly. What is left is
 * solved in closed form up to degree two and numerically above it.
 *
 * Nothing here claims a closed form for a general quintic, because there is not one. The result says which roots are
 * exact and which are approximations, and the two are never mixed into one list.
 */
export function rootsOf(one: Polynomial): RootFinding | AlgebraError {
  const degree = degreeOf(one)
  if (degree < 0) return fail('undefined', 'The zero polynomial is zero everywhere, so every number is a root.')
  if (degree === 0) {
    return { rational: [], numeric: [], remaining: one, complete: true, method: [], notes: ['A constant polynomial has no roots unless it is zero.'] }
  }

  const method: string[] = []
  const notes: string[] = []
  const exact: Rational[] = []
  let current = one

  // Factor out x where the constant term is zero: a root at zero, found before anything else has to work for it.
  while (degreeOf(current) > 0 && isZero(current.coefficients[0])) {
    exact.push(ZERO)
    const shifted = polynomial(current.coefficients.slice(1), current.variable)
    if (isAlgebraError(shifted)) return shifted
    current = shifted
    if (!method.includes('factored out x')) method.push('factored out x')
  }

  if (degreeOf(current) > 0) {
    const candidates = rationalRootCandidates(current)
    if (isAlgebraError(candidates)) return candidates
    if (candidates.length > 0) method.push('rational root theorem')
    for (const candidate of candidates) {
      // Repeatedly, because a root can be repeated and dividing once would leave it.
      while (degreeOf(current) > 0 && isZero(evaluatePolynomial(current, candidate))) {
        exact.push(candidate)
        const divisor = polynomial([negateRational(candidate), ONE], current.variable)
        if (isAlgebraError(divisor)) return divisor
        const divided = dividePolynomials(current, divisor)
        if (isAlgebraError(divided)) return divided
        current = divided.quotient
      }
    }
  }

  const numeric: Complex[] = []
  const left = degreeOf(current)

  if (left === 2) {
    method.push('quadratic formula')
    const a = toNumber(current.coefficients[2])
    const b = toNumber(current.coefficients[1])
    const c = toNumber(current.coefficients[0])
    const discriminant = b * b - 4 * a * c
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant)
      numeric.push(complex((-b + root) / (2 * a)), complex((-b - root) / (2 * a)))
      notes.push(`The discriminant is ${Number(discriminant.toPrecision(6))}, which is not negative, so both remaining roots are real.`)
    } else {
      const root = Math.sqrt(-discriminant)
      numeric.push({ re: -b / (2 * a), im: root / (2 * a) }, { re: -b / (2 * a), im: -root / (2 * a) })
      notes.push(`The discriminant is ${Number(discriminant.toPrecision(6))}, which is negative, so the remaining roots are a complex conjugate pair.`)
    }
  } else if (left === 1) {
    method.push('linear')
    const solved = divideRational(negateRational(current.coefficients[0]), current.coefficients[1])
    if (isAlgebraError(solved)) return solved
    exact.push(solved)
    const remainder = polynomial([ONE], current.variable)
    if (isAlgebraError(remainder)) return remainder
    current = remainder
  } else if (left > 2) {
    method.push('numerical (Durand-Kerner)')
    const found = numericRoots(current)
    if (isAlgebraError(found)) return found
    numeric.push(...found)
    notes.push(
      `The remaining degree ${left} factor has no rational roots. Its roots were found numerically; past degree four there is no general formula in radicals, so this is not a shortcoming of the method.`
    )
  }

  const complete = degreeOf(current) <= 0 || left === 1 || left === 2 || left > 2
  if (exact.length > 0) {
    notes.push(`${exact.length} root${exact.length === 1 ? ' was' : 's were'} found exactly. The rest, where there are any, are numerical approximations.`)
  }

  return { rational: exact, numeric, remaining: current, complete, method, notes }
}

/** Every rational that could be a root, by the rational root theorem. A finite list, each tested exactly. */
function rationalRootCandidates(one: Polynomial): Rational[] | AlgebraError {
  const degree = degreeOf(one)
  if (degree < 1) return []

  // Clear denominators so the theorem applies: it is about integer coefficients.
  let multiplier = 1n
  for (const coefficient of one.coefficients) multiplier = (multiplier * coefficient.d) / gcdBig(multiplier, coefficient.d)
  const integers = one.coefficients.map((coefficient) => (coefficient.n * multiplier) / coefficient.d)

  const constant = integers[0] < 0n ? -integers[0] : integers[0]
  const leading = integers[degree] < 0n ? -integers[degree] : integers[degree]
  if (constant === 0n || leading === 0n) return []
  // Past this the divisor search is slower than it is worth, and an incomplete candidate list would silently miss roots.
  if (constant > 10n ** 12n || leading > 10n ** 12n) return []

  const divisors = (value: bigint): bigint[] => {
    const out: bigint[] = []
    for (let i = 1n; i * i <= value; i++) {
      if (value % i !== 0n) continue
      out.push(i)
      if (i !== value / i) out.push(value / i)
    }
    return out
  }

  const candidates: Rational[] = []
  const seen = new Set<string>()
  for (const p of divisors(constant)) {
    for (const q of divisors(leading)) {
      for (const sign of [1n, -1n]) {
        const candidate = rational(sign * p, q)
        if (isAlgebraError(candidate)) continue
        const key = `${candidate.n}/${candidate.d}`
        if (seen.has(key)) continue
        seen.add(key)
        candidates.push(candidate)
      }
    }
  }
  return candidates
}

/**
 * All roots of a polynomial, by Durand-Kerner.
 *
 * Every root at once rather than one at a time with deflation: deflating after each root accumulates error, so the
 * last root of a degree-ten polynomial found that way can be badly wrong while looking fine.
 */
export function numericRoots(one: Polynomial, iterations = 500): Complex[] | AlgebraError {
  const degree = degreeOf(one)
  if (degree < 1) return fail('invalid-argument', 'A constant has no roots to find.')

  const coefficients = one.coefficients.map(toNumber)
  const lead = coefficients[degree]
  const monic = coefficients.map((value) => value / lead)

  const at = (z: Complex): Complex => {
    let result = complex(0)
    for (let i = degree; i >= 0; i--) result = addComplex(multiplyComplex(result, z), complex(monic[i]))
    return result
  }

  // The classic start: powers of a point off the real axis, so no two guesses coincide and none sits on a root.
  const start = complex(0.4, 0.9)
  let guesses = Array.from({ length: degree }, (_, i) => powerComplex(start, i))

  for (let step = 0; step < iterations; step++) {
    let moved = 0
    const next = guesses.map((z, i) => {
      let denominator = complex(1)
      for (let j = 0; j < degree; j++) {
        if (i === j) continue
        denominator = multiplyComplex(denominator, subtractComplex(z, guesses[j]))
      }
      const delta = divideComplex(at(z), denominator)
      if (isAlgebraError(delta)) return z
      moved = Math.max(moved, modulus(delta))
      return subtractComplex(z, delta)
    })
    guesses = next
    if (moved < 1e-14) break
  }

  // A root within rounding of the real axis is reported as real: an imaginary part of 1e-16 is arithmetic noise, and
  // showing it makes a real root look complex.
  return guesses.map((one2) => (Math.abs(one2.im) < 1e-10 * Math.max(1, Math.abs(one2.re)) ? complex(one2.re) : one2))
}

export function polynomialToText(one: Polynomial): string {
  const degree = degreeOf(one)
  if (degree < 0) return '0'
  const parts: string[] = []
  for (let i = degree; i >= 0; i--) {
    const coefficient = one.coefficients[i]
    if (isZero(coefficient)) continue
    const negative = coefficient.n < 0n
    const magnitude = absRational(coefficient)
    const text = equalRational(magnitude, ONE) && i > 0 ? '' : rationalToText(magnitude)
    const power = i === 0 ? '' : i === 1 ? one.variable : `${one.variable}^${i}`
    parts.push(`${parts.length === 0 ? (negative ? '-' : '') : negative ? ' - ' : ' + '}${text}${power}`)
  }
  return parts.length === 0 ? '0' : parts.join('')
}

// ---------------------------------------------------------------- assumptions

export type Domain = 'natural' | 'integer' | 'rational' | 'real' | 'complex'

export interface Assumption {
  symbol: string
  domain: Domain
  /** `null` where nothing is known. Not zero, which is a claim. */
  positive: boolean | null
  nonZero: boolean | null
  integer: boolean | null
  /** An explicit interval, when one was stated. */
  between: { low: number; high: number; inclusive: boolean } | null
}

export const unknownAssumption = (symbol: string): Assumption => ({
  symbol,
  domain: 'complex',
  positive: null,
  nonZero: null,
  integer: null,
  between: null
})

/** What follows from a domain, filled in once rather than re-derived at every use. */
export function assume(symbol: string, domain: Domain, extra: Partial<Assumption> = {}): Assumption {
  const base: Assumption = {
    symbol,
    domain,
    positive: extra.positive ?? null,
    nonZero: extra.nonZero ?? null,
    integer: domain === 'natural' || domain === 'integer' ? true : (extra.integer ?? null),
    between: extra.between ?? null
  }
  if (domain === 'natural') {
    // A natural number is not negative. Whether it can be zero is a convention, so it is left unstated rather than
    // picked -- some fields include zero and some do not, and neither is wrong.
    base.positive = extra.positive ?? null
  }
  return base
}

export interface SimplificationCheck {
  allowed: boolean
  result: string
  /** What would have to be known for a refused simplification to be allowed. */
  needs: string
  describe: string
}

/**
 * Whether a simplification is valid given what is known.
 *
 * The example that makes the point: `sqrt(x^2)` is `x` only when `x` is not negative, and `|x|` otherwise. A simplifier
 * that returns `x` unconditionally is wrong for every negative value and says nothing about it. This refuses and names
 * the assumption that would make it right.
 */
export function canSimplify(rule: string, assumption: Assumption): SimplificationCheck {
  switch (rule) {
    case 'sqrt(x^2)':
      if (assumption.positive === true) {
        return { allowed: true, result: assumption.symbol, needs: '', describe: `${assumption.symbol} is not negative, so the square root of its square is itself.` }
      }
      return {
        allowed: false,
        result: `|${assumption.symbol}|`,
        needs: `${assumption.symbol} >= 0`,
        describe: `Without knowing that ${assumption.symbol} is not negative, the square root of its square is the absolute value, not ${assumption.symbol}. For a negative ${assumption.symbol} the two differ by a sign.`
      }

    case 'x/x':
      if (assumption.nonZero === true) {
        return { allowed: true, result: '1', needs: '', describe: `${assumption.symbol} is not zero, so it cancels.` }
      }
      return {
        allowed: false,
        result: '1',
        needs: `${assumption.symbol} != 0`,
        describe: `Cancelling ${assumption.symbol} assumes it is not zero. Where it is, the expression is undefined rather than one, and cancelling would hide that.`
      }

    case 'log(x^n)':
      if (assumption.positive === true) {
        return { allowed: true, result: `n*log(${assumption.symbol})`, needs: '', describe: `${assumption.symbol} is positive, so the exponent comes out of the logarithm.` }
      }
      return {
        allowed: false,
        result: `n*log(${assumption.symbol})`,
        needs: `${assumption.symbol} > 0`,
        describe: `Bringing the exponent out of a logarithm needs ${assumption.symbol} to be positive. For a negative ${assumption.symbol} with an even exponent the left side is defined and the right is not.`
      }

    case '(x^a)^b':
      if (assumption.positive === true || assumption.integer === true) {
        return { allowed: true, result: `${assumption.symbol}^(a*b)`, needs: '', describe: 'The exponents combine.' }
      }
      return {
        allowed: false,
        result: `${assumption.symbol}^(a*b)`,
        needs: `${assumption.symbol} > 0, or whole exponents`,
        describe: 'Combining exponents needs a positive base or whole exponents. Otherwise the two sides can pick different branches.'
      }

    default:
      return { allowed: false, result: '', needs: '', describe: `Orbis has no rule called "${rule}".` }
  }
}

/** Whether a value is consistent with what is assumed about a symbol. */
export function satisfies(value: number, assumption: Assumption): { ok: boolean; why: string } {
  if (!Number.isFinite(value)) return { ok: false, why: 'That is not a finite number.' }
  if (assumption.integer === true && !Number.isInteger(value)) return { ok: false, why: `${assumption.symbol} is a whole number.` }
  if (assumption.domain === 'natural' && value < 0) return { ok: false, why: `${assumption.symbol} is a natural number and cannot be negative.` }
  if (assumption.positive === true && value < 0) return { ok: false, why: `${assumption.symbol} is not negative.` }
  if (assumption.nonZero === true && value === 0) return { ok: false, why: `${assumption.symbol} is not zero.` }
  if (assumption.between) {
    const { low, high, inclusive } = assumption.between
    if (inclusive ? value < low || value > high : value <= low || value >= high) {
      return { ok: false, why: `${assumption.symbol} is between ${low} and ${high}.` }
    }
  }
  return { ok: true, why: '' }
}

// ---------------------------------------------------------------- sequences and series

export type SequenceRule =
  | { kind: 'explicit'; formula: (n: number) => number }
  | { kind: 'arithmetic'; first: number; difference: number }
  | { kind: 'geometric'; first: number; ratio: number }
  /** Each term from the previous ones. `seeds` gives as many starting values as the recurrence needs. */
  | { kind: 'recursive'; seeds: number[]; step: (previous: readonly number[], n: number) => number }

export interface SequenceAnalysis {
  terms: number[]
  differences: number[]
  ratios: number[]
  /** A pattern the terms are consistent with. Never called proven, because finitely many terms cannot prove one. */
  pattern: { kind: 'arithmetic' | 'geometric' | 'quadratic' | 'none'; describe: string; parameter: number | null }
  monotone: 'increasing' | 'decreasing' | 'constant' | 'neither'
  /** Where the terms repeat. Only ever reported from terms actually generated. */
  period: number | null
  notes: string[]
}

/** The first `count` terms of a sequence. */
export function termsOf(rule: SequenceRule, count: number): number[] | AlgebraError {
  if (!Number.isInteger(count) || count < 1) return fail('invalid-argument', 'A sequence needs a whole number of terms, at least one.')
  if (count > ALGEBRA_LIMITS.terms) return fail('too-large', `Orbis generates at most ${ALGEBRA_LIMITS.terms} terms at once.`)

  const terms: number[] = []
  switch (rule.kind) {
    case 'explicit':
      for (let n = 1; n <= count; n++) {
        const value = rule.formula(n)
        if (!Number.isFinite(value)) {
          return fail('not-finite', `Term ${n} has no finite value, so the sequence stops there rather than continuing with a made-up number.`)
        }
        terms.push(value)
      }
      break

    case 'arithmetic':
      // first + (n-1)*difference, computed rather than accumulated: repeated addition drifts.
      for (let n = 0; n < count; n++) terms.push(rule.first + n * rule.difference)
      break

    case 'geometric':
      for (let n = 0; n < count; n++) terms.push(rule.first * rule.ratio ** n)
      break

    case 'recursive': {
      if (rule.seeds.length === 0) return fail('invalid-argument', 'A recursive sequence needs at least one starting value.')
      terms.push(...rule.seeds.slice(0, count))
      for (let n = terms.length; n < count; n++) {
        const value = rule.step(terms, n + 1)
        if (!Number.isFinite(value)) {
          return fail('not-finite', `Term ${n + 1} has no finite value. The sequence stops there.`)
        }
        terms.push(value)
      }
      break
    }
  }
  return terms
}

/**
 * What a sequence's terms are consistent with.
 *
 * Deliberately worded as consistency, never as proof. Any finite list of terms fits infinitely many rules, and a
 * "pattern found" that reads as a theorem is the single most misleading thing a sequence tool can say.
 */
export function analyseSequence(terms: readonly number[]): SequenceAnalysis | AlgebraError {
  if (terms.length < 2) return fail('invalid-argument', 'At least two terms are needed to say anything about a sequence.')

  const differences: number[] = []
  for (let i = 1; i < terms.length; i++) differences.push(terms[i] - terms[i - 1])

  const ratios: number[] = []
  for (let i = 1; i < terms.length; i++) ratios.push(terms[i - 1] === 0 ? Number.NaN : terms[i] / terms[i - 1])

  const close = (values: readonly number[]): boolean => {
    if (values.length === 0) return false
    const first = values[0]
    if (!Number.isFinite(first)) return false
    const scale = Math.max(1e-12, Math.abs(first))
    return values.every((one) => Number.isFinite(one) && Math.abs(one - first) < scale * 1e-9)
  }

  let pattern: SequenceAnalysis['pattern'] = { kind: 'none', describe: 'The terms given do not fit an arithmetic, geometric or quadratic rule.', parameter: null }
  if (close(differences)) {
    pattern = {
      kind: 'arithmetic',
      describe: `The terms given are consistent with an arithmetic sequence with a common difference of ${Number(differences[0].toPrecision(10))}. Finitely many terms cannot prove that the rest of the sequence follows it.`,
      parameter: differences[0]
    }
  } else if (close(ratios)) {
    pattern = {
      kind: 'geometric',
      describe: `The terms given are consistent with a geometric sequence with a common ratio of ${Number(ratios[0].toPrecision(10))}. Finitely many terms cannot prove that the rest of the sequence follows it.`,
      parameter: ratios[0]
    }
  } else if (differences.length >= 2) {
    const second: number[] = []
    for (let i = 1; i < differences.length; i++) second.push(differences[i] - differences[i - 1])
    if (close(second)) {
      pattern = {
        kind: 'quadratic',
        describe: `The second differences are constant at ${Number(second[0].toPrecision(10))}, which is consistent with a quadratic rule. Finitely many terms cannot prove one.`,
        parameter: second[0]
      }
    }
  }

  const increasing = differences.every((one) => one > 0)
  const decreasing = differences.every((one) => one < 0)
  const constant = differences.every((one) => one === 0)

  let period: number | null = null
  for (let length = 1; length <= Math.floor(terms.length / 2); length++) {
    let repeats = true
    for (let i = length; i < terms.length && repeats; i++) {
      if (terms[i] !== terms[i - length]) repeats = false
    }
    if (repeats) {
      period = length
      break
    }
  }

  const notes = ['A sequence rule cannot be established from a finite number of terms. What is reported is what the terms given are consistent with.']
  if (period !== null) notes.push(`The ${terms.length} terms given repeat with a period of ${period}. That is a property of these terms, not a proof about the sequence.`)

  return {
    terms: [...terms],
    differences,
    ratios,
    pattern,
    monotone: constant ? 'constant' : increasing ? 'increasing' : decreasing ? 'decreasing' : 'neither',
    period,
    notes
  }
}

export interface SeriesResult {
  partialSums: number[]
  /** The sum, when it is known exactly. */
  exact: number | null
  /** What the partial sums do. Never "converges" without a test that established it. */
  behaviour: 'converges' | 'diverges' | 'oscillates' | 'unknown'
  test: string
  describe: string
}

/**
 * A series summed, with its behaviour established by a test rather than by the partial sums levelling off.
 *
 * Partial sums that stop moving are not convergence: the harmonic series looks convergent for as long as anybody
 * watches it and diverges. So `behaviour` comes from an actual test -- the ratio test, or a known form -- and is
 * `unknown` when no test applies rather than being inferred from the numbers.
 */
export function sumSeries(terms: readonly number[], options: { knownForm?: 'geometric' | 'harmonic' | 'p-series'; parameter?: number } = {}): SeriesResult | AlgebraError {
  if (terms.length === 0) return fail('invalid-argument', 'There are no terms to sum.')

  const partialSums: number[] = []
  let running = 0
  for (const term of terms) {
    if (!Number.isFinite(term)) return fail('not-finite', 'One of the terms has no finite value, so the partial sums stop there.')
    running += term
    partialSums.push(running)
  }

  if (options.knownForm === 'geometric' && options.parameter !== undefined) {
    const r = options.parameter
    if (Math.abs(r) < 1) {
      return {
        partialSums,
        exact: terms[0] / (1 - r),
        behaviour: 'converges',
        test: 'geometric series',
        describe: `A geometric series with ratio ${r}, whose magnitude is below one, converges to a/(1-r) exactly.`
      }
    }
    return {
      partialSums,
      exact: null,
      behaviour: 'diverges',
      test: 'geometric series',
      describe: `A geometric series with ratio ${r}, whose magnitude is at least one, diverges. The partial sums do not approach anything.`
    }
  }

  if (options.knownForm === 'harmonic') {
    return {
      partialSums,
      exact: null,
      behaviour: 'diverges',
      test: 'harmonic series',
      describe:
        'The harmonic series diverges, although it does so slowly enough that the partial sums look settled for a very long time. This is the reason a series is never called convergent because its partial sums stopped moving.'
    }
  }

  if (options.knownForm === 'p-series' && options.parameter !== undefined) {
    const p = options.parameter
    return {
      partialSums,
      exact: null,
      behaviour: p > 1 ? 'converges' : 'diverges',
      test: 'p-series',
      describe: `A p-series with p = ${p} ${p > 1 ? 'converges, because p is above one' : 'diverges, because p is not above one'}.`
    }
  }

  // The ratio test, on the terms given. It is inconclusive at exactly 1, and says so rather than picking a side.
  const ratios: number[] = []
  for (let i = 1; i < terms.length; i++) {
    if (terms[i - 1] === 0) continue
    ratios.push(Math.abs(terms[i] / terms[i - 1]))
  }
  if (ratios.length >= 3) {
    const tail = ratios.slice(-Math.min(10, ratios.length))
    const limit = tail.reduce((sum, one) => sum + one, 0) / tail.length
    const settled = tail.every((one) => Math.abs(one - limit) < 0.05)
    if (settled && limit < 0.95) {
      return {
        partialSums,
        exact: null,
        behaviour: 'converges',
        test: 'ratio test',
        describe: `The ratio of successive terms settles near ${Number(limit.toPrecision(4))}, below one, so the series converges. The sum shown is a partial sum, not the limit.`
      }
    }
    if (settled && limit > 1.05) {
      return {
        partialSums,
        exact: null,
        behaviour: 'diverges',
        test: 'ratio test',
        describe: `The ratio of successive terms settles near ${Number(limit.toPrecision(4))}, above one, so the series diverges.`
      }
    }
  }

  const alternating = terms.length > 2 && terms.slice(1).every((one, i) => Math.sign(one) !== Math.sign(terms[i]) && one !== 0)
  return {
    partialSums,
    exact: null,
    behaviour: alternating ? 'oscillates' : 'unknown',
    test: 'none conclusive',
    describe: alternating
      ? 'The terms alternate in sign. Whether the series converges needs a test this cannot apply from the terms alone.'
      : 'No test applied to the terms given was conclusive. The partial sums are shown; nothing here says whether they approach a limit. Partial sums that stop moving are not convergence.'
  }
}

// ---------------------------------------------------------------- sets

export interface FiniteSet {
  /** Members as text, so a set can hold anything with a canonical spelling. Order is insertion order. */
  members: string[]
  describe: string
}

export const setOf = (members: readonly string[], describe = ''): FiniteSet => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const one of members) {
    if (seen.has(one)) continue
    seen.add(one)
    out.push(one)
  }
  return { members: out, describe }
}

export const unionOf = (a: FiniteSet, b: FiniteSet): FiniteSet => setOf([...a.members, ...b.members])

export const intersectionOf = (a: FiniteSet, b: FiniteSet): FiniteSet => {
  const other = new Set(b.members)
  return setOf(a.members.filter((one) => other.has(one)))
}

export const differenceOf = (a: FiniteSet, b: FiniteSet): FiniteSet => {
  const other = new Set(b.members)
  return setOf(a.members.filter((one) => !other.has(one)))
}

export const symmetricDifferenceOf = (a: FiniteSet, b: FiniteSet): FiniteSet =>
  unionOf(differenceOf(a, b), differenceOf(b, a))

/** The complement inside a stated universe. There is no complement without one, so the universe is a parameter. */
export function complementOf(one: FiniteSet, universe: FiniteSet): FiniteSet | AlgebraError {
  const outside = one.members.filter((member) => !universe.members.includes(member))
  if (outside.length > 0) {
    return fail('not-a-subset', `${outside.join(', ')} ${outside.length === 1 ? 'is' : 'are'} not in the universe, so the complement is not defined.`)
  }
  return differenceOf(universe, one)
}

export const isSubset = (a: FiniteSet, b: FiniteSet): boolean => {
  const other = new Set(b.members)
  return a.members.every((one) => other.has(one))
}

export const setsEqual = (a: FiniteSet, b: FiniteSet): boolean => isSubset(a, b) && isSubset(b, a)

export function cartesianProduct(a: FiniteSet, b: FiniteSet): FiniteSet | AlgebraError {
  const size = a.members.length * b.members.length
  if (size > ALGEBRA_LIMITS.setSize) {
    return fail('too-large', `That product has ${size.toLocaleString('en')} pairs, past the ${ALGEBRA_LIMITS.setSize.toLocaleString('en')} Orbis holds.`)
  }
  const out: string[] = []
  for (const x of a.members) for (const y of b.members) out.push(`(${x}, ${y})`)
  return setOf(out)
}

/**
 * The power set.
 *
 * Refused past twenty members, because 2^n is the whole point: twenty-one members is over two million subsets and
 * thirty is over a billion. The size is reported either way, because knowing the count is usually what was wanted.
 */
export function powerSet(one: FiniteSet): { subsets: FiniteSet[]; size: number } | AlgebraError {
  const n = one.members.length
  if (n > 20) {
    return fail(
      'too-large',
      `A set of ${n} members has ${2 ** n === Infinity ? 'an enormous number of' : (2 ** n).toLocaleString('en')} subsets, which is more than Orbis lists. The count is 2^${n}.`
    )
  }
  const subsets: FiniteSet[] = []
  for (let mask = 0; mask < 1 << n; mask++) {
    const members: string[] = []
    for (let i = 0; i < n; i++) if (mask & (1 << i)) members.push(one.members[i])
    subsets.push(setOf(members))
  }
  return { subsets, size: subsets.length }
}

// ---------------------------------------------------------------- propositional logic

export type Proposition =
  | { kind: 'variable'; name: string }
  | { kind: 'constant'; value: boolean }
  | { kind: 'not'; operand: Proposition }
  | { kind: 'and'; left: Proposition; right: Proposition }
  | { kind: 'or'; left: Proposition; right: Proposition }
  | { kind: 'xor'; left: Proposition; right: Proposition }
  | { kind: 'implies'; left: Proposition; right: Proposition }
  | { kind: 'iff'; left: Proposition; right: Proposition }

export const variablesOfProposition = (one: Proposition): string[] => {
  const found = new Set<string>()
  const walk = (node: Proposition): void => {
    switch (node.kind) {
      case 'variable':
        found.add(node.name)
        break
      case 'constant':
        break
      case 'not':
        walk(node.operand)
        break
      default:
        walk(node.left)
        walk(node.right)
    }
  }
  walk(one)
  return [...found].sort()
}

export function evaluateProposition(one: Proposition, values: Record<string, boolean>): boolean | AlgebraError {
  switch (one.kind) {
    case 'constant':
      return one.value
    case 'variable':
      // `hasOwnProperty`, never a bare index: a variable called `constructor` is a name somebody can write.
      if (!Object.prototype.hasOwnProperty.call(values, one.name)) {
        return fail('missing-value', `No value was given for "${one.name}".`)
      }
      return values[one.name] === true
    case 'not': {
      const operand = evaluateProposition(one.operand, values)
      return isAlgebraError(operand) ? operand : !operand
    }
    default: {
      const left = evaluateProposition(one.left, values)
      if (isAlgebraError(left)) return left
      const right = evaluateProposition(one.right, values)
      if (isAlgebraError(right)) return right
      switch (one.kind) {
        case 'and':
          return left && right
        case 'or':
          return left || right
        case 'xor':
          return left !== right
        case 'implies':
          // False implies anything. This is the row people find surprising, and it is the definition.
          return !left || right
        case 'iff':
          return left === right
      }
    }
  }
}

export interface TruthTable {
  variables: string[]
  rows: { values: Record<string, boolean>; result: boolean }[]
  /** True in every row. */
  tautology: boolean
  /** False in every row. */
  contradiction: boolean
  satisfiable: boolean
  /** The first row that makes it true, which is what a satisfiability question actually wants. */
  witness: Record<string, boolean> | null
  notes: string[]
}

/**
 * The full truth table.
 *
 * Refused past sixteen variables: the table has 2^n rows, so seventeen is over a hundred and thirty thousand and
 * twenty-five is over thirty million. The row count is stated in the refusal, because that is the useful part.
 */
export function truthTable(one: Proposition, maxVariables = 16): TruthTable | AlgebraError {
  const variables = variablesOfProposition(one)
  if (variables.length > maxVariables) {
    return fail(
      'too-large',
      `That has ${variables.length} variables, so its truth table has 2^${variables.length} rows -- more than Orbis builds at once. Fix some of the variables, or ask whether it is satisfiable rather than for the whole table.`
    )
  }

  const rows: TruthTable['rows'] = []
  const total = 1 << variables.length
  for (let mask = 0; mask < total; mask++) {
    const values: Record<string, boolean> = {}
    variables.forEach((name, i) => {
      // `defineProperty` so a variable called `__proto__` is a variable rather than a change to the row's prototype.
      Object.defineProperty(values, name, { value: (mask & (1 << i)) !== 0, enumerable: true, writable: true, configurable: true })
    })
    const result = evaluateProposition(one, values)
    if (isAlgebraError(result)) return result
    rows.push({ values, result })
  }

  const tautology = rows.every((row) => row.result)
  const contradiction = rows.every((row) => !row.result)
  const witness = rows.find((row) => row.result)?.values ?? null

  const notes: string[] = []
  if (tautology) notes.push('This is true for every assignment, so it is a tautology.')
  if (contradiction) notes.push('This is false for every assignment, so it is a contradiction.')
  if (variables.length === 0) notes.push('There are no variables, so there is one row.')

  return { variables, rows, tautology, contradiction, satisfiable: !contradiction, witness, notes }
}

/** Whether two propositions are the same function, by comparing their tables over the union of their variables. */
export function equivalent(a: Proposition, b: Proposition): { equivalent: boolean; counterexample: Record<string, boolean> | null; describe: string } | AlgebraError {
  const variables = [...new Set([...variablesOfProposition(a), ...variablesOfProposition(b)])].sort()
  if (variables.length > 16) return fail('too-large', 'Comparing these needs a table with more rows than Orbis builds at once.')

  const total = 1 << variables.length
  for (let mask = 0; mask < total; mask++) {
    const values: Record<string, boolean> = {}
    variables.forEach((name, i) => {
      Object.defineProperty(values, name, { value: (mask & (1 << i)) !== 0, enumerable: true, writable: true, configurable: true })
    })
    const left = evaluateProposition(a, values)
    if (isAlgebraError(left)) return left
    const right = evaluateProposition(b, values)
    if (isAlgebraError(right)) return right
    if (left !== right) {
      return {
        equivalent: false,
        counterexample: values,
        describe: `They differ when ${variables.map((name) => `${name} is ${values[name]}`).join(' and ')}: one is ${left} and the other is ${right}.`
      }
    }
  }
  return { equivalent: true, counterexample: null, describe: 'They agree on every assignment, so they are the same function.' }
}

/** Disjunctive normal form, built from the rows that are true. Correct by construction, not necessarily minimal. */
export function toDisjunctiveNormalForm(one: Proposition): { text: string; minimal: boolean; describe: string } | AlgebraError {
  const table = truthTable(one)
  if (isAlgebraError(table)) return table
  if (table.contradiction) return { text: 'false', minimal: true, describe: 'It is never true, so there are no terms.' }
  if (table.variables.length === 0) return { text: table.rows[0].result ? 'true' : 'false', minimal: true, describe: 'There are no variables.' }

  const terms = table.rows
    .filter((row) => row.result)
    .map((row) => table.variables.map((name) => (row.values[name] ? name : `!${name}`)).join(' AND '))

  return {
    text: terms.length === 1 ? terms[0] : terms.map((one2) => `(${one2})`).join(' OR '),
    // Built from the true rows, so it is correct; whether it is the shortest such form is a different question, and
    // claiming minimality without a minimisation would be claiming something that was never checked.
    minimal: false,
    describe: `Built from the ${terms.length} assignment${terms.length === 1 ? '' : 's'} that make it true. This form is correct; it is not necessarily the shortest one, which would need a minimisation.`
  }
}

/** Conjunctive normal form, built from the rows that are false, by the same construction. */
export function toConjunctiveNormalForm(one: Proposition): { text: string; minimal: boolean; describe: string } | AlgebraError {
  const table = truthTable(one)
  if (isAlgebraError(table)) return table
  if (table.tautology) return { text: 'true', minimal: true, describe: 'It is always true, so there are no clauses.' }
  if (table.variables.length === 0) return { text: table.rows[0].result ? 'true' : 'false', minimal: true, describe: 'There are no variables.' }

  const clauses = table.rows
    .filter((row) => !row.result)
    .map((row) => table.variables.map((name) => (row.values[name] ? `!${name}` : name)).join(' OR '))

  return {
    text: clauses.length === 1 ? clauses[0] : clauses.map((one2) => `(${one2})`).join(' AND '),
    minimal: false,
    describe: `Built from the ${clauses.length} assignment${clauses.length === 1 ? '' : 's'} that make it false. This form is correct; it is not necessarily the shortest one.`
  }
}

/** The assumptions the engine rests on, for a Page that wants to show them rather than have them inferred. */
export const ALGEBRA_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Rationals are exact. A third is a third, not 0.3333333333333333, and a decimal is something a caller asks for.',
  'A square root stays in radical form unless a decimal is asked for.',
  'A simplification that needs an assumption is refused until the assumption is made, and the refusal names it.',
  'A pattern in a sequence is reported as what the terms are consistent with, never as proven.',
  'Partial sums that stop moving are not convergence. Convergence comes from a test, and is unknown when none applies.',
  'Every root of a polynomial that can be found exactly is found exactly; the rest are marked as approximations.',
  'A normal form built from a truth table is correct by construction and is not claimed to be minimal.',
  'Zero to the power zero has no single agreed value, so Orbis does not pick one.'
])
