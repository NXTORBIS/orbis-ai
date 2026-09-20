import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canRemove, dataDirFor, defaultProfile, DEFAULT_PROFILE_ID, newProfile, normalizeProfile, sortProfiles } from '../shared/profiles.ts'

test('the first profile keeps Orbis’s original data folder; others get their own', () => {
  assert.equal(dataDirFor(DEFAULT_PROFILE_ID), '.')
  assert.equal(dataDirFor('abc'), 'profiles/abc')
  assert.equal(defaultProfile().id, DEFAULT_PROFILE_ID)
})

test('a new profile takes its mark from its name', () => {
  assert.equal(newProfile({ name: 'work stuff' }).initial, 'W')
  assert.equal(newProfile({ name: '   ' }).name, 'New profile')
  assert.equal(newProfile({ name: 'Émile' }).initial, 'É')
})

test('stored profiles are checked, and the first one is always shown first', () => {
  assert.equal(normalizeProfile({ id: 'ok', name: '  Work  ', color: 'periwinkle' })?.color, '#3fd8ff')
  assert.equal(normalizeProfile({ id: 'ok', name: '  Work  ' })?.name, 'Work')
  assert.equal(normalizeProfile({ id: 'has space', name: 'Bad' }), null, 'an id that could not be a folder is refused')
  assert.equal(normalizeProfile({ name: 'no id' }), null)
  const order = sortProfiles([newProfile({ id: 'b', order: 2 }), newProfile({ id: DEFAULT_PROFILE_ID, order: 9 }), newProfile({ id: 'a', order: 1 })])
  assert.deepEqual(order.map((p) => p.id), [DEFAULT_PROFILE_ID, 'a', 'b'])
})

test('a profile cannot be deleted while it is in use, and the first one never can', () => {
  const work = newProfile({ id: 'work', name: 'Work' })
  assert.deepEqual(canRemove(defaultProfile(), false, 2), { allowed: false, reason: 'The first profile cannot be deleted.' })
  assert.deepEqual(canRemove(work, true, 2), { allowed: false, reason: 'Switch to another profile before deleting this one.' })
  assert.deepEqual(canRemove(work, false, 2), { allowed: true })
})
