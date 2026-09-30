import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { dataDirFor } from '../../shared/profiles.ts'
import {
  checkJob,
  DEFAULT_POLICIES,
  MAX_HISTORY,
  TEMPORAL_FORMAT,
  type ExecutionRecord,
  type JobCondition,
  type JobPolicies,
  type JobState,
  type TemporalAction,
  type TemporalJob
} from '../../shared/temporal/job.ts'
import { checkSchedule, nextOccurrence, type Schedule } from '../../shared/temporal/recurrence.ts'
import { deviceZone } from '../../shared/temporal/zone.ts'
import { JsonFile } from '../personal/store.ts'

/**
 * Where schedules are kept.
 *
 * One file per profile, through the store Orbis already has: `JsonFile` writes atomically, at most a few times a
 * second however fast anything changes, and -- the part that matters here -- it captures its own path when a write is
 * queued, so a schedule saved just before a profile switch lands in the profile it came from rather than the new one.
 *
 * ## What it will not do
 *
 * **It never keeps a job it cannot run.** Everything is checked on the way in, and refused with a reason rather than
 * repaired into something nearby. A schedule that quietly means something else is worse than a rejected one.
 *
 * **It never loses the rest of a job to a partial edit.** Updates merge onto what is there, field by field, because a
 * store that rebuilds a record from a patch erases whatever the patch did not mention -- which is exactly how a set
 * of saved markets groups was lost once already.
 */

interface Saved {
  format: number
  jobs: TemporalJob[]
}

const empty = (): Saved => ({ format: TEMPORAL_FORMAT, jobs: [] })

/** What a caller may ask for when making a job. Everything else is decided here. */
export interface NewJob {
  name: string
  said?: string
  action: TemporalAction
  schedule: Schedule
  policies?: Partial<JobPolicies>
  conditions?: readonly JobCondition[]
  /** Off until switched on, for a schedule being shown back for confirmation before it is live. */
  startPaused?: boolean
}

export type Saveable = { ok: true; job: TemporalJob } | { ok: false; problems: readonly string[] }

export class TemporalStore {
  private readonly files = new Map<string, JsonFile<Saved>>()

  private readonly userData: string

  constructor(userData: string) {
    this.userData = userData
  }

  private file(profileId: string): JsonFile<Saved> {
    const held = this.files.get(profileId)
    if (held) return held
    const path = join(this.userData, dataDirFor(profileId), 'schedules.json')
    const made = new JsonFile<Saved>(path, empty, (raw) => clean(raw))
    this.files.set(profileId, made)
    return made
  }

  async all(profileId: string): Promise<TemporalJob[]> {
    return (await this.file(profileId).read()).jobs
  }

  async get(profileId: string, jobId: string): Promise<TemporalJob | null> {
    return (await this.all(profileId)).find((j) => j.jobId === jobId) ?? null
  }

  async add(profileId: string, asked: NewJob, now: number): Promise<Saveable> {
    const scheduleProblems = checkSchedule(asked.schedule)
    if (scheduleProblems.length > 0) return { ok: false, problems: scheduleProblems }

    const job: TemporalJob = {
      format: TEMPORAL_FORMAT,
      jobId: randomUUID(),
      profileId,
      name: asked.name.trim().slice(0, 120),
      said: (asked.said ?? '').slice(0, 400),
      action: asked.action,
      schedule: asked.schedule,
      policies: { ...DEFAULT_POLICIES, ...(asked.policies ?? {}) },
      conditions: asked.conditions ?? [],
      state: asked.startPaused ? 'paused' : 'scheduled',
      createdAt: now,
      updatedAt: now,
      version: 1,
      nextRunAt: nextOccurrence(asked.schedule, now)?.at ?? null,
      lastRunAt: null,
      runsSoFar: 0,
      history: [],
      skipped: []
    }

    const problems = checkJob(job)
    if (problems.length > 0) return { ok: false, problems }

    await this.change(profileId, (jobs) => [...jobs, job])
    return { ok: true, job }
  }

  /**
   * Changes some of a job, keeping the rest.
   *
   * A patch, merged field by field, never a replacement. The distinction is the difference between changing the time
   * of a schedule and silently dropping the conditions somebody attached to it last week.
   */
  async update(
    profileId: string,
    jobId: string,
    patch: Partial<Pick<TemporalJob, 'name' | 'action' | 'schedule' | 'conditions'>> & { policies?: Partial<JobPolicies> },
    now: number
  ): Promise<Saveable> {
    const current = await this.get(profileId, jobId)
    if (current === null) return { ok: false, problems: ['That schedule no longer exists.'] }

    const next: TemporalJob = {
      ...current,
      ...(patch.name === undefined ? {} : { name: patch.name.trim().slice(0, 120) }),
      ...(patch.action === undefined ? {} : { action: patch.action }),
      ...(patch.schedule === undefined ? {} : { schedule: patch.schedule }),
      ...(patch.conditions === undefined ? {} : { conditions: patch.conditions }),
      policies: { ...current.policies, ...(patch.policies ?? {}) },
      updatedAt: now,
      // Bumped so a run already under way keeps the version it started with rather than half of each.
      version: current.version + 1
    }
    if (patch.schedule !== undefined) {
      const scheduleProblems = checkSchedule(patch.schedule)
      if (scheduleProblems.length > 0) return { ok: false, problems: scheduleProblems }
      next.nextRunAt = nextOccurrence(patch.schedule, now, next.runsSoFar)?.at ?? null
    }

    const problems = checkJob(next)
    if (problems.length > 0) return { ok: false, problems }

    await this.change(profileId, (jobs) => jobs.map((j) => (j.jobId === jobId ? next : j)))
    return { ok: true, job: next }
  }

  /** Moves a job to a state, checked against the state machine by the caller. */
  async setState(profileId: string, jobId: string, state: JobState, extra: Partial<TemporalJob> = {}): Promise<TemporalJob | null> {
    let moved: TemporalJob | null = null
    await this.change(profileId, (jobs) =>
      jobs.map((j) => {
        if (j.jobId !== jobId) return j
        moved = { ...j, ...extra, state }
        return moved
      })
    )
    return moved
  }

  async pause(profileId: string, jobId: string, until: number | null): Promise<TemporalJob | null> {
    return this.setState(profileId, jobId, 'paused', until === null ? { pausedUntil: undefined } : { pausedUntil: until })
  }

  async resume(profileId: string, jobId: string, now: number): Promise<TemporalJob | null> {
    const job = await this.get(profileId, jobId)
    if (job === null) return null
    return this.setState(profileId, jobId, 'scheduled', {
      pausedUntil: undefined,
      nextRunAt: nextOccurrence(job.schedule, now, job.runsSoFar)?.at ?? null
    })
  }

  async cancel(profileId: string, jobId: string): Promise<TemporalJob | null> {
    return this.setState(profileId, jobId, 'cancelled', { nextRunAt: null })
  }

  async remove(profileId: string, jobId: string): Promise<boolean> {
    const before = (await this.all(profileId)).length
    await this.change(profileId, (jobs) => jobs.filter((j) => j.jobId !== jobId))
    return (await this.all(profileId)).length < before
  }

  /** Marks one occurrence as not wanted, without touching the rule. */
  async skipOccurrence(profileId: string, jobId: string, dueAt: number): Promise<TemporalJob | null> {
    const job = await this.get(profileId, jobId)
    if (job === null) return null
    // Bounded, so a job somebody skips every week does not grow a list forever.
    const skipped = [...new Set([...job.skipped, dueAt])].slice(-200)
    return this.setState(profileId, jobId, job.state, { skipped })
  }

  /** Records what happened, and works out when the job is next due. */
  async recordRun(profileId: string, jobId: string, record: ExecutionRecord, state: JobState, now: number): Promise<TemporalJob | null> {
    const job = await this.get(profileId, jobId)
    if (job === null) return null
    const counted = record.state === 'completed' ? job.runsSoFar + 1 : job.runsSoFar
    return this.setState(profileId, jobId, state, {
      history: [...job.history, record].slice(-MAX_HISTORY),
      lastRunAt: record.dueAt,
      runsSoFar: counted,
      nextRunAt: nextOccurrence(job.schedule, Math.max(now, record.dueAt), counted)?.at ?? null
    })
  }

  async flush(): Promise<void> {
    await Promise.all([...this.files.values()].map((f) => f.flush()))
  }

  private async change(profileId: string, apply: (jobs: TemporalJob[]) => TemporalJob[]): Promise<void> {
    const file = this.file(profileId)
    const held = await file.read()
    await file.write({ format: TEMPORAL_FORMAT, jobs: apply(held.jobs) })
  }
}

// ---------------------------------------------------------------- reading what is on disk

/**
 * What is on disk, checked.
 *
 * Anything unreadable is left out rather than repaired, and anything that would not be accepted today is left out
 * too -- but one job at a time, so a single damaged record does not take a whole profile's schedules with it.
 */
function clean(raw: unknown): Saved {
  if (!raw || typeof raw !== 'object') return empty()
  const held = raw as { jobs?: unknown }
  if (!Array.isArray(held.jobs)) return empty()

  const jobs: TemporalJob[] = []
  for (const entry of held.jobs) {
    const job = cleanJob(entry)
    if (job !== null) jobs.push(job)
  }
  return { format: TEMPORAL_FORMAT, jobs }
}

function cleanJob(raw: unknown): TemporalJob | null {
  if (!raw || typeof raw !== 'object') return null
  const j = raw as Record<string, unknown>
  const num = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)
  const text = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback)

  const schedule = j.schedule as Schedule | undefined
  if (!schedule || typeof schedule !== 'object') return null
  // A schedule stored without a place would otherwise follow whichever machine reads it, which is the whole fault
  // this layer exists to fix. Filling in this computer's zone is the honest reading of an older record.
  const withZone: Schedule = { ...schedule, timeZone: text(schedule.timeZone) || deviceZone() }

  const job: TemporalJob = {
    format: TEMPORAL_FORMAT,
    jobId: text(j.jobId),
    profileId: text(j.profileId),
    name: text(j.name).slice(0, 120),
    said: text(j.said).slice(0, 400),
    action: j.action as TemporalAction,
    schedule: withZone,
    policies: { ...DEFAULT_POLICIES, ...(typeof j.policies === 'object' && j.policies ? (j.policies as JobPolicies) : {}) },
    conditions: Array.isArray(j.conditions) ? (j.conditions as JobCondition[]) : [],
    state: typeof j.state === 'string' ? (j.state as JobState) : 'scheduled',
    createdAt: num(j.createdAt, 0),
    updatedAt: num(j.updatedAt, 0),
    version: num(j.version, 1),
    nextRunAt: typeof j.nextRunAt === 'number' ? j.nextRunAt : null,
    lastRunAt: typeof j.lastRunAt === 'number' ? j.lastRunAt : null,
    runsSoFar: num(j.runsSoFar, 0),
    history: Array.isArray(j.history) ? (j.history as ExecutionRecord[]).slice(-MAX_HISTORY) : [],
    skipped: Array.isArray(j.skipped) ? (j.skipped as number[]).filter((n) => typeof n === 'number') : [],
    ...(typeof j.pausedUntil === 'number' ? { pausedUntil: j.pausedUntil } : {})
  }

  /**
   * A running job on disk means Orbis stopped in the middle of one.
   *
   * It goes back to waiting rather than staying "running" forever, and the occurrence it was in the middle of is
   * decided again by the ordinary catch-up rules -- which is the honest answer, because nothing knows whether it
   * finished.
   */
  if (job.state === 'running' || job.state === 'ready') job.state = 'scheduled'

  return checkJob(job).length === 0 ? job : null
}
