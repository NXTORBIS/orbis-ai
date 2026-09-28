import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  describeCondition,
  isWatchable,
  NEEDS_NO_VALUE,
  OPERATORS_FOR,
  OPERATOR_LABELS,
  WATCHABLE,
  watchableField,
  watchableSource
} from './watchable.ts'
import { workflowReadings } from '../main/ruleWatcher.ts'
import { testHolds } from './rules.ts'

test('everything offered is something Orbis reports', () => {
  // The contract this file exists for: the watcher fills these readings, so a rule built from this list can fire.
  // A run with every field set, so the shapes can be compared rather than guessed at.
  const now = workflowReadings([
    {
      state: {
        name: 'Research Report',
        status: 'running',
        stepIndex: 3,
        stepCount: 10,
        waitingFor: { kind: 'user' }
      }
    }
  ])
  for (const source of WATCHABLE) {
    const reported = now[source.name]
    assert.ok(reported, `nothing reports ${source.name}`)
    for (const field of source.fields) {
      assert.notEqual(reported[field.name], undefined, `${source.name}.${field.name} is offered but never reported`)
    }
  }
})

test('what a field is decides how it may be compared', () => {
  const status = watchableField('workflow', 'status')!
  assert.equal(status.kind, 'state')
  assert.ok(isWatchable('workflow', 'status', 'equals'))
  assert.ok(!isWatchable('workflow', 'status', 'greaterThan'), 'a state is not a number')

  const progress = watchableField('workflow', 'progress')!
  assert.equal(progress.kind, 'number')
  assert.ok(isWatchable('workflow', 'progress', 'greaterThanOrEqual'))
  assert.ok(!isWatchable('workflow', 'progress', 'contains'), 'a number does not contain things')
})

test('a source or field nobody reports is not watchable', () => {
  assert.equal(watchableSource('download'), null)
  assert.equal(watchableField('workflow', 'temperature'), null)
  assert.ok(!isWatchable('download', 'status', 'equals'))
  assert.ok(!isWatchable('workflow', 'temperature', 'equals'))
})

test('every comparison offered has a word for it', () => {
  for (const operators of Object.values(OPERATORS_FOR)) {
    for (const op of operators) assert.ok(OPERATOR_LABELS[op], `${op} has no label`)
  }
})

test('a condition reads as a sentence', () => {
  assert.equal(describeCondition('workflow', 'status', 'equals', 'succeeded'), 'Workflows: Status is succeeded')
  assert.equal(describeCondition('workflow', 'progress', 'greaterThanOrEqual', 80), 'Workflows: Progress is at least 80%')
  assert.equal(describeCondition('workflow', 'status', 'changes'), 'Workflows: Status changes')
})

test('a comparison against the reading before takes no value', () => {
  for (const op of NEEDS_NO_VALUE) {
    assert.ok(!describeCondition('workflow', 'progress', op, 5).includes('5'), `${op} should not show a value`)
  }
})

test('the states offered for a state field are ones a rule can match', () => {
  const status = watchableField('workflow', 'status')!
  assert.ok(status.states && status.states.length > 0)
  const now = workflowReadings([{ state: { name: 'A', status: 'succeeded', stepIndex: 1, stepCount: 2 } }])
  assert.ok(
    status.states.includes('succeeded'),
    'the engine reports "succeeded", so it must be one of the choices'
  )
  assert.equal(
    testHolds({ source: 'workflow', field: 'status', operator: 'equals', value: 'succeeded' }, now),
    true,
    'and choosing it makes a condition that really holds'
  )
})

test('an unknown source or field is described rather than hidden', () => {
  // A rule may outlive what it watched. It still has to be showable.
  assert.equal(describeCondition('download', 'status', 'equals', 'complete'), 'download: status is complete')
})
