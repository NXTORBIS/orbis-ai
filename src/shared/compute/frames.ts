/**
 * Coordinate systems, rotations and reference frames — with the convention always written down.
 *
 * The shared geometry-of-position engine for Orbis Pages. Almost every error in this subject is a convention error
 * rather than an arithmetic one: the right formula applied with the other convention gives a clean, plausible,
 * completely wrong answer. So nothing here has a default that is left unstated.
 *
 * ## The conventions this file makes explicit rather than assuming
 *
 * ```
 * θ polar / φ azimuth   vs   θ azimuth / φ polar   -- physics and mathematics swap these, and both call them θ and φ
 * radians               vs   degrees               -- named on every angle that crosses this boundary
 * intrinsic             vs   extrinsic rotations   -- rotating about the body's axes or the world's
 * rotation order        --                          XYZ and ZYX are different rotations of the same three angles
 * active                vs   passive               -- rotating the vector, or rotating the frame under it
 * right-handed          vs   left-handed           -- a mirrored frame, and never silently converted
 * point                 vs   direction             -- a translation moves one and not the other
 * ```
 *
 * Two places where an answer genuinely does not exist, and are reported rather than filled in: the azimuth at the
 * origin, where every direction is equally correct, and the two separable angles at gimbal lock, where a rotation has
 * an infinite family of Euler representations and picking one silently is how an animation snaps.
 *
 * Pure. No network, no clock, no storage.
 */

// ---------------------------------------------------------------- failure

export interface FrameError {
  error:
    | 'invalid-argument'
    | 'not-finite'
    | 'undefined-here'
    | 'unknown-frame'
    | 'cycle'
    | 'unsupported-order'
    | 'handedness'
    | 'degenerate'
  message: string
}

export const isFrameError = (value: unknown): value is FrameError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: FrameError['error'], message: string): FrameError => ({ error, message })

/** How close to the axis counts as on it, for the cases where an angle stops existing. */
export const DEGENERATE_TOLERANCE = 1e-12

/** How close to ±90° of pitch counts as gimbal lock. About a thousandth of a degree. */
export const GIMBAL_TOLERANCE = 1e-6

// ---------------------------------------------------------------- angles

export type AngleUnit = 'radians' | 'degrees'

export const toRadians = (value: number, unit: AngleUnit): number =>
  unit === 'degrees' ? (value * Math.PI) / 180 : value

export const fromRadians = (value: number, unit: AngleUnit): number =>
  unit === 'degrees' ? (value * 180) / Math.PI : value

/** Brings an angle into (−π, π], which is the range every angle this file returns uses. */
export function normaliseAngle(radians: number): number {
  if (!Number.isFinite(radians)) return Number.NaN
  const turned = ((radians + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI)
  return turned - Math.PI === -Math.PI ? Math.PI : turned - Math.PI
}

// ---------------------------------------------------------------- points

export interface Vector2 {
  x: number
  y: number
}

export interface Vector3 {
  x: number
  y: number
  z: number
}

const finite2 = (v: Vector2): boolean => Number.isFinite(v.x) && Number.isFinite(v.y)
const finite3 = (v: Vector3): boolean => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)

export const add3 = (a: Vector3, b: Vector3): Vector3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
export const subtract3 = (a: Vector3, b: Vector3): Vector3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
export const scale3 = (a: Vector3, by: number): Vector3 => ({ x: a.x * by, y: a.y * by, z: a.z * by })
export const dot3 = (a: Vector3, b: Vector3): number => a.x * b.x + a.y * b.y + a.z * b.z
export const cross3 = (a: Vector3, b: Vector3): Vector3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x
})
export const length3 = (a: Vector3): number => Math.hypot(a.x, a.y, a.z)

// ---------------------------------------------------------------- two dimensions

export interface Polar {
  radius: number
  /** Measured anticlockwise from the positive x axis, in the unit named. */
  angle: number
  unit: AngleUnit
  /** Null when the point is the origin, where no direction is more correct than any other. */
  angleDefined: boolean
  why: string
}

/** Cartesian to polar. At the origin the angle does not exist, and the result says so rather than returning zero. */
export function toPolar(point: Vector2, unit: AngleUnit = 'radians'): Polar | FrameError {
  if (!finite2(point)) return fail('not-finite', 'Both coordinates must be finite numbers.')
  const radius = Math.hypot(point.x, point.y)
  if (radius <= DEGENERATE_TOLERANCE) {
    return {
      radius,
      angle: 0,
      unit,
      angleDefined: false,
      why: 'The point is the origin. Every direction points at it equally, so there is no angle — the zero below is a placeholder, not an answer.'
    }
  }
  const radians = Math.atan2(point.y, point.x)
  return {
    radius,
    angle: fromRadians(radians, unit),
    unit,
    angleDefined: true,
    why: `Measured anticlockwise from the positive x axis, in ${unit}, in the range ${unit === 'degrees' ? '(−180, 180]' : '(−π, π]'}.`
  }
}

export function fromPolar(radius: number, angle: number, unit: AngleUnit = 'radians'): Vector2 | FrameError {
  if (!Number.isFinite(radius) || !Number.isFinite(angle)) return fail('not-finite', 'The radius and angle must be finite numbers.')
  if (radius < 0) return fail('invalid-argument', 'A polar radius is not negative. A negative radius means the opposite direction, which is better written by adding half a turn to the angle.')
  const radians = toRadians(angle, unit)
  return { x: radius * Math.cos(radians), y: radius * Math.sin(radians) }
}

// ---------------------------------------------------------------- three dimensions

export interface Cylindrical {
  /** Distance from the z axis, not from the origin. */
  radius: number
  azimuth: number
  height: number
  unit: AngleUnit
  azimuthDefined: boolean
  why: string
}

/** Cartesian to cylindrical. On the z axis the azimuth does not exist. */
export function toCylindrical(point: Vector3, unit: AngleUnit = 'radians'): Cylindrical | FrameError {
  if (!finite3(point)) return fail('not-finite', 'All three coordinates must be finite numbers.')
  const radius = Math.hypot(point.x, point.y)
  if (radius <= DEGENERATE_TOLERANCE) {
    return {
      radius,
      azimuth: 0,
      height: point.z,
      unit,
      azimuthDefined: false,
      why: 'The point is on the z axis, where the azimuth has no value — spinning about the axis leaves the point where it is. The height is still exact.'
    }
  }
  return {
    radius,
    azimuth: fromRadians(Math.atan2(point.y, point.x), unit),
    height: point.z,
    unit,
    azimuthDefined: true,
    why: `Radius is the distance from the z axis, not from the origin. Azimuth is anticlockwise from the positive x axis, in ${unit}.`
  }
}

export function fromCylindrical(radius: number, azimuth: number, height: number, unit: AngleUnit = 'radians'): Vector3 | FrameError {
  if (!Number.isFinite(radius) || !Number.isFinite(azimuth) || !Number.isFinite(height)) {
    return fail('not-finite', 'All three coordinates must be finite numbers.')
  }
  if (radius < 0) return fail('invalid-argument', 'A cylindrical radius is not negative.')
  const radians = toRadians(azimuth, unit)
  return { x: radius * Math.cos(radians), y: radius * Math.sin(radians), z: height }
}

/**
 * Which of the two spherical conventions is in use.
 *
 * This is the single most common source of a wrong answer in this whole subject, because both conventions use the
 * letters θ and φ and mean the opposite things by them. Neither is more correct; what matters is that the one in use
 * is stated, which is why this has no default that goes unrecorded.
 */
export type SphericalConvention = 'physics' | 'mathematics'

export const SPHERICAL_CONVENTIONS: readonly SphericalConvention[] = Object.freeze(['physics', 'mathematics'])

export const CONVENTION_FACTS: Readonly<Record<SphericalConvention, { label: string; describe: string; polarSymbol: string; azimuthSymbol: string }>> =
  Object.freeze({
    physics: {
      label: 'Physics / ISO 80000-2',
      describe: 'θ is the polar angle measured down from the positive z axis, from 0 to π. φ is the azimuth around the z axis. This is the ISO convention and the one used in most physics and engineering.',
      polarSymbol: 'θ',
      azimuthSymbol: 'φ'
    },
    mathematics: {
      label: 'Mathematics',
      describe: 'θ is the azimuth around the z axis and φ is the polar angle down from it — exactly the opposite naming from the physics convention, with the same two letters. Common in North American calculus texts.',
      polarSymbol: 'φ',
      azimuthSymbol: 'θ'
    }
  })

export interface Spherical {
  /** Distance from the origin. */
  radius: number
  /** Measured down from the positive z axis, 0 at the north pole and π at the south. */
  polar: number
  /** Measured anticlockwise around the z axis from the positive x axis. */
  azimuth: number
  unit: AngleUnit
  convention: SphericalConvention
  /** What the two angles are called under the convention in force. */
  polarSymbol: string
  azimuthSymbol: string
  /** False on the z axis, where spinning about the axis does not move the point. */
  azimuthDefined: boolean
  why: string
}

/**
 * Cartesian to spherical.
 *
 * The fields are named `polar` and `azimuth` rather than `theta` and `phi` on purpose: those two names are exactly
 * the ambiguity this function exists to remove. The convention is carried on the result so a Page can label them.
 */
export function toSpherical(point: Vector3, convention: SphericalConvention, unit: AngleUnit = 'radians'): Spherical | FrameError {
  if (!finite3(point)) return fail('not-finite', 'All three coordinates must be finite numbers.')
  if (!Object.prototype.hasOwnProperty.call(CONVENTION_FACTS, convention)) {
    return fail('invalid-argument', `There is no spherical convention called "${convention}". The two here are physics and mathematics, and they swap the meanings of θ and φ.`)
  }
  const radius = length3(point)
  const facts = CONVENTION_FACTS[convention]
  if (radius <= DEGENERATE_TOLERANCE) {
    return {
      radius,
      polar: 0,
      azimuth: 0,
      unit,
      convention,
      polarSymbol: facts.polarSymbol,
      azimuthSymbol: facts.azimuthSymbol,
      azimuthDefined: false,
      why: 'The point is the origin. Neither angle has a value there; both zeros below are placeholders.'
    }
  }
  const flat = Math.hypot(point.x, point.y)
  const polar = Math.acos(Math.max(-1, Math.min(1, point.z / radius)))
  const onAxis = flat <= DEGENERATE_TOLERANCE
  return {
    radius,
    polar: fromRadians(polar, unit),
    azimuth: onAxis ? 0 : fromRadians(Math.atan2(point.y, point.x), unit),
    unit,
    convention,
    polarSymbol: facts.polarSymbol,
    azimuthSymbol: facts.azimuthSymbol,
    azimuthDefined: !onAxis,
    why: onAxis
      ? `The point is on the z axis, so the polar angle is exact (${point.z > 0 ? '0, at the north pole' : 'π, at the south pole'}) and the azimuth has no value at all.`
      : `${facts.label}: the polar angle is ${facts.polarSymbol}, measured down from the positive z axis, and the azimuth is ${facts.azimuthSymbol}. Under the other convention those two letters mean the other way round.`
  }
}

export function fromSpherical(
  radius: number,
  polar: number,
  azimuth: number,
  unit: AngleUnit = 'radians'
): Vector3 | FrameError {
  if (!Number.isFinite(radius) || !Number.isFinite(polar) || !Number.isFinite(azimuth)) {
    return fail('not-finite', 'The radius and both angles must be finite numbers.')
  }
  if (radius < 0) return fail('invalid-argument', 'A spherical radius is not negative.')
  const p = toRadians(polar, unit)
  const a = toRadians(azimuth, unit)
  return {
    x: radius * Math.sin(p) * Math.cos(a),
    y: radius * Math.sin(p) * Math.sin(a),
    z: radius * Math.cos(p)
  }
}

// ---------------------------------------------------------------- rotations

export interface Quaternion {
  w: number
  x: number
  y: number
  z: number
}

export const IDENTITY_ROTATION: Quaternion = Object.freeze({ w: 1, x: 0, y: 0, z: 0 })

export function normaliseQuaternion(q: Quaternion): Quaternion | FrameError {
  const size = Math.hypot(q.w, q.x, q.y, q.z)
  if (!Number.isFinite(size)) return fail('not-finite', 'The quaternion has a component that is not a finite number.')
  if (size <= DEGENERATE_TOLERANCE) return fail('degenerate', 'A quaternion of zero length is not a rotation.')
  return { w: q.w / size, x: q.x / size, y: q.y / size, z: q.z / size }
}

/**
 * Composes two rotations. `multiplyQuaternions(a, b)` applies `b` first and then `a`.
 *
 * Rotation does not commute, and that is not a subtlety — turning right then up puts you somewhere else than turning
 * up then right. The argument order here follows the same convention as matrix multiplication, so `a·b` applied to a
 * vector means `a` applied to `b` applied to the vector.
 */
export function multiplyQuaternions(a: Quaternion, b: Quaternion): Quaternion {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w
  }
}

/** The rotation that undoes this one. */
export const invertQuaternion = (q: Quaternion): Quaternion => ({ w: q.w, x: -q.x, y: -q.y, z: -q.z })

/** A rotation of an angle about an axis, by the right-hand rule. */
export function rotationAboutAxis(axis: Vector3, angle: number, unit: AngleUnit = 'radians'): Quaternion | FrameError {
  if (!finite3(axis) || !Number.isFinite(angle)) return fail('not-finite', 'The axis and angle must be finite numbers.')
  const size = length3(axis)
  if (size <= DEGENERATE_TOLERANCE) return fail('degenerate', 'An axis of zero length does not define a rotation. Give a direction to turn about.')
  const radians = toRadians(angle, unit)
  const half = radians / 2
  const s = Math.sin(half) / size
  return { w: Math.cos(half), x: axis.x * s, y: axis.y * s, z: axis.z * s }
}

export interface AxisAngle {
  axis: Vector3
  angle: number
  unit: AngleUnit
  /** False when the rotation is the identity, which turns about no particular axis. */
  axisDefined: boolean
  why: string
}

/** The axis and angle a rotation amounts to. */
export function axisAngleOf(rotation: Quaternion, unit: AngleUnit = 'radians'): AxisAngle | FrameError {
  const q = normaliseQuaternion(rotation)
  if (isFrameError(q)) return q
  // A quaternion and its negation are the same rotation; pick the one with a non-negative w so the angle is the
  // short way round rather than the long way.
  const signed = q.w < 0 ? { w: -q.w, x: -q.x, y: -q.y, z: -q.z } : q
  const sine = Math.hypot(signed.x, signed.y, signed.z)
  const angle = 2 * Math.atan2(sine, signed.w)
  if (sine <= DEGENERATE_TOLERANCE) {
    return {
      axis: { x: 0, y: 0, z: 1 },
      angle: 0,
      unit,
      axisDefined: false,
      why: 'This is the identity: no rotation at all. Every axis is as good as any other, so the z axis below is a placeholder.'
    }
  }
  return {
    axis: { x: signed.x / sine, y: signed.y / sine, z: signed.z / sine },
    angle: fromRadians(angle, unit),
    unit,
    axisDefined: true,
    why: `The short way round: ${fromRadians(angle, unit).toPrecision(6)} ${unit} about this axis by the right-hand rule. The same rotation could be described as the long way round the opposite axis.`
  }
}

/** Rotates a vector. This is an active rotation: the vector moves and the frame stays still. */
export function rotateVector(rotation: Quaternion, point: Vector3): Vector3 | FrameError {
  const q = normaliseQuaternion(rotation)
  if (isFrameError(q)) return q
  if (!finite3(point)) return fail('not-finite', 'All three coordinates must be finite numbers.')
  // v' = v + 2w(q × v) + 2(q × (q × v)), the form that avoids building the full product.
  const u: Vector3 = { x: q.x, y: q.y, z: q.z }
  const first = cross3(u, point)
  const second = cross3(u, first)
  return {
    x: point.x + 2 * (q.w * first.x + second.x),
    y: point.y + 2 * (q.w * first.y + second.y),
    z: point.z + 2 * (q.w * first.z + second.z)
  }
}

/** Rotation about the z axis in two dimensions. */
export function rotate2(point: Vector2, angle: number, unit: AngleUnit = 'radians'): Vector2 | FrameError {
  if (!finite2(point) || !Number.isFinite(angle)) return fail('not-finite', 'The point and angle must be finite numbers.')
  const radians = toRadians(angle, unit)
  const c = Math.cos(radians)
  const s = Math.sin(radians)
  return { x: point.x * c - point.y * s, y: point.x * s + point.y * c }
}

// ---------------------------------------------------------------- Euler angles

/**
 * The order the three axis rotations are applied in, written outermost first.
 *
 * `'xyz'` means Rx·Ry·Rz — the z rotation happens first and the x rotation last. The three angles are given in the
 * same order as the letters. Two different orders of the same three angles are different rotations, which is why the
 * order is a required argument everywhere here and never has a default.
 */
export type EulerOrder = 'xyz' | 'zyx'

export const EULER_ORDERS: readonly EulerOrder[] = Object.freeze(['xyz', 'zyx'])

export const EULER_FACTS: Readonly<Record<EulerOrder, { label: string; describe: string; lockedWhen: string }>> = Object.freeze({
  xyz: {
    label: 'X then Y then Z (Rx·Ry·Rz)',
    describe: 'The z rotation is applied first and the x rotation last. Common in graphics packages.',
    lockedWhen: 'The middle angle, about y, reaches ±90°.'
  },
  zyx: {
    label: 'Z then Y then X (Rz·Ry·Rx) — yaw, pitch, roll',
    describe: 'The x rotation is applied first and the z rotation last. The aerospace convention: yaw about z, then pitch about y, then roll about x.',
    lockedWhen: 'Pitch reaches ±90° — nose straight up or straight down — where yaw and roll become the same motion.'
  }
})

export interface Euler {
  /** The three angles, in the same order as the letters of the order. */
  angles: readonly [number, number, number]
  order: EulerOrder
  unit: AngleUnit
  /**
   * True when the middle rotation has reached ±90° and the outer two are no longer separable.
   *
   * At that point an infinite family of angle triples produce the same rotation, and the split between the first and
   * third is arbitrary. This engine sets the first to zero and puts the whole turn on the third — a choice, reported
   * as one, rather than a silently picked answer.
   */
  gimbalLocked: boolean
  why: string
}

const axisQuaternion = (axis: 'x' | 'y' | 'z', radians: number): Quaternion => {
  const half = radians / 2
  const s = Math.sin(half)
  const c = Math.cos(half)
  if (axis === 'x') return { w: c, x: s, y: 0, z: 0 }
  if (axis === 'y') return { w: c, x: 0, y: s, z: 0 }
  return { w: c, x: 0, y: 0, z: s }
}

/** Builds a rotation from three Euler angles in a stated order. */
export function rotationFromEuler(
  angles: readonly [number, number, number],
  order: EulerOrder,
  unit: AngleUnit = 'radians'
): Quaternion | FrameError {
  if (!Object.prototype.hasOwnProperty.call(EULER_FACTS, order)) {
    return fail('unsupported-order', `There is no Euler order called "${order}". This engine handles ${EULER_ORDERS.join(' and ')}; the extraction formula is different for every order, so the ones not implemented are refused rather than approximated.`)
  }
  if (!angles.every((one) => Number.isFinite(one))) return fail('not-finite', 'All three angles must be finite numbers.')
  const letters = order.split('') as ('x' | 'y' | 'z')[]
  let result = IDENTITY_ROTATION
  for (let i = 0; i < 3; i += 1) {
    const axis = letters[i]
    if (axis === undefined) continue
    result = multiplyQuaternions(result, axisQuaternion(axis, toRadians(angles[i] as number, unit)))
  }
  return result
}

/** The nine entries of the rotation matrix a quaternion amounts to, row by row. */
export function rotationMatrix(rotation: Quaternion): readonly (readonly number[])[] | FrameError {
  const q = normaliseQuaternion(rotation)
  if (isFrameError(q)) return q
  const { w, x, y, z } = q
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]
  ]
}

/**
 * Recovers Euler angles from a rotation, in a stated order.
 *
 * The extraction is different for each of the six possible orders, so only the two implemented are offered and the
 * rest are refused by name. An approximate extraction using the wrong order's formula produces angles that are
 * individually plausible and collectively describe a different rotation.
 */
export function eulerFromRotation(rotation: Quaternion, order: EulerOrder, unit: AngleUnit = 'radians'): Euler | FrameError {
  if (!Object.prototype.hasOwnProperty.call(EULER_FACTS, order)) {
    return fail('unsupported-order', `There is no Euler order called "${order}". This engine handles ${EULER_ORDERS.join(' and ')}; every order needs its own extraction formula, and using another order's would give angles describing a different rotation.`)
  }
  const matrix = rotationMatrix(rotation)
  if (isFrameError(matrix)) return matrix
  const at = (row: number, column: number): number => matrix[row]?.[column] ?? 0

  let first: number
  let middle: number
  let third: number
  let locked: boolean

  if (order === 'xyz') {
    const sine = Math.max(-1, Math.min(1, at(0, 2)))
    middle = Math.asin(sine)
    locked = Math.abs(Math.abs(sine) - 1) < GIMBAL_TOLERANCE
    if (locked) {
      // With cos(middle) zero, only the sum (first + third) at +90° and the difference (third − first) at −90° are
      // determined. Setting the first to zero puts the whole of either on the third, and both cases read off the
      // same pair of matrix entries.
      first = 0
      third = Math.atan2(at(1, 0), at(1, 1))
    } else {
      first = Math.atan2(-at(1, 2), at(2, 2))
      third = Math.atan2(-at(0, 1), at(0, 0))
    }
  } else {
    const sine = Math.max(-1, Math.min(1, -at(2, 0)))
    middle = Math.asin(sine)
    locked = Math.abs(Math.abs(sine) - 1) < GIMBAL_TOLERANCE
    if (locked) {
      // At +90° of pitch the matrix determines (first − third) and at −90° it determines (first + third). With the
      // first set to zero the third is the negative of that quantity in the first case and equal to it in the second,
      // which is why the sign depends on which pole the pitch reached.
      first = 0
      third = (sine > 0 ? -1 : 1) * Math.atan2(-at(0, 1), at(1, 1))
    } else {
      first = Math.atan2(at(1, 0), at(0, 0))
      third = Math.atan2(at(2, 1), at(2, 2))
    }
  }

  return {
    angles: [fromRadians(first, unit), fromRadians(middle, unit), fromRadians(third, unit)],
    order,
    unit,
    gimbalLocked: locked,
    why: locked
      ? `Gimbal lock: ${EULER_FACTS[order].lockedWhen.toLowerCase()} The first and third angles are no longer separable — infinitely many pairs give this same rotation. The first has been set to zero and the whole turn put on the third, which is one valid answer out of many rather than the answer. A quaternion has no such problem and is the better thing to store.`
      : `${EULER_FACTS[order].label}. Angles are given in the order of the letters, in ${unit}.`
  }
}

// ---------------------------------------------------------------- reference frames

export type Handedness = 'right' | 'left'

export interface Frame {
  id: string
  /** Null for the root. Every other frame names the frame its position and rotation are given in. */
  parent: string | null
  /** Where this frame's origin sits, in the parent's coordinates. */
  translation: Vector3
  /** How this frame is turned, relative to the parent. */
  rotation: Quaternion
  /** A uniform scale factor. Non-uniform scaling is not offered, because it does not compose with rotation. */
  scale: number
  handedness: Handedness
  describe: string
}

export function frame(one: Partial<Frame> & { id: string }): Frame {
  return {
    id: one.id,
    parent: one.parent ?? null,
    translation: one.translation ?? { x: 0, y: 0, z: 0 },
    rotation: one.rotation ?? IDENTITY_ROTATION,
    scale: one.scale ?? 1,
    handedness: one.handedness ?? 'right',
    describe: one.describe ?? ''
  }
}

export interface TreeProblem {
  frameId: string
  kind: 'missing-parent' | 'cycle' | 'duplicate-id' | 'bad-scale' | 'bad-rotation' | 'not-finite'
  detail: string
}

export interface TreeCheck {
  /** True when every frame reaches a root without looping and everything is well formed. */
  usable: boolean
  problems: readonly TreeProblem[]
  roots: readonly string[]
  /** Mixed handedness in one tree, which is legal and worth knowing about. */
  mixedHandedness: boolean
  why: string
}

/** Checks a set of frames forms a usable tree before anything tries to walk it. */
export function checkTree(frames: readonly Frame[]): TreeCheck {
  const problems: TreeProblem[] = []
  const byId = new Map<string, Frame>()
  for (const one of frames) {
    if (byId.has(one.id)) {
      problems.push({ frameId: one.id, kind: 'duplicate-id', detail: `Two frames share the id "${one.id}". A transform between them could not say which was meant.` })
      continue
    }
    byId.set(one.id, one)
  }
  const roots: string[] = []
  for (const one of byId.values()) {
    if (!finite3(one.translation)) {
      problems.push({ frameId: one.id, kind: 'not-finite', detail: 'The translation has a coordinate that is not a finite number.' })
    }
    if (!Number.isFinite(one.scale) || one.scale === 0) {
      problems.push({ frameId: one.id, kind: 'bad-scale', detail: `A scale of ${one.scale} cannot be undone, so no transform out of this frame would exist.` })
    }
    if (isFrameError(normaliseQuaternion(one.rotation))) {
      problems.push({ frameId: one.id, kind: 'bad-rotation', detail: 'The rotation is not a usable quaternion.' })
    }
    if (one.parent === null) {
      roots.push(one.id)
      continue
    }
    if (!byId.has(one.parent)) {
      problems.push({ frameId: one.id, kind: 'missing-parent', detail: `Its parent "${one.parent}" is not among the frames given, so there is no path from it to anything else.` })
      continue
    }
    // Walk up to a root, and stop if the same frame comes round again.
    const seen = new Set<string>([one.id])
    let cursor: string | null = one.parent
    while (cursor !== null) {
      if (seen.has(cursor)) {
        problems.push({ frameId: one.id, kind: 'cycle', detail: `Following its parents comes back to "${cursor}". A frame cannot be positioned relative to itself, however far around the loop goes.` })
        break
      }
      seen.add(cursor)
      const next: Frame | undefined = byId.get(cursor)
      if (next === undefined) break
      cursor = next.parent
    }
  }
  const handedness = new Set([...byId.values()].map((one) => one.handedness))
  const usable = problems.length === 0
  return {
    usable,
    problems,
    roots,
    mixedHandedness: handedness.size > 1,
    why: usable
      ? `${byId.size} frame${byId.size === 1 ? '' : 's'}, ${roots.length} root${roots.length === 1 ? '' : 's'}, no loops.${handedness.size > 1 ? ' Both handednesses are present, so a transform between them needs an explicit mirror.' : ''}`
      : `${problems.length} problem${problems.length === 1 ? '' : 's'} found. No transform will be attempted until they are fixed, because a transform through a broken tree gives a number rather than an error.`
  }
}

interface Resolved {
  byId: Map<string, Frame>
}

function resolve(frames: readonly Frame[]): Resolved | FrameError {
  const check = checkTree(frames)
  if (!check.usable) {
    const first = check.problems[0]
    return fail(
      first?.kind === 'cycle' ? 'cycle' : 'unknown-frame',
      `The frames do not form a usable tree: ${check.problems.map((one) => `${one.frameId} — ${one.detail}`).join(' ')}`
    )
  }
  return { byId: new Map(frames.map((one) => [one.id, one])) }
}

/** The chain of frames from one up to its root, itself first. */
function chainToRoot(byId: Map<string, Frame>, id: string): Frame[] | FrameError {
  const out: Frame[] = []
  let cursor: string | null = id
  while (cursor !== null) {
    const one: Frame | undefined = byId.get(cursor)
    if (one === undefined) return fail('unknown-frame', `There is no frame with the id "${cursor}".`)
    out.push(one)
    cursor = one.parent
  }
  return out
}

/** A point expressed in this frame, moved into the parent's coordinates. */
function upOne(one: Frame, point: Vector3): Vector3 | FrameError {
  const rotated = rotateVector(one.rotation, scale3(point, one.scale))
  if (isFrameError(rotated)) return rotated
  return add3(rotated, one.translation)
}

/** A point expressed in the parent's coordinates, moved into this frame. */
function downOne(one: Frame, point: Vector3): Vector3 | FrameError {
  const moved = subtract3(point, one.translation)
  const unrotated = rotateVector(invertQuaternion(one.rotation), moved)
  if (isFrameError(unrotated)) return unrotated
  return scale3(unrotated, 1 / one.scale)
}

export interface Transformed {
  point: Vector3
  from: string
  to: string
  /** The frames walked through, from the starting frame to the target. */
  via: readonly string[]
  why: string
}

/**
 * Moves a point from one frame to another.
 *
 * The two frames must share a root. If they do not, there is no relationship between them at all — the point has a
 * position in one and simply no position in the other, and producing a number anyway would be inventing one.
 *
 * Frames of different handedness are refused. A right-handed and a left-handed frame differ by a reflection, and a
 * reflection is not a rotation: no sequence of turns takes one to the other. Converting between them means choosing
 * which axis to flip, and that choice belongs to the caller.
 */
export function transformPoint(
  frames: readonly Frame[],
  point: Vector3,
  from: string,
  to: string
): Transformed | FrameError {
  if (!finite3(point)) return fail('not-finite', 'All three coordinates must be finite numbers.')
  const resolved = resolve(frames)
  if (isFrameError(resolved)) return resolved
  const { byId } = resolved
  const source = byId.get(from)
  const target = byId.get(to)
  if (source === undefined) return fail('unknown-frame', `There is no frame with the id "${from}".`)
  if (target === undefined) return fail('unknown-frame', `There is no frame with the id "${to}".`)
  if (source.handedness !== target.handedness) {
    return fail(
      'handedness',
      `"${from}" is ${source.handedness}-handed and "${to}" is ${target.handedness}-handed. They differ by a reflection, and no rotation produces a reflection — converting between them means deciding which axis to flip, which is a choice this engine will not make silently.`
    )
  }
  if (from === to) {
    return { point, from, to, via: [from], why: 'The two frames are the same, so the point is unchanged.' }
  }

  const upChain = chainToRoot(byId, from)
  if (isFrameError(upChain)) return upChain
  const downChain = chainToRoot(byId, to)
  if (isFrameError(downChain)) return downChain
  const targetAncestors = new Set(downChain.map((one) => one.id))
  const common = upChain.find((one) => targetAncestors.has(one.id))
  if (common === undefined) {
    return fail(
      'unknown-frame',
      `"${from}" and "${to}" are in separate trees with no frame in common. There is no relationship between them, so a point in one has no position in the other — not an unknown position, none.`
    )
  }

  const via: string[] = []
  let carried = point
  for (const one of upChain) {
    if (one.id === common.id) break
    via.push(one.id)
    const moved = upOne(one, carried)
    if (isFrameError(moved)) return moved
    carried = moved
  }
  via.push(common.id)
  // Down the other side, outermost frame last.
  const descent: Frame[] = []
  for (const one of downChain) {
    if (one.id === common.id) break
    descent.push(one)
  }
  descent.reverse()
  for (const one of descent) {
    via.push(one.id)
    const moved = downOne(one, carried)
    if (isFrameError(moved)) return moved
    carried = moved
  }

  return {
    point: carried,
    from,
    to,
    via,
    why: `Up from "${from}" to the common frame "${common.id}" and back down to "${to}", through ${via.length} frame${via.length === 1 ? '' : 's'}.`
  }
}

/**
 * Moves a direction from one frame to another.
 *
 * Different from moving a point, and the difference is the whole reason this function exists separately. A direction
 * has no position, so translation does not apply to it: "two metres north" is the same direction wherever it is
 * measured from. Passing a direction through `transformPoint` adds the frame offset to it and gives an answer that
 * is wrong by exactly that offset — a mistake that looks right whenever the frames happen to share an origin.
 */
export function transformDirection(
  frames: readonly Frame[],
  direction: Vector3,
  from: string,
  to: string
): Transformed | FrameError {
  const origin = transformPoint(frames, { x: 0, y: 0, z: 0 }, from, to)
  if (isFrameError(origin)) return origin
  const moved = transformPoint(frames, direction, from, to)
  if (isFrameError(moved)) return moved
  return {
    point: subtract3(moved.point, origin.point),
    from,
    to,
    via: moved.via,
    why: `A direction, not a position: the frame offset has been taken out, so only the rotation and scale between "${from}" and "${to}" apply.`
  }
}
