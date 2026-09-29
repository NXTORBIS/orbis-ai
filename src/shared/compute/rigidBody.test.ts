import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  compositeBody,
  inertiaOf,
  isRigidBodyError,
  rollingDownSlope,
  rollingRace,
  SHAPES,
  SHAPE_FACTS,
  shiftAxis,
  spinUnderTorque,
  torqueFrom,
  type RigidBodyError
} from './rigidBody.ts'
import { vec } from './mechanics.ts'

const ok = <T>(value: T): Exclude<T, RigidBodyError> => {
  assert.ok(!isRigidBodyError(value), isRigidBodyError(value) ? value.message : '')
  return value as Exclude<T, RigidBodyError>
}

const closeTo = (actual: number, expected: number, tolerance: number, what = ''): void => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what} expected ${expected} within ${tolerance}, got ${actual}`)
}

const G = 9.81

describe('moments of inertia', () => {
  it('gets the standard formulas right', () => {
    closeTo(ok(inertiaOf({ shape: 'point-mass', mass: 3, size: 2 })).value, 12, 1e-12)
    closeTo(ok(inertiaOf({ shape: 'rod-centre', mass: 12, size: 2 })).value, 4, 1e-12)
    closeTo(ok(inertiaOf({ shape: 'rod-end', mass: 3, size: 2 })).value, 4, 1e-12)
    closeTo(ok(inertiaOf({ shape: 'solid-disc', mass: 4, size: 3 })).value, 18, 1e-12)
    closeTo(ok(inertiaOf({ shape: 'ring', mass: 4, size: 3 })).value, 36, 1e-12)
    closeTo(ok(inertiaOf({ shape: 'solid-sphere', mass: 5, size: 2 })).value, 8, 1e-12)
    closeTo(ok(inertiaOf({ shape: 'hollow-sphere', mass: 3, size: 2 })).value, 8, 1e-12)
    closeTo(ok(inertiaOf({ shape: 'rectangle', mass: 12, size: 3, secondSize: 4 })).value, 25, 1e-12)
  })

  it('carries the axis with the number', () => {
    const centre = ok(inertiaOf({ shape: 'rod-centre', mass: 1, size: 1 }))
    const end = ok(inertiaOf({ shape: 'rod-end', mass: 1, size: 1 }))
    assert.notEqual(centre.axis, end.axis)
    assert.ok(centre.notes.some((one) => /not a property of the object alone/.test(one)))
  })

  it('makes a rod four times harder to swing from its end', () => {
    const centre = ok(inertiaOf({ shape: 'rod-centre', mass: 2, size: 3 }))
    const end = ok(inertiaOf({ shape: 'rod-end', mass: 2, size: 3 }))
    closeTo(end.value / centre.value, 4, 1e-12)
  })

  it('has facts for every shape it lists', () => {
    for (const shape of SHAPES) {
      assert.ok(SHAPE_FACTS[shape].describe.length > 20, shape)
      assert.ok(SHAPE_FACTS[shape].axis.length > 5, shape)
      assert.ok(SHAPE_FACTS[shape].formula.includes('I ='), shape)
    }
  })

  it('orders the round shapes by how much mass sits at the rim', () => {
    const factor = (shape: (typeof SHAPES)[number]): number => SHAPE_FACTS[shape].inertiaFactor ?? 0
    assert.ok(factor('solid-sphere') < factor('solid-disc'))
    assert.ok(factor('solid-disc') < factor('hollow-sphere'))
    assert.ok(factor('hollow-sphere') < factor('ring'))
  })

  it('reports the radius of gyration', () => {
    const disc = ok(inertiaOf({ shape: 'solid-disc', mass: 4, size: 2 }))
    // I = mR²/2 = 8, so k = √(8/4) = √2.
    closeTo(disc.radiusOfGyration, Math.SQRT2, 1e-12)
  })

  it('needs both sides for a rectangle', () => {
    assert.ok(isRigidBodyError(inertiaOf({ shape: 'rectangle', mass: 1, size: 1 })))
  })

  it('refuses a shape it does not know and a massless one', () => {
    assert.ok(isRigidBodyError(inertiaOf({ shape: 'torus' as never, mass: 1, size: 1 })))
    assert.ok(isRigidBodyError(inertiaOf({ shape: 'ring', mass: 0, size: 1 })))
  })
})

describe('the parallel-axis theorem', () => {
  it('turns a rod about its centre into a rod about its end', () => {
    const centre = ok(inertiaOf({ shape: 'rod-centre', mass: 3, size: 2 }))
    const shifted = ok(shiftAxis({ aboutCentreOfMass: centre.value, mass: 3, distance: 1 }))
    const end = ok(inertiaOf({ shape: 'rod-end', mass: 3, size: 2 }))
    closeTo(shifted.aboutNewAxis, end.value, 1e-12)
  })

  it('only ever adds', () => {
    for (const distance of [-3, -0.5, 0, 0.5, 3]) {
      const result = ok(shiftAxis({ aboutCentreOfMass: 5, mass: 2, distance }))
      assert.ok(result.added >= 0, `distance ${distance}`)
      assert.ok(result.aboutNewAxis >= result.aboutCentre)
    }
  })

  it('says why the centre of mass is the easiest axis', () => {
    const result = ok(shiftAxis({ aboutCentreOfMass: 1, mass: 1, distance: 2 }))
    assert.match(result.why, /anything thrown tumbles about its centre of mass/)
  })

  it('refuses a negative moment of inertia', () => {
    assert.ok(isRigidBodyError(shiftAxis({ aboutCentreOfMass: -1, mass: 1, distance: 1 })))
  })
})

describe('composite bodies', () => {
  it('finds the centre of mass and the total inertia', () => {
    const result = ok(
      compositeBody([
        { label: 'left', mass: 1, inertiaAboutOwnCentre: 0, position: vec(-2, 0) },
        { label: 'right', mass: 1, inertiaAboutOwnCentre: 0, position: vec(2, 0) }
      ])
    )
    closeTo(result.centreOfMass.x, 0, 1e-12)
    // Two point masses at 2 from the centre: I = 2 × 1 × 4 = 8.
    closeTo(result.inertia, 8, 1e-12)
  })

  it('puts the centre of mass nearer the heavier part', () => {
    const result = ok(
      compositeBody([
        { label: 'light', mass: 1, inertiaAboutOwnCentre: 0, position: vec(0, 0) },
        { label: 'heavy', mass: 3, inertiaAboutOwnCentre: 0, position: vec(4, 0) }
      ])
    )
    closeTo(result.centreOfMass.x, 3, 1e-12)
  })

  it('separates each part own inertia from its position term', () => {
    const disc = ok(inertiaOf({ shape: 'solid-disc', mass: 2, size: 0.1 }))
    const result = ok(
      compositeBody([
        { label: 'hub', mass: 2, inertiaAboutOwnCentre: disc.value, position: vec(0, 0) },
        { label: 'weight', mass: 2, inertiaAboutOwnCentre: disc.value, position: vec(5, 0) }
      ])
    )
    const far = result.parts.find((one) => one.label === 'weight')
    assert.ok((far?.contributed ?? 0) > (far?.ownInertia ?? 0) * 100)
    assert.ok(result.notes.some((one) => /the position matters far more than the shape/.test(one)))
  })

  it('reduces to the single part when there is one', () => {
    const result = ok(compositeBody([{ label: 'only', mass: 5, inertiaAboutOwnCentre: 7, position: vec(3, 4) }]))
    closeTo(result.inertia, 7, 1e-12)
    closeTo(result.centreOfMass.x, 3, 1e-12)
  })

  it('refuses no parts and a massless part', () => {
    assert.ok(isRigidBodyError(compositeBody([])))
    assert.ok(isRigidBodyError(compositeBody([{ label: 'a', mass: 0, inertiaAboutOwnCentre: 0, position: vec(0, 0) }])))
  })
})

describe('torque', () => {
  it('turns a perpendicular force by force times distance', () => {
    const result = ok(torqueFrom({ pivot: vec(0, 0), applicationPoint: vec(2, 0), force: vec(0, 5) }))
    closeTo(result.torque, 10, 1e-12)
    closeTo(result.momentArm, 2, 1e-12)
    closeTo(result.wastedForce, 0, 1e-12)
  })

  it('gives a force pointed at the pivot no turning effect at all', () => {
    const result = ok(torqueFrom({ pivot: vec(0, 0), applicationPoint: vec(3, 0), force: vec(-1000, 0) }))
    closeTo(result.torque, 0, 1e-12)
    assert.match(result.why, /does not close it, however hard/)
    closeTo(result.wastedForce, 1000, 1e-9)
  })

  it('uses only the perpendicular component of an angled force', () => {
    const result = ok(torqueFrom({ pivot: vec(0, 0), applicationPoint: vec(2, 0), force: vec(3, 4) }))
    // Only the y component turns it: 2 × 4 = 8.
    closeTo(result.torque, 8, 1e-12)
    closeTo(result.effectiveForce, 4, 1e-9)
    closeTo(result.wastedForce, 3, 1e-9)
  })

  it('signs anticlockwise positive', () => {
    assert.ok(ok(torqueFrom({ pivot: vec(0, 0), applicationPoint: vec(1, 0), force: vec(0, 1) })).torque > 0)
    assert.ok(ok(torqueFrom({ pivot: vec(0, 0), applicationPoint: vec(1, 0), force: vec(0, -1) })).torque < 0)
  })

  it('gives a force applied at the pivot nothing to act on', () => {
    const result = ok(torqueFrom({ pivot: vec(1, 1), applicationPoint: vec(1, 1), force: vec(5, 5) }))
    assert.equal(result.torque, 0)
    assert.match(result.why, /no lever arm/)
  })
})

describe('spinning under torque', () => {
  it('follows the rotational form of F = ma', () => {
    const result = ok(spinUnderTorque({ inertia: 4, torque: 8, time: 3 }))
    closeTo(result.angularAcceleration, 2, 1e-12)
    closeTo(result.angularVelocity, 6, 1e-12)
    closeTo(result.angle, 9, 1e-12)
  })

  it('reports angular momentum and rotational energy', () => {
    const result = ok(spinUnderTorque({ inertia: 4, torque: 0, initialAngularVelocity: 5, time: 10 }))
    closeTo(result.angularVelocity, 5, 1e-12, 'no torque, no change')
    closeTo(result.angularMomentum, 20, 1e-12)
    closeTo(result.rotationalEnergy, 50, 1e-12)
  })

  it('refuses a body with no moment of inertia', () => {
    assert.ok(isRigidBodyError(spinUnderTorque({ inertia: 0, torque: 1, time: 1 })))
  })
})

describe('rolling', () => {
  it('gets the classic accelerations', () => {
    const sphere = ok(rollingDownSlope({ shape: 'solid-sphere', slopeDegrees: 30, gravity: G }))
    const disc = ok(rollingDownSlope({ shape: 'solid-disc', slopeDegrees: 30, gravity: G }))
    const hoop = ok(rollingDownSlope({ shape: 'ring', slopeDegrees: 30, gravity: G }))
    const sin30 = Math.sin(Math.PI / 6)
    closeTo(sphere.acceleration, (G * sin30) / 1.4, 1e-9)
    closeTo(disc.acceleration, (G * sin30) / 1.5, 1e-9)
    closeTo(hoop.acceleration, (G * sin30) / 2, 1e-9)
  })

  it('does not depend on the mass or the radius', () => {
    const result = ok(rollingDownSlope({ shape: 'solid-sphere', slopeDegrees: 20, gravity: G }))
    assert.ok(result.notes.some((one) => /Neither the mass nor the radius appears anywhere/.test(one)))
    // The function takes no mass and no radius at all, which is the point.
    assert.ok(!Object.prototype.hasOwnProperty.call(result, 'mass'))
  })

  it('splits the energy by shape alone', () => {
    const hoop = ok(rollingDownSlope({ shape: 'ring', slopeDegrees: 30, gravity: G }))
    // I/mR² = 1, so the energy splits evenly.
    closeTo(hoop.energySplit.translational, 0.5, 1e-12)
    closeTo(hoop.energySplit.rotational, 0.5, 1e-12)

    const sphere = ok(rollingDownSlope({ shape: 'solid-sphere', slopeDegrees: 30, gravity: G }))
    closeTo(sphere.energySplit.translational, 1 / 1.4, 1e-12)
  })

  it('works out the friction rolling needs, and checks the one given', () => {
    const steep = ok(rollingDownSlope({ shape: 'ring', slopeDegrees: 45, gravity: G, frictionCoefficient: 0.1 }))
    // For a hoop: μ ≥ (1/2)·tan45 = 0.5.
    closeTo(steep.frictionNeeded, 0.5, 1e-9)
    assert.equal(steep.rolls, false)
    assert.ok(steep.notes.some((one) => /the acceleration above is wrong for it/.test(one)))

    const enough = ok(rollingDownSlope({ shape: 'ring', slopeDegrees: 45, gravity: G, frictionCoefficient: 0.6 }))
    assert.equal(enough.rolls, true)
  })

  it('leaves the rolling question open when no friction was given', () => {
    assert.equal(ok(rollingDownSlope({ shape: 'solid-disc', slopeDegrees: 20, gravity: G })).rolls, null)
  })

  it('needs less friction on a gentler slope', () => {
    const gentle = ok(rollingDownSlope({ shape: 'solid-disc', slopeDegrees: 5, gravity: G }))
    const steep = ok(rollingDownSlope({ shape: 'solid-disc', slopeDegrees: 60, gravity: G }))
    assert.ok(gentle.frictionNeeded < steep.frictionNeeded)
  })

  it('gives the speed after a drop, slower than a sliding object', () => {
    const sphere = ok(rollingDownSlope({ shape: 'solid-sphere', slopeDegrees: 30, gravity: G, dropHeight: 2 }))
    const sliding = Math.sqrt(2 * G * 2)
    assert.ok((sphere.speedAfterDrop as number) < sliding)
    closeTo(sphere.speedAfterDrop as number, Math.sqrt((2 * G * 2) / 1.4), 1e-9)
  })

  it('refuses to roll a rod or a plate, and says which shapes roll', () => {
    const result = rollingDownSlope({ shape: 'rod-centre', slopeDegrees: 30, gravity: G })
    assert.ok(isRigidBodyError(result))
    assert.match(result.message, /needs a circular cross-section/)
    assert.match(result.message, /solid-sphere/)
  })

  it('refuses a vertical or flat slope', () => {
    assert.ok(isRigidBodyError(rollingDownSlope({ shape: 'ring', slopeDegrees: 0, gravity: G })))
    assert.ok(isRigidBodyError(rollingDownSlope({ shape: 'ring', slopeDegrees: 90, gravity: G })))
  })
})

describe('the rolling race', () => {
  it('always finishes in the same order', () => {
    const result = ok(
      rollingRace({
        shapes: ['ring', 'solid-sphere', 'hollow-sphere', 'solid-disc'],
        slopeDegrees: 25,
        gravity: G,
        distance: 5
      })
    )
    assert.deepEqual(
      result.order.map((one) => one.shape),
      ['solid-sphere', 'solid-disc', 'hollow-sphere', 'ring']
    )
  })

  it('gives the same order on a different slope and over a different distance', () => {
    const gentle = ok(rollingRace({ shapes: ['ring', 'solid-sphere', 'solid-disc'], slopeDegrees: 3, gravity: G, distance: 100 }))
    const steep = ok(rollingRace({ shapes: ['ring', 'solid-sphere', 'solid-disc'], slopeDegrees: 70, gravity: G, distance: 0.5 }))
    assert.deepEqual(gentle.order.map((one) => one.shape), steep.order.map((one) => one.shape))
  })

  it('says the order is the shape and nothing else', () => {
    const result = ok(rollingRace({ shapes: ['ring', 'solid-sphere'], slopeDegrees: 25, gravity: G, distance: 5 }))
    assert.ok(result.notes.some((one) => /Mass and radius cancel out of the equation entirely/.test(one)))
    assert.ok(result.notes.some((one) => /then the order can change/.test(one)))
  })

  it('refuses an empty race and a shape that does not roll', () => {
    assert.ok(isRigidBodyError(rollingRace({ shapes: [], slopeDegrees: 25, gravity: G, distance: 5 })))
    assert.ok(isRigidBodyError(rollingRace({ shapes: ['rectangle'], slopeDegrees: 25, gravity: G, distance: 5 })))
  })
})
