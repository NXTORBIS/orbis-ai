/**
 * What the Orb is doing, as a thing that can be inspected, checked and recovered.
 *
 * The Orb is not a chat window with buttons beside it. It takes a request in words, works out what Orbis would have to
 * do to satisfy it, does that against the real browser, watches what actually happened, and either continues or works
 * out a different way. This file is the record of that: the request, what it was understood to mean, what was
 * perceived, the plan, every step, every verification, every failure and what was decided about it.
 *
 * Three things are enforced here rather than hoped for, because they are the difference between an assistant and a
 * control system:
 *
 *   1. A step is done when the browser says it is done. `CommandResult` already carries a verification from the
 *      control layer; a step that has no verification, or a failed one, is not success, and `settle` will not call it
 *      one. Nothing in this file can mark a step complete on the strength of having sent the command.
 *
 *   2. A plan may only use capabilities the browser really has, right now. `groundPlan` checks every step against the
 *      live registry and refuses the ones that do not exist or are not available -- with the registry's own reason.
 *      An Orb that plans `downloads.deleteAll` on a browser without it has not planned; it has written fiction.
 *
 *   3. A failure is classified before anything is decided about it. Retrying a permission refusal is pointless and
 *      re-planning a network blip is wasteful; the two need telling apart, from the error the control layer gave.
 *
 * Nothing here executes anything. Execution is the Browser Control Layer's and PlanRun's, which already do variables,
 * conditions, loops, checkpoints, retries and confirmations -- this decides what to ask them for and what to make of
 * what they report.
 */

import type { CapabilityDescriptor, ControlError, ControlErrorCode } from './browserControl.ts'
import { isConsequential } from './orbSafety.ts'

/** What kind of thing the request turned out to be. Decided from the words and from what was perceived, not guessed. */
export type OrbIntent =
  /** Something to do in the browser: open, close, navigate, click, fill, organise. */
  | 'act'
  /** A question about the page, the browser, or the world. */
  | 'ask'
  /** A question that needs reading the web first. */
  | 'research'
  /** Something to look at rather than read: a screenshot, an image, a chart. */
  | 'see'
  /** A picture to make or change. */
  | 'imagine'
  /** Something to keep: a note, a task, a source, a whiteboard, a workspace. */
  | 'keep'
  /** Something to turn into a repeatable workflow or skill. */
  | 'automate'

/**
 * Why a step failed, in terms that decide what to do next.
 *
 * Derived from the control layer's own error code rather than by reading messages, because a message is prose and a
 * code is a fact. `unknown` exists and is honest: something failed in a way this does not recognise, and pretending
 * otherwise would send the recovery down a path chosen at random.
 */
export type FailureKind =
  /** The thing acted on is no longer there: the page moved on, the element went away. */
  | 'stale'
  /** The browser cannot do this now, and said why. */
  | 'unavailable'
  /** Asked for something that does not exist. */
  | 'unknown-capability'
  /** The parameters were wrong. */
  | 'bad-params'
  /** Nothing matched what was described. */
  | 'not-found'
  /** The person said no. */
  | 'declined'
  /** A protection refused it: a permission, a security boundary, a site's own rules. */
  | 'blocked'
  /**
   * The tab is locked.
   *
   * Kept apart from `blocked` because the recovery is different in kind: a blocked action is over, and a locked tab is
   * one password away. The Orb must say which of those it is, or it either gives up on something the person could fix in
   * five seconds or waits for something that is never coming.
   */
  | 'tab-locked'
  /** It took too long. */
  | 'timeout'
  /** It ran, and the browser afterwards was not what it should have been. */
  | 'unverified'
  /** Stopped. */
  | 'aborted'
  | 'unknown'

/** What to do about a failure. */
export type Recovery =
  /** The same thing again: transient, and the control layer says it may work. */
  | 'retry'
  /** Look at the browser again, then try the same step with fresh state. */
  | 're-perceive'
  /** The path is no longer valid; work out a new one from where things actually are. */
  | 're-plan'
  /** Only a person can get past this. */
  | 'ask-user'
  /** Nothing here will help, and saying so is the honest end. */
  | 'give-up'

/** One thing the Orb decided to do, and everything that became of it. */
export interface OrbStep {
  id: string
  /** What this is for, in words, so a person reading the run can follow it. */
  name: string
  /** The capability chosen from the live registry. */
  capability: string
  params: Record<string, unknown>
  /** Which step's result this needs first. Steps with no dependencies may run together. */
  needs: string[]
  /** Where the result is kept, for later steps to use. */
  saveAs?: string
  /** True when the step failing should not fail the task. */
  optional?: boolean
  status: 'planned' | 'blocked' | 'running' | 'done' | 'failed' | 'skipped'
  /** What the browser reported. Present once it has run. */
  result?: {
    ok: boolean
    data?: unknown
    error?: ControlError
    /** The control layer's own check of the browser after acting. Absent means it did not check. */
    verification?: { verified: boolean; detail: string }
    attempts: number
  }
  failure?: { kind: FailureKind; message: string; recovery: Recovery }
  /** How many times this step has been attempted, across recoveries. */
  tries: number
}

/** What the browser actually looked like when the Orb last looked. Never a guess, and never kept past its usefulness. */
export interface Perception {
  at: number
  /** What the browser can do right now, from the registry itself. */
  capabilities: CapabilityDescriptor[]
  tabs: { id: string; title: string; url: string; active: boolean }[]
  /** The page in front, when there is a real one. */
  page: { url: string; title: string; text?: string; selection?: string } | null
  /** Set when a screenshot was taken for this turn, so Vision is not asked for twice. */
  shot?: string
}

export interface OrbTaskState {
  id: string
  request: string
  intent: OrbIntent | null
  /** What was perceived, and when. Replaced whenever the Orb looks again. */
  perception: Perception | null
  steps: OrbStep[]
  /** Results kept for later steps and for follow-up requests ("use the previous result"). */
  variables: Record<string, unknown>
  /** Every attempt, in order, so a failure can be traced precisely. */
  history: { at: number; stepId: string; capability: string; ok: boolean; detail: string }[]
  /** How many times the whole plan has been reconsidered. Bounded, so it cannot loop forever. */
  replans: number
  status: 'planning' | 'running' | 'waiting' | 'done' | 'failed' | 'stopped'
  /** Why it ended, in words, when it ended. */
  outcome?: string
}

export const MAX_TRIES = 3
export const MAX_REPLANS = 3

export const newTask = (id: string, request: string): OrbTaskState => ({
  id,
  request,
  intent: null,
  perception: null,
  steps: [],
  variables: {},
  history: [],
  replans: 0,
  status: 'planning'
})

/** The control layer's codes, mapped to the kinds that decide recovery. */
const KINDS: Record<ControlErrorCode, FailureKind> = {
  'unknown-capability': 'unknown-capability',
  unavailable: 'unavailable',
  'invalid-params': 'bad-params',
  'not-found': 'not-found',
  'stale-element': 'stale',
  declined: 'declined',
  blocked: 'blocked',
  'tab-locked': 'tab-locked',
  timeout: 'timeout',
  failed: 'unknown',
  'verification-failed': 'unverified',
  aborted: 'aborted'
}

export const classifyFailure = (error: ControlError | undefined): FailureKind => (error ? (KINDS[error.code] ?? 'unknown') : 'unknown')

/**
 * What to do about a failure, given how many times this step has already been tried.
 *
 * The distinctions matter. A stale element means the page moved and the plan's idea of it is out of date: look again
 * rather than repeat. A blocked action means a protection said no, and no number of retries is going to change that --
 * the Orb must not sit in a loop pushing at a permission prompt. A declined action is the person's answer and is
 * final. Only what the control layer itself marked recoverable is retried, and only for a bounded number of tries.
 */
export function decideRecovery(kind: FailureKind, tries: number, recoverable: boolean): Recovery {
  if (kind === 'aborted') return 'give-up'
  // The person already answered. Asking again would be pestering, and doing it anyway would be worse.
  if (kind === 'declined') return 'give-up'
  // A protection refused. Orbis does not get past those, and must not try.
  if (kind === 'blocked') return 'ask-user'
  // A locked tab needs a password, which only the person has. Retrying is pointless and re-planning would mean finding
  // a way around a lock -- which is the one thing this must never do.
  if (kind === 'tab-locked') return 'ask-user'
  if (kind === 'unknown-capability') return 're-plan'
  if (tries >= MAX_TRIES) return kind === 'unverified' || kind === 'not-found' || kind === 'stale' ? 're-plan' : 'give-up'
  if (kind === 'stale') return 're-perceive'
  if (kind === 'not-found') return tries >= 2 ? 're-plan' : 're-perceive'
  if (kind === 'unverified') return 're-perceive'
  if (kind === 'unavailable') return 're-plan'
  if (kind === 'bad-params') return 're-plan'
  if (kind === 'timeout') return recoverable ? 'retry' : 're-plan'
  return recoverable ? 'retry' : 're-plan'
}

/**
 * Settles a step from what the browser reported.
 *
 * This is the one place a step becomes `done`, and it will not do so without a verification that passed. A command
 * that returned ok with no verification is left failed as `unverified`: the control layer checks its own work, and a
 * capability that did not check is not a capability that can be reported as having worked.
 */
export function settle(step: OrbStep, result: NonNullable<OrbStep['result']>): OrbStep {
  const tries = step.tries + 1
  if (result.ok && result.verification?.verified === true) {
    return { ...step, status: 'done', result, tries, failure: undefined }
  }
  const kind: FailureKind = result.ok ? 'unverified' : classifyFailure(result.error)
  const message = result.ok
    ? (result.verification?.detail ?? 'The browser did not confirm this happened.')
    : (result.error?.message ?? 'The browser could not do that.')
  const recovery = decideRecovery(kind, tries, result.error?.recoverable === true)
  return { ...step, status: 'failed', result, tries, failure: { kind, message, recovery } }
}

/** A step is ready when everything it needs is done. Anything else waits, and a task of them all waiting is stuck. */
export const ready = (step: OrbStep, steps: OrbStep[]): boolean =>
  step.status === 'planned' && step.needs.every((id) => steps.find((s) => s.id === id)?.status === 'done')

/**
 * The steps that may run now, together.
 *
 * Steps that change nothing can run alongside each other; anything that changes the browser runs on its own. Two
 * commands mutating the same browser at once is how a plan ends up acting on a page that the other one just navigated
 * away from, and the whole point of this file is not doing that.
 */
export function runnable(steps: OrbStep[], capabilities: CapabilityDescriptor[]): OrbStep[] {
  const able = steps.filter((s) => ready(s, steps))
  if (!able.length) return []
  const mutates = (step: OrbStep): boolean => capabilities.find((c) => c.id === step.capability)?.mutates !== false
  const first = able[0]
  if (mutates(first)) return [first]
  return able.filter((s) => !mutates(s))
}

/** True when nothing can run and nothing is running: the plan cannot get any further by itself. */
export const stuck = (steps: OrbStep[]): boolean =>
  steps.some((s) => s.status === 'planned') && !steps.some((s) => s.status === 'running') && steps.every((s) => s.status !== 'planned' || !ready(s, steps))

/**
 * Checks a plan against the browser as it actually is.
 *
 * Everything here is a refusal to pretend. A capability the registry does not have cannot be planned; one the registry
 * says is unavailable cannot be planned *now*, and the reason given is the registry's own words rather than a guess at
 * them. A step that depends on a step that was dropped is dropped with it, because half a plan carried out is worse
 * than a plan declined -- it leaves the browser somewhere nobody asked for.
 */
export function groundPlan(steps: OrbStep[], capabilities: CapabilityDescriptor[]): { steps: OrbStep[]; refused: { step: OrbStep; why: string }[] } {
  const byId = new Map(capabilities.map((c) => [c.id, c]))
  const refused: { step: OrbStep; why: string }[] = []
  const dropped = new Set<string>()

  const kept: OrbStep[] = []
  for (const step of steps) {
    const capability = byId.get(step.capability)
    if (!capability) {
      refused.push({ step, why: `Orbis has no capability called ${step.capability}.` })
      dropped.add(step.id)
      continue
    }
    if (!capability.available) {
      refused.push({ step, why: capability.unavailableReason ?? `${capability.name} cannot be used right now.` })
      dropped.add(step.id)
      continue
    }
    const missing = step.needs.filter((id) => dropped.has(id))
    if (missing.length) {
      refused.push({ step, why: `It needed a step that could not be planned.` })
      dropped.add(step.id)
      continue
    }
    // Only parameters the capability actually declares. An extra one is a misunderstanding, and passing it on would
    // turn a planning mistake into a call the control layer has to reject.
    const params: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(step.params ?? {})) {
      if (Object.prototype.hasOwnProperty.call(capability.params ?? {}, key)) params[key] = value
    }
    kept.push({ ...step, params })
  }
  return { steps: kept, refused }
}

/**
 * Which steps need asking first, from each capability's own policy rather than from a list kept here.
 *
 * `always` always asks. `when-consequential` asks when the thing being done cannot be undone by noticing afterwards --
 * sending, buying, deleting, granting. `none` is the ordinary reversible case and is done directly, which is what
 * makes the Orb usable: an assistant that asks before opening a tab is one nobody lets near their browser.
 */
export function needsConfirming(steps: OrbStep[], capabilities: CapabilityDescriptor[]): OrbStep[] {
  const byId = new Map(capabilities.map((c) => [c.id, c]))
  return steps.filter((s) => {
    const c = byId.get(s.capability)
    if (!c) return false
    if (c.confirmation === 'always') return true
    return c.confirmation === 'when-consequential' && isConsequential(c.id)
  })
}

/**
 * What became of the task, said accurately.
 *
 * The rule the whole file exists for lives in the first line: if anything was left unfinished, the task did not
 * succeed, whatever else went right. An Orb that reports "done" over three completed steps and one silent failure has
 * told the person something false about their browser.
 */
export function describeOutcome(task: OrbTaskState): string {
  const done = task.steps.filter((s) => s.status === 'done')
  const failed = task.steps.filter((s) => s.status === 'failed')
  const skipped = task.steps.filter((s) => s.status === 'skipped')
  const unfinished = task.steps.filter((s) => s.status === 'planned' || s.status === 'blocked')

  if (!task.steps.length) return 'Nothing was done.'
  if (failed.length || unfinished.length) {
    const first = failed[0]
    const why = first?.failure?.message ?? 'Some steps could not be carried out.'
    const got = done.length ? `${done.length} of ${task.steps.length} steps were done. ` : ''
    return `${got}This did not finish: ${why}`
  }
  const kept = skipped.length ? ` ${skipped.length} step${skipped.length === 1 ? ' was' : 's were'} skipped.` : ''
  return `Done: ${done.length} step${done.length === 1 ? '' : 's'}, each confirmed by the browser.${kept}`
}
