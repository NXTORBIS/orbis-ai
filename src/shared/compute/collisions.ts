/**
 * Collisions: what two bodies do when they meet, and what is conserved when they do.
 *
 * The shared collision engine for Orbis Pages. Everything here is exact — a collision is an algebraic problem, not
 * something to integrate — and the whole of the care in it goes into one distinction.
 *
 * ## Momentum is always conserved. Kinetic energy is not.
 *
 * In every collision here, total momentum before equals total momentum after. That is not an approximation and not
 * a property of elastic collisions; it follows from the two forces being equal and opposite for exactly as long as
 * each other, whatever happens in between.
 *
 * Kinetic energy is a different matter. It is conserved only when the collision is elastic, and in every other case
 * some of it goes into heat, sound and permanent deformation. That loss is **the physics**, not an error in the
 * calculation, and this engine never labels it one — a result that reported "energy error: 40%" after a car crash
 * would be describing the crash as a bug.
 *
 * ## The distinctions this file refuses to blur
 *
 * ```
 * momentum      vs   kinetic energy   -- one survives every collision, the other survives some
 * energy lost   vs   energy error     -- inelasticity is physics; a failure to conserve momentum would be a bug
 * elastic       vs   perfectly inelastic -- ends of a range, and restitution is where on it
 * normal        vs   tangential       -- a smooth collision changes one and leaves the other alone
 * speed         vs   closing speed    -- restitution is about how fast they separate, not how fast they move
 * ```
 *
 * Pure. No network, no clock, no storage.
 */

import { add, dot, magnitude, scale, subtract, vec, type Vec2 } from './mechanics.ts'

export interface CollisionError {
  error: 'invalid-argument' | 'not-finite' | 'not-approaching' | 'no-contact' | 'creates-energy'
  message: string
}

export const isCollisionError = (value: unknown): value is CollisionError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: CollisionError['error'], message: string): CollisionError => ({ error, message })

/**
 * How bouncy the collision is.
 *
 * The ratio of the speed they separate at to the speed they approached at. 1 is perfectly elastic — they separate as
 * fast as they met and no kinetic energy is lost. 0 is perfectly inelastic — they do not separate at all and move
 * off together. Anything between is the usual case.
 */
export type Restitution = number

export interface Audit {
  momentumBefore: Vec2
  momentumAfter: Vec2
  /** Should be zero to floating-point precision. Anything else here is a bug in the arithmetic, not physics. */
  momentumChange: number
  kineticEnergyBefore: number
  kineticEnergyAfter: number
  /** Positive when energy went into heat and deformation. Never called an error. */
  kineticEnergyLost: number
  /** That loss as a fraction of what there was to start with. */
  fractionLost: number
  /** True when the collision conserved kinetic energy, which only an elastic one does. */
  elastic: boolean
  why: string
}

function auditOf(
  masses: readonly [number, number],
  before: readonly [Vec2, Vec2],
  after: readonly [Vec2, Vec2]
): Audit {
  const [m1, m2] = masses
  const momentumBefore = add(scale(before[0], m1), scale(before[1], m2))
  const momentumAfter = add(scale(after[0], m1), scale(after[1], m2))
  const energyOf = (v: readonly [Vec2, Vec2]): number =>
    0.5 * m1 * dot(v[0], v[0]) + 0.5 * m2 * dot(v[1], v[1])
  const kineticBefore = energyOf(before)
  const kineticAfter = energyOf(after)
  const lost = kineticBefore - kineticAfter
  const fraction = kineticBefore === 0 ? 0 : lost / kineticBefore
  const elastic = Math.abs(fraction) < 1e-9

  return {
    momentumBefore,
    momentumAfter,
    momentumChange: magnitude(subtract(momentumAfter, momentumBefore)),
    kineticEnergyBefore: kineticBefore,
    kineticEnergyAfter: kineticAfter,
    kineticEnergyLost: lost,
    fractionLost: fraction,
    elastic,
    why: elastic
      ? 'Momentum and kinetic energy are both the same before and after: this collision is elastic. Momentum would have survived either way; the energy surviving is what makes it elastic.'
      : `Momentum is unchanged, as it is in every collision. ${(fraction * 100).toPrecision(4)}% of the kinetic energy went into heat, sound and permanent deformation — that is the collision rather than an error in working it out.`
  }
}

// ---------------------------------------------------------------- head on

export interface HeadOnCollision {
  before: { velocity1: number; velocity2: number }
  after: { velocity1: number; velocity2: number }
  masses: { mass1: number; mass2: number }
  restitution: number
  /** How fast they were closing before, and separating after. Their ratio is the restitution. */
  approachSpeed: number
  separationSpeed: number
  /** The velocity of the centre of mass, which no collision can change. */
  centreOfMassVelocity: number
  audit: Audit
  notes: readonly string[]
}

/**
 * Two bodies meeting in a straight line.
 *
 * Solved from the two things that are always true: momentum is conserved, and the separation speed is the
 * restitution times the approach speed. Those two give the answer for any restitution from 0 to 1, with the elastic
 * and perfectly inelastic cases falling out of the ends rather than being special-cased.
 */
export function headOnCollision(input: {
  mass1: number
  velocity1: number
  mass2: number
  velocity2: number
  restitution: Restitution
}): HeadOnCollision | CollisionError {
  const { mass1, velocity1, mass2, velocity2, restitution } = input
  if (![mass1, velocity1, mass2, velocity2, restitution].every((one) => Number.isFinite(one))) {
    return fail('not-finite', 'Every value must be a finite number.')
  }
  if (mass1 <= 0 || mass2 <= 0) return fail('invalid-argument', 'Both masses must be positive.')
  if (restitution < 0) return fail('invalid-argument', 'Restitution is not negative: a collision cannot leave them approaching faster than they arrived from the far side.')
  if (restitution > 1) {
    return fail(
      'creates-energy',
      `A restitution of ${restitution} would have them separate faster than they met, which means the collision gave them energy. Nothing here supplies any — that needs a spring, an explosion or a motor, not a collision.`
    )
  }

  const total = mass1 + mass2
  const centreOfMass = (mass1 * velocity1 + mass2 * velocity2) / total
  const approach = velocity1 - velocity2

  // Momentum: m1u1 + m2u2 = m1v1 + m2v2. Restitution: v2 − v1 = −e(u2 − u1).
  const after1 = centreOfMass - (restitution * mass2 * approach) / total
  const after2 = centreOfMass + (restitution * mass1 * approach) / total

  const audit = auditOf(
    [mass1, mass2],
    [vec(velocity1, 0), vec(velocity2, 0)],
    [vec(after1, 0), vec(after2, 0)]
  )

  const notes: string[] = [
    'The centre of mass moves at the same speed before and after. No collision can change it, because the forces the two bodies exert on each other cancel in the total.'
  ]
  if (restitution === 1) {
    if (mass1 === mass2) notes.push('Equal masses in an elastic collision simply exchange velocities. Every other outcome would break one of the two conservation laws.')
    if (mass2 > mass1 * 100) notes.push('A light body bouncing elastically off a much heavier one comes back at almost its original speed, and the heavy one barely moves — but it does move, and it has to for momentum to balance.')
  }
  if (restitution === 0) {
    notes.push(`They move off together at ${centreOfMass.toPrecision(6)}, which is the centre-of-mass velocity. That is what perfectly inelastic means: all the motion relative to the centre of mass is gone.`)
    notes.push('This is the largest loss of kinetic energy any collision can have with these masses and speeds. Losing more would mean ending up moving apart again.')
  }
  if (approach === 0) {
    notes.push('These two were not closing at all, so there was nothing to collide. The velocities come back unchanged.')
  } else if (approach < 0) {
    notes.push('These two were moving apart, not together. The result below is what the algebra gives; whether a collision happened at all is a question about where they were, not how fast they were going.')
  }

  return {
    before: { velocity1, velocity2 },
    after: { velocity1: after1, velocity2: after2 },
    masses: { mass1, mass2 },
    restitution,
    approachSpeed: approach,
    separationSpeed: after2 - after1,
    centreOfMassVelocity: centreOfMass,
    audit,
    notes
  }
}

// ---------------------------------------------------------------- glancing

export interface Disc {
  mass: number
  position: Vec2
  velocity: Vec2
  radius: number
}

export interface GlancingCollision {
  before: readonly [Vec2, Vec2]
  after: readonly [Vec2, Vec2]
  /** The line joining the centres, along which the impulse acts. */
  normal: Vec2
  /** How fast they were closing along that line. Only this component changes. */
  normalApproach: number
  /** How fast they were sliding past each other. Unchanged by a smooth collision. */
  tangentialSpeed: number
  restitution: number
  audit: Audit
  notes: readonly string[]
}

/**
 * Two discs meeting off-centre.
 *
 * The whole of it is one idea: the impulse acts along the line joining the centres, so only the components of
 * velocity along that line change and the components across it are untouched. Decompose, solve the head-on problem
 * along the normal, recombine. A glancing collision is a head-on collision in the right coordinates.
 *
 * Smooth by default — no friction at the contact — which is why the tangential component survives exactly. Real
 * contacts have friction and spin things up, and this says so rather than implying otherwise.
 */
export function glancingCollision(a: Disc, b: Disc, restitution: Restitution): GlancingCollision | CollisionError {
  for (const one of [a, b]) {
    if (!Number.isFinite(one.mass) || one.mass <= 0) return fail('invalid-argument', 'Both masses must be positive.')
    if (![one.position.x, one.position.y, one.velocity.x, one.velocity.y, one.radius].every((v) => Number.isFinite(v))) {
      return fail('not-finite', 'Every position, velocity and radius must be finite.')
    }
  }
  if (!Number.isFinite(restitution) || restitution < 0) return fail('invalid-argument', 'Restitution is zero or more.')
  if (restitution > 1) return fail('creates-energy', `A restitution of ${restitution} would give the pair more energy than they arrived with.`)

  const along = subtract(b.position, a.position)
  const separation = magnitude(along)
  if (separation === 0) {
    return fail('no-contact', 'The two centres are in the same place, so there is no line between them for the impulse to act along. Move them apart before colliding them.')
  }
  const normal = scale(along, 1 / separation)
  const tangent = vec(-normal.y, normal.x)

  // Decompose both velocities onto the normal and the tangent.
  const a1 = dot(a.velocity, normal)
  const a2 = dot(a.velocity, tangent)
  const b1 = dot(b.velocity, normal)
  const b2 = dot(b.velocity, tangent)

  const headOn = headOnCollision({ mass1: a.mass, velocity1: a1, mass2: b.mass, velocity2: b1, restitution })
  if (isCollisionError(headOn)) return headOn

  // Recombine: the new normal components, the old tangential ones.
  const afterA = add(scale(normal, headOn.after.velocity1), scale(tangent, a2))
  const afterB = add(scale(normal, headOn.after.velocity2), scale(tangent, b2))

  const audit = auditOf([a.mass, b.mass], [a.velocity, b.velocity], [afterA, afterB])

  const notes: string[] = [
    'The impulse acts along the line joining the centres, so only the velocity components along that line change. The components across it come through untouched — which is what makes this a head-on collision in the right coordinates.',
    'No friction at the contact, so nothing is spun up and the tangential components survive exactly. A real contact has friction and would put some of that sliding into rotation.'
  ]
  if (a1 - b1 <= 0) {
    notes.push('Along the line joining the centres these two were not approaching, so this is not a collision that would happen. The algebra still runs; whether the two ever touch is a question about their paths.')
  }
  if (Math.abs(a2 - b2) > Math.abs(a1 - b1)) {
    notes.push('They are sliding past each other faster than they are closing, so this is a glancing blow: most of the motion is unaffected by it.')
  }

  return {
    before: [a.velocity, b.velocity],
    after: [afterA, afterB],
    normal,
    normalApproach: a1 - b1,
    tangentialSpeed: a2 - b2,
    restitution,
    audit,
    notes
  }
}

// ---------------------------------------------------------------- when, if ever

export interface Contact {
  /** When they touch, in the same units as the velocities. Null when they never do. */
  time: number | null
  /** How close they get at their closest. */
  closestApproach: number
  /** When that is. */
  closestAt: number
  /** True when they are already overlapping. */
  alreadyTouching: boolean
  why: string
}

/**
 * Whether two discs moving in straight lines ever touch, and when.
 *
 * Solved exactly rather than by stepping forward and looking: a step-based check can pass straight through a contact
 * when the step is longer than the overlap lasts, which is the classic way a fast small object goes through a wall.
 */
export function timeToContact(a: Disc, b: Disc): Contact | CollisionError {
  for (const one of [a, b]) {
    if (![one.position.x, one.position.y, one.velocity.x, one.velocity.y, one.radius].every((v) => Number.isFinite(v))) {
      return fail('not-finite', 'Every position, velocity and radius must be finite.')
    }
    if (one.radius < 0) return fail('invalid-argument', 'A radius is not negative.')
  }

  const relativePosition = subtract(b.position, a.position)
  const relativeVelocity = subtract(b.velocity, a.velocity)
  const touching = a.radius + b.radius

  const startDistance = magnitude(relativePosition)
  if (startDistance <= touching) {
    return {
      time: 0,
      closestApproach: startDistance,
      closestAt: 0,
      alreadyTouching: true,
      why: 'They are already overlapping, so the contact time is now. Whatever put them there happened before this calculation.'
    }
  }

  const vv = dot(relativeVelocity, relativeVelocity)
  if (vv === 0) {
    return {
      time: null,
      closestApproach: startDistance,
      closestAt: 0,
      alreadyTouching: false,
      why: 'They are not moving relative to each other, so the distance between them never changes and they never touch.'
    }
  }

  // The closest approach is where the derivative of the squared distance is zero.
  const closestAt = -dot(relativePosition, relativeVelocity) / vv
  const atClosest = closestAt <= 0 ? startDistance : magnitude(add(relativePosition, scale(relativeVelocity, closestAt)))

  if (closestAt <= 0) {
    return {
      time: null,
      closestApproach: startDistance,
      closestAt: 0,
      alreadyTouching: false,
      why: 'They are already moving apart. The closest they ever get is where they are now.'
    }
  }
  if (atClosest > touching) {
    return {
      time: null,
      closestApproach: atClosest,
      closestAt,
      alreadyTouching: false,
      why: `They miss. The closest they get is ${atClosest.toPrecision(6)} at t = ${closestAt.toPrecision(6)}, and they would need to be within ${touching.toPrecision(6)} to touch.`
    }
  }

  // Solve |p + vt| = r₁ + r₂ for the first root.
  const b2 = 2 * dot(relativePosition, relativeVelocity)
  const c = dot(relativePosition, relativePosition) - touching * touching
  const discriminant = b2 * b2 - 4 * vv * c
  if (discriminant < 0) {
    return { time: null, closestApproach: atClosest, closestAt, alreadyTouching: false, why: 'They miss.' }
  }
  const time = (-b2 - Math.sqrt(discriminant)) / (2 * vv)

  return {
    time,
    closestApproach: atClosest,
    closestAt,
    alreadyTouching: false,
    why: `They first touch at t = ${time.toPrecision(6)}. Solved exactly rather than by stepping forward and checking — a step longer than the overlap lasts walks straight through a contact, which is how a fast small object goes through a wall.`
  }
}

// ---------------------------------------------------------------- the simplest frame

export interface CentreOfMassView {
  /** The velocity of the centre of mass in the original frame. */
  frameVelocity: Vec2
  /** The two velocities as seen from the centre of mass. */
  velocities: readonly [Vec2, Vec2]
  /** Their momenta, which are equal and opposite here by construction. */
  momenta: readonly [Vec2, Vec2]
  /** The kinetic energy that is available to be lost. */
  availableEnergy: number
  why: string
}

/**
 * The two bodies as seen from their own centre of mass.
 *
 * The frame where a collision is simplest: the two momenta are always equal and opposite, an elastic collision just
 * reverses both, and a perfectly inelastic one brings both to rest. It also answers a question that looks hard in
 * the original frame — how much kinetic energy a collision *can* lose — because the energy of the centre of mass
 * moving is untouchable and everything else is available.
 */
export function centreOfMassView(
  masses: readonly [number, number],
  velocities: readonly [Vec2, Vec2]
): CentreOfMassView | CollisionError {
  const [m1, m2] = masses
  if (!Number.isFinite(m1) || !Number.isFinite(m2) || m1 <= 0 || m2 <= 0) {
    return fail('invalid-argument', 'Both masses must be positive.')
  }
  const total = m1 + m2
  const frameVelocity = scale(add(scale(velocities[0], m1), scale(velocities[1], m2)), 1 / total)
  const inFrame: [Vec2, Vec2] = [subtract(velocities[0], frameVelocity), subtract(velocities[1], frameVelocity)]
  const available = 0.5 * m1 * dot(inFrame[0], inFrame[0]) + 0.5 * m2 * dot(inFrame[1], inFrame[1])

  return {
    frameVelocity,
    velocities: inFrame,
    momenta: [scale(inFrame[0], m1), scale(inFrame[1], m2)],
    availableEnergy: available,
    why: `Seen from the centre of mass the two momenta are equal and opposite, which they are in no other frame. The ${available.toPrecision(6)} of kinetic energy here is all a collision could possibly lose — the energy of the centre of mass itself moving cannot be touched, because no collision changes how fast it moves.`
  }
}

// ---------------------------------------------------------------- reading a result

export interface RestitutionEstimate {
  restitution: number
  approachSpeed: number
  separationSpeed: number
  /** What that restitution implies about the fraction of energy kept. */
  fractionKept: number
  describe: string
}

/**
 * Works the restitution out from a collision that already happened.
 *
 * The definition rather than a fit: restitution is the separation speed over the approach speed, so given both it is
 * a division. Useful for a measured collision, where the coefficient is what you are trying to find.
 */
export function restitutionFrom(input: {
  velocity1Before: number
  velocity2Before: number
  velocity1After: number
  velocity2After: number
}): RestitutionEstimate | CollisionError {
  const values = [input.velocity1Before, input.velocity2Before, input.velocity1After, input.velocity2After]
  if (!values.every((one) => Number.isFinite(one))) return fail('not-finite', 'Every velocity must be finite.')
  const approach = input.velocity1Before - input.velocity2Before
  const separation = input.velocity2After - input.velocity1After
  if (approach <= 0) {
    return fail(
      'not-approaching',
      'These two were not closing before the collision, so there is no approach speed to divide by. Restitution is defined for bodies that met.'
    )
  }
  const restitution = separation / approach
  return {
    restitution,
    approachSpeed: approach,
    separationSpeed: separation,
    fractionKept: restitution * restitution,
    describe:
      restitution > 1
        ? `A restitution of ${restitution.toPrecision(4)} means they left faster than they arrived. A collision cannot do that, so something supplied energy — a spring, a charge, a motor — or one of the four velocities is wrong.`
        : restitution < 0
          ? `A restitution of ${restitution.toPrecision(4)} means they were still closing afterwards, which means they passed through each other. Check the sign convention on the velocities.`
          : `A restitution of ${restitution.toPrecision(4)}: they separated at ${(restitution * 100).toPrecision(3)}% of the speed they met at, keeping ${(restitution * restitution * 100).toPrecision(3)}% of the kinetic energy that was available to lose.`
  }
}

export const COLLISION_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Momentum is conserved in every collision here, whatever the restitution. That is not an assumption about the collision; it follows from the two forces being equal, opposite and lasting exactly as long as each other.',
  'Kinetic energy is conserved only when the restitution is 1. Any loss below that is heat, sound and permanent deformation, and is reported as energy lost rather than as an error.',
  'Collisions happen instantaneously. Nothing here models the contact lasting a while, so there is no peak force and no contact time.',
  'Glancing collisions are smooth: no friction at the contact, so nothing is spun up and the tangential velocity survives exactly.',
  'Every body is a disc with a radius, or a point moving along a line. Shape beyond that does not enter.'
])
