import { useCallback, useEffect, useMemo, useState } from 'react'
import { Layers, TrendingDown, TrendingUp } from 'lucide-react'
import { PRESSURE_WINDOWS } from '../../../../shared/markets/tape'
import type { TapeAnswer } from '../../../../main/markets/ipc'
import type { TradePrint } from '../../../../shared/markets/provider'
import { Segmented } from '../../ui'
import { Introduce } from './Explain'
import type { ExperienceState } from './useExperience'
import type { CurrencyState } from './useCurrency'

/**
 * The trade tape, and what it adds up to.
 *
 * The prints are the exchange's own, and so is the side of each one: where a venue publishes no aggressor flag the side
 * is shown as unknown rather than inferred from whether the price moved. That single rule is what the whole panel is
 * arranged around, because every figure below depends on it.
 *
 * The consequence somebody needs to see: when a venue classifies little or none of the tape, the pressure reading is a
 * reading of the part it classified. The panel says what share that was, and refuses to describe the market at all below
 * a tenth — a confident "62% buying" from 4% of the volume is the kind of number that is worse than none.
 *
 * Live-follow is a real mode. Scrolling up stops the list jumping, because a tape that yanks itself back to the top every
 * time somebody tries to read a print is a tape nobody can read.
 */

const refused = (value: unknown): value is { error: string; message?: string } =>
  typeof value === 'object' && value !== null && typeof (value as { error?: unknown }).error === 'string'

type Filter = 'all' | 'buys' | 'sells' | 'large'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'buys', label: 'Buys' },
  { id: 'sells', label: 'Sells' },
  { id: 'large', label: 'Large' }
]

const READING_LABEL: Record<string, string> = {
  buying: 'Buy pressure',
  selling: 'Sell pressure',
  balanced: 'Balanced',
  thin: 'Too few trades',
  unclassified: 'Side not published'
}

/** A quantity, at the precision the number itself deserves. */
const quantity = (value: number | null | undefined): string => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  if (Math.abs(value) >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (Math.abs(value) >= 1) return value.toFixed(3)
  return value.toFixed(6)
}

const percent = (value: number | null): string =>
  value === null || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(1)}%`

/**
 * A price grid that suits this market.
 *
 * A power of ten about a thousandth of the price, so bitcoin groups into hundreds and a sub-cent token into millionths.
 * Derived from the price rather than fixed, because one grid cannot serve a market at 84,000 and one at 0.000012 — and
 * because a grid coarser than the price would put the whole tape in one bucket.
 */
const gridFor = (price: number | null | undefined): number => {
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return 0
  return 10 ** (Math.floor(Math.log10(price)) - 2)
}

export default function TapePanel({
  instrumentId,
  note,
  experience,
  currency
}: {
  instrumentId: string
  /** What the provider said when it cannot supply a tape at all. */
  note: string
  experience: ExperienceState
  currency: CurrencyState
}): React.JSX.Element {
  const [answer, setAnswer] = useState<TapeAnswer | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [threshold, setThreshold] = useState<number | null>(null)
  const [window_, setWindow] = useState<string>('1m')
  const [grouped, setGrouped] = useState(false)
  const [following, setFollowing] = useState(true)
  /** Held rather than recomputed each render, so turning grouping on does not change the grid under the view. */
  const [grid, setGrid] = useState(0)

  const load = useCallback(async () => {
    const got = await window.api.marketsTapeAnalysis(instrumentId, {
      filter,
      threshold: threshold ?? 0,
      window: window_,
      // Grouping costs nothing until somebody asks for it, and the grid comes from the market's own price.
      priceBucket: grouped ? grid : 0
    })
    if (!refused(got)) setAnswer(got)
  }, [instrumentId, filter, threshold, window_, grouped, grid])

  useEffect(() => {
    void load()
    // Twice a second: the prints are already in the engine, so this is a read of local state rather than a request.
    const timer = globalThis.setInterval(() => void load(), 500)
    return () => globalThis.clearInterval(timer)
  }, [load])

  /** Their threshold if they set one, otherwise the one this market's own prints suggest. */
  const effective = threshold ?? answer?.suggestedThreshold ?? null

  useEffect(() => {
    if (grid === 0) {
      const price = answer?.trades[answer.trades.length - 1]?.price ?? answer?.stats.largest?.price ?? null
      const next = gridFor(price)
      if (next > 0) setGrid(next)
    }
  }, [answer, grid])

  useEffect(() => {
    // Adopted once, so the Large filter has something sensible behind it the first time it is used.
    if (threshold === null && answer?.suggestedThreshold) setThreshold(answer.suggestedThreshold)
  }, [answer?.suggestedThreshold, threshold])

  const pressure = answer?.pressure ?? null
  const reading = answer?.reading ?? 'thin'
  const buyShare = pressure?.buyShare ?? null

  const rows = useMemo(() => [...(answer?.trades ?? [])].reverse(), [answer])
  const buckets = answer?.byPrice ?? []

  if (note) {
    return (
      <div className="mk-tape">
        <div className="mk-empty-small">
          <p>{note}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="mk-tape">
      {experience.get('bookGuidance') ? <Introduce term="trades" experience={experience} /> : null}

      {/* ---------------------------------------------------------------- pressure */}
      <div className="mk-pressure">
        <Segmented
          className="mk-seg is-small"
          label="Over what period"
          value={window_}
          options={PRESSURE_WINDOWS.map((one) => ({ value: one.id, label: one.label }))}
          onChange={(next) => setWindow(next)}
        />

        <span className={`mk-pressure-verdict is-${reading}`}>{READING_LABEL[reading] ?? reading}</span>

        {/*
          * The bar is the classified volume only, and the unclassified share is drawn beside it rather than folded in.
          * A two-colour bar that silently included unknown volume in one side would be the easiest way to mislead here.
          */}
        {buyShare !== null ? (
          <span className="mk-pressure-bar" aria-hidden="true">
            <i className="up" style={{ flexGrow: Math.max(0.001, buyShare) }} />
            <i className="down" style={{ flexGrow: Math.max(0.001, 1 - buyShare) }} />
          </span>
        ) : null}

        <span className="mk-pressure-figures">
          {buyShare === null ? (
            <em className="mk-quiet">This exchange does not publish which side was the aggressor.</em>
          ) : (
            <>
              <b className="up">{percent(buyShare)} buy</b>
              <b className="down">{percent(1 - buyShare)} sell</b>
              <span className="mk-quiet">
                {currency.money(pressure?.buyNotional ?? null).text} / {currency.money(pressure?.sellNotional ?? null).text}
              </span>
            </>
          )}
        </span>

        {/*
          * The caveat that decides whether any of the above means anything. Always shown when it is not the whole tape,
          * because a reading over a third of the volume is a reading of a third of the volume.
          */}
        {pressure && pressure.classifiedShare !== null && pressure.classifiedShare < 0.999 ? (
          <span className="mk-pressure-caveat">
            From {percent(pressure.classifiedShare)} of the volume — the rest carried no side.
          </span>
        ) : null}
      </div>

      {/* ---------------------------------------------------------------- what the window adds up to */}
      {answer ? (
        <div className="mk-sub mk-tape-stats">
          <span>
            Prints <b>{answer.stats.count.toLocaleString()}</b>
          </span>
          <span>
            Traded <b>{currency.money(answer.stats.notional).text}</b>
          </span>
          <span>
            Average <b>{currency.money(answer.stats.averageNotional).text}</b>
          </span>
          <span>
            Largest <b>{currency.money(answer.stats.largest?.notional ?? null).text}</b>
          </span>
          <span title="Prints a second over the span the visible tape covers">
            Rate <b>{answer.stats.perSecond === null ? '—' : `${answer.stats.perSecond.toFixed(1)}/s`}</b>
          </span>
        </div>
      ) : null}

      {/* ---------------------------------------------------------------- filters */}
      <div className="mk-tape-bar">
        <Segmented
          className="mk-seg is-small"
          label="Which trades to show"
          value={filter}
          options={FILTERS.map((one) => ({
            value: one.id,
            label: one.label,
            // Only offered when there is a threshold behind it, so it cannot silently filter everything out.
            disabled: one.id === 'large' && effective === null,
            why:
              one.id === 'large' && effective === null
                ? 'Not enough trades yet to judge what large means here'
                : undefined
          }))}
          onChange={(next) => setFilter(next)}
        />

        {filter === 'large' ? (
          <label className="mk-tape-threshold">
            Over
            <input
              type="number"
              min={0}
              step={1000}
              value={effective ?? 0}
              aria-label="Large trade threshold, in the quote currency"
              onChange={(event) => {
                const next = Number(event.target.value)
                setThreshold(Number.isFinite(next) && next > 0 ? next : null)
              }}
            />
            <span className="mk-quiet">
              {answer?.suggestedThreshold
                ? `suggested ${currency.money(answer.suggestedThreshold).text}, from this market’s own prints`
                : ''}
            </span>
          </label>
        ) : null}

        <button
          type="button"
          className={`mk-chart-jump${grouped ? ' on' : ''}`}
          onClick={() => setGrouped((held) => !held)}
          title="Group the tape by price"
        >
          <Layers size={12} /> {grouped ? 'Prints' : 'By price'}
        </button>

        <button
          type="button"
          className={`mk-chart-jump${following ? ' on' : ''}`}
          onClick={() => setFollowing((held) => !held)}
          title="Keep the newest trades in view"
        >
          {following ? 'Following' : 'Paused'}
        </button>
      </div>

      {/* ---------------------------------------------------------------- grouped by price */}
      {grouped ? (
        buckets.length === 0 ? (
          <p className="mk-quiet">Waiting for trades…</p>
        ) : (
          <div className="mk-tape-scroll">
            <table>
              <thead>
                <tr>
                  <th>Price</th>
                  <th>Prints</th>
                  <th>Size</th>
                  <th>Buy</th>
                  <th>Sell</th>
                </tr>
              </thead>
              <tbody>
                {buckets.map((one) => (
                  <tr key={one.price}>
                    {/* The bottom of the bucket, and how many prints made it -- so a level from one trade is not read as
                        a level from fifty, and so this table is never mistaken for an order book. */}
                    <td>{currency.money(one.price).text}</td>
                    <td>{one.count.toLocaleString()}</td>
                    <td>{quantity(one.size)}</td>
                    <td className="up">{one.buyNotional > 0 ? currency.money(one.buyNotional).text : '—'}</td>
                    <td className="down">{one.sellNotional > 0 ? currency.money(one.sellNotional).text : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mk-quiet">
              Grouped into {currency.money(grid).text} price steps. These are completed trades, not resting orders.
            </p>
          </div>
        )
      ) : null}

      {/* ---------------------------------------------------------------- the prints */}
      {grouped ? null : rows.length === 0 ? (
        <p className="mk-quiet">
          {filter === 'all' ? 'Waiting for trades…' : 'No trades in this view.'}
        </p>
      ) : (
        <div
          className="mk-tape-scroll"
          // Scrolling away pauses the follow, so reading a print does not fight the stream.
          onScroll={(event) => {
            if (event.currentTarget.scrollTop > 8 && following) setFollowing(false)
          }}
          ref={(node) => {
            if (node && following) node.scrollTop = 0
          }}
        >
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Price</th>
                <th>Size</th>
                <th>Value</th>
                <th>Side</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((print: TradePrint, i) => {
                const notional = print.price * print.size
                const big = effective !== null && notional >= effective
                return (
                  <tr key={`${print.timestamp}-${print.price}-${i}`} className={`${print.side}${big ? ' is-large' : ''}`}>
                    <td>{new Date(print.timestamp).toLocaleTimeString()}</td>
                    <td>{currency.money(print.price).text}</td>
                    <td>{quantity(print.size)}</td>
                    <td>{currency.money(notional).text}</td>
                    <td>
                      {/* Only what the exchange reported. An unknown aggressor stays unknown. */}
                      {print.side === 'buy' ? (
                        <>
                          <TrendingUp size={11} /> buy
                        </>
                      ) : print.side === 'sell' ? (
                        <>
                          <TrendingDown size={11} /> sell
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
