import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, BarChart3, History, Info, Trash2 } from 'lucide-react'
import type { PatternRecord } from '../../../../shared/markets/patternHistory'

/**
 * What was detected, and what price did afterwards.
 *
 * The second half of this screen is the part that has to be handled carefully. "57% of these formations were followed by
 * a higher price twelve candles later" is a fact about candles that already traded. It is not a 57% chance of anything,
 * and the difference is the whole reason this panel exists rather than a number beside a pattern name.
 *
 * So: the sample size is shown with every figure, the caution for a small sample is rendered *with* the numbers rather
 * than behind a disclosure, the distribution is shown as well as the middle, and the words "win rate", "accuracy" and
 * "probability" appear nowhere.
 */

interface Distribution {
  sample: number
  reliability: string
  bands: { from: number; to: number | null; share: number; count: number }[]
  median: number | null
  mean: number | null
  lowerQuartile: number | null
  upperQuartile: number | null
  best: number | null
  worst: number | null
  shareAboveZero: number | null
  describe: string
  caution: string | null
}

interface Summary {
  method: { reference: string; forwardCandles: number; describe: string }
  forwardReturn: Distribution
  maximumFavourable: Distribution
  maximumAdverse: Distribution
  excludedIncomplete: number
  describe: string
}

interface Frequency {
  byPattern: { patternId: string; patternName: string; count: number; share: number }[]
  byInterval: { interval: string; count: number }[]
  byMarket: { instrumentId: string; symbol: string; count: number }[]
  byCategory: Record<string, number>
  byDirection: Record<string, number>
  total: number
  describe: string
}

interface Conditioned {
  condition: string
  value: string
  summary: Summary
}

const percent = (value: number | null): string => (value === null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`)
const readable = (value: string): string => value.replace(/-/g, ' ')

const bandLabel = (band: { from: number; to: number | null }): string => {
  if (band.from === -Infinity) return `below ${band.to}%`
  if (band.to === null) return `above ${band.from}%`
  return `${band.from}% to ${band.to}%`
}

/** A distribution, with its sample size and its warning both inline rather than hidden. */
function DistributionView({ label, one }: { label: string; one: Distribution }): React.JSX.Element {
  if (one.sample === 0) {
    return (
      <div className="mk-dist">
        <h5>{label}</h5>
        <p className="mk-empty">{one.describe}</p>
      </div>
    )
  }
  return (
    <div className="mk-dist">
      <h5>
        {label} <span className="mk-panel-sub">{one.sample} observations</span>
      </h5>
      {one.caution !== null && (
        <p className="mk-problem" role="alert">
          <AlertTriangle size={14} aria-hidden /> {one.caution}
        </p>
      )}
      <dl className="mk-pattern-facts">
        <div>
          <dt>Median</dt>
          <dd>{percent(one.median)}</dd>
        </div>
        <div>
          <dt>Middle half</dt>
          <dd>
            {percent(one.lowerQuartile)} to {percent(one.upperQuartile)}
          </dd>
        </div>
        <div>
          <dt>Range</dt>
          <dd>
            {percent(one.worst)} to {percent(one.best)}
          </dd>
        </div>
        <div>
          <dt>Finished above where they started</dt>
          <dd>{one.shareAboveZero === null ? '—' : `${(one.shareAboveZero * 100).toFixed(0)}% of them`}</dd>
        </div>
      </dl>
      <ul className="mk-dist-bands">
        {one.bands.map((band) => (
          <li key={`${band.from}-${band.to}`}>
            <span className="mk-dist-label">{bandLabel(band)}</span>
            <span className="mk-dist-bar" style={{ width: `${Math.round(band.share * 100)}%` }} aria-hidden />
            <span className="mk-dist-count">
              {band.count} ({(band.share * 100).toFixed(0)}%)
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export interface PatternHistoryPanelProps {
  /** Offered as a filter, so the panel opens on the market the user is looking at. */
  instrumentId?: string
  symbol?: string
}

export function PatternHistoryPanel({ instrumentId, symbol }: PatternHistoryPanelProps): React.JSX.Element {
  const [records, setRecords] = useState<PatternRecord[]>([])
  const [frequency, setFrequency] = useState<Frequency | null>(null)
  const [describe, setDescribe] = useState('')
  const [excludedBy, setExcludedBy] = useState<{ condition: string; count: number }[]>([])
  const [problem, setProblem] = useState('')
  const [thisMarketOnly, setThisMarketOnly] = useState(instrumentId !== undefined)
  const [patternFilter, setPatternFilter] = useState('')
  const [forward, setForward] = useState(12)
  const [conditionBy, setConditionBy] = useState('')
  const [summary, setSummary] = useState<Summary | null>(null)
  const [conditioned, setConditioned] = useState<Conditioned[]>([])
  const [outcomeProblem, setOutcomeProblem] = useState('')
  const [measuring, setMeasuring] = useState(false)
  const [tick, setTick] = useState(0)

  const query = useCallback(
    () => ({
      instrumentIds: thisMarketOnly && instrumentId !== undefined ? [instrumentId] : undefined,
      patternIds: patternFilter === '' ? undefined : [patternFilter]
    }),
    [thisMarketOnly, instrumentId, patternFilter]
  )

  const load = useCallback(async () => {
    try {
      const result = await window.api.marketsPatternHistory(query())
      if ('error' in result) {
        setProblem(result.message ?? 'That did not work.')
        return
      }
      setProblem('')
      setRecords(result.records)
      setFrequency(result.frequency as unknown as Frequency)
      setDescribe(result.describe)
      setExcludedBy(result.excludedBy)
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not work.')
    }
  }, [query, tick])

  useEffect(() => {
    void load()
  }, [load])

  const measure = useCallback(async () => {
    setMeasuring(true)
    setOutcomeProblem('')
    try {
      const result = await window.api.marketsPatternOutcomes(query(), {
        forwardCandles: forward,
        conditionOn: conditionBy === '' ? undefined : conditionBy
      })
      if ('error' in result) {
        setOutcomeProblem(result.message ?? 'That did not work.')
        setSummary(null)
        setConditioned([])
        return
      }
      setSummary(result.summary as unknown as Summary)
      setConditioned(result.conditioned as unknown as Conditioned[])
    } catch (err) {
      setOutcomeProblem(err instanceof Error ? err.message : 'That did not work.')
    } finally {
      setMeasuring(false)
    }
  }, [query, forward, conditionBy])

  const clearAll = useCallback(async () => {
    const result = await window.api.marketsPatternHistoryClear()
    if (!('error' in result)) {
      setDescribe(result.describe)
      setTick((one) => one + 1)
    }
  }, [])

  return (
    <section className="mk-panel" aria-label="Candlestick pattern history">
      <header className="mk-panel-head">
        <h3>
          <History size={15} aria-hidden /> Pattern history
        </h3>
        <span className="mk-panel-sub">{records.length} recorded</span>
        {records.length > 0 && (
          <button type="button" className="mk-mini mk-danger" onClick={() => void clearAll()}>
            <Trash2 size={13} aria-hidden /> Forget all
          </button>
        )}
      </header>

      <div className="mk-pattern-filters">
        {instrumentId !== undefined && (
          <label className="mk-switch">
            <input type="checkbox" checked={thisMarketOnly} onChange={(e) => setThisMarketOnly(e.target.checked)} />
            <span>{symbol ?? instrumentId} only</span>
          </label>
        )}
        <label className="mk-field">
          <span className="mk-sr">Pattern</span>
          <select value={patternFilter} onChange={(e) => setPatternFilter(e.target.value)}>
            <option value="">Every pattern</option>
            {(frequency?.byPattern ?? []).map((one) => (
              <option key={one.patternId} value={one.patternId}>
                {one.patternName} ({one.count})
              </option>
            ))}
          </select>
        </label>
      </div>

      {problem !== '' && (
        <p className="mk-problem" role="alert">
          <AlertTriangle size={14} aria-hidden /> {problem}
        </p>
      )}

      {records.length === 0 && problem === '' && (
        <p className="mk-empty">
          {describe || 'Nothing has been recorded yet.'}
          {excludedBy.length > 0 && ` The conditions that excluded the most were: ${excludedBy.slice(0, 3).map((one) => `${one.condition} (${one.count})`).join(', ')}.`}
        </p>
      )}

      {frequency !== null && frequency.total > 0 && (
        <>
          <h4>How often each was detected</h4>
          <ul className="mk-dist-bands">
            {frequency.byPattern.slice(0, 12).map((one) => (
              <li key={one.patternId}>
                <span className="mk-dist-label">{one.patternName}</span>
                <span className="mk-dist-bar" style={{ width: `${Math.round(one.share * 100)}%` }} aria-hidden />
                <span className="mk-dist-count">
                  {one.count} ({(one.share * 100).toFixed(0)}%)
                </span>
              </li>
            ))}
          </ul>
          <p className="mk-note" role="note">
            <Info size={14} aria-hidden /> {frequency.describe}
          </p>
        </>
      )}

      {records.length > 0 && (
        <>
          <h4>
            <BarChart3 size={14} aria-hidden /> What happened afterwards
          </h4>

          <div className="mk-pattern-filters">
            <label className="mk-field">
              <span>Measure forward</span>
              <select value={forward} onChange={(e) => setForward(Number(e.target.value))}>
                {[3, 6, 12, 24, 48].map((one) => (
                  <option key={one} value={one}>
                    {one} candles
                  </option>
                ))}
              </select>
            </label>
            <label className="mk-field">
              <span>Split by</span>
              <select value={conditionBy} onChange={(e) => setConditionBy(e.target.value)}>
                <option value="">Nothing</option>
                <option value="regime">Market regime</option>
                <option value="volume">Volume</option>
                <option value="volatility">Volatility</option>
                <option value="placement">Where it formed</option>
                <option value="interval">Interval</option>
                <option value="dataQuality">Data quality</option>
              </select>
            </label>
            <button type="button" className="mk-mini" onClick={() => void measure()} disabled={measuring}>
              {measuring ? 'Measuring…' : 'Measure'}
            </button>
          </div>

          {outcomeProblem !== '' && (
            <p className="mk-problem" role="alert">
              <AlertTriangle size={14} aria-hidden /> {outcomeProblem}
            </p>
          )}

          {summary !== null && (
            <>
              <p className="mk-note" role="note">
                <Info size={14} aria-hidden /> {summary.method.describe} Everything below is a measurement of candles that
                already traded. None of it is a probability, a win rate or a rate of success.
              </p>
              {summary.excludedIncomplete > 0 && (
                <p className="mk-note" role="note">
                  {summary.excludedIncomplete} occurrence{summary.excludedIncomplete === 1 ? '' : 's'} excluded because the
                  forward window ran past the end of the available history.
                </p>
              )}
              <DistributionView label="Change after the window" one={summary.forwardReturn} />
              <DistributionView label="Best point reached inside the window" one={summary.maximumFavourable} />
              <DistributionView label="Worst point reached inside the window" one={summary.maximumAdverse} />
            </>
          )}

          {conditioned.length > 0 && (
            <>
              <h4>Split by {readable(conditionBy)}</h4>
              <p className="mk-note" role="note">
                <Info size={14} aria-hidden /> Splitting shrinks every group. Each carries its own sample size, because a
                percentage over eleven occurrences is a smaller claim than the same percentage over three hundred.
              </p>
              {conditioned.map((one) => (
                <div key={one.value} className="mk-dist-group">
                  <h5>{readable(one.value)}</h5>
                  <DistributionView label="Change after the window" one={one.summary.forwardReturn} />
                </div>
              ))}
            </>
          )}
        </>
      )}

      {records.length > 0 && (
        <details className="mk-pattern-misses">
          <summary>Every recorded occurrence</summary>
          <ul className="mk-pattern-rules">
            {records.slice(0, 200).map((one) => (
              <li key={one.key}>
                <span className="mk-rule-text">{one.patternName}</span> · {one.symbol} · {one.interval} ·{' '}
                {new Date(one.candleTime).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })} · match{' '}
                {(one.structuralMatch * 100).toFixed(0)}% · data {one.dataQuality} · definition v{one.patternVersion}
                {one.revised && ' · source candles were later revised'}
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="mk-note mk-pattern-foot" role="note">
        <AlertTriangle size={14} aria-hidden /> Historical behaviour is not a guide to what happens next. These are
        measurements over one selected set of past candles, and they are not financial advice.
      </p>
    </section>
  )
}
