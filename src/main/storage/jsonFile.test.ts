import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Collection, JsonFile, personalFile, profileFile } from './jsonFile.ts'

/**
 * The store the rest of Orbis is built on, and the two things that were added when it moved here.
 *
 * What is being checked is the behaviour that only shows itself when something goes wrong: a file written by a
 * newer Orbis, a file written before versioning existed, and a file that cannot be read at all. Each of those has
 * exactly one right answer and three plausible wrong ones, and the wrong ones all end in somebody's data being
 * replaced by defaults.
 */

const dir = (): string => mkdtempSync(join(tmpdir(), 'orbis-store-'))

interface Thing {
  name: string
  count: number
}

const parseThing = (raw: unknown): Thing => {
  const one = (raw ?? {}) as Record<string, unknown>
  return { name: typeof one.name === 'string' ? one.name : '', count: typeof one.count === 'number' ? one.count : 0 }
}

describe('a small JSON store', () => {
  it('writes what it was given and reads it back', async () => {
    const path = join(dir(), 'thing.json')
    const file = new JsonFile<Thing>(path, () => ({ name: '', count: 0 }), parseThing)
    await file.write({ name: 'a thing', count: 3 })
    await file.flush()

    const again = new JsonFile<Thing>(path, () => ({ name: '', count: 0 }), parseThing)
    assert.deepEqual(await again.read(), { name: 'a thing', count: 3 })
  })

  it('a file that is not there is not a file that could not be read', async () => {
    const path = join(dir(), 'missing.json')
    const file = new JsonFile<Thing>(path, () => ({ name: 'default', count: 0 }), parseThing)
    assert.deepEqual(await file.read(), { name: 'default', count: 0 })
    assert.equal(file.problem(), null)
    // Missing means it may be written, so the defaults land on disk.
    await file.write({ name: 'written', count: 1 })
    await file.flush()
    assert.match(await fs.readFile(path, 'utf8'), /written/)
  })

  it('moves a file it cannot make sense of aside rather than over', async () => {
    const path = join(dir(), 'damaged.json')
    await fs.writeFile(path, '{ this is not json', 'utf8')
    const file = new JsonFile<Thing>(path, () => ({ name: 'default', count: 0 }), parseThing)
    assert.deepEqual(await file.read(), { name: 'default', count: 0 })
    assert.match(String(file.problem()), /could not make sense/)

    // The words are still on the disk, under a name that says what happened.
    const beside = (await fs.readdir(join(path, '..'))).filter((one) => one.includes('unreadable'))
    assert.equal(beside.length, 1)
    assert.match(await fs.readFile(join(path, '..', beside[0]), 'utf8'), /this is not json/)
  })

  it('writes nothing over a file written by a newer Orbis', async () => {
    /*
     * The case versioning exists for. A file saying it is version 9 was written by an Orbis that knows a shape this
     * one does not. Reading it anyway means dropping the fields this version does not recognise and writing the
     * result back, which turns somebody's data into a worse copy of itself the first time they open an older Orbis.
     */
    const path = join(dir(), 'newer.json')
    await fs.writeFile(path, JSON.stringify({ v: 9, data: { name: 'from the future', count: 99, andMore: true } }), 'utf8')

    const file = new JsonFile<Thing>(path, () => ({ name: 'default', count: 0 }), parseThing, { version: 2 })
    assert.deepEqual(await file.read(), { name: 'default', count: 0 })
    // Moved aside, not overwritten, and the original words survive under the new name.
    const beside = (await fs.readdir(join(path, '..'))).filter((one) => one.includes('unreadable'))
    assert.equal(beside.length, 1)
    assert.match(await fs.readFile(join(path, '..', beside[0]), 'utf8'), /from the future/)
  })

  it('reads a file written before versioning existed as version one', async () => {
    const path = join(dir(), 'old.json')
    await fs.writeFile(path, JSON.stringify({ name: 'written long ago', count: 2 }), 'utf8')

    const seen: number[] = []
    const file = new JsonFile<Thing>(path, () => ({ name: '', count: 0 }), parseThing, {
      version: 3,
      migrate: (raw, from) => {
        seen.push(from)
        const one = (raw ?? {}) as Record<string, unknown>
        return { ...one, count: Number(one.count ?? 0) * 10 }
      }
    })
    assert.deepEqual(await file.read(), { name: 'written long ago', count: 20 })
    assert.deepEqual(seen, [1], 'a file with no version on it is version one')
  })

  it('brings an older wrapped file forward, and says which version it came from', async () => {
    const path = join(dir(), 'v2.json')
    await fs.writeFile(path, JSON.stringify({ v: 2, data: { name: 'two', count: 5 } }), 'utf8')

    const seen: number[] = []
    const file = new JsonFile<Thing>(path, () => ({ name: '', count: 0 }), parseThing, {
      version: 4,
      migrate: (raw, from) => {
        seen.push(from)
        return raw
      }
    })
    assert.deepEqual(await file.read(), { name: 'two', count: 5 })
    assert.deepEqual(seen, [2])

    // And what it writes back says which version wrote it.
    await file.write({ name: 'two', count: 6 })
    await file.flush()
    assert.deepEqual(JSON.parse(await fs.readFile(path, 'utf8')), { v: 4, data: { name: 'two', count: 6 } })
  })

  it('a store with no version writes the old shape, so an older Orbis can still read it', async () => {
    const path = join(dir(), 'plain.json')
    const file = new JsonFile<Thing>(path, () => ({ name: '', count: 0 }), parseThing)
    await file.write({ name: 'plain', count: 1 })
    await file.flush()
    assert.deepEqual(JSON.parse(await fs.readFile(path, 'utf8')), { name: 'plain', count: 1 })
  })

  it('a write queued before a profile switch lands in the profile it came from', async () => {
    /*
     * The invariant that keeps one person's notes out of another's folder. The path is taken when the write starts,
     * not when it was queued, so moving to another profile mid-write cannot redirect it.
     */
    const base = dir()
    const mine = join(base, 'mine.json')
    const theirs = join(base, 'theirs.json')
    const file = new JsonFile<Thing>(mine, () => ({ name: '', count: 0 }), parseThing)
    await file.write({ name: 'mine', count: 1 })
    await file.usePath(theirs)

    assert.match(await fs.readFile(mine, 'utf8'), /mine/)
    await assert.rejects(() => fs.readFile(theirs, 'utf8'))
  })
})

describe('a list of things with ids', () => {
  interface Row {
    id: string
    label: string
  }
  const clean = (raw: unknown): Row | null => {
    const one = (raw ?? {}) as Record<string, unknown>
    return typeof one.id === 'string' && one.id ? { id: one.id, label: typeof one.label === 'string' ? one.label : '' } : null
  }

  it('adds, replaces, removes and keeps to its limit', async () => {
    const list = new Collection<Row>(join(dir(), 'rows.json'), clean, 3)
    await list.put({ id: 'a', label: 'first' })
    await list.put({ id: 'b', label: 'second' })
    await list.put({ id: 'a', label: 'first again' })
    assert.equal((await list.all()).length, 2)
    assert.equal((await list.get('a'))?.label, 'first again')

    await list.put({ id: 'c', label: 'third' })
    await list.put({ id: 'd', label: 'fourth' })
    assert.equal((await list.all()).length, 3, 'the limit holds')

    assert.equal(await list.remove('c'), true)
    assert.equal(await list.remove('never-there'), false)
  })

  it('refuses an item that is missing what it needs, rather than storing half of it', async () => {
    const list = new Collection<Row>(join(dir(), 'rows.json'), clean)
    await assert.rejects(() => list.put({ label: 'no id' }))
    assert.equal((await list.all()).length, 0)
  })

  it('tells whoever is listening when it changes', async () => {
    const list = new Collection<Row>(join(dir(), 'rows.json'), clean)
    let told = 0
    const stop = list.onChange(() => (told += 1))
    await list.put({ id: 'a', label: 'one' })
    await list.remove('a')
    stop()
    await list.put({ id: 'b', label: 'two' })
    assert.equal(told, 2, 'and stops telling when it is asked to')
  })
})

describe('where a profile’s files go', () => {
  it('the default profile keeps the folders it always had', () => {
    assert.equal(personalFile('/data', 'default', 'notes.json').replace(/\\/g, '/'), '/data/personal/notes.json')
    assert.equal(profileFile('/data', 'default', 'choose', 'decisions.json').replace(/\\/g, '/'), '/data/choose/decisions.json')
  })

  it('another profile keeps its own, and never sees the first’s', () => {
    const work = profileFile('/data', 'work', 'choose', 'decisions.json').replace(/\\/g, '/')
    assert.notEqual(work, profileFile('/data', 'default', 'choose', 'decisions.json').replace(/\\/g, '/'))
    assert.match(work, /work/)
  })
})
