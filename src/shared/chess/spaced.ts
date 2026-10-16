import { SCHEDULER_FACTS, isLearningError, scheduleReview, type ReviewState, type Scheduler } from '../compute/learning.ts'
import type { Performance } from './attempt.ts'

/**
 * When an exercise comes back (Sections 205, 214).
 *
 * ## It reuses the scheduler Orbis already has
 *
 * `src/shared/compute/learning.ts` holds the review schedulers -- SM-2, an FSRS-style one, Leitner boxes -- with
 * their origins and their limitations written down. Chess does not get a second one. A second spaced-repetition
 * implementation would drift from the first, and then two parts of the same application would disagree about when
 * something is due while both claimed to be using "spaced repetition".
 *
 * What this file adds is the part that is actually about chess: turning what happened in an attempt into the grade
 * that scheduler expects.
 *
 * ## The grade comes from the record, not from a feeling
 *
 * SM-2's scale runs 0 to 5, and the boundary between 2 and 3 carries almost all of its behaviour: 3 is a pass that
 * barely extends the interval, 2 is a lapse that resets it. So the mapping is written out in `GRADE_RULES` and
 * applied in order, from the recorded facts of the attempt -- solved or not, hints taken, wrong moves, time. There
 * is no self-rating: "I knew that" is not evidence, and a trainer that asks for one is asking the learner to do the
 * measuring.
 *
 * An attempt where the move was shown is a **lapse**, not a pass. It is the same rule as the Student's hint ladder:
 * an answer reached with the answer visible is not recall, and scheduling it as recall is how a review queue fills
 * up with things nobody can do.
 *
 * ## Deterministic, and no clock
 *
 * `now` is always an argument. The same card and the same attempt always produce the same next date, which is what
 * makes a schedule testable and a bug reproducible.
 */

export interface ReviewCard {
  exerciseId: string
  /** What the exercise trains -- 'fork', 'back-rank', 'opposition'. Used to build a session around weak themes. */
  themes: readonly string[]
  scheduler: Scheduler
  /** The scheduler's own state. Opaque here on purpose: this file does not do the arithmetic. */
  state: ReviewState
  /** When it is next worth doing, in milliseconds since the epoch. */
  dueAt: number
  lastAt: number | null
  attempts: number
  solved: number
  reviews: number
  lapses: number
  /**
   * How many attempts in a row have gone wrong.
   *
   * This, and not the lifetime share, is what says something has started slipping -- a ratio built over months
   * hardly moves when the last three attempts failed, which is exactly the moment worth noticing.
   */
  wrongRun: number
  /** True until it has been attempted once. A card nobody has tried is new material, not a weakness. */
  fresh: boolean
}

export const DEFAULT_SCHEDULER: Scheduler = 'sm2'

export function newCard(o: { exerciseId: string; themes?: readonly string[]; scheduler?: Scheduler; now: number }): ReviewCard {
  return {
    exerciseId: o.exerciseId,
    themes: o.themes ?? [],
    scheduler: o.scheduler ?? DEFAULT_SCHEDULER,
    state: { interval: 0 },
    dueAt: o.now,
    lastAt: null,
    attempts: 0,
    solved: 0,
    reviews: 0,
    lapses: 0,
    wrongRun: 0,
    fresh: true
  }
}

// ---------------------------------------------------------------- the grade

export interface GradeRule {
  grade: number
  /** When it applies, in words. The rules are tried in this order and the first match wins. */
  when: string
  says: string
}

/**
 * How an attempt becomes a grade, in order. The first rule that matches is the one that is used.
 *
 * Written down as data so the mapping can be read without reading the code, and so a test can check that every rule
 * is reachable.
 */
export const GRADE_RULES: readonly GradeRule[] = Object.freeze([
  { grade: 0, when: 'The answer was asked for.', says: 'Shown the answer. This comes back tomorrow.' },
  { grade: 1, when: 'Not solved.', says: 'Not solved this time. It comes back soon.' },
  { grade: 2, when: 'Solved, but the move had been shown by a hint.', says: 'Solved with the move on screen, which is not a solve. It comes back tomorrow.' },
  { grade: 3, when: 'Solved after a wrong move, or with two or more hints.', says: 'Solved the hard way. The gap until the next one grows a little.' },
  { grade: 4, when: 'Solved cleanly.', says: 'Solved cleanly.' },
  { grade: 5, when: 'Solved cleanly and quickly.', says: 'Solved cleanly and quickly. It will be a while before this one comes back.' }
])

export interface Graded {
  grade: number
  says: string
  /** Which rule decided it, for a screen that has to be able to explain itself. */
  rule: string
}

/**
 * The grade for one attempt.
 *
 * `parSeconds` is what "quickly" means for this exercise -- a number the caller knows and this file does not guess.
 * Without one, 60 seconds is used and nothing is claimed about whether that was fast for this particular puzzle.
 */
export function gradeFor(performance: Performance, parSeconds = 60): Graded {
  const at = (index: number): Graded => ({ grade: GRADE_RULES[index].grade, says: GRADE_RULES[index].says, rule: GRADE_RULES[index].when })
  if (performance.gaveUp) return at(0)
  if (!performance.solved) return at(1)
  // Solved with the move shown is not a solve. The hint ladder decides this, not the hint count.
  if (performance.worth <= 0) return at(2)
  if (performance.wrongMoves > 0 || performance.hintsUsed >= 2) return at(3)
  if (performance.hintsUsed === 0 && performance.wrongMoves === 0 && performance.seconds <= Math.max(1, parSeconds)) return at(5)
  return at(4)
}

// ---------------------------------------------------------------- scheduling

export interface Scheduled {
  card: ReviewCard
  /** Days until it comes back. */
  intervalDays: number
  grade: Graded
  /** Said plainly, including what the scheduler is and what it cannot do. */
  says: string
  /** What the scheduler itself warned about, passed through rather than swallowed. */
  warnings: readonly string[]
  /**
   * True when three attempts in a row have gone wrong.
   *
   * At that point it is not a memory problem and asking a fourth time is just unpleasant. The card still comes
   * back, and the session should offer the lesson behind it rather than the puzzle again.
   */
  needsLesson: boolean
}

const DAY = 86_400_000

/**
 * The card after an attempt.
 *
 * Everything the scheduler needs comes from the recorded attempt. Nothing is added: no estimate of how well it is
 * known, no prediction about the next one.
 */
export function afterAttempt(card: ReviewCard, performance: Performance, now: number, parSeconds?: number): Scheduled {
  const grade = gradeFor(performance, parSeconds)
  const elapsedDays = card.lastAt === null ? 0 : Math.max(0, (now - card.lastAt) / DAY)
  const report = scheduleReview({ scheduler: card.scheduler, state: card.state, grade: grade.grade, elapsedDays })

  const solvedNow = performance.solved && performance.worth > 0
  const wrongRun = solvedNow ? 0 : card.wrongRun + 1

  if (isLearningError(report)) {
    // The scheduler refused. Keep the card, bring it back tomorrow, and say so rather than inventing an interval.
    return {
      card: {
        ...card,
        dueAt: now + DAY,
        lastAt: now,
        attempts: card.attempts + 1,
        solved: card.solved + (solvedNow ? 1 : 0),
        wrongRun,
        fresh: false
      },
      intervalDays: 1,
      grade,
      says: `The scheduler could not work out an interval (${report.message}) so this comes back tomorrow.`,
      warnings: [report.message],
      needsLesson: wrongRun >= 3
    }
  }

  return {
    card: {
      ...card,
      state: report.next,
      dueAt: now + Math.round(report.interval * DAY),
      lastAt: now,
      attempts: card.attempts + 1,
      solved: card.solved + (solvedNow ? 1 : 0),
      reviews: card.reviews + (solvedNow && !card.fresh ? 1 : 0),
      lapses: card.lapses + (report.lapsed ? 1 : 0),
      wrongRun,
      fresh: false
    },
    intervalDays: report.interval,
    grade,
    says: `${grade.says} Back in ${report.interval} ${report.interval === 1 ? 'day' : 'days'} (${report.label}).`,
    warnings: report.warnings,
    needsLesson: wrongRun >= 3
  }
}

/** What the scheduler being used is, and what it cannot do. Shown wherever a schedule is shown. */
export function schedulerFacts(scheduler: Scheduler = DEFAULT_SCHEDULER): { label: string; origin: string; limitation: string } {
  const facts = SCHEDULER_FACTS[scheduler]
  return { label: facts.label, origin: facts.origin, limitation: facts.limitation }
}

/** The cards that are due, oldest first, with the ones that keep going wrong ahead of the ones that do not. */
export function due(cards: readonly ReviewCard[], now: number): ReviewCard[] {
  return cards
    .filter((card) => !card.fresh && card.dueAt <= now)
    .sort((a, b) => a.dueAt - b.dueAt || b.wrongRun - a.wrongRun || a.exerciseId.localeCompare(b.exerciseId))
}

/** Cards never attempted, in a stable order. New material, which is not the same thing as a weakness. */
export function unseen(cards: readonly ReviewCard[]): ReviewCard[] {
  return cards.filter((card) => card.fresh).sort((a, b) => a.exerciseId.localeCompare(b.exerciseId))
}

export interface SessionPlan {
  /** Due cards, in the order to do them. */
  review: readonly ReviewCard[]
  /** New cards to meet, after the reviews. */
  fresh: readonly ReviewCard[]
  /** Cards where another attempt is not the answer. */
  teach: readonly ReviewCard[]
  says: string
}

/**
 * What a sitting should contain.
 *
 * Reviews come before new material, because the whole point of a schedule is that the due thing is due. A card that
 * has gone wrong three times in a row is pulled out into `teach`: it comes back, but as the lesson behind it, not as
 * a fourth attempt at the same puzzle.
 */
export function sessionPlan(cards: readonly ReviewCard[], now: number, limits: { review?: number; fresh?: number } = {}): SessionPlan {
  const reviewLimit = Math.max(0, limits.review ?? 20)
  const freshLimit = Math.max(0, limits.fresh ?? 5)
  const allDue = due(cards, now)
  const teach = allDue.filter((card) => card.wrongRun >= 3)
  const review = allDue.filter((card) => card.wrongRun < 3).slice(0, reviewLimit)
  const fresh = unseen(cards).slice(0, freshLimit)
  const parts: string[] = []
  if (review.length) parts.push(`${review.length} to go over`)
  if (teach.length) parts.push(`${teach.length} to look at properly rather than guess again`)
  if (fresh.length) parts.push(`${fresh.length} new`)
  return {
    review,
    fresh,
    teach,
    says: parts.length ? parts.join(', ') : 'Nothing is due.'
  }
}

/**
 * How a theme is going, from the cards that train it.
 *
 * The share of attempts solved, and the number of attempts behind it, kept side by side. Two attempts and two
 * hundred attempts can both read as 0.9, and the difference matters more than the number.
 */
export interface ThemeStanding {
  theme: string
  attempts: number
  solved: number
  /** 0..1, or null when there is nothing to work it out from. */
  share: number | null
  /** Cards of this theme that are due now. */
  dueNow: number
  says: string
}

export function themeStandings(cards: readonly ReviewCard[], now: number): ThemeStanding[] {
  const byTheme = new Map<string, { attempts: number; solved: number; dueNow: number }>()
  for (const card of cards) {
    for (const theme of card.themes) {
      const held = byTheme.get(theme) ?? { attempts: 0, solved: 0, dueNow: 0 }
      held.attempts += card.attempts
      held.solved += card.solved
      held.dueNow += !card.fresh && card.dueAt <= now ? 1 : 0
      byTheme.set(theme, held)
    }
  }
  return [...byTheme.entries()]
    .map(([theme, held]) => ({
      theme,
      attempts: held.attempts,
      solved: held.solved,
      share: held.attempts > 0 ? held.solved / held.attempts : null,
      dueNow: held.dueNow,
      says: held.attempts === 0
        ? 'Not tried yet.'
        : held.attempts < 5
          ? `${held.solved} of ${held.attempts} -- too few to say much.`
          : `${held.solved} of ${held.attempts}.`
    }))
    .sort((a, b) => a.theme.localeCompare(b.theme))
}

/** The weakest themes worth practising: tried enough to mean something, and going badly. */
export function weakestThemes(cards: readonly ReviewCard[], now: number, most = 3): ThemeStanding[] {
  return themeStandings(cards, now)
    .filter((one) => one.attempts >= 5 && one.share !== null && one.share < 0.7)
    .sort((a, b) => (a.share ?? 1) - (b.share ?? 1))
    .slice(0, most)
}
