import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  checkStructure,
  colourFor,
  countFormula,
  formulaToCheck,
  isMoleculeProblem,
  knownElement,
  promptFor,
  readReply
} from './molecule.ts'

/**
 * The checks are the feature, so they are what is tested.
 *
 * Every refusal below is something a model actually does: the right molecule with a hydrogen missing, a bond to
 * an atom that is not there, two atoms in the same place, a hydrogen with three bonds. Each of those draws as a
 * perfectly plausible molecule, which is exactly why none of them can be allowed through.
 */

const near = (got: number, want: number, within: number, what: string): void => {
  assert.ok(Math.abs(got - want) <= within, `${what}: got ${got}, expected ${want} to within ${within}`)
}

// ---------------------------------------------------------------- the formula

test('a simple formula is counted', () => {
  const got = countFormula('H2O')
  assert.ok(!isMoleculeProblem(got))
  assert.deepEqual({ ...got.atoms }, { H: 2, O: 1 })
  assert.equal(got.total, 3)
  near(got.mass, 18.015, 0.01, 'the mass of water')
})

test('brackets and their multipliers are counted', () => {
  const lime = countFormula('Ca(OH)2')
  assert.ok(!isMoleculeProblem(lime))
  assert.deepEqual({ ...lime.atoms }, { Ca: 1, O: 2, H: 2 })

  const alum = countFormula('Al2(SO4)3')
  assert.ok(!isMoleculeProblem(alum))
  assert.deepEqual({ ...alum.atoms }, { Al: 2, S: 3, O: 12 })
})

test('nested brackets are counted', () => {
  const got = countFormula('K4(Fe(CN)6)')
  assert.ok(!isMoleculeProblem(got))
  assert.deepEqual({ ...got.atoms }, { K: 4, Fe: 1, C: 6, N: 6 })
})

test('a hydrate is counted, dot and all', () => {
  const got = countFormula('CuSO4·5H2O')
  assert.ok(!isMoleculeProblem(got))
  // 1 Cu, 1 S, 4 + 5 = 9 O, 10 H.
  assert.deepEqual({ ...got.atoms }, { Cu: 1, S: 1, O: 9, H: 10 })
  near(got.mass, 249.68, 0.1, 'the mass of copper sulfate pentahydrate')
})

test('subscript digits are accepted, because that is what people paste', () => {
  const got = countFormula('C₆H₁₂O₆')
  assert.ok(!isMoleculeProblem(got))
  assert.deepEqual({ ...got.atoms }, { C: 6, H: 12, O: 6 })
  near(got.mass, 180.16, 0.05, 'the mass of glucose')
})

test('the formula is written back in Hill order, so two spellings compare equal', () => {
  const one = countFormula('H10C8N4O2')
  const two = countFormula('C8H10N4O2')
  assert.ok(!isMoleculeProblem(one) && !isMoleculeProblem(two))
  assert.equal(one.tidy, two.tidy)
  assert.equal(two.tidy, 'C8H10N4O2')
})

test('something that is not a formula is refused, and says why', () => {
  for (const [text, because] of [
    ['', /Type a formula/],
    ['H2O!!', /characters a formula does not/],
    ['hello there', /not where an element symbol can start/],
    ['Xx2', /not an element symbol/],
    ['H2O)', /closed that was never opened/],
    ['Ca(OH2', /opened and never closed/],
    ['H0', /means none of it/]
  ] as const) {
    const got = countFormula(text)
    assert.ok(isMoleculeProblem(got), `"${text}" should be refused`)
    assert.match(`${got.problem} ${got.fix}`, because)
  }
})

test('a two-letter symbol that is not real falls back to one letter', () => {
  // "CO" is carbon monoxide, not cobalt-oxygen. "Co" is cobalt. Case is what tells them apart.
  const monoxide = countFormula('CO')
  assert.ok(!isMoleculeProblem(monoxide))
  assert.deepEqual({ ...monoxide.atoms }, { C: 1, O: 1 })

  const cobalt = countFormula('Co')
  assert.ok(!isMoleculeProblem(cobalt))
  assert.deepEqual({ ...cobalt.atoms }, { Co: 1 })
})

// ---------------------------------------------------------------- the structure check

/** A correct water molecule, bent near 104.5°, in picometres. */
const water = {
  name: 'Water',
  formula: 'H2O',
  atoms: [
    { symbol: 'O', x: 0, y: 0, z: 0 },
    { symbol: 'H', x: 75.7, y: 58.6, z: 0 },
    { symbol: 'H', x: -75.7, y: 58.6, z: 0 }
  ],
  bonds: [
    { a: 0, b: 1, order: 1 },
    { a: 0, b: 2, order: 1 }
  ]
}

test('a correct structure passes, and reports what it measured', () => {
  const got = checkStructure(water, 'H2O')
  assert.ok(!isMoleculeProblem(got), JSON.stringify(got))
  assert.equal(got.structure.atoms.length, 3)
  assert.equal(got.structure.bonds.length, 2)
  assert.equal(got.structure.formula, 'H2O')
  // Oxygen has two bonds, each hydrogen one. Nothing unusual, so nothing to note.
  assert.deepEqual([...got.degrees], [2, 1, 1])
  assert.equal(got.structure.notes.length, 0, `it noted: ${got.structure.notes.join(' ')}`)
})

test('the right molecule with a hydrogen missing is refused', () => {
  // The commonest invention there is, and it draws perfectly well.
  const got = checkStructure({ ...water, atoms: water.atoms.slice(0, 2), bonds: [{ a: 0, b: 1, order: 1 }] }, 'H2O')
  assert.ok(isMoleculeProblem(got))
  assert.match(got.problem, /do not match H2O/)
  assert.match(got.problem, /H: H2O needs 2, 1 came back/)
})

test('an extra atom nobody asked for is refused', () => {
  const got = checkStructure(
    { ...water, atoms: [...water.atoms, { symbol: 'C', x: 200, y: 0, z: 0 }] },
    'H2O'
  )
  assert.ok(isMoleculeProblem(got))
  assert.match(got.problem, /C: H2O needs 0, 1 came back/)
})

test('a bond to an atom that is not there is refused', () => {
  const got = checkStructure({ ...water, bonds: [{ a: 0, b: 7, order: 1 }] }, 'H2O')
  assert.ok(isMoleculeProblem(got))
  assert.match(got.problem, /there are only 3/)
})

test('two atoms in the same place is refused, because it is not a geometry', () => {
  const got = checkStructure(
    {
      ...water,
      atoms: [
        { symbol: 'O', x: 0, y: 0, z: 0 },
        { symbol: 'H', x: 0, y: 0, z: 0 },
        { symbol: 'H', x: -75.7, y: 58.6, z: 0 }
      ]
    },
    'H2O'
  )
  assert.ok(isMoleculeProblem(got))
  assert.match(got.problem, /0 pm apart/)
})

test('an atom with more bonds than its element can make is refused', () => {
  // A hydrogen with two bonds cannot exist, and this is drawn as readily as one that can.
  const got = checkStructure(
    {
      name: 'not water',
      formula: 'H2O',
      atoms: water.atoms,
      bonds: [
        { a: 0, b: 1, order: 1 },
        { a: 0, b: 2, order: 1 },
        { a: 1, b: 2, order: 1 }
      ]
    },
    'H2O'
  )
  assert.ok(isMoleculeProblem(got))
  assert.match(got.problem, /H with 2 bonds/)
})

test('an unusual but real valence is allowed, and said', () => {
  // Sulfur hexafluoride. Six bonds on sulfur is real, so it must not be refused.
  const sf6 = {
    name: 'Sulfur hexafluoride',
    formula: 'SF6',
    atoms: [
      { symbol: 'S', x: 0, y: 0, z: 0 },
      { symbol: 'F', x: 156, y: 0, z: 0 },
      { symbol: 'F', x: -156, y: 0, z: 0 },
      { symbol: 'F', x: 0, y: 156, z: 0 },
      { symbol: 'F', x: 0, y: -156, z: 0 },
      { symbol: 'F', x: 0, y: 0, z: 156 },
      { symbol: 'F', x: 0, y: 0, z: -156 }
    ],
    bonds: [1, 2, 3, 4, 5, 6].map((b) => ({ a: 0, b, order: 1 }))
  }
  const got = checkStructure(sf6, 'SF6')
  assert.ok(!isMoleculeProblem(got), JSON.stringify(got))
  // It is unusual for sulfur, so it is noted rather than hidden.
  assert.ok(got.structure.notes.some((one) => /6 bonds rather than the usual 2/.test(one)))
})

test('bonds numbered from one are read that way, and said', () => {
  const got = checkStructure(
    {
      ...water,
      bonds: [
        { a: 1, b: 2, order: 1 },
        { a: 1, b: 3, order: 1 }
      ]
    },
    'H2O'
  )
  assert.ok(!isMoleculeProblem(got), JSON.stringify(got))
  assert.ok(got.structure.notes.some((one) => /numbered from 1/.test(one)))
  assert.deepEqual([...got.degrees], [2, 1, 1])
})

test('a long bond is noted and still drawn', () => {
  const got = checkStructure(
    {
      ...water,
      atoms: [
        { symbol: 'O', x: 0, y: 0, z: 0 },
        { symbol: 'H', x: 400, y: 0, z: 0 },
        { symbol: 'H', x: -75.7, y: 58.6, z: 0 }
      ]
    },
    'H2O'
  )
  assert.ok(!isMoleculeProblem(got), 'a long bond is a note, not a refusal')
  assert.ok(got.structure.notes.some((one) => /long for O–H/.test(one)))
})

test('an atom joined to nothing is noted, because for a molecule that is wrong', () => {
  const got = checkStructure({ ...water, bonds: [{ a: 0, b: 1, order: 1 }] }, 'H2O')
  assert.ok(!isMoleculeProblem(got))
  assert.ok(got.structure.notes.some((one) => /not joined to the rest/.test(one)))
})

test('a position that is not a number is refused', () => {
  const got = checkStructure(
    {
      ...water,
      atoms: [{ symbol: 'O', x: 0, y: 0, z: 0 }, { symbol: 'H', x: NaN, y: 0, z: 0 }, { symbol: 'H', x: -75, y: 58, z: 0 }]
    },
    'H2O'
  )
  assert.ok(isMoleculeProblem(got))
  assert.match(got.problem, /not a number/)
})

test('no positions at all is the normal case, and the geometry is worked out', () => {
  /*
   * This is the path that matters. Asking a model for coordinates does not work -- it refuses, truthfully -- so
   * it is asked which atoms are bonded instead, and the shape is computed from that.
   */
  const got = checkStructure(
    {
      name: 'Water',
      formula: 'H2O',
      atoms: [{ symbol: 'O' }, { symbol: 'H' }, { symbol: 'H' }],
      bonds: [
        { a: 0, b: 1, order: 1 },
        { a: 0, b: 2, order: 1 }
      ]
    },
    'H2O'
  )
  assert.ok(!isMoleculeProblem(got), JSON.stringify(got))
  assert.equal(got.structure.geometry, 'computed')
  // And it is really a geometry: bent near 104.5, with O-H bonds the right length.
  const [o, h1, h2] = got.structure.atoms
  const length = Math.hypot(o.x - h1.x, o.y - h1.y, o.z - h1.z)
  assert.ok(Math.abs(length - 97) < 6, `the O-H bond came out ${length.toFixed(1)} pm`)
  const dot =
    ((h1.x - o.x) * (h2.x - o.x) + (h1.y - o.y) * (h2.y - o.y) + (h1.z - o.z) * (h2.z - o.z)) /
    (length * Math.hypot(o.x - h2.x, o.y - h2.y, o.z - h2.z))
  const angle = (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI
  assert.ok(Math.abs(angle - 104.5) < 4, `the H-O-H angle came out ${angle.toFixed(1)} degrees`)
  assert.ok(got.worstBond < 10, `the worst bond was ${got.worstBond.toFixed(1)} pm out`)
})

test('a half-positioned answer is not half-believed', () => {
  // Drawing the positioned atoms where they were put and piling the rest at the origin is worse than computing
  // the whole thing, so a partial answer is computed from the bonds and says so.
  const got = checkStructure(
    {
      name: 'Water',
      formula: 'H2O',
      atoms: [{ symbol: 'O', x: 0, y: 0, z: 0 }, { symbol: 'H' }, { symbol: 'H' }],
      bonds: [
        { a: 0, b: 1, order: 1 },
        { a: 0, b: 2, order: 1 }
      ]
    },
    'H2O'
  )
  assert.ok(!isMoleculeProblem(got), JSON.stringify(got))
  assert.equal(got.structure.geometry, 'computed')
  assert.ok(got.structure.notes.some((one) => /worked out from the bonds instead/.test(one)))
})

test('a given geometry is kept, and still checked', () => {
  const got = checkStructure(water, 'H2O')
  assert.ok(!isMoleculeProblem(got))
  assert.equal(got.structure.geometry, 'given')
  // Unchanged from what came in.
  assert.equal(got.structure.atoms[1].x, 75.7)
})

test('caffeine is built from its bonds alone', () => {
  // The molecule the whole change exists for: a model gives its connectivity and refuses its coordinates.
  const symbols = [
    // The purine ring system: a six-ring N1 C2 N3 C4 C5 C6 fused to a five-ring C4 C5 N7 C8 N9.
    'N', 'C', 'N', 'C', 'C', 'C', 'N', 'C', 'N',
    // The two carbonyl oxygens, on C2 and C6.
    'O', 'O',
    // Three methyl carbons, on N1, N3 and N7. Five ring carbons plus three methyls is the eight.
    'C', 'C', 'C',
    // Nine methyl hydrogens and the one on C8.
    'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H'
  ]
  const bonds = [
    // The six-ring.
    { a: 0, b: 1, order: 1 }, { a: 1, b: 2, order: 1 }, { a: 2, b: 3, order: 1 },
    { a: 3, b: 4, order: 2 }, { a: 4, b: 5, order: 1 }, { a: 5, b: 0, order: 1 },
    // The five-ring, sharing C4-C5 with it.
    { a: 3, b: 8, order: 1 }, { a: 8, b: 7, order: 1 }, { a: 7, b: 6, order: 2 }, { a: 6, b: 4, order: 1 },
    // The carbonyls.
    { a: 1, b: 9, order: 2 }, { a: 5, b: 10, order: 2 },
    // The methyls, and their hydrogens.
    { a: 0, b: 11, order: 1 }, { a: 2, b: 12, order: 1 }, { a: 6, b: 13, order: 1 },
    { a: 11, b: 14, order: 1 }, { a: 11, b: 15, order: 1 }, { a: 11, b: 16, order: 1 },
    { a: 12, b: 17, order: 1 }, { a: 12, b: 18, order: 1 }, { a: 12, b: 19, order: 1 },
    { a: 13, b: 20, order: 1 }, { a: 13, b: 21, order: 1 }, { a: 13, b: 22, order: 1 },
    // And the hydrogen on C8.
    { a: 7, b: 23, order: 1 }
  ]
  const got = checkStructure(
    { name: 'Caffeine', formula: 'C8H10N4O2', atoms: symbols.map((symbol) => ({ symbol })), bonds },
    'C8H10N4O2'
  )
  assert.ok(!isMoleculeProblem(got), JSON.stringify(got))
  assert.equal(got.structure.atoms.length, 24)
  assert.equal(got.structure.geometry, 'computed')
  near(got.counted.mass, 194.19, 0.05, 'the molar mass of caffeine')
  // A real shape: nothing on top of anything else.
  for (let i = 0; i < got.structure.atoms.length; i += 1) {
    for (let j = i + 1; j < got.structure.atoms.length; j += 1) {
      const a = got.structure.atoms[i]
      const b = got.structure.atoms[j]
      const gap = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
      assert.ok(gap > 40, `atoms ${i} and ${j} are ${gap.toFixed(1)} pm apart`)
    }
  }
})

test('an element nobody knows is refused rather than drawn grey', () => {
  const got = checkStructure(
    { ...water, atoms: [{ symbol: 'Zz', x: 0, y: 0, z: 0 }, ...water.atoms.slice(1)] },
    'H2O'
  )
  assert.ok(isMoleculeProblem(got))
  assert.match(got.problem, /not an element this knows/)
})

test('an atom a long way from everything else is refused', () => {
  const got = checkStructure(
    { ...water, atoms: [...water.atoms.slice(0, 2), { symbol: 'H', x: 90000, y: 0, z: 0 }] },
    'H2O'
  )
  assert.ok(isMoleculeProblem(got))
  assert.match(got.problem, /from the centre/)
})

test('a benzene ring passes, with its alternating orders', () => {
  const atoms: { symbol: string; x: number; y: number; z: number }[] = []
  const bonds: { a: number; b: number; order: number }[] = []
  // A regular hexagon of carbons at 139 pm, each with a hydrogen at 109 pm further out.
  for (let i = 0; i < 6; i += 1) {
    const turn = (i * Math.PI) / 3
    atoms.push({ symbol: 'C', x: 139 * Math.cos(turn), y: 139 * Math.sin(turn), z: 0 })
  }
  for (let i = 0; i < 6; i += 1) {
    const turn = (i * Math.PI) / 3
    atoms.push({ symbol: 'H', x: 248 * Math.cos(turn), y: 248 * Math.sin(turn), z: 0 })
  }
  for (let i = 0; i < 6; i += 1) {
    bonds.push({ a: i, b: (i + 1) % 6, order: i % 2 === 0 ? 2 : 1 })
    bonds.push({ a: i, b: 6 + i, order: 1 })
  }
  const got = checkStructure({ name: 'Benzene', formula: 'C6H6', atoms, bonds }, 'C6H6')
  assert.ok(!isMoleculeProblem(got), JSON.stringify(got))
  assert.equal(got.structure.atoms.length, 12)
  assert.equal(got.structure.bonds.length, 12)
  // Each carbon has four bonds' worth: two ring single-equivalents plus the double plus the hydrogen.
  assert.ok(got.degrees.slice(0, 6).every((one) => one === 4), `degrees were ${got.degrees.slice(0, 6)}`)
  near(got.across, 496, 2, 'benzene across the hydrogens')
})

// ---------------------------------------------------------------- the reply

test('JSON wrapped in words is still read', () => {
  const got = readReply('Here you are:\n```json\n{"name":"Water","atoms":[]}\n```\nHope that helps.')
  assert.ok(!isMoleculeProblem(got))
  assert.equal(got.held.name, 'Water')
})

test('a model saying it does not know is reported as that, not as a failure to parse', () => {
  const got = readReply('{"unknown": "there is no compound called floopium dioxide"}')
  assert.ok(isMoleculeProblem(got))
  assert.match(got.problem, /does not have a structure/)
  assert.match(got.problem, /floopium/)
})

test('an answer with no JSON in it is refused', () => {
  const got = readReply('I am afraid I cannot help with that.')
  assert.ok(isMoleculeProblem(got))
  assert.match(got.problem, /was not a structure/)
})

test('broken JSON is refused rather than half-read', () => {
  const got = readReply('{"name": "Water", "atoms": [')
  assert.ok(isMoleculeProblem(got))
  assert.match(got.problem, /not readable/)
})

test('a typed formula is checked against itself, and a typed name against the model’s formula', () => {
  const typed = formulaToCheck('C8H10N4O2', { formula: 'C8H10N4O2' })
  assert.equal(typed.strict, true)
  assert.equal(typed.formula, 'C8H10N4O2')

  // "caffeine" is not a formula, so the model's own formula is what the atoms are checked against. Weaker, but
  // it still stops the model listing a different molecule from the one it named.
  const named = formulaToCheck('caffeine', { formula: 'C8H10N4O2' })
  assert.equal(named.strict, false)
  assert.equal(named.formula, 'C8H10N4O2')
})

test('the prompt asks for bonds and tells it not to try coordinates', () => {
  const asked = promptFor('caffeine')
  // The change that made the feature work at all: it is asked what it knows, not what it refuses.
  assert.match(asked, /NO coordinates/)
  assert.match(asked, /FROM ZERO/)
  assert.match(asked, /caffeine/)
  assert.ok(!/PICOMETRES/.test(asked), 'it must not ask for positions any more')
  // And that a refusal is better than an invention.
  assert.match(asked, /Do not invent a structure/)
})

test('every element in the table has a colour, and an unknown one still gets something', () => {
  for (const symbol of ['H', 'C', 'N', 'O', 'S', 'Fe']) {
    assert.match(colourFor(symbol), /^#[0-9a-f]{6}$/i, `${symbol} needs a colour`)
  }
  assert.match(colourFor('Zz'), /^#[0-9a-f]{6}$/i, 'an unknown element must still draw')
  assert.ok(knownElement('Fe'))
  assert.ok(!knownElement('Zz'))
})
