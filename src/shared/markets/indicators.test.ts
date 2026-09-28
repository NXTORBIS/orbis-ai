import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  accumulationDistribution,
  adx,
  atr,
  availableIndicators,
  bollinger,
  calculate,
  crossedAbove,
  crossedBelow,
  ema,
  historicalVolatility,
  INDICATORS,
  indicatorInfo,
  level,
  macd,
  mfi,
  obv,
  roc,
  rsi,
  sma,
  stochastic,
  trueRange,
  typical,
  vwap,
  williamsR,
  wma,
  type Candle
} from './indicators.ts'

/**
 * The indicators.
 *
 * Checked against numbers worked out independently rather than against whatever the code happens to return, because an
 * indicator that is subtly wrong looks exactly like one that is right: it draws a plausible line, and every signal taken
 * from it is quietly wrong.
 *
 * Two things are checked everywhere: that a period which has not happened yet is null rather than zero, and that every
 * series comes back the same length as its input. A series off by one shifts every signal by a bar and is invisible.
 */

/** Candles from closes, with a range around each so the OHLC indicators have something real to read. */
const bars = (values: number[], volume: number | null = 1000): Candle[] =>
  values.map((close, i) => ({
    time: Date.UTC(2026, 0, 1 + i),
    open: i === 0 ? close : values[i - 1],
    high: close + 1,
    low: close - 1,
    close,
    volume
  }))

const RISING = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

// ---------------------------------------------------------------- the two rules

test('every series is the same length as its input, so it plots against the candles', () => {
  const candles = bars([...RISING, ...RISING, ...RISING])
  const values = candles.map((c) => c.close)
  for (const info of INDICATORS) {
    const result = calculate(info.kind, candles, info.defaults)
    for (const [name, series] of Object.entries(result)) {
      assert.equal(series.length, candles.length, `${info.kind}.${name} is ${series.length}, not ${candles.length}`)
    }
  }
  void values
})

test('a period that has not happened yet is null, never zero', () => {
  // Zero would draw a line along the bottom of the chart and make a crossover out of nothing.
  assert.deepEqual(sma([1, 2, 3], 5), [null, null, null])
  assert.deepEqual(ema([1, 2, 3], 5), [null, null, null])
  assert.deepEqual(wma([1, 2, 3], 5), [null, null, null])
  assert.deepEqual(rsi([1, 2, 3], 14), [null, null, null])
  assert.deepEqual(atr(bars([1, 2, 3]), 14), [null, null, null])
  assert.deepEqual(roc([1, 2, 3], 12), [null, null, null])
})

// ---------------------------------------------------------------- averages

test('a simple moving average is the mean of the last N, and starts at N', () => {
  // (1+2+3)/3 = 2, then (2+3+4)/3 = 3, and so on.
  assert.deepEqual(sma(RISING, 3), [null, null, 2, 3, 4, 5, 6, 7, 8, 9])
})

test('an exponential moving average is seeded with the simple average of the first N', () => {
  // Seeding from one value makes the first dozen points depend on where the data happened to start, so two charts of the
  // same instrument over different ranges disagree. The first value here is the mean of 1..5.
  const out = ema(RISING, 5)
  assert.equal(out[3], null)
  assert.equal(out[4], 3)
  // Then 6 * (2/6) + 3 * (4/6) = 4.
  assert.equal(out[5], 4)
})

test('a weighted moving average leans on the newest value', () => {
  // (3*3 + 2*2 + 1*1) / 6 = 14/6
  assert.equal(wma([1, 2, 3], 3)?.[2], 14 / 6)
})

test('a period of zero or less produces nothing rather than dividing by it', () => {
  assert.deepEqual(sma(RISING, 0), new Array(10).fill(null))
  assert.deepEqual(ema(RISING, -3), new Array(10).fill(null))
  assert.deepEqual(wma(RISING, 0), new Array(10).fill(null))
})

// ---------------------------------------------------------------- VWAP

test('VWAP resets each day, because VWAP is a session measure', () => {
  // Two days of one bar each. If it did not reset, the second day would be dragged towards the first.
  const twoDays: Candle[] = [
    { time: Date.UTC(2026, 0, 1, 15), open: 10, high: 10, low: 10, close: 10, volume: 100 },
    { time: Date.UTC(2026, 0, 2, 15), open: 20, high: 20, low: 20, close: 20, volume: 100 }
  ]
  assert.deepEqual(vwap(twoDays), [10, 20])
  // Without the reset the second bar would be the average of both.
  assert.deepEqual(vwap(twoDays, false), [10, 15])
})

test('VWAP without volume is null, not a price average', () => {
  // A volume-weighted number with no volume is a different number, not a weaker version of the same one.
  assert.deepEqual(vwap(bars([10, 20], null)), [null, null])
})

// ---------------------------------------------------------------- momentum

test('RSI of a market that only rises is 100', () => {
  const out = rsi(RISING, 5)
  assert.equal(out[5], 100)
})

test('RSI of a market that only falls is 0', () => {
  const falling = [...RISING].reverse()
  assert.equal(rsi(falling, 5)?.[5], 0)
})

test('RSI of a flat market has no answer rather than 50', () => {
  // There is no relative strength when nothing moved either way. 50 would look like a real reading.
  assert.equal(rsi([5, 5, 5, 5, 5, 5, 5, 5], 3)?.[7], null)
})

test('RSI lands exactly where hand arithmetic puts it', () => {
  /*
   * The classic worked series. Done by hand, with Wilder's seed -- the simple average of the first fourteen moves:
   *
   *   gains  0.34 + 0.06 + 0.72 + 0.50 + 0.27 + 0.32 + 0.42 + 0.24 + 0.14 + 0.67  = 3.68  -> 0.262857
   *   losses 0.25 + 0.54 + 0.19 + 0.42                                            = 1.40  -> 0.100000
   *   RS = 2.628571,  RSI = 100 - 100 / 3.628571 = 72.4409...
   *
   * Checked tightly on purpose. A loose band would hide the difference between Wilder's smoothing and an EMA of the same
   * period, which is exactly the mistake this indicator invites.
   */
  const values = [44, 44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28]
  const last = rsi(values, 14)[14]
  assert.ok(last !== null)
  assert.ok(Math.abs(last - 72.440945) < 0.000001, `RSI was ${last}`)
})

test('MACD is the gap between two EMAs, and its signal only exists where the gap does', () => {
  const values = Array.from({ length: 60 }, (_v, i) => 100 + i)
  const m = macd(values, 12, 26, 9)
  // Nothing before the slow EMA exists.
  assert.equal(m.macd[24], null)
  assert.ok(m.macd[25] !== null)
  // The signal starts nine bars after the line, not nine bars into the data.
  assert.equal(m.signal[32], null)
  assert.ok(m.signal[33] !== null)
  // And the histogram is their difference wherever both exist.
  const i = 40
  assert.equal(m.histogram[i], (m.macd[i] as number) - (m.signal[i] as number))
})

test('rate of change is a percentage of the price N bars ago', () => {
  // From 100 to 110 over 2 bars is +10%.
  assert.equal(roc([100, 105, 110], 2)?.[2], 10)
})

test('rate of change from zero has no percentage rather than infinity', () => {
  assert.equal(roc([0, 5, 10], 2)?.[2], null)
})

test('the stochastic says where the close sits in the range, and nothing when there is no range', () => {
  const flat = bars([5, 5, 5, 5]).map((c) => ({ ...c, high: 5, low: 5 }))
  assert.equal(stochastic(flat, 3).k[3], null, 'a range of nothing has no position in it')
  /*
   * And a rising market, worked out by hand. These bars span close-1 to close+1, so over the last three bars of 1..10 the
   * range is 7 to 11 and the close is 10:
   *
   *   (10 - 7) / (11 - 7) * 100 = 75
   *
   * Not 100: the close is a point below the highest high, because the last bar's own high is above its close. Asserting
   * 100 here would have been asserting that the bars have no range.
   */
  const k = stochastic(bars(RISING), 3).k[9]
  assert.equal(k, 75)
})

test('Williams %R is the stochastic measured from the top, so it is negative', () => {
  const out = williamsR(bars(RISING), 3)
  const last = out[9]
  assert.ok(last !== null && last <= 0 && last >= -100, `Williams %R was ${last}`)
})

// ---------------------------------------------------------------- volatility

test('Bollinger Bands sit either side of the average, and are equal on a flat market', () => {
  const flat = new Array(25).fill(10)
  const b = bollinger(flat, 20, 2)
  assert.equal(b.middle[24], 10)
  assert.equal(b.upper[24], 10, 'no deviation means no width')
  assert.equal(b.lower[24], 10)
})

test('Bollinger Bands widen with the spread', () => {
  const values = Array.from({ length: 25 }, (_v, i) => (i % 2 === 0 ? 8 : 12))
  const b = bollinger(values, 20, 2)
  assert.ok((b.upper[24] as number) > (b.middle[24] as number))
  assert.ok((b.lower[24] as number) < (b.middle[24] as number))
})

test('the true range is the largest of the bar and its gaps from the previous close', () => {
  const previous: Candle = { time: 0, open: 10, high: 10, low: 10, close: 10, volume: null }
  // A bar 12-11 after a close of 10: the gap up to 12 is 2, bigger than its own range of 1.
  const gapped: Candle = { time: 1, open: 11, high: 12, low: 11, close: 12, volume: null }
  assert.equal(trueRange(gapped, previous), 2)
  // With nothing before it, the range is its own.
  assert.equal(trueRange(gapped, undefined), 1)
})

test('ATR on bars of constant range is that range', () => {
  // Every bar spans 2 and does not gap, so the average true range is 2.
  const steady: Candle[] = Array.from({ length: 20 }, (_v, i) => ({
    time: i,
    open: 10,
    high: 11,
    low: 9,
    close: 10,
    volume: null
  }))
  assert.equal(atr(steady, 14)?.[19], 2)
})

test('historical volatility of a flat market is zero, and of a moving one is not', () => {
  assert.equal(historicalVolatility(new Array(30).fill(10), 20)?.[29], 0)
  const moving = Array.from({ length: 30 }, (_v, i) => 10 * (1 + (i % 2 === 0 ? 0.02 : -0.02)))
  assert.ok((historicalVolatility(moving, 20)?.[29] as number) > 0)
})

// ---------------------------------------------------------------- volume

test('on-balance volume adds on up days and subtracts on down days', () => {
  const candles = bars([10, 11, 10, 12], 100)
  // 0, +100, -100, +100
  assert.deepEqual(obv(candles), [0, 100, 0, 100])
})

test('on-balance volume without volume is null throughout, not a flat line at zero', () => {
  assert.deepEqual(obv(bars([10, 11, 12], null)), [null, null, null])
})

test('the money flow index needs volume and says so by being null', () => {
  assert.ok(mfi(bars(Array.from({ length: 20 }, (_v, i) => 10 + i), null), 14).every((v) => v === null))
  const withVolume = mfi(bars(Array.from({ length: 20 }, (_v, i) => 10 + i), 100), 14)
  assert.equal(withVolume[19], 100, 'a market that only rises has all its money flowing in')
})

test('accumulation/distribution needs volume too', () => {
  assert.ok(accumulationDistribution(bars([10, 11], null)).every((v) => v === null))
  assert.ok(accumulationDistribution(bars([10, 11], 100)).every((v) => v !== null))
})

// ---------------------------------------------------------------- trend strength

test('ADX and its directional indicators stay within their bounds', () => {
  const candles = bars(Array.from({ length: 60 }, (_v, i) => 100 + i))
  const a = adx(candles, 14)
  for (const series of [a.adx, a.plusDi, a.minusDi]) {
    for (const value of series) {
      if (value === null) continue
      assert.ok(value >= 0 && value <= 100, `out of bounds: ${value}`)
    }
  }
  // A market that only rises has more positive direction than negative.
  assert.ok((a.plusDi[59] as number) > (a.minusDi[59] as number))
})

// ---------------------------------------------------------------- crossings

test('a crossing needs both bars of both series, so a line that just began has crossed nothing', () => {
  const a = [null, 1, 3]
  const b = [null, 2, 2]
  assert.equal(crossedAbove(a, b, 1), false, 'at its first value it has not crossed')
  assert.equal(crossedAbove(a, b, 2), true)
  assert.equal(crossedAbove(a, b, 0), false)
})

test('crossing below is the mirror, and touching is not crossing back', () => {
  assert.equal(crossedBelow([3, 1], [2, 2], 1), true)
  assert.equal(crossedBelow([1, 3], [2, 2], 1), false)
  // Equal then equal is not a crossing either way.
  assert.equal(crossedAbove([2, 2], [2, 2], 1), false)
  assert.equal(crossedBelow([2, 2], [2, 2], 1), false)
})

test('a level is a series, so a price crossing 200 is the same code as two lines crossing', () => {
  const price = [199, 201]
  assert.equal(crossedAbove(price, level(200, 2), 1), true)
})

// ---------------------------------------------------------------- the catalogue

test('every indicator in the catalogue really calculates', () => {
  const candles = bars(Array.from({ length: 80 }, (_v, i) => 100 + Math.sin(i / 3) * 5))
  for (const info of INDICATORS) {
    const result = calculate(info.kind, candles, info.defaults)
    assert.ok(Object.keys(result).length > 0, `${info.kind} produced nothing`)
    const some = Object.values(result).some((series) => series.some((v) => v !== null))
    assert.ok(some, `${info.kind} produced only nulls on 80 bars`)
  }
})

test('an indicator that needs volume is not offered when there is none', () => {
  // Offering it and drawing nothing looks like a bug; offering it and drawing zeros would be worse.
  const withVolume = availableIndicators(bars([1, 2, 3], 100))
  const without = availableIndicators(bars([1, 2, 3], null))
  assert.ok(withVolume.some((i) => i.kind === 'obv'))
  assert.ok(!without.some((i) => i.kind === 'obv'))
  assert.ok(!without.some((i) => i.needsVolume))
  // And the ones that do not need it are still there.
  assert.ok(without.some((i) => i.kind === 'rsi'))
})

test('every catalogue entry can be looked up by its kind', () => {
  for (const info of INDICATORS) {
    assert.equal(indicatorInfo(info.kind)?.name, info.name)
  }
})

test('a nonsense period falls back to the default rather than breaking', () => {
  const candles = bars(Array.from({ length: 40 }, (_v, i) => 100 + i))
  const bad = calculate('sma', candles, { period: -5 })
  const good = calculate('sma', candles, { period: 20 })
  assert.deepEqual(bad, good)
})

test('the typical price is the middle of the bar', () => {
  assert.equal(typical({ time: 0, open: 0, high: 12, low: 6, close: 9, volume: null }), 9)
})
