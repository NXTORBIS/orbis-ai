/**
 * Local days, weeks and months.
 *
 * A student's day ends when they go to bed, not at midnight UTC. Everything that counts a day -- streaks, daily
 * quests, the word of the day, the end-of-day recap -- uses these, so none of them can disagree with the others about
 * which day it is. Writing `new Date(at).toISOString().slice(0, 10)` anywhere in Student is a bug: for anybody east
 * of London it hands them tomorrow's word in the evening, and for anybody west it takes their streak away at four in
 * the afternoon.
 *
 * Pure. Every function takes the moment it should use.
 */

const pad = (n: number): string => String(n).padStart(2, '0')

/** The local day a moment falls in, as `YYYY-MM-DD`. */
export function dayKey(at: number): string {
  const d = new Date(at)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The local month, as `YYYY-MM`. */
export function monthKey(at: number): string {
  const d = new Date(at)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

/**
 * The local week, as the `YYYY-MM-DD` of its Monday.
 *
 * Named by its Monday rather than by an ISO week number, because a week number has to be explained and a date does
 * not -- and because two weeks either side of New Year are where ISO week numbering surprises people.
 */
export function weekKey(at: number): string {
  const d = new Date(at)
  d.setHours(12, 0, 0, 0)
  const weekday = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - weekday)
  return dayKey(d.getTime())
}

/** Midnight at the start of the local day a moment falls in. */
export function startOfDay(at: number): number {
  const d = new Date(at)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function endOfDay(at: number): number {
  return startOfDay(at) + 24 * 3600 * 1000 - 1
}

/** A day key moved by whole days. Goes through midday so a clock change cannot land it on the wrong date. */
export function shiftDay(key: string, by: number): string {
  const parsed = fromDayKey(key)
  if (parsed === null) return key
  const d = new Date(parsed)
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() + by)
  return dayKey(d.getTime())
}

/** The local midday of a day key, as a moment. Null when the key is not a date. */
export function fromDayKey(key: string): number | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!parts) return null
  const d = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]), 12, 0, 0, 0)
  return Number.isFinite(d.getTime()) ? d.getTime() : null
}

/** Whole days between two day keys. Positive when the second is later. */
export function daysBetween(from: string, to: string): number | null {
  const a = fromDayKey(from)
  const b = fromDayKey(to)
  if (a === null || b === null) return null
  return Math.round((b - a) / (24 * 3600 * 1000))
}

export function isToday(key: string, now: number): boolean {
  return key === dayKey(now)
}

export function isYesterday(key: string, now: number): boolean {
  return key === shiftDay(dayKey(now), -1)
}

/** The last N day keys, oldest first, ending today. For a heatmap or a habit view. */
export function lastDays(now: number, count: number): string[] {
  const today = dayKey(now)
  const out: string[] = []
  for (let i = count - 1; i >= 0; i -= 1) out.push(shiftDay(today, -i))
  return out
}

/** A day in words, for a heading. */
export function dayLabel(key: string, now: number, locale?: string): string {
  if (isToday(key, now)) return 'Today'
  if (isYesterday(key, now)) return 'Yesterday'
  const at = fromDayKey(key)
  if (at === null) return key
  return new Date(at).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })
}

/** Part of the day, for a greeting. */
export function partOfDay(now: number): 'morning' | 'afternoon' | 'evening' | 'night' {
  const hour = new Date(now).getHours()
  if (hour < 5) return 'night'
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  if (hour < 22) return 'evening'
  return 'night'
}
