import type { Candle, Series } from './indicators.ts'
import { maxDrawdown, returnsOf, sharpe, sortino, standardDeviation, type Periodicity } from './risk.ts'
import { performanceOf, type Performance } from './portfolio.ts'
import {
  groupHolds,
  quantityFor,
  seriesFor,
  warmupIndex,
  type Strategy
} from './strategy.ts'

/**
 * Running a strategy over history.
 *
 * Two decisions in here matter more than everything else, because they are the two places a backtest usually lies.
 *
 * **1. A signal on a bar is acted on at the next bar's open.** The close of a bar is not knowable until the bar has
 * closed, so filling at that same close means trading on information that did not exist yet. It flatters every strategy
 * that reacts to a move, and it is invisible in the result. Everything here is decided on bar `i` and executed at the
 * open of bar `i + 1`; the last bar produces no entry, because there is no bar after it to fill in.
 *
 * **2. When a bar contains both the stop and the target, the stop is taken.** A daily candle whose low is below the stop
 * and whose high is above the target genuinely does not say which happened first — the information is not in the data.
 * Assuming the target would be choosing the flattering answer on no evidence. So the worse outcome is assumed, and the
 * result reports how many trades were decided that way, because a strategy where that number is large is one whose
 * result depends mostly on an assumption.
 *
 * Everything else follows from those: no randomness, no clock, no interpolation across gaps. The same strategy over the
 * same candles with the same costs produces the same result every time, which is what makes a stored run worth keeping.
 */

export interface BacktestCosts {
  /** A fraction of the price, against the trade, applied to market fills. */
  slippage: number
  /** A fraction of the value, charged each side. */
  feeRate: number
}

export const DEFAULT_COSTS: BacktestCosts = { slippage: 0.0005, feeRate: 0.001 }

export interface BacktestOptions {
  startingCash: number
  costs: BacktestCosts
  /** Where a fraction of the candles is held back for validation. 0 means none. */
  outOfSamplePercent?: number
  /** How often a bar arrives, for annualising the risk figures. */
  periodicity?: Periodicity
}

export const DEFAULT_OPTIONS: BacktestOptions = {
  startingCash: 10_000,
  costs: DEFAULT_COSTS,
  outOfSamplePercent: 0,
  periodicity: 'hourly'
}

/** Why a position was closed. Kept because it is the most interesting thing about a losing trade. */
export type ExitReason = 'rule' | 'stop' | 'target' | 'trailing-stop' | 'end-of-data'

export interface BacktestTrade {
  entryIndex: number
  exitIndex: number
  entryTime: number
  exitTime: number
  direction: 'long' | 'short'
  quantity: number
  entryPrice: number
  exitPrice: number
  fees: number
  /** After fees. */
  net: number
  returnPercent: number
  exitReason: ExitReason
  /**
   * Whether the bar that closed this trade contained both the stop and the target.
   *
   * True means the exit above is an assumption, not an observation: the candle does not say which came first, and the
   * worse one was taken.
   */
  ambiguousBar: boolean
  /** The values that satisfied the entry, so a trade can be explained rather than asserted. */
  entryEvidence: { rule: string; left: number | null; right: number | null }[]
}

export interface EquityBar {
  index: number
  at: number
  /** Cash plus the open position at this bar's close. */
  equity: number
  /** Buy and hold over the same period, from the same starting cash, for comparison. */
  benchmark: number
  inPosition: boolean
}

export interface BacktestStats {
  totalReturnPercent: number
  benchmarkReturnPercent: number | null
  maxDrawdownPercent: number
  sharpe: number | null
  sortino: number | null
  /** Annualised return over the absolute worst drawdown. Null when there was no drawdown to divide by. */
  calmar: number | null
  volatility: number | null
  /** The share of bars with a position open, 0–100. */
  exposurePercent: number
  performance: Performance
}

export interface BacktestResult {
  strategyId: string
  strategyVersion: number
  instrumentId: string
  interval: string
  /** The candles actually used, after warm-up and after any out-of-sample split. */
  bars: number
  from: number
  to: number
  warmupBars: number
  trades: BacktestTrade[]
  equity: EquityBar[]
  stats: BacktestStats
  /** The same figures over the held-back stretch, when one was asked for. */
  outOfSample: { from: number; to: number; bars: number; stats: BacktestStats; trades: number } | null
  /** How many trades were closed on a bar that contained both the stop and the target. */
  ambiguousExits: number
  costs: BacktestCosts
  startingCash: number
  /** What this run assumed, carried with the result so it is never read without them. */
  assumptions: string[]
  /** Anything that makes the result less trustworthy, said plainly. */
  warnings: string[]
}

export const ASSUMPTIONS: string[] = [
  'A signal on a bar is acted on at the next bar’s open, never at the close that produced it.',
  'A bar containing both the stop and the target is assumed to have hit the stop first.',
  'Stops and targets fill at their level, plus slippage against the trade.',
  'Fees are charged on both sides, on the value traded.',
  'Orders are not matched against order-book depth, so size never moves the market.',
  'Only one position is open at a time, and there is no borrowing, margin or interest.',
  'Gaps in the candles are left as gaps; nothing is interpolated across them.'
]

const CLOSE_ENOUGH = 1e-12

/** A run that produced nothing, so a caller has the same shape whatever happened. */
const emptyStats = (): BacktestStats => ({
  totalReturnPercent: 0,
  benchmarkReturnPercent: null,
  maxDrawdownPercent: 0,
  sharpe: null,
  sortino: null,
  calmar: null,
  volatility: null,
  exposurePercent: 0,
  performance: performanceOf([])
})

function statsFrom(
  equity: EquityBar[],
  trades: BacktestTrade[],
  startingCash: number,
  periodicity: Periodicity,
  coveredMs: number
): BacktestStats {
  const values = equity.map((one) => one.equity)
  const returns = returnsOf(values)
  const drawdown = maxDrawdown(values)
  const last = values[values.length - 1]
  const totalReturnPercent = startingCash > 0 && last !== undefined ? ((last - startingCash) / startingCash) * 100 : 0

  const firstBenchmark = equity[0]?.benchmark
  const lastBenchmark = equity[equity.length - 1]?.benchmark
  const benchmarkReturnPercent =
    typeof firstBenchmark === 'number' && typeof lastBenchmark === 'number' && firstBenchmark > 0
      ? ((lastBenchmark - firstBenchmark) / firstBenchmark) * 100
      : null

  // Annualised only when the run covers enough time to mean anything. A 47% return over three days annualises to a
  // number that describes nothing.
  const years = coveredMs / (365.25 * 24 * 3600_000)
  const annualised =
    years > 0.08 && startingCash > 0 && last !== undefined && last > 0
      ? (Math.pow(last / startingCash, 1 / years) - 1) * 100
      : null

  return {
    totalReturnPercent,
    benchmarkReturnPercent,
    maxDrawdownPercent: drawdown.maxPercent,
    sharpe: sharpe(returns, periodicity),
    sortino: sortino(returns, periodicity),
    // Dividing by a drawdown of zero is not a ratio. A strategy that never fell has no Calmar, it has no denominator.
    calmar: annualised !== null && drawdown.maxPercent > CLOSE_ENOUGH ? annualised / drawdown.maxPercent : null,
    volatility: standardDeviation(returns),
    exposurePercent: equity.length > 0 ? (equity.filter((one) => one.inPosition).length / equity.length) * 100 : 0,
    performance: performanceOf(
      trades.map((trade) => ({
        instrumentId: '',
        direction: trade.direction,
        openedAt: trade.entryTime,
        closedAt: trade.exitTime,
        quantity: trade.quantity,
        entryPrice: trade.entryPrice,
        exitPrice: trade.exitPrice,
        net: trade.net,
        fees: trade.fees,
        returnPercent: trade.returnPercent,
        holdingMs: Math.max(0, trade.exitTime - trade.entryTime)
      }))
    )
  }
}

/** Whether the candles are usable: in order, and without impossible bars. */
export function validateCandles(candles: Candle[]): string[] {
  const problems: string[] = []
  let outOfOrder = 0
  let impossible = 0
  let duplicated = 0
  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i]
    if (![candle.open, candle.high, candle.low, candle.close].every((n) => Number.isFinite(n) && n > 0)) {
      impossible++
      continue
    }
    if (candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close)) {
      impossible++
    }
    if (i > 0) {
      if (candle.time < candles[i - 1].time) outOfOrder++
      else if (candle.time === candles[i - 1].time) duplicated++
    }
  }
  if (impossible > 0) problems.push(`${impossible} candle${impossible === 1 ? '' : 's'} could not have happened.`)
  if (outOfOrder > 0) problems.push(`${outOfOrder} candle${outOfOrder === 1 ? '' : 's'} arrived out of order.`)
  if (duplicated > 0) problems.push(`${duplicated} duplicate timestamp${duplicated === 1 ? '' : 's'}.`)
  return problems
}
export interface OpenPosition {
  entryIndex: number
  entryTime: number
  entryPrice: number
  quantity: number
  stop: number | null
  target: number | null
  /** The best price reached since entry, for a trailing stop. */
  best: number
  entryFee: number
  evidence: { rule: string; left: number | null; right: number | null }[]
}

/**
 * A run in progress.
 *
 * Held as a value rather than in closures so that **one bar can be advanced at a time**. That is what lets replay and a
 * whole backtest share an execution model instead of having two that drift: a backtest is this stepped to the end, and
 * a replay is this stepped as far as somebody has watched.
 */
export interface RunState {
  strategy: Strategy
  candles: Candle[]
  settings: BacktestOptions
  series: Map<string, Series>
  /** The first bar at which every series has a value. Null when the history was never enough to evaluate anything. */
  warmup: number | null
  /** The last bar that has been processed, or `warmup - 1` before anything has. */
  cursor: number
  cash: number
  position: OpenPosition | null
  cooldownUntil: number
  trades: BacktestTrade[]
  equity: EquityBar[]
  ambiguousExits: number
  /** Units of buy-and-hold bought at the first tradable bar, for the benchmark line. */
  benchmarkUnits: number
  warnings: string[]
  finished: boolean
}

/** Starts a run without advancing it. */
export function createRun(strategy: Strategy, candles: Candle[], options: Partial<BacktestOptions> = {}): RunState {
  const settings: BacktestOptions = { ...DEFAULT_OPTIONS, ...options, costs: { ...DEFAULT_COSTS, ...options.costs } }
  const warnings = [...validateCandles(candles)]

  if (candles.length < 3) {
    warnings.push('There are not enough candles to run anything.')
    return {
      strategy,
      candles,
      settings,
      series: new Map(),
      warmup: null,
      cursor: -1,
      cash: settings.startingCash,
      position: null,
      cooldownUntil: -1,
      trades: [],
      equity: [],
      ambiguousExits: 0,
      benchmarkUnits: 0,
      warnings,
      finished: true
    }
  }

  const series = seriesFor(strategy, candles)
  const warmup = warmupIndex(series, candles.length)
  if (warmup === null) {
    // Not a strategy that never triggered: one that could never be evaluated. The two look identical in a result and
    // mean entirely different things.
    warnings.push('There is not enough history for the indicators this strategy uses, so it was never evaluated.')
  }

  const benchmarkStart = warmup === null ? 0 : candles[warmup].open
  return {
    strategy,
    candles,
    settings,
    series,
    warmup,
    cursor: warmup === null ? -1 : warmup - 1,
    cash: settings.startingCash,
    position: null,
    cooldownUntil: -1,
    trades: [],
    equity: [],
    ambiguousExits: 0,
    benchmarkUnits: benchmarkStart > 0 ? settings.startingCash / benchmarkStart : 0,
    warnings,
    finished: warmup === null
  }
}

/** Whether there is another bar to process. */
export const canStep = (state: RunState): boolean =>
  !state.finished && state.warmup !== null && state.cursor + 1 < state.candles.length

/**
 * Advances exactly one bar, in place.
 *
 * The order inside is the whole argument of this file: an open position meets the bar first, then the trailing stop
 * follows the bar, then the strategy decides on this bar's close for the *next* bar's open, and only then is the account
 * marked to market. Any other order lets a decision see something it could not have seen.
 */
export function stepRun(state: RunState): boolean {
  if (!canStep(state)) return false
  const i = state.cursor + 1
  state.cursor = i

  const { strategy, candles, series } = state
  const { slippage, feeRate } = state.settings.costs
  const long = strategy.direction === 'long'
  const candle = candles[i]

  const withSlippage = (price: number, buying: boolean): number => price * (buying ? 1 + slippage : 1 - slippage)

  const closeAt = (price: number, index: number, reason: ExitReason, ambiguous: boolean): void => {
    const position = state.position
    if (!position) return
    const value = price * position.quantity
    const fee = value * feeRate
    state.cash += long ? value - fee : -value - fee
    const gross = long
      ? (price - position.entryPrice) * position.quantity
      : (position.entryPrice - price) * position.quantity
    const fees = position.entryFee + fee
    const invested = position.entryPrice * position.quantity
    state.trades.push({
      entryIndex: position.entryIndex,
      exitIndex: index,
      entryTime: position.entryTime,
      exitTime: candles[index].time,
      direction: strategy.direction,
      quantity: position.quantity,
      entryPrice: position.entryPrice,
      exitPrice: price,
      fees,
      net: gross - fees,
      returnPercent: invested > 0 ? ((gross - fees) / invested) * 100 : 0,
      exitReason: reason,
      ambiguousBar: ambiguous,
      entryEvidence: position.evidence
    })
    if (ambiguous) state.ambiguousExits++
    state.position = null
    state.cooldownUntil = index + strategy.cooldownBars
  }

  // ---- an open position meets this bar before anything else is decided about it
  if (state.position) {
    const stopLevel = state.position.stop
    const targetLevel = state.position.target
    const hitStop = stopLevel !== null && (long ? candle.low <= stopLevel : candle.high >= stopLevel)
    const hitTarget = targetLevel !== null && (long ? candle.high >= targetLevel : candle.low <= targetLevel)

    if (hitStop && hitTarget) {
      // The candle does not say which came first. Taking the worse one is the only choice that cannot flatter the
      // result, and the run counts how often it had to be made.
      closeAt(withSlippage(stopLevel as number, !long), i, 'stop', true)
    } else if (hitStop) {
      closeAt(withSlippage(stopLevel as number, !long), i, 'stop', false)
    } else if (hitTarget) {
      closeAt(withSlippage(targetLevel as number, !long), i, 'target', false)
    }
  }

  // ---- the trailing stop follows this bar's extreme, for the bars that come after it
  if (state.position && strategy.trailingStopPercent !== undefined) {
    state.position.best = long
      ? Math.max(state.position.best, candle.high)
      : Math.min(state.position.best, candle.low)
    const trail =
      state.position.best * (long ? 1 - strategy.trailingStopPercent / 100 : 1 + strategy.trailingStopPercent / 100)
    state.position.stop =
      state.position.stop === null
        ? trail
        : long
          ? Math.max(state.position.stop, trail)
          : Math.min(state.position.stop, trail)
  }

  // ---- decide on this bar's close, act on the next bar's open
  const next = candles[i + 1]
  if (next) {
    if (state.position) {
      if (groupHolds(strategy.exit, series, i).holds) {
        closeAt(withSlippage(next.open, !long), i + 1, 'rule', false)
      }
    } else if (i >= state.cooldownUntil) {
      const entry = groupHolds(strategy.entry, series, i)
      if (entry.holds) {
        const price = withSlippage(next.open, long)
        const stop =
          strategy.stopLossPercent === undefined
            ? null
            : price * (long ? 1 - strategy.stopLossPercent / 100 : 1 + strategy.stopLossPercent / 100)
        const wanted = quantityFor(strategy.sizing, state.cash, price, stop)
        if (wanted !== null && wanted > 0) {
          const value = price * wanted
          const fee = value * feeRate
          // Never more than the cash on hand: this does not simulate borrowing, and an order that overdrew would make
          // every figure after it meaningless.
          const affordable =
            value + fee <= state.cash + CLOSE_ENOUGH ? wanted : (state.cash / (price * (1 + feeRate))) * (1 - 1e-9)
          if (affordable > 0) {
            const realValue = price * affordable
            const realFee = realValue * feeRate
            state.cash += long ? -realValue - realFee : realValue - realFee
            state.position = {
              entryIndex: i + 1,
              entryTime: next.time,
              entryPrice: price,
              quantity: affordable,
              stop,
              target:
                strategy.takeProfitPercent === undefined
                  ? null
                  : price * (long ? 1 + strategy.takeProfitPercent / 100 : 1 - strategy.takeProfitPercent / 100),
              best: price,
              entryFee: realFee,
              evidence: entry.rules.map((one) => ({
                rule: `${one.rule.comparator}`,
                left: one.left,
                right: one.right
              }))
            }
          }
        }
      }
    }
  }

  // ---- mark to market at this bar's close
  const held = state.position
    ? long
      ? candle.close * state.position.quantity
      : -candle.close * state.position.quantity
    : 0
  state.equity.push({
    index: i,
    at: candle.time,
    equity: state.cash + held,
    benchmark: state.benchmarkUnits * candle.close,
    inPosition: state.position !== null
  })
  return true
}

/**
 * Closes anything still open and marks the run finished.
 *
 * The closing trade is labelled `end-of-data` rather than given a reason, because it was not a decision the strategy
 * made — the candles simply ran out.
 */
export function finishRun(state: RunState): RunState {
  if (state.finished) return state
  if (state.position) {
    const last = state.candles.length - 1
    const long = state.strategy.direction === 'long'
    const price = state.candles[last].close * (long ? 1 - state.settings.costs.slippage : 1 + state.settings.costs.slippage)
    const position = state.position
    const value = price * position.quantity
    const fee = value * state.settings.costs.feeRate
    state.cash += long ? value - fee : -value - fee
    const gross = long
      ? (price - position.entryPrice) * position.quantity
      : (position.entryPrice - price) * position.quantity
    const fees = position.entryFee + fee
    const invested = position.entryPrice * position.quantity
    state.trades.push({
      entryIndex: position.entryIndex,
      exitIndex: last,
      entryTime: position.entryTime,
      exitTime: state.candles[last].time,
      direction: state.strategy.direction,
      quantity: position.quantity,
      entryPrice: position.entryPrice,
      exitPrice: price,
      fees,
      net: gross - fees,
      returnPercent: invested > 0 ? ((gross - fees) / invested) * 100 : 0,
      exitReason: 'end-of-data',
      ambiguousBar: false,
      entryEvidence: position.evidence
    })
    state.position = null
    const lastBar = state.equity[state.equity.length - 1]
    if (lastBar) {
      lastBar.equity = state.cash
      lastBar.inPosition = false
    }
  }
  state.finished = true
  return state
}

/** The figures for a run as it stands, finished or not. */
export function statsOf(state: RunState, periodicity: Periodicity = 'hourly'): BacktestStats {
  const first = state.equity[0]
  const last = state.equity[state.equity.length - 1]
  const covered = first && last ? Math.max(0, last.at - first.at) : 0
  return statsFrom(state.equity, state.trades, state.settings.startingCash, periodicity, covered)
}

/**
 * Runs a strategy over candles, to the end.
 *
 * A thin wrapper over the same stepping a replay uses: start a run, advance every bar, close whatever is open. They
 * cannot drift apart because there is only one implementation of what a bar does.
 *
 * Pure: no clock, no randomness, no network. Given the same arguments it returns the same result, which is what lets a
 * stored run be reproduced from what was stored beside it.
 */
export function backtest(
  strategy: Strategy,
  candles: Candle[],
  options: Partial<BacktestOptions> = {}
): BacktestResult {
  const state = createRun(strategy, candles, options)
  const settings = state.settings
  const periodicity = settings.periodicity ?? 'hourly'

  const blank: BacktestResult = {
    strategyId: strategy.id,
    strategyVersion: strategy.version,
    instrumentId: strategy.instrumentId,
    interval: strategy.interval,
    bars: 0,
    from: candles[0]?.time ?? 0,
    to: candles[candles.length - 1]?.time ?? 0,
    warmupBars: 0,
    trades: [],
    equity: [],
    stats: emptyStats(),
    outOfSample: null,
    ambiguousExits: 0,
    costs: settings.costs,
    startingCash: settings.startingCash,
    assumptions: ASSUMPTIONS,
    warnings: state.warnings
  }

  if (state.warmup === null) return blank

  while (canStep(state)) stepRun(state)
  finishRun(state)

  const warmup = state.warmup
  const trades = state.trades
  const equity = state.equity
  const ambiguousExits = state.ambiguousExits
  const warnings = state.warnings

  const from = candles[warmup].time
  const to = candles[candles.length - 1].time
  const covered = Math.max(0, to - from)

  // ---- the held-back stretch, if one was asked for
  let outOfSample: BacktestResult['outOfSample'] = null
  const holdBack = settings.outOfSamplePercent ?? 0
  if (holdBack > 0 && holdBack < 100 && equity.length > 10) {
    const splitAt = Math.floor(equity.length * (1 - holdBack / 100))
    const tail = equity.slice(splitAt)
    if (tail.length > 2) {
      const splitIndex = tail[0].index
      // Only trades that both opened and closed inside the tail: one straddling the split belongs to neither stretch.
      const tailTrades = trades.filter((trade) => trade.entryIndex >= splitIndex)
      const tailCovered = Math.max(0, tail[tail.length - 1].at - tail[0].at)
      outOfSample = {
        from: tail[0].at,
        to: tail[tail.length - 1].at,
        bars: tail.length,
        stats: statsFrom(tail, tailTrades, tail[0].equity, periodicity, tailCovered),
        trades: tailTrades.length
      }
    }
  }

  const stats = statsFrom(equity, trades, settings.startingCash, periodicity, covered)

  // ---- what makes this result less trustworthy than it looks
  if (trades.length === 0) {
    warnings.push('The entry rules were never satisfied over this period, so nothing was traded.')
  } else if (trades.length < 10) {
    warnings.push(
      `Only ${trades.length} trade${trades.length === 1 ? '' : 's'}. Statistics over so few tell you very little about the rules.`
    )
  }
  if (ambiguousExits > 0) {
    const share = Math.round((ambiguousExits / trades.length) * 100)
    warnings.push(
      `${ambiguousExits} of ${trades.length} trades ended on a bar containing both the stop and the target. The data does not say which came first, so the stop was assumed${share >= 25 ? ' — at this share, the result depends heavily on that assumption' : ''}.`
    )
  }
  if (covered < 30 * 24 * 3600_000) {
    warnings.push('This covers less than a month, which is too short for the risk figures to describe much.')
  }

  return {
    strategyId: strategy.id,
    strategyVersion: strategy.version,
    instrumentId: strategy.instrumentId,
    interval: strategy.interval,
    bars: equity.length,
    from,
    to,
    warmupBars: warmup,
    trades,
    equity,
    stats,
    outOfSample,
    ambiguousExits,
    costs: settings.costs,
    startingCash: settings.startingCash,
    assumptions: ASSUMPTIONS,
    warnings
  }
}

/**
 * One parameter sweep.
 *
 * Runs the same strategy with one operand's option changed, and returns each result's headline figures. Deliberately
 * shallow: a sweep over three parameters at ten values each is a thousand backtests, and the best of a thousand is
 * usually a description of the data rather than of the rules.
 */
export interface SweepPoint {
  value: number
  totalReturnPercent: number
  maxDrawdownPercent: number
  sharpe: number | null
  trades: number
}

export function sweep(
  strategy: Strategy,
  candles: Candle[],
  change: (strategy: Strategy, value: number) => Strategy,
  values: number[],
  options: Partial<BacktestOptions> = {}
): { points: SweepPoint[]; warning: string } {
  const points = values.slice(0, 40).map((value) => {
    const result = backtest(change(strategy, value), candles, options)
    return {
      value,
      totalReturnPercent: result.stats.totalReturnPercent,
      maxDrawdownPercent: result.stats.maxDrawdownPercent,
      sharpe: result.stats.sharpe,
      trades: result.trades.length
    }
  })
  return {
    points,
    // Said every time, because the number this produces is the most persuasive and least reliable in the whole feature.
    warning:
      'The best value here is the one that best fits what already happened. That is not the same as the one that will work next, and the more values are tried the less it means.'
  }
}
