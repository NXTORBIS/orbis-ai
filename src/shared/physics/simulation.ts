/**
 * The shape every physics simulation in Orbis has, and the solvers they all step with.
 *
 * ## One model, so a simulation is physics and nothing else
 *
 * A simulation here is three pure things: the state it starts in, a function that advances that state by a time
 * step, and the quantities worth reading off it. No canvas, no React, no timer. That matters for three reasons —
 * it can be tested against an exact answer, it can run on a worker thread, and the same simulation can be drawn
 * three different ways without being rewritten.
 *
 * ## The solver is a choice, and the choice is visible
 *
 * Euler is wrong in a way that looks right for about ten seconds and then adds energy for ever. RK4 is right
 * enough that an orbit closes. Both are here, the laboratory says which is running, and a simulation that
 * conserves something reports how much of it has drifted — because a drifting constant is how you find out your
 * step is too big, and no amount of prose teaches that as well as watching the number move.
 *
 * ## Nothing is animated that was not computed
 *
 * Every quantity on screen comes from the state the solver produced. There is no easing, no interpolation towards
 * a nicer-looking value, and no frame that was drawn without being stepped to.
 *
 * Pure. No clock, no randomness except where a simulation declares it and takes a seed.
 */

export interface SimulationError {
  error: 'input' | 'unstable' | 'too-big' | 'unknown'
  message: string
  fix: string
}

export const isSimulationError = (value: unknown): value is SimulationError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>) && 'fix' in (value as Record<string, unknown>)

export const fail = (error: SimulationError['error'], message: string, fix: string): SimulationError => ({ error, message, fix })

export const LIMITS = Object.freeze({ steps: 2_000_000, trail: 4_000, bodies: 400, grid: 160, frames: 20_000 })

/** What a simulation's controls look like. The laboratory builds its panel from this and nothing else. */
export interface Control {
  key: string
  label: string
  /** The unit, shown beside the number. Absent when the quantity has none. */
  unit?: string
  least: number
  most: number
  step: number
  initial: number
  /** One line on what it changes, and why the answer moves when it does. */
  about: string
}

/** A number worth reading off the state while it runs. */
export interface Readout {
  key: string
  label: string
  unit?: string
  /** How many figures to show. Three is usually right; a conserved quantity wants more, to show the drift. */
  figures?: number
}

export type Values = Readonly<Record<string, number>>

/**
 * A simulation.
 *
 * `state` is deliberately opaque: each simulation carries whatever it needs, and only `read` turns that into
 * numbers anybody else looks at.
 */
export interface Simulation<State = unknown> {
  id: string
  name: string
  /** Which section of the studio it belongs to. */
  section: string
  /** One sentence on what it shows. */
  about: string
  controls: readonly Control[]
  readouts: readonly Readout[]
  /** The state it begins in, from the control values. */
  start(values: Values): State
  /** Advance by `dt` seconds. Mutating the state it is given is allowed and expected — it is never shared. */
  step(state: State, dt: number, values: Values): void
  /** The numbers to show. Pure: it never changes the state. */
  read(state: State, values: Values): Readonly<Record<string, number>>
  /** What to draw, as shapes rather than canvas calls, so the same simulation can be drawn anywhere. */
  paint?(state: State, values: Values): Scene
  /** Anything this one refuses, said before somebody finds out by failing. */
  limits: readonly string[]
  /** A quantity that should not change, so the laboratory can show how far it has drifted. */
  conserves?: { key: string; label: string }
  /** How long a step it is happy with. A simulation that needs small steps says so rather than going wrong quietly. */
  suggestedStep?: number
}

// ---------------------------------------------------------------- what a simulation draws

export type Shape =
  | { kind: 'line'; from: readonly [number, number]; to: readonly [number, number]; width?: number; tone?: string; faint?: boolean }
  | { kind: 'path'; points: readonly number[]; width?: number; tone?: string; closed?: boolean; fill?: boolean; faint?: boolean }
  | { kind: 'circle'; at: readonly [number, number]; radius: number; tone?: string; fill?: boolean }
  | { kind: 'arrow'; from: readonly [number, number]; to: readonly [number, number]; tone?: string; head?: number }
  | { kind: 'text'; at: readonly [number, number]; text: string; tone?: string; size?: number; anchor?: 'start' | 'middle' | 'end' }
  | { kind: 'rect'; at: readonly [number, number]; width: number; height: number; tone?: string; fill?: boolean }
  | { kind: 'grid'; spacing: number; tone?: string }

export interface Scene {
  /** The world rectangle the shapes are in: [left, bottom, right, top]. The screen fits itself to this. */
  view: readonly [number, number, number, number]
  shapes: readonly Shape[]
  /** Said under the picture. Never decorative — it names what is being looked at. */
  about?: string
}

// ---------------------------------------------------------------- solvers

export type Solver = 'euler' | 'rk4' | 'verlet'

export const SOLVERS: readonly { id: Solver; name: string; about: string }[] = Object.freeze([
  {
    id: 'euler',
    name: 'Euler',
    about: 'The simplest possible step: move by the velocity you have now. It is wrong in a way that looks right briefly and then adds energy for ever — which is worth seeing once.'
  },
  {
    id: 'rk4',
    name: 'Runge-Kutta 4',
    about: 'Four samples of the derivative per step, weighted. The error falls with the fourth power of the step, so halving the step is sixteen times better.'
  },
  {
    id: 'verlet',
    name: 'Velocity Verlet',
    about: 'Not the most accurate, but it keeps energy almost exactly over a long run — which is why orbits and molecular dynamics use it rather than RK4.'
  }
])

/**
 * One step of a system written as `derivative(state) → rate of change`.
 *
 * For simulations that can be written in that form, which is most of mechanics. A simulation whose step is more
 * involved than this just writes its own `step` and ignores all of it.
 */
export function advance(
  values: number[],
  derivative: (values: readonly number[]) => number[],
  dt: number,
  solver: Solver
): number[] {
  if (solver === 'euler') {
    const rate = derivative(values)
    return values.map((one, at) => one + rate[at] * dt)
  }

  if (solver === 'verlet') {
    // Positions in the first half, velocities in the second. The pairing is the one assumption this makes, and a
    // simulation that does not hold its state that way should use RK4 instead.
    const half = values.length / 2
    const rate = derivative(values)
    const out = [...values]
    for (let one = 0; one < half; one += 1) {
      out[one] = values[one] + values[half + one] * dt + 0.5 * rate[half + one] * dt * dt
    }
    const nextRate = derivative(out)
    for (let one = 0; one < half; one += 1) {
      out[half + one] = values[half + one] + 0.5 * (rate[half + one] + nextRate[half + one]) * dt
    }
    return out
  }

  // RK4: four samples, weighted 1-2-2-1.
  const k1 = derivative(values)
  const k2 = derivative(values.map((one, at) => one + (k1[at] * dt) / 2))
  const k3 = derivative(values.map((one, at) => one + (k2[at] * dt) / 2))
  const k4 = derivative(values.map((one, at) => one + k3[at] * dt))
  return values.map((one, at) => one + ((k1[at] + 2 * k2[at] + 2 * k3[at] + k4[at]) * dt) / 6)
}

// ---------------------------------------------------------------- running one

export interface RunReport {
  /** The readouts at the end. */
  now: Readonly<Record<string, number>>
  /** Each readout over time, for the graphs. */
  history: Readonly<Record<string, readonly number[]>>
  /** The times those readings were taken at. */
  times: readonly number[]
  /** What to draw at the moment it stopped. */
  scene: Scene | null
  /** How far a conserved quantity has drifted, as a fraction of where it started. */
  drift: { label: string; from: number; to: number; fraction: number } | null
  steps: number
  seconds: number
  says: string
  notes: readonly string[]
}

/**
 * Run a simulation for a while and report what happened.
 *
 * `every` is how often a reading is kept — not how often a step is taken. Those are different, and conflating them
 * is how a simulation ends up accurate on screen and wrong underneath, or correct and unusably slow.
 */
export function run<State>(
  simulation: Simulation<State>,
  values: Values,
  options: { seconds: number; dt: number; every?: number } = { seconds: 10, dt: 0.01 }
): RunReport | SimulationError {
  const dt = options.dt
  if (!(dt > 0) || !Number.isFinite(dt)) return fail('input', 'The time step has to be a positive number.', 'Try 0.01 seconds.')
  if (!(options.seconds > 0)) return fail('input', 'There is no time to run for.', 'Give a number of seconds above zero.')

  const total = Math.ceil(options.seconds / dt)
  if (total > LIMITS.steps) {
    return fail('too-big', `${total.toLocaleString('en-GB')} steps is more than this runs.`, `Shorten the time or lengthen the step — at most ${LIMITS.steps.toLocaleString('en-GB')}.`)
  }

  const state = simulation.start(values)
  const keepEvery = Math.max(1, Math.floor((options.every ?? dt * 10) / dt))
  const history: Record<string, number[]> = {}
  const times: number[] = []
  for (const one of simulation.readouts) history[one.key] = []

  const first = simulation.read(state, values)
  const conserved = simulation.conserves ? first[simulation.conserves.key] : null

  let taken = 0
  for (let one = 0; one < total; one += 1) {
    simulation.step(state, dt, values)
    taken += 1

    if (one % keepEvery === 0 || one === total - 1) {
      const read = simulation.read(state, values)
      for (const two of simulation.readouts) history[two.key].push(read[two.key] ?? Number.NaN)
      times.push((one + 1) * dt)
      // A number that has stopped being a number means the step was too big, and saying so beats drawing nothing.
      if (Object.values(read).some((two) => !Number.isFinite(two))) {
        return fail(
          'unstable',
          `After ${((one + 1) * dt).toFixed(3)} seconds the numbers stopped being finite.`,
          'The time step is too big for this system. Halve it, or use RK4 rather than Euler.'
        )
      }
      if (times.length > LIMITS.frames) break
    }
  }

  const now = simulation.read(state, values)
  const drift =
    simulation.conserves && conserved !== null && conserved !== 0
      ? {
          label: simulation.conserves.label,
          from: conserved,
          to: now[simulation.conserves.key],
          fraction: (now[simulation.conserves.key] - conserved) / Math.abs(conserved)
        }
      : null

  return {
    now,
    history,
    times,
    scene: simulation.paint ? simulation.paint(state, values) : null,
    drift,
    steps: taken,
    seconds: taken * dt,
    says: `${taken.toLocaleString('en-GB')} steps of ${dt}s — ${(taken * dt).toFixed(2)} seconds simulated.`,
    notes: Object.freeze([
      ...(drift !== null
        ? [
            Math.abs(drift.fraction) < 0.001
              ? `${drift.label} held to within ${(Math.abs(drift.fraction) * 100).toFixed(4)}%, so the step is small enough.`
              : `${drift.label} drifted by ${(drift.fraction * 100).toFixed(2)}%. That is the solver losing or gaining it, not physics — halve the step and watch the drift fall.`
          ]
        : []),
      ...simulation.limits
    ])
  }
}

/** The control values a simulation starts with, so the laboratory need not know any of them. */
export const startingValues = (simulation: Simulation): Record<string, number> =>
  Object.fromEntries(simulation.controls.map((one) => [one.key, one.initial]))

/** A value put inside what the control allows, so a typed number cannot break a simulation. */
export function clamp(control: Control, value: number): number {
  if (!Number.isFinite(value)) return control.initial
  return Math.min(control.most, Math.max(control.least, value))
}

/** Every control value, checked and filled in. */
export function readValues(simulation: Simulation, given: Values): Record<string, number> {
  const out: Record<string, number> = {}
  for (const one of simulation.controls) out[one.key] = clamp(one, given[one.key] ?? one.initial)
  return out
}

// ---------------------------------------------------------------- shared physics

export const G = 6.6743e-11
export const C = 299_792_458
export const PLANCK = 6.62607015e-34
export const HBAR = PLANCK / (2 * Math.PI)
export const BOLTZMANN = 1.380649e-23
export const ELEMENTARY = 1.602176634e-19
export const ELECTRON_MASS = 9.1093837015e-31
export const PROTON_MASS = 1.67262192369e-27
export const AVOGADRO = 6.02214076e23
export const GAS_CONSTANT = 8.31446261815324
export const EPSILON0 = 8.8541878128e-12
export const MU0 = 1.25663706212e-6
export const COULOMB = 1 / (4 * Math.PI * EPSILON0)
export const STEFAN = 5.670374419e-8
export const EARTH_G = 9.80665

export const toRadians = (degrees: number): number => (degrees * Math.PI) / 180
export const toDegrees = (radians: number): number => (radians * 180) / Math.PI

/** A seeded generator, for the simulations that need randomness and must still be repeatable. */
export function randomFrom(seed: number): () => number {
  let state = seed | 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), state | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A trail of points, kept to a length so a long run cannot grow without bound. */
export function pushTrail(trail: number[], x: number, y: number, most: number = LIMITS.trail): void {
  trail.push(x, y)
  if (trail.length > most * 2) trail.splice(0, trail.length - most * 2)
}
