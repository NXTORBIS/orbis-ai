/**
 * Relativity and the quantum of light: fast frames, mass and energy, photons and nuclei.
 *
 * The shared modern-physics engine for Orbis Pages. Every relativistic result names the frame it is measured in,
 * speeds at or above light are refused rather than returning an imaginary number, and photon energies come with the
 * scale that makes them meaningful.
 *
 * ## Why the frame is named on every result
 *
 * Time dilation is not something that happens to a moving clock; it is what one frame measures about another, and
 * each frame measures it about the other. "The moving clock runs slow" is only half a statement — the moving clock's
 * own frame says the same of yours, and both are right. Every result here says which frame measured what, because
 * without that the statements contradict each other.
 *
 * ## Why speeds at or above light are refused
 *
 * The Lorentz factor is 1/sqrt(1 - v²/c²), which is infinite at c and imaginary above it. Returning a complex
 * number or a huge one would present as a result what is actually a statement that the question has no answer: no
 * massive object reaches c, and there is no frame moving faster. The refusal says that.
 *
 * ## The distinctions this file refuses to blur
 *
 * ```
 * proper time     vs  coordinate time  -- what a clock carried along reads against what a frame measures
 * rest mass       vs  relativistic mass -- an invariant against a frame-dependent bookkeeping device
 * mass            vs  energy            -- related by c², and not the same quantity
 * total energy    vs  kinetic energy    -- one includes mc² and the other does not
 * frequency       vs  energy            -- for a photon they are proportional; for anything else they are not
 * binding energy  vs  mass defect       -- the same fact stated as energy and as missing mass
 * ```
 *
 * Pure. No network, no clock, no storage.
 */

import {
  SPEED_OF_LIGHT,
  PLANCK_CONSTANT,
  REDUCED_PLANCK,
  ELECTRON_MASS,
  PROTON_MASS,
  NEUTRON_MASS,
  ELEMENTARY_CHARGE,
  ELECTRON_VOLT,
  ATOMIC_MASS_UNIT,
  BOLTZMANN_CONSTANT,
  STEFAN_BOLTZMANN
} from './emConstants.ts'

export interface RelativityError {
  error: 'invalid-argument' | 'not-finite' | 'out-of-range' | 'faster-than-light' | 'no-solution' | 'outside-model' | 'too-many'
  message: string
}

export const isRelativityError = (value: unknown): value is RelativityError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: RelativityError['error'], message: string): RelativityError => ({ error, message })

const finite = (value: number): boolean => Number.isFinite(value)

export const RELATIVITY_LIMITS = Object.freeze({ samples: 2000, nuclides: 64 })

// ---------------------------------------------------------------- Lorentz

export interface LorentzReport {
  /** m/s. */
  speed: number
  /** As a fraction of light speed. */
  beta: number
  /** The Lorentz factor. 1 at rest, and unbounded as the speed approaches light. */
  gamma: number
  /** How much a moving clock's tick is stretched, as measured by the frame it moves in. */
  timeDilation: number
  /** How much a moving length is squashed along its motion, as measured by that frame. */
  lengthContraction: number
  /** Where the effect becomes noticeable at the precision given. */
  noticeable: boolean
  /** What the effect amounts to over a given interval, when one was asked about. */
  overInterval: { properSeconds: number; coordinateSeconds: number; differenceSeconds: number } | null
  /** What the effect amounts to over a given length. */
  overLength: { restMetres: number; contractedMetres: number; differenceMetres: number } | null
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * The Lorentz factor and what it does to time and length, with both frames named.
 *
 * The symmetry is the part that gets lost. A frame measuring a clock moving past it sees that clock running slow;
 * the clock's own frame sees the first frame's clocks running slow by the same factor. Neither is mistaken, because
 * they are not measuring the same thing — and the notes say so rather than leaving the reader to assume one frame is
 * privileged.
 */
export function lorentz(input: {
  /** m/s, or a fraction of light speed via `beta`. */
  speed?: number
  beta?: number
  /** Seconds, as measured by a clock carried along. */
  properTime?: number
  /** Metres, as measured at rest with the object. */
  restLength?: number
}): LorentzReport | RelativityError {
  let beta: number
  if (input.beta !== undefined) {
    beta = input.beta
  } else if (input.speed !== undefined) {
    beta = input.speed / SPEED_OF_LIGHT
  } else {
    return fail('invalid-argument', 'Give a speed in metres per second, or a fraction of light speed as beta.')
  }
  if (!finite(beta)) return fail('not-finite', 'The speed has to be a finite number.')
  if (beta < 0) return fail('invalid-argument', 'The speed cannot be negative. Direction does not change any of these factors.')
  if (beta >= 1) {
    return fail(
      'faster-than-light',
      beta === 1
        ? 'A speed of exactly c gives an infinite Lorentz factor. No massive object reaches it and no frame travels at it, so there is nothing here to compute.'
        : `A speed of ${beta.toFixed(4)}c is above light speed, where the Lorentz factor is imaginary. That is not a number to report — it is the mathematics saying there is no such frame.`
    )
  }

  const gamma = 1 / Math.sqrt(1 - beta * beta)

  let overInterval: LorentzReport['overInterval'] = null
  if (input.properTime !== undefined) {
    if (!finite(input.properTime) || input.properTime < 0) return fail('invalid-argument', 'The proper time cannot be negative.')
    const coordinate = input.properTime * gamma
    overInterval = {
      properSeconds: input.properTime,
      coordinateSeconds: coordinate,
      differenceSeconds: coordinate - input.properTime
    }
  }

  let overLength: LorentzReport['overLength'] = null
  if (input.restLength !== undefined) {
    if (!finite(input.restLength) || input.restLength < 0) return fail('invalid-argument', 'The rest length cannot be negative.')
    const contracted = input.restLength / gamma
    overLength = {
      restMetres: input.restLength,
      contractedMetres: contracted,
      differenceMetres: input.restLength - contracted
    }
  }

  const warnings: string[] = []
  if (gamma - 1 < 1e-9 && beta > 0) {
    warnings.push(
      `At ${beta.toExponential(2)}c the Lorentz factor differs from 1 by about ${(gamma - 1).toExponential(2)}, which is below what most instruments resolve. Relativity is still exactly true here and its effects are unmeasurable.`
    )
  }
  if (beta > 0.99) {
    warnings.push(
      `At ${beta.toFixed(5)}c the factor is ${gamma.toFixed(2)}. This close to light speed, adding energy buys almost no extra speed and almost all of it goes into momentum — which is why a particle accelerator measures energy rather than velocity.`
    )
  }

  return {
    speed: beta * SPEED_OF_LIGHT,
    beta,
    gamma,
    timeDilation: gamma,
    lengthContraction: 1 / gamma,
    noticeable: gamma - 1 > 1e-6,
    overInterval,
    overLength,
    notes: Object.freeze([
      `At ${beta.toFixed(6)}c the Lorentz factor is ${gamma.toFixed(6)}.`,
      'Time dilation is symmetrical. The frame watching a clock go past measures it running slow by this factor, and that clock’s own frame measures the watcher’s clocks running slow by the same factor. Both are correct, because they are not measuring the same pair of events.',
      'Length contraction is along the direction of motion only. Dimensions across it are unchanged, which is why a fast-moving cube is measured as a slab and not as a smaller cube.',
      overInterval === null
        ? 'Give a proper time to see the difference over an interval.'
        : `A clock reading ${overInterval.properSeconds} s of its own time is measured as ${overInterval.coordinateSeconds.toFixed(9)} s by the frame it moves in — a gap of ${overInterval.differenceSeconds.toExponential(4)} s.`
    ]),
    warnings: Object.freeze(warnings)
  }
}

export interface VelocityAdditionReport {
  /** m/s. The combined speed, which is never above light. */
  combined: number
  /** As a fraction of light speed. */
  beta: number
  /** What simple addition would have given, for comparison. */
  classicalSum: number
  /** How much the classical answer overshoots. */
  overshoot: number
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Relativistic velocity addition, which never produces a speed above light however the parts are chosen.
 *
 * That is the point of the calculation. Two speeds of 0.9c combine to 0.994c, not 1.8c, and the classical answer is
 * reported alongside so the size of the correction is visible. Adding c to anything gives exactly c, which is the
 * statement that light travels at the same speed in every frame.
 */
export function addVelocities(input: {
  /** m/s, or fractions of c. */
  first?: number
  second?: number
  firstBeta?: number
  secondBeta?: number
}): VelocityAdditionReport | RelativityError {
  const b1 = input.firstBeta ?? (input.first === undefined ? undefined : input.first / SPEED_OF_LIGHT)
  const b2 = input.secondBeta ?? (input.second === undefined ? undefined : input.second / SPEED_OF_LIGHT)
  if (b1 === undefined || b2 === undefined) {
    return fail('invalid-argument', 'Give both speeds, in metres per second or as fractions of light speed.')
  }
  for (const [name, value] of [['first', b1], ['second', b2]] as const) {
    if (!finite(value)) return fail('not-finite', `The ${name} speed has to be a finite number.`)
    if (Math.abs(value) > 1) {
      return fail('faster-than-light', `The ${name} speed is ${Math.abs(value).toFixed(4)}c, which is above light speed. No frame moves that fast.`)
    }
  }

  const combinedBeta = (b1 + b2) / (1 + b1 * b2)
  const classical = (b1 + b2) * SPEED_OF_LIGHT

  const warnings: string[] = []
  if (Math.abs(b1) === 1 || Math.abs(b2) === 1) {
    warnings.push(
      'One of the speeds is exactly c. Adding any speed to c gives exactly c again, which is not a coincidence in the algebra — it is the statement that light travels at the same speed in every frame, which is where all of this came from.'
    )
  }

  return {
    combined: combinedBeta * SPEED_OF_LIGHT,
    beta: combinedBeta,
    classicalSum: classical,
    overshoot: Math.abs(classical) < 1e-12 ? 0 : (classical - combinedBeta * SPEED_OF_LIGHT) / Math.abs(classical),
    notes: Object.freeze([
      `${b1.toFixed(4)}c and ${b2.toFixed(4)}c combine to ${combinedBeta.toFixed(6)}c.`,
      `Simple addition would give ${(b1 + b2).toFixed(4)}c — ${(((b1 + b2 - combinedBeta) / Math.max(Math.abs(b1 + b2), 1e-12)) * 100).toFixed(2)}% too high. At everyday speeds the two agree to more decimal places than anyone measures, which is why nobody noticed for two centuries.`,
      'The result never exceeds c for any pair of inputs below c. That is a property of the formula and not a constraint bolted onto it.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

export interface MassEnergyReport {
  /** Joules. The rest energy, mc². */
  restEnergy: number
  /** Joules. */
  totalEnergy: number
  kineticEnergy: number
  /** kg·m/s. */
  momentum: number
  /** MeV, because that is the unit particle physics uses. */
  restEnergyMev: number
  totalEnergyMev: number
  kineticEnergyMev: number
  /** The Lorentz factor this corresponds to. */
  gamma: number
  beta: number
  /** What the classical formula would have given for the kinetic energy. */
  classicalKinetic: number
  /** How far the classical formula is out. */
  classicalError: number
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Mass, energy and momentum for a moving particle, with the classical answer alongside.
 *
 * Relativistic mass is deliberately not reported. It is a bookkeeping device that makes the momentum formula look
 * Newtonian and makes everything else confusing — it is frame dependent, it is not what appears in E = mc², and
 * physicists stopped using it decades ago. Rest mass and total energy are the quantities here.
 *
 * The classical kinetic energy is reported so the correction is visible: it is under a percent below about 0.1c and
 * a factor of several above 0.9c, and knowing where the crossover is matters more than either formula.
 */
export function massEnergy(input: {
  /** kg, or use one of the shorthand particles. */
  mass?: number
  particle?: 'electron' | 'proton' | 'neutron'
  /** MeV/c², the unit particle masses are usually given in. */
  massMev?: number
  /** One of these fixes the motion. */
  speed?: number
  beta?: number
  gamma?: number
  kineticEnergyMev?: number
}): MassEnergyReport | RelativityError {
  let mass: number
  if (input.particle !== undefined) {
    mass = input.particle === 'electron' ? ELECTRON_MASS : input.particle === 'proton' ? PROTON_MASS : NEUTRON_MASS
  } else if (input.massMev !== undefined) {
    mass = (input.massMev * 1e6 * ELECTRON_VOLT) / (SPEED_OF_LIGHT * SPEED_OF_LIGHT)
  } else if (input.mass !== undefined) {
    mass = input.mass
  } else {
    return fail('invalid-argument', 'Give a mass in kilograms, a mass in MeV/c2, or one of electron, proton or neutron.')
  }
  if (!finite(mass) || mass <= 0) {
    return fail(
      'invalid-argument',
      'The mass has to be greater than zero. A massless particle always travels at c and its energy comes from its frequency instead, which is the photon calculation.'
    )
  }

  const restEnergy = mass * SPEED_OF_LIGHT * SPEED_OF_LIGHT

  let gamma: number
  const given = (['speed', 'beta', 'gamma', 'kineticEnergyMev'] as const).filter((one) => input[one] !== undefined)
  if (given.length === 0) return fail('invalid-argument', 'Give a speed, a beta, a Lorentz factor, or a kinetic energy in MeV.')
  if (given.length > 1) {
    return fail('invalid-argument', `Both ${given.join(' and ')} were given. Any one fixes the others, so pick one.`)
  }

  if (input.gamma !== undefined) {
    gamma = input.gamma
    if (!finite(gamma) || gamma < 1) return fail('out-of-range', 'The Lorentz factor is 1 at rest and above 1 for anything moving. Below 1 describes nothing.')
  } else if (input.kineticEnergyMev !== undefined) {
    if (!finite(input.kineticEnergyMev) || input.kineticEnergyMev < 0) return fail('invalid-argument', 'The kinetic energy cannot be negative.')
    gamma = 1 + (input.kineticEnergyMev * 1e6 * ELECTRON_VOLT) / restEnergy
  } else {
    const beta = input.beta ?? (input.speed as number) / SPEED_OF_LIGHT
    if (!finite(beta)) return fail('not-finite', 'The speed has to be a finite number.')
    if (Math.abs(beta) >= 1) {
      return fail('faster-than-light', `A massive particle at ${Math.abs(beta).toFixed(4)}c would need infinite energy. Nothing with mass reaches c.`)
    }
    gamma = 1 / Math.sqrt(1 - beta * beta)
  }

  const beta = Math.sqrt(1 - 1 / (gamma * gamma))
  const totalEnergy = gamma * restEnergy
  const kinetic = totalEnergy - restEnergy
  const momentum = (gamma * mass * beta * SPEED_OF_LIGHT)
  const classicalKinetic = 0.5 * mass * Math.pow(beta * SPEED_OF_LIGHT, 2)

  const warnings: string[] = []
  const error = kinetic === 0 ? 0 : (classicalKinetic - kinetic) / kinetic
  if (Math.abs(error) > 0.01) {
    warnings.push(
      `The classical kinetic energy formula is out by ${(error * 100).toFixed(1)}% here. Below about 0.1c it is under a percent out and above 0.9c it is out by a factor of several, so which formula to use is decided by the speed and not by taste.`
    )
  }
  if (gamma > 1000) {
    warnings.push(`A Lorentz factor of ${gamma.toExponential(2)} means the particle is within ${((1 - beta) * 1).toExponential(2)} of light speed. Its speed is no longer a useful way to describe it; its energy is.`)
  }

  return {
    restEnergy,
    totalEnergy,
    kineticEnergy: kinetic,
    momentum,
    restEnergyMev: restEnergy / (1e6 * ELECTRON_VOLT),
    totalEnergyMev: totalEnergy / (1e6 * ELECTRON_VOLT),
    kineticEnergyMev: kinetic / (1e6 * ELECTRON_VOLT),
    gamma,
    beta,
    classicalKinetic,
    classicalError: error,
    notes: Object.freeze([
      `Rest energy ${(restEnergy / (1e6 * ELECTRON_VOLT)).toFixed(4)} MeV, total ${(totalEnergy / (1e6 * ELECTRON_VOLT)).toFixed(4)} MeV, kinetic ${(kinetic / (1e6 * ELECTRON_VOLT)).toFixed(4)} MeV at ${beta.toFixed(6)}c.`,
      'Relativistic mass is not reported. It is a bookkeeping device that makes one formula look Newtonian and everything else confusing, it is frame dependent, and it is not the m in E = mc2.',
      `The energy-momentum relation E2 = (pc)2 + (mc2)2 holds here to ${Math.abs(Math.sqrt(Math.pow(momentum * SPEED_OF_LIGHT, 2) + restEnergy * restEnergy) - totalEnergy).toExponential(2)} J, which is rounding.`,
      'Total energy includes the rest energy and kinetic energy does not. Most of a slow particle’s energy is rest energy, and a proton at rest holds nearly a GeV of it.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

export interface DopplerReport {
  /** Hz, as observed. */
  observedFrequency: number
  /** Metres, as observed. */
  observedWavelength: number
  /** The shift factor. Above 1 is a blueshift. */
  factor: number
  /** The redshift parameter z, which is what astronomers quote. */
  redshift: number
  /** m/s. */
  relativeSpeed: number
  /** Whether the source is coming closer. */
  approaching: boolean
  /** What the classical Doppler formula gives, which differs at speed. */
  classicalFactor: number
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * The relativistic Doppler shift, with the classical formula alongside.
 *
 * They differ, and the difference is what makes the relativistic version necessary: the classical formula treats
 * source motion and observer motion differently, which requires a medium for the wave to be moving through. Light
 * has no medium, and only the relativistic formula depends on the relative speed alone — which is a testable claim
 * and has been tested.
 *
 * A transverse shift exists too, with no approach or recession at all. It is pure time dilation and the classical
 * formula predicts nothing there.
 */
export function relativisticDoppler(input: {
  /** Hz, at the source. */
  sourceFrequency?: number
  /** Metres, at the source. */
  sourceWavelength?: number
  /** m/s, or a fraction of c. Positive means receding. */
  relativeSpeed?: number
  beta?: number
  /** Degrees between the motion and the line of sight. 0 is directly away, 90 is transverse. */
  angleDegrees?: number
}): DopplerReport | RelativityError {
  let beta: number
  if (input.beta !== undefined) beta = input.beta
  else if (input.relativeSpeed !== undefined) beta = input.relativeSpeed / SPEED_OF_LIGHT
  else return fail('invalid-argument', 'Give a relative speed in metres per second, or as a fraction of light speed.')
  if (!finite(beta)) return fail('not-finite', 'The relative speed has to be a finite number.')
  if (Math.abs(beta) >= 1) {
    return fail('faster-than-light', `A relative speed of ${Math.abs(beta).toFixed(4)}c is above light speed. There is no such frame.`)
  }

  let sourceFrequency: number
  if (input.sourceFrequency !== undefined) {
    sourceFrequency = input.sourceFrequency
  } else if (input.sourceWavelength !== undefined) {
    if (!finite(input.sourceWavelength) || input.sourceWavelength <= 0) return fail('invalid-argument', 'The wavelength has to be greater than zero.')
    sourceFrequency = SPEED_OF_LIGHT / input.sourceWavelength
  } else {
    return fail('invalid-argument', 'Give the source frequency in hertz, or its wavelength in metres.')
  }
  if (!finite(sourceFrequency) || sourceFrequency <= 0) return fail('invalid-argument', 'The source frequency has to be greater than zero.')

  const angle = input.angleDegrees ?? 0
  if (!finite(angle)) return fail('not-finite', 'The angle has to be a finite number.')
  const radians = (angle * Math.PI) / 180
  const gamma = 1 / Math.sqrt(1 - beta * beta)

  // The general relativistic Doppler factor, with the angle in the observer's frame.
  const factor = 1 / (gamma * (1 + beta * Math.cos(radians)))
  const classicalFactor = 1 / (1 + beta * Math.cos(radians))

  const observedFrequency = sourceFrequency * factor
  const warnings: string[] = []
  if (Math.abs(Math.cos(radians)) < 1e-9) {
    warnings.push(
      `At 90 degrees there is no approach or recession at all, and the frequency still shifts by a factor of ${factor.toFixed(6)}. That is pure time dilation. The classical formula predicts no shift here, which is how the two were told apart experimentally.`
    )
  }
  if (Math.abs(factor - classicalFactor) / classicalFactor > 0.01) {
    warnings.push(
      `The relativistic and classical factors differ by ${((Math.abs(factor - classicalFactor) / classicalFactor) * 100).toFixed(2)}% here. Only the relativistic one depends on the relative speed alone, which is required when there is no medium for the wave to travel through.`
    )
  }

  return {
    observedFrequency,
    observedWavelength: SPEED_OF_LIGHT / observedFrequency,
    factor,
    redshift: 1 / factor - 1,
    relativeSpeed: beta * SPEED_OF_LIGHT,
    approaching: beta * Math.cos(radians) < 0,
    classicalFactor,
    notes: Object.freeze([
      `Observed at ${observedFrequency.toExponential(6)} Hz, a factor of ${factor.toFixed(6)} — ${factor > 1 ? 'a blueshift' : factor < 1 ? 'a redshift' : 'no shift'}.`,
      `The redshift parameter z is ${(1 / factor - 1).toFixed(6)}, which is what astronomers quote. It is the fractional wavelength increase, so z = 1 means the wavelength doubled.`,
      'The relativistic formula depends only on the relative speed. The classical one treats a moving source differently from a moving observer, which needs a medium — and light has none.',
      'A cosmological redshift is not this calculation. Distant galaxies are not moving through space at the speed a Doppler reading implies; space between is expanding, which is a different geometry with a different formula.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- photons

export interface PhotonReport {
  /** Hz. */
  frequency: number
  /** Metres. */
  wavelength: number
  /** Joules. */
  energy: number
  /** eV, which is the unit that makes atomic energies legible. */
  energyElectronVolts: number
  /** kg·m/s. A photon has momentum without mass. */
  momentum: number
  /** Where in the spectrum this sits. */
  band: string
  /** What temperature has this as its kT, for a sense of scale. */
  equivalentTemperature: number
  /** How this compares with a chemical bond, roughly 3 to 6 eV. */
  canBreakBonds: boolean
  /** How this compares with kT at room temperature. */
  timesRoomThermalEnergy: number
  notes: readonly string[]
  warnings: readonly string[]
}

const BANDS: readonly { upTo: number; name: string }[] = Object.freeze([
  { upTo: 1e-11, name: 'gamma ray' },
  { upTo: 1e-8, name: 'X-ray' },
  { upTo: 4e-7, name: 'ultraviolet' },
  { upTo: 7e-7, name: 'visible light' },
  { upTo: 1e-3, name: 'infrared' },
  { upTo: 1e-1, name: 'microwave' },
  { upTo: Number.POSITIVE_INFINITY, name: 'radio' }
])

/**
 * A photon's energy, momentum and place in the spectrum, from any one of its properties.
 *
 * The energy is reported in electronvolts alongside joules because that is the unit that makes it mean something: a
 * chemical bond is 3 to 6 eV, a visible photon is 1.7 to 3.1 eV, and an ultraviolet photon is above 3.1 — which is
 * exactly why ultraviolet light damages molecules and visible light does not. A joule figure hides that entirely.
 */
export function photon(input: {
  frequency?: number
  wavelength?: number
  energy?: number
  energyElectronVolts?: number
}): PhotonReport | RelativityError {
  const given = (['frequency', 'wavelength', 'energy', 'energyElectronVolts'] as const).filter((one) => input[one] !== undefined)
  if (given.length === 0) return fail('invalid-argument', 'Give a frequency, a wavelength, or an energy in joules or electronvolts.')
  if (given.length > 1) return fail('invalid-argument', `Both ${given.join(' and ')} were given. Any one fixes the others, so pick one.`)

  let frequency: number
  if (input.frequency !== undefined) frequency = input.frequency
  else if (input.wavelength !== undefined) {
    if (!finite(input.wavelength) || input.wavelength <= 0) return fail('invalid-argument', 'The wavelength has to be greater than zero.')
    frequency = SPEED_OF_LIGHT / input.wavelength
  } else if (input.energy !== undefined) {
    if (!finite(input.energy) || input.energy <= 0) return fail('invalid-argument', 'The energy has to be greater than zero.')
    frequency = input.energy / PLANCK_CONSTANT
  } else {
    const ev = input.energyElectronVolts as number
    if (!finite(ev) || ev <= 0) return fail('invalid-argument', 'The energy has to be greater than zero.')
    frequency = (ev * ELECTRON_VOLT) / PLANCK_CONSTANT
  }
  if (!finite(frequency) || frequency <= 0) return fail('invalid-argument', 'The frequency has to be greater than zero.')

  const wavelength = SPEED_OF_LIGHT / frequency
  const energy = PLANCK_CONSTANT * frequency
  const ev = energy / ELECTRON_VOLT
  const band = BANDS.find((one) => wavelength < one.upTo)?.name ?? 'radio'

  const warnings: string[] = []
  if (ev > 3.1) {
    warnings.push(
      `At ${ev.toFixed(3)} eV this photon carries more energy than a typical chemical bond holds, so it can break one. That single threshold — around 3 to 4 eV, at the violet edge of what we can see — is the line between light that warms things and light that damages them.`
    )
  }

  return {
    frequency,
    wavelength,
    energy,
    energyElectronVolts: ev,
    momentum: energy / SPEED_OF_LIGHT,
    band,
    equivalentTemperature: energy / BOLTZMANN_CONSTANT,
    canBreakBonds: ev > 3.1,
    timesRoomThermalEnergy: energy / (BOLTZMANN_CONSTANT * 298.15),
    notes: Object.freeze([
      `${frequency.toExponential(5)} Hz, ${(wavelength * 1e9).toFixed(4)} nm, ${ev.toFixed(5)} eV — ${band}.`,
      `That is ${(energy / (BOLTZMANN_CONSTANT * 298.15)).toFixed(2)} times kT at room temperature. A photon well below one kT gets lost in the thermal noise; one well above it can do something no amount of warmth can.`,
      `Its momentum is ${(energy / SPEED_OF_LIGHT).toExponential(4)} kg*m/s, with no mass at all. Momentum does not require mass, which is why light can push a solar sail.`,
      'Electronvolts, not joules, are the useful unit here: a chemical bond is 3 to 6 eV, visible light is 1.7 to 3.1, and the gap between those explains sunburn.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

export interface PhotoelectricReport {
  /** eV. The energy needed to free an electron. */
  workFunction: number
  /** eV. */
  photonEnergy: number
  /** Whether any electrons come out at all. */
  emits: boolean
  /** eV. The most energetic electron. Zero if none are emitted. */
  maximumKineticEnergy: number
  /** Volts. The voltage needed to stop the fastest electron. */
  stoppingVoltage: number
  /** Hz. The frequency below which nothing happens however bright the light. */
  thresholdFrequency: number
  /** Metres. */
  thresholdWavelength: number
  /** m/s. */
  maximumSpeed: number
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * The photoelectric effect, which is where the quantum came from.
 *
 * The threshold is the whole point and the thing classical physics could not explain: below a certain frequency no
 * electrons come out however intense the light, and above it they come out immediately however dim it is. A wave
 * would pour energy in gradually and eventually free an electron at any frequency. It does not, and that is why
 * light comes in quanta.
 */
export function photoelectric(input: {
  /** eV. */
  workFunction: number
  /** One of these. */
  photonEnergyElectronVolts?: number
  frequency?: number
  wavelength?: number
}): PhotoelectricReport | RelativityError {
  const { workFunction } = input
  if (!finite(workFunction) || workFunction <= 0) return fail('invalid-argument', 'The work function has to be greater than zero electronvolts.')

  const built = photon({
    energyElectronVolts: input.photonEnergyElectronVolts,
    frequency: input.frequency,
    wavelength: input.wavelength
  })
  if (isRelativityError(built)) return built

  const photonEnergy = built.energyElectronVolts
  const kinetic = Math.max(0, photonEnergy - workFunction)
  const thresholdFrequency = (workFunction * ELECTRON_VOLT) / PLANCK_CONSTANT

  // The speed from the kinetic energy, relativistically if it is a meaningful fraction of the electron rest energy.
  const kineticJoules = kinetic * ELECTRON_VOLT
  const restEnergy = ELECTRON_MASS * SPEED_OF_LIGHT * SPEED_OF_LIGHT
  const gamma = 1 + kineticJoules / restEnergy
  const maximumSpeed = SPEED_OF_LIGHT * Math.sqrt(1 - 1 / (gamma * gamma))

  const warnings: string[] = []
  if (kinetic === 0) {
    warnings.push(
      `A photon of ${photonEnergy.toFixed(3)} eV cannot free an electron from a surface with a ${workFunction} eV work function, and no amount of intensity changes that. Brighter light means more photons, not more energetic ones — which is exactly the observation that killed the wave-only picture of light.`
    )
  }
  if (gamma - 1 > 0.01) {
    warnings.push(`The fastest electron reaches ${(maximumSpeed / SPEED_OF_LIGHT).toFixed(4)}c, so its speed was worked out relativistically. The classical formula would be out by a few percent.`)
  }

  return {
    workFunction,
    photonEnergy,
    emits: kinetic > 0,
    maximumKineticEnergy: kinetic,
    stoppingVoltage: kinetic,
    thresholdFrequency,
    thresholdWavelength: SPEED_OF_LIGHT / thresholdFrequency,
    maximumSpeed,
    notes: Object.freeze([
      `A ${photonEnergy.toFixed(4)} eV photon on a ${workFunction} eV surface gives electrons up to ${kinetic.toFixed(4)} eV, stopped by ${kinetic.toFixed(4)} V.`,
      `The threshold is ${(thresholdFrequency / 1e12).toFixed(3)} THz, or ${((SPEED_OF_LIGHT / thresholdFrequency) * 1e9).toFixed(1)} nm. Below it nothing comes out however bright the light, and above it electrons appear immediately however dim it is.`,
      'The stopping voltage in volts equals the kinetic energy in electronvolts exactly, because that is what an electronvolt is defined as. It makes the experiment a direct measurement of Planck’s constant.',
      'Intensity sets how many electrons come out; frequency sets how fast they go. Classical wave physics predicts the opposite, which is why this experiment mattered so much.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

export interface BlackbodyReport {
  /** Kelvin. */
  temperature: number
  /** Metres. Where the spectrum peaks, by Wien's law. */
  peakWavelength: number
  /** Hz. The peak in frequency, which is not at the same place as the peak in wavelength. */
  peakFrequency: number
  /** W/m². Total radiated power per unit area, by Stefan-Boltzmann. */
  totalEmission: number
  /** The spectrum, for drawing. */
  spectrum: readonly { wavelength: number; spectralRadiance: number }[]
  /** What the classical Rayleigh-Jeans law would give at the peak, which is absurd. */
  classicalAtPeak: number
  /** The fraction of the output in the visible band. */
  visibleFraction: number
  band: string
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Blackbody radiation by Planck's law, with the classical prediction for comparison.
 *
 * The comparison is the reason quantum mechanics exists. The Rayleigh-Jeans law, which follows from classical
 * physics correctly, says the emission rises without limit as the wavelength shortens — every warm object should
 * blast out infinite ultraviolet. Planck's law matches reality, and the only way to get it is to assume energy comes
 * in discrete lumps.
 *
 * The peak in wavelength and the peak in frequency are at different places, which catches people out. They are not
 * the same distribution measured two ways; converting between them involves a Jacobian, and the peaks differ by
 * about 70%.
 */
export function blackbody(input: {
  /** Kelvin. */
  temperature: number
  /** m². */
  area?: number
  samples?: number
}): BlackbodyReport | RelativityError {
  const { temperature } = input
  if (!finite(temperature) || temperature <= 0) return fail('out-of-range', 'The temperature is in kelvin and has to be above zero.')

  // Wien's displacement law, from the published constant.
  const peakWavelength = 2.897771955e-3 / temperature
  // The frequency peak, which uses a different constant because it is a different maximisation.
  const peakFrequency = 5.878925757e10 * temperature
  const totalEmission = STEFAN_BOLTZMANN * Math.pow(temperature, 4) * (input.area ?? 1)

  const count = Math.round(input.samples ?? 200)
  if (!Number.isInteger(count) || count < 2 || count > RELATIVITY_LIMITS.samples) {
    return fail('invalid-argument', `The sample count has to be between 2 and ${RELATIVITY_LIMITS.samples}.`)
  }

  const planck = (wavelength: number): number => {
    const a = (2 * Math.PI * PLANCK_CONSTANT * Math.pow(SPEED_OF_LIGHT, 2)) / Math.pow(wavelength, 5)
    const x = (PLANCK_CONSTANT * SPEED_OF_LIGHT) / (wavelength * BOLTZMANN_CONSTANT * temperature)
    if (x > 700) return 0
    return a / (Math.exp(x) - 1)
  }
  const rayleighJeans = (wavelength: number): number =>
    (2 * Math.PI * SPEED_OF_LIGHT * BOLTZMANN_CONSTANT * temperature) / Math.pow(wavelength, 4)

  const spectrum: BlackbodyReport['spectrum'][number][] = []
  const from = peakWavelength / 10
  const to = peakWavelength * 10
  for (let i = 0; i < count; i += 1) {
    const wavelength = from * Math.pow(to / from, i / (count - 1))
    spectrum.push({ wavelength, spectralRadiance: planck(wavelength) })
  }

  // The visible fraction, by integrating Planck's law over 380 to 750 nm.
  let visible = 0
  const pieces = 2000
  const h = (750e-9 - 380e-9) / pieces
  for (let i = 0; i < pieces; i += 1) {
    const a = 380e-9 + h * i
    visible += ((planck(a) + planck(a + h)) / 2) * h
  }
  // Against the Stefan-Boltzmann total for the same geometry, so the fraction is comparable.
  const visibleFraction = Math.min(1, visible / (STEFAN_BOLTZMANN * Math.pow(temperature, 4)))

  const band = BANDS.find((one) => peakWavelength < one.upTo)?.name ?? 'radio'
  const warnings: string[] = []
  if (temperature < 1000) {
    warnings.push(
      `At ${temperature} K the peak is at ${(peakWavelength * 1e6).toFixed(2)} microns, deep in the infrared, and only ${(visibleFraction * 100).toExponential(2)}% of the output is visible. This object glows and you cannot see it glowing.`
    )
  }

  return {
    temperature,
    peakWavelength,
    peakFrequency,
    totalEmission,
    spectrum: Object.freeze(spectrum),
    classicalAtPeak: rayleighJeans(peakWavelength),
    visibleFraction,
    band,
    notes: Object.freeze([
      `At ${temperature} K the spectrum peaks at ${(peakWavelength * 1e9).toFixed(1)} nm (${band}) and radiates ${totalEmission.toExponential(4)} W/m2.`,
      `The classical Rayleigh-Jeans law gives ${rayleighJeans(peakWavelength).toExponential(3)} at the peak against Planck's ${planck(peakWavelength).toExponential(3)} — and it keeps rising without limit as the wavelength shortens, predicting infinite ultraviolet from every warm object. Fixing that required energy to come in lumps, and that is where quantum mechanics started.`,
      `The peak in frequency is at ${(peakFrequency / 1e12).toFixed(2)} THz, which corresponds to ${((SPEED_OF_LIGHT / peakFrequency) * 1e9).toFixed(1)} nm — not the same as the wavelength peak. They are different maximisations of the same distribution and differ by about 70%.`,
      `${(visibleFraction * 100).toFixed(3)}% of the output falls in the visible band. That fraction is why an incandescent bulb wastes most of its energy as heat and why the sun, at 5772 K, looks bright.`
    ]),
    warnings: Object.freeze(warnings)
  }
}

export interface DeBroglieReport {
  /** Metres. */
  wavelength: number
  /** kg·m/s. */
  momentum: number
  /** Metres. The size of the thing, when one was given, for comparison. */
  comparedWith: number | null
  /** Whether the wavelength is large enough for quantum behaviour to show. */
  quantumRegime: boolean | null
  /** Metres. The thermal de Broglie wavelength, when a temperature was given. */
  thermalWavelength: number | null
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * The de Broglie wavelength of a moving particle, compared against the size of something.
 *
 * The comparison is the whole content of the idea. An electron in an atom has a wavelength comparable to the atom,
 * so it behaves as a wave and the atom has orbitals rather than orbits. A thrown cricket ball has a wavelength of
 * about 10⁻³⁴ m, which is not small compared with anything — it is smaller than any length that means anything, and
 * that is why the ball has a trajectory.
 */
export function deBroglie(input: {
  /** kg, or one of the shorthand particles. */
  mass?: number
  particle?: 'electron' | 'proton' | 'neutron'
  /** m/s. */
  speed?: number
  /** kg·m/s, given directly. */
  momentum?: number
  /** eV, for an electron accelerated through a voltage. */
  kineticEnergyElectronVolts?: number
  /** Metres, to compare the wavelength against. */
  comparedWith?: number
  /** Kelvin, for the thermal wavelength. */
  temperature?: number
}): DeBroglieReport | RelativityError {
  let mass: number | null = null
  if (input.particle !== undefined) {
    mass = input.particle === 'electron' ? ELECTRON_MASS : input.particle === 'proton' ? PROTON_MASS : NEUTRON_MASS
  } else if (input.mass !== undefined) {
    mass = input.mass
  }
  if (mass !== null && (!finite(mass) || mass <= 0)) return fail('invalid-argument', 'The mass has to be greater than zero.')

  let momentum: number
  if (input.momentum !== undefined) {
    momentum = input.momentum
    if (!finite(momentum) || momentum <= 0) return fail('invalid-argument', 'The momentum has to be greater than zero.')
  } else if (input.kineticEnergyElectronVolts !== undefined) {
    if (mass === null) return fail('invalid-argument', 'A kinetic energy needs a mass to become a momentum. Give a mass, or name a particle.')
    const kinetic = input.kineticEnergyElectronVolts * ELECTRON_VOLT
    if (!finite(kinetic) || kinetic <= 0) return fail('invalid-argument', 'The kinetic energy has to be greater than zero.')
    const restEnergy = mass * SPEED_OF_LIGHT * SPEED_OF_LIGHT
    // The relativistic relation, which reduces to sqrt(2mE) at low energy and stays right at high.
    momentum = Math.sqrt(Math.pow(kinetic + restEnergy, 2) - restEnergy * restEnergy) / SPEED_OF_LIGHT
  } else if (input.speed !== undefined) {
    if (mass === null) return fail('invalid-argument', 'A speed needs a mass to become a momentum. Give a mass, or name a particle.')
    if (!finite(input.speed) || input.speed <= 0) return fail('invalid-argument', 'The speed has to be greater than zero.')
    if (input.speed >= SPEED_OF_LIGHT) return fail('faster-than-light', 'A massive particle cannot travel at or above light speed.')
    const gamma = 1 / Math.sqrt(1 - Math.pow(input.speed / SPEED_OF_LIGHT, 2))
    momentum = gamma * mass * input.speed
  } else {
    return fail('invalid-argument', 'Give a momentum, or a speed or kinetic energy together with a mass.')
  }

  const wavelength = PLANCK_CONSTANT / momentum

  let thermalWavelength: number | null = null
  if (input.temperature !== undefined) {
    if (mass === null) return fail('invalid-argument', 'A thermal wavelength needs a mass.')
    if (!finite(input.temperature) || input.temperature <= 0) return fail('out-of-range', 'The temperature is in kelvin and has to be above zero.')
    thermalWavelength = PLANCK_CONSTANT / Math.sqrt(2 * Math.PI * mass * BOLTZMANN_CONSTANT * input.temperature)
  }

  let quantumRegime: boolean | null = null
  const warnings: string[] = []
  if (input.comparedWith !== undefined) {
    if (!finite(input.comparedWith) || input.comparedWith <= 0) return fail('invalid-argument', 'The comparison length has to be greater than zero.')
    quantumRegime = wavelength > input.comparedWith * 0.1
    if (!quantumRegime) {
      warnings.push(
        `The wavelength is ${(wavelength / input.comparedWith).toExponential(2)} times the length given, so wave behaviour is unobservable at that scale. That ratio, and nothing else, is why large things have trajectories and electrons do not.`
      )
    }
  }

  return {
    wavelength,
    momentum,
    comparedWith: input.comparedWith ?? null,
    quantumRegime,
    thermalWavelength,
    notes: Object.freeze([
      `A momentum of ${momentum.toExponential(4)} kg*m/s gives a wavelength of ${wavelength.toExponential(4)} m, or ${(wavelength * 1e12).toFixed(4)} pm.`,
      'The wavelength is Planck’s constant over the momentum, so heavier and faster means shorter. A cricket ball comes out around 1e-34 m, which is not small compared with anything — it is smaller than any length that means anything.',
      input.comparedWith === undefined
        ? 'Give a length to compare against. The wavelength on its own says nothing; whether it is comparable to the thing it is passing through is the whole question.'
        : `Against ${input.comparedWith.toExponential(2)} m this is a ratio of ${(wavelength / input.comparedWith).toExponential(3)}. Above about 0.1 and wave behaviour shows; far below and it does not.`,
      thermalWavelength === null
        ? 'Give a temperature for the thermal de Broglie wavelength, which is what decides when a gas starts behaving quantum-mechanically.'
        : `The thermal wavelength at ${input.temperature} K is ${(thermalWavelength * 1e12).toFixed(4)} pm. When that becomes comparable to the spacing between particles, the gas stops being classical — which is how a Bose-Einstein condensate happens.`
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- nuclei

export interface BindingReport {
  /** Atomic mass units. How much lighter the nucleus is than its parts. */
  massDefect: number
  /** MeV. The same fact as an energy. */
  bindingEnergy: number
  /** MeV per nucleon, which is the figure that says how tightly bound it is. */
  bindingEnergyPerNucleon: number
  protons: number
  neutrons: number
  massNumber: number
  /** Where this sits relative to iron-56, the most tightly bound nucleus. */
  comparedWithIron: string
  /** Whether fusing or splitting this releases energy. */
  releasesEnergyBy: 'fusion' | 'fission' | 'neither'
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Nuclear binding energy from the mass defect, and which direction releases energy.
 *
 * The comparison with iron-56 is the point. Binding energy per nucleon rises to a maximum at iron and falls away on
 * both sides, so light nuclei release energy by fusing and heavy ones by splitting — and iron does neither, which is
 * why a massive star's core stops there and then collapses.
 *
 * The mass defect is small: about 0.8% for a heavy nucleus. Multiplied by c² it is millions of electronvolts, which
 * is a million times a chemical bond, and that ratio is the whole of why nuclear energy is different in kind.
 */
export function bindingEnergy(input: {
  protons: number
  neutrons: number
  /** Atomic mass units. The measured mass of the nucleus or atom. */
  atomicMass: number
  /** Whether the mass given includes the electrons, as a tabulated atomic mass does. */
  includesElectrons?: boolean
}): BindingReport | RelativityError {
  const { protons, neutrons, atomicMass } = input
  if (!Number.isInteger(protons) || protons < 1) return fail('invalid-argument', 'The proton count is a whole number of at least 1.')
  if (!Number.isInteger(neutrons) || neutrons < 0) return fail('invalid-argument', 'The neutron count is a whole number of zero or more.')
  if (!finite(atomicMass) || atomicMass <= 0) return fail('invalid-argument', 'The atomic mass has to be greater than zero.')

  const massNumber = protons + neutrons
  const protonMassAmu = PROTON_MASS / ATOMIC_MASS_UNIT
  const neutronMassAmu = NEUTRON_MASS / ATOMIC_MASS_UNIT
  const electronMassAmu = ELECTRON_MASS / ATOMIC_MASS_UNIT

  // Hydrogen atoms rather than bare protons when the mass includes electrons, which is what a mass table gives.
  const includesElectrons = input.includesElectrons ?? true
  const partsMass = includesElectrons
    ? protons * (protonMassAmu + electronMassAmu) + neutrons * neutronMassAmu
    : protons * protonMassAmu + neutrons * neutronMassAmu

  const massDefect = partsMass - atomicMass
  if (massDefect <= 0) {
    return fail(
      'no-solution',
      `The nucleus came out heavier than its separate parts, by ${(-massDefect).toExponential(3)} u. That would mean it takes energy to hold together, which no bound nucleus does — check whether the mass given includes the electrons.`
    )
  }

  // 931.49410242 MeV per atomic mass unit, from the CODATA conversion.
  const mevPerAmu = (ATOMIC_MASS_UNIT * SPEED_OF_LIGHT * SPEED_OF_LIGHT) / (1e6 * ELECTRON_VOLT)
  const binding = massDefect * mevPerAmu
  const perNucleon = binding / massNumber

  const ironPerNucleon = 8.79
  const comparedWithIron =
    massNumber < 56
      ? `Lighter than iron-56, so fusing this releases energy. At ${perNucleon.toFixed(3)} MeV per nucleon it is ${(ironPerNucleon - perNucleon).toFixed(3)} MeV short of iron's ${ironPerNucleon}.`
      : massNumber > 56
        ? `Heavier than iron-56, so splitting this releases energy. At ${perNucleon.toFixed(3)} MeV per nucleon it is ${(ironPerNucleon - perNucleon).toFixed(3)} MeV below iron's peak.`
        : 'This is at the peak of the binding energy curve. Neither fusing nor splitting it releases energy, which is why a massive star ends up with an iron core it cannot burn.'

  const warnings: string[] = []
  const fraction = massDefect / partsMass
  if (fraction > 0.01) {
    warnings.push(`The mass defect is ${(fraction * 100).toFixed(3)}% of the total, which is high — the usual range is under 1%. Worth checking the inputs.`)
  }

  return {
    massDefect,
    bindingEnergy: binding,
    bindingEnergyPerNucleon: perNucleon,
    protons,
    neutrons,
    massNumber,
    comparedWithIron,
    releasesEnergyBy: massNumber < 56 ? 'fusion' : massNumber > 56 ? 'fission' : 'neither',
    notes: Object.freeze([
      `The nucleus is ${massDefect.toFixed(6)} u lighter than its parts, which is ${binding.toFixed(3)} MeV of binding energy — ${perNucleon.toFixed(4)} MeV per nucleon.`,
      comparedWithIron,
      `That mass defect is ${(fraction * 100).toFixed(4)}% of the mass. It is tiny, and multiplied by c2 it comes to millions of electronvolts against a chemical bond's few — which is the whole reason nuclear energy is different in kind rather than in degree.`,
      includesElectrons
        ? 'The mass was taken to include the electrons, so hydrogen atoms rather than bare protons were used for the parts. A tabulated atomic mass includes them; a nuclear mass does not, and the difference is thousandths of a unit.'
        : 'The mass was taken as the bare nucleus, so bare protons were used for the parts.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

export interface DecayReport {
  /** Seconds. */
  halfLife: number
  /** Per second. */
  decayConstant: number
  /** Seconds. Always longer than the half-life. */
  meanLifetime: number
  /** How many remain after the elapsed time. */
  remaining: number
  /** The fraction remaining. */
  fractionRemaining: number
  /** How many decayed. */
  decayed: number
  /** Decays per second at the start and at the end. */
  initialActivity: number
  finalActivity: number
  /** How many half-lives passed. */
  halfLivesElapsed: number
  /** Becquerels per gram, when a molar mass was given. */
  specificActivity: number | null
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Radioactive decay, with activity as well as count.
 *
 * Activity is what a detector measures and it falls with the same half-life as the count, which is why a sample that
 * has decayed to a millionth is not merely a millionth as dangerous in the obvious sense — it is emitting a millionth
 * as fast. The mean lifetime is reported separately because it is 1.44 times the half-life and confusing them is a
 * 44% error.
 */
export function radioactiveDecay(input: {
  /** Seconds. */
  halfLife: number
  /** How many atoms at the start. */
  initialCount: number
  /** Seconds. */
  elapsed: number
  /** g/mol, for a specific activity. */
  molarMass?: number
}): DecayReport | RelativityError {
  const { halfLife, initialCount, elapsed } = input
  if (!finite(halfLife) || halfLife <= 0) return fail('invalid-argument', 'The half-life has to be greater than zero seconds.')
  if (!finite(initialCount) || initialCount <= 0) return fail('invalid-argument', 'The initial count has to be greater than zero.')
  if (!finite(elapsed) || elapsed < 0) return fail('invalid-argument', 'The elapsed time cannot be negative.')

  const lambda = Math.LN2 / halfLife
  const fraction = Math.exp(-lambda * elapsed)
  const remaining = initialCount * fraction

  let specificActivity: number | null = null
  if (input.molarMass !== undefined) {
    if (!finite(input.molarMass) || input.molarMass <= 0) return fail('invalid-argument', 'The molar mass has to be greater than zero.')
    // Decays per second per gram of pure material.
    specificActivity = (lambda * 6.02214076e23) / input.molarMass
  }

  const warnings: string[] = []
  const halfLives = elapsed / halfLife
  if (remaining < 1 && initialCount >= 1) {
    warnings.push(
      `After ${halfLives.toFixed(1)} half-lives the expected count is ${remaining.toExponential(3)}, which is below one atom. Exponential decay is a statement about averages over many atoms; for one atom there is only a probability per second and no schedule at all.`
    )
  }
  if (halfLives > 40) {
    warnings.push(`That is ${halfLives.toFixed(0)} half-lives. Nothing measurable remains, and the arithmetic below the detection limit is not telling you anything.`)
  }

  return {
    halfLife,
    decayConstant: lambda,
    meanLifetime: 1 / lambda,
    remaining,
    fractionRemaining: fraction,
    decayed: initialCount - remaining,
    initialActivity: lambda * initialCount,
    finalActivity: lambda * remaining,
    halfLivesElapsed: halfLives,
    specificActivity,
    notes: Object.freeze([
      `After ${elapsed} s — ${halfLives.toFixed(4)} half-lives — ${(fraction * 100).toFixed(6)}% remains.`,
      `The mean lifetime is ${(1 / lambda).toExponential(4)} s, which is 1/ln2 = 1.443 times the half-life. They are different quantities and swapping them is a 44% error.`,
      `Activity falls from ${(lambda * initialCount).toExponential(4)} to ${(lambda * remaining).toExponential(4)} decays per second. Activity is what a detector reads, and it decays with exactly the same half-life as the count.`,
      specificActivity === null
        ? 'Give a molar mass for the specific activity in decays per second per gram.'
        : `A gram of the pure material has an activity of ${specificActivity.toExponential(4)} Bq. Short half-life means high specific activity, which is why the most dangerous isotopes are usually the ones that do not last.`
    ]),
    warnings: Object.freeze(warnings)
  }
}

/** Handy for a Page that wants the scales beside a result. */
export const MODERN_PHYSICS_CONSTANTS = Object.freeze({
  speedOfLight: SPEED_OF_LIGHT,
  planck: PLANCK_CONSTANT,
  reducedPlanck: REDUCED_PLANCK,
  electronMass: ELECTRON_MASS,
  protonMass: PROTON_MASS,
  neutronMass: NEUTRON_MASS,
  elementaryCharge: ELEMENTARY_CHARGE,
  electronVolt: ELECTRON_VOLT,
  atomicMassUnit: ATOMIC_MASS_UNIT,
  electronRestEnergyMev: (ELECTRON_MASS * SPEED_OF_LIGHT * SPEED_OF_LIGHT) / (1e6 * ELECTRON_VOLT),
  protonRestEnergyMev: (PROTON_MASS * SPEED_OF_LIGHT * SPEED_OF_LIGHT) / (1e6 * ELECTRON_VOLT),
  amuInMev: (ATOMIC_MASS_UNIT * SPEED_OF_LIGHT * SPEED_OF_LIGHT) / (1e6 * ELECTRON_VOLT),
  note: 'An electron rest energy is 0.511 MeV and a proton is 938 MeV. Those two numbers set the scale for everything in particle physics.'
})

/** Everything a Page should be able to show about what this engine is standing on. */
export const RELATIVITY_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Every relativistic result names the frame that measured it, because time dilation is symmetrical and both frames measure the other as slow.',
  'Speeds at or above light are refused rather than returning an infinite or imaginary number. There is no such frame, and that is the answer.',
  'Relativistic mass is not reported. It is frame-dependent bookkeeping and is not the m in E = mc2.',
  'The classical formula is reported alongside the relativistic one wherever they differ, so the size of the correction is visible.',
  'This is special relativity: flat spacetime, constant velocities, no gravity. A cosmological redshift is a different geometry with a different formula and is not this calculation.',
  'Photon energies are given in electronvolts as well as joules, because the electronvolt is what makes them comparable with a chemical bond.',
  'Blackbody results report the classical Rayleigh-Jeans prediction, which diverges — that divergence is where quantum mechanics came from.',
  'The wavelength and frequency peaks of a blackbody spectrum are at different places and differ by about 70%. They are not the same peak measured two ways.',
  'A de Broglie wavelength means nothing on its own. Only its ratio to the size of what it is passing through decides whether wave behaviour shows.',
  'Exponential decay describes averages over many atoms. For a single atom there is a probability per second and no schedule.'
])
