/**
 * Rotation: moments of inertia, torque, angular momentum and rolling.
 *
 * The shared rigid-body engine for Orbis Pages. Everything here is exact.
 *
 * ## A moment of inertia without an axis is not a number
 *
 * The same object has different moments of inertia about different axes — a rod about its centre has a third of what
 * it has about its end — so every value here carries the axis it was computed about, and the parallel-axis theorem
 * is a function rather than something applied silently. An inertia quoted with no axis is the commonest way this
 * subject goes wrong, and it cannot be recovered from afterwards because the number alone does not say what it was.
 *
 * ## Rolling without slipping is a constraint, not a default
 *
 * `v = ωR` holds only while there is enough friction to prevent sliding, and how much is enough depends on the shape
 * and the slope. This engine computes the coefficient required and says when the assumption has stopped being true,
 * rather than applying the constraint and hoping.
 *
 * ## The distinctions this file refuses to blur
 *
 * ```
 * inertia        vs   inertia about an axis   -- the second is a number and the first is not
 * mass           vs   moment of inertia       -- one resists force, the other resists torque
 * torque         vs   force                   -- a force through the pivot has none, however large
 * rolling        vs   sliding                 -- a constraint with a condition, checked rather than assumed
 * angular momentum vs  momentum               -- separate quantities, separately conserved
 * ```
 *
 * Pure. No network, no clock, no storage.
 */

import { cross, magnitude, subtract, vec, type Vec2 } from './mechanics.ts'

export interface RigidBodyError {
  error: 'invalid-argument' | 'not-finite' | 'no-parts' | 'not-rolling' | 'unknown-shape'
  message: string
}

export const isRigidBodyError = (value: unknown): value is RigidBodyError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: RigidBodyError['error'], message: string): RigidBodyError => ({ error, message })

// ---------------------------------------------------------------- shapes

export type Shape =
  | 'point-mass'
  | 'rod-centre'
  | 'rod-end'
  | 'solid-disc'
  | 'ring'
  | 'solid-sphere'
  | 'hollow-sphere'
  | 'solid-cylinder'
  | 'rectangle'

export const SHAPES: readonly Shape[] = Object.freeze([
  'point-mass',
  'rod-centre',
  'rod-end',
  'solid-disc',
  'ring',
  'solid-sphere',
  'hollow-sphere',
  'solid-cylinder',
  'rectangle'
])

export interface ShapeFacts {
  label: string
  /** The formula, written out. */
  formula: string
  /** The axis it applies about, which is the part a bare number loses. */
  axis: string
  /** `I / mR²` for the round ones, which is the only thing that decides a rolling race. */
  inertiaFactor: number | null
  describe: string
}

export const SHAPE_FACTS: Readonly<Record<Shape, ShapeFacts>> = Object.freeze({
  'point-mass': {
    label: 'Point mass',
    formula: 'I = m·d²',
    axis: 'any axis, at a distance d from the mass',
    inertiaFactor: 1,
    describe: 'All the mass at one distance. Every other moment of inertia is a sum of these.'
  },
  'rod-centre': {
    label: 'Thin rod, about its centre',
    formula: 'I = m·L² / 12',
    axis: 'perpendicular to the rod, through its middle',
    inertiaFactor: null,
    describe: 'A uniform rod spun about its middle. A third of what the same rod has about its end, which is the parallel-axis theorem made visible.'
  },
  'rod-end': {
    label: 'Thin rod, about one end',
    formula: 'I = m·L² / 3',
    axis: 'perpendicular to the rod, through one end',
    inertiaFactor: null,
    describe: 'The same rod swung from its end. Four times harder to start turning than about its centre, because the far half is much further out.'
  },
  'solid-disc': {
    label: 'Solid disc or cylinder',
    formula: 'I = m·R² / 2',
    axis: 'through the centre, perpendicular to the face',
    inertiaFactor: 0.5,
    describe: 'Mass spread evenly from the centre to the rim.'
  },
  ring: {
    label: 'Ring or hoop',
    formula: 'I = m·R²',
    axis: 'through the centre, perpendicular to the ring',
    inertiaFactor: 1,
    describe: 'All the mass at the rim, so the largest moment of inertia any shape of this radius can have — and the slowest thing down a slope.'
  },
  'solid-sphere': {
    label: 'Solid sphere',
    formula: 'I = 2·m·R² / 5',
    axis: 'through the centre',
    inertiaFactor: 0.4,
    describe: 'Mass concentrated toward the middle, so the least resistance to turning of the round shapes — and the winner of every rolling race.'
  },
  'hollow-sphere': {
    label: 'Hollow sphere',
    formula: 'I = 2·m·R² / 3',
    axis: 'through the centre',
    inertiaFactor: 2 / 3,
    describe: 'A shell. Between a solid sphere and a hoop, because the mass is at the surface but spread over a curved one.'
  },
  'solid-cylinder': {
    label: 'Solid cylinder, about its axis',
    formula: 'I = m·R² / 2',
    axis: 'the long axis of the cylinder',
    inertiaFactor: 0.5,
    describe: 'The same as a disc: the length along the axis makes no difference to rotation about it.'
  },
  rectangle: {
    label: 'Rectangular plate',
    formula: 'I = m·(a² + b²) / 12',
    axis: 'through the centre, perpendicular to the plate',
    inertiaFactor: null,
    describe: 'A flat plate spun about its middle. Both side lengths matter, and neither more than the other.'
  }
})

export interface Inertia {
  shape: Shape
  value: number
  mass: number
  /** The dimension the formula used: a radius, a length, or a distance. */
  size: number
  /** The second dimension, for a rectangle. */
  secondSize: number | null
  axis: string
  formula: string
  /** The radius at which a point mass would have the same moment of inertia. */
  radiusOfGyration: number
  notes: readonly string[]
}

/**
 * The moment of inertia of a standard shape.
 *
 * The axis comes back with the number, because the number means nothing without it.
 */
export function inertiaOf(input: { shape: Shape; mass: number; size: number; secondSize?: number }): Inertia | RigidBodyError {
  const { shape, mass, size } = input
  if (!Object.prototype.hasOwnProperty.call(SHAPE_FACTS, shape)) {
    return fail('unknown-shape', `There is no shape called "${shape}". The ones here are ${SHAPES.join(', ')}.`)
  }
  if (!Number.isFinite(mass) || mass <= 0) return fail('invalid-argument', 'The mass must be positive.')
  if (!Number.isFinite(size) || size < 0) return fail('invalid-argument', 'The size must be zero or more.')

  let value: number
  switch (shape) {
    case 'point-mass':
      value = mass * size * size
      break
    case 'rod-centre':
      value = (mass * size * size) / 12
      break
    case 'rod-end':
      value = (mass * size * size) / 3
      break
    case 'solid-disc':
    case 'solid-cylinder':
      value = (mass * size * size) / 2
      break
    case 'ring':
      value = mass * size * size
      break
    case 'solid-sphere':
      value = (2 * mass * size * size) / 5
      break
    case 'hollow-sphere':
      value = (2 * mass * size * size) / 3
      break
    case 'rectangle': {
      const second = input.secondSize
      if (second === undefined || !Number.isFinite(second) || second < 0) {
        return fail('invalid-argument', 'A rectangular plate needs both side lengths.')
      }
      value = (mass * (size * size + second * second)) / 12
      break
    }
  }

  const facts = SHAPE_FACTS[shape]
  return {
    shape,
    value,
    mass,
    size,
    secondSize: input.secondSize ?? null,
    axis: facts.axis,
    formula: facts.formula,
    radiusOfGyration: Math.sqrt(value / mass),
    notes: [
      `About ${facts.axis}. The same object has a different moment of inertia about a different axis, so this number is not a property of the object alone — a rod about its end has four times what it has about its centre.`,
      facts.describe,
      `The radius of gyration is ${Math.sqrt(value / mass).toPrecision(6)}: a point mass at that distance would be exactly as hard to spin.`
    ]
  }
}

export interface ShiftedInertia {
  aboutCentre: number
  aboutNewAxis: number
  distance: number
  added: number
  why: string
}

/**
 * The moment of inertia about a parallel axis at a distance from the centre of mass.
 *
 * `I = I_cm + m·d²`. The added term is never negative, so the centre of mass is always the easiest axis to spin
 * something about — which is why a thrown object tumbles about its centre of mass and not about anything else.
 */
export function shiftAxis(input: { aboutCentreOfMass: number; mass: number; distance: number }): ShiftedInertia | RigidBodyError {
  const { aboutCentreOfMass, mass, distance } = input
  if (![aboutCentreOfMass, mass, distance].every((one) => Number.isFinite(one))) return fail('not-finite', 'Every value must be finite.')
  if (mass <= 0) return fail('invalid-argument', 'The mass must be positive.')
  if (aboutCentreOfMass < 0) return fail('invalid-argument', 'A moment of inertia is not negative.')

  const added = mass * distance * distance
  return {
    aboutCentre: aboutCentreOfMass,
    aboutNewAxis: aboutCentreOfMass + added,
    distance: Math.abs(distance),
    added,
    why: `I = I_cm + m·d² adds ${added.toPrecision(6)}. That term is never negative, so the centre of mass is always the easiest axis to spin an object about — which is why anything thrown tumbles about its centre of mass and nowhere else.`
  }
}

export interface Part {
  label: string
  mass: number
  /** This part's moment of inertia about its own centre of mass. */
  inertiaAboutOwnCentre: number
  position: Vec2
}

export interface Composite {
  totalMass: number
  centreOfMass: Vec2
  /** About the whole object's centre of mass. */
  inertia: number
  parts: readonly { label: string; mass: number; distanceFromCentre: number; ownInertia: number; contributed: number }[]
  radiusOfGyration: number
  notes: readonly string[]
}

/**
 * Several parts joined into one object.
 *
 * Each part's contribution is its own moment of inertia plus the parallel-axis term from where it sits, and the two
 * are reported separately — because for anything far from the centre the second dwarfs the first, and that is worth
 * being able to see rather than having to infer.
 */
export function compositeBody(parts: readonly Part[]): Composite | RigidBodyError {
  if (parts.length === 0) return fail('no-parts', 'An object with no parts has no mass and no moment of inertia.')
  if (parts.length > 500) return fail('invalid-argument', 'More than 500 parts is refused.')
  for (const one of parts) {
    if (!Number.isFinite(one.mass) || one.mass <= 0) return fail('invalid-argument', `"${one.label}" needs a positive mass.`)
    if (!Number.isFinite(one.inertiaAboutOwnCentre) || one.inertiaAboutOwnCentre < 0) {
      return fail('invalid-argument', `"${one.label}" has a negative moment of inertia.`)
    }
    if (!Number.isFinite(one.position.x) || !Number.isFinite(one.position.y)) {
      return fail('not-finite', `"${one.label}" has a position that is not finite.`)
    }
  }

  let totalMass = 0
  let x = 0
  let y = 0
  for (const one of parts) {
    totalMass += one.mass
    x += one.mass * one.position.x
    y += one.mass * one.position.y
  }
  const centre = vec(x / totalMass, y / totalMass)

  let inertia = 0
  const detail: Composite['parts'] = parts.map((one) => {
    const distance = magnitude(subtract(one.position, centre))
    const contributed = one.inertiaAboutOwnCentre + one.mass * distance * distance
    inertia += contributed
    return {
      label: one.label,
      mass: one.mass,
      distanceFromCentre: distance,
      ownInertia: one.inertiaAboutOwnCentre,
      contributed
    }
  })

  const dominated = detail.filter((one) => one.ownInertia > 0 && one.contributed > one.ownInertia * 10)
  const notes: string[] = [
    'Each part contributes its own moment of inertia plus a parallel-axis term for where it sits. The two are listed separately because for anything far from the centre the second dwarfs the first.'
  ]
  if (dominated.length > 0) {
    notes.push(
      `For ${dominated.map((one) => `"${one.label}"`).join(', ')} the position matters far more than the shape: moving ${dominated.length === 1 ? 'it' : 'them'} would change the answer much more than reshaping ${dominated.length === 1 ? 'it' : 'them'} would.`
    )
  }
  notes.push('The moment of inertia here is about the whole object’s centre of mass. About any other axis it is larger, by the parallel-axis term for the distance.')

  return {
    totalMass,
    centreOfMass: centre,
    inertia,
    parts: detail,
    radiusOfGyration: Math.sqrt(inertia / totalMass),
    notes
  }
}

// ---------------------------------------------------------------- torque

export interface Torque {
  /** Positive is anticlockwise. */
  torque: number
  /** The perpendicular distance from the pivot to the line of the force. */
  momentArm: number
  forceMagnitude: number
  /** Angle between the position vector and the force, in degrees. */
  angle: number
  /** The component of the force that does anything, and the component that does not. */
  effectiveForce: number
  wastedForce: number
  why: string
}

/**
 * The turning effect of a force about a pivot.
 *
 * `τ = r × F`, which in a plane is a single number. The component of the force along the position vector contributes
 * nothing at all however large it is — pushing a door toward its hinges does not close it — and that component is
 * reported so it can be seen rather than inferred from a small answer.
 */
export function torqueFrom(input: { pivot: Vec2; applicationPoint: Vec2; force: Vec2 }): Torque | RigidBodyError {
  const values = [input.pivot.x, input.pivot.y, input.applicationPoint.x, input.applicationPoint.y, input.force.x, input.force.y]
  if (!values.every((one) => Number.isFinite(one))) return fail('not-finite', 'Every value must be finite.')

  const r = subtract(input.applicationPoint, input.pivot)
  const distance = magnitude(r)
  const forceSize = magnitude(input.force)
  const torque = cross(r, input.force)

  if (distance === 0) {
    return {
      torque: 0,
      momentArm: 0,
      forceMagnitude: forceSize,
      angle: 0,
      effectiveForce: 0,
      wastedForce: forceSize,
      why: 'The force is applied at the pivot itself, so it has no turning effect at all whatever its size. There is no lever arm.'
    }
  }

  const momentArm = forceSize === 0 ? 0 : Math.abs(torque) / forceSize
  const angle = forceSize === 0 ? 0 : (Math.acos(Math.max(-1, Math.min(1, (r.x * input.force.x + r.y * input.force.y) / (distance * forceSize)))) * 180) / Math.PI
  const effective = forceSize === 0 ? 0 : Math.abs(torque) / distance
  const wasted = Math.sqrt(Math.max(0, forceSize * forceSize - effective * effective))

  return {
    torque,
    momentArm,
    forceMagnitude: forceSize,
    angle,
    effectiveForce: effective,
    wastedForce: wasted,
    why:
      Math.abs(torque) < 1e-12 && forceSize > 0
        ? 'The force points straight at or away from the pivot, so none of it turns anything. Pushing a door toward its hinges does not close it, however hard.'
        : `${effective.toPrecision(6)} of the ${forceSize.toPrecision(6)} acts perpendicular to the arm and turns the body; the other ${wasted.toPrecision(6)} pulls along the arm and does nothing. The effective lever arm is ${momentArm.toPrecision(6)}.`
  }
}

export interface AngularMotion {
  inertia: number
  netTorque: number
  angularAcceleration: number
  angularVelocity: number
  angle: number
  angularMomentum: number
  rotationalEnergy: number
  notes: readonly string[]
}

/** Where a body is after a while under a constant torque. Exact, since constant angular acceleration has a closed form. */
export function spinUnderTorque(input: {
  inertia: number
  torque: number
  initialAngularVelocity?: number
  initialAngle?: number
  time: number
}): AngularMotion | RigidBodyError {
  const { inertia, torque, time } = input
  if (![inertia, torque, time].every((one) => Number.isFinite(one))) return fail('not-finite', 'Every value must be finite.')
  if (inertia <= 0) return fail('invalid-argument', 'The moment of inertia must be positive.')

  const alpha = torque / inertia
  const w0 = input.initialAngularVelocity ?? 0
  const t0 = input.initialAngle ?? 0
  const omega = w0 + alpha * time
  const angle = t0 + w0 * time + 0.5 * alpha * time * time

  return {
    inertia,
    netTorque: torque,
    angularAcceleration: alpha,
    angularVelocity: omega,
    angle,
    angularMomentum: inertia * omega,
    rotationalEnergy: 0.5 * inertia * omega * omega,
    notes: [
      'τ = Iα is the rotational form of F = ma, with the moment of inertia playing the part of the mass. It resists torque the way mass resists force.',
      'Exact, not integrated: a constant angular acceleration has a closed form, the same as constant linear acceleration does.'
    ]
  }
}

// ---------------------------------------------------------------- rolling

export interface Rolling {
  shape: Shape
  /** `I / mR²`, which is the only thing about the object that affects the answer. */
  inertiaFactor: number
  /** Acceleration down the slope. */
  acceleration: number
  /** How the kinetic energy splits, as fractions summing to one. */
  energySplit: { translational: number; rotational: number }
  /** The smallest friction coefficient that keeps it rolling rather than sliding. */
  frictionNeeded: number
  /** True when the friction given is enough. Null when none was given. */
  rolls: boolean | null
  /** Speed at the bottom of a slope of the given height. */
  speedAfterDrop: number | null
  notes: readonly string[]
}

/**
 * Something rolling down a slope.
 *
 * The result that makes this worth its own function: the acceleration depends only on `I/mR²` — on the *shape* — and
 * not on the mass or the radius at all. A heavy hoop and a light one roll down side by side and both lose to any
 * sphere. The mass cancels out of the equation entirely, which is not obvious and is easy to disbelieve.
 *
 * Rolling without slipping needs enough friction, and how much depends on the shape and the slope. That coefficient
 * is computed rather than assumed, and when one is supplied the result says whether it is enough.
 */
export function rollingDownSlope(input: {
  shape: Shape
  slopeDegrees: number
  gravity: number
  /** Optional: to check whether it rolls at all. */
  frictionCoefficient?: number
  /** Optional: to work out the speed at the bottom. */
  dropHeight?: number
}): Rolling | RigidBodyError {
  const { shape, slopeDegrees, gravity } = input
  const facts = SHAPE_FACTS[shape]
  if (facts === undefined) return fail('unknown-shape', `There is no shape called "${shape}".`)
  if (facts.inertiaFactor === null) {
    return fail(
      'invalid-argument',
      `A ${facts.label.toLowerCase()} does not roll: rolling needs a circular cross-section so that the contact point moves along the surface. The shapes that roll here are ${SHAPES.filter((one) => SHAPE_FACTS[one].inertiaFactor !== null).join(', ')}.`
    )
  }
  if (![slopeDegrees, gravity].every((one) => Number.isFinite(one))) return fail('not-finite', 'Every value must be finite.')
  if (gravity <= 0) return fail('invalid-argument', 'Gravity must be positive.')
  if (slopeDegrees <= 0 || slopeDegrees >= 90) return fail('invalid-argument', 'The slope must be between 0 and 90 degrees, exclusive.')

  const k = facts.inertiaFactor
  const theta = (slopeDegrees * Math.PI) / 180
  // a = g sin θ / (1 + I/mR²). No mass and no radius anywhere in it.
  const acceleration = (gravity * Math.sin(theta)) / (1 + k)
  // The energy splits in the ratio 1 : k, whatever the speed.
  const translational = 1 / (1 + k)
  const frictionNeeded = (k / (1 + k)) * Math.tan(theta)
  const rolls = input.frictionCoefficient === undefined ? null : input.frictionCoefficient >= frictionNeeded

  const speedAfterDrop =
    input.dropHeight === undefined || input.dropHeight < 0
      ? null
      : Math.sqrt((2 * gravity * input.dropHeight) / (1 + k))

  const notes: string[] = [
    `The acceleration is g·sinθ / (1 + I/mR²), and I/mR² for a ${facts.label.toLowerCase()} is ${k.toPrecision(4)}. Neither the mass nor the radius appears anywhere: a heavy hoop and a light one roll down side by side, and both lose to any sphere.`,
    `${(translational * 100).toPrecision(3)}% of the kinetic energy is in moving down the slope and ${((1 - translational) * 100).toPrecision(3)}% is in spinning. That split depends only on the shape and stays the same at every speed.`,
    `Rolling without slipping needs a friction coefficient of at least ${frictionNeeded.toPrecision(4)} on this slope. Below that it slides as well as rolls, and none of the numbers above apply.`
  ]
  if (rolls === false) {
    notes.push(
      `The friction given, ${input.frictionCoefficient}, is below what rolling needs. This object slides as it rolls, and the acceleration above is wrong for it — a sliding object accelerates faster and arrives spinning more slowly.`
    )
  }
  if (rolls === true) {
    notes.push(`The friction given, ${input.frictionCoefficient}, is enough. It rolls without slipping and the numbers above hold.`)
  }

  return {
    shape,
    inertiaFactor: k,
    acceleration,
    energySplit: { translational, rotational: 1 - translational },
    frictionNeeded,
    rolls,
    speedAfterDrop,
    notes
  }
}

export interface RollingRace {
  order: readonly { shape: Shape; label: string; inertiaFactor: number; acceleration: number; timeToBottom: number }[]
  notes: readonly string[]
}

/**
 * Several shapes released together down the same slope.
 *
 * The order never changes: less mass at the rim means less of the energy goes into spinning, so more is left for
 * going down. Solid sphere, then solid disc, then hollow sphere, then hoop — whatever they weigh and whatever size
 * they are.
 */
export function rollingRace(input: {
  shapes: readonly Shape[]
  slopeDegrees: number
  gravity: number
  distance: number
}): RollingRace | RigidBodyError {
  if (input.shapes.length === 0) return fail('no-parts', 'There is nothing racing.')
  if (!Number.isFinite(input.distance) || input.distance <= 0) return fail('invalid-argument', 'The distance must be positive.')

  const entries: { shape: Shape; label: string; inertiaFactor: number; acceleration: number; timeToBottom: number }[] = []
  for (const shape of input.shapes) {
    const one = rollingDownSlope({ shape, slopeDegrees: input.slopeDegrees, gravity: input.gravity })
    if (isRigidBodyError(one)) return one
    entries.push({
      shape,
      label: SHAPE_FACTS[shape].label,
      inertiaFactor: one.inertiaFactor,
      acceleration: one.acceleration,
      timeToBottom: Math.sqrt((2 * input.distance) / one.acceleration)
    })
  }
  entries.sort((a, b) => a.timeToBottom - b.timeToBottom)

  return {
    order: entries,
    notes: [
      'The order depends only on I/mR², which is a property of the shape. Mass and radius cancel out of the equation entirely, so a heavy one and a light one of the same shape arrive together.',
      'Less mass at the rim means less of the energy goes into spinning and more is left for going down the slope. That is the whole of it.',
      'Every one of these is assumed to roll without slipping. On a slope steep enough or a surface slippery enough that stops being true, and then the order can change.'
    ]
  }
}

export const RIGID_BODY_ASSUMPTIONS: readonly string[] = Object.freeze([
  'A moment of inertia is always about a stated axis. The same object has a different one about a different axis, and the number alone cannot say which it was.',
  'Every object is rigid and uniform. A real one flexes and is rarely uniform, and both change the moment of inertia.',
  'Rolling without slipping is a constraint that needs enough friction. The coefficient required is computed rather than assumed, and below it none of the rolling results apply.',
  'Rotation is about a fixed axis in a plane. Nothing here handles a tumbling three-dimensional body, where the inertia is a tensor and the axis itself moves.',
  'Torque is taken about a stated pivot. A force through the pivot has no turning effect however large it is.'
])
