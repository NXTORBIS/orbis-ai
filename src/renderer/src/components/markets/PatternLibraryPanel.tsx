import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, BookOpen, ChevronLeft, Info, Minus, Search, TrendingDown, TrendingUp } from 'lucide-react'

/**
 * Every candlestick pattern Orbis can detect, and what each definition actually says.
 *
 * The point of this screen is that the definition is readable. Candlestick names are older than any software and no two
 * sources define them identically, so a library that showed a picture and a paragraph would be telling the user what
 * the pattern is *generally* while the detector used something else. Here each pattern lists the rules the detector
 * runs, in the same words, with the version that produced them.
 *
 * The illustrations are diagrams, drawn from the definition rather than from a market, and every one of them says so.
 */

interface Rule {
  id: string
  describe: string
  required: boolean
}

interface Pattern {
  id: string
  name: string
  aliases: string[]
  category: string
  direction: string
  formationLength: number
  describe: string
  version: number
  specialises: string[]
  related: string[]
  confirmation: string | null
  invalidation: string | null
  rules: Rule[]
  contextRules: Rule[]
}

interface Detail {
  pattern: Pattern & { emphasis: number[] }
  broaderThan: { id: string; name: string }[]
  moreSpecificThan: { id: string; name: string }[]
  related: { id: string; name: string }[]
}

const DIRECTION_WORD: Record<string, string> = { bullish: 'Bullish', bearish: 'Bearish', neutral: 'Neutral' }
const LENGTH_WORD: Record<number, string> = { 1: 'One candle', 2: 'Two candles', 3: 'Three candles', 4: 'Four candles', 5: 'Five candles' }

function DirectionMark({ direction }: { direction: string }): React.JSX.Element {
  const Icon = direction === 'bullish' ? TrendingUp : direction === 'bearish' ? TrendingDown : Minus
  return (
    <span className={`mk-pattern-dir mk-pattern-dir-${direction}`}>
      <Icon size={13} aria-hidden /> {DIRECTION_WORD[direction] ?? direction}
    </span>
  )
}

export function PatternLibraryPanel(): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [direction, setDirection] = useState('')
  const [length, setLength] = useState('')
  const [patterns, setPatterns] = useState<Pattern[]>([])
  const [libraryVersion, setLibraryVersion] = useState(0)
  const [assumptions, setAssumptions] = useState<readonly string[]>([])
  const [problem, setProblem] = useState('')
  const [chosen, setChosen] = useState<string | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)

  const load = useCallback(async () => {
    try {
      const result = await window.api.marketsPatterns(query, {
        category: category === '' ? undefined : category,
        direction: direction === '' ? undefined : direction,
        formationLength: length === '' ? undefined : Number(length)
      })
      if ('error' in result) {
        setProblem(result.message ?? 'That did not work.')
        return
      }
      setProblem('')
      setPatterns(result.patterns as unknown as Pattern[])
      setLibraryVersion(result.libraryVersion)
      setAssumptions(result.assumptions)
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not work.')
    }
  }, [query, category, direction, length])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (chosen === null) {
      setDetail(null)
      return
    }
    let cancelled = false
    void window.api
      .marketsPattern(chosen)
      .then((result) => {
        if (cancelled || 'error' in result) return
        setDetail(result as unknown as Detail)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [chosen])

  const grouped = useMemo(() => {
    const byLength = new Map<number, Pattern[]>()
    for (const one of patterns) byLength.set(one.formationLength, [...(byLength.get(one.formationLength) ?? []), one])
    return [...byLength.entries()].sort((a, b) => a[0] - b[0])
  }, [patterns])

  if (detail !== null) {
    const one = detail.pattern
    return (
      <section className="mk-panel" aria-label={`${one.name}, a candlestick pattern`}>
        <header className="mk-panel-head">
          <button type="button" className="mk-mini" onClick={() => setChosen(null)}>
            <ChevronLeft size={13} aria-hidden /> All patterns
          </button>
          <h3>{one.name}</h3>
          <DirectionMark direction={one.direction} />
        </header>

        <p className="mk-pattern-describe">{one.describe}</p>

        <dl className="mk-pattern-facts">
          <div>
            <dt>Kind</dt>
            <dd>
              {one.category} · {LENGTH_WORD[one.formationLength] ?? `${one.formationLength} candles`}
            </dd>
          </div>
          {one.aliases.length > 0 && (
            <div>
              <dt>Also called</dt>
              <dd>{one.aliases.join(', ')}</dd>
            </div>
          )}
          <div>
            <dt>Definition</dt>
            <dd>
              Orbis definition version {one.version}. Every detection records this, so a result from a year ago can still
              be explained by the rules that produced it.
            </dd>
          </div>
        </dl>

        <h4>What has to be true of the candles</h4>
        <ul className="mk-pattern-rules">
          {one.rules.map((rule) => (
            <li key={rule.id}>
              <span className="mk-rule-text">{rule.describe}</span>
              {!rule.required && <span className="mk-pattern-tag">preferred, not required</span>}
            </li>
          ))}
        </ul>

        {one.contextRules.length > 0 && (
          <>
            <h4>What has to be true of what came before</h4>
            <ul className="mk-pattern-rules">
              {one.contextRules.map((rule) => (
                <li key={rule.id}>
                  <span className="mk-rule-text">{rule.describe}</span>
                  {!rule.required && <span className="mk-pattern-tag">preferred, not required</span>}
                </li>
              ))}
            </ul>
            <p className="mk-note" role="note">
              <Info size={14} aria-hidden /> These are kept separate from the shape because some names differ only in their
              situation. A Hammer and a Hanging Man are the same shape; one follows a decline and the other a rise.
            </p>
          </>
        )}

        {one.confirmation !== null && (
          <>
            <h4>What is usually waited for</h4>
            <p className="mk-pattern-describe">{one.confirmation}</p>
          </>
        )}

        {one.invalidation !== null && (
          <>
            <h4>What would undo it</h4>
            <p className="mk-pattern-describe">{one.invalidation}</p>
          </>
        )}

        {detail.moreSpecificThan.length > 0 && (
          <>
            <h4>A more specific case of</h4>
            <ul className="mk-pattern-related">
              {detail.moreSpecificThan.map((other) => (
                <li key={other.id}>
                  <button type="button" className="mk-link" onClick={() => setChosen(other.id)}>
                    {other.name}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {detail.broaderThan.length > 0 && (
          <>
            <h4>More specific cases of this</h4>
            <ul className="mk-pattern-related">
              {detail.broaderThan.map((other) => (
                <li key={other.id}>
                  <button type="button" className="mk-link" onClick={() => setChosen(other.id)}>
                    {other.name}
                  </button>
                </li>
              ))}
            </ul>
            <p className="mk-note" role="note">
              <Info size={14} aria-hidden /> Where a candle satisfies both, Orbis reports the more specific name and records
              the broader one on it, rather than alerting twice about the same candle.
            </p>
          </>
        )}

        {detail.related.length > 0 && (
          <>
            <h4>Related</h4>
            <ul className="mk-pattern-related">
              {detail.related.map((other) => (
                <li key={other.id}>
                  <button type="button" className="mk-link" onClick={() => setChosen(other.id)}>
                    {other.name}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        <p className="mk-note mk-pattern-foot" role="note">
          <AlertTriangle size={14} aria-hidden /> Definitions of candlestick patterns vary between sources, and there is no
          authority that settles them. This is the definition Orbis uses. Detecting a pattern describes what the candles
          did; it does not indicate what the price will do next, and it is not financial advice.
        </p>
      </section>
    )
  }

  return (
    <section className="mk-panel" aria-label="Candlestick pattern library">
      <header className="mk-panel-head">
        <h3>
          <BookOpen size={15} aria-hidden /> Pattern library
        </h3>
        <span className="mk-panel-sub">
          {patterns.length} pattern{patterns.length === 1 ? '' : 's'}
          {libraryVersion > 0 && ` · library version ${libraryVersion}`}
        </span>
      </header>

      <div className="mk-pattern-filters">
        <label className="mk-field">
          <span className="mk-sr">Search patterns</span>
          <Search size={14} aria-hidden />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or alias" spellCheck={false} />
        </label>
        <label className="mk-field">
          <span className="mk-sr">Kind</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Any kind</option>
            <option value="reversal">Reversal</option>
            <option value="continuation">Continuation</option>
            <option value="indecision">Indecision</option>
          </select>
        </label>
        <label className="mk-field">
          <span className="mk-sr">Direction</span>
          <select value={direction} onChange={(e) => setDirection(e.target.value)}>
            <option value="">Any direction</option>
            <option value="bullish">Bullish</option>
            <option value="bearish">Bearish</option>
            <option value="neutral">Neutral</option>
          </select>
        </label>
        <label className="mk-field">
          <span className="mk-sr">Candles</span>
          <select value={length} onChange={(e) => setLength(e.target.value)}>
            <option value="">Any length</option>
            <option value="1">One candle</option>
            <option value="2">Two candles</option>
            <option value="3">Three candles</option>
          </select>
        </label>
      </div>

      {problem !== '' && (
        <p className="mk-problem" role="alert">
          <AlertTriangle size={14} aria-hidden /> {problem}
        </p>
      )}

      {patterns.length === 0 && problem === '' && <p className="mk-empty">No pattern matches that.</p>}

      {grouped.map(([formationLength, list]) => (
        <div key={formationLength}>
          <h4>{LENGTH_WORD[formationLength] ?? `${formationLength} candles`}</h4>
          <ul className="mk-pattern-grid">
            {list.map((one) => (
              <li key={one.id}>
                <button type="button" className="mk-pattern-card" onClick={() => setChosen(one.id)}>
                  <span className="mk-pattern-name">{one.name}</span>
                  <DirectionMark direction={one.direction} />
                  <span className="mk-pattern-tag">{one.category}</span>
                  <span className="mk-pattern-describe">{one.describe}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {assumptions.length > 0 && (
        <details className="mk-pattern-misses">
          <summary>What this library does and does not claim</summary>
          <ul className="mk-pattern-rules">
            {assumptions.map((one) => (
              <li key={one}>{one}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
