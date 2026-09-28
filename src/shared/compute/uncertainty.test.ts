import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  COMPONENT_LABEL,
  UNCERTAINTY_ASSUMPTIONS,
  UNCERTAINTY_LIMITS,
  RunningStatistics,
  checkAssumptions,
  checkDimensions,
  checkDistribution,
  choleskyFactor,
  compareMethods,
  correlationBetween,
  covarianceMatrix,
  coverageFor,
  describeError,
  drawFrom,
  exact,
  globalSensitivity,
  isPositiveSemiDefinite,
  isUncertaintyError,
  noCorrelation,
  propagateByMonteCarlo,
  propagateChain,
  propagateFirstOrder,
  randomStream,
  relativeUncertainty,
  setCorrelation,
  uncertainQuantity,
  uncertaintyBudget,
  type CorrelationSet,
  type UncertainQuantity
} from './uncertainty.ts'

/** A quantity, or a thrown assertion. Every test wants the value, not the union. */
const q = (id: string, value: number, unit: string, options?: Parameters<typeof uncertainQuantity>[3]): UncertainQuantity => {
  const one = uncertainQuantity(id, value, unit, options)
  if (isUncertaintyError(one)) throw new Error(`${id}: ${one.message}`)
  return one
}

const standard = (value: number) => ({ value, kind: 'standard' as const, coverageFactor: 1, source: 'stated' as const })

describe('distributions', () => {
  test('every kind reports a mean and variance it computed rather than was told', () => {
    const uniform = checkDistribution({ kind: 'uniform', low: 0, high: 12 })
    assert.ok(!isUncertaintyError(uniform))
    assert.equal(uniform.mean, 6)
    // (b-a)^2/12 = 144/12 = 12
    assert.equal(uniform.variance, 12)
    assert.equal(uniform.low, 0)
    assert.equal(uniform.high, 12)
  })

  test('a triangular distribution has the textbook mean and variance', () => {
    const one = checkDistribution({ kind: 'triangular', low: 0, peak: 1, high: 3 })
    assert.ok(!isUncertaintyError(one))
    assert.equal(one.mean, (0 + 1 + 3) / 3)
    // (a^2+b^2+c^2-ab-ac-bc)/18
    assert.ok(Math.abs(one.variance - (0 + 1 + 9 - 0 - 0 - 3) / 18) < 1e-12)
  })

  test('a log-normal knows it cannot go below zero', () => {
    const one = checkDistribution({ kind: 'lognormal', logMean: 0, logStandardDeviation: 0.5 })
    assert.ok(!isUncertaintyError(one))
    assert.equal(one.low, 0)
    assert.equal(one.high, null)
  })

  test('a negative standard deviation is refused rather than producing samples', () => {
    const one = checkDistribution({ kind: 'normal', mean: 1, standardDeviation: -1 })
    assert.ok(isUncertaintyError(one))
    assert.match(one.message, /cannot be negative/)
  })

  test('a uniform range with its bounds the wrong way round is refused', () => {
    assert.ok(isUncertaintyError(checkDistribution({ kind: 'uniform', low: 10, high: 2 })))
  })

  test('a triangular peak outside its own range is refused', () => {
    assert.ok(isUncertaintyError(checkDistribution({ kind: 'triangular', low: 0, peak: 5, high: 3 })))
  })

  test('discrete weights are normalised rather than assumed to sum to one', () => {
    // Weights 3 and 1 -> probabilities 0.75 and 0.25 -> mean 0.75*0 + 0.25*4 = 1.
    const one = checkDistribution({
      kind: 'discrete',
      outcomes: [
        { value: 0, weight: 3 },
        { value: 4, weight: 1 }
      ]
    })
    assert.ok(!isUncertaintyError(one))
    assert.equal(one.mean, 1)
  })

  test('discrete weights that are all zero are refused', () => {
    const one = checkDistribution({
      kind: 'discrete',
      outcomes: [
        { value: 1, weight: 0 },
        { value: 2, weight: 0 }
      ]
    })
    assert.ok(isUncertaintyError(one))
  })

  test('an empirical distribution needs at least two observations', () => {
    assert.ok(isUncertaintyError(checkDistribution({ kind: 'empirical', values: [1] })))
    assert.ok(!isUncertaintyError(checkDistribution({ kind: 'empirical', values: [1, 2] })))
  })
})

describe('uncertain quantities', () => {
  test('an uncertainty with no distribution becomes normal, and the assumption is written down', () => {
    const one = q('L', 10, 'cm', { uncertainty: standard(0.1) })
    assert.equal(one.distribution.kind, 'normal')
    assert.match(one.note, /assumed normal/)
  })

  test('a distribution with no uncertainty takes the distribution’s own spread', () => {
    const one = q('L', 6, 'cm', { distribution: { kind: 'uniform', low: 0, high: 12 } })
    // sqrt(12) is the standard deviation of that uniform.
    assert.ok(Math.abs(one.uncertainty.value - Math.sqrt(12)) < 1e-12)
  })

  test('an exact value is exact, not a measurement with a small uncertainty', () => {
    const pi = exact('pi', Math.PI)
    assert.ok(!isUncertaintyError(pi))
    assert.equal(pi.exact, true)
    assert.equal(pi.uncertainty.value, 0)
    assert.equal(pi.uncertainty.source, 'none')
  })

  test('asymmetric uncertainty becomes a triangular shape rather than being averaged away', () => {
    const one = q('m', 10, 'kg', { asymmetric: { up: 1.5, down: 0.8 } })
    assert.equal(one.distribution.kind, 'triangular')
    assert.deepEqual(one.asymmetric, { up: 1.5, down: 0.8 })
    // The scalar uncertainty keeps the larger side, so nothing downstream understates it.
    assert.equal(one.uncertainty.value, 1.5)
    if (one.distribution.kind === 'triangular') {
      assert.equal(one.distribution.low, 9.2)
      assert.equal(one.distribution.high, 11.5)
      assert.equal(one.distribution.peak, 10)
    }
  })

  test('declared sources combine in quadrature into the total', () => {
    const one = q('m', 100, 'g', {
      sources: [
        { id: 'a', component: 'instrument', standard: 3, systematic: true, describe: 'balance' },
        { id: 'b', component: 'repeatability', standard: 4, systematic: false, describe: 'repeats' }
      ]
    })
    // 3 and 4 in quadrature is 5.
    assert.equal(one.uncertainty.value, 5)
    assert.equal(one.uncertainty.source, 'propagated')
  })

  test('a bad unit is refused with the unit engine’s own message', () => {
    const one = uncertainQuantity('x', 1, 'not-a-unit-at-all')
    assert.ok(isUncertaintyError(one))
    assert.equal(one.error, 'invalid-unit')
  })

  test('relative uncertainty is null at zero rather than infinite', () => {
    assert.equal(relativeUncertainty(q('x', 0, 'm', { uncertainty: standard(1) })), null)
    assert.equal(relativeUncertainty(q('x', 4, 'm', { uncertainty: standard(1) })), 0.25)
  })

  test('an uncertainty in the wrong dimension is refused', () => {
    const length = q('L', 10, 'm', { uncertainty: standard(0.2) })
    const wrong = checkDimensions(length, 's')
    assert.ok(isUncertaintyError(wrong))
    assert.equal(wrong.error, 'dimension-mismatch')
    assert.ok(!isUncertaintyError(checkDimensions(length, 'cm')))
  })
})

describe('error is not uncertainty', () => {
  test('an error needs a reference and says whether it is larger than the measurement can explain', () => {
    const measured = q('g', 9.9, 'm/s^2', { uncertainty: standard(0.02) })
    const result = describeError(measured, 9.81)
    assert.ok(!isUncertaintyError(result))
    assert.ok(Math.abs(result.error - 0.09) < 1e-12)
    // 0.09 is well past twice 0.02.
    assert.equal(result.significant, true)
    assert.match(result.describe, /larger than the measurement can account for/)
  })

  test('a difference inside twice the uncertainty is reported as consistent, not as an error to fix', () => {
    const measured = q('g', 9.82, 'm/s^2', { uncertainty: standard(0.05) })
    const result = describeError(measured, 9.81)
    assert.ok(!isUncertaintyError(result))
    assert.equal(result.significant, false)
    assert.match(result.describe, /consistent with the reference/)
  })
})

describe('correlation and covariance', () => {
  test('a correlation outside minus one to one is refused', () => {
    assert.ok(isUncertaintyError(setCorrelation(noCorrelation(), 'a', 'b', 1.5)))
    assert.ok(isUncertaintyError(setCorrelation(noCorrelation(), 'a', 'a', 0.5)))
  })

  test('the pair key does not care about the order the two ids were given in', () => {
    const set = setCorrelation(noCorrelation(), 'b', 'a', 0.7)
    assert.ok(!isUncertaintyError(set))
    assert.equal(correlationBetween(set, 'a', 'b'), 0.7)
    assert.equal(correlationBetween(set, 'b', 'a'), 0.7)
    assert.equal(correlationBetween(set, 'a', 'a'), 1)
    assert.equal(correlationBetween(set, 'a', 'c'), 0)
  })

  test('the covariance matrix carries the uncertainties on the diagonal', () => {
    const a = q('a', 1, 'm', { uncertainty: standard(2) })
    const b = q('b', 1, 'm', { uncertainty: standard(3) })
    const built = covarianceMatrix([a, b])
    assert.ok(!isUncertaintyError(built))
    assert.equal(built.matrix[0][0], 4)
    assert.equal(built.matrix[1][1], 9)
    assert.equal(built.matrix[0][1], 0)
    assert.equal(built.independent, true)
    assert.match(built.notes[0], /assumption, not a measurement/)
  })

  test('correlations that contradict each other are refused rather than propagated', () => {
    // Three quantities each correlated -0.9 with the others is not a possible covariance.
    let set: CorrelationSet = noCorrelation()
    for (const [x, y] of [
      ['a', 'b'],
      ['a', 'c'],
      ['b', 'c']
    ]) {
      const next = setCorrelation(set, x, y, -0.9)
      assert.ok(!isUncertaintyError(next))
      set = next
    }
    const quantities = ['a', 'b', 'c'].map((id) => q(id, 1, 'm', { uncertainty: standard(1) }))
    const built = covarianceMatrix(quantities, set)
    assert.ok(isUncertaintyError(built))
    assert.equal(built.error, 'invalid-covariance')
    assert.match(built.message, /negative variance/)
  })

  test('perfect correlation is allowed, because it is what "the same measurement twice" means', () => {
    const set = setCorrelation(noCorrelation(), 'a', 'b', 1)
    assert.ok(!isUncertaintyError(set))
    const quantities = ['a', 'b'].map((id) => q(id, 1, 'm', { uncertainty: standard(1) }))
    assert.ok(!isUncertaintyError(covarianceMatrix(quantities, set)))
  })

  test('the Cholesky factor multiplies back to the matrix it came from', () => {
    const matrix = [
      [4, 2, 1],
      [2, 5, 3],
      [1, 3, 6]
    ]
    const L = choleskyFactor(matrix)
    assert.ok(!isUncertaintyError(L))
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        let sum = 0
        for (let k = 0; k < 3; k++) sum += L[i][k] * L[j][k]
        assert.ok(Math.abs(sum - matrix[i][j]) < 1e-10, `entry ${i},${j}`)
      }
    }
  })

  test('a matrix that is not positive semi-definite is detected', () => {
    assert.equal(isPositiveSemiDefinite([[1, 2], [2, 1]]), false)
    assert.equal(isPositiveSemiDefinite([[1, 0], [0, 1]]), true)
  })
})

describe('random streams', () => {
  test('the same seed and stream give the same sequence', () => {
    const a = randomStream(42, 3)
    const b = randomStream(42, 3)
    for (let i = 0; i < 20; i++) assert.equal(a.next(), b.next())
  })

  test('different streams of the same seed do not share a prefix', () => {
    const a = randomStream(42, 0)
    const b = randomStream(42, 1)
    const first = Array.from({ length: 10 }, () => a.next())
    const second = Array.from({ length: 10 }, () => b.next())
    assert.notDeepEqual(first, second)
  })

  test('a seed of zero still produces varying numbers', () => {
    // A zero internal state is a fixed point of an xorshift, so this is the case that quietly returns one number over
    // and over if the state is not moved off it.
    const stream = randomStream(0, 0)
    const drawn = new Set(Array.from({ length: 50 }, () => stream.next()))
    assert.ok(drawn.size > 40, `only ${drawn.size} distinct values`)
  })

  test('draws are strictly inside zero and one', () => {
    const stream = randomStream(7)
    for (let i = 0; i < 5000; i++) {
      const value = stream.next()
      assert.ok(value > 0 && value < 1, `drew ${value}`)
    }
  })

  test('the normal draw has about the right mean and spread', () => {
    const stream = randomStream(11)
    const values = Array.from({ length: 40_000 }, () => stream.normal())
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const spread = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1))
    assert.ok(Math.abs(mean) < 0.03, `mean ${mean}`)
    assert.ok(Math.abs(spread - 1) < 0.03, `spread ${spread}`)
  })

  test('a uniform draw stays inside its bounds', () => {
    const stream = randomStream(3)
    for (let i = 0; i < 2000; i++) {
      const value = drawFrom({ kind: 'uniform', low: -2, high: 5 }, stream)
      assert.ok(value >= -2 && value <= 5)
    }
  })

  test('a triangular draw stays inside its bounds and clusters at the peak', () => {
    const stream = randomStream(5)
    let nearPeak = 0
    for (let i = 0; i < 20_000; i++) {
      const value = drawFrom({ kind: 'triangular', low: 0, peak: 5, high: 10 }, stream)
      assert.ok(value >= 0 && value <= 10)
      if (value > 4 && value < 6) nearPeak += 1
    }
    // A uniform would put a tenth in that band; the triangular peak puts noticeably more.
    assert.ok(nearPeak / 20_000 > 0.15, `${nearPeak / 20_000}`)
  })

  test('a discrete draw respects its weights', () => {
    const stream = randomStream(9)
    let ones = 0
    for (let i = 0; i < 20_000; i++) {
      const value = drawFrom(
        { kind: 'discrete', outcomes: [{ value: 1, weight: 3 }, { value: 2, weight: 1 }] },
        stream
      )
      if (value === 1) ones += 1
      assert.ok(value === 1 || value === 2)
    }
    assert.ok(Math.abs(ones / 20_000 - 0.75) < 0.02)
  })

  test('an empirical draw only ever returns an observed value', () => {
    const stream = randomStream(13)
    const observed = [3, 7, 11]
    for (let i = 0; i < 500; i++) {
      assert.ok(observed.includes(drawFrom({ kind: 'empirical', values: observed }, stream)))
    }
  })
})

describe('running statistics', () => {
  test('mean and variance match the direct calculation', () => {
    const values = [2, 4, 4, 4, 5, 5, 7, 9]
    const running = new RunningStatistics()
    for (const value of values) running.add(value)
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1)
    assert.ok(Math.abs(running.mean - mean) < 1e-12)
    assert.ok(Math.abs(running.variance - variance) < 1e-12)
    assert.equal(running.min, 2)
    assert.equal(running.max, 9)
  })

  test('a small spread on a huge mean survives, which is the whole reason for Welford', () => {
    // Sum-of-squares would subtract two numbers near 1e18 and return garbage here.
    const running = new RunningStatistics()
    const n = 1000
    for (let i = 0; i < n; i++) running.add(1e9 + (i % 2 === 0 ? 1 : -1))
    // The sample variance of n alternating deviations of 1 is n/(n-1), not 1.
    assert.ok(Math.abs(running.standardDeviation - Math.sqrt(n / (n - 1))) < 1e-9, `got ${running.standardDeviation}`)
  })

  test('a single value has no variance rather than a divide by zero', () => {
    const running = new RunningStatistics()
    running.add(5)
    assert.equal(running.variance, 0)
    assert.equal(running.standardError, 0)
  })
})

describe('first-order propagation', () => {
  test('a sum of two independent uncertainties adds in quadrature', () => {
    const a = q('a', 10, 'm', { uncertainty: standard(3) })
    const b = q('b', 20, 'm', { uncertainty: standard(4) })
    const result = propagateFirstOrder([a, b], ([x, y]) => x + y)
    assert.ok(!isUncertaintyError(result))
    assert.equal(result.value, 30)
    assert.ok(Math.abs(result.standardUncertainty - 5) < 1e-6)
  })

  test('a product propagates relative uncertainties in quadrature', () => {
    // 10 +- 1 times 20 +- 2 -> 200 with 10% and 10% -> sqrt(2)*10% of 200.
    const a = q('a', 10, '', { uncertainty: standard(1) })
    const b = q('b', 20, '', { uncertainty: standard(2) })
    const result = propagateFirstOrder([a, b], ([x, y]) => x * y)
    assert.ok(!isUncertaintyError(result))
    assert.ok(Math.abs(result.standardUncertainty - 200 * Math.SQRT2 * 0.1) < 1e-3)
  })

  test('an exact input contributes nothing and the notes say so', () => {
    const measured = q('r', 2, 'm', { uncertainty: standard(0.1) })
    const pi = exact('pi', Math.PI)
    assert.ok(!isUncertaintyError(pi))
    const result = propagateFirstOrder([measured, pi], ([r, p]) => p * r * r)
    assert.ok(!isUncertaintyError(result))
    const piEntry = result.sensitivities.find((one) => one.id === 'pi')
    assert.equal(piEntry?.contribution, 0)
    assert.ok(result.notes.some((one) => /exact and contribute nothing/.test(one)))
  })

  test('correlation changes the answer, and the note says by how much', () => {
    const a = q('a', 10, 'm', { uncertainty: standard(1) })
    const b = q('b', 10, 'm', { uncertainty: standard(1) })
    const independent = propagateFirstOrder([a, b], ([x, y]) => x + y)
    const set = setCorrelation(noCorrelation(), 'a', 'b', 1)
    assert.ok(!isUncertaintyError(set))
    const correlated = propagateFirstOrder([a, b], ([x, y]) => x + y, { correlations: set })
    assert.ok(!isUncertaintyError(independent) && !isUncertaintyError(correlated))
    // Independent: sqrt(2). Perfectly correlated: 2.
    assert.ok(Math.abs(independent.standardUncertainty - Math.SQRT2) < 1e-6)
    assert.ok(Math.abs(correlated.standardUncertainty - 2) < 1e-6)
    assert.ok(correlated.notes.some((one) => /Correlation between inputs added/.test(one)))
  })

  test('a difference of perfectly correlated equals has no uncertainty at all', () => {
    // The case correlation exists for: measuring the same thing twice and subtracting cancels the shared error.
    const a = q('a', 10, 'm', { uncertainty: standard(1) })
    const b = q('b', 4, 'm', { uncertainty: standard(1) })
    const set = setCorrelation(noCorrelation(), 'a', 'b', 1)
    assert.ok(!isUncertaintyError(set))
    const result = propagateFirstOrder([a, b], ([x, y]) => x - y, { correlations: set })
    assert.ok(!isUncertaintyError(result))
    assert.ok(result.standardUncertainty < 1e-6, `got ${result.standardUncertainty}`)
  })

  test('shares of the variance add to one for independent inputs', () => {
    const inputs = [q('a', 10, '', { uncertainty: standard(3) }), q('b', 5, '', { uncertainty: standard(4) })]
    const result = propagateFirstOrder(inputs, ([x, y]) => x + y)
    assert.ok(!isUncertaintyError(result))
    const total = result.sensitivities.reduce((sum, one) => sum + one.share, 0)
    assert.ok(Math.abs(total - 1) < 1e-9)
  })

  test('sensitivities come back with the biggest contributor first', () => {
    const inputs = [q('small', 10, '', { uncertainty: standard(0.1) }), q('big', 10, '', { uncertainty: standard(5) })]
    const result = propagateFirstOrder(inputs, ([x, y]) => x + y)
    assert.ok(!isUncertaintyError(result))
    assert.equal(result.sensitivities[0].id, 'big')
  })

  test('elasticity is the proportional response, and null where a ratio would say nothing', () => {
    // For y = x^2, elasticity is 2 everywhere.
    const x = q('x', 3, '', { uncertainty: standard(0.1) })
    const result = propagateFirstOrder([x], ([v]) => v * v)
    assert.ok(!isUncertaintyError(result))
    assert.ok(Math.abs((result.sensitivities[0].elasticity ?? 0) - 2) < 1e-4)

    const zero = q('z', 0, '', { uncertainty: standard(0.1) })
    const atZero = propagateFirstOrder([zero], ([v]) => v + 1)
    assert.ok(!isUncertaintyError(atZero))
    assert.equal(atZero.sensitivities[0].elasticity, null)
  })

  test('a model with no value at the nominal point is refused rather than propagated around nothing', () => {
    const x = q('x', -1, '', { uncertainty: standard(0.1) })
    const result = propagateFirstOrder([x], ([v]) => Math.sqrt(v))
    assert.ok(isUncertaintyError(result))
    assert.equal(result.error, 'not-finite')
  })

  test('a model undefined just to one side is refused, with the input named', () => {
    const x = q('x', 0, '', { uncertainty: standard(0.1) })
    const result = propagateFirstOrder([x], ([v]) => Math.sqrt(v))
    assert.ok(isUncertaintyError(result))
    assert.match(result.message, /either side of x/)
  })

  test('the coverage factor for 95% is about 1.96', () => {
    assert.ok(Math.abs(coverageFor(0.95) - 1.959964) < 1e-4)
    assert.ok(Math.abs(coverageFor(0.6827) - 1) < 2e-3)
  })

  test('the assumptions are carried with the result, not left implied', () => {
    const result = propagateFirstOrder([q('a', 1, '', { uncertainty: standard(0.1) })], ([x]) => x)
    assert.ok(!isUncertaintyError(result))
    assert.ok(result.assumptions.some((one) => /linearised/.test(one)))
    assert.ok(result.assumptions.some((one) => /independent/.test(one)))
  })
})

describe('Monte Carlo', () => {
  test('a linear model gives the analytic answer back', () => {
    const a = q('a', 10, '', { uncertainty: standard(3) })
    const b = q('b', 20, '', { uncertainty: standard(4) })
    const result = propagateByMonteCarlo([a, b], ([x, y]) => x + y, { samples: 60_000, seed: 5 })
    assert.ok(!isUncertaintyError(result))
    assert.ok(Math.abs(result.standardUncertainty - 5) < 0.1, `got ${result.standardUncertainty}`)
    assert.ok(Math.abs(result.mean - 30) < 0.1)
  })

  test('the same seed gives exactly the same answer', () => {
    const inputs = [q('a', 5, '', { uncertainty: standard(1) })]
    const first = propagateByMonteCarlo(inputs, ([x]) => x * x, { samples: 2000, seed: 77 })
    const again = propagateByMonteCarlo(inputs, ([x]) => x * x, { samples: 2000, seed: 77 })
    assert.ok(!isUncertaintyError(first) && !isUncertaintyError(again))
    assert.equal(first.mean, again.mean)
    assert.equal(first.standardUncertainty, again.standardUncertainty)
  })

  test('a different seed gives a different answer', () => {
    const inputs = [q('a', 5, '', { uncertainty: standard(1) })]
    const first = propagateByMonteCarlo(inputs, ([x]) => x * x, { samples: 2000, seed: 1 })
    const other = propagateByMonteCarlo(inputs, ([x]) => x * x, { samples: 2000, seed: 2 })
    assert.ok(!isUncertaintyError(first) && !isUncertaintyError(other))
    assert.notEqual(first.mean, other.mean)
  })

  test('finishing the requested trials is not reported as convergence', () => {
    const result = propagateByMonteCarlo([q('a', 1, '', { uncertainty: standard(0.1) })], ([x]) => x, { samples: 500 })
    assert.ok(!isUncertaintyError(result))
    assert.equal(result.converged, false)
    assert.ok(result.notes.some((one) => /nothing here says the answer has converged/.test(one)))
  })

  test('a stopping target stops early and says where', () => {
    const result = propagateByMonteCarlo([q('a', 10, '', { uncertainty: standard(1) })], ([x]) => x, {
      samples: 200_000,
      seed: 3,
      targetStandardError: 0.02
    })
    assert.ok(!isUncertaintyError(result))
    assert.equal(result.converged, true)
    // sigma/sqrt(n) <= 0.02 needs about 2500 trials, far short of the 200,000 asked for.
    assert.ok(result.successfulTrials < 20_000, `ran ${result.successfulTrials}`)
    assert.ok(result.notes.some((one) => /Stopped at/.test(one)))
  })

  test('failed trials are counted and reported, not dropped', () => {
    const x = q('x', 1, '', { uncertainty: standard(1) })
    // sqrt of a negative draw has no value; about a sixth of draws are below zero.
    const result = propagateByMonteCarlo([x], ([v]) => Math.sqrt(v), { samples: 20_000, seed: 4 })
    assert.ok(!isUncertaintyError(result))
    assert.ok(result.failedTrials > 100, `only ${result.failedTrials} failed`)
    assert.equal(result.successfulTrials + result.failedTrials, result.requestedSamples)
    assert.ok(result.failureReasons.some((one) => one.reason === 'not a number'))
    assert.ok(result.notes.some((one) => /trials failed and are not in the statistics/.test(one)))
  })

  test('a model that throws is counted as a failure with its own reason', () => {
    const x = q('x', 1, '', { uncertainty: standard(1) })
    const result = propagateByMonteCarlo([x], ([v]) => {
      if (v < 0) throw new Error('below zero')
      return v
    }, { samples: 5000, seed: 6 })
    assert.ok(!isUncertaintyError(result))
    assert.ok(result.failureReasons.some((one) => one.reason === 'below zero'))
  })

  test('a constraint is respected by redrawing, and the redraws are counted', () => {
    const x = q('x', 0, '', { uncertainty: standard(1) })
    const result = propagateByMonteCarlo([x], ([v]) => v, {
      samples: 5000,
      seed: 8,
      accept: ([v]) => v > 0
    })
    assert.ok(!isUncertaintyError(result))
    assert.ok(result.minimum > 0, `drew ${result.minimum}`)
    assert.ok(result.rejectedDraws > 1000, `only ${result.rejectedDraws} redraws`)
    assert.ok(result.notes.some((one) => /rejection sampling/.test(one)))
  })

  test('declared bounds are enforced by redrawing rather than by clamping', () => {
    // Clamping would pile a spike of probability on exactly 2, which a redraw does not.
    const x = q('x', 0, '', { uncertainty: standard(1), bounds: { low: -2, high: 2 } })
    const result = propagateByMonteCarlo([x], ([v]) => v, { samples: 20_000, seed: 2, memory: 'all' })
    assert.ok(!isUncertaintyError(result))
    assert.ok(result.minimum >= -2 && result.maximum <= 2)
    assert.ok(result.rejectedDraws > 0)
  })

  test('a lopsided output is flagged rather than reported as plus-or-minus', () => {
    // exp of a normal is strongly skewed.
    const x = q('x', 0, '', { uncertainty: standard(1) })
    const result = propagateByMonteCarlo([x], ([v]) => Math.exp(v), { samples: 40_000, seed: 12 })
    assert.ok(!isUncertaintyError(result))
    assert.ok(result.asymmetry)
    assert.equal(result.asymmetry?.skewed, true)
    assert.ok((result.asymmetry?.up ?? 0) > (result.asymmetry?.down ?? 0))
    assert.ok(result.notes.some((one) => /lopsided/.test(one)))
  })

  test('quantiles come back in the order asked for', () => {
    const result = propagateByMonteCarlo([q('x', 0, '', { uncertainty: standard(1) })], ([v]) => v, {
      samples: 20_000,
      seed: 21,
      quantiles: [0.05, 0.5, 0.95]
    })
    assert.ok(!isUncertaintyError(result))
    assert.equal(result.quantiles.length, 3)
    assert.deepEqual(result.quantiles.map((one) => one.fraction), [0.05, 0.5, 0.95])
    assert.ok(result.quantiles[0].value < result.quantiles[1].value)
    assert.ok(result.quantiles[1].value < result.quantiles[2].value)
    // The 5% and 95% of a standard normal are about -1.64 and 1.64.
    assert.ok(Math.abs(result.quantiles[0].value + 1.645) < 0.1)
  })

  test('aggregate memory gives no quantiles rather than estimating them', () => {
    const result = propagateByMonteCarlo([q('x', 0, '', { uncertainty: standard(1) })], ([v]) => v, {
      samples: 5000,
      seed: 1,
      memory: 'aggregate'
    })
    assert.ok(!isUncertaintyError(result))
    assert.deepEqual(result.quantiles, [])
    assert.equal(result.interval, null)
    assert.equal(result.median, null)
    assert.ok(result.notes.some((one) => /Samples were not kept/.test(one)))
    // The mean and spread survive, because those stream.
    assert.ok(Math.abs(result.standardUncertainty - 1) < 0.05)
  })

  test('correlated normals are drawn with the covariance asked for', () => {
    const a = q('a', 0, '', { uncertainty: standard(1) })
    const b = q('b', 0, '', { uncertainty: standard(1) })
    const set = setCorrelation(noCorrelation(), 'a', 'b', 0.8)
    assert.ok(!isUncertaintyError(set))
    // The variance of a+b is 2(1+r) = 3.6 when r is 0.8, so the spread is about 1.897.
    const result = propagateByMonteCarlo([a, b], ([x, y]) => x + y, { samples: 60_000, seed: 31, correlations: set })
    assert.ok(!isUncertaintyError(result))
    assert.equal(result.correlated, true)
    assert.ok(Math.abs(result.standardUncertainty - Math.sqrt(3.6)) < 0.05, `got ${result.standardUncertainty}`)
  })

  test('a correlated non-normal input is refused rather than sampled as if the correlation applied', () => {
    const a = q('a', 0, '', { uncertainty: standard(1) })
    const b = q('b', 5, '', { distribution: { kind: 'uniform', low: 0, high: 10 } })
    const set = setCorrelation(noCorrelation(), 'a', 'b', 0.5)
    assert.ok(!isUncertaintyError(set))
    const result = propagateByMonteCarlo([a, b], ([x, y]) => x + y, { samples: 1000, correlations: set })
    assert.ok(isUncertaintyError(result))
    assert.equal(result.error, 'unsupported-correlation')
    assert.match(result.message, /has to be normal/)
  })

  test('too few trials is refused rather than estimated from', () => {
    assert.ok(isUncertaintyError(propagateByMonteCarlo([q('x', 1, '', { uncertainty: standard(1) })], ([v]) => v, { samples: 5 })))
  })

  test('a run past the ceiling is refused with the ceiling named', () => {
    const result = propagateByMonteCarlo([q('x', 1, '', { uncertainty: standard(1) })], ([v]) => v, {
      samples: UNCERTAINTY_LIMITS.samples + 1
    })
    assert.ok(isUncertaintyError(result))
    assert.equal(result.error, 'too-many')
  })

  test('a model that never returns a value is refused, with the reasons attached', () => {
    const result = propagateByMonteCarlo([q('x', 1, '', { uncertainty: standard(1) })], () => Number.NaN, { samples: 500 })
    assert.ok(isUncertaintyError(result))
    assert.equal(result.error, 'too-few-successes')
    assert.match(result.message, /not a number/)
  })

  test('convergence points are recorded and the standard error falls', () => {
    const result = propagateByMonteCarlo([q('x', 0, '', { uncertainty: standard(1) })], ([v]) => v, {
      samples: 20_000,
      seed: 41
    })
    assert.ok(!isUncertaintyError(result))
    assert.ok(result.convergence.length > 10)
    const first = result.convergence[0]
    const last = result.convergence[result.convergence.length - 1]
    assert.ok(last.standardError < first.standardError)
    assert.ok(last.trials > first.trials)
  })

  test('the nominal value and the sampled mean are both reported for a curved model', () => {
    // For y = x^2 with x ~ N(3,1), the nominal is 9 and the mean is 9 + 1 = 10.
    const x = q('x', 3, '', { uncertainty: standard(1) })
    const result = propagateByMonteCarlo([x], ([v]) => v * v, { samples: 80_000, seed: 55 })
    assert.ok(!isUncertaintyError(result))
    assert.ok(Math.abs(result.value - 9) < 1e-9)
    assert.ok(Math.abs(result.mean - 10) < 0.15, `mean ${result.mean}`)
    assert.ok(result.notes.some((one) => /is not the model's value at the nominal inputs/.test(one)))
  })
})

describe('global sensitivity', () => {
  test('a model dominated by one input attributes the variance to it', () => {
    const a = q('a', 0, '', { uncertainty: standard(3) })
    const b = q('b', 0, '', { uncertainty: standard(0.1) })
    const result = globalSensitivity([a, b], ([x, y]) => x + y, { samples: 4000, seed: 2 })
    assert.ok(!isUncertaintyError(result))
    assert.equal(result.contributions[0].id, 'a')
    assert.ok(result.contributions[0].first > 0.95, `${result.contributions[0].first}`)
  })

  test('a purely additive model has first-order indices adding to about one', () => {
    const a = q('a', 0, '', { uncertainty: standard(1) })
    const b = q('b', 0, '', { uncertainty: standard(1) })
    const result = globalSensitivity([a, b], ([x, y]) => x + y, { samples: 6000, seed: 3 })
    assert.ok(!isUncertaintyError(result))
    assert.ok(Math.abs(result.firstOrderSum - 1) < 0.1, `${result.firstOrderSum}`)
    assert.ok(result.notes.some((one) => /close to one/.test(one)))
  })

  test('a purely interactive model shows total effects far above first-order ones', () => {
    // y = x*z with both centred on zero: neither input alone explains any variance, but together they explain all of it.
    const a = q('a', 0, '', { uncertainty: standard(1) })
    const b = q('b', 0, '', { uncertainty: standard(1) })
    const result = globalSensitivity([a, b], ([x, y]) => x * y, { samples: 8000, seed: 9 })
    assert.ok(!isUncertaintyError(result))
    assert.ok(result.firstOrderSum < 0.3, `first-order sum ${result.firstOrderSum}`)
    assert.ok(result.contributions[0].total > 0.6, `total ${result.contributions[0].total}`)
    assert.ok(result.contributions[0].interaction > 0.4)
    assert.ok(result.notes.some((one) => /inputs acting together/.test(one)))
  })

  test('an output that does not vary is refused rather than given made-up shares', () => {
    const a = q('a', 0, '', { uncertainty: standard(1) })
    const result = globalSensitivity([a], () => 7, { samples: 500 })
    assert.ok(isUncertaintyError(result))
    assert.equal(result.error, 'no-variance')
  })

  test('an all-exact set is refused, because there is no variance to attribute', () => {
    const pi = exact('pi', Math.PI)
    assert.ok(!isUncertaintyError(pi))
    const result = globalSensitivity([pi], ([x]) => x * 2, { samples: 500 })
    assert.ok(isUncertaintyError(result))
    assert.equal(result.error, 'no-values')
  })

  test('the model-call cost is reported, because it is the surprising part', () => {
    const inputs = [q('a', 0, '', { uncertainty: standard(1) }), q('b', 0, '', { uncertainty: standard(1) })]
    const result = globalSensitivity(inputs, ([x, y]) => x + y, { samples: 1000, seed: 1 })
    assert.ok(!isUncertaintyError(result))
    assert.equal(result.modelCalls, 1000 * 4)
  })

  test('the same seed gives the same indices', () => {
    const inputs = [q('a', 0, '', { uncertainty: standard(1) }), q('b', 0, '', { uncertainty: standard(2) })]
    const first = globalSensitivity(inputs, ([x, y]) => x + y, { samples: 1000, seed: 17 })
    const again = globalSensitivity(inputs, ([x, y]) => x + y, { samples: 1000, seed: 17 })
    assert.ok(!isUncertaintyError(first) && !isUncertaintyError(again))
    assert.deepEqual(
      first.contributions.map((one) => one.first),
      again.contributions.map((one) => one.first)
    )
  })
})

describe('uncertainty budgets', () => {
  test('each declared source becomes its own line with its share of the variance', () => {
    const mass = q('m', 100, 'g', {
      label: 'Mass',
      sources: [
        { id: 'balance', component: 'instrument', standard: 0.08, systematic: true, describe: 'Balance' },
        { id: 'repeats', component: 'repeatability', standard: 0.05, systematic: false, describe: 'Repeatability' },
        { id: 'cal', component: 'calibration', standard: 0.03, systematic: true, describe: 'Calibration' }
      ]
    })
    const propagated = propagateFirstOrder([mass], ([x]) => x)
    assert.ok(!isUncertaintyError(propagated))
    const budget = uncertaintyBudget([mass], propagated.sensitivities)
    assert.ok(!isUncertaintyError(budget))
    assert.equal(budget.lines.length, 3)
    // sqrt(0.08^2 + 0.05^2 + 0.03^2) = 0.0989...
    assert.ok(Math.abs(budget.combined - Math.hypot(0.08, 0.05, 0.03)) < 1e-9)
    const shares = budget.lines.reduce((sum, one) => sum + one.share, 0)
    assert.ok(Math.abs(shares - 1) < 1e-9)
    assert.equal(budget.lines[0].component, 'instrument')
  })

  test('the systematic part is separated, because repeating the measurement will not shrink it', () => {
    const mass = q('m', 100, 'g', {
      sources: [
        { id: 'cal', component: 'calibration', standard: 4, systematic: true, describe: 'Calibration' },
        { id: 'repeats', component: 'repeatability', standard: 3, systematic: false, describe: 'Repeatability' }
      ]
    })
    const propagated = propagateFirstOrder([mass], ([x]) => x)
    assert.ok(!isUncertaintyError(propagated))
    const budget = uncertaintyBudget([mass], propagated.sensitivities)
    assert.ok(!isUncertaintyError(budget))
    assert.ok(Math.abs(budget.systematicPart - 4) < 1e-9)
    assert.ok(Math.abs(budget.randomPart - 3) < 1e-9)
    assert.ok(budget.notes.some((one) => /will not shrink by measuring again/.test(one)))
  })

  test('a quantity with no declared sources gets one honest line, not an invented breakdown', () => {
    const one = q('x', 10, 'm', { uncertainty: standard(0.5) })
    const propagated = propagateFirstOrder([one], ([v]) => v)
    assert.ok(!isUncertaintyError(propagated))
    const budget = uncertaintyBudget([one], propagated.sensitivities)
    assert.ok(!isUncertaintyError(budget))
    assert.equal(budget.lines.length, 1)
    assert.match(budget.lines[0].describe, /No breakdown into components was given/)
  })

  test('an all-exact set has no budget to show', () => {
    const pi = exact('pi', Math.PI)
    assert.ok(!isUncertaintyError(pi))
    const propagated = propagateFirstOrder([pi], ([x]) => x)
    assert.ok(!isUncertaintyError(propagated))
    const budget = uncertaintyBudget([pi], propagated.sensitivities)
    assert.ok(isUncertaintyError(budget))
  })

  test('the expanded uncertainty uses the coverage factor for the level', () => {
    const one = q('x', 10, 'm', { uncertainty: standard(2) })
    const propagated = propagateFirstOrder([one], ([v]) => v)
    assert.ok(!isUncertaintyError(propagated))
    const budget = uncertaintyBudget([one], propagated.sensitivities, 0.95)
    assert.ok(!isUncertaintyError(budget))
    assert.ok(Math.abs(budget.expanded - budget.combined * budget.coverageFactor) < 1e-12)
    assert.ok(Math.abs(budget.coverageFactor - 1.96) < 0.01)
  })

  test('every component has a label, so a budget can be grouped without inventing names', () => {
    assert.equal(COMPONENT_LABEL.calibration, 'Calibration')
    assert.equal(Object.keys(COMPONENT_LABEL).length, 7)
  })
})

describe('assumption checks', () => {
  test('a straight model with small uncertainties passes every check', () => {
    const a = q('a', 100, '', { uncertainty: standard(1) })
    const result = propagateFirstOrder([a], ([x]) => 2 * x)
    assert.ok(!isUncertaintyError(result))
    const checks = checkAssumptions([a], ([x]) => 2 * x, result)
    assert.ok(checks.every((one) => one.holds), JSON.stringify(checks.filter((one) => !one.holds)))
  })

  test('a large relative uncertainty is flagged with the number it was decided on', () => {
    const a = q('a', 10, '', { uncertainty: standard(5) })
    const result = propagateFirstOrder([a], ([x]) => x)
    assert.ok(!isUncertaintyError(result))
    const check = checkAssumptions([a], ([x]) => x, result).find((one) => one.id === 'relative-uncertainty')
    assert.equal(check?.holds, false)
    assert.match(check?.evidence ?? '', /50%/)
  })

  test('a strongly curved model fails the curvature check', () => {
    const a = q('a', 1, '', { uncertainty: standard(0.5) })
    const model = ([x]: readonly number[]): number => Math.exp(3 * x)
    const result = propagateFirstOrder([a], model)
    assert.ok(!isUncertaintyError(result))
    const check = checkAssumptions([a], model, result).find((one) => one.id === 'curvature')
    assert.equal(check?.holds, false)
    assert.match(check?.suggestion ?? '', /Monte Carlo/)
  })

  test('a bounded input is flagged, because a symmetric interval cannot represent it', () => {
    const a = q('a', 5, '', { distribution: { kind: 'uniform', low: 0, high: 10 } })
    const result = propagateFirstOrder([a], ([x]) => x)
    assert.ok(!isUncertaintyError(result))
    const check = checkAssumptions([a], ([x]) => x, result).find((one) => one.id === 'output-shape')
    assert.equal(check?.holds, false)
  })

  test('independence is flagged as an assumption whenever two or more inputs vary', () => {
    const inputs = [q('a', 1, '', { uncertainty: standard(0.01) }), q('b', 1, '', { uncertainty: standard(0.01) })]
    const result = propagateFirstOrder(inputs, ([x, y]) => x + y)
    assert.ok(!isUncertaintyError(result))
    const check = checkAssumptions(inputs, ([x, y]) => x + y, result).find((one) => one.id === 'independence')
    assert.equal(check?.holds, false)
    assert.match(check?.suggestion ?? '', /same instrument/)
  })

  test('a single varying input is not flagged for independence, because there is nothing to be independent of', () => {
    const inputs = [q('a', 1, '', { uncertainty: standard(0.01) })]
    const result = propagateFirstOrder(inputs, ([x]) => x)
    assert.ok(!isUncertaintyError(result))
    const check = checkAssumptions(inputs, ([x]) => x, result).find((one) => one.id === 'independence')
    assert.equal(check?.holds, true)
  })
})

describe('comparing the two methods', () => {
  test('a linear model has the two agreeing, and says the cheap one was enough', () => {
    const inputs = [q('a', 10, '', { uncertainty: standard(1) }), q('b', 20, '', { uncertainty: standard(2) })]
    const comparison = compareMethods(inputs, ([x, y]) => x + y, { samples: 40_000, seed: 3 })
    assert.ok(!isUncertaintyError(comparison))
    assert.equal(comparison.agree, true)
    assert.ok(Math.abs(comparison.ratio - 1) < 0.05)
    assert.match(comparison.summary, /the cheaper one was enough/)
  })

  test('a strongly curved model has the two disagreeing, and neither is declared better', () => {
    const x = q('x', 1, '', { uncertainty: standard(0.6) })
    const comparison = compareMethods([x], ([v]) => Math.exp(4 * v), { samples: 40_000, seed: 8 })
    assert.ok(!isUncertaintyError(comparison))
    assert.equal(comparison.agree, false)
    assert.ok(comparison.differences.length > 0)
    // The summary has to give the caller the trade-off rather than a recommendation.
    assert.match(comparison.summary, /Which to report depends on/)
    assert.doesNotMatch(comparison.summary, /you should use/i)
  })

  test('the disagreement mentions the lopsidedness that linear propagation cannot represent', () => {
    const x = q('x', 0, '', { uncertainty: standard(1) })
    const comparison = compareMethods([x], ([v]) => Math.exp(v), { samples: 40_000, seed: 14 })
    assert.ok(!isUncertaintyError(comparison))
    assert.ok(comparison.differences.some((one) => /lopsided/.test(one)))
  })
})

describe('chains', () => {
  test('uncertainty carries through a chain of derived quantities', () => {
    const mass = q('m', 100, 'g', { uncertainty: standard(1) })
    const volume = q('V', 50, 'cm^3', { uncertainty: standard(0.5) })
    const chain = propagateChain([mass, volume], [
      { id: 'density', label: 'Density', from: ['m', 'V'], unit: 'g/cm^3', model: ([m, v]) => m / v },
      { id: 'twice', label: 'Twice density', from: ['density'], unit: 'g/cm^3', model: ([d]) => 2 * d }
    ])
    assert.ok(!isUncertaintyError(chain))
    const density = chain.nodes.find((one) => one.id === 'density')
    assert.ok(density)
    assert.ok(Math.abs(density.value - 2) < 1e-9)
    // Relative uncertainties 1% and 1% in quadrature is sqrt(2)%, on a value of 2.
    assert.ok(Math.abs(density.standardUncertainty - 2 * Math.SQRT2 * 0.01) < 1e-4)
    const twice = chain.nodes.find((one) => one.id === 'twice')
    assert.ok(Math.abs((twice?.standardUncertainty ?? 0) - 2 * density.standardUncertainty) < 1e-6)
  })

  test('a step that combines two quantities sharing an input says the answer is not right', () => {
    // This is the trap the graph exists to catch: a and b both come from x, so combining them is not independent.
    const x = q('x', 10, '', { uncertainty: standard(1) })
    const chain = propagateChain([x], [
      { id: 'a', from: ['x'], model: ([v]) => v * 2 },
      { id: 'b', from: ['x'], model: ([v]) => v * 3 },
      { id: 'c', from: ['a', 'b'], model: ([p, r]) => p + r }
    ])
    assert.ok(!isUncertaintyError(chain))
    assert.ok(chain.notes.some((one) => /therefore correlated/.test(one)))
    assert.ok(chain.notes.some((one) => /Propagate from the original inputs in one step/.test(one)))
  })

  test('the paths record which original inputs each derived quantity depends on', () => {
    const a = q('a', 1, '', { uncertainty: standard(0.1) })
    const b = q('b', 2, '', { uncertainty: standard(0.1) })
    const chain = propagateChain([a, b], [{ id: 'sum', from: ['a', 'b'], model: ([x, y]) => x + y }])
    assert.ok(!isUncertaintyError(chain))
    const path = chain.paths.find((one) => one.to === 'sum')
    assert.deepEqual(path?.through.slice().sort(), ['a', 'b'])
  })

  test('a step built from something that does not exist is refused', () => {
    const a = q('a', 1, '', { uncertainty: standard(0.1) })
    const chain = propagateChain([a], [{ id: 'x', from: ['missing'], model: ([v]) => v }])
    assert.ok(isUncertaintyError(chain))
    assert.equal(chain.error, 'not-found')
  })

  test('a step reusing an existing id is refused rather than shadowing it', () => {
    const a = q('a', 1, '', { uncertainty: standard(0.1) })
    const chain = propagateChain([a], [{ id: 'a', from: ['a'], model: ([v]) => v }])
    assert.ok(isUncertaintyError(chain))
    assert.equal(chain.error, 'duplicate')
  })

  test('provenance is carried forward, so a derived quantity does not become a measurement', () => {
    const measured = q('m', 1, '', { uncertainty: standard(0.1), provenance: 'measured' })
    const simulated = q('s', 1, '', { uncertainty: standard(0.1), provenance: 'simulated' })
    const chain = propagateChain([measured, simulated], [{ id: 'both', from: ['m', 's'], model: ([x, y]) => x + y }])
    assert.ok(!isUncertaintyError(chain))
    // Anything touching a simulated value is simulated.
    assert.equal(chain.nodes.find((one) => one.id === 'both')?.provenance, 'simulated')
  })
})

describe('the assumptions are stated', () => {
  test('the list names the distinctions the engine is built on', () => {
    assert.ok(UNCERTAINTY_ASSUMPTIONS.length >= 7)
    assert.ok(UNCERTAINTY_ASSUMPTIONS.some((one) => /exact value has no uncertainty/.test(one)))
    assert.ok(UNCERTAINTY_ASSUMPTIONS.some((one) => /Independence is only ever assumed/.test(one)))
    assert.ok(UNCERTAINTY_ASSUMPTIONS.some((one) => /not convergence/.test(one)))
    assert.ok(UNCERTAINTY_ASSUMPTIONS.some((one) => /Error needs a reference/.test(one)))
  })

  test('the limits are readable numbers rather than magic constants inside the engine', () => {
    assert.equal(UNCERTAINTY_LIMITS.inputs, 64)
    assert.ok(UNCERTAINTY_LIMITS.samples >= 1_000_000)
  })
})
