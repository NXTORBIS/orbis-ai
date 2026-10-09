/**
 * Marking an attempt.
 *
 * Everything on the end screen is counted from what was actually answered — the marks, the percentage, the time,
 * the breakdown by topic. Nothing is estimated and nothing is rounded in the quiz's favour.
 *
 * Two decisions worth stating:
 *
 *   - **A question that was never answered is wrong, not missing.** Skipping is allowed, and a skipped question
 *     counts against the mark exactly as a wrong one does. The alternative — scoring out of what was attempted —
 *     turns "I answered the two I knew" into 100%.
 *   - **There is no pass mark.** A quiz in the chat is practice. Courses has a pass mark because finishing a
 *     course means something; this does not, and inventing a line to fall below would be a judgement nobody
 *     asked for.
 */
import type { Quiz, QuizQuestion } from './build.ts'

export interface QuizAnswer {
  questionId: string
  /** Which option was picked, or null for a question that was passed over. */
  picked: number | null
  /** How long that question took, in milliseconds. */
  tookMs: number
}

export interface QuizMarked {
  right: number
  wrong: number
  skipped: number
  outOf: number
  /** Whole percent, rounded down, so 7 out of 8 is 87% rather than 88%. */
  percent: number
  /** The whole attempt, in milliseconds. Counted from the answers, not from a wall clock. */
  tookMs: number
  /** The average time per answered question, or null when nothing was answered. */
  perQuestionMs: number | null
  byTopic: readonly { topic: string; right: number; outOf: number; percent: number }[]
  /** Every question that was not answered correctly, in the order they were asked. */
  missed: readonly {
    question: QuizQuestion
    picked: number | null
    /** What they picked, as text. Null when the question was passed over. */
    pickedText: string | null
    answerText: string
  }[]
  /** What to say about the attempt. Plain, and never praise for a poor result. */
  says: string
}

export function mark(quiz: Quiz, answers: readonly QuizAnswer[]): QuizMarked {
  const given = new Map(answers.map((one) => [one.questionId, one]))
  const questions = quiz.questions

  let right = 0
  let skipped = 0
  let tookMs = 0
  let answered = 0
  const missedList: {
    question: QuizQuestion
    picked: number | null
    pickedText: string | null
    answerText: string
  }[] = []
  const topics = new Map<string, { right: number; outOf: number }>()

  for (const question of questions) {
    const answer = given.get(question.id)
    const picked = answer && typeof answer.picked === 'number' ? answer.picked : null
    tookMs += Math.max(0, Number(answer?.tookMs ?? 0))
    if (picked === null) skipped += 1
    else answered += 1

    const correct = picked === question.answer
    if (correct) right += 1
    else {
      missedList.push({
        question,
        picked,
        pickedText: picked === null ? null : (question.options[picked] ?? null),
        answerText: question.options[question.answer] ?? ''
      })
    }

    const held = topics.get(question.topic) ?? { right: 0, outOf: 0 }
    held.outOf += 1
    if (correct) held.right += 1
    topics.set(question.topic, held)
  }

  const outOf = questions.length
  const percent = outOf === 0 ? 0 : Math.floor((right / outOf) * 100)

  return {
    right,
    wrong: outOf - right - skipped,
    skipped,
    outOf,
    percent,
    tookMs,
    perQuestionMs: answered === 0 ? null : Math.round(tookMs / answered),
    byTopic: Object.freeze(
      [...topics.entries()]
        .map(([topic, held]) => ({
          topic,
          right: held.right,
          outOf: held.outOf,
          percent: Math.floor((held.right / held.outOf) * 100)
        }))
        // Weakest first: the point of the breakdown is what to go and read.
        .sort((a, b) => a.percent - b.percent || a.topic.localeCompare(b.topic))
    ),
    missed: Object.freeze(missedList) as QuizMarked['missed'],
    says: saysFor(right, outOf, skipped)
  }
}

/**
 * One line about the attempt.
 *
 * Deliberately flat. "Great job!" on four out of ten is the kind of encouragement that makes somebody trust
 * nothing else the thing says.
 */
function saysFor(right: number, outOf: number, skipped: number): string {
  if (outOf === 0) return 'Nothing to mark.'
  const missed = outOf - right
  const andSkipped = skipped > 0 ? ` ${skipped} ${skipped === 1 ? 'was' : 'were'} passed over, which counts as wrong.` : ''
  if (right === outOf) return `All ${outOf} right.`
  if (right === 0) return `None right this time. The explanations below say why.${andSkipped}`
  return `${right} of ${outOf} right, ${missed} to go back over.${andSkipped}`
}

/** The questions worth trying again: the ones that were missed, in the same order. */
export function retryOf(quiz: Quiz, marked: QuizMarked, id: string, now: number): Quiz | null {
  if (marked.missed.length === 0) return null
  return {
    ...quiz,
    id,
    title: `${quiz.title} — the ones you missed`,
    questions: Object.freeze(marked.missed.map((one) => one.question)),
    madeAt: now
  }
}

/** A length of time as somebody would say it. */
export function howLong(ms: number): string {
  const seconds = Math.round(Math.max(0, ms) / 1000)
  // "0 seconds" reads as a fault rather than as fast.
  if (seconds === 0) return 'under a second'
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return rest === 0 ? `${minutes} minute${minutes === 1 ? '' : 's'}` : `${minutes} min ${rest} sec`
  const hours = Math.floor(minutes / 60)
  return `${hours} hour${hours === 1 ? '' : 's'} ${minutes % 60} min`
}
