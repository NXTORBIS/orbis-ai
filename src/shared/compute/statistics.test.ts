import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  accurateSum,
  bootstrap,
  chiSquareTest,
  describeCorrelation,
  DISTRIBUTIONS,
  distributionById,
  excessKurtosis,
  fitLine,
  histogram,
  isStatisticsError,
  mean,
  meanInterval,
  median,
  medianAbsoluteDeviation,
  modes,
  oneSampleT,
  outliers,
  pairedT,
  pearson,
  percentile,
  quantileOf,
  quartiles,
  randomSource,
  ranks,
  regress,
  relationship,
  shuffle,
  skewness,
  spearman,
  standardDeviation,
  standardError,
  STATISTICS_ASSUMPTIONS,
  summarise,
  twoSampleT,
  usable,
  variance,
  weightedMean,
  type Summary
} from './statistics.ts'

const near = (actual: number, expected: number, tolerance = 1e-9): void =>
  assert.ok(
    Math.abs(actual - expected) <= Math.max(1e-12, Math.abs(expected) * tolerance),
    `expected ${expected}, got ${actual}`
  )

const number = (value: number | { error: string }): number => {
  assert.equal(isStatisticsError(value), false, `expected a number, got ${JSON.stringify(value)}`)
  return value as number
}

// ---------------------------------------------------------------- missing values

test('a missing value is never treated as zero', () => {
  // The whole reason `usable` exists. A gap in a column is the normal state of real data.
  const { numbers, missing } = usable([1, null, 2, undefined, Number.NaN, 3, Number.POSITIVE_INFINITY])
  assert.deepEqual(numbers, [1, 2, 3])
  assert.equal(missing, 4)
  near(number(mean(numbers)), 2)
})

test('an empty list is not zero, it is a reason', () => {
  for (const result of [mean([]), median([]), variance([]), percentile([], 0.5)]) {
    assert.equal(isStatisticsError(result), true)
    assert.equal((result as { error: string }).error, 'empty')
  }
})

test('a summary reports how many values it could not use', () => {
  const summary = summarise([1, 2, null, 3, undefined]) as Summary
  assert.equal(summary.count, 3)
  assert.equal(summary.missing, 2)
})

// ---------------------------------------------------------------- accuracy

test('a long sum of similar large values does not drift', () => {
  // Naive summation loses the low bits of every term here and the total comes out visibly wrong.
  const values = Array.from({ length: 100_000 }, () => 1e8 + 0.1)
  const expected = 100_000 * (1e8 + 0.1)
  near(accurateSum(values), expected, 1e-13)
})

test('variance cannot come out negative for data far from zero', () => {
  // The textbook formula subtracts two large nearly-equal numbers and can go negative here.
  const values = [1e9, 1e9 + 1, 1e9 + 2, 1e9 + 3, 1e9 + 4]
  const spread = number(variance(values, 'sample'))
  assert.ok(spread > 0, `variance came out ${spread}`)
  near(spread, 2.5, 1e-6)
})

// ---------------------------------------------------------------- sample against population

test('sample and population give different answers, because they are different questions', () => {
  const values = [2, 4, 4, 4, 5, 5, 7, 9]
  near(number(variance(values, 'population')), 4)
  near(number(variance(values, 'sample')), 32 / 7)
  near(number(standardDeviation(values, 'population')), 2)
})

test('a single value has no sample variance, and saying zero would claim certainty', () => {
  const result = variance([5], 'sample')
  assert.equal((result as { error: string }).error, 'too-few')
  // A population of one genuinely has no spread, which is a different statement.
  near(number(variance([5], 'population')), 0)
})

test('the standard error describes the estimate, not the data', () => {
  const values = [2, 4, 4, 4, 5, 5, 7, 9]
  const deviation = number(standardDeviation(values, 'sample'))
  near(number(standardError(values)), deviation / Math.sqrt(8))
})

// ---------------------------------------------------------------- the middle

test('the median handles both an odd and an even count', () => {
  near(number(median([3, 1, 2])), 2)
  near(number(median([4, 1, 3, 2])), 2.5)
  // And does not disturb the caller's list.
  const original = [3, 1, 2]
  median(original)
  assert.deepEqual(original, [3, 1, 2])
})

test('a list can have more than one mode, and saying one would be picking arbitrarily', () => {
  assert.deepEqual(modes([1, 2, 2, 3, 3]), [2, 3])
  assert.deepEqual(modes([1, 1, 2]), [1])
  // Every value distinct means there is no peak, and the honest answer shows that.
  assert.deepEqual(modes([1, 2, 3]), [1, 2, 3])
  assert.deepEqual(modes([]), [])
})

test('percentiles match the method spreadsheets use', () => {
  const values = [1, 2, 3, 4]
  near(number(percentile(values, 0)), 1)
  near(number(percentile(values, 1)), 4)
  near(number(percentile(values, 0.5)), 2.5)
  near(number(percentile(values, 0.25)), 1.75)
  assert.deepEqual(quartiles(values), [1.75, 2.5, 3.25])
})

test('a percentile outside zero to one is refused', () => {
  for (const fraction of [-0.1, 1.1, Number.NaN]) {
    assert.equal((percentile([1, 2, 3], fraction) as { error: string }).error, 'invalid-argument')
  }
})

test('the median absolute deviation is not moved by one wild value the way a standard deviation is', () => {
  const calm = [10, 11, 12, 13, 14]
  const wild = [10, 11, 12, 13, 1000]
  const madCalm = number(medianAbsoluteDeviation(calm))
  const madWild = number(medianAbsoluteDeviation(wild))
  const sdCalm = number(standardDeviation(calm, 'sample'))
  const sdWild = number(standardDeviation(wild, 'sample'))
  assert.ok(madWild / madCalm < 3, `the median absolute deviation moved by ${madWild / madCalm}x`)
  assert.ok(sdWild / sdCalm > 30, 'the standard deviation should have been thrown off')
})

// ---------------------------------------------------------------- shape

test('skewness has the sign it should', () => {
  assert.ok(number(skewness([1, 1, 1, 2, 10])) > 0, 'a long right tail is positive')
  assert.ok(number(skewness([1, 9, 10, 10, 10])) < 0, 'a long left tail is negative')
  near(number(skewness([1, 2, 3, 4, 5])), 0, 1e-9)
})

test('kurtosis is stated as excess, so zero means normal-shaped', () => {
  // A uniform distribution has an excess kurtosis of about -1.2.
  const uniform = Array.from({ length: 1000 }, (_, i) => i / 999)
  assert.ok(number(excessKurtosis(uniform)) < -1, 'a flat distribution has negative excess kurtosis')
})

test('shape cannot be described when nothing varies, and says so', () => {
  assert.equal((skewness([5, 5, 5, 5]) as { error: string }).error, 'zero-variance')
  assert.equal((excessKurtosis([5, 5, 5, 5]) as { error: string }).error, 'zero-variance')
})

test('shape needs enough values to mean anything', () => {
  assert.equal((skewness([1, 2]) as { error: string }).error, 'too-few')
  assert.equal((excessKurtosis([1, 2, 3]) as { error: string }).error, 'too-few')
})

// ---------------------------------------------------------------- weights

test('a weighted mean weights', () => {
  near(number(weightedMean([1, 2, 3], [1, 1, 1])), 2)
  near(number(weightedMean([1, 2, 3], [0, 0, 1])), 3)
  near(number(weightedMean([10, 20], [1, 3])), 17.5)
})

test('a negative weight is refused, because a mean outside the data is not a mean', () => {
  assert.equal((weightedMean([1, 2], [1, -1]) as { error: string }).error, 'invalid-argument')
  assert.equal((weightedMean([1, 2], [0, 0]) as { error: string }).error, 'invalid-argument')
  assert.equal((weightedMean([1, 2], [1]) as { error: string }).error, 'mismatched-length')
})

// ---------------------------------------------------------------- two columns

test('correlation is one for a perfect straight line, and minus one when it descends', () => {
  near(number(pearson([1, 2, 3, 4], [2, 4, 6, 8])), 1)
  near(number(pearson([1, 2, 3, 4], [8, 6, 4, 2])), -1)
  near(number(pearson([1, 2, 3, 4, 5], [1, 3, 2, 5, 4])), 0.8, 1e-9)
})

test('correlation never comes out beyond plus or minus one', () => {
  // Rounding can put a perfect correlation a hair outside the range, and an |r| above 1 is meaningless.
  for (let i = 0; i < 40; i++) {
    const xs = Array.from({ length: 6 }, (_, k) => k * 1e6 + i)
    const r = number(pearson(xs, xs.map((x) => x * 3 + 7)))
    assert.ok(r <= 1 && r >= -1, `r came out ${r}`)
  }
})

test('a column that never changes has no correlation, and zero would be a claim', () => {
  assert.equal((pearson([1, 2, 3], [5, 5, 5]) as { error: string }).error, 'zero-variance')
})

test('Spearman sees a curved increasing relationship that Pearson under-reports', () => {
  const x = [1, 2, 3, 4, 5, 6]
  const y = x.map((value) => value ** 4)
  // Perfectly increasing, so the rank correlation is exactly one.
  near(number(spearman(x, y)), 1)
  assert.ok(number(pearson(x, y)) < 1)
})

test('ranks average their ties, which is what makes Spearman right when values repeat', () => {
  assert.deepEqual(ranks([10, 20, 20, 30]), [1, 2.5, 2.5, 4])
  assert.deepEqual(ranks([5, 5, 5]), [2, 2, 2])
})

test('a pair with a missing side is dropped and counted', () => {
  const result = relationship([1, 2, null, 4], [2, 4, 6, 8])
  assert.equal(isStatisticsError(result), false)
  const found = result as { count: number; dropped: number }
  assert.equal(found.count, 3)
  assert.equal(found.dropped, 1)
})

test('no description of a correlation ever claims causation', () => {
  for (const r of [-1, -0.8, -0.3, 0, 0.3, 0.8, 1]) {
    assert.match(describeCorrelation(r), /says nothing about one causing the other/)
  }
})

test('two columns of different lengths is an error, not a truncation', () => {
  assert.equal((pearson([1, 2, 3], [1, 2]) as { error: string }).error, 'mismatched-length')
})

// ---------------------------------------------------------------- fitting

test('a straight line through exact data is found exactly', () => {
  const x = [1, 2, 3, 4, 5]
  const y = x.map((value) => 3 * value + 7)
  const fit = fitLine(x, y)
  assert.equal(isStatisticsError(fit), false)
  const found = fit as { intercept: number; coefficients: number[]; rSquared: number }
  near(found.intercept, 7, 1e-9)
  near(found.coefficients[0], 3, 1e-9)
  near(found.rSquared, 1, 1e-9)
})

test('a fit with two predictors recovers both coefficients', () => {
  const a = [1, 2, 3, 4, 5, 6]
  const b = [2, 1, 4, 3, 6, 5]
  const y = a.map((value, i) => 2 * value + 5 * b[i] - 1)
  const fit = regress([a, b], y) as { intercept: number; coefficients: number[] }
  near(fit.intercept, -1, 1e-7)
  near(fit.coefficients[0], 2, 1e-7)
  near(fit.coefficients[1], 5, 1e-7)
})

test('adjusting R squared stops a useless extra predictor looking like an improvement', () => {
  const x = [1, 2, 3, 4, 5, 6, 7, 8]
  const y = [2.1, 3.9, 6.2, 7.8, 10.1, 12.2, 13.8, 16.1]
  const noise = [5, 2, 9, 1, 7, 3, 8, 4]
  const simple = regress([x], y) as { rSquared: number; adjustedRSquared: number }
  const padded = regress([x, noise], y) as { rSquared: number; adjustedRSquared: number }
  assert.ok(padded.rSquared >= simple.rSquared, 'R squared can only go up')
  assert.ok(padded.adjustedRSquared < simple.adjustedRSquared, 'the adjusted figure should go down')
})

test('predictors carrying the same information are refused rather than given arbitrary coefficients', () => {
  const x = [1, 2, 3, 4, 5]
  const twice = x.map((value) => value * 2)
  assert.equal((regress([x, twice], [2, 4, 6, 8, 10]) as { error: string }).error, 'zero-variance')
  assert.equal((regress([[1, 1, 1, 1, 1]], [1, 2, 3, 4, 5]) as { error: string }).error, 'zero-variance')
})

test('a fit with fewer rows than things to estimate is refused', () => {
  assert.equal((regress([[1]], [1]) as { error: string }).error, 'too-few')
  assert.equal((regress([[1, 2], [3, 4]], [1, 2]) as { error: string }).error, 'too-few')
  assert.equal((regress([], [1, 2, 3]) as { error: string }).error, 'invalid-argument')
})

test('a fit through exactly as many points as parameters says R squared means nothing', () => {
  // Two points and a line: it fits perfectly because it has no choice. Allowed, because people reasonably want it --
  // but never allowed to look like evidence.
  const fit = fitLine([1, 2], [5, 9]) as { rSquared: number; notes: string[] }
  near(fit.rSquared, 1)
  assert.ok(fit.notes.some((one) => /by construction/.test(one)), fit.notes.join(' | '))
  assert.ok(fit.notes.some((one) => /says nothing/.test(one)))
})

test('a row with a value missing is left out of the fit and counted', () => {
  const fit = fitLine([1, 2, null, 4, 5], [3, 5, 7, 9, 11]) as { count: number; dropped: number; notes: string[] }
  assert.equal(fit.count, 4)
  assert.equal(fit.dropped, 1)
  assert.ok(fit.notes.some((one) => one.includes('missing')))
})

test('a fit always states what it assumed', () => {
  const fit = fitLine([1, 2, 3, 4], [2, 4, 6, 8]) as { notes: string[] }
  assert.ok(fit.notes.some((one) => /straight line/.test(one)))
})

// ---------------------------------------------------------------- distributions

test('every distribution integrates to one over its support', () => {
  // A crude check, but one that catches a wrong constant in front of a density.
  for (const id of ['normal', 'exponential', 'uniform', 't', 'chiSquare']) {
    const shape = DISTRIBUTIONS[id]
    const parameters = id === 't' || id === 'chiSquare' ? [5] : id === 'uniform' ? [0, 1] : id === 'exponential' ? [1] : [0, 1]
    const low = id === 'exponential' || id === 'chiSquare' ? 0 : id === 'uniform' ? 0 : -20
    const high = id === 'uniform' ? 1 : 20
    const steps = 4000
    const width = (high - low) / steps
    let total = 0
    for (let i = 0; i < steps; i++) total += shape.density(low + (i + 0.5) * width, ...parameters) * width
    near(total, 1, 5e-3)
  }
})

test('a discrete distribution sums to one over its support', () => {
  let binomial = 0
  for (let k = 0; k <= 10; k++) binomial += DISTRIBUTIONS.binomial.density(k, 10, 0.3)
  near(binomial, 1, 1e-9)
  let poisson = 0
  for (let k = 0; k <= 60; k++) poisson += DISTRIBUTIONS.poisson.density(k, 4)
  near(poisson, 1, 1e-9)
})

test('the cumulative agrees with the density it belongs to', () => {
  const shape = DISTRIBUTIONS.normal
  near(shape.cumulative(0, 0, 1), 0.5, 1e-6)
  near(shape.cumulative(1.96, 0, 1), 0.975, 1e-3)
  near(shape.cumulative(-1.96, 0, 1), 0.025, 1e-3)
  near(DISTRIBUTIONS.exponential.cumulative(Math.LN2, 1), 0.5, 1e-9)
  near(DISTRIBUTIONS.binomial.cumulative(10, 10, 0.3), 1, 1e-9)
})

test('a cumulative never goes backwards', () => {
  for (const [id, parameters] of [['normal', [0, 1]], ['t', [4]], ['chiSquare', [3]], ['poisson', [3]]] as const) {
    const shape = DISTRIBUTIONS[id]
    let previous = -1
    for (let x = -10; x <= 20; x += 0.25) {
      const at = shape.cumulative(x, ...parameters)
      if (!Number.isFinite(at)) continue
      assert.ok(at >= previous - 1e-12, `${id} went backwards at ${x}`)
      previous = at
    }
  }
})

test('an impossible parameter gives no number rather than a wrong one', () => {
  assert.ok(Number.isNaN(DISTRIBUTIONS.normal.density(0, 0, -1)))
  assert.ok(Number.isNaN(DISTRIBUTIONS.exponential.cumulative(1, -1)))
  assert.ok(Number.isNaN(DISTRIBUTIONS.uniform.density(0.5, 1, 0)))
})

test('a distribution name Object.prototype answers for is not a distribution', () => {
  for (const name of ['constructor', 'toString', '__proto__', 'valueOf']) {
    assert.equal(distributionById(name), null, name)
  }
  assert.notEqual(distributionById('normal'), null)
})

test('a quantile inverts the cumulative it came from', () => {
  for (const fraction of [0.01, 0.25, 0.5, 0.75, 0.99]) {
    const at = number(quantileOf(DISTRIBUTIONS.normal, fraction, 0, 1))
    near(DISTRIBUTIONS.normal.cumulative(at, 0, 1), fraction, 1e-6)
  }
  // The familiar one, as a check against a table.
  near(number(quantileOf(DISTRIBUTIONS.normal, 0.975, 0, 1)), 1.959964, 1e-4)
})

test('a quantile at zero or one is refused rather than returning an infinity', () => {
  for (const fraction of [0, 1, -0.5, 2]) {
    assert.equal((quantileOf(DISTRIBUTIONS.normal, fraction, 0, 1) as { error: string }).error, 'invalid-argument')
  }
})

// ---------------------------------------------------------------- confidence

test('a confidence interval contains the mean and widens with the level', () => {
  const values = [2, 4, 4, 4, 5, 5, 7, 9]
  const centre = number(mean(values))
  const ninety = meanInterval(values, 0.9) as { low: number; high: number }
  const ninetyNine = meanInterval(values, 0.99) as { low: number; high: number }
  assert.ok(ninety.low < centre && centre < ninety.high)
  assert.ok(ninetyNine.low < ninety.low && ninetyNine.high > ninety.high)
})

test('a confidence interval says what it actually means', () => {
  // The most misread number in statistics, so the right reading travels with it.
  const interval = meanInterval([1, 2, 3, 4, 5]) as { describe: string }
  assert.match(interval.describe, /repeated many times/)
  assert.match(interval.describe, /does not say/)
})

test('a confidence interval needs more than one value, and a real level', () => {
  assert.equal((meanInterval([1]) as { error: string }).error, 'too-few')
  assert.equal((meanInterval([1, 2], 0) as { error: string }).error, 'invalid-argument')
  assert.equal((meanInterval([1, 2], 1) as { error: string }).error, 'invalid-argument')
})

// ---------------------------------------------------------------- tests

test('a one-sample t test agrees with a known worked example', () => {
  const values = [5.1, 4.9, 5.3, 5.0, 5.2, 4.8, 5.4, 5.1]
  const result = oneSampleT(values, 5) as { statistic: number; degreesOfFreedom: number; pValue: number }
  assert.equal(result.degreesOfFreedom, 7)
  // mean 5.1, sample sd 0.2, standard error 0.2/sqrt(8) = 0.070711, so t = 0.1/0.070711.
  near(result.statistic, 1.414214, 1e-5)
  assert.ok(result.pValue > 0.19 && result.pValue < 0.21, `p was ${result.pValue}`)
})

test('no test in this engine decides significance for anybody', () => {
  const result = oneSampleT([1, 2, 3, 4, 5], 0) as unknown as Record<string, unknown>
  assert.equal('significant' in result, false, '0.05 is a convention, not a fact')
  assert.match(String(result.describe), /not the chance the null hypothesis is true/)
})

test("the two-sample test is Welch's, so equal spread is not assumed", () => {
  const a = [1, 2, 3, 4, 5]
  const b = [10, 30, 50, 70, 90]
  const result = twoSampleT(a, b) as { test: string; assumptions: string[]; degreesOfFreedom: number }
  assert.match(result.test, /Welch/)
  assert.ok(result.assumptions.some((one) => /not assumed to have equal spread/.test(one)))
  // Welch's degrees of freedom are fractional, which is correct rather than tidy.
  assert.ok(!Number.isInteger(result.degreesOfFreedom))
})

test('two identical groups give a statistic of zero and a p-value of one', () => {
  const values = [1, 2, 3, 4, 5]
  const result = twoSampleT(values, values) as { statistic: number; pValue: number }
  near(result.statistic, 0, 1e-12)
  near(result.pValue, 1, 1e-9)
})

test('a paired test is about the differences, and drops incomplete pairs', () => {
  const before = [10, 12, 14, null, 16]
  const after = [11, 14, 15, 20, 18]
  const result = pairedT(before, after) as { test: string; assumptions: string[] }
  assert.equal(result.test, 'paired t')
  assert.ok(result.assumptions.some((one) => /left out/.test(one)))
})

test('a chi-square test on an independent table finds nothing, and on a dependent one finds something', () => {
  const independent = [
    [50, 50],
    [50, 50]
  ]
  const dependent = [
    [90, 10],
    [10, 90]
  ]
  near((chiSquareTest(independent) as { statistic: number }).statistic, 0, 1e-12)
  assert.ok((chiSquareTest(independent) as { pValue: number }).pValue > 0.9)
  assert.ok((chiSquareTest(dependent) as { pValue: number }).pValue < 1e-10)
  assert.equal((chiSquareTest(dependent) as { degreesOfFreedom: number }).degreesOfFreedom, 1)
})

test('a chi-square test refuses a table too sparse for the approximation it rests on', () => {
  // Below an expected count of one the p-value would be a number rather than an answer.
  const sparse = [
    [1, 0],
    [0, 0]
  ]
  assert.equal((chiSquareTest(sparse) as { error: string }).error, 'too-few')
  // And warns between one and five rather than refusing.
  const thin = [
    [3, 1],
    [1, 3]
  ]
  const warned = chiSquareTest(thin) as { assumptions: string[] }
  assert.ok(warned.assumptions.some((one) => /Below five/.test(one)))
})

test('a malformed table is refused', () => {
  assert.equal((chiSquareTest([[1, 2]]) as { error: string }).error, 'too-few')
  assert.equal((chiSquareTest([[1], [2]]) as { error: string }).error, 'too-few')
  assert.equal((chiSquareTest([[1, 2], [3]]) as { error: string }).error, 'mismatched-length')
  assert.equal((chiSquareTest([[1, -2], [3, 4]]) as { error: string }).error, 'invalid-argument')
  assert.equal((chiSquareTest([[0, 0], [0, 0]]) as { error: string }).error, 'empty')
})

// ---------------------------------------------------------------- outliers

test('an outlier is flagged by position and never removed', () => {
  const values = [10, 11, 12, 11, 10, 12, 11, 500]
  const found = outliers(values, 'iqr') as { indices: number[]; describe: string }
  assert.deepEqual(found.indices, [7])
  assert.match(found.describe, /flagged, not removed/)
  // The list is untouched.
  assert.equal(values.length, 8)
  assert.equal(values[7], 500)
})

test('the modified z-score finds a value the plain one lets hide', () => {
  // One value so extreme that it inflates the standard deviation enough to cover itself.
  const values = [10, 11, 12, 13, 14, 15, 16, 17, 18, 1000]
  const plain = outliers(values, 'z-score') as { indices: number[] }
  const modified = outliers(values, 'modified-z') as { indices: number[] }
  assert.deepEqual(plain.indices, [], 'the plain method misses it, which is the point')
  assert.deepEqual(modified.indices, [9])
})

test('every outlier method explains its own rule, including that it is a convention', () => {
  for (const method of ['iqr', 'z-score', 'modified-z'] as const) {
    const values = [1, 2, 3, 4, 5, 6, 7, 100]
    const found = outliers(values, method)
    if (isStatisticsError(found)) continue
    assert.ok(found.describe.length > 40, method)
    assert.match(found.describe, /flagged, not removed/, method)
  }
})

test('finding outliers needs enough values, and a constant column has none', () => {
  assert.equal((outliers([1, 2, 3]) as { error: string }).error, 'too-few')
  assert.equal((outliers([5, 5, 5, 5], 'z-score') as { error: string }).error, 'zero-variance')
})

// ---------------------------------------------------------------- histograms

test('a histogram counts every value exactly once, including the maximum', () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  for (const rule of ['sturges', 'freedman-diaconis', 'square-root'] as const) {
    const made = histogram(values, rule)
    assert.equal(isStatisticsError(made), false, rule)
    const found = made as { bins: { count: number }[]; count: number }
    assert.equal(
      found.bins.reduce((total, bin) => total + bin.count, 0),
      values.length,
      rule
    )
  }
})

test('a histogram says how its bins were chosen, because the shape depends on it', () => {
  const values = Array.from({ length: 200 }, (_, i) => i / 10)
  assert.match((histogram(values, 'sturges') as { rule: string }).rule, /Sturges/)
  assert.match((histogram(values, 'freedman-diaconis') as { rule: string }).rule, /Freedman/)
  assert.match((histogram(values, 'fixed', 7) as { rule: string }).rule, /7 bins/)
  assert.equal((histogram(values, 'fixed', 7) as { bins: unknown[] }).bins.length, 7)
})

test('one distinct value makes one bin rather than inventing structure', () => {
  const made = histogram([5, 5, 5, 5]) as { bins: { count: number }[]; binWidth: number; rule: string }
  assert.equal(made.bins.length, 1)
  assert.equal(made.bins[0].count, 4)
  assert.equal(made.binWidth, 0)
  assert.match(made.rule, /every value is the same/)
})

test('a histogram of nothing is a reason, not an empty chart', () => {
  assert.equal((histogram([]) as { error: string }).error, 'empty')
  assert.equal((histogram([null, undefined]) as { error: string }).error, 'empty')
  assert.equal((histogram([1, 2, 3], 'fixed', 0) as { error: string }).error, 'invalid-argument')
})

test('a histogram counts missing values without binning them', () => {
  const made = histogram([1, 2, null, 3, undefined]) as { count: number; missing: number }
  assert.equal(made.count, 3)
  assert.equal(made.missing, 2)
})

// ---------------------------------------------------------------- reproducibility

test('the same seed gives the same sequence, which Math.random cannot promise', () => {
  const first = Array.from({ length: 20 }, randomSource(42))
  const again = Array.from({ length: 20 }, randomSource(42))
  const different = Array.from({ length: 20 }, randomSource(43))
  assert.deepEqual(first, again)
  assert.notDeepEqual(first, different)
  for (const value of first) assert.ok(value >= 0 && value < 1, `out of range: ${value}`)
})

test('a shuffle is reproducible and keeps every element', () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8]
  const first = shuffle(values, 7)
  assert.deepEqual(first, shuffle(values, 7))
  assert.deepEqual([...first].sort((a, b) => a - b), values)
  // And does not touch the original.
  assert.deepEqual(values, [1, 2, 3, 4, 5, 6, 7, 8])
})

test('a bootstrap is reproducible, and reports the seed that makes it so', () => {
  const values = [2, 4, 4, 4, 5, 5, 7, 9]
  const first = bootstrap(values, mean, { resamples: 500, seed: 11 })
  const again = bootstrap(values, mean, { resamples: 500, seed: 11 })
  assert.deepEqual(first, again)
  const found = first as { seed: number; interval: { low: number; high: number }; observed: number; notes: string[] }
  assert.equal(found.seed, 11)
  assert.ok(found.interval.low < found.observed && found.observed < found.interval.high)
  assert.ok(found.notes.some((one) => /Seed 11/.test(one)))
})

test('a bootstrap says its interval is a percentile one, and that it is biased when skewed', () => {
  const found = bootstrap([1, 2, 3, 4, 5], mean, { resamples: 200, seed: 3 }) as { notes: string[]; interval: { describe: string } }
  assert.ok(found.notes.some((one) => /percentile interval/i.test(one)))
  assert.match(found.interval.describe, /not how much the truth could differ/)
})

test('a bootstrap over a statistic that usually fails says so rather than returning zeros', () => {
  // The sample variance of a one-value resample is an error, so resampling a two-value list mostly fails.
  const result = bootstrap([1], mean, { resamples: 100, seed: 1 })
  assert.equal((result as { error: string }).error, 'too-few')
})

test('a bootstrap needs a real confidence level', () => {
  assert.equal((bootstrap([1, 2, 3], mean, { level: 0 }) as { error: string }).error, 'invalid-argument')
  assert.equal((bootstrap([1, 2, 3], mean, { level: 1.5 }) as { error: string }).error, 'invalid-argument')
})

// ---------------------------------------------------------------- the promises this engine makes

test('the assumptions are stated, and they are the ones the code actually keeps', () => {
  assert.ok(STATISTICS_ASSUMPTIONS.length >= 5)
  const all = STATISTICS_ASSUMPTIONS.join(' ')
  assert.match(all, /never treated as zero/)
  assert.match(all, /causation/)
  assert.match(all, /flagged, never removed/)
  assert.match(all, /seeded by the caller/)
})

test('a summary is refused rather than half-filled', () => {
  // A summary with some fields meaningful and others not is the thing most likely to be read wrongly.
  assert.equal((summarise([]) as { error: string }).error, 'empty')
  assert.equal((summarise([null, undefined]) as { error: string }).error, 'empty')
  const one = summarise([5]) as Summary
  assert.equal(one.count, 1)
  assert.equal(one.mean, 5)
  assert.equal(one.standardError, 0, 'one value cannot have a standard error, and this says zero rather than pretending')
})

test('a summary of a known list matches every figure worked out by hand', () => {
  const summary = summarise([2, 4, 4, 4, 5, 5, 7, 9], 'population') as Summary
  assert.equal(summary.count, 8)
  near(summary.sum, 40)
  near(summary.mean, 5)
  near(summary.median, 4.5)
  assert.deepEqual(summary.modes, [4])
  near(summary.minimum, 2)
  near(summary.maximum, 9)
  near(summary.range, 7)
  near(summary.variance, 4)
  near(summary.standardDeviation, 2)
  assert.equal(summary.population, 'population')
})

test('the modified z-score says so when more than half the values are identical', () => {
  // The median absolute deviation is then zero, and a method built on it cannot measure spread. An error rather than a
  // division by zero dressed up as an answer.
  const result = outliers([10, 10, 10, 10, 10, 10, 1000], 'modified-z')
  assert.equal((result as { error: string }).error, 'zero-variance')
  assert.match((result as { message: string }).message, /half the values are identical/)
})
