import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  agreeTo,
  ALWAYS_EXACT_FIGURES,
  combine,
  exact,
  isPrecisionError,
  MAXIMUM_FIGURES,
  measured,
  quantifyText,
  readMeasured,
  represent,
  ROUNDING_FACTS,
  ROUNDING_MODES,
  roundDecimals,
  roundSignificant,
  runChain,
  write,
  type Quantified,
  type PrecisionError
} from './precision.ts'

/**
 * Unwraps a result that may be an error.
 *
 * `Exclude` rather than a plain `T`: with a plain one, TypeScript solves `T | PrecisionError` by setting `T` to the whole
 * union, so every use site stays unnarrowed and the compiler stops checking field names on it.
 */
const ok = <T>(value: T): Exclude<T, PrecisionError> => {
  assert.ok(!isPrecisionError(value), isPrecisionError(value) ? value.message : '')
  return value as Exclude<T, PrecisionError>
}

describe('readMeasured', () => {
  it('counts digits after a decimal point, trailing zeros included', () => {
    const one = ok(readMeasured('12.30'))
    assert.equal(one.significantFigures, 4)
    assert.equal(one.decimalPlaces, 2)
    assert.equal(one.ambiguous, false)
    assert.match(one.why, /no reason to write them otherwise/)
  })

  it('does not count leading zeros, which only place the point', () => {
    assert.equal(ok(readMeasured('0.00420')).significantFigures, 3)
    assert.equal(ok(readMeasured('0.0001')).significantFigures, 1)
  })

  it('counts zeros between significant digits', () => {
    assert.equal(ok(readMeasured('1002')).significantFigures, 4)
    assert.equal(ok(readMeasured('10.02')).significantFigures, 4)
  })

  it('refuses to guess at trailing zeros with no decimal point, and shows both fixes', () => {
    const one = ok(readMeasured('1200'))
    assert.equal(one.ambiguous, true)
    assert.equal(one.significantFigures, null)
    assert.match(one.why, /between 2 and 4 significant figures/)
    assert.match(one.why, /1e3/)
    assert.match(one.why, /1\.000e3/)
  })

  it('treats a written decimal point as settling the ambiguity', () => {
    const one = ok(readMeasured('1200.'))
    assert.equal(one.ambiguous, false)
    assert.equal(one.significantFigures, 4)
  })

  it('reads scientific notation as stating the count exactly', () => {
    assert.equal(ok(readMeasured('1.20e3')).significantFigures, 3)
    assert.equal(ok(readMeasured('1.2e3')).significantFigures, 2)
    assert.equal(ok(readMeasured('1.200E-5')).significantFigures, 4)
    assert.match(ok(readMeasured('1.20e3')).why, /stated exactly/)
  })

  it('gives zero no significant figures whatever it was written to', () => {
    const one = ok(readMeasured('0.00'))
    assert.equal(one.significantFigures, 0)
    assert.equal(one.decimalPlaces, 2)
    assert.match(one.why, /zero has none/)
  })

  it('keeps the sign', () => {
    assert.equal(ok(readMeasured('-45.60')).value, -45.6)
    assert.equal(ok(readMeasured('-45.60')).significantFigures, 4)
  })

  it('refuses text that is not a number', () => {
    assert.ok(isPrecisionError(readMeasured('twelve')))
    assert.ok(isPrecisionError(readMeasured('')))
    assert.ok(isPrecisionError(readMeasured('1.2.3')))
  })
})

describe('roundDecimals', () => {
  it('rounds a value that the naive multiply gets wrong', () => {
    // 1.005 * 100 is 100.49999999999999 in binary, so multiplying then rounding gives 1.00 and claims it followed
    // the rule. Shifting the decimal string instead sees the half and rounds it.
    assert.equal(ok(roundDecimals(1.005, 2, 'half-up')), 1.01)
    assert.equal(ok(roundDecimals(2.675, 2, 'half-up')), 2.68)
  })

  it('sends halves to even by default', () => {
    assert.equal(ok(roundDecimals(0.5, 0)), 0)
    assert.equal(ok(roundDecimals(1.5, 0)), 2)
    assert.equal(ok(roundDecimals(2.5, 0)), 2)
    assert.equal(ok(roundDecimals(3.5, 0)), 4)
  })

  it('does not drift over a column of halves, where half-up does', () => {
    const halves = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5]
    const trueTotal = halves.reduce((a, b) => a + b, 0)
    const even = halves.map((one) => ok(roundDecimals(one, 0, 'half-even'))).reduce((a, b) => a + b, 0)
    const up = halves.map((one) => ok(roundDecimals(one, 0, 'half-up'))).reduce((a, b) => a + b, 0)
    assert.equal(even, trueTotal)
    assert.equal(up, trueTotal + 4)
  })

  it('handles negative halves by each mode own rule', () => {
    assert.equal(ok(roundDecimals(-2.5, 0, 'half-up')), -2)
    assert.equal(ok(roundDecimals(-2.5, 0, 'half-away-from-zero')), -3)
    assert.equal(ok(roundDecimals(-2.5, 0, 'half-even')), -2)
    assert.equal(ok(roundDecimals(-2.5, 0, 'floor')), -3)
    assert.equal(ok(roundDecimals(-2.5, 0, 'ceiling')), -2)
    assert.equal(ok(roundDecimals(-2.7, 0, 'toward-zero')), -2)
  })

  it('never returns negative zero', () => {
    assert.ok(!Object.is(ok(roundDecimals(-0.004, 2)), -0))
  })

  it('has facts for every mode it lists', () => {
    for (const mode of ROUNDING_MODES) {
      assert.ok(Object.prototype.hasOwnProperty.call(ROUNDING_FACTS, mode), mode)
      assert.ok(ROUNDING_FACTS[mode].describe.length > 20, mode)
    }
  })

  it('refuses an unknown mode and a silly number of places', () => {
    assert.ok(isPrecisionError(roundDecimals(1.2, 2, 'nearest' as never)))
    assert.ok(isPrecisionError(roundDecimals(1.2, -1)))
    assert.ok(isPrecisionError(roundDecimals(Number.NaN, 2)))
  })
})

describe('roundSignificant', () => {
  it('rounds to the left of the decimal point', () => {
    assert.equal(ok(roundSignificant(1234, 2)), 1200)
    assert.equal(ok(roundSignificant(1234, 1)), 1000)
    assert.equal(ok(roundSignificant(98765, 3)), 98800)
    assert.equal(ok(roundSignificant(-1234, 2)), -1200)
  })

  it('rounds to the right of it', () => {
    assert.equal(ok(roundSignificant(0.0012345, 3)), 0.00123)
    assert.equal(ok(roundSignificant(3.14159, 3)), 3.14)
  })

  it('handles a carry that moves the exponent', () => {
    // 9.99 to 2 figures is 10, and the naive version leaves it at 10.0 or gets the place count wrong.
    assert.equal(ok(roundSignificant(9.99, 2)), 10)
    assert.equal(ok(roundSignificant(0.0999, 2)), 0.1)
    assert.equal(ok(roundSignificant(999, 1)), 1000)
  })

  it('leaves zero alone', () => {
    assert.equal(ok(roundSignificant(0, 3)), 0)
  })

  it('refuses more figures than a double carries', () => {
    const result = roundSignificant(1.23, MAXIMUM_FIGURES + 1)
    assert.ok(isPrecisionError(result))
    assert.equal(result.error, 'too-many-figures')
    assert.match(result.message, /binary representation/)
  })

  it('refuses zero figures', () => {
    assert.ok(isPrecisionError(roundSignificant(1.23, 0)))
  })
})

describe('write', () => {
  it('writes plain notation to the stated figures', () => {
    assert.equal(ok(write(3.14159, 3)).text, '3.14')
    assert.equal(ok(write(3.14159, 5)).text, '3.1416')
    assert.equal(ok(write(2, 3)).text, '2.00')
  })

  it('says when plain notation cannot express the figure count', () => {
    const one = ok(write(1234, 2))
    assert.equal(one.value, 1200)
    assert.equal(one.text, '1200')
    assert.match(one.why, /Plain notation cannot say which/)
    assert.match(one.why, /1\.2e3/)
  })

  it('does not raise that warning when plain notation is unambiguous', () => {
    assert.ok(!/cannot say which/.test(ok(write(1234, 4)).why))
    assert.ok(!/cannot say which/.test(ok(write(3.14159, 3)).why))
  })

  it('writes scientific notation with the figures in the mantissa', () => {
    const one = ok(write(1234, 2, 'scientific'))
    assert.equal(one.text, '1.2e3')
    assert.equal(one.exponent, 3)
    const two = ok(write(0.000123456, 4, 'scientific'))
    assert.equal(two.text, '1.235e-4')
    assert.equal(two.exponent, -4)
  })

  it('writes engineering notation at an exponent that is a multiple of three', () => {
    const one = ok(write(12345, 3, 'engineering'))
    assert.equal(one.exponent, 3)
    assert.equal(one.text, '12.3e3')
    assert.equal(one.prefix?.symbol, 'k')
    const two = ok(write(0.000012345, 3, 'engineering'))
    assert.equal(two.exponent, -6)
    assert.equal(two.prefix?.name, 'micro')
  })

  it('matches SI prefixes from the unit engine own table', () => {
    assert.equal(ok(write(1.5e9, 2, 'engineering')).prefix?.symbol, 'G')
    assert.equal(ok(write(1.5e-9, 2, 'engineering')).prefix?.symbol, 'n')
    assert.equal(ok(write(1.5e12, 2, 'engineering')).prefix?.symbol, 'T')
  })

  it('handles an exponent with no SI prefix', () => {
    const one = ok(write(1.5e45, 2, 'engineering'))
    assert.equal(one.prefix, null)
    assert.match(one.why, /no SI prefix/)
  })

  it('writes zero to the precision asked for', () => {
    assert.equal(ok(write(0, 3)).text, '0.00')
    assert.match(ok(write(0, 3)).why, /no significant figures of its own/)
  })

  it('refuses a bad notation or figure count', () => {
    assert.ok(isPrecisionError(write(1.2, 3, 'roman' as never)))
    assert.ok(isPrecisionError(write(1.2, 0)))
    assert.ok(isPrecisionError(write(Number.POSITIVE_INFINITY, 3)))
  })
})

describe('quantifyText', () => {
  it('carries what the notation stated', () => {
    const one = ok(quantifyText('12.30'))
    assert.equal(one.significantFigures, 4)
    assert.equal(one.decimalPlaces, 2)
    assert.equal(one.exact, false)
  })

  it('refuses an ambiguous written number rather than picking a reading', () => {
    const result = quantifyText('1200')
    assert.ok(isPrecisionError(result))
    assert.equal(result.error, 'ambiguous')
  })
})

describe('combine', () => {
  const m = (value: number, figures: number, places?: number): Quantified => ok(measured(value, figures, places))

  it('keeps decimal places when adding, not significant figures', () => {
    // 1.2 + 3.45 = 4.65. The figures rule would give 4.7 (2 figures); the places rule gives 4.7 too here — so use a
    // case where they differ: 100.1 + 0.25 = 100.35. Places rule keeps 1 place -> 100.4 (4 figures, not 2).
    const one = ok(combine(m(100.1, 4, 1), m(0.25, 2, 2), 'add'))
    assert.equal(one.rounded, 100.4)
    assert.equal(one.decimalPlaces, 1)
    assert.equal(one.significantFigures, 4)
    assert.match(one.why, /keeps decimal places, not significant figures/)
  })

  it('keeps significant figures when multiplying, not decimal places', () => {
    const one = ok(combine(m(1.2, 2), m(3.45, 3), 'multiply'))
    assert.equal(one.significantFigures, 2)
    assert.equal(one.rounded, 4.1)
    assert.equal(Number(one.value.toPrecision(6)), 4.14)
    assert.match(one.why, /keeps significant figures, not decimal places/)
  })

  it('applies the two rules to the same numbers and gets different answers', () => {
    const a = m(100.1, 4, 1)
    const b = m(0.25, 2, 2)
    const sum = ok(combine(a, b, 'add'))
    const product = ok(combine(a, b, 'multiply'))
    assert.equal(sum.significantFigures, 4)
    assert.equal(product.significantFigures, 2)
  })

  it('divides by significant figures', () => {
    const one = ok(combine(m(10.0, 3), m(3.0, 2), 'divide'))
    assert.equal(one.significantFigures, 2)
    assert.equal(one.rounded, 3.3)
  })

  it('lets an exact number impose no limit at all', () => {
    const one = ok(combine(m(3.14159, 6), exact(2), 'multiply'))
    assert.equal(one.significantFigures, 6)
    assert.equal(one.rounded, 6.28318)
    assert.ok(one.caveats.some((c) => /places no limit on the precision/.test(c)))
  })

  it('keeps a result exact when both inputs are', () => {
    const one = ok(combine(exact(12), exact(5), 'multiply'))
    assert.equal(one.value, 60)
    assert.equal(one.significantFigures, null)
    assert.match(one.why, /no rounding applies/)
  })

  it('warns that subtracting close numbers destroys figures', () => {
    const one = ok(combine(m(1.00000, 6, 5), m(0.99999, 5, 5), 'subtract'))
    assert.ok(one.caveats.some((c) => /destroy precision rather than merely limit it/.test(c)))
    assert.ok(one.caveats.some((c) => /the figures that cancelled are gone/.test(c)))
  })

  it('does not raise that warning for an ordinary subtraction', () => {
    const one = ok(combine(m(10.5, 3, 1), m(2.1, 2, 1), 'subtract'))
    assert.equal(one.caveats.length, 0)
    assert.equal(one.rounded, 8.4)
  })

  it('warns that a measured exponent is beyond what a figure count can carry', () => {
    const one = ok(combine(m(2.0, 2), m(3.0, 2), 'power'))
    assert.ok(one.caveats.some((c) => /uncertainty in the exponent/.test(c)))
  })

  it('does not raise that warning for an exact exponent', () => {
    const one = ok(combine(m(2.0, 2), exact(3), 'power'))
    assert.ok(!one.caveats.some((c) => /uncertainty in the exponent/.test(c)))
    assert.equal(one.rounded, 8)
  })

  it('refuses division by zero and non-finite input', () => {
    assert.ok(isPrecisionError(combine(m(1, 2), exact(0), 'divide')))
    assert.ok(isPrecisionError(combine(m(1, 2), { value: Number.NaN, significantFigures: null, decimalPlaces: null, exact: true }, 'add')))
    assert.ok(isPrecisionError(combine(m(1, 2), m(2, 2), 'modulo' as never)))
  })
})

describe('runChain', () => {
  const m = (value: number, figures: number, places?: number): Quantified => ok(measured(value, figures, places))

  it('rounds once at the end rather than at every step', () => {
    // 10 ÷ 3 × 3 is 10 exactly when nothing is rounded in between. Rounding the intermediate to 3.3 gives 9.9 —
    // a whole percent wrong, from throwing away digits that were never in doubt.
    const result = ok(runChain(m(10, 2), [{ operation: 'divide', operand: m(3.0, 2) }, { operation: 'multiply', operand: m(3.0, 2) }]))
    assert.equal(Number(result.value.toPrecision(12)), 10)
    assert.equal(result.rounded, 10)
    assert.equal(result.ifRoundedEachStep, 9.9)
    assert.match(result.why, /digits thrown away in the working that were never wrong/)
  })

  it('shows what each step would have rounded to, without having rounded it', () => {
    const result = ok(runChain(m(10, 2), [{ operation: 'divide', operand: m(3.0, 2) }, { operation: 'multiply', operand: m(3.0, 2) }]))
    assert.equal(result.steps.length, 2)
    assert.equal(result.steps[0]?.wouldRoundTo, 3.3)
    // The value carried forward is the unrounded one, which is the whole point.
    assert.equal(Number((result.steps[0]?.value as number).toPrecision(6)), 3.33333)
  })

  it('says plainly when the two strategies happen to agree', () => {
    const result = ok(runChain(m(2.0, 2), [{ operation: 'add', operand: m(3.0, 2, 1) }]))
    assert.match(result.why, /happens to give the same answer/)
  })

  it('records the operation and value of each step', () => {
    const result = ok(runChain(m(6.0, 2), [{ operation: 'add', operand: m(1.0, 2, 1) }, { operation: 'multiply', operand: m(2.0, 2) }]))
    assert.equal(result.steps[0]?.operation, 'add')
    assert.equal(result.steps[0]?.value, 7)
    assert.equal(result.steps[1]?.operation, 'multiply')
    assert.equal(result.steps[1]?.value, 14)
  })

  it('collects the caveats raised along the way, without repeating them', () => {
    const result = ok(
      runChain(m(1.00000, 6, 5), [
        { operation: 'subtract', operand: m(0.99999, 5, 5) },
        { operation: 'multiply', operand: exact(2) }
      ])
    )
    assert.ok(result.caveats.some((c) => /destroy precision/.test(c)))
    assert.equal(new Set(result.caveats).size, result.caveats.length)
  })

  it('refuses an empty chain', () => {
    assert.ok(isPrecisionError(runChain(m(1, 2), [])))
  })
})

describe('represent', () => {
  it('knows 0.5 is exact and 0.1 is not', () => {
    assert.equal(ok(represent(0.5)).exactInBinary, true)
    assert.equal(ok(represent(0.25)).exactInBinary, true)
    assert.equal(ok(represent(0.1)).exactInBinary, false)
    assert.equal(ok(represent(0.3)).exactInBinary, false)
  })

  it('treats a whole number as exact', () => {
    assert.equal(ok(represent(42)).exactInBinary, true)
    assert.equal(ok(represent(-1000)).exactInBinary, true)
    assert.equal(ok(represent(0)).exactInBinary, true)
  })

  it('shows what is actually stored for a value that has no exact double', () => {
    const one = ok(represent(0.1))
    assert.match(one.why, /not a sum of halves/)
    assert.match(one.actual, /^0\.100000000000000/)
  })

  it('explains the classic sum that ends in nines', () => {
    const sum = 0.1 + 0.2
    assert.notEqual(sum, 0.3)
    const one = ok(represent(sum))
    assert.equal(one.exactInBinary, false)
    // And the precision engine's own rounding gives the answer a person expects.
    assert.equal(ok(roundSignificant(sum, ALWAYS_EXACT_FIGURES)), 0.3)
  })

  it('reports a gap to the next double that grows with magnitude', () => {
    const small = ok(represent(1))
    const large = ok(represent(1e15))
    assert.ok(large.unitInLastPlace > small.unitInLastPlace)
  })

  it('refuses a non-finite value', () => {
    assert.ok(isPrecisionError(represent(Number.NaN)))
  })
})

describe('agreeTo', () => {
  it('finds agreement at a precision both values reach', () => {
    const one = ok(agreeTo(3.14159, 3.14162, 5))
    assert.equal(one.agree, true)
    assert.match(one.why, /not about the ones below them/)
  })

  it('finds disagreement inside the precision claimed', () => {
    const one = ok(agreeTo(3.14159, 3.14992, 5))
    assert.equal(one.agree, false)
    assert.equal(one.roundedA, 3.1416)
    assert.equal(one.roundedB, 3.1499)
  })

  it('compares values that differ as doubles but agree as measurements', () => {
    assert.equal(ok(agreeTo(0.1 + 0.2, 0.3, 12)).agree, true)
    assert.notEqual(0.1 + 0.2, 0.3)
  })

  it('refuses a non-finite value or a silly precision', () => {
    assert.ok(isPrecisionError(agreeTo(1, Number.NaN, 3)))
    assert.ok(isPrecisionError(agreeTo(1, 2, 0)))
  })
})
