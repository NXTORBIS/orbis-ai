import { useEffect, useState, type ReactElement } from 'react'
import { ListChecks, Pause, Play } from 'lucide-react'
import type { ResearchRunView } from '../../../shared/types'

/**
 * Research while it is running: one line, and a way to hold it.
 *
 * This used to show the whole plan -- every search it meant to run, a button to rewrite them, and a row of five
 * buttons for leaning towards official sources or news or forums. It was ten lines of machinery in the middle of a
 * conversation, and it pushed the answer somebody was waiting for off the screen. So the steering is gone and what
 * is left says what is happening and lets you hold it.
 *
 * The steering itself still exists underneath -- `window.api.steerResearch` and the stage rules behind it are
 * untouched -- so a quieter way back to it can be added without rebuilding any of this.
 */
export default function ResearchRunning(): ReactElement | null {
  const [run, setRun] = useState<ResearchRunView | null>(null)
  const [note, setNote] = useState<string | null>(null)

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

      {note && <p className="view-muted small research-run-note">{note}</p>}
    </section>
  )
}
