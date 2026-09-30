/**
 * The life-sciences workbench a Page can reach: sequences, inheritance, enzymes, bodies and populations.
 *
 * Same contract as every bridge before it. A Page sends data, never code. There is no `eval` and no `new Function`
 * on any path reachable from here, and every number a Page shows came back through this door from an engine that
 * computed it — none of it is produced by a language model and none of it is hardcoded.
 *
 * ## Nothing here is a clinical judgement
 *
 * The `body.*` operations compute reference figures from numbers a Page supplied: a body mass index, a metabolic
 * rate, an estimated kidney function, a drug half-life. Every one of those results carries a `notClinical` field
 * stating plainly that it is arithmetic rather than advice, and the engines refuse rather than extrapolate — the
 * adult body mass index bands are refused for anyone under twenty, and the kidney equations are refused outside the
 * adult range they were fitted to. A Page can display these. A Page cannot turn them into a diagnosis, because no
 * operation here produces one.
 *
 * ## What is capped here and what is not
 *
 * The engines integrate population models over hundreds of thousands of steps and translate sequences of two hundred
 * thousand bases. This door caps what comes *back*, not what is computed: a trajectory is integrated at whatever
 * resolution it was given and only the sampled trace crosses the boundary. A translated protein is returned whole,
 * because a protein cut in half is not a shorter answer but a wrong one.
 *
 * ## The operations that refuse rather than default
 *
 * `dna.read` refuses a sequence containing both thymine and uracil, because it is neither DNA nor RNA and every
 * figure downstream would be wrong in a way nobody notices. `dna.translate` always reports what the other five
 * reading frames would give, because "the protein this codes for" is not a well-defined question without a frame.
 * `breathe.ventilation` refuses a dead space at or above the tidal volume rather than returning a negative alveolar
 * ventilation. `enzyme.kinetics` refuses fewer than three points for a two-constant fit. `life.table` refuses a
 * cohort that gains members between age classes.
 */

import {
  AMINO_ACIDS,
  CODON_TABLE,
  CODON_TABLE_SOURCE,
  GENETICS_ASSUMPTIONS,
  GENETICS_LIMITS,
  cross,
  hardyWeinberg,
  isGeneticsError,
  linkage,
  readSequence,
  translate,
  type SequenceKind
} from '../../shared/compute/genetics.ts'
import {
  BIOCHEMISTRY_ASSUMPTIONS,
  binding,
  bioenergetics,
  enzymeKinetics,
  inhibition,
  isBiochemistryError,
  proteinProperties,
  type KineticsPoint
} from '../../shared/compute/biochemistry.ts'
import {
  NOT_CLINICAL,
  PHYSIOLOGY_ASSUMPTIONS,
  bodyMeasures,
  circulation,
  isPhysiologyError,
  kidneyFunction,
  metabolicRate,
  pharmacokinetics,
  ventilation,
  type ActivityLevel,
  type BiologicalSex
} from '../../shared/compute/physiology.ts'
import {
  ECOLOGY_ASSUMPTIONS,
  diversity,
  foodChain,
  isEcologyError,
  lifeTable,
  markRecapture,
  populationGrowth,
  predatorPrey,
  type GrowthModel
} from '../../shared/compute/ecology.ts'
import { BadInput, Reader } from './engines.ts'

/**
 * Every operation this bridge answers, and the capability each one needs.
 *
 * All of them need the same one. A Page that can read a DNA sequence can also fit an enzyme curve and project a
 * population, and splitting those into four permissions would ask the user four questions about the same thing —
 * arithmetic that reaches nothing outside the Page.
 */
export const BIOLOGY_CAPABILITY: Readonly<Record<string, string>> = Object.freeze({
  // ---- sequences and the code
  'dna.read': 'computation.biology',
  'dna.translate': 'computation.biology',
  'dna.codon-table': 'computation.biology',
  'dna.amino-acids': 'computation.biology',

  // ---- inheritance
  'inherit.cross': 'computation.biology',
  'inherit.population': 'computation.biology',
  'inherit.linkage': 'computation.biology',

  // ---- enzymes and proteins
  'enzyme.kinetics': 'computation.biology',
  'enzyme.inhibition': 'computation.biology',
  'enzyme.binding': 'computation.biology',
  'protein.properties': 'computation.biology',
  'energy.reaction': 'computation.biology',

  // ---- bodies
  'body.measures': 'computation.biology',
  'body.metabolism': 'computation.biology',
  'body.activity-levels': 'computation.biology',
  'heart.output': 'computation.biology',
  'breathe.ventilation': 'computation.biology',
  'kidney.function': 'computation.biology',
  'drug.kinetics': 'computation.biology',

  // ---- populations
  'population.growth': 'computation.biology',
  'population.models': 'computation.biology',
  'population.predator-prey': 'computation.biology',
  'population.mark-recapture': 'computation.biology',
  'population.life-table': 'computation.biology',
  'ecology.diversity': 'computation.biology',
  'ecology.food-chain': 'computation.biology',

  // ---- provenance
  'biology.assumptions': 'computation.biology',
  'biology.not-clinical': 'computation.biology'
})

/** What crosses the boundary, as opposed to what the engines will compute. */
export const BIOLOGY_LIMITS = Object.freeze({
  bases: GENETICS_LIMITS.bases,
  points: 4000,
  species: 2000,
  ageClasses: 1000,
  samples: 400,
  efficiencies: 12
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
 * a Hardy-Weinberg calculation needs an allele frequency or an affected fraction or three observed counts, and a
 * free energy needs a standard change or an equilibrium constant. None of those can be written as "this argument is
 * required", so an operation offered with only the arguments a static reader can see would pass the argument check
 * and then be refused by the engine.
 */
function optionalGroup(read: Reader, names: readonly string[]): Record<string, number | undefined> {
  const out: Record<string, number | undefined> = Object.create(null)
  for (const name of names) out[name] = read.has(name) ? read.number(name) : undefined
  return out
}

const SEXES: readonly BiologicalSex[] = ['male', 'female']
const ACTIVITY_LEVELS: readonly ActivityLevel[] = ['sedentary', 'light', 'moderate', 'active', 'very-active']
const GROWTH_MODELS: readonly GrowthModel[] = ['exponential', 'logistic', 'gompertz', 'ricker', 'beverton-holt']
const SEQUENCE_KINDS: readonly SequenceKind[] = ['dna', 'rna']

/** Rate pairs for an enzyme series, read from an already-fetched list of rows. */
function kineticsPoints(rows: readonly Record<string, unknown>[]): KineticsPoint[] {
  return rows.map((one) => {
    const entry = new Reader(one)
    return { substrate: entry.number('substrate'), rate: entry.number('rate') }
  })
}

export function runBiologyOperation(operation: string, input: Record<string, unknown>): unknown {
  const read = new Reader(input)

  switch (operation) {
    // ---------------------------------------------------------------- sequences
    case 'dna.read':
      return settle(
        readSequence({
          sequence: read.text('sequence', BIOLOGY_LIMITS.bases),
          kind: read.has('kind') ? choice<SequenceKind>(read, 'kind', SEQUENCE_KINDS) : undefined
        }),
        isGeneticsError
      )

    case 'dna.translate':
      return settle(
        translate({
          sequence: read.text('sequence', BIOLOGY_LIMITS.bases),
          frame: read.has('frame') ? read.number('frame') : undefined
        }),
        isGeneticsError
      )

    case 'dna.codon-table':
      return { ok: true, table: CODON_TABLE, source: CODON_TABLE_SOURCE }

    case 'dna.amino-acids':
      return { ok: true, aminoAcids: AMINO_ACIDS }

    // ---------------------------------------------------------------- inheritance
    case 'inherit.cross':
      return settle(
        cross({
          first: read.text('first', 64),
          second: read.text('second', 64),
          incompleteDominance: read.has('incompleteDominance') ? read.boolean('incompleteDominance') : undefined,
          codominance: read.has('codominance') ? read.boolean('codominance') : undefined
        }),
        isGeneticsError
      )

    case 'inherit.population': {
      // A recessive frequency, an affected fraction, or all three observed counts. None is required on its own,
      // and the engine refuses when none of the three routes is complete.
      const routes = optionalGroup(read, [
        'recessiveFrequency',
        'affectedFraction',
        'observedHomozygousDominant',
        'observedHeterozygous',
        'observedHomozygousRecessive'
      ])
      return settle(hardyWeinberg({ ...routes }), isGeneticsError)
    }

    case 'inherit.linkage':
      return settle(
        linkage({
          parentalOne: read.number('parentalOne'),
          parentalTwo: read.number('parentalTwo'),
          recombinantOne: read.number('recombinantOne'),
          recombinantTwo: read.number('recombinantTwo')
        }),
        isGeneticsError
      )

    // ---------------------------------------------------------------- enzymes and proteins
    case 'enzyme.kinetics':
      return settle(
        enzymeKinetics({
          points: kineticsPoints(read.list('points', BIOLOGY_LIMITS.points)),
          enzymeConcentration: read.has('enzymeConcentration') ? read.number('enzymeConcentration') : undefined
        }),
        isBiochemistryError
      )

    case 'enzyme.inhibition':
      return settle(
        inhibition({
          control: kineticsPoints(read.list('control', BIOLOGY_LIMITS.points)),
          inhibited: kineticsPoints(read.list('inhibited', BIOLOGY_LIMITS.points)),
          inhibitorConcentration: read.has('inhibitorConcentration') ? read.number('inhibitorConcentration') : undefined
        }),
        isBiochemistryError
      )

    case 'enzyme.binding':
      return settle(
        binding({
          points: read.list('points', BIOLOGY_LIMITS.points).map((one) => {
            const entry = new Reader(one)
            return { ligand: entry.number('ligand'), occupancy: entry.number('occupancy') }
          }),
          normalised: read.has('normalised') ? read.boolean('normalised') : undefined
        }),
        isBiochemistryError
      )

    case 'protein.properties':
      return settle(
        proteinProperties({
          sequence: read.text('sequence', BIOLOGY_LIMITS.bases),
          ph: read.has('ph') ? read.number('ph') : undefined,
          disulfideBonds: read.has('disulfideBonds') ? read.number('disulfideBonds') : undefined
        }),
        isBiochemistryError
      )

    case 'energy.reaction': {
      // A standard free energy change or an equilibrium constant. Neither is required on its own.
      const routes = optionalGroup(read, ['deltaG', 'equilibriumConstant', 'temperature'])
      return settle(
        bioenergetics({
          ...routes,
          products: read.has('products') ? read.numbers('products', 64) : undefined,
          reactants: read.has('reactants') ? read.numbers('reactants', 64) : undefined
        }),
        isBiochemistryError
      )
    }

    // ---------------------------------------------------------------- bodies
    case 'body.measures':
      return settle(
        bodyMeasures({
          height: read.number('height'),
          weight: read.number('weight'),
          waist: read.has('waist') ? read.number('waist') : undefined,
          sex: read.has('sex') ? choice<BiologicalSex>(read, 'sex', SEXES) : undefined,
          age: read.has('age') ? read.number('age') : undefined
        }),
        isPhysiologyError
      )

    case 'body.metabolism':
      return settle(
        metabolicRate({
          weight: read.number('weight'),
          height: read.number('height'),
          age: read.number('age'),
          sex: choice<BiologicalSex>(read, 'sex', SEXES),
          activity: read.has('activity') ? choice<ActivityLevel>(read, 'activity', ACTIVITY_LEVELS) : undefined,
          leanBodyMass: read.has('leanBodyMass') ? read.number('leanBodyMass') : undefined
        }),
        isPhysiologyError
      )

    case 'body.activity-levels':
      return { ok: true, levels: ACTIVITY_LEVELS, notClinical: NOT_CLINICAL }

    case 'heart.output': {
      // A stroke volume or a cardiac output. Either one plus the rate gives the other, and neither is required.
      const routes = optionalGroup(read, ['strokeVolume', 'cardiacOutput', 'systolic', 'diastolic', 'surfaceArea', 'venousPressure'])
      return settle(circulation({ heartRate: read.number('heartRate'), ...routes }), isPhysiologyError)
    }

    case 'breathe.ventilation': {
      // A dead space or a body weight to estimate it from. Neither is required on its own.
      const routes = optionalGroup(read, ['deadSpace', 'weight', 'height', 'age'])
      return settle(
        ventilation({
          tidalVolume: read.number('tidalVolume'),
          respiratoryRate: read.number('respiratoryRate'),
          ...routes,
          sex: read.has('sex') ? choice<BiologicalSex>(read, 'sex', SEXES) : undefined
        }),
        isPhysiologyError
      )
    }

    case 'kidney.function':
      return settle(
        kidneyFunction({
          creatinine: read.number('creatinine'),
          age: read.number('age'),
          sex: choice<BiologicalSex>(read, 'sex', SEXES),
          weight: read.has('weight') ? read.number('weight') : undefined
        }),
        isPhysiologyError
      )

    case 'drug.kinetics': {
      // A half-life or an elimination constant. They are the same fact and neither is required on its own.
      const routes = optionalGroup(read, ['halfLife', 'eliminationConstant', 'volumeOfDistribution', 'dosingInterval', 'clearedThreshold'])
      return settle(pharmacokinetics({ ...routes }), isPhysiologyError)
    }

    // ---------------------------------------------------------------- populations
    case 'population.growth':
      return settle(
        populationGrowth({
          model: choice<GrowthModel>(read, 'model', GROWTH_MODELS),
          initialSize: read.number('initialSize'),
          growthRate: read.number('growthRate'),
          carryingCapacity: read.has('carryingCapacity') ? read.number('carryingCapacity') : undefined,
          duration: read.number('duration'),
          steps: read.has('steps') ? read.number('steps') : undefined
        }),
        isEcologyError
      )

    case 'population.models':
      return { ok: true, models: GROWTH_MODELS }

    case 'population.predator-prey':
      return settle(
        predatorPrey({
          prey: read.number('prey'),
          predator: read.number('predator'),
          preyGrowth: read.number('preyGrowth'),
          predationRate: read.number('predationRate'),
          predatorDeath: read.number('predatorDeath'),
          conversionRate: read.number('conversionRate'),
          preyCapacity: read.has('preyCapacity') ? read.number('preyCapacity') : undefined,
          duration: read.number('duration'),
          steps: read.has('steps') ? read.number('steps') : undefined
        }),
        isEcologyError
      )

    case 'population.mark-recapture':
      return settle(
        markRecapture({
          marked: read.number('marked'),
          recaptureSample: read.number('recaptureSample'),
          recapturedMarked: read.number('recapturedMarked')
        }),
        isEcologyError
      )

    case 'population.life-table':
      return settle(
        lifeTable({
          rows: read.list('rows', BIOLOGY_LIMITS.ageClasses).map((one) => {
            const entry = new Reader(one)
            return { age: entry.number('age'), survivors: entry.number('survivors'), fecundity: entry.number('fecundity') }
          })
        }),
        isEcologyError
      )

    case 'ecology.diversity':
      return settle(
        diversity({
          counts: read.list('counts', BIOLOGY_LIMITS.species).map((one) => {
            const entry = new Reader(one)
            return { name: entry.text('name', 128), count: entry.number('count') }
          })
        }),
        isEcologyError
      )

    case 'ecology.food-chain': {
      // One efficiency for every step, a list of them, or none at all — in which case the engine says out loud
      // that it fell back to the ten percent rule of thumb.
      const single = read.has('efficiency') ? read.number('efficiency') : undefined
      const many = read.has('efficiencies') ? read.numbers('efficiencies', BIOLOGY_LIMITS.efficiencies) : undefined
      return settle(
        foodChain({
          primaryProduction: read.number('primaryProduction'),
          levels: read.number('levels'),
          efficiency: many ?? single,
          names: read.has('names') ? read.strings('names', BIOLOGY_LIMITS.efficiencies) : undefined
        }),
        isEcologyError
      )
    }

    // ---------------------------------------------------------------- provenance
    case 'biology.assumptions':
      return {
        ok: true,
        genetics: GENETICS_ASSUMPTIONS,
        biochemistry: BIOCHEMISTRY_ASSUMPTIONS,
        physiology: PHYSIOLOGY_ASSUMPTIONS,
        ecology: ECOLOGY_ASSUMPTIONS
      }

    case 'biology.not-clinical':
      return { ok: true, statement: NOT_CLINICAL }

    default:
      throw new BadInput(`"${operation}" is not a biology operation.`)
  }
}
