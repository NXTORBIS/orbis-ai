import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, FileBox, Image, MapPin, Music, Newspaper, Search, Sparkles, Telescope, Users, Video } from 'lucide-react'
import type { SearchVertical } from '../../../shared/orbisSearch'
import { searchPageUrl, VERTICALS } from '../../../shared/orbisSearch'
import type { SearchOutcomeView } from '../../../shared/types'
import type { SpecializedOutcome, SpecializedResult } from '../../../shared/searchProviders'
import { saidDuration } from '../../../shared/searchProviders'
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
  news: Newspaper,
  maps: MapPin,
  music: Music,
  science: Telescope,
  files: FileBox,
  social: Users
}

const VERTICAL_LABEL: Record<SearchVertical, string> = {
  all: 'All',
  images: 'Images',
  videos: 'Videos',
  news: 'News',
  maps: 'Maps',
  music: 'Music',
  science: 'Science',
  files: 'Files',
  social: 'Social'
}

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
  /** What a specialized category came back with. Web search and the categories never mix on one page. */
  const [special, setSpecial] = useState<SpecializedOutcome | null>(null)
  const [searching, setSearching] = useState(true)
  const [typed, setTyped] = useState(query)
  const latest = useRef(0)

  useEffect(() => setTyped(query), [query])

  const run = useCallback(
    async (q: string, where: SearchVertical) => {
      const mine = ++latest.current
      setSearching(true)
      // What is on screen belongs to the search that is over; showing it under the new one would be a lie.
      setOutcome(null)
      setSpecial(null)
      const result = await window.api.runSearch(q, where).catch(() => null)
      // A slower earlier search must not overwrite a newer one.
      if (mine !== latest.current) return
      if (result && 'category' in result) {
        setSpecial(result)
        setOutcome(null)
      } else {
        setOutcome(result)
        setSpecial(null)
      }
      setSearching(false)
    },
    []
  )

  useEffect(() => {
    if (query.trim()) void run(query, vertical)
    else {
      setOutcome(null)
      setSpecial(null)
      setSearching(false)
    }
  }, [query, vertical, run])

  const answer = outcome?.wantsAnswer ? onAskOrion(outcome.query, outcome.results) : null
  const problem = outcome?.problem ?? special?.problem ?? null

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
        {searching && <p className="osearch-status view-muted">{vertical === 'all' ? 'Searching the web…' : `Searching ${VERTICAL_LABEL[vertical].toLowerCase()}…`}</p>}

        {!searching && problem && <p className="osearch-status view-muted">{problem}</p>}

        {special && special.results.length > 0 && <SpecializedResults outcome={special} onOpen={onOpen} />}

        {special && special.unavailable.length > 0 && (
          <p className="osearch-foot view-muted">
            {special.unavailable.length === 1 ? 'One source' : `${special.unavailable.length} sources`} could not be reached: {special.unavailable.join(', ')}.
          </p>
        )}

        {special && special.results.length > 0 && (
          <footer className="osearch-foot view-muted">
            {special.results.length} results in {(special.tookMs / 1000).toFixed(1)}s · searched by Orbis, not by anyone watching you
          </footer>
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


/**
 * A category's results, drawn as that kind of thing.
 *
 * A picture is shown as a picture, a video with its length and channel, a place with where it is, a paper with who
 * wrote it. Everything here comes from the result: a field that did not arrive is simply not drawn, so nothing on
 * screen is something Orbis made up.
 */
function SpecializedResults({ outcome, onOpen }: { outcome: SpecializedOutcome; onOpen(url: string): void }): React.JSX.Element {
  const grid = outcome.category === 'images'

  if (grid) {
    return (
      <ul className="osearch-images" aria-label="Image results">
        {outcome.results.map((result) => (
          <li key={result.image ?? result.url}>
            <button type="button" className="osearch-image" onClick={() => onOpen(result.url)} title={`${result.title} - ${result.site}`}>
              <img src={result.thumbnail ?? result.image} alt={result.title} loading="lazy" />
              <span className="osearch-image-meta">
                <b className="truncate">{result.title}</b>
                <small className="truncate">
                  {result.site}
                  {result.width && result.height ? ` - ${result.width}x${result.height}` : ''}
                </small>
              </span>
            </button>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <ul className="osearch-results">
      {outcome.results.map((result) => (
        <li key={result.url}>
          <button type="button" className="osearch-result" onClick={() => onOpen(result.url)}>
            {result.thumbnail && (
              <span className="osearch-thumb">
                <img src={result.thumbnail} alt="" loading="lazy" />
                {result.durationSec ? <em>{saidDuration(result.durationSec)}</em> : null}
              </span>
            )}
            <span className="osearch-result-text">
              <span className="osearch-site">
                {result.site}
                <ArrowUpRight size={12} aria-hidden="true" />
              </span>
              <b>{result.title}</b>
              {result.snippet && <span className="osearch-snippet">{result.snippet}</span>}
              <SpecializedFacts result={result} />
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/** The few things worth saying about a result beyond its title, and only the ones it actually came with. */
function SpecializedFacts({ result }: { result: SpecializedResult }): React.JSX.Element | null {
  const facts = [
    result.author,
    result.publisher,
    result.address,
    result.published,
    result.kind !== 'videos' && result.durationSec ? saidDuration(result.durationSec) : undefined,
    result.latitude !== undefined && result.longitude !== undefined ? `${result.latitude.toFixed(4)}, ${result.longitude.toFixed(4)}` : undefined
  ].filter(Boolean)
  if (!facts.length) return null
  return <small className="osearch-facts view-muted">{facts.join(' - ')}</small>
}
