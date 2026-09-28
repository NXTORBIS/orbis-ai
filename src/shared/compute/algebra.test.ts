import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  ALGEBRA_ASSUMPTIONS,
  ALGEBRA_LIMITS,
  ONE,
  ZERO,
  addRational,
  analyseSequence,
  antiderivativeOf,
  argument,
  assume,
  canSimplify,
  cartesianProduct,
  compareRational,
  complementOf,
  complex,
  complexToText,
  conjugate,
  degreeOf,
  derivativeOf,
  differenceOf,
  divideComplex,
  dividePolynomials,
  divideRational,
  equivalent,
  evaluatePolynomial,
  evaluateProposition,
  fromDecimal,
  integerSquareRoot,
  intersectionOf,
  isAlgebraError,
  isSubset,
  modulus,
  multiplyComplex,
  multiplyPolynomials,
  multiplyRational,
  numericRoots,
  polynomial,
  polynomialToText,
  powerComplex,
  powerRational,
  powerSet,
  radicalToText,
  rational,
  rationalToText,
  rootsOf,
  rootsOfComplex,
  satisfies,
  setOf,
  setsEqual,
  simplifyRadical,
  subtractRational,
  sumSeries,
  symmetricDifferenceOf,
  termsOf,
  toConjunctiveNormalForm,
  toDecimal,
  toDisjunctiveNormalForm,
  toNumber,
  truthTable,
  unionOf,
  type Polynomial,
  type Proposition,
  type Rational
} from './algebra.ts'

const r = (n: number | bigint, d: number | bigint = 1n): Rational => {
  const one = rational(n, d)
  if (isAlgebraError(one)) throw new Error(one.message)
  return one
}

const poly = (coefficients: (number | Rational)[], variable = 'x'): Polynomial => {
  const one = polynomial(coefficients.map((c) => (typeof c === 'number' ? r(c) : c)), variable)
  if (isAlgebraError(one)) throw new Error(one.message)
  return one
}

describe('rationals', () => {
  test('a rational is always reduced with the sign on the numerator', () => {
    assert.deepEqual(r(4, 8), { n: 1n, d: 2n })
    assert.deepEqual(r(1, -2), { n: -1n, d: 2n })
    assert.deepEqual(r(-6, -4), { n: 3n, d: 2n })
  })

  test('a zero denominator is refused', () => {
    const one = rational(1, 0)
    assert.ok(isAlgebraError(one))
    assert.equal(one.error, 'division-by-zero')
  })

  test('arithmetic stays exact where a double would not', () => {
    // 0.1 + 0.2 is famously not 0.3 in a double. As rationals it is exactly three tenths.
    const sum = addRational(r(1, 10), r(2, 10))
    assert.deepEqual(sum, { n: 3n, d: 10n })
    assert.notEqual(0.1 + 0.2, 0.3)
  })

  test('adding sevenths thirty times stays exact, which is what bigints buy', () => {
    let total = ZERO
    for (let i = 0; i < 30; i++) total = addRational(total, r(1, 7))
    assert.deepEqual(total, { n: 30n, d: 7n })
  })

  test('the four operations behave', () => {
    assert.deepEqual(subtractRational(r(3, 4), r(1, 4)), { n: 1n, d: 2n })
    assert.deepEqual(multiplyRational(r(2, 3), r(3, 4)), { n: 1n, d: 2n })
    const quotient = divideRational(r(1, 2), r(1, 4))
    assert.ok(!isAlgebraError(quotient))
    assert.deepEqual(quotient, { n: 2n, d: 1n })
  })

  test('dividing by zero is refused', () => {
    assert.ok(isAlgebraError(divideRational(ONE, ZERO)))
  })

  test('zero to the power zero is refused rather than given a convenient value', () => {
    const one = powerRational(ZERO, 0)
    assert.ok(isAlgebraError(one))
    assert.match(one.message, /no single agreed value/)
  })

  test('a negative power inverts', () => {
    const one = powerRational(r(2, 3), -2)
    assert.ok(!isAlgebraError(one))
    assert.deepEqual(one, { n: 9n, d: 4n })
  })

  test('comparison works across denominators', () => {
    assert.equal(compareRational(r(1, 3), r(1, 2)), -1)
    assert.equal(compareRational(r(2, 4), r(1, 2)), 0)
    assert.equal(compareRational(r(-1, 2), r(-2, 3)), 1)
  })

  test('a decimal string becomes the exact rational, not the nearest double', () => {
    const tenth = fromDecimal('0.1')
    assert.ok(!isAlgebraError(tenth))
    assert.deepEqual(tenth, { n: 1n, d: 10n })
    const negative = fromDecimal('-1.25')
    assert.ok(!isAlgebraError(negative))
    assert.deepEqual(negative, { n: -5n, d: 4n })
    const scientific = fromDecimal('1.5e3')
    assert.ok(!isAlgebraError(scientific))
    assert.deepEqual(scientific, { n: 1500n, d: 1n })
  })

  test('something that is not a decimal is refused', () => {
    assert.ok(isAlgebraError(fromDecimal('abc')))
    assert.ok(isAlgebraError(fromDecimal('')))
  })

  test('a recurring decimal is reported as recurring rather than truncated', () => {
    const third = toDecimal(r(1, 3))
    assert.equal(third.text, '0.(3)')
    assert.equal(third.exact, false)
    assert.equal(third.repeating, '3')

    const seventh = toDecimal(r(1, 7))
    assert.equal(seventh.repeating, '142857')
  })

  test('a terminating decimal is marked exact', () => {
    const quarter = toDecimal(r(1, 4))
    assert.equal(quarter.text, '0.25')
    assert.equal(quarter.exact, true)
  })

  test('a whole number has no decimal part', () => {
    assert.equal(toDecimal(r(5)).text, '5')
    assert.equal(toDecimal(r(-5)).text, '-5')
  })

  test('text keeps the fraction rather than converting it', () => {
    assert.equal(rationalToText(r(1, 3)), '1/3')
    assert.equal(rationalToText(r(4, 2)), '2')
    assert.ok(Math.abs(toNumber(r(1, 3)) - 1 / 3) < 1e-15)
  })
})

describe('radicals', () => {
  test('a square root stays exact, with the square factors pulled out', () => {
    const eight = simplifyRadical(8n)
    assert.ok(!isAlgebraError(eight))
    assert.equal(radicalToText(eight), '2*sqrt(2)')
    assert.equal(eight.radicand, 2n)
  })

  test('a perfect square has no root left', () => {
    const nine = simplifyRadical(9n)
    assert.ok(!isAlgebraError(nine))
    assert.equal(radicalToText(nine), '3')
    assert.equal(nine.radicand, 1n)
  })

  test('a square-free radicand is left alone', () => {
    const two = simplifyRadical(2n)
    assert.ok(!isAlgebraError(two))
    assert.equal(radicalToText(two), 'sqrt(2)')
  })

  test('a larger case: sqrt(72) is 6*sqrt(2)', () => {
    const one = simplifyRadical(72n)
    assert.ok(!isAlgebraError(one))
    assert.equal(radicalToText(one), '6*sqrt(2)')
  })

  test('a negative radicand is refused as not real', () => {
    const one = simplifyRadical(-4n)
    assert.ok(isAlgebraError(one))
    assert.match(one.message, /not real/)
  })

  test('the integer square root is exact for a perfect square and floored otherwise', () => {
    const perfect = integerSquareRoot(144n)
    assert.ok(!isAlgebraError(perfect))
    assert.equal(perfect.root, 12n)
    assert.equal(perfect.exact, true)

    const not = integerSquareRoot(145n)
    assert.ok(!isAlgebraError(not))
    assert.equal(not.root, 12n)
    assert.equal(not.exact, false)
  })

  test('the integer square root is exact for a number far past what a double holds', () => {
    const big = 123456789012345678901234567890n
    const squared = big * big
    const root = integerSquareRoot(squared)
    assert.ok(!isAlgebraError(root))
    assert.equal(root.root, big)
    assert.equal(root.exact, true)
  })
})

describe('complex numbers', () => {
  test('arithmetic follows the definitions', () => {
    assert.deepEqual(multiplyComplex(complex(0, 1), complex(0, 1)), { re: -1, im: 0 })
    assert.deepEqual(conjugate(complex(3, -4)), { re: 3, im: 4 })
    assert.equal(modulus(complex(3, 4)), 5)
  })

  test('division is refused by zero', () => {
    assert.ok(isAlgebraError(divideComplex(complex(1), complex(0))))
    const quotient = divideComplex(complex(1, 1), complex(1, -1))
    assert.ok(!isAlgebraError(quotient))
    assert.ok(Math.abs(quotient.re) < 1e-15 && Math.abs(quotient.im - 1) < 1e-15)
  })

  test('the argument is the principal one', () => {
    assert.ok(Math.abs(argument(complex(0, 1)) - Math.PI / 2) < 1e-15)
    assert.ok(Math.abs(argument(complex(-1, 0)) - Math.PI) < 1e-15)
  })

  test('a power follows de Moivre', () => {
    const cubed = powerComplex(complex(0, 1), 3)
    assert.ok(Math.abs(cubed.re) < 1e-12 && Math.abs(cubed.im + 1) < 1e-12)
  })

  test('every nth root is returned, not just the principal one', () => {
    const roots = rootsOfComplex(complex(1), 3)
    assert.ok(!isAlgebraError(roots))
    assert.equal(roots.length, 3)
    // Each cubes back to one.
    for (const root of roots) {
      const cubed = powerComplex(root, 3)
      assert.ok(Math.abs(cubed.re - 1) < 1e-10 && Math.abs(cubed.im) < 1e-10)
    }
  })

  test('the text form reads as people write it', () => {
    assert.equal(complexToText(complex(3, 4)), '3 + 4i')
    assert.equal(complexToText(complex(3, -4)), '3 - 4i')
    assert.equal(complexToText(complex(0, 1)), 'i')
    assert.equal(complexToText(complex(0, -1)), '-i')
    assert.equal(complexToText(complex(5, 0)), '5')
  })
})

describe('polynomials', () => {
  test('the zero polynomial has degree minus one, not zero', () => {
    assert.equal(degreeOf(poly([0])), -1)
    assert.equal(degreeOf(poly([5])), 0)
    assert.equal(degreeOf(poly([1, 2, 3])), 2)
  })

  test('trailing zeros do not inflate the degree', () => {
    assert.equal(degreeOf(poly([1, 2, 0, 0])), 1)
  })

  test('multiplication is exact', () => {
    // (x + 1)(x - 1) = x^2 - 1
    const product = multiplyPolynomials(poly([1, 1]), poly([-1, 1]))
    assert.ok(!isAlgebraError(product))
    assert.equal(polynomialToText(product), 'x^2 - 1')
  })

  test('long division keeps the remainder, which is half the answer', () => {
    // (x^2 + 1) / (x + 1) = x - 1 remainder 2
    const divided = dividePolynomials(poly([1, 0, 1]), poly([1, 1]))
    assert.ok(!isAlgebraError(divided))
    assert.equal(polynomialToText(divided.quotient), 'x - 1')
    assert.equal(polynomialToText(divided.remainder), '2')
    assert.match(divided.describe, /remainder of 2/)
  })

  test('an exact division says so', () => {
    const divided = dividePolynomials(poly([-1, 0, 1]), poly([-1, 1]))
    assert.ok(!isAlgebraError(divided))
    assert.equal(polynomialToText(divided.quotient), 'x + 1')
    assert.equal(degreeOf(divided.remainder), -1)
    assert.match(divided.describe, /no remainder/)
  })

  test('dividing by the zero polynomial is refused', () => {
    assert.ok(isAlgebraError(dividePolynomials(poly([1, 1]), poly([0]))))
  })

  test('evaluation is exact', () => {
    // x^2 + 2x + 1 at 1/2 is 9/4.
    assert.deepEqual(evaluatePolynomial(poly([1, 2, 1]), r(1, 2)), { n: 9n, d: 4n })
  })

  test('the derivative and the antiderivative are exact and undo each other', () => {
    const one = poly([0, 0, 0, 1])
    const derivative = derivativeOf(one)
    assert.ok(!isAlgebraError(derivative))
    assert.equal(polynomialToText(derivative), '3x^2')
    const back = antiderivativeOf(derivative)
    assert.ok(!isAlgebraError(back))
    assert.equal(polynomialToText(back), 'x^3')
  })

  test('the text form reads as people write it', () => {
    assert.equal(polynomialToText(poly([1, 2, 1])), 'x^2 + 2x + 1')
    assert.equal(polynomialToText(poly([-1, 0, 1])), 'x^2 - 1')
    assert.equal(polynomialToText(poly([0, 1])), 'x')
    assert.equal(polynomialToText(poly([0])), '0')
  })
})

describe('roots', () => {
  test('rational roots are found exactly', () => {
    // x^2 - 5x + 6 = (x-2)(x-3)
    const found = rootsOf(poly([6, -5, 1]))
    assert.ok(!isAlgebraError(found))
    assert.deepEqual(found.rational.map(rationalToText).sort(), ['2', '3'])
    assert.equal(found.numeric.length, 0)
    assert.ok(found.method.includes('rational root theorem'))
  })

  test('a root at zero is found by factoring out x', () => {
    const found = rootsOf(poly([0, -1, 1]))
    assert.ok(!isAlgebraError(found))
    assert.ok(found.rational.some((one) => rationalToText(one) === '0'))
    assert.ok(found.method.includes('factored out x'))
  })

  test('a repeated root is found as many times as it repeats', () => {
    // (x-2)^2 = x^2 - 4x + 4
    const found = rootsOf(poly([4, -4, 1]))
    assert.ok(!isAlgebraError(found))
    assert.deepEqual(found.rational.map(rationalToText), ['2', '2'])
  })

  test('a fractional root is found exactly', () => {
    // 2x - 1 has the root 1/2.
    const found = rootsOf(poly([-1, 2]))
    assert.ok(!isAlgebraError(found))
    assert.deepEqual(found.rational.map(rationalToText), ['1/2'])
  })

  test('an irrational quadratic falls back to the formula, and the discriminant is reported', () => {
    // x^2 - 2 has roots +-sqrt(2), which are not rational.
    const found = rootsOf(poly([-2, 0, 1]))
    assert.ok(!isAlgebraError(found))
    assert.equal(found.rational.length, 0)
    assert.equal(found.numeric.length, 2)
    assert.ok(Math.abs(Math.abs(found.numeric[0].re) - Math.SQRT2) < 1e-12)
    assert.ok(found.notes.some((one) => /discriminant/.test(one)))
  })

  test('a complex conjugate pair is reported as such', () => {
    // x^2 + 1 has roots +-i.
    const found = rootsOf(poly([1, 0, 1]))
    assert.ok(!isAlgebraError(found))
    assert.equal(found.numeric.length, 2)
    assert.ok(Math.abs(found.numeric[0].im) > 0.5)
    assert.ok(found.notes.some((one) => /complex conjugate pair/.test(one)))
  })

  test('a quintic with no closed form is solved numerically and says why', () => {
    // x^5 - x - 1 has no rational roots and no solution in radicals.
    const found = rootsOf(poly([-1, -1, 0, 0, 0, 1]))
    assert.ok(!isAlgebraError(found))
    assert.equal(found.rational.length, 0)
    assert.equal(found.numeric.length, 5)
    assert.ok(found.notes.some((one) => /no general formula in radicals/.test(one)))
    assert.ok(found.method.includes('numerical (Durand-Kerner)'))
  })

  test('numerical roots actually satisfy the polynomial', () => {
    const one = poly([-6, 11, -6, 1]) // (x-1)(x-2)(x-3)
    const roots = numericRoots(one)
    assert.ok(!isAlgebraError(roots))
    for (const root of roots) {
      const value = evaluatePolynomial(one, r(Math.round(root.re * 1e9), 1e9))
      assert.ok(Math.abs(toNumber(value)) < 1e-6, `root ${root.re} gives ${toNumber(value)}`)
    }
  })

  test('a root within rounding of the real axis is reported as real', () => {
    const roots = numericRoots(poly([-1, 0, 0, 1])) // x^3 - 1
    assert.ok(!isAlgebraError(roots))
    const real = roots.filter((one) => one.im === 0)
    assert.equal(real.length, 1)
    assert.ok(Math.abs(real[0].re - 1) < 1e-10)
  })

  test('the zero polynomial is refused rather than given a root list', () => {
    assert.ok(isAlgebraError(rootsOf(poly([0]))))
  })
})

describe('assumptions', () => {
  test('nothing is assumed by default', () => {
    const one = assume('x', 'complex')
    assert.equal(one.positive, null)
    assert.equal(one.nonZero, null)
  })

  test('a domain fills in what follows from it', () => {
    assert.equal(assume('n', 'integer').integer, true)
    assert.equal(assume('n', 'natural').integer, true)
    assert.equal(assume('x', 'real').integer, null)
  })

  test('sqrt of a square simplifies only when the symbol is known not to be negative', () => {
    const unknown = canSimplify('sqrt(x^2)', assume('x', 'real'))
    assert.equal(unknown.allowed, false)
    assert.equal(unknown.result, '|x|')
    assert.equal(unknown.needs, 'x >= 0')
    assert.match(unknown.describe, /differ by a sign/)

    const known = canSimplify('sqrt(x^2)', assume('x', 'real', { positive: true }))
    assert.equal(known.allowed, true)
    assert.equal(known.result, 'x')
  })

  test('cancelling needs the symbol to be known not to be zero', () => {
    assert.equal(canSimplify('x/x', assume('x', 'real')).allowed, false)
    assert.equal(canSimplify('x/x', assume('x', 'real', { nonZero: true })).allowed, true)
  })

  test('bringing an exponent out of a logarithm needs positivity', () => {
    const refused = canSimplify('log(x^n)', assume('x', 'real'))
    assert.equal(refused.allowed, false)
    assert.match(refused.describe, /the right is not/)
  })

  test('an unknown rule is refused rather than guessed at', () => {
    assert.equal(canSimplify('nonsense', assume('x', 'real')).allowed, false)
  })

  test('a value is checked against what is assumed', () => {
    assert.equal(satisfies(2.5, assume('n', 'integer')).ok, false)
    assert.equal(satisfies(-1, assume('n', 'natural')).ok, false)
    assert.equal(satisfies(0, assume('x', 'real', { nonZero: true })).ok, false)
    assert.equal(satisfies(5, assume('x', 'real', { between: { low: 0, high: 10, inclusive: true } })).ok, true)
    assert.equal(satisfies(11, assume('x', 'real', { between: { low: 0, high: 10, inclusive: true } })).ok, false)
  })
})

describe('sequences', () => {
  test('an arithmetic sequence is computed rather than accumulated', () => {
    const terms = termsOf({ kind: 'arithmetic', first: 0, difference: 0.1 }, 11)
    assert.ok(!isAlgebraError(terms))
    // Repeated addition of 0.1 drifts by the eleventh term; index times difference does not.
    assert.ok(Math.abs(terms[10] - 1) < 1e-15)
  })

  test('a geometric sequence follows its ratio', () => {
    const terms = termsOf({ kind: 'geometric', first: 3, ratio: 2 }, 5)
    assert.ok(!isAlgebraError(terms))
    assert.deepEqual(terms, [3, 6, 12, 24, 48])
  })

  test('a recursive sequence uses its seeds', () => {
    const terms = termsOf({ kind: 'recursive', seeds: [1, 1], step: (previous) => previous[previous.length - 1] + previous[previous.length - 2] }, 8)
    assert.ok(!isAlgebraError(terms))
    assert.deepEqual(terms, [1, 1, 2, 3, 5, 8, 13, 21])
  })

  test('a term with no finite value stops the sequence rather than continuing with a made-up number', () => {
    const terms = termsOf({ kind: 'explicit', formula: (n) => 1 / (n - 3) }, 5)
    assert.ok(isAlgebraError(terms))
    assert.match(terms.message, /Term 3/)
  })

  test('a pattern is reported as consistency, never as proof', () => {
    const analysis = analyseSequence([2, 4, 6, 8])
    assert.ok(!isAlgebraError(analysis))
    assert.equal(analysis.pattern.kind, 'arithmetic')
    assert.match(analysis.pattern.describe, /cannot prove/)
    assert.ok(analysis.notes.some((one) => /cannot be established from a finite number of terms/.test(one)))
  })

  test('a geometric pattern is recognised', () => {
    const analysis = analyseSequence([3, 6, 12, 24])
    assert.ok(!isAlgebraError(analysis))
    assert.equal(analysis.pattern.kind, 'geometric')
    assert.equal(analysis.pattern.parameter, 2)
  })

  test('a quadratic pattern is recognised from the second differences', () => {
    const analysis = analyseSequence([1, 4, 9, 16, 25])
    assert.ok(!isAlgebraError(analysis))
    assert.equal(analysis.pattern.kind, 'quadratic')
    assert.equal(analysis.pattern.parameter, 2)
  })

  test('terms with no pattern are reported as having none rather than being forced into one', () => {
    const analysis = analyseSequence([1, 7, 2, 19])
    assert.ok(!isAlgebraError(analysis))
    assert.equal(analysis.pattern.kind, 'none')
  })

  test('repetition in the terms given is reported as a property of those terms', () => {
    const analysis = analyseSequence([1, 2, 1, 2, 1, 2])
    assert.ok(!isAlgebraError(analysis))
    assert.equal(analysis.period, 2)
    assert.ok(analysis.notes.some((one) => /not a proof about the sequence/.test(one)))
  })

  test('monotonicity is reported from the differences', () => {
    assert.equal((analyseSequence([1, 2, 3]) as { monotone: string }).monotone, 'increasing')
    assert.equal((analyseSequence([3, 2, 1]) as { monotone: string }).monotone, 'decreasing')
    assert.equal((analyseSequence([2, 2, 2]) as { monotone: string }).monotone, 'constant')
    assert.equal((analyseSequence([1, 3, 2]) as { monotone: string }).monotone, 'neither')
  })
})

describe('series', () => {
  test('a convergent geometric series has an exact sum', () => {
    const terms = termsOf({ kind: 'geometric', first: 1, ratio: 0.5 }, 20)
    assert.ok(!isAlgebraError(terms))
    const result = sumSeries(terms, { knownForm: 'geometric', parameter: 0.5 })
    assert.ok(!isAlgebraError(result))
    assert.equal(result.behaviour, 'converges')
    assert.equal(result.exact, 2)
  })

  test('a divergent geometric series says so', () => {
    const terms = termsOf({ kind: 'geometric', first: 1, ratio: 2 }, 10)
    assert.ok(!isAlgebraError(terms))
    const result = sumSeries(terms, { knownForm: 'geometric', parameter: 2 })
    assert.ok(!isAlgebraError(result))
    assert.equal(result.behaviour, 'diverges')
    assert.equal(result.exact, null)
  })

  test('the harmonic series is called divergent although its partial sums look settled', () => {
    const terms = termsOf({ kind: 'explicit', formula: (n) => 1 / n }, 100)
    assert.ok(!isAlgebraError(terms))
    const result = sumSeries(terms, { knownForm: 'harmonic' })
    assert.ok(!isAlgebraError(result))
    assert.equal(result.behaviour, 'diverges')
    assert.match(result.describe, /look settled for a very long time/)
  })

  test('the ratio test decides where it applies', () => {
    const terms = termsOf({ kind: 'geometric', first: 1, ratio: 0.3 }, 20)
    assert.ok(!isAlgebraError(terms))
    const result = sumSeries(terms)
    assert.ok(!isAlgebraError(result))
    assert.equal(result.behaviour, 'converges')
    assert.equal(result.test, 'ratio test')
  })

  test('where no test applies, the behaviour is unknown rather than inferred from the partial sums', () => {
    const result = sumSeries([1, 1, 1, 1, 1])
    assert.ok(!isAlgebraError(result))
    assert.equal(result.behaviour, 'unknown')
    assert.match(result.describe, /Partial sums that stop moving are not convergence/)
  })

  test('partial sums are returned whatever the verdict', () => {
    const result = sumSeries([1, 2, 3, 4])
    assert.ok(!isAlgebraError(result))
    assert.deepEqual(result.partialSums, [1, 3, 6, 10])
  })
})

describe('sets', () => {
  const a = setOf(['1', '2', '3'])
  const b = setOf(['2', '3', '4'])

  test('a set holds each member once', () => {
    assert.deepEqual(setOf(['a', 'b', 'a']).members, ['a', 'b'])
  })

  test('the operations behave', () => {
    assert.deepEqual(unionOf(a, b).members, ['1', '2', '3', '4'])
    assert.deepEqual(intersectionOf(a, b).members, ['2', '3'])
    assert.deepEqual(differenceOf(a, b).members, ['1'])
    assert.deepEqual(symmetricDifferenceOf(a, b).members.sort(), ['1', '4'])
  })

  test('a complement needs a universe, and members outside it are refused', () => {
    const universe = setOf(['1', '2', '3', '4', '5'])
    const complement = complementOf(a, universe)
    assert.ok(!isAlgebraError(complement))
    assert.deepEqual(complement.members, ['4', '5'])

    const outside = complementOf(setOf(['9']), universe)
    assert.ok(isAlgebraError(outside))
    assert.match(outside.message, /not in the universe/)
  })

  test('subset and equality behave', () => {
    assert.equal(isSubset(setOf(['1', '2']), a), true)
    assert.equal(isSubset(a, setOf(['1', '2'])), false)
    assert.equal(setsEqual(setOf(['2', '1']), setOf(['1', '2'])), true)
  })

  test('a Cartesian product pairs every member with every other', () => {
    const product = cartesianProduct(setOf(['a', 'b']), setOf(['1', '2']))
    assert.ok(!isAlgebraError(product))
    assert.deepEqual(product.members, ['(a, 1)', '(a, 2)', '(b, 1)', '(b, 2)'])
  })

  test('a power set of a small set is listed', () => {
    const power = powerSet(setOf(['a', 'b']))
    assert.ok(!isAlgebraError(power))
    assert.equal(power.size, 4)
    assert.deepEqual(power.subsets.map((one) => one.members.join('')).sort(), ['', 'a', 'ab', 'b'])
  })

  test('a power set that would be enormous is refused, with the count given', () => {
    const power = powerSet(setOf(Array.from({ length: 25 }, (_, i) => String(i))))
    assert.ok(isAlgebraError(power))
    assert.match(power.message, /2\^25/)
  })
})

describe('propositional logic', () => {
  const p: Proposition = { kind: 'variable', name: 'p' }
  const q: Proposition = { kind: 'variable', name: 'q' }

  test('implication is false only when the left is true and the right is false', () => {
    const rows = [
      [true, true, true],
      [true, false, false],
      [false, true, true],
      [false, false, true]
    ] as const
    for (const [left, right, expected] of rows) {
      assert.equal(evaluateProposition({ kind: 'implies', left: p, right: q }, { p: left, q: right }), expected)
    }
  })

  test('a truth table has one row per assignment', () => {
    const table = truthTable({ kind: 'and', left: p, right: q })
    assert.ok(!isAlgebraError(table))
    assert.equal(table.rows.length, 4)
    assert.equal(table.rows.filter((one) => one.result).length, 1)
  })

  test('a tautology and a contradiction are recognised', () => {
    const tautology = truthTable({ kind: 'or', left: p, right: { kind: 'not', operand: p } })
    assert.ok(!isAlgebraError(tautology))
    assert.equal(tautology.tautology, true)

    const contradiction = truthTable({ kind: 'and', left: p, right: { kind: 'not', operand: p } })
    assert.ok(!isAlgebraError(contradiction))
    assert.equal(contradiction.contradiction, true)
    assert.equal(contradiction.satisfiable, false)
    assert.equal(contradiction.witness, null)
  })

  test('a satisfiable proposition comes with the assignment that satisfies it', () => {
    const table = truthTable({ kind: 'and', left: p, right: q })
    assert.ok(!isAlgebraError(table))
    assert.deepEqual(table.witness, { p: true, q: true })
  })

  test('a variable called constructor is a variable, not a lookup on Object.prototype', () => {
    const table = truthTable({ kind: 'variable', name: 'constructor' })
    assert.ok(!isAlgebraError(table))
    assert.equal(table.rows.length, 2)
    assert.deepEqual(table.rows.map((one) => one.result), [false, true])
  })

  test('a missing value is refused rather than treated as false', () => {
    assert.ok(isAlgebraError(evaluateProposition(p, {})))
  })

  test('too many variables is refused, with the row count named', () => {
    let big: Proposition = { kind: 'variable', name: 'v0' }
    for (let i = 1; i < 20; i++) big = { kind: 'and', left: big, right: { kind: 'variable', name: `v${i}` } }
    const table = truthTable(big)
    assert.ok(isAlgebraError(table))
    assert.match(table.message, /2\^20/)
  })

  test('equivalence is decided by the tables, with a counterexample when they differ', () => {
    const implication: Proposition = { kind: 'implies', left: p, right: q }
    const contrapositive: Proposition = { kind: 'or', left: { kind: 'not', operand: p }, right: q }
    const same = equivalent(implication, contrapositive)
    assert.ok(!isAlgebraError(same))
    assert.equal(same.equivalent, true)

    const different = equivalent(implication, { kind: 'and', left: p, right: q })
    assert.ok(!isAlgebraError(different))
    assert.equal(different.equivalent, false)
    assert.ok(different.counterexample)
    assert.match(different.describe, /They differ when/)
  })

  test('normal forms are correct by construction and do not claim to be minimal', () => {
    const dnf = toDisjunctiveNormalForm({ kind: 'xor', left: p, right: q })
    assert.ok(!isAlgebraError(dnf))
    assert.equal(dnf.minimal, false)
    assert.match(dnf.describe, /not necessarily the shortest/)

    const cnf = toConjunctiveNormalForm({ kind: 'xor', left: p, right: q })
    assert.ok(!isAlgebraError(cnf))
    assert.equal(cnf.minimal, false)
  })

  test('a contradiction has no disjunctive terms and a tautology has no conjunctive clauses', () => {
    const dnf = toDisjunctiveNormalForm({ kind: 'and', left: p, right: { kind: 'not', operand: p } })
    assert.ok(!isAlgebraError(dnf))
    assert.equal(dnf.text, 'false')

    const cnf = toConjunctiveNormalForm({ kind: 'or', left: p, right: { kind: 'not', operand: p } })
    assert.ok(!isAlgebraError(cnf))
    assert.equal(cnf.text, 'true')
  })
})

describe('the assumptions are stated', () => {
  test('the list names what the engine will and will not do', () => {
    assert.ok(ALGEBRA_ASSUMPTIONS.length >= 8)
    assert.ok(ALGEBRA_ASSUMPTIONS.some((one) => /Rationals are exact/.test(one)))
    assert.ok(ALGEBRA_ASSUMPTIONS.some((one) => /never as proven/.test(one)))
    assert.ok(ALGEBRA_ASSUMPTIONS.some((one) => /not convergence/.test(one)))
  })

  test('the limits are readable numbers rather than magic constants', () => {
    assert.ok(ALGEBRA_LIMITS.degree >= 256)
    assert.ok(ALGEBRA_LIMITS.setSize >= 10_000)
  })
})
