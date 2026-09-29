/**
 * Quantum mechanics: bound states, tunnelling, uncertainty and measurement.
 *
 * The shared quantum engine for Orbis Pages. Energy levels are computed from the solved problems they belong to,
 * wavefunctions are normalised and the normalisation is checked, and a measurement returns probabilities rather
 * than an outcome — because the theory gives probabilities and nothing here will invent a result.
 *
 * ## Why a measurement returns probabilities and never an outcome
 *
 * The state before a measurement determines the probability of each result and nothing more. A Page showing "the
 * electron was found in the upper level" has invented data; a Page showing "63% upper, 37% lower" has shown what the
 * theory actually says. Where a Page wants a simulated run it must supply its own random draw, so it is visible that
 * a draw happened.
 *
 * ## Why the uncertainty principle is a floor and not an instrument limit
 *
 * Position and momentum uncertainty multiply to at least ħ/2. That is a property of the state, not of the apparatus:
 * a perfect instrument does not get past it, and a state with a definite position has no definite momentum at all.
 * Every uncertainty result says which side of that floor it sits on.
 *
 * ## The distinctions this file refuses to blur
 *
 * ```
 * wavefunction    vs  probability     -- an amplitude that can cancel against a positive number that cannot
 * superposition   vs  mixture         -- one state in two components against not knowing which of two states
 * measurement     vs  observation     -- an interaction that changes the state against a person looking
 * eigenstate      vs  expectation     -- a definite value against an average over many runs
 * orbital         vs  orbit           -- a probability cloud against a path
 * tunnelling      vs  going over      -- passing through a barrier against having enough energy to clear it
 * ```
 *
 * Pure. No network, no clock, no storage. Nothing here draws a random number; a Page that wants a simulated
 * measurement supplies its own.
 */

import {
  REDUCED_PLANCK,
  PLANCK_CONSTANT,
  ELECTRON_MASS,
  PROTON_MASS,
  NEUTRON_MASS,
  ELECTRON_VOLT,
  SPEED_OF_LIGHT,
  BOHR_RADIUS_VALUE,
  RYDBERG_CONSTANT,
  FINE_STRUCTURE_CONSTANT
} from './emConstants.ts'

export interface QuantumError {
  error: 'invalid-argument' | 'not-finite' | 'out-of-range' | 'not-normalised' | 'no-solution' | 'too-many' | 'outside-model'
  message: string
}

export const isQuantumError = (value: unknown): value is QuantumError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: QuantumError['error'], message: string): QuantumError => ({ error, message })

const finite = (value: number): boolean => Number.isFinite(value)

export const QUANTUM_LIMITS = Object.freeze({ levels: 500, samples: 4000, components: 256 })

const massOf = (particle: 'electron' | 'proton' | 'neutron'): number =>
  particle === 'electron' ? ELECTRON_MASS : particle === 'proton' ? PROTON_MASS : NEUTRON_MASS

// ---------------------------------------------------------------- particle in a box

export interface BoxReport {
  /** Metres. */
  width: number
  /** Joules and eV for each level. */
  levels: readonly {
    n: number
    energy: number
    energyElectronVolts: number
    /** Metres. The de Broglie wavelength of this state. */
    wavelength: number
    /** How many places the wavefunction is exactly zero inside the box. */
    nodes: number
  }[]
  /** Joules. The ground state, which cannot be zero — that is the zero-point energy. */
  groundStateEnergy: number
  groundStateElectronVolts: number
  /** eV. The gap between the first two levels, which is what a spectrum would show. */
  firstGap: number
  /** Metres and nanometres. The photon that would make the first transition. */
  firstTransitionWavelength: number
  /** The probability density of a chosen level, for drawing. */
  density: readonly { position: number; amplitude: number; probability: number }[]
  /** How the level spacing grows, which is what makes a box different from an atom. */
  spacingGrowth: string
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * A particle confined to a box: the simplest problem with quantised energies, and the one everything else is
 * compared against.
 *
 * The ground state energy is not zero and cannot be made zero, which is the first genuinely quantum result anybody
 * meets. Confining a particle costs energy — squeeze the box and the energy rises as one over the width squared —
 * and that is why an atom does not collapse and why a small quantum dot glows a different colour from a large one.
 *
 * Level spacing grows here, as n². In a hydrogen atom it shrinks, as 1/n². The two problems are opposite in that
 * respect and it is worth knowing which you are looking at.
 */
export function particleInBox(input: {
  /** Metres. */
  width: number
  /** kg, or a named particle. */
  mass?: number
  particle?: 'electron' | 'proton' | 'neutron'
  /** How many levels to report. */
  levels?: number
  /** Which level to sample the probability density of. */
  densityFor?: number
  samples?: number
}): BoxReport | QuantumError {
  const { width } = input
  if (!finite(width) || width <= 0) return fail('invalid-argument', 'The box width has to be greater than zero metres.')

  const mass = input.particle !== undefined ? massOf(input.particle) : input.mass
  if (mass === undefined) return fail('invalid-argument', 'Give a mass in kilograms, or name a particle: electron, proton or neutron.')
  if (!finite(mass) || mass <= 0) return fail('invalid-argument', 'The mass has to be greater than zero.')

  const count = Math.round(input.levels ?? 5)
  if (!Number.isInteger(count) || count < 1 || count > QUANTUM_LIMITS.levels) {
    return fail('invalid-argument', `The level count has to be between 1 and ${QUANTUM_LIMITS.levels}.`)
  }

  // E_n = n^2 h^2 / (8 m L^2). The n = 0 state does not exist, which is the whole point.
  const energyOf = (n: number): number => (n * n * PLANCK_CONSTANT * PLANCK_CONSTANT) / (8 * mass * width * width)

  const levels = Array.from({ length: count }, (_, i) => {
    const n = i + 1
    const energy = energyOf(n)
    return {
      n,
      energy,
      energyElectronVolts: energy / ELECTRON_VOLT,
      wavelength: (2 * width) / n,
      nodes: n - 1
    }
  })

  const which = Math.round(input.densityFor ?? 1)
  if (!Number.isInteger(which) || which < 1) return fail('invalid-argument', 'The level to sample is a whole number of at least 1.')
  const samples = Math.round(input.samples ?? 200)
  if (!Number.isInteger(samples) || samples < 2 || samples > QUANTUM_LIMITS.samples) {
    return fail('invalid-argument', `The sample count has to be between 2 and ${QUANTUM_LIMITS.samples}.`)
  }

  // The normalised wavefunction: sqrt(2/L) sin(n pi x / L).
  const normalisation = Math.sqrt(2 / width)
  const density: BoxReport['density'][number][] = []
  let integral = 0
  for (let i = 0; i < samples; i += 1) {
    const position = (width * i) / (samples - 1)
    const amplitude = normalisation * Math.sin((which * Math.PI * position) / width)
    const probability = amplitude * amplitude
    if (i > 0) {
      const previous = density[i - 1].probability
      integral += ((probability + previous) / 2) * (width / (samples - 1))
    }
    density.push({ position, amplitude, probability })
  }

  const warnings: string[] = []
  if (Math.abs(integral - 1) > 0.01) {
    warnings.push(
      `The sampled probability density integrates to ${integral.toFixed(4)} rather than 1. The wavefunction is normalised exactly; this is the sampling being coarse, so add more samples before reading anything off the curve.`
    )
  }
  const groundEv = levels[0].energyElectronVolts
  if (groundEv < 1e-6) {
    warnings.push(
      `The ground state is ${groundEv.toExponential(2)} eV, far below kT at any temperature you would work at. A box this large barely confines anything and the levels are effectively continuous — which is why a free electron in a wire has no visible quantisation.`
    )
  }

  return {
    width,
    levels: Object.freeze(levels),
    groundStateEnergy: levels[0].energy,
    groundStateElectronVolts: groundEv,
    firstGap: count > 1 ? levels[1].energyElectronVolts - levels[0].energyElectronVolts : 0,
    firstTransitionWavelength:
      count > 1 ? (PLANCK_CONSTANT * SPEED_OF_LIGHT) / (levels[1].energy - levels[0].energy) : Number.POSITIVE_INFINITY,
    density: Object.freeze(density),
    spacingGrowth: 'Energy goes as n squared, so the levels spread out as you go up. In an atom they go as 1/n squared and crowd together — the two problems are opposite in that respect.',
    notes: Object.freeze([
      `Ground state ${groundEv.toExponential(5)} eV in a ${(width * 1e9).toFixed(4)} nm box.`,
      'The ground state energy is not zero and cannot be made zero. Confining a particle costs energy, and the cost rises as one over the width squared — halve the box and the energy quadruples.',
      `Level n has ${which - 1 >= 0 ? 'n - 1' : ''} nodes inside the box, so the ground state has none. A node is a place the particle is never found, and a state with more nodes has more curvature and therefore more energy.`,
      'This model has infinitely high walls, so there is no tunnelling and no escape. A real well has finite walls, fewer bound states, and a wavefunction that leaks outside.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- harmonic oscillator

export interface OscillatorReport {
  /** rad/s. */
  angularFrequency: number
  /** Hz. */
  frequency: number
  /** Joules. The gap between every pair of adjacent levels, which is the same all the way up. */
  levelSpacing: number
  levelSpacingElectronVolts: number
  /** Joules. Half a quantum, and it cannot be removed. */
  zeroPointEnergy: number
  levels: readonly { n: number; energy: number; energyElectronVolts: number; classicalTurningPoint: number }[]
  /** Metres. The spread of the ground state. */
  groundStateWidth: number
  /** The chance of finding the particle outside its classical limits, which is not zero. */
  tunnellingFraction: number
  /** Kelvin. Above this the oscillator behaves classically. */
  characteristicTemperature: number
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * The quantum harmonic oscillator: equally spaced levels, and a ground state that cannot be still.
 *
 * Every bond, every phonon and every mode of a field is one of these to a good approximation, which is why it is the
 * most useful solved problem in physics. Two facts are worth having: the levels are equally spaced, unlike a box or
 * an atom, and the lowest one sits half a quantum above the bottom of the well — so the oscillator never stops, even
 * at absolute zero.
 *
 * Some of the probability lies outside the classical turning points, where a classical oscillator could not be at
 * all. That is tunnelling in a bound state, and it is about 16% in the ground state.
 */
export function harmonicOscillator(input: {
  /** rad/s, or give a frequency, or a spring constant with a mass. */
  angularFrequency?: number
  frequency?: number
  springConstant?: number
  /** kg, or a named particle. */
  mass?: number
  particle?: 'electron' | 'proton' | 'neutron'
  levels?: number
}): OscillatorReport | QuantumError {
  const mass = input.particle !== undefined ? massOf(input.particle) : input.mass
  if (mass === undefined) return fail('invalid-argument', 'Give a mass in kilograms, or name a particle.')
  if (!finite(mass) || mass <= 0) return fail('invalid-argument', 'The mass has to be greater than zero.')

  let omega: number
  if (input.angularFrequency !== undefined) omega = input.angularFrequency
  else if (input.frequency !== undefined) omega = 2 * Math.PI * input.frequency
  else if (input.springConstant !== undefined) {
    if (!finite(input.springConstant) || input.springConstant <= 0) return fail('invalid-argument', 'The spring constant has to be greater than zero.')
    omega = Math.sqrt(input.springConstant / mass)
  } else {
    return fail('invalid-argument', 'Give an angular frequency, a frequency, or a spring constant.')
  }
  if (!finite(omega) || omega <= 0) return fail('invalid-argument', 'The angular frequency has to be greater than zero.')

  const count = Math.round(input.levels ?? 5)
  if (!Number.isInteger(count) || count < 1 || count > QUANTUM_LIMITS.levels) {
    return fail('invalid-argument', `The level count has to be between 1 and ${QUANTUM_LIMITS.levels}.`)
  }

  const spacing = REDUCED_PLANCK * omega
  const zeroPoint = spacing / 2
  const levels = Array.from({ length: count }, (_, i) => {
    const n = i
    const energy = (n + 0.5) * spacing
    // Where a classical oscillator of this energy would turn round.
    const turning = Math.sqrt((2 * energy) / (mass * omega * omega))
    return { n, energy, energyElectronVolts: energy / ELECTRON_VOLT, classicalTurningPoint: turning }
  })

  const groundWidth = Math.sqrt(REDUCED_PLANCK / (mass * omega))
  // The exact ground-state probability outside the classical turning points: erfc(1) = 0.1573.
  const tunnellingFraction = 0.157299

  const characteristicTemperature = spacing / 1.380649e-23

  const warnings: string[] = []
  if (characteristicTemperature > 1000) {
    warnings.push(
      `The characteristic temperature is ${characteristicTemperature.toFixed(0)} K, so at room temperature this oscillator is almost entirely in its ground state and contributes nothing to the heat capacity. That is why molecular vibrations are invisible thermally until things get hot.`
    )
  }

  return {
    angularFrequency: omega,
    frequency: omega / (2 * Math.PI),
    levelSpacing: spacing,
    levelSpacingElectronVolts: spacing / ELECTRON_VOLT,
    zeroPointEnergy: zeroPoint,
    levels: Object.freeze(levels),
    groundStateWidth: groundWidth,
    tunnellingFraction,
    characteristicTemperature,
    notes: Object.freeze([
      `Levels are ${(spacing / ELECTRON_VOLT).toExponential(5)} eV apart, equally spaced all the way up, with a zero-point energy of ${(zeroPoint / ELECTRON_VOLT).toExponential(5)} eV.`,
      'Equal spacing is what makes this different from a box, where the levels spread out, and from an atom, where they crowd together. A spectrum of equally spaced lines is the signature of an oscillator.',
      `The ground state cannot be still. It sits half a quantum above the bottom of the well and has a spread of ${(groundWidth * 1e12).toFixed(4)} pm even at absolute zero, which is why helium stays liquid down to zero and why zero-point energy is measurable.`,
      `About ${(tunnellingFraction * 100).toFixed(1)}% of the ground-state probability lies outside the classical turning points, where a classical oscillator of that energy simply could not be.`
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- hydrogen

export interface HydrogenReport {
  /** eV, negative because the electron is bound. */
  levels: readonly {
    n: number
    energy: number
    /** Metres. The most likely radius for this level. */
    radius: number
    /** How many states share this energy, counting spin. */
    degeneracy: number
    /** The orbital shapes available at this level. */
    orbitals: readonly string[]
  }[]
  /** eV. The energy to remove the electron from the ground state. */
  ionisationEnergy: number
  /** The transition asked about, when one was. */
  transition: {
    from: number
    to: number
    energyElectronVolts: number
    wavelength: number
    wavelengthNanometres: number
    series: string
    visible: boolean
  } | null
  /** The named series a transition belongs to. */
  series: readonly { name: string; endsAt: number; band: string; limitNanometres: number }[]
  /** Metres. */
  bohrRadius: number
  /** The nuclear charge used, since this scales with Z². */
  atomicNumber: number
  notes: readonly string[]
  warnings: readonly string[]
}

const HYDROGEN_SERIES: readonly { name: string; endsAt: number; band: string }[] = Object.freeze([
  { name: 'Lyman', endsAt: 1, band: 'ultraviolet' },
  { name: 'Balmer', endsAt: 2, band: 'visible and near ultraviolet' },
  { name: 'Paschen', endsAt: 3, band: 'infrared' },
  { name: 'Brackett', endsAt: 4, band: 'infrared' },
  { name: 'Pfund', endsAt: 5, band: 'far infrared' }
])

/**
 * Hydrogen energy levels and transitions, from the Bohr formula.
 *
 * The level spacing shrinks as 1/n², which is the opposite of a box and is why the hydrogen spectrum has lines that
 * crowd together toward a series limit rather than spreading out. Every series is named and the visible one — Balmer
 * — is the reason hydrogen has a recognisable pink glow.
 *
 * This is the non-relativistic Bohr model with a point nucleus. It gets the level energies right to about one part in
 * 10⁵ and it says nothing about fine structure, the Lamb shift or hyperfine splitting, all of which are measurable.
 * Those limits are stated rather than left to be discovered.
 */
export function hydrogen(input: {
  /** 1 for hydrogen, 2 for singly ionised helium, and so on. */
  atomicNumber?: number
  levels?: number
  /** A transition to work out, as two level numbers. */
  from?: number
  to?: number
}): HydrogenReport | QuantumError {
  const z = Math.round(input.atomicNumber ?? 1)
  if (!Number.isInteger(z) || z < 1) return fail('invalid-argument', 'The atomic number is a whole number of at least 1.')
  if (z > 30) {
    return fail(
      'outside-model',
      `At Z = ${z} the inner electron is moving at a noticeable fraction of light speed and the Bohr model stops being usable. It is a one-electron model and even for a real atom that heavy the relativistic corrections are large.`
    )
  }

  const count = Math.round(input.levels ?? 6)
  if (!Number.isInteger(count) || count < 1 || count > QUANTUM_LIMITS.levels) {
    return fail('invalid-argument', `The level count has to be between 1 and ${QUANTUM_LIMITS.levels}.`)
  }

  // The Rydberg energy: 13.6057 eV, from the Rydberg constant.
  const rydbergEnergy = (RYDBERG_CONSTANT * PLANCK_CONSTANT * SPEED_OF_LIGHT) / ELECTRON_VOLT
  const energyOf = (n: number): number => (-rydbergEnergy * z * z) / (n * n)

  const shellNames = ['s', 'p', 'd', 'f', 'g', 'h']
  const levels = Array.from({ length: count }, (_, i) => {
    const n = i + 1
    return {
      n,
      energy: energyOf(n),
      radius: (n * n * BOHR_RADIUS_VALUE) / z,
      // 2n² counting spin, which is where the periodic table's row lengths come from.
      degeneracy: 2 * n * n,
      orbitals: Object.freeze(Array.from({ length: Math.min(n, shellNames.length) }, (_, l) => `${n}${shellNames[l]}`))
    }
  })

  let transition: HydrogenReport['transition'] = null
  const warnings: string[] = []
  if (input.from !== undefined || input.to !== undefined) {
    const from = Math.round(input.from ?? 0)
    const to = Math.round(input.to ?? 0)
    if (!Number.isInteger(from) || from < 1 || !Number.isInteger(to) || to < 1) {
      return fail('invalid-argument', 'A transition needs two level numbers, each a whole number of at least 1.')
    }
    if (from === to) {
      return fail('invalid-argument', 'The two levels are the same, so there is no transition and no photon.')
    }
    const energy = Math.abs(energyOf(from) - energyOf(to))
    const wavelength = (PLANCK_CONSTANT * SPEED_OF_LIGHT) / (energy * ELECTRON_VOLT)
    const lower = Math.min(from, to)
    const named = HYDROGEN_SERIES.find((one) => one.endsAt === lower)
    transition = {
      from,
      to,
      energyElectronVolts: energy,
      wavelength,
      wavelengthNanometres: wavelength * 1e9,
      series: named?.name ?? `series ending at n = ${lower}`,
      visible: wavelength >= 380e-9 && wavelength <= 750e-9
    }
    if (from < to) {
      warnings.push(
        `This is an absorption, not an emission: the electron goes from n = ${from} up to n = ${to}, which takes a photon in rather than giving one out. The energy is the same either way; the direction is not.`
      )
    }
  }

  return {
    levels: Object.freeze(levels),
    ionisationEnergy: rydbergEnergy * z * z,
    transition,
    series: Object.freeze(
      HYDROGEN_SERIES.map((one) => ({
        name: one.name,
        endsAt: one.endsAt,
        band: one.band,
        limitNanometres: ((PLANCK_CONSTANT * SPEED_OF_LIGHT) / (Math.abs(energyOf(one.endsAt)) * ELECTRON_VOLT)) * 1e9
      }))
    ),
    bohrRadius: BOHR_RADIUS_VALUE / z,
    atomicNumber: z,
    notes: Object.freeze([
      `Ground state ${energyOf(1).toFixed(4)} eV, so it takes ${(rydbergEnergy * z * z).toFixed(4)} eV to remove the electron.`,
      'Energies go as -1/n squared, so the levels crowd together upward and the spectral lines converge on a series limit. A box does the opposite, and telling the two apart from a spectrum is straightforward once you know.',
      `Each level holds 2n squared states counting spin: 2, 8, 18, 32. Those are the row lengths of the periodic table, and they come from this counting and nothing else.`,
      `This is the non-relativistic Bohr model with a point nucleus and one electron. It gets level energies right to about one part in 100000 and says nothing about fine structure, the Lamb shift or hyperfine splitting — all of which are measurable and all of which it misses. The fine-structure constant is ${FINE_STRUCTURE_CONSTANT.toExponential(6)}, and corrections go as its square.`
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- tunnelling

export interface TunnellingReport {
  /** The chance of getting through. */
  transmission: number
  /** The chance of bouncing back. These add to 1. */
  reflection: number
  /** 1/m. How fast the wavefunction dies inside the barrier. */
  decayConstant: number
  /** Metres. The distance over which the amplitude falls by e. */
  penetrationDepth: number
  /** How thick the barrier is in penetration depths. */
  barriersDeep: number
  /** Whether the particle has enough energy to go over rather than through. */
  overTheTop: boolean
  /** How much the transmission changes if the barrier gets one percent thicker — tunnelling is exponentially sensitive. */
  sensitivityToThickness: number
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Quantum tunnelling through a rectangular barrier, with the exponential sensitivity made visible.
 *
 * That sensitivity is the practically important fact. Transmission falls exponentially with barrier thickness, so a
 * barrier one atom thicker cuts the current by roughly a factor of ten — which is exactly why a scanning tunnelling
 * microscope can see individual atoms, and why the same dependence makes tunnelling devices hard to manufacture
 * consistently.
 *
 * Above the barrier the particle does not simply pass: there is still reflection, from the discontinuity rather than
 * from any lack of energy. That case is handled separately rather than returning a transmission of 1.
 */
export function tunnelling(input: {
  /** eV. */
  particleEnergy: number
  barrierHeight: number
  /** Metres. */
  barrierWidth: number
  /** kg, or a named particle. */
  mass?: number
  particle?: 'electron' | 'proton' | 'neutron'
}): TunnellingReport | QuantumError {
  const { particleEnergy, barrierHeight, barrierWidth } = input
  for (const [name, value] of [['particleEnergy', particleEnergy], ['barrierHeight', barrierHeight]] as const) {
    if (!finite(value)) return fail('not-finite', `"${name}" has to be a finite number.`)
    if (value <= 0) return fail('invalid-argument', `"${name}" has to be greater than zero electronvolts.`)
  }
  if (!finite(barrierWidth) || barrierWidth <= 0) return fail('invalid-argument', 'The barrier width has to be greater than zero metres.')

  const mass = input.particle !== undefined ? massOf(input.particle) : input.mass
  if (mass === undefined) return fail('invalid-argument', 'Give a mass in kilograms, or name a particle.')
  if (!finite(mass) || mass <= 0) return fail('invalid-argument', 'The mass has to be greater than zero.')

  const e = particleEnergy * ELECTRON_VOLT
  const v = barrierHeight * ELECTRON_VOLT
  const warnings: string[] = []

  let transmission: number
  let kappa: number

  if (particleEnergy >= barrierHeight) {
    // Over the barrier, where there is still reflection from the step.
    const k1 = Math.sqrt((2 * mass * e) / (REDUCED_PLANCK * REDUCED_PLANCK))
    const k2 = Math.sqrt((2 * mass * (e - v)) / (REDUCED_PLANCK * REDUCED_PLANCK))
    if (k2 === 0) {
      transmission = 0
      kappa = 0
      warnings.push('The energy exactly equals the barrier height, where the wavefunction inside is linear rather than exponential. Transmission is a limiting case here and this reports zero rather than a misleading number.')
    } else {
      const sin = Math.sin(k2 * barrierWidth)
      transmission = 1 / (1 + (Math.pow(k1 * k1 - k2 * k2, 2) / (4 * k1 * k1 * k2 * k2)) * sin * sin)
      kappa = 0
      warnings.push(
        `The particle has ${(particleEnergy - barrierHeight).toFixed(4)} eV more than the barrier and still has a ${((1 - transmission) * 100).toFixed(2)}% chance of bouncing back. That reflection comes from the discontinuity in the potential, not from any shortage of energy — a classical particle would pass every time.`
      )
    }
  } else {
    kappa = Math.sqrt((2 * mass * (v - e)) / (REDUCED_PLANCK * REDUCED_PLANCK))
    const kl = kappa * barrierWidth
    if (kl > 350) {
      // Past this the sinh overflows; the exponential form is both accurate and finite.
      transmission = 16 * (e / v) * (1 - e / v) * Math.exp(-2 * kl)
      if (transmission < 1e-300) transmission = 0
    } else {
      const sinh = Math.sinh(kl)
      transmission = 1 / (1 + (v * v * sinh * sinh) / (4 * e * (v - e)))
    }
  }

  const penetrationDepth = kappa === 0 ? Number.POSITIVE_INFINITY : 1 / kappa
  const barriersDeep = kappa === 0 ? 0 : kappa * barrierWidth

  // How sensitive this is to thickness: the derivative of ln T with respect to width, as a percentage per percent.
  const sensitivity = kappa === 0 ? 0 : -2 * kappa * barrierWidth

  if (transmission === 0 && particleEnergy < barrierHeight) {
    warnings.push(
      `The transmission underflowed to zero: the barrier is ${barriersDeep.toFixed(1)} penetration depths thick, so the probability is below 1e-300. It is not exactly zero in the theory and it is zero for any purpose.`
    )
  }
  if (Math.abs(sensitivity) > 5) {
    warnings.push(
      `Making the barrier 1% thicker multiplies the transmission by about ${Math.exp(sensitivity * 0.01).toFixed(4)}. That exponential sensitivity is why a scanning tunnelling microscope resolves single atoms, and why tunnelling devices are hard to make twice the same.`
    )
  }

  return {
    transmission,
    reflection: 1 - transmission,
    decayConstant: kappa,
    penetrationDepth,
    barriersDeep,
    overTheTop: particleEnergy >= barrierHeight,
    sensitivityToThickness: sensitivity,
    notes: Object.freeze([
      `A ${particleEnergy} eV particle meeting a ${barrierHeight} eV barrier ${(barrierWidth * 1e9).toFixed(4)} nm thick gets through ${(transmission * 100).toExponential(4)}% of the time.`,
      particleEnergy < barrierHeight
        ? `Inside the barrier the wavefunction falls with a penetration depth of ${(penetrationDepth * 1e12).toFixed(3)} pm, and the barrier is ${barriersDeep.toFixed(2)} of those thick.`
        : 'The particle has more energy than the barrier, so this is transmission over the top with partial reflection rather than tunnelling.',
      'Transmission falls exponentially with thickness and with the square root of the mass, which is why electrons tunnel readily, protons barely, and anything larger not at all.',
      'This is a rectangular barrier, which is a model. A real barrier has a shape, and the WKB approximation integrates over it — the answer can differ by orders of magnitude.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- uncertainty

export interface UncertaintyReport {
  /** The product of the two uncertainties. */
  product: number
  /** The floor it cannot go below. */
  floor: number
  /** How many times the floor this state sits at. 1 is the minimum, reached only by a Gaussian. */
  timesTheFloor: number
  /** Whether the state is possible at all. */
  possible: boolean
  /** The smallest the other uncertainty can be, given one of them. */
  minimumOther: number | null
  /** What the pair is, so the floor is the right one. */
  pair: string
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * The uncertainty principle as a floor on a product, with a state below it refused.
 *
 * This is a property of the state and not of the apparatus. A perfect instrument does not get past the floor, because
 * there is nothing there to measure: a state with a definite position does not have a momentum that the measurement
 * fails to find, it has no definite momentum at all. A pair of uncertainties whose product is below ħ/2 describes no
 * state, and this refuses rather than reporting it.
 *
 * Only a Gaussian reaches the floor exactly. Everything else sits above it, and how far above is a real property of
 * the state worth knowing.
 */
export function uncertainty(input: {
  pair?: 'position-momentum' | 'energy-time'
  /** Metres for position, joules for energy. */
  first?: number
  /** kg·m/s for momentum, seconds for time. */
  second?: number
}): UncertaintyReport | QuantumError {
  const pair = input.pair ?? 'position-momentum'
  if (pair !== 'position-momentum' && pair !== 'energy-time') {
    return fail('invalid-argument', 'The pair is either position-momentum or energy-time.')
  }
  const floor = REDUCED_PLANCK / 2

  const label =
    pair === 'position-momentum'
      ? 'position in metres against momentum in kg*m/s'
      : 'energy in joules against time in seconds'

  if (input.first === undefined && input.second === undefined) {
    return fail('invalid-argument', `Give one or both of the pair: ${label}.`)
  }
  for (const [name, value] of [['first', input.first], ['second', input.second]] as const) {
    if (value === undefined) continue
    if (!finite(value)) return fail('not-finite', `"${name}" has to be a finite number.`)
    if (value <= 0) {
      return fail(
        'invalid-argument',
        `"${name}" is ${value}. An uncertainty of exactly zero would make the other one infinite, which describes no physical state — a perfectly localised particle has no momentum at all rather than an unknown one.`
      )
    }
  }

  if (input.first !== undefined && input.second !== undefined) {
    const product = input.first * input.second
    if (product < floor * (1 - 1e-12)) {
      return fail(
        'not-normalised',
        `The product is ${product.toExponential(4)}, below the floor of ${floor.toExponential(4)}. No state has both uncertainties that small — this is not a measurement that could be improved, it is a pair of numbers describing nothing.`
      )
    }
    const times = product / floor
    const warnings: string[] = []
    if (times < 1.01) {
      warnings.push('This state is essentially at the minimum, which only a Gaussian reaches. Any other shape sits above the floor.')
    }
    if (times > 100) {
      warnings.push(`The product is ${times.toFixed(1)} times the floor, so this state is nowhere near the quantum limit. Whatever is broadening it is classical — thermal spread, an imperfect source, a mixture of states.`)
    }
    return {
      product,
      floor,
      timesTheFloor: times,
      possible: true,
      minimumOther: null,
      pair,
      notes: Object.freeze([
        `The product is ${product.toExponential(4)}, which is ${times.toFixed(3)} times the floor of hbar/2 = ${floor.toExponential(4)}.`,
        'This is a property of the state, not a limit of the instrument. A perfect measurement does not get below it, because there is nothing below it to find.',
        'Only a Gaussian wavepacket reaches the floor exactly. Everything else is above it, and how far above says something real about the state.',
        pair === 'energy-time'
          ? 'The energy-time relation is not the same kind of statement as position-momentum: time is not an operator in quantum mechanics. It is best read as a relation between a state’s lifetime and its linewidth, which is exactly why short-lived particles have broad masses.'
          : 'Position and momentum are conjugate operators that do not commute, and the floor follows from that directly.'
      ]),
      warnings: Object.freeze(warnings)
    }
  }

  const given = (input.first ?? input.second) as number
  const minimumOther = floor / given
  return {
    product: floor,
    floor,
    timesTheFloor: 1,
    possible: true,
    minimumOther,
    pair,
    notes: Object.freeze([
      `With one uncertainty at ${given.toExponential(4)}, the other cannot be below ${minimumOther.toExponential(4)}.`,
      'That is the best case, reached only by a Gaussian. Any real state does worse.',
      'Confining a particle more tightly raises its momentum spread in exact proportion, which is where the zero-point energy of a box comes from — it is the same fact stated two ways.'
    ]),
    warnings: Object.freeze([])
  }
}

// ---------------------------------------------------------------- superposition and measurement

export interface Amplitude {
  label: string
  /** The real and imaginary parts of the amplitude. */
  real: number
  imaginary?: number
}

export interface MeasurementReport {
  /** Each outcome and how likely it is. These add to 1. */
  outcomes: readonly { label: string; probability: number; amplitudeMagnitude: number; phaseDegrees: number }[]
  /** Whether the state came in normalised, and what it was scaled by. */
  wasNormalised: boolean
  normalisationFactor: number
  /** The most likely outcome, which is not "the answer". */
  mostLikely: string
  /** How spread the outcome is: 0 for a definite state, higher for a broad superposition. */
  shannonEntropyBits: number
  /** Whether relative phase could matter, which it can only if interference is possible. */
  phasesDiffer: boolean
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * The outcome probabilities of measuring a superposition — probabilities, never an outcome.
 *
 * The theory gives the probability of each result and nothing more. Returning one result would be inventing data, and
 * a Page that wants a simulated run supplies its own random draw so that it is visible a draw happened.
 *
 * Phase is preserved and reported. It has no effect on these probabilities, and it is everything for what happens
 * next: two states with the same probabilities and different phases interfere differently, and that difference is
 * the whole of quantum computing.
 */
export function measure(input: {
  amplitudes: readonly Amplitude[]
  /** Set to skip normalising and refuse an unnormalised state instead. */
  requireNormalised?: boolean
}): MeasurementReport | QuantumError {
  const { amplitudes } = input
  if (amplitudes.length === 0) return fail('invalid-argument', 'There are no amplitudes, so there is no state.')
  if (amplitudes.length > QUANTUM_LIMITS.components) {
    return fail('too-many', `That is ${amplitudes.length} components; this handles up to ${QUANTUM_LIMITS.components}.`)
  }

  let total = 0
  const resolved: { label: string; real: number; imaginary: number }[] = []
  for (const [i, one] of amplitudes.entries()) {
    const imaginary = one.imaginary ?? 0
    if (!finite(one.real) || !finite(imaginary)) return fail('not-finite', `Component ${i + 1} has an amplitude that is not finite.`)
    total += one.real * one.real + imaginary * imaginary
    resolved.push({ label: one.label || `outcome ${i + 1}`, real: one.real, imaginary })
  }

  if (total === 0) {
    return fail('no-solution', 'Every amplitude is zero, so the total probability is zero. That is not a state — it describes nothing at all.')
  }

  const wasNormalised = Math.abs(total - 1) < 1e-9
  if (!wasNormalised && input.requireNormalised === true) {
    return fail(
      'not-normalised',
      `The amplitudes square to ${total.toFixed(6)} rather than 1, so the probabilities would not add to 1. Divide every amplitude by ${Math.sqrt(total).toFixed(6)}, or drop requireNormalised and this will do it.`
    )
  }

  const outcomes = resolved.map((one) => {
    const magnitudeSquared = (one.real * one.real + one.imaginary * one.imaginary) / total
    const magnitude = Math.sqrt(one.real * one.real + one.imaginary * one.imaginary)
    return {
      label: one.label,
      probability: magnitudeSquared,
      amplitudeMagnitude: magnitude,
      phaseDegrees: (Math.atan2(one.imaginary, one.real) * 180) / Math.PI
    }
  })

  let entropy = 0
  for (const one of outcomes) {
    if (one.probability > 0) entropy -= one.probability * Math.log2(one.probability)
  }

  const mostLikely = outcomes.reduce((best, one) => (one.probability > best.probability ? one : best))
  const phases = new Set(outcomes.map((one) => one.phaseDegrees.toFixed(6)))

  const warnings: string[] = []
  if (!wasNormalised) {
    warnings.push(`The amplitudes squared to ${total.toFixed(6)}, so they were divided by ${Math.sqrt(total).toFixed(6)} to normalise. The probabilities below are the normalised ones.`)
  }
  if (outcomes.length === 1) {
    warnings.push('There is only one component, so this is not a superposition — the outcome is certain and there is nothing probabilistic about it.')
  }

  return {
    outcomes: Object.freeze(outcomes),
    wasNormalised,
    normalisationFactor: 1 / Math.sqrt(total),
    mostLikely: mostLikely.label,
    shannonEntropyBits: entropy,
    phasesDiffer: phases.size > 1,
    notes: Object.freeze([
      `${outcomes.length} possible outcome${outcomes.length === 1 ? '' : 's'}, the most likely being "${mostLikely.label}" at ${(mostLikely.probability * 100).toFixed(3)}%.`,
      'These are probabilities and not an outcome. The theory gives no more than this, and a single result would be invented — supply your own random draw if you want a simulated run, so that it is visible one happened.',
      `The outcome carries ${entropy.toFixed(4)} bits of uncertainty. Zero means the state is already definite; log2 of the component count is the maximum, reached by an even superposition.`,
      phases.size > 1
        ? 'The components have different phases. Phase has no effect on these probabilities and is everything for what happens next — two states with identical probabilities and different phases interfere differently, which is the whole of quantum computing.'
        : 'All components share a phase, so no interference between them can occur without something changing one of them first.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

export interface ExpectationReport {
  /** The average over many measurements. */
  expectation: number
  /** The spread, which is zero only for an eigenstate. */
  standardDeviation: number
  /** The average of the square, which is not the square of the average. */
  meanSquare: number
  /** Whether the state has a definite value of this quantity. */
  isEigenstate: boolean
  /** Each contribution, so the average is arguable. */
  contributions: readonly { label: string; value: number; probability: number; contribution: number }[]
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * The expectation value of a quantity over a superposition, with its spread.
 *
 * An expectation value is an average over many runs and is not a prediction of any single one — it need not even be
 * an attainable value. The spread is what says whether the state has a definite value at all: zero spread means an
 * eigenstate and a certain result, and anything else means the individual measurements scatter around the average.
 */
export function expectationValue(input: {
  outcomes: readonly { label?: string; value: number; probability: number }[]
}): ExpectationReport | QuantumError {
  const { outcomes } = input
  if (outcomes.length === 0) return fail('invalid-argument', 'There are no outcomes.')
  if (outcomes.length > QUANTUM_LIMITS.components) {
    return fail('too-many', `That is more than the ${QUANTUM_LIMITS.components} outcomes this handles.`)
  }

  let totalProbability = 0
  for (const [i, one] of outcomes.entries()) {
    if (!finite(one.value)) return fail('not-finite', `Outcome ${i + 1} has a value that is not finite.`)
    if (!finite(one.probability) || one.probability < 0) return fail('invalid-argument', `Outcome ${i + 1} has a probability that is negative.`)
    totalProbability += one.probability
  }
  if (totalProbability === 0) return fail('no-solution', 'Every probability is zero, so there is nothing to average.')

  const warnings: string[] = []
  if (Math.abs(totalProbability - 1) > 1e-6) {
    warnings.push(`The probabilities add to ${totalProbability.toFixed(6)} rather than 1, so they were normalised. Probabilities that do not add to 1 usually mean an outcome is missing.`)
  }

  let expectation = 0
  let meanSquare = 0
  const contributions = outcomes.map((one, i) => {
    const probability = one.probability / totalProbability
    expectation += probability * one.value
    meanSquare += probability * one.value * one.value
    return {
      label: one.label ?? `outcome ${i + 1}`,
      value: one.value,
      probability,
      contribution: probability * one.value
    }
  })

  const variance = Math.max(0, meanSquare - expectation * expectation)
  const standardDeviation = Math.sqrt(variance)
  const isEigenstate = standardDeviation < Math.abs(expectation) * 1e-12 || standardDeviation === 0

  const attainable = outcomes.some((one) => Math.abs(one.value - expectation) < Math.abs(expectation) * 1e-9)
  if (!attainable && outcomes.length > 1) {
    warnings.push(
      `The expectation value of ${expectation.toFixed(6)} is not one of the possible outcomes. That is normal and worth saying: an average over many runs need not be a value any single run can produce.`
    )
  }

  return {
    expectation,
    standardDeviation,
    meanSquare,
    isEigenstate,
    contributions: Object.freeze(contributions),
    notes: Object.freeze([
      `The expectation value is ${expectation.toFixed(6)} with a spread of ${standardDeviation.toFixed(6)}.`,
      isEigenstate
        ? 'The spread is zero, so this is an eigenstate: every measurement gives the same value, with certainty.'
        : 'The spread is not zero, so individual measurements scatter. The expectation value is what they average to over many runs and is not a prediction of any one of them.',
      'The mean of the square is not the square of the mean, and the difference between them is exactly the variance. That is where every uncertainty in quantum mechanics comes from.',
      'Each outcome’s contribution is listed, so it is visible which term dominates the average rather than only the total.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

/** Handy for a Page that wants the scales beside a result. */
export const QUANTUM_CONSTANTS = Object.freeze({
  planck: PLANCK_CONSTANT,
  reducedPlanck: REDUCED_PLANCK,
  electronMass: ELECTRON_MASS,
  bohrRadius: BOHR_RADIUS_VALUE,
  rydbergEnergyElectronVolts: (RYDBERG_CONSTANT * PLANCK_CONSTANT * SPEED_OF_LIGHT) / ELECTRON_VOLT,
  fineStructure: FINE_STRUCTURE_CONSTANT,
  uncertaintyFloor: REDUCED_PLANCK / 2,
  note: 'The Bohr radius is 53 pm and the Rydberg energy is 13.6 eV. Those two set the size and the energy scale of every atom, and everything in chemistry follows from them.'
})

/** Everything a Page should be able to show about what this engine is standing on. */
export const QUANTUM_ASSUMPTIONS: readonly string[] = Object.freeze([
  'A measurement returns probabilities and never an outcome. Nothing here draws a random number; a Page wanting a simulated run supplies its own.',
  'Wavefunctions are normalised, and where an unnormalised state arrives the scaling is reported rather than applied silently.',
  'Phase is preserved and reported. It does not affect measurement probabilities and it decides every interference that happens afterwards.',
  'The uncertainty principle is a floor on a property of the state, not a limit of an instrument. A pair below it is refused as describing nothing.',
  'The particle in a box has infinitely high walls, so no tunnelling and no escape. A real well has fewer bound states and a wavefunction that leaks out.',
  'Hydrogen uses the non-relativistic Bohr model with a point nucleus and one electron. It misses fine structure, the Lamb shift and hyperfine splitting, all of which are measurable.',
  'Tunnelling assumes a rectangular barrier. A real barrier has a shape and the answer can differ by orders of magnitude.',
  'Expectation values are averages over many runs and need not be attainable in any single one.',
  'The energy-time uncertainty relation is not the same kind of statement as position-momentum, because time is not an operator. It is a relation between lifetime and linewidth.'
])
