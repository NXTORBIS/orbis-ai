import { test } from 'node:test'
import assert from 'node:assert/strict'
import { backtest, sweep, validateCandles, DEFAULT_COSTS } from './backtest.ts'
import { cleanStrategy, seriesFor, warmupIndex, type Strategy } from './strategy.ts'
import { sma } from './indicators.ts'
import type { Candle } from './indicators.ts'

/**
 * Running a strategy over history.
 *
 * The two tests that matter most here are the two places a backtest usually lies: acting on a bar's close at that same
 * close, and assuming the target when a bar contained both the stop and the target. Both are pinned down below with
 * candles built so that the wrong behaviour produces a visibly different number.
 */

const strategy = (over: Partial<Strategy> = {}): Strategy => ({
  id: 's1',
  name: 'Test',
  version: 1,
  instrumentId: 'binance:crypto:binance:btcusdt',
  interval: '1h',
  direction: 'long',
  entry: { match: 'all', rules: [{ left: { kind: 'price', field: 'close' }, comparator: 'above', right: { kind: 'value', value: 100 } }] },
  exit: { match: 'all', rules: [{ left: { kind: 'price', field: 'close' }, comparator: 'below', right: { kind: 'value', value: 100 } }] },
  sizing: { kind: 'fixed-quantity', value: 1 },
  cooldownBars: 0,
  createdAt: 0,
  updatedAt: 0,
  ...over
})

const HOUR = 3_600_000

/** A candle from its four prices; time is the index so a test can read the result back. */
const bar = (i: number, open: number, high: number, low: number, close: number, volume = 10): Candle => ({
  time: i * HOUR,
  open,
  high,
  low,
  close,
  volume
})

/** A flat series of `n` bars at `price`, so a test can put the only interesting bar where it wants it. */
const flat = (n: number, price: number): Candle[] =>
  Array.from({ length: n }, (_v, i) => bar(i, price, price, price, price))

const free = { slippage: 0, feeRate: 0 }

// ---------------------------------------------------------------- no look-ahead

test('a signal on a bar is acted on at the next bar’s open, not at the close that produced it', () => {
  // Bar 5 closes at 120, which satisfies "close above 100". Bar 6 opens at 200 — a gap. Filling at the close that
  // produced the signal would buy at 120 and show a 66% gain that nobody could have had.
  const candles = [
    ...flat(5, 90),
    bar(5, 90, 120, 90, 120),
    bar(6, 200, 210, 200, 205),
    bar(7, 205, 205, 205, 205),
    bar(8, 90, 205, 90, 90),
    bar(9, 90, 90, 90, 90)
  ]
  const result = backtest(strategy(), candles, { startingCash: 100_000, costs: free })
  assert.equal(result.trades.length, 1)
  // The open of the bar after the signal, which is the first price anybody could have traded at.
  assert.equal(result.trades[0].entryPrice, 200)
  assert.equal(result.trades[0].entryIndex, 6)
})

test('the last bar produces no entry, because there is no bar to fill at', () => {
  const candles = [...flat(5, 90), bar(5, 90, 120, 90, 120)]
  const result = backtest(strategy(), candles, { startingCash: 10_000, costs: free })
  assert.deepEqual(result.trades, [])
})

test('an indicator series is causal, which is what makes computing it once safe', () => {
  // The backtester computes every series over the whole history and then walks it. That is only sound because nothing at
  // index i depends on a candle after i. If this ever stopped being true, every result above would be quietly wrong.
  const candles = Array.from({ length: 60 }, (_v, i) => bar(i, 100 + i, 105 + i, 95 + i, 100 + i * (i % 7 === 0 ? 2 : 1)))
  const whole = sma(candles.map((c) => c.close), 10)
  const truncated = sma(candles.slice(0, 40).map((c) => c.close), 10)
  for (let i = 0; i < 40; i++) {
    assert.equal(truncated[i], whole[i], `sma diverged at ${i} when later candles were removed`)
  }
})

test('nothing is traded before the indicators have warmed up', () => {
  const candles = Array.from({ length: 80 }, (_v, i) => bar(i, 100, 110, 90, 100 + (i % 2 ? 5 : -5)))
  const withSma = strategy({
    entry: {
      match: 'all',
      rules: [
        {
          left: { kind: 'price', field: 'close' },
          comparator: 'above',
          right: { kind: 'indicator', indicator: 'sma', options: { period: 50 } }
        }
      ]
    }
  })
  const result = backtest(withSma, candles, { startingCash: 10_000, costs: free })
  // Fifty bars of warm-up, plus one so a crossing has something to have crossed from.
  assert.ok(result.warmupBars >= 50, `warmed up at ${result.warmupBars}`)
  assert.ok(result.trades.every((t) => t.entryIndex > 50), 'a trade opened before the SMA existed')
})

test('a strategy with too little history is reported as never evaluated, not as one that never triggered', () => {
  const short = strategy({
    entry: {
      match: 'all',
      rules: [
        {
          left: { kind: 'price', field: 'close' },
          comparator: 'above',
          right: { kind: 'indicator', indicator: 'sma', options: { period: 200 } }
        }
      ]
    }
  })
  const result = backtest(short, flat(50, 100), { startingCash: 10_000 })
  assert.deepEqual(result.trades, [])
  assert.ok(
    result.warnings.some((w) => w.includes('not enough history')),
    `warnings were ${JSON.stringify(result.warnings)}`
  )
})

// ---------------------------------------------------------------- the ambiguous bar

test('a bar holding both the stop and the target is resolved as the stop, and counted', () => {
  // Enter at 100 on bar 6's open. Stop at 95, target at 110. Bar 7 ranges from 90 to 120 — it contains both, and the
  // candle does not say which came first. Assuming the target would be choosing the flattering answer on no evidence.
  const candles = [
    ...flat(5, 90),
    bar(5, 90, 120, 90, 120),
    bar(6, 100, 100, 100, 100),
    bar(7, 100, 120, 90, 100),
    bar(8, 100, 100, 100, 100)
  ]
  const s = strategy({ stopLossPercent: 5, takeProfitPercent: 10, exit: { match: 'all', rules: [] } })
  const result = backtest(s, candles, { startingCash: 10_000, costs: free })
  assert.equal(result.trades.length, 1)
  assert.equal(result.trades[0].exitReason, 'stop')
  assert.equal(result.trades[0].ambiguousBar, true)
  assert.equal(result.trades[0].exitPrice, 95)
  assert.equal(result.ambiguousExits, 1)
  assert.ok(
    result.warnings.some((w) => w.includes('which came first')),
    `warnings were ${JSON.stringify(result.warnings)}`
  )
})

test('a bar that only reaches the target takes the target, and is not counted as ambiguous', () => {
  const candles = [
    ...flat(5, 90),
    bar(5, 90, 120, 90, 120),
    bar(6, 100, 100, 100, 100),
    bar(7, 100, 115, 99, 110),
    bar(8, 100, 100, 100, 100)
  ]
  const s = strategy({ stopLossPercent: 5, takeProfitPercent: 10, exit: { match: 'all', rules: [] } })
  const result = backtest(s, candles, { startingCash: 10_000, costs: free })
  assert.equal(result.trades[0].exitReason, 'target')
  assert.equal(result.trades[0].ambiguousBar, false)
  assert.equal(result.ambiguousExits, 0)
})

test('a stop alone is a stop', () => {
  const candles = [
    ...flat(5, 90),
    bar(5, 90, 120, 90, 120),
    bar(6, 100, 100, 100, 100),
    bar(7, 100, 101, 90, 92),
    bar(8, 100, 100, 100, 100)
  ]
  const s = strategy({ stopLossPercent: 5, takeProfitPercent: 10, exit: { match: 'all', rules: [] } })
  const result = backtest(s, candles, { startingCash: 10_000, costs: free })
  assert.equal(result.trades[0].exitReason, 'stop')
  assert.equal(result.trades[0].exitPrice, 95)
})

// ---------------------------------------------------------------- determinism

test('the same strategy over the same candles gives the same result twice', () => {
  const candles = Array.from({ length: 200 }, (_v, i) =>
    bar(i, 100 + (i % 11), 105 + (i % 13), 95 - (i % 7), 100 + (i % 17) - 8)
  )
  const s = strategy({ stopLossPercent: 3, takeProfitPercent: 5 })
  const a = backtest(s, candles, { startingCash: 10_000 })
  const b = backtest(s, candles, { startingCash: 10_000 })
  assert.deepEqual(a.trades, b.trades)
  assert.deepEqual(a.stats.totalReturnPercent, b.stats.totalReturnPercent)
  assert.deepEqual(a.equity.map((e) => e.equity), b.equity.map((e) => e.equity))
})

// ---------------------------------------------------------------- costs

test('fees and slippage come out of the result', () => {
  const candles = [...flat(5, 90), bar(5, 90, 120, 90, 120), bar(6, 100, 100, 100, 100), bar(7, 100, 100, 100, 80), bar(8, 80, 80, 80, 80)]
  const s = strategy()
  const withoutCosts = backtest(s, candles, { startingCash: 10_000, costs: free })
  const withCosts = backtest(s, candles, { startingCash: 10_000, costs: DEFAULT_COSTS })
  assert.equal(withCosts.trades.length, 1)
  assert.ok(withCosts.trades[0].fees > 0, 'no fee was charged')
  // A strategy that only works with perfect fills does not work, and costing nothing hides that.
  assert.ok(withCosts.trades[0].net < withoutCosts.trades[0].net, 'costs did not reduce the result')
})

test('an entry never spends more than the cash on hand', () => {
  // This does not simulate borrowing. An order that overdrew would make every figure after it meaningless.
  const candles = [...flat(5, 90), bar(5, 90, 120, 90, 120), ...Array.from({ length: 5 }, (_v, i) => bar(6 + i, 100, 100, 100, 100))]
  const s = strategy({ sizing: { kind: 'fixed-quantity', value: 1_000_000 } })
  const result = backtest(s, candles, { startingCash: 1_000, costs: DEFAULT_COSTS })
  for (const point of result.equity) assert.ok(point.equity >= 0, `equity went negative: ${point.equity}`)
  if (result.trades.length > 0) {
    assert.ok(result.trades[0].entryPrice * result.trades[0].quantity <= 1_001, 'it spent more than it had')
  }
})

// ---------------------------------------------------------------- what it reports

test('an open position at the end is closed and labelled as such', () => {
  const candles = [...flat(5, 90), bar(5, 90, 120, 90, 120), ...Array.from({ length: 4 }, (_v, i) => bar(6 + i, 110, 115, 105, 110))]
  const result = backtest(strategy(), candles, { startingCash: 10_000, costs: free })
  assert.equal(result.trades.length, 1)
  // Not a decision the strategy made: the data simply ran out.
  assert.equal(result.trades[0].exitReason, 'end-of-data')
})

test('a benchmark of buying and holding is measured over the same period and money', () => {
  const candles = [...flat(5, 100), ...Array.from({ length: 20 }, (_v, i) => bar(5 + i, 100 + i * 5, 110 + i * 5, 95 + i * 5, 100 + i * 5))]
  const result = backtest(strategy({ entry: { match: 'all', rules: [] } }), candles, { startingCash: 10_000, costs: free })
  assert.ok(result.stats.benchmarkReturnPercent !== null)
  // Nothing traded, so the strategy went nowhere while the market went up. Saying so is the point of a benchmark.
  assert.equal(result.stats.totalReturnPercent, 0)
  assert.ok((result.stats.benchmarkReturnPercent as number) > 0)
})

test('no trades is said plainly rather than shown as a flat line', () => {
  const result = backtest(strategy({ entry: { match: 'all', rules: [{ left: { kind: 'price' }, comparator: 'above', right: { kind: 'value', value: 1e9 } }] } }), flat(60, 100), {
    startingCash: 10_000
  })
  assert.deepEqual(result.trades, [])
  assert.ok(result.warnings.some((w) => w.includes('never satisfied')))
})

test('a handful of trades carries a warning about what can be concluded from them', () => {
  const candles = [...flat(5, 90), bar(5, 90, 120, 90, 120), bar(6, 100, 100, 100, 100), bar(7, 100, 100, 100, 80), bar(8, 80, 80, 80, 80)]
  const result = backtest(strategy(), candles, { startingCash: 10_000 })
  assert.ok(result.warnings.some((w) => w.includes('tell you very little')))
})

test('the assumptions travel with the result', () => {
  const result = backtest(strategy(), flat(60, 100), { startingCash: 10_000 })
  assert.ok(result.assumptions.length >= 6)
  assert.ok(result.assumptions.some((a) => a.includes('next bar')))
  assert.ok(result.assumptions.some((a) => a.includes('stop first')))
})

test('a strategy that never fell has no Calmar rather than an infinite one', () => {
  const result = backtest(strategy({ entry: { match: 'all', rules: [] } }), flat(400, 100), { startingCash: 10_000 })
  assert.equal(result.stats.calmar, null)
  assert.equal(result.stats.maxDrawdownPercent, 0)
})

test('exposure is the share of bars a position was open', () => {
  const result = backtest(strategy({ entry: { match: 'all', rules: [] } }), flat(60, 100), { startingCash: 10_000 })
  assert.equal(result.stats.exposurePercent, 0)
})

// ---------------------------------------------------------------- out of sample

test('a held-back stretch is measured separately', () => {
  const candles = Array.from({ length: 300 }, (_v, i) => bar(i, 100 + (i % 9), 108 + (i % 9), 94 + (i % 9), 100 + (i % 9) - 4))
  const s = strategy({ stopLossPercent: 4, takeProfitPercent: 6 })
  const result = backtest(s, candles, { startingCash: 10_000, outOfSamplePercent: 30 })
  assert.ok(result.outOfSample !== null)
  assert.ok((result.outOfSample?.bars ?? 0) > 10)
  // The tail is a fraction of the whole, not the whole again under another name.
  assert.ok((result.outOfSample?.bars ?? 0) < result.bars)
  assert.ok((result.outOfSample?.from ?? 0) > result.from)
})

test('no split asked for means no split reported', () => {
  const result = backtest(strategy(), flat(100, 100), { startingCash: 10_000 })
  assert.equal(result.outOfSample, null)
})

// ---------------------------------------------------------------- the data itself

test('impossible and out-of-order candles are reported rather than silently used', () => {
  const problems = validateCandles([
    bar(0, 100, 100, 100, 100),
    // A high below the close cannot have happened.
    bar(1, 100, 90, 80, 95),
    bar(2, 100, 110, 90, 100),
    { ...bar(1, 100, 110, 90, 100) }
  ])
  assert.ok(problems.some((p) => p.includes('could not have happened')))
  assert.ok(problems.some((p) => p.includes('out of order')))
})

test('clean candles report nothing', () => {
  assert.deepEqual(validateCandles(flat(20, 100)), [])
})

test('too few candles is said rather than producing an empty result that looks like a finding', () => {
  const result = backtest(strategy(), flat(2, 100), { startingCash: 10_000 })
  assert.ok(result.warnings.some((w) => w.includes('not enough candles')))
})

// ---------------------------------------------------------------- sweeps

test('a sweep runs each value and always warns about what its best value means', () => {
  const candles = Array.from({ length: 200 }, (_v, i) => bar(i, 100 + (i % 11), 106 + (i % 11), 94 + (i % 11), 100 + (i % 11) - 5))
  const out = sweep(
    strategy({ stopLossPercent: 3 }),
    candles,
    (s, value) => ({ ...s, stopLossPercent: value }),
    [2, 3, 4, 5]
  )
  assert.equal(out.points.length, 4)
  assert.deepEqual(out.points.map((p) => p.value), [2, 3, 4, 5])
  // The most persuasive and least reliable number in the feature, so it is never returned without this.
  assert.ok(out.warning.includes('best fits what already happened'))
})

// ---------------------------------------------------------------- reading one back

test('a strategy read from a file keeps what is valid and drops what is not', () => {
  const cleaned = cleanStrategy({
    id: 's1',
    instrumentId: 'binance:crypto:binance:btcusdt',
    name: '  My   strategy  ',
    entry: { match: 'all', rules: [{ left: { kind: 'indicator', indicator: 'rsi', options: { period: 14 } }, comparator: 'crosses-below', right: { kind: 'value', value: 30 } }, 'rubbish'] },
    exit: { match: 'any', rules: [] },
    sizing: { kind: 'nonsense', value: -5 },
    stopLossPercent: 400,
    cooldownBars: -3
  })
  assert.ok(cleaned)
  assert.equal(cleaned.name, 'My strategy')
  assert.equal(cleaned.entry.rules.length, 1)
  assert.equal(cleaned.sizing.kind, 'percent-equity')
  assert.equal(cleaned.sizing.value, 25)
  // A stop of 400% is not a stop.
  assert.equal(cleaned.stopLossPercent, undefined)
  assert.equal(cleaned.cooldownBars, 0)
})

test('a strategy with nothing to run on is not a strategy', () => {
  assert.equal(cleanStrategy({ name: 'No instrument' }), null)
  assert.equal(cleanStrategy(null), null)
})

test('a warm-up index needs every series the strategy uses', () => {
  const candles = flat(60, 100)
  const s = strategy({
    entry: {
      match: 'all',
      rules: [
        { left: { kind: 'price' }, comparator: 'above', right: { kind: 'indicator', indicator: 'sma', options: { period: 10 } } },
        { left: { kind: 'price' }, comparator: 'above', right: { kind: 'indicator', indicator: 'sma', options: { period: 40 } } }
      ]
    }
  })
  const series = seriesFor(s, candles)
  // The slower one decides: trading when only the fast average exists is trading on half the rules.
  assert.ok((warmupIndex(series, candles.length) ?? 0) >= 39)
})
