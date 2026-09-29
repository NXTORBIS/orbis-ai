/**
 * One attempt at building a Page, from the sentence somebody typed to something that opens.
 *
 * Generation is slow, it involves a model, and it can be interrupted -- by a crash, by somebody closing the window,
 * by the model never answering. So it is a state machine that is written down after every step rather than a function
 * that runs to completion, and this file is the machine: pure, testable without a model, and the only place that
 * decides what may follow what.
 *
 * ```
 * resolving -> planning -> compiling -> validating -> trying -> ready
 *      |           |            |            |           |
 *      +-----------+------------+------------+-----------+---> failed
 *      (and cancelled, from any of them, because somebody asked)
 * ```
 *
 * ## Why every step is written down
 *
 * The stage that takes real time is `planning`, because a model is answering. If that is not recorded before it
 * starts, a crash halfway through leaves a session that looks like it never began, and the work is done again from
 * nothing -- or worse, a half-written Page is left in the library. Writing the stage first and the result second
 * means a session found later can always be told apart: one in a working stage was interrupted, and one in a resting
 * stage was not.
 *
 * ## Why an interrupted session is not just resumed
 *
 * A session that crashed during `planning` might have crashed *because* of what it was doing. Resuming it
 * automatically, forever, is a loop that burns a model quota and never finishes. So recovery counts attempts, and
 * past a small number the session fails with the reason -- which somebody can read, unlike a spinner.
 *
 * ## Model output is data, at every stage
 *
 * What the model returns is stored on the session as raw, untrusted material and is never acted on until `compiling`
 * has put it through `checkSpec`. Nothing here reads a field out of it, branches on it, or shows it. A session
 * carrying a plausible-looking spec that failed validation is a session that failed, and the text is kept only so
 * somebody can see what was produced.
 */

import type { PageDocument } from './builder.ts'
import type { PageManifest } from './manifest.ts'
import type { Resolution } from './resolution.ts'
import type { PageSpec, SpecProblem } from './spec.ts'
import type { ValidationResult } from './validation.ts'

export const GENERATION_LIMITS = Object.freeze({
  /**
   * How many times an interrupted session is picked up again.
   *
   * Small on purpose. A session that has crashed three times is not going to work on the fourth, and a loop that
   * keeps trying is one nobody can see the end of.
   */
  attempts: 3,
  /** How long a session may sit in a working stage before it is treated as interrupted. */
  staleAfterMs: 5 * 60_000,
  /** How long a finished session is kept, so somebody can look at what happened. */
  keepForMs: 7 * 24 * 60 * 60_000,
  requestLength: 400,
  /** How much raw model output is kept. Enough to see what went wrong, not enough to be a log of everything. */
  rawLength: 100_000
})

export type Stage =
  /** Deciding whether anything existing answers this. */
  | 'resolving'
  /** A model is writing a specification. The slow one. */
  | 'planning'
  /** The specification is being checked and turned into a Page. */
  | 'compiling'
  /** The Page is going through the gates. */
  | 'validating'
  /** The Page is being run for real, to see whether its calculations answer. */
  | 'trying'
  /** Built, checked, and waiting for somebody to decide whether to keep it. */
  | 'ready'
  | 'failed'
  | 'cancelled'

/** Stages where something is happening, so a session found in one was interrupted rather than finished. */
export const WORKING: ReadonlySet<Stage> = new Set<Stage>(['resolving', 'planning', 'compiling', 'validating', 'trying'])

/** Stages nothing follows. */
export const RESTING: ReadonlySet<Stage> = new Set<Stage>(['ready', 'failed', 'cancelled'])

const NEXT: Readonly<Record<Stage, readonly Stage[]>> = Object.freeze({
  resolving: ['planning', 'failed', 'cancelled'],
  planning: ['compiling', 'failed', 'cancelled'],
  compiling: ['validating', 'failed', 'cancelled'],
  validating: ['trying', 'failed', 'cancelled'],
  trying: ['ready', 'failed', 'cancelled'],
  ready: [],
  failed: [],
  cancelled: []
})

export type FailureCode =
  /** Nothing needed building: something already does this, or it was never a Page. */
  | 'nothing-to-build'
  /** It needed building and could not be: nothing Orbis has can work this out. Said apart from the above because
   *  "there is already a Page for this" is the best outcome and "Orbis cannot do this" is the worst, and a screen
   *  that renders them the same teaches somebody the feature is unreliable. */
  | 'cannot-be-built'
  | 'no-model'
  | 'model-failed'
  | 'spec-rejected'
  | 'compile-failed'
  | 'gates-failed'
  | 'would-not-run'
  | 'gave-up'
  | 'cancelled'

export interface Failure {
  code: FailureCode
  /** A sentence somebody reads. Never a stack trace and never the model's own words. */
  message: string
  /** What was wrong in detail, where there was detail. */
  problems: readonly SpecProblem[]
}

export interface StageRecord {
  stage: Stage
  at: number
  /** A sentence about what happened, for a screen showing progress and for working out afterwards what went wrong. */
  note: string
}

export interface GenerationSession {
  sessionId: string
  /** What was asked for, as it was typed. */
  request: string
  profileId: string
  startedAt: number
  updatedAt: number
  stage: Stage
  /** How many times this has been picked up after an interruption. */
  attempts: number
  resolution: Resolution | null
  /**
   * What the model returned, as text, untouched.
   *
   * Kept as evidence rather than as input. Nothing reads a field out of this; `compiling` parses it and hands the
   * result to `checkSpec`, and everything after that works from what the checker returned.
   */
  raw: string | null
  spec: PageSpec | null
  built: { manifest: PageManifest; document: PageDocument } | null
  validation: ValidationResult | null
  failure: Failure | null
  history: readonly StageRecord[]
}

export interface SessionError {
  error: 'bad-transition' | 'bad-request' | 'already-finished'
  message: string
}

export const isSessionError = (value: unknown): value is SessionError =>
  typeof value === 'object' && value !== null && 'error' in value

export function startSession(parts: { sessionId: string; request: string; profileId: string; now: number }): GenerationSession | SessionError {
  const request = parts.request.trim()
  if (request.length === 0) return { error: 'bad-request', message: 'There is nothing to build.' }
  if (request.length > GENERATION_LIMITS.requestLength) {
    return {
      error: 'bad-request',
      message: `A request for a Page is a sentence, and this is ${request.length} characters.`
    }
  }
  return {
    sessionId: parts.sessionId,
    request,
    profileId: parts.profileId,
    startedAt: parts.now,
    updatedAt: parts.now,
    stage: 'resolving',
    attempts: 1,
    resolution: null,
    raw: null,
    spec: null,
    built: null,
    validation: null,
    failure: null,
    history: [{ stage: 'resolving', at: parts.now, note: 'Looking for a Page that already does this.' }]
  }
}

const moveTo = (session: GenerationSession, stage: Stage, note: string, now: number, extra: Partial<GenerationSession> = {}): GenerationSession | SessionError => {
  if (RESTING.has(session.stage)) {
    return { error: 'already-finished', message: 'This has already finished, so nothing more can happen to it.' }
  }
  if (!NEXT[session.stage].includes(stage)) {
    return { error: 'bad-transition', message: `A session that is ${session.stage} cannot become ${stage}.` }
  }
  return {
    ...session,
    ...extra,
    stage,
    updatedAt: now,
    history: [...session.history, { stage, at: now, note }].slice(-40)
  }
}

/** What the ladder decided. Anything other than `generate` ends the session, because nothing needed building. */
export function resolved(session: GenerationSession, resolution: Resolution, now: number): GenerationSession | SessionError {
  if (resolution.action !== 'generate') {
    return moveTo(
      session,
      'failed',
      `Nothing was built: ${resolution.action}.`,
      now,
      {
        resolution,
        failure: {
          code: 'nothing-to-build',
          message:
            resolution.action === 'decline'
              ? resolution.because[0] ?? 'This is not something a Page would do.'
              : 'A Page that already exists answers this, so nothing was built.',
          problems: []
        }
      }
    )
  }
  return moveTo(session, 'planning', 'Writing a specification for a Page that does this.', now, { resolution })
}

/** The model answered. Its output is stored as text and nothing is read out of it here. */
export function planned(session: GenerationSession, raw: string, now: number): GenerationSession | SessionError {
  return moveTo(session, 'compiling', 'Checking the specification and building the Page.', now, {
    raw: raw.slice(0, GENERATION_LIMITS.rawLength)
  })
}

export function compiled(
  session: GenerationSession,
  built: { spec: PageSpec; manifest: PageManifest; document: PageDocument },
  now: number
): GenerationSession | SessionError {
  return moveTo(session, 'validating', 'Putting the Page through its checks.', now, {
    spec: built.spec,
    built: { manifest: built.manifest, document: built.document }
  })
}

/**
 * The gates ran.
 *
 * A failed gate ends the session here. The alternative -- carrying on to run a Page that failed its permission check
 * -- is exactly the thing the gates exist to stop.
 */
export function validated(session: GenerationSession, validation: ValidationResult, now: number): GenerationSession | SessionError {
  if (!validation.passed) {
    return moveTo(session, 'failed', 'The Page did not pass its checks.', now, {
      validation,
      failure: {
        code: 'gates-failed',
        message: 'The Page that was built did not pass its checks, so it was not kept.',
        problems: validation.problems.map((one) => ({ at: '', severity: 'error' as const, code: 'gate', message: one }))
      }
    })
  }
  return moveTo(session, 'trying', 'Running it, to see whether its calculations answer.', now, { validation })
}

/** It was run. `validation` is replaced with the version that includes the running gate. */
export function tried(session: GenerationSession, validation: ValidationResult, now: number): GenerationSession | SessionError {
  if (!validation.passed) {
    return moveTo(session, 'failed', 'The Page was built and would not run.', now, {
      validation,
      failure: {
        code: 'would-not-run',
        message: 'The Page was built, and its calculations refused the numbers it started with.',
        problems: validation.problems.map((one) => ({ at: '', severity: 'error' as const, code: 'run', message: one }))
      }
    })
  }
  return moveTo(session, 'ready', 'Built, checked, and waiting to be kept or thrown away.', now, { validation })
}

export function failed(session: GenerationSession, failure: Failure, now: number): GenerationSession | SessionError {
  return moveTo(session, 'failed', failure.message, now, { failure })
}

/** Somebody asked for it to stop. Allowed from any working stage, and from none of the resting ones. */
export function cancel(session: GenerationSession, now: number): GenerationSession | SessionError {
  return moveTo(session, 'cancelled', 'Stopped because somebody asked.', now, {
    failure: { code: 'cancelled', message: 'This was stopped before it finished.', problems: [] }
  })
}

// ---------------------------------------------------------------- picking up the pieces

export type Recovery =
  /** It was not interrupted. Nothing to do. */
  | { action: 'leave'; because: string }
  /** It was interrupted and is worth another go, from this stage. */
  | { action: 'restart'; from: Stage; session: GenerationSession; because: string }
  /** It was interrupted too many times, or too long ago. */
  | { action: 'give-up'; session: GenerationSession; because: string }

/**
 * What to do about a session found in a working stage.
 *
 * The judgement is deliberately about *time*, not about whether the process is alive: a session is found after a
 * restart, when there is nothing left to ask. A session updated a moment ago is probably still being worked on by
 * something in this very process, and restarting it would run two of the same generation at once.
 *
 * Restarting always goes back to `resolving`. Not because the earlier stages were wrong, but because the resolution
 * may not be: a Page may have been registered in the meantime that answers this, and the whole point of the ladder is
 * that generating is the last resort. Re-checking costs nothing next to a generation.
 */
export function recover(session: GenerationSession, now: number): Recovery {
  if (!WORKING.has(session.stage)) {
    return { action: 'leave', because: 'It is not in the middle of anything.' }
  }
  const idle = now - session.updatedAt
  if (idle < GENERATION_LIMITS.staleAfterMs) {
    return { action: 'leave', because: 'It was being worked on a moment ago, and starting a second one would run both.' }
  }
  if (session.attempts >= GENERATION_LIMITS.attempts) {
    return {
      action: 'give-up',
      because: `It has been picked up ${session.attempts} times and has not finished.`,
      session: {
        ...session,
        stage: 'failed',
        updatedAt: now,
        failure: {
          code: 'gave-up',
          message: `Building this was interrupted ${session.attempts} times, so it was stopped rather than tried again.`,
          problems: []
        },
        history: [...session.history, { stage: 'failed' as const, at: now, note: 'Given up after too many interruptions.' }].slice(-40)
      }
    }
  }
  return {
    action: 'restart',
    from: 'resolving',
    because: `It stopped during ${session.stage} and nothing has happened since.`,
    session: {
      ...session,
      stage: 'resolving',
      attempts: session.attempts + 1,
      updatedAt: now,
      // Everything downstream of resolving is cleared, so a restarted session cannot show half of a previous attempt.
      resolution: null,
      raw: null,
      spec: null,
      built: null,
      validation: null,
      failure: null,
      history: [...session.history, { stage: 'resolving' as const, at: now, note: `Picked up again after stopping during ${session.stage}.` }].slice(-40)
    }
  }
}

/** Whether a finished session is old enough to throw away. */
export const isExpired = (session: GenerationSession, now: number): boolean =>
  RESTING.has(session.stage) && now - session.updatedAt > GENERATION_LIMITS.keepForMs

/** A sentence about where a session has got to, for a screen that is waiting. */
export function describeStage(session: GenerationSession): string {
  switch (session.stage) {
    case 'resolving':
      return 'Looking for a Page that already does this'
    case 'planning':
      return 'Working out what the Page should be'
    case 'compiling':
      return 'Building it'
    case 'validating':
      return 'Checking it'
    case 'trying':
      return 'Running it'
    case 'ready':
      return 'Ready'
    case 'cancelled':
      return 'Stopped'
    case 'failed':
      return session.failure?.message ?? 'It did not work'
  }
}

export const GENERATION_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Every step is written down before it starts, so a session found later can always be told apart from one that never began.',
  'An interrupted session is picked up a small number of times and then fails with a reason, because a session that has crashed three times will not work on the fourth.',
  'Picking one up always goes back to the beginning of the ladder, because a Page that answers this may have been registered since.',
  'What the model returned is kept as evidence and never read as input. Only the checker’s output is acted on.',
  'A session updated a moment ago is left alone. Something may still be working on it, and starting a second would run both.',
  'A failed gate ends the session. Carrying on to run a Page that failed its permission check is the thing the gates exist to stop.'
])
