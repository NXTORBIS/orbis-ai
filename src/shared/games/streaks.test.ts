import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import * as chessChallenges from '../chess/challenges.ts'
import { DAY, dayKey } from './calendar.ts'
import { arcadeBoard, recordRun } from './arcade.ts'
import { challengesForDay, dailyChallenges } from './daily.ts'
import { POINTS, addPlay, emptyRecord, totalsOf, trim, type ArcadeRecord, type PlayRecord } from './record.ts'
import { CHALLENGE, DAILY_GOALS, PLAY_ONE, PLAY_THREE, STREAK_RULES, TWO_GAMES, streakOf, streaks, todayStanding } from './streaks.ts'
import { UNLOCKS, isOpen, unlockFacts, unlockStandings } from './unlocks.ts'

/**
 * The run of days, what opens as you play, and the one board the screen reads.
 *
 * Every test in the first block is a refusal. That is the shape of a streak: the interesting cases are all the ways a
 * day could be credited that it should not be, because each of those is a run of days somebody did not earn.
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

/** A record built as the runs happened, with `now` late enough that none of them is in the future. */
const built = (plays: PlayRecord[], now = NOON, rules = RULES, installId = 'machine-one'): ArcadeRecord => {
  let record = emptyRecord(installId)
  for (const one of plays) record = addPlay(record, one, now, rules).record
  return record
}

const OTHERS: PlayRecord['gameId'][] = ['snake', 'sudoku', 'solitaire', 'pipes', 'stacker']

/**
 * A run that moves the given challenge on by one, whatever it asks for.
 *
 * Written out rather than assumed, because which challenge a day gets is decided by the date -- so a test that plays
 * Snake on normal and expects a challenge to be met is a test that passes on some dates and not others.
 */
const advancing = (challenge: { measure: { kind: string; gameId?: PlayRecord['gameId'] } }, n: number, at: number): PlayRecord => {
  const measure = challenge.measure
  switch (measure.kind) {
    case 'finish-hard':
      return play({ id: `adv${n}`, at, gameId: measure.gameId, difficulty: 'hard' })
    case 'beat-best':
      return play({ id: `adv${n}`, at, gameId: measure.gameId, newBest: true })
    case 'different-games':
      return play({ id: `adv${n}`, at, gameId: OTHERS[n % OTHERS.length] })
    default:
      return play({ id: `adv${n}`, at, gameId: measure.gameId })
  }
}

/** One finished run on each of the given days back from today. */
const onDays = (backs: number[], o: { gameId?: PlayRecord['gameId']; at?: number } = {}): ArcadeRecord =>
  built(backs.map((back) => play({ id: `d${back}`, at: NOON - back * DAY, gameId: o.gameId ?? 'snake' })))

describe('the rules a day is credited by', () => {
  test('they are the six Chess World settled, said in the arcade’s words', () => {
    assert.equal(STREAK_RULES.length, chessChallenges.STREAK_RULES.length)
    for (const [at, rule] of STREAK_RULES.entries()) {
      assert.ok(rule.length > 40, `rule ${at} is too short to say what it means`)
      // The arcade's rules are about runs of games, so none of them may be left talking about puzzles or lessons.
      assert.ok(!/puzzle|lesson|chess/i.test(rule), `rule ${at} still speaks of chess`)
    }
    // The last one is word for word Chess World's, because nothing in it is about chess. The others are reworded.
    const same = STREAK_RULES.filter((rule, at) => rule === chessChallenges.STREAK_RULES[at])
    assert.equal(same.length, 1)
    assert.match(same[0], /still open/)
    assert.match(STREAK_RULES[0], /finished/)
    assert.match(STREAK_RULES[1], /counts once/)
    assert.match(STREAK_RULES[2], /day it was played/)
    assert.match(STREAK_RULES[3], /later than now/)
    assert.match(STREAK_RULES[4], /cannot repair/)
    assert.match(STREAK_RULES[5], /still open/)
  })

  test('a day with a finished run in it is met, and days in a row are a run', () => {
    const streak = streakOf(PLAY_ONE, onDays([0, 1, 2, 3]), NOON, RULES)
    assert.equal(streak.nowMet, true)
    assert.equal(streak.current, 4)
    assert.equal(streak.longest, 4)
    assert.match(streak.says, /4 days in a row, including today/)
  })

  test('a gap ends the run, and the longest run is still remembered', () => {
    const streak = streakOf(PLAY_ONE, onDays([0, 1, 3, 4, 5, 6]), NOON, RULES)
    assert.equal(streak.current, 2)
    assert.equal(streak.longest, 4)
  })

  test('today does not break a run until it is over', () => {
    const streak = streakOf(PLAY_ONE, onDays([1, 2, 3]), NOON, RULES)
    assert.equal(streak.nowMet, false)
    assert.equal(streak.current, 3, 'the run is counted up to yesterday while today is still open')
    assert.match(streak.says, /up to yesterday. Today is still open: 0 of 1/)
  })

  test('a run left before the end is not a day of play', () => {
    const record = built([
      play({ id: 'a', at: NOON - DAY }),
      play({ id: 'b', at: NOON, finished: false })
    ])
    const streak = streakOf(PLAY_ONE, record, NOON, RULES)
    assert.equal(streak.nowMet, false)
    assert.equal(streak.ignored.unfinished, 1)
    assert.equal(streak.current, 1)
  })

  test('the same run written down twice is one day, not two', () => {
    let record = built([play({ id: 'same', at: NOON })])
    record = addPlay(record, play({ id: 'same', at: NOON - DAY }), NOON, RULES).record
    const streak = streakOf(PLAY_ONE, record, NOON, RULES)
    assert.equal(record.plays.length, 1)
    assert.equal(streak.current, 1)
    assert.equal(streak.days[1].met, false, 'yesterday was never played; the second record was the same run')
  })

  test('a run timed later than now credits nothing', () => {
    let record = built([play({ id: 'today', at: NOON })])
    const refused = addPlay(record, play({ id: 'tomorrow', at: NOON + DAY }), NOON, RULES)
    record = refused.record
    assert.equal(refused.refused, 'future')
    const streak = streakOf(PLAY_ONE, record, NOON, RULES)
    assert.equal(streak.current, 1)
    assert.equal(streak.days[0].done, 1)
  })

  test('a clock set back does not hand out a run of days', () => {
    // Four days of real play, then the clock is moved back a week.
    const record = onDays([0, 1, 2, 3])
    const back = streakOf(PLAY_ONE, record, NOON - 7 * DAY, RULES)
    assert.equal(back.current, 0, 'none of those days has happened yet, from where the clock now says it is')
    assert.equal(back.longest, 0)
    assert.equal(back.ignored.future, 4)
    assert.match(back.says, /No day yet has met/)
    // And moving it forward again gives back exactly the run that was earned. Nothing was spent.
    assert.equal(streakOf(PLAY_ONE, record, NOON, RULES).current, 4)
  })

  test('a run written down later cannot repair the day it claims', () => {
    // Monday and Wednesday were played. On Wednesday, Tuesday's run is written down.
    const record = built([
      play({ id: 'mon', at: NOON - 2 * DAY }),
      play({ id: 'tue', at: NOON - DAY, recordedAt: NOON }),
      play({ id: 'wed', at: NOON })
    ])
    const streak = streakOf(PLAY_ONE, record, NOON, RULES)
    assert.equal(streak.ignored.lateRecord, 1)
    assert.equal(streak.current, 1, 'Tuesday is still a gap')
    assert.equal(streak.longest, 1)
    assert.equal(totalsOf(record).finished, 3, 'and the late run still counts in the totals')
  })

  test('a day is the day the run was played, not the day it is looked at', () => {
    const lateLastNight = Date.UTC(2026, 9, 15, 23, 50)
    const record = built([play({ id: 'late', at: lateLastNight })], lateLastNight, RULES)
    const streak = streakOf(PLAY_ONE, record, NOON, RULES)
    assert.equal(streak.days[0].done, 0, "today has nothing in it")
    assert.equal(streak.days[1].done, 1)
    assert.equal(streak.current, 1)
  })

  test('the day boundary is the one the rules set, not midnight UTC', () => {
    const twoInTheMorning = Date.UTC(2026, 9, 16, 2, 0)
    const fourAmRules = { offsetMinutes: 0, dayStartHour: 4 }
    const record = built([play({ id: 'small-hours', at: twoInTheMorning })], twoInTheMorning, fourAmRules)
    // At two in the morning, with the day starting at four, that run belongs to the fifteenth.
    assert.equal(dayKey(twoInTheMorning, fourAmRules), '2026-10-15')
    const streak = streakOf(PLAY_ONE, record, Date.UTC(2026, 9, 16, 12), fourAmRules)
    assert.equal(streak.days[0].done, 0)
    assert.equal(streak.days[1].done, 1)
    // Under plain midnight it would have been today's, which is the mistake this guards.
    assert.equal(streakOf(PLAY_ONE, record, Date.UTC(2026, 9, 16, 12), RULES).days[0].done, 1)
  })

  test('nothing played is said as nothing played', () => {
    const streak = streakOf(PLAY_ONE, emptyRecord('m'), NOON, RULES)
    assert.equal(streak.current, 0)
    assert.equal(streak.lastMet, null)
    assert.match(streak.says, /No day yet has met "Play something"/)
  })
})

describe('what the streak can honestly see', () => {
  test('a day whose runs were added up is not called missed', () => {
    const record = trim({ ...onDays([0, 1, 2, 3, 4, 5]), before: null }, 2)
    assert.ok(record.before)
    assert.ok(record.plays.length === 2)
    const streak = streakOf(PLAY_ONE, record, NOON, RULES)
    assert.notEqual(streak.coversFrom, null)
    // Only the days after the roll-up are judged at all.
    assert.ok(streak.looked <= 2, `${streak.looked} days were judged and only two are still known`)
    assert.equal(streak.days.every((one) => one.day.from >= streak.coversFrom!), true)
    if (streak.days.length === 0) assert.match(streak.says, /added up rather than kept day by day/)
  })

  test('with nothing added up, it looks back as far as it was asked to', () => {
    const streak = streakOf(PLAY_ONE, onDays([0, 1]), NOON, RULES, { look: 30 })
    assert.equal(streak.coversFrom, null)
    assert.equal(streak.looked, 30)
  })
})

describe('the goals a run of days can be held to', () => {
  test('three runs a day means three finished runs that day', () => {
    const twoADay = built([0, 1].flatMap((back) => [0, 1].map((n) => play({ id: `p${back}-${n}`, at: NOON - back * DAY - n * 1000 }))))
    assert.equal(streakOf(PLAY_THREE, twoADay, NOON, RULES).current, 0)
    const threeADay = built([0, 1].flatMap((back) => [0, 1, 2].map((n) => play({ id: `p${back}-${n}`, at: NOON - back * DAY - n * 1000 }))))
    assert.equal(streakOf(PLAY_THREE, threeADay, NOON, RULES).current, 2)
  })

  test('two different games means two different games, not one twice', () => {
    const twice = built([play({ id: 'a', at: NOON }), play({ id: 'b', at: NOON - 1000 })])
    assert.equal(todayStanding(TWO_GAMES, twice, NOON, RULES).done, 1)
    const two = built([play({ id: 'a', at: NOON }), play({ id: 'b', at: NOON - 1000, gameId: 'sudoku' })])
    assert.equal(todayStanding(TWO_GAMES, two, NOON, RULES).done, 2)
    assert.equal(todayStanding(TWO_GAMES, two, NOON, RULES).met, true)
  })

  test('the challenge goal counts the day’s challenge and nothing else', () => {
    const challenge = dailyChallenges({ record: emptyRecord('machine-one'), now: NOON, rules: RULES, count: 1 })[0]
    const wrongGame = challenge.gameId === 'runner' ? 'sudoku' : 'runner'
    const other = built([play({ id: 'a', at: NOON, gameId: wrongGame, difficulty: 'easy' })])
    assert.equal(todayStanding(CHALLENGE, other, NOON, RULES).met, false)

    let right = emptyRecord('machine-one')
    for (let n = 0; n < challenge.target; n++) {
      right = addPlay(right, advancing(challenge, n, NOON - n * 1000), NOON, RULES).record
    }
    assert.equal(todayStanding(CHALLENGE, right, NOON, RULES).met, true)
  })

  test('every goal says exactly how it is counted', () => {
    for (const goal of DAILY_GOALS) {
      assert.match(goal.rule, /inside one day/)
      assert.match(goal.rule, /only if it finished/)
      assert.ok(goal.label.length > 3)
    }
  })

  test('the strongest run comes first, so a screen shows the one that is going', () => {
    const record = built([0, 1, 2].flatMap((back) => [play({ id: `a${back}`, at: NOON - back * DAY }), play({ id: `b${back}`, at: NOON - back * DAY - 1000, gameId: 'sudoku' })]))
    const all = streaks(record, NOON, RULES)
    assert.equal(all[0].current >= all[all.length - 1].current, true)
    assert.equal(all.length, DAILY_GOALS.length)
  })
})

describe('what opens, and what it takes', () => {
  test('nothing is open to begin with', () => {
    const standings = unlockStandings(emptyRecord('m'), NOON, RULES)
    assert.equal(standings.length, UNLOCKS.length)
    assert.equal(standings.some((one) => one.open), false)
    for (const one of standings) {
      assert.match(one.says, /^0 of \d+\. /, 'an unlock nobody has earned must say what it takes')
      assert.ok(one.unlock.does.length > 30, `${one.unlock.id} does not say what it actually does`)
      assert.ok(one.unlock.condition.length > 10, `${one.unlock.id} does not say what it takes`)
    }
  })

  test('the day’s challenge opens on three finished runs, and not on three opened ones', () => {
    const opened = built([0, 1, 2].map((n) => play({ id: `u${n}`, at: NOON - n * 1000, finished: false })))
    assert.equal(isOpen('daily', opened, NOON, RULES), false)
    assert.equal(unlockFacts(opened, NOON, RULES).finished, 0)

    const finished = built([0, 1, 2].map((n) => play({ id: `f${n}`, at: NOON - n * 1000 })))
    assert.equal(isOpen('daily', finished, NOON, RULES), true)
  })

  test('the record board opens on five different games finished, not five runs', () => {
    const oneGame = built([0, 1, 2, 3, 4].map((n) => play({ id: `s${n}`, at: NOON - n * 1000 })))
    assert.equal(isOpen('board', oneGame, NOON, RULES), false)
    const five = built(['snake', 'sudoku', 'solitaire', 'pipes', 'stacker'].map((gameId, n) => play({ id: `g${n}`, at: NOON - n * 1000, gameId: gameId as PlayRecord['gameId'] })))
    assert.equal(isOpen('board', five, NOON, RULES), true)
  })

  test('harder goals open on a run of days that really happened', () => {
    assert.equal(isOpen('streak-goals', onDays([0, 1]), NOON, RULES), false)
    assert.equal(isOpen('streak-goals', onDays([0, 1, 2]), NOON, RULES), true)
    // Three days of records written down on the same day are not three days of play.
    const faked = built([0, 1, 2].map((back) => play({ id: `l${back}`, at: NOON - back * DAY, recordedAt: NOON })))
    assert.equal(isOpen('streak-goals', faked, NOON, RULES), false)
  })

  test('nothing that has been earned closes again when old runs are added up', () => {
    // Five days in a row, then four hundred runs today, which pushes those days past the keeping limit.
    let record = onDays([0, 1, 2, 3, 4])
    assert.equal(isOpen('streak-goals', record, NOON, RULES), true)
    const before = unlockStandings(record, NOON, RULES).filter((one) => one.open).map((one) => one.unlock.id)
    for (let n = 0; n < 420; n++) {
      record = addPlay(record, play({ id: `flood${n}`, at: NOON - n * 1000 }), NOON, RULES).record
    }
    assert.ok(record.before, 'the old runs should have been added up by now')
    // Today itself had runs added up in it, so there is no longer a single day the list can honestly judge.
    assert.equal(streakOf(PLAY_ONE, record, NOON, RULES).longest, 0)
    assert.equal(unlockFacts(record, NOON, RULES).longestRun, 5, 'and the run of days that really happened is kept')
    for (const id of before) assert.equal(isOpen(id, record, NOON, RULES), true, `${id} was open and closed again`)
  })

  test('isOpen and the standings never disagree', () => {
    const record = built([0, 1, 2, 3].map((n) => play({ id: `p${n}`, at: NOON - n * DAY, gameId: n % 2 ? 'sudoku' : 'snake' })))
    for (const standing of unlockStandings(record, NOON, RULES)) {
      assert.equal(isOpen(standing.unlock.id, record, NOON, RULES), standing.open, `${standing.unlock.id} is reported two ways`)
    }
  })
})

describe('the board the screen reads', () => {
  test('with nothing played, nothing is shown as nought', () => {
    const board = arcadeBoard({ record: emptyRecord('machine-one'), now: NOON, rules: RULES })
    assert.match(board.says, /Nothing has been played yet/)
    assert.deepEqual([...board.challenges], [])
    assert.equal(board.mixed, null)
    assert.equal(board.pastDays, null)
    assert.equal(board.progression.mastery.length, 0)
    assert.equal(board.goal.id, PLAY_ONE.id)
    assert.deepEqual([...board.goalChoices], [PLAY_ONE])
  })

  test('every part carries the rule it was worked out by', () => {
    const board = arcadeBoard({ record: emptyRecord('m'), now: NOON, rules: RULES })
    assert.ok(board.calendarRules.length >= 4)
    assert.equal(board.streakRules, STREAK_RULES)
    assert.ok(board.pointRules.length >= 5)
    assert.match(board.levelRule, /50 points more/)
    assert.match(board.todayGoal.day.label, /October 2026/)
  })

  test('a harder goal asked for too early falls back and says so', () => {
    const young = built([play({ id: 'a', at: NOON })])
    const board = arcadeBoard({ record: young, now: NOON, rules: RULES, goalId: PLAY_THREE.id })
    assert.equal(board.goal.id, PLAY_ONE.id)
    assert.equal(board.goalNotOpen, true)

    const earned = onDays([0, 1, 2])
    const open = arcadeBoard({ record: earned, now: NOON, rules: RULES, goalId: PLAY_THREE.id })
    assert.equal(open.goal.id, PLAY_THREE.id)
    assert.equal(open.goalNotOpen, false)
    assert.equal(open.goalChoices.length, DAILY_GOALS.length)
  })

  test('the day’s challenge appears once it is earned, with its standing', () => {
    const record = built([0, 1, 2].map((n) => play({ id: `f${n}`, at: NOON - n * 1000 })))
    const board = arcadeBoard({ record, now: NOON, rules: RULES })
    assert.equal(board.challenges.length, 1)
    assert.equal(board.challenges[0].challenge.day.key, dayKey(NOON, RULES))
    assert.match(board.says, /of 1 challenge done today/)
  })

  test('a second challenge appears only after twenty-five finished runs', () => {
    const twenty = built(Array.from({ length: 20 }, (_, n) => play({ id: `f${n}`, at: NOON - n * 1000 })))
    assert.equal(arcadeBoard({ record: twenty, now: NOON, rules: RULES }).challenges.length, 1)
    const plenty = built(Array.from({ length: 25 }, (_, n) => play({ id: `f${n}`, at: NOON - n * 1000 })))
    assert.equal(arcadeBoard({ record: plenty, now: NOON, rules: RULES }).challenges.length, 2)
  })
})

describe('writing a run down through the board', () => {
  const started = (): ArcadeRecord => built([0, 1, 2].map((n) => play({ id: `f${n}`, at: NOON - 3600_000 - n * 1000 })))

  test('the run that completes the day’s challenge earns the bonus, once', () => {
    const record = started()
    const challenge = dailyChallenges({ record, now: NOON, rules: RULES, count: 1 })[0]
    let current = record
    let awarded = 0
    for (let n = 0; n < challenge.target + 2; n++) {
      const result = recordRun({
        record: current,
        play: advancing(challenge, n, NOON + n * 1000),
        now: NOON + n * 1000,
        rules: RULES
      })
      current = result.added.record
      if (result.completed.length > 0) awarded += 1
      assert.equal(result.added.play!.points, result.added.earned.points)
    }
    assert.equal(awarded, 1, 'the bonus is for completing it, so only one run can earn it')
    assert.equal(totalsOf(current).challenges, 1)
    const done = arcadeBoard({ record: current, now: NOON + 9000, rules: RULES }).challenges[0]
    assert.equal(done.complete, true)
  })

  test('a run handed in claiming the challenge bonus has it worked out again here', () => {
    const record = started()
    const result = recordRun({
      record,
      play: { ...play({ id: 'liar', at: NOON, gameId: 'runner' }), challengeDone: true },
      now: NOON,
      rules: RULES
    })
    assert.equal(result.completed.length, 0)
    assert.equal(result.added.play!.challengeDone, false)
    assert.ok(!result.added.earned.parts.some((one) => one.points === POINTS.challenge))
  })

  test('the board that comes back is the board after the run', () => {
    const record = started()
    const before = arcadeBoard({ record, now: NOON, rules: RULES }).totals.finished
    const result = recordRun({ record, play: play({ id: 'one-more', at: NOON }), now: NOON, rules: RULES })
    assert.equal(result.board.totals.finished, before + 1)
    assert.equal(result.board.progression.level.points, totalsOf(result.added.record).points)
  })

  test('a past day can still be read, which is what makes replaying one possible', () => {
    const record = built([0, 1, 2, 3].map((n) => play({ id: `f${n}`, at: NOON - n * DAY })))
    const board = arcadeBoard({ record, now: NOON, rules: RULES })
    assert.equal(board.pastDays, null, 'replaying has not been earned yet')
    const earned = built([
      ...[0, 1, 2].map((n) => play({ id: `f${n}`, at: NOON - n * DAY })),
      ...Array.from({ length: 3 }, (_, n) => play({ id: `ch${n}`, at: NOON - n * 1000, challengeDone: true }))
    ])
    const open = arcadeBoard({ record: earned, now: NOON, rules: RULES })
    assert.equal(open.pastDays?.length, 7)
    assert.deepEqual(
      open.pastDays?.map((one) => one.day.key),
      Array.from({ length: 7 }, (_, n) => dayKey(NOON - n * DAY, RULES))
    )
    assert.deepEqual(
      open.pastDays?.[3].standings.map((one) => one.challenge.id),
      challengesForDay(earned, open.pastDays![3].day, { installId: 'machine-one', count: 1 }).map((one) => one.id)
    )
  })
})
