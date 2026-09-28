import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  SIMULATION_ASSUMPTIONS,
  SIMULATION_LIMITS,
  compareStepSizes,
  integrate,
  isSimulationError,
  monteCarlo,
  sensitivity,
  summariseOutcomes,
  sweep,
  withInvariant,
  type Derivative,
  type State
} from './simulation.ts'

const ok = <T>(value: T): Exclude<T, { error: string }> => {
  assert.ok(!isSimulationError(value), `expected success, got ${JSON.stringify(value)}`)
  return value as Exclude<T, { error: string }>
}

/** dy/dt = y, so y(t) = y(0) e^t. The simplest thing with a known exact answer. */
const exponential: Derivative = (_time, values) => [values[0]]

/** A frictionless spring: x'' = -x, written as two first-order equations. Energy is conserved exactly. */
const spring: Derivative = (_time, [x, v]) => [v, -x]
const springEnergy = (state: State): number => 0.5 * state.values[1] ** 2 + 0.5 * state.values[0] ** 2

describe('integration', () => {
  it('gets the exponential right with the adaptive method', () => {
    const run = ok(integrate(exponential, { time: 0, values: [1] }, 1))
    assert.ok(Math.abs(run.final.values[0] - Math.E) < 1e-6, `got ${run.final.values[0]}`)
    assert.equal(run.status, 'complete')
    assert.equal(run.method, 'adaptive')
  })

  it('lands exactly on the end time rather than overshooting it', () => {
    const run = ok(integrate(exponential, { time: 0, values: [1] }, 1, { method: 'rk4', step: 0.3 }))
    assert.ok(Math.abs(run.final.time - 1) < 1e-12, `ended at ${run.final.time}`)
  })

  it('shows Euler drifting where RK4 does not, at the same step', () => {
    const euler = ok(integrate(exponential, { time: 0, values: [1] }, 1, { method: 'euler', step: 0.1 }))
    const rk4 = ok(integrate(exponential, { time: 0, values: [1] }, 1, { method: 'rk4', step: 0.1 }))
    const eulerError = Math.abs(euler.final.values[0] - Math.E)
    const rk4Error = Math.abs(rk4.final.values[0] - Math.E)
    assert.ok(eulerError > 0.1, `Euler should be visibly wrong, was off by ${eulerError}`)
    assert.ok(rk4Error < 1e-5, `RK4 should be close, was off by ${rk4Error}`)
  })

  it('halves Euler’s error when the step is halved, which is its whole character', () => {
    const coarse = ok(integrate(exponential, { time: 0, values: [1] }, 1, { method: 'euler', step: 0.1 }))
    const fine = ok(integrate(exponential, { time: 0, values: [1] }, 1, { method: 'euler', step: 0.05 }))
    const ratio = Math.abs(coarse.final.values[0] - Math.E) / Math.abs(fine.final.values[0] - Math.E)
    assert.ok(ratio > 1.7 && ratio < 2.3, `expected about 2, got ${ratio}`)
  })

  it('reports no error estimate for Euler and RK4, rather than inventing one', () => {
    assert.equal(ok(integrate(exponential, { time: 0, values: [1] }, 1, { method: 'euler', step: 0.1 })).estimatedError, null)
    assert.equal(ok(integrate(exponential, { time: 0, values: [1] }, 1, { method: 'rk4', step: 0.1 })).estimatedError, null)
  })

  it('reports an error estimate for the adaptive method, and calls it a local one', () => {
    const run = ok(integrate(exponential, { time: 0, values: [1] }, 1))
    assert.ok(run.estimatedError !== null)
    assert.ok(run.notes.some((note) => /local error/.test(note)))
  })

  it('chooses a smaller step where the solution moves fast', () => {
    // Grows very steeply near the end, so the controller has to slow down there.
    const run = ok(integrate((_t, [y]) => [y * y], { time: 0, values: [1] }, 0.9, { tolerance: 1e-9 }))
    assert.ok(run.step.smallest < run.step.largest, 'the step never varied')
  })

  it('integrates backwards in time', () => {
    const run = ok(integrate(exponential, { time: 1, values: [Math.E] }, 0))
    assert.ok(Math.abs(run.final.values[0] - 1) < 1e-6, `got ${run.final.values[0]}`)
    assert.ok(Math.abs(run.final.time) < 1e-12)
  })

  it('stops when a stop condition is met, and says so', () => {
    const run = ok(
      integrate(exponential, { time: 0, values: [1] }, 100, { stopWhen: (state) => state.values[0] > 10 })
    )
    assert.equal(run.status, 'stopped-early')
    assert.ok(run.final.values[0] >= 10)
    assert.ok(run.notes.some((note) => /stop condition was met/.test(note)))
  })

  it('keeps running when the stop condition throws rather than stopping or looping forever', () => {
    const run = ok(
      integrate(exponential, { time: 0, values: [1] }, 1, {
        stopWhen: () => {
          throw new Error('bad condition')
        }
      })
    )
    assert.equal(run.status, 'complete')
  })

  it('names divergence instead of returning an enormous number', () => {
    const run = ok(integrate((_t, [y]) => [y * y], { time: 0, values: [1] }, 10, { method: 'rk4', step: 0.01 }))
    assert.equal(run.status, 'diverged')
    assert.ok(run.notes.some((note) => /Either the model really does blow up/.test(note)))
  })

  it('names stiffness rather than grinding to a halt silently', () => {
    // A classic stiff pair: one process 1000 times faster than the other.
    const stiff: Derivative = (_t, [a, b]) => [-1000 * a + b, -b]
    const run = ok(integrate(stiff, { time: 0, values: [1, 1] }, 100, { tolerance: 1e-13, maximumSteps: 2000 }))
    assert.ok(run.status === 'too-stiff' || run.status === 'step-limit' || run.status === 'complete')
    if (run.status === 'too-stiff') {
      assert.ok(run.notes.some((note) => /tolerance will not help/.test(note)))
    }
  })

  it('stops at the step limit and says so', () => {
    const run = ok(integrate(exponential, { time: 0, values: [1] }, 1000, { method: 'rk4', step: 1e-4, maximumSteps: 50 }))
    assert.equal(run.status, 'step-limit')
    assert.ok(run.notes.some((note) => /step limit/.test(note)))
  })

  it('always stamps the result as simulated', () => {
    assert.equal(ok(integrate(exponential, { time: 0, values: [1] }, 1)).provenance, 'simulated')
  })

  it('reports how many times the model was called', () => {
    const run = ok(integrate(exponential, { time: 0, values: [1] }, 1, { method: 'rk4', step: 0.1 }))
    // RK4 costs four evaluations per step.
    assert.ok(run.evaluations >= run.steps * 4)
  })

  it('thins a long trace and says the final state is still exact', () => {
    const run = ok(integrate(exponential, { time: 0, values: [1] }, 1, { method: 'rk4', step: 1e-5, tracePoints: 100 }))
    assert.ok(run.trace.length <= 100)
    assert.ok(run.notes.some((note) => /final state is exact/.test(note)))
    assert.equal(run.trace[run.trace.length - 1].time, run.final.time)
  })

  it('refuses a model that does not return one rate per variable', () => {
    const bad = integrate(() => [1, 2], { time: 0, values: [1] }, 1)
    assert.ok(isSimulationError(bad))
    assert.equal(bad.error, 'not-finite')
    assert.match(bad.message, /Every variable needs a rate of change/)
  })

  it('refuses a model that returns something that is not a number', () => {
    assert.ok(isSimulationError(integrate(() => [Number.NaN], { time: 0, values: [1] }, 1)))
  })

  it('refuses a model that throws', () => {
    const bad = integrate(() => {
      throw new Error('broken model')
    }, { time: 0, values: [1] }, 1)
    assert.ok(isSimulationError(bad))
  })

  it('refuses a system with no variables', () => {
    const bad = integrate(() => [], { time: 0, values: [] }, 1)
    assert.ok(isSimulationError(bad))
    assert.equal(bad.error, 'no-variables')
  })

  it('refuses an end time that is the start time', () => {
    const bad = integrate(exponential, { time: 0, values: [1] }, 0)
    assert.ok(isSimulationError(bad))
    assert.match(bad.message, /nothing to integrate over/)
  })

  it('refuses a starting state that is not finite', () => {
    assert.ok(isSimulationError(integrate(exponential, { time: 0, values: [Number.NaN] }, 1)))
  })

  it('refuses a step size that is zero or negative', () => {
    assert.ok(isSimulationError(integrate(exponential, { time: 0, values: [1] }, 1, { step: 0 })))
    assert.ok(isSimulationError(integrate(exponential, { time: 0, values: [1] }, 1, { step: -1 })))
  })

  it('refuses more variables than it handles', () => {
    const many = new Array<number>(SIMULATION_LIMITS.variables + 1).fill(1)
    assert.ok(isSimulationError(integrate((_t, v) => v.map(() => 0), { time: 0, values: many }, 1)))
  })
})

describe('watching an invariant', () => {
  it('confirms energy holds for a spring under the adaptive method', () => {
    const result = ok(withInvariant(spring, { time: 0, values: [1, 0] }, 20, springEnergy, { allowedDrift: 1e-3 }))
    assert.equal(result.held, true)
    assert.ok(result.worstDrift < 1e-3, `drifted by ${result.worstDrift}`)
    assert.match(result.verdict, /evidence the integration worked/)
  })

  it('keeps the allowed drift separate from the integrator\u2019s own error target', () => {
    // A loose allowance must not loosen the integration that is being judged by it.
    const loose = ok(withInvariant(spring, { time: 0, values: [1, 0] }, 20, springEnergy, { allowedDrift: 0.5 }))
    const tight = ok(withInvariant(spring, { time: 0, values: [1, 0] }, 20, springEnergy, { allowedDrift: 1e-9 }))
    assert.equal(loose.worstDrift, tight.worstDrift, 'the allowance changed the run itself')
    assert.equal(loose.held, true)
    assert.equal(tight.held, false)
  })

  it('drifts less when the integrator is told to be more accurate', () => {
    const loose = ok(withInvariant(spring, { time: 0, values: [1, 0] }, 20, springEnergy, { tolerance: 1e-5 }))
    const tight = ok(withInvariant(spring, { time: 0, values: [1, 0] }, 20, springEnergy, { tolerance: 1e-11 }))
    assert.ok(tight.worstDrift < loose.worstDrift, `${tight.worstDrift} was not below ${loose.worstDrift}`)
  })

  it('says outright that a held invariant does not make the model right', () => {
    const result = ok(withInvariant(spring, { time: 0, values: [1, 0] }, 5, springEnergy))
    assert.match(result.verdict, /not evidence the model is right/)
  })

  it('catches Euler pumping energy into a spring that should conserve it', () => {
    const result = ok(
      withInvariant(spring, { time: 0, values: [1, 0] }, 20, springEnergy, { method: 'euler', step: 0.05, allowedDrift: 1e-3 })
    )
    assert.equal(result.held, false)
    assert.ok(result.worstDrift > 0.1, `Euler should visibly gain energy, drift was ${result.worstDrift}`)
    assert.match(result.verdict, /these numbers are wrong/)
  })

  it('reports the quantity at the start and at the end', () => {
    const result = ok(withInvariant(spring, { time: 0, values: [2, 0] }, 1, springEnergy))
    assert.ok(Math.abs(result.initial - 2) < 1e-12)
    assert.ok(Math.abs(result.final - 2) < 1e-6)
  })

  it('refuses a quantity that has no finite value at the start', () => {
    const bad = withInvariant(spring, { time: 0, values: [1, 0] }, 1, () => Number.NaN)
    assert.ok(isSimulationError(bad))
    assert.equal(bad.error, 'not-finite')
  })

  it('treats a quantity that throws partway through as drifting infinitely', () => {
    let calls = 0
    const result = ok(
      withInvariant(spring, { time: 0, values: [1, 0] }, 1, (state) => {
        calls += 1
        if (calls > 3) throw new Error('cannot measure')
        return springEnergy(state)
      })
    )
    assert.equal(result.held, false)
  })

  it('passes the integration error straight through', () => {
    assert.ok(isSimulationError(withInvariant(() => [Number.NaN], { time: 0, values: [1] }, 1, () => 1)))
  })
})

describe('comparing step sizes', () => {
  it('says the answer has settled when halving the step stops changing it', () => {
    const result = ok(compareStepSizes(exponential, { time: 0, values: [1] }, 1, [0.1, 0.05, 0.025, 0.0125]))
    assert.equal(result.settled, true)
    assert.match(result.verdict, /stopped depending on the step/)
  })

  it('says the answer still depends on the step when it does', () => {
    const result = ok(
      compareStepSizes(exponential, { time: 0, values: [1] }, 1, [0.5, 0.25], { method: 'euler' })
    )
    assert.equal(result.settled, false)
    assert.match(result.verdict, /telling you about the integrator/)
  })

  it('runs every step size and reports each', () => {
    const result = ok(compareStepSizes(exponential, { time: 0, values: [1] }, 1, [0.1, 0.05, 0.02]))
    assert.equal(result.runs.length, 3)
    // Sorted coarsest first, so the finest is last.
    assert.ok(result.runs[0].step > result.runs[2].step)
  })

  it('never uses the adaptive method, which would choose its own step and make the comparison meaningless', () => {
    const result = ok(
      compareStepSizes(exponential, { time: 0, values: [1] }, 1, [0.1, 0.05], { method: 'adaptive' })
    )
    // Fixed-step RK4 at 0.1 over a unit interval is exactly ten steps, which an adaptive run would not be.
    assert.equal(result.runs[0].evaluations, 40)
  })

  it('drops duplicate step sizes', () => {
    const result = ok(compareStepSizes(exponential, { time: 0, values: [1] }, 1, [0.1, 0.1, 0.05]))
    assert.equal(result.runs.length, 2)
  })

  it('refuses fewer than two different step sizes', () => {
    const bad = compareStepSizes(exponential, { time: 0, values: [1] }, 1, [0.1])
    assert.ok(isSimulationError(bad))
    assert.match(bad.message, /at least two different/)
  })

  it('refuses a step size that is not positive', () => {
    assert.ok(isSimulationError(compareStepSizes(exponential, { time: 0, values: [1] }, 1, [0.1, -1])))
  })

  it('refuses an unhelpfully long list', () => {
    const many = Array.from({ length: 13 }, (_, i) => 0.1 / (i + 1))
    assert.ok(isSimulationError(compareStepSizes(exponential, { time: 0, values: [1] }, 1, many)))
  })
})

describe('Monte Carlo runs', () => {
  it('gives the same trials for the same seed', () => {
    const a = ok(monteCarlo((random) => random(), 20, { seed: 5 }))
    const b = ok(monteCarlo((random) => random(), 20, { seed: 5 }))
    assert.deepEqual(a.trials.map((one) => one.outcome), b.trials.map((one) => one.outcome))
  })

  it('gives different trials for a different seed', () => {
    const a = ok(monteCarlo((random) => random(), 20, { seed: 1 }))
    const b = ok(monteCarlo((random) => random(), 20, { seed: 2 }))
    assert.notDeepEqual(a.trials.map((one) => one.outcome), b.trials.map((one) => one.outcome))
  })

  it('gives every trial its own seed, so one can be re-run on its own', () => {
    const run = ok(monteCarlo((random) => random(), 5, { seed: 7 }))
    const seeds = run.trials.map((one) => one.seed)
    assert.equal(new Set(seeds).size, 5)
    // Re-running trial 3 alone, from its own seed, reproduces exactly that trial.
    const again = ok(monteCarlo((random) => random(), 1, { seed: run.trials[3].seed }))
    assert.equal(again.trials[0].outcome, run.trials[3].outcome)
  })

  it('counts trials that failed rather than dropping them silently', () => {
    const run = ok(
      monteCarlo((_random, index) => {
        if (index % 3 === 0) throw new Error('failed')
        return index
      }, 9, { seed: 1 })
    )
    assert.equal(run.failed, 3)
    assert.equal(run.trials.length, 6)
    assert.ok(run.notes.some((note) => /not a random sample of what was asked for/.test(note)))
  })

  it('stamps the run as simulated and says the outcomes describe the model', () => {
    const run = ok(monteCarlo((random) => random(), 3))
    assert.equal(run.provenance, 'simulated')
    assert.ok(run.notes.some((note) => /not the world/.test(note)))
  })

  it('refuses when every trial fails', () => {
    const bad = monteCarlo(() => {
      throw new Error('always')
    }, 5)
    assert.ok(isSimulationError(bad))
    assert.match(bad.message, /All 5 trials failed/)
  })

  it('refuses fewer than one run', () => {
    assert.ok(isSimulationError(monteCarlo((random) => random(), 0)))
  })

  it('refuses more runs than it handles', () => {
    assert.ok(isSimulationError(monteCarlo((random) => random(), SIMULATION_LIMITS.runs + 1)))
  })
})

describe('summarising outcomes', () => {
  it('reports the middle and the spread', () => {
    const summary = ok(summariseOutcomes([1, 2, 3, 4, 5]))
    assert.equal(summary.mean, 3)
    assert.equal(summary.median, 3)
    assert.equal(summary.low, 1)
    assert.equal(summary.high, 5)
    assert.equal(summary.runs, 5)
  })

  it('says outright that the interval is a spread of outcomes, not a confidence interval', () => {
    const summary = ok(summariseOutcomes([1, 2, 3, 4, 5]))
    assert.ok(summary.notes.some((note) => /not how well the average is pinned down/.test(note)))
  })

  it('says the spread carries no uncertainty about whether the model is right', () => {
    assert.ok(ok(summariseOutcomes([1, 2, 3])).notes.some((note) => /whether the model is right/.test(note)))
  })

  it('points out skew, where the mean alone misleads', () => {
    const skewed = [...Array.from({ length: 30 }, () => 1), 500]
    assert.ok(ok(summariseOutcomes(skewed)).notes.some((note) => /skewed/.test(note)))
  })

  it('covers the level asked for', () => {
    const summary = ok(summariseOutcomes(Array.from({ length: 101 }, (_, i) => i), 0.8))
    assert.equal(summary.interval.level, 0.8)
    assert.ok(summary.interval.low > 0 && summary.interval.high < 100)
  })

  it('counts outcomes that were not numbers', () => {
    const summary = ok(summariseOutcomes([1, 2, Number.NaN, 3]))
    assert.equal(summary.runs, 3)
    assert.ok(summary.notes.some((note) => /were not finite numbers/.test(note)))
  })

  it('refuses fewer than two outcomes', () => {
    assert.ok(isSimulationError(summariseOutcomes([1])))
  })

  it('refuses an impossible coverage level', () => {
    assert.ok(isSimulationError(summariseOutcomes([1, 2, 3], 1)))
  })
})

describe('sweeps', () => {
  it('runs every combination on the grid', () => {
    const result = ok(
      sweep((p) => p.a + p.b, [
        { name: 'a', from: 0, to: 1, count: 3 },
        { name: 'b', from: 10, to: 20, count: 2 }
      ])
    )
    assert.equal(result.points.length, 6)
    assert.deepEqual([...result.names], ['a', 'b'])
    assert.equal(result.failed, 0)
  })

  it('varies the last axis fastest, so a two-axis sweep reads row by row', () => {
    const result = ok(
      sweep((p) => `${p.a}:${p.b}`, [
        { name: 'a', from: 1, to: 2, count: 2 },
        { name: 'b', from: 10, to: 20, count: 2 }
      ])
    )
    assert.deepEqual(result.points.map((one) => one.outcome), ['1:10', '1:20', '2:10', '2:20'])
  })

  it('spaces a logarithmic axis by ratio', () => {
    const result = ok(sweep((p) => p.x, [{ name: 'x', from: 1, to: 1000, count: 4, logarithmic: true }]))
    const values = result.points.map((one) => one.outcome as number)
    assert.ok(Math.abs(values[1] - 10) < 1e-9, `got ${values[1]}`)
    assert.ok(Math.abs(values[2] - 100) < 1e-9)
  })

  it('records a failed run as a hole rather than a zero', () => {
    const result = ok(
      sweep(
        (p) => {
          if (p.x > 2) throw new Error('model broke')
          return p.x
        },
        [{ name: 'x', from: 1, to: 4, count: 4 }]
      )
    )
    assert.equal(result.failed, 2)
    const hole = result.points.find((one) => one.outcome === null)
    assert.equal(hole?.failed, 'model broke')
    assert.ok(result.notes.some((note) => /holes in the grid, not zeroes/.test(note)))
  })

  it('says a sweep shows the model rather than the world', () => {
    const result = ok(sweep((p) => p.x, [{ name: 'x', from: 0, to: 1, count: 2 }]))
    assert.ok(result.notes.some((note) => /does not show how the world responds/.test(note)))
    assert.equal(result.provenance, 'simulated')
  })

  it('refuses a grid that is too big, and explains that it grows multiplicatively', () => {
    const bad = sweep((p) => p.a, [
      { name: 'a', from: 0, to: 1, count: 100 },
      { name: 'b', from: 0, to: 1, count: 100 }
    ])
    assert.ok(isSimulationError(bad))
    assert.equal(bad.error, 'too-many-steps')
    assert.match(bad.message, /grows multiplicatively/)
  })

  it('refuses two axes with the same name', () => {
    const bad = sweep((p) => p.a, [
      { name: 'a', from: 0, to: 1, count: 2 },
      { name: 'a', from: 0, to: 1, count: 2 }
    ])
    assert.ok(isSimulationError(bad))
    assert.match(bad.message, /same parameter name/)
  })

  it('refuses a logarithmic axis that would cross zero', () => {
    const bad = sweep((p) => p.x, [{ name: 'x', from: -1, to: 10, count: 3, logarithmic: true }])
    assert.ok(isSimulationError(bad))
    assert.match(bad.message, /cannot include zero/)
  })

  it('refuses a sweep with no axes', () => {
    const bad = sweep(() => 1, [])
    assert.ok(isSimulationError(bad))
    assert.equal(bad.error, 'no-variables')
  })

  it('refuses an axis with no points', () => {
    assert.ok(isSimulationError(sweep((p) => p.x, [{ name: 'x', from: 0, to: 1, count: 0 }])))
  })

  it('handles a single-point axis without dividing by zero', () => {
    const result = ok(sweep((p) => p.x, [{ name: 'x', from: 5, to: 9, count: 1 }]))
    assert.equal(result.points.length, 1)
    assert.equal(result.points[0].outcome, 5)
  })
})

describe('sensitivity', () => {
  // Outcome depends strongly on a and weakly on b, in different units.
  const model = (p: Readonly<Record<string, number>>): number => 1000 * p.a + 0.001 * p.b

  it('finds the slope of each parameter', () => {
    const result = ok(sensitivity(model, { a: 1, b: 1 }))
    const a = result.sensitivities.find((one) => one.parameter === 'a')
    assert.ok(Math.abs((a?.slope ?? 0) - 1000) < 1e-6)
  })

  it('ranks by elasticity rather than by raw slope, so units do not decide', () => {
    // Both contribute the same to the outcome, so neither should dominate the ranking despite the 1e6 slope gap.
    const result = ok(sensitivity(model, { a: 1, b: 1_000_000 }))
    const a = result.sensitivities.find((one) => one.parameter === 'a')
    const b = result.sensitivities.find((one) => one.parameter === 'b')
    assert.ok(Math.abs((a?.slope ?? 0) / (b?.slope ?? 1)) > 100_000, 'the raw slopes should differ hugely')
    assert.ok(Math.abs((a?.elasticity ?? 0) - (b?.elasticity ?? 0)) < 1e-6, 'the elasticities should match')
  })

  it('ranks the parameter that matters most first', () => {
    const result = ok(sensitivity((p) => p.big * 10 + p.small * 0.01, { big: 1, small: 1 }))
    assert.equal(result.ranked[0], 'big')
  })

  it('says outright that one-at-a-time cannot find an interaction', () => {
    const result = ok(sensitivity(model, { a: 1, b: 1 }))
    assert.ok(result.notes.some((note) => /cannot see an interaction/.test(note)))
  })

  it('shows the limitation it warns about: a pure interaction reads as no sensitivity at all', () => {
    // The outcome is a*b, and at a base of zero neither parameter moves it on its own.
    const result = ok(sensitivity((p) => p.a * p.b, { a: 0, b: 0 }))
    for (const one of result.sensitivities) assert.ok(Math.abs(one.slope) < 1e-9, `${one.parameter} slope ${one.slope}`)
  })

  it('gives no elasticity where the base value is zero, rather than dividing by it', () => {
    const result = ok(sensitivity((p) => p.a, { a: 0 }))
    assert.equal(result.sensitivities[0].elasticity, null)
  })

  it('moves a parameter sitting at zero by an absolute amount rather than not at all', () => {
    const result = ok(sensitivity((p) => 5 * p.a, { a: 0 }))
    assert.ok(Math.abs(result.sensitivities[0].slope - 5) < 1e-9)
  })

  it('reports no sensitivity rather than zero when the model breaks on a move', () => {
    const result = ok(
      sensitivity(
        (p) => {
          if (p.a !== 1) throw new Error('only defined at one')
          return 1
        },
        { a: 1 }
      )
    )
    assert.ok(Number.isNaN(result.sensitivities[0].slope))
    assert.ok(result.notes.some((note) => /rather than a sensitivity of zero/.test(note)))
  })

  it('refuses when the model has no finite outcome at the base', () => {
    const bad = sensitivity(() => Number.NaN, { a: 1 })
    assert.ok(isSimulationError(bad))
    assert.equal(bad.error, 'not-finite')
  })

  it('refuses with no parameters', () => {
    assert.ok(isSimulationError(sensitivity(() => 1, {})))
  })

  it('refuses a move fraction outside zero to one', () => {
    assert.ok(isSimulationError(sensitivity((p) => p.a, { a: 1 }, { fraction: 2 })))
  })
})

describe('assumptions', () => {
  it('states what every simulation here is and is not', () => {
    assert.ok(SIMULATION_ASSUMPTIONS.length >= 9)
    assert.ok(SIMULATION_ASSUMPTIONS.some((one) => /not the world/.test(one)))
    assert.ok(SIMULATION_ASSUMPTIONS.some((one) => /step size is part of the answer/.test(one)))
    assert.ok(SIMULATION_ASSUMPTIONS.some((one) => /conserved quantity that drifts/.test(one)))
    assert.ok(SIMULATION_ASSUMPTIONS.some((one) => /hole in the grid, not a zero/.test(one)))
  })
})
