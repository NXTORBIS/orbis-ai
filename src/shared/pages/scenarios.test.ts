import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildMatrix,
  captureBaseline,
  checkScenario,
  differenceMap,
  explainChange,
  findConflicts,
  isScenarioError,
  mergeScenarios,
  playTimeline,
  resolve,
  runQueue,
  SCENARIO_ASSUMPTIONS,
  type Change,
  type Scenario,
  type Value
} from './scenarios.ts'

const base = () => captureBaseline('b', 'Now', { price: 100, volume: 50, region: 'north', premium: false }, '2026-01-01')

const scenario = (id: string, changes: Change[], parentId: string | null = null): Scenario => ({
  id,
  label: id,
  parentId,
  changes,
  describe: ''
})

const set = (key: string, to: Value, because = 'because'): Change => ({ key, how: 'set', to, because })

// ------------------------------------------------------------ the baseline

test('the baseline is frozen against later edits to its source', () => {
  const source: Record<string, Value> = { price: 100 }
  const baseline = captureBaseline('b', 'Now', source, '2026-01-01')
  source.price = 999
  assert.equal(baseline.values.price, 100)
  assert.equal(Object.isFrozen(baseline.values), true)
})

test('resolving a scenario does not modify the baseline', () => {
  const baseline = base()
  const result = resolve(baseline, [scenario('s', [set('price', 120)])], 's')
  assert.ok(!isScenarioError(result))
  assert.equal(baseline.values.price, 100)
  assert.equal(result.values.price, 120)
})

// ------------------------------------------------------------ resolving

test('a set replaces and a difference is reported against the baseline', () => {
  const result = resolve(base(), [scenario('s', [set('price', 120)])], 's')
  assert.ok(!isScenarioError(result))
  assert.deepEqual(result.differences, [{ key: 'price', from: 100, to: 120, by: 20, through: ['s'] }])
})

test('add and multiply move relative to the value at that point in the chain', () => {
  const scenarios = [
    scenario('a', [{ key: 'price', how: 'add', to: 10, because: 'tariff' }]),
    scenario('b', [{ key: 'price', how: 'multiply', to: 2, because: 'doubling' }], 'a')
  ]
  const result = resolve(base(), scenarios, 'b')
  assert.ok(!isScenarioError(result))
  assert.equal(result.values.price, 220)
})

test('a deep chain names every scenario that touched the value', () => {
  const scenarios = [
    scenario('a', [{ key: 'price', how: 'add', to: 10, because: '' }]),
    scenario('b', [{ key: 'volume', how: 'add', to: 5, because: '' }], 'a'),
    scenario('c', [{ key: 'price', how: 'add', to: 10, because: '' }], 'b')
  ]
  const result = resolve(base(), scenarios, 'c')
  assert.ok(!isScenarioError(result))
  assert.deepEqual(result.differences.find((one) => one.key === 'price')?.through, ['a', 'c'])
})

test('the lineage runs from the baseline down', () => {
  const scenarios = [scenario('a', [set('price', 1)]), scenario('b', [set('price', 2)], 'a')]
  const result = resolve(base(), scenarios, 'b')
  assert.ok(!isScenarioError(result))
  assert.deepEqual(result.lineage, ['a', 'b'])
})

test('a scenario that is its own ancestor is refused rather than looping', () => {
  const scenarios = [scenario('a', [], 'b'), scenario('b', [], 'a')]
  const result = resolve(base(), scenarios, 'a')
  assert.ok(isScenarioError(result))
  assert.equal(result.error, 'cycle')
})

test('adding to a key that is not in the baseline is refused and kept', () => {
  const result = resolve(base(), [scenario('s', [{ key: 'ghost', how: 'add', to: 1, because: '' }])], 's')
  assert.ok(!isScenarioError(result))
  assert.equal(result.refused.length, 1)
  assert.match(result.refused[0]?.why ?? '', /nothing to add to/)
})

test('multiplying a string is refused with the alternative named', () => {
  const result = resolve(base(), [scenario('s', [{ key: 'region', how: 'multiply', to: 2, because: '' }])], 's')
  assert.ok(!isScenarioError(result))
  assert.match(result.refused[0]?.why ?? '', /Use set instead/)
})

test('a change producing a non-finite value is refused', () => {
  const result = resolve(base(), [scenario('s', [{ key: 'price', how: 'multiply', to: Infinity, because: '' }])], 's')
  assert.ok(!isScenarioError(result))
  assert.equal(result.refused.length, 1)
  assert.equal(result.values.price, 100)
})

test('a scenario id that does not exist is refused', () => {
  const result = resolve(base(), [], 'nope')
  assert.ok(isScenarioError(result))
  assert.equal(result.error, 'not-found')
})

test('a key named __proto__ is a plain value, not the prototype', () => {
  const baseline = captureBaseline('b', 'Now', { __proto__: 1 } as Record<string, Value>, 'x')
  const result = resolve(baseline, [scenario('s', [set('__proto__', 2)])], 's')
  assert.ok(!isScenarioError(result))
  assert.equal(result.values.__proto__, 2)
  assert.equal(({} as Record<string, unknown>).polluted, undefined)
})

// ------------------------------------------------------------ checking

test('setting one key twice is blocking, and says why the record misleads', () => {
  const problems = checkScenario(base(), scenario('s', [set('price', 110, 'a'), set('price', 120, 'b')]))
  const contradiction = problems.find((one) => one.kind === 'contradiction')
  assert.ok(contradiction)
  assert.equal(contradiction?.blocking, true)
  assert.match(contradiction?.describe ?? '', /looking like it applied/)
})

test('adjusting then setting a key reports that the adjustment does nothing', () => {
  const problems = checkScenario(base(), scenario('s', [{ key: 'price', how: 'add', to: 5, because: 'x' }, set('price', 120)]))
  assert.ok(problems.some((one) => one.kind === 'overridden'))
})

test('a key not in the baseline is reported but not blocking', () => {
  const problems = checkScenario(base(), scenario('s', [set('ghost', 1)]))
  const problem = problems.find((one) => one.kind === 'unknown-key')
  assert.equal(problem?.blocking, false)
})

test('a change with no reason given is reported', () => {
  const problems = checkScenario(base(), scenario('s', [set('price', 120, '  ')]))
  const problem = problems.find((one) => one.kind === 'unexplained')
  assert.match(problem?.describe ?? '', /the reason will not/)
})

test('a scenario with no changes is the baseline under another name', () => {
  const problems = checkScenario(base(), scenario('s', []))
  assert.ok(problems.some((one) => one.kind === 'no-changes'))
})

test('a well-formed scenario has nothing to report', () => {
  assert.deepEqual(checkScenario(base(), scenario('s', [set('price', 120, 'supplier raised prices')])), [])
})

// ------------------------------------------------------------ matrices

test('a matrix is every combination, with the last axis turning fastest', () => {
  const cells = buildMatrix(base(), [
    { key: 'price', label: 'Price', values: [100, 200] },
    { key: 'volume', label: 'Volume', values: [10, 20, 30] }
  ])
  assert.ok(!isScenarioError(cells))
  assert.equal(cells.length, 6)
  assert.deepEqual({ ...cells[0]?.at }, { price: 100, volume: 10 })
  assert.deepEqual({ ...cells[1]?.at }, { price: 100, volume: 20 })
  assert.deepEqual({ ...cells[3]?.at }, { price: 200, volume: 10 })
})

test('matrix cell ids are stable and padded', () => {
  const cells = buildMatrix(base(), [{ key: 'price', label: 'Price', values: [1, 2] }])
  assert.ok(!isScenarioError(cells))
  assert.equal(cells[0]?.id, 'cell-000001')
})

test('a matrix axis over a key not in the baseline is refused', () => {
  const cells = buildMatrix(base(), [{ key: 'ghost', label: 'Ghost', values: [1] }])
  assert.ok(isScenarioError(cells))
  assert.equal(cells.error, 'unknown-key')
})

test('a matrix too large to run is refused with the size named', () => {
  const cells = buildMatrix(base(), [
    { key: 'price', label: 'Price', values: Array.from({ length: 200 }, (_, i) => i) },
    { key: 'volume', label: 'Volume', values: Array.from({ length: 200 }, (_, i) => i) }
  ])
  assert.ok(isScenarioError(cells))
  assert.match(cells.message, /40,000/)
})

test('an axis with no values is refused', () => {
  const cells = buildMatrix(base(), [{ key: 'price', label: 'Price', values: [] }])
  assert.ok(isScenarioError(cells))
  assert.equal(cells.error, 'empty-axis')
})

// ------------------------------------------------------------ the queue

test('a queue runs everything and reports it complete', async () => {
  const report = await runQueue(['a', 'b'], async (id) => ({ out: id === 'a' ? 1 : 2 }))
  assert.ok(!isScenarioError(report))
  assert.equal(report.complete, true)
  assert.equal(report.counts.done, 2)
  assert.deepEqual(report.entries[1]?.outcome, { values: { out: 2 } })
})

test('a queue with a failure is not complete', async () => {
  const report = await runQueue(['a', 'b'], async (id) => {
    if (id === 'a') throw new Error('diverged')
    return { out: 1 }
  })
  assert.ok(!isScenarioError(report))
  assert.equal(report.complete, false)
  assert.equal(report.counts.failed, 1)
  assert.equal(report.counts.done, 1)
  assert.equal(report.entries[0]?.failure, 'diverged')
})

test('stopping on failure marks the rest skipped, not cancelled', async () => {
  const report = await runQueue(
    ['a', 'b', 'c'],
    async (id) => {
      if (id === 'a') throw new Error('nope')
      return { out: 1 }
    },
    { stopOnFailure: true }
  )
  assert.ok(!isScenarioError(report))
  assert.equal(report.counts.skipped, 2)
  assert.equal(report.counts.cancelled, 0)
  assert.match(report.describe, /never started because an earlier one failed/)
})

test('cancelling marks entries cancelled', async () => {
  const report = await runQueue(['a', 'b'], async () => ({ out: 1 }), { cancelled: () => true })
  assert.ok(!isScenarioError(report))
  assert.equal(report.counts.cancelled, 2)
})

test('progress is reported for running and for the final state', async () => {
  const states: string[] = []
  await runQueue(['a'], async () => ({ out: 1 }), { onProgress: (entry) => states.push(entry.state) })
  assert.deepEqual(states, ['running', 'done'])
})

// ------------------------------------------------------------ differences

test('the difference map orders by relative move', () => {
  const map = differenceMap({ a: 100, b: 10 }, { a: 110, b: 15 })
  assert.equal(map.moved[0]?.key, 'b')
  assert.equal(map.moved[0]?.relative, 0.5)
})

test('a relative move against a baseline of zero is null, not infinite', () => {
  const map = differenceMap({ a: 0 }, { a: 5 })
  assert.equal(map.moved[0]?.relative, null)
})

test('nothing moving says the change may not have been applied', () => {
  const map = differenceMap({ a: 1 }, { a: 1 })
  assert.deepEqual(map.unchanged, ['a'])
  assert.match(map.describe, /not applied/)
})

test('outputs present in only one run are named separately', () => {
  const map = differenceMap({ a: 1, b: 2 }, { a: 1, c: 3 })
  assert.deepEqual(map.onlyInBaseline, ['b'])
  assert.deepEqual(map.onlyInScenario, ['c'])
})

test('a tolerance treats small moves as unchanged', () => {
  const map = differenceMap({ a: 1 }, { a: 1.0000001 }, 1e-6)
  assert.deepEqual(map.unchanged, ['a'])
})

// ------------------------------------------------------------ why

const linear = async (values: Readonly<Record<string, Value>>): Promise<Record<string, number>> => ({
  revenue: (values.price as number) * 10 + (values.volume as number) * 2
})

const multiplicative = async (values: Readonly<Record<string, Value>>): Promise<Record<string, number>> => ({
  revenue: (values.price as number) * (values.volume as number)
})

test('a linear model separates cleanly and the parts add up', async () => {
  const baseline = base()
  const resolved = resolve(baseline, [scenario('s', [set('price', 110), set('volume', 60)])], 's')
  assert.ok(!isScenarioError(resolved))
  const why = await explainChange(baseline, resolved, 'revenue', linear)
  assert.ok(!isScenarioError(why))
  assert.equal(why.separable, true)
  assert.equal(why.interaction, 0)
  assert.equal(why.total, 120)
})

test('a multiplicative model leaves an interaction that is reported on its own', async () => {
  const baseline = base()
  const resolved = resolve(baseline, [scenario('s', [set('price', 200), set('volume', 100)])], 's')
  assert.ok(!isScenarioError(resolved))
  const why = await explainChange(baseline, resolved, 'revenue', multiplicative)
  assert.ok(!isScenarioError(why))
  assert.equal(why.separable, false)
  assert.equal(why.total, 20000 - 5000)
  assert.equal(why.interaction, 15000 - (10000 - 5000) - (10000 - 5000))
  assert.match(why.describe, /No single input caused this move/)
})

test('contributions are ordered by size and carry their share', async () => {
  const baseline = base()
  const resolved = resolve(baseline, [scenario('s', [set('price', 110), set('volume', 51)])], 's')
  assert.ok(!isScenarioError(resolved))
  const why = await explainChange(baseline, resolved, 'revenue', linear)
  assert.ok(!isScenarioError(why))
  assert.equal(why.contributions[0]?.key, 'price')
  assert.equal(why.contributions[0]?.alone, 100)
  assert.equal(why.contributions[0]?.share, 100 / 102)
})

test('an output that did not move says the changes may be cancelling out', async () => {
  const baseline = base()
  const resolved = resolve(baseline, [scenario('s', [set('price', 98), set('volume', 60)])], 's')
  assert.ok(!isScenarioError(resolved))
  const why = await explainChange(baseline, resolved, 'revenue', linear)
  assert.ok(!isScenarioError(why))
  assert.equal(why.total, 0)
  assert.match(why.describe, /cancelling each other out/)
})

test('explaining a scenario that changes nothing is refused', async () => {
  const baseline = base()
  const resolved = resolve(baseline, [scenario('s', [])], 's')
  assert.ok(!isScenarioError(resolved))
  const why = await explainChange(baseline, resolved, 'revenue', linear)
  assert.ok(isScenarioError(why))
  assert.equal(why.error, 'no-changes')
})

test('explaining an output the model does not produce is refused', async () => {
  const baseline = base()
  const resolved = resolve(baseline, [scenario('s', [set('price', 110)])], 's')
  assert.ok(!isScenarioError(resolved))
  const why = await explainChange(baseline, resolved, 'profit', linear)
  assert.ok(isScenarioError(why))
  assert.equal(why.error, 'no-such-output')
})

// ------------------------------------------------------------ conflicts

test('two scenarios setting one key differently cannot both hold', () => {
  const conflicts = findConflicts([scenario('a', [set('price', 110)]), scenario('b', [set('price', 120)])])
  assert.equal(conflicts[0]?.kind, 'incompatible-direction')
  assert.match(conflicts[0]?.describe ?? '', /cannot both hold/)
})

test('two identical scenarios are named as duplicates', () => {
  const conflicts = findConflicts([scenario('a', [set('price', 110)]), scenario('b', [set('price', 110)])])
  assert.equal(conflicts[0]?.kind, 'duplicate-scenario')
})

test('overlapping-but-agreeing scenarios are safe to combine and say so', () => {
  const conflicts = findConflicts([scenario('a', [set('price', 110)]), scenario('b', [set('price', 110), set('volume', 60)])])
  assert.equal(conflicts[0]?.kind, 'same-key')
  assert.match(conflicts[0]?.describe ?? '', /safe/)
})

test('scenarios touching different keys do not conflict', () => {
  assert.deepEqual(findConflicts([scenario('a', [set('price', 110)]), scenario('b', [set('volume', 60)])]), [])
})

// ------------------------------------------------------------ merging

test('a merge states which scenario won each contested key', () => {
  const merged = mergeScenarios([scenario('a', [set('price', 110)]), scenario('b', [set('price', 120)])], 'm', 'Merged')
  assert.ok(!isScenarioError(merged))
  assert.deepEqual(merged.resolutions, [{ key: 'price', wonBy: 'b', over: ['a'] }])
  assert.match(merged.describe, /price from b/)
})

test('a merge with nothing contested says so', () => {
  const merged = mergeScenarios([scenario('a', [set('price', 110)]), scenario('b', [set('volume', 60)])], 'm', 'Merged')
  assert.ok(!isScenarioError(merged))
  assert.deepEqual(merged.resolutions, [])
  assert.equal(merged.scenario.changes.length, 2)
})

test('merging a branched scenario is refused rather than dropping its chain', () => {
  const merged = mergeScenarios([scenario('a', [set('price', 1)], 'parent')], 'm', 'Merged')
  assert.ok(isScenarioError(merged))
  assert.equal(merged.error, 'branched')
})

test('merging nothing is refused', () => {
  assert.ok(isScenarioError(mergeScenarios([], 'm', 'Merged')))
})

// ------------------------------------------------------------ timelines

test('events are applied at the first step at or after their time', () => {
  const timeline = playTimeline(base(), [{ at: 2.5, key: 'price', how: 'set', to: 200, because: 'tariff' }], [1, 2, 3, 4])
  assert.ok(!isScenarioError(timeline))
  assert.equal(timeline.steps[1]?.values.price, 100)
  assert.equal(timeline.steps[2]?.values.price, 200)
  assert.deepEqual(timeline.steps[2]?.applied, ['price: tariff'])
})

test('events outside the run are listed rather than dropped', () => {
  const timeline = playTimeline(base(), [{ at: 99, key: 'price', how: 'set', to: 200, because: 'later' }], [1, 2])
  assert.ok(!isScenarioError(timeline))
  assert.equal(timeline.outside.length, 1)
  assert.equal(timeline.steps[1]?.values.price, 100)
  assert.match(timeline.describe, /were not applied/)
})

test('relative events compound across steps', () => {
  const timeline = playTimeline(
    base(),
    [
      { at: 1, key: 'price', how: 'multiply', to: 2, because: '' },
      { at: 2, key: 'price', how: 'multiply', to: 2, because: '' }
    ],
    [1, 2]
  )
  assert.ok(!isScenarioError(timeline))
  assert.equal(timeline.steps[1]?.values.price, 400)
})

test('each step keeps its own copy of the values', () => {
  const timeline = playTimeline(base(), [{ at: 2, key: 'price', how: 'set', to: 200, because: '' }], [1, 2])
  assert.ok(!isScenarioError(timeline))
  assert.notEqual(timeline.steps[0]?.values.price, timeline.steps[1]?.values.price)
})

test('steps that do not increase are refused', () => {
  assert.ok(isScenarioError(playTimeline(base(), [], [2, 1])))
})

test('a timeline with no steps is refused', () => {
  assert.ok(isScenarioError(playTimeline(base(), [], [])))
})

test('the stated assumptions are frozen and name the interaction rule', () => {
  assert.equal(Object.isFrozen(SCENARIO_ASSUMPTIONS), true)
  assert.ok(SCENARIO_ASSUMPTIONS.some((one) => /interaction/.test(one)))
})
