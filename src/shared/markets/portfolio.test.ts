import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  allocationOf,
  equityStats,
  exposureOf,
  performanceOf,
  roundTrips,
  shouldRecord,
  type EquityPoint
} from './portfolio.ts'
import type { PaperFill, PaperPosition } from './paper.ts'

/**
 * What a simulated account has done.
 *
 * The distinction every test here turns on: **a fill is not a trade.** Buying twice and selling once is three fills and no
 * completed trade, and a win rate counted over fills would call the sale that closed half a losing position a win.
 */

const fill = (over: Partial<PaperFill> = {}): PaperFill => ({
  orderId: 'o1',
  instrumentId: 'binance:crypto:binance:btcusdt',
  side: 'buy',
  quantity: 1,
  price: 100,
  fee: 0,
  at: 1_000,
  realised: 0,
  ...over
})

const position = (over: Partial<PaperPosition> = {}): PaperPosition => ({
  instrumentId: 'binance:crypto:binance:btcusdt',
  quantity: 1,
  averagePrice: 100,
  feesPaid: 0,
  openedAt: 1_000,
  ...over
})

const BTC = 'binance:crypto:binance:btcusdt'
const ETH = 'binance:crypto:binance:ethusdt'

// ---------------------------------------------------------------- round trips

test('a position opened and closed is one trade', () => {
  const trips = roundTrips([
    fill({ side: 'buy', quantity: 2, price: 100, at: 1_000 }),
    fill({ side: 'sell', quantity: 2, price: 110, at: 5_000 })
  ])
  assert.equal(trips.length, 1)
  assert.equal(trips[0].direction, 'long')
  assert.equal(trips[0].quantity, 2)
  assert.equal(trips[0].entryPrice, 100)
  assert.equal(trips[0].exitPrice, 110)
  assert.equal(trips[0].net, 20)
  assert.equal(trips[0].holdingMs, 4_000)
})

test('a position still open is not a trade', () => {
  // Counting it would let an unrealised loss hide by simply not being sold.
  assert.deepEqual(roundTrips([fill({ side: 'buy', quantity: 1 })]), [])
})

test('buying twice and selling once is one trade, not three', () => {
  const trips = roundTrips([
    fill({ side: 'buy', quantity: 1, price: 100, at: 1_000 }),
    fill({ side: 'buy', quantity: 1, price: 200, at: 2_000 }),
    fill({ side: 'sell', quantity: 2, price: 180, at: 3_000 })
  ])
  assert.equal(trips.length, 1)
  // The weighted average of what went in, not the last price paid.
  assert.equal(trips[0].entryPrice, 150)
  assert.equal(trips[0].exitPrice, 180)
  assert.equal(trips[0].net, 60)
})

test('closing half leaves the trade open until the rest goes', () => {
  const half = roundTrips([
    fill({ side: 'buy', quantity: 2, price: 100, at: 1_000 }),
    fill({ side: 'sell', quantity: 1, price: 110, at: 2_000 })
  ])
  assert.deepEqual(half, [])
  const whole = roundTrips([
    fill({ side: 'buy', quantity: 2, price: 100, at: 1_000 }),
    fill({ side: 'sell', quantity: 1, price: 110, at: 2_000 }),
    fill({ side: 'sell', quantity: 1, price: 90, at: 3_000 })
  ])
  assert.equal(whole.length, 1)
  // 110 + 90 against 200 in: exactly flat, which is the honest answer rather than one win and one loss.
  assert.equal(whole[0].net, 0)
})

test('fees come out of the trade’s result', () => {
  const trips = roundTrips([
    fill({ side: 'buy', quantity: 1, price: 100, fee: 1, at: 1_000 }),
    fill({ side: 'sell', quantity: 1, price: 110, fee: 1, at: 2_000 })
  ])
  assert.equal(trips[0].fees, 2)
  assert.equal(trips[0].net, 8)
})

test('a short round trip makes money when the price falls', () => {
  const trips = roundTrips([
    fill({ side: 'sell', quantity: 1, price: 100, at: 1_000 }),
    fill({ side: 'buy', quantity: 1, price: 80, at: 2_000 })
  ])
  assert.equal(trips.length, 1)
  assert.equal(trips[0].direction, 'short')
  assert.equal(trips[0].net, 20)
})

test('two instruments are two separate trades', () => {
  const trips = roundTrips([
    fill({ instrumentId: BTC, side: 'buy', quantity: 1, price: 100, at: 1_000 }),
    fill({ instrumentId: ETH, side: 'buy', quantity: 1, price: 10, at: 1_100 }),
    fill({ instrumentId: ETH, side: 'sell', quantity: 1, price: 12, at: 2_000 }),
    fill({ instrumentId: BTC, side: 'sell', quantity: 1, price: 90, at: 3_000 })
  ])
  assert.equal(trips.length, 2)
  // Oldest close first.
  assert.deepEqual(trips.map((t) => t.instrumentId), [ETH, BTC])
  assert.equal(trips[0].net, 2)
  assert.equal(trips[1].net, -10)
})

test('a floating-point remainder is treated as flat', () => {
  // A position of 1e-15 units is not a position anybody holds.
  const trips = roundTrips([
    fill({ side: 'buy', quantity: 0.3, price: 100, at: 1_000 }),
    fill({ side: 'sell', quantity: 0.1, price: 100, at: 2_000 }),
    fill({ side: 'sell', quantity: 0.1, price: 100, at: 3_000 }),
    fill({ side: 'sell', quantity: 0.1, price: 100, at: 4_000 })
  ])
  assert.equal(trips.length, 1)
})

test('the return is a share of what was put in', () => {
  const trips = roundTrips([
    fill({ side: 'buy', quantity: 2, price: 50, at: 1_000 }),
    fill({ side: 'sell', quantity: 2, price: 60, at: 2_000 })
  ])
  assert.equal(trips[0].returnPercent, 20)
})

// ---------------------------------------------------------------- performance

test('nothing completed leaves every ratio unavailable rather than zero', () => {
  // A win rate of 0% reads as "you lost everything", which is a very different statement from "nothing has finished".
  const p = performanceOf([])
  assert.equal(p.trades, 0)
  assert.equal(p.winRate, null)
  assert.equal(p.averageWin, null)
  assert.equal(p.averageLoss, null)
  assert.equal(p.profitFactor, null)
  assert.equal(p.expectancy, null)
  assert.equal(p.medianHoldingMs, null)
})

test('wins, losses and the ratios between them', () => {
  const trips = roundTrips([
    fill({ instrumentId: BTC, side: 'buy', quantity: 1, price: 100, at: 1 }),
    fill({ instrumentId: BTC, side: 'sell', quantity: 1, price: 130, at: 2 }),
    fill({ instrumentId: ETH, side: 'buy', quantity: 1, price: 100, at: 3 }),
    fill({ instrumentId: ETH, side: 'sell', quantity: 1, price: 90, at: 4 })
  ])
  const p = performanceOf(trips)
  assert.equal(p.trades, 2)
  assert.equal(p.wins, 1)
  assert.equal(p.losses, 1)
  assert.equal(p.winRate, 50)
  assert.equal(p.averageWin, 30)
  assert.equal(p.averageLoss, -10)
  assert.equal(p.profitFactor, 3)
  assert.equal(p.expectancy, 10)
  assert.equal(p.best, 30)
  assert.equal(p.worst, -10)
  assert.equal(p.netRealised, 20)
})

test('nothing lost is not an infinite profit factor', () => {
  const trips = roundTrips([
    fill({ side: 'buy', quantity: 1, price: 100, at: 1 }),
    fill({ side: 'sell', quantity: 1, price: 110, at: 2 })
  ])
  const p = performanceOf(trips)
  // Infinity on a results screen is not an answer.
  assert.equal(p.profitFactor, null)
  assert.equal(p.averageLoss, null)
  assert.equal(p.winRate, 100)
})

test('a flat trade is neither a win nor a loss', () => {
  const trips = roundTrips([
    fill({ side: 'buy', quantity: 1, price: 100, at: 1 }),
    fill({ side: 'sell', quantity: 1, price: 100, at: 2 })
  ])
  const p = performanceOf(trips)
  assert.equal(p.breakEven, 1)
  assert.equal(p.wins, 0)
  assert.equal(p.losses, 0)
})

// ---------------------------------------------------------------- allocation

test('allocation is each holding’s share of what is known', () => {
  const view = allocationOf(
    [position({ instrumentId: BTC, quantity: 1, averagePrice: 100 }), position({ instrumentId: ETH, quantity: 2, averagePrice: 10 })],
    50,
    new Map([
      [BTC, 150],
      [ETH, 25]
    ])
  )
  // 150 + 50 + 50 cash = 250.
  assert.equal(view.positions[0].value, 150)
  assert.equal(view.positions[0].share, 60)
  assert.equal(view.positions[1].value, 50)
  assert.equal(view.positions[1].share, 20)
  assert.equal(view.cashShare, 20)
  assert.deepEqual(view.unpriced, [])
})

test('a holding with no price gets no share rather than a zero one', () => {
  // Drawing it as nothing would shrink every other slice to compensate.
  const view = allocationOf([position({ instrumentId: BTC }), position({ instrumentId: ETH })], 0, new Map([[BTC, 100]]))
  assert.equal(view.positions[0].share, 100)
  assert.equal(view.positions[1].share, null)
  assert.equal(view.positions[1].value, null)
  assert.deepEqual(view.unpriced, [ETH])
})

test('unrealised profit is measured against what was paid', () => {
  const view = allocationOf([position({ quantity: 2, averagePrice: 100 })], 0, new Map([[BTC, 120]]))
  assert.equal(view.positions[0].unrealised, 40)
  assert.equal(view.positions[0].unrealisedPercent, 20)
})

test('a short gains when the price falls', () => {
  const view = allocationOf([position({ quantity: -2, averagePrice: 100 })], 0, new Map([[BTC, 80]]))
  assert.equal(view.positions[0].unrealised, 40)
})

test('an empty account allocates nothing rather than dividing by nothing', () => {
  const view = allocationOf([], 0, new Map())
  assert.deepEqual(view.positions, [])
  assert.equal(view.cashShare, null)
})

// ---------------------------------------------------------------- exposure

test('exposure separates longs from shorts and says what it could not price', () => {
  const e = exposureOf(
    [position({ instrumentId: BTC, quantity: 2 }), position({ instrumentId: ETH, quantity: -3 })],
    new Map([
      [BTC, 100],
      [ETH, 10]
    ]),
    1_000
  )
  assert.equal(e.long, 200)
  assert.equal(e.short, 30)
  assert.equal(e.gross, 230)
  assert.equal(e.net, 170)
  assert.equal(e.grossPercent, 23)
})

test('exposure with no total gives no percentage rather than a division by zero', () => {
  const e = exposureOf([position({ quantity: 1 })], new Map([[BTC, 100]]), 0)
  assert.equal(e.grossPercent, null)
})

// ---------------------------------------------------------------- the equity curve

const point = (at: number, total: number, realised = 0): EquityPoint => ({ at, total, cash: total, realised })

test('an equity curve of one reading has no return to report', () => {
  const stats = equityStats([point(1_000, 100)])
  assert.equal(stats.points, 1)
  assert.equal(stats.changePercent, null)
  assert.equal(stats.sharpe, null)
})

test('an equity curve reports its change and its worst fall', () => {
  const stats = equityStats([point(1, 100), point(2, 120), point(3, 90), point(4, 110)])
  assert.equal(stats.changePercent, 10)
  // 120 down to 90 is the worst peak-to-trough.
  assert.ok(Math.abs(stats.drawdown.maxPercent - 25) < 1e-9, `got ${stats.drawdown.maxPercent}`)
})

test('an equity curve that never moved has no meaningful ratio', () => {
  // The flat-series case: floating-point noise in the denominator once produced a Sharpe of 3e16.
  const flat = Array.from({ length: 60 }, (_v, i) => point(i, 1_000))
  const stats = equityStats(flat)
  assert.equal(stats.sharpe, null)
  assert.equal(stats.drawdown.maxPercent, 0)
})

test('an empty curve is empty rather than an invented starting point', () => {
  const stats = equityStats([])
  assert.equal(stats.points, 0)
  assert.equal(stats.first, null)
  assert.equal(stats.last, null)
  assert.equal(stats.coveredMs, 0)
})

test('the period a curve covers is what it actually observed', () => {
  // Orbis being closed for two days leaves a gap, and the gap is the truth about what was seen.
  const stats = equityStats([point(1_000, 100), point(500_000, 110)])
  assert.equal(stats.coveredMs, 499_000)
})

// ---------------------------------------------------------------- recording

test('the first reading is always worth keeping', () => {
  assert.equal(shouldRecord(null, point(1, 100)), true)
})

test('a reading too soon after the last is not kept', () => {
  assert.equal(shouldRecord(point(0, 100), point(30_000, 200), 60_000), false)
})

test('an unchanged value is not worth another point', () => {
  // An idle account would otherwise fill the curve and make a flat line look like activity.
  assert.equal(shouldRecord(point(0, 100), point(120_000, 100), 60_000), false)
})

test('a changed value is worth a point', () => {
  assert.equal(shouldRecord(point(0, 100), point(120_000, 101), 60_000), true)
})

test('a trade is worth a point even when the total lands in the same place', () => {
  assert.equal(shouldRecord(point(0, 100, 0), point(120_000, 100, 5), 60_000), true)
})
