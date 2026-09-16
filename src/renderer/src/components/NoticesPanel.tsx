import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Search, X } from 'lucide-react'
import type { NoticeEntry, Notices } from '../../../shared/types'

/**
 * The licences of everything Orbis is built from, in full.
 *
 * Almost all of them — MIT, BSD, ISC, Apache — require their copyright notice and licence text to travel with any copy
 * of the software, so this screen is a condition of shipping Orbis rather than a courtesy. The list is generated at
 * build time from what is actually installed, so it cannot quietly fall out of step with the app.
 */
export default function NoticesPanel({ onClose }: { onClose(): void }): React.JSX.Element {
  const [notices, setNotices] = useState<Notices | null | 'loading'>('loading')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [file, setFile] = useState<{ title: string; text: string } | null>(null)

  useEffect(() => {
    void window.api.notices().then((n) => setNotices(n))
  }, [])

  const shown = useMemo(() => {
    if (!notices || notices === 'loading') return []
    const all = [...notices.others, ...notices.packages]
    const needle = query.trim().toLowerCase()
    if (!needle) return all
    return all.filter((p) => p.name.toLowerCase().includes(needle) || p.license.toLowerCase().includes(needle))
  }, [notices, query])

  const showFile = async (which: 'electron' | 'chromium', title: string): Promise<void> => {
    const raw = await window.api.licenceFile(which)
    if (raw === null) return setFile({ title, text: `The ${title} licence could not be read. It ships as a file beside Orbis.` })
    // Chromium publishes its licences as a web page. Parsing it this way runs nothing and fetches nothing — it only
    // takes the words out, so what is shown is the licence itself rather than the markup around it.
    const text = which === 'chromium' ? (new DOMParser().parseFromString(raw, 'text/html').body?.textContent ?? raw).replace(/\n{3,}/g, '\n\n').trim() : raw
    setFile({ title, text })
  }

  if (file) {
    return (
      <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setFile(null)}>
        <div className="modal glass notices-modal" role="dialog" aria-modal="true" aria-label={file.title}>
          <div className="modal-header">
            <h2>{file.title}</h2>
            <button className="icon-btn" title="Back" onClick={() => setFile(null)}>
              <X size={16} />
            </button>
          </div>
          <div className="modal-body">
            {/* Chromium's licences arrive as a page of their own; shown as text so nothing in it can run here. */}
            <pre className="notices-text notices-file">{file.text}</pre>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal glass notices-modal" role="dialog" aria-modal="true" aria-labelledby="notices-title">
        <div className="modal-header">
          <h2 id="notices-title">Third-party notices</h2>
          <button className="icon-btn" title="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          {notices === 'loading' && <p className="view-muted">Reading the licences…</p>}
          {notices === null && (
            <p className="view-muted">
              The licence list could not be read. It is generated when Orbis is built; in a development copy, run <code>npm run notices</code>.
            </p>
          )}
          {notices && notices !== 'loading' && (
            <>
              <p className="view-muted notices-intro">
                Orbis is built on work by many other people. Their licences are reproduced here in full, as those licences require. This list is generated from what is actually
                installed, so it always matches the version you are running.
              </p>

              <div className="notices-files">
                <button type="button" className="queue-btn small" onClick={() => void showFile('electron', 'Electron licence')}>
                  Electron licence
                </button>
                <button type="button" className="queue-btn small" onClick={() => void showFile('chromium', 'Chromium licences')}>
                  Chromium licences
                </button>
              </div>

              <label className="notices-search">
                <Search size={13} aria-hidden="true" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${notices.packages.length} packages`} aria-label="Search the licences" />
              </label>

              <ul className="notices-list">
                {shown.map((entry) => (
                  <NoticeRow key={`${entry.name}@${entry.version}`} entry={entry} open={open === `${entry.name}@${entry.version}`} onToggle={(id) => setOpen((current) => (current === id ? null : id))} />
                ))}
                {shown.length === 0 && <li className="view-muted">Nothing matches that.</li>}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function NoticeRow({ entry, open, onToggle }: { entry: NoticeEntry; open: boolean; onToggle(id: string): void }): React.JSX.Element {
  const id = `${entry.name}@${entry.version}`
  return (
    <li className="notices-row">
      <button type="button" className="notices-head" aria-expanded={open} onClick={() => onToggle(id)}>
        {open ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
        <b>{entry.name}</b>
        <small className="view-muted">{entry.version}</small>
        <small className="notices-licence">{entry.license}</small>
      </button>
      {open && (
        <div className="notices-detail">
          {entry.homepage && <p className="view-muted notices-home">{entry.homepage}</p>}
          {entry.text ? (
            <pre className="notices-text">{entry.text}</pre>
          ) : (
            <p className="view-muted">This package ships no licence file of its own; it is published as {entry.license}.</p>
          )}
        </div>
      )}
    </li>
  )
}
