import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  checkFit,
  checkPoints,
  checkResiduals,
  compareFits,
  evaluateInterpolant,
  FAMILIES,
  FAMILY_FACTS,
  fit,
  INDISTINGUISHABLE_WITHIN,
  INTERPOLATION_FACTS,
  INTERPOLATION_KINDS,
  interpolant,
  interpolationGrid,
  isFitError,
  predictFrom,
  type Fit
} from './interpolate.ts'

function noise(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296 - 0.5
  }
}

const closeTo = (actual: number, expected: number, tolerance: number, what = ''): void => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what} expected ${expected} within ${tolerance}, got ${actual}`)
}

const range = (count: number, from = 0, step = 1): number[] => Array.from({ length: count }, (_, i) => from + i * step)

describe('checkPoints', () => {
  it('sorts by x and says it reordered', () => {
    const result = checkPoints([3, 1, 2], [30, 10, 20])
    assert.ok(!isFitError(result))
    assert.deepEqual([...result.x], [1, 2, 3])
    assert.deepEqual([...result.y], [10, 20, 30])
    assert.equal(result.reordered, true)
  })

  it('does not claim to have reordered points that were already in order', () => {
    const result = checkPoints([1, 2, 3], [1, 4, 9])
    assert.ok(!isFitError(result))
    assert.equal(result.reordered, false)
  })

  it('refuses duplicate x rather than averaging them', () => {
    const result = checkPoints([1, 2, 2], [1, 2, 5])
    assert.ok(isFitError(result))
    assert.equal(result.error, 'duplicate-x')
    assert.match(result.message, /Decide which it is first/)
  })

  it('refuses mismatched lengths', () => {
    const result = checkPoints([1, 2], [1])
    assert.ok(isFitError(result))
    assert.equal(result.error, 'mismatched-length')
  })

  it('names which value is not finite', () => {
    const result = checkPoints([1, 2, 3], [1, null, 3])
    assert.ok(isFitError(result))
    assert.match(result.message, /y value at index 1/)
  })

  it('refuses no points at all', () => {
    assert.ok(isFitError(checkPoints([], [])))
  })
})

describe('interpolant', () => {
  it('has facts for every kind it lists', () => {
    for (const kind of INTERPOLATION_KINDS) {
      assert.ok(Object.prototype.hasOwnProperty.call(INTERPOLATION_FACTS, kind), kind)
      assert.ok(INTERPOLATION_FACTS[kind].wrongWhen.length > 20, kind)
    }
  })

  it('passes exactly through every point, for every kind', () => {
    const x = [0, 1, 2, 3, 4]
    const y = [1, 3, 2, 5, 4]
    for (const kind of INTERPOLATION_KINDS) {
      const one = interpolant(x, y, kind)
      assert.ok(!isFitError(one), kind)
      const at = evaluateInterpolant(one, x)
      assert.ok(!isFitError(at), kind)
      for (let i = 0; i < x.length; i += 1) {
        closeTo(at.values[i] as number, y[i] as number, 1e-9, `${kind} at x=${x[i]}`)
      }
    }
  })

  it('interpolates a straight line exactly with linear segments', () => {
    const one = interpolant([0, 1, 2], [0, 10, 20], 'linear')
    assert.ok(!isFitError(one))
    const at = evaluateInterpolant(one, [0.5, 1.5])
    assert.ok(!isFitError(at))
    assert.deepEqual([...at.values], [5, 15])
  })

  it('makes a staircase with nearest, not a ramp', () => {
    const one = interpolant([0, 1, 2], [0, 10, 20], 'nearest')
    assert.ok(!isFitError(one))
    const at = evaluateInterpolant(one, [0.4, 0.6])
    assert.ok(!isFitError(at))
    assert.deepEqual([...at.values], [0, 10])
  })

  it('reports that a cubic spline overshoots a step, measured rather than assumed', () => {
    const one = interpolant([0, 1, 2, 3, 4, 5], [0, 0, 0, 10, 10, 10], 'cubic-spline')
    assert.ok(!isFitError(one))
    assert.ok(one.overshoot > 0.1, `expected a real overshoot, got ${one.overshoot}`)
    assert.ok(one.caveats.some((c) => /outside the measured range of y/.test(c)))
    assert.ok(one.caveats.some((c) => /Monotone cubic interpolation cannot do this/.test(c)))
  })

  it('does not overshoot the same step with monotone cubic', () => {
    const one = interpolant([0, 1, 2, 3, 4, 5], [0, 0, 0, 10, 10, 10], 'monotone-cubic')
    assert.ok(!isFitError(one))
    assert.ok(one.overshoot < 1e-9, `expected no overshoot, got ${one.overshoot}`)
    assert.ok(!one.caveats.some((c) => /outside the measured range of y/.test(c)))
  })

  it('keeps a monotone series monotone all the way through', () => {
    const x = [0, 1, 2, 3, 4, 5, 6]
    const y = [0, 0.1, 0.2, 5, 9.8, 9.9, 10]
    const one = interpolant(x, y, 'monotone-cubic')
    assert.ok(!isFitError(one))
    const grid = interpolationGrid(one, 400)
    assert.ok(!isFitError(grid))
    for (let i = 1; i < grid.values.length; i += 1) {
      assert.ok(
        (grid.values[i] as number) >= (grid.values[i - 1] as number) - 1e-9,
        `value fell at index ${i}: ${grid.values[i - 1]} then ${grid.values[i]}`
      )
    }
  })

  it('reports no overshoot for a spline through smooth data with no peak between samples', () => {
    const x = range(9)
    const one = interpolant(x, x.map((t) => t ** 3), 'cubic-spline')
    assert.ok(!isFitError(one))
    // Monotone and smooth: there is nowhere for the curve to go outside the range its own endpoints bound.
    assert.ok(one.overshoot < 1e-6, `got ${one.overshoot}`)
  })

  it('overshoots a peak that falls between two samples, which is the spline being right', () => {
    // sin(t/3) peaks at t ≈ 4.712, between the samples at 4 and 5. The highest measurement is 0.995 and the function
    // really does reach 1. A curve that refused to exceed the measurements would be wrong here — which is why
    // overshoot is measured and reported rather than treated as a defect.
    const x = range(9)
    const one = interpolant(x, x.map((t) => Math.sin(t / 3)), 'cubic-spline')
    assert.ok(!isFitError(one))
    assert.ok(one.overshoot > 0)
    closeTo(one.yMax + one.overshoot, 1, 1e-3)
    const flattened = interpolant(x, x.map((t) => Math.sin(t / 3)), 'monotone-cubic')
    assert.ok(!isFitError(flattened))
    // The monotone version cannot overshoot, so it misses the peak entirely. Neither is the right answer everywhere.
    assert.ok(flattened.overshoot < 1e-9)
  })

  it('honours clamped end slopes', () => {
    const one = interpolant([0, 1, 2, 3, 4, 5], [0, 0, 0, 10, 10, 10], 'cubic-spline', { endSlopes: [0, 0] })
    assert.ok(!isFitError(one))
    const step = 1e-6
    const at = evaluateInterpolant(one, [0, step])
    assert.ok(!isFitError(at))
    // A forward difference reads the slope plus the curvature times the step, so the step has to be small enough
    // that the curvature term is below the tolerance being asserted.
    const slope = ((at.values[1] as number) - (at.values[0] as number)) / step
    closeTo(slope, 0, 1e-4)
    assert.ok(one.caveats.some((c) => /came from outside the data/.test(c)))
  })

  it('says a natural spline chose its own end curvature', () => {
    const one = interpolant([0, 1, 2, 3], [0, 1, 4, 9], 'cubic-spline')
    assert.ok(!isFitError(one))
    assert.ok(one.caveats.some((c) => /That is a choice, not a measurement/.test(c)))
  })

  it('interpolates a cubic exactly with a polynomial through four points', () => {
    const f = (t: number): number => 2 * t ** 3 - 5 * t ** 2 + t - 7
    const x = [-1, 0, 2, 3]
    const one = interpolant(x, x.map(f), 'polynomial')
    assert.ok(!isFitError(one))
    const at = evaluateInterpolant(one, [0.5, 1, 1.5, 2.5])
    assert.ok(!isFitError(at))
    for (let i = 0; i < at.at.length; i += 1) {
      closeTo(at.values[i] as number, f(at.at[i] as number), 1e-9, `at x=${at.at[i]}`)
    }
  })

  it('refuses a polynomial degree high enough to oscillate, and says what to do instead', () => {
    const x = range(14)
    const result = interpolant(x, x.map((t) => t * t), 'polynomial')
    assert.ok(isFitError(result))
    assert.match(result.message, /oscillates wildly/)
    assert.match(result.message, /Use a cubic spline/)
  })

  it('needs three points for a spline and two for a line', () => {
    assert.ok(isFitError(interpolant([0, 1], [0, 1], 'cubic-spline')))
    assert.ok(isFitError(interpolant([0], [0], 'linear')))
    assert.ok(!isFitError(interpolant([0], [5], 'nearest')))
  })

  it('refuses a kind it does not know', () => {
    const result = interpolant([0, 1, 2], [0, 1, 2], 'akima' as never)
    assert.ok(isFitError(result))
    assert.match(result.message, /nearest/)
  })

  it('always says where it is defined', () => {
    for (const kind of INTERPOLATION_KINDS) {
      const one = interpolant([2, 4, 6, 8], [1, 2, 3, 4], kind)
      assert.ok(!isFitError(one), kind)
      assert.equal(one.xMin, 2)
      assert.equal(one.xMax, 8)
      assert.ok(one.caveats.some((c) => /does not extrapolate/.test(c)), kind)
    }
  })

  it('notes that sorting happened when it did', () => {
    const one = interpolant([2, 0, 1], [20, 0, 10], 'linear')
    assert.ok(!isFitError(one))
    assert.ok(one.caveats.some((c) => /given out of order/.test(c)))
  })
})

describe('evaluateInterpolant', () => {
  it('refuses points outside the measured range and names them', () => {
    const one = interpolant([0, 1, 2], [0, 1, 4], 'cubic-spline')
    assert.ok(!isFitError(one))
    const at = evaluateInterpolant(one, [-1, 1, 3])
    assert.ok(!isFitError(at))
    assert.deepEqual([...at.at], [1])
    assert.deepEqual([...at.refusedOutside], [-1, 3])
    assert.match(at.why, /nothing was measured in/)
  })

  it('accepts the endpoints themselves', () => {
    const one = interpolant([0, 1, 2], [0, 1, 4], 'linear')
    assert.ok(!isFitError(one))
    const at = evaluateInterpolant(one, [0, 2])
    assert.ok(!isFitError(at))
    assert.deepEqual([...at.refusedOutside], [])
    assert.deepEqual([...at.values], [0, 4])
  })

  it('makes a grid that spans exactly the measured range', () => {
    const one = interpolant([3, 5, 9], [1, 2, 3], 'linear')
    assert.ok(!isFitError(one))
    const grid = interpolationGrid(one, 5)
    assert.ok(!isFitError(grid))
    assert.equal(grid.at.length, 5)
    assert.equal(grid.at[0], 3)
    assert.equal(grid.at[4], 9)
  })

  it('refuses a grid of one point', () => {
    const one = interpolant([0, 1], [0, 1], 'linear')
    assert.ok(!isFitError(one))
    assert.ok(isFitError(interpolationGrid(one, 1)))
  })
})

describe('fit', () => {
  it('has facts for every family it lists', () => {
    for (const family of FAMILIES) {
      assert.ok(Object.prototype.hasOwnProperty.call(FAMILY_FACTS, family), family)
      assert.ok(FAMILY_FACTS[family].assumes.length > 20, family)
      assert.ok(FAMILY_FACTS[family].form.includes('y'), family)
    }
  })

  it('fits a straight line exactly', () => {
    const x = range(10)
    const result = fit(x, x.map((t) => 3 * t + 7), 'linear')
    assert.ok(!isFitError(result))
    closeTo(result.parameters[0]?.value as number, 7, 1e-9)
    closeTo(result.parameters[1]?.value as number, 3, 1e-9)
    closeTo(result.rSquared, 1, 1e-9)
    assert.equal(result.viaTransform, false)
    assert.equal(result.parameterCount, 2)
  })

  it('recovers a quadratic exactly', () => {
    const x = range(12, -5)
    const result = fit(x, x.map((t) => 2 * t * t - 3 * t + 1), 'polynomial', { degree: 2 })
    assert.ok(!isFitError(result))
    closeTo(result.parameters[0]?.value as number, 1, 1e-6)
    closeTo(result.parameters[1]?.value as number, -3, 1e-6)
    closeTo(result.parameters[2]?.value as number, 2, 1e-6)
    assert.equal(result.degree, 2)
  })

  it('refuses to let a perfect fit through too few points look like a good fit', () => {
    const result = fit([0, 1, 2], [5, 2, 9], 'polynomial', { degree: 2 })
    assert.ok(!isFitError(result))
    closeTo(result.rSquared, 1, 1e-9)
    assert.ok(result.caveats.some((c) => /zero by construction/.test(c)))
    assert.ok(result.caveats.some((c) => /says nothing at all about the shape being right/.test(c)))
  })

  it('needs a degree for a polynomial and refuses a silly one', () => {
    assert.ok(isFitError(fit([0, 1, 2], [1, 2, 3], 'polynomial')))
    assert.ok(isFitError(fit(range(20), range(20), 'polynomial', { degree: 12 })))
    assert.ok(isFitError(fit([0, 1, 2], [1, 2, 3], 'polynomial', { degree: 5 })))
  })

  it('warns that a high degree can follow the noise', () => {
    const x = range(20)
    const result = fit(x, x.map((t) => t * t), 'polynomial', { degree: 5 })
    assert.ok(!isFitError(result))
    assert.ok(result.caveats.some((c) => /follow the noise as well as the signal/.test(c)))
  })

  it('recovers an exponential and reports its doubling in x', () => {
    const x = range(10)
    const result = fit(x, x.map((t) => 5 * Math.exp(0.3 * t)), 'exponential')
    assert.ok(!isFitError(result))
    closeTo(result.parameters[0]?.value as number, 5, 1e-6)
    closeTo(result.parameters[1]?.value as number, 0.3, 1e-9)
    assert.equal(result.viaTransform, true)
    assert.ok(result.caveats.some((c) => /doubles every/.test(c)))
  })

  it('fits an all-negative exponential', () => {
    const x = range(8)
    const result = fit(x, x.map((t) => -2 * Math.exp(0.4 * t)), 'exponential')
    assert.ok(!isFitError(result))
    closeTo(result.parameters[0]?.value as number, -2, 1e-6)
    closeTo(result.parameters[1]?.value as number, 0.4, 1e-9)
  })

  it('refuses an exponential through y values of mixed sign', () => {
    const result = fit([0, 1, 2], [-1, 1, 2], 'exponential')
    assert.ok(isFitError(result))
    assert.equal(result.error, 'domain')
    assert.match(result.message, /never crosses zero/)
  })

  it('refuses an exponential through a zero', () => {
    assert.ok(isFitError(fit([0, 1, 2], [0, 1, 2], 'exponential')))
  })

  it('recovers a power law and says what doubling x does', () => {
    const x = range(10, 1)
    const result = fit(x, x.map((t) => 3 * t ** 1.5), 'power')
    assert.ok(!isFitError(result))
    closeTo(result.parameters[0]?.value as number, 3, 1e-6)
    closeTo(result.parameters[1]?.value as number, 1.5, 1e-9)
    assert.ok(result.caveats.some((c) => /doubling x multiplies y/.test(c)))
  })

  it('refuses a power law where x or y reaches zero', () => {
    assert.ok(isFitError(fit([0, 1, 2], [1, 2, 3], 'power')))
    assert.ok(isFitError(fit([1, 2, 3], [0, 2, 3], 'power')))
  })

  it('recovers a logarithmic curve and notes it has no ceiling', () => {
    const x = range(10, 1)
    const result = fit(x, x.map((t) => 4 + 2 * Math.log(t)), 'logarithmic')
    assert.ok(!isFitError(result))
    closeTo(result.parameters[0]?.value as number, 4, 1e-9)
    closeTo(result.parameters[1]?.value as number, 2, 1e-9)
    assert.ok(result.caveats.some((c) => /no ceiling/.test(c)))
    // The fit is linear in y, so it is not a transformed fit in the sense that matters for the error being minimised.
    assert.equal(result.viaTransform, false)
  })

  it('recovers a reciprocal and names the level as an extrapolation', () => {
    const x = range(10, 1)
    const result = fit(x, x.map((t) => 6 + 12 / t), 'reciprocal')
    assert.ok(!isFitError(result))
    closeTo(result.parameters[0]?.value as number, 6, 1e-9)
    closeTo(result.parameters[1]?.value as number, 12, 1e-9)
    assert.ok(result.caveats.some((c) => /not something the data reached/.test(c)))
  })

  it('refuses a reciprocal at x = 0', () => {
    assert.ok(isFitError(fit([0, 1, 2], [1, 2, 3], 'reciprocal')))
  })

  it('asks for a logistic ceiling instead of guessing one', () => {
    const result = fit(range(10), range(10).map((t) => 100 / (1 + Math.exp(-0.5 * (t - 5)))), 'logistic')
    assert.ok(isFitError(result))
    assert.match(result.message, /whatever the curve happens to want/)
  })

  it('recovers a logistic curve when the ceiling is given', () => {
    const x = range(12)
    const y = x.map((t) => 100 / (1 + Math.exp(-0.5 * (t - 5))))
    const result = fit(x, y, 'logistic', { ceiling: 100 })
    assert.ok(!isFitError(result))
    closeTo(result.parameters[1]?.value as number, 0.5, 1e-9)
    closeTo(result.parameters[2]?.value as number, 5, 1e-6)
    assert.ok(result.caveats.some((c) => /steepest point is at x = 5/.test(c)))
    assert.ok(result.caveats.some((c) => /was supplied, not fitted/.test(c)))
    // The ceiling was given, so it is not one of the numbers this fit estimated.
    assert.equal(result.parameterCount, 2)
  })

  it('says when a logistic midpoint sits outside the data', () => {
    const x = range(6)
    const y = x.map((t) => 100 / (1 + Math.exp(-0.5 * (t - 20))))
    const result = fit(x, y, 'logistic', { ceiling: 100 })
    assert.ok(!isFitError(result))
    assert.ok(result.caveats.some((c) => /describing a bend the data has not reached/.test(c)))
  })

  it('refuses a logistic fit where a measurement reaches the ceiling', () => {
    const result = fit([0, 1, 2], [10, 50, 100], 'logistic', { ceiling: 100 })
    assert.ok(isFitError(result))
    assert.equal(result.error, 'domain')
    assert.match(result.message, /only in the limit/)
  })

  it('computes R² on the original scale for a transformed fit, and says so', () => {
    const x = range(12)
    const rng = noise(5)
    // Growth with proportional scatter: the log fit looks near-perfect in log space and rather less so in y.
    const y = x.map((t) => 5 * Math.exp(0.4 * t) * (1 + 0.15 * rng()))
    const result = fit(x, y, 'exponential')
    assert.ok(!isFitError(result))
    assert.ok(result.caveats.some((c) => /computed on the original scale of y/.test(c)))
    assert.ok(result.caveats.some((c) => /minimises proportional error/.test(c)))
    // Verify the claim rather than trust the sentence: the log-space R² really is higher.
    const logs = y.map((one) => Math.log(one))
    const logFit = fit(x, logs, 'linear')
    assert.ok(!isFitError(logFit))
    assert.ok(logFit.rSquared > result.rSquared)
  })

  it('always says that R² does not make a shape right', () => {
    for (const family of FAMILIES) {
      const x = range(12, 1)
      const y = x.map((t) => 2 * t + 3)
      const one = fit(x, y, family, { degree: 2, ceiling: 1000 })
      if (isFitError(one)) continue
      assert.ok(one.caveats.some((c) => /does not say the shape is the right one/.test(c)), family)
    }
  })

  it('says R² means nothing when y never varies', () => {
    const result = fit([1, 2, 3, 4], [5, 5, 5, 5], 'linear')
    assert.ok(!isFitError(result))
    assert.ok(result.caveats.some((c) => /no variation for a fit to account for/.test(c)))
  })

  it('refuses a family it does not know', () => {
    assert.ok(isFitError(fit([1, 2, 3], [1, 2, 3], 'sigmoid' as never)))
  })
})

describe('predictFrom', () => {
  it('evaluates each family at its own points', () => {
    const x = range(10, 1)
    const cases: { family: Parameters<typeof fit>[2]; y: number[]; at: number; want: number }[] = [
      { family: 'linear', y: x.map((t) => 2 * t + 1), at: 20, want: 41 },
      { family: 'exponential', y: x.map((t) => 2 * Math.exp(0.5 * t)), at: 3, want: 2 * Math.exp(1.5) },
      { family: 'power', y: x.map((t) => 3 * t ** 2), at: 4, want: 48 },
      { family: 'logarithmic', y: x.map((t) => 1 + 2 * Math.log(t)), at: Math.E, want: 3 },
      { family: 'reciprocal', y: x.map((t) => 5 + 10 / t), at: 2, want: 10 }
    ]
    for (const one of cases) {
      const fitted = fit(x, one.y, one.family)
      assert.ok(!isFitError(fitted), one.family)
      const result = predictFrom(fitted, [one.at])
      assert.ok(!isFitError(result), one.family)
      closeTo(result.values[0] as number, one.want, 1e-6, one.family)
    }
  })

  it('evaluates a polynomial fit at its own powers', () => {
    const x = range(10)
    const fitted = fit(x, x.map((t) => t ** 3 - 2 * t), 'polynomial', { degree: 3 })
    assert.ok(!isFitError(fitted))
    const result = predictFrom(fitted, [2.5])
    assert.ok(!isFitError(result))
    closeTo(result.values[0] as number, 2.5 ** 3 - 5, 1e-6)
  })

  it('evaluates a logistic fit', () => {
    const x = range(12)
    const fitted = fit(x, x.map((t) => 80 / (1 + Math.exp(-0.6 * (t - 4)))), 'logistic', { ceiling: 80 })
    assert.ok(!isFitError(fitted))
    const result = predictFrom(fitted, [4])
    assert.ok(!isFitError(result))
    closeTo(result.values[0] as number, 40, 1e-6)
  })

  it('will go outside the data, and says what that means', () => {
    const x = range(5, 1)
    const fitted = fit(x, x.map((t) => 2 * t), 'linear')
    assert.ok(!isFitError(fitted))
    const result = predictFrom(fitted, [1000])
    assert.ok(!isFitError(result))
    closeTo(result.values[0] as number, 2000, 1e-6)
    assert.match(result.why, /assertions about the shape continuing/)
  })

  it('refuses a point outside a family own domain', () => {
    const x = range(5, 1)
    const fitted = fit(x, x.map((t) => Math.log(t) + 1), 'logarithmic')
    assert.ok(!isFitError(fitted))
    const result = predictFrom(fitted, [-1])
    assert.ok(isFitError(result))
    assert.equal(result.error, 'domain')
  })
})

describe('checkResiduals', () => {
  it('finds the curvature a straight line leaves in quadratic data', () => {
    const x = range(20)
    const fitted = fit(x, x.map((t) => (t - 10) ** 2), 'linear')
    assert.ok(!isFitError(fitted))
    const result = checkResiduals(fitted.residuals, { x })
    assert.ok(!isFitError(result))
    const curvature = result.findings.find((one) => one.kind === 'curvature')
    assert.ok(curvature !== undefined, 'expected a curvature finding')
    assert.equal(curvature.severity, 'concern')
    assert.match(curvature.detail, /missing something rather than the data being noisy/)
  })

  it('does not report curvature when a quadratic is fitted to quadratic data', () => {
    const x = range(20)
    const fitted = fit(x, x.map((t) => (t - 10) ** 2), 'polynomial', { degree: 2 })
    assert.ok(!isFitError(fitted))
    const result = checkFit(fitted, x)
    assert.ok(!isFitError(result))
    assert.equal(result.nothingFound, true)
    assert.match(result.why, /level of floating-point rounding/)
  })

  it('reads rounding-level residuals as rounding only when it is told the scale', () => {
    const x = range(20)
    const fitted = fit(x, x.map((t) => (t - 10) ** 2), 'polynomial', { degree: 2 })
    assert.ok(!isFitError(fitted))
    // Without a scale there is no way to tell 1e-13 meaning "exact" from 1e-13 meaning "tiny but real", so the
    // guard cannot apply and the ordinary checks run on the arithmetic's own noise.
    const blind = checkResiduals(fitted.residuals, { x })
    assert.ok(!isFitError(blind))
    assert.ok(!/floating-point rounding/.test(blind.why))
    const informed = checkFit(fitted, x)
    assert.ok(!isFitError(informed))
    assert.match(informed.why, /floating-point rounding/)
  })

  it('still examines residuals that are small but genuinely structured', () => {
    // A thousandth of the y scale is far above rounding, and the guard must not swallow it.
    const x = range(30)
    const y = x.map((t) => 1000 + t + ((t - 15) ** 2) / 1000)
    const fitted = fit(x, y, 'linear')
    assert.ok(!isFitError(fitted))
    const result = checkFit(fitted, x)
    assert.ok(!isFitError(result))
    assert.ok(result.findings.some((one) => one.kind === 'curvature'))
  })

  it('finds a curvature that R² would have missed', () => {
    // A line through a gentle quadratic accounts for almost all the variation and is still the wrong shape.
    const x = range(30, 20)
    const fitted = fit(x, x.map((t) => t * t), 'linear')
    assert.ok(!isFitError(fitted))
    assert.ok(fitted.rSquared > 0.98, `R² was ${fitted.rSquared}`)
    const result = checkResiduals(fitted.residuals, { x })
    assert.ok(!isFitError(result))
    assert.ok(result.findings.some((one) => one.kind === 'curvature'))
    assert.match(result.why, /none of them shows up in R²/)
  })

  it('finds a spread that changes across the range', () => {
    const residuals = [
      ...range(12).map((i) => (i % 2 === 0 ? 0.1 : -0.1)),
      ...range(12).map((i) => (i % 2 === 0 ? 5 : -5))
    ]
    const result = checkResiduals(residuals)
    assert.ok(!isFitError(result))
    const funnel = result.findings.find((one) => one.kind === 'spread-changes')
    assert.ok(funnel !== undefined)
    assert.match(funnel.detail, /pulled harder on the answer/)
  })

  it('finds serial correlation in slowly drifting residuals', () => {
    const residuals = range(40).map((i) => Math.sin((2 * Math.PI * i) / 40))
    const result = checkResiduals(residuals)
    assert.ok(!isFitError(result))
    assert.ok((result.durbinWatson as number) < 1.2)
    assert.ok(result.findings.some((one) => one.kind === 'serial-correlation'))
    assert.equal(result.runs?.tooFew, true)
  })

  it('flags an extreme residual without removing it', () => {
    const rng = noise(21)
    const residuals = range(40).map(() => rng())
    residuals[17] = 20
    const result = checkResiduals(residuals)
    assert.ok(!isFitError(result))
    const extreme = result.findings.find((one) => one.kind === 'extreme-residual')
    assert.ok(extreme !== undefined)
    assert.match(extreme.detail, /flagged, not removed/)
    assert.equal(result.largest?.index, 17)
  })

  it('finds nothing in clean scatter, and does not call that proof', () => {
    const rng = noise(1234)
    const result = checkResiduals(range(60).map(() => rng()))
    assert.ok(!isFitError(result))
    assert.equal(result.nothingFound, true)
    assert.match(result.why, /weaker than the fit being right/)
    closeTo(result.durbinWatson as number, 2, 0.5)
  })

  it('orders residuals by x when x is given', () => {
    // The same residuals, shuffled with their x values, must give the same answer.
    const x = range(20)
    const residuals = x.map((t) => (t - 10) ** 2 - 33)
    const order = [...x].sort((a, b) => ((a * 7) % 20) - ((b * 7) % 20))
    const shuffledX = order
    const shuffledResiduals = order.map((i) => residuals[i] as number)
    const inOrder = checkResiduals(residuals, { x })
    const shuffled = checkResiduals(shuffledResiduals, { x: shuffledX })
    assert.ok(!isFitError(inOrder))
    assert.ok(!isFitError(shuffled))
    assert.deepEqual(
      inOrder.findings.filter((one) => one.kind === 'curvature').map((one) => one.kind),
      shuffled.findings.filter((one) => one.kind === 'curvature').map((one) => one.kind)
    )
  })

  it('refuses mismatched lengths and empty input', () => {
    assert.ok(isFitError(checkResiduals([1, 2, 3], { x: [1, 2] })))
    assert.ok(isFitError(checkResiduals([])))
  })
})

describe('compareFits', () => {
  const x = range(20, 1)
  const y = x.map((t) => 3 * t ** 1.4)
  const built = (): Fit[] => {
    const out: Fit[] = []
    for (const one of [
      fit(x, y, 'linear'),
      fit(x, y, 'power'),
      fit(x, y, 'polynomial', { degree: 2 }),
      fit(x, y, 'logarithmic')
    ]) {
      assert.ok(!isFitError(one))
      out.push(one)
    }
    return out
  }

  it('names no winner, ever', () => {
    const result = compareFits(built())
    assert.ok(!isFitError(result))
    assert.equal(result.best, null)
    assert.match(result.why, /no winner is named/)
  })

  it('ranks by adjusted R² and puts the true shape at the top for exact data', () => {
    const result = compareFits(built())
    assert.ok(!isFitError(result))
    assert.match(result.ranked[0] as string, /Power law/)
  })

  it('groups fits the data cannot separate', () => {
    const line = fit(x, x.map((t) => 2 * t), 'linear')
    const quadratic = fit(x, x.map((t) => 2 * t), 'polynomial', { degree: 2 })
    assert.ok(!isFitError(line))
    assert.ok(!isFitError(quadratic))
    const result = compareFits([line, quadratic])
    assert.ok(!isFitError(result))
    assert.equal(result.indistinguishable.length, 1)
    assert.equal(result.indistinguishable[0]?.length, 2)
    assert.ok(result.caveats.some((c) => new RegExp(String(INDISTINGUISHABLE_WITHIN)).test(c)))
    assert.ok(result.caveats.some((c) => /a reason from outside the data/.test(c)))
  })

  it('warns when the fits were made on different data', () => {
    const shortX = range(8, 1)
    const one = fit(x, y, 'linear')
    const other = fit(shortX, shortX.map((t) => 2 * t), 'linear')
    assert.ok(!isFitError(one))
    assert.ok(!isFitError(other))
    const result = compareFits([one, other])
    assert.ok(!isFitError(result))
    assert.ok(result.caveats.some((c) => /not comparable/.test(c)))
  })

  it('warns when some fits minimise a different error than others', () => {
    const result = compareFits(built())
    assert.ok(!isFitError(result))
    assert.ok(result.caveats.some((c) => /slightly different questions/.test(c)))
  })

  it('does not raise the transform warning when every fit used one', () => {
    const power = fit(x, y, 'power')
    const exponential = fit(x, y, 'exponential')
    assert.ok(!isFitError(power))
    assert.ok(!isFitError(exponential))
    const result = compareFits([power, exponential])
    assert.ok(!isFitError(result))
    assert.ok(!result.caveats.some((c) => /slightly different questions/.test(c)))
  })

  it('refuses an empty comparison', () => {
    assert.ok(isFitError(compareFits([])))
  })
})
