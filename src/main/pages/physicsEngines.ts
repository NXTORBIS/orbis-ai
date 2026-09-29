/**
 * The physics laboratories a Page can reach: mechanics, motion, oscillators, collisions, gravity, rotation and waves.
 *
 * Same contract as the four bridges before it. A Page sends data, never code. There is no `eval` and no `new
 * Function` on any path reachable from here, and every number a Page shows came back through this door from an
 * engine that computed it — none of it is produced by a language model and none of it is hardcoded.
 *
 * ## Why the sample counts here are lower than the engines allow
 *
 * `mechanics.ts` will take two million steps. This door caps what comes *back*, not what is computed: a run is
 * integrated at whatever step it was given and only the sampled trace crosses the boundary, because a trace of two
 * million snapshots is a hundred megabytes of JSON for a chart with a thousand pixels. The step decides the answer;
 * the sample count decides what is kept. Those are separate arguments on purpose.
 *
 * ## The operations that refuse rather than default
 *
 * `motion.projectile` refuses a drag coefficient — the closed-form projectile equations solve a different problem,
 * and quoting them beside a dragged trajectory would be quoting a number that stopped being true. A Page wanting
 * drag calls `motion.projectile-drag`, and `motion.compare-projectile` runs both and says which kind of difference
 * it found.
 */

import {
  centreOfMassView,
  glancingCollision,
  headOnCollision,
  isCollisionError,
  restitutionFrom,
  timeToContact,
  type Disc
} from '../../shared/compute/collisions.ts'
import {
  circularSpeed,
  compareOrbits,
  escapeSpeed,
  fieldGrid,
  gravityBetween,
  isGravitationError,
  nBody,
  orbitFrom,
  orbitPath,
  orbitingPair,
  SHAPE_FACTS as ORBIT_FACTS,
  type Orbit
} from '../../shared/compute/gravitation.ts'
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
  type Phase
} from '../../shared/compute/kinematics.ts'
import {
  body,
  compareIntegrators,
  forcesOn,
  INTEGRATOR_FACTS,
  INTEGRATORS,
  isMechanicsError,
  kineticEnergy,
  potentialEnergy,
  run,
  stableStep,
  system,
  totalEnergy,
  totalMomentum,
  vec,
  FORCE_FACTS,
  MECHANICS_ASSUMPTIONS,
  type Body,
  type Force,
  type Integrator,
  type System,
  type Vec2
} from '../../shared/compute/mechanics.ts'
import {
  classifyDamping,
  compareDoublePendulums,
  coupledOscillators,
  dampedAt,
  doublePendulum,
  drivenOscillator,
  harmonicAt,
  isOscillatorError,
  pendulumPeriod,
  REGIME_FACTS,
  resonanceCurve,
  simpleHarmonic,
  swingPendulum,
  OSCILLATOR_ASSUMPTIONS
} from '../../shared/compute/oscillators.ts'
import {
  compositeBody,
  inertiaOf,
  isRigidBodyError,
  rollingDownSlope,
  rollingRace,
  SHAPES,
  SHAPE_FACTS as INERTIA_FACTS,
  shiftAxis,
  spinUnderTorque,
  torqueFrom,
  RIGID_BODY_ASSUMPTIONS,
  type Part,
  type Shape
} from '../../shared/compute/rigidBody.ts'
import {
  BOUNDARY_FACTS,
  beats,
  interferenceAt,
  isWaveError,
  sampleStanding,
  sampleWave,
  standingWave,
  superpose,
  travellingWave,
  wavePacket,
  WAVE_ASSUMPTIONS,
  type BoundaryCondition,
  type Wave
} from '../../shared/compute/waves.ts'
import { BadInput, Reader } from './engines.ts'

/** Which capability each operation needs. An operation is reachable only because it is in here. */
export const PHYSICS_CAPABILITY: Readonly<Record<string, string>> = Object.freeze({
  'mechanics.facts': 'computation.physics',
  'mechanics.run': 'computation.physics',
  'mechanics.compare-integrators': 'computation.physics',
  'mechanics.stable-step': 'computation.physics',
  'mechanics.forces': 'computation.physics',
  'mechanics.energy': 'computation.physics',

  'motion.projectile': 'computation.physics',
  'motion.projectile-drag': 'computation.physics',
  'motion.compare-projectile': 'computation.physics',
  'motion.phases': 'computation.physics',
  'motion.relative': 'computation.physics',
  'motion.river': 'computation.physics',
  'motion.wind': 'computation.physics',
  'motion.circular': 'computation.physics',
  'motion.vertical-circle': 'computation.physics',

  'oscillator.harmonic': 'computation.physics',
  'oscillator.harmonic-trace': 'computation.physics',
  'oscillator.damping': 'computation.physics',
  'oscillator.damped-trace': 'computation.physics',
  'oscillator.driven': 'computation.physics',
  'oscillator.resonance': 'computation.physics',
  'oscillator.coupled': 'computation.physics',
  'oscillator.pendulum-period': 'computation.physics',
  'oscillator.pendulum-swing': 'computation.physics',
  'oscillator.double-pendulum': 'computation.physics',
  'oscillator.double-compare': 'computation.physics',

  'collision.head-on': 'computation.physics',
  'collision.glancing': 'computation.physics',
  'collision.contact': 'computation.physics',
  'collision.centre-of-mass': 'computation.physics',
  'collision.restitution': 'computation.physics',

  'gravity.between': 'computation.physics',
  'gravity.field': 'computation.physics',
  'gravity.orbit': 'computation.physics',
  'gravity.orbit-path': 'computation.physics',
  'gravity.compare-orbits': 'computation.physics',
  'gravity.speeds': 'computation.physics',
  'gravity.n-body': 'computation.physics',
  'gravity.pair': 'computation.physics',

  'rotation.shapes': 'computation.physics',
  'rotation.inertia': 'computation.physics',
  'rotation.shift-axis': 'computation.physics',
  'rotation.composite': 'computation.physics',
  'rotation.torque': 'computation.physics',
  'rotation.spin': 'computation.physics',
  'rotation.rolling': 'computation.physics',
  'rotation.race': 'computation.physics',

  'wave.travelling': 'computation.physics',
  'wave.sample': 'computation.physics',
  'wave.standing': 'computation.physics',
  'wave.standing-sample': 'computation.physics',
  'wave.superpose': 'computation.physics',
  'wave.interference': 'computation.physics',
  'wave.beats': 'computation.physics',
  'wave.packet': 'computation.physics'
})

/** What this door will carry back. Deliberately below what the engines compute -- see the note at the top. */
export const PHYSICS_LIMITS: Readonly<Record<string, number>> = Object.freeze({
  bodies: 200,
  forces: 32,
  samples: 5_000,
  gridPoints: 10_000,
  phases: 50,
  waves: 16,
  parts: 200,
  points: 5_000
})

const settle = <T>(value: T, isError: (one: unknown) => boolean): unknown =>
  isError(value) ? { ok: false, ...(value as object) } : { ok: true, ...(value as object) }

// ---------------------------------------------------------------- readers

function vectorOf(read: Reader, key: string, fallback?: Vec2): Vec2 {
  if (!read.has(key)) {
    if (fallback !== undefined) return fallback
    throw new BadInput(`"${key}" has to be an object with x and y.`)
  }
  const raw = read.raw(key)
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new BadInput(`"${key}" has to be an object with x and y.`)
  }
  const entry = new Reader(raw as Record<string, unknown>)
  return vec(entry.number('x'), entry.number('y'))
}

function bodiesOf(read: Reader, key = 'bodies'): Body[] {
  const raw = read.list(key, PHYSICS_LIMITS.bodies)
  if (raw.length === 0) throw new BadInput(`"${key}" has to name at least one body.`)
  return raw.map((one, i) => {
    const entry = new Reader(one)
    const built = body({
      id: entry.optionalText('id', `body-${i + 1}`, 80),
      mass: entry.number('mass'),
      position: vectorOf(entry, 'position', vec(0, 0)),
      velocity: vectorOf(entry, 'velocity', vec(0, 0)),
      radius: entry.optionalNumber('radius', 0),
      fixed: entry.boolean('fixed', false)
    })
    if (isMechanicsError(built)) throw new BadInput(built.message)
    return built
  })
}

function forcesOf(read: Reader, key = 'forces'): Force[] {
  if (!read.has(key)) return []
  const raw = read.list(key, PHYSICS_LIMITS.forces)
  return raw.map((one) => {
    const entry = new Reader(one)
    const kind = entry.choice(
      'kind',
      ['uniform-gravity', 'constant', 'spring', 'linear-drag', 'quadratic-drag', 'mutual-gravity'] as const,
      'uniform-gravity'
    )
    switch (kind) {
      case 'uniform-gravity':
        return { kind, acceleration: vectorOf(entry, 'acceleration', vec(0, -9.81)) }
      case 'constant':
        return { kind, bodyId: entry.text('bodyId', 80), force: vectorOf(entry, 'force') }
      case 'spring':
        return {
          kind,
          bodyId: entry.text('bodyId', 80),
          otherId: entry.has('otherId') && entry.raw('otherId') !== null ? entry.text('otherId', 80) : null,
          anchor: vectorOf(entry, 'anchor', vec(0, 0)),
          stiffness: entry.number('stiffness'),
          restLength: entry.optionalNumber('restLength', 0),
          damping: entry.optionalNumber('damping', 0)
        }
      case 'linear-drag':
      case 'quadratic-drag':
        return {
          kind,
          bodyId: entry.has('bodyId') && entry.raw('bodyId') !== null ? entry.text('bodyId', 80) : null,
          coefficient: entry.number('coefficient')
        }
      case 'mutual-gravity':
        return { kind, constant: entry.optionalNumber('constant', 6.6743e-11), softening: entry.optionalNumber('softening', 0) }
    }
  })
}

function systemOf(read: Reader): System {
  const built = system(bodiesOf(read), forcesOf(read))
  if (isMechanicsError(built)) throw new BadInput(built.message)
  return built
}

function discOf(read: Reader, key: string): Disc {
  const raw = read.raw(key)
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new BadInput(`"${key}" has to be an object with a mass, a position, a velocity and a radius.`)
  }
  const entry = new Reader(raw as Record<string, unknown>)
  return {
    mass: entry.number('mass'),
    position: vectorOf(entry, 'position', vec(0, 0)),
    velocity: vectorOf(entry, 'velocity', vec(0, 0)),
    radius: entry.optionalNumber('radius', 0)
  }
}

function waveOf(source: Record<string, unknown>): Wave {
  const entry = new Reader(source)
  const built = travellingWave({
    amplitude: entry.number('amplitude'),
    speed: entry.has('speed') ? entry.number('speed') : undefined,
    frequency: entry.has('frequency') ? entry.number('frequency') : undefined,
    wavelength: entry.has('wavelength') ? entry.number('wavelength') : undefined,
    phase: entry.optionalNumber('phase', 0),
    direction: entry.optionalNumber('direction', 1) < 0 ? -1 : 1
  })
  if (isWaveError(built)) throw new BadInput(built.message)
  return built
}

const samples = (read: Reader, fallback = 1000): number =>
  Math.min(PHYSICS_LIMITS.samples, Math.max(2, Math.round(read.optionalNumber('samples', fallback))))

const spanOf = (read: Reader, key = 'span'): { from: number; to: number; points: number } => {
  const raw = read.raw(key)
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new BadInput(`"${key}" has to be an object with "from", "to" and optionally "points".`)
  }
  const entry = new Reader(raw as Record<string, unknown>)
  return {
    from: entry.number('from'),
    to: entry.number('to'),
    points: Math.min(PHYSICS_LIMITS.points, Math.max(2, Math.round(entry.optionalNumber('points', 400))))
  }
}

/** The orbit an operation was given, however the Page chose to describe it. */
function orbitOf(source: Record<string, unknown>): Orbit {
  const entry = new Reader(source)
  const built = orbitFrom({
    centralMass: entry.number('centralMass'),
    position: vectorOf(entry, 'position'),
    velocity: vectorOf(entry, 'velocity'),
    orbitingMass: entry.has('orbitingMass') ? entry.number('orbitingMass') : undefined,
    constant: entry.has('constant') ? entry.number('constant') : undefined
  })
  if (isGravitationError(built)) throw new BadInput(built.message)
  return built
}

// ---------------------------------------------------------------- dispatch

export function runPhysicsOperation(operation: string, input: Record<string, unknown>): unknown {
  const read = new Reader(input)

  switch (operation) {
    // ---------------------------------------------------------------- mechanics
    case 'mechanics.facts':
      return {
        ok: true,
        integrators: INTEGRATORS.map((one) => ({ integrator: one, ...INTEGRATOR_FACTS[one] })),
        forces: Object.entries(FORCE_FACTS).map(([kind, facts]) => ({ kind, ...facts })),
        assumptions: [...MECHANICS_ASSUMPTIONS]
      }

    case 'mechanics.run': {
      const built = systemOf(read)
      const result = run(built, {
        integrator: read.choice('integrator', INTEGRATORS, 'velocity-verlet') as Integrator,
        step: read.number('step'),
        until: read.number('until'),
        samples: samples(read),
        divergeBeyond: read.has('divergeBeyond') ? read.number('divergeBeyond') : undefined
      })
      if (isMechanicsError(result)) return { ok: false, ...result }
      return { ok: true, ...result, bodyIds: built.bodies.map((one) => one.id) }
    }

    case 'mechanics.compare-integrators':
      return settle(
        compareIntegrators(systemOf(read), { step: read.number('step'), until: read.number('until'), samples: 2 }),
        isMechanicsError
      )

    case 'mechanics.stable-step':
      return { ok: true, ...stableStep(systemOf(read)) }

    case 'mechanics.forces': {
      const built = systemOf(read)
      const positions = built.bodies.map((one) => one.position)
      const velocities = built.bodies.map((one) => one.velocity)
      const forces = forcesOn(built, positions, velocities)
      return {
        ok: true,
        forces: built.bodies.map((one, i) => ({
          id: one.id,
          force: forces[i] ?? vec(0, 0),
          acceleration: one.fixed
            ? vec(0, 0)
            : vec((forces[i]?.x ?? 0) / one.mass, (forces[i]?.y ?? 0) / one.mass)
        }))
      }
    }

    case 'mechanics.energy': {
      const built = systemOf(read)
      const positions = built.bodies.map((one) => one.position)
      const velocities = built.bodies.map((one) => one.velocity)
      return {
        ok: true,
        kinetic: kineticEnergy(built, velocities),
        potential: potentialEnergy(built, positions),
        total: totalEnergy(built, positions, velocities),
        momentum: totalMomentum(built, velocities)
      }
    }

    // ---------------------------------------------------------------- motion
    case 'motion.projectile': {
      if (read.has('drag') || read.has('dragCoefficient')) {
        throw new BadInput(
          'This operation solves motion with no air resistance, exactly. Drag makes it a different equation with no elementary solution, so the answer would be a number that stopped being true. Use "motion.projectile-drag" to integrate it, or "motion.compare-projectile" to see both.'
        )
      }
      return settle(
        projectile({
          speed: read.number('speed'),
          angle: read.number('angle'),
          height: read.optionalNumber('height', 0),
          gravity: read.optionalNumber('gravity', 9.81)
        }),
        isKinematicsError
      )
    }

    case 'motion.projectile-drag':
      return settle(
        projectileWithDrag(
          {
            speed: read.number('speed'),
            angle: read.number('angle'),
            height: read.optionalNumber('height', 0),
            gravity: read.optionalNumber('gravity', 9.81)
          },
          {
            kind: read.choice('drag', ['none', 'linear', 'quadratic'] as const, 'none'),
            coefficient: read.optionalNumber('coefficient', 0),
            mass: read.optionalNumber('mass', 1)
          },
          { step: read.has('step') ? read.number('step') : undefined, samples: samples(read, 800) }
        ),
        isKinematicsError
      )

    case 'motion.compare-projectile':
      return settle(
        compareProjectile(
          {
            speed: read.number('speed'),
            angle: read.number('angle'),
            height: read.optionalNumber('height', 0),
            gravity: read.optionalNumber('gravity', 9.81)
          },
          {
            kind: read.choice('drag', ['none', 'linear', 'quadratic'] as const, 'none'),
            coefficient: read.optionalNumber('coefficient', 0),
            mass: read.optionalNumber('mass', 1)
          },
          { step: read.has('step') ? read.number('step') : undefined }
        ),
        isKinematicsError
      )

    case 'motion.phases': {
      const phases: Phase[] = read.list('phases', PHYSICS_LIMITS.phases).map((one, i) => {
        const entry = new Reader(one)
        return {
          duration: entry.number('duration'),
          acceleration: entry.number('acceleration'),
          label: entry.optionalText('label', `Phase ${i + 1}`, 120)
        }
      })
      return settle(
        motionInPhases(
          phases,
          { position: read.optionalNumber('position', 0), velocity: read.optionalNumber('velocity', 0) },
          { sampleInterval: read.has('sampleInterval') ? read.number('sampleInterval') : undefined }
        ),
        isKinematicsError
      )
    }

    case 'motion.relative':
      return settle(relativeVelocity(vectorOf(read, 'a'), vectorOf(read, 'b')), isKinematicsError)

    case 'motion.river':
      return settle(
        riverCrossing({
          boatSpeed: read.number('boatSpeed'),
          riverSpeed: read.number('riverSpeed'),
          width: read.number('width'),
          heading: read.optionalNumber('heading', 0)
        }),
        isKinematicsError
      )

    case 'motion.wind':
      return settle(
        windTriangle({ airspeed: read.number('airspeed'), wind: vectorOf(read, 'wind'), course: read.number('course') }),
        isKinematicsError
      )

    case 'motion.circular':
      return settle(
        circularMotion({
          radius: read.number('radius'),
          mass: read.number('mass'),
          speed: read.has('speed') ? read.number('speed') : undefined,
          angularVelocity: read.has('angularVelocity') ? read.number('angularVelocity') : undefined,
          tangentialAcceleration: read.optionalNumber('tangentialAcceleration', 0)
        }),
        isKinematicsError
      )

    case 'motion.vertical-circle':
      return settle(
        verticalCircle({
          radius: read.number('radius'),
          mass: read.number('mass'),
          speedAtBottom: read.number('speedAtBottom'),
          gravity: read.optionalNumber('gravity', 9.81),
          canPull: read.boolean('canPull', false),
          steps: read.has('steps') ? Math.round(read.number('steps')) : undefined
        }),
        isKinematicsError
      )

    // ---------------------------------------------------------------- oscillators
    case 'oscillator.harmonic':
      return settle(
        simpleHarmonic({
          mass: read.number('mass'),
          stiffness: read.number('stiffness'),
          initialDisplacement: read.optionalNumber('initialDisplacement', 1),
          initialVelocity: read.optionalNumber('initialVelocity', 0)
        }),
        isOscillatorError
      )

    case 'oscillator.harmonic-trace': {
      const built = simpleHarmonic({
        mass: read.number('mass'),
        stiffness: read.number('stiffness'),
        initialDisplacement: read.optionalNumber('initialDisplacement', 1),
        initialVelocity: read.optionalNumber('initialVelocity', 0)
      })
      if (isOscillatorError(built)) return { ok: false, ...built }
      const duration = read.optionalNumber('duration', built.period * 3)
      const count = samples(read, 400)
      const trace = Array.from({ length: count }, (_, i) => {
        const time = (duration * i) / (count - 1)
        return { time, ...harmonicAt(built, time) }
      })
      return { ok: true, ...built, trace }
    }

    case 'oscillator.damping': {
      const built = classifyDamping({
        mass: read.number('mass'),
        stiffness: read.number('stiffness'),
        damping: read.optionalNumber('damping', 0)
      })
      if (isOscillatorError(built)) return { ok: false, ...built }
      return { ok: true, ...built, regimes: Object.entries(REGIME_FACTS).map(([regime, facts]) => ({ regime, ...facts })) }
    }

    case 'oscillator.damped-trace': {
      const setup = {
        mass: read.number('mass'),
        stiffness: read.number('stiffness'),
        damping: read.optionalNumber('damping', 0),
        initialDisplacement: read.optionalNumber('initialDisplacement', 1),
        initialVelocity: read.optionalNumber('initialVelocity', 0)
      }
      const classified = classifyDamping(setup)
      if (isOscillatorError(classified)) return { ok: false, ...classified }
      const duration = read.optionalNumber('duration', 10)
      const count = samples(read, 400)
      const trace: { time: number; position: number; velocity: number }[] = []
      for (let i = 0; i < count; i += 1) {
        const time = (duration * i) / (count - 1)
        const at = dampedAt(setup, time)
        if (isOscillatorError(at)) return { ok: false, ...at }
        trace.push({ time, ...at })
      }
      return { ok: true, ...classified, trace }
    }

    case 'oscillator.driven':
      return settle(
        drivenOscillator({
          mass: read.number('mass'),
          stiffness: read.number('stiffness'),
          damping: read.optionalNumber('damping', 0),
          forceAmplitude: read.number('forceAmplitude'),
          drivingFrequency: read.number('drivingFrequency')
        }),
        isOscillatorError
      )

    case 'oscillator.resonance':
      return settle(
        resonanceCurve(
          {
            mass: read.number('mass'),
            stiffness: read.number('stiffness'),
            damping: read.optionalNumber('damping', 0),
            forceAmplitude: read.optionalNumber('forceAmplitude', 1)
          },
          { from: read.optionalNumber('from', 0.1), to: read.number('to'), points: samples(read, 300) }
        ),
        isOscillatorError
      )

    case 'oscillator.coupled':
      return settle(
        coupledOscillators({
          mass1: read.number('mass1'),
          mass2: read.number('mass2'),
          stiffness1: read.number('stiffness1'),
          stiffness2: read.number('stiffness2'),
          coupling: read.number('coupling')
        }),
        isOscillatorError
      )

    case 'oscillator.pendulum-period':
      return settle(
        pendulumPeriod({
          length: read.number('length'),
          gravity: read.optionalNumber('gravity', 9.81),
          amplitudeDegrees: read.number('amplitudeDegrees')
        }),
        isOscillatorError
      )

    case 'oscillator.pendulum-swing':
      return settle(
        swingPendulum({
          length: read.number('length'),
          gravity: read.optionalNumber('gravity', 9.81),
          initialAngleDegrees: read.number('initialAngleDegrees'),
          initialAngularVelocity: read.optionalNumber('initialAngularVelocity', 0),
          duration: read.number('duration'),
          step: read.has('step') ? read.number('step') : undefined,
          samples: samples(read, 800)
        }),
        isOscillatorError
      )

    case 'oscillator.double-pendulum':
      return settle(
        doublePendulum(
          {
            mass1: read.optionalNumber('mass1', 1),
            mass2: read.optionalNumber('mass2', 1),
            length1: read.optionalNumber('length1', 1),
            length2: read.optionalNumber('length2', 1),
            gravity: read.optionalNumber('gravity', 9.81),
            angle1Degrees: read.number('angle1Degrees'),
            angle2Degrees: read.number('angle2Degrees'),
            rate1: read.optionalNumber('rate1', 0),
            rate2: read.optionalNumber('rate2', 0)
          },
          {
            duration: read.number('duration'),
            step: read.has('step') ? read.number('step') : undefined,
            samples: samples(read, 1500)
          }
        ),
        isOscillatorError
      )

    case 'oscillator.double-compare':
      return settle(
        compareDoublePendulums(
          {
            mass1: read.optionalNumber('mass1', 1),
            mass2: read.optionalNumber('mass2', 1),
            length1: read.optionalNumber('length1', 1),
            length2: read.optionalNumber('length2', 1),
            gravity: read.optionalNumber('gravity', 9.81),
            angle1Degrees: read.number('angle1Degrees'),
            angle2Degrees: read.number('angle2Degrees')
          },
          read.number('perturbation'),
          { duration: read.number('duration'), step: read.has('step') ? read.number('step') : undefined, samples: samples(read, 1000) }
        ),
        isOscillatorError
      )

    // ---------------------------------------------------------------- collisions
    case 'collision.head-on':
      return settle(
        headOnCollision({
          mass1: read.number('mass1'),
          velocity1: read.number('velocity1'),
          mass2: read.number('mass2'),
          velocity2: read.number('velocity2'),
          restitution: read.optionalNumber('restitution', 1)
        }),
        isCollisionError
      )

    case 'collision.glancing':
      return settle(
        glancingCollision(discOf(read, 'a'), discOf(read, 'b'), read.optionalNumber('restitution', 1)),
        isCollisionError
      )

    case 'collision.contact':
      return settle(timeToContact(discOf(read, 'a'), discOf(read, 'b')), isCollisionError)

    case 'collision.centre-of-mass':
      return settle(
        centreOfMassView([read.number('mass1'), read.number('mass2')], [vectorOf(read, 'velocity1'), vectorOf(read, 'velocity2')]),
        isCollisionError
      )

    case 'collision.restitution':
      return settle(
        restitutionFrom({
          velocity1Before: read.number('velocity1Before'),
          velocity2Before: read.number('velocity2Before'),
          velocity1After: read.number('velocity1After'),
          velocity2After: read.number('velocity2After')
        }),
        isCollisionError
      )

    // ---------------------------------------------------------------- gravity
    case 'gravity.between':
      return settle(
        gravityBetween({
          mass1: read.number('mass1'),
          mass2: read.number('mass2'),
          position1: vectorOf(read, 'position1', vec(0, 0)),
          position2: vectorOf(read, 'position2'),
          constant: read.has('constant') ? read.number('constant') : undefined
        }),
        isGravitationError
      )

    case 'gravity.field': {
      const sources = read.list('sources', PHYSICS_LIMITS.bodies).map((one) => {
        const entry = new Reader(one)
        return { mass: entry.number('mass'), position: vectorOf(entry, 'position', vec(0, 0)) }
      })
      const area = read.raw('area')
      if (typeof area !== 'object' || area === null || Array.isArray(area)) throw new BadInput('"area" has to be an object.')
      const entry = new Reader(area as Record<string, unknown>)
      const columns = Math.round(entry.number('columns'))
      const rows = Math.round(entry.number('rows'))
      if (columns * rows > PHYSICS_LIMITS.gridPoints) {
        throw new BadInput(`A grid of ${columns * rows} points is more than the ${PHYSICS_LIMITS.gridPoints} this door carries back.`)
      }
      return settle(
        fieldGrid(
          sources,
          { xFrom: entry.number('xFrom'), xTo: entry.number('xTo'), yFrom: entry.number('yFrom'), yTo: entry.number('yTo'), columns, rows },
          read.has('constant') ? read.number('constant') : undefined
        ),
        isGravitationError
      )
    }

    case 'gravity.orbit':
      return { ok: true, ...orbitOf(input), shapes: Object.entries(ORBIT_FACTS).map(([shape, facts]) => ({ shape, ...facts })) }

    case 'gravity.orbit-path':
      return settle(orbitPath(orbitOf(input), Math.round(read.optionalNumber('points', 360))), isGravitationError)

    case 'gravity.compare-orbits': {
      const orbits = read.list('orbits', 16).map((one, i) => {
        const entry = new Reader(one)
        return { label: entry.optionalText('label', `Orbit ${i + 1}`, 120), orbit: orbitOf(one) }
      })
      return settle(compareOrbits(orbits), isGravitationError)
    }

    case 'gravity.speeds': {
      const mass = read.number('centralMass')
      const radius = read.number('radius')
      const constant = read.has('constant') ? read.number('constant') : undefined
      const circular = circularSpeed(mass, radius, constant)
      if (isGravitationError(circular)) return { ok: false, ...circular }
      const escape = escapeSpeed(mass, radius, constant)
      if (isGravitationError(escape)) return { ok: false, ...escape }
      return { ok: true, circular, escape, radius, centralMass: mass }
    }

    case 'gravity.n-body': {
      const result = nBody(bodiesOf(read), {
        constant: read.has('constant') ? read.number('constant') : undefined,
        softening: read.optionalNumber('softening', 0),
        step: read.number('step'),
        until: read.number('until'),
        samples: samples(read, 600)
      })
      if (isGravitationError(result)) return { ok: false, ...result }
      return { ok: true, ...result, bodyIds: bodiesOf(read).map((one) => one.id) }
    }

    case 'gravity.pair': {
      const built = orbitingPair({
        mass1: read.number('mass1'),
        mass2: read.number('mass2'),
        separation: read.number('separation'),
        constant: read.has('constant') ? read.number('constant') : undefined
      })
      return isGravitationError(built) ? { ok: false, ...built } : { ok: true, bodies: built }
    }

    // ---------------------------------------------------------------- rotation
    case 'rotation.shapes':
      return {
        ok: true,
        shapes: SHAPES.map((one) => ({ shape: one, ...INERTIA_FACTS[one] })),
        assumptions: [...RIGID_BODY_ASSUMPTIONS]
      }

    case 'rotation.inertia':
      return settle(
        inertiaOf({
          shape: read.choice('shape', SHAPES, 'solid-disc') as Shape,
          mass: read.number('mass'),
          size: read.number('size'),
          secondSize: read.has('secondSize') ? read.number('secondSize') : undefined
        }),
        isRigidBodyError
      )

    case 'rotation.shift-axis':
      return settle(
        shiftAxis({
          aboutCentreOfMass: read.number('aboutCentreOfMass'),
          mass: read.number('mass'),
          distance: read.number('distance')
        }),
        isRigidBodyError
      )

    case 'rotation.composite': {
      const parts: Part[] = read.list('parts', PHYSICS_LIMITS.parts).map((one, i) => {
        const entry = new Reader(one)
        return {
          label: entry.optionalText('label', `Part ${i + 1}`, 120),
          mass: entry.number('mass'),
          inertiaAboutOwnCentre: entry.optionalNumber('inertiaAboutOwnCentre', 0),
          position: vectorOf(entry, 'position', vec(0, 0))
        }
      })
      return settle(compositeBody(parts), isRigidBodyError)
    }

    case 'rotation.torque':
      return settle(
        torqueFrom({
          pivot: vectorOf(read, 'pivot', vec(0, 0)),
          applicationPoint: vectorOf(read, 'applicationPoint'),
          force: vectorOf(read, 'force')
        }),
        isRigidBodyError
      )

    case 'rotation.spin':
      return settle(
        spinUnderTorque({
          inertia: read.number('inertia'),
          torque: read.number('torque'),
          initialAngularVelocity: read.optionalNumber('initialAngularVelocity', 0),
          initialAngle: read.optionalNumber('initialAngle', 0),
          time: read.number('time')
        }),
        isRigidBodyError
      )

    case 'rotation.rolling':
      return settle(
        rollingDownSlope({
          shape: read.choice('shape', SHAPES, 'solid-sphere') as Shape,
          slopeDegrees: read.number('slopeDegrees'),
          gravity: read.optionalNumber('gravity', 9.81),
          frictionCoefficient: read.has('frictionCoefficient') ? read.number('frictionCoefficient') : undefined,
          dropHeight: read.has('dropHeight') ? read.number('dropHeight') : undefined
        }),
        isRigidBodyError
      )

    case 'rotation.race':
      return settle(
        rollingRace({
          shapes: read.strings('shapes', 12) as Shape[],
          slopeDegrees: read.number('slopeDegrees'),
          gravity: read.optionalNumber('gravity', 9.81),
          distance: read.number('distance')
        }),
        isRigidBodyError
      )

    // ---------------------------------------------------------------- waves
    case 'wave.travelling':
      return { ok: true, ...waveOf(input) }

    case 'wave.sample':
      return settle(sampleWave(waveOf(input), spanOf(read), read.optionalNumber('time', 0)), isWaveError)

    case 'wave.standing': {
      const built = standingWave({
        length: read.number('length'),
        speed: read.number('speed'),
        harmonic: Math.round(read.number('harmonic')),
        boundary: read.choice('boundary', ['both-fixed', 'both-free', 'one-fixed-one-free'] as const, 'both-fixed') as BoundaryCondition
      })
      if (isWaveError(built)) return { ok: false, ...built }
      return { ok: true, ...built, boundaries: Object.entries(BOUNDARY_FACTS).map(([boundary, facts]) => ({ boundary, ...facts })) }
    }

    case 'wave.standing-sample': {
      const built = standingWave({
        length: read.number('length'),
        speed: read.number('speed'),
        harmonic: Math.round(read.number('harmonic')),
        boundary: read.choice('boundary', ['both-fixed', 'both-free', 'one-fixed-one-free'] as const, 'both-fixed') as BoundaryCondition
      })
      if (isWaveError(built)) return { ok: false, ...built }
      const sampled = sampleStanding(built, read.optionalNumber('amplitude', 1), read.optionalNumber('time', 0), samples(read, 400))
      if (isWaveError(sampled)) return { ok: false, ...sampled }
      return { ok: true, ...built, ...sampled }
    }

    case 'wave.superpose': {
      const waves = read.list('waves', PHYSICS_LIMITS.waves).map((one) => waveOf(one))
      return settle(superpose(waves, spanOf(read), read.optionalNumber('time', 0)), isWaveError)
    }

    case 'wave.interference': {
      const sourceOf = (key: string): { x: number; y: number; amplitude: number; phase: number } => {
        const raw = read.raw(key)
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new BadInput(`"${key}" has to be an object.`)
        const entry = new Reader(raw as Record<string, unknown>)
        return {
          x: entry.number('x'),
          y: entry.number('y'),
          amplitude: entry.optionalNumber('amplitude', 1),
          phase: entry.optionalNumber('phase', 0)
        }
      }
      return settle(
        interferenceAt({
          source1: sourceOf('source1'),
          source2: sourceOf('source2'),
          point: vectorOf(read, 'point'),
          wavelength: read.number('wavelength')
        }),
        isWaveError
      )
    }

    case 'wave.beats':
      return settle(
        beats({
          frequency1: read.number('frequency1'),
          frequency2: read.number('frequency2'),
          amplitude: read.optionalNumber('amplitude', 1),
          duration: read.number('duration'),
          points: samples(read, 2000)
        }),
        isWaveError
      )

    case 'wave.packet':
      return settle(
        wavePacket({
          carrierWavelength: read.number('carrierWavelength'),
          envelopeWidth: read.number('envelopeWidth'),
          phaseVelocity: read.number('phaseVelocity'),
          groupVelocity: read.number('groupVelocity'),
          centre: read.has('centre') ? read.number('centre') : undefined,
          span: spanOf(read),
          time: read.optionalNumber('time', 0)
        }),
        isWaveError
      )

    default:
      // Reached only when an operation has a capability above and no case here, which the caller could not have
      // caused: the capability check ran before this and let it through.
      throw new BadInput(`"${operation}" has a capability but no implementation, which is a bug in Orbis rather than in your Page.`)
  }
}

/** Everything a physics Page should be able to show about what it is standing on. */
export const PHYSICS_ASSUMPTIONS: readonly string[] = Object.freeze([
  ...MECHANICS_ASSUMPTIONS,
  ...OSCILLATOR_ASSUMPTIONS,
  ...WAVE_ASSUMPTIONS
])
