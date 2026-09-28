import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  CALCULUS_ASSUMPTIONS,
  CALCULUS_LIMITS,
  analyseShape,
  classifyOde,
  compile,
  continuityAt,
  derivativeAt,
  equilibriaOf,
  findAsymptotes,
  heatEquation,
  integrateFunction,
  isCalculusError,
  limitAt,
  phasePortrait,
  solveIvp,
  taylorSeries,
  waveEquation,
  type RealFunction
} from './calculus.ts'

describe('compiling an expression', () => {
  test('an expression becomes a function of the named variable', () => {
    const f = compile('x^2 + 1') as RealFunction
    assert.ok(!isCalculusError(f))
    assert.equal(f(3), 10)
  })

  test('the variable can be named something else', () => {
    const f = compile('2 * t', 't') as RealFunction
    assert.ok(!isCalculusError(f))
    assert.equal(f(4), 8)
  })

  test('a point where the expression has no value gives NaN rather than throwing', () => {
    const f = compile('1 / (x - 1)') as RealFunction
    assert.ok(!isCalculusError(f))
    assert.equal(Number.isFinite(f(1)), false)
  })

  test('text that is not an expression is refused rather than compiled', () => {
    assert.ok(isCalculusError(compile('process.exit()')))
  })
})

describe('limits', () => {
  test('the classic indeterminate form comes out right', () => {
    // sin(x)/x tends to 1 at zero, although the function has no value there.
    const result = limitAt((x) => Math.sin(x) / x, 0)
    assert.equal(result.exists, true)
    assert.ok(Math.abs((result.value as number) - 1) < 1e-6)
    assert.equal(result.verdict, 'numerical')
    assert.match(result.describe, /sampled evidence rather than a proof/)
  })

  test('a sampled limit is never called proven', () => {
    const result = limitAt((x) => x * x, 2)
    assert.notEqual(result.verdict, 'proven')
    assert.notEqual(result.verdict, 'symbolic')
  })

  test('two different one-sided limits mean no limit, and both are reported', () => {
    // The sign function: -1 from the left, 1 from the right.
    const result = limitAt((x) => Math.sign(x), 0)
    assert.equal(result.exists, false)
    assert.equal(result.behaviour, 'one-sided-differ')
    assert.ok(Math.abs((result.left as number) + 1) < 1e-9)
    assert.ok(Math.abs((result.right as number) - 1) < 1e-9)
  })

  test('growing without bound is reported as behaviour, not as a value', () => {
    const result = limitAt((x) => 1 / (x * x), 0)
    assert.equal(result.behaviour, 'infinite')
    assert.equal(result.exists, false)
    assert.match(result.describe, /a statement about the behaviour, not a value/)
  })

  test('opposite infinities on the two sides mean no limit at all', () => {
    const result = limitAt((x) => 1 / x, 0)
    assert.equal(result.behaviour, 'infinite')
    assert.match(result.describe, /opposite directions/)
  })

  test('oscillation that never settles is recognised as such', () => {
    // sin(1/x) near zero oscillates infinitely often and approaches nothing.
    const result = limitAt((x) => Math.sin(1 / x), 0)
    assert.equal(result.behaviour, 'oscillating')
    assert.equal(result.exists, false)
    assert.match(result.describe, /keep moving over a range that does not shrink/)
  })

  test('a one-sided limit can be asked for on its own', () => {
    const result = limitAt((x) => Math.sqrt(x), 0, { from: 'right' })
    assert.equal(result.exists, true)
    assert.ok(Math.abs(result.value as number) < 1e-6)
    assert.equal(result.left, null)
  })

  test('the samples are returned, so the conclusion can be argued with', () => {
    const result = limitAt((x) => x + 1, 1)
    assert.ok(result.samples.length > 10)
    assert.ok(result.samples.every((one) => Number.isFinite(one.at)))
  })
})

describe('continuity', () => {
  test('a continuous function is continuous', () => {
    const result = continuityAt((x) => x * x, 2)
    assert.equal(result.continuous, true)
    assert.equal(result.kind, 'none')
  })

  test('a removable discontinuity is named as removable, with the value that would fix it', () => {
    const result = continuityAt((x) => (x === 1 ? 99 : x + 1), 1)
    assert.equal(result.continuous, false)
    assert.equal(result.kind, 'removable')
    assert.ok(Math.abs((result.limit as number) - 2) < 1e-6)
    assert.match(result.describe, /Redefining the single point/)
  })

  test('a jump is named as a jump, with its size', () => {
    const result = continuityAt((x) => (x < 0 ? 0 : 1), 0)
    assert.equal(result.kind, 'jump')
    assert.match(result.describe, /jump of 1/)
  })

  test('an infinite discontinuity is named as an asymptote', () => {
    const result = continuityAt((x) => 1 / (x * x), 0)
    assert.equal(result.kind, 'infinite')
    assert.match(result.describe, /vertical asymptote/)
  })

  test('a function with no value at the point but a limit around it is removable', () => {
    const result = continuityAt((x) => Math.sin(x) / x, 0)
    assert.equal(result.kind, 'removable')
    assert.equal(result.value, null)
    assert.ok(Math.abs((result.limit as number) - 1) < 1e-6)
  })
})

describe('derivatives', () => {
  test('a symbolic derivative is exact and says so', () => {
    const result = derivativeAt('x^3', 2)
    assert.ok(!isCalculusError(result))
    assert.equal(result.verdict, 'symbolic')
    assert.equal(result.step, null)
    // 3x^2 at 2 is 12.
    assert.ok(Math.abs((result.value as number) - 12) < 1e-12)
    assert.match(result.describe, /exact, not an approximation/)
  })

  test('a known derivative comes out right', () => {
    const result = derivativeAt('sin(x)', 0)
    assert.ok(!isCalculusError(result))
    assert.ok(Math.abs((result.value as number) - 1) < 1e-12)
  })

  test('a bad expression is refused with the parser’s message', () => {
    assert.ok(isCalculusError(derivativeAt('x +', 1)))
  })

  test('the product rule is applied symbolically', () => {
    const result = derivativeAt('x*sin(x)', 0)
    assert.ok(!isCalculusError(result))
    // sin(0) + 0*cos(0) = 0.
    assert.ok(Math.abs(result.value as number) < 1e-12)
    assert.equal(result.verdict, 'symbolic')
  })
})

describe('shape', () => {
  test('a parabola has one minimum, found where it should be', () => {
    const result = analyseShape((x) => (x - 2) ** 2, -5, 5, 500)
    assert.ok(!isCalculusError(result))
    const minimum = result.critical.find((one) => one.kind === 'minimum')
    assert.ok(minimum)
    assert.ok(Math.abs(minimum.x - 2) < 1e-4)
    assert.ok(minimum.secondDerivative > 0)
  })

  test('increasing and decreasing intervals are found', () => {
    const result = analyseShape((x) => x * x, -2, 2, 400)
    assert.ok(!isCalculusError(result))
    assert.ok(result.decreasing.some((one) => one.from < -1 && one.to < 0.1))
    assert.ok(result.increasing.some((one) => one.to > 1))
  })

  test('concavity is found from the second derivative', () => {
    const result = analyseShape((x) => x ** 3, -2, 2, 400)
    assert.ok(!isCalculusError(result))
    assert.ok(result.concaveDown.length > 0)
    assert.ok(result.concaveUp.length > 0)
    assert.ok(result.inflections.some((one) => Math.abs(one) < 0.05))
  })

  test('roots are found by bisection and really are roots', () => {
    const g = (x: number): number => x ** 3 - x
    const result = analyseShape(g, -2, 2, 400)
    assert.ok(!isCalculusError(result))
    assert.equal(result.roots.length, 3)
    for (const root of result.roots) assert.ok(Math.abs(g(root)) < 1e-8, `${root}`)
  })

  test('the sampling caveat is stated rather than left implicit', () => {
    const result = analyseShape((x) => x, 0, 1, 100)
    assert.ok(!isCalculusError(result))
    assert.ok(result.notes.some((one) => /can fall between samples and be missed/.test(one)))
  })

  test('points where the function has no value are reported as gaps', () => {
    const result = analyseShape((x) => Math.sqrt(x - 1), 0, 2, 200)
    assert.ok(!isCalculusError(result))
    assert.ok(result.gaps.length > 0)
    assert.ok(result.notes.some((one) => /has no value at/.test(one)))
  })

  test('an interval whose start is not below its end is refused', () => {
    assert.ok(isCalculusError(analyseShape((x) => x, 5, 1)))
  })

  test('too many samples is refused', () => {
    assert.ok(isCalculusError(analyseShape((x) => x, 0, 1, CALCULUS_LIMITS.samples + 1)))
  })
})

describe('asymptotes', () => {
  test('a vertical asymptote is found at a candidate point', () => {
    const result = findAsymptotes((x) => 1 / (x - 2), [2])
    assert.equal(result.vertical.length, 1)
    assert.equal(result.vertical[0].at, 2)
    assert.equal(result.vertical[0].side, 'both')
  })

  test('a horizontal asymptote is found from the behaviour far out', () => {
    const result = findAsymptotes((x) => 3 + 1 / x)
    assert.ok(result.horizontal.some((one) => Math.abs(one.at - 3) < 1e-3))
  })

  test('an oblique asymptote is found', () => {
    // (x^2 + 1)/x = x + 1/x approaches the line y = x.
    const result = findAsymptotes((x) => (x * x + 1) / x)
    assert.ok(result.oblique.some((one) => Math.abs(one.slope - 1) < 1e-4))
  })

  test('a point that is not an asymptote is not reported as one', () => {
    const result = findAsymptotes((x) => x * x, [2])
    assert.equal(result.vertical.length, 0)
  })

  test('the limits of the method are stated', () => {
    const result = findAsymptotes((x) => x)
    assert.ok(result.notes.some((one) => /far but not infinite/.test(one)))
    assert.ok(result.notes.some((one) => /which the caller knows and this does not/.test(one)))
  })
})

describe('Taylor series', () => {
  test('the expansion of the exponential has the right coefficients', () => {
    const result = taylorSeries(Math.exp, 0, 5)
    assert.ok(!isCalculusError(result))
    // 1, 1, 1/2, 1/6, 1/24, 1/120.
    const expected = [1, 1, 0.5, 1 / 6, 1 / 24, 1 / 120]
    result.coefficients.forEach((one, i) => {
      assert.ok(Math.abs(one - expected[i]) < 0.02, `coefficient ${i}: ${one} against ${expected[i]}`)
    })
  })

  test('the polynomial approximates the function near the centre', () => {
    const result = taylorSeries(Math.sin, 0, 7, { from: -0.5, to: 0.5 })
    assert.ok(!isCalculusError(result))
    assert.ok((result.observedError as number) < 1e-4, `${result.observedError}`)
  })

  test('the error is called an observation over sampled points, not a bound', () => {
    const result = taylorSeries(Math.cos, 0, 4, { from: -1, to: 1 })
    assert.ok(!isCalculusError(result))
    assert.ok(result.notes.some((one) => /not a bound/.test(one)))
  })

  test('the numerical-differentiation caveat is stated', () => {
    const result = taylorSeries(Math.exp, 0, 3)
    assert.ok(!isCalculusError(result))
    assert.ok(result.notes.some((one) => /not from repeated finite differences/.test(one)))
  })

  test('a high order warns that the interpolation is becoming ill-conditioned', () => {
    const result = taylorSeries(Math.exp, 0, 15)
    assert.ok(!isCalculusError(result))
    assert.ok(result.notes.some((one) => /ill-conditioned/.test(one)))
  })

  test('an order past the cap is refused', () => {
    assert.ok(isCalculusError(taylorSeries(Math.exp, 0, CALCULUS_LIMITS.order + 1)))
  })

  test('a point where the function has no value is refused', () => {
    assert.ok(isCalculusError(taylorSeries((x) => Math.sqrt(x - 10), 0, 3)))
  })
})

describe('integration', () => {
  test('a polynomial integrates exactly to the known value', () => {
    // The integral of x^2 from 0 to 1 is a third.
    const result = integrateFunction((x) => x * x, 0, 1)
    assert.ok(!isCalculusError(result))
    assert.ok(Math.abs(result.value - 1 / 3) < 1e-10)
  })

  test('a known transcendental integral comes out right', () => {
    // The integral of sin from 0 to pi is 2.
    const result = integrateFunction(Math.sin, 0, Math.PI)
    assert.ok(!isCalculusError(result))
    assert.ok(Math.abs(result.value - 2) < 1e-9)
  })

  test('equal limits give zero without any evaluations', () => {
    const result = integrateFunction((x) => x, 3, 3)
    assert.ok(!isCalculusError(result))
    assert.equal(result.value, 0)
    assert.equal(result.evaluations, 0)
  })

  test('reversing the limits reverses the sign', () => {
    const forward = integrateFunction((x) => x, 0, 1)
    const backward = integrateFunction((x) => x, 1, 0)
    assert.ok(!isCalculusError(forward) && !isCalculusError(backward))
    assert.ok(Math.abs(forward.value + backward.value) < 1e-12)
  })

  test('adaptive Simpson puts its effort where the function is not smooth', () => {
    // A sharp peak: adaptive subdivides near it and barely at all elsewhere.
    const sharp = (x: number): number => Math.exp(-1000 * (x - 0.5) ** 2)
    const adaptive = integrateFunction(sharp, 0, 1, { method: 'adaptive-simpson', tolerance: 1e-10 })
    assert.ok(!isCalculusError(adaptive))
    // The exact value is sqrt(pi/1000) to within the tails.
    assert.ok(Math.abs(adaptive.value - Math.sqrt(Math.PI / 1000)) < 1e-8)
    assert.ok(adaptive.notes.some((one) => /rather than being spread evenly/.test(one)))
  })

  test('the error estimate comes from comparing refinements, not from the tolerance', () => {
    const result = integrateFunction((x) => x ** 4, 0, 1, { method: 'simpson', intervals: 100 })
    assert.ok(!isCalculusError(result))
    assert.ok(result.estimatedError !== null)
    assert.ok(result.notes.some((one) => /comparing this against half as many/.test(one)))
  })

  test('Gauss-Legendre is exact for a low-degree polynomial and admits it has no error estimate', () => {
    const result = integrateFunction((x) => x ** 3 + 2 * x, 0, 2, { method: 'gauss-legendre', intervals: 1 })
    assert.ok(!isCalculusError(result))
    // x^4/4 + x^2 from 0 to 2 = 4 + 4 = 8.
    assert.ok(Math.abs(result.value - 8) < 1e-12)
    assert.equal(result.estimatedError, null)
    assert.ok(result.notes.some((one) => /no way to estimate its own error/.test(one)))
  })

  test('the trapezoid rule is less accurate than Simpson on the same function, as it should be', () => {
    const trapezoid = integrateFunction(Math.sin, 0, Math.PI, { method: 'trapezoid', intervals: 20 })
    const simpson = integrateFunction(Math.sin, 0, Math.PI, { method: 'simpson', intervals: 20 })
    assert.ok(!isCalculusError(trapezoid) && !isCalculusError(simpson))
    assert.ok(Math.abs(simpson.value - 2) < Math.abs(trapezoid.value - 2))
  })

  test('an infinite limit is refused, naming what it would need', () => {
    const result = integrateFunction((x) => 1 / (x * x), 1, Number.POSITIVE_INFINITY)
    assert.ok(isCalculusError(result))
    assert.match(result.message, /substitution/)
  })

  test('a function with no value at an endpoint is refused rather than integrated around', () => {
    assert.ok(isCalculusError(integrateFunction((x) => Math.sqrt(x - 5), 0, 1)))
  })
})

describe('ordinary differential equations', () => {
  test('a separable equation is recognised, with the evidence', () => {
    // y' = x*y factors into a function of x times a function of y.
    const result = classifyOde((x, y) => x * y)
    assert.equal(result.form, 'separable')
    assert.ok(result.evidence.some((one) => /factors into a function of x times a function of y/.test(one)))
    assert.match(result.describe, /evidence rather than a proof/)
  })

  test('an autonomous equation is recognised', () => {
    const result = classifyOde((_x, y) => y * (1 - y))
    assert.equal(result.autonomous, true)
    assert.ok(result.evidence.some((one) => /does not change with x/.test(one)))
  })

  test('linearity in y is tested separately from separability', () => {
    // y' = x + y is linear but does not separate.
    const result = classifyOde((x, y) => x + y)
    assert.equal(result.linear, true)
    assert.equal(result.form, 'linear-first-order')
  })

  test('a form that is not recognised says so rather than guessing', () => {
    const result = classifyOde((x, y) => Math.sin(x * y) + x * x)
    assert.equal(result.form, 'unrecognised')
    assert.equal(result.method, null)
    assert.match(result.describe, /It can still be solved numerically/)
  })

  test('an initial-value problem is solved and checked against its own equation', () => {
    // y' = y, y(0) = 1, so y(1) = e.
    const result = solveIvp((_t, [y]) => [y], { time: 0, values: [1] }, 1, { tolerance: 1e-10 })
    assert.ok(!isCalculusError(result))
    assert.ok(Math.abs(result.run.final.values[0] - Math.E) < 1e-6, `${result.run.final.values[0]}`)
    assert.equal(result.initialConditionMet, true)
    assert.ok(result.residual < 1e-3, `${result.residual}`)
  })

  test('substituting back is stated as a different check from the step error', () => {
    const result = solveIvp((_t, [y]) => [y], { time: 0, values: [1] }, 1)
    assert.ok(!isCalculusError(result))
    assert.ok(result.notes.some((one) => /different check from the integrator/.test(one)))
  })

  test('a harmonic oscillator conserves its energy to within the tolerance', () => {
    // y'' = -y as a system: energy is y^2 + v^2, conserved exactly.
    const result = solveIvp((_t, [y, v]) => [v, -y], { time: 0, values: [1, 0] }, 10, { tolerance: 1e-11 })
    assert.ok(!isCalculusError(result))
    const [y, v] = result.run.final.values
    assert.ok(Math.abs(y * y + v * v - 1) < 1e-6, `energy drifted to ${y * y + v * v}`)
  })

  test('the equilibria of a logistic equation are found and classified', () => {
    // y' = y(1-y): zero is unstable, one is stable.
    const result = equilibriaOf((y) => y * (1 - y), -1, 2, 400)
    assert.ok(!isCalculusError(result))
    const zero = result.find((one) => Math.abs(one.at[0]) < 1e-6)
    const one = result.find((one2) => Math.abs(one2.at[0] - 1) < 1e-6)
    assert.equal(zero?.stability, 'unstable')
    assert.equal(one?.stability, 'stable')
  })

  test('a semi-stable equilibrium is reported as such rather than forced into one of the other two', () => {
    // y' = y^2: attracts from below, repels above.
    const result = equilibriaOf((y) => y * y, -1, 1, 400)
    assert.ok(!isCalculusError(result))
    const zero = result.find((one) => Math.abs(one.at[0]) < 1e-3)
    assert.equal(zero?.stability, 'semi-stable')
    assert.match(zero?.describe ?? '', /Neither "stable" nor "unstable" describes it/)
  })
})

describe('phase portraits', () => {
  test('a saddle is classified from its eigenvalues', () => {
    // x' = x, y' = -y: eigenvalues 1 and -1.
    const result = phasePortrait((x, y) => [x, -y], { xFrom: -2, xTo: 2, yFrom: -2, yTo: 2 }, { grid: 10 })
    assert.ok(!isCalculusError(result))
    const origin = result.equilibria.find((one) => Math.abs(one.x) < 1e-6 && Math.abs(one.y) < 1e-6)
    assert.ok(origin)
    assert.match(origin.classification, /saddle/)
  })

  test('a stable node is classified from its eigenvalues', () => {
    const result = phasePortrait((x, y) => [-x, -2 * y], { xFrom: -2, xTo: 2, yFrom: -2, yTo: 2 }, { grid: 10 })
    assert.ok(!isCalculusError(result))
    const origin = result.equilibria.find((one) => Math.abs(one.x) < 1e-6 && Math.abs(one.y) < 1e-6)
    assert.match(origin?.classification ?? '', /stable node/)
  })

  test('a spiral is recognised from a complex pair', () => {
    const result = phasePortrait((x, y) => [-x - y, x - y], { xFrom: -2, xTo: 2, yFrom: -2, yTo: 2 }, { grid: 10 })
    assert.ok(!isCalculusError(result))
    const origin = result.equilibria.find((one) => Math.abs(one.x) < 1e-6 && Math.abs(one.y) < 1e-6)
    assert.match(origin?.classification ?? '', /stable spiral/)
  })

  test('a centre comes with the caveat that a linear analysis cannot distinguish it from a slow spiral', () => {
    const result = phasePortrait((x, y) => [-y, x], { xFrom: -2, xTo: 2, yFrom: -2, yTo: 2 }, { grid: 10 })
    assert.ok(!isCalculusError(result))
    const origin = result.equilibria.find((one) => Math.abs(one.x) < 1e-6 && Math.abs(one.y) < 1e-6)
    assert.match(origin?.classification ?? '', /cannot tell a true centre from a very slow spiral/)
  })

  test('the classification is stated as coming from the Jacobian, not from the drawing', () => {
    const result = phasePortrait((x, y) => [x, -y], { xFrom: -1, xTo: 1, yFrom: -1, yTo: 1 }, { grid: 6 })
    assert.ok(!isCalculusError(result))
    assert.ok(result.notes.some((one) => /not from the shape of the drawn trajectories/.test(one)))
  })

  test('trajectories are integrated from the points asked for', () => {
    const result = phasePortrait((x, y) => [-x, -y], { xFrom: -2, xTo: 2, yFrom: -2, yTo: 2 }, {
      grid: 6,
      trajectoriesFrom: [{ x: 1, y: 1 }],
      steps: 200
    })
    assert.ok(!isCalculusError(result))
    assert.equal(result.trajectories.length, 1)
    const points = result.trajectories[0].points
    // Everything decays towards the origin.
    assert.ok(Math.hypot(points[points.length - 1].x, points[points.length - 1].y) < Math.hypot(1, 1))
  })

  test('bounds the wrong way round are refused', () => {
    assert.ok(isCalculusError(phasePortrait((x, y) => [x, y], { xFrom: 2, xTo: -2, yFrom: 0, yTo: 1 })))
  })
})

describe('partial differential equations', () => {
  test('the heat equation diffuses a spike and conserves the total roughly', () => {
    const initial = new Array<number>(41).fill(0)
    initial[20] = 1
    const result = heatEquation(initial, { diffusivity: 1, dx: 0.1, dt: 0.001, steps: 500, frames: 5 })
    assert.ok(!isCalculusError(result))
    const last = result.frames[result.frames.length - 1].values
    // The peak falls and the neighbours rise: that is what diffusion is.
    assert.ok(last[20] < 1)
    assert.ok(last[19] > 0 && last[21] > 0)
  })

  test('an unstable time step is refused, with the largest one that would work', () => {
    const result = heatEquation(new Array<number>(20).fill(0), { diffusivity: 1, dx: 0.1, dt: 0.1, steps: 10 })
    assert.ok(isCalculusError(result))
    assert.equal(result.error, 'unstable')
    assert.match(result.message, /growing oscillation rather than a solution/)
    assert.match(result.message, /Reduce the time step to at most/)
  })

  test('the boundary values are held and said to be held', () => {
    const initial = [5, 1, 1, 1, 9]
    const result = heatEquation(initial, { diffusivity: 1, dx: 1, dt: 0.1, steps: 20 })
    assert.ok(!isCalculusError(result))
    const last = result.frames[result.frames.length - 1].values
    assert.equal(last[0], 5)
    assert.equal(last[4], 9)
    assert.ok(result.notes.some((one) => /a different problem, not a setting/.test(one)))
  })

  test('the wave equation propagates and the first step has its own formula', () => {
    const initial = new Array<number>(41).fill(0)
    for (let i = 15; i <= 25; i++) initial[i] = Math.sin(((i - 15) / 10) * Math.PI)
    const result = waveEquation(initial, { speed: 1, dx: 0.1, dt: 0.05, steps: 100, frames: 5 })
    assert.ok(!isCalculusError(result))
    assert.ok(result.frames.length >= 3)
    assert.ok(result.notes.some((one) => /no step before the first one/.test(one)))
  })

  test('a Courant number above one is refused, with the physical reason', () => {
    const result = waveEquation(new Array<number>(20).fill(0), { speed: 10, dx: 0.1, dt: 0.1, steps: 10 })
    assert.ok(isCalculusError(result))
    assert.match(result.message, /more slowly than the wave actually travels/)
  })

  test('a grid that is too small is refused', () => {
    assert.ok(isCalculusError(heatEquation([1, 2], { diffusivity: 1, dx: 1, dt: 0.1, steps: 1 })))
    assert.ok(isCalculusError(waveEquation([1, 2], { speed: 1, dx: 1, dt: 0.1, steps: 1 })))
  })

  test('a non-positive diffusivity or speed is refused', () => {
    assert.ok(isCalculusError(heatEquation([1, 2, 3], { diffusivity: 0, dx: 1, dt: 0.1, steps: 1 })))
    assert.ok(isCalculusError(waveEquation([1, 2, 3], { speed: -1, dx: 1, dt: 0.1, steps: 1 })))
  })
})

describe('the assumptions are stated', () => {
  test('the list names the distinctions the engine is built on', () => {
    assert.ok(CALCULUS_ASSUMPTIONS.length >= 8)
    assert.ok(CALCULUS_ASSUMPTIONS.some((one) => /evidence, not a proof/.test(one)))
    assert.ok(CALCULUS_ASSUMPTIONS.some((one) => /never from restating the tolerance/.test(one)))
    assert.ok(CALCULUS_ASSUMPTIONS.some((one) => /looks like a solution and is not one/.test(one)))
  })
})
