import { test } from 'node:test'
import assert from 'node:assert/strict'
import { angleAt, bondAngle, bondLength, build, type Joined } from './geometry.ts'

/**
 * The geometry is checked against measured bond lengths and angles, not against itself.
 *
 * Every number below is one somebody measured: water's 104.5°, methane's 109.5°, benzene's 139 pm ring. A
 * geometry builder that agreed with its own output and not with those would be worth nothing.
 */

const near = (got: number, want: number, within: number, what: string): void => {
  assert.ok(Math.abs(got - want) <= within, `${what}: got ${got.toFixed(2)}, expected ${want} to within ${within}`)
}

const gap = (atoms: readonly { x: number; y: number; z: number }[], a: number, b: number): number =>
  Math.hypot(atoms[a].x - atoms[b].x, atoms[a].y - atoms[b].y, atoms[a].z - atoms[b].z)

test('bond lengths come out at the measured values', () => {
  // The four everybody knows, from covalent radii.
  near(bondLength('C', 'C', 1), 152, 6, 'C–C')
  near(bondLength('C', 'H', 1), 107, 5, 'C–H')
  near(bondLength('O', 'H', 1), 97, 5, 'O–H')
  near(bondLength('N', 'H', 1), 102, 5, 'N–H')
  // A double bond is shorter than a single, and a triple shorter again. That ordering is the point.
  assert.ok(bondLength('C', 'C', 2) < bondLength('C', 'C', 1))
  assert.ok(bondLength('C', 'C', 3) < bondLength('C', 'C', 2))
  near(bondLength('C', 'C', 2), 132, 6, 'C=C')
  near(bondLength('C', 'C', 3), 119, 6, 'C≡C')
})

test('the angles are the VSEPR ones, lone pairs included', () => {
  // Four things round a carbon is tetrahedral; round an oxygen with two bonds it is squeezed to 104.5.
  near(bondAngle('C', 4), 109.5, 0.01, 'methane')
  near(bondAngle('O', 2), 104.5, 0.01, 'water')
  near(bondAngle('N', 3), 107, 0.01, 'ammonia')
  near(bondAngle('C', 3), 120, 0.01, 'trigonal carbon')
  near(bondAngle('C', 2), 180, 0.01, 'linear carbon')
})

test('water comes out bent at the angle it is actually bent at', () => {
  const got = build(['O', 'H', 'H'], [
    { a: 0, b: 1, order: 1 },
    { a: 0, b: 2, order: 1 }
  ])
  near(angleAt(got.atoms, 0, 1, 2), 104.5, 3, 'the H–O–H angle')
  near(gap(got.atoms, 0, 1), bondLength('O', 'H'), 4, 'the O–H bond')
  // Not linear, which is what a builder that ignored lone pairs would give.
  assert.ok(angleAt(got.atoms, 0, 1, 2) < 130, 'water must not come out linear')
})

test('carbon dioxide comes out straight', () => {
  const got = build(['C', 'O', 'O'], [
    { a: 0, b: 1, order: 2 },
    { a: 0, b: 2, order: 2 }
  ])
  near(angleAt(got.atoms, 0, 1, 2), 180, 4, 'the O=C=O angle')
})

test('methane comes out tetrahedral, all four angles', () => {
  const got = build(['C', 'H', 'H', 'H', 'H'], [1, 2, 3, 4].map((b) => ({ a: 0, b, order: 1 as const })))
  for (let i = 1; i <= 4; i += 1) {
    for (let j = i + 1; j <= 4; j += 1) {
      near(angleAt(got.atoms, 0, i, j), 109.5, 5, `the H–C–H angle between ${i} and ${j}`)
    }
  }
  // And every C–H bond the same length, because they are.
  for (let i = 1; i <= 4; i += 1) near(gap(got.atoms, 0, i), bondLength('C', 'H'), 4, `C–H bond ${i}`)
})

test('ammonia is pyramidal, not flat', () => {
  const got = build(['N', 'H', 'H', 'H'], [1, 2, 3].map((b) => ({ a: 0, b, order: 1 as const })))
  for (let i = 1; i <= 3; i += 1) {
    for (let j = i + 1; j <= 3; j += 1) {
      near(angleAt(got.atoms, 0, i, j), 107, 5, `the H–N–H angle between ${i} and ${j}`)
    }
  }
  // Flat would be 120 at every angle; pyramidal is below it. That difference is the lone pair.
  assert.ok(angleAt(got.atoms, 0, 1, 2) < 115, 'ammonia must not come out flat')
})

test('ethene comes out flat, with 120 degree angles', () => {
  const symbols = ['C', 'C', 'H', 'H', 'H', 'H']
  const bonds: Joined[] = [
    { a: 0, b: 1, order: 2 },
    { a: 0, b: 2, order: 1 },
    { a: 0, b: 3, order: 1 },
    { a: 1, b: 4, order: 1 },
    { a: 1, b: 5, order: 1 }
  ]
  const got = build(symbols, bonds)
  near(angleAt(got.atoms, 0, 2, 3), 120, 7, 'the H–C–H angle')
  near(gap(got.atoms, 0, 1), bondLength('C', 'C', 2), 5, 'the C=C bond')
})

test('a benzene ring closes, and every ring bond is the same length', () => {
  const symbols = [...Array(6).fill('C'), ...Array(6).fill('H')]
  const bonds: Joined[] = []
  for (let i = 0; i < 6; i += 1) {
    bonds.push({ a: i, b: (i + 1) % 6, order: i % 2 === 0 ? 2 : 1 })
    bonds.push({ a: i, b: 6 + i, order: 1 })
  }
  const got = build(symbols, bonds, { rounds: 900 })

  // The ring must actually close — every carbon bonded to the next at roughly the right distance.
  for (let i = 0; i < 6; i += 1) {
    const want = bondLength('C', 'C', i % 2 === 0 ? 2 : 1)
    near(gap(got.atoms, i, (i + 1) % 6), want, 18, `ring bond ${i}`)
  }
  // And the ring angles near 120, which is what makes it a hexagon rather than a folded loop.
  for (let i = 0; i < 6; i += 1) {
    near(angleAt(got.atoms, i, (i + 5) % 6, (i + 1) % 6), 120, 14, `ring angle at ${i}`)
  }
  assert.ok(got.worstBond < 20, `the worst bond was ${got.worstBond.toFixed(1)} pm out`)
})

test('no two atoms end up on top of each other', () => {
  // The failure that draws as one atom. Checked on a molecule big enough for it to happen.
  const symbols = ['C', 'C', 'C', 'C', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H']
  const bonds: Joined[] = [
    { a: 0, b: 1, order: 1 },
    { a: 1, b: 2, order: 1 },
    { a: 2, b: 3, order: 1 },
    { a: 0, b: 4, order: 1 },
    { a: 0, b: 5, order: 1 },
    { a: 0, b: 6, order: 1 },
    { a: 1, b: 7, order: 1 },
    { a: 1, b: 8, order: 1 },
    { a: 2, b: 9, order: 1 },
    { a: 2, b: 10, order: 1 },
    { a: 3, b: 11, order: 1 },
    { a: 3, b: 12, order: 1 },
    { a: 3, b: 13, order: 1 }
  ]
  const got = build(symbols, bonds, { rounds: 700 })
  for (let i = 0; i < got.atoms.length; i += 1) {
    for (let j = i + 1; j < got.atoms.length; j += 1) {
      assert.ok(gap(got.atoms, i, j) > 45, `atoms ${i} and ${j} are ${gap(got.atoms, i, j).toFixed(1)} pm apart`)
    }
  }
})

test('a caffeine-sized molecule is built, and holds together', () => {
  /*
   * Caffeine's real connectivity: a fused purine ring system with three methyls and two carbonyls. This is the
   * case the whole thing exists for — the molecule a model will not give coordinates for.
   */
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
  const bonds: Joined[] = [
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
  const got = build(symbols, bonds, { rounds: 900 })

  assert.equal(got.atoms.length, symbols.length)
  // Every bond within reach of its proper length.
  assert.ok(got.worstBond < 30, `the worst bond was ${got.worstBond.toFixed(1)} pm out`)
  // Nothing on top of anything else.
  for (let i = 0; i < got.atoms.length; i += 1) {
    for (let j = i + 1; j < got.atoms.length; j += 1) {
      assert.ok(gap(got.atoms, i, j) > 40, `atoms ${i} and ${j} are ${gap(got.atoms, i, j).toFixed(1)} pm apart`)
    }
  }
  // And it has a sensible size: caffeine is about 800 pm across at its widest.
  let across = 0
  for (let i = 0; i < got.atoms.length; i += 1) {
    for (let j = i + 1; j < got.atoms.length; j += 1) across = Math.max(across, gap(got.atoms, i, j))
  }
  assert.ok(across > 400 && across < 1600, `it came out ${across.toFixed(0)} pm across`)
})

test('it is centred, so turning it spins rather than swings it', () => {
  const got = build(['C', 'H', 'H', 'H', 'H'], [1, 2, 3, 4].map((b) => ({ a: 0, b, order: 1 as const })))
  const middle = got.atoms.reduce(
    (sum, one) => ({ x: sum.x + one.x, y: sum.y + one.y, z: sum.z + one.z }),
    { x: 0, y: 0, z: 0 }
  )
  near(Math.hypot(middle.x, middle.y, middle.z) / got.atoms.length, 0, 1, 'the centre of the atoms')
})

test('the same connectivity always gives the same shape', () => {
  // Deterministic on purpose: two pictures of one molecule must be comparable.
  const make = (): ReturnType<typeof build> =>
    build(['O', 'H', 'H'], [
      { a: 0, b: 1, order: 1 },
      { a: 0, b: 2, order: 1 }
    ])
  const one = make()
  const two = make()
  assert.deepEqual(one.atoms, two.atoms)
})

test('an atom joined to nothing is placed apart, not left at the origin', () => {
  // Two separate ions. Piled at the centre they would draw as one atom.
  const got = build(['Na', 'Cl'], [])
  assert.ok(gap(got.atoms, 0, 1) > 100, `they came out ${gap(got.atoms, 0, 1).toFixed(0)} pm apart`)
  assert.ok(got.notes.some((one) => /not joined to the rest/.test(one)))
})

test('one atom, and none at all, are both handled', () => {
  const one = build(['He'], [])
  assert.equal(one.atoms.length, 1)
  const none = build([], [])
  assert.equal(none.atoms.length, 0)
})

test('a bond naming an atom that is not there is ignored rather than throwing', () => {
  // checkStructure refuses these before they get here; this is the second line of defence.
  const got = build(['O', 'H'], [
    { a: 0, b: 1, order: 1 },
    { a: 0, b: 9, order: 1 }
  ])
  assert.equal(got.atoms.length, 2)
  assert.ok(got.atoms.every((one) => Number.isFinite(one.x) && Number.isFinite(one.y) && Number.isFinite(one.z)))
})
