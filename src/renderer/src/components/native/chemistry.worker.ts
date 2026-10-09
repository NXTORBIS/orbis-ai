import {
  ELEMENTS,
  balanceEquation,
  elementBy,
  isChemistryError,
  moleConversion,
  parseFormula,
  stoichiometry,
  ATOMIC_WEIGHT_SOURCE,
  CHEMISTRY_ASSUMPTIONS
} from '../../../../shared/compute/chemistry.ts'
import { ALL_ELEMENTS, CATEGORIES, placeOf } from '../../../../shared/compute/chemistry.table.ts'
import {
  dilution,
  flameTestFor,
  idealGas,
  molarity,
  percentComposition,
  ph,
  titration,
  FLAME_TESTS,
  SOLUTION_ASSUMPTIONS
} from '../../../../shared/compute/chemistry.solutions.ts'
import {
  arrhenius,
  cellPotential,
  electrolysis,
  equilibrium,
  rateLaw,
  thermochemistry
} from '../../../../shared/compute/reactions.ts'
import {
  FUNCTIONAL_GROUPS,
  NAMEABLE,
  NAMING_RULES,
  homologousSeries,
  nameChain,
  type GroupId
} from '../../../../shared/compute/chemistry.organic.ts'
import { KNOWN_COMPOUNDS, combine } from '../../../../shared/compute/chemistry.compounds.ts'

/**
 * The chemistry engines, on their own thread.
 *
 * ## Why a worker at all
 *
 * A titration curve is four hundred solved equilibria, a decay chain is a numerical integration, and a periodic
 * table filtered and re-sorted on every keystroke is a hundred and eighteen objects walked repeatedly. None of that
 * is slow enough to matter once; all of it is slow enough to matter while somebody drags a slider. The chemistry
 * laboratories share one worker for the same reason the systems ones do: no card uses two of these at once.
 *
 * ## Nothing here computes
 *
 * Every number comes from `chemistry.ts`, `chemistry.solutions.ts` or `reactions.ts`. This file routes a request to
 * the right function and posts back what it returned, including its refusals. A worker that did arithmetic of its
 * own would be a second implementation nobody tests.
 */

export type WorkerRequest =
  | { kind: 'table'; generation: number; search: string; category: string | null }
  | { kind: 'element'; generation: number; key: string | number }
  | {
      kind: 'calculator'
      generation: number
      what: 'molar-mass' | 'moles' | 'molarity' | 'ph' | 'gas' | 'dilution' | 'composition'
      formula: string
      grams: number
      moles: number
      litres: number
      concentration: number
      acidKind: 'strong-acid' | 'weak-acid' | 'strong-base' | 'weak-base'
      k: number
      pressure: number
      volume: number
      temperature: number
      c1: number
      v1: number
      c2: number
    }
  | {
      kind: 'reaction'
      generation: number
      what: 'balance' | 'energy' | 'equilibrium' | 'rate' | 'arrhenius'
      /** `A + B -> C + D`, as somebody writes it. Split here; the engine takes two lists. */
      equation: string
      /**
       * The species with their formation enthalpies, one per line: `formula, ΔHf kJ/mol, S J/(mol·K)`.
       *
       * The engine takes measured formation values rather than a single ΔH for the reaction, because that is what a
       * data book gives and what makes Hess's law work. The lab's own defaults come from the same tables.
       */
      reactants: string
      products: string
      temperature: number
      /** For the equilibrium tab. */
      constant: number
      /** For the rate-law tab. */
      order: number
      rateConstant: number
      initialConcentration: number
      duration: number
      /** For the Arrhenius tab. */
      activationEnergy: number
      preExponential: number
    }
  | {
      kind: 'electro'
      generation: number
      what: 'cell' | 'nernst' | 'electrolysis'
      /** Half-cell ids from `HALF_CELLS`, so the potentials are tabulated rather than typed. */
      cathode: string
      anode: string
      electrons: number
      reactionQuotient: number
      temperature: number
      current: number
      seconds: number
      molarMass: number
    }
  | {
      kind: 'organic'
      generation: number
      /** The family being looked at. */
      group: string
      carbons: number
      position: number
      /** How many members of the series to build. */
      upTo: number
    }
  | {
      kind: 'combine'
      generation: number
      /** Element symbols, comma- or space-separated as somebody types them. */
      elements: string
    }
  | {
      kind: 'molecular'
      generation: number
      formula: string
    }
  | {
      kind: 'titration'
      generation: number
      acidMolarity: number
      acidVolume: number
      baseMolarity: number
      weak: boolean
      ka: number
      flameFor: string
    }

export type WorkerReply =
  | { kind: 'refused'; generation: number; says: string; fix: string }
  | { kind: 'broke'; generation: number; says: string }
  | {
      kind: 'table'
      generation: number
      elements: readonly (Record<string, unknown> & { column: number; row: number })[]
      categories: readonly string[]
      total: number
      shown: number
      source: string
      assumptions: readonly string[]
    }
  | { kind: 'element'; generation: number; element: unknown; place: { column: number; row: number }; flame: unknown; assumptions: readonly string[] }
  | { kind: 'calculator'; generation: number; what: string; report: unknown; assumptions: readonly string[] }
  | { kind: 'reaction'; generation: number; what: string; report: unknown; series: readonly { x: number; y: number }[]; assumptions: readonly string[] }
  | { kind: 'electro'; generation: number; what: string; report: unknown; assumptions: readonly string[] }
  | { kind: 'titration'; generation: number; report: unknown; flame: unknown; flames: readonly unknown[]; assumptions: readonly string[] }
  | {
      kind: 'organic'
      generation: number
      groups: readonly unknown[]
      rules: readonly unknown[]
      nameable: readonly string[]
      named: unknown
      series: readonly unknown[]
      assumptions: readonly string[]
    }
  | { kind: 'combine'; generation: number; report: unknown; assumptions: readonly string[] }
  | {
      kind: 'molecular'
      generation: number
      report: unknown
      /** The gallery: a formula a person can click, with its weight already worked out. */
      gallery: readonly { formula: string; name: string; molarMass: number; atoms: number; bond: string }[]
      assumptions: readonly string[]
    }

/**
 * Standard reduction potentials at 25°C, the handful a school laboratory uses.
 *
 * Tabulated values, not computed ones — a reduction potential is a measurement against the standard hydrogen
 * electrode, which is defined as exactly zero. The cell is built from two of these, which is the whole method.
 */
export const HALF_CELLS: readonly { id: string; label: string; potential: number; electrons: number }[] = Object.freeze([
  { id: 'li', label: 'Li⁺ + e⁻ → Li', potential: -3.04, electrons: 1 },
  { id: 'zn', label: 'Zn²⁺ + 2e⁻ → Zn', potential: -0.76, electrons: 2 },
  { id: 'fe', label: 'Fe²⁺ + 2e⁻ → Fe', potential: -0.44, electrons: 2 },
  { id: 'ni', label: 'Ni²⁺ + 2e⁻ → Ni', potential: -0.25, electrons: 2 },
  { id: 'pb', label: 'Pb²⁺ + 2e⁻ → Pb', potential: -0.13, electrons: 2 },
  { id: 'h', label: '2H⁺ + 2e⁻ → H₂', potential: 0, electrons: 2 },
  { id: 'cu', label: 'Cu²⁺ + 2e⁻ → Cu', potential: 0.34, electrons: 2 },
  { id: 'ag', label: 'Ag⁺ + e⁻ → Ag', potential: 0.8, electrons: 1 },
  { id: 'cl', label: 'Cl₂ + 2e⁻ → 2Cl⁻', potential: 1.36, electrons: 2 },
  { id: 'f', label: 'F₂ + 2e⁻ → 2F⁻', potential: 2.87, electrons: 2 }
])

const halfCell = (id: string): { id: string; label: string; potential: number; electrons: number } =>
  HALF_CELLS.find((one) => one.id === id) ?? HALF_CELLS[6]

/** `formula, ΔHf, S` per line. A line that is not three numbers-and-a-formula is skipped rather than guessed at. */
function readSpecies(text: string): { formula: string; coefficient?: number; formationEnthalpy: number; entropy?: number }[] {
  const out: { formula: string; coefficient?: number; formationEnthalpy: number; entropy?: number }[] = []
  for (const line of text.split(/[\n;]+/)) {
    const parts = line.split(',').map((one) => one.trim())
    if (parts.length < 2 || parts[0] === '') continue
    const enthalpy = Number(parts[1])
    if (!Number.isFinite(enthalpy)) continue
    const entropy = Number(parts[2])
    const coefficient = Number(parts[3])
    out.push({
      formula: parts[0],
      formationEnthalpy: enthalpy,
      ...(Number.isFinite(entropy) ? { entropy } : {}),
      ...(Number.isFinite(coefficient) && coefficient > 0 ? { coefficient } : {})
    })
  }
  return out
}

/** `2H2 + O2 -> 2H2O` into its two sides. */
function readEquation(text: string): { reactants: string[]; products: string[] } {
  const [left, right] = text.split(/->|→|=/)
  const split = (part: string): string[] =>
    (part ?? '')
      .split('+')
      .map((one) => one.trim())
      .filter(Boolean)
  return { reactants: split(left), products: split(right) }
}

const send = (reply: WorkerReply): void => {
  ;(self as unknown as { postMessage(value: unknown): void }).postMessage(reply)
}

self.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  const message = event.data
  const generation = message.generation

  /** A refusal from any chemistry engine, passed on in its own words. */
  const refuse = (value: unknown): boolean => {
    if (!isChemistryError(value)) return false
    send({ kind: 'refused', generation, says: value.message, fix: '' })
    return true
  }
  /** The refusal shape the other engines use, which carries its own fix. */
  const refuseSaid = (value: unknown): boolean => {
    if (typeof value !== 'object' || value === null) return false
    const held = value as { error?: unknown; says?: unknown; fix?: unknown; message?: unknown }
    if (held.error === undefined) return false
    send({
      kind: 'refused',
      generation,
      says: String(held.says ?? held.message ?? 'That could not be worked out.'),
      fix: String(held.fix ?? '')
    })
    return true
  }

  try {
    switch (message.kind) {
      case 'table': {
        const wanted = message.search.trim().toLowerCase()
        const shown = ALL_ELEMENTS.filter((one) => {
          if (message.category !== null && one.category !== message.category) return false
          if (wanted === '') return true
          return (
            one.name.toLowerCase().includes(wanted) ||
            one.symbol.toLowerCase() === wanted ||
            String(one.number) === wanted ||
            one.category.includes(wanted)
          )
        })
        send({
          kind: 'table',
          generation,
          // The place is worked out here so the screen never has to know about lanthanide rows.
          elements: shown.map((one) => ({ ...one, ...placeOf(one.number) })),
          categories: CATEGORIES,
          total: ALL_ELEMENTS.length,
          shown: shown.length,
          source: ATOMIC_WEIGHT_SOURCE,
          assumptions: CHEMISTRY_ASSUMPTIONS
        })
        return
      }

      case 'element': {
        const found = elementBy(message.key)
        if (refuse(found)) return
        const one = found as { number: number; symbol: string }
        send({
          kind: 'element',
          generation,
          element: one,
          place: placeOf(one.number),
          flame: flameTestFor(one.symbol),
          assumptions: CHEMISTRY_ASSUMPTIONS
        })
        return
      }

      case 'calculator': {
        let report: unknown
        switch (message.what) {
          case 'molar-mass':
            report = parseFormula(message.formula)
            break
          case 'composition':
            report = percentComposition(message.formula)
            break
          case 'moles':
            report = moleConversion({ formula: message.formula, grams: message.grams > 0 ? message.grams : undefined, moles: message.grams > 0 ? undefined : message.moles })
            break
          case 'molarity':
            report = molarity({ moles: message.moles, litres: message.litres })
            break
          case 'ph':
            report = ph({ concentration: message.concentration, kind: message.acidKind, k: message.k })
            break
          case 'gas':
            report = idealGas({ pressure: message.pressure, volume: message.volume, temperature: message.temperature })
            break
          case 'dilution':
            report = dilution({ c1: message.c1, v1: message.v1, c2: message.c2 })
            break
          default:
            report = null
        }
        if (refuse(report)) return
        send({
          kind: 'calculator',
          generation,
          what: message.what,
          report,
          assumptions: message.what === 'ph' || message.what === 'gas' || message.what === 'dilution' ? SOLUTION_ASSUMPTIONS : CHEMISTRY_ASSUMPTIONS
        })
        return
      }

      case 'reaction': {
        let report: unknown
        const series: { x: number; y: number }[] = []
        switch (message.what) {
          case 'balance': {
            const sides = readEquation(message.equation)
            report = balanceEquation({ reactants: sides.reactants, products: sides.products })
            break
          }
          case 'energy': {
            const reactants = readSpecies(message.reactants)
            const products = readSpecies(message.products)
            report = thermochemistry({ reactants, products, temperature: message.temperature })
            /*
             * ΔG against temperature, so the crossover is visible rather than only stated.
             *
             * Computed from the same ΔH and ΔS the engine just reported, so the line and the number under it cannot
             * disagree. ΔS arrives in J/(mol·K) and ΔH in kJ/mol, which is the units trap in this whole topic.
             */
            const held = report as { enthalpy?: number; entropy?: number }
            if (typeof held.enthalpy === 'number' && typeof held.entropy === 'number') {
              for (let t = 200; t <= 800; t += 10) series.push({ x: t, y: held.enthalpy - (t * held.entropy) / 1000 })
            }
            break
          }
          case 'equilibrium': {
            const reactants = readSpecies(message.reactants).map((one) => ({ formula: one.formula, coefficient: one.coefficient, initial: 1 }))
            const products = readSpecies(message.products).map((one) => ({ formula: one.formula, coefficient: one.coefficient, initial: 0 }))
            report = equilibrium({ constant: message.constant, reactants, products })
            break
          }
          case 'rate': {
            report = rateLaw({
              order: message.order,
              rateConstant: message.rateConstant,
              initialConcentration: message.initialConcentration,
              duration: message.duration
            })
            const k = message.rateConstant
            const a0 = message.initialConcentration
            for (let at = 0; at <= 60; at += 1) {
              const t = (message.duration * at) / 60
              const value = message.order === 0 ? Math.max(0, a0 - k * t) : message.order === 1 ? a0 * Math.exp(-k * t) : a0 / (1 + k * a0 * t)
              series.push({ x: t, y: value })
            }
            break
          }
          case 'arrhenius': {
            report = arrhenius({
              activationEnergy: message.activationEnergy,
              preExponential: message.preExponential,
              temperature: message.temperature
            })
            // ln k against 1000/T: a straight line whose slope is −Ea/R, which is the whole point of the plot.
            const from = Math.max(200, message.temperature - 150)
            const to = message.temperature + 150
            for (let at = 0; at <= 60; at += 1) {
              const t = from + ((to - from) * at) / 60
              series.push({ x: 1000 / t, y: Math.log(message.preExponential) - (message.activationEnergy * 1000) / (8.314462618 * t) })
            }
            break
          }
          default:
            report = null
        }
        if (refuse(report) || refuseSaid(report)) return
        send({ kind: 'reaction', generation, what: message.what, report, series: Object.freeze(series), assumptions: CHEMISTRY_ASSUMPTIONS })
        return
      }

      case 'electro': {
        let report: unknown
        if (message.what === 'electrolysis') {
          report = electrolysis({
            current: message.current,
            time: message.seconds,
            electrons: Math.max(1, Math.round(message.electrons)),
            molarMass: message.molarMass
          })
        } else {
          const cathode = halfCell(message.cathode)
          const anode = halfCell(message.anode)
          report = cellPotential({
            cathodePotential: cathode.potential,
            anodePotential: anode.potential,
            electrons: Math.max(1, Math.round(message.electrons)),
            ...(message.what === 'nernst' ? { reactionQuotient: message.reactionQuotient, temperature: message.temperature } : {})
          })
          if (typeof report === 'object' && report !== null && !('error' in (report as Record<string, unknown>))) {
            // The half-cells themselves travel with the answer, so the screen names the electrodes it was given.
            report = { ...(report as Record<string, unknown>), cathode, anode }
          }
        }
        if (refuse(report) || refuseSaid(report)) return
        send({ kind: 'electro', generation, what: message.what, report, assumptions: CHEMISTRY_ASSUMPTIONS })
        return
      }

      // ------------------------------------------------ organic chemistry
      case 'organic': {
        const group = (message.group ?? 'alkane') as GroupId
        /*
         * A refusal from the namer is not a refusal of the request.
         *
         * Asking for an aromatic shows the family — its reactions, its tests, why it substitutes rather than adds —
         * and simply has no IUPAC name built from a chain length. So the named part comes back as the refusal's own
         * words and the panel of fourteen families is sent regardless, because that is what was asked for.
         */
        const named = nameChain({ carbons: message.carbons, group, position: message.position })
        const series = homologousSeries(group, message.upTo)
        send({
          kind: 'organic',
          generation,
          groups: FUNCTIONAL_GROUPS,
          rules: NAMING_RULES,
          nameable: NAMEABLE,
          named: isChemistryError(named) ? { refused: named.message } : named,
          series: isChemistryError(series) ? [] : series,
          assumptions: CHEMISTRY_ASSUMPTIONS
        })
        return
      }

      case 'combine': {
        const symbols = String(message.elements ?? '')
          .split(/[,\s;]+/)
          .map((one) => one.trim())
          .filter(Boolean)
        const report = combine(symbols)
        if (refuse(report)) return
        send({ kind: 'combine', generation, report, assumptions: CHEMISTRY_ASSUMPTIONS })
        return
      }

      case 'molecular': {
        const report = parseFormula(message.formula)
        if (isChemistryError(report)) {
          refuse(report)
          return
        }
        const composition = percentComposition(message.formula)
        /*
         * The gallery is weighed, not listed.
         *
         * Every row's molar mass comes from parsing its formula with the same parser the main answer uses, so a
         * gallery row and a typed formula can never disagree — and a formula that fails to parse is left out
         * rather than shown with a blank weight.
         */
        const gallery = KNOWN_COMPOUNDS.flatMap((one) => {
          const parsed = parseFormula(one.formula)
          if (isChemistryError(parsed)) return []
          return [{ formula: one.formula, name: one.name, molarMass: parsed.molarMass, atoms: parsed.totalAtoms, bond: String(one.bond) }]
        })
        send({
          kind: 'molecular',
          generation,
          report: { ...report, composition: isChemistryError(composition) ? report.composition : composition.parts },
          gallery: Object.freeze(gallery),
          assumptions: CHEMISTRY_ASSUMPTIONS
        })
        return
      }

      case 'titration': {
        const report = titration({
          acidMolarity: message.acidMolarity,
          acidVolume: message.acidVolume,
          baseMolarity: message.baseMolarity,
          ...(message.weak ? { ka: message.ka } : {})
        })
        if (refuse(report)) return
        send({
          kind: 'titration',
          generation,
          report,
          flame: flameTestFor(message.flameFor),
          flames: FLAME_TESTS,
          assumptions: SOLUTION_ASSUMPTIONS
        })
        return
      }

      default:
        return
    }
  } catch (error) {
    send({
      kind: 'broke',
      generation,
      says: `The chemistry engine stopped: ${error instanceof Error ? error.message : String(error)}`
    })
  }
}

// Referenced so the import is not trimmed: the element list is what the table is built from.
void ELEMENTS
void stoichiometry
