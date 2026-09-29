/**
 * Magnetic fields, the forces they exert, and the voltage that appears when they change.
 *
 * The shared magnetism engine for Orbis Pages. Fields come from currents in named geometries — a straight wire, a
 * loop, a solenoid — with closed forms that are exact for those geometries and are not pretended to be exact for
 * anything else. Charged-particle motion is integrated, because the Lorentz force has no general closed form.
 *
 * ## The cross product is why nothing here is a scalar
 *
 * `F = qv × B` is zero when the velocity is along the field and largest when it is across it, and the force is
 * perpendicular to both — so a magnetic force never does work on a moving charge. It bends the path and cannot
 * change the speed. A Page treating magnetic force as "like electric force but magnetic" gets the most important
 * consequence backwards.
 *
 * ## Lenz's law is a sign, and the sign is the physics
 *
 * Faraday's law says the induced emf is −dΦ/dt. The minus sign is not bookkeeping: it says the induced current
 * opposes the change that made it, which is why a magnet dropped through a copper pipe falls slowly and why
 * generators are hard to turn under load. Dropping the sign turns a conservation law into a free-energy machine.
 *
 * ## The distinctions this file refuses to blur
 *
 * ```
 * B field      vs  H field       -- what the material sees against what the current drives
 * flux         vs  flux density  -- webers through a surface against teslas at a point
 * emf          vs  current       -- induction makes a voltage; what flows depends on the circuit
 * self         vs  mutual inductance -- a coil opposing its own change against one coil driving another
 * cyclotron    vs  helical motion -- a circle when v is across B, a helix when part of it is along B
 * ```
 *
 * Pure. No network, no clock, no storage.
 */

import { ELEMENTARY_CHARGE, ELECTRON_MASS, PROTON_MASS, VACUUM_PERMEABILITY } from './emConstants.ts'

export interface MagnetismError {
  error: 'invalid-argument' | 'not-finite' | 'on-the-wire' | 'too-many' | 'no-sources' | 'unstable'
  message: string
}

export const isMagnetismError = (value: unknown): value is MagnetismError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: MagnetismError['error'], message: string): MagnetismError => ({ error, message })

const finite = (value: number): boolean => Number.isFinite(value)

export const MAGNETISM_LIMITS = Object.freeze({
  sources: 100,
  gridPoints: 10_000,
  trajectorySteps: 200_000,
  trajectorySamples: 4000
})

// ---------------------------------------------------------------- vectors

export interface Vec3 {
  x: number
  y: number
  z: number
}

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z })

const plus = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
const minus = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k })
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x
})
const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z)

export interface FieldPoint {
  x: number
  y: number
  z: number
  magnitude: number
}

const asField = (v: Vec3): FieldPoint => ({ x: v.x, y: v.y, z: v.z, magnitude: length(v) })

// ---------------------------------------------------------------- sources

export type SourceShape = 'straight-wire' | 'circular-loop' | 'solenoid' | 'toroid'

export const SOURCE_SHAPES: readonly SourceShape[] = Object.freeze([
  'straight-wire',
  'circular-loop',
  'solenoid',
  'toroid'
])

export const SOURCE_FACTS: Readonly<
  Record<SourceShape, { label: string; formula: string; assumes: string; fallsOffAs: string }>
> = Object.freeze({
  'straight-wire': {
    label: 'Straight wire',
    formula: 'B = mu0*I / (2*pi*r)',
    assumes: 'The wire is infinitely long and infinitely thin. Near the ends of a real wire this reads high.',
    fallsOffAs: '1/r'
  },
  'circular-loop': {
    label: 'Circular loop',
    formula: 'B = mu0*I*R^2 / (2*(R^2 + z^2)^(3/2))  on the axis',
    assumes: 'Exact only on the axis. Off-axis needs an elliptic integral, which this engine does not attempt.',
    fallsOffAs: '1/z^3 far away'
  },
  solenoid: {
    label: 'Solenoid',
    formula: 'B = mu0*n*I  inside, near the middle',
    assumes: 'The solenoid is much longer than it is wide. At the ends the field is about half this.',
    fallsOffAs: 'roughly uniform inside, near zero outside'
  },
  toroid: {
    label: 'Toroid',
    formula: 'B = mu0*N*I / (2*pi*r)',
    assumes: 'The field is confined inside the ring and varies across the cross-section unless it is thin.',
    fallsOffAs: '1/r across the bore'
  }
})

export interface StraightWireReport {
  shape: 'straight-wire'
  current: number
  distance: number
  /** Teslas. */
  fieldStrength: number
  /** The direction at the sample point, from the right-hand rule. */
  direction: FieldPoint
  formula: string
  assumes: string
  notes: readonly string[]
}

/**
 * The field around a long straight wire carrying current along +z.
 *
 * The field circles the wire; it does not point away from it. Which way it circles is the right-hand rule, and it
 * is the one piece of this that a Page cannot state as a magnitude.
 */
export function straightWire(input: {
  current: number
  distance: number
  /** Where to sample, in the plane perpendicular to the wire. Defaults to the +x direction. */
  at?: { x: number; y: number }
}): StraightWireReport | MagnetismError {
  const { current, distance } = input
  if (!finite(current) || !finite(distance)) return fail('not-finite', 'Current and distance both have to be finite.')
  if (distance <= 0) {
    return fail('on-the-wire', 'The distance has to be greater than zero. The formula has no value on the wire itself.')
  }
  const strength = (VACUUM_PERMEABILITY * current) / (2 * Math.PI * distance)
  const at = input.at ?? { x: distance, y: 0 }
  const r = Math.hypot(at.x, at.y)
  // Current along +z, so B = (mu0 I / 2 pi r) * (ẑ × r̂), which is the anticlockwise tangent.
  const direction = r === 0 ? vec3(0, 0, 0) : vec3((-at.y / r) * strength, (at.x / r) * strength, 0)
  return {
    shape: 'straight-wire',
    current,
    distance,
    fieldStrength: strength,
    direction: asField(direction),
    formula: SOURCE_FACTS['straight-wire'].formula,
    assumes: SOURCE_FACTS['straight-wire'].assumes,
    notes: Object.freeze([
      'The field circles the wire rather than pointing away from it. Point your right thumb along the current and your fingers curl the way the field goes.',
      'It falls off as 1/r, not 1/r². The inverse square is for point sources, and an infinite wire is not one.'
    ])
  }
}

export interface LoopReport {
  shape: 'circular-loop'
  current: number
  radius: number
  /** Distance along the axis from the centre. */
  axialDistance: number
  fieldStrength: number
  /** What it is at the very centre, for comparison. */
  centreField: number
  /** A·m². */
  magneticMoment: number
  formula: string
  assumes: string
  notes: readonly string[]
}

/** The on-axis field of a current loop. Off the axis this formula is simply wrong, so it is not offered. */
export function circularLoop(input: {
  current: number
  radius: number
  axialDistance?: number
  turns?: number
}): LoopReport | MagnetismError {
  const { current, radius } = input
  const z = input.axialDistance ?? 0
  const turns = input.turns ?? 1
  if (!finite(current) || !finite(radius) || !finite(z) || !finite(turns)) {
    return fail('not-finite', 'Current, radius, distance and turns all have to be finite.')
  }
  if (radius <= 0) return fail('invalid-argument', 'The radius has to be greater than zero.')
  if (turns < 1 || !Number.isInteger(turns)) return fail('invalid-argument', 'The turn count has to be a whole number of at least 1.')

  const strength =
    (turns * VACUUM_PERMEABILITY * current * radius * radius) / (2 * Math.pow(radius * radius + z * z, 1.5))
  const centre = (turns * VACUUM_PERMEABILITY * current) / (2 * radius)
  return {
    shape: 'circular-loop',
    current,
    radius,
    axialDistance: z,
    fieldStrength: strength,
    centreField: centre,
    magneticMoment: turns * current * Math.PI * radius * radius,
    formula: SOURCE_FACTS['circular-loop'].formula,
    assumes: SOURCE_FACTS['circular-loop'].assumes,
    notes: Object.freeze([
      'This is the field on the axis only. Off the axis the loop field needs elliptic integrals and is not a simple expression.',
      'Far from the loop the field falls off as 1/z³, the same way a dipole does — which is what a small loop is.'
    ])
  }
}

export interface SolenoidReport {
  shape: 'solenoid'
  current: number
  turns: number
  length: number
  /** Turns per metre. */
  turnDensity: number
  /** Teslas, near the middle. */
  fieldInside: number
  /** Roughly half the middle value. */
  fieldAtEnd: number
  /** Henries. */
  inductance: number | null
  formula: string
  assumes: string
  notes: readonly string[]
}

/** A solenoid: nearly uniform inside, nearly nothing outside, and neither of those is exactly true. */
export function solenoid(input: {
  current: number
  turns: number
  length: number
  radius?: number
  coreRelativePermeability?: number
}): SolenoidReport | MagnetismError {
  const { current, turns, length: coilLength } = input
  if (!finite(current) || !finite(turns) || !finite(coilLength)) {
    return fail('not-finite', 'Current, turns and length all have to be finite.')
  }
  if (coilLength <= 0) return fail('invalid-argument', 'The length has to be greater than zero.')
  if (turns < 1) return fail('invalid-argument', 'A solenoid needs at least one turn.')
  const mur = input.coreRelativePermeability ?? 1
  if (!finite(mur) || mur <= 0) return fail('invalid-argument', 'The relative permeability has to be greater than zero.')

  const density = turns / coilLength
  const inside = mur * VACUUM_PERMEABILITY * density * current
  const notes: string[] = [
    'The field inside is uniform only near the middle. At each end it drops to about half, because half the coil is now behind you.',
    'The field outside an ideal solenoid is zero. A real one leaks, and the leakage is what lets you detect it from outside.'
  ]
  if (input.radius !== undefined && coilLength < input.radius * 5) {
    notes.push(
      'This coil is not much longer than it is wide, so the uniform-field formula overstates what is really inside it.'
    )
  }
  const inductance =
    input.radius !== undefined && finite(input.radius) && input.radius > 0
      ? (mur * VACUUM_PERMEABILITY * turns * turns * Math.PI * input.radius * input.radius) / coilLength
      : null

  return {
    shape: 'solenoid',
    current,
    turns,
    length: coilLength,
    turnDensity: density,
    fieldInside: inside,
    fieldAtEnd: inside / 2,
    inductance,
    formula: SOURCE_FACTS.solenoid.formula,
    assumes: SOURCE_FACTS.solenoid.assumes,
    notes: Object.freeze(notes)
  }
}

// ---------------------------------------------------------------- Biot-Savart over segments

export interface WireSegment {
  from: Vec3
  to: Vec3
  current: number
  label?: string
}

export interface SegmentFieldReport {
  at: Vec3
  field: FieldPoint
  contributions: readonly { label: string; field: FieldPoint }[]
  /** How finely each segment was divided. More pieces means a closer answer and more work. */
  pieces: number
  notes: readonly string[]
}

/**
 * The field at a point from a set of straight current segments, by numerically integrating Biot-Savart.
 *
 * This is what makes arbitrary geometry possible: a square loop, a helix, a bent wire. It is a numerical
 * integration, so it is approximate, and the number of pieces is reported rather than hidden — the answer depends
 * on it, and a Page that does not say so is presenting a convergence parameter as a fact.
 */
export function segmentField(
  segments: readonly WireSegment[],
  at: Vec3,
  pieces = 200
): SegmentFieldReport | MagnetismError {
  if (segments.length === 0) return fail('no-sources', 'There are no wire segments, so there is no field.')
  if (segments.length > MAGNETISM_LIMITS.sources) {
    return fail('too-many', `That is ${segments.length} segments; this handles up to ${MAGNETISM_LIMITS.sources}.`)
  }
  const n = Math.round(pieces)
  if (!Number.isInteger(n) || n < 1 || n > 2000) {
    return fail('invalid-argument', 'The piece count has to be a whole number between 1 and 2000.')
  }
  if (!finite(at.x) || !finite(at.y) || !finite(at.z)) return fail('not-finite', 'The sample point has to be finite.')

  let total = vec3()
  const contributions: { label: string; field: FieldPoint }[] = []
  let deepest = 0

  for (const [index, segment] of segments.entries()) {
    if (!finite(segment.current)) return fail('not-finite', `Segment ${index + 1} has a current that is not finite.`)
    const along = minus(segment.to, segment.from)
    const len = length(along)
    if (len === 0) continue

    // How close the point comes to the segment itself, not to any particular sample of it. Checking midpoints
    // instead lets a point sitting exactly on a symmetric wire slip through: every midpoint is some distance away,
    // the contributions cancel, and the answer comes back as a plausible zero for a question that has no answer.
    const t = Math.max(0, Math.min(1, dot(minus(at, segment.from), along) / (len * len)))
    const nearest = plus(segment.from, scale(along, t))
    const clearance = length(minus(at, nearest))
    if (clearance < len * 1e-9) {
      return fail(
        'on-the-wire',
        `The sample point lies on segment ${segment.label ?? index + 1}. Biot-Savart has no value on the wire itself.`
      )
    }

    const budget = { used: 0 }
    const contribution = integrate(segment, along, at, n, budget)
    deepest = Math.max(deepest, budget.used)
    total = plus(total, contribution)
    contributions.push({ label: segment.label ?? `segment ${index + 1}`, field: asField(contribution) })
  }

  return {
    at,
    field: asField(total),
    contributions: Object.freeze(contributions),
    pieces: Math.max(n, deepest),
    notes: Object.freeze([
      `Each segment started at ${n} pieces and was subdivided further wherever a piece was long compared with its distance from the sample point; ${Math.max(n, deepest)} pieces were used in the end.`,
      'That refinement is not cosmetic. A uniform division is badly wrong close to a wire, because a piece longer than its own distance is nothing like the point source the midpoint rule treats it as.'
    ])
  }
}

/** How many times a piece may be halved before the integrator gives up on refining it further. */
const MAX_REFINEMENT = 12

/**
 * Integrate one segment, subdividing any piece that is long compared with how far away the sample point is.
 *
 * The midpoint rule treats a piece as a point source at its centre. That is a good approximation when the piece is
 * short compared with its distance and a poor one when it is not — so the pieces near the sample point get halved
 * until they are, and the far ones are left alone. Uniform division would need thousands of pieces everywhere to
 * get what this gets with a few extra near the closest approach.
 */
function integrate(
  segment: WireSegment,
  along: Vec3,
  at: Vec3,
  pieces: number,
  budget: { used: number }
): Vec3 {
  const contribute = (fromT: number, toT: number, depth: number): Vec3 => {
    const span = toT - fromT
    const step = scale(along, span)
    const mid = plus(segment.from, scale(along, (fromT + toT) / 2))
    const r = minus(at, mid)
    const distance = length(r)
    const pieceLength = length(step)
    // Subdivide while the piece is not short compared with its own distance from the point.
    if (depth < MAX_REFINEMENT && pieceLength > distance / 4) {
      const middle = (fromT + toT) / 2
      return plus(contribute(fromT, middle, depth + 1), contribute(middle, toT, depth + 1))
    }
    budget.used += 1
    // dB = (mu0 I / 4 pi) * (dl x r) / r^3
    return scale(cross(step, r), (VACUUM_PERMEABILITY * segment.current) / (4 * Math.PI * Math.pow(distance, 3)))
  }

  let total = vec3()
  for (let i = 0; i < pieces; i += 1) {
    total = plus(total, contribute(i / pieces, (i + 1) / pieces, 0))
  }
  return total
}

// ---------------------------------------------------------------- Lorentz force

export interface LorentzReport {
  charge: number
  velocity: Vec3
  electricField: Vec3
  magneticField: Vec3
  /** Newtons, from the electric field alone. */
  electricForce: FieldPoint
  /** Newtons, from qv × B. */
  magneticForce: FieldPoint
  totalForce: FieldPoint
  /** Watts. The magnetic part is always exactly zero, and that is the point. */
  powerFromElectric: number
  powerFromMagnetic: number
  notes: readonly string[]
}

/**
 * The Lorentz force on a moving charge.
 *
 * The two halves are kept separate because they do genuinely different things: the electric part can speed the
 * particle up, and the magnetic part provably cannot. The reported magnetic power is computed rather than asserted
 * — it comes out as zero to floating-point precision, which is a demonstration rather than a claim.
 */
export function lorentzForce(input: {
  charge: number
  velocity: Vec3
  electricField?: Vec3
  magneticField?: Vec3
}): LorentzReport | MagnetismError {
  const { charge, velocity } = input
  const e = input.electricField ?? vec3()
  const b = input.magneticField ?? vec3()
  for (const [name, v] of Object.entries({ velocity, electricField: e, magneticField: b })) {
    if (!finite(v.x) || !finite(v.y) || !finite(v.z)) return fail('not-finite', `"${name}" has a component that is not finite.`)
  }
  if (!finite(charge)) return fail('not-finite', 'The charge has to be a finite number of coulombs.')

  const electric = scale(e, charge)
  const magnetic = scale(cross(velocity, b), charge)
  const total = plus(electric, magnetic)
  const notes: string[] = [
    'The magnetic force is perpendicular to the velocity, so its power is exactly zero. A magnetic field can bend a path but cannot change a speed.'
  ]
  const speed = length(velocity)
  const bMag = length(b)
  if (speed > 0 && bMag > 0) {
    const along = Math.abs(dot(velocity, b)) / (speed * bMag)
    if (along > 0.999) {
      notes.push('The velocity is almost exactly along the field, so there is almost no magnetic force at all.')
    }
  }

  return {
    charge,
    velocity,
    electricField: e,
    magneticField: b,
    electricForce: asField(electric),
    magneticForce: asField(magnetic),
    totalForce: asField(total),
    powerFromElectric: dot(electric, velocity),
    powerFromMagnetic: dot(magnetic, velocity),
    notes: Object.freeze(notes)
  }
}

// ---------------------------------------------------------------- charged particle motion

export type ParticleKind = 'electron' | 'proton' | 'custom'

export const PARTICLE_KINDS: readonly ParticleKind[] = Object.freeze(['electron', 'proton', 'custom'])

export const PARTICLE_FACTS: Readonly<Record<'electron' | 'proton', { charge: number; mass: number; label: string }>> =
  Object.freeze({
    electron: { charge: -ELEMENTARY_CHARGE, mass: ELECTRON_MASS, label: 'Electron' },
    proton: { charge: ELEMENTARY_CHARGE, mass: PROTON_MASS, label: 'Proton' }
  })

export interface TrajectorySample {
  time: number
  position: Vec3
  velocity: Vec3
  speed: number
  kineticEnergy: number
}

export interface TrajectoryReport {
  charge: number
  mass: number
  /** rad/s. |q|B/m, the rate it goes round. Null when there is no magnetic field. */
  cyclotronAngular: number | null
  /** Hz. Independent of speed, which is what makes a cyclotron work. */
  cyclotronFrequency: number | null
  /** Metres. Null when there is no perpendicular velocity or no field. */
  gyroradius: number | null
  /** Seconds for one turn. */
  period: number | null
  samples: readonly TrajectorySample[]
  /** How much the kinetic energy drifted over the run, as a fraction. Small is the proof the integrator behaved. */
  energyDrift: number
  motion: 'circular' | 'helical' | 'drift' | 'straight' | 'accelerating'
  notes: readonly string[]
}

/**
 * Integrate a charged particle through uniform electric and magnetic fields.
 *
 * Uses the Boris push, which is the standard method here for one specific reason: it conserves energy in a pure
 * magnetic field exactly, to machine precision, over arbitrarily many orbits. A naive Euler or Runge-Kutta step
 * spirals outward — the particle gains energy from nothing, which is the one thing the physics forbids — and a
 * Page showing that spiral would be showing an artefact of the arithmetic as though it were a result.
 */
export function trajectory(input: {
  particle?: ParticleKind
  charge?: number
  mass?: number
  initialPosition?: Vec3
  initialVelocity: Vec3
  electricField?: Vec3
  magneticField?: Vec3
  duration: number
  steps?: number
  samples?: number
}): TrajectoryReport | MagnetismError {
  const kind = input.particle ?? 'custom'
  let charge: number
  let mass: number
  if (kind === 'custom') {
    if (input.charge === undefined || input.mass === undefined) {
      return fail('invalid-argument', 'A custom particle needs both a charge and a mass.')
    }
    charge = input.charge
    mass = input.mass
  } else {
    charge = PARTICLE_FACTS[kind].charge
    mass = PARTICLE_FACTS[kind].mass
  }
  if (!finite(charge) || !finite(mass)) return fail('not-finite', 'Charge and mass both have to be finite.')
  if (mass <= 0) return fail('invalid-argument', 'The mass has to be greater than zero.')

  const e = input.electricField ?? vec3()
  const b = input.magneticField ?? vec3()
  const { duration } = input
  if (!finite(duration) || duration <= 0) return fail('invalid-argument', 'The duration has to be a positive time.')

  const bMag = length(b)
  const omega = bMag > 0 ? (Math.abs(charge) * bMag) / mass : null
  const period = omega !== null && omega > 0 ? (2 * Math.PI) / omega : null

  // Default to about 100 steps per orbit, which the Boris push handles comfortably.
  const defaultSteps = period !== null ? Math.ceil((duration / period) * 100) : 2000
  const steps = Math.round(input.steps ?? Math.min(Math.max(defaultSteps, 100), 50_000))
  if (!Number.isInteger(steps) || steps < 1 || steps > MAGNETISM_LIMITS.trajectorySteps) {
    return fail('invalid-argument', `The step count has to be a whole number between 1 and ${MAGNETISM_LIMITS.trajectorySteps}.`)
  }
  const wanted = Math.round(input.samples ?? Math.min(steps + 1, 1000))
  if (!Number.isInteger(wanted) || wanted < 2 || wanted > MAGNETISM_LIMITS.trajectorySamples) {
    return fail('invalid-argument', `The sample count has to be a whole number between 2 and ${MAGNETISM_LIMITS.trajectorySamples}.`)
  }

  const dt = duration / steps
  let position = input.initialPosition ?? vec3()
  let velocity = input.initialVelocity
  if (!finite(velocity.x) || !finite(velocity.y) || !finite(velocity.z)) {
    return fail('not-finite', 'The initial velocity has to be finite.')
  }

  const samples: TrajectorySample[] = []
  const every = Math.max(1, Math.floor(steps / (wanted - 1)))
  const startEnergy = 0.5 * mass * dot(velocity, velocity)
  let minEnergy = startEnergy
  let maxEnergy = startEnergy

  const record = (time: number): void => {
    const speed = length(velocity)
    const energy = 0.5 * mass * speed * speed
    minEnergy = Math.min(minEnergy, energy)
    maxEnergy = Math.max(maxEnergy, energy)
    samples.push({ time, position: { ...position }, velocity: { ...velocity }, speed, kineticEnergy: energy })
  }
  record(0)

  // Boris push: half an electric kick, a pure rotation about B, then the other half kick.
  const half = (charge * dt) / (2 * mass)
  const t = scale(b, half)
  const tSquared = dot(t, t)
  const s = scale(t, 2 / (1 + tSquared))

  for (let step = 1; step <= steps; step += 1) {
    const minus1 = plus(velocity, scale(e, half))
    const prime = plus(minus1, cross(minus1, t))
    const plus1 = plus(minus1, cross(prime, s))
    velocity = plus(plus1, scale(e, half))
    position = plus(position, scale(velocity, dt))
    if (!finite(position.x) || !finite(velocity.x)) {
      return fail('unstable', 'The trajectory ran away to values that are not finite. Try a smaller step or a shorter duration.')
    }
    if (step % every === 0 || step === steps) record(step * dt)
  }

  const speed0 = length(input.initialVelocity)
  const perpendicular =
    bMag > 0 && speed0 > 0 ? Math.sqrt(Math.max(0, speed0 * speed0 - Math.pow(dot(input.initialVelocity, b) / bMag, 2))) : 0
  const gyroradius = bMag > 0 && perpendicular > 0 ? (mass * perpendicular) / (Math.abs(charge) * bMag) : null

  let motion: TrajectoryReport['motion'] = 'straight'
  const eMag = length(e)
  if (bMag > 0 && eMag > 0) motion = 'drift'
  else if (bMag > 0) {
    const along = Math.abs(dot(input.initialVelocity, b)) / (bMag * (speed0 || 1))
    motion = along < 1e-9 ? 'circular' : 'helical'
  } else if (eMag > 0) motion = 'accelerating'

  const notes: string[] = []
  if (motion === 'circular') {
    notes.push('The velocity starts perpendicular to the field, so the path is a closed circle in the plane across it.')
  } else if (motion === 'helical') {
    notes.push(
      'Part of the velocity is along the field and feels no force, so the circular motion across the field is carried along it — a helix.'
    )
  } else if (motion === 'drift') {
    notes.push(
      'With both fields present the guiding centre drifts at E×B/B², a velocity that does not depend on the charge or the mass — positive and negative particles drift the same way.'
    )
  }
  if (period !== null) {
    notes.push(
      `The cyclotron period is ${period.toExponential(3)} s and does not depend on the speed. A faster particle traces a bigger circle in the same time, which is what a cyclotron exploits.`
    )
  }
  if (eMag === 0) {
    notes.push('With no electric field the speed is constant. The energy drift below is integration error, not physics.')
  }

  return {
    charge,
    mass,
    cyclotronAngular: omega,
    cyclotronFrequency: omega !== null ? omega / (2 * Math.PI) : null,
    gyroradius,
    period,
    samples: Object.freeze(samples),
    energyDrift: startEnergy === 0 ? 0 : (maxEnergy - minEnergy) / startEnergy,
    motion,
    notes: Object.freeze(notes)
  }
}

// ---------------------------------------------------------------- flux and induction

export interface FluxReport {
  /** Webers. */
  flux: number
  /** Teslas. */
  fieldStrength: number
  /** m². */
  area: number
  /** Radians between the field and the surface normal. */
  angle: number
  turns: number
  /** Webers linked by the whole coil: N times the flux through one turn. */
  linkage: number
  notes: readonly string[]
}

/** Flux through a flat surface in a uniform field. The angle is to the normal, not to the surface. */
export function flux(input: {
  fieldStrength: number
  area: number
  angleRadians?: number
  angleDegrees?: number
  turns?: number
}): FluxReport | MagnetismError {
  const { fieldStrength, area } = input
  if (!finite(fieldStrength) || !finite(area)) return fail('not-finite', 'Field and area both have to be finite.')
  if (area < 0) return fail('invalid-argument', 'The area cannot be negative.')
  const hasRadians = input.angleRadians !== undefined
  const hasDegrees = input.angleDegrees !== undefined
  if (hasRadians && hasDegrees) return fail('invalid-argument', 'Give the angle in radians or in degrees, not both.')
  const angle = hasDegrees ? ((input.angleDegrees as number) * Math.PI) / 180 : (input.angleRadians ?? 0)
  if (!finite(angle)) return fail('not-finite', 'The angle has to be finite.')
  const turns = input.turns ?? 1
  if (!Number.isInteger(turns) || turns < 1) return fail('invalid-argument', 'The turn count has to be a whole number of at least 1.')

  const value = fieldStrength * area * Math.cos(angle)
  return {
    flux: value,
    fieldStrength,
    area,
    angle,
    turns,
    linkage: turns * value,
    notes: Object.freeze([
      'The angle is measured to the surface normal. A field lying in the plane of the loop gives zero flux, not maximum flux.',
      'Flux is what threads the loop; flux density is the field at a point. They differ by an area and they have different units.'
    ])
  }
}

export interface InductionReport {
  /** Volts. Signed: the minus sign is Lenz's law and is not decoration. */
  emf: number
  /** Wb/s. */
  fluxRate: number
  turns: number
  /** Amps, when a resistance was given. */
  current: number | null
  /** Which way the induced current goes round, relative to the flux direction. */
  opposes: string
  notes: readonly string[]
}

/**
 * Faraday's law, with the sign kept.
 *
 * `emf = −N dΦ/dt`. The minus sign says the induced current makes a field that fights the change in flux — which
 * is why a generator gets harder to turn as you draw more current from it, and why dropping the sign turns
 * conservation of energy into a perpetual motion machine.
 */
export function induction(input: {
  fluxChange: number
  timeInterval: number
  turns?: number
  circuitResistance?: number
}): InductionReport | MagnetismError {
  const { fluxChange, timeInterval } = input
  if (!finite(fluxChange) || !finite(timeInterval)) return fail('not-finite', 'Flux change and time both have to be finite.')
  if (timeInterval <= 0) return fail('invalid-argument', 'The time interval has to be greater than zero.')
  const turns = input.turns ?? 1
  if (!Number.isInteger(turns) || turns < 1) return fail('invalid-argument', 'The turn count has to be a whole number of at least 1.')

  const rate = fluxChange / timeInterval
  const emf = -turns * rate
  let current: number | null = null
  if (input.circuitResistance !== undefined) {
    if (!finite(input.circuitResistance) || input.circuitResistance <= 0) {
      return fail('invalid-argument', 'The circuit resistance has to be greater than zero.')
    }
    current = emf / input.circuitResistance
  }

  return {
    emf,
    fluxRate: rate,
    turns,
    current,
    opposes:
      fluxChange > 0
        ? 'The flux is increasing, so the induced current flows the way that makes a field opposing it — clockwise when seen from the side the flux is coming toward.'
        : fluxChange < 0
          ? 'The flux is falling, so the induced current flows the way that tries to keep it up — anticlockwise seen from the same side.'
          : 'The flux is not changing, so nothing is induced. Induction responds to change, not to the field itself.',
    notes: Object.freeze([
      'The minus sign is Lenz’s law. The induced effect opposes whatever caused it, which is why a magnet falls slowly through a copper pipe and why a loaded generator is hard to turn.',
      'A steady field induces nothing however strong it is. Only a changing flux does.'
    ])
  }
}

export interface MotionalEmfReport {
  emf: number
  fieldStrength: number
  rodLength: number
  speed: number
  /** Amps, when a resistance was given. */
  current: number | null
  /** Newtons opposing the motion, when a current flows. */
  retardingForce: number | null
  /** Watts. */
  powerDissipated: number | null
  notes: readonly string[]
}

/** A rod sliding along rails: the simplest generator there is, and the one where the energy bookkeeping is visible. */
export function motionalEmf(input: {
  fieldStrength: number
  rodLength: number
  speed: number
  circuitResistance?: number
}): MotionalEmfReport | MagnetismError {
  const { fieldStrength, rodLength, speed } = input
  for (const [name, value] of Object.entries({ fieldStrength, rodLength, speed })) {
    if (!finite(value)) return fail('not-finite', `"${name}" has to be a finite number.`)
  }
  if (rodLength <= 0) return fail('invalid-argument', 'The rod length has to be greater than zero.')

  const emf = fieldStrength * rodLength * speed
  let current: number | null = null
  let force: number | null = null
  let power: number | null = null
  if (input.circuitResistance !== undefined) {
    if (!finite(input.circuitResistance) || input.circuitResistance <= 0) {
      return fail('invalid-argument', 'The circuit resistance has to be greater than zero.')
    }
    current = emf / input.circuitResistance
    force = fieldStrength * current * rodLength
    power = current * current * input.circuitResistance
  }

  return {
    emf,
    fieldStrength,
    rodLength,
    speed,
    current,
    retardingForce: force,
    powerDissipated: power,
    notes: Object.freeze([
      'The force on the rod opposes its motion, so something has to keep pushing. The mechanical power that push supplies is exactly the electrical power the resistor dissipates.',
      'Let go and the rod slows down. The kinetic energy it loses is the energy the circuit gains, which is the whole content of Lenz’s law here.'
    ])
  }
}

export interface InductanceReport {
  /** Henries. */
  selfInductance: number | null
  mutualInductance: number | null
  /** Volts, when a rate of current change was given. */
  inducedEmf: number | null
  /** Joules stored, when a current was given. */
  energy: number | null
  /** Dimensionless, 0 to 1. How much of one coil's flux reaches the other. */
  coupling: number | null
  notes: readonly string[]
}

/** Self and mutual inductance: a coil opposing its own change against one coil driving another. */
export function inductance(input: {
  selfInductance?: number
  secondInductance?: number
  couplingCoefficient?: number
  currentRate?: number
  current?: number
}): InductanceReport | MagnetismError {
  const self = input.selfInductance
  if (self !== undefined && (!finite(self) || self <= 0)) {
    return fail('invalid-argument', 'The self-inductance has to be greater than zero.')
  }
  let mutual: number | null = null
  let coupling: number | null = null
  if (input.secondInductance !== undefined) {
    if (self === undefined) return fail('invalid-argument', 'Mutual inductance needs both coils’ self-inductances.')
    if (!finite(input.secondInductance) || input.secondInductance <= 0) {
      return fail('invalid-argument', 'The second inductance has to be greater than zero.')
    }
    coupling = input.couplingCoefficient ?? 1
    if (!finite(coupling) || coupling < 0 || coupling > 1) {
      return fail('invalid-argument', 'The coupling coefficient has to be between 0 and 1. It is the fraction of flux that gets across.')
    }
    mutual = coupling * Math.sqrt(self * input.secondInductance)
  }

  let emf: number | null = null
  if (input.currentRate !== undefined) {
    if (self === undefined) return fail('invalid-argument', 'An induced emf needs an inductance.')
    if (!finite(input.currentRate)) return fail('not-finite', 'The rate of current change has to be finite.')
    emf = -self * input.currentRate
  }
  let energy: number | null = null
  if (input.current !== undefined) {
    if (self === undefined) return fail('invalid-argument', 'Stored energy needs an inductance.')
    if (!finite(input.current)) return fail('not-finite', 'The current has to be finite.')
    energy = 0.5 * self * input.current * input.current
  }

  return {
    selfInductance: self ?? null,
    mutualInductance: mutual,
    inducedEmf: emf,
    energy,
    coupling,
    notes: Object.freeze([
      'Self-inductance is a coil opposing changes in its own current. That is why a switch sparks when it opens an inductive circuit: the current cannot stop instantly, so the voltage rises until something gives.',
      'Mutual inductance is capped at the square root of the product of the two self-inductances. A coupling coefficient of 1 means every field line from one coil passes through the other, which no real pair quite achieves.'
    ])
  }
}

/** Everything a Page should be able to show about what this engine is standing on. */
export const MAGNETISM_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Currents are steady unless a calculation says otherwise. Radiation from accelerating charges is not modelled anywhere here.',
  'Named geometries use their exact closed forms and their stated idealisations: infinite wires, thin coils, long solenoids.',
  'Materials are linear. Relative permeability is one number; saturation, hysteresis and remanence are not modelled.',
  'Particle motion is non-relativistic. Above about a tenth of the speed of light the mass in these equations is the wrong mass.',
  'Fields are uniform where a function says uniform. A real magnet is not, and the difference grows with distance.'
])
