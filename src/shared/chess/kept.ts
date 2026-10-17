import { EMPTY_PLAN, type OpeningRecallRecord, type StudyPlan, type TrainingRecord } from './coach.ts'
import { emptyRepertoire, type Repertoire } from './repertoire.ts'
import { emptyStore, type PuzzleStore } from './puzzles.ts'
import { PROGRESS_VERSION, type AcademyProgress } from './academyPath.ts'
import type { Exercise } from './exercise.ts'
import type { Goal } from './challenges.ts'
import type { PuzzleRatingState } from './puzzleRating.ts'
import type { RunRecord } from './puzzleRun.ts'
import type { ReviewCard } from './spaced.ts'

/**
 * What Chess World keeps about a person, grouped the way it is kept.
 *
 * Everything in here is already modelled somewhere else in this folder -- a puzzle is `Puzzle`, an attempt is
 * `Performance`, a line is `RepertoireLine`. This file invents nothing. What it does is say which of those things
 * share a file, and it is here in `shared` rather than beside the store because three sides need the same answer:
 * the store that writes the files (`src/main/chess/data.ts`), the reader that decides what a stored record may be
 * (`src/main/chess/shapes.ts`), and the window asking across the boundary (`src/shared/types.ts`).
 *
 * The grouping is by how often something is written, not by what it is about. `data.ts` has the reasoning; the short
 * version is that each save rewrites its whole file, so something written on every move must not share a file with
 * something written once a week.
 *
 * **There is deliberately no streak here, and no list of sittings.** Both are worked out -- `streakFor` in
 * `challenges.ts` builds a run of days from the sittings, and `progress.ts` builds the sittings from the attempts,
 * the opening drills and the games, each of which is stored exactly once. A stored streak would be a second answer
 * to a question that already has one, and the only way a stale one can be wrong is in somebody's favour.
 */

// ---------------------------------------------------------------- what is being trained

export interface StoredTraining {
  /** The puzzle collection, its history, the day's challenge, and the person's own figure. */
  puzzles: PuzzleStore
  /** Exercises somebody made or brought in themselves, which are not puzzles with a rating. */
  exercises: readonly Exercise[]
  /** The review schedule over them. */
  cards: readonly ReviewCard[]
  /** One per go at one exercise, oldest first. The coach's evidence, and where the activity figures come from. */
  attempts: readonly TrainingRecord[]
  /** Each puzzle's own figure, kept apart from the puzzle so a collection can be shared without one. */
  ratings: readonly PuzzleRatingState[]
  /**
   * Finished puzzle runs -- the three-minute, five-minute and survival modes -- oldest first.
   *
   * Here rather than inside `puzzles.puzzles`'s own store for two reasons. A run is a *training record*, which is
   * what this file is for, and it sits beside `attempts` for the same reason `attempts` does: it is one row per go
   * at something. And a best score has to survive a collection being emptied and refilled, which a field inside the
   * collection would not.
   *
   * There is no stored best score. `bestRun` reads the log, so the best score and the runs behind it cannot
   * disagree -- the same reason there is no stored streak here.
   */
  runs: readonly RunRecord[]
  /**
   * What the Calculation Gym and the Blindfold screens have recorded, as the text those screens write.
   *
   * The odd one out here, and it is worth saying why rather than leaving somebody to wonder. Everything else in this
   * interface is modelled field by field, and the Gym's own records are not: `trainingView.ts` was written to read
   * and write its store **as text** (`readTraining` / `writeTraining`, with every field checked and a store it
   * cannot read never written over), and that reader is the tested one. Modelling the same records a second time
   * here would be two answers to one question.
   *
   * It is **not** `attempts`. A `TrainingRecord` cannot hold `strict` -- whether the board was kept away -- and a
   * record of blindfold work with that missing is a record of nothing. It would also have to carry a `worth`, a
   * `wrongMoves` and an `illegalTries` that these trainers never measure, and a value that was never computed is
   * never 0.
   *
   * Optional because nearly every profile will not have it. A profile that has something here which is not text is
   * reported and left exactly as it is, never written over.
   */
  view?: string
}

export const emptyTraining = (): StoredTraining => ({ puzzles: emptyStore(), exercises: [], cards: [], attempts: [], ratings: [], runs: [] })

// ---------------------------------------------------------------- the openings

export interface StoredOpenings {
  repertoire: Repertoire
  /** One per go at playing a line back from memory, oldest first. */
  recall: readonly OpeningRecallRecord[]
}

export const emptyOpenings = (): StoredOpenings => ({ repertoire: emptyRepertoire(), recall: [] })

// ---------------------------------------------------------------- the plan and the goals

export interface StoredProgress {
  /** The study plan: the coach's lines and the person's own, in the person's order. */
  plan: StudyPlan
  /** The goals this person is working to. */
  goals: readonly Goal[]
}

export const emptyProgress = (): StoredProgress => ({ plan: EMPTY_PLAN, goals: [] })

// ---------------------------------------------------------------- the Academy

/**
 * An Academy record belonging to no curriculum yet.
 *
 * `emptyProgress` in `academyPath.ts` needs the curriculum, because a record is only ever about one. The store does
 * not have one -- it holds a file, and the Academy says which curriculum it is reading when it opens -- so this is
 * the shape of "nothing has been recorded", with the curriculum left blank for the first save to fill in.
 */
export const emptyAcademy = (): AcademyProgress => ({
  version: PROGRESS_VERSION,
  curriculumId: '',
  curriculumVersion: 0,
  records: [],
  reading: [],
  cards: [],
  skipped: [],
  place: null,
  savedAt: null
})

// ---------------------------------------------------------------- how an answer about one of them reads

/**
 * An answer about one of the files Chess World keeps. The same shape for reading one and for saving one.
 *
 * `refused` is the field that matters. It is set only when **nothing was written**, which on a save means the save
 * did not happen -- so a screen that shows the value it sent without looking at this is a screen that says it saved
 * when it did not. That is worth more care than any other failure here, because nobody goes back to check.
 *
 * `notes` is everything inside the file that could not be read, in sentences meant to be shown as they are. A value
 * that silently became its default is how somebody loses a preference and never finds out which one.
 */
export interface KeptAnswer<T> {
  value: T
  notes: readonly string[]
  refused: string | null
}
