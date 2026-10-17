import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { GAMES } from '../offlineGames.ts'
import { DAY, dayOf } from './calendar.ts'
import {
  SEEDABLE, challengeStanding, challengesForDay, completesChallenge, dailyChallenges, dailySeed, mixedRound,
  recentDailies, takesSeed, TEMPLATE_IDS, type DailyChallenge
} from './daily.ts'
import { addPlay, emptyRecord, type ArcadeRecord, type PlayRecord } from './record.ts'

/**
 * The day's challenge.
 *
 * What is really being tested here is that the challenge comes from the date and nothing else: the same one all day
 * however many times the screen is opened, a different one tomorrow, a different one on another machine, and -- the
 * one that is easy to get wrong -- the same one at nine in the evening as at nine in the morning, even though by then
 * you have played it.
 */

const RULES = { offsetMinutes: 0, dayStartHour: 0 }
const NOON = Date.UTC(2026, 9, 16, 12, 0, 0)

const play = (o: Partial<PlayRecord> & { at: number; id: string }): PlayRecord => ({
  gameId: 'snake',
  finished: true,
  score: 100,
  difficulty: 'normal',
  recordedAt: o.at,
  ...o
})

const withPlays = (plays: PlayRecord[], now = NOON, installId = 'machine-one'): ArcadeRecord => {
  let record = emptyRecord(installId)
  for (const one of plays) record = addPlay(record, one, now, RULES).record
  return record
}

const ids = (list: DailyChallenge[]): string[] => list.map((one) => one.id)

describe('the same day, the same challenge', () => {
  test('two asks on one day give the same thing', () => {
    const record = emptyRecord('machine-one')
    const morning = dailyChallenges({ record, now: Date.UTC(2026, 9, 16, 7, 30), rules: RULES, count: 2 })
    const evening = dailyChallenges({ record, now: Date.UTC(2026, 9, 16, 22, 15), rules: RULES, count: 2 })
    assert.deepEqual(ids(morning), ids(evening))
    assert.deepEqual(morning.map((one) => one.seed), evening.map((one) => one.seed))
  })

  test('a known date gives a known challenge, so this is checkable without running it', () => {
    const record = emptyRecord('orbis-test-machine')
    const list = dailyChallenges({ record, now: NOON, rules: RULES, count: 2 })
    assert.deepEqual(ids(list), ['daily:2026-10-16:finish-two:number-puzzle', 'daily:2026-10-16:finish-three:block-breaker'])
    assert.equal(list[0].label, 'Finish two runs of Fusion 2048')
    assert.equal(list[0].target, 2)
  })

  test('tomorrow is a different challenge', () => {
    const record = emptyRecord('machine-one')
    const today = dailyChallenges({ record, now: NOON, rules: RULES, count: 1 })
    const tomorrow = dailyChallenges({ record, now: NOON + DAY, rules: RULES, count: 1 })
    assert.notDeepEqual(ids(today), ids(tomorrow))
    // Over a fortnight it must really move around rather than rotate between two.
    const fortnight = new Set<string>()
    for (let n = 0; n < 14; n++) {
      for (const one of dailyChallenges({ record, now: NOON + n * DAY, rules: RULES, count: 1 })) fortnight.add(one.id.split(':')[2])
    }
    assert.ok(fortnight.size >= 3, `only ${fortnight.size} kinds of challenge in a fortnight`)
  })

  test('another machine gets another challenge', () => {
    const mine = emptyRecord('machine-one')
    const yours = emptyRecord('machine-two')
    let different = 0
    for (let n = 0; n < 10; n++) {
      const a = dailyChallenges({ record: mine, now: NOON + n * DAY, rules: RULES, count: 1 })[0]
      const b = dailyChallenges({ record: yours, now: NOON + n * DAY, rules: RULES, count: 1 })[0]
      if (a.label !== b.label) different += 1
    }
    assert.ok(different >= 7, `the two machines got the same challenge on ${10 - different} of ten days`)
  })

  test('a clock set backwards gives the day it is set to, and nothing is credited twice', () => {
    const record = withPlays([play({ id: '1', at: NOON })])
    const today = dailyChallenges({ record, now: NOON, rules: RULES, count: 1 })[0]
    // Someone sets the clock back a week. The challenge is that day's, not today's.
    const backThen = dailyChallenges({ record, now: NOON - 7 * DAY, rules: RULES, count: 1 })[0]
    assert.notEqual(today.id, backThen.id)
    assert.equal(backThen.day.key, dayOf(NOON - 7 * DAY, RULES).key)
    // And the run played today cannot count towards a challenge a week ago, because it is timed later than "now".
    const standing = challengeStanding(backThen, record, NOON - 7 * DAY, RULES)
    assert.equal(standing.done, 0)
    assert.equal(standing.ignored.future, 1)
  })

  test('playing it does not change it', () => {
    const before = emptyRecord('machine-one')
    const asked = dailyChallenges({ record: before, now: NOON, rules: RULES, count: 2 })
    const after = withPlays([
      play({ id: '1', at: NOON, gameId: asked[0].gameId ?? 'snake', newBest: true }),
      play({ id: '2', at: NOON + 1000, gameId: 'sudoku', newBest: true })
    ], NOON + 1000)
    assert.deepEqual(ids(dailyChallenges({ record: after, now: NOON + 2000, rules: RULES, count: 2 })), ids(asked))
  })

  test('"beat your own best" is only offered where there is a best from before today', () => {
    const fresh = challengesForDay(emptyRecord('machine-one'), dayOf(NOON, RULES), { installId: 'machine-one', count: 6 })
    assert.equal(fresh.length, TEMPLATE_IDS.length - 1)
    assert.ok(!fresh.some((one) => one.id.includes('beat-best')), 'nothing to beat, so it must not be asked for')

    const seasoned = withPlays([play({ id: 'old', at: NOON - 3 * DAY, newBest: true })])
    const offered = challengesForDay(seasoned, dayOf(NOON, RULES), { installId: 'machine-one', count: 6 })
    assert.equal(offered.length, TEMPLATE_IDS.length)
    const best = offered.find((one) => one.id.includes('beat-best'))!
    assert.equal(best.gameId, 'snake')
    assert.equal(best.target, 1)
  })

  test('a day’s own runs being added up does not change that day’s challenge', () => {
    // Four hundred and twenty runs today, which rolls some of today's own runs up. The challenge must not move.
    let record = emptyRecord('machine-one')
    const asked = ids(challengesForDay(record, dayOf(NOON, RULES), { installId: 'machine-one', count: 6 }))
    for (let n = 0; n < 420; n++) {
      record = addPlay(record, play({ id: `p${n}`, at: NOON - n * 1000, newBest: n === 0 }), NOON, RULES).record
    }
    assert.ok(record.before, 'this test needs runs to have been added up')
    assert.deepEqual(ids(challengesForDay(record, dayOf(NOON, RULES), { installId: 'machine-one', count: 6 })), asked)
  })

  test('a record set this morning does not change this afternoon’s challenge', () => {
    const record = withPlays([play({ id: 'today', at: Date.UTC(2026, 9, 16, 9, 0), newBest: true })])
    const morning = challengesForDay(emptyRecord('machine-one'), dayOf(NOON, RULES), { installId: 'machine-one', count: 6 })
    const afternoon = challengesForDay(record, dayOf(NOON, RULES), { installId: 'machine-one', count: 6 })
    assert.deepEqual(ids(afternoon), ids(morning))
  })
})

describe('the seed', () => {
  test('the same day, machine and game give the same seed, and nothing else does', () => {
    assert.equal(dailySeed('2026-10-16', 'm', 'snake'), dailySeed('2026-10-16', 'm', 'snake'))
    assert.notEqual(dailySeed('2026-10-16', 'm', 'snake'), dailySeed('2026-10-17', 'm', 'snake'))
    assert.notEqual(dailySeed('2026-10-16', 'm', 'snake'), dailySeed('2026-10-16', 'n', 'snake'))
    assert.notEqual(dailySeed('2026-10-16', 'm', 'snake'), dailySeed('2026-10-16', 'm', 'sudoku'))
  })

  test('a seed is never nought, because nought is the value a game reads when there is none', () => {
    for (let n = 0; n < 400; n++) {
      for (const game of GAMES.slice(0, 4)) assert.ok(dailySeed(`2026-01-${n}`, `m${n}`, game.id) > 0)
    }
  })

  test('a challenge only claims a fixed board for a game that takes the seed', () => {
    const record = emptyRecord('machine-one')
    for (let n = 0; n < 40; n++) {
      for (const one of dailyChallenges({ record, now: NOON + n * DAY, rules: RULES, count: 6 })) {
        if (one.gameId && takesSeed(one.gameId)) {
          assert.ok(one.seed !== null && one.fixedLayout, `${one.gameId} takes a seed and was not given one`)
          assert.match(one.says, /same board all day/)
        } else {
          assert.equal(one.seed, null)
          assert.equal(one.fixedLayout, false)
          assert.ok(!one.says.includes('same board'), `${one.gameId} cannot keep a board and said it could`)
        }
      }
    }
  })

  /**
   * The one claim here a player could not check for themselves.
   *
   * "The same board all day" is a promise about a game module, and a module that ignores the seed would keep dealing a
   * new board while the screen said otherwise -- silently, and only for the games on the list. So the list is checked
   * against the modules themselves: the registry says which file each game is in, and the file has to read the seed.
   */
  test('every game listed as taking the seed really reads it, and has no loose randomness left', async () => {
    const dir = resolve(import.meta.dirname, '../../renderer/src/games')
    const helper = await readFile(join(dir, 'seed.ts'), 'utf8')
    assert.match(helper, /dataset\.gameSeed/, 'the seed helper does not read what the window puts on the stage')
    assert.match(helper, /seeded\(/, 'the seed helper does not turn the seed into a random source')

    const registry = await readFile(join(dir, 'index.ts'), 'utf8')
    assert.ok(SEEDABLE.length > 0, 'nothing is listed as taking the seed, so no challenge can promise a fixed board')
    for (const id of SEEDABLE) {
      const line = new RegExp(`'?${id}'?\\s*:\\s*\\(\\)\\s*=>\\s*import\\('\\./([A-Za-z0-9_]+)'\\)`).exec(registry)
      assert.ok(line, `${id} is listed as taking the day's seed and is not in the game registry`)
      const source = await readFile(join(dir, `${line[1]}.ts`), 'utf8')
      assert.match(source, /gameRandom\(|dataset\.gameSeed/, `${id} is listed as taking the day's seed and ${line[1]}.ts never asks for it`)
      assert.ok(!/Math\.random/.test(source), `${line[1]}.ts still calls Math.random somewhere, so the seed does not really fix its run`)
    }
  })
})

describe('how a challenge stands', () => {
  const challenge = (): DailyChallenge => {
    const list = challengesForDay(emptyRecord('machine-one'), dayOf(NOON, RULES), { installId: 'machine-one', count: 6 })
    return list.find((one) => one.measure.kind === 'finish' && one.target === 2)!
  }

  test('finished runs of the right game on the right day count, and say so', () => {
    const one = challenge()
    const game = one.gameId!
    const record = withPlays([play({ id: 'a', at: NOON, gameId: game }), play({ id: 'b', at: NOON + 1000, gameId: game })], NOON + 2000)
    const standing = challengeStanding(one, record, NOON + 2000, RULES)
    assert.equal(standing.done, 2)
    assert.equal(standing.complete, true)
    assert.equal(standing.fraction, 1)
    assert.match(standing.says, /^Done: 2 of 2/)
  })

  test('every way a run does not count is reported rather than hidden', () => {
    const one = challenge()
    const game = one.gameId!
    const record = withPlays([
      play({ id: 'unfinished', at: NOON, gameId: game, finished: false }),
      play({ id: 'other-game', at: NOON, gameId: game === 'snake' ? 'sudoku' : 'snake' }),
      play({ id: 'yesterday', at: NOON - DAY, gameId: game, recordedAt: NOON - DAY }),
      play({ id: 'late', at: NOON - 2 * DAY, gameId: game, recordedAt: NOON })
    ], NOON + 5000)
    const standing = challengeStanding(one, record, NOON + 5000, RULES)
    assert.equal(standing.done, 0)
    assert.equal(standing.ignored.unfinished, 1)
    assert.equal(standing.ignored.otherGame, 1)
    assert.equal(standing.ignored.otherDay, 2)
    assert.match(standing.says, /left before the end/)
  })

  test('a run written down afterwards cannot complete a day that has gone', () => {
    const yesterday = challengesForDay(emptyRecord('machine-one'), dayOf(NOON - DAY, RULES), { installId: 'machine-one', count: 6 })
      .find((one) => one.measure.kind === 'finish' && one.target === 1)!
    const game = yesterday.gameId!
    const record = withPlays([play({ id: 'late', at: NOON - DAY, gameId: game, recordedAt: NOON })], NOON)
    const standing = challengeStanding(yesterday, record, NOON, RULES)
    assert.equal(standing.done, 0)
    assert.equal(standing.ignored.lateRecord, 1)
    assert.match(standing.says, /written down after that day/)
  })

  test('the rule written on a challenge says exactly how it is counted', () => {
    const one = challenge()
    assert.match(one.rule, /inside one day/)
    assert.match(one.rule, /only if it finished/)
    assert.match(one.rule, /written down after that day/)
  })

  test('the run that completes it is the one that earns it, once', () => {
    const one = challenge()
    const game = one.gameId!
    const first = play({ id: 'a', at: NOON, gameId: game })
    const second = play({ id: 'b', at: NOON + 1000, gameId: game })
    const third = play({ id: 'c', at: NOON + 2000, gameId: game })
    const none = emptyRecord('machine-one')
    assert.equal(completesChallenge(one, none, first, NOON, RULES), false, 'one of two is not done')
    const after = withPlays([first])
    assert.equal(completesChallenge(one, after, second, NOON + 1000, RULES), true)
    const done = withPlays([first, second], NOON + 1000)
    assert.equal(completesChallenge(one, done, third, NOON + 2000, RULES), false, 'already done, so there is nothing left to earn')
  })
})

describe('past days and the mixed round', () => {
  test('a past day is worked out the same way, so it can be played again', () => {
    const record = emptyRecord('machine-one')
    const week = recentDailies({ record, now: NOON, rules: RULES, days: 7, count: 1 })
    assert.equal(week.length, 7)
    assert.deepEqual(ids(week[0]), ids(dailyChallenges({ record, now: NOON, rules: RULES, count: 1 })))
    for (let n = 0; n < 7; n++) {
      assert.deepEqual(ids(week[n]), ids(challengesForDay(record, dayOf(NOON - n * DAY, RULES), { installId: 'machine-one', count: 1 })))
    }
    assert.equal(new Set(week.map((one) => one[0].day.key)).size, 7, 'seven days, not one day seven times')
  })

  test('the mixed round is five different games, the same all day', () => {
    const day = dayOf(NOON, RULES)
    const round = mixedRound(day, 'machine-one')
    assert.equal(round.length, 5)
    assert.equal(new Set(round).size, 5)
    assert.deepEqual(mixedRound(day, 'machine-one'), round)
    assert.notDeepEqual(mixedRound(dayOf(NOON + DAY, RULES), 'machine-one'), round)
    for (const id of round) assert.ok(GAMES.some((one) => one.id === id))
  })

  test('the round is five different games whatever the day', () => {
    for (let n = 0; n < 60; n++) {
      const round = mixedRound(dayOf(NOON + n * DAY, RULES), `machine-${n}`)
      assert.equal(new Set(round).size, 5, `the round for day ${n} repeated a game`)
    }
  })
})
