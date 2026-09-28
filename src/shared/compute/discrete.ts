/**
 * Number theory, combinatorics, graphs and relations.
 *
 * Exact throughout, which here means bigints. A factorial passes what a double holds at 19, and `nCr` for a hundred
 * things taken fifty at a time is a 30-digit number -- computing either in floating point gives an answer that looks
 * like a count and is not one.
 *
 * ## The distinction that runs through all of it
 *
 * A **count** and an **enumeration** are different questions. The number of ways to arrange a hundred items is a number
 * anybody can have; the arrangements themselves are 10^158 objects nobody can have. Every function here that counts
 * will count anything; every function that lists refuses past what can be listed, and says what the count was.
 *
 * ## Primality
 *
 * Deterministic below 3.3 x 10^24, using the Miller-Rabin witness sets that are proven complete for those ranges.
 * Above that the same test is probabilistic, and the result says which it was. "Probably prime" and "prime" are not
 * the same claim, and a tool that prints the same word for both is lying about one of them.
 */

export interface DiscreteError {
  error: string
  message: string
}

export const isDiscreteError = (value: unknown): value is DiscreteError =>
  typeof value === 'object' && value !== null && 'error' in value && 'message' in value

const fail = (error: string, message: string): DiscreteError => ({ error, message })

export const DISCRETE_LIMITS: Readonly<
  Record<'sieve' | 'enumerate' | 'digits' | 'vertices' | 'edges' | 'factorDigits' | 'searchRange' | 'iterations', number>
> = Object.freeze({
  sieve: 10_000_000,
  enumerate: 200_000,
  digits: 2_000,
  vertices: 5_000,
  edges: 50_000,
  factorDigits: 20,
  searchRange: 10_000_000,
  iterations: 1_000_000
})

// ---------------------------------------------------------------- divisibility

export const absBig = (value: bigint): bigint => (value < 0n ? -value : value)

/** The greatest common divisor, by the Euclidean algorithm. `gcd(0,0)` is 0, which is the convention that composes. */
export function gcd(a: bigint, b: bigint): bigint {
  let x = absBig(a)
  let y = absBig(b)
  while (y !== 0n) {
    const t = x % y
    x = y
    y = t
  }
  return x
}

export interface EuclideanStep {
  a: bigint
  b: bigint
  quotient: bigint
  remainder: bigint
  describe: string
}

/** Every step of the Euclidean algorithm, for showing the working. The steps are the algorithm, not a reconstruction. */
export function euclideanSteps(a: bigint, b: bigint): { steps: EuclideanStep[]; gcd: bigint } {
  const steps: EuclideanStep[] = []
  let x = absBig(a)
  let y = absBig(b)
  while (y !== 0n) {
    const quotient = x / y
    const remainder = x % y
    steps.push({ a: x, b: y, quotient, remainder, describe: `${x} = ${y} x ${quotient} + ${remainder}` })
    x = y
    y = remainder
  }
  return { steps, gcd: x }
}

export interface Bezout {
  gcd: bigint
  x: bigint
  y: bigint
  /** `a*x + b*y = gcd`, checked rather than asserted. */
  verified: boolean
  describe: string
}

/** The extended Euclidean algorithm: the gcd, and the combination of a and b that produces it. */
export function extendedGcd(a: bigint, b: bigint): Bezout {
  let oldR = a
  let r = b
  let oldS = 1n
  let s = 0n
  let oldT = 0n
  let t = 1n

  while (r !== 0n) {
    const quotient = oldR / r
    ;[oldR, r] = [r, oldR - quotient * r]
    ;[oldS, s] = [s, oldS - quotient * s]
    ;[oldT, t] = [t, oldT - quotient * t]
  }

  // The gcd is taken as positive by convention; the coefficients follow it.
  const sign = oldR < 0n ? -1n : 1n
  const g = sign * oldR
  const x = sign * oldS
  const y = sign * oldT

  return {
    gcd: g,
    x,
    y,
    verified: a * x + b * y === g,
    describe: `${a} x ${x} + ${b} x ${y} = ${g}`
  }
}

/**
 * The least common multiple.
 *
 * Through the gcd rather than by factorising: `|ab|/gcd(a,b)`, with the division done first so the product never grows
 * larger than it has to. `lcm(0, n)` is 0, which is what the formula gives and what the definition means.
 */
export function lcm(a: bigint, b: bigint): bigint {
  if (a === 0n || b === 0n) return 0n
  const g = gcd(a, b)
  return absBig(a / g) * absBig(b)
}

export interface DivisorInfo {
  divisors: bigint[]
  count: number
  sum: bigint
  properSum: bigint
  classification: 'perfect' | 'abundant' | 'deficient' | 'undefined'
  describe: string
}

/** Every positive divisor, found in pairs so the loop only runs to the square root. */
export function divisorsOf(value: bigint): DivisorInfo | DiscreteError {
  if (value <= 0n) return fail('invalid-argument', 'Divisors are listed for a positive whole number.')
  if (value > 10n ** BigInt(DISCRETE_LIMITS.factorDigits)) {
    return fail('too-large', `Listing the divisors of a number with more than ${DISCRETE_LIMITS.factorDigits} digits takes longer than Orbis will wait.`)
  }

  const small: bigint[] = []
  const large: bigint[] = []
  for (let i = 1n; i * i <= value; i++) {
    if (value % i !== 0n) continue
    small.push(i)
    if (i !== value / i) large.push(value / i)
  }
  const divisors = [...small, ...large.reverse()]
  const sum = divisors.reduce((total, one) => total + one, 0n)
  const properSum = sum - value

  const classification: DivisorInfo['classification'] =
    value === 1n ? 'deficient' : properSum === value ? 'perfect' : properSum > value ? 'abundant' : 'deficient'

  return {
    divisors,
    count: divisors.length,
    sum,
    properSum,
    classification,
    describe:
      classification === 'perfect'
        ? `${value} is perfect: its proper divisors add to exactly itself.`
        : classification === 'abundant'
          ? `${value} is abundant: its proper divisors add to ${properSum}, more than itself.`
          : `${value} is deficient: its proper divisors add to ${properSum}, less than itself.`
  }
}

// ---------------------------------------------------------------- modular arithmetic

/** The remainder, always in `[0, m)`. JavaScript's `%` keeps the sign of the dividend, which is not what mod means. */
export function mod(a: bigint, m: bigint): bigint | DiscreteError {
  if (m === 0n) return fail('invalid-argument', 'There is no arithmetic modulo zero.')
  const magnitude = absBig(m)
  const remainder = a % magnitude
  return remainder < 0n ? remainder + magnitude : remainder
}

/**
 * `base^exponent mod m`, by repeated squaring.
 *
 * Never by computing the power first. `2^1000 mod 7` is a one-digit answer, and the intermediate would be a 302-digit
 * number -- which bigints can hold, and which is thousands of times slower than not building it.
 */
export function modPower(base: bigint, exponent: bigint, m: bigint): bigint | DiscreteError {
  if (m === 0n) return fail('invalid-argument', 'There is no arithmetic modulo zero.')
  if (exponent < 0n) return fail('invalid-argument', 'A negative exponent needs the modular inverse first, which only exists when the base and the modulus are coprime.')
  const magnitude = absBig(m)
  if (magnitude === 1n) return 0n

  let result = 1n
  let b = ((base % magnitude) + magnitude) % magnitude
  let e = exponent
  while (e > 0n) {
    if (e & 1n) result = (result * b) % magnitude
    b = (b * b) % magnitude
    e >>= 1n
  }
  return result
}

export interface Inverse {
  value: bigint | null
  exists: boolean
  describe: string
}

/** The modular inverse, when it exists. It exists exactly when the two are coprime, and that is what is checked. */
export function modInverse(a: bigint, m: bigint): Inverse | DiscreteError {
  if (m === 0n) return fail('invalid-argument', 'There is no arithmetic modulo zero.')
  const magnitude = absBig(m)
  if (magnitude === 1n) return { value: 0n, exists: true, describe: 'Everything is congruent modulo 1, so the inverse is 0.' }

  const bezout = extendedGcd(((a % magnitude) + magnitude) % magnitude, magnitude)
  if (bezout.gcd !== 1n) {
    return {
      value: null,
      exists: false,
      describe: `${a} has no inverse modulo ${magnitude}: their greatest common divisor is ${bezout.gcd}, not 1. An inverse exists only when the two are coprime.`
    }
  }
  const value = ((bezout.x % magnitude) + magnitude) % magnitude
  return { value, exists: true, describe: `${a} x ${value} is congruent to 1 modulo ${magnitude}.` }
}

export interface Congruence {
  coefficient: bigint
  value: bigint
  modulus: bigint
}

export interface CongruenceSolution {
  /** Every solution modulo the original modulus. Empty when there is none. */
  solutions: bigint[]
  /** The general form: any x congruent to `base` modulo `step`. */
  base: bigint | null
  step: bigint | null
  count: number
  describe: string
}

/**
 * `ax = b (mod n)`, solved completely.
 *
 * The case that catches people: when `gcd(a,n) = d` divides `b`, there are `d` solutions rather than one, and a solver
 * that only tries the inverse finds none of them because the inverse does not exist. All `d` are returned.
 */
export function solveCongruence(one: Congruence): CongruenceSolution | DiscreteError {
  const n = absBig(one.modulus)
  if (n === 0n) return fail('invalid-argument', 'There is no arithmetic modulo zero.')

  const a = ((one.coefficient % n) + n) % n
  const b = ((one.value % n) + n) % n
  const d = gcd(a, n)

  if (b % d !== 0n) {
    return {
      solutions: [],
      base: null,
      step: null,
      count: 0,
      describe: `There is no solution: the greatest common divisor of ${a} and ${n} is ${d}, which does not divide ${b}. A solution exists only when it does.`
    }
  }

  const reducedA = a / d
  const reducedB = b / d
  const reducedN = n / d
  const inverse = modInverse(reducedA, reducedN)
  if (isDiscreteError(inverse) || inverse.value === null) {
    return fail('no-inverse', 'The reduced coefficient has no inverse, which should not happen after dividing by the gcd.')
  }

  const first = (reducedB * inverse.value) % reducedN
  // d solutions, spaced n/d apart. This is the part a naive solver misses entirely.
  const solutions: bigint[] = []
  for (let k = 0n; k < d; k++) solutions.push((first + k * reducedN) % n)
  solutions.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0))

  return {
    solutions,
    base: first,
    step: reducedN,
    count: Number(d),
    describe:
      d === 1n
        ? `There is one solution modulo ${n}: x is congruent to ${first}.`
        : `There are ${d} solutions modulo ${n}, because the greatest common divisor of ${a} and ${n} is ${d}. They are ${solutions.join(', ')}, spaced ${reducedN} apart.`
  }
}

export interface CrtResult {
  value: bigint
  modulus: bigint
  /** Whether every congruence was checked against the answer. */
  verified: boolean
  /** Whether the moduli are pairwise coprime. The generalised form does not need them to be. */
  coprime: boolean
  describe: string
}

/**
 * A system of congruences, solved.
 *
 * The generalised form, which does not need the moduli to be pairwise coprime. Combining two congruences with moduli
 * `m` and `n` needs `a = b (mod gcd(m,n))` -- and where that fails the system is genuinely inconsistent, which is a
 * different answer from "the moduli are not coprime so I cannot help".
 */
export function chineseRemainder(congruences: readonly { value: bigint; modulus: bigint }[]): CrtResult | DiscreteError {
  if (congruences.length === 0) return fail('invalid-argument', 'There are no congruences to solve.')
  for (const one of congruences) {
    if (absBig(one.modulus) === 0n) return fail('invalid-argument', 'There is no arithmetic modulo zero.')
  }

  let coprime = true
  for (let i = 0; i < congruences.length; i++) {
    for (let j = i + 1; j < congruences.length; j++) {
      if (gcd(absBig(congruences[i].modulus), absBig(congruences[j].modulus)) !== 1n) coprime = false
    }
  }

  let value = ((congruences[0].value % absBig(congruences[0].modulus)) + absBig(congruences[0].modulus)) % absBig(congruences[0].modulus)
  let modulus = absBig(congruences[0].modulus)

  for (let i = 1; i < congruences.length; i++) {
    const nextModulus = absBig(congruences[i].modulus)
    const nextValue = ((congruences[i].value % nextModulus) + nextModulus) % nextModulus

    const bezout = extendedGcd(modulus, nextModulus)
    const difference = nextValue - value
    if (difference % bezout.gcd !== 0n) {
      return fail(
        'inconsistent',
        `The congruences contradict each other. x is congruent to ${value} modulo ${modulus} and to ${nextValue} modulo ${nextModulus}; those agree only if the two values differ by a multiple of ${bezout.gcd}, and they differ by ${difference}.`
      )
    }

    const combined = lcm(modulus, nextModulus)
    const step = (difference / bezout.gcd) * bezout.x
    value = ((value + modulus * step) % combined + combined) % combined
    modulus = combined
  }

  const verified = congruences.every((one) => {
    const magnitude = absBig(one.modulus)
    return ((value % magnitude) + magnitude) % magnitude === ((one.value % magnitude) + magnitude) % magnitude
  })

  return {
    value,
    modulus,
    verified,
    coprime,
    describe: coprime
      ? `x is congruent to ${value} modulo ${modulus}. The moduli are pairwise coprime, so the modulus of the answer is their product.`
      : `x is congruent to ${value} modulo ${modulus}. The moduli are not pairwise coprime, so the modulus of the answer is their least common multiple rather than their product.`
  }
}

// ---------------------------------------------------------------- primes

const SMALL_PRIMES = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n]

export interface PrimalityResult {
  prime: boolean
  /** `proven` where the witness set is complete for this range; `probable` above it. Never conflated. */
  certainty: 'proven' | 'probable'
  witnesses: number
  /** A factor, when one was found while testing. */
  factor: bigint | null
  describe: string
}

/**
 * Whether a number is prime.
 *
 * Miller-Rabin with the fixed witness set `{2, 3, 5, ..., 37}`, which is proven to decide primality for everything
 * below 3.317 x 10^24. Below that bound the answer is a proof; above it the same test is a very strong probabilistic
 * one, and the result says which. Printing "prime" for both would be reporting a probability as a certainty.
 */
export function isPrime(value: bigint): PrimalityResult | DiscreteError {
  if (value > 10n ** BigInt(DISCRETE_LIMITS.digits)) {
    return fail('too-large', `A number with more than ${DISCRETE_LIMITS.digits} digits is larger than Orbis tests.`)
  }
  if (value < 2n) {
    return {
      prime: false,
      certainty: 'proven',
      witnesses: 0,
      factor: null,
      describe: `${value} is not prime. A prime is a whole number above 1 with exactly two positive divisors, and ${value} ${value < 0n ? 'is negative' : value === 0n ? 'is zero' : 'has only one divisor'}.`
    }
  }

  for (const small of SMALL_PRIMES) {
    if (value === small) return { prime: true, certainty: 'proven', witnesses: 0, factor: null, describe: `${value} is prime.` }
    if (value % small === 0n) {
      return { prime: false, certainty: 'proven', witnesses: 0, factor: small, describe: `${value} is divisible by ${small}, so it is not prime.` }
    }
  }

  // n - 1 = d * 2^s with d odd.
  let d = value - 1n
  let s = 0n
  while (d % 2n === 0n) {
    d /= 2n
    s += 1n
  }

  for (const witness of SMALL_PRIMES) {
    let x = modPower(witness, d, value)
    if (isDiscreteError(x)) return x
    if (x === 1n || x === value - 1n) continue

    let composite = true
    for (let i = 1n; i < s; i++) {
      x = (x * x) % value
      if (x === value - 1n) {
        composite = false
        break
      }
    }
    if (composite) {
      return { prime: false, certainty: 'proven', witnesses: SMALL_PRIMES.length, factor: null, describe: `${value} is composite: ${witness} is a witness to it.` }
    }
  }

  // The bound below which this witness set is a proof.
  const proven = value < 3_317_044_064_679_887_385_961_981n
  return {
    prime: true,
    certainty: proven ? 'proven' : 'probable',
    witnesses: SMALL_PRIMES.length,
    factor: null,
    describe: proven
      ? `${value} is prime. The witnesses used are proven to decide primality for every number below 3.317 x 10^24, so this is a proof and not an estimate.`
      : `${value} is probably prime. Past 3.317 x 10^24 this witness set is no longer a proof, so this is a very strong probabilistic result rather than a certainty. Orbis says "probably" because the difference is real.`
  }
}

export interface SieveResult {
  primes: number[]
  count: number
  limit: number
  /** How many candidates the sieve eliminated, which is what the visualisation shows. */
  eliminated: number
}

/** Every prime below a limit, by the sieve of Eratosthenes. */
export function sieveOfEratosthenes(limit: number): SieveResult | DiscreteError {
  if (!Number.isInteger(limit) || limit < 2) return fail('invalid-argument', 'A sieve needs a whole limit of at least 2.')
  if (limit > DISCRETE_LIMITS.sieve) {
    return fail('too-large', `A sieve to ${limit.toLocaleString('en')} is past the ${DISCRETE_LIMITS.sieve.toLocaleString('en')} Orbis runs at once.`)
  }

  const composite = new Uint8Array(limit + 1)
  let eliminated = 0
  for (let p = 2; p * p <= limit; p++) {
    if (composite[p]) continue
    // Start at p*p: everything smaller with a factor of p was already struck out by a smaller prime.
    for (let multiple = p * p; multiple <= limit; multiple += p) {
      if (!composite[multiple]) {
        composite[multiple] = 1
        eliminated += 1
      }
    }
  }

  const primes: number[] = []
  for (let i = 2; i <= limit; i++) if (!composite[i]) primes.push(i)
  return { primes, count: primes.length, limit, eliminated }
}

export interface Factorisation {
  factors: { prime: bigint; power: number }[]
  /** Whether the factorisation is complete. A number too large to factor is reported, not partially factored. */
  complete: boolean
  /** The part left unfactored, when there is one. */
  remaining: bigint
  divisorCount: number
  describe: string
}

/**
 * Prime factorisation, by trial division and then Pollard's rho.
 *
 * Trial division finds the small factors quickly. Pollard's rho finds a factor of a semiprime in about the fourth root
 * of its size, which reaches numbers trial division never would. Neither breaks a genuinely large semiprime, and the
 * result says `complete: false` with the remainder rather than presenting a partial answer as a full one.
 */
export function factorise(value: bigint): Factorisation | DiscreteError {
  if (value <= 0n) return fail('invalid-argument', 'Factorisation is for a positive whole number.')
  if (value === 1n) {
    return { factors: [], complete: true, remaining: 1n, divisorCount: 1, describe: '1 has no prime factors. It is the empty product.' }
  }
  if (value > 10n ** BigInt(DISCRETE_LIMITS.digits)) {
    return fail('too-large', `A number with more than ${DISCRETE_LIMITS.digits} digits is larger than Orbis handles.`)
  }

  const found = new Map<string, number>()
  let remaining = value

  for (let p = 2n; p * p <= remaining && p < 1_000_000n; p++) {
    while (remaining % p === 0n) {
      found.set(p.toString(), (found.get(p.toString()) ?? 0) + 1)
      remaining /= p
    }
  }

  // Pollard's rho on whatever trial division could not reach.
  let complete = true
  const queue: bigint[] = remaining > 1n ? [remaining] : []
  let work = 0
  while (queue.length > 0) {
    const n = queue.pop() as bigint
    if (n === 1n) continue
    const primality = isPrime(n)
    if (isDiscreteError(primality)) return primality
    if (primality.prime) {
      found.set(n.toString(), (found.get(n.toString()) ?? 0) + 1)
      continue
    }
    work += 1
    if (work > 200) {
      complete = false
      remaining = n
      break
    }
    const factor = pollardRho(n)
    if (factor === null) {
      complete = false
      remaining = n
      break
    }
    queue.push(factor, n / factor)
  }
  if (complete) remaining = 1n

  const factors = [...found.entries()]
    .map(([prime, power]) => ({ prime: BigInt(prime), power }))
    .sort((a, b) => (a.prime < b.prime ? -1 : a.prime > b.prime ? 1 : 0))

  // The divisor count is the product of (power + 1), which is exactly why the factorisation is worth having.
  const divisorCount = complete ? factors.reduce((total, one) => total * (one.power + 1), 1) : 0

  return {
    factors,
    complete,
    remaining,
    divisorCount,
    describe: complete
      ? `${value} = ${factors.map((one) => (one.power === 1 ? `${one.prime}` : `${one.prime}^${one.power}`)).join(' x ')}`
      : `${value} was factored as far as ${factors.map((one) => (one.power === 1 ? `${one.prime}` : `${one.prime}^${one.power}`)).join(' x ')} with ${remaining} left over. That remainder is composite but too hard to split further here; the factorisation shown is partial, not complete.`
  }
}

/** Pollard's rho with Brent's cycle detection. Returns `null` when the cycle closes without finding a factor. */
function pollardRho(n: bigint): bigint | null {
  if (n % 2n === 0n) return 2n
  // A few starting points: rho can fail for one choice and succeed for the next.
  for (let c = 1n; c < 20n; c++) {
    let x = 2n
    let y = 2n
    let d = 1n
    let steps = 0
    while (d === 1n && steps < 1_000_000) {
      x = (x * x + c) % n
      y = (y * y + c) % n
      y = (y * y + c) % n
      d = gcd(absBig(x - y), n)
      steps += 1
    }
    if (d !== 1n && d !== n) return d
  }
  return null
}

/**
 * Euler's totient: how many numbers below `n` are coprime to it.
 *
 * From the factorisation, which is the only way to get it exactly for anything large. Counting directly would work for
 * small numbers and take longer than the universe for large ones.
 */
export function totient(value: bigint): { value: bigint; describe: string } | DiscreteError {
  if (value < 1n) return fail('invalid-argument', 'The totient is for a positive whole number.')
  if (value === 1n) return { value: 1n, describe: 'By convention the totient of 1 is 1.' }

  const factorisation = factorise(value)
  if (isDiscreteError(factorisation)) return factorisation
  if (!factorisation.complete) {
    return fail('incomplete-factorisation', `The totient of ${value} needs its full factorisation, and Orbis could not finish factoring it.`)
  }

  let result = value
  for (const { prime } of factorisation.factors) result = (result / prime) * (prime - 1n)

  return {
    value: result,
    describe: `phi(${value}) = ${value} x ${factorisation.factors.map((one) => `(1 - 1/${one.prime})`).join(' x ')} = ${result}`
  }
}

export interface DiophantineSolution {
  hasSolution: boolean
  /** One solution, when there is one. */
  x: bigint | null
  y: bigint | null
  /** The general family: `x0 + t*xStep`, `y0 - t*yStep` for any whole `t`. */
  xStep: bigint | null
  yStep: bigint | null
  describe: string
}

/** `ax + by = c` in whole numbers. A solution exists exactly when `gcd(a,b)` divides `c`. */
export function linearDiophantine(a: bigint, b: bigint, c: bigint): DiophantineSolution {
  if (a === 0n && b === 0n) {
    return {
      hasSolution: c === 0n,
      x: c === 0n ? 0n : null,
      y: c === 0n ? 0n : null,
      xStep: null,
      yStep: null,
      describe: c === 0n ? 'Every pair is a solution, since both coefficients are zero and so is the right-hand side.' : 'There is no solution: both coefficients are zero and the right-hand side is not.'
    }
  }

  const bezout = extendedGcd(a, b)
  if (c % bezout.gcd !== 0n) {
    return {
      hasSolution: false,
      x: null,
      y: null,
      xStep: null,
      yStep: null,
      describe: `There is no whole-number solution: the greatest common divisor of ${a} and ${b} is ${bezout.gcd}, and it does not divide ${c}. Every value of ax + by is a multiple of that divisor.`
    }
  }

  const scale = c / bezout.gcd
  const x = bezout.x * scale
  const y = bezout.y * scale
  const xStep = b / bezout.gcd
  const yStep = a / bezout.gcd

  return {
    hasSolution: true,
    x,
    y,
    xStep,
    yStep,
    describe: `x = ${x} + ${xStep}t, y = ${y} - ${yStep}t for any whole t. Checked: ${a} x ${x} + ${b} x ${y} = ${a * x + b * y}.`
  }
}

// ---------------------------------------------------------------- combinatorics

/** `n!` exactly. Passes what a double holds at 19, which is why this returns a bigint. */
export function factorial(n: number): bigint | DiscreteError {
  if (!Number.isInteger(n) || n < 0) return fail('invalid-argument', 'A factorial needs a whole number that is not negative.')
  if (n > 20_000) return fail('too-large', 'A factorial past 20,000 has more digits than Orbis holds.')
  let result = 1n
  for (let i = 2n; i <= BigInt(n); i++) result *= i
  return result
}

/**
 * `nCr` exactly.
 *
 * Multiplied and divided term by term rather than as three factorials: the intermediate stays near the answer instead
 * of reaching 100! for a result with 30 digits. The division is exact at every step, because the product of any `k`
 * consecutive integers is divisible by `k!`.
 */
export function combinations(n: number, r: number): bigint | DiscreteError {
  if (!Number.isInteger(n) || !Number.isInteger(r)) return fail('invalid-argument', 'Combinations need whole numbers.')
  if (n < 0 || r < 0) return fail('invalid-argument', 'Combinations need numbers that are not negative.')
  if (r > n) return 0n
  if (n > 1_000_000) return fail('too-large', 'Orbis counts combinations for n up to a million.')

  const k = Math.min(r, n - r)
  let result = 1n
  for (let i = 0n; i < BigInt(k); i++) {
    result = (result * (BigInt(n) - i)) / (i + 1n)
  }
  return result
}

export function permutations(n: number, r: number): bigint | DiscreteError {
  if (!Number.isInteger(n) || !Number.isInteger(r)) return fail('invalid-argument', 'Permutations need whole numbers.')
  if (n < 0 || r < 0) return fail('invalid-argument', 'Permutations need numbers that are not negative.')
  if (r > n) return 0n
  if (n > 1_000_000) return fail('too-large', 'Orbis counts permutations for n up to a million.')

  let result = 1n
  for (let i = 0n; i < BigInt(r); i++) result *= BigInt(n) - i
  return result
}

/** `n! / (n1! n2! ... nk!)`. The parts have to add to n, which is checked rather than assumed. */
export function multinomial(parts: readonly number[]): bigint | DiscreteError {
  if (parts.length === 0) return fail('invalid-argument', 'A multinomial needs at least one part.')
  if (!parts.every((one) => Number.isInteger(one) && one >= 0)) return fail('invalid-argument', 'Every part has to be a whole number that is not negative.')
  const total = parts.reduce((sum, one) => sum + one, 0)
  if (total > 20_000) return fail('too-large', 'That multinomial has more digits than Orbis holds.')

  // Built as a product of binomials, so the intermediate never reaches total!.
  let result = 1n
  let left = total
  for (const part of parts) {
    const choose = combinations(left, part)
    if (isDiscreteError(choose)) return choose
    result *= choose
    left -= part
  }
  return result
}

export interface StarsAndBars {
  count: bigint
  describe: string
}

/**
 * Solutions to `x1 + x2 + ... + xk = n` in whole numbers.
 *
 * `C(n+k-1, k-1)` for non-negative solutions; substituting `yi = xi - 1` gives `C(n-1, k-1)` for strictly positive
 * ones. Both are counts, and both are returned exactly however large they get.
 */
export function starsAndBars(total: number, parts: number, positive = false): StarsAndBars | DiscreteError {
  if (!Number.isInteger(total) || !Number.isInteger(parts) || parts < 1) {
    return fail('invalid-argument', 'Stars and bars needs a whole total and at least one part.')
  }
  if (total < 0) return fail('invalid-argument', 'The total cannot be negative.')
  if (positive && total < parts) {
    return { count: 0n, describe: `There is no way to write ${total} as ${parts} strictly positive whole numbers: the smallest such sum is ${parts}.` }
  }

  const count = positive ? combinations(total - 1, parts - 1) : combinations(total + parts - 1, parts - 1)
  if (isDiscreteError(count)) return count
  return {
    count,
    describe: positive
      ? `C(${total - 1}, ${parts - 1}) = ${count}. Substituting one from each part turns the positive problem into the non-negative one.`
      : `C(${total + parts - 1}, ${parts - 1}) = ${count}. The bars separating ${parts} parts are chosen from ${total + parts - 1} positions.`
  }
}

export interface InclusionExclusion {
  count: bigint
  terms: { size: number; sign: 1 | -1; sets: string[]; value: bigint }[]
  /** Intersections nobody supplied. They are not assumed to be zero, and the result says it is incomplete. */
  missing: string[][]
  complete: boolean
  describe: string
}

/**
 * The size of a union, by inclusion and exclusion.
 *
 * A missing intersection is reported rather than taken as zero. Assuming an unstated intersection is empty is how a
 * union comes out too large by exactly the amount nobody measured, and the result would look like a count.
 */
export function inclusionExclusion(
  sets: readonly string[],
  sizes: ReadonlyMap<string, bigint>
): InclusionExclusion | DiscreteError {
  if (sets.length === 0) return fail('invalid-argument', 'There are no sets to combine.')
  if (sets.length > 16) return fail('too-large', `Inclusion and exclusion over ${sets.length} sets needs 2^${sets.length} - 1 intersection sizes, which is more than is practical to supply.`)

  const key = (subset: readonly string[]): string => [...subset].sort().join('&')
  const terms: InclusionExclusion['terms'] = []
  const missing: string[][] = []
  let count = 0n

  for (let mask = 1; mask < 1 << sets.length; mask++) {
    const subset: string[] = []
    for (let i = 0; i < sets.length; i++) if (mask & (1 << i)) subset.push(sets[i])
    const name = key(subset)
    const value = sizes.get(name)
    if (value === undefined) {
      missing.push(subset)
      continue
    }
    const sign: 1 | -1 = subset.length % 2 === 1 ? 1 : -1
    terms.push({ size: subset.length, sign, sets: subset, value })
    count += sign === 1 ? value : -value
  }

  const complete = missing.length === 0
  return {
    count,
    terms,
    missing,
    complete,
    describe: complete
      ? `The union has ${count} members: ${terms.filter((one) => one.sign === 1).length} terms added and ${terms.filter((one) => one.sign === -1).length} subtracted.`
      : `${missing.length} intersection size${missing.length === 1 ? ' was' : 's were'} not given: ${missing.map((one) => one.join(' and ')).join('; ')}. They are not taken to be zero, so this total is incomplete rather than wrong by an unknown amount.`
  }
}

/** Arrangements with nothing in its own place. The recurrence, because the formula involves an alternating sum. */
export function derangements(n: number): bigint | DiscreteError {
  if (!Number.isInteger(n) || n < 0) return fail('invalid-argument', 'Derangements need a whole number that is not negative.')
  if (n > 20_000) return fail('too-large', 'That many derangements has more digits than Orbis holds.')
  if (n === 0) return 1n
  if (n === 1) return 0n

  let previous = 1n
  let current = 0n
  for (let i = 2n; i <= BigInt(n); i++) {
    const next = (i - 1n) * (current + previous)
    previous = current
    current = next
  }
  return current
}

export interface PigeonholeResult {
  guaranteed: number
  /** How many objects are needed to guarantee a box with at least `target`. */
  neededFor: number | null
  describe: string
}

/** The generalised pigeonhole principle, which is a ceiling division and the reasoning that goes with it. */
export function pigeonhole(objects: number, boxes: number, target?: number): PigeonholeResult | DiscreteError {
  if (!Number.isInteger(objects) || !Number.isInteger(boxes) || boxes < 1 || objects < 0) {
    return fail('invalid-argument', 'The pigeonhole principle needs whole numbers, with at least one box.')
  }
  const guaranteed = Math.ceil(objects / boxes)
  const wanted = target !== undefined && Number.isInteger(target) && target >= 1 ? target : null
  const neededFor = wanted === null ? null : boxes * (wanted - 1) + 1

  return {
    guaranteed,
    neededFor,
    describe:
      wanted === null || neededFor === null
        ? `With ${objects} objects in ${boxes} boxes, some box holds at least ${guaranteed}. If every box held fewer, the total would be at most ${boxes * (guaranteed - 1)}, which is less than ${objects}.`
        : `To guarantee a box with at least ${wanted}, you need ${neededFor} objects: with ${neededFor - 1} it is possible to put ${wanted - 1} in every box and no more.`
  }
}

export interface PascalRow {
  n: number
  entries: bigint[]
  sum: bigint
}

/** A row of Pascal's triangle, built from the row before it rather than from factorials. */
export function pascalRow(n: number): PascalRow | DiscreteError {
  if (!Number.isInteger(n) || n < 0) return fail('invalid-argument', 'A row index has to be a whole number that is not negative.')
  if (n > 5_000) return fail('too-large', 'Orbis builds rows of Pascal’s triangle up to 5,000.')

  const entries: bigint[] = [1n]
  for (let k = 1n; k <= BigInt(n); k++) {
    entries.push((entries[entries.length - 1] * (BigInt(n) - k + 1n)) / k)
  }
  return { n, entries, sum: entries.reduce((total, one) => total + one, 0n) }
}

// ---------------------------------------------------------------- enumeration

export interface Enumeration<T> {
  items: T[]
  /** The full count, which is available even when the items are not. */
  count: bigint
  /** True when every item was produced. */
  complete: boolean
  describe: string
}

/**
 * The permutations themselves, when there are few enough to have.
 *
 * The count is always returned, even when the list is refused. "There are 10^158 of them" is a complete answer to a
 * question about how many; producing them is a different request and one that cannot be satisfied.
 */
export function enumeratePermutations<T>(items: readonly T[], r = items.length): Enumeration<T[]> | DiscreteError {
  const count = permutations(items.length, r)
  if (isDiscreteError(count)) return count
  if (count > BigInt(DISCRETE_LIMITS.enumerate)) {
    return fail(
      'too-many',
      `There are ${count} of them, which is more than the ${DISCRETE_LIMITS.enumerate.toLocaleString('en')} Orbis lists. The count is exact and is available on its own; producing the list is a different question, and this one cannot be answered.`
    )
  }

  const out: T[][] = []
  const used = new Array<boolean>(items.length).fill(false)
  const current: T[] = []
  const walk = (): void => {
    if (current.length === r) {
      out.push([...current])
      return
    }
    for (let i = 0; i < items.length; i++) {
      if (used[i]) continue
      used[i] = true
      current.push(items[i])
      walk()
      current.pop()
      used[i] = false
    }
  }
  walk()

  return { items: out, count, complete: true, describe: `All ${count} arrangements of ${r} from ${items.length}.` }
}

export function enumerateCombinations<T>(items: readonly T[], r: number): Enumeration<T[]> | DiscreteError {
  const count = combinations(items.length, r)
  if (isDiscreteError(count)) return count
  if (count > BigInt(DISCRETE_LIMITS.enumerate)) {
    return fail(
      'too-many',
      `There are ${count} of them, which is more than the ${DISCRETE_LIMITS.enumerate.toLocaleString('en')} Orbis lists. The count itself is exact and available.`
    )
  }

  const out: T[][] = []
  const current: T[] = []
  const walk = (start: number): void => {
    if (current.length === r) {
      out.push([...current])
      return
    }
    for (let i = start; i < items.length; i++) {
      current.push(items[i])
      walk(i + 1)
      current.pop()
    }
  }
  walk(0)

  return { items: out, count, complete: true, describe: `All ${count} selections of ${r} from ${items.length}.` }
}

// ---------------------------------------------------------------- graphs

export interface Graph {
  vertices: string[]
  edges: { from: string; to: string; weight: number }[]
  directed: boolean
}

export const emptyGraph = (directed = false): Graph => ({ vertices: [], edges: [], directed })

export function graphOf(vertices: readonly string[], edges: readonly { from: string; to: string; weight?: number }[], directed = false): Graph | DiscreteError {
  if (vertices.length > DISCRETE_LIMITS.vertices) return fail('too-large', `A graph is limited to ${DISCRETE_LIMITS.vertices.toLocaleString('en')} vertices.`)
  if (edges.length > DISCRETE_LIMITS.edges) return fail('too-large', `A graph is limited to ${DISCRETE_LIMITS.edges.toLocaleString('en')} edges.`)

  const known = new Set(vertices)
  if (known.size !== vertices.length) return fail('duplicate', 'A vertex is listed more than once.')
  for (const edge of edges) {
    if (!known.has(edge.from)) return fail('not-found', `An edge starts at "${edge.from}", which is not a vertex.`)
    if (!known.has(edge.to)) return fail('not-found', `An edge ends at "${edge.to}", which is not a vertex.`)
    if (edge.weight !== undefined && !Number.isFinite(edge.weight)) return fail('invalid-argument', 'An edge weight has to be a finite number.')
  }

  return {
    vertices: [...vertices],
    edges: edges.map((one) => ({ from: one.from, to: one.to, weight: one.weight ?? 1 })),
    directed
  }
}

/** Neighbours of each vertex. Built once and passed around, because rebuilding it per step is what makes traversal slow. */
export function adjacencyOf(graph: Graph): Map<string, { to: string; weight: number }[]> {
  const out = new Map<string, { to: string; weight: number }[]>()
  for (const vertex of graph.vertices) out.set(vertex, [])
  for (const edge of graph.edges) {
    out.get(edge.from)?.push({ to: edge.to, weight: edge.weight })
    if (!graph.directed) out.get(edge.to)?.push({ to: edge.from, weight: edge.weight })
  }
  return out
}

export interface TraversalStep {
  visiting: string
  /** What is waiting to be visited, in order. The difference between breadth and depth first is visible here. */
  frontier: string[]
  visited: string[]
}

export interface Traversal {
  order: string[]
  steps: TraversalStep[]
  parents: Map<string, string | null>
  /** Vertices never reached, which is how a disconnected graph shows itself. */
  unreached: string[]
}

/** Breadth-first search. Every step is recorded, so a visualisation shows the real state and not an animation of one. */
export function breadthFirst(graph: Graph, start: string): Traversal | DiscreteError {
  if (!graph.vertices.includes(start)) return fail('not-found', `"${start}" is not a vertex of this graph.`)
  const adjacency = adjacencyOf(graph)
  const visited = new Set<string>([start])
  const parents = new Map<string, string | null>([[start, null]])
  const queue = [start]
  const order: string[] = []
  const steps: TraversalStep[] = []

  while (queue.length > 0) {
    const current = queue.shift() as string
    order.push(current)
    steps.push({ visiting: current, frontier: [...queue], visited: [...visited] })
    for (const { to } of (adjacency.get(current) ?? []).slice().sort((a, b) => a.to.localeCompare(b.to))) {
      if (visited.has(to)) continue
      visited.add(to)
      parents.set(to, current)
      queue.push(to)
    }
  }

  return { order, steps, parents, unreached: graph.vertices.filter((one) => !visited.has(one)) }
}

/** Depth-first search, with the same recording. The stack rather than the queue is the only difference. */
export function depthFirst(graph: Graph, start: string): Traversal | DiscreteError {
  if (!graph.vertices.includes(start)) return fail('not-found', `"${start}" is not a vertex of this graph.`)
  const adjacency = adjacencyOf(graph)
  const visited = new Set<string>()
  const parents = new Map<string, string | null>([[start, null]])
  const stack = [start]
  const order: string[] = []
  const steps: TraversalStep[] = []

  while (stack.length > 0) {
    const current = stack.pop() as string
    if (visited.has(current)) continue
    visited.add(current)
    order.push(current)
    steps.push({ visiting: current, frontier: [...stack], visited: [...visited] })
    // Reversed, so the alphabetically first neighbour is on top of the stack and comes out next.
    const neighbours = (adjacency.get(current) ?? []).slice().sort((a, b) => b.to.localeCompare(a.to))
    for (const { to } of neighbours) {
      if (visited.has(to)) continue
      if (!parents.has(to)) parents.set(to, current)
      stack.push(to)
    }
  }

  return { order, steps, parents, unreached: graph.vertices.filter((one) => !visited.has(one)) }
}

export interface ShortestPath {
  distances: Map<string, number>
  parents: Map<string, string | null>
  /** The path to a requested target, when one was asked for and exists. */
  path: string[] | null
  cost: number | null
  /** How many times the algorithm relaxed an edge. Deterministic, so two runs report the same work. */
  relaxations: number
  method: 'dijkstra' | 'bellman-ford'
  /** For Bellman-Ford: a cycle whose total weight is negative makes "shortest" meaningless. */
  negativeCycle: string[] | null
  notes: string[]
}

/**
 * Dijkstra's algorithm.
 *
 * Refuses a negative weight rather than producing a wrong answer. Dijkstra settles a vertex and never revisits it,
 * which is only sound when no later path can be shorter -- and a negative edge is exactly a later path that is. The
 * failure is silent otherwise: it returns a distance that is simply not the shortest.
 */
export function dijkstra(graph: Graph, start: string, target?: string): ShortestPath | DiscreteError {
  if (!graph.vertices.includes(start)) return fail('not-found', `"${start}" is not a vertex of this graph.`)
  if (target !== undefined && !graph.vertices.includes(target)) return fail('not-found', `"${target}" is not a vertex of this graph.`)

  const negative = graph.edges.find((one) => one.weight < 0)
  if (negative) {
    return fail(
      'negative-weight',
      `The edge from ${negative.from} to ${negative.to} has weight ${negative.weight}. Dijkstra's algorithm settles each vertex once and never revisits it, which a negative weight makes unsound -- it would return a distance that is not the shortest, without failing. Use Bellman-Ford, which handles negative weights.`
    )
  }

  const adjacency = adjacencyOf(graph)
  const distances = new Map<string, number>(graph.vertices.map((one) => [one, Number.POSITIVE_INFINITY]))
  const parents = new Map<string, string | null>([[start, null]])
  distances.set(start, 0)
  const settled = new Set<string>()
  let relaxations = 0

  for (;;) {
    let next: string | null = null
    let best = Number.POSITIVE_INFINITY
    // Sorted scan rather than a heap: deterministic ties, which matters more here than the asymptotics.
    for (const vertex of graph.vertices) {
      if (settled.has(vertex)) continue
      const distance = distances.get(vertex) as number
      if (distance < best || (distance === best && next !== null && vertex < next)) {
        best = distance
        next = vertex
      }
    }
    if (next === null || best === Number.POSITIVE_INFINITY) break
    settled.add(next)

    for (const { to, weight } of adjacency.get(next) ?? []) {
      const through = best + weight
      if (through < (distances.get(to) as number)) {
        distances.set(to, through)
        parents.set(to, next)
        relaxations += 1
      }
    }
  }

  const { path, cost } = pathTo(parents, distances, target)
  const unreachable = graph.vertices.filter((one) => distances.get(one) === Number.POSITIVE_INFINITY)
  const notes: string[] = []
  if (unreachable.length > 0) notes.push(`${unreachable.join(', ')} cannot be reached from ${start}.`)
  if (target !== undefined && path === null) notes.push(`There is no path from ${start} to ${target}.`)

  return { distances, parents, path, cost, relaxations, method: 'dijkstra', negativeCycle: null, notes }
}

/** Bellman-Ford. Handles negative weights, and detects a negative cycle rather than looping or returning nonsense. */
export function bellmanFord(graph: Graph, start: string, target?: string): ShortestPath | DiscreteError {
  if (!graph.vertices.includes(start)) return fail('not-found', `"${start}" is not a vertex of this graph.`)

  const distances = new Map<string, number>(graph.vertices.map((one) => [one, Number.POSITIVE_INFINITY]))
  const parents = new Map<string, string | null>([[start, null]])
  distances.set(start, 0)
  let relaxations = 0

  const directedEdges = graph.directed
    ? graph.edges
    : graph.edges.flatMap((one) => [one, { from: one.to, to: one.from, weight: one.weight }])

  for (let pass = 0; pass < graph.vertices.length - 1; pass++) {
    let changed = false
    for (const edge of directedEdges) {
      const from = distances.get(edge.from) as number
      if (from === Number.POSITIVE_INFINITY) continue
      if (from + edge.weight < (distances.get(edge.to) as number)) {
        distances.set(edge.to, from + edge.weight)
        parents.set(edge.to, edge.from)
        relaxations += 1
        changed = true
      }
    }
    // Nothing moved, so nothing will. Stopping early is not only faster; it is how the cycle check stays meaningful.
    if (!changed) break
  }

  let negativeCycle: string[] | null = null
  for (const edge of directedEdges) {
    const from = distances.get(edge.from) as number
    if (from === Number.POSITIVE_INFINITY) continue
    if (from + edge.weight < (distances.get(edge.to) as number)) {
      // A further improvement after n-1 passes means a cycle of negative total weight.
      const cycle: string[] = [edge.to]
      let current = edge.from
      const seen = new Set<string>([edge.to])
      while (!seen.has(current) && cycle.length < graph.vertices.length + 1) {
        seen.add(current)
        cycle.push(current)
        current = parents.get(current) ?? current
      }
      negativeCycle = cycle.reverse()
      break
    }
  }

  if (negativeCycle) {
    return {
      distances,
      parents,
      path: null,
      cost: null,
      relaxations,
      method: 'bellman-ford',
      negativeCycle,
      notes: [
        `There is a cycle of negative total weight through ${negativeCycle.join(' -> ')}. With one of those, going round again always costs less, so there is no shortest path -- not a long one, but none at all.`
      ]
    }
  }

  const { path, cost } = pathTo(parents, distances, target)
  return {
    distances,
    parents,
    path,
    cost,
    relaxations,
    method: 'bellman-ford',
    negativeCycle: null,
    notes: ['Bellman-Ford handles negative edge weights and checks for a negative cycle, which Dijkstra cannot do.']
  }
}

function pathTo(
  parents: Map<string, string | null>,
  distances: Map<string, number>,
  target?: string
): { path: string[] | null; cost: number | null } {
  if (target === undefined) return { path: null, cost: null }
  const distance = distances.get(target)
  if (distance === undefined || distance === Number.POSITIVE_INFINITY) return { path: null, cost: null }

  const path: string[] = []
  let current: string | null | undefined = target
  const seen = new Set<string>()
  while (current !== null && current !== undefined) {
    if (seen.has(current)) break
    seen.add(current)
    path.unshift(current)
    current = parents.get(current)
  }
  return { path, cost: distance }
}

export interface SpanningTree {
  edges: { from: string; to: string; weight: number }[]
  totalWeight: number
  /** Edges the algorithm considered and rejected, which is what a visualisation of Kruskal shows. */
  rejected: { from: string; to: string; weight: number; why: string }[]
  /** True when the graph was connected, so the result really is a spanning tree. */
  spanning: boolean
  method: 'kruskal' | 'prim'
  notes: string[]
}

/** Kruskal's algorithm with union-find. Rejected edges are kept, because they are the interesting part of the trace. */
export function kruskal(graph: Graph): SpanningTree | DiscreteError {
  if (graph.directed) return fail('invalid-argument', 'A spanning tree is for an undirected graph.')

  const parent = new Map(graph.vertices.map((one) => [one, one]))
  const find = (vertex: string): string => {
    let root = vertex
    while (parent.get(root) !== root) root = parent.get(root) as string
    // Path compression, so repeated finds on a long chain do not walk it every time.
    let current = vertex
    while (parent.get(current) !== root) {
      const next = parent.get(current) as string
      parent.set(current, root)
      current = next
    }
    return root
  }

  const sorted = [...graph.edges].sort((a, b) => a.weight - b.weight || a.from.localeCompare(b.from) || a.to.localeCompare(b.to))
  const edges: SpanningTree['edges'] = []
  const rejected: SpanningTree['rejected'] = []

  for (const edge of sorted) {
    const a = find(edge.from)
    const b = find(edge.to)
    if (a === b) {
      rejected.push({ ...edge, why: `${edge.from} and ${edge.to} are already connected, so this edge would close a cycle.` })
      continue
    }
    parent.set(a, b)
    edges.push({ ...edge })
  }

  const spanning = edges.length === graph.vertices.length - 1
  return {
    edges,
    totalWeight: edges.reduce((sum, one) => sum + one.weight, 0),
    rejected,
    spanning,
    method: 'kruskal',
    notes: spanning
      ? [`A spanning tree of ${edges.length} edges over ${graph.vertices.length} vertices, which is always one fewer than the vertices.`]
      : [
          `The graph is not connected: the result is a spanning forest of ${edges.length} edges over ${graph.vertices.length} vertices rather than a tree. A tree would need ${graph.vertices.length - 1}.`
        ]
  }
}

export interface ComponentInfo {
  components: string[][]
  count: number
  connected: boolean
}

/** Connected components, by repeated traversal from anything not yet reached. */
export function componentsOf(graph: Graph): ComponentInfo {
  const adjacency = adjacencyOf(graph)
  const seen = new Set<string>()
  const components: string[][] = []

  for (const vertex of graph.vertices) {
    if (seen.has(vertex)) continue
    const component: string[] = []
    const stack = [vertex]
    while (stack.length > 0) {
      const current = stack.pop() as string
      if (seen.has(current)) continue
      seen.add(current)
      component.push(current)
      for (const { to } of adjacency.get(current) ?? []) if (!seen.has(to)) stack.push(to)
    }
    components.push(component.sort())
  }

  return { components, count: components.length, connected: components.length <= 1 }
}

export interface CycleInfo {
  hasCycle: boolean
  /** The cycle found, when there is one. One of them, not necessarily the shortest. */
  cycle: string[] | null
  describe: string
}

/** Whether the graph has a cycle. Directed and undirected need different tests, and both are here. */
export function findCycle(graph: Graph): CycleInfo {
  const adjacency = adjacencyOf(graph)

  if (graph.directed) {
    const colour = new Map<string, 0 | 1 | 2>(graph.vertices.map((one) => [one, 0]))
    const stack: string[] = []
    let found: string[] | null = null

    const visit = (vertex: string): boolean => {
      colour.set(vertex, 1)
      stack.push(vertex)
      for (const { to } of adjacency.get(vertex) ?? []) {
        // Grey means it is on the current path, which is what makes this an edge back into the path.
        if (colour.get(to) === 1) {
          found = [...stack.slice(stack.indexOf(to)), to]
          return true
        }
        if (colour.get(to) === 0 && visit(to)) return true
      }
      colour.set(vertex, 2)
      stack.pop()
      return false
    }

    for (const vertex of graph.vertices) {
      if (colour.get(vertex) === 0 && visit(vertex)) break
    }
    return {
      hasCycle: found !== null,
      cycle: found,
      describe: found ? `There is a cycle: ${(found as string[]).join(' -> ')}.` : 'There is no directed cycle; this is a directed acyclic graph.'
    }
  }

  const parent = new Map<string, string | null>()
  const seen = new Set<string>()
  for (const start of graph.vertices) {
    if (seen.has(start)) continue
    const stack: string[] = [start]
    parent.set(start, null)
    while (stack.length > 0) {
      const current = stack.pop() as string
      if (seen.has(current)) continue
      seen.add(current)
      for (const { to } of adjacency.get(current) ?? []) {
        // An edge back to the parent is the same edge, not a cycle. Missing this reports every edge as a cycle.
        if (to === parent.get(current)) continue
        if (seen.has(to)) {
          const cycle: string[] = [to, current]
          let walk = parent.get(current)
          while (walk !== null && walk !== undefined && walk !== to) {
            cycle.push(walk)
            walk = parent.get(walk)
          }
          cycle.push(to)
          return { hasCycle: true, cycle, describe: `There is a cycle: ${cycle.join(' - ')}.` }
        }
        parent.set(to, current)
        stack.push(to)
      }
    }
  }
  return { hasCycle: false, cycle: null, describe: 'There is no cycle; this graph is a forest.' }
}

export interface BipartiteInfo {
  bipartite: boolean
  /** The two sides, when it is. */
  sides: [string[], string[]] | null
  /** An odd cycle, when it is not. That is the proof, not just a verdict. */
  oddCycle: string[] | null
  describe: string
}

/** Whether the graph is two-colourable. A graph is bipartite exactly when it has no odd cycle. */
export function isBipartite(graph: Graph): BipartiteInfo {
  const adjacency = adjacencyOf(graph)
  const colour = new Map<string, 0 | 1>()

  for (const start of graph.vertices) {
    if (colour.has(start)) continue
    colour.set(start, 0)
    const queue = [start]
    while (queue.length > 0) {
      const current = queue.shift() as string
      for (const { to } of adjacency.get(current) ?? []) {
        if (!colour.has(to)) {
          colour.set(to, colour.get(current) === 0 ? 1 : 0)
          queue.push(to)
          continue
        }
        if (colour.get(to) === colour.get(current)) {
          return {
            bipartite: false,
            sides: null,
            oddCycle: [current, to],
            describe: `Not bipartite: ${current} and ${to} are joined and would need the same colour, which happens exactly when there is a cycle of odd length.`
          }
        }
      }
    }
  }

  const left = graph.vertices.filter((one) => colour.get(one) === 0)
  const right = graph.vertices.filter((one) => colour.get(one) === 1)
  return {
    bipartite: true,
    sides: [left, right],
    oddCycle: null,
    describe: `Bipartite: the vertices split into ${left.length} and ${right.length} with every edge crossing between them.`
  }
}

export interface EulerianInfo {
  circuit: boolean
  path: boolean
  /** The traversal, when one exists. Every edge exactly once. */
  trail: string[] | null
  oddDegreeVertices: string[]
  describe: string
}

/**
 * Eulerian paths and circuits, from the degrees and connectivity.
 *
 * The conditions are exact: a circuit needs every degree even, a path needs exactly two odd. Both need the edges to be
 * connected. The trail itself is built by Hierholzer's algorithm and verified to use every edge once.
 */
export function eulerian(graph: Graph): EulerianInfo | DiscreteError {
  if (graph.directed) return fail('invalid-argument', 'This handles undirected graphs; a directed Eulerian trail has different conditions.')
  if (graph.edges.length === 0) return { circuit: true, path: true, trail: graph.vertices.slice(0, 1), oddDegreeVertices: [], describe: 'A graph with no edges trivially has an Eulerian circuit.' }

  const degree = new Map<string, number>(graph.vertices.map((one) => [one, 0]))
  for (const edge of graph.edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1)
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1)
  }
  const odd = graph.vertices.filter((one) => (degree.get(one) ?? 0) % 2 === 1)

  // Only the vertices that have edges need to be connected; an isolated vertex does not stop a trail existing.
  const withEdges = graph.vertices.filter((one) => (degree.get(one) ?? 0) > 0)
  const components = componentsOf({ ...graph, vertices: withEdges, edges: graph.edges })
  const connected = components.count <= 1

  const circuit = connected && odd.length === 0
  const path = connected && odd.length === 2

  if (!circuit && !path) {
    return {
      circuit: false,
      path: false,
      trail: null,
      oddDegreeVertices: odd,
      describe: !connected
        ? 'The edges are not all in one component, so no trail can use every one of them.'
        : `There are ${odd.length} vertices of odd degree (${odd.join(', ')}). A trail using every edge needs either none or exactly two, because every visit to a vertex uses two of its edges.`
    }
  }

  // Hierholzer: walk until stuck, then splice in detours from vertices with edges left.
  const remaining = new Map<string, { to: string; id: number }[]>()
  for (const vertex of graph.vertices) remaining.set(vertex, [])
  graph.edges.forEach((edge, id) => {
    remaining.get(edge.from)?.push({ to: edge.to, id })
    remaining.get(edge.to)?.push({ to: edge.from, id })
  })
  const used = new Set<number>()

  const start = path ? odd[0] : (withEdges[0] ?? graph.vertices[0])
  const stack: string[] = [start]
  const trail: string[] = []
  while (stack.length > 0) {
    const current = stack[stack.length - 1]
    const options = (remaining.get(current) ?? []).filter((one) => !used.has(one.id))
    if (options.length === 0) {
      trail.push(current)
      stack.pop()
      continue
    }
    const next = options[0]
    used.add(next.id)
    stack.push(next.to)
  }
  trail.reverse()

  const verified = used.size === graph.edges.length
  return {
    circuit,
    path,
    trail: verified ? trail : null,
    oddDegreeVertices: odd,
    describe: circuit
      ? `There is an Eulerian circuit: every degree is even and the edges are connected. The trail uses all ${graph.edges.length} edges once and returns to where it started.`
      : `There is an Eulerian path but not a circuit: ${odd.join(' and ')} have odd degree, so the trail has to start at one and end at the other.`
  }
}

export interface ColouringResult {
  colours: Map<string, number>
  used: number
  /** Whether `used` is the chromatic number or merely a colouring that was found. Never conflated. */
  optimal: boolean
  method: string
  describe: string
}

/**
 * A graph colouring, by the greedy algorithm in largest-degree-first order.
 *
 * The count is a colouring that was found, not the chromatic number. Greedy can use more colours than necessary, and
 * finding the true chromatic number is NP-hard; reporting the greedy count as the chromatic number would be claiming
 * to have solved something that was never attempted. Two colours is the exception: a graph is 2-colourable exactly when
 * it is bipartite, which is decidable, so that case can say `optimal`.
 */
export function greedyColouring(graph: Graph): ColouringResult {
  const adjacency = adjacencyOf(graph)
  const order = [...graph.vertices].sort((a, b) => (adjacency.get(b)?.length ?? 0) - (adjacency.get(a)?.length ?? 0) || a.localeCompare(b))

  const colours = new Map<string, number>()
  for (const vertex of order) {
    const taken = new Set((adjacency.get(vertex) ?? []).map((one) => colours.get(one.to)).filter((one) => one !== undefined))
    let colour = 0
    while (taken.has(colour)) colour += 1
    colours.set(vertex, colour)
  }

  const used = new Set(colours.values()).size
  const bipartite = isBipartite(graph)
  // A colouring with one or two colours is provably optimal: one means no edges, two means bipartite and not empty.
  const optimal = used <= 1 || (used === 2 && bipartite.bipartite)

  return {
    colours,
    used,
    optimal,
    method: 'greedy, largest degree first',
    describe: optimal
      ? `${used} colour${used === 1 ? '' : 's'}, and that is the fewest possible: ${used === 1 ? 'the graph has no edges' : 'the graph is bipartite and has at least one edge, so it needs exactly two'}.`
      : `${used} colours were used. This is a colouring that was found, not necessarily the fewest possible -- the greedy method can use more than necessary, and finding the true minimum is a hard problem that was not attempted.`
  }
}

export interface TopologicalResult {
  order: string[] | null
  /** The cycle that stops there being an order. */
  cycle: string[] | null
  describe: string
}

/** A topological order, or the cycle that makes one impossible. */
export function topologicalSort(graph: Graph): TopologicalResult | DiscreteError {
  if (!graph.directed) return fail('invalid-argument', 'A topological order is for a directed graph.')

  const incoming = new Map<string, number>(graph.vertices.map((one) => [one, 0]))
  for (const edge of graph.edges) incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1)

  const adjacency = adjacencyOf(graph)
  const ready = graph.vertices.filter((one) => incoming.get(one) === 0).sort()
  const order: string[] = []

  while (ready.length > 0) {
    const current = ready.shift() as string
    order.push(current)
    const next: string[] = []
    for (const { to } of adjacency.get(current) ?? []) {
      const count = (incoming.get(to) ?? 0) - 1
      incoming.set(to, count)
      if (count === 0) next.push(to)
    }
    next.sort()
    ready.push(...next)
  }

  if (order.length !== graph.vertices.length) {
    const stuck = graph.vertices.filter((one) => !order.includes(one))
    const cycle = findCycle({ ...graph, vertices: stuck, edges: graph.edges.filter((one) => stuck.includes(one.from) && stuck.includes(one.to)) })
    return {
      order: null,
      cycle: cycle.cycle,
      describe: `There is no topological order: ${stuck.join(', ')} depend on each other in a circle, so none of them can come first.`
    }
  }

  return { order, cycle: null, describe: `A valid order over ${order.length} vertices. It is one of possibly many; ties were broken alphabetically so it is the same every time.` }
}

// ---------------------------------------------------------------- relations

export interface RelationProperties {
  reflexive: boolean
  symmetric: boolean
  antisymmetric: boolean
  transitive: boolean
  equivalence: boolean
  partialOrder: boolean
  /** A pair that breaks each property that fails. A verdict without one is not something anybody can act on. */
  counterexamples: Record<string, string>
  describe: string
}

/** Which properties a finite relation has, with a counterexample for each one it does not. */
export function relationProperties(members: readonly string[], pairs: readonly [string, string][]): RelationProperties {
  const has = new Set(pairs.map(([a, b]) => `${a}\u0000${b}`))
  const related = (a: string, b: string): boolean => has.has(`${a}\u0000${b}`)
  const counterexamples: Record<string, string> = {}

  let reflexive = true
  for (const one of members) {
    if (!related(one, one)) {
      reflexive = false
      counterexamples.reflexive = `(${one}, ${one}) is missing.`
      break
    }
  }

  let symmetric = true
  let antisymmetric = true
  for (const [a, b] of pairs) {
    if (!related(b, a)) {
      if (symmetric) counterexamples.symmetric = `(${a}, ${b}) is in the relation but (${b}, ${a}) is not.`
      symmetric = false
    } else if (a !== b) {
      if (antisymmetric) counterexamples.antisymmetric = `(${a}, ${b}) and (${b}, ${a}) are both in the relation and ${a} is not ${b}.`
      antisymmetric = false
    }
  }

  let transitive = true
  for (const [a, b] of pairs) {
    for (const [c, d] of pairs) {
      if (b !== c) continue
      if (!related(a, d)) {
        if (transitive) counterexamples.transitive = `(${a}, ${b}) and (${c}, ${d}) are in the relation but (${a}, ${d}) is not.`
        transitive = false
      }
    }
  }

  const equivalence = reflexive && symmetric && transitive
  const partialOrder = reflexive && antisymmetric && transitive

  const held = [
    reflexive ? 'reflexive' : null,
    symmetric ? 'symmetric' : null,
    antisymmetric ? 'antisymmetric' : null,
    transitive ? 'transitive' : null
  ].filter((one): one is string => one !== null)

  return {
    reflexive,
    symmetric,
    antisymmetric,
    transitive,
    equivalence,
    partialOrder,
    counterexamples,
    describe:
      held.length === 0
        ? 'The relation has none of reflexivity, symmetry, antisymmetry or transitivity.'
        : `The relation is ${held.join(', ')}.${equivalence ? ' That makes it an equivalence relation.' : ''}${partialOrder ? ' That makes it a partial order.' : ''}`
  }
}

/** The equivalence classes of a relation that is one. Refused for a relation that is not, rather than approximated. */
export function equivalenceClasses(members: readonly string[], pairs: readonly [string, string][]): { classes: string[][]; describe: string } | DiscreteError {
  const properties = relationProperties(members, pairs)
  if (!properties.equivalence) {
    const missing = [
      properties.reflexive ? null : 'reflexive',
      properties.symmetric ? null : 'symmetric',
      properties.transitive ? null : 'transitive'
    ].filter((one): one is string => one !== null)
    return fail(
      'not-an-equivalence',
      `This relation has no equivalence classes because it is not an equivalence relation: it is not ${missing.join(' or ')}. ${missing.map((one) => properties.counterexamples[one]).filter(Boolean).join(' ')}`
    )
  }

  const has = new Set(pairs.map(([a, b]) => `${a}\u0000${b}`))
  const assigned = new Set<string>()
  const classes: string[][] = []
  for (const one of members) {
    if (assigned.has(one)) continue
    const group = members.filter((other) => has.has(`${one}\u0000${other}`))
    for (const member of group) assigned.add(member)
    classes.push(group.sort())
  }

  return {
    classes,
    describe: `${classes.length} equivalence class${classes.length === 1 ? '' : 'es'}. Every member is in exactly one, which is what an equivalence relation guarantees.`
  }
}

export interface OrderElements {
  minimal: string[]
  maximal: string[]
  /** The least element, when there is one. A minimal element is not a least element, and the two are not conflated. */
  least: string | null
  greatest: string | null
  incomparable: [string, string][]
  describe: string
}

/**
 * The extremal elements of a partial order.
 *
 * Minimal and least are different, and the difference is the reason this function exists. A minimal element has
 * nothing below it; a least element is below everything. A poset can have several minimal elements and no least one,
 * and a tool that prints "minimum" for both is wrong in exactly the interesting cases.
 */
export function orderElements(members: readonly string[], pairs: readonly [string, string][]): OrderElements | DiscreteError {
  const properties = relationProperties(members, pairs)
  if (!properties.partialOrder) {
    return fail('not-a-partial-order', `This relation is not a partial order, so it has no minimal or maximal elements in that sense. ${properties.describe}`)
  }

  const has = new Set(pairs.map(([a, b]) => `${a}\u0000${b}`))
  const below = (a: string, b: string): boolean => has.has(`${a}\u0000${b}`)

  const minimal = members.filter((one) => !members.some((other) => other !== one && below(other, one)))
  const maximal = members.filter((one) => !members.some((other) => other !== one && below(one, other)))
  const least = members.find((one) => members.every((other) => below(one, other))) ?? null
  const greatest = members.find((one) => members.every((other) => below(other, one))) ?? null

  const incomparable: [string, string][] = []
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      if (!below(members[i], members[j]) && !below(members[j], members[i])) incomparable.push([members[i], members[j]])
    }
  }

  return {
    minimal,
    maximal,
    least,
    greatest,
    incomparable,
    describe:
      least === null && minimal.length > 1
        ? `There are ${minimal.length} minimal elements (${minimal.join(', ')}) and no least element: nothing is below everything. A minimal element has nothing below it, which is not the same thing.`
        : `Minimal: ${minimal.join(', ') || 'none'}. Maximal: ${maximal.join(', ') || 'none'}. Least: ${least ?? 'none'}. Greatest: ${greatest ?? 'none'}.`
  }
}

/** The assumptions the engine rests on, for a Page that wants to show them rather than have them inferred. */
export const DISCRETE_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Everything is exact. Counts are bigints, because a factorial passes what a double holds at 19.',
  'A count and an enumeration are different questions. The count is always given; the list is refused when it cannot be produced.',
  'Primality below 3.317 x 10^24 is proven. Above it the same test is probabilistic, and the result says which.',
  'A factorisation that could not be finished says so and gives the part left over, rather than presenting a partial answer as complete.',
  'A congruence with a non-invertible coefficient has several solutions, and all of them are returned.',
  'Dijkstra refuses a negative weight rather than returning a distance that is not the shortest.',
  'A greedy colouring is a colouring that was found, not the chromatic number, except where two colours can be proven optimal.',
  'A missing intersection in inclusion-exclusion is reported, never taken to be empty.',
  'Minimal and least are different, and so are maximal and greatest.'
])
