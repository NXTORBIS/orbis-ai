import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { BadInput, ENGINE_CAPABILITY, ENGINE_LIMITS, runEngineOperation } from './engines.ts'

/** Runs an operation and returns its value, failing the test if it threw. */
const run = (operation: string, input: Record<string, unknown> = {}): Record<string, unknown> =>
  runEngineOperation(operation, input) as Record<string, unknown>

/** Runs an operation expecting a refusal, and returns the message. */
const refused = (operation: string, input: Record<string, unknown> = {}): string => {
  try {
    runEngineOperation(operation, input)
  } catch (err) {
    assert.ok(err instanceof BadInput, `expected a BadInput, got ${String(err)}`)
    return err.message
  }
  return assert.fail(`${operation} was not refused`)
}

describe('the operation map', () => {
  it('gives every operation a capability, so nothing can run unmapped', () => {
    for (const [operation, capability] of Object.entries(ENGINE_CAPABILITY)) {
      assert.match(operation, /^[a-z]+\.[a-z-]+$/, `"${operation}" is not shaped like an operation name`)
      assert.match(capability, /^computation\./, `"${operation}" needs a computation capability`)
    }
  })

  it('has an implementation for every operation it maps', () => {
    for (const operation of Object.keys(ENGINE_CAPABILITY)) {
      // A mapped operation with no case would fall through to the "bug in Orbis" refusal, which names itself as one.
      try {
        runEngineOperation(operation, {})
      } catch (err) {
        assert.ok(err instanceof BadInput)
        assert.ok(
          !/bug in Orbis/.test(err.message),
          `"${operation}" has a capability but no implementation`
        )
      }
    }
  })

  it('refuses an operation nobody implemented, and says it is a bug in Orbis rather than in the Page', () => {
    assert.match(refused('nothing.here'), /bug in Orbis rather than in your Page/)
  })
})

describe('a Page cannot send code', () => {
  it('refuses anything that is not an expression', () => {
    for (const attempt of [
      'process.exit()',
      'require("fs")',
      'globalThis.x = 1',
      '(() => 1)()',
      'import("fs")',
      'this.constructor'
    ]) {
      const message = refused('plot.function', { expression: attempt, from: 0, to: 1 })
      assert.ok(message.length > 0, `"${attempt}" produced an empty refusal`)
    }
  })

  it('treats a property access as arithmetic on unknown names, never as a lookup', () => {
    // `a.b` is not valid in the expression grammar, so it cannot reach any object.
    assert.ok(refused('plot.function', { expression: 'constructor.constructor', from: 0, to: 1 }).length > 0)
  })

  it('does not let an expression reach a global', () => {
    // `Math` is not a variable in scope; an unknown symbol has no value, so the curve is empty rather than evaluated.
    const result = run('plot.function', { expression: 'Math', from: 0, to: 1 })
    assert.equal(result.ok, true)
    const series = result.series as { segments: unknown[] }
    assert.equal(series.segments.length, 0, 'an unknown symbol should produce no points')
  })

  it('evaluates a real expression correctly', () => {
    const result = run('plot.function', { expression: 'x^2', from: 0, to: 2, initial: 16 })
    assert.equal(result.ok, true)
    const series = result.series as { segments: { points: { x: number; y: number }[] }[] }
    const points = series.segments.flatMap((one) => one.points)
    for (const point of points) assert.ok(Math.abs(point.y - point.x ** 2) < 1e-9)
  })

  it('lets a Page pass parameters without letting them shadow anything dangerous', () => {
    const result = run('plot.function', { expression: 'a*x', from: 0, to: 2, parameters: { a: 3 }, initial: 8 })
    const series = result.series as { segments: { points: { x: number; y: number }[] }[] }
    const points = series.segments.flatMap((one) => one.points)
    assert.ok(points.every((one) => Math.abs(one.y - 3 * one.x) < 1e-9))
  })

  it('refuses a parameter name that is not a name', () => {
    assert.match(refused('plot.function', { expression: 'x', from: 0, to: 1, parameters: { 'a b': 1 } }), /not a usable name/)
    assert.match(refused('plot.function', { expression: 'x', from: 0, to: 1, parameters: { '1abc': 1 } }), /not a usable name/)
  })

  it('is unharmed by a parameter literally called __proto__', () => {
    // Written through JSON.parse, because an object literal with a `__proto__:` key sets the prototype instead of
    // creating the property, so the literal form would not test anything. This form really does carry the own key.
    const parameters = JSON.parse('{"__proto__": 99}') as Record<string, number>
    const result = run('plot.function', { expression: 'x', from: 0, to: 1, initial: 8, parameters })
    assert.equal(result.ok, true)
    const series = result.series as { segments: { points: { x: number; y: number }[] }[] }
    const points = series.segments.flatMap((one) => one.points)
    assert.ok(points.length > 0)
    // `x` still means x. Nothing about the scope object was corrupted by the key.
    for (const point of points) assert.equal(point.y, point.x)
  })
})

describe('the work budget', () => {
  it('refuses a grid too large to run, before running any of it', () => {
    // The sweep's own grid limit catches this first, which is the cheaper place to catch it: nothing is evaluated at all.
    const result = run('simulate.sweep', { expression: 'x', axes: [{ name: 'x', from: 0, to: 1, count: 100_000 }] })
    assert.equal(result.ok, false)
    assert.equal(result.error, 'too-many-steps')
    assert.match(String(result.message), /grows multiplicatively/)
  })

  it('stops an expression that runs past the evaluation ceiling', () => {
    // A fine-stepped RK4 integration is the hungriest single request this file can be asked for: four evaluations per
    // step, and enough steps to pass the ceiling. If this ever stops tripping, the ceiling has stopped binding.
    const message = refused('simulate.integrate', {
      variables: ['y'],
      rates: ['y'],
      start: [1],
      to: 1,
      method: 'rk4',
      step: 1e-6
    })
    assert.match(message, /calculations one request is allowed/)
  })

  it('lets a request that stays under the ceiling through', () => {
    const result = run('simulate.integrate', { variables: ['y'], rates: ['y'], start: [1], to: 1, method: 'rk4', step: 1e-3 })
    assert.equal(result.ok, true)
  })

  it('reports how much of the budget a plot used', () => {
    const result = run('plot.function', { expression: 'sin(x)', from: 0, to: 6, initial: 32 })
    assert.equal(typeof result.evaluations, 'number')
    assert.ok((result.evaluations as number) > 0)
  })

  it('has a ceiling well under anything that would freeze the process', () => {
    assert.ok(ENGINE_LIMITS.evaluations <= 5_000_000)
  })
})

describe('reading a payload', () => {
  it('refuses a number where text belongs, rather than coercing it', () => {
    assert.match(refused('plot.function', { expression: 42, from: 0, to: 1 }), /has to be text/)
  })

  it('refuses text where a number belongs', () => {
    assert.match(refused('plot.function', { expression: 'x', from: 'zero', to: 1 }), /has to be a finite number/)
  })

  it('refuses a number that is not finite', () => {
    assert.match(refused('statistics.summarise', { values: [1, 2, Number.POSITIVE_INFINITY] }), /not a finite number/)
  })

  it('refuses a list that is too long', () => {
    const many = new Array(ENGINE_LIMITS.values + 1).fill(1)
    assert.match(refused('statistics.summarise', { values: many }), /more than the/)
  })

  it('refuses something that is not a list where one belongs', () => {
    assert.match(refused('statistics.summarise', { values: 'one two three' }), /has to be a list/)
  })

  it('refuses a choice it does not offer, and says what it does offer', () => {
    const message = refused('statistics.correlate', { a: [1, 2, 3], b: [1, 2, 3], kind: 'kendall' })
    assert.match(message, /has to be one of: pearson, spearman/)
  })

  it('refuses text longer than the limit', () => {
    assert.match(refused('plot.function', { expression: 'x'.repeat(ENGINE_LIMITS.expression + 1), from: 0, to: 1 }), /longer than/)
  })

  it('refuses a boolean that is not a boolean', () => {
    assert.match(refused('data.export', { table: { headers: ['a'], rows: [['1']] }, delimiter: 5 }), /has to be text/)
  })
})

describe('statistics', () => {
  it('summarises numbers', () => {
    const result = run('statistics.summarise', { values: [1, 2, 3, 4, 5] })
    assert.equal(result.ok, true)
    assert.equal(result.mean, 3)
  })

  it('always returns the causation warning with a correlation', () => {
    const result = run('statistics.correlate', { a: [1, 2, 3, 4], b: [2, 4, 6, 8] })
    assert.equal(result.ok, true)
    assert.ok(Math.abs((result.correlation as number) - 1) < 1e-9)
    assert.match(String(result.describe), /caus/i)
  })

  it('runs a rank correlation when asked', () => {
    const result = run('statistics.correlate', { a: [1, 2, 3, 4], b: [1, 4, 9, 16], kind: 'spearman' })
    assert.equal(result.kind, 'spearman')
    assert.ok(Math.abs((result.correlation as number) - 1) < 1e-9)
  })

  it('regresses with the predictors in the engine’s own order', () => {
    const result = run('statistics.regress', {
      predictors: [{ values: [1, 2, 3, 4, 5] }],
      outcome: [3, 5, 7, 9, 11]
    })
    assert.equal(result.ok, true)
    // y = 2x + 1 exactly, so the slope is 2 and the intercept is 1.
    const coefficients = result.coefficients as number[]
    assert.ok(Math.abs(coefficients[0] - 2) < 1e-9, JSON.stringify(coefficients))
    assert.ok(Math.abs((result.intercept as number) - 1) < 1e-9)
    assert.ok(Math.abs((result.rSquared as number) - 1) < 1e-9)
  })

  it('runs each kind of test', () => {
    assert.equal(run('statistics.test', { kind: 'one-sample', values: [1, 2, 3, 4, 5], against: 0 }).ok, true)
    assert.equal(run('statistics.test', { kind: 'two-sample', a: [1, 2, 3], b: [4, 5, 6] }).ok, true)
    // Differences that all differ, since a constant difference has no variance and the engine rightly refuses it.
    assert.equal(run('statistics.test', { kind: 'paired', a: [1, 2, 3, 4], b: [2, 4, 5, 9] }).ok, true)
    assert.equal(run('statistics.test', { kind: 'chi-square', observed: [[10, 20], [30, 40]] }).ok, true)
  })

  it('refuses a paired test whose differences are all identical, rather than dividing by zero', () => {
    const result = run('statistics.test', { kind: 'paired', a: [1, 2, 3], b: [2, 3, 4] })
    assert.equal(result.ok, false)
    assert.equal(result.error, 'zero-variance')
  })

  it('refuses a negative count in a chi-square table, because a count cannot be negative', () => {
    assert.match(refused('statistics.test', { kind: 'chi-square', observed: [[10, -1], [3, 4]] }), /not a count/)
  })

  it('describes a distribution and evaluates it', () => {
    const result = run('statistics.distribution', { distribution: 'normal', parameters: [0, 1], at: 0, probability: 0.975 })
    assert.equal(result.ok, true)
    assert.ok(Math.abs((result.cumulative as number) - 0.5) < 1e-6)
    assert.ok(Math.abs((result.quantile as number) - 1.96) < 0.01)
  })

  it('cannot be walked up a prototype chain to a distribution that is not one', () => {
    for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      assert.match(refused('statistics.distribution', { distribution: name, parameters: [] }), /no distribution called/)
    }
  })

  it('flags outliers without removing them', () => {
    const result = run('statistics.outliers', { values: [1, 2, 3, 4, 100], method: 'iqr' })
    assert.equal(result.ok, true)
    assert.deepEqual(result.indices, [4])
    assert.match(String(result.describe), /flagged, not removed/)
  })

  it('reports the binning rule as part of a histogram', () => {
    const result = run('statistics.histogram', { values: [1, 2, 2, 3, 3, 3, 4, 8] })
    assert.equal(result.ok, true)
    assert.ok(typeof result.rule === 'string')
  })

  it('refuses a binning rule the engine does not have, rather than silently using another', () => {
    assert.match(refused('statistics.histogram', { values: [1, 2, 3], rule: 'scott' }), /has to be one of/)
  })
})

describe('data', () => {
  const table = { headers: ['name', 'score'], rows: [['ana', '10'], ['bo', '30'], ['cy', '20']] }

  it('parses delimited text and says how it guessed the delimiter', () => {
    const result = run('data.parse', { text: 'a,b\n1,2\n3,4' })
    assert.equal(result.ok, true)
    assert.equal(result.delimiter, ',')
    assert.ok(Array.isArray(result.notes))
  })

  it('handles quoted fields with commas inside them', () => {
    const result = run('data.parse', { text: 'a,b\n"one, two",3' })
    const parsed = result.table as { rows: { cells: unknown[] }[] }
    assert.equal(parsed.rows[0].cells[0], 'one, two')
  })

  it('profiles a table and reports warnings', () => {
    const result = run('data.profile', { table })
    assert.equal(result.rows, 3)
    assert.ok(Array.isArray(result.warnings))
  })

  it('sorts by one or more columns', () => {
    const result = run('data.sort', { table, keys: [{ column: 'score', descending: true }] })
    assert.equal(result.ok, true)
    const sorted = result.table as { rows: { cells: unknown[] }[] }
    assert.equal(sorted.rows[0].cells[0], 'bo')
  })

  it('refuses a sort with no columns to sort by', () => {
    assert.match(refused('data.sort', { table, keys: [] }), /at least one column/)
  })

  it('filters and says how many rows it removed', () => {
    const result = run('data.filter', {
      table,
      filter: { match: 'all', conditions: [{ column: 'score', comparison: 'greater', value: 15 }] }
    })
    assert.equal(result.ok, true)
    assert.equal(result.kept, 2)
    assert.equal(result.removed, 1)
  })

  it('refuses a filter nested past the depth allowed', () => {
    const deep = (n: number): Record<string, unknown> =>
      n === 0
        ? { match: 'all', conditions: [{ column: 'score', comparison: 'is-not-empty' }] }
        : { match: 'all', conditions: [], groups: [deep(n - 1)] }
    assert.match(refused('data.filter', { table, filter: deep(6) }), /nested more deeply/)
  })

  it('refuses a filter with no conditions at all', () => {
    assert.match(refused('data.filter', { table, filter: { match: 'all', conditions: [] } }), /at least one condition/)
  })

  it('aggregates a column', () => {
    const result = run('data.aggregate', { table, column: 'score', aggregate: 'sum' })
    assert.equal(result.ok, true)
    assert.equal(result.grouped, false)
    assert.equal(result.value, 60)
  })

  it('aggregates within groups', () => {
    const grouped = {
      headers: ['team', 'score'],
      rows: [['red', '1'], ['red', '2'], ['blue', '10']]
    }
    const result = run('data.aggregate', { table: grouped, by: ['team'], column: 'score', aggregate: 'sum' })
    assert.equal(result.grouped, true)
    assert.equal((result.groups as unknown[]).length, 2)
  })

  it('reports an unknown column rather than throwing', () => {
    const result = run('data.aggregate', { table, column: 'nonexistent', aggregate: 'sum' })
    assert.equal(result.ok, false)
    assert.equal(result.error, 'unknown-column')
  })

  it('joins and reports what matched on each side', () => {
    const right = { headers: ['name', 'age'], rows: [['ana', '30'], ['zed', '40']] }
    const result = run('data.join', { left: table, right, leftColumn: 'name', rightColumn: 'name', kind: 'left' })
    assert.equal(result.ok, true)
    assert.equal(result.matchedLeft, 1)
    assert.equal(result.unmatchedLeft, 2)
  })

  it('retypes a column from its original text', () => {
    const result = run('data.retype', { table, column: 'score', type: 'number' })
    assert.equal(result.ok, true)
    const retyped = result.table as { columns: { id: string; type: string }[] }
    assert.equal(retyped.columns.find((one) => one.id === 'score')?.type, 'number')
  })

  it('escapes a formula on export, so a spreadsheet does not run it', () => {
    const dangerous = { headers: ['a'], rows: [['=1+1'], ['@SUM(A1)'], ['+1']] }
    const result = run('data.export', { table: dangerous })
    const text = String(result.text)
    assert.ok(!/^=1\+1/m.test(text), text)
    assert.ok(text.includes("'=1+1") || text.includes('"\'=1+1"'), text)
  })

  it('refuses a table with more rows than allowed', () => {
    const rows = new Array(ENGINE_LIMITS.rows + 1).fill(['1'])
    assert.match(refused('data.profile', { table: { headers: ['a'], rows } }), /more than the/)
  })

  it('refuses a row that is not a list', () => {
    assert.match(refused('data.profile', { table: { headers: ['a'], rows: ['not a row'] } }), /not a list of values/)
  })

  it('refuses something that is not a table at all', () => {
    assert.match(refused('data.profile', { table: 'a,b\n1,2' }), /has to be a table/)
  })
})

describe('plotting', () => {
  it('samples a function into a series', () => {
    const result = run('plot.function', { expression: 'sin(x)', from: 0, to: 6.28, initial: 32 })
    assert.equal(result.ok, true)
    assert.equal((result.series as { provenance: string }).provenance, 'computed')
  })

  it('samples a parametric curve', () => {
    const result = run('plot.parametric', { x: 'cos(t)', y: 'sin(t)', from: 0, to: 6.283185307, initial: 64 })
    assert.equal(result.ok, true)
  })

  it('samples a polar curve', () => {
    const result = run('plot.polar', { expression: 'cos(3*theta)', from: 0, to: 3.14159, initial: 100 })
    assert.equal(result.ok, true)
  })

  it('builds a plot from points and always baselines bars at zero', () => {
    const result = run('plot.points', {
      series: [{ id: 'a', label: 'A', kind: 'bar', points: [{ x: 0, y: 100 }, { x: 1, y: 102 }] }]
    })
    assert.equal(result.ok, true)
    const plot = result.plot as { y: { range: { low: number } } }
    assert.ok(plot.y.range.low <= 0)
  })

  it('refuses a point without a numeric x and y', () => {
    assert.match(
      refused('plot.points', { series: [{ points: [{ x: 'nope', y: 1 }] }] }),
      /without a numeric x and y/
    )
  })

  it('reports what a log axis could not place', () => {
    const result = run('plot.axis', { values: [0, 1, 10, 100], scale: 'log' })
    assert.equal(result.ok, true)
    assert.equal(result.excluded, 1)
  })

  it('decimates while keeping spikes', () => {
    const points = Array.from({ length: 20_000 }, (_, i) => ({ x: i, y: i === 9_999 ? 500 : 0 }))
    const result = run('plot.decimate', { points, target: 500 })
    assert.equal(result.ok, true)
    assert.ok((result.points as { y: number }[]).some((one) => one.y === 500))
  })
})

describe('measurement', () => {
  const one = { value: 9.81, unit: 'm/s^2', uncertainty: 0.02, provenance: 'measured' }

  it('makes a measurement and reports it the way it should be written', () => {
    const result = run('measurement.make', one)
    assert.equal(result.ok, true)
    assert.equal(result.report, '9.810 ± 0.020 m/s^2')
  })

  it('defaults provenance to unknown rather than calling a number a measurement', () => {
    const result = run('measurement.make', { value: 1, unit: 'm' })
    assert.equal(result.provenance, 'unknown')
  })

  it('combines measurements in quadrature', () => {
    const result = run('measurement.combine', {
      a: { value: 3, unit: 'm', uncertainty: 0.3 },
      b: { value: 4, unit: 'm', uncertainty: 0.4 },
      how: 'add'
    })
    assert.equal(result.ok, true)
    assert.equal(result.value, 7)
    assert.ok(Math.abs((result.uncertainty as { value: number }).value - 0.5) < 1e-9)
  })

  it('uses the standard error of the mean for repeated readings', () => {
    const result = run('measurement.repeated', { readings: [10, 12, 11, 13, 9], unit: 'm' })
    assert.equal(result.ok, true)
    const made = result.measurement as { uncertainty: { value: number } }
    assert.ok(made.uncertainty.value < (result.spread as number))
  })

  it('converts a measurement without applying an offset to its uncertainty', () => {
    const result = run('measurement.convert', { value: 100, unit: 'degC', uncertainty: 1, to: 'K' })
    assert.ok(Math.abs((result.value as number) - 373.15) < 1e-9)
    assert.ok(Math.abs((result.uncertainty as { value: number }).value - 1) < 1e-9)
  })

  it('says whether two measurements agree', () => {
    const result = run('measurement.agree', {
      a: { value: 9.81, unit: 'm/s^2', uncertainty: 0.02 },
      b: { value: 9.79, unit: 'm/s^2', uncertainty: 0.03 }
    })
    assert.equal(result.ok, true)
    assert.equal(result.agree, true)
  })

  it('propagates uncertainty through an expression by sampling', () => {
    const result = run('measurement.propagate', {
      inputs: [{ value: 10, unit: 'm', uncertainty: 0.1 }, { value: 20, unit: 'm', uncertainty: 0.2 }],
      names: ['a', 'b'],
      expression: 'a + b',
      samples: 5000,
      seed: 3
    })
    assert.equal(result.ok, true)
    assert.ok(Math.abs((result.uncertainty as { value: number }).value - Math.sqrt(0.05)) < 0.02)
  })

  it('refuses a propagation whose names do not match its inputs', () => {
    assert.match(
      refused('measurement.propagate', {
        inputs: [{ value: 1, unit: 'm' }],
        names: ['a', 'b'],
        expression: 'a + b'
      }),
      /one name for each input/
    )
  })

  it('counts significant figures from how a number was written', () => {
    assert.equal(run('measurement.figures', { written: '1.50' }).figures, 3)
    assert.equal(run('measurement.figures', { written: '1500' }).ambiguous, true)
  })
})

describe('optimization', () => {
  it('minimises over an interval and claims only a local minimum by default', () => {
    const result = run('optimise.interval', { expression: '(x-3)^2', from: -10, to: 10 })
    assert.equal(result.ok, true)
    assert.ok(Math.abs((result.point as number[])[0] - 3) < 1e-5)
    assert.equal(result.certainty, 'local')
  })

  it('minimises over several variables', () => {
    const result = run('optimise.minimise', {
      expression: '(a-1)^2 + (b+2)^2',
      variables: ['a', 'b'],
      start: [0, 0]
    })
    assert.equal(result.ok, true)
    const point = result.point as number[]
    assert.ok(Math.abs(point[0] - 1) < 1e-3 && Math.abs(point[1] + 2) < 1e-3)
  })

  it('maximises by negating, and reports the value the right way up', () => {
    const result = run('optimise.minimise', {
      expression: '-((x-3)^2) + 7',
      variables: ['x'],
      start: [0],
      maximise: true
    })
    assert.ok(Math.abs((result.value as number) - 7) < 1e-4)
  })

  it('runs multi-start and reports how many minima it found', () => {
    const result = run('optimise.multistart', {
      expression: 'min(0.5*(x+2)^2 + 1, (x-3)^2)',
      variables: ['x'],
      bounds: [{ low: -10, high: 10 }],
      starts: 12,
      seed: 4
    })
    assert.equal(result.ok, true)
    assert.ok(typeof result.distinctMinima === 'number')
  })

  it('refuses when the bounds do not match the variables', () => {
    assert.match(
      refused('optimise.multistart', { expression: 'x', variables: ['x'], bounds: [] }),
      /Every variable needs one/
    )
  })

  it('solves a linear programme and claims the global optimum', () => {
    const result = run('optimise.linear', {
      objective: [3, 5],
      direction: 'maximise',
      constraints: [
        { coefficients: [1, 0], relation: '<=', value: 4, label: 'one' },
        { coefficients: [0, 2], relation: '<=', value: 12, label: 'two' },
        { coefficients: [3, 2], relation: '<=', value: 18, label: 'three' }
      ]
    })
    assert.equal(result.ok, true)
    assert.ok(Math.abs((result.value as number) - 36) < 1e-9)
    assert.equal(result.certainty, 'global')
  })

  it('reports an infeasible programme as infeasible', () => {
    const result = run('optimise.linear', {
      objective: [1],
      direction: 'maximise',
      constraints: [
        { coefficients: [1], relation: '<=', value: 1 },
        { coefficients: [1], relation: '>=', value: 5 }
      ]
    })
    assert.equal(result.ok, false)
    assert.equal(result.error, 'infeasible')
  })

  it('solves a constrained problem and reports how far outside it ended', () => {
    const result = run('optimise.constrained', {
      expression: '(x-10)^2 + (y-10)^2',
      variables: ['x', 'y'],
      start: [0, 0],
      constraints: [{ label: 'budget', kind: 'inequality', expression: 'x + y - 6' }],
      rounds: 8
    })
    assert.equal(result.ok, true)
    assert.ok(Math.abs((result.point as number[])[0] - 3) < 0.1)
    assert.ok(Array.isArray(result.violations))
  })
})

describe('simulation', () => {
  it('integrates a system and stamps the result as simulated', () => {
    const result = run('simulate.integrate', {
      variables: ['y'],
      rates: ['y'],
      start: [1],
      from: 0,
      to: 1
    })
    assert.equal(result.ok, true)
    assert.equal(result.provenance, 'simulated')
    const final = result.final as { values: number[] }
    assert.ok(Math.abs(final.values[0] - Math.E) < 1e-5)
  })

  it('refuses a system with the wrong number of rates', () => {
    assert.match(
      refused('simulate.integrate', { variables: ['a', 'b'], rates: ['b'], start: [1, 0], to: 1 }),
      /Every variable needs one/
    )
  })

  it('watches a conserved quantity and catches an integrator losing it', () => {
    const result = run('simulate.invariant', {
      variables: ['x', 'v'],
      rates: ['v', '-x'],
      quantity: '0.5*v^2 + 0.5*x^2',
      start: [1, 0],
      to: 20,
      method: 'euler',
      step: 0.05,
      allowedDrift: 0.001
    })
    assert.equal(result.ok, true)
    assert.equal(result.held, false)
    assert.match(String(result.verdict), /these numbers are wrong/)
  })

  it('compares step sizes and says whether the answer settled', () => {
    const result = run('simulate.steps', {
      variables: ['y'],
      rates: ['y'],
      start: [1],
      to: 1,
      steps: [0.1, 0.05, 0.025]
    })
    assert.equal(result.ok, true)
    assert.equal(typeof result.settled, 'boolean')
  })

  it('runs a Monte Carlo trial and reproduces it from the seed', () => {
    const input = { expression: 'random*2', runs: 500, seed: 9 }
    const a = run('simulate.montecarlo', input)
    const b = run('simulate.montecarlo', input)
    assert.equal(a.ok, true)
    assert.deepEqual(a.summary, b.summary)
  })

  it('says a Monte Carlo spread is not a confidence interval', () => {
    const result = run('simulate.montecarlo', { expression: 'random', runs: 200, seed: 1 })
    const summary = result.summary as { notes: string[] }
    assert.ok(summary.notes.some((note) => /not how well the average is pinned down/.test(note)))
  })

  it('sweeps a grid and refuses one that is too large', () => {
    const result = run('simulate.sweep', {
      expression: 'a*b',
      axes: [
        { name: 'a', from: 1, to: 3, count: 3 },
        { name: 'b', from: 1, to: 2, count: 2 }
      ]
    })
    assert.equal(result.ok, true)
    assert.equal((result.points as unknown[]).length, 6)

    const tooBig = run('simulate.sweep', {
      expression: 'a*b',
      axes: [
        { name: 'a', from: 1, to: 3, count: 100 },
        { name: 'b', from: 1, to: 2, count: 100 }
      ]
    })
    assert.equal(tooBig.ok, false)
  })

  it('ranks parameters by sensitivity and warns it cannot see interactions', () => {
    const result = run('simulate.sensitivity', {
      expression: 'big*10 + small*0.01',
      base: { big: 1, small: 1 }
    })
    assert.equal(result.ok, true)
    assert.equal((result.ranked as string[])[0], 'big')
    assert.ok((result.notes as string[]).some((note) => /cannot see an interaction/.test(note)))
  })
})
