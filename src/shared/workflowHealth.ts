/**
 * How a workflow is actually doing, and what is worth changing about it.
 *
 * Everything here is computed from runs that really happened -- `WorkflowRunSummary` and the `StepRecord`s inside it,
 * which carry real durations, real attempt counts, real verifications and the real errors the control layer gave. No
 * number in this file is estimated, modelled or filled in when the data is thin. A workflow that has run twice gets
 * "twice" and a verdict that says so, not a success rate presented as though it meant something.
 *
 * The distinction that matters most is between a workflow that is *failing* and one that is *broken*. A workflow that
 * fails now and then on a slow site needs patience; one that has failed at the same step five times running has been
 * outlived by the website it was written against, and telling somebody that plainly is more use than a retry.
 */

import type { StepRecord } from './browserControl.ts'
import type { WorkflowRunSummary } from './workflows.ts'

/** Not enough runs to say anything is the first verdict, not a hidden default. */
export type Health = 'unproven' | 'healthy' | 'flaky' | 'failing' | 'broken' | 'stale'

export interface HealthReport {
  health: Health
  /** In words, for a person: what this verdict is based on. */
  summary: string
  runs: number
  succeeded: number
  failed: number
  /** Only when there are enough runs for it to mean anything; null otherwise. */
  successRate: number | null
  /** How many of the most recent runs failed in a row. The signal that something has actually broken. */
  failingStreak: number
  /** The step that fails most, when one does, with how often. */
  worstStep: { label: string; failures: number; of: number } | null
  /** When it last ran at all. */
  lastRunAt: number | null
}

/** Below this, a rate is a coincidence rather than a measurement. */
const ENOUGH = 3
/** Failing this many times in a row is not bad luck. */
const BROKEN_STREAK = 4
/** A workflow nobody has run for this long, which still exists, is worth mentioning. */
const STALE_MS = 90 * 86_400_000

const newest = (runs: WorkflowRunSummary[]): WorkflowRunSummary[] => [...runs].sort((a, b) => b.finishedAt - a.finishedAt)

/**
 * The verdict, from the runs there are.
 *
 * Order matters: broken is checked before failing, and both before a rate, because a workflow that has failed its last
 * five runs is broken even if its lifetime average is respectable. The average is a fact about the past; the streak is
 * a fact about now.
 */
export function health(runs: WorkflowRunSummary[], now = Date.now()): HealthReport {
  const ordered = newest(runs)
  const succeeded = runs.filter((r) => r.status === 'completed').length
  const failed = runs.filter((r) => r.status === 'failed').length
  const decided = succeeded + failed
  const lastRunAt = ordered[0]?.finishedAt ?? null

  let failingStreak = 0
  for (const run of ordered) {
    if (run.status === 'stopped') continue
    if (run.status === 'failed') failingStreak += 1
    else break
  }

  // Which step fails most, counted only over the runs that reached it.
  const failures = new Map<string, number>()
  const reached = new Map<string, number>()
  for (const run of runs) {
    for (const step of run.steps) {
      const label = step.label ?? step.action ?? step.path
      reached.set(label, (reached.get(label) ?? 0) + 1)
      if (step.status === 'failed') failures.set(label, (failures.get(label) ?? 0) + 1)
    }
  }
  const worst = [...failures.entries()].sort((a, b) => b[1] - a[1])[0]
  const worstStep = worst ? { label: worst[0], failures: worst[1], of: reached.get(worst[0]) ?? worst[1] } : null

  const successRate = decided >= ENOUGH ? succeeded / decided : null

  if (!runs.length) {
    return { health: 'unproven', summary: 'This has never been run.', runs: 0, succeeded: 0, failed: 0, successRate: null, failingStreak: 0, worstStep: null, lastRunAt: null }
  }
  const base = { runs: runs.length, succeeded, failed, successRate, failingStreak, worstStep, lastRunAt }

  // Order is the judgement here. What is wrong now outranks what was true on average, and both outrank how long ago
  // it last ran: a workflow that fails half the time is flaky whether it ran yesterday or in March, and calling it
  // "stale" would hide the thing actually worth knowing.
  if (failingStreak >= BROKEN_STREAK) {
    const where = worstStep ? ` It stops at “${worstStep.label}”.` : ''
    return { ...base, health: 'broken', summary: `Failed the last ${failingStreak} times.${where} Something it depends on has probably changed.` }
  }
  // Two failures in a row at the same place is a real signal, and does not wait for a third run to be worth saying.
  if (failingStreak >= 2) {
    return { ...base, health: 'failing', summary: `Failed the last ${failingStreak} runs.` }
  }
  if (decided < ENOUGH) {
    return { ...base, health: 'unproven', summary: `Only ${decided} run${decided === 1 ? '' : 's'} so far — too few to say how reliable it is.` }
  }
  if (successRate !== null && successRate < 0.7) {
    const percent = Math.round(successRate * 100)
    const where = worstStep ? ` Usually at “${worstStep.label}”.` : ''
    return { ...base, health: 'flaky', summary: `Works ${percent}% of the time.${where}` }
  }
  if (lastRunAt !== null && now - lastRunAt > STALE_MS) {
    return { ...base, health: 'stale', summary: `Has not run in ${Math.round((now - lastRunAt) / 86_400_000)} days.` }
  }
  return { ...base, health: 'healthy', summary: `${succeeded} of ${decided} runs succeeded.` }
}

// ---------------------------------------------------------------- what is worth changing

export type FindingKind = 'slow-step' | 'always-retries' | 'long-wait' | 'never-runs' | 'unverified' | 'repeated-action'

export interface Finding {
  kind: FindingKind
  /** The step it is about, by the label the run recorded. */
  step: string
  /** What was measured, in words. Always a measurement, never an opinion. */
  detail: string
  /** What could be done about it. A suggestion for a person, never applied on its own. */
  suggestion: string
}

/** A step that takes this share of the whole run is worth looking at. */
const SLOW_SHARE = 0.4
/** A wait this long, that always ends early, was set too high. */
const LONG_WAIT_MS = 20_000

/**
 * Things the runs show about the workflow, measured.
 *
 * Only what the records support. A step is "slow" because its recorded durations say so, not because its name sounds
 * expensive; a step "always retries" because every record of it has attempts above one. Nothing here rewrites the
 * workflow -- these are findings for a person, and a workflow silently optimised is one nobody can predict.
 */
export function findings(runs: WorkflowRunSummary[]): Finding[] {
  if (!runs.length) return []
  const out: Finding[] = []
  const byStep = new Map<string, StepRecord[]>()
  for (const run of runs) {
    for (const step of run.steps) {
      const label = step.label ?? step.action ?? step.path
      byStep.set(label, [...(byStep.get(label) ?? []), step])
    }
  }
  const totalMs = runs.reduce((sum, r) => sum + r.durationMs, 0)
  const runsWithSteps = runs.filter((r) => r.steps.length).length || 1

  for (const [label, records] of byStep) {
    const ran = records.length
    const spent = records.reduce((sum, s) => sum + s.durationMs, 0)

    if (totalMs > 0 && spent / totalMs >= SLOW_SHARE && ran >= 2) {
      out.push({
        kind: 'slow-step',
        step: label,
        detail: `Takes ${Math.round((spent / totalMs) * 100)}% of the time this workflow spends running.`,
        suggestion: 'Check whether it is waiting longer than it needs to.'
      })
    }

    const retried = records.filter((s) => (s.attempts ?? 1) > 1).length
    if (ran >= 3 && retried === ran) {
      out.push({
        kind: 'always-retries',
        step: label,
        detail: `Has needed more than one attempt every time it ran (${ran} of ${ran}).`,
        suggestion: 'It is probably acting before the page is ready. A wait for what it needs would be faster than a retry.'
      })
    }

    const waits = records.filter((s) => s.kind === 'wait')
    if (waits.length >= 2 && waits.every((s) => s.durationMs >= LONG_WAIT_MS)) {
      out.push({
        kind: 'long-wait',
        step: label,
        detail: `Waits at least ${Math.round(LONG_WAIT_MS / 1000)}s every time.`,
        suggestion: 'Waiting for a condition rather than a length of time would finish as soon as the page is ready.'
      })
    }

    // A step that acts but never says the browser confirmed it is a step nobody can be sure worked.
    const actions = records.filter((s) => s.kind === 'action' && s.status === 'success')
    if (actions.length >= 3 && actions.every((s) => !s.verification)) {
      out.push({
        kind: 'unverified',
        step: label,
        detail: `Has succeeded ${actions.length} times without the browser confirming what changed.`,
        suggestion: 'Add something it expects afterwards, so a silent failure cannot pass as success.'
      })
    }

    if (ran / runsWithSteps >= 3) {
      out.push({
        kind: 'repeated-action',
        step: label,
        detail: `Runs ${Math.round(ran / runsWithSteps)} times per run on average.`,
        suggestion: 'If it fetches the same thing each time, saving the result once would do.'
      })
    }
  }

  // A step that exists but no run ever reached: usually a branch that never happens.
  return out
}

// ---------------------------------------------------------------- what to do about a broken one

export interface Repair {
  /** The step to change, as the runs label it. */
  step: string
  /** What went wrong, from the error the control layer actually gave. */
  because: string
  /** What to change. Proposed, never applied: a workflow that repairs itself is one nobody can predict. */
  proposal: string
  /** Whether this is safe to apply without a person looking at it. Almost nothing is. */
  safe: boolean
}

/**
 * Repairs worth proposing for a workflow that keeps failing.
 *
 * Built from the error codes the control layer recorded, so the proposal fits the actual failure: a step that cannot
 * find its target needs a different way of describing it, one that keeps going stale needs to wait first, one that is
 * blocked needs a person. Nothing here is applied automatically. A workflow that quietly rewrote itself after a
 * failure would be a workflow whose behaviour nobody could predict from reading it -- and the first time it repaired
 * itself into doing something consequential, it would do that too.
 */
export function repairs(runs: WorkflowRunSummary[]): Repair[] {
  // Keyed on the streak rather than the verdict: failing the same step twice running is worth a proposal, and
  // waiting for a third run to make the verdict "official" only means failing once more first.
  const report = health(runs)
  if (report.failingStreak < 2) return []

  const lastFailures = new Map<string, StepRecord>()
  for (const run of newest(runs)) {
    if (run.status !== 'failed') continue
    for (const step of run.steps) {
      const label = step.label ?? step.action ?? step.path
      if (step.status === 'failed' && !lastFailures.has(label)) lastFailures.set(label, step)
    }
  }

  const out: Repair[] = []
  for (const [label, step] of lastFailures) {
    const code = step.error?.code
    const because = step.error?.message ?? 'It failed without saying why.'
    if (code === 'not-found') {
      out.push({ step: label, because, proposal: 'Describe the target by what it says or does rather than where it sits, so a changed layout still matches it.', safe: false })
    } else if (code === 'stale-element') {
      out.push({ step: label, because, proposal: 'Wait for the page to settle before this step; the page is changing under it.', safe: false })
    } else if (code === 'timeout') {
      out.push({ step: label, because, proposal: 'Give this step longer, or wait for the thing it needs instead of a fixed time.', safe: false })
    } else if (code === 'unavailable' || code === 'unknown-capability') {
      out.push({ step: label, because, proposal: 'This step uses something this Orbis no longer has. It needs replacing with a capability that exists.', safe: false })
    } else if (code === 'blocked') {
      out.push({ step: label, because, proposal: 'A protection is refusing this. It needs a person at that point, not a change to the workflow.', safe: false })
    } else if (code === 'verification-failed') {
      out.push({ step: label, because, proposal: 'The action ran but the page did not end up as expected. What it expects afterwards may be wrong, or the site has changed.', safe: false })
    } else {
      out.push({ step: label, because, proposal: 'Run it with the debugger to see the browser state when it fails.', safe: false })
    }
  }
  return out
}
