import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isSmilesProblem, promptForSmiles, readSmiles } from './smiles.ts'

/**
 * The parser is checked by molecular formula, against SMILES strings whose compounds everybody knows.
 *
 * That is the check that matters: if the hydrogens are worked out wrongly, or a ring closure is missed, or an
 * aromatic bond is given the wrong order, the formula comes out wrong. A parser that agreed with itself and not
 * with the formula would be worth nothing — and the formula is exactly what the molecule engine then checks the
 * structure against, so getting it right here is what makes the whole path trustworthy.
 */

const formulaOf = (smiles: string): string => {
  const got = readSmiles(smiles)
  assert.ok(!isSmilesProblem(got), `"${smiles}" would not parse: ${JSON.stringify(got)}`)
  return got.formula
}

test('the smallest molecules come out right', () => {
  for (const [smiles, formula] of [
    ['O', 'H2O'],
    ['C', 'CH4'],
    ['N', 'H3N'],
    ['CO', 'CH4O'], // methanol: C bonded to O, both filled with hydrogens
    ['C=O', 'CH2O'], // formaldehyde
    ['O=C=O', 'CO2'],
    ['N#N', 'N2'],
    ['O=O', 'O2'],
    ['ClCl', 'Cl2'],
    ['CC', 'C2H6'],
    ['C=C', 'C2H4'],
    ['C#C', 'C2H2'],
    ['CCO', 'C2H6O'],
    ['CC(=O)O', 'C2H4O2']
  ] as const) {
    assert.equal(formulaOf(smiles), formula, `"${smiles}"`)
  }
})

test('benzene is C6H6, which is the whole aromatic path in one check', () => {
  // If the aromatic bonds were left single, every carbon would take two hydrogens and this would be C6H12.
  assert.equal(formulaOf('c1ccccc1'), 'C6H6')
  // Written with explicit alternating bonds it must give the same answer.
  assert.equal(formulaOf('C1=CC=CC=C1'), 'C6H6')
})

test('the compounds people actually type come out right', () => {
  for (const [name, smiles, formula] of [
    ['caffeine', 'CN1C=NC2=C1C(=O)N(C)C(=O)N2C', 'C8H10N4O2'],
    ['aspirin', 'CC(=O)Oc1ccccc1C(=O)O', 'C9H8O4'],
    ['glucose', 'OCC1OC(O)C(O)C(O)C1O', 'C6H12O6'],
    ['paracetamol', 'CC(=O)Nc1ccc(O)cc1', 'C8H9NO2'],
    ['ibuprofen', 'CC(C)Cc1ccc(cc1)C(C)C(=O)O', 'C13H18O2'],
    ['toluene', 'Cc1ccccc1', 'C7H8'],
    ['phenol', 'Oc1ccccc1', 'C6H6O'],
    ['acetone', 'CC(=O)C', 'C3H6O'],
    ['ethanoic acid', 'CC(=O)O', 'C2H4O2'],
    ['glycine', 'NCC(=O)O', 'C2H5NO2'],
    ['urea', 'NC(=O)N', 'CH4N2O'],
    ['nicotine', 'CN1CCCC1c1cccnc1', 'C10H14N2'],
    ['cyclohexane', 'C1CCCCC1', 'C6H12'],
    ['naphthalene', 'c1ccc2ccccc2c1', 'C10H8'],
    ['pyridine', 'c1ccncc1', 'C5H5N'],
    ['vitamin C', 'OCC(O)C1OC(=O)C(O)=C1O', 'C6H8O6'],
    ['dimethyl ether', 'COC', 'C2H6O'],
    ['chloroform', 'ClC(Cl)Cl', 'CHCl3'],
    ['carbon tetrachloride', 'ClC(Cl)(Cl)Cl', 'CCl4'],
    ['sulfuric acid', 'OS(=O)(=O)O', 'H2O4S']
  ] as const) {
    assert.equal(formulaOf(smiles), formula, `${name}: "${smiles}"`)
  }
})

test('bracketed atoms carry their charges and stated hydrogens', () => {
  // A bracketed atom has exactly the hydrogens it states, which is what the brackets are for.
  assert.equal(formulaOf('[NH4+]'), 'H4N')
  assert.equal(formulaOf('[OH-]'), 'HO')
  assert.equal(formulaOf('[Na+].[Cl-]'), 'ClNa')
  // Pyrrole: the nitrogen's hydrogen has to be stated, because an aromatic N would otherwise take none.
  assert.equal(formulaOf('c1cc[nH]c1'), 'C4H5N')
})

test('a dot means two separate parts, and both are counted', () => {
  const got = readSmiles('[Na+].[Cl-]')
  assert.ok(!isSmilesProblem(got))
  assert.equal(got.symbols.length, 2)
  // And they are not bonded to each other, which is the point of the dot.
  assert.equal(got.bonds.length, 0)
})

test('branches nest', () => {
  // Isopentane: a branch inside a branch.
  assert.equal(formulaOf('CC(C)CC'), 'C5H12')
  assert.equal(formulaOf('CC(C)(C)C'), 'C5H12')
  assert.equal(formulaOf('CC(C(C)C)C'), 'C6H14')
})

test('ring closures with two-digit labels work', () => {
  // %10 and up, for a molecule with many rings.
  assert.equal(formulaOf('C%10CCCCC%10'), 'C6H12')
})

test('rings are found, and their sizes are right', () => {
  const benzene = readSmiles('c1ccccc1')
  assert.ok(!isSmilesProblem(benzene))
  assert.ok(benzene.rings.some((one) => one.length === 6), `rings found: ${benzene.rings.map((o) => o.length)}`)

  // Naphthalene is two fused six-rings.
  const naphthalene = readSmiles('c1ccc2ccccc2c1')
  assert.ok(!isSmilesProblem(naphthalene))
  assert.ok(naphthalene.rings.filter((one) => one.length === 6).length >= 2, 'two six-rings')

  // Caffeine is a six-ring fused to a five-ring.
  const caffeine = readSmiles('CN1C=NC2=C1C(=O)N(C)C(=O)N2C')
  assert.ok(!isSmilesProblem(caffeine))
  const sizes = caffeine.rings.map((one) => one.length).sort()
  assert.ok(sizes.includes(5) && sizes.includes(6), `caffeine's rings came out ${sizes}`)
})

test('every atom in a parsed molecule is joined to something, except a stated separate part', () => {
  for (const smiles of ['CN1C=NC2=C1C(=O)N(C)C(=O)N2C', 'CC(=O)Oc1ccccc1C(=O)O', 'OCC1OC(O)C(O)C(O)C1O']) {
    const got = readSmiles(smiles)
    assert.ok(!isSmilesProblem(got))
    const joined = new Set<number>()
    for (const one of got.bonds) {
      joined.add(one.a)
      joined.add(one.b)
    }
    for (let i = 0; i < got.symbols.length; i += 1) {
      assert.ok(joined.has(i), `atom ${i} (${got.symbols[i]}) of "${smiles}" is bonded to nothing`)
    }
  }
})

test('a broken string is refused, and says where', () => {
  for (const [smiles, because] of [
    ['', /SMILES string is needed/],
    ['CC(', /left open/],
    ['CC)', /closed that was never opened/],
    ['C1CC', /never closed/],
    ['[CH4', /opened and never closed/],
    ['CZ', /not something a SMILES string can contain/],
    ['[Zz]', /not an element this knows/],
    ['1CC', /before any atom/],
    ['(C)', /before any atom/],
    ['C%1C', /two digits/]
  ] as const) {
    const got = readSmiles(smiles)
    assert.ok(isSmilesProblem(got), `"${smiles}" should be refused`)
    assert.match(`${got.problem} ${got.fix}`, because, `"${smiles}"`)
  }
})

test('stereochemistry is read and dropped rather than refused', () => {
  // These are real SMILES and must parse; this draws a shape and does not claim an enantiomer.
  assert.equal(formulaOf('C/C=C/C'), 'C4H8')
  assert.equal(formulaOf('N[C@@H](C)C(=O)O'), 'C3H7NO2')
  const got = readSmiles('C/C=C/C')
  assert.ok(!isSmilesProblem(got))
  assert.ok(got.notes.some((one) => /stereochemistry/i.test(one)))
})

test('an isotope label is dropped, because it changes the mass and not the shape', () => {
  assert.equal(formulaOf('[13CH4]'), 'CH4')
})

test('the same string always gives the same answer', () => {
  const one = readSmiles('CN1C=NC2=C1C(=O)N(C)C(=O)N2C')
  const two = readSmiles('CN1C=NC2=C1C(=O)N(C)C(=O)N2C')
  assert.ok(!isSmilesProblem(one) && !isSmilesProblem(two))
  assert.deepEqual(one.symbols, two.symbols)
  assert.deepEqual(one.bonds, two.bonds)
})

test('the prompt gives it examples of the form, and tells it not to invent', () => {
  const asked = promptForSmiles('caffeine')
  assert.match(asked, /caffeine/)
  assert.match(asked, /CN1C=NC2=C1C\(=O\)N\(C\)C\(=O\)N2C/, 'a worked example makes the form unambiguous')
  assert.match(asked, /Do not invent a SMILES string/)
  // And that the formula is there to check the SMILES against.
  assert.match(asked, /used to check the SMILES/)
})
