import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  aggregateByPrice,
  aggregateByTime,
  describePressure,
  filterTape,
  isLarge,
  notionalOf,
  pressure,
  relativeVolume,
  suggestedThreshold,
  tapeStats,
  windowMsFor,
  PRESSURE_WINDOWS
} from './tape.ts'
import type { TradePrint } from './provider.ts'

const print = (patch: Partial<TradePrint> = {}): TradePrint => ({
  instrumentId: 'binance:crypto:binance:btcusdt',
  price: 100,
  size: 1,
  side: 'buy',
  timestamp: 1_000_000,
  ...patch
})

// ---------------------------------------------------------------- what a print is worth

test('a print is worth its price times its size', () => {
  assert.equal(notionalOf(print({ price: 250, size: 0.4 })), 100)
})

test('a print with no usable price or size is worth nothing knowable, not zero', () => {
  assert.equal(notionalOf(print({ price: Number.NaN })), null)
  assert.equal(notionalOf(print({ size: Number.POSITIVE_INFINITY })), null)
  assert.equal(notionalOf(print({ price: 0 })), null)
  assert.equal(notionalOf(print({ size: -1 })), null)
})

// ---------------------------------------------------------------- large prints

test('large is measured in money, so one bitcoin and one dogecoin are not the same trade', () => {
  const bitcoin = print({ price: 90_000, size: 1 })
  const doge = print({ price: 0.12, size: 1 })
  assert.equal(isLarge(bitcoin, 50_000), true)
  assert.equal(isLarge(doge, 50_000), false)
})

test('a print exactly on the threshold is large', () => {
  assert.equal(isLarge(print({ price: 100, size: 10 }), 1000), true)
})

test('no threshold means nothing is large, rather than everything', () => {
  assert.equal(isLarge(print(), 0), false)
  assert.equal(isLarge(print(), Number.NaN), false)
})

test('a suggested threshold comes from this market’s own prints', () => {
  // Thirty prints of $100, and one of $1,000,000. The median is unmoved, which is the point of using it.
  const trades = [...Array(30)].map(() => print({ price: 100, size: 1 }))
  trades.push(print({ price: 100, size: 10_000 }))
  assert.equal(suggestedThreshold(trades, 10), 1000)
})

test('too short a tape has no median, and says so rather than guessing one', () => {
  assert.equal(suggestedThreshold([print(), print(), print()]), null)
})

// ---------------------------------------------------------------- filters

test('a side filter shows only prints the venue actually classified', () => {
  const trades = [
    print({ side: 'buy' }),
    print({ side: 'sell' }),
    print({ side: 'unknown' }),
    print({ side: 'unknown' })
  ]
  assert.equal(filterTape(trades, 'buys').length, 1)
  assert.equal(filterTape(trades, 'sells').length, 1)
  // The two unclassified prints appear in neither. A filter that guessed would invent the thing it filters on.
  assert.equal(filterTape(trades, 'all').length, 4)
})

test('the large filter uses the configured threshold and nothing else', () => {
  const trades = [print({ size: 1 }), print({ size: 50 }), print({ size: 200 })]
  assert.equal(filterTape(trades, 'large', 4000).length, 2)
  assert.equal(filterTape(trades, 'large', 0).length, 0)
})

// ---------------------------------------------------------------- pressure

test('pressure counts buys and sells separately and never splits the unknown', () => {
  const now = 2_000_000
  const reading = pressure(
    [
      print({ side: 'buy', price: 100, size: 3, timestamp: now - 1000 }),
      print({ side: 'sell', price: 100, size: 1, timestamp: now - 2000 }),
      print({ side: 'unknown', price: 100, size: 6, timestamp: now - 3000 })
    ],
    60_000,
    now
  )
  assert.equal(reading.buyNotional, 300)
  assert.equal(reading.sellNotional, 100)
  assert.equal(reading.unknownNotional, 600)
  assert.equal(reading.totalNotional, 1000)
  assert.equal(reading.buyShare, 0.75)
  assert.equal(reading.netNotional, 200)
  // Four tenths of the volume was classifiable. Said, because a reading over 40% of a tape is a reading of 40% of it.
  assert.equal(reading.classifiedShare, 0.4)
})

test('a venue that classifies nothing produces no ratio, not a balanced one', () => {
  const reading = pressure([print({ side: 'unknown' }), print({ side: 'unknown' })], 60_000, 1_000_001)
  assert.equal(reading.buyShare, null)
  assert.equal(reading.netNotional, null)
  assert.equal(reading.classifiedShare, 0)
  assert.equal(reading.unknownNotional, 200)
})

test('prints outside the window are not counted', () => {
  const now = 10_000_000
  const reading = pressure(
    [print({ timestamp: now - 1000, size: 1 }), print({ timestamp: now - 500_000, size: 1000 })],
    60_000,
    now
  )
  assert.equal(reading.count, 1)
  assert.equal(reading.buyNotional, 100)
})

test('a print from the future is not counted', () => {
  const now = 10_000_000
  assert.equal(pressure([print({ timestamp: now + 5000 })], 60_000, now).count, 0)
})

test('the window reported is the one the tape actually covers', () => {
  const now = 10_000_000
  // Asked for a minute; the tape only reaches back two seconds. Reporting the minute would overstate the sample.
  const reading = pressure([print({ timestamp: now - 2000 }), print({ timestamp: now - 500 })], 60_000, now)
  assert.equal(reading.from, now - 2000)
  assert.equal(reading.to, now - 500)
})

test('an empty window is empty rather than zero-shaped', () => {
  const reading = pressure([], 60_000, 500)
  assert.equal(reading.count, 0)
  assert.equal(reading.buyShare, null)
  assert.equal(reading.classifiedShare, null)
  assert.equal(reading.totalNotional, 0)
})

test('pressure is described in words from the same numbers it shows', () => {
  const at = 1_000_000
  const buying = pressure(
    [...Array(6)].map((_, i) => print({ side: 'buy', timestamp: at - i * 10 })),
    60_000,
    at
  )
  assert.equal(describePressure(buying), 'buying')

  const selling = pressure(
    [...Array(6)].map((_, i) => print({ side: 'sell', timestamp: at - i * 10 })),
    60_000,
    at
  )
  assert.equal(describePressure(selling), 'selling')

  const thin = pressure([print({ side: 'buy', timestamp: at })], 60_000, at)
  assert.equal(describePressure(thin), 'thin')

  const blind = pressure([print({ side: 'unknown', timestamp: at })], 60_000, at)
  assert.equal(describePressure(blind), 'unclassified')
})

test('a ratio from a sliver of the tape is not presented as a market reading', () => {
  const at = 1_000_000
  // One classified buy against a great deal of unclassified volume: 100% buying, over 1% of the tape.
  const trades = [print({ side: 'buy', size: 1, timestamp: at })]
  for (let i = 0; i < 20; i++) trades.push(print({ side: 'unknown', size: 10, timestamp: at - i }))
  const reading = pressure(trades, 60_000, at)
  assert.equal(reading.buyShare, 1)
  assert.ok((reading.classifiedShare ?? 1) < 0.1)
  assert.equal(describePressure(reading), 'unclassified')
})

test('an even split is balanced', () => {
  const at = 1_000_000
  const trades = [...Array(6)].map((_, i) =>
    print({ side: i % 2 === 0 ? 'buy' : 'sell', timestamp: at - i * 10 })
  )
  assert.equal(describePressure(pressure(trades, 60_000, at)), 'balanced')
})

// ---------------------------------------------------------------- aggregation

test('the tape grouped by price keeps every print and says how many went into each level', () => {
  const buckets = aggregateByPrice(
    [
      print({ price: 100.4, size: 1, side: 'buy' }),
      print({ price: 109.9, size: 2, side: 'sell' }),
      print({ price: 111, size: 1, side: 'unknown' })
    ],
    10
  )
  assert.equal(buckets.length, 2)
  // Highest price first, like a depth ladder reads.
  assert.equal(buckets[0].price, 110)
  assert.equal(buckets[1].price, 100)
  const low = buckets[1]
  assert.equal(low.count, 2)
  assert.equal(low.size, 3)
  assert.equal(low.buyNotional, 100.4)
  assert.equal(Math.round(low.sellNotional), 220)
  // Nothing is lost: the prints add up to what went in.
  const total = buckets.reduce((sum, one) => sum + one.count, 0)
  assert.equal(total, 3)
})

test('floating point cannot split one price into two levels', () => {
  // 0.1 buckets are where this goes wrong: 0.3 / 0.1 is 2.9999999999999996.
  const buckets = aggregateByPrice([print({ price: 0.3 }), print({ price: 0.34 })], 0.1)
  assert.equal(buckets.length, 1)
  assert.equal(buckets[0].count, 2)
})

test('an invalid bucket produces nothing rather than one enormous level', () => {
  assert.deepEqual(aggregateByPrice([print()], 0), [])
  assert.deepEqual(aggregateByPrice([print()], Number.NaN), [])
})

test('the tape grouped by time is aligned, so the same tape always gives the same buckets', () => {
  const minute = 60_000
  const buckets = aggregateByTime(
    [
      print({ timestamp: 3 * minute + 100, price: 10 }),
      print({ timestamp: 3 * minute + 40_000, price: 12 }),
      print({ timestamp: 4 * minute + 10, price: 11 })
    ],
    minute
  )
  assert.equal(buckets.length, 2)
  assert.equal(buckets[0].at, 3 * minute)
  assert.equal(buckets[0].count, 2)
  assert.equal(buckets[0].open, 10)
  assert.equal(buckets[0].close, 12)
  assert.equal(buckets[0].high, 12)
  assert.equal(buckets[0].low, 10)
  assert.equal(buckets[1].at, 4 * minute)
})

test('an interval with no prints is absent rather than a bar claiming a price of zero', () => {
  const minute = 60_000
  const buckets = aggregateByTime([print({ timestamp: minute }), print({ timestamp: 5 * minute })], minute)
  assert.equal(buckets.length, 2)
  assert.equal(buckets[0].at, minute)
  assert.equal(buckets[1].at, 5 * minute)
})

test('open and close are chronological however the tape arrived', () => {
  const minute = 60_000
  const buckets = aggregateByTime(
    [print({ timestamp: minute + 500, price: 20 }), print({ timestamp: minute + 100, price: 10 })],
    minute
  )
  assert.equal(buckets[0].open, 10)
  assert.equal(buckets[0].close, 20)
})

// ---------------------------------------------------------------- what the tape adds up to

test('the visible tape adds up, and an average of nothing is nothing', () => {
  const stats = tapeStats([
    print({ price: 100, size: 1, timestamp: 1000 }),
    print({ price: 100, size: 3, timestamp: 3000 })
  ])
  assert.equal(stats.count, 2)
  assert.equal(stats.size, 4)
  assert.equal(stats.notional, 400)
  assert.equal(stats.averageNotional, 200)
  assert.equal(stats.medianNotional, 200)
  assert.equal(stats.largest?.notional, 300)
  assert.equal(stats.from, 1000)
  assert.equal(stats.to, 3000)
  assert.equal(stats.perSecond, 1)

  const empty = tapeStats([])
  assert.equal(empty.count, 0)
  assert.equal(empty.averageNotional, null)
  assert.equal(empty.medianNotional, null)
  assert.equal(empty.largest, null)
  assert.equal(empty.from, null)
  assert.equal(empty.perSecond, null)
})

test('a tape spanning no time has no rate, rather than an infinite one', () => {
  const stats = tapeStats([print({ timestamp: 5000 }), print({ timestamp: 5000 })])
  assert.equal(stats.count, 2)
  assert.equal(stats.perSecond, null)
})

test('a malformed print is left out of the totals rather than poisoning them', () => {
  const stats = tapeStats([print({ price: 100, size: 1 }), print({ price: Number.NaN })])
  assert.equal(stats.count, 1)
  assert.equal(stats.notional, 100)
  assert.ok(Number.isFinite(stats.notional))
})

// ---------------------------------------------------------------- relative volume

test('relative volume is a ratio, and no baseline means no ratio', () => {
  assert.equal(relativeVolume(200, 100), 2)
  assert.equal(relativeVolume(200, null), null)
  assert.equal(relativeVolume(null, 100), null)
  // Zero baseline would be division by zero, which is not "infinitely busy".
  assert.equal(relativeVolume(200, 0), null)
})

// ---------------------------------------------------------------- the windows on offer

test('every pressure window is a real length of time', () => {
  for (const one of PRESSURE_WINDOWS) {
    assert.ok(one.ms > 0)
    assert.equal(windowMsFor(one.id), one.ms)
  }
  // An unknown window falls back to the first rather than to zero, which would measure nothing.
  assert.equal(windowMsFor('nonsense'), PRESSURE_WINDOWS[0].ms)
})
