import { randomFrom, type Scene, type Shape, type Simulation } from './simulation.ts'

/**
 * Heat, flow, and many particles together.
 *
 * ## Statistical mechanics is counted, not asserted
 *
 * The Maxwell-Boltzmann curve is famous enough that drawing it would be easy. Instead the particles are given
 * random speeds, allowed to collide, and the distribution is counted out of what they end up with — so it
 * emerges from the collisions rather than being imposed on them, and starting them all at one speed and watching
 * it form is the whole point.
 *
 * ## The Ising model is a real Monte Carlo
 *
 * Metropolis, with the acceptance rule written out. The transition at 2.269 J/k is not put in anywhere; it comes
 * out of the sampling, and the simulation is honest that near the transition a small lattice rounds it off.
 *
 * Everything that is random takes a seed.
 */

// ——— Heat flowing along a bar ————————————————————————————————————————————

interface HeatState {
  now: Float64Array
  next: Float64Array
  points: number
  t: number
  hottest: number
  coldest: number
  total: number
  stability: number
}

export const heatFlow: Simulation<HeatState> = {
  id: 'heat-flow',
  name: 'Heat along a bar',
  section: 'thermo',
  about: 'The heat equation stepped on a grid — so the sharp edge smooths itself out rather than being drawn smooth.',
  controls: [
    { key: 'diffusivity', label: 'Thermal diffusivity', unit: 'mm²/s', least: 1, most: 200, step: 1, initial: 100, about: 'Copper is about 111, steel 18, glass under 1. It is what decides how fast the shape spreads.' },
    { key: 'length', label: 'Bar length', unit: 'cm', least: 1, most: 50, step: 1, initial: 20, about: 'Longer bars take four times as long for twice the length — diffusion goes as the square.' },
    { key: 'leftEnd', label: 'Left end held at', unit: '°C', least: -50, most: 500, step: 5, initial: 100, about: 'Clamped there for ever, like a bar in a flame.' },
    { key: 'rightEnd', label: 'Right end held at', unit: '°C', least: -50, most: 500, step: 5, initial: 0, about: 'Clamped too. Once it settles, the temperature runs straight between the two.' },
    { key: 'startAt', label: 'Bar starts at', unit: '°C', least: -50, most: 500, step: 5, initial: 20, about: 'The whole bar before either end is touched.' },
    { key: 'insulated', label: 'Right end insulated instead', unit: '', least: 0, most: 1, step: 1, initial: 0, about: 'Nothing leaves that end, so the whole bar ends up at the left-hand temperature rather than sloping.' },
    { key: 'points', label: 'Grid points', unit: '', least: 20, most: 400, step: 10, initial: 120, about: 'How finely the bar is divided. More points need a smaller step, which is what the stability number watches.' }
  ],
  readouts: [
    { key: 'hottest', label: 'Hottest', unit: '°C', figures: 4 },
    { key: 'coldest', label: 'Coldest', unit: '°C', figures: 4 },
    { key: 'average', label: 'Average', unit: '°C', figures: 4 },
    { key: 'middle', label: 'In the middle', unit: '°C', figures: 4 },
    { key: 'stability', label: 'Stability number', unit: '', figures: 4 },
    { key: 'settling', label: 'Time to settle', unit: 's', figures: 4 },
    { key: 'time', label: 'Time', unit: 's' }
  ],
  suggestedStep: 0.0005,
  start(values) {
    const points = Math.max(10, Math.round(values.points))
    const now = new Float64Array(points).fill(values.startAt)
    now[0] = values.leftEnd
    if (Math.round(values.insulated) !== 1) now[points - 1] = values.rightEnd
    return { now, next: new Float64Array(points), points, t: 0, hottest: 0, coldest: 0, total: 0, stability: 0 }
  },
  step(state, dt, values) {
    const n = state.points
    const dx = values.length / 100 / (n - 1)
    const alpha = values.diffusivity * 1e-6
    // The explicit scheme is stable only while α·dt/dx² ≤ ½. Past that it does not drift, it explodes.
    const r = (alpha * dt) / (dx * dx)
    state.stability = r

    for (let one = 1; one < n - 1; one += 1) {
      state.next[one] = state.now[one] + r * (state.now[one + 1] - 2 * state.now[one] + state.now[one - 1])
    }
    state.next[0] = values.leftEnd
    if (Math.round(values.insulated) === 1) {
      // No heat crosses an insulated end, so the gradient there is zero — mirror the neighbour.
      state.next[n - 1] = state.next[n - 2]
    } else {
      state.next[n - 1] = values.rightEnd
    }
    state.now.set(state.next)
    state.t += dt

    let hottest = -Infinity
    let coldest = Infinity
    let total = 0
    for (let one = 0; one < n; one += 1) {
      hottest = Math.max(hottest, state.now[one])
      coldest = Math.min(coldest, state.now[one])
      total += state.now[one]
    }
    state.hottest = hottest
    state.coldest = coldest
    state.total = total / n
  },
  read(state, values) {
    const L = values.length / 100
    const alpha = values.diffusivity * 1e-6
    return {
      hottest: state.hottest,
      coldest: state.coldest,
      average: state.total,
      middle: state.now[Math.floor(state.points / 2)],
      stability: state.stability,
      // The slowest mode decays as exp(−απ²t/L²), so this is roughly how long it takes to look settled.
      settling: (L * L) / (alpha * Math.PI * Math.PI),
      time: state.t
    }
  },
  paint(state, values): Scene {
    const n = state.points
    const points: number[] = []
    for (let one = 0; one < n; one += 1) points.push((one / (n - 1)) * values.length, state.now[one])
    const top = Math.max(values.leftEnd, values.rightEnd, values.startAt) + 20
    const bottom = Math.min(values.leftEnd, values.rightEnd, values.startAt) - 20

    const shapes: Shape[] = [{ kind: 'path', points, width: 2 }]
    // Where it is heading, so the approach is visible as an approach.
    if (Math.round(values.insulated) === 1) {
      shapes.push({ kind: 'line', from: [0, values.leftEnd], to: [values.length, values.leftEnd], width: 1, faint: true, tone: 'other' })
    } else {
      shapes.push({ kind: 'line', from: [0, values.leftEnd], to: [values.length, values.rightEnd], width: 1, faint: true, tone: 'other' })
    }
    return {
      view: [-values.length * 0.05, bottom, values.length * 1.1, top - bottom],
      shapes,
      about:
        state.stability > 0.5
          ? `The stability number is ${state.stability.toFixed(3)}, above the half this scheme allows. It will not drift, it will explode — use a smaller step or fewer points.`
          : Math.round(values.insulated) === 1
            ? 'With one end insulated no heat leaves there, so the whole bar ends up at the held temperature.'
            : 'The faint line is where it is heading: straight between the two ends, because nothing is being generated inside.'
    }
  },
  limits: [
    'One dimension, so no heat leaves the sides. A real bar in air cools along its whole length and never reaches this.',
    'Constant diffusivity. Real materials conduct differently hot than cold, by enough to matter over hundreds of degrees.',
    'No radiation, which above a few hundred degrees carries more heat than conduction does.',
    'Diffusion has no speed limit here: a change at one end affects the far end immediately, by an unmeasurably small amount. That is a known flaw of the heat equation itself.'
  ]
}

// ——— A gas, and where its speeds come from ————————————————————————————————

interface GasState {
  x: Float64Array
  y: Float64Array
  vx: Float64Array
  vy: Float64Array
  count: number
  t: number
  random: () => number
  collisions: number
  bins: number[]
}

export const speedDistribution: Simulation<GasState> = {
  id: 'speed-distribution',
  name: 'Where the Maxwell curve comes from',
  section: 'thermo',
  about: 'Start every particle at the same speed and let them collide. The famous curve builds itself out of nothing but the collisions.',
  controls: [
    { key: 'particles', label: 'Particles', unit: '', least: 50, most: 1200, step: 50, initial: 500, about: 'More gives a smoother curve. The shape is the same with fifty, just noisier.' },
    { key: 'speed', label: 'Starting speed', unit: 'm/s', least: 50, most: 1000, step: 10, initial: 400, about: 'Every particle starts at exactly this, in a random direction. Nothing is spread out to begin with.' },
    { key: 'radius', label: 'Particle radius', unit: 'mm', least: 1, most: 20, step: 0.5, initial: 6, about: 'Bigger particles collide more often, so the distribution settles sooner.' },
    { key: 'seed', label: 'Seed', unit: '', least: 1, most: 9999, step: 1, initial: 1, about: 'The same seed gives the same run exactly.' },
    { key: 'sameStart', label: 'All at one speed', unit: '', least: 0, most: 1, step: 1, initial: 1, about: 'Turn it off to start already spread out, which shows the curve is where it settles rather than where it began.' },
    { key: 'slowdown', label: 'Slowed down by', unit: '×', least: 100, most: 100000, step: 100, initial: 1000, about: 'At 400 m/s a particle crosses the metre-wide box in two and a half milliseconds. One second here is one second divided by this much of real time; the physics is untouched.' }
  ],
  readouts: [
    { key: 'meanSpeed', label: 'Average speed', unit: 'm/s', figures: 4 },
    { key: 'rms', label: 'RMS speed', unit: 'm/s', figures: 4 },
    { key: 'likeliest', label: 'Most likely speed', unit: 'm/s', figures: 4 },
    { key: 'fastest', label: 'Fastest', unit: 'm/s', figures: 4 },
    { key: 'energy', label: 'Kinetic energy', unit: 'J', figures: 8 },
    { key: 'collisions', label: 'Collisions', unit: '' },
    { key: 'ratio', label: 'RMS over mean', unit: '', figures: 4 },
    { key: 'milliseconds', label: 'Real time gone by', unit: 'ms', figures: 4 }
  ],
  conserves: { key: 'energy', label: 'Kinetic energy' },
  suggestedStep: 0.002,
  start(values) {
    const count = Math.max(10, Math.round(values.particles))
    const random = randomFrom(values.seed)
    const x = new Float64Array(count)
    const y = new Float64Array(count)
    const vx = new Float64Array(count)
    const vy = new Float64Array(count)
    for (let one = 0; one < count; one += 1) {
      x[one] = random()
      y[one] = random()
      const angle = random() * 2 * Math.PI
      // Every particle at exactly the chosen speed, or already spread — the point is what it settles to.
      const speed = Math.round(values.sameStart) === 1 ? values.speed : values.speed * (0.2 + 1.6 * random())
      vx[one] = speed * Math.cos(angle)
      vy[one] = speed * Math.sin(angle)
    }
    return { x, y, vx, vy, count, t: 0, random, collisions: 0, bins: [] }
  },
  step(state, watched, values) {
    const n = state.count
    const r = values.radius / 1000
    // Watch seconds in, real seconds out. Everything below is real.
    const dt = watched / Math.max(1, values.slowdown)
    state.t += dt

    for (let one = 0; one < n; one += 1) {
      state.x[one] += state.vx[one] * dt
      state.y[one] += state.vy[one] * dt
      // The walls are elastic, so no energy is lost there.
      if (state.x[one] < r) { state.x[one] = r; state.vx[one] = Math.abs(state.vx[one]) }
      if (state.x[one] > 1 - r) { state.x[one] = 1 - r; state.vx[one] = -Math.abs(state.vx[one]) }
      if (state.y[one] < r) { state.y[one] = r; state.vy[one] = Math.abs(state.vy[one]) }
      if (state.y[one] > 1 - r) { state.y[one] = 1 - r; state.vy[one] = -Math.abs(state.vy[one]) }
    }

    // Collisions, by a grid so this does not cost n². Equal masses, perfectly elastic: the pair simply swaps the
    // component of velocity along the line joining them, which conserves both momentum and energy exactly.
    const cells = Math.max(1, Math.floor(1 / (2 * r)))
    const buckets = new Map<number, number[]>()
    for (let one = 0; one < n; one += 1) {
      const key = Math.min(cells - 1, Math.floor(state.x[one] * cells)) * cells + Math.min(cells - 1, Math.floor(state.y[one] * cells))
      const held = buckets.get(key)
      if (held) held.push(one)
      else buckets.set(key, [one])
    }
    for (const [key, held] of buckets) {
      const cx = Math.floor(key / cells)
      const cy = key % cells
      const near: number[] = []
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          const other = buckets.get((cx + dx) * cells + (cy + dy))
          if (other) near.push(...other)
        }
      }
      for (const a of held) {
        for (const b of near) {
          if (b <= a) continue
          const dx = state.x[b] - state.x[a]
          const dy = state.y[b] - state.y[a]
          const distance = Math.hypot(dx, dy)
          if (distance >= 2 * r || distance === 0) continue
          const nx = dx / distance
          const ny = dy / distance
          const along = (state.vx[b] - state.vx[a]) * nx + (state.vy[b] - state.vy[a]) * ny
          if (along > 0) continue // already separating
          state.vx[a] += along * nx
          state.vy[a] += along * ny
          state.vx[b] -= along * nx
          state.vy[b] -= along * ny
          // Push them apart so they do not stick together and collide for ever.
          const overlap = (2 * r - distance) / 2
          state.x[a] -= nx * overlap
          state.y[a] -= ny * overlap
          state.x[b] += nx * overlap
          state.y[b] += ny * overlap
          state.collisions += 1
        }
      }
    }

    // The distribution, counted out of what the particles actually have.
    const bins = 28
    const counts = new Array<number>(bins).fill(0)
    const top = values.speed * 2.6
    for (let one = 0; one < n; one += 1) {
      const speed = Math.hypot(state.vx[one], state.vy[one])
      const at = Math.min(bins - 1, Math.floor((speed / top) * bins))
      counts[at] += 1
    }
    state.bins = counts
  },
  read(state) {
    const n = state.count
    let sum = 0
    let square = 0
    let fastest = 0
    for (let one = 0; one < n; one += 1) {
      const speed = Math.hypot(state.vx[one], state.vy[one])
      sum += speed
      square += speed * speed
      fastest = Math.max(fastest, speed)
    }
    const mean = sum / n
    const rms = Math.sqrt(square / n)
    // The bin with the most in it — the most likely speed, read off rather than calculated.
    let best = 0
    let bestAt = 0
    state.bins.forEach((count, at) => {
      if (count > best) { best = count; bestAt = at }
    })
    return {
      meanSpeed: mean,
      rms,
      likeliest: state.bins.length > 0 ? ((bestAt + 0.5) / state.bins.length) * (rms * 2.6) : 0,
      fastest,
      // Mass taken as one, so this is energy per unit mass — what matters is that it does not move.
      energy: 0.5 * square,
      collisions: state.collisions,
      ratio: mean > 0 ? rms / mean : 0,
      milliseconds: state.t * 1000
    }
  },
  paint(state, values): Scene {
    const shapes: Shape[] = [{ kind: 'rect', at: [0.5, 0.5], width: 1, height: 1 }]
    const r = values.radius / 1000
    // Only a sample is drawn: a thousand circles is slower to draw than it is to step.
    const stride = Math.max(1, Math.floor(state.count / 260))
    for (let one = 0; one < state.count; one += stride) {
      shapes.push({ kind: 'circle', at: [state.x[one], state.y[one]], radius: r, fill: true })
    }

    // The distribution, counted, drawn beside the box with the Maxwell curve over it.
    const bins = state.bins.length
    const most = Math.max(1, ...state.bins)
    for (let one = 0; one < bins; one += 1) {
      const h = (state.bins[one] / most) * 0.9
      shapes.push({ kind: 'rect', at: [1.15 + (one / bins) * 0.9 + 0.45 / bins, h / 2], width: 0.85 / bins, height: Math.max(0.002, h), fill: true, tone: 'faint' })
    }
    // Maxwell-Boltzmann in two dimensions: f(v) ∝ v·exp(−v²/2σ²). Drawn over the counted bars for comparison.
    let square = 0
    for (let one = 0; one < state.count; one += 1) square += state.vx[one] ** 2 + state.vy[one] ** 2
    const sigma = Math.sqrt(square / (2 * state.count))
    const top = values.speed * 2.6
    const curve: number[] = []
    let peak = 0
    for (let one = 0; one <= 120; one += 1) {
      const v = (one / 120) * top
      peak = Math.max(peak, (v / (sigma * sigma)) * Math.exp(-(v * v) / (2 * sigma * sigma)))
    }
    for (let one = 0; one <= 120; one += 1) {
      const v = (one / 120) * top
      const f = (v / (sigma * sigma)) * Math.exp(-(v * v) / (2 * sigma * sigma))
      curve.push(1.15 + (v / top) * 0.9, (f / peak) * 0.9)
    }
    shapes.push({ kind: 'path', points: curve, width: 1.8, tone: 'other' })
    shapes.push({ kind: 'text', at: [1.6, -0.08], text: 'speeds, counted', size: 10, anchor: 'middle', tone: 'faint' })

    return {
      view: [-0.05, -0.15, 2.25, 1.2],
      shapes,
      about:
        state.collisions < state.count
          ? 'Every particle still has nearly the speed it started with. Keep going: the collisions have not had time to spread them out.'
          : `${state.collisions.toLocaleString('en-GB')} collisions. The bars are what the particles actually have; the curve is Maxwell-Boltzmann for this energy. Nothing made them match.`
    }
  },
  limits: [
    'Two dimensions, so the curve is the 2-D Maxwell distribution — the peak sits differently from the 3-D one in textbooks.',
    'Hard discs: they touch and bounce, with no attraction between them at all. That makes this a gas that can never condense.',
    'Equal masses. A mixture settles to the same energy per particle, not the same speed, and that is worth seeing but is not here.',
    'Collisions are resolved pair by pair in one pass, so a three-body pile-up is handled approximately. With this few particles that is rare.'
  ]
}

// ——— The Ising model ————————————————————————————————————————————————————————

interface IsingState {
  spins: Int8Array
  size: number
  random: () => number
  t: number
  magnetisation: number
  energy: number
  accepted: number
  tried: number
  susceptibility: number
  samples: number
  sumM: number
  sumM2: number
}

export const isingModel: Simulation<IsingState> = {
  id: 'ising-model',
  name: 'Ising model',
  section: 'condensed',
  about: 'A magnet that loses its magnetism at a temperature nobody put in — the transition comes out of the sampling.',
  controls: [
    { key: 'size', label: 'Lattice size', unit: '', least: 8, most: 96, step: 4, initial: 48, about: 'A small lattice rounds the transition off. Bigger is sharper, and that softening is itself a real effect.' },
    { key: 'temperature', label: 'Temperature', unit: 'J/k', least: 0.2, most: 5, step: 0.05, initial: 2.0, about: 'The transition is at 2.269 for this lattice. Below it the spins line up; above, they do not. Nothing in the code knows that number.' },
    { key: 'field', label: 'Applied field', unit: 'J', least: -1, most: 1, step: 0.02, initial: 0, about: 'Tips the balance one way. Any field at all destroys the sharpness of the transition.' },
    { key: 'sweeps', label: 'Sweeps per second', unit: '', least: 1, most: 200, step: 1, initial: 30, about: 'One sweep is one attempted flip per site. Near the transition it takes many to settle.' },
    { key: 'seed', label: 'Seed', unit: '', least: 1, most: 9999, step: 1, initial: 1, about: 'The same seed gives the same run exactly.' },
    { key: 'startOrdered', label: 'Start all aligned', unit: '', least: 0, most: 1, step: 1, initial: 0, about: 'Start ordered or random. Above the transition both end up the same, which is the point.' }
  ],
  readouts: [
    { key: 'magnetisation', label: 'Magnetisation', unit: '', figures: 5 },
    { key: 'absMagnetisation', label: 'Magnetisation, size only', unit: '', figures: 5 },
    { key: 'energy', label: 'Energy per spin', unit: 'J', figures: 5 },
    { key: 'acceptance', label: 'Flips accepted', unit: '', figures: 4 },
    { key: 'susceptibility', label: 'Susceptibility', unit: '', figures: 5 },
    { key: 'criticalTemperature', label: 'Transition at', unit: 'J/k', figures: 5 },
    { key: 'sweeps', label: 'Sweeps done', unit: '' }
  ],
  suggestedStep: 0.01,
  start(values) {
    const size = Math.max(4, Math.round(values.size))
    const random = randomFrom(values.seed)
    const spins = new Int8Array(size * size)
    for (let one = 0; one < spins.length; one += 1) {
      spins[one] = Math.round(values.startOrdered) === 1 ? 1 : random() < 0.5 ? -1 : 1
    }
    return {
      spins, size, random, t: 0, magnetisation: 0, energy: 0,
      accepted: 0, tried: 0, susceptibility: 0, samples: 0, sumM: 0, sumM2: 0
    }
  },
  step(state, dt, values) {
    state.t += dt
    const size = state.size
    const n = size * size
    const T = Math.max(0.01, values.temperature)
    const h = values.field
    const due = Math.max(0, Math.round(dt * values.sweeps * n))

    for (let one = 0; one < due; one += 1) {
      const at = Math.floor(state.random() * n)
      const x = at % size
      const y = Math.floor(at / size)
      // Wrapped edges, so no spin is special for being at the edge.
      const around =
        state.spins[((x + 1) % size) + y * size] +
        state.spins[((x - 1 + size) % size) + y * size] +
        state.spins[x + ((y + 1) % size) * size] +
        state.spins[x + ((y - 1 + size) % size) * size]
      // Flipping costs this much. Downhill is always taken; uphill with probability exp(−ΔE/kT) — Metropolis.
      const cost = 2 * state.spins[at] * (around + h)
      state.tried += 1
      if (cost <= 0 || state.random() < Math.exp(-cost / T)) {
        state.spins[at] = -state.spins[at] as -1 | 1
        state.accepted += 1
      }
    }

    let total = 0
    let energy = 0
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const me = state.spins[x + y * size]
        total += me
        // Each bond counted once: the neighbour to the right and the one below.
        energy -= me * (state.spins[((x + 1) % size) + y * size] + state.spins[x + ((y + 1) % size) * size])
        energy -= h * me
      }
    }
    state.magnetisation = total / n
    state.energy = energy / n

    // Susceptibility from the fluctuation, which is where it diverges at the transition.
    state.sumM += Math.abs(state.magnetisation)
    state.sumM2 += state.magnetisation * state.magnetisation
    state.samples += 1
    const meanM = state.sumM / state.samples
    const meanM2 = state.sumM2 / state.samples
    state.susceptibility = (n * Math.max(0, meanM2 - meanM * meanM)) / T
  },
  read(state) {
    return {
      magnetisation: state.magnetisation,
      absMagnetisation: Math.abs(state.magnetisation),
      energy: state.energy,
      acceptance: state.tried > 0 ? state.accepted / state.tried : 0,
      susceptibility: state.susceptibility,
      // Onsager's exact result for the square lattice: 2/ln(1+√2).
      criticalTemperature: 2 / Math.log(1 + Math.SQRT2),
      sweeps: Math.floor(state.tried / (state.size * state.size))
    }
  },
  paint(state, values): Scene {
    const size = state.size
    const shapes: Shape[] = []
    // One rectangle per spin would be thousands of shapes. Rows of same-signed spins are merged into runs.
    for (let y = 0; y < size; y += 1) {
      let runStart = 0
      let runSign = state.spins[y * size]
      for (let x = 1; x <= size; x += 1) {
        const here = x < size ? state.spins[x + y * size] : (0 as number)
        if (here !== runSign || x === size) {
          if (runSign === 1) {
            shapes.push({
              kind: 'rect',
              at: [(runStart + x) / 2, y + 0.5],
              width: x - runStart,
              height: 1,
              fill: true
            })
          }
          runStart = x
          runSign = here as -1 | 1
        }
      }
    }
    const critical = 2 / Math.log(1 + Math.SQRT2)
    return {
      view: [-1, -1, size + 2, size + 3],
      shapes,
      about:
        values.temperature < critical - 0.15
          ? `Below the transition (${critical.toFixed(3)}): one sign has taken over, and the magnetisation is ${Math.abs(state.magnetisation).toFixed(3)}.`
          : values.temperature > critical + 0.15
            ? `Above the transition: no sign wins, and the magnetisation hovers near zero however long you wait.`
            : `Right at the transition (${critical.toFixed(3)}): patches of every size at once, and the magnetisation swings about wildly. That is what makes it critical.`
    }
  },
  limits: [
    'Two dimensions, nearest neighbours, spins that are only up or down. Real magnets have none of those restrictions.',
    'A finite lattice with wrapped edges. The transition is genuinely rounded off at this size — bigger is sharper, and that is physics rather than error.',
    'Metropolis sampling slows down badly near the transition, so the numbers there need many more sweeps before they mean anything.',
    'Energy is in units of the coupling J and temperature in J/k, so none of these numbers is in kelvin.'
  ]
}

// ——— Flow past an obstacle ————————————————————————————————————————————————

interface FlowState {
  t: number
  trails: number[][]
  shed: number
  lastSide: number
}

export const flowPast: Simulation<FlowState> = {
  id: 'flow-past',
  name: 'Flow past a cylinder',
  section: 'fluid',
  about: 'Streamlines round an obstacle, and the Reynolds number that decides whether they stay tidy.',
  controls: [
    { key: 'speed', label: 'Flow speed', unit: 'm/s', least: 0.01, most: 20, step: 0.01, initial: 1, about: 'How fast the fluid goes past. With the size and the viscosity it sets the Reynolds number, which decides everything else.' },
    { key: 'radius', label: 'Cylinder radius', unit: 'cm', least: 0.5, most: 20, step: 0.5, initial: 5, about: 'Bigger obstacles make bigger wakes, and reach turbulence at lower speeds.' },
    { key: 'viscosity', label: 'Kinematic viscosity', unit: 'mm²/s', least: 0.1, most: 1000, step: 0.1, initial: 1, about: 'Water is about 1, air 15, honey a hundred thousand. Thicker fluids stay tidy to much higher speeds.' },
    { key: 'lines', label: 'Streamlines', unit: '', least: 5, most: 40, step: 1, initial: 19, about: 'How many to trace.' },
    { key: 'circulation', label: 'Spin on the cylinder', unit: '', least: -4, most: 4, step: 0.1, initial: 0, about: 'A spinning cylinder throws the flow to one side and gets pushed the other — the Magnus effect that bends a football.' }
  ],
  readouts: [
    { key: 'reynolds', label: 'Reynolds number', unit: '', figures: 5 },
    { key: 'regime', label: 'Smooth (1) or not (0)', unit: '' },
    { key: 'dragCoefficient', label: 'Drag coefficient', unit: '', figures: 4 },
    { key: 'drag', label: 'Drag per metre', unit: 'N/m', figures: 5 },
    { key: 'lift', label: 'Lift per metre', unit: 'N/m', figures: 5 },
    { key: 'sheddingFrequency', label: 'Vortex shedding', unit: 'Hz', figures: 4 },
    { key: 'fastestPoint', label: 'Fastest point on the surface', unit: 'm/s', figures: 4 }
  ],
  suggestedStep: 0.02,
  start() {
    return { t: 0, trails: [], shed: 0, lastSide: 1 }
  },
  step(state, dt) {
    state.t += dt
  },
  read(_state, values) {
    const r = values.radius / 100
    const nu = values.viscosity * 1e-6
    const U = values.speed
    const Re = (U * 2 * r) / nu
    // The standard empirical fit for a cylinder across the ranges that matter.
    let cd: number
    if (Re < 1) cd = 24 / Math.max(Re, 1e-6)
    else if (Re < 1000) cd = 24 / Re + 6 / (1 + Math.sqrt(Re)) + 0.4
    else if (Re < 2e5) cd = 1.2
    else cd = 0.3 // past the drag crisis, where the boundary layer goes turbulent and drag drops
    const density = 1000
    const circulation = values.circulation * 2 * Math.PI * r * U
    return {
      reynolds: Re,
      regime: Re < 40 ? 1 : 0,
      dragCoefficient: cd,
      drag: 0.5 * density * U * U * (2 * r) * cd,
      // Kutta-Joukowski: lift per length is ρ·U·Γ, exactly.
      lift: density * U * circulation,
      // Strouhal number is near 0.21 over a wide range, which is why shedding is so predictable.
      sheddingFrequency: Re > 40 && Re < 2e5 ? (0.21 * U) / (2 * r) : 0,
      fastestPoint: 2 * U
    }
  },
  paint(_state, values): Scene {
    const r = values.radius / 100
    const span = r * 8
    const shapes: Shape[] = [{ kind: 'circle', at: [0, 0], radius: r, fill: true }]
    const gamma = values.circulation * 2 * Math.PI * r * values.speed
    const count = Math.max(5, Math.round(values.lines))

    // Potential flow round a cylinder, with circulation. Exact, and exactly what it is: the inviscid answer.
    for (let one = 0; one < count; one += 1) {
      const startY = ((one / (count - 1)) - 0.5) * span * 1.4
      const points: number[] = []
      let x = -span * 0.6
      let y = startY
      for (let step = 0; step < 420; step += 1) {
        const r2 = x * x + y * y
        if (r2 < r * r * 1.02) break
        // u = U(1 − r²(x²−y²)/|r|⁴) and so on, plus the circulation term.
        const u = values.speed * (1 - (r * r * (x * x - y * y)) / (r2 * r2)) + (gamma * y) / (2 * Math.PI * r2)
        const v = values.speed * ((-r * r * 2 * x * y) / (r2 * r2)) - (gamma * x) / (2 * Math.PI * r2)
        const size = Math.hypot(u, v)
        if (size < 1e-9) break
        points.push(x, y)
        x += (u / size) * span * 0.006
        y += (v / size) * span * 0.006
        if (x > span * 0.7) break
      }
      if (points.length >= 4) shapes.push({ kind: 'path', points, width: 1.2, faint: true })
    }

    const Re = (values.speed * 2 * r) / (values.viscosity * 1e-6)
    return {
      view: [-span * 0.65, -span * 0.7, span * 1.4, span * 1.4],
      shapes,
      about:
        Re < 1
          ? `Reynolds ${Re.toPrecision(3)}: creeping flow. Viscosity rules, the streamlines close up perfectly behind, and there is no wake at all.`
          : Re < 40
            ? `Reynolds ${Re.toPrecision(3)}: still smooth, with a pair of standing eddies behind that this drawing does not show.`
            : `Reynolds ${Re.toPrecision(3)}: past this the wake sheds vortices alternately at about ${((0.21 * values.speed) / (2 * r)).toFixed(2)} Hz. The streamlines drawn are the inviscid answer and are no longer what the fluid does.`
    }
  },
  limits: [
    'The streamlines are potential flow: no viscosity at all. That is exactly right at very low speeds and increasingly wrong above Reynolds 40, which the drawing says.',
    "Potential flow predicts no drag whatsoever — d'Alembert's paradox. The drag figure comes from measured data instead, which is why the two do not come from the same place.",
    'Two dimensions, an infinitely long cylinder. A real one of finite length has flow round the ends.',
    'Steady flow. The vortex shedding is reported as a frequency but is not simulated — nothing on screen is shedding.',
    'The lift figure is Kutta-Joukowski, which is exact for this potential flow and needs a real mechanism (spin, or a sharp trailing edge) to produce the circulation in the first place.'
  ]
}

export const MATTER: readonly Simulation[] = Object.freeze([
  heatFlow as Simulation,
  speedDistribution as Simulation,
  isingModel as Simulation,
  flowPast as Simulation
])
