import { addDays, daysInMonth, isKnownZone, wallTimeAt, zonedToEpoch, type DstResolution } from './zone.ts'

/**
 * When a schedule happens next.
 *
 * Orbis already has a scheduler, and it already understands once, daily, weekly and monthly. What it does not have is
 * a *place*: a schedule is a bare epoch millisecond stepped forward with the machine's own local `Date` methods. That
 * works until clocks change, until somebody travels, until a schedule is meant to be in a place other than where the
 * laptop is, or until the month is short — and then "every day at 8am" becomes 7am, and "the 31st" becomes the 3rd of
 * the following month.
 *
 * So recurrence here is calendar arithmetic in a named zone, never a number of milliseconds added to the last run.
 *
 * ## What it will not do
 *
 * **It never guesses a rule it cannot keep.** Every rule is checked before it can be stored, and an unusable one is
 * refused with a reason rather than rounded to something nearby. A schedule that quietly means something else than
 * what somebody asked for is worse than no schedule.
 *
 * **It never assumes a month has a 31st.** What to do in February is a choice the rule carries, because there is no
 * answer that is right for everybody and picking one silently surprises half of them.
 *
 * **It has no clock.** Every function is told the moment to work from. That is what makes a year of occurrences
 * testable in a millisecond, and it is why nothing here reads `Date.now`.
 */

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** What to do when a monthly rule asks for a day the month does not have. */
export type ShortMonthPolicy =
  /** The 31st becomes the 30th, or the 28th. What most calendars do. */
  | 'lastDay'
  /** February simply does not get one. */
  | 'skip'

export interface TimeOfDay {
  hour: number
  minute: number
}

export type Recurrence =
  /** Happens once, at a wall time in a place. */
  | { kind: 'once'; date: { year: number; month: number; day: number }; time: TimeOfDay }
  /** Every N minutes from a starting moment. A duration, not a calendar rule — see `everyMinutes` below. */
  | { kind: 'interval'; everyMinutes: number; from: number }
  | { kind: 'daily'; time: TimeOfDay }
  /** One or more weekdays. `[1,3,5]` is Monday, Wednesday and Friday. */
  | { kind: 'weekly'; weekdays: readonly Weekday[]; time: TimeOfDay }
  | { kind: 'monthly'; day: number; time: TimeOfDay; short: ShortMonthPolicy }
  /** The last day of every month, whatever its length. */
  | { kind: 'monthlyLastDay'; time: TimeOfDay }
  | { kind: 'yearly'; month: number; day: number; time: TimeOfDay; short: ShortMonthPolicy }

export interface Schedule {
  recurrence: Recurrence
  /** An IANA name. Schedules are kept in a place, not at an offset, because offsets change by legislation. */
  timeZone: string
  /** Nothing before this. Absent means it may run from the moment it is created. */
  startsAt?: number
  /** Nothing after this. */
  endsAt?: number
  /** Stop after this many runs. */
  maxRuns?: number
}

/**
 * The least often a repeating schedule may run.
 *
 * A minute is already frequent for something that may open a browser or call a model, and below it a schedule stops
 * being a schedule and becomes a loop. The existing page watcher has its own, higher floor for the same reason, and
 * this does not override it.
 */
export const MIN_INTERVAL_MINUTES = 1

/** The furthest ahead an occurrence is searched for before giving up, in days. Four years covers every leap case. */
const SEARCH_DAYS = 366 * 4

export type RecurrenceProblem = string

/** Whether a rule is one Orbis can actually keep. Returns every problem, so a form can show them all at once. */
export function checkSchedule(schedule: Schedule): RecurrenceProblem[] {
  const problems: RecurrenceProblem[] = []
  if (!isKnownZone(schedule.timeZone)) problems.push(`This computer does not know the time zone “${schedule.timeZone}”.`)

  const time = (t: TimeOfDay, where: string): void => {
    if (!Number.isInteger(t.hour) || t.hour < 0 || t.hour > 23) problems.push(`${where}: the hour must be 0 to 23.`)
    if (!Number.isInteger(t.minute) || t.minute < 0 || t.minute > 59) problems.push(`${where}: the minute must be 0 to 59.`)
  }

  const r = schedule.recurrence
  switch (r.kind) {
    case 'once':
      time(r.time, 'Once')
      if (r.date.month < 1 || r.date.month > 12) problems.push('Once: the month must be 1 to 12.')
      else if (r.date.day < 1 || r.date.day > daysInMonth(r.date.year, r.date.month)) {
        problems.push(`Once: ${r.date.year}-${r.date.month} has no day ${r.date.day}.`)
      }
      break
    case 'interval':
      if (!Number.isFinite(r.everyMinutes) || r.everyMinutes < MIN_INTERVAL_MINUTES) {
        problems.push(`Every: the shortest interval is ${MIN_INTERVAL_MINUTES} minute.`)
      }
      break
    case 'daily':
      time(r.time, 'Daily')
      break
    case 'weekly':
      time(r.time, 'Weekly')
      if (r.weekdays.length === 0) problems.push('Weekly: no days were given.')
      if (r.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) problems.push('Weekly: a day was not 0 to 6.')
      break
    case 'monthly':
      time(r.time, 'Monthly')
      if (!Number.isInteger(r.day) || r.day < 1 || r.day > 31) problems.push('Monthly: the day must be 1 to 31.')
      break
    case 'monthlyLastDay':
      time(r.time, 'Monthly')
      break
    case 'yearly':
      time(r.time, 'Yearly')
      if (r.month < 1 || r.month > 12) problems.push('Yearly: the month must be 1 to 12.')
      // A day that exists in no year at all, as opposed to 29 February which exists in some.
      if (r.day < 1 || r.day > 31) problems.push('Yearly: the day must be 1 to 31.')
      break
  }

  if (schedule.startsAt !== undefined && schedule.endsAt !== undefined && schedule.endsAt <= schedule.startsAt) {
    problems.push('It is set to end before it starts.')
  }
  if (schedule.maxRuns !== undefined && (!Number.isInteger(schedule.maxRuns) || schedule.maxRuns < 1)) {
    problems.push('The number of runs must be at least 1.')
  }
  return problems
}

export interface Occurrence {
  at: number
  /** What the clocks did to this one, so a caller can say so rather than a schedule silently moving. */
  resolution: DstResolution
}

/**
 * The first occurrence strictly after `after`.
 *
 * Null when there will never be another: a one-off already past, an end date reached, a run count exhausted, or a
 * rule whose day never comes round.
 *
 * Strictly after, never at, so that working out the next occurrence from the moment one just ran cannot return the
 * same moment again and run it twice.
 */
export function nextOccurrence(schedule: Schedule, after: number, runsSoFar = 0): Occurrence | null {
  const problems = checkSchedule(schedule)
  if (problems.length > 0) return null
  if (schedule.maxRuns !== undefined && runsSoFar >= schedule.maxRuns) return null

  // Nothing before the start, so a rule that begins next month is not answered with something tomorrow.
  const from = Math.max(after, (schedule.startsAt ?? Number.NEGATIVE_INFINITY) - 1)
  const found = search(schedule, from)
  if (found === null) return null
  if (schedule.endsAt !== undefined && found.at > schedule.endsAt) return null
  return found
}

function search(schedule: Schedule, after: number): Occurrence | null {
  const r = schedule.recurrence
  const zone = schedule.timeZone

  if (r.kind === 'once') {
    const moment = zonedToEpoch({ ...r.date, ...r.time }, zone)
    return moment.epochMs > after ? { at: moment.epochMs, resolution: moment.resolution } : null
  }

  /**
   * An interval is a duration, and is deliberately not calendar arithmetic.
   *
   * "Every thirty minutes" means thirty minutes of elapsed time, and must keep meaning that through a clock change --
   * unlike "every day at 8am", which must stay at 8am even though the day it lands on is 23 or 25 hours long. Mixing
   * the two is how a scheduler either fires twice or skips a turn every spring.
   */
  if (r.kind === 'interval') {
    const step = r.everyMinutes * 60_000
    if (after < r.from) return { at: r.from, resolution: 'exact' }
    const elapsed = after - r.from
    const at = r.from + (Math.floor(elapsed / step) + 1) * step
    return { at, resolution: 'exact' }
  }

  // Everything else is a wall time on some day, so the search walks days in the schedule's own place.
  const startFrom = wallTimeAt(after, zone)
  let date = { year: startFrom.year, month: startFrom.month, day: startFrom.day }

  for (let i = 0; i <= SEARCH_DAYS; i++) {
    const day = dayMatches(r, date, zone)
    if (day !== null) {
      const moment = zonedToEpoch({ ...day.date, ...r.time }, zone)
      if (moment.epochMs > after) return { at: moment.epochMs, resolution: moment.resolution }
    }
    date = addDays(date, 1)
  }
  return null
}

/** Whether this calendar day is one the rule falls on, and on which date exactly. */
function dayMatches(
  r: Recurrence,
  date: { year: number; month: number; day: number },
  zone: string
): { date: { year: number; month: number; day: number } } | null {
  switch (r.kind) {
    case 'daily':
      return { date }

    case 'weekly': {
      // Midday, so the weekday is read well away from either edge of a day that a clock change shortened.
      const weekday = wallTimeAt(zonedToEpoch({ ...date, hour: 12, minute: 0 }, zone).epochMs, zone).weekday
      return r.weekdays.includes(weekday as Weekday) ? { date } : null
    }

    case 'monthly': {
      const length = daysInMonth(date.year, date.month)
      /**
       * The 31st of a month that has 30 days.
       *
       * `lastDay` moves it to the end of that month, which is what a calendar does. `skip` leaves the month out
       * entirely. There is no third, quiet option: stepping a `Date` forward by a month turns the 31st of January
       * into the 3rd of March, which is neither.
       */
      const wanted = r.day > length ? (r.short === 'lastDay' ? length : null) : r.day
      return wanted === date.day ? { date } : null
    }

    case 'monthlyLastDay':
      return date.day === daysInMonth(date.year, date.month) ? { date } : null

    case 'yearly': {
      if (date.month !== r.month) return null
      const length = daysInMonth(date.year, r.month)
      // 29 February in a year that has none: the same choice as a short month, for the same reason.
      const wanted = r.day > length ? (r.short === 'lastDay' ? length : null) : r.day
      return wanted === date.day ? { date } : null
    }

    default:
      return null
  }
}

/**
 * The occurrences between two moments, oldest first.
 *
 * For working out what was missed while a computer was off, and for showing somebody what a rule will actually do
 * before they agree to it. Bounded, because a one-minute interval over a year is half a million moments and nobody
 * asked for that.
 */
export function occurrencesBetween(schedule: Schedule, from: number, to: number, limit = 200): Occurrence[] {
  const out: Occurrence[] = []
  let at = from
  while (out.length < limit) {
    const next = nextOccurrence(schedule, at, out.length)
    if (next === null || next.at > to) break
    out.push(next)
    at = next.at
  }
  return out
}
