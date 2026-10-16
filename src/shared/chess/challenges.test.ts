import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  ACHIEVEMENTS, DAILY_PRACTICE, DAILY_TEMPLATES, DAY_BOUNDARY_RULES, GAMIFICATION_OFF_MEANS, MEASURE_KINDS, PRACTICE,
  STREAK_RULES, TRAINING, WEEKLY_PRACTICE, WEEKLY_TEMPLATES, achievementStandings, achievementView, challengeBoard,
  challengeStandings, coachChallenges, countFor, dailyChallenges, describeMeasure, goalRule, goalStanding, makeGoal,
  periodBack, periodOf, streakOf, weeklyChallenges, type Goal, type GoalMeasure
} from './challenges.ts'
import { ACTIVITIES, ACTIVITY_KINDS, addPlanItem, dismissPlanItem, type ActivityKind, type StudyPlan } from './coach.ts'
import { dayKey, type ActivityEvent, type DayRules } from './progress.ts'

/**
 * Goals, and the counting rules that stop a streak being free.
 *
 * The suite called "a streak somebody is trying to game" is the point of this file. Each of its tests is one route
 * somebody would actually take -- reopen yesterday's finished lesson, report the same sitting twice, set a clock
 * forward, enter a record for a day that has already gone -- and each one has to leave the streak exactly where it
 * was. A streak that any of those extends is not worth drawing.
 */

const D = (y: number, m: number, d: number, h = 0): number => Date.UTC(y, m - 1, d, h)
const NOW = D(2026, 10, 16, 18)
const plain: DayRules = { offsetMinutes: 0, dayStartHour: 0 }

/** `n` real sittings of practice on a given day. */
function practice(day: number, n: number, o: { activity?: ActivityKind; tag?: string; succeeded?: boolean; clean?: boolean; seconds?: number } = {}): ActivityEvent[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${o.tag ?? 'p'}:${day}:${i}`,
    activity: o.activity ?? 'puzzle',
    thing: `e${i}`,
    // Morning, a minute apart: every sitting lands inside its own day however many are asked for.
    at: day + 3_600_000 * 8 + 60_000 * i,
    worked: true,
    succeeded: o.succeeded ?? true,
    clean: o.clean ?? true,
    ...(o.seconds === undefined ? {} : { seconds: o.seconds })
  }))
}

// ---------------------------------------------------------------- periods

describe('the date boundaries', () => {
  test('a day is a period with an identity, and the rules behind it are written down', () => {
    const today = periodOf('day', NOW, plain)
    assert.equal(today.key, '2026-10-16')
    assert.equal(today.label, '16 October 2026')
    assert.equal(today.to - today.from, 86_400_000)
    assert.ok(DAY_BOUNDARY_RULES.length >= 4)
    assert.ok(DAY_BOUNDARY_RULES.some((one) => /daylight-saving/.test(one)))
  })

  test('a week is named by its Monday', () => {
    const week = periodOf('week', NOW, plain)
    assert.equal(week.key, 'w:2026-10-12')
    assert.match(week.label, /the week beginning 12 October 2026/)
    assert.equal(week.to - week.from, 7 * 86_400_000)
  })

  test('a day in another time zone is that person\'s day, not the server\'s', () => {
    const india: DayRules = { offsetMinutes: 330, dayStartHour: 4 }
    assert.equal(periodOf('day', D(2026, 10, 16, 20), india).key, '2026-10-16')
    assert.equal(periodOf('day', D(2026, 10, 16, 23), india).key, '2026-10-17')
  })

  test('going back a period lands on the previous one, for days and for weeks', () => {
    assert.equal(periodBack('day', NOW, 1, plain).key, '2026-10-15')
    assert.equal(periodBack('day', NOW, 7, plain).key, '2026-10-09')
    assert.equal(periodBack('week', NOW, 1, plain).key, 'w:2026-10-05')
  })
})

// ---------------------------------------------------------------- goals

describe('a goal', () => {
  test('its rule is written from its measure, so the words and the arithmetic cannot drift', () => {
    const goal = makeGoal({ id: 'g', label: 'Five puzzles', period: 'day', target: 5, measure: { kind: 'attempts', activities: ['puzzle'] } })
    assert.equal(goal.rule, goalRule('day', 5, goal.measure))
    assert.match(goal.rule, /5 sittings at "Solve puzzles" where you actually played or answered something, inside one day/)
    assert.match(goal.rule, /A sitting where nothing was produced is not counted/)
  })

  test('every kind of measure can say what it counts, and no two say the same thing', () => {
    const said = MEASURE_KINDS.map((kind) => describeMeasure({ kind, activities: ['puzzle'] } as GoalMeasure))
    assert.equal(new Set(said).size, MEASURE_KINDS.length)
    for (const one of said) assert.ok(one.length > 15, one)
    assert.match(describeMeasure({ kind: 'attempts' }), /anything you did/)
    assert.match(describeMeasure({ kind: 'attempts', activities: PRACTICE }), /anything that counts as practice/)
  })

  test('a target below one is not a goal', () => {
    assert.equal(makeGoal({ id: 'g', label: 'x', period: 'day', target: 0, measure: { kind: 'attempts' } }).target, 1)
    assert.equal(makeGoal({ id: 'g', label: 'x', period: 'day', target: -3, measure: { kind: 'attempts' } }).target, 1)
  })

  test('the two standing goals are about practice, which excludes importing and watching', () => {
    assert.equal(DAILY_PRACTICE.period, 'day')
    assert.equal(WEEKLY_PRACTICE.period, 'week')
    assert.equal(PRACTICE.includes('import-game'), false)
    assert.equal(PRACTICE.includes('watch-broadcast'), false)
    for (const one of PRACTICE) assert.ok(ACTIVITY_KINDS.includes(one), one)
    for (const one of TRAINING) assert.ok(ACTIVITY_KINDS.includes(one), one)
  })
})

describe('counting a measure', () => {
  const events: ActivityEvent[] = [
    { id: 'a', activity: 'puzzle', thing: 'x', at: 1, worked: true, succeeded: true, clean: true, seconds: 300 },
    { id: 'b', activity: 'puzzle', thing: 'x', at: 2, worked: true, succeeded: true, clean: false, seconds: 300 },
    { id: 'c', activity: 'puzzle', thing: 'y', at: 3, worked: true, succeeded: false, clean: false, seconds: 60 },
    { id: 'd', activity: 'endgame', thing: 'z', at: 4, worked: true, succeeded: true, clean: true },
    { id: 'e', activity: 'puzzle', thing: 'w', at: 5, worked: false, succeeded: null, clean: null }
  ]

  test('each measure counts the thing it says it counts', () => {
    assert.equal(countFor({ kind: 'attempts' }, events), 4)
    assert.equal(countFor({ kind: 'successes' }, events), 3)
    assert.equal(countFor({ kind: 'clean-successes' }, events), 2)
    // Three, not four: two of the sittings were at the same exercise, which is what "distinct" means.
    assert.equal(countFor({ kind: 'distinct-things' }, events), 3)
    assert.equal(countFor({ kind: 'distinct-activities' }, events), 2)
    assert.equal(countFor({ kind: 'minutes' }, events), 11)
  })

  test('naming activities narrows every one of them', () => {
    assert.equal(countFor({ kind: 'attempts', activities: ['endgame'] }, events), 1)
    assert.equal(countFor({ kind: 'distinct-things', activities: ['puzzle'] }, events), 2)
    assert.equal(countFor({ kind: 'minutes', activities: ['endgame'] }, events), 0)
  })

  test('a sitting that produced nothing is counted by nothing', () => {
    assert.equal(countFor({ kind: 'attempts', activities: ['puzzle'] }, [events[4]]), 0)
  })
})

describe('how a goal stands', () => {
  test('it counts what belongs to the period and says what it set aside', () => {
    const events = [
      ...practice(D(2026, 10, 16), 2),
      ...practice(D(2026, 10, 15), 5, { tag: 'old' }),
      { id: 'reopened', activity: 'puzzle' as const, thing: 'done', at: D(2026, 10, 16, 9), worked: false, succeeded: null, clean: null },
      { id: 'later', activity: 'puzzle' as const, thing: 'soon', at: D(2026, 10, 17, 9), worked: true, succeeded: true, clean: true },
      { id: 'elsewhere', activity: 'import-game' as const, thing: 'file', at: D(2026, 10, 16, 10), worked: true, succeeded: null, clean: null }
    ]
    const standing = goalStanding(DAILY_PRACTICE, events, NOW, plain)
    assert.equal(standing.done, 2)
    assert.equal(standing.complete, false)
    assert.equal(standing.counted, 2)
    assert.equal(standing.ignored.otherPeriod, 5)
    assert.equal(standing.ignored.noWork, 1)
    assert.equal(standing.ignored.future, 1)
    assert.equal(standing.ignored.otherActivity, 1)
    assert.match(standing.says, /2 of 3/)
    assert.match(standing.says, /1 sitting produced nothing/)
  })

  test('two records of one sitting are one sitting', () => {
    const one = practice(D(2026, 10, 16), 3)
    const standing = goalStanding(DAILY_PRACTICE, [...one, ...one, ...one], NOW, plain)
    assert.equal(standing.done, 3)
    assert.equal(standing.ignored.duplicate, 6)
  })

  test('the bar does not draw past the end when the target is passed', () => {
    const standing = goalStanding(DAILY_PRACTICE, practice(D(2026, 10, 16), 20), NOW, plain)
    assert.equal(standing.done, 20)
    assert.equal(standing.complete, true)
    assert.equal(standing.fraction, 1)
    assert.match(standing.says, /^Done: 20 of 3/)
  })

  test('a goal can be asked about a period that is not now', () => {
    const events = practice(D(2026, 10, 14), 4, { tag: 'then' })
    const then = periodOf('day', D(2026, 10, 14), plain)
    assert.equal(goalStanding(DAILY_PRACTICE, events, NOW, plain, then).complete, true)
    assert.equal(goalStanding(DAILY_PRACTICE, events, NOW, plain).complete, false)
  })
})

// ---------------------------------------------------------------- the streak

describe('a run of days', () => {
  /** Six days in a row met, ending yesterday. */
  const sixDays = [10, 11, 12, 13, 14, 15].flatMap((d) => practice(D(2026, 10, d), 3, { tag: `d${d}` }))

  test('a genuine run is counted, and today being unfinished does not break it', () => {
    const streak = streakOf(DAILY_PRACTICE, sixDays, NOW, plain)
    assert.equal(streak.current, 6)
    assert.equal(streak.nowMet, false)
    assert.equal(streak.lastMet, '2026-10-15')
    assert.match(streak.says, /6 days in a row, up to yesterday/)
    assert.match(streak.says, /Today is still open: 0 of 3/)
  })

  test('meeting it today puts today in the run', () => {
    const streak = streakOf(DAILY_PRACTICE, [...sixDays, ...practice(D(2026, 10, 16), 3, { tag: 'today' })], NOW, plain)
    assert.equal(streak.current, 7)
    assert.equal(streak.nowMet, true)
    assert.match(streak.says, /7 days in a row, including today/)
  })

  test('a gap is a gap, and the run starts again after it', () => {
    const withGap = [10, 11, 14, 15].flatMap((d) => practice(D(2026, 10, d), 3, { tag: `d${d}` }))
    const streak = streakOf(DAILY_PRACTICE, withGap, NOW, plain)
    assert.equal(streak.current, 2)
    assert.equal(streak.longest, 2)
    assert.equal(streak.periods.find((one) => one.key === '2026-10-13')?.met, false)
  })

  test('the longest run is about the window that was looked at, and says how long that was', () => {
    const streak = streakOf(DAILY_PRACTICE, sixDays, NOW, plain, { look: 10 })
    assert.equal(streak.looked, 10)
    assert.equal(streak.periods.length, 10)
    assert.equal(streak.longest, 6)
  })

  test('with nothing ever done it says that rather than showing a nought as though a run had ended', () => {
    const streak = streakOf(DAILY_PRACTICE, [], NOW, plain)
    assert.equal(streak.current, 0)
    assert.equal(streak.longest, 0)
    assert.equal(streak.lastMet, null)
    assert.match(streak.says, /No day yet has met "Practise today"/)
  })

  test('a weekly goal makes a run of weeks', () => {
    const weeks = [0, 1, 2].flatMap((back) => practice(periodBack('week', NOW, back, plain).from, 20, { tag: `w${back}` }))
    const streak = streakOf(WEEKLY_PRACTICE, weeks, NOW, plain)
    assert.equal(streak.current, 3)
    assert.match(streak.says, /3 weeks in a row, including this week/)
  })

  test('the rules it goes by are on the record it hands back', () => {
    const streak = streakOf(DAILY_PRACTICE, sixDays, NOW, plain)
    assert.deepEqual(streak.rules, STREAK_RULES)
    assert.ok(STREAK_RULES.some((one) => /already finished/.test(one)))
    assert.ok(STREAK_RULES.some((one) => /counts once/.test(one)))
    assert.ok(STREAK_RULES.some((one) => /later than now is ignored/.test(one)))
    assert.ok(STREAK_RULES.some((one) => /cannot repair a streak/.test(one)))
  })
})

describe('a streak somebody is trying to game', () => {
  /** Six days met, ending yesterday. Today is empty, and every attempt below tries to fill it for free. */
  const sixDays = [10, 11, 12, 13, 14, 15].flatMap((d) => practice(D(2026, 10, d), 3, { tag: `d${d}` }))
  const today = D(2026, 10, 16)
  const run = (extra: ActivityEvent[]): ReturnType<typeof streakOf> => streakOf(DAILY_PRACTICE, [...sixDays, ...extra], NOW, plain)

  test('reopening things that were already finished does not count as a day of work', () => {
    const reopens: ActivityEvent[] = Array.from({ length: 12 }, (_, i) => ({
      id: `reopen:${i}`,
      activity: 'lesson',
      thing: `finished-${i}`,
      at: today + 3_600_000 * 10,
      worked: false,
      succeeded: true,
      clean: true,
      repeat: true
    }))
    const streak = run(reopens)
    assert.equal(streak.nowMet, false)
    assert.equal(streak.current, 6)
    assert.equal(streak.ignored.noWork, 12)
  })

  test('reporting one sitting twelve times is one sitting', () => {
    const one = practice(today, 1, { tag: 'once' })
    const streak = run([...one, ...one, ...one, ...one, ...one, ...one, ...one, ...one, ...one, ...one, ...one, ...one])
    assert.equal(streak.periods[0].done, 1)
    assert.equal(streak.nowMet, false)
    assert.equal(streak.current, 6)
    assert.equal(streak.ignored.duplicate, 11)
  })

  test('work timed in the future cannot credit today, or tomorrow', () => {
    const ahead = practice(D(2026, 10, 18), 5, { tag: 'ahead' })
    const streak = run(ahead)
    assert.equal(streak.nowMet, false)
    assert.equal(streak.current, 6)
    assert.equal(streak.ignored.future, 5)
    assert.equal(streak.periods[0].done, 0)
  })

  test('a record written down after its own day had closed cannot repair that day', () => {
    const late: ActivityEvent[] = practice(today, 5, { tag: 'late' }).map((one) => ({ ...one, recordedAt: D(2026, 10, 20, 9) }))
    const streak = run(late)
    assert.equal(streak.nowMet, false)
    assert.equal(streak.current, 6)
    assert.equal(streak.ignored.lateRecord, 5)
  })

  test('the same trick cannot fill a gap that has already broken a run', () => {
    const withGap = [10, 11, 14, 15].flatMap((d) => practice(D(2026, 10, d), 3, { tag: `g${d}` }))
    const patch: ActivityEvent[] = practice(D(2026, 10, 12), 3, { tag: 'patch' }).map((one) => ({ ...one, recordedAt: NOW }))
    const before = streakOf(DAILY_PRACTICE, withGap, NOW, plain)
    const after = streakOf(DAILY_PRACTICE, [...withGap, ...patch], NOW, plain)
    assert.equal(before.current, 2)
    assert.equal(after.current, 2)
    assert.equal(after.longest, 2)
    assert.equal(after.ignored.lateRecord, 3)
    // A record whose own day is the day it was written down is fine, and this one is not that.
    // Days 10, 11 and 12 now run together; the 13th is still missing, so the longest run is three and not five.
    const honest = practice(D(2026, 10, 12), 3, { tag: 'honest' }).map((one) => ({ ...one, recordedAt: one.at }))
    assert.equal(streakOf(DAILY_PRACTICE, [...withGap, ...honest], NOW, plain).longest, 3)
  })

  test('bringing in files and watching other people play cannot hold a streak up', () => {
    const imports = practice(today, 10, { tag: 'imp', activity: 'import-game' })
    const watched = practice(today, 10, { tag: 'watch', activity: 'watch-broadcast' })
    const streak = run([...imports, ...watched])
    assert.equal(streak.nowMet, false)
    assert.equal(streak.current, 6)
    assert.equal(streak.ignored.otherActivity, 20)
  })

  test('all four tricks at once still leave the run exactly where it was, and real work still counts', () => {
    const one = practice(today, 1, { tag: 'once' })
    const tricks: ActivityEvent[] = [
      ...one, ...one,
      ...practice(today, 4, { tag: 'reopen' }).map((e) => ({ ...e, worked: false })),
      ...practice(D(2026, 10, 19), 4, { tag: 'ahead' }),
      ...practice(today, 4, { tag: 'late' }).map((e) => ({ ...e, recordedAt: D(2026, 10, 25) })),
      ...practice(today, 4, { tag: 'imp', activity: 'import-game' })
    ]
    assert.equal(run(tricks).current, 6)
    assert.equal(run(tricks).nowMet, false)
    const honest = run([...tricks, ...practice(today, 2, { tag: 'real' })])
    assert.equal(honest.nowMet, true)
    assert.equal(honest.current, 7)
  })
})

// ---------------------------------------------------------------- challenges

describe('today\'s challenges', () => {
  test('they come from the date, so they are the same every time the screen is opened', () => {
    const first = dailyChallenges(NOW, plain)
    const again = dailyChallenges(NOW + 3_600_000, plain)
    assert.deepEqual(first.map((one) => one.id), again.map((one) => one.id))
    assert.equal(first.length, 3)
    assert.equal(dailyChallenges(NOW, plain, { count: 5 }).length, 5)
  })

  test('a different day is a different set, and the id carries the day', () => {
    const today = dailyChallenges(NOW, plain).map((one) => one.goal.id)
    const tomorrow = dailyChallenges(NOW + 86_400_000, plain).map((one) => one.goal.id)
    assert.notDeepEqual(today, tomorrow)
    assert.ok(today.every((one) => one.includes('2026-10-16')))
    assert.ok(tomorrow.every((one) => one.includes('2026-10-17')))
  })

  test('asking for more than there are gives all of them and not a repeat', () => {
    const all = dailyChallenges(NOW, plain, { count: 99 })
    assert.equal(all.length, DAILY_TEMPLATES.length)
    assert.equal(new Set(all.map((one) => one.label)).size, DAILY_TEMPLATES.length)
  })

  test('this week\'s challenges belong to this week', () => {
    const weekly = weeklyChallenges(NOW, plain)
    assert.equal(weekly.length, 2)
    for (const one of weekly) {
      assert.equal(one.period.key, 'w:2026-10-12')
      assert.equal(one.goal.period, 'week')
    }
  })

  test('every template asks for something Chess World has got, and says why it is worth doing', () => {
    for (const template of [...DAILY_TEMPLATES, ...WEEKLY_TEMPLATES]) {
      assert.ok(MEASURE_KINDS.includes(template.measure.kind), template.id)
      assert.ok(template.target >= 1, template.id)
      assert.ok(template.why.length > 20, template.id)
      for (const activity of template.measure.activities ?? []) {
        assert.ok(ACTIVITY_KINDS.includes(activity), `${template.id} asks for ${activity}`)
        assert.ok(ACTIVITIES[activity].records.length > 0, `${template.id} asks for something nothing records`)
      }
    }
    assert.equal(new Set([...DAILY_TEMPLATES, ...WEEKLY_TEMPLATES].map((one) => one.id)).size, DAILY_TEMPLATES.length + WEEKLY_TEMPLATES.length)
  })

  test('a challenge stands by the same counting as any other goal', () => {
    const challenge = dailyChallenges(NOW, plain, { count: 1, templates: [DAILY_TEMPLATES[0]] })[0]
    const standings = challengeStandings([challenge], practice(D(2026, 10, 16), 5), NOW, plain)
    assert.equal(standings[0].standing.done, 5)
    assert.equal(standings[0].standing.complete, true)
    assert.equal(standings[0].standing.period.key, '2026-10-16')
  })

  test('challenges made from the study plan skip the lines that were put aside', () => {
    let plan: StudyPlan = { items: [], updatedAt: 0 }
    plan = addPlanItem(plan, { id: 'a', title: 'Endgames', activity: 'endgame' }, 0)
    plan = addPlanItem(plan, { id: 'b', title: 'Puzzles', activity: 'puzzle' }, 0)
    plan = dismissPlanItem(plan, 'a', 0)
    const made = coachChallenges(plan, NOW, plain, { count: 5 })
    assert.deepEqual(made.map((one) => one.planItemId), ['b'])
    assert.equal(made[0].from, 'coach')
    assert.deepEqual(made[0].goal.measure, { kind: 'attempts', activities: ['puzzle'] })
    assert.match(made[0].why, /on your study plan/)
  })

  test('the plan can be handed in as a plain list of lines', () => {
    const made = coachChallenges([
      { id: 'a', from: 'person', title: 'Play', what: '', activity: 'play', order: 0, dismissed: false, addedAt: 0 }
    ], NOW, plain)
    assert.equal(made.length, 1)
    assert.equal(made[0].goal.measure.activities?.[0], 'play')
  })
})

// ---------------------------------------------------------------- achievements

describe('achievements', () => {
  test('each one says exactly what it is checked by', () => {
    assert.equal(new Set(ACHIEVEMENTS.map((one) => one.id)).size, ACHIEVEMENTS.length)
    for (const achievement of ACHIEVEMENTS) {
      assert.ok(achievement.condition.length > 25, achievement.id)
      assert.ok(achievement.label.length > 3, achievement.id)
      // It has to say how many, as a figure or as a word. A condition without a number is not checkable.
      assert.ok(/\d|\b(one|two|three|five|seven|ten|twenty|thirty|fifty|hundred)\b/i.test(achievement.condition), `${achievement.id} does not say how many`)
    }
  })

  test('nothing is awarded with nothing recorded', () => {
    const standings = achievementStandings(achievementView([], NOW, plain))
    assert.equal(standings.length, ACHIEVEMENTS.length)
    assert.equal(standings.some((one) => one.met), false)
    for (const one of standings) {
      assert.equal(one.done, 0)
      assert.match(one.says, /^0 of /)
    }
  })

  test('one played game earns the first one and nothing else', () => {
    const events = practice(D(2026, 10, 14), 1, { tag: 'g', activity: 'play', succeeded: undefined })
    const standings = achievementStandings(achievementView(events, NOW, plain))
    const met = standings.filter((one) => one.met).map((one) => one.achievement.id)
    assert.deepEqual(met, ['first-game'])
  })

  test('a count achievement is earned exactly at its target and not before', () => {
    const nine = Array.from({ length: 9 }, (_, i) => practice(D(2026, 10, 1 + i), 1, { tag: `g${i}`, activity: 'play' })).flat()
    const before = achievementStandings(achievementView(nine, NOW, plain)).find((one) => one.achievement.id === 'ten-games')
    assert.ok(before)
    assert.equal(before.met, false)
    assert.equal(before.done, 9)
    const ten = [...nine, ...practice(D(2026, 10, 11), 1, { tag: 'g9', activity: 'play' })]
    const after = achievementStandings(achievementView(ten, NOW, plain)).find((one) => one.achievement.id === 'ten-games')
    assert.ok(after)
    assert.equal(after.met, true)
    assert.equal(after.done, 10)
    assert.match(after.says, /^Done\./)
  })

  test('different exercises are counted once each, however many times they came back', () => {
    const same = Array.from({ length: 30 }, (_, i) => ({
      id: `a${i}`,
      activity: 'puzzle' as const,
      thing: 'one-exercise',
      at: D(2026, 10, 10) + i * 60_000,
      worked: true,
      succeeded: true,
      clean: true
    }))
    const standings = achievementStandings(achievementView(same, NOW, plain))
    assert.equal(standings.find((one) => one.achievement.id === 'twenty-different')?.done, 1)
    assert.equal(standings.find((one) => one.achievement.id === 'hundred-attempts')?.done, 30)
  })

  test('every kind of practice means every kind, and a sitting that produced nothing is not one', () => {
    const one = (activity: ActivityKind, worked = true): ActivityEvent => ({
      id: `k:${activity}`, activity, thing: `t:${activity}`, at: D(2026, 10, 12), worked, succeeded: true, clean: true
    })
    const five = TRAINING.slice(0, 5).map((activity) => one(activity))
    const withDud = [...five, one(TRAINING[5], false)]
    const standings = achievementStandings(achievementView(withDud, NOW, plain))
    const every = standings.find((item) => item.achievement.id === 'every-kind')
    assert.ok(every)
    assert.equal(every.done, 5)
    assert.equal(every.met, false)
    const all = [...five, one(TRAINING[5])]
    assert.equal(achievementStandings(achievementView(all, NOW, plain)).find((item) => item.achievement.id === 'every-kind')?.met, true)
  })

  test('the week of practice uses the real streak, so the tricks above cannot earn it', () => {
    const sixDays = [10, 11, 12, 13, 14, 15].flatMap((d) => practice(D(2026, 10, d), 3, { tag: `d${d}` }))
    const cheat = practice(D(2026, 10, 16), 5, { tag: 'cheat' }).map((one) => ({ ...one, worked: false }))
    const standings = achievementStandings(achievementView([...sixDays, ...cheat], NOW, plain))
    const week = standings.find((one) => one.achievement.id === 'week-of-practice')
    assert.ok(week)
    assert.equal(week.done, 6)
    assert.equal(week.met, false)
    const honest = [...sixDays, ...practice(D(2026, 10, 16), 3, { tag: 'real' })]
    assert.equal(achievementStandings(achievementView(honest, NOW, plain)).find((one) => one.achievement.id === 'week-of-practice')?.met, true)
  })

  test('nothing timed after now is counted towards anything', () => {
    const ahead = practice(D(2026, 10, 30), 200, { tag: 'ahead', activity: 'play' })
    const standings = achievementStandings(achievementView(ahead, NOW, plain))
    assert.equal(standings.some((one) => one.met), false)
  })

  test('the only opening lines that count are the ones that came back whole, counted once each', () => {
    const drills: ActivityEvent[] = [
      ...['a', 'b', 'c', 'd', 'e'].map((name, i) => ({ id: `w${i}`, activity: 'opening-drill' as const, thing: name, at: D(2026, 10, 10) + i, worked: true, succeeded: true, clean: true })),
      { id: 'again', activity: 'opening-drill', thing: 'a', at: D(2026, 10, 11), worked: true, succeeded: true, clean: true },
      { id: 'broke', activity: 'opening-drill', thing: 'f', at: D(2026, 10, 11), worked: true, succeeded: false, clean: false }
    ]
    const standings = achievementStandings(achievementView(drills, NOW, plain))
    const five = standings.find((one) => one.achievement.id === 'five-openings-whole')
    assert.ok(five)
    assert.equal(five.done, 5)
    assert.equal(five.met, true)
  })
})

// ---------------------------------------------------------------- the board, and switching it off

describe('the board', () => {
  const events = [
    ...[10, 11, 12, 13, 14, 15].flatMap((d) => practice(D(2026, 10, d), 3, { tag: `d${d}`, seconds: 300 })),
    ...practice(D(2026, 10, 16), 4, { tag: 'today', seconds: 300 })
  ]

  test('on, it is all worked out from the sittings, with the rules beside it', () => {
    const board = challengeBoard({ events, now: NOW, rules: plain })
    assert.equal(board.on, true)
    assert.equal(board.today.key, '2026-10-16')
    assert.equal(board.thisWeek.key, 'w:2026-10-12')
    assert.equal(board.daily.length, 3)
    assert.equal(board.weekly.length, 2)
    assert.equal(board.goals.length, 2)
    assert.ok(board.streak)
    assert.equal(board.streak.current, 7)
    assert.equal(board.achievements.length, ACHIEVEMENTS.length)
    assert.deepEqual(board.dayRules, DAY_BOUNDARY_RULES)
    assert.deepEqual(board.streakRules, STREAK_RULES)
    assert.match(board.says, /of today's challenges done/)
  })

  test('off, nothing is worked out and the screen is told what that means', () => {
    const board = challengeBoard({ events, now: NOW, rules: plain, on: false })
    assert.equal(board.on, false)
    assert.deepEqual(board.daily, [])
    assert.deepEqual(board.weekly, [])
    assert.deepEqual(board.goals, [])
    assert.deepEqual(board.achievements, [])
    assert.equal(board.streak, null)
    assert.deepEqual(board.offMeans, GAMIFICATION_OFF_MEANS)
    assert.match(board.says, /switched off/)
    assert.match(board.says, /nothing has been lost/)
    // The periods are still there: the screen can say which day it is without counting anything.
    assert.equal(board.today.key, '2026-10-16')
  })

  test('turning it off and on again loses nothing, because nothing was stored', () => {
    const before = challengeBoard({ events, now: NOW, rules: plain })
    challengeBoard({ events, now: NOW, rules: plain, on: false })
    const after = challengeBoard({ events, now: NOW, rules: plain })
    assert.deepEqual(after.daily.map((one) => one.standing.done), before.daily.map((one) => one.standing.done))
    assert.equal(after.streak?.current, before.streak?.current)
    assert.deepEqual(after.achievements.map((one) => one.done), before.achievements.map((one) => one.done))
    assert.ok(GAMIFICATION_OFF_MEANS.some((one) => /Nothing is lost/.test(one)))
    assert.ok(GAMIFICATION_OFF_MEANS.some((one) => /Weaknesses, the study plan and the progress measures are untouched/.test(one)))
  })

  test('with nothing recorded it says every one of them is at nought, rather than hiding them', () => {
    const board = challengeBoard({ events: [], now: NOW, rules: plain })
    assert.equal(board.on, true)
    assert.equal(board.daily.length, 3)
    assert.ok(board.daily.every((one) => one.standing.done === 0 && !one.standing.complete))
    assert.match(board.says, /Nothing has been recorded yet/)
  })

  test('a goal the caller names is used instead of the standing pair', () => {
    const mine: Goal = makeGoal({ id: 'mine', label: 'One game', period: 'day', target: 1, measure: { kind: 'attempts', activities: ['play'] } })
    const board = challengeBoard({ events, now: NOW, rules: plain, goals: [mine], streakGoal: mine })
    assert.deepEqual(board.goals.map((one) => one.goal.id), ['mine'])
    assert.equal(board.goals[0].done, 0)
    assert.equal(board.streak?.current, 0)
  })

  test('the plan\'s own challenges join the day\'s', () => {
    let plan: StudyPlan = { items: [], updatedAt: 0 }
    plan = addPlanItem(plan, { id: 'a', title: 'Puzzles', activity: 'puzzle' }, 0)
    const board = challengeBoard({ events, now: NOW, rules: plain, plan })
    assert.equal(board.fromPlan.length, 1)
    assert.equal(board.fromPlan[0].standing.complete, true)
    assert.equal(board.fromPlan[0].challenge.period.key, dayKey(NOW, plain))
  })
})
