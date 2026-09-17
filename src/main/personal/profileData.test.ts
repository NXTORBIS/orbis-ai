import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Collection, personalFile } from './store.ts'

type Item = { id: string; title: string }
const normalize = (raw: unknown): Item | null => (raw && typeof (raw as Item).id === 'string' ? (raw as Item) : null)

test('personal data belongs to the profile in use, and the default profile keeps the files it always had', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'orbis-personal-'))
  try {
    assert.equal(personalFile(dir, 'default', 'notes.json'), join(dir, '.', 'personal', 'notes.json'))
    const notes = new Collection<Item>(personalFile(dir, 'default', 'notes.json'), normalize)
    let told = 0
    notes.onChange(() => told++)
    await notes.put({ id: 'a', title: 'Default note' })

    // Switching straight after a change: the pending write must land in the default profile, not the new one.
    await notes.usePath(personalFile(dir, 'work', 'notes.json'))
    assert.ok(existsSync(join(dir, 'personal', 'notes.json')))
    assert.deepEqual(await notes.all(), [], 'the work profile sees none of the default notes')
    assert.ok(told >= 2, 'whatever shows notes is told everything changed')

    await notes.put({ id: 'b', title: 'Work note' })
    await notes.usePath(personalFile(dir, 'default', 'notes.json'))
    assert.deepEqual((await notes.all()).map((n) => n.title), ['Default note'])

    const reopened = new Collection<Item>(personalFile(dir, 'work', 'notes.json'), normalize)
    assert.deepEqual((await reopened.all()).map((n) => n.title), ['Work note'], 'the work note was saved to the work profile on disk')
    assert.ok(existsSync(join(dir, 'profiles', 'work', 'personal', 'notes.json')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
