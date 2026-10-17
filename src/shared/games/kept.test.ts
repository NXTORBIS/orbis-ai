import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_PREFS, type GameId } from '../offlineGames.ts'
import { emptyRecord, type PlayRecord } from './record.ts'
import {
  continuable, emptyKept, forgetArcade, isEmptyKept, keptFromWindowStorage, readKept, sortGames, spellScore, spellTime,
  type KeptArcade
} from './kept.ts'

/**
 * What the arcade keeps, read back.
 *
 * What is checked here is mostly not that it saves and loads. It is the behaviour that only shows itself when
 * something has gone wrong, because this file holds however long somebody has been playing for, and every way a
 * store has ever lost somebody's data looks the same from the inside: it could not read what was there, decided
 * that meant there was nothing there, and wrote defaults on top.
 *
 * The one piece of ordinary logic that gets the same attention is the sorting, for a reason worth saying: a
 * leaderboard sorted the wrong way round still looks like a leaderboard. Nothing errors, nothing is lost, and the
 * worst reaction times sit at the top under the word "best".
 */

const play = (over: Partial<PlayRecord> & { id: string; gameId: GameId; at: number }): PlayRecord => ({
  finished: true,
  score: 100,
  difficulty: 'normal',
  ...over
})

const withPlays = (plays: PlayRecord[]): KeptArcade => ({ ...emptyKept('machine'), record: { ...emptyRecord('machine'), plays } })

describe('reading what was stored', () => {
  it('answers with an empty record when there is no file, and says nothing is wrong', () => {
    const read = readKept(null)
    assert.deepEqual(read.notes, [])
    assert.deepEqual(read.value.record.plays, [])
    assert.equal(read.value.library.prefs.difficulty, DEFAULT_PREFS.difficulty)
    assert.equal(read.value.goalId, null)
  })

  it('throws on something that is not an arcade record, so the file is moved aside rather than written over', () => {
    // Throwing is the whole mechanism: `JsonFile` treats it as "damaged" and renames the file with the time on it
    // before writing anything, so the words stay on the disk. Returning defaults here is how data gets lost.
    assert.throws(() => readKept(['not', 'a', 'record']), /not a record of games played/)
    assert.throws(() => readKept('scores'), /not a record of games played/)
    assert.throws(() => readKept(42), /not a record of games played/)
  })

  it('throws when the stored list of runs is not a list', () => {
    assert.throws(() => readKept({ record: { plays: 'all of them' } }), /isn't a list/)
  })

  it('leaves out a run it cannot read, keeps the rest, and says how many', () => {
    const read = readKept({
      record: {
        installId: 'machine',
        plays: [
          { id: 'a', gameId: 'snake', at: 1000, finished: true, score: 10 },
          { id: 'b', gameId: 'not-a-game', at: 2000 },
          { gameId: 'snake', at: 3000 },
          { id: 'c', gameId: 'flappy', at: 4000, finished: true, score: 7 }
        ]
      }
    })
    assert.deepEqual(read.value.record.plays.map((one) => one.id), ['c', 'a'], 'newest first, and only the readable ones')
    assert.equal(read.notes.length, 1)
    assert.match(read.notes[0], /2 runs were stored in a shape this version cannot read/)
  })

  it('costs one impossible preference that preference and nothing else', () => {
    const read = readKept({ dayStartHour: 99, goalId: 'play-three', library: { prefs: { sound: false, difficulty: 'hard' } } })
    assert.equal(read.value.dayStartHour, 0)
    assert.equal(read.notes.length, 1)
    assert.match(read.notes[0], /hour your day starts/)
    // Everything else in the file is exactly what was in it, which is the whole difference between this and
    // `JSON.parse(...) ?? defaults`.
    assert.equal(read.value.library.prefs.sound, false)
    assert.equal(read.value.library.prefs.difficulty, 'hard')
    assert.equal(read.value.goalId, 'play-three')
  })

  it('keeps a field this version has never heard of, so a newer Orbis is not given back a worse copy', () => {
    const read = readKept({ somethingNew: { keep: 'me' }, library: {}, record: { plays: [] } })
    assert.deepEqual((read.value as unknown as { somethingNew: unknown }).somethingNew, { keep: 'me' })
  })

  it('keeps the machine mark that was stored rather than the one handed in', () => {
    const read = readKept({ record: { installId: 'already-mine', plays: [] } }, { installId: 'brand-new' })
    assert.equal(read.value.record.installId, 'already-mine', 'a new mark would change which challenge today gives')
  })
})

describe('whether there is room for an old copy', () => {
  it('is empty when nobody has chosen anything', () => {
    assert.equal(isEmptyKept(emptyKept()), true)
    assert.equal(isEmptyKept(emptyKept('machine')), true, 'a machine mark is not something somebody chose')
  })

  it('is not empty once a preference has been changed', () => {
    const kept = emptyKept()
    assert.equal(isEmptyKept({ ...kept, library: { ...kept.library, prefs: { ...kept.library.prefs, sound: false } } }), false)
  })

  it('is not empty once something has been played, favourited or left part way through', () => {
    const kept = emptyKept()
    assert.equal(isEmptyKept(withPlays([play({ id: 'a', gameId: 'snake', at: 1 })])), false)
    assert.equal(isEmptyKept({ ...kept, library: { ...kept.library, favorites: ['snake'] } }), false)
    assert.equal(isEmptyKept({ ...kept, library: { ...kept.library, saved: { sudoku: { state: {}, savedAt: 1 } } } }), false)
    assert.equal(isEmptyKept({ ...kept, goalId: 'play-three' }), false)
  })
})

describe('the old copy from the window', () => {
  it('brings the scores, favourites and preferences across and invents no runs', () => {
    const text = JSON.stringify({
      prefs: { sound: false, difficulty: 'hard' },
      scores: { snake: { best: 420, bestAt: 5, lastScore: 100, lastPlayedAt: 9, plays: 12 } },
      favorites: ['flappy'],
      recent: [{ gameId: 'snake', playedAt: 9, score: 100 }],
      saved: { sudoku: { state: { board: [] }, savedAt: 3 } }
    })
    const carried = keptFromWindowStorage(text, 'machine')
    assert.ok(carried)
    assert.equal(carried.library.scores.snake?.best, 420)
    assert.equal(carried.library.scores.snake?.plays, 12)
    assert.deepEqual(carried.library.favorites, ['flappy'])
    assert.equal(carried.library.prefs.difficulty, 'hard')
    assert.equal(carried.record.installId, 'machine')
    // Twelve plays and no runs. A run history worked back from a best score would be a list of games that never
    // happened, and it would then earn levels and hold streaks up.
    assert.deepEqual(carried.record.plays, [])
  })

  it('answers null when the old copy cannot be read, rather than bringing an empty one across', () => {
    assert.equal(keptFromWindowStorage('{ this is not json'), null)
    assert.equal(keptFromWindowStorage('[1,2,3]'), null)
    assert.equal(keptFromWindowStorage('"scores"'), null)
  })
})

describe('finding a game among thirty-two', () => {
  const kept = (): KeptArcade => {
    const base = emptyKept()
    return {
      ...base,
      library: {
        ...base.library,
        favorites: ['flappy'],
        scores: {
          // Two reaction games, where a lower number is the better one.
          'reaction-test': { best: 240, bestAt: 1, lastScore: 240, lastPlayedAt: 10, plays: 2 },
          'sliding-tiles': { best: 180, bestAt: 1, lastScore: 180, lastPlayedAt: 20, plays: 9 },
          // And one where a higher number is.
          snake: { best: 500, bestAt: 1, lastScore: 500, lastPlayedAt: 30, plays: 4 }
        }
      }
    }
  }

  it('puts the better reaction time above the worse one, which is the whole trap', () => {
    // Sorted descending on the stored number, 240 ms would beat 180 ms and the board would look perfectly normal.
    const order = sortGames(['reaction-test', 'sliding-tiles'], kept(), 'best', false)
    assert.deepEqual(order, ['sliding-tiles', 'reaction-test'])
  })

  it('puts a game nobody has played last on every ordering but by name', () => {
    for (const sort of ['best', 'recent', 'played'] as const) {
      const order = sortGames(['sudoku', 'snake'], kept(), sort, false)
      assert.deepEqual(order, ['snake', 'sudoku'], `${sort} should put the unplayed one last`)
    }
    assert.deepEqual(sortGames(['sudoku', 'snake'], kept(), 'name', false), ['snake', 'sudoku'], 'Snake before Sudoku by name')
  })

  it('pins favourites above everything, and stops when asked not to', () => {
    const order = sortGames(['snake', 'flappy'], kept(), 'played', true)
    assert.deepEqual(order, ['flappy', 'snake'], 'Glide is a favourite and has never been played')
    assert.deepEqual(sortGames(['snake', 'flappy'], kept(), 'played', false), ['snake', 'flappy'])
  })

  it('answers the same way every time, so a list does not reshuffle when nothing changed', () => {
    const ids: GameId[] = ['sudoku', 'nonogram', 'pipes', 'solitaire']
    const once = sortGames(ids, kept(), 'played', false)
    const twice = sortGames([...ids].reverse(), kept(), 'played', false)
    assert.deepEqual(once, twice, 'four games nobody has played fall through to their names')
  })

  it('offers only the games that can be continued, newest first', () => {
    const base = emptyKept()
    const list = continuable({
      ...base,
      library: {
        ...base.library,
        saved: {
          sudoku: { state: {}, savedAt: 100 },
          minesweeper: { state: {}, savedAt: 300 },
          stacker: { state: {}, savedAt: 200 }
        }
      }
    })
    assert.deepEqual(list.map((one) => one.gameId), ['minesweeper', 'stacker', 'sudoku'])
  })
})

describe('saying it in words', () => {
  it('never says nought hours nought minutes', () => {
    assert.equal(spellTime(0), '0 seconds')
    assert.equal(spellTime(1000), '1 second')
    assert.equal(spellTime(45_000), '45 seconds')
    assert.equal(spellTime(60_000), '1 minute')
    assert.equal(spellTime(3_600_000), '1 hour')
    assert.equal(spellTime(5_400_000), '1 hour 30 minutes')
  })

  it('writes a score in that game’s own units, because 180 means two things', () => {
    assert.equal(spellScore('reaction-test', 180), '180 ms')
    assert.equal(spellScore('typing-challenge', 72), '72 WPM')
    assert.match(spellScore('snake', 1500), /1[,.  ]?500/)
  })
})

describe('forgetting', () => {
  it('empties both halves at once and keeps what was not a score', () => {
    const base = emptyKept('machine')
    const held: KeptArcade = {
      ...base,
      library: {
        ...base.library,
        prefs: { ...base.library.prefs, sound: false },
        scores: { snake: { best: 9, bestAt: 1, lastScore: 9, lastPlayedAt: 1, plays: 1 } },
        recent: [{ gameId: 'snake', playedAt: 1, score: 9 }],
        saved: { sudoku: { state: {}, savedAt: 1 } }
      },
      record: { ...base.record, plays: [play({ id: 'a', gameId: 'snake', at: 1 })] }
    }
    const after = forgetArcade(held)
    assert.deepEqual(after.library.scores, {})
    assert.deepEqual(after.library.recent, [])
    assert.deepEqual(after.library.saved, {})
    assert.deepEqual(after.record.plays, [])
    assert.equal(after.record.before, null)
    // Clearing the scores and leaving the runs would leave levels and streaks standing on runs whose scores are
    // gone, which is a rank nobody could account for.
    assert.equal(after.library.prefs.sound, false, 'the sound is a different decision from a score')
    assert.equal(after.record.installId, 'machine', 'a new mark would change today’s challenge halfway through')
  })
})
