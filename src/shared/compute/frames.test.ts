import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  axisAngleOf,
  checkTree,
  CONVENTION_FACTS,
  EULER_FACTS,
  EULER_ORDERS,
  eulerFromRotation,
  frame,
  fromCylindrical,
  fromPolar,
  fromSpherical,
  IDENTITY_ROTATION,
  invertQuaternion,
  isFrameError,
  multiplyQuaternions,
  normaliseAngle,
  normaliseQuaternion,
  rotate2,
  rotateVector,
  rotationAboutAxis,
  rotationFromEuler,
  rotationMatrix,
  SPHERICAL_CONVENTIONS,
  toCylindrical,
  toPolar,
  toSpherical,
  transformDirection,
  transformPoint,
  type Quaternion,
  type Vector3,
  type FrameError
} from './frames.ts'

/**
 * Unwraps a result that may be an error.
 *
 * `Exclude` rather than a plain `T`: with a plain one, TypeScript solves `T | FrameError` by setting `T` to the whole
 * union, so every use site stays unnarrowed and the compiler stops checking field names on it.
 */
const ok = <T>(value: T): Exclude<T, FrameError> => {
  assert.ok(!isFrameError(value), isFrameError(value) ? value.message : '')
  return value as Exclude<T, FrameError>
}

const closeTo = (actual: number, expected: number, tolerance = 1e-9, what = ''): void => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what} expected ${expected} within ${tolerance}, got ${actual}`)
}

const close3 = (actual: Vector3, expected: Vector3, tolerance = 1e-9, what = ''): void => {
  closeTo(actual.x, expected.x, tolerance, `${what} x`)
  closeTo(actual.y, expected.y, tolerance, `${what} y`)
  closeTo(actual.z, expected.z, tolerance, `${what} z`)
}

describe('normaliseAngle', () => {
  it('brings angles into a half-open turn', () => {
    closeTo(normaliseAngle(0), 0)
    closeTo(normaliseAngle(3 * Math.PI), Math.PI)
    closeTo(normaliseAngle(-3 * Math.PI), Math.PI)
    closeTo(normaliseAngle(Math.PI / 2 + 4 * Math.PI), Math.PI / 2)
  })
})

describe('polar coordinates', () => {
  it('converts both ways', () => {
    const polar = ok(toPolar({ x: 3, y: 4 }))
    closeTo(polar.radius, 5)
    closeTo(polar.angle, Math.atan2(4, 3))
    const back = ok(fromPolar(polar.radius, polar.angle))
    closeTo(back.x, 3)
    closeTo(back.y, 4)
  })

  it('works in degrees when asked', () => {
    const polar = ok(toPolar({ x: 0, y: 1 }, 'degrees'))
    closeTo(polar.angle, 90)
    close3({ ...ok(fromPolar(1, 90, 'degrees')), z: 0 }, { x: 0, y: 1, z: 0 })
  })

  it('refuses to give the origin an angle', () => {
    const polar = ok(toPolar({ x: 0, y: 0 }))
    assert.equal(polar.angleDefined, false)
    assert.equal(polar.radius, 0)
    assert.match(polar.why, /a placeholder, not an answer/)
  })

  it('refuses a negative radius and says how to write it instead', () => {
    const result = fromPolar(-1, 0)
    assert.ok(isFrameError(result))
    assert.match(result.message, /adding half a turn to the angle/)
  })
})

describe('cylindrical coordinates', () => {
  it('converts both ways and keeps radius as distance from the axis', () => {
    const c = ok(toCylindrical({ x: 3, y: 4, z: 10 }))
    closeTo(c.radius, 5)
    closeTo(c.height, 10)
    assert.match(c.why, /not from the origin/)
    close3(ok(fromCylindrical(c.radius, c.azimuth, c.height)), { x: 3, y: 4, z: 10 })
  })

  it('has no azimuth on the z axis but keeps the height exact', () => {
    const c = ok(toCylindrical({ x: 0, y: 0, z: 7 }))
    assert.equal(c.azimuthDefined, false)
    assert.equal(c.height, 7)
    assert.match(c.why, /leaves the point where it is/)
  })
})

describe('spherical coordinates', () => {
  it('converts both ways', () => {
    const point = { x: 1, y: 2, z: 3 }
    const s = ok(toSpherical(point, 'physics'))
    closeTo(s.radius, Math.sqrt(14))
    close3(ok(fromSpherical(s.radius, s.polar, s.azimuth)), point)
  })

  it('names the angles differently under the two conventions, for the same geometry', () => {
    const point = { x: 1, y: 1, z: 1 }
    const physics = ok(toSpherical(point, 'physics'))
    const maths = ok(toSpherical(point, 'mathematics'))
    // Same numbers — the polar angle is the polar angle either way.
    closeTo(physics.polar, maths.polar)
    closeTo(physics.azimuth, maths.azimuth)
    // Different letters, which is the whole point.
    assert.equal(physics.polarSymbol, 'θ')
    assert.equal(maths.polarSymbol, 'φ')
    assert.equal(physics.azimuthSymbol, 'φ')
    assert.equal(maths.azimuthSymbol, 'θ')
    assert.match(physics.why, /the other way round/)
  })

  it('puts the polar angle at zero on the north pole and π on the south', () => {
    closeTo(ok(toSpherical({ x: 0, y: 0, z: 5 }, 'physics')).polar, 0)
    closeTo(ok(toSpherical({ x: 0, y: 0, z: -5 }, 'physics')).polar, Math.PI)
  })

  it('has an exact polar angle and no azimuth on the axis', () => {
    const s = ok(toSpherical({ x: 0, y: 0, z: 5 }, 'physics'))
    assert.equal(s.azimuthDefined, false)
    assert.match(s.why, /the azimuth has no value at all/)
  })

  it('has neither angle at the origin', () => {
    const s = ok(toSpherical({ x: 0, y: 0, z: 0 }, 'physics'))
    assert.equal(s.azimuthDefined, false)
    assert.match(s.why, /both zeros below are placeholders/)
  })

  it('refuses a convention it does not know, naming the trap', () => {
    const result = toSpherical({ x: 1, y: 1, z: 1 }, 'geography' as never)
    assert.ok(isFrameError(result))
    assert.match(result.message, /swap the meanings of θ and φ/)
  })

  it('has facts for both conventions', () => {
    for (const one of SPHERICAL_CONVENTIONS) {
      assert.ok(Object.prototype.hasOwnProperty.call(CONVENTION_FACTS, one), one)
      assert.ok(CONVENTION_FACTS[one].describe.length > 40, one)
    }
  })
})

describe('rotations', () => {
  it('rotates a quarter turn about z by the right-hand rule', () => {
    const q = ok(rotationAboutAxis({ x: 0, y: 0, z: 1 }, 90, 'degrees'))
    close3(ok(rotateVector(q, { x: 1, y: 0, z: 0 })), { x: 0, y: 1, z: 0 })
  })

  it('leaves a vector on the axis alone', () => {
    const q = ok(rotationAboutAxis({ x: 0, y: 0, z: 1 }, 1.234))
    close3(ok(rotateVector(q, { x: 0, y: 0, z: 5 })), { x: 0, y: 0, z: 5 })
  })

  it('preserves length', () => {
    const q = ok(rotationAboutAxis({ x: 1, y: 2, z: 3 }, 0.7))
    const v = { x: 4, y: -5, z: 6 }
    const rotated = ok(rotateVector(q, v))
    closeTo(Math.hypot(rotated.x, rotated.y, rotated.z), Math.hypot(v.x, v.y, v.z))
  })

  it('composes in the stated order, and the order matters', () => {
    const aboutZ = ok(rotationAboutAxis({ x: 0, y: 0, z: 1 }, 90, 'degrees'))
    const aboutX = ok(rotationAboutAxis({ x: 1, y: 0, z: 0 }, 90, 'degrees'))
    const start = { x: 1, y: 0, z: 0 }
    // multiplyQuaternions(a, b) applies b first.
    const zThenX = ok(rotateVector(multiplyQuaternions(aboutX, aboutZ), start))
    const xThenZ = ok(rotateVector(multiplyQuaternions(aboutZ, aboutX), start))
    close3(zThenX, { x: 0, y: 0, z: 1 })
    close3(xThenZ, { x: 0, y: 1, z: 0 })
    assert.notDeepEqual(zThenX, xThenZ)
  })

  it('matches applying the two rotations one after the other', () => {
    const a = ok(rotationAboutAxis({ x: 1, y: 1, z: 0 }, 0.4))
    const b = ok(rotationAboutAxis({ x: 0, y: 1, z: 1 }, -0.9))
    const v = { x: 2, y: 3, z: -1 }
    const composed = ok(rotateVector(multiplyQuaternions(a, b), v))
    const stepwise = ok(rotateVector(a, ok(rotateVector(b, v))))
    close3(composed, stepwise)
  })

  it('undoes itself through the inverse', () => {
    const q = ok(rotationAboutAxis({ x: 2, y: -1, z: 3 }, 1.1))
    const v = { x: 1, y: 2, z: 3 }
    close3(ok(rotateVector(invertQuaternion(q), ok(rotateVector(q, v)))), v)
  })

  it('recovers the axis and angle it was built from', () => {
    const q = ok(rotationAboutAxis({ x: 0, y: 1, z: 0 }, 35, 'degrees'))
    const back = ok(axisAngleOf(q, 'degrees'))
    closeTo(back.angle, 35, 1e-9)
    close3(back.axis, { x: 0, y: 1, z: 0 })
    assert.match(back.why, /the short way round/i)
  })

  it('reports the identity as having no particular axis', () => {
    const back = ok(axisAngleOf(IDENTITY_ROTATION))
    assert.equal(back.axisDefined, false)
    assert.equal(back.angle, 0)
    assert.match(back.why, /placeholder/)
  })

  it('takes the short way round for a rotation past half a turn', () => {
    const q = ok(rotationAboutAxis({ x: 0, y: 0, z: 1 }, 350, 'degrees'))
    const back = ok(axisAngleOf(q, 'degrees'))
    closeTo(back.angle, 10, 1e-9)
    close3(back.axis, { x: 0, y: 0, z: -1 })
  })

  it('refuses an axis of zero length', () => {
    const result = rotationAboutAxis({ x: 0, y: 0, z: 0 }, 1)
    assert.ok(isFrameError(result))
    assert.equal(result.error, 'degenerate')
  })

  it('refuses a quaternion of zero length', () => {
    assert.ok(isFrameError(normaliseQuaternion({ w: 0, x: 0, y: 0, z: 0 })))
  })

  it('rotates in two dimensions', () => {
    const turned = ok(rotate2({ x: 1, y: 0 }, 90, 'degrees'))
    closeTo(turned.x, 0)
    closeTo(turned.y, 1)
  })

  it('builds a rotation matrix that is orthonormal', () => {
    const q = ok(rotationAboutAxis({ x: 1, y: 2, z: -1 }, 0.8))
    const m = ok(rotationMatrix(q))
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        let total = 0
        for (let k = 0; k < 3; k += 1) total += (m[i]?.[k] ?? 0) * (m[j]?.[k] ?? 0)
        closeTo(total, i === j ? 1 : 0, 1e-9, `row ${i}·${j}`)
      }
    }
  })
})

describe('Euler angles', () => {
  it('round-trips through both supported orders', () => {
    for (const order of EULER_ORDERS) {
      const angles: readonly [number, number, number] = [0.3, -0.4, 1.1]
      const q = ok(rotationFromEuler(angles, order))
      const back = ok(eulerFromRotation(q, order))
      assert.equal(back.gimbalLocked, false, order)
      for (let i = 0; i < 3; i += 1) {
        closeTo(back.angles[i] as number, angles[i] as number, 1e-9, `${order} angle ${i}`)
      }
    }
  })

  it('round-trips in degrees', () => {
    const angles: readonly [number, number, number] = [20, -35, 100]
    const q = ok(rotationFromEuler(angles, 'zyx', 'degrees'))
    const back = ok(eulerFromRotation(q, 'zyx', 'degrees'))
    for (let i = 0; i < 3; i += 1) closeTo(back.angles[i] as number, angles[i] as number, 1e-7, `angle ${i}`)
  })

  it('gives different rotations for the same angles in different orders', () => {
    const angles: readonly [number, number, number] = [0.5, 0.6, 0.7]
    const a = ok(rotationFromEuler(angles, 'xyz'))
    const b = ok(rotationFromEuler(angles, 'zyx'))
    const v = { x: 1, y: 0, z: 0 }
    const one = ok(rotateVector(a, v))
    const other = ok(rotateVector(b, v))
    assert.ok(Math.hypot(one.x - other.x, one.y - other.y, one.z - other.z) > 0.1)
  })

  it('agrees with composing the axis rotations by hand', () => {
    // xyz means Rx·Ry·Rz, so the z rotation is applied to the vector first.
    const angles: readonly [number, number, number] = [0.2, 0.3, 0.4]
    const q = ok(rotationFromEuler(angles, 'xyz'))
    const v = { x: 1, y: 2, z: 3 }
    const rz = ok(rotationAboutAxis({ x: 0, y: 0, z: 1 }, 0.4))
    const ry = ok(rotationAboutAxis({ x: 0, y: 1, z: 0 }, 0.3))
    const rx = ok(rotationAboutAxis({ x: 1, y: 0, z: 0 }, 0.2))
    const byHand = ok(rotateVector(rx, ok(rotateVector(ry, ok(rotateVector(rz, v))))))
    close3(ok(rotateVector(q, v)), byHand)
  })

  it('reports gimbal lock rather than picking one answer quietly', () => {
    // Pitch at exactly 90°: yaw and roll become the same motion.
    const q = ok(rotationFromEuler([0.7, Math.PI / 2, 0.2], 'zyx'))
    const back = ok(eulerFromRotation(q, 'zyx'))
    assert.equal(back.gimbalLocked, true)
    assert.equal(back.angles[0], 0)
    assert.match(back.why, /infinitely many pairs give this same rotation/)
    assert.match(back.why, /A quaternion has no such problem/)
    // Whatever pair it picked, it must still be the same rotation.
    const rebuilt = ok(rotationFromEuler(back.angles as [number, number, number], 'zyx'))
    const v = { x: 1, y: 2, z: 3 }
    close3(ok(rotateVector(rebuilt, v)), ok(rotateVector(q, v)), 1e-6)
  })

  it('reports gimbal lock for the xyz order too, at its own middle angle', () => {
    const q = ok(rotationFromEuler([0.4, Math.PI / 2, 0.9], 'xyz'))
    const back = ok(eulerFromRotation(q, 'xyz'))
    assert.equal(back.gimbalLocked, true)
    const rebuilt = ok(rotationFromEuler(back.angles as [number, number, number], 'xyz'))
    const v = { x: 2, y: -1, z: 4 }
    close3(ok(rotateVector(rebuilt, v)), ok(rotateVector(q, v)), 1e-6)
  })

  it('reports gimbal lock at either pole, for either order', () => {
    for (const order of EULER_ORDERS) {
      for (const middle of [Math.PI / 2, -Math.PI / 2]) {
        const q = ok(rotationFromEuler([0.7, middle, 0.2], order))
        const back = ok(eulerFromRotation(q, order))
        assert.equal(back.gimbalLocked, true, `${order} at ${middle}`)
        assert.equal(back.angles[0], 0, `${order} at ${middle}`)
        // The recovered triple must describe the same rotation, whichever of the infinite family it picked.
        const rebuilt = ok(rotationFromEuler(back.angles as [number, number, number], order))
        for (const v of [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }]) {
          close3(ok(rotateVector(rebuilt, v)), ok(rotateVector(q, v)), 1e-6, `${order} at ${middle}`)
        }
      }
    }
  })

  it('refuses an order whose extraction formula it does not have', () => {
    const result = eulerFromRotation(IDENTITY_ROTATION, 'yzx' as never)
    assert.ok(isFrameError(result))
    assert.equal(result.error, 'unsupported-order')
    assert.match(result.message, /describing a different rotation/)
    assert.ok(isFrameError(rotationFromEuler([0, 0, 0], 'yzx' as never)))
  })

  it('has facts for every order it offers', () => {
    for (const order of EULER_ORDERS) {
      assert.ok(Object.prototype.hasOwnProperty.call(EULER_FACTS, order), order)
      assert.ok(EULER_FACTS[order].lockedWhen.length > 10, order)
    }
  })
})

describe('checkTree', () => {
  it('accepts a well formed tree', () => {
    const check = checkTree([frame({ id: 'world' }), frame({ id: 'robot', parent: 'world' }), frame({ id: 'hand', parent: 'robot' })])
    assert.equal(check.usable, true)
    assert.deepEqual([...check.roots], ['world'])
    assert.equal(check.mixedHandedness, false)
  })

  it('finds a missing parent', () => {
    const check = checkTree([frame({ id: 'hand', parent: 'arm' })])
    assert.equal(check.usable, false)
    assert.equal(check.problems[0]?.kind, 'missing-parent')
  })

  it('finds a cycle', () => {
    const check = checkTree([frame({ id: 'a', parent: 'b' }), frame({ id: 'b', parent: 'a' })])
    assert.equal(check.usable, false)
    assert.ok(check.problems.some((one) => one.kind === 'cycle'))
    assert.ok(check.problems.some((one) => /cannot be positioned relative to itself/.test(one.detail)))
  })

  it('finds a longer cycle', () => {
    const check = checkTree([frame({ id: 'a', parent: 'c' }), frame({ id: 'b', parent: 'a' }), frame({ id: 'c', parent: 'b' })])
    assert.ok(check.problems.some((one) => one.kind === 'cycle'))
  })

  it('finds a duplicate id', () => {
    const check = checkTree([frame({ id: 'a' }), frame({ id: 'a' })])
    assert.ok(check.problems.some((one) => one.kind === 'duplicate-id'))
  })

  it('refuses a scale of zero, which could not be undone', () => {
    const check = checkTree([frame({ id: 'a', scale: 0 })])
    assert.ok(check.problems.some((one) => one.kind === 'bad-scale'))
  })

  it('notices mixed handedness without calling it a problem', () => {
    const check = checkTree([frame({ id: 'a' }), frame({ id: 'b', parent: 'a', handedness: 'left' })])
    assert.equal(check.usable, true)
    assert.equal(check.mixedHandedness, true)
    assert.match(check.why, /needs an explicit mirror/)
  })

  it('reports several roots when there are several trees', () => {
    const check = checkTree([frame({ id: 'a' }), frame({ id: 'b' })])
    assert.equal(check.roots.length, 2)
  })
})

describe('transformPoint', () => {
  const world = frame({ id: 'world' })
  const shifted = frame({ id: 'shifted', parent: 'world', translation: { x: 10, y: 0, z: 0 } })
  const turned = frame({
    id: 'turned',
    parent: 'world',
    rotation: { w: Math.cos(Math.PI / 4), x: 0, y: 0, z: Math.sin(Math.PI / 4) }
  })
  const scaled = frame({ id: 'scaled', parent: 'world', scale: 2 })

  it('moves a point up into a parent', () => {
    const result = ok(transformPoint([world, shifted], { x: 1, y: 2, z: 3 }, 'shifted', 'world'))
    close3(result.point, { x: 11, y: 2, z: 3 })
  })

  it('moves a point back down into a child', () => {
    const result = ok(transformPoint([world, shifted], { x: 11, y: 2, z: 3 }, 'world', 'shifted'))
    close3(result.point, { x: 1, y: 2, z: 3 })
  })

  it('applies rotation as well as translation', () => {
    // The child frame is turned a quarter turn about z relative to the world.
    const result = ok(transformPoint([world, turned], { x: 1, y: 0, z: 0 }, 'turned', 'world'))
    close3(result.point, { x: 0, y: 1, z: 0 })
  })

  it('applies scale and undoes it exactly', () => {
    const up = ok(transformPoint([world, scaled], { x: 3, y: 0, z: 0 }, 'scaled', 'world'))
    close3(up.point, { x: 6, y: 0, z: 0 })
    const down = ok(transformPoint([world, scaled], up.point, 'world', 'scaled'))
    close3(down.point, { x: 3, y: 0, z: 0 })
  })

  it('goes up one branch and down another', () => {
    const result = ok(transformPoint([world, shifted, turned], { x: 0, y: 0, z: 0 }, 'shifted', 'turned'))
    // The shifted origin is at world (10,0,0); seen from a frame turned a quarter turn, that is (0,-10,0).
    close3(result.point, { x: 0, y: -10, z: 0 })
    assert.ok(result.via.includes('world'))
  })

  it('round-trips through a deep chain', () => {
    const chain = [
      world,
      frame({ id: 'a', parent: 'world', translation: { x: 1, y: 2, z: 3 }, rotation: ok(rotationAboutAxis({ x: 1, y: 1, z: 0 }, 0.5)), scale: 1.5 }),
      frame({ id: 'b', parent: 'a', translation: { x: -4, y: 0, z: 2 }, rotation: ok(rotationAboutAxis({ x: 0, y: 1, z: 1 }, -0.9)) }),
      frame({ id: 'c', parent: 'b', translation: { x: 0, y: 7, z: 0 }, scale: 0.25 })
    ]
    const start = { x: 2, y: -3, z: 5 }
    const out = ok(transformPoint(chain, start, 'c', 'world'))
    const back = ok(transformPoint(chain, out.point, 'world', 'c'))
    close3(back.point, start, 1e-9)
  })

  it('leaves a point alone when the frames are the same', () => {
    const result = ok(transformPoint([world], { x: 1, y: 2, z: 3 }, 'world', 'world'))
    close3(result.point, { x: 1, y: 2, z: 3 })
  })

  it('refuses two frames with no common root, without producing a number', () => {
    const result = transformPoint([frame({ id: 'a' }), frame({ id: 'b' })], { x: 1, y: 1, z: 1 }, 'a', 'b')
    assert.ok(isFrameError(result))
    assert.match(result.message, /not an unknown position, none/)
  })

  it('refuses a transform between frames of different handedness', () => {
    const left = frame({ id: 'mirror', parent: 'world', handedness: 'left' })
    const result = transformPoint([world, left], { x: 1, y: 1, z: 1 }, 'world', 'mirror')
    assert.ok(isFrameError(result))
    assert.equal(result.error, 'handedness')
    assert.match(result.message, /no rotation produces a reflection/)
  })

  it('refuses to walk a broken tree at all', () => {
    const result = transformPoint([frame({ id: 'a', parent: 'b' })], { x: 0, y: 0, z: 0 }, 'a', 'a')
    assert.ok(isFrameError(result))
  })

  it('refuses an unknown frame id', () => {
    assert.ok(isFrameError(transformPoint([world], { x: 0, y: 0, z: 0 }, 'world', 'nowhere')))
  })
})

describe('transformDirection', () => {
  const world = frame({ id: 'world' })
  const shifted = frame({ id: 'shifted', parent: 'world', translation: { x: 10, y: 20, z: 30 } })
  const turned = frame({
    id: 'turned',
    parent: 'world',
    translation: { x: 5, y: 5, z: 5 },
    rotation: { w: Math.cos(Math.PI / 4), x: 0, y: 0, z: Math.sin(Math.PI / 4) }
  })

  it('ignores translation, where a point does not', () => {
    const direction = ok(transformDirection([world, shifted], { x: 1, y: 0, z: 0 }, 'shifted', 'world'))
    close3(direction.point, { x: 1, y: 0, z: 0 })
    const asPoint = ok(transformPoint([world, shifted], { x: 1, y: 0, z: 0 }, 'shifted', 'world'))
    close3(asPoint.point, { x: 11, y: 20, z: 30 })
    assert.match(direction.why, /the frame offset has been taken out/)
  })

  it('still applies rotation', () => {
    const direction = ok(transformDirection([world, turned], { x: 1, y: 0, z: 0 }, 'turned', 'world'))
    close3(direction.point, { x: 0, y: 1, z: 0 })
  })

  it('preserves length under a pure rotation', () => {
    const v = { x: 3, y: 4, z: 12 }
    const out = ok(transformDirection([world, turned], v, 'turned', 'world'))
    closeTo(Math.hypot(out.point.x, out.point.y, out.point.z), 13, 1e-9)
  })

  it('refuses the same things transforming a point refuses', () => {
    assert.ok(isFrameError(transformDirection([world], { x: 1, y: 0, z: 0 }, 'world', 'nowhere')))
  })
})

describe('quaternion algebra', () => {
  it('treats a quaternion and its negation as the same rotation', () => {
    const q = ok(rotationAboutAxis({ x: 1, y: 1, z: 1 }, 1.3))
    const negated: Quaternion = { w: -q.w, x: -q.x, y: -q.y, z: -q.z }
    const v = { x: 1, y: -2, z: 3 }
    close3(ok(rotateVector(negated, v)), ok(rotateVector(q, v)))
  })

  it('composes to the identity with its own inverse', () => {
    const q = ok(rotationAboutAxis({ x: 0, y: 1, z: 2 }, 2.1))
    const composed = multiplyQuaternions(q, invertQuaternion(q))
    const normalised = ok(normaliseQuaternion(composed))
    closeTo(Math.abs(normalised.w), 1)
    closeTo(Math.hypot(normalised.x, normalised.y, normalised.z), 0)
  })
})
