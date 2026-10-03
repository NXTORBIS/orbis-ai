import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight, Eye, Pause, Play, RotateCcw, SkipForward } from 'lucide-react'
import {
  advanceReplay,
  barsForTick,
  createReplay,
  hasMore,
  replayView,
  seekReplay,
  SPEEDS,
  type ReplaySession,
  type ReplayView,
  type Speed
} from '../../../../shared/markets/replay'
import { describeStrategy, type Strategy } from '../../../../shared/markets/strategy'
import type { StrategiesAnswer } from '../../../../main/markets/ipc'
import type { Candle } from '../../../../shared/markets/indicators'
import MarketChart from './MarketChart'
import EquityChart from './EquityChart'
import { useCurrency } from './useCurrency'
import type { NoticeKind } from '../../App'

/**
 * Replay: a strategy meeting a market one bar at a time.
 *
 * The chart is given `visibleCandles`, which ends at the bar the replay has reached. That one detail is the feature: a
 * chart handed the whole history would draw what happens next, and watching a strategy while already knowing the answer
 * teaches nothing.
 *
 * The engine is the same one the backtester uses, stepped instead of run to the end — so a replay watched to the finish
 * arrives at exactly the backtest's numbers. That is checked by a test rather than asserted here.
 *
 * Nothing in this file decides anything about a trade. It holds the clock, and the clock only chooses how many bars to
 * hand to the engine.
 */

const refused = (value: unknown): value is { error: string; message?: string } =>
  typeof value === 'object' && value !== null && typeof (value as { error?: unknown }).error === 'string'

/** An amount of an asset, which is not money. Prices go through the currency hook inside the component. */
const coins = (value: number | null | undefined): string =>
  typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 8 }) : '—'

const percent = (value: number | null | undefined, digits = 2): string =>
  typeof value === 'number' && Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(digits)}%` : '—'

const way = (value: number | null | undefined): 'up' | 'down' | 'flat' =>
  typeof value !== 'number' || !Number.isFinite(value) || value === 0 ? 'flat' : value > 0 ? 'up' : 'down'

export default function ReplayPanel({
  onNotify
}: {
  onNotify(message: string, kind?: NoticeKind): void
}): React.JSX.Element {
  const currency = useCurrency()
  /** Prices convert; the quantity held does not. */
  const money = (value: number | null | undefined): string => currency.money(value).text
  const [state, setState] = useState<StrategiesAnswer | null>(null)
  const [strategy, setStrategy] = useState<Strategy | null>(null)
  const [candles, setCandles] = useState<Candle[]>([])
  const [loading, setLoading] = useState(false)
  const [note, setNote] = useState('')
  const [bars, setBars] = useState(500)

  const [view, setView] = useState<ReplayView | null>(null)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<Speed>(5)

  /** The session is held in a ref: it is stepped many times a second and copying it per frame would stutter. */
  const session = useRef<ReplaySession | null>(null)
  const carry = useRef(0)
  const lastTick = useRef(0)

  const load = useCallback(async () => {
    const got = await window.api.marketsStrategies()
    if (!refused(got)) setState(got)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const show = useCallback(() => {
    if (session.current) setView(replayView(session.current))
  }, [])

  /** Loads the candles and starts a session at the beginning. */
  const begin = useCallback(
    async (chosen: Strategy) => {
      setPlaying(false)
      setLoading(true)
      setNote('')
      setView(null)
      session.current = null
      try {
        const got = await window.api.marketsCandles(chosen.instrumentId, chosen.interval, bars)
        if (refused(got)) {
          setCandles([])
          setNote(got.message ?? 'There is no history to replay.')
          return
        }
        if (got.candles.length < 3) {
          setCandles([])
          setNote('The provider returned too little history to replay.')
          return
        }
        setCandles(got.candles)
        session.current = createReplay(chosen, got.candles, { startingCash: 10_000 })
        setView(replayView(session.current))
      } finally {
        setLoading(false)
      }
    },
    [bars]
  )

  // ---------------------------------------------------------------- the clock

  useEffect(() => {
    if (!playing) return
    let frame = 0
    lastTick.current = performance.now()

    const tick = (): void => {
      const now = performance.now()
      const elapsed = now - lastTick.current
      lastTick.current = now
      const current = session.current
      if (!current) return

      const { bars: step, carry: left } = barsForTick(speed, elapsed, carry.current)
      carry.current = left
      if (step > 0) {
        advanceReplay(current, step)
        show()
      }
      if (!hasMore(current)) {
        // Stopping at the end rather than looping: a replay that restarted on its own would show the same market twice
        // and look like new data.
        setPlaying(false)
        show()
        // Said, because at twenty-five bars a second somebody watching the chart will not have noticed it stop.
        onNotify(`Replay finished — ${current.run.trades.length} trade${current.run.trades.length === 1 ? '' : 's'}`)
        return
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, speed, show, onNotify])

  const step = (count: number): void => {
    if (!session.current) return
    setPlaying(false)
    advanceReplay(session.current, count)
    show()
  }

  const seek = (index: number): void => {
    if (!session.current) return
    setPlaying(false)
    session.current = seekReplay(session.current, index)
    carry.current = 0
    show()
  }

  const restart = (): void => {
    if (!strategy || candles.length === 0) return
    setPlaying(false)
    session.current = createReplay(strategy, candles, { startingCash: 10_000 })
    carry.current = 0
    show()
  }

  const strategies = state?.strategies ?? []
  const symbolOf = (instrumentId: string): string =>
    state?.instruments.find((one) => one.instrumentId === instrumentId)?.symbol ??
    instrumentId.split(':').pop() ??
    instrumentId

  return (
    <div className="mk-replay">
      <div className="mk-replay-bar">
        <label className="mk-inline">
          <span>Strategy</span>
          <select
            value={strategy?.id ?? ''}
            onChange={(e) => {
              const chosen = strategies.find((one) => one.id === e.target.value) ?? null
              setStrategy(chosen)
              if (chosen) void begin(chosen)
            }}
          >
            <option value="">choose one…</option>
            {strategies.map((one) => (
              <option key={one.id} value={one.id}>
                {one.name} · {symbolOf(one.instrumentId)} {one.interval}
              </option>
            ))}
          </select>
        </label>

        <label className="mk-inline">
          <span>History</span>
          <select value={String(bars)} onChange={(e) => setBars(Number(e.target.value))}>
            <option value="200">200 bars</option>
            <option value="500">500 bars</option>
            <option value="1000">1000 bars</option>
          </select>
        </label>

        <button
          type="button"
          className="queue-btn small ghost"
          disabled={!strategy || loading}
          onClick={() => strategy && void begin(strategy)}
        >
          <RotateCcw size={13} /> {loading ? 'Loading…' : 'Reload history'}
        </button>
      </div>

      {strategies.length === 0 && (
        <div className="mk-empty-small">
          <p>No strategies to replay.</p>
          <p className="pw-note is-quiet">Write one under Strategies first, then come back and watch it run.</p>
        </div>
      )}

      {note && (
        <p className="pw-note" role="alert">
          {note}
        </p>
      )}

      {strategy && view && (
        <>
          {/* What is about to be watched, in words. */}
          <ul className="mk-assumptions">
            {describeStrategy(strategy).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>

          <div className="mk-replay-controls">
            <button
              type="button"
              className="queue-btn small"
              disabled={!hasMore(session.current as ReplaySession) && !playing}
              onClick={() => setPlaying((on) => !on)}
            >
              {playing ? (
                <>
                  <Pause size={13} /> Pause
                </>
              ) : (
                <>
                  <Play size={13} /> Play
                </>
              )}
            </button>
            <button type="button" className="queue-btn small ghost" onClick={() => step(1)} disabled={view.finished}>
              <ChevronRight size={13} /> Bar
            </button>
            <button type="button" className="queue-btn small ghost" onClick={() => step(10)} disabled={view.finished} aria-label="Forward ten bars">
              <SkipForward size={13} /> 10
            </button>
            <button type="button" className="queue-btn small ghost" onClick={restart}>
              <RotateCcw size={13} /> Restart
            </button>

            <div className="mk-seg">
              {SPEEDS.map((one) => (
                <button key={one} type="button" className={speed === one ? 'on' : ''} onClick={() => setSpeed(one)}>
                  {one}×
                </button>
              ))}
            </div>

            <input
              type="range"
              className="mk-scrub"
              min={view.from - 1}
              max={view.to}
              value={view.cursor}
              aria-label="Position in the replay"
              onChange={(e) => seek(Number(e.target.value))}
            />
            <span className="mk-quiet">
              {Math.max(0, view.cursor - view.from + 1).toLocaleString()} / {(view.to - view.from + 1).toLocaleString()} bars
              {view.at > 0 && <> · {new Date(view.at).toLocaleString()}</>}
            </span>
          </div>

          <div className="mk-pf-stats">
            <span>
              Account <b>{money(view.total)}</b>
            </span>
            <span>
              Return{' '}
              <b className={`mk-change ${way(view.stats.totalReturnPercent)}`}>{percent(view.stats.totalReturnPercent)}</b>
            </span>
            <span title="Buying and holding the same market from the first tradable bar">
              Buy and hold{' '}
              <b className={`mk-change ${way(view.stats.benchmarkReturnPercent)}`}>
                {percent(view.stats.benchmarkReturnPercent)}
              </b>
            </span>
            <span>
              Closed trades <b>{view.trades.length}</b>
            </span>
            <span>
              Max drawdown <b>{view.stats.maxDrawdownPercent === 0 ? '0%' : `−${view.stats.maxDrawdownPercent.toFixed(2)}%`}</b>
            </span>
            <span>
              Win rate <b>{view.stats.performance.winRate === null ? '—' : `${view.stats.performance.winRate.toFixed(0)}%`}</b>
            </span>
          </div>

          {/* The position, with the honest distinction between held and about to be held. */}
          {view.position ? (
            <p className={`mk-replay-position${view.position.pending ? ' is-pending' : ''}`}>
              <Eye size={13} />
              {view.position.pending ? (
                <>
                  Entering at the next bar&apos;s open — the signal happened on this bar, and the fill is at a price that
                  has not been revealed yet.
                </>
              ) : (
                <>
                  Holding {coins(view.position.quantity)} from{' '}
                  {money(view.position.entryPrice)} ·{' '}
                  <b className={`mk-change ${way(view.position.unrealised)}`}>
                    {money(view.position.unrealised)} ({percent(view.position.unrealisedPercent)})
                  </b>
                  {view.position.stop !== null && <> · stop {money(view.position.stop)}</>}
                  {view.position.target !== null && <> · target {money(view.position.target)}</>}
                </>
              )}
            </p>
          ) : (
            <p className="mk-replay-position is-flat">
              <Eye size={13} /> Flat{view.finished ? ' — the history has run out.' : ', waiting for the entry rules.'}
            </p>
          )}

          {/* The chart is given only what has been watched. This is the feature. */}
          <MarketChart
            candles={view.visibleCandles}
            interval={strategy.interval}
            type="candles"
            indicators={[]}
            precision={view.bar && view.bar.close < 1 ? 6 : 2}
            priceText={(value) => currency.money(value, { compact: true }).text}
            showVolume
            height={320}
          />

          <EquityChart equity={view.equity} height={160} />

          {view.trades.length > 0 && (
            <div className="mk-table-wrap">
              <table className="mk-table">
                <thead>
                  <tr>
                    <th>In</th>
                    <th>Out</th>
                    <th>Entry</th>
                    <th>Exit</th>
                    <th>Result</th>
                    <th>Why it closed</th>
                  </tr>
                </thead>
                <tbody>
                  {[...view.trades].reverse().map((trade, i) => (
                    <tr key={`${trade.entryIndex}-${i}`}>
                      <td>{new Date(trade.entryTime).toLocaleString()}</td>
                      <td>{new Date(trade.exitTime).toLocaleString()}</td>
                      <td>{money(trade.entryPrice)}</td>
                      <td>{money(trade.exitPrice)}</td>
                      <td className={`mk-change ${way(trade.net)}`}>{percent(trade.returnPercent)}</td>
                      <td>
                        {trade.exitReason}
                        {trade.ambiguousBar && (
                          <span
                            className="mk-ambiguous"
                            title="This bar contained both the stop and the target. The data does not say which came first, so the stop was assumed."
                          >
                            {' '}
                            assumed
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {view.finished && (
            <p className="pw-note is-quiet">
              The replay has reached the end of the loaded history. These are the same numbers a backtest of this strategy
              over the same candles produces — it is the same engine, watched rather than run.
            </p>
          )}
        </>
      )}

      {strategies.length > 0 && !strategy && (
        <div className="mk-empty-small">
          <p>Choose a strategy to replay.</p>
          <p className="pw-note is-quiet">
            The chart will only ever show bars the replay has reached, so you meet the market the way the strategy did.
          </p>
        </div>
      )}
    </div>
  )
}
