import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Image, Newspaper, Search, Sparkles, Video } from 'lucide-react'
import type { SearchVertical } from '../../../shared/orbisSearch'
import { searchPageUrl, VERTICALS } from '../../../shared/orbisSearch'
import type { SearchOutcomeView } from '../../../shared/types'
import { OrbisGlassMark, OrbisWordmark } from './Brand'

/**
 * Orbis Search: the results page Orbis draws itself.
 *
 * Everything around it is the Orbis browser exactly as it was — the same tabs, the same address bar, the same
 * controls. Only what fills the page is different: instead of being handed to somebody else's site, the web comes
 * back here, under Orbis's own name, with Orion's reading of it at the top when that is worth having.
 *
 * The answer is written from the results and says which ones it used, so it can always be checked. When the results
 * do not answer the question, it says so rather than filling the gap.
 */

const VERTICAL_ICON: Record<SearchVertical, typeof Search> = {
  all: Search,
  images: Image,
  videos: Video,
  news: Newspaper
}

const VERTICAL_LABEL: Record<SearchVertical, string> = { all: 'All', images: 'Images', videos: 'Videos', news: 'News' }

export interface OrbisSearchPageProps {
  query: string
  vertical: SearchVertical
  /** Opens a result, or a different search, the way any link in the browser opens. */
  onOpen(url: string): void
  /** Asks Orion to read the results and answer, streaming as it goes. */
  onAskOrion(query: string, results: SearchOutcomeView['results']): { text: string; done: boolean } | null
}

export default function OrbisSearchPage({ query, vertical, onOpen, onAskOrion }: OrbisSearchPageProps): React.JSX.Element {
  const [outcome, setOutcome] = useState<SearchOutcomeView | null>(null)
  const [searching, setSearching] = useState(true)
  const [typed, setTyped] = useState(query)
  const latest = useRef(0)

  useEffect(() => setTyped(query), [query])

  const run = useCallback(
    async (q: string, where: SearchVertical) => {
      const mine = ++latest.current
      setSearching(true)
      const result = await window.api.runSearch(q, where).catch(() => null)
      // A slower earlier search must not overwrite a newer one.
      if (mine !== latest.current) return
      setOutcome(result)
      setSearching(false)
    },
    []
  )

  useEffect(() => {
    if (query.trim()) void run(query, vertical)
    else {
      setOutcome(null)
      setSearching(false)
    }
  }, [query, vertical, run])

  const answer = outcome?.wantsAnswer ? onAskOrion(outcome.query, outcome.results) : null

  return (
    <div className="osearch" role="main" aria-label="Orbis Search">
      <header className="osearch-head">
        <div className="osearch-brand">
          <OrbisGlassMark size={30} />
          <OrbisWordmark className="osearch-wordmark" />
        </div>

        <form
          className="osearch-box"
          onSubmit={(e) => {
            e.preventDefault()
            if (typed.trim()) onOpen(searchPageUrl(typed, vertical))
          }}
        >
          <Search size={15} aria-hidden="true" />
          <input value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Search the web with Orbis" placeholder="Search the web" spellCheck={false} />
        </form>

        <nav className="osearch-verticals" aria-label="What to search">
          {VERTICALS.map((name) => {
            const Icon = VERTICAL_ICON[name]
            return (
              <button
                key={name}
                type="button"
                className={`osearch-vertical${name === vertical ? ' on' : ''}`}
                aria-current={name === vertical}
                onClick={() => onOpen(searchPageUrl(query, name))}
              >
                <Icon size={13} aria-hidden="true" /> {VERTICAL_LABEL[name]}
              </button>
            )
          })}
        </nav>
      </header>

      <div className="osearch-body">
        {searching && <p className="osearch-status view-muted">Searching the web…</p>}

        {!searching && outcome?.problem && (
          <p className="osearch-status view-muted">
            {outcome.problem}
          </p>
        )}

        {answer && (
          <section className="osearch-answer" aria-label="What Orion makes of the results">
            <h2>
              <Sparkles size={14} aria-hidden="true" /> Orion
            </h2>
            <p>
              {answer.text}
              {!answer.done && <span className="osearch-caret" aria-hidden="true" />}
            </p>
            {answer.done && <small className="view-muted">Written from the results below. The numbers say which.</small>}
          </section>
        )}

        {outcome && outcome.results.length > 0 && (
          <ol className="osearch-results">
            {outcome.results.map((result, i) => (
              <li key={result.url}>
                <button type="button" className="osearch-result" onClick={() => onOpen(result.url)}>
                  <span className="osearch-site">
                    <span className="osearch-index" aria-hidden="true">
                      {i + 1}
                    </span>
                    {result.site}
                    <ArrowUpRight size={12} aria-hidden="true" />
                  </span>
                  <b>{result.title}</b>
                  {result.snippet && <span className="osearch-snippet">{result.snippet}</span>}
                </button>
              </li>
            ))}
          </ol>
        )}

        {outcome && outcome.results.length > 0 && (
          <footer className="osearch-foot view-muted">
            {outcome.results.length} results in {(outcome.tookMs / 1000).toFixed(1)}s · searched by Orbis, not by anyone watching you ·{' '}
            <button type="button" className="osearch-elsewhere" onClick={() => onOpen(`https://www.google.com/search?q=${encodeURIComponent(outcome.query)}`)}>
              try Google instead
            </button>
          </footer>
        )}
      </div>
    </div>
  )
}
