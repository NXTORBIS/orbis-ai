/**
 * Chemistry, solutions, reactions and chemical engineering, checked against textbook values.
 *
 * The interesting cases are the ones where an engine could return a confident wrong answer: a formula parsed wrong, an
 * equation "balanced" with invented coefficients, a 1e-8 M acid coming out alkaline, a buffer at a pH it cannot hold,
 * a reflux below the minimum, a mass balance quietly forced to close. Each of those has a test.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ELEMENTS,
  balanceEquation,
  elementBy,
  isChemistryError,
  moleConversion,
  parseFormula,
  stoichiometry
} from './chemistry.ts'
import {
  buffer,
  colligative,
  concentration,
  dilution,
  isSolutionError,
  pH,
  solubility,
  titration
} from './solutions.ts'
import {
  arrhenius,
  cellPotential,
  convertConstant,
  electrolysis,
  equilibrium,
  isReactionError,
  rateLaw,
  thermochemistry
} from './reactions.ts'
import {
  conversionSelectivity,
  distillation,
  isChemEngError,
  massBalance,
  raoult,
  sizeReactor
} from './chemicalEngineering.ts'

const near = (actual: number, expected: number, tolerance: number, what: string): void => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: got ${actual}, expected about ${expected}`)
}

const relative = (actual: number, expected: number, fraction: number, what: string): void => {
  assert.ok(
    Math.abs(actual - expected) <= Math.abs(expected) * fraction,
    `${what}: got ${actual}, expected within ${fraction * 100}% of ${expected}`
  )
}

// ---------------------------------------------------------------- elements

test('every element is internally consistent', () => {
  const seenNumbers = new Set<number>()
  const seenSymbols = new Set<string>()
  for (const one of ELEMENTS) {
    assert.ok(!seenNumbers.has(one.number), `${one.symbol} duplicates atomic number ${one.number}`)
    assert.ok(!seenSymbols.has(one.symbol), `${one.symbol} appears twice`)
    seenNumbers.add(one.number)
    seenSymbols.add(one.symbol)
    assert.ok(one.number >= 1)
    assert.ok(one.name.length > 0)
    assert.ok(/^[A-Z][a-z]?$/.test(one.symbol), `${one.symbol} is not a symbol shape`)
    if (one.atomicWeight !== null) assert.ok(one.atomicWeight > 0)
    if (one.electronegativity !== null) assert.ok(one.electronegativity > 0 && one.electronegativity <= 4)
    /*
     * An element with no oxidation states listed is allowed only where its chemistry has not been measured.
     *
     * Everything from meitnerium up has been made a few atoms at a time and never reacted, so a list of oxidation
     * states for it would be a prediction written as a fact. The note says the configuration is predicted; the
     * empty list says the same thing about its chemistry. Any other element with an empty list is a gap in the data.
     */
    if (one.oxidationStates.length === 0) {
      assert.ok(one.number >= 109, `${one.symbol} has no oxidation states and is not one of the unmeasured superheavies`)
      assert.match(one.note, /predicted|longest-lived/, `${one.symbol} has no oxidation states and does not say why`)
    }
  }
})

test('atomic weight is not monotonic in atomic number, and the table is ordered by protons', () => {
  const argon = elementBy('Ar')
  const potassium = elementBy('K')
  assert.ok(!isChemistryError(argon) && !isChemistryError(potassium))
  assert.ok(potassium.number > argon.number, 'potassium has more protons')
  assert.ok((potassium.atomicWeight as number) < (argon.atomicWeight as number), 'and weighs less')
})

test('element symbols are case sensitive, and the wrong case says what it meant', () => {
  const cobalt = elementBy('Co')
  assert.ok(!isChemistryError(cobalt))
  assert.equal(cobalt.name, 'Cobalt')
  const wrongCase = elementBy('CO')
  assert.ok(isChemistryError(wrongCase))
  assert.ok(wrongCase.message.includes('carbon monoxide'))
})

test('elements can be found by name and number as well as symbol', () => {
  for (const key of ['Fe', 'Iron', 'iron', 26] as const) {
    const found = elementBy(key)
    assert.ok(!isChemistryError(found), `${key}: ${isChemistryError(found) ? found.message : ''}`)
    assert.equal(found.symbol, 'Fe')
  }
  assert.ok(isChemistryError(elementBy('Unobtainium')))
  assert.ok(isChemistryError(elementBy(999)))
})

// ---------------------------------------------------------------- formulas

test('water has the molar mass everyone knows', () => {
  const report = parseFormula('H2O')
  assert.ok(!isChemistryError(report), isChemistryError(report) ? report.message : '')
  near(report.molarMass, 18.015, 0.005, 'the molar mass of water')
  assert.equal(report.totalAtoms, 3)
  const oxygen = report.composition.find((one) => one.symbol === 'O')
  assert.ok(oxygen)
  near(oxygen.massPercent, 88.8, 0.2, 'oxygen is most of the mass of water')
})

test('nested brackets parse correctly', () => {
  const report = parseFormula('Ca3(PO4)2')
  assert.ok(!isChemistryError(report), isChemistryError(report) ? report.message : '')
  const composition = new Map(report.composition.map((one) => [one.symbol, one.count]))
  assert.equal(composition.get('Ca'), 3)
  assert.equal(composition.get('P'), 2)
  assert.equal(composition.get('O'), 8)
  relative(report.molarMass, 310.17, 0.001, 'calcium phosphate')
})

test('a hydrate parses with the water counted', () => {
  const anhydrous = parseFormula('CuSO4')
  const hydrate = parseFormula('CuSO4.5H2O')
  assert.ok(!isChemistryError(anhydrous) && !isChemistryError(hydrate))
  relative(hydrate.molarMass - anhydrous.molarMass, 5 * 18.015, 0.001, 'five waters')
  const hydrogen = hydrate.composition.find((one) => one.symbol === 'H')
  assert.ok(hydrogen && hydrogen.count === 10)
})

test('a charge is read and reported, and a charge digit is not a subscript', () => {
  const sulphate = parseFormula('SO4 2-')
  assert.ok(!isChemistryError(sulphate), isChemistryError(sulphate) ? sulphate.message : '')
  assert.equal(sulphate.charge, -2)

  // Fe3+ is one iron ion with a charge of three, not three iron atoms. Reading the digit as a subscript would
  // silently triple the molar mass.
  const iron = parseFormula('Fe3+')
  assert.ok(!isChemistryError(iron), isChemistryError(iron) ? iron.message : '')
  assert.equal(iron.charge, 3)
  assert.equal(iron.totalAtoms, 1)
  near(iron.molarMass, 55.845, 0.001, 'one iron, not three')

  // And an ordinary subscript still is one.
  const water = parseFormula('H2O')
  assert.ok(!isChemistryError(water))
  assert.equal(water.totalAtoms, 3)
  assert.equal(water.charge, 0)
})

test('the empirical formula is reduced, and glucose reduces to formaldehyde', () => {
  const glucose = parseFormula('C6H12O6')
  assert.ok(!isChemistryError(glucose), isChemistryError(glucose) ? glucose.message : '')
  assert.equal(glucose.empiricalFormula, 'CH2O')
  assert.equal(glucose.isEmpirical, false)
  const formaldehyde = parseFormula('CH2O')
  assert.ok(!isChemistryError(formaldehyde))
  assert.equal(formaldehyde.isEmpirical, true)
  assert.equal(formaldehyde.empiricalFormula, glucose.empiricalFormula, 'the same empirical formula, very different substances')
})

test('a malformed formula is refused with the position of the problem', () => {
  for (const bad of ['H2O)', '(H2O', 'Xx3', 'H2%O', 'C0H4']) {
    const report = parseFormula(bad)
    assert.ok(isChemistryError(report), `${bad} should be refused`)
    assert.ok(report.message.length > 20, `${bad} should say what is wrong`)
  }
})

test('the molar mass uncertainty is propagated', () => {
  const report = parseFormula('C6H12O6')
  assert.ok(!isChemistryError(report))
  assert.ok(report.molarMassUncertainty > 0, 'atomic weights are measurements')
  assert.ok(report.molarMassUncertainty < 0.05, 'and small ones')
  assert.ok(report.warnings.length > 0, 'and carbon and hydrogen vary by source')
})

// ---------------------------------------------------------------- balancing

test('combustion of methane balances to the coefficients everyone learns', () => {
  const report = balanceEquation({ reactants: ['CH4', 'O2'], products: ['CO2', 'H2O'] })
  assert.ok(!isChemistryError(report), isChemistryError(report) ? report.message : '')
  const coefficients = new Map([...report.reactants, ...report.products].map((one) => [one.formula, one.coefficient]))
  assert.equal(coefficients.get('CH4'), 1)
  assert.equal(coefficients.get('O2'), 2)
  assert.equal(coefficients.get('CO2'), 1)
  assert.equal(coefficients.get('H2O'), 2)
  assert.ok(report.elementCheck.every((one) => one.balanced))
  assert.equal(report.massBalanced, true)
})

test('a harder equation balances too', () => {
  // Iron(III) oxide with carbon monoxide: Fe2O3 + 3CO -> 2Fe + 3CO2.
  const report = balanceEquation({ reactants: ['Fe2O3', 'CO'], products: ['Fe', 'CO2'] })
  assert.ok(!isChemistryError(report), isChemistryError(report) ? report.message : '')
  const coefficients = new Map([...report.reactants, ...report.products].map((one) => [one.formula, one.coefficient]))
  assert.equal(coefficients.get('Fe2O3'), 1)
  assert.equal(coefficients.get('CO'), 3)
  assert.equal(coefficients.get('Fe'), 2)
  assert.equal(coefficients.get('CO2'), 3)
})

test('the coefficients come back as the smallest whole numbers', () => {
  const report = balanceEquation({ reactants: ['C2H6', 'O2'], products: ['CO2', 'H2O'] })
  assert.ok(!isChemistryError(report), isChemistryError(report) ? report.message : '')
  const coefficients = [...report.reactants, ...report.products].map((one) => one.coefficient)
  // 2C2H6 + 7O2 -> 4CO2 + 6H2O.
  assert.deepEqual(coefficients, [2, 7, 4, 6])
  const gcd = coefficients.reduce((a, b) => (b === 0 ? a : gcd2(b, a % b)))
  function gcd2(x: number, y: number): number {
    return y === 0 ? x : gcd2(y, x % y)
  }
  assert.equal(gcd, 1, 'no common factor left')
})

test('an equation with an element on only one side is refused by name', () => {
  const report = balanceEquation({ reactants: ['CH4'], products: ['CO2'] })
  assert.ok(isChemistryError(report))
  assert.equal(report.error, 'cannot-balance')
  assert.ok(report.message.includes('only on the'))
})

test('an unbalanceable equation is refused rather than approximated', () => {
  const report = balanceEquation({ reactants: ['H2', 'O2'], products: ['H2O', 'O3'] })
  assert.ok(isChemistryError(report), 'two oxygen products with one hydrogen source is underdetermined')
})

test('charge balance is checked separately from mass balance', () => {
  // Atoms balance and charges do not: this is a half-reaction missing its electrons.
  const report = balanceEquation({ reactants: ['Fe2+'], products: ['Fe3+'] })
  assert.ok(!isChemistryError(report), isChemistryError(report) ? report.message : '')
  assert.equal(report.massBalanced, true)
  assert.equal(report.chargeBalanced, false)
  assert.ok(report.warnings.some((w) => w.includes('electrons')))
})

// ---------------------------------------------------------------- stoichiometry

test('the limiting reagent sets the yield and the excess is reported', () => {
  // 1 mol methane and 1 mol oxygen: oxygen limits, because two are needed per methane.
  const report = stoichiometry({
    reactants: ['CH4', 'O2'],
    products: ['CO2', 'H2O'],
    suppliedMoles: { CH4: 1, O2: 1 }
  })
  assert.ok(!isChemistryError(report), isChemistryError(report) ? report.message : '')
  assert.equal(report.limitingReagent, 'O2')
  near(report.extent, 0.5, 1e-12, 'half a mole of reaction')
  const methane = report.reagents.find((one) => one.formula === 'CH4')
  assert.ok(methane)
  near(methane.molesLeftOver, 0.5, 1e-12, 'half the methane is left over')
  const carbonDioxide = report.products.find((one) => one.formula === 'CO2')
  assert.ok(carbonDioxide)
  near(carbonDioxide.moles, 0.5, 1e-12, 'half a mole of carbon dioxide')
})

test('scaling from the wrong reagent would give a larger answer, and this does not', () => {
  const report = stoichiometry({
    reactants: ['CH4', 'O2'],
    products: ['CO2', 'H2O'],
    suppliedMoles: { CH4: 10, O2: 1 }
  })
  assert.ok(!isChemistryError(report), isChemistryError(report) ? report.message : '')
  assert.equal(report.limitingReagent, 'O2')
  const carbonDioxide = report.products.find((one) => one.formula === 'CO2')
  assert.ok(carbonDioxide && Math.abs(carbonDioxide.moles - 0.5) < 1e-12, 'ten times the methane changes nothing')
})

test('a percent yield above 100 is flagged as impossible', () => {
  const report = stoichiometry({
    reactants: ['CH4', 'O2'],
    products: ['CO2', 'H2O'],
    suppliedMoles: { CH4: 1, O2: 2 },
    actualYieldGrams: 60,
    yieldOf: 'CO2'
  })
  assert.ok(!isChemistryError(report), isChemistryError(report) ? report.message : '')
  assert.ok((report.percentYield as number) > 100)
  assert.ok(report.warnings.some((w) => w.includes('impossible')))
})

test('a reagent that is not in the equation is refused with the list', () => {
  const report = stoichiometry({
    reactants: ['CH4', 'O2'],
    products: ['CO2', 'H2O'],
    suppliedMoles: { N2: 1 }
  })
  assert.ok(isChemistryError(report))
  assert.ok(report.message.includes('CH4'))
})

test('atom economy is reported beside yield and can be low with a perfect yield', () => {
  const report = stoichiometry({
    reactants: ['CH4', 'O2'],
    products: ['CO2', 'H2O'],
    suppliedMoles: { CH4: 1, O2: 2 },
    yieldOf: 'H2O'
  })
  assert.ok(!isChemistryError(report), isChemistryError(report) ? report.message : '')
  assert.ok(report.atomEconomy < 50, 'water is a minority of the product mass here')
  assert.ok(report.warnings.some((w) => w.includes('atom economy')))
})

test('mole conversions round-trip and the particle count is reported', () => {
  const fromGrams = moleConversion({ formula: 'H2O', grams: 18.015 })
  assert.ok(!isChemistryError(fromGrams), isChemistryError(fromGrams) ? fromGrams.message : '')
  near(fromGrams.moles, 1, 0.001, 'a mole of water')
  relative(fromGrams.particles, 6.02214076e23, 0.001, "Avogadro's number")
  const fromMoles = moleConversion({ formula: 'H2O', moles: 1 })
  assert.ok(!isChemistryError(fromMoles))
  near(fromMoles.mass, 18.015, 0.005, 'and back again')
})

test('a gas volume at STP is 22.4 litres per mole and warns about the conditions', () => {
  const report = moleConversion({ formula: 'O2', litresOfGas: 22.414 })
  assert.ok(!isChemistryError(report), isChemistryError(report) ? report.message : '')
  near(report.moles, 1, 0.005, 'a mole of gas at STP')
  assert.ok(report.warnings.some((w) => w.includes('22.4')))
})

// ---------------------------------------------------------------- solutions

test('a very dilute strong acid does not come out alkaline', () => {
  const report = pH({ concentration: 1e-8, kind: 'strong-acid' })
  assert.ok(!isSolutionError(report), isSolutionError(report) ? report.message : '')
  assert.ok(report.pH < 7, 'an acid is acidic however dilute')
  near(report.pH, 6.98, 0.02, 'the correct answer for 1e-8 M')
  assert.equal(report.simpleFormulaAdequate, false)
  near(report.simpleFormulaResult as number, 8, 0.001, 'where the shortcut says pH 8')
  assert.ok(report.warnings.some((w) => w.includes('alkaline')))
})

test('an ordinary strong acid matches the shortcut', () => {
  const report = pH({ concentration: 0.01, kind: 'strong-acid' })
  assert.ok(!isSolutionError(report), isSolutionError(report) ? report.message : '')
  near(report.pH, 2, 0.001, 'pH 2')
  assert.equal(report.simpleFormulaAdequate, true)
})

test('a weak acid solves the quadratic rather than assuming', () => {
  const report = pH({ concentration: 0.1, kind: 'weak-acid', pKa: 4.76 })
  assert.ok(!isSolutionError(report), isSolutionError(report) ? report.message : '')
  near(report.pH, 2.88, 0.02, 'acetic acid at 0.1 M')
  assert.ok((report.fractionDissociated as number) < 0.02, 'barely dissociated')

  const dilute = pH({ concentration: 1e-5, kind: 'weak-acid', pKa: 4.76 })
  assert.ok(!isSolutionError(dilute), isSolutionError(dilute) ? dilute.message : '')
  assert.ok((dilute.fractionDissociated as number) > 0.3, 'a weak acid dissociates more when dilute')
  assert.ok(dilute.warnings.length > 0, 'and the usual approximation is flagged')
})

test('neutral pH is not 7 at every temperature', () => {
  const hot = pH({ concentration: 1e-7, kind: 'strong-acid', temperature: 323.15 })
  assert.ok(!isSolutionError(hot), isSolutionError(hot) ? hot.message : '')
  assert.ok(hot.neutralPh < 6.9, 'neutral is below 7 at 50 C')
  assert.ok(hot.warnings.some((w) => w.includes('not 7')))
})

test('a base is alkaline and a strong base at 0.01 M is pH 12', () => {
  const report = pH({ concentration: 0.01, kind: 'strong-base' })
  assert.ok(!isSolutionError(report), isSolutionError(report) ? report.message : '')
  near(report.pH, 12, 0.001, 'pH 12')
  assert.equal(report.character, 'alkaline')
})

test('a concentrated solution is refused as outside the model', () => {
  const report = pH({ concentration: 30, kind: 'strong-acid' })
  assert.ok(isSolutionError(report))
  assert.equal(report.error, 'outside-model')
})

test('molarity to molality is refused without the density, with the reason', () => {
  const report = concentration({ formula: 'NaOH', molarity: 1 })
  assert.ok(!isSolutionError(report), isSolutionError(report) ? report.message : '')
  assert.ok(report.missing.some((one) => one.unit === 'molality'))
  assert.ok(report.warnings.some((w) => w.includes('1.33')))
  assert.ok(!report.values.some((one) => one.unit === 'molality'), 'and no molality was invented')
})

test('with a density every unit converts', () => {
  const report = concentration({ formula: 'NaCl', massPercent: 10, solutionDensity: 1.07 })
  assert.ok(!isSolutionError(report), isSolutionError(report) ? report.message : '')
  const molarity = report.values.find((one) => one.unit === 'molarity')
  const molality = report.values.find((one) => one.unit === 'molality')
  assert.ok(molarity && molality)
  relative(molarity.value, 1.83, 0.02, '10% sodium chloride is about 1.8 M')
  assert.ok(molality.value > molarity.value, 'molality exceeds molarity for a dense solution')
})

test('a dilution reports the solvent to add, not the final volume', () => {
  const report = dilution({ initialConcentration: 2, initialVolume: 0.05, finalConcentration: 0.5 })
  assert.ok(!isSolutionError(report), isSolutionError(report) ? report.message : '')
  near(report.finalVolume, 0.2, 1e-12, 'four times the volume')
  near(report.solventToAdd, 0.15, 1e-12, 'and 150 mL of solvent')
  near(report.dilutionFactor, 4, 1e-12, 'the numbers agree')
})

test('concentrating by dilution is refused', () => {
  const report = dilution({ initialConcentration: 0.5, initialVolume: 0.1, finalConcentration: 2 })
  assert.ok(isSolutionError(report))
  assert.ok(report.message.includes('cannot concentrate'))
})

test('a large dilution factor suggests doing it in steps', () => {
  const report = dilution({ initialConcentration: 1, initialVolume: 0.001, finalConcentration: 1e-6 })
  assert.ok(!isSolutionError(report), isSolutionError(report) ? report.message : '')
  assert.ok(report.warnings.some((w) => w.includes('Serial dilution')))
})

test('a buffer at its pKa is an even mixture with maximum capacity', () => {
  const atPka = buffer({ pKa: 4.76, targetPh: 4.76 })
  assert.ok(!isSolutionError(atPka), isSolutionError(atPka) ? atPka.message : '')
  near(atPka.ratio, 1, 1e-9, 'an even mixture')
  assert.equal(atPka.withinRange, true)

  const offPka = buffer({ pKa: 4.76, targetPh: 6.76 })
  assert.ok(!isSolutionError(offPka), isSolutionError(offPka) ? offPka.message : '')
  assert.ok(offPka.bufferCapacity < atPka.bufferCapacity / 10, 'two units away and the capacity has collapsed')
  assert.equal(offPka.withinRange, false)
  assert.ok(offPka.warnings.some((w) => w.includes('outside the range')))
})

test('adding base to a buffer moves the pH a little, and exhausting it is flagged', () => {
  const report = buffer({ pKa: 4.76, acidConcentration: 0.5, baseConcentration: 0.5, addStrongBaseMoles: 0.1 })
  assert.ok(!isSolutionError(report), isSolutionError(report) ? report.message : '')
  assert.ok(report.afterAddition !== null)
  assert.ok(Math.abs(report.afterAddition.phChange) < 0.2, 'a buffer holds')

  const exhausted = buffer({ pKa: 4.76, acidConcentration: 0.05, baseConcentration: 0.5, addStrongBaseMoles: 0.1 })
  assert.ok(!isSolutionError(exhausted), isSolutionError(exhausted) ? exhausted.message : '')
  assert.equal(exhausted.afterAddition, null, 'past exhaustion no new pH is reported')
  assert.ok(exhausted.warnings.some((w) => w.includes('exhausts')))
})

test('a strong-strong titration equivalences at 7 and a weak-strong one does not', () => {
  const strong = titration({ analyteConcentration: 0.1, analyteVolume: 0.025, titrantConcentration: 0.1, analyte: 'strong-acid' })
  assert.ok(!isSolutionError(strong), isSolutionError(strong) ? strong.message : '')
  near(strong.equivalenceVolume, 0.025, 1e-12, 'equal concentrations, equal volumes')
  assert.equal(strong.equivalenceIsNeutral, true)

  const weak = titration({ analyteConcentration: 0.1, analyteVolume: 0.025, titrantConcentration: 0.1, analyte: 'weak-acid', pKa: 4.76 })
  assert.ok(!isSolutionError(weak), isSolutionError(weak) ? weak.message : '')
  assert.equal(weak.equivalenceIsNeutral, false)
  assert.ok(weak.equivalencePh > 8, 'a weak acid equivalences alkaline')
  assert.ok(weak.suitableIndicators.includes('phenolphthalein'), 'which is why phenolphthalein is the indicator')
  assert.ok(!weak.suitableIndicators.includes('methyl orange'), 'and methyl orange is not')
})

test('the half-equivalence pH of a weak acid is its pKa', () => {
  const report = titration({ analyteConcentration: 0.1, analyteVolume: 0.025, titrantConcentration: 0.1, analyte: 'weak-acid', pKa: 4.76 })
  assert.ok(!isSolutionError(report), isSolutionError(report) ? report.message : '')
  near(report.halfEquivalencePh as number, 4.76, 0.01, 'the easiest pKa measurement there is')
})

test('a weak analyte without its pKa is refused', () => {
  const report = titration({ analyteConcentration: 0.1, analyteVolume: 0.025, titrantConcentration: 0.1, analyte: 'weak-acid' })
  assert.ok(isSolutionError(report))
  assert.ok(report.message.includes('pKa'))
})

test('solubility follows from Ksp and the common ion effect is large', () => {
  // Silver chloride: Ksp 1.8e-10, so solubility is 1.34e-5 M.
  const report = solubility({ ksp: 1.8e-10, cationCount: 1, anionCount: 1, commonIonConcentration: 0.01 })
  assert.ok(!isSolutionError(report), isSolutionError(report) ? report.message : '')
  relative(report.molarSolubility, 1.34e-5, 0.01, 'silver chloride in water')
  assert.ok(report.commonIonEffect !== null)
  relative(report.commonIonEffect.reducedSolubility, 1.8e-8, 0.01, 'in 0.01 M chloride')
  assert.ok(report.commonIonEffect.factor > 500, 'hundreds of times less soluble')
})

test('stoichiometry changes the solubility for the same Ksp', () => {
  const oneToOne = solubility({ ksp: 1e-10, cationCount: 1, anionCount: 1 })
  const oneToTwo = solubility({ ksp: 1e-10, cationCount: 1, anionCount: 2 })
  assert.ok(!isSolutionError(oneToOne) && !isSolutionError(oneToTwo))
  assert.notEqual(oneToOne.molarSolubility, oneToTwo.molarSolubility)
  assert.ok(oneToTwo.molarSolubility > oneToOne.molarSolubility, 'more ions per unit means more soluble for the same Ksp')
})

test('whether a mixture precipitates is decided by the ion product', () => {
  const clear = solubility({ ksp: 1.8e-10, cationConcentration: 1e-6, anionConcentration: 1e-6 })
  const cloudy = solubility({ ksp: 1.8e-10, cationConcentration: 1e-3, anionConcentration: 1e-3 })
  assert.ok(!isSolutionError(clear) && !isSolutionError(cloudy))
  assert.equal(clear.willPrecipitate, false)
  assert.equal(cloudy.willPrecipitate, true)
})

test("colligative properties need the van't Hoff factor and warn without it", () => {
  const sugar = colligative({ molality: 1, vanHoffFactor: 1, freezingConstant: 1.86, pureFreezingPoint: 273.15 })
  const salt = colligative({ molality: 1, vanHoffFactor: 2, freezingConstant: 1.86, pureFreezingPoint: 273.15 })
  assert.ok(!isSolutionError(sugar) && !isSolutionError(salt))
  near(sugar.freezingPointDepression as number, 1.86, 1e-9, 'one molal sugar')
  near(salt.freezingPointDepression as number, 3.72, 1e-9, 'and twice that for salt')
  near(salt.newFreezingPoint as number, 273.15 - 3.72, 1e-9, 'the new freezing point')

  const assumed = colligative({ molality: 1, freezingConstant: 1.86 })
  assert.ok(!isSolutionError(assumed))
  assert.ok(assumed.warnings.some((w) => w.includes('factor of two')))
})

// ---------------------------------------------------------------- reactions

test('methane combustion is exothermic and spontaneous', () => {
  const report = thermochemistry({
    reactants: [
      { formula: 'CH4', formationEnthalpy: -74.6, entropy: 186.3 },
      { formula: 'O2', coefficient: 2, formationEnthalpy: 0, entropy: 205.2 }
    ],
    products: [
      { formula: 'CO2', formationEnthalpy: -393.5, entropy: 213.8 },
      { formula: 'H2O', coefficient: 2, formationEnthalpy: -241.8, entropy: 188.8 }
    ]
  })
  assert.ok(!isReactionError(report), isReactionError(report) ? report.message : '')
  near(report.enthalpyChange, -802.5, 1, 'the standard enthalpy of combustion')
  assert.equal(report.exothermic, true)
  assert.equal(report.spontaneous, true)
  assert.ok(report.warnings.some((w) => w.includes('not fast')))
})

test('an endothermic entropy-driven reaction has a crossover temperature', () => {
  // Calcium carbonate decomposing: endothermic and entropy-increasing, so it needs heat.
  const report = thermochemistry({
    reactants: [{ formula: 'CaCO3', formationEnthalpy: -1207, entropy: 92.9 }],
    products: [
      { formula: 'CaO', formationEnthalpy: -634.9, entropy: 38.1 },
      { formula: 'CO2', formationEnthalpy: -393.5, entropy: 213.8 }
    ]
  })
  assert.ok(!isReactionError(report), isReactionError(report) ? report.message : '')
  assert.equal(report.exothermic, false)
  assert.equal(report.drivenBy, 'entropy')
  assert.ok(report.crossoverTemperature !== null)
  assert.ok(report.crossoverTemperature > 1000 && report.crossoverTemperature < 1300, 'limestone calcines around 1100 K')
  assert.equal(report.spontaneous, false, 'not at room temperature')
})

test('a negative absolute entropy is refused, because the third law forbids it', () => {
  const report = thermochemistry({
    reactants: [{ formula: 'A', formationEnthalpy: 0, entropy: -10 }],
    products: [{ formula: 'B', formationEnthalpy: -100, entropy: 50 }]
  })
  assert.ok(isReactionError(report))
  assert.ok(report.message.includes('third law'))
})

test('missing entropies mean no spontaneity claim', () => {
  const report = thermochemistry({
    reactants: [{ formula: 'CH4', formationEnthalpy: -74.6 }],
    products: [{ formula: 'C', formationEnthalpy: 0 }, { formula: 'H2', coefficient: 2, formationEnthalpy: 0 }]
  })
  assert.ok(!isReactionError(report), isReactionError(report) ? report.message : '')
  assert.equal(report.gibbsChange, null)
  assert.equal(report.spontaneous, null)
  assert.ok(report.warnings.some((w) => w.includes('ice melts')))
})

test('equilibrium is solved rather than approximated', () => {
  // A -> B with K = 1: half converts.
  const report = equilibrium({ constant: 1, reactants: [{ formula: 'A', initial: 1 }], products: [{ formula: 'B' }] })
  assert.ok(!isReactionError(report), isReactionError(report) ? report.message : '')
  near(report.extent, 0.5, 1e-9, 'half converts at K = 1')
  assert.ok(report.residual < 1e-9, 'and the quotient matches the constant')
  const a = report.species.find((one) => one.formula === 'A')
  const b = report.species.find((one) => one.formula === 'B')
  assert.ok(a && b)
  near(a.equilibrium, 0.5, 1e-9, 'half the reactant left')
  near(b.equilibrium, 0.5, 1e-9, 'and half of it became product')
})

test('the reaction quotient says which way it goes', () => {
  const forward = equilibrium({ constant: 10, reactants: [{ formula: 'A', initial: 1 }], products: [{ formula: 'B', initial: 0.1 }] })
  const backward = equilibrium({ constant: 0.1, reactants: [{ formula: 'A', initial: 0.1 }], products: [{ formula: 'B', initial: 1 }] })
  assert.ok(!isReactionError(forward) && !isReactionError(backward))
  assert.equal(forward.goes, 'forward')
  assert.equal(backward.goes, 'backward')
  assert.ok(forward.extent > 0)
  assert.ok(backward.extent < 0, 'a backward extent is negative')
})

test('a large constant makes the approximation fail and it is flagged', () => {
  const report = equilibrium({ constant: 100, reactants: [{ formula: 'A', initial: 1 }], products: [{ formula: 'B' }] })
  assert.ok(!isReactionError(report), isReactionError(report) ? report.message : '')
  assert.ok(report.extent > 0.9, 'nearly all of it converts')
  assert.ok(report.residual < 1e-6, 'and the solved answer satisfies the constant')
})

test('a stoichiometric equilibrium solves correctly', () => {
  // 2A -> B with K = 1: the quotient is [B]/[A]^2.
  const report = equilibrium({
    constant: 1,
    reactants: [{ formula: 'A', coefficient: 2, initial: 1 }],
    products: [{ formula: 'B' }]
  })
  assert.ok(!isReactionError(report), isReactionError(report) ? report.message : '')
  const a = report.species.find((one) => one.formula === 'A')
  const b = report.species.find((one) => one.formula === 'B')
  assert.ok(a && b)
  near(b.equilibrium / (a.equilibrium * a.equilibrium), 1, 1e-6, 'the quotient equals the constant')
})

test('Kc and Kp differ unless the gas moles are unchanged', () => {
  const same = convertConstant({ kc: 5, deltaMolesGas: 0 })
  assert.ok(!isReactionError(same), isReactionError(same) ? same.message : '')
  near(same.kp, 5, 1e-12, 'equal when no gas moles change')
  assert.equal(same.equal, true)

  const different = convertConstant({ kc: 5, deltaMolesGas: -1, temperature: 298.15 })
  assert.ok(!isReactionError(different), isReactionError(different) ? different.message : '')
  relative(different.kp, 5 / (0.0831446 * 298.15), 1e-9, 'divided by RT')
  assert.equal(different.equal, false)
})

test('rate constants carry the units their order requires', () => {
  const units = new Map<number, string>()
  for (const order of [0, 1, 2]) {
    const report = rateLaw({ order, rateConstant: 0.01, initialConcentration: 1 })
    assert.ok(!isReactionError(report), `${order}: ${isReactionError(report) ? report.message : ''}`)
    units.set(order, report.rateConstantUnits)
  }
  assert.equal(units.get(1), '1/s')
  assert.equal(units.get(2), 'L/(mol*s)')
  assert.notEqual(units.get(0), units.get(1))
})

test('only a first-order half-life is independent of concentration', () => {
  const firstLow = rateLaw({ order: 1, rateConstant: 0.01, initialConcentration: 1 })
  const firstHigh = rateLaw({ order: 1, rateConstant: 0.01, initialConcentration: 10 })
  assert.ok(!isReactionError(firstLow) && !isReactionError(firstHigh))
  near(firstLow.halfLife as number, firstHigh.halfLife as number, 1e-12, 'the same half-life')
  assert.equal(firstLow.halfLifeIsConstant, true)

  const secondLow = rateLaw({ order: 2, rateConstant: 0.01, initialConcentration: 1 })
  const secondHigh = rateLaw({ order: 2, rateConstant: 0.01, initialConcentration: 10 })
  assert.ok(!isReactionError(secondLow) && !isReactionError(secondHigh))
  near(secondLow.halfLife as number, (secondHigh.halfLife as number) * 10, 1e-9, 'ten times the concentration, a tenth the half-life')
  assert.equal(secondLow.halfLifeIsConstant, false)
})

test('a first-order decay halves at its half-life', () => {
  const report = rateLaw({ order: 1, rateConstant: Math.LN2, initialConcentration: 1, duration: 1, samples: 3 })
  assert.ok(!isReactionError(report), isReactionError(report) ? report.message : '')
  near(report.halfLife as number, 1, 1e-12, 'a half-life of one second')
  near(report.samples[report.samples.length - 1].fractionRemaining, 0.5, 1e-9, 'half remains after one')
})

test('a fractional order is refused with why', () => {
  const report = rateLaw({ order: 1.5, rateConstant: 0.01, initialConcentration: 1 })
  assert.ok(isReactionError(report))
  assert.ok(report.message.includes('closed forms'))
})

test('Arrhenius computes the ten-degree factor rather than reciting the rule', () => {
  const typical = arrhenius({ activationEnergy: 50, rateConstant: 1, temperature: 298.15 })
  assert.ok(!isReactionError(typical), isReactionError(typical) ? typical.message : '')
  near(typical.tenDegreeFactor, 1.95, 0.1, 'about double for 50 kJ/mol, which is where the rule comes from')

  const low = arrhenius({ activationEnergy: 20, rateConstant: 1, temperature: 298.15 })
  const high = arrhenius({ activationEnergy: 100, rateConstant: 1, temperature: 298.15 })
  assert.ok(!isReactionError(low) && !isReactionError(high))
  assert.ok(low.tenDegreeFactor < 1.4, 'and the rule is wrong for a low activation energy')
  assert.ok(high.tenDegreeFactor > 3, 'and wrong the other way for a high one')
})

test('the two-point form recovers the activation energy it was built from', () => {
  const forward = arrhenius({ activationEnergy: 75, preExponential: 1e12, temperature: 300 })
  const atOther = arrhenius({ activationEnergy: 75, preExponential: 1e12, temperature: 350 })
  assert.ok(!isReactionError(forward) && !isReactionError(atOther))
  const fitted = arrhenius({
    temperature: 300,
    rateConstant: forward.rateConstant,
    secondTemperature: 350,
    secondRateConstant: atOther.rateConstant
  })
  assert.ok(!isReactionError(fitted), isReactionError(fitted) ? fitted.message : '')
  near(fitted.activationEnergy, 75, 0.01, 'the activation energy comes back')
  relative(fitted.preExponential, 1e12, 0.001, 'and so does the pre-exponential factor')
})

test('two identical temperatures give no slope and are refused', () => {
  const report = arrhenius({ temperature: 300, rateConstant: 1, secondTemperature: 300, secondRateConstant: 2 })
  assert.ok(isReactionError(report))
  assert.ok(report.message.includes('two different temperatures'))
})

test('a cell potential subtracts tabulated reduction potentials', () => {
  // Zinc-copper: cathode Cu2+/Cu at +0.34, anode Zn2+/Zn at -0.76, giving 1.10 V.
  const report = cellPotential({ cathodePotential: 0.34, anodePotential: -0.76, electrons: 2 })
  assert.ok(!isReactionError(report), isReactionError(report) ? report.message : '')
  near(report.standardPotential, 1.1, 1e-9, 'the Daniell cell')
  assert.equal(report.spontaneous, true)
  assert.ok(report.gibbsChange < -200, 'a strongly favourable reaction')
  near(report.millivoltsPerDecade, 29.6, 0.5, '59 mV divided by two electrons')
})

test('a reversed cell is flagged as needing driving', () => {
  const report = cellPotential({ cathodePotential: -0.76, anodePotential: 0.34, electrons: 2 })
  assert.ok(!isReactionError(report), isReactionError(report) ? report.message : '')
  assert.ok(report.standardPotential < 0)
  assert.equal(report.spontaneous, false)
  assert.ok(report.warnings.some((w) => w.includes('wrong way round')))
})

test('concentration barely moves a cell potential', () => {
  const standard = cellPotential({ cathodePotential: 0.34, anodePotential: -0.76, electrons: 2 })
  const shifted = cellPotential({ cathodePotential: 0.34, anodePotential: -0.76, electrons: 2, reactionQuotient: 100 })
  assert.ok(!isReactionError(standard) && !isReactionError(shifted))
  assert.ok(Math.abs(shifted.cellPotential - standard.cellPotential) < 0.07, 'a hundredfold quotient shift is under 60 mV')
})

test('electrolysis divides by the electrons per formula unit', () => {
  // A Faraday deposits one mole of silver and half a mole of copper.
  const silver = electrolysis({ current: 96485, time: 1, electrons: 1, molarMass: 107.868 })
  const copper = electrolysis({ current: 96485, time: 1, electrons: 2, molarMass: 63.546 })
  assert.ok(!isReactionError(silver) && !isReactionError(copper))
  near(silver.moles, 1, 0.001, 'one mole of silver per Faraday')
  near(copper.moles, 0.5, 0.001, 'and half a mole of copper')
})

test('a target mass gives the time, and it needs a molar mass', () => {
  const report = electrolysis({ current: 10, electrons: 2, molarMass: 63.546, targetMass: 1 })
  assert.ok(!isReactionError(report), isReactionError(report) ? report.message : '')
  assert.ok((report.time as number) > 0)
  relative(report.time as number, (1 / 63.546) * 2 * 96485 / 10, 0.001, "Faraday's law rearranged")

  const without = electrolysis({ current: 10, electrons: 2, targetMass: 1 })
  assert.ok(isReactionError(without))
  assert.ok(without.message.includes('molar mass'))
})

test('full current efficiency is flagged as unachievable', () => {
  const report = electrolysis({ current: 10, time: 100, electrons: 2 })
  assert.ok(!isReactionError(report), isReactionError(report) ? report.message : '')
  assert.ok(report.warnings.some((w) => w.includes('no real cell achieves')))
})

// ---------------------------------------------------------------- chemical engineering

test('a balance that closes says so and one that does not reports the gap', () => {
  const closes = massBalance({
    inlets: [{ label: 'feed', flow: 100, composition: { water: 0.9, salt: 0.1 } }],
    outlets: [
      { label: 'product', flow: 50, composition: { water: 0.8, salt: 0.2 } },
      { label: 'waste', flow: 50, composition: { water: 1, salt: 0 } }
    ]
  })
  assert.ok(!isChemEngError(closes), isChemEngError(closes) ? closes.message : '')
  assert.equal(closes.closes, true)
  near(closes.residual, 0, 1e-9, 'nothing missing')

  const leaks = massBalance({
    inlets: [{ flow: 100, composition: { water: 1 } }],
    outlets: [{ flow: 90, composition: { water: 1 } }]
  })
  assert.ok(!isChemEngError(leaks), isChemEngError(leaks) ? leaks.message : '')
  assert.equal(leaks.closes, false)
  near(leaks.closureError, 0.1, 1e-9, 'ten percent missing')
  assert.ok(leaks.warnings.some((w) => w.includes('destroys the signal')))
  assert.equal(leaks.suggestsMissingStream, true)
})

test('a total that closes while a component does not is distinguished', () => {
  const report = massBalance({
    inlets: [{ flow: 100, composition: { a: 0.5, b: 0.5 } }],
    outlets: [{ flow: 100, composition: { a: 0.7, b: 0.3 } }]
  })
  assert.ok(!isChemEngError(report), isChemEngError(report) ? report.message : '')
  near(report.closureError, 0, 1e-9, 'the total balances')
  assert.equal(report.closes, false, 'and the components do not')
  assert.ok(report.warnings.some((w) => w.includes('not a leak')))
  assert.ok(report.worstComponent !== null)
})

test('more out than in is refused as forbidden', () => {
  const report = massBalance({
    inlets: [{ flow: 90, composition: { water: 1 } }],
    outlets: [{ flow: 100, composition: { water: 1 } }]
  })
  assert.ok(!isChemEngError(report), isChemEngError(report) ? report.message : '')
  assert.ok(report.residual < 0)
  assert.ok(report.warnings.some((w) => w.includes('mass conservation forbids')))
})

test('a stirred tank is always bigger than a plug flow reactor, and more so at high conversion', () => {
  const low = sizeReactor({ kind: 'pfr', rateConstant: 0.1, order: 1, inletConcentration: 1, conversion: 0.5 })
  const high = sizeReactor({ kind: 'pfr', rateConstant: 0.1, order: 1, inletConcentration: 1, conversion: 0.995 })
  assert.ok(!isChemEngError(low) && !isChemEngError(high))
  assert.ok((low.cstrToPfrRatio as number) > 1, 'the tank is bigger')
  assert.ok((high.cstrToPfrRatio as number) > (low.cstrToPfrRatio as number) * 3, 'and much bigger at high conversion')
  assert.ok(high.warnings.some((w) => w.includes('recycle')))
})

test('a first-order plug flow reactor matches its closed form', () => {
  const report = sizeReactor({ kind: 'pfr', rateConstant: 0.1, order: 1, inletConcentration: 2, conversion: 0.9 })
  assert.ok(!isChemEngError(report), isChemEngError(report) ? report.message : '')
  // Space time for first order is -ln(1-X)/k, independent of concentration.
  relative(report.size, -Math.log(0.1) / 0.1, 0.001, 'the analytic space time')
  assert.ok(report.integrationResidual < 1e-6)
})

test('a first-order stirred tank matches its closed form too', () => {
  const report = sizeReactor({ kind: 'cstr', rateConstant: 0.1, order: 1, inletConcentration: 2, conversion: 0.9 })
  assert.ok(!isChemEngError(report), isChemEngError(report) ? report.message : '')
  relative(report.size, 0.9 / (0.1 * 0.1), 0.001, 'X over k(1-X)')
})

test('complete conversion is refused as needing an infinite reactor', () => {
  const report = sizeReactor({ kind: 'pfr', rateConstant: 0.1, inletConcentration: 1, conversion: 1 })
  assert.ok(isChemEngError(report))
  assert.ok(report.message.includes('infinite'))
})

test('conversion, selectivity and yield are three different numbers', () => {
  const report = conversionSelectivity({ reactantIn: 100, reactantOut: 1, productOut: 50 })
  assert.ok(!isChemEngError(report), isChemEngError(report) ? report.message : '')
  near(report.conversion, 0.99, 1e-9, 'almost all of it reacted')
  relative(report.selectivity as number, 0.505, 0.01, 'and half became the product')
  relative(report.yield as number, 0.5, 0.02, 'so the yield is about half')
  assert.ok(report.warnings.some((w) => w.includes('recycled')))
})

test('more product than the reactant could make is refused', () => {
  const report = conversionSelectivity({ reactantIn: 100, reactantOut: 50, productOut: 80 })
  assert.ok(isChemEngError(report))
  assert.ok(report.message.includes('stoichiometric ratio'))
})

test('a reflux below the minimum is refused with the minimum that works', () => {
  const report = distillation({
    relativeVolatility: 2.5,
    feedComposition: 0.5,
    distillateComposition: 0.95,
    bottomsComposition: 0.05,
    refluxRatio: 0.1
  })
  assert.ok(isChemEngError(report))
  assert.equal(report.error, 'impossible')
  assert.ok(report.message.includes('1.2 times minimum'))
})

test('the stage count sits above the Fenske minimum and falls as reflux rises', () => {
  const tight = distillation({
    relativeVolatility: 2.5,
    feedComposition: 0.5,
    distillateComposition: 0.95,
    bottomsComposition: 0.05,
    refluxAsMultipleOfMinimum: 1.05
  })
  const generous = distillation({
    relativeVolatility: 2.5,
    feedComposition: 0.5,
    distillateComposition: 0.95,
    bottomsComposition: 0.05,
    refluxAsMultipleOfMinimum: 3
  })
  assert.ok(!isChemEngError(tight) && !isChemEngError(generous))
  assert.ok(tight.theoreticalStages > tight.minimumStages, 'above the minimum')
  assert.ok(generous.theoreticalStages < tight.theoreticalStages, 'more reflux means fewer stages')
  near(tight.minimumStages, generous.minimumStages, 1e-9, 'and the Fenske minimum does not change')
  relative(tight.minimumStages, Math.log((0.95 / 0.05) * (0.95 / 0.05)) / Math.log(2.5), 0.001, 'the Fenske formula')
})

test('a relative volatility of 1 is refused as an azeotrope', () => {
  const report = distillation({
    relativeVolatility: 1,
    feedComposition: 0.5,
    distillateComposition: 0.9,
    bottomsComposition: 0.1
  })
  assert.ok(isChemEngError(report))
  assert.ok(report.message.includes('azeotrope'))
})

test('compositions in the wrong order are refused', () => {
  const report = distillation({
    relativeVolatility: 2,
    feedComposition: 0.5,
    distillateComposition: 0.1,
    bottomsComposition: 0.9
  })
  assert.ok(isChemEngError(report))
  assert.ok(report.message.includes('bottoms'))
})

test('actual trays exceed theoretical stages by the efficiency', () => {
  const report = distillation({
    relativeVolatility: 2.5,
    feedComposition: 0.5,
    distillateComposition: 0.95,
    bottomsComposition: 0.05,
    refluxAsMultipleOfMinimum: 1.3,
    trayEfficiency: 0.7
  })
  assert.ok(!isChemEngError(report), isChemEngError(report) ? report.message : '')
  assert.ok((report.actualTrays as number) > report.theoreticalStages)
  assert.equal(report.actualTrays, Math.ceil(report.theoreticalStages / 0.7))
})

test('a difficult separation is flagged as such', () => {
  const report = distillation({
    relativeVolatility: 1.05,
    feedComposition: 0.5,
    distillateComposition: 0.99,
    bottomsComposition: 0.01,
    refluxAsMultipleOfMinimum: 1.3
  })
  assert.ok(!isChemEngError(report), isChemEngError(report) ? report.message : '')
  assert.ok(report.minimumStages > 100, 'a very tall column')
  assert.ok(report.warnings.some((w) => w.includes('membrane')))
})

test('Raoult gives the enrichment that makes distillation work', () => {
  const report = raoult({
    components: [
      { label: 'benzene', liquidFraction: 0.5, vapourPressure: 100 },
      { label: 'toluene', liquidFraction: 0.5, vapourPressure: 40 }
    ]
  })
  assert.ok(!isChemEngError(report), isChemEngError(report) ? report.message : '')
  near(report.totalPressure, 70, 1e-9, 'the sum of partial pressures')
  const benzene = report.components.find((one) => one.label === 'benzene')
  assert.ok(benzene)
  relative(benzene.vapourFraction, 100 / 140, 1e-9, 'the vapour is richer in the volatile one')
  near(report.relativeVolatility as number, 2.5, 1e-9, 'the volatility ratio')
  assert.ok((report.enrichment as number) > 1)
})

test('two equally volatile components cannot be separated, and it says so', () => {
  const report = raoult({
    components: [
      { liquidFraction: 0.5, vapourPressure: 100 },
      { liquidFraction: 0.5, vapourPressure: 101 }
    ]
  })
  assert.ok(!isChemEngError(report), isChemEngError(report) ? report.message : '')
  assert.ok(report.warnings.some((w) => w.includes('barely enriched')))
})

test('fractions that do not add to one are normalised with a warning', () => {
  const report = raoult({
    components: [
      { liquidFraction: 0.6, vapourPressure: 100 },
      { liquidFraction: 0.6, vapourPressure: 40 }
    ]
  })
  assert.ok(!isChemEngError(report), isChemEngError(report) ? report.message : '')
  near(report.components.reduce((sum, one) => sum + one.liquidFraction, 0), 1, 1e-9, 'normalised')
  assert.ok(report.warnings.some((w) => w.includes('add to')))
})
