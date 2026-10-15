// A bounded queue with reservations. It decides who may run; it never runs anything itself.

export interface Limits { maxActive: number; maxQueued: number }

export interface Entry { id: string; project: string; priority: number; at: number }

export interface Scheduler {
  limits: Limits
  queued: Entry[]
  active: string[]
  paused: boolean
}

export const newScheduler = (limits: Limits): Scheduler => ({ limits, queued: [], active: [], paused: false })

export type Submit = { ok: true; scheduler: Scheduler; position: number } | { ok: false; code: 'QUEUE_FULL' | 'DUPLICATE'; message: string }

export function submit(s: Scheduler, e: Entry): Submit {
  if (s.queued.some((q) => q.id === e.id) || s.active.includes(e.id)) return { ok: false, code: 'DUPLICATE', message: 'That job is already queued or running.' }
  if (s.queued.length >= s.limits.maxQueued) return { ok: false, code: 'QUEUE_FULL', message: `The queue holds ${s.limits.maxQueued} jobs; wait for one to finish.` }
  const queued = [...s.queued, e]
  return { ok: true, scheduler: { ...s, queued }, position: queued.length }
}

/** Picks the next job: higher priority first, then the project that has had the least turns, then oldest. */
export function next(s: Scheduler, recentByProject: Record<string, number> = {}): { scheduler: Scheduler; start: Entry | null } {
  if (s.paused || s.active.length >= s.limits.maxActive || !s.queued.length) return { scheduler: s, start: null }
  const sorted = [...s.queued].sort((a, b) => b.priority - a.priority || (recentByProject[a.project] ?? 0) - (recentByProject[b.project] ?? 0) || a.at - b.at)
  const start = sorted[0]
  return { scheduler: { ...s, queued: s.queued.filter((q) => q.id !== start.id), active: [...s.active, start.id] }, start }
}

/** Releases the slot on every ending: success, failure, cancellation or crash. */
export const release = (s: Scheduler, id: string): Scheduler => ({ ...s, active: s.active.filter((a) => a !== id) })

export const cancelQueued = (s: Scheduler, id: string): { scheduler: Scheduler; cancelled: boolean } => {
  const had = s.queued.some((q) => q.id === id)
  return { scheduler: had ? { ...s, queued: s.queued.filter((q) => q.id !== id) } : s, cancelled: had }
}

export type FailureCode =
  | 'REQUEST_INVALID' | 'MODEL_MISSING' | 'RUNTIME_MISSING' | 'OUT_OF_MEMORY' | 'DISK_FULL'
  | 'WORKER_CRASHED' | 'WORKER_PROTOCOL' | 'TIMEOUT' | 'OUTPUT_INVALID' | 'CANCELLED' | 'UNKNOWN'

const RETRY: Record<FailureCode, boolean> = {
  REQUEST_INVALID: false, MODEL_MISSING: false, RUNTIME_MISSING: false, OUT_OF_MEMORY: false, DISK_FULL: false,
  WORKER_CRASHED: true, WORKER_PROTOCOL: false, TIMEOUT: false, OUTPUT_INVALID: true, CANCELLED: false, UNKNOWN: false
}

/** Retries are bounded and only for failures where trying again can plausibly help. */
export function shouldRetry(code: FailureCode, attempts: number, maxAttempts = 2): boolean {
  return RETRY[code] && attempts < maxAttempts
}

export const backoffMs = (attempt: number): number => Math.min(30_000, 1000 * 2 ** Math.max(0, attempt - 1))
