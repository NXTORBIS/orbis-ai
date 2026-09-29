/**
 * Newtonian mechanics: particles, the forces on them, and integrators that do not leak energy.
 *
 * The shared mechanics engine for Orbis Pages. It sits beside `simulation.ts` rather than replacing it, and the
 * division is the reason this file exists.
 *
 * ## Why not just use the general ODE integrator
 *
 * `simulation.ts` integrates any first-order system, with Euler, RK4 and an adaptive method. Its own documentation
 * says the thing that matters here: *none of them is symplectic*. Write a mass on a spring as a first-order system
 * and integrate it with RK4 and the energy slowly drains; with Euler it grows without bound. Neither is a small
 * error — over a long run the orbit spirals in or out and the answer stops being about the physics at all.
 *
 * A Newtonian system is not any ODE. It is second order, the acceleration depends on position and not on velocity
 * (except through damping and drag, which this handles separately), and that structure allows integrators that
 * conserve a nearby energy exactly rather than approximately. Velocity Verlet keeps a bounded energy error for as
 * long as you care to run it. That is what makes an orbit stay an orbit.
 *
 * So: general ODEs go through `simulation.ts`. Anything with mass, force and acceleration goes through here.
 *
 * ## The distinctions this file refuses to blur
 *
 * ```
 * symplectic     vs   accurate        -- Verlet drifts less over a long run and is less accurate per step
 * energy drift   vs   energy change   -- one is the integrator, the other is the physics; they are reported apart
 * conserved      vs   not checked     -- a system with an external force has no business claiming conservation
 * simulation time vs  wall-clock time -- nothing here knows what a second of real time is
 * force          vs   acceleration    -- a force needs a mass before it is a motion
 * a fixed step   vs   a stable step   -- the stability limit is computed rather than hoped for
 * ```
 *
 * Pure. No network, no clock, no storage. The same model, parameters and step give the same trajectory every time.
 */

export interface MechanicsError {
  error:
    | 'invalid-argument'
    | 'not-finite'
    | 'no-bodies'
    | 'unstable'
    | 'too-many-steps'
    | 'zero-mass'
    | 'diverged'
  message: string
}

export const isMechanicsError = (value: unknown): value is MechanicsError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: MechanicsError['error'], message: string): MechanicsError => ({ error, message })

export const MECHANICS_LIMITS: Readonly<Record<string, number>> = Object.freeze({
  bodies: 2_000,
  steps: 2_000_000,
  samples: 20_000,
  forces: 64
})

// ---------------------------------------------------------------- vectors

/** Two dimensions, because that is what a screen shows and what nearly every mechanics problem needs. */
export interface Vec2 {
  x: number
  y: number
}

export const vec = (x: number, y: number): Vec2 => ({ x, y })
export const ZERO: Vec2 = Object.freeze({ x: 0, y: 0 })
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y })
export const subtract = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y })
export const scale = (a: Vec2, by: number): Vec2 => ({ x: a.x * by, y: a.y * by })
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y
/** The z component of the cross product, which in two dimensions is the only one there is. */
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x
export const magnitude = (a: Vec2): number => Math.hypot(a.x, a.y)
export const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y)

export function direction(a: Vec2): Vec2 | MechanicsError {
  const size = magnitude(a)
  if (size === 0) return fail('invalid-argument', 'A vector of zero length has no direction.')
  return { x: a.x / size, y: a.y / size }
}

const finite = (a: Vec2): boolean => Number.isFinite(a.x) && Number.isFinite(a.y)

// ---------------------------------------------------------------- bodies

export interface Body {
  id: string
  mass: number
  position: Vec2
  velocity: Vec2
  /** Radius, where the body is treated as a disc for collisions or drawing. Zero for a point mass. */
  radius: number
  /**
   * A body that does not move however hard it is pushed.
   *
   * A wall, an anchor, the Earth in a projectile problem. Its mass is not used, and treating it as very heavy
   * instead would make every force calculation involving it a rounding exercise.
   */
  fixed: boolean
}

export function body(one: Partial<Body> & { id: string; mass: number }): Body | MechanicsError {
  if (!Number.isFinite(one.mass)) return fail('not-finite', `"${one.id}" has a mass that is not a finite number.`)
  if (one.mass <= 0 && one.fixed !== true) {
    return fail('zero-mass', `"${one.id}" has a mass of ${one.mass}. A force on a massless body gives an infinite acceleration, so a mass must be positive — or the body must be fixed, which is how something immovable is described.`)
  }
  const built: Body = {
    id: one.id,
    mass: one.mass,
    position: one.position ?? ZERO,
    velocity: one.velocity ?? ZERO,
    radius: one.radius ?? 0,
    fixed: one.fixed ?? false
  }
  if (!finite(built.position) || !finite(built.velocity)) {
    return fail('not-finite', `"${one.id}" has a position or velocity that is not a finite number.`)
  }
  if (!Number.isFinite(built.radius) || built.radius < 0) {
    return fail('invalid-argument', `"${one.id}" has a radius of ${built.radius}, which is not a length.`)
  }
  return built
}

// ---------------------------------------------------------------- forces

/**
 * A force, as data.
 *
 * Data rather than a function because a Page sends these over a boundary and cannot send code. The set is closed and
 * each member is a thing a mechanics problem actually contains.
 */
export type Force =
  /** Uniform gravity: the same acceleration on everything, which is what `g` means near a surface. */
  | { kind: 'uniform-gravity'; acceleration: Vec2 }
  /** A constant push on one body. */
  | { kind: 'constant'; bodyId: string; force: Vec2 }
  /** A spring between two bodies, or between a body and a fixed point. */
  | {
      kind: 'spring'
      bodyId: string
      /** The other end: another body, or a point that does not move. */
      otherId: string | null
      anchor: Vec2
      stiffness: number
      restLength: number
      /** Force opposing the rate of change of the spring's length. Zero for an ideal spring. */
      damping: number
    }
  /** Resistance proportional to velocity. The low-speed regime. */
  | { kind: 'linear-drag'; bodyId: string | null; coefficient: number }
  /** Resistance proportional to speed squared, opposing the direction of travel. The usual regime for air. */
  | { kind: 'quadratic-drag'; bodyId: string | null; coefficient: number }
  /** Newtonian gravity between every pair of bodies. */
  | { kind: 'mutual-gravity'; constant: number; softening: number }

export interface ForceFacts {
  label: string
  describe: string
  /** True when this force can take energy out of the system, so conservation must not be claimed. */
  dissipative: boolean
  /** True when the force does work that has a potential, so it contributes to potential energy. */
  conservative: boolean
}

export const FORCE_FACTS: Readonly<Record<Force['kind'], ForceFacts>> = Object.freeze({
  'uniform-gravity': {
    label: 'Uniform gravity',
    describe: 'The same acceleration on every body, whatever its mass. What `g` means close to a surface, where the distance to the centre barely changes.',
    dissipative: false,
    conservative: true
  },
  constant: {
    label: 'Constant force',
    describe: 'A steady push on one body, fixed in size and direction. A rocket at constant thrust, a hand on a block.',
    dissipative: false,
    conservative: false
  },
  spring: {
    label: 'Spring',
    describe: 'A restoring force proportional to how far the length is from rest. Hooke’s law, with an optional damper across the same two points.',
    dissipative: false,
    conservative: true
  },
  'linear-drag': {
    label: 'Linear drag',
    describe: 'Resistance proportional to velocity, opposing it. The low-speed regime: a bead in oil, a small sphere in a viscous fluid.',
    dissipative: true,
    conservative: false
  },
  'quadratic-drag': {
    label: 'Quadratic drag',
    describe: 'Resistance proportional to speed squared, opposing the direction of travel. The usual regime for anything moving through air at everyday speeds.',
    dissipative: true,
    conservative: false
  },
  'mutual-gravity': {
    label: 'Mutual gravity',
    describe: 'Every body attracting every other by the inverse square law. What holds an orbit together.',
    dissipative: false,
    conservative: true
  }
})

// ---------------------------------------------------------------- the system

export interface System {
  bodies: readonly Body[]
  forces: readonly Force[]
}

export function system(bodies: readonly Body[], forces: readonly Force[]): System | MechanicsError {
  if (bodies.length === 0) return fail('no-bodies', 'A system with no bodies in it has nothing to work out.')
  if (bodies.length > MECHANICS_LIMITS.bodies) {
    return fail('invalid-argument', `${bodies.length} bodies is more than the ${MECHANICS_LIMITS.bodies} this engine handles.`)
  }
  if (forces.length > MECHANICS_LIMITS.forces) {
    return fail('invalid-argument', `${forces.length} forces is more than the ${MECHANICS_LIMITS.forces} allowed.`)
  }
  const seen = new Set<string>()
  for (const one of bodies) {
    if (seen.has(one.id)) return fail('invalid-argument', `Two bodies share the id "${one.id}".`)
    seen.add(one.id)
  }
  for (const one of forces) {
    const named = 'bodyId' in one ? one.bodyId : null
    if (named !== null && named !== undefined && !seen.has(named)) {
      return fail('invalid-argument', `A ${one.kind} force names the body "${named}", which is not in this system.`)
    }
    if (one.kind === 'spring' && one.otherId !== null && !seen.has(one.otherId)) {
      return fail('invalid-argument', `A spring names the body "${one.otherId}", which is not in this system.`)
    }
    if (one.kind === 'spring') {
      if (!Number.isFinite(one.stiffness) || one.stiffness < 0) return fail('invalid-argument', 'A spring stiffness must be zero or more.')
      if (!Number.isFinite(one.restLength) || one.restLength < 0) return fail('invalid-argument', 'A spring rest length must be zero or more.')
    }
    if (one.kind === 'mutual-gravity' && (!Number.isFinite(one.constant) || one.constant < 0)) {
      return fail('invalid-argument', 'The gravitational constant must be zero or more.')
    }
  }
  return { bodies, forces }
}

/** Whether anything in this system takes energy out of it. */
export const isDissipative = (one: System): boolean => one.forces.some((force) => FORCE_FACTS[force.kind].dissipative)

/** Whether anything in this system does work with no potential behind it, so total energy is not a fixed budget. */
export const hasExternalWork = (one: System): boolean => one.forces.some((force) => force.kind === 'constant')

/**
 * The force on every body, given where they all are and how fast they are going.
 *
 * Velocity is needed because drag depends on it. That is what makes drag awkward for a plain Verlet step and is why
 * `velocity-verlet` handles it explicitly rather than pretending the acceleration is a function of position alone.
 */
export function forcesOn(one: System, positions: readonly Vec2[], velocities: readonly Vec2[]): Vec2[] {
  const out: Vec2[] = one.bodies.map(() => ({ x: 0, y: 0 }))
  const index = new Map(one.bodies.map((entry, i) => [entry.id, i]))

  for (const force of one.forces) {
    switch (force.kind) {
      case 'uniform-gravity': {
        for (let i = 0; i < one.bodies.length; i += 1) {
          const target = one.bodies[i]
          if (target === undefined || target.fixed) continue
          const at = out[i]
          if (at === undefined) continue
          // Weight is mass times g: the acceleration is the same for every body and the force is not.
          at.x += target.mass * force.acceleration.x
          at.y += target.mass * force.acceleration.y
        }
        break
      }
      case 'constant': {
        const i = index.get(force.bodyId)
        if (i === undefined) break
        const at = out[i]
        if (at === undefined) break
        at.x += force.force.x
        at.y += force.force.y
        break
      }
      case 'spring': {
        const i = index.get(force.bodyId)
        if (i === undefined) break
        const here = positions[i]
        const hereVelocity = velocities[i]
        if (here === undefined || hereVelocity === undefined) break
        const otherIndex = force.otherId === null ? null : index.get(force.otherId)
        const there = otherIndex === null || otherIndex === undefined ? force.anchor : positions[otherIndex]
        const thereVelocity = otherIndex === null || otherIndex === undefined ? ZERO : velocities[otherIndex]
        if (there === undefined || thereVelocity === undefined) break

        const along = subtract(here, there)
        const length = magnitude(along)
        if (length === 0) break // Two points on top of each other: the direction is undefined and the force is zero.
        const unit = { x: along.x / length, y: along.y / length }
        const stretch = length - force.restLength
        // Hooke: the force pulls back toward the rest length, so it is negative along the outward direction.
        let size = -force.stiffness * stretch
        if (force.damping !== 0) {
          // The damper resists the rate at which the length is changing, not the velocity of either end.
          const closing = dot(subtract(hereVelocity, thereVelocity), unit)
          size -= force.damping * closing
        }
        const applied = scale(unit, size)
        const at = out[i]
        if (at !== undefined) {
          at.x += applied.x
          at.y += applied.y
        }
        if (otherIndex !== null && otherIndex !== undefined) {
          const other = out[otherIndex]
          if (other !== undefined) {
            // Equal and opposite. Newton's third law is not optional, and a spring that pushed only one end would
            // quietly create momentum out of nothing.
            other.x -= applied.x
            other.y -= applied.y
          }
        }
        break
      }
      case 'linear-drag': {
        for (let i = 0; i < one.bodies.length; i += 1) {
          const target = one.bodies[i]
          if (target === undefined || target.fixed) continue
          if (force.bodyId !== null && target.id !== force.bodyId) continue
          const velocity = velocities[i]
          const at = out[i]
          if (velocity === undefined || at === undefined) continue
          at.x -= force.coefficient * velocity.x
          at.y -= force.coefficient * velocity.y
        }
        break
      }
      case 'quadratic-drag': {
        for (let i = 0; i < one.bodies.length; i += 1) {
          const target = one.bodies[i]
          if (target === undefined || target.fixed) continue
          if (force.bodyId !== null && target.id !== force.bodyId) continue
          const velocity = velocities[i]
          const at = out[i]
          if (velocity === undefined || at === undefined) continue
          const speed = magnitude(velocity)
          if (speed === 0) continue
          // Magnitude goes as v², direction is against travel: c·v²·(v̂) = c·v·(v vector).
          at.x -= force.coefficient * speed * velocity.x
          at.y -= force.coefficient * speed * velocity.y
        }
        break
      }
      case 'mutual-gravity': {
        for (let i = 0; i < one.bodies.length; i += 1) {
          for (let j = i + 1; j < one.bodies.length; j += 1) {
            const a = one.bodies[i]
            const b = one.bodies[j]
            const here = positions[i]
            const there = positions[j]
            if (a === undefined || b === undefined || here === undefined || there === undefined) continue
            const along = subtract(there, here)
            // Softening keeps two bodies passing through each other from producing an infinite force. It changes the
            // physics at very short range, which is why it is a parameter and not a hidden guard.
            const squared = along.x * along.x + along.y * along.y + force.softening * force.softening
            if (squared === 0) continue
            const size = (force.constant * a.mass * b.mass) / squared
            const separation = Math.sqrt(squared)
            const applied = { x: (along.x / separation) * size, y: (along.y / separation) * size }
            if (!a.fixed) {
              const at = out[i]
              if (at !== undefined) {
                at.x += applied.x
                at.y += applied.y
              }
            }
            if (!b.fixed) {
              const at = out[j]
              if (at !== undefined) {
                at.x -= applied.x
                at.y -= applied.y
              }
            }
          }
        }
        break
      }
    }
  }
  return out
}

// ---------------------------------------------------------------- integrators

/**
 * How the equations are stepped forward.
 *
 * ```
 * euler            first order, not symplectic. Energy grows. Here to be shown failing, which is worth seeing.
 * semi-implicit    first order, symplectic. Energy stays bounded. The cheapest thing that does not drift.
 * velocity-verlet  second order, symplectic. The default, and what almost every physics engine uses.
 * rk4              fourth order, not symplectic. The most accurate per step and it drifts over a long run.
 * ```
 *
 * The important axis is not accuracy, it is whether the method is symplectic. On an oscillator, Euler's energy grows
 * without bound while semi-implicit Euler — no more accurate per step — keeps it bounded for ever. A run long enough
 * to matter is a run where that difference is the whole answer.
 */
export type Integrator = 'euler' | 'semi-implicit' | 'velocity-verlet' | 'rk4'

export const INTEGRATORS: readonly Integrator[] = Object.freeze(['euler', 'semi-implicit', 'velocity-verlet', 'rk4'])

export interface IntegratorFacts {
  label: string
  order: number
  symplectic: boolean
  describe: string
  /** When this is the wrong choice. */
  wrongWhen: string
}

export const INTEGRATOR_FACTS: Readonly<Record<Integrator, IntegratorFacts>> = Object.freeze({
  euler: {
    label: 'Explicit Euler',
    order: 1,
    symplectic: false,
    describe: 'The simplest possible step: move by the current velocity, then change the velocity by the current acceleration. Worth running once to watch it fail.',
    wrongWhen: 'Almost always. On anything oscillating it adds energy every step and the amplitude grows without bound, which is an artefact of the method and not the physics.'
  },
  'semi-implicit': {
    label: 'Semi-implicit Euler',
    order: 1,
    symplectic: true,
    describe: 'Update the velocity first, then move by the *new* velocity. One line different from Euler and it stops the energy running away — it is symplectic, so the error stays bounded however long the run.',
    wrongWhen: 'Accuracy per step matters more than long-run behaviour, or the trajectory is short.'
  },
  'velocity-verlet': {
    label: 'Velocity Verlet',
    order: 2,
    symplectic: true,
    describe: 'Second order and symplectic: accurate per step and bounded over a long run. What nearly every physics engine and molecular dynamics code uses, and the default here.',
    wrongWhen: 'The force depends strongly on velocity. Drag is handled, but a force dominated by velocity is better served by an adaptive method.'
  },
  rk4: {
    label: 'Runge–Kutta 4',
    order: 4,
    symplectic: false,
    describe: 'Fourth-order accurate: by far the closest to the true trajectory over a few periods. Not symplectic, so over thousands of periods the energy drifts steadily in one direction.',
    wrongWhen: 'The run is long. An orbit integrated with RK4 spirals, slowly and convincingly, and the spiral is the integrator.'
  }
})

export interface Snapshot {
  time: number
  positions: readonly Vec2[]
  velocities: readonly Vec2[]
  accelerations: readonly Vec2[]
}

export interface RunOptions {
  integrator?: Integrator
  /** Seconds per step. */
  step: number
  /** How long to run for, in simulation time. Nothing here knows about wall-clock time. */
  until: number
  /** Keep at most this many snapshots, thinned evenly. The step is unchanged; only what is kept is. */
  samples?: number
  /** Stop when this says to. Checked after every step. */
  stopWhen?: (snapshot: Snapshot) => boolean
  /** Anything beyond this distance from the origin counts as diverged rather than as a large number. */
  divergeBeyond?: number
}

export interface Run {
  trace: readonly Snapshot[]
  final: Snapshot
  integrator: Integrator
  step: number
  steps: number
  /**
   * Why the run ended.
   *
   * There is no 'step-limit' here on purpose: a run that would exceed the step ceiling is refused before the loop
   * starts, so a status for it would be a branch nothing can reach and a reader would have to work that out.
   */
  status: 'complete' | 'stopped-early' | 'diverged'
  /** Energy at the start and end, and the worst it strayed in between. */
  energy: { initial: number; final: number; worstDrift: number; relativeDrift: number }
  /** True only when nothing in the system dissipates or does external work, so drift is the integrator's alone. */
  energyShouldBeConstant: boolean
  /** Total momentum at the start and end. */
  momentum: { initial: Vec2; final: Vec2 }
  notes: readonly string[]
}

const copy = (all: readonly Vec2[]): Vec2[] => all.map((one) => ({ x: one.x, y: one.y }))

/** Kinetic energy of the whole system. Fixed bodies do not move, so they contribute nothing. */
export function kineticEnergy(one: System, velocities: readonly Vec2[]): number {
  let total = 0
  for (let i = 0; i < one.bodies.length; i += 1) {
    const target = one.bodies[i]
    const velocity = velocities[i]
    if (target === undefined || velocity === undefined || target.fixed) continue
    total += 0.5 * target.mass * (velocity.x * velocity.x + velocity.y * velocity.y)
  }
  return total
}

/**
 * Potential energy of the whole system.
 *
 * Only the conservative forces have one. Drag and a constant push do not, which is exactly why a system containing
 * them has no fixed energy budget and why `energyShouldBeConstant` exists.
 *
 * Uniform gravity's potential is measured from y = 0, and mutual gravity's from infinite separation. Both are
 * choices of where zero sits; neither changes any difference in energy, which is the only thing a potential is for.
 */
export function potentialEnergy(one: System, positions: readonly Vec2[]): number {
  let total = 0
  const index = new Map(one.bodies.map((entry, i) => [entry.id, i]))
  for (const force of one.forces) {
    switch (force.kind) {
      case 'uniform-gravity': {
        for (let i = 0; i < one.bodies.length; i += 1) {
          const target = one.bodies[i]
          const at = positions[i]
          if (target === undefined || at === undefined || target.fixed) continue
          total -= target.mass * (force.acceleration.x * at.x + force.acceleration.y * at.y)
        }
        break
      }
      case 'spring': {
        const i = index.get(force.bodyId)
        if (i === undefined) break
        const here = positions[i]
        if (here === undefined) break
        const otherIndex = force.otherId === null ? null : index.get(force.otherId)
        const there = otherIndex === null || otherIndex === undefined ? force.anchor : positions[otherIndex]
        if (there === undefined) break
        const stretch = distance(here, there) - force.restLength
        total += 0.5 * force.stiffness * stretch * stretch
        break
      }
      case 'mutual-gravity': {
        for (let i = 0; i < one.bodies.length; i += 1) {
          for (let j = i + 1; j < one.bodies.length; j += 1) {
            const a = one.bodies[i]
            const b = one.bodies[j]
            const here = positions[i]
            const there = positions[j]
            if (a === undefined || b === undefined || here === undefined || there === undefined) continue
            const squared = (there.x - here.x) ** 2 + (there.y - here.y) ** 2 + force.softening * force.softening
            const separation = Math.sqrt(squared)
            if (separation === 0) continue
            total -= (force.constant * a.mass * b.mass) / separation
          }
        }
        break
      }
      default:
        break
    }
  }
  return total
}

export const totalEnergy = (one: System, positions: readonly Vec2[], velocities: readonly Vec2[]): number =>
  kineticEnergy(one, velocities) + potentialEnergy(one, positions)

/** Total momentum. Fixed bodies are excluded: whatever holds them still absorbs whatever they would have carried. */
export function totalMomentum(one: System, velocities: readonly Vec2[]): Vec2 {
  let x = 0
  let y = 0
  for (let i = 0; i < one.bodies.length; i += 1) {
    const target = one.bodies[i]
    const velocity = velocities[i]
    if (target === undefined || velocity === undefined || target.fixed) continue
    x += target.mass * velocity.x
    y += target.mass * velocity.y
  }
  return { x, y }
}

/** Where the mass of the system is, on average. */
export function centreOfMass(one: System, positions: readonly Vec2[]): Vec2 | MechanicsError {
  let mass = 0
  let x = 0
  let y = 0
  for (let i = 0; i < one.bodies.length; i += 1) {
    const target = one.bodies[i]
    const at = positions[i]
    if (target === undefined || at === undefined) continue
    mass += target.mass
    x += target.mass * at.x
    y += target.mass * at.y
  }
  if (mass === 0) return fail('zero-mass', 'The total mass is zero, so there is no centre of mass.')
  return { x: x / mass, y: y / mass }
}

/**
 * The largest step this system can be integrated with before the method goes unstable.
 *
 * For a spring, the limit is set by the stiffest oscillation in the system: a step longer than about its period over
 * π and an explicit method amplifies rather than oscillates. Returned as a number rather than enforced, because a
 * caller who knows the system may have a reason — but a run above it produces nonsense that looks like physics, so
 * `run` warns about it every time.
 *
 * Null when nothing in the system sets a limit, which is the honest answer for a body coasting under uniform gravity.
 */
export function stableStep(one: System): { limit: number | null; from: string } {
  let fastest = 0
  let source = ''
  const index = new Map(one.bodies.map((entry, i) => [entry.id, i]))
  for (const force of one.forces) {
    if (force.kind !== 'spring') continue
    const i = index.get(force.bodyId)
    if (i === undefined) continue
    const target = one.bodies[i]
    if (target === undefined) continue
    const otherIndex = force.otherId === null ? null : index.get(force.otherId)
    const other = otherIndex === null || otherIndex === undefined ? null : one.bodies[otherIndex]
    // Two free ends oscillate about their centre of mass with the reduced mass; one fixed end uses the free mass.
    const effective =
      other === null || other.fixed
        ? target.mass
        : (target.mass * other.mass) / (target.mass + other.mass)
    if (effective <= 0 || force.stiffness <= 0) continue
    const omega = Math.sqrt(force.stiffness / effective)
    if (omega > fastest) {
      fastest = omega
      source = `the spring on "${force.bodyId}", which oscillates at ${(omega / (2 * Math.PI)).toPrecision(4)} Hz`
    }
  }
  if (fastest === 0) {
    return { limit: null, from: 'Nothing in this system sets a step limit: there is no oscillation for a step to outrun.' }
  }
  const limit = 2 / fastest
  return {
    limit,
    // 2/ω is where an explicit method stops being stable at all. A tenth of that is where it stops being wrong.
    from: `Set by ${source}. Above ${limit.toPrecision(4)} s an explicit method amplifies instead of oscillating; a tenth of it is where the trajectory is actually right.`
  }
}

/**
 * Runs the system forward.
 *
 * Nothing about real time is involved: `until` is simulation seconds and the caller decides how fast to show them.
 * Conflating the two is how a simulation becomes frame-rate dependent, which makes the same experiment give
 * different answers on different machines.
 */
export function run(one: System, options: RunOptions): Run | MechanicsError {
  const integrator = options.integrator ?? 'velocity-verlet'
  if (!INTEGRATORS.includes(integrator)) {
    return fail('invalid-argument', `There is no integrator called "${integrator}". The ones here are ${INTEGRATORS.join(', ')}.`)
  }
  if (!Number.isFinite(options.step) || options.step <= 0) return fail('invalid-argument', 'The step must be a positive number of seconds.')
  if (!Number.isFinite(options.until) || options.until <= 0) return fail('invalid-argument', 'The run length must be a positive number of seconds.')
  const stepCount = Math.ceil(options.until / options.step)
  if (stepCount > MECHANICS_LIMITS.steps) {
    return fail('too-many-steps', `${options.until} s at ${options.step} s per step is ${stepCount} steps, more than the ${MECHANICS_LIMITS.steps} this engine runs.`)
  }
  const keep = Math.min(options.samples ?? 1000, MECHANICS_LIMITS.samples)
  const divergeBeyond = options.divergeBeyond ?? 1e12

  let positions = copy(one.bodies.map((entry) => entry.position))
  let velocities = copy(one.bodies.map((entry) => entry.velocity))
  const masses = one.bodies.map((entry) => entry.mass)
  const fixed = one.bodies.map((entry) => entry.fixed)

  const accelerationsFrom = (p: readonly Vec2[], v: readonly Vec2[]): Vec2[] => {
    const forces = forcesOn(one, p, v)
    return forces.map((force, i) => (fixed[i] === true ? { x: 0, y: 0 } : { x: force.x / (masses[i] as number), y: force.y / (masses[i] as number) }))
  }

  let accelerations = accelerationsFrom(positions, velocities)
  const startEnergy = totalEnergy(one, positions, velocities)
  const startMomentum = totalMomentum(one, velocities)

  const trace: Snapshot[] = []
  const every = Math.max(1, Math.floor(stepCount / keep))
  const record = (time: number): void => {
    trace.push({ time, positions: copy(positions), velocities: copy(velocities), accelerations: copy(accelerations) })
  }
  record(0)

  let worstDrift = 0
  let status: Run['status'] = 'complete'
  let taken = 0
  const h = options.step

  for (let n = 0; n < stepCount; n += 1) {
    switch (integrator) {
      case 'euler': {
        // Move by the velocity we had, then change the velocity. The order is what makes it leak.
        const wasVelocity = copy(velocities)
        for (let i = 0; i < positions.length; i += 1) {
          if (fixed[i] === true) continue
          const at = positions[i] as Vec2
          const v = wasVelocity[i] as Vec2
          const a = accelerations[i] as Vec2
          at.x += v.x * h
          at.y += v.y * h
          const velocity = velocities[i] as Vec2
          velocity.x += a.x * h
          velocity.y += a.y * h
        }
        accelerations = accelerationsFrom(positions, velocities)
        break
      }
      case 'semi-implicit': {
        // Change the velocity first, then move by the new one. One line different, and it stops drifting.
        for (let i = 0; i < positions.length; i += 1) {
          if (fixed[i] === true) continue
          const a = accelerations[i] as Vec2
          const velocity = velocities[i] as Vec2
          velocity.x += a.x * h
          velocity.y += a.y * h
          const at = positions[i] as Vec2
          at.x += velocity.x * h
          at.y += velocity.y * h
        }
        accelerations = accelerationsFrom(positions, velocities)
        break
      }
      case 'velocity-verlet': {
        // Half-kick, drift, recompute the force, half-kick. The recomputation in the middle is the whole method.
        for (let i = 0; i < positions.length; i += 1) {
          if (fixed[i] === true) continue
          const a = accelerations[i] as Vec2
          const velocity = velocities[i] as Vec2
          const at = positions[i] as Vec2
          at.x += velocity.x * h + 0.5 * a.x * h * h
          at.y += velocity.y * h + 0.5 * a.y * h * h
          velocity.x += 0.5 * a.x * h
          velocity.y += 0.5 * a.y * h
        }
        const next = accelerationsFrom(positions, velocities)
        for (let i = 0; i < positions.length; i += 1) {
          if (fixed[i] === true) continue
          const a = next[i] as Vec2
          const velocity = velocities[i] as Vec2
          velocity.x += 0.5 * a.x * h
          velocity.y += 0.5 * a.y * h
        }
        accelerations = next
        break
      }
      case 'rk4': {
        const p0 = copy(positions)
        const v0 = copy(velocities)
        const a1 = accelerationsFrom(p0, v0)

        const p2 = p0.map((at, i) => ({ x: at.x + (v0[i] as Vec2).x * (h / 2), y: at.y + (v0[i] as Vec2).y * (h / 2) }))
        const v2 = v0.map((v, i) => ({ x: v.x + (a1[i] as Vec2).x * (h / 2), y: v.y + (a1[i] as Vec2).y * (h / 2) }))
        const a2 = accelerationsFrom(p2, v2)

        const p3 = p0.map((at, i) => ({ x: at.x + (v2[i] as Vec2).x * (h / 2), y: at.y + (v2[i] as Vec2).y * (h / 2) }))
        const v3 = v0.map((v, i) => ({ x: v.x + (a2[i] as Vec2).x * (h / 2), y: v.y + (a2[i] as Vec2).y * (h / 2) }))
        const a3 = accelerationsFrom(p3, v3)

        const p4 = p0.map((at, i) => ({ x: at.x + (v3[i] as Vec2).x * h, y: at.y + (v3[i] as Vec2).y * h }))
        const v4 = v0.map((v, i) => ({ x: v.x + (a3[i] as Vec2).x * h, y: v.y + (a3[i] as Vec2).y * h }))
        const a4 = accelerationsFrom(p4, v4)

        for (let i = 0; i < positions.length; i += 1) {
          if (fixed[i] === true) continue
          const at = positions[i] as Vec2
          const velocity = velocities[i] as Vec2
          at.x = (p0[i] as Vec2).x + (h / 6) * ((v0[i] as Vec2).x + 2 * (v2[i] as Vec2).x + 2 * (v3[i] as Vec2).x + (v4[i] as Vec2).x)
          at.y = (p0[i] as Vec2).y + (h / 6) * ((v0[i] as Vec2).y + 2 * (v2[i] as Vec2).y + 2 * (v3[i] as Vec2).y + (v4[i] as Vec2).y)
          velocity.x = (v0[i] as Vec2).x + (h / 6) * ((a1[i] as Vec2).x + 2 * (a2[i] as Vec2).x + 2 * (a3[i] as Vec2).x + (a4[i] as Vec2).x)
          velocity.y = (v0[i] as Vec2).y + (h / 6) * ((a1[i] as Vec2).y + 2 * (a2[i] as Vec2).y + 2 * (a3[i] as Vec2).y + (a4[i] as Vec2).y)
        }
        accelerations = accelerationsFrom(positions, velocities)
        break
      }
    }

    taken = n + 1
    const time = taken * h

    let runaway = false
    for (const at of positions) {
      if (!Number.isFinite(at.x) || !Number.isFinite(at.y) || Math.abs(at.x) > divergeBeyond || Math.abs(at.y) > divergeBeyond) {
        runaway = true
        break
      }
    }
    if (runaway) {
      status = 'diverged'
      record(time)
      break
    }

    const now = totalEnergy(one, positions, velocities)
    const drift = Math.abs(now - startEnergy)
    if (drift > worstDrift) worstDrift = drift

    if (taken % every === 0 || taken === stepCount) record(time)

    if (options.stopWhen !== undefined) {
      const snapshot: Snapshot = { time, positions: copy(positions), velocities: copy(velocities), accelerations: copy(accelerations) }
      if (options.stopWhen(snapshot)) {
        status = 'stopped-early'
        if (trace[trace.length - 1]?.time !== time) trace.push(snapshot)
        break
      }
    }
  }

  const endEnergy = totalEnergy(one, positions, velocities)
  const shouldBeConstant = !isDissipative(one) && !hasExternalWork(one)
  const scale = Math.abs(startEnergy) > 0 ? Math.abs(startEnergy) : 1

  const notes: string[] = []
  const facts = INTEGRATOR_FACTS[integrator]
  const limit = stableStep(one)
  if (limit.limit !== null && h > limit.limit) {
    notes.push(
      `The step of ${h} s is above the stability limit of ${limit.limit.toPrecision(4)} s for this system. ${limit.from} What came back is not a trajectory; it is the method failing.`
    )
  } else if (limit.limit !== null && h > limit.limit / 10) {
    notes.push(`The step of ${h} s is stable but coarse: ${limit.from}`)
  }
  if (!shouldBeConstant) {
    const why: string[] = []
    if (isDissipative(one)) why.push('drag takes energy out')
    if (hasExternalWork(one)) why.push('a constant force does work with no potential behind it')
    notes.push(`Energy is not conserved in this system because ${why.join(' and ')}, so the change below is physics rather than error. The two are not separable here.`)
  } else if (!facts.symplectic) {
    notes.push(
      `${facts.label} is not symplectic, so the energy drifts in one direction rather than staying put. Over ${taken} steps it moved by ${((worstDrift / scale) * 100).toPrecision(3)}% of its starting value, and that is the integrator rather than the physics.`
    )
  } else {
    notes.push(
      `${facts.label} is symplectic: the energy oscillates around its starting value rather than drifting away from it, however long the run. It moved by at most ${((worstDrift / scale) * 100).toPrecision(3)}%.`
    )
  }
  if (status === 'diverged') {
    notes.push('A body ran off to infinity. Either the step is too large for this system, or two bodies passed through each other and the force between them blew up — mutual gravity has a softening parameter for exactly that.')
  }

  const final: Snapshot = { time: taken * h, positions: copy(positions), velocities: copy(velocities), accelerations: copy(accelerations) }
  if (trace[trace.length - 1]?.time !== final.time) trace.push(final)

  return {
    trace,
    final,
    integrator,
    step: h,
    steps: taken,
    status,
    energy: { initial: startEnergy, final: endEnergy, worstDrift, relativeDrift: worstDrift / scale },
    energyShouldBeConstant: shouldBeConstant,
    momentum: { initial: startMomentum, final: totalMomentum(one, velocities) },
    notes
  }
}

// ---------------------------------------------------------------- comparing methods

export interface IntegratorComparison {
  entries: {
    integrator: Integrator
    symplectic: boolean
    order: number
    /** How far the energy strayed, as a fraction of where it started. */
    relativeDrift: number
    /** Distance between this method's final position and the reference's, for the first free body. */
    positionDifference: number | null
    steps: number
  }[]
  /** Which method the others were measured against, and why that one. */
  reference: Integrator
  why: string
  caveats: readonly string[]
}

/**
 * Runs the same system with every method and lays the results side by side.
 *
 * The point is not to pick a winner: the ranking changes with how long the run is. Over a few periods RK4 is closest
 * to the truth; over ten thousand, semi-implicit Euler — a first-order method — has the better trajectory because
 * RK4's energy has been quietly draining the whole time. Both facts are visible in the same table.
 */
export function compareIntegrators(one: System, options: RunOptions): IntegratorComparison | MechanicsError {
  const entries: IntegratorComparison['entries'] = []
  let referencePosition: Vec2 | null = null
  const freeIndex = one.bodies.findIndex((entry) => !entry.fixed)

  // RK4 at the given step is the closest thing to the true trajectory over a short run, so it is the yardstick.
  const reference = run(one, { ...options, integrator: 'rk4' })
  if (isMechanicsError(reference)) return reference
  if (freeIndex >= 0) referencePosition = reference.final.positions[freeIndex] ?? null

  for (const integrator of INTEGRATORS) {
    const result = run(one, { ...options, integrator })
    if (isMechanicsError(result)) return result
    const at = freeIndex >= 0 ? result.final.positions[freeIndex] ?? null : null
    entries.push({
      integrator,
      symplectic: INTEGRATOR_FACTS[integrator].symplectic,
      order: INTEGRATOR_FACTS[integrator].order,
      relativeDrift: result.energy.relativeDrift,
      positionDifference: at === null || referencePosition === null ? null : distance(at, referencePosition),
      steps: result.steps
    })
  }

  return {
    entries,
    reference: 'rk4',
    why: `All four at a step of ${options.step} s over ${options.until} s. Positions are measured against Runge–Kutta 4, which over a short run is the closest to the true trajectory.`,
    caveats: [
      'Being closest to RK4 is not the same as being right. RK4 is the yardstick here because it is the most accurate over a short run, not because it is exact.',
      'Drift and accuracy pull in opposite directions. Over a long run a first-order symplectic method beats a fourth-order non-symplectic one, because bounded error eventually beats small error that only goes one way.',
      'Energy drift is only meaningful when the system conserves energy in the first place. With drag or an applied force in it, the change below is the physics.'
    ]
  }
}

export const MECHANICS_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Everything is two-dimensional and every body is a point with a mass, except where a radius is given for a collision or for drawing.',
  'Nothing here knows about real time. A run is a number of simulation seconds, and how fast those are shown is somebody else’s decision — which is what keeps the same experiment giving the same answer on a slower machine.',
  'A fixed body does not move however hard it is pushed, and contributes nothing to the total momentum. Whatever holds it still absorbs the rest.',
  'Where zero potential energy sits is a choice: uniform gravity measures from y = 0 and mutual gravity from infinite separation. Neither choice changes any difference in energy, which is all a potential is ever used for.',
  'Energy drift reported for a conservative system is the integrator, not the physics. For a system with drag or an applied force the two cannot be separated, and no separated figure is offered.'
])
