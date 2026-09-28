/**
 * Measurements: numbers that know how well they are known.
 *
 * A measurement is not a number. `9.81` and `9.81 ± 0.02 m/s²` support different conclusions, and a calculation that loses
 * the second half produces an answer nobody can defend. So a measurement here carries its unit, its uncertainty, where it
 * came from, and whether it was measured at all -- and arithmetic on measurements propagates all of it.
 *
 * ## The distinctions this file exists to keep
 *
 * ```
 * measured      vs   simulated     vs   derived   vs   assumed
 * uncertainty   vs   a confidence interval
 * precision     vs   accuracy
 * resolution    vs   uncertainty
 * ± as standard vs   ± as a bound
 * ```
 *
 * The provenance one is the most important. A simulated value presented as a measured one is the single most damaging thing
 * a scientific Page can do, so every value here says which it is and nothing merges the two silently.
 *
 * Uncertainty is propagated two ways: analytically for the operations where the formula is exact, and by Monte Carlo when
 * the caller asks for it -- because linear propagation is only an approximation, and for a strongly non-linear function it
 * is the wrong answer rather than a rough one.
 *
 * Pure. No network, no clock, no storage.
 */

import {
  convertQuantity,
  formatQuantity,
  isQuantityError,
  multiplyDimensions,
  parseUnit,
  powerDimension,
  readDimension,
  sameDimension,
  type Quantity,
  type ResolvedUnit
} from './units.ts'
import { DISTRIBUTIONS, isStatisticsError, mean, percentile, randomSource, standardDeviation } from './statistics.ts'

// ---------------------------------------------------------------- provenance

/**
 * Where a value came from.
 *
 * Never inferred. A caller says which, and if a caller does not know then `unknown` is the honest answer -- because
 * guessing `measured` is how a simulation ends up in a results table.
 */
export type Provenance = 'measured' | 'simulated' | 'derived' | 'imported' | 'assumed' | 'unknown'

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  measured: 'measured',
  simulated: 'simulated',
  derived: 'worked out from other values',
  imported: 'from a file',
  assumed: 'assumed',
  unknown: 'of unknown origin'
}

/**
 * What happens to provenance when two values are combined.
 *
 * Anything touching a simulated value is simulated. That is deliberately the strongest rule here: a result that mixes a
 * measurement with a simulation is not a measurement, and calling it one is the failure this whole file guards against.
 */
export function combineProvenance(a: Provenance, b: Provenance): Provenance {
  if (a === 'simulated' || b === 'simulated') return 'simulated'
  if (a === 'unknown' || b === 'unknown') return 'unknown'
  if (a === 'assumed' || b === 'assumed') return 'assumed'
  return 'derived'
}

// ---------------------------------------------------------------- uncertainty

/**
 * What a `±` means.
 *
 * Three different things, routinely written the same way and routinely confused:
 *
 * - `standard` -- one standard uncertainty, the usual scientific convention. About 68% for a normal distribution.
 * - `expanded` -- a standard uncertainty multiplied by a coverage factor, usually 2. About 95%.
 * - `bound` -- the value is somewhere in here and definitely not outside. An instrument specification.
 *
 * Adding a standard uncertainty to a bound as though they were the same quantity is wrong, so they cannot be combined
 * without being converted first.
 */
export type UncertaintyKind = 'standard' | 'expanded' | 'bound'

/** How uncertainty came to be known, which is not the same as how big it is. */
export type UncertaintySource = 'instrument' | 'repeated' | 'stated' | 'propagated' | 'estimated' | 'none'

export interface Uncertainty {
  /** Always non-negative, and always in the same unit as the value it belongs to. */
  value: number
  kind: UncertaintyKind
  /** For `expanded`: what the standard uncertainty was multiplied by. */
  coverageFactor: number
  source: UncertaintySource
}

export const NO_UNCERTAINTY: Uncertainty = Object.freeze({ value: 0, kind: 'standard', coverageFactor: 1, source: 'none' })

export interface MeasurementError {
  error: 'dimension-mismatch' | 'invalid-argument' | 'not-finite' | 'incompatible-uncertainty' | 'no-values'
  message: string
}

export const isMeasurementError = (value: unknown): value is MeasurementError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

/**
 * A standard uncertainty from whatever kind was given.
 *
 * A bound is treated as the half-width of a rectangular distribution, whose standard deviation is the half-width over root
 * three. That conversion is the recommended one and it is stated here because it is a modelling choice: somebody who knows
 * their instrument is not rectangular should say so rather than accept this.
 */
export function asStandard(uncertainty: Uncertainty): number {
  if (uncertainty.value <= 0) return 0
  switch (uncertainty.kind) {
    case 'standard':
      return uncertainty.value
    case 'expanded':
      return uncertainty.coverageFactor > 0 ? uncertainty.value / uncertainty.coverageFactor : uncertainty.value
    case 'bound':
      // A rectangular distribution: every value in the interval equally likely.
      return uncertainty.value / Math.sqrt(3)
  }
}

export const standardUncertainty = (value: number, source: UncertaintySource = 'stated'): Uncertainty =>
  Object.freeze({ value: Math.abs(value), kind: 'standard', coverageFactor: 1, source })

export const expandedUncertainty = (value: number, coverageFactor = 2, source: UncertaintySource = 'stated'): Uncertainty =>
  Object.freeze({ value: Math.abs(value), kind: 'expanded', coverageFactor: Math.max(1e-9, coverageFactor), source })

export const boundUncertainty = (value: number, source: UncertaintySource = 'instrument'): Uncertainty =>
  Object.freeze({ value: Math.abs(value), kind: 'bound', coverageFactor: 1, source })

// ---------------------------------------------------------------- a measurement

export interface Measurement {
  value: number
  unit: ResolvedUnit
  uncertainty: Uncertainty
  provenance: Provenance
  /** Free text: what was measured, or how. Never parsed, only carried and displayed. */
  note: string
  /**
   * The smallest difference the instrument can report.
   *
   * Not the same as uncertainty. A ruler with millimetre marks has 1 mm resolution and an uncertainty larger than that,
   * because reading it is not the only source of error.
   */
  resolution: number | null
}

export interface MeasurementOptions {
  uncertainty?: Uncertainty | number
  provenance?: Provenance
  note?: string
  resolution?: number | null
}

/** A measurement. The unit is required, because a number without one is not a measurement. */
export function measurement(value: number, unitText: string, options: MeasurementOptions = {}): Measurement | MeasurementError {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { error: 'not-finite', message: 'A measurement needs a finite number.' }
  }
  const unit = parseUnit(unitText)
  if ('error' in unit) return { error: 'invalid-argument', message: unit.message }
  const uncertainty =
    typeof options.uncertainty === 'number'
      ? standardUncertainty(options.uncertainty)
      : (options.uncertainty ?? NO_UNCERTAINTY)
  if (!Number.isFinite(uncertainty.value) || uncertainty.value < 0) {
    return { error: 'invalid-argument', message: 'An uncertainty cannot be negative.' }
  }
  return {
    value,
    unit,
    uncertainty,
    // `unknown` rather than `measured`: guessing that a value was measured is how a simulation ends up in a results table.
    provenance: options.provenance ?? 'unknown',
    note: String(options.note ?? '').slice(0, 400),
    resolution: typeof options.resolution === 'number' && options.resolution > 0 ? options.resolution : null
  }
}

/** The measurement as a plain quantity, for the unit engine. Loses the uncertainty, which is why it is explicit. */
export const asQuantity = (one: Measurement): Quantity => ({ value: one.value, unit: one.unit })

/** The relative standard uncertainty, as a fraction. Null when the value is zero, where a relative figure is meaningless. */
export function relativeUncertainty(one: Measurement): number | null {
  if (one.value === 0) return null
  return asStandard(one.uncertainty) / Math.abs(one.value)
}

/** The interval a measurement covers, at its own kind of uncertainty. */
export const interval = (one: Measurement): { low: number; high: number } => ({
  low: one.value - one.uncertainty.value,
  high: one.value + one.uncertainty.value
})

/**
 * Whether two measurements agree.
 *
 * They agree when their intervals overlap at the given coverage. Deliberately not "are they equal": two measurements of the
 * same thing are almost never equal, and asking whether they are is the wrong question.
 */
export function agree(a: Measurement, b: Measurement, coverage = 2): { agree: boolean; separation: number; describe: string } | MeasurementError {
  if (!sameDimension(a.unit.dimension, b.unit.dimension)) {
    return {
      error: 'dimension-mismatch',
      message: `${readDimension(a.unit.dimension)} and ${readDimension(b.unit.dimension)} are not the same kind of thing, so they cannot be compared.`
    }
  }
  const converted = convertQuantity(asQuantity(b), a.unit)
  if (isQuantityError(converted)) return { error: 'dimension-mismatch', message: converted.message }
  // The uncertainty scales with the unit the same way the value does.
  const factor = b.unit.factor / a.unit.factor
  const ub = asStandard(b.uncertainty) * Math.abs(factor)
  const ua = asStandard(a.uncertainty)
  const difference = Math.abs(a.value - (converted as Quantity).value)
  const combined = Math.sqrt(ua * ua + ub * ub)
  // How many combined standard uncertainties apart they are, which is the number that answers the question.
  const separation = combined === 0 ? (difference === 0 ? 0 : Number.POSITIVE_INFINITY) : difference / combined
  const they = separation <= coverage
  return {
    agree: they,
    separation,
    describe: they
      ? `They differ by ${Number(separation.toFixed(2))} combined standard uncertainties, which is within ${coverage}, so they are consistent.`
      : `They differ by ${Number(separation.toFixed(2))} combined standard uncertainties, which is more than ${coverage}, so they are not consistent.`
  }
}

// ---------------------------------------------------------------- analytic propagation

/**
 * Two measurements added.
 *
 * Uncertainties combine in quadrature, which assumes they are independent. That assumption is stated in the note rather
 * than buried: correlated uncertainties combine differently, and adding two readings from the same miscalibrated instrument
 * is exactly the case where quadrature understates the error.
 */
export function addMeasurements(a: Measurement, b: Measurement, correlation = 0): Measurement | MeasurementError {
  if (!sameDimension(a.unit.dimension, b.unit.dimension)) {
    return {
      error: 'dimension-mismatch',
      message: `${readDimension(a.unit.dimension)} cannot be added to ${readDimension(b.unit.dimension)}.`
    }
  }
  if (!Number.isFinite(correlation) || correlation < -1 || correlation > 1) {
    return { error: 'invalid-argument', message: 'A correlation is between -1 and 1.' }
  }
  const converted = convertQuantity(asQuantity(b), a.unit)
  if (isQuantityError(converted)) return { error: 'dimension-mismatch', message: converted.message }
  // The uncertainty is a difference, so it scales by the factor ratio alone -- an offset shifts a value, never a spread.
  const factor = b.unit.factor / a.unit.factor
  const ua = asStandard(a.uncertainty)
  const ub = asStandard(b.uncertainty) * Math.abs(factor)
  return {
    value: a.value + (converted as Quantity).value,
    unit: a.unit,
    uncertainty: standardUncertainty(Math.sqrt(ua * ua + ub * ub + 2 * correlation * ua * ub), 'propagated'),
    provenance: combineProvenance(a.provenance, b.provenance),
    note: correlation === 0 ? 'Uncertainties combined in quadrature, assuming they are independent.' : `Uncertainties combined with a correlation of ${correlation}.`,
    resolution: null
  }
}

export function subtractMeasurements(a: Measurement, b: Measurement, correlation = 0): Measurement | MeasurementError {
  if (!sameDimension(a.unit.dimension, b.unit.dimension)) {
    return {
      error: 'dimension-mismatch',
      message: `${readDimension(b.unit.dimension)} cannot be subtracted from ${readDimension(a.unit.dimension)}.`
    }
  }
  // Converted into a's unit *before* negating: negating first would put an offset unit's zero point on the wrong side.
  const converted = convertMeasurement(b, a.unit)
  if (isMeasurementError(converted)) return converted
  return addMeasurements(a, { ...converted, value: -converted.value }, -correlation)
}

/**
 * Two measurements multiplied.
 *
 * *Relative* uncertainties combine in quadrature, which is the rule that surprises people: multiplying a value with 1%
 * uncertainty by one with 1% gives about 1.4%, not 2%.
 */
export function multiplyMeasurements(a: Measurement, b: Measurement, correlation = 0): Measurement | MeasurementError {
  if (!Number.isFinite(correlation) || correlation < -1 || correlation > 1) {
    return { error: 'invalid-argument', message: 'A correlation is between -1 and 1.' }
  }
  const value = a.value * b.value
  const ra = relativeUncertainty(a)
  const rb = relativeUncertainty(b)
  const relative =
    ra === null || rb === null
      ? null
      : Math.sqrt(ra * ra + rb * rb + 2 * correlation * ra * rb)
  return {
    value,
    unit: {
      display: a.unit.display === '' ? b.unit.display : b.unit.display === '' ? a.unit.display : `${a.unit.display}*${b.unit.display}`,
      dimension: multiplyDimensions(a.unit.dimension, b.unit.dimension),
      factor: a.unit.factor * b.unit.factor,
      offset: 0,
      single: null
    },
    uncertainty:
      relative === null
        ? // One of the values is zero, so a relative uncertainty says nothing. Fall back to the exact first-order term.
          standardUncertainty(
            Math.abs(b.value) * asStandard(a.uncertainty) + Math.abs(a.value) * asStandard(b.uncertainty),
            'propagated'
          )
        : standardUncertainty(Math.abs(value) * relative, 'propagated'),
    provenance: combineProvenance(a.provenance, b.provenance),
    note: 'Relative uncertainties combined in quadrature.',
    resolution: null
  }
}

export function divideMeasurements(a: Measurement, b: Measurement, correlation = 0): Measurement | MeasurementError {
  if (b.value === 0) return { error: 'invalid-argument', message: 'A measurement cannot be divided by zero.' }
  const reciprocal: Measurement = {
    value: 1 / b.value,
    unit: {
      display: b.unit.display === '' ? '' : `1/${b.unit.display}`,
      dimension: powerDimension(b.unit.dimension, -1),
      factor: 1 / b.unit.factor,
      offset: 0,
      single: null
    },
    // d(1/x)/dx = -1/x², so the relative uncertainty is unchanged.
    uncertainty: standardUncertainty(asStandard(b.uncertainty) / (b.value * b.value), 'propagated'),
    provenance: b.provenance,
    note: '',
    resolution: null
  }
  return multiplyMeasurements(a, reciprocal, -correlation)
}

/**
 * A measurement raised to a power.
 *
 * The relative uncertainty is multiplied by the absolute value of the exponent: squaring a value with 2% uncertainty gives
 * 4%, not 2%. This is the step most often dropped, and dropping it understates the error by exactly the factor that matters.
 */
export function powerMeasurement(a: Measurement, exponent: number): Measurement | MeasurementError {
  if (!Number.isFinite(exponent)) return { error: 'invalid-argument', message: 'An exponent has to be a finite number.' }
  if (a.value < 0 && !Number.isInteger(exponent)) {
    return { error: 'invalid-argument', message: 'A negative measurement raised to a fractional power is not a real number.' }
  }
  if (a.value === 0 && exponent < 0) {
    return { error: 'invalid-argument', message: 'Zero raised to a negative power is not defined.' }
  }
  const value = Math.pow(a.value, exponent)
  const relative = relativeUncertainty(a)
  return {
    value,
    unit: {
      display: a.unit.display === '' ? '' : `(${a.unit.display})^${exponent}`,
      dimension: powerDimension(a.unit.dimension, exponent),
      factor: Math.pow(a.unit.factor, exponent),
      offset: 0,
      single: null
    },
    uncertainty: standardUncertainty(relative === null ? 0 : Math.abs(value) * Math.abs(exponent) * relative, 'propagated'),
    provenance: a.provenance === 'measured' ? 'derived' : a.provenance,
    note: `The relative uncertainty is multiplied by ${Math.abs(exponent)}, the size of the exponent.`,
    resolution: null
  }
}

/** A measurement scaled by an exact number -- a constant with no uncertainty of its own. */
export function scaleMeasurement(a: Measurement, factor: number): Measurement | MeasurementError {
  if (!Number.isFinite(factor)) return { error: 'invalid-argument', message: 'A scale factor has to be a finite number.' }
  return {
    ...a,
    value: a.value * factor,
    uncertainty: standardUncertainty(asStandard(a.uncertainty) * Math.abs(factor), 'propagated'),
    provenance: a.provenance === 'measured' ? 'derived' : a.provenance,
    note: 'Scaled by an exact factor, so the relative uncertainty is unchanged.',
    resolution: null
  }
}

/** A measurement in another unit, with its uncertainty and resolution carried across. */
export function convertMeasurement(one: Measurement, target: string | ResolvedUnit): Measurement | MeasurementError {
  const converted = convertQuantity(asQuantity(one), target)
  if (isQuantityError(converted)) return { error: 'dimension-mismatch', message: converted.message }
  const result = converted as Quantity
  // The uncertainty scales with the factor, not the offset: a ± is a difference, and a difference has no offset.
  const factor = one.unit.factor / result.unit.factor
  return {
    ...one,
    value: result.value,
    unit: result.unit,
    uncertainty: { ...one.uncertainty, value: one.uncertainty.value * Math.abs(factor) },
    resolution: one.resolution === null ? null : one.resolution * Math.abs(factor)
  }
}

// ---------------------------------------------------------------- from repeated readings

export interface RepeatedResult {
  measurement: Measurement
  readings: number
  /** The spread of the readings themselves, which is not the uncertainty of their mean. */
  spread: number
  notes: string[]
}

/**
 * A measurement from several readings of the same thing.
 *
 * The uncertainty is the standard error of the mean -- the spread divided by the root of the count -- not the spread. Those
 * are different numbers answering different questions, and using the spread overstates the uncertainty of the average by
 * exactly √n.
 *
 * This captures only the scatter between readings. A systematic error shifts every reading the same way and is invisible
 * here, which the notes say rather than leave implied.
 */
export function fromRepeated(
  readings: readonly number[],
  unitText: string,
  options: { provenance?: Provenance; note?: string; resolution?: number | null } = {}
): RepeatedResult | MeasurementError {
  const usable = readings.filter((one) => typeof one === 'number' && Number.isFinite(one))
  if (usable.length === 0) return { error: 'no-values', message: 'There are no readings here.' }
  const unit = parseUnit(unitText)
  if ('error' in unit) return { error: 'invalid-argument', message: unit.message }

  const centre = mean(usable)
  if (isStatisticsError(centre)) return { error: 'no-values', message: centre.message }

  if (usable.length === 1) {
    return {
      measurement: {
        value: centre,
        unit,
        uncertainty: NO_UNCERTAINTY,
        provenance: options.provenance ?? 'measured',
        note: String(options.note ?? ''),
        resolution: options.resolution ?? null
      },
      readings: 1,
      spread: 0,
      // One reading cannot tell you how much readings vary. Claiming zero uncertainty from it would be claiming certainty.
      notes: [
        'One reading only, so the scatter between readings is unknown. This carries no uncertainty rather than a zero one.'
      ]
    }
  }

  const spread = standardDeviation(usable, 'sample')
  if (isStatisticsError(spread)) return { error: 'no-values', message: spread.message }
  const error = spread / Math.sqrt(usable.length)

  const notes = [
    `From ${usable.length} readings. The uncertainty is the standard error of the mean (${Number(spread.toPrecision(4))} / √${usable.length}), not the spread of the readings.`,
    'This captures only the scatter between readings. A systematic error shifts every reading the same way and does not appear here.'
  ]
  if (readings.length !== usable.length) {
    notes.push(`${readings.length - usable.length} of the readings were not numbers and were left out.`)
  }

  return {
    measurement: {
      value: centre,
      unit,
      uncertainty: standardUncertainty(error, 'repeated'),
      provenance: options.provenance ?? 'measured',
      note: String(options.note ?? '').slice(0, 400),
      resolution: options.resolution ?? null
    },
    readings: usable.length,
    spread,
    notes
  }
}

// ---------------------------------------------------------------- significant figures

/**
 * How many significant figures a number as written carries.
 *
 * Reads the text rather than the value, because the value cannot tell you: `1.50` and `1.5` are the same number and
 * different measurements. A trailing zero after a decimal point is significant; `1500` is genuinely ambiguous and this says
 * so by counting only the digits that must be.
 */
export function significantFigures(text: string): { figures: number; ambiguous: boolean } {
  const trimmed = String(text ?? '').trim()
  const match = /^[+-]?(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(trimmed)
  if (!match) return { figures: 0, ambiguous: false }
  const whole = match[1] ?? ''
  const fraction = match[2]

  if (fraction !== undefined) {
    // A decimal point makes every digit after it count, including trailing zeros.
    const digits = `${whole}${fraction}`.replace(/^0+/, '')
    return { figures: Math.max(1, digits.length || fraction.replace(/^0+/, '').length), ambiguous: false }
  }
  const significant = whole.replace(/^0+/, '')
  const trailingZeros = /0+$/.exec(significant)?.[0].length ?? 0
  return {
    figures: Math.max(1, significant.length - trailingZeros) || 1,
    // `1500` could be two, three or four figures. Scientific notation is how somebody says which.
    ambiguous: trailingZeros > 0 && match[3] === undefined
  }
}

/** A number rounded to a given number of significant figures. */
export function toSignificantFigures(value: number, figures: number): number {
  if (!Number.isFinite(value) || value === 0) return 0
  const count = Math.max(1, Math.min(21, Math.round(figures)))
  return Number(value.toPrecision(count))
}

/**
 * A measurement written the way it should be reported.
 *
 * The uncertainty is rounded to one or two significant figures, and the value is then rounded to the same decimal place --
 * which is the convention, and which stops `9.8123456 ± 0.02` being written as though seven digits were known.
 *
 * Two figures on the uncertainty when its leading digit is 1 or 2, one otherwise. That is the usual rule and it is here
 * rather than left to whoever formats the output.
 */
export function reportMeasurement(one: Measurement): string {
  const u = one.uncertainty.value
  if (u <= 0 || !Number.isFinite(u)) {
    return formatQuantity(asQuantity(one), 10)
  }
  const exponent = Math.floor(Math.log10(Math.abs(u)))
  const leading = Math.floor(Math.abs(u) / Math.pow(10, exponent))
  const figures = leading <= 2 ? 2 : 1
  const roundedUncertainty = toSignificantFigures(u, figures)
  // The decimal place the uncertainty's last significant digit sits at.
  const place = Math.floor(Math.log10(roundedUncertainty)) - (figures - 1)
  const decimals = Math.max(0, -place)
  const value = Number(one.value.toFixed(decimals))
  const shown = decimals > 0 ? value.toFixed(decimals) : String(value)
  const shownUncertainty = decimals > 0 ? roundedUncertainty.toFixed(decimals) : String(roundedUncertainty)
  const marker = one.uncertainty.kind === 'expanded' ? ` (k=${one.uncertainty.coverageFactor})` : one.uncertainty.kind === 'bound' ? ' (bound)' : ''
  return `${shown} ± ${shownUncertainty}${marker}${one.unit.display === '' ? '' : ` ${one.unit.display}`}`
}

/** A measurement with everything about it, for a Page that wants to show provenance beside the number. */
export function describeMeasurement(one: Measurement): string[] {
  const lines = [reportMeasurement(one)]
  lines.push(`Where it came from: ${PROVENANCE_LABEL[one.provenance]}.`)
  if (one.uncertainty.value > 0) {
    const relative = relativeUncertainty(one)
    lines.push(
      `Uncertainty: ${one.uncertainty.kind}${one.uncertainty.kind === 'expanded' ? ` with k=${one.uncertainty.coverageFactor}` : ''}, ${one.uncertainty.source === 'none' ? 'source not stated' : `from ${one.uncertainty.source}`}${relative === null ? '' : `, ${Number((relative * 100).toPrecision(3))}% of the value`}.`
    )
  } else {
    // Said outright, because a missing ± reads as an exact value and almost never is one.
    lines.push('No uncertainty is recorded. That does not mean the value is exact.')
  }
  if (one.resolution !== null) {
    lines.push(`Instrument resolution: ${one.resolution} ${one.unit.display}. Resolution is not uncertainty.`)
  }
  if (one.note !== '') lines.push(one.note)
  return lines
}

// ---------------------------------------------------------------- Monte Carlo propagation

export interface MonteCarloOptions {
  samples?: number
  seed?: number
  /** How each input is distributed. `normal` unless the uncertainty is a bound, where `uniform` is the honest default. */
  distribution?: 'normal' | 'uniform'
  level?: number
}

export interface MonteCarloResult {
  value: number
  uncertainty: Uncertainty
  /** The middle of the sampled results, which differs from the value for a non-linear function -- and that difference is the point. */
  sampledMean: number
  interval: { low: number; high: number; level: number }
  samples: number
  seed: number
  /** How far the analytic estimate and this one disagree, as a ratio. Near one means linear propagation was fine. */
  agreementWithAnalytic: number | null
  notes: string[]
}

/**
 * Uncertainty propagated by sampling rather than by formula.
 *
 * Linear propagation assumes the function is close to straight over the range of the uncertainty. For something like
 * `1/x` near zero, or a power with a large exponent, that assumption fails and the analytic answer is wrong rather than
 * approximate. This samples instead, and reports how far the two disagree so the caller can see whether it mattered.
 *
 * Reproducible: same inputs, same seed, same answer.
 */
export function propagateByMonteCarlo(
  inputs: readonly Measurement[],
  combine: (values: readonly number[]) => number,
  options: MonteCarloOptions = {}
): MonteCarloResult | MeasurementError {
  if (inputs.length === 0) return { error: 'no-values', message: 'There are no inputs to propagate.' }
  const samples = Math.min(200_000, Math.max(100, Math.round(options.samples ?? 20_000)))
  const seed = Math.round(options.seed ?? 1)
  const level = options.level ?? 0.95
  if (!Number.isFinite(level) || level <= 0 || level >= 1) {
    return { error: 'invalid-argument', message: 'A coverage level is a fraction strictly between 0 and 1.' }
  }

  const nominal = combine(inputs.map((one) => one.value))
  if (!Number.isFinite(nominal)) {
    return { error: 'not-finite', message: 'The combination has no finite value at the nominal inputs.' }
  }

  const random = randomSource(seed)
  /** A standard normal from two uniforms, by Box-Muller. */
  const normal = (): number => {
    const u = Math.max(1e-12, random())
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random())
  }

  const drawn: number[] = []
  const values = new Array<number>(inputs.length)
  let rejected = 0
  for (let s = 0; s < samples; s++) {
    for (let i = 0; i < inputs.length; i++) {
      const one = inputs[i]
      const spread = asStandard(one.uncertainty)
      if (spread === 0) {
        values[i] = one.value
        continue
      }
      // A bound is rectangular; anything else is normal unless the caller says otherwise.
      const shape = options.distribution ?? (one.uncertainty.kind === 'bound' ? 'uniform' : 'normal')
      values[i] =
        shape === 'uniform'
          ? one.value + (random() * 2 - 1) * one.uncertainty.value
          : one.value + normal() * spread
    }
    const result = combine(values)
    // A sample the function cannot evaluate is counted, not silently treated as zero.
    if (Number.isFinite(result)) drawn.push(result)
    else rejected += 1
  }

  if (drawn.length < 50) {
    return {
      error: 'not-finite',
      message: `Only ${drawn.length} of ${samples} samples produced a finite value, which is too few to estimate anything from.`
    }
  }

  const sampled = mean(drawn) as number
  const spread = standardDeviation(drawn, 'sample') as number
  const low = percentile(drawn, (1 - level) / 2) as number
  const high = percentile(drawn, 1 - (1 - level) / 2) as number

  // The analytic first-order estimate, for comparison. Central differences on each input.
  let analytic = 0
  let analyticUsable = true
  for (let i = 0; i < inputs.length; i++) {
    const u = asStandard(inputs[i].uncertainty)
    if (u === 0) continue
    const step = Math.max(1e-8, Math.abs(inputs[i].value) * 1e-6)
    const up = [...inputs.map((one) => one.value)]
    const down = [...up]
    up[i] += step
    down[i] -= step
    const a = combine(up)
    const b = combine(down)
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      analyticUsable = false
      break
    }
    const slope = (a - b) / (2 * step)
    analytic += (slope * u) ** 2
  }
  const analyticUncertainty = analyticUsable ? Math.sqrt(analytic) : null

  const notes = [
    `${drawn.length} of ${samples} samples produced a finite value.`,
    `Seed ${seed}: the same inputs and seed give the same answer.`,
    'Each input was sampled independently. Correlated inputs need a different method.'
  ]
  if (rejected > 0) notes.push(`${rejected} samples fell outside where the combination has a value and were left out.`)
  if (analyticUncertainty !== null && analyticUncertainty > 0) {
    const ratio = spread / analyticUncertainty
    if (ratio > 1.2 || ratio < 0.8) {
      notes.push(
        `Linear propagation would have given ${Number(analyticUncertainty.toPrecision(4))}, which is ${Number(ratio.toPrecision(3))} times different. The combination is not close to straight over this range, so the sampled figure is the one to use.`
      )
    } else {
      notes.push('Linear propagation gives about the same answer here, so the combination is close to straight over this range.')
    }
  }
  if (Math.abs(sampled - nominal) > spread * 0.1) {
    notes.push(
      `The middle of the samples (${Number(sampled.toPrecision(6))}) differs from the value at the nominal inputs (${Number(nominal.toPrecision(6))}). For a curved function these are genuinely different, and neither is a mistake.`
    )
  }

  return {
    value: nominal,
    uncertainty: standardUncertainty(spread, 'propagated'),
    sampledMean: sampled,
    interval: { low, high, level },
    samples: drawn.length,
    seed,
    agreementWithAnalytic: analyticUncertainty === null || analyticUncertainty === 0 ? null : spread / analyticUncertainty,
    notes
  }
}

/** The coverage factor for a given level, assuming normality. For turning a standard uncertainty into an expanded one. */
export function coverageFactorFor(level: number): number | MeasurementError {
  if (!Number.isFinite(level) || level <= 0 || level >= 1) {
    return { error: 'invalid-argument', message: 'A coverage level is a fraction strictly between 0 and 1.' }
  }
  // The two-sided normal quantile.
  let low = 0
  let high = 40
  for (let i = 0; i < 200; i++) {
    const middle = (low + high) / 2
    const covered = DISTRIBUTIONS.normal.cumulative(middle, 0, 1) - DISTRIBUTIONS.normal.cumulative(-middle, 0, 1)
    if (covered < level) low = middle
    else high = middle
  }
  return (low + high) / 2
}

/** The assumptions everything here rests on, for a Page that wants to show them. */
export const MEASUREMENT_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Provenance is never inferred. A value whose origin is unknown says so rather than being called measured.',
  'Anything combined with a simulated value is simulated. A result mixing measurement and simulation is not a measurement.',
  'Uncertainties are combined assuming independence unless a correlation is given. Two readings from the same miscalibrated instrument are not independent.',
  'A standard uncertainty, an expanded one and a bound are three different things and are converted before being combined.',
  'Uncertainty from repeated readings is the standard error of the mean, not the spread of the readings.',
  'Repeated readings show scatter only. A systematic error shifts every reading the same way and does not appear.',
  'Resolution is not uncertainty. An instrument that reads to the millimetre is not accurate to the millimetre.',
  'A missing uncertainty does not mean the value is exact.',
  'Linear propagation assumes the combination is straight over the range of the uncertainty. Monte Carlo reports when it is not.'
])
