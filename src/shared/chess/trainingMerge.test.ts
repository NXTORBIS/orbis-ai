import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { keepLocalChanges } from './trainingMerge.ts'
import { addAttempt, emptyStore, type TrainingAttempt, type TrainingStore } from './trainingView.ts'

const attempt = (id: string, at: number): TrainingAttempt => ({
  id,
  at,
  area: 'blindfold',
  item: 'locate',
  strict: true,
  verdict: 'Every question right.',
  passed: true,
  right: 5,
  outOf: 5
})

const withSettings = (store: TrainingStore, change: Partial<TrainingStore['settings']>): TrainingStore =>
  ({ ...store, settings: { ...store.settings, ...change } })

test('nothing changed while the read was in flight, so the file wins outright', () => {
  const loaded = withSettings(emptyStore(), { studySeconds: 45, mode: 'read-out' })
  const local = withSettings(emptyStore(), { studySeconds: 20 })
  assert.deepEqual(keepLocalChanges(loaded, local, false), loaded)
})

test('a setting changed during the read is kept, not undone by the file', () => {
  const loaded = withSettings(emptyStore(), { studySeconds: 20, mode: 'strict' })
  const local = withSettings(emptyStore(), { studySeconds: 15, mode: 'read-out' })
  const out = keepLocalChanges(loaded, local, true)
  assert.equal(out.settings.studySeconds, 15)
  assert.equal(out.settings.mode, 'read-out')
})

test('everything else in the file is kept when a setting is', () => {
  const loaded = addAttempt(emptyStore(), attempt('old', 1_000))
  const local = withSettings(emptyStore(), { questions: 9 })
  const out = keepLocalChanges(loaded, local, true)
  assert.deepEqual(out.attempts.map((one) => one.id), ['old'])
  assert.equal(out.settings.questions, 9)
})

test('a round finished during the read is added rather than lost', () => {
  const loaded = addAttempt(emptyStore(), attempt('old', 1_000))
  const local = addAttempt(emptyStore(), attempt('fresh', 2_000))
  const out = keepLocalChanges(loaded, local, true)
  assert.deepEqual(out.attempts.map((one) => one.id), ['old', 'fresh'])
})

test('a round that is in both is not added twice', () => {
  const loaded = addAttempt(emptyStore(), attempt('same', 1_000))
  const local = addAttempt(emptyStore(), attempt('same', 1_000))
  const out = keepLocalChanges(loaded, local, true)
  assert.equal(out.attempts.length, 1)
})

test('the version the file was read at is the one kept', () => {
  const loaded = { ...emptyStore(), version: 3 }
  const local = { ...emptyStore(), version: 1 }
  assert.equal(keepLocalChanges(loaded, local, true).version, 3)
})
