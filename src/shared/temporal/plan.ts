import { conditionsMet, readiness, type DeviceState } from './capability.ts'
import { canMove, occurrenceKey, type JobState, type TemporalJob } from './job.ts'
import { nextOccurrence, occurrencesBetween } from './recurrence.ts'

/**
 * What should happen to a job at a given moment.
 *
 * The whole decision, as one pure function. Every reason a job runs, waits, gives up or is put back is decided here
 * and nowhere else, which is what makes the behaviour testable without a clock, a browser or a disk -- and what stops
 * the same decision being made slightly differently in three places, which is how a scheduler starts running things
 * twice.
 *
 * ## What it will not do
 *
 * **It never runs anything.** It returns a description of what to do. The caller carries it out and reports back.
 *
 * **It never reads the clock.** `now` is given. A week of behaviour is tested in a millisecond.
 *
 * **It never runs an occurrence twice.** Everything is keyed by the moment an occurrence was *due*, so a retry, a
 * catch-up after a restart and two scheduler passes in the same second all agree about what has already happened.
 */

export type Decision =
  /** Nothing to do. `until` is when it is next worth looking, so the scheduler can sleep rather than spin. */
  | { do: 'nothing'; state: JobState; nextRunAt: number | null; until: number | null }
  /** Run this occurrence now. `dueAt` is what it was for, which is not necessarily `now`. */
  | { do: 'run'; dueAt: number; attempt: number; lateBy: number; key: string }
  /** It cannot run, and waiting will fix that. */
  | { do: 'wait'; state: 'waitingForDevice' | 'waitingForCondition'; dueAt: number; reasons: readonly string[] }
  /** It cannot run and waiting will not fix it. Needs a person. */
  | { do: 'block'; reasons: readonly string[] }
  /** Its moment passed and the policy says to let it go. Recorded as history, not as a failure. */
  | { do: 'giveUp'; dueAt: number; why: string }
  /** It will never run again. A one-off that ran, an end date reached, a run count exhausted. */
  | { do: 'retire'; state: 'completed' | 'failed' }

/** How often the scheduler looks, and therefore how late a run can be through no fault of anything. */
export const TICK_MS = 30_000

/**
 * How far back a catch-up looks after Orbis has been closed.
 *
 * Fourteen days. Long enough to cover a holiday, short enough that a machine off for a year does not produce a wall
 * of things nobody wants to be reminded about now.
 */
export const CATCH_UP_DAYS = 14

export function decide(job: TemporalJob, now: number, device: DeviceState): Decision {
  if (job.state === 'cancelled') return { do: 'nothing', state: 'cancelled', nextRunAt: null, until: null }

  if (job.state === 'paused') {
    // A pause with an end resumes itself; one without waits for a person.
    if (job.pausedUntil !== undefined && now >= job.pausedUntil) {
      const resumed = nextOccurrence(job.schedule, now - 1, job.runsSoFar)
      return { do: 'nothing', state: 'scheduled', nextRunAt: resumed?.at ?? null, until: resumed?.at ?? null }
    }
    return { do: 'nothing', state: 'paused', nextRunAt: null, until: job.pausedUntil ?? null }
  }

  /**
   * A failed attempt that is owed another try.
   *
   * Taken before the calendar, because a retry is about an occurrence that already came due -- working out the next
   * occurrence first would step past it and the retry would never happen.
   */
  if (job.state === 'retrying') {
    const owed = retryDue(job, now)
    if (owed === null) return { do: 'retire', state: 'failed' }
    if (owed.at > now) return { do: 'nothing', state: 'retrying', nextRunAt: owed.at, until: owed.at }
    const gate = gates(job, device)
    if (gate !== null) return gate
    return { do: 'run', dueAt: owed.dueAt, attempt: owed.attempt, lateBy: now - owed.dueAt, key: occurrenceKey(job.jobId, owed.dueAt) }
  }

  const due = dueOccurrence(job, now)
  if (due === null) {
    const upcoming = nextOccurrence(job.schedule, now, job.runsSoFar)
    if (upcoming === null) {
      // Nothing more will ever happen. Which ending it was depends on how the last attempt went.
      const last = job.history[job.history.length - 1]
      return { do: 'retire', state: last?.state === 'failed' ? 'failed' : 'completed' }
    }
    return { do: 'nothing', state: 'scheduled', nextRunAt: upcoming.at, until: upcoming.at }
  }

  const lateBy = now - due
  const tooLate = pastPolicy(job, lateBy)
  if (tooLate !== null) return { do: 'giveUp', dueAt: due, why: tooLate }

  const gate = gates(job, device)
  if (gate !== null) {
    // Still due; the caller records the waiting state and looks again on the next tick.
    if (gate.do === 'wait') return { ...gate, dueAt: due }
    return gate
  }

  return { do: 'run', dueAt: due, attempt: 1, lateBy, key: occurrenceKey(job.jobId, due) }
}

/** Readiness and conditions, as one answer, since the caller treats them the same way. */
function gates(job: TemporalJob, device: DeviceState): Decision | null {
  const can = readiness(job.action, device)
  if (!can.ready) {
    if (!can.willResolveItself) return { do: 'block', reasons: can.reasons }
    return { do: 'wait', state: 'waitingForDevice', dueAt: 0, reasons: can.reasons }
  }
  const met = conditionsMet(job.conditions, device)
  if (!met.ready) return { do: 'wait', state: 'waitingForCondition', dueAt: 0, reasons: met.reasons }
  return null
}

/**
 * The occurrence a job owes right now, or null.
 *
 * "Owes" rather than "is due at this instant", because the scheduler only looks every half minute and a computer can
 * be asleep for a week. So it looks at everything between the last run and now, and lets the catch-up policy decide
 * which of them still matters.
 */
function dueOccurrence(job: TemporalJob, now: number): number | null {
  const since = Math.max(
    job.lastRunAt ?? 0,
    now - CATCH_UP_DAYS * 86_400_000,
    (job.schedule.startsAt ?? 0) - 1,
    /**
     * Never before the job existed.
     *
     * Without this, a daily 8am schedule made at midday immediately owes this morning's run -- and "every day at
     * 8am" said at noon plainly means from tomorrow. It would have arrived as a reminder seconds after being set.
     */
    job.createdAt - 1
  )
  const missed = occurrencesBetween(job.schedule, since, now, 500)
    .map((o) => o.at)
    .filter((at) => !job.skipped.includes(at) && !alreadyRan(job, at))

  if (missed.length === 0) return null
  switch (job.policies.catchUp) {
    case 'all':
      // Oldest first, one per tick, so a week of missed runs plays back in order rather than all at once.
      return missed[0]
    case 'latestOnly':
      return missed[missed.length - 1]
    case 'nextOnly':
      // Everything already missed is forgone; only something coming due from here counts.
      return null
  }
}

/** Whether this occurrence has already been accounted for, by the moment it was due rather than when it ran. */
function alreadyRan(job: TemporalJob, dueAt: number): boolean {
  return job.history.some((h) => h.dueAt === dueAt && h.state !== 'failed')
}

/** Why an occurrence is no longer worth running, or null if it still is. */
function pastPolicy(job: TemporalJob, lateBy: number): string | null {
  // Not late at all, within the tick the scheduler cannot do better than.
  if (lateBy <= TICK_MS) return null
  switch (job.policies.missed) {
    case 'skip':
      return 'Its moment had passed.'
    case 'withinWindow': {
      const grace = job.policies.graceMinutes * 60_000
      return lateBy > grace ? `It was more than ${job.policies.graceMinutes} minutes late.` : null
    }
    case 'runWhenAvailable':
      return null
  }
}

/** When the next retry is owed, which occurrence it is for, and which attempt it would be. */
function retryDue(job: TemporalJob, _now: number): { at: number; dueAt: number; attempt: number } | null {
  const retry = job.policies.retry
  if (retry.kind === 'none') return null
  const last = job.history[job.history.length - 1]
  if (!last || last.state !== 'failed') return null
  if (last.attempt >= retry.attempts) return null

  /**
   * The wait doubles each time.
   *
   * Because the common reasons a scheduled thing fails -- a site down, a network dropping, a model rate-limiting --
   * all get worse if answered with an immediate identical retry. Doubling turns three attempts into half a minute,
   * a minute and two minutes rather than three failures in a second.
   */
  const wait = retry.firstDelayMs * 2 ** (last.attempt - 1)
  return { at: (last.finishedAt ?? last.startedAt) + wait, dueAt: last.dueAt, attempt: last.attempt + 1 }
}

/**
 * The state a job should be in after a decision, checked against the state machine.
 *
 * Going through `canMove` rather than assigning directly means an illegal transition is caught here rather than
 * showing up as a job that claims to have completed without running.
 */
export function stateAfter(job: TemporalJob, decision: Decision): JobState {
  const wanted: JobState = (() => {
    switch (decision.do) {
      case 'nothing':
        return decision.state
      case 'run':
        return 'ready'
      case 'wait':
        return decision.state
      case 'block':
        return 'blocked'
      case 'giveUp':
        return 'missed'
      case 'retire':
        return decision.state
    }
  })()
  /**
   * `completed` is the one state that must be earned.
   *
   * The table alone is not enough here: a job reloaded from disk sits in `scheduled`, and a one-off that has run
   * legitimately ends from there. So the rule is about evidence rather than about which state preceded it -- with no
   * completed run written down, the honest ending is `missed`, never `completed`.
   */
  if (wanted === 'completed' && !job.history.some((h) => h.state === 'completed')) {
    return canMove(job.state, 'missed') ? 'missed' : job.state
  }
  return canMove(job.state, wanted) ? wanted : job.state
}

/**
 * When the scheduler should next wake up for a set of jobs.
 *
 * Null when there is nothing to wait for at all. Never further than one tick for anything that is waiting on the
 * machine, since what it is waiting for can change at any moment without anything telling the scheduler.
 */
export function nextWake(decisions: readonly Decision[], now: number): number | null {
  let soonest: number | null = null
  const consider = (at: number | null): void => {
    if (at === null) return
    if (soonest === null || at < soonest) soonest = at
  }
  for (const d of decisions) {
    if (d.do === 'nothing') consider(d.until)
    else if (d.do === 'wait') consider(now + TICK_MS)
    else consider(now)
  }
  return soonest
}
