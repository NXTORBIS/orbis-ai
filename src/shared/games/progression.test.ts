import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import * as chess from '../chess/progress.ts'
import { CALENDAR_RULES, DAY, addDays, dayKey, dayLabel, dayStart, hashKey, weekStart } from './calendar.ts'
import {
  KEEP_PLAYS, POINTS, POINT_RULES, addPlay, creditable, earnedFor, emptyRecord, isLate, readArcade, summaryFor,
  totalsOf, trim, type ArcadeRecord, type PlayRecord
} from './record.ts'
import { LEVEL_RULE, RANKS, TIERS, levelAt, levelStanding, masteryBoard, masteryOf, pointsForLevel, progressionView, rankAt } from './progression.ts'

/**
 * The arcade's calendar, its record of runs, and what playing earns.
 *
 * The first block is the one that matters most and is the least interesting to read: the day arithmetic here is a copy
 * of Chess World's, and this holds the two together over thousands of moments. A copy that drifts would make a streak
 * mean one thing on one screen and another thing on another, and nothing else would ever say so.
 */

const DAY_RULES = { offsetMinutes: 0, dayStartHour: 0 }
const SETS = [
  { offsetMinutes: 0, dayStartHour: 0 },
  { offsetMinutes: 330, dayStartHour: 0 },
  { offsetMinutes: -480, dayStartHour: 4 },
  { offsetMinutes: 60, dayStartHour: 6 },
  { offsetMinutes: -210, dayStartHour: 23 }
]

const play = (o: Partial<PlayRecord> & { at: number; id: string }): PlayRecord => ({
  gameId: 'snake',
  finished: true,
  score: 100,
  difficulty: 'normal',
  ...o
})

describe('the arcade calendar is Chess World’s, to the millisecond', () => {
  test('the rules are the same four sentences', () => {
    assert.deepEqual([...CALENDAR_RULES], [...chess.CALENDAR_RULES])
  })

  test('day, week and label agree over thousands of moments and five sets of rules', () => {
    // A fixed walk rather than random moments: a failure has to be reproducible to be worth reporting.
    let at = Date.UTC(2023, 0, 1, 3, 17, 42)
    let checked = 0
    for (let step = 0; step < 900; step++) {
      at += 97_337_111
      for (const rules of SETS) {
        assert.equal(dayKey(at, rules), chess.dayKey(at, rules))
        assert.equal(dayStart(at, rules), chess.dayStart(at, rules))
        assert.equal(weekStart(at, rules), chess.weekStart(at, rules))
        assert.equal(dayLabel(at, rules), chess.dayLabel(at, rules))
        assert.equal(addDays(at, -3, rules), chess.addDays(at, -3, rules))
        checked += 1
      }
    }
    assert.ok(checked > 4000, `only ${checked} comparisons ran`)
  })

  test('a day is exactly a day long, and the next one starts where it ended', () => {
    const at = Date.UTC(2026, 9, 16, 11, 0, 0)
    for (const rules of SETS) {
      assert.equal(dayStart(at + DAY, rules), dayStart(at, rules) + DAY)
      assert.notEqual(dayKey(at, rules), dayKey(dayStart(at, rules) - 1, rules))
    }
  })

  test('the hash is the same every time and different for different keys', () => {
    assert.equal(hashKey('2026-10-16'), hashKey('2026-10-16'))
    assert.notEqual(hashKey('2026-10-16'), hashKey('2026-10-17'))
  })
})

describe('reading what was stored', () => {
  test('nothing stored is nothing played, not a broken record', () => {
    const read = readArcade(null, { installId: 'abc' })
    assert.equal(read.unreadable, false)
    assert.equal(read.record.plays.length, 0)
    assert.equal(read.record.installId, 'abc')
  })

  test('something stored that cannot be read is left alone, never written over', () => {
    for (const raw of ['not a record', 42, [], { plays: 'yesterday' }]) {
      const read = readArcade(raw)
      assert.equal(read.unreadable, true, `${JSON.stringify(raw)} should be reported as unreadable`)
      assert.match(read.says, /left alone|not an arcade record/)
    }
  })

  test('one bad run in a good list loses that run and nothing else', () => {
    const read = readArcade({ installId: 'x', plays: [play({ id: 'a', at: 10 }), { id: 'b' }, play({ id: 'c', at: 20, gameId: 'sudoku' }), { gameId: 'nope', at: 5, id: 'd' }] })
    assert.equal(read.unreadable, false)
    assert.equal(read.dropped, 2)
    assert.deepEqual(read.record.plays.map((one) => one.id), ['c', 'a'])
  })

  test('the runs come back newest first however they were stored', () => {
    const read = readArcade({ plays: [play({ id: 'old', at: 1 }), play({ id: 'new', at: 99 }), play({ id: 'mid', at: 50 })] })
    assert.deepEqual(read.record.plays.map((one) => one.id), ['new', 'mid', 'old'])
  })
})

describe('writing a run down', () => {
  const now = Date.UTC(2026, 9, 16, 12, 0, 0)

  test('a finished run earns the points the rule says and no others', () => {
    const first = addPlay(emptyRecord('m'), play({ id: '1', at: now, newBest: true }), now, DAY_RULES)
    // Finished, on normal, a new best, and the first finish of that game.
    assert.equal(first.earned.points, POINTS.finished + POINTS.normal + POINTS.newBest + POINTS.firstTime)
    const second = addPlay(first.record, play({ id: '2', at: now, difficulty: 'hard' }), now, DAY_RULES)
    // The first-time bonus is once per game, and hard pays more than normal.
    assert.equal(second.earned.points, POINTS.finished + POINTS.hard)
  })

  test('a run that was not finished earns nothing and is still written down', () => {
    const added = addPlay(emptyRecord(), play({ id: '1', at: now, finished: false, score: 40 }), now, DAY_RULES)
    assert.equal(added.earned.points, 0)
    assert.equal(added.record.plays.length, 1)
    assert.equal(totalsOf(added.record).finished, 0)
    assert.equal(totalsOf(added.record).plays, 1)
  })

  test('the size of the score earns nothing at all', () => {
    const small = addPlay(emptyRecord(), play({ id: '1', at: now, score: 1 }), now, DAY_RULES)
    const huge = addPlay(emptyRecord(), play({ id: '1', at: now, score: 9_999_999 }), now, DAY_RULES)
    assert.equal(small.earned.points, huge.earned.points)
  })

  test('a run timed later than now is refused', () => {
    const added = addPlay(emptyRecord(), play({ id: '1', at: now + 60_000 }), now, DAY_RULES)
    assert.equal(added.refused, 'future')
    assert.equal(added.record.plays.length, 0)
    assert.match(added.says, /cannot be credited/)
  })

  test('the same run twice is one run', () => {
    const once = addPlay(emptyRecord(), play({ id: 'same', at: now, newBest: true }), now, DAY_RULES)
    const twice = addPlay(once.record, play({ id: 'same', at: now + 1000 }), now + 2000, DAY_RULES)
    assert.equal(twice.refused, 'duplicate')
    assert.equal(twice.record.plays.length, 1)
    assert.equal(twice.record.plays[0].at, now, 'the earlier time is the one kept')
    assert.equal(totalsOf(twice.record).points, once.earned.points)
  })

  test('a run written down on a later day counts in totals and cannot credit its day', () => {
    const yesterday = now - DAY
    const added = addPlay(emptyRecord(), play({ id: '1', at: yesterday }), now, DAY_RULES)
    assert.equal(added.late, true)
    assert.equal(totalsOf(added.record).finished, 1, 'it still counts in the totals')
    assert.deepEqual(creditable(added.record.plays, now, DAY_RULES), [], 'and it may not credit the day it claims')
    assert.match(added.says, /written down after the day it claims/)
  })

  test('a run recorded on its own day is not a late record', () => {
    const added = addPlay(emptyRecord(), play({ id: '1', at: now - 3600_000 }), now, DAY_RULES)
    assert.equal(added.late, false)
    assert.equal(creditable(added.record.plays, now, DAY_RULES).length, 1)
  })

  test('isLate reads the record’s own two stamps, not the clock', () => {
    assert.equal(isLate(play({ id: '1', at: now }), DAY_RULES), false)
    assert.equal(isLate(play({ id: '1', at: now, recordedAt: now + 60_000 }), DAY_RULES), false)
    assert.equal(isLate(play({ id: '1', at: now, recordedAt: now + DAY }), DAY_RULES), true)
  })
})

describe('older runs are added up, and no total falls', () => {
  const now = Date.UTC(2026, 9, 16, 12, 0, 0)
  const many = (count: number, keep?: number): ArcadeRecord => {
    let record = emptyRecord('m')
    for (let i = 0; i < count; i++) {
      const at = now - (count - i) * 3600_000
      const added = addPlay(record, play({ id: `p${i}`, at, gameId: i % 2 ? 'snake' : 'sudoku', difficulty: i % 3 === 0 ? 'hard' : 'normal', recordedAt: at }), now, DAY_RULES, { keep })
      record = added.record
    }
    return record
  }

  test('what the record adds up to is the same before and after the roll-up', () => {
    const record = many(KEEP_PLAYS + 60)
    assert.equal(record.plays.length, KEEP_PLAYS)
    assert.equal(record.before?.plays, 60)
    const totals = totalsOf(record)
    assert.equal(totals.plays, KEEP_PLAYS + 60)
    assert.equal(totals.finished, KEEP_PLAYS + 60)
    assert.equal(totals.rolledUp, true)
    // The same runs, kept whole, must add up to the same points.
    const whole = many(KEEP_PLAYS + 60, 10_000)
    assert.equal(whole.before, null)
    assert.equal(whole.plays.length, KEEP_PLAYS + 60)
    assert.equal(totals.points, totalsOf(whole).points)
    assert.equal(totals.hardFinished, totalsOf(whole).hardFinished)
    assert.equal(totals.gamesPlayed, totalsOf(whole).gamesPlayed)
    assert.equal(totals.bests, totalsOf(whole).bests)
  })

  test('adding more runs up leaves the record it replaced untouched', () => {
    // A record that has already rolled some runs up, so the second roll-up finds summaries to add to.
    const once = many(KEEP_PLAYS + 60)
    assert.ok(once.before?.games.sudoku, 'this test needs a record that has already added some runs up')
    const was = totalsOf(once)
    const sudoku = summaryFor(once, 'sudoku')!
    let after = once
    for (let i = 0; i < 20; i++) {
      const at = now - i * 1000
      after = addPlay(after, play({ id: `x${i}`, at, gameId: 'sudoku', recordedAt: at }), now, DAY_RULES).record
    }
    assert.equal(after.before!.plays, 80)
    // The map of summaries is shallow-copied from the record being replaced, so a figure added up in place would
    // change the older record's own figures -- and React is still holding that one.
    assert.deepEqual(totalsOf(once), was)
    assert.deepEqual(summaryFor(once, 'sudoku'), sudoku)
    assert.equal(totalsOf(after).plays, was.plays + 20)
  })

  test('trimming by hand is the same as trimming as you go', () => {
    const asYouGo = many(KEEP_PLAYS + 60)
    const atOnce = trim(many(KEEP_PLAYS + 60, 10_000))
    assert.equal(totalsOf(asYouGo).points, totalsOf(atOnce).points)
    assert.equal(asYouGo.before?.plays, atOnce.before?.plays)
  })

  test('one game’s own figures survive the roll-up', () => {
    const record = many(KEEP_PLAYS + 60)
    const rolled = summaryFor(record, 'sudoku')!
    const whole = summaryFor(many(KEEP_PLAYS + 60, 10_000), 'sudoku')!
    assert.equal(rolled.plays, whole.plays)
    assert.equal(rolled.finished, whole.finished)
    assert.equal(rolled.points, whole.points)
    assert.equal(rolled.hardFinished, whole.hardFinished)
  })

  test('a game never played has no figures, rather than a row of noughts', () => {
    const record = many(4)
    assert.equal(summaryFor(record, 'solitaire'), null)
    assert.equal(masteryOf(record, 'solitaire'), null)
  })
})

describe('the level', () => {
  test('every level costs 50 more than the one before, which is what the rule says', () => {
    assert.match(LEVEL_RULE, /50 points more than the one before/)
    assert.equal(pointsForLevel(1), 0)
    assert.equal(pointsForLevel(2), 50)
    assert.equal(pointsForLevel(3), 150)
    assert.equal(pointsForLevel(4), 300)
    for (let level = 2; level < 40; level++) {
      assert.equal(pointsForLevel(level + 1) - pointsForLevel(level), pointsForLevel(level) - pointsForLevel(level - 1) + 50)
    }
  })

  test('the level is never one past what was earned', () => {
    for (let points = 0; points < 4000; points++) {
      const level = levelAt(points)
      assert.ok(pointsForLevel(level) <= points, `level ${level} claims ${pointsForLevel(level)} points at ${points}`)
      assert.ok(pointsForLevel(level + 1) > points, `level ${level} at ${points} should already be ${level + 1}`)
    }
  })

  test('nothing earned is said as nothing earned, not as nought of fifty', () => {
    const standing = levelStanding(0)
    assert.equal(standing.level, 1)
    assert.match(standing.says, /Nothing earned yet/)
    assert.equal(standing.pointRules, POINT_RULES)
  })

  test('the standing says where it is and what is left', () => {
    const standing = levelStanding(200)
    assert.equal(standing.level, 3)
    assert.equal(standing.into, 50)
    assert.equal(standing.costs, 150)
    assert.equal(standing.left, 100)
    assert.equal(standing.rank.name, rankAt(3).name)
    assert.match(standing.says, /Level 3/)
  })

  test('the ranks are in order and start at level one', () => {
    assert.equal(RANKS[0].from, 1)
    for (let i = 1; i < RANKS.length; i++) assert.ok(RANKS[i].from > RANKS[i - 1].from)
    assert.equal(rankAt(1).name, 'New here')
    assert.equal(rankAt(100).name, RANKS[RANKS.length - 1].name)
  })
})

describe('where one game stands', () => {
  const now = Date.UTC(2026, 9, 16, 12, 0, 0)
  const after = (count: number, o: { bests?: number; hard?: number } = {}): ArcadeRecord => {
    let record = emptyRecord('m')
    for (let i = 0; i < count; i++) {
      const added = addPlay(record, play({
        id: `s${i}`,
        at: now - (count - i) * 60_000,
        recordedAt: now - (count - i) * 60_000,
        gameId: 'snake',
        newBest: i < (o.bests ?? 0),
        difficulty: i < (o.hard ?? 0) ? 'hard' : 'normal'
      }), now, DAY_RULES)
      record = added.record
    }
    return record
  }

  test('one finished run is the first tier, and no tier is reached without its count', () => {
    assert.equal(masteryOf(after(1), 'snake')!.tier, 1)
    assert.equal(masteryOf(after(4), 'snake')!.tier, 1)
    assert.equal(masteryOf(after(5), 'snake')!.tier, 2)
    // Fifteen runs are not enough on their own: the third tier also wants two records beaten.
    assert.equal(masteryOf(after(15), 'snake')!.tier, 2)
    assert.equal(masteryOf(after(15, { bests: 2 }), 'snake')!.tier, 3)
  })

  test('the top tier wants hard runs, so it cannot be reached on easy alone', () => {
    const soft = masteryOf(after(60, { bests: 5 }), 'snake')!
    assert.equal(soft.tier, 3)
    assert.deepEqual(soft.next!.needs.filter((one) => one.done < one.target).map((one) => one.label), ['runs finished on hard'])
    assert.equal(masteryOf(after(60, { bests: 5, hard: 5 }), 'snake')!.tier, 5)
  })

  test('a run that was left halfway moves nothing', () => {
    let record = emptyRecord('m')
    for (let i = 0; i < 20; i++) record = addPlay(record, play({ id: `u${i}`, at: now - i * 60_000, recordedAt: now - i * 60_000, finished: false }), now, DAY_RULES).record
    const standing = masteryOf(record, 'snake')!
    assert.equal(standing.tier, 0)
    assert.equal(standing.label, 'Played')
    assert.match(standing.condition, /no run finished yet/)
  })

  test('the standing says exactly what is left, in counted terms', () => {
    const standing = masteryOf(after(7, { bests: 1 }), 'snake')!
    assert.equal(standing.tier, 2)
    assert.equal(standing.next!.tier, 3)
    assert.match(standing.says, /7 of 15 runs finished/)
    assert.match(standing.says, /1 of 2 times you beat your own best/)
  })

  test('the tiers are in order and each asks for more than the last', () => {
    for (let i = 1; i < TIERS.length; i++) {
      const before = TIERS[i - 1].needs({ plays: 0, finished: 0, points: 0, bests: 0, hardFinished: 0, best: null, lastAt: null })
      const now_ = TIERS[i].needs({ plays: 0, finished: 0, points: 0, bests: 0, hardFinished: 0, best: null, lastAt: null })
      assert.ok(now_[0].target > before[0].target, `tier ${TIERS[i].tier} asks for no more finished runs than tier ${TIERS[i - 1].tier}`)
    }
  })

  test('the board leaves out the games nobody has played', () => {
    const record = after(3)
    const board = masteryBoard(record)
    assert.deepEqual(board.map((one) => one.gameId), ['snake'])
    const view = progressionView(record, 32)
    assert.equal(view.explored.played, 1)
    assert.equal(view.explored.games, 32)
    assert.match(view.says, /3 of 3 runs finished/)
  })

  test('with nothing recorded, the view says so rather than showing noughts', () => {
    const view = progressionView(emptyRecord('m'), 32)
    assert.equal(view.mastery.length, 0)
    assert.match(view.says, /Nothing recorded yet/)
    assert.match(view.level.says, /Nothing earned yet/)
  })
})

describe('the earning rule and the words for it stay together', () => {
  test('every bonus in the rule is a bonus the arithmetic can award', () => {
    const text = POINT_RULES.join(' ')
    for (const amount of [POINTS.finished, POINTS.normal, POINTS.hard, POINTS.newBest, POINTS.firstTime, POINTS.challenge]) {
      assert.ok(text.includes(String(amount)), `${amount} is awarded and the rules never mention it`)
    }
  })

  test('the breakdown adds up to the number beside it', () => {
    const earned = earnedFor(play({ id: '1', at: 0, difficulty: 'hard', newBest: true }), { firstFinishOfGame: true, challengeDone: true })
    assert.equal(earned.points, earned.parts.reduce((sum, one) => sum + one.points, 0))
    assert.equal(earned.points, POINTS.finished + POINTS.hard + POINTS.newBest + POINTS.firstTime + POINTS.challenge)
  })

  test('a best that was never measured earns no bonus for having been one', () => {
    const guessed = earnedFor(play({ id: '1', at: 0 }), { firstFinishOfGame: false, challengeDone: false })
    assert.equal(guessed.points, POINTS.finished + POINTS.normal)
  })
})
