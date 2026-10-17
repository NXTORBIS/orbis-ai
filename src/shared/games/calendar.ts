/**
 * When a day begins, for everything in the arcade that counts days.
 *
 * ## Why this is here and not imported
 *
 * Orbis has already settled what a day is, once, in `src/shared/chess/progress.ts`: a fixed offset handed in by the
 * window, an hour the day is taken to start, and plain arithmetic from there. The arithmetic below is that one, line
 * for line, and `CALENDAR_RULES` is the same four sentences.
 *
 * It is copied rather than imported for one reason. `chess/progress.ts` reads the coach's activity tables at module
 * scope, so importing one function from it pulls Chess World into whatever bundle asks -- and the thing asking here is
 * the page shown when the network has failed, which is the last place that can afford to load a chess engine's worth
 * of tables to find out what day it is.
 *
 * A copy that drifts is worse than no copy, so `daily.test.ts` holds the two together: it runs both sets of functions
 * over thousands of moments and several rule sets and asserts they never disagree, and it asserts the rule sentences
 * are character for character the same. Change one and the test names the other.
 */

const MINUTE = 60_000
const HOUR = 3_600_000
export const DAY = 86_400_000

export interface DayRules {
  /**
   * Minutes to add to UTC to get the person's own time. `-new Date().getTimezoneOffset()` gives it.
   *
   * A fixed number rather than a zone name: this file has no time-zone database and will not pretend to one.
   */
  offsetMinutes: number
  /** The hour a day is taken to begin, in the person's own time. 0 is midnight. */
  dayStartHour: number
}

export const DEFAULT_DAY_RULES: DayRules = Object.freeze({ offsetMinutes: 0, dayStartHour: 0 })

/** The rules, in words, to be shown wherever a day or a streak is shown. */
export const CALENDAR_RULES: readonly string[] = Object.freeze([
  'A day runs from the hour you set as the start of the day -- midnight unless it was changed -- to the same hour the next day, in your own time.',
  'A week runs Monday to Sunday, on those same hours.',
  'Your time is a fixed offset handed in by the window. It cannot follow a daylight-saving change, so a day on either side of one may be an hour out of place.',
  'A moment timed later than now is ignored by everything that counts days. A day that has not happened cannot be credited.'
])

const pad = (n: number): string => (n < 10 ? `0${n}` : String(n))

/** The moment shifted so that plain UTC arithmetic answers questions about the person's own day. */
const shifted = (at: number, rules: DayRules): number => at + rules.offsetMinutes * MINUTE - rules.dayStartHour * HOUR
const unshifted = (at: number, rules: DayRules): number => at - rules.offsetMinutes * MINUTE + rules.dayStartHour * HOUR

/** The day a moment falls in, as `YYYY-MM-DD`. The identity of a day everywhere in the arcade. */
export function dayKey(at: number, rules: DayRules = DEFAULT_DAY_RULES): string {
  const d = new Date(shifted(at, rules))
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** The moment the day containing `at` begins. */
export function dayStart(at: number, rules: DayRules = DEFAULT_DAY_RULES): number {
  return unshifted(Math.floor(shifted(at, rules) / DAY) * DAY, rules)
}

/** The moment the day containing `at` ends, which is the next day's start and is not part of this day. */
export function dayEnd(at: number, rules: DayRules = DEFAULT_DAY_RULES): number {
  return dayStart(at, rules) + DAY
}

/** The Monday of the week containing `at`. */
export function weekStart(at: number, rules: DayRules = DEFAULT_DAY_RULES): number {
  const start = dayStart(at, rules)
  const weekday = new Date(shifted(start, rules)).getUTCDay()
  // getUTCDay is 0 for Sunday, so Monday is reached by going back (weekday + 6) % 7 days.
  return start - ((weekday + 6) % 7) * DAY
}

/** `n` whole days from the start of the day containing `at`. Negative goes back. */
export function addDays(at: number, n: number, rules: DayRules = DEFAULT_DAY_RULES): number {
  return dayStart(at, rules) + n * DAY
}

/** Whole days from one moment's day to another's. */
export function daysBetween(from: number, to: number, rules: DayRules = DEFAULT_DAY_RULES): number {
  return Math.round((dayStart(to, rules) - dayStart(from, rules)) / DAY)
}

const MONTHS: readonly string[] = Object.freeze([
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'
])

/** '16 October 2026'. Written out rather than left to a locale, so a test and a screen agree. */
export function dayLabel(at: number, rules: DayRules = DEFAULT_DAY_RULES): string {
  const d = new Date(shifted(at, rules))
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

export interface Day {
  key: string
  label: string
  /** Inclusive. */
  from: number
  /** Exclusive. */
  to: number
}

export function dayOf(at: number, rules: DayRules = DEFAULT_DAY_RULES): Day {
  return { key: dayKey(at, rules), label: dayLabel(at, rules), from: dayStart(at, rules), to: dayEnd(at, rules) }
}

/** The day `n` back from the one containing `at`. */
export function dayBack(at: number, n: number, rules: DayRules = DEFAULT_DAY_RULES): Day {
  return dayOf(addDays(at, -n, rules), rules)
}

/**
 * A small written-out hash of a string.
 *
 * It exists so that a day's challenge comes from that day's own key and nothing else: the same day always gives the
 * same one, there is no random source anywhere in these files, and a test can say in advance which challenge a given
 * date produces.
 */
export function hashKey(key: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193) >>> 0
  return h >>> 0
}
