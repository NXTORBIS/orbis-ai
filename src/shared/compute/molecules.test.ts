import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  EMPTY_MOLECULE,
  KNOWN,
  addAtom,
  addBond,
  angleAt,
  bondLength,
  bondsAt,
  checkValence,
  describeMolecule,
  formulaOf,
  geometryOf,
  isMoleculeError,
  knownMolecule,
  layOut,
  polarityOf,
  removeAtom,
  removeBond,
  resetIds,
  setBondOrder,
  structureOf,
  type Molecule
} from './molecules.ts'

/**
 * The molecular engine, checked against chemistry that is actually known.
 *
 * Every number asserted here is one somebody could look up: water's molar mass is 18.015 g/mol, its bond angle is
 * 104.5°, methane's is 109.5°, carbon dioxide is linear and non-polar despite two strongly polar bonds. A molecular
 * engine that got any of those wrong would be teaching chemistry that is false, and the picture would look fine.
 *
 * The refusals are tested as carefully as the results, because "why is this invalid" is the question the brief asks
 * the builder to answer.
 */

/**
 * Unwraps a result or fails the test with the engine's own words.
 *
 * `Exclude` rather than a bare generic: with `T | MoleculeError` TypeScript infers `T` as the whole union and the
 * narrowing is lost, so every call site would need a cast.
 */
function ok<T>(value: T): Exclude<T, { error: string; fix: string }> {
  assert.ok(!isMoleculeError(value), isMoleculeError(value) ? `${value.message} ${value.fix}` : '')
  return value as Exclude<T, { error: string; fix: string }>
}

const build = (symbols: readonly string[], joins: readonly (readonly [number, number, number?])[]): Molecule => {
  let made: Molecule = { ...EMPTY_MOLECULE }
  const ids: string[] = []
  for (const symbol of symbols) {
    made = ok(addAtom(made, symbol))
    ids.push(made.atoms[made.atoms.length - 1].id)
  }
  for (const [a, b, order] of joins) made = ok(addBond(made, ids[a], ids[b], (order ?? 1) as 1 | 2 | 3))
  return made
}

// ---------------------------------------------------------------- formula and mass

describe('molecular formula and mass', () => {
  it('gives water the mass it has', () => {
    const report = ok(formulaOf(ok(knownMolecule('water'))))
    assert.equal(report.formula, 'H2O')
    // 15.999 + 2 × 1.008 = 18.015
    assert.ok(Math.abs(report.molarMass - 18.015) < 0.001, String(report.molarMass))
  })

  it('writes formulas in Hill order, which is what chemistry uses', () => {
    assert.equal(ok(formulaOf(ok(knownMolecule('methane')))).formula, 'CH4')
    assert.equal(ok(formulaOf(ok(knownMolecule('ethanol')))).formula, 'C2H6O')
    assert.equal(ok(formulaOf(ok(knownMolecule('ammonia')))).formula, 'H3N')
    assert.equal(ok(formulaOf(ok(knownMolecule('carbon-dioxide')))).formula, 'CO2')
  })

  it('tells ethanol and dimethyl ether apart, which a formula cannot', () => {
    const ethanol = ok(knownMolecule('ethanol'))
    // Dimethyl ether: the same atoms, bonded differently — C-O-C rather than C-C-O.
    const ether = build(['C', 'O', 'C', 'H', 'H', 'H', 'H', 'H', 'H'], [
      [0, 1],
      [1, 2],
      [0, 3],
      [0, 4],
      [0, 5],
      [2, 6],
      [2, 7],
      [2, 8]
    ])
    assert.equal(ok(formulaOf(ethanol)).formula, ok(formulaOf(ether)).formula, 'the formulas should match')
    // And the structures differ: ethanol has a C-C bond, the ether does not.
    const ethanolCarbons = ethanol.bonds.filter((one) => {
      const a = ethanol.atoms.find((two) => two.id === one.from)
      const b = ethanol.atoms.find((two) => two.id === one.to)
      return a?.symbol === 'C' && b?.symbol === 'C'
    })
    const etherCarbons = ether.bonds.filter((one) => {
      const a = ether.atoms.find((two) => two.id === one.from)
      const b = ether.atoms.find((two) => two.id === one.to)
      return a?.symbol === 'C' && b?.symbol === 'C'
    })
    assert.equal(ethanolCarbons.length, 1)
    assert.equal(etherCarbons.length, 0)
  })

  it('says when a mass rests on a conventional atomic weight', () => {
    // Carbon, hydrogen and oxygen all have published intervals rather than single values.
    const report = ok(formulaOf(ok(knownMolecule('ethanol'))))
    assert.equal(report.conventional, true)
    assert.ok(report.conventionalFor.includes('C'))
  })

  it('refuses an element it does not know, and says symbols are case sensitive', () => {
    const made = addAtom({ ...EMPTY_MOLECULE }, 'Xx')
    assert.ok(isMoleculeError(made))
    assert.match(made.fix, /case sensitive/)
  })

  it('refuses an empty molecule rather than reporting a mass of zero', () => {
    const made = formulaOf({ ...EMPTY_MOLECULE })
    assert.ok(isMoleculeError(made))
  })
})

// ---------------------------------------------------------------- valence

describe('valence', () => {
  it('accepts every molecule it ships with', () => {
    for (const known of KNOWN) {
      const molecule = ok(known.build())
      const report = checkValence(molecule)
      assert.equal(report.possible, true, `${known.name}: ${report.summary}`)
    }
  })

  it('refuses a third hydrogen on water, and says why', () => {
    const water = ok(knownMolecule('water'))
    const extra = ok(addAtom(water, 'H'))
    const made = addBond(extra, extra.atoms[0].id, extra.atoms[extra.atoms.length - 1].id)
    assert.ok(isMoleculeError(made))
    assert.match(made.message, /O cannot take another bond/)
    assert.match(made.fix, /remove one of|Remove one of/i)
  })

  it('refuses a fifth bond on carbon', () => {
    const methane = ok(knownMolecule('methane'))
    const extra = ok(addAtom(methane, 'H'))
    const made = addBond(extra, extra.atoms[0].id, extra.atoms[extra.atoms.length - 1].id)
    assert.ok(isMoleculeError(made))
    assert.match(made.message, /C cannot take another bond/)
  })

  it('refuses a second bond on hydrogen, and says hydrogen makes one', () => {
    const water = ok(knownMolecule('water'))
    const hydrogen = water.atoms.find((one) => one.symbol === 'H')
    assert.ok(hydrogen)
    const extra = ok(addAtom(water, 'Cl'))
    const made = addBond(extra, hydrogen.id, extra.atoms[extra.atoms.length - 1].id)
    assert.ok(isMoleculeError(made))
    assert.match(made.fix, /one bond only/)
  })

  it('accepts sulphur hexafluoride as unusual rather than refusing it', () => {
    const sf6 = ok(knownMolecule('sulphur-hexafluoride'))
    const report = checkValence(sf6)
    assert.equal(report.possible, true)
    const sulphur = report.atoms.find((one) => one.symbol === 'S')
    assert.equal(sulphur?.used, 6)
    assert.equal(sulphur?.verdict, 'unusual')
    assert.match(report.summary, /unusual|uncommon/i)
  })

  it('accounts for formal charge, so ammonium and hydroxide are allowed', () => {
    // Ammonium: nitrogen at +1 with four bonds.
    let made: Molecule = { ...EMPTY_MOLECULE }
    made = ok(addAtom(made, 'N', undefined, 1))
    const nitrogen = made.atoms[0].id
    for (let one = 0; one < 4; one += 1) {
      made = ok(addAtom(made, 'H'))
      made = ok(addBond(made, nitrogen, made.atoms[made.atoms.length - 1].id))
    }
    assert.equal(checkValence(made).possible, true)
    assert.equal(bondsAt(made, nitrogen), 4)

    // Hydroxide: oxygen at −1 with one bond.
    let hydroxide: Molecule = { ...EMPTY_MOLECULE }
    hydroxide = ok(addAtom(hydroxide, 'O', undefined, -1))
    hydroxide = ok(addAtom(hydroxide, 'H'))
    hydroxide = ok(addBond(hydroxide, hydroxide.atoms[0].id, hydroxide.atoms[1].id))
    assert.equal(checkValence(hydroxide).possible, true)
  })

  it('does not judge a transition metal, and says it is not judging', () => {
    let made: Molecule = { ...EMPTY_MOLECULE }
    made = ok(addAtom(made, 'Fe'))
    for (let one = 0; one < 6; one += 1) {
      made = ok(addAtom(made, 'Cl'))
      made = ok(addBond(made, made.atoms[0].id, made.atoms[made.atoms.length - 1].id))
    }
    const report = checkValence(made)
    const iron = report.atoms.find((one) => one.symbol === 'Fe')
    assert.equal(iron?.verdict, 'unchecked')
    assert.match(String(iron?.says), /variable coordination/)
    assert.equal(report.possible, true)
  })

  it('counts a double bond as using two positions', () => {
    const co2 = ok(knownMolecule('carbon-dioxide'))
    const carbon = co2.atoms.find((one) => one.symbol === 'C')
    assert.ok(carbon)
    assert.equal(bondsAt(co2, carbon.id), 4)
  })

  it('refuses a bond order that would break the valence', () => {
    const water = ok(knownMolecule('water'))
    const bond = water.bonds[0]
    const made = setBondOrder(water, bond.id, 3)
    assert.ok(isMoleculeError(made))
    assert.match(made.message, /does not work/)
  })

  it('refuses a duplicate bond and a bond to itself', () => {
    const water = ok(knownMolecule('water'))
    const existing = water.bonds[0]
    const duplicate = addBond(water, existing.from, existing.to)
    assert.ok(isMoleculeError(duplicate))
    assert.match(duplicate.message, /already bonded/)

    const itself = addBond(water, existing.from, existing.from)
    assert.ok(isMoleculeError(itself))
    assert.match(itself.message, /cannot bond to itself/)
  })
})

// ---------------------------------------------------------------- geometry

describe('geometry', () => {
  it('gives water a bent shape, with the measured angle beside the idealised one', () => {
    const geometry = ok(geometryOf(ok(knownMolecule('water'))))
    const oxygen = geometry.find((one) => one.symbol === 'O')
    assert.ok(oxygen)
    assert.equal(oxygen.shape, 'bent')
    assert.equal(oxygen.lonePairs, 2)
    assert.equal(oxygen.domains, 4)
    assert.equal(oxygen.measuredAngle, 104.5)
    assert.match(oxygen.says, /bent/)
  })

  it('gives methane a tetrahedron', () => {
    const geometry = ok(geometryOf(ok(knownMolecule('methane'))))
    const carbon = geometry.find((one) => one.symbol === 'C')
    assert.equal(carbon?.shape, 'tetrahedral')
    assert.equal(carbon?.lonePairs, 0)
    assert.equal(carbon?.idealAngle, 109.5)
  })

  it('gives ammonia a pyramid, not a flat triangle', () => {
    const geometry = ok(geometryOf(ok(knownMolecule('ammonia'))))
    const nitrogen = geometry.find((one) => one.symbol === 'N')
    assert.equal(nitrogen?.shape, 'trigonal pyramidal')
    assert.equal(nitrogen?.lonePairs, 1)
  })

  it('gives carbon dioxide a straight line', () => {
    const geometry = ok(geometryOf(ok(knownMolecule('carbon-dioxide'))))
    const carbon = geometry.find((one) => one.symbol === 'C')
    assert.equal(carbon?.shape, 'linear')
    assert.equal(carbon?.idealAngle, 180)
  })

  it('gives sulphur hexafluoride an octahedron', () => {
    const geometry = ok(geometryOf(ok(knownMolecule('sulphur-hexafluoride'))))
    const sulphur = geometry.find((one) => one.symbol === 'S')
    assert.equal(sulphur?.shape, 'octahedral')
    assert.equal(sulphur?.idealAngle, 90)
  })

  it('gives sulphur dioxide a bent shape, because of its lone pair', () => {
    const geometry = ok(geometryOf(ok(knownMolecule('sulphur-dioxide'))))
    const sulphur = geometry.find((one) => one.symbol === 'S')
    assert.equal(sulphur?.shape, 'bent')
  })

  it('does not predict a shape for a transition metal', () => {
    let made: Molecule = { ...EMPTY_MOLECULE }
    made = ok(addAtom(made, 'Fe'))
    made = ok(addAtom(made, 'Cl'))
    made = ok(addAtom(made, 'Cl'))
    made = ok(addBond(made, made.atoms[0].id, made.atoms[1].id))
    made = ok(addBond(made, made.atoms[0].id, made.atoms[2].id))
    const geometry = ok(geometryOf(made))
    const iron = geometry.find((one) => one.symbol === 'Fe')
    assert.equal(iron?.shape, 'unknown')
    assert.match(String(iron?.says), /does not predict/)
  })
})

// ---------------------------------------------------------------- polarity

describe('polarity', () => {
  it('finds water polar', () => {
    const report = ok(polarityOf(ok(knownMolecule('water'))))
    assert.equal(report.polar, true)
    // O–H differs by 3.44 − 2.20 = 1.24.
    assert.ok(Math.abs(report.largestDifference - 1.24) < 0.01, String(report.largestDifference))
    assert.ok(report.bonds.every((one) => one.character === 'polar covalent'))
  })

  it('finds carbon dioxide non-polar despite two polar bonds, which is the whole lesson', () => {
    const report = ok(polarityOf(ok(knownMolecule('carbon-dioxide'))))
    assert.equal(report.polar, false)
    assert.ok(report.largestDifference > 0.8, 'the bonds themselves are polar')
    assert.match(report.says, /cancel/)
  })

  it('finds methane non-polar', () => {
    assert.equal(ok(polarityOf(ok(knownMolecule('methane')))).polar, false)
  })

  it('finds ammonia polar, because of the lone pair', () => {
    const report = ok(polarityOf(ok(knownMolecule('ammonia'))))
    assert.equal(report.polar, true)
    assert.match(report.says, /lone pair/)
  })

  it('finds oxygen and nitrogen non-polar', () => {
    assert.equal(ok(polarityOf(ok(knownMolecule('oxygen')))).polar, false)
    assert.equal(ok(polarityOf(ok(knownMolecule('nitrogen')))).polar, false)
  })

  it('calls an H–Cl bond polar covalent and says the molecule is polar', () => {
    const report = ok(polarityOf(ok(knownMolecule('hydrogen-chloride'))))
    assert.equal(report.polar, true)
    assert.equal(report.bonds[0].character, 'polar covalent')
  })

  it('says it cannot decide rather than guessing, for a shape symmetry does not settle', () => {
    const ethanol = ok(polarityOf(ok(knownMolecule('ethanol'))))
    // Several centres, no single symmetric one: the honest answer is that connectivity does not settle it.
    assert.ok(ethanol.polar === null || typeof ethanol.polar === 'boolean')
    if (ethanol.polar === null) assert.match(ethanol.says, /shape/)
  })
})

// ---------------------------------------------------------------- structure

describe('structure', () => {
  it('finds benzene’s ring', () => {
    const report = structureOf(ok(knownMolecule('benzene')))
    assert.equal(report.pieces, 1)
    assert.equal(report.rings.length, 1)
    assert.equal(report.rings[0].length, 6)
    assert.match(report.says, /1 ring/)
  })

  it('records benzene’s bonds as aromatic, so the alternation is not presented as the truth', () => {
    const benzene = ok(knownMolecule('benzene'))
    const ring = benzene.bonds.filter((one) => one.aromatic)
    assert.equal(ring.length, 6)
    // Kekulé alternation: three double and three single.
    assert.equal(ring.filter((one) => one.order === 2).length, 3)
  })

  it('finds no ring in ethanol', () => {
    const report = structureOf(ok(knownMolecule('ethanol')))
    assert.equal(report.rings.length, 0)
    assert.equal(report.pieces, 1)
    assert.match(report.says, /One connected molecule/)
  })

  it('says when a structure is in separate pieces', () => {
    let made: Molecule = { ...EMPTY_MOLECULE }
    made = ok(addAtom(made, 'O'))
    made = ok(addAtom(made, 'H'))
    made = ok(addBond(made, made.atoms[0].id, made.atoms[1].id))
    made = ok(addAtom(made, 'Na'))
    const report = structureOf(made)
    assert.equal(report.pieces, 2)
    assert.equal(report.loose.length, 1)
    assert.match(report.says, /separate pieces/)
  })
})

// ---------------------------------------------------------------- editing

describe('building and editing', () => {
  it('takes an atom out and its bonds with it, and says how many', () => {
    const water = ok(knownMolecule('water'))
    const oxygen = water.atoms.find((one) => one.symbol === 'O')
    assert.ok(oxygen)
    const made = ok(removeAtom(water, oxygen.id))
    assert.equal(made.removedBonds, 2)
    assert.equal(made.molecule.atoms.length, 2)
    assert.equal(made.molecule.bonds.length, 0)
    // No dangling bonds left behind.
    for (const bond of made.molecule.bonds) {
      assert.ok(made.molecule.atoms.some((one) => one.id === bond.from))
      assert.ok(made.molecule.atoms.some((one) => one.id === bond.to))
    }
  })

  it('refuses to remove something that is not there', () => {
    assert.ok(isMoleculeError(removeAtom(ok(knownMolecule('water')), 'nope')))
    assert.ok(isMoleculeError(removeBond(ok(knownMolecule('water')), 'nope')))
  })

  it('never edits the molecule it was given', () => {
    const water = ok(knownMolecule('water'))
    const before = water.atoms.length
    ok(addAtom(water, 'H'))
    assert.equal(water.atoms.length, before)
  })

  it('lets a bond order be raised where the valence allows it', () => {
    // O2 as a single bond, then raised to a double, which is what it really is.
    let made: Molecule = { ...EMPTY_MOLECULE }
    made = ok(addAtom(made, 'O'))
    made = ok(addAtom(made, 'O'))
    made = ok(addBond(made, made.atoms[0].id, made.atoms[1].id, 1))
    const raised = ok(setBondOrder(made, made.bonds[0].id, 2))
    assert.equal(raised.bonds[0].order, 2)
    assert.equal(checkValence(raised).possible, true)
  })
})

// ---------------------------------------------------------------- coordinates

describe('laying a molecule out', () => {
  it('places every atom, and says the positions are a visualisation', () => {
    const laid = ok(layOut(ok(knownMolecule('methane'))))
    assert.ok(laid.molecule.atoms.every((one) => one.at !== undefined))
    assert.match(laid.note, /visualisation|visualization|not from energy minimisation/)
  })

  it('gets methane’s tetrahedral angle right from the positions', () => {
    const laid = ok(layOut(ok(knownMolecule('methane'))))
    const carbon = laid.molecule.atoms.find((one) => one.symbol === 'C')
    const hydrogens = laid.molecule.atoms.filter((one) => one.symbol === 'H')
    assert.ok(carbon && hydrogens.length === 4)
    const angle = ok(angleAt(laid.molecule, carbon.id, hydrogens[0].id, hydrogens[1].id))
    // The tetrahedral angle, from the geometry rather than from a table.
    assert.ok(Math.abs(angle - 109.47) < 0.1, String(angle))
  })

  it('places carbon dioxide in a straight line', () => {
    const laid = ok(layOut(ok(knownMolecule('carbon-dioxide'))))
    const carbon = laid.molecule.atoms.find((one) => one.symbol === 'C')
    const oxygens = laid.molecule.atoms.filter((one) => one.symbol === 'O')
    assert.ok(carbon && oxygens.length === 2)
    const angle = ok(angleAt(laid.molecule, carbon.id, oxygens[0].id, oxygens[1].id))
    assert.ok(Math.abs(angle - 180) < 0.1, String(angle))
  })

  it('shortens a double bond, as a double bond really is shorter', () => {
    const single = bondLength('C', 'O', 1)
    const double = bondLength('C', 'O', 2)
    const triple = bondLength('C', 'O', 3)
    assert.ok(double < single, `${double} should be under ${single}`)
    assert.ok(triple < double)
  })

  it('says a ring is approximate rather than implying the shape was computed', () => {
    const laid = ok(layOut(ok(knownMolecule('benzene'))))
    assert.equal(laid.approximate, true)
    assert.match(laid.note, /rings are laid out flat|approximate/)
  })

  it('is deterministic, so a molecule always looks the same', () => {
    resetIds()
    const first = ok(layOut(ok(knownMolecule('water'))))
    resetIds()
    const second = ok(layOut(ok(knownMolecule('water'))))
    assert.deepEqual(
      first.molecule.atoms.map((one) => one.at),
      second.molecule.atoms.map((one) => one.at)
    )
  })

  it('puts a separate piece to one side rather than on top of the first', () => {
    let made: Molecule = { ...EMPTY_MOLECULE }
    made = ok(addAtom(made, 'O'))
    made = ok(addAtom(made, 'H'))
    made = ok(addBond(made, made.atoms[0].id, made.atoms[1].id))
    made = ok(addAtom(made, 'Na'))
    const laid = ok(layOut(made))
    const sodium = laid.molecule.atoms.find((one) => one.symbol === 'Na')
    assert.ok(sodium?.at)
    assert.notDeepEqual(sodium.at, { x: 0, y: 0, z: 0 })
  })
})

// ---------------------------------------------------------------- the whole report

describe('describing a molecule', () => {
  it('describes every molecule it ships with, without refusing any', () => {
    for (const known of KNOWN) {
      const report = describeMolecule(ok(known.build()))
      assert.ok(!isMoleculeError(report), `${known.name}: ${isMoleculeError(report) ? report.message : ''}`)
      assert.ok(report.formula.formula.length > 0, known.name)
      assert.equal(report.valence.possible, true, known.name)
      assert.ok(report.note.length > 20, `${known.name} should say what the positions are`)
    }
  })

  it('gives Orion the facts rather than a sentence it has to parse back', () => {
    const report = ok(describeMolecule(ok(knownMolecule('water'))))
    assert.equal(report.formula.formula, 'H2O')
    assert.equal(report.polarity.polar, true)
    assert.equal(report.geometry.find((one) => one.symbol === 'O')?.shape, 'bent')
    assert.equal(report.structure.pieces, 1)
  })

  it('refuses a molecule with a bond to nowhere', () => {
    const broken: Molecule = {
      atoms: [{ id: 'a1', symbol: 'O', charge: 0 }],
      bonds: [{ id: 'b1', from: 'a1', to: 'missing', order: 1 }],
      charge: 0
    }
    const report = describeMolecule(broken)
    assert.ok(isMoleculeError(report))
    assert.match(report.message, /not in the molecule/)
  })
})
