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
  /**
   * A name shared by the steps that repeat together.
   *
   * "Watch the next five Shorts" is not five plans. It is one plan -- wait for this one to end, move on, check the
   * next one arrived -- run five times. Naming the steps that belong together is what lets them be run again
   * without the plan being written out five times, and without a second engine to run loops in.
   */
  group?: string
  /**
   * How many times the group runs in total. Only read from the first step of a group.
   *
   * Bounded on purpose. A loop with no end is a task that can never finish, never be cleaned up and never be
   * honestly reported on, so a plan says how many times or it does not loop.
   */
  repeat?: number
  /** Which time round this is, counting from 1. Kept so a person can be told, and so a loop cannot run forever. */
  pass?: number
  /**
   * Whether this step happens at all, decided from what an earlier step found.
   *
   * "If the meeting has started, join it; otherwise wait." "Close it if it is a duplicate." "If there is a PDF,
   * summarise it." All of those are one plan whose middle depends on something only the browser can answer, and
   * without this they are three plans a person has to choose between before anything has been looked at.
   *
   * A condition is read, never executed: it names a saved result and says what about it has to be true. Nothing here
   * evaluates a string of code, because the thing writing these conditions is a language model reading web pages, and
   * a page that can get an expression evaluated is a page that can do anything.
   */
  when?: OrbCondition
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
/**
 * A question about something an earlier step found, in a form that can only ever be a question.
 *
 * `of` names a saved result, optionally with a dotted path into it -- `playing.state`, `tabs.0.url`. The rest is how
 * that value is compared, and exactly one comparison applies: whichever is given. `not` flips the answer, which is how
 * "otherwise" is said without a second kind of step.
 */
export interface OrbCondition {
  /** The saveAs name of an earlier step, optionally with a dotted path into its result. */
  of: string
  /** Present and not empty; absent or empty; truthy; falsy. */
  is?: 'present' | 'empty' | 'true' | 'false'
  /** Equal to this, compared as text so "3" and 3 are the same answer. */
  equals?: string | number | boolean
  /** Contains this, for text and for lists. */
  contains?: string
  /** At least this many, for a number or the length of a list or text. */
  atLeast?: number
  /** At most this many. */
  atMost?: number
  /** Flips the answer. */
  not?: boolean
}

/** The value a condition is about, from the saved results, or undefined when nothing has saved it. */
export function valueAt(variables: Record<string, unknown>, path: string): unknown {
  const parts = String(path ?? '')
    .split('.')
    .filter(Boolean)
  let at: unknown = variables
  for (const part of parts) {
    if (at === null || at === undefined) return undefined
    if (Array.isArray(at)) {
      const index = Number(part)
      at = Number.isInteger(index) ? at[index] : undefined
      continue
    }
    if (typeof at !== 'object') return undefined
    at = (at as Record<string, unknown>)[part]
  }
  return at
}

/** The names a plan may put in a parameter to mean "whatever that step found": {{tabs}}, {{page.title}}. */
export const REFERENCE = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g

/**
 * Fills a step's parameters in from what earlier steps saved.
 *
 * `saveAs` has always named a result; until now nothing could read one, so a plan whose second step needed the first
 * step's answer had to guess it at planning time -- before the browser had been asked. This is the other end of that:
 * `{{tabs}}` in a parameter becomes the list the earlier step actually returned.
 *
 * A whole-string reference keeps the value's own type, so `{{count}}` arrives as the number 4 rather than the text
 * "4"; a reference inside a longer string is substituted as text, which is what somebody writing "Notes on {{title}}"
 * meant. A name nothing has saved is left exactly as written, so it shows up in the failure as the unfilled reference
 * it is instead of silently becoming the word "undefined".
 */
export function fillIn<T>(value: T, variables: Record<string, unknown>, depth = 0): T {
  if (depth > 6 || value === null || value === undefined) return value
  if (typeof value === 'string') {
    const whole = value.match(/^\{\{\s*([A-Za-z0-9_.]+)\s*\}\}$/)
    if (whole) {
      const found = valueAt(variables, whole[1])
      return (found === undefined ? value : found) as unknown as T
    }
    return value.replace(REFERENCE, (all, path: string) => {
      const found = valueAt(variables, path)
      if (found === undefined) return all
      return typeof found === 'object' ? JSON.stringify(found) : String(found)
    }) as unknown as T
  }
  if (Array.isArray(value)) return value.map((v) => fillIn(v, variables, depth + 1)) as unknown as T
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) out[key] = fillIn(v, variables, depth + 1)
    return out as unknown as T
  }
  return value
}

const size = (value: unknown): number | null => {
  if (typeof value === 'number') return value
  if (typeof value === 'string' || Array.isArray(value)) return value.length
  return null
}

/**
 * Whether a condition holds, or cannot be answered yet.
 *
 * Three answers, not two, and the third is the important one. A condition about a step that has not run has no
 * answer -- treating that as false would quietly skip the branch that was supposed to happen, and treating it as true
 * would run it on nothing. `'unknown'` makes the step wait, which is what somebody who wrote "if the download
 * finished" meant for the moment before it has.
 */
export function judge(condition: OrbCondition | undefined, variables: Record<string, unknown>): true | false | 'unknown' {
  if (!condition || !condition.of) return true
  const root = String(condition.of).split('.').filter(Boolean)[0]
  if (!root || !Object.prototype.hasOwnProperty.call(variables, root)) return 'unknown'

  const value = valueAt(variables, condition.of)
  const flip = (answer: boolean): boolean => (condition.not ? !answer : answer)

  if (condition.is === 'present') return flip(value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && value.length === 0))
  if (condition.is === 'empty') return flip(value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0))
  if (condition.is === 'true') return flip(Boolean(value))
  if (condition.is === 'false') return flip(!value)
  // Compared as text, because a model writes "3" where the browser answered 3 and both mean three.
  if (condition.equals !== undefined) return flip(String(value).toLowerCase() === String(condition.equals).toLowerCase())
  if (condition.contains !== undefined) {
    const needle = String(condition.contains).toLowerCase()
    if (Array.isArray(value)) return flip(value.some((v) => String(v).toLowerCase().includes(needle)))
    return flip(String(value ?? '').toLowerCase().includes(needle))
  }
  if (condition.atLeast !== undefined) {
    const n = size(value)
    return n === null ? 'unknown' : flip(n >= condition.atLeast)
  }
  if (condition.atMost !== undefined) {
    const n = size(value)
    return n === null ? 'unknown' : flip(n <= condition.atMost)
  }
  // A condition naming something with no comparison asks whether it is there at all.
  return flip(value !== undefined && value !== null)
}

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
export function settle(
  step: OrbStep,
  result: NonNullable<OrbStep['result']>,
  /**
   * Whether this capability changes the browser.
   *
   * It decides what an absent verification means, and the two meanings are opposite: for something that changes the
   * world it means nothing proved it happened, and for something that only looks there was never anything to prove.
   * Unknown defaults to true, which is the safe direction -- a capability nobody could identify is treated as though
   * it might have changed something.
   */
  mutates = true
): OrbStep {
  const tries = step.tries + 1
  if (result.ok && result.verification?.verified === true) {
    return { ...step, status: 'done', result, tries, failure: undefined }
  }
  /*
   * A read is done when it returned.
   *
   * The control layer attaches a verification to anything that changes the browser and deliberately omits one from
   * anything that only looks -- there is no "after" to check when nothing happened. This used to be read as "the
   * browser did not confirm it", so every step that read a page or listed the tabs failed, and any task with a
   * reading step in it failed with it. Asking a read to prove a change is asking it to prove something it never
   * claimed.
   *
   * The guarantee that matters is untouched: a step that changes anything still needs the browser to say so, and
   * `verified: false` is still a failure.
   */
  if (result.ok && result.verification === undefined && !mutates) {
    return { ...step, status: 'done', result, tries, failure: undefined }
  }
  const kind: FailureKind = result.ok ? 'unverified' : classifyFailure(result.error)
  const message = result.ok
    ? (result.verification?.detail ?? 'The browser did not confirm this happened.')
    : (result.error?.message ?? 'The browser could not do that.')
  const recovery = decideRecovery(kind, tries, result.error?.recoverable === true)
  return { ...step, status: 'failed', result, tries, failure: { kind, message, recovery } }
}

/**
 * A step is ready when everything it needs is done and its condition holds.
 *
 * A step whose condition cannot be answered yet is not ready and not skipped: it waits. A step whose condition is
 * false is not ready either, and `settleConditions` is what turns that into a skip -- readiness only reports, it does
 * not decide anybody's fate.
 */
export const ready = (step: OrbStep, steps: OrbStep[], variables: Record<string, unknown> = {}): boolean =>
  step.status === 'planned' &&
  step.needs.every((id) => {
    const need = steps.find((s) => s.id === id)?.status
    /*
     * A skipped step counts as settled, not as missing.
     *
     * "If it is a duplicate, close it, then tell me what is left" -- the telling has to happen whether or not the
     * closing did. Requiring `done` would leave everything after an untaken branch waiting for a step that is never
     * going to run, which reads as the task hanging.
     */
    return need === 'done' || need === 'skipped'
  }) &&
  judge(step.when, variables) === true

/**
 * Marks the steps whose conditions have turned out false, and everything that only existed for them.
 *
 * Called before anything is chosen to run. A false condition is a decision, so it is written into the plan as a skip
 * rather than left as an absence -- a person reading the run sees "skipped: it was not a duplicate", which is an
 * answer, instead of a step that silently never happened.
 *
 * The cascade is the other half of `if`. A step that needed a skipped step is a step whose reason for existing did not
 * occur; running it anyway would act on a result nobody produced. Repeated until nothing changes, because a chain can
 * be any length.
 */
export function settleConditions(steps: OrbStep[], variables: Record<string, unknown>): OrbStep[] {
  /** Which step promised to save each name, so a condition can be traced to the step that would answer it. */
  const saver = new Map(steps.filter((s) => s.saveAs).map((s) => [String(s.saveAs), s]))

  let out = steps.map((step) => step)
  for (let pass = 0; pass < steps.length + 2; pass++) {
    const gone = new Set(out.filter((s) => s.status === 'skipped' || s.status === 'failed').map((s) => s.id))

    const next = out.map((step) => {
      if (step.status !== 'planned') return step
      const answer = judge(step.when, variables)
      if (answer === false) return { ...step, status: 'skipped' as const, failure: undefined }

      /*
       * A condition nobody is left to answer is false, not unanswered.
       *
       * This is the case that would otherwise hang the task. "If it is a duplicate, close it" is asked of a result
       * that an earlier step was going to save -- and when that earlier step was itself skipped, or failed, the
       * answer is never coming. Left as unanswered the step waits for ever and the run reads as frozen; read as
       * false, the branch simply did not happen, which is the truth.
       */
      if (answer === 'unknown' && step.when) {
        const root = String(step.when.of).split('.').filter(Boolean)[0]
        const who = root ? saver.get(root) : undefined
        if (!who || gone.has(who.id)) return { ...step, status: 'skipped' as const }
      }

      /*
       * And a step that reads a skipped step's result is skipped with it.
       *
       * Not every dependent: one that merely comes after an untaken branch should still run, which is why `ready`
       * counts a skip as settled. Only the ones whose parameters actually mention the name that was never saved --
       * those would act on nothing.
       */
      const reads = new Set<string>()
      const walk = (value: unknown, depth = 0): void => {
        if (depth > 5 || value === null || value === undefined) return
        if (typeof value === 'string') {
          for (const m of value.matchAll(REFERENCE)) reads.add(m[1].split('.')[0])
          return
        }
        if (Array.isArray(value)) return void value.forEach((v) => walk(v, depth + 1))
        if (typeof value === 'object') return void Object.values(value as Record<string, unknown>).forEach((v) => walk(v, depth + 1))
      }
      walk(step.params)
      for (const name of reads) {
        const who = saver.get(name)
        if (who && gone.has(who.id)) return { ...step, status: 'skipped' as const }
      }
      return step
    })

    if (next.every((s, i) => s.status === out[i].status)) return next
    out = next
  }
  return out
}

/**
 * The steps that may run now, together.
 *
 * Steps that change nothing can run alongside each other; anything that changes the browser runs on its own. Two
 * commands mutating the same browser at once is how a plan ends up acting on a page that the other one just navigated
 * away from, and the whole point of this file is not doing that.
 */
export function runnable(steps: OrbStep[], capabilities: CapabilityDescriptor[], variables: Record<string, unknown> = {}): OrbStep[] {
  const able = steps.filter((s) => ready(s, steps, variables))
  if (!able.length) return []
  const mutates = (step: OrbStep): boolean => capabilities.find((c) => c.id === step.capability)?.mutates !== false
  const first = able[0]
  if (mutates(first)) return [first]
  return able.filter((s) => !mutates(s))
}

/**
 * The most times a group may be asked to repeat.
 *
 * Not a judgement about what somebody might want -- it is the line past which a mistake in a plan stops being a long
 * task and becomes a browser doing something thousands of times unattended.
 */
export const MAX_REPEATS = 50

/**
 * Sends a finished group round again, when it has passes left.
 *
 * Returns the steps unchanged when nothing is owed, so the caller can treat "no loop" and "loop finished" the same.
 * A group only goes round when every one of its steps is done: a failed step is a failed task, and repeating over a
 * failure would turn one problem into fifty.
 */
export function nextPass(steps: OrbStep[]): { steps: OrbStep[]; group: string; pass: number } | null {
  const groups = [...new Set(steps.map((s) => s.group).filter((g): g is string => Boolean(g)))]
  for (const group of groups) {
    const members = steps.filter((s) => s.group === group)
    if (!members.length || !members.every((s) => s.status === 'done')) continue

    const total = Math.min(members[0].repeat ?? 1, MAX_REPEATS)
    const done = members[0].pass ?? 1
    if (done >= total) continue

    const pass = done + 1
    return {
      group,
      pass,
      /*
       * The steps are reset, not rebuilt.
       *
       * What they did last time round is deliberately dropped -- a result from the previous Short is not evidence
       * about this one, and leaving it there is how a loop comes to look like it verified something it has not done
       * yet.
       */
      steps: steps.map((s) =>
        s.group === group
          ? { ...s, status: 'planned' as const, pass, tries: 0, result: undefined, failure: undefined }
          : s
      )
    }
  }
  return null
}

/** True when nothing can run and nothing is running: the plan cannot get any further by itself. */
export const stuck = (steps: OrbStep[], variables: Record<string, unknown> = {}): boolean =>
  steps.some((s) => s.status === 'planned') &&
  !steps.some((s) => s.status === 'running') &&
  /*
   * An unanswered condition counts as unready, not as an exception.
   *
   * A step waiting on a question is only waiting while something is still running to answer it -- and the two clauses
   * above already say nothing is. `settleConditions` turns the unanswerable ones into skips before it gets here, so
   * what is left at this point genuinely cannot proceed.
   */
  steps.every((s) => s.status !== 'planned' || !ready(s, steps, variables))

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
