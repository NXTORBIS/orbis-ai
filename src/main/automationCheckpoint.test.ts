import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { describeCheckpoint, keepable, MAX_CHECKPOINTS, resumable, STALE_AFTER, type AutomationCheckpoint } from './automationCheckpoint.ts'
import type { AutomationState } from '../shared/types.ts'

/**
 * Workflows checkpoint every step and the scheduler survives being closed. Orion's own long automations did neither:
 * their state lived in memory, so Orbis closing mid-run lost the list of what had already been handled -- and for
 * anything that acts on a page, redoing it all is worse than not resuming at all.
 */

const NOW = new Date('2026-10-03T12:00:00').getTime()
const MIN = 60_000

const state = (patch: Partial<AutomationState> = {}): AutomationState => ({
  id: 'a1',
  kind: 'loop',
  objective: 'Collect the first fifty results',
  stopWhen: 'after 50 results',
  status: 'running',
  completed: 12,
  total: 50,
  unit: 'results',
  processed: ['one', 'two'],
  notes: [],
  actions: 30,
  startedAt: NOW - 10 * MIN,
  ...patch
})

const run = (patch: Partial<AutomationState> = {}, at = NOW): AutomationCheckpoint => ({ state: state(patch), at, conversationId: 'c1' })

test('a run that was going when Orbis closed can be picked up', () => {
  assert.equal(resumable(run({ status: 'running' }), NOW), true)
})

test('a run that was paused or stuck can be picked up', () => {
  assert.equal(resumable(run({ status: 'paused' }), NOW), true)
  assert.equal(resumable(run({ status: 'stuck' }), NOW), true)
})

test('a run that finished or was stopped is not offered, because there is nothing to pick up', () => {
  assert.deepEqual(keepable([run({ status: 'completed' }), run({ id: 'a2', status: 'stopped' })], NOW), [])
})

test('an old checkpoint is not offered, because the browser has moved on', () => {
  const old = run({ status: 'paused' }, NOW - STALE_AFTER - MIN)
  assert.equal(resumable(old, NOW), false)
  assert.deepEqual(keepable([old], NOW), [], 'and it is not kept either')
})

test('what it says is what really happened, in the words somebody would use', () => {
  const said = describeCheckpoint(run({ status: 'paused', completed: 12, total: 50 }, NOW - 5 * MIN), NOW)
  assert.ok(said.includes('12 of 50 results'), said)
  assert.ok(said.includes('5 minutes ago'), said)
  assert.ok(!/will|can resume|carry on/i.test(said), 'it describes, it does not promise')
})

test('a run with no total still says what it did rather than inventing one', () => {
  const said = describeCheckpoint(run({ status: 'paused', completed: 7, total: undefined }), NOW)
  assert.ok(said.includes('7 results'), said)
  assert.ok(!said.includes('of'), said)
})

test('the newest are kept and the rest go', () => {
  const many = Array.from({ length: MAX_CHECKPOINTS + 5 }, (_, i) => run({ id: `a${i}`, status: 'paused' }, NOW - i * MIN))
  const kept = keepable(many, NOW)
  assert.equal(kept.length, MAX_CHECKPOINTS)
  assert.equal(kept[0].state.id, 'a0')
})

test('one run has one checkpoint, however many times it moves', () => {
  const first = run({ id: 'same', status: 'running', completed: 1 }, NOW - MIN)
  const later = run({ id: 'same', status: 'running', completed: 9 }, NOW)
  // This is what the store does before writing: the old record for the same run is dropped first.
  const kept = keepable([later, ...[first].filter((one) => one.state.id !== later.state.id)], NOW)
  assert.equal(kept.length, 1)
  assert.equal(kept[0].state.completed, 9)
})

test('what was already processed survives, which is the whole point', () => {
  const kept = keepable([run({ status: 'paused', processed: ['result-3', 'result-4'] })], NOW)
  assert.deepEqual(kept[0].state.processed, ['result-3', 'result-4'])
})
