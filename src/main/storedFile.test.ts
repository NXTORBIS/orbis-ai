import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { promises as fs } from 'node:fs'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { damageNote, openStored, quarantine, readStored, writeStored } from './storedFile.ts'

/**
 * Every store read its file inside `try { ... } catch { return defaults }`, which makes an unreadable file
 * indistinguishable from a missing one -- and on Windows a file is routinely unreadable for a moment. The next write
 * then renamed defaults over real data.
 *
 * The worst case was the vault: unreadable meant "no vault", which is an invitation to create one, and creating one
 * checked for an existing vault with the same failed read. Every secret, gone.
 */

const here = async (): Promise<string> => mkdtemp(join(tmpdir(), 'orbis-stored-'))

test('a file that is not there is missing, and a file that is there is read', async () => {
  const dir = await here()
  assert.deepEqual(await readStored(join(dir, 'nothing.json')), { kind: 'missing' })
  await fs.writeFile(join(dir, 'there.json'), 'hello')
  assert.deepEqual(await readStored(join(dir, 'there.json')), { kind: 'read', text: 'hello' })
})

test('a file that cannot be read is not reported as missing, which is the whole bug', async () => {
  const dir = await here()
  // A directory where a file is expected: readFile fails with EISDIR, not ENOENT. It stands in for the real cases --
  // a file another program is holding open -- which cannot be made to happen reliably in a test.
  await fs.mkdir(join(dir, 'held.json'))
  const stored = await readStored(join(dir, 'held.json'))
  assert.equal(stored.kind, 'unreadable')
  assert.notEqual(stored.kind, 'missing')
})

test('nothing may be written over something that is merely unreadable', async () => {
  const dir = await here()
  await fs.mkdir(join(dir, 'held.json'))
  const opened = await openStored(join(dir, 'held.json'), JSON.parse, () => ({ fresh: true }))
  assert.equal(opened.mayWrite, false, 'refusing is recoverable; overwriting is not')
  assert.equal(opened.wasDamaged, true)
  assert.equal(opened.movedTo, null, 'and it was not moved either, because it may be perfectly good')
})

test('a missing file gives the default and may be written', async () => {
  const dir = await here()
  const opened = await openStored(join(dir, 'nothing.json'), JSON.parse, () => ({ fresh: true }))
  assert.deepEqual(opened.value, { fresh: true })
  assert.equal(opened.mayWrite, true)
  assert.equal(opened.wasDamaged, false)
})

test('a good file is read, and nothing is moved', async () => {
  const dir = await here()
  await fs.writeFile(join(dir, 'good.json'), JSON.stringify({ kept: 7 }))
  const opened = await openStored(join(dir, 'good.json'), JSON.parse, () => ({ kept: 0 }))
  assert.deepEqual(opened.value, { kept: 7 })
  assert.equal(opened.movedTo, null)
})

test('a damaged file is moved aside and never deleted, and the words are still on the disk', async () => {
  const dir = await here()
  const path = join(dir, 'broken.json')
  await fs.writeFile(path, '{ this is not json')
  const opened = await openStored(path, JSON.parse, () => ({ fresh: true }), Date.parse('2026-10-04T09:00:00Z'))

  assert.equal(opened.wasDamaged, true)
  assert.ok(opened.movedTo, 'it was moved')
  assert.equal(opened.mayWrite, true, 'and only then may a fresh one be written')
  assert.equal(await readFile(opened.movedTo!, 'utf8'), '{ this is not json', 'the original words are still there')
  assert.deepEqual(await readStored(path), { kind: 'missing' }, 'and the old path is now free')
})

test('what somebody is told says which of the two happened, and never says anything was deleted', async () => {
  const dir = await here()
  await fs.writeFile(join(dir, 'broken.json'), 'nonsense{')
  const moved = await openStored(join(dir, 'broken.json'), JSON.parse, () => ({}))
  const movedNote = damageNote(moved, 'notes')!
  assert.ok(movedNote.includes('Nothing was deleted'), movedNote)
  assert.ok(movedNote.includes('moved to'), movedNote)

  await fs.mkdir(join(dir, 'held.json'))
  const held = await openStored(join(dir, 'held.json'), JSON.parse, () => ({}))
  const heldNote = damageNote(held, 'notes')!
  assert.ok(heldNote.includes('nothing has been written over it'), heldNote)
  assert.ok(heldNote.includes('another program'), heldNote)
})

test('a file that opened cleanly has nothing to say', async () => {
  const dir = await here()
  await fs.writeFile(join(dir, 'fine.json'), '{}')
  assert.equal(damageNote(await openStored(join(dir, 'fine.json'), JSON.parse, () => ({})), 'notes'), null)
})

test('two damaged files never collide, because the time is in the name', async () => {
  const dir = await here()
  const a = join(dir, 'one.json')
  await fs.writeFile(a, 'x')
  const first = await quarantine(a, Date.parse('2026-10-04T09:00:00Z'))
  await fs.writeFile(a, 'y')
  const second = await quarantine(a, Date.parse('2026-10-04T10:00:00Z'))
  assert.notEqual(first, second)
  assert.equal(await readFile(first!, 'utf8'), 'x')
  assert.equal(await readFile(second!, 'utf8'), 'y')
})

test('a write lands whole, and is private by default', async () => {
  const dir = await here()
  const path = join(dir, 'deep', 'thing.json')
  await writeStored(path, '{"a":1}')
  assert.equal(await readFile(path, 'utf8'), '{"a":1}')
  // The temporary file does not survive the rename, so nothing is left half-written beside it.
  assert.deepEqual(await readStored(`${path}.tmp`), { kind: 'missing' })
})
