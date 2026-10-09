import { G, pushTrail, randomFrom, type Scene, type Shape, type Simulation } from './simulation.ts'

/**
 * Gravity with more than two bodies, nuclei that come apart, and the numerical methods underneath all of it.
 *
 * ## Three bodies have no solution, so this integrates
 *
 * Two bodies have a closed form and always will. Three do not, and that is a theorem rather than a gap in
 * anybody's algebra. So this steps them, and the energy drift on screen is how far to trust what it shows — a
 * chaotic system amplifies the step error exponentially, and after long enough the path on screen is a path the
 * solver invented. Saying so is the only honest way to show chaos.
 *
 * ## The decay chain is counted nucleus by nucleus
 *
 * The exponential is easy to draw. Counting individual nuclei instead is what makes the daughter build up and
 * fall away on its own, and what makes the statistics get noisy when few are left — which is the real behaviour
 * of a real sample and is invisible in a smooth curve.
 */

// ——— Many bodies under gravity ——————————————————————————————————————————

interface BodiesState {
  x: number[]
  y: number[]
  vx: number[]
  vy: number[]
  mass: number[]
  trails: number[][]
  count: number
  t: number
  energy: number
  startEnergy: number
  closest: number
  ejected: number
}

function accelerations(state: BodiesState, soften: number): [number[], number[]] {
  const n = state.count
  const ax = new Array<number>(n).fill(0)
  const ay = new Array<number>(n).fill(0)
  for (let a = 0; a < n; a += 1) {
    for (let b = a + 1; b < n; b += 1) {
      const dx = state.x[b] - state.x[a]
      const dy = state.y[b] - state.y[a]
      // Softened, or a close pass gives an infinite force and the whole run is destroyed in one step.
      const r2 = dx * dx + dy * dy + soften * soften
      const r = Math.sqrt(r2)
      const pull = G / (r2 * r)
      ax[a] += pull * state.mass[b] * dx
      ay[a] += pull * state.mass[b] * dy
      ax[b] -= pull * state.mass[a] * dx
      ay[b] -= pull * state.mass[a] * dy
    }
  }
  return [ax, ay]
}

export const nBody: Simulation<BodiesState> = {
  id: 'n-body',
  name: 'Many bodies under gravity',
  section: 'astro',
  about: 'Three bodies or thirty, stepped — with the energy drift shown, because that is how far the path can be believed.',
  controls: [
    { key: 'bodies', label: 'How many', unit: '', least: 2, most: 60, step: 1, initial: 3, about: 'Two is solvable for ever. Three is not, and that is a theorem rather than a gap in the algebra.' },
    { key: 'arrangement', label: 'Start as', unit: '', least: 0, most: 3, step: 1, initial: 0, about: 'A figure-of-eight, a sun with planets, a cluster, or a near-miss pair. The figure-of-eight is a real exact solution and drifts away from it visibly.' },
    { key: 'mass', label: 'Body mass', unit: '10²⁴ kg', least: 0.1, most: 2000, step: 0.1, initial: 100, about: 'Heavier means faster and tighter.' },
    { key: 'scale', label: 'Starting separation', unit: 'Gm', least: 0.01, most: 100, step: 0.01, initial: 1, about: 'How far apart they begin.' },
    { key: 'soften', label: 'Softening', unit: 'Mm', least: 0.1, most: 10000, step: 0.1, initial: 100, about: 'Stops a close pass giving an infinite force. It is a lie, but a small and stated one — without it one bad step destroys the run.' },
    { key: 'seed', label: 'Seed', unit: '', least: 1, most: 9999, step: 1, initial: 1, about: 'The same seed gives the same arrangement exactly.' },
    { key: 'speedUp', label: 'Sped up by', unit: '×', least: 1e3, most: 1e8, step: 1e3, initial: 2e5, about: 'Orbits take months. One second here is this many seconds of real time.' }
  ],
  readouts: [
    { key: 'energy', label: 'Total energy', unit: 'PJ', figures: 8 },
    { key: 'drift', label: 'Energy drift', unit: '', figures: 6 },
    { key: 'closest', label: 'Closest approach', unit: 'Gm', figures: 4 },
    { key: 'ejected', label: 'Thrown out', unit: '' },
    { key: 'spread', label: 'How spread out', unit: 'Gm', figures: 4 },
    { key: 'days', label: 'Real time gone by', unit: 'days', figures: 4 },
    { key: 'trustworthy', label: 'Still trustworthy', unit: '' }
  ],
  conserves: { key: 'energy', label: 'Total energy' },
  suggestedStep: 0.002,
  start(values) {
    const n = Math.max(2, Math.round(values.bodies))
    const random = randomFrom(values.seed)
    const scale = values.scale * 1e9
    const m = values.mass * 1e24
    const x: number[] = []
    const y: number[] = []
    const vx: number[] = []
    const vy: number[] = []
    const mass: number[] = []
    const arrangement = Math.round(values.arrangement)

    if (arrangement === 0 && n >= 3) {
      // Chenciner and Montgomery's figure-of-eight: three equal masses chasing each other round one curve.
      // An exact solution, and watching a stepped one leave it is the clearest demonstration of drift there is.
      const unit = Math.sqrt((G * m) / scale)
      const positions = [[0.97000436, -0.24308753], [-0.97000436, 0.24308753], [0, 0]]
      const velocities = [[0.4662036850, 0.4323657300], [0.4662036850, 0.4323657300], [-0.93240737, -0.86473146]]
      for (let one = 0; one < 3; one += 1) {
        x.push(positions[one][0] * scale)
        y.push(positions[one][1] * scale)
        vx.push(velocities[one][0] * unit)
        vy.push(velocities[one][1] * unit)
        mass.push(m)
      }
      for (let one = 3; one < n; one += 1) {
        const angle = random() * 2 * Math.PI
        const r = scale * (2 + random() * 2)
        x.push(Math.cos(angle) * r)
        y.push(Math.sin(angle) * r)
        const speed = Math.sqrt((G * 3 * m) / r) * 0.9
        vx.push(-Math.sin(angle) * speed)
        vy.push(Math.cos(angle) * speed)
        mass.push(m * 0.01)
      }
    } else if (arrangement === 1) {
      // A heavy centre with light planets on circular orbits.
      x.push(0); y.push(0); vx.push(0); vy.push(0); mass.push(m * 300)
      for (let one = 1; one < n; one += 1) {
        const r = scale * (0.5 + one * 0.6)
        const angle = random() * 2 * Math.PI
        x.push(Math.cos(angle) * r)
        y.push(Math.sin(angle) * r)
        const speed = Math.sqrt((G * m * 300) / r)
        vx.push(-Math.sin(angle) * speed)
        vy.push(Math.cos(angle) * speed)
        mass.push(m * 0.001)
      }
    } else if (arrangement === 2) {
      // A cluster with just enough motion to hold together, roughly.
      for (let one = 0; one < n; one += 1) {
        const angle = random() * 2 * Math.PI
        const r = scale * Math.sqrt(random()) * 2
        x.push(Math.cos(angle) * r)
        y.push(Math.sin(angle) * r)
        const speed = Math.sqrt((G * m * n) / (scale * 3)) * (random() * 0.8)
        const direction = random() * 2 * Math.PI
        vx.push(Math.cos(direction) * speed)
        vy.push(Math.sin(direction) * speed)
        mass.push(m)
      }
    } else {
      // Two bodies passing close, with the rest watching. The slingshot is visible.
      for (let one = 0; one < n; one += 1) {
        const side = one % 2 === 0 ? -1 : 1
        x.push(side * scale * (1 + Math.floor(one / 2) * 0.4))
        y.push(side * scale * 0.15 * (1 + Math.floor(one / 2)))
        const speed = Math.sqrt((G * m) / scale) * 0.7
        vx.push(-side * speed * 0.2)
        vy.push(side * speed)
        mass.push(m)
      }
    }

    const state: BodiesState = {
      x, y, vx, vy, mass,
      trails: x.map((one, at) => [one, y[at]]),
      count: n, t: 0, energy: 0, startEnergy: 0,
      closest: Number.POSITIVE_INFINITY, ejected: 0
    }
    state.startEnergy = totalEnergy(state, values.soften * 1e6)
    state.energy = state.startEnergy
    return state
  },
  step(state, watched, values) {
    const dt = watched * values.speedUp
    const soften = values.soften * 1e6
    const n = state.count

    // Velocity Verlet: the force is evaluated once per step and the energy error does not grow without bound the
    // way a plain Euler step's does. For gravity this matters enormously over many orbits.
    const [ax1, ay1] = accelerations(state, soften)
    for (let one = 0; one < n; one += 1) {
      state.x[one] += state.vx[one] * dt + 0.5 * ax1[one] * dt * dt
      state.y[one] += state.vy[one] * dt + 0.5 * ay1[one] * dt * dt
    }
    const [ax2, ay2] = accelerations(state, soften)
    for (let one = 0; one < n; one += 1) {
      state.vx[one] += 0.5 * (ax1[one] + ax2[one]) * dt
      state.vy[one] += 0.5 * (ay1[one] + ay2[one]) * dt
      pushTrail(state.trails[one], state.x[one], state.y[one], 1200)
    }
    state.t += dt
    state.energy = totalEnergy(state, soften)

    let closest = Number.POSITIVE_INFINITY
    for (let a = 0; a < n; a += 1) {
      for (let b = a + 1; b < n; b += 1) {
        closest = Math.min(closest, Math.hypot(state.x[b] - state.x[a], state.y[b] - state.y[a]))
      }
    }
    if (closest < state.closest) state.closest = closest

    // Anything far out and moving outwards faster than it can be held is gone for good.
    let gone = 0
    const scale = values.scale * 1e9
    for (let one = 0; one < n; one += 1) {
      const r = Math.hypot(state.x[one], state.y[one])
      if (r > scale * 30) gone += 1
    }
    state.ejected = gone
  },
  read(state) {
    let spread = 0
    for (let one = 0; one < state.count; one += 1) spread = Math.max(spread, Math.hypot(state.x[one], state.y[one]))
    const drift = state.startEnergy !== 0 ? (state.energy - state.startEnergy) / Math.abs(state.startEnergy) : 0
    return {
      energy: state.energy / 1e15,
      drift,
      closest: state.closest / 1e9,
      ejected: state.ejected,
      spread: spread / 1e9,
      days: state.t / 86400,
      // Past a per cent of energy drift the path on screen is the solver's, not gravity's.
      trustworthy: Math.abs(drift) < 0.01 ? 1 : 0
    }
  },
  paint(state, values): Scene {
    let span = 0
    for (let one = 0; one < state.count; one += 1) span = Math.max(span, Math.abs(state.x[one]), Math.abs(state.y[one]))
    span = Math.max(span * 1.25, values.scale * 1e9)
    const biggest = Math.max(...state.mass)
    const shapes: Shape[] = []
    for (let one = 0; one < state.count; one += 1) {
      shapes.push({ kind: 'path', points: [...state.trails[one]], width: 1, faint: true })
    }
    for (let one = 0; one < state.count; one += 1) {
      // Radius by the cube root of the mass, so a star does not swamp its planets.
      const size = span * 0.012 * (0.6 + Math.cbrt(state.mass[one] / biggest))
      shapes.push({ kind: 'circle', at: [state.x[one], state.y[one]], radius: size, fill: true })
    }
    const drift = state.startEnergy !== 0 ? (state.energy - state.startEnergy) / Math.abs(state.startEnergy) : 0
    return {
      view: [-span, -span, 2 * span, 2 * span],
      shapes,
      about:
        Math.abs(drift) > 0.01
          ? `The energy has drifted ${(drift * 100).toFixed(2)}%. Past about a per cent the path on screen is the solver's invention rather than gravity's — shorten the step.`
          : Math.round(values.arrangement) === 0
            ? `The figure-of-eight is an exact solution. Watch how long this one stays on it: that is the step error, made visible.`
            : `Energy held to ${(Math.abs(drift) * 100).toExponential(1)}%, so what is on screen is gravity rather than arithmetic.`
    }
  },
  limits: [
    'Two dimensions. Real systems are three-dimensional, and a third dimension changes how long a configuration survives.',
    'Point masses, so nothing can collide or merge — they pass through each other instead, softened.',
    'The softening is a deliberate lie about gravity at very short range. Without it a single close pass ruins the whole run, and with it close passes are gentler than they should be.',
    'Newtonian. Nothing here is relativistic, so the precession of a tight orbit comes out wrong.',
    'Three or more bodies are genuinely chaotic. Two runs that differ in the last decimal place end up somewhere completely different, and no step is small enough to fix that.'
  ]
}

function totalEnergy(state: BodiesState, soften: number): number {
  let total = 0
  for (let one = 0; one < state.count; one += 1) {
    total += 0.5 * state.mass[one] * (state.vx[one] ** 2 + state.vy[one] ** 2)
  }
  for (let a = 0; a < state.count; a += 1) {
    for (let b = a + 1; b < state.count; b += 1) {
      const r = Math.sqrt((state.x[b] - state.x[a]) ** 2 + (state.y[b] - state.y[a]) ** 2 + soften * soften)
      total -= (G * state.mass[a] * state.mass[b]) / r
    }
  }
  return total
}

// ——— A decay chain, counted ————————————————————————————————————————————————

interface ChainState {
  counts: number[]
  t: number
  random: () => number
  decayed: number[]
}

export const decayChain: Simulation<ChainState> = {
  id: 'decay-chain',
  name: 'A decay chain',
  section: 'nuclear',
  about: 'Parent to daughter to stable, counted nucleus by nucleus — so the daughter builds up and falls away on its own.',
  controls: [
    { key: 'parents', label: 'Parent nuclei', unit: '', least: 100, most: 100000, step: 100, initial: 20000, about: 'How many to start with. Few enough and the curve goes visibly noisy at the end, which is what a real weak source does.' },
    { key: 'parentHalfLife', label: 'Parent half-life', unit: 's', least: 0.1, most: 60, step: 0.1, initial: 5, about: 'How long until half the parents are gone.' },
    { key: 'daughterHalfLife', label: 'Daughter half-life', unit: 's', least: 0.1, most: 60, step: 0.1, initial: 15, about: 'When the daughter outlives the parent it piles up. When it does not, it never gets the chance — secular equilibrium.' },
    { key: 'seed', label: 'Seed', unit: '', least: 1, most: 9999, step: 1, initial: 1, about: 'Decay is random. The same seed gives the same run exactly.' }
  ],
  readouts: [
    { key: 'parents', label: 'Parents left', unit: '' },
    { key: 'daughters', label: 'Daughters', unit: '' },
    { key: 'stable', label: 'Stable', unit: '' },
    { key: 'activity', label: 'Total activity', unit: 'Bq', figures: 4 },
    { key: 'expectedParents', label: 'Parents expected', unit: '', figures: 4 },
    { key: 'peakDaughterAt', label: 'Daughter peaks at', unit: 's', figures: 4 },
    { key: 'time', label: 'Time', unit: 's' }
  ],
  suggestedStep: 0.002,
  start(values) {
    return {
      counts: [Math.round(values.parents), 0, 0],
      t: 0,
      random: randomFrom(values.seed),
      decayed: [0, 0]
    }
  },
  step(state, dt, values) {
    state.t += dt
    const lambdaParent = Math.LN2 / values.parentHalfLife
    const lambdaDaughter = Math.LN2 / values.daughterHalfLife

    // How many of `count` decay in dt. Each nucleus is independent with probability 1 − e^(−λ·dt), so the count
    // is binomial — and because that probability is tiny, Poisson is the same distribution and far cheaper.
    //
    // This was a normal approximation sampled through Box-Muller, and it decayed about 19% too fast at every
    // seed. A bias that consistent is not noise: the clamping and rounding around a continuous approximation
    // skewed a distribution whose whole mass sits within a few counts of zero. Sampling the real distribution
    // removes the question rather than tuning the fudge.
    const decay = (count: number, lambda: number): number => {
      if (count <= 0) return 0
      const chance = 1 - Math.exp(-lambda * dt)
      const mean = count * chance

      // Knuth: multiply uniforms until the product falls below e^(−mean). Exact, and cheap while the mean is
      // small, which it always is for one step of a decay.
      if (mean < 30) {
        const limit = Math.exp(-mean)
        let gone = 0
        let product = state.random()
        while (product > limit && gone < count) {
          gone += 1
          product *= state.random()
        }
        return Math.min(count, gone)
      }

      // A large mean only happens with a very short half-life against a long step. Then the normal really is
      // the right approximation, because the distribution is no longer bunched against zero.
      const spread = Math.sqrt(mean * (1 - chance))
      const u = Math.max(1e-12, state.random())
      const v = state.random()
      const normal = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
      return Math.max(0, Math.min(count, Math.round(mean + spread * normal)))
    }

    const fromParent = decay(state.counts[0], lambdaParent)
    const fromDaughter = decay(state.counts[1], lambdaDaughter)
    state.counts[0] -= fromParent
    state.counts[1] += fromParent - fromDaughter
    state.counts[2] += fromDaughter
    state.decayed[0] += fromParent
    state.decayed[1] += fromDaughter
  },
  read(state, values) {
    const lambdaParent = Math.LN2 / values.parentHalfLife
    const lambdaDaughter = Math.LN2 / values.daughterHalfLife
    // The Bateman equation gives the moment the daughter is at its most, exactly.
    const peak =
      Math.abs(lambdaParent - lambdaDaughter) < 1e-9
        ? 1 / lambdaParent
        : Math.log(lambdaDaughter / lambdaParent) / (lambdaDaughter - lambdaParent)
    return {
      parents: state.counts[0],
      daughters: state.counts[1],
      stable: state.counts[2],
      activity: lambdaParent * state.counts[0] + lambdaDaughter * state.counts[1],
      expectedParents: values.parents * Math.exp(-lambdaParent * state.t),
      peakDaughterAt: peak,
      time: state.t
    }
  },
  paint(state, values): Scene {
    const total = values.parents
    const shapes: Shape[] = []
    const labels = ['parent', 'daughter', 'stable']
    for (let one = 0; one < 3; one += 1) {
      const fraction = state.counts[one] / total
      shapes.push({ kind: 'rect', at: [one, fraction / 2], width: 0.55, height: Math.max(0.002, fraction), fill: true, tone: one === 1 ? 'other' : undefined })
      shapes.push({ kind: 'text', at: [one, -0.07], text: labels[one], size: 11, anchor: 'middle' })
      shapes.push({ kind: 'text', at: [one, fraction + 0.05], text: state.counts[one].toLocaleString('en-GB'), size: 10, anchor: 'middle' })
    }
    // What the smooth exponential would say, so the noise in the counted version is visible as noise.
    const lambdaParent = Math.LN2 / values.parentHalfLife
    const expected = Math.exp(-lambdaParent * state.t)
    shapes.push({ kind: 'line', from: [-0.4, expected], to: [0.4, expected], width: 1.5, faint: true })
    shapes.push({ kind: 'text', at: [-0.45, expected], text: 'expected', size: 9, anchor: 'end', tone: 'faint' })

    return {
      view: [-1.2, -0.2, 4.4, 1.45],
      shapes,
      about:
        values.daughterHalfLife > values.parentHalfLife
          ? 'The daughter outlives the parent, so it piles up before it can clear — that is why the middle bar rises before it falls.'
          : 'The daughter decays faster than it is made, so it never gets the chance to build up. It sits at whatever the parent is feeding it.'
    }
  },
  limits: [
    'Three stages only: parent, daughter, stable. Real chains such as uranium to lead run through fourteen.',
    'One decay mode each. Many real nuclei branch, going two ways with fixed probabilities.',
    'The number decaying each step is drawn from the Poisson distribution, which is exactly the binomial when the chance per step is this small. With few nuclei left the counts go genuinely noisy, and that noise is real — a weak source behaves exactly like that.',
    'Nothing about what comes out: no alpha, beta or gamma energies, and no shielding.'
  ]
}

// ——— The methods themselves ————————————————————————————————————————————————

interface MethodState {
  t: number
  euler: number[]
  rk4: number[]
  verlet: number[]
  exact: number[]
  errors: [number, number, number]
}

export const solverComparison: Simulation<MethodState> = {
  id: 'solver-comparison',
  name: 'How solvers go wrong',
  section: 'comp',
  about: 'The same problem by three methods against the exact answer — so the difference between first and fourth order is a picture rather than a claim.',
  controls: [
    { key: 'step', label: 'Time step', unit: 's', least: 0.001, most: 0.5, step: 0.001, initial: 0.1, about: 'The one thing that matters. Halve it and Euler halves its error while Runge-Kutta divides its own by sixteen.' },
    { key: 'periods', label: 'Oscillations to run', unit: '', least: 1, most: 60, step: 1, initial: 10, about: 'Errors accumulate. A method that looks fine for one period can be unrecognisable after fifty.' },
    { key: 'showExact', label: 'Show the exact answer', unit: '', least: 0, most: 1, step: 1, initial: 1, about: 'Simple harmonic motion has one, which is what makes it the right problem for this.' }
  ],
  readouts: [
    { key: 'eulerError', label: 'Euler error', unit: '', figures: 6 },
    { key: 'rk4Error', label: 'Runge-Kutta error', unit: '', figures: 6 },
    { key: 'verletError', label: 'Verlet error', unit: '', figures: 6 },
    { key: 'eulerEnergy', label: 'Euler energy', unit: '', figures: 6 },
    { key: 'verletEnergy', label: 'Verlet energy', unit: '', figures: 6 },
    { key: 'steps', label: 'Steps taken', unit: '' }
  ],
  suggestedStep: 0.02,
  start() {
    return { t: 0, euler: [], rk4: [], verlet: [], exact: [], errors: [0, 0, 0] }
  },
  step(state, dt, values) {
    state.t += dt
    // x'' = −x, started at x = 1 and at rest. The answer is cos(t), for ever and exactly.
    const h = values.step
    const until = values.periods * 2 * Math.PI
    const count = Math.min(20000, Math.max(2, Math.round(until / h)))

    const euler: number[] = []
    const rk4: number[] = []
    const verlet: number[] = []
    const exact: number[] = []

    let ex = 1
    let ev = 0
    let rx = 1
    let rv = 0
    let vx = 1
    let vv = 0

    for (let one = 0; one <= count; one += 1) {
      const t = one * h
      euler.push(t, ex)
      rk4.push(t, rx)
      verlet.push(t, vx)
      exact.push(t, Math.cos(t))

      // Euler: one slope, taken at the start. First order, and it gains energy every single step.
      const nextEx = ex + h * ev
      ev = ev - h * ex
      ex = nextEx

      // Runge-Kutta four: four slopes, weighted. Fourth order.
      const k1x = rv
      const k1v = -rx
      const k2x = rv + (h / 2) * k1v
      const k2v = -(rx + (h / 2) * k1x)
      const k3x = rv + (h / 2) * k2v
      const k3v = -(rx + (h / 2) * k2x)
      const k4x = rv + h * k3v
      const k4v = -(rx + h * k3x)
      rx += (h / 6) * (k1x + 2 * k2x + 2 * k3x + k4x)
      rv += (h / 6) * (k1v + 2 * k2v + 2 * k3v + k4v)

      // Verlet: only second order, and yet its energy does not drift at all. That is the whole point of it.
      const half = vv + (h / 2) * -vx
      vx += h * half
      vv = half + (h / 2) * -vx
    }

    state.euler = euler
    state.rk4 = rk4
    state.verlet = verlet
    state.exact = exact
    state.errors = [
      Math.abs(euler[euler.length - 1] - exact[exact.length - 1]),
      Math.abs(rk4[rk4.length - 1] - exact[exact.length - 1]),
      Math.abs(verlet[verlet.length - 1] - exact[exact.length - 1])
    ]
  },
  read(state, values) {
    const last = (which: number[]): number => which[which.length - 1] ?? 0
    // Energy for x'' = −x is ½(v² + x²), which starts at exactly ½.
    const steps = Math.min(20000, Math.max(2, Math.round((values.periods * 2 * Math.PI) / values.step)))
    const eulerGrowth = (1 + values.step * values.step) ** (steps / 2)
    return {
      eulerError: state.errors[0],
      rk4Error: state.errors[1],
      verletError: state.errors[2],
      // Euler gains exactly this factor of energy per step, which is why it spirals outwards for ever.
      eulerEnergy: 0.5 * eulerGrowth * eulerGrowth,
      verletEnergy: 0.5,
      steps,
      exact: last(state.exact)
    }
  },
  paint(state, values): Scene {
    const until = values.periods * 2 * Math.PI
    const shapes: Shape[] = [{ kind: 'line', from: [0, 0], to: [until, 0], width: 1, faint: true }]
    // Euler can run away to enormous values, so the view is clipped and that is said rather than silently cropped.
    let tallest = 1.1
    for (let one = 1; one < state.euler.length; one += 2) tallest = Math.max(tallest, Math.abs(state.euler[one]))
    const top = Math.min(tallest, 4)

    if (Math.round(values.showExact) === 1) {
      shapes.push({ kind: 'path', points: state.exact, width: 2, faint: true })
    }
    shapes.push({ kind: 'path', points: state.rk4, width: 1.5 })
    shapes.push({ kind: 'path', points: state.verlet, width: 1.5, tone: 'other' })
    shapes.push({ kind: 'path', points: state.euler, width: 1.5, tone: 'other', faint: true })

    return {
      view: [-until * 0.02, -top * 1.1, until * 1.04, top * 2.2],
      shapes,
      about: `After ${values.periods} oscillations at a step of ${values.step}: Euler is off by ${state.errors[0].toExponential(2)}, Verlet by ${state.errors[2].toExponential(2)}, Runge-Kutta by ${state.errors[1].toExponential(2)}. Verlet is only second order and still beats Euler by a mile, because it does not gain energy.`
    }
  },
  limits: [
    'One test problem — simple harmonic motion — chosen because it has an exact answer to compare against. A stiff problem would rank these methods completely differently.',
    'Only the error in position at the end is reported. Two methods can finish in the same place having taken entirely different routes.',
    'Runge-Kutta costs four force evaluations per step against Euler\'s one, so comparing them at the same step size flatters it. At the same cost it still wins, by less.',
    'Rounding is ignored. Below about 10⁻¹² the error stops falling with the step and starts rising, and none of this shows that.'
  ]
}

export const UNIVERSE: readonly Simulation[] = Object.freeze([
  nBody as Simulation,
  decayChain as Simulation,
  solverComparison as Simulation
])
