import { dayKey, daysBetween, monthKey, shiftDay, weekKey } from './days.ts'
import type { AchievementMetric, AchievementRule, AchievementUnlock, LevelProgress, PersonalRecord, Quest, QuestMetric, QuestPeriod, QuestProgress, Streak, XPEvent, XPSource } from './types.ts'

/**
 * Orbis XP, levels, quests, achievements and streaks.
 *
 * ## The one rule that matters
 *
 * **Nothing adds to a balance.** XP is a ledger of events and a balance is their sum. Every event carries a `key`
 * derived from *what happened* -- `session:abc:complete`, `task:xyz`, `quest:daily-focus:2026-10-04` -- never from
 * when it was recorded. Recording an event whose key is already in the ledger does nothing at all.
 *
 * That is what makes a replayed completion harmless, and replays are not hypothetical: a session restored from disk
 * settles, a window that was closed mid-completion settles on restart, and a student who presses a button twice
 * settles twice. With a counter, each of those pays again. With a ledger keyed on the event, none of them can.
 *
 * ## The second rule
 *
 * Rewards are for finishing and for learning, never for hours. A ninety-minute session is worth more than a
 * fifty-minute one, but not twice as much, and a session that was started and abandoned is worth nothing -- see
 * `counts()` in session.ts. The point of the number is to say "you made progress", not "keep the application open".
 *
 * Pure: no storage, no clock of its own.
 */

// ---------------------------------------------------------------- what things are worth

/** XP for finishing a session of a given planned length. Rises with length, but less than in proportion to it. */
export function sessionXp(plannedMinutes: number, level: 'light' | 'focus' | 'deep', exam = false): number {
  const minutes = Math.max(0, Math.min(600, Math.round(plannedMinutes)))
  // Square-root-ish growth: 15 -> 15, 25 -> 25, 50 -> 50, 90 -> 100, 180 -> 141. Long sessions are worth more and
  // never worth farming, which is the difference between a reward and a treadmill.
  const base = minutes <= 50 ? minutes : Math.round(50 + Math.sqrt(minutes - 50) * 7.9)
  const weighted = level === 'deep' ? base * 1.15 : level === 'light' ? base * 0.85 : base
  return Math.round(exam ? Math.max(weighted, 75) : weighted)
}

export const XP_VALUES: Record<Exclude<XPSource, 'focus-session' | 'exam' | 'quest' | 'achievement'>, number> = {
  task: 30,
  'daily-goal': 50,
  'weekly-goal': 150,
  milestone: 60,
  goal: 200,
  word: 10,
  quiz: 20,
  teaser: 15,
  flashcards: 15,
  review: 10,
  streak: 25
}

/** Levels get longer as they go, so the early ones arrive quickly and the later ones mean something. */
export function xpForLevel(level: number): number {
  const n = Math.max(1, Math.round(level))
  if (n === 1) return 0
  // 1:0  2:300  3:700  4:1200  5:1800 ... level n needs 150n(n-1).
  return 150 * n * (n - 1)
}

export function levelFor(xp: number): LevelProgress {
  const total = Math.max(0, Math.round(xp))
  let level = 1
  while (xpForLevel(level + 1) <= total && level < 200) level += 1
  const from = xpForLevel(level)
  const to = xpForLevel(level + 1)
  return { level, xp: total, from, to, through: to > from ? (total - from) / (to - from) : 1 }
}

// ---------------------------------------------------------------- the ledger

export interface LedgerAdd {
  source: XPSource
  amount: number
  sourceId: string
  key: string
  subject?: string | null
  at: number
  id: string
}

export interface LedgerResult {
  events: readonly XPEvent[]
  /** What was actually paid. Zero when the key was already there. */
  awarded: number
  /** Whether a level was crossed, and which one is current now. */
  levelled: boolean
  level: LevelProgress
  /** True when the event was a duplicate and nothing happened. Not an error. */
  duplicate: boolean
}

/**
 * Records one XP event, once.
 *
 * `keys` is the set of keys already in the ledger. Passing it in rather than scanning the list keeps this O(1) for a
 * ledger that grows all year.
 */
export function award(events: readonly XPEvent[], keys: ReadonlySet<string>, profileId: string, add: LedgerAdd): LedgerResult {
  const before = levelFor(totalXp(events))
  if (keys.has(add.key) || add.amount <= 0) {
    return { events, awarded: 0, levelled: false, level: before, duplicate: keys.has(add.key) }
  }
  const event: XPEvent = {
    id: add.id,
    profileId,
    source: add.source,
    amount: Math.round(add.amount),
    sourceId: add.sourceId,
    key: add.key,
    subject: add.subject ?? null,
    at: add.at
  }
  const next = [...events, event]
  const after = levelFor(before.xp + event.amount)
  return { events: next, awarded: event.amount, levelled: after.level > before.level, level: after, duplicate: false }
}

export function totalXp(events: readonly XPEvent[]): number {
  let sum = 0
  for (const one of events) sum += one.amount
  return sum
}

export function xpOnDay(events: readonly XPEvent[], day: string): number {
  let sum = 0
  for (const one of events) if (dayKey(one.at) === day) sum += one.amount
  return sum
}

export function xpBySubject(events: readonly XPEvent[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const one of events) {
    if (!one.subject) continue
    out[one.subject] = (out[one.subject] ?? 0) + one.amount
  }
  return out
}

// ---------------------------------------------------------------- quests

export const QUESTS: readonly Quest[] = [
  { id: 'daily-focus', period: 'daily', title: 'Focus for 25 minutes', metric: 'focus-minutes', target: 25, xp: 20 },
  { id: 'daily-word', period: 'daily', title: 'Learn the word of the day', metric: 'words', target: 1, xp: 10 },
  { id: 'daily-quiz', period: 'daily', title: 'Answer one quiz', metric: 'quizzes', target: 1, xp: 15 },
  { id: 'daily-task', period: 'daily', title: 'Finish one task', metric: 'tasks-completed', target: 1, xp: 20 },
  { id: 'weekly-sessions', period: 'weekly', title: 'Five Focus sessions', metric: 'focus-sessions', target: 5, xp: 60 },
  { id: 'weekly-hours', period: 'weekly', title: 'Five hours of Focus', metric: 'focus-minutes', target: 300, xp: 80 },
  { id: 'weekly-learning', period: 'weekly', title: 'Three learning topics', metric: 'learning-items', target: 3, xp: 50 },
  { id: 'weekly-milestones', period: 'weekly', title: 'Two goal milestones', metric: 'milestones', target: 2, xp: 70 },
  { id: 'monthly-sessions', period: 'monthly', title: 'Twenty Focus sessions', metric: 'focus-sessions', target: 20, xp: 150 },
  { id: 'monthly-hours', period: 'monthly', title: 'Fifteen hours of Focus', metric: 'focus-minutes', target: 900, xp: 200 },
  { id: 'monthly-quizzes', period: 'monthly', title: 'Ten quizzes', metric: 'quizzes', target: 10, xp: 120 },
  { id: 'monthly-reviews', period: 'monthly', title: 'Fifty concepts reviewed', metric: 'reviews', target: 50, xp: 150 }
]

/** Finishing every daily quest is worth something on top of each one. */
export const DAILY_SWEEP_XP = 50

export function periodKeyFor(period: QuestPeriod, at: number): string {
  return period === 'daily' ? dayKey(at) : period === 'weekly' ? weekKey(at) : monthKey(at)
}

/**
 * Moves every quest on by what just happened.
 *
 * Takes the whole set rather than one quest, because a single event usually counts towards several -- a finished
 * session is a daily quest, a weekly one and a monthly one at the same time, and doing them one at a time is how
 * two of the three get forgotten.
 */
export function advanceQuests(progress: readonly QuestProgress[], metric: QuestMetric, by: number, at: number): QuestProgress[] {
  if (by <= 0) return [...progress]
  const out = [...progress]
  for (const quest of QUESTS) {
    if (quest.metric !== metric) continue
    const key = periodKeyFor(quest.period, at)
    const index = out.findIndex((one) => one.questId === quest.id && one.periodKey === key)
    const held = index >= 0 ? out[index] : { questId: quest.id, period: quest.period, periodKey: key, value: 0, target: quest.target, completedAt: null, settled: false }
    if (held.completedAt !== null) continue
    const value = held.value + by
    const next: QuestProgress = { ...held, value, target: quest.target, completedAt: value >= quest.target ? at : null }
    if (index >= 0) out[index] = next
    else out.push(next)
  }
  // Keep it bounded: this period and the two before it are all anything looks at.
  return out.filter((one) => withinRecent(one, at))
}

function withinRecent(one: QuestProgress, at: number): boolean {
  if (one.period === 'daily') {
    const gap = daysBetween(one.periodKey, dayKey(at))
    return gap !== null && gap <= 7
  }
  if (one.period === 'weekly') {
    const gap = daysBetween(one.periodKey, weekKey(at))
    return gap !== null && gap <= 28
  }
  return one.periodKey >= monthKey(at - 90 * 24 * 3600 * 1000)
}

/** The quests for right now, with their titles, ready to draw. */
export function questsNow(progress: readonly QuestProgress[], at: number): (QuestProgress & { title: string; xp: number })[] {
  return QUESTS.map((quest) => {
    const key = periodKeyFor(quest.period, at)
    const held = progress.find((one) => one.questId === quest.id && one.periodKey === key)
    return {
      questId: quest.id,
      period: quest.period,
      periodKey: key,
      value: held?.value ?? 0,
      target: quest.target,
      completedAt: held?.completedAt ?? null,
      settled: held?.settled ?? false,
      title: quest.title,
      xp: quest.xp
    }
  })
}

/** Whether every daily quest is done, which is worth its own payment -- once per day. */
export function dailySweep(progress: readonly QuestProgress[], at: number): boolean {
  const key = dayKey(at)
  const daily = QUESTS.filter((one) => one.period === 'daily')
  return daily.every((quest) => progress.some((one) => one.questId === quest.id && one.periodKey === key && one.completedAt !== null))
}

// ---------------------------------------------------------------- achievements

export const ACHIEVEMENTS: readonly AchievementRule[] = [
  { id: 'first-focus', title: 'First Focus', blurb: 'You finished your first session.', category: 'focus', metric: 'sessions', threshold: 1, xp: 25, unlocks: 'orbi-glow' },
  { id: 'ten-sessions', title: 'Ten Sessions', blurb: 'Ten finished sessions.', category: 'focus', metric: 'sessions', threshold: 10, xp: 50, unlocks: 'room-books' },
  { id: 'fifty-sessions', title: 'Fifty Sessions', blurb: 'Fifty finished sessions.', category: 'focus', metric: 'sessions', threshold: 50, xp: 150, unlocks: 'room-bookshelf' },
  { id: 'first-deep', title: 'Deep Focus', blurb: 'You finished a Deep Focus session.', category: 'focus', metric: 'deep-sessions', threshold: 1, xp: 40, unlocks: 'orbi-glasses' },
  { id: 'hundred-minutes', title: '100 Minutes', blurb: 'A hundred minutes of Focus.', category: 'focus', metric: 'focus-minutes', threshold: 100, xp: 30, unlocks: null },
  { id: 'ten-hours', title: '10 Hours', blurb: 'Ten hours of Focus.', category: 'focus', metric: 'focus-minutes', threshold: 600, xp: 80, unlocks: 'room-plant' },
  { id: 'fifty-hours', title: '50 Hours', blurb: 'Fifty hours of Focus.', category: 'mastery', metric: 'focus-minutes', threshold: 3000, xp: 200, unlocks: 'room-telescope' },
  { id: 'hundred-hours', title: '100 Hours', blurb: 'A hundred hours of Focus.', category: 'mastery', metric: 'focus-minutes', threshold: 6000, xp: 400, unlocks: 'room-constellation' },
  { id: 'marathon', title: 'Study Marathon', blurb: 'A single session over ninety minutes.', category: 'focus', metric: 'longest-session', threshold: 90, xp: 60, unlocks: 'orbi-hoodie' },
  { id: 'week-streak', title: 'Seven Days', blurb: 'A week of studying.', category: 'consistency', metric: 'focus-streak', threshold: 7, xp: 70, unlocks: 'orbi-cap' },
  { id: 'month-streak', title: 'Thirty Days', blurb: 'A month of studying.', category: 'consistency', metric: 'focus-streak', threshold: 30, xp: 250, unlocks: 'room-certificate' },
  { id: 'comeback', title: 'Comeback', blurb: 'You came back and started small.', category: 'consistency', metric: 'comeback', threshold: 1, xp: 30, unlocks: null },
  { id: 'first-capsule', title: 'First Capsule', blurb: 'You saved a session you can start again.', category: 'exploration', metric: 'capsules', threshold: 1, xp: 20, unlocks: null },
  { id: 'first-goal', title: 'First Goal', blurb: 'You set something to work toward.', category: 'goals', metric: 'goals', threshold: 1, xp: 25, unlocks: null },
  { id: 'five-goals', title: 'Five Goals', blurb: 'Five goals finished.', category: 'goals', metric: 'goals', threshold: 5, xp: 120, unlocks: 'room-art' },
  { id: 'ten-milestones', title: 'Ten Milestones', blurb: 'Ten milestones behind you.', category: 'goals', metric: 'milestones', threshold: 10, xp: 90, unlocks: null },
  { id: 'fifty-tasks', title: 'Fifty Tasks', blurb: 'Fifty tasks done.', category: 'goals', metric: 'tasks', threshold: 50, xp: 100, unlocks: 'orbi-backpack' },
  { id: 'wordsmith', title: 'Wordsmith', blurb: 'Thirty words learned.', category: 'learning', metric: 'words', threshold: 30, xp: 80, unlocks: 'room-monitor' },
  { id: 'quiz-fifty', title: 'Fifty Quizzes', blurb: 'Fifty quizzes answered.', category: 'learning', metric: 'quizzes', threshold: 50, xp: 100, unlocks: 'orbi-tablet' },
  { id: 'reviewer', title: 'Reviewer', blurb: 'A hundred reviews done.', category: 'learning', metric: 'reviews', threshold: 100, xp: 120, unlocks: 'room-science' },
  { id: 'learning-week', title: 'Learning Week', blurb: 'Seven days of learning.', category: 'learning', metric: 'learning-streak', threshold: 7, xp: 60, unlocks: null }
]

export type AchievementCounts = Partial<Record<AchievementMetric, number>>

/**
 * Which achievements have just been earned.
 *
 * Centralised here rather than checked wherever a number happens to change, which is how the same achievement ends up
 * unlocked by two different code paths with two different thresholds.
 */
export function newUnlocks(counts: AchievementCounts, already: readonly AchievementUnlock[], at: number): AchievementUnlock[] {
  const held = new Set(already.map((one) => one.achievementId))
  const out: AchievementUnlock[] = []
  for (const rule of ACHIEVEMENTS) {
    if (held.has(rule.id)) continue
    const value = counts[rule.metric] ?? 0
    if (value >= rule.threshold) out.push({ achievementId: rule.id, at, value })
  }
  return out
}

export function achievementById(id: string): AchievementRule | null {
  return ACHIEVEMENTS.find((one) => one.id === id) ?? null
}

// ---------------------------------------------------------------- streaks

export function emptyStreak(kind: Streak['kind']): Streak {
  return { kind, current: 0, longest: 0, lastDay: null, days: [], restDays: [] }
}

/**
 * A day counted towards a streak.
 *
 * Rest days neither break a streak nor extend it: a student who marked Sunday as rest and studied Saturday and
 * Monday has a three-day streak of two study days, and nothing was taken away from them for resting. That is the
 * whole philosophy here -- consistency, not punishment -- and it is why a missed day does not zero `longest`.
 */
export function countDay(streak: Streak, day: string): Streak {
  if (streak.days.includes(day)) return streak
  const days = [...new Set([day, ...streak.days])].sort().reverse().slice(0, 400)
  const current = runFrom(day, days, streak.restDays)
  return {
    ...streak,
    days,
    lastDay: day,
    current,
    longest: Math.max(streak.longest, current)
  }
}

/** How many days in a row end at `day`, stepping over rest days. */
function runFrom(day: string, days: readonly string[], restDays: readonly string[]): number {
  const counted = new Set(days)
  const rest = new Set(restDays)
  let run = 0
  let cursor = day
  // A hard stop, because a bad date key must not turn into an endless walk backwards.
  for (let i = 0; i < 400; i += 1) {
    if (counted.has(cursor)) run += 1
    else if (!rest.has(cursor)) break
    cursor = shiftDay(cursor, -1)
  }
  return run
}

/** What a streak looks like today, which is not always what was last written down. */
export function streakNow(streak: Streak, now: number): Streak {
  const today = dayKey(now)
  if (!streak.lastDay) return streak
  const current = runFrom(today, streak.days.includes(today) ? streak.days : [...streak.days], streak.restDays)
  // Yesterday still counts as "going", so a streak does not look broken all morning before somebody has studied.
  const yesterday = runFrom(shiftDay(today, -1), streak.days, streak.restDays)
  return { ...streak, current: Math.max(current, streak.days.includes(today) ? current : yesterday) }
}

export function markRestDay(streak: Streak, day: string): Streak {
  if (streak.restDays.includes(day)) return streak
  return { ...streak, restDays: [...new Set([day, ...streak.restDays])].sort().reverse().slice(0, 200) }
}

/** Streak milestones worth a word. Not every day, so the ones that are said mean something. */
export const STREAK_MARKS: readonly number[] = [3, 7, 14, 30, 60, 100, 180, 365]

export function streakMark(current: number): number | null {
  return STREAK_MARKS.includes(current) ? current : null
}

/** Whether somebody has been away long enough that coming back deserves an easy way in. */
export function awayDays(streak: Streak, now: number): number {
  if (!streak.lastDay) return 0
  return Math.max(0, daysBetween(streak.lastDay, dayKey(now)) ?? 0)
}

// ---------------------------------------------------------------- records

export function emptyRecords(): PersonalRecord {
  return {
    longestSessionSeconds: 0,
    longestSessionAt: null,
    totalFocusedSeconds: 0,
    bestDaySeconds: 0,
    bestDay: null,
    bestWeekSeconds: 0,
    bestWeek: null,
    mostXpInDay: 0,
    mostXpDay: null,
    mostTasksInDay: 0,
    longestFocusStreak: 0,
    longestLearningStreak: 0
  }
}

export interface RecordInput {
  sessionSeconds: number
  at: number
  daySeconds: number
  weekSeconds: number
  dayXp: number
  dayTasks: number
  focusStreak: number
  learningStreak: number
}

/** Personal bests, compared only against the same person. There is no leaderboard and will not be one. */
export function updateRecords(records: PersonalRecord, input: RecordInput): PersonalRecord {
  const day = dayKey(input.at)
  const week = weekKey(input.at)
  return {
    longestSessionSeconds: Math.max(records.longestSessionSeconds, input.sessionSeconds),
    longestSessionAt: input.sessionSeconds > records.longestSessionSeconds ? input.at : records.longestSessionAt,
    totalFocusedSeconds: records.totalFocusedSeconds + Math.max(0, input.sessionSeconds),
    bestDaySeconds: Math.max(records.bestDaySeconds, input.daySeconds),
    bestDay: input.daySeconds > records.bestDaySeconds ? day : records.bestDay,
    bestWeekSeconds: Math.max(records.bestWeekSeconds, input.weekSeconds),
    bestWeek: input.weekSeconds > records.bestWeekSeconds ? week : records.bestWeek,
    mostXpInDay: Math.max(records.mostXpInDay, input.dayXp),
    mostXpDay: input.dayXp > records.mostXpInDay ? day : records.mostXpDay,
    mostTasksInDay: Math.max(records.mostTasksInDay, input.dayTasks),
    longestFocusStreak: Math.max(records.longestFocusStreak, input.focusStreak),
    longestLearningStreak: Math.max(records.longestLearningStreak, input.learningStreak)
  }
}

/** Whether there is enough history for a record to be worth showing at all. */
export function recordsWorthShowing(records: PersonalRecord, sessions: number): boolean {
  return sessions >= 3 && records.totalFocusedSeconds > 1800
}
