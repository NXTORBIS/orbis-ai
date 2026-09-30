/**
 * Solutions: concentration, acids and bases, buffers, titration and solubility.
 *
 * The shared solution-chemistry engine for Orbis Pages. pH comes from solving the equilibrium rather than from the
 * shortcut formula, buffers report the range over which they actually buffer, and a concentration conversion that
 * needs a density says so instead of assuming water.
 *
 * ## Why pH is solved rather than approximated
 *
 * pH = -log C works for a strong acid above about 10⁻⁶ M and is wrong below that, because water's own ionisation
 * starts to matter — it gives pH 8 for a 10⁻⁸ M solution of hydrochloric acid, which is an acid coming out alkaline.
 * The charge-balance equation is solved instead, which is right everywhere and costs nothing.
 *
 * ## Why a buffer reports its range
 *
 * Henderson-Hasselbalch is accurate within about one pH unit of the pKa and drifts outside that, badly beyond two.
 * A buffer asked to hold pH 4 with a pKa of 7 is not a buffer; the equation will still return a ratio, and it will
 * be a ratio of 1000 to 1 that has no buffering capacity at all. The capacity is reported so that is visible.
 *
 * ## The distinctions this file refuses to blur
 *
 * ```
 * molarity      vs  molality        -- per litre of solution against per kilogram of solvent
 * concentration vs  activity        -- how much is there against how much acts like it is there
 * strong        vs  concentrated    -- fully dissociating against a lot of it
 * pH            vs  acidity         -- a number against how much base it takes to neutralise
 * equivalence   vs  neutral         -- where the moles match against pH 7, which are different points
 * solubility    vs  Ksp             -- grams per litre against an equilibrium constant
 * ```
 *
 * Pure. No network, no clock, no storage.
 */

import { isChemistryError, parseFormula } from './chemistry.ts'

export interface SolutionError {
  error: 'invalid-argument' | 'not-finite' | 'out-of-range' | 'needs-density' | 'no-solution' | 'outside-model' | 'too-many'
  message: string
}

export const isSolutionError = (value: unknown): value is SolutionError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: SolutionError['error'], message: string): SolutionError => ({ error, message })

const finite = (value: number): boolean => Number.isFinite(value)

export const SOLUTION_LIMITS = Object.freeze({ samples: 4000, species: 32, iterations: 200 })

/** The ion product of water at 25 °C. It is temperature dependent, which is why neutral pH is not always 7. */
export const WATER_ION_PRODUCT = 1.0e-14
export const WATER_ION_PRODUCT_SOURCE =
  'Kw = 1.0e-14 at 25 C. It rises with temperature — 1.47e-14 at 30 C and 5.5e-14 at 50 C — so neutral pH is 6.63 at 50 C and not 7.'

// ---------------------------------------------------------------- concentration

export type ConcentrationUnit = 'molarity' | 'molality' | 'mass-percent' | 'ppm' | 'mole-fraction' | 'normality'

export const CONCENTRATION_UNITS: readonly ConcentrationUnit[] = Object.freeze([
  'molarity',
  'molality',
  'mass-percent',
  'ppm',
  'mole-fraction',
  'normality'
])

export const CONCENTRATION_FACTS: Readonly<
  Record<ConcentrationUnit, { label: string; perWhat: string; temperatureDependent: boolean; note: string }>
> = Object.freeze({
  molarity: {
    label: 'Molarity',
    perWhat: 'Moles of solute per litre of solution.',
    temperatureDependent: true,
    note: 'Depends on temperature, because the solution expands. A 1 M solution at 20 C is not quite 1 M at 80 C, which matters for precise work.'
  },
  molality: {
    label: 'Molality',
    perWhat: 'Moles of solute per kilogram of solvent.',
    temperatureDependent: false,
    note: 'Independent of temperature, because masses do not expand. That is why colligative properties are defined in molality and not molarity.'
  },
  'mass-percent': {
    label: 'Mass percent',
    perWhat: 'Grams of solute per 100 grams of solution.',
    temperatureDependent: false,
    note: 'What a reagent bottle usually states. Converting it to molarity needs the solution density, which is not the solvent density.'
  },
  ppm: {
    label: 'Parts per million',
    perWhat: 'Milligrams of solute per kilogram of solution.',
    temperatureDependent: false,
    note: 'For dilute aqueous solutions 1 ppm is about 1 mg/L, because the density is about 1 kg/L. That approximation fails for anything concentrated or non-aqueous.'
  },
  'mole-fraction': {
    label: 'Mole fraction',
    perWhat: 'Moles of solute over total moles.',
    temperatureDependent: false,
    note: 'The unit that appears in Raoult’s law and in most thermodynamics. Dimensionless and always between 0 and 1.'
  },
  normality: {
    label: 'Normality',
    perWhat: 'Equivalents of solute per litre of solution.',
    temperatureDependent: true,
    note: 'Depends on the reaction, not just the substance: sulphuric acid is 1 M and 2 N as an acid. Largely deprecated for that reason, and still used in titration work.'
  }
})

export interface ConcentrationReport {
  /** Every unit that could be worked out from what was given. */
  values: readonly { unit: ConcentrationUnit; value: number; label: string; perWhat: string }[]
  /** What was not computable, and what it would need. */
  missing: readonly { unit: ConcentrationUnit; needs: string }[]
  molarMass: number
  formula: string
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Convert a concentration between units, computing only what the inputs support.
 *
 * Molarity and molality cannot be converted into each other without the solution density, and the commonest error in
 * this area is assuming the density is 1 kg/L because the solvent is water. A 30% sodium hydroxide solution has a
 * density of 1.33, and treating it as 1 gives a molarity 33% too low. So the conversion refuses and says what it
 * needs rather than assuming.
 */
export function concentration(input: {
  formula: string
  /** Whichever one is known. */
  molarity?: number
  molality?: number
  massPercent?: number
  ppm?: number
  moleFraction?: number
  /** kg/L. The solution density, not the solvent's. */
  solutionDensity?: number
  /** g/mol, for the solvent, needed for mole fraction. Water is 18.015. */
  solventMolarMass?: number
  /** How many equivalents per mole, for normality. */
  equivalents?: number
}): ConcentrationReport | SolutionError {
  const parsed = parseFormula(input.formula)
  if (isChemistryError(parsed)) return fail('invalid-argument', parsed.message)
  const molarMass = parsed.molarMass

  const given = (['molarity', 'molality', 'massPercent', 'ppm', 'moleFraction'] as const).filter((one) => input[one] !== undefined)
  if (given.length === 0) return fail('invalid-argument', 'Give one concentration to convert from.')
  if (given.length > 1) return fail('invalid-argument', `Both ${given.join(' and ')} were given. Any one converts to the others, so pick one.`)
  for (const name of given) {
    const value = input[name] as number
    if (!finite(value) || value < 0) return fail('invalid-argument', `"${name}" has to be zero or more.`)
  }

  const density = input.solutionDensity
  if (density !== undefined && (!finite(density) || density <= 0)) {
    return fail('invalid-argument', 'The solution density has to be greater than zero kg/L.')
  }
  const solventMolarMass = input.solventMolarMass ?? 18.015

  const warnings: string[] = []
  const missing: { unit: ConcentrationUnit; needs: string }[] = []

  // Work everything back to grams of solute per kilogram of solution, which every unit can reach from.
  let solutePerKgSolution: number | null = null
  if (input.massPercent !== undefined) {
    if (input.massPercent > 100) return fail('out-of-range', 'A mass percent above 100 would be more solute than solution.')
    solutePerKgSolution = (input.massPercent / 100) * 1000
  } else if (input.ppm !== undefined) {
    solutePerKgSolution = input.ppm / 1000
  } else if (input.molality !== undefined) {
    // Moles per kg of solvent, so the solution is 1 kg of solvent plus the solute.
    const soluteGramsPerKgSolvent = input.molality * molarMass
    solutePerKgSolution = (soluteGramsPerKgSolvent / (1000 + soluteGramsPerKgSolvent)) * 1000
  } else if (input.moleFraction !== undefined) {
    if (input.moleFraction > 1) return fail('out-of-range', 'A mole fraction is between 0 and 1.')
    const solventFraction = 1 - input.moleFraction
    if (solventFraction === 0) {
      return fail('no-solution', 'A mole fraction of 1 is pure solute with no solvent, which is not a solution.')
    }
    const gramsPerMoleOfMixture = input.moleFraction * molarMass + solventFraction * solventMolarMass
    solutePerKgSolution = ((input.moleFraction * molarMass) / gramsPerMoleOfMixture) * 1000
  } else if (input.molarity !== undefined) {
    if (density === undefined) {
      // Molarity is per litre of solution, so reaching any mass-based unit needs the density.
      missing.push(
        { unit: 'molality', needs: 'the solution density, to turn litres of solution into kilograms' },
        { unit: 'mass-percent', needs: 'the solution density' },
        { unit: 'ppm', needs: 'the solution density' },
        { unit: 'mole-fraction', needs: 'the solution density' }
      )
      warnings.push(
        'Converting molarity to any mass-based unit needs the solution density, and it was not given. Assuming 1 kg/L because the solvent is water is the commonest error here — a 30% sodium hydroxide solution is 1.33 kg/L, and treating it as 1 gives a molarity a third too low.'
      )
    } else {
      solutePerKgSolution = (input.molarity * molarMass) / density
    }
  }

  const values: { unit: ConcentrationUnit; value: number; label: string; perWhat: string }[] = []
  const add = (unit: ConcentrationUnit, value: number): void => {
    values.push({ unit, value, label: CONCENTRATION_FACTS[unit].label, perWhat: CONCENTRATION_FACTS[unit].perWhat })
  }

  if (input.molarity !== undefined) add('molarity', input.molarity)

  if (solutePerKgSolution !== null) {
    const massPercent = solutePerKgSolution / 10
    add('mass-percent', massPercent)
    add('ppm', solutePerKgSolution * 1000)
    const solventPerKg = 1000 - solutePerKgSolution
    if (solventPerKg <= 0) {
      return fail('no-solution', 'That concentration leaves no solvent at all, which is not a solution.')
    }
    add('molality', (solutePerKgSolution / molarMass) / (solventPerKg / 1000))
    const soluteMoles = solutePerKgSolution / molarMass
    const solventMoles = solventPerKg / solventMolarMass
    add('mole-fraction', soluteMoles / (soluteMoles + solventMoles))
    if (input.molarity === undefined) {
      if (density === undefined) {
        missing.push({ unit: 'molarity', needs: 'the solution density, to turn kilograms of solution into litres' })
        warnings.push('Molarity needs the solution density and it was not given, so it has been left out rather than guessed.')
      } else {
        add('molarity', (solutePerKgSolution / molarMass) * density)
      }
    }
  }

  if (input.equivalents !== undefined) {
    if (!Number.isInteger(input.equivalents) || input.equivalents < 1) {
      return fail('invalid-argument', 'The equivalents per mole is a whole number of at least 1.')
    }
    const molarity = values.find((one) => one.unit === 'molarity')
    if (molarity !== undefined) {
      add('normality', molarity.value * input.equivalents)
    } else {
      missing.push({ unit: 'normality', needs: 'a molarity, which needs the solution density' })
    }
  } else {
    missing.push({
      unit: 'normality',
      needs: 'the number of equivalents per mole, which depends on the reaction rather than the substance — sulphuric acid is 1 M and 2 N as an acid'
    })
  }

  return {
    values: Object.freeze(values),
    missing: Object.freeze(missing),
    molarMass,
    formula: parsed.formula,
    notes: Object.freeze([
      `${parsed.formula}, molar mass ${molarMass.toFixed(4)} g/mol.`,
      'Molarity is per litre of solution and molality is per kilogram of solvent. Converting between them needs the solution density, and they diverge as soon as the solution is concentrated.',
      'Molality is used for colligative properties because it does not change with temperature. Molarity does, because the solution expands.',
      missing.length === 0 ? 'Every unit was computable from what was given.' : `${missing.length} unit${missing.length === 1 ? '' : 's'} could not be computed and ${missing.length === 1 ? 'is' : 'are'} listed with what ${missing.length === 1 ? 'it needs' : 'they need'} rather than guessed.`
    ]),
    warnings: Object.freeze(warnings)
  }
}

export interface DilutionReport {
  /** The quantity that was solved for. */
  solvedFor: 'initialConcentration' | 'initialVolume' | 'finalConcentration' | 'finalVolume'
  initialConcentration: number
  initialVolume: number
  finalConcentration: number
  finalVolume: number
  /** How much solvent to add. Negative means the solution has to be concentrated instead, which dilution cannot do. */
  solventToAdd: number
  dilutionFactor: number
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Solve a dilution, with the amount of solvent to add rather than just the final volume.
 *
 * The solvent figure is what somebody at a bench actually needs, and it is the final volume minus the initial rather
 than the final volume itself — a distinction that has ruined many a standard. Concentrating rather than diluting is
 * refused, because adding solvent cannot do it.
 */
export function dilution(input: {
  initialConcentration?: number
  initialVolume?: number
  finalConcentration?: number
  finalVolume?: number
}): DilutionReport | SolutionError {
  const names = ['initialConcentration', 'initialVolume', 'finalConcentration', 'finalVolume'] as const
  const given = names.filter((one) => input[one] !== undefined)
  if (given.length !== 3) {
    return fail(
      'invalid-argument',
      `C1V1 = C2V2 relates four quantities, so three fix the fourth. ${given.length} were given${given.length === 0 ? '' : `: ${given.join(', ')}`}.`
    )
  }
  for (const name of given) {
    const value = input[name] as number
    if (!finite(value)) return fail('not-finite', `"${name}" has to be a finite number.`)
    if (value <= 0) return fail('invalid-argument', `"${name}" has to be greater than zero.`)
  }

  const missing = names.find((one) => input[one] === undefined) as typeof names[number]
  const c1 = input.initialConcentration ?? ((input.finalConcentration as number) * (input.finalVolume as number)) / (input.initialVolume as number)
  const v1 = input.initialVolume ?? ((input.finalConcentration as number) * (input.finalVolume as number)) / (input.initialConcentration as number)
  const c2 = input.finalConcentration ?? ((input.initialConcentration as number) * (input.initialVolume as number)) / (input.finalVolume as number)
  const v2 = input.finalVolume ?? ((input.initialConcentration as number) * (input.initialVolume as number)) / (input.finalConcentration as number)

  const warnings: string[] = []
  if (c2 > c1) {
    return fail(
      'no-solution',
      `The final concentration (${c2}) is above the initial (${c1}). Adding solvent cannot concentrate a solution — that needs evaporation or more solute, and neither is this calculation.`
    )
  }
  if (v2 < v1) {
    return fail('no-solution', `The final volume (${v2}) is below the initial (${v1}), which dilution cannot do.`)
  }
  const factor = c1 / c2
  if (factor > 1000) {
    warnings.push(
      `A dilution factor of ${factor.toFixed(0)} in one step is hard to do accurately: it means measuring a very small volume of the concentrate. Serial dilution — several smaller steps — is more accurate for anything past about 100-fold.`
    )
  }

  return {
    solvedFor: missing,
    initialConcentration: c1,
    initialVolume: v1,
    finalConcentration: c2,
    finalVolume: v2,
    solventToAdd: v2 - v1,
    dilutionFactor: factor,
    notes: Object.freeze([
      `${v1.toFixed(4)} of ${c1} becomes ${v2.toFixed(4)} of ${c2.toFixed(6)} — a ${factor.toFixed(2)}-fold dilution.`,
      `Add ${(v2 - v1).toFixed(4)} of solvent. That is the difference between the volumes, not the final volume — a distinction that has ruined many a standard solution.`,
      'The units cancel, so any consistent pair works: molar and litres, or percent and millilitres. Mixing them is the only way to get this wrong.',
      'This assumes the volumes add, which they nearly do for dilute aqueous solutions and do not for concentrated ones — mixing equal volumes of ethanol and water gives less than the sum.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- acids and bases

export interface PhReport {
  pH: number
  pOH: number
  /** Molar. */
  hydrogenIonConcentration: number
  hydroxideConcentration: number
  /** Whether the solution is acidic, neutral or alkaline at this temperature. */
  character: 'acidic' | 'neutral' | 'alkaline'
  /** The pH of a neutral solution at this temperature, which is 7 only at 25 °C. */
  neutralPh: number
  /** How much of a weak acid or base actually dissociated. */
  fractionDissociated: number | null
  /** Whether the simple formula would have been adequate here. */
  simpleFormulaAdequate: boolean
  /** What the simple formula would have given, for comparison. */
  simpleFormulaResult: number | null
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * pH from a concentration, solved from the equilibrium rather than approximated.
 *
 * The shortcut pH = -log C is right for a strong acid above about 10⁻⁶ M and wrong below it, because water's own
 * ionisation starts to matter — it gives pH 8 for 10⁻⁸ M hydrochloric acid, an acid coming out alkaline. Solving the
 * charge balance gets it right everywhere, and the shortcut's answer is reported alongside so the difference is
 * visible.
 *
 * For a weak acid the quadratic is solved rather than the usual assumption that dissociation is negligible. That
 * assumption fails below about 10⁻³ M or for a pKa above about 4, which is a lot of real cases.
 */
export function pH(input: {
  /** Molar. */
  concentration: number
  kind?: 'strong-acid' | 'strong-base' | 'weak-acid' | 'weak-base'
  /** For a weak acid or base. Give one. */
  pKa?: number
  pKb?: number
  /** Kelvin. Kw changes with it, so neutral pH does too. */
  temperature?: number
}): PhReport | SolutionError {
  const { concentration: c } = input
  if (!finite(c) || c < 0) return fail('invalid-argument', 'The concentration has to be zero or more molar.')
  if (c > 20) {
    return fail(
      'outside-model',
      `At ${c} M the solution is concentrated enough that activity differs substantially from concentration, and pH stops meaning what this calculation computes. Above about 1 M the answer is indicative at best.`
    )
  }
  const kind = input.kind ?? 'strong-acid'
  const temperature = input.temperature ?? 298.15
  if (!finite(temperature) || temperature <= 0) return fail('invalid-argument', 'The temperature is in kelvin and has to be above zero.')

  // Kw with temperature, from the standard interpolation over 0 to 60 C.
  const kw =
    Math.abs(temperature - 298.15) < 0.01
      ? WATER_ION_PRODUCT
      : Math.pow(10, -(4787.3 / temperature + 7.1321 * Math.log10(temperature) + 0.010365 * temperature - 22.801))
  const neutralPh = -Math.log10(Math.sqrt(kw))

  const warnings: string[] = []
  let hydrogen: number
  let fractionDissociated: number | null = null

  if (kind === 'strong-acid' || kind === 'strong-base') {
    // The charge balance: [H+] - [OH-] = +C for an acid, -C for a base. Solving the quadratic is right at every
    // concentration, where the logarithm shortcut is not.
    const sign = kind === 'strong-acid' ? 1 : -1
    const contribution = sign * c
    hydrogen = (contribution + Math.sqrt(contribution * contribution + 4 * kw)) / 2
    fractionDissociated = 1
  } else {
    const isAcid = kind === 'weak-acid'
    const pk = isAcid ? input.pKa : input.pKb
    if (pk === undefined) {
      return fail('invalid-argument', `A ${kind.replace('-', ' ')} needs its ${isAcid ? 'pKa' : 'pKb'}.`)
    }
    if (!finite(pk)) return fail('not-finite', 'The dissociation constant has to be a finite number.')
    if (pk < -10 || pk > 20) return fail('out-of-range', 'A pKa or pKb outside -10 to 20 describes nothing found in solution.')
    const k = Math.pow(10, -pk)
    if (c === 0) return fail('no-solution', 'A weak acid at zero concentration has no dissociation to compute; the pH is that of water alone.')

    // Solve x^2 + Kx - KC = 0 for the dissociated amount, which is exact rather than the usual approximation.
    const x = (-k + Math.sqrt(k * k + 4 * k * c)) / 2
    fractionDissociated = c === 0 ? 0 : x / c
    if (isAcid) {
      hydrogen = x + kw / Math.max(x, 1e-30)
    } else {
      const hydroxide = x
      hydrogen = kw / Math.max(hydroxide, 1e-30)
    }

    const approximate = Math.sqrt(k * c)
    if (Math.abs(x - approximate) / Math.max(x, 1e-30) > 0.05) {
      warnings.push(
        `The usual approximation — assuming dissociation is negligible against the concentration — is out by ${((Math.abs(x - approximate) / x) * 100).toFixed(1)}% here. ${(fractionDissociated * 100).toFixed(1)}% of it dissociated, which is not negligible, so the quadratic was solved instead.`
      )
    }
    if (fractionDissociated > 0.5) {
      warnings.push(
        `${(fractionDissociated * 100).toFixed(1)}% dissociated. At that level "weak" is doing very little work, and the distinction between a weak acid and a strong one is a matter of degree rather than kind.`
      )
    }
  }

  if (hydrogen <= 0) return fail('no-solution', 'The hydrogen ion concentration came out at zero or below, which describes no solution.')

  const value = -Math.log10(hydrogen)
  const hydroxide = kw / hydrogen
  const simple = kind === 'strong-acid' ? -Math.log10(Math.max(c, 1e-30)) : kind === 'strong-base' ? 14 + Math.log10(Math.max(c, 1e-30)) : null
  const simpleAdequate = simple === null || Math.abs(simple - value) < 0.02

  if (simple !== null && !simpleAdequate) {
    warnings.push(
      `The shortcut formula gives pH ${simple.toFixed(3)} and the equilibrium gives ${value.toFixed(3)}. At this concentration water's own ionisation matters, and the shortcut is the reason a 1e-8 M acid is sometimes reported as alkaline.`
    )
  }
  if (Math.abs(temperature - 298.15) > 1) {
    warnings.push(
      `At ${temperature.toFixed(1)} K neutral is pH ${neutralPh.toFixed(3)}, not 7. Kw rises with temperature, so pure water at 50 C has a pH of 6.63 and is not acidic.`
    )
  }

  return {
    pH: value,
    pOH: -Math.log10(hydroxide),
    hydrogenIonConcentration: hydrogen,
    hydroxideConcentration: hydroxide,
    character: value < neutralPh - 0.01 ? 'acidic' : value > neutralPh + 0.01 ? 'alkaline' : 'neutral',
    neutralPh,
    fractionDissociated,
    simpleFormulaAdequate: simpleAdequate,
    simpleFormulaResult: simple,
    notes: Object.freeze([
      `pH ${value.toFixed(4)}, pOH ${(-Math.log10(hydroxide)).toFixed(4)}, from [H+] of ${hydrogen.toExponential(4)} M.`,
      'Solved from the charge balance rather than the logarithm shortcut, which is right for a strong acid above about 1e-6 M and gives an acid an alkaline pH below that.',
      `Neutral at this temperature is pH ${neutralPh.toFixed(4)}. ${WATER_ION_PRODUCT_SOURCE}`,
      fractionDissociated === null || fractionDissociated === 1
        ? 'A strong acid or base is taken as fully dissociated, which is what "strong" means.'
        : `${(fractionDissociated * 100).toFixed(2)}% of it dissociated. That fraction rises as the solution gets more dilute, which is why a weak acid gets relatively stronger on dilution.`,
      'This is concentration, not activity. Above about 0.1 M they differ noticeably and a measured pH will not match a calculated one.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

export interface BufferReport {
  pH: number
  pKa: number
  /** The ratio of base to acid this pH needs. */
  ratio: number
  /** Molar. */
  acidConcentration: number
  baseConcentration: number
  /** How much strong acid or base this can absorb per pH unit. Higher is better. */
  bufferCapacity: number
  /** The pH range over which this buffer actually buffers. */
  effectiveRange: { from: number; to: number }
  /** Whether the requested pH is inside that range. */
  withinRange: boolean
  /** How the pH moves when a given amount of strong acid or base is added. */
  afterAddition: { addedMoles: number; newPh: number; phChange: number } | null
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * A buffer by Henderson-Hasselbalch, with the range over which it actually buffers.
 *
 * The range matters more than the ratio. A buffer works within about one pH unit of its pKa; asked to hold a pH two
 * units away it returns a ratio of 100 to 1, which technically satisfies the equation and has almost no capacity to
 * absorb anything. The capacity figure is what says whether the buffer will do its job.
 */
export function buffer(input: {
  pKa: number
  /** One of these: the pH wanted, or the two concentrations. */
  targetPh?: number
  acidConcentration?: number
  baseConcentration?: number
  /** Moles of strong acid (negative) or base (positive) added per litre, to see the pH move. */
  addStrongBaseMoles?: number
}): BufferReport | SolutionError {
  const { pKa } = input
  if (!finite(pKa)) return fail('not-finite', 'The pKa has to be a finite number.')
  if (pKa < -10 || pKa > 20) return fail('out-of-range', 'A pKa outside -10 to 20 describes nothing found in solution.')

  let acid: number
  let base: number
  let value: number

  if (input.acidConcentration !== undefined && input.baseConcentration !== undefined) {
    acid = input.acidConcentration
    base = input.baseConcentration
    for (const [name, one] of [['acidConcentration', acid], ['baseConcentration', base]] as const) {
      if (!finite(one) || one <= 0) return fail('invalid-argument', `"${name}" has to be greater than zero.`)
    }
    value = pKa + Math.log10(base / acid)
  } else if (input.targetPh !== undefined) {
    value = input.targetPh
    if (!finite(value)) return fail('not-finite', 'The target pH has to be a finite number.')
    const ratio = Math.pow(10, value - pKa)
    // A total of 1 M split in the required ratio, which is a convention the caller can scale.
    acid = 1 / (1 + ratio)
    base = ratio / (1 + ratio)
  } else {
    return fail(
      'invalid-argument',
      'Give a target pH, or both the acid and conjugate base concentrations. One fixes the other, and giving neither leaves nothing to compute.'
    )
  }

  const ratio = base / acid
  const total = acid + base
  // The buffer capacity: 2.303 * C * Ka[H+] / (Ka + [H+])^2, which peaks at the pKa.
  const hydrogen = Math.pow(10, -value)
  const ka = Math.pow(10, -pKa)
  const capacity = (2.303 * total * ka * hydrogen) / Math.pow(ka + hydrogen, 2)
  const range = { from: pKa - 1, to: pKa + 1 }
  const withinRange = value >= range.from && value <= range.to

  const warnings: string[] = []
  if (!withinRange) {
    warnings.push(
      `A pH of ${value.toFixed(2)} is ${Math.abs(value - pKa).toFixed(2)} units from the pKa of ${pKa}, outside the range where this buffers. The ratio of ${ratio.toFixed(1)} to 1 satisfies the equation and has a capacity of ${capacity.toExponential(2)} — nearly nothing. Pick a buffer whose pKa is near the pH you want.`
    )
  }
  if (Math.min(acid, base) / total < 0.05) {
    warnings.push(
      `One component is only ${((Math.min(acid, base) / total) * 100).toFixed(1)}% of the total. A buffer needs a reasonable amount of both to absorb acid and base, and this one will run out of the smaller one immediately.`
    )
  }

  let afterAddition: BufferReport['afterAddition'] = null
  if (input.addStrongBaseMoles !== undefined) {
    const added = input.addStrongBaseMoles
    if (!finite(added)) return fail('not-finite', 'The added amount has to be a finite number.')
    const newAcid = acid - added
    const newBase = base + added
    if (newAcid <= 0 || newBase <= 0) {
      warnings.push(
        `Adding ${added} mol/L exhausts ${newAcid <= 0 ? 'the acid' : 'the base'} completely. Past that point there is no buffer left and the pH moves as it would in plain water, so no new pH is reported — the equation stops applying.`
      )
    } else {
      const newPh = pKa + Math.log10(newBase / newAcid)
      afterAddition = { addedMoles: added, newPh, phChange: newPh - value }
    }
  }

  return {
    pH: value,
    pKa,
    ratio,
    acidConcentration: acid,
    baseConcentration: base,
    bufferCapacity: capacity,
    effectiveRange: range,
    withinRange,
    afterAddition,
    notes: Object.freeze([
      `pH ${value.toFixed(4)} from a base-to-acid ratio of ${ratio.toFixed(4)} with a pKa of ${pKa}.`,
      `The buffer capacity is ${capacity.toExponential(4)} mol/L per pH unit, and it peaks exactly at the pKa. That is the number that says whether the buffer will hold, not the ratio.`,
      `This buffers usefully from pH ${range.from.toFixed(2)} to ${range.to.toFixed(2)} — within one unit of the pKa. Henderson-Hasselbalch keeps returning answers outside that and they have no capacity behind them.`,
      'Henderson-Hasselbalch assumes the dissociation of the weak acid is negligible against its concentration. That holds for a buffer with both components present in reasonable amounts, and fails when one is nearly exhausted.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

export interface TitrationReport {
  /** Litres of titrant at the equivalence point. */
  equivalenceVolume: number
  /** The pH there, which is not 7 unless both are strong. */
  equivalencePh: number
  /** Whether the equivalence point is neutral, and why not when it is not. */
  equivalenceIsNeutral: boolean
  /** The half-equivalence point, where pH equals pKa for a weak acid. */
  halfEquivalenceVolume: number
  halfEquivalencePh: number | null
  /** The curve, for drawing. */
  curve: readonly { volumeAdded: number; pH: number; fractionTitrated: number }[]
  /** How steep the jump is at equivalence, which decides whether an indicator can find it. */
  jumpPhUnits: number
  /** Indicators whose range brackets the equivalence point. */
  suitableIndicators: readonly string[]
  notes: readonly string[]
  warnings: readonly string[]
}

const INDICATORS: readonly { name: string; from: number; to: number }[] = Object.freeze([
  { name: 'methyl orange', from: 3.1, to: 4.4 },
  { name: 'bromocresol green', from: 3.8, to: 5.4 },
  { name: 'methyl red', from: 4.4, to: 6.2 },
  { name: 'bromothymol blue', from: 6.0, to: 7.6 },
  { name: 'phenol red', from: 6.8, to: 8.4 },
  { name: 'phenolphthalein', from: 8.3, to: 10.0 },
  { name: 'thymolphthalein', from: 9.3, to: 10.5 }
])

/**
 * A titration curve, with the equivalence point where it actually is.
 *
 * The equivalence point is not pH 7 unless both the acid and the base are strong, and that is the single most useful
 * thing about a titration curve. A weak acid against a strong base equivalences above 7, because the conjugate base
 * left behind is itself basic — which is why phenolphthalein is the indicator for that titration and methyl orange
 * is not.
 *
 * The suitable indicators are computed from where the equivalence point falls rather than being recited, and the
 * steepness of the jump is reported because a shallow jump cannot be found by any indicator.
 */
export function titration(input: {
  /** Molar and litres. */
  analyteConcentration: number
  analyteVolume: number
  titrantConcentration: number
  /** Which is which. */
  analyte?: 'strong-acid' | 'weak-acid' | 'strong-base' | 'weak-base'
  /** For a weak analyte. */
  pKa?: number
  samples?: number
}): TitrationReport | SolutionError {
  const { analyteConcentration: ca, analyteVolume: va, titrantConcentration: ct } = input
  for (const [name, value] of [['analyteConcentration', ca], ['analyteVolume', va], ['titrantConcentration', ct]] as const) {
    if (!finite(value)) return fail('not-finite', `"${name}" has to be a finite number.`)
    if (value <= 0) return fail('invalid-argument', `"${name}" has to be greater than zero.`)
  }
  const analyte = input.analyte ?? 'strong-acid'
  const isAcidAnalyte = analyte === 'strong-acid' || analyte === 'weak-acid'
  const isWeak = analyte === 'weak-acid' || analyte === 'weak-base'
  if (isWeak && input.pKa === undefined) {
    return fail('invalid-argument', `A ${analyte.replace('-', ' ')} titration needs the pKa, which is what sets where the equivalence point lands.`)
  }
  const pKa = input.pKa ?? 0
  if (isWeak && (!finite(pKa) || pKa < -10 || pKa > 20)) {
    return fail('out-of-range', 'A pKa outside -10 to 20 describes nothing found in solution.')
  }

  const moles = ca * va
  const equivalenceVolume = moles / ct
  const count = Math.round(input.samples ?? 200)
  if (!Number.isInteger(count) || count < 3 || count > SOLUTION_LIMITS.samples) {
    return fail('invalid-argument', `The sample count has to be between 3 and ${SOLUTION_LIMITS.samples}.`)
  }

  const kw = WATER_ION_PRODUCT
  const ka = Math.pow(10, -pKa)

  const phAt = (volume: number): number => {
    const totalVolume = va + volume
    const titrantMoles = ct * volume
    if (isAcidAnalyte) {
      if (isWeak) {
        if (volume <= 0) {
          const x = (-ka + Math.sqrt(ka * ka + 4 * ka * ca)) / 2
          return -Math.log10(x)
        }
        if (Math.abs(titrantMoles - moles) < moles * 1e-9) {
          // At equivalence only the conjugate base remains, and it hydrolyses.
          const conjugate = moles / totalVolume
          const kb = kw / ka
          const hydroxide = (-kb + Math.sqrt(kb * kb + 4 * kb * conjugate)) / 2
          return 14 + Math.log10(hydroxide)
        }
        if (titrantMoles < moles) {
          // The buffer region.
          const remaining = moles - titrantMoles
          return pKa + Math.log10(titrantMoles / remaining)
        }
        const excess = (titrantMoles - moles) / totalVolume
        return 14 + Math.log10(excess)
      }
      if (titrantMoles < moles) {
        const remaining = (moles - titrantMoles) / totalVolume
        return -Math.log10((remaining + Math.sqrt(remaining * remaining + 4 * kw)) / 2)
      }
      if (Math.abs(titrantMoles - moles) < moles * 1e-12) return 7
      const excess = (titrantMoles - moles) / totalVolume
      return 14 + Math.log10((excess + Math.sqrt(excess * excess + 4 * kw)) / 2)
    }
    // A base analyte titrated with acid: the mirror image.
    if (isWeak) {
      const kb = Math.pow(10, -pKa)
      if (volume <= 0) {
        const x = (-kb + Math.sqrt(kb * kb + 4 * kb * ca)) / 2
        return 14 + Math.log10(x)
      }
      if (Math.abs(titrantMoles - moles) < moles * 1e-9) {
        const conjugate = moles / totalVolume
        const kaConjugate = kw / kb
        const hydrogen = (-kaConjugate + Math.sqrt(kaConjugate * kaConjugate + 4 * kaConjugate * conjugate)) / 2
        return -Math.log10(hydrogen)
      }
      if (titrantMoles < moles) {
        const remaining = moles - titrantMoles
        return 14 - pKa - Math.log10(titrantMoles / remaining)
      }
      const excess = (titrantMoles - moles) / totalVolume
      return -Math.log10(excess)
    }
    if (titrantMoles < moles) {
      const remaining = (moles - titrantMoles) / totalVolume
      return 14 + Math.log10((remaining + Math.sqrt(remaining * remaining + 4 * kw)) / 2)
    }
    if (Math.abs(titrantMoles - moles) < moles * 1e-12) return 7
    const excess = (titrantMoles - moles) / totalVolume
    return -Math.log10((excess + Math.sqrt(excess * excess + 4 * kw)) / 2)
  }

  const top = equivalenceVolume * 2
  const curve: TitrationReport['curve'][number][] = []
  for (let i = 0; i < count; i += 1) {
    const volume = (top * i) / (count - 1)
    curve.push({ volumeAdded: volume, pH: phAt(volume), fractionTitrated: volume / equivalenceVolume })
  }

  const equivalencePh = phAt(equivalenceVolume)
  const halfVolume = equivalenceVolume / 2
  const halfPh = isWeak ? phAt(halfVolume) : null

  // How steep the jump is: the pH change over the 1% of the equivalence volume either side.
  const before = phAt(equivalenceVolume * 0.99)
  const after = phAt(equivalenceVolume * 1.01)
  const jump = Math.abs(after - before)

  const suitable = INDICATORS.filter((one) => equivalencePh >= one.from && equivalencePh <= one.to).map((one) => one.name)

  const warnings: string[] = []
  if (jump < 2) {
    warnings.push(
      `The pH changes by only ${jump.toFixed(2)} units across the equivalence point, which no indicator can find reliably. That happens with a very weak acid or a dilute solution, and it is why such titrations are followed with a pH meter rather than a colour change.`
    )
  }
  if (suitable.length === 0) {
    warnings.push(
      `No indicator in the list brackets pH ${equivalencePh.toFixed(2)}. The nearest are ${INDICATORS.map((one) => `${one.name} (${one.from}-${one.to})`).slice(0, 3).join(', ')}, and none of them changes colour where this titration equivalences.`
    )
  }

  return {
    equivalenceVolume,
    equivalencePh,
    equivalenceIsNeutral: Math.abs(equivalencePh - 7) < 0.1,
    halfEquivalenceVolume: halfVolume,
    halfEquivalencePh: halfPh,
    curve: Object.freeze(curve),
    jumpPhUnits: jump,
    suitableIndicators: Object.freeze(suitable),
    notes: Object.freeze([
      `Equivalence at ${equivalenceVolume.toFixed(6)} L of titrant, where the pH is ${equivalencePh.toFixed(3)}.`,
      Math.abs(equivalencePh - 7) < 0.1
        ? 'The equivalence point is neutral, which happens only when both the acid and the base are strong.'
        : `The equivalence point is at pH ${equivalencePh.toFixed(2)} and not 7, because the ${isAcidAnalyte ? 'conjugate base' : 'conjugate acid'} left behind is itself ${isAcidAnalyte ? 'basic' : 'acidic'}. That is why the indicator for this titration is not the one for a strong-strong titration.`,
      halfPh === null
        ? 'A strong analyte has no buffer region, so the half-equivalence point is not special.'
        : `At half equivalence the pH is ${halfPh.toFixed(3)}, which equals the pKa. That is the easiest way to measure a pKa there is.`,
      suitable.length === 0 ? 'No listed indicator suits this equivalence point.' : `Suitable indicators: ${suitable.join(', ')} — chosen because their colour change brackets the equivalence pH, not by convention.`
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- solubility

export interface SolubilityReport {
  /** The solubility product. */
  ksp: number
  /** Molar solubility. */
  molarSolubility: number
  /** Grams per litre, when the formula gives a molar mass. */
  gramsPerLitre: number | null
  /** The ion concentrations at saturation. */
  ions: readonly { formula: string; stoichiometry: number; concentration: number }[]
  /** How much less soluble it becomes in a solution already containing one of its ions. */
  commonIonEffect: { ion: string; concentration: number; reducedSolubility: number; factor: number } | null
  /** Whether a given pair of concentrations would precipitate. */
  willPrecipitate: boolean | null
  ionProduct: number | null
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Solubility from a solubility product, and whether a mixture will precipitate.
 *
 * The common ion effect is the part worth having: a salt is far less soluble in a solution that already contains one
 * of its ions, and the reduction is not small — silver chloride is about a hundred times less soluble in 0.01 M
 * sodium chloride than in water. That is the basis of most precipitation chemistry and it surprises people every
 * time.
 */
export function solubility(input: {
  ksp: number
  /** The stoichiometry, as the number of each ion per formula unit. */
  cationCount?: number
  anionCount?: number
  /** For a grams-per-litre figure. */
  formula?: string
  /** Molar, for the common ion effect. */
  commonIonConcentration?: number
  commonIonIs?: 'cation' | 'anion'
  /** Molar, to test whether a mixture precipitates. */
  cationConcentration?: number
  anionConcentration?: number
}): SolubilityReport | SolutionError {
  const { ksp } = input
  if (!finite(ksp) || ksp <= 0) return fail('invalid-argument', 'A solubility product has to be greater than zero.')
  const cations = Math.round(input.cationCount ?? 1)
  const anions = Math.round(input.anionCount ?? 1)
  if (!Number.isInteger(cations) || cations < 1 || !Number.isInteger(anions) || anions < 1) {
    return fail('invalid-argument', 'The ion counts are whole numbers of at least 1.')
  }
  if (cations > 6 || anions > 6) return fail('too-many', 'More than six of one ion per formula unit is outside what this handles.')

  // Ksp = (a*s)^a * (b*s)^b, solved for s.
  const coefficient = Math.pow(cations, cations) * Math.pow(anions, anions)
  const s = Math.pow(ksp / coefficient, 1 / (cations + anions))

  let gramsPerLitre: number | null = null
  const warnings: string[] = []
  if (input.formula !== undefined) {
    const parsed = parseFormula(input.formula)
    if (isChemistryError(parsed)) return fail('invalid-argument', parsed.message)
    gramsPerLitre = s * parsed.molarMass
  }

  let commonIonEffect: SolubilityReport['commonIonEffect'] = null
  if (input.commonIonConcentration !== undefined) {
    const shared = input.commonIonConcentration
    if (!finite(shared) || shared < 0) return fail('invalid-argument', 'The common ion concentration has to be zero or more.')
    const which = input.commonIonIs ?? 'anion'
    // Solve with the common ion swamping its own contribution, which is the standard and accurate simplification
    // when the added concentration greatly exceeds the solubility.
    let reduced: number
    if (which === 'anion') {
      reduced = Math.pow(ksp / (Math.pow(cations, cations) * Math.pow(shared, anions)), 1 / cations)
    } else {
      reduced = Math.pow(ksp / (Math.pow(anions, anions) * Math.pow(shared, cations)), 1 / anions)
    }
    commonIonEffect = {
      ion: which,
      concentration: shared,
      reducedSolubility: reduced,
      factor: reduced === 0 ? Number.POSITIVE_INFINITY : s / reduced
    }
    if (shared < s * 10) {
      warnings.push(
        `The common ion concentration of ${shared} M is not much above the solubility of ${s.toExponential(3)} M, so the simplification that the added ion swamps the salt's own contribution is shaky here. Treat the reduced figure as approximate.`
      )
    }
  }

  let willPrecipitate: boolean | null = null
  let ionProduct: number | null = null
  if (input.cationConcentration !== undefined && input.anionConcentration !== undefined) {
    for (const [name, value] of [['cationConcentration', input.cationConcentration], ['anionConcentration', input.anionConcentration]] as const) {
      if (!finite(value) || value < 0) return fail('invalid-argument', `"${name}" has to be zero or more.`)
    }
    ionProduct = Math.pow(input.cationConcentration, cations) * Math.pow(input.anionConcentration, anions)
    willPrecipitate = ionProduct > ksp
  }

  return {
    ksp,
    molarSolubility: s,
    gramsPerLitre,
    ions: Object.freeze([
      { formula: 'cation', stoichiometry: cations, concentration: cations * s },
      { formula: 'anion', stoichiometry: anions, concentration: anions * s }
    ]),
    commonIonEffect,
    willPrecipitate,
    ionProduct,
    notes: Object.freeze([
      `A Ksp of ${ksp.toExponential(4)} gives a molar solubility of ${s.toExponential(4)} M${gramsPerLitre === null ? '' : `, or ${gramsPerLitre.toExponential(4)} g/L`}.`,
      `The stoichiometry matters: with ${cations} cations and ${anions} anions per formula unit, Ksp is ${coefficient} times s to the power ${cations + anions}. Two salts with the same Ksp and different stoichiometry have different solubilities.`,
      commonIonEffect === null
        ? 'Give a common ion concentration to see how much less soluble this becomes in a solution that already contains one of its ions.'
        : `In ${commonIonEffect.concentration} M of its own ${commonIonEffect.ion}, the solubility falls to ${commonIonEffect.reducedSolubility.toExponential(4)} M — ${commonIonEffect.factor.toExponential(2)} times less. That is the basis of most precipitation chemistry.`,
      willPrecipitate === null
        ? 'Give both ion concentrations to test whether a mixture precipitates.'
        : `The ion product is ${(ionProduct as number).toExponential(4)} against a Ksp of ${ksp.toExponential(4)}, so this mixture ${willPrecipitate ? 'will precipitate' : 'stays in solution'}.`
    ]),
    warnings: Object.freeze(warnings)
  }
}

export interface ColligativeReport {
  /** The molality used, since these properties depend on it and not on molarity. */
  molality: number
  /** How many particles each formula unit gives. */
  vanHoffFactor: number
  /** Kelvin. How much the boiling point rises. */
  boilingPointElevation: number | null
  /** Kelvin. How much the freezing point falls. */
  freezingPointDepression: number | null
  /** Pascals. The osmotic pressure. */
  osmoticPressure: number | null
  /** Kelvin. The resulting boiling and freezing points, when the pure values were given. */
  newBoilingPoint: number | null
  newFreezingPoint: number | null
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Colligative properties, which depend on how many particles there are and not on what they are.
 *
 * That is the whole content of the idea and the van't Hoff factor is where it bites: a mole of sodium chloride gives
 * two moles of particles and lowers the freezing point twice as much as a mole of sugar. Getting the factor wrong is
 * the only real way to get these calculations wrong, so it is an explicit argument rather than something inferred
 * from a formula.
 *
 * Molality, not molarity, because these properties do not change with temperature and molarity does.
 */
export function colligative(input: {
  /** Moles of solute per kilogram of solvent. */
  molality: number
  /** How many particles per formula unit: 1 for sugar, 2 for sodium chloride, 3 for calcium chloride. */
  vanHoffFactor?: number
  /** K·kg/mol. Water is 0.512 for boiling and 1.86 for freezing. */
  boilingConstant?: number
  freezingConstant?: number
  /** Kelvin, for the pure solvent. */
  pureBoilingPoint?: number
  pureFreezingPoint?: number
  /** Kelvin, for the osmotic pressure. */
  temperature?: number
}): ColligativeReport | SolutionError {
  const { molality } = input
  if (!finite(molality) || molality < 0) return fail('invalid-argument', 'The molality has to be zero or more.')
  const i = input.vanHoffFactor ?? 1
  if (!finite(i) || i <= 0) return fail('invalid-argument', "The van't Hoff factor has to be greater than zero.")

  const warnings: string[] = []
  if (input.vanHoffFactor === undefined) {
    warnings.push(
      "No van't Hoff factor was given, so one particle per formula unit was assumed. That is right for sugar and wrong by a factor of two for sodium chloride and three for calcium chloride — it is the only real way to get these calculations wrong."
    )
  }
  if (molality > 1 && i > 1) {
    warnings.push(
      `At ${molality} molal an ionic solute does not fully dissociate — ions pair up, so the effective van't Hoff factor is below ${i}. For sodium chloride it is about 1.9 at 0.1 molal and lower still at 1 molal.`
    )
  }

  const boiling = input.boilingConstant === undefined ? null : i * input.boilingConstant * molality
  const freezing = input.freezingConstant === undefined ? null : i * input.freezingConstant * molality
  const osmotic =
    input.temperature === undefined
      ? null
      : (() => {
          if (!finite(input.temperature as number) || (input.temperature as number) <= 0) return null
          // Approximating molality as molarity here, which holds for dilute aqueous solutions.
          return i * molality * 1000 * 8.31446261815324 * (input.temperature as number)
        })()

  if (input.boilingConstant !== undefined && (!finite(input.boilingConstant) || input.boilingConstant <= 0)) {
    return fail('invalid-argument', 'The boiling point constant has to be greater than zero.')
  }
  if (input.freezingConstant !== undefined && (!finite(input.freezingConstant) || input.freezingConstant <= 0)) {
    return fail('invalid-argument', 'The freezing point constant has to be greater than zero.')
  }

  if (osmotic !== null && molality > 0.5) {
    warnings.push(
      'The osmotic pressure figure treats molality as molarity, which holds for dilute aqueous solutions and drifts above about 0.5 molal.'
    )
  }

  return {
    molality,
    vanHoffFactor: i,
    boilingPointElevation: boiling,
    freezingPointDepression: freezing,
    osmoticPressure: osmotic,
    newBoilingPoint: boiling === null || input.pureBoilingPoint === undefined ? null : input.pureBoilingPoint + boiling,
    newFreezingPoint: freezing === null || input.pureFreezingPoint === undefined ? null : input.pureFreezingPoint - freezing,
    notes: Object.freeze([
      `${molality} molal with a van't Hoff factor of ${i} gives ${i * molality} moles of particles per kilogram of solvent.`,
      'Colligative properties depend on how many particles there are and not on what they are. A mole of sodium chloride lowers the freezing point twice as much as a mole of sugar, because it gives two moles of ions.',
      'Molality rather than molarity, because these properties do not change with temperature and molarity does — the solution expands.',
      boiling === null && freezing === null
        ? 'Give a boiling or freezing constant for the solvent to get the actual shifts. They are properties of the solvent, not the solute.'
        : `Boiling rises by ${boiling === null ? 'an unknown amount' : `${boiling.toFixed(4)} K`} and freezing falls by ${freezing === null ? 'an unknown amount' : `${freezing.toFixed(4)} K`}. Freezing depression is about 3.6 times larger than boiling elevation in water, which is why salt is spread on roads rather than in kettles.`
    ]),
    warnings: Object.freeze(warnings)
  }
}

/** Everything a Page should be able to show about what this engine is standing on. */
export const SOLUTION_ASSUMPTIONS: readonly string[] = Object.freeze([
  'pH is solved from the charge balance, not from the logarithm shortcut, which gives an acid an alkaline pH below about 1e-6 M.',
  'Weak acid dissociation is solved as a quadratic rather than assumed negligible, because that assumption fails below 1e-3 M and above pKa 4.',
  'Kw depends on temperature, so neutral pH is 7 only at 25 C. Pure water at 50 C is pH 6.63 and is not acidic.',
  'These are concentrations, not activities. Above about 0.1 M they differ noticeably and a measured pH will not match a calculated one.',
  'Converting molarity to any mass-based unit needs the solution density. Assuming 1 kg/L because the solvent is water is refused rather than done quietly.',
  'A buffer reports the range over which it buffers and its capacity, because Henderson-Hasselbalch keeps returning ratios outside that range and they have no capacity behind them.',
  'A titration equivalence point is neutral only when both the acid and the base are strong. Suitable indicators are computed from where it lands.',
  "Colligative properties use molality and an explicit van't Hoff factor. Getting that factor wrong is the only real way to get them wrong.",
  'Ionic solutes do not fully dissociate above about 0.1 molal, so the effective van’t Hoff factor is below the formula value and that is flagged.'
])
