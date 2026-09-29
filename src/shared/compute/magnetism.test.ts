import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  circularLoop,
  flux,
  inductance,
  induction,
  isMagnetismError,
  lorentzForce,
  motionalEmf,
  segmentField,
  solenoid,
  straightWire,
  trajectory,
  vec3,
  type MagnetismError
} from './magnetism.ts'
import { ELEMENTARY_CHARGE, ELECTRON_MASS, VACUUM_PERMEABILITY } from './emConstants.ts'

const ok = <T>(value: T): Exclude<T, MagnetismError> => {
  assert.ok(!isMagnetismError(value), isMagnetismError(value) ? value.message : '')
  return value as Exclude<T, MagnetismError>
}

const bad = (value: unknown): MagnetismError => {
  assert.ok(isMagnetismError(value), 'expected an error and got a result')
  return value
}

const closeTo = (actual: number, expected: number, tolerance: number, what = ''): void => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what} expected ${expected} within ${tolerance}, got ${actual}`)
}

describe('the field around a straight wire', () => {
  it('matches mu-nought-I over two-pi-r', () => {
    const report = ok(straightWire({ current: 10, distance: 0.1 }))
    closeTo(report.fieldStrength, (VACUUM_PERMEABILITY * 10) / (2 * Math.PI * 0.1), 1e-15)
  })

  it('falls off as one over r, not one over r squared', () => {
    const near = ok(straightWire({ current: 1, distance: 1 }))
    const far = ok(straightWire({ current: 1, distance: 2 }))
    closeTo(near.fieldStrength / far.fieldStrength, 2, 1e-12, 'doubling distance halves it')
  })

  it('circles the wire rather than pointing away from it', () => {
    const report = ok(straightWire({ current: 10, distance: 1, at: { x: 1, y: 0 } }))
    closeTo(report.direction.x, 0, 1e-12, 'no radial component')
    assert.ok(report.direction.y > 0, 'tangential, anticlockwise for current along +z')
  })

  it('refuses the wire itself', () => {
    assert.equal(bad(straightWire({ current: 1, distance: 0 })).error, 'on-the-wire')
  })
})

describe('a current loop', () => {
  it('is strongest at the centre', () => {
    const centre = ok(circularLoop({ current: 5, radius: 0.1, axialDistance: 0 }))
    const away = ok(circularLoop({ current: 5, radius: 0.1, axialDistance: 0.1 }))
    assert.ok(centre.fieldStrength > away.fieldStrength)
    closeTo(centre.fieldStrength, (VACUUM_PERMEABILITY * 5) / (2 * 0.1), 1e-15)
  })

  it('falls off as one over z cubed far away, like a dipole', () => {
    const near = ok(circularLoop({ current: 1, radius: 0.01, axialDistance: 1 }))
    const far = ok(circularLoop({ current: 1, radius: 0.01, axialDistance: 2 }))
    closeTo(near.fieldStrength / far.fieldStrength, 8, 0.01, 'doubling z divides by eight')
  })

  it('scales with turns', () => {
    const one = ok(circularLoop({ current: 1, radius: 0.1 }))
    const ten = ok(circularLoop({ current: 1, radius: 0.1, turns: 10 }))
    closeTo(ten.fieldStrength / one.fieldStrength, 10, 1e-12)
  })

  it('reports a magnetic moment of I times area', () => {
    const report = ok(circularLoop({ current: 2, radius: 0.1 }))
    closeTo(report.magneticMoment, 2 * Math.PI * 0.01, 1e-12)
  })
})

describe('a solenoid', () => {
  it('follows mu-nought n I inside', () => {
    const report = ok(solenoid({ current: 2, turns: 1000, length: 0.5 }))
    closeTo(report.turnDensity, 2000, 1e-9)
    closeTo(report.fieldInside, VACUUM_PERMEABILITY * 2000 * 2, 1e-12)
  })

  it('is half as strong at the end', () => {
    const report = ok(solenoid({ current: 2, turns: 1000, length: 0.5 }))
    closeTo(report.fieldAtEnd, report.fieldInside / 2, 1e-15)
  })

  it('warns when it is too short for the formula', () => {
    const report = ok(solenoid({ current: 1, turns: 10, length: 0.01, radius: 0.05 }))
    assert.ok(report.notes.some((one) => /overstates/.test(one)))
  })

  it('gives an inductance only when it knows the radius', () => {
    assert.equal(ok(solenoid({ current: 1, turns: 100, length: 0.1 })).inductance, null)
    assert.ok((ok(solenoid({ current: 1, turns: 100, length: 0.1, radius: 0.01 })).inductance ?? 0) > 0)
  })
})

describe('Biot-Savart over segments', () => {
  it('reproduces the straight-wire formula for a long wire', () => {
    // A wire from -500 m to +500 m is effectively infinite at 0.1 m away.
    const numeric = ok(
      segmentField([{ from: vec3(0, 0, -500), to: vec3(0, 0, 500), current: 10 }], vec3(0.1, 0, 0), 2000)
    )
    const analytic = ok(straightWire({ current: 10, distance: 0.1 }))
    closeTo(numeric.field.magnitude / analytic.fieldStrength, 1, 0.01, 'within a percent of the closed form')
  })

  it('reports how finely it actually divided the segments, refinement included', () => {
    const report = ok(segmentField([{ from: vec3(0, 0, -1), to: vec3(0, 0, 1), current: 1 }], vec3(1, 0, 0), 50))
    assert.ok(report.pieces >= 50, 'never fewer than asked for')
    assert.ok(report.notes.some((one) => /subdivided further/.test(one)))
  })

  it('refines near the wire rather than trusting a uniform division', () => {
    // Close in, a coarse uniform split is badly wrong; the refinement is what rescues it.
    const coarse = ok(segmentField([{ from: vec3(0, 0, -200), to: vec3(0, 0, 200), current: 5 }], vec3(0.05, 0, 0), 10))
    const analytic = ok(straightWire({ current: 5, distance: 0.05 }))
    closeTo(coarse.field.magnitude / analytic.fieldStrength, 1, 0.02, 'accurate from only ten starting pieces')
    assert.ok(coarse.pieces > 10, 'because it subdivided')
  })

  it('refuses a point on the wire', () => {
    assert.equal(
      bad(segmentField([{ from: vec3(0, 0, -1), to: vec3(0, 0, 1), current: 1 }], vec3(0, 0, 0), 100)).error,
      'on-the-wire'
    )
  })
})

describe('the Lorentz force', () => {
  it('keeps the electric and magnetic parts separate', () => {
    const report = ok(
      lorentzForce({ charge: 1, velocity: vec3(1, 0, 0), electricField: vec3(0, 0, 1), magneticField: vec3(0, 1, 0) })
    )
    closeTo(report.electricForce.z, 1, 1e-12)
    // v x B = (1,0,0) x (0,1,0) = (0,0,1)
    closeTo(report.magneticForce.z, 1, 1e-12)
    closeTo(report.totalForce.z, 2, 1e-12)
  })

  it('proves the magnetic force does no work', () => {
    const report = ok(lorentzForce({ charge: 3, velocity: vec3(2, 1, 0.5), magneticField: vec3(0.3, -1, 2) }))
    closeTo(report.powerFromMagnetic, 0, 1e-12, 'always exactly zero')
    assert.ok(report.notes.some((one) => /cannot change a speed/.test(one)))
  })

  it('gives no magnetic force when the velocity is along the field', () => {
    const report = ok(lorentzForce({ charge: 1, velocity: vec3(0, 0, 5), magneticField: vec3(0, 0, 2) }))
    closeTo(report.magneticForce.magnitude, 0, 1e-12)
    assert.ok(report.notes.some((one) => /almost exactly along the field/.test(one)))
  })
})

describe('a charged particle in a magnetic field', () => {
  it('has a cyclotron frequency independent of speed', () => {
    const slow = ok(
      trajectory({ particle: 'electron', initialVelocity: vec3(1e5, 0, 0), magneticField: vec3(0, 0, 0.01), duration: 1e-8 })
    )
    const fast = ok(
      trajectory({ particle: 'electron', initialVelocity: vec3(1e6, 0, 0), magneticField: vec3(0, 0, 0.01), duration: 1e-8 })
    )
    closeTo(slow.cyclotronFrequency ?? 0, fast.cyclotronFrequency ?? 0, 1e-6, 'same frequency')
    assert.ok((fast.gyroradius ?? 0) > (slow.gyroradius ?? 0) * 9, 'bigger circle though')
  })

  it('matches the textbook cyclotron frequency for an electron', () => {
    const report = ok(
      trajectory({ particle: 'electron', initialVelocity: vec3(1e6, 0, 0), magneticField: vec3(0, 0, 1), duration: 1e-11 })
    )
    closeTo(report.cyclotronAngular ?? 0, ELEMENTARY_CHARGE / ELECTRON_MASS, 1e3)
  })

  it('conserves energy through many orbits, which a naive integrator would not', () => {
    const report = ok(
      trajectory({
        particle: 'proton',
        initialVelocity: vec3(1e5, 0, 0),
        magneticField: vec3(0, 0, 0.5),
        duration: 1e-5,
        samples: 200
      })
    )
    assert.ok(report.energyDrift < 1e-9, `energy drifted by ${report.energyDrift}`)
  })

  it('names circular, helical and drift motion correctly', () => {
    const circular = ok(
      trajectory({ particle: 'proton', initialVelocity: vec3(1e5, 0, 0), magneticField: vec3(0, 0, 1), duration: 1e-7 })
    )
    assert.equal(circular.motion, 'circular')
    const helical = ok(
      trajectory({ particle: 'proton', initialVelocity: vec3(1e5, 0, 1e5), magneticField: vec3(0, 0, 1), duration: 1e-7 })
    )
    assert.equal(helical.motion, 'helical')
    const drift = ok(
      trajectory({
        particle: 'proton',
        initialVelocity: vec3(1e5, 0, 0),
        magneticField: vec3(0, 0, 1),
        electricField: vec3(0, 100, 0),
        duration: 1e-7
      })
    )
    assert.equal(drift.motion, 'drift')
  })

  it('needs both charge and mass for a custom particle', () => {
    assert.match(
      bad(trajectory({ particle: 'custom', charge: 1, initialVelocity: vec3(1, 0, 0), duration: 1 })).message,
      /both a charge and a mass/
    )
  })
})

describe('flux', () => {
  it('measures the angle to the normal, not to the surface', () => {
    const face = ok(flux({ fieldStrength: 2, area: 0.5, angleDegrees: 0 }))
    const edge = ok(flux({ fieldStrength: 2, area: 0.5, angleDegrees: 90 }))
    closeTo(face.flux, 1, 1e-12, 'maximum when the field is along the normal')
    closeTo(edge.flux, 0, 1e-12, 'zero when the field lies in the plane of the loop')
  })

  it('multiplies by the turns for linkage', () => {
    const report = ok(flux({ fieldStrength: 1, area: 1, turns: 50 }))
    closeTo(report.linkage, 50, 1e-12)
  })
})

describe('induction keeps the sign', () => {
  it('gives an emf opposing a rising flux', () => {
    const report = ok(induction({ fluxChange: 0.5, timeInterval: 0.1, turns: 100 }))
    closeTo(report.emf, -500, 1e-9, 'negative: the minus sign is Lenz')
    assert.match(report.opposes, /increasing/)
  })

  it('reverses for a falling flux', () => {
    const report = ok(induction({ fluxChange: -0.5, timeInterval: 0.1, turns: 100 }))
    closeTo(report.emf, 500, 1e-9)
    assert.match(report.opposes, /falling/)
  })

  it('induces nothing from a steady field', () => {
    const report = ok(induction({ fluxChange: 0, timeInterval: 1 }))
    closeTo(report.emf, 0, 1e-15)
    assert.match(report.opposes, /not changing/)
  })

  it('refuses a zero time interval', () => {
    assert.equal(bad(induction({ fluxChange: 1, timeInterval: 0 })).error, 'invalid-argument')
  })
})

describe('a rod on rails', () => {
  it('balances the mechanical power against the electrical', () => {
    const report = ok(motionalEmf({ fieldStrength: 0.5, rodLength: 0.2, speed: 4, circuitResistance: 2 }))
    closeTo(report.emf, 0.4, 1e-12)
    closeTo(report.current ?? 0, 0.2, 1e-12)
    const mechanical = (report.retardingForce ?? 0) * 4
    closeTo(mechanical, report.powerDissipated ?? 0, 1e-12, 'push power equals heat')
  })
})

describe('inductance', () => {
  it('caps mutual inductance at the geometric mean', () => {
    const perfect = ok(inductance({ selfInductance: 4e-3, secondInductance: 1e-3, couplingCoefficient: 1 }))
    closeTo(perfect.mutualInductance ?? 0, 2e-3, 1e-15)
    const half = ok(inductance({ selfInductance: 4e-3, secondInductance: 1e-3, couplingCoefficient: 0.5 }))
    closeTo(half.mutualInductance ?? 0, 1e-3, 1e-15)
  })

  it('refuses a coupling coefficient above one', () => {
    assert.match(
      bad(inductance({ selfInductance: 1e-3, secondInductance: 1e-3, couplingCoefficient: 1.5 })).message,
      /between 0 and 1/
    )
  })

  it('stores half L I squared', () => {
    const report = ok(inductance({ selfInductance: 2e-3, current: 3 }))
    closeTo(report.energy ?? 0, 0.5 * 2e-3 * 9, 1e-15)
  })

  it('opposes a rising current', () => {
    const report = ok(inductance({ selfInductance: 1e-3, currentRate: 1000 }))
    closeTo(report.inducedEmf ?? 0, -1, 1e-12)
  })
})
