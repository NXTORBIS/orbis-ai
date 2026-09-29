/**
 * The modern-physics laboratory a Page can reach: heat, molecules, fast frames and quantum states.
 *
 * Same contract as every bridge before it. A Page sends data, never code. There is no `eval` and no `new Function`
 * on any path reachable from here, and every number a Page shows came back through this door from an engine that
 * computed it — none of it is produced by a language model and none of it is hardcoded.
 *
 * ## No random numbers
 *
 * A quantum measurement returns probabilities and never an outcome, and nothing on this path draws a random number.
 * A Page that wants a simulated run does its own draw, which keeps it visible that a draw happened rather than
 * having the engine appear to know what the universe did.
 *
 * ## The operations that refuse rather than default
 *
 * `cycle.efficiency` refuses a result that beats the Carnot limit for the same temperatures, because an efficiency
 * above Carnot is an error rather than an achievement. `entropy.transfer` refuses heat flowing from cold to hot
 * unaided. `relativity.lorentz` refuses light speed and above rather than returning infinity. `quantum.uncertainty`
 * refuses a pair of spreads below the floor, since they describe no state. `gas.state` refuses four quantities that
 * disagree instead of quietly preferring three of them.
 */

import {
  CYCLES,
  CYCLE_FACTS,
  GASES,
  PROCESSES,
  PROCESS_FACTS,
  THERMO_ASSUMPTIONS,
  THERMO_CONSTANTS,
  cycle,
  entropyOfMixing,
  entropyTransfer,
  gasById,
  gasState,
  isThermoError,
  phaseHeat,
  process,
  type Cycle,
  type Process
} from '../../shared/compute/thermodynamics.ts'
import {
  STATISTICS_FACTS,
  STATISTICS_KINDS,
  STATMECH_ASSUMPTIONS,
  STATMECH_CONSTANTS,
  boltzmannDistribution,
  heatCapacity,
  isStatMechError,
  microstateEntropy,
  speedDistribution,
  stateOccupancy,
  type Statistics
} from '../../shared/compute/statisticalMechanics.ts'
import {
  MODERN_PHYSICS_CONSTANTS,
  RELATIVITY_ASSUMPTIONS,
  addVelocities,
  bindingEnergy,
  blackbody,
  deBroglie,
  isRelativityError,
  lorentz,
  massEnergy,
  photoelectric,
  photon,
  radioactiveDecay,
  relativisticDoppler
} from '../../shared/compute/relativity.ts'
import {
  QUANTUM_ASSUMPTIONS,
  QUANTUM_CONSTANTS,
  expectationValue,
  harmonicOscillator,
  hydrogen,
  isQuantumError,
  measure,
  particleInBox,
  tunnelling,
  uncertainty,
  type Amplitude
} from '../../shared/compute/quantum.ts'
import { BadInput, Reader } from './engines.ts'

/**
 * Every operation this bridge answers, and the capability each one needs.
 *
 * All of them need the same one. A Page that can solve a gas law can also work out a photon energy, and splitting
 * them into four permissions would ask the user four questions about the same thing — arithmetic that reaches
 * nothing outside the Page.
 */
export const MODERN_PHYSICS_CAPABILITY: Readonly<Record<string, string>> = Object.freeze({
  // ---- thermodynamics
  'gas.list': 'computation.modern-physics',
  'gas.get': 'computation.modern-physics',
  'gas.state': 'computation.modern-physics',
  'gas.process': 'computation.modern-physics',
  'gas.processes': 'computation.modern-physics',
  'cycle.efficiency': 'computation.modern-physics',
  'cycle.list': 'computation.modern-physics',
  'entropy.transfer': 'computation.modern-physics',
  'entropy.mixing': 'computation.modern-physics',
  'heat.phase-change': 'computation.modern-physics',

  // ---- statistical mechanics
  'stat.boltzmann': 'computation.modern-physics',
  'stat.speeds': 'computation.modern-physics',
  'stat.heat-capacity': 'computation.modern-physics',
  'stat.microstates': 'computation.modern-physics',
  'stat.occupancy': 'computation.modern-physics',
  'stat.statistics': 'computation.modern-physics',

  // ---- relativity
  'fast.lorentz': 'computation.modern-physics',
  'fast.add-velocities': 'computation.modern-physics',
  'fast.mass-energy': 'computation.modern-physics',
  'fast.doppler': 'computation.modern-physics',

  // ---- light and nuclei
  'light.photon': 'computation.modern-physics',
  'light.photoelectric': 'computation.modern-physics',
  'light.blackbody': 'computation.modern-physics',
  'light.de-broglie': 'computation.modern-physics',
  'nucleus.binding': 'computation.modern-physics',
  'nucleus.decay': 'computation.modern-physics',

  // ---- quantum
  'quantum.box': 'computation.modern-physics',
  'quantum.oscillator': 'computation.modern-physics',
  'quantum.hydrogen': 'computation.modern-physics',
  'quantum.tunnelling': 'computation.modern-physics',
  'quantum.uncertainty': 'computation.modern-physics',
  'quantum.measure': 'computation.modern-physics',
  'quantum.expectation': 'computation.modern-physics',

  // ---- provenance
  'modern.constants': 'computation.modern-physics',
  'modern.assumptions': 'computation.modern-physics'
})

/** What crosses the boundary, as opposed to what the engines will compute. */
export const MODERN_PHYSICS_LIMITS = Object.freeze({
  levels: 500,
  samples: 4000,
  components: 256,
  species: 64,
  stages: 32
})

const settle = <T>(value: T, isError: (one: unknown) => boolean): unknown =>
  isError(value) ? { ok: false, ...(value as object) } : { ok: true, ...(value as object) }

// ---------------------------------------------------------------- readers

function choice<T extends string>(read: Reader, key: string, allowed: readonly T[], fallback?: T): T {
  if (!read.has(key)) {
    if (fallback !== undefined) return fallback
    throw new BadInput(`"${key}" has to be one of: ${allowed.join(', ')}.`)
  }
  const value = read.text(key, 64)
  if (!(allowed as readonly string[]).includes(value)) {
    throw new BadInput(`"${value}" is not one of: ${allowed.join(', ')}.`)
  }
  return value as T
}

/**
 * Reads a group of arguments where the engine requires some of them but no single one of them.
 *
 * Passing the reader in is what makes the operation invisible to the generation catalogue, and that is the point:
 * a gas law needs three of four quantities, a photon takes any one of four properties, a relativistic particle takes
 * a speed or a gamma or an energy. None of those can be written as "this argument is required", so an operation
 * offered with only the arguments a static reader can see would pass the argument check and then be refused by the
 * engine.
 */
function optionalGroup(read: Reader, names: readonly string[]): Record<string, number | undefined> {
  const out: Record<string, number | undefined> = Object.create(null)
  for (const name of names) out[name] = read.has(name) ? read.number(name) : undefined
  return out
}

/** Cut a long trace down to what a chart can use, keeping both ends. */
function thin<T>(samples: readonly T[], wanted: number): readonly T[] {
  if (samples.length <= wanted) return samples
  const step = (samples.length - 1) / (wanted - 1)
  const out: T[] = []
  for (let i = 0; i < wanted; i += 1) out.push(samples[Math.round(i * step)])
  return out
}

// ---------------------------------------------------------------- dispatch

export function runModernPhysicsOperation(operation: string, input: Record<string, unknown>): unknown {
  const read = new Reader(input)

  switch (operation) {
    // ---------------------------------------------------------------- thermodynamics
    case 'gas.list':
      return { ok: true, gases: GASES }

    case 'gas.get':
      return settle(gasById(read.text('gas', 64)), isThermoError)

    case 'gas.state': {
      // Three of four quantities fix the fourth, and which three is the caller's choice, so they are read as a group.
      const quantities = optionalGroup(read, ['pressure', 'volume', 'temperature', 'moles', 'compressibility'])
      return settle(
        gasState({ ...quantities, gas: read.optionalText('gas', '', 64) || undefined }),
        isThermoError
      )
    }

    case 'gas.process': {
      // Two of the three starting quantities and one ending quantity, in whichever combination suits the process.
      const states = optionalGroup(read, [
        'fromPressure',
        'fromVolume',
        'fromTemperature',
        'toPressure',
        'toVolume',
        'toTemperature',
        'index',
        'gamma'
      ])
      const built = process({
        process: choice<Process>(read, 'process', PROCESSES, 'isothermal'),
        gas: read.optionalText('gas', '', 64) || undefined,
        moles: read.number('moles'),
        samples: Math.round(read.optionalNumber('samples', 100)),
        ...states
      })
      if (isThermoError(built)) return { ok: false, ...built }
      // The work and heat come from exact formulas; only the P-V path is thinned on the way out.
      return { ok: true, ...built, path: thin(built.path, Math.max(2, Math.min(Math.round(read.optionalNumber('trace', 200)), MODERN_PHYSICS_LIMITS.samples))) }
    }

    case 'gas.processes':
      return { ok: true, processes: PROCESSES, facts: PROCESS_FACTS }

    case 'cycle.efficiency': {
      // Which quantities a cycle needs depends on the cycle — temperatures, ratios, or steam enthalpies — so the
      // whole numeric set is read as a group.
      const quantities = optionalGroup(read, [
        'hotTemperature',
        'coldTemperature',
        'compressionRatio',
        'pressureRatio',
        'cutOffRatio',
        'gamma',
        'heatInput',
        'turbineInletEnthalpy',
        'turbineOutletEnthalpy',
        'condenserOutletEnthalpy',
        'pumpWork'
      ])
      return settle(
        cycle({
          cycle: choice<Cycle>(read, 'cycle', CYCLES, 'carnot'),
          gas: read.optionalText('gas', '', 64) || undefined,
          ...quantities
        }),
        isThermoError
      )
    }

    case 'cycle.list':
      return { ok: true, cycles: CYCLES, facts: CYCLE_FACTS }

    case 'entropy.transfer':
      return settle(
        entropyTransfer({
          heat: read.number('heat'),
          fromTemperature: read.number('fromTemperature'),
          toTemperature: read.number('toTemperature'),
          // Read inline rather than through the group helper: it is simply optional, and the helper would hide the
          // whole operation from the generation catalogue for no reason.
          surroundingsTemperature: read.has('surroundingsTemperature') ? read.number('surroundingsTemperature') : undefined
        }),
        isThermoError
      )

    case 'entropy.mixing': {
      const components = read.list('components', MODERN_PHYSICS_LIMITS.species).map((one, i) => {
        const entry = new Reader(one)
        return {
          label: entry.optionalText('label', '', 200) || `component ${i + 1}`,
          moles: entry.number('moles'),
          temperature: entry.has('temperature') ? entry.number('temperature') : undefined,
          molarHeatCapacity: entry.has('molarHeatCapacity') ? entry.number('molarHeatCapacity') : undefined
        }
      })
      return settle(
        entropyOfMixing({
          components,
          temperature: read.has('temperature') ? read.number('temperature') : undefined
        }),
        isThermoError
      )
    }

    case 'heat.phase-change': {
      // Which heat capacities and latent heats are needed depends on which phase boundaries the range crosses.
      const properties = optionalGroup(read, [
        'solidHeatCapacity',
        'liquidHeatCapacity',
        'gasHeatCapacity',
        'meltingPoint',
        'boilingPoint',
        'latentHeatOfFusion',
        'latentHeatOfVaporisation'
      ])
      return settle(
        phaseHeat({
          mass: read.number('mass'),
          fromTemperature: read.number('fromTemperature'),
          toTemperature: read.number('toTemperature'),
          ...properties
        }),
        isThermoError
      )
    }

    // ---------------------------------------------------------------- statistical mechanics
    case 'stat.boltzmann': {
      const levels = read.list('levels', MODERN_PHYSICS_LIMITS.levels).map((one, i) => {
        const entry = new Reader(one)
        return {
          label: entry.optionalText('label', '', 200) || `level ${i + 1}`,
          energy: entry.number('energy'),
          degeneracy: entry.has('degeneracy') ? Math.round(entry.number('degeneracy')) : undefined
        }
      })
      const unit = read.optionalText('unit', 'electron-volts', 32)
      if (unit !== 'joules' && unit !== 'electron-volts') {
        throw new BadInput(`"${unit}" is not a unit here; use "joules" or "electron-volts".`)
      }
      return settle(boltzmannDistribution({ temperature: read.number('temperature'), levels, unit }), isStatMechError)
    }

    case 'stat.speeds': {
      // A molar mass or a molecular mass, and the rest optional. Neither mass route alone is required.
      const quantities = optionalGroup(read, ['molarMass', 'molecularMassAmu', 'gamma', 'above'])
      const built = speedDistribution({
        temperature: read.number('temperature'),
        samples: Math.round(read.optionalNumber('samples', 200)),
        ...quantities
      })
      if (isStatMechError(built)) return { ok: false, ...built }
      return { ok: true, ...built, distribution: thin(built.distribution, Math.max(2, Math.min(Math.round(read.optionalNumber('trace', 200)), MODERN_PHYSICS_LIMITS.samples))) }
    }

    case 'stat.heat-capacity': {
      const shape = read.optionalText('shape', 'linear', 32)
      if (shape !== 'monatomic' && shape !== 'linear' && shape !== 'nonlinear') {
        throw new BadInput(`"${shape}" is not a molecular shape; use monatomic, linear or nonlinear.`)
      }
      return settle(
        heatCapacity({
          temperature: read.number('temperature'),
          shape,
          vibrationalModes: Math.round(read.optionalNumber('vibrationalModes', 0)),
          characteristicTemperatures: {
            rotational: read.has('rotationalTemperature') ? read.number('rotationalTemperature') : undefined,
            vibrational: read.has('vibrationalTemperature') ? read.number('vibrationalTemperature') : undefined
          }
        }),
        isStatMechError
      )
    }

    case 'stat.microstates': {
      // Either a state count per particle, or an explicit occupancy. Neither alone is required.
      const states = optionalGroup(read, ['states'])
      return settle(
        microstateEntropy({
          particles: read.number('particles'),
          states: states.states === undefined ? undefined : Math.round(states.states),
          occupancy: read.has('occupancy') ? read.numbers('occupancy', MODERN_PHYSICS_LIMITS.levels).map(Math.round) : undefined
        }),
        isStatMechError
      )
    }

    case 'stat.occupancy': {
      const unit = read.optionalText('unit', 'electron-volts', 32)
      if (unit !== 'joules' && unit !== 'electron-volts') {
        throw new BadInput(`"${unit}" is not a unit here; use "joules" or "electron-volts".`)
      }
      return settle(
        stateOccupancy({
          statistics: choice<Statistics>(read, 'statistics', STATISTICS_KINDS, 'fermi-dirac'),
          energy: read.number('energy'),
          chemicalPotential: read.optionalNumber('chemicalPotential', 0),
          temperature: read.number('temperature'),
          unit
        }),
        isStatMechError
      )
    }

    case 'stat.statistics':
      return { ok: true, kinds: STATISTICS_KINDS, facts: STATISTICS_FACTS }

    // ---------------------------------------------------------------- relativity
    case 'fast.lorentz': {
      // A speed or a beta, and the interval and length both optional.
      const quantities = optionalGroup(read, ['speed', 'beta', 'properTime', 'restLength'])
      return settle(lorentz(quantities), isRelativityError)
    }

    case 'fast.add-velocities': {
      const quantities = optionalGroup(read, ['first', 'second', 'firstBeta', 'secondBeta'])
      return settle(addVelocities(quantities), isRelativityError)
    }

    case 'fast.mass-energy': {
      // A mass in kilograms, in MeV, or a named particle; and one of four ways to say how fast.
      const quantities = optionalGroup(read, ['mass', 'massMev', 'speed', 'beta', 'gamma', 'kineticEnergyMev'])
      const particle = read.optionalText('particle', '', 32)
      if (particle !== '' && particle !== 'electron' && particle !== 'proton' && particle !== 'neutron') {
        throw new BadInput(`"${particle}" is not a particle this knows; use electron, proton or neutron.`)
      }
      return settle(
        massEnergy({ ...quantities, particle: particle === '' ? undefined : particle }),
        isRelativityError
      )
    }

    case 'fast.doppler': {
      const quantities = optionalGroup(read, ['sourceFrequency', 'sourceWavelength', 'relativeSpeed', 'beta', 'angleDegrees'])
      return settle(relativisticDoppler(quantities), isRelativityError)
    }

    // ---------------------------------------------------------------- light and nuclei
    case 'light.photon': {
      // Any one of four properties fixes the rest, so all four are read as a group.
      const quantities = optionalGroup(read, ['frequency', 'wavelength', 'energy', 'energyElectronVolts'])
      return settle(photon(quantities), isRelativityError)
    }

    case 'light.photoelectric': {
      const quantities = optionalGroup(read, ['photonEnergyElectronVolts', 'frequency', 'wavelength'])
      return settle(photoelectric({ workFunction: read.number('workFunction'), ...quantities }), isRelativityError)
    }

    case 'light.blackbody': {
      const built = blackbody({
        temperature: read.number('temperature'),
        samples: Math.round(read.optionalNumber('samples', 200)),
        area: read.has('area') ? read.number('area') : undefined
      })
      if (isRelativityError(built)) return { ok: false, ...built }
      return { ok: true, ...built, spectrum: thin(built.spectrum, Math.max(2, Math.min(Math.round(read.optionalNumber('trace', 200)), MODERN_PHYSICS_LIMITS.samples))) }
    }

    case 'light.de-broglie': {
      const quantities = optionalGroup(read, ['mass', 'speed', 'momentum', 'kineticEnergyElectronVolts', 'comparedWith', 'temperature'])
      const particle = read.optionalText('particle', '', 32)
      if (particle !== '' && particle !== 'electron' && particle !== 'proton' && particle !== 'neutron') {
        throw new BadInput(`"${particle}" is not a particle this knows; use electron, proton or neutron.`)
      }
      return settle(
        deBroglie({ ...quantities, particle: particle === '' ? undefined : particle }),
        isRelativityError
      )
    }

    case 'nucleus.binding':
      return settle(
        bindingEnergy({
          protons: Math.round(read.number('protons')),
          neutrons: Math.round(read.number('neutrons')),
          atomicMass: read.number('atomicMass'),
          includesElectrons: read.boolean('includesElectrons', true)
        }),
        isRelativityError
      )

    case 'nucleus.decay': {
      return settle(
        radioactiveDecay({
          halfLife: read.number('halfLife'),
          initialCount: read.number('initialCount'),
          elapsed: read.number('elapsed'),
          molarMass: read.has('molarMass') ? read.number('molarMass') : undefined
        }),
        isRelativityError
      )
    }

    // ---------------------------------------------------------------- quantum
    case 'quantum.box': {
      const givenMass = read.has('mass') ? read.number('mass') : undefined
      const particle = read.optionalText('particle', 'electron', 32)
      if (particle !== 'electron' && particle !== 'proton' && particle !== 'neutron') {
        throw new BadInput(`"${particle}" is not a particle this knows; use electron, proton or neutron.`)
      }
      const built = particleInBox({
        width: read.number('width'),
        particle: givenMass === undefined ? particle : undefined,
        mass: givenMass,
        levels: Math.round(read.optionalNumber('levels', 5)),
        densityFor: Math.round(read.optionalNumber('densityFor', 1)),
        samples: Math.round(read.optionalNumber('samples', 200))
      })
      if (isQuantumError(built)) return { ok: false, ...built }
      return { ok: true, ...built, density: thin(built.density, Math.max(2, Math.min(Math.round(read.optionalNumber('trace', 200)), MODERN_PHYSICS_LIMITS.samples))) }
    }

    case 'quantum.oscillator': {
      // An angular frequency, a frequency, or a spring constant. Any one works and none alone is required.
      const quantities = optionalGroup(read, ['angularFrequency', 'frequency', 'springConstant', 'mass'])
      const particle = read.optionalText('particle', '', 32)
      if (particle !== '' && particle !== 'electron' && particle !== 'proton' && particle !== 'neutron') {
        throw new BadInput(`"${particle}" is not a particle this knows; use electron, proton or neutron.`)
      }
      return settle(
        harmonicOscillator({
          ...quantities,
          particle: particle === '' ? undefined : particle,
          levels: Math.round(read.optionalNumber('levels', 5))
        }),
        isQuantumError
      )
    }

    case 'quantum.hydrogen': {
      // A transition needs both levels or neither. Read inline so the operation itself stays offerable; the engine
      // refuses a half-given transition with an explanation of its own.
      return settle(
        hydrogen({
          atomicNumber: Math.round(read.optionalNumber('atomicNumber', 1)),
          levels: Math.round(read.optionalNumber('levels', 6)),
          from: read.has('from') ? Math.round(read.number('from')) : undefined,
          to: read.has('to') ? Math.round(read.number('to')) : undefined
        }),
        isQuantumError
      )
    }

    case 'quantum.tunnelling': {
      const givenMass = read.has('mass') ? read.number('mass') : undefined
      const particle = read.optionalText('particle', 'electron', 32)
      if (particle !== 'electron' && particle !== 'proton' && particle !== 'neutron') {
        throw new BadInput(`"${particle}" is not a particle this knows; use electron, proton or neutron.`)
      }
      return settle(
        tunnelling({
          particleEnergy: read.number('particleEnergy'),
          barrierHeight: read.number('barrierHeight'),
          barrierWidth: read.number('barrierWidth'),
          particle: givenMass === undefined ? particle : undefined,
          mass: givenMass
        }),
        isQuantumError
      )
    }

    case 'quantum.uncertainty': {
      // One or both of the pair. Giving one reports the floor on the other, so neither is required.
      const quantities = optionalGroup(read, ['first', 'second'])
      const pair = read.optionalText('pair', 'position-momentum', 32)
      if (pair !== 'position-momentum' && pair !== 'energy-time') {
        throw new BadInput(`"${pair}" is not a pair here; use position-momentum or energy-time.`)
      }
      return settle(uncertainty({ pair, ...quantities }), isQuantumError)
    }

    case 'quantum.measure': {
      // Probabilities and never an outcome. Nothing on this path draws a random number, so a Page that wants a
      // simulated run does its own draw and it stays visible that one happened.
      const amplitudes: Amplitude[] = read.list('amplitudes', MODERN_PHYSICS_LIMITS.components).map((one, i) => {
        const entry = new Reader(one)
        return {
          label: entry.optionalText('label', '', 200) || `outcome ${i + 1}`,
          real: entry.optionalNumber('real', 0),
          imaginary: entry.optionalNumber('imaginary', 0)
        }
      })
      return settle(
        measure({ amplitudes, requireNormalised: read.boolean('requireNormalised', false) }),
        isQuantumError
      )
    }

    case 'quantum.expectation': {
      const outcomes = read.list('outcomes', MODERN_PHYSICS_LIMITS.components).map((one, i) => {
        const entry = new Reader(one)
        return {
          label: entry.optionalText('label', '', 200) || `outcome ${i + 1}`,
          value: entry.number('value'),
          probability: entry.number('probability')
        }
      })
      return settle(expectationValue({ outcomes }), isQuantumError)
    }

    // ---------------------------------------------------------------- provenance
    case 'modern.constants':
      return {
        ok: true,
        thermodynamics: THERMO_CONSTANTS,
        statisticalMechanics: STATMECH_CONSTANTS,
        relativity: MODERN_PHYSICS_CONSTANTS,
        quantum: QUANTUM_CONSTANTS
      }

    case 'modern.assumptions':
      return {
        ok: true,
        thermodynamics: THERMO_ASSUMPTIONS,
        statisticalMechanics: STATMECH_ASSUMPTIONS,
        relativity: RELATIVITY_ASSUMPTIONS,
        quantum: QUANTUM_ASSUMPTIONS
      }

    default:
      throw new BadInput(`"${operation}" is not a modern-physics operation.`)
  }
}
