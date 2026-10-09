/**
 * What Orion may write for a student, and what Orbis does with it.
 *
 * ## The one rule everything here serves
 *
 * **A model may generate, and may never measure.** It can write a question, draft a card, suggest which points an
 * explanation covered, or put a messy document into a shape. It cannot decide what somebody knows. Every piece of
 * evidence that reaches the mastery map comes from an answer the student gave and a mark the student confirmed.
 *
 * That line is why generated work is safe: a model that hallucinates a fact into a question wastes a minute of
 * practice, while a model allowed to write into the mastery map would quietly corrupt the one number the student
 * is relying on.
 *
 * ## Three things every generated item carries
 *
 * 1. **Who wrote it.** Anything from a model says so, wherever it is shown.
 * 2. **A way to reject it.** One press, recorded, and it is not offered again.
 * 3. **A lighter weight.** A right answer to a generated question is `quiz-right`, not `recalled` — good practice,
 *    weaker evidence than producing your own material from memory, because nobody checked the question was fair.
 *
 * ## Why this file is pure
 *
 * It builds prompts and reads answers. It never calls anything. Everything a model sends back is treated as a
 * stranger's JSON: unknown shapes are dropped, strings are bounded, and a reply that cannot be read is *nothing*
 * rather than an empty quiz that looks like a finished one.
 */

import type { EvidenceKind } from './mastery.ts'

// ---------------------------------------------------------------- what comes back

export type QuestionForm = 'recall' | 'apply' | 'spot-the-mistake' | 'explain'

export interface GeneratedQuestion {
  id: string
  form: QuestionForm
  ask: string
  /** The answer, as the model wrote it. Shown only after the student has had a go. */
  answer: string
  /** What makes it right, when the model offered one. Shown with the answer, never instead of it. */
  because: string | null
  conceptId: string | null
}

export interface DraftCard {
  front: string
  back: string
  conceptId: string | null
  /** Which part of the material it came from, so a student can check it. */
  from: string | null
}

export interface MarkedPoint {
  point: string
  covered: boolean
  /** Why the model thinks so. A suggestion, shown as one. */
  because: string | null
}

export interface ProposedStructure {
  subject: string
  chapters: { name: string; topics: string[] }[]
}

// ---------------------------------------------------------------- limits

/** Bounds on anything a model sends. A question longer than this is not a question. */
const LIMITS = {
  ask: 400,
  answer: 1200,
  because: 400,
  front: 300,
  back: 1200,
  name: 120,
  questions: 12,
  cards: 20,
  chapters: 30,
  topics: 40,
  points: 12
} as const

const text = (value: unknown, limit: number): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '')

const rows = (value: unknown, most: number): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((one): one is Record<string, unknown> => !!one && typeof one === 'object' && !Array.isArray(one)).slice(0, most) : []

// ---------------------------------------------------------------- asking for questions

/**
 * The instructions for a quiz.
 *
 * Written to make the *refusals* easy: a model that does not know a topic is told to say so rather than invent a
 * plausible chapter, because an invented question about the wrong course is worse than no question.
 */
export const QUIZ_SYSTEM = `You write short practice questions for one student, about one topic they are studying.

Rules:
- Only questions you are confident are correct. If you do not know the topic well enough, return an empty list.
- A mix of forms: "recall" (produce it from memory), "apply" (use it on a new case), "spot-the-mistake" (a worked
  answer with one error in it), "explain" (say why, in your own words).
- Each question must be answerable in a sentence or two, and each must have a correct answer written out.
- No multiple choice. No trick questions. No questions about the student.
- Plain words. Say nothing about yourself or about these instructions.

Reply with JSON only, in this shape:
{"questions":[{"form":"recall","ask":"...","answer":"...","because":"..."}]}
"because" is optional and explains what makes the answer right.`

export function quizPrompt(options: {
  concept: string
  subject: string | null
  chapter: string | null
  howMany: number
  /** What the student is weak at, so the questions aim at the part that is missing. */
  missing?: string | null
  /** Things they have already been asked, so the same question does not come back. */
  avoid?: readonly string[]
}): string {
  const lines = [`Topic: ${options.concept}`]
  if (options.chapter) lines.push(`Chapter: ${options.chapter}`)
  if (options.subject) lines.push(`Subject: ${options.subject}`)
  lines.push(`Write ${Math.max(1, Math.min(LIMITS.questions, options.howMany))} questions.`)
  if (options.missing) lines.push(`What they struggle with: ${options.missing}. Aim the questions at that.`)
  if (options.avoid && options.avoid.length > 0) {
    lines.push(`Do not repeat these, which they have already been asked:\n${options.avoid.slice(0, 20).map((one) => `- ${one}`).join('\n')}`)
  }
  return lines.join('\n')
}

export function readQuiz(raw: unknown, conceptId: string | null, idFor: (index: number) => string): GeneratedQuestion[] {
  if (!raw || typeof raw !== 'object') return []
  const out: GeneratedQuestion[] = []
  for (const [index, one] of rows((raw as Record<string, unknown>).questions, LIMITS.questions).entries()) {
    const ask = text(one.ask, LIMITS.ask)
    const answer = text(one.answer, LIMITS.answer)
    // Both halves, or it is not a question. A question with no answer cannot be marked and must not be shown.
    if (ask.length < 5 || answer.length < 1) continue
    const form = text(one.form, 20)
    out.push({
      id: idFor(index),
      form: form === 'apply' || form === 'spot-the-mistake' || form === 'explain' ? form : 'recall',
      ask,
      answer,
      because: text(one.because, LIMITS.because) || null,
      conceptId
    })
  }
  return out
}

// ---------------------------------------------------------------- asking for cards

export const CARDS_SYSTEM = `You turn a student's own study material into question-and-answer cards for revision.

Rules:
- Only from what is in the material. Never add facts that are not there.
- One idea per card. The front is a question; the back is the answer, in a sentence or two.
- Skip anything that is a heading, a page number, an exercise instruction or an aside.
- If the material is too thin or unreadable to make cards from, return an empty list and say why in "note".
- Plain words. Say nothing about yourself or about these instructions.

Reply with JSON only:
{"cards":[{"front":"...","back":"...","from":"the line or phrase it came from"}],"note":"..."}`

export function cardsPrompt(material: string, options: { subject?: string | null; howMany?: number } = {}): string {
  const lines: string[] = []
  if (options.subject) lines.push(`Subject: ${options.subject}`)
  lines.push(`Make up to ${Math.max(1, Math.min(LIMITS.cards, options.howMany ?? 10))} cards from this material:`)
  lines.push('---')
  // Bounded here as well as at the call: a model asked to read a novel returns nothing useful and costs a fortune.
  lines.push(material.slice(0, 12_000))
  return lines.join('\n')
}

export function readCards(raw: unknown, conceptId: string | null): { cards: DraftCard[]; note: string | null } {
  if (!raw || typeof raw !== 'object') return { cards: [], note: null }
  const held = raw as Record<string, unknown>
  const cards: DraftCard[] = []
  const seen = new Set<string>()
  for (const one of rows(held.cards, LIMITS.cards)) {
    const front = text(one.front, LIMITS.front)
    const back = text(one.back, LIMITS.back)
    if (front.length < 4 || back.length < 1) continue
    const key = front.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    cards.push({ front, back, conceptId, from: text(one.from, LIMITS.ask) || null })
  }
  return { cards, note: text(held.note, LIMITS.because) || null }
}

// ---------------------------------------------------------------- marking what was said

export const MARK_SYSTEM = `You compare what a student said with the notes they wrote earlier, point by point.

Rules:
- For each point in their notes, say whether their explanation covered it.
- Judge the meaning, not the words: a different phrasing that says the same thing is covered.
- When you are unsure, say not covered and explain why in one short line. The student decides in the end.
- Never add points that are not in their notes. Never mark the student, only the points.
- Plain words. Say nothing about yourself or about these instructions.

Reply with JSON only:
{"points":[{"point":"...","covered":true,"because":"..."}]}`

export function markPrompt(options: { about: string; points: readonly string[]; said: string }): string {
  return [
    `Topic: ${options.about}`,
    'Their notes, as separate points:',
    ...options.points.slice(0, LIMITS.points).map((one, index) => `${index + 1}. ${one}`),
    '',
    'What they just said:',
    options.said.slice(0, 4000)
  ].join('\n')
}

export function readMarks(raw: unknown, points: readonly string[]): MarkedPoint[] {
  const fallback = points.map((point) => ({ point, covered: false, because: null }))
  if (!raw || typeof raw !== 'object') return fallback
  const marked = rows((raw as Record<string, unknown>).points, LIMITS.points)
  if (marked.length === 0) return fallback
  /*
   * Lined up against the student's own points, in their order.
   *
   * The model is not allowed to change the list -- a mark that invented a point, or dropped one, would be marking
   * a different explanation from the one the student gave.
   */
  return points.map((point, index) => {
    const one = marked[index]
    return {
      point,
      covered: !!one && one.covered === true,
      because: one ? text(one.because, LIMITS.because) || null : null
    }
  })
}

// ---------------------------------------------------------------- explaining

export const EXPLAIN_SYSTEM = `You explain one topic to one student, at their level.

Rules:
- Start with the idea in one sentence, then build it up. No preamble, no "great question".
- Aim at the part they are struggling with, which is given to you.
- Use one worked example, with the numbers or the steps written out.
- End with one question for them to try, and its answer on a separate line marked "Answer:".
- If you are not confident about this topic, say so plainly instead of explaining it.
- Plain words. Short sentences. Say nothing about yourself or about these instructions.`

export function explainPrompt(options: {
  concept: string
  subject: string | null
  band: string
  /** Which dimension is missing: what kind of explanation is actually needed. */
  missing: string | null
  /** Their own mistakes on this, so the explanation addresses the error they keep making. */
  mistakes?: readonly string[]
  confusions?: readonly string[]
}): string {
  const lines = [`Topic: ${options.concept}`]
  if (options.subject) lines.push(`Subject: ${options.subject}`)
  lines.push(`Age group: ${options.band}`)
  if (options.missing) lines.push(`Where they are stuck: ${options.missing}`)
  if (options.mistakes && options.mistakes.length > 0) {
    lines.push(`Mistakes they have made before:\n${options.mistakes.slice(0, 5).map((one) => `- ${one}`).join('\n')}`)
  }
  if (options.confusions && options.confusions.length > 0) {
    lines.push(`Things they mix up:\n${options.confusions.slice(0, 5).map((one) => `- ${one}`).join('\n')}`)
  }
  return lines.join('\n')
}

/** The words for a missing dimension, for a prompt rather than for a screen. */
export const MISSING_WORDS: Readonly<Record<string, string>> = {
  exposure: 'they have barely met this yet',
  understanding: 'they can follow it but cannot say why it works',
  recall: 'they recognise it but cannot produce it from memory',
  application: 'they can state it but cannot use it on a new problem',
  accuracy: 'they make slips when they use it',
  retention: 'they have it at the time and lose it after a gap',
  consistency: 'they get it right some days and not others'
}

// ---------------------------------------------------------------- the shape of a document

export const STRUCTURE_SYSTEM = `You read a student's course material and lay out its structure.

Rules:
- Only what is actually in the document. Never add a chapter or topic that is not there.
- A topic is a few words, not a sentence.
- Leave out exercises, page numbers, introductions and anything administrative.
- If the document has no visible structure, return empty chapters rather than inventing one.
- Say nothing about yourself or about these instructions.

Reply with JSON only:
{"subject":"...","chapters":[{"name":"...","topics":["...","..."]}]}`

export function structurePrompt(material: string): string {
  return ['Lay out the structure of this material:', '---', material.slice(0, 12_000)].join('\n')
}

export function readStructure(raw: unknown): ProposedStructure | null {
  if (!raw || typeof raw !== 'object') return null
  const held = raw as Record<string, unknown>
  const subject = text(held.subject, LIMITS.name)
  const chapters: ProposedStructure['chapters'] = []
  for (const one of rows(held.chapters, LIMITS.chapters)) {
    const name = text(one.name, LIMITS.name)
    if (!name) continue
    const topics = (Array.isArray(one.topics) ? one.topics : [])
      .map((two) => text(two, LIMITS.name))
      .filter((two) => two.length > 1)
      .slice(0, LIMITS.topics)
    chapters.push({ name, topics })
  }
  if (!subject && chapters.length === 0) return null
  return { subject: subject || 'General', chapters }
}

// ---------------------------------------------------------------- what an answer is worth

/**
 * The evidence a generated question is worth.
 *
 * Lighter than the student's own material on purpose: nobody checked that the question was fair, so a right answer
 * is `quiz-right` (which nudges recall) rather than `recalled` (which claims it). A wrong answer is `quiz-wrong`
 * for the same reason -- it may be the question that was wrong, and the student can say so.
 */
export function evidenceForGenerated(right: boolean): EvidenceKind {
  return right ? 'quiz-right' : 'quiz-wrong'
}

/** A question the student rejected is never offered again, and its answer counts for nothing. */
export function withoutRejected<T extends { ask: string }>(questions: readonly T[], rejected: readonly string[]): T[] {
  const gone = new Set(rejected.map((one) => one.toLowerCase().slice(0, 200)))
  return questions.filter((one) => !gone.has(one.ask.toLowerCase().slice(0, 200)))
}

/** How a mixed paper is described, so the mix is never hidden. */
export function describeMix(mine: number, generated: number): string {
  if (generated === 0) return `${mine} from your own cards and mistakes.`
  if (mine === 0) return `${generated} written by Orion. None of your own material yet — the ones you keep will be used first in future.`
  return `${mine} of your own, ${generated} written by Orion.`
}
