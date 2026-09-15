import { useEffect, useMemo, useRef, useState } from 'react'
import { Bookmark, Clock, Download, FolderOpen, Pause, Play, RotateCcw, Search, Trash2, X } from 'lucide-react'
import type { BrowserDownload, BrowserLibrarySnapshot } from '../../../shared/types'

export type LibraryTab = 'history' | 'bookmarks' | 'downloads' | 'closed'

export interface ClosedTab {
  url: string
  title: string
  index: number
}

interface Props {
  tab: LibraryTab
  onTab(tab: LibraryTab): void
  onClose(): void
  /** Opens a page in a new tab. */
  onOpen(url: string): void
  closedTabs: ClosedTab[]
  onReopen(position: number): void
}

const TABS: { id: LibraryTab; label: string; icon: typeof Clock; shortcut: string }[] = [
  { id: 'history', label: 'History', icon: Clock, shortcut: 'Ctrl+H' },
  { id: 'bookmarks', label: 'Bookmarks', icon: Bookmark, shortcut: 'Ctrl+Shift+B' },
  { id: 'downloads', label: 'Downloads', icon: Download, shortcut: 'Ctrl+J' },
  { id: 'closed', label: 'Closed tabs', icon: RotateCcw, shortcut: 'Ctrl+Shift+T' }
]

const host = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

const when = (time: number): string => {
  const date = new Date(time)
  const today = new Date()
  const yesterday = new Date(today.getTime() - 86_400_000)
  const clock = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (date.toDateString() === today.toDateString()) return clock
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday ${clock}`
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}

const size = (bytes: number): string => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`)

function downloadStatus(d: BrowserDownload): string {
  if (d.state === 'completed') return `${size(d.receivedBytes)} · Done`
  if (d.state === 'cancelled') return 'Cancelled'
  if (d.state === 'interrupted') return "Couldn't finish"
  const progress = d.totalBytes ? `${size(d.receivedBytes)} of ${size(d.totalBytes)}` : size(d.receivedBytes)
  return d.state === 'paused' ? `${progress} · Paused` : progress
}

/** The browser's history, bookmarks, downloads and recently closed tabs, as a panel over the page. */
export default function BrowserLibraryPanel({ tab, onTab, onClose, onOpen, closedTabs, onReopen }: Props): React.JSX.Element {
  const [library, setLibrary] = useState<BrowserLibrarySnapshot | null>(null)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void window.api.getBrowserLibrary().then(setLibrary)
    return window.api.onBrowserLibrary(setLibrary)
  }, [])

  useEffect(() => {
    setQuery('')
    requestAnimationFrame(() => searchRef.current?.focus())
  }, [tab])

  const matches = (text: string): boolean => text.toLowerCase().includes(query.trim().toLowerCase())
  const history = useMemo(() => (library?.history ?? []).filter((h) => matches(`${h.title} ${h.url}`)).slice(0, 300), [library, query])
  const bookmarks = useMemo(() => (library?.bookmarks ?? []).filter((b) => matches(`${b.title} ${b.url}`)), [library, query])
  const searchable = tab === 'history' || tab === 'bookmarks'

  return (
    <aside
      className="browser-library"
      role="dialog"
      aria-label="Browser library"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <header className="browser-library-head">
        <div className="browser-library-tabs" role="tablist">
          {TABS.map(({ id, label, icon: Icon, shortcut }) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'selected' : undefined} title={`${label} (${shortcut})`} onClick={() => onTab(id)}>
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>
        <button type="button" className="b-icon" aria-label="Close library" onClick={onClose}>
          <X size={15} />
        </button>
      </header>

      {searchable && (
        <label className="browser-library-search">
          <Search size={13} />
          <input ref={searchRef} value={query} placeholder={`Search ${tab}`} aria-label={`Search ${tab}`} onChange={(e) => setQuery(e.target.value)} />
        </label>
      )}

      <div className="browser-library-body">
        {!library && <p className="browser-library-empty">Loading…</p>}

        {library && tab === 'history' && (
          <>
            {history.length === 0 && <p className="browser-library-empty">{query ? 'No pages match.' : 'Pages you visit appear here.'}</p>}
            <ul>
              {history.map((entry) => (
                <li key={`${entry.url}-${entry.visitedAt}`}>
                  <button type="button" className="browser-library-item" title={entry.url} onClick={() => onOpen(entry.url)}>
                    <b>{entry.title || host(entry.url)}</b>
                    <small>
                      {host(entry.url)} · {when(entry.visitedAt)}
                    </small>
                  </button>
                  <button type="button" className="b-icon" aria-label={`Remove ${entry.title || entry.url} from history`} onClick={() => void window.api.removeHistory(entry.url)}>
                    <X size={12} />
                  </button>
                </li>
              ))}
            </ul>
            {library.history.length > 0 && !query && (
              <button type="button" className="browser-library-clear" onClick={() => void window.api.clearHistory()}>
                <Trash2 size={12} />
                Clear history
              </button>
            )}
          </>
        )}

        {library && tab === 'bookmarks' && (
          <>
            {bookmarks.length === 0 && <p className="browser-library-empty">{query ? 'No bookmarks match.' : 'Bookmark a page with Ctrl+D or the star in the URL bar.'}</p>}
            <ul>
              {bookmarks.map((bookmark) => (
                <li key={bookmark.url}>
                  <button type="button" className="browser-library-item" title={bookmark.url} onClick={() => onOpen(bookmark.url)}>
                    <b>{bookmark.title || host(bookmark.url)}</b>
                    <small>{host(bookmark.url)}</small>
                  </button>
                  <button type="button" className="b-icon" aria-label={`Remove bookmark ${bookmark.title || bookmark.url}`} onClick={() => void window.api.removeBookmark(bookmark.url)}>
                    <X size={12} />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {library && tab === 'downloads' && (
          <>
            {library.downloads.length === 0 && <p className="browser-library-empty">Files you download are saved to your Downloads folder and listed here.</p>}
            <ul>
              {library.downloads.map((d) => (
                <li key={d.id} className={`download ${d.state}`}>
                  <div className="browser-library-item static" title={d.url}>
                    <b>{d.filename}</b>
                    <small>{downloadStatus(d)}</small>
                    {(d.state === 'progressing' || d.state === 'paused') && d.totalBytes > 0 && (
                      <span className="browser-library-progress" aria-hidden="true">
                        <span style={{ width: `${Math.min(100, (d.receivedBytes / d.totalBytes) * 100)}%` }} />
                      </span>
                    )}
                  </div>
                  <div className="browser-library-actions">
                    {d.state === 'completed' && (
                      <>
                        <button type="button" onClick={() => void window.api.downloadAction(d.id, 'open')}>
                          Open
                        </button>
                        <button type="button" className="b-icon" aria-label={`Show ${d.filename} in folder`} onClick={() => void window.api.downloadAction(d.id, 'show')}>
                          <FolderOpen size={13} />
                        </button>
                      </>
                    )}
                    {d.state === 'progressing' && (
                      <button type="button" className="b-icon" aria-label={`Pause ${d.filename}`} onClick={() => void window.api.downloadAction(d.id, 'pause')}>
                        <Pause size={13} />
                      </button>
                    )}
                    {d.state === 'paused' && (
                      <button type="button" className="b-icon" aria-label={`Resume ${d.filename}`} onClick={() => void window.api.downloadAction(d.id, 'resume')}>
                        <Play size={13} />
                      </button>
                    )}
                    {(d.state === 'progressing' || d.state === 'paused') && (
                      <button type="button" className="b-icon" aria-label={`Cancel ${d.filename}`} onClick={() => void window.api.downloadAction(d.id, 'cancel')}>
                        <X size={13} />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {library.downloads.some((d) => d.state !== 'progressing' && d.state !== 'paused') && (
              <button type="button" className="browser-library-clear" onClick={() => void window.api.clearDownloads()}>
                <Trash2 size={12} />
                Clear finished downloads
              </button>
            )}
          </>
        )}

        {tab === 'closed' && (
          <>
            {closedTabs.length === 0 && <p className="browser-library-empty">Tabs you close in this session appear here.</p>}
            <ul>
              {[...closedTabs].reverse().map((closed, i) => (
                <li key={`${closed.url}-${i}`}>
                  <button type="button" className="browser-library-item" title={closed.url} onClick={() => onReopen(closedTabs.length - 1 - i)}>
                    <b>{closed.title || host(closed.url)}</b>
                    <small>{host(closed.url)}</small>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </aside>
  )
}
