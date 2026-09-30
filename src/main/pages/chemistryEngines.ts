/**
 * The chemistry bench a Page can reach: elements, formulas, solutions, reactions and process arithmetic.
 *
 * Same contract as every bridge before it. A Page sends data, never code. There is no `eval` and no `new Function`
 * on any path reachable from here, and every number a Page shows came back through this door from an engine that
 * computed it — none of it is produced by a language model and none of it is hardcoded.
 *
 * ## No invented coefficients and no forced balances
 *
 * An equation that cannot be balanced is refused rather than returned with plausible numbers, and a mass balance
 * reports its residual rather than closing itself. Both matter for the same reason: a result that looks right is
 * harder to catch than one that obviously failed.
 *
 * ## The operations that refuse rather than default
 *
 * `formula.parse` refuses a malformed formula with the position of the problem. `reaction.balance` refuses an
 * equation with an element on only one side, by name. `solution.ph` refuses a concentration high enough that pH
 * stops meaning what it computes. `solution.concentration` refuses to convert molarity into a mass-based unit
 * without the solution density, instead of assuming water. `process.distillation` refuses a reflux below the
 * minimum, with the minimum that would work. `element.get` refuses `CO` when `Co` was meant, and says which is
 * which.
 */

import {
  ATOMIC_WEIGHT_SOURCE,
  CHEMISTRY_ASSUMPTIONS,
  ELEMENTS,
  balanceEquation,
  elementBy,
  isChemistryError,
  moleConversion,
  parseFormula,
  stoichiometry
} from '../../shared/compute/chemistry.ts'
import {
  CONCENTRATION_FACTS,
  CONCENTRATION_UNITS,
  SOLUTION_ASSUMPTIONS,
  WATER_ION_PRODUCT,
  WATER_ION_PRODUCT_SOURCE,
  buffer,
  colligative,
  concentration,
  dilution,
  isSolutionError,
  pH,
  solubility,
  titration
} from '../../shared/compute/solutions.ts'
import {
  REACTION_ASSUMPTIONS,
  STANDARD_STATE,
  arrhenius,
  cellPotential,
  convertConstant,
  electrolysis,
  equilibrium,
  isReactionError,
  rateLaw,
  thermochemistry
} from '../../shared/compute/reactions.ts'
import {
  CHEMENG_ASSUMPTIONS,
  REACTOR_FACTS,
  REACTOR_KINDS,
  conversionSelectivity,
  distillation,
  isChemEngError,
  massBalance,
  raoult,
  sizeReactor,
  type ReactorKind
} from '../../shared/compute/chemicalEngineering.ts'
import { BadInput, Reader } from './engines.ts'

/**
 * Every operation this bridge answers, and the capability each one needs.
 *
 * All of them need the same one. A Page that can parse a formula can also size a reactor, and splitting them into
 * four permissions would ask the user four questions about the same thing — arithmetic that reaches nothing outside
 * the Page.
 */
export const CHEMISTRY_CAPABILITY: Readonly<Record<string, string>> = Object.freeze({
  // ---- elements and formulas
  'element.list': 'computation.chemistry',
  'element.get': 'computation.chemistry',
  'formula.parse': 'computation.chemistry',
  'formula.moles': 'computation.chemistry',

  // ---- equations
  'reaction.balance': 'computation.chemistry',
  'reaction.stoichiometry': 'computation.chemistry',

  // ---- solutions
  'solution.concentration': 'computation.chemistry',
  'solution.units': 'computation.chemistry',
  'solution.dilution': 'computation.chemistry',
  'solution.ph': 'computation.chemistry',
  'solution.buffer': 'computation.chemistry',
  'solution.titration': 'computation.chemistry',
  'solution.solubility': 'computation.chemistry',
  'solution.colligative': 'computation.chemistry',

  // ---- reactions
  'reaction.thermochemistry': 'computation.chemistry',
  'reaction.equilibrium': 'computation.chemistry',
  'reaction.constants': 'computation.chemistry',
  'reaction.rate': 'computation.chemistry',
  'reaction.arrhenius': 'computation.chemistry',
  'reaction.cell': 'computation.chemistry',
  'reaction.electrolysis': 'computation.chemistry',

  // ---- process
  'process.mass-balance': 'computation.chemistry',
  'process.reactor': 'computation.chemistry',
  'process.reactors': 'computation.chemistry',
  'process.conversion': 'computation.chemistry',
  'process.distillation': 'computation.chemistry',
  'process.raoult': 'computation.chemistry',

  // ---- provenance
  'chemistry.assumptions': 'computation.chemistry'
})

/** What crosses the boundary, as opposed to what the engines will compute. */
export const CHEMISTRY_LIMITS = Object.freeze({
  species: 64,
  streams: 64,
  components: 32,
  samples: 4000,
  stages: 500
})

const settle = <T>(value: T, isError: (one: unknown) => boolean): unknown =>
  isError(value) ? { ok: false, ...(value as object) } : { ok: true, ...(value as object) }

// ---------------------------------------------------------------- readers

function objectAt(read: Reader, key: string): Reader {
  const raw = read.raw(key)
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new BadInput(`"${key}" has to be an object.`)
  }
  return new Reader(raw as Record<string, unknown>)
}

/**
 * Reads a group of arguments where the engine requires some of them but no single one of them.
 *
 * Passing the reader in is what makes the operation invisible to the generation catalogue, and that is deliberate: a
 * mole conversion takes any one of four quantities, a pH takes a pKa only for a weak acid, a dilution takes three of
 * four. None of those can be written as "this argument is required", so an operation offered with only the arguments
 * a static reader can see would pass the argument check and then be refused by the engine.
 */
function optionalGroup(read: Reader, names: readonly string[]): Record<string, number | undefined> {
  const out: Record<string, number | undefined> = Object.create(null)
  for (const name of names) out[name] = read.has(name) ? read.number(name) : undefined
  return out
}

/** A `{name: number}` map read safely, for a stream composition or a set of supplied amounts. */
function numberMap(read: Reader, key: string, max: number): Record<string, number> {
  const raw = read.raw(key)
  if (raw === undefined) return Object.create(null) as Record<string, number>
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new BadInput(`"${key}" has to be a set of named numbers.`)
  }
  const out: Record<string, number> = Object.create(null)
  let count = 0
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (count >= max) throw new BadInput(`"${key}" has more than the ${max} entries allowed.`)
    // A formula or component name, with the reserved property names kept out so nothing reaches a prototype.
    if (!/^[A-Za-z][A-Za-z0-9().+\-_]*$/.test(name) || name === '__proto__' || name === 'constructor' || name === 'prototype') {
      throw new BadInput(`"${name}" is not a usable name here.`)
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new BadInput(`"${name}" has to be a finite number.`)
    out[name] = value
    count += 1
  }
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

export function runChemistryOperation(operation: string, input: Record<string, unknown>): unknown {
  const read = new Reader(input)

  switch (operation) {
    // ---------------------------------------------------------------- elements and formulas
    case 'element.list':
      return { ok: true, elements: ELEMENTS, source: ATOMIC_WEIGHT_SOURCE }

    case 'element.get': {
      // A symbol, a name, or an atomic number. Symbols are case sensitive on purpose.
      const raw = read.raw('element')
      const key = typeof raw === 'number' ? Math.round(raw) : read.text('element', 64)
      return settle(elementBy(key), isChemistryError)
    }

    case 'formula.parse':
      return settle(parseFormula(read.text('formula', 500)), isChemistryError)

    case 'formula.moles': {
      // Any one of four quantities fixes the rest, so all four are read as a group.
      const quantities = optionalGroup(read, ['grams', 'moles', 'particles', 'litresOfGas', 'temperature', 'pressure'])
      return settle(moleConversion({ formula: read.text('formula', 500), ...quantities }), isChemistryError)
    }

    // ---------------------------------------------------------------- equations
    case 'reaction.balance':
      return settle(
        balanceEquation({
          reactants: read.strings('reactants', CHEMISTRY_LIMITS.species),
          products: read.strings('products', CHEMISTRY_LIMITS.species)
        }),
        isChemistryError
      )

    case 'reaction.stoichiometry': {
      return settle(
        stoichiometry({
          reactants: read.strings('reactants', CHEMISTRY_LIMITS.species),
          products: read.strings('products', CHEMISTRY_LIMITS.species),
          suppliedGrams: read.has('suppliedGrams') ? numberMap(read, 'suppliedGrams', CHEMISTRY_LIMITS.species) : undefined,
          suppliedMoles: read.has('suppliedMoles') ? numberMap(read, 'suppliedMoles', CHEMISTRY_LIMITS.species) : undefined,
          yieldOf: read.optionalText('yieldOf', '', 500) || undefined,
          actualYieldGrams: read.has('actualYieldGrams') ? read.number('actualYieldGrams') : undefined
        }),
        isChemistryError
      )
    }

    // ---------------------------------------------------------------- solutions
    case 'solution.concentration': {
      // One concentration in, and the density needed only for some conversions. Read as a group.
      const quantities = optionalGroup(read, [
        'molarity',
        'molality',
        'massPercent',
        'ppm',
        'moleFraction',
        'solutionDensity',
        'solventMolarMass',
        'equivalents'
      ])
      return settle(
        concentration({
          formula: read.text('formula', 500),
          ...quantities,
          equivalents: quantities.equivalents === undefined ? undefined : Math.round(quantities.equivalents)
        }),
        isSolutionError
      )
    }

    case 'solution.units':
      return { ok: true, units: CONCENTRATION_UNITS, facts: CONCENTRATION_FACTS }

    case 'solution.dilution': {
      // Three of four fix the fourth, and which three is the caller's choice.
      const quantities = optionalGroup(read, ['initialConcentration', 'initialVolume', 'finalConcentration', 'finalVolume'])
      return settle(dilution(quantities), isSolutionError)
    }

    case 'solution.ph': {
      const kind = read.optionalText('kind', 'strong-acid', 32)
      if (!['strong-acid', 'strong-base', 'weak-acid', 'weak-base'].includes(kind)) {
        throw new BadInput(`"${kind}" is not a kind here; use strong-acid, strong-base, weak-acid or weak-base.`)
      }
      // A pKa or pKb is needed only for a weak acid or base. Read inline so the operation stays offerable; a weak
      // acid given without one gets the engine's own explanation.
      return settle(
        pH({
          concentration: read.number('concentration'),
          kind: kind as 'strong-acid' | 'strong-base' | 'weak-acid' | 'weak-base',
          pKa: read.has('pKa') ? read.number('pKa') : undefined,
          pKb: read.has('pKb') ? read.number('pKb') : undefined,
          temperature: read.has('temperature') ? read.number('temperature') : undefined
        }),
        isSolutionError
      )
    }

    case 'solution.buffer': {
      // A target pH, or the two concentrations. Neither route alone is required.
      const quantities = optionalGroup(read, ['targetPh', 'acidConcentration', 'baseConcentration', 'addStrongBaseMoles'])
      return settle(buffer({ pKa: read.number('pKa'), ...quantities }), isSolutionError)
    }

    case 'solution.titration': {
      const analyte = read.optionalText('analyte', 'strong-acid', 32)
      if (!['strong-acid', 'weak-acid', 'strong-base', 'weak-base'].includes(analyte)) {
        throw new BadInput(`"${analyte}" is not an analyte kind; use strong-acid, weak-acid, strong-base or weak-base.`)
      }
      const built = titration({
        analyteConcentration: read.number('analyteConcentration'),
        analyteVolume: read.number('analyteVolume'),
        titrantConcentration: read.number('titrantConcentration'),
        analyte: analyte as 'strong-acid' | 'weak-acid' | 'strong-base' | 'weak-base',
        samples: Math.round(read.optionalNumber('samples', 200)),
        pKa: read.has('pKa') ? read.number('pKa') : undefined
      })
      if (isSolutionError(built)) return { ok: false, ...built }
      const wanted = Math.max(3, Math.min(Math.round(read.optionalNumber('trace', 200)), CHEMISTRY_LIMITS.samples))
      return { ok: true, ...built, curve: thin(built.curve, wanted) }
    }

    case 'solution.solubility': {
      // The stoichiometry has defaults; the common-ion and precipitation tests are optional extras. All read inline,
      // so the operation itself stays offerable.
      const which = read.optionalText('commonIonIs', 'anion', 16)
      if (which !== 'cation' && which !== 'anion') {
        throw new BadInput(`"${which}" is not an ion here; use "cation" or "anion".`)
      }
      return settle(
        solubility({
          ksp: read.number('ksp'),
          formula: read.optionalText('formula', '', 500) || undefined,
          commonIonIs: which,
          cationCount: Math.round(read.optionalNumber('cationCount', 1)),
          anionCount: Math.round(read.optionalNumber('anionCount', 1)),
          commonIonConcentration: read.has('commonIonConcentration') ? read.number('commonIonConcentration') : undefined,
          cationConcentration: read.has('cationConcentration') ? read.number('cationConcentration') : undefined,
          anionConcentration: read.has('anionConcentration') ? read.number('anionConcentration') : undefined
        }),
        isSolutionError
      )
    }

    case 'solution.colligative': {
      return settle(
        colligative({
          molality: read.number('molality'),
          // Read inline: each is simply optional, and the group helper would hide an operation whose only required
          // argument is plainly visible.
          vanHoffFactor: read.has('vanHoffFactor') ? read.number('vanHoffFactor') : undefined,
          boilingConstant: read.has('boilingConstant') ? read.number('boilingConstant') : undefined,
          freezingConstant: read.has('freezingConstant') ? read.number('freezingConstant') : undefined,
          pureBoilingPoint: read.has('pureBoilingPoint') ? read.number('pureBoilingPoint') : undefined,
          pureFreezingPoint: read.has('pureFreezingPoint') ? read.number('pureFreezingPoint') : undefined,
          temperature: read.has('temperature') ? read.number('temperature') : undefined
        }),
        isSolutionError
      )
    }

    // ---------------------------------------------------------------- reactions
    case 'reaction.thermochemistry': {
      // The two lists are read with literal keys so the generation catalogue can see that they are required. A key
      // held in a variable is invisible to it, and an operation offered without its required list would pass the
      // argument check and then be refused by the engine.
      const speciesFrom = (rows: readonly Record<string, unknown>[]) =>
        rows.map((one, i) => {
          const entry = new Reader(one)
          return {
            formula: entry.optionalText('formula', '', 500) || `species ${i + 1}`,
            coefficient: entry.has('coefficient') ? entry.number('coefficient') : undefined,
            formationEnthalpy: entry.number('formationEnthalpy'),
            entropy: entry.has('entropy') ? entry.number('entropy') : undefined
          }
        })
      return settle(
        thermochemistry({
          reactants: speciesFrom(read.list('reactants', CHEMISTRY_LIMITS.species)),
          products: speciesFrom(read.list('products', CHEMISTRY_LIMITS.species)),
          temperature: read.has('temperature') ? read.number('temperature') : undefined
        }),
        isReactionError
      )
    }

    case 'reaction.equilibrium': {
      const speciesFrom = (rows: readonly Record<string, unknown>[]) =>
        rows.map((one, i) => {
          const entry = new Reader(one)
          return {
            formula: entry.optionalText('formula', '', 500) || `species ${i + 1}`,
            coefficient: entry.has('coefficient') ? entry.number('coefficient') : undefined,
            initial: entry.optionalNumber('initial', 0)
          }
        })
      return settle(
        equilibrium({
          constant: read.number('constant'),
          reactants: speciesFrom(read.list('reactants', CHEMISTRY_LIMITS.species)),
          products: speciesFrom(read.list('products', CHEMISTRY_LIMITS.species))
        }),
        isReactionError
      )
    }

    case 'reaction.constants': {
      // Exactly one of Kc and Kp goes in and the other comes out, so both are read as a group.
      const quantities = optionalGroup(read, ['kc', 'kp', 'temperature'])
      const unit = read.optionalText('pressureUnit', 'bar', 16)
      if (unit !== 'bar' && unit !== 'atmospheres') {
        throw new BadInput(`"${unit}" is not a pressure unit here; use "bar" or "atmospheres".`)
      }
      return settle(
        convertConstant({ deltaMolesGas: Math.round(read.number('deltaMolesGas')), pressureUnit: unit, ...quantities }),
        isReactionError
      )
    }

    case 'reaction.rate': {
      const built = rateLaw({
        order: Math.round(read.optionalNumber('order', 1)),
        rateConstant: read.number('rateConstant'),
        initialConcentration: read.number('initialConcentration'),
        samples: Math.round(read.optionalNumber('samples', 200)),
        duration: read.has('duration') ? read.number('duration') : undefined,
        conversion: read.has('conversion') ? read.number('conversion') : undefined
      })
      if (isReactionError(built)) return { ok: false, ...built }
      const wanted = Math.max(2, Math.min(Math.round(read.optionalNumber('trace', 200)), CHEMISTRY_LIMITS.samples))
      return { ok: true, ...built, samples: thin(built.samples, wanted) }
    }

    case 'reaction.arrhenius': {
      // An activation energy with a constant, or two temperatures with two constants. Neither route alone is required.
      const quantities = optionalGroup(read, [
        'activationEnergy',
        'preExponential',
        'rateConstant',
        'secondTemperature',
        'secondRateConstant'
      ])
      return settle(arrhenius({ temperature: read.number('temperature'), ...quantities }), isReactionError)
    }

    case 'reaction.cell':
      return settle(
        cellPotential({
          cathodePotential: read.number('cathodePotential'),
          anodePotential: read.number('anodePotential'),
          electrons: Math.round(read.number('electrons')),
          reactionQuotient: read.optionalNumber('reactionQuotient', 1),
          temperature: read.has('temperature') ? read.number('temperature') : undefined
        }),
        isReactionError
      )

    case 'reaction.electrolysis': {
      // A time to find the mass, or a target mass to find the time. Neither alone is required.
      const quantities = optionalGroup(read, ['time', 'targetMass', 'molarMass', 'efficiency'])
      return settle(
        electrolysis({
          current: read.number('current'),
          electrons: Math.round(read.number('electrons')),
          isGas: read.boolean('isGas', false),
          ...quantities
        }),
        isReactionError
      )
    }

    // ---------------------------------------------------------------- process
    case 'process.mass-balance': {
      const streamsFrom = (rows: readonly Record<string, unknown>[], side: string) =>
        rows.map((one, i) => {
          const entry = new Reader(one)
          return {
            label: entry.optionalText('label', '', 200) || `${side} ${i + 1}`,
            flow: entry.number('flow'),
            composition: numberMap(entry, 'composition', CHEMISTRY_LIMITS.components)
          }
        })
      return settle(
        massBalance({
          inlets: streamsFrom(read.list('inlets', CHEMISTRY_LIMITS.streams), 'inlet'),
          outlets: streamsFrom(read.list('outlets', CHEMISTRY_LIMITS.streams), 'outlet'),
          tolerance: read.optionalNumber('tolerance', 0.02)
        }),
        isChemEngError
      )
    }

    case 'process.reactor': {
      const kind = read.optionalText('kind', 'pfr', 16)
      if (!(REACTOR_KINDS as readonly string[]).includes(kind)) {
        throw new BadInput(`"${kind}" is not a reactor this sizes; use ${REACTOR_KINDS.join(', ')}.`)
      }
      return settle(
        sizeReactor({
          kind: kind as ReactorKind,
          rateConstant: read.number('rateConstant'),
          order: read.optionalNumber('order', 1),
          inletConcentration: read.number('inletConcentration'),
          conversion: read.number('conversion'),
          volumetricFlow: read.has('volumetricFlow') ? read.number('volumetricFlow') : undefined
        }),
        isChemEngError
      )
    }

    case 'process.reactors':
      return { ok: true, kinds: REACTOR_KINDS, facts: REACTOR_FACTS }

    case 'process.conversion': {
      return settle(
        conversionSelectivity({
          reactantIn: read.number('reactantIn'),
          reactantOut: read.number('reactantOut'),
          productOut: read.has('productOut') ? read.number('productOut') : undefined,
          stoichiometricRatio: read.optionalNumber('stoichiometricRatio', 1)
        }),
        isChemEngError
      )
    }

    case 'process.distillation': {
      // A reflux ratio or a multiple of the minimum. Either works and neither alone is required.
      const quantities = optionalGroup(read, [
        'refluxRatio',
        'refluxAsMultipleOfMinimum',
        'trayEfficiency',
        'feedQuality'
      ])
      const built = distillation({
        relativeVolatility: read.number('relativeVolatility'),
        feedComposition: read.number('feedComposition'),
        distillateComposition: read.number('distillateComposition'),
        bottomsComposition: read.number('bottomsComposition'),
        samples: Math.round(read.optionalNumber('samples', 100)),
        ...quantities
      })
      if (isChemEngError(built)) return { ok: false, ...built }
      const wanted = Math.max(2, Math.min(Math.round(read.optionalNumber('trace', 100)), CHEMISTRY_LIMITS.samples))
      return { ok: true, ...built, equilibriumCurve: thin(built.equilibriumCurve, wanted) }
    }

    case 'process.raoult': {
      const components = read.list('components', CHEMISTRY_LIMITS.components).map((one, i) => {
        const entry = new Reader(one)
        return {
          label: entry.optionalText('label', '', 200) || `component ${i + 1}`,
          liquidFraction: entry.number('liquidFraction'),
          vapourPressure: entry.number('vapourPressure')
        }
      })
      return settle(raoult({ components }), isChemEngError)
    }

    // ---------------------------------------------------------------- provenance
    case 'chemistry.assumptions':
      return {
        ok: true,
        elements: CHEMISTRY_ASSUMPTIONS,
        solutions: SOLUTION_ASSUMPTIONS,
        reactions: REACTION_ASSUMPTIONS,
        process: CHEMENG_ASSUMPTIONS,
        atomicWeightSource: ATOMIC_WEIGHT_SOURCE,
        waterIonProduct: WATER_ION_PRODUCT,
        waterIonProductSource: WATER_ION_PRODUCT_SOURCE,
        standardState: STANDARD_STATE
      }

    default:
      throw new BadInput(`"${operation}" is not a chemistry operation.`)
  }
}

/** Kept exported so a Page can validate a formula without a round trip through dispatch. */
export const CHEMISTRY_LOOKUPS = Object.freeze({ elementBy, parseFormula, objectAt })
