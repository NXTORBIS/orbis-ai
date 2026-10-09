import { dayKey, lastDays, weekKey } from './days.ts'
import type { DailyRecap, FocusSession, Insight, SessionRecommendation, StudentTask, XPEvent } from './types.ts'

/**
 * What a student actually did, and what to suggest next.
 *
 * ## No invented intelligence
 *
 * There is no focus score in here, and there will not be one. A number that claims to measure how well somebody
 * concentrated is made up, and worse, it is made up about them. What Orbis has are five honest measurements --
 * planned time, completed time, task progress, interruptions and distractions saved -- and every number shown to a
 * student is one of those or a plain sum of them.
 *
 * The same rule governs the wording. "You completed four of five planned sessions this week" is a fact. "You focus
 * better at night" is a claim about a person from a handful of samples, and Orbis does not make it. Where a pattern
 * is strong enough to be worth mentioning, it is said as what happened, with the count attached.
 *
 * Pure. Everything is derived from the sessions, so nothing here can disagree with the history.
 */

// ---------------------------------------------------------------- a day, a week, a month

export function recapFor(day: string, sessions: readonly FocusSession[], xp: readonly XPEvent[], tasks: readonly StudentTask[], learningItems: number, quizzes: number): DailyRecap {
  const mine = sessions.filter((one) => dayKey(one.startedAt) === day)
  const subjects = new Map<string, number>()
  let focused = 0
  let completed = 0
  let saved = 0
  for (const session of mine) {
    focused += session.focusedSeconds
    if (session.state === 'completed') completed += 1
    saved += session.savedForLater
    if (session.subject) subjects.set(session.subject, (subjects.get(session.subject) ?? 0) + session.focusedSeconds)
  }
  return {
    day,
    focusedSeconds: Math.round(focused),
    sessions: mine.length,
    completed,
    xp: xp.filter((one) => dayKey(one.at) === day).reduce((sum, one) => sum + one.amount, 0),
    tasksCompleted: tasks.filter((one) => one.completedAt !== null && dayKey(one.completedAt) === day).length,
    learningItems,
    quizzes,
    distractionsSaved: saved,
    subjects: [...subjects.entries()].map(([subject, seconds]) => ({ subject, seconds: Math.round(seconds) })).sort((a, b) => b.seconds - a.seconds)
  }
}

export interface WeekReview {
  week: string
  focusedSeconds: number
  sessions: number
  completed: number
  /** Seconds, averaged over the sessions that finished. Null when none did. */
  averageSeconds: number | null
  xp: number
  tasksCompleted: number
  distractionsSaved: number
  subjects: readonly { subject: string; seconds: number }[]
  /** Each day of the week, for a heatmap. */
  days: readonly { day: string; seconds: number; sessions: number }[]
  bestDay: string | null
}

export function weekReview(week: string, sessions: readonly FocusSession[], xp: readonly XPEvent[], tasks: readonly StudentTask[]): WeekReview {
  const mine = sessions.filter((one) => weekKey(one.startedAt) === week)
  const finished = mine.filter((one) => one.state === 'completed')
  const subjects = new Map<string, number>()
  const byDay = new Map<string, { seconds: number; sessions: number }>()
  let focused = 0
  let saved = 0
  for (const session of mine) {
    focused += session.focusedSeconds
    saved += session.savedForLater
    if (session.subject) subjects.set(session.subject, (subjects.get(session.subject) ?? 0) + session.focusedSeconds)
    const day = dayKey(session.startedAt)
    const held = byDay.get(day) ?? { seconds: 0, sessions: 0 }
    byDay.set(day, { seconds: held.seconds + session.focusedSeconds, sessions: held.sessions + 1 })
  }
  const days = [...byDay.entries()].map(([day, one]) => ({ day, seconds: Math.round(one.seconds), sessions: one.sessions })).sort((a, b) => a.day.localeCompare(b.day))
  return {
    week,
    focusedSeconds: Math.round(focused),
    sessions: mine.length,
    completed: finished.length,
    averageSeconds: finished.length > 0 ? Math.round(finished.reduce((sum, one) => sum + one.focusedSeconds, 0) / finished.length) : null,
    xp: xp.filter((one) => weekKey(one.at) === week).reduce((sum, one) => sum + one.amount, 0),
    tasksCompleted: tasks.filter((one) => one.completedAt !== null && weekKey(one.completedAt) === week).length,
    distractionsSaved: saved,
    subjects: [...subjects.entries()].map(([subject, seconds]) => ({ subject, seconds: Math.round(seconds) })).sort((a, b) => b.seconds - a.seconds),
    days,
    bestDay: days.length > 0 ? [...days].sort((a, b) => b.seconds - a.seconds)[0].day : null
  }
}

/** Focus per day for the last N days, every day present even when it was empty. For a calendar. */
export function heatmap(sessions: readonly FocusSession[], now: number, days = 70): { day: string; seconds: number }[] {
  const totals = new Map<string, number>()
  for (const session of sessions) {
    const day = dayKey(session.startedAt)
    totals.set(day, (totals.get(day) ?? 0) + session.focusedSeconds)
  }
  return lastDays(now, days).map((day) => ({ day, seconds: Math.round(totals.get(day) ?? 0) }))
}

/** The day's sessions in order, for a timeline. */
export function timeline(sessions: readonly FocusSession[], day: string): FocusSession[] {
  return sessions.filter((one) => dayKey(one.startedAt) === day).sort((a, b) => a.startedAt - b.startedAt)
}

// ---------------------------------------------------------------- what to suggest

/**
 * How long a session should be, from the lengths that actually got finished.
 *
 * The honest version of adaptive focus. If somebody finishes forty-minute sessions and abandons ninety-minute ones,
 * the suggestion is forty-five minutes and the reason given is exactly that -- not a claim about their attention
 * span. Below five finished sessions there is no suggestion from history at all, because four samples is not a
 * pattern and pretending otherwise is the same thing as making it up.
 */
export function recommend(sessions: readonly FocusSession[], options: { queue: readonly StudentTask[]; fallbackMinutes: number; fallbackLevel: FocusSession['level']; now: number }): SessionRecommendation | null {
  const task = options.queue[0] ?? null
  /*
   * Every real attempt, not only the ones that worked.
   *
   * Filtering to sessions that paid out would throw away exactly the evidence this is for: a student who abandons
   * ninety-minute sessions has told Orbis something, and it is the abandonment that says it.
   */
  const finished = sessions
    .filter((one) => one.focusedSeconds >= 300 && (one.state === 'completed' || one.state === 'ended-early' || one.state === 'expired'))
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, 30)

  if (finished.length < 5) {
    // Nothing to learn from yet, so the suggestion is what they chose in Settings and is described as that.
    return {
      minutes: options.fallbackMinutes,
      level: options.fallbackLevel,
      subject: task?.subject ?? null,
      taskId: task?.id ?? null,
      capsuleId: null,
      atmosphere: null,
      because: 'Your default session length.',
      confidence: 0.3
    }
  }

  const completed = finished.filter((one) => one.state === 'completed')
  const abandoned = finished.filter((one) => one.state === 'ended-early')
  const typical = median(completed.length >= 3 ? completed.map((one) => one.focusedSeconds / 60) : finished.map((one) => one.focusedSeconds / 60))
  // Round to a sensible number rather than suggesting 43 minutes, which reads like a machine talking.
  const minutes = Math.max(10, Math.min(120, Math.round(typical / 5) * 5))

  const last = finished[0]
  const level = modeOf(finished.map((one) => one.level)) ?? last.level
  const because =
    abandoned.length >= 2 && typical > 0
      ? `You finish sessions around ${minutes} minutes. Longer ones have been ended early ${abandoned.length} times.`
      : `Your completed sessions average about ${minutes} minutes.`

  return {
    minutes,
    level,
    subject: task?.subject ?? last.subject,
    taskId: task?.id ?? null,
    capsuleId: last.capsuleId,
    atmosphere: last.atmosphere,
    because,
    confidence: Math.min(0.9, 0.3 + finished.length * 0.02 + (completed.length >= 5 ? 0.2 : 0))
  }
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function modeOf<T>(values: readonly T[]): T | null {
  const counts = new Map<T, number>()
  for (const one of values) counts.set(one, (counts.get(one) ?? 0) + 1)
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
  return sorted.length > 0 ? sorted[0][0] : null
}

/** Whether a break is worth offering, and never more than offering. */
export function breakWorthOffering(session: FocusSession): boolean {
  return session.state === 'active' && session.focusedSeconds >= 50 * 60 && session.breaks.breakMinutes === 0
}

// ---------------------------------------------------------------- momentum, honestly

/**
 * How far through the work in front of somebody they are.
 *
 * Built only from things that can be counted: time completed against time planned, and tasks done against tasks on
 * the session. There is no mood, no estimate of concentration and no secret coefficient.
 */
export function momentum(session: FocusSession | null, tasksDone: number, tasksTotal: number): { value: number; parts: readonly { label: string; value: number }[] } {
  const parts: { label: string; value: number }[] = []
  if (session) {
    const planned = session.plannedMinutes * 60
    parts.push({ label: 'Time', value: planned > 0 ? Math.min(1, session.focusedSeconds / planned) : 0 })
    if (session.milestonesHit.length > 0) parts.push({ label: 'Milestones', value: Math.min(1, session.milestonesHit.length / 4) })
  }
  if (tasksTotal > 0) parts.push({ label: 'Tasks', value: Math.min(1, tasksDone / tasksTotal) })
  const value = parts.length > 0 ? parts.reduce((sum, one) => sum + one.value, 0) / parts.length : 0
  return { value, parts }
}

// ---------------------------------------------------------------- observations

/**
 * Observations worth showing, each one a count.
 *
 * Every line here could be checked by the student against their own history and found to be right. Anything that
 * could not be is not an insight, it is a guess with a confident voice.
 */
export function insights(sessions: readonly FocusSession[], tasks: readonly StudentTask[], now: number): Insight[] {
  const out: Insight[] = []
  const add = (id: string, text: string, kind: Insight['kind']): void => {
    out.push({ id, text, kind, at: now })
  }

  const week = weekKey(now)
  const thisWeek = sessions.filter((one) => weekKey(one.startedAt) === week)
  const done = thisWeek.filter((one) => one.state === 'completed')

  if (thisWeek.length >= 2) {
    add('week-completion', `You completed ${done.length} of ${thisWeek.length} sessions you started this week.`, 'focus')
  }

  const finished = sessions.filter((one) => one.state === 'completed')
  if (finished.length >= 5) {
    const average = Math.round(finished.reduce((sum, one) => sum + one.focusedSeconds, 0) / finished.length / 60)
    add('average-session', `Your average completed session is ${average} minutes.`, 'focus')
  }

  const saved = sessions.reduce((sum, one) => sum + one.savedForLater, 0)
  if (saved >= 3) add('saved', `You have saved ${saved} things for later instead of leaving a session.`, 'focus')

  const overdue = tasks.filter((one) => one.due !== null && one.due < now && one.state !== 'completed' && one.state !== 'archived').length
  if (overdue > 0) add('overdue', `${overdue} ${overdue === 1 ? 'task is' : 'tasks are'} past their date.`, 'goals')

  const estimated = tasks.filter((one) => one.state === 'completed' && one.estimate !== null && one.estimate > 0 && one.actual > 0)
  if (estimated.length >= 5) {
    const ratio = estimated.reduce((sum, one) => sum + one.actual / (one.estimate as number), 0) / estimated.length
    if (ratio > 1.25) add('estimates', `Your tasks have taken about ${Math.round(ratio * 100)}% of the time you estimated.`, 'goals')
    else if (ratio < 0.8) add('estimates', `You have been finishing tasks in about ${Math.round(ratio * 100)}% of your estimate.`, 'goals')
  }

  const interrupted = sessions.filter((one) => one.interruptions > 0).length
  if (interrupted >= 3) add('interruptions', `${interrupted} sessions were interrupted and picked up again.`, 'consistency')

  return out
}

/** The plainest possible summary of one session, for the completion screen and the history. */
export function sessionSummary(session: FocusSession): readonly { label: string; value: string }[] {
  const planned = `${session.plannedMinutes}m`
  const actual = `${Math.round(session.focusedSeconds / 60)}m`
  const out: { label: string; value: string }[] = [
    { label: 'Planned', value: planned },
    { label: 'Completed', value: actual }
  ]
  if (session.xpAwarded > 0) out.push({ label: 'XP', value: `+${session.xpAwarded}` })
  if (session.savedForLater > 0) out.push({ label: 'Saved for later', value: String(session.savedForLater) })
  if (session.distractionAttempts > 0) out.push({ label: 'Distractions held back', value: String(session.distractionAttempts) })
  if (session.interruptions > 0) out.push({ label: 'Interruptions', value: String(session.interruptions) })
  if (session.breakSeconds > 60) out.push({ label: 'Break', value: `${Math.round(session.breakSeconds / 60)}m` })
  return out
}
