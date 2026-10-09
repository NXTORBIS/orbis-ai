import { HBAR, ELECTRON_MASS, randomFrom, type Scene, type Shape, type Simulation } from './simulation.ts'

/**
 * Quantum mechanics: a wavefunction actually evolved, a barrier actually tunnelled, and a spin actually measured.
 *
 * ## The Schrödinger equation is solved, not animated
 *
 * A packet drawn as a Gaussian sliding across the screen would spread at whatever rate looked right and would
 * pass a barrier because somebody decided it should. This steps iħ ∂ψ/∂t = Ĥψ by the split-operator method, so
 * the spreading, the reflection off a barrier that is *lower* than the packet's energy, and the part that leaks
 * through one that is higher all come out of the equation.
 *
 * ## The norm is the honest check
 *
 * ∫|ψ|² must stay at one for ever. It is on screen as a readout for exactly that reason: if it moves, the step is
 * too big and nothing else on the screen can be trusted. Split-operator is unitary by construction, so it holds
 * to machine precision — and when it does not, that is the grid being too coarse for the wavelengths present.
 *
 * ## Measurement is random, and takes a seed
 *
 * The Stern-Gerlach apparatus really does choose at random. It takes a seed so a surprising run can be looked at
 * twice, which is the only way to tell an interesting outcome from a bug.
 */

// ——— A wavepacket, split-operator ——————————————————————————————————————————

interface PacketState {
  real: Float64Array
  imag: Float64Array
  potential: Float64Array
  /** How much of the wavefunction survives each step at each point. One everywhere except the two edges. */
  absorb: Float64Array
  points: number
  t: number
  /** Still inside the box. */
  remaining: number
  position: number
  spread: number
  /** Soaked up at the far edge: this got through. Counted once and kept. */
  transmitted: number
  /** Soaked up at the near edge: this came back. */
  reflected: number
}

/** The fast Fourier transform, in place. Needed because half the step is done in momentum space. */
function fft(real: Float64Array, imag: Float64Array, inverse: boolean): void {
  const n = real.length
  // Bit reversal.
  for (let one = 1, at = 0; one < n; one += 1) {
    let bit = n >> 1
    for (; at & bit; bit >>= 1) at ^= bit
    at ^= bit
    if (one < at) {
      ;[real[one], real[at]] = [real[at], real[one]]
      ;[imag[one], imag[at]] = [imag[at], imag[one]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = ((inverse ? 2 : -2) * Math.PI) / len
    const wr = Math.cos(angle)
    const wi = Math.sin(angle)
    for (let one = 0; one < n; one += len) {
      let cr = 1
      let ci = 0
      for (let two = 0; two < len / 2; two += 1) {
        const ar = real[one + two]
        const ai = imag[one + two]
        const br = real[one + two + len / 2] * cr - imag[one + two + len / 2] * ci
        const bi = real[one + two + len / 2] * ci + imag[one + two + len / 2] * cr
        real[one + two] = ar + br
        imag[one + two] = ai + bi
        real[one + two + len / 2] = ar - br
        imag[one + two + len / 2] = ai - bi
        const next = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = next
      }
    }
  }
  if (inverse) {
    for (let one = 0; one < n; one += 1) {
      real[one] /= n
      imag[one] /= n
    }
  }
}

const WIDTH = 4e-8 // 40 nm of box, which is a comfortable size for an electron packet

export const wavepacket: Simulation<PacketState> = {
  id: 'wavepacket',
  name: 'Wavepacket and tunnelling',
  section: 'quantum',
  about: "An electron's wavefunction stepped through a barrier — so what gets through is what the equation says, not what looks right.",
  controls: [
    { key: 'energy', label: 'Packet energy', unit: 'eV', least: 0.01, most: 5, step: 0.01, initial: 0.5, about: 'How fast it is going. Below the barrier height it should classically bounce — and some of it still gets through.' },
    { key: 'barrier', label: 'Barrier height', unit: 'eV', least: 0, most: 5, step: 0.01, initial: 1, about: 'Taller than the energy means tunnelling. Shorter means it mostly passes — but some still reflects, which is just as strange.' },
    { key: 'thickness', label: 'Barrier thickness', unit: 'nm', least: 0, most: 10, step: 0.1, initial: 1, about: 'What gets through falls off exponentially with this. Doubling the thickness can cost a factor of a thousand.' },
    { key: 'packetWidth', label: 'Packet width', unit: 'nm', least: 0.5, most: 8, step: 0.1, initial: 3, about: 'A narrow packet has a wide spread of momentum, by the uncertainty principle, and spreads out faster.' },
    { key: 'slowdown', label: 'Slowed down by', unit: '×', least: 1e9, most: 1e15, step: 1e9, initial: 2e13, about: 'An electron crosses 40 nm in about a hundred femtoseconds. One second here is one second divided by this much of real time, and nothing else is changed.' }
  ],
  readouts: [
    { key: 'norm', label: 'All probability accounted for', unit: '', figures: 8 },
    { key: 'remaining', label: 'Still in the box', unit: '', figures: 6 },
    { key: 'position', label: 'Where it is', unit: 'nm', figures: 4 },
    { key: 'spread', label: 'How spread out', unit: 'nm', figures: 4 },
    { key: 'transmitted', label: 'Got through', unit: '', figures: 6 },
    { key: 'reflected', label: 'Bounced back', unit: '', figures: 6 },
    { key: 'settled', label: 'Finished', unit: '' },
    { key: 'predicted', label: 'Predicted tunnelling', unit: '', figures: 6 },
    { key: 'femtoseconds', label: 'Real time gone by', unit: 'fs', figures: 4 }
  ],
  conserves: { key: 'norm', label: 'All probability accounted for' },
  suggestedStep: 0.002,
  start(values) {
    const points = 1024
    const real = new Float64Array(points)
    const imag = new Float64Array(points)
    const potential = new Float64Array(points)
    const dx = WIDTH / points

    const eV = 1.602176634e-19
    const k = Math.sqrt((2 * ELECTRON_MASS * values.energy * eV)) / HBAR
    const sigma = values.packetWidth * 1e-9
    const start = WIDTH * 0.25

    let norm = 0
    for (let one = 0; one < points; one += 1) {
      const x = one * dx
      const from = x - start
      const envelope = Math.exp(-(from * from) / (2 * sigma * sigma))
      real[one] = envelope * Math.cos(k * x)
      imag[one] = envelope * Math.sin(k * x)
      norm += (real[one] * real[one] + imag[one] * imag[one]) * dx
    }
    const scale = 1 / Math.sqrt(norm)
    for (let one = 0; one < points; one += 1) {
      real[one] *= scale
      imag[one] *= scale
    }

    const middle = WIDTH * 0.6
    const half = (values.thickness * 1e-9) / 2
    for (let one = 0; one < points; one += 1) {
      const x = one * dx
      potential[one] = Math.abs(x - middle) < half ? values.barrier * eV : 0
    }

    // The transform makes the box wrap round, so without this the reflected part leaves the left edge, reappears
    // on the right, and is counted as having got through — which made a taller barrier appear to transmit MORE.
    // These edges soak it up instead, smoothly enough not to reflect off the absorber itself.
    const absorb = new Float64Array(points)
    const edge = Math.floor(points * 0.12)
    for (let one = 0; one < points; one += 1) {
      let into = 0
      if (one < edge) into = (edge - one) / edge
      else if (one >= points - edge) into = (one - (points - edge - 1)) / edge
      absorb[one] = into === 0 ? 1 : Math.exp(-6 * into * into)
    }

    return {
      real, imag, potential, absorb, points, t: 0,
      remaining: 1, position: start, spread: sigma, transmitted: 0, reflected: 0
    }
  },
  step(state, watched, values) {
    const dt = watched / Math.max(1, values.slowdown)
    const n = state.points
    const dx = WIDTH / n

    // Split-operator: half a step of potential, a whole step of kinetic in momentum space, half of potential
    // again. Unitary by construction, which is why the norm holds rather than drifting.
    const halfStep = (): void => {
      for (let one = 0; one < n; one += 1) {
        const phase = (-state.potential[one] * (dt / 2)) / HBAR
        const c = Math.cos(phase)
        const s = Math.sin(phase)
        const r = state.real[one]
        const i = state.imag[one]
        state.real[one] = r * c - i * s
        state.imag[one] = r * s + i * c
      }
    }

    halfStep()
    fft(state.real, state.imag, false)
    for (let one = 0; one < n; one += 1) {
      // Momentum runs 0…n/2 then wraps to the negatives, which is how the transform orders it.
      const index = one <= n / 2 ? one : one - n
      const k = (2 * Math.PI * index) / WIDTH
      const phase = (-HBAR * k * k * dt) / (2 * ELECTRON_MASS)
      const c = Math.cos(phase)
      const s = Math.sin(phase)
      const r = state.real[one]
      const i = state.imag[one]
      state.real[one] = r * c - i * s
      state.imag[one] = r * s + i * c
    }
    fft(state.real, state.imag, true)
    halfStep()

    // Soak up whatever reached an edge, and book it: left is reflected, right is transmitted. Nothing is thrown
    // away — what leaves the box is still counted, which is what keeps the total at one.
    const edge = Math.floor(n * 0.12)
    for (let one = 0; one < n; one += 1) {
      const keep = state.absorb[one]
      if (keep === 1) continue
      const before = (state.real[one] * state.real[one] + state.imag[one] * state.imag[one]) * dx
      state.real[one] *= keep
      state.imag[one] *= keep
      const lost = before - (state.real[one] * state.real[one] + state.imag[one] * state.imag[one]) * dx
      if (one < edge) state.reflected += lost
      else state.transmitted += lost
    }

    state.t += dt

    // Everything worth reading, from the wavefunction itself.
    let remaining = 0
    let mean = 0
    let meanSquare = 0
    for (let one = 0; one < n; one += 1) {
      const x = one * dx
      const density = (state.real[one] * state.real[one] + state.imag[one] * state.imag[one]) * dx
      remaining += density
      mean += x * density
      meanSquare += x * x * density
    }
    state.remaining = remaining
    state.position = mean / (remaining || 1)
    state.spread = Math.sqrt(Math.max(0, meanSquare / (remaining || 1) - state.position * state.position))
  },
  read(state, values) {
    // The textbook estimate for a square barrier, for comparison with what the equation actually did.
    const eV = 1.602176634e-19
    const E = values.energy * eV
    const V = values.barrier * eV
    const L = values.thickness * 1e-9
    let predicted = 1
    if (V > E && L > 0) {
      const kappa = Math.sqrt((2 * ELECTRON_MASS * (V - E))) / HBAR
      const top = 4 * E * (V - E)
      const bottom = top + V * V * Math.sinh(kappa * L) ** 2
      predicted = top / bottom
    }
    return {
      // What is still in the box, plus everything the edges took. This is the number that must stay at one.
      norm: state.remaining + state.transmitted + state.reflected,
      remaining: state.remaining,
      // The split is only meaningful once the packet has finished crossing, so say when that is.
      settled: state.remaining < 0.02 ? 1 : 0,
      position: state.position * 1e9,
      spread: state.spread * 1e9,
      transmitted: state.transmitted,
      reflected: state.reflected,
      predicted,
      femtoseconds: state.t * 1e15
    }
  },
  paint(state, values): Scene {
    const n = state.points
    const dx = WIDTH / n
    const density: number[] = []
    let tallest = 1e-30
    for (let one = 0; one < n; one += 1) {
      const d = state.real[one] * state.real[one] + state.imag[one] * state.imag[one]
      if (d > tallest) tallest = d
    }
    for (let one = 0; one < n; one += 1) {
      const d = (state.real[one] * state.real[one] + state.imag[one] * state.imag[one]) / tallest
      density.push(one * dx * 1e9, d)
    }
    const shapes: Shape[] = [
      { kind: 'line', from: [0, 0], to: [WIDTH * 1e9, 0], width: 1, faint: true },
      { kind: 'path', points: density, width: 1.8 }
    ]
    // The barrier, drawn to scale against the packet's energy so "taller than the energy" is visible.
    if (values.barrier > 0 && values.thickness > 0) {
      const middle = WIDTH * 0.6 * 1e9
      const half = values.thickness / 2
      const height = Math.min(1, values.barrier / Math.max(values.energy, values.barrier))
      shapes.push({ kind: 'rect', at: [middle, height / 2], width: values.thickness, height, tone: 'other' })
      shapes.push({ kind: 'text', at: [middle, height + 0.06], text: `${values.barrier} eV`, size: 10, anchor: 'middle', tone: 'other' })
      const line = Math.min(1, values.energy / Math.max(values.energy, values.barrier))
      shapes.push({ kind: 'line', from: [middle - half - 6, line], to: [middle + half + 6, line], width: 1, faint: true })
      shapes.push({ kind: 'text', at: [middle + half + 6, line + 0.04], text: 'energy', size: 9, anchor: 'end', tone: 'faint' })
    }
    return {
      view: [-1, -0.15, WIDTH * 1e9 + 2, 1.4],
      shapes,
      about:
        values.barrier > values.energy
          ? `The barrier is taller than the packet's energy, so classically nothing gets through — and ${(state.transmitted * 100).toFixed(3)}% has.${state.remaining > 0.02 ? ' Still crossing.' : ''}`
          : `The barrier is lower than the packet's energy, so classically all of it passes — and ${(state.reflected * 100).toFixed(2)}% has bounced back anyway.${state.remaining > 0.02 ? ' Still crossing.' : ''}`
    }
  },
  limits: [
    'One dimension, one electron. No spin, no other particles, and nothing it could interact with.',
    'The edges soak up whatever reaches them, and what they take is counted as having got through or come back. The two figures only mean anything once "Finished" says the packet has left — before that most of it is still in the middle.',
    'A square barrier with perfectly sharp edges. A real one is smoothed and lets rather more through.',
    'The grid must be fine enough for the shortest wavelength present. Push the energy very high and the norm starts to drift, which is the readout saying so.',
    'The packet carries a spread of energies, not one. The analytic figure beside it is for a single energy exactly, so the two agree in size and trend rather than to the last figure — and that difference is real physics, not error.'
  ]
}

// ——— The harmonic oscillator, and its levels ————————————————————————————————

interface OscillatorState {
  t: number
  levels: number[]
  wavefunctions: number[][]
  classicalTurn: number
}

/** Hermite polynomials by the stable recurrence. The explicit formula overflows by about n = 20. */
function hermite(n: number, x: number): number {
  if (n === 0) return 1
  if (n === 1) return 2 * x
  let before = 1
  let now = 2 * x
  for (let one = 2; one <= n; one += 1) {
    const next = 2 * x * now - 2 * (one - 1) * before
    before = now
    now = next
  }
  return now
}

export const harmonicOscillator: Simulation<OscillatorState> = {
  id: 'harmonic-oscillator',
  name: 'Quantum harmonic oscillator',
  section: 'quantum',
  about: 'Evenly spaced levels, a ground state that cannot sit still, and probability where no classical particle could be.',
  controls: [
    { key: 'frequency', label: 'Frequency', unit: 'THz', least: 1, most: 200, step: 1, initial: 50, about: 'Sets the spacing: every level is exactly ħω above the one below, which is what makes this the model everything else is compared to.' },
    { key: 'mass', label: 'Mass', unit: 'electron masses', least: 0.1, most: 50, step: 0.1, initial: 1, about: 'Heavier means a tighter, lower state — and a smaller zero-point energy.' },
    { key: 'levels', label: 'Levels shown', unit: '', least: 1, most: 12, step: 1, initial: 5, about: 'How many to draw. The spacing never changes however high you go, unlike every real molecule.' },
    { key: 'showLevel', label: 'Level to look at', unit: '', least: 0, most: 11, step: 1, initial: 0, about: 'Which one to draw the probability for. Level zero is the ground state, and it still has energy.' }
  ],
  readouts: [
    { key: 'spacing', label: 'Level spacing', unit: 'meV', figures: 5 },
    { key: 'zeroPoint', label: 'Zero-point energy', unit: 'meV', figures: 5 },
    { key: 'thisLevel', label: 'Energy of this level', unit: 'meV', figures: 5 },
    { key: 'turningPoint', label: 'Classical turning point', unit: 'nm', figures: 5 },
    { key: 'outside', label: 'Probability past it', unit: '', figures: 6 },
    { key: 'length', label: 'Natural length', unit: 'nm', figures: 5 }
  ],
  suggestedStep: 0.02,
  start() {
    return { t: 0, levels: [], wavefunctions: [], classicalTurn: 0 }
  },
  step(state, dt, values) {
    state.t += dt
    const omega = 2 * Math.PI * values.frequency * 1e12
    const m = values.mass * ELECTRON_MASS
    const count = Math.max(1, Math.round(values.levels))
    const scale = Math.sqrt(HBAR / (m * omega))

    state.levels = []
    state.wavefunctions = []
    for (let n = 0; n < count; n += 1) {
      state.levels.push((n + 0.5) * HBAR * omega)
      const points: number[] = []
      // Normalisation by logarithms, because n! overflows well before the polynomial does.
      let logNorm = -0.5 * Math.log(Math.PI) - 0.25 * Math.log(1) - n * Math.LN2
      for (let one = 2; one <= n; one += 1) logNorm -= 0.5 * Math.log(one)
      for (let one = 0; one <= 240; one += 1) {
        const where = ((one / 240) - 0.5) * 12
        const value = Math.exp(logNorm - (where * where) / 2) * hermite(n, where)
        points.push(value)
      }
      state.wavefunctions.push(points)
    }
    const level = Math.min(count - 1, Math.max(0, Math.round(values.showLevel)))
    // Where a classical particle of this energy would have to stop: ½mω²x² = E.
    state.classicalTurn = Math.sqrt((2 * state.levels[level]) / (m * omega * omega)) / scale
  },
  read(state, values) {
    const omega = 2 * Math.PI * values.frequency * 1e12
    const m = values.mass * ELECTRON_MASS
    const count = Math.max(1, Math.round(values.levels))
    const level = Math.min(count - 1, Math.max(0, Math.round(values.showLevel)))
    const scale = Math.sqrt(HBAR / (m * omega))
    const eV = 1.602176634e-19

    // How much of the probability lies where no classical particle of that energy could ever be.
    const psi = state.wavefunctions[level] ?? []
    let total = 0
    let beyond = 0
    for (let one = 0; one < psi.length; one += 1) {
      const where = ((one / (psi.length - 1)) - 0.5) * 12
      const density = psi[one] * psi[one]
      total += density
      if (Math.abs(where) > state.classicalTurn) beyond += density
    }

    return {
      spacing: ((HBAR * omega) / eV) * 1000,
      zeroPoint: ((0.5 * HBAR * omega) / eV) * 1000,
      thisLevel: ((state.levels[level] ?? 0) / eV) * 1000,
      turningPoint: state.classicalTurn * scale * 1e9,
      outside: total > 0 ? beyond / total : 0,
      length: scale * 1e9
    }
  },
  paint(state, values): Scene {
    const count = Math.max(1, Math.round(values.levels))
    const level = Math.min(count - 1, Math.max(0, Math.round(values.showLevel)))
    const top = count + 0.5
    const shapes: Shape[] = []

    // The parabola the particle sits in, in natural units where each level is one apart.
    const well: number[] = []
    for (let one = 0; one <= 200; one += 1) {
      const where = ((one / 200) - 0.5) * 12
      well.push(where, (where * where) / 4)
    }
    shapes.push({ kind: 'path', points: well, width: 1.4, faint: true })

    for (let n = 0; n < count; n += 1) {
      const energy = n + 0.5
      const turn = Math.sqrt(4 * energy)
      shapes.push({
        kind: 'line',
        from: [-turn, energy],
        to: [turn, energy],
        width: n === level ? 2 : 1,
        faint: n !== level,
        tone: n === level ? 'other' : undefined
      })
      shapes.push({ kind: 'text', at: [-6.2, energy], text: `n=${n}`, size: 9, tone: n === level ? 'other' : 'faint' })
    }

    // The probability for the chosen level, drawn on its own line.
    const psi = state.wavefunctions[level] ?? []
    if (psi.length > 0) {
      let tallest = 1e-12
      for (const one of psi) tallest = Math.max(tallest, one * one)
      const curve: number[] = []
      for (let one = 0; one < psi.length; one += 1) {
        const where = ((one / (psi.length - 1)) - 0.5) * 12
        curve.push(where, level + 0.5 + ((psi[one] * psi[one]) / tallest) * 0.8)
      }
      shapes.push({ kind: 'path', points: curve, width: 1.8 })
      // The turning points, so the probability beyond them is visibly beyond them.
      shapes.push({ kind: 'line', from: [state.classicalTurn, level + 0.5], to: [state.classicalTurn, level + 1.4], width: 1, faint: true, tone: 'other' })
      shapes.push({ kind: 'line', from: [-state.classicalTurn, level + 0.5], to: [-state.classicalTurn, level + 1.4], width: 1, faint: true, tone: 'other' })
    }

    return {
      view: [-7, -0.4, 14, top + 1.2],
      shapes,
      about: `Level ${level} at ${(level + 0.5).toFixed(1)}ħω. The marked lines are where a classical particle of this energy would have to stop — and the probability does not stop there.`
    }
  },
  limits: [
    'A perfect parabola. Every real bond flattens out at large separation and eventually breaks, so the levels crowd together rather than staying evenly spaced.',
    'One dimension. A real vibration in three has levels that coincide, and that degeneracy matters for how many states there are.',
    'Stationary states, so nothing moves. A superposition of two of them would oscillate, and that is not shown.',
    'The wavefunctions are drawn in natural units of length; the readouts convert to nanometres.'
  ]
}

// ——— Spin, and measuring it ————————————————————————————————————————————————

interface SpinState {
  t: number
  random: () => number
  up: number
  down: number
  runs: number
  lastAngle: number
  history: number[]
}

export const sternGerlach: Simulation<SpinState> = {
  id: 'stern-gerlach',
  name: 'Measuring a spin',
  section: 'quantum',
  about: 'Spins sent through a magnet at an angle — two outcomes only, in the proportions the state says, and never anything between.',
  controls: [
    { key: 'angle', label: 'Angle between preparing and measuring', unit: '°', least: 0, most: 180, step: 1, initial: 60, about: 'At 0° every spin comes out up. At 90° it is exactly half and half. In between it is cos²(θ/2), and never a partial result.' },
    { key: 'rate', label: 'Spins per second', unit: '', least: 1, most: 500, step: 1, initial: 60, about: 'How fast they are fired through.' },
    { key: 'seed', label: 'Seed', unit: '', least: 1, most: 9999, step: 1, initial: 1, about: 'Measurement really is random. The same seed repeats the same run exactly, so a surprising result can be looked at twice.' },
    { key: 'thirdMagnet', label: 'Measure again at 90°', unit: '', least: 0, most: 1, step: 1, initial: 0, about: 'Take the ups, measure sideways, and measure up-down again. Half come out down — the first measurement has been undone, which no classical property does.' }
  ],
  readouts: [
    { key: 'up', label: 'Came out up', unit: '' },
    { key: 'down', label: 'Came out down', unit: '' },
    { key: 'fraction', label: 'Fraction up', unit: '', figures: 5 },
    { key: 'predicted', label: 'Predicted fraction', unit: '', figures: 5 },
    { key: 'off', label: 'Off by', unit: '', figures: 5 },
    { key: 'runs', label: 'Spins sent', unit: '' }
  ],
  suggestedStep: 0.01,
  start(values) {
    return { t: 0, random: randomFrom(values.seed), up: 0, down: 0, runs: 0, lastAngle: 0, history: [] }
  },
  step(state, dt, values) {
    state.t += dt
    const due = Math.floor(state.t * values.rate) - state.runs
    const chance = Math.cos((values.angle * Math.PI) / 360) ** 2

    for (let one = 0; one < due && one < 50; one += 1) {
      let isUp = state.random() < chance
      if (Math.round(values.thirdMagnet) === 1 && isUp) {
        // Sideways, then up-down again. The sideways measurement destroys what the first one established.
        const sideways = state.random() < 0.5
        void sideways
        isUp = state.random() < 0.5
      }
      if (isUp) state.up += 1
      else state.down += 1
      state.runs += 1
      state.history.push(isUp ? 1 : 0)
      if (state.history.length > 400) state.history.shift()
    }
  },
  read(state, values) {
    const total = state.up + state.down
    const fraction = total > 0 ? state.up / total : 0
    const base = Math.cos((values.angle * Math.PI) / 360) ** 2
    const predicted = Math.round(values.thirdMagnet) === 1 ? base * 0.5 : base
    return {
      up: state.up,
      down: state.down,
      fraction,
      predicted,
      off: Math.abs(fraction - predicted),
      runs: total
    }
  },
  paint(state, values): Scene {
    const total = state.up + state.down
    const fraction = total > 0 ? state.up / total : 0
    const base = Math.cos((values.angle * Math.PI) / 360) ** 2
    const predicted = Math.round(values.thirdMagnet) === 1 ? base * 0.5 : base

    const shapes: Shape[] = [
      // The two bars: what came out, against what should.
      { kind: 'rect', at: [0, fraction / 2], width: 0.5, height: Math.max(0.001, fraction), fill: true },
      { kind: 'text', at: [0, -0.08], text: 'up', size: 11, anchor: 'middle' },
      { kind: 'text', at: [0, fraction + 0.05], text: fraction.toFixed(4), size: 10, anchor: 'middle' },
      { kind: 'rect', at: [0.8, (1 - fraction) / 2], width: 0.5, height: Math.max(0.001, 1 - fraction), fill: true, tone: 'other' },
      { kind: 'text', at: [0.8, -0.08], text: 'down', size: 11, anchor: 'middle' },
      { kind: 'text', at: [0.8, 1 - fraction + 0.05], text: (1 - fraction).toFixed(4), size: 10, anchor: 'middle', tone: 'other' },
      // The prediction, as a line across.
      { kind: 'line', from: [-0.35, predicted], to: [1.15, predicted], width: 1.5, faint: true },
      { kind: 'text', at: [1.2, predicted], text: `predicted ${predicted.toFixed(4)}`, size: 10, tone: 'faint' }
    ]
    // The last few outcomes, so the randomness is visible as randomness.
    state.history.slice(-60).forEach((one, at) => {
      shapes.push({ kind: 'rect', at: [-0.3 + at * 0.045, one === 1 ? 1.25 : 1.15], width: 0.035, height: 0.07, fill: true, tone: one === 1 ? undefined : 'other' })
    })

    return {
      view: [-0.6, -0.2, 3.2, 1.75],
      shapes,
      about:
        Math.round(values.thirdMagnet) === 1
          ? 'Up, then sideways, then up again: half come out down. The sideways measurement has erased what the first one established, which no classical property would do.'
          : `cos²(${values.angle}°/2) = ${base.toFixed(4)}. Every single spin comes out fully up or fully down — never ${(base * 100).toFixed(0)}% of the way.`
    }
  },
  limits: [
    'Ideal measurements: perfectly aligned magnets, no losses, nothing missed.',
    'Spin one-half only, so always exactly two outcomes. Higher spins give more.',
    'The randomness is a pseudo-random generator, which is not the same thing as quantum randomness — it is repeatable on purpose, so that a run can be checked.',
    'This shows the statistics, not the mechanism. Nothing here settles what measurement actually is.'
  ]
}

export const QUANTUM: readonly Simulation[] = Object.freeze([
  wavepacket as Simulation,
  harmonicOscillator as Simulation,
  sternGerlach as Simulation
])
