/**
 * Reactions: how much energy, how far, how fast, and which way the electrons go.
 *
 * The shared reaction engine for Orbis Pages. Enthalpies come from formation values by Hess's law, equilibrium
 * positions are solved from the ICE table rather than approximated, rate constants carry the temperature they were
 * measured at, and a spontaneity claim always names which of enthalpy and entropy is driving it.
 *
 * ## Why spontaneity is never reported without its temperature
 *
 * A reaction is spontaneous when the Gibbs free energy change is negative, and that depends on temperature through
 * the entropy term. A reaction spontaneous at 1000 K can be impossible at 300 K and the other way round, so the
 * crossover temperature is computed and reported rather than a bare yes or no — and "spontaneous" means
 * thermodynamically allowed, not fast, which is a distinction that confuses people constantly.
 *
 * ## Why the equilibrium quadratic is solved
 *
 * The usual shortcut assumes the change in concentration is small against the starting amount. That holds when the
 * equilibrium constant is very small and fails otherwise, and the failure is silent: it gives a change larger than
 * the amount available, which means a negative concentration. Solving properly is no harder and is right at every
 * constant.
 *
 * ## The distinctions this file refuses to blur
 *
 * ```
 * spontaneous   vs  fast              -- thermodynamically allowed against actually happening
 * enthalpy      vs  internal energy   -- at constant pressure against constant volume
 * Kc            vs  Kp                -- concentrations against partial pressures, related by (RT)^dn
 * rate constant vs  rate              -- a property of the reaction against how fast it is going now
 * order         vs  stoichiometry     -- what the rate depends on against what the equation says
 * cell potential vs  what a cell gives -- at standard conditions against under load
 * ```
 *
 * Pure. No network, no clock, no storage.
 */

import { GAS_CONSTANT, FARADAY_CONSTANT, ABSOLUTE_ZERO_CELSIUS } from './emConstants.ts'

export interface ReactionError {
  error: 'invalid-argument' | 'not-finite' | 'out-of-range' | 'no-solution' | 'not-converged' | 'outside-model' | 'too-many'
  message: string
}

export const isReactionError = (value: unknown): value is ReactionError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: ReactionError['error'], message: string): ReactionError => ({ error, message })

const finite = (value: number): boolean => Number.isFinite(value)

export const REACTION_LIMITS = Object.freeze({ species: 64, samples: 4000, iterations: 200 })

/** The standard state everything below is referred to, stated because a value without it means nothing. */
export const STANDARD_STATE = Object.freeze({
  temperature: 298.15,
  pressure: 100000,
  concentration: 1,
  note: 'Standard state: 298.15 K, 100 kPa, and 1 M for anything in solution. A thermodynamic value quoted without its standard state is not a number anybody can use. Note that older tables use 101.325 kPa, which changes values slightly.'
})

// ---------------------------------------------------------------- thermochemistry

export interface ThermochemistryReport {
  /** kJ/mol. Negative releases heat. */
  enthalpyChange: number
  /** J/(mol·K). */
  entropyChange: number | null
  /** kJ/mol. Negative means thermodynamically allowed. */
  gibbsChange: number | null
  /** Whether it is thermodynamically allowed at this temperature — which is not the same as fast. */
  spontaneous: boolean | null
  /** Kelvin. Where the sign of the Gibbs change flips, when it does. */
  crossoverTemperature: number | null
  /** Which term is driving it. */
  drivenBy: 'enthalpy' | 'entropy' | 'both' | 'neither' | 'unknown'
  exothermic: boolean
  temperature: number
  /** The equilibrium constant this Gibbs change implies. */
  equilibriumConstant: number | null
  /** Each species' contribution, so the sum is arguable. */
  contributions: readonly { formula: string; coefficient: number; side: 'reactant' | 'product'; enthalpyContribution: number; entropyContribution: number | null }[]
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Enthalpy, entropy and Gibbs free energy for a reaction, from formation values by Hess's law.
 *
 * Hess's law is what makes this possible: enthalpy is a state function, so the change depends only on where you start
 * and end and not on the route. That is why a table of formation enthalpies lets you compute any reaction between
 * the substances in it, including ones nobody has ever run.
 *
 * The crossover temperature is the useful output. A reaction with positive enthalpy and positive entropy is
 * spontaneous above a particular temperature and not below it, and that temperature is where the two terms balance.
 */
export function thermochemistry(input: {
  /** kJ/mol for formation enthalpy, J/(mol·K) for entropy. */
  reactants: readonly { formula: string; coefficient?: number; formationEnthalpy: number; entropy?: number }[]
  products: readonly { formula: string; coefficient?: number; formationEnthalpy: number; entropy?: number }[]
  /** Kelvin. */
  temperature?: number
}): ThermochemistryReport | ReactionError {
  const { reactants, products } = input
  if (reactants.length === 0 || products.length === 0) {
    return fail('invalid-argument', 'A reaction needs at least one species on each side.')
  }
  if (reactants.length + products.length > REACTION_LIMITS.species) {
    return fail('too-many', `That is more than the ${REACTION_LIMITS.species} species this handles.`)
  }
  const temperature = input.temperature ?? STANDARD_STATE.temperature
  if (!finite(temperature) || temperature <= 0) {
    return fail('out-of-range', `The temperature is in kelvin and has to be above zero. If this was Celsius, add ${(-ABSOLUTE_ZERO_CELSIUS).toFixed(2)}.`)
  }

  let enthalpy = 0
  let entropy = 0
  let haveEntropy = true
  const contributions: ThermochemistryReport['contributions'][number][] = []

  for (const [side, list] of [['reactant', reactants], ['product', products]] as const) {
    const sign = side === 'product' ? 1 : -1
    for (const [i, one] of list.entries()) {
      const coefficient = one.coefficient ?? 1
      if (!finite(coefficient) || coefficient <= 0) {
        return fail('invalid-argument', `${side} ${i + 1} has a coefficient of ${coefficient}; it has to be greater than zero.`)
      }
      if (!finite(one.formationEnthalpy)) return fail('not-finite', `${one.formula} has a formation enthalpy that is not finite.`)
      enthalpy += sign * coefficient * one.formationEnthalpy
      if (one.entropy === undefined) {
        haveEntropy = false
      } else {
        if (!finite(one.entropy)) return fail('not-finite', `${one.formula} has an entropy that is not finite.`)
        if (one.entropy < 0) {
          return fail(
            'invalid-argument',
            `${one.formula} has a negative standard entropy. Absolute entropies are positive by the third law — a negative value usually means a formation entropy was given by mistake, which is a different quantity.`
          )
        }
        entropy += sign * coefficient * one.entropy
      }
      contributions.push({
        formula: one.formula,
        coefficient,
        side,
        enthalpyContribution: sign * coefficient * one.formationEnthalpy,
        entropyContribution: one.entropy === undefined ? null : sign * coefficient * one.entropy
      })
    }
  }

  const warnings: string[] = []
  if (!haveEntropy) {
    warnings.push(
      'Not every species has an entropy, so no entropy change, Gibbs free energy or spontaneity can be reported. Enthalpy alone does not decide whether a reaction happens — an endothermic reaction can be spontaneous if it increases entropy enough, which is how ice melts.'
    )
  }

  const gibbs = haveEntropy ? enthalpy - (temperature * entropy) / 1000 : null
  const crossover = haveEntropy && entropy !== 0 ? (enthalpy * 1000) / entropy : null
  const equilibriumConstant = gibbs === null ? null : Math.exp((-gibbs * 1000) / (GAS_CONSTANT * temperature))

  let drivenBy: ThermochemistryReport['drivenBy'] = 'unknown'
  if (haveEntropy) {
    const enthalpyFavourable = enthalpy < 0
    const entropyFavourable = entropy > 0
    drivenBy =
      enthalpyFavourable && entropyFavourable
        ? 'both'
        : enthalpyFavourable
          ? 'enthalpy'
          : entropyFavourable
            ? 'entropy'
            : 'neither'
  }

  if (crossover !== null && crossover > 0 && drivenBy !== 'both' && drivenBy !== 'neither') {
    warnings.push(
      `The sign of the Gibbs change flips at ${crossover.toFixed(1)} K. ${drivenBy === 'entropy' ? `Below that this reaction does not go; above it, it does — entropy is driving it and needs a high temperature to win.` : `Above that this reaction stops going — enthalpy is driving it and heat works against it.`}`
    )
  }
  if (gibbs !== null && gibbs < 0) {
    warnings.push(
      'A negative Gibbs change means thermodynamically allowed, not fast. Diamond turning to graphite has a negative Gibbs change at room temperature and takes longer than the age of the universe — spontaneity says nothing about rate.'
    )
  }
  if (equilibriumConstant !== null && (equilibriumConstant > 1e15 || equilibriumConstant < 1e-15)) {
    warnings.push(
      `The implied equilibrium constant is ${equilibriumConstant.toExponential(2)}, which is far enough from 1 that the reaction goes essentially to completion in one direction. Treat it as irreversible rather than reading the number literally.`
    )
  }

  return {
    enthalpyChange: enthalpy,
    entropyChange: haveEntropy ? entropy : null,
    gibbsChange: gibbs,
    spontaneous: gibbs === null ? null : gibbs < 0,
    crossoverTemperature: crossover !== null && crossover > 0 ? crossover : null,
    drivenBy,
    exothermic: enthalpy < 0,
    temperature,
    equilibriumConstant,
    contributions: Object.freeze(contributions),
    notes: Object.freeze([
      `Enthalpy change ${enthalpy.toFixed(3)} kJ/mol — ${enthalpy < 0 ? 'exothermic, so it releases heat' : 'endothermic, so it absorbs heat'}.`,
      "By Hess's law, the change is the sum of formation enthalpies of the products less those of the reactants. Enthalpy is a state function, so the route does not matter — which is why a table of formation values covers reactions nobody has run.",
      gibbs === null
        ? 'Give an entropy for every species to get the Gibbs free energy, which is what decides whether the reaction is allowed.'
        : `Gibbs change ${gibbs.toFixed(3)} kJ/mol at ${temperature} K, so it is ${gibbs < 0 ? 'thermodynamically allowed' : 'not thermodynamically allowed'}. Driven by ${drivenBy}.`,
      equilibriumConstant === null
        ? ''
        : `That corresponds to an equilibrium constant of ${equilibriumConstant.toExponential(4)}. A Gibbs change of -5.7 kJ/mol is a constant of 10, and every further -5.7 multiplies it by ten again.`,
      STANDARD_STATE.note
    ].filter((one) => one.length > 0)),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- equilibrium

export interface EquilibriumReport {
  /** The equilibrium constant used. */
  constant: number
  /** How far the reaction went, in the units of the concentrations given. */
  extent: number
  species: readonly {
    formula: string
    coefficient: number
    side: 'reactant' | 'product'
    initial: number
    change: number
    equilibrium: number
  }[]
  /** The reaction quotient at the start, which says which way it will go. */
  initialQuotient: number | null
  goes: 'forward' | 'backward' | 'already at equilibrium'
  /** What the small-change approximation would have given, and whether it was adequate. */
  approximationAdequate: boolean
  approximateExtent: number | null
  /** How close the solved answer comes to satisfying the constant. */
  residual: number
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Solve an equilibrium from an ICE table by finding the extent of reaction numerically.
 *
 * Solved rather than approximated. The usual shortcut assumes the change is small against the starting amounts, which
 * holds for a very small constant and fails silently otherwise — it produces a change larger than the amount
 * available, which means a negative concentration that nobody notices. Bisection on the reaction quotient is exact for
 * any stoichiometry and any constant, and the approximation's answer is reported alongside so the difference is
 * visible.
 *
 * The reaction quotient at the start says which way the reaction will go, which is a separate question from where it
 * ends up.
 */
export function equilibrium(input: {
  constant: number
  reactants: readonly { formula: string; coefficient?: number; initial: number }[]
  products: readonly { formula: string; coefficient?: number; initial?: number }[]
}): EquilibriumReport | ReactionError {
  const { constant, reactants, products } = input
  if (!finite(constant) || constant <= 0) return fail('invalid-argument', 'An equilibrium constant has to be greater than zero.')
  if (reactants.length === 0 || products.length === 0) return fail('invalid-argument', 'An equilibrium needs species on both sides.')
  if (reactants.length + products.length > REACTION_LIMITS.species) {
    return fail('too-many', `That is more than the ${REACTION_LIMITS.species} species this handles.`)
  }

  const species: { formula: string; coefficient: number; side: 'reactant' | 'product'; initial: number }[] = []
  for (const [side, list] of [['reactant', reactants], ['product', products]] as const) {
    for (const [i, one] of list.entries()) {
      const coefficient = one.coefficient ?? 1
      if (!finite(coefficient) || coefficient <= 0) return fail('invalid-argument', `${side} ${i + 1} has a coefficient that is not greater than zero.`)
      const initial = one.initial ?? 0
      if (!finite(initial) || initial < 0) return fail('invalid-argument', `${one.formula} has a starting concentration that is negative.`)
      species.push({ formula: one.formula, coefficient, side, initial })
    }
  }

  const reactantSide = species.filter((one) => one.side === 'reactant')
  const productSide = species.filter((one) => one.side === 'product')
  if (reactantSide.every((one) => one.initial === 0) && productSide.every((one) => one.initial === 0)) {
    return fail('no-solution', 'Everything starts at zero, so there is nothing to react and nothing to report.')
  }

  // The reaction quotient at a given extent. Positive extent moves reactants to products.
  const quotientAt = (extent: number): number => {
    let numerator = 1
    let denominator = 1
    for (const one of productSide) {
      const amount = one.initial + one.coefficient * extent
      if (amount <= 0) return 0
      numerator *= Math.pow(amount, one.coefficient)
    }
    for (const one of reactantSide) {
      const amount = one.initial - one.coefficient * extent
      if (amount <= 0) return Number.POSITIVE_INFINITY
      denominator *= Math.pow(amount, one.coefficient)
    }
    return numerator / denominator
  }

  const initialQuotient = quotientAt(0)
  const goes =
    !finite(initialQuotient) || initialQuotient > constant * (1 + 1e-9)
      ? 'backward'
      : initialQuotient < constant * (1 - 1e-9)
        ? 'forward'
        : 'already at equilibrium'

  // The bounds: forward until a reactant runs out, backward until a product does.
  const forwardLimit = Math.min(...reactantSide.map((one) => one.initial / one.coefficient))
  const backwardLimit = productSide.length === 0 ? 0 : Math.min(...productSide.map((one) => one.initial / one.coefficient))

  let low = -backwardLimit * (1 - 1e-12)
  let high = forwardLimit * (1 - 1e-12)
  if (goes === 'already at equilibrium') {
    low = 0
    high = 0
  }

  // Bisection on the quotient, which is monotonic in the extent.
  let extent = 0
  let converged = goes === 'already at equilibrium'
  for (let i = 0; i < REACTION_LIMITS.iterations && !converged; i += 1) {
    extent = (low + high) / 2
    const q = quotientAt(extent)
    if (!finite(q)) {
      high = extent
      continue
    }
    if (Math.abs(q - constant) < constant * 1e-12) {
      converged = true
      break
    }
    if (q < constant) low = extent
    else high = extent
  }
  if (!converged) {
    // Still take the bisected value; the residual below says how good it is.
    extent = (low + high) / 2
  }

  const residual = Math.abs(quotientAt(extent) - constant) / constant
  const warnings: string[] = []
  if (residual > 1e-6) {
    warnings.push(
      `The solved extent leaves the reaction quotient ${(residual * 100).toExponential(2)}% from the constant. That usually means the reaction runs essentially to completion and the equilibrium point is up against a reactant running out.`
    )
  }

  // The small-change approximation, for comparison.
  let approximateExtent: number | null = null
  if (reactantSide.length === 1 && productSide.every((one) => one.initial === 0)) {
    const totalProductOrder = productSide.reduce((sum, one) => sum + one.coefficient, 0)
    const c = reactantSide[0].initial
    const power = Math.pow(reactantSide[0].coefficient, reactantSide[0].coefficient)
    approximateExtent = Math.pow((constant * Math.pow(c, reactantSide[0].coefficient)) / power, 1 / totalProductOrder)
  }
  const approximationAdequate =
    approximateExtent === null || Math.abs(approximateExtent - extent) / Math.max(Math.abs(extent), 1e-30) < 0.05
  if (approximateExtent !== null && !approximationAdequate) {
    warnings.push(
      `The small-change approximation gives an extent of ${approximateExtent.toExponential(4)} against the solved ${extent.toExponential(4)} — out by ${((Math.abs(approximateExtent - extent) / Math.abs(extent)) * 100).toFixed(1)}%. That approximation fails when the constant is not small, and it fails silently by producing a change larger than the amount available.`
    )
  }

  const described = species.map((one) => {
    const change = one.side === 'reactant' ? -one.coefficient * extent : one.coefficient * extent
    return { ...one, change, equilibrium: one.initial + change }
  })

  if (described.some((one) => one.equilibrium < -1e-12)) {
    return fail('no-solution', 'The solved equilibrium leaves a negative concentration, which means no equilibrium exists for these starting amounts and this constant.')
  }

  return {
    constant,
    extent,
    species: Object.freeze(described),
    initialQuotient: finite(initialQuotient) ? initialQuotient : null,
    goes,
    approximationAdequate,
    approximateExtent,
    residual,
    notes: Object.freeze([
      `The reaction proceeds ${goes} to an extent of ${extent.toExponential(5)}.`,
      `The reaction quotient starts at ${finite(initialQuotient) ? initialQuotient.toExponential(4) : 'infinity'} against a constant of ${constant.toExponential(4)}. Comparing those two is how you know which way it will go, which is a different question from where it ends up.`,
      'Solved by bisection on the reaction quotient rather than by the small-change approximation, which fails silently for a constant that is not small — it produces a change larger than the amount available.',
      "Le Chatelier's principle falls out of this: adding a reactant lowers the quotient below the constant, so the reaction runs forward until they match again. It is not a separate rule."
    ]),
    warnings: Object.freeze(warnings)
  }
}

export interface ConstantConversionReport {
  /** Concentration-based. */
  kc: number
  /** Pressure-based. */
  kp: number
  /** The change in moles of gas across the reaction, which is what relates them. */
  deltaMolesGas: number
  temperature: number
  /** Whether they are numerically equal, which happens only when the gas moles do not change. */
  equal: boolean
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Convert between concentration and pressure equilibrium constants.
 *
 * They are equal only when the number of moles of gas does not change across the reaction, and that is worth knowing
 * because they are quoted interchangeably and are not the same number. The factor is (RT) raised to the change in gas
 * moles, so for a reaction going from two moles of gas to one at room temperature they differ by a factor of about
 * 2500.
 */
export function convertConstant(input: {
  kc?: number
  kp?: number
  /** Moles of gas on the product side less moles on the reactant side. */
  deltaMolesGas: number
  /** Kelvin. */
  temperature?: number
  /** Whether pressures are in bar (the modern standard) or atmospheres. */
  pressureUnit?: 'bar' | 'atmospheres'
}): ConstantConversionReport | ReactionError {
  const { deltaMolesGas } = input
  if (!finite(deltaMolesGas) || !Number.isInteger(deltaMolesGas)) {
    return fail('invalid-argument', 'The change in moles of gas is a whole number, positive or negative.')
  }
  const temperature = input.temperature ?? STANDARD_STATE.temperature
  if (!finite(temperature) || temperature <= 0) return fail('out-of-range', 'The temperature is in kelvin and has to be above zero.')

  const given = (['kc', 'kp'] as const).filter((one) => input[one] !== undefined)
  if (given.length !== 1) return fail('invalid-argument', 'Give exactly one of Kc and Kp; the other follows.')
  const value = input[given[0]] as number
  if (!finite(value) || value <= 0) return fail('invalid-argument', 'An equilibrium constant has to be greater than zero.')

  // R in L·bar/(mol·K) or L·atm/(mol·K), matching the pressure unit the constant is expressed in.
  const r = input.pressureUnit === 'atmospheres' ? 0.082057 : 0.0831446
  const factor = Math.pow(r * temperature, deltaMolesGas)
  const kc = given[0] === 'kc' ? value : value / factor
  const kp = given[0] === 'kp' ? value : value * factor

  const warnings: string[] = []
  if (deltaMolesGas !== 0 && Math.abs(Math.log10(factor)) > 2) {
    warnings.push(
      `The two constants differ by a factor of ${factor.toExponential(3)} here. Quoting one as the other would be wrong by that much, and they are routinely quoted interchangeably.`
    )
  }

  return {
    kc,
    kp,
    deltaMolesGas,
    temperature,
    equal: deltaMolesGas === 0,
    notes: Object.freeze([
      `Kc ${kc.toExponential(5)} and Kp ${kp.toExponential(5)} at ${temperature} K, with ${deltaMolesGas} more mole${Math.abs(deltaMolesGas) === 1 ? '' : 's'} of gas on the product side.`,
      deltaMolesGas === 0
        ? 'The gas moles do not change across this reaction, so Kc and Kp are numerically equal. That is the only case in which they are.'
        : `They differ by (RT) to the power ${deltaMolesGas}, which is ${factor.toExponential(4)} here.`,
      `Pressures are in ${input.pressureUnit ?? 'bar'}. Which unit the constant is expressed in changes its numerical value, which is why a Kp without its units is ambiguous.`,
      'Only gases count in this conversion. Solids and pure liquids do not appear in an equilibrium expression at all, because their activity is 1 by definition of the standard state.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- kinetics

export interface RateReport {
  /** The reaction order, as given. */
  order: number
  /** The rate constant, with the units it must have for this order. */
  rateConstant: number
  rateConstantUnits: string
  /** The rate right now, at the concentration given. */
  rate: number | null
  /** The half-life, which depends on concentration for any order but the first. */
  halfLife: number | null
  /** Whether the half-life is a constant for this order. */
  halfLifeIsConstant: boolean
  /** How the concentration falls over time. */
  samples: readonly { time: number; concentration: number; fractionRemaining: number }[]
  /** Seconds. How long to reach a given conversion. */
  timeToConversion: number | null
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * An integrated rate law for a given order, with the units the rate constant must have.
 *
 * The units are a real check, not decoration: a first-order rate constant is in reciprocal seconds and a second-order
 * one in litres per mole per second, and a constant quoted with the wrong units is the wrong order. A half-life being
 * independent of concentration is the signature of a first-order reaction and nothing else, which is why it is
 * reported with whether it is constant.
 */
export function rateLaw(input: {
  /** 0, 1 or 2. Fractional orders occur and are refused here, because their integrated forms differ. */
  order?: number
  rateConstant: number
  /** Molar. */
  initialConcentration: number
  /** Seconds, to plot over. */
  duration?: number
  /** The fraction converted, to find the time for. */
  conversion?: number
  samples?: number
}): RateReport | ReactionError {
  const order = input.order ?? 1
  if (![0, 1, 2].includes(order)) {
    return fail(
      'invalid-argument',
      `Order ${order} is not one this integrates. Zero, first and second order have closed forms; fractional and mixed orders need numerical integration of a specific mechanism, which is a different calculation.`
    )
  }
  const { rateConstant: k, initialConcentration: c0 } = input
  if (!finite(k) || k <= 0) return fail('invalid-argument', 'The rate constant has to be greater than zero.')
  if (!finite(c0) || c0 <= 0) return fail('invalid-argument', 'The starting concentration has to be greater than zero.')

  const units = order === 0 ? 'mol/(L*s)' : order === 1 ? '1/s' : 'L/(mol*s)'
  const halfLife = order === 0 ? c0 / (2 * k) : order === 1 ? Math.LN2 / k : 1 / (k * c0)

  const concentrationAt = (time: number): number => {
    if (order === 0) return Math.max(0, c0 - k * time)
    if (order === 1) return c0 * Math.exp(-k * time)
    return c0 / (1 + k * c0 * time)
  }

  const duration = input.duration ?? halfLife * 5
  if (!finite(duration) || duration <= 0) return fail('invalid-argument', 'The duration has to be greater than zero seconds.')
  const count = Math.round(input.samples ?? 200)
  if (!Number.isInteger(count) || count < 2 || count > REACTION_LIMITS.samples) {
    return fail('invalid-argument', `The sample count has to be between 2 and ${REACTION_LIMITS.samples}.`)
  }

  const samples: RateReport['samples'][number][] = []
  for (let i = 0; i < count; i += 1) {
    const time = (duration * i) / (count - 1)
    const concentration = concentrationAt(time)
    samples.push({ time, concentration, fractionRemaining: concentration / c0 })
  }

  let timeToConversion: number | null = null
  const warnings: string[] = []
  if (input.conversion !== undefined) {
    const x = input.conversion
    if (!finite(x) || x <= 0 || x >= 1) return fail('out-of-range', 'The conversion is a fraction above 0 and below 1.')
    const remaining = 1 - x
    if (order === 0) timeToConversion = (c0 * x) / k
    else if (order === 1) timeToConversion = -Math.log(remaining) / k
    else timeToConversion = x / (k * c0 * remaining)
  }

  if (order === 0) {
    warnings.push(
      `A zero-order reaction runs at a constant rate until the reactant is gone, which happens at ${(c0 / k).toFixed(4)} s. Beyond that the concentration is zero rather than negative, and the rate law stops applying — zero order usually means a saturated catalyst or enzyme, and it stops being zero order when the substrate runs low.`
    )
  }
  if (order === 2) {
    warnings.push(
      `A second-order half-life of ${halfLife.toExponential(4)} s applies only at this starting concentration. Halve the concentration and the half-life doubles, which is why a second-order reaction has a long tail.`
    )
  }

  return {
    order,
    rateConstant: k,
    rateConstantUnits: units,
    rate: order === 0 ? k : order === 1 ? k * c0 : k * c0 * c0,
    halfLife,
    halfLifeIsConstant: order === 1,
    samples: Object.freeze(samples),
    timeToConversion,
    notes: Object.freeze([
      `Order ${order}, rate constant ${k.toExponential(5)} ${units}, half-life ${halfLife.toExponential(5)} s.`,
      `The units of the rate constant are fixed by the order: ${units} for order ${order}. A constant quoted with the wrong units is the wrong order, which is a useful check on a number from a paper.`,
      order === 1
        ? 'A half-life independent of concentration is the signature of first order and of nothing else. That is why radioactive decay and first-order chemistry share the same arithmetic.'
        : `The half-life here depends on the starting concentration, so it is not a property of the reaction. Only first order gives a concentration-independent half-life.`,
      'A rate law is found by experiment, not read off the balanced equation. The order need not match any stoichiometric coefficient, and when it does that is a fact about the mechanism rather than about the equation.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

export interface ArrheniusReport {
  /** kJ/mol. */
  activationEnergy: number
  /** The pre-exponential factor, in whatever units the rate constant has. */
  preExponential: number
  /** The rate constant at the temperature asked about. */
  rateConstant: number
  temperature: number
  /** The fraction of collisions with enough energy, which is what the exponential is. */
  fractionEnergetic: number
  /** How much faster the reaction goes for a ten-degree rise, which is the rule of thumb this replaces. */
  tenDegreeFactor: number
  /** Two-point form: the constant at a second temperature. */
  atOtherTemperature: { temperature: number; rateConstant: number; ratio: number } | null
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * The Arrhenius equation, with the ten-degree rule it replaces computed rather than recited.
 *
 * "A reaction roughly doubles for every ten degrees" is a rule of thumb that is true for an activation energy around
 * 50 kJ/mol at room temperature and wrong elsewhere — for 20 kJ/mol it is a factor of 1.3 and for 100 kJ/mol it is
 * nearly 4. The actual factor is computed here, which is more useful than the rule and no harder.
 *
 * The exponential term is the fraction of collisions carrying enough energy, and at room temperature with a typical
 * activation energy that fraction is around 10⁻⁹ — which is why most reactions need heating, a catalyst, or both.
 */
export function arrhenius(input: {
  /** kJ/mol. */
  activationEnergy?: number
  preExponential?: number
  /** Kelvin. */
  temperature: number
  /** A measured rate constant at that temperature, to find the pre-exponential factor. */
  rateConstant?: number
  /** A second temperature and constant, to find the activation energy from two points. */
  secondTemperature?: number
  secondRateConstant?: number
}): ArrheniusReport | ReactionError {
  const { temperature } = input
  if (!finite(temperature) || temperature <= 0) return fail('out-of-range', 'The temperature is in kelvin and has to be above zero.')

  let activationEnergy: number
  let preExponential: number
  let rateConstant: number

  if (input.secondTemperature !== undefined && input.secondRateConstant !== undefined && input.rateConstant !== undefined) {
    // The two-point form solves for the activation energy from two measurements.
    const t2 = input.secondTemperature
    const k1 = input.rateConstant
    const k2 = input.secondRateConstant
    for (const [name, value] of [['secondTemperature', t2], ['rateConstant', k1], ['secondRateConstant', k2]] as const) {
      if (!finite(value) || value <= 0) return fail('invalid-argument', `"${name}" has to be greater than zero.`)
    }
    if (Math.abs(t2 - temperature) < 1e-9) {
      return fail(
        'no-solution',
        'The two temperatures are the same, so there is no slope to fit. The two-point form needs two different temperatures, and the further apart they are the better the fit.'
      )
    }
    activationEnergy = ((GAS_CONSTANT * Math.log(k2 / k1)) / (1 / temperature - 1 / t2)) / 1000
    preExponential = k1 / Math.exp((-activationEnergy * 1000) / (GAS_CONSTANT * temperature))
    rateConstant = k1
  } else if (input.activationEnergy !== undefined) {
    activationEnergy = input.activationEnergy
    if (!finite(activationEnergy)) return fail('not-finite', 'The activation energy has to be a finite number.')
    if (input.preExponential !== undefined) {
      preExponential = input.preExponential
      if (!finite(preExponential) || preExponential <= 0) return fail('invalid-argument', 'The pre-exponential factor has to be greater than zero.')
      rateConstant = preExponential * Math.exp((-activationEnergy * 1000) / (GAS_CONSTANT * temperature))
    } else if (input.rateConstant !== undefined) {
      rateConstant = input.rateConstant
      if (!finite(rateConstant) || rateConstant <= 0) return fail('invalid-argument', 'The rate constant has to be greater than zero.')
      preExponential = rateConstant / Math.exp((-activationEnergy * 1000) / (GAS_CONSTANT * temperature))
    } else {
      return fail('invalid-argument', 'With an activation energy, give either the pre-exponential factor or a measured rate constant.')
    }
  } else {
    return fail(
      'invalid-argument',
      'Give an activation energy, or two temperatures with their rate constants to find one. Two points fix the slope and that slope is the activation energy.'
    )
  }

  const fraction = Math.exp((-activationEnergy * 1000) / (GAS_CONSTANT * temperature))
  const tenDegrees = Math.exp(((activationEnergy * 1000) / GAS_CONSTANT) * (1 / temperature - 1 / (temperature + 10)))

  let atOther: ArrheniusReport['atOtherTemperature'] = null
  if (input.secondTemperature !== undefined) {
    const t2 = input.secondTemperature
    if (finite(t2) && t2 > 0) {
      const k2 = preExponential * Math.exp((-activationEnergy * 1000) / (GAS_CONSTANT * t2))
      atOther = { temperature: t2, rateConstant: k2, ratio: k2 / rateConstant }
    }
  }

  const warnings: string[] = []
  if (activationEnergy < 0) {
    warnings.push(
      'The activation energy came out negative, which means the reaction goes slower when heated. That happens for some multi-step and enzyme reactions and it means the Arrhenius form is not describing a single elementary step here.'
    )
  }
  if (activationEnergy > 400) {
    warnings.push(`An activation energy of ${activationEnergy.toFixed(0)} kJ/mol is higher than most covalent bonds. Check the units — this equation takes kJ/mol and a value in J/mol would look like this.`)
  }
  if (fraction < 1e-20 && fraction > 0) {
    warnings.push(
      `Only ${fraction.toExponential(2)} of collisions carry enough energy at this temperature. That is why most reactions need heat or a catalyst: a catalyst lowers the activation energy, and a modest reduction changes this fraction by orders of magnitude.`
    )
  }

  return {
    activationEnergy,
    preExponential,
    rateConstant,
    temperature,
    fractionEnergetic: fraction,
    tenDegreeFactor: tenDegrees,
    atOtherTemperature: atOther,
    notes: Object.freeze([
      `Activation energy ${activationEnergy.toFixed(3)} kJ/mol, pre-exponential ${preExponential.toExponential(4)}, rate constant ${rateConstant.toExponential(5)} at ${temperature} K.`,
      `The exponential term is ${fraction.toExponential(4)} — the fraction of collisions carrying enough energy. It is that small number, not the collision rate, that makes most reactions slow.`,
      `A ten-degree rise multiplies the rate by ${tenDegrees.toFixed(3)} here. The "reactions double every ten degrees" rule happens to be right for about 50 kJ/mol at room temperature and is wrong elsewhere, so the actual factor is computed.`,
      atOther === null
        ? 'Give a second temperature to see the rate constant there.'
        : `At ${atOther.temperature} K the constant is ${atOther.rateConstant.toExponential(5)}, a factor of ${atOther.ratio.toExponential(4)} different.`
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- electrochemistry

export interface CellReport {
  /** Volts at standard conditions. */
  standardPotential: number
  /** Volts under the conditions given. */
  cellPotential: number
  /** How many electrons transfer. */
  electrons: number
  /** kJ/mol. Negative for a spontaneous cell. */
  gibbsChange: number
  /** The equilibrium constant this implies, which is usually enormous. */
  equilibriumConstant: number
  /** Whether it runs on its own or needs driving. */
  spontaneous: boolean
  /** The reaction quotient used. */
  reactionQuotient: number
  temperature: number
  /** How much the concentrations shifted the potential from standard. */
  nernstShift: number
  /** How many volts a 59 mV per decade rule would give, for comparison at 25 °C. */
  millivoltsPerDecade: number
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * A cell potential by the Nernst equation, with the standard value alongside.
 *
 * The shift from standard is usually small — 59 mV per factor of ten in the quotient at room temperature, divided by
 * the electron count — and that smallness is the useful fact: concentration changes barely move a cell potential,
 * which is why a battery holds its voltage until it is nearly flat and then drops suddenly.
 *
 * The implied equilibrium constant is reported because it is usually enormous. A cell potential of one volt with two
 * electrons corresponds to a constant of 10³⁴, which is why a spontaneous electrochemical reaction goes essentially
 * to completion.
 */
export function cellPotential(input: {
  /** Volts. The reduction potential of the cathode half-reaction. */
  cathodePotential: number
  /** Volts. The reduction potential of the anode half-reaction, as tabulated — not reversed. */
  anodePotential: number
  /** How many electrons the balanced cell reaction transfers. */
  electrons: number
  /** The reaction quotient, if not at standard conditions. */
  reactionQuotient?: number
  /** Kelvin. */
  temperature?: number
}): CellReport | ReactionError {
  const { cathodePotential, anodePotential, electrons } = input
  for (const [name, value] of [['cathodePotential', cathodePotential], ['anodePotential', anodePotential]] as const) {
    if (!finite(value)) return fail('not-finite', `"${name}" has to be a finite number.`)
    if (Math.abs(value) > 6) {
      return fail('out-of-range', `A reduction potential of ${value} V is outside anything tabulated; the range runs from about -3 to +3 V.`)
    }
  }
  if (!Number.isInteger(electrons) || electrons < 1) {
    return fail('invalid-argument', 'The electron count is a whole number of at least 1, taken from the balanced cell reaction.')
  }
  const temperature = input.temperature ?? STANDARD_STATE.temperature
  if (!finite(temperature) || temperature <= 0) return fail('out-of-range', 'The temperature is in kelvin and has to be above zero.')
  const quotient = input.reactionQuotient ?? 1
  if (!finite(quotient) || quotient <= 0) return fail('invalid-argument', 'A reaction quotient has to be greater than zero.')

  // Cathode less anode, both as tabulated reduction potentials. Reversing the anode by hand and then subtracting is
  // the commonest sign error in the subject.
  const standard = cathodePotential - anodePotential
  const shift = -((GAS_CONSTANT * temperature) / (electrons * FARADAY_CONSTANT)) * Math.log(quotient)
  const potential = standard + shift
  const gibbs = (-electrons * FARADAY_CONSTANT * potential) / 1000
  const constant = Math.exp((electrons * FARADAY_CONSTANT * standard) / (GAS_CONSTANT * temperature))
  const perDecade = ((GAS_CONSTANT * temperature) / (electrons * FARADAY_CONSTANT)) * Math.LN10 * 1000

  const warnings: string[] = []
  if (standard < 0) {
    warnings.push(
      `The standard potential is ${standard.toFixed(4)} V, so this cell does not run on its own — it needs driving, which makes it an electrolytic cell rather than a galvanic one. If that is not what was meant, the two half-cells are the wrong way round.`
    )
  }
  if (constant > 1e30) {
    warnings.push(
      `The implied equilibrium constant is ${constant.toExponential(2)}. That is not a number to read literally: it means the reaction goes to completion, and any calculation treating it as a genuine equilibrium will be dominated by rounding.`
    )
  }
  if (Math.abs(shift) > Math.abs(standard) * 0.5 && standard !== 0) {
    warnings.push(
      `The concentration shift of ${shift.toFixed(4)} V is more than half the standard potential, which takes a quotient of ${quotient.toExponential(2)}. Concentration barely moves a cell potential normally, so a shift this large means an extreme concentration ratio.`
    )
  }

  return {
    standardPotential: standard,
    cellPotential: potential,
    electrons,
    gibbsChange: gibbs,
    equilibriumConstant: constant,
    spontaneous: potential > 0,
    reactionQuotient: quotient,
    temperature,
    nernstShift: shift,
    millivoltsPerDecade: perDecade,
    notes: Object.freeze([
      `Standard potential ${standard.toFixed(4)} V, actual ${potential.toFixed(4)} V at a quotient of ${quotient.toExponential(3)} and ${temperature} K.`,
      'Cathode potential less anode potential, both as tabulated reduction potentials. Reversing the anode by hand and then subtracting is the commonest sign error in the subject, and this does not do it.',
      `${perDecade.toFixed(2)} mV per factor of ten in the quotient with ${electrons} electron${electrons === 1 ? '' : 's'}. That is the 59 mV rule, divided by the electron count — and its smallness is why a battery holds its voltage until it is nearly flat and then falls off a cliff.`,
      `The Gibbs change is ${gibbs.toFixed(2)} kJ/mol and the implied equilibrium constant ${constant.toExponential(4)}. A volt is worth a lot of chemistry.`,
      'This is thermodynamics, not performance. A real cell under load loses voltage to internal resistance and to the overpotential needed to make the electrode reactions actually go, and neither is in this calculation.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

export interface ElectrolysisReport {
  /** Moles of substance deposited or dissolved. */
  moles: number
  /** Grams, when a molar mass was given. */
  mass: number | null
  /** Coulombs passed. */
  charge: number
  /** Seconds needed, when a target mass was given instead. */
  time: number | null
  /** How many electrons per formula unit. */
  electrons: number
  /** Litres of gas at standard conditions, for a gaseous product. */
  gasLitres: number | null
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Faraday's laws of electrolysis: how much substance a current deposits.
 *
 * The electron count per formula unit is the part that gets forgotten, and it changes the answer by a factor of two
 * or three: copper from Cu²⁺ takes two electrons per atom and aluminium from Al³⁺ takes three, so the same charge
 * deposits half as many moles of aluminium per unit of charge as it would if aluminium were singly charged. It is an
 * explicit argument here rather than something assumed.
 */
export function electrolysis(input: {
  /** Amps. */
  current: number
  /** Seconds. Give this or a target mass. */
  time?: number
  /** Electrons per formula unit deposited. */
  electrons: number
  /** g/mol, for a mass figure. */
  molarMass?: number
  /** Grams wanted, to find the time instead. */
  targetMass?: number
  /** Whether the product is a gas, for a volume figure. */
  isGas?: boolean
  /** The current efficiency, since not all of it goes where you want. */
  efficiency?: number
}): ElectrolysisReport | ReactionError {
  const { current, electrons } = input
  if (!finite(current) || current <= 0) return fail('invalid-argument', 'The current has to be greater than zero amps.')
  if (!Number.isInteger(electrons) || electrons < 1) {
    return fail(
      'invalid-argument',
      'The electrons per formula unit is a whole number of at least 1. Copper from Cu2+ takes two and aluminium from Al3+ takes three, and getting it wrong changes the answer by that factor.'
    )
  }
  const efficiency = input.efficiency ?? 1
  if (!finite(efficiency) || efficiency <= 0 || efficiency > 1) return fail('out-of-range', 'The current efficiency is a fraction above 0 and at most 1.')

  const given = (['time', 'targetMass'] as const).filter((one) => input[one] !== undefined)
  if (given.length !== 1) return fail('invalid-argument', 'Give a time to find the mass, or a target mass to find the time.')

  const warnings: string[] = []
  let time: number
  let moles: number

  if (input.time !== undefined) {
    time = input.time
    if (!finite(time) || time < 0) return fail('invalid-argument', 'The time cannot be negative.')
    moles = (current * time * efficiency) / (electrons * FARADAY_CONSTANT)
  } else {
    const target = input.targetMass as number
    if (input.molarMass === undefined) {
      return fail('invalid-argument', 'Finding the time from a target mass needs the molar mass, to turn grams into moles.')
    }
    if (!finite(target) || target <= 0) return fail('invalid-argument', 'The target mass has to be greater than zero grams.')
    if (!finite(input.molarMass) || input.molarMass <= 0) return fail('invalid-argument', 'The molar mass has to be greater than zero.')
    moles = target / input.molarMass
    time = (moles * electrons * FARADAY_CONSTANT) / (current * efficiency)
  }

  if (efficiency < 1) {
    warnings.push(
      `A current efficiency of ${(efficiency * 100).toFixed(1)}% was applied, so ${((1 - efficiency) * 100).toFixed(1)}% of the charge went somewhere else — usually into electrolysing the solvent. In industrial electrowinning that side reaction is most of the energy bill.`
    )
  } else {
    warnings.push(
      'Full current efficiency was assumed, which no real cell achieves. Some of the charge always goes into a side reaction, most often splitting water, so the real deposit is less than this.'
    )
  }

  return {
    moles,
    mass: input.molarMass === undefined ? null : moles * input.molarMass,
    charge: current * time,
    time: input.targetMass === undefined ? null : time,
    electrons,
    gasLitres: input.isGas === true ? moles * 22.414 : null,
    notes: Object.freeze([
      `${current} A for ${time.toFixed(4)} s passes ${(current * time).toFixed(2)} C and deposits ${moles.toExponential(5)} mol.`,
      `A Faraday is ${FARADAY_CONSTANT.toFixed(0)} C — the charge on a mole of electrons. That one constant is the whole of electrolysis arithmetic.`,
      `Divided by ${electrons} electron${electrons === 1 ? '' : 's'} per formula unit. That divisor is the part most often forgotten and it changes the answer by exactly that factor.`,
      input.isGas === true
        ? 'The gas volume is at standard temperature and pressure, 22.414 L/mol. At room temperature it is 24.5 L/mol, which is 9% more.'
        : 'Set isGas for a gas volume as well as a mass.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

/** Everything a Page should be able to show about what this engine is standing on. */
export const REACTION_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Every thermodynamic result names its standard state. A value quoted without one is not usable, and older tables use a different standard pressure.',
  '"Spontaneous" means thermodynamically allowed and says nothing about rate. Diamond turning to graphite is spontaneous and takes longer than the universe has existed.',
  'The crossover temperature is reported where the Gibbs sign flips, because a reaction allowed at 1000 K can be impossible at 300 K.',
  'Equilibrium is solved by bisection on the reaction quotient, not by the small-change approximation, which fails silently by producing a change larger than the amount available.',
  'Kc and Kp are equal only when the moles of gas do not change. The conversion factor is reported because they are quoted interchangeably and are different numbers.',
  'Rate constants carry the units their order requires. A constant with the wrong units is the wrong order.',
  'A rate law is found by experiment and not read off the balanced equation. The order need not match any coefficient.',
  'Only first order gives a half-life independent of concentration. For any other order the half-life is not a property of the reaction.',
  'Cell potentials use tabulated reduction potentials for both half-cells and subtract. Reversing the anode by hand first is the commonest sign error in the subject.',
  'A cell potential is thermodynamics, not performance. Internal resistance and overpotential are not in it.',
  'Electrolysis takes the electrons per formula unit as an explicit argument, and assumes full current efficiency unless told otherwise — which no real cell achieves.'
])
