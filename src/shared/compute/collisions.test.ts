import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  centreOfMassView,
  glancingCollision,
  headOnCollision,
  isCollisionError,
  restitutionFrom,
  timeToContact,
  type CollisionError,
  type Disc
} from './collisions.ts'
import { magnitude, vec } from './mechanics.ts'

const ok = <T>(value: T): Exclude<T, CollisionError> => {
  assert.ok(!isCollisionError(value), isCollisionError(value) ? value.message : '')
  return value as Exclude<T, CollisionError>
}

const closeTo = (actual: number, expected: number, tolerance: number, what = ''): void => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what} expected ${expected} within ${tolerance}, got ${actual}`)
}

const disc = (one: Partial<Disc> & { mass: number }): Disc => ({
  mass: one.mass,
  position: one.position ?? vec(0, 0),
  velocity: one.velocity ?? vec(0, 0),
  radius: one.radius ?? 1
})

describe('head-on collisions', () => {
  it('makes equal masses exchange velocities when elastic', () => {
    const result = ok(headOnCollision({ mass1: 1, velocity1: 5, mass2: 1, velocity2: -3, restitution: 1 }))
    closeTo(result.after.velocity1, -3, 1e-12)
    closeTo(result.after.velocity2, 5, 1e-12)
    assert.ok(result.notes.some((one) => /simply exchange velocities/.test(one)))
  })

  it('brings both to the same velocity when perfectly inelastic', () => {
    const result = ok(headOnCollision({ mass1: 2, velocity1: 6, mass2: 4, velocity2: 0, restitution: 0 }))
    closeTo(result.after.velocity1, 2, 1e-12)
    closeTo(result.after.velocity2, 2, 1e-12)
    closeTo(result.centreOfMassVelocity, 2, 1e-12)
  })

  it('conserves momentum at every restitution', () => {
    for (const restitution of [0, 0.25, 0.5, 0.75, 1]) {
      const result = ok(headOnCollision({ mass1: 3, velocity1: 7, mass2: 5, velocity2: -2, restitution }))
      closeTo(result.audit.momentumChange, 0, 1e-12, `restitution ${restitution}`)
    }
  })

  it('conserves kinetic energy only when elastic', () => {
    const elastic = ok(headOnCollision({ mass1: 3, velocity1: 7, mass2: 5, velocity2: -2, restitution: 1 }))
    assert.equal(elastic.audit.elastic, true)
    closeTo(elastic.audit.kineticEnergyLost, 0, 1e-9)

    const sticky = ok(headOnCollision({ mass1: 3, velocity1: 7, mass2: 5, velocity2: -2, restitution: 0 }))
    assert.equal(sticky.audit.elastic, false)
    assert.ok(sticky.audit.kineticEnergyLost > 0)
  })

  it('calls the lost energy physics rather than an error', () => {
    const result = ok(headOnCollision({ mass1: 1, velocity1: 10, mass2: 1, velocity2: 0, restitution: 0 }))
    assert.match(result.audit.why, /rather than an error in working it out/)
    assert.ok(!/error/i.test(JSON.stringify(result.audit.kineticEnergyLost)))
  })

  it('loses the most energy when perfectly inelastic', () => {
    const lost = (restitution: number): number =>
      ok(headOnCollision({ mass1: 2, velocity1: 8, mass2: 3, velocity2: -1, restitution })).audit.kineticEnergyLost
    assert.ok(lost(0) > lost(0.5))
    assert.ok(lost(0.5) > lost(1) + 1e-12)
    closeTo(lost(1), 0, 1e-9)
  })

  it('makes the separation speed the restitution times the approach speed', () => {
    for (const restitution of [0, 0.3, 0.9, 1]) {
      const result = ok(headOnCollision({ mass1: 2, velocity1: 9, mass2: 7, velocity2: 1, restitution }))
      closeTo(result.separationSpeed, restitution * result.approachSpeed, 1e-12, `restitution ${restitution}`)
    }
  })

  it('never changes the centre-of-mass velocity', () => {
    for (const restitution of [0, 0.4, 1]) {
      const result = ok(headOnCollision({ mass1: 4, velocity1: 3, mass2: 1, velocity2: -8, restitution }))
      const after = (4 * result.after.velocity1 + 1 * result.after.velocity2) / 5
      closeTo(after, result.centreOfMassVelocity, 1e-12)
    }
  })

  it('bounces a light body off a heavy one at nearly its own speed', () => {
    const result = ok(headOnCollision({ mass1: 0.01, velocity1: 10, mass2: 1000, velocity2: 0, restitution: 1 }))
    closeTo(result.after.velocity1, -10, 0.01)
    assert.ok(Math.abs(result.after.velocity2) > 0, 'and the heavy one does move, however little')
    assert.ok(result.notes.some((one) => /it does move, and it has to for momentum to balance/.test(one)))
  })

  it('refuses a restitution above one, and says what that would need', () => {
    const result = headOnCollision({ mass1: 1, velocity1: 1, mass2: 1, velocity2: 0, restitution: 1.2 })
    assert.ok(isCollisionError(result))
    assert.equal(result.error, 'creates-energy')
    assert.match(result.message, /a spring, an explosion or a motor/)
  })

  it('refuses a negative restitution and a massless body', () => {
    assert.ok(isCollisionError(headOnCollision({ mass1: 1, velocity1: 1, mass2: 1, velocity2: 0, restitution: -0.5 })))
    assert.ok(isCollisionError(headOnCollision({ mass1: 0, velocity1: 1, mass2: 1, velocity2: 0, restitution: 1 })))
  })

  it('says when the two were not closing at all', () => {
    const result = ok(headOnCollision({ mass1: 1, velocity1: 2, mass2: 1, velocity2: 2, restitution: 1 }))
    assert.ok(result.notes.some((one) => /nothing to collide/.test(one)))
    closeTo(result.after.velocity1, 2, 1e-12)
  })
})

describe('glancing collisions', () => {
  it('leaves the tangential component untouched', () => {
    // Approaching along x, offset in y so the normal is not along the motion.
    const a = disc({ mass: 1, position: vec(-2, -0.5), velocity: vec(4, 0) })
    const b = disc({ mass: 1, position: vec(0, 0.5), velocity: vec(0, 0) })
    const result = ok(glancingCollision(a, b, 1))
    // The tangential relative speed is the same before and after.
    const tangent = vec(-result.normal.y, result.normal.x)
    const before = (a.velocity.x - b.velocity.x) * tangent.x + (a.velocity.y - b.velocity.y) * tangent.y
    const after =
      (result.after[0].x - result.after[1].x) * tangent.x + (result.after[0].y - result.after[1].y) * tangent.y
    closeTo(after, before, 1e-12)
  })

  it('conserves momentum and, when elastic, energy', () => {
    const a = disc({ mass: 2, position: vec(-3, -1), velocity: vec(5, 1) })
    const b = disc({ mass: 3, position: vec(0, 0.4), velocity: vec(-1, 0.5) })
    const result = ok(glancingCollision(a, b, 1))
    closeTo(result.audit.momentumChange, 0, 1e-12)
    closeTo(result.audit.kineticEnergyLost, 0, 1e-9)
    assert.equal(result.audit.elastic, true)
  })

  it('loses energy when not elastic, while keeping momentum', () => {
    const a = disc({ mass: 2, position: vec(-3, -1), velocity: vec(5, 1) })
    const b = disc({ mass: 3, position: vec(0, 0.4), velocity: vec(-1, 0.5) })
    const result = ok(glancingCollision(a, b, 0.4))
    closeTo(result.audit.momentumChange, 0, 1e-12)
    assert.ok(result.audit.kineticEnergyLost > 0)
  })

  it('reduces to the head-on case when the centres line up with the motion', () => {
    const a = disc({ mass: 1, position: vec(-2, 0), velocity: vec(4, 0) })
    const b = disc({ mass: 1, position: vec(0, 0), velocity: vec(0, 0) })
    const glancing = ok(glancingCollision(a, b, 1))
    const straight = ok(headOnCollision({ mass1: 1, velocity1: 4, mass2: 1, velocity2: 0, restitution: 1 }))
    closeTo(glancing.after[0].x, straight.after.velocity1, 1e-12)
    closeTo(glancing.after[1].x, straight.after.velocity2, 1e-12)
    closeTo(glancing.after[0].y, 0, 1e-12)
  })

  it('says the contact is smooth, so nothing is spun up', () => {
    const result = ok(glancingCollision(disc({ mass: 1, position: vec(-2, -1) }), disc({ mass: 1, position: vec(0, 0) }), 1))
    assert.ok(result.notes.some((one) => /would put some of that sliding into rotation/.test(one)))
  })

  it('refuses two centres in the same place', () => {
    const result = glancingCollision(disc({ mass: 1 }), disc({ mass: 1 }), 1)
    assert.ok(isCollisionError(result))
    assert.equal(result.error, 'no-contact')
  })

  it('calls it a glancing blow when the sliding dominates', () => {
    const a = disc({ mass: 1, position: vec(0, -1), velocity: vec(10, 0.01) })
    const b = disc({ mass: 1, position: vec(0, 0), velocity: vec(0, 0) })
    const result = ok(glancingCollision(a, b, 1))
    assert.ok(result.notes.some((one) => /glancing blow/.test(one)))
  })
})

describe('when they touch', () => {
  it('finds the contact time for two closing discs', () => {
    const a = disc({ mass: 1, position: vec(0, 0), velocity: vec(1, 0), radius: 1 })
    const b = disc({ mass: 1, position: vec(10, 0), velocity: vec(-1, 0), radius: 1 })
    const result = ok(timeToContact(a, b))
    // They close at 2 per second and have 8 to cover before the rims meet.
    closeTo(result.time as number, 4, 1e-12)
  })

  it('says so when they miss, and how close they got', () => {
    const a = disc({ mass: 1, position: vec(0, 0), velocity: vec(1, 0), radius: 0.5 })
    const b = disc({ mass: 1, position: vec(10, 5), velocity: vec(-1, 0), radius: 0.5 })
    const result = ok(timeToContact(a, b))
    assert.equal(result.time, null)
    closeTo(result.closestApproach, 5, 1e-12)
    assert.match(result.why, /They miss/)
  })

  it('reports an overlap as contact now', () => {
    const a = disc({ mass: 1, position: vec(0, 0), radius: 2 })
    const b = disc({ mass: 1, position: vec(1, 0), radius: 2 })
    const result = ok(timeToContact(a, b))
    assert.equal(result.alreadyTouching, true)
    assert.equal(result.time, 0)
  })

  it('says so when they are already moving apart', () => {
    const a = disc({ mass: 1, position: vec(0, 0), velocity: vec(-1, 0), radius: 0.5 })
    const b = disc({ mass: 1, position: vec(5, 0), velocity: vec(1, 0), radius: 0.5 })
    const result = ok(timeToContact(a, b))
    assert.equal(result.time, null)
    assert.match(result.why, /already moving apart/)
  })

  it('says so when neither is moving relative to the other', () => {
    const a = disc({ mass: 1, position: vec(0, 0), velocity: vec(3, 3), radius: 0.5 })
    const b = disc({ mass: 1, position: vec(5, 0), velocity: vec(3, 3), radius: 0.5 })
    const result = ok(timeToContact(a, b))
    assert.equal(result.time, null)
    assert.match(result.why, /never changes/)
  })

  it('catches a fast small object that a stepped check would pass through', () => {
    // Crossing a wide gap in a fraction of a step: solved exactly, so it is found.
    const a = disc({ mass: 1, position: vec(0, 0), velocity: vec(10000, 0), radius: 0.01 })
    const b = disc({ mass: 1, position: vec(100, 0), velocity: vec(0, 0), radius: 0.01 })
    const result = ok(timeToContact(a, b))
    assert.ok(result.time !== null)
    closeTo(result.time, 99.98 / 10000, 1e-9)
    assert.match(result.why, /walks straight through a contact/)
  })
})

describe('the centre-of-mass frame', () => {
  it('makes the two momenta equal and opposite', () => {
    const result = ok(centreOfMassView([2, 5], [vec(6, 1), vec(-2, 3)]))
    closeTo(result.momenta[0].x, -result.momenta[1].x, 1e-12)
    closeTo(result.momenta[0].y, -result.momenta[1].y, 1e-12)
  })

  it('reports exactly the energy a perfectly inelastic collision loses', () => {
    const masses: [number, number] = [2, 5]
    const before: [ReturnType<typeof vec>, ReturnType<typeof vec>] = [vec(6, 0), vec(-2, 0)]
    const view = ok(centreOfMassView(masses, before))
    const sticky = ok(headOnCollision({ mass1: 2, velocity1: 6, mass2: 5, velocity2: -2, restitution: 0 }))
    closeTo(sticky.audit.kineticEnergyLost, view.availableEnergy, 1e-9)
    assert.match(view.why, /all a collision could possibly lose/)
  })

  it('has the frame moving at the centre-of-mass velocity', () => {
    const result = ok(centreOfMassView([3, 1], [vec(4, 0), vec(0, 0)]))
    closeTo(result.frameVelocity.x, 3, 1e-12)
  })

  it('leaves both at rest when they were moving together', () => {
    const result = ok(centreOfMassView([2, 3], [vec(5, 5), vec(5, 5)]))
    closeTo(magnitude(result.velocities[0]), 0, 1e-12)
    closeTo(result.availableEnergy, 0, 1e-12)
  })

  it('refuses a massless body', () => {
    assert.ok(isCollisionError(centreOfMassView([0, 1], [vec(1, 0), vec(0, 0)])))
  })
})

describe('reading the restitution back', () => {
  it('recovers the restitution a collision was given', () => {
    for (const restitution of [0, 0.3, 0.77, 1]) {
      const forward = ok(headOnCollision({ mass1: 2, velocity1: 9, mass2: 3, velocity2: -1, restitution }))
      const back = ok(
        restitutionFrom({
          velocity1Before: 9,
          velocity2Before: -1,
          velocity1After: forward.after.velocity1,
          velocity2After: forward.after.velocity2
        })
      )
      closeTo(back.restitution, restitution, 1e-12, `restitution ${restitution}`)
    }
  })

  it('says what a restitution above one would mean', () => {
    const result = ok(restitutionFrom({ velocity1Before: 4, velocity2Before: 0, velocity1After: -3, velocity2After: 3 }))
    assert.ok(result.restitution > 1)
    assert.match(result.describe, /something supplied energy/)
  })

  it('says what a negative one would mean', () => {
    const result = ok(restitutionFrom({ velocity1Before: 4, velocity2Before: 0, velocity1After: 5, velocity2After: -1 }))
    assert.ok(result.restitution < 0)
    assert.match(result.describe, /passed through each other/)
  })

  it('refuses a pair that was never closing', () => {
    const result = restitutionFrom({ velocity1Before: 0, velocity2Before: 4, velocity1After: 0, velocity2After: 4 })
    assert.ok(isCollisionError(result))
    assert.equal(result.error, 'not-approaching')
  })
})
