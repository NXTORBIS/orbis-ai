import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  circularMotion,
  compareProjectile,
  isKinematicsError,
  motionInPhases,
  projectile,
  projectileWithDrag,
  relativeVelocity,
  riverCrossing,
  verticalCircle,
  windTriangle,
  type KinematicsError
} from './kinematics.ts'
import { vec } from './mechanics.ts'

const ok = <T>(value: T): Exclude<T, KinematicsError> => {
  assert.ok(!isKinematicsError(value), isKinematicsError(value) ? value.message : '')
  return value as Exclude<T, KinematicsError>
}

const closeTo = (actual: number, expected: number, tolerance: number, what = ''): void => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what} expected ${expected} within ${tolerance}, got ${actual}`)
}

const G = 9.81

describe('projectile, analytically', () => {
  it('matches the textbook range from level ground', () => {
    const result = ok(projectile({ speed: 20, angle: 45, height: 0, gravity: G }))
    // v²sin(2θ)/g
    closeTo(result.range, (400 * Math.sin(Math.PI / 2)) / G, 1e-9)
    closeTo(result.timeOfFlight, (2 * 20 * Math.sin(Math.PI / 4)) / G, 1e-9)
    closeTo(result.maximumHeight, (20 * Math.sin(Math.PI / 4)) ** 2 / (2 * G), 1e-9)
  })

  it('makes 45° the best angle from level ground and less from a height', () => {
    closeTo(ok(projectile({ speed: 20, angle: 45, height: 0, gravity: G })).bestAngle, 45, 1e-9)
    const raised = ok(projectile({ speed: 20, angle: 45, height: 30, gravity: G }))
    assert.ok(raised.bestAngle < 45, `from a height the best angle was ${raised.bestAngle}`)
    assert.ok(raised.bestAngle > 30)
  })

  it('has the best angle actually give the greatest range', () => {
    const setup = { speed: 15, height: 12, gravity: G }
    const best = ok(projectile({ ...setup, angle: 45 })).bestAngle
    const atBest = ok(projectile({ ...setup, angle: best })).range
    for (const angle of [best - 8, best - 3, best + 3, best + 8]) {
      const other = ok(projectile({ ...setup, angle })).range
      assert.ok(atBest >= other - 1e-9, `${angle}° gave ${other}, more than the best angle's ${atBest}`)
    }
  })

  it('gives complementary angles the same range from level ground', () => {
    const a = ok(projectile({ speed: 25, angle: 30, height: 0, gravity: G }))
    const b = ok(projectile({ speed: 25, angle: 60, height: 0, gravity: G }))
    closeTo(a.range, b.range, 1e-9)
    assert.ok(b.maximumHeight > a.maximumHeight, 'and the steeper one goes higher')
  })

  it('lands at the launch speed from level ground', () => {
    const result = ok(projectile({ speed: 30, angle: 37, height: 0, gravity: G }))
    closeTo(result.impactSpeed, 30, 1e-9)
    closeTo(result.impactAngle, 37, 1e-9)
  })

  it('lands faster when launched from a height', () => {
    const result = ok(projectile({ speed: 10, angle: 0, height: 20, gravity: G }))
    // Dropped horizontally: impact speed is √(v² + 2gh).
    closeTo(result.impactSpeed, Math.sqrt(100 + 2 * G * 20), 1e-9)
    closeTo(result.timeOfFlight, Math.sqrt((2 * 20) / G), 1e-9)
  })

  it('handles straight up', () => {
    const result = ok(projectile({ speed: 20, angle: 90, height: 0, gravity: G }))
    closeTo(result.range, 0, 1e-9)
    closeTo(result.maximumHeight, 400 / (2 * G), 1e-9)
    closeTo(result.timeOfFlight, (2 * 20) / G, 1e-9)
  })

  it('refuses zero gravity, and says why there is nothing to report', () => {
    const result = projectile({ speed: 10, angle: 45, height: 0, gravity: 0 })
    assert.ok(isKinematicsError(result))
    assert.match(result.message, /never lands/)
  })

  it('refuses a negative launch speed and a negative height', () => {
    assert.ok(isKinematicsError(projectile({ speed: -1, angle: 45, height: 0, gravity: G })))
    assert.ok(isKinematicsError(projectile({ speed: 1, angle: 45, height: -5, gravity: G })))
  })

  it('names the assumptions rather than footnoting them', () => {
    const result = ok(projectile({ speed: 20, angle: 45, height: 0, gravity: G }))
    assert.ok(result.assumptions.some((one) => /No air resistance at all/.test(one)))
    assert.ok(result.assumptions.length >= 3)
  })
})

describe('projectile, numerically', () => {
  it('agrees with the analytical answer when there is no drag', () => {
    const setup = { speed: 20, angle: 40, height: 5, gravity: G }
    const exact = ok(projectile(setup))
    const integrated = ok(projectileWithDrag(setup, { kind: 'none', coefficient: 0, mass: 1 }))
    closeTo(integrated.range, exact.range, 1e-3, 'range')
    closeTo(integrated.timeOfFlight, exact.timeOfFlight, 1e-4, 'time')
    closeTo(integrated.maximumHeight, exact.maximumHeight, 1e-3, 'height')
  })

  it('makes drag shorten the range', () => {
    const setup = { speed: 40, angle: 45, height: 0, gravity: G }
    const ideal = ok(projectileWithDrag(setup, { kind: 'none', coefficient: 0, mass: 1 }))
    const dragged = ok(projectileWithDrag(setup, { kind: 'quadratic', coefficient: 0.01, mass: 1 }))
    assert.ok(dragged.range < ideal.range * 0.9, `${dragged.range} vs ${ideal.range}`)
  })

  it('makes a heavier projectile go further through drag, and the same without it', () => {
    const setup = { speed: 40, angle: 45, height: 0, gravity: G }
    const light = ok(projectileWithDrag(setup, { kind: 'quadratic', coefficient: 0.02, mass: 0.5 }))
    const heavy = ok(projectileWithDrag(setup, { kind: 'quadratic', coefficient: 0.02, mass: 5 }))
    assert.ok(heavy.range > light.range, 'with drag, mass matters')

    const lightIdeal = ok(projectileWithDrag(setup, { kind: 'none', coefficient: 0, mass: 0.5 }))
    const heavyIdeal = ok(projectileWithDrag(setup, { kind: 'none', coefficient: 0, mass: 5 }))
    closeTo(heavyIdeal.range, lightIdeal.range, 1e-9, 'without drag, it does not')
  })

  it('lands steeper than it launched when there is drag', () => {
    const setup = { speed: 35, angle: 45, height: 0, gravity: G }
    const dragged = ok(projectileWithDrag(setup, { kind: 'quadratic', coefficient: 0.02, mass: 1 }))
    assert.ok(dragged.impactAngle > 45, `landed at ${dragged.impactAngle}°`)
  })

  it('lands exactly on the ground rather than below it', () => {
    const result = ok(projectileWithDrag({ speed: 20, angle: 30, height: 0, gravity: G }, { kind: 'none', coefficient: 0, mass: 1 }))
    const last = result.path[result.path.length - 1]
    closeTo(last?.position.y as number, 0, 1e-12)
  })

  it('says the ideal formulas do not apply when drag is on', () => {
    const result = ok(projectileWithDrag({ speed: 20, angle: 45, height: 0, gravity: G }, { kind: 'linear', coefficient: 0.1, mass: 1 }))
    assert.ok(result.notes.some((one) => /solve a different equation/.test(one)))
  })

  it('refuses a projectile with drag and no mass', () => {
    const result = projectileWithDrag({ speed: 20, angle: 45, height: 0, gravity: G }, { kind: 'quadratic', coefficient: 0.1, mass: 0 })
    assert.ok(isKinematicsError(result))
    assert.match(result.message, /slows a light object more/)
  })
})

describe('compareProjectile', () => {
  it('calls the gap integration error when there is no drag', () => {
    const result = ok(compareProjectile({ speed: 20, angle: 45, height: 0, gravity: G }, { kind: 'none', coefficient: 0, mass: 1 }))
    assert.equal(result.because, 'integration-error')
    assert.ok(Math.abs(result.relativeDifference.range) < 1e-4)
    assert.match(result.why, /A smaller step shrinks it/)
  })

  it('calls the gap drag when there is drag, and does not call it an error', () => {
    const result = ok(compareProjectile({ speed: 40, angle: 45, height: 0, gravity: G }, { kind: 'quadratic', coefficient: 0.02, mass: 1 }))
    assert.equal(result.because, 'drag')
    assert.match(result.why, /not an error in either/)
    assert.ok(result.difference.range < 0, 'drag shortens the range')
  })

  it('shrinks the no-drag gap when the step shrinks', () => {
    const setup = { speed: 20, angle: 45, height: 0, gravity: G }
    const coarse = ok(compareProjectile(setup, { kind: 'none', coefficient: 0, mass: 1 }, { step: 0.01 }))
    const fine = ok(compareProjectile(setup, { kind: 'none', coefficient: 0, mass: 1 }, { step: 0.0001 }))
    assert.ok(Math.abs(fine.difference.range) <= Math.abs(coarse.difference.range))
  })
})

describe('motion in phases', () => {
  it('joins the phases at their boundaries', () => {
    const result = ok(
      motionInPhases(
        [
          { duration: 5, acceleration: 2, label: 'Speeding up' },
          { duration: 5, acceleration: 0, label: 'Cruising' },
          { duration: 10, acceleration: -1, label: 'Slowing' }
        ],
        { position: 0, velocity: 0 }
      )
    )
    // 0→5: v goes 0→10, x goes 0→25. 5→10: v stays 10, x goes 25→75. 10→20: v goes 10→0, x goes 75→125.
    closeTo(result.phases[0]?.endVelocity as number, 10, 1e-12)
    closeTo(result.phases[0]?.endPosition as number, 25, 1e-12)
    closeTo(result.phases[1]?.endPosition as number, 75, 1e-12)
    closeTo(result.finalVelocity, 0, 1e-12)
    closeTo(result.finalPosition, 125, 1e-12)
  })

  it('separates distance from displacement when it turns round', () => {
    // Thrown up at 10 under gravity for 3 s: up for ~1.02 s, then back past the start.
    const result = ok(motionInPhases([{ duration: 3, acceleration: -9.81 }], { position: 0, velocity: 10 }))
    assert.ok(result.distance > Math.abs(result.displacement))
    assert.ok((result.phases[0]?.turnedAt as number) > 1 && (result.phases[0]?.turnedAt as number) < 1.1)
    assert.ok(result.notes.some((one) => /ground covered and displacement is net movement/.test(one)))
  })

  it('does not claim a turn when there was none', () => {
    const result = ok(motionInPhases([{ duration: 5, acceleration: 2 }], { position: 0, velocity: 1 }))
    assert.equal(result.phases[0]?.turnedAt, null)
    closeTo(result.distance, Math.abs(result.displacement), 1e-12)
  })

  it('samples the whole motion for plotting', () => {
    const result = ok(motionInPhases([{ duration: 4, acceleration: 3 }], { position: 0, velocity: 0 }, { sampleInterval: 0.5 }))
    assert.equal(result.samples[0]?.time, 0)
    closeTo(result.samples[result.samples.length - 1]?.time as number, 4, 1e-9)
    // x = ½·3·t², so at t = 2 it is 6.
    const at2 = result.samples.find((one) => Math.abs(one.time - 2) < 1e-9)
    closeTo(at2?.position as number, 6, 1e-9)
  })

  it('refuses a phase of no duration and an empty list', () => {
    assert.ok(isKinematicsError(motionInPhases([{ duration: 0, acceleration: 1 }], { position: 0, velocity: 0 })))
    assert.ok(isKinematicsError(motionInPhases([], { position: 0, velocity: 0 })))
  })

  it('says nothing was integrated', () => {
    const result = ok(motionInPhases([{ duration: 1, acceleration: 1 }], { position: 0, velocity: 0 }))
    assert.ok(result.notes.some((one) => /nothing here is integrated and nothing drifts/.test(one)))
  })
})

describe('relative motion', () => {
  it('subtracts one velocity from the other', () => {
    const result = ok(relativeVelocity(vec(10, 0), vec(4, 0)))
    assert.deepEqual(result.velocity, { x: 6, y: 0 })
    closeTo(result.bearing, 0, 1e-12)
  })

  it('says two identical velocities look like rest from each other, without claiming either is at rest', () => {
    const result = ok(relativeVelocity(vec(5, 5), vec(5, 5)))
    assert.equal(result.speed, 0)
    assert.match(result.why, /Neither is at rest in the original frame/)
  })
})

describe('the river', () => {
  it('crosses fastest pointing straight across, whatever the current', () => {
    const across = ok(riverCrossing({ boatSpeed: 4, riverSpeed: 3, width: 100, heading: 0 }))
    const angled = ok(riverCrossing({ boatSpeed: 4, riverSpeed: 3, width: 100, heading: 30 }))
    closeTo(across.crossingTime as number, 25, 1e-12)
    assert.ok((angled.crossingTime as number) > (across.crossingTime as number))
    closeTo(across.quickestTime, 25, 1e-12)
    assert.ok(across.notes.some((one) => /cannot slow the crossing/.test(one)))
  })

  it('drifts downstream by the current times the crossing time', () => {
    const result = ok(riverCrossing({ boatSpeed: 4, riverSpeed: 3, width: 100, heading: 0 }))
    closeTo(result.drift as number, 75, 1e-12)
  })

  it('finds the heading that lands directly opposite, and lands there', () => {
    const heading = ok(riverCrossing({ boatSpeed: 4, riverSpeed: 3, width: 100, heading: 0 })).headingForNoDrift
    assert.ok(heading !== null)
    closeTo(heading, (Math.asin(3 / 4) * 180) / Math.PI, 1e-9)
    const aimed = ok(riverCrossing({ boatSpeed: 4, riverSpeed: 3, width: 100, heading }))
    closeTo(aimed.drift as number, 0, 1e-9)
  })

  it('says there is no such heading when the river is faster than the boat', () => {
    const result = ok(riverCrossing({ boatSpeed: 2, riverSpeed: 5, width: 100, heading: 0 }))
    assert.equal(result.headingForNoDrift, null)
    assert.ok(result.notes.some((one) => /further upstream than it can push/.test(one)))
  })

  it('never crosses when pointed along the bank', () => {
    const result = ok(riverCrossing({ boatSpeed: 4, riverSpeed: 3, width: 100, heading: 90 }))
    assert.equal(result.crossingTime, null)
    assert.match(result.why, /never crosses/)
  })

  it('refuses a river with no width', () => {
    assert.ok(isKinematicsError(riverCrossing({ boatSpeed: 4, riverSpeed: 1, width: 0, heading: 0 })))
  })
})

describe('the wind triangle', () => {
  it('points into the crosswind by just enough', () => {
    // Course due east, wind from the south at 20: the aircraft must point south of east.
    const result = ok(windTriangle({ airspeed: 100, wind: vec(0, 20), course: 0 }))
    closeTo(result.overGround.y, 0, 1e-9)
    assert.ok(result.heading < 0, `heading was ${result.heading}`)
    closeTo(result.driftAngle, (Math.asin(20 / 100) * 180) / Math.PI, 1e-9)
  })

  it('makes a tailwind faster and a headwind slower over the ground', () => {
    const tail = ok(windTriangle({ airspeed: 100, wind: vec(20, 0), course: 0 }))
    const head = ok(windTriangle({ airspeed: 100, wind: vec(-20, 0), course: 0 }))
    closeTo(tail.groundSpeed, 120, 1e-9)
    closeTo(head.groundSpeed, 80, 1e-9)
    closeTo(tail.driftAngle, 0, 1e-9)
  })

  it('refuses a course it cannot hold, rather than returning an angle', () => {
    const result = windTriangle({ airspeed: 10, wind: vec(0, 40), course: 0 })
    assert.ok(isKinematicsError(result))
    assert.equal(result.error, 'unreachable')
    assert.match(result.message, /cannot cancel a crosswind it cannot outrun/)
  })
})

describe('circular motion', () => {
  it('relates speed, radius and angular velocity', () => {
    const result = ok(circularMotion({ radius: 2, mass: 3, speed: 10 }))
    closeTo(result.angularVelocity, 5, 1e-12)
    closeTo(result.centripetalAcceleration, 50, 1e-12)
    closeTo(result.centripetalForce, 150, 1e-12)
    closeTo(result.period, (2 * Math.PI) / 5, 1e-12)
  })

  it('takes an angular velocity instead of a speed', () => {
    const result = ok(circularMotion({ radius: 2, mass: 3, angularVelocity: 5 }))
    closeTo(result.speed, 10, 1e-12)
  })

  it('keeps the two components of acceleration apart', () => {
    const result = ok(circularMotion({ radius: 4, mass: 1, speed: 8, tangentialAcceleration: 3 }))
    closeTo(result.centripetalAcceleration, 16, 1e-12)
    closeTo(result.tangentialAcceleration, 3, 1e-12)
    closeTo(result.totalAcceleration, Math.hypot(16, 3), 1e-12)
    assert.ok(result.notes.some((one) => /neither component alone describes the motion/.test(one)))
  })

  it('says the period is instantaneous when the speed is changing', () => {
    const result = ok(circularMotion({ radius: 4, mass: 1, speed: 8, tangentialAcceleration: 3 }))
    assert.ok(result.notes.some((one) => /not the time for the next lap/.test(one)))
  })

  it('never mentions an outward force on the body', () => {
    const result = ok(circularMotion({ radius: 2, mass: 1, speed: 4 }))
    assert.ok(result.notes.some((one) => /There is no outward force on the body/.test(one)))
    assert.ok(!JSON.stringify(result).includes('centrifugal'))
  })

  it('refuses a radius of zero and demands one of speed or angular velocity', () => {
    assert.ok(isKinematicsError(circularMotion({ radius: 0, mass: 1, speed: 1 })))
    assert.ok(isKinematicsError(circularMotion({ radius: 1, mass: 1 })))
  })
})

describe('the vertical circle', () => {
  it('finds the classic minimum speed at the bottom', () => {
    const result = ok(verticalCircle({ radius: 2, mass: 1, speedAtBottom: 10, gravity: G }))
    closeTo(result.minimumSpeedAtBottom, Math.sqrt(5 * G * 2), 1e-12)
  })

  it('completes the loop just above that speed and fails just below', () => {
    const minimum = Math.sqrt(5 * G * 2)
    assert.equal(ok(verticalCircle({ radius: 2, mass: 1, speedAtBottom: minimum * 1.01, gravity: G })).completesLoop, true)
    assert.equal(ok(verticalCircle({ radius: 2, mass: 1, speedAtBottom: minimum * 0.99, gravity: G })).completesLoop, false)
  })

  it('loses contact with speed still left, which is not the same as running out', () => {
    const result = ok(verticalCircle({ radius: 2, mass: 1, speedAtBottom: 8, gravity: G }))
    assert.ok(result.losesContactAt !== null)
    const at = result.points.find((one) => one.angle === result.losesContactAt)
    assert.ok((at?.speed ?? 0) > 0, 'it still had speed when it left the track')
    assert.match(result.why, /From there it is a projectile/)
  })

  it('keeps contact on a rod, which can pull', () => {
    const result = ok(verticalCircle({ radius: 2, mass: 1, speedAtBottom: 8, gravity: G, canPull: true }))
    assert.equal(result.losesContactAt, null)
    assert.ok(result.notes.some((one) => /contact is never lost/.test(one)))
  })

  it('needs less speed on a rod than on a track', () => {
    const radius = 2
    const onRod = Math.sqrt(4 * G * radius)
    const onTrack = Math.sqrt(5 * G * radius)
    assert.ok(onRod < onTrack)
    assert.equal(ok(verticalCircle({ radius, mass: 1, speedAtBottom: onRod * 1.01, gravity: G, canPull: true })).completesLoop, true)
    assert.equal(ok(verticalCircle({ radius, mass: 1, speedAtBottom: onRod * 1.01, gravity: G, canPull: false })).completesLoop, false)
  })

  it('reports where it stops when it never gets round', () => {
    const result = ok(verticalCircle({ radius: 2, mass: 1, speedAtBottom: 2, gravity: G, canPull: true }))
    assert.equal(result.completesLoop, false)
    assert.ok(result.highestAngle > 0 && result.highestAngle < 180)
    assert.match(result.why, /comes back down/)
  })

  it('conserves energy around the loop', () => {
    const result = ok(verticalCircle({ radius: 3, mass: 2, speedAtBottom: 15, gravity: G, canPull: true }))
    for (const point of result.points) {
      if (point.speed === null) continue
      const energy = 0.5 * 2 * point.speed * point.speed + 2 * G * point.height
      closeTo(energy, 0.5 * 2 * 225, 1e-9, `at ${point.angle}°`)
    }
  })

  it('refuses zero gravity, where a vertical loop means nothing', () => {
    assert.ok(isKinematicsError(verticalCircle({ radius: 2, mass: 1, speedAtBottom: 5, gravity: 0 })))
  })
})
