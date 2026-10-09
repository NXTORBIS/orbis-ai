import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  check,
  energy,
  ENERGY_EV,
  facts,
  fillingOrder,
  isOrbitalProblem,
  labelFor,
  radial,
  radialCurve,
  radialDistribution,
  shape,
  angular
} from './orbitals.ts'

/**
 * The orbitals are checked against results that are known exactly, not against themselves.
 *
 * Every number here has a closed form somebody worked out by hand a century ago, so a test that agrees with the
 * code and not with the textbook is worth nothing. These compare against the textbook.
 */

const near = (got: number, want: number, within: number, what: string): void => {
  assert.ok(
    Math.abs(got - want) <= within,
    `${what}: got ${got}, expected ${want} to within ${within}`
  )
}

test('the 1s radial function is the exact one', () => {
  // R₁ₛ(r) = 2 e^(−r), in atomic units.
  for (const r of [0, 0.25, 0.5, 1, 2, 4]) {
    near(radial({ n: 1, l: 0, m: 0 }, r), 2 * Math.exp(-r), 1e-12, `R₁ₛ(${r})`)
  }
})

test('the 2s radial function is the exact one, including its node', () => {
  // R₂ₛ(r) = (1/(2√2))(2 − r) e^(−r/2).
  const exact = (r: number): number => (1 / (2 * Math.SQRT2)) * (2 - r) * Math.exp(-r / 2)
  for (const r of [0, 1, 2, 3, 6]) {
    near(radial({ n: 2, l: 0, m: 0 }, r), exact(r), 1e-12, `R₂ₛ(${r})`)
  }
  // And it is exactly zero at r = 2 a₀, which is the node.
  near(radial({ n: 2, l: 0, m: 0 }, 2), 0, 1e-14, 'the 2s node')
})

test('the 2p radial function is the exact one', () => {
  // R₂ₚ(r) = (1/(2√6)) r e^(−r/2).
  const exact = (r: number): number => (1 / (2 * Math.sqrt(6))) * r * Math.exp(-r / 2)
  for (const r of [0, 1, 2, 4, 8]) {
    near(radial({ n: 2, l: 1, m: 0 }, r), exact(r), 1e-12, `R₂ₚ(${r})`)
  }
})

test('the 1s electron is most likely to be found at one Bohr radius', () => {
  // The single most-quoted number in the subject, and the one that catches confusing R² with 4πr²R².
  const curve = radialCurve({ n: 1, l: 0, m: 0 }, { points: 4000 })
  assert.ok(!isOrbitalProblem(curve))
  near(curve.mostLikely, 1, 0.01, 'the 1s peak')
  // R² itself peaks at the nucleus, which is why the distinction matters.
  assert.ok(radial({ n: 1, l: 0, m: 0 }, 0) ** 2 > radial({ n: 1, l: 0, m: 0 }, 1) ** 2)
  // And the distribution is zero at the nucleus, because r² is.
  near(radialDistribution({ n: 1, l: 0, m: 0 }, 0), 0, 1e-14, 'the distribution at r = 0')
})

test('each orbital is normalised — the electron is somewhere, with probability one', () => {
  // ∫4πr²R² dr = 1. This is the check that catches a wrong normalisation constant, which nothing else would.
  for (const name of [
    { n: 1, l: 0, m: 0 },
    { n: 2, l: 0, m: 0 },
    { n: 2, l: 1, m: 0 },
    { n: 3, l: 0, m: 0 },
    { n: 3, l: 1, m: 0 },
    { n: 3, l: 2, m: 0 },
    { n: 4, l: 1, m: 0 }
  ]) {
    const curve = radialCurve(name, { points: 4000 })
    assert.ok(!isOrbitalProblem(curve))
    let total = 0
    for (let i = 1; i < curve.r.length; i += 1) {
      total += ((curve.P[i] + curve.P[i - 1]) / 2) * (curve.r[i] - curve.r[i - 1])
    }
    near(total, 1, 0.01, `${labelFor(name)} normalisation`)
  }
})

test('the number of nodes is n − l − 1, and they are where they are found', () => {
  for (const name of [
    { n: 1, l: 0, m: 0 },
    { n: 2, l: 0, m: 0 },
    { n: 3, l: 0, m: 0 },
    { n: 3, l: 1, m: 0 },
    { n: 4, l: 0, m: 0 },
    { n: 4, l: 2, m: 0 }
  ]) {
    const curve = radialCurve(name, { points: 4000 })
    assert.ok(!isOrbitalProblem(curve))
    assert.equal(curve.nodes.length, name.n - name.l - 1, `${labelFor(name)} node count`)
  }

  // 3s has its nodes at r = 3(3 ± √3)/2 ≈ 1.90 and 7.10 a₀, which is a closed form worth checking against.
  const threeS = radialCurve({ n: 3, l: 0, m: 0 }, { points: 4000 })
  assert.ok(!isOrbitalProblem(threeS))
  near(threeS.nodes[0], (3 * (3 - Math.sqrt(3))) / 2, 0.02, 'first 3s node')
  near(threeS.nodes[1], (3 * (3 + Math.sqrt(3))) / 2, 0.02, 'second 3s node')
})

test('the mean radius from the curve agrees with the closed form', () => {
  // ⟨r⟩ = (3n² − l(l+1))/2Z.
  for (const name of [{ n: 1, l: 0, m: 0 }, { n: 2, l: 1, m: 0 }, { n: 3, l: 2, m: 0 }]) {
    const curve = radialCurve(name, { points: 4000 })
    assert.ok(!isOrbitalProblem(curve))
    const closed = (3 * name.n * name.n - name.l * (name.l + 1)) / 2
    near(curve.mean, closed, closed * 0.04, `${labelFor(name)} mean radius`)
  }
})

test('a higher nuclear charge pulls the orbital in as 1/Z', () => {
  const hydrogen = radialCurve({ n: 1, l: 0, m: 0 }, { points: 3000 })
  const helium = radialCurve({ n: 1, l: 0, m: 0 }, { Z: 2, points: 3000 })
  assert.ok(!isOrbitalProblem(hydrogen) && !isOrbitalProblem(helium))
  near(helium.mostLikely, hydrogen.mostLikely / 2, 0.02, 'He⁺ 1s peak')
})

test('the angular part is normalised over the sphere', () => {
  // ∫|Y|² dΩ = 1 for each. A wrong angular normalisation would not show up in the shape at all.
  for (const name of [
    { l: 0, m: 0 },
    { l: 1, m: 0 },
    { l: 1, m: 1 },
    { l: 2, m: 0 },
    { l: 2, m: 2 },
    { l: 3, m: 1 }
  ]) {
    const steps = 400
    let total = 0
    for (let i = 0; i < steps; i += 1) {
      const theta = (Math.PI * (i + 0.5)) / steps
      for (let j = 0; j < steps; j += 1) {
        const phi = (2 * Math.PI * (j + 0.5)) / steps
        const y = angular(name, theta, phi)
        total += y * y * Math.sin(theta) * (Math.PI / steps) * ((2 * Math.PI) / steps)
      }
    }
    near(total, 1, 0.02, `Y(${name.l},${name.m}) normalisation`)
  }
})

test('a p orbital has its node where the plane is, and the two lobes have opposite signs', () => {
  // p_z is zero in the xy plane, θ = π/2.
  near(angular({ l: 1, m: 0 }, Math.PI / 2, 0), 0, 1e-14, 'p_z in the xy plane')
  // And it is positive above, negative below. Losing that sign loses what an antibonding orbital is.
  assert.ok(angular({ l: 1, m: 0 }, 0.3, 0) > 0)
  assert.ok(angular({ l: 1, m: 0 }, Math.PI - 0.3, 0) < 0)
})

test('an impossible orbital is refused, and says why', () => {
  for (const [name, because] of [
    [{ n: 1, l: 1, m: 0 }, /no 1p orbital/],
    [{ n: 2, l: 2, m: 0 }, /no 2d orbital/],
    [{ n: 0, l: 0, m: 0 }, /1 or more/],
    [{ n: 2, l: 1, m: 3 }, /−1 to 1/]
  ] as const) {
    const got = check(name)
    assert.ok(got !== null, `${JSON.stringify(name)} should be refused`)
    assert.match(`${got.problem} ${got.fix}`, because)
  }
})

test('a possible orbital is not refused', () => {
  for (const name of [{ n: 1, l: 0, m: 0 }, { n: 2, l: 1, m: -1 }, { n: 4, l: 3, m: 3 }]) {
    assert.equal(check(name), null, `${JSON.stringify(name)} is a real orbital`)
  }
})

test('the labels are the ones chemists write', () => {
  assert.equal(labelFor({ n: 1, l: 0, m: 0 }), '1s')
  assert.equal(labelFor({ n: 2, l: 1, m: 0 }), '2pz')
  assert.equal(labelFor({ n: 2, l: 1, m: 1 }), '2px')
  assert.equal(labelFor({ n: 3, l: 2, m: -2 }), '3dxy')
  assert.equal(labelFor({ n: 3, l: 2, m: 2 }), '3dx²−y²')
})

test('the energies are the Bohr ones, in both units', () => {
  // −13.606 eV for hydrogen's ground state, which is the number everybody knows.
  near(energy(1) * ENERGY_EV, -13.605693, 1e-4, 'hydrogen 1s in eV')
  near(energy(2) * ENERGY_EV, -3.4014233, 1e-4, 'hydrogen n=2 in eV')
  // He⁺ is four times deeper, because it goes as Z².
  near(energy(1, 2) * ENERGY_EV, -54.42277, 1e-3, 'He⁺ 1s in eV')
})

test('the facts about an orbital add up the way they must', () => {
  const got = facts({ n: 3, l: 1, m: 0 })
  assert.ok(!isOrbitalProblem(got))
  assert.equal(got.radialNodes, 1)
  assert.equal(got.angularNodes, 1)
  // Always n − 1, for every orbital there is.
  assert.equal(got.totalNodes, 2)
  assert.equal(got.radialNodes + got.angularNodes, got.totalNodes)
  assert.equal(got.inSubshell, 3)
})

test('the filling order is the one the periodic table follows', () => {
  const order = fillingOrder(4)
  // The first distinct subshells, by n and l, in the order they fill. 4s before 3d is the whole point.
  const seen: string[] = []
  for (const one of order) {
    const label = `${one.n}${['s', 'p', 'd', 'f'][one.l]}`
    if (seen[seen.length - 1] !== label) seen.push(label)
  }
  assert.deepEqual(seen.slice(0, 8), ['1s', '2s', '2p', '3s', '3p', '4s', '3d', '4p'])
})

test('a shape is drawn, and its two signs are both present for a p orbital', () => {
  const got = shape({ n: 2, l: 1, m: 0 }, { rings: 24 })
  assert.ok(!isOrbitalProblem(got))
  assert.ok(got.length > 100, 'it should be a surface, not a handful of points')
  assert.ok(got.some((one) => one.sign === 1), 'the positive lobe')
  assert.ok(got.some((one) => one.sign === -1), 'the negative lobe')
  // An s orbital has one sign everywhere, which is what makes it a sphere.
  const s = shape({ n: 1, l: 0, m: 0 }, { rings: 24 })
  assert.ok(!isOrbitalProblem(s))
  assert.ok(s.every((one) => one.sign === 1), 'an s orbital has no node')
})

test('a 3p is drawn bigger than a 2p, because it is', () => {
  const two = shape({ n: 2, l: 1, m: 0 }, { rings: 20 })
  const three = shape({ n: 3, l: 1, m: 0 }, { rings: 20 })
  assert.ok(!isOrbitalProblem(two) && !isOrbitalProblem(three))
  const far = (all: readonly { x: number; y: number; z: number }[]): number =>
    Math.max(...all.map((one) => Math.hypot(one.x, one.y, one.z)))
  assert.ok(far(three) > far(two), 'the 3p must be drawn larger than the 2p')
})
