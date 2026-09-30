import assert from 'node:assert/strict'
import test from 'node:test'
import { intervalMs, isLive, periodStart, withLivePrice } from './liveCandle.ts'
import type { Candle } from './indicators.ts'

/**
 * The candle that has not finished yet.
 *
 * A chart is only level with the price beside it if the period in progress is built from the prices arriving. These
 * are about that arithmetic, and — more of them — about what it refuses to touch: a period that has closed, and a gap
 * where nothing traded.
 */

const MIN = 60_000
/**
 * A base on a day boundary, so every interval's buckets line up with it.
 *
 * The first version used a round-looking number that was not on a minute boundary at all -- 1.7e12 sits twenty seconds
 * into its minute -- and nine tests failed against code that was correct. Bucket arithmetic measures from the epoch,
 * so a fixture has to as well.
 */
const at = (minutes: number): number => 1_699_920_000_000 + minutes * MIN

const candle = (over: Partial<Candle> = {}): Candle => ({
  time: at(0),
  open: 100,
  high: 105,
  low: 95,
  close: 102,
  volume: 10,
  ...over
})

test('a minute is a minute and a month is a month', () => {
  // The one piece of this that has to be read carefully: lower-case m is a minute, capital M is a month.
  assert.equal(intervalMs('1m'), 60_000)
  assert.equal(intervalMs('5m'), 300_000)
  assert.equal(intervalMs('1h'), 3_600_000)
  assert.equal(intervalMs('4h'), 4 * 3_600_000)
  assert.equal(intervalMs('1d'), 86_400_000)
  assert.equal(intervalMs('1w'), 7 * 86_400_000)
  assert.equal(intervalMs('1M'), 30 * 86_400_000)
  assert.notEqual(intervalMs('1m'), intervalMs('1M'))
})

test('a label this does not understand is refused rather than guessed', () => {
  for (const bad of ['', 'tick', '0m', '-5m', 'm', '1y', 'abc', '1 2m']) {
    assert.equal(intervalMs(bad), null, bad)
  }
})

test('periods are measured from the epoch, so they line up with the provider’s', () => {
  assert.equal(periodStart(at(3) + 12_345, MIN), at(3))
  assert.equal(periodStart(at(3), MIN), at(3))
})

// ---------------------------------------------------------------- the period in progress

test('a price inside the newest period moves its close', () => {
  const out = withLivePrice([candle()], { price: 103, at: at(0) + 30_000 }, '1m')
  assert.equal(out.length, 1)
  assert.equal(out[0].close, 103)
  assert.equal(out[0].open, 100, 'the open is not touched')
})

test('a price beyond the newest period’s range extends it', () => {
  const up = withLivePrice([candle()], { price: 111, at: at(0) + 10 }, '1m')
  assert.equal(up[0].high, 111)
  assert.equal(up[0].low, 95)

  const down = withLivePrice([candle()], { price: 90, at: at(0) + 10 }, '1m')
  assert.equal(down[0].low, 90)
  assert.equal(down[0].high, 105)
})

test('a price inside the range leaves the range alone', () => {
  const out = withLivePrice([candle()], { price: 101, at: at(0) + 10 }, '1m')
  assert.equal(out[0].high, 105)
  assert.equal(out[0].low, 95)
  assert.equal(out[0].close, 101)
})

test('nothing changing returns the very same array, so the chart does not redraw', () => {
  // A market that has not moved must not cost a redraw on every tick.
  const before = [candle({ close: 102 })]
  assert.equal(withLivePrice(before, { price: 102, at: at(0) + 10 }, '1m'), before)
})

// ---------------------------------------------------------------- crossing into the next period

test('crossing into a new period opens a candle at the price that opened it', () => {
  const out = withLivePrice([candle()], { price: 107, at: at(1) + 5 }, '1m')
  assert.equal(out.length, 2)
  assert.deepEqual(out[1], { time: at(1), open: 107, high: 107, low: 107, close: 107, volume: null })
  assert.deepEqual(out[0], candle(), 'the period that closed is untouched')
})

test('a candle built here reports no volume rather than none traded', () => {
  // Zero is a claim that nothing traded. Null is the admission that nobody here counted.
  const out = withLivePrice([candle()], { price: 107, at: at(1) }, '1m')
  assert.equal(out[1].volume, null)
})

test('a long gap opens the period the price is really in, and leaves the gap', () => {
  /**
   * The machine was asleep, the tab was hidden, the market was closed. Filling the gap with flat candles would be a
   * picture of trading that did not happen.
   */
  const out = withLivePrice([candle()], { price: 120, at: at(500) + 10 }, '1m')
  assert.equal(out.length, 2, 'two candles, not five hundred and one')
  assert.equal(out[1].time, at(500))
})

// ---------------------------------------------------------------- what it will not touch

test('a price from a period that has already closed is ignored', () => {
  /**
   * It would rewrite a candle somebody has already read, and the provider's own record of a closed period is better
   * than one late price.
   */
  const before = [candle({ time: at(5) })]
  assert.equal(withLivePrice(before, { price: 999, at: at(2) }, '1m'), before)
})

test('only the newest candle is ever touched', () => {
  const before = [candle({ time: at(0) }), candle({ time: at(1) }), candle({ time: at(2) })]
  const out = withLivePrice(before, { price: 500, at: at(2) + 10 }, '1m')
  assert.deepEqual(out.slice(0, 2), before.slice(0, 2))
  assert.equal(out[2].close, 500)
})

test('nothing is invented from nothing', () => {
  // With no candles there is no period to extend and no open to inherit; a chart with no data stays a chart with none.
  assert.deepEqual(withLivePrice([], { price: 100, at: at(0) }, '1m'), [])
})

test('an unusable price or interval changes nothing', () => {
  const before = [candle()]
  assert.equal(withLivePrice(before, { price: Number.NaN, at: at(0) }, '1m'), before)
  assert.equal(withLivePrice(before, { price: 100, at: Number.NaN }, '1m'), before)
  assert.equal(withLivePrice(before, { price: 100, at: at(0) }, 'nonsense'), before)
})

test('the same rule holds on a longer interval', () => {
  // Five minutes: three minutes in is the same candle, six minutes in is the next one.
  const out = withLivePrice([candle()], { price: 103, at: at(3) }, '5m')
  assert.equal(out.length, 1)
  assert.equal(out[0].close, 103)

  const next = withLivePrice([candle()], { price: 103, at: at(6) }, '5m')
  assert.equal(next.length, 2)
  assert.equal(next[1].time, at(5))
})

// ---------------------------------------------------------------- saying which is which

test('a chart can tell a candle it built from one the provider sent', () => {
  assert.equal(isLive([candle({ time: at(4) })], at(4) + 20_000, '1m'), true)
  assert.equal(isLive([candle({ time: at(4) })], at(9), '1m'), false)
  assert.equal(isLive([], at(0), '1m'), false)
  assert.equal(isLive([candle()], at(0), 'nonsense'), false)
})
