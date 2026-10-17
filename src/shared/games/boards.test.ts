import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { GameId } from '../offlineGames.ts'
import { DAY, dayKey, type DayRules } from './calendar.ts'
import { KEEP_PLAYS, emptyRecord, trim, type PlayRecord } from './record.ts'
import { emptyKept, type KeptArcade } from './kept.ts'
import { arcadeStats, daysPlayed, gameBoard, topByTime } from './boards.ts'

/**
 * The boards, checked against the two things that are actually stored.
 *
 * Every figure here is worked out rather than kept, which is the point: there is no "most played" field to drift.
 * What the tests below are really about is the three ways a worked-out figure can still be wrong -- it can be read
 * off the wrong one of the two halves, it can be a total that silently covers less than everything, and it can
 * change when nothing changed because a tie was broken by whichever key came first.
 */

const RULES: DayRules = { offsetMinutes: 0, dayStartHour: 0 }

const play = (over: Partial<PlayRecord> & { id: string; gameId: GameId; at: number }): PlayRecord => ({
  finished: true,
  score: 100,
  difficulty: 'normal',
  ...over
})

function keptWith(o: { plays: PlayRecord[]; scores?: KeptArcade['library']['scores'] }): KeptArcade {
  const base = emptyKept('machine')
  return {
    ...base,
    library: { ...base.library, ...(o.scores ? { scores: o.scores } : {}) },
    record: { ...emptyRecord('machine'), plays: [...o.plays].sort((a, b) => b.at - a.at) }
  }
}

describe('one game’s board', () => {
  it('takes the best from the score store, not from the run list', () => {
    /*
     * The two halves know different things and only one of them holds the record. `beats()` in `offlineGames.ts`
     * judges a best, which is what makes a reaction time count the right way round -- and a board that read the
     * highest number out of the run list would, for Reaction Test, show the worst time somebody ever managed as
     * their best.
     */
    const kept = keptWith({
      plays: [
        play({ id: 'a', gameId: 'reaction-test', at: 1000, score: 320 }),
        play({ id: 'b', gameId: 'reaction-test', at: 2000, score: 190 })
      ],
      scores: { 'reaction-test': { best: 190, bestAt: 2000, lastScore: 190, lastPlayedAt: 2000, plays: 2 } }
    })
    assert.equal(gameBoard(kept, 'reaction-test').best, 190)
  })

  it('adds up only the time the games measured, and averages only the runs that finished', () => {
    const kept = keptWith({
      plays: [
        play({ id: 'a', gameId: 'snake', at: 1000, score: 100, seconds: 30 }),
        play({ id: 'b', gameId: 'snake', at: 2000, score: 200, seconds: 90 }),
        // Opened and walked away from: it counts as a play and is not a score, so it is not in the average.
        play({ id: 'c', gameId: 'snake', at: 3000, score: 0, finished: false, seconds: 5 }),
        // A game that never reported how long it took. Nothing is invented for it.
        play({ id: 'd', gameId: 'snake', at: 4000, score: 300 })
      ]
    })
    const board = gameBoard(kept, 'snake')
    assert.equal(board.plays, 4)
    assert.equal(board.finished, 3)
    assert.equal(board.ms, 125_000, '30 + 90 + 5 seconds; the one with no time adds nothing')
    assert.equal(board.averageOfRecent, 200, '(100 + 200 + 300) / 3, with the abandoned run left out')
  })

  it('keeps the last ten and says when older runs have been added up instead of kept', () => {
    const plays = Array.from({ length: KEEP_PLAYS + 5 }, (_, n) => play({ id: `p${n}`, gameId: 'snake', at: 1_000_000 + n * 1000, score: n, seconds: 1 }))
    const base = keptWith({ plays })
    const kept: KeptArcade = { ...base, record: trim(base.record) }
    const board = gameBoard(kept, 'snake', 10)
    assert.equal(board.runs.length, 10)
    assert.deepEqual(board.runs.map((one) => one.id), ['p404', 'p403', 'p402', 'p401', 'p400', 'p399', 'p398', 'p397', 'p396', 'p395'])
    // The five oldest were rolled into a summary that carries plays and finishes but not seconds, so the time
    // figure covers less than everything and the flag is what lets a screen say so.
    assert.equal(board.plays, KEEP_PLAYS + 5, 'no total falls when runs are rolled up')
    assert.equal(board.rolledUp, true)
    assert.equal(board.ms, KEEP_PLAYS * 1000)
  })

  it('answers for a game that has never been played without inventing a measurement', () => {
    const board = gameBoard(emptyKept(), 'sudoku')
    assert.equal(board.plays, 0)
    assert.equal(board.finished, 0)
    assert.equal(board.best, undefined, 'never played is not a best of nought')
    assert.equal(board.averageOfRecent, undefined)
    assert.deepEqual(board.runs, [])
  })

  it('still answers for a score carried over from the window, which has no runs behind it', () => {
    const kept = keptWith({ plays: [], scores: { snake: { best: 420, bestAt: 5, lastScore: 100, lastPlayedAt: 9, plays: 12 } } })
    const board = gameBoard(kept, 'snake')
    assert.equal(board.best, 420)
    assert.equal(board.plays, 12, 'the twelve plays came across with the score; the runs did not exist to come across')
    assert.deepEqual(board.runs, [], 'and none are invented')
  })
})

describe('the days', () => {
  it('counts a run on the day it was played, in the player’s own time', () => {
    // 1 January 2026, 23:30 UTC. An hour ahead that is already the second; an hour behind it is still the first.
    const at = Date.UTC(2026, 0, 1, 23, 30)
    const kept = keptWith({ plays: [play({ id: 'a', gameId: 'snake', at, seconds: 60 })] })
    assert.equal(daysPlayed(kept, { offsetMinutes: 0, dayStartHour: 0 })[0].key, '2026-01-01')
    assert.equal(daysPlayed(kept, { offsetMinutes: 60, dayStartHour: 0 })[0].key, '2026-01-02')
    assert.equal(daysPlayed(kept, { offsetMinutes: -60, dayStartHour: 0 })[0].key, '2026-01-01')
    // And with the day taken to start at four in the morning, half past eleven at night is still that same day.
    assert.equal(daysPlayed(kept, { offsetMinutes: 0, dayStartHour: 4 })[0].key, '2026-01-01')
  })

  it('gathers each day once, newest first, with what was played on it', () => {
    const monday = Date.UTC(2026, 0, 5, 12)
    const kept = keptWith({
      plays: [
        play({ id: 'a', gameId: 'snake', at: monday, seconds: 60 }),
        play({ id: 'b', gameId: 'flappy', at: monday + 3600_000, seconds: 120 }),
        play({ id: 'c', gameId: 'snake', at: monday + DAY, seconds: 30, finished: false })
      ]
    })
    const days = daysPlayed(kept, RULES)
    assert.deepEqual(days.map((one) => one.key), [dayKey(monday + DAY, RULES), dayKey(monday, RULES)])
    assert.equal(days[1].plays, 2)
    assert.equal(days[1].finished, 2)
    assert.equal(days[1].games, 2)
    assert.equal(days[1].ms, 180_000)
    assert.equal(days[0].finished, 0, 'a run walked away from is a play and not a finish')
    assert.match(days[1].label, /January 2026/)
  })
})

describe('the whole arcade', () => {
  it('tells what you play most from what you finish most, because they are different questions', () => {
    const kept = keptWith({
      plays: [
        // One long session of a slow game.
        play({ id: 'a', gameId: 'sudoku', at: 5000, seconds: 1800 }),
        // Many short goes at a quick one.
        ...Array.from({ length: 6 }, (_, n) => play({ id: `f${n}`, gameId: 'flappy', at: 1000 + n, seconds: 20 }))
      ]
    })
    const stats = arcadeStats(kept, RULES)
    assert.equal(stats.mostPlayed?.gameId, 'sudoku', 'half an hour beats two minutes')
    assert.equal(stats.mostFinished?.gameId, 'flappy', 'six runs beat one')
    assert.equal(stats.finished, 7)
    assert.equal(stats.gamesFinished, 2)
    assert.equal(stats.ms, 1_920_000)
  })

  it('says nothing is the most played when nothing has been played', () => {
    const stats = arcadeStats(emptyKept(), RULES)
    assert.equal(stats.plays, 0)
    assert.equal(stats.mostPlayed, null)
    assert.equal(stats.mostFinished, null)
    assert.equal(stats.bestDay, null)
    assert.equal(stats.rolledUp, false)
  })

  it('counts games opened apart from games finished', () => {
    const kept = keptWith({
      plays: [
        play({ id: 'a', gameId: 'snake', at: 1000 }),
        play({ id: 'b', gameId: 'sudoku', at: 2000, finished: false, score: 0 })
      ]
    })
    const stats = arcadeStats(kept, RULES)
    assert.equal(stats.gamesPlayed, 2)
    assert.equal(stats.gamesFinished, 1, 'opening Sudoku and walking away is not finishing it')
  })

  it('breaks a tie the same way every time, so a figure does not change when nothing changed', () => {
    const plays = [
      play({ id: 'a', gameId: 'sudoku', at: 1000, seconds: 60 }),
      play({ id: 'b', gameId: 'nonogram', at: 2000, seconds: 60 })
    ]
    const forwards = arcadeStats(keptWith({ plays }), RULES)
    const backwards = arcadeStats(keptWith({ plays: [...plays].reverse() }), RULES)
    assert.equal(forwards.mostPlayed?.gameId, backwards.mostPlayed?.gameId)
    assert.equal(forwards.mostPlayed?.name, 'Picture Logic', 'the earlier name wins a dead tie')
  })

  it('says when the time figures cover the runs still kept rather than everything', () => {
    const plays = Array.from({ length: KEEP_PLAYS + 1 }, (_, n) => play({ id: `p${n}`, gameId: 'snake', at: 1_000_000 + n * 1000, seconds: 1 }))
    const base = keptWith({ plays })
    const stats = arcadeStats({ ...base, record: trim(base.record) }, RULES)
    assert.equal(stats.rolledUp, true, 'a screen showing "time played" has to be able to say what it covers')
    assert.equal(stats.plays, KEEP_PLAYS + 1, 'while the counts that can survive a roll-up still do')
  })

  it('ranks the games by time and leaves out the ones nothing was measured for', () => {
    const kept = keptWith({
      plays: [
        play({ id: 'a', gameId: 'snake', at: 1000, seconds: 10 }),
        play({ id: 'b', gameId: 'sudoku', at: 2000, seconds: 300 }),
        // Played, never timed. It has no bar to draw, so it is not given one.
        play({ id: 'c', gameId: 'flappy', at: 3000 })
      ]
    })
    assert.deepEqual(topByTime(kept, 5).map((one) => one.gameId), ['sudoku', 'snake'])
  })
})
