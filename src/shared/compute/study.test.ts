import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  CONFIRM_ABOVE,
  STUDY_ASSUMPTIONS,
  STUDY_LIMITS,
  applyOverride,
  brokenBy,
  caseId,
  checkValue,
  compareStudies,
  compareToBaseline,
  conflictsBetween,
  estimateSize,
  findTarget,
  fingerprintOf,
  generateCases,
  isStudyError,
  localSensitivity,
  mergeScenarios,
  nameScenario,
  normalQuantile,
  parameter,
  resolveOrder,
  resolveScenario,
  responseSurface,
  robustness,
  runStudy,
  staleAgainst,
  tornado,
  valuesFor,
  withDerived,
  type Constraint,
  type Parameter,
  type ParameterValue,
  type Scenario
} from './study.ts'

const p = (id: string, type: Parameters<typeof parameter>[1], value: ParameterValue, options?: Parameters<typeof parameter>[3]): Parameter => {
  const one = parameter(id, type, value, options)
  if (isStudyError(one)) throw new Error(`${id}: ${one.message}`)
  return one
}

describe('parameters', () => {
  test('an integer parameter refuses a fractional baseline rather than letting the model truncate it', () => {
    const one = parameter('n', 'integer', 2.5)
    assert.ok(isStudyError(one))
    assert.match(one.message, /not a whole number/)
  })

  test('a quantity parameter needs a unit, because without one it is a number', () => {
    const one = parameter('m', 'quantity', 5)
    assert.ok(isStudyError(one))
    assert.match(one.message, /needs a unit/)
    assert.ok(!isStudyError(parameter('m', 'quantity', 5, { unit: 'kg' })))
  })

  test('a categorical parameter needs its categories, and its baseline has to be one of them', () => {
    assert.ok(isStudyError(parameter('mat', 'category', 'steel')))
    const good = parameter('mat', 'category', 'steel', { categories: ['steel', 'aluminium'] })
    assert.ok(!isStudyError(good))
    const bad = parameter('mat', 'category', 'titanium', { categories: ['steel', 'aluminium'] })
    assert.ok(isStudyError(bad))
    assert.match(bad.message, /not one of steel, aluminium/)
  })

  test('a category called constructor is a category, not a lookup on Object.prototype', () => {
    const one = p('key', 'category', 'constructor', { categories: ['constructor', 'toString'] })
    assert.equal(checkValue(one, 'constructor'), null)
    assert.ok(checkValue(one, 'valueOf'))
  })

  test('bounds are enforced, and an exclusive bound excludes its own endpoint', () => {
    const inclusive = p('x', 'number', 5, { bounds: { low: 0, high: 10 } })
    assert.equal(checkValue(inclusive, 0), null)
    assert.equal(checkValue(inclusive, 10), null)
    assert.ok(checkValue(inclusive, -1))

    const exclusive = p('y', 'number', 5, { bounds: { low: 0, exclusiveLow: true } })
    assert.ok(checkValue(exclusive, 0))
    assert.equal(checkValue(exclusive, 0.001), null)
  })

  test('a lower bound above the upper bound is refused, because nothing satisfies it', () => {
    const one = parameter('x', 'number', 5, { bounds: { low: 10, high: 2 } })
    assert.ok(isStudyError(one))
  })

  test('a boolean parameter cannot have a unit or categories', () => {
    assert.ok(isStudyError(parameter('on', 'boolean', true, { unit: 'kg' })))
    assert.ok(isStudyError(parameter('on', 'boolean', true, { categories: ['a'] })))
  })

  test('a bad unit is refused with the unit engine’s own message', () => {
    const one = parameter('x', 'number', 1, { unit: 'not-a-unit-at-all' })
    assert.ok(isStudyError(one))
    assert.equal(one.error, 'invalid-unit')
  })
})

describe('derived parameters', () => {
  const radius = () => p('r', 'number', 2)

  test('a derived parameter is recomputed for the case, not carried over from the baseline', () => {
    const order = resolveOrder([radius()], [{ id: 'area', name: 'Area', from: ['r'], compute: (v) => Math.PI * (v.r as number) ** 2, unit: '', describe: '' }])
    assert.ok(!isStudyError(order))
    const filled = withDerived({ r: 3 }, [{ id: 'area', name: 'Area', from: ['r'], compute: (v) => Math.PI * (v.r as number) ** 2, unit: '', describe: '' }], order)
    assert.ok(!isStudyError(filled))
    assert.ok(Math.abs((filled.area as number) - Math.PI * 9) < 1e-12)
  })

  test('a chain of derived parameters is ordered so each one is computed after what it needs', () => {
    const derived = [
      { id: 'c', name: 'C', from: ['b'], compute: (v: Record<string, ParameterValue>) => (v.b as number) + 5, unit: '', describe: '' },
      { id: 'b', name: 'B', from: ['a'], compute: (v: Record<string, ParameterValue>) => (v.a as number) * 2, unit: '', describe: '' }
    ]
    const order = resolveOrder([p('a', 'number', 3)], derived)
    assert.ok(!isStudyError(order))
    assert.deepEqual(order, ['b', 'c'])
    const filled = withDerived({ a: 3 }, derived, order)
    assert.ok(!isStudyError(filled))
    assert.equal(filled.b, 6)
    assert.equal(filled.c, 11)
  })

  test('a circle of derived parameters is refused, naming the ones involved', () => {
    const derived = [
      { id: 'a', name: 'A', from: ['b'], compute: () => 1, unit: '', describe: '' },
      { id: 'b', name: 'B', from: ['a'], compute: () => 1, unit: '', describe: '' }
    ]
    const order = resolveOrder([radius()], derived)
    assert.ok(isStudyError(order))
    assert.equal(order.error, 'cycle')
    assert.match(order.message, /a, b/)
  })

  test('a derived parameter built from something that does not exist is refused', () => {
    const order = resolveOrder([radius()], [{ id: 'x', name: 'X', from: ['nope'], compute: () => 1, unit: '', describe: '' }])
    assert.ok(isStudyError(order))
    assert.equal(order.error, 'not-found')
  })

  test('a derived parameter that has no finite value for a case is reported rather than stored as NaN', () => {
    const derived = [{ id: 'q', name: 'Q', from: ['r'], compute: (v: Record<string, ParameterValue>) => 1 / ((v.r as number) - 2), unit: '', describe: '' }]
    const order = resolveOrder([radius()], derived)
    assert.ok(!isStudyError(order))
    const filled = withDerived({ r: 2 }, derived, order)
    assert.ok(isStudyError(filled))
    assert.equal(filled.error, 'not-finite')
  })
})

describe('value generators', () => {
  const x = () => p('x', 'number', 0)

  test('a stepped range keeps its endpoint despite floating point', () => {
    // Repeated addition of 0.1 ends at 0.9999999999999999 and drops the endpoint. Index times step does not.
    const values = valuesFor(x(), { kind: 'step', start: 0, stop: 1, step: 0.1 })
    assert.ok(!isStudyError(values))
    assert.equal(values.length, 11)
    assert.equal(values[10], 1)
  })

  test('a step moving away from the end of the range is refused rather than looping forever', () => {
    const values = valuesFor(x(), { kind: 'step', start: 0, stop: 10, step: -1 })
    assert.ok(isStudyError(values))
    assert.match(values.message, /moves away from/)
  })

  test('a step of zero is refused', () => {
    assert.ok(isStudyError(valuesFor(x(), { kind: 'step', start: 0, stop: 1, step: 0 })))
  })

  test('a counted range includes both endpoints exactly', () => {
    const values = valuesFor(x(), { kind: 'count', start: 20, stop: 100, count: 5 })
    assert.ok(!isStudyError(values))
    assert.deepEqual(values, [20, 40, 60, 80, 100])
  })

  test('a counted range of one point is the start, not a divide by zero', () => {
    const values = valuesFor(x(), { kind: 'count', start: 7, stop: 100, count: 1 })
    assert.ok(!isStudyError(values))
    assert.deepEqual(values, [7])
  })

  test('a logarithmic range is evenly spaced in the logarithm', () => {
    const positive = p('x', 'number', 1, { bounds: { low: 0, exclusiveLow: true } })
    const values = valuesFor(positive, { kind: 'log', start: 1e-3, stop: 10, count: 5 })
    assert.ok(!isStudyError(values))
    assert.equal(values.length, 5)
    for (let i = 0; i < 4; i++) {
      const ratio = (values[i + 1] as number) / (values[i] as number)
      assert.ok(Math.abs(ratio - 10) < 1e-9, `ratio ${ratio}`)
    }
  })

  test('a logarithmic range through zero is refused, because there is no logarithm of zero', () => {
    const values = valuesFor(x(), { kind: 'log', start: 0, stop: 10, count: 5 })
    assert.ok(isStudyError(values))
    assert.match(values.message, /above zero/)
  })

  test('a sweep that leaves the parameter’s own domain is refused, naming the value', () => {
    const bounded = p('x', 'number', 5, { name: 'Temperature', bounds: { low: 0 } })
    const values = valuesFor(bounded, { kind: 'count', start: -10, stop: 10, count: 3 })
    assert.ok(isStudyError(values))
    assert.equal(values.error, 'out-of-domain')
    assert.match(values.message, /Temperature/)
  })

  test('sweeping the categories of a categorical parameter gives all of them', () => {
    const material = p('mat', 'category', 'steel', { categories: ['steel', 'aluminium', 'titanium'] })
    const values = valuesFor(material, { kind: 'categories' })
    assert.ok(!isStudyError(values))
    assert.deepEqual(values, ['steel', 'aluminium', 'titanium'])
  })

  test('asking a non-categorical parameter for its categories is refused', () => {
    assert.ok(isStudyError(valuesFor(x(), { kind: 'categories' })))
  })

  test('a sweep past the per-parameter ceiling is refused', () => {
    const values = valuesFor(x(), { kind: 'count', start: 0, stop: 1, count: STUDY_LIMITS.values + 1 })
    assert.ok(isStudyError(values))
    assert.equal(values.error, 'too-many')
  })
})

describe('case generation', () => {
  const mass = () => p('m', 'quantity', 2, { name: 'Mass', unit: 'kg' })
  const velocity = () => p('v', 'quantity', 10, { name: 'Velocity', unit: 'm/s' })

  test('case ids are positional and padded, so two runs line up', () => {
    assert.equal(caseId(0), 'case-000001')
    assert.equal(caseId(6), 'case-000007')
  })

  test('a grid produces every combination, with the last axis varying fastest', () => {
    const generated = generateCases([mass(), velocity()], {
      kind: 'grid',
      sweeps: [
        { parameterId: 'm', spec: { kind: 'list', values: [1, 2] } },
        { parameterId: 'v', spec: { kind: 'list', values: [10, 20, 30] } }
      ]
    })
    assert.ok(!isStudyError(generated))
    assert.equal(generated.cases.length, 6)
    assert.deepEqual(generated.cases.map((one) => [one.values.m, one.values.v]), [
      [1, 10],
      [1, 20],
      [1, 30],
      [2, 10],
      [2, 20],
      [2, 30]
    ])
    assert.equal(generated.cases[0].id, 'case-000001')
  })

  test('one at a time includes the baseline once and never changes two parameters together', () => {
    const generated = generateCases([mass(), velocity()], {
      kind: 'one-at-a-time',
      sweeps: [
        { parameterId: 'm', spec: { kind: 'list', values: [1, 3] } },
        { parameterId: 'v', spec: { kind: 'list', values: [20] } }
      ]
    })
    assert.ok(!isStudyError(generated))
    assert.equal(generated.cases.length, 4)
    assert.deepEqual(generated.cases[0].changed, [])
    for (const one of generated.cases) assert.ok(one.changed.length <= 1, JSON.stringify(one.changed))
  })

  test('a grid too large to run is refused before a single case is generated', () => {
    const many = Array.from({ length: 4 }, (_, i) => p(`x${i}`, 'number', 0))
    const generated = generateCases(many, {
      kind: 'grid',
      sweeps: many.map((one) => ({ parameterId: one.id, spec: { kind: 'count' as const, start: 0, stop: 1, count: 100 } }))
    })
    assert.ok(isStudyError(generated))
    assert.equal(generated.error, 'too-many')
    assert.match(generated.message, /Sweep fewer values/)
  })

  test('the size is estimated without generating anything', () => {
    const size = estimateSize([mass(), velocity()], {
      kind: 'grid',
      sweeps: [
        { parameterId: 'm', spec: { kind: 'count', start: 1, stop: 10, count: 50 } },
        { parameterId: 'v', spec: { kind: 'count', start: 1, stop: 10, count: 40 } }
      ]
    })
    assert.ok(!isStudyError(size))
    assert.equal(size, 2000)
  })

  test('a long study is flagged as worth confirming rather than started silently', () => {
    const generated = generateCases([mass()], {
      kind: 'one-at-a-time',
      sweeps: [{ parameterId: 'm', spec: { kind: 'count', start: 1, stop: 10, count: CONFIRM_ABOVE + 10 } }]
    })
    assert.ok(!isStudyError(generated))
    assert.ok(generated.notes.some((one) => /worth confirming/.test(one)))
  })

  test('a locked parameter is not swept, and the note says so', () => {
    const locked = p('m', 'quantity', 2, { name: 'Mass', unit: 'kg', locked: true })
    const generated = generateCases([locked, velocity()], {
      kind: 'grid',
      sweeps: [
        { parameterId: 'm', spec: { kind: 'list', values: [1, 5] } },
        { parameterId: 'v', spec: { kind: 'list', values: [10, 20] } }
      ]
    })
    assert.ok(!isStudyError(generated))
    assert.equal(generated.cases.length, 2)
    for (const one of generated.cases) assert.equal(one.values.m, 2)
    assert.ok(generated.notes.some((one) => /locked/.test(one)))
  })

  test('a cross-parameter constraint excludes cases before they run, and they are kept with the reason', () => {
    const constraint: Constraint = {
      id: 'ordered',
      describe: 'Mass must be below velocity',
      holds: (values) => (values.m as number) < (values.v as number)
    }
    const generated = generateCases([mass(), velocity()], {
      kind: 'grid',
      sweeps: [
        { parameterId: 'm', spec: { kind: 'list', values: [1, 50] } },
        { parameterId: 'v', spec: { kind: 'list', values: [10, 20] } }
      ]
    }, [constraint])
    assert.ok(!isStudyError(generated))
    assert.equal(generated.cases.length, 2)
    assert.equal(generated.excluded.length, 2)
    assert.deepEqual(generated.excluded[0].broke, ['Mass must be below velocity'])
    assert.ok(generated.notes.some((one) => /broke a constraint and were left out before anything ran/.test(one)))
  })

  test('a constraint that throws excludes the case rather than letting it through', () => {
    const constraint: Constraint = {
      id: 'broken',
      describe: 'This constraint throws',
      holds: () => {
        throw new Error('boom')
      }
    }
    assert.equal(brokenBy({ x: 1 }, [constraint]).length, 1)
  })

  test('random sampling is reproducible from its seed', () => {
    const sampled = p('x', 'number', 0, { distribution: { kind: 'uniform', low: 0, high: 10 } })
    const first = generateCases([sampled], { kind: 'random', parameterIds: ['x'], count: 20, seed: 4 })
    const again = generateCases([sampled], { kind: 'random', parameterIds: ['x'], count: 20, seed: 4 })
    assert.ok(!isStudyError(first) && !isStudyError(again))
    assert.deepEqual(first.cases.map((one) => one.values.x), again.cases.map((one) => one.values.x))
  })

  test('sampling a parameter with no distribution is refused rather than invented', () => {
    const generated = generateCases([p('x', 'number', 0)], { kind: 'random', parameterIds: ['x'], count: 5, seed: 1 })
    assert.ok(isStudyError(generated))
    assert.equal(generated.error, 'no-distribution')
  })

  test('a Latin hypercube covers its range more evenly than independent draws', () => {
    const sampled = p('x', 'number', 0.5, { distribution: { kind: 'uniform', low: 0, high: 1 }, bounds: { low: 0, high: 1 } })
    const count = 40
    const hypercube = generateCases([sampled], { kind: 'latin-hypercube', parameterIds: ['x'], count, seed: 7 })
    assert.ok(!isStudyError(hypercube))
    // One draw per equally likely slice means every slice is hit exactly once.
    const slices = new Set(hypercube.cases.map((one) => Math.floor((one.values.x as number) * count)))
    assert.equal(slices.size, count)
  })

  test('a Latin hypercube shuffles its columns, so two parameters are not tied together', () => {
    const a = p('a', 'number', 0.5, { distribution: { kind: 'uniform', low: 0, high: 1 } })
    const b = p('b', 'number', 0.5, { distribution: { kind: 'uniform', low: 0, high: 1 } })
    const generated = generateCases([a, b], { kind: 'latin-hypercube', parameterIds: ['a', 'b'], count: 40, seed: 9 })
    assert.ok(!isStudyError(generated))
    // Without the shuffle every point would sit on the diagonal and the two columns would be perfectly correlated.
    const xs = generated.cases.map((one) => one.values.a as number)
    const ys = generated.cases.map((one) => one.values.b as number)
    const mx = xs.reduce((s, v) => s + v, 0) / xs.length
    const my = ys.reduce((s, v) => s + v, 0) / ys.length
    let cov = 0
    let vx = 0
    let vy = 0
    for (let i = 0; i < xs.length; i++) {
      cov += (xs[i] - mx) * (ys[i] - my)
      vx += (xs[i] - mx) ** 2
      vy += (ys[i] - my) ** 2
    }
    const r = cov / Math.sqrt(vx * vy)
    assert.ok(Math.abs(r) < 0.5, `correlation ${r}`)
  })

  test('two parameters with the same id are refused', () => {
    const generated = generateCases([p('x', 'number', 1), p('x', 'number', 2)], {
      kind: 'one-at-a-time',
      sweeps: []
    })
    assert.ok(isStudyError(generated))
    assert.equal(generated.error, 'duplicate')
  })

  test('the normal quantile is accurate at the values everyone recognises', () => {
    assert.ok(Math.abs(normalQuantile(0.5)) < 1e-9)
    assert.ok(Math.abs(normalQuantile(0.975) - 1.959964) < 1e-5)
    assert.ok(Math.abs(normalQuantile(0.025) + 1.959964) < 1e-5)
    assert.ok(Math.abs(normalQuantile(0.8413447) - 1) < 1e-5)
  })
})

describe('running a study', () => {
  const cases = () => {
    const generated = generateCases([p('x', 'number', 1)], {
      kind: 'one-at-a-time',
      sweeps: [{ parameterId: 'x', spec: { kind: 'list', values: [-1, 2, 3] } }]
    })
    if (isStudyError(generated)) throw new Error(generated.message)
    return generated.cases
  }

  test('a study runs the real model for every case', () => {
    const run = runStudy(cases(), (values) => ({ y: (values.x as number) * 2 }), 'fp')
    assert.equal(run.completed, 4)
    assert.equal(run.failed, 0)
    assert.equal(run.results[0].outputs.y, 2)
  })

  test('a failed case keeps its parameters rather than disappearing', () => {
    const run = runStudy(cases(), (values) => ({ y: Math.sqrt(values.x as number) }), 'fp')
    const failed = run.results.filter((one) => one.status === 'failed')
    assert.equal(failed.length, 1)
    assert.equal(failed[0].values.x, -1)
    assert.match(failed[0].error, /no finite value for y/)
    assert.ok(run.notes.some((one) => /the part of the range the model does not cover can be seen/.test(one)))
  })

  test('stopping at the first failure gives a partial study, and says so in both numbers', () => {
    const run = runStudy(cases(), (values) => {
      if ((values.x as number) < 0) throw new Error('negative')
      return { y: values.x as number }
    }, 'fp', { policy: 'stop' })
    assert.equal(run.failed, 1)
    assert.ok(run.pending > 0)
    assert.ok(run.notes.some((one) => /partial study/.test(one)))
  })

  test('skip-rest marks the remainder as skipped, which is not the same as never reached', () => {
    const run = runStudy(cases(), (values) => {
      if ((values.x as number) < 0) throw new Error('negative')
      return { y: values.x as number }
    }, 'fp', { policy: 'skip-rest' })
    assert.ok(run.skipped > 0)
    assert.equal(run.pending, 0)
  })

  test('cancelling keeps what finished and marks the rest as never run', () => {
    let done = 0
    const run = runStudy(cases(), (values) => {
      done += 1
      return { y: values.x as number }
    }, 'fp', { cancelled: () => done >= 2 })
    assert.equal(run.completed, 2)
    assert.equal(run.cancelled, 2)
    assert.ok(run.notes.some((one) => /Cancelled/.test(one)))
  })

  test('only the named outputs are kept', () => {
    const run = runStudy(cases(), (values) => ({ wanted: values.x as number, ignored: 99 }), 'fp', { outputs: ['wanted'] })
    assert.deepEqual(Object.keys(run.results[0].outputs), ['wanted'])
  })

  test('an output named constructor is an output, not a lookup on Object.prototype', () => {
    const run = runStudy(cases(), () => ({ constructor: 7 }) as unknown as Record<string, number>, 'fp', { outputs: ['constructor'] })
    assert.equal(run.results[0].outputs.constructor, 7)
    assert.equal(run.completed, 4)
  })

  test('results are reused when the values and the fingerprint match, and the count is reported', () => {
    const first = runStudy(cases(), (values) => ({ y: (values.x as number) * 2 }), 'fp')
    let calls = 0
    const second = runStudy(cases(), (values) => {
      calls += 1
      return { y: (values.x as number) * 2 }
    }, 'fp', { reuse: first.results })
    assert.equal(calls, 0)
    assert.equal(second.completed, 4)
    assert.ok(second.notes.some((one) => /were reused from an earlier run/.test(one)))
  })

  test('a fingerprint does not depend on the order the parameters were listed in', () => {
    const a = p('a', 'number', 1)
    const b = p('b', 'number', 2)
    assert.equal(fingerprintOf('v1', [a, b]), fingerprintOf('v1', [b, a]))
    assert.notEqual(fingerprintOf('v1', [a, b]), fingerprintOf('v2', [a, b]))
    assert.notEqual(fingerprintOf('v1', [a, b]), fingerprintOf('v1', [p('a', 'number', 5), b]))
  })

  test('results are stale once the model or the parameters change', () => {
    const run = runStudy(cases(), (values) => ({ y: values.x as number }), 'abc')
    assert.equal(staleAgainst(run, 'abc').stale, false)
    const stale = staleAgainst(run, 'def')
    assert.equal(stale.stale, true)
    assert.match(stale.why, /Run the study again/)
  })

  test('progress is reported per case with the real totals', () => {
    const seen: number[] = []
    runStudy(cases(), (values) => ({ y: values.x as number }), 'fp', {
      onCase: (_result, doneCount, total) => {
        seen.push(doneCount)
        assert.equal(total, 4)
      }
    })
    assert.deepEqual(seen, [1, 2, 3, 4])
  })
})

describe('local sensitivity', () => {
  const parameters = () => [p('a', 'number', 3, { name: 'A' }), p('b', 'number', 5, { name: 'B' })]

  test('a derivative matches the analytic one', () => {
    // y = a^2 * b, so dy/da = 2ab = 30 and dy/db = a^2 = 9 at a=3, b=5.
    const result = localSensitivity(parameters(), 'y', (v) => ({ y: (v.a as number) ** 2 * (v.b as number) }))
    assert.ok(!isStudyError(result))
    const a = result.find((one) => one.parameterId === 'a')
    const b = result.find((one) => one.parameterId === 'b')
    assert.ok(Math.abs((a?.derivative ?? 0) - 30) < 1e-4)
    assert.ok(Math.abs((b?.derivative ?? 0) - 9) < 1e-4)
  })

  test('elasticity is the proportional response', () => {
    // For y = a^2, elasticity is 2.
    const result = localSensitivity([p('a', 'number', 3)], 'y', (v) => ({ y: (v.a as number) ** 2 }))
    assert.ok(!isStudyError(result))
    assert.ok(Math.abs((result[0].elasticity ?? 0) - 2) < 1e-4)
  })

  test('the step is reported, because the derivative depends on it', () => {
    const result = localSensitivity([p('a', 'number', 100)], 'y', (v) => ({ y: v.a as number }), { relativeStep: 1e-3 })
    assert.ok(!isStudyError(result))
    assert.ok(Math.abs(result[0].step - 0.1) < 1e-12)
    assert.equal(result[0].method, 'finite-difference')
  })

  test('a categorical or boolean parameter has no derivative and is left out rather than nudged', () => {
    const mixed = [p('a', 'number', 1), p('mat', 'category', 'steel', { categories: ['steel', 'aluminium'] }), p('on', 'boolean', true)]
    const result = localSensitivity(mixed, 'y', (v) => ({ y: (v.a as number) * 2 }))
    assert.ok(!isStudyError(result))
    assert.deepEqual(result.map((one) => one.parameterId), ['a'])
  })

  test('a locked parameter is left out', () => {
    const result = localSensitivity([p('a', 'number', 1), p('b', 'number', 1, { locked: true })], 'y', (v) => ({ y: (v.a as number) + (v.b as number) }))
    assert.ok(!isStudyError(result))
    assert.deepEqual(result.map((one) => one.parameterId), ['a'])
  })

  test('a parameter at the edge of its own domain is left out, not measured outside it', () => {
    const edge = p('a', 'number', 0, { bounds: { low: 0 } })
    const result = localSensitivity([edge, p('b', 'number', 1)], 'y', (v) => ({ y: (v.a as number) + (v.b as number) }))
    assert.ok(!isStudyError(result))
    assert.deepEqual(result.map((one) => one.parameterId), ['b'])
  })

  test('a model with no finite output at the baseline is refused', () => {
    const result = localSensitivity([p('a', 'number', 1)], 'y', () => ({ y: Number.NaN }))
    assert.ok(isStudyError(result))
    assert.equal(result.error, 'not-finite')
  })
})

describe('tornado', () => {
  test('bars are ranked by the swing each parameter actually produces', () => {
    const parameters = [p('big', 'number', 1, { name: 'Big' }), p('small', 'number', 1, { name: 'Small' })]
    const result = tornado(
      parameters,
      [
        { parameterId: 'big', low: 0, high: 10 },
        { parameterId: 'small', low: 0.9, high: 1.1 }
      ],
      'y',
      (v) => ({ y: (v.big as number) * 10 + (v.small as number) })
    )
    assert.ok(!isStudyError(result))
    assert.equal(result.entries[0].parameterId, 'big')
    assert.ok(result.entries[0].swing > result.entries[1].swing)
    const shares = result.entries.reduce((sum, one) => sum + one.share, 0)
    assert.ok(Math.abs(shares - 1) < 1e-9)
  })

  test('the interaction caveat is stated rather than left for the reader to know', () => {
    const result = tornado([p('a', 'number', 1)], [{ parameterId: 'a', low: 0, high: 2 }], 'y', (v) => ({ y: v.a as number }))
    assert.ok(!isStudyError(result))
    assert.ok(result.notes.some((one) => /the bars will not add up/.test(one)))
  })

  test('a parameter whose output falls as it rises is marked inverted', () => {
    const result = tornado([p('a', 'number', 1)], [{ parameterId: 'a', low: 0, high: 2 }], 'y', (v) => ({ y: -(v.a as number) }))
    assert.ok(!isStudyError(result))
    assert.equal(result.entries[0].inverted, true)
    assert.ok(result.notes.some((one) => /moves the output down as it rises/.test(one)))
  })

  test('an end of the range the model cannot evaluate shortens the bar and is reported', () => {
    const a = p('a', 'number', 4, { name: 'A' })
    const result = tornado([a], [{ parameterId: 'a', low: -1, high: 9 }], 'y', (v) => ({ y: Math.sqrt(v.a as number) }))
    assert.ok(!isStudyError(result))
    assert.equal(result.entries[0].low, null)
    assert.ok(result.notes.some((one) => /could not be evaluated at one end/.test(one)))
  })
})

describe('scenarios', () => {
  const parameters = () => [
    p('g', 'quantity', 9.81, { name: 'Gravity', unit: 'm/s^2' }),
    p('m', 'quantity', 2, { name: 'Mass', unit: 'kg' })
  ]

  test('an override is applied without touching the baseline', () => {
    const scenarios: Scenario[] = [{ id: 's1', name: 'Twice gravity', parent: null, overrides: { g: 19.62 }, describe: '' }]
    const params = parameters()
    const resolved = resolveScenario(params, scenarios, 's1')
    assert.ok(!isStudyError(resolved))
    assert.equal(resolved.values.g, 19.62)
    assert.equal(resolved.values.m, 2)
    // The baseline is untouched.
    assert.equal(params[0].value, 9.81)
  })

  test('a branch inherits its parent’s overrides and adds its own', () => {
    const scenarios: Scenario[] = [
      { id: 'a', name: 'Low gravity', parent: null, overrides: { g: 1.62 }, describe: '' },
      { id: 'b', name: 'And heavy', parent: 'a', overrides: { m: 10 }, describe: '' }
    ]
    const resolved = resolveScenario(parameters(), scenarios, 'b')
    assert.ok(!isStudyError(resolved))
    assert.equal(resolved.values.g, 1.62)
    assert.equal(resolved.values.m, 10)
    assert.deepEqual(resolved.lineage, ['a', 'b'])
  })

  test('a scenario that sets a value out of the parameter’s domain is refused', () => {
    const positive = [p('t', 'quantity', 300, { name: 'Temperature', unit: 'K', bounds: { low: 0 } })]
    const scenarios: Scenario[] = [{ id: 's', name: 'Impossible', parent: null, overrides: { t: -50 }, describe: '' }]
    const resolved = resolveScenario(positive, scenarios, 's')
    assert.ok(isStudyError(resolved))
    assert.equal(resolved.error, 'out-of-domain')
    assert.match(resolved.message, /Temperature/)
  })

  test('a scenario overriding a locked parameter is refused', () => {
    const locked = [p('g', 'number', 9.81, { name: 'Gravity', locked: true })]
    const scenarios: Scenario[] = [{ id: 's', name: 'Change it', parent: null, overrides: { g: 1 }, describe: '' }]
    const resolved = resolveScenario(locked, scenarios, 's')
    assert.ok(isStudyError(resolved))
    assert.equal(resolved.error, 'locked')
  })

  test('scenarios that refer back to each other are refused rather than looped over', () => {
    const scenarios: Scenario[] = [
      { id: 'a', name: 'A', parent: 'b', overrides: {}, describe: '' },
      { id: 'b', name: 'B', parent: 'a', overrides: {}, describe: '' }
    ]
    const resolved = resolveScenario(parameters(), scenarios, 'a')
    assert.ok(isStudyError(resolved))
    assert.equal(resolved.error, 'cycle')
  })

  test('relative overrides resolve against the current value', () => {
    assert.equal(applyOverride(10, { kind: 'multiply', factor: 2 }), 20)
    assert.equal(applyOverride(10, { kind: 'add', amount: -3 }), 7)
    assert.equal(applyOverride(200, { kind: 'percent', percent: -10 }), 180)
    assert.equal(applyOverride(5, { kind: 'set', value: 9 }), 9)
  })

  test('a relative override of something that is not a number is refused', () => {
    assert.ok(isStudyError(applyOverride('steel', { kind: 'multiply', factor: 2 })))
  })

  test('a scenario name comes from what it changes, not from a counter', () => {
    const params = parameters()
    assert.equal(nameScenario(params, { g: 19.62 }), 'Gravity doubled')
    assert.equal(nameScenario(params, { m: 1 }), 'Mass halved')
    assert.match(nameScenario(params, { g: 5 }), /Gravity down to 5 m\/s\^2/)
    assert.equal(nameScenario(params, {}), 'No change')
  })

  test('a comparison computes the differences rather than describing them', () => {
    const comparison = compareToBaseline(
      parameters(),
      { g: 9.81, m: 2 },
      { g: 9.81, m: 5 },
      { energy: 100 },
      { energy: 250 }
    )
    assert.deepEqual(comparison.changedParameters.map((one) => one.name), ['Mass'])
    const energy = comparison.deltas.find((one) => one.name === 'energy')
    assert.equal(energy?.absolute, 150)
    assert.equal(energy?.relative, 1.5)
    assert.equal(energy?.direction, 'up')
  })

  test('a relative change is null against a baseline of zero rather than infinite', () => {
    const comparison = compareToBaseline(parameters(), { g: 1 }, { g: 2 }, { y: 0 }, { y: 5 })
    assert.equal(comparison.deltas[0].relative, null)
  })

  test('an output that did not move at all is pointed out', () => {
    const comparison = compareToBaseline(parameters(), { g: 9.81, m: 2 }, { g: 1, m: 2 }, { mass: 2 }, { mass: 2 })
    assert.ok(comparison.notes.some((one) => /did not move at all/.test(one)))
  })

  test('an output on only one side is reported rather than compared against nothing', () => {
    const comparison = compareToBaseline(parameters(), { g: 1 }, { g: 2 }, { a: 1 }, { a: 1, b: 2 })
    assert.deepEqual(comparison.onlyOneSide, ['b'])
  })

  test('conflicting scenarios are not merged silently', () => {
    const a: Scenario = { id: 'a', name: 'A', parent: null, overrides: { m: 10 }, describe: '' }
    const b: Scenario = { id: 'b', name: 'B', parent: null, overrides: { m: 20 }, describe: '' }
    assert.equal(conflictsBetween(a, b).length, 1)
    const merged = mergeScenarios(a, b, 'c', 'C')
    assert.ok(isStudyError(merged))
    assert.equal(merged.error, 'conflict')
    assert.match(merged.message, /merging cannot decide that/)
  })

  test('compatible scenarios merge', () => {
    const a: Scenario = { id: 'a', name: 'A', parent: null, overrides: { m: 10 }, describe: '' }
    const b: Scenario = { id: 'b', name: 'B', parent: null, overrides: { g: 1 }, describe: '' }
    const merged = mergeScenarios(a, b, 'c', 'C')
    assert.ok(!isStudyError(merged))
    assert.deepEqual(merged.overrides, { m: 10, g: 1 })
  })
})

describe('target search', () => {
  const parameters = () => [p('t', 'number', 50, { name: 'Temperature' })]

  test('a threshold is found by bisecting the real model', () => {
    // Efficiency falls linearly from 100 at t=0 to 0 at t=200; it passes 80 at t=40.
    const result = findTarget(parameters(), 't', 'efficiency', 80, { low: 0, high: 200 }, (v) => ({
      efficiency: 100 - (v.t as number) / 2
    }))
    assert.ok(!isStudyError(result))
    assert.ok(result.bracketed)
    assert.ok(Math.abs((result.value ?? 0) - 40) < 1e-6)
    assert.match(result.describe, /bisection/)
  })

  test('a target never crossed in the range is reported, not guessed at', () => {
    const result = findTarget(parameters(), 't', 'y', 1000, { low: 0, high: 10 }, (v) => ({ y: v.t as number }))
    assert.ok(!isStudyError(result))
    assert.equal(result.bracketed, false)
    assert.equal(result.value, null)
    assert.match(result.describe, /does not cross it anywhere in between/)
  })

  test('the caveat about more than one crossing is stated', () => {
    const result = findTarget(parameters(), 't', 'y', 5, { low: 0, high: 10 }, (v) => ({ y: v.t as number }))
    assert.ok(!isStudyError(result))
    assert.match(result.describe, /not necessarily the only one/)
  })

  test('a target hit exactly at an endpoint is reported as such', () => {
    const result = findTarget(parameters(), 't', 'y', 0, { low: 0, high: 10 }, (v) => ({ y: v.t as number }))
    assert.ok(!isStudyError(result))
    assert.equal(result.value, 0)
    assert.equal(result.residual, 0)
  })

  test('an integer parameter comes back as a whole number', () => {
    const integers = [p('n', 'integer', 5, { name: 'Count' })]
    const result = findTarget(integers, 'n', 'y', 7.5, { low: 0, high: 20 }, (v) => ({ y: v.n as number }))
    assert.ok(!isStudyError(result))
    assert.ok(Number.isInteger(result.value))
  })

  test('a non-numeric parameter is refused, because there is nothing between two categories', () => {
    const categorical = [p('mat', 'category', 'steel', { categories: ['steel', 'aluminium'] })]
    const result = findTarget(categorical, 'mat', 'y', 1, { low: 0, high: 1 }, () => ({ y: 1 }))
    assert.ok(isStudyError(result))
  })

  test('a range whose low is not below its high is refused', () => {
    assert.ok(isStudyError(findTarget(parameters(), 't', 'y', 1, { low: 5, high: 5 }, (v) => ({ y: v.t as number }))))
  })
})

describe('response surfaces', () => {
  const build = (model: (x: number, y: number) => number) => {
    const generated = generateCases([p('x', 'number', 0), p('y', 'number', 0)], {
      kind: 'grid',
      sweeps: [
        { parameterId: 'x', spec: { kind: 'list', values: [1, 2, 3] } },
        { parameterId: 'y', spec: { kind: 'list', values: [10, 20] } }
      ]
    })
    if (isStudyError(generated)) throw new Error(generated.message)
    return runStudy(generated.cases, (v) => ({ z: model(v.x as number, v.y as number) }), 'fp')
  }

  test('a grid of results becomes a grid indexed by the sorted axis values', () => {
    const surface = responseSurface(build((x, y) => x * y).results, 'x', 'y', 'z')
    assert.ok(!isStudyError(surface))
    assert.deepEqual(surface.xValues, [1, 2, 3])
    assert.deepEqual(surface.yValues, [10, 20])
    assert.equal(surface.grid[0][0], 10)
    assert.equal(surface.grid[1][2], 60)
    assert.equal(surface.computed, 6)
    assert.equal(surface.missing, 0)
  })

  test('a failed case is left empty rather than interpolated over', () => {
    const surface = responseSurface(build((x, y) => (x === 2 ? Number.NaN : x * y)).results, 'x', 'y', 'z')
    assert.ok(!isStudyError(surface))
    assert.equal(surface.grid[0][1], null)
    assert.equal(surface.missing, 2)
    assert.ok(surface.notes.some((one) => /left empty rather than filled in/.test(one)))
  })

  test('every placed point is marked as computed, so nothing drawn can be mistaken for a model value', () => {
    const surface = responseSurface(build((x, y) => x + y).results, 'x', 'y', 'z')
    assert.ok(!isStudyError(surface))
    assert.ok(surface.points.every((one) => one.computed))
  })

  test('a non-numeric axis is refused', () => {
    const generated = generateCases([p('mat', 'category', 'steel', { categories: ['steel', 'aluminium'] }), p('y', 'number', 1)], {
      kind: 'grid',
      sweeps: [{ parameterId: 'mat', spec: { kind: 'categories' } }]
    })
    assert.ok(!isStudyError(generated))
    const run = runStudy(generated.cases, () => ({ z: 1 }), 'fp')
    assert.ok(isStudyError(responseSurface(run.results, 'mat', 'y', 'z')))
  })
})

describe('robustness and comparison', () => {
  const run = () => {
    const generated = generateCases([p('x', 'number', 5)], {
      kind: 'one-at-a-time',
      sweeps: [{ parameterId: 'x', spec: { kind: 'count', start: 0, stop: 10, count: 11 } }]
    })
    if (isStudyError(generated)) throw new Error(generated.message)
    return runStudy(generated.cases, (v) => ({ y: (v.x as number) * 2 }), 'fp')
  }

  test('the range and the extremes come from the cases that completed', () => {
    const result = robustness(run(), 'y')
    assert.ok(!isStudyError(result))
    assert.equal(result.minimum, 0)
    assert.equal(result.maximum, 20)
    assert.equal(result.range, 20)
    assert.ok(result.notes.some((one) => /that completed/.test(one)))
  })

  test('the worst case depends on which direction is better, and says which case it was', () => {
    const higher = robustness(run(), 'y', { higherIsBetter: true })
    const lower = robustness(run(), 'y', { higherIsBetter: false })
    assert.ok(!isStudyError(higher) && !isStudyError(lower))
    assert.equal(higher.worstCase?.value, 0)
    assert.equal(lower.worstCase?.value, 20)
    assert.ok(higher.worstCase?.caseId.startsWith('case-'))
  })

  test('the share inside a band is only reported when a band was given, because there is no universal robust', () => {
    const none = robustness(run(), 'y')
    assert.ok(!isStudyError(none))
    assert.equal(none.withinBand, null)
    const banded = robustness(run(), 'y', { baseline: 10, band: 5 })
    assert.ok(!isStudyError(banded))
    assert.equal(banded.withinBand?.band, 5)
    // Twelve cases: the baseline (y = 10) plus the sweep's 0..20 in steps of 2. Six of them are within 5 of 10.
    assert.equal(banded.cases, 12)
    assert.ok(Math.abs((banded.withinBand?.fraction ?? 0) - 0.5) < 1e-9)
  })

  test('an output no case produced is refused rather than summarised from nothing', () => {
    assert.ok(isStudyError(robustness(run(), 'missing')))
  })

  test('two studies compared show configuration and result differences separately', () => {
    const a = { parameters: [p('x', 'number', 1)], run: runStudy([{ id: 'case-000001', index: 0, values: { x: 1 }, changed: [], status: 'pending' as const, reason: '' }], () => ({ y: 2 }), 'f1') }
    const b = { parameters: [p('x', 'number', 2)], run: runStudy([{ id: 'case-000001', index: 0, values: { x: 2 }, changed: [], status: 'pending' as const, reason: '' }], () => ({ y: 4 }), 'f2') }
    const difference = compareStudies(a, b)
    assert.equal(difference.changedParameters.length, 1)
    assert.equal(difference.changedResults.length, 1)
    assert.equal(difference.changedResults[0].from, 2)
    assert.equal(difference.changedResults[0].to, 4)
    assert.equal(difference.sameFingerprint, false)
  })

  test('results that differ under the same fingerprint are flagged as non-determinism', () => {
    const one = { id: 'case-000001', index: 0, values: { x: 1 }, changed: [], status: 'pending' as const, reason: '' }
    const a = { parameters: [p('x', 'number', 1)], run: runStudy([one], () => ({ y: 2 }), 'same') }
    const b = { parameters: [p('x', 'number', 1)], run: runStudy([one], () => ({ y: 3 }), 'same') }
    const difference = compareStudies(a, b)
    assert.ok(difference.notes.some((note) => /not deterministic/.test(note)))
  })

  test('a changed configuration with identical results is pointed out too', () => {
    const one = { id: 'case-000001', index: 0, values: { x: 1 }, changed: [], status: 'pending' as const, reason: '' }
    const a = { parameters: [p('x', 'number', 1)], run: runStudy([one], () => ({ y: 2 }), 'f1') }
    const b = { parameters: [p('x', 'number', 2)], run: runStudy([one], () => ({ y: 2 }), 'f2') }
    assert.ok(compareStudies(a, b).notes.some((note) => /does not reach these outputs/.test(note)))
  })
})

describe('the assumptions are stated', () => {
  test('the list names what the engine will and will not do', () => {
    assert.ok(STUDY_ASSUMPTIONS.length >= 8)
    assert.ok(STUDY_ASSUMPTIONS.some((one) => /real model/.test(one)))
    assert.ok(STUDY_ASSUMPTIONS.some((one) => /how many cases ran and how many did not/.test(one)))
    assert.ok(STUDY_ASSUMPTIONS.some((one) => /never by reading a value off a chart/.test(one)))
  })
})
