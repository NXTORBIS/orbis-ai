import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  advanceReplay,
  barsForTick,
  createReplay,
  hasMore,
  replayView,
  seekReplay,
  SPEEDS
} from './replay.ts'
import { backtest } from './backtest.ts'
import type { Strategy } from './strategy.ts'
import type { Candle } from './indicators.ts'

/**
 * Watching a strategy meet a market one bar at a time.
 *
 * Two things every test here is about. **The viewer must not see the future** — the whole exercise is pointless if the
 * chart draws bars the replay has not reached. And **a replay must agree with a backtest**, because they are supposed to
 * be the same engine at different speeds; if they ever disagreed, one of them would be wrong and there would be no way
 * to tell which.
 */

const HOUR = 3_600_000

const bar = (i: number, open: number, high: number, low: number, close: number): Candle => ({
  time: i * HOUR,
  open,
  high,
  low,
  close,
  volume: 10
})

/** A market that rises and falls enough to trigger a price-threshold strategy several times. */
const wavy = (n = 200): Candle[] =>
  Array.from({ length: n }, (_v, i) => {
    const base = 100 + Math.sin(i / 6) * 12
    return bar(i, base, base + 3, base - 3, base + (i % 3 === 0 ? 1.5 : -1))
  })

const strategy = (over: Partial<Strategy> = {}): Strategy => ({
  id: 's1',
  name: 'Test',
  version: 1,
  instrumentId: 'binance:crypto:binance:btcusdt',
  interval: '1h',
  direction: 'long',
  entry: { match: 'all', rules: [{ left: { kind: 'price', field: 'close' }, comparator: 'crosses-above', right: { kind: 'value', value: 105 } }] },
  exit: { match: 'all', rules: [{ left: { kind: 'price', field: 'close' }, comparator: 'crosses-below', right: { kind: 'value', value: 98 } }] },
  sizing: { kind: 'percent-equity', value: 50 },
  cooldownBars: 0,
  createdAt: 0,
  updatedAt: 0,
  ...over
})

const free = { slippage: 0, feeRate: 0 }

// ---------------------------------------------------------------- the future is not shown

test('the visible candles end at the cursor', () => {
  // Handing a chart the whole array would draw the future and make the exercise pointless, while looking identical.
  const candles = wavy(120)
  const session = createReplay(strategy(), candles, { startingCash: 10_000, costs: free })
  advanceReplay(session, 20)
  const view = replayView(session)
  assert.equal(view.visibleCandles.length, view.cursor + 1)
  assert.equal(view.visibleCandles[view.visibleCandles.length - 1].time, candles[view.cursor].time)
  assert.ok(view.visibleCandles.length < candles.length, 'everything was visible')
})

test('before the first step, the warm-up history is visible and nothing after it', () => {
  // The bars before `from` are not future: they are the history an indicator needed, and a chart that opened on a single
  // candle with no context would be useless. What must not be visible is anything past the cursor.
  const session = createReplay(strategy(), wavy(60), { startingCash: 10_000, costs: free })
  const view = replayView(session)
  assert.equal(view.visibleCandles.length, session.from)
  assert.equal(view.progress, 0)
  assert.equal(view.trades.length, 0)
  assert.equal(view.position, null)
})

test('a strategy needing a long warm-up opens with that much history and no more', () => {
  const candles = wavy(200)
  const withSma = strategy({
    entry: {
      match: 'all',
      rules: [
        { left: { kind: 'price', field: 'close' }, comparator: 'crosses-above', right: { kind: 'indicator', indicator: 'sma', options: { period: 50 } } }
      ]
    }
  })
  const session = createReplay(withSma, candles, { startingCash: 10_000, costs: free })
  const view = replayView(session)
  assert.ok(view.visibleCandles.length >= 50, `only ${view.visibleCandles.length} bars of context`)
  assert.ok(view.visibleCandles.length < candles.length, 'the whole history was visible')
})

test('an entry at a bar that has not been reached is reported as pending', () => {
  // A signal on the bar at the cursor fills at the next bar's open. Saying the position is already open would be showing
  // a fill at a price that has not been revealed.
  const candles = [
    ...Array.from({ length: 6 }, (_v, i) => bar(i, 100, 101, 99, 100)),
    bar(6, 100, 110, 100, 108),
    bar(7, 108, 112, 107, 110),
    bar(8, 110, 111, 109, 110),
    bar(9, 110, 111, 109, 110)
  ]
  const session = createReplay(strategy(), candles, { startingCash: 10_000, costs: free })
  // Step until something is held.
  while (hasMore(session) && !session.run.position) advanceReplay(session, 1)
  const view = replayView(session)
  assert.ok(view.position, 'nothing was entered')
  assert.equal(view.position?.pending, true)
  assert.ok((view.position?.entryIndex ?? 0) > view.cursor, 'the entry was not ahead of the cursor')
  // And it is not counted in what the account is worth yet.
  assert.equal(view.total, view.cash)
})

test('once the cursor reaches the entry, the position stops being pending', () => {
  const candles = [
    ...Array.from({ length: 6 }, (_v, i) => bar(i, 100, 101, 99, 100)),
    bar(6, 100, 110, 100, 108),
    bar(7, 108, 112, 107, 110),
    bar(8, 110, 111, 109, 110),
    bar(9, 110, 111, 109, 110)
  ]
  const session = createReplay(strategy(), candles, { startingCash: 10_000, costs: free })
  while (hasMore(session) && !session.run.position) advanceReplay(session, 1)
  advanceReplay(session, 1)
  const view = replayView(session)
  assert.equal(view.position?.pending, false)
  assert.ok(view.total !== view.cash, 'the holding was not counted once it was really held')
})

// ---------------------------------------------------------------- it agrees with a backtest

test('a replay run to the end matches the backtest of the same strategy exactly', () => {
  // They are supposed to be the same engine at different speeds. If they ever disagreed, one would be wrong and there
  // would be no way to tell which.
  const candles = wavy(300)
  const s = strategy({ stopLossPercent: 4, takeProfitPercent: 6 })
  const whole = backtest(s, candles, { startingCash: 10_000 })

  const session = createReplay(s, candles, { startingCash: 10_000 })
  while (hasMore(session)) advanceReplay(session, 1)
  const view = replayView(session)

  assert.equal(view.trades.length, whole.trades.length)
  assert.deepEqual(
    view.trades.map((t) => [t.entryIndex, t.exitIndex, t.exitReason]),
    whole.trades.map((t) => [t.entryIndex, t.exitIndex, t.exitReason])
  )
  assert.deepEqual(view.equity.map((e) => e.equity), whole.equity.map((e) => e.equity))
  assert.equal(view.stats.totalReturnPercent, whole.stats.totalReturnPercent)
})

test('advancing in one leap matches advancing bar by bar', () => {
  const candles = wavy(200)
  const s = strategy({ stopLossPercent: 5 })
  const stepped = createReplay(s, candles, { startingCash: 10_000 })
  for (let i = 0; i < 80; i++) advanceReplay(stepped, 1)
  const leapt = createReplay(s, candles, { startingCash: 10_000 })
  advanceReplay(leapt, 80)
  assert.equal(stepped.run.cursor, leapt.run.cursor)
  assert.equal(stepped.run.cash, leapt.run.cash)
  assert.deepEqual(stepped.run.trades, leapt.run.trades)
})

// ---------------------------------------------------------------- seeking

test('seeking back rebuilds the same state that stepping forward reached', () => {
  // Rebuilding is sound only because the engine is deterministic. This is that claim, checked.
  const candles = wavy(200)
  const s = strategy({ stopLossPercent: 4 })
  const session = createReplay(s, candles, { startingCash: 10_000 })
  advanceReplay(session, 60)
  const at60 = JSON.stringify({ cash: session.run.cash, trades: session.run.trades, cursor: session.run.cursor })

  advanceReplay(session, 60)
  const back = seekReplay(session, 60 + session.from - 1)
  assert.equal(
    JSON.stringify({ cash: back.run.cash, trades: back.run.trades, cursor: back.run.cursor }),
    at60
  )
})

test('seeking forward is the same as advancing', () => {
  const candles = wavy(150)
  const s = strategy()
  const sought = seekReplay(createReplay(s, candles, { startingCash: 10_000 }), 90)
  const advanced = createReplay(s, candles, { startingCash: 10_000 })
  advanceReplay(advanced, 90 - advanced.run.cursor)
  assert.equal(sought.run.cursor, advanced.run.cursor)
  assert.equal(sought.run.cash, advanced.run.cash)
})

test('seeking is clamped to the bars that exist', () => {
  const candles = wavy(80)
  const session = createReplay(strategy(), candles, { startingCash: 10_000 })
  const far = seekReplay(session, 99_999)
  assert.equal(far.run.cursor, candles.length - 1)
  const back = seekReplay(far, -50)
  assert.ok(back.run.cursor < back.from, 'seeking before the start did not rewind')
  assert.deepEqual(replayView(back).visibleCandles.length, Math.max(0, back.run.cursor + 1))
})

// ---------------------------------------------------------------- reaching the end

test('reaching the end closes what was open, exactly as a backtest does', () => {
  const candles = [
    ...Array.from({ length: 6 }, (_v, i) => bar(i, 100, 101, 99, 100)),
    bar(6, 100, 110, 100, 108),
    ...Array.from({ length: 6 }, (_v, i) => bar(7 + i, 110, 112, 108, 110))
  ]
  const session = createReplay(strategy(), candles, { startingCash: 10_000, costs: free })
  while (hasMore(session)) advanceReplay(session, 1)
  const view = replayView(session)
  assert.equal(view.finished, true)
  assert.equal(view.position, null)
  assert.equal(view.trades[view.trades.length - 1]?.exitReason, 'end-of-data')
})

test('advancing past the end is harmless', () => {
  const session = createReplay(strategy(), wavy(50), { startingCash: 10_000 })
  advanceReplay(session, 10_000)
  const cursor = session.run.cursor
  advanceReplay(session, 10_000)
  assert.equal(session.run.cursor, cursor)
  assert.equal(hasMore(session), false)
})

test('a strategy that could never be evaluated says so and shows nothing', () => {
  const short = strategy({
    entry: {
      match: 'all',
      rules: [{ left: { kind: 'price' }, comparator: 'above', right: { kind: 'indicator', indicator: 'sma', options: { period: 200 } } }]
    }
  })
  const session = createReplay(short, wavy(40), { startingCash: 10_000 })
  assert.equal(hasMore(session), false)
  const view = replayView(session)
  assert.deepEqual(view.visibleCandles, [])
  assert.ok(view.warnings.some((w) => w.includes('not enough history')))
})

// ---------------------------------------------------------------- the clock

test('speed and elapsed time become whole bars, carrying the remainder', () => {
  // Half speed really is half: rounding up every tick would run it at the same rate as single speed.
  let carry = 0
  let total = 0
  for (let tick = 0; tick < 10; tick++) {
    const out = barsForTick(0.5, 1000, carry)
    total += out.bars
    carry = out.carry
  }
  assert.equal(total, 5)
})

test('a fast speed advances many bars a second', () => {
  const out = barsForTick(25, 1000, 0)
  assert.equal(out.bars, 25)
})

test('a tick too short to advance a bar advances none, and remembers', () => {
  const first = barsForTick(1, 100, 0)
  assert.equal(first.bars, 0)
  assert.ok(first.carry > 0)
  // Ten of those hundred-millisecond ticks make one bar at single speed.
  let carry = first.carry
  let bars = 0
  for (let i = 0; i < 9; i++) {
    const out = barsForTick(1, 100, carry)
    bars += out.bars
    carry = out.carry
  }
  assert.equal(bars, 1)
})

test('the speeds on offer are all usable', () => {
  for (const speed of SPEEDS) {
    assert.ok(speed > 0, `${speed} is not a speed`)
    assert.ok(barsForTick(speed, 1000, 0).bars >= 0)
  }
})

// ---------------------------------------------------------------- the view

test('progress runs from nothing to everything', () => {
  const session = createReplay(strategy(), wavy(120), { startingCash: 10_000 })
  assert.equal(replayView(session).progress, 0)
  while (hasMore(session)) advanceReplay(session, 1)
  assert.ok(Math.abs(replayView(session).progress - 100) < 1e-9)
})

test('the equity shown covers only what has been watched', () => {
  const session = createReplay(strategy(), wavy(200), { startingCash: 10_000 })
  advanceReplay(session, 30)
  const view = replayView(session)
  assert.equal(view.equity.length, 30)
  assert.ok(view.equity[view.equity.length - 1].at <= view.at)
})
