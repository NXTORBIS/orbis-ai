import type { Performance } from './attempt.ts'
import { HINT_WORTH, materialFor, playablePosition, type Exercise } from './exercise.ts'
import { legalMoves, sideToMove } from './rules.ts'

/**
 * How hard a puzzle is, how well somebody is doing, and -- mostly -- when neither can be said (Sections 077, 078).
 *
 * ## The thing this file is mainly for
 *
 * A rating is a *measurement*, and a measurement needs something to measure against. One person, a handful of
 * attempts, and a set of puzzles nobody has ever rated is not enough to produce a number, and a trainer that shows
 * one anyway is the most convincing kind of wrong: 1437 looks like it was earned.
 *
 * So the refusals come first and are deliberate:
 *
 *   - A puzzle with no rating **cannot move a person's rating**. There is nothing to compare against, so an attempt
 *     at it is recorded and changes nothing. `rateAttempt` says so in words rather than quietly skipping.
 *   - Below `ATTEMPTS_FOR_A_RATING` finished attempts a person has a *working number* and not a rating.
 *     `standingOf` returns `meansAnything: false` and the number is only there so it has somewhere to converge from.
 *   - A puzzle's own rating can only ever be "measured against you alone" here. A real puzzle rating comes from many
 *     solvers; one person's attempts give the puzzle's difficulty *for that person*, which is a different quantity
 *     and is labelled as one.
 *   - A puzzle nobody has rated gets **no estimate**. `describeDifficulty` answers the question a number would have
 *     answered badly, with facts that are counted off the board: how many legal moves there are, how many of them
 *     work, whether the move is a check or a quiet one.
 *
 * ## The formula, written down
 *
 * The arithmetic is Elo's, from Arpad Elo's 1960s rating system, and is in `RATING_MODEL.formula` as text so a
 * screen can show it without reading this file. Two deliberate departures from plain Elo:
 *
 *   - **A cap on one attempt.** `MAX_STEP` limits any single update to 32 points, so no one puzzle can move a
 *     rating by a visible fraction of itself. Plain Elo with a high K can move 40+ on one result, which for
 *     something as noisy as a single puzzle attempt is not a measurement, it is a mood.
 *   - **A score that is not win-or-lose.** A solve with the answer on screen is not a solve. The score comes from
 *     the hint ladder that `attempt.ts` already keeps (`HINT_WORTH`), reduced for wrong moves, and the rules for it
 *     are data in `OUTCOME_RULES` so they can be read rather than inferred.
 *
 * The width around the number is Glicko's starting rating deviation (350) shrunk by the square root of the attempt
 * count. It is a **convention for how much not to trust the number**, not a computed standard error -- that is said
 * in `RATING_MODEL.limits` and repeated by `standingOf`.
 *
 * Pure: no clock, no storage. `now` is always passed in.
 */

// ---------------------------------------------------------------- the numbers, written down

/** Where a person starts. Not a claim about them: a place for the arithmetic to begin. */
export const START_RATING = 1200

/** Ratings are clamped into this band. Outside it the arithmetic stops meaning anything. */
export const MIN_RATING = 400
export const MAX_RATING = 3000

/**
 * The most one attempt may move a rating, in points.
 *
 * Deliberately below the largest K, so the cap actually binds rather than sitting there as decoration: a clean solve
 * against a much harder puzzle moves 24 points and not the 32 the arithmetic wanted, and `RatingStep.capped` says so.
 */
export const MAX_STEP = 24

/** Finished attempts before the number is called a rating rather than a working figure. */
export const ATTEMPTS_FOR_A_RATING = 10

/** Attempts by one person before a puzzle's own figure is worth showing -- and even then, only for that person. */
export const ATTEMPTS_FOR_A_PUZZLE_RATING = 3

/** Glicko's starting rating deviation, used here only as a width to put around the number. */
export const START_WIDTH = 350

/**
 * How fast the rating moves, by how much history there is behind it.
 *
 * Higher early so a new rating can reach roughly the right place, lower later so it stops wandering. The steps are
 * data so a screen can show them and a test can check every one is reachable.
 */
export const K_STEPS: readonly { upToAttempts: number; k: number }[] = Object.freeze([
  { upToAttempts: 10, k: 32 },
  { upToAttempts: 30, k: 24 },
  { upToAttempts: Number.POSITIVE_INFINITY, k: 16 }
])

export function kFor(attempts: number): number {
  const done = Math.max(0, Math.trunc(attempts))
  for (const step of K_STEPS) if (done < step.upToAttempts) return step.k
  return K_STEPS[K_STEPS.length - 1].k
}

export interface RatingModelFacts {
  name: string
  origin: string
  /** Each line is one step of the arithmetic, in words a person can follow. */
  formula: readonly string[]
  /** What the model cannot do. Shown wherever a rating is shown. */
  limits: readonly string[]
}

export const RATING_MODEL: RatingModelFacts = Object.freeze({
  name: 'Elo, capped',
  origin: 'Arpad Elo’s rating system, as used for chess ratings since the 1960s. The width around the number is Glicko’s starting rating deviation of 350.',
  formula: Object.freeze([
    'Expected score against a puzzle rated P, for a person rated R: E = 1 / (1 + 10^((P − R) / 400)).',
    'The attempt scores S between 0 and 1: 0 for giving up or not solving, and for a solve the hint worth (1 with no hints, down to 0 when the move was shown) reduced by a quarter for each wrong move, with a floor of 0.25.',
    'The new rating is R + K × (S − E), rounded.',
    `K is ${K_STEPS.map((s) => `${s.k} below ${Number.isFinite(s.upToAttempts) ? s.upToAttempts : 'that'} attempts`).join(', ')}.`,
    `Whatever K says, one attempt never moves a rating by more than ${MAX_STEP} points.`,
    `The width shown around the number is ${START_WIDTH} divided by the square root of the number of attempts, rounded, and never narrower than 50.`
  ]),
  limits: Object.freeze([
    'A puzzle with no rating cannot move yours. There is nothing to compare against, so the attempt is recorded and the rating does not change.',
    `Below ${ATTEMPTS_FOR_A_RATING} finished attempts this is a working figure, not a rating. It is shown with the attempt count beside it, and never on its own.`,
    'The width is a convention for how much not to trust the number. It is not a computed error bar, and it says nothing about the spread of puzzles you have faced.',
    'A puzzle’s own figure here is measured against one person — you. A puzzle rating in the usual sense comes from thousands of solvers, and this is not that.',
    'Nothing here knows how long you thought, beyond what the attempt recorded. Time is not in the arithmetic.',
    'Puzzles made from your own games arrive with no rating at all, on purpose. Guessing one from the engine’s evaluation would be inventing a number.'
  ])
})

// ---------------------------------------------------------------- what an attempt scores

export interface OutcomeRule {
  /** When it applies, in words. The rules are tried in this order and the first match wins. */
  when: string
  says: string
}

/**
 * How a finished attempt becomes a score between 0 and 1, in order.
 *
 * Deliberately the same ladder `spaced.ts` grades against, so the rating and the review schedule cannot disagree
 * about whether something was solved.
 */
export const OUTCOME_RULES: readonly OutcomeRule[] = Object.freeze([
  { when: 'The answer was asked for.', says: 'Shown the answer, which scores nothing.' },
  { when: 'Not solved.', says: 'Not solved, which scores nothing.' },
  { when: 'Solved, but a hint had shown the move.', says: 'Solved with the move on screen, which is not a solve and scores nothing.' },
  { when: 'Solved. The score is the hint worth, less a quarter for each wrong move, floored at 0.25.', says: 'Solved.' }
])

/** How much of a quarter is taken off for each wrong move, and the floor it cannot go below. */
export const WRONG_MOVE_PENALTY = 0.25
export const SCORE_FLOOR_FOR_A_SOLVE = 0.25

export interface AttemptScore {
  /** 0..1. */
  score: number
  /** Which rule decided it, so a screen can explain itself. */
  rule: string
  says: string
}

export function scoreOf(performance: Performance): AttemptScore {
  const at = (index: number, score: number, extra?: string): AttemptScore => ({
    score,
    rule: OUTCOME_RULES[index].when,
    says: extra ? `${OUTCOME_RULES[index].says} ${extra}` : OUTCOME_RULES[index].says
  })
  if (performance.gaveUp) return at(0, 0)
  if (!performance.solved) return at(1, 0)
  // A solve reached with the move on screen is practice. `worth` is the hint ladder from attempt.ts, not a guess.
  if (performance.worth <= 0) return at(2, 0)
  const wrong = Math.max(0, Math.trunc(performance.wrongMoves))
  const raw = performance.worth - wrong * WRONG_MOVE_PENALTY
  const score = Math.max(SCORE_FLOOR_FOR_A_SOLVE, Math.min(1, raw))
  const parts: string[] = []
  if (performance.hintsUsed > 0) parts.push(`${performance.hintsUsed} ${performance.hintsUsed === 1 ? 'hint' : 'hints'}`)
  if (wrong > 0) parts.push(`${wrong} wrong ${wrong === 1 ? 'move' : 'moves'}`)
  return at(3, score, parts.length ? `Counted at ${score.toFixed(2)} after ${parts.join(' and ')}.` : 'Counted in full.')
}

// ---------------------------------------------------------------- the person

export interface RatingStep {
  at: number
  puzzleId: string
  /** The puzzle's rating the step was measured against. */
  puzzleRating: number
  score: number
  expected: number
  before: number
  after: number
  k: number
  /** True when `MAX_STEP` held the change back. */
  capped: boolean
}

export interface PersonRating {
  /** The working figure. Never shown without `standingOf` deciding whether it may be called a rating. */
  rating: number
  /** Finished attempts that moved the number -- that is, attempts at puzzles which had a rating. */
  attempts: number
  /** Finished attempts altogether, including the ones that could not be measured. */
  finished: number
  /** Attempts that changed nothing because the puzzle had no rating. */
  unmeasured: number
  lastAt: number | null
  /** The most recent steps, oldest first. Kept short on purpose: this is for showing work, not for arithmetic. */
  history: readonly RatingStep[]
}

export const HISTORY_KEPT = 50

export function newPersonRating(rating = START_RATING): PersonRating {
  return { rating: clamp(rating), attempts: 0, finished: 0, unmeasured: 0, lastAt: null, history: [] }
}

function clamp(rating: number): number {
  if (!Number.isFinite(rating)) return START_RATING
  return Math.max(MIN_RATING, Math.min(MAX_RATING, Math.round(rating)))
}

/** The Elo expectation: the share of the score a person rated `person` should take against a puzzle rated `puzzle`. */
export function expected(person: number, puzzle: number): number {
  return 1 / (1 + 10 ** ((puzzle - person) / 400))
}

export interface RatingUpdate {
  person: PersonRating
  /** Null when nothing could be measured. */
  step: RatingStep | null
  /** False when the attempt changed nothing, with `says` giving the reason. */
  measured: boolean
  score: AttemptScore
  says: string
}

/**
 * The person's figure after one finished attempt.
 *
 * `puzzleRating` is null for a puzzle nobody has rated -- which is every puzzle Orbis makes from a person's own
 * games. In that case nothing moves, and the reason is returned rather than left for the caller to work out.
 */
export function rateAttempt(
  person: PersonRating,
  puzzle: { id: string; rating: number | null },
  performance: Performance,
  now: number
): RatingUpdate {
  const score = scoreOf(performance)
  if (puzzle.rating === null || !Number.isFinite(puzzle.rating)) {
    return {
      person: { ...person, finished: person.finished + 1, unmeasured: person.unmeasured + 1, lastAt: now },
      step: null,
      measured: false,
      score,
      says: 'This puzzle has no rating, so how you did at it says nothing about yours. The attempt is recorded; the number has not moved.'
    }
  }
  const puzzleRating = clamp(puzzle.rating)
  const e = expected(person.rating, puzzleRating)
  const k = kFor(person.attempts)
  const wanted = k * (score.score - e)
  const held = Math.max(-MAX_STEP, Math.min(MAX_STEP, wanted))
  const after = clamp(person.rating + held)
  const step: RatingStep = {
    at: now,
    puzzleId: puzzle.id,
    puzzleRating,
    score: score.score,
    expected: e,
    before: person.rating,
    after,
    k,
    capped: Math.abs(wanted) > MAX_STEP
  }
  const moved = after - person.rating
  return {
    person: {
      rating: after,
      attempts: person.attempts + 1,
      finished: person.finished + 1,
      unmeasured: person.unmeasured,
      lastAt: now,
      history: [...person.history, step].slice(-HISTORY_KEPT)
    },
    step,
    measured: true,
    score,
    says: `${score.says} Against a puzzle rated ${puzzleRating}, that is ${moved === 0 ? 'no change' : `${moved > 0 ? '+' : '−'}${Math.abs(moved)}`}${step.capped ? ', held back by the cap on one attempt' : ''}.`
  }
}

export interface PersonStanding {
  rating: number
  /** Points either side of the number, as a width to distrust it by. */
  width: number
  attempts: number
  /** False below `ATTEMPTS_FOR_A_RATING` measured attempts. Then it is a working figure, not a rating. */
  meansAnything: boolean
  /** What to show: the number with its width, or a plain sentence saying there is not enough yet. */
  says: string
  /** Why it does or does not mean anything, in one sentence. */
  why: string
}

/** The width to put around a figure: wide until there is history behind it. */
export function confidenceWidth(attempts: number): number {
  const done = Math.max(0, Math.trunc(attempts))
  if (done === 0) return START_WIDTH
  return Math.max(50, Math.round(START_WIDTH / Math.sqrt(done)))
}

/**
 * What may be said about a person's figure.
 *
 * The refusal is the point. Nine attempts produce a sentence about not having enough history, with the number still
 * available in `rating` for anybody who wants to show it as the working figure it is.
 */
export function standingOf(person: PersonRating): PersonStanding {
  const width = confidenceWidth(person.attempts)
  const enough = person.attempts >= ATTEMPTS_FOR_A_RATING
  const short = ATTEMPTS_FOR_A_RATING - person.attempts
  return {
    rating: person.rating,
    width,
    attempts: person.attempts,
    meansAnything: enough,
    says: enough
      ? `${person.rating}, give or take about ${width}, from ${person.attempts} ${person.attempts === 1 ? 'attempt' : 'attempts'}.`
      : person.attempts === 0
        ? person.unmeasured > 0
          ? `No rating yet. ${person.unmeasured} ${person.unmeasured === 1 ? 'attempt has' : 'attempts have'} been recorded, and none of those puzzles had a rating to measure against.`
          : 'No rating yet. Nothing has been attempted.'
        : `Not enough yet to call it a rating: ${person.attempts} of ${ATTEMPTS_FOR_A_RATING} ${short === 1 ? 'attempt' : 'attempts'} needed, ${short} to go.`,
    why: enough
      ? `Based on ${person.attempts} attempts at puzzles that had a rating. The width is a convention, not a measured error.`
      : `One attempt, or a few, cannot tell a 1200 from a 1500. The figure moves by at most ${MAX_STEP} points an attempt, so it needs ${ATTEMPTS_FOR_A_RATING} of them before it is worth reading.`
  }
}

// ---------------------------------------------------------------- the puzzle's own figure

export interface PuzzleRatingState {
  puzzleId: string
  /** Null until something has given it one. */
  rating: number | null
  /** Where the number came from. Null when there is none. */
  from: 'source' | 'measured' | null
  /** Attempts at it by this person. */
  attempts: number
}

export function newPuzzleRating(puzzleId: string, fromSource: number | null = null): PuzzleRatingState {
  return {
    puzzleId,
    rating: fromSource === null || !Number.isFinite(fromSource) ? null : clamp(fromSource),
    from: fromSource === null || !Number.isFinite(fromSource) ? null : 'source',
    attempts: 0
  }
}

export interface PuzzleRatingUpdate {
  state: PuzzleRatingState
  /** False when nothing could be measured. */
  measured: boolean
  says: string
}

/**
 * A puzzle's figure after somebody attempted it.
 *
 * It moves the opposite way to the person, which is what Elo does. What it is **not** is a puzzle rating in the
 * usual sense: that needs many solvers, and here there is one. A figure from a source is never overwritten by this.
 */
export function ratePuzzleFromAttempt(
  state: PuzzleRatingState,
  person: PersonRating,
  performance: Performance
): PuzzleRatingUpdate {
  const attempts = state.attempts + 1
  if (state.from === 'source') {
    return {
      state: { ...state, attempts },
      measured: false,
      says: 'This puzzle came with a rating from its source, which your attempts do not overwrite.'
    }
  }
  if (state.rating === null) {
    // Nothing to move. A first attempt cannot establish a difficulty: it would just be the person's own rating back.
    return {
      state: { ...state, attempts },
      measured: false,
      says: attempts < ATTEMPTS_FOR_A_PUZZLE_RATING
        ? `No rating for this puzzle. ${attempts} of ${ATTEMPTS_FOR_A_PUZZLE_RATING} attempts needed before even a rough one, and with one solver it would only ever be how hard it is for you.`
        : 'No rating for this puzzle. A difficulty measured from one person’s attempts is not a puzzle rating, so none is shown.'
    }
  }
  const score = scoreOf(performance)
  const e = 1 - expected(person.rating, state.rating)
  const k = kFor(state.attempts)
  const wanted = k * ((1 - score.score) - e)
  const held = Math.max(-MAX_STEP, Math.min(MAX_STEP, wanted))
  return {
    state: { ...state, rating: clamp(state.rating + held), from: 'measured', attempts },
    measured: true,
    says: 'Moved by your attempt. This is how hard it has been for you, not a rating from many solvers.'
  }
}

// ---------------------------------------------------------------- difficulty without a number

export interface Difficulty {
  /** Counted off the board. Every line is a fact, not a judgement. */
  facts: readonly string[]
  /** Always null here. Nothing in this function invents a rating. */
  rating: null
  /** The facts in a sentence or two. */
  says: string
}

/**
 * What can be said about how hard a puzzle is, without a rating.
 *
 * This exists because the honest answer to "how hard is this one?" for a puzzle nobody has rated is not a number --
 * it is how much there is to look through and how much of it works. All of that is counted from the position.
 */
export function describeDifficulty(exercise: Exercise): Difficulty {
  const facts: string[] = []
  if (!playablePosition(exercise.startFen).ok) {
    return { facts: Object.freeze(['The position cannot be loaded, so nothing can be counted from it.']), rating: null, says: 'The position cannot be loaded.' }
  }
  const moves = legalMoves(exercise.startFen)
  const side = sideToMove(exercise.startFen)
  const answers = exercise.solution.lines.length
  facts.push(`${moves.length} legal ${moves.length === 1 ? 'move' : 'moves'} in the position.`)
  if (answers > 0) facts.push(`${answers} of them ${answers === 1 ? 'is' : 'are'} recorded as working.`)
  if (exercise.objective === 'mate-in-n' && exercise.movesToMate !== undefined) {
    facts.push(`A forced mate in ${exercise.movesToMate}, so there are ${exercise.movesToMate === 1 ? 'no replies to answer' : 'replies to answer along the way'}.`)
  }
  if (exercise.objective === 'win-material' && exercise.materialAtLeast !== undefined) {
    facts.push(`Material to be won: at least ${exercise.materialAtLeast} centipawns by the end of the line.`)
  }
  // What kind of move is wanted. A quiet move is harder to find than a check, and that is a fact about the move.
  const first = exercise.solution.lines
    .map((line) => legalMoves(exercise.startFen).find((m) => m.san === line.move || m.uci === line.move) ?? null)
    .filter((m): m is NonNullable<typeof m> => m !== null)
  if (first.length > 0) {
    const allChecks = first.every((m) => m.check)
    const allCaptures = first.every((m) => Boolean(m.captured))
    const noneLoud = first.every((m) => !m.check && !m.captured)
    if (allChecks) facts.push(answers === 1 ? 'The move is a check.' : 'Every move that works is a check.')
    else if (allCaptures) facts.push(answers === 1 ? 'The move is a capture.' : 'Every move that works is a capture.')
    else if (noneLoud) facts.push(answers === 1 ? 'The move gives no check and takes nothing.' : 'None of the moves that work gives a check or takes anything.')
  }
  const material = materialFor(exercise.startFen, 'w') + materialFor(exercise.startFen, 'b')
  facts.push(`${material} centipawns of material on the board altogether.`)
  facts.push(`${side === 'w' ? 'White' : 'Black'} to play.`)
  return {
    facts: Object.freeze(facts),
    rating: null,
    says: `No rating: nobody has rated this one. ${facts.slice(0, 3).join(' ')}`
  }
}

/** The hint ladder's worths, passed through so a screen showing the rating can show what a hint costs. */
export const HINT_COST: Readonly<Record<string, number>> = HINT_WORTH
