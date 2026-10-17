import { DAY, DEFAULT_DAY_RULES, dayBack, dayOf, dayStart, type Day, type DayRules } from './calendar.ts'
import { challengesDoneOn, playsOn } from './daily.ts'
import { isLate, type ArcadeRecord } from './record.ts'

/**
 * A run of days, counted by rules that cannot be got round.
 *
 * ## These are Chess World's rules, applied here
 *
 * `src/shared/chess/challenges.ts` settled this first and its reasoning is reused whole rather than invented a second
 * time. The wording below is the arcade's, because a chess puzzle is not a game of Snake, but the six rules are the
 * same six, and `streaks.test.ts` pushes against every one of them:
 *
 *   - only a run you finished counts, so opening a game and leaving it is not a day of play;
 *   - the same run counts once, and the earlier time is the one kept;
 *   - a run counts on the day it was played, from its own time. Today is never credited with yesterday's play;
 *   - a run timed later than now is ignored. A day that has not happened cannot be credited;
 *   - a run written down on a later day than the one it claims cannot repair that day. It still counts in your totals;
 *   - today does not break a run until it is over.
 *
 * ## Nothing is stored
 *
 * There is no streak counter. The run is counted from the list of runs every time it is shown, which is why it cannot
 * drift from what you did, and why there is nothing to lose by clearing it.
 *
 * ## It says how far back it can see
 *
 * Runs past the keeping limit are added up rather than kept one by one, and a day whose runs have been added up cannot
 * honestly be called met or missed. So the count stops at the oldest run still known by itself and says so, rather
 * than reading a day with no records as a day with no play.
 */

export type GoalMeasure =
  /** Runs finished that day, in any game. */
  | { kind: 'finished-runs' }
  /** Different games finished that day. */
  | { kind: 'different-games' }
  /** The day's challenges completed. */
  | { kind: 'challenge' }

export interface ArcadeGoal {
  id: string
  label: string
  target: number
  measure: GoalMeasure
  /** Exactly how it is counted, in words. */
  rule: string
}

export function describeGoal(measure: GoalMeasure, target: number): string {
  switch (measure.kind) {
    case 'finished-runs':
      return `${target} ${target === 1 ? 'run' : 'runs'} finished`
    case 'different-games':
      return `${target} different ${target === 1 ? 'game' : 'games'} finished`
    case 'challenge':
      return target === 1 ? "the day's challenge completed" : `${target} of the day's challenges completed`
  }
}

export function makeGoal(o: { id: string; label: string; target: number; measure: GoalMeasure }): ArcadeGoal {
  const target = Math.max(1, Math.round(o.target))
  return {
    ...o,
    target,
    rule: `${describeGoal(o.measure, target)} inside one day. `
      + 'A run counts on the day it was played and only if it finished. A run written down after that day cannot count towards it.'
  }
}

export const PLAY_ONE: ArcadeGoal = makeGoal({ id: 'play-one', label: 'Play something', target: 1, measure: { kind: 'finished-runs' } })
export const PLAY_THREE: ArcadeGoal = makeGoal({ id: 'play-three', label: 'Three runs', target: 3, measure: { kind: 'finished-runs' } })
export const TWO_GAMES: ArcadeGoal = makeGoal({ id: 'two-games', label: 'Two different games', target: 2, measure: { kind: 'different-games' } })
export const CHALLENGE: ArcadeGoal = makeGoal({ id: 'challenge', label: "The day's challenge", target: 1, measure: { kind: 'challenge' } })

export const DAILY_GOALS: readonly ArcadeGoal[] = Object.freeze([PLAY_ONE, PLAY_THREE, TWO_GAMES, CHALLENGE])

export const STREAK_RULES: readonly string[] = Object.freeze([
  'Only a run you finished counts. Opening a game and walking away is recorded, and it is not a day of play.',
  'The same run counts once. Two records with one id are one run, and the earlier time is the one kept.',
  'A run counts on the day it was played, from its own time. Today is never credited with yesterday\'s play.',
  'A run timed later than now is ignored. A day that has not happened cannot be credited.',
  'A run written down on a later day than the one it claims does not credit that day. It still counts in your totals; it cannot repair a run of days.',
  'Today does not break a run until it is over. Until the goal is met today, the run is counted up to yesterday and today is shown as still open.'
])

// ---------------------------------------------------------------- counting a day

export interface DayStanding {
  day: Day
  done: number
  target: number
  met: boolean
  /** True for the day `now` is in, which is still open. */
  current: boolean
}

function doneOn(goal: ArcadeGoal, record: ArcadeRecord, day: Day, now: number, rules: DayRules): number {
  const plays = playsOn(record, day, now, rules)
  switch (goal.measure.kind) {
    case 'finished-runs':
      return plays.length
    case 'different-games':
      return new Set(plays.map((one) => one.gameId)).size
    case 'challenge':
      return challengesDoneOn(record, day, now, rules)
  }
}

export interface StreakIgnored {
  future: number
  unfinished: number
  lateRecord: number
}

export interface Streak {
  goal: ArcadeGoal
  /** Days in a row, up to and including today when today is already met. */
  current: number
  /** The longest run inside the days that could be looked at. */
  longest: number
  /** How many days back were looked at, because `longest` is only about those. */
  looked: number
  /** The last day the goal was met. */
  lastMet: string | null
  /** True when today is already met. */
  nowMet: boolean
  /** Newest first. */
  days: readonly DayStanding[]
  /** Runs that were set aside, and why. */
  ignored: StreakIgnored
  /**
   * The earliest day that could honestly be judged, when older runs have been added up rather than kept.
   *
   * A run of days cannot be counted past it: a day with no records might be a day you did not play, or a day whose
   * records were added up, and nothing here can tell those apart.
   */
  coversFrom: number | null
  rules: readonly string[]
  says: string
}

export function streakOf(goal: ArcadeGoal, record: ArcadeRecord, now: number, rules: DayRules = DEFAULT_DAY_RULES, o: { look?: number } = {}): Streak {
  const look = Math.max(1, Math.min(400, o.look ?? 120))
  const ignored: StreakIgnored = {
    future: record.plays.filter((one) => one.at > now).length,
    unfinished: record.plays.filter((one) => one.at <= now && !one.finished).length,
    lateRecord: record.plays.filter((one) => one.at <= now && one.finished && isLate(one, rules)).length
  }
  /*
   * Where honest judging starts.
   *
   * Any day that had runs added up in it is a day whose records are now partly gone, so it cannot be called met or
   * missed -- and that includes the day the roll-up reached. The first day that can be judged is the one after it.
   */
  const coversFrom = record.before ? dayStart(record.before.upTo, rules) + DAY : null

  const days: DayStanding[] = []
  for (let back = 0; back < look; back++) {
    const day = dayBack(now, back, rules)
    if (coversFrom !== null && day.from < coversFrom) break
    const done = doneOn(goal, record, day, now, rules)
    days.push({ day, done, target: goal.target, met: done >= goal.target, current: back === 0 })
  }

  const nowMet = days[0]?.met ?? false
  // Today is open until it ends: the run counts from today when today is met, and from yesterday when it is not.
  // Otherwise every streak would read nought every morning.
  let current = 0
  for (let i = nowMet ? 0 : 1; i < days.length; i++) {
    if (!days[i].met) break
    current += 1
  }
  let longest = 0
  let run = 0
  for (const one of days) {
    run = one.met ? run + 1 : 0
    longest = Math.max(longest, run)
  }
  const lastMet = days.find((one) => one.met)?.day.key ?? null
  const todayDone = days[0]?.done ?? 0

  return {
    goal,
    current,
    longest,
    looked: days.length,
    lastMet,
    nowMet,
    days,
    ignored,
    coversFrom,
    rules: STREAK_RULES,
    says: days.length === 0
      ? 'Your runs have been added up rather than kept day by day, so no day can honestly be called met or missed at the moment. The longest run you have had is kept and still counts towards what has opened.'
      : current === 0
      ? lastMet === null
        ? `No day yet has met "${goal.label}".`
        : `No run at the moment. The last day that met "${goal.label}" was ${days.find((one) => one.met)?.day.label ?? lastMet}.`
      : `${current} ${current === 1 ? 'day' : 'days'} in a row`
        + (nowMet ? ', including today.' : `, up to yesterday. Today is still open: ${todayDone} of ${goal.target}.`)
  }
}

/** Streaks for several goals at once, strongest first, so a screen can show the one that is actually going. */
export function streaks(record: ArcadeRecord, now: number, rules: DayRules = DEFAULT_DAY_RULES, goals: readonly ArcadeGoal[] = DAILY_GOALS): Streak[] {
  return goals.map((goal) => streakOf(goal, record, now, rules)).sort((a, b) => b.current - a.current || b.longest - a.longest)
}

/** How a day stands against the one goal, for today's row on the screen. */
export function todayStanding(goal: ArcadeGoal, record: ArcadeRecord, now: number, rules: DayRules = DEFAULT_DAY_RULES): DayStanding {
  const day = dayOf(now, rules)
  const done = doneOn(goal, record, day, now, rules)
  return { day, done, target: goal.target, met: done >= goal.target, current: true }
}
