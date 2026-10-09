/**
 * The week, and the month.
 *
 * ## What a report is allowed to say
 *
 * Only what the records actually contain. There is no model here and no guessing: every figure is counted from
 * sessions, XP events, tasks and measured mastery, and anything that cannot be counted is left out rather than
 * estimated. A study report that flatters is worse than none, because the student finds out it was wrong in an exam.
 *
 * ## Why "not enough yet" is a first-class answer
 *
 * Two sessions in a month do not support a sentence about trends. Asked for a report over a span with almost nothing
 * in it, this says so and stops -- rather than reporting a 100% completion rate off a single session, which is the
 * sort of number that makes somebody stop trusting the whole screen.
 *
 * ## No blame anywhere in it
 *
 * Missed days are counted and shown as a number of days studied, never as days failed. Nothing in here compares the
 * student to anybody else, and nothing in here says they should have done more.
 */

import { dayKey, shiftDay, weekKey } from './days.ts'
import { overall, type Mastery } from './mastery.ts'
import type { FocusSession, StudentTask, XPEvent } from './types.ts'

export type Span = 'week' | 'month'

export interface Report {
  span: Span
  /** The first and last day the report covers, inclusive. */
  from: string
  to: string
  days: number
  /** Days with at least one session that counted. Never presented as a score out of `days`. */
  daysStudied: number
  focusedSeconds: number
  sessions: number
  completed: number
  /** Sessions that were started and ended early. Counted, never scolded about. */
  endedEarly: number
  tasksCompleted: number
  xp: number
  bestDay: { day: string; seconds: number } | null
  longestSession: number
  subjects: readonly { subject: string; seconds: number; share: number }[]
  /** Concepts with evidence inside the span: what was actually worked on. */
  workedOn: readonly { conceptId: string; score: number }[]
  mastered: readonly string[]
  slipping: readonly string[]
  /** The hours of day most of the focused time happened in, when there is enough to tell. */
  bestHours: readonly number[]
  /** Compared with the span before this one. Null when there is nothing to compare with. */
  before: { focusedSeconds: number; sessions: number } | null
  /** Plain sentences. Each one is true of the figures above, and there are never more than four. */
  notes: readonly string[]
  /** True when the span holds too little to say anything about. Everything above is still counted. */
  thin: boolean
}

const DAYS: Record<Span, number> = { week: 7, month: 30 }

/** Enough to talk about: three sessions, and half an hour. Below that a report is noise dressed as insight. */
const ENOUGH_SESSIONS = 3
const ENOUGH_SECONDS = 1800

function counted(session: FocusSession): boolean {
  return session.focusedSeconds >= 300 && (session.state === 'completed' || session.state === 'ended-early')
}

function inSpan(day: string, from: string, to: string): boolean {
  return day >= from && day <= to
}

function spell(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minutes`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} ${hours === 1 ? 'hour' : 'hours'}` : `${hours}h ${rest}m`
}

export function reportFor(
  span: Span,
  now: number,
  everything: {
    sessions: readonly FocusSession[]
    xp: readonly XPEvent[]
    tasks: readonly StudentTask[]
    mastery: ReadonlyMap<string, Mastery>
    nameOf?(conceptId: string): string
  }
): Report {
  const length = DAYS[span]
  const to = dayKey(now)
  const from = shiftDay(to, -(length - 1))
  const earlierFrom = shiftDay(from, -length)
  const earlierTo = shiftDay(from, -1)

  const mine = everything.sessions.filter((one) => inSpan(dayKey(one.startedAt), from, to))
  const real = mine.filter(counted)
  const earlier = everything.sessions.filter((one) => counted(one) && inSpan(dayKey(one.startedAt), earlierFrom, earlierTo))

  const seconds = real.reduce((sum, one) => sum + one.focusedSeconds, 0)
  const byDay = new Map<string, number>()
  const byHour = new Map<number, number>()
  const bySubject = new Map<string, number>()
  for (const one of real) {
    const day = dayKey(one.startedAt)
    byDay.set(day, (byDay.get(day) ?? 0) + one.focusedSeconds)
    const hour = new Date(one.startedAt).getHours()
    byHour.set(hour, (byHour.get(hour) ?? 0) + one.focusedSeconds)
    if (one.subject) bySubject.set(one.subject, (bySubject.get(one.subject) ?? 0) + one.focusedSeconds)
  }

  const bestDay = [...byDay.entries()].sort((a, b) => b[1] - a[1])[0] ?? null
  const subjects = [...bySubject.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([subject, subjectSeconds]) => ({ subject, seconds: subjectSeconds, share: seconds === 0 ? 0 : subjectSeconds / seconds }))

  /*
   * Hours are only reported when there is enough spread to mean something.
   *
   * With two sessions, "you work best at 4pm" is a coincidence stated as a finding.
   */
  const bestHours =
    real.length >= 5
      ? [...byHour.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 2)
          .map(([hour]) => hour)
          .sort((a, b) => a - b)
      : []

  const workedOn: { conceptId: string; score: number }[] = []
  const mastered: string[] = []
  const slipping: string[] = []
  const name = (id: string): string => everything.nameOf?.(id) ?? id
  for (const [conceptId, held] of everything.mastery) {
    const lastDay = held.lastSeenAt > 0 ? dayKey(held.lastSeenAt) : null
    if (lastDay && inSpan(lastDay, from, to)) workedOn.push({ conceptId, score: overall(held) })
    if (held.state === 'mastered' && lastDay && inSpan(lastDay, from, to)) mastered.push(name(conceptId))
    if (held.state === 'slipping') slipping.push(name(conceptId))
  }
  workedOn.sort((a, b) => b.score - a.score)

  const thin = real.length < ENOUGH_SESSIONS || seconds < ENOUGH_SECONDS

  const notes: string[] = []
  if (thin) {
    notes.push(
      real.length === 0
        ? `No sessions in the last ${length} days, so there is nothing to report yet.`
        : `Only ${real.length} ${real.length === 1 ? 'session' : 'sessions'} in the last ${length} days — too little to say much about.`
    )
  } else {
    notes.push(`${spell(seconds)} across ${real.length} sessions, on ${byDay.size} ${byDay.size === 1 ? 'day' : 'days'}.`)
    if (subjects[0] && subjects.length > 1) notes.push(`Most of it went to ${subjects[0].subject} — ${Math.round(subjects[0].share * 100)}%.`)
    if (earlier.length > 0) {
      const beforeSeconds = earlier.reduce((sum, one) => sum + one.focusedSeconds, 0)
      const change = beforeSeconds === 0 ? null : (seconds - beforeSeconds) / beforeSeconds
      if (change !== null && Math.abs(change) >= 0.15) {
        // Said as a fact either way. A quieter fortnight is information, not a failing.
        notes.push(change > 0 ? `That is ${Math.round(change * 100)}% more than the ${span} before.` : `That is ${Math.round(-change * 100)}% less than the ${span} before.`)
      }
    }
    if (mastered.length > 0) notes.push(`${mastered.length} ${mastered.length === 1 ? 'topic' : 'topics'} now holding: ${mastered.slice(0, 3).join(', ')}.`)
    else if (slipping.length > 0) notes.push(`${slipping.length} ${slipping.length === 1 ? 'topic' : 'topics'} worth another look: ${slipping.slice(0, 3).join(', ')}.`)
  }

  return {
    span,
    from,
    to,
    days: length,
    daysStudied: byDay.size,
    focusedSeconds: seconds,
    sessions: real.length,
    completed: real.filter((one) => one.state === 'completed').length,
    endedEarly: real.filter((one) => one.state === 'ended-early').length,
    tasksCompleted: everything.tasks.filter((one) => one.completedAt !== null && inSpan(dayKey(one.completedAt), from, to)).length,
    xp: everything.xp.filter((one) => inSpan(dayKey(one.at), from, to)).reduce((sum, one) => sum + one.amount, 0),
    bestDay: bestDay ? { day: bestDay[0], seconds: bestDay[1] } : null,
    longestSession: real.reduce((most, one) => Math.max(most, one.focusedSeconds), 0),
    subjects,
    workedOn: workedOn.slice(0, 40),
    mastered: mastered.slice(0, 20),
    slipping: slipping.slice(0, 20),
    bestHours,
    before: earlier.length > 0 ? { focusedSeconds: earlier.reduce((sum, one) => sum + one.focusedSeconds, 0), sessions: earlier.length } : null,
    notes: notes.slice(0, 4),
    thin
  }
}

/** Which week a report covers, for showing beside it. */
export function weekOf(now: number): string {
  return weekKey(now)
}
