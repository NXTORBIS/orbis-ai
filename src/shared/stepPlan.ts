/**
 * One step at a time.
 *
 * Orbis already has a workflow engine that carries out a written-down plan, and a Browser Control Layer that performs
 * each action and checks the browser afterwards. This module is neither of those. It is the state of an assistant
 * working through a goal it has not finished thinking about: it proposes the next step only, runs it through the
 * control layer, looks at the real browser, and only then decides what the step after it should be.
 *
 * Nothing here talks to a browser or a model. It is the rules about what may follow what, kept honest and testable
 * away from anything that could be persuaded otherwise. Two of those rules matter more than the rest:
 *
 *   A step becomes successful only when something looked at the browser and said so. Running the command is not
 *   evidence that the command worked, and this module will not accept it as evidence.
 *
 *   A plan is not progress. A step that has been thought of but not run is counted as still to do, everywhere, and
 *   there is no route through these functions that reports otherwise.
 *
 * The model's reasoning is deliberately not part of the session. `proposeStep` accepts it and drops it, keeping only
 * the one line meant for a person. What never enters a structure cannot leak out of one.
 */
import type { Condition, ControlError, ControlTarget, RetryPolicy } from './browserControl.ts'
import type { CaptchaEncounter } from './captcha.ts'
import { readPath } from './browserControl.ts'

/** Where a step is in its own life. */
export type StepPhase =
  /** Proposed and waiting its turn. */
  | 'ready'
  /** The command has been handed to the control layer. */
  | 'executing'
  /** The command came back; the browser is being looked at. */
  | 'verifying'
  /** The browser confirmed it. */
  | 'success'
  /** It did not work and will be tried again. */
  | 'retrying'
  /** It did not work and will not be tried again. */
  | 'failed'
  /** Something outside Orbis has to happen first — a sign-in, a challenge, a choice. */
  | 'waiting'
  /** Deliberately not run. */
  | 'skipped'
  /** The run ended before its turn came. */
  | 'cancelled'

export type SessionStatus = 'thinking' | 'running' | 'paused' | 'waiting' | 'done' | 'failed' | 'stopped'

/** What the assistant proposes doing next. One step, described the way it would be said out loud. */
export interface StepDraft {
  /** One line, for the person watching. "Open the orders page", not a paragraph. */
  intent: string
  /** The control-layer command, when the step is an action. Absent for a step that only waits on the user. */
  capability?: string
  params?: Record<string, unknown>
  target?: ControlTarget
  /** What must be true of the browser afterwards for this to have worked. */
  expect?: Condition
  /** Where to keep what the step returns, for later steps to use. */
  saveAs?: string
  retry?: RetryPolicy
  /** Steps that must have succeeded first. */
  dependsOn?: string[]
  /** The step needs a person before Orbis may go on. */
  needsUser?: string
  /**
   * The assistant's reasoning. Accepted so callers need not strip it themselves, and then discarded: it is never
   * stored, never sent onward, and never shown.
   */
  thought?: string
}

export interface PlannedStep {
  id: string
  /** 1, 2, 3 — the order it was proposed in, which is the order it runs in. */
  ordinal: number
  intent: string
  capability?: string
  params: Record<string, unknown>
  target?: ControlTarget
  expect?: Condition
  saveAs?: string
  dependsOn: string[]
  needsUser?: string
  phase: StepPhase
  /** How many times the command has been given, including the one running now. */
  attempts: number
  maxAttempts: number
  startedAt?: number
  endedAt?: number
  /** What looked at the browser, and what it saw. Absent until something has. */
  verification?: { verified: boolean; detail: string }
  error?: ControlError
  /** A short, already-redacted summary of what came back. */
  summary?: unknown
  /** Said plainly when a step is waiting, blocked or skipped. */
  note?: string
}

export interface StepSession {
  id: string
  profileId: string
  /** What the person asked for, in their words. */
  goal: string
  status: SessionStatus
  steps: PlannedStep[]
  /** What steps have learned so far, for the steps after them. */
  variables: Record<string, unknown>
  /** Ceiling on steps, so a goal that cannot be reached stops rather than runs forever. */
  maxSteps: number
  /** How many times the plan has been thrown away and thought about again. */
  replans: number
  maxReplans: number
  startedAt: number
  endedAt?: number
  /** Why it ended, or why it is waiting. */
  reason?: string
}

export const DEFAULT_MAX_STEPS = 40
export const DEFAULT_MAX_ATTEMPTS = 3
export const DEFAULT_MAX_REPLANS = 5

/** Phases a step will not move on from. */
const SETTLED: StepPhase[] = ['success', 'failed', 'skipped', 'cancelled']

export function isSettled(step: PlannedStep): boolean {
  return SETTLED.includes(step.phase)
}

export function isRunning(status: SessionStatus): boolean {
  return status === 'thinking' || status === 'running' || status === 'waiting'
}

export function newSession(options: {
  id: string
  profileId: string
  goal: string
  maxSteps?: number
  maxReplans?: number
  now?: number
}): StepSession {
  return {
    id: options.id,
    profileId: options.profileId,
    goal: options.goal.trim(),
    status: 'thinking',
    steps: [],
    variables: {},
    maxSteps: clamp(options.maxSteps ?? DEFAULT_MAX_STEPS, 1, 200),
    replans: 0,
    maxReplans: clamp(options.maxReplans ?? DEFAULT_MAX_REPLANS, 0, 20),
    startedAt: options.now ?? Date.now()
  }
}

// ---------------------------------------------------------------- proposing

/**
 * Adds the step the assistant wants to take next.
 *
 * One at a time is the point: a caller that has thought of three steps should propose the first, run it, look at what
 * the browser did, and propose the second in the light of that. Proposing several at once is allowed only because
 * refusing it would make the caller store them somewhere worse; they still run one at a time, and each is still
 * verified before the next begins.
 */
export function proposeStep(session: StepSession, draft: StepDraft, id: string, now = Date.now()): StepSession {
  if (!isRunning(session.status) && session.status !== 'paused') return session
  if (session.steps.length >= session.maxSteps) {
    return { ...session, status: 'failed', endedAt: now, reason: `This needed more than ${session.maxSteps} steps, so Orbis stopped rather than keep going.` }
  }
  const intent = draft.intent.trim()
  if (!intent) return session
  // Depend only on steps that exist: a name that matches nothing would otherwise block the step forever.
  const known = new Set(session.steps.map((s) => s.id))
  const step: PlannedStep = {
    id,
    ordinal: session.steps.length + 1,
    intent,
    capability: draft.capability,
    params: draft.params ? { ...draft.params } : {},
    target: draft.target,
    expect: draft.expect,
    saveAs: draft.saveAs,
    dependsOn: (draft.dependsOn ?? []).filter((d) => known.has(d)),
    needsUser: draft.needsUser,
    phase: 'ready',
    attempts: 0,
    maxAttempts: clamp(draft.retry?.attempts ?? DEFAULT_MAX_ATTEMPTS, 1, 5)
  }
  const status: SessionStatus = session.status === 'thinking' ? 'running' : session.status
  return { ...session, status, steps: [...session.steps, step] }
}

/** The step whose turn it is, or nothing if there is none to run. */
export function nextStep(session: StepSession): PlannedStep | undefined {
  if (session.status !== 'running') return undefined
  return session.steps.find((step) => step.phase === 'ready' || step.phase === 'retrying')
}

/** Whether every step this one waits on has actually succeeded. */
export function blockedBy(session: StepSession, step: PlannedStep): PlannedStep[] {
  return step.dependsOn
    .map((id) => session.steps.find((s) => s.id === id))
    .filter((s): s is PlannedStep => Boolean(s) && s!.phase !== 'success')
}

// ---------------------------------------------------------------- running one

/** Hands the step to the control layer. Refused when the session is not running or something it needs has not worked. */
export function beginStep(session: StepSession, stepId: string, now = Date.now()): StepSession {
  const step = session.steps.find((s) => s.id === stepId)
  if (!step || session.status !== 'running') return session
  if (step.phase !== 'ready' && step.phase !== 'retrying') return session

  const waiting = blockedBy(session, step)
  if (waiting.length) {
    return patch(session, stepId, {
      phase: 'failed',
      endedAt: now,
      note: `This needed “${waiting[0].intent}” to work first, and it did not.`
    })
  }
  if (step.needsUser) {
    return {
      ...patch(session, stepId, { phase: 'waiting', startedAt: step.startedAt ?? now, note: step.needsUser }),
      status: 'waiting',
      reason: step.needsUser
    }
  }
  return patch(session, stepId, { phase: 'executing', attempts: step.attempts + 1, startedAt: step.startedAt ?? now, error: undefined })
}

/**
 * What the control layer came back with.
 *
 * A command that ran is not a step that worked, so this never reaches `success`. At best it reaches `verifying`, and
 * the browser has the last word in `recordVerification`. The one exception is a control layer that already checked —
 * it passes its own verification here, and that is what decides.
 */
export function recordExecution(
  session: StepSession,
  stepId: string,
  outcome: { ok: boolean; error?: ControlError; summary?: unknown; verification?: { verified: boolean; detail: string } },
  now = Date.now()
): StepSession {
  const step = session.steps.find((s) => s.id === stepId)
  if (!step || step.phase !== 'executing') return session

  if (!outcome.ok) {
    return afterFailure(session, step, outcome.error, now)
  }
  const next = patch(session, stepId, { phase: 'verifying', summary: outcome.summary })
  if (outcome.verification) return recordVerification(next, stepId, outcome.verification, now)
  return next
}

/** What looking at the browser found. The only door to `success`, and it opens only one way. */
export function recordVerification(session: StepSession, stepId: string, verification: { verified: boolean; detail: string }, now = Date.now()): StepSession {
  const step = session.steps.find((s) => s.id === stepId)
  if (!step || step.phase !== 'verifying') return session

  if (!verification.verified) {
    return afterFailure(
      session,
      { ...step, verification },
      { code: 'verification-failed', message: verification.detail || 'The page did not end up the way this step needed it to.', recoverable: true },
      now
    )
  }
  const done = patch(session, stepId, { phase: 'success', verification, endedAt: now, error: undefined })
  const withVar = step.saveAs ? { ...done, variables: { ...done.variables, [step.saveAs]: step.summary } } : done
  return withVar
}

/** Another attempt, or the end of this step. */
function afterFailure(session: StepSession, step: PlannedStep, error: ControlError | undefined, now: number): StepSession {
  const fault = error ?? { code: 'failed', message: 'It did not work, and Orbis was not told why.', recoverable: false }
  const again = fault.recoverable && step.attempts < step.maxAttempts
  const next = patch(session, step.id, {
    phase: again ? 'retrying' : 'failed',
    error: fault,
    verification: step.verification,
    endedAt: again ? undefined : now
  })
  return next
}

/** Leaves a step out on purpose, with a reason a person can read. */
export function skipStep(session: StepSession, stepId: string, why: string, now = Date.now()): StepSession {
  const step = session.steps.find((s) => s.id === stepId)
  if (!step || isSettled(step)) return session
  return patch(session, stepId, { phase: 'skipped', note: why, endedAt: now })
}

/** The person did what the step was waiting for. */
export function userDone(session: StepSession, stepId: string): StepSession {
  const step = session.steps.find((s) => s.id === stepId)
  if (!step || step.phase !== 'waiting') return session
  const resumed: StepSession = { ...session, status: 'running', reason: undefined }
  // It still has to be verified like anything else; being told it is done is not the browser saying so.
  return patch(resumed, stepId, { phase: 'verifying', note: undefined })
}

// ---------------------------------------------------------------- the run as a whole

export function pause(session: StepSession, why = 'Paused.'): StepSession {
  return isRunning(session.status) ? { ...session, status: 'paused', reason: why } : session
}

export function resume(session: StepSession): StepSession {
  return session.status === 'paused' ? { ...session, status: 'running', reason: undefined } : session
}

/** Ends the run. Steps that never ran are marked cancelled, not failed: nothing was tried, so nothing went wrong. */
export function stop(session: StepSession, why = 'Stopped.', now = Date.now()): StepSession {
  if (!isRunning(session.status) && session.status !== 'paused') return session
  return {
    ...session,
    status: 'stopped',
    reason: why,
    endedAt: now,
    steps: session.steps.map((step) => (isSettled(step) ? step : { ...step, phase: 'cancelled', endedAt: now, note: why }))
  }
}

/** The assistant says the goal is reached. Refused while any step is still in the air. */
export function finish(session: StepSession, summary: string, now = Date.now()): StepSession {
  if (!isRunning(session.status)) return session
  const unfinished = session.steps.filter((step) => !isSettled(step))
  if (unfinished.length) return session
  // Judged by how it ended, not by every stumble on the way: a step that failed and was then done another way has
  // not failed the run. What decides is the last step that was actually attempted — if that one did not work, being
  // told the goal is reached is not believed.
  const attempted = session.steps.filter((step) => step.phase === 'success' || step.phase === 'failed')
  const last = attempted[attempted.length - 1]
  const failed = last?.phase === 'failed'
  return { ...session, status: failed ? 'failed' : 'done', reason: failed ? `The last step did not work: ${last.error?.message ?? last.intent}` : summary, endedAt: now }
}

/**
 * Throws away what has not been run and thinks again, after something in the page turned out not to be what the plan
 * assumed. What already happened is left exactly as it was: replanning changes what Orbis will do, never the record
 * of what it did.
 */
export function replan(session: StepSession, why: string, now = Date.now()): StepSession {
  if (!isRunning(session.status) && session.status !== 'paused') return session
  if (session.replans >= session.maxReplans) {
    return { ...session, status: 'failed', endedAt: now, reason: `Orbis changed its approach ${session.replans} times without getting there, so it stopped.` }
  }
  return {
    ...session,
    status: 'thinking',
    replans: session.replans + 1,
    reason: why,
    steps: session.steps.map((step) => (isSettled(step) ? step : { ...step, phase: 'skipped', note: why, endedAt: now }))
  }
}

// ---------------------------------------------------------------- saying where things are

export interface Progress {
  /** Steps the browser confirmed. */
  done: number
  /** Steps proposed, which is not the same as steps that will happen. */
  planned: number
  failed: number
  skipped: number
  /** The one happening now, if any. */
  running?: PlannedStep
}

/** What has actually happened. A step that has only been thought of is counted under `planned`, never under `done`. */
export function progress(session: StepSession): Progress {
  let done = 0
  let failed = 0
  let skipped = 0
  let running: PlannedStep | undefined
  for (const step of session.steps) {
    if (step.phase === 'success') done++
    else if (step.phase === 'failed') failed++
    else if (step.phase === 'skipped' || step.phase === 'cancelled') skipped++
    else if (step.phase !== 'ready') running = step
  }
  return { done, planned: session.steps.length, failed, skipped, running }
}

/** One line for the person watching, in the present tense, about what is true rather than what is intended. */
export function describe(session: StepSession): string {
  const p = progress(session)
  switch (session.status) {
    case 'thinking':
      return p.planned ? 'Working out what to do next.' : 'Working out where to start.'
    case 'waiting':
      return session.reason ?? 'Waiting for you.'
    case 'paused':
      return `Paused after ${p.done} of ${p.planned} steps.`
    case 'stopped':
      return session.reason ?? 'Stopped.'
    case 'failed':
      return session.reason ?? `Stopped after ${p.done} step${p.done === 1 ? '' : 's'}.`
    case 'done':
      return session.reason ?? `Done, in ${p.done} step${p.done === 1 ? '' : 's'}.`
    default:
      return p.running ? p.running.intent : 'Working.'
  }
}

/**
 * The session as it may be shown or logged.
 *
 * Parameters are the part most likely to be carrying something private — what was typed into a field, an address with
 * a token in it — so they do not travel. Whether a step worked does; what it was given to work with does not.
 */
export function publicSession(session: StepSession): Omit<StepSession, 'steps' | 'variables'> & { steps: PublicStep[]; variables: string[] } {
  const { steps, variables, ...rest } = session
  return { ...rest, steps: steps.map(publicStep), variables: Object.keys(variables) }
}

export type PublicStep = Omit<PlannedStep, 'params' | 'target' | 'expect' | 'summary'>

export type PublicSession = ReturnType<typeof publicSession>

/** A run as the window sees it: what is happening, what has happened, and the challenge in the way if there is one. */
export interface StepRunView {
  session: PublicSession
  /** One line about what is true now, in the present tense. */
  saying: string
  /** Never carries a token; there is nowhere in a CaptchaEncounter to put one. */
  captcha?: CaptchaEncounter
}

export function publicStep(step: PlannedStep): PublicStep {
  const { params, target, expect, summary, ...rest } = step
  void params
  void target
  void expect
  void summary
  return rest
}

// ---------------------------------------------------------------- what earlier steps left behind

/**
 * Fills {{name}} and {{name.path}} from what earlier steps saved.
 *
 * A name nothing has saved is left as it was written rather than becoming the word "undefined" in a search box: a step
 * that was given less than it needed should look wrong, not look like it worked.
 */
export function fill(value: unknown, variables: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    const whole = value.match(/^\{\{\s*([\w.]+)\s*\}\}$/)
    if (whole) {
      const found = lookup(variables, whole[1])
      return found === undefined ? value : found
    }
    return value.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (all, path: string) => {
      const found = lookup(variables, path)
      return found === undefined ? all : String(found)
    })
  }
  if (Array.isArray(value)) return value.map((item) => fill(item, variables))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, fill(item, variables)]))
  }
  return value
}

function lookup(variables: Record<string, unknown>, path: string): unknown {
  const [head, ...rest] = path.split('.')
  if (!(head in variables)) return undefined
  return rest.length ? readPath(variables[head], rest.join('.')) : variables[head]
}

/** The step, with everything earlier steps saved filled in, ready for the control layer. */
export function readyCommand(session: StepSession, step: PlannedStep): { capability: string; params: Record<string, unknown>; target?: ControlTarget } | undefined {
  if (!step.capability) return undefined
  return { capability: step.capability, params: fill(step.params, session.variables) as Record<string, unknown>, target: step.target }
}

// ---------------------------------------------------------------- small things

function patch(session: StepSession, stepId: string, changes: Partial<PlannedStep>): StepSession {
  return { ...session, steps: session.steps.map((step) => (step.id === stepId ? { ...step, ...changes } : step)) }
}

function clamp(value: number, low: number, high: number): number {
  return Number.isFinite(value) ? Math.min(high, Math.max(low, Math.round(value))) : low
}
