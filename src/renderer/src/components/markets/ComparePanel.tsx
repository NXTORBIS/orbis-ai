import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GitCompareArrows, Plus, RefreshCw, Search, X } from 'lucide-react'
import { MAX_COMPARED, type CompareStat, type CorrelationCell, type IndexedSeries } from '../../../../shared/markets/compare'
import type { NoticeKind } from '../../lib/notices'
import { Introduce } from './Explain'
import type { ExperienceState } from './useExperience'

/**
 * Several markets over the same window.
 *
 * Indexed to 100, because absolute prices are not comparable: bitcoin at 84,000 and a token at 0.000012 on one axis
 * tells you which number is bigger and nothing else. Rebasing turns both into "what did a pound put in at the start be
 * worth now", which is the question somebody comparing two markets is actually asking.
 *
 * Two things this panel refuses to do:
 *
 * - **It does not fill gaps.** Only moments every market has in common are used. A market that was halted for an hour
 *   simply contributes no points there, and a straight line across would be inventing prices.
 * - **It does not show a statistic from too little data.** Below thirty aligned observations volatility, drawdown and
 *   Sharpe come back as unavailable rather than as a number, because a number from eight points looks exactly as
 *   authoritative as one from eight hundred.
 */

const refused = (value: unknown): value is { error: string; message?: string } =>
  typeof value === 'object' && value !== null && typeof (value as { error?: unknown }).error === 'string'

/** Distinct enough to tell apart on one chart, and colourblind-safe. */
const COLOURS = ['#3fd8ff', '#ffbe4d', '#3ee58a', '#c39bff', '#ff7b9c', '#ffe066']

const INTERVALS = ['15m', '1h', '4h', '1d', '1w']

const percent = (value: number | null | undefined, places = 2): string =>
  typeof value === 'number' && Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${value.toFixed(places)}%` : '—'

const plain = (value: number | null | undefined, places = 2): string =>
  typeof value === 'number' && Number.isFinite(value) ? value.toFixed(places) : '—'

/** The colour a correlation reads at: strong together, strong apart, or neither. */
const correlationTint = (value: number | null): string => {
  if (value === null) return 'transparent'
  const strength = Math.min(1, Math.abs(value))
  // Green for together, red for apart. The alpha carries the strength, so a weak one barely tints.
  return value >= 0 ? `rgba(62, 229, 138, ${strength * 0.35})` : `rgba(255, 77, 109, ${strength * 0.35})`
}

interface Answer {
  interval: string
  indexed: IndexedSeries[]
  stats: CompareStat[]
  correlations: CorrelationCell[]
  missing: string[]
  assumptions: string[]
}

export default function ComparePanel({
  instrumentId,
  symbol,
  experience,
  onNotify
}: {
  /** The market the screen is on. Always the first of the comparison, and cannot be removed. */
  instrumentId: string
  symbol: string
  experience: ExperienceState
  onNotify(message: string, kind?: NoticeKind): void
}): React.JSX.Element {
  const [against, setAgainst] = useState<{ instrumentId: string; symbol: string }[]>([])
  const [interval, setInterval] = useState('1d')
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [loading, setLoading] = useState(false)
  const [problem, setProblem] = useState('')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ instrumentId: string; symbol: string; name: string }[]>([])
  const [searching, setSearching] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Changing the market the screen is on starts a fresh comparison: the old one was about something else.
  useEffect(() => {
    setAgainst([])
    setAnswer(null)
    setProblem('')
  }, [instrumentId])

  const ids = useMemo(() => [instrumentId, ...against.map((one) => one.instrumentId)], [instrumentId, against])

  const run = useCallback(async () => {
    if (ids.length < 2) {
      setAnswer(null)
      return
    }
    setLoading(true)
    setProblem('')
    try {
      const result = await window.api.marketsCompare(ids, interval, 400)
      if (refused(result)) {
        setProblem(result.message ?? 'That comparison could not be run.')
        setAnswer(null)
        return
      }
      setAnswer(result)
    } finally {
      setLoading(false)
    }
  }, [ids, interval])

  useEffect(() => {
    void run()
  }, [run])

  // Search, debounced. A keystroke per request would hammer the provider for results nobody read.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    const text = query.trim()
    if (text.length < 2) {
      setResults([])
      return
    }
    timer.current = setTimeout(() => {
      setSearching(true)
      void window.api
        .marketsSearch(text)
        .then((result) => {
          if (refused(result)) return
          setResults(
            result.results
              .filter((one) => !ids.includes(one.instrumentId))
              .slice(0, 8)
              .map((one) => ({ instrumentId: one.instrumentId, symbol: one.symbol, name: one.name }))
          )
        })
        .finally(() => setSearching(false))
    }, 220)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [query, ids])

  const add = (one: { instrumentId: string; symbol: string }): void => {
    if (ids.length >= MAX_COMPARED) {
      onNotify(`Six markets is as many as one comparison can show clearly`, 'warn')
      return
    }
    setAgainst((all) => [...all, one])
    setQuery('')
    setResults([])
  }

  const series = answer?.indexed ?? []

  // The chart's own extent, from the indexed values. Rebasing means 100 is always in range, but the spread around it
  // is whatever the markets did.
  const extent = useMemo(() => {
    let low = Number.POSITIVE_INFINITY
    let high = Number.NEGATIVE_INFINITY
    for (const one of series) {
      for (const point of one.points) {
        if (!Number.isFinite(point.value)) continue
        low = Math.min(low, point.value)
        high = Math.max(high, point.value)
      }
    }
    if (!Number.isFinite(low) || !Number.isFinite(high)) return null
    if (high === low) return { low: low - 1, high: high + 1 }
    const pad = (high - low) * 0.08
    return { low: low - pad, high: high + pad }
  }, [series])

  const width = 720
  const height = 260
  const inset = { top: 10, right: 54, bottom: 22, left: 10 }
  const plotWidth = width - inset.left - inset.right
  const plotHeight = height - inset.top - inset.bottom

  const path = (one: IndexedSeries): string => {
    if (!extent || one.points.length === 0) return ''
    const first = one.points[0].at
    const last = one.points[one.points.length - 1].at
    const span = Math.max(1, last - first)
    return one.points
      .map((point, i) => {
        const x = inset.left + ((point.at - first) / span) * plotWidth
        const y = inset.top + plotHeight - ((point.value - extent.low) / (extent.high - extent.low)) * plotHeight
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
      })
      .join(' ')
  }

  const gridValues = useMemo(() => {
    if (!extent) return []
    const out: number[] = []
    for (let i = 0; i <= 4; i++) out.push(extent.low + ((extent.high - extent.low) * i) / 4)
    return out
  }, [extent])

  const symbols = useMemo(() => [{ instrumentId, symbol }, ...against], [instrumentId, symbol, against])

  return (
    <section className="mk-compare" aria-label="Compare markets">
      <Introduce experience={experience} term="correlation" />

      <div className="mk-compare-bar">
        <div className="mk-compare-chips">
          {symbols.map((one, i) => (
            <span key={one.instrumentId} className="mk-compare-chip" style={{ borderColor: COLOURS[i % COLOURS.length] }}>
              <i style={{ background: COLOURS[i % COLOURS.length] }} aria-hidden />
              {one.symbol}
              {/* The market the screen is on stays. Removing it would make the panel about something else entirely. */}
              {i > 0 && (
                <button
                  type="button"
                  onClick={() => setAgainst((all) => all.filter((other) => other.instrumentId !== one.instrumentId))}
                  aria-label={`Remove ${one.symbol}`}
                >
                  <X size={11} />
                </button>
              )}
            </span>
          ))}
        </div>

        <div className="mk-compare-intervals" role="group" aria-label="Interval">
          {INTERVALS.map((one) => (
            <button key={one} type="button" className={interval === one ? 'on' : ''} onClick={() => setInterval(one)}>
              {one}
            </button>
          ))}
          <button type="button" onClick={() => void run()} disabled={loading} title="Fetch again">
            <RefreshCw size={12} className={loading ? 'mk-spin' : ''} />
          </button>
        </div>
      </div>

      {ids.length < MAX_COMPARED && (
        <div className="mk-compare-add">
          <label className="mk-search-field">
            <Search size={13} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Add a market to compare against"
              spellCheck={false}
            />
          </label>
          {searching && <span className="mk-quiet">Searching…</span>}
          {results.length > 0 && (
            <ul className="mk-compare-results">
              {results.map((one) => (
                <li key={one.instrumentId}>
                  <button type="button" onClick={() => add(one)}>
                    <Plus size={12} /> <b>{one.symbol}</b> <span className="mk-quiet">{one.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {problem !== '' && <p className="mk-problem">{problem}</p>}

      {ids.length < 2 ? (
        <p className="mk-quiet mk-compare-empty">
          <GitCompareArrows size={15} /> Add at least one more market. {symbol} on its own is a price chart, which the
          chart tab already draws better than this one could.
        </p>
      ) : (
        <>
          {extent && series.length > 0 ? (
            <svg className="mk-compare-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Indexed comparison">
              {gridValues.map((value) => {
                const y = inset.top + plotHeight - ((value - extent.low) / (extent.high - extent.low)) * plotHeight
                // The 100 line is the start. Drawn solid because it is the thing everything else is measured from.
                const isBase = Math.abs(value - 100) < (extent.high - extent.low) / 200
                return (
                  <g key={value}>
                    <line
                      x1={inset.left}
                      x2={inset.left + plotWidth}
                      y1={y}
                      y2={y}
                      className={isBase ? 'mk-compare-base' : 'mk-compare-grid'}
                    />
                    <text x={inset.left + plotWidth + 6} y={y + 3.5} className="mk-compare-label">
                      {value.toFixed(0)}
                    </text>
                  </g>
                )
              })}
              {series.map((one, i) => (
                <path key={one.instrumentId} d={path(one)} fill="none" stroke={COLOURS[i % COLOURS.length]} strokeWidth={1.8} />
              ))}
            </svg>
          ) : (
            !loading && <p className="mk-quiet">No moments these markets have in common at this interval.</p>
          )}

          {answer && answer.missing.length > 0 && (
            <p className="mk-problem">
              No candles came back for {answer.missing.join(', ')}, so {answer.missing.length === 1 ? 'it is' : 'they are'} not
              in the comparison.
            </p>
          )}

          {answer && answer.stats.length > 0 && (
            <div className="mk-table-wrap">
              <table className="mk-table">
                <thead>
                  <tr>
                    <th scope="col">Market</th>
                    <th scope="col">Change</th>
                    <th scope="col">Volatility</th>
                    <th scope="col">Worst fall</th>
                    <th scope="col">Sharpe</th>
                    <th scope="col">Points</th>
                  </tr>
                </thead>
                <tbody>
                  {answer.stats.map((one, i) => (
                    <tr key={one.instrumentId}>
                      <th scope="row">
                        <i className="mk-compare-dot" style={{ background: COLOURS[i % COLOURS.length] }} aria-hidden />
                        {one.symbol}
                      </th>
                      <td className={one.totalPercent === null ? '' : one.totalPercent >= 0 ? 'mk-up' : 'mk-down'}>
                        {percent(one.totalPercent)}
                      </td>
                      {/* Null is shown as "too few", never as a dash that reads like zero. */}
                      <td>{one.volatility === null ? <span className="mk-quiet">too few</span> : `${plain(one.volatility, 1)}%`}</td>
                      <td>{one.maxDrawdownPercent === null ? <span className="mk-quiet">too few</span> : percent(-Math.abs(one.maxDrawdownPercent))}</td>
                      <td>{one.sharpe === null ? <span className="mk-quiet">too few</span> : plain(one.sharpe)}</td>
                      <td className="mk-quiet">{one.observations}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {answer && answer.correlations.length > 0 && symbols.length > 1 && (
            <div className="mk-corr">
              <h4>How they moved together</h4>
              <div className="mk-table-wrap">
                <table className="mk-table mk-corr-table">
                  <thead>
                    <tr>
                      <th scope="col" />
                      {answer.stats.map((one) => (
                        <th key={one.instrumentId} scope="col">
                          {one.symbol}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {answer.stats.map((row) => (
                      <tr key={row.instrumentId}>
                        <th scope="row">{row.symbol}</th>
                        {answer.stats.map((column) => {
                          const cell = answer.correlations.find(
                            (one) =>
                              (one.a === row.symbol && one.b === column.symbol) ||
                              (one.a === column.symbol && one.b === row.symbol)
                          )
                          const value = cell?.value ?? null
                          return (
                            <td
                              key={column.instrumentId}
                              style={{ background: correlationTint(value) }}
                              title={
                                value === null
                                  ? `Too few overlapping observations (${cell?.observations ?? 0})`
                                  : `${cell?.observations} observations`
                              }
                            >
                              {value === null ? <span className="mk-quiet">—</span> : value.toFixed(2)}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mk-quiet">
                1 means they moved together, −1 means they moved opposite, 0 means neither. Moving together is not one
                causing the other, and a pair that has moved together for a year can stop on any given day.
              </p>
            </div>
          )}

          {answer && (
            <ul className="mk-assumptions">
              {answer.assumptions.map((one) => (
                <li key={one}>{one}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
