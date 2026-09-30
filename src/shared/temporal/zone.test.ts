import assert from 'node:assert/strict'
import test from 'node:test'
import { addDays, daysInMonth, deviceZone, isKnownZone, offsetAt, wallTimeAt, zonedToEpoch } from './zone.ts'

/**
 * Wall-clock time in a named place.
 *
 * These are the arithmetic a schedule stands on, so most of them are about the days of the year when the arithmetic
 * is not obvious: the mornings clocks move, the months that have no 31st, and the Februaries with no 29th. Fixed
 * dates throughout, because a test that only passes in July is not a test.
 */

const KOLKATA = 'Asia/Kolkata'
const NEW_YORK = 'America/New_York'
const LONDON = 'Europe/London'

test('a clock reads the same moment differently in different places', () => {
  // 2026-03-01 12:00 UTC.
  const noonUtc = Date.UTC(2026, 2, 1, 12, 0, 0)
  assert.equal(wallTimeAt(noonUtc, 'UTC').hour, 12)
  // India is five and a half hours ahead, which is also the case for keeping minutes rather than whole hours.
  const india = wallTimeAt(noonUtc, KOLKATA)
  assert.equal(india.hour, 17)
  assert.equal(india.minute, 30)
  // New York is five hours behind in winter.
  assert.equal(wallTimeAt(noonUtc, NEW_YORK).hour, 7)
})

test('midnight reads as hour zero, not twenty-four', () => {
  // Some engines render midnight as 24 under h23, which would look like the following day.
  const midnight = zonedToEpoch({ year: 2026, month: 6, day: 15, hour: 0, minute: 0 }, KOLKATA)
  const reads = wallTimeAt(midnight.epochMs, KOLKATA)
  assert.equal(reads.hour, 0)
  assert.equal(reads.day, 15)
})

test('a wall time converts to a moment and back to itself', () => {
  for (const zone of [KOLKATA, NEW_YORK, LONDON, 'UTC']) {
    for (const [month, day] of [[1, 15], [6, 15], [12, 31]] as const) {
      const asked = { year: 2026, month, day, hour: 8, minute: 30 }
      const moment = zonedToEpoch(asked, zone)
      const reads = wallTimeAt(moment.epochMs, zone)
      assert.equal(reads.hour, 8, `${zone} ${month}/${day}`)
      assert.equal(reads.minute, 30, `${zone} ${month}/${day}`)
      assert.equal(reads.day, day, `${zone} ${month}/${day}`)
      assert.equal(moment.resolution, 'exact')
    }
  }
})

// ---------------------------------------------------------------- the two mornings a year

test('8am stays 8am across a clock change, which a stored epoch does not', () => {
  /**
   * The fault this file exists to prevent. New York went forward on 8 March 2026; a schedule kept as a fixed number
   * of milliseconds would read 9am afterwards.
   */
  const before = zonedToEpoch({ year: 2026, month: 3, day: 7, hour: 8, minute: 0 }, NEW_YORK)
  const after = zonedToEpoch({ year: 2026, month: 3, day: 9, hour: 8, minute: 0 }, NEW_YORK)
  assert.equal(wallTimeAt(before.epochMs, NEW_YORK).hour, 8)
  assert.equal(wallTimeAt(after.epochMs, NEW_YORK).hour, 8)
  // And the two are 47 hours apart, not 48, because an hour of that span did not happen.
  assert.equal((after.epochMs - before.epochMs) / 3_600_000, 47)
})

test('a local time the clocks jumped over is reported as skipped, not invented', () => {
  // 2:30am does not exist in New York on 8 March 2026; the hour goes 01:59 → 03:00.
  const skipped = zonedToEpoch({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, NEW_YORK)
  assert.equal(skipped.resolution, 'skipped')
  // Shifted forward by the length of the gap, which is what a calendar does with an appointment in the missing hour.
  const reads = wallTimeAt(skipped.epochMs, NEW_YORK)
  assert.equal(reads.day, 8)
  assert.equal(reads.hour, 3)
  assert.equal(reads.minute, 30)
})

test('a local time that happens twice is reported as ambiguous, and the first is used', () => {
  /**
   * New York went back on 1 November 2026, so 1:30am happened twice. A schedule said once should run once, and the
   * earlier reading is the one a person means by "half past one".
   */
  const twice = zonedToEpoch({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, NEW_YORK)
  assert.equal(twice.resolution, 'ambiguous')
  assert.equal(wallTimeAt(twice.epochMs, NEW_YORK).hour, 1)
  // The earlier one is still on daylight time: four hours behind UTC rather than five.
  assert.equal(offsetAt(twice.epochMs, NEW_YORK) / 3_600_000, -4)
})

test('a place with no clock changes has none of this', () => {
  // India keeps one offset all year, so nothing is ever skipped or doubled.
  for (const [month, day] of [[3, 8], [11, 1], [6, 15]] as const) {
    const moment = zonedToEpoch({ year: 2026, month, day, hour: 2, minute: 30 }, KOLKATA)
    assert.equal(moment.resolution, 'exact', `${month}/${day}`)
  }
})

test('London changes on different days from New York', () => {
  // Offsets are political, which is the reason for reading a database rather than hardcoding them.
  const lateMarch = Date.UTC(2026, 2, 20, 12, 0)
  assert.equal(offsetAt(lateMarch, LONDON) / 3_600_000, 0, 'London is still on GMT')
  assert.equal(offsetAt(lateMarch, NEW_YORK) / 3_600_000, -4, 'New York has already gone forward')
})

// ---------------------------------------------------------------- short months and February

test('the length of a month is answered, not assumed', () => {
  assert.equal(daysInMonth(2026, 1), 31)
  assert.equal(daysInMonth(2026, 2), 28)
  assert.equal(daysInMonth(2026, 4), 30)
  assert.equal(daysInMonth(2026, 12), 31)
})

test('leap years, including the century rule', () => {
  assert.equal(daysInMonth(2028, 2), 29)
  assert.equal(daysInMonth(2100, 2), 28, '2100 is not a leap year')
  assert.equal(daysInMonth(2000, 2), 29, '2000 was')
})

test('adding days walks the calendar rather than a fixed span', () => {
  assert.deepEqual(addDays({ year: 2026, month: 1, day: 31 }, 1), { year: 2026, month: 2, day: 1 })
  assert.deepEqual(addDays({ year: 2026, month: 2, day: 28 }, 1), { year: 2026, month: 3, day: 1 })
  assert.deepEqual(addDays({ year: 2028, month: 2, day: 28 }, 1), { year: 2028, month: 2, day: 29 })
  assert.deepEqual(addDays({ year: 2026, month: 12, day: 31 }, 1), { year: 2027, month: 1, day: 1 })
  assert.deepEqual(addDays({ year: 2026, month: 3, day: 1 }, -1), { year: 2026, month: 2, day: 28 })
})

test('adding days across a clock change is still whole days', () => {
  // Because it walks the calendar rather than adding 86,400,000 milliseconds.
  assert.deepEqual(addDays({ year: 2026, month: 3, day: 7 }, 2), { year: 2026, month: 3, day: 9 })
})

// ---------------------------------------------------------------- knowing the place

test('a zone this computer does not know is refused, not treated as UTC', () => {
  // Silently falling back to UTC would put somebody's 8am schedule hours out with nothing on screen to say so.
  assert.equal(isKnownZone(KOLKATA), true)
  assert.equal(isKnownZone('UTC'), true)
  assert.equal(isKnownZone('Mars/Olympus_Mons'), false)
  assert.equal(isKnownZone(''), false)
  assert.equal(isKnownZone('not a zone'), false)
})

test('this computer can say where it is', () => {
  const here = deviceZone()
  assert.ok(here.length > 0)
  assert.equal(isKnownZone(here), true)
})

test('the weekday comes back with the date', () => {
  // 2026-03-01 was a Sunday.
  assert.equal(wallTimeAt(Date.UTC(2026, 2, 1, 12, 0), 'UTC').weekday, 0)
  assert.equal(wallTimeAt(Date.UTC(2026, 2, 2, 12, 0), 'UTC').weekday, 1)
  assert.equal(wallTimeAt(Date.UTC(2026, 2, 7, 12, 0), 'UTC').weekday, 6)
})
