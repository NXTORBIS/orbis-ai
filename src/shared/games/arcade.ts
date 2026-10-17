import type { GameId } from '../offlineGames.ts'
import { GAMES } from '../offlineGames.ts'
import { CALENDAR_RULES, DEFAULT_DAY_RULES, dayBack, dayOf, type Day, type DayRules } from './calendar.ts'
import {
  challengeStandings, completesChallenge, dailyChallenges, challengesForDay, mixedRound,
  type ChallengeStanding, type DailyChallenge
} from './daily.ts'
import { LEVEL_RULE, progressionView, type Mastery, type ProgressionView, masteryOf } from './progression.ts'
import { POINT_RULES, addPlay, totalsOf, type Added, type ArcadeRecord, type PlayRecord, type Totals } from './record.ts'
import { DAILY_GOALS, PLAY_ONE, STREAK_RULES, streakOf, todayStanding, type ArcadeGoal, type DayStanding, type Streak } from './streaks.ts'
import { isOpen, unlockStandings, type UnlockId, type UnlockStanding } from './unlocks.ts'

/**
 * One board, for the screen to read.
 *
 * Everything the arcade knows about how you are getting on, worked out in one place from one list of runs: the level
 * and what it cost, where each game stands, the day's challenge, the run of days, and what is open. Each part carries
 * the rule it was worked out by, so a screen cannot show a figure without being able to show what it means.
 *
 * `now` is an argument. Nothing in these files reads a clock.
 */

export interface ArcadeBoard {
  now: number
  today: Day
  totals: Totals
  progression: ProgressionView
  /** The day's goal the run of days is counted against. */
  goal: ArcadeGoal
  /** True when a harder goal was asked for and has not been earned yet, so the simple one is being used. */
  goalNotOpen: boolean
  /** The goals that may be chosen at the moment. */
  goalChoices: readonly ArcadeGoal[]
  todayGoal: DayStanding
  streak: Streak
  /** Empty until the day's challenge has been earned. */
  challenges: readonly ChallengeStanding[]
  unlocks: readonly UnlockStanding[]
  /** The day's five-game round, when that is open. */
  mixed: readonly GameId[] | null
  /** The last seven days' challenges, when replaying is open. Newest first, today first. */
  pastDays: readonly { day: Day; standings: readonly ChallengeStanding[] }[] | null
  calendarRules: readonly string[]
  streakRules: readonly string[]
  pointRules: readonly string[]
  levelRule: string
  says: string
}

export function arcadeBoard(o: {
  record: ArcadeRecord
  now: number
  rules?: DayRules
  /** The goal the player picked, when they have picked one. */
  goalId?: string
  /** How many games the library offers, for "you have played 9 of 32". */
  libraryGames?: number
}): ArcadeBoard {
  const rules = o.rules ?? DEFAULT_DAY_RULES
  const record = o.record
  const today = dayOf(o.now, rules)
  const totals = totalsOf(record)
  const unlocks = unlockStandings(record, o.now, rules)
  const open = (id: UnlockId): boolean => unlocks.some((one) => one.unlock.id === id && one.open)

  const asked = DAILY_GOALS.find((one) => one.id === o.goalId)
  const harderOpen = open('streak-goals')
  const goal = asked && (harderOpen || asked.id === PLAY_ONE.id) ? asked : PLAY_ONE
  const goalChoices = harderOpen ? DAILY_GOALS : [PLAY_ONE]

  const dailyOpen = open('daily')
  const count = open('daily-second') ? 2 : 1
  const challenges = dailyOpen ? challengeStandings(dailyChallenges({ record, now: o.now, rules, count }), record, o.now, rules) : []

  const pastDays = open('replay')
    ? Array.from({ length: 7 }, (_, n) => {
        const day = dayBack(o.now, n, rules)
        return { day, standings: challengeStandings(challengesForDay(record, day, { installId: record.installId, count }), record, o.now, rules) }
      })
    : null

  const streak = streakOf(goal, record, o.now, rules)
  const doneToday = challenges.filter((one) => one.complete).length

  return {
    now: o.now,
    today,
    totals,
    progression: progressionView(record, o.libraryGames ?? GAMES.length),
    goal,
    goalNotOpen: Boolean(asked && asked.id !== goal.id),
    goalChoices,
    todayGoal: todayStanding(goal, record, o.now, rules),
    streak,
    challenges,
    unlocks,
    mixed: open('mixed') ? mixedRound(today, record.installId) : null,
    pastDays,
    calendarRules: CALENDAR_RULES,
    streakRules: STREAK_RULES,
    pointRules: POINT_RULES,
    levelRule: LEVEL_RULE,
    says: totals.plays === 0
      ? 'Nothing has been played yet. Every figure here is worked out from runs you finish, so they all start empty rather than at nought.'
      : dailyOpen
        ? `${doneToday} of ${challenges.length} ${challenges.length === 1 ? 'challenge' : 'challenges'} done today.`
        : `${totals.finished} ${totals.finished === 1 ? 'run' : 'runs'} finished. The day's challenge opens at three.`
  }
}

/** Where one game stands, for its card in the library. Null when it has never been played. */
export const gameStanding = (record: ArcadeRecord, gameId: GameId): Mastery | null => masteryOf(record, gameId)

export interface Recorded {
  added: Added
  /** The challenges this run finished off. */
  completed: readonly DailyChallenge[]
  /** The board as it stands after the run was written down. */
  board: ArcadeBoard
}

/**
 * Writes a finished run down, and works out what it earned.
 *
 * It asks the day's challenges whether this run completed one **before** writing it, so the bonus is written on the
 * run that earned it rather than worked out again later from a record that has moved on. The run itself decides
 * nothing: a run handed in with a challenge bonus already on it has it recomputed here.
 */
export function recordRun(o: {
  record: ArcadeRecord
  play: PlayRecord
  now: number
  rules?: DayRules
  goalId?: string
  libraryGames?: number
}): Recorded {
  const rules = o.rules ?? DEFAULT_DAY_RULES
  const count = isOpen('daily-second', o.record, o.now, rules) ? 2 : 1
  const todaysChallenges = isOpen('daily', o.record, o.now, rules) ? dailyChallenges({ record: o.record, now: o.now, rules, count }) : []
  const completed = todaysChallenges.filter((one) => completesChallenge(one, o.record, o.play, o.now, rules))
  const added = addPlay(o.record, { ...o.play, challengeDone: completed.length > 0 }, o.now, rules)
  return {
    added,
    completed,
    board: arcadeBoard({ record: added.record, now: o.now, rules, goalId: o.goalId, libraryGames: o.libraryGames })
  }
}
