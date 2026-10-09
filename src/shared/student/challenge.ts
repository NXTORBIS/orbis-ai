/**
 * Challenges: a run of right answers, a chapter test, and the occasional surprise.
 *
 * ## The rule this file is built around
 *
 * **A challenge may never invent its own questions.** Everything here is assembled from what the student already
 * has -- their own flashcards, their own mistake book, the concepts in their own syllabus. When there is not enough
 * material, the honest answer is "there is not enough to test you on yet, here is how to get some", and that is
 * what this returns. A quiz full of plausible-sounding questions Orbis made up is the single worst thing a study
 * tool can do, because wrong answers get learned.
 *
 * ## Why a combo is a run and not a score
 *
 * A run of right answers *inside one sitting* is a real thing somebody can feel. A lifetime average is not. The run
 * resets on a wrong answer and on a new sitting, and nothing is taken away when it does -- a lost combo costs
 * nothing, because punishing somebody for a wrong answer is how a person learns to avoid answering.
 *
 * ## Why the reward is small
 *
 * XP here is deliberately modest and capped per day. The point of a challenge is the recall it forces; if the XP
 * were worth more than the learning, the sensible move would be to farm it, and a system that rewards farming over
 * learning has lied about what it is for.
 */

import { dayKey } from './days.ts'
import { overall, type Mastery } from './mastery.ts'
import type { Chapter, Concept, Graph } from './graph.ts'
import type { Flashcard, Mistake } from './types.ts'

// ---------------------------------------------------------------- a run of right answers

export interface Combo {
  /** Right answers in a row, in this sitting. */
  run: number
  best: number
  /** The sitting this run belongs to. A new sitting starts a new run. */
  sittingId: string
  /** XP paid out for runs today, so a long session cannot farm it. */
  paidToday: number
  day: string
}

/** Where a run starts paying, and what each step is worth. Small on purpose. */
export const COMBO_STEPS: readonly { at: number; xp: number; says: string }[] = [
  { at: 3, xp: 3, says: 'Three in a row.' },
  { at: 5, xp: 5, says: 'Five in a row.' },
  { at: 10, xp: 10, says: 'Ten in a row.' },
  { at: 20, xp: 15, says: 'Twenty in a row.' }
]

/** The most a day's runs can be worth, whatever happens. */
export const COMBO_XP_A_DAY = 40

export function newCombo(sittingId: string, day: string): Combo {
  return { run: 0, best: 0, sittingId, paidToday: 0, day }
}

export function answered(combo: Combo, right: boolean, sittingId: string, now: number): { combo: Combo; xp: number; says: string | null } {
  const day = dayKey(now)
  // A new day resets what has been paid; a new sitting resets the run but keeps the best.
  const base: Combo =
    combo.day === day
      ? combo.sittingId === sittingId
        ? combo
        : { ...combo, run: 0, sittingId }
      : { ...combo, run: 0, sittingId, paidToday: 0, day }

  if (!right) {
    // Nothing is taken away. The run simply starts again.
    return { combo: { ...base, run: 0 }, xp: 0, says: null }
  }

  const run = base.run + 1
  const step = COMBO_STEPS.find((one) => one.at === run)
  const room = Math.max(0, COMBO_XP_A_DAY - base.paidToday)
  const xp = step ? Math.min(step.xp, room) : 0
  return {
    combo: { ...base, run, best: Math.max(base.best, run), paidToday: base.paidToday + xp },
    xp,
    says: step && xp > 0 ? step.says : null
  }
}

// ---------------------------------------------------------------- a chapter challenge

export interface Challenge {
  id: string
  /** The stage this was built for, when it was built for one. */
  stageId?: string | null
  chapterId: string
  chapterName: string
  subject: string | null
  /** The questions, all of them the student's own material. */
  questions: readonly ChallengeQuestion[]
  /** Right answers needed. Stated before it starts, never moved afterwards. */
  toPass: number
  xp: number
  createdAt: number
  /** Whose questions these are, in one line. Never hidden, however the test was put together. */
  mix?: string
}

export interface ChallengeQuestion {
  id: string
  /**
   * Where it came from, so nothing here is ever mistaken for something it is not.
   *
   * `generated` is a question Orion wrote, shown as such and worth less: it tops a test up when there is not
   * enough of the student's own material, and a right answer to one is lighter evidence than producing their own.
   */
  source: 'flashcard' | 'mistake' | 'generated'
  sourceId: string
  ask: string
  answer: string
  conceptId: string | null
}

export interface NotReady {
  ready: false
  /** Plainly why, and what would fix it. */
  why: string
  need: number
  have: number
}

/** The fewest questions a chapter test can honestly be made of. */
export const LEAST_QUESTIONS = 5

export function challengeFor(
  chapter: Chapter | { id: string; name: string; subject: string },
  inside: readonly Concept[],
  material: { cards: readonly Flashcard[]; mistakes: readonly Mistake[] },
  mastery: ReadonlyMap<string, Mastery>,
  now: number,
  /**
   * How long it is, for the stages that cover more than one chapter.
   *
   * A mixed paper over a whole subject asking six questions would not be a mixed paper. The pass mark is still four
   * fifths of whatever is actually asked, so a longer test is not a harder one per question.
   */
  options?: { most?: number; label?: string }
): Challenge | NotReady {
  const names = new Map(inside.map((one) => [one.name.toLowerCase(), one.id]))
  const subject = chapter.subject

  /*
   * Material is matched to the chapter by subject and by the concept names appearing in it.
   *
   * Deliberately literal: a card is included because it says the words, not because something guessed it was
   * related. A guess here would put an unrelated question in a test and call it the chapter's.
   */
  const mentions = (text: string): string | null => {
    const lower = text.toLowerCase()
    for (const [name, id] of names) if (name.length > 3 && lower.includes(name)) return id
    return null
  }

  const questions: ChallengeQuestion[] = []
  for (const card of material.cards) {
    if (!card.front.trim() || !card.back.trim()) continue
    const conceptId = mentions(`${card.front} ${card.back}`)
    const sameSubject = subject !== null && card.subject === subject
    if (!conceptId && !sameSubject) continue
    questions.push({ id: `q:${card.id}`, source: 'flashcard', sourceId: card.id, ask: card.front, answer: card.back, conceptId })
  }
  for (const mistake of material.mistakes) {
    /*
     * A mistake-book entry is not a question somebody wrote, so it is not dressed up as one.
     *
     * What is shown is the thing it was about, and what is revealed is the student's own note on it. Orbis writing
     * a question around somebody's note would be Orbis inventing the question.
     */
    if (!mistake.concept.trim() || !mistake.detail.trim()) continue
    const conceptId = mentions(`${mistake.concept} ${mistake.detail}`)
    const sameSubject = subject !== null && mistake.subject === subject
    if (!conceptId && !sameSubject) continue
    questions.push({ id: `q:${mistake.id}`, source: 'mistake', sourceId: mistake.id, ask: mistake.concept, answer: mistake.detail, conceptId })
  }

  if (questions.length < LEAST_QUESTIONS) {
    return {
      ready: false,
      why:
        questions.length === 0
          ? `There is nothing of your own to test you on in ${chapter.name} yet. Make a few cards, or add a mistake you want to stop making.`
          : `Only ${questions.length} of your own questions in ${chapter.name} — ${LEAST_QUESTIONS} is enough to make a fair test.`,
      need: LEAST_QUESTIONS,
      have: questions.length
    }
  }

  /*
   * The weakest material first, and mistakes before cards.
   *
   * A test built from what is already solid proves nothing. Anything a student got wrong before is the most useful
   * question there is, so it goes in regardless of how many cards there are.
   */
  const weight = (one: ChallengeQuestion): number => {
    const known = one.conceptId ? mastery.get(one.conceptId) : null
    const score = known ? overall(known) : 0.3
    return (one.source === 'mistake' ? -1 : 0) + score
  }
  const picked = [...questions].sort((a, b) => weight(a) - weight(b)).slice(0, Math.max(5, Math.min(40, options?.most ?? 12)))

  return {
    id: `challenge:${chapter.id}:${dayKey(now)}`,
    // Carried so a finished stage knows which one it was, without the screen having to remember.
    stageId: options?.label ? `stage:${chapter.id}` : null,
    chapterId: chapter.id,
    chapterName: options?.label ?? chapter.name,
    subject,
    questions: picked,
    // Four fifths, rounded down, and never all of them: a test nobody can pass is not a test.
    toPass: Math.max(3, Math.floor(picked.length * 0.8)),
    xp: 25,
    createdAt: now
  }
}

export function challengeResult(challenge: Challenge, right: readonly string[]): { passed: boolean; score: number; outOf: number; says: string } {
  const inside = new Set(challenge.questions.map((one) => one.id))
  const score = new Set(right.filter((one) => inside.has(one))).size
  const outOf = challenge.questions.length
  const passed = score >= challenge.toPass
  return {
    passed,
    score,
    outOf,
    says: passed
      ? `${score} of ${outOf}. That chapter is holding.`
      : // No blame, and something concrete to do with the result.
        `${score} of ${outOf}. Worth another look at the ones that went wrong — they are in your mistake book now.`
  }
}

// ---------------------------------------------------------------- a surprise, occasionally

export interface Surprise {
  id: string
  title: string
  because: string
  minutes: number
  conceptId: string | null
  subject: string | null
  xp: number
}

/**
 * A small unexpected thing, at most once a day, and only when the student is already going well.
 *
 * Offered after a session rather than during one, and never to somebody who has just had a hard day: a surprise
 * challenge for a student who already missed their plan reads as a taunt. The gate is deliberately high so that it
 * stays a surprise rather than becoming a fixture.
 */
export function surpriseFor(
  state: { lastSurpriseDay: string | null; sessionsToday: number; focusedSecondsToday: number; now: number },
  graph: Graph,
  mastery: ReadonlyMap<string, Mastery>
): Surprise | null {
  const day = dayKey(state.now)
  if (state.lastSurpriseDay === day) return null
  if (state.sessionsToday < 1 || state.focusedSecondsToday < 900) return null

  // Something nearly there: the one place a five-minute push genuinely changes the answer.
  const nearly = [...mastery.entries()]
    .map(([conceptId, held]) => ({ conceptId, score: overall(held), held }))
    /*
     * "Nearly there" means measured, not merely touched: a couple of real attempts, going right, and not yet
     * holding. The floor is a little under half on purpose -- four good pieces of evidence land around there, and
     * that is exactly the student a short push helps.
     */
    .filter((one) => one.score >= 0.45 && one.score < 0.78 && one.held.wrongRun === 0 && one.held.attempts >= 2)
    .sort((a, b) => b.score - a.score)[0]
  if (!nearly) return null

  const concept = graph.concepts.find((one) => one.id === nearly.conceptId)
  if (!concept) return null
  const chapter = graph.chapters.find((one) => one.id === concept.chapterId)

  return {
    id: `surprise:${day}`,
    title: `Five minutes on ${concept.name}?`,
    because: 'It is nearly holding. One short go is usually what finishes it off.',
    minutes: 5,
    conceptId: concept.id,
    subject: chapter?.subject ?? null,
    xp: 10
  }
}
