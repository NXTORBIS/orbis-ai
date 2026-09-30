import { useCallback, useEffect, useRef, useState } from 'react'
import { Activity, Plus, RefreshCw, Search, Trash2, TrendingDown, TrendingUp } from 'lucide-react'
import type { MarketsState } from '../../../main/markets/ipc'
import type { Instrument } from '../../../shared/markets/instrument'
import { TICKER_FIELDS, type TickerField, TICKER_SLOTS } from '../../../shared/markets/workspace'
import ExperienceSettings from './markets/ExperienceSettings'

/**
 * Markets, in Settings.
 *
 * The switch for the strip along the bottom of the browser, and the list of what it shows. Everything here is a real
 * setting with a real effect: turning it on makes the strip appear, adding an asset makes a price arrive, and the state
 * shown is the state the main process holds rather than anything this file remembers.
 *
 * Nothing is drawn that is not real. An asset with no price says so; a provider that needs a key says so; the freshness of
 * every number is shown next to it. There is no sample row anywhere in this file.
 */

const refused = (value: unknown): value is { error: string; message?: string } =>
  typeof value === 'object' && value !== null && typeof (value as { error?: unknown }).error === 'string'

const FIELD_LABEL: Record<TickerField, string> = {
  price: 'Price',
  change: 'Change',
  changePercent: 'Change %',
  volume: 'Volume',
  marketStatus: 'Market status'
}

const fmt = (value: number | null, currency: string): string => {
  if (value === null || !Number.isFinite(value)) return '—'
  const digits = Math.abs(value) >= 1000 ? 2 : Math.abs(value) >= 1 ? 2 : Math.abs(value) >= 0.01 ? 4 : 8
  try {
    return new Intl.NumberFormat(undefined, {
      style: currency ? 'currency' : 'decimal',
      currency: currency || undefined,
      minimumFractionDigits: Math.min(2, digits),
      maximumFractionDigits: digits
    }).format(value)
  } catch {
    return value.toFixed(digits)
  }
}

export default function MarketsSettings(): React.JSX.Element {
  const [state, setState] = useState<MarketsState | null>(null)
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Instrument[]>([])
  const [searching, setSearching] = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const take = (answer: unknown): void => {
    if (refused(answer)) setProblem(answer.message ?? 'That did not work.')
    else {
      setState(answer as MarketsState)
      setProblem('')
    }
  }

  const read = useCallback(async () => {
    take(await window.api.marketsState())
  }, [])

  useEffect(() => {
    void read()
  }, [read])

  // Prices arrive as they change, so what is shown here is what the strip shows.
  useEffect(() => {
    const timer = setInterval(() => void read(), 5000)
    return () => clearInterval(timer)
  }, [read])

  const run = async (call: () => Promise<unknown>): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      take(await call())
    } finally {
      setBusy(false)
    }
  }

  /** Searching is debounced, so typing does not ask a provider per keystroke. */
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    const wanted = query.trim()
    if (wanted.length < 2) {
      setResults([])
      return
    }
    searchTimer.current = setTimeout(() => {
      setSearching(true)
      void window.api
        .marketsSearch(wanted)
        .then((answer) => {
          if (refused(answer)) setResults([])
          else setResults(answer.results)
        })
        .finally(() => setSearching(false))
    }, 300)
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
    }
  }, [query])

  const on = state?.enabled === true
  const ticker = state?.ticker ?? null
  const items = state?.tickerItems ?? []
  const group = ticker?.groups.find((g) => g.id === ticker.activeGroupId) ?? ticker?.groups[0] ?? null

  const save = (over: Record<string, unknown>): Promise<void> =>
    run(() => window.api.marketsSetTicker({ ...(ticker ?? {}), ...over }))

  return (
    <section className="setting tl">
      <div className="setting-label">
        <h3>Markets</h3>
        <p>
          A market strip along the bottom of Orbis and along the bottom of the browser. Crypto prices come from
          Binance&apos;s public feed and are live; stocks need a provider with a licence, and until one is connected they
          say so rather than showing a number.
        </p>
      </div>

      <div className="pw-panel">
        <p className="pw-state">
          <Activity size={15} />
          <span>
            {!state
              ? 'Reading…'
              : !on
                ? 'Markets is off. Nothing is being subscribed to, and everything below is still saved.'
                : ticker?.enabled
                  ? `On — ${items.length} asset${items.length === 1 ? '' : 's'}, ${state.connection}`
                  : 'Markets is on. The ticker is off.'}
          </span>
        </p>

        {problem && (
          <p className="pw-note" role="alert">
            {problem}
          </p>
        )}

        {/* The master switch. Off means no market subscriptions anywhere, and no choices lost. */}
        <label className="tl-switch">
          <input
            type="checkbox"
            checked={on}
            disabled={busy || !state}
            onChange={(e) => void run(() => window.api.marketsSetEnabled(e.target.checked))}
          />
          <span>Markets</span>
        </label>

        {on && (
          <label className="tl-switch">
            <input
              type="checkbox"
              checked={ticker?.enabled === true}
              disabled={busy || !state}
              onChange={(e) => void save({ enabled: e.target.checked })}
            />
            <span>Show the market strip along the bottom</span>
          </label>
        )}

        {on && ticker?.enabled && (
          <>
            {/* ---------------------------------------------------------------- what it shows */}
            <div className="tl-block">
              <h4>What it shows</h4>
              {group && ticker.groups.length > 1 && (
                <label className="tl-delay">
                  <span>Group</span>
                  <select
                    value={group.id}
                    disabled={busy}
                    onChange={(e) => void run(() => window.api.marketsSetGroup(e.target.value))}
                  >
                    {ticker.groups.map((one) => (
                      <option key={one.id} value={one.id}>
                        {one.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {items.length === 0 ? (
                <p className="pw-note is-quiet">
                  Nothing chosen yet. Search below to add an asset — the ticker stays empty until you do rather than
                  showing examples.
                </p>
              ) : (
                <ul className="mk-rows">
                  {items.map(({ instrument, quote }) => {
                    const percent = quote?.changePercent ?? null
                    const way = percent === null ? 'flat' : percent > 0 ? 'up' : percent < 0 ? 'down' : 'flat'
                    return (
                      <li key={instrument.instrumentId} className="mk-row">
                        <b>{instrument.symbol}</b>
                        <span className="mk-name">{instrument.name}</span>
                        <span className="mk-price">{fmt(quote?.last ?? null, instrument.currency)}</span>
                        <span className={`mk-change ${way}`}>
                          {percent === null ? (
                            '—'
                          ) : (
                            <>
                              {way === 'up' ? <TrendingUp size={12} /> : way === 'down' ? <TrendingDown size={12} /> : null}
                              {percent > 0 ? '+' : ''}
                              {percent.toFixed(2)}%
                            </>
                          )}
                        </span>
                        {/* The freshness of this very number, beside it. */}
                        <span className={`mk-fresh is-${quote?.freshness ?? 'unavailable'}`}>
                          {quote?.freshness === 'real-time' ? 'Live' : (quote?.freshness ?? 'no price')}
                        </span>
                        <button
                          type="button"
                          className="tl-icon"
                          aria-label={`Remove ${instrument.symbol}`}
                          disabled={busy}
                          onClick={() => void run(() => window.api.marketsTickerRemove(instrument.instrumentId))}
                        >
                          <Trash2 size={14} />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}

              <button
                type="button"
                className="queue-btn small ghost"
                disabled={busy}
                onClick={() => void run(() => window.api.marketsRefresh())}
              >
                <RefreshCw size={13} /> Refresh prices
              </button>
            </div>

            {/* ---------------------------------------------------------------- adding one */}
            <div className="tl-block">
              <h4>Add an asset</h4>
              <div className="mk-search">
                <Search size={14} />
                <input
                  value={query}
                  placeholder="bitcoin, BTC, ETH…"
                  maxLength={60}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              {query.trim().length >= 2 && (
                <ul className="mk-results">
                  {searching && <li className="mk-quiet">Searching…</li>}
                  {!searching && results.length === 0 && (
                    <li className="mk-quiet">
                      Nothing found. Crypto is searchable now; stocks need a provider to be connected first.
                    </li>
                  )}
                  {results.map((instrument) => (
                    <li key={instrument.instrumentId}>
                      <b>{instrument.symbol}</b>
                      <span className="mk-name">{instrument.name}</span>
                      <span className="mk-venue">{instrument.exchange}</span>
                      <button
                        type="button"
                        className="queue-btn tiny"
                        disabled={busy}
                        onClick={() => {
                          setQuery('')
                          void run(() => window.api.marketsTickerAdd(instrument.instrumentId))
                        }}
                      >
                        <Plus size={12} /> Add
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* ---------------------------------------------------------------- how much of it */}
            <div className="tl-block">
              <h4>How much of it</h4>
              <label className="tl-delay">
                <span>Markets on the strip</span>
                <select
                  value={String(ticker.slots)}
                  disabled={busy}
                  onChange={(e) => void save({ slots: Number(e.target.value) })}
                >
                  {TICKER_SLOTS.map((count) => (
                    <option key={count} value={String(count)}>
                      {count}
                    </option>
                  ))}
                </select>
              </label>
              <label className="tl-switch">
                <input
                  type="checkbox"
                  checked={ticker.auto}
                  disabled={busy}
                  onChange={(e) => void save({ auto: e.target.checked })}
                />
                <span>Fill the rest for me</span>
              </label>
              <p className="pw-note is-quiet">
                {ticker.auto
                  ? 'The markets you have opened recently, newest first, then your watchlists, then the busiest markets for whatever is left. Anything you chose below stays first, and the strip says which ones Orbis filled in.'
                  : 'Only the markets you chose below. Choosing none leaves the strip empty rather than filling it with something you did not ask for.'}
              </p>
            </div>

            {/* ---------------------------------------------------------------- how it behaves */}
            <div className="tl-block">
              <h4>How it behaves</h4>
              <label className="tl-delay">
                <span>Height</span>
                <select value={ticker.size} disabled={busy} onChange={(e) => void save({ size: e.target.value })}>
                  <option value="compact">Compact</option>
                  <option value="normal">Normal</option>
                  <option value="expanded">Expanded</option>
                </select>
              </label>
              <label className="tl-delay">
                <span>Speed</span>
                <select value={String(ticker.speed)} disabled={busy} onChange={(e) => void save({ speed: Number(e.target.value) })}>
                  <option value="15">Slow</option>
                  <option value="40">Normal</option>
                  <option value="90">Fast</option>
                </select>
              </label>
              <label className="tl-delay">
                <span>Direction</span>
                <select value={ticker.direction} disabled={busy} onChange={(e) => void save({ direction: e.target.value })}>
                  <option value="left">Right to left</option>
                  <option value="right">Left to right</option>
                </select>
              </label>
              <label className="tl-switch">
                <input
                  type="checkbox"
                  checked={ticker.pauseOnHover}
                  disabled={busy}
                  onChange={(e) => void save({ pauseOnHover: e.target.checked })}
                />
                <span>Pause when the pointer is over it</span>
              </label>
              {/*
                Offered only when the system preference is actually set, because to anybody else it is a switch about
                nothing. Everything else in Orbis obeys that preference without asking; a ticker is the one place where
                obeying it silently makes the feature look broken instead of considerate, so here it is a choice.
              */}
              {typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches && (
                <>
                  <label className="tl-switch">
                    <input
                      type="checkbox"
                      checked={ticker.stillWhenReducedMotion}
                      disabled={busy}
                      onChange={(e) => void save({ stillWhenReducedMotion: e.target.checked })}
                    />
                    <span>Hold it still, because this computer reduces motion</span>
                  </label>
                  <p className="pw-note is-quiet">
                    This computer is set to reduce motion. The strip scrolls anyway, because a scrolling strip is what
                    you switched on. Holding it still shows the same prices without the movement — nothing is hidden by
                    not moving.
                  </p>
                </>
              )}

              <h4>Fields</h4>
              {TICKER_FIELDS.map((field) => (
                <label key={field} className="tl-switch">
                  <input
                    type="checkbox"
                    checked={ticker.fields.includes(field)}
                    disabled={busy}
                    onChange={(e) =>
                      void save({
                        fields: e.target.checked
                          ? [...ticker.fields, field]
                          : ticker.fields.filter((one) => one !== field)
                      })
                    }
                  />
                  <span>{FIELD_LABEL[field]}</span>
                </label>
              ))}
              <p className="pw-note is-quiet">
                In the browser the strip takes {state?.tickerHeight ?? 26} pixels from the bottom of the page rather than
                covering it, so nothing on a site is hidden behind it. In Orbis it floats over the bottom instead, because
                there is no site underneath it there — only Orbis&apos;s own screens. Hover it to reveal its controls,
                including the one that hides it.
              </p>
            </div>
          </>
        )}

        {/* ---------------------------------------------------------------- how Markets should behave */}
        <ExperienceSettings />

        {/* ---------------------------------------------------------------- where the data comes from */}
        <div className="tl-block">
          <h4>Where the data comes from</h4>
          {(state?.providers ?? []).length === 0 ? (
            <p className="pw-note is-quiet">No market data providers are set up.</p>
          ) : (
            <ul className="tl-explains">
              {(state?.providers ?? []).map((provider) => (
                <li key={provider.id}>
                  <b>{provider.name}</b> — {provider.configured ? (provider.detail || 'Ready.') : provider.detail}
                  {provider.configured && provider.capabilities.delayedByMs > 0 && (
                    <> Data is {Math.round(provider.capabilities.delayedByMs / 60_000)} minutes behind the market.</>
                  )}
                  {provider.subscriptions > 0 && <> Streaming {provider.subscriptions}.</>}
                </li>
              ))}
            </ul>
          )}
          <p className="pw-note is-quiet">
            Stocks and indices need a licensed feed. Until one is connected they are shown as unavailable rather than
            estimated.
          </p>
        </div>
      </div>
    </section>
  )
}
