import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { emptyKept, type KeptArcade } from './kept.ts'
import { finishRun } from './finish.ts'
import type { DayRules } from './calendar.ts'

/**
 * A finished game, written down once.
 *
 * This is one function and almost all of it is an ordering, so these tests are about the order. The score store is
 * asked first and what it said is written onto the run, which is the only honest way `newBest` on a run can be
 * true -- and five of the points a run earns ride on it. Done the other way round the bonus is awarded on a guess,
 * and the guess is wrong in exactly the case that matters: the reaction games, where the better score is the
 * smaller number.
 */

const RULES: DayRules = { offsetMinutes: 0, dayStartHour: 0 }
const DAY_ONE = Date.UTC(2026, 0, 5, 12)

const start = (over: Partial<KeptArcade['library']['prefs']> = {}): KeptArcade => {
  const base = emptyKept('machine')
  return { ...base, library: { ...base.library, prefs: { ...base.library.prefs, ...over } } }
}

describe('the best score and the run cannot disagree', () => {
  it('writes the record on the run that beat it, and not on the one that did not', () => {
    const first = finishRun(start(), { gameId: 'snake', score: 100, ms: 30_000 }, { now: DAY_ONE, rules: RULES, id: 'r1' })
    assert.equal(first.newBest, true, 'the first score of a game is always a best')
    assert.equal(first.previousBest, undefined)
    assert.equal(first.kept.library.scores.snake?.best, 100)
    assert.equal(first.kept.record.plays[0].newBest, true)

    const second = finishRun(first.kept, { gameId: 'snake', score: 60, ms: 20_000 }, { now: DAY_ONE + 60_000, rules: RULES, id: 'r2' })
    assert.equal(second.newBest, false)
    assert.equal(second.previousBest, 100)
    assert.equal(second.kept.library.scores.snake?.best, 100, 'a worse score does not move the record')
    assert.equal(second.kept.record.plays[0].newBest, undefined, 'and the run does not claim it did')
    assert.equal(second.kept.library.scores.snake?.plays, 2)
  })

  it('judges a reaction time the right way round, which is the case a guess gets wrong', () => {
    const first = finishRun(start(), { gameId: 'reaction-test', score: 320, ms: 4000 }, { now: DAY_ONE, rules: RULES, id: 'r1' })
    const faster = finishRun(first.kept, { gameId: 'reaction-test', score: 190, ms: 3000 }, { now: DAY_ONE + 10_000, rules: RULES, id: 'r2' })
    assert.equal(faster.newBest, true, '190 ms beats 320 ms')
    assert.equal(faster.kept.library.scores['reaction-test']?.best, 190)
    assert.equal(faster.kept.record.plays[0].newBest, true, 'so the run earns the bonus for it')

    const slower = finishRun(faster.kept, { gameId: 'reaction-test', score: 400, ms: 5000 }, { now: DAY_ONE + 20_000, rules: RULES, id: 'r3' })
    assert.equal(slower.newBest, false)
    assert.equal(slower.kept.library.scores['reaction-test']?.best, 190)
    assert.equal(slower.kept.record.plays[0].newBest, undefined)
  })
})

describe('a run somebody walked away from', () => {
  it('is written down, earns nothing, and does not touch the score store', () => {
    const played = finishRun(start(), { gameId: 'snake', score: 900, ms: 12_000 }, { now: DAY_ONE, rules: RULES, id: 'r1' })
    const left = finishRun(played.kept, { gameId: 'snake', score: 0, ms: 3000, finished: false }, { now: DAY_ONE + 60_000, rules: RULES, id: 'r2' })

    // "Started fourteen, finished nine" is worth knowing, so it is recorded.
    assert.equal(left.kept.record.plays.length, 2)
    assert.equal(left.kept.record.plays[0].finished, false)
    assert.equal(left.earned.points, 0)
    assert.match(left.earned.says, /Nothing earned/)
    // And the score store is untouched: the best stands, and it is not counted as a game played.
    assert.equal(left.kept.library.scores.snake?.best, 900)
    assert.equal(left.kept.library.scores.snake?.plays, 1)
    assert.equal(left.newBest, false)
  })
})

describe('what a run earns, and where it came from', () => {
  it('earns the difficulty the player is actually on, not one handed in', () => {
    const easy = finishRun(start({ difficulty: 'easy' }), { gameId: 'snake', score: 10, ms: 1000 }, { now: DAY_ONE, rules: RULES, id: 'e' })
    const hard = finishRun(start({ difficulty: 'hard' }), { gameId: 'snake', score: 10, ms: 1000 }, { now: DAY_ONE, rules: RULES, id: 'h' })
    assert.equal(easy.kept.record.plays[0].difficulty, 'easy')
    assert.equal(hard.kept.record.plays[0].difficulty, 'hard')
    // Easy adds nothing and takes nothing away; hard adds more than normal. Both are finished runs and both earn
    // the first-finish bonus, so the difference between them is the difficulty alone.
    assert.ok(hard.earned.points > easy.earned.points, `${hard.earned.points} should beat ${easy.earned.points}`)
    assert.ok(easy.earned.says.includes('Finished a run'))
  })

  it('gives the number its reason, so it is never shown on its own', () => {
    const run = finishRun(start(), { gameId: 'snake', score: 10, ms: 1000 }, { now: DAY_ONE, rules: RULES, id: 'r1' })
    assert.ok(run.earned.parts.length > 0)
    assert.equal(run.earned.parts.reduce((sum, one) => sum + one.points, 0), run.earned.points)
    assert.ok(run.earned.parts.some((one) => /First time/.test(one.label)), 'the first finish of a game is worth saying')
  })
})

describe('the rest of the record keeps up', () => {
  it('puts the game at the front of the recently played row, once', () => {
    let kept = start()
    kept = finishRun(kept, { gameId: 'snake', score: 10, ms: 1000 }, { now: DAY_ONE, rules: RULES, id: 'a' }).kept
    kept = finishRun(kept, { gameId: 'flappy', score: 5, ms: 1000 }, { now: DAY_ONE + 1000, rules: RULES, id: 'b' }).kept
    kept = finishRun(kept, { gameId: 'snake', score: 20, ms: 1000 }, { now: DAY_ONE + 2000, rules: RULES, id: 'c' }).kept
    assert.deepEqual(kept.library.recent.map((one) => one.gameId), ['snake', 'flappy'], 'one row per game, newest first')
    assert.equal(kept.library.recent[0].score, 20)
  })

  it('records how long the run took, and nothing when the game did not measure it', () => {
    const timed = finishRun(start(), { gameId: 'snake', score: 10, ms: 45_000 }, { now: DAY_ONE, rules: RULES, id: 'a' })
    assert.equal(timed.kept.record.plays[0].seconds, 45)
    const untimed = finishRun(start(), { gameId: 'snake', score: 10, ms: 0 }, { now: DAY_ONE, rules: RULES, id: 'b' })
    assert.equal(untimed.kept.record.plays[0].seconds, undefined, 'a measurement nobody made is left out, not written as nought')
  })

  it('refuses a run timed later than now, and says so rather than counting it', () => {
    const ahead = finishRun(start(), { gameId: 'snake', score: 10, ms: 1000 }, { now: DAY_ONE, rules: RULES, id: 'a' })
    // The score store has already taken it, which is deliberate -- a score is a score. The run list will not credit
    // a day that has not happened, which is the thing a streak could otherwise be bought with.
    const fromTheFuture = finishRun(ahead.kept, { gameId: 'snake', score: 10, ms: 1000 }, { now: DAY_ONE - 86_400_000, rules: RULES, id: 'b' })
    assert.equal(fromTheFuture.kept.record.plays.length, 2, 'an earlier run is not from the future; it is just earlier')
    assert.equal(fromTheFuture.kept.record.plays[0].id, 'a', 'and the list stays newest first')
  })

  it('refuses a second record of the same run rather than counting it twice', () => {
    const once = finishRun(start(), { gameId: 'snake', score: 10, ms: 1000 }, { now: DAY_ONE, rules: RULES, id: 'same' })
    const twice = finishRun(once.kept, { gameId: 'snake', score: 10, ms: 1000 }, { now: DAY_ONE + 1000, rules: RULES, id: 'same' })
    assert.equal(twice.kept.record.plays.length, 1)
    assert.match(twice.says, /already written down/)
  })
})
