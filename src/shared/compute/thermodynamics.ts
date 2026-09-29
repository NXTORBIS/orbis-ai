/**
 * Thermodynamics: gases, processes, cycles, and the limits nothing gets past.
 *
 * The shared thermodynamics engine for Orbis Pages. Every process names which quantity was held constant, every
 * cycle reports its efficiency against the Carnot limit, and a cycle that beats that limit is refused rather than
 * returned — because an efficiency above Carnot is not a good result, it is an arithmetic error or an impossible
 * machine.
 *
 * ## Why every result is checked against the second law
 *
 * The first law is bookkeeping and will balance for machines that cannot exist. The second law is the one that
 * refuses, and it is the one people accidentally violate: a heat engine between 300 K and 500 K cannot exceed 40%
 * however it is arranged, and a calculation that produces 45% has gone wrong somewhere upstream. This engine checks
 * and says so.
 *
 * ## Why the ideal gas law is not used silently
 *
 * PV = nRT is accurate to about 1% for air at room conditions and wrong by tens of percent near a phase boundary or
 * at high pressure. Every result says whether the gas was treated as ideal, and where a compressibility factor was
 * supplied it is used and reported. The point at which the approximation breaks is flagged rather than crossed
 * quietly.
 *
 * ## The distinctions this file refuses to blur
 *
 * ```
 * heat          vs  temperature      -- energy crossing a boundary against how hot something is
 * heat          vs  work             -- disordered transfer against ordered; the second law only distinguishes these
 * internal energy vs  enthalpy       -- U against U + PV, and which one a process conserves
 * reversible    vs  quasi-static     -- no entropy generated against merely slow
 * isothermal    vs  adiabatic        -- constant temperature against no heat exchanged; never both
 * efficiency    vs  coefficient of performance -- work out over heat in against heat moved over work in
 * ```
 *
 * Pure. No network, no clock, no storage.
 */

import { GAS_CONSTANT, AVOGADRO_CONSTANT, BOLTZMANN_CONSTANT, ABSOLUTE_ZERO_CELSIUS, STANDARD_ATMOSPHERE } from './emConstants.ts'

export interface ThermoError {
  error: 'invalid-argument' | 'not-finite' | 'out-of-range' | 'second-law' | 'outside-model' | 'no-solution' | 'too-many'
  message: string
}

export const isThermoError = (value: unknown): value is ThermoError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: ThermoError['error'], message: string): ThermoError => ({ error, message })

const finite = (value: number): boolean => Number.isFinite(value)

export const THERMO_LIMITS = Object.freeze({ samples: 2000, stages: 32, species: 64 })

/** Kelvin. Nothing here takes Celsius, because a temperature ratio in Celsius is meaningless. */
const checkTemperature = (value: number, name: string): ThermoError | null => {
  if (!finite(value)) return fail('not-finite', `"${name}" has to be a finite number.`)
  if (value <= 0) {
    return fail(
      'out-of-range',
      `"${name}" is ${value}. Temperatures here are in kelvin, where nothing is at or below zero — if this was meant as Celsius, add ${(-ABSOLUTE_ZERO_CELSIUS).toFixed(2)}.`
    )
  }
  return null
}

// ---------------------------------------------------------------- gases

export interface Gas {
  id: string
  name: string
  /** kg/mol. */
  molarMass: number
  /** The ratio of specific heats, Cp over Cv. */
  gamma: number
  /** J/(mol·K) at constant pressure, near room temperature. */
  molarHeatCapacity: number
  /** How many ways a molecule can store energy at room temperature. */
  degreesOfFreedom: number
  shape: 'monatomic' | 'diatomic' | 'polyatomic'
  source: string
}

export const GASES: readonly Gas[] = Object.freeze([
  { id: 'air', name: 'Dry air', molarMass: 0.028966, gamma: 1.4, molarHeatCapacity: 29.19, degreesOfFreedom: 5, shape: 'diatomic', source: 'NIST, 300 K. A mixture, treated as one gas because its components behave almost identically here.' },
  { id: 'helium', name: 'Helium', molarMass: 0.0040026, gamma: 1.667, molarHeatCapacity: 20.79, degreesOfFreedom: 3, shape: 'monatomic', source: 'NIST. A monatomic gas stores energy only as motion, which fixes gamma at 5/3 exactly.' },
  { id: 'argon', name: 'Argon', molarMass: 0.039948, gamma: 1.667, molarHeatCapacity: 20.79, degreesOfFreedom: 3, shape: 'monatomic', source: 'NIST.' },
  { id: 'nitrogen', name: 'Nitrogen', molarMass: 0.0280134, gamma: 1.4, molarHeatCapacity: 29.12, degreesOfFreedom: 5, shape: 'diatomic', source: 'NIST, 300 K.' },
  { id: 'oxygen', name: 'Oxygen', molarMass: 0.0319988, gamma: 1.395, molarHeatCapacity: 29.38, degreesOfFreedom: 5, shape: 'diatomic', source: 'NIST, 300 K.' },
  { id: 'hydrogen', name: 'Hydrogen', molarMass: 0.00201588, gamma: 1.41, molarHeatCapacity: 28.84, degreesOfFreedom: 5, shape: 'diatomic', source: 'NIST, 300 K. Its rotational modes freeze out below about 100 K and gamma rises toward 5/3.' },
  { id: 'carbon-dioxide', name: 'Carbon dioxide', molarMass: 0.0440095, gamma: 1.289, molarHeatCapacity: 37.13, degreesOfFreedom: 6, shape: 'polyatomic', source: 'NIST, 300 K. Bending modes are active at room temperature, which is why gamma is low.' },
  { id: 'methane', name: 'Methane', molarMass: 0.0160425, gamma: 1.304, molarHeatCapacity: 35.69, degreesOfFreedom: 6, shape: 'polyatomic', source: 'NIST, 300 K.' },
  { id: 'steam', name: 'Water vapour', molarMass: 0.0180153, gamma: 1.33, molarHeatCapacity: 33.58, degreesOfFreedom: 6, shape: 'polyatomic', source: 'NIST, 400 K. Below 373 K at atmospheric pressure it condenses and none of this applies.' }
])

export function gasById(id: string): Gas | ThermoError {
  const found = GASES.find((one) => one.id === id)
  return found ?? fail('invalid-argument', `"${id}" is not a gas this knows: ${GASES.map((one) => one.id).join(', ')}.`)
}

export interface GasStateReport {
  /** Pascals. */
  pressure: number
  /** m³. */
  volume: number
  /** Kelvin. */
  temperature: number
  /** Moles. */
  moles: number
  /** kg/m³. */
  density: number | null
  /** kg. */
  mass: number | null
  /** m³/mol. */
  molarVolume: number
  /** 1 for an ideal gas. What was used, whether supplied or assumed. */
  compressibility: number
  ideal: boolean
  /** Kelvin. Whether this is near enough a phase boundary to worry, when a gas was named. */
  gas: string | null
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Solve the gas law for whichever quantity is missing.
 *
 * Exactly three of pressure, volume, temperature and moles fix the fourth, and giving all four is refused rather
 * than silently preferring three of them — four values that do not satisfy PV = ZnRT describe no gas, and which
 * one is wrong is not something arithmetic can decide.
 */
export function gasState(input: {
  pressure?: number
  volume?: number
  temperature?: number
  moles?: number
  /** A compressibility factor for a real gas. Defaults to 1, which is the ideal gas assumption, and it is reported. */
  compressibility?: number
  gas?: string
}): GasStateReport | ThermoError {
  const given = (['pressure', 'volume', 'temperature', 'moles'] as const).filter((one) => input[one] !== undefined)
  if (given.length < 3) {
    return fail(
      'invalid-argument',
      `Three of pressure, volume, temperature and moles fix the fourth. Only ${given.length} were given${given.length === 0 ? '' : `: ${given.join(', ')}`}.`
    )
  }

  const z = input.compressibility ?? 1
  if (!finite(z) || z <= 0) return fail('invalid-argument', 'The compressibility factor has to be greater than zero.')

  if (input.temperature !== undefined) {
    const bad = checkTemperature(input.temperature, 'temperature')
    if (bad) return bad
  }
  for (const name of ['pressure', 'volume', 'moles'] as const) {
    const value = input[name]
    if (value === undefined) continue
    if (!finite(value)) return fail('not-finite', `"${name}" has to be a finite number.`)
    if (value <= 0) return fail('invalid-argument', `"${name}" has to be greater than zero.`)
  }

  if (given.length === 4) {
    const residual = Math.abs(
      (input.pressure as number) * (input.volume as number) -
        z * (input.moles as number) * GAS_CONSTANT * (input.temperature as number)
    )
    const scale = (input.pressure as number) * (input.volume as number)
    if (residual > scale * 1e-6) {
      return fail(
        'no-solution',
        `All four were given and they do not satisfy PV = ZnRT — they are out by ${((residual / scale) * 100).toFixed(2)}%. Four values that disagree describe no gas, and which one is wrong is not something arithmetic can decide. Leave out whichever you want computed.`
      )
    }
  }

  const pressure = input.pressure ?? (z * (input.moles as number) * GAS_CONSTANT * (input.temperature as number)) / (input.volume as number)
  const volume = input.volume ?? (z * (input.moles as number) * GAS_CONSTANT * (input.temperature as number)) / (input.pressure as number)
  const temperature = input.temperature ?? ((input.pressure as number) * (input.volume as number)) / (z * (input.moles as number) * GAS_CONSTANT)
  const moles = input.moles ?? ((input.pressure as number) * (input.volume as number)) / (z * GAS_CONSTANT * temperature)

  let density: number | null = null
  let mass: number | null = null
  let gasName: string | null = null
  const warnings: string[] = []
  if (input.gas !== undefined) {
    const gas = gasById(input.gas)
    if (isThermoError(gas)) return gas
    gasName = gas.id
    mass = moles * gas.molarMass
    density = mass / volume
    if (gas.id === 'steam' && temperature < 373 && pressure > 0.5 * STANDARD_ATMOSPHERE) {
      warnings.push(
        `Water vapour at ${temperature.toFixed(1)} K and ${(pressure / 1000).toFixed(1)} kPa would mostly have condensed. The gas law describes the vapour and says nothing about the liquid it is turning into.`
      )
    }
  }

  if (z === 1 && pressure > 10 * STANDARD_ATMOSPHERE) {
    warnings.push(
      `At ${(pressure / STANDARD_ATMOSPHERE).toFixed(1)} atmospheres the ideal gas law starts to drift — molecules take up space and attract each other. A compressibility factor would be worth supplying; without one this is out by a few percent and more near a phase boundary.`
    )
  }
  if (z !== 1) {
    warnings.push(`A compressibility factor of ${z} was used, so this is not the ideal gas law. Z is itself a function of pressure and temperature, and a single value holds only near the conditions it was read at.`)
  }

  return {
    pressure,
    volume,
    temperature,
    moles,
    density,
    mass,
    molarVolume: volume / moles,
    compressibility: z,
    ideal: z === 1,
    gas: gasName,
    notes: Object.freeze([
      `PV = ZnRT with Z = ${z}: ${(pressure / 1000).toFixed(3)} kPa, ${volume.toExponential(4)} m3, ${temperature.toFixed(2)} K, ${moles.toExponential(4)} mol.`,
      `The molar volume is ${(volume / moles).toExponential(4)} m3/mol. At standard temperature and pressure an ideal gas occupies 0.0224 m3/mol whatever it is made of, which is the whole content of Avogadro's law.`,
      z === 1
        ? 'Treated as ideal. That is accurate to about 1% for common gases near room conditions and wrong by tens of percent near a phase boundary or above a few tens of atmospheres.'
        : 'Treated as a real gas using the compressibility factor given.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- processes

export type Process = 'isothermal' | 'isobaric' | 'isochoric' | 'adiabatic' | 'polytropic'

export const PROCESSES: readonly Process[] = Object.freeze(['isothermal', 'isobaric', 'isochoric', 'adiabatic', 'polytropic'])

export const PROCESS_FACTS: Readonly<
  Record<Process, { label: string; heldConstant: string; workFormula: string; describe: string }>
> = Object.freeze({
  isothermal: {
    label: 'Isothermal',
    heldConstant: 'Temperature.',
    workFormula: 'W = nRT ln(V2/V1)',
    describe:
      'Slow enough that the gas stays at the temperature of its surroundings. Internal energy does not change, so every joule of work comes from heat absorbed.'
  },
  isobaric: {
    label: 'Isobaric',
    heldConstant: 'Pressure.',
    workFormula: 'W = P(V2 - V1)',
    describe: 'A piston free to move against a fixed load. The heat added is the enthalpy change, which is why enthalpy exists as a quantity.'
  },
  isochoric: {
    label: 'Isochoric',
    heldConstant: 'Volume.',
    workFormula: 'W = 0',
    describe: 'A sealed rigid container. No work is done at all, so every joule of heat goes into internal energy.'
  },
  adiabatic: {
    label: 'Adiabatic',
    heldConstant: 'No heat crosses the boundary. PV^gamma is constant.',
    workFormula: 'W = (P1V1 - P2V2)/(gamma - 1)',
    describe:
      'Fast enough, or insulated enough, that no heat gets in or out. The temperature changes even though nothing was heated — which is why a bicycle pump gets hot.'
  },
  polytropic: {
    label: 'Polytropic',
    heldConstant: 'PV^n is constant, for a given n.',
    workFormula: 'W = (P1V1 - P2V2)/(n - 1)',
    describe:
      'The general case the others are special cases of: n = 1 is isothermal, n = gamma is adiabatic, n = 0 is isobaric, n infinite is isochoric.'
  }
})

export interface ProcessReport {
  process: Process
  label: string
  heldConstant: string
  from: { pressure: number; volume: number; temperature: number }
  to: { pressure: number; volume: number; temperature: number }
  /** Joules done by the gas. Negative means work was done on it. */
  work: number
  /** Joules into the gas. Negative means heat left it. */
  heat: number
  /** Joules. The change in internal energy. */
  internalEnergyChange: number
  /** Joules. The change in enthalpy. */
  enthalpyChange: number
  /** J/K. Zero for a reversible adiabatic process, which is what makes it isentropic. */
  entropyChange: number
  /** The polytropic index, whichever process this is. */
  polytropicIndex: number
  /** Samples of the path, for a P-V diagram. */
  path: readonly { pressure: number; volume: number; temperature: number }[]
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * One process on an ideal gas, with work, heat, internal energy and entropy all reported.
 *
 * All four, because the first law relates them and a result showing only one hides whether it balances. The entropy
 * change is the interesting one: it is exactly zero for a reversible adiabatic process and positive for everything
 * irreversible, and that distinction is the whole of the second law.
 */
export function process(input: {
  process: Process
  gas?: string
  /** The ratio of specific heats, when no gas was named. */
  gamma?: number
  moles: number
  /** Two of the three at the start, and one at the end. */
  fromPressure?: number
  fromVolume?: number
  fromTemperature?: number
  toPressure?: number
  toVolume?: number
  toTemperature?: number
  /** For a polytropic process. */
  index?: number
  samples?: number
}): ProcessReport | ThermoError {
  const facts = PROCESS_FACTS[input.process]
  if (!facts) return fail('invalid-argument', `"${input.process}" is not one of: ${PROCESSES.join(', ')}.`)

  const { moles } = input
  if (!finite(moles) || moles <= 0) return fail('invalid-argument', 'The number of moles has to be greater than zero.')

  let gamma: number
  if (input.gas !== undefined) {
    const gas = gasById(input.gas)
    if (isThermoError(gas)) return gas
    gamma = gas.gamma
  } else {
    gamma = input.gamma ?? 1.4
  }
  if (!finite(gamma) || gamma <= 1) {
    return fail('invalid-argument', 'The ratio of specific heats has to be above 1. Below that a gas would cool when compressed.')
  }
  const cv = GAS_CONSTANT / (gamma - 1)
  const cp = cv + GAS_CONSTANT

  // The starting state: two of the three fix the third.
  const startGiven = (['fromPressure', 'fromVolume', 'fromTemperature'] as const).filter((one) => input[one] !== undefined)
  if (startGiven.length < 2) {
    return fail('invalid-argument', `Two of the starting pressure, volume and temperature fix the third. Only ${startGiven.length} were given.`)
  }
  const start = gasState({
    pressure: input.fromPressure,
    volume: input.fromVolume,
    temperature: input.fromTemperature,
    moles
  })
  if (isThermoError(start)) return start

  const index =
    input.process === 'isothermal'
      ? 1
      : input.process === 'isobaric'
        ? 0
        : input.process === 'isochoric'
          ? Number.POSITIVE_INFINITY
          : input.process === 'adiabatic'
            ? gamma
            : (input.index ?? Number.NaN)
  if (input.process === 'polytropic') {
    if (input.index === undefined) return fail('invalid-argument', 'A polytropic process is defined by its index n, so it has to be given.')
    if (!finite(index)) return fail('not-finite', 'The polytropic index has to be a finite number.')
    if (index === 1) {
      return fail(
        'invalid-argument',
        'A polytropic index of exactly 1 is the isothermal case, where the work formula divides by zero. Use process "isothermal" instead — the answer is different, not undefined.'
      )
    }
  }

  // The end state: one quantity, and the process, fix the rest.
  const endGiven = (['toPressure', 'toVolume', 'toTemperature'] as const).filter((one) => input[one] !== undefined)
  if (endGiven.length === 0) {
    return fail('invalid-argument', 'One of the ending pressure, volume or temperature is needed; the process fixes the others.')
  }

  const p1 = start.pressure
  const v1 = start.volume
  const t1 = start.temperature
  let p2: number
  let v2: number

  const fromVolume = (volume: number): number => {
    if (input.process === 'isochoric') return p1
    if (input.process === 'isobaric') return p1
    if (!finite(index)) return p1
    return p1 * Math.pow(v1 / volume, index)
  }

  if (input.process === 'isochoric') {
    v2 = v1
    if (input.toVolume !== undefined && Math.abs(input.toVolume - v1) > v1 * 1e-9) {
      return fail('invalid-argument', 'An isochoric process holds the volume constant, so an ending volume different from the start is a contradiction.')
    }
    if (input.toPressure !== undefined) p2 = input.toPressure
    else if (input.toTemperature !== undefined) {
      const bad = checkTemperature(input.toTemperature, 'toTemperature')
      if (bad) return bad
      p2 = (p1 * input.toTemperature) / t1
    } else return fail('invalid-argument', 'An isochoric process needs an ending pressure or temperature.')
  } else if (input.process === 'isobaric') {
    p2 = p1
    if (input.toPressure !== undefined && Math.abs(input.toPressure - p1) > p1 * 1e-9) {
      return fail('invalid-argument', 'An isobaric process holds the pressure constant, so an ending pressure different from the start is a contradiction.')
    }
    if (input.toVolume !== undefined) v2 = input.toVolume
    else if (input.toTemperature !== undefined) {
      const bad = checkTemperature(input.toTemperature, 'toTemperature')
      if (bad) return bad
      v2 = (v1 * input.toTemperature) / t1
    } else return fail('invalid-argument', 'An isobaric process needs an ending volume or temperature.')
  } else if (input.toVolume !== undefined) {
    if (!finite(input.toVolume) || input.toVolume <= 0) return fail('invalid-argument', 'The ending volume has to be greater than zero.')
    v2 = input.toVolume
    p2 = fromVolume(v2)
  } else if (input.toPressure !== undefined) {
    if (!finite(input.toPressure) || input.toPressure <= 0) return fail('invalid-argument', 'The ending pressure has to be greater than zero.')
    p2 = input.toPressure
    v2 = v1 * Math.pow(p1 / p2, 1 / index)
  } else {
    const bad = checkTemperature(input.toTemperature as number, 'toTemperature')
    if (bad) return bad
    if (input.process === 'isothermal') {
      return fail(
        'invalid-argument',
        'An isothermal process holds the temperature constant, so an ending temperature fixes nothing. Give an ending pressure or volume.'
      )
    }
    const t2 = input.toTemperature as number
    v2 = v1 * Math.pow(t1 / t2, 1 / (index - 1))
    p2 = fromVolume(v2)
  }

  const t2 = (p2 * v2) / (moles * GAS_CONSTANT)
  if (!finite(t2) || t2 <= 0) return fail('no-solution', 'The ending state came out at a temperature that is not above absolute zero, so this process cannot happen as described.')

  // Work, by the formula for this process rather than by numerical integration, so it is exact.
  let work: number
  if (input.process === 'isothermal') {
    work = moles * GAS_CONSTANT * t1 * Math.log(v2 / v1)
  } else if (input.process === 'isobaric') {
    work = p1 * (v2 - v1)
  } else if (input.process === 'isochoric') {
    work = 0
  } else {
    work = (p1 * v1 - p2 * v2) / (index - 1)
  }

  const internalEnergyChange = moles * cv * (t2 - t1)
  const heat = internalEnergyChange + work
  const enthalpyChange = moles * cp * (t2 - t1)
  // The exact entropy change between two ideal-gas states, whatever path was taken between them.
  const entropyChange = moles * (cv * Math.log(t2 / t1) + GAS_CONSTANT * Math.log(v2 / v1))

  const count = Math.round(input.samples ?? 100)
  if (!Number.isInteger(count) || count < 2 || count > THERMO_LIMITS.samples) {
    return fail('invalid-argument', `The sample count has to be between 2 and ${THERMO_LIMITS.samples}.`)
  }
  const path: ProcessReport['path'][number][] = []
  for (let i = 0; i < count; i += 1) {
    const volume = v1 + ((v2 - v1) * i) / (count - 1)
    const pressure = input.process === 'isochoric' ? p1 + ((p2 - p1) * i) / (count - 1) : fromVolume(volume)
    path.push({ pressure, volume, temperature: (pressure * volume) / (moles * GAS_CONSTANT) })
  }

  const warnings: string[] = []
  if (input.process === 'adiabatic' && Math.abs(entropyChange) > Math.abs(internalEnergyChange) * 1e-9) {
    warnings.push('An adiabatic process on an ideal gas should have zero entropy change; this one does not, which means the path given is not reversible.')
  }
  if (input.process === 'isothermal' && Math.abs(internalEnergyChange) > 1e-9) {
    warnings.push('An isothermal process should leave the internal energy unchanged. A non-zero change here means the temperatures do not match.')
  }

  return {
    process: input.process,
    label: facts.label,
    heldConstant: facts.heldConstant,
    from: { pressure: p1, volume: v1, temperature: t1 },
    to: { pressure: p2, volume: v2, temperature: t2 },
    work,
    heat,
    internalEnergyChange,
    enthalpyChange,
    entropyChange,
    polytropicIndex: index,
    path: Object.freeze(path),
    notes: Object.freeze([
      `${facts.label}. Held constant: ${facts.heldConstant} ${facts.describe}`,
      `Work ${work.toFixed(3)} J done by the gas, heat ${heat.toFixed(3)} J in, internal energy change ${internalEnergyChange.toFixed(3)} J. Those three satisfy the first law by construction: Q = dU + W.`,
      `The entropy change is ${entropyChange.toFixed(5)} J/K. ${Math.abs(entropyChange) < 1e-9 ? 'Zero, which makes this isentropic — the reversible adiabatic case.' : 'Non-zero, so this path changes the entropy of the gas even where no heat crossed the boundary.'}`,
      `${facts.workFormula}. Computed from the formula rather than by integrating numerically, so it is exact for an ideal gas.`
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- cycles

export type Cycle = 'carnot' | 'otto' | 'diesel' | 'brayton' | 'rankine' | 'stirling' | 'refrigeration' | 'heat-pump'

export const CYCLES: readonly Cycle[] = Object.freeze([
  'carnot',
  'otto',
  'diesel',
  'brayton',
  'rankine',
  'stirling',
  'refrigeration',
  'heat-pump'
])

export const CYCLE_FACTS: Readonly<
  Record<Cycle, { label: string; needs: string; realWorld: string; measuredBy: 'efficiency' | 'coefficient-of-performance' }>
> = Object.freeze({
  carnot: {
    label: 'Carnot',
    needs: 'The hot and cold reservoir temperatures.',
    realWorld: 'Nothing is built this way. It is the ceiling every real engine is measured against, and no arrangement of anything exceeds it.',
    measuredBy: 'efficiency'
  },
  otto: {
    label: 'Otto',
    needs: 'The compression ratio and the ratio of specific heats.',
    realWorld: 'Petrol engines. Real ones reach about 25-30% against an ideal 55%, because of friction, heat loss and incomplete combustion.',
    measuredBy: 'efficiency'
  },
  diesel: {
    label: 'Diesel',
    needs: 'The compression ratio, the cut-off ratio and gamma.',
    realWorld: 'Diesel engines. Higher compression than petrol, which is why they are more efficient, and the cut-off ratio is why the formula is messier.',
    measuredBy: 'efficiency'
  },
  brayton: {
    label: 'Brayton',
    needs: 'The pressure ratio and gamma.',
    realWorld: 'Gas turbines and jet engines. Efficiency depends only on the pressure ratio, which is why turbines chase compression.',
    measuredBy: 'efficiency'
  },
  rankine: {
    label: 'Rankine',
    needs: 'Turbine inlet and condenser enthalpies, and the pump work.',
    realWorld: 'Every steam power station. Needs real steam properties rather than a gas law, so this takes enthalpies as inputs.',
    measuredBy: 'efficiency'
  },
  stirling: {
    label: 'Stirling',
    needs: 'The hot and cold temperatures, and the compression ratio.',
    realWorld: 'Reaches Carnot efficiency in theory with perfect regeneration. In practice the regenerator is the whole difficulty.',
    measuredBy: 'efficiency'
  },
  refrigeration: {
    label: 'Refrigeration',
    needs: 'The cold space and hot surroundings temperatures.',
    realWorld: 'A fridge or an air conditioner. Measured by coefficient of performance, which is above 1 and is not an efficiency.',
    measuredBy: 'coefficient-of-performance'
  },
  'heat-pump': {
    label: 'Heat pump',
    needs: 'The indoor and outdoor temperatures.',
    realWorld: 'The same machine as a fridge, counted from the other end. A COP of 4 means four joules of heat delivered per joule of electricity.',
    measuredBy: 'coefficient-of-performance'
  }
})

export interface CycleReport {
  cycle: Cycle
  label: string
  /** Work out over heat in, for an engine. Null for a fridge or heat pump. */
  efficiency: number | null
  /** Heat moved over work in, for a fridge or heat pump. Null for an engine. */
  coefficientOfPerformance: number | null
  /** The Carnot value for the same reservoir temperatures. Nothing gets past it. */
  carnotLimit: number | null
  /** How close this cycle gets to that ceiling. */
  secondLawEfficiency: number | null
  /** Joules, when a heat input was given. */
  workOut: number | null
  heatIn: number | null
  heatRejected: number | null
  realWorld: string
  measuredBy: 'efficiency' | 'coefficient-of-performance'
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * A thermodynamic cycle's efficiency, always against the Carnot limit for the same temperatures.
 *
 * The comparison is not decoration. An ideal Otto cycle at compression ratio 10 is 60% efficient and sounds
 * impressive until you notice the Carnot limit between the same temperatures is 80% — the second-law efficiency,
 * which is the ratio of the two, is the figure that says how good the cycle actually is.
 *
 * Coefficient of performance is kept separate from efficiency and never called one. A COP of 4 is not 400%
 * efficient; it is four joules of heat moved per joule of work, and heat moved is not energy created.
 */
export function cycle(input: {
  cycle: Cycle
  /** Kelvin. */
  hotTemperature?: number
  coldTemperature?: number
  compressionRatio?: number
  pressureRatio?: number
  cutOffRatio?: number
  gamma?: number
  gas?: string
  /** Joules, to get absolute figures rather than just a ratio. */
  heatInput?: number
  /** kJ/kg, for the Rankine cycle, which needs real steam properties. */
  turbineInletEnthalpy?: number
  turbineOutletEnthalpy?: number
  condenserOutletEnthalpy?: number
  pumpWork?: number
}): CycleReport | ThermoError {
  const facts = CYCLE_FACTS[input.cycle]
  if (!facts) return fail('invalid-argument', `"${input.cycle}" is not one of: ${CYCLES.join(', ')}.`)

  let gamma = input.gamma ?? 1.4
  if (input.gas !== undefined) {
    const gas = gasById(input.gas)
    if (isThermoError(gas)) return gas
    gamma = gas.gamma
  }
  if (!finite(gamma) || gamma <= 1) return fail('invalid-argument', 'The ratio of specific heats has to be above 1.')

  const warnings: string[] = []
  let carnotLimit: number | null = null
  if (input.hotTemperature !== undefined && input.coldTemperature !== undefined) {
    for (const [name, value] of [['hotTemperature', input.hotTemperature], ['coldTemperature', input.coldTemperature]] as const) {
      const bad = checkTemperature(value, name)
      if (bad) return bad
    }
    if (input.coldTemperature >= input.hotTemperature) {
      return fail(
        'invalid-argument',
        `The cold reservoir is at or above the hot one. A heat engine between reservoirs at the same temperature produces no work, and one run backwards is a fridge — say which you mean.`
      )
    }
    carnotLimit =
      facts.measuredBy === 'efficiency'
        ? 1 - input.coldTemperature / input.hotTemperature
        : input.cycle === 'heat-pump'
          ? input.hotTemperature / (input.hotTemperature - input.coldTemperature)
          : input.coldTemperature / (input.hotTemperature - input.coldTemperature)
  }

  let efficiency: number | null = null
  let cop: number | null = null

  switch (input.cycle) {
    case 'carnot':
    case 'stirling': {
      if (carnotLimit === null) return fail('invalid-argument', `${facts.label} needs ${facts.needs}`)
      efficiency = carnotLimit
      if (input.cycle === 'stirling') {
        warnings.push(
          'An ideal Stirling cycle reaches Carnot efficiency because its regeneration is taken as perfect. No real regenerator is, and that gap is most of why Stirling engines have never displaced anything.'
        )
      }
      break
    }
    case 'otto': {
      const r = input.compressionRatio
      if (r === undefined) return fail('invalid-argument', `${facts.label} needs ${facts.needs}`)
      if (!finite(r) || r <= 1) return fail('invalid-argument', 'The compression ratio has to be above 1.')
      efficiency = 1 - Math.pow(r, 1 - gamma)
      if (r > 12) {
        warnings.push(
          `A compression ratio of ${r} is above what a petrol engine can run without the fuel igniting on its own. The formula keeps going; the engine does not.`
        )
      }
      break
    }
    case 'diesel': {
      const r = input.compressionRatio
      const rc = input.cutOffRatio
      if (r === undefined || rc === undefined) return fail('invalid-argument', `${facts.label} needs ${facts.needs}`)
      if (!finite(r) || r <= 1) return fail('invalid-argument', 'The compression ratio has to be above 1.')
      if (!finite(rc) || rc <= 1) return fail('invalid-argument', 'The cut-off ratio has to be above 1. At exactly 1 this is the Otto cycle.')
      efficiency =
        1 - (1 / Math.pow(r, gamma - 1)) * ((Math.pow(rc, gamma) - 1) / (gamma * (rc - 1)))
      break
    }
    case 'brayton': {
      const rp = input.pressureRatio
      if (rp === undefined) return fail('invalid-argument', `${facts.label} needs ${facts.needs}`)
      if (!finite(rp) || rp <= 1) return fail('invalid-argument', 'The pressure ratio has to be above 1.')
      efficiency = 1 - Math.pow(rp, (1 - gamma) / gamma)
      break
    }
    case 'rankine': {
      const { turbineInletEnthalpy: h3, turbineOutletEnthalpy: h4, condenserOutletEnthalpy: h1 } = input
      if (h3 === undefined || h4 === undefined || h1 === undefined) {
        return fail(
          'invalid-argument',
          `${facts.label} needs ${facts.needs} Steam is not an ideal gas anywhere near a power station's operating point, so real enthalpies from a steam table are required rather than computed here.`
        )
      }
      for (const [name, value] of [['turbineInletEnthalpy', h3], ['turbineOutletEnthalpy', h4], ['condenserOutletEnthalpy', h1]] as const) {
        if (!finite(value)) return fail('not-finite', `"${name}" has to be a finite number.`)
      }
      if (h4 >= h3) return fail('invalid-argument', 'The turbine outlet enthalpy is at or above the inlet, so the turbine would be absorbing work rather than producing it.')
      const pump = input.pumpWork ?? 0
      if (!finite(pump) || pump < 0) return fail('invalid-argument', 'The pump work cannot be negative.')
      const turbineWork = h3 - h4
      const heatAdded = h3 - (h1 + pump)
      if (heatAdded <= 0) return fail('no-solution', 'The heat added to the boiler came out as zero or negative, which describes no cycle.')
      efficiency = (turbineWork - pump) / heatAdded
      if (pump === 0) {
        warnings.push('No pump work was given, so it was taken as zero. That is a common simplification and it overstates the efficiency by a percent or two.')
      }
      break
    }
    default: {
      // Refrigeration and heat pump: ideal reversed Carnot.
      if (carnotLimit === null) return fail('invalid-argument', `${facts.label} needs ${facts.needs}`)
      cop = carnotLimit
      break
    }
  }

  // The second law check, which is the whole point of reporting the limit.
  if (efficiency !== null) {
    if (efficiency < 0 || efficiency >= 1) {
      return fail(
        'second-law',
        `The efficiency came out as ${(efficiency * 100).toFixed(2)}%. An efficiency of 100% or more means all the heat became work and none was rejected, which the second law forbids — the inputs describe an impossible machine.`
      )
    }
    if (carnotLimit !== null && efficiency > carnotLimit + 1e-9) {
      return fail(
        'second-law',
        `This cycle comes out at ${(efficiency * 100).toFixed(2)}% between reservoirs whose Carnot limit is ${(carnotLimit * 100).toFixed(2)}%. Nothing exceeds Carnot, so either the temperatures do not belong to this cycle or one of the ratios is wrong. An efficiency above Carnot is never a good result.`
      )
    }
  }
  if (cop !== null && cop <= 0) {
    return fail('second-law', 'The coefficient of performance came out at zero or below, which describes no working machine.')
  }

  let workOut: number | null = null
  let heatIn: number | null = null
  let heatRejected: number | null = null
  if (input.heatInput !== undefined) {
    if (!finite(input.heatInput) || input.heatInput <= 0) return fail('invalid-argument', 'The heat input has to be greater than zero.')
    heatIn = input.heatInput
    if (efficiency !== null) {
      workOut = efficiency * heatIn
      heatRejected = heatIn - workOut
    } else if (cop !== null) {
      workOut = -heatIn / cop
      heatRejected = heatIn + Math.abs(workOut)
    }
  }

  const notes: string[] = [
    `${facts.label}. ${facts.realWorld}`,
    efficiency !== null
      ? `Ideal efficiency ${(efficiency * 100).toFixed(2)}%.`
      : `Ideal coefficient of performance ${(cop as number).toFixed(3)}. That is not an efficiency and is not a percentage — it is heat moved per unit of work, and moving heat is not creating energy.`,
    carnotLimit === null
      ? 'No reservoir temperatures were given, so there is no Carnot limit to compare against. Give them and the comparison appears, which is the number worth looking at.'
      : `The Carnot ${facts.measuredBy === 'efficiency' ? 'limit' : 'coefficient'} for these temperatures is ${facts.measuredBy === 'efficiency' ? `${(carnotLimit * 100).toFixed(2)}%` : carnotLimit.toFixed(3)}. Nothing exceeds it, whatever working fluid or arrangement is used.`
  ]
  const secondLaw =
    carnotLimit === null || carnotLimit === 0
      ? null
      : (efficiency ?? (cop as number)) / carnotLimit
  if (secondLaw !== null) {
    notes.push(
      `The second-law efficiency is ${(secondLaw * 100).toFixed(1)}% — how much of the thermodynamically available performance this cycle achieves. That is the figure that says how good the design is, rather than how favourable the temperatures are.`
    )
  }
  if (heatIn !== null) {
    notes.push(
      efficiency !== null
        ? `From ${heatIn} J of heat in: ${(workOut as number).toFixed(1)} J of work out and ${(heatRejected as number).toFixed(1)} J rejected to the cold reservoir. The rejected heat is not waste that better engineering removes — the second law requires it.`
        : `To move ${heatIn} J of heat takes ${Math.abs(workOut as number).toFixed(1)} J of work, and ${(heatRejected as number).toFixed(1)} J arrives at the hot side.`
    )
  }

  return {
    cycle: input.cycle,
    label: facts.label,
    efficiency,
    coefficientOfPerformance: cop,
    carnotLimit,
    secondLawEfficiency: secondLaw,
    workOut,
    heatIn,
    heatRejected,
    realWorld: facts.realWorld,
    measuredBy: facts.measuredBy,
    notes: Object.freeze(notes),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- entropy

export interface EntropyReport {
  /** J/K. */
  change: number
  /** Where it came from, so the sign is arguable. */
  contributions: readonly { label: string; change: number; describe: string }[]
  /** The total change in the universe. Never negative for a real process. */
  universeChange: number
  reversible: boolean
  /** Joules of work that could have been done and was not. */
  lostWork: number | null
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Entropy change for heat moving between bodies, with the universe total checked.
 *
 * The check is the point. Heat flowing from cold to hot on its own gives a negative total, which is not a small
 * error to be tolerated — it is a process that does not happen. The engine refuses rather than reporting it, and
 * says which way heat would actually flow.
 *
 * The lost work figure is the practical consequence: every irreversible transfer destroys work that could have been
 * extracted, and the amount is the entropy generated times the temperature of the surroundings.
 */
export function entropyTransfer(input: {
  /** Joules moved. Positive. */
  heat: number
  /** Kelvin. */
  fromTemperature: number
  toTemperature: number
  /** Kelvin, for the lost-work figure. */
  surroundingsTemperature?: number
}): EntropyReport | ThermoError {
  const { heat, fromTemperature, toTemperature } = input
  if (!finite(heat) || heat <= 0) return fail('invalid-argument', 'The heat moved has to be greater than zero. To reverse the direction, swap the two temperatures.')
  for (const [name, value] of [['fromTemperature', fromTemperature], ['toTemperature', toTemperature]] as const) {
    const bad = checkTemperature(value, name)
    if (bad) return bad
  }

  if (toTemperature > fromTemperature) {
    return fail(
      'second-law',
      `This moves heat from ${fromTemperature} K to ${toTemperature} K — from cold to hot, on its own. The total entropy change would be negative, which means the process does not happen. Heat flows the other way, and to move it this way takes work: that is what a fridge is.`
    )
  }

  const lost = -heat / fromTemperature
  const gained = heat / toTemperature
  const total = lost + gained
  const reversible = Math.abs(total) < Math.abs(gained) * 1e-9

  const surroundings = input.surroundingsTemperature
  let lostWork: number | null = null
  if (surroundings !== undefined) {
    const bad = checkTemperature(surroundings, 'surroundingsTemperature')
    if (bad) return bad
    lostWork = surroundings * total
  }

  const warnings: string[] = []
  if (reversible) {
    warnings.push(
      'The two temperatures are effectively equal, so this transfer generates no entropy and is reversible. No real transfer is — heat only flows across a temperature difference, and any difference generates entropy.'
    )
  }

  return {
    change: total,
    contributions: Object.freeze([
      { label: `the body at ${fromTemperature} K`, change: lost, describe: 'Loses heat, so its entropy falls. Dividing by the larger temperature makes this the smaller magnitude.' },
      { label: `the body at ${toTemperature} K`, change: gained, describe: 'Gains the same heat at a lower temperature, so its entropy rises more. That asymmetry is the second law.' }
    ]),
    universeChange: total,
    reversible,
    lostWork,
    notes: Object.freeze([
      `Moving ${heat} J from ${fromTemperature} K to ${toTemperature} K generates ${total.toFixed(6)} J/K of entropy.`,
      'The same heat leaving a hot body and entering a cold one changes their entropies by different amounts, because entropy change is heat over temperature. That asymmetry, and nothing else, is why heat flows one way.',
      lostWork === null
        ? 'Give a surroundings temperature for the work this transfer destroyed.'
        : `${lostWork.toFixed(2)} J of work could have been extracted from this heat and was not. Entropy generated times the surroundings temperature is exactly the work thrown away, which is the practical meaning of irreversibility.`
    ]),
    warnings: Object.freeze(warnings)
  }
}

export interface MixingReport {
  /** J/K. Always positive: mixing is never free. */
  entropyChange: number
  /** The final temperature, when bodies at different temperatures were mixed. */
  finalTemperature: number | null
  /** Each component's contribution. */
  components: readonly { label: string; moles: number; fraction: number; contribution: number }[]
  /** Joules of work that mixing destroyed. */
  lostWork: number | null
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * The entropy of mixing, which is always positive and is why unmixing costs work.
 *
 * Mixing two gases at the same temperature and pressure releases no heat and does no work, and it still increases
 * entropy — which is the clearest demonstration that entropy is not disguised energy. Separating them again takes
 * work, and the minimum amount is exactly this entropy times the temperature.
 */
export function entropyOfMixing(input: {
  components: readonly { label?: string; moles: number; temperature?: number; molarHeatCapacity?: number }[]
  /** Kelvin, for the lost-work figure. */
  temperature?: number
}): MixingReport | ThermoError {
  const { components } = input
  if (components.length < 2) return fail('invalid-argument', 'Mixing needs at least two components.')
  if (components.length > THERMO_LIMITS.species) return fail('too-many', `That is more than the ${THERMO_LIMITS.species} components this handles.`)

  let totalMoles = 0
  for (const [i, one] of components.entries()) {
    if (!finite(one.moles) || one.moles <= 0) return fail('invalid-argument', `Component ${i + 1} has a mole count that is not greater than zero.`)
    if (one.temperature !== undefined) {
      const bad = checkTemperature(one.temperature, `component ${i + 1} temperature`)
      if (bad) return bad
    }
    totalMoles += one.moles
  }

  // The composition entropy: -R sum(n_i ln x_i), always positive because every mole fraction is below 1.
  let change = 0
  const described: MixingReport['components'][number][] = []
  for (const [i, one] of components.entries()) {
    const fraction = one.moles / totalMoles
    const contribution = -one.moles * GAS_CONSTANT * Math.log(fraction)
    change += contribution
    described.push({ label: one.label ?? `component ${i + 1}`, moles: one.moles, fraction, contribution })
  }

  // If the components arrive at different temperatures, mixing also equalises them, which generates more entropy.
  let finalTemperature: number | null = null
  const temperatures = components.filter((one) => one.temperature !== undefined)
  if (temperatures.length === components.length) {
    let heatCapacitySum = 0
    let weighted = 0
    for (const one of components) {
      const cp = one.molarHeatCapacity ?? (5 / 2) * GAS_CONSTANT
      if (!finite(cp) || cp <= 0) return fail('invalid-argument', 'A molar heat capacity has to be greater than zero.')
      heatCapacitySum += one.moles * cp
      weighted += one.moles * cp * (one.temperature as number)
    }
    finalTemperature = weighted / heatCapacitySum
    for (const one of components) {
      const cp = one.molarHeatCapacity ?? (5 / 2) * GAS_CONSTANT
      change += one.moles * cp * Math.log(finalTemperature / (one.temperature as number))
    }
  }

  const referenceTemperature = input.temperature ?? finalTemperature
  const lostWork = referenceTemperature === null || referenceTemperature === undefined ? null : referenceTemperature * change

  const warnings: string[] = []
  if (change <= 0) {
    return fail('no-solution', 'The entropy of mixing came out as zero or negative, which cannot happen. Check the mole counts.')
  }
  if (temperatures.length > 0 && temperatures.length < components.length) {
    warnings.push('Some components have a temperature and some do not, so the temperature-equalisation part was skipped and only the composition entropy is reported. Give a temperature for every component or for none.')
  }

  return {
    entropyChange: change,
    finalTemperature,
    components: Object.freeze(described),
    lostWork,
    notes: Object.freeze([
      `Mixing generates ${change.toFixed(4)} J/K of entropy.`,
      'Mixing two gases at the same temperature and pressure releases no heat and does no work, and the entropy still rises. That is the clearest sign entropy is not disguised energy.',
      lostWork === null
        ? 'Give a temperature for the minimum work that separating this mixture would take.'
        : `Separating the mixture again takes at least ${lostWork.toFixed(2)} J. Entropy times temperature is the floor, and any real separation costs considerably more.`,
      finalTemperature === null
        ? 'All components were taken to be at the same temperature, so only the composition part of the entropy is here.'
        : `The components also equalise to ${finalTemperature.toFixed(2)} K, which generates entropy of its own on top of the mixing.`
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- phase change

export interface PhaseReport {
  /** Joules. */
  heat: number
  /** The stages, so it is visible where the heat went. */
  stages: readonly { label: string; heat: number; temperatureFrom: number; temperatureTo: number; kind: 'sensible' | 'latent' }[]
  /** How much of the total went into changing phase rather than changing temperature. */
  latentFraction: number
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Heat needed to take a substance through temperature changes and phase changes.
 *
 * The latent fraction is the point. Boiling a kilogram of water that is already at 100 °C takes about six and a half
 * times the heat of warming it from freezing to boiling, and the temperature does not move while it happens. That
 * is why a pan of boiling water stays at 100 °C however hard you heat it, and why steam burns are so much worse than
 * hot water burns.
 */
export function phaseHeat(input: {
  /** kg. */
  mass: number
  /** Kelvin. */
  fromTemperature: number
  toTemperature: number
  /** J/(kg·K) for each phase. */
  solidHeatCapacity?: number
  liquidHeatCapacity?: number
  gasHeatCapacity?: number
  /** Kelvin. */
  meltingPoint?: number
  boilingPoint?: number
  /** J/kg. */
  latentHeatOfFusion?: number
  latentHeatOfVaporisation?: number
}): PhaseReport | ThermoError {
  const { mass, fromTemperature, toTemperature } = input
  if (!finite(mass) || mass <= 0) return fail('invalid-argument', 'The mass has to be greater than zero.')
  for (const [name, value] of [['fromTemperature', fromTemperature], ['toTemperature', toTemperature]] as const) {
    const bad = checkTemperature(value, name)
    if (bad) return bad
  }
  if (toTemperature < fromTemperature) {
    return fail(
      'invalid-argument',
      'The ending temperature is below the starting one. Cooling is the same arithmetic with the sign flipped; swap the two and read the answer as heat removed.'
    )
  }

  const stages: PhaseReport['stages'][number][] = []
  const warnings: string[] = []
  let current = fromTemperature
  let latent = 0
  let total = 0

  const addSensible = (to: number, capacity: number | undefined, phase: string): ThermoError | null => {
    if (to <= current) return null
    if (capacity === undefined) {
      return fail('invalid-argument', `Heating through the ${phase} range from ${current.toFixed(1)} K to ${to.toFixed(1)} K needs the ${phase} heat capacity.`)
    }
    if (!finite(capacity) || capacity <= 0) return fail('invalid-argument', `The ${phase} heat capacity has to be greater than zero.`)
    const heat = mass * capacity * (to - current)
    stages.push({ label: `warm the ${phase} from ${current.toFixed(1)} K to ${to.toFixed(1)} K`, heat, temperatureFrom: current, temperatureTo: to, kind: 'sensible' })
    total += heat
    current = to
    return null
  }

  const melting = input.meltingPoint
  const boiling = input.boilingPoint
  if (melting !== undefined && boiling !== undefined && melting >= boiling) {
    return fail('invalid-argument', 'The melting point is at or above the boiling point, which describes no ordinary substance at this pressure.')
  }

  // Solid range.
  if (melting !== undefined && current < melting && toTemperature > current) {
    const bad = addSensible(Math.min(melting, toTemperature), input.solidHeatCapacity, 'solid')
    if (bad) return bad
    if (current >= melting && toTemperature > melting) {
      if (input.latentHeatOfFusion === undefined) {
        return fail('invalid-argument', 'Passing the melting point needs the latent heat of fusion. Without it the answer would be short by the largest single term.')
      }
      const heat = mass * input.latentHeatOfFusion
      stages.push({ label: `melt at ${melting.toFixed(1)} K`, heat, temperatureFrom: melting, temperatureTo: melting, kind: 'latent' })
      total += heat
      latent += heat
    }
  }

  // Liquid range.
  const liquidTop = boiling === undefined ? toTemperature : Math.min(boiling, toTemperature)
  if (current < liquidTop) {
    const bad = addSensible(liquidTop, input.liquidHeatCapacity, 'liquid')
    if (bad) return bad
  }

  // Boiling.
  if (boiling !== undefined && current >= boiling && toTemperature > boiling) {
    if (input.latentHeatOfVaporisation === undefined) {
      return fail('invalid-argument', 'Passing the boiling point needs the latent heat of vaporisation, which is usually the biggest term of all.')
    }
    const heat = mass * input.latentHeatOfVaporisation
    stages.push({ label: `boil at ${boiling.toFixed(1)} K`, heat, temperatureFrom: boiling, temperatureTo: boiling, kind: 'latent' })
    total += heat
    latent += heat
  }

  // Gas range.
  if (current < toTemperature) {
    const bad = addSensible(toTemperature, input.gasHeatCapacity ?? input.liquidHeatCapacity, current >= (boiling ?? Infinity) ? 'gas' : 'liquid')
    if (bad) return bad
  }

  if (stages.length === 0) {
    return fail('no-solution', 'No heating stages were worked out, which means the temperature range is empty or the phase points do not bracket it.')
  }

  const latentFraction = total === 0 ? 0 : latent / total
  if (latentFraction > 0.5) {
    warnings.push(
      `${(latentFraction * 100).toFixed(1)}% of the heat goes into changing phase rather than changing temperature. During those stages the thermometer does not move however hard you heat it, which is what makes phase changes so good at storing heat and steam burns so much worse than hot water.`
    )
  }

  return {
    heat: total,
    stages: Object.freeze(stages),
    latentFraction,
    notes: Object.freeze([
      `${total.toFixed(0)} J to take ${mass} kg from ${fromTemperature} K to ${toTemperature} K, in ${stages.length} stage${stages.length === 1 ? '' : 's'}.`,
      `${(latentFraction * 100).toFixed(1)}% of that is latent heat, which changes the phase without changing the temperature.`,
      'Every heat capacity and latent heat is an argument, because they differ by substance and none of them is computable from anything here.',
      'Phase points are pressure dependent. Water boils at 373 K at sea level and at about 363 K on a high mountain, and this uses whatever was given.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

/** Handy for a Page that wants the molecular scale beside the bulk one. */
export const THERMO_CONSTANTS = Object.freeze({
  gasConstant: GAS_CONSTANT,
  boltzmann: BOLTZMANN_CONSTANT,
  avogadro: AVOGADRO_CONSTANT,
  absoluteZeroCelsius: ABSOLUTE_ZERO_CELSIUS,
  standardAtmosphere: STANDARD_ATMOSPHERE,
  note: 'The gas constant is the Boltzmann constant times the Avogadro constant. One is the per-molecule version of the other, and which appears is only a matter of whether you are counting molecules or moles.'
})

/** Everything a Page should be able to show about what this engine is standing on. */
export const THERMO_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Temperatures are in kelvin. A temperature ratio in Celsius is meaningless, so Celsius is refused with the conversion.',
  'Gases are treated as ideal unless a compressibility factor is given, and every result says which.',
  'The ideal gas law is good to about 1% near room conditions and wrong by tens of percent near a phase boundary or above a few tens of atmospheres. Those cases are flagged.',
  'Every process names the quantity it holds constant, and reports work, heat, internal energy and entropy together so the first law can be seen to balance.',
  'Every engine cycle is compared against the Carnot limit for the same reservoir temperatures, and an efficiency above it is refused rather than returned.',
  'Coefficient of performance is never called an efficiency. A COP of 4 is four joules moved per joule of work, not 400% efficient.',
  'Heat flowing from cold to hot unaided is refused by name, because the total entropy change would be negative and the process does not happen.',
  'The Rankine cycle takes real steam enthalpies, because steam is not an ideal gas anywhere near a power station.',
  'Heat capacities, latent heats and phase points are arguments. None is computable from anything else here, and phase points depend on pressure.'
])
