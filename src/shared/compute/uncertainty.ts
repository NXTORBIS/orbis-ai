/**
 * Uncertainty, error propagation and Monte Carlo.
 *
 * `measurement.ts` holds a measured value and its uncertainty, and combines two of them. This is the layer above: an
 * arbitrary model, an arbitrary number of uncertain inputs, correlation between them, and two genuinely different ways
 * of finding out what the output's uncertainty is.
 *
 * ## The distinctions that are the whole point
 *
 * An **exact** value is not a measurement with small uncertainty. Pi has no uncertainty at all, and giving it one would
 * put a made-up number into every budget it appears in. `exact()` exists so that saying so is easier than not saying it.
 *
 * **Error** is `measured - reference`, and needs a reference. **Uncertainty** is how little is known, and needs none.
 * Nothing here converts one into the other, and `describeError` refuses to run without the reference.
 *
 * **Independence is a claim**, not a default. Every propagation records whether a covariance was supplied; when one was
 * not, the assumption is written into the result rather than left implied.
 *
 * ## First-order versus sampling
 *
 * First-order propagation is `s^2 = J Z J^T`: it linearises the model at the nominal point. That is exactly right for a
 * straight model and quietly wrong for a curved one, and the failure is not a small error -- it is the wrong answer,
 * reported with the same confidence as a right one. So `compareMethods` runs both and says how far apart they are, and
 * `checkAssumptions` looks for the conditions under which the linear answer should not be believed.
 *
 * Nothing in this file decides for the caller which method is correct. It says what each one gives and why they differ.
 */

import { DISTRIBUTIONS, accurateSum, percentile } from './statistics.ts'
import { isUnitError, parseUnit, sameDimension, type ResolvedUnit } from './units.ts'
import { asStandard, combineProvenance, type Provenance, type Uncertainty } from './measurement.ts'

export interface UncertaintyError {
  error: string
  message: string
}

export const isUncertaintyError = (value: unknown): value is UncertaintyError =>
  typeof value === 'object' && value !== null && 'error' in value && 'message' in value

const fail = (error: string, message: string): UncertaintyError => ({ error, message })

/**
 * The ceilings.
 *
 * `samples` is where a request stops being a calculation and starts being a way to make Orbis unresponsive. `inputs` is
 * low deliberately: a first-order propagation costs two model calls per input, and a covariance matrix costs the square.
 */
export const UNCERTAINTY_LIMITS: Readonly<Record<'samples' | 'inputs' | 'quantiles' | 'checkpoints' | 'storedSamples', number>> =
  Object.freeze({
    samples: 1_000_000,
    inputs: 64,
    quantiles: 64,
    checkpoints: 200,
    storedSamples: 100_000
  })

// ---------------------------------------------------------------- distributions

export type DistributionKind = 'exact' | 'uniform' | 'normal' | 'lognormal' | 'triangular' | 'discrete' | 'empirical'

/**
 * How an uncertain input is distributed.
 *
 * Each kind names its own parameters rather than sharing a numeric array, because a `[10, 0.2]` that means one thing for
 * a normal and another for a triangular is a bug waiting for the first person who swaps two arguments.
 */
export type Distribution =
  | { kind: 'exact'; value: number }
  | { kind: 'uniform'; low: number; high: number }
  | { kind: 'normal'; mean: number; standardDeviation: number }
  /** Log-normal in the underlying normal's parameters, which is the form the density is actually written in. */
  | { kind: 'lognormal'; logMean: number; logStandardDeviation: number }
  | { kind: 'triangular'; low: number; peak: number; high: number }
  /** A finite set of outcomes with weights. Weights are normalised on validation, never assumed to sum to one. */
  | { kind: 'discrete'; outcomes: { value: number; weight: number; label?: string }[] }
  /** Observed values resampled with replacement. No shape is fitted, because fitting one would be inventing it. */
  | { kind: 'empirical'; values: number[] }

/** What a validated distribution says about itself. Every field is computed, never declared by the caller. */
export interface DistributionFacts {
  kind: DistributionKind
  mean: number
  variance: number
  /** The support, where it is bounded. `null` on a side means unbounded there. */
  low: number | null
  high: number | null
  discrete: boolean
  describe: string
}

/**
 * Whether a distribution can be sampled at all, and what it implies if so.
 *
 * Refusing here rather than at sampling time matters: a distribution with a negative standard deviation still produces
 * numbers if you let it, and they look like samples.
 */
export function checkDistribution(one: Distribution): DistributionFacts | UncertaintyError {
  const finite = (...values: number[]): boolean => values.every((v) => Number.isFinite(v))
  switch (one.kind) {
    case 'exact':
      if (!finite(one.value)) return fail('invalid-distribution', 'An exact value has to be a finite number.')
      return {
        kind: 'exact',
        mean: one.value,
        variance: 0,
        low: one.value,
        high: one.value,
        discrete: true,
        describe: `exactly ${one.value}`
      }

    case 'uniform':
      if (!finite(one.low, one.high)) return fail('invalid-distribution', 'A uniform range needs two finite bounds.')
      if (one.high <= one.low) {
        return fail('invalid-distribution', 'A uniform range needs its upper bound above its lower bound.')
      }
      return {
        kind: 'uniform',
        mean: (one.low + one.high) / 2,
        variance: (one.high - one.low) ** 2 / 12,
        low: one.low,
        high: one.high,
        discrete: false,
        describe: `uniform between ${one.low} and ${one.high}`
      }

    case 'normal':
      if (!finite(one.mean, one.standardDeviation)) {
        return fail('invalid-distribution', 'A normal distribution needs a finite mean and spread.')
      }
      if (one.standardDeviation < 0) {
        return fail('invalid-distribution', 'A standard deviation cannot be negative.')
      }
      return {
        kind: 'normal',
        mean: one.mean,
        variance: one.standardDeviation ** 2,
        low: null,
        high: null,
        discrete: false,
        describe: `normal, mean ${one.mean}, standard deviation ${one.standardDeviation}`
      }

    case 'lognormal': {
      if (!finite(one.logMean, one.logStandardDeviation)) {
        return fail('invalid-distribution', 'A log-normal distribution needs finite parameters.')
      }
      if (one.logStandardDeviation <= 0) {
        return fail('invalid-distribution', 'A log-normal distribution needs a positive spread on the log scale.')
      }
      const m = Math.exp(one.logMean + one.logStandardDeviation ** 2 / 2)
      const v = (Math.exp(one.logStandardDeviation ** 2) - 1) * Math.exp(2 * one.logMean + one.logStandardDeviation ** 2)
      return {
        kind: 'lognormal',
        mean: m,
        variance: v,
        // Strictly positive, which is usually why it was chosen.
        low: 0,
        high: null,
        discrete: false,
        describe: `log-normal, log-mean ${one.logMean}, log-spread ${one.logStandardDeviation}`
      }
    }

    case 'triangular':
      if (!finite(one.low, one.peak, one.high)) {
        return fail('invalid-distribution', 'A triangular distribution needs three finite numbers.')
      }
      if (!(one.low <= one.peak && one.peak <= one.high) || one.high <= one.low) {
        return fail('invalid-distribution', 'A triangular distribution needs low <= peak <= high, with high above low.')
      }
      return {
        kind: 'triangular',
        mean: (one.low + one.peak + one.high) / 3,
        variance:
          (one.low ** 2 + one.peak ** 2 + one.high ** 2 - one.low * one.peak - one.low * one.high - one.peak * one.high) /
          18,
        low: one.low,
        high: one.high,
        discrete: false,
        describe: `triangular between ${one.low} and ${one.high}, peaking at ${one.peak}`
      }

    case 'discrete': {
      if (one.outcomes.length === 0) return fail('invalid-distribution', 'A discrete distribution needs at least one outcome.')
      if (one.outcomes.length > 4096) return fail('invalid-distribution', 'A discrete distribution may have at most 4096 outcomes.')
      let total = 0
      for (const outcome of one.outcomes) {
        if (!finite(outcome.value, outcome.weight)) {
          return fail('invalid-distribution', 'Every outcome needs a finite value and a finite weight.')
        }
        if (outcome.weight < 0) return fail('invalid-distribution', 'A weight cannot be negative.')
        total += outcome.weight
      }
      if (total <= 0) return fail('invalid-distribution', 'The weights of a discrete distribution have to add to something above zero.')
      let m = 0
      for (const outcome of one.outcomes) m += (outcome.weight / total) * outcome.value
      let v = 0
      for (const outcome of one.outcomes) v += (outcome.weight / total) * (outcome.value - m) ** 2
      const values = one.outcomes.map((o) => o.value)
      return {
        kind: 'discrete',
        mean: m,
        variance: v,
        low: Math.min(...values),
        high: Math.max(...values),
        discrete: true,
        describe: `${one.outcomes.length} discrete outcomes`
      }
    }

    case 'empirical': {
      if (one.values.length < 2) {
        return fail('invalid-distribution', 'An empirical distribution needs at least two observed values.')
      }
      if (one.values.length > 100_000) {
        return fail('invalid-distribution', 'An empirical distribution may hold at most 100,000 observed values.')
      }
      if (!one.values.every((v) => Number.isFinite(v))) {
        return fail('invalid-distribution', 'Every observed value has to be a finite number.')
      }
      const m = accurateSum(one.values) / one.values.length
      let v = 0
      for (const value of one.values) v += (value - m) ** 2
      return {
        kind: 'empirical',
        mean: m,
        // Sample variance: these are observations, not the whole population.
        variance: v / (one.values.length - 1),
        low: Math.min(...one.values),
        high: Math.max(...one.values),
        discrete: true,
        describe: `resampled from ${one.values.length} observed values`
      }
    }
  }
}

// ---------------------------------------------------------------- uncertain quantities

/** Where an uncertainty came from, kept separate from the number so a budget can be grouped by it. */
export type UncertaintyComponent = 'instrument' | 'repeatability' | 'calibration' | 'environment' | 'method' | 'stated' | 'other'

export const COMPONENT_LABEL: Record<UncertaintyComponent, string> = Object.freeze({
  instrument: 'Instrument',
  repeatability: 'Repeatability',
  calibration: 'Calibration',
  environment: 'Environment',
  method: 'Method',
  stated: 'Stated',
  other: 'Other'
})

/** One named contribution to a quantity's uncertainty, before they are combined. */
export interface UncertaintySource {
  id: string
  component: UncertaintyComponent
  /** Standard uncertainty, in the quantity's own unit. */
  standard: number
  /** Systematic components do not average away with repeated measurement; random ones do. Recorded, never inferred. */
  systematic: boolean
  describe: string
}

/**
 * A quantity that is not exactly known.
 *
 * `uncertainty` and `distribution` are both present because they answer different questions: the first is what a budget
 * adds up, the second is what a sampler draws from. They are kept consistent by `uncertainQuantity`, which derives
 * whichever the caller did not give, and are never allowed to drift apart afterwards.
 */
export interface UncertainQuantity {
  id: string
  label: string
  value: number
  unit: ResolvedUnit
  uncertainty: Uncertainty
  /** Present when the two sides differ. When present, `uncertainty` holds the larger of the two. */
  asymmetric: { up: number; down: number } | null
  distribution: Distribution
  facts: DistributionFacts
  provenance: Provenance
  /** Whether this is exactly known. Not the same as an uncertainty that happens to be zero. */
  exact: boolean
  sources: UncertaintySource[]
  /** A hard constraint on the sampled value, which the sampler respects rather than discovering. */
  bounds: { low: number | null; high: number | null }
  note: string
}

export interface QuantityOptions {
  label?: string
  uncertainty?: Uncertainty
  asymmetric?: { up: number; down: number }
  distribution?: Distribution
  provenance?: Provenance
  sources?: UncertaintySource[]
  bounds?: { low?: number | null; high?: number | null }
  note?: string
}

/**
 * An uncertain quantity, with its distribution and its uncertainty kept in step.
 *
 * Given a distribution and no uncertainty, the uncertainty is the distribution's own standard deviation, which is a
 * fact about it rather than a guess. Given an uncertainty and no distribution, the distribution is normal -- and that
 * choice is written into the note, because it is the one assumption here somebody might not have intended.
 */
export function uncertainQuantity(
  id: string,
  value: number,
  unitText: string,
  options: QuantityOptions = {}
): UncertainQuantity | UncertaintyError {
  if (!Number.isFinite(value)) return fail('invalid-argument', 'A quantity needs a finite value.')
  const cleanId = String(id).trim()
  if (cleanId === '') return fail('invalid-argument', 'A quantity needs an id.')

  const unit = parseUnit(unitText)
  if (isUnitError(unit)) return fail('invalid-unit', unit.message)

  const stated = options.uncertainty
  const asymmetric = options.asymmetric ?? null
  if (asymmetric && (!Number.isFinite(asymmetric.up) || !Number.isFinite(asymmetric.down) || asymmetric.up < 0 || asymmetric.down < 0)) {
    return fail('invalid-argument', 'An asymmetric uncertainty needs two numbers that are not negative.')
  }

  const sources = (options.sources ?? []).map((one) => ({ ...one, standard: Math.abs(one.standard) }))
  for (const source of sources) {
    if (!Number.isFinite(source.standard)) return fail('invalid-argument', `Source "${source.id}" has no finite uncertainty.`)
  }

  // If sources were given and no uncertainty was, combine them. That is the one direction the derivation is sound in:
  // components add in quadrature to a total, but a total says nothing about its parts.
  //
  // This has to happen *before* the distribution is chosen. A quantity described only by its components has an
  // uncertainty, and deriving the distribution from `stated` alone would see nothing and call it exact -- which is the
  // one thing an uncertain quantity must never be mistaken for.
  const fromSources = sources.length > 0 ? Math.sqrt(accurateSum(sources.map((one) => one.standard ** 2))) : null

  let distribution = options.distribution
  let note = options.note ?? ''

  if (!distribution) {
    if (asymmetric) {
      // Two different halves are a triangular shape, not a normal one. Forcing a normal here would be the moment the
      // asymmetry was thrown away, and nothing downstream could get it back.
      distribution = { kind: 'triangular', low: value - asymmetric.down, peak: value, high: value + asymmetric.up }
    } else {
      const spread = stated ? asStandard(stated) : (fromSources ?? 0)
      distribution = spread === 0 ? { kind: 'exact', value } : { kind: 'normal', mean: value, standardDeviation: spread }
      if (spread > 0) {
        note = note === '' ? 'Distribution assumed normal; none was given.' : `${note} Distribution assumed normal; none was given.`
      }
    }
  }

  const facts = checkDistribution(distribution)
  if (isUncertaintyError(facts)) return facts

  const uncertainty: Uncertainty =
    stated ??
    (fromSources !== null
      ? { value: fromSources, kind: 'standard', coverageFactor: 1, source: 'propagated' }
      : asymmetric
        ? { value: Math.max(asymmetric.up, asymmetric.down), kind: 'standard', coverageFactor: 1, source: 'stated' }
        : { value: Math.sqrt(facts.variance), kind: 'standard', coverageFactor: 1, source: facts.kind === 'exact' ? 'none' : 'stated' })

  const bounds = {
    low: options.bounds?.low ?? facts.low,
    high: options.bounds?.high ?? facts.high
  }
  if (bounds.low !== null && bounds.high !== null && bounds.low > bounds.high) {
    return fail('invalid-argument', 'A lower bound above the upper bound leaves nothing to sample.')
  }

  return {
    id: cleanId,
    label: options.label ?? cleanId,
    value,
    unit,
    uncertainty,
    asymmetric,
    distribution,
    facts,
    provenance: options.provenance ?? 'unknown',
    exact: distribution.kind === 'exact',
    sources,
    bounds,
    note
  }
}

/** An exactly known value. Zero uncertainty because there is none, not because none was supplied. */
export function exact(id: string, value: number, unitText = '', label?: string): UncertainQuantity | UncertaintyError {
  return uncertainQuantity(id, value, unitText, {
    label,
    distribution: { kind: 'exact', value },
    provenance: 'derived',
    note: 'Exact. This contributes nothing to any uncertainty budget.'
  })
}

/** The relative uncertainty, or `null` where the value is zero and a ratio would say nothing. */
export function relativeUncertainty(one: UncertainQuantity): number | null {
  if (one.value === 0) return null
  return asStandard(one.uncertainty) / Math.abs(one.value)
}

/**
 * The gap between a measurement and a reference, which is an error and not an uncertainty.
 *
 * Separate from everything else in this file, and it takes the reference as an argument because it cannot be computed
 * without one. That is the distinction: uncertainty needs no reference, error is meaningless without one.
 */
export function describeError(
  measured: UncertainQuantity,
  reference: number,
  referenceUncertainty = 0
): { error: number; relative: number | null; significant: boolean; describe: string } | UncertaintyError {
  if (!Number.isFinite(reference)) return fail('invalid-argument', 'An error needs a finite reference value.')
  const error = measured.value - reference
  const combined = Math.hypot(asStandard(measured.uncertainty), Math.abs(referenceUncertainty))
  // "Significant" here means larger than twice the combined uncertainty, and says so rather than implying a verdict.
  const significant = combined > 0 ? Math.abs(error) > 2 * combined : error !== 0
  return {
    error,
    relative: reference === 0 ? null : error / Math.abs(reference),
    significant,
    describe:
      combined === 0
        ? `The measured value differs from the reference by ${error}.`
        : significant
          ? `The measured value differs from the reference by ${Number(error.toPrecision(4))}, which is more than twice the combined uncertainty of ${Number(combined.toPrecision(4))}. The difference is larger than the measurement can account for.`
          : `The measured value differs from the reference by ${Number(error.toPrecision(4))}, which is within twice the combined uncertainty of ${Number(combined.toPrecision(4))}. That is consistent with the reference.`
  }
}

// ---------------------------------------------------------------- correlation and covariance

/**
 * How the inputs move together.
 *
 * Stored as correlation rather than covariance because correlation is the part a person can state from knowledge
 * ("these two instruments share a calibration") while covariance depends on the uncertainties, which are stored with
 * the quantities. `covarianceMatrix` puts them back together.
 */
export interface CorrelationSet {
  /** Keyed by the two ids, in sorted order, joined with a null byte so an id containing the separator cannot collide. */
  pairs: Map<string, number>
}

const pairKey = (a: string, b: string): string => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`)

export const noCorrelation = (): CorrelationSet => ({ pairs: new Map() })

export function setCorrelation(set: CorrelationSet, a: string, b: string, value: number): CorrelationSet | UncertaintyError {
  if (a === b) return fail('invalid-argument', 'A quantity is perfectly correlated with itself; that is not something to set.')
  if (!Number.isFinite(value) || value < -1 || value > 1) {
    return fail('invalid-correlation', 'A correlation is a number between -1 and 1.')
  }
  const pairs = new Map(set.pairs)
  pairs.set(pairKey(a, b), value)
  return { pairs }
}

export function correlationBetween(set: CorrelationSet, a: string, b: string): number {
  if (a === b) return 1
  return set.pairs.get(pairKey(a, b)) ?? 0
}

/**
 * The covariance matrix for a list of quantities.
 *
 * Validated as positive semi-definite, because a matrix that is not cannot be a covariance matrix -- it implies a
 * combination of the inputs with negative variance. Correlations set pair by pair very easily produce one: three
 * quantities each correlated 0.9 with the others is fine, each correlated -0.9 is not.
 */
export function covarianceMatrix(
  quantities: readonly UncertainQuantity[],
  correlations: CorrelationSet = noCorrelation()
): { matrix: number[][]; independent: boolean; notes: string[] } | UncertaintyError {
  const n = quantities.length
  if (n === 0) return fail('no-values', 'There are no quantities to build a covariance matrix from.')
  if (n > UNCERTAINTY_LIMITS.inputs) {
    return fail('too-many', `A covariance matrix is limited to ${UNCERTAINTY_LIMITS.inputs} quantities.`)
  }

  const spreads = quantities.map((one) => asStandard(one.uncertainty))
  const matrix: number[][] = []
  let independent = true
  for (let i = 0; i < n; i++) {
    matrix.push(new Array<number>(n).fill(0))
    for (let j = 0; j < n; j++) {
      const r = i === j ? 1 : correlationBetween(correlations, quantities[i].id, quantities[j].id)
      if (i !== j && r !== 0) independent = false
      matrix[i][j] = r * spreads[i] * spreads[j]
    }
  }

  const factor = choleskyFactor(matrix)
  if (isUncertaintyError(factor)) {
    return fail(
      'invalid-covariance',
      'Those correlations do not describe a possible set of quantities: they imply a combination of the inputs with negative variance. Correlations set one pair at a time can contradict each other even when each looks reasonable on its own.'
    )
  }

  const notes = independent
    ? ['No correlation was given between any pair, so they are taken to be independent. That is an assumption, not a measurement.']
    : [`${correlations.pairs.size} correlated pair${correlations.pairs.size === 1 ? '' : 's'} were given and are included in the propagation.`]

  return { matrix, independent, notes }
}

/** Whether a symmetric matrix is positive semi-definite. The factorisation is the test, so it is the one used. */
export function isPositiveSemiDefinite(matrix: readonly (readonly number[])[]): boolean {
  return !isUncertaintyError(choleskyFactor(matrix))
}

/**
 * The lower-triangular `L` with `L L^T = matrix`.
 *
 * A tolerance is unavoidable: a matrix built from correlations of exactly 1 is singular by construction, and a strict
 * test would refuse the very case somebody means when they say two inputs are the same measurement. A tiny negative
 * pivot is clamped to zero; a real one is refused.
 */
export function choleskyFactor(matrix: readonly (readonly number[])[]): number[][] | UncertaintyError {
  const n = matrix.length
  if (n === 0) return fail('invalid-matrix', 'An empty matrix cannot be factorised.')
  for (const row of matrix) {
    if (row.length !== n) return fail('invalid-matrix', 'A covariance matrix has to be square.')
  }
  // The scale the tolerance is relative to. An absolute tolerance would be wrong for quantities measured in nanometres.
  let scale = 0
  for (let i = 0; i < n; i++) scale = Math.max(scale, Math.abs(matrix[i][i]))
  const tolerance = Math.max(1e-12, scale * 1e-10)

  const L: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = matrix[i][j]
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k]
      if (i === j) {
        if (sum < -tolerance) return fail('not-positive-semi-definite', `Pivot ${i + 1} is ${sum}, which is negative.`)
        L[i][j] = Math.sqrt(Math.max(0, sum))
      } else {
        // A zero pivot means that row is a combination of earlier ones; it contributes nothing, so leave it at zero.
        L[i][j] = L[j][j] > tolerance ? sum / L[j][j] : 0
      }
    }
  }
  return L
}

// ---------------------------------------------------------------- random numbers

/**
 * A generator with independent streams.
 *
 * Streams matter for two reasons. Splitting a run across workers needs each worker to draw from a sequence that does
 * not overlap any other's, and drawing each input from its own stream means adding an input does not shift the numbers
 * every other input receives -- so a run with one more variable is still comparable to the run before it.
 */
export interface RandomStream {
  next(): number
  normal(): number
  readonly seed: number
  readonly stream: number
}

export function randomStream(seed: number, stream = 0): RandomStream {
  // The state is stirred with the stream index so two streams of the same seed share no prefix.
  let lo = (Math.imul(seed | 0, 0x9e3779b9) ^ Math.imul(stream + 1, 0x85ebca6b)) >>> 0
  let hi = (Math.imul(seed | 0, 0xc2b2ae35) ^ Math.imul(stream + 1, 0x27d4eb2f) ^ 0x165667b1) >>> 0
  // A zero state is a fixed point of the xorshift, so it has to be moved off it.
  if (lo === 0 && hi === 0) {
    lo = 0x9e3779b9
    hi = 0x85ebca6b
  }
  let spare: number | null = null

  const step = (): number => {
    // xorshift mixing, then a second avalanche because the low bits of an xorshift are the weak ones and quantiles
    // are sensitive to exactly those.
    let t = lo ^ ((lo << 11) >>> 0)
    t = (t ^ (t >>> 8)) >>> 0
    lo = hi
    hi = ((hi ^ (hi >>> 19)) ^ t) >>> 0
    let r = (hi + Math.imul(lo, 0x9e3779b1)) >>> 0
    r = Math.imul(r ^ (r >>> 15), 0x85ebca6b) >>> 0
    r = (r ^ (r >>> 13)) >>> 0
    return r
  }

  return {
    seed,
    stream,
    next(): number {
      // Open on both ends: a sample of exactly 0 breaks the log in the normal transform, and exactly 1 breaks inversion.
      return (step() + 0.5) / 4294967296
    },
    normal(): number {
      // Box-Muller, keeping the second value rather than throwing half the work away.
      if (spare !== null) {
        const value = spare
        spare = null
        return value
      }
      const u = Math.max(1e-12, (step() + 0.5) / 4294967296)
      const v = (step() + 0.5) / 4294967296
      const radius = Math.sqrt(-2 * Math.log(u))
      spare = radius * Math.sin(2 * Math.PI * v)
      return radius * Math.cos(2 * Math.PI * v)
    }
  }
}

/** One draw from a distribution, given a stream. Exposed because constraint-aware sampling needs to redraw one input. */
export function drawFrom(one: Distribution, random: RandomStream): number {
  switch (one.kind) {
    case 'exact':
      return one.value
    case 'uniform':
      return one.low + random.next() * (one.high - one.low)
    case 'normal':
      return one.mean + random.normal() * one.standardDeviation
    case 'lognormal':
      return Math.exp(one.logMean + random.normal() * one.logStandardDeviation)
    case 'triangular': {
      const u = random.next()
      const span = one.high - one.low
      const split = (one.peak - one.low) / span
      return u < split
        ? one.low + Math.sqrt(u * span * (one.peak - one.low))
        : one.high - Math.sqrt((1 - u) * span * (one.high - one.peak))
    }
    case 'discrete': {
      const total = accurateSum(one.outcomes.map((o) => o.weight))
      let target = random.next() * total
      for (const outcome of one.outcomes) {
        target -= outcome.weight
        if (target <= 0) return outcome.value
      }
      return one.outcomes[one.outcomes.length - 1].value
    }
    case 'empirical':
      return one.values[Math.min(one.values.length - 1, Math.floor(random.next() * one.values.length))]
  }
}

// ---------------------------------------------------------------- streaming statistics

/**
 * Mean, variance and extremes accumulated one value at a time.
 *
 * Welford's method rather than sum-of-squares: for a million samples whose spread is small next to their mean, the
 * naive formula subtracts two nearly equal large numbers and loses most of the answer. The quantiles still need the
 * values, which is why storing them is a separate decision.
 */
export class RunningStatistics {
  count = 0
  mean = 0
  squared = 0
  min = Number.POSITIVE_INFINITY
  max = Number.NEGATIVE_INFINITY

  add(value: number): void {
    this.count += 1
    const delta = value - this.mean
    this.mean += delta / this.count
    this.squared += delta * (value - this.mean)
    if (value < this.min) this.min = value
    if (value > this.max) this.max = value
  }

  get variance(): number {
    return this.count > 1 ? this.squared / (this.count - 1) : 0
  }

  get standardDeviation(): number {
    return Math.sqrt(this.variance)
  }

  /** The uncertainty in the mean itself, which is what convergence is judged against. */
  get standardError(): number {
    return this.count > 0 ? this.standardDeviation / Math.sqrt(this.count) : 0
  }
}

// ---------------------------------------------------------------- first-order propagation

export interface SensitivityEntry {
  id: string
  label: string
  /** The partial derivative of the output with respect to this input, at the nominal point. */
  derivative: number
  /** `derivative * standardUncertainty`, which is this input's own contribution in output units. */
  contribution: number
  /** The share of the total variance, as a fraction. */
  share: number
  /** Dimensionless: the proportional change in the output for a proportional change in the input. */
  elasticity: number | null
  standardUncertainty: number
}

export interface FirstOrderResult {
  method: 'first-order'
  value: number
  standardUncertainty: number
  interval: { low: number; high: number; level: number }
  sensitivities: SensitivityEntry[]
  /** The part of the variance that came from correlation rather than from any single input. */
  correlationContribution: number
  independent: boolean
  assumptions: string[]
  notes: string[]
}

export interface PropagationOptions {
  correlations?: CorrelationSet
  level?: number
  /** Step for the central difference, relative to each value. Exposed because a stiff model may need a larger one. */
  relativeStep?: number
}

/**
 * Uncertainty propagated by linearising the model: `s^2 = J Z J^T`.
 *
 * The Jacobian is taken by central differences rather than symbolically, so this works for any model the caller can
 * evaluate -- including one that is itself a simulation. The cost is two evaluations per input, and the step size is
 * the usual compromise: too large and the curvature shows up in the derivative, too small and floating point noise does.
 *
 * What this cannot do is notice that linearising was the wrong idea. `checkAssumptions` is for that, and the result
 * carries the assumptions in writing so that a caller showing the number also has the caveats.
 */
export function propagateFirstOrder(
  inputs: readonly UncertainQuantity[],
  model: (values: readonly number[]) => number,
  options: PropagationOptions = {}
): FirstOrderResult | UncertaintyError {
  if (inputs.length === 0) return fail('no-values', 'There are no inputs to propagate.')
  if (inputs.length > UNCERTAINTY_LIMITS.inputs) {
    return fail('too-many', `At most ${UNCERTAINTY_LIMITS.inputs} inputs can be propagated at once.`)
  }
  const level = options.level ?? 0.95
  if (!Number.isFinite(level) || level <= 0 || level >= 1) {
    return fail('invalid-argument', 'A coverage level is a fraction strictly between 0 and 1.')
  }

  const nominal = inputs.map((one) => one.value)
  const value = model(nominal)
  if (!Number.isFinite(value)) {
    return fail('not-finite', 'The model has no finite value at the nominal inputs, so there is nothing to propagate around.')
  }

  const relativeStep = options.relativeStep ?? 1e-6
  const derivatives: number[] = []
  for (let i = 0; i < inputs.length; i++) {
    if (inputs[i].exact) {
      // An exact input has no uncertainty to propagate, so its derivative changes nothing. Skipping the two model calls
      // is not only an optimisation: evaluating a model at a perturbed exact value can leave a valid domain.
      derivatives.push(0)
      continue
    }
    const step = Math.max(1e-10, Math.abs(nominal[i]) * relativeStep)
    const up = [...nominal]
    const down = [...nominal]
    up[i] += step
    down[i] -= step
    const a = model(up)
    const b = model(down)
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      return fail(
        'not-finite',
        `The model has no finite value just either side of ${inputs[i].label}, so its slope there cannot be found. Linear propagation needs the model to be defined in a neighbourhood of every input.`
      )
    }
    derivatives.push((a - b) / (2 * step))
  }

  const covariance = covarianceMatrix(inputs, options.correlations)
  if (isUncertaintyError(covariance)) return covariance

  // J Z J^T, kept split so the diagonal and off-diagonal parts can be reported separately.
  let diagonal = 0
  let offDiagonal = 0
  for (let i = 0; i < inputs.length; i++) {
    for (let j = 0; j < inputs.length; j++) {
      const term = derivatives[i] * covariance.matrix[i][j] * derivatives[j]
      if (i === j) diagonal += term
      else offDiagonal += term
    }
  }
  const total = diagonal + offDiagonal
  if (total < 0) {
    return fail('not-finite', 'The propagated variance came out negative, which means the covariance given is not consistent.')
  }
  const standardUncertainty = Math.sqrt(total)

  const sensitivities: SensitivityEntry[] = inputs.map((one, i) => {
    const u = asStandard(one.uncertainty)
    const contribution = derivatives[i] * u
    return {
      id: one.id,
      label: one.label,
      derivative: derivatives[i],
      contribution,
      share: total > 0 ? contribution ** 2 / total : 0,
      elasticity: value !== 0 && one.value !== 0 ? (derivatives[i] * one.value) / value : null,
      standardUncertainty: u
    }
  })
  sensitivities.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))

  const coverage = coverageFor(level)
  const assumptions = [
    'The model was linearised at the nominal inputs. That is exact for a straight model and an approximation for any other.',
    'Each uncertainty was taken as a standard uncertainty.',
    covariance.independent
      ? 'The inputs were taken to be independent, because no correlation was given.'
      : 'The correlations given were included through the covariance terms.',
    `The interval assumes the output is normally distributed, using a coverage factor of ${Number(coverage.toPrecision(3))}.`
  ]

  const notes = [...covariance.notes]
  if (offDiagonal !== 0) {
    notes.push(
      `Correlation between inputs ${offDiagonal > 0 ? 'added' : 'removed'} ${Number(Math.abs(offDiagonal).toPrecision(4))} of variance. Treating these inputs as independent would give ${Number(Math.sqrt(Math.max(0, diagonal)).toPrecision(4))} instead.`
    )
  }
  const exactCount = inputs.filter((one) => one.exact).length
  if (exactCount > 0) {
    notes.push(`${exactCount} of the ${inputs.length} inputs are exact and contribute nothing.`)
  }

  return {
    method: 'first-order',
    value,
    standardUncertainty,
    interval: { low: value - coverage * standardUncertainty, high: value + coverage * standardUncertainty, level },
    sensitivities,
    correlationContribution: offDiagonal,
    independent: covariance.independent,
    assumptions,
    notes
  }
}

/** The two-sided normal coverage factor for a level, found by bisection on the normal cumulative. */
export function coverageFor(level: number): number {
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

// ---------------------------------------------------------------- Monte Carlo

export type MemoryPolicy = 'all' | 'aggregate'

export interface SamplingOptions {
  samples?: number
  seed?: number
  correlations?: CorrelationSet
  level?: number
  quantiles?: number[]
  /**
   * How much to keep. `all` stores the outputs, up to the stored-sample ceiling, and `aggregate` stores nothing and can
   * therefore report no quantiles at all -- which it says rather than estimating them from a mean and a spread.
   */
  memory?: MemoryPolicy
  /** Stop early once the standard error of the mean falls below this. Checked at checkpoints, never mid-batch. */
  targetStandardError?: number
  /** A constraint every drawn sample must satisfy. Rejected draws are counted and reported. */
  accept?: (values: readonly number[]) => boolean
  /** How many times to redraw a rejected sample before giving up on it. */
  maxRejections?: number
}

export interface ConvergencePoint {
  trials: number
  mean: number
  standardDeviation: number
  standardError: number
}

export interface MonteCarloOutcome {
  method: 'monte-carlo'
  value: number
  /** The middle of the sampled outputs. For a curved model this genuinely differs from `value`, and both are correct. */
  mean: number
  median: number | null
  standardUncertainty: number
  variance: number
  minimum: number
  maximum: number
  quantiles: { fraction: number; value: number }[]
  interval: { low: number; high: number; level: number } | null
  /** Present when the two halves of the interval differ enough that a single plus-or-minus would hide it. */
  asymmetry: { up: number; down: number; skewed: boolean } | null
  convergence: ConvergencePoint[]
  converged: boolean
  successfulTrials: number
  failedTrials: number
  rejectedDraws: number
  failureReasons: { reason: string; count: number }[]
  seed: number
  requestedSamples: number
  memory: MemoryPolicy
  correlated: boolean
  assumptions: string[]
  notes: string[]
}

/**
 * Uncertainty found by sampling the inputs and evaluating the model.
 *
 * Three things here are not optional extras.
 *
 * **Correlated draws** come from the Cholesky factor of the covariance: draw a standard normal vector, multiply by `L`,
 * and the result has the covariance asked for. It only works for normal inputs, so a correlated non-normal input is
 * refused rather than sampled as if the correlation had been applied.
 *
 * **Failures are counted, never dropped.** A model that returns a non-finite value for a fifth of the draws has told
 * you something, and averaging the other four fifths hides it.
 *
 * **Convergence is measured, not assumed.** Finishing the requested number of trials is not convergence; the standard
 * error of the mean falling below a target is. A run that completes without a target says `converged: false`, because
 * nothing checked.
 */
export function propagateByMonteCarlo(
  inputs: readonly UncertainQuantity[],
  model: (values: readonly number[]) => number,
  options: SamplingOptions = {}
): MonteCarloOutcome | UncertaintyError {
  if (inputs.length === 0) return fail('no-values', 'There are no inputs to sample.')
  if (inputs.length > UNCERTAINTY_LIMITS.inputs) {
    return fail('too-many', `At most ${UNCERTAINTY_LIMITS.inputs} inputs can be sampled at once.`)
  }

  const requested = Math.round(options.samples ?? 20_000)
  if (!Number.isFinite(requested) || requested < 10) return fail('invalid-argument', 'A run needs at least 10 trials.')
  if (requested > UNCERTAINTY_LIMITS.samples) {
    return fail(
      'too-many',
      `${requested.toLocaleString('en')} trials is more than the ${UNCERTAINTY_LIMITS.samples.toLocaleString('en')} allowed in one run. Ask for fewer, or split the run.`
    )
  }
  const level = options.level ?? 0.95
  if (!Number.isFinite(level) || level <= 0 || level >= 1) {
    return fail('invalid-argument', 'A coverage level is a fraction strictly between 0 and 1.')
  }
  const seed = Math.round(options.seed ?? 1)
  if (!Number.isFinite(seed)) return fail('invalid-argument', 'A seed has to be a whole number.')
  const memory: MemoryPolicy = options.memory ?? 'all'

  for (const one of inputs) {
    const facts = checkDistribution(one.distribution)
    if (isUncertaintyError(facts)) return fail('invalid-distribution', `${one.label}: ${facts.message}`)
  }

  const correlations = options.correlations ?? noCorrelation()
  const covariance = covarianceMatrix(inputs, correlations)
  if (isUncertaintyError(covariance)) return covariance
  const correlated = !covariance.independent

  let factor: number[][] | null = null
  if (correlated) {
    // Correlating non-normal draws would need a copula, which is a different model of the dependence than the one a
    // correlation number describes. Refusing is the honest option.
    const awkward = inputs.filter(
      (one) => !one.exact && one.distribution.kind !== 'normal' && hasAnyCorrelation(correlations, one.id)
    )
    if (awkward.length > 0) {
      return fail(
        'unsupported-correlation',
        `Correlated sampling here draws from a joint normal, so a correlated input has to be normal. ${awkward.map((o) => o.label).join(', ')} ${awkward.length === 1 ? 'is' : 'are'} not. Either give ${awkward.length === 1 ? 'it' : 'them'} a normal distribution or drop the correlation.`
      )
    }
    const built = choleskyFactor(covariance.matrix)
    if (isUncertaintyError(built)) return built
    factor = built
  }

  // One stream per input, plus one for the correlated vector, so adding an input does not disturb the others.
  const streams = inputs.map((_, i) => randomStream(seed, i + 1))
  const jointStream = randomStream(seed, 0)

  const statistics = new RunningStatistics()
  const kept: number[] = []
  const storeLimit = memory === 'aggregate' ? 0 : UNCERTAINTY_LIMITS.storedSamples
  const convergence: ConvergencePoint[] = []
  const checkpointEvery = Math.max(1, Math.floor(requested / Math.min(UNCERTAINTY_LIMITS.checkpoints, requested)))
  const failures = new Map<string, number>()
  let rejectedDraws = 0
  let failed = 0
  let converged = false
  let stoppedAt = requested

  const values = new Array<number>(inputs.length)
  const maxRejections = Math.max(1, Math.round(options.maxRejections ?? 100))

  for (let trial = 0; trial < requested; trial++) {
    let accepted = false
    for (let attempt = 0; attempt < maxRejections && !accepted; attempt++) {
      if (factor) {
        // z ~ N(0,I); L z has the covariance asked for; add the nominal values back on.
        const z = inputs.map(() => jointStream.normal())
        for (let i = 0; i < inputs.length; i++) {
          if (inputs[i].exact) {
            values[i] = inputs[i].value
            continue
          }
          let sum = 0
          for (let k = 0; k <= i; k++) sum += factor[i][k] * z[k]
          values[i] = inputs[i].value + sum
        }
      } else {
        for (let i = 0; i < inputs.length; i++) values[i] = drawFrom(inputs[i].distribution, streams[i])
      }

      // Declared bounds are enforced here rather than by clamping: clamping piles probability onto the boundary and
      // changes the distribution into something nobody asked for.
      let withinBounds = true
      for (let i = 0; i < inputs.length && withinBounds; i++) {
        const { low, high } = inputs[i].bounds
        if (low !== null && values[i] < low) withinBounds = false
        if (high !== null && values[i] > high) withinBounds = false
      }
      if (withinBounds && options.accept) withinBounds = options.accept(values)
      if (withinBounds) accepted = true
      else rejectedDraws += 1
    }

    if (!accepted) {
      failed += 1
      failures.set('constraint', (failures.get('constraint') ?? 0) + 1)
      continue
    }

    let output: number
    try {
      output = model(values)
    } catch (error) {
      failed += 1
      const reason = error instanceof Error ? error.message.slice(0, 120) : 'the model failed'
      failures.set(reason, (failures.get(reason) ?? 0) + 1)
      continue
    }

    if (!Number.isFinite(output)) {
      failed += 1
      const reason = Number.isNaN(output) ? 'not a number' : 'infinite'
      failures.set(reason, (failures.get(reason) ?? 0) + 1)
      continue
    }

    statistics.add(output)
    if (kept.length < storeLimit) kept.push(output)

    if ((trial + 1) % checkpointEvery === 0 && statistics.count > 1) {
      convergence.push({
        trials: statistics.count,
        mean: statistics.mean,
        standardDeviation: statistics.standardDeviation,
        standardError: statistics.standardError
      })
      if (
        options.targetStandardError !== undefined &&
        statistics.count >= 100 &&
        statistics.standardError <= options.targetStandardError
      ) {
        converged = true
        stoppedAt = trial + 1
        break
      }
    }
  }

  if (statistics.count < 10) {
    return fail(
      'too-few-successes',
      `Only ${statistics.count} of ${stoppedAt} trials produced a value, which is too few to estimate anything from. ${describeFailures(failures)}`
    )
  }

  const nominal = model(inputs.map((one) => one.value))
  const fractions = (options.quantiles ?? [0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99]).slice(0, UNCERTAINTY_LIMITS.quantiles)
  for (const fraction of fractions) {
    if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) {
      return fail('invalid-argument', 'A quantile is a fraction between 0 and 1.')
    }
  }

  const haveSamples = kept.length > 0
  const quantiles = haveSamples
    ? fractions.map((fraction) => ({ fraction, value: percentile(kept, fraction) as number }))
    : []
  const median = haveSamples ? (percentile(kept, 0.5) as number) : null
  const interval = haveSamples
    ? {
        low: percentile(kept, (1 - level) / 2) as number,
        high: percentile(kept, 1 - (1 - level) / 2) as number,
        level
      }
    : null

  // Asymmetry is measured against the median, because measuring it against the mean would fold in the skew twice.
  let asymmetry: MonteCarloOutcome['asymmetry'] = null
  if (interval && median !== null) {
    const up = interval.high - median
    const down = median - interval.low
    const larger = Math.max(up, down)
    asymmetry = { up, down, skewed: larger > 0 && Math.abs(up - down) / larger > 0.1 }
  }

  const varying = inputs.filter((o) => !o.exact)
  const assumptions = [
    varying.length === 0
      ? 'Every input is exact, so nothing was drawn.'
      : `Each input was drawn from the distribution it declares. ${varying.map((o) => `${o.label}: ${o.facts.describe}`).join('; ')}`,
    correlated
      ? 'Correlated inputs were drawn from a joint normal with the covariance given.'
      : 'The inputs were drawn independently, because no correlation was given.',
    `Seed ${seed}. The same inputs, the same seed and the same model give the same answer.`
  ]

  const notes: string[] = [
    `${statistics.count.toLocaleString('en')} of ${stoppedAt.toLocaleString('en')} trials produced a value.`
  ]
  if (rejectedDraws > 0) {
    notes.push(
      `${rejectedDraws.toLocaleString('en')} draws fell outside the declared bounds or the constraint and were redrawn. This is rejection sampling, so the inputs' distributions are the declared ones truncated to what was allowed.`
    )
  }
  if (failed > 0) {
    notes.push(
      `${failed.toLocaleString('en')} trials failed and are not in the statistics. ${describeFailures(failures)}${failed / stoppedAt > 0.05 ? ' That is more than one trial in twenty, which is enough to change what the surviving trials represent.' : ''}`
    )
  }
  if (options.targetStandardError !== undefined) {
    notes.push(
      converged
        ? `Stopped at ${stoppedAt.toLocaleString('en')} trials, where the standard error of the mean reached ${Number(statistics.standardError.toPrecision(3))}.`
        : `The standard error of the mean is ${Number(statistics.standardError.toPrecision(3))}, which did not reach the target of ${options.targetStandardError} within ${stoppedAt.toLocaleString('en')} trials.`
    )
  } else {
    notes.push(
      'No stopping target was set, so nothing here says the answer has converged -- only that the requested number of trials finished.'
    )
  }
  if (memory === 'aggregate') {
    notes.push('Samples were not kept, so there are no quantiles and no interval. Only the mean, spread and extremes survive.')
  } else if (statistics.count > kept.length) {
    notes.push(
      `Quantiles come from the first ${kept.length.toLocaleString('en')} results; the mean and spread come from all ${statistics.count.toLocaleString('en')}.`
    )
  }
  if (asymmetry?.skewed) {
    notes.push(
      `The interval is noticeably lopsided: ${Number(asymmetry.up.toPrecision(3))} above the median against ${Number(asymmetry.down.toPrecision(3))} below. Reporting this as a single plus-or-minus would hide that.`
    )
  }
  if (Number.isFinite(nominal) && Math.abs(statistics.mean - nominal) > statistics.standardDeviation * 0.1) {
    notes.push(
      `The mean of the results (${Number(statistics.mean.toPrecision(6))}) is not the model's value at the nominal inputs (${Number(nominal.toPrecision(6))}). For a curved model these differ, and neither is a mistake.`
    )
  }

  return {
    method: 'monte-carlo',
    value: Number.isFinite(nominal) ? nominal : statistics.mean,
    mean: statistics.mean,
    median,
    standardUncertainty: statistics.standardDeviation,
    variance: statistics.variance,
    minimum: statistics.min,
    maximum: statistics.max,
    quantiles,
    interval,
    asymmetry,
    convergence: convergence.slice(-UNCERTAINTY_LIMITS.checkpoints),
    converged,
    successfulTrials: statistics.count,
    failedTrials: failed,
    rejectedDraws,
    failureReasons: [...failures.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    seed,
    requestedSamples: requested,
    memory,
    correlated,
    assumptions,
    notes
  }
}

const hasAnyCorrelation = (set: CorrelationSet, id: string): boolean => {
  for (const key of set.pairs.keys()) {
    const parts = key.split('\u0000')
    if (parts[0] === id || parts[1] === id) return true
  }
  return false
}

const describeFailures = (failures: Map<string, number>): string => {
  if (failures.size === 0) return ''
  const parts = [...failures.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
  return `Reasons: ${parts.map(([reason, count]) => `${reason} (${count})`).join(', ')}.`
}

// ---------------------------------------------------------------- variance-based sensitivity

export interface VarianceContribution {
  id: string
  label: string
  /** First-order Sobol index: the share of output variance explained by this input alone. */
  first: number
  /** Total-effect index: this input's share including every interaction it takes part in. */
  total: number
  /** `total - first`. Where this is large, the input matters mainly through interaction with another. */
  interaction: number
}

export interface GlobalSensitivityResult {
  contributions: VarianceContribution[]
  outputVariance: number
  samples: number
  modelCalls: number
  seed: number
  /** Whether the indices add to about one. They do not have to, and a large gap is itself information. */
  firstOrderSum: number
  notes: string[]
  assumptions: string[]
}

/**
 * Variance-based global sensitivity, by the Saltelli estimator.
 *
 * Local sensitivity asks how the output moves for a small nudge at one point. This asks a different question: across
 * the whole range the inputs can take, how much of the output's variance would disappear if one input were pinned. For
 * a model with interactions the two answers can disagree completely, which is why both exist.
 *
 * Cost is `(inputs + 2) x samples` model calls, so the sample count means something different here than it does in a
 * plain Monte Carlo run.
 */
export function globalSensitivity(
  inputs: readonly UncertainQuantity[],
  model: (values: readonly number[]) => number,
  options: { samples?: number; seed?: number } = {}
): GlobalSensitivityResult | UncertaintyError {
  const varying = inputs.filter((one) => !one.exact)
  if (varying.length === 0) return fail('no-values', 'Every input is exact, so nothing varies and no variance can be attributed.')
  if (inputs.length > UNCERTAINTY_LIMITS.inputs) {
    return fail('too-many', `At most ${UNCERTAINTY_LIMITS.inputs} inputs can be analysed at once.`)
  }

  const samples = Math.round(options.samples ?? 2000)
  if (!Number.isFinite(samples) || samples < 50) return fail('invalid-argument', 'Variance-based sensitivity needs at least 50 samples.')
  const calls = samples * (varying.length + 2)
  if (calls > UNCERTAINTY_LIMITS.samples) {
    return fail(
      'too-many',
      `That would take ${calls.toLocaleString('en')} model calls, past the ${UNCERTAINTY_LIMITS.samples.toLocaleString('en')} allowed. Variance-based sensitivity costs one call per sample for every input that varies, plus two base matrices.`
    )
  }
  const seed = Math.round(options.seed ?? 1)

  // Two independent matrices, and then hybrids that take one column from the other.
  const drawMatrix = (offset: number): number[][] => {
    const streams = inputs.map((_, i) => randomStream(seed, offset + i + 1))
    return Array.from({ length: samples }, () => inputs.map((one, i) => drawFrom(one.distribution, streams[i])))
  }
  const A = drawMatrix(0)
  const B = drawMatrix(1000)

  const evaluate = (rows: readonly number[][]): number[] | UncertaintyError => {
    const out: number[] = []
    for (const row of rows) {
      const value = model(row)
      if (!Number.isFinite(value)) {
        return fail(
          'not-finite',
          'The model produced a value that is not finite during sensitivity sampling, so the variance cannot be attributed. Variance-based sensitivity needs the model to be defined everywhere the inputs can reach.'
        )
      }
      out.push(value)
    }
    return out
  }

  const yA = evaluate(A)
  if (isUncertaintyError(yA)) return yA
  const yB = evaluate(B)
  if (isUncertaintyError(yB)) return yB

  const meanA = accurateSum(yA) / samples
  let variance = 0
  for (const value of yA) variance += (value - meanA) ** 2
  variance /= samples - 1
  if (variance <= 0) {
    return fail('no-variance', 'The output does not vary across the inputs, so there is no variance to attribute to anything.')
  }

  const contributions: VarianceContribution[] = []
  for (let i = 0; i < inputs.length; i++) {
    if (inputs[i].exact) {
      contributions.push({ id: inputs[i].id, label: inputs[i].label, first: 0, total: 0, interaction: 0 })
      continue
    }
    const AB = A.map((row, r) => {
      const hybrid = [...row]
      hybrid[i] = B[r][i]
      return hybrid
    })
    const yAB = evaluate(AB)
    if (isUncertaintyError(yAB)) return yAB

    // Saltelli 2010: first order from yB.(yAB - yA), total from (yA - yAB)^2.
    let firstSum = 0
    let totalSum = 0
    for (let r = 0; r < samples; r++) {
      firstSum += yB[r] * (yAB[r] - yA[r])
      totalSum += (yA[r] - yAB[r]) ** 2
    }
    const first = firstSum / samples / variance
    const total = totalSum / (2 * samples) / variance
    contributions.push({
      id: inputs[i].id,
      label: inputs[i].label,
      // Clamped to [0,1]: the estimator is unbiased, not bounded, and a small negative index means "about zero" rather
      // than "negative share", which is not a thing a share can be.
      first: Math.min(1, Math.max(0, first)),
      total: Math.min(1, Math.max(0, total)),
      interaction: Math.max(0, Math.min(1, total) - Math.max(0, Math.min(1, first)))
    })
  }
  contributions.sort((a, b) => b.total - a.total)

  const firstOrderSum = accurateSum(contributions.map((one) => one.first))
  const notes = [
    `${calls.toLocaleString('en')} model calls: ${samples.toLocaleString('en')} samples for each of the ${varying.length} inputs that vary, plus two base matrices.`
  ]
  if (firstOrderSum < 0.9) {
    notes.push(
      `The first-order shares add to ${Number(firstOrderSum.toPrecision(3))}, below one. The missing part is variance that no single input explains on its own -- it comes from inputs acting together.`
    )
  } else {
    notes.push(
      `The first-order shares add to ${Number(firstOrderSum.toPrecision(3))}, close to one, so most of the variance is explained by inputs acting separately.`
    )
  }

  return {
    contributions,
    outputVariance: variance,
    samples,
    modelCalls: calls,
    seed,
    firstOrderSum,
    notes,
    assumptions: [
      'The inputs were sampled independently. Variance-based indices assume that, and a correlated set would need a different estimator.',
      'Indices are estimates from a finite sample and carry their own sampling error, which is not reported here.',
      `Seed ${seed}. The same inputs and seed give the same indices.`
    ]
  }
}

// ---------------------------------------------------------------- budgets

export interface BudgetLine {
  id: string
  label: string
  component: UncertaintyComponent
  systematic: boolean
  /** Standard uncertainty of the source itself, in its own units. */
  standard: number
  /** How much the output moves per unit of this source. */
  sensitivity: number
  /** `standard * sensitivity`: this line's contribution in output units. */
  contribution: number
  /** Share of the combined variance. */
  share: number
  describe: string
}

export interface UncertaintyBudget {
  lines: BudgetLine[]
  combined: number
  expanded: number
  coverageFactor: number
  level: number
  /** The combined uncertainty of just the systematic lines, which do not shrink with more measurements. */
  systematicPart: number
  randomPart: number
  notes: string[]
}

/**
 * The table of where an uncertainty came from.
 *
 * Every line is computed from a source somebody declared and a sensitivity the propagation found. Nothing here invents
 * a contribution, and a quantity with no declared sources produces one line for the quantity itself rather than a
 * plausible-looking breakdown into instrument, repeatability and calibration.
 *
 * The systematic and random parts are split because they answer the question people actually ask next: will measuring
 * again help? More repeats shrink the random part and leave the systematic part exactly where it was.
 */
export function uncertaintyBudget(
  inputs: readonly UncertainQuantity[],
  sensitivities: readonly SensitivityEntry[],
  level = 0.95
): UncertaintyBudget | UncertaintyError {
  if (!Number.isFinite(level) || level <= 0 || level >= 1) {
    return fail('invalid-argument', 'A coverage level is a fraction strictly between 0 and 1.')
  }
  const byId = new Map(sensitivities.map((one) => [one.id, one]))
  const lines: BudgetLine[] = []

  for (const input of inputs) {
    if (input.exact) continue
    const sensitivity = byId.get(input.id)
    if (!sensitivity) {
      return fail('missing-sensitivity', `There is no sensitivity for "${input.label}", so its contribution cannot be worked out.`)
    }
    if (input.sources.length === 0) {
      const standard = asStandard(input.uncertainty)
      lines.push({
        id: input.id,
        label: input.label,
        component: 'stated',
        systematic: false,
        standard,
        sensitivity: sensitivity.derivative,
        contribution: standard * sensitivity.derivative,
        share: 0,
        describe: `${input.label}, as stated. No breakdown into components was given, so none is shown.`
      })
      continue
    }
    for (const source of input.sources) {
      lines.push({
        id: `${input.id}.${source.id}`,
        label: `${input.label} — ${source.describe || COMPONENT_LABEL[source.component]}`,
        component: source.component,
        systematic: source.systematic,
        standard: source.standard,
        sensitivity: sensitivity.derivative,
        contribution: source.standard * sensitivity.derivative,
        share: 0,
        describe: source.describe
      })
    }
  }

  if (lines.length === 0) return fail('no-values', 'Every input is exact, so there is no uncertainty to break down.')

  const totalVariance = accurateSum(lines.map((one) => one.contribution ** 2))
  for (const line of lines) line.share = totalVariance > 0 ? line.contribution ** 2 / totalVariance : 0
  lines.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))

  const combined = Math.sqrt(totalVariance)
  const coverageFactor = coverageFor(level)
  const systematicPart = Math.sqrt(accurateSum(lines.filter((one) => one.systematic).map((one) => one.contribution ** 2)))
  const randomPart = Math.sqrt(accurateSum(lines.filter((one) => !one.systematic).map((one) => one.contribution ** 2)))

  const notes: string[] = []
  const biggest = lines[0]
  if (biggest && biggest.share > 0.5) {
    notes.push(
      `${biggest.label} accounts for ${Math.round(biggest.share * 100)}% of the variance. Improving anything else first would barely move the total.`
    )
  }
  if (systematicPart > 0) {
    notes.push(
      `${Number(systematicPart.toPrecision(3))} of the combined uncertainty is systematic and will not shrink by measuring again. Repeating the measurement can only reduce the random part, which is ${Number(randomPart.toPrecision(3))}.`
    )
  }
  notes.push('Components were combined in quadrature, which assumes they are independent of one another.')

  return { lines, combined, expanded: combined * coverageFactor, coverageFactor, level, systematicPart, randomPart, notes }
}

// ---------------------------------------------------------------- assumptions and comparison

export interface AssumptionCheck {
  id: string
  concern: string
  holds: boolean
  /** What was measured, in the check's own terms, so the verdict can be argued with. */
  evidence: string
  suggestion: string
}

/**
 * Whether linearising the model was a reasonable thing to do.
 *
 * Each check is a diagnostic with its evidence attached, not a verdict. A large relative uncertainty is a reason to be
 * careful, not proof that the linear answer is wrong; a second derivative near zero is reassurance, not a guarantee.
 * The caller is meant to read these, which is why every one carries the number it was decided on.
 */
export function checkAssumptions(
  inputs: readonly UncertainQuantity[],
  model: (values: readonly number[]) => number,
  result: FirstOrderResult
): AssumptionCheck[] {
  const checks: AssumptionCheck[] = []
  const nominal = inputs.map((one) => one.value)

  // 1. Relative uncertainty. Beyond about a fifth, a first-order expansion is being asked to hold over a wide range.
  const worst = inputs
    .filter((one) => !one.exact)
    .map((one) => ({ one, relative: relativeUncertainty(one) }))
    .filter((entry): entry is { one: UncertainQuantity; relative: number } => entry.relative !== null)
    .sort((a, b) => b.relative - a.relative)[0]
  if (worst) {
    checks.push({
      id: 'relative-uncertainty',
      concern: 'The uncertainties are small enough for a linear approximation.',
      holds: worst.relative <= 0.2,
      evidence: `The largest relative uncertainty is ${Math.round(worst.relative * 100)}% on ${worst.one.label}.`,
      suggestion:
        worst.relative <= 0.2
          ? 'Nothing to do; the range each input covers is narrow.'
          : 'Run it by Monte Carlo as well and compare. Over a range that wide the model can curve noticeably.'
    })
  }

  // 2. Curvature. The second derivative scaled by the uncertainty, against the first: the next term of the Taylor
  // series against the one being kept.
  let worstCurvature = 0
  let curvatureLabel = ''
  let curvatureUsable = true
  const middle = model(nominal)
  for (let i = 0; i < inputs.length; i++) {
    const u = asStandard(inputs[i].uncertainty)
    if (inputs[i].exact || u === 0) continue
    const up = [...nominal]
    const down = [...nominal]
    up[i] += u
    down[i] -= u
    const a = model(up)
    const b = model(down)
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(middle)) {
      curvatureUsable = false
      continue
    }
    const second = a - 2 * middle + b
    const first = Math.abs(result.sensitivities.find((one) => one.id === inputs[i].id)?.contribution ?? 0)
    const ratio = first > 0 ? Math.abs(second / 2) / first : second === 0 ? 0 : Number.POSITIVE_INFINITY
    if (ratio > worstCurvature) {
      worstCurvature = ratio
      curvatureLabel = inputs[i].label
    }
  }
  checks.push({
    id: 'curvature',
    concern: 'The model is close to straight over the range of the uncertainties.',
    holds: curvatureUsable && worstCurvature <= 0.1,
    evidence: curvatureUsable
      ? `Over one standard uncertainty of ${curvatureLabel || 'the inputs'}, the curved part of the model is ${Number((worstCurvature * 100).toPrecision(3))}% of the straight part.`
      : 'The model could not be evaluated one standard uncertainty either side of every input, so the curvature could not be measured.',
    suggestion:
      curvatureUsable && worstCurvature <= 0.1
        ? 'Nothing to do; the linear term dominates.'
        : 'Use Monte Carlo. The curved part is large enough to move the answer, and linear propagation cannot see it.'
  })

  // 3. Bounded or discrete inputs, which a normal output interval cannot represent honestly.
  const shaped = inputs.filter(
    (one) =>
      !one.exact &&
      (one.distribution.kind === 'discrete' || one.distribution.kind === 'uniform' || one.distribution.kind === 'triangular')
  )
  checks.push({
    id: 'output-shape',
    concern: 'The output can be described by a mean and a single spread.',
    holds: shaped.length === 0,
    evidence:
      shaped.length === 0
        ? 'Every uncertain input is unbounded and continuous.'
        : `${shaped.map((one) => one.label).join(', ')} ${shaped.length === 1 ? 'is' : 'are'} bounded or discrete.`,
    suggestion:
      shaped.length === 0
        ? 'Nothing to do.'
        : 'Sample instead, and read the quantiles. A bounded input gives an output that a symmetric plus-or-minus can overstate at one end.'
  })

  // 4. Independence, which is only ever an assumption when nothing was given.
  const varying = inputs.filter((one) => !one.exact).length
  checks.push({
    id: 'independence',
    concern: 'The inputs are independent, or their correlation was given.',
    holds: !result.independent || varying <= 1,
    evidence: result.independent
      ? `${varying} uncertain input${varying === 1 ? ' was' : 's were'} treated as independent because no correlation was given.`
      : 'Correlations were given and were included.',
    suggestion:
      result.independent && varying > 1
        ? 'If any two of these come from the same instrument, the same calibration or the same reading, they are not independent and the total is being understated or overstated.'
        : 'Nothing to do.'
  })

  return checks
}

export interface MethodComparison {
  firstOrder: FirstOrderResult
  sampled: MonteCarloOutcome
  /** Sampled spread divided by the linear one. Near 1 means linearising cost nothing. */
  ratio: number
  agree: boolean
  differences: string[]
  /** Deliberately not a recommendation. The caller decides; this says what each method gives and what it assumed. */
  summary: string
}

/**
 * The same problem by both methods, side by side.
 *
 * There is no verdict here, on purpose. Monte Carlo is not universally better: it costs thousands of model calls, it
 * carries its own sampling error, and for a linear model it returns the analytic answer with noise added. What is
 * useful is the comparison -- when the two agree, the cheap one was fine, and when they do not, that disagreement is
 * the finding.
 */
export function compareMethods(
  inputs: readonly UncertainQuantity[],
  model: (values: readonly number[]) => number,
  options: SamplingOptions & PropagationOptions = {}
): MethodComparison | UncertaintyError {
  const firstOrder = propagateFirstOrder(inputs, model, options)
  if (isUncertaintyError(firstOrder)) return firstOrder
  const sampled = propagateByMonteCarlo(inputs, model, options)
  if (isUncertaintyError(sampled)) return sampled

  const ratio = firstOrder.standardUncertainty > 0 ? sampled.standardUncertainty / firstOrder.standardUncertainty : Number.NaN
  const agree = Number.isFinite(ratio) ? ratio > 0.9 && ratio < 1.1 : sampled.standardUncertainty === 0

  const differences: string[] = []
  if (!agree && Number.isFinite(ratio)) {
    differences.push(
      `The sampled uncertainty is ${Number(ratio.toPrecision(3))} times the linear one (${Number(sampled.standardUncertainty.toPrecision(4))} against ${Number(firstOrder.standardUncertainty.toPrecision(4))}). Linearising the model changed the answer by more than a tenth.`
    )
  }
  if (sampled.asymmetry?.skewed) {
    differences.push(
      'The sampled output is lopsided. Linear propagation cannot represent that at all: it always produces a symmetric interval.'
    )
  }
  if (Math.abs(sampled.mean - firstOrder.value) > sampled.standardUncertainty * 0.1) {
    differences.push(
      `The sampled mean (${Number(sampled.mean.toPrecision(6))}) is not the model's value at the nominal inputs (${Number(firstOrder.value.toPrecision(6))}). Linear propagation assumes they are the same, which holds only for a straight model.`
    )
  }
  if (sampled.failedTrials > 0) {
    differences.push(
      `${sampled.failedTrials} sampled trials had no value. Linear propagation never noticed, because it only ever evaluated the model near the nominal point.`
    )
  }

  return {
    firstOrder,
    sampled,
    ratio,
    agree,
    differences,
    summary: agree
      ? `Both methods give about the same uncertainty, so the cheaper one was enough here. Linear propagation took ${2 * inputs.length} model calls; sampling took ${sampled.successfulTrials.toLocaleString('en')}.`
      : `The two methods disagree. Linear propagation assumes the model is straight over the range of the uncertainties; sampling does not assume that but carries its own sampling error of about ${Number((sampled.standardUncertainty / Math.sqrt(sampled.successfulTrials)).toPrecision(2))} on the mean. Which to report depends on which assumption you are willing to make.`
  }
}

// ---------------------------------------------------------------- chains and traceability

export interface ChainNode {
  id: string
  label: string
  /** The ids this node is computed from. Empty for an input. */
  from: string[]
  value: number
  standardUncertainty: number
  unit: string
  provenance: Provenance
}

export interface ChainResult {
  nodes: ChainNode[]
  /** For each derived quantity, the original inputs it ultimately depends on. */
  paths: { to: string; through: string[] }[]
  notes: string[]
}

/**
 * Uncertainty carried through several derived quantities in turn.
 *
 * The reason this exists rather than just calling `propagateFirstOrder` repeatedly: a quantity derived from two others
 * that share an input is correlated with anything else derived from them, and treating each step as independent gets
 * the total wrong. Recording the graph is what makes that visible; this does not silently fix it, it reports it.
 */
export function propagateChain(
  inputs: readonly UncertainQuantity[],
  steps: readonly {
    id: string
    label?: string
    from: string[]
    unit?: string
    model: (values: readonly number[]) => number
  }[],
  options: PropagationOptions = {}
): ChainResult | UncertaintyError {
  if (steps.length === 0) return fail('no-values', 'A chain needs at least one derived quantity.')
  if (steps.length > UNCERTAINTY_LIMITS.inputs) return fail('too-many', 'A chain is limited to 64 steps.')

  const known = new Map<string, ChainNode>()
  for (const one of inputs) {
    known.set(one.id, {
      id: one.id,
      label: one.label,
      from: [],
      value: one.value,
      standardUncertainty: asStandard(one.uncertainty),
      unit: one.unit.display,
      provenance: one.provenance
    })
  }
  const quantities = new Map(inputs.map((one) => [one.id, one]))

  const roots = new Map<string, Set<string>>()
  for (const one of inputs) roots.set(one.id, new Set([one.id]))

  const notes: string[] = []
  const paths: ChainResult['paths'] = []

  for (const step of steps) {
    if (known.has(step.id)) return fail('duplicate', `There is already a quantity called "${step.id}".`)
    const parts: UncertainQuantity[] = []
    for (const id of step.from) {
      const part = quantities.get(id)
      if (!part) return fail('not-found', `"${step.label ?? step.id}" is built from "${id}", which does not exist yet.`)
      parts.push(part)
    }
    if (parts.length === 0) return fail('no-values', `"${step.label ?? step.id}" is built from nothing.`)

    const propagated = propagateFirstOrder(parts, step.model, options)
    if (isUncertaintyError(propagated)) return propagated

    const derived = uncertainQuantity(step.id, propagated.value, step.unit ?? '', {
      label: step.label ?? step.id,
      uncertainty: { value: propagated.standardUncertainty, kind: 'standard', coverageFactor: 1, source: 'propagated' },
      provenance: parts.reduce<Provenance>((acc, one) => combineProvenance(acc, one.provenance), 'derived')
    })
    if (isUncertaintyError(derived)) return derived
    quantities.set(step.id, derived)

    const mine = new Set<string>()
    for (const id of step.from) for (const root of roots.get(id) ?? []) mine.add(root)
    roots.set(step.id, mine)

    // Two inputs to this step that share a root are correlated, and this propagation treated them as independent.
    for (let i = 0; i < step.from.length; i++) {
      for (let j = i + 1; j < step.from.length; j++) {
        const a = roots.get(step.from[i]) ?? new Set<string>()
        const b = roots.get(step.from[j]) ?? new Set<string>()
        const shared = [...a].filter((one) => b.has(one))
        if (shared.length > 0) {
          notes.push(
            `"${step.label ?? step.id}" combines ${step.from[i]} and ${step.from[j]}, which both depend on ${shared.join(', ')}. They are therefore correlated, and this step treated them as independent, so its uncertainty is not right. Propagate from the original inputs in one step instead.`
          )
        }
      }
    }

    known.set(step.id, {
      id: step.id,
      label: step.label ?? step.id,
      from: [...step.from],
      value: propagated.value,
      standardUncertainty: propagated.standardUncertainty,
      unit: derived.unit.display,
      provenance: derived.provenance
    })
    paths.push({ to: step.id, through: [...mine] })
  }

  return { nodes: [...known.values()], paths, notes }
}

/** Whether a quantity's uncertainty has the same dimensions as its value, which it must. */
export function checkDimensions(one: UncertainQuantity, uncertaintyUnitText: string): UncertaintyError | { ok: true } {
  const unit = parseUnit(uncertaintyUnitText)
  if (isUnitError(unit)) return fail('invalid-unit', unit.message)
  if (!sameDimension(unit.dimension, one.unit.dimension)) {
    return fail(
      'dimension-mismatch',
      `${one.label} is measured in ${one.unit.display}, so its uncertainty cannot be in ${unit.display}. An uncertainty has the same dimensions as the quantity it belongs to.`
    )
  }
  return { ok: true }
}

/** The assumptions the whole engine rests on, for a Page that wants to show them rather than have them inferred. */
export const UNCERTAINTY_ASSUMPTIONS: readonly string[] = Object.freeze([
  'An exact value has no uncertainty. It is never given one so that a budget adds up.',
  'Independence is only ever assumed when no correlation was given, and every result says which it was.',
  'First-order propagation linearises the model. It is exact for a straight model and an approximation for any other.',
  'Finishing the requested number of trials is not convergence. Convergence is the standard error reaching a target.',
  'Failed and rejected trials are counted and reported, never quietly left out of the statistics.',
  'The same inputs, seed and model give the same answer. Nothing here uses unseeded randomness.',
  'Error needs a reference value; uncertainty does not. Neither is reported as the other.'
])
