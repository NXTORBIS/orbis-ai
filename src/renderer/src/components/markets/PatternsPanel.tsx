import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CandlestickChart, Check, ChevronRight, Info, Layers, Minus, Search, ShieldAlert, TrendingDown, TrendingUp, X } from 'lucide-react'
import type { PatternMarker } from './MarketChart'

/**
 * Candlestick patterns on the market that is open.
 *
 * Nothing on this screen decides anything. Every formation, every measurement and every caveat arrived from the main
 * process, where the detector runs — so what is drawn here is what was detected, and there is no second opinion in the
 * renderer that could disagree with it.
 *
 * ## The caveats are the content
 *
 * A pattern panel is an unusually easy thing to make dishonest. A percentage next to a name reads as a probability; a
 * green arrow reads as advice. So: the match strength is shown as a word with the number beside it and a sentence
 * saying what it measures, the context is split into what agrees and what does not with neither netted off, and
 * anything that could not be read at all is listed rather than omitted. None of those is behind a disclosure.
 */

type Direction = 'bullish' | 'bearish' | 'neutral'

interface Detection {
  key: string
  patternId: string
  patternName: string
  patternVersion: number
  category: string
  direction: Direction
  at: number
  candleTimes: number[]
  emphasisTimes: number[]
  structuralMatch: number
  completeness: 'complete' | 'developing'
  status: string
  alsoMatches: string[]
  describe: string
  dataQuality: { level: string; reasons: string[]; hasVolume: boolean; comparisonSample: number; describe: string }
  evidence: {
    structural: { id: string; describe: string; required: boolean; passed: boolean; strength: number; measured: string }[]
    context: { id: string; describe: string; required: boolean; passed: boolean; strength: number; measured: string }[]
    unmetPreferences: string[]
  }
  trend: { trend: string; describe: string }
}

interface Context {
  structure: { shape: string; describe: string }
  levels: { placement: string; describe: string }
  volume: { reading: string; relative: number | null; describe: string }
  volatility: { reading: string; describe: string }
  momentum: { rsi: number | null; rsiReading: string; adx: number | null; describe: string }
  regime: { regime: string; volatility: string; describe: string }
  agreements: string[]
  conflicts: string[]
  unavailable: string[]
  completeness: number
  describe: string
}

interface Found {
  detection: Detection
  context: Context | null
  timeframeAgreement: string | null
  match: 'low' | 'moderate' | 'high'
  explain: string[]
}

interface NearMiss {
  patternId: string
  patternName: string
  at: number
  failedRule: { describe: string; measured: string }
  describe: string
}

export interface PatternsPanelProps {
  instrumentId: string
  symbol: string
  interval: string
  /** Told which formations to mark, so the chart and this list cannot disagree about what was found. */
  onMarkers?(markers: PatternMarker[]): void
  /** Which formation is picked, shared with the chart so clicking either selects both. */
  selected?: string | null
  onSelect?(key: string | null): void
  /** Asked to jump the chart to a formation's own candles. */
  onGoToTime?(at: number): void
}

const DIRECTION_WORD: Record<Direction, string> = { bullish: 'Bullish', bearish: 'Bearish', neutral: 'Neutral' }

/** Direction as a shape as well as a word, because colour on its own is not something everybody can read. */
function DirectionMark({ direction }: { direction: Direction }): React.JSX.Element {
  const Icon = direction === 'bullish' ? TrendingUp : direction === 'bearish' ? TrendingDown : Minus
  return (
    <span className={`mk-pattern-dir mk-pattern-dir-${direction}`}>
      <Icon size={13} aria-hidden /> {DIRECTION_WORD[direction]}
    </span>
  )
}

const QUALITY_WORD: Record<string, string> = { high: 'High', reduced: 'Reduced', poor: 'Poor', unusable: 'Unusable' }

const readable = (value: string): string => value.replace(/-/g, ' ')

const timeText = (at: number): string => new Date(at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })

export function PatternsPanel({
  instrumentId,
  symbol,
  interval,
  onMarkers,
  selected,
  onSelect,
  onGoToTime
}: PatternsPanelProps): React.JSX.Element {
  const [found, setFound] = useState<Found[]>([])
  const [developing, setDeveloping] = useState<Found[]>([])
  const [nearMisses, setNearMisses] = useState<NearMiss[]>([])
  const [problem, setProblem] = useState('')
  const [disabled, setDisabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [describe, setDescribe] = useState('')
  const [candleNote, setCandleNote] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const load = useCallback(async () => {
    if (instrumentId === '') return
    setBusy(true)
    try {
      const result = await window.api.marketsPatternDetect(instrumentId, interval, { limit: 300 })
      if ('error' in result) {
        if (result.error === 'disabled') {
          setDisabled(true)
          setProblem('')
          setFound([])
          setDeveloping([])
          setDescribe(result.message ?? '')
          return
        }
        setDisabled(false)
        setProblem(result.message ?? 'That did not work.')
        setFound([])
        setDeveloping([])
        return
      }
      setDisabled(false)
      setProblem('')
      setFound(result.found as unknown as Found[])
      setDeveloping(result.developing as unknown as Found[])
      setNearMisses(result.nearMisses as unknown as NearMiss[])
      setDescribe(result.describe)
      setCandleNote(result.candleCheck.ok ? '' : result.candleCheck.describe)
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }, [instrumentId, interval, tick])

  useEffect(() => {
    void load()
  }, [load])

  // The chart draws exactly what this list shows, from the same objects.
  useEffect(() => {
    if (!onMarkers) return
    const markers: PatternMarker[] = [...found, ...developing].map((one) => ({
      key: one.detection.key,
      name: one.detection.patternName,
      direction: one.detection.direction,
      candleTimes: one.detection.candleTimes,
      emphasisTimes: one.detection.emphasisTimes,
      confirmed: one.detection.completeness === 'complete',
      match: one.detection.structuralMatch
    }))
    onMarkers(markers)
  }, [found, developing, onMarkers])

  const all = useMemo(() => [...developing, ...found], [developing, found])
  const showing = open ?? selected ?? null
  const chosen = all.find((one) => one.detection.key === showing) ?? null

  if (disabled) {
    return (
      <section className="mk-panel" aria-label="Candlestick patterns">
        <header className="mk-panel-head">
          <h3>
            <CandlestickChart size={15} aria-hidden /> Candlestick patterns
          </h3>
        </header>
        <p className="mk-empty">
          {describe || 'Candlestick pattern detection is switched off.'} Prices, charts, watchlists and every other Markets
          alert are unaffected.
        </p>
      </section>
    )
  }

  return (
    <section className="mk-panel" aria-label="Candlestick patterns">
      <header className="mk-panel-head">
        <h3>
          <CandlestickChart size={15} aria-hidden /> Candlestick patterns
        </h3>
        <span className="mk-panel-sub">
          {symbol} · {interval}
        </span>
        <button type="button" className="mk-mini" onClick={() => setTick((one) => one + 1)} disabled={busy}>
          {busy ? 'Examining…' : 'Examine again'}
        </button>
      </header>

      {problem !== '' && (
        <p className="mk-problem" role="alert">
          <AlertTriangle size={14} aria-hidden /> {problem}
        </p>
      )}

      {candleNote !== '' && (
        <p className="mk-note" role="note">
          <ShieldAlert size={14} aria-hidden /> {candleNote}
        </p>
      )}

      {all.length === 0 && problem === '' && (
        <p className="mk-empty">
          {describe || 'No formation on these candles met the thresholds.'} Most candles are not named formations, so this
          is an ordinary answer rather than a failure.
        </p>
      )}

      {all.length > 0 && (
        <ul className="mk-pattern-list">
          {all.map((one) => {
            const isOpen = one.detection.key === showing
            return (
              <li key={one.detection.key} className={isOpen ? 'mk-pattern-row mk-pattern-open' : 'mk-pattern-row'}>
                <button
                  type="button"
                  className="mk-pattern-head"
                  aria-expanded={isOpen}
                  onClick={() => {
                    const next = isOpen ? null : one.detection.key
                    setOpen(next)
                    onSelect?.(next)
                  }}
                >
                  <ChevronRight size={14} aria-hidden className={isOpen ? 'mk-pattern-caret mk-open' : 'mk-pattern-caret'} />
                  <span className="mk-pattern-name">{one.detection.patternName}</span>
                  <DirectionMark direction={one.detection.direction} />
                  {one.detection.completeness === 'developing' && <span className="mk-pattern-tag">still forming</span>}
                  <span className="mk-pattern-match">
                    {one.match} match · {(one.detection.structuralMatch * 100).toFixed(0)}%
                  </span>
                </button>

                {isOpen && (
                  <div className="mk-pattern-body">
                    <p className="mk-pattern-describe">{one.detection.describe}</p>

                    {one.detection.completeness === 'developing' && (
                      <p className="mk-note" role="note">
                        <Info size={14} aria-hidden /> The last candle has not closed. This is the shape so far, not what it
                        will be, and it cannot be confirmed or alerted on.
                      </p>
                    )}

                    <dl className="mk-pattern-facts">
                      <div>
                        <dt>Match strength</dt>
                        <dd>
                          {(one.detection.structuralMatch * 100).toFixed(0)}% — how comfortably the candles cleared the
                          thresholds in Orbis's definition. It is not a probability of any price move.
                        </dd>
                      </div>
                      <div>
                        <dt>Data quality</dt>
                        <dd>
                          {QUALITY_WORD[one.detection.dataQuality.level] ?? one.detection.dataQuality.level}
                          {one.detection.dataQuality.reasons.length > 0 && ` — ${one.detection.dataQuality.reasons.join('; ')}`}
                        </dd>
                      </div>
                      <div>
                        <dt>Definition</dt>
                        <dd>
                          {one.detection.patternId} v{one.detection.patternVersion}
                          {one.detection.alsoMatches.length > 0 && ` · also satisfies ${one.detection.alsoMatches.join(', ')}`}
                        </dd>
                      </div>
                      <div>
                        <dt>Candle</dt>
                        <dd>
                          {timeText(one.detection.at)}
                          {onGoToTime && (
                            <button type="button" className="mk-link" onClick={() => onGoToTime(one.detection.at)}>
                              show on the chart
                            </button>
                          )}
                        </dd>
                      </div>
                    </dl>

                    <h4>Why it was identified</h4>
                    <ul className="mk-pattern-rules">
                      {one.detection.evidence.structural
                        .filter((rule) => rule.passed)
                        .map((rule) => (
                          <li key={rule.id}>
                            <Check size={12} aria-hidden /> <span className="mk-rule-text">{rule.describe}</span> — {rule.measured}
                          </li>
                        ))}
                      {one.detection.evidence.context
                        .filter((rule) => rule.passed)
                        .map((rule) => (
                          <li key={rule.id}>
                            <Check size={12} aria-hidden /> <span className="mk-rule-text">{rule.describe}</span> — {rule.measured}
                          </li>
                        ))}
                    </ul>

                    {one.detection.evidence.unmetPreferences.length > 0 && (
                      <>
                        <h4>The definition prefers, and did not get</h4>
                        <ul className="mk-pattern-rules mk-dim">
                          {one.detection.evidence.unmetPreferences.map((text) => (
                            <li key={text}>
                              <Minus size={12} aria-hidden /> {text}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}

                    {one.context !== null && (
                      <>
                        <h4>What was going on around it</h4>
                        <p className="mk-pattern-describe">{one.context.regime.describe}</p>

                        {one.context.agreements.length > 0 && (
                          <>
                            <h5>Pointing the same way</h5>
                            <ul className="mk-pattern-rules">
                              {one.context.agreements.map((text) => (
                                <li key={text}>
                                  <Check size={12} aria-hidden /> {text}
                                </li>
                              ))}
                            </ul>
                          </>
                        )}

                        {one.context.conflicts.length > 0 && (
                          <>
                            <h5>Pointing against it</h5>
                            <ul className="mk-pattern-rules mk-against">
                              {one.context.conflicts.map((text) => (
                                <li key={text}>
                                  <X size={12} aria-hidden /> {text}
                                </li>
                              ))}
                            </ul>
                          </>
                        )}

                        {one.context.unavailable.length > 0 && (
                          <p className="mk-note" role="note">
                            <Info size={14} aria-hidden /> Could not be read at all: {one.context.unavailable.join(', ')}. An
                            absent reading is not a neutral one.
                          </p>
                        )}

                        {one.context.agreements.length > 0 && one.context.conflicts.length > 0 && (
                          <p className="mk-note" role="note">
                            These are listed rather than combined. One observation for and one against do not cancel out.
                          </p>
                        )}

                        {one.timeframeAgreement !== null && (
                          <p className="mk-pattern-describe">
                            <Layers size={13} aria-hidden /> Other timeframes: {readable(one.timeframeAgreement)}
                            {one.timeframeAgreement === 'opposed' && ' — both readings are true; neither cancels the other.'}
                          </p>
                        )}
                      </>
                    )}

                    {one.context === null && (
                      <p className="mk-note" role="note">
                        <Info size={14} aria-hidden /> Context analysis is switched off, so nothing is known here about the
                        trend, the levels, the volume or the momentum around this formation.
                      </p>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {nearMisses.length > 0 && (
        <details className="mk-pattern-misses">
          <summary>
            <Search size={13} aria-hidden /> {nearMisses.length} formation{nearMisses.length === 1 ? '' : 's'} that missed by
            one rule
          </summary>
          <ul className="mk-pattern-rules mk-dim">
            {nearMisses.map((one) => (
              <li key={`${one.patternId}-${one.at}`}>
                <span className="mk-rule-text">{one.patternName}</span> — {one.failedRule.describe}: {one.failedRule.measured}
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="mk-note mk-pattern-foot" role="note">
        <Info size={14} aria-hidden /> A candlestick pattern is a shape the candles made. Detecting one says nothing about
        what the price will do next. Definitions vary between sources; these are the ones Orbis uses, and each carries the
        version that produced it.
      </p>

      {chosen !== null && chosen.explain.length > 0 && (
        <details className="mk-pattern-misses">
          <summary>The explanation in full</summary>
          <ul className="mk-pattern-rules">
            {chosen.explain.map((line, i) => (
              <li key={`${i}-${line.slice(0, 20)}`}>{line}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
