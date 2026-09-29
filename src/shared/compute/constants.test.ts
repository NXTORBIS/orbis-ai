import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  asQuantity,
  compareToConstant,
  CONSTANT_KINDS,
  CONSTANTS,
  constantById,
  constantsInCategory,
  constantsOfKind,
  isConstantError,
  KIND_FACTS,
  reportOn,
  searchConstants,
  type ConstantError
} from './constants.ts'
import { isQuantityError, parseUnit } from './units.ts'

/**
 * Unwraps a result that may be an error.
 *
 * `Exclude` rather than a plain `T`: with a plain one, TypeScript solves `T | ConstantError` by setting `T` to the whole
 * union, so every use site stays unnarrowed and the compiler stops checking field names on it.
 */
const ok = <T>(value: T): Exclude<T, ConstantError> => {
  assert.ok(!isConstantError(value), isConstantError(value) ? value.message : '')
  return value as Exclude<T, ConstantError>
}

describe('the registry itself', () => {
  it('gives every constant a unique id', () => {
    const ids = CONSTANTS.map((one) => one.id)
    assert.equal(new Set(ids).size, ids.length)
  })

  it('gives every constant a finite value and a real description', () => {
    for (const one of CONSTANTS) {
      assert.ok(Number.isFinite(one.value), one.id)
      assert.ok(one.describe.length > 30, one.id)
      assert.ok(one.source.length > 0, one.id)
      assert.ok(one.publishedText.length > 0, one.id)
      assert.ok(CONSTANT_KINDS.includes(one.kind), one.id)
    }
  })

  it('uses a unit the unit engine can parse, for every constant that has one', () => {
    for (const one of CONSTANTS) {
      if (one.unit === '') continue
      const parsed = parseUnit(one.unit)
      assert.ok(!isQuantityError(parsed) && !('error' in parsed), `${one.id} has unit "${one.unit}" which does not parse`)
    }
  })

  it('gives zero uncertainty to everything that is not a measurement', () => {
    for (const one of CONSTANTS) {
      if (KIND_FACTS[one.kind].hasUncertainty) continue
      assert.equal(one.uncertainty, 0, `${one.id} is ${one.kind} and should have no uncertainty`)
      assert.equal(one.relativeUncertainty, 0, one.id)
    }
  })

  it('gives a real uncertainty to everything that is a measurement', () => {
    const measured = constantsOfKind('measured')
    assert.ok(measured.length >= 10)
    for (const one of measured) {
      assert.ok(one.uncertainty > 0, `${one.id} is measured and must state an uncertainty`)
      assert.ok(one.relativeUncertainty > 0, one.id)
    }
  })

  it('keeps each stated relative uncertainty consistent with its absolute one', () => {
    // A typo in either number would show up here and nowhere else.
    for (const one of constantsOfKind('measured')) {
      const derived = one.uncertainty / Math.abs(one.value)
      const ratio = derived / one.relativeUncertainty
      assert.ok(ratio > 0.85 && ratio < 1.15, `${one.id}: stated ${one.relativeUncertainty}, implied ${derived.toExponential(2)}`)
    }
  })

  it('holds the SI defining constants at exactly their defined values', () => {
    assert.equal(ok(constantById('speed-of-light')).value, 299792458)
    assert.equal(ok(constantById('planck')).value, 6.62607015e-34)
    assert.equal(ok(constantById('elementary-charge')).value, 1.602176634e-19)
    assert.equal(ok(constantById('boltzmann')).value, 1.380649e-23)
    assert.equal(ok(constantById('avogadro')).value, 6.02214076e23)
    assert.equal(ok(constantById('caesium-frequency')).value, 9192631770)
    assert.equal(ok(constantById('luminous-efficacy')).value, 683)
  })

  it('has exactly seven defining constants, which is how many the SI has', () => {
    assert.equal(constantsOfKind('defining').length, 7)
  })

  it('derives the exact ones from the defining ones and lands on the published value', () => {
    const h = ok(constantById('planck')).value
    const k = ok(constantById('boltzmann')).value
    const e = ok(constantById('elementary-charge')).value
    const avogadro = ok(constantById('avogadro')).value
    const c = ok(constantById('speed-of-light')).value

    assert.equal(ok(constantById('reduced-planck')).value, h / (2 * Math.PI))
    // R = N_A k, to the last digit a double holds.
    assert.equal(Number((avogadro * k).toPrecision(15)), Number(ok(constantById('gas-constant')).value.toPrecision(15)))
    assert.equal(Number((avogadro * e).toPrecision(15)), Number(ok(constantById('faraday')).value.toPrecision(15)))
    const sigma = (2 * Math.PI ** 5 * k ** 4) / (15 * h ** 3 * c ** 2)
    assert.equal(Number(sigma.toPrecision(9)), Number(ok(constantById('stefan-boltzmann')).value.toPrecision(9)))
  })

  it('agrees with the relationships between the measured constants', () => {
    // These are not independent numbers, and a mistake in any one of them breaks a relationship here.
    const alpha = ok(constantById('fine-structure')).value
    const e = ok(constantById('elementary-charge')).value
    const h = ok(constantById('planck')).value
    const c = ok(constantById('speed-of-light')).value
    const epsilon = ok(constantById('vacuum-permittivity')).value
    // α = e² / (2 ε₀ h c)
    const derived = e ** 2 / (2 * epsilon * h * c)
    assert.ok(Math.abs(derived / alpha - 1) < 1e-9, `α from ε₀ is ${derived}, registry says ${alpha}`)

    const mu = ok(constantById('vacuum-permeability')).value
    // ε₀ μ₀ c² = 1
    assert.ok(Math.abs(epsilon * mu * c * c - 1) < 1e-9)

    const rydberg = ok(constantById('rydberg')).value
    const electron = ok(constantById('electron-mass')).value
    const bohr = ok(constantById('bohr-radius')).value
    // a₀ = α / (4π R∞)
    const derivedBohr = alpha / (4 * Math.PI * rydberg)
    assert.ok(Math.abs(derivedBohr / bohr - 1) < 1e-8, `a₀ derived ${derivedBohr}, registry ${bohr}`)
    // R∞ = m_e c α² / (2h)
    const derivedRydberg = (electron * c * alpha ** 2) / (2 * h)
    assert.ok(Math.abs(derivedRydberg / rydberg - 1) < 1e-8)
  })

  it('knows the gravitational constant is the worst known of them', () => {
    const g = ok(constantById('gravitational'))
    for (const one of constantsOfKind('measured')) {
      if (one.id === 'gravitational') continue
      assert.ok(g.relativeUncertainty > one.relativeUncertainty, `${one.id} is stated as less certain than G`)
    }
  })

  it('has facts for every kind it lists', () => {
    for (const kind of CONSTANT_KINDS) {
      assert.ok(Object.prototype.hasOwnProperty.call(KIND_FACTS, kind), kind)
      assert.ok(KIND_FACTS[kind].describe.length > 40, kind)
    }
  })

  it('freezes each entry so a Page cannot edit a constant', () => {
    const one = CONSTANTS[0]
    assert.ok(one !== undefined)
    assert.throws(() => {
      ;(one as { value: number }).value = 1
    })
  })
})

describe('constantById', () => {
  it('finds a constant', () => {
    assert.equal(ok(constantById('pi')).symbol, 'π')
  })

  it('refuses an unknown id without reaching a prototype property', () => {
    for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'nope']) {
      const result = constantById(id)
      assert.ok(isConstantError(result), id)
      assert.equal(result.error, 'unknown-constant')
    }
  })
})

describe('searchConstants', () => {
  it('finds by symbol, name and description', () => {
    assert.equal(searchConstants('c')[0]?.id, 'speed-of-light')
    assert.equal(searchConstants('Planck constant')[0]?.id, 'planck')
    assert.ok(searchConstants('gravitation').some((one) => one.id === 'gravitational'))
  })

  it('ranks an exact symbol match above a description mention', () => {
    const found = searchConstants('G')
    assert.equal(found[0]?.id, 'gravitational')
  })

  it('returns everything for an empty search', () => {
    assert.equal(searchConstants('').length, CONSTANTS.length)
  })

  it('returns nothing for a word that appears nowhere', () => {
    assert.equal(searchConstants('zzzzq').length, 0)
  })
})

describe('asQuantity', () => {
  it('turns a constant into a quantity the unit engine understands', () => {
    const q = ok(asQuantity(ok(constantById('speed-of-light'))))
    assert.equal(q.value, 299792458)
  })

  it('refuses a dimensionless constant, and says why that is not a failure', () => {
    const result = asQuantity(ok(constantById('fine-structure')))
    assert.ok(isConstantError(result))
    assert.equal(result.error, 'no-unit')
    assert.match(result.message, /same number in every system of units/)
  })
})

describe('reportOn', () => {
  it('says what a measured constant limits a result to', () => {
    const report = ok(reportOn('gravitational'))
    assert.equal(report.limitsResultsTo, 2.2e-5)
    assert.ok(report.caveats.some((c) => /cannot be quoted to more than about 4 significant figures/.test(c)))
  })

  it('says a defining constant contributes no uncertainty at all', () => {
    const report = ok(reportOn('speed-of-light'))
    assert.equal(report.limitsResultsTo, null)
    assert.ok(report.caveats.some((c) => /came from somewhere else/.test(c)))
    assert.ok(report.caveats.some((c) => /it is where a unit comes from/.test(c)))
  })

  it('warns that the Faraday constant is published with more digits than it hands out', () => {
    const report = ok(reportOn('faraday'))
    assert.equal(report.truncated, true)
    assert.ok(report.caveats.some((c) => /96485\.3321233100184/.test(c)))
  })

  it('does not claim truncation for a constant that fits', () => {
    assert.equal(ok(reportOn('speed-of-light')).truncated, false)
    assert.equal(ok(reportOn('boltzmann')).truncated, false)
  })

  it('warns that standard gravity is not the gravity anywhere', () => {
    const report = ok(reportOn('standard-gravity'))
    assert.ok(report.caveats.some((c) => /no uncertainty figure will catch/.test(c)))
  })

  it('warns that an irrational constant has no exact double', () => {
    assert.ok(ok(reportOn('pi')).caveats.some((c) => /no exact double/.test(c)))
  })

  it('refuses an unknown constant', () => {
    assert.ok(isConstantError(reportOn('nope')))
  })
})

describe('compareToConstant', () => {
  it('calls a measurement within two sigma consistent, without calling it confirmation', () => {
    const g = ok(constantById('gravitational'))
    const result = ok(compareToConstant('gravitational', g.value + g.uncertainty, g.uncertainty))
    assert.equal(result.agree, true)
    assert.ok((result.sigma as number) < 2)
    assert.match(result.why, /not that it confirms it/)
  })

  it('calls a distant measurement inconsistent, without calling it disproof', () => {
    const g = ok(constantById('gravitational'))
    const result = ok(compareToConstant('gravitational', g.value + 10 * g.uncertainty, g.uncertainty))
    assert.equal(result.agree, false)
    assert.ok((result.sigma as number) > 5)
    assert.match(result.why, /not, on its own, evidence against the accepted value/)
  })

  it('combines both uncertainties rather than using only the measurement', () => {
    const g = ok(constantById('gravitational'))
    const offset = 2 * g.uncertainty
    // With an equal uncertainty of its own, the combined figure is √2 times either, so 2u is only ~1.41σ away.
    const result = ok(compareToConstant('gravitational', g.value + offset, g.uncertainty))
    assert.ok(Math.abs((result.sigma as number) - Math.SQRT2) < 0.01)
  })

  it('says there is no scale to judge by when neither side states an uncertainty', () => {
    const result = ok(compareToConstant('speed-of-light', 299792460))
    assert.equal(result.agree, false)
    assert.equal(result.sigma, null)
    assert.match(result.why, /exact by definition, so any difference is in the measurement/)
  })

  it('accepts an exact match against an exact constant', () => {
    const result = ok(compareToConstant('speed-of-light', 299792458))
    assert.equal(result.agree, true)
    assert.equal(result.difference, 0)
  })

  it('refuses a negative uncertainty and a non-finite value', () => {
    assert.ok(isConstantError(compareToConstant('planck', 1, -1)))
    assert.ok(isConstantError(compareToConstant('planck', Number.NaN)))
    assert.ok(isConstantError(compareToConstant('nope', 1)))
  })
})

describe('grouping', () => {
  it('puts every constant in exactly one kind bucket', () => {
    let total = 0
    for (const kind of CONSTANT_KINDS) total += constantsOfKind(kind).length
    assert.equal(total, CONSTANTS.length)
  })

  it('finds constants by category', () => {
    assert.ok(constantsInCategory('mathematical').every((one) => one.kind === 'mathematical'))
    assert.ok(constantsInCategory('electromagnetic').some((one) => one.id === 'elementary-charge'))
  })
})
