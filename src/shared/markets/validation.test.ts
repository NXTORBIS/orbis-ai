import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  monteCarlo,
  shuffler,
  summariseWalk,
  VALIDATION_ASSUMPTIONS,
  walkWindows,
  type WalkResult
} from './validation.ts'
import type { BacktestStats } from './backtest.ts'

const DAY = 24 * 3_600_000

const stats = (totalReturnPercent: number): BacktestStats =>
  ({ totalReturnPercent }) as unknown as BacktestStats

const result = (index: number, train: number | null, test: number | null): WalkResult => ({
  window: { index, trainFrom: 0, trainTo: 1, testFrom: 1, testTo: 2 },
  chosen: { period: 14 },
  train: train === null ? null : stats(train),
  test: test === null ? null : stats(test)
})

// ---------------------------------------------------------------- windows

test('windows tile the back of the range and each trains on what came before it', () => {
  const windows = walkWindows(0, 100 * DAY, { windows: 4, trainRatio: 0.7 })
  assert.equal(windows.length, 4)
  for (const one of windows) {
    assert.ok(one.trainTo === one.testFrom, 'training must end where testing starts')
    assert.ok(one.trainFrom < one.trainTo)
    assert.ok(one.testFrom < one.testTo)
  }
  // The last window ends at the end of the range.
  assert.equal(windows[windows.length - 1].testTo, 100 * DAY)
})

test('a window never tests on data it trained on', () => {
  // The whole point. If these overlapped, the out-of-sample figure would include the fitting.
  for (const one of walkWindows(0, 200 * DAY, { windows: 5 })) {
    assert.ok(one.testFrom >= one.trainTo, `window ${one.index} tests inside its own training data`)
  }
})

test('anchored windows keep the same start; rolling ones move it', () => {
  const anchored = walkWindows(0, 100 * DAY, { windows: 3, anchored: true })
  assert.ok(anchored.every((one) => one.trainFrom === 0))
  const rolling = walkWindows(0, 100 * DAY, { windows: 3, anchored: false })
  assert.ok(rolling[0].trainFrom < rolling[rolling.length - 1].trainFrom)
})

test('a range too short for the shape asked for produces no windows rather than meaningless ones', () => {
  assert.deepEqual(walkWindows(0, 0), [])
  assert.deepEqual(walkWindows(100, 0), [])
  assert.deepEqual(walkWindows(0, 10 * DAY, { windows: 4, minimumMs: 30 * DAY }), [])
})

test('the number of windows and the training share are clamped to something usable', () => {
  assert.equal(walkWindows(0, 1000 * DAY, { windows: 500 }).length, 20)
  assert.equal(walkWindows(0, 1000 * DAY, { windows: 0 }).length, 1)
  // A training share of everything would leave nothing to test on.
  assert.ok(walkWindows(0, 1000 * DAY, { windows: 2, trainRatio: 5 }).every((one) => one.testTo > one.testFrom))
})

// ---------------------------------------------------------------- the summary

test('the headline is the out-of-sample average, not the training one', () => {
  const summary = summariseWalk([result(0, 50, 5), result(1, 60, 3)])
  assert.equal(summary.averageTestReturn, 4)
  assert.equal(summary.averageTrainReturn, 55)
  assert.equal(summary.tested, 2)
  assert.equal(summary.profitable, 2)
})

test('rules that did far worse on unseen data are called out as what that looks like', () => {
  const summary = summariseWalk([result(0, 100, 5), result(1, 100, 5)])
  assert.ok(summary.efficiency !== null && summary.efficiency < 0.5)
  assert.ok(summary.warnings.some((one) => one.includes('overfitting')))
})

test('rules that held up out of sample are not warned about', () => {
  const summary = summariseWalk([result(0, 20, 18), result(1, 20, 22)])
  assert.ok(summary.efficiency !== null && summary.efficiency > 0.9)
  assert.ok(!summary.warnings.some((one) => one.includes('overfitting')))
})

test('a losing run says so outright', () => {
  const summary = summariseWalk([result(0, 30, -5), result(1, 30, -2)])
  assert.ok(summary.warnings.some((one) => one.includes('lost money')))
  assert.equal(summary.profitable, 0)
})

test('windows that could not be judged are excluded from the average and counted in the warnings', () => {
  const summary = summariseWalk([result(0, 10, 5), result(1, 10, null)])
  assert.equal(summary.tested, 1)
  assert.equal(summary.averageTestReturn, 5)
  assert.ok(summary.warnings.some((one) => one.includes('too little data')))
})

test('nothing judged out of sample is said to say nothing', () => {
  const summary = summariseWalk([result(0, 10, null)])
  assert.equal(summary.averageTestReturn, null)
  assert.equal(summary.profitable, null)
  assert.ok(summary.warnings.some((one) => one.includes('says nothing about unseen data')))
})

test('efficiency is not computed against a training loss, where it would read backwards', () => {
  const summary = summariseWalk([result(0, -10, -5)])
  assert.equal(summary.efficiency, null)
})

// ---------------------------------------------------------------- reordering

test('the same seed gives the same answer, so a result can be checked', () => {
  const trades = [5, -3, 8, -2, 4, -6, 1, 2, -1, 3]
  const first = monteCarlo(trades, { runs: 100, seed: 42 })
  const second = monteCarlo(trades, { runs: 100, seed: 42 })
  assert.deepEqual(first.returns, second.returns)
  // A different seed genuinely differs, so the shuffling is doing something.
  const other = monteCarlo(trades, { runs: 100, seed: 7 })
  assert.notDeepEqual(first.returns, other.returns)
})

test('reordering does not change what the trades add up to, only the path', () => {
  // Compounded, so every ordering of the same multipliers reaches the same end. That is the point: the *final* return is
  // invariant, and what varies is the drawdown along the way.
  const trades = [10, -5, 7, -3]
  const result_ = monteCarlo(trades, { runs: 200, seed: 1 })
  const spread = result_.returns[result_.returns.length - 1] - result_.returns[0]
  assert.ok(spread < 1e-9, `final returns should be invariant, spread was ${spread}`)
  // Drawdowns are not invariant, which is the thing worth looking at.
  assert.ok((result_.worstDrawdown ?? 0) > 0)
})

test('a run with too few trades says so rather than producing a distribution of nothing', () => {
  const thin = monteCarlo([5], { runs: 100 })
  assert.equal(thin.runs, 0)
  assert.equal(thin.median, null)
  assert.ok(thin.note.includes('Too few trades'))
  assert.deepEqual(monteCarlo([], { runs: 100 }).returns, [])
})

test('percentiles are not quoted from too few runs', () => {
  const few = monteCarlo([5, -3, 8], { runs: 5, seed: 1 })
  assert.equal(few.fifth, null)
  assert.equal(few.ninetyFifth, null)
  const many = monteCarlo([5, -3, 8], { runs: 200, seed: 1 })
  assert.ok(many.fifth !== null && many.ninetyFifth !== null)
})

test('malformed trade returns are left out rather than poisoning every run', () => {
  const result_ = monteCarlo([5, Number.NaN, -3, Number.POSITIVE_INFINITY, 4], { runs: 50, seed: 1 })
  assert.ok(result_.returns.every((one) => Number.isFinite(one)))
  assert.ok(result_.runs > 0)
})

test('every result carries the note saying what it is not', () => {
  const result_ = monteCarlo([5, -3, 8, 2], { runs: 50, seed: 1 })
  assert.ok(result_.note.includes('same trades in a different order'))
  assert.ok(result_.note.includes('forecast'))
})

test('the generator is deterministic and stays inside its range', () => {
  const random = shuffler(99)
  const values = Array.from({ length: 500 }, () => random())
  assert.ok(values.every((one) => one >= 0 && one < 1))
  const again = shuffler(99)
  assert.equal(again(), values[0])
})

test('the assumptions say outright that a good backtest is not evidence about the future', () => {
  const text = VALIDATION_ASSUMPTIONS.join(' ').toLowerCase()
  assert.ok(text.includes('not evidence of a good future one'))
  assert.ok(text.includes('forecasts nothing'))
})
