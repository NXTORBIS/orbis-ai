/**
 * Working up through a subject: chapter tests, then the whole thing.
 *
 * ## Why there are stages at all
 *
 * A single chapter test is a good measure and a poor goal — there is nowhere to go after it. Stages give a subject
 * a shape: pass the chapters, then sit a mixed paper across the lot, with the later stages drawing their questions
 * from everything that came before. That is also, as it happens, exactly how spacing and interleaving work, which
 * is why this is worth having rather than being decoration.
 *
 * ## What a stage will not do
 *
 * **Nothing is locked behind a stage.** A stage that is not unlocked is a suggestion that is not yet sensible, not
 * a door. Every chapter test can be taken at any time, in any order, and skipping ahead is allowed — the ordering
 * is advice about what will go well, and advice can be wrong about a person.
 *
 * **No invented questions, ever.** A stage is still built from the student's own cards and mistake book. A stage
 * with nothing of their own behind it says so, in the same words the single chapter test uses.
 *
 * **No losing.** A stage that is not passed is not failed: it is not passed *yet*, the attempt is recorded, and the
 * wrong answers go where wrong answers go. Nothing is taken away and nothing resets.
 */

import { dayKey } from './days.ts'
import { overall, type Mastery } from './mastery.ts'
import type { Graph } from './graph.ts'

export type StageKind = 'chapter' | 'mixed' | 'final'

export interface Stage {
  id: string
  kind: StageKind
  /** The chapter this stage is about, or every chapter for the later ones. */
  chapterIds: readonly string[]
  subject: string
  name: string
  /** One line about what it is for. */
  about: string
  /** Suggested, never enforced. */
  unlocked: boolean
  /** Why it is not suggested yet, when it is not. */
  locked: string | null
  passed: boolean
  attempts: number
  bestScore: number | null
  lastAttemptAt: number | null
}

export interface Attempt {
  stageId: string
  score: number
  outOf: number
  passed: boolean
  at: number
}

/** The record of what has been attempted. Kept per profile, alongside everything else. */
export interface Progression {
  attempts: readonly Attempt[]
}

export const emptyProgression = (): Progression => ({ attempts: [] })

export function record(held: Progression, attempt: Attempt): Progression {
  // Newest first, and bounded: a year of daily attempts is still only a few hundred rows.
  return { attempts: [attempt, ...held.attempts].slice(0, 500) }
}

const stageId = (subject: string, kind: StageKind, chapterId?: string): string =>
  kind === 'chapter' ? `stage:${chapterId}` : `stage:${kind}:${subject.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-')}`

/**
 * The stages of a subject.
 *
 * One per chapter in the subject's own order, then a mixed paper across everything once most chapters are passed,
 * then a final across the lot. The later stages are suggested rather than opened, and the reason is carried with
 * them so the screen can say it.
 */
export function stagesFor(graph: Graph, subject: string, mastery: ReadonlyMap<string, Mastery>, held: Progression): Stage[] {
  const chapters = graph.chapters.filter((one) => one.subject === subject).sort((a, b) => a.order - b.order)
  if (chapters.length === 0) return []

  const out: Stage[] = []
  const stateOf = (id: string): { passed: boolean; attempts: number; best: number | null; last: number | null } => {
    const mine = held.attempts.filter((one) => one.stageId === id)
    return {
      passed: mine.some((one) => one.passed),
      attempts: mine.length,
      best: mine.length === 0 ? null : Math.max(...mine.map((one) => one.score / Math.max(1, one.outOf))),
      last: mine.length === 0 ? null : Math.max(...mine.map((one) => one.at))
    }
  }

  chapters.forEach((chapter, index) => {
    const id = stageId(subject, 'chapter', chapter.id)
    const state = stateOf(id)
    const before = index === 0 ? null : stageId(subject, 'chapter', chapters[index - 1].id)
    const beforePassed = before ? stateOf(before).passed : true
    const touched = readiness(graph, mastery, [chapter.id])
    out.push({
      id,
      kind: 'chapter',
      chapterIds: [chapter.id],
      subject,
      name: chapter.name,
      about: 'Your own questions from this chapter.',
      /*
       * Suggested when the chapter before it is passed, or when there is anything measured in this one.
       *
       * Somebody who has only studied chapter four should be offered chapter four. The ordering is a default for a
       * student with no history, not a rule about what they may do.
       */
      unlocked: beforePassed || touched > 0 || state.attempts > 0,
      locked: beforePassed || touched > 0 || state.attempts > 0 ? null : `Usually comes after ${chapters[index - 1].name}, but you can take it now.`,
      passed: state.passed,
      attempts: state.attempts,
      bestScore: state.best,
      lastAttemptAt: state.last
    })
  })

  const chapterIds = chapters.map((one) => one.id)
  const passedChapters = out.filter((one) => one.passed).length
  // Half the chapters, and at least one -- a two-chapter subject should not need both before a mixed paper is sensible.
  const enoughForMixed = passedChapters >= Math.max(1, Math.ceil(chapters.length / 2))

  const mixedId = stageId(subject, 'mixed')
  const mixedState = stateOf(mixedId)
  out.push({
    id: mixedId,
    kind: 'mixed',
    chapterIds,
    subject,
    name: `${subject}: a bit of everything`,
    about: 'Questions pulled from every chapter at once, in no particular order.',
    unlocked: enoughForMixed || mixedState.attempts > 0,
    locked: enoughForMixed || mixedState.attempts > 0 ? null : `Suggested once about half the chapters are passed — ${passedChapters} of ${chapters.length} so far.`,
    passed: mixedState.passed,
    attempts: mixedState.attempts,
    bestScore: mixedState.best,
    lastAttemptAt: mixedState.last
  })

  const finalId = stageId(subject, 'final')
  const finalState = stateOf(finalId)
  const everyChapter = passedChapters === chapters.length
  out.push({
    id: finalId,
    kind: 'final',
    chapterIds,
    subject,
    name: `${subject}: the whole thing`,
    about: 'The longest one, weighted toward whatever has been going wrong.',
    unlocked: (everyChapter && mixedState.passed) || finalState.attempts > 0,
    locked:
      (everyChapter && mixedState.passed) || finalState.attempts > 0
        ? null
        : everyChapter
          ? 'Suggested after the mixed one.'
          : `Suggested once every chapter is passed — ${passedChapters} of ${chapters.length} so far.`,
    passed: finalState.passed,
    attempts: finalState.attempts,
    bestScore: finalState.best,
    lastAttemptAt: finalState.last
  })

  return out
}

function readiness(graph: Graph, mastery: ReadonlyMap<string, Mastery>, chapterIds: readonly string[]): number {
  const inside = graph.concepts.filter((one) => chapterIds.includes(one.chapterId))
  if (inside.length === 0) return 0
  // A blank record is not evidence: Orbis keeps one per topic, so "is it in the map" is always true.
  const scored = (id: string): number => {
    const held = mastery.get(id)
    const real = held && (held.attempts > 0 || Object.values(held.evidence).some((count) => count > 0))
    return real ? overall(held as Mastery) : 0
  }
  return inside.reduce((sum, one) => sum + scored(one.id), 0) / inside.length
}

/** How far through a subject somebody is, counted from stages passed. Never a grade. */
export function through(stages: readonly Stage[]): { passed: number; total: number; says: string } {
  const total = stages.length
  const passed = stages.filter((one) => one.passed).length
  return {
    passed,
    total,
    says:
      passed === 0
        ? 'Nothing passed yet.'
        : passed === total
          ? 'Every stage passed.'
          : `${passed} of ${total} passed.`
  }
}

/** What to suggest next in a subject: the first unlocked stage that has not been passed. */
export function nextStage(stages: readonly Stage[]): Stage | null {
  return stages.find((one) => one.unlocked && !one.passed) ?? null
}

/** A day's attempts, for showing that today's go is recorded. */
export function attemptsOn(held: Progression, day: string): Attempt[] {
  return held.attempts.filter((one) => dayKey(one.at) === day)
}
