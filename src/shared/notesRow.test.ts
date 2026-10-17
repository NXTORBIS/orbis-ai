import { test } from 'node:test'
import assert from 'node:assert/strict'
import { capabilityById, searchCapabilities } from './commandCenter.ts'
import type { Readiness } from './commandCenter.ts'

/** Everything available, so a search result is about the words and not about what is switched on. */
const all: Readiness = { browser: true, task: true, helper: true, key: true, page: true }

/*
 * The row in the wordmark menu that opens the microphone recorder.
 *
 * It used to read "Notes -- Notes kept in Orbis" with the words note, write and jot, so the menu promised a notepad
 * and the screen behind it was a recorder that listens to this computer and writes down what it heard. Somebody
 * looking for somewhere to jot a line down would open it, see a record button, and have been lied to by a menu.
 */

test('the notes row says the screen listens, not that it keeps written notes', () => {
  const notes = capabilityById('notes')
  assert.ok(notes, 'the notes capability is missing')
  const said = `${notes.name} ${notes.description}`.toLowerCase()
  assert.ok(/listen|said|hear|spoken/.test(said), `the row still does not say what the screen does: ${said}`)
  assert.ok(!/kept in orbis/.test(said), 'the row still describes a notepad')
  assert.ok(!notes.keywords.includes('jot'), 'the row is still offered to somebody wanting to jot something down')
})

test('typing notes still finds it first, and so does typing meeting', () => {
  assert.equal(searchCapabilities('notes', all)[0]?.capability.id, 'notes')
  assert.equal(searchCapabilities('meeting', all)[0]?.capability.id, 'notes')
})
