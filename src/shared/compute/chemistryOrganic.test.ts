import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isChemistryError, parseFormula, type ChemistryError } from './chemistry.ts'
import { FUNCTIONAL_GROUPS, NAMEABLE, NAMING_RULES, homologousSeries, nameChain } from './chemistry.organic.ts'
import { KNOWN_COMPOUNDS, combine } from './chemistry.compounds.ts'

/**
 * The organic namer and the combination engine.
 *
 * The names below were checked against IUPAC naming, not against the implementation — a test that asserts whatever
 * the code happens to produce proves only that the code is consistent with itself.
 */

/** The value, having asserted it is not a refusal. The return type drops the error arm so the fields are reachable. */
function ok<T>(value: T, what: string): Exclude<T, ChemistryError> {
  assert.ok(!isChemistryError(value), `${what} was refused: ${isChemistryError(value) ? value.message : ''}`)
  return value as Exclude<T, ChemistryError>
}

describe('the functional groups', () => {
  it('has all fourteen families, each complete', () => {
    assert.equal(FUNCTIONAL_GROUPS.length, 14)
    for (const one of FUNCTIONAL_GROUPS) {
      assert.ok(one.name.length > 2, `${one.id} has no name`)
      assert.ok(one.general.length > 2, `${one.id} has no general formula`)
      assert.ok(one.suffix.length > 1, `${one.id} has no suffix`)
      assert.ok(one.reactions.length >= 2, `${one.id} lists fewer than two reactions`)
      assert.ok(one.behaviour.length > 80, `${one.id}'s behaviour note is too thin to be worth reading`)
      // The example has to be a formula this app can actually parse, or the lab will show a refusal.
      ok(parseFormula(one.example.formula), `${one.id}'s example formula`)
    }
  })

  it('has no duplicate ids', () => {
    assert.equal(new Set(FUNCTIONAL_GROUPS.map((one) => one.id)).size, 14)
  })

  it('states five naming rules in order', () => {
    assert.equal(NAMING_RULES.length, 5)
    assert.deepEqual(
      NAMING_RULES.map((one) => one.step),
      [1, 2, 3, 4, 5]
    )
  })
})

describe('naming a chain', () => {
  it('names the alkanes', () => {
    for (const [carbons, expected] of [
      [1, 'methane'],
      [2, 'ethane'],
      [3, 'propane'],
      [4, 'butane'],
      [8, 'octane']
    ] as const) {
      assert.equal(ok(nameChain({ carbons, group: 'alkane' }), 'an alkane').name, expected)
    }
  })

  it('puts the position in an alcohol name where IUPAC puts it', () => {
    assert.equal(ok(nameChain({ carbons: 2, group: 'alcohol' }), 'ethanol').name, 'ethanol')
    assert.equal(ok(nameChain({ carbons: 3, group: 'alcohol', position: 1 }), 'propan-1-ol').name, 'propan-1-ol')
    assert.equal(ok(nameChain({ carbons: 3, group: 'alcohol', position: 2 }), 'propan-2-ol').name, 'propan-2-ol')
  })

  it('applies the lowest-number rule rather than taking the number given', () => {
    // Carbon 3 of a three-carbon chain is carbon 1 counted from the other end. One molecule, one name.
    const held = ok(nameChain({ carbons: 3, group: 'alcohol', position: 3 }), 'propan-3-ol')
    assert.equal(held.name, 'propan-1-ol')
    assert.equal(held.position, 1)
    assert.ok(
      held.notes.some((one) => one.includes('rule 3')),
      'renumbered silently — the rule it applied has to be said'
    )
  })

  it('names alkenes and alkynes with the number before the suffix', () => {
    assert.equal(ok(nameChain({ carbons: 2, group: 'alkene' }), 'ethene').name, 'ethene')
    assert.equal(ok(nameChain({ carbons: 4, group: 'alkene', position: 1 }), 'but-1-ene').name, 'but-1-ene')
    assert.equal(ok(nameChain({ carbons: 4, group: 'alkene', position: 2 }), 'but-2-ene').name, 'but-2-ene')
    assert.equal(ok(nameChain({ carbons: 2, group: 'alkyne' }), 'ethyne').name, 'ethyne')
  })

  it('leaves the number out where the group can only be at the end', () => {
    assert.equal(ok(nameChain({ carbons: 2, group: 'aldehyde' }), 'ethanal').name, 'ethanal')
    assert.equal(ok(nameChain({ carbons: 2, group: 'carboxylic-acid' }), 'ethanoic acid').name, 'ethanoic acid')
    assert.equal(ok(nameChain({ carbons: 3, group: 'aldehyde' }), 'propanal').name, 'propanal')
  })

  it('names ketones and amines', () => {
    assert.equal(ok(nameChain({ carbons: 3, group: 'ketone', position: 2 }), 'propanone').name, 'propan-2-one')
    assert.equal(ok(nameChain({ carbons: 1, group: 'amine' }), 'methanamine').name, 'methanamine')
  })

  it('gets the molecular formula right, by counting', () => {
    assert.equal(ok(nameChain({ carbons: 3, group: 'alkane' }), 'propane').formula, 'C3H8')
    assert.equal(ok(nameChain({ carbons: 1, group: 'alkane' }), 'methane').formula, 'CH4')
    assert.equal(ok(nameChain({ carbons: 2, group: 'alkene' }), 'ethene').formula, 'C2H4')
    assert.equal(ok(nameChain({ carbons: 2, group: 'alkyne' }), 'ethyne').formula, 'C2H2')
    assert.equal(ok(nameChain({ carbons: 2, group: 'alcohol' }), 'ethanol').formula, 'C2H6O')
    assert.equal(ok(nameChain({ carbons: 2, group: 'carboxylic-acid' }), 'ethanoic acid').formula, 'C2H4O2')
  })

  it('gives a molar mass that matches the formula', () => {
    const held = ok(nameChain({ carbons: 2, group: 'alcohol' }), 'ethanol')
    assert.ok(Math.abs(held.molarMass - 46.068) < 0.05, `ethanol came out at ${held.molarMass} g/mol`)
  })

  it('takes the name apart so the assembling is visible', () => {
    const held = ok(nameChain({ carbons: 4, group: 'alcohol', position: 2 }), 'butan-2-ol')
    assert.equal(held.name, 'butan-2-ol')
    assert.ok(held.parts.length >= 3, 'the name was not broken into parts')
    assert.ok(held.parts.some((one) => one.piece === 'but'))
    for (const part of held.parts) assert.ok(part.because.includes('rule'), `"${part.piece}" does not say which rule put it there`)
  })

  it('refuses what it cannot name, by name', () => {
    for (const group of ['aromatic', 'ester', 'ether'] as const) {
      const held = nameChain({ carbons: 6, group })
      assert.ok(isChemistryError(held), `${group} was named from a chain, and it should not be`)
    }
    assert.ok(isChemistryError(nameChain({ carbons: 0, group: 'alkane' })))
    assert.ok(isChemistryError(nameChain({ carbons: 99, group: 'alkane' })))
    assert.ok(isChemistryError(nameChain({ carbons: 2, group: 'ketone', position: 2 })), 'a two-carbon ketone is impossible')
    assert.ok(isChemistryError(nameChain({ carbons: 3, group: 'alkene', position: 3 })), 'a double bond cannot start on the last carbon')
  })

  it('builds a homologous series for every nameable family', () => {
    for (const group of NAMEABLE) {
      const series = ok(homologousSeries(group, 6), `the ${group} series`)
      assert.ok(series.length >= 3, `${group} gave only ${series.length} members`)
      // Each member is one carbon longer than the last, and no two share a name.
      assert.equal(new Set(series.map((one) => one.name)).size, series.length, `${group} repeated a name`)
      for (let at = 1; at < series.length; at += 1) {
        assert.ok(series[at].molarMass > series[at - 1].molarMass, `${group} did not get heavier along the series`)
      }
    }
  })
})

describe('combining elements', () => {
  it('finds water and hydrogen peroxide for hydrogen and oxygen', () => {
    const held = ok(combine(['H', 'O']), 'H + O')
    const formulas = held.known.map((one) => one.formula)
    assert.ok(formulas.includes('H2O'), `water missing — got ${formulas.join(', ')}`)
    assert.ok(formulas.includes('H2O2'), 'hydrogen peroxide missing')
    assert.ok(held.known.every((one) => one.name !== null && one.bond !== null), 'a known compound came back unnamed')
  })

  it('gives water the right molar mass', () => {
    const water = ok(combine(['H', 'O']), 'H + O').known.find((one) => one.formula === 'H2O')
    assert.ok(water && Math.abs(water.molarMass - 18.015) < 0.01, `water came out at ${water?.molarMass}`)
  })

  it('writes a balanced synthesis equation from the elements as they occur', () => {
    const held = ok(combine(['Na', 'Cl']), 'Na + Cl')
    assert.ok(
      held.equations.some((one) => one === '2Na + Cl₂ → 2NaCl'),
      `chlorine was not written as a diatomic molecule: ${held.equations.join(' / ')}`
    )
    const magnesium = ok(combine(['Mg', 'O']), 'Mg + O')
    assert.ok(magnesium.equations.some((one) => one === '2Mg + O₂ → 2MgO'), 'oxygen was not written as O₂')
  })

  it('keeps what balances by valence separate from what exists', () => {
    const held = ok(combine(['Si', 'N']), 'Si + N')
    for (const one of held.possible) {
      assert.equal(one.source, 'possible')
      assert.equal(one.name, null, 'an unverified formula was given a name')
      assert.equal(one.bond, null, 'an unverified formula was given a bond type')
      assert.ok(one.about.includes('does not know'), 'the uncertainty was not stated')
    }
  })

  it('says nothing is in the table rather than inventing something', () => {
    const held = ok(combine(['He', 'Ne']), 'He + Ne')
    assert.equal(held.known.length, 0)
    assert.ok(held.says.includes('Nothing in this table'), held.says)
    assert.ok(held.notes.some((one) => one.includes('not that no such compound exists')), 'an empty answer was not qualified')
  })

  it('refuses one element, and too many', () => {
    assert.ok(isChemistryError(combine(['H'])))
    assert.ok(isChemistryError(combine(['H', 'C', 'N', 'O', 'S'])))
    assert.ok(isChemistryError(combine(['H', 'Xx'])), 'an element that does not exist was accepted')
  })

  it('every compound in the table parses and is named', () => {
    for (const one of KNOWN_COMPOUNDS) {
      const parsed = ok(parseFormula(one.formula), `${one.name} (${one.formula})`)
      assert.ok(parsed.molarMass > 0, `${one.formula} weighs nothing`)
      assert.ok(one.name.length > 2, `${one.formula} has no name`)
      assert.ok(one.about.length > 20, `${one.formula} says nothing about itself`)
    }
    assert.ok(KNOWN_COMPOUNDS.length >= 70, `only ${KNOWN_COMPOUNDS.length} compounds in the table`)
    assert.equal(new Set(KNOWN_COMPOUNDS.map((one) => one.formula)).size, KNOWN_COMPOUNDS.length, 'a formula is in the table twice')
  })
})
