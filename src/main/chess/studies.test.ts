import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ChessDataStore } from './data.ts'
import { ChessStore } from './store.ts'
import { STUDY_VERSION, type StoredStudy } from '../../shared/chess/study.ts'

/**
 * The sixth file: what somebody has worked out about their games.
 *
 * What is checked here is not that it saves and loads. It is the one promise this file exists to keep -- **an
 * analysis that cannot be read must never cost the game** -- and the handful of ways a store can lose somebody's
 * work while reporting success:
 *
 *   - a file that makes no sense is moved aside and the words are still on the disk;
 *   - a file that cannot be read at all is not written to at all, and the save says so rather than claiming it saved;
 *   - one analysis that cannot be read does not take the hundred beside it, and is not deleted by the next save;
 *   - saving one game's analysis leaves every other game's alone;
 *   - a save queued microseconds before the process ends is on the disk.
 */

const where = (): string => mkdtempSync(join(tmpdir(), 'orbis-chess-study-'))

const fileIn = (base: string, profileId: string, name: string): string =>
  profileId === 'default' ? join(base, 'personal', name) : join(base, 'profiles', profileId, 'personal', name)

const write = (path: string, text: string): void => {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text, 'utf8')
}

/** A saved analysis of one game: one branch, one note, one engine answer with its depth. */
function study(gameId: string, savedAt = 1000): StoredStudy {
  return {
    id: gameId,
    gameId,
    fingerprint: 'ffffffffffffffff',
    startFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    rootId: 'root',
    nodes: [
      { id: 'root', parentId: null, move: null, fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', children: ['n1'] },
      {
        id: 'n1',
        parentId: 'root',
        move: { san: 'e4', uci: 'e2e4', fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1' },
        fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
        children: [],
        label: 'The usual'
      }
    ],
    cursor: 'n1',
    annotations: { n1: { text: 'the point of the whole game', updatedAt: 900 } },
    evaluations: {
      n1: {
        fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
        score: { kind: 'cp', cp: 28 },
        depth: 26,
        engine: 'Stockfish 17',
        at: 800
      }
    },
    counter: 1,
    runs: [],
    savedAt,
    version: STUDY_VERSION
  }
}

describe('keeping one game\'s analysis', () => {
  it('writes it to its own file, and reads back exactly what it said it stored', async () => {
    const base = where()
    const store = new ChessDataStore(base, 'default')
    const saved = await store.saveStudy(study('g1'))
    assert.equal(saved.refused, null)
    assert.equal(saved.value?.annotations.n1.text, 'the point of the whole game')
    assert.equal(saved.value?.evaluations.n1.depth, 26, 'the depth behind the number is part of the number')
    await store.flush()

    const path = fileIn(base, 'default', 'chess-studies.json')
    assert.ok(existsSync(path), 'the analyses have a file of their own')
    // And nowhere near the games, which is the whole point of it being a sixth file.
    assert.equal(existsSync(fileIn(base, 'default', 'chess-games.json')), false)

    const again = await new ChessDataStore(base, 'default').study('g1')
    assert.deepEqual(again.value, saved.value)
    assert.deepEqual(again.notes, [])
    assert.equal(again.refused, null)
  })

  it('tells nothing saved apart from a file it could not read', async () => {
    /*
     * The two answers that must never be confused. "You have not looked at this game yet" comes back as null with
     * nothing wrong; "something is there and Orbis could not read it" comes back with `refused` set. A screen that
     * treated them as one would show somebody an empty board as though they had never worked on the game.
     */
    const store = new ChessDataStore(where(), 'default')
    const nothing = await store.study('g1')
    assert.equal(nothing.value, null)
    assert.equal(nothing.refused, null)
    assert.deepEqual(nothing.notes, [])
  })

  it('leaves every other game\'s analysis alone when one is saved', async () => {
    const base = where()
    const store = new ChessDataStore(base, 'default')
    await store.saveStudy(study('g1'))
    await store.saveStudy(study('g2'))
    await store.saveStudy({ ...study('g1', 2000), annotations: { n1: { text: 'changed my mind', updatedAt: 1900 } } })
    await store.flush()

    const read = new ChessDataStore(base, 'default')
    assert.equal((await read.study('g1')).value?.annotations.n1.text, 'changed my mind')
    assert.equal((await read.study('g2')).value?.annotations.n1.text, 'the point of the whole game')
    assert.deepEqual((await read.studyIds()).value.sort(), ['g1', 'g2'])
  })

  it('takes one away when asked, and leaves the game and the others', async () => {
    const base = where()
    const store = new ChessDataStore(base, 'default')
    await store.saveStudy(study('g1'))
    await store.saveStudy(study('g2'))
    const gone = await store.removeStudy('g1')
    assert.equal(gone.value, true)
    assert.equal(gone.refused, null)
    assert.equal((await store.study('g1')).value, null)
    assert.equal((await store.study('g2')).value?.gameId, 'g2')
    assert.equal((await store.removeStudy('g1')).value, false, 'nothing to remove is not a removal')
  })

  it('refuses a value the window sent that is not an analysis at all, and keeps what is held', async () => {
    const base = where()
    const store = new ChessDataStore(base, 'default')
    await store.saveStudy(study('g1'))
    const saved = await store.saveStudy('this is not an analysis')
    assert.match(String(saved.refused), /could not make sense of the analysis/)
    assert.equal((await store.study('g1')).value?.gameId, 'g1', 'what is held is what is still held')
  })
})

describe('an analysis that could not be read', () => {
  it('never costs the game it was about', async () => {
    /*
     * The promise the whole file exists for, tested through the real game store beside it. The analyses file is
     * wrecked; the game opens in full.
     */
    const base = where()
    const games = new ChessStore(base, 'default')
    const game = await games.create({ source: { kind: 'custom-position' }, meta: { white: { name: 'Ada' }, black: {}, result: '*' } })
    await games.flush()

    write(fileIn(base, 'default', 'chess-studies.json'), '{ "studies": this is not json at all')
    const store = new ChessDataStore(base, 'default')
    const read = await store.study(game.id)
    assert.equal(read.value, null)
    assert.match(String(read.notes[0]), /could not make sense of your saved analyses/)
    assert.match(String(read.notes[0]), /Nothing was deleted/)

    // The game is exactly where it was.
    const still = await new ChessStore(base, 'default').get(game.id)
    assert.equal(still?.meta.white.name, 'Ada')

    // And the words of the damaged file are still on the disk, under a name that says what happened to it.
    const beside = readdirSync(join(base, 'personal')).filter((one) => one.includes('unreadable'))
    assert.equal(beside.length, 1)
    assert.match(readFileSync(join(base, 'personal', beside[0]), 'utf8'), /this is not json at all/)
  })

  it('writes nothing at all over a file it could not read, and the save says so', async () => {
    // A directory where the file should be: something is there, reading it fails, and it is not a missing file.
    const base = where()
    const path = fileIn(base, 'default', 'chess-studies.json')
    mkdirSync(path, { recursive: true })
    mkdirSync(join(path, 'still-here'), { recursive: true })

    const store = new ChessDataStore(base, 'default')
    const read = await store.study('g1')
    assert.match(String(read.refused), /could not read your saved analyses/)

    const saved = await store.saveStudy(study('g1'))
    assert.notEqual(saved.refused, null, 'a save that could not happen must not report success')
    assert.equal(saved.value, null, 'and must not hand back the record as though it had landed')
    await store.flush()
    store.flushSync()

    assert.deepEqual(readdirSync(path), ['still-here'])
    assert.deepEqual(readdirSync(join(base, 'personal')).filter((one) => one.includes('unreadable')), [])
  })

  it('keeps one unreadable analysis in the file rather than deleting it on the next save', async () => {
    /*
     * The quiet deletion this file is written whole enough to commit. One record written by a newer Orbis cannot be
     * read; leaving it out of the read would delete it from the disk the moment somebody wrote a note about any
     * other game. It is put aside in the same file and carried through untouched.
     */
    const base = where()
    write(
      fileIn(base, 'default', 'chess-studies.json'),
      JSON.stringify({
        studies: {
          g1: { gameId: 'g1', version: STUDY_VERSION + 5, nodes: [], somethingFromLater: true },
          g2: study('g2')
        }
      })
    )

    const store = new ChessDataStore(base, 'default')
    const read = await store.study('g1')
    assert.equal(read.value, null, 'it cannot be read, so it is not handed to the window')
    assert.match(read.notes.join(' '), /written by a newer Orbis/)
    assert.equal((await store.study('g2')).value?.gameId, 'g2', 'and the one beside it reads fine')

    // Now a save of another game, and the record nobody could read is still there afterwards.
    await store.saveStudy(study('g3'))
    await store.flush()
    const onDisk = JSON.parse(readFileSync(fileIn(base, 'default', 'chess-studies.json'), 'utf8')) as Record<string, Record<string, Record<string, unknown>>>
    assert.equal(onDisk.unread?.g1?.somethingFromLater, true, 'the words a newer Orbis wrote are still on the disk')
    assert.ok(onDisk.studies?.g3, 'and the new one landed')
  })

  it('moves aside a file whose analyses are not analyses, rather than reading it as empty', async () => {
    const base = where()
    write(fileIn(base, 'default', 'chess-studies.json'), JSON.stringify({ studies: 'everything I ever worked out' }))
    const store = new ChessDataStore(base, 'default')
    const read = await store.study('g1')
    assert.equal(read.value, null)
    assert.match(String(read.notes[0]), /could not make sense of your saved analyses/)
    const beside = readdirSync(join(base, 'personal')).filter((one) => one.includes('unreadable'))
    assert.equal(beside.length, 1, 'valid JSON of the wrong shape is damaged, not empty')
    assert.match(readFileSync(join(base, 'personal', beside[0]), 'utf8'), /everything I ever worked out/)
  })

  it('leaves out one analysis it cannot read and keeps the rest, saying how many went', async () => {
    const base = where()
    write(
      fileIn(base, 'default', 'chess-studies.json'),
      JSON.stringify({ studies: { g1: { nothing: 'that names a game' }, g2: study('g2'), g3: study('g3') } })
    )
    const store = new ChessDataStore(base, 'default')
    const ids = await store.studyIds()
    assert.deepEqual(ids.value.sort(), ['g2', 'g3'])
    assert.match(ids.notes.join(' '), /did not say which game it was about/)
  })
})

describe('the profile, and the moment the process ends', () => {
  it('lands a save queued before a profile switch in the profile that made it', async () => {
    const base = where()
    const store = new ChessDataStore(base, 'default')
    await store.saveStudy(study('g1'))
    // No flush: the save is still waiting when the profile changes.
    await store.useProfile('work')

    assert.match(readFileSync(fileIn(base, 'default', 'chess-studies.json'), 'utf8'), /the point of the whole game/)
    assert.equal(existsSync(fileIn(base, 'work', 'chess-studies.json')), false, 'the other profile has nothing yet')
    assert.equal((await store.study('g1')).value, null, 'and is not shown the first profile\'s work')
  })

  it('writes a save queued microseconds before the process ends', async () => {
    const base = where()
    const store = new ChessDataStore(base, 'default')
    await store.saveStudy(study('g1'))
    const path = fileIn(base, 'default', 'chess-studies.json')
    assert.equal(existsSync(path), false, 'nothing is on the disk yet; the write is still waiting')
    store.flushSync()
    assert.match(readFileSync(path, 'utf8'), /the point of the whole game/)
  })
})
