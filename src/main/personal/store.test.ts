import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { promises as fs } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JsonFile, personalFile } from './store.ts'

/**
 * Every store in Orbis is built on this one file, so two things have to be true of it: a file it cannot read is never
 * written over, and what it writes is readable by this account only.
 */

const here = async (): Promise<string> => mkdtemp(join(tmpdir(), 'orbis-jsonfile-'))

interface Thing {
  kept: number
}

const file = (path: string): JsonFile<Thing> => new JsonFile<Thing>(path, () => ({ kept: 0 }), (raw) => raw as Thing)

test('what was saved comes back', async () => {
  const dir = await here()
  const one = file(join(dir, 'thing.json'))
  await one.write({ kept: 7 })
  await one.flush()
  assert.deepEqual(await file(join(dir, 'thing.json')).read(), { kept: 7 })
})

test('a file that cannot be read is never written over, and what is pending is not thrown away', async () => {
  const dir = await here()
  const path = join(dir, 'held.json')
  // A directory where a file is expected cannot be read, and fails with something other than "there is no file".
  await fs.mkdir(path)

  const one = file(path)
  assert.deepEqual(await one.read(), { kept: 0 }, 'it carries on from defaults rather than refusing to start')
  assert.ok(one.problem()?.includes('nothing has been written over it'), one.problem() ?? 'nothing said')

  await one.write({ kept: 3 })
  await one.flush()
  const still = await fs.stat(path)
  assert.equal(still.isDirectory(), true, 'what was there is still there')

  // The lock clears: the same store, told to save again, now saves -- so refusing cost nothing.
  await fs.rmdir(path)
  await one.write({ kept: 4 })
  await one.flush()
  assert.deepEqual(JSON.parse(await fs.readFile(path, 'utf8')), { kept: 4 })
})

test('a file Orbis cannot make sense of is moved aside, not deleted', async () => {
  const dir = await here()
  const path = join(dir, 'broken.json')
  await fs.writeFile(path, '{ not json at all')
  const one = file(path)
  assert.deepEqual(await one.read(), { kept: 0 })
  assert.ok(one.problem()?.includes('Nothing was deleted'), one.problem() ?? 'nothing said')
  const moved = (await fs.readdir(dir)).filter((name) => name.includes('.unreadable-'))
  assert.equal(moved.length, 1, 'the original words are still on the disk')
  await one.write({ kept: 1 })
  await one.flush()
  assert.deepEqual(JSON.parse(await fs.readFile(path, 'utf8')), { kept: 1 }, 'and a fresh one was written')
})

test('each profile has its own file, so nothing personal is shared between them', () => {
  const work = personalFile('C:/data', 'work', 'clipboard.json')
  const home = personalFile('C:/data', 'default', 'clipboard.json')
  assert.notEqual(work, home, 'the clipboard used to leave the profile out of the path, so every profile shared one')
  assert.ok(work.includes('clipboard.json'))
})

test('a write still pending when the profile changes lands in the profile it came from', async () => {
  const dir = await here()
  const one = file(join(dir, 'a.json'))
  await one.write({ kept: 11 })
  await one.usePath(join(dir, 'b.json'))
  await one.flush()
  assert.deepEqual(JSON.parse(await fs.readFile(join(dir, 'a.json'), 'utf8')), { kept: 11 })
  assert.deepEqual(await one.read(), { kept: 0 }, 'and the new file starts empty rather than inheriting')
})
