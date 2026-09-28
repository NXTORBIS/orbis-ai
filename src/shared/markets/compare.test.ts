import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  alignedTimes,
  compareStats,
  correlationMatrix,
  COMPARE_ASSUMPTIONS,
  indexSeries,
  MAX_COMPARED,
  MINIMUM_OBSERVATIONS,
  type CompareSeries
} from './compare.ts'
import type { Candle } from './indicators.ts'

const HOUR = 3_600_000

const candles = (closes: number[], start = 0, step = HOUR): Candle[] =>
  closes.map((close, i) => ({ time: start + i * step, open: close, high: close, low: close, close, volume: 1 }))

const series = (symbol: string, closes: number[], start = 0): CompareSeries => ({
  instrumentId: `binance:crypto:binance:${symbol.toLowerCase()}`,
  symbol,
  candles: candles(closes, start)
})

// ---------------------------------------------------------------- alignment

test('only the moments every market has in common are compared', () => {
  const a = series('A', [1, 2, 3, 4])
  const b: CompareSeries = { ...series('B', [1, 2, 3]), candles: candles([1, 2, 3], HOUR) }
  const times = alignedTimes([a, b])
  // A has 0..3h, B has 1h..3h. The overlap is three moments, and the gap is not filled.
  assert.deepEqual(times, [HOUR, 2 * HOUR, 3 * HOUR])
})

test('markets with nothing in common compare over nothing rather than being lined up by position', () => {
  const a = series('A', [1, 2, 3], 0)
  const b = series('B', [1, 2, 3], 1_000 * HOUR)
  assert.deepEqual(alignedTimes([a, b]), [])
  const indexed = indexSeries([a, b])
  assert.deepEqual(indexed[0].points, [])
  assert.equal(indexed[0].totalPercent, null)
})

// ---------------------------------------------------------------- indexing

test('every series starts at 100, so markets of different prices can share one chart', () => {
  const indexed = indexSeries([series('BTC', [80_000, 88_000]), series('SOL', [200, 190])])
  assert.equal(indexed[0].points[0].value, 100)
  assert.equal(indexed[1].points[0].value, 100)
  // A tenth up and a twentieth down, which is the comparison worth making. Compared with a tolerance because rebasing
  // is a division: 88000/80000*100 is 110.00000000000001, and asserting exact equality would be asserting about floats.
  assert.ok(Math.abs(indexed[0].points[1].changePercent - 10) < 1e-9)
  assert.ok(Math.abs(indexed[1].points[1].changePercent - -5) < 1e-9)
})

test('the base is kept, so the indexing can be undone and checked', () => {
  const indexed = indexSeries([series('BTC', [80_000, 88_000])])
  assert.equal(indexed[0].base, 80_000)
  assert.ok(Math.abs((indexed[0].points[1].value / 100) * (indexed[0].base ?? 0) - 88_000) < 1e-6)
})

test('a series with no usable opening price is empty rather than rebased against nonsense', () => {
  const broken: CompareSeries = {
    instrumentId: 'x',
    symbol: 'X',
    candles: [{ time: 0, open: 0, high: 0, low: 0, close: 0, volume: null }]
  }
  const indexed = indexSeries([broken])
  assert.equal(indexed[0].base, null)
  assert.deepEqual(indexed[0].points, [])
})

test('the total move is the last point, and null with a single observation', () => {
  assert.equal(indexSeries([series('A', [100, 150])])[0].totalPercent, 50)
  assert.equal(indexSeries([series('A', [100])])[0].totalPercent, null)
})

// ---------------------------------------------------------------- statistics

test('statistics need enough aligned observations, and say so when there are not', () => {
  const thin = compareStats([series('A', [1, 2, 3]), series('B', [1, 2, 3])])
  assert.equal(thin[0].volatility, null)
  assert.equal(thin[0].sharpe, null)
  assert.equal(thin[0].maxDrawdownPercent, null)
  assert.equal(thin[0].observations, 3)
  // The total move is still knowable from two points, and is still given.
  assert.ok(thin[0].totalPercent !== null)
})

test('with enough observations the figures are computed, over the same window for everybody', () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 3) * 5)
  const other = Array.from({ length: 60 }, (_, i) => 50 + Math.cos(i / 3) * 2)
  const stats = compareStats([series('A', closes), series('B', other)])
  assert.ok(stats[0].volatility !== null && stats[0].volatility > 0)
  assert.ok(stats[0].maxDrawdownPercent !== null && stats[0].maxDrawdownPercent > 0)
  // Same number of observations for both, which is what makes the two rows comparable.
  assert.equal(stats[0].observations, stats[1].observations)
  assert.ok(stats[0].observations >= MINIMUM_OBSERVATIONS)
})

test('a flat series does not produce an absurd Sharpe ratio', () => {
  const flat = Array.from({ length: 60 }, () => 100)
  const stats = compareStats([series('FLAT', flat)])
  // The stability rule from the risk module: effectively zero volatility is unavailable, not three times ten to the
  // sixteenth.
  assert.equal(stats[0].sharpe, null)
  assert.equal(stats[0].volatility, 0)
})

// ---------------------------------------------------------------- correlation

test('correlation is computed from aligned returns, and refused when too few overlap', () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + i)
  const same = Array.from({ length: 60 }, (_, i) => 50 + i * 0.5)
  const matrix = correlationMatrix([series('A', closes), series('B', same)])
  const pair = matrix.find((one) => one.a === 'A' && one.b === 'B')
  assert.ok(pair?.value !== null && pair!.value! > 0.9)

  const thin = correlationMatrix([series('A', [1, 2, 3]), series('B', [1, 2, 3])])
  const thinPair = thin.find((one) => one.a === 'A' && one.b === 'B')
  assert.equal(thinPair?.value, null)
  assert.ok((thinPair?.observations ?? 0) < MINIMUM_OBSERVATIONS)
})

test('a market is perfectly correlated with itself, and the matrix includes that cell', () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i) * 3)
  const matrix = correlationMatrix([series('A', closes)])
  const self = matrix.find((one) => one.a === 'A' && one.b === 'A')
  assert.ok(self?.value !== null && Math.abs((self?.value ?? 0) - 1) < 1e-9)
})

test('markets sampled at different moments produce no correlation rather than one from a mismatch', () => {
  const a = series('A', Array.from({ length: 60 }, (_, i) => 100 + i), 0)
  const b = series('B', Array.from({ length: 60 }, (_, i) => 100 + i), 5_000 * HOUR)
  const pair = correlationMatrix([a, b]).find((one) => one.a === 'A' && one.b === 'B')
  assert.equal(pair?.value, null)
  assert.equal(pair?.observations, 0)
})

// ---------------------------------------------------------------- what it admits to

test('the assumptions say outright that prices are not being compared', () => {
  const text = COMPARE_ASSUMPTIONS.join(' ').toLowerCase()
  assert.ok(text.includes('rebased to 100'))
  assert.ok(text.includes('not comparable'))
  assert.ok(text.includes('gaps are not filled'))
  assert.ok(MAX_COMPARED >= 2 && MAX_COMPARED <= 10)
})
