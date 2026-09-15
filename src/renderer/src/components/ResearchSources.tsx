import { useState } from 'react'
import { ChevronDown, Globe, PanelTop } from 'lucide-react'
import type { Research, ResearchSource } from '../../../shared/types'
import { citedNumbers } from '../../../shared/research'
import { openInOrbisBrowser } from '../lib/openInBrowser'

interface Props {
  research: Research
  content: string
  streaming: boolean
}

const formatDate = (iso: string): string => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

const formatRetrieved = (time: number): string => {
  const date = new Date(time)
  const sameDay = date.toDateString() === new Date().toDateString()
  return sameDay ? `today, ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * The pages an answer is based on. Sources the answer cites come first (they support its claims); the rest are listed
 * as also read. Each opens the exact page in the Orbis browser.
 */
export default function ResearchSources({ research, content, streaming }: Props): React.JSX.Element | null {
  const [showOthers, setShowOthers] = useState(false)
  const cited = citedNumbers(content, research.sources)
  const citedSources = cited.map((n) => research.sources.find((s) => s.n === n)).filter((s): s is ResearchSource => Boolean(s))
  const others = research.sources.filter((s) => !cited.includes(s.n))
  // Earlier research that this reply didn't use isn't shown again.
  if (research.reused && !streaming && !citedSources.length) return null

  const primary = streaming || !citedSources.length ? research.sources : citedSources
  const heading = streaming ? 'Reading sources' : citedSources.length ? 'Sources' : 'Pages researched'
  const openable = (citedSources.length ? citedSources : research.sources).map((s) => s.url)

  return (
    <section className="research-sources" aria-label="Sources">
      <div className="research-head">
        <Globe size={13} aria-hidden="true" />
        <b>{heading}</b>
        <span>
          {research.reused ? 'from earlier research' : `${research.sources.length} page${research.sources.length === 1 ? '' : 's'}`} · {formatRetrieved(research.retrievedAt)}
        </span>
        {!streaming && openable.length > 1 && (
          <button type="button" onClick={() => openInOrbisBrowser(openable)} title="Open each source in its own tab in the Orbis browser">
            <PanelTop size={12} />
            Open all in browser
          </button>
        )}
      </div>
      <ol className="research-list">
        {primary.map((source) => (
          <SourceRow key={source.n} source={source} />
        ))}
      </ol>
      {!streaming && citedSources.length > 0 && others.length > 0 && (
        <>
          <button type="button" className="research-more" aria-expanded={showOthers} onClick={() => setShowOthers((v) => !v)}>
            <ChevronDown size={12} className={showOthers ? 'open' : undefined} />
            Also read ({others.length})
          </button>
          {showOthers && (
            <ol className="research-list">
              {others.map((source) => (
                <SourceRow key={source.n} source={source} />
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  )
}

function SourceRow({ source }: { source: ResearchSource }): React.JSX.Element {
  const date = source.published ? formatDate(source.published) : source.updated ? `updated ${formatDate(source.updated)}` : null
  return (
    <li>
      <button type="button" className="research-source" title={`Open in Orbis browser: ${source.url}`} onClick={() => openInOrbisBrowser(source.url)}>
        <span className="research-n">{source.n}</span>
        <span className="research-main">
          <b>{source.title}</b>
          <small>
            {source.publisher ?? source.domain}
            {date ? ` · ${date}` : ''}
            {source.read ? '' : ' · search snippet only'}
          </small>
        </span>
        <PanelTop size={13} className="research-open" aria-hidden="true" />
      </button>
    </li>
  )
}
