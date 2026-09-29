/**
 * Gravity: the force between two masses, the field around them, and the orbits that result.
 *
 * The shared gravitation engine for Orbis Pages. The two-body problem is solved exactly — a conic section is an
 * algebraic object and integrating toward one is a way of getting a worse answer slowly — and anything with three or
 * more bodies goes through `mechanics.ts`, which has no closed form to reach for.
 *
 * ## Classifying an orbit
 *
 * An orbit is bound, parabolic or hyperbolic according to its **energy**, and circular or elliptical according to
 * its **eccentricity**. Neither is decided by what the path looks like: a hyperbola near its periapsis looks like a
 * tight curve, a very eccentric ellipse looks like a hyperbola over a short arc, and at the resolution of a screen a
 * parabolic escape and a barely-bound orbit are the same picture. So the classification here comes from the numbers
 * and the numbers are shown beside it.
 *
 * ## Two dimensions, said out loud
 *
 * This works in a plane. Three of the six classical orbital elements — inclination, longitude of the ascending node
 * and, with them, any notion of an orbital plane — describe how an orbit is oriented in three-dimensional space and
 * have no meaning here. They are reported as `null` with a reason rather than as zero, because a zero inclination is
 * a claim about a three-dimensional orbit and not the absence of one.
 *
 * Pure. No network, no clock, no storage.
 */

import {
  add,
  body,
  cross,
  dot,
  isMechanicsError,
  magnitude,
  run,
  scale,
  subtract,
  system,
  vec,
  type Body,
  type Run,
  type Vec2
} from './mechanics.ts'

export interface GravitationError {
  error: 'invalid-argument' | 'not-finite' | 'degenerate' | 'unbound' | 'too-many-bodies'
  message: string
}

export const isGravitationError = (value: unknown): value is GravitationError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: GravitationError['error'], message: string): GravitationError => ({ error, message })

/** The measured value, from `constants.ts`. Repeated here as a default so this engine stands alone. */
export const GRAVITATIONAL_CONSTANT = 6.6743e-11

// ---------------------------------------------------------------- the force and the field

export interface GravityBetween {
  force: number
  /** From the first toward the second. */
  direction: Vec2
  separation: number
  /** The acceleration each one gets, which differs because the masses do. */
  acceleration1: number
  acceleration2: number
  why: string
}

export function gravityBetween(input: {
  mass1: number
  mass2: number
  position1: Vec2
  position2: Vec2
  constant?: number
}): GravityBetween | GravitationError {
  const { mass1, mass2, position1, position2 } = input
  const G = input.constant ?? GRAVITATIONAL_CONSTANT
  if (![mass1, mass2, position1.x, position1.y, position2.x, position2.y, G].every((one) => Number.isFinite(one))) {
    return fail('not-finite', 'Every value must be finite.')
  }
  if (mass1 <= 0 || mass2 <= 0) return fail('invalid-argument', 'Both masses must be positive.')
  const along = subtract(position2, position1)
  const separation = magnitude(along)
  if (separation === 0) {
    return fail(
      'degenerate',
      'The two masses are in the same place. The inverse square law has no value at zero separation — the force is not large there, it is undefined.'
    )
  }
  const force = (G * mass1 * mass2) / (separation * separation)
  return {
    force,
    direction: scale(along, 1 / separation),
    separation,
    acceleration1: force / mass1,
    acceleration2: force / mass2,
    why: `Equal and opposite forces of ${force.toPrecision(6)}, giving accelerations of ${(force / mass1).toPrecision(4)} and ${(force / mass2).toPrecision(4)}. The forces are the same size and the accelerations are not, which is why a dropped stone falls toward the Earth and the Earth does not noticeably rise to meet it.`
  }
}

export interface FieldSample {
  at: Vec2
  /** Acceleration a test mass would feel here. Independent of that mass. */
  field: Vec2
  strength: number
  /** Energy per unit mass. Negative everywhere, approaching zero far away. */
  potential: number
}

export interface FieldGrid {
  samples: readonly FieldSample[]
  /** The largest field strength on the grid, for scaling arrows. */
  strongest: number
  /** Points that landed on a source and had to be skipped. */
  skipped: number
  notes: readonly string[]
}

/**
 * The gravitational field on a grid of points.
 *
 * The field is an acceleration, not a force: it is what a test mass would feel per unit of its own mass, and so does
 * not depend on that mass at all. That is the whole reason for having a field rather than a force — it belongs to the
 * sources and the place, not to whatever happens to be there.
 */
export function fieldGrid(
  sources: readonly { mass: number; position: Vec2 }[],
  area: { xFrom: number; xTo: number; yFrom: number; yTo: number; columns: number; rows: number },
  constant = GRAVITATIONAL_CONSTANT
): FieldGrid | GravitationError {
  if (sources.length === 0) return fail('invalid-argument', 'There are no masses, so there is no field.')
  if (sources.length > 200) return fail('too-many-bodies', 'More than 200 sources is refused.')
  for (const one of sources) {
    if (!Number.isFinite(one.mass) || one.mass <= 0) return fail('invalid-argument', 'Every source mass must be positive.')
    if (!Number.isFinite(one.position.x) || !Number.isFinite(one.position.y)) return fail('not-finite', 'Every source position must be finite.')
  }
  const columns = Math.round(area.columns)
  const rows = Math.round(area.rows)
  if (columns < 2 || rows < 2 || columns * rows > 40_000) {
    return fail('invalid-argument', 'The grid needs at least 2 by 2 points and at most 40000 in all.')
  }
  if (area.xTo <= area.xFrom || area.yTo <= area.yFrom) return fail('invalid-argument', 'The area needs a positive width and height.')

  const samples: FieldSample[] = []
  let strongest = 0
  let skipped = 0

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const at = vec(
        area.xFrom + ((area.xTo - area.xFrom) * column) / (columns - 1),
        area.yFrom + ((area.yTo - area.yFrom) * row) / (rows - 1)
      )
      let field = vec(0, 0)
      let potential = 0
      let onSource = false
      for (const source of sources) {
        const along = subtract(source.position, at)
        const separation = magnitude(along)
        if (separation === 0) {
          onSource = true
          break
        }
        field = add(field, scale(along, (constant * source.mass) / (separation * separation * separation)))
        potential -= (constant * source.mass) / separation
      }
      if (onSource) {
        skipped += 1
        continue
      }
      const strength = magnitude(field)
      if (strength > strongest) strongest = strength
      samples.push({ at, field, strength, potential })
    }
  }

  const notes: string[] = [
    'The field is an acceleration, not a force. It is what a test mass would feel per unit of its own mass, so it does not depend on that mass — which is the point of having a field rather than a force.',
    'The potential is negative everywhere and approaches zero far from everything. Where zero sits is a choice, and this one puts it at infinite distance; only differences in potential ever matter.'
  ]
  if (skipped > 0) {
    notes.push(`${skipped} grid point${skipped === 1 ? '' : 's'} landed exactly on a mass and ${skipped === 1 ? 'was' : 'were'} left out. The field there is undefined rather than very large.`)
  }
  notes.push('Arrow lengths on a plot have to be scaled: the field near a mass is thousands of times the field at the edge, so drawing them to scale makes everything but the centre invisible.')

  return { samples, strongest, skipped, notes }
}

// ---------------------------------------------------------------- one body round another

export type OrbitShape = 'circular' | 'elliptical' | 'parabolic' | 'hyperbolic' | 'radial'

export const SHAPE_FACTS: Readonly<Record<OrbitShape, { label: string; describe: string; bound: boolean }>> = Object.freeze({
  circular: {
    label: 'Circular',
    describe: 'Eccentricity zero: the distance never changes and neither does the speed. A single exact speed at a given radius produces it, so no real orbit is quite circular.',
    bound: true
  },
  elliptical: {
    label: 'Elliptical',
    describe: 'Bound and closed: it comes back. Fastest at periapsis and slowest at apoapsis, trading speed for height and back again for ever.',
    bound: true
  },
  parabolic: {
    label: 'Parabolic',
    describe: 'Exactly the escape case: total energy zero, arriving at infinity with nothing left. A knife edge that nothing real sits on — it is the boundary between the other two.',
    bound: false
  },
  hyperbolic: {
    label: 'Hyperbolic',
    describe: 'Unbound: it passes once and leaves with speed to spare. Total energy positive, and the excess is what it still has when the central body is far behind it.',
    bound: false
  },
  radial: {
    label: 'Radial',
    describe: 'Straight at or away from the centre, with no angular momentum at all. Not really an orbit — a fall, or a throw straight up.',
    bound: true
  }
})

export interface Orbit {
  shape: OrbitShape
  bound: boolean
  /** Distance and speed at the moment described. */
  radius: number
  speed: number
  /** Energy per unit orbiting mass. Negative for a bound orbit, and that sign is the classification. */
  specificEnergy: number
  /** Angular momentum per unit orbiting mass. Constant along the whole orbit. */
  specificAngularMomentum: number
  eccentricity: number
  /** Null for a parabolic orbit, where it is infinite. */
  semiMajorAxis: number | null
  semiLatusRectum: number
  /** Closest approach. Always defined. */
  periapsis: number
  /** Furthest. Null for anything unbound, which never comes back. */
  apoapsis: number | null
  /** Null for anything unbound, which has no period. */
  period: number | null
  /** Angle from periapsis to where it is now, in degrees. */
  trueAnomaly: number
  /** Direction of periapsis, in degrees. */
  argumentOfPeriapsis: number
  /** Always null here, and the reason is on the result rather than implied by a zero. */
  inclination: null
  longitudeOfAscendingNode: null
  /** The speed a circular orbit would have at this radius, for comparison. */
  circularSpeedHere: number
  escapeSpeedHere: number
  notes: readonly string[]
}

/**
 * The orbit a body is on, from where it is and how fast it is going.
 *
 * Everything comes from two conserved quantities — the specific energy and the specific angular momentum — and both
 * are reported, because the classification is a statement about them rather than about the shape of the drawing.
 *
 * The central mass is taken to dominate. For a satellite round a planet that is right to many decimal places; for
 * two comparable masses it is not, and the note says so rather than quietly being wrong.
 */
export function orbitFrom(input: {
  centralMass: number
  position: Vec2
  velocity: Vec2
  /** The orbiting mass, used only to decide whether the two-body approximation is reasonable. */
  orbitingMass?: number
  constant?: number
}): Orbit | GravitationError {
  const { centralMass, position, velocity } = input
  const G = input.constant ?? GRAVITATIONAL_CONSTANT
  if (![centralMass, position.x, position.y, velocity.x, velocity.y, G].every((one) => Number.isFinite(one))) {
    return fail('not-finite', 'Every value must be finite.')
  }
  if (centralMass <= 0) return fail('invalid-argument', 'The central mass must be positive.')
  if (G <= 0) return fail('invalid-argument', 'The gravitational constant must be positive.')

  const mu = G * centralMass
  const r = magnitude(position)
  if (r === 0) {
    return fail('degenerate', 'The body is at the centre. There is no orbit through the singularity, and the force there is undefined rather than large.')
  }
  const v = magnitude(velocity)

  const specificEnergy = (v * v) / 2 - mu / r
  const h = cross(position, velocity)

  // The eccentricity vector: points at periapsis, with length equal to the eccentricity.
  const eVector = scale(
    subtract(scale(position, v * v - mu / r), scale(velocity, dot(position, velocity))),
    1 / mu
  )
  const eccentricity = magnitude(eVector)
  const semiLatusRectum = (h * h) / mu

  let shape: OrbitShape
  if (Math.abs(h) < 1e-12 * r * v || (h === 0 && r > 0)) shape = 'radial'
  else if (eccentricity < 1e-10) shape = 'circular'
  else if (Math.abs(eccentricity - 1) < 1e-10) shape = 'parabolic'
  else if (eccentricity < 1) shape = 'elliptical'
  else shape = 'hyperbolic'

  const bound = SHAPE_FACTS[shape].bound
  const semiMajorAxis = shape === 'parabolic' ? null : -mu / (2 * specificEnergy)
  const periapsis = shape === 'parabolic' ? semiLatusRectum / 2 : (semiMajorAxis ?? 0) * (1 - eccentricity)
  const apoapsis = bound && semiMajorAxis !== null && shape !== 'radial' ? semiMajorAxis * (1 + eccentricity) : null
  const period =
    bound && semiMajorAxis !== null && semiMajorAxis > 0
      ? 2 * Math.PI * Math.sqrt((semiMajorAxis * semiMajorAxis * semiMajorAxis) / mu)
      : null

  const degrees = (radians: number): number => ((radians * 180) / Math.PI + 360) % 360
  const argumentOfPeriapsis = eccentricity < 1e-10 ? 0 : degrees(Math.atan2(eVector.y, eVector.x))
  let trueAnomaly = 0
  if (eccentricity >= 1e-10) {
    const cosine = Math.max(-1, Math.min(1, dot(eVector, position) / (eccentricity * r)))
    trueAnomaly = (Math.acos(cosine) * 180) / Math.PI
    // Past periapsis and heading out, the anomaly is on the far side of the turn.
    if (dot(position, velocity) < 0) trueAnomaly = 360 - trueAnomaly
  }

  const circularSpeedHere = Math.sqrt(mu / r)
  const escapeSpeedHere = Math.sqrt((2 * mu) / r)

  const notes: string[] = [SHAPE_FACTS[shape].describe]
  notes.push(
    `Classified from the numbers rather than the picture: specific energy ${specificEnergy.toPrecision(6)} ${specificEnergy < 0 ? '(negative, so bound)' : specificEnergy > 0 ? '(positive, so it escapes)' : '(exactly zero, the escape boundary)'} and eccentricity ${eccentricity.toPrecision(6)}.`
  )
  notes.push(
    `At this radius a circular orbit needs ${circularSpeedHere.toPrecision(6)} and escape needs ${escapeSpeedHere.toPrecision(6)}. This body has ${v.toPrecision(6)}.`
  )
  if (shape === 'radial') {
    notes.push('There is no angular momentum at all, so this is motion straight along a radius — a fall or a throw, not an orbit. Most of the elements below have no meaning for it.')
  }
  if (input.orbitingMass !== undefined && input.orbitingMass > centralMass / 1000) {
    notes.push(
      `The orbiting mass is ${((input.orbitingMass / centralMass) * 100).toPrecision(3)}% of the central one, which is enough to matter. These elements assume the centre stays put; in reality both orbit their common centre of mass and the real period is shorter than the one below.`
    )
  }
  notes.push('Inclination and the ascending node are not reported. They describe how an orbit is tilted in three dimensions, and this engine works in a plane — a zero there would be a claim rather than the absence of one.')
  if (eccentricity > 0.9 && bound) {
    notes.push('A highly eccentric orbit spends almost all its time near apoapsis, moving slowly, and crosses the inner part in a rush. An evenly spaced sample of it in time looks nothing like an evenly spaced sample in angle.')
  }

  return {
    shape,
    bound,
    radius: r,
    speed: v,
    specificEnergy,
    specificAngularMomentum: h,
    eccentricity,
    semiMajorAxis,
    semiLatusRectum,
    periapsis,
    apoapsis,
    period,
    trueAnomaly,
    argumentOfPeriapsis,
    inclination: null,
    longitudeOfAscendingNode: null,
    circularSpeedHere,
    escapeSpeedHere,
    notes
  }
}

/** The speed a circular orbit needs at a given radius. */
export function circularSpeed(centralMass: number, radius: number, constant = GRAVITATIONAL_CONSTANT): number | GravitationError {
  if (!Number.isFinite(centralMass) || centralMass <= 0) return fail('invalid-argument', 'The central mass must be positive.')
  if (!Number.isFinite(radius) || radius <= 0) return fail('invalid-argument', 'The radius must be positive.')
  return Math.sqrt((constant * centralMass) / radius)
}

/** The speed needed to escape from a given radius, never to return. */
export function escapeSpeed(centralMass: number, radius: number, constant = GRAVITATIONAL_CONSTANT): number | GravitationError {
  const circular = circularSpeed(centralMass, radius, constant)
  if (isGravitationError(circular)) return circular
  return circular * Math.SQRT2
}

export interface OrbitPath {
  points: readonly { trueAnomaly: number; radius: number; position: Vec2 }[]
  /** How much of the conic was drawn. A full turn for a closed orbit, less for an open one. */
  sweptDegrees: number
  notes: readonly string[]
}

/**
 * The shape of the orbit, as points to draw.
 *
 * From the conic equation rather than by integrating: `r = p / (1 + e·cos ν)`. An ellipse comes back exactly to
 * where it started, which an integrated one does not, and an open orbit is drawn only over the range of angles it
 * actually reaches rather than swinging round through the asymptote.
 */
export function orbitPath(one: Orbit, points = 360): OrbitPath | GravitationError {
  const count = Math.min(4000, Math.max(16, Math.round(points)))
  if (one.shape === 'radial') {
    return fail('degenerate', 'A radial path is a straight line at the centre, not a conic. There is no shape to draw.')
  }

  // An open orbit only reaches the angles where the denominator stays positive.
  const limit = one.eccentricity > 1 ? (Math.acos(-1 / one.eccentricity) * 180) / Math.PI : 180
  const span = one.eccentricity >= 1 ? Math.min(limit - 0.5, 179.5) : 180

  const out: { trueAnomaly: number; radius: number; position: Vec2 }[] = []
  const rotate = (one.argumentOfPeriapsis * Math.PI) / 180
  for (let i = 0; i < count; i += 1) {
    const nu = (-span + (2 * span * i) / (count - 1)) * (Math.PI / 180)
    const denominator = 1 + one.eccentricity * Math.cos(nu)
    if (denominator <= 1e-9) continue
    const r = one.semiLatusRectum / denominator
    const angle = nu + rotate
    out.push({ trueAnomaly: (nu * 180) / Math.PI, radius: r, position: vec(r * Math.cos(angle), r * Math.sin(angle)) })
  }

  const notes: string[] = [
    'Drawn from the conic equation r = p / (1 + e·cos ν) rather than by integrating. A closed orbit therefore closes exactly, which an integrated path never quite does.'
  ]
  if (one.eccentricity >= 1) {
    notes.push(
      `An open orbit only reaches true anomalies within ±${limit.toPrecision(5)}°, where the conic still has a finite radius. Beyond that is the asymptote, and the body is already infinitely far away.`
    )
  }
  return { points: out, sweptDegrees: 2 * span, notes }
}

export interface OrbitComparison {
  entries: {
    label: string
    shape: OrbitShape
    eccentricity: number
    semiMajorAxis: number | null
    period: number | null
    periapsis: number
    apoapsis: number | null
    specificEnergy: number
  }[]
  notes: readonly string[]
}

/**
 * Two or more orbits side by side.
 *
 * Kepler's third law is visible here rather than asserted: the ratio of the squared periods is the ratio of the
 * cubed semi-major axes, and that holds whatever the eccentricities are. Two wildly different-looking orbits with
 * the same semi-major axis take exactly the same time.
 */
export function compareOrbits(orbits: readonly { label: string; orbit: Orbit }[]): OrbitComparison | GravitationError {
  if (orbits.length === 0) return fail('invalid-argument', 'There are no orbits to compare.')
  const entries = orbits.map((one) => ({
    label: one.label,
    shape: one.orbit.shape,
    eccentricity: one.orbit.eccentricity,
    semiMajorAxis: one.orbit.semiMajorAxis,
    period: one.orbit.period,
    periapsis: one.orbit.periapsis,
    apoapsis: one.orbit.apoapsis,
    specificEnergy: one.orbit.specificEnergy
  }))

  const notes: string[] = [
    'The period depends only on the semi-major axis, not on the eccentricity. Two orbits that look nothing alike take exactly the same time round if their semi-major axes match — that is Kepler’s third law, and it is visible in the table rather than asserted beside it.'
  ]
  const bound = entries.filter((one) => one.period !== null && one.semiMajorAxis !== null)
  if (bound.length >= 2) {
    const first = bound[0]
    const second = bound[1]
    if (first !== undefined && second !== undefined && first.semiMajorAxis !== null && second.semiMajorAxis !== null) {
      const periodRatio = (second.period as number) / (first.period as number)
      const axisRatio = second.semiMajorAxis / first.semiMajorAxis
      notes.push(
        `${second.label} has ${axisRatio.toPrecision(4)} times the semi-major axis of ${first.label} and ${periodRatio.toPrecision(4)} times the period. The cube of the first is ${(axisRatio ** 1.5).toPrecision(4)}, which is the second.`
      )
    }
  }
  if (entries.some((one) => one.period === null)) {
    notes.push('An unbound orbit has no period and no apoapsis. Those are blank rather than large, because it never comes back at all.')
  }
  return { entries, notes }
}

// ---------------------------------------------------------------- many bodies

export interface NBodyResult {
  run: Run
  /** Total angular momentum about the origin, which a closed gravitational system conserves. */
  angularMomentum: { initial: number; final: number; drift: number }
  centreOfMass: { initial: Vec2; final: Vec2 }
  notes: readonly string[]
}

/**
 * Several bodies pulling on each other.
 *
 * There is no closed form past two bodies, so this integrates — through `mechanics.ts`, with velocity Verlet, which
 * keeps the energy bounded rather than letting the whole system spiral. Angular momentum is checked as well as
 * energy, because a gravitational system conserves both and the two catch different mistakes.
 *
 * Softening is a real parameter rather than a hidden guard. Two point masses passing arbitrarily close produce an
 * arbitrarily large force and no step is small enough; softening changes the physics at short range so that they do
 * not, and anything that relies on a close pass has to know it is there.
 */
export function nBody(
  bodies: readonly Body[],
  options: { constant?: number; softening?: number; step: number; until: number; samples?: number }
): NBodyResult | GravitationError {
  if (bodies.length < 2) return fail('invalid-argument', 'At least two bodies are needed for anything to pull on anything.')
  if (bodies.length > 500) return fail('too-many-bodies', 'More than 500 bodies is refused: the work goes as the square of the count.')

  const built = system(bodies, [
    { kind: 'mutual-gravity', constant: options.constant ?? GRAVITATIONAL_CONSTANT, softening: options.softening ?? 0 }
  ])
  if (isMechanicsError(built)) return fail('invalid-argument', built.message)

  const result = run(built, {
    integrator: 'velocity-verlet',
    step: options.step,
    until: options.until,
    samples: options.samples ?? 1000
  })
  if (isMechanicsError(result)) return fail('invalid-argument', result.message)

  const angularOf = (positions: readonly Vec2[], velocities: readonly Vec2[]): number => {
    let total = 0
    for (let i = 0; i < bodies.length; i += 1) {
      const one = bodies[i]
      const at = positions[i]
      const v = velocities[i]
      if (one === undefined || at === undefined || v === undefined || one.fixed) continue
      total += one.mass * cross(at, v)
    }
    return total
  }
  const centreOf = (positions: readonly Vec2[]): Vec2 => {
    let mass = 0
    let x = 0
    let y = 0
    for (let i = 0; i < bodies.length; i += 1) {
      const one = bodies[i]
      const at = positions[i]
      if (one === undefined || at === undefined) continue
      mass += one.mass
      x += one.mass * at.x
      y += one.mass * at.y
    }
    return mass === 0 ? vec(0, 0) : vec(x / mass, y / mass)
  }

  const first = result.trace[0]
  const startPositions = first?.positions ?? bodies.map((one) => one.position)
  const startVelocities = first?.velocities ?? bodies.map((one) => one.velocity)
  const initialAngular = angularOf(startPositions, startVelocities)
  const finalAngular = angularOf(result.final.positions, result.final.velocities)
  const angularScale = Math.abs(initialAngular) > 0 ? Math.abs(initialAngular) : 1

  const notes: string[] = [
    'There is no closed form past two bodies, so this is integrated. Velocity Verlet keeps the energy bounded rather than letting the whole system spiral in or out, which a non-symplectic method does convincingly.',
    'Energy and angular momentum are both checked. A gravitational system conserves both, and they catch different mistakes — a force applied to only one of a pair breaks momentum while leaving energy looking fine.'
  ]
  if ((options.softening ?? 0) === 0) {
    notes.push('No softening. Two bodies passing very close produce a very large force and no step is small enough; if this run diverged, that is almost certainly why.')
  } else {
    notes.push(`Softening of ${options.softening}. This changes the physics at short range so that a close pass cannot produce an unbounded force — which means anything depending on a near miss is no longer the real answer.`)
  }
  notes.push(...result.notes)

  return {
    run: result,
    angularMomentum: {
      initial: initialAngular,
      final: finalAngular,
      drift: Math.abs(finalAngular - initialAngular) / angularScale
    },
    centreOfMass: { initial: centreOf(startPositions), final: centreOf(result.final.positions) },
    notes
  }
}

/** A two-body pair set up to orbit their common centre of mass, for an N-body run. */
export function orbitingPair(input: {
  mass1: number
  mass2: number
  separation: number
  constant?: number
}): readonly Body[] | GravitationError {
  const { mass1, mass2, separation } = input
  const G = input.constant ?? GRAVITATIONAL_CONSTANT
  if (![mass1, mass2, separation, G].every((one) => Number.isFinite(one))) return fail('not-finite', 'Every value must be finite.')
  if (mass1 <= 0 || mass2 <= 0) return fail('invalid-argument', 'Both masses must be positive.')
  if (separation <= 0) return fail('invalid-argument', 'The separation must be positive.')

  const total = mass1 + mass2
  const r1 = (separation * mass2) / total
  const r2 = (separation * mass1) / total
  // Each moves in a circle about the centre of mass, at the speed that balances the mutual attraction.
  const omega = Math.sqrt((G * total) / (separation * separation * separation))

  const a = body({ id: 'primary', mass: mass1, position: vec(-r1, 0), velocity: vec(0, -omega * r1) })
  const b = body({ id: 'secondary', mass: mass2, position: vec(r2, 0), velocity: vec(0, omega * r2) })
  if (isMechanicsError(a)) return fail('invalid-argument', a.message)
  if (isMechanicsError(b)) return fail('invalid-argument', b.message)
  return [a, b]
}

export const GRAVITATION_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Newtonian gravity throughout. No relativity, so Mercury’s perihelion does not precess here and nothing near a black hole is described correctly.',
  'Every body is a point mass. A uniform sphere behaves exactly like one from outside, so this is less of an approximation than it sounds — until something goes inside another.',
  'Orbital elements assume the central mass dominates and stays put. For two comparable masses both orbit their common centre and the real period is shorter.',
  'This works in a plane. Inclination and the ascending node describe a three-dimensional orientation and are reported as absent rather than as zero.',
  'Orbits are classified from the specific energy and the eccentricity, never from the shape of the drawing. Over a short arc a hyperbola and an ellipse look the same.'
])
