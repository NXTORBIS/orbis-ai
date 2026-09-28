import type { BacktestStats } from './backtest.ts'

/**
 * Telling a strategy that worked from a strategy that was fitted.
 *
 * A backtest answers "what would these rules have done". That is a fact, and it is also the easiest thing in finance to
 * make look good: try enough parameter combinations on one stretch of history and something will fit it beautifully and
 * mean nothing. Everything in this file exists to make that visible rather than to hide it.
 *
 * Two things follow.
 *
 * **Walk-forward never optimises on data it then reports.** Each window trains on one stretch and is judged on the next,
 * and the judged stretches are the result. A figure from the training half would be the fitting, reported as the finding.
 *
 * **Monte Carlo here is a reordering, not a forecast.** It shuffles the trades that actually happened to show how much of
 * the equity curve's shape was the order they arrived in. It does not generate returns, does not model the market, and
 * says nothing about the future — every function below is named and documented so that cannot be mistaken.
 */

/** One train-then-test window. */
export interface WalkWindow {
  index: number
  /** The stretch the parameters were chosen on. Its result is deliberately not the headline. */
  trainFrom: number
  trainTo: number
  /** The stretch they were judged on. This is what counts. */
  testFrom: number
  testTo: number
}

/**
 * The windows for a walk-forward run.
 *
 * `windows` is how many test stretches there are; `trainRatio` is how much of each cycle is training. Anchored windows
 * keep the same start and grow; rolling ones move both ends. Empty when the history cannot support the shape asked for —
 * rather than windows so short that every one of them is noise.
 */
export function walkWindows(
  from: number,
  to: number,
  options: { windows?: number; trainRatio?: number; anchored?: boolean; minimumMs?: number } = {}
): WalkWindow[] {
  const windows = Math.max(1, Math.min(20, Math.round(options.windows ?? 4)))
  const trainRatio = Math.min(0.9, Math.max(0.1, options.trainRatio ?? 0.7))
  const minimum = options.minimumMs ?? 0
  const span = to - from
  if (!(span > 0)) return []

  // Each cycle is one train plus one test. The tests tile the back of the range; the first train is what comes before.
  const testSpan = span / (windows / (1 - trainRatio))
  const trainSpan = (testSpan / (1 - trainRatio)) * trainRatio
  if (!(testSpan > 0) || !(trainSpan > 0)) return []
  if (testSpan < minimum || trainSpan < minimum) return []

  const out: WalkWindow[] = []
  for (let i = 0; i < windows; i++) {
    const testFrom = to - testSpan * (windows - i)
    const testTo = testFrom + testSpan
    const trainTo = testFrom
    const trainFrom = options.anchored ? from : Math.max(from, trainTo - trainSpan)
    // A window whose training stretch does not exist is not a window. Dropped rather than trained on nothing.
    if (trainFrom >= trainTo) continue
    out.push({ index: i, trainFrom, trainTo, testFrom, testTo })
  }
  return out
}

/** What one window produced, in and out of sample. */
export interface WalkResult {
  window: WalkWindow
  /** The parameters chosen on the training stretch, as field-and-value pairs. */
  chosen: Record<string, number>
  /** How those parameters did on the training stretch. Shown, but never the headline. */
  train: BacktestStats | null
  /** How they did on the stretch they had never seen. This is the result. */
  test: BacktestStats | null
}

export interface WalkSummary {
  windows: WalkResult[]
  /** How many windows were judged out of sample at all. */
  tested: number
  /** How many of those made money. Null with nothing to count. */
  profitable: number | null
  /** The out-of-sample returns, averaged. Null when no window could be judged. */
  averageTestReturn: number | null
  averageTrainReturn: number | null
  /**
   * Out-of-sample return over in-sample return.
   *
   * Under 1 means the rules did worse on data they had not seen, which is what fitting looks like. Null when either side
   * is missing or the training side was not positive — dividing by a loss produces a number that reads backwards.
   */
  efficiency: number | null
  /** Said plainly when the numbers warrant it. Empty when they do not. */
  warnings: string[]
}

const mean = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((total, one) => total + one, 0) / values.length

/**
 * What a walk-forward run amounts to.
 *
 * The headline is the out-of-sample average, and the warnings are part of the answer rather than a footnote: a run whose
 * test results are far worse than its training results has found a fit, and saying so is the only useful thing the
 * summary can do.
 */
export function summariseWalk(windows: WalkResult[]): WalkSummary {
  const tests = windows.map((one) => one.test?.totalReturnPercent).filter((one): one is number => typeof one === 'number')
  const trains = windows
    .map((one) => one.train?.totalReturnPercent)
    .filter((one): one is number => typeof one === 'number')

  const averageTestReturn = mean(tests)
  const averageTrainReturn = mean(trains)
  const efficiency =
    averageTestReturn !== null && averageTrainReturn !== null && averageTrainReturn > 0
      ? averageTestReturn / averageTrainReturn
      : null

  const warnings: string[] = []
  if (tests.length === 0) {
    warnings.push('No window could be judged out of sample, so this run says nothing about unseen data.')
  }
  if (efficiency !== null && efficiency < 0.5) {
    warnings.push(
      'The rules did much worse on data they had not seen than on the data they were chosen from, which is what overfitting looks like.'
    )
  }
  if (tests.length > 0 && tests.every((one) => one <= 0)) {
    warnings.push('Every out-of-sample window lost money.')
  }
  if (windows.length > 0 && tests.length < windows.length) {
    warnings.push(`${windows.length - tests.length} window(s) had too little data to judge and are not in the average.`)
  }

  return {
    windows,
    tested: tests.length,
    profitable: tests.length > 0 ? tests.filter((one) => one > 0).length : null,
    averageTestReturn,
    averageTrainReturn,
    efficiency,
    warnings
  }
}

// ---------------------------------------------------------------- reordering what happened

/**
 * A small, seeded, reproducible generator.
 *
 * Seeded on purpose: a Monte Carlo result nobody can reproduce is a result nobody can check, and `Math.random` would make
 * every run of the same analysis disagree with the last one.
 */
export function shuffler(seed: number): () => number {
  let state = (Math.floor(seed) || 1) >>> 0
  return () => {
    // xorshift32. Small, fast, and entirely deterministic from the seed.
    state ^= state << 13
    state >>>= 0
    state ^= state >> 17
    state ^= state << 5
    state >>>= 0
    return state / 0x1_0000_0000
  }
}

export interface MonteCarloResult {
  /** How many reorderings were run. */
  runs: number
  /** The final returns, sorted, so a distribution can be read off them. */
  returns: number[]
  /** The worst drawdown seen in each reordering, sorted. */
  drawdowns: number[]
  median: number | null
  /** The fifth and ninety-fifth of the reorderings. Null with too few to be worth quoting. */
  fifth: number | null
  ninetyFifth: number | null
  /** The worst drawdown across every reordering. */
  worstDrawdown: number | null
  /** What share of reorderings ended in profit. */
  profitableShare: number | null
  /** Said with every result, because this is the part that is easy to misread. */
  note: string
}

/**
 * The same trades, in different orders.
 *
 * This answers one question: how much of the equity curve's shape came from the order the trades happened to arrive in.
 * A strategy whose result collapses when its trades are reordered had a result that depended on a sequence, not on the
 * rules.
 *
 * It is **not** a simulation of the future and not a forecast. It generates no returns; every number in every reordering
 * is a trade that actually happened in the backtest. The note travels with the result so it cannot be quoted without it.
 */
export function monteCarlo(
  tradeReturns: readonly number[],
  options: { runs?: number; seed?: number } = {}
): MonteCarloResult {
  const usable = tradeReturns.filter((one) => typeof one === 'number' && Number.isFinite(one))
  const runs = Math.max(1, Math.min(5000, Math.round(options.runs ?? 500)))
  const note =
    'Each run is the same trades in a different order. Nothing here is generated, and none of it is a forecast.'

  if (usable.length < 2) {
    return {
      runs: 0,
      returns: [],
      drawdowns: [],
      median: null,
      fifth: null,
      ninetyFifth: null,
      worstDrawdown: null,
      profitableShare: null,
      // Two trades cannot be meaningfully reordered, and saying so beats a distribution of one point.
      note: 'Too few trades to reorder. At least two completed trades are needed.'
    }
  }

  const random = shuffler(options.seed ?? 1)
  const returns: number[] = []
  const drawdowns: number[] = []

  for (let run = 0; run < runs; run++) {
    const order = [...usable]
    // Fisher–Yates, from the seeded generator.
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      ;[order[i], order[j]] = [order[j], order[i]]
    }
    // Compounded, because that is how a sequence of trade returns actually accumulates.
    let equity = 1
    let peak = 1
    let worst = 0
    for (const one of order) {
      equity *= 1 + one / 100
      if (equity > peak) peak = equity
      if (peak > 0) worst = Math.max(worst, ((peak - equity) / peak) * 100)
    }
    returns.push((equity - 1) * 100)
    drawdowns.push(worst)
  }

  returns.sort((a, b) => a - b)
  drawdowns.sort((a, b) => a - b)
  const at = (share: number): number | null =>
    returns.length >= 20 ? returns[Math.min(returns.length - 1, Math.floor(share * returns.length))] : null

  return {
    runs,
    returns,
    drawdowns,
    median: returns[Math.floor(returns.length / 2)] ?? null,
    fifth: at(0.05),
    ninetyFifth: at(0.95),
    worstDrawdown: drawdowns[drawdowns.length - 1] ?? null,
    profitableShare: returns.filter((one) => one > 0).length / returns.length,
    note
  }
}

/** What these analyses assume, in words, so no figure from them is read without them. */
export const VALIDATION_ASSUMPTIONS: string[] = [
  'Walk-forward reports only the stretches the parameters had not seen.',
  'Monte Carlo reorders the trades that happened. It generates nothing and forecasts nothing.',
  'A good historical result is not evidence of a good future one.',
  'Testing many parameter combinations on one stretch of history will find one that fits it.'
]
