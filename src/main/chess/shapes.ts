import { PROGRESS_VERSION, RECORD_CAP, type AcademyPlace, type AcademyProgress } from '../../shared/chess/academyPath.ts'
import { ACTIVITIES, type ActivityKind, type OpeningRecallRecord, type PlanItem, type StudyPlan, type TrainingRecord } from '../../shared/chess/coach.ts'
import { MEASURE_KINDS, makeGoal, type Goal, type GoalMeasure, type PeriodKind } from '../../shared/chess/challenges.ts'
import { DEFAULT_SCHEDULER, type ReviewCard } from '../../shared/chess/spaced.ts'
import { MAX_RATING, MIN_RATING, type PuzzleRatingState } from '../../shared/chess/puzzleRating.ts'
import { SCHEDULERS, type Scheduler } from '../../shared/compute/learning.ts'
import { readStore } from '../../shared/chess/puzzles.ts'
import { RUNS_KEPT, readRunRow, type RunRecord } from '../../shared/chess/puzzleRun.ts'
import type { Repertoire, RepertoireLine } from '../../shared/chess/repertoire.ts'
import { readChessSettings, describeFallback, type ChessSettings, type GroupId } from '../../shared/chess/settings.ts'
import {
  emptyAcademy, emptyOpenings, emptyProgress, emptyTraining,
  type StoredOpenings, type StoredProgress, type StoredTraining
} from '../../shared/chess/kept.ts'
import { STUDY_CAPS, emptyStudies, readStudy, type StoredStudies, type StoredStudy } from '../../shared/chess/study.ts'
import type { ExerciseKind, Exercise } from '../../shared/chess/exercise.ts'
import type { LessonReading } from '../../shared/chess/lessons.ts'
import type { Performance } from '../../shared/chess/attempt.ts'
import type { Side } from '../../shared/chess/evaluation.ts'

/**
 * What a kept piece of Chess World may be, and how one is read back off the disk.
 *
 * Everything Chess World remembers apart from the games -- the preferences, the puzzle collection and its history,
 * the repertoire, the Academy record, the study plan -- comes through here on the way in and on the way out. It is
 * pure: no files, no clock beyond a `now` that is always passed in, no Electron, so every rule below can be tested
 * on its own.
 *
 * ## The one rule the rest of this file is in service of
 *
 * **Something that could not be read is never replaced with something empty.** These files hold months of somebody's
 * training. "Your puzzles came back empty" and "your puzzles are gone" are the same sentence to the person who lost
 * them, so the reading is split three ways and only the middle one is ever a repair:
 *
 *   - **The file is not a Chess World file at all** -- not an object, or a part of it that the whole thing hangs on
 *     is missing, or it was written by a newer Orbis. The reader *throws*, which is how `storedFile.ts` is told the
 *     file is damaged: it moves the file aside under its own name with the time on it, so the words are still on the
 *     disk, and starts a fresh one. Nothing is deleted and nothing is written over.
 *   - **One record inside it cannot be read.** That record is left out and said out loud. It never takes the four
 *     hundred beside it with it.
 *   - **One value inside one record is impossible.** That value falls back and is said out loud. It costs that one
 *     value -- not the record, and certainly not the file.
 *
 * ## Why a record keeps fields this store has never heard of
 *
 * Every reader below spreads the stored record first and then puts back only the handful of fields the store itself
 * depends on. That is deliberate. A reader built the other way round -- naming every field it knows and dropping the
 * rest -- deletes part of somebody's record the first time a shape grows, and worse, deletes it *quietly*: the next
 * save writes the shortened version back over the full one. Keeping what it did not recognise means a validator
 * getting stricter, or an older Orbis opening a newer profile, costs nothing.
 *
 * It also means this file is not the authority on what any of these records *mean*. `exercise.ts` decides whether an
 * exercise is sound, `settings.ts` decides what a setting may be, `academyPath.ts` decides what a progress record may
 * claim, and each of them is asked again where the record is used. This file checks that a record can be identified
 * and that the few numbers it sorts and caps by are numbers, and keeps the rest exactly as it was stored.
 *
 * Which records share which file is `shared/chess/kept.ts`, so the window and the store read the same answer.
 */

// ---------------------------------------------------------------- the small checks

const isObject = (raw: unknown): raw is Record<string, unknown> => typeof raw === 'object' && raw !== null && !Array.isArray(raw)

const text = (raw: unknown, max: number): string | null => (typeof raw === 'string' && raw.trim() !== '' ? raw.slice(0, max) : null)

const num = (raw: unknown): number | null => (typeof raw === 'number' && Number.isFinite(raw) ? raw : null)

/** A whole number that is never negative, for a tally. */
const count = (raw: unknown): number => Math.max(0, Math.round(num(raw) ?? 0))

const strings = (raw: unknown, max: number): string[] =>
  Array.isArray(raw) ? raw.filter((one): one is string => typeof one === 'string').slice(0, max) : []

/**
 * A list of records, read one at a time.
 *
 * A row that cannot be identified is left out and counted. The cap is here rather than left to grow because these
 * files are read whole on every launch, and it is said out loud when it bites: a cap that quietly deletes the oldest
 * half of somebody's history is the same bug as a reader that quietly drops a field.
 */
function records<T>(
  raw: unknown,
  what: string,
  read: (row: Record<string, unknown>) => T | null,
  notes: string[],
  cap: number
): T[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) {
    notes.push(`The saved ${what} were not a list, so they have been left out. Everything else in the file was kept.`)
    return []
  }
  const out: T[] = []
  let lost = 0
  for (const row of raw) {
    const one = isObject(row) ? read(row) : null
    if (one === null) lost += 1
    else out.push(one)
  }
  if (lost > 0) notes.push(`${lost} saved ${what} could not be read and were left out. Everything else was kept.`)
  if (out.length > cap) {
    notes.push(`There are ${out.length} ${what} and ${cap} is as many as are kept, so the earliest ${out.length - cap} were left out.`)
    return out.slice(out.length - cap)
  }
  return out
}

/** How many of each are kept. Written down here so a screen can say so rather than somebody discovering it. */
export const KEPT = Object.freeze({
  /** One per go at one exercise. The coach reads these, and `RECORD_CAP` is what the Academy already keeps. */
  attempts: RECORD_CAP,
  exercises: 4000,
  cards: 8000,
  ratings: 20_000,
  /** Finished puzzle runs. `puzzleRun.ts` owns the number, because `bestRun` reads what is kept. */
  runs: RUNS_KEPT,
  lines: 2000,
  recalls: RECORD_CAP,
  goals: 60,
  planItems: 200,
  reading: 2000,
  skipped: 2000
})

// ---------------------------------------------------------------- the preferences

/**
 * The preferences, read back field by field.
 *
 * `readChessSettings` does the deciding -- it is the one place that knows what each setting may be, and it already
 * reports every value that had to fall back with the sentence to show somebody. All this adds is the two things a
 * store has to do that a pure reader cannot:
 *
 * It **throws** when the file is not a set of settings at all, so the file is moved aside rather than replaced. And
 * it puts back anything in the file this version does not recognise, so a preference a newer Orbis wrote survives
 * being opened by an older one.
 */
export function readSettingsFile(raw: unknown): { value: ChessSettings; notes: string[] } {
  const read = readChessSettings(raw)
  if (read.wholeFileUnreadable) {
    throw new Error('the saved chess settings were not a set of settings')
  }
  return { value: withUnknownSettings(raw, read.settings), notes: read.fallbacks.map(describeFallback) }
}

/** The checked settings, with anything else that was in the file put back around them. */
function withUnknownSettings(raw: unknown, clean: ChessSettings): ChessSettings {
  if (!isObject(raw)) return clean
  const out: Record<string, unknown> = { ...raw }
  for (const group of Object.keys(clean) as GroupId[]) {
    const stored = raw[group]
    out[group] = isObject(stored) ? { ...stored, ...clean[group] } : clean[group]
  }
  return out as unknown as ChessSettings
}

// ---------------------------------------------------------------- one attempt

/**
 * What one go at one exercise left behind.
 *
 * `worth` is the one field with a deflating fallback, and it is deliberate: it says how much of the answer was
 * somebody's own after the hints they took, so a record that has lost it is read as *no credit*. Reading it as a
 * full solve would mark a lesson finished on the strength of a record nobody could read. `academyPath.ts` makes the
 * same choice for the same reason.
 */
function performance(row: Record<string, unknown>): Performance | null {
  const exerciseId = text(row.exerciseId, 160)
  const at = num(row.at)
  if (exerciseId === null || at === null) return null
  const fixed: Performance = {
    exerciseId,
    solved: row.solved === true,
    gaveUp: row.gaveUp === true,
    hintsUsed: count(row.hintsUsed),
    worth: Math.min(1, Math.max(0, num(row.worth) ?? 0)),
    wrongMoves: count(row.wrongMoves),
    illegalTries: count(row.illegalTries),
    seconds: count(row.seconds),
    at
  }
  return { ...row, ...fixed } as Performance
}

const EXERCISE_KINDS: readonly ExerciseKind[] = Object.freeze(['puzzle', 'lesson-task', 'calculation', 'blindfold', 'endgame', 'recall'])

/** One attempt with what the exercise was for, which is what makes it evidence the coach can read. */
function trainingRecord(row: Record<string, unknown>, notes: string[]): TrainingRecord | null {
  const inner = isObject(row.performance) ? performance(row.performance) : null
  if (inner === null) return null
  const stored = row.kind
  const kind: ExerciseKind = EXERCISE_KINDS.includes(stored as ExerciseKind) ? (stored as ExerciseKind) : 'puzzle'
  if (stored !== undefined && stored !== kind) {
    notes.push(`An attempt at "${inner.exerciseId}" was recorded against a kind of exercise Orbis does not have, so it counts as a puzzle. The attempt itself was kept.`)
  }
  const fixed: TrainingRecord = { performance: inner, kind, themes: strings(row.themes, 16) }
  return { ...row, ...fixed } as TrainingRecord
}

// ---------------------------------------------------------------- the review schedule

/**
 * One card in the review schedule.
 *
 * `state` is the scheduler's own working, and it is kept as it was on purpose: `spaced.ts` says plainly that it does
 * not do the arithmetic, so neither does this. Only `interval` is checked, because that is the one field every
 * scheduler has and the one a session is built from.
 */
function reviewCard(row: Record<string, unknown>, notes: string[], now: number): ReviewCard | null {
  const exerciseId = text(row.exerciseId, 160)
  if (exerciseId === null) return null
  const stored = row.scheduler
  const scheduler: Scheduler = SCHEDULERS.includes(stored as Scheduler) ? (stored as Scheduler) : DEFAULT_SCHEDULER
  if (stored !== undefined && stored !== scheduler) {
    notes.push(`The review card for "${exerciseId}" named a review schedule Orbis does not have, so it is on ${DEFAULT_SCHEDULER}. Everything else about the card was kept.`)
  }
  const state = isObject(row.state) ? row.state : {}
  const fixed: ReviewCard = {
    exerciseId,
    themes: strings(row.themes, 16),
    scheduler,
    state: { ...state, interval: Math.max(0, num(state.interval) ?? 0) } as ReviewCard['state'],
    // A card with no date on it is one to do now, rather than one dated the start of 1970 that jumps the queue.
    dueAt: num(row.dueAt) ?? now,
    lastAt: num(row.lastAt),
    attempts: count(row.attempts),
    solved: count(row.solved),
    reviews: count(row.reviews),
    lapses: count(row.lapses),
    wrongRun: count(row.wrongRun),
    // No flag, but attempts behind it: it has plainly been seen, so it is not new material.
    fresh: typeof row.fresh === 'boolean' ? row.fresh : count(row.attempts) === 0
  }
  return { ...row, ...fixed } as ReviewCard
}

// ---------------------------------------------------------------- what is being trained

/**
 * The puzzle rating of one puzzle.
 *
 * A number outside what a rating can be costs the number, not the record: the attempts behind it are still worth
 * knowing, and a puzzle with no figure is an ordinary state this code already has a word for.
 */
function puzzleRating(row: Record<string, unknown>, notes: string[]): PuzzleRatingState | null {
  const puzzleId = text(row.puzzleId, 160)
  if (puzzleId === null) return null
  const stored = num(row.rating)
  const rating: number | null = stored === null ? null : Math.round(Math.min(MAX_RATING, Math.max(MIN_RATING, stored)))
  if (stored !== null && rating !== Math.round(stored)) {
    notes.push(`The rating saved for puzzle "${puzzleId}" was ${stored}, and a rating is between ${MIN_RATING} and ${MAX_RATING}, so ${rating} is being used. The attempts at it were kept.`)
  }
  if (stored === null && row.rating !== undefined && row.rating !== null) {
    notes.push(`The rating saved for puzzle "${puzzleId}" was not a number, so it has none. The attempts at it were kept.`)
  }
  const fixed: PuzzleRatingState = {
    puzzleId,
    rating,
    from: rating === null ? null : row.from === 'source' || row.from === 'measured' ? row.from : 'measured',
    attempts: count(row.attempts)
  }
  return { ...row, ...fixed } as PuzzleRatingState
}

/**
 * Everything being trained, read back.
 *
 * The collection itself goes through `readStore`, which is the one place that knows what a puzzle is -- and which
 * already tells "there is nothing here" apart from "there is something here I cannot read". The second of those is
 * thrown from here, so the file is moved aside rather than started again empty.
 */
export function readTrainingFile(raw: unknown, now: number): { value: StoredTraining; notes: string[] } {
  if (raw === null || raw === undefined) return { value: emptyTraining(), notes: [] }
  if (!isObject(raw)) throw new Error('what was saved is not a set of training records')
  const notes: string[] = []

  const read = readStore(raw.puzzles ?? null)
  if (read.kind === 'unreadable') throw new Error(read.says)
  if (read.kind === 'ok') notes.push(...read.dropped)

  const value: StoredTraining = {
    puzzles: read.store,
    // An exercise is kept whenever it can be named. Whether it is a sound exercise is `validateExercise`'s question
    // and it is asked where the exercise is used: asking it here would mean a tightening in `exercise.ts` deleting
    // somebody's saved work on the next launch, which is not a repair.
    exercises: records<Exercise>(raw.exercises, 'exercises', (row) => (text(row.id, 160) === null ? null : (row as unknown as Exercise)), notes, KEPT.exercises),
    cards: records<ReviewCard>(raw.cards, 'review cards', (row) => reviewCard(row, notes, now), notes, KEPT.cards),
    attempts: records<TrainingRecord>(raw.attempts, 'attempt records', (row) => trainingRecord(row, notes), notes, KEPT.attempts),
    ratings: records<PuzzleRatingState>(raw.ratings, 'puzzle ratings', (row) => puzzleRating(row, notes), notes, KEPT.ratings),
    // What a run may be is `puzzleRun.ts`'s judgement, beside the type, the way `readStore` keeps the collection's.
    // A row it will not read is left out and said out loud rather than turned into a run that scored nothing.
    runs: records<RunRecord>(raw.runs, 'puzzle runs', (row) => readRunRow(row), notes, KEPT.runs)
  }
  return { value: { ...raw, ...value } as StoredTraining, notes }
}

// ---------------------------------------------------------------- the openings

const side = (raw: unknown): Side | null => (raw === 'w' || raw === 'b' ? raw : null)

/**
 * One line of a repertoire.
 *
 * The moves are kept as they were stored rather than replayed. A line is entered through `addLine` in
 * `repertoire.ts`, which plays every move against the rules before it is a line at all, so the checking has already
 * happened on the way in -- and replaying it here would mean a position somebody saved last year disappearing
 * because the rules module changed its mind about a move. Which side's book it belongs to is the one field this
 * store sorts by, so that is the one it insists on.
 */
function repertoireLine(row: Record<string, unknown>, notes: string[]): RepertoireLine | null {
  const id = text(row.id, 160)
  const which = side(row.side)
  if (id === null) return null
  if (which === null) {
    notes.push('A repertoire line did not say whether it was for White or Black, so it could not be put in either book. It has been left out.')
    return null
  }
  const fixed: RepertoireLine = {
    id,
    side: which,
    name: text(row.name, 200) ?? 'An unnamed line',
    startFen: text(row.startFen, 120) ?? '',
    moves: Array.isArray(row.moves) ? (row.moves as RepertoireLine['moves']) : [],
    createdAt: num(row.createdAt) ?? 0,
    updatedAt: num(row.updatedAt) ?? num(row.createdAt) ?? 0
  }
  return { ...row, ...fixed } as RepertoireLine
}

/** One go at playing a line back from memory. */
function recallRecord(row: Record<string, unknown>): OpeningRecallRecord | null {
  const name = text(row.name, 200)
  const at = num(row.at)
  const which = side(row.side)
  if (name === null || at === null || which === null) return null
  const length = count(row.length)
  const fixed: OpeningRecallRecord = {
    name,
    side: which,
    // More moves right than the line is long is not something that happened, so it is held to the line's length.
    correct: Math.min(length, count(row.correct)),
    length,
    complete: row.complete === true,
    at
  }
  return { ...row, ...fixed } as OpeningRecallRecord
}

export function readOpeningsFile(raw: unknown, _now: number): { value: StoredOpenings; notes: string[] } {
  if (raw === null || raw === undefined) return { value: emptyOpenings(), notes: [] }
  if (!isObject(raw)) throw new Error('what was saved is not a repertoire')
  const notes: string[] = []
  const book = isObject(raw.repertoire) ? raw.repertoire : {}
  const value: StoredOpenings = {
    repertoire: { ...book, lines: records<RepertoireLine>(book.lines, 'repertoire lines', (row) => repertoireLine(row, notes), notes, KEPT.lines) } as Repertoire,
    recall: records<OpeningRecallRecord>(raw.recall, 'opening drills', recallRecord, notes, KEPT.recalls)
  }
  if (raw.repertoire !== undefined && !isObject(raw.repertoire)) {
    notes.push('The saved repertoire was not a repertoire, so both books are empty. Everything else in the file was kept.')
  }
  return { value: { ...raw, ...value } as StoredOpenings, notes }
}

// ---------------------------------------------------------------- the Academy

function lessonReading(row: Record<string, unknown>): LessonReading | null {
  const lessonId = text(row.lessonId, 160)
  if (lessonId === null) return null
  const fixed: LessonReading = {
    lessonId,
    atBlock: count(row.atBlock),
    seconds: count(row.seconds),
    visits: count(row.visits),
    firstAt: num(row.firstAt),
    lastAt: num(row.lastAt)
  }
  return { ...row, ...fixed } as LessonReading
}

/**
 * The Academy record, read back.
 *
 * Deliberately **not** `readProgress` from `academyPath.ts`, and this is the one place in this file where that is
 * worth spelling out. That reader needs the curriculum, because its job is to drop records whose lesson or task the
 * curriculum no longer has. That is the right thing to do on the screen, where the curriculum is to hand and a
 * dangling id would point at nothing -- and the wrong thing to do in a store, where it would mean a lesson being
 * renamed deleting the attempts somebody made at it. So the store keeps the record whole and the Academy asks
 * `readProgress` about it when it opens, which is where the curriculum lives.
 *
 * A record written by a newer Orbis is thrown rather than read, because reading it would mean writing a worse copy
 * back the next time somebody finished a lesson.
 */
export function readAcademyFile(raw: unknown, now: number): { value: AcademyProgress; notes: string[] } {
  if (raw === null || raw === undefined) return { value: emptyAcademy(), notes: [] }
  if (!isObject(raw)) throw new Error('what was saved is not an Academy record')
  const version = num(raw.version)
  if (version !== null && version > PROGRESS_VERSION) {
    throw new Error(`the Academy record was written by a newer Orbis (version ${version}, and this one reads ${PROGRESS_VERSION})`)
  }
  const notes: string[] = []
  const place = isObject(raw.place) ? raw.place : null
  const where = place === null ? null : text(place.lessonId, 160)
  const value: AcademyProgress = {
    version: PROGRESS_VERSION,
    curriculumId: text(raw.curriculumId, 160) ?? '',
    curriculumVersion: num(raw.curriculumVersion) ?? 0,
    records: records<Performance>(raw.records, 'attempt records', performance, notes, KEPT.attempts),
    reading: records<LessonReading>(raw.reading, 'reading records', lessonReading, notes, KEPT.reading),
    cards: records<ReviewCard>(raw.cards, 'review cards', (row) => reviewCard(row, notes, now), notes, KEPT.cards),
    // Lessons somebody said they already know. A duplicate is the same claim twice, so it is only kept once.
    skipped: [...new Set(strings(raw.skipped, KEPT.skipped))],
    // Where somebody left off. Dropped rather than guessed at when the lesson is not named: an Academy that opens at
    // the wrong lesson is worse than one that opens at the start and says nothing.
    place: place === null || where === null ? null : ({ ...place, lessonId: where, block: count(place.block) } as AcademyPlace),
    savedAt: num(raw.savedAt)
  }
  if (raw.skipped !== undefined && !Array.isArray(raw.skipped)) {
    notes.push('The list of lessons you had marked as already known was not a list, so nothing is marked. Everything else was kept.')
  }
  return { value: { ...raw, ...value } as AcademyProgress, notes }
}

// ---------------------------------------------------------------- the plan and the goals

const ACTIVITY_KINDS: readonly string[] = Object.freeze(Object.keys(ACTIVITIES))

/** One line of the study plan. A coach line says which weakness it answers; a person's line says nothing. */
function planItem(row: Record<string, unknown>, notes: string[]): PlanItem | null {
  const id = text(row.id, 160)
  const title = text(row.title, 400)
  if (id === null || title === null) return null
  const stored = row.activity
  const activity = (ACTIVITY_KINDS.includes(stored as string) ? stored : 'puzzle') as ActivityKind
  if (stored !== undefined && stored !== activity) {
    notes.push(`"${title}" in your study plan named something to do that Orbis does not have, so it is down as puzzles. The line itself was kept.`)
  }
  const fixed: PlanItem = {
    id,
    from: row.from === 'coach' ? 'coach' : 'person',
    title,
    what: text(row.what, 2000) ?? '',
    activity,
    order: num(row.order) ?? 0,
    dismissed: row.dismissed === true,
    addedAt: num(row.addedAt) ?? 0
  }
  return { ...row, ...fixed } as PlanItem
}

/**
 * One goal.
 *
 * Rebuilt through `makeGoal` rather than taken as it was stored, because a goal carries the sentence saying exactly
 * how it is counted and `challenges.ts` writes that sentence *from* the measure. Trusting a stored sentence would
 * let a goal say it wants ten clean solves while counting any ten attempts, which is the one thing a goal must never
 * be able to do.
 */
function goal(row: Record<string, unknown>, notes: string[]): Goal | null {
  const id = text(row.id, 160)
  const label = text(row.label, 200)
  const measure = isObject(row.measure) ? row.measure : null
  if (id === null || label === null || measure === null) return null
  if (!MEASURE_KINDS.includes(measure.kind as GoalMeasure['kind'])) {
    notes.push(`The goal "${label}" counts something Orbis cannot count, so it has been left out. Nothing else was touched.`)
    return null
  }
  const activities = Array.isArray(measure.activities)
    ? measure.activities.filter((one): one is ActivityKind => typeof one === 'string' && ACTIVITY_KINDS.includes(one))
    : null
  const target = num(row.target)
  if (target === null || target < 1) {
    notes.push(`The goal "${label}" asked for ${target === null ? 'something that is not a number' : target}, so one is being used instead. The goal itself was kept.`)
  }
  const period: PeriodKind = row.period === 'week' ? 'week' : 'day'
  if (row.period !== undefined && row.period !== period) {
    notes.push(`The goal "${label}" was set over something other than a day or a week, so it is a daily goal. Everything else about it was kept.`)
  }
  const made = makeGoal({
    id,
    label,
    period,
    target: Math.max(1, Math.round(target ?? 1)),
    measure: { kind: measure.kind, ...(activities ? { activities } : {}) } as GoalMeasure
  })
  // Rebuilt last, so a stale `rule` stored beside an older measure is replaced rather than believed -- and anything
  // else somebody or a later Orbis put on the goal still comes through.
  return { ...row, ...made } as Goal
}

/**
 * The plan and the goals.
 *
 * There is deliberately no streak in this file, and no run of days, and no achievement. Every one of those is worked
 * out from the sittings -- `streakFor` and `achievementStanding` in `challenges.ts` -- and a stored copy would be a
 * second answer to a question that already has one. Two answers that can disagree is worse than one answer that
 * takes a moment, and the only way a stored streak can be wrong is in somebody's favour, which is the way that makes
 * the whole screen worth nothing.
 *
 * The sittings themselves are not here either, for the same reason: `progress.ts` builds them out of the attempts,
 * the opening drills and the games, all of which are stored once each.
 */
export function readProgressFile(raw: unknown, _now: number): { value: StoredProgress; notes: string[] } {
  if (raw === null || raw === undefined) return { value: emptyProgress(), notes: [] }
  if (!isObject(raw)) throw new Error('what was saved is not a study plan')
  const notes: string[] = []
  const plan = isObject(raw.plan) ? raw.plan : {}
  const value: StoredProgress = {
    plan: {
      ...plan,
      items: records<PlanItem>(plan.items, 'study plan lines', (row) => planItem(row, notes), notes, KEPT.planItems),
      updatedAt: num(plan.updatedAt) ?? 0
    } as StudyPlan,
    goals: records<Goal>(raw.goals, 'goals', (row) => goal(row, notes), notes, KEPT.goals)
  }
  if (raw.plan !== undefined && !isObject(raw.plan)) {
    notes.push('The saved study plan was not a study plan, so it is empty. Everything else in the file was kept.')
  }
  return { value: { ...raw, ...value } as StoredProgress, notes }
}

// ---------------------------------------------------------------- the analyses

/**
 * Everything somebody has worked out about their games, read back.
 *
 * `readStudy` in `shared/chess/study.ts` decides what one analysis may be, because the window reads the same records
 * and there must be one answer. All this adds is the two things only a store does: it **throws** when the file is
 * not a set of analyses at all, so the file is moved aside with the words still on the disk rather than replaced;
 * and one analysis that cannot be read is left out and said out loud instead of taking the other hundred with it.
 *
 * One analysis that could not be read must also never cost the game it was about. It cannot here, because the games
 * are a different file -- but it is worth saying, because the whole reason this is its own file is that somebody who
 * loses a note must not also lose the game the note was about.
 */
export function readStudiesFile(raw: unknown, _now: number): { value: StoredStudies; notes: string[] } {
  if (raw === null || raw === undefined) return { value: emptyStudies(), notes: [] }
  if (!isObject(raw)) throw new Error('what was saved is not a set of saved analyses')
  // The analyses are the whole of this file, so a file whose analyses are not analyses is not this file at all: it
  // is thrown, which is how it comes to be moved aside under its own name with the words still on the disk, rather
  // than written over with an empty one.
  if (raw.studies !== undefined && !isObject(raw.studies)) {
    throw new Error('what was saved is not a set of saved analyses')
  }
  const notes: string[] = []
  const held = isObject(raw.studies) ? raw.studies : {}
  const studies: Record<string, StoredStudy> = {}
  /*
   * One that could not be read is put aside rather than dropped.
   *
   * Dropping it would be quiet deletion on the next save: this file is written whole, so a record left out of the
   * read is a record gone from the disk the next time somebody writes a note about any other game. `unread` is
   * carried through untouched, and it is the one case a record written by a newer Orbis lands in -- the words stay
   * on the disk so that Orbis can have them back.
   */
  const parked: Record<string, unknown> = isObject(raw.unread) ? { ...raw.unread } : {}
  let lost = 0
  for (const [key, value] of Object.entries(held)) {
    const read = readStudy(value)
    notes.push(...read.notes)
    if (!read.study) {
      parked[key] = value
      lost += 1
      continue
    }
    // The key is the game id. A record filed under a different game than it names cannot be trusted to be about
    // either, so it is kept under the game it names and the disagreement is said rather than quietly resolved.
    if (read.study.gameId !== key) {
      notes.push(`A saved analysis was filed under game ${key} but says it is about game ${read.study.gameId}. It has been kept with the game it names.`)
    }
    studies[read.study.gameId] = read.study
  }
  if (lost > 0) {
    notes.push(`${lost} saved analys${lost === 1 ? 'is' : 'es'} could not be read and ${lost === 1 ? 'has' : 'have'} been put aside in the same file rather than dropped. The games themselves are in a different file and are untouched.`)
  }
  const unread = Object.keys(parked).length ? { unread: parked } : {}
  const ids = Object.keys(studies)
  if (ids.length > STUDY_CAPS.studies) {
    // The newest are read and the rest are put aside in the same way, so this cap cannot delete anything either.
    const order = ids.sort((a, b) => (studies[b].savedAt ?? 0) - (studies[a].savedAt ?? 0))
    const kept: Record<string, StoredStudy> = {}
    for (const id of order.slice(0, STUDY_CAPS.studies)) kept[id] = studies[id]
    for (const id of order.slice(STUDY_CAPS.studies)) parked[id] = studies[id]
    notes.push(`There are ${ids.length} saved analyses and ${STUDY_CAPS.studies} is as many as are read at once, so the ${ids.length - STUDY_CAPS.studies} saved longest ago are put aside in the same file. Nothing was deleted.`)
    return { value: { ...raw, studies: kept, unread: parked } as StoredStudies, notes }
  }
  return { value: { ...raw, studies, ...unread } as StoredStudies, notes }
}
