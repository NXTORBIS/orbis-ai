import { randomUUID } from 'node:crypto'
import type { DeviceState } from '../../shared/temporal/capability.ts'
import { occurrenceKey, type ExecutionRecord, type TemporalAction, type TemporalJob } from '../../shared/temporal/job.ts'
import { decide, stateAfter, TICK_MS, type Decision } from '../../shared/temporal/plan.ts'
import { nextOccurrence } from '../../shared/temporal/recurrence.ts'
import type { TemporalStore } from './store.ts'

/**
 * The clock that makes schedules happen.
 *
 * It decides nothing. Every choice -- whether something is due, whether a missed run still matters, whether to retry,
 * what state a job should be in -- is made by `decide()` in `shared/temporal/plan.ts`, which is pure and tested
 * without a clock. This file does three things: look at the time, carry out what was decided, and write down what
 * actually happened.
 *
 * That split is the point. A scheduler that mixes the deciding into the doing is one nobody can test, and the faults
 * it produces -- something run twice, something never run again, a run recorded that did not happen -- are all
 * invisible until the moment has passed.
 *
 * ## What it will not do
 *
 * **It never runs anything itself.** It calls a runner that belongs to the engine that already owns that kind of
 * work: Workflows, Browser Control, Pages, Orion, notifications. There is no second automation engine here.
 *
 * **It never records a run that did not happen.** A record is written after the runner returns, with what it
 * returned, and a failure is written as a failure.
 *
 * **It never runs one occurrence twice.** Every run in flight is held by its occurrence key, so a tick arriving
 * while a long job is still going cannot start it again.
 *
 * **It never claims to run while Orbis is closed.** The timer stops when Orbis stops. What was missed is caught up
 * on next start, and said to be late.
 */

/** What actually carries out an action. One per kind, owned by whichever engine already does that work. */
export type Runner = (action: TemporalAction, job: TemporalJob) => Promise<{ ok: boolean; detail?: string }>

export interface EngineOptions {
  store: TemporalStore
  /** Which profile's schedules are live. Only one is, since only one is open. */
  activeProfile: () => string
  /** What is true of this machine now. Gathered by the wiring layer, never guessed here. */
  device: () => DeviceState
  /** One per action kind. A kind with no runner is treated as blocked rather than silently skipped. */
  runners: Partial<Record<TemporalAction['kind'], Runner>>
  /** Told whenever anything changes, so a screen can follow along. */
  onChange?: (job: TemporalJob) => void
  /** How a reminder reaches a person, and how a run that needs saying is said. */
  onNotice?: (job: TemporalJob, text: string) => void
  now?: () => number
}

export class TemporalEngine {
  private timer: NodeJS.Timeout | null = null
  /** Occurrences being run right now, by key. What stops a tick starting the same one again. */
  private readonly inFlight = new Set<string>()
  private stopped = false

  private readonly o: EngineOptions

  constructor(options: EngineOptions) {
    this.o = options
  }

  private now(): number {
    return this.o.now ? this.o.now() : Date.now()
  }

  /**
   * Starts looking.
   *
   * The first look happens immediately rather than after a tick, because the most valuable thing this does is catch
   * up on what was missed while Orbis was closed -- and making somebody wait half a minute for that is the wrong way
   * round.
   */
  start(): void {
    if (this.timer !== null || this.stopped) return
    void this.tick()
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    // Never hold the process open on its own account: closing Orbis should close Orbis.
    this.timer.unref?.()
  }

  stop(): void {
    this.stopped = true
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
  }

  /** One pass over every job. Public so a screen can ask for an immediate look after an edit. */
  async tick(): Promise<void> {
    if (this.stopped) return
    const profileId = this.o.activeProfile()
    const now = this.now()
    const device = this.o.device()

    let jobs: TemporalJob[]
    try {
      jobs = await this.o.store.all(profileId)
    } catch {
      // An unreadable store is not worth a crash; the next tick tries again.
      return
    }

    for (const job of jobs) {
      if (this.stopped) return
      const decision = decide(job, now, device)
      try {
        await this.carryOut(profileId, job, decision, now)
      } catch {
        // One job's failure must never stop the others being looked at.
      }
    }
  }

  private async carryOut(profileId: string, job: TemporalJob, decision: Decision, now: number): Promise<void> {
    switch (decision.do) {
      case 'run':
        await this.run(profileId, job, decision, now)
        return

      case 'nothing': {
        // Only written when something actually differs, so a quiet tick does not rewrite the file thirty times a minute.
        const nextRunAt = decision.nextRunAt
        if (job.state === decision.state && job.nextRunAt === nextRunAt) return
        await this.move(profileId, job, decision, { nextRunAt })
        return
      }

      case 'wait':
      case 'block':
        if (job.state === stateAfter(job, decision)) return
        await this.move(profileId, job, decision, {})
        return

      case 'giveUp': {
        /**
         * Recorded as history rather than silently dropped.
         *
         * Somebody whose reminder did not arrive is owed the reason, and "it was four hours late and you asked me to
         * skip late ones" is an answer. Nothing on screen is the alternative, and that reads as a broken feature.
         */
        const record: ExecutionRecord = {
          executionId: randomUUID(),
          dueAt: decision.dueAt,
          startedAt: now,
          finishedAt: now,
          state: 'missed',
          attempt: 1,
          detail: decision.why
        }
        const moved = await this.o.store.recordRun(profileId, job.jobId, record, 'missed', now)
        if (moved) this.o.onChange?.(moved)
        return
      }

      case 'retire':
        if (job.state === decision.state) return
        await this.move(profileId, job, decision, { nextRunAt: null })
        return
    }
  }

  private async move(profileId: string, job: TemporalJob, decision: Decision, extra: Partial<TemporalJob>): Promise<void> {
    const state = stateAfter(job, decision)
    if (state === job.state && Object.keys(extra).length === 0) return
    const moved = await this.o.store.setState(profileId, job.jobId, state, extra)
    if (moved) this.o.onChange?.(moved)
  }

  private async run(
    profileId: string,
    job: TemporalJob,
    decision: Extract<Decision, { do: 'run' }>,
    now: number
  ): Promise<void> {
    const key = occurrenceKey(job.jobId, decision.dueAt)
    // A long job and a half-minute tick would otherwise start the same occurrence twice.
    if (this.inFlight.has(key)) return

    const runner = this.o.runners[job.action.kind]
    if (!runner) {
      // No runner is a missing wire, not a schedule that should quietly never happen. It needs a person.
      await this.o.store.setState(profileId, job.jobId, 'blocked')
      return
    }

    this.inFlight.add(key)
    const marked = await this.o.store.setState(profileId, job.jobId, 'running')
    if (marked) this.o.onChange?.(marked)

    let ok = false
    let detail = ''
    try {
      const result = await runner(job.action, job)
      ok = result.ok
      detail = (result.detail ?? '').slice(0, 200)
    } catch (error) {
      ok = false
      // The message only, capped: enough to act on, and never a stack trace or anything from a secret.
      detail = (error instanceof Error ? error.message : 'It did not work.').slice(0, 200)
    } finally {
      this.inFlight.delete(key)
    }

    const finishedAt = this.now()
    const record: ExecutionRecord = {
      executionId: randomUUID(),
      dueAt: decision.dueAt,
      startedAt: now,
      finishedAt,
      state: ok ? 'completed' : 'failed',
      attempt: decision.attempt,
      detail
    }

    /**
     * Which state follows depends on whether another attempt is owed.
     *
     * Deliberately not decided here: `decide()` owns the retry rule, and asking it again on the next tick with the
     * failure already written is what keeps one copy of that rule. All this does is choose between "failed, and the
     * rule may say try again" and "ran, back to waiting".
     */
    const owedRetry = !ok && job.policies.retry.kind === 'backoff' && decision.attempt < job.policies.retry.attempts
    /**
     * A one-off is finished the moment it runs, rather than being left waiting for a tick that finds nothing.
     *
     * Which matters for honesty as much as tidiness: "waiting" on a schedule that will never come round again is a
     * screen telling somebody a reminder is still coming.
     */
    const more = ok ? nextOccurrence(job.schedule, Math.max(finishedAt, decision.dueAt), job.runsSoFar + 1) : null
    const state = ok ? (more === null ? 'completed' : 'scheduled') : owedRetry ? 'retrying' : 'failed'

    const moved = await this.o.store.recordRun(profileId, job.jobId, record, state, finishedAt)
    if (moved) {
      this.o.onChange?.(moved)
      if (decision.lateBy > TICK_MS && ok) {
        // Said out loud, because a reminder arriving four hours late without explanation looks like a broken clock.
        this.o.onNotice?.(moved, `“${moved.name}” ran ${lateText(decision.lateBy)} late — Orbis was not running when it was due.`)
      }
      if (!ok && !owedRetry) this.o.onNotice?.(moved, `“${moved.name}” did not work. ${detail}`.trim())
    }
  }
}

/** How late, in words rather than milliseconds. */
export function lateText(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'}`
}
