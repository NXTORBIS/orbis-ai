import { useEffect, useMemo, useRef, useState } from 'react'
import './research-sources.css'
import { AlertTriangle, ChevronDown, Globe, PanelTop } from 'lucide-react'
import type { Research, ResearchSource } from '../../../shared/types'
import { citedNumbers } from '../../../shared/research'
import { leftOutNote } from '../../../shared/researchSources'
import { provenanceNote, traceClaims, unsupported } from '../../../shared/researchProvenance'
import { openInOrbisBrowser } from '../lib/openInBrowser'

interface Props {
  research: Research
  content: string
  streaming: boolean
  /** A citation the reader clicked in the answer: open the list and point at that source. `tick` makes a repeat click count. */
  focus?: { n: number; tick: number } | null
}

/** The conversation column is this wide or wider before the list may sit beside the answer instead of under it. */
const WIDE_COLUMN = 860

/** A small round mark for a source: its site's own icon when it loads, otherwise the first letter of its name. */
function SourceMark({ source }: { source: ResearchSource }): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  const letter = (source.publisher ?? source.domain ?? '?').trim().charAt(0).toUpperCase() || '?'
  let origin: string | null = null
  try { origin = new URL(source.url).origin } catch { origin = null }
  if (failed || !origin || !/^https:/.test(origin)) return <span className="research-fav research-fav-letter" aria-hidden="true">{letter}</span>
  return <img className="research-fav" src={`${origin}/favicon.ico`} alt="" width={16} height={16} loading="lazy" onError={() => setFailed(true)} />
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
export default function ResearchSources({ research, content, streaming, focus }: Props): React.JSX.Element | null {
  const [showOthers, setShowOthers] = useState(false)
  // One line under the answer until asked for: the list is long and most answers are read without it.
  const [open, setOpen] = useState(false)
  const [wide, setWide] = useState(false)
  const root = useRef<HTMLElement>(null)
  const focused = focus?.n ?? null
  useEffect(() => {
    if (!focus) return
    setOpen(true)
    // Wait for the list to exist, then bring the chosen source into view.
    const id = window.setTimeout(() => root.current?.querySelector(`[data-source="${focus.n}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 60)
    return () => window.clearTimeout(id)
  }, [focus])
  // Whether the conversation column has room for the list beside the answer. Measured, not guessed from the window.
  useEffect(() => {
    const column = root.current?.closest('.messages-inner')
    if (!column || typeof ResizeObserver === 'undefined') return
    const measure = (): void => setWide(column.clientWidth >= WIDE_COLUMN)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(column)
    return () => observer.disconnect()
  }, [])
  // The answer is widened and given the side-column layout only while the list is open and there is room for it.
  const side = open && wide
  useEffect(() => {
    const card = root.current?.closest('.msg-card')
    const body = root.current?.closest('.msg-body')
    if (!card || !body) return
    card.classList.toggle('research-card-wide', side)
    body.classList.toggle('research-body-wide', side)
    return () => { card.classList.remove('research-card-wide'); body.classList.remove('research-body-wide') }
  }, [side])
  const cited = citedNumbers(content, research.sources)
  const citedSources = cited.map((n) => research.sources.find((s) => s.n === n)).filter((s): s is ResearchSource => Boolean(s))
  const others = research.sources.filter((s) => !cited.includes(s.n))
  /*
   * Where in each source a claim actually came from.
   *
   * Worked out from the answer and the sources once the answer has finished, so it costs nothing while it streams.
   * What it is really for is the other result: a claim whose source does not appear to say it. A number next to a
   * sentence looks like proof whether or not the page says anything of the kind, and until now nothing checked.
   */
  const traced = useMemo(() => (streaming ? [] : traceClaims(content, research.sources)), [streaming, content, research.sources])
  const shaky = useMemo(() => unsupported(traced), [traced])
  // Earlier research that this reply didn't use isn't shown again.
  if (research.reused && !streaming && !citedSources.length) return null

  const primary = streaming || !citedSources.length ? research.sources : citedSources
  const heading = streaming ? 'Reading sources' : citedSources.length ? 'Sources' : 'Pages researched'
  const openable = (citedSources.length ? citedSources : research.sources).map((s) => s.url)

  const marks = primary.slice(0, 5)
  const summary = streaming ? 'Reading sources' : citedSources.length ? 'Sources' : 'Pages researched'

  return (
    <section ref={root} className={`research-sources${side ? ' research-side' : ''}`} aria-label="Sources">
      <button type="button" className="research-summary" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="research-favs" aria-hidden="true">
          {marks.map((s) => <SourceMark key={s.n} source={s} />)}
        </span>
        <b>{summary} · {primary.length}</b>
        <ChevronDown size={13} className={open ? 'open' : undefined} aria-hidden="true" />
      </button>
      {open && <div className="research-body">
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
      {/*
        * Where the pages do not agree.
        *
        * Shown above the sources rather than buried under them, because when it is there it is usually the most
        * useful thing on the screen. Orbis found this by comparing the figures the pages state; it has not decided
        * which is right, and the wording says so.
        */}
      {!streaming && (research.conflicts?.length ?? 0) > 0 && (
        <div className="research-conflict" role="note">
          <AlertTriangle size={13} aria-hidden="true" />
          <div>
            <b>The sources do not agree.</b> Orbis compared what the pages state and has not decided which is right.
            <ul>
              {research.conflicts!.map((one) => (
                <li key={one.about}>
                  <span className="research-about">{one.about}</span>: {one.readings.map((r) => `[${r.n}] ${r.said}`).join(' · ')}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      <ol className="research-list">
        {primary.map((source) => (
          <SourceRow key={source.n} source={source} focused={focused === source.n} />
        ))}
      </ol>
      {/*
        * Claims whose source does not appear to say them.
        *
        * The wording is careful: Orbis read part of a page, so not finding something has two explanations, and
        * claiming the source is wrong would go beyond what was established.
        */}
      {!streaming && shaky.length > 0 && (
        <div className="research-conflict" role="note">
          <AlertTriangle size={13} aria-hidden="true" />
          <div>
            <b>{provenanceNote(traced)}</b>
            <ul>
              {shaky.slice(0, 3).map((one) => (
                <li key={`${one.n}-${one.claim.slice(0, 24)}`}>
                  <span className="research-about">[{one.n}]</span> {one.claim.length > 140 ? `${one.claim.slice(0, 137)}…` : one.claim}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {/* Sites you blocked. Said, so fewer results never looks like a thinner web. */}
      {!streaming && (research.leftOut ?? 0) > 0 && <p className="research-repeats view-muted">{leftOutNote(research.leftOut!)}</p>}
      {/* Pages that turned out to be the same page at another address. Said, so "six sources" never means one page six times. */}
      {!streaming && (research.repeats?.length ?? 0) > 0 && (
        <p className="research-repeats view-muted">
          {research.repeats!.length === 1 ? 'One other page' : `${research.repeats!.length} other pages`} carried the same text as{' '}
          {[...new Set(research.repeats!.map((one) => `[${one.sameAs}]`))].join(', ')} and {research.repeats!.length === 1 ? 'was' : 'were'} not counted again.
        </p>
      )}
      {!streaming && citedSources.length > 0 && others.length > 0 && (
        <>
          <button type="button" className="research-more" aria-expanded={showOthers} onClick={() => setShowOthers((v) => !v)}>
            <ChevronDown size={12} className={showOthers ? 'open' : undefined} />
            Also read ({others.length})
          </button>
          {showOthers && (
            <ol className="research-list">
              {others.map((source) => (
                <SourceRow key={source.n} source={source} focused={focused === source.n} />
              ))}
            </ol>
          )}
        </>
      )}
      </div>}
    </section>
  )
}

function SourceRow({ source, focused }: { source: ResearchSource; focused: boolean }): React.JSX.Element {
  const date = source.published ? formatDate(source.published) : source.updated ? `updated ${formatDate(source.updated)}` : null
  return (
    <li data-source={source.n} className={focused ? 'research-row-focused' : undefined}>
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
