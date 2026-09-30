import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, Pause, Play, Plus, Settings2, Sparkles, Trash2, X } from 'lucide-react'
import AssetLogo from './markets/AssetLogo'
import { assetOf } from '../../../shared/markets/assets'
import { TICKER_HEIGHTS, TICKER_SLOTS } from '../../../shared/markets/workspace'
import type { StripOrigin } from '../../../shared/markets/strip'
import type { Instrument, QuoteView } from '../../../shared/markets/instrument'

/**
 * The market strip along the bottom of the Orbis window.
 *
 * A band that belongs to the window rather than to Markets. It is mounted outside the screen switch, so it is there
 * while somebody is in a conversation, on a Page, in Notes or in the browser -- which is the point of it: a price is
 * something you want in the corner of your eye while doing something else, and a strip you have to open Markets to see
 * is a strip you will never look at.
 *
 * What it will not do:
 *
 * **It never shows a number it was not given.** No sample symbol, no placeholder price, no filler coin. An empty strip
 * means nothing is configured; a dash means the provider has no price for that market. Both are answers.
 *
 * **It never animates in React.** The rail is moved by writing one transform inside a frame callback. A component that
 * re-rendered sixty times a second to move a band along the bottom of the screen would cost more than everything above
 * it put together, so the position lives in a ref and never in state.
 *
 * **It stops when nobody can see it.** Switched off, the frame loop is cancelled and the subscriptions are released, so
 * a strip that is off costs nothing rather than streaming quietly behind whatever is on screen.
 */

interface StripItem {
  instrument: Instrument
  quote: QuoteView | null
  origin: StripOrigin
}

interface StripConfig {
  groupName: string
  speed: number
  direction: string
  pauseOnHover: boolean
  fields: string[]
  height: number
  enabled: boolean
  slots: number
  auto: boolean
  stillWhenReducedMotion: boolean
}

const refused = (value: unknown): value is { error: string; message?: string } =>
  typeof value === 'object' && value !== null && typeof (value as { error?: unknown }).error === 'string'

/** A price with as many decimals as it deserves. A token at 0.000018 and an index at 24,832 cannot share a format. */
function money(value: number | null | undefined, currency: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const size = Math.abs(value)
  const digits = size >= 1000 ? 2 : size >= 1 ? 2 : size >= 0.01 ? 4 : 8
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

function percent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return ''
  const arrow = value > 0 ? '▲' : value < 0 ? '▼' : '■'
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${arrow} ${sign}${Math.abs(value).toFixed(2)}%`
}

const wayOf = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(value)
    ? 'flat'
    : value > 0
      ? 'up'
      : value < 0
        ? 'down'
        : 'flat'

/** Why a market is on the rail, in words somebody would use. */
const ORIGIN_WORDS: Record<StripOrigin, string> = {
  chosen: 'You put this on the strip',
  viewed: 'You opened this recently',
  watched: 'On one of your watchlists',
  busiest: 'One of the busiest markets, filling a space you have not chosen for'
}

export interface MarketStripProps {
  /** True while the strip should be out of the way entirely: a lock screen, the welcome screen, a modal that owns the window. */
  suppressed?: boolean
}

export default function MarketStrip({ suppressed = false }: MarketStripProps): React.JSX.Element | null {
  const [config, setConfig] = useState<StripConfig | null>(null)
  const [items, setItems] = useState<StripItem[]>([])
  const [connection, setConnection] = useState('')
  const [hovering, setHovering] = useState(false)
  const [paused, setPaused] = useState(false)
  const [tuning, setTuning] = useState(false)

  const viewport = useRef<HTMLDivElement | null>(null)
  const rail = useRef<HTMLDivElement | null>(null)
  const run = useRef<HTMLDivElement | null>(null)
  /**
   * How many times the items are repeated along the rail.
   *
   * Two was not enough. A loop needs one full copy to have gone past the left edge before it can reset, so the rail has
   * to be wider than the window -- and four coins on a wide screen are not, which meant the strip held perfectly still
   * and looked broken. So the items repeat as many times as it takes to cover the window and then once more, which is
   * what lets four coins scroll continuously just as forty do.
   */
  const [copies, setCopies] = useState(2)
  const offset = useRef(0)
  const lastFrame = useRef(0)
  const frame = useRef(0)
  /** Read inside the frame callback, so changing any of it does not restart the loop. */
  const live = useRef({ speed: 40, direction: 'left', pauseOnHover: true, hovering: false, paused: false })

  const enabled = config?.enabled === true
  const showing = enabled && !suppressed
  const height = config?.height ?? TICKER_HEIGHTS.compact

  // ---------------------------------------------------------------- what it draws

  const load = useCallback(async () => {
    const answer = await window.api.marketsStrip()
    if (refused(answer)) {
      // A strip that cannot be read draws nothing rather than the last thing it knew, which would be a stale price
      // presented as a current one.
      setItems([])
      setConnection('')
      return
    }
    setConfig(answer.config)
    setItems(answer.items)
    setConnection(answer.connection)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * Re-reading, for the things a price tick cannot carry.
   *
   * A market added elsewhere, a group switched in Settings, a coin newly opened that auto mode should now include. The
   * prices themselves do not come from here: they arrive on the tick stream below, as fast as the exchange sends them.
   */
  useEffect(() => {
    if (!showing) return
    const timer = window.setInterval(() => void load(), 20_000)
    return () => window.clearInterval(timer)
  }, [showing, load])

  /**
   * The strip switched off somewhere else.
   *
   * One setting, two strips. Closing the band along the bottom of the browser has to reach this one, or the two would
   * disagree about whether the strip exists until something else happened to re-read the setting.
   */
  useEffect(() => window.api.onMarketsStripChanged(() => void load()), [load])

  /** Prices, as they happen. Only the rows that ticked are replaced. */
  useEffect(() => {
    if (!showing) return
    return window.api.onMarketsTick((events) => {
      if (!Array.isArray(events) || events.length === 0) return
      const fresh = new Map<string, QuoteView>()
      for (const one of events) {
        const event = one as { type?: string; instrumentId?: string; quote?: QuoteView }
        if (event.type !== 'quote' || typeof event.instrumentId !== 'string' || !event.quote) continue
        fresh.set(event.instrumentId, event.quote)
      }
      if (fresh.size === 0) return
      setItems((current) => {
        let changed = false
        const next = current.map((row) => {
          const quote = fresh.get(row.instrument.instrumentId)
          if (!quote || quote === row.quote) return row
          changed = true
          return { ...row, quote }
        })
        return changed ? next : current
      })
    })
  }, [showing])

  /** Enough copies to be wider than the window. Re-measured when the items change and when the window resizes. */
  useEffect(() => {
    if (!showing) return
    const measure = (): void => {
      const one = run.current?.scrollWidth ?? 0
      const across = viewport.current?.clientWidth ?? 0
      if (one <= 0 || across <= 0) return
      // One copy to fill the window, one more to loop into, and never fewer than two.
      const wanted = Math.max(2, Math.ceil(across / one) + 1)
      // Bounded, so a single narrow item on a very wide screen cannot ask for hundreds of copies.
      setCopies((current) => (current === Math.min(wanted, 40) ? current : Math.min(wanted, 40)))
    }
    /**
     * Measured in a frame rather than straight away.
     *
     * The rail's width is only true once the logos have taken their boxes and the fonts have settled; measuring in the
     * same tick as the render read a narrower rail and asked for too few copies, which is how the strip ended up with
     * two copies that together did not cover the window and so could never loop.
     */
    const soon = requestAnimationFrame(measure)
    const watcher = new ResizeObserver(measure)
    if (viewport.current) watcher.observe(viewport.current)
    if (run.current) watcher.observe(run.current)
    return () => {
      cancelAnimationFrame(soon)
      watcher.disconnect()
    }
  }, [showing, items.length, copies])

  /**
   * Telling the rest of the window how much room to leave.
   *
   * The strip takes its height rather than covering what is underneath: floating over it put the band straight across
   * the account chip at the foot of the sidebar, cutting the name and the help button in half. Written as a variable on
   * the document so one number reaches every part of the layout, and removed entirely when there is no strip, so a
   * window without one is exactly the window it was before.
   */
  useEffect(() => {
    const root = document.documentElement
    if (!showing) {
      root.style.removeProperty('--mstrip-reserved')
      return
    }
    root.style.setProperty('--mstrip-reserved', `${height}px`)
    return () => {
      root.style.removeProperty('--mstrip-reserved')
    }
  }, [showing, height])

  // ---------------------------------------------------------------- the moving part

  live.current = {
    speed: config?.speed ?? 40,
    direction: config?.direction ?? 'left',
    pauseOnHover: config?.pauseOnHover !== false,
    hovering,
    paused
  }

  /**
   * One transform, on one rail, driven by one frame callback.
   *
   * The rail holds every item twice over, so once the first copy has gone past the left edge the offset resets to zero
   * with the second copy exactly where the first was. That is what makes the loop seamless rather than a jump back to
   * the start, and it is why the reset distance is half the rail and not the whole of it.
   */
  useEffect(() => {
    if (!showing) {
      if (frame.current) cancelAnimationFrame(frame.current)
      frame.current = 0
      return
    }
    /**
     * The system's "reduce motion" setting, honoured only if that was asked for.
     *
     * Everything else in Orbis obeys it without asking, because it exists for people who are made unwell by movement.
     * A ticker is the one genuinely ambiguous case: switching on a scrolling strip and choosing its speed and direction
     * is asking for something that moves, and obeying the preference there makes the strip look broken rather than
     * considerate. So it is a switch, sitting next to the speed, and it is off by default.
     */
    if (config?.stillWhenReducedMotion && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // Held still, with the same prices. A strip that does not move is still a complete strip.
      if (rail.current) rail.current.style.transform = 'translate3d(0,0,0)'
      return
    }

    const step = (now: number): void => {
      frame.current = requestAnimationFrame(step)
      const previous = lastFrame.current || now
      lastFrame.current = now
      const node = rail.current
      if (!node) return

      const { speed, direction, pauseOnHover, hovering: over, paused: held } = live.current
      if (held || (pauseOnHover && over)) return

      /**
       * The wrap distance is one copy of the items, whatever the rail is made of.
       *
       * Once the rail has moved exactly one copy's width, the next copy is sitting precisely where that one started, so
       * resetting to zero there is invisible. Measuring the copy rather than halving the rail is what lets the number of
       * copies change with the window without the loop developing a jump.
       */
      const lap = run.current?.scrollWidth ?? 0
      if (lap <= 1) {
        // Nothing measured yet. Held at the start rather than moved by a guess.
        node.style.transform = 'translate3d(0,0,0)'
        return
      }

      // Capped, so a frame the machine skipped does not teleport the rail along itself.
      const seconds = Math.min(0.25, (now - previous) / 1000)
      offset.current += speed * seconds * (direction === 'right' ? -1 : 1)
      if (offset.current >= lap) offset.current -= lap
      if (offset.current < 0) offset.current += lap
      node.style.transform = `translate3d(${-offset.current}px,0,0)`
    }

    frame.current = requestAnimationFrame(step)
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current)
      frame.current = 0
      lastFrame.current = 0
    }
  }, [showing, items.length, copies, config?.stillWhenReducedMotion])

  // ---------------------------------------------------------------- what somebody does to it

  const close = useCallback(async () => {
    setTuning(false)
    const answer = await window.api.marketsStripEnabled(false)
    if (refused(answer)) return
    setConfig((current) => (current ? { ...current, enabled: false } : current))
  }, [])

  const change = useCallback(
    async (patch: {
      slots?: number
      auto?: boolean
      size?: 'compact' | 'normal' | 'expanded'
      stillWhenReducedMotion?: boolean
    }) => {
      const answer = await window.api.marketsSetTicker(patch)
      if (refused(answer)) return
      await load()
    },
    [load]
  )

  if (!showing) return null

  const sparse = items.length > 0 && items.length < 4
  const state =
    connection === 'connected' || connection === 'live'
      ? 'live'
      : connection === 'delayed' || connection === 'reconnecting'
        ? 'delayed'
        : 'down'

  return (
    <div
      className={`mstrip${hovering ? ' is-hovered' : ''}${tuning ? ' is-tuning' : ''}`}
      style={{ ['--mstrip-height' as string]: `${height}px` }}
      onPointerEnter={() => setHovering(true)}
      onPointerLeave={() => setHovering(false)}
    >
      {tuning && (
        <StripSettings config={config} items={items} onChange={change} onReload={load} onDone={() => setTuning(false)} />
      )}

      <div className="mstrip-bar">
        <div className="mstrip-viewport" ref={viewport} role="marquee" aria-live="off">
          {items.length === 0 ? (
            <p className="mstrip-none">
              Nothing on the strip yet.{' '}
              <button type="button" className="mstrip-link" onClick={() => setTuning(true)}>
                Choose markets
              </button>
            </p>
          ) : (
            <div className="mstrip-rail" ref={rail} aria-hidden="true">
              {/*
                Repeated, deliberately: each copy is what the one before it loops into, and there are as many as it takes
                to be wider than the window. Hidden from a screen reader entirely, because the same items are listed once
                below for anybody reading rather than glancing.
              */}
              {Array.from({ length: copies }, (_unused, copy) => (
                <div className="mstrip-run" key={copy} ref={copy === 0 ? run : undefined}>
                  {items.map((row) => (
                    <StripRow key={`${copy}:${row.instrument.instrumentId}`} row={row} />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* The same prices, once, for a screen reader. Not a second copy of the data: the same rows, not moving. */}
        <ul className="mstrip-static">
          {items.map((row) => (
            <li key={row.instrument.instrumentId}>
              {assetOf(row.instrument).name} {money(row.quote?.last, row.instrument.currency)}{' '}
              {percent(row.quote?.changePercent)}
            </li>
          ))}
        </ul>

        {/*
          The tools appear on hover, which is the whole specification for the close button: a permanent close control on
          a band meant to be glanced at would be the most prominent thing on it.
        */}
        <div className="mstrip-tools">
          {sparse && <span className="mstrip-hint">Add more markets to keep it moving</span>}
          <span className={`mstrip-state is-${state}`}>
            {state === 'live'
              ? 'Live'
              : connection === 'delayed'
                ? 'Delayed'
                : connection === 'reconnecting'
                  ? 'Reconnecting'
                  : connection === ''
                    ? 'No market data'
                    : 'Disconnected'}
          </span>
          <button
            type="button"
            className="mstrip-tool"
            aria-pressed={paused}
            title={paused ? 'Start the strip moving' : 'Hold the strip still'}
            onClick={() => setPaused(!paused)}
          >
            {paused ? <Play size={12} /> : <Pause size={12} />}
          </button>
          <button
            type="button"
            className="mstrip-tool"
            aria-expanded={tuning}
            title="Choose what is on the strip"
            onClick={() => setTuning(!tuning)}
          >
            <Settings2 size={12} />
          </button>
          <button
            type="button"
            className="mstrip-tool mstrip-close"
            aria-label="Hide the market strip"
            title="Hide the strip"
            onClick={() => void close()}
          >
            <X size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}

/** One market on the rail. */
function StripRow({ row }: { row: StripItem }): React.JSX.Element {
  const asset = assetOf(row.instrument)
  const change = row.quote?.changePercent ?? null
  const freshness = row.quote?.freshness ?? 'unavailable'
  return (
    <span
      className={`mstrip-item${freshness === 'delayed' ? ' is-delayed' : ''}${freshness === 'stale' ? ' is-stale' : ''}`}
      title={`${asset.name} · ${ORIGIN_WORDS[row.origin]}`}
    >
      <AssetLogo instrument={row.instrument} size="tiny" />
      <b>{asset.symbol}</b>
      <span className="mstrip-price">{money(row.quote?.last, row.instrument.currency)}</span>
      <span className={`mstrip-change ${wayOf(change)}`}>{percent(change)}</span>
      {(freshness === 'delayed' || freshness === 'stale') && <small>{freshness}</small>}
    </span>
  )
}

/**
 * Choosing what is on the strip, and how much of it.
 *
 * Above the band rather than in a modal, because every choice here changes the band and somebody should be able to see
 * that happen.
 */
function StripSettings({
  config,
  items,
  onChange,
  onReload,
  onDone
}: {
  config: StripConfig | null
  items: StripItem[]
  onChange: (patch: {
    slots?: number
    auto?: boolean
    size?: 'compact' | 'normal' | 'expanded'
    stillWhenReducedMotion?: boolean
  }) => Promise<void>
  onReload: () => Promise<void>
  onDone: () => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<Instrument[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    const wanted = query.trim()
    if (wanted.length < 2) {
      setFound([])
      setSearching(false)
      return
    }
    let dropped = false
    setSearching(true)
    const timer = window.setTimeout(() => {
      void window.api.marketsSearch(wanted).then((answer) => {
        if (dropped) return
        setSearching(false)
        setFound(refused(answer) ? [] : answer.results.slice(0, 10))
      })
    }, 220)
    return () => {
      dropped = true
      window.clearTimeout(timer)
    }
  }, [query])

  const add = async (instrumentId: string): Promise<void> => {
    await window.api.marketsTickerAdd(instrumentId)
    setQuery('')
    setFound([])
    await onReload()
  }

  const remove = async (instrumentId: string): Promise<void> => {
    await window.api.marketsTickerRemove(instrumentId)
    await onReload()
  }

  return (
    <div className="mstrip-panel">
      <div className="mstrip-panel-head">
        <b>Market strip</b>
        <button type="button" className="mstrip-tool" aria-label="Done" title="Done" onClick={onDone}>
          <ChevronDown size={13} />
        </button>
      </div>

      <div className="mstrip-row">
        <span className="mstrip-row-label">How many</span>
        <div className="mstrip-slots">
          {TICKER_SLOTS.map((count) => (
            <button
              type="button"
              key={count}
              className="mstrip-chip"
              aria-pressed={config?.slots === count}
              onClick={() => void onChange({ slots: count })}
            >
              {count}
            </button>
          ))}
        </div>
      </div>

      <div className="mstrip-row">
        <span className="mstrip-row-label">Height</span>
        <div className="mstrip-slots">
          {(['compact', 'normal', 'expanded'] as const).map((size) => (
            <button
              type="button"
              key={size}
              className="mstrip-chip"
              aria-pressed={config?.height === TICKER_HEIGHTS[size]}
              onClick={() => void onChange({ size })}
            >
              {size === 'compact' ? 'Slim' : size === 'normal' ? 'Normal' : 'Tall'}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        className="mstrip-auto"
        aria-pressed={config?.auto === true}
        onClick={() => void onChange({ auto: config?.auto !== true })}
      >
        <Sparkles size={13} />
        <span>
          <b>Fill it for me</b>
          <small>
            The markets you have opened recently, newest first, then your watchlists, then the busiest markets to fill
            what is left. Anything you chose yourself stays first, and anything Orbis filled in says so.
          </small>
        </span>
      </button>

      {/*
        Offered only when the system preference is actually set, because to anybody else it is a switch about nothing.
      */}
      {typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches && (
        <button
          type="button"
          className="mstrip-auto"
          aria-pressed={config?.stillWhenReducedMotion === true}
          onClick={() => void onChange({ stillWhenReducedMotion: config?.stillWhenReducedMotion !== true })}
        >
          <Pause size={13} />
          <span>
            <b>Hold it still</b>
            <small>
              This computer is set to reduce motion. The strip scrolls anyway, because a scrolling strip is what you
              switched on — turn this on to keep the same prices without the movement.
            </small>
          </span>
        </button>
      )}

      <div className="mstrip-add">
        <Plus size={13} />
        <input
          type="search"
          value={query}
          placeholder="Add a market by name or code"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {found.length > 0 && (
        <ul className="mstrip-found">
          {found.map((one) => (
            <li key={one.instrumentId}>
              <button type="button" onClick={() => void add(one.instrumentId)}>
                <AssetLogo instrument={one} size="tiny" />
                <b>{assetOf(one).name}</b>
                {one.name !== assetOf(one).name && <span className="mstrip-code">{one.name}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {searching && found.length === 0 && <p className="mstrip-searching">Looking…</p>}

      {items.length > 0 && (
        <ul className="mstrip-chosen">
          {items.map((row) => (
            <li key={row.instrument.instrumentId}>
              <AssetLogo instrument={row.instrument} size="tiny" />
              <b>{assetOf(row.instrument).symbol}</b>
              {/* Where it came from, so "why is this on my strip" always has an answer. */}
              <span className={`mstrip-origin is-${row.origin}`}>
                {row.origin === 'chosen'
                  ? 'chosen'
                  : row.origin === 'viewed'
                    ? 'opened'
                    : row.origin === 'watched'
                      ? 'watchlist'
                      : 'busiest'}
              </span>
              {row.origin === 'chosen' && (
                <button
                  type="button"
                  className="mstrip-tool"
                  aria-label={`Take ${assetOf(row.instrument).symbol} off the strip`}
                  title={`Take ${assetOf(row.instrument).symbol} off the strip`}
                  onClick={() => void remove(row.instrument.instrumentId)}
                >
                  <Trash2 size={12} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
