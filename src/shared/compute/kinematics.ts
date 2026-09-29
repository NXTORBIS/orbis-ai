/**
 * Motion: projectiles, phases of acceleration, relative velocity and going round in circles.
 *
 * The shared kinematics engine for Orbis Pages. Where `mechanics.ts` integrates forces forward in time, this file
 * answers the questions that have a closed form — and is careful about the boundary between the two, because that
 * boundary is where most of the wrong answers in this subject live.
 *
 * ## The one thing this file will not do
 *
 * It will not apply the projectile formulas when there is drag. `range = v²sin(2θ)/g` is the solution to a
 * particular differential equation, and adding drag makes it a different equation with no elementary solution. A
 * page that shows the ideal range beside a drag slider is showing a number that stopped being true the moment the
 * slider moved. So `projectile` refuses a drag coefficient, `projectileWithDrag` integrates instead, and
 * `compareProjectile` runs both and reports the difference rather than implying either is the other.
 *
 * ## The distinctions this file refuses to blur
 *
 * ```
 * analytical    vs   numerical       -- exact for the model, or integrated; the difference is measured and shown
 * the model     vs   the world       -- an ideal projectile is a statement about an idealisation
 * speed         vs   velocity        -- one has a direction, and the whole of relative motion turns on it
 * distance      vs   displacement    -- a body that comes back has travelled and not moved
 * radial        vs   tangential      -- acceleration in a circle has two parts and only one changes the speed
 * frame A       vs   frame B         -- a velocity without a frame is not a velocity
 * ```
 *
 * Pure. No network, no clock, no storage.
 */

import {
  body,
  isMechanicsError,
  magnitude,
  run,
  system,
  vec,
  type Force,
  type Snapshot,
  type Vec2
} from './mechanics.ts'

export interface KinematicsError {
  error: 'invalid-argument' | 'not-finite' | 'no-solution' | 'not-applicable' | 'unreachable'
  message: string
}

export const isKinematicsError = (value: unknown): value is KinematicsError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: KinematicsError['error'], message: string): KinematicsError => ({ error, message })

const degrees = (radians: number): number => (radians * 180) / Math.PI
const radians = (deg: number): number => (deg * Math.PI) / 180

// ---------------------------------------------------------------- projectiles

export interface ProjectileSetup {
  /** Speed at launch. */
  speed: number
  /** Above the horizontal, in degrees. */
  angle: number
  /** Height it starts at, measured from where it lands. */
  height: number
  /** Downward acceleration, positive. */
  gravity: number
}

export interface Projectile {
  setup: ProjectileSetup
  /** Components of the launch velocity. */
  initial: Vec2
  /** Time from launch to landing. */
  timeOfFlight: number
  /** Horizontal distance covered by then. */
  range: number
  /** Highest point above the landing height. */
  maximumHeight: number
  /** When it reaches that height. */
  timeToApex: number
  /** Velocity at the moment it lands. */
  impact: Vec2
  impactSpeed: number
  /** Below the horizontal, in degrees. */
  impactAngle: number
  /** The angle that would give the greatest range from this height at this speed. */
  bestAngle: number
  method: 'analytical'
  assumptions: readonly string[]
}

/**
 * A projectile with no air resistance, solved exactly.
 *
 * Exact for the model, which is a different claim from exact. The assumptions are on the result rather than in a
 * footnote, because every one of them is a way the number differs from a thrown ball.
 *
 * The launch height is handled properly rather than assumed zero: the flight time comes from the quadratic and the
 * best angle is below 45° whenever the launch is above the landing, which is the part a simplified version gets
 * wrong.
 */
export function projectile(setup: ProjectileSetup): Projectile | KinematicsError {
  const { speed, angle, height, gravity } = setup
  if (![speed, angle, height, gravity].every((one) => Number.isFinite(one))) {
    return fail('not-finite', 'Every value must be a finite number.')
  }
  if (speed < 0) return fail('invalid-argument', 'A launch speed is not negative. To launch the other way, turn the angle round.')
  if (gravity <= 0) {
    return fail(
      'invalid-argument',
      'Gravity must be positive. With no gravity a projectile never lands, so there is no range, no flight time and no apex to report.'
    )
  }
  if (height < 0) return fail('invalid-argument', 'The launch height is measured from where it lands, so it is not negative.')

  const theta = radians(angle)
  const vx = speed * Math.cos(theta)
  const vy = speed * Math.sin(theta)

  // Solving h + vy·t − ½g·t² = 0 for the positive root.
  const discriminant = vy * vy + 2 * gravity * height
  if (discriminant < 0) return fail('no-solution', 'This launch never reaches the landing height.')
  const timeOfFlight = (vy + Math.sqrt(discriminant)) / gravity
  if (timeOfFlight <= 0) {
    return fail('no-solution', 'This launch lands at the moment it leaves, so there is no flight to describe.')
  }

  const timeToApex = Math.max(0, vy / gravity)
  const maximumHeight = height + (vy > 0 ? (vy * vy) / (2 * gravity) : 0)
  const impactY = vy - gravity * timeOfFlight
  const impact = { x: vx, y: impactY }

  // The best angle from a height is below 45°, approaching it as the height goes to zero.
  const bestAngle =
    speed === 0 ? 0 : degrees(Math.atan(speed / Math.sqrt(speed * speed + 2 * gravity * height)))

  return {
    setup,
    initial: { x: vx, y: vy },
    timeOfFlight,
    range: vx * timeOfFlight,
    maximumHeight,
    timeToApex,
    impact,
    impactSpeed: magnitude(impact),
    impactAngle: impactY === 0 && vx === 0 ? 0 : degrees(Math.atan2(-impactY, vx)),
    bestAngle,
    method: 'analytical',
    assumptions: [
      'No air resistance at all. This is the largest difference between this and a real throw, and it grows with speed: a cricket ball at 40 m/s travels far less than this says.',
      'Gravity is the same everywhere along the path and points straight down. True enough over a field, not over a continent.',
      'The projectile is a point. No spin, so no lift and no swerve.',
      'The ground is level at the landing height given.'
    ]
  }
}

export interface ProjectileTrace {
  /** Sampled path, in launch-relative coordinates with y measured from the landing height. */
  path: readonly { time: number; position: Vec2; velocity: Vec2 }[]
  timeOfFlight: number
  range: number
  maximumHeight: number
  impact: Vec2
  impactSpeed: number
  impactAngle: number
  method: 'numerical'
  /** The drag that was applied, so a result cannot be mistaken for the ideal case. */
  drag: { kind: 'none' | 'linear' | 'quadratic'; coefficient: number }
  step: number
  notes: readonly string[]
}

export interface DragSetup {
  kind: 'none' | 'linear' | 'quadratic'
  /** Force per unit velocity for linear drag, per unit velocity squared for quadratic. */
  coefficient: number
  /** The projectile's mass. Irrelevant without drag, and decisive with it. */
  mass: number
}

/**
 * A projectile integrated forward, with or without drag.
 *
 * Mass matters here and does not in the ideal case, which is worth seeing: without drag every projectile launched
 * the same way follows the same path whatever it weighs, and with drag a heavier one goes further because the same
 * resisting force decelerates it less.
 */
export function projectileWithDrag(
  setup: ProjectileSetup,
  drag: DragSetup,
  options: { step?: number; samples?: number } = {}
): ProjectileTrace | KinematicsError {
  const ideal = projectile({ ...setup, gravity: setup.gravity })
  if (isKinematicsError(ideal) && drag.kind === 'none') return ideal
  if (!Number.isFinite(drag.coefficient) || drag.coefficient < 0) {
    return fail('invalid-argument', 'A drag coefficient is zero or more.')
  }
  if (!Number.isFinite(drag.mass) || drag.mass <= 0) {
    return fail('invalid-argument', 'A projectile with drag needs a positive mass: the same resisting force slows a light object more than a heavy one.')
  }
  if (setup.gravity <= 0) return fail('invalid-argument', 'Gravity must be positive for a projectile to land.')

  const theta = radians(setup.angle)
  const start = body({
    id: 'projectile',
    mass: drag.mass,
    position: vec(0, setup.height),
    velocity: vec(setup.speed * Math.cos(theta), setup.speed * Math.sin(theta))
  })
  if (isMechanicsError(start)) return fail('invalid-argument', start.message)

  const forces: Force[] = [{ kind: 'uniform-gravity', acceleration: vec(0, -setup.gravity) }]
  if (drag.kind === 'linear' && drag.coefficient > 0) forces.push({ kind: 'linear-drag', bodyId: null, coefficient: drag.coefficient })
  if (drag.kind === 'quadratic' && drag.coefficient > 0) forces.push({ kind: 'quadratic-drag', bodyId: null, coefficient: drag.coefficient })

  const built = system([start], forces)
  if (isMechanicsError(built)) return fail('invalid-argument', built.message)

  const step = options.step ?? 0.0005
  // A generous ceiling: the run stops on landing, and anything that has not landed by then never will.
  const until = Math.max(1, (2 * setup.speed) / setup.gravity + Math.sqrt((2 * setup.height) / setup.gravity) + 5)
  const result = run(built, {
    integrator: 'velocity-verlet',
    step,
    until,
    samples: options.samples ?? 2000,
    stopWhen: (snapshot: Snapshot) => (snapshot.positions[0]?.y ?? 0) < 0
  })
  if (isMechanicsError(result)) return fail('no-solution', result.message)
  if (result.status !== 'stopped-early') {
    return fail('no-solution', `The projectile had not landed after ${until.toPrecision(3)} s. Check the gravity and the launch height.`)
  }

  const path = result.trace.map((snapshot) => ({
    time: snapshot.time,
    position: snapshot.positions[0] ?? vec(0, 0),
    velocity: snapshot.velocities[0] ?? vec(0, 0)
  }))

  // The last kept step is just below the ground; interpolate back to exactly y = 0 rather than reporting an
  // overshoot that depends on the step size.
  const last = path[path.length - 1]
  const before = path[path.length - 2]
  let landing = last ?? { time: 0, position: vec(0, 0), velocity: vec(0, 0) }
  if (last !== undefined && before !== undefined && last.position.y < 0 && before.position.y >= 0) {
    const span = before.position.y - last.position.y
    const fraction = span === 0 ? 0 : before.position.y / span
    landing = {
      time: before.time + (last.time - before.time) * fraction,
      position: vec(before.position.x + (last.position.x - before.position.x) * fraction, 0),
      velocity: vec(
        before.velocity.x + (last.velocity.x - before.velocity.x) * fraction,
        before.velocity.y + (last.velocity.y - before.velocity.y) * fraction
      )
    }
  }

  let maximumHeight = setup.height
  for (const point of path) if (point.position.y > maximumHeight) maximumHeight = point.position.y

  const notes: string[] = []
  if (drag.kind === 'none') {
    notes.push('No drag, so this should match the analytical answer to within the integration error. It is here so the two can be compared.')
  } else {
    notes.push(
      `${drag.kind === 'linear' ? 'Linear' : 'Quadratic'} drag at ${drag.coefficient}. The projectile formulas do not apply to this trajectory — they solve a different equation — so no analytical range is quoted beside it.`
    )
    notes.push(`Mass matters here. Without drag every projectile follows the same path whatever it weighs; with drag a heavier one goes further, because the same resisting force slows it less.`)
  }
  notes.push(`Integrated with velocity Verlet at ${step} s per step, landing found by interpolating between the last two steps rather than by overshooting.`)

  return {
    path: [...path.slice(0, -1), landing],
    timeOfFlight: landing.time,
    range: landing.position.x,
    maximumHeight,
    impact: landing.velocity,
    impactSpeed: magnitude(landing.velocity),
    impactAngle: degrees(Math.atan2(-landing.velocity.y, landing.velocity.x)),
    method: 'numerical',
    drag: { kind: drag.kind, coefficient: drag.coefficient },
    step,
    notes
  }
}

export interface ProjectileComparison {
  analytical: Projectile
  numerical: ProjectileTrace
  difference: { range: number; maximumHeight: number; timeOfFlight: number; impactSpeed: number }
  relativeDifference: { range: number; maximumHeight: number; timeOfFlight: number }
  /** What the difference actually is: integration error, or drag changing the physics. */
  because: 'integration-error' | 'drag'
  why: string
}

/**
 * The analytical and numerical answers side by side.
 *
 * With no drag, the difference is the integrator's error and should be tiny — which is a real check on the
 * integration rather than a decoration. With drag, the difference is the drag, and the analytical column is there to
 * show what the idealisation was hiding, not as a competing answer.
 */
export function compareProjectile(
  setup: ProjectileSetup,
  drag: DragSetup,
  options: { step?: number } = {}
): ProjectileComparison | KinematicsError {
  const analytical = projectile(setup)
  if (isKinematicsError(analytical)) return analytical
  const numerical = projectileWithDrag(setup, drag, options)
  if (isKinematicsError(numerical)) return numerical

  const difference = {
    range: numerical.range - analytical.range,
    maximumHeight: numerical.maximumHeight - analytical.maximumHeight,
    timeOfFlight: numerical.timeOfFlight - analytical.timeOfFlight,
    impactSpeed: numerical.impactSpeed - analytical.impactSpeed
  }
  const relative = (value: number, base: number): number => (base === 0 ? 0 : value / base)
  const dragged = drag.kind !== 'none' && drag.coefficient > 0

  return {
    analytical,
    numerical,
    difference,
    relativeDifference: {
      range: relative(difference.range, analytical.range),
      maximumHeight: relative(difference.maximumHeight, analytical.maximumHeight),
      timeOfFlight: relative(difference.timeOfFlight, analytical.timeOfFlight)
    },
    because: dragged ? 'drag' : 'integration-error',
    why: dragged
      ? `The two disagree because they are answers to different questions. The analytical column solves motion with no air resistance; the numerical one has ${drag.kind} drag in it. The gap — ${Math.abs(difference.range).toPrecision(4)} m of range — is what ignoring the air costs at this speed, not an error in either.`
      : `With no drag both solve the same equation, so the gap of ${Math.abs(difference.range).toPrecision(3)} m is the integrator's error at a ${numerical.step} s step and nothing else. A smaller step shrinks it.`
  }
}

// ---------------------------------------------------------------- motion in phases

export interface Phase {
  /** How long this phase lasts. */
  duration: number
  /** Constant acceleration during it. */
  acceleration: number
  label?: string
}

export interface PhaseResult {
  label: string
  startTime: number
  endTime: number
  acceleration: number
  startPosition: number
  endPosition: number
  startVelocity: number
  endVelocity: number
  /** Net movement during this phase. Negative when it went backwards. */
  displacement: number
  /** Ground actually covered, which differs whenever the velocity changed sign inside the phase. */
  distance: number
  /** When the velocity passed through zero, if it did. */
  turnedAt: number | null
}

export interface Motion {
  phases: readonly PhaseResult[]
  totalTime: number
  finalPosition: number
  finalVelocity: number
  /** Where it ended up, relative to where it started. */
  displacement: number
  /** How far it travelled, which is larger whenever it turned round. */
  distance: number
  /** Samples for plotting, at the interval asked for. */
  samples: readonly { time: number; position: number; velocity: number; acceleration: number }[]
  notes: readonly string[]
}

/**
 * One-dimensional motion in phases of constant acceleration.
 *
 * Exact within each phase — constant acceleration has a closed form — and the phases are joined at their boundaries,
 * so nothing is integrated and nothing drifts.
 *
 * Distance and displacement are reported separately and a phase says when the velocity turned round, because those
 * are the same number until something reverses and then they are not, and the moment of reversal is exactly what a
 * motion graph is usually being read for.
 */
export function motionInPhases(
  phases: readonly Phase[],
  start: { position: number; velocity: number },
  options: { sampleInterval?: number } = {}
): Motion | KinematicsError {
  if (phases.length === 0) return fail('invalid-argument', 'There are no phases, so there is no motion to describe.')
  if (phases.length > 100) return fail('invalid-argument', 'More than 100 phases is refused.')
  if (!Number.isFinite(start.position) || !Number.isFinite(start.velocity)) {
    return fail('not-finite', 'The starting position and velocity must be finite numbers.')
  }
  for (const [i, one] of phases.entries()) {
    if (!Number.isFinite(one.duration) || one.duration <= 0) {
      return fail('invalid-argument', `Phase ${i + 1} lasts ${one.duration} s. A phase has a positive duration.`)
    }
    if (!Number.isFinite(one.acceleration)) return fail('not-finite', `Phase ${i + 1} has an acceleration that is not a finite number.`)
  }

  const out: PhaseResult[] = []
  let time = 0
  let position = start.position
  let velocity = start.velocity
  let distance = 0

  for (const [i, one] of phases.entries()) {
    const a = one.acceleration
    const t = one.duration
    const endVelocity = velocity + a * t
    const endPosition = position + velocity * t + 0.5 * a * t * t

    // If the velocity changed sign inside this phase, the ground covered is not the net movement.
    let turnedAt: number | null = null
    let covered = Math.abs(endPosition - position)
    if (a !== 0) {
      const zero = -velocity / a
      if (zero > 0 && zero < t) {
        turnedAt = time + zero
        const atTurn = position + velocity * zero + 0.5 * a * zero * zero
        covered = Math.abs(atTurn - position) + Math.abs(endPosition - atTurn)
      }
    }

    out.push({
      label: one.label ?? `Phase ${i + 1}`,
      startTime: time,
      endTime: time + t,
      acceleration: a,
      startPosition: position,
      endPosition,
      startVelocity: velocity,
      endVelocity,
      displacement: endPosition - position,
      distance: covered,
      turnedAt
    })

    distance += covered
    time += t
    position = endPosition
    velocity = endVelocity
  }

  const interval = options.sampleInterval ?? Math.max(time / 500, 1e-6)
  const samples: { time: number; position: number; velocity: number; acceleration: number }[] = []
  const at = (want: number): { position: number; velocity: number; acceleration: number } => {
    let elapsed = 0
    let p = start.position
    let v = start.velocity
    for (const one of phases) {
      if (want <= elapsed + one.duration) {
        const dt = want - elapsed
        return { position: p + v * dt + 0.5 * one.acceleration * dt * dt, velocity: v + one.acceleration * dt, acceleration: one.acceleration }
      }
      p = p + v * one.duration + 0.5 * one.acceleration * one.duration * one.duration
      v = v + one.acceleration * one.duration
      elapsed += one.duration
    }
    return { position: p, velocity: v, acceleration: phases[phases.length - 1]?.acceleration ?? 0 }
  }
  for (let t = 0; t <= time + 1e-12 && samples.length < 5000; t += interval) {
    samples.push({ time: Math.min(t, time), ...at(Math.min(t, time)) })
  }

  const turns = out.filter((one) => one.turnedAt !== null).length
  const notes: string[] = [
    'Each phase is solved exactly: constant acceleration has a closed form, so nothing here is integrated and nothing drifts.'
  ]
  if (Math.abs(distance - Math.abs(position - start.position)) > 1e-9) {
    notes.push(
      `It travelled ${distance.toPrecision(6)} and ended ${Math.abs(position - start.position).toPrecision(6)} from where it began. The two differ because it turned round ${turns === 1 ? 'once' : `${turns} times`}; distance is ground covered and displacement is net movement.`
    )
  }

  return {
    phases: out,
    totalTime: time,
    finalPosition: position,
    finalVelocity: velocity,
    displacement: position - start.position,
    distance,
    samples,
    notes
  }
}

// ---------------------------------------------------------------- relative motion

export interface Relative {
  /** The velocity of the first, as seen from the second. */
  velocity: Vec2
  speed: number
  /** Direction of that velocity, anticlockwise from the positive x axis, in degrees. */
  bearing: number
  why: string
}

/** How fast one thing moves as seen from another. Both velocities must be in the same frame to start with. */
export function relativeVelocity(a: Vec2, b: Vec2): Relative | KinematicsError {
  if (![a.x, a.y, b.x, b.y].every((one) => Number.isFinite(one))) return fail('not-finite', 'Both velocities must be finite.')
  const velocity = { x: a.x - b.x, y: a.y - b.y }
  const speed = magnitude(velocity)
  return {
    velocity,
    speed,
    bearing: speed === 0 ? 0 : degrees(Math.atan2(velocity.y, velocity.x)),
    why:
      speed === 0
        ? 'The two are moving identically, so from either one the other is standing still. Neither is at rest in the original frame.'
        : 'Subtracting one velocity from the other. Both had to be given in the same frame for the subtraction to mean anything — a velocity with no frame behind it is not a velocity.'
  }
}

export interface RiverCrossing {
  /** The boat's velocity over the ground: its own velocity plus the river's. */
  overGround: Vec2
  groundSpeed: number
  /** How long to reach the far bank. Null when the heading never gets there. */
  crossingTime: number | null
  /** How far downstream it lands. */
  drift: number | null
  /** Where it lands on the far bank, measured along it. */
  landingPoint: number | null
  /** The heading that lands straight across, in degrees from straight across. Null when the river is too fast. */
  headingForNoDrift: number | null
  /** The shortest possible crossing time, which is straight across whatever the river does. */
  quickestTime: number
  why: string
  notes: readonly string[]
}

/**
 * A boat crossing a river.
 *
 * The classic, and it earns its place: the two obvious strategies optimise different things and the result shows
 * both. Pointing straight across gives the shortest time whatever the current does — the downstream flow has no
 * component across the river, so it cannot slow the crossing — while landing directly opposite needs an upstream
 * heading and always takes longer. When the river is faster than the boat, the second is impossible and the result
 * says so rather than producing an angle.
 *
 * Heading is measured from straight across: 0 points at the far bank, positive points upstream.
 */
export function riverCrossing(input: {
  boatSpeed: number
  riverSpeed: number
  width: number
  /** Degrees from straight across; positive is upstream. */
  heading: number
}): RiverCrossing | KinematicsError {
  const { boatSpeed, riverSpeed, width, heading } = input
  if (![boatSpeed, riverSpeed, width, heading].every((one) => Number.isFinite(one))) {
    return fail('not-finite', 'Every value must be a finite number.')
  }
  if (boatSpeed < 0 || riverSpeed < 0) return fail('invalid-argument', 'Speeds are not negative.')
  if (width <= 0) return fail('invalid-argument', 'The river has a positive width.')

  const theta = radians(heading)
  // x is downstream, y is across.
  const boat = { x: -boatSpeed * Math.sin(theta), y: boatSpeed * Math.cos(theta) }
  const overGround = { x: boat.x + riverSpeed, y: boat.y }

  // Measured against the boat's own speed rather than against zero. cos(90°) is 6e-17 rather than 0 in floating
  // point, so a boat pointed exactly along the bank would otherwise "cross" in about 4e17 seconds -- and a heading a
  // hair off 90° really does cross, in a time no experiment could mean. Both cases are the same answer: it does not
  // get there.
  const negligible = boatSpeed * 1e-9
  const crossingTime = overGround.y > negligible ? width / overGround.y : null
  const drift = crossingTime === null ? null : overGround.x * crossingTime

  const headingForNoDrift =
    boatSpeed === 0 ? null : riverSpeed > boatSpeed ? null : degrees(Math.asin(Math.min(1, riverSpeed / boatSpeed)))

  const notes: string[] = [
    'Heading is measured from straight across: 0 points at the far bank and positive points upstream.',
    'Pointing straight across gives the shortest crossing whatever the current does. The current flows along the bank, so it has no component across the river and cannot slow the crossing — it only decides where you land.'
  ]
  if (headingForNoDrift === null && boatSpeed > 0) {
    notes.push(`The river runs at ${riverSpeed} and the boat makes ${boatSpeed}. No heading lands directly opposite: to cancel the current the boat would have to point further upstream than it can push.`)
  }

  return {
    overGround,
    groundSpeed: magnitude(overGround),
    crossingTime,
    drift,
    landingPoint: drift,
    headingForNoDrift,
    quickestTime: boatSpeed === 0 ? Number.POSITIVE_INFINITY : width / boatSpeed,
    why:
      crossingTime === null
        ? 'This heading has no usable component toward the far bank, so the boat never crosses however long it goes on.'
        : `Crossing in ${crossingTime.toPrecision(4)}, landing ${Math.abs(drift ?? 0).toPrecision(4)} ${(drift ?? 0) >= 0 ? 'downstream' : 'upstream'} of the start.`,
    notes
  }
}

export interface WindTriangle {
  /** Where the nose has to point, in degrees anticlockwise from the positive x axis. */
  heading: number
  /** The aircraft's velocity through the air. */
  throughAir: Vec2
  /** Its velocity over the ground: through the air plus the wind. */
  overGround: Vec2
  groundSpeed: number
  /** Angle between where it points and where it goes, in degrees. */
  driftAngle: number
  why: string
}

/**
 * The heading that makes an aircraft track a desired course through a wind.
 *
 * There is a heading only when the aircraft can outrun the crosswind component. When it cannot, the result says so
 * rather than returning a number from an arcsine that was out of range — an aircraft that cannot hold the course
 * has no heading that holds it, and reporting one would be inventing an answer.
 */
export function windTriangle(input: {
  airspeed: number
  wind: Vec2
  /** The course to make good, in degrees anticlockwise from the positive x axis. */
  course: number
}): WindTriangle | KinematicsError {
  const { airspeed, wind, course } = input
  if (![airspeed, wind.x, wind.y, course].every((one) => Number.isFinite(one))) return fail('not-finite', 'Every value must be finite.')
  if (airspeed <= 0) return fail('invalid-argument', 'The airspeed must be positive.')

  const along = { x: Math.cos(radians(course)), y: Math.sin(radians(course)) }
  const across = { x: -along.y, y: along.x }
  const crosswind = wind.x * across.x + wind.y * across.y

  if (Math.abs(crosswind) > airspeed) {
    return fail(
      'unreachable',
      `The wind across the course is ${Math.abs(crosswind).toPrecision(4)} and the aircraft makes ${airspeed} through the air. No heading holds this course: the aircraft cannot cancel a crosswind it cannot outrun.`
    )
  }

  // Point into the crosswind by just enough to cancel it.
  const correction = Math.asin(-crosswind / airspeed)
  const heading = radians(course) + correction
  const throughAir = { x: airspeed * Math.cos(heading), y: airspeed * Math.sin(heading) }
  const overGround = { x: throughAir.x + wind.x, y: throughAir.y + wind.y }
  const groundSpeed = magnitude(overGround)

  return {
    heading: degrees(heading),
    throughAir,
    overGround,
    groundSpeed,
    driftAngle: Math.abs(degrees(correction)),
    why: `Pointing ${Math.abs(degrees(correction)).toPrecision(3)}° ${correction > 0 ? 'left of' : 'right of'} the course cancels the ${Math.abs(crosswind).toPrecision(4)} of crosswind. The ground speed of ${groundSpeed.toPrecision(4)} is ${groundSpeed < airspeed ? 'below' : 'above'} the airspeed because the wind also has a component along the course.`
  }
}

// ---------------------------------------------------------------- going round

export interface CircularMotion {
  radius: number
  speed: number
  angularVelocity: number
  period: number
  frequency: number
  /** Toward the centre. Always, whatever the speed is doing. */
  centripetalAcceleration: number
  centripetalForce: number
  /** Along the path. Zero when the speed is steady. */
  tangentialAcceleration: number
  /** The two components together. */
  totalAcceleration: number
  /** Angle of the total acceleration from the inward radius, in degrees. */
  accelerationAngle: number
  angularMomentum: number
  kineticEnergy: number
  notes: readonly string[]
}

/**
 * Motion in a circle, uniform or not.
 *
 * The centripetal component is there whenever anything moves in a circle, whether or not the speed is changing, and
 * the tangential component is the only one that changes the speed. Keeping them separate is the whole of this
 * subject: "the acceleration is 4 m/s²" says almost nothing until you know which part of it is which.
 *
 * There is no such thing here as centrifugal force. What is reported is the force that has to be supplied toward the
 * centre for the circle to happen at all — which is a real force with a real source, unlike the outward one a
 * rotating observer infers.
 */
export function circularMotion(input: {
  radius: number
  mass: number
  /** Give one of these; the other is worked out. */
  speed?: number
  angularVelocity?: number
  /** Rate of change of speed along the path. Zero for uniform circular motion. */
  tangentialAcceleration?: number
}): CircularMotion | KinematicsError {
  const { radius, mass } = input
  if (!Number.isFinite(radius) || radius <= 0) return fail('invalid-argument', 'The radius must be positive.')
  if (!Number.isFinite(mass) || mass <= 0) return fail('invalid-argument', 'The mass must be positive.')

  let speed: number
  let omega: number
  if (input.speed !== undefined) {
    if (!Number.isFinite(input.speed) || input.speed < 0) return fail('invalid-argument', 'The speed is zero or more.')
    speed = input.speed
    omega = speed / radius
  } else if (input.angularVelocity !== undefined) {
    if (!Number.isFinite(input.angularVelocity)) return fail('not-finite', 'The angular velocity must be finite.')
    omega = input.angularVelocity
    speed = Math.abs(omega) * radius
  } else {
    return fail('invalid-argument', 'Give either a speed or an angular velocity; the other follows from the radius.')
  }

  const tangential = input.tangentialAcceleration ?? 0
  if (!Number.isFinite(tangential)) return fail('not-finite', 'The tangential acceleration must be finite.')

  const centripetal = (speed * speed) / radius
  const total = Math.hypot(centripetal, tangential)

  const notes: string[] = [
    'The centripetal acceleration points at the centre and is what makes the path curve. It is there whether or not the speed is changing, and it never changes the speed — it is always at right angles to the motion.'
  ]
  if (tangential === 0) {
    notes.push('With no tangential acceleration the speed is steady, so the total acceleration is entirely centripetal and the period is constant.')
  } else {
    notes.push(
      `The tangential component of ${tangential} is the only part changing the speed. The total acceleration is ${total.toPrecision(4)}, at ${degrees(Math.atan2(tangential, centripetal)).toPrecision(3)}° from the inward radius — so neither component alone describes the motion.`
    )
    notes.push('With the speed changing, the period below is the one it would have if the speed held at this instant. It is not the time for the next lap.')
  }
  notes.push('The force reported is the one that must be supplied toward the centre for this circle to happen — by a string, by gravity, by friction. There is no outward force on the body.')

  return {
    radius,
    speed,
    angularVelocity: omega,
    period: omega === 0 ? Number.POSITIVE_INFINITY : (2 * Math.PI) / Math.abs(omega),
    frequency: omega === 0 ? 0 : Math.abs(omega) / (2 * Math.PI),
    centripetalAcceleration: centripetal,
    centripetalForce: mass * centripetal,
    tangentialAcceleration: tangential,
    totalAcceleration: total,
    accelerationAngle: degrees(Math.atan2(tangential, centripetal)),
    angularMomentum: mass * speed * radius,
    kineticEnergy: 0.5 * mass * speed * speed,
    notes
  }
}

export interface VerticalCirclePoint {
  /** Angle from the bottom of the loop, in degrees. */
  angle: number
  height: number
  /** Null where energy conservation says it never gets this high. */
  speed: number | null
  /** The force from the track or string. Null where it does not reach. */
  normalForce: number | null
  /** True when the track has to pull inward, which a string can do and a track on the inside cannot. */
  needsTension: boolean
}

export interface VerticalCircle {
  points: readonly VerticalCirclePoint[]
  /** How high it gets before stopping, when it does not make it round. */
  highestAngle: number
  completesLoop: boolean
  /** Where contact is first lost, for a body on the inside of a track. Null when it never is. */
  losesContactAt: number | null
  /** The speed at the bottom that just barely completes the loop. */
  minimumSpeedAtBottom: number
  why: string
  notes: readonly string[]
}

/**
 * A body on the inside of a vertical loop.
 *
 * Contact is lost where the track would have to pull inward to keep the body on the circle, which a track on the
 * inside cannot do. That is a different condition from running out of speed, and the two happen at different places:
 * a body can have plenty of speed left and still leave the track.
 *
 * Whether the body makes it round is decided by the calculation rather than by appearance — the classic answer, that
 * the speed at the top must be at least √(gr), falls out of the contact condition rather than being asserted.
 */
export function verticalCircle(input: {
  radius: number
  mass: number
  /** Speed at the lowest point. */
  speedAtBottom: number
  gravity: number
  /** True for a bead on a rod or a string that can pull — then contact is never lost. */
  canPull?: boolean
  steps?: number
}): VerticalCircle | KinematicsError {
  const { radius, mass, speedAtBottom, gravity } = input
  if (!Number.isFinite(radius) || radius <= 0) return fail('invalid-argument', 'The radius must be positive.')
  if (!Number.isFinite(mass) || mass <= 0) return fail('invalid-argument', 'The mass must be positive.')
  if (!Number.isFinite(gravity) || gravity <= 0) return fail('invalid-argument', 'Gravity must be positive for a vertical loop to mean anything.')
  if (!Number.isFinite(speedAtBottom) || speedAtBottom < 0) return fail('invalid-argument', 'The speed at the bottom is zero or more.')

  const canPull = input.canPull ?? false
  const steps = Math.min(721, Math.max(9, Math.round(input.steps ?? 181)))
  const points: VerticalCirclePoint[] = []
  let highestAngle = 0
  let losesContactAt: number | null = null

  for (let i = 0; i < steps; i += 1) {
    const angle = (360 * i) / (steps - 1)
    const theta = radians(angle)
    const height = radius * (1 - Math.cos(theta))
    // Energy: ½v² = ½v₀² − gh
    const squared = speedAtBottom * speedAtBottom - 2 * gravity * height
    if (squared < 0) {
      points.push({ angle, height, speed: null, normalForce: null, needsTension: false })
      continue
    }
    const speed = Math.sqrt(squared)
    if (angle <= 180) highestAngle = angle
    // Toward the centre: N + mg·cos(θ measured from the top) = mv²/r. At angle θ from the bottom the inward
    // direction makes the gravity component −mg·cos(θ).
    const normal = (mass * squared) / radius + mass * gravity * Math.cos(theta)
    const needsTension = normal < 0
    if (needsTension && losesContactAt === null && !canPull) losesContactAt = angle
    points.push({ angle, height, speed, normalForce: normal, needsTension })
  }

  const minimumSpeedAtBottom = Math.sqrt(5 * gravity * radius)
  const completesLoop = canPull
    ? speedAtBottom >= Math.sqrt(4 * gravity * radius)
    : speedAtBottom >= minimumSpeedAtBottom

  const notes: string[] = [
    'Speed around the loop comes from energy alone: whatever height it reaches, it has traded that much kinetic energy for potential. The track does no work, because its force is always at right angles to the motion.',
    canPull
      ? 'On a rod or in a groove the constraint can pull as well as push, so contact is never lost and the only question is whether there is enough energy to get round.'
      : 'On the inside of a track the surface can only push inward. Where the calculation says it would have to pull, the body leaves the track — which can happen with plenty of speed still left.'
  ]
  if (!canPull) {
    notes.push(`The speed needed at the bottom to get round is √(5gr) = ${minimumSpeedAtBottom.toPrecision(4)}. That follows from the contact condition rather than from the energy: it has to arrive at the top still fast enough for gravity alone to bend its path round the circle.`)
  }

  return {
    points,
    highestAngle,
    completesLoop,
    losesContactAt,
    minimumSpeedAtBottom,
    why: completesLoop
      ? `At ${speedAtBottom} from the bottom it gets round${losesContactAt === null ? '' : ` — though it leaves the track at ${losesContactAt.toPrecision(4)}° first`}.`
      : losesContactAt !== null
        ? `It leaves the track at ${losesContactAt.toPrecision(4)}° from the bottom. From there it is a projectile, not a body on a circle.`
        : `It runs out of speed at ${highestAngle.toPrecision(4)}° from the bottom and comes back down.`,
    notes
  }
}

export const KINEMATICS_ASSUMPTIONS: readonly string[] = Object.freeze([
  'The projectile formulas solve motion with no air resistance. They are not approximately right with drag; they answer a different question, which is why this engine refuses to quote them beside a dragged trajectory.',
  'Everything is a point mass. No spin, so no lift, no swerve and no rolling.',
  'Gravity is uniform and vertical. True over a field, not over a continent.',
  'Distance and displacement are reported separately wherever a body can turn round, because until it does they are the same number and afterwards they are not.',
  'A velocity is meaningless without the frame it is measured in, so every relative-motion result names the frames it combined.'
])
