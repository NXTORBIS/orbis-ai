import assert from 'node:assert/strict'
import test from 'node:test'
import { checkSchedule, nextOccurrence, occurrencesBetween, type Schedule } from './recurrence.ts'
import { wallTimeAt, zonedToEpoch } from './zone.ts'

/**
 * When a schedule happens next.
 *
 * Fixed dates throughout and no clock anywhere, so a year of occurrences is checked in a millisecond and the answers
 * do not change with the season the tests are run in. Most of these are the days the arithmetic is not obvious: the
 * mornings clocks move, the months with no 31st, and the Februaries with no 29th.
 */

const KOLKATA = 'Asia/Kolkata'
const NEW_YORK = 'America/New_York'

/** A moment, said as a wall time somewhere, so the tests read as dates rather than as epoch numbers. */
const at = (zone: string, y: number, mo: number, d: number, h = 0, mi = 0): number =>
  zonedToEpoch({ year: y, month: mo, day: d, hour: h, minute: mi }, zone).epochMs

/** The end of that day, for a span that is meant to include the day named. Midnight would cut its morning off. */
const endOf = (zone: string, y: number, mo: number, d: number): number => at(zone, y, mo, d, 23, 59)

const reads = (epochMs: number, zone: string): string => {
  const w = wallTimeAt(epochMs, zone)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${w.year}-${pad(w.month)}-${pad(w.day)} ${pad(w.hour)}:${pad(w.minute)}`
}

const daily = (zone = KOLKATA): Schedule => ({ recurrence: { kind: 'daily', time: { hour: 8, minute: 0 } }, timeZone: zone })

// ---------------------------------------------------------------- the basic shapes

test('a one-off happens once, and then never again', () => {
  const schedule: Schedule = {
    recurrence: { kind: 'once', date: { year: 2026, month: 5, day: 1 }, time: { hour: 9, minute: 30 } },
    timeZone: KOLKATA
  }
  const first = nextOccurrence(schedule, at(KOLKATA, 2026, 4, 30))
  assert.equal(reads(first!.at, KOLKATA), '2026-05-01 09:30')
  // Asked again from after it, there is nothing left.
  assert.equal(nextOccurrence(schedule, first!.at), null)
})

test('daily lands on the next day when today’s time has gone', () => {
  const schedule = daily()
  const morning = nextOccurrence(schedule, at(KOLKATA, 2026, 5, 1, 7, 0))
  assert.equal(reads(morning!.at, KOLKATA), '2026-05-01 08:00')
  const afternoon = nextOccurrence(schedule, at(KOLKATA, 2026, 5, 1, 15, 0))
  assert.equal(reads(afternoon!.at, KOLKATA), '2026-05-02 08:00')
})

test('the next occurrence is strictly after, so a run cannot schedule itself again', () => {
  // Asked from the exact moment one just ran, the answer must be tomorrow rather than the same moment.
  const schedule = daily()
  const today = at(KOLKATA, 2026, 5, 1, 8, 0)
  assert.equal(reads(nextOccurrence(schedule, today)!.at, KOLKATA), '2026-05-02 08:00')
})

test('weekly takes several days at once', () => {
  // Monday, Wednesday, Friday. 2026-05-01 is a Friday.
  const schedule: Schedule = {
    recurrence: { kind: 'weekly', weekdays: [1, 3, 5], time: { hour: 18, minute: 0 } },
    timeZone: KOLKATA
  }
  const found = occurrencesBetween(schedule, at(KOLKATA, 2026, 5, 1), endOf(KOLKATA, 2026, 5, 12))
  assert.deepEqual(found.map((o) => reads(o.at, KOLKATA)), [
    '2026-05-01 18:00',
    '2026-05-04 18:00',
    '2026-05-06 18:00',
    '2026-05-08 18:00',
    '2026-05-11 18:00'
  ])
})

test('an interval is elapsed time, counted from where it started', () => {
  const from = at(KOLKATA, 2026, 5, 1, 9, 0)
  const schedule: Schedule = { recurrence: { kind: 'interval', everyMinutes: 30, from }, timeZone: KOLKATA }
  assert.equal(reads(nextOccurrence(schedule, from - 1)!.at, KOLKATA), '2026-05-01 09:00')
  assert.equal(reads(nextOccurrence(schedule, from)!.at, KOLKATA), '2026-05-01 09:30')
  // Asked from long after, it does not replay every missed step -- it gives the next one.
  assert.equal(reads(nextOccurrence(schedule, from + 5 * 3_600_000)!.at, KOLKATA), '2026-05-01 14:30')
})

// ---------------------------------------------------------------- the mornings clocks move

test('a daily local time survives a clock change, which the old arithmetic did not', () => {
  /**
   * The fault this file exists for. New York went forward on 8 March 2026. Stepping a stored epoch forward by a day
   * would put the schedule at 9am from then on.
   */
  const schedule = daily(NEW_YORK)
  const found = occurrencesBetween(schedule, at(NEW_YORK, 2026, 3, 6), endOf(NEW_YORK, 2026, 3, 11))
  assert.deepEqual(found.map((o) => reads(o.at, NEW_YORK)), [
    '2026-03-06 08:00',
    '2026-03-07 08:00',
    '2026-03-08 08:00',
    '2026-03-09 08:00',
    '2026-03-10 08:00',
    '2026-03-11 08:00'
  ])
})

test('a daily local time survives the clocks going back too', () => {
  const schedule = daily(NEW_YORK)
  const found = occurrencesBetween(schedule, at(NEW_YORK, 2026, 10, 31), endOf(NEW_YORK, 2026, 11, 3))
  assert.deepEqual(found.map((o) => reads(o.at, NEW_YORK)), [
    '2026-10-31 08:00',
    '2026-11-01 08:00',
    '2026-11-02 08:00',
    '2026-11-03 08:00'
  ])
})

test('a daily time inside the missing hour is reported, not silently moved', () => {
  // 2:30am does not exist in New York on 8 March 2026. It runs when the hour resumes, and says that it did.
  const schedule: Schedule = { recurrence: { kind: 'daily', time: { hour: 2, minute: 30 } }, timeZone: NEW_YORK }
  const missing = nextOccurrence(schedule, at(NEW_YORK, 2026, 3, 8, 0, 0))
  assert.equal(missing!.resolution, 'skipped')
  assert.equal(reads(missing!.at, NEW_YORK), '2026-03-08 03:30')
})

test('an interval keeps its length through a clock change', () => {
  // Unlike a daily wall time, "every hour" must stay an hour even on the day that is 23 hours long.
  // Half past one, so that one hour later is half past two -- the half hour that does not exist that morning.
  const from = at(NEW_YORK, 2026, 3, 8, 1, 30)
  const schedule: Schedule = { recurrence: { kind: 'interval', everyMinutes: 60, from }, timeZone: NEW_YORK }
  const next = nextOccurrence(schedule, from)!
  assert.equal(next.at - from, 3_600_000, 'an hour of real time')
  // Which reads as 3:30 rather than 2:30, because 2:30 did not happen.
  assert.equal(reads(next.at, NEW_YORK), '2026-03-08 03:30')
})

// ---------------------------------------------------------------- short months

test('the 31st of a short month moves to its last day, or skips it', () => {
  const lastDay: Schedule = {
    recurrence: { kind: 'monthly', day: 31, time: { hour: 9, minute: 0 }, short: 'lastDay' },
    timeZone: KOLKATA
  }
  assert.deepEqual(
    occurrencesBetween(lastDay, at(KOLKATA, 2026, 1, 1), at(KOLKATA, 2026, 5, 1)).map((o) => reads(o.at, KOLKATA)),
    ['2026-01-31 09:00', '2026-02-28 09:00', '2026-03-31 09:00', '2026-04-30 09:00']
  )

  const skip: Schedule = { ...lastDay, recurrence: { ...lastDay.recurrence, short: 'skip' } as never }
  assert.deepEqual(
    occurrencesBetween(skip, at(KOLKATA, 2026, 1, 1), at(KOLKATA, 2026, 5, 1)).map((o) => reads(o.at, KOLKATA)),
    ['2026-01-31 09:00', '2026-03-31 09:00'],
    'February and April have no 31st and are left out'
  )
})

test('the old arithmetic turned the 31st of January into the 3rd of March; this does not', () => {
  const schedule: Schedule = {
    recurrence: { kind: 'monthly', day: 31, time: { hour: 9, minute: 0 }, short: 'lastDay' },
    timeZone: KOLKATA
  }
  const afterJanuary = nextOccurrence(schedule, at(KOLKATA, 2026, 1, 31, 9, 0))!
  assert.equal(reads(afterJanuary.at, KOLKATA), '2026-02-28 09:00')
})

test('the last day of every month, whatever its length', () => {
  const schedule: Schedule = { recurrence: { kind: 'monthlyLastDay', time: { hour: 17, minute: 0 } }, timeZone: KOLKATA }
  assert.deepEqual(
    occurrencesBetween(schedule, at(KOLKATA, 2028, 1, 1), at(KOLKATA, 2028, 5, 1)).map((o) => reads(o.at, KOLKATA)),
    ['2028-01-31 17:00', '2028-02-29 17:00', '2028-03-31 17:00', '2028-04-30 17:00'],
    '2028 is a leap year, so February ends on the 29th'
  )
})

// ---------------------------------------------------------------- once a year

test('a yearly date comes round once', () => {
  const schedule: Schedule = {
    recurrence: { kind: 'yearly', month: 9, day: 30, time: { hour: 0, minute: 0 }, short: 'lastDay' },
    timeZone: KOLKATA
  }
  assert.deepEqual(
    occurrencesBetween(schedule, at(KOLKATA, 2026, 1, 1), at(KOLKATA, 2028, 12, 31)).map((o) => reads(o.at, KOLKATA)),
    ['2026-09-30 00:00', '2027-09-30 00:00', '2028-09-30 00:00']
  )
})

test('the 29th of February, in the years that have one', () => {
  const skip: Schedule = {
    recurrence: { kind: 'yearly', month: 2, day: 29, time: { hour: 12, minute: 0 }, short: 'skip' },
    timeZone: KOLKATA
  }
  assert.deepEqual(
    occurrencesBetween(skip, at(KOLKATA, 2026, 1, 1), at(KOLKATA, 2033, 1, 1)).map((o) => reads(o.at, KOLKATA)),
    ['2028-02-29 12:00', '2032-02-29 12:00'],
    'only the leap years'
  )

  const lastDay: Schedule = { ...skip, recurrence: { ...skip.recurrence, short: 'lastDay' } as never }
  assert.deepEqual(
    occurrencesBetween(lastDay, at(KOLKATA, 2026, 1, 1), at(KOLKATA, 2029, 1, 1)).map((o) => reads(o.at, KOLKATA)),
    ['2026-02-28 12:00', '2027-02-28 12:00', '2028-02-29 12:00'],
    'or every year, on the last day February has'
  )
})

// ---------------------------------------------------------------- midnight and noon

test('midnight is the start of the day, and noon is the middle of it', () => {
  const midnight: Schedule = { recurrence: { kind: 'daily', time: { hour: 0, minute: 0 } }, timeZone: KOLKATA }
  assert.equal(reads(nextOccurrence(midnight, at(KOLKATA, 2026, 9, 30, 23, 0))!.at, KOLKATA), '2026-10-01 00:00')

  const noon: Schedule = { recurrence: { kind: 'daily', time: { hour: 12, minute: 0 } }, timeZone: KOLKATA }
  assert.equal(reads(nextOccurrence(noon, at(KOLKATA, 2026, 10, 1, 1, 0))!.at, KOLKATA), '2026-10-01 12:00')
})

// ---------------------------------------------------------------- when it stops

test('it does not start before it is meant to', () => {
  const schedule: Schedule = { ...daily(), startsAt: at(KOLKATA, 2026, 6, 1) }
  assert.equal(reads(nextOccurrence(schedule, at(KOLKATA, 2026, 5, 1))!.at, KOLKATA), '2026-06-01 08:00')
})

test('it stops at its end date', () => {
  const schedule: Schedule = { ...daily(), endsAt: at(KOLKATA, 2026, 5, 3, 12, 0) }
  assert.equal(nextOccurrence(schedule, at(KOLKATA, 2026, 5, 2, 9, 0))!.at, at(KOLKATA, 2026, 5, 3, 8, 0))
  assert.equal(nextOccurrence(schedule, at(KOLKATA, 2026, 5, 3, 9, 0)), null)
})

test('it stops after the number of runs asked for', () => {
  const schedule: Schedule = { ...daily(), maxRuns: 3 }
  assert.ok(nextOccurrence(schedule, at(KOLKATA, 2026, 5, 1), 2))
  assert.equal(nextOccurrence(schedule, at(KOLKATA, 2026, 5, 1), 3), null)
})

// ---------------------------------------------------------------- refusing what it cannot keep

test('a rule it cannot keep is refused with a reason, not rounded to something nearby', () => {
  const bad: [Schedule, RegExp][] = [
    [{ recurrence: { kind: 'daily', time: { hour: 25, minute: 0 } }, timeZone: KOLKATA }, /hour/i],
    [{ recurrence: { kind: 'daily', time: { hour: 8, minute: 99 } }, timeZone: KOLKATA }, /minute/i],
    [{ recurrence: { kind: 'daily', time: { hour: 8, minute: 0 } }, timeZone: 'Mars/Olympus_Mons' }, /time zone/i],
    [{ recurrence: { kind: 'weekly', weekdays: [], time: { hour: 8, minute: 0 } }, timeZone: KOLKATA }, /no days/i],
    [{ recurrence: { kind: 'interval', everyMinutes: 0, from: 0 }, timeZone: KOLKATA }, /shortest/i],
    [
      { recurrence: { kind: 'once', date: { year: 2026, month: 2, day: 30 }, time: { hour: 8, minute: 0 } }, timeZone: KOLKATA },
      /no day 30/i
    ]
  ]
  for (const [schedule, why] of bad) {
    const problems = checkSchedule(schedule)
    assert.ok(problems.length > 0, JSON.stringify(schedule.recurrence))
    assert.match(problems.join(' '), why)
    // And an unusable rule never produces an occurrence, so a bad one cannot run.
    assert.equal(nextOccurrence(schedule, 0), null)
  }
})

test('a schedule that ends before it starts is refused', () => {
  const problems = checkSchedule({ ...daily(), startsAt: 1000, endsAt: 500 })
  assert.match(problems.join(' '), /end before it starts/i)
})

test('a good schedule has nothing to complain about', () => {
  assert.deepEqual(checkSchedule(daily()), [])
  assert.deepEqual(checkSchedule({ ...daily(), startsAt: 1000, endsAt: 2000, maxRuns: 5 }), [])
})

// ---------------------------------------------------------------- what was missed

test('the occurrences across a span are listed oldest first, and bounded', () => {
  const schedule = daily()
  const missed = occurrencesBetween(schedule, at(KOLKATA, 2026, 5, 1), endOf(KOLKATA, 2026, 5, 4))
  assert.deepEqual(missed.map((o) => reads(o.at, KOLKATA)), [
    '2026-05-01 08:00',
    '2026-05-02 08:00',
    '2026-05-03 08:00',
    '2026-05-04 08:00'
  ])

  // A minute-by-minute rule over a year is half a million moments; nobody asked for that.
  const busy: Schedule = { recurrence: { kind: 'interval', everyMinutes: 1, from: 0 }, timeZone: KOLKATA }
  assert.equal(occurrencesBetween(busy, 0, 365 * 86_400_000).length, 200)
})

test('a place with no schedule left returns nothing rather than looping', () => {
  // 30 February never comes round, and the search gives up rather than walking for ever.
  const never: Schedule = {
    recurrence: { kind: 'yearly', month: 2, day: 30, time: { hour: 8, minute: 0 }, short: 'skip' },
    timeZone: KOLKATA
  }
  assert.equal(nextOccurrence(never, at(KOLKATA, 2026, 1, 1)), null)
})
