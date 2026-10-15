// NEUROVA job lifecycle. The coordinator owns state; the UI only reads it.

export type JobState =
  | 'queued' | 'preparing' | 'generating' | 'validating' | 'completed'
  | 'cancelling' | 'cancelled' | 'failed' | 'interrupted'

const NEXT: Record<JobState, JobState[]> = {
  queued: ['preparing', 'cancelled', 'failed'],
  preparing: ['generating', 'cancelling', 'failed', 'interrupted'],
  generating: ['validating', 'cancelling', 'failed', 'interrupted'],
  validating: ['completed', 'failed', 'cancelling', 'interrupted'],
  cancelling: ['cancelled', 'failed'],
  completed: [], cancelled: [], failed: [], interrupted: []
}

export const isTerminal = (s: JobState): boolean => NEXT[s].length === 0

export interface Job {
  id: string
  state: JobState
  /** Highest event sequence applied; late events with a lower number are ignored. */
  seq: number
  /** Recorded only once validation has accepted the audio. */
  outputPath: string | null
  error: string | null
}

export interface JobEvent { jobId: string; seq: number; to: JobState; outputPath?: string; error?: string }

export function newJob(id: string): Job {
  return { id, state: 'queued', seq: 0, outputPath: null, error: null }
}

/** Returns the same object when the event is stale, duplicate, foreign, or illegal. */
export function apply(job: Job, ev: JobEvent): Job {
  if (ev.jobId !== job.id || ev.seq <= job.seq || isTerminal(job.state)) return job
  if (!NEXT[job.state].includes(ev.to)) return job
  if (ev.to === 'completed' && !ev.outputPath) return job
  return {
    ...job,
    state: ev.to,
    seq: ev.seq,
    outputPath: ev.to === 'completed' ? (ev.outputPath as string) : job.outputPath,
    error: ev.to === 'failed' ? ev.error ?? 'Failed' : job.error
  }
}
