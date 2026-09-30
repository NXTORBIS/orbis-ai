import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Clock, ExternalLink, Globe, Search, Trash2, X } from 'lucide-react'
import type { RecallHit } from '../../../shared/recall'
import type { RecallOverview } from '../../../main/knowledge/recallIpc'

/**
 * The pages this person has read, and the one place to search or delete them.
 *
 * Three things it is deliberate about:
 *
 * **It says what it holds before it shows anything.** How many pages, how much room, which sites most — because the
 * first question somebody has about a feature that records their reading is "what have you got".
 *
 * **Deleting is never more than one step away.** Every row has it, every site has it, the last hour has it, and so does
 * all of it. A recording feature where forgetting is buried is a recording feature nobody should trust.
 *
 * **It is honest that the file is not encrypted.** Search needs the text, so the text is on the disk in readable form.
 * That sentence is on this screen rather than in a document nobody opens.
 */

const refused = (value: unknown): value is { error: string; message?: string } =>
  typeof value === 'object' && value !== null && typeof (value as { error?: unknown }).error === 'string'

const when = (at: number): string => {
  const ms = Date.now() - at
  if (ms < 60_000) return 'just now'
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min ago`
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)} h ago`
  const days = Math.round(ms / 86_400_000)
  if (days < 30) return `${days} d ago`
  return new Date(at).toLocaleDateString()
}

export interface RecallViewProps {
  onClose: () => void
  onNotify?: (text: string, kind?: 'info' | 'error') => void
}

export default function RecallView({ onClose, onNotify }: RecallViewProps): React.JSX.Element {
  const [overview, setOverview] = useState<RecallOverview | null>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<RecallHit[]>([])
  const [host, setHost] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [searched, setSearched] = useState(false)
  const box = useRef<HTMLInputElement | null>(null)

  const load = useCallback(async () => {
    const answer = await window.api.recallOverview()
    if (!refused(answer)) setOverview(answer)
  }, [])

  useEffect(() => {
    void load()
    return window.api.onRecallChanged(() => void load())
  }, [load])

  /** The recent list is what the screen shows before anybody types: browsing, rather than searching. */
  const listRecent = useCallback(
    async (onlyHost?: string | null) => {
      const answer = await window.api.recallRecent(60, onlyHost ?? undefined)
      if (!refused(answer)) {
        setHits(answer.hits)
        setSearched(false)
      }
    },
    []
  )

  useEffect(() => {
    if (query.trim().length >= 2) return
    void listRecent(host)
  }, [query, host, listRecent])

  useEffect(() => {
    const wanted = query.trim()
    if (wanted.length < 2) return
    let dropped = false
    setBusy(true)
    const timer = window.setTimeout(() => {
      void window.api.recallSearch(wanted, { limit: 60, host: host ?? undefined }).then((answer) => {
        if (dropped) return
        setBusy(false)
        setSearched(true)
        setHits(refused(answer) ? [] : answer.hits)
      })
    }, 200)
    return () => {
      dropped = true
      window.clearTimeout(timer)
    }
  }, [query, host])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      // Escape clears the search first, and only closes the screen once there is nothing to clear.
      if (query) setQuery('')
      else if (host) setHost(null)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [query, host, onClose])

  const forget = async (hit: RecallHit): Promise<void> => {
    const answer = await window.api.recallForget(hit.id)
    if (refused(answer)) return
    setHits((current) => current.filter((one) => one.id !== hit.id))
    onNotify?.(`Forgot “${hit.title}”.`)
  }

  const forgetSite = async (site: string): Promise<void> => {
    const answer = await window.api.recallForgetSite(site, false)
    if (refused(answer)) return
    setHits((current) => current.filter((one) => one.host !== site))
    onNotify?.(`Forgot ${answer.forgotten} page${answer.forgotten === 1 ? '' : 's'} from ${site}.`)
  }

  const forgetHour = async (): Promise<void> => {
    const now = Date.now()
    const answer = await window.api.recallForgetBetween(now - 3_600_000, now)
    if (refused(answer)) return
    onNotify?.(`Forgot ${answer.forgotten} page${answer.forgotten === 1 ? '' : 's'} from the last hour.`)
    void listRecent(host)
  }

  const enabled = overview?.settings.enabled === true
  const nothingYet = useMemo(() => enabled && overview?.pages === 0, [enabled, overview])

  return (
    <div className="view rc">
      <div className="view-head">
        <h2>Pages you have read</h2>
        <div className="rc-head-actions">
          <button type="button" className="icon-btn" title="Close" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
      </div>

      {!enabled ? (
        <div className="rc-off">
          <h3>Orbis is not keeping what you read</h3>
          <p>
            Switched on, Orbis keeps the text of pages you read so you can find them again by what was in them — and so
            Orion can answer “what was that article about…” from what you actually read.
          </p>
          <ul className="rc-promises">
            <li>It stays on this computer. Nothing is uploaded, and there is no account.</li>
            <li>Text only. Orbis never takes a picture of your screen.</li>
            <li>Private tabs are never read, and neither are sign-in or payment pages.</li>
            <li>You can delete a page, a whole site, the last hour, or everything, at any time.</li>
            <li>Switching it off again deletes everything it kept.</li>
          </ul>
          <p className="rc-caution">
            One thing to know before you decide: the file is <b>not encrypted</b>. Searching needs the text, so it sits
            on your disk in readable form — anything that can read your files can read it. If that is not a trade you
            want, leave this off.
          </p>
          <button type="button" className="rc-primary" onClick={() => void window.api.recallSetSettings({ enabled: true })}>
            Start keeping what I read
          </button>
          <p className="rc-where">You can change this later in Settings.</p>
        </div>
      ) : (
        <>
          <div className="rc-bar">
            <div className="rc-search">
              <Search size={14} />
              <input
                ref={box}
                type="search"
                value={query}
                placeholder="Search what you have read"
                aria-label="Search what you have read"
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            {host && (
              <button type="button" className="rc-chip is-on" onClick={() => setHost(null)} title="Show every site">
                <Globe size={12} /> {host} <X size={11} />
              </button>
            )}
            <button type="button" className="rc-quiet" onClick={() => void forgetHour()} title="Forget the last hour">
              <Clock size={13} /> Forget the last hour
            </button>
          </div>

          {/* What it is holding, said plainly and first. */}
          {overview && (
            <p className="rc-holds">
              {overview.pages.toLocaleString()} page{overview.pages === 1 ? '' : 's'}, about {overview.size}
              {overview.oldestAt ? `, going back to ${new Date(overview.oldestAt).toLocaleDateString()}` : ''}.{' '}
              <button type="button" className="rc-link" onClick={() => void window.api.recallClear()}>
                Forget all of it
              </button>
            </p>
          )}

          {overview && overview.topHosts.length > 0 && !host && (
            <div className="rc-hosts">
              {overview.topHosts.map((one) => (
                <button type="button" key={one.host} className="rc-chip" onClick={() => setHost(one.host)}>
                  {one.host} <small>{one.pages}</small>
                </button>
              ))}
            </div>
          )}

          {nothingYet ? (
            <p className="rc-empty">
              Nothing kept yet. Orbis keeps a page once you have had it open and in front of you for a few seconds — so
              flicking through tabs does not fill this up.
            </p>
          ) : hits.length === 0 ? (
            <p className="rc-empty">
              {busy ? 'Looking…' : searched ? `Nothing you have read matches “${query.trim()}”.` : 'Nothing here yet.'}
            </p>
          ) : (
            <ul className="rc-list">
              {hits.map((hit) => (
                <li key={hit.id}>
                  <div className="rc-row">
                    <b>{hit.title}</b>
                    <span className="rc-meta">
                      <button type="button" className="rc-host" onClick={() => setHost(hit.host)} title={`Only ${hit.host}`}>
                        {hit.host}
                      </button>
                      <span className="rc-when">{when(hit.visitedAt)}</span>
                    </span>
                  </div>
                  {hit.snippet && <p className="rc-snippet">{hit.snippet}</p>}
                  <div className="rc-actions">
                    <button
                      type="button"
                      className="rc-quiet"
                      onClick={() => void window.api.openExternal(hit.url)}
                      title="Open it again"
                    >
                      <ExternalLink size={12} /> Open
                    </button>
                    <button type="button" className="rc-quiet" onClick={() => void forgetSite(hit.host)}>
                      Forget {hit.host}
                    </button>
                    <button type="button" className="rc-quiet is-danger" onClick={() => void forget(hit)}>
                      <Trash2 size={12} /> Forget this
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
