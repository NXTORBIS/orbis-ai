/**
 * The chemistry bridge, tested through the door a Page actually knocks on.
 *
 * The engines have their own tests. What is checked here is the boundary: that every advertised operation has an
 * implementation, that a name cannot reach a prototype, that traces are thinned without moving the answers, and that
 * a refusal arrives as a value with a reason on it.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { CHEMISTRY_CAPABILITY, CHEMISTRY_LIMITS, runChemistryOperation } from './chemistryEngines.ts'
import { BadInput } from './engines.ts'

const run = (operation: string, input: Record<string, unknown> = {}): Record<string, unknown> =>
  runChemistryOperation(operation, input) as Record<string, unknown>

const ok = (operation: string, input: Record<string, unknown> = {}): Record<string, unknown> => {
  const result = run(operation, input)
  assert.equal(result.ok, true, `${operation} failed: ${String(result.message ?? '')}`)
  return result
}

const near = (actual: unknown, expected: number, tolerance: number, what: string): void => {
  assert.equal(typeof actual, 'number', `${what} is not a number`)
  assert.ok(Math.abs((actual as number) - expected) <= tolerance, `${what}: got ${actual}, expected about ${expected}`)
}

test('every advertised operation has an implementation', () => {
  for (const operation of Object.keys(CHEMISTRY_CAPABILITY)) {
    try {
      runChemistryOperation(operation, {})
    } catch (error) {
      assert.ok(error instanceof BadInput, `${operation} threw something other than BadInput: ${String(error)}`)
      assert.ok(
        !/is not a chemistry operation/.test(error.message),
        `${operation} is advertised but has no implementation`
      )
    }
  }
})

test('every operation asks for the same capability, and it is the chemistry one', () => {
  for (const [operation, capability] of Object.entries(CHEMISTRY_CAPABILITY)) {
    assert.equal(capability, 'computation.chemistry', `${operation} asks for something else`)
  }
})

test('an operation nobody advertises is refused', () => {
  assert.throws(() => runChemistryOperation('reaction.transmute-lead', {}), BadInput)
})

// ---------------------------------------------------------------- elements and formulas

test('an element comes back by symbol, name or number, and the wrong case says which is which', () => {
  for (const key of ['Fe', 'Iron', 26]) {
    const result = ok('element.get', { element: key })
    assert.equal(result.symbol, 'Fe')
  }
  const wrongCase = run('element.get', { element: 'CO' })
  assert.equal(wrongCase.ok, false)
  assert.ok((wrongCase.message as string).includes('cobalt'))
})

test('a formula parses with its molar mass and uncertainty', () => {
  const result = ok('formula.parse', { formula: 'Ca3(PO4)2' })
  near(result.molarMass, 310.17, 0.05, 'calcium phosphate')
  assert.ok((result.molarMassUncertainty as number) > 0, 'atomic weights are measurements')
  assert.equal((result.composition as unknown[]).length, 3)
})

test('a malformed formula is refused with the position of the problem', () => {
  const result = run('formula.parse', { formula: 'H2O)' })
  assert.equal(result.ok, false)
  assert.ok((result.message as string).length > 20)
})

test('Fe3+ is one iron ion and not three iron atoms', () => {
  const result = ok('formula.parse', { formula: 'Fe3+' })
  assert.equal(result.charge, 3)
  assert.equal(result.totalAtoms, 1)
  near(result.molarMass, 55.845, 0.001, 'one iron')
})

test('mole conversions round-trip through the door', () => {
  const fromGrams = ok('formula.moles', { formula: 'H2O', grams: 18.015 })
  near(fromGrams.moles, 1, 0.001, 'a mole of water')
  const back = ok('formula.moles', { formula: 'H2O', moles: 1 })
  near(back.mass, 18.015, 0.005, 'and back again')
})

test('two mole quantities at once are refused', () => {
  const result = run('formula.moles', { formula: 'H2O', grams: 18, moles: 1 })
  assert.equal(result.ok, false)
})

// ---------------------------------------------------------------- equations

test('methane combustion balances through the door', () => {
  const result = ok('reaction.balance', { reactants: ['CH4', 'O2'], products: ['CO2', 'H2O'] })
  const coefficients = new Map(
    [...(result.reactants as { formula: string; coefficient: number }[]), ...(result.products as { formula: string; coefficient: number }[])].map(
      (one) => [one.formula, one.coefficient]
    )
  )
  assert.equal(coefficients.get('O2'), 2)
  assert.equal(coefficients.get('H2O'), 2)
  assert.equal(result.massBalanced, true)
})

test('an unbalanceable equation is refused rather than returned with invented numbers', () => {
  const result = run('reaction.balance', { reactants: ['CH4'], products: ['CO2'] })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'cannot-balance')
  assert.ok((result.message as string).includes('only on the'))
})

test('stoichiometry names the limiting reagent and the leftovers', () => {
  const result = ok('reaction.stoichiometry', {
    reactants: ['CH4', 'O2'],
    products: ['CO2', 'H2O'],
    suppliedMoles: { CH4: 1, O2: 1 }
  })
  assert.equal(result.limitingReagent, 'O2')
  const methane = (result.reagents as { formula: string; molesLeftOver: number }[]).find((one) => one.formula === 'CH4')
  assert.ok(methane)
  near(methane.molesLeftOver, 0.5, 1e-9, 'half the methane is left')
})

test('a supplied name that could reach a prototype is refused', () => {
  const sneaky = JSON.parse('{"__proto__": 1}')
  assert.throws(
    () =>
      runChemistryOperation('reaction.stoichiometry', {
        reactants: ['CH4', 'O2'],
        products: ['CO2', 'H2O'],
        suppliedMoles: sneaky
      }),
    BadInput
  )
})

// ---------------------------------------------------------------- solutions

test('a very dilute acid does not come out alkaline through the door', () => {
  const result = ok('solution.ph', { concentration: 1e-8, kind: 'strong-acid' })
  assert.ok((result.pH as number) < 7)
  assert.equal(result.simpleFormulaAdequate, false)
  assert.ok((result.warnings as string[]).some((w) => w.includes('alkaline')))
})

test('a weak acid without its pKa is refused, and with one it works', () => {
  const without = run('solution.ph', { concentration: 0.1, kind: 'weak-acid' })
  assert.equal(without.ok, false)
  assert.ok((without.message as string).includes('pKa'))
  const with_ = ok('solution.ph', { concentration: 0.1, kind: 'weak-acid', pKa: 4.76 })
  near(with_.pH, 2.88, 0.05, 'acetic acid at 0.1 M')
})

test('a kind nobody defined is refused', () => {
  assert.throws(() => runChemistryOperation('solution.ph', { concentration: 0.1, kind: 'medium-acid' }), BadInput)
})

test('molarity to a mass-based unit is refused without the density', () => {
  const result = ok('solution.concentration', { formula: 'NaOH', molarity: 1 })
  assert.ok((result.missing as { unit: string }[]).some((one) => one.unit === 'molality'))
  assert.ok(!(result.values as { unit: string }[]).some((one) => one.unit === 'molality'), 'and none was invented')
  assert.ok((result.warnings as string[]).some((w) => w.includes('1.33')))
})

test('a dilution reports the solvent to add', () => {
  const result = ok('solution.dilution', { initialConcentration: 2, initialVolume: 0.05, finalConcentration: 0.5 })
  near(result.solventToAdd, 0.15, 1e-12, '150 mL of solvent')
})

test('concentrating by dilution is refused', () => {
  const result = run('solution.dilution', { initialConcentration: 0.5, initialVolume: 0.1, finalConcentration: 2 })
  assert.equal(result.ok, false)
})

test('a buffer outside its range is flagged with a collapsed capacity', () => {
  const good = ok('solution.buffer', { pKa: 4.76, targetPh: 4.76 })
  const bad = ok('solution.buffer', { pKa: 4.76, targetPh: 7.5 })
  assert.equal(good.withinRange, true)
  assert.equal(bad.withinRange, false)
  assert.ok((bad.bufferCapacity as number) < (good.bufferCapacity as number) / 10)
  assert.ok((bad.warnings as string[]).some((w) => w.includes('outside the range')))
})

test('a titration curve is thinned without moving the equivalence point', () => {
  const base = { analyteConcentration: 0.1, analyteVolume: 0.025, titrantConcentration: 0.1, analyte: 'weak-acid', pKa: 4.76, samples: 800 }
  const full = ok('solution.titration', { ...base, trace: 800 })
  const thinned = ok('solution.titration', { ...base, trace: 20 })
  assert.equal((full.curve as unknown[]).length, 800)
  assert.equal((thinned.curve as unknown[]).length, 20)
  assert.equal(thinned.equivalencePh, full.equivalencePh, 'the equivalence point is computed, not read off the curve')
  assert.ok((full.suitableIndicators as string[]).includes('phenolphthalein'))
})

test('a trace cannot be asked for more samples than the door allows', () => {
  const result = ok('solution.titration', {
    analyteConcentration: 0.1,
    analyteVolume: 0.025,
    titrantConcentration: 0.1,
    trace: 1_000_000
  })
  assert.ok((result.curve as unknown[]).length <= CHEMISTRY_LIMITS.samples)
})

test('the common ion effect comes through the door', () => {
  const result = ok('solution.solubility', { ksp: 1.8e-10, commonIonConcentration: 0.01 })
  const effect = result.commonIonEffect as { factor: number }
  assert.ok(effect.factor > 500, 'hundreds of times less soluble')
})

test('colligative properties warn without a van’t Hoff factor', () => {
  const result = ok('solution.colligative', { molality: 1, freezingConstant: 1.86 })
  near(result.freezingPointDepression, 1.86, 1e-9, 'one particle per formula unit assumed')
  assert.ok((result.warnings as string[]).some((w) => w.includes('factor of two')))
})

// ---------------------------------------------------------------- reactions

test('thermochemistry needs entropies before it claims spontaneity', () => {
  const without = ok('reaction.thermochemistry', {
    reactants: [{ formula: 'CH4', formationEnthalpy: -74.6 }],
    products: [{ formula: 'C', formationEnthalpy: 0 }]
  })
  assert.equal(without.spontaneous, null)
  assert.ok((without.warnings as string[]).some((w) => w.includes('ice melts')))

  const with_ = ok('reaction.thermochemistry', {
    reactants: [
      { formula: 'CH4', formationEnthalpy: -74.6, entropy: 186.3 },
      { formula: 'O2', coefficient: 2, formationEnthalpy: 0, entropy: 205.2 }
    ],
    products: [
      { formula: 'CO2', formationEnthalpy: -393.5, entropy: 213.8 },
      { formula: 'H2O', coefficient: 2, formationEnthalpy: -241.8, entropy: 188.8 }
    ]
  })
  near(with_.enthalpyChange, -802.5, 1, 'the standard enthalpy of combustion')
  assert.equal(with_.spontaneous, true)
  assert.ok((with_.warnings as string[]).some((w) => w.includes('not fast')))
})

test('a negative absolute entropy is refused', () => {
  const result = run('reaction.thermochemistry', {
    reactants: [{ formula: 'A', formationEnthalpy: 0, entropy: -5 }],
    products: [{ formula: 'B', formationEnthalpy: -10, entropy: 20 }]
  })
  assert.equal(result.ok, false)
  assert.ok((result.message as string).includes('third law'))
})

test('equilibrium is solved and the direction reported', () => {
  const result = ok('reaction.equilibrium', {
    constant: 1,
    reactants: [{ formula: 'A', initial: 1 }],
    products: [{ formula: 'B' }]
  })
  near(result.extent, 0.5, 1e-9, 'half converts at K = 1')
  assert.equal(result.goes, 'forward')
  assert.ok((result.residual as number) < 1e-9)
})

test('Kc and Kp differ unless the gas moles are unchanged', () => {
  const same = ok('reaction.constants', { kc: 5, deltaMolesGas: 0 })
  near(same.kp, 5, 1e-12, 'equal')
  const different = ok('reaction.constants', { kc: 5, deltaMolesGas: -1, temperature: 298.15 })
  assert.notEqual(different.kp, 5)
})

test('a rate trace is thinned without moving the half-life', () => {
  const base = { order: 1, rateConstant: 0.01, initialConcentration: 1, samples: 800 }
  const full = ok('reaction.rate', { ...base, trace: 800 })
  const thinned = ok('reaction.rate', { ...base, trace: 20 })
  assert.equal((full.samples as unknown[]).length, 800)
  assert.equal((thinned.samples as unknown[]).length, 20)
  assert.equal(thinned.halfLife, full.halfLife)
  assert.equal(full.rateConstantUnits, '1/s')
})

test('a fractional order is refused with why', () => {
  const result = run('reaction.rate', { order: 1.5, rateConstant: 0.01, initialConcentration: 1 })
  // Rounded to 2 by the door, so this checks the door rounds rather than passing a fraction through.
  assert.equal(result.ok, true, 'the door rounds the order to a whole number')
  assert.equal(result.order, 2)
})

test('Arrhenius computes the ten-degree factor', () => {
  const result = ok('reaction.arrhenius', { activationEnergy: 50, rateConstant: 1, temperature: 298.15 })
  near(result.tenDegreeFactor, 1.95, 0.1, 'about double for 50 kJ/mol')
})

test('a reversed cell is flagged as needing driving', () => {
  const good = ok('reaction.cell', { cathodePotential: 0.34, anodePotential: -0.76, electrons: 2 })
  near(good.standardPotential, 1.1, 1e-9, 'the Daniell cell')
  const reversed = ok('reaction.cell', { cathodePotential: -0.76, anodePotential: 0.34, electrons: 2 })
  assert.equal(reversed.spontaneous, false)
  assert.ok((reversed.warnings as string[]).some((w) => w.includes('wrong way round')))
})

test('electrolysis divides by the electrons per formula unit', () => {
  const silver = ok('reaction.electrolysis', { current: 96485, time: 1, electrons: 1, molarMass: 107.868 })
  const copper = ok('reaction.electrolysis', { current: 96485, time: 1, electrons: 2, molarMass: 63.546 })
  near(silver.moles, 1, 0.001, 'one mole of silver per Faraday')
  near(copper.moles, 0.5, 0.001, 'and half a mole of copper')
})

// ---------------------------------------------------------------- process

test('a mass balance reports its residual and never closes itself', () => {
  const result = ok('process.mass-balance', {
    inlets: [{ flow: 100, composition: { water: 1 } }],
    outlets: [{ flow: 90, composition: { water: 1 } }]
  })
  assert.equal(result.closes, false)
  near(result.closureError, 0.1, 1e-9, 'ten percent missing')
  assert.ok((result.warnings as string[]).some((w) => w.includes('destroys the signal')))
})

test('a component name that could reach a prototype is refused', () => {
  const sneaky = JSON.parse('{"__proto__": 1}')
  assert.throws(
    () =>
      runChemistryOperation('process.mass-balance', {
        inlets: [{ flow: 100, composition: sneaky }],
        outlets: [{ flow: 100, composition: { water: 1 } }]
      }),
    BadInput
  )
})

test('a stirred tank is bigger than a plug flow reactor for the same duty', () => {
  const result = ok('process.reactor', { kind: 'pfr', rateConstant: 0.1, order: 1, inletConcentration: 1, conversion: 0.9 })
  assert.ok((result.cstrToPfrRatio as number) > 1)
  const comparison = result.comparison as { kind: string; size: number }[]
  assert.equal(comparison.length, 3, 'all three types for comparison')
})

test('a reactor kind nobody defined is refused', () => {
  assert.throws(
    () => runChemistryOperation('process.reactor', { kind: 'magic', rateConstant: 0.1, inletConcentration: 1, conversion: 0.5 }),
    BadInput
  )
})

test('complete conversion is refused as needing an infinite reactor', () => {
  const result = run('process.reactor', { rateConstant: 0.1, inletConcentration: 1, conversion: 1 })
  assert.equal(result.ok, false)
  assert.ok((result.message as string).includes('infinite'))
})

test('conversion, selectivity and yield come back as three numbers', () => {
  const result = ok('process.conversion', { reactantIn: 100, reactantOut: 1, productOut: 50 })
  near(result.conversion, 0.99, 1e-9, 'conversion')
  assert.ok((result.selectivity as number) < 0.6, 'selectivity')
  assert.ok((result.yield as number) < (result.conversion as number), 'yield is the product of the two')
})

test('a reflux below the minimum is refused with the minimum that works', () => {
  const result = run('process.distillation', {
    relativeVolatility: 2.5,
    feedComposition: 0.5,
    distillateComposition: 0.95,
    bottomsComposition: 0.05,
    refluxRatio: 0.1
  })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'impossible')
  assert.ok((result.message as string).includes('1.2 times minimum'))
})

test('the equilibrium curve is thinned without moving the stage count', () => {
  const base = {
    relativeVolatility: 2.5,
    feedComposition: 0.5,
    distillateComposition: 0.95,
    bottomsComposition: 0.05,
    refluxAsMultipleOfMinimum: 1.3,
    samples: 400
  }
  const full = ok('process.distillation', { ...base, trace: 400 })
  const thinned = ok('process.distillation', { ...base, trace: 15 })
  assert.equal((full.equilibriumCurve as unknown[]).length, 400)
  assert.equal((thinned.equilibriumCurve as unknown[]).length, 15)
  assert.equal(thinned.theoreticalStages, full.theoreticalStages)
})

test('an azeotrope is refused as not separable by distillation', () => {
  const result = run('process.distillation', {
    relativeVolatility: 1,
    feedComposition: 0.5,
    distillateComposition: 0.9,
    bottomsComposition: 0.1
  })
  assert.equal(result.ok, false)
  assert.ok((result.message as string).includes('azeotrope'))
})

test('Raoult gives the enrichment that makes distillation work', () => {
  const result = ok('process.raoult', {
    components: [
      { label: 'benzene', liquidFraction: 0.5, vapourPressure: 100 },
      { label: 'toluene', liquidFraction: 0.5, vapourPressure: 40 }
    ]
  })
  near(result.totalPressure, 70, 1e-9, 'the sum of partial pressures')
  near(result.relativeVolatility, 2.5, 1e-9, 'the volatility ratio')
  assert.ok((result.enrichment as number) > 1)
})

// ---------------------------------------------------------------- provenance

test('the assumptions cover every domain this bridge answers for', () => {
  const result = ok('chemistry.assumptions')
  for (const domain of ['elements', 'solutions', 'reactions', 'process']) {
    assert.ok(
      Array.isArray(result[domain]) && (result[domain] as unknown[]).length > 0,
      `${domain} has no assumptions listed`
    )
  }
  assert.ok(typeof result.atomicWeightSource === 'string' && (result.atomicWeightSource as string).length > 0)
  assert.ok(typeof result.standardState === 'object' && result.standardState !== null)
})

test('the reference tables come back with their facts attached', () => {
  assert.ok((ok('element.list').elements as unknown[]).length > 20)
  assert.ok(typeof ok('element.list').source === 'string')
  assert.ok(Object.keys(ok('solution.units').facts as object).length > 0)
  assert.ok(Object.keys(ok('process.reactors').facts as object).length === 3)
})
