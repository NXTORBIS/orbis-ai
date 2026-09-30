import type { Schedule } from './recurrence.ts'

/**
 * What a scheduled thing is, and what is allowed to happen to it.
 *
 * This is the coordination layer's own vocabulary and nothing else: it says *what* should happen, *when*, *where it
 * can run*, and *what to do when it cannot*. It does not say how anything is carried out. Workflows, Automations, the
 * Browser Control layer, Pages and Orion already know how, and a job only ever names one of them.
 *
 * That separation is the whole design. A second automation engine is exactly what this must not become, so nothing
 * here executes, retries by itself, or touches a browser.
 *
 * ## What a job will not do
 *
 * **It never carries code.** An action is a named kind with typed parameters, checked against a closed list. There is
 * nowhere here to put a command, a script, or an expression, so a sentence somebody typed can never become something
 * that runs.
 *
 * **It never gains permission by being scheduled.** A job runs what it names, with exactly the permissions that thing
 * already has. Scheduling is a statement about time, not an escalation.
 *
 * **It never claims to have run.** Every state below is reached from something that actually happened, and the two
 * states that mean "it did not happen" are distinct from each other and from success.
 */

// ---------------------------------------------------------------- what should happen

/**
 * The things a job can ask for, as a closed list.
 *
 * Each one names something Orbis can already do. Adding a kind here is a deliberate act with an adapter behind it,
 * which is what stops the scheduler growing an execution engine of its own.
 */
export type TemporalAction =
  /** Run a saved workflow through the existing Workflow Engine. */
  | { kind: 'workflow'; workflowId: string; inputs?: Readonly<Record<string, unknown>> }
  /** Open a web address. The simplest browser action, and the most common. */
  | { kind: 'openUrl'; url: string; newTab: boolean }
  /** Switch to a saved set of tabs. */
  | { kind: 'openWorkspace'; workspaceId: string }
  /** Open one of Orbis's own Pages. */
  | { kind: 'openPage'; pageId: string }
  /** Reload whatever is open at this address. */
  | { kind: 'refreshUrl'; url: string }
  /** Close tabs whose address matches. Deliberately a match rather than ids, which do not survive a restart. */
  | { kind: 'closeTabs'; urlMatches: string }
  /** Ask Orion something, through the existing model routing. */
  | { kind: 'orion'; prompt: string }
  /** Say something, through the existing notification system. A reminder is this and nothing more. */
  | { kind: 'notify'; message: string }

export const ACTION_KINDS: readonly TemporalAction['kind'][] = Object.freeze([
  'workflow',
  'openUrl',
  'openWorkspace',
  'openPage',
  'refreshUrl',
  'closeTabs',
  'orion',
  'notify'
])

// ---------------------------------------------------------------- where it can run

/**
 * Where a job's action is capable of running.
 *
 * This is the distinction that decides what Orbis may honestly promise about a computer that is asleep or switched
 * off, so it is a property of the action rather than a setting somebody chooses.
 */
export type ExecutionTarget =
  /** Needs this computer, awake, with Orbis able to reach the browser. Everything that touches a tab. */
  | 'local'
  /** Could run somewhere else entirely, if such a place existed. Nothing does today; see `capability.ts`. */
  | 'external'

/** Where each kind of action can run. A fact about Orbis, not a preference. */
export const TARGET_OF: Readonly<Record<TemporalAction['kind'], ExecutionTarget>> = Object.freeze({
  workflow: 'local',
  openUrl: 'local',
  openWorkspace: 'local',
  openPage: 'local',
  refreshUrl: 'local',
  closeTabs: 'local',
  // Orion answers through this computer's own request to the model, so the computer must be on.
  orion: 'local',
  // A notification needs somewhere to show it, which is this computer.
  notify: 'local'
})

// ---------------------------------------------------------------- what to do when it cannot

/** What to do about an occurrence that could not run when it was due. */
export type MissedPolicy =
  /** Let it go. Right for anything whose moment has passed: a reminder about a meeting that has finished. */
  | 'skip'
  /** Run it as soon as the machine can. Right for "open my workspace" -- late is better than not at all. */
  | 'runWhenAvailable'
  /** Run it late, but only within `graceMinutes` of when it was due. */
  | 'withinWindow'

/** What to do about a failure. */
export type RetryPolicy =
  | { kind: 'none' }
  /** Try again, with the wait doubling each time, up to `attempts` in total. */
  | { kind: 'backoff'; attempts: number; firstDelayMs: number }

/** What to do about several occurrences missed at once -- a computer off for three days. */
export type CatchUpPolicy =
  /** Only the most recent one. The right default: three days of "open my workspace" is one workspace. */
  | 'latestOnly'
  /** Every one that was missed. Rarely wanted, and never the default. */
  | 'all'
  /** None of them; wait for the next one due. */
  | 'nextOnly'

export interface JobPolicies {
  missed: MissedPolicy
  /** Only meaningful with `withinWindow`. How late is still worth running. */
  graceMinutes: number
  retry: RetryPolicy
  catchUp: CatchUpPolicy
  /**
   * Whether the time asked for was the point.
   *
   * "Exactly at midnight" is not the same request as "at some point this evening", and the difference decides whether
   * running late is a success or a failure. It is carried rather than inferred, because inferring it wrongly in
   * either direction is a poor outcome: a birthday message an hour late, or a workspace never opened because it
   * could not be opened on the second.
   */
  exact: boolean
}

export const DEFAULT_POLICIES: JobPolicies = Object.freeze({
  // Late is usually better than never, and the things people schedule locally are mostly worth doing late.
  missed: 'runWhenAvailable',
  graceMinutes: 60,
  retry: { kind: 'backoff' as const, attempts: 3, firstDelayMs: 30_000 },
  catchUp: 'latestOnly',
  exact: false
})

// ---------------------------------------------------------------- conditions

/**
 * Things that must be true at the moment of running, checked against real system state.
 *
 * Deliberately a small closed set. Each one is something Orbis can actually observe; there is no general expression
 * language here, because that is how a schedule becomes a program.
 */
export type JobCondition =
  | { kind: 'onWifi' }
  | { kind: 'onPower' }
  | { kind: 'batteryAbove'; percent: number }
  | { kind: 'networkAvailable' }

// ---------------------------------------------------------------- the states it can be in

/**
 * Every state a job can be in.
 *
 * The three that mean "it did not run" are deliberately distinct, because they call for different things from a
 * person: `missed` is history, `blocked` is something to fix, and `waitingForDevice` resolves itself.
 */
export type JobState =
  /** Waiting for its next occurrence. The resting state of anything healthy. */
  | 'scheduled'
  /** Due now, waiting its turn. */
  | 'ready'
  | 'running'
  /** Failed, and will try again. */
  | 'retrying'
  /** Due, but the computer or browser cannot do it yet. Resolves itself when the machine can. */
  | 'waitingForDevice'
  /** A condition it was given is not true. */
  | 'waitingForCondition'
  /** Needs a person: what it names no longer exists, or a permission was withdrawn. */
  | 'blocked'
  /** A one-off that ran. */
  | 'completed'
  | 'failed'
  /** Its moment passed and its policy said to let it go. */
  | 'missed'
  | 'cancelled'
  /** Off until somebody says otherwise, or until `pausedUntil`. */
  | 'paused'

export const RESTING_STATES: readonly JobState[] = Object.freeze(['scheduled', 'completed', 'failed', 'missed', 'cancelled', 'paused', 'blocked'])
export const ACTIVE_STATES: readonly JobState[] = Object.freeze(['ready', 'running', 'retrying'])

/**
 * Which state may follow which.
 *
 * Written down rather than left to whoever edits the scheduler next. A job that can reach `completed` from anywhere
 * is a job that can claim to have run without running, and that is the one thing this layer must never do.
 */
const ALLOWED: Readonly<Record<JobState, readonly JobState[]>> = Object.freeze({
  // `completed` is reachable from here for a one-off whose run is already recorded; `stateAfter` checks that.
  scheduled: ['ready', 'waitingForDevice', 'waitingForCondition', 'missed', 'paused', 'cancelled', 'blocked', 'completed'],
  ready: ['running', 'waitingForDevice', 'waitingForCondition', 'missed', 'cancelled', 'blocked', 'scheduled'],
  running: ['completed', 'failed', 'retrying', 'scheduled', 'cancelled'],
  retrying: ['running', 'failed', 'cancelled', 'scheduled'],
  waitingForDevice: ['ready', 'missed', 'scheduled', 'cancelled', 'paused'],
  waitingForCondition: ['ready', 'missed', 'scheduled', 'cancelled', 'paused'],
  blocked: ['scheduled', 'cancelled', 'paused'],
  // A one-off that ran is finished; a recurring one goes back to waiting, which is `scheduled`.
  completed: ['scheduled', 'cancelled'],
  failed: ['scheduled', 'retrying', 'cancelled'],
  missed: ['scheduled', 'cancelled'],
  cancelled: [],
  paused: ['scheduled', 'cancelled']
})

export function canMove(from: JobState, to: JobState): boolean {
  return from === to || (ALLOWED[from]?.includes(to) ?? false)
}

// ---------------------------------------------------------------- the job itself

export interface ExecutionRecord {
  executionId: string
  /** The occurrence this was for, which is not the same as when it actually ran. */
  dueAt: number
  startedAt: number
  finishedAt: number | null
  state: 'completed' | 'failed' | 'missed' | 'cancelled'
  attempt: number
  /** Why, in words somebody can act on. Never a stack trace and never a secret. */
  detail: string
}

export interface TemporalJob {
  format: typeof TEMPORAL_FORMAT
  jobId: string
  profileId: string
  name: string
  /** What was actually typed, kept for showing back. Never the authoritative schedule. */
  said: string
  action: TemporalAction
  schedule: Schedule
  policies: JobPolicies
  conditions: readonly JobCondition[]
  state: JobState
  createdAt: number
  updatedAt: number
  /** Bumped on every edit, so a run that is already going keeps the version it started with. */
  version: number
  nextRunAt: number | null
  lastRunAt: number | null
  runsSoFar: number
  /** Newest last, bounded -- an execution history that grows without limit is a disk leak with a nice name. */
  history: readonly ExecutionRecord[]
  /** Set while paused until a moment. */
  pausedUntil?: number
  /** Occurrences the person asked to skip, by their due time. */
  skipped: readonly number[]
}

export const TEMPORAL_FORMAT = 1
export const MAX_HISTORY = 50

/**
 * The key that stops one occurrence running twice.
 *
 * A job and a due time, never the moment it actually ran. That is the point: a retry, a catch-up after a restart and
 * a second scheduler all produce the same key for the same occurrence, so whichever gets there first is the only one
 * that does.
 */
export function occurrenceKey(jobId: string, dueAt: number): string {
  return `${jobId}@${dueAt}`
}

export type JobProblem = string

/** Whether a job is one the scheduler can actually keep. Every problem at once, so a form can show them together. */
export function checkJob(job: TemporalJob): JobProblem[] {
  const problems: JobProblem[] = []
  if (!job.jobId) problems.push('The job has no id.')
  if (!job.profileId) problems.push('The job belongs to no profile.')
  if (!job.name.trim()) problems.push('The job has no name.')
  if (!ACTION_KINDS.includes(job.action.kind)) problems.push(`“${String(job.action.kind)}” is not something Orbis can do.`)

  const a = job.action
  const needsText = (value: unknown, what: string): void => {
    if (typeof value !== 'string' || value.trim().length === 0) problems.push(`${what} is missing.`)
  }
  switch (a.kind) {
    case 'workflow':
      needsText(a.workflowId, 'The workflow')
      break
    case 'openUrl':
    case 'refreshUrl':
      // Only http and https. A schedule is not a way to reach a file or a custom scheme.
      if (!/^https?:\/\/\S+$/i.test(String(a.url))) problems.push('The address must be a web address.')
      break
    case 'openWorkspace':
      needsText(a.workspaceId, 'The workspace')
      break
    case 'openPage':
      needsText(a.pageId, 'The Page')
      break
    case 'closeTabs':
      needsText(a.urlMatches, 'What to match')
      break
    case 'orion':
      needsText(a.prompt, 'The question')
      break
    case 'notify':
      needsText(a.message, 'The message')
      break
  }

  if (job.policies.graceMinutes < 0) problems.push('The grace period cannot be negative.')
  if (job.policies.retry.kind === 'backoff') {
    if (job.policies.retry.attempts < 1) problems.push('Retries must be at least 1.')
    if (job.policies.retry.firstDelayMs < 1000) problems.push('The first retry must be at least a second later.')
  }
  for (const c of job.conditions) {
    if (c.kind === 'batteryAbove' && (c.percent < 0 || c.percent > 100)) problems.push('Battery must be 0 to 100.')
  }
  return problems
}

/** A job with its history trimmed and its newest record added. */
export function withExecution(job: TemporalJob, record: ExecutionRecord): TemporalJob {
  return { ...job, history: [...job.history, record].slice(-MAX_HISTORY) }
}
