import { useEffect, useState, type ReactElement } from 'react'
import { ListChecks, Pause, Play } from 'lucide-react'
import { SOURCE_KIND_LABELS, SOURCE_KINDS } from '../../../shared/researchSources'
import type { ResearchRunView } from '../../../shared/types'

/**
 * Research while it is running: what it means to do, and the controls that can change it.
 *
 * Until now the only thing anybody could do to a research run was stop it, and stopping threw away every page it had
 * already read. So the useful request -- "keep what you have, but stay on official sources from here" -- had no way
 * to be made at all.
 *
 * The honesty is in the wording. What can still be changed depends on how far the run has got: before it searches,
 * the searches themselves; after that, only which of the pages it found are preferred and which sites it will not
 * read. The buttons that cannot do anything any more are disabled rather than offered and quietly ignored, and when a
 * request does arrive too late the run says so.
 */
export default function ResearchRunning(): ReactElement | null {
  const [run, setRun] = useState<ResearchRunView | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    // Asked once in case a run was already going when this mounted, then followed as it moves.
    void window.api
      .researchRuns()
      .then((all) => setRun(all[0] ?? null))
      .catch(() => undefined)
    return window.api.onResearchRun((view, said) => {
      setRun(view.stage === 'done' ? null : view)
      if (said) setNote(said)
    })
  }, [])

  if (!run) return null
  const canChangeSearches = run.stage === 'planning'

  const steer = (change: Parameters<typeof window.api.steerResearch>[1]): void => {
    void window.api.steerResearch(run.id, change).catch(() => undefined)
  }

  return (
    <section className="research-run" aria-label="Research in progress">
      <div className="research-run-head">
        <ListChecks size={13} aria-hidden="true" />
        <b>{run.paused ? 'Research is held' : 'Researching'}</b>
        <button
          type="button"
          className="queue-btn small"
          onClick={() => void (run.paused ? window.api.resumeResearch(run.id) : window.api.pauseResearch(run.id))}
        >
          {run.paused ? <Play size={12} aria-hidden="true" /> : <Pause size={12} aria-hidden="true" />}
          {run.paused ? 'Carry on' : 'Hold'}
        </button>
      </div>

      <ol className="research-run-plan">
        {run.plan.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ol>

      {/* The searches can only be changed before any of them has been sent. After that the button would be a lie. */}
      {canChangeSearches &&
        (editing ? (
          <div className="setting-row-inline">
            <input
              value={draft}
              autoFocus
              placeholder="One search per line, or separated by commas"
              aria-label="What to search for instead"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                steer({ queries: draft.split(/[\n,]/).map((one) => one.trim()).filter(Boolean) })
                setEditing(false)
                setDraft('')
              }}
            />
            <button type="button" className="queue-btn small" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" className="queue-btn small" onClick={() => (setDraft(run.plan.filter((l) => l.includes('Search for')).map((l) => l.replace(/^\d+\. Search for "|"$/g, '')).join(', ')), setEditing(true))}>
            Change the searches
          </button>
        ))}

      <div className="research-run-prefer">
        <span className="view-muted small">Lean towards</span>
        {SOURCE_KINDS.map((kind) => (
          <button key={kind} type="button" className="queue-btn small" title={SOURCE_KIND_LABELS[kind].blurb} onClick={() => steer({ prefer: [kind] })}>
            {SOURCE_KIND_LABELS[kind].label}
          </button>
        ))}
      </div>

      {note && <p className="view-muted small research-run-note">{note}</p>}
    </section>
  )
}
