import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  allSessions,
  asClock,
  describeHours,
  EXCHANGES,
  exchangeById,
  localParts,
  nextOpen,
  sessionState,
  untilChange
} from './sessions.ts'

/**
 * When a market is open.
 *
 * The daylight-saving tests are the point of this file. Offset arithmetic gets market hours right for ten months of the
 * year and wrong for the other two, and it is wrong in the direction of saying a closed market is open -- which is how a
 * screen comes to show a green "Open" dot over a price nobody can trade at.
 */

const nyse = exchangeById('NYSE')!
const nse = exchangeById('NSE')!
const crypto = exchangeById('CRYPTO')!

// ---------------------------------------------------------------- reading the local clock

test('the local clock is the exchange’s own, not the machine’s', () => {
  // 14:30 UTC on a Monday in January is 09:30 in New York (winter, UTC-5).
  const at = Date.UTC(2026, 0, 5, 14, 30)
  const here = localParts(at, 'America/New_York')
  assert.equal(here.weekday, 1)
  assert.equal(here.minute, 9 * 60 + 30)
  assert.equal(here.date, '2026-01-05')
})

test('a half-hour timezone is read correctly, not rounded to an hour', () => {
  // India is UTC+5:30. 04:00 UTC is 09:30 IST.
  const here = localParts(Date.UTC(2026, 0, 5, 4, 0), 'Asia/Kolkata')
  assert.equal(here.minute, 9 * 60 + 30)
})

test('the date rolls over in the exchange’s timezone, not in UTC', () => {
  // 23:00 UTC on the 5th is already the 6th in Tokyo.
  assert.equal(localParts(Date.UTC(2026, 0, 5, 23, 0), 'Asia/Tokyo').date, '2026-01-06')
  assert.equal(localParts(Date.UTC(2026, 0, 5, 23, 0), 'UTC').date, '2026-01-05')
})

// ---------------------------------------------------------------- daylight saving

test('New York opens at 14:30 UTC in winter and 13:30 UTC in summer', () => {
  // The whole reason this file uses Intl rather than arithmetic. Both of these are 09:30 in New York.
  const winter = sessionState(nyse, Date.UTC(2026, 0, 5, 14, 30))
  assert.equal(winter.phase, 'open')
  const summer = sessionState(nyse, Date.UTC(2026, 6, 6, 13, 30))
  assert.equal(summer.phase, 'open')

  // And an hour earlier, each is not yet in regular trading.
  assert.notEqual(sessionState(nyse, Date.UTC(2026, 0, 5, 13, 30)).phase, 'open')
  assert.notEqual(sessionState(nyse, Date.UTC(2026, 6, 6, 12, 30)).phase, 'open')
})

test('India does not observe daylight saving, so its hours do not move', () => {
  // 04:00 UTC is 09:30 IST all year: inside the 09:15 open both times.
  assert.equal(sessionState(nse, Date.UTC(2026, 0, 5, 4, 0)).phase, 'open')
  assert.equal(sessionState(nse, Date.UTC(2026, 6, 6, 4, 0)).phase, 'open')
})

// ---------------------------------------------------------------- the phases

test('before the open is pre-market where the exchange has one, and closed where it does not', () => {
  // 12:00 UTC in winter is 07:00 in New York: inside its 04:00 pre-market.
  assert.equal(sessionState(nyse, Date.UTC(2026, 0, 5, 12, 0)).phase, 'pre-market')
  // London has no pre-market session in these hours, so before the open it is simply closed.
  const lse = exchangeById('LSE')!
  assert.equal(sessionState(lse, Date.UTC(2026, 0, 5, 6, 0)).phase, 'closed')
})

test('after the close is after-hours where the exchange has one', () => {
  // 22:00 UTC in winter is 17:00 in New York.
  assert.equal(sessionState(nyse, Date.UTC(2026, 0, 5, 22, 0)).phase, 'after-hours')
  // And by 01:00 UTC -- 20:00 New York -- even that has ended.
  assert.equal(sessionState(nyse, Date.UTC(2026, 0, 6, 1, 30)).phase, 'closed')
})

test('the close is exclusive, so the closing minute is closed rather than both', () => {
  // 21:00 UTC in winter is 16:00 in New York, the moment regular trading ends.
  assert.notEqual(sessionState(nyse, Date.UTC(2026, 0, 5, 21, 0)).phase, 'open')
})

test('the weekend is closed, and nothing about the hours changes that', () => {
  // Saturday midday New York time.
  assert.equal(sessionState(nyse, Date.UTC(2026, 0, 3, 17, 0)).phase, 'closed')
  assert.equal(sessionState(nse, Date.UTC(2026, 0, 4, 5, 0)).phase, 'closed')
})

test('a holiday the exchange has told us about is closed, whatever the hours say', () => {
  // Hours say open; the calendar says otherwise, and the calendar wins.
  const withHoliday = { ...nyse, holidays: ['2026-01-05'] }
  const state = sessionState(withHoliday, Date.UTC(2026, 0, 5, 14, 30))
  assert.equal(state.phase, 'closed')
  assert.match(state.detail, /closed today/)
})

test('crypto is always open and never has a next change', () => {
  const state = sessionState(crypto, Date.UTC(2026, 0, 3, 3, 0))
  assert.equal(state.phase, 'always-open')
  assert.equal(state.changesAt, null)
  assert.equal(untilChange(state, Date.UTC(2026, 0, 3, 3, 0)), null)
  assert.equal(nextOpen(crypto, Date.now()), null)
})

// ---------------------------------------------------------------- when it changes

test('an open market says when it closes', () => {
  const at = Date.UTC(2026, 0, 5, 14, 30)
  const state = sessionState(nyse, at)
  assert.equal(state.phase, 'open')
  assert.ok(state.changesAt !== null)
  // 16:00 New York is 21:00 UTC in winter: six and a half hours from the open.
  assert.equal(state.changesAt, Date.UTC(2026, 0, 5, 21, 0))
  assert.equal(untilChange(state, at), 6.5 * 60 * 60 * 1000)
})

test('a closed market says when it next opens, and skips the weekend to do it', () => {
  // Friday evening in New York: the next open is Monday.
  const fridayNight = Date.UTC(2026, 0, 3, 2, 0)
  const opens = nextOpen(nyse, fridayNight)
  assert.ok(opens !== null)
  const when = localParts(opens, 'America/New_York')
  assert.equal(when.weekday, 1, 'it opens on a Monday')
  assert.equal(when.minute, 9 * 60 + 30)
})

test('the next open is always in the future, never the one that has just passed', () => {
  const at = Date.UTC(2026, 0, 5, 16, 0)
  const opens = nextOpen(nyse, at)
  assert.ok(opens !== null && opens > at)
})

test('the next open skips a holiday it has been told about', () => {
  const withHoliday = { ...nyse, holidays: ['2026-01-05'] }
  const opens = nextOpen(withHoliday, Date.UTC(2026, 0, 4, 12, 0))
  assert.ok(opens !== null)
  assert.equal(localParts(opens, 'America/New_York').date, '2026-01-06')
})

// ---------------------------------------------------------------- the catalogue

test('every exchange has real hours and a real timezone', () => {
  for (const exchange of EXCHANGES) {
    assert.ok(exchange.timezone.length > 0, `${exchange.id} has no timezone`)
    // Intl throws on a timezone it does not know, which is the check worth having.
    assert.doesNotThrow(() => localParts(Date.now(), exchange.timezone), `${exchange.id} has an unknown timezone`)
    assert.ok(exchange.days.length > 0, `${exchange.id} never trades`)
    assert.ok(
      exchange.alwaysOpen || exchange.regular.closeMinute > exchange.regular.openMinute,
      `${exchange.id} closes before it opens`
    )
    assert.ok(exchange.currency.length === 3, `${exchange.id} has no currency`)
  }
})

test('an extended session sits outside regular hours rather than inside them', () => {
  for (const exchange of EXCHANGES) {
    if (exchange.preMarket) {
      assert.ok(
        exchange.preMarket.closeMinute <= exchange.regular.openMinute,
        `${exchange.id} pre-market overlaps regular trading`
      )
    }
    if (exchange.afterHours) {
      assert.ok(
        exchange.afterHours.openMinute >= exchange.regular.closeMinute,
        `${exchange.id} after-hours overlaps regular trading`
      )
    }
  }
})

test('an exchange is found by its code, whatever the case', () => {
  assert.equal(exchangeById('nasdaq')?.id, 'NASDAQ')
  assert.equal(exchangeById('NASDAQ')?.id, 'NASDAQ')
  assert.equal(exchangeById('nope'), undefined)
})

test('every exchange answers at once, for the market clock', () => {
  const states = allSessions(Date.UTC(2026, 0, 5, 14, 30))
  assert.equal(states.length, EXCHANGES.length)
  assert.ok(states.some((s) => s.phase === 'open'))
  assert.ok(states.some((s) => s.phase === 'always-open'))
})

// ---------------------------------------------------------------- what is shown

test('hours read as hours', () => {
  assert.equal(describeHours(nse), '09:15–15:30')
  assert.equal(describeHours(crypto), 'Open 24 hours, every day')
})

test('a countdown reads as a clock', () => {
  assert.equal(asClock(0), '00:00:00')
  assert.equal(asClock(61_000), '00:01:01')
  assert.equal(asClock(6.5 * 60 * 60 * 1000), '06:30:00')
})
