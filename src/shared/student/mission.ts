import { overall, type Mastery } from './mastery.ts'
import type { Concept } from './graph.ts'
import type { WorkKind } from './planner.ts'

/**
 * Turning "study Physics" into something somebody can actually start.
 *
 * "Study Physics" is not a task. It has no beginning, no end and no way to be wrong, which is why it gets put off.
 * A mission is the same work written as three or four steps, each small enough to start without deciding anything:
 *
 *     Recall the three equations of motion.
 *     Solve five basic problems.
 *     Explain one graph to Orion.
 *
 * ## Why the shape follows the mastery
 *
 * The steps are not a fixed template. What somebody needs depends on which part is missing: a concept they cannot
 * reproduce needs recall, one they cannot use needs application, one they half-understand needs explaining. Giving
 * everybody the same four steps means three of them are the wrong work.
 *
 * ## Micro-missions
 *
 * The smallest useful unit -- one or two minutes, one action. They exist for the moment somebody has no time or no
 * willingness, where the realistic choice is between a tiny thing and nothing at all.
 *
 * Pure.
 */

export interface Step {
  id: string
  kind: WorkKind
  /** What to do, as an instruction. Never a category name. */
  label: string
  minutes: number
  /** What finishing this step is evidence of. */
  proves: 'recall' | 'application' | 'understanding' | 'accuracy' | 'exposure' | null
  done: boolean
}

export interface Mission {
  id: string
  title: string
  subject: string | null
  conceptId: string | null
  chapterId: string | null
  steps: readonly Step[]
  minutes: number
  /** Why this shape, in one sentence. */
  because: string
  createdAt: number
  state: 'ready' | 'running' | 'done' | 'abandoned'
}

const step = (id: string, kind: WorkKind, label: string, minutes: number, proves: Step['proves']): Step => ({ id, kind, label, minutes, proves, done: false })

/**
 * A mission for one concept, shaped by what is actually missing.
 *
 * `minutes` is a budget, not a suggestion: the steps are chosen and then trimmed to fit it, because a mission that
 * overruns is a mission that gets abandoned halfway and recorded as a failure.
 */
export function missionFor(concept: Concept, mastery: Mastery | null, minutes: number, now: number, subject: string | null): Mission {
  const budget = Math.max(5, Math.min(120, Math.round(minutes)))
  const id = `mission-${concept.id}-${now.toString(36).slice(-5)}`
  const score = mastery ? overall(mastery) : 0
  const steps: Step[] = []
  let because = ''

  if (!mastery || mastery.scores.exposure < 0.3) {
    // Never met it. Meeting it is the work.
    because = 'This is new, so the first job is simply meeting it.'
    steps.push(step(`${id}-1`, 'read', `Read through ${concept.name} once`, Math.round(budget * 0.4), 'exposure'))
    steps.push(step(`${id}-2`, 'recall', `Write down what you remember of ${concept.name}, without looking`, Math.round(budget * 0.3), 'recall'))
    steps.push(step(`${id}-3`, 'practice', 'Try two of the easiest problems on it', Math.round(budget * 0.3), 'application'))
  } else if (mastery.scores.understanding < 0.45) {
    because = 'You have met this, but the idea itself has not settled.'
    steps.push(step(`${id}-1`, 'read', `Go back over the part of ${concept.name} that does not sit right`, Math.round(budget * 0.3), 'exposure'))
    steps.push(step(`${id}-2`, 'recall', 'Explain it in your own words, out loud or written down', Math.round(budget * 0.35), 'understanding'))
    steps.push(step(`${id}-3`, 'practice', 'One worked example, following it line by line', Math.round(budget * 0.35), 'understanding'))
  } else if (mastery.scores.recall < 0.5) {
    because = 'You can follow this, but not produce it from memory yet.'
    steps.push(step(`${id}-1`, 'recall', `Write out everything you know about ${concept.name} from memory`, Math.round(budget * 0.4), 'recall'))
    steps.push(step(`${id}-2`, 'read', 'Check what you missed', Math.round(budget * 0.2), 'exposure'))
    steps.push(step(`${id}-3`, 'recall', 'Write it again, filling the gaps', Math.round(budget * 0.4), 'recall'))
  } else if (mastery.scores.application < 0.5) {
    because = 'You know this one — using it on a new problem is the part that is missing.'
    steps.push(step(`${id}-1`, 'recall', 'One minute: what are the key results here?', Math.max(2, Math.round(budget * 0.15)), 'recall'))
    steps.push(step(`${id}-2`, 'practice', 'Three problems you have not seen before', Math.round(budget * 0.55), 'application'))
    steps.push(step(`${id}-3`, 'mistakes', 'Go back over anything you got wrong', Math.round(budget * 0.3), 'accuracy'))
  } else if (score >= 0.7) {
    because = 'This is strong. The useful work now is proving it and keeping it.'
    steps.push(step(`${id}-1`, 'recall', 'From memory, with nothing in front of you', Math.round(budget * 0.3), 'recall'))
    steps.push(step(`${id}-2`, 'practice', 'One harder problem than you usually do', Math.round(budget * 0.45), 'application'))
    steps.push(step(`${id}-3`, 'recall', 'Explain it as if teaching somebody who has not met it', Math.round(budget * 0.25), 'understanding'))
  } else {
    because = 'A round of everything, since no single part is the problem.'
    steps.push(step(`${id}-1`, 'recall', 'Recall what you can', Math.round(budget * 0.25), 'recall'))
    steps.push(step(`${id}-2`, 'practice', 'Four problems', Math.round(budget * 0.5), 'application'))
    steps.push(step(`${id}-3`, 'mistakes', 'Look at what went wrong', Math.round(budget * 0.25), 'accuracy'))
  }

  // Trimmed to the budget, so the sum is the number on the button.
  const trimmed = fit(steps, budget)
  return {
    id,
    title: concept.name,
    subject,
    conceptId: concept.id,
    chapterId: concept.chapterId,
    steps: trimmed,
    minutes: trimmed.reduce((sum, one) => sum + one.minutes, 0),
    because,
    createdAt: now,
    state: 'ready'
  }
}

/** Steps scaled to fit a budget exactly, each at least a minute. */
function fit(steps: readonly Step[], budget: number): Step[] {
  const total = steps.reduce((sum, one) => sum + one.minutes, 0)
  if (total === 0) return [...steps]
  const scale = budget / total
  const out = steps.map((one) => ({ ...one, minutes: Math.max(1, Math.round(one.minutes * scale)) }))
  // Rounding leaves a remainder; it goes on the longest step rather than being lost.
  let drift = budget - out.reduce((sum, one) => sum + one.minutes, 0)
  while (drift !== 0) {
    const index = out.reduce((best, one, i) => (one.minutes > out[best].minutes ? i : best), 0)
    const next = out[index].minutes + (drift > 0 ? 1 : -1)
    if (next < 1) break
    out[index] = { ...out[index], minutes: next }
    drift += drift > 0 ? -1 : 1
  }
  return out
}

/**
 * The smallest thing that is still worth doing.
 *
 * One action, one or two minutes. These exist for the moment when the honest choice is between something tiny and
 * nothing, and are never presented as a substitute for a session.
 */
export const MICRO: readonly { id: string; label: string; minutes: number; kind: WorkKind; proves: Step['proves'] }[] = [
  { id: 'formulas', label: 'Recall three formulas', minutes: 2, kind: 'recall', proves: 'recall' },
  { id: 'two-questions', label: 'Solve two questions', minutes: 5, kind: 'practice', proves: 'application' },
  { id: 'one-section', label: 'Read one section', minutes: 4, kind: 'read', proves: 'exposure' },
  { id: 'explain-one', label: 'Explain one idea out loud', minutes: 3, kind: 'recall', proves: 'understanding' },
  { id: 'one-mistake', label: 'Fix one mistake', minutes: 4, kind: 'mistakes', proves: 'accuracy' },
  { id: 'one-card', label: 'Go through five cards', minutes: 3, kind: 'revise', proves: 'recall' }
]

/** A micro-mission for a concept, chosen for what is weakest about it. */
export function microFor(concept: Concept | null, mastery: Mastery | null, now: number): Mission {
  const pick =
    !mastery || mastery.scores.exposure < 0.3
      ? MICRO.find((one) => one.id === 'one-section')
      : mastery.scores.recall < 0.5
        ? MICRO.find((one) => one.id === 'formulas')
        : mastery.scores.application < 0.5
          ? MICRO.find((one) => one.id === 'two-questions')
          : MICRO.find((one) => one.id === 'explain-one')
  const one = pick ?? MICRO[0]
  return {
    id: `micro-${now.toString(36).slice(-5)}`,
    title: concept ? `${one.label} — ${concept.name}` : one.label,
    subject: null,
    conceptId: concept?.id ?? null,
    chapterId: concept?.chapterId ?? null,
    steps: [{ id: 'm1', kind: one.kind, label: one.label, minutes: one.minutes, proves: one.proves, done: false }],
    minutes: one.minutes,
    because: 'Small enough to start right now.',
    createdAt: now,
    state: 'ready'
  }
}

/** A step finished. */
export function finishStep(mission: Mission, stepId: string): Mission {
  const steps = mission.steps.map((one) => (one.id === stepId ? { ...one, done: true } : one))
  return { ...mission, steps, state: steps.every((one) => one.done) ? 'done' : 'running' }
}

/** How far through a mission is, and what is next. */
export function progressOf(mission: Mission): { done: number; total: number; next: Step | null; minutesLeft: number } {
  const done = mission.steps.filter((one) => one.done).length
  const next = mission.steps.find((one) => !one.done) ?? null
  return {
    done,
    total: mission.steps.length,
    next,
    minutesLeft: mission.steps.filter((one) => !one.done).reduce((sum, one) => sum + one.minutes, 0)
  }
}

/**
 * The same work, smaller.
 *
 * For the student who keeps abandoning a mission at the same point: halve it rather than ask them to try harder.
 * Returns null when it is already as small as it usefully gets.
 */
export function smaller(mission: Mission): Mission | null {
  if (mission.minutes <= 6 || mission.steps.length <= 1) return null
  const keep = mission.steps.filter((one) => !one.done).slice(0, Math.max(1, Math.ceil(mission.steps.length / 2)))
  if (keep.length === 0) return null
  const steps = fit(keep, Math.max(5, Math.round(mission.minutes / 2)))
  return {
    ...mission,
    id: `${mission.id}-small`,
    steps,
    minutes: steps.reduce((sum, one) => sum + one.minutes, 0),
    because: 'Half the size. Finishing something small beats abandoning something big.',
    state: 'ready'
  }
}

/** What finishing a step says about what somebody knows, for the mastery engine. */
export function evidenceFrom(step: Step, succeeded: boolean): 'read' | 'recalled' | 'recall-failed' | 'applied' | 'application-failed' | 'explained' | 'mistake-fixed' | null {
  if (!step.proves) return null
  switch (step.proves) {
    case 'exposure':
      return 'read'
    case 'recall':
      return succeeded ? 'recalled' : 'recall-failed'
    case 'application':
      return succeeded ? 'applied' : 'application-failed'
    case 'understanding':
      return 'explained'
    case 'accuracy':
      return succeeded ? 'mistake-fixed' : null
    default:
      return null
  }
}
