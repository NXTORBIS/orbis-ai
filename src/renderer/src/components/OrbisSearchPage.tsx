import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, FileBox, Image, MapPin, Mic, Music, Newspaper, Search, Sparkles, Square, Telescope, Users, Video } from 'lucide-react'
import { useVoiceInput } from '../hooks/useVoiceInput'
import MediaViewer, { ShareButton, SiteIcon } from './SearchMedia'
import type { NoticeKind } from '../App'
import type { SearchVertical } from '../../../shared/orbisSearch'
import { searchPageUrl, VERTICALS } from '../../../shared/orbisSearch'
import type { SearchOutcomeView } from '../../../shared/types'
import type { SpecializedOutcome, SpecializedResult } from '../../../shared/searchProviders'
import { saidCount, saidDuration } from '../../../shared/searchProviders'
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
  orion: Sparkles,
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
  orion: 'Orion',
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
  /** Which result is being looked at, from the address. Null when the results themselves are showing. */
  at: number | null
  /** Opens a result, or a different search, the way any link in the browser opens. */
  onOpen(url: string): void
  /** Asks Orion to read the results and answer, streaming as it goes. */
  onAskOrion(query: string, results: SearchOutcomeView['results']): { text: string; done: boolean } | null
  onNotify?(message: string, kind?: NoticeKind): void
}

export default function OrbisSearchPage({ query, vertical, at, onOpen, onAskOrion, onNotify }: OrbisSearchPageProps): React.JSX.Element {
  const [outcome, setOutcome] = useState<SearchOutcomeView | null>(null)
  /** What a specialized category came back with. Web search and the categories never mix on one page. */
  const [special, setSpecial] = useState<SpecializedOutcome | null>(null)
  const [searching, setSearching] = useState(true)
  const [typed, setTyped] = useState(query)
  const latest = useRef(0)
  const boxRef = useRef<HTMLInputElement>(null)
  /**
   * Which result is being looked at comes from the address, so opening one is a navigation: the Back button closes it
   * and the results are exactly as they were, because they were never taken away.
   */
  const look = (index: number | null): void => onOpen(searchPageUrl(query, vertical, index ?? undefined))
  const voice = useVoiceInput('search')

  /**
   * The search box's microphone.
   *
   * The words land in the box for the person to read before they search: speaking is another way of typing, not a way
   * of skipping the moment where you notice it heard you wrong.
   */
  const speak = async (): Promise<void> => {
    const spoken = await voice.toggle()
    if (spoken) {
      setTyped((current) => (current.trim() ? `${current.trimEnd()} ${spoken}` : spoken))
      requestAnimationFrame(() => boxRef.current?.focus())
    }
  }

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

  // Orion answers on its own page. The web results are the web results, with nothing written over the top of them.
  const answer = vertical === 'orion' && outcome && outcome.results.length ? onAskOrion(outcome.query, outcome.results) : null
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
          <input ref={boxRef} value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Search the web with Orbis" placeholder="Search the web" spellCheck={false} />
          {voice.available && (
            <button
              type="button"
              className={`osearch-mic${voice.recording ? ' recording' : ''}`}
              aria-label={voice.recording ? 'Stop recording' : 'Speak instead of typing'}
              title={voice.recording ? `Stop recording (${Math.round(voice.recordingMs / 1000)}s)` : voice.transcribing ? 'Writing down what you said…' : 'Speak instead of typing'}
              disabled={voice.transcribing}
              onClick={() => void speak()}
            >
              {voice.recording ? <Square size={13} /> : <Mic size={14} />}
            </button>
          )}
        </form>

        <nav className="osearch-verticals" aria-label="What to search">
          {/* Orion is its own way of searching, not an answer bolted to the top of the web results. */}
          <button
            type="button"
            className={`osearch-vertical orion${vertical === 'orion' ? ' on' : ''}`}
            aria-current={vertical === 'orion'}
            onClick={() => onOpen(searchPageUrl(query, 'orion'))}
          >
            <Sparkles size={13} aria-hidden="true" /> Orion
          </button>
          {VERTICALS.filter((name) => name !== 'orion').map((name) => {
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

        {special && special.results.length > 0 && (
          <SpecializedResults outcome={special} onOpen={onOpen} onLook={look} onNotify={onNotify} />
        )}

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
            {outcome.results.map((result) => (
              <li key={result.url}>
                <div className="osearch-result-row">
                  <button type="button" className="osearch-result" onClick={() => onOpen(result.url)}>
                    <span className="osearch-site">
                      <SiteIcon url={result.url} />
                      <span className="osearch-site-name">{result.site}</span>
                      <ArrowUpRight size={12} aria-hidden="true" />
                    </span>
                    <b>{result.title}</b>
                    {result.snippet && <span className="osearch-snippet">{result.snippet}</span>}
                  </button>
                  <ShareButton url={result.url} title={result.title} onNotify={onNotify} />
                </div>
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

      {special && at !== null && at < special.results.length && (
        <MediaViewer results={special.results} index={at} onIndex={look} onClose={() => look(null)} onOpen={onOpen} onNotify={onNotify} />
      )}
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
function SpecializedResults({
  outcome,
  onOpen,
  onLook,
  onNotify
}: {
  outcome: SpecializedOutcome
  onOpen(url: string): void
  onLook(index: number): void
  onNotify?(message: string, kind?: NoticeKind): void
}): React.JSX.Element {
  const grid = outcome.category === 'images'
  // A picture or a video is looked at here; anything else is a page, and pages open as pages.
  const viewable = outcome.category === 'images' || outcome.category === 'videos'

  if (grid) {
    return (
      <ul className="osearch-images" aria-label="Image results">
        {outcome.results.map((result, i) => (
          <li key={result.image ?? result.url}>
            <button type="button" className="osearch-image" onClick={() => onLook(i)} title={`${result.title} - ${result.site}`}>
              <img src={result.thumbnail ?? result.image} alt={result.title} loading="lazy" />
              <span className="osearch-image-meta">
                <b className="truncate">{result.title}</b>
                <small className="truncate">
                  <SiteIcon url={result.url} size={13} />
                  {result.site}
                  {result.width && result.height ? ` · ${result.width}×${result.height}` : ''}
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
      {outcome.results.map((result, i) => (
        <li key={result.url} className="osearch-result-row">
          <button type="button" className={`osearch-result${result.thumbnail ? ' media' : ''}`} onClick={() => (viewable ? onLook(i) : onOpen(result.url))}>
            {result.thumbnail && (
              <span className="osearch-thumb">
                <img src={result.thumbnail} alt="" loading="lazy" />
                {result.durationSec ? <em>{saidDuration(result.durationSec)}</em> : null}
              </span>
            )}
            <span className="osearch-result-text">
              <span className="osearch-site">
                <SiteIcon url={result.url} />
                <span className="osearch-site-name">{result.site}</span>
                <ArrowUpRight size={12} aria-hidden="true" />
              </span>
              <b>{result.title}</b>
              {result.snippet && <span className="osearch-snippet">{result.snippet}</span>}
              <SpecializedFacts result={result} />
            </span>
          </button>
          <ShareButton url={result.url} title={result.title} onNotify={onNotify} />
        </li>
      ))}
    </ul>
  )
}

/** The few things worth saying about a result beyond its title, and only the ones it actually came with. */
function SpecializedFacts({ result }: { result: SpecializedResult }): React.JSX.Element | null {
  const facts = [
    result.author,
    saidCount(result.views) ? `${saidCount(result.views)} views` : undefined,
    result.publisher,
    result.address,
    result.published,
    result.kind !== 'videos' && result.durationSec ? saidDuration(result.durationSec) : undefined,
    result.latitude !== undefined && result.longitude !== undefined ? `${result.latitude.toFixed(4)}, ${result.longitude.toFixed(4)}` : undefined
  ].filter(Boolean)
  if (!facts.length) return null
  return <small className="osearch-facts view-muted">{facts.join(' - ')}</small>
}
