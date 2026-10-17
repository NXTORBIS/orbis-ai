import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ARCADE_FILES, ArcadeStore } from './arcadeStore.ts'
import { emptyKept, type KeptArcade } from '../../shared/games/kept.ts'

/**
 * Where the arcade's scores live, now that they belong to a person rather than to a window.
 *
 * What is checked here is not that it saves and loads. It is the behaviour that only shows itself when something has
 * gone wrong, because this file holds however long somebody has been playing for and every way a store has ever lost
 * somebody's data looks the same from the inside: it could not read what was there, decided that meant there was
 * nothing there, and wrote its defaults on top.
 *
 * So each test below is one of those ways:
 *
 *   - a file that makes no sense is moved aside and its words are still on the disk;
 *   - a file that cannot be read at all is not written to at all, and the save says so rather than claiming it saved;
 *   - a save queued just before the profile changes lands in the profile it came from;
 *   - a save queued microseconds before the process ends is on the disk;
 *   - a field this version has never heard of survives a trip out and back;
 *   - a value the window sent that is not a record costs nothing of what is held.
 */

const where = (): string => mkdtempSync(join(tmpdir(), 'orbis-arcade-'))

/** Where one profile's file is. The default profile keeps the folder it always had. */
const fileIn = (base: string, profileId: string): string =>
  profileId === 'default' ? join(base, 'personal', 'arcade.json') : join(base, 'profiles', profileId, 'personal', 'arcade.json')

/** Puts a file where the store is about to look, which is the only way to test what it does with a bad one. */
const write = (path: string, text: string): void => {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text, 'utf8')
}

const withScore = (best: number): KeptArcade => {
  const base = emptyKept('machine')
  return {
    ...base,
    library: { ...base.library, scores: { snake: { best, bestAt: 1, lastScore: best, lastPlayedAt: 1, plays: 1 } } }
  }
}

describe('the file', () => {
  it('writes where the profile export expects to find it', async () => {
    const base = where()
    const store = new ArcadeStore(base, 'default')
    await store.save(withScore(420))
    await store.flush()
    assert.ok(existsSync(fileIn(base, 'default')), 'the scores should be on the disk')
    assert.deepEqual([...ARCADE_FILES], ['personal/arcade.json'], 'or the export would leave them behind')
    assert.match(readFileSync(fileIn(base, 'default'), 'utf8'), /420/)
  })

  it('answers with an empty record on a first run, and says nothing is wrong', async () => {
    const read = await new ArcadeStore(where(), 'default').read()
    assert.deepEqual(read.value.record.plays, [])
    assert.deepEqual(read.notes, [])
    assert.equal(read.refused, null, 'a file that is not there may be written')
  })

  it('keeps a field this version has never heard of', async () => {
    const base = where()
    write(fileIn(base, 'default'), JSON.stringify({ ...emptyKept('machine'), somethingNew: 'keep me' }))
    const store = new ArcadeStore(base, 'default')
    const read = await store.read()
    assert.equal((read.value as unknown as { somethingNew?: string }).somethingNew, 'keep me')
    await store.save(read.value)
    await store.flush()
    assert.match(readFileSync(fileIn(base, 'default'), 'utf8'), /keep me/)
  })
})

describe('a file that could not be read', () => {
  it('moves one it cannot make sense of aside, and the words are still on the disk', async () => {
    const base = where()
    write(fileIn(base, 'default'), '{ "library": this is not json at all')

    const store = new ArcadeStore(base, 'default')
    const read = await store.read()

    // The arcade still works, and the player is told what happened in words they can read.
    assert.deepEqual(read.value.record.plays, [])
    assert.match(String(read.notes[0]), /could not make sense of your game scores/)
    assert.match(String(read.notes[0]), /Nothing was deleted/)
    assert.equal(read.refused, null, 'a file moved aside may be written; saying otherwise would be a false alarm')

    // What was there is still there, under a name that says what happened to it.
    const beside = readdirSync(join(base, 'personal')).filter((one) => one.includes('unreadable'))
    assert.equal(beside.length, 1)
    assert.match(readFileSync(join(base, 'personal', beside[0]), 'utf8'), /this is not json at all/)
  })

  it('moves aside valid JSON that is not an arcade record, rather than reading it wrongly', async () => {
    const base = where()
    write(fileIn(base, 'default'), JSON.stringify(['not', 'a', 'record']))
    const store = new ArcadeStore(base, 'default')
    await store.read()
    const beside = readdirSync(join(base, 'personal')).filter((one) => one.includes('unreadable'))
    assert.equal(beside.length, 1, 'valid JSON of the wrong shape is damaged, not empty')
  })

  it('writes nothing at all over a file it could not read, and the save says so', async () => {
    /*
     * The difference the whole store is built around. "There is no file" and "there is a file and Orbis could not
     * read it" look identical to `try { ... } catch { defaults }`, and on Windows a file is unreadable for a moment
     * often enough to matter -- antivirus has it open, a backup is copying it. Refusing is recoverable. Overwriting
     * is not.
     *
     * A directory where the file should be produces exactly that: something is there, reading it fails, and it is
     * not a missing file.
     */
    const base = where()
    const path = fileIn(base, 'default')
    mkdirSync(join(path, 'still-here'), { recursive: true })

    const store = new ArcadeStore(base, 'default')
    const read = await store.read()
    assert.deepEqual(read.value.record.plays, [], 'the arcade gets something it can draw')
    assert.match(String(read.refused), /could not read your game scores/)
    assert.match(String(read.refused), /left exactly as it is/)

    const saved = await store.save(withScore(999))
    assert.notEqual(saved.refused, null, 'a save that could not happen must not report success')
    await store.flush()
    store.flushSync()

    // Still exactly what was there. Nothing was moved and nothing was written over it.
    assert.deepEqual(readdirSync(path), ['still-here'])
    assert.deepEqual(readdirSync(join(base, 'personal')).filter((one) => one.includes('unreadable')), [])
  })

  it('refuses a value the window sent that is not a record, and keeps what is held', async () => {
    const base = where()
    const store = new ArcadeStore(base, 'default')
    await store.save(withScore(420))
    await store.flush()

    const saved = await store.save('these are not scores')
    assert.match(String(saved.refused), /could not make sense of the game scores/)
    assert.equal(saved.value.library.scores.snake?.best, 420, 'what is held is what is still held')
    await store.flush()
    assert.match(readFileSync(fileIn(base, 'default'), 'utf8'), /420/)
  })
})

describe('following the profile', () => {
  it('lands a save queued just before the switch in the profile it came from', async () => {
    /*
     * The one that is invisible until it happens to somebody. A write is held for a fifth of a second before it goes
     * to the disk; somebody switching profile in that fifth of a second would otherwise have the first profile's
     * scores written into the second's folder. `JsonFile` takes the path at flush time with the data, which is what
     * makes this pass.
     */
    const base = where()
    const store = new ArcadeStore(base, 'default')
    await store.save(withScore(1234))
    // No flush: the write is still pending when the profile changes.
    await store.useProfile('work')
    await store.flush()

    assert.match(readFileSync(fileIn(base, 'default'), 'utf8'), /1234/, 'it belongs to the profile it was played in')
    assert.equal(existsSync(fileIn(base, 'work')), false, 'and the other profile has nothing of it')
  })

  it('gives a different profile its own record, and nothing of the first one’s', async () => {
    const base = where()
    const store = new ArcadeStore(base, 'default')
    await store.save(withScore(1234))
    await store.flush()

    await store.useProfile('work')
    const read = await store.read()
    assert.equal(read.value.library.scores.snake, undefined, 'two people on one computer never share a high-score table')
    assert.deepEqual(read.notes, [], 'and a problem with the other profile’s file says nothing about this one')

    await store.save(withScore(7))
    await store.flush()
    assert.match(readFileSync(fileIn(base, 'work'), 'utf8'), /"best":7/)
    assert.match(readFileSync(fileIn(base, 'default'), 'utf8'), /1234/)
  })

  it('writes a run finished a moment before closing', async () => {
    // Without this, a new best score set in the last fifth of a second before Orbis closes is lost outright --
    // which is the one loss somebody would notice.
    const base = where()
    const store = new ArcadeStore(base, 'default')
    await store.read()
    await store.save(withScore(555))
    store.flushSync()
    assert.match(readFileSync(fileIn(base, 'default'), 'utf8'), /555/)
  })
})
