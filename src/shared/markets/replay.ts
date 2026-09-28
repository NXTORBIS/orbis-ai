import type { Candle } from './indicators.ts'
import type { Periodicity } from './risk.ts'
import type { Strategy } from './strategy.ts'
import {
  canStep,
  createRun,
  finishRun,
  statsOf,
  stepRun,
  type BacktestOptions,
  type BacktestStats,
  type BacktestTrade,
  type EquityBar,
  type OpenPosition,
  type RunState
} from './backtest.ts'

/**
 * Replaying history, one bar at a time.
 *
 * The same engine as a backtest, stepped rather than run to the end — literally the same `stepRun`, so the two cannot
 * reach different conclusions about the same candles. A backtest is this watched at infinite speed.
 *
 * The point of replaying is to see a strategy meet a market without knowing what happens next, so the one thing this
 * file is strict about is **what the viewer is allowed to see.** `visibleCandles` ends at the cursor. Handing the whole
 * array to a chart and letting it draw the future would make the exercise pointless while looking identical.
 *
 * There is one honest subtlety, and it is surfaced rather than hidden: a signal on the bar at the cursor fills at the
 * *next* bar's open, which has not been reached. Until the cursor gets there, the position is reported as `pending` and
 * the interface says it is entering at the next bar's open rather than pretending it is already in.
 *
 * Seeking backwards rebuilds the run from the start. That is sound because the engine is deterministic: the same
 * strategy over the same candles produces the same state at the same bar, every time. It is also why seeking is cheap
 * enough to do on a dragged slider.
 */

/** How many bars a second each speed advances. The interface and the tests agree because there is one list. */
export const SPEEDS = [0.5, 1, 2, 5, 10, 25] as const
export type Speed = (typeof SPEEDS)[number]

export interface ReplaySession {
  run: RunState
  /** The first bar that can be shown: everything before it went to warming the indicators up. */
  from: number
  /** The last bar there is. */
  to: number
}

export function createReplay(
  strategy: Strategy,
  candles: Candle[],
  options: Partial<BacktestOptions> = {}
): ReplaySession {
  const run = createRun(strategy, candles, options)
  return {
    run,
    from: run.warmup ?? 0,
    to: Math.max(0, candles.length - 1)
  }
}

/** Whether there is anything left to watch. */
export const hasMore = (session: ReplaySession): boolean => canStep(session.run)

/**
 * Advances by a number of bars, stopping at the end.
 *
 * Mutates the run in place and returns the session, because the alternative -- copying a run of a thousand equity points
 * sixty times a second -- is how a replay comes to stutter.
 */
export function advanceReplay(session: ReplaySession, bars = 1): ReplaySession {
  let left = Math.max(0, Math.round(bars))
  while (left > 0 && canStep(session.run)) {
    stepRun(session.run)
    left--
  }
  // Reaching the end closes whatever was open, exactly as a backtest would.
  if (!canStep(session.run) && !session.run.finished) finishRun(session.run)
  return session
}

/**
 * Moves to a given bar, forwards or back.
 *
 * Backwards means rebuilding from the start. Nothing is lost by that -- the engine is deterministic, so the state at bar
 * 300 is the same state whether it was reached by stepping or by rebuilding -- and it avoids keeping an undo history of
 * every bar, which for a thousand bars would be a thousand copies of a growing account.
 */
export function seekReplay(session: ReplaySession, index: number): ReplaySession {
  const wanted = Math.max(session.from - 1, Math.min(session.to, Math.round(index)))
  if (wanted >= session.run.cursor) return advanceReplay(session, wanted - session.run.cursor)

  const rebuilt = createReplay(session.run.strategy, session.run.candles, session.run.settings)
  if (wanted >= rebuilt.from) advanceReplay(rebuilt, wanted - rebuilt.run.cursor)
  return rebuilt
}

export interface ReplayPosition {
  entryIndex: number
  entryTime: number
  entryPrice: number
  quantity: number
  stop: number | null
  target: number | null
  /** Profit or loss at the cursor's close, which is the last price the viewer has seen. */
  unrealised: number
  unrealisedPercent: number
  /**
   * True when the entry is at a bar the viewer has not reached.
   *
   * A signal on the bar at the cursor fills at the next bar's open. Saying the position is already open would be showing
   * a fill at a price that has not been revealed.
   */
  pending: boolean
}

export interface ReplayView {
  /** Only up to the cursor. Handing a chart the whole array would draw the future. */
  visibleCandles: Candle[]
  cursor: number
  from: number
  to: number
  /** How far through, 0–100. */
  progress: number
  at: number
  /** The bar the cursor is on. Null before the run has started. */
  bar: Candle | null
  equity: EquityBar[]
  /** Everything closed so far. */
  trades: BacktestTrade[]
  position: ReplayPosition | null
  stats: BacktestStats
  cash: number
  /** Cash plus the open position at the cursor's close. */
  total: number
  finished: boolean
  warnings: string[]
}

const positionView = (position: OpenPosition, close: number, cursor: number, long: boolean): ReplayPosition => {
  const unrealised = long
    ? (close - position.entryPrice) * position.quantity
    : (position.entryPrice - close) * position.quantity
  const invested = position.entryPrice * position.quantity
  return {
    entryIndex: position.entryIndex,
    entryTime: position.entryTime,
    entryPrice: position.entryPrice,
    quantity: position.quantity,
    stop: position.stop,
    target: position.target,
    unrealised,
    unrealisedPercent: invested > 0 ? (unrealised / invested) * 100 : 0,
    pending: position.entryIndex > cursor
  }
}

/** Everything a replay screen draws, at the bar it has reached. */
export function replayView(session: ReplaySession, periodicity: Periodicity = 'hourly'): ReplayView {
  const { run } = session
  const cursor = run.cursor
  const bar = cursor >= 0 ? (run.candles[cursor] ?? null) : null
  const long = run.strategy.direction === 'long'
  const close = bar?.close ?? 0

  const held = run.position && !(run.position.entryIndex > cursor)
    ? (long ? close * run.position.quantity : -close * run.position.quantity)
    : 0

  return {
    // Inclusive of the cursor, exclusive of everything after it. This single slice is what makes a replay a replay.
    visibleCandles: cursor >= 0 ? run.candles.slice(0, cursor + 1) : [],
    cursor,
    from: session.from,
    to: session.to,
    progress: session.to > session.from ? Math.max(0, Math.min(100, ((cursor - session.from) / (session.to - session.from)) * 100)) : 0,
    at: bar?.time ?? 0,
    bar,
    equity: run.equity,
    trades: run.trades,
    position: run.position ? positionView(run.position, close, cursor, long) : null,
    stats: statsOf(run, periodicity),
    cash: run.cash,
    total: run.cash + held,
    finished: run.finished,
    warnings: run.warnings
  }
}

/**
 * How many bars a tick of the clock should advance.
 *
 * Returns whole bars and carries the remainder, so half-speed really is half rather than rounding to one bar per tick
 * and running at the same rate as single speed.
 */
export function barsForTick(speed: Speed, elapsedMs: number, carried = 0): { bars: number; carry: number } {
  const wanted = carried + (speed * elapsedMs) / 1000
  // Ten tenths of a bar come to 0.9999999999999999, not 1. Without this nudge a slow replay drops a bar every tenth
  // tick and a fast one drifts steadily behind the speed it claims.
  const nudged = Math.abs(wanted - Math.round(wanted)) < 1e-9 ? Math.round(wanted) : wanted
  const bars = Math.floor(nudged)
  return { bars: Math.max(0, bars), carry: nudged - bars }
}
