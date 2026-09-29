/**
 * Statistical mechanics: how the behaviour of one molecule adds up to the behaviour of a gas.
 *
 * The shared statistical-mechanics engine for Orbis Pages. Partition functions are summed rather than approximated,
 * speed distributions come with all three of their characteristic speeds because they are different numbers, and
 * heat capacities show which modes are active at the temperature asked about.
 *
 * ## Why the three speeds are all reported
 *
 * The most probable speed, the mean speed and the root-mean-square speed of a Maxwell-Boltzmann distribution differ
 * by about 13% from smallest to largest, and each is the right answer to a different question: the peak of the
 * distribution, the average of a collision rate, and the one that sets the kinetic energy. Quoting "the speed of a
 * nitrogen molecule" without saying which is ambiguous by more than a tenth.
 *
 * ## Why heat capacity depends on temperature and this says how
 *
 * Equipartition gives each active mode half a Boltzmann constant per molecule, and the modes switch on as the
 * temperature rises past their characteristic temperatures. Hydrogen behaves like a monatomic gas below 100 K
 * because its rotation is frozen out, and a formula that always gives 5/2 R for a diatomic gas is wrong there. The
 * active modes are reported rather than assumed.
 *
 * ## The distinctions this file refuses to blur
 *
 * ```
 * microstate      vs  macrostate     -- one arrangement against the set of arrangements that look the same
 * probability     vs  degeneracy     -- how likely a state is against how many states share an energy
 * mean speed      vs  rms speed      -- and the 8% between them
 * Boltzmann       vs  Bose/Fermi     -- distinguishable particles against indistinguishable ones
 * temperature     vs  energy          -- kT is an energy scale, not a temperature
 * entropy         vs  disorder        -- a count of microstates against a vague word for it
 * ```
 *
 * Pure. No network, no clock, no storage.
 */

import { BOLTZMANN_CONSTANT, GAS_CONSTANT, AVOGADRO_CONSTANT, ATOMIC_MASS_UNIT, PLANCK_CONSTANT, ELECTRON_VOLT } from './emConstants.ts'

export interface StatMechError {
  error: 'invalid-argument' | 'not-finite' | 'out-of-range' | 'too-many' | 'no-solution' | 'outside-model'
  message: string
}

export const isStatMechError = (value: unknown): value is StatMechError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: StatMechError['error'], message: string): StatMechError => ({ error, message })

const finite = (value: number): boolean => Number.isFinite(value)

export const STATMECH_LIMITS = Object.freeze({ levels: 2000, samples: 4000, particles: 1e30 })

// ---------------------------------------------------------------- Boltzmann distribution

export interface BoltzmannReport {
  /** Kelvin. */
  temperature: number
  /** Joules. The thermal energy scale, which is what decides which states are reachable. */
  thermalEnergy: number
  /** eV, because that is the unit atomic energies are quoted in. */
  thermalEnergyElectronVolts: number
  /** The partition function: the sum over states, which every probability divides by. */
  partitionFunction: number
  levels: readonly {
    label: string
    /** Joules above the ground state. */
    energy: number
    degeneracy: number
    /** The chance of finding a given particle in this level. */
    probability: number
    /** The ratio to the ground state population, which is the number usually quoted. */
    relativePopulation: number
    /** How many energy levels' worth of kT this sits above the ground state. */
    energyInKt: number
  }[]
  /** Joules. The average energy per particle. */
  averageEnergy: number
  /** J/K per particle. */
  entropyPerParticle: number
  /** Whether any level above the ground state has a meaningful population. */
  excitedStatesReachable: boolean
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * The Boltzmann distribution over a set of energy levels, summed exactly.
 *
 * The energy in units of kT is reported for every level because it is the only number that matters: a level 1 kT up
 * holds 37% of the ground-state population, one 10 kT up holds 0.005%, and one 40 kT up is unoccupied in any sample
 * you will ever have. That is why chemistry happens at some temperatures and not others, and why an activation
 * energy of a few tenths of an electronvolt is the difference between instant and never.
 */
export function boltzmannDistribution(input: {
  /** Kelvin. */
  temperature: number
  /** Joules above the ground state, or eV if `unit` says so. */
  levels: readonly { label?: string; energy: number; degeneracy?: number }[]
  unit?: 'joules' | 'electron-volts'
}): BoltzmannReport | StatMechError {
  const { temperature, levels } = input
  if (!finite(temperature)) return fail('not-finite', 'The temperature has to be a finite number.')
  if (temperature <= 0) {
    return fail(
      'out-of-range',
      'The temperature is in kelvin and has to be above zero. At exactly zero every particle is in the ground state and the distribution is not defined by this formula.'
    )
  }
  if (levels.length === 0) return fail('invalid-argument', 'There are no energy levels.')
  if (levels.length > STATMECH_LIMITS.levels) return fail('too-many', `That is ${levels.length} levels; this handles up to ${STATMECH_LIMITS.levels}.`)

  const scale = input.unit === 'electron-volts' ? ELECTRON_VOLT : 1
  const kt = BOLTZMANN_CONSTANT * temperature

  const resolved: { label: string; energy: number; degeneracy: number }[] = []
  for (const [i, one] of levels.entries()) {
    if (!finite(one.energy)) return fail('not-finite', `Level ${i + 1} has an energy that is not finite.`)
    const degeneracy = one.degeneracy ?? 1
    if (!Number.isInteger(degeneracy) || degeneracy < 1) {
      return fail('invalid-argument', `Level ${i + 1} has a degeneracy of ${degeneracy}. Degeneracy is how many distinct states share this energy, so it is a whole number of at least 1.`)
    }
    resolved.push({ label: one.label ?? `level ${i + 1}`, energy: one.energy * scale, degeneracy })
  }

  const lowest = Math.min(...resolved.map((one) => one.energy))
  // Measured from the lowest level, which keeps the exponentials from overflowing and changes nothing physical.
  const shifted = resolved.map((one) => ({ ...one, relative: one.energy - lowest }))
  const partition = shifted.reduce((sum, one) => sum + one.degeneracy * Math.exp(-one.relative / kt), 0)
  if (!finite(partition) || partition <= 0) {
    return fail('no-solution', 'The partition function came out as zero or not finite, which means the energies span more than floating point can hold at this temperature.')
  }

  const groundWeight = shifted[0].degeneracy * Math.exp(-shifted[0].relative / kt)
  let averageEnergy = 0
  const described = shifted.map((one) => {
    const weight = one.degeneracy * Math.exp(-one.relative / kt)
    const probability = weight / partition
    averageEnergy += probability * one.relative
    return {
      label: one.label,
      energy: one.relative,
      degeneracy: one.degeneracy,
      probability,
      relativePopulation: groundWeight === 0 ? 0 : weight / groundWeight,
      energyInKt: one.relative / kt
    }
  })

  // The Gibbs entropy of the distribution, per particle.
  let entropy = 0
  for (const one of described) {
    if (one.probability > 0) entropy -= BOLTZMANN_CONSTANT * one.probability * Math.log(one.probability / one.degeneracy)
  }

  const excited = described.slice(1).some((one) => one.probability > 1e-6)
  const warnings: string[] = []
  const highest = Math.max(...described.map((one) => one.energyInKt))
  if (highest > 40) {
    warnings.push(
      `The top level sits ${highest.toFixed(1)} kT above the ground state, which gives it a population of about ${Math.exp(-highest).toExponential(1)}. In a mole of anything that is fewer than one particle, so it is unoccupied in any real sample.`
    )
  }
  if (!excited && described.length > 1) {
    warnings.push(
      `No level above the ground state has a population over one in a million at ${temperature} K. Everything is in the ground state, which is why a system can be quantum-mechanically complicated and thermodynamically dull.`
    )
  }

  return {
    temperature,
    thermalEnergy: kt,
    thermalEnergyElectronVolts: kt / ELECTRON_VOLT,
    partitionFunction: partition,
    levels: Object.freeze(described),
    averageEnergy,
    entropyPerParticle: entropy,
    excitedStatesReachable: excited,
    notes: Object.freeze([
      `At ${temperature} K the thermal energy kT is ${(kt / ELECTRON_VOLT).toFixed(5)} eV. That single number decides which states are reachable and which are not.`,
      'Every level reports its energy in units of kT, which is the only measure that matters: one kT up is 37% of the ground-state population, ten kT up is 0.005%, and forty kT up is nobody.',
      `The partition function is ${partition.toFixed(6)}. It is the normalising sum and also the quantity every thermodynamic property of the system can be derived from.`,
      'Degeneracy and probability are different things. A level with eight states at one energy is eight times as likely to be found as a single state at the same energy, and each individual state is equally likely.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- Maxwell-Boltzmann speeds

export interface SpeedReport {
  /** m/s. The peak of the distribution. */
  mostProbable: number
  /** m/s. The arithmetic average, used for collision rates. */
  mean: number
  /** m/s. The one that sets the kinetic energy, and the largest of the three. */
  rootMeanSquare: number
  /** How far apart the three are, as a fraction. */
  spread: number
  /** Joules. The average translational kinetic energy, which is 3kT/2 whatever the gas. */
  averageKineticEnergy: number
  /** m/s. The speed of sound in this gas, for comparison — molecules move faster than sound. */
  speedOfSound: number | null
  /** The distribution, for drawing. */
  distribution: readonly { speed: number; density: number; cumulative: number }[]
  /** The fraction above a given speed, when one was asked about. */
  fractionAbove: number | null
  molarMass: number
  temperature: number
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * The Maxwell-Boltzmann speed distribution, with all three characteristic speeds.
 *
 * All three, because they are genuinely different numbers and each answers a different question. The mean speed is
 * 1.128 times the most probable and the rms is 1.225 times it, so "the speed of an air molecule at room temperature"
 * is 400, 450 or 500 m/s depending on which was meant.
 *
 * The distribution is not symmetrical: it has a long tail to high speeds and a hard floor at zero. That asymmetry
 * is why a small rise in temperature can multiply a reaction rate several times over — the population above an
 * activation energy lives in that tail.
 */
export function speedDistribution(input: {
  /** Kelvin. */
  temperature: number
  /** kg/mol, or use `molecularMassAmu` instead. */
  molarMass?: number
  molecularMassAmu?: number
  /** The ratio of specific heats, for the speed of sound. */
  gamma?: number
  /** m/s, to find the fraction of molecules above it. */
  above?: number
  samples?: number
}): SpeedReport | StatMechError {
  const { temperature } = input
  if (!finite(temperature) || temperature <= 0) return fail('out-of-range', 'The temperature is in kelvin and has to be above zero.')

  let molarMass: number
  if (input.molarMass !== undefined) {
    molarMass = input.molarMass
  } else if (input.molecularMassAmu !== undefined) {
    molarMass = input.molecularMassAmu * ATOMIC_MASS_UNIT * AVOGADRO_CONSTANT
  } else {
    return fail('invalid-argument', 'Give a molar mass in kg/mol, or a molecular mass in atomic mass units.')
  }
  if (!finite(molarMass) || molarMass <= 0) return fail('invalid-argument', 'The molar mass has to be greater than zero.')

  const moleculeMass = molarMass / AVOGADRO_CONSTANT
  const kt = BOLTZMANN_CONSTANT * temperature

  const mostProbable = Math.sqrt((2 * kt) / moleculeMass)
  const mean = Math.sqrt((8 * kt) / (Math.PI * moleculeMass))
  const rms = Math.sqrt((3 * kt) / moleculeMass)
  const averageKineticEnergy = 1.5 * kt

  const speedOfSound =
    input.gamma === undefined
      ? null
      : (() => {
          if (!finite(input.gamma as number) || (input.gamma as number) <= 1) return null
          return Math.sqrt(((input.gamma as number) * GAS_CONSTANT * temperature) / molarMass)
        })()

  const count = Math.round(input.samples ?? 200)
  if (!Number.isInteger(count) || count < 2 || count > STATMECH_LIMITS.samples) {
    return fail('invalid-argument', `The sample count has to be between 2 and ${STATMECH_LIMITS.samples}.`)
  }

  const density = (speed: number): number =>
    4 * Math.PI * Math.pow(moleculeMass / (2 * Math.PI * kt), 1.5) * speed * speed * Math.exp((-moleculeMass * speed * speed) / (2 * kt))

  // Out to three times the most probable speed, which contains over 99.99% of the distribution.
  const top = mostProbable * 3.5
  const distribution: SpeedReport['distribution'][number][] = []
  let cumulative = 0
  const step = top / (count - 1)
  for (let i = 0; i < count; i += 1) {
    const speed = step * i
    const d = density(speed)
    if (i > 0) cumulative += ((d + density(speed - step)) / 2) * step
    distribution.push({ speed, density: d, cumulative: Math.min(1, cumulative) })
  }

  // The fraction above a speed, by integrating the distribution rather than by a lookup.
  let fractionAbove: number | null = null
  if (input.above !== undefined) {
    if (!finite(input.above) || input.above < 0) return fail('invalid-argument', 'The speed to count above cannot be negative.')
    const pieces = 4000
    const limit = Math.max(input.above * 3, top * 2)
    let integral = 0
    const h = (limit - input.above) / pieces
    for (let i = 0; i < pieces; i += 1) {
      const a = input.above + h * i
      integral += ((density(a) + density(a + h)) / 2) * h
    }
    fractionAbove = Math.max(0, Math.min(1, integral))
  }

  const warnings: string[] = []
  if (speedOfSound !== null && mean < speedOfSound) {
    warnings.push('The mean molecular speed came out below the speed of sound in the same gas, which cannot be right — sound travels by molecular collisions and cannot outrun them.')
  }
  if (fractionAbove !== null && fractionAbove < 1e-12 && fractionAbove > 0) {
    warnings.push(
      `The fraction above ${input.above} m/s is about ${fractionAbove.toExponential(2)}. In a mole that is ${(fractionAbove * AVOGADRO_CONSTANT).toExponential(2)} molecules, so whether it is "none" depends on how much gas you have.`
    )
  }

  return {
    mostProbable,
    mean,
    rootMeanSquare: rms,
    spread: (rms - mostProbable) / mostProbable,
    averageKineticEnergy,
    speedOfSound,
    distribution: Object.freeze(distribution),
    fractionAbove,
    molarMass,
    temperature,
    notes: Object.freeze([
      `Most probable ${mostProbable.toFixed(1)} m/s, mean ${mean.toFixed(1)} m/s, root-mean-square ${rms.toFixed(1)} m/s. They differ by ${(((rms - mostProbable) / mostProbable) * 100).toFixed(1)}%, and "the speed of a molecule" without saying which is ambiguous by that much.`,
      `The average translational kinetic energy is ${(averageKineticEnergy / ELECTRON_VOLT).toFixed(5)} eV, which is 3kT/2 for every gas regardless of what it is made of. Heavier molecules move more slowly at exactly the rate that keeps this equal.`,
      'The distribution is not symmetrical: a hard floor at zero and a long tail upward. That tail is why a small temperature rise can multiply a reaction rate — the molecules that react live in it.',
      speedOfSound === null
        ? 'Give a ratio of specific heats for the speed of sound in this gas, which is always a little below the mean molecular speed.'
        : `The speed of sound here is ${speedOfSound.toFixed(1)} m/s, a little below the mean molecular speed. Sound is carried by collisions, so it cannot travel faster than the molecules do.`
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- heat capacity

export interface ModeTemperatures {
  /** Kelvin. Above this, rotation contributes fully. A few kelvin for most molecules, 85 K for hydrogen. */
  rotational?: number
  /** Kelvin. Above this, vibration contributes. Usually thousands of kelvin. */
  vibrational?: number
}

export interface HeatCapacityReport {
  /** J/(mol·K) at constant volume. */
  cv: number
  /** J/(mol·K) at constant pressure. Always R more than Cv for an ideal gas. */
  cp: number
  /** Cp over Cv. */
  gamma: number
  /** Which modes are contributing at this temperature, and how much. */
  modes: readonly { mode: string; degreesOfFreedom: number; contribution: number; active: number; describe: string }[]
  /** The total active degrees of freedom, which need not be a whole number. */
  activeDegreesOfFreedom: number
  /** What equipartition would give if every mode were fully active. */
  classicalLimit: number
  temperature: number
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Heat capacity from the modes that are actually active at a temperature.
 *
 * Equipartition says every active mode gets half a Boltzmann constant, and the catch is "active": a mode whose
 * characteristic temperature is well above the current one is frozen out and contributes nothing. Hydrogen behaves
 * like a monatomic gas below about 100 K for exactly this reason, and a formula that always gives 5/2 R for a
 * diatomic gas is wrong there by 40%.
 *
 * Vibrational modes are the usual surprise. Their characteristic temperatures are in the thousands of kelvin, so at
 * room temperature they contribute almost nothing even though the molecule plainly can vibrate.
 */
export function heatCapacity(input: {
  /** Kelvin. */
  temperature: number
  shape: 'monatomic' | 'linear' | 'nonlinear'
  /** How many vibrational modes. 3N-5 for a linear molecule, 3N-6 otherwise. */
  vibrationalModes?: number
  characteristicTemperatures?: ModeTemperatures
}): HeatCapacityReport | StatMechError {
  const { temperature, shape } = input
  if (!finite(temperature) || temperature <= 0) return fail('out-of-range', 'The temperature is in kelvin and has to be above zero.')
  if (!['monatomic', 'linear', 'nonlinear'].includes(shape)) {
    return fail('invalid-argument', `"${shape}" is not a shape this knows; use monatomic, linear or nonlinear.`)
  }

  const rotationalDegrees = shape === 'monatomic' ? 0 : shape === 'linear' ? 2 : 3
  const vibrationalModes = input.vibrationalModes ?? 0
  if (!Number.isInteger(vibrationalModes) || vibrationalModes < 0) {
    return fail('invalid-argument', 'The vibrational mode count is a whole number of zero or more.')
  }
  if (shape === 'monatomic' && vibrationalModes > 0) {
    return fail(
      'invalid-argument',
      'A monatomic gas has no vibrational modes — a single atom has nothing to vibrate against. If this is meant to be a solid, that is a different model.'
    )
  }

  const rotationalTemperature = input.characteristicTemperatures?.rotational ?? 10
  const vibrationalTemperature = input.characteristicTemperatures?.vibrational ?? 2000
  for (const [name, value] of [['rotational', rotationalTemperature], ['vibrational', vibrationalTemperature]] as const) {
    if (!finite(value) || value <= 0) return fail('invalid-argument', `The ${name} characteristic temperature has to be greater than zero.`)
  }

  /**
   * How fully a vibrational mode contributes: the Einstein function, which goes smoothly from 0 well below its
   * characteristic temperature to 1 well above it. A step function would be wrong by a lot in the middle.
   */
  const einstein = (characteristic: number): number => {
    const x = characteristic / temperature
    if (x > 50) return 0
    if (x < 1e-6) return 1
    const e = Math.exp(x)
    return (x * x * e) / Math.pow(e - 1, 2)
  }

  /**
   * Rotation is not an oscillator and the Einstein function is the wrong shape for it — it would say hydrogen is a
   * quarter rotationally active at 20 K, where the measured heat capacity says almost none of it is. The rotational
   * levels are J(J+1) times the characteristic temperature with a (2J+1) degeneracy, so the partition function is
   * summed over J directly and the heat capacity taken from its energy variance. That is exact for a linear
   * molecule and gets both limits right.
   */
  const rotationalActivation = (characteristic: number): number => {
    const theta = characteristic / temperature
    if (theta < 1e-3) return 1
    let z = 0
    let firstMoment = 0
    let secondMoment = 0
    for (let j = 0; j < 2000; j += 1) {
      const energy = j * (j + 1) * theta
      if (energy > 700) break
      const weight = (2 * j + 1) * Math.exp(-energy)
      z += weight
      firstMoment += weight * energy
      secondMoment += weight * energy * energy
    }
    if (z === 0) return 0
    const mean = firstMoment / z
    const variance = secondMoment / z - mean * mean
    // Cv/k from the energy variance, against the classical value of 1 per pair of rotational degrees of freedom.
    return Math.max(0, Math.min(1, variance))
  }

  const rotationalActive = rotationalDegrees === 0 ? 0 : rotationalActivation(rotationalTemperature)
  const vibrationalActive = vibrationalModes === 0 ? 0 : einstein(vibrationalTemperature)

  const modes: HeatCapacityReport['modes'][number][] = [
    {
      mode: 'translation',
      degreesOfFreedom: 3,
      contribution: 1.5 * GAS_CONSTANT,
      active: 1,
      describe: 'Always fully active. A molecule can always move in three directions, at any temperature above absolute zero.'
    }
  ]
  if (rotationalDegrees > 0) {
    modes.push({
      mode: 'rotation',
      degreesOfFreedom: rotationalDegrees,
      contribution: (rotationalDegrees / 2) * GAS_CONSTANT * rotationalActive,
      active: rotationalActive,
      describe:
        shape === 'linear'
          ? 'Two axes, because rotation about the molecular axis of a linear molecule has no moment of inertia to speak of.'
          : 'Three axes. Fully active for almost every molecule above a few tens of kelvin.'
    })
  }
  if (vibrationalModes > 0) {
    modes.push({
      mode: 'vibration',
      degreesOfFreedom: 2 * vibrationalModes,
      contribution: vibrationalModes * GAS_CONSTANT * vibrationalActive,
      active: vibrationalActive,
      describe:
        'Each vibrational mode counts twice — kinetic and potential — and each needs its characteristic temperature to be reached. Those are usually thousands of kelvin, which is why vibration contributes almost nothing at room temperature.'
    })
  }

  const cv = modes.reduce((sum, one) => sum + one.contribution, 0)
  const cp = cv + GAS_CONSTANT
  const classical = ((3 + rotationalDegrees + 2 * vibrationalModes) / 2) * GAS_CONSTANT

  const warnings: string[] = []
  if (rotationalDegrees > 0 && rotationalActive < 0.9) {
    warnings.push(
      `Rotation is only ${(rotationalActive * 100).toFixed(0)}% active at ${temperature} K, because its characteristic temperature is ${rotationalTemperature} K. This gas is behaving more like a monatomic one than a diatomic one — which is exactly what hydrogen does below about 100 K.`
    )
  }
  if (vibrationalModes > 0 && vibrationalActive < 0.1) {
    warnings.push(
      `Vibration is only ${(vibrationalActive * 100).toFixed(1)}% active. The molecule can certainly vibrate; at ${temperature} K there is not enough thermal energy to excite it, so it contributes almost nothing to the heat capacity.`
    )
  }
  if (cv > classical * 1.001) {
    warnings.push('The computed heat capacity exceeds the classical equipartition limit, which cannot happen. Check the mode counts.')
  }

  return {
    cv,
    cp,
    gamma: cp / cv,
    modes: Object.freeze(modes),
    activeDegreesOfFreedom: (2 * cv) / GAS_CONSTANT,
    classicalLimit: classical,
    temperature,
    notes: Object.freeze([
      `Cv is ${cv.toFixed(3)} J/(mol*K), Cp is ${cp.toFixed(3)}, and gamma is ${(cp / cv).toFixed(4)} at ${temperature} K.`,
      `That comes to ${((2 * cv) / GAS_CONSTANT).toFixed(3)} active degrees of freedom out of a classical ${(3 + rotationalDegrees + 2 * vibrationalModes)}. The number need not be a whole one, because modes switch on gradually rather than all at once.`,
      'Cp is always R more than Cv for an ideal gas, because heating at constant pressure also does work pushing the surroundings back. That difference is exactly R per mole, whatever the gas.',
      'Vibration is activated by the Einstein function and rotation by summing its own partition function over J. Rotation is not an oscillator, and using the oscillator formula for it says hydrogen is a quarter rotationally active at 20 K where the measured heat capacity says almost none of it is.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- microstates and entropy

export interface MicrostateReport {
  /** How many arrangements the macrostate has. Reported as a logarithm too, because it overflows quickly. */
  microstates: number | null
  logMicrostates: number
  /** J/K. The Boltzmann entropy, k ln W. */
  entropy: number
  /** J/(mol·K), for comparison with tabulated values. */
  molarEntropy: number
  /** The most likely arrangement, and how much more likely it is than the extremes. */
  mostLikely: { description: string; microstates: number | null; logMicrostates: number } | null
  /** How sharply peaked the distribution is. For large systems it is absurdly sharp, which is why thermodynamics works. */
  sharpness: string
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * The entropy of a macrostate from the number of microstates it has.
 *
 * Reported as a logarithm as well as a count, because the count overflows a floating-point number at about 170
 * particles and the physically interesting systems have 10^23. Everything meaningful is in the logarithm anyway,
 * which is why entropy is defined as one.
 *
 * The sharpness figure is the reason thermodynamics works at all. For a mole of gas the most likely arrangement is
 * more likely than a noticeably different one by a factor with billions of digits, so the average is not merely
 * typical — it is the only thing that is ever observed.
 */
export function microstateEntropy(input: {
  /** How many particles. */
  particles: number
  /** How many distinguishable boxes or states each can be in. */
  states?: number
  /** Or give the occupation of each box directly, for a specific arrangement. */
  occupancy?: readonly number[]
}): MicrostateReport | StatMechError {
  const { particles } = input
  if (!finite(particles) || particles < 1) return fail('invalid-argument', 'The particle count has to be at least 1.')
  if (particles > STATMECH_LIMITS.particles) return fail('too-many', 'That is more particles than this counts.')

  // Log factorial by Stirling with the correction terms, exact enough for anything and finite for large numbers.
  const logFactorial = (n: number): number => {
    if (n < 2) return 0
    if (n < 170) {
      let sum = 0
      for (let i = 2; i <= n; i += 1) sum += Math.log(i)
      return sum
    }
    return n * Math.log(n) - n + 0.5 * Math.log(2 * Math.PI * n) + 1 / (12 * n)
  }

  let logMicrostates: number
  let mostLikely: MicrostateReport['mostLikely'] = null

  if (input.occupancy !== undefined) {
    const occupancy = input.occupancy
    if (occupancy.length === 0) return fail('invalid-argument', 'The occupancy list is empty.')
    let total = 0
    for (const [i, one] of occupancy.entries()) {
      if (!Number.isInteger(one) || one < 0) return fail('invalid-argument', `Box ${i + 1} holds ${one} particles, which has to be a whole number of zero or more.`)
      total += one
    }
    if (Math.abs(total - particles) > 0.5) {
      return fail('invalid-argument', `The occupancies add to ${total} and ${particles} particles were given. A multiplicity is only defined for an arrangement of all of them.`)
    }
    // The multinomial coefficient: how many ways to produce this exact occupancy.
    logMicrostates = logFactorial(particles) - occupancy.reduce((sum, one) => sum + logFactorial(one), 0)

    // The most even arrangement, which is the most likely one, for comparison.
    const boxes = occupancy.length
    const even = Math.floor(particles / boxes)
    const remainder = particles % boxes
    const evenOccupancy = Array.from({ length: boxes }, (_, i) => even + (i < remainder ? 1 : 0))
    const evenLog = logFactorial(particles) - evenOccupancy.reduce((sum, one) => sum + logFactorial(one), 0)
    mostLikely = {
      description: `${even}${remainder > 0 ? ` or ${even + 1}` : ''} in each of ${boxes} boxes`,
      microstates: evenLog < 700 ? Math.exp(evenLog) : null,
      logMicrostates: evenLog
    }
  } else {
    const states = input.states
    if (states === undefined) return fail('invalid-argument', 'Give a number of states each particle can occupy, or an occupancy list.')
    if (!Number.isInteger(states) || states < 1) return fail('invalid-argument', 'The state count is a whole number of at least 1.')
    // Independent, distinguishable particles: every particle chooses freely.
    logMicrostates = particles * Math.log(states)
  }

  const microstates = logMicrostates < 700 ? Math.exp(logMicrostates) : null
  const entropy = BOLTZMANN_CONSTANT * logMicrostates
  const molarEntropy = (entropy / particles) * AVOGADRO_CONSTANT

  const warnings: string[] = []
  if (microstates === null) {
    warnings.push(
      `The number of microstates is about e^${logMicrostates.toFixed(1)}, which is far past what a floating-point number can hold. Only the logarithm is reported, and the logarithm is where all the physics is — which is why entropy is defined as one rather than as the count.`
    )
  }

  let sharpness: string
  if (particles < 100) {
    sharpness = 'With this few particles the fluctuations are large and the most likely arrangement is not overwhelmingly likely. Thermodynamics does not really apply.'
  } else if (particles < 1e10) {
    sharpness = `Relative fluctuations go as one over the square root of the particle count, so about ${(1 / Math.sqrt(particles)).toExponential(2)} here. Measurable, in a small system.`
  } else {
    sharpness = `Relative fluctuations are about ${(1 / Math.sqrt(particles)).toExponential(2)}. The most likely arrangement is not just typical, it is the only one ever observed — which is why thermodynamic laws look absolute rather than statistical.`
  }

  if (input.occupancy !== undefined && mostLikely !== null && logMicrostates < mostLikely.logMicrostates - 1) {
    warnings.push(
      `This arrangement is less likely than the even one by a factor of about e^${(mostLikely.logMicrostates - logMicrostates).toFixed(1)}. Left alone, the system moves toward the even arrangement — and that, rather than any force, is what the second law is.`
    )
  }

  return {
    microstates,
    logMicrostates,
    entropy,
    molarEntropy,
    mostLikely,
    sharpness,
    notes: Object.freeze([
      `S = k ln W gives ${entropy.toExponential(4)} J/K, or ${molarEntropy.toFixed(3)} J/(mol*K) if scaled to a mole.`,
      'Entropy is a count of arrangements, not a measure of untidiness. The word "disorder" is a metaphor that has misled generations, and the count is the definition.',
      sharpness,
      'Particles here are distinguishable and independent. Indistinguishable particles need Bose-Einstein or Fermi-Dirac counting, which gives different answers at low temperature and identical ones at high.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- quantum statistics

export type Statistics = 'boltzmann' | 'bose-einstein' | 'fermi-dirac'

export const STATISTICS_KINDS: readonly Statistics[] = Object.freeze(['boltzmann', 'bose-einstein', 'fermi-dirac'])

export const STATISTICS_FACTS: Readonly<Record<Statistics, { label: string; appliesTo: string; occupancyLimit: string }>> =
  Object.freeze({
    boltzmann: {
      label: 'Maxwell-Boltzmann',
      appliesTo: 'Distinguishable particles, and the high-temperature limit of both quantum cases.',
      occupancyLimit: 'No limit, and no restriction. It also allows occupancies above 1 where a fermion cannot have one.'
    },
    'bose-einstein': {
      label: 'Bose-Einstein',
      appliesTo: 'Indistinguishable particles with integer spin: photons, helium-4, phonons.',
      occupancyLimit: 'No limit, and they prefer to share. Below a critical temperature a macroscopic fraction collapses into the ground state, which is a Bose-Einstein condensate.'
    },
    'fermi-dirac': {
      label: 'Fermi-Dirac',
      appliesTo: 'Indistinguishable particles with half-integer spin: electrons, protons, helium-3.',
      occupancyLimit: 'At most one per state, ever. That exclusion is why atoms have structure and why matter takes up space.'
    }
  })

export interface OccupancyReport {
  statistics: Statistics
  label: string
  /** The average number of particles in the state. */
  occupancy: number
  /** What each of the other two would give, since they agree in some regimes and not others. */
  others: readonly { statistics: Statistics; occupancy: number; label: string }[]
  /** How far above the chemical potential this state is, in units of kT. */
  energyInKt: number
  /** Whether the three statistics agree here, which they do when the occupancy is small. */
  classicalRegime: boolean
  appliesTo: string
  occupancyLimit: string
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * The average occupancy of a state, under all three statistics at once.
 *
 * All three, because the interesting fact is when they agree and when they do not. Well above the chemical potential
 * the occupancy is small and the three are indistinguishable — which is why classical statistical mechanics works at
 * all. Near and below it they diverge completely: a fermion state saturates at one, a boson state runs away, and the
 * Boltzmann formula gives an occupancy above one that a fermion cannot have.
 */
export function stateOccupancy(input: {
  statistics?: Statistics
  /** Joules, or eV if `unit` says so. */
  energy: number
  /** The chemical potential, in the same unit. For photons it is zero. */
  chemicalPotential?: number
  /** Kelvin. */
  temperature: number
  unit?: 'joules' | 'electron-volts'
}): OccupancyReport | StatMechError {
  const statistics = input.statistics ?? 'fermi-dirac'
  const facts = STATISTICS_FACTS[statistics]
  if (!facts) return fail('invalid-argument', `"${statistics}" is not one of: ${STATISTICS_KINDS.join(', ')}.`)
  const { temperature } = input
  if (!finite(temperature) || temperature <= 0) return fail('out-of-range', 'The temperature is in kelvin and has to be above zero.')
  if (!finite(input.energy)) return fail('not-finite', 'The energy has to be a finite number.')

  const scale = input.unit === 'electron-volts' ? ELECTRON_VOLT : 1
  const energy = input.energy * scale
  const mu = (input.chemicalPotential ?? 0) * scale
  const kt = BOLTZMANN_CONSTANT * temperature
  const x = (energy - mu) / kt

  const occupancyFor = (kind: Statistics): number => {
    if (kind === 'boltzmann') return Math.exp(-x)
    if (kind === 'fermi-dirac') return 1 / (Math.exp(x) + 1)
    // Bose-Einstein: undefined at or below the chemical potential.
    if (x <= 0) return Number.POSITIVE_INFINITY
    return 1 / (Math.exp(x) - 1)
  }

  if (statistics === 'bose-einstein' && x <= 0) {
    return fail(
      'no-solution',
      `A boson state at or below the chemical potential has an infinite occupancy, which is the mathematics telling you something real: this is the condensation point, and below it a macroscopic fraction of the particles piles into the ground state. The formula for a single state stops applying there.`
    )
  }

  const occupancy = occupancyFor(statistics)
  const others = STATISTICS_KINDS.filter((one) => one !== statistics).map((one) => ({
    statistics: one,
    occupancy: occupancyFor(one),
    label: STATISTICS_FACTS[one].label
  }))

  const classical = occupancy < 0.01
  const warnings: string[] = []
  if (!classical) {
    const boltzmann = occupancyFor('boltzmann')
    warnings.push(
      `The occupancy is ${occupancy.toFixed(4)}, which is not small, so the three statistics disagree here. Boltzmann would give ${boltzmann.toFixed(4)}${boltzmann > 1 ? ' — above one, which a fermion state cannot have at all' : ''}. This is the regime where the quantum nature of the particles matters.`
    )
  }
  if (statistics === 'fermi-dirac' && Math.abs(x) < 0.01) {
    warnings.push('This state is at the chemical potential, where a fermion state is exactly half full at any temperature. That is the definition of the Fermi level.')
  }

  return {
    statistics,
    label: facts.label,
    occupancy,
    others: Object.freeze(others),
    energyInKt: x,
    classicalRegime: classical,
    appliesTo: facts.appliesTo,
    occupancyLimit: facts.occupancyLimit,
    notes: Object.freeze([
      `${facts.label}: average occupancy ${occupancy.toFixed(6)} for a state ${x.toFixed(3)} kT above the chemical potential.`,
      `Applies to ${facts.appliesTo} ${facts.occupancyLimit}`,
      classical
        ? 'The occupancy is small, so all three statistics agree to within a fraction of a percent. That agreement is exactly why classical statistical mechanics works for ordinary gases.'
        : 'The occupancy is large enough that the three statistics give genuinely different answers, which is the quantum regime.',
      'The chemical potential is where a state is half full under Fermi-Dirac statistics, at any temperature. For photons it is zero, which is why a photon gas can have any number of photons in it.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

/** Handy for a Page that wants the scale factors beside a result. */
export const STATMECH_CONSTANTS = Object.freeze({
  boltzmann: BOLTZMANN_CONSTANT,
  gasConstant: GAS_CONSTANT,
  avogadro: AVOGADRO_CONSTANT,
  planck: PLANCK_CONSTANT,
  atomicMassUnit: ATOMIC_MASS_UNIT,
  electronVolt: ELECTRON_VOLT,
  roomTemperatureKt: BOLTZMANN_CONSTANT * 298.15,
  roomTemperatureKtElectronVolts: (BOLTZMANN_CONSTANT * 298.15) / ELECTRON_VOLT,
  note: 'kT at room temperature is about 0.0257 eV. Any process needing much more than that per molecule does not happen spontaneously at room temperature, and that one number explains a great deal of chemistry.'
})

/** Everything a Page should be able to show about what this engine is standing on. */
export const STATMECH_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Partition functions are summed over the levels given, measured from the lowest, so the exponentials do not overflow.',
  'Every level reports its energy in units of kT, which is the only measure that says whether it is reachable.',
  'Speed distributions report the most probable, mean and root-mean-square speeds, because they differ by 22% and each answers a different question.',
  'Heat capacities activate modes with the Einstein function rather than a step, because near its characteristic temperature a mode is partly active.',
  'Vibrational characteristic temperatures are usually thousands of kelvin, so vibration contributes almost nothing at room temperature even when the molecule can plainly vibrate.',
  'Microstate counts are reported as logarithms as well as counts, because the count overflows at about 170 particles and the physics is all in the logarithm.',
  'Entropy is a count of arrangements. "Disorder" is a metaphor and not the definition.',
  'Occupancies are reported under all three statistics, so where they agree and where they diverge is visible.',
  'A boson state at or below the chemical potential is refused, because the infinity there is the condensation point rather than an arithmetic slip.'
])
