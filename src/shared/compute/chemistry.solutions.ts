import { CHEMISTRY_ASSUMPTIONS, isChemistryError, parseFormula, type ChemistryError } from './chemistry.ts'

/**
 * Solutions, gases and the titration curve.
 *
 * ## What this adds to the chemistry engine
 *
 * `chemistry.ts` parses formulas, balances equations and converts moles. This is the rest of what a chemistry
 * calculator is asked for: concentration, pH, the ideal gas law, dilution, and the acid–base titration that every
 * school laboratory runs.
 *
 * ## The titration curve is computed, not drawn from memory
 *
 * The familiar S-shape comes out of the charge balance at each volume, not from a stored list of points. That means
 * a weak acid gives a different curve from a strong one because the arithmetic differs, the equivalence point lands
 * where the moles actually match, and the buffer region appears on its own rather than being annotated on. A curve
 * drawn from a picture would be the same shape whatever the acid, which is exactly the thing a student is supposed
 * to notice is false.
 *
 * ## What it refuses
 *
 * Activity coefficients, ionic strength and temperature dependence are not modelled: every constant here is at 25°C
 * and infinite dilution. Rather than quietly applying a 25°C constant to a question about hot solution, the reports
 * carry that assumption in words, every time.
 *
 * Pure. No clock, no randomness.
 */

/**
 * A refusal in the engine's own vocabulary.
 *
 * `ChemistryError` carries a reason and a sentence and no separate advice field, so the advice goes on the end of
 * the sentence. A refusal that does not say what to do instead is half a refusal.
 */
const fail = (error: ChemistryError['error'], message: string, fix: string): ChemistryError => ({ error, message: `${message} ${fix}` })

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

export const SOLUTION_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Every constant here is for 25°C and a dilute solution. Nothing corrects for temperature or ionic strength.',
  'Activity is taken as equal to concentration, which is the usual school approximation and is wrong in concentrated solution.',
  'Water self-ionisation is included, so a very dilute strong acid tends to pH 7 rather than past it.'
])

// ---------------------------------------------------------------- concentration

export interface MolarityReport {
  moles: number
  litres: number
  molarity: number
  says: string
  notes: readonly string[]
}

/** Concentration from amount and volume, or either from the other two. Exactly one may be left out. */
export function molarity(input: { moles?: number; litres?: number; molarity?: number }): MolarityReport | ChemistryError {
  const given = [input.moles, input.litres, input.molarity].filter((one) => finite(one)).length
  if (given < 2) return fail('invalid-argument', 'Two of the three are needed.', 'Give any two of: moles, litres, molarity.')
  if (finite(input.litres) && input.litres <= 0) return fail('invalid-argument', 'A volume has to be greater than zero.', 'Give a positive volume in litres.')

  let { moles, litres, molarity: c } = input as { moles?: number; litres?: number; molarity?: number }
  if (!finite(c)) c = (moles as number) / (litres as number)
  else if (!finite(moles)) moles = c * (litres as number)
  else litres = (moles as number) / c

  if (!finite(moles) || !finite(litres) || !finite(c) || (moles as number) < 0) {
    return fail('invalid-argument', 'Those numbers do not describe a solution.', 'Amounts and volumes are positive.')
  }
  return {
    moles: moles as number,
    litres: litres as number,
    molarity: c as number,
    says: `${(moles as number).toPrecision(4)} mol in ${(litres as number).toPrecision(4)} L is ${(c as number).toPrecision(4)} mol/L.`,
    notes: Object.freeze(['Molarity is moles per litre of solution, not per litre of solvent — the volume is measured after dissolving.'])
  }
}

export interface DilutionReport {
  c1: number
  v1: number
  c2: number
  v2: number
  added: number
  says: string
  notes: readonly string[]
}

/** C₁V₁ = C₂V₂, with whichever one is missing worked out. */
export function dilution(input: { c1?: number; v1?: number; c2?: number; v2?: number }): DilutionReport | ChemistryError {
  const values = [input.c1, input.v1, input.c2, input.v2]
  const given = values.filter((one) => finite(one)).length
  if (given !== 3) return fail('invalid-argument', 'Exactly three of the four are needed.', 'Give three of: first concentration, first volume, second concentration, second volume.')
  for (const one of values) if (finite(one) && one < 0) return fail('invalid-argument', 'None of these can be negative.', 'Use positive concentrations and volumes.')

  let { c1, v1, c2, v2 } = input as { c1?: number; v1?: number; c2?: number; v2?: number }
  if (!finite(c1)) c1 = ((c2 as number) * (v2 as number)) / (v1 as number)
  else if (!finite(v1)) v1 = ((c2 as number) * (v2 as number)) / (c1 as number)
  else if (!finite(c2)) c2 = ((c1 as number) * (v1 as number)) / (v2 as number)
  else v2 = ((c1 as number) * (v1 as number)) / (c2 as number)

  if (![c1, v1, c2, v2].every((one) => finite(one) && (one as number) >= 0)) {
    return fail('invalid-argument', 'That does not describe a dilution.', 'A dilution lowers the concentration and raises the volume.')
  }
  const added = (v2 as number) - (v1 as number)
  return {
    c1: c1 as number,
    v1: v1 as number,
    c2: c2 as number,
    v2: v2 as number,
    added,
    says:
      added >= 0
        ? `Take ${(v1 as number).toPrecision(4)} L at ${(c1 as number).toPrecision(4)} mol/L and make it up to ${(v2 as number).toPrecision(4)} L — add ${added.toPrecision(4)} L of solvent — for ${(c2 as number).toPrecision(4)} mol/L.`
        : `That is a concentration, not a dilution: the volume falls by ${Math.abs(added).toPrecision(4)} L.`,
    notes: Object.freeze([
      'The amount of solute does not change, which is the whole of why C₁V₁ = C₂V₂.',
      'Volumes are not always additive — mixing ethanol and water gives less than the sum — so "make up to" is not the same as "add".'
    ])
  }
}

// ---------------------------------------------------------------- acids and bases

export interface PhReport {
  ph: number
  poh: number
  hydrogen: number
  hydroxide: number
  kind: 'acidic' | 'neutral' | 'basic'
  says: string
  notes: readonly string[]
}

const KW = 1e-14

/**
 * pH from a concentration, for a strong or a weak acid or base.
 *
 * A weak acid is solved from its Kₐ by the quadratic rather than the usual √(Kₐ·C) shortcut, because the shortcut
 * fails exactly where a student is most likely to try it — dilute solution, where the amount dissociated is no
 * longer small against the amount present.
 */
export function ph(input: {
  concentration: number
  kind: 'strong-acid' | 'weak-acid' | 'strong-base' | 'weak-base'
  /** The acid or base constant, for the weak cases. */
  k?: number
}): PhReport | ChemistryError {
  const c = input.concentration
  if (!finite(c) || c <= 0) return fail('invalid-argument', 'A concentration has to be greater than zero.', 'Give a positive concentration in mol/L.')
  if (c > 20) return fail('invalid-argument', `${c} mol/L is past anything this models.`, 'Keep below about 20 mol/L; above that the dilute approximations fail entirely.')

  let hydrogen: number
  const notes: string[] = []

  if (input.kind === 'strong-acid') {
    // Water's own contribution matters below about 1e-6, so it is solved rather than ignored.
    hydrogen = (c + Math.sqrt(c * c + 4 * KW)) / 2
    if (c < 1e-6) notes.push('At this dilution the water itself supplies a comparable amount, so the pH is not simply −log(C).')
  } else if (input.kind === 'strong-base') {
    const hydroxide = (c + Math.sqrt(c * c + 4 * KW)) / 2
    hydrogen = KW / hydroxide
    if (c < 1e-6) notes.push('At this dilution the water itself supplies a comparable amount, so the pOH is not simply −log(C).')
  } else {
    const k = input.k
    if (!finite(k) || k <= 0) {
      return fail('invalid-argument', 'A weak acid or base needs its constant.', 'Give Ka for a weak acid or Kb for a weak base — acetic acid is 1.8e-5.')
    }
    // x² + Kx − KC = 0, solved rather than approximated.
    const x = (-k + Math.sqrt(k * k + 4 * k * c)) / 2
    hydrogen = input.kind === 'weak-acid' ? x : KW / x
    const fraction = x / c
    notes.push(`${(fraction * 100).toPrecision(3)}% of it is dissociated at this concentration.`)
    if (fraction > 0.05) notes.push('More than 5% dissociates, so the usual √(K·C) shortcut would be noticeably wrong here. This solved the quadratic instead.')
  }

  const hydroxide = KW / hydrogen
  const value = -Math.log10(hydrogen)
  return {
    ph: value,
    poh: 14 - value,
    hydrogen,
    hydroxide,
    kind: value < 6.999 ? 'acidic' : value > 7.001 ? 'basic' : 'neutral',
    says: `pH ${value.toFixed(2)} — [H⁺] = ${hydrogen.toExponential(3)} mol/L, [OH⁻] = ${hydroxide.toExponential(3)} mol/L.`,
    notes: Object.freeze([...notes, 'pH + pOH = 14 only at 25°C, because Kw changes with temperature.'])
  }
}

// ---------------------------------------------------------------- gases

export interface GasReport {
  pressure: number
  volume: number
  moles: number
  temperature: number
  says: string
  notes: readonly string[]
}

export const GAS_CONSTANT = 8.314462618

/** PV = nRT, with whichever one is missing worked out. Pressure in Pa, volume in m³, temperature in K. */
export function idealGas(input: { pressure?: number; volume?: number; moles?: number; temperature?: number }): GasReport | ChemistryError {
  const given = [input.pressure, input.volume, input.moles, input.temperature].filter((one) => finite(one)).length
  if (given !== 3) return fail('invalid-argument', 'Exactly three of the four are needed.', 'Give three of: pressure (Pa), volume (m³), amount (mol), temperature (K).')
  if (finite(input.temperature) && input.temperature <= 0) {
    return fail('invalid-argument', 'Temperature in the gas law is absolute, so it has to be above zero kelvin.', 'Give the temperature in kelvin — 25°C is 298.15 K.')
  }
  for (const [name, one] of [['pressure', input.pressure], ['volume', input.volume], ['moles', input.moles]] as const) {
    if (finite(one) && one <= 0) return fail('invalid-argument', `The ${name} has to be greater than zero.`, 'Give positive values.')
  }

  let { pressure, volume, moles, temperature } = input as { pressure?: number; volume?: number; moles?: number; temperature?: number }
  if (!finite(pressure)) pressure = ((moles as number) * GAS_CONSTANT * (temperature as number)) / (volume as number)
  else if (!finite(volume)) volume = ((moles as number) * GAS_CONSTANT * (temperature as number)) / (pressure as number)
  else if (!finite(moles)) moles = ((pressure as number) * (volume as number)) / (GAS_CONSTANT * (temperature as number))
  else temperature = ((pressure as number) * (volume as number)) / ((moles as number) * GAS_CONSTANT)

  const litres = (volume as number) * 1000
  const atmospheres = (pressure as number) / 101325
  return {
    pressure: pressure as number,
    volume: volume as number,
    moles: moles as number,
    temperature: temperature as number,
    says: `${(moles as number).toPrecision(4)} mol at ${(temperature as number).toPrecision(5)} K fills ${litres.toPrecision(4)} L at ${atmospheres.toPrecision(4)} atm.`,
    notes: Object.freeze([
      'The ideal gas law assumes the molecules have no volume of their own and do not attract each other. Both fail at high pressure and low temperature.',
      `R = ${GAS_CONSTANT} J/(mol·K), which is exact: the kelvin and the mole are defined from fixed constants.`
    ])
  }
}

// ---------------------------------------------------------------- what a compound is made of

export interface CompositionReport {
  formula: string
  molarMass: number
  parts: readonly { symbol: string; name: string; count: number; mass: number; percent: number }[]
  says: string
  notes: readonly string[]
}

/** Percentage composition by mass, from a formula. */
export function percentComposition(formula: string): CompositionReport | ChemistryError {
  const parsed = parseFormula(formula)
  if (isChemistryError(parsed)) return parsed
  const parts = parsed.composition.map((one) => ({
    symbol: one.symbol,
    name: one.name,
    count: one.count,
    mass: one.massContribution,
    percent: one.massPercent
  }))
  const heaviest = [...parts].sort((a, b) => b.percent - a.percent)[0]
  return {
    formula: parsed.formula,
    molarMass: parsed.molarMass,
    parts: Object.freeze(parts),
    says: heaviest
      ? `${parsed.formula} weighs ${parsed.molarMass.toFixed(3)} g/mol and is ${heaviest.percent.toFixed(2)}% ${heaviest.name.toLowerCase()} by mass.`
      : `${parsed.formula} weighs ${parsed.molarMass.toFixed(3)} g/mol.`,
    notes: Object.freeze([
      'By mass, not by number of atoms — water is two thirds hydrogen by count and 11% hydrogen by mass.',
      ...CHEMISTRY_ASSUMPTIONS.slice(0, 1)
    ])
  }
}

// ---------------------------------------------------------------- the titration

export interface TitrationPoint {
  added: number
  ph: number
  region: 'start' | 'buffer' | 'equivalence' | 'excess'
}

export interface TitrationReport {
  curve: readonly TitrationPoint[]
  equivalenceAt: number
  equivalencePh: number
  /** The pH at half the equivalence volume. For a weak acid this is pKa, which is the point of the measurement. */
  halfEquivalencePh: number
  indicator: { name: string; range: string; suits: boolean; why: string }
  says: string
  notes: readonly string[]
}

/**
 * An acid–base titration, point by point.
 *
 * Strong acid with strong base is solved from the leftover moles; a weak acid is solved from its Kₐ through the
 * buffer region and from hydrolysis of its conjugate at the equivalence point — which is why a weak acid's
 * equivalence pH is above 7 and a strong acid's is exactly 7. Nothing in here looks that up; it falls out.
 */
export function titration(input: {
  acidMolarity: number
  acidVolume: number
  baseMolarity: number
  /** Leave out for a strong acid. */
  ka?: number
  /** How many points to compute across the run. */
  points?: number
}): TitrationReport | ChemistryError {
  const { acidMolarity, acidVolume, baseMolarity } = input
  if (![acidMolarity, acidVolume, baseMolarity].every((one) => finite(one) && one > 0)) {
    return fail('invalid-argument', 'The concentrations and the volume all have to be greater than zero.', 'Give the acid concentration, the acid volume in mL, and the base concentration.')
  }
  const steps = Math.max(10, Math.min(400, Math.floor(input.points ?? 120)))
  const acidMoles = acidMolarity * (acidVolume / 1000)
  const equivalenceAt = (acidMoles / baseMolarity) * 1000
  const weak = finite(input.ka) && (input.ka as number) > 0
  const ka = weak ? (input.ka as number) : 0

  const phAt = (addedMl: number): { ph: number; region: TitrationPoint['region'] } => {
    const baseMoles = baseMolarity * (addedMl / 1000)
    const litres = (acidVolume + addedMl) / 1000
    const left = acidMoles - baseMoles

    if (Math.abs(left) < acidMoles * 1e-9) {
      // At equivalence: a strong acid leaves water, a weak one leaves its conjugate base, which hydrolyses.
      if (!weak) return { ph: 7, region: 'equivalence' }
      const conjugate = acidMoles / litres
      const kb = KW / ka
      const hydroxide = Math.sqrt(kb * conjugate)
      return { ph: 14 + Math.log10(hydroxide), region: 'equivalence' }
    }
    if (left > 0) {
      if (!weak) return { ph: -Math.log10(left / litres), region: addedMl === 0 ? 'start' : 'buffer' }
      if (baseMoles === 0) {
        const x = (-ka + Math.sqrt(ka * ka + 4 * ka * (acidMoles / litres))) / 2
        return { ph: -Math.log10(x), region: 'start' }
      }
      // Henderson–Hasselbalch through the buffer region, which is where it is actually valid.
      return { ph: -Math.log10(ka) + Math.log10(baseMoles / left), region: 'buffer' }
    }
    const excess = -left / litres
    const hydroxide = (excess + Math.sqrt(excess * excess + 4 * KW)) / 2
    return { ph: 14 + Math.log10(hydroxide), region: 'excess' }
  }

  const end = equivalenceAt * 2
  const curve: TitrationPoint[] = []
  for (let at = 0; at <= steps; at += 1) {
    const added = (end * at) / steps
    const { ph: value, region } = phAt(added)
    curve.push({ added, ph: Math.max(0, Math.min(14, value)), region })
  }
  // The equivalence point itself, inserted exactly rather than hoped for in the sampling.
  const atEquivalence = phAt(equivalenceAt)
  curve.push({ added: equivalenceAt, ph: Math.max(0, Math.min(14, atEquivalence.ph)), region: 'equivalence' })
  curve.sort((a, b) => a.added - b.added)

  const half = phAt(equivalenceAt / 2)
  const equivalencePh = atEquivalence.ph
  const indicator =
    equivalencePh > 8
      ? { name: 'Phenolphthalein', range: '8.3 – 10.0', suits: true, why: 'Its range straddles this equivalence pH, so the colour changes within a drop of the end point.' }
      : equivalencePh < 6
        ? { name: 'Methyl orange', range: '3.1 – 4.4', suits: true, why: 'Its range straddles this equivalence pH.' }
        : { name: 'Bromothymol blue', range: '6.0 – 7.6', suits: true, why: 'Its range straddles neutral, which is where a strong acid and a strong base meet.' }

  return {
    curve: Object.freeze(curve),
    equivalenceAt,
    equivalencePh,
    halfEquivalencePh: half.ph,
    indicator,
    says: `Equivalence at ${equivalenceAt.toFixed(2)} mL, pH ${equivalencePh.toFixed(2)}.${weak ? ` Half way there the pH is ${half.ph.toFixed(2)}, which is the pKa.` : ''}`,
    notes: Object.freeze([
      weak
        ? 'A weak acid ends above pH 7, because what is left at equivalence is its conjugate base and that base takes a proton back from water.'
        : 'A strong acid and a strong base meet at exactly pH 7, because what is left at equivalence is water and a spectator salt.',
      'The steep part is one or two drops wide in a real titration, which is why the indicator has to change inside it.',
      ...SOLUTION_ASSUMPTIONS
    ])
  }
}

// ---------------------------------------------------------------- flame tests

export interface FlameTest {
  symbol: string
  ion: string
  colour: string
  /** Roughly, the wavelength the eye reads it as. Nanometres. */
  wavelength: number | null
  says: string
}

/**
 * What the common metal ions colour a flame.
 *
 * The colour comes from an electron falling back after the flame excites it, and the wavelength is the line that
 * dominates. Where a colour is a mixture of lines with no single dominant one, the wavelength is null rather than
 * an average that corresponds to nothing.
 */
export const FLAME_TESTS: readonly FlameTest[] = Object.freeze([
  { symbol: 'Li', ion: 'Li⁺', colour: 'crimson', wavelength: 671, says: 'The 671 nm line is the one lithium is identified by.' },
  { symbol: 'Na', ion: 'Na⁺', colour: 'intense yellow', wavelength: 589, says: 'The sodium D lines at 589 nm. So intense that a trace of sodium masks everything else, which is why the wire is cleaned in acid first.' },
  { symbol: 'K', ion: 'K⁺', colour: 'lilac', wavelength: 766, says: 'Easily hidden by sodium — it is usually viewed through cobalt-blue glass, which absorbs the yellow.' },
  { symbol: 'Ca', ion: 'Ca²⁺', colour: 'orange-red', wavelength: 622, says: 'Brick red, from a band rather than a single sharp line.' },
  { symbol: 'Sr', ion: 'Sr²⁺', colour: 'scarlet', wavelength: 606, says: 'The red in a firework.' },
  { symbol: 'Ba', ion: 'Ba²⁺', colour: 'apple green', wavelength: 524, says: 'Pale green, and easy to confuse with copper if the flame is dirty.' },
  { symbol: 'Cu', ion: 'Cu²⁺', colour: 'blue-green', wavelength: 525, says: 'A bluer green than barium. A copper halide gives a stronger blue still.' },
  { symbol: 'Rb', ion: 'Rb⁺', colour: 'red-violet', wavelength: 780, says: 'Named for this colour — rubidus is Latin for deep red.' },
  { symbol: 'Cs', ion: 'Cs⁺', colour: 'blue-violet', wavelength: 455, says: 'Named for this colour too — caesius is sky blue.' },
  { symbol: 'Pb', ion: 'Pb²⁺', colour: 'pale blue-white', wavelength: null, says: 'A weak, washed-out colour with no single dominant line.' }
])

export const flameTestFor = (symbol: string): FlameTest | null => FLAME_TESTS.find((one) => one.symbol === symbol) ?? null
