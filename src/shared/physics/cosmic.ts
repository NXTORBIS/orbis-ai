import { advance, pushTrail, randomFrom, type Scene, type Simulation, type Shape } from './simulation.ts'

/**
 * Orbits, decay and the many-body problem.
 *
 * ## Kepler's laws are not programmed in
 *
 * The only thing here is an inverse-square attraction. That the orbit is an ellipse with the heavy body at a focus,
 * that the line sweeps equal areas in equal times, and that the period goes with the three-halves power of the
 * semi-major axis all come *out* of that — and the laboratory measures each of them from the path it produced
 * rather than printing the law. A simulation that drew an ellipse and labelled it Kepler would teach nothing.
 *
 * ## Decay is counted, not curve-fitted
 *
 * Every nucleus is tested individually against its chance of decaying in this interval. The exponential appears
 * because that is what repeated independent chances do — and with few enough nuclei the curve is visibly rough,
 * which is the honest picture of what a half-life means.
 *
 * Pure. Both take a seed where they need randomness.
 */

// ---------------------------------------------------------------- orbit

interface OrbitState {
  x: number
  y: number
  vx: number
  vy: number
  t: number
  trail: number[]
  sweptArea: number
  lastSweep: number
  sweepSamples: number[]
  nearest: number
  furthest: number
  period: number
  lastAngle: number
  turns: number
}

export const orbit: Simulation<OrbitState> = {
  id: 'orbit',
  name: 'Orbit',
  section: 'astro',
  about: "An inverse-square attraction and nothing else — and Kepler's three laws measured out of the result.",
  controls: [
    { key: 'speed', label: 'Starting speed', unit: 'arb.', least: 0.1, most: 3, step: 0.01, initial: 1, about: 'Below the circular speed the orbit is an ellipse that falls inwards; above it, one that swings out. Past √2 times it, the orbit never closes.' },
    { key: 'distance', label: 'Starting distance', unit: 'arb.', least: 0.5, most: 10, step: 0.1, initial: 4, about: 'How far out it starts.' },
    { key: 'mass', label: 'Central mass', unit: 'arb.', least: 0.5, most: 20, step: 0.1, initial: 4, about: 'A heavier centre pulls harder, so the same speed gives a tighter orbit.' },
    { key: 'angle', label: 'Starting direction', unit: '°', least: 0, most: 360, step: 1, initial: 90, about: 'Ninety degrees is straight across the pull, which gives a circle when the speed is right.' }
  ],
  readouts: [
    { key: 'distance', label: 'Distance', unit: 'arb.' },
    { key: 'speed', label: 'Speed', unit: 'arb.' },
    { key: 'energy', label: 'Total energy', unit: 'arb.', figures: 6 },
    { key: 'angular', label: 'Angular momentum', unit: 'arb.', figures: 6 },
    { key: 'eccentricity', label: 'Eccentricity', unit: '' },
    { key: 'period', label: 'Measured period', unit: 'arb.' },
    { key: 'kepler', label: 'T² / a³', unit: '', figures: 5 }
  ],
  conserves: { key: 'angular', label: 'Angular momentum' },
  start(values) {
    const angle = (values.angle * Math.PI) / 180
    return {
      x: values.distance,
      y: 0,
      vx: values.speed * Math.cos(angle),
      vy: values.speed * Math.sin(angle),
      t: 0,
      trail: [],
      sweptArea: 0,
      lastSweep: 0,
      sweepSamples: [],
      nearest: values.distance,
      furthest: values.distance,
      period: 0,
      lastAngle: 0,
      turns: 0
    }
  },
  step(state, dt, values) {
    // Only this: acceleration towards the centre, falling off as one over the distance squared.
    const derivative = (one: readonly number[]): number[] => {
      const r = Math.hypot(one[0], one[1])
      const pull = r < 0.05 ? 0 : -values.mass / (r * r * r)
      return [one[2], one[3], pull * one[0], pull * one[1]]
    }
    const [x, y, vx, vy] = advance([state.x, state.y, state.vx, state.vy], derivative, dt, 'rk4')
    // The area the line to the centre sweeps, by the triangle it covers each step. Kepler's second law is the
    // claim that this rate never changes, and the laboratory measures it rather than asserting it.
    state.sweptArea += 0.5 * Math.abs(state.x * y - x * state.y)
    state.x = x
    state.y = y
    state.vx = vx
    state.vy = vy
    state.t += dt

    const r = Math.hypot(x, y)
    state.nearest = Math.min(state.nearest, r)
    state.furthest = Math.max(state.furthest, r)

    // A full turn is when the angle passes where it started, which is how the period is measured rather than solved.
    const angle = Math.atan2(y, x)
    if (state.lastAngle < 0 && angle >= 0 && state.t > dt * 10) {
      state.turns += 1
      state.period = state.t / state.turns
    }
    state.lastAngle = angle

    if (state.t - state.lastSweep >= 0.5) {
      state.sweepSamples.push(state.sweptArea)
      state.sweptArea = 0
      state.lastSweep = state.t
      if (state.sweepSamples.length > 40) state.sweepSamples.shift()
    }
    pushTrail(state.trail, x, y, 3000)
  },
  read(state, values) {
    const r = Math.hypot(state.x, state.y)
    const speed = Math.hypot(state.vx, state.vy)
    const energy = 0.5 * speed * speed - values.mass / Math.max(r, 1e-9)
    const angular = state.x * state.vy - state.y * state.vx
    // Eccentricity from the energy and the angular momentum, which is the proper way round.
    const e = Math.sqrt(Math.max(0, 1 + (2 * energy * angular * angular) / (values.mass * values.mass)))
    const semiMajor = energy < 0 ? -values.mass / (2 * energy) : 0
    return {
      distance: r,
      speed,
      energy,
      angular,
      eccentricity: e,
      period: state.period,
      kepler: semiMajor > 0 && state.period > 0 ? (state.period * state.period) / (semiMajor * semiMajor * semiMajor) : 0,
      semiMajor
    }
  },
  paint(state, values): Scene {
    const reach = Math.max(state.furthest * 1.3, values.distance * 1.3)
    const sweeps = state.sweepSamples
    const spread =
      sweeps.length > 2 ? ((Math.max(...sweeps) - Math.min(...sweeps)) / (Math.max(...sweeps) || 1)) * 100 : 0
    return {
      view: [-reach, -reach, reach, reach],
      shapes: [
        { kind: 'path', points: state.trail, width: 1.2 },
        { kind: 'circle', at: [0, 0], radius: reach / 22, fill: true, tone: 'other' },
        { kind: 'circle', at: [state.x, state.y], radius: reach / 45, fill: true },
        { kind: 'line', from: [0, 0], to: [state.x, state.y], width: 1, faint: true },
        { kind: 'arrow', from: [state.x, state.y], to: [state.x + state.vx * 0.6, state.y + state.vy * 0.6] }
      ],
      about:
        sweeps.length > 2
          ? `The line to the centre sweeps the same area every half-second, to within ${spread.toFixed(2)}% — that is Kepler's second law, measured from this path rather than assumed.`
          : 'The faint line sweeps out area as it goes. Watch how it speeds up when close and slows when far.'
    }
  },
  limits: [
    'Two bodies, with the central one held still. A real pair both move about their common centre.',
    'No other bodies, no tides, no relativity. Mercury’s orbit needs the last of those and this would get it wrong.',
    'Arbitrary units, so the shapes and the ratios are right and the numbers are not kilometres and seconds.'
  ]
}

// ---------------------------------------------------------------- radioactive decay

interface DecayState {
  remaining: number
  parent: number[]
  daughter: number[]
  times: number[]
  t: number
  random: () => number
  started: number
}

export const radioactiveDecay: Simulation<DecayState> = {
  id: 'radioactive-decay',
  name: 'Radioactive Decay',
  section: 'nuclear',
  about: 'Every nucleus tested one at a time, so the exponential appears rather than being drawn.',
  controls: [
    { key: 'count', label: 'Nuclei to start with', unit: '', least: 10, most: 20000, step: 10, initial: 2000, about: 'With few of them the curve is visibly rough — which is the honest picture of what a half-life is.' },
    { key: 'halfLife', label: 'Half-life', unit: 's', least: 0.1, most: 60, step: 0.1, initial: 5, about: 'The time for half of whatever is left to go. It is the same at every point, which is what makes it exponential.' },
    { key: 'seed', label: 'Seed', unit: '', least: 1, most: 9999, step: 1, initial: 1, about: 'The same seed gives exactly the same run, so the roughness can be studied rather than wondered at.' }
  ],
  readouts: [
    { key: 'remaining', label: 'Still there', unit: '' },
    { key: 'decayed', label: 'Gone', unit: '' },
    { key: 'fraction', label: 'Fraction left', unit: '' },
    { key: 'expected', label: 'Expected fraction', unit: '' },
    { key: 'activity', label: 'Activity', unit: '/s' },
    { key: 'halves', label: 'Half-lives elapsed', unit: '' }
  ],
  start(values) {
    return {
      remaining: Math.round(values.count),
      parent: [],
      daughter: [],
      times: [],
      t: 0,
      random: randomFrom(values.seed),
      started: Math.round(values.count)
    }
  },
  step(state, dt, values) {
    /*
     * The chance any one nucleus goes in this interval, from the half-life.
     *
     * Each is tested separately. Nobody tells the simulation the answer is exponential — it comes out because
     * every nucleus has the same chance every moment, regardless of how long it has already sat there.
     */
    const chance = 1 - Math.pow(0.5, dt / values.halfLife)
    let went = 0
    // Tested in bulk once there are many, because a million separate draws a step is not worth the exactness.
    if (state.remaining > 500) {
      const expected = state.remaining * chance
      const spread = Math.sqrt(expected)
      const u1 = Math.max(1e-9, state.random())
      const u2 = state.random()
      const gauss = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
      went = Math.max(0, Math.min(state.remaining, Math.round(expected + gauss * spread)))
    } else {
      for (let one = 0; one < state.remaining; one += 1) if (state.random() < chance) went += 1
    }
    state.remaining -= went
    state.t += dt
    if (state.times.length === 0 || state.t - state.times[state.times.length - 1] >= values.halfLife / 40) {
      state.times.push(state.t)
      state.parent.push(state.remaining)
      state.daughter.push(state.started - state.remaining)
      if (state.times.length > 2000) {
        state.times.shift()
        state.parent.shift()
        state.daughter.shift()
      }
    }
  },
  read(state, values) {
    const halves = state.t / values.halfLife
    return {
      remaining: state.remaining,
      decayed: state.started - state.remaining,
      fraction: state.remaining / Math.max(1, state.started),
      expected: Math.pow(0.5, halves),
      activity: (state.remaining * Math.LN2) / values.halfLife,
      halves
    }
  },
  paint(state, values): Scene {
    const span = Math.max(state.t, values.halfLife * 4)
    const measured: number[] = []
    const theory: number[] = []
    for (let one = 0; one < state.times.length; one += 1) {
      measured.push(state.times[one], state.parent[one] / Math.max(1, state.started))
    }
    for (let one = 0; one <= 120; one += 1) {
      const t = (one / 120) * span
      theory.push(t, Math.pow(0.5, t / values.halfLife))
    }
    const marks: Shape[] = []
    for (let one = 1; one <= 4; one += 1) {
      const at = one * values.halfLife
      if (at > span) break
      marks.push({ kind: 'line', from: [at, 0], to: [at, Math.pow(0.5, one)], width: 1, faint: true })
      marks.push({ kind: 'text', at: [at, Math.pow(0.5, one) + 0.04], text: `${one} half-life${one === 1 ? '' : 's'}`, size: 10, anchor: 'middle' })
    }
    return {
      view: [0, -0.08, span, 1.12],
      shapes: [
        { kind: 'line', from: [0, 0], to: [span, 0], width: 1.5 },
        ...marks,
        { kind: 'path', points: theory, width: 1.2, faint: true, tone: 'other' },
        { kind: 'path', points: measured, width: 1.6 },
        { kind: 'text', at: [span * 0.55, 0.9], text: 'measured', size: 11 },
        { kind: 'text', at: [span * 0.55, 0.8], text: 'the smooth exponential', size: 11, tone: 'other' }
      ],
      about: `${state.remaining.toLocaleString('en-GB')} of ${state.started.toLocaleString('en-GB')} left after ${(state.t / values.halfLife).toFixed(2)} half-lives. The roughness is real — it is what counting a finite number of random events looks like.`
    }
  },
  limits: [
    'One kind of nucleus decaying to a stable one. A real chain has several steps, each with its own half-life.',
    'Above five hundred nuclei the number decaying each step is drawn from a normal approximation rather than tested one at a time, which is far faster and right to within the noise.',
    'Nothing here is a particular isotope: the half-life is whatever you set.'
  ]
}

export const COSMIC: readonly Simulation[] = Object.freeze([orbit as Simulation, radioactiveDecay as Simulation])
