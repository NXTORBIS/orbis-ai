/**
 * Schedules said in words: "every Friday at 9am", "daily at 18:30", "tomorrow at 7", "every month on the 1st".
 *
 * The result is an ordinary workflow schedule for Orbis's one scheduler; nothing here runs anything. Anything that is not
 * clearly a time Orbis can keep — "every other Tuesday", "when it rains" — is refused rather than guessed, because a
 * schedule that quietly means something else is worse than none.
 */
import type { WorkflowSchedule } from './workflows.ts'
import { nextScheduledRun } from './workflows.ts'

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

/** "9", "9am", "9:30 pm", "18:30", "noon", "midnight" → hours and minutes. */
function timeOf(text: string): { h: number; m: number } | null {
  const t = text.trim().toLowerCase()
  if (t === 'noon' || t === 'midday') return { h: 12, m: 0 }
  if (t === 'midnight') return { h: 0, m: 0 }
  const match = /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/.exec(t)
  if (!match) return null
  let h = Number(match[1])
  const m = match[2] ? Number(match[2]) : 0
  const half = match[3]?.replace(/\./g, '')
  if (m > 59 || h > 23 || (half && (h < 1 || h > 12))) return null
  if (half === 'pm' && h < 12) h += 12
  if (half === 'am' && h === 12) h = 0
  return { h, m }
}

/** The first moment at or after `from` that is on this weekday / day of month at this time. */
function first(from: Date, time: { h: number; m: number }, opts: { weekday?: number; monthDay?: number } = {}): number {
  const d = new Date(from)
  d.setSeconds(0, 0)
  d.setHours(time.h, time.m)
  for (let i = 0; i < 400; i++) {
    const weekdayOk = opts.weekday === undefined || d.getDay() === opts.weekday
    const monthDayOk = opts.monthDay === undefined || d.getDate() === opts.monthDay
    if (weekdayOk && monthDayOk && d.getTime() > from.getTime()) return d.getTime()
    d.setDate(d.getDate() + 1)
    d.setHours(time.h, time.m, 0, 0)
  }
  return d.getTime()
}

export type ScheduleParse = { ok: true; schedule: WorkflowSchedule; said: string } | { ok: false; why: string }

/** A schedule phrase, understood strictly, relative to `now` in local time. */
export function parseSchedule(phrase: string, now = Date.now()): ScheduleParse {
  const text = phrase.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.!]+$/, '')
  const from = new Date(now)
  const at = (rest: string | undefined, fallback = { h: 9, m: 0 }): { h: number; m: number } | null => (rest ? timeOf(rest) : fallback)

  let match = /^(?:every day|everyday|daily|each day)(?: at (.+))?$/.exec(text)
  if (match) {
    const time = at(match[1])
    if (!time) return { ok: false, why: `I couldn't read the time in “${phrase}”.` }
    const schedule: WorkflowSchedule = { enabled: true, kind: 'daily', at: first(from, time) }
    return { ok: true, schedule, said: `every day at ${clock(time)}` }
  }

  match = /^(?:every|each|on) (sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?(?: at (.+))?$/.exec(text) ?? /^weekly on (sunday|monday|tuesday|wednesday|thursday|friday|saturday)(?: at (.+))?$/.exec(text)
  if (match) {
    const time = at(match[2])
    if (!time) return { ok: false, why: `I couldn't read the time in “${phrase}”.` }
    const weekday = DAYS.indexOf(match[1])
    return { ok: true, schedule: { enabled: true, kind: 'weekly', at: first(from, time, { weekday }) }, said: `every ${cap(match[1])} at ${clock(time)}` }
  }

  match = /^(?:every week|weekly)(?: at (.+))?$/.exec(text)
  if (match) {
    const time = at(match[1])
    if (!time) return { ok: false, why: `I couldn't read the time in “${phrase}”.` }
    return { ok: true, schedule: { enabled: true, kind: 'weekly', at: first(from, time) }, said: `every week on ${cap(DAYS[new Date(first(from, time)).getDay()])} at ${clock(time)}` }
  }

  match = /^(?:every month|monthly)(?: on the (\d{1,2})(?:st|nd|rd|th)?)?(?: at (.+))?$/.exec(text)
  if (match) {
    const time = at(match[2])
    if (!time) return { ok: false, why: `I couldn't read the time in “${phrase}”.` }
    const monthDay = match[1] ? Number(match[1]) : 1
    if (monthDay < 1 || monthDay > 28) return { ok: false, why: 'Monthly schedules can use days 1 to 28, so they happen every month.' }
    return { ok: true, schedule: { enabled: true, kind: 'monthly', at: first(from, time, { monthDay }) }, said: `every month on the ${ordinal(monthDay)} at ${clock(time)}` }
  }

  match = /^(today|tonight|tomorrow)(?: at (.+))?$/.exec(text)
  if (match) {
    const time = at(match[2], match[1] === 'tonight' ? { h: 20, m: 0 } : { h: 9, m: 0 })
    if (!time) return { ok: false, why: `I couldn't read the time in “${phrase}”.` }
    const day = new Date(from)
    if (match[1] === 'tomorrow') day.setDate(day.getDate() + 1)
    day.setHours(time.h, time.m, 0, 0)
    if (day.getTime() <= now) return { ok: false, why: 'That time has already passed.' }
    return { ok: true, schedule: { enabled: true, kind: 'once', at: day.getTime() }, said: `${match[1] === 'tonight' ? 'tonight' : match[1]} at ${clock(time)}` }
  }

  return { ok: false, why: `I can schedule things like “every Friday at 9am”, “daily at 18:30”, “every month on the 1st” or “tomorrow at 7”, but not “${phrase}”.` }
}

/** "every" said about something that repeats, for a chat request: "run Morning briefing every Friday at 9am". */
export function scheduleRequest(message: string): { name: string; phrase: string } | null {
  const text = message.trim().replace(/[.!]+$/, '')
  const match = /^(?:please\s+)?(?:run|repeat|do|schedule)\s+(?:the\s+)?(?:workflow|skill)?\s*[“"']?(.+?)[”"']?\s+((?:every|each|daily|weekly|monthly|everyday|tomorrow|today|tonight)\b.*)$/i.exec(text)
  return match ? { name: match[1].trim(), phrase: match[2].trim() } : null
}

/**
 * The most recent occurrence a schedule should have run at, if Orbis was closed then and it is recent enough to still be
 * worth running now. Only ever one: someone who was away for a week gets one catch-up run, not seven.
 */
export function missedRun(schedule: WorkflowSchedule, lastRunAt: number | undefined, now: number, graceMs = 24 * 3_600_000): number | null {
  if (!schedule.enabled) return null
  const since = Math.max(lastRunAt ?? 0, now - graceMs)
  if (schedule.kind === 'once') return schedule.at > since && schedule.at <= now ? schedule.at : null
  // Walk forward from the schedule's first time to find the last occurrence that is not in the future.
  let previous: number | null = null
  let cursor = schedule.at - 1
  for (let i = 0; i < 5000; i++) {
    const next = nextScheduledRun(schedule, cursor)
    if (next === null || next > now) break
    previous = next
    cursor = next
  }
  return previous !== null && previous > since ? previous : null
}

const cap = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1)
const ordinal = (n: number): string => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`
function clock(time: { h: number; m: number }): string {
  const h12 = time.h % 12 === 0 ? 12 : time.h % 12
  return `${h12}${time.m ? `:${String(time.m).padStart(2, '0')}` : ''}${time.h < 12 ? 'am' : 'pm'}`
}
