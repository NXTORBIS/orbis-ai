import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cleanRule,
  cleanRules,
  considerRule,
  inQuietHours,
  MAX_RULES,
  mayNotify,
  RULES_SCHEMA_VERSION,
  testHolds,
  type Readings,
  type StoredRule
} from './rules.ts'
import { DEFAULT_NOTIFICATIONS } from './experience.ts'

const AT = Date.UTC(2026, 8, 27, 12, 0, 0)

const rule = (over: Partial<StoredRule> = {}): StoredRule => ({
  id: 'r1',
  name: 'Tell me when the download finishes',
  schemaVersion: RULES_SCHEMA_VERSION,
  enabled: true,
  test: { source: 'download', field: 'status', operator: 'equals', value: 'complete' },
  notify: { title: 'Download complete', body: '' },
  cooldownMs: 0,
  repeat: 'always',
  createdAt: AT,
  updatedAt: AT,
  ...over
})

const readings = (r: Readings): Readings => r

// ---------------------------------------------------------------- conditions

test('a missing reading is not a reading of zero', () => {
  assert.equal(testHolds({ source: 'download', field: 'status', operator: 'equals', value: 'complete' }, {}), false)
  assert.equal(testHolds({ source: 'tasks', field: 'left', operator: 'lessThan', value: 1 }, {}), false)
})

test('comparisons compare', () => {
  const now = readings({ tasks: { left: 0, label: 'Chemistry' } })
  assert.equal(testHolds({ source: 'tasks', field: 'left', operator: 'equals', value: 0 }, now), true)
  assert.equal(testHolds({ source: 'tasks', field: 'left', operator: 'lessThan', value: 1 }, now), true)
  assert.equal(testHolds({ source: 'tasks', field: 'left', operator: 'greaterThan', value: 0 }, now), false)
  assert.equal(testHolds({ source: 'tasks', field: 'label', operator: 'contains', value: 'chem' }, now), true)
  assert.equal(testHolds({ source: 'tasks', field: 'label', operator: 'notEquals', value: 'Physics' }, now), true)
})

test('text compared as a number is not a comparison', () => {
  const now = readings({ download: { speed: 'fast' } })
  assert.equal(testHolds({ source: 'download', field: 'speed', operator: 'greaterThan', value: 5 }, now), false)
})

test('a change needs something to have changed from', () => {
  const now = readings({ workflow: { status: 'running' } })
  assert.equal(testHolds({ source: 'workflow', field: 'status', operator: 'changes' }, now, {}), false)
  const before = readings({ workflow: { status: 'paused' } })
  assert.equal(testHolds({ source: 'workflow', field: 'status', operator: 'changes' }, now, before), true)
  assert.equal(testHolds({ source: 'workflow', field: 'status', operator: 'changes' }, now, now), false)
})

test('increases and decreases', () => {
  const before = readings({ download: { progress: 40 } })
  const now = readings({ download: { progress: 82 } })
  assert.equal(testHolds({ source: 'download', field: 'progress', operator: 'increases' }, now, before), true)
  assert.equal(testHolds({ source: 'download', field: 'progress', operator: 'decreases' }, now, before), false)
})

test('all, any and not', () => {
  const now = readings({ workflow: { status: 'complete' }, tasks: { left: 0 } })
  const complete = { source: 'workflow', field: 'status', operator: 'equals', value: 'complete' } as const
  const noTasks = { source: 'tasks', field: 'left', operator: 'equals', value: 0 } as const
  const busy = { source: 'tasks', field: 'left', operator: 'greaterThan', value: 5 } as const

  assert.equal(testHolds({ all: [complete, noTasks] }, now), true)
  assert.equal(testHolds({ all: [complete, busy] }, now), false)
  assert.equal(testHolds({ any: [busy, noTasks] }, now), true)
  assert.equal(testHolds({ not: busy }, now), true)
  assert.equal(testHolds({ all: [complete, { not: busy }] }, now), true)
  // An empty "all" is not vacuously true here: a rule that watches nothing should never fire.
  assert.equal(testHolds({ all: [] }, now), false)
})

// ---------------------------------------------------------------- speaking, and not

test('fires when the answer turns from no to yes', () => {
  const before = readings({ download: { status: 'downloading' } })
  const now = readings({ download: { status: 'complete' } })

  const first = considerRule(rule(), now, before, AT)
  assert.equal(first.fire, true)
  assert.equal(first.rule.lastFiredAt, AT)
})

test('does not keep saying it while it stays true', () => {
  const now = readings({ download: { status: 'complete' } })
  const after = considerRule(rule(), now, now, AT).rule
  // Still complete a second later. Being told once is being told.
  const again = considerRule(after, now, now, AT + 1000)
  assert.equal(again.fire, false)
})

test('says it again when it becomes true again', () => {
  const downloading = readings({ download: { status: 'downloading' } })
  const complete = readings({ download: { status: 'complete' } })

  let current = considerRule(rule(), complete, downloading, AT).rule
  current = considerRule(current, downloading, complete, AT + 1000).rule
  assert.equal(current.lastResult, false)
  const third = considerRule(current, complete, downloading, AT + 2000)
  assert.equal(third.fire, true)
})

test('a cooldown is respected', () => {
  const off = readings({ download: { status: 'downloading' } })
  const on = readings({ download: { status: 'complete' } })

  let current = considerRule(rule({ cooldownMs: 60_000 }), on, off, AT).rule
  current = considerRule(current, off, on, AT + 1_000).rule
  const tooSoon = considerRule(current, on, off, AT + 2_000)
  assert.equal(tooSoon.fire, false, 'inside the cooldown it stays quiet')

  let later = considerRule(current, off, on, AT + 90_000).rule
  const allowed = considerRule(later, on, off, AT + 91_000)
  assert.equal(allowed.fire, true, 'after the cooldown it may speak again')
})

test('once means once', () => {
  const off = readings({ download: { status: 'downloading' } })
  const on = readings({ download: { status: 'complete' } })
  let current = considerRule(rule({ repeat: 'once' }), on, off, AT).rule
  current = considerRule(current, off, on, AT + 1000).rule
  assert.equal(considerRule(current, on, off, AT + 2000).fire, false)
})

test('a disabled rule watches but never speaks', () => {
  const off = readings({ download: { status: 'downloading' } })
  const on = readings({ download: { status: 'complete' } })
  const outcome = considerRule(rule({ enabled: false }), on, off, AT)
  assert.equal(outcome.fire, false)
  assert.equal(outcome.rule.lastResult, true, 'it still knows the answer, so re-enabling it is not a false alarm')
})

// ---------------------------------------------------------------- when Orbis may speak

test('quiet hours are honoured, including across midnight', () => {
  const night = { ...DEFAULT_NOTIFICATIONS, quietHours: { enabled: true, from: '22:00', to: '07:00' } }
  const at = (h: number, m = 0): number => new Date(2026, 8, 27, h, m).getTime()

  assert.equal(inQuietHours(night, at(23)), true)
  assert.equal(inQuietHours(night, at(3)), true)
  assert.equal(inQuietHours(night, at(6, 59)), true)
  assert.equal(inQuietHours(night, at(7)), false)
  assert.equal(inQuietHours(night, at(12)), false)
  assert.equal(inQuietHours(night, at(21, 59)), false)
})

test('quiet hours that are off are off', () => {
  const at = new Date(2026, 8, 27, 3).getTime()
  assert.equal(inQuietHours(DEFAULT_NOTIFICATIONS, at), false)
  assert.equal(inQuietHours({ ...DEFAULT_NOTIFICATIONS, quietHours: { enabled: true, from: 'nonsense', to: '07:00' } }, at), false)
})

test('a category can be turned off, and one nobody decided about still speaks', () => {
  const noon = new Date(2026, 8, 27, 12).getTime()
  const config = { ...DEFAULT_NOTIFICATIONS, categories: { downloads: false } }
  assert.equal(mayNotify(config, 'downloads', noon), false)
  assert.equal(mayNotify(config, 'workflows', noon), true, 'a category never decided about is allowed')
})

// ---------------------------------------------------------------- reading rules in

test('rubbish is refused rather than half-read', () => {
  assert.equal(cleanRule(null, AT), null)
  assert.equal(cleanRule({ id: 'a', name: 'A' }, AT), null, 'a rule with no test is not a rule')
  assert.equal(cleanRule({ id: 'a', name: 'A', test: { source: 'x', field: 'y', operator: 'explodes' } }, AT), null)
  assert.deepEqual(cleanRules('not a list', AT), [])
})

test('a cooldown cannot silence a rule for ever', () => {
  const r = cleanRule({ id: 'a', name: 'A', cooldownMs: Number.MAX_SAFE_INTEGER, test: { source: 'x', field: 'y', operator: 'equals', value: 1 } }, AT)
  assert.ok(r)
  assert.ok(r.cooldownMs <= 24 * 60 * 60 * 1000)
})

test('deeply nested tests are refused rather than followed for ever', () => {
  let deep: unknown = { source: 'x', field: 'y', operator: 'equals', value: 1 }
  for (let i = 0; i < 12; i++) deep = { not: deep }
  const r = cleanRule({ id: 'a', name: 'A', test: deep }, AT)
  assert.equal(r, null)
})

test('the list is bounded and deduplicated', () => {
  const one = { id: 'same', name: 'A', test: { source: 'x', field: 'y', operator: 'equals', value: 1 } }
  assert.equal(cleanRules([one, { ...one, name: 'B' }], AT).length, 1)
  const many = Array.from({ length: MAX_RULES + 20 }, (_, i) => ({ ...one, id: `r${i}` }))
  assert.ok(cleanRules(many, AT).length <= MAX_RULES)
})
