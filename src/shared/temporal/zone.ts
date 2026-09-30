/**
 * Wall-clock time in a named place, and the moment it corresponds to.
 *
 * Orbis's existing schedules are a bare epoch millisecond and are stepped forward with `Date`'s local methods, which
 * means they follow whatever timezone the machine happens to be in. That is fine until any of four things happen:
 * clocks change for summer time, somebody travels, a schedule is meant to be in a place other than where the laptop
 * is, or the month is short. Then "every day at 8am" quietly becomes 7am or 9am, and "the 31st" becomes the 3rd.
 *
 * So a schedule needs a *place*, not only a moment. This file is the conversion between the two, and deliberately
 * nothing else: no recurrence, no jobs, no storage.
 *
 * It uses `Intl`, which every runtime Orbis targets already carries with a full IANA timezone database. Nothing is
 * installed and no offset is hardcoded, which matters because offsets are political and change by legislation several
 * times a year somewhere in the world.
 */

/** A moment, as a wall clock reads it somewhere. Month is 1-12, to match how people write dates rather than `Date`. */
export interface WallTime {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  /** 0 is Sunday, matching `Date.getDay`. */
  weekday: number
}

const FORMATTERS = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string): Intl.DateTimeFormat {
  const held = FORMATTERS.get(timeZone)
  if (held) return held
  /**
   * Built once per zone and kept.
   *
   * Constructing an `Intl.DateTimeFormat` is expensive relative to using one, and a scheduler works out the next
   * occurrence for every job whenever anything changes. Without this cache that is a new formatter per job per pass.
   */
  const made = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short'
  })
  FORMATTERS.set(timeZone, made)
  return made
}

/** Whether a zone name is one this computer knows. Anything else is refused rather than silently treated as UTC. */
export function isKnownZone(timeZone: string): boolean {
  try {
    formatter(timeZone).format(0)
    return true
  } catch {
    return false
  }
}

/**
 * A zone name as the database spells it, or null if it is not a zone at all.
 *
 * `Intl` accepts "europe/berlin" as readily as "Europe/Berlin", which sounds harmless and is not: a schedule said in
 * words arrives lowercased, and storing the lowercase spelling means the name shown back to somebody is not the name
 * anybody writes. So the spelling is taken from the database rather than from what was typed.
 */
export function canonicalZone(timeZone: string): string | null {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone
  } catch {
    return null
  }
}

/** The zone this computer is in, for schedules that mean "wherever I am". */
export function deviceZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

/** What a clock in `timeZone` reads at this moment. */
export function wallTimeAt(epochMs: number, timeZone: string): WallTime {
  const parts = formatter(timeZone).formatToParts(new Date(epochMs))
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '0'
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    // `hourCycle: 'h23'` still renders midnight as 24 in some engines, which would make it look like the next day.
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: WEEKDAYS[get('weekday')] ?? 0
  }
}

/** How far ahead of UTC `timeZone` is at this moment, in milliseconds. Negative west of Greenwich. */
export function offsetAt(epochMs: number, timeZone: string): number {
  const wall = wallTimeAt(epochMs, timeZone)
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second)
  // The epoch is floored to the second because the wall clock above has no milliseconds to compare against.
  return asUtc - Math.floor(epochMs / 1000) * 1000
}

/** What `zonedToEpoch` did with a local time that either does not exist or happens twice. */
export type DstResolution = 'exact' | 'skipped' | 'ambiguous'

export interface ZonedMoment {
  epochMs: number
  /**
   * Whether the local time asked for was real.
   *
   * `skipped`: the clocks went forward over it, so it never happened — 2:30am does not exist on the morning a
   * region springs forward. The moment returned is the instant the hour resumes, which is the first time that day
   * the schedule could have run.
   *
   * `ambiguous`: the clocks went back, so it happened twice. The first is returned, because a schedule said once
   * should run once and the earlier reading is the one a person means.
   */
  resolution: DstResolution
}

/**
 * The moment when a clock in `timeZone` will read this wall time.
 *
 * Two passes, which is what makes this correct rather than approximately correct. Guessing the epoch by pretending the
 * wall time is UTC and then subtracting the offset *at that guess* is wrong whenever the guess lands on the other side
 * of a clock change from the answer — so the offset is read again at the corrected moment and applied if it differs.
 *
 * Both DST edges are then named rather than papered over, because a schedule that silently moves by an hour twice a
 * year is exactly the fault this file exists to prevent.
 */
export function zonedToEpoch(
  parts: { year: number; month: number; day: number; hour: number; minute: number; second?: number },
  timeZone: string
): ZonedMoment {
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second ?? 0)

  /**
   * Both offsets that could apply, taken from a day either side.
   *
   * Reading the offset once and correcting it is not enough, and the failure is silent both ways. On the morning
   * clocks go back, a local time happens twice and a single pass only ever finds one of them -- so nothing looks
   * ambiguous. On the morning they go forward, the correction lands *before* the gap rather than after it, so a time
   * that never happened is reported as a perfectly ordinary moment an hour earlier than asked.
   *
   * A day either side is far enough to span any clock change and near enough that no other change intervenes.
   */
  const before = offsetAt(asUtc - 86_400_000, timeZone)
  const after = offsetAt(asUtc + 86_400_000, timeZone)

  const reads = (epochMs: number): boolean => {
    const clock = wallTimeAt(epochMs, timeZone)
    return (
      clock.year === parts.year &&
      clock.month === parts.month &&
      clock.day === parts.day &&
      clock.hour === parts.hour &&
      clock.minute === parts.minute
    )
  }

  const candidates = [...new Set([asUtc - before, asUtc - after])].sort((a, b) => a - b)
  const real = candidates.filter(reads)

  // Happens twice: the clocks went back. The earlier reading is the one somebody means by the time of day.
  if (real.length > 1) return { epochMs: real[0], resolution: 'ambiguous' }
  if (real.length === 1) return { epochMs: real[0], resolution: 'exact' }

  /**
   * Never happened: the clocks jumped over it.
   *
   * The later candidate is the asked-for time shifted forward by the length of the gap, which is what every calendar
   * does with an appointment in the missing hour -- it runs when the hour resumes rather than an hour early.
   */
  return { epochMs: candidates[candidates.length - 1], resolution: 'skipped' }
}

/** How many days that month has, which is what makes "the 31st" and "the 29th of February" answerable. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** The same wall date moved by whole days, staying on the calendar rather than on a fixed number of milliseconds. */
export function addDays(parts: { year: number; month: number; day: number }, days: number): { year: number; month: number; day: number } {
  const moved = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days))
  return { year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1, day: moved.getUTCDate() }
}
