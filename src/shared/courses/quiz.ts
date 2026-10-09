/**
 * Marking, and what happens when somebody does not pass.
 *
 * ## Eighty per cent, and a failure is never a dead end
 *
 * The pass mark is high on purpose: low enough to scrape through by guessing and a quiz becomes a formality. But
 * the whole design of what happens *below* the mark is recovery — what went wrong, why, which concepts to go back
 * to, and a retry. A quiz that can be failed and not recovered from is a wall, and a wall teaches nobody.
 *
 * ## A retry is not the same paper
 *
 * Questions are drawn from a pool and shuffled, and a second attempt prefers ones that were got wrong plus
 * material not asked last time. Re-serving the identical paper measures memory of the paper.
 *
 * ## Marking is strict about answers and generous about typing
 *
 * A short answer is compared with its spelling tidied and its case ignored; a number is compared within whatever
 * tolerance the question declares. Being pedantic about a stray capital letter is not rigour, it is noise.
 */

import type { Question, QuestionAttempt, QuizAttempt } from './types.ts'

/** The pass mark, unless a course sets its own. */
export const PASS = 0.8

export interface Given {
  questionId: string
  /** What they put. Shape depends on the kind; `mark` knows what to do with each. */
  value: number[] | string | number | boolean | null
  hintsUsed: number
  seconds: number
}

export interface Marked {
  questionId: string
  concept: string
  right: boolean
  /** What they gave, as a readable string, so a review screen can show it back. */
  given: string
  /** The right answer, readable. */
  expected: string
  explanation: string
}

const tidy = (text: string): string =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9+\-*/.^ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const sameSet = (a: readonly number[], b: readonly number[]): boolean => {
  if (a.length !== b.length) return false
  const left = [...a].sort((one, two) => one - two)
  const right = [...b].sort((one, two) => one - two)
  return left.every((one, index) => one === right[index])
}

/** What an answer looks like written out, for the review screen. */
export function readable(question: Question, value: Given['value']): string {
  if (value === null || value === undefined) return 'nothing'
  if (Array.isArray(value)) {
    const names = value.map((one) => question.options?.[one] ?? String(one))
    return names.join(', ') || 'nothing'
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number' && question.kind === 'choice') return question.options?.[value] ?? String(value)
  return String(value)
}

/** One question, marked. */
export function mark(question: Question, given: Given): Marked {
  const answer = question.answer
  let right = false

  switch (question.kind) {
    case 'choice':
      right = typeof given.value === 'number' && (Array.isArray(answer) ? answer[0] === given.value : answer === given.value)
      break
    case 'multi':
      right = Array.isArray(given.value) && Array.isArray(answer) && sameSet(given.value, answer)
      break
    case 'true-false':
      right = typeof given.value === 'boolean' && given.value === answer
      break
    case 'number': {
      const asked = typeof answer === 'number' ? answer : Number(answer)
      const got = typeof given.value === 'number' ? given.value : Number(given.value)
      // A tolerance of zero still has to allow for the way floating point stores a decimal.
      const slack = question.tolerance ?? 1e-9
      right = Number.isFinite(got) && Number.isFinite(asked) && Math.abs(got - asked) <= slack
      break
    }
    case 'order': {
      right = Array.isArray(given.value) && Array.isArray(answer) && given.value.length === answer.length && given.value.every((one, index) => one === answer[index])
      break
    }
    case 'match': {
      right = Array.isArray(given.value) && Array.isArray(answer) && given.value.length === answer.length && given.value.every((one, index) => one === answer[index])
      break
    }
    case 'short':
    case 'code':
    default: {
      const got = tidy(String(given.value ?? ''))
      if (!got) {
        right = false
        break
      }
      const allowed = [typeof answer === 'string' ? answer : String(answer), ...(question.accepts ?? [])].map(tidy)
      right = allowed.some((one) => one.length > 0 && (one === got || (one.length > 6 && got.includes(one))))
      break
    }
  }

  return {
    questionId: question.id,
    concept: question.concept,
    right,
    given: readable(question, given.value),
    expected: readable(question, Array.isArray(answer) ? answer : (answer as never)),
    explanation: question.explanation
  }
}

export interface Result {
  score: number
  passed: boolean
  asked: number
  right: number
  marked: Marked[]
  /** Concepts that went wrong, worst first. What the retry screen sends somebody back to. */
  weak: string[]
  /** What it says at the top, which is never a judgement about the person. */
  says: string
}

/** A whole quiz, marked. */
export function markAll(questions: readonly Question[], given: readonly Given[], pass = PASS): Result {
  const byId = new Map(questions.map((one) => [one.id, one]))
  const marked: Marked[] = []
  for (const one of given) {
    const question = byId.get(one.questionId)
    if (question) marked.push(mark(question, one))
  }
  const right = marked.filter((one) => one.right).length
  const asked = marked.length
  const score = asked === 0 ? 0 : right / asked
  const passed = asked > 0 && score >= pass

  // Concepts ranked by how often they went wrong, so the worst is dealt with first.
  const wrongBy = new Map<string, number>()
  for (const one of marked) if (!one.right) wrongBy.set(one.concept, (wrongBy.get(one.concept) ?? 0) + 1)
  const weak = [...wrongBy.entries()].sort((a, b) => b[1] - a[1]).map(([concept]) => concept)

  return {
    score,
    passed,
    asked,
    right,
    marked,
    weak,
    /*
     * Said plainly, and never about the person.
     *
     * "You failed" is a sentence about somebody. "Not yet" is a sentence about the work, and it is the one that
     * leaves them willing to press retry.
     */
    says: passed
      ? right === asked
        ? 'Every one right.'
        : `${right} of ${asked} right — passed.`
      : `${right} of ${asked} right. Not yet — ${Math.round(pass * 100)}% is the mark.`
  }
}

/**
 * Which questions to ask.
 *
 * On a first attempt, a spread across the concepts. On a retry, the ones that went wrong plus material not seen
 * last time, so the second paper is genuinely a second paper.
 */
export function pick(
  pool: readonly Question[],
  ask: number,
  options: { previous?: readonly QuizAttempt[]; wrongConcepts?: readonly string[]; shuffle?: (n: number) => number } = {}
): Question[] {
  if (pool.length <= ask) return [...pool]
  const weak = new Set(options.wrongConcepts ?? [])
  const random = options.shuffle ?? ((n: number): number => Math.floor(Math.random() * n))

  const wanted: Question[] = []
  const rest: Question[] = []
  for (const one of pool) (weak.has(one.concept) ? wanted : rest).push(one)

  // Weak concepts first, then a spread of the rest, never more than one in three from any single concept.
  const out: Question[] = []
  const takenPerConcept = new Map<string, number>()
  const cap = Math.max(1, Math.ceil(ask / 3))

  const take = (from: Question[]): void => {
    const bag = [...from]
    while (bag.length > 0 && out.length < ask) {
      const one = bag.splice(random(bag.length), 1)[0]
      const already = takenPerConcept.get(one.concept) ?? 0
      if (already >= cap && out.length + bag.length >= ask) continue
      takenPerConcept.set(one.concept, already + 1)
      out.push(one)
    }
  }

  take(wanted)
  take(rest)
  return out.slice(0, ask)
}

/** What a learner is offered after a quiz they did not pass. Never a dead end. */
export function afterFailing(result: Result, conceptName: (id: string) => string): { says: string; actions: { id: string; label: string }[]; review: string[] } {
  const names = result.weak.slice(0, 3).map(conceptName)
  return {
    says: names.length > 0 ? `Worth going back over ${names.join(', ')}.` : 'Worth going back over the lesson before trying again.',
    actions: [
      { id: 'review', label: 'Review what went wrong' },
      { id: 'practise', label: 'Practise the weak bits' },
      { id: 'retry', label: 'Try the quiz again' }
    ],
    review: result.weak
  }
}

/** The attempt as it is stored. */
export function toAttempt(id: string, scope: string, result: Result, at: number, seconds: number): QuizAttempt {
  return { id, scope, at, score: result.score, passed: result.passed, asked: result.asked, right: result.right, weak: result.weak, seconds }
}

/** The individual answers as they are stored, which is what mastery is built from. */
export function toAttempts(result: Result, given: readonly Given[], at: number, id: (n: number) => string): QuestionAttempt[] {
  return result.marked.map((one, index) => {
    const from = given.find((two) => two.questionId === one.questionId)
    return {
      id: id(index),
      questionId: one.questionId,
      concept: one.concept,
      at,
      right: one.right,
      given: one.given,
      hintsUsed: from?.hintsUsed ?? 0,
      seconds: from?.seconds ?? 0
    }
  })
}

/** The best score so far on a scope, for progress and for the certificate. */
export function bestScore(attempts: readonly QuizAttempt[], scope: string): number {
  return attempts.filter((one) => one.scope === scope).reduce((best, one) => Math.max(best, one.score), 0)
}

export function hasPassed(attempts: readonly QuizAttempt[], scope: string): boolean {
  return attempts.some((one) => one.scope === scope && one.passed)
}
