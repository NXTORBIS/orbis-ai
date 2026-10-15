import { useEffect, useState } from 'react'
import { Button } from '../../ui'
import { formatElapsed, isTerminal, jobHeadline } from '../../../../shared/neurova/composer'

export interface JobView { id: string; state: string; stage: string; cpuOnly: boolean; error: string | null; startedAt?: number; endedAt?: number | null }

/** Shows only what the job reports: its state and stage. No percentage is invented. */
export function GenerationProgress({ job, onCancel }: { job: JobView; onCancel: (id: string) => void }): React.JSX.Element {
  const live = !isTerminal(job.state)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [live])
  const end = job.endedAt ?? now
  const elapsed = job.startedAt ? formatElapsed(end - job.startedAt) : null
  const bar = job.state === 'completed' ? 'is-done' : live ? '' : 'is-failed'
  return (
    <div className="nv-gen" role="status" aria-live="polite">
      {live && <span className="nv-pulse" aria-hidden="true" />}
      <strong>{jobHeadline(job.state)}</strong>
      {live && job.stage && <span className="nv-faint">{job.stage}</span>}
      {elapsed && <span className="nv-faint" aria-label={`Elapsed ${elapsed}`}>{elapsed}</span>}
      {live && <Button size="tiny" kind="danger" onClick={() => onCancel(job.id)}>Cancel</Button>}
      <div className={`nv-bar ${bar}`} aria-hidden="true" />
      {live && job.cpuOnly && <p className="nv-note">No supported graphics card was found, so this song is made on the processor. That can take a long time.</p>}
      {job.error && <p className="nv-note nv-bad" role="alert">{job.error}</p>}
    </div>
  )
}
