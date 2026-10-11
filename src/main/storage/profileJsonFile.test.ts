import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProfileJsonFile } from './profileJsonFile.ts'

/**
 * One file per profile, and the four rules it exists to keep in one place.
 *
 * Every case here is a way somebody loses data quietly. A file that is briefly unreadable being replaced by
 * defaults. A save that was refused being reported as a save. A profile switch sending one person's work into
 * another's folder. Quitting overwriting something nobody understood. Each had its own copy of the answer in four
 * stores, and a copy is a place for one of them to be subtly different.
 */

interface Held {
  items: string[]
}

const dir = (): string => mkdtempSync(join(tmpdir(), 'orbis-profiles-'))

function store(root: string, delayMs = 10): ProfileJsonFile<Held> {
  return new ProfileJsonFile<Held>({
    fileFor: (profileId) => join(root, profileId, 'thing.json'),
    empty: () => ({ items: [] }),
    parse: (text) => {
      const raw = JSON.parse(text) as { items?: unknown }
      if (!Array.isArray(raw.items)) throw new Error('not a thing')
      return { items: raw.items.filter((one): one is string => typeof one === 'string') }
    },
    delayMs
  })
}

describe('one file per profile', () => {
  it('keeps each profile apart, on disk and in memory', async () => {
    const root = dir()
    const held = store(root)
    await held.change('default', (one) => one.items.push('mine'))
    await held.change('work', (one) => one.items.push('theirs'))
    await held.flush()

    assert.deepEqual((await held.read('default')).items, ['mine'])
    assert.deepEqual((await held.read('work')).items, ['theirs'])
    assert.match(await fs.readFile(join(root, 'default', 'thing.json'), 'utf8'), /mine/)
    assert.match(await fs.readFile(join(root, 'work', 'thing.json'), 'utf8'), /theirs/)
    // And neither file knows about the other.
    assert.doesNotMatch(await fs.readFile(join(root, 'default', 'thing.json'), 'utf8'), /theirs/)
  })

  it('a profile with no file yet starts empty, and each one gets its own empty', async () => {
    const held = store(dir())
    const one = await held.read('a')
    const two = await held.read('b')
    one.items.push('only a')
    assert.deepEqual(two.items, [], 'two profiles must not share one array')
  })

  it('writes shortly after a change rather than on every change', async () => {
    const root = dir()
    const held = store(root, 60)
    await held.change('default', (one) => one.items.push('one'))
    await held.change('default', (one) => one.items.push('two'))
    await held.change('default', (one) => one.items.push('three'))
    await held.flush()
    assert.deepEqual(JSON.parse(await fs.readFile(join(root, 'default', 'thing.json'), 'utf8')).items, ['one', 'two', 'three'])
  })

  it('moves a damaged file aside before writing anything, so the words survive', async () => {
    const root = dir()
    await fs.mkdir(join(root, 'default'), { recursive: true })
    await fs.writeFile(join(root, 'default', 'thing.json'), '{ half a fi', 'utf8')

    const held = store(root)
    assert.deepEqual((await held.read('default')).items, [], 'the application keeps working')
    // Moved aside means it may now be written.
    assert.equal(held.writable('default'), true)
    const beside = (await fs.readdir(join(root, 'default'))).filter((one) => one.includes('unreadable'))
    assert.equal(beside.length, 1)
    assert.match(await fs.readFile(join(root, 'default', beside[0]), 'utf8'), /half a fi/)
  })

  it('refuses a change to a file it could not read, before anything is changed', async () => {
    /*
     * The failure this is really for. A read that only gets shown can hand back defaults. A read that is about to
     * be followed by a save cannot: the save will be refused, and by then the caller has already returned the new
     * favourite and `true`, so the screen says it saved and nothing was written.
     *
     * A directory standing where the file should be is the cheapest way to get a file that exists and cannot be
     * read -- the real cause on Windows is a handle somebody else holds, which is not something a test can arrange
     * reliably, and `storedFile.ts` treats every read failure that is not "there is no file" the same way.
     */
    const root = dir()
    const held = store(root)
    await fs.mkdir(join(root, 'default', 'thing.json'), { recursive: true })

    // It still answers, so nothing in the application stops working.
    assert.deepEqual((await held.read('default')).items, [])
    assert.equal(held.writable('default'), false)

    // But a change is refused, in words, before anything has been changed.
    await assert.rejects(
      () => held.change('default', (one) => one.items.push('should not happen')),
      /could not make sense|left exactly as it is/
    )
    await assert.rejects(() => held.forWrite('default'))

    // And nothing was written over it, by the timer or by quitting.
    held.touch('default')
    await held.flush()
    held.flushSync()
    const stat = await fs.stat(join(root, 'default', 'thing.json'))
    assert.equal(stat.isDirectory(), true, 'what was there is still there')
  })

  it('says what it was told to say when a change is refused', async () => {
    const root = dir()
    const held = new ProfileJsonFile<Held>({
      fileFor: (profileId) => join(root, profileId, 'thing.json'),
      empty: () => ({ items: [] }),
      parse: (text) => JSON.parse(text) as Held,
      refusal: (profileId) => `Your markets for ${profileId} could not be read.`
    })
    await fs.mkdir(join(root, 'default', 'thing.json'), { recursive: true })
    await assert.rejects(() => held.forWrite('default'), /Your markets for default could not be read/)
  })

  it('says a file could not be read rather than quietly starting again', async () => {
    const root = dir()
    const path = join(root, 'default', 'thing.json')
    await fs.mkdir(join(root, 'default'), { recursive: true })
    await fs.writeFile(path, 'not json at all', 'utf8')

    const held = store(root)
    await held.read('default')
    // It was damaged and was moved aside, so it is writable now and the next save lands.
    await held.change('default', (one) => one.items.push('after'))
    await held.flush()
    assert.deepEqual(JSON.parse(await fs.readFile(path, 'utf8')).items, ['after'])
  })

  it('an interrupted write leaves the old file, never half of a new one', async () => {
    const root = dir()
    const held = store(root)
    await held.change('default', (one) => one.items.push('first'))
    await held.flush()

    await held.change('default', (one) => one.items.push('second'))
    await held.flush()
    // Nothing beside it is left behind.
    const left = await fs.readdir(join(root, 'default'))
    assert.deepEqual(left, ['thing.json'])
  })

  it('writes everything pending at the very end, without waiting', async () => {
    const root = dir()
    const held = store(root, 100_000)
    await held.change('default', (one) => one.items.push('urgent'))
    await held.change('work', (one) => one.items.push('also urgent'))
    held.flushSync()
    assert.deepEqual(JSON.parse(await fs.readFile(join(root, 'default', 'thing.json'), 'utf8')).items, ['urgent'])
    assert.deepEqual(JSON.parse(await fs.readFile(join(root, 'work', 'thing.json'), 'utf8')).items, ['also urgent'])
  })

  it('forgetting a profile writes what is pending first, then reads the file afresh', async () => {
    const root = dir()
    const held = store(root, 100_000)
    await held.change('default', (one) => one.items.push('kept'))
    await held.forget('default')
    assert.deepEqual(JSON.parse(await fs.readFile(join(root, 'default', 'thing.json'), 'utf8')).items, ['kept'])
    assert.deepEqual((await held.read('default')).items, ['kept'], 'and comes back from the file')
  })

  it('two things asking at once open the file once', async () => {
    /*
     * A screen opening while a background job finishes is ordinary, and without this both would open the file.
     * For a damaged file that means quarantining it twice -- and the second rename finds nothing there, reports
     * that it could not be moved, and a file that was actually saved is marked as one that may not be written.
     */
    const root = dir()
    await fs.mkdir(join(root, 'default'), { recursive: true })
    await fs.writeFile(join(root, 'default', 'thing.json'), 'not json', 'utf8')

    let opened = 0
    const held = new ProfileJsonFile<Held>({
      fileFor: (profileId) => join(root, profileId, 'thing.json'),
      empty: () => ({ items: [] }),
      parse: (text) => {
        opened += 1
        return JSON.parse(text) as Held
      }
    })
    const [one, two] = await Promise.all([held.read('default'), held.read('default')])
    assert.equal(opened, 1, 'the file was parsed once')
    assert.equal(one, two, 'and both got the same value')
    // One quarantined file, not two attempts at one.
    const beside = (await fs.readdir(join(root, 'default'))).filter((name) => name.includes('unreadable'))
    assert.equal(beside.length, 1)
    assert.equal(held.writable('default'), true, 'it was moved aside, so it may be written')
  })

  it('remembers what went wrong, in words, and stops saying so once it reads cleanly', async () => {
    const root = dir()
    await fs.mkdir(join(root, 'default'), { recursive: true })
    await fs.writeFile(join(root, 'default', 'thing.json'), 'not json', 'utf8')

    const held = store(root)
    await held.read('default')
    assert.match(String(held.problem('default')), /could not make sense/)
    assert.equal(held.problem('work'), null, 'nothing went wrong for a profile nobody has opened')

    await held.change('default', (one) => one.items.push('fresh'))
    await held.flush()
    held.drop('default')
    await held.read('default')
    assert.equal(held.problem('default'), null, 'yesterday’s damage is not reported for ever')
  })

  it('says whether a profile may be written, and not before it has looked', () => {
    const held = store(dir())
    assert.equal(held.writable('default'), null, 'nothing is known until the file has been looked at')
  })

  it('writes with its own text when it is given one', async () => {
    const root = dir()
    const held = new ProfileJsonFile<Held>({
      fileFor: (profileId) => join(root, profileId, 'thing.json'),
      empty: () => ({ items: [] }),
      parse: (text) => JSON.parse(text) as Held,
      write: (value) => JSON.stringify(value, null, 1),
      delayMs: 10
    })
    await held.change('default', (one) => one.items.push('pretty'))
    await held.flush()
    assert.match(await fs.readFile(join(root, 'default', 'thing.json'), 'utf8'), /\n/, 'written the way it asked')
  })
})
