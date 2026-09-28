import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Info, NotebookPen, Play, RefreshCw, Search, Trash2, X } from 'lucide-react'
import type { PaperAnswer } from '../../../../main/markets/ipc'
import type { Instrument } from '../../../../shared/markets/instrument'
import type { OrderType, PaperOrder, Side } from '../../../../shared/markets/paper'
import { saveJournalNote, tradeNote } from './journal'
import AssetLogo from './AssetLogo'
import { useCurrency } from './useCurrency'
import type { NoticeKind } from '../../App'

/**
 * The simulated portfolio, and the desk that trades into it.
 *
 * Every number on this screen comes from fills that happened in the simulation against real prices. Nothing is projected
 * and nothing is back-filled: the equity curve has readings for the time Orbis was running and gaps for the time it was
 * not, because what a portfolio was worth while the application was closed is not something anybody recorded.
 *
 * The word SIMULATED appears at the top and stays there. It is not decoration — this places orders that look and behave
 * like orders, and somebody arriving at this screen halfway through a session should not have to work out which kind
 * they are.
 */

const refused = (value: unknown): value is { error: string; message?: string } =>
  typeof value === 'object' && value !== null && typeof (value as { error?: unknown }).error === 'string'

/** An amount of an asset, which is not money and does not follow a currency's rules. */
const coins = (value: number | null | undefined): string =>
  typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 8 }) : '—'

const percent = (value: number | null | undefined, digits = 2): string =>
  typeof value === 'number' && Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(digits)}%` : '—'

/** A ratio with no denominator is unavailable, not zero. The two read very differently. */
const ratio = (value: number | null | undefined, digits = 2): string =>
  typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—'

const way = (value: number | null | undefined): 'up' | 'down' | 'flat' =>
  typeof value !== 'number' || !Number.isFinite(value) || value === 0 ? 'flat' : value > 0 ? 'up' : 'down'

const duration = (ms: number | null | undefined): string => {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '—'
  // Seconds below a minute: "0 min" for a trade held for ten seconds reads as instantaneous, which is a different claim.
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))} s`
  const minutes = ms / 60_000
  if (minutes < 60) return `${Math.round(minutes)} min`
  const hours = minutes / 60
  if (hours < 48) return `${hours.toFixed(1)} h`
  return `${(hours / 24).toFixed(1)} days`
}

const START_CHOICES = [1_000, 10_000, 100_000, 1_000_000]

export default function PortfolioPanel({
  onOpenMarket,
  onNotify,
  current
}: {
  onOpenMarket(instrumentId: string): void
  onNotify(message: string, kind?: NoticeKind): void
  current: Instrument | null
}): React.JSX.Element {
  /**
   * What money is shown in.
   *
   * Display only. The account keeps its own base currency and its accounting never moves — changing what these figures
   * are read in must not change what the simulation thinks happened.
   */
  const display = useCurrency()
  const money = (value: number | null | undefined, _code?: string): string => display.money(value).text

  const [state, setState] = useState<PaperAnswer | null>(null)
  const [busy, setBusy] = useState(false)
  const [showAssumptions, setShowAssumptions] = useState(false)
  const [startingCash, setStartingCash] = useState(10_000)

  // The order ticket.
  const [target, setTarget] = useState<Instrument | null>(current)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Instrument[]>([])
  const [side, setSide] = useState<Side>('buy')
  const [type, setType] = useState<OrderType>('market')
  const [quantity, setQuantity] = useState('')
  const [limitPrice, setLimitPrice] = useState('')
  const [stopPrice, setStopPrice] = useState('')
  /**
   * The price of the market in the ticket.
   *
   * Asked for separately, because the portfolio answer only prices what the account already touches — and the market
   * somebody is about to trade for the first time is, by definition, not one of those. Without this the estimate said
   * there was no price for a market whose price was on the screen behind it.
   */
  const [targetPrice, setTargetPrice] = useState<number | null>(null)

  const load = useCallback(async () => {
    const got = await window.api.marketsPaper()
    if (!refused(got)) setState(got)
  }, [])

  useEffect(() => {
    void load()
    // Prices move, so what the portfolio is worth moves with them.
    const timer = window.setInterval(() => void load(), 3000)
    return () => window.clearInterval(timer)
  }, [load])

  useEffect(() => {
    if (current) setTarget(current)
  }, [current])

  useEffect(() => {
    if (!target) {
      setTargetPrice(null)
      return
    }
    let stopped = false
    const ask = async (): Promise<void> => {
      // Asked for, not merely read: the ticket's market may be one nothing is subscribed to.
      const got = await window.api.marketsQuotes([target.instrumentId], true)
      if (stopped || refused(got)) return
      setTargetPrice(got.quotes[0]?.quote?.last ?? null)
    }
    void ask()
    const timer = window.setInterval(() => void ask(), 3000)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [target])

  useEffect(() => {
    const wanted = query.trim()
    if (wanted.length < 2) {
      setResults([])
      return
    }
    const timer = setTimeout(() => {
      void window.api.marketsSearch(wanted).then((got) => setResults(refused(got) ? [] : got.results))
    }, 250)
    return () => clearTimeout(timer)
  }, [query])

  const run = async (call: () => Promise<unknown>): Promise<unknown> => {
    if (busy) return null
    setBusy(true)
    try {
      const got = await call()
      if (refused(got)) {
        onNotify(got.message ?? 'That did not work.', 'error')
        return got
      }
      setState(got as PaperAnswer)
      return got
    } finally {
      setBusy(false)
    }
  }

  const account = state?.state?.account ?? null
  const value = state?.value ?? null
  const view = state?.view ?? null
  const currency = account?.currency ?? 'USD'

  const symbolOf = (instrumentId: string): string =>
    state?.instruments.find((one) => one.instrumentId === instrumentId)?.symbol ?? instrumentId.split(':').pop() ?? instrumentId

  const priceOf = (instrumentId: string): number | null => {
    const held = state?.prices.find((one) => one.instrumentId === instrumentId)?.price ?? null
    if (held !== null) return held
    // The ticket's own market, when the account has never touched it.
    return target?.instrumentId === instrumentId ? targetPrice : null
  }

  // ---------------------------------------------------------------- no account yet

  if (state && !account) {
    return (
      <div className="mk-portfolio">
        <div className="mk-empty">
          <h3>Paper trading</h3>
          <p className="mk-sim-badge">
            <AlertTriangle size={13} /> Simulated. Nothing here reaches an exchange.
          </p>
          <p>
            Start a simulated account to trade against real prices and keep a portfolio. Orders fill against the live feed
            under stated assumptions, and every result is a simulation.
          </p>
          <div className="mk-start">
            <label className="mk-inline">
              <span>Starting balance</span>
              <select value={String(startingCash)} onChange={(e) => setStartingCash(Number(e.target.value))}>
                {START_CHOICES.map((one) => (
                  <option key={one} value={one}>
                    {one.toLocaleString()} USD
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="queue-btn"
              disabled={busy}
              onClick={() => void run(() => window.api.marketsPaperStart(startingCash, 'USD'))}
            >
              <Play size={13} /> Start a simulated account
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!state || !account || !value || !view) {
    return (
      <div className="mk-portfolio">
        <p className="mk-quiet">Reading the simulated account…</p>
      </div>
    )
  }

  const pending = account.orders.filter((o) => o.state === 'pending')
  const recent = [...account.orders].reverse().slice(0, 12)
  const equity = state.state?.equity ?? []

  return (
    <div className="mk-portfolio">
      {/* ------------------------------------------------------------ the header */}
      <div className="mk-pf-head">
        <div>
          <p className="mk-sim-badge">
            <AlertTriangle size={13} /> Simulated — no order here reaches an exchange
          </p>
          <div className="mk-big">
            <strong>{money(value.total, currency)}</strong>
            <span className={`mk-change ${way(value.returnPercent)}`}>
              <span aria-hidden="true">{way(value.returnPercent) === 'up' ? '▲' : way(value.returnPercent) === 'down' ? '▼' : '—'}</span>
              {percent(value.returnPercent)} <small>since {new Date(state.state?.createdAt ?? 0).toLocaleDateString()}</small>
            </span>
          </div>
        </div>
        <div className="mk-pf-actions">
          <button type="button" className="queue-btn tiny ghost" onClick={() => setShowAssumptions((on) => !on)}>
            <Info size={12} /> Assumptions
          </button>
          <button type="button" className="icon-btn" aria-label="Refresh" onClick={() => void load()}>
            <RefreshCw size={14} />
          </button>
          <button
            type="button"
            className="queue-btn tiny ghost"
            onClick={() => {
              if (
                !window.confirm(
                  'Close this simulated account? Its trades and equity history go with it, and they cannot be recovered.'
                )
              ) {
                return
              }
              void run(() => window.api.marketsPaperClose())
            }}
          >
            Close account
          </button>
        </div>
      </div>

      {/* The assumptions the engine states about itself, shown rather than buried. */}
      {showAssumptions && (
        <ul className="mk-assumptions">
          {state.assumptions.map((one) => (
            <li key={one}>{one}</li>
          ))}
          <li>
            Slippage {((state.state?.settings.slippage ?? 0) * 100).toFixed(3)}% against you, fees{' '}
            {((state.state?.settings.feeRate ?? 0) * 100).toFixed(3)}% a side
            {state.state?.settings.allowShort ? ', shorting allowed' : ', shorting off'}.
          </li>
          <li>
            The equity curve is recorded while Orbis is running. Time when it was closed is a gap, not a straight line.
          </li>
        </ul>
      )}

      {value.missingPrices.length > 0 && (
        <p className="pw-note" role="status">
          {value.missingPrices.length} holding{value.missingPrices.length === 1 ? '' : 's'} could not be priced, so this
          total covers only what is known.
        </p>
      )}

      <div className="mk-pf-stats">
        <span>
          Cash <b>{money(value.cash, currency)}</b>
        </span>
        <span>
          Positions <b>{money(value.total - value.cash, currency)}</b>
        </span>
        <span>
          Unrealised{' '}
          <b className={`mk-change ${way(value.unrealised)}`}>{money(value.unrealised, currency)}</b>
        </span>
        <span>
          Realised <b className={`mk-change ${way(value.realised)}`}>{money(value.realised, currency)}</b>
        </span>
        <span>
          Fees paid <b>{money(value.fees, currency)}</b>
        </span>
        <span title="Everything at risk either way, against the account's value">
          Exposure <b>{view.exposure.grossPercent === null ? '—' : percent(view.exposure.grossPercent, 1)}</b>
        </span>
      </div>

      <div className="mk-pf-body">
        {/* ------------------------------------------------------------ the ticket */}
        <div className="mk-ticket">
          <h4>New simulated order</h4>

          {target ? (
            <span className="mk-chip">
              <AssetLogo instrument={target} size="small" />
              <b>{target.symbol}</b>
              <span className="mk-name">{money(priceOf(target.instrumentId))}</span>
              <button type="button" className="tl-icon" aria-label="Choose another market" onClick={() => setTarget(null)}>
                <X size={11} />
              </button>
            </span>
          ) : (
            <div className="mk-search">
              <Search size={13} />
              <input value={query} placeholder="Which market?" maxLength={60} onChange={(e) => setQuery(e.target.value)} />
              {results.length > 0 && (
                <ul className="mk-results">
                  {results.slice(0, 8).map((one) => (
                    <li key={one.instrumentId}>
                      <button
                        type="button"
                        onClick={() => {
                          setTarget(one)
                          setQuery('')
                          setResults([])
                        }}
                      >
                        <AssetLogo instrument={one} size="small" />
                        <b>{one.symbol}</b>
                        <span className="mk-name">{one.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="mk-seg mk-side">
            <button type="button" className={side === 'buy' ? 'on buy' : ''} onClick={() => setSide('buy')}>
              Buy
            </button>
            <button type="button" className={side === 'sell' ? 'on sell' : ''} onClick={() => setSide('sell')}>
              Sell
            </button>
          </div>

          <div className="mk-alert-row">
            <select value={type} aria-label="Order type" onChange={(e) => setType(e.target.value as OrderType)}>
              <option value="market">Market</option>
              <option value="limit">Limit</option>
              <option value="stop">Stop</option>
              <option value="stop-limit">Stop limit</option>
            </select>
            <input
              type="number"
              value={quantity}
              placeholder="quantity"
              aria-label="Quantity"
              min={0}
              step="any"
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>

          {(type === 'limit' || type === 'stop-limit') && (
            <label className="mk-inline">
              <span>Limit</span>
              <input type="number" value={limitPrice} step="any" onChange={(e) => setLimitPrice(e.target.value)} />
            </label>
          )}
          {(type === 'stop' || type === 'stop-limit') && (
            <label className="mk-inline">
              <span>Stop</span>
              <input type="number" value={stopPrice} step="any" onChange={(e) => setStopPrice(e.target.value)} />
            </label>
          )}

          {/* What it would cost, from the price that is actually on screen. */}
          {target && Number(quantity) > 0 && (
            <p className="mk-quiet">
              {(() => {
                const price = type === 'limit' || type === 'stop-limit' ? Number(limitPrice) : priceOf(target.instrumentId)
                if (!Number.isFinite(price) || !price) return 'No price for this yet, so nothing can be estimated.'
                const gross = price * Number(quantity)
                const fee = gross * (state.state?.settings.feeRate ?? 0)
                return `About ${money(gross + (side === 'buy' ? fee : -fee), currency)} including ${money(fee, currency)} of simulated fees.`
              })()}
            </p>
          )}

          <button
            type="button"
            className="queue-btn small"
            disabled={busy || !target || !(Number(quantity) > 0)}
            onClick={() => {
              if (!target) return
              void run(() =>
                window.api.marketsPaperOrder({
                  instrumentId: target.instrumentId,
                  side,
                  type,
                  quantity: Number(quantity),
                  limitPrice: Number(limitPrice) > 0 ? Number(limitPrice) : undefined,
                  stopPrice: Number(stopPrice) > 0 ? Number(stopPrice) : undefined
                })
              ).then((got) => {
                const outcome = (got as { outcome?: { detail: string; state: string } } | null)?.outcome
                if (outcome) {
                  // The engine's own words, including when it refused: a rejection has a reason and it is worth reading.
                  onNotify(outcome.detail, outcome.state === 'rejected' ? 'error' : undefined)
                  if (outcome.state !== 'rejected') setQuantity('')
                }
              })
            }}
          >
            Place simulated {side}
          </button>
        </div>

        {/* ------------------------------------------------------------ holdings and history */}
        <div className="mk-pf-main">
          <h4>Holdings</h4>
          {view.allocation.positions.length === 0 ? (
            <div className="mk-empty-small">
              <p>Nothing held.</p>
              <p className="pw-note is-quiet">A simulated buy will show up here.</p>
            </div>
          ) : (
            <div className="mk-table-wrap">
              <table className="mk-table">
                <thead>
                  <tr>
                    <th>Market</th>
                    <th>Quantity</th>
                    <th>Average</th>
                    <th>Price</th>
                    <th>Value</th>
                    <th>Unrealised</th>
                    <th>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {view.allocation.positions.map((one) => (
                    <tr key={one.instrumentId}>
                      <td>
                        <button type="button" className="mk-row-name" onClick={() => onOpenMarket(one.instrumentId)}>
                          <AssetLogo symbol={symbolOf(one.instrumentId)} size="small" />
                          <b>{symbolOf(one.instrumentId)}</b>
                          {one.quantity < 0 && <span className="mk-name">short</span>}
                        </button>
                      </td>
                      <td>{coins(one.quantity)}</td>
                      <td>{money(one.averagePrice)}</td>
                      {/* A holding nobody can price says so rather than showing its purchase price as though it were current. */}
                      <td>{one.price === null ? <span className="mk-quiet">no price</span> : money(one.price)}</td>
                      <td>{money(one.value, currency)}</td>
                      <td className={`mk-change ${way(one.unrealised)}`}>
                        {money(one.unrealised, currency)}{' '}
                        <small>{one.unrealisedPercent === null ? '' : percent(one.unrealisedPercent)}</small>
                      </td>
                      <td>{one.share === null ? '—' : percent(one.share, 1)}</td>
                    </tr>
                  ))}
                  <tr className="mk-cash-row">
                    <td colSpan={4}>Cash</td>
                    <td>{money(view.allocation.cash, currency)}</td>
                    <td />
                    <td>{view.allocation.cashShare === null ? '—' : percent(view.allocation.cashShare, 1)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          <h4>How it has gone</h4>
          <div className="mk-pf-stats">
            <span>
              Completed trades <b>{view.performance.trades}</b>
            </span>
            <span>
              Win rate <b>{view.performance.winRate === null ? '—' : percent(view.performance.winRate, 0)}</b>
            </span>
            <span>
              {/* Coloured only when there is a figure: a green dash reads as a win that is not there. */}
              Average win{' '}
              <b className={view.performance.averageWin === null ? '' : 'mk-change up'}>
                {money(view.performance.averageWin, currency)}
              </b>
            </span>
            <span>
              Average loss{' '}
              <b className={view.performance.averageLoss === null ? '' : 'mk-change down'}>
                {money(view.performance.averageLoss, currency)}
              </b>
            </span>
            <span title="Gross winnings over gross losses. Unavailable when nothing has been lost.">
              Profit factor <b>{ratio(view.performance.profitFactor)}</b>
            </span>
            <span title="The average outcome of a completed trade">
              Expectancy <b className={`mk-change ${way(view.performance.expectancy)}`}>{money(view.performance.expectancy, currency)}</b>
            </span>
            <span>
              Median hold <b>{duration(view.performance.medianHoldingMs)}</b>
            </span>
            <span title="The worst peak-to-trough fall in the recorded equity">
              Max drawdown <b>{view.equity.drawdown.maxPercent === 0 ? '0%' : `−${view.equity.drawdown.maxPercent.toFixed(2)}%`}</b>
            </span>
            <span title="From the recorded equity readings. Unavailable until there are enough of them, or when the equity has not moved.">
              Sharpe <b>{ratio(view.equity.sharpe)}</b>
            </span>
            <span>
              Sortino <b>{ratio(view.equity.sortino)}</b>
            </span>
          </div>
          <p className="mk-quiet">
            {equity.length < 3
              ? `Risk figures need more readings: ${equity.length} recorded so far. They are taken while Orbis is running.`
              : `From ${equity.length} equity readings over ${duration(view.equity.coveredMs)} of running time. Simulated history is not a forecast.`}
          </p>

          {pending.length > 0 && (
            <>
              <h4>Waiting orders</h4>
              <ul className="mk-rows">
                {pending.map((order: PaperOrder) => (
                  <li key={order.id} className="mk-row">
                    <button type="button" className="mk-row-name" onClick={() => onOpenMarket(order.instrumentId)}>
                      <b>{symbolOf(order.instrumentId)}</b>
                      <span className="mk-name">
                        {order.side} {order.quantity} {order.type}
                        {order.limitPrice ? ` at ${money(order.limitPrice)}` : ''}
                        {order.stopPrice ? ` stop ${money(order.stopPrice)}` : ''}
                      </span>
                    </button>
                    <span className="mk-quiet">{new Date(order.placedAt).toLocaleTimeString()}</span>
                    <button
                      type="button"
                      className="tl-icon"
                      aria-label="Cancel this order"
                      onClick={() => void run(() => window.api.marketsPaperCancel(order.id))}
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          <h4>Completed trades</h4>
          {view.trips.length === 0 ? (
            <p className="mk-quiet">
              Nothing has gone round yet. A trade is counted when a position is opened and carried back to flat — an open
              position is not a result.
            </p>
          ) : (
            <div className="mk-table-wrap">
              <table className="mk-table">
                <thead>
                  <tr>
                    <th>Market</th>
                    <th>Direction</th>
                    <th>Quantity</th>
                    <th>In</th>
                    <th>Out</th>
                    <th>Result</th>
                    <th>Held</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {[...view.trips].reverse().map((trip, i) => (
                    <tr key={`${trip.instrumentId}-${trip.closedAt}-${i}`}>
                      <td>
                        <button type="button" className="mk-row-name" onClick={() => onOpenMarket(trip.instrumentId)}>
                          <AssetLogo symbol={symbolOf(trip.instrumentId)} size="small" />
                          <b>{symbolOf(trip.instrumentId)}</b>
                        </button>
                      </td>
                      <td>{trip.direction}</td>
                      <td>{coins(trip.quantity)}</td>
                      <td>{money(trip.entryPrice)}</td>
                      <td>{money(trip.exitPrice)}</td>
                      <td className={`mk-change ${way(trip.net)}`}>
                        {money(trip.net, currency)} <small>{percent(trip.returnPercent)}</small>
                      </td>
                      <td>{duration(trip.holdingMs)}</td>
                      <td>
                        {/* Into the notes Orbis already has, not a journal of its own. */}
                        <button
                          type="button"
                          className="queue-btn tiny ghost"
                          title="Write this trade up in Notes"
                          onClick={() =>
                            void saveJournalNote(tradeNote(trip, symbolOf(trip.instrumentId), currency)).then(
                              () => onNotify('Written up in Notes'),
                              () => onNotify('That could not be saved to Notes.', 'error')
                            )
                          }
                        >
                          <NotebookPen size={11} /> Journal
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {recent.length > 0 && (
            <>
              <h4>Order history</h4>
              <ul className="mk-rows">
                {recent.map((order) => (
                  <li key={order.id} className={`mk-row mk-order is-${order.state}`}>
                    <span className="mk-row-name">
                      <b>{symbolOf(order.instrumentId)}</b>
                      <span className="mk-name">
                        {order.side} {order.quantity} {order.type}
                      </span>
                    </span>
                    <span className="mk-quiet">{order.state}</span>
                    <span className="mk-price">
                      {order.filledPrice ? money(order.filledPrice) : ''}
                      {order.fee ? <small> fee {money(order.fee)}</small> : null}
                    </span>
                    {/* A refusal keeps its reason: it is the most useful thing about it. */}
                    {order.reason && <span className="mk-quiet">{order.reason}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}

          <p className="mk-quiet mk-footnote">
            Simulated results describe what these rules would have done against the prices that arrived. They are not a
            forecast, and they do not account for anything the assumptions above leave out — including the effect a real
            order of this size would have had on the market.
          </p>
        </div>
      </div>
    </div>
  )
}
