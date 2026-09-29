import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  circularSpeed,
  compareOrbits,
  escapeSpeed,
  fieldGrid,
  gravityBetween,
  isGravitationError,
  nBody,
  orbitFrom,
  orbitPath,
  orbitingPair,
  SHAPE_FACTS,
  type GravitationError,
  type Orbit
} from './gravitation.ts'
import { body, isMechanicsError, magnitude, vec, type Body } from './mechanics.ts'

const ok = <T>(value: T): Exclude<T, GravitationError> => {
  assert.ok(!isGravitationError(value), isGravitationError(value) ? value.message : '')
  return value as Exclude<T, GravitationError>
}

const closeTo = (actual: number, expected: number, tolerance: number, what = ''): void => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what} expected ${expected} within ${tolerance}, got ${actual}`)
}

/** A convenient unit system: G = 1, central mass = 1, so a circular orbit at r = 1 has speed 1. */
const G = 1
const M = 1

const makeBody = (one: Partial<Body> & { id: string; mass: number }): Body => {
  const built = body(one)
  assert.ok(!isMechanicsError(built), isMechanicsError(built) ? built.message : '')
  return built as Body
}

describe('the force between two masses', () => {
  it('follows the inverse square law', () => {
    const near = ok(gravityBetween({ mass1: 2, mass2: 3, position1: vec(0, 0), position2: vec(1, 0), constant: 1 }))
    const far = ok(gravityBetween({ mass1: 2, mass2: 3, position1: vec(0, 0), position2: vec(2, 0), constant: 1 }))
    closeTo(near.force, 6, 1e-12)
    closeTo(far.force, 1.5, 1e-12)
  })

  it('gives equal forces and unequal accelerations', () => {
    const result = ok(gravityBetween({ mass1: 1, mass2: 1000, position1: vec(0, 0), position2: vec(1, 0), constant: 1 }))
    assert.ok(result.acceleration1 > result.acceleration2 * 100)
    assert.match(result.why, /the Earth does not noticeably rise to meet it/)
  })

  it('refuses two masses in the same place, and says the force is undefined rather than large', () => {
    const result = gravityBetween({ mass1: 1, mass2: 1, position1: vec(0, 0), position2: vec(0, 0) })
    assert.ok(isGravitationError(result))
    assert.match(result.message, /not large there, it is undefined/)
  })
})

describe('the field', () => {
  it('is an acceleration, independent of any test mass', () => {
    const grid = ok(
      fieldGrid([{ mass: 100, position: vec(0, 0) }], { xFrom: 1, xTo: 3, yFrom: 0, yTo: 1, columns: 3, rows: 2 }, 1)
    )
    const at = grid.samples.find((one) => one.at.x === 1 && one.at.y === 0)
    // g = GM/r² = 100 at r = 1, pointing inward.
    closeTo(at?.strength as number, 100, 1e-9)
    closeTo(at?.field.x as number, -100, 1e-9)
    assert.ok(grid.notes.some((one) => /does not depend on that mass/.test(one)))
  })

  it('adds the fields of several sources', () => {
    const grid = ok(
      fieldGrid(
        [
          { mass: 1, position: vec(-1, 0) },
          { mass: 1, position: vec(1, 0) }
        ],
        { xFrom: 0, xTo: 0.0001, yFrom: 0, yTo: 0.0001, columns: 2, rows: 2 },
        1
      )
    )
    // Exactly between two equal masses the field cancels.
    const middle = grid.samples[0]
    assert.ok((middle?.strength ?? 1) < 1e-3)
  })

  it('skips a point sitting on a mass rather than returning infinity', () => {
    const grid = ok(fieldGrid([{ mass: 1, position: vec(0, 0) }], { xFrom: -1, xTo: 1, yFrom: -1, yTo: 1, columns: 3, rows: 3 }, 1))
    assert.equal(grid.skipped, 1)
    assert.equal(grid.samples.length, 8)
    assert.ok(grid.notes.some((one) => /undefined rather than very large/.test(one)))
    for (const one of grid.samples) assert.ok(Number.isFinite(one.strength))
  })

  it('has a negative potential that approaches zero far away', () => {
    const grid = ok(fieldGrid([{ mass: 1, position: vec(0, 0) }], { xFrom: 1, xTo: 1000, yFrom: 0, yTo: 1, columns: 2, rows: 2 }, 1))
    for (const one of grid.samples) assert.ok(one.potential < 0)
    const near = grid.samples.find((one) => one.at.x === 1)
    const far = grid.samples.find((one) => one.at.x === 1000)
    assert.ok((far?.potential ?? -1) > (near?.potential ?? 0))
  })

  it('refuses a grid with no masses', () => {
    assert.ok(isGravitationError(fieldGrid([], { xFrom: 0, xTo: 1, yFrom: 0, yTo: 1, columns: 2, rows: 2 })))
  })
})

describe('classifying an orbit', () => {
  const at = (position: [number, number], velocity: [number, number]): Orbit =>
    ok(orbitFrom({ centralMass: M, position: vec(...position), velocity: vec(...velocity), constant: G }))

  it('recognises a circular orbit from the exact circular speed', () => {
    const orbit = at([1, 0], [0, 1])
    assert.equal(orbit.shape, 'circular')
    closeTo(orbit.eccentricity, 0, 1e-12)
    assert.ok(orbit.period !== null, 'a circular orbit has a period')
    closeTo(orbit.period, 2 * Math.PI, 1e-9)
    closeTo(orbit.semiMajorAxis as number, 1, 1e-12)
  })

  it('recognises an ellipse below circular speed', () => {
    const orbit = at([1, 0], [0, 0.8])
    assert.equal(orbit.shape, 'elliptical')
    assert.ok(orbit.eccentricity > 0 && orbit.eccentricity < 1)
    assert.ok(orbit.specificEnergy < 0)
    // Launched at 1 with less than circular speed: this is apoapsis, so it falls inward from here.
    closeTo(orbit.apoapsis as number, 1, 1e-9)
    assert.ok((orbit.periapsis as number) < 1)
  })

  it('recognises escape at exactly the escape speed', () => {
    const orbit = at([1, 0], [0, Math.SQRT2])
    assert.equal(orbit.shape, 'parabolic')
    closeTo(orbit.specificEnergy, 0, 1e-12)
    assert.equal(orbit.semiMajorAxis, null)
    assert.equal(orbit.period, null)
    assert.equal(orbit.apoapsis, null)
  })

  it('recognises a hyperbola above escape speed', () => {
    const orbit = at([1, 0], [0, 2])
    assert.equal(orbit.shape, 'hyperbolic')
    assert.ok(orbit.eccentricity > 1)
    assert.ok(orbit.specificEnergy > 0)
    assert.equal(orbit.period, null)
  })

  it('recognises a radial fall with no angular momentum', () => {
    const orbit = at([1, 0], [-0.5, 0])
    assert.equal(orbit.shape, 'radial')
    closeTo(orbit.specificAngularMomentum, 0, 1e-12)
    assert.ok(orbit.notes.some((one) => /a fall or a throw, not an orbit/.test(one)))
  })

  it('classifies from the numbers and says so', () => {
    const orbit = at([1, 0], [0, 0.9])
    assert.ok(orbit.notes.some((one) => /Classified from the numbers rather than the picture/.test(one)))
  })

  it('has facts for every shape', () => {
    for (const shape of ['circular', 'elliptical', 'parabolic', 'hyperbolic', 'radial'] as const) {
      assert.ok(SHAPE_FACTS[shape].describe.length > 40, shape)
    }
    assert.equal(SHAPE_FACTS.hyperbolic.bound, false)
    assert.equal(SHAPE_FACTS.elliptical.bound, true)
  })

  it('reports inclination as absent rather than zero', () => {
    const orbit = at([1, 0], [0, 1])
    assert.equal(orbit.inclination, null)
    assert.equal(orbit.longitudeOfAscendingNode, null)
    assert.ok(orbit.notes.some((one) => /a zero there would be a claim rather than the absence of one/.test(one)))
  })

  it('conserves energy and angular momentum around the orbit', () => {
    // Two points on the same ellipse must give the same energy and the same angular momentum.
    const apoapsis = at([2, 0], [0, 0.5])
    const periapsisRadius: number = apoapsis.periapsis
    const speedThere = Math.sqrt(2 * (apoapsis.specificEnergy + 1 / periapsisRadius))
    const periapsis = at([-periapsisRadius, 0], [0, -speedThere])
    closeTo(periapsis.specificEnergy, apoapsis.specificEnergy, 1e-9)
    closeTo(Math.abs(periapsis.specificAngularMomentum), Math.abs(apoapsis.specificAngularMomentum), 1e-9)
    closeTo(periapsis.eccentricity, apoapsis.eccentricity, 1e-9)
  })

  it('warns when the orbiting mass is not negligible', () => {
    const orbit = ok(orbitFrom({ centralMass: 1, orbitingMass: 0.3, position: vec(1, 0), velocity: vec(0, 1), constant: G }))
    assert.ok(orbit.notes.some((one) => /the real period is shorter/.test(one)))
  })

  it('does not warn when it is negligible', () => {
    const orbit = ok(orbitFrom({ centralMass: 1, orbitingMass: 1e-9, position: vec(1, 0), velocity: vec(0, 1), constant: G }))
    assert.ok(!orbit.notes.some((one) => /the real period is shorter/.test(one)))
  })

  it('refuses a body at the centre', () => {
    const result = orbitFrom({ centralMass: 1, position: vec(0, 0), velocity: vec(0, 1), constant: G })
    assert.ok(isGravitationError(result))
    assert.match(result.message, /undefined rather than large/)
  })

  it('obeys Kepler third law', () => {
    const inner = at([1, 0], [0, 1])
    const outer = at([4, 0], [0, 0.5])
    // T² ∝ a³, so four times the radius is eight times the period.
    closeTo((outer.period as number) / (inner.period as number), 8, 1e-9)
  })
})

describe('circular and escape speeds', () => {
  it('makes escape speed root two times circular speed', () => {
    const circular = ok(circularSpeed(M, 3, G))
    const escape = ok(escapeSpeed(M, 3, G))
    closeTo(escape / circular, Math.SQRT2, 1e-12)
  })

  it('agrees with what an orbit at that speed turns out to be', () => {
    const speed = ok(circularSpeed(M, 5, G))
    assert.equal(ok(orbitFrom({ centralMass: M, position: vec(5, 0), velocity: vec(0, speed), constant: G })).shape, 'circular')
  })

  it('refuses a radius of zero', () => {
    assert.ok(isGravitationError(circularSpeed(M, 0, G)))
  })
})

describe('the path of an orbit', () => {
  it('closes exactly for an ellipse', () => {
    const orbit = ok(orbitFrom({ centralMass: M, position: vec(1, 0), velocity: vec(0, 0.7), constant: G }))
    const path = ok(orbitPath(orbit, 361))
    const first = path.points[0]
    const last = path.points[path.points.length - 1]
    closeTo(first?.radius as number, last?.radius as number, 1e-9)
    assert.ok(path.notes.some((one) => /closes exactly, which an integrated path never quite does/.test(one)))
  })

  it('has every point on the conic', () => {
    const orbit = ok(orbitFrom({ centralMass: M, position: vec(2, 0), velocity: vec(0, 0.6), constant: G }))
    const path = ok(orbitPath(orbit, 200))
    for (const point of path.points) {
      const nu = (point.trueAnomaly * Math.PI) / 180
      closeTo(point.radius, orbit.semiLatusRectum / (1 + orbit.eccentricity * Math.cos(nu)), 1e-9)
      closeTo(magnitude(point.position), point.radius, 1e-9)
    }
  })

  it('stops a hyperbola at its asymptote', () => {
    const orbit = ok(orbitFrom({ centralMass: M, position: vec(1, 0), velocity: vec(0, 2), constant: G }))
    const path = ok(orbitPath(orbit, 200))
    assert.ok(path.sweptDegrees < 360)
    assert.ok(path.notes.some((one) => /already infinitely far away/.test(one)))
    for (const point of path.points) assert.ok(Number.isFinite(point.radius))
  })

  it('refuses to draw a radial path', () => {
    const orbit = ok(orbitFrom({ centralMass: M, position: vec(1, 0), velocity: vec(-0.5, 0), constant: G }))
    assert.ok(isGravitationError(orbitPath(orbit)))
  })
})

describe('comparing orbits', () => {
  it('shows the period depending only on the semi-major axis', () => {
    // Two very different eccentricities with the same semi-major axis.
    const circular = ok(orbitFrom({ centralMass: M, position: vec(1, 0), velocity: vec(0, 1), constant: G }))
    const speedForSameAxis = Math.sqrt(2 * (-1 / (2 * 1) + 1 / 0.5))
    const eccentric = ok(orbitFrom({ centralMass: M, position: vec(0.5, 0), velocity: vec(0, speedForSameAxis), constant: G }))
    closeTo(eccentric.semiMajorAxis as number, 1, 1e-9)
    assert.ok(eccentric.eccentricity > 0.4)
    closeTo(eccentric.period as number, circular.period as number, 1e-8)

    const result = ok(compareOrbits([{ label: 'Circular', orbit: circular }, { label: 'Eccentric', orbit: eccentric }]))
    assert.ok(result.notes.some((one) => /Kepler/.test(one)))
  })

  it('leaves an unbound orbit blank rather than large', () => {
    const escape = ok(orbitFrom({ centralMass: M, position: vec(1, 0), velocity: vec(0, 2), constant: G }))
    const result = ok(compareOrbits([{ label: 'Flyby', orbit: escape }]))
    assert.equal(result.entries[0]?.period, null)
    assert.ok(result.notes.some((one) => /never comes back at all/.test(one)))
  })

  it('refuses an empty comparison', () => {
    assert.ok(isGravitationError(compareOrbits([])))
  })
})

describe('many bodies', () => {
  it('keeps a two-body pair in a stable orbit', () => {
    const pair = ok(orbitingPair({ mass1: 1, mass2: 1, separation: 1, constant: G }))
    const period = 2 * Math.PI * Math.sqrt(1 / (G * 2))
    const result = ok(nBody(pair, { constant: G, step: 0.0005, until: period * 5, samples: 500 }))
    assert.equal(result.run.status, 'complete')
    // After five whole periods they should be back where they started.
    const start = result.run.trace[0]
    closeTo(result.run.final.positions[0]?.x as number, start?.positions[0]?.x as number, 0.01)
    closeTo(result.run.final.positions[0]?.y as number, start?.positions[0]?.y as number, 0.01)
  })

  it('conserves energy, momentum and angular momentum', () => {
    const pair = ok(orbitingPair({ mass1: 3, mass2: 1, separation: 2, constant: G }))
    const result = ok(nBody(pair, { constant: G, step: 0.0005, until: 20, samples: 200 }))
    assert.ok(result.run.energy.relativeDrift < 1e-6, `energy drift ${result.run.energy.relativeDrift}`)
    assert.ok(result.angularMomentum.drift < 1e-9, `angular drift ${result.angularMomentum.drift}`)
    closeTo(result.run.momentum.final.x, result.run.momentum.initial.x, 1e-9)
  })

  it('keeps the centre of mass still when the total momentum is zero', () => {
    const pair = ok(orbitingPair({ mass1: 2, mass2: 5, separation: 3, constant: G }))
    const result = ok(nBody(pair, { constant: G, step: 0.001, until: 30 }))
    closeTo(result.centreOfMass.final.x, result.centreOfMass.initial.x, 1e-6)
    closeTo(result.centreOfMass.final.y, result.centreOfMass.initial.y, 1e-6)
  })

  it('runs three bodies without falling over', () => {
    const three = [
      makeBody({ id: 'a', mass: 1, position: vec(-1, 0), velocity: vec(0, -0.3) }),
      makeBody({ id: 'b', mass: 1, position: vec(1, 0), velocity: vec(0, 0.3) }),
      makeBody({ id: 'c', mass: 0.5, position: vec(0, 2), velocity: vec(0.4, 0) })
    ]
    const result = ok(nBody(three, { constant: G, softening: 0.05, step: 0.001, until: 20, samples: 200 }))
    assert.ok(result.run.trace.length > 50)
    for (const state of result.run.trace) {
      for (const at of state.positions) assert.ok(Number.isFinite(at.x) && Number.isFinite(at.y))
    }
  })

  it('says what softening costs when it is on, and what its absence risks', () => {
    const pair = ok(orbitingPair({ mass1: 1, mass2: 1, separation: 1, constant: G }))
    const soft = ok(nBody(pair, { constant: G, softening: 0.1, step: 0.001, until: 5 }))
    assert.ok(soft.notes.some((one) => /no longer the real answer/.test(one)))
    const hard = ok(nBody(pair, { constant: G, step: 0.001, until: 5 }))
    assert.ok(hard.notes.some((one) => /no step is small enough/.test(one)))
  })

  it('refuses a single body and too many', () => {
    assert.ok(isGravitationError(nBody([makeBody({ id: 'a', mass: 1 })], { step: 0.1, until: 1 })))
    const many = Array.from({ length: 501 }, (_, i) => makeBody({ id: `b${i}`, mass: 1, position: vec(i, 0) }))
    assert.ok(isGravitationError(nBody(many, { step: 0.1, until: 1 })))
  })

  it('builds a pair whose momentum cancels', () => {
    const pair = ok(orbitingPair({ mass1: 3, mass2: 7, separation: 4, constant: G }))
    const px = pair.reduce((total, one) => total + one.mass * one.velocity.x, 0)
    const py = pair.reduce((total, one) => total + one.mass * one.velocity.y, 0)
    closeTo(px, 0, 1e-12)
    closeTo(py, 0, 1e-12)
  })

  it('makes the pair separation match what was asked for', () => {
    const pair = ok(orbitingPair({ mass1: 3, mass2: 7, separation: 4, constant: G }))
    closeTo(magnitude(vec((pair[1]?.position.x ?? 0) - (pair[0]?.position.x ?? 0), 0)), 4, 1e-12)
  })
})
