import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Layers } from 'lucide-react'
import {
  aggregateLevels,
  BOOK_DEPTHS,
  cumulative,
  gridsFor,
  imbalance,
  touchOf,
  type BookView
} from '../../../../shared/markets/orderbook'
import type { BookAnswer } from '../../../../main/markets/ipc'
import { Explain, Introduce } from './Explain'
import type { ExperienceState } from './useExperience'
import type { CurrencyState } from './useCurrency'

/**
 * The order book.
 *
 * The thing this panel is built around: **a book that cannot prove it is continuous is never shown as current.** An
 * incremental depth stream is a stream of changes, and one missed message makes every level quietly wrong while the
 * screen looks entirely normal. So the engine's keeper checks the sequence on every update, and when continuity breaks
 * this panel says so and dims the levels until a fresh snapshot lands.
 *
 * Everything derived — cumulative depth, the bars, the imbalance, the aggregation — is computed here from the one book
 * the engine holds, using the same shared functions the tests cover. Nothing is stored twice, so no figure can drift
 * from the levels it is supposed to describe.
 *
 * Auto-centring is a mode, not a behaviour that fights the reader. Scrolling into the depth pauses it, because a ladder
 * that yanks itself back to the touch every hundred milliseconds cannot be read.
 */

const refused = (value: unknown): value is { error: string; message?: string } =>
  typeof value === 'object' && value !== null && typeof (value as { error?: unknown }).error === 'string'

const PROBLEM_TEXT: Record<string, string> = {
  gap: 'An update was missed, so this book is out of date. Reloading it from the exchange.',
  'out-of-order': 'Updates arrived out of order. Reloading the book from the exchange.',
  crossed: 'The book crossed itself, which cannot happen — reloading it from the exchange.',
  'no-snapshot': 'Waiting for the first snapshot from the exchange.'
}

/** How far either side of the mid the imbalance figure looks. A fraction, so it suits any market. */
const BANDS = [
  { id: 0.001, label: '0.1%' },
  { id: 0.005, label: '0.5%' },
  { id: 0.01, label: '1%' }
]

const quantity = (value: number | null | undefined): string => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  if (Math.abs(value) >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 1 })
  if (Math.abs(value) >= 1) return value.toFixed(3)
  return value.toFixed(6)
}

const percent = (value: number | null): string =>
  value === null || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(2)}%`

export default function BookPanel({
  instrumentId,
  available,
  experience,
  currency
}: {
  instrumentId: string
  /** Whether this instrument's own provider has a book at all. */
  available: boolean
  experience: ExperienceState
  currency: CurrencyState
}): React.JSX.Element {
  const [answer, setAnswer] = useState<BookAnswer | null>(null)
  const [note, setNote] = useState('')
  const [depth, setDepth] = useState(20)
  const [grid, setGrid] = useState(0)
  const [band, setBand] = useState(0.005)
  const [following, setFollowing] = useState(true)
  const [showDepthChart, setShowDepthChart] = useState(true)
  const ladder = useRef<HTMLDivElement | null>(null)

  // ---------------------------------------------------------------- following one book

  useEffect(() => {
    if (!available) return
    let stopped = false
    void window.api.marketsBookOpen(instrumentId, 100).then((got) => {
      if (stopped) return
      if (refused(got)) setNote(got.message ?? 'The order book could not be opened.')
      else {
        setAnswer(got)
        setNote('')
      }
    })
    return () => {
      stopped = true
      // The depth stream stops when the panel does: it is the heaviest subscription a venue offers.
      void window.api.marketsBookClose(instrumentId)
    }
  }, [instrumentId, available])

  const read = useCallback(async () => {
    const got = await window.api.marketsBook(instrumentId, 100)
    if (!refused(got)) setAnswer(got)
  }, [instrumentId])

  useEffect(() => {
    if (!available) return
    // Five times a second. The engine already holds the book, so this is a read of local state, not a request.
    const timer = globalThis.setInterval(() => void read(), 200)
    return () => globalThis.clearInterval(timer)
  }, [read, available])

  const book: BookView | null = answer?.book ?? null
  const touch = useMemo(() => (book ? touchOf(book) : null), [book])

  // A grid from the market's own price, once, so turning aggregation on does not shift the view.
  const grids = useMemo(() => gridsFor(touch?.mid ?? null), [touch?.mid])

  const shown = useMemo(() => {
    if (!book) return { bids: [], asks: [] }
    const bids = grid > 0 ? aggregateLevels(book.bids, grid, 'bid') : book.bids
    const asks = grid > 0 ? aggregateLevels(book.asks, grid, 'ask') : book.asks
    return { bids: bids.slice(0, depth), asks: asks.slice(0, depth) }
  }, [book, grid, depth])

  const bidDepth = useMemo(() => cumulative(shown.bids, touch?.mid ?? null), [shown.bids, touch?.mid])
  const askDepth = useMemo(() => cumulative(shown.asks, touch?.mid ?? null), [shown.asks, touch?.mid])
  const lean = useMemo(() => (book ? imbalance(book, band) : null), [book, band])

  /** The largest cumulative total on either side, so the bars are comparable between them. */
  const scale = useMemo(() => {
    const most = Math.max(
      bidDepth[bidDepth.length - 1]?.cumulativeSize ?? 0,
      askDepth[askDepth.length - 1]?.cumulativeSize ?? 0
    )
    return most > 0 ? most : 1
  }, [bidDepth, askDepth])

  useEffect(() => {
    if (following && ladder.current) ladder.current.scrollTop = 0
  }, [following, shown])

  if (!available) {
    return (
      <div className="mk-book">
        <div className="mk-empty-small">
          <p>This provider has no order book.</p>
        </div>
      </div>
    )
  }

  if (note) {
    return (
      <div className="mk-book">
        <div className="mk-empty-small">
          <p>{note}</p>
        </div>
      </div>
    )
  }

  const outOfDate = answer?.stale === true

  return (
    <div className="mk-book">
      {experience.get('bookGuidance') ? <Introduce term="orderBook" experience={experience} /> : null}

      {/*
        * The one thing this panel must never hide. A book whose stream broke continuity keeps its levels on screen,
        * because they were true a moment ago -- and says outright that they are no longer current.
        */}
      {outOfDate ? (
        <p className="mk-book-warning" role="status">
          <AlertTriangle size={13} />
          {PROBLEM_TEXT[book?.problem ?? 'gap'] ?? 'This book is out of date. Reloading it from the exchange.'}
        </p>
      ) : null}

      {/* ---------------------------------------------------------------- the touch */}
      <div className="mk-sub mk-book-touch">
        <span>
          Bid <b className="up">{currency.money(touch?.bid ?? null).text}</b>
        </span>
        <span>
          Ask <b className="down">{currency.money(touch?.ask ?? null).text}</b>
        </span>
        <span>
          Spread <Explain term="spread" experience={experience} label="the spread" />{' '}
          <b>
            {/* Null without both sides, and null for a crossed book: a negative spread is not a spread. */}
            {currency.money(touch?.spread ?? null).text}
            {touch?.spreadFraction !== null && touch?.spreadFraction !== undefined
              ? ` (${percent(touch.spreadFraction)})`
              : ''}
          </b>
        </span>
        <span>
          Mid <b>{currency.money(touch?.mid ?? null).text}</b>
        </span>
        {answer?.polled ? (
          // Honest about what kind of book this is: a polled snapshot is as fresh as the last read.
          <span className="mk-quiet">Polled snapshot</span>
        ) : null}
      </div>

      {/* ---------------------------------------------------------------- imbalance */}
      <div className="mk-book-lean">
        <span className="mk-quiet">
          Within
          <span className="mk-seg is-small">
            {BANDS.map((one) => (
              <button key={one.id} type="button" className={band === one.id ? 'on' : ''} onClick={() => setBand(one.id)}>
                {one.label}
              </button>
            ))}
          </span>
        </span>
        {lean?.bidShare === null || lean === null ? (
          <em className="mk-quiet">Nothing resting on one side in this range.</em>
        ) : (
          <>
            <span className="mk-pressure-bar" aria-hidden="true">
              <i className="up" style={{ flexGrow: Math.max(0.001, lean.bidShare ?? 0.5) }} />
              <i className="down" style={{ flexGrow: Math.max(0.001, 1 - (lean.bidShare ?? 0.5)) }} />
            </span>
            <span className="mk-pressure-figures">
              <b className="up">{currency.money(lean.bidNotional).text} bid</b>
              <b className="down">{currency.money(lean.askNotional).text} ask</b>
            </span>
          </>
        )}
      </div>

      {/* ---------------------------------------------------------------- controls */}
      <div className="mk-tape-bar">
        <div className="mk-seg is-small">
          {BOOK_DEPTHS.map((one) => (
            <button key={one} type="button" className={depth === one ? 'on' : ''} onClick={() => setDepth(one)}>
              {one}
            </button>
          ))}
        </div>

        {grids.length > 0 ? (
          <div className="mk-seg is-small" title="Group price levels">
            <button type="button" className={grid === 0 ? 'on' : ''} onClick={() => setGrid(0)}>
              <Layers size={11} /> raw
            </button>
            {grids.map((one) => (
              <button key={one} type="button" className={grid === one ? 'on' : ''} onClick={() => setGrid(one)}>
                {one >= 1 ? one.toLocaleString() : one.toPrecision(1)}
              </button>
            ))}
          </div>
        ) : null}

        <button
          type="button"
          className={`mk-chart-jump${following ? ' on' : ''}`}
          onClick={() => setFollowing((held) => !held)}
          title="Keep the current price centred"
        >
          {following ? 'Centred' : 'Free'}
        </button>

        <button
          type="button"
          className={`mk-chart-jump${showDepthChart ? ' on' : ''}`}
          onClick={() => setShowDepthChart((held) => !held)}
        >
          Depth
        </button>
      </div>

      {/* ---------------------------------------------------------------- the depth chart */}
      {showDepthChart && (bidDepth.length > 1 || askDepth.length > 1) ? (
        <DepthChart bids={bidDepth} asks={askDepth} currency={currency} />
      ) : null}

      {/* ---------------------------------------------------------------- the ladder */}
      <div
        className={`mk-book-ladder${outOfDate ? ' is-stale' : ''}`}
        ref={ladder}
        onScroll={(event) => {
          if (event.currentTarget.scrollTop > 8 && following) setFollowing(false)
        }}
      >
        <table>
          <thead>
            <tr>
              <th>Price</th>
              <th>Size</th>
              <th>Total</th>
              <th>Value</th>
            </tr>
          </thead>
          {/* Asks above, reversed, so the touch is in the middle where a ladder puts it. */}
          <tbody className="asks">
            {[...askDepth].reverse().map((level) => (
              <tr key={`a${level.price}`}>
                <td className="down">{currency.money(level.price).text}</td>
                <td>{quantity(level.size)}</td>
                <td>{quantity(level.cumulativeSize)}</td>
                <td>{currency.money(level.cumulativeNotional).text}</td>
                {/* The bar is the cumulative size against the deepest side, so the two halves are comparable. */}
                <td className="mk-book-bar" aria-hidden="true">
                  <i className="down" style={{ width: `${Math.min(100, (level.cumulativeSize / scale) * 100)}%` }} />
                </td>
              </tr>
            ))}
          </tbody>
          <tbody className="mid">
            <tr>
              <td colSpan={5}>
                {touch?.mid === null || touch === null ? (
                  <span className="mk-quiet">No mid — one side is empty</span>
                ) : (
                  <>
                    <b>{currency.money(touch.mid).text}</b>
                    <span className="mk-quiet">
                      spread {currency.money(touch.spread).text}
                      {touch.spreadFraction !== null ? ` · ${percent(touch.spreadFraction)}` : ''}
                    </span>
                  </>
                )}
              </td>
            </tr>
          </tbody>
          <tbody className="bids">
            {bidDepth.map((level) => (
              <tr key={`b${level.price}`}>
                <td className="up">{currency.money(level.price).text}</td>
                <td>{quantity(level.size)}</td>
                <td>{quantity(level.cumulativeSize)}</td>
                <td>{currency.money(level.cumulativeNotional).text}</td>
                <td className="mk-book-bar" aria-hidden="true">
                  <i className="up" style={{ width: `${Math.min(100, (level.cumulativeSize / scale) * 100)}%` }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.bids.length === 0 && shown.asks.length === 0 ? (
          <p className="mk-quiet">Waiting for the exchange&rsquo;s first snapshot…</p>
        ) : null}
      </div>

      {grid > 0 ? (
        <p className="mk-quiet">
          Grouped into {grid >= 1 ? grid.toLocaleString() : grid.toPrecision(1)} price steps. Bids round down and asks
          round up, so no level shows a better price than the orders in it.
        </p>
      ) : null}

      {book && (book.resyncs > 0 || book.dropped > 0) ? (
        <p className="mk-quiet">
          {/* Diagnostics, said plainly rather than hidden: it is how somebody can tell a quiet market from a bad feed. */}
          {book.resyncs} reload{book.resyncs === 1 ? '' : 's'} · {book.dropped} stale update
          {book.dropped === 1 ? '' : 's'} ignored
        </p>
      ) : null}
    </div>
  )
}

/**
 * Cumulative depth either side of the mid.
 *
 * Drawn from the same cumulative figures the ladder shows, so the picture and the table cannot disagree. Nothing is
 * smoothed or extrapolated: each step is a price level that exists.
 */
function DepthChart({
  bids,
  asks,
  currency
}: {
  bids: { price: number; cumulativeSize: number }[]
  asks: { price: number; cumulativeSize: number }[]
  currency: CurrencyState
}): React.JSX.Element | null {
  const prices = [...bids.map((one) => one.price), ...asks.map((one) => one.price)]
  if (prices.length < 2) return null
  const low = Math.min(...prices)
  const high = Math.max(...prices)
  const span = high - low || 1
  const most = Math.max(
    bids[bids.length - 1]?.cumulativeSize ?? 0,
    asks[asks.length - 1]?.cumulativeSize ?? 0,
    1
  )
  const x = (price: number): number => ((price - low) / span) * 100
  const y = (size: number): number => 40 - (size / most) * 38

  // A step path, because depth changes at a level rather than sloping between two.
  const step = (side: { price: number; cumulativeSize: number }[], ascending: boolean): string => {
    const ordered = ascending ? [...side].sort((a, b) => a.price - b.price) : [...side].sort((a, b) => b.price - a.price)
    if (ordered.length === 0) return ''
    let path = `M${x(ordered[0].price).toFixed(2)},40`
    let previous = 40
    for (const level of ordered) {
      const next = y(level.cumulativeSize)
      path += ` L${x(level.price).toFixed(2)},${previous.toFixed(2)} L${x(level.price).toFixed(2)},${next.toFixed(2)}`
      previous = next
    }
    path += ` L${x(ordered[ordered.length - 1].price).toFixed(2)},40 Z`
    return path
  }

  return (
    <div className="mk-depth-chart">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label="Cumulative order book depth">
        <path d={step(bids, false)} className="up" />
        <path d={step(asks, true)} className="down" />
      </svg>
      <span className="mk-depth-axis">
        <i>{currency.money(low).text}</i>
        <i>{currency.money(high).text}</i>
      </span>
    </div>
  )
}
