/**
 * Whether somebody actually knows something.
 *
 * ## Reading is not knowing
 *
 * The one rule this file exists for: opening a lesson proves nothing. A concept only moves up because the learner
 * *did* something — answered without help, recalled it after a gap, used it on a harder question, passed it in an
 * assessment. Marking a lesson read and calling it mastered is how a progress bar ends up at a hundred per cent
 * for somebody who cannot do any of it, and every number downstream inherits that lie.
 *
 * ## It can go down
 *
 * Mastery decays with time and falls on a wrong answer. A concept got right in March and never touched since is
 * not known in September, and a model that only ever goes up cannot say that.
 *
 * ## A hint is not a wrong answer, but it is not a right one either
 *
 * Getting there with two hints counts for less than getting there alone. Without that, the hint button quietly
 * becomes the answer button and the whole measurement stops meaning anything.
 */

import type { Difficulty, MasteryRecord, MasteryState, QuestionAttempt } from './types.ts'

export const STATES: readonly MasteryState[] = ['introduced', 'practised', 'recalled', 'applied', 'assessed', 'mastered']

/** What each state needs before it can be reached. In order, and each one needs the one before it. */
export const NEEDS: Readonly<Record<MasteryState, { says: string; score: number }>> = {
  introduced: { says: 'You have met this.', score: 0.05 },
  practised: { says: 'You have used it with the material in front of you.', score: 0.3 },
  recalled: { says: 'You brought it back without looking.', score: 0.5 },
  applied: { says: 'You used it on something new.', score: 0.68 },
  assessed: { says: 'You got it right under test conditions.', score: 0.82 },
  mastered: { says: 'You have held on to it over time.', score: 0.92 }
}

export function newMastery(concept: string, at: number): MasteryRecord {
  return { concept, state: 'introduced', score: 0.05, seen: 0, right: 0, wrong: 0, hints: 0, lastAt: at, reviewAt: null, reviews: 0 }
}

/** What answering a question is worth, before anything else is taken into account. */
const WORTH: Readonly<Record<Difficulty, number>> = {
  beginner: 0.08,
  intermediate: 0.12,
  advanced: 0.17,
  expert: 0.22
}

/** Where an answer was given. A question under test conditions proves more than one with the page open. */
export type Where = 'lesson' | 'practice' | 'recall' | 'quiz' | 'assessment' | 'review'

const CREDIT: Readonly<Record<Where, number>> = {
  lesson: 0.5,
  practice: 0.75,
  recall: 1,
  quiz: 1.1,
  assessment: 1.3,
  review: 1.15
}

/**
 * How much a concept has faded.
 *
 * Slow: a fortnight costs about a fifth. Fast decay would send somebody back over work they still know perfectly
 * well, which is the quickest way to make a revision system feel like a punishment.
 */
export function faded(record: MasteryRecord, now: number): number {
  const days = Math.max(0, (now - record.lastAt) / 86_400_000)
  if (days < 1) return record.score
  // Each review makes it stick longer, so something gone over four times barely moves in a month.
  const grip = 14 + record.reviews * 10
  return Math.max(0, record.score * Math.pow(0.82, days / grip))
}

/** The state a score has earned. Never skips: a score can only be called what it has actually reached. */
export function stateFor(score: number): MasteryState {
  let out: MasteryState = 'introduced'
  for (const one of STATES) if (score >= NEEDS[one].score) out = one
  return out
}

export interface Answered {
  concept: string
  right: boolean
  difficulty: Difficulty
  where: Where
  hintsUsed: number
  /** Seconds taken. A long pause on an easy question is worth slightly less. */
  seconds?: number
}

/**
 * A concept after one answer.
 *
 * Deliberately asymmetric: a wrong answer costs more than a right one earns. Somebody who gets four right and one
 * wrong does not know it as well as four-fifths, and a model that averages is a model that calls a shaky concept
 * solid.
 */
export function afterAnswer(record: MasteryRecord, answer: Answered, now: number): MasteryRecord {
  const base = WORTH[answer.difficulty] * CREDIT[answer.where]
  const start = faded(record, now)
  let score = start

  if (answer.right) {
    /*
     * A hint takes most of the credit away.
     *
     * Not all of it — working it out from a nudge is real learning — but enough that leaning on hints stops the
     * number rising, which is the honest outcome.
     */
    const helped = answer.hintsUsed <= 0 ? 1 : answer.hintsUsed === 1 ? 0.55 : 0.25
    // Diminishing: the first right answer moves it a long way, the tenth barely at all.
    const room = 1 - score
    score = Math.min(1, score + base * helped * (0.35 + room * 0.65))
  } else {
    score = Math.max(0, score - base * 1.5)
  }

  return {
    ...record,
    score,
    state: stateFor(score),
    seen: record.seen + 1,
    right: record.right + (answer.right ? 1 : 0),
    wrong: record.wrong + (answer.right ? 0 : 1),
    hints: record.hints + Math.max(0, answer.hintsUsed),
    lastAt: now,
    reviews: answer.where === 'review' && answer.right ? record.reviews + 1 : record.reviews
  }
}

/** A concept after a lesson about it was read. Worth something, and deliberately very little. */
export function afterReading(record: MasteryRecord, now: number): MasteryRecord {
  const score = Math.max(faded(record, now), Math.min(NEEDS.practised.score - 0.02, faded(record, now) + 0.06))
  return { ...record, score, state: stateFor(score), lastAt: now }
}

/** Every concept of a course, averaged. What "how well do I know this course" means. */
export function overall(records: readonly MasteryRecord[], now: number): number {
  if (records.length === 0) return 0
  const total = records.reduce((sum, one) => sum + faded(one, now), 0)
  return total / records.length
}

/**
 * The concepts worth doing something about.
 *
 * Weak *and* seen: a concept nobody has met yet is not a weakness, it is simply next. Confusing the two sends
 * learners to practise things they have not been taught.
 */
export function weakest(records: readonly MasteryRecord[], now: number, most = 5): MasteryRecord[] {
  return records
    .filter((one) => one.seen > 0 && faded(one, now) < NEEDS.applied.score)
    .sort((a, b) => faded(a, now) - faded(b, now))
    .slice(0, most)
}

/** What a learner is told about a concept. Never a percentage, and never a judgement about them. */
export function describe(record: MasteryRecord, now: number): string {
  const score = faded(record, now)
  if (score >= NEEDS.mastered.score) return 'You know this.'
  if (score >= NEEDS.assessed.score) return 'Solid — one more check and it is yours.'
  if (score >= NEEDS.applied.score) return 'You can use this.'
  if (score >= NEEDS.recalled.score) return 'Coming back to you.'
  if (score >= NEEDS.practised.score) return 'You have used it with help.'
  if (record.seen === 0) return 'Not started.'
  return 'Needs reinforcement.'
}

/** Attempts turned into mastery, for rebuilding a record or importing history. */
export function fromAttempts(concept: string, attempts: readonly QuestionAttempt[], now: number, difficultyOf: (questionId: string) => Difficulty): MasteryRecord {
  let record = newMastery(concept, attempts[0]?.at ?? now)
  for (const one of [...attempts].sort((a, b) => a.at - b.at)) {
    record = afterAnswer(
      record,
      { concept, right: one.right, difficulty: difficultyOf(one.questionId), where: 'practice', hintsUsed: one.hintsUsed },
      one.at
    )
  }
  return record
}
