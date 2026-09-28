/**
 * Statistics and probability, worked out rather than estimated.
 *
 * The shared statistical engine for Orbis Pages. Everything here is deterministic and everything reports the assumption it
 * rests on, because a statistic without its assumption is a number that can be quoted in the wrong argument.
 *
 * ## The distinctions this file refuses to blur
 *
 * ```
 * sample        vs   population      -- different denominators, different answers
 * variance      vs   standard error  -- one describes the data, the other describes the estimate
 * correlation   vs   causation       -- never claimed here, in any function
 * uncertainty   vs   confidence      -- a ± is not a 95% interval
 * missing       vs   zero            -- a gap is not a measurement of nothing
 * outlier       vs   wrong value     -- flagged, never removed
 * ```
 *
 * A function that cannot answer honestly returns a reason instead of a number. `mean([])` is not zero; it is "there is
 * nothing to average", and the difference matters when the empty list came from a filter that matched nothing.
 *
 * Pure. No network, no clock, no storage. Randomness is always seeded by the caller, so every result is reproducible.
 */

// ---------------------------------------------------------------- what a sample is

/**
 * Whether the numbers are everything there is, or a sample of something larger.
 *
 * This is not a formatting choice. A sample variance divides by n−1 and a population variance by n, and silently picking
 * one is silently answering a different question than the one asked.
 */
export type Population = 'sample' | 'population'

export interface StatisticsError {
  error: 'empty' | 'too-few' | 'not-finite' | 'zero-variance' | 'mismatched-length' | 'invalid-argument'
  message: string
}

export const isStatisticsError = (value: unknown): value is StatisticsError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

/**
 * The finite numbers in a list, and how many were not.
 *
 * Every function here starts by doing this, because a `null`, a `NaN` or an `undefined` in the middle of a column is the
 * normal state of real data and must not become a zero. How many were dropped travels with the answer.
 */
export function usable(values: readonly (number | null | undefined)[]): { numbers: number[]; missing: number } {
  const numbers: number[] = []
  let missing = 0
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) numbers.push(value)
    else missing += 1
  }
  return { numbers, missing }
}

// ---------------------------------------------------------------- describing one column

export interface Summary {
  count: number
  /** Entries that were not finite numbers. Reported rather than hidden, because it changes what the count means. */
  missing: number
  /**
   * What these numbers do not say on their own.
   *
   * A mean and a median printed side by side leave somebody to notice the gap between them. When there is a gap worth
   * noticing, this says so, because that is the difference between a summary and a list of statistics.
   */
  notes: string[]
  sum: number
  mean: number
  median: number
  /** Every value that occurs most often. Plural, because a list can genuinely have two. */
  modes: number[]
  minimum: number
  maximum: number
  range: number
  variance: number
  standardDeviation: number
  /** The standard deviation of the mean, which is a statement about the estimate rather than about the data. */
  standardError: number
  /** The 25th, 50th and 75th percentiles. */
  quartiles: [number, number, number]
  interquartileRange: number
  /** Median absolute deviation, which a single wild value cannot move the way it moves the standard deviation. */
  medianAbsoluteDeviation: number
  skewness: number
  /** Excess kurtosis: zero for a normal distribution rather than three, so the number reads as a comparison. */
  excessKurtosis: number
  population: Population
}

/**
 * The sum, computed so that a long list of similar values does not drift.
 *
 * Neumaier's compensated summation. Adding a million values around 1e8 naively loses the low bits of every one of them,
 * and the result is wrong in a way that looks plausible -- which is the worst kind of wrong for a total somebody will act
 * on.
 */
export function accurateSum(values: readonly number[]): number {
  let total = 0
  let compensation = 0
  for (const value of values) {
    const next = total + value
    compensation += Math.abs(total) >= Math.abs(value) ? total - next + value : value - next + total
    total = next
  }
  return total + compensation
}

export function mean(values: readonly number[]): number | StatisticsError {
  if (values.length === 0) return { error: 'empty', message: 'There is nothing to average.' }
  return accurateSum(values) / values.length
}

/** The values sorted ascending, as a new array. Never sorts the caller's list in place. */
export const sorted = (values: readonly number[]): number[] => [...values].sort((a, b) => a - b)

export function median(values: readonly number[]): number | StatisticsError {
  if (values.length === 0) return { error: 'empty', message: 'There is nothing to take the middle of.' }
  const order = sorted(values)
  const middle = order.length >> 1
  return order.length % 2 === 1 ? order[middle] : (order[middle - 1] + order[middle]) / 2
}

/**
 * Every value that occurs most often.
 *
 * A list can have two modes, or as many modes as it has values. Returning one would be picking arbitrarily, and returning
 * "no mode" when every value is distinct is the honest answer -- so that case gives back every value, and the caller can
 * see there is no peak.
 */
export function modes(values: readonly number[]): number[] {
  if (values.length === 0) return []
  const counts = new Map<number, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  const most = Math.max(...counts.values())
  return [...counts.entries()]
    .filter(([, n]) => n === most)
    .map(([value]) => value)
    .sort((a, b) => a - b)
}

/**
 * Variance, by Welford's method.
 *
 * The textbook formula subtracts two large nearly-equal numbers and can produce a negative variance for data that is
 * merely far from zero. This one accumulates instead, and cannot.
 */
export function variance(values: readonly number[], population: Population = 'sample'): number | StatisticsError {
  const n = values.length
  if (n === 0) return { error: 'empty', message: 'There is nothing to measure the spread of.' }
  if (population === 'sample' && n < 2) {
    // A single observation has no sample variance. Returning zero would claim certainty from one measurement.
    return { error: 'too-few', message: 'A sample variance needs at least two values.' }
  }
  let runningMean = 0
  let sumSquares = 0
  let seen = 0
  for (const value of values) {
    seen += 1
    const delta = value - runningMean
    runningMean += delta / seen
    sumSquares += delta * (value - runningMean)
  }
  return sumSquares / (population === 'sample' ? n - 1 : n)
}

export function standardDeviation(values: readonly number[], population: Population = 'sample'): number | StatisticsError {
  const spread = variance(values, population)
  return isStatisticsError(spread) ? spread : Math.sqrt(spread)
}

/** The standard deviation of the mean. A statement about how well the mean is known, not about the data's spread. */
export function standardError(values: readonly number[]): number | StatisticsError {
  const deviation = standardDeviation(values, 'sample')
  if (isStatisticsError(deviation)) return deviation
  return deviation / Math.sqrt(values.length)
}

/**
 * A percentile, by linear interpolation between the two nearest order statistics.
 *
 * The method is named because there are at least nine in use and they disagree on small samples. This is the one
 * `numpy.percentile` and most spreadsheets use, so a number from here matches a number from there.
 */
export function percentile(values: readonly number[], fraction: number): number | StatisticsError {
  if (values.length === 0) return { error: 'empty', message: 'There is nothing to take a percentile of.' }
  if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) {
    return { error: 'invalid-argument', message: 'A percentile is a fraction between 0 and 1.' }
  }
  const order = sorted(values)
  if (order.length === 1) return order[0]
  const at = fraction * (order.length - 1)
  const below = Math.floor(at)
  const above = Math.ceil(at)
  if (below === above) return order[below]
  return order[below] + (order[above] - order[below]) * (at - below)
}

export function quartiles(values: readonly number[]): [number, number, number] | StatisticsError {
  const first = percentile(values, 0.25)
  if (isStatisticsError(first)) return first
  const second = percentile(values, 0.5) as number
  const third = percentile(values, 0.75) as number
  return [first, second, third]
}

/** Median absolute deviation. A spread a single wild value cannot inflate the way it inflates a standard deviation. */
export function medianAbsoluteDeviation(values: readonly number[]): number | StatisticsError {
  const centre = median(values)
  if (isStatisticsError(centre)) return centre
  return median(values.map((value) => Math.abs(value - centre))) as number
}

/** Fisher-Pearson skewness, with the sample correction. Positive means a longer right tail. */
export function skewness(values: readonly number[]): number | StatisticsError {
  const n = values.length
  if (n < 3) return { error: 'too-few', message: 'Skewness needs at least three values.' }
  const centre = mean(values) as number
  const deviation = standardDeviation(values, 'population')
  if (isStatisticsError(deviation)) return deviation
  if (deviation === 0) return { error: 'zero-variance', message: 'Every value is the same, so there is no shape to describe.' }
  const third = accurateSum(values.map((value) => Math.pow((value - centre) / deviation, 3))) / n
  return (Math.sqrt(n * (n - 1)) / (n - 2)) * third
}

/** Excess kurtosis: zero for a normal distribution, so the number reads as a comparison rather than an absolute. */
export function excessKurtosis(values: readonly number[]): number | StatisticsError {
  const n = values.length
  if (n < 4) return { error: 'too-few', message: 'Kurtosis needs at least four values.' }
  const centre = mean(values) as number
  const deviation = standardDeviation(values, 'population')
  if (isStatisticsError(deviation)) return deviation
  if (deviation === 0) return { error: 'zero-variance', message: 'Every value is the same, so there is no shape to describe.' }
  const fourth = accurateSum(values.map((value) => Math.pow((value - centre) / deviation, 4))) / n
  return fourth - 3
}

/**
 * Everything describable about one column, in one pass over the assumptions.
 *
 * Returns an error rather than a partly-filled summary: a summary with some fields meaningful and others not is the thing
 * most likely to be read wrongly.
 */
export function summarise(
  values: readonly (number | null | undefined)[],
  population: Population = 'sample'
): Summary | StatisticsError {
  const { numbers, missing } = usable(values)
  if (numbers.length === 0) return { error: 'empty', message: 'There are no numbers here to describe.' }

  const centre = mean(numbers) as number
  const spread = variance(numbers, population)
  const deviation = isStatisticsError(spread) ? 0 : Math.sqrt(spread)
  const quarters = quartiles(numbers) as [number, number, number]
  const order = sorted(numbers)
  const shape = skewness(numbers)
  const tails = excessKurtosis(numbers)

  // Said outright when the mean and the median disagree. Nonparametric skew -- their gap in standard deviations --
  // rather than a raw difference, so the test means the same thing whatever the numbers are measured in. A tenth is
  // where the two start telling different stories about the same data.
  const notes: string[] = []
  const middle = median(numbers) as number
  if (deviation > 0) {
    const skew = (centre - middle) / deviation
    if (Math.abs(skew) > 0.1) {
      notes.push(
        `The mean (${Number(centre.toPrecision(4))}) and the median (${Number(middle.toPrecision(4))}) are noticeably apart, so these numbers are lopsided and the mean on its own will mislead. The median is the more representative of the two here.`
      )
    }
  }
  if (numbers.length < 5) {
    notes.push(`This is ${numbers.length} numbers. Almost nothing about a spread can be told from that few.`)
  }
  if (missing > 0) {
    notes.push(`${missing} ${missing === 1 ? 'value was' : 'values were'} not a number and ${missing === 1 ? 'was' : 'were'} left out. The rest is a summary of what remained, not of what you have.`)
  }

  return {
    count: numbers.length,
    missing,
    notes,
    sum: accurateSum(numbers),
    mean: centre,
    median: middle,
    modes: modes(numbers),
    minimum: order[0],
    maximum: order[order.length - 1],
    range: order[order.length - 1] - order[0],
    // Zero only when the spread genuinely could not be computed from one value, which `count` makes visible.
    variance: isStatisticsError(spread) ? 0 : spread,
    standardDeviation: deviation,
    standardError: numbers.length > 1 ? deviation / Math.sqrt(numbers.length) : 0,
    quartiles: quarters,
    interquartileRange: quarters[2] - quarters[0],
    medianAbsoluteDeviation: medianAbsoluteDeviation(numbers) as number,
    skewness: isStatisticsError(shape) ? 0 : shape,
    excessKurtosis: isStatisticsError(tails) ? 0 : tails,
    population
  }
}

// ---------------------------------------------------------------- weighted

/**
 * A weighted mean.
 *
 * Negative weights are refused rather than allowed to produce a "mean" outside the range of the data, which is what they
 * do and which nobody expects from something called a mean.
 */
export function weightedMean(values: readonly number[], weights: readonly number[]): number | StatisticsError {
  if (values.length !== weights.length) {
    return { error: 'mismatched-length', message: 'Every value needs exactly one weight.' }
  }
  if (values.length === 0) return { error: 'empty', message: 'There is nothing to average.' }
  if (weights.some((weight) => !Number.isFinite(weight) || weight < 0)) {
    return { error: 'invalid-argument', message: 'A weight cannot be negative or missing.' }
  }
  const total = accurateSum(weights)
  if (total === 0) return { error: 'invalid-argument', message: 'The weights add up to nothing.' }
  return accurateSum(values.map((value, i) => value * weights[i])) / total
}

// ---------------------------------------------------------------- two columns together

export interface Relationship {
  /** How many pairs both had a number for. */
  count: number
  /** Pairs dropped because one side was missing. Reported, because dropping half the data changes the answer. */
  dropped: number
  covariance: number
  /** Pearson's r. Measures straight-line association only. */
  pearson: number
  /** Spearman's rho: Pearson's r on the ranks, so it sees any increasing relationship rather than only a straight one. */
  spearman: number
  /** What r says, in words, with the causation warning attached. */
  describe: string
}

/** Pairs where both sides are numbers. Missing on either side drops the pair -- half a pair says nothing. */
function pairsOf(
  x: readonly (number | null | undefined)[],
  y: readonly (number | null | undefined)[]
): { xs: number[]; ys: number[]; dropped: number } | StatisticsError {
  if (x.length !== y.length) return { error: 'mismatched-length', message: 'The two columns have different lengths.' }
  const xs: number[] = []
  const ys: number[] = []
  let dropped = 0
  for (let i = 0; i < x.length; i++) {
    const a = x[i]
    const b = y[i]
    if (typeof a === 'number' && Number.isFinite(a) && typeof b === 'number' && Number.isFinite(b)) {
      xs.push(a)
      ys.push(b)
    } else dropped += 1
  }
  return { xs, ys, dropped }
}

export function covariance(
  x: readonly number[],
  y: readonly number[],
  population: Population = 'sample'
): number | StatisticsError {
  const pairs = pairsOf(x, y)
  if (isStatisticsError(pairs)) return pairs
  const n = pairs.xs.length
  if (n < 2) return { error: 'too-few', message: 'Covariance needs at least two complete pairs.' }
  const mx = mean(pairs.xs) as number
  const my = mean(pairs.ys) as number
  const total = accurateSum(pairs.xs.map((value, i) => (value - mx) * (pairs.ys[i] - my)))
  return total / (population === 'sample' ? n - 1 : n)
}

/** Ranks, averaging ties -- which is what makes Spearman's rho correct when values repeat. */
export function ranks(values: readonly number[]): number[] {
  const indexed = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value)
  const out = new Array<number>(values.length)
  let at = 0
  while (at < indexed.length) {
    let end = at
    while (end + 1 < indexed.length && indexed[end + 1].value === indexed[at].value) end += 1
    // The average rank for the whole tied run, so a repeated value does not get an arbitrary order.
    const average = (at + end) / 2 + 1
    for (let i = at; i <= end; i++) out[indexed[i].index] = average
    at = end + 1
  }
  return out
}

export function pearson(x: readonly number[], y: readonly number[]): number | StatisticsError {
  const pairs = pairsOf(x, y)
  if (isStatisticsError(pairs)) return pairs
  if (pairs.xs.length < 2) return { error: 'too-few', message: 'Correlation needs at least two complete pairs.' }
  const sx = standardDeviation(pairs.xs, 'sample')
  const sy = standardDeviation(pairs.ys, 'sample')
  if (isStatisticsError(sx)) return sx
  if (isStatisticsError(sy)) return sy
  if (sx === 0 || sy === 0) {
    // A constant column has no correlation with anything. Zero would be a claim; this is the absence of one.
    return { error: 'zero-variance', message: 'One of the columns never changes, so there is no correlation to measure.' }
  }
  const cov = covariance(pairs.xs, pairs.ys, 'sample') as number
  // Clamped: rounding can put a perfect correlation a hair outside ±1, and an |r| > 1 is meaningless.
  return Math.max(-1, Math.min(1, cov / (sx * sy)))
}

export const spearman = (x: readonly number[], y: readonly number[]): number | StatisticsError => {
  const pairs = pairsOf(x, y)
  if (isStatisticsError(pairs)) return pairs
  return pearson(ranks(pairs.xs), ranks(pairs.ys))
}

/** How strong an association is, in words. Always with the reminder, because this is where people stop reading. */
export function describeCorrelation(r: number): string {
  const size = Math.abs(r)
  const strength = size >= 0.9 ? 'very strong' : size >= 0.7 ? 'strong' : size >= 0.4 ? 'moderate' : size >= 0.2 ? 'weak' : 'very weak'
  const direction = r > 0 ? 'positive' : r < 0 ? 'negative' : 'no'
  return `A ${strength} ${direction} straight-line association. This says nothing about one causing the other.`
}

export function relationship(
  x: readonly (number | null | undefined)[],
  y: readonly (number | null | undefined)[]
): Relationship | StatisticsError {
  const pairs = pairsOf(x, y)
  if (isStatisticsError(pairs)) return pairs
  const r = pearson(pairs.xs, pairs.ys)
  if (isStatisticsError(r)) return r
  return {
    count: pairs.xs.length,
    dropped: pairs.dropped,
    covariance: covariance(pairs.xs, pairs.ys, 'sample') as number,
    pearson: r,
    spearman: spearman(pairs.xs, pairs.ys) as number,
    describe: describeCorrelation(r)
  }
}

// ---------------------------------------------------------------- fitting a line

export interface Regression {
  /** The intercept and each coefficient, in the order the predictors were given. */
  intercept: number
  coefficients: number[]
  /** Fraction of the variation the model accounts for. Not a measure of whether the model is right. */
  rSquared: number
  /** Adjusted for how many predictors were used, so adding a useless one does not look like an improvement. */
  adjustedRSquared: number
  residuals: number[]
  /** Root mean squared error, in the units of the thing being predicted. */
  rootMeanSquaredError: number
  count: number
  dropped: number
  /** Things true about this fit that a caller should not have to work out. */
  notes: string[]
}

/**
 * A least-squares fit.
 *
 * Solved through the normal equations with Gaussian elimination and partial pivoting. Fine for the handful of predictors a
 * Page will have; a rank-deficient design is detected and refused rather than producing coefficients that mean nothing.
 *
 * `rSquared` is deliberately described as "variation accounted for" rather than "goodness": a high R² on the wrong model
 * is exactly how people conclude the wrong thing, and this file will not help with that.
 */
export function regress(
  predictors: readonly (readonly (number | null | undefined)[])[],
  outcome: readonly (number | null | undefined)[]
): Regression | StatisticsError {
  const columns = predictors.length
  if (columns === 0) return { error: 'invalid-argument', message: 'A regression needs at least one predictor.' }
  for (const column of predictors) {
    if (column.length !== outcome.length) {
      return { error: 'mismatched-length', message: 'Every predictor needs the same number of rows as the outcome.' }
    }
  }

  // Complete rows only. A row missing one predictor cannot contribute to a fit over all of them.
  const rows: number[][] = []
  const targets: number[] = []
  let dropped = 0
  for (let i = 0; i < outcome.length; i++) {
    const y = outcome[i]
    const xs = predictors.map((column) => column[i])
    if (typeof y !== 'number' || !Number.isFinite(y) || xs.some((x) => typeof x !== 'number' || !Number.isFinite(x))) {
      dropped += 1
      continue
    }
    rows.push([1, ...(xs as number[])])
    targets.push(y)
  }

  const n = rows.length
  const width = columns + 1
  if (n < width) {
    return {
      error: 'too-few',
      message: `A fit with ${columns} predictor${columns === 1 ? '' : 's'} needs at least ${width} complete rows; there ${n === 1 ? 'is' : 'are'} ${n}.`
    }
  }

  // Normal equations: XᵀX b = Xᵀy.
  const normal: number[][] = Array.from({ length: width }, () => new Array<number>(width + 1).fill(0))
  for (let i = 0; i < width; i++) {
    for (let j = 0; j < width; j++) {
      normal[i][j] = accurateSum(rows.map((row) => row[i] * row[j]))
    }
    normal[i][width] = accurateSum(rows.map((row, r) => row[i] * targets[r]))
  }

  for (let column = 0; column < width; column++) {
    let best = column
    for (let r = column + 1; r < width; r++) if (Math.abs(normal[r][column]) > Math.abs(normal[best][column])) best = r
    const scale = Math.max(...normal.flat().map(Math.abs), 1)
    if (Math.abs(normal[best][column]) <= scale * 1e-12) {
      // Two predictors carrying the same information, or one that never changes. Coefficients would be arbitrary.
      return {
        error: 'zero-variance',
        message: 'The predictors do not carry independent information, so there is no single best fit.'
      }
    }
    ;[normal[column], normal[best]] = [normal[best], normal[column]]
    for (let r = 0; r < width; r++) {
      if (r === column) continue
      const factor = normal[r][column] / normal[column][column]
      if (factor === 0) continue
      for (let c = column; c <= width; c++) normal[r][c] -= factor * normal[column][c]
    }
  }

  const solved = normal.map((row, i) => row[width] / row[i])
  const [intercept, ...coefficients] = solved

  const predicted = rows.map((row) => accurateSum(row.map((value, i) => value * solved[i])))
  const residuals = targets.map((value, i) => value - predicted[i])
  const meanTarget = mean(targets) as number
  const totalSquares = accurateSum(targets.map((value) => (value - meanTarget) ** 2))
  const residualSquares = accurateSum(residuals.map((value) => value ** 2))
  const rSquared = totalSquares === 0 ? 1 : 1 - residualSquares / totalSquares
  const adjusted = n - width > 0 ? 1 - ((1 - rSquared) * (n - 1)) / (n - width) : rSquared

  const notes: string[] = [
    'Least squares. The fit assumes the relationship is a straight line in each predictor and that the errors are independent.'
  ]
  if (dropped > 0) notes.push(`${dropped} row${dropped === 1 ? '' : 's'} had a value missing and could not be used.`)
  if (totalSquares === 0) notes.push('The outcome never changes, so any line fits it equally well.')
  if (n === width) {
    // As many rows as things to estimate. The line passes exactly through every point because it has no choice, so R² is
    // 1 by construction and means nothing. Allowed, because fitting a line through two points is a reasonable thing to
    // want -- but never allowed to look like evidence.
    notes.push(
      `There are exactly as many rows (${n}) as things to estimate, so this fit passes through every point by construction. R² is 1 whatever the data, and says nothing about whether the relationship is real.`
    )
  }

  return {
    intercept,
    coefficients,
    rSquared,
    adjustedRSquared: adjusted,
    residuals,
    rootMeanSquaredError: Math.sqrt(residualSquares / n),
    count: n,
    dropped,
    notes
  }
}

/** A straight line through two columns, which is the case almost every Page wants. */
export const fitLine = (
  x: readonly (number | null | undefined)[],
  y: readonly (number | null | undefined)[]
): Regression | StatisticsError => regress([x], y)

// ---------------------------------------------------------------- distributions

export interface DistributionShape {
  id: string
  name: string
  /** True where the distribution has a value at all. */
  support: string
  /** Density for a continuous distribution, probability mass for a discrete one. */
  density(x: number, ...parameters: number[]): number
  /** The probability of being at or below x. */
  cumulative(x: number, ...parameters: number[]): number
  parameters: { name: string; describe: string }[]
  discrete: boolean
}

/** The error function, by Abramowitz and Stegun 7.1.26. Accurate to about 1.5e-7, which is stated rather than implied. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1
  const z = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * z)
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z)
  return sign * y
}

/** The natural log of the gamma function, by the Lanczos approximation. Used by the factorial-like terms below. */
function logGamma(x: number): number {
  const g = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7
  ]
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x)
  let z = x - 1
  let a = 0.99999999999980993
  const t = z + 7.5
  for (let i = 0; i < g.length; i++) a += g[i] / (z + i + 1)
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a)
}

/** The regularised lower incomplete gamma function, for the Poisson and chi-square cumulatives. */
function lowerGamma(s: number, x: number): number {
  if (x <= 0) return 0
  if (x < s + 1) {
    // Series expansion, which converges quickly on this side.
    let sum = 1 / s
    let term = sum
    for (let n = 1; n < 400; n++) {
      term *= x / (s + n)
      sum += term
      if (Math.abs(term) < Math.abs(sum) * 1e-15) break
    }
    return sum * Math.exp(-x + s * Math.log(x) - logGamma(s))
  }
  // Continued fraction, for the other side.
  let b = x + 1 - s
  let c = 1e300
  let d = 1 / b
  let h = d
  for (let i = 1; i < 400; i++) {
    const an = -i * (i - s)
    b += 2
    d = an * d + b
    if (Math.abs(d) < 1e-300) d = 1e-300
    c = b + an / c
    if (Math.abs(c) < 1e-300) c = 1e-300
    d = 1 / d
    const delta = d * c
    h *= delta
    if (Math.abs(delta - 1) < 1e-15) break
  }
  return 1 - Math.exp(-x + s * Math.log(x) - logGamma(s)) * h
}

const logFactorial = (n: number): number => logGamma(n + 1)

/** log of n choose k, computed through log-gamma so a large n does not overflow. */
const logChoose = (n: number, k: number): number => logFactorial(n) - logFactorial(k) - logFactorial(n - k)

/** The regularised incomplete beta function, for the Student-t cumulative. */
function incompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x))
  // Lentz's continued fraction.
  let f = 1
  let c = 1
  let d = 0
  for (let i = 0; i <= 300; i++) {
    const m = Math.floor(i / 2)
    let numerator: number
    if (i === 0) numerator = 1
    else if (i % 2 === 0) numerator = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m))
    else numerator = -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1))
    d = 1 + numerator * d
    if (Math.abs(d) < 1e-300) d = 1e-300
    d = 1 / d
    c = 1 + numerator / c
    if (Math.abs(c) < 1e-300) c = 1e-300
    const delta = c * d
    f *= delta
    if (Math.abs(delta - 1) < 1e-15) break
  }
  const result = (front * (f - 1)) / a
  return Math.max(0, Math.min(1, result))
}

/** The distributions Orbis knows. A distribution not here is one Orbis refuses rather than approximates. */
export const DISTRIBUTIONS: Record<string, DistributionShape> = {
  normal: {
    id: 'normal',
    name: 'Normal',
    support: 'every real number',
    discrete: false,
    parameters: [
      { name: 'mean', describe: 'where the peak is' },
      { name: 'standardDeviation', describe: 'how wide it is' }
    ],
    density: (x, mu = 0, sigma = 1) =>
      sigma <= 0 ? Number.NaN : Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma)) / (sigma * Math.sqrt(2 * Math.PI)),
    cumulative: (x, mu = 0, sigma = 1) => (sigma <= 0 ? Number.NaN : 0.5 * (1 + erf((x - mu) / (sigma * Math.SQRT2))))
  },
  uniform: {
    id: 'uniform',
    name: 'Uniform',
    support: 'between the two bounds',
    discrete: false,
    parameters: [
      { name: 'low', describe: 'the smallest value' },
      { name: 'high', describe: 'the largest value' }
    ],
    density: (x, low = 0, high = 1) => (high <= low ? Number.NaN : x < low || x > high ? 0 : 1 / (high - low)),
    cumulative: (x, low = 0, high = 1) =>
      high <= low ? Number.NaN : x < low ? 0 : x > high ? 1 : (x - low) / (high - low)
  },
  exponential: {
    id: 'exponential',
    name: 'Exponential',
    support: 'zero and above',
    discrete: false,
    parameters: [{ name: 'rate', describe: 'events per unit' }],
    density: (x, rate = 1) => (rate <= 0 ? Number.NaN : x < 0 ? 0 : rate * Math.exp(-rate * x)),
    cumulative: (x, rate = 1) => (rate <= 0 ? Number.NaN : x < 0 ? 0 : 1 - Math.exp(-rate * x))
  },
  binomial: {
    id: 'binomial',
    name: 'Binomial',
    support: 'whole numbers from 0 to n',
    discrete: true,
    parameters: [
      { name: 'trials', describe: 'how many attempts' },
      { name: 'probability', describe: 'chance of success each time' }
    ],
    density: (k, n = 1, p = 0.5) => {
      if (n < 0 || p < 0 || p > 1 || !Number.isInteger(k) || k < 0 || k > n) return 0
      if (p === 0) return k === 0 ? 1 : 0
      if (p === 1) return k === n ? 1 : 0
      return Math.exp(logChoose(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p))
    },
    cumulative: (k, n = 1, p = 0.5) => {
      if (n < 0 || p < 0 || p > 1) return Number.NaN
      const top = Math.min(n, Math.floor(k))
      if (top < 0) return 0
      let total = 0
      for (let i = 0; i <= top; i++) total += DISTRIBUTIONS.binomial.density(i, n, p)
      return Math.min(1, total)
    }
  },
  poisson: {
    id: 'poisson',
    name: 'Poisson',
    support: 'whole numbers from zero up',
    discrete: true,
    parameters: [{ name: 'rate', describe: 'average count' }],
    density: (k, lambda = 1) => {
      if (lambda < 0 || !Number.isInteger(k) || k < 0) return 0
      return Math.exp(-lambda + k * Math.log(lambda === 0 ? 1 : lambda) - logFactorial(k)) * (lambda === 0 ? (k === 0 ? 1 : 0) : 1)
    },
    cumulative: (k, lambda = 1) => {
      if (lambda < 0) return Number.NaN
      if (k < 0) return 0
      return 1 - lowerGamma(Math.floor(k) + 1, lambda)
    }
  },
  t: {
    id: 't',
    name: 'Student-t',
    support: 'every real number',
    discrete: false,
    parameters: [{ name: 'degreesOfFreedom', describe: 'roughly the sample size minus one' }],
    density: (x, df = 1) =>
      df <= 0
        ? Number.NaN
        : Math.exp(logGamma((df + 1) / 2) - logGamma(df / 2)) / Math.sqrt(df * Math.PI) * Math.pow(1 + (x * x) / df, -(df + 1) / 2),
    cumulative: (x, df = 1) => {
      if (df <= 0) return Number.NaN
      const half = incompleteBeta(df / 2, 0.5, df / (df + x * x)) / 2
      return x > 0 ? 1 - half : half
    }
  },
  chiSquare: {
    id: 'chiSquare',
    name: 'Chi-square',
    support: 'zero and above',
    discrete: false,
    parameters: [{ name: 'degreesOfFreedom', describe: 'how many independent parts' }],
    density: (x, df = 1) =>
      df <= 0 || x < 0
        ? x < 0
          ? 0
          : Number.NaN
        : Math.exp((df / 2 - 1) * Math.log(x) - x / 2 - (df / 2) * Math.LN2 - logGamma(df / 2)),
    cumulative: (x, df = 1) => (df <= 0 ? Number.NaN : x <= 0 ? 0 : lowerGamma(df / 2, x / 2))
  }
}

/** A distribution by id, without the prototype chain answering for a name nobody defined. */
export const distributionById = (id: string): DistributionShape | null =>
  typeof id === 'string' && Object.prototype.hasOwnProperty.call(DISTRIBUTIONS, id) ? DISTRIBUTIONS[id] : null

/**
 * The value below which a given fraction of a distribution lies.
 *
 * Found by bisection on the cumulative rather than by a closed form, because a closed form exists for very few of these
 * and a table would be a second place for the numbers to be wrong.
 */
export function quantileOf(distribution: DistributionShape, fraction: number, ...parameters: number[]): number | StatisticsError {
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction >= 1) {
    return { error: 'invalid-argument', message: 'A quantile needs a fraction strictly between 0 and 1.' }
  }
  let low = -1
  let high = 1
  // Widen until the answer is bracketed, with a bound so a bad parameter cannot loop forever.
  for (let i = 0; i < 200 && distribution.cumulative(low, ...parameters) > fraction; i++) low *= 2
  for (let i = 0; i < 200 && distribution.cumulative(high, ...parameters) < fraction; i++) high *= 2
  for (let i = 0; i < 200; i++) {
    const middle = (low + high) / 2
    const at = distribution.cumulative(middle, ...parameters)
    if (!Number.isFinite(at)) return { error: 'invalid-argument', message: 'That distribution has no value with those parameters.' }
    if (at < fraction) low = middle
    else high = middle
    if (high - low <= Math.max(1e-12, Math.abs(middle) * 1e-12)) break
  }
  return (low + high) / 2
}

// ---------------------------------------------------------------- confidence

export interface Interval {
  low: number
  high: number
  /** The fraction the interval is meant to contain, as it was asked for. */
  level: number
  /** What the interval actually means, because this is the most misread number in statistics. */
  describe: string
}

/**
 * A confidence interval for a mean.
 *
 * Uses the t distribution rather than the normal one, because the standard deviation is estimated from the same data --
 * which is exactly when the normal approximation is too narrow and the interval is quietly wrong.
 *
 * The description says what the interval means. "95% confident the mean is in here" is the wrong reading and the common
 * one, so the right reading travels with the numbers.
 */
export function meanInterval(values: readonly number[], level = 0.95): Interval | StatisticsError {
  if (!Number.isFinite(level) || level <= 0 || level >= 1) {
    return { error: 'invalid-argument', message: 'A confidence level is a fraction strictly between 0 and 1.' }
  }
  const n = values.length
  if (n < 2) return { error: 'too-few', message: 'A confidence interval needs at least two values.' }
  const centre = mean(values) as number
  const error = standardError(values)
  if (isStatisticsError(error)) return error
  const critical = quantileOf(DISTRIBUTIONS.t, 1 - (1 - level) / 2, n - 1)
  if (isStatisticsError(critical)) return critical
  const half = critical * error
  return {
    low: centre - half,
    high: centre + half,
    level,
    describe: `If this were repeated many times, ${Math.round(level * 100)}% of intervals built this way would contain the true mean. It does not say there is a ${Math.round(level * 100)}% chance this particular one does.`
  }
}

// ---------------------------------------------------------------- hypothesis tests

export interface TestResult {
  test: string
  statistic: number
  degreesOfFreedom: number | null
  pValue: number
  /** What was assumed. Part of the result, because a test whose assumptions fail is not a weaker test but a wrong one. */
  assumptions: string[]
  /** What the p-value does and does not say. */
  describe: string
}

const P_WARNING =
  'A p-value is the chance of data at least this extreme if the null hypothesis were true. It is not the chance the null hypothesis is true, and it says nothing about how large the effect is.'

/**
 * A one-sample t test.
 *
 * Two-sided. No threshold is applied anywhere in this file: 0.05 is a convention, not a fact, and a function that returned
 * `significant: true` would be making somebody's decision for them.
 */
export function oneSampleT(values: readonly number[], against: number): TestResult | StatisticsError {
  const n = values.length
  if (n < 2) return { error: 'too-few', message: 'A t test needs at least two values.' }
  const error = standardError(values)
  if (isStatisticsError(error)) return error
  if (error === 0) return { error: 'zero-variance', message: 'Every value is identical, so there is nothing to test.' }
  const t = ((mean(values) as number) - against) / error
  const df = n - 1
  const p = 2 * (1 - DISTRIBUTIONS.t.cumulative(Math.abs(t), df))
  return {
    test: 'one-sample t',
    statistic: t,
    degreesOfFreedom: df,
    pValue: Math.max(0, Math.min(1, p)),
    assumptions: [
      'The values are independent of one another.',
      'The underlying distribution is roughly symmetric, or the sample is large enough that it does not matter.'
    ],
    describe: P_WARNING
  }
}

/**
 * A two-sample t test, Welch's version.
 *
 * Welch rather than Student because equal variances are an assumption people make without checking, and Welch does not
 * need it. The cost is a fractional degrees of freedom, which is correct rather than tidy.
 */
export function twoSampleT(a: readonly number[], b: readonly number[]): TestResult | StatisticsError {
  if (a.length < 2 || b.length < 2) return { error: 'too-few', message: 'Each group needs at least two values.' }
  const va = variance(a, 'sample')
  const vb = variance(b, 'sample')
  if (isStatisticsError(va)) return va
  if (isStatisticsError(vb)) return vb
  const sa = va / a.length
  const sb = vb / b.length
  if (sa + sb === 0) return { error: 'zero-variance', message: 'Neither group varies, so there is nothing to test.' }
  const t = ((mean(a) as number) - (mean(b) as number)) / Math.sqrt(sa + sb)
  const df = (sa + sb) ** 2 / (sa ** 2 / (a.length - 1) + sb ** 2 / (b.length - 1))
  const p = 2 * (1 - DISTRIBUTIONS.t.cumulative(Math.abs(t), df))
  return {
    test: "Welch's two-sample t",
    statistic: t,
    degreesOfFreedom: df,
    pValue: Math.max(0, Math.min(1, p)),
    assumptions: [
      'The two groups are independent of each other.',
      'Welch’s version is used, so the two groups are not assumed to have equal spread.'
    ],
    describe: P_WARNING
  }
}

/** A paired t test, for two measurements of the same things. Pairs with a missing side are dropped and counted. */
export function pairedT(
  before: readonly (number | null | undefined)[],
  after: readonly (number | null | undefined)[]
): TestResult | StatisticsError {
  const pairs = pairsOf(before, after)
  if (isStatisticsError(pairs)) return pairs
  const differences = pairs.xs.map((value, i) => pairs.ys[i] - value)
  const result = oneSampleT(differences, 0)
  if (isStatisticsError(result)) return result
  return {
    ...result,
    test: 'paired t',
    assumptions: [
      'Each pair is two measurements of the same thing.',
      'The differences are independent of one another.',
      ...(pairs.dropped > 0 ? [`${pairs.dropped} pair${pairs.dropped === 1 ? '' : 's'} had a value missing and was left out.`] : [])
    ]
  }
}

/**
 * Pearson's chi-square test on a contingency table.
 *
 * Refuses a table with an expected count below one, and warns below five: the approximation the test rests on does not hold
 * there, and a p-value from it is a number rather than an answer.
 */
export function chiSquareTest(table: readonly (readonly number[])[]): TestResult | StatisticsError {
  const rows = table.length
  if (rows < 2) return { error: 'too-few', message: 'A chi-square test needs at least two rows.' }
  const columns = table[0]?.length ?? 0
  if (columns < 2) return { error: 'too-few', message: 'A chi-square test needs at least two columns.' }
  if (table.some((row) => row.length !== columns)) {
    return { error: 'mismatched-length', message: 'Every row of the table needs the same number of columns.' }
  }
  if (table.some((row) => row.some((cell) => !Number.isFinite(cell) || cell < 0))) {
    return { error: 'invalid-argument', message: 'Every cell has to be a count of zero or more.' }
  }

  const rowTotals = table.map((row) => accurateSum(row))
  const columnTotals = Array.from({ length: columns }, (_, c) => accurateSum(table.map((row) => row[c])))
  const total = accurateSum(rowTotals)
  if (total === 0) return { error: 'empty', message: 'The table is all zeros.' }

  let statistic = 0
  let smallest = Number.POSITIVE_INFINITY
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const expected = (rowTotals[r] * columnTotals[c]) / total
      smallest = Math.min(smallest, expected)
      if (expected === 0) continue
      statistic += (table[r][c] - expected) ** 2 / expected
    }
  }
  if (smallest < 1) {
    return {
      error: 'too-few',
      message: 'An expected count is below one, so the chi-square approximation does not hold and no p-value is worth reporting.'
    }
  }

  const df = (rows - 1) * (columns - 1)
  return {
    test: "Pearson's chi-square",
    statistic,
    degreesOfFreedom: df,
    pValue: Math.max(0, Math.min(1, 1 - DISTRIBUTIONS.chiSquare.cumulative(statistic, df))),
    assumptions: [
      'Every observation falls in exactly one cell.',
      'The observations are independent of one another.',
      ...(smallest < 5
        ? [`The smallest expected count is ${Number(smallest.toFixed(2))}. Below five the approximation is poor and the p-value should be treated as rough.`]
        : [])
    ],
    describe: P_WARNING
  }
}

// ---------------------------------------------------------------- outliers, flagged not removed

export type OutlierMethod = 'iqr' | 'z-score' | 'modified-z'

export interface Outliers {
  method: OutlierMethod
  /** Positions in the original list. Positions, not values, so a caller can look at the row it came from. */
  indices: number[]
  low: number
  high: number
  /** Why these and not others, so the choice can be argued with. */
  describe: string
}

/**
 * Values unusually far from the rest.
 *
 * Flagged, never removed. An outlier is as likely to be the interesting measurement as a mistake, and a function that
 * quietly dropped it would be deciding which.
 *
 * `modified-z` uses the median and the median absolute deviation, so a single extreme value cannot hide itself by
 * inflating the spread it is measured against -- which is the failure mode of the plain z-score method.
 */
export function outliers(
  values: readonly (number | null | undefined)[],
  method: OutlierMethod = 'iqr',
  threshold?: number
): Outliers | StatisticsError {
  const { numbers } = usable(values)
  if (numbers.length < 4) return { error: 'too-few', message: 'Finding outliers needs at least four values.' }

  let low: number
  let high: number
  let describe: string

  if (method === 'iqr') {
    const [q1, , q3] = quartiles(numbers) as [number, number, number]
    const spread = q3 - q1
    const factor = threshold ?? 1.5
    low = q1 - factor * spread
    high = q3 + factor * spread
    describe = `Outside ${factor} times the interquartile range beyond the quartiles. This is Tukey's rule, a convention rather than a test.`
  } else if (method === 'z-score') {
    const centre = mean(numbers) as number
    const deviation = standardDeviation(numbers, 'sample')
    if (isStatisticsError(deviation)) return deviation
    if (deviation === 0) return { error: 'zero-variance', message: 'Every value is the same, so none of them is unusual.' }
    const factor = threshold ?? 3
    low = centre - factor * deviation
    high = centre + factor * deviation
    describe = `More than ${factor} standard deviations from the mean. A single extreme value inflates that spread, so this method can hide the very thing it is looking for.`
  } else {
    const centre = median(numbers) as number
    const deviation = medianAbsoluteDeviation(numbers) as number
    if (deviation === 0) return { error: 'zero-variance', message: 'More than half the values are identical, so this method cannot measure spread.' }
    const factor = threshold ?? 3.5
    // 0.6745 makes the modified z-score comparable to an ordinary one for normal data.
    const scale = (factor * deviation) / 0.6745
    low = centre - scale
    high = centre + scale
    describe = `More than ${factor} modified z-scores from the median. Built on the median, so one extreme value cannot disguise itself.`
  }

  const indices: number[] = []
  values.forEach((value, index) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return
    if (value < low || value > high) indices.push(index)
  })

  return { method, indices, low, high, describe: `${describe} These are flagged, not removed.` }
}

// ---------------------------------------------------------------- histograms

export interface Histogram {
  bins: { from: number; to: number; count: number }[]
  /** How the bin width was chosen, because a histogram's shape depends on it more than on the data. */
  rule: string
  binWidth: number
  count: number
  missing: number
}

export type BinRule = 'sturges' | 'freedman-diaconis' | 'square-root' | 'fixed'

/**
 * A histogram.
 *
 * The rule used is part of the answer. The same data with Sturges' rule and with Freedman-Diaconis can look unimodal or
 * bimodal, and a histogram presented without its binning is a picture that cannot be checked.
 *
 * Freedman-Diaconis is the default because it uses the interquartile range and so is not thrown off by a long tail.
 */
export function histogram(
  values: readonly (number | null | undefined)[],
  rule: BinRule = 'freedman-diaconis',
  fixedBins?: number
): Histogram | StatisticsError {
  const { numbers, missing } = usable(values)
  if (numbers.length === 0) return { error: 'empty', message: 'There is nothing to put in bins.' }
  const order = sorted(numbers)
  const low = order[0]
  const high = order[order.length - 1]

  if (low === high) {
    // One distinct value. A single bin is the truth; splitting it would invent structure.
    return {
      bins: [{ from: low, to: high, count: numbers.length }],
      rule: 'every value is the same, so there is one bin',
      binWidth: 0,
      count: numbers.length,
      missing
    }
  }

  let count: number
  let describe: string
  if (rule === 'fixed') {
    if (!Number.isFinite(fixedBins as number) || (fixedBins as number) < 1) {
      return { error: 'invalid-argument', message: 'A fixed histogram needs a bin count of one or more.' }
    }
    count = Math.min(1000, Math.round(fixedBins as number))
    describe = `${count} bins, as asked for`
  } else if (rule === 'square-root') {
    count = Math.ceil(Math.sqrt(numbers.length))
    describe = "the square root of the count, a rough rule"
  } else if (rule === 'sturges') {
    count = Math.ceil(Math.log2(numbers.length) + 1)
    describe = "Sturges' rule, which assumes roughly normal data and under-bins a long tail"
  } else {
    const [q1, , q3] = quartiles(numbers) as [number, number, number]
    const width = (2 * (q3 - q1)) / Math.cbrt(numbers.length)
    count = width > 0 ? Math.min(1000, Math.max(1, Math.ceil((high - low) / width))) : Math.ceil(Math.sqrt(numbers.length))
    describe = 'Freedman-Diaconis, which uses the interquartile range and so is not thrown off by a long tail'
  }

  const width = (high - low) / count
  const bins = Array.from({ length: count }, (_, i) => ({ from: low + i * width, to: low + (i + 1) * width, count: 0 }))
  for (const value of numbers) {
    // The last bin includes its upper edge, so the maximum is counted somewhere.
    const at = Math.min(count - 1, Math.floor((value - low) / width))
    bins[at].count += 1
  }

  return { bins, rule: describe, binWidth: width, count: numbers.length, missing }
}

// ---------------------------------------------------------------- reproducible randomness

/**
 * A seeded pseudo-random source.
 *
 * xorshift32. Not cryptographic and never to be used where that matters -- it is here so that a simulation, a bootstrap or
 * a sample can be run again and give the same answer, which `Math.random` cannot promise.
 */
export function randomSource(seed: number): () => number {
  let state = Math.floor(Math.abs(seed)) || 0x2545f491
  return () => {
    state ^= state << 13
    state >>>= 0
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state / 0x100000000
  }
}

/** A list shuffled, reproducibly. Fisher-Yates, so every ordering is equally likely. */
export function shuffle<T>(values: readonly T[], seed: number): T[] {
  const out = [...values]
  const random = randomSource(seed)
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export interface Bootstrap {
  /** The statistic on the data as it is. */
  observed: number
  /** The middle of the resampled statistics, which is not the same as the observed one. */
  resampledMean: number
  standardError: number
  interval: Interval
  resamples: number
  seed: number
  notes: string[]
}

/**
 * A bootstrap estimate of how well a statistic is known.
 *
 * Resamples the data with replacement. The interval is a percentile interval, which is the simplest and is honest about
 * being so: it is biased for a skewed statistic, and the note says that rather than leaving it to be discovered.
 *
 * Nothing is generated. Every resample is drawn from values that were actually measured, which is what makes this
 * different from simulating data.
 */
export function bootstrap(
  values: readonly number[],
  statistic: (sample: readonly number[]) => number | StatisticsError,
  options: { resamples?: number; seed?: number; level?: number } = {}
): Bootstrap | StatisticsError {
  const n = values.length
  if (n < 2) return { error: 'too-few', message: 'A bootstrap needs at least two values.' }
  const resamples = Math.min(20000, Math.max(50, Math.round(options.resamples ?? 2000)))
  const seed = Math.round(options.seed ?? 1)
  const level = options.level ?? 0.95
  if (!Number.isFinite(level) || level <= 0 || level >= 1) {
    return { error: 'invalid-argument', message: 'A confidence level is a fraction strictly between 0 and 1.' }
  }

  const observed = statistic(values)
  if (isStatisticsError(observed)) return observed

  const random = randomSource(seed)
  const drawn: number[] = []
  const sample = new Array<number>(n)
  for (let r = 0; r < resamples; r++) {
    for (let i = 0; i < n; i++) sample[i] = values[Math.floor(random() * n)]
    const value = statistic(sample)
    // A resample the statistic cannot describe is skipped and counted, rather than becoming a zero in the distribution.
    if (!isStatisticsError(value)) drawn.push(value)
  }
  if (drawn.length < 20) {
    return { error: 'too-few', message: 'Too few resamples produced a usable statistic to estimate anything from.' }
  }

  const low = percentile(drawn, (1 - level) / 2) as number
  const high = percentile(drawn, 1 - (1 - level) / 2) as number
  const notes = [
    `${drawn.length} of ${resamples} resamples produced a usable value.`,
    'A percentile interval. Simple, and biased when the statistic is skewed.',
    `Seed ${seed}: the same seed and the same data give the same answer.`
  ]

  return {
    observed,
    resampledMean: mean(drawn) as number,
    standardError: standardDeviation(drawn, 'sample') as number,
    interval: {
      low,
      high,
      level,
      describe: `The middle ${Math.round(level * 100)}% of the resampled statistics. It describes how much the statistic moves when the sample is redrawn from itself, not how much the truth could differ.`
    },
    resamples: drawn.length,
    seed,
    notes
  }
}

/** The assumptions that hold for everything in this file, for a Page that wants to show them. */
export const STATISTICS_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Sample and population statistics use different denominators, and which one was used is reported with every result.',
  'A missing value is never treated as zero. How many were dropped travels with the answer.',
  'No correlation here implies causation, and no function in this engine claims one.',
  'No threshold is applied to a p-value. 0.05 is a convention, not a fact, and the decision is not this engine’s to make.',
  'An outlier is flagged, never removed: it is as likely to be the interesting measurement as a mistake.',
  'Randomness is always seeded by the caller, so every result can be reproduced.'
])
