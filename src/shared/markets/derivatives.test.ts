import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  annualisedBasis,
  asCountdown,
  basisOf,
  describeOi,
  formatRate,
  fundingAnnualised,
  fundingDirection,
  fundingStale,
  liquidationsByPrice,
  oiChange,
  oiWindowMs,
  overWindow,
  summariseLiquidations,
  untilFunding,
  OI_WINDOWS,
  type Funding,
  type Liquidation
} from './derivatives.ts'

const HOUR = 3_600_000

const funding = (patch: Partial<Funding> = {}): Funding => ({
  instrumentId: 'binance-futures:crypto:binance:btcusdt',
  rate: 0.0001,
  at: 1_000_000,
  nextAt: 1_000_000 + 4 * HOUR,
  intervalMs: 8 * HOUR,
  source: 'binance-futures',
  ...patch
})

const liquidation = (patch: Partial<Liquidation> = {}): Liquidation => ({
  instrumentId: 'binance-futures:crypto:binance:btcusdt',
  symbol: 'BTCUSDT',
  side: 'sell',
  price: 90_000,
  size: 1,
  notional: 90_000,
  at: 1_000_000,
  source: 'binance-futures',
  ...patch
})

// ---------------------------------------------------------------- basis

test('basis is the gap between the future and the index, absolutely and proportionally', () => {
  const result = basisOf(101_000, 100_000)
  assert.equal(result?.absolute, 1000)
  assert.equal(result?.fraction, 0.01)
})

test('a future below the index has a negative basis', () => {
  assert.equal(basisOf(99_000, 100_000)?.absolute, -1000)
})

test('no index price means no basis, rather than one measured against the last trade', () => {
  assert.equal(basisOf(101_000, null), null)
  assert.equal(basisOf(null, 100_000), null)
  assert.equal(basisOf(101_000, 0), null)
  assert.equal(basisOf(Number.NaN, 100_000), null)
})

test('basis is annualised only for a dated contract with time left on it', () => {
  const at = 1_000_000
  // Roughly a quarter of a year out: 1% over that is about 4% a year.
  const annual = annualisedBasis(0.01, at + 91 * 24 * HOUR, at)
  assert.ok(annual !== null && annual > 0.039 && annual < 0.042)
  // A perpetual has no expiry to annualise over. That is why funding exists instead.
  assert.equal(annualisedBasis(0.01, null, at), null)
  // Expired, and about to expire, both produce nothing rather than an enormous figure.
  assert.equal(annualisedBasis(0.01, at - HOUR, at), null)
  assert.equal(annualisedBasis(0.01, at + 60_000, at), null)
})

// ---------------------------------------------------------------- funding

test('funding is annualised only when the interval is known', () => {
  // One basis point every eight hours is about 10.95% a year.
  const annual = fundingAnnualised(0.0001, 8 * HOUR)
  assert.ok(annual !== null && annual > 0.109 && annual < 0.11)
  // Without the interval this cannot be worked out, and assuming the usual eight hours would be a guess.
  assert.equal(fundingAnnualised(0.0001, null), null)
  assert.equal(fundingAnnualised(0.0001, 0), null)
})

test('the sign of the rate says which side pays', () => {
  assert.equal(fundingDirection(0.0001), 'longs-pay')
  assert.equal(fundingDirection(-0.0001), 'shorts-pay')
  assert.equal(fundingDirection(0), 'flat')
  assert.equal(fundingDirection(Number.NaN), 'flat')
})

test('the countdown comes from the venue’s own funding time', () => {
  const at = 1_000_000
  assert.equal(untilFunding(funding({ nextAt: at + 90_000 }), at), 90_000)
})

test('a countdown never goes negative', () => {
  // The bug this exists to prevent: a timer that keeps counting past zero into minus figures.
  const at = 1_000_000
  assert.equal(untilFunding(funding({ nextAt: at - 5000 }), at), 0)
})

test('no published funding time means no countdown, not a guessed eight-hour cycle', () => {
  assert.equal(untilFunding(funding({ nextAt: null }), 1_000_000), null)
  assert.equal(untilFunding(null, 1_000_000), null)
})

test('a funding time long past is called stale rather than shown stuck at zero', () => {
  const at = 1_000_000
  assert.equal(fundingStale(funding({ nextAt: at - 60_000, intervalMs: 8 * HOUR }), at), false)
  assert.equal(fundingStale(funding({ nextAt: at - 9 * HOUR, intervalMs: 8 * HOUR }), at), true)
  assert.equal(fundingStale(funding({ nextAt: null }), at), false)
})

// ---------------------------------------------------------------- open interest

test('open interest change is absolute and proportional', () => {
  const change = oiChange({ at: 1, amount: 100, notional: null }, { at: 2, amount: 125, notional: null })
  assert.equal(change?.absolute, 25)
  assert.equal(change?.fraction, 0.25)
})

test('a rise from nothing has no proportion, rather than an infinite one', () => {
  const change = oiChange({ at: 1, amount: 0, notional: null }, { at: 2, amount: 50, notional: null })
  assert.equal(change?.absolute, 50)
  assert.equal(change?.fraction, null)
})

test('a window needs a history that actually covers it', () => {
  const at = 10 * HOUR
  const history = [
    { at: at - 5 * HOUR, amount: 100, notional: null },
    { at: at - 3 * HOUR, amount: 110, notional: null },
    { at, amount: 130, notional: null }
  ]
  const window = overWindow(history, 4 * HOUR, at)
  // The earliest reading inside the window, not the earliest reading there is.
  assert.equal(window?.from.at, at - 3 * HOUR)
  assert.equal(window?.to.at, at)
  // One reading cannot bound a period.
  assert.equal(overWindow([history[0]], 4 * HOUR, at), null)
  // A window the history does not reach into has no answer.
  assert.equal(overWindow(history, 1000, at), null)
})

test('open interest and price are described side by side, and nothing is claimed about why', () => {
  const both = describeOi({ absolute: 10, fraction: 0.1 }, 0.02)
  assert.deepEqual(both, { oi: 'rising', price: 'rising' })
  assert.deepEqual(describeOi({ absolute: -10, fraction: -0.1 }, 0.02), { oi: 'falling', price: 'rising' })
  assert.deepEqual(describeOi(null, null), { oi: 'unknown', price: 'unknown' })
  assert.deepEqual(describeOi({ absolute: 0, fraction: 0 }, 0), { oi: 'flat', price: 'flat' })
})

// ---------------------------------------------------------------- liquidations

test('a long is liquidated by a sell, and the summary keeps the two sides apart', () => {
  const at = 1_000_000
  const summary = summariseLiquidations(
    [
      liquidation({ side: 'sell', notional: 90_000, at: at - 1000 }),
      liquidation({ side: 'buy', notional: 40_000, at: at - 2000 }),
      liquidation({ side: 'sell', notional: 10_000, at: at - 3000 })
    ],
    HOUR,
    at
  )
  assert.equal(summary.count, 3)
  assert.equal(summary.longNotional, 100_000)
  assert.equal(summary.shortNotional, 40_000)
  assert.equal(summary.totalNotional, 140_000)
  assert.equal(summary.largest?.notional, 90_000)
})

test('liquidations outside the window are not counted', () => {
  const at = 1_000_000
  const summary = summariseLiquidations([liquidation({ at: at - 5 * HOUR })], HOUR, at)
  assert.equal(summary.count, 0)
  assert.equal(summary.totalNotional, 0)
  assert.equal(summary.largest, null)
})

test('liquidations group by price, and the grouping is of what happened', () => {
  const levels = liquidationsByPrice(
    [
      liquidation({ price: 90_100, side: 'sell', notional: 1000 }),
      liquidation({ price: 90_900, side: 'buy', notional: 2000 }),
      liquidation({ price: 91_000, side: 'sell', notional: 500 })
    ],
    1000
  )
  assert.equal(levels.length, 2)
  assert.equal(levels[0].price, 91_000)
  assert.equal(levels[1].price, 90_000)
  assert.equal(levels[1].count, 2)
  assert.equal(levels[1].longNotional, 1000)
  assert.equal(levels[1].shortNotional, 2000)
})

test('an invalid bucket groups nothing', () => {
  assert.deepEqual(liquidationsByPrice([liquidation()], 0), [])
})

// ---------------------------------------------------------------- how it reads

test('a rate reads as a percentage with its sign, and a missing one as a dash', () => {
  assert.equal(formatRate(0.0001), '+0.0100%')
  assert.equal(formatRate(-0.00025), '-0.0250%')
  assert.equal(formatRate(null), '—')
  assert.equal(formatRate(Number.NaN), '—')
})

test('a countdown reads as hours, minutes and seconds, and nothing when there is nothing to count', () => {
  assert.equal(asCountdown(2 * HOUR + 14 * 60_000 + 31_000), '02:14:31')
  assert.equal(asCountdown(0), '00:00:00')
  assert.equal(asCountdown(null), '')
  assert.equal(asCountdown(-1), '')
})

test('every open-interest window is a real period', () => {
  for (const one of OI_WINDOWS) {
    assert.ok(one.ms > 0)
    assert.equal(oiWindowMs(one.id), one.ms)
  }
  assert.equal(oiWindowMs('nonsense'), 24 * HOUR)
})
