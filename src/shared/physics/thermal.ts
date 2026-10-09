import { BOLTZMANN, GAS_CONSTANT, HBAR, ELECTRON_MASS, pushTrail, randomFrom, type Scene, type Shape, type Simulation } from './simulation.ts'

/**
 * Thermodynamics and quantum mechanics: the two places where counting replaces following.
 *
 * ## The gas is particles, and the gas laws come out
 *
 * Boyle's law is usually a graph somebody is told about. Here there are real particles bouncing in a box, the
 * pressure is counted from the momentum they actually deliver to the walls, and halving the volume doubles that
 * number without anybody writing pV = nRT anywhere. That is the difference between being shown a law and watching
 * one appear.
 *
 * ## The wavefunction is solved, not drawn
 *
 * The energy levels of a particle in a box are found by solving the eigenvalue problem on a grid, not by printing
 * n²h²/8mL². So changing the well's shape gives the right answer for a shape that has no formula — and the
 * laboratory shows the computed level beside the textbook one, which is how you find out the grid is too coarse.
 *
 * Pure. The gas takes a seed, so a run can be repeated exactly.
 */

// ---------------------------------------------------------------- ideal gas

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
}

interface GasState {
  particles: Particle[]
  t: number
  /** Momentum delivered to the walls since the last reading — this is what pressure actually is. */
  impulse: number
  measured: number
  window: number
  speeds: number[]
}

const BOX = 10

export const idealGas: Simulation<GasState> = {
  id: 'ideal-gas',
  name: 'Ideal Gas',
  section: 'thermo',
  about: 'Real particles in a box, with the pressure counted from the momentum they deliver to the walls.',
  controls: [
    { key: 'count', label: 'Particles', unit: '', least: 10, most: 400, step: 10, initial: 150, about: 'Pressure is proportional to how many there are, at the same temperature.' },
    { key: 'temperature', label: 'Temperature', unit: 'K', least: 10, most: 1200, step: 10, initial: 300, about: 'Sets the average speed. Doubling it doubles the pressure and multiplies the average speed by √2.' },
    { key: 'volume', label: 'Box width', unit: '', least: 3, most: 10, step: 0.1, initial: 10, about: 'Halve this and the pressure doubles — Boyle’s law, counted rather than assumed.' },
    { key: 'mass', label: 'Particle mass', unit: 'u', least: 1, most: 200, step: 1, initial: 28, about: 'Heavier particles move more slowly at the same temperature, and deliver the same pressure.' },
    { key: 'seed', label: 'Seed', unit: '', least: 1, most: 9999, step: 1, initial: 1, about: 'The same seed gives exactly the same run.' }
  ],
  readouts: [
    { key: 'pressure', label: 'Pressure', unit: 'arb.' },
    { key: 'meanSpeed', label: 'Mean speed', unit: 'arb.' },
    { key: 'rms', label: 'Root-mean-square speed', unit: 'arb.' },
    { key: 'energy', label: 'Kinetic energy', unit: 'arb.', figures: 5 },
    { key: 'pv', label: 'pressure × volume', unit: 'arb.' },
    { key: 'time', label: 'Time', unit: 's' }
  ],
  conserves: { key: 'energy', label: 'Kinetic energy' },
  start(values) {
    const random = randomFrom(values.seed)
    const particles: Particle[] = []
    // Speeds drawn so the average kinetic energy matches the temperature: ½mv² = kT per degree of freedom.
    const typical = Math.sqrt(values.temperature / values.mass) * 2
    for (let one = 0; one < Math.round(values.count); one += 1) {
      const angle = random() * Math.PI * 2
      // Box-Muller, so the speeds come out Maxwell-Boltzmann rather than all the same.
      const u1 = Math.max(1e-9, random())
      const u2 = random()
      const gauss = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
      const speed = Math.abs(typical * (1 + gauss * 0.4))
      particles.push({
        x: random() * values.volume,
        y: random() * BOX,
        vx: speed * Math.cos(angle),
        vy: speed * Math.sin(angle)
      })
    }
    return { particles, t: 0, impulse: 0, measured: 0, window: 0, speeds: [] }
  },
  step(state, dt, values) {
    for (const one of state.particles) {
      one.x += one.vx * dt
      one.y += one.vy * dt
      // Each bounce reverses the momentum across that wall, so it delivers 2·m·|v| of impulse. That sum, divided
      // by the time and the wall length, *is* the pressure — not a formula applied afterwards.
      if (one.x < 0) {
        one.x = -one.x
        one.vx = -one.vx
        state.impulse += 2 * values.mass * Math.abs(one.vx)
      } else if (one.x > values.volume) {
        one.x = 2 * values.volume - one.x
        one.vx = -one.vx
        state.impulse += 2 * values.mass * Math.abs(one.vx)
      }
      if (one.y < 0) {
        one.y = -one.y
        one.vy = -one.vy
        state.impulse += 2 * values.mass * Math.abs(one.vy)
      } else if (one.y > BOX) {
        one.y = 2 * BOX - one.y
        one.vy = -one.vy
        state.impulse += 2 * values.mass * Math.abs(one.vy)
      }
    }
    state.t += dt
    state.window += dt
    // Averaged over a window, because pressure from a few hundred particles is noisy moment to moment.
    if (state.window >= 0.25) {
      state.measured = state.impulse / state.window / (2 * (values.volume + BOX))
      state.impulse = 0
      state.window = 0
    }
  },
  read(state, values) {
    let total = 0
    let energy = 0
    for (const one of state.particles) {
      const speed = Math.hypot(one.vx, one.vy)
      total += speed
      energy += 0.5 * values.mass * speed * speed
    }
    const count = Math.max(1, state.particles.length)
    return {
      pressure: state.measured,
      meanSpeed: total / count,
      rms: Math.sqrt((2 * energy) / (values.mass * count)),
      energy,
      pv: state.measured * values.volume * BOX,
      time: state.t
    }
  },
  paint(state, values): Scene {
    return {
      view: [-0.5, -0.5, Math.max(values.volume, 4) + 0.5, BOX + 0.5],
      shapes: [
        { kind: 'rect', at: [0, 0], width: values.volume, height: BOX, fill: false },
        ...state.particles.slice(0, 400).map((one) => ({
          kind: 'circle' as const,
          at: [one.x, one.y] as readonly [number, number],
          radius: 0.12,
          fill: true,
          // Faster than average is drawn differently, so the spread of speeds is visible rather than stated.
          tone: Math.hypot(one.vx, one.vy) > Math.sqrt(values.temperature / values.mass) * 2.2 ? 'other' : undefined
        }))
      ],
      about: `Pressure is counted from the momentum the particles really deliver to the walls. Narrow the box and watch it rise — that is Boyle's law happening, not being applied.`
    }
  },
  limits: [
    'Two dimensions, and the particles do not collide with each other — only with the walls. That is what "ideal" means, and it is why the gas laws come out exactly.',
    'Arbitrary units throughout: the ratios are right and the absolute numbers are not pascals.',
    'Four hundred particles at most, which is enough for the averages to settle and few enough to draw.'
  ]
}

// ---------------------------------------------------------------- particle in a box

interface WellState {
  levels: number[]
  wavefunctions: number[][]
  t: number
}

/**
 * The energy levels of a well, by solving the eigenvalue problem on a grid.
 *
 * The Hamiltonian is a tridiagonal matrix: the second derivative as a finite difference, plus the potential on the
 * diagonal. Its eigenvalues are the energies. Solved rather than looked up, so a well with no formula still works.
 */
function solveWell(points: number, width: number, potential: (x: number) => number): { levels: number[]; states: number[][] } {
  const h = width / (points + 1)
  // ħ²/2m in units where the answer comes out in electron-volts for a well measured in nanometres.
  const scale = (HBAR * HBAR) / (2 * ELECTRON_MASS) / (1.602176634e-19 * 1e-18)
  const diagonal: number[] = []
  const off: number[] = []
  for (let one = 0; one < points; one += 1) {
    diagonal.push((2 * scale) / (h * h) + potential((one + 1) * h))
    if (one < points - 1) off.push(-scale / (h * h))
  }

  /*
   * The eigenvalues of a symmetric tridiagonal matrix, by bisection on the Sturm sequence.
   *
   * Counting how many eigenvalues lie below a number is a single pass; bisecting on that count finds each one to
   * any precision. It is slower than the clever methods and it is short enough to read, which matters more here.
   */
  const countBelow = (value: number): number => {
    let count = 0
    let d = diagonal[0] - value
    if (d < 0) count += 1
    for (let one = 1; one < points; one += 1) {
      d = diagonal[one] - value - (off[one - 1] * off[one - 1]) / (d === 0 ? 1e-30 : d)
      if (d < 0) count += 1
    }
    return count
  }

  const lowest = Math.min(...diagonal) - 2 * Math.max(...off.map(Math.abs))
  const highest = Math.max(...diagonal) + 2 * Math.max(...off.map(Math.abs))
  const levels: number[] = []
  for (let wanted = 1; wanted <= Math.min(8, points); wanted += 1) {
    let low = lowest
    let high = highest
    for (let step = 0; step < 90; step += 1) {
      const middle = (low + high) / 2
      if (countBelow(middle) >= wanted) high = middle
      else low = middle
    }
    levels.push((low + high) / 2)
  }

  // The wavefunction for each level, by inverse iteration: solve (H − E)ψ = previous, repeatedly.
  const states = levels.map((energy) => {
    let psi = Array.from({ length: points }, (_, one) => Math.sin(((one + 1) * Math.PI) / (points + 1)) + 0.01 * (one % 3))
    for (let round = 0; round < 3; round += 1) {
      // Thomas algorithm for the tridiagonal solve.
      const c = [...off]
      const d = diagonal.map((one) => one - energy - 1e-7)
      const r = [...psi]
      for (let one = 1; one < points; one += 1) {
        const factor = c[one - 1] / d[one - 1]
        d[one] -= factor * c[one - 1]
        r[one] -= factor * r[one - 1]
      }
      const out = new Array<number>(points).fill(0)
      out[points - 1] = r[points - 1] / d[points - 1]
      for (let one = points - 2; one >= 0; one -= 1) out[one] = (r[one] - c[one] * out[one + 1]) / d[one]
      const size = Math.sqrt(out.reduce((sum, two) => sum + two * two, 0))
      psi = out.map((two) => two / (size || 1))
    }
    return psi
  })

  return { levels, states }
}

export const particleInBox: Simulation<WellState> = {
  id: 'particle-in-box',
  name: 'Particle in a Well',
  section: 'quantum',
  about: 'Energy levels found by solving the eigenvalue problem, so a well with no formula still comes out right.',
  controls: [
    { key: 'width', label: 'Well width', unit: 'nm', least: 0.1, most: 5, step: 0.05, initial: 1, about: 'The levels go with one over the square of this, so a narrower well pushes them far apart.' },
    { key: 'depth', label: 'Barrier height', unit: 'eV', least: 0, most: 200, step: 1, initial: 0, about: 'Zero is the infinite square well. Raise it and the wavefunction leaks into the walls, pulling the levels down.' },
    { key: 'step', label: 'Step in the middle', unit: 'eV', least: 0, most: 100, step: 0.5, initial: 0, about: 'A step across half the well. There is no formula for this, and the solver does not need one.' },
    { key: 'points', label: 'Grid points', unit: '', least: 20, most: 400, step: 10, initial: 160, about: 'How finely the well is divided. Too few and the computed levels sit above the true ones.' }
  ],
  readouts: [
    { key: 'e1', label: 'Ground state', unit: 'eV', figures: 5 },
    { key: 'e2', label: 'Second level', unit: 'eV', figures: 5 },
    { key: 'e3', label: 'Third level', unit: 'eV', figures: 5 },
    { key: 'formula', label: 'Textbook ground state', unit: 'eV', figures: 5 },
    { key: 'error', label: 'Difference', unit: '%' },
    { key: 'gap', label: 'First gap', unit: 'eV' }
  ],
  start(values) {
    const { levels, states } = solveWell(Math.round(values.points), values.width, (x) => {
      let v = 0
      if (values.step > 0 && x > values.width / 2) v += values.step
      return v
    })
    return { levels, wavefunctions: states, t: 0 }
  },
  step(state, dt) {
    state.t += dt
  },
  read(state, values) {
    // The textbook answer for the infinite square well, so the computed one can be checked against it.
    const formula = (1 * 1 * 0.376) / (values.width * values.width)
    return {
      e1: state.levels[0] ?? 0,
      e2: state.levels[1] ?? 0,
      e3: state.levels[2] ?? 0,
      formula,
      error: formula > 0 ? (((state.levels[0] ?? 0) - formula) / formula) * 100 : 0,
      gap: (state.levels[1] ?? 0) - (state.levels[0] ?? 0)
    }
  },
  paint(state, values): Scene {
    const top = Math.max(...state.levels.slice(0, 4), 1) * 1.4
    const shapes: Shape[] = [
      { kind: 'line', from: [0, 0], to: [values.width, 0], width: 2 },
      { kind: 'line', from: [0, 0], to: [0, top], width: 2 },
      { kind: 'line', from: [values.width, 0], to: [values.width, top], width: 2 }
    ]
    if (values.step > 0) {
      shapes.push({ kind: 'line', from: [values.width / 2, 0], to: [values.width / 2, values.step], width: 1.5, tone: 'other' })
      shapes.push({ kind: 'line', from: [values.width / 2, values.step], to: [values.width, values.step], width: 1.5, tone: 'other' })
    }
    // Each level drawn at its energy, with its wavefunction riding on it — the usual way these are shown.
    for (let one = 0; one < Math.min(4, state.levels.length); one += 1) {
      const energy = state.levels[one]
      shapes.push({ kind: 'line', from: [0, energy], to: [values.width, energy], width: 1, faint: true })
      const psi = state.wavefunctions[one] ?? []
      const points: number[] = []
      const biggest = Math.max(...psi.map(Math.abs), 1e-9)
      for (let two = 0; two < psi.length; two += 1) {
        points.push(((two + 1) / (psi.length + 1)) * values.width, energy + (psi[two] / biggest) * (top / 12))
      }
      shapes.push({ kind: 'path', points, width: 1.4 })
      shapes.push({ kind: 'text', at: [values.width + 0.02, energy], text: `E${one + 1}`, size: 10 })
    }
    return {
      view: [-0.1, -top * 0.1, values.width * 1.2, top],
      shapes,
      about: `The levels are eigenvalues of the Hamiltonian on a ${Math.round(values.points)}-point grid, not a formula. That is why a step in the middle still gives the right answer.`
    }
  },
  limits: [
    'One dimension, and time-independent — this finds the levels, it does not evolve a wavepacket.',
    'A finite grid, so the computed levels sit slightly above the true ones. The difference against the textbook value is shown, and it shrinks as the grid gets finer.',
    'An electron’s mass is assumed. A different particle moves every level.',
    'Eight levels at most.'
  ]
}

export const THERMAL: readonly Simulation[] = Object.freeze([idealGas as Simulation, particleInBox as Simulation])

void BOLTZMANN
void GAS_CONSTANT
void pushTrail
