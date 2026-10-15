import { randomUUID } from 'node:crypto'
import { Collection, profileFile } from '../storage/jsonFile.ts'
import { isTerminal } from '../../shared/neurova/job.ts'
import type { JobState } from '../../shared/neurova/job.ts'
import { shouldRetry } from '../../shared/neurova/scheduler.ts'
import type { FailureCode } from '../../shared/neurova/scheduler.ts'

const STATES: JobState[] = ['queued', 'preparing', 'generating', 'validating', 'completed', 'cancelling', 'cancelled', 'failed', 'interrupted']
const HISTORY_CAP = 50

export interface JobRequestSnapshot { prompt: string; lyrics: string; instrumental: boolean; durationSec: number; seed: number | null }
export interface JobTransition { state: JobState; at: number; reason: string }
export interface JobRecord {
  id: string
  projectId: string
  parentId: string | null
  state: JobState
  stage: string | null
  error: string | null
  code: FailureCode | null
  request: JobRequestSnapshot
  engineId: string | null
  attempt: number
  createdAt: number
  startedAt: number | null
  endedAt: number | null
  outputSha256: string | null
  outputPath: string | null
  userCancelled: boolean
  history: JobTransition[]
}

const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d)
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export function normalizeRecord(raw: unknown): JobRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || !r.id || typeof r.projectId !== 'string') return null
  if (!STATES.includes(r.state as JobState)) return null
  const rq = (r.request && typeof r.request === 'object' ? r.request : {}) as Record<string, unknown>
  const history = Array.isArray(r.history)
    ? (r.history as unknown[]).flatMap((h): JobTransition[] => {
        const x = h as Record<string, unknown>
        return x && STATES.includes(x.state as JobState) && typeof x.at === 'number'
          ? [{ state: x.state as JobState, at: x.at, reason: str(x.reason) }]
          : []
      }).slice(-HISTORY_CAP)
    : []
  return {
    id: r.id, projectId: r.projectId, parentId: typeof r.parentId === 'string' ? r.parentId : null,
    state: r.state as JobState, stage: typeof r.stage === 'string' ? r.stage : null,
    error: typeof r.error === 'string' ? r.error : null, code: typeof r.code === 'string' ? (r.code as FailureCode) : null,
    request: {
      prompt: str(rq.prompt), lyrics: str(rq.lyrics), instrumental: rq.instrumental === true,
      durationSec: numOrNull(rq.durationSec) ?? 0, seed: numOrNull(rq.seed)
    },
    engineId: typeof r.engineId === 'string' ? r.engineId : null,
    attempt: typeof r.attempt === 'number' && r.attempt >= 1 ? Math.floor(r.attempt) : 1,
    createdAt: numOrNull(r.createdAt) ?? 0, startedAt: numOrNull(r.startedAt), endedAt: numOrNull(r.endedAt),
    outputSha256: typeof r.outputSha256 === 'string' ? r.outputSha256 : null,
    outputPath: typeof r.outputPath === 'string' ? r.outputPath : null,
    userCancelled: r.userCancelled === true, history
  }
}

export function newRecord(input: { id?: string; projectId: string; request: JobRequestSnapshot; engineId?: string | null; attempt?: number; parentId?: string | null; now?: number }): JobRecord {
  const now = input.now ?? Date.now()
  return {
    id: input.id ?? randomUUID(), projectId: input.projectId, parentId: input.parentId ?? null, state: 'queued', stage: null,
    error: null, code: null, request: input.request, engineId: input.engineId ?? null, attempt: input.attempt ?? 1,
    createdAt: now, startedAt: null, endedAt: null, outputSha256: null, outputPath: null, userCancelled: false,
    history: [{ state: 'queued', at: now, reason: 'created' }]
  }
}

export class JobStore {
  private col: Collection<JobRecord>
  private readonly userData: string
  constructor(userData: string, profileId: string) {
    this.userData = userData
    this.col = new Collection<JobRecord>(profileFile(userData, profileId, 'neurova', 'jobs.json'), normalizeRecord, 500)
  }
  async put(record: JobRecord): Promise<JobRecord> { return this.col.put(record) }
  async get(id: string): Promise<JobRecord | null> { return this.col.get(id) }
  async list(projectId?: string): Promise<JobRecord[]> {
    const all = await this.col.all()
    return projectId ? all.filter((r) => r.projectId === projectId) : [...all]
  }
  /** Applies a patch; a state change is appended to history (capped). Returns null for an unknown id. */
  async update(id: string, patch: Partial<Omit<JobRecord, 'id' | 'history'>>, reason = ''): Promise<JobRecord | null> {
    const cur = await this.col.get(id)
    if (!cur) return null
    const now = Date.now()
    const next: JobRecord = { ...cur, ...patch, id: cur.id, history: cur.history }
    if (patch.state && patch.state !== cur.state) {
      next.history = [...cur.history, { state: patch.state, at: now, reason }].slice(-HISTORY_CAP)
      if (isTerminal(patch.state) && next.endedAt === null) next.endedAt = now
      if (patch.state === 'preparing' && next.startedAt === null) next.startedAt = now
    }
    return this.col.put(next)
  }
  async useProfile(profileId: string): Promise<void> {
    await this.col.usePath(profileFile(this.userData, profileId, 'neurova', 'jobs.json'))
  }
  flush(): Promise<void> { return this.col.flush() }
}

export interface ReconcileDeps { isRunning: (id: string) => boolean; outputExists: (path: string) => Promise<boolean> }
export interface ReconcileReport { interrupted: { id: string; from: JobState; reason: string }[]; unchanged: number }

/**
 * At startup: a non-terminal record with no running worker becomes 'interrupted'. A record is never made 'completed'
 * here, and nothing is restarted. A 'completed' record whose output file is gone is flagged failed (OUTPUT_INVALID).
 */
export async function reconcile(store: JobStore, deps: ReconcileDeps, now = Date.now()): Promise<ReconcileReport> {
  const report: ReconcileReport = { interrupted: [], unchanged: 0 }
  for (const r of await store.list()) {
    if (!isTerminal(r.state)) {
      if (deps.isRunning(r.id)) { report.unchanged++; continue }
      const reason = 'Orbis closed or the worker stopped before this job finished.'
      await store.update(r.id, { state: 'interrupted', error: reason, endedAt: now }, 'startup reconcile')
      report.interrupted.push({ id: r.id, from: r.state, reason })
    } else if (r.state === 'completed' && r.outputPath && !(await deps.outputExists(r.outputPath))) {
      const reason = 'The finished audio file is missing.'
      await store.update(r.id, { state: 'failed', code: 'OUTPUT_INVALID', error: reason }, 'output missing at startup')
      report.interrupted.push({ id: r.id, from: 'completed', reason })
    } else report.unchanged++
  }
  return report
}

export type RetryResult =
  | { ok: true; record: JobRecord }
  | { ok: false; code: 'NOT_FINISHED' | 'USER_CANCELLED' | 'NOT_RETRYABLE'; message: string }

/** Builds a NEW queued record from a finished one; never mutates or restarts anything. */
export function retryRequest(record: JobRecord, opts: { maxAttempts?: number; id?: string; now?: number } = {}): RetryResult {
  if (!isTerminal(record.state) || record.state === 'completed') return { ok: false, code: 'NOT_FINISHED', message: 'Only a failed, cancelled or interrupted job can be retried.' }
  if (record.userCancelled || record.state === 'cancelled' || record.code === 'CANCELLED') return { ok: false, code: 'USER_CANCELLED', message: 'You cancelled this job, so it is not retried automatically.' }
  // An interrupted job has no failure code; it is treated like a stopped worker.
  const code: FailureCode = record.code ?? (record.state === 'interrupted' ? 'WORKER_CRASHED' : 'UNKNOWN')
  if (!shouldRetry(code, record.attempt, opts.maxAttempts)) return { ok: false, code: 'NOT_RETRYABLE', message: 'Trying again is unlikely to help (' + code + ', attempt ' + record.attempt + ').' }
  return {
    ok: true,
    record: newRecord({ id: opts.id, projectId: record.projectId, request: { ...record.request }, engineId: record.engineId, attempt: record.attempt + 1, parentId: record.id, now: opts.now })
  }
}
