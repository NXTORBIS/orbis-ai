/**
 * Chemical engineering: balances that must close, reactors that must be sized, and separations that cost trays.
 *
 * The shared chemical-engineering engine for Orbis Pages. A mass balance reports its residual rather than closing
 * itself, reactor sizes come from the integrated design equation rather than a rule of thumb, and a distillation that
 * cannot be done at the reflux asked for is refused with the minimum that would work.
 *
 * ## Why a balance that does not close is reported and not fixed
 *
 * The residual in a mass balance is information. It is usually a stream nobody measured, a leak, or an instrument out
 * of calibration — and adjusting the numbers until they add up destroys exactly the signal that would have found the
 * problem. Every balance here reports the gap and names how large it is relative to the throughput.
 *
 * ## Why the minimum reflux is computed before the stage count
 *
 * Below the minimum reflux ratio a separation is impossible at any number of stages: the operating line touches the
 * equilibrium curve and the stages stop making progress. A stage count computed below that minimum would come back as
 * a finite number and be wrong, so the minimum is found first and a request below it is refused.
 *
 * ## The distinctions this file refuses to blur
 *
 * ```
 * conversion    vs  yield            -- how much reactant went against how much of it became the product wanted
 * selectivity   vs  yield            -- the ratio between products against the amount of one of them
 * space time    vs  residence time   -- reactor volume over feed rate against how long a molecule stays
 * CSTR          vs  PFR              -- perfectly mixed against no mixing, and the size difference between them
 * theoretical   vs  actual stages    -- an equilibrium step against a real tray, related by efficiency
 * minimum reflux vs  optimum reflux  -- where it becomes possible against where it becomes economic
 * ```
 *
 * Pure. No network, no clock, no storage.
 */

export interface ChemEngError {
  error: 'invalid-argument' | 'not-finite' | 'out-of-range' | 'not-balanced' | 'no-solution' | 'impossible' | 'too-many' | 'not-converged'
  message: string
}

export const isChemEngError = (value: unknown): value is ChemEngError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: ChemEngError['error'], message: string): ChemEngError => ({ error, message })

const finite = (value: number): boolean => Number.isFinite(value)

export const CHEMENG_LIMITS = Object.freeze({ streams: 64, components: 32, stages: 500, samples: 4000 })

// ---------------------------------------------------------------- mass balance

export interface BalanceReport {
  /** Total in, out and the gap. */
  totalIn: number
  totalOut: number
  residual: number
  /** The gap as a fraction of the input, which is the figure that says whether it matters. */
  closureError: number
  closes: boolean
  /** Per component, so it is visible which one does not balance. */
  components: readonly {
    component: string
    massIn: number
    massOut: number
    residual: number
    closureError: number
    closes: boolean
  }[]
  /** The component that closes worst, which is where to look first. */
  worstComponent: string | null
  /** Whether a missing stream would explain the whole gap. */
  suggestsMissingStream: boolean
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * A component mass balance, with the residual left visible.
 *
 * The per-component breakdown is the useful part. A total balance that closes while one component does not means a
 * reaction nobody accounted for or a measurement error on one analyser, and those are very different problems from a
 * leak. Closing the books by adjusting numbers destroys exactly that signal.
 */
export function massBalance(input: {
  /** Each stream, with its total flow and its composition as mass fractions. */
  inlets: readonly { label?: string; flow: number; composition: Readonly<Record<string, number>> }[]
  outlets: readonly { label?: string; flow: number; composition: Readonly<Record<string, number>> }[]
  /** The fractional gap that counts as closed. Plant data rarely does better than 2%. */
  tolerance?: number
}): BalanceReport | ChemEngError {
  const { inlets, outlets } = input
  if (inlets.length === 0 || outlets.length === 0) {
    return fail('invalid-argument', 'A balance needs at least one stream in and one out.')
  }
  if (inlets.length + outlets.length > CHEMENG_LIMITS.streams) {
    return fail('too-many', `That is more than the ${CHEMENG_LIMITS.streams} streams this handles.`)
  }
  const tolerance = input.tolerance ?? 0.02
  if (!finite(tolerance) || tolerance < 0 || tolerance >= 1) return fail('out-of-range', 'The tolerance is a fraction from 0 to below 1.')

  const componentNames = new Set<string>()
  const warnings: string[] = []

  const check = (
    list: readonly { label?: string; flow: number; composition: Readonly<Record<string, number>> }[],
    side: string
  ): ChemEngError | null => {
    for (const [i, one] of list.entries()) {
      const label = one.label ?? `${side} ${i + 1}`
      if (!finite(one.flow) || one.flow < 0) return fail('invalid-argument', `"${label}" has a flow that is negative.`)
      let sum = 0
      for (const [name, fraction] of Object.entries(one.composition)) {
        if (!finite(fraction) || fraction < 0) return fail('invalid-argument', `"${label}" has a negative fraction of ${name}.`)
        componentNames.add(name)
        sum += fraction
      }
      if (Object.keys(one.composition).length === 0) {
        return fail('invalid-argument', `"${label}" has no composition. A component balance needs one for every stream.`)
      }
      if (Math.abs(sum - 1) > 0.01) {
        warnings.push(
          `"${label}" has fractions adding to ${sum.toFixed(4)} rather than 1. That is ${sum > 1 ? 'more than the whole stream' : 'an unaccounted remainder'}, and it will show up in the balance as a residual that is really an analysis error.`
        )
      }
    }
    return null
  }

  const badIn = check(inlets, 'inlet')
  if (badIn) return badIn
  const badOut = check(outlets, 'outlet')
  if (badOut) return badOut

  if (componentNames.size > CHEMENG_LIMITS.components) {
    return fail('too-many', `That is ${componentNames.size} components; this handles up to ${CHEMENG_LIMITS.components}.`)
  }

  const totalIn = inlets.reduce((sum, one) => sum + one.flow, 0)
  const totalOut = outlets.reduce((sum, one) => sum + one.flow, 0)
  if (totalIn === 0) return fail('invalid-argument', 'Nothing flows in, so there is nothing to balance.')

  const components = [...componentNames].sort().map((component) => {
    const massIn = inlets.reduce((sum, one) => sum + one.flow * (one.composition[component] ?? 0), 0)
    const massOut = outlets.reduce((sum, one) => sum + one.flow * (one.composition[component] ?? 0), 0)
    const residual = massIn - massOut
    const scale = Math.max(massIn, massOut, totalIn * 1e-9)
    return {
      component,
      massIn,
      massOut,
      residual,
      closureError: scale === 0 ? 0 : Math.abs(residual) / scale,
      closes: scale === 0 || Math.abs(residual) / scale <= tolerance
    }
  })

  const residual = totalIn - totalOut
  const closureError = Math.abs(residual) / totalIn
  const closes = closureError <= tolerance && components.every((one) => one.closes)

  const failing = components.filter((one) => !one.closes)
  const worst = components.length === 0 ? null : components.reduce((best, one) => (one.closureError > best.closureError ? one : best))

  if (!closes) {
    if (closureError <= tolerance && failing.length > 0) {
      warnings.push(
        `The total balance closes to ${(closureError * 100).toFixed(2)}% and ${failing.map((one) => one.component).join(', ')} ${failing.length === 1 ? 'does' : 'do'} not. A total that closes while a component does not means either a reaction nobody accounted for or one analyser out of calibration — not a leak, which would show in the total.`
      )
    } else {
      warnings.push(
        `The balance misses by ${residual.toFixed(4)}, which is ${(closureError * 100).toFixed(2)}% of the ${totalIn.toFixed(4)} flowing in. That residual is information: it is usually a stream nobody measured, a leak, or an instrument out of calibration. Adjusting the numbers until they add up destroys the signal that would find it.`
      )
    }
  }
  if (residual < 0) {
    warnings.push(
      'More comes out than goes in, which mass conservation forbids. Either a stream is missing from the inlets, or an outlet flow is over-read — and the second is far more common.'
    )
  }

  return {
    totalIn,
    totalOut,
    residual,
    closureError,
    closes,
    components: Object.freeze(components),
    worstComponent: worst === null || worst.closes ? null : worst.component,
    suggestsMissingStream: residual > totalIn * tolerance,
    notes: Object.freeze([
      `${totalIn.toFixed(4)} in, ${totalOut.toFixed(4)} out, closing to ${(closureError * 100).toFixed(3)}%.`,
      `Balanced per component as well as in total, across ${components.length} component${components.length === 1 ? '' : 's'}. The per-component figures are where the real information is.`,
      'The residual is reported and never distributed among the streams. A forced balance hides the term that is missing, and in practice that term is the finding.',
      `Anything within ${(tolerance * 100).toFixed(1)}% counts as closed here. Plant instrumentation rarely does better than 2%, and a balance that closes to 0.001% usually means somebody already adjusted it.`
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- reactors

export type ReactorKind = 'batch' | 'cstr' | 'pfr'

export const REACTOR_KINDS: readonly ReactorKind[] = Object.freeze(['batch', 'cstr', 'pfr'])

export const REACTOR_FACTS: Readonly<
  Record<ReactorKind, { label: string; mixing: string; designEquation: string; suits: string }>
> = Object.freeze({
  batch: {
    label: 'Batch',
    mixing: 'Perfectly mixed, and the composition changes with time rather than position.',
    designEquation: 't = C0 * integral(dX / -rA)',
    suits: 'Small volumes, expensive products, and anything where the recipe changes often. Every pharmaceutical process starts here.'
  },
  cstr: {
    label: 'Continuous stirred tank',
    mixing: 'Perfectly mixed, so the whole vessel sits at the outlet composition — which is the lowest concentration in the system.',
    designEquation: 'V = F0 * X / -rA(at outlet)',
    suits: 'Liquid phase, easy temperature control, and reactions that do not need high conversion. Always the largest of the three for the same duty.'
  },
  pfr: {
    label: 'Plug flow',
    mixing: 'No mixing along the flow at all, so the composition changes with position exactly as it would with time in a batch reactor.',
    designEquation: 'V = F0 * integral(dX / -rA)',
    suits: 'Gas phase, high conversion, and anything where a catalyst sits in a tube. Smallest of the three for a positive-order reaction.'
  }
})

export interface ReactorReport {
  kind: ReactorKind
  label: string
  /** m³ for a flow reactor, or seconds for a batch. */
  size: number
  sizeUnit: string
  /** Seconds. Volume over volumetric feed rate. */
  spaceTime: number | null
  conversion: number
  /** How this compares with the other reactor types for the same duty. */
  comparison: readonly { kind: ReactorKind; size: number; timesThisOne: number }[]
  /** How much bigger a CSTR is than a PFR here, which is the classic result. */
  cstrToPfrRatio: number | null
  designEquation: string
  mixing: string
  /** Whether the numerical integration converged well. */
  integrationResidual: number
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Size a reactor from the integrated design equation, with the other two types for comparison.
 *
 * The comparison is the point and it is one of the few genuinely useful general results in the subject: for a
 * positive-order reaction a plug flow reactor is always smaller than a stirred tank for the same conversion, and the
 * gap widens sharply at high conversion. At 90% conversion of a first-order reaction the tank is about four times the
 * volume; at 99% it is over twenty times.
 *
 * The reason is worth stating: a stirred tank operates entirely at its outlet concentration, which is the lowest
 * concentration anywhere in the system, so the whole vessel reacts at the slowest rate.
 */
export function sizeReactor(input: {
  kind?: ReactorKind
  /** mol/(L·s) at unit concentration — the rate constant. */
  rateConstant: number
  /** The reaction order in the limiting reactant. */
  order?: number
  /** mol/L. */
  inletConcentration: number
  /** The fractional conversion wanted. */
  conversion: number
  /** L/s, for a flow reactor. */
  volumetricFlow?: number
}): ReactorReport | ChemEngError {
  const kind = input.kind ?? 'pfr'
  const facts = REACTOR_FACTS[kind]
  if (!facts) return fail('invalid-argument', `"${kind}" is not one of: ${REACTOR_KINDS.join(', ')}.`)
  const { rateConstant: k, inletConcentration: c0, conversion: x } = input
  const order = input.order ?? 1
  if (!finite(k) || k <= 0) return fail('invalid-argument', 'The rate constant has to be greater than zero.')
  if (!finite(c0) || c0 <= 0) return fail('invalid-argument', 'The inlet concentration has to be greater than zero.')
  if (!finite(x) || x <= 0 || x >= 1) {
    return fail(
      'out-of-range',
      'The conversion is a fraction above 0 and below 1. A conversion of exactly 1 needs an infinite reactor for any reaction of positive order, which is the answer rather than a number.'
    )
  }
  if (!finite(order) || order < 0) return fail('invalid-argument', 'The reaction order cannot be negative here.')

  // The rate at a given conversion, for an nth-order reaction in a constant-density liquid.
  const rateAt = (conversion: number): number => k * Math.pow(c0 * (1 - conversion), order)

  // The design integral, by Simpson's rule on a fine grid — accurate and with a residual to report.
  const integrate = (to: number, pieces: number): number => {
    const n = pieces % 2 === 0 ? pieces : pieces + 1
    const h = to / n
    let sum = 1 / rateAt(0)
    for (let i = 1; i < n; i += 1) {
      const at = h * i
      sum += (i % 2 === 1 ? 4 : 2) / rateAt(at)
    }
    sum += 1 / rateAt(to)
    return (h / 3) * sum
  }

  const coarse = integrate(x, 200)
  const fine = integrate(x, 800)
  const residual = Math.abs(fine - coarse) / Math.max(Math.abs(fine), 1e-30)
  if (!finite(fine)) {
    return fail('not-converged', 'The design integral did not come out finite, which happens as the conversion approaches 1 for a positive-order reaction — the reactor size diverges.')
  }

  const flow = input.volumetricFlow
  const molarFeed = flow === undefined ? null : c0 * flow

  const sizeFor = (which: ReactorKind): number => {
    if (which === 'cstr') {
      // A tank runs entirely at the outlet rate, which is the lowest in the system.
      const tau = (c0 * x) / rateAt(x)
      return flow === undefined ? tau : tau * flow
    }
    // Batch gives a time; a PFR gives a volume through the same integral.
    const tau = c0 * fine
    if (which === 'batch') return tau
    return flow === undefined ? tau : tau * flow
  }

  const size = sizeFor(kind)
  const sizeUnit = kind === 'batch' ? 'seconds' : flow === undefined ? 'seconds of space time' : 'litres'

  const comparison = REACTOR_KINDS.map((which) => {
    const other = sizeFor(which)
    return { kind: which, size: other, timesThisOne: size === 0 ? 1 : other / size }
  })
  const cstrSize = sizeFor('cstr')
  const pfrSize = sizeFor('pfr')
  const ratio = pfrSize === 0 ? null : cstrSize / pfrSize

  const warnings: string[] = []
  if (residual > 1e-6) {
    warnings.push(`The design integral changed by ${(residual * 100).toExponential(2)}% between grid resolutions, so treat the size as approximate. That happens near a conversion of 1, where it genuinely diverges.`)
  }
  if (ratio !== null && ratio > 3) {
    warnings.push(
      `A stirred tank would be ${ratio.toFixed(2)} times the volume of a plug flow reactor for this duty. That gap comes from the tank sitting entirely at its outlet concentration — the lowest anywhere in the system — so the whole vessel reacts at the slowest rate. It widens sharply as conversion rises.`
    )
  }
  if (x > 0.99) {
    warnings.push(
      `At ${(x * 100).toFixed(2)}% conversion the size is dominated by the last fraction of a percent. Getting from 99% to 99.9% costs about as much reactor as getting from 0% to 99%, which is why high-conversion processes recycle instead.`
    )
  }
  if (flow === undefined) {
    warnings.push('No volumetric flow was given, so a flow reactor returns its space time in seconds rather than a volume. Multiply by the flow rate to get a volume.')
  }

  return {
    kind,
    label: facts.label,
    size,
    sizeUnit,
    spaceTime: flow === undefined ? size : size / flow,
    conversion: x,
    comparison: Object.freeze(comparison),
    cstrToPfrRatio: ratio,
    designEquation: facts.designEquation,
    mixing: facts.mixing,
    integrationResidual: residual,
    notes: Object.freeze([
      `${facts.label}: ${size.toFixed(4)} ${sizeUnit} for ${(x * 100).toFixed(2)}% conversion of an order-${order} reaction.`,
      `${facts.designEquation}. ${facts.mixing}`,
      ratio === null
        ? ''
        : `A stirred tank is ${ratio.toFixed(3)} times the size of a plug flow reactor here. For a positive-order reaction the tank is always larger, and that is one of the few general results in reactor design.`,
      `Integrated numerically by Simpson's rule, with a residual of ${residual.toExponential(2)} between grid resolutions.`,
      molarFeed === null ? '' : `The molar feed rate is ${molarFeed.toFixed(4)} mol/s.`,
      'This assumes constant density and isothermal operation. A real reactor with a heat of reaction has a temperature profile, which changes the rate constant along it and is a considerably harder problem.'
    ].filter((one) => one.length > 0)),
    warnings: Object.freeze(warnings)
  }
}

export interface ConversionReport {
  conversion: number
  /** How much of the converted reactant became the product wanted. */
  selectivity: number | null
  /** Conversion times selectivity: the fraction of the feed that became the product. */
  yield: number | null
  /** What each stream carries, so the numbers are checkable. */
  reactantIn: number
  reactantOut: number
  productOut: number | null
  /** How much reactant went into something other than the product wanted. */
  lostToByProducts: number | null
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Conversion, selectivity and yield, which are three different numbers people use interchangeably.
 *
 * Conversion is how much reactant disappeared. Selectivity is how much of what disappeared became the thing you
 * wanted. Yield is their product — the fraction of the feed that became the product. A process at 99% conversion and
 * 50% selectivity has a 49.5% yield and is throwing away half its feed, and quoting only the conversion hides that
 * entirely.
 */
export function conversionSelectivity(input: {
  /** Moles or mol/s, consistently. */
  reactantIn: number
  reactantOut: number
  /** The product wanted, in the same units. */
  productOut?: number
  /** Moles of product per mole of reactant, from the stoichiometry. */
  stoichiometricRatio?: number
}): ConversionReport | ChemEngError {
  const { reactantIn, reactantOut } = input
  for (const [name, value] of [['reactantIn', reactantIn], ['reactantOut', reactantOut]] as const) {
    if (!finite(value)) return fail('not-finite', `"${name}" has to be a finite number.`)
    if (value < 0) return fail('invalid-argument', `"${name}" cannot be negative.`)
  }
  if (reactantIn === 0) return fail('invalid-argument', 'Nothing came in, so there is no conversion to report.')
  if (reactantOut > reactantIn) {
    return fail(
      'no-solution',
      `More reactant comes out (${reactantOut}) than goes in (${reactantIn}), which mass conservation forbids. Either a stream is missing or one measurement is wrong.`
    )
  }

  const consumed = reactantIn - reactantOut
  const conversion = consumed / reactantIn
  const ratio = input.stoichiometricRatio ?? 1
  if (!finite(ratio) || ratio <= 0) return fail('invalid-argument', 'The stoichiometric ratio has to be greater than zero.')

  let selectivity: number | null = null
  let yieldValue: number | null = null
  let lost: number | null = null
  const warnings: string[] = []

  if (input.productOut !== undefined) {
    if (!finite(input.productOut) || input.productOut < 0) return fail('invalid-argument', 'The product out cannot be negative.')
    const reactantIntoProduct = input.productOut / ratio
    if (reactantIntoProduct > consumed * (1 + 1e-9)) {
      return fail(
        'no-solution',
        `The product out (${input.productOut}) would need ${reactantIntoProduct.toFixed(6)} of reactant and only ${consumed.toFixed(6)} was consumed. Either the stoichiometric ratio is wrong or one of the measurements is.`
      )
    }
    selectivity = consumed === 0 ? 0 : reactantIntoProduct / consumed
    yieldValue = conversion * selectivity
    lost = consumed - reactantIntoProduct

    if (selectivity < 0.8) {
      warnings.push(
        `Selectivity is ${(selectivity * 100).toFixed(1)}%, so ${((1 - selectivity) * 100).toFixed(1)}% of the reactant that reacted became something else. A high conversion with poor selectivity is a worse process than the reverse, because unconverted reactant can be recycled and by-products usually cannot.`
      )
    }
  } else {
    warnings.push(
      'No product measurement was given, so only conversion can be reported. Conversion on its own says nothing about whether the reactant became what you wanted — that needs selectivity, and the two are routinely confused.'
    )
  }

  if (conversion > 0.99) {
    warnings.push(
      `A conversion of ${(conversion * 100).toFixed(3)}% is expensive to reach. Beyond about 95% the reactor size grows faster than the return, which is why most processes convert partially and recycle the remainder.`
    )
  }

  return {
    conversion,
    selectivity,
    yield: yieldValue,
    reactantIn,
    reactantOut,
    productOut: input.productOut ?? null,
    lostToByProducts: lost,
    notes: Object.freeze([
      `Conversion ${(conversion * 100).toFixed(3)}%${selectivity === null ? '' : `, selectivity ${(selectivity * 100).toFixed(3)}%, yield ${((yieldValue as number) * 100).toFixed(3)}%`}.`,
      'Conversion is how much reactant disappeared. Selectivity is how much of that became the product wanted. Yield is their product — and the three are used interchangeably when they are different numbers.',
      lost === null
        ? 'Give a product measurement for selectivity and yield.'
        : `${lost.toFixed(6)} of reactant became something other than the product. Unconverted reactant can be recycled; by-products generally cannot, which is why selectivity matters more than conversion.`,
      'These are all defined on the limiting reactant. Defined on a different reactant they come out different, which is why a process datasheet says which.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- distillation

export interface DistillationReport {
  /** The relative volatility used. */
  relativeVolatility: number
  /** The minimum number of theoretical stages, at infinite reflux. */
  minimumStages: number
  /** The minimum reflux ratio, below which no number of stages is enough. */
  minimumReflux: number
  /** The reflux ratio asked for, or the minimum times a factor. */
  refluxRatio: number
  /** Theoretical stages at that reflux, by the Gilliland correlation. */
  theoreticalStages: number
  /** Actual trays, allowing for efficiency. */
  actualTrays: number | null
  /** Which stage the feed goes on. */
  feedStage: number
  /** The equilibrium curve and operating lines, for a McCabe-Thiele diagram. */
  equilibriumCurve: readonly { liquid: number; vapour: number }[]
  /** Whether the separation is possible at the reflux asked for. */
  possible: boolean
  /** How much of the feed leaves as distillate. */
  distillateFraction: number
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Distillation stages by Fenske, Underwood and Gilliland, with the minimum reflux found first.
 *
 * Found first because below the minimum reflux the separation is impossible at any number of stages — the operating
 * line touches the equilibrium curve and the stages stop making progress. A stage count computed below that minimum
 * comes back as a finite number and is wrong, so a request below it is refused with the minimum that would work.
 *
 * Relative volatility is the whole difficulty of a separation in one number. Above about 2 it is easy; between 1.1
 * and 1.5 it is a serious column; below 1.05 it is not worth attempting by distillation and something else is needed.
 */
export function distillation(input: {
  /** The ratio of volatilities of the two components. */
  relativeVolatility: number
  /** Mole fractions of the light component. */
  feedComposition: number
  distillateComposition: number
  bottomsComposition: number
  /** The reflux ratio, or a multiple of the minimum. */
  refluxRatio?: number
  refluxAsMultipleOfMinimum?: number
  /** The tray efficiency, for actual trays. */
  trayEfficiency?: number
  /** The feed quality: 1 for saturated liquid, 0 for saturated vapour. */
  feedQuality?: number
  samples?: number
}): DistillationReport | ChemEngError {
  const { relativeVolatility: alpha, feedComposition: zf, distillateComposition: xd, bottomsComposition: xb } = input
  if (!finite(alpha) || alpha <= 1) {
    return fail(
      'impossible',
      `A relative volatility of ${alpha} means the two components are equally volatile or the wrong way round. At exactly 1 they cannot be separated by distillation at all, whatever the column — that is an azeotrope, and it needs a different method.`
    )
  }
  for (const [name, value] of [['feedComposition', zf], ['distillateComposition', xd], ['bottomsComposition', xb]] as const) {
    if (!finite(value)) return fail('not-finite', `"${name}" has to be a finite number.`)
    if (value <= 0 || value >= 1) return fail('out-of-range', `"${name}" is a mole fraction above 0 and below 1.`)
  }
  if (!(xb < zf && zf < xd)) {
    return fail(
      'impossible',
      `The compositions have to run bottoms (${xb}) below feed (${zf}) below distillate (${xd}). Distillation concentrates the light component upward, and these do not describe that.`
    )
  }

  // Fenske: the minimum stages at infinite reflux.
  const minimumStages = Math.log((xd / (1 - xd)) * ((1 - xb) / xb)) / Math.log(alpha)

  // Underwood, for the minimum reflux. The theta root lies between 1 and alpha.
  const q = input.feedQuality ?? 1
  if (!finite(q) || q < 0 || q > 1.5) return fail('out-of-range', 'The feed quality runs from 0 (saturated vapour) to 1 (saturated liquid); above 1 is subcooled.')
  const underwoodFirst = (theta: number): number =>
    (alpha * zf) / (alpha - theta) + (1 - zf) / (1 - theta) - (1 - q)
  let low = 1 + 1e-9
  let high = alpha - 1e-9
  let theta = (low + high) / 2
  for (let i = 0; i < 200; i += 1) {
    theta = (low + high) / 2
    const value = underwoodFirst(theta)
    if (!finite(value)) break
    if (value > 0) low = theta
    else high = theta
  }
  const minimumReflux = (alpha * xd) / (alpha - theta) + (1 - xd) / (1 - theta) - 1

  if (!finite(minimumReflux) || minimumReflux < 0) {
    return fail(
      'no-solution',
      'The minimum reflux came out negative or not finite. That happens when the feed is already better separated than the products asked for, which means no column is needed.'
    )
  }

  const warnings: string[] = []
  let reflux: number
  if (input.refluxRatio !== undefined) {
    reflux = input.refluxRatio
    if (!finite(reflux) || reflux <= 0) return fail('invalid-argument', 'The reflux ratio has to be greater than zero.')
    if (reflux <= minimumReflux) {
      return fail(
        'impossible',
        `A reflux ratio of ${reflux} is at or below the minimum of ${minimumReflux.toFixed(4)}. Below the minimum this separation cannot be done with any number of stages — the operating line touches the equilibrium curve and the stages stop making progress. Use at least ${(minimumReflux * 1.2).toFixed(3)}, which is the usual 1.2 times minimum.`
      )
    }
  } else {
    const multiple = input.refluxAsMultipleOfMinimum ?? 1.3
    if (!finite(multiple) || multiple <= 1) {
      return fail('invalid-argument', 'The multiple of minimum reflux has to be above 1. At exactly 1 the column needs infinite stages.')
    }
    reflux = minimumReflux * multiple
  }

  // Gilliland, for the stages at the operating reflux.
  const xFactor = (reflux - minimumReflux) / (reflux + 1)
  const y = 1 - Math.exp(((1 + 54.4 * xFactor) / (11 + 117.2 * xFactor)) * ((xFactor - 1) / Math.sqrt(xFactor)))
  const theoreticalStages = (minimumStages + y) / (1 - y)
  if (!finite(theoreticalStages) || theoreticalStages < minimumStages) {
    return fail('not-converged', 'The Gilliland correlation did not give a sensible stage count, which happens very close to the minimum reflux where it is not valid.')
  }

  const efficiency = input.trayEfficiency
  let actualTrays: number | null = null
  if (efficiency !== undefined) {
    if (!finite(efficiency) || efficiency <= 0 || efficiency > 1) return fail('out-of-range', 'The tray efficiency is a fraction above 0 and at most 1.')
    actualTrays = Math.ceil(theoreticalStages / efficiency)
    if (efficiency < 0.5) {
      warnings.push(`A tray efficiency of ${(efficiency * 100).toFixed(0)}% is low. Real trays run 50 to 80%, and below that something is wrong with the design rather than with the arithmetic.`)
    }
  } else {
    warnings.push(
      'No tray efficiency was given, so only theoretical stages are reported. A theoretical stage is an equilibrium step and a real tray achieves 50 to 80% of one, so a real column needs noticeably more trays than stages.'
    )
  }

  // Kirkbride, for where the feed goes.
  const distillateFraction = (zf - xb) / (xd - xb)
  const bottomsFraction = 1 - distillateFraction
  const kirkbride = Math.pow(
    ((zf / (1 - zf)) * Math.pow((1 - xd) / xb, 2) * (bottomsFraction / distillateFraction)),
    0.206
  )
  const feedStage = Math.round(theoreticalStages / (1 + kirkbride))

  const count = Math.round(input.samples ?? 100)
  if (!Number.isInteger(count) || count < 2 || count > CHEMENG_LIMITS.samples) {
    return fail('invalid-argument', `The sample count has to be between 2 and ${CHEMENG_LIMITS.samples}.`)
  }
  const equilibriumCurve: DistillationReport['equilibriumCurve'][number][] = []
  for (let i = 0; i < count; i += 1) {
    const liquid = i / (count - 1)
    equilibriumCurve.push({ liquid, vapour: (alpha * liquid) / (1 + (alpha - 1) * liquid) })
  }

  if (alpha < 1.1) {
    warnings.push(
      `A relative volatility of ${alpha} makes this a very difficult separation: ${minimumStages.toFixed(1)} stages at infinite reflux and ${theoreticalStages.toFixed(1)} at this one. Below about 1.05 distillation stops being the right method and extraction or a membrane is worth considering.`
    )
  }
  if (theoreticalStages > 100) {
    warnings.push(`${theoreticalStages.toFixed(0)} theoretical stages is a very tall column. Past about 50 the cost of height starts to outweigh the energy saved by a lower reflux, which is what sets the optimum.`)
  }

  return {
    relativeVolatility: alpha,
    minimumStages,
    minimumReflux,
    refluxRatio: reflux,
    theoreticalStages,
    actualTrays,
    feedStage,
    equilibriumCurve: Object.freeze(equilibriumCurve),
    possible: true,
    distillateFraction,
    notes: Object.freeze([
      `${theoreticalStages.toFixed(2)} theoretical stages at a reflux ratio of ${reflux.toFixed(3)}, against a minimum of ${minimumStages.toFixed(2)} stages at infinite reflux and a minimum reflux of ${minimumReflux.toFixed(3)}.`,
      'Fenske for the minimum stages, Underwood for the minimum reflux, Gilliland for the stages in between. The minimum reflux is found first because below it no number of stages is enough.',
      `Reflux and stages trade against each other: more reflux means fewer stages and more energy. The optimum is usually 1.1 to 1.3 times the minimum, and this used ${(reflux / minimumReflux).toFixed(3)} times.`,
      `The feed goes on about stage ${feedStage} of ${Math.round(theoreticalStages)}, by Kirkbride. ${(distillateFraction * 100).toFixed(1)}% of the feed leaves as distillate.`,
      'Relative volatility is taken as constant, which it is not — it varies along the column with temperature and composition. For a difficult separation that variation matters and a stage-by-stage calculation is needed.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

export interface RaoultReport {
  /** Total pressure over the mixture. */
  totalPressure: number
  /** Each component's partial pressure and vapour composition. */
  components: readonly { label: string; liquidFraction: number; vapourPressure: number; partialPressure: number; vapourFraction: number }[]
  /** The relative volatility of the first two components, which is what a separation depends on. */
  relativeVolatility: number | null
  /** How much the vapour is enriched in the lighter component. */
  enrichment: number | null
  /** Whether the mixture is ideal, which Raoult's law assumes. */
  assumesIdeal: boolean
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Raoult's law: the vapour composition over a liquid mixture.
 *
 * The enrichment is what makes distillation work: the vapour is richer in the more volatile component than the liquid
 * is, and the degree of enrichment is the relative volatility. One stage of vapourising and condensing moves the
 * composition by exactly that factor, which is why a column needs many stages for a small volatility difference.
 *
 * Raoult's law assumes an ideal mixture, where the two components are chemically similar enough not to prefer each
 * other's company. Real mixtures deviate, and the ones that deviate enough form azeotropes that distillation cannot
 * pass — which the law gives no warning of at all.
 */
export function raoult(input: {
  components: readonly { label?: string; liquidFraction: number; vapourPressure: number }[]
}): RaoultReport | ChemEngError {
  const { components } = input
  if (components.length < 2) return fail('invalid-argument', "Raoult's law needs at least two components; one component has no composition to report.")
  if (components.length > CHEMENG_LIMITS.components) return fail('too-many', `That is more than the ${CHEMENG_LIMITS.components} components this handles.`)

  let fractionSum = 0
  for (const [i, one] of components.entries()) {
    if (!finite(one.liquidFraction) || one.liquidFraction < 0) return fail('invalid-argument', `Component ${i + 1} has a negative liquid fraction.`)
    if (!finite(one.vapourPressure) || one.vapourPressure <= 0) return fail('invalid-argument', `Component ${i + 1} has a vapour pressure that is not greater than zero.`)
    fractionSum += one.liquidFraction
  }

  const warnings: string[] = []
  if (Math.abs(fractionSum - 1) > 0.01) {
    warnings.push(
      `The liquid fractions add to ${fractionSum.toFixed(4)} rather than 1, so they were normalised. Fractions that do not add to 1 usually mean a component is missing from the list.`
    )
  }

  const total = components.reduce((sum, one) => sum + (one.liquidFraction / fractionSum) * one.vapourPressure, 0)
  const described = components.map((one, i) => {
    const liquidFraction = one.liquidFraction / fractionSum
    const partial = liquidFraction * one.vapourPressure
    return {
      label: one.label ?? `component ${i + 1}`,
      liquidFraction,
      vapourPressure: one.vapourPressure,
      partialPressure: partial,
      vapourFraction: total === 0 ? 0 : partial / total
    }
  })

  const alpha = components.length >= 2 ? components[0].vapourPressure / components[1].vapourPressure : null
  const enrichment =
    described.length >= 2 && described[0].liquidFraction > 0 ? described[0].vapourFraction / described[0].liquidFraction : null

  if (alpha !== null && Math.abs(alpha - 1) < 0.05) {
    warnings.push(
      `The two components have vapour pressures within 5% of each other, so the relative volatility is about ${alpha.toFixed(4)} and the vapour is barely enriched. Distillation cannot usefully separate this.`
    )
  }

  return {
    totalPressure: total,
    components: Object.freeze(described),
    relativeVolatility: alpha,
    enrichment,
    assumesIdeal: true,
    notes: Object.freeze([
      `Total pressure ${total.toFixed(4)} over the mixture, with the vapour at ${described.map((one) => `${(one.vapourFraction * 100).toFixed(2)}% ${one.label}`).join(', ')}.`,
      enrichment === null
        ? ''
        : `The vapour is ${enrichment.toFixed(4)} times richer in ${described[0].label} than the liquid is. That enrichment, repeated stage by stage, is the whole of how distillation works.`,
      alpha === null ? '' : `The relative volatility of the first two components is ${alpha.toFixed(4)}. Above 2 the separation is easy; below 1.1 it is a serious column.`,
      "Raoult's law assumes an ideal mixture, where neither component prefers its own company. Real mixtures deviate, and the ones that deviate enough form azeotropes that no amount of distillation passes — and the law gives no warning of that at all."
    ].filter((one) => one.length > 0)),
    warnings: Object.freeze(warnings)
  }
}

/** Everything a Page should be able to show about what this engine is standing on. */
export const CHEMENG_ASSUMPTIONS: readonly string[] = Object.freeze([
  'A mass balance reports its residual and never distributes it among the streams. The residual is usually the finding.',
  'Balances are done per component as well as in total, because a total that closes while a component does not means something different from a leak.',
  'Reactor sizes come from the integrated design equation, with a residual between grid resolutions reported.',
  'A stirred tank is always larger than a plug flow reactor for a positive-order reaction, and the ratio is reported because it widens sharply at high conversion.',
  'Reactor sizing assumes constant density and isothermal operation. A real reactor with a heat of reaction has a temperature profile and is a harder problem.',
  'Conversion, selectivity and yield are reported separately, because they are different numbers that get used interchangeably.',
  'Minimum reflux is computed before the stage count, and a reflux below it is refused — no number of stages is enough there.',
  'Theoretical stages and actual trays are different: a real tray achieves 50 to 80% of an equilibrium step.',
  "Relative volatility is taken as constant along a column, which it is not. For a difficult separation a stage-by-stage calculation is needed.",
  "Raoult's law assumes an ideal mixture and gives no warning of the azeotropes that real mixtures form."
])
