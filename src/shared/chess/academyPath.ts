import type { Concept } from '../courses/types.ts'
import { SCHEDULERS, type Scheduler } from '../compute/learning.ts'
import {
  advance, canGo, elapsedMs, failureNow, judge, newAttempt, opponentReply, performanceOf, worthOf,
  type AttemptSession, type Performance, type Verdict, type Worth
} from './attempt.ts'
import {
  HINT_WORTH, follow, validateExercise, type Exercise, type ExerciseHint
} from './exercise.ts'
import {
  assessedTasks, lessonStanding, lessonsOf,
  type AcademyLesson, type AcademyModule, type Curriculum, type LessonReading, type LessonStanding
} from './lessons.ts'
import { boardSquares, destinationsFrom, type ChessMove, type PieceLetter } from './rules.ts'
import {
  DEFAULT_SCHEDULER, afterAttempt, newCard, schedulerFacts, sessionPlan,
  themeStandings, weakestThemes, type ReviewCard, type Scheduled, type SessionPlan, type ThemeStanding
} from './spaced.ts'

/**
 * The way through the Academy: what is open, what is next, what is due, and what a kept record may claim.
 *
 * `lessons.ts` already answers the questions about one lesson -- what its tasks prove, whether it is finished,
 * which concepts it is waiting on. This file answers the questions about the *journey*, which that module
 * deliberately does not: where somebody left off, what finishing a lesson would open, what it means to say "I
 * already know this and want to skip it", how a kept progress file is read back when part of it is unreadable, and
 * what an answer that is not a move proves.
 *
 * Nothing here is a second copy of anything. Completion is `lessonStanding`. Scheduling is `spaced.ts`, which is
 * itself a thin layer over the scheduler the rest of Orbis uses. The hint ladder is `HINT_WORTH` from `exercise.ts`.
 * Where this file needed one of those, it called it.
 *
 * ## Three rules it exists to keep
 *
 * **Skipping is not finishing.** Somebody who has played for twenty years should not have to prove that a knight
 * moves in an L. So a lesson can be marked as already known, and that credits its concepts for *unlocking* what
 * comes after. It never makes the lesson complete, it is never counted as done, and every screen that shows it says
 * which it was. A progress figure that counts things nobody did is the thing the whole Academy was built to avoid.
 *
 * **An unreadable record is not an empty record.** A kept progress file is decoded field by field and entry by
 * entry. One malformed attempt record is dropped and named; it never takes the other four hundred with it. And a
 * record that has lost the field saying how much help was taken is read as *no credit*, not full credit: when it
 * cannot be told whether something was demonstrated, it was not demonstrated.
 *
 * **An answer is judged from the position.** Twelve of the curriculum's tasks ask for squares or a count rather than
 * a move, and `judge` in `attempt.ts` refuses those on purpose -- it is a move judge. So they are judged here, and
 * judged by asking the rules (`destinationsFrom`, `boardSquares`) what the answer is, not by reading the answer the
 * author wrote down. The author's answer was already checked against the rules by `validateExercise`; working it out
 * again means a learner is never told they are wrong by a typo.
 *
 * Pure: no clock, no storage, no React. `now` is always an argument.
 */

// ---------------------------------------------------------------- what is kept

/** Bumped when the shape below changes in a way a reader has to know about. */
export const PROGRESS_VERSION = 1

/**
 * How many attempt records are kept.
 *
 * There is a cap because this lives in the window's own storage, which is small and shared with every other screen.
 * The oldest go first. It is written down here rather than hidden in a slice so that a screen can say so.
 */
export const RECORD_CAP = 4000

export interface AcademyPlace {
  lessonId: string
  /** Which block of the lesson they were on. */
  block: number
}

export interface AcademyProgress {
  version: number
  /** Which curriculum these records belong to. Records from another one are not these records. */
  curriculumId: string
  /**
   * The content version they were earned against.
   *
   * `lessons.ts` keeps a version on the curriculum for exactly this: a lesson whose tasks changed after somebody
   * finished it was finished against the old tasks, and a screen is entitled to say so rather than quietly implying
   * the new ones were done.
   */
  curriculumVersion: number
  records: readonly Performance[]
  reading: readonly LessonReading[]
  cards: readonly ReviewCard[]
  /** Lessons somebody said they already know. Credited for unlocking, never counted as done. */
  skipped: readonly string[]
  place: AcademyPlace | null
  savedAt: number | null
}

export function emptyProgress(curriculum: Curriculum): AcademyProgress {
  return {
    version: PROGRESS_VERSION,
    curriculumId: curriculum.id,
    curriculumVersion: curriculum.version,
    records: [],
    reading: [],
    cards: [],
    skipped: [],
    place: null,
    savedAt: null
  }
}

// ---------------------------------------------------------------- reading it back

function isObject(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
}

function str(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim() !== '' ? raw : null
}

function num(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
}

function count(raw: unknown, fallback = 0): number {
  const value = num(raw)
  if (value === null) return fallback
  return Math.max(0, Math.round(value))
}

function fraction(raw: unknown, fallback: number): number {
  const value = num(raw)
  if (value === null) return fallback
  return Math.min(1, Math.max(0, value))
}

export interface DecodedProgress {
  progress: AcademyProgress
  /**
   * What could not be read, in plain words, so a screen can say it rather than pretending the file was clean.
   * Empty means everything in the file was understood.
   */
  repaired: readonly string[]
  /** True when there was nothing to read at all -- a first run, or storage that is not available. */
  fresh: boolean
}

/**
 * One attempt record, or nothing.
 *
 * `worth` decides whether a solve counted as demonstrated, so a record that has lost it is read as **zero**. The
 * deflating default is the only safe one: guessing 1 would mark a lesson finished on the strength of a record
 * nobody can read.
 */
function decodeRecord(raw: unknown): Performance | null {
  if (!isObject(raw)) return null
  const exerciseId = str(raw.exerciseId)
  const at = num(raw.at)
  if (exerciseId === null || at === null) return null
  return {
    exerciseId,
    solved: raw.solved === true,
    gaveUp: raw.gaveUp === true,
    hintsUsed: count(raw.hintsUsed),
    worth: fraction(raw.worth, 0),
    wrongMoves: count(raw.wrongMoves),
    illegalTries: count(raw.illegalTries),
    seconds: count(raw.seconds),
    at
  }
}

function decodeReading(raw: unknown): LessonReading | null {
  if (!isObject(raw)) return null
  const lessonId = str(raw.lessonId)
  if (lessonId === null) return null
  return {
    lessonId,
    atBlock: count(raw.atBlock),
    seconds: count(raw.seconds),
    visits: count(raw.visits),
    firstAt: num(raw.firstAt),
    lastAt: num(raw.lastAt)
  }
}

function decodeCard(raw: unknown, now: number): ReviewCard | null {
  if (!isObject(raw)) return null
  const exerciseId = str(raw.exerciseId)
  if (exerciseId === null) return null
  const scheduler: Scheduler = SCHEDULERS.includes(raw.scheduler as Scheduler) ? (raw.scheduler as Scheduler) : DEFAULT_SCHEDULER
  const state = isObject(raw.state) ? raw.state : {}
  const optional = (key: string): Record<string, number> => {
    const value = num(state[key])
    return value === null ? {} : { [key]: value }
  }
  return {
    exerciseId,
    themes: Array.isArray(raw.themes) ? raw.themes.filter((one): one is string => typeof one === 'string') : [],
    scheduler,
    state: {
      interval: Math.max(0, num(state.interval) ?? 0),
      ...optional('ease'),
      ...optional('stability'),
      ...optional('difficulty'),
      ...optional('repetitions'),
      ...optional('box'),
      ...optional('lapses')
    },
    dueAt: num(raw.dueAt) ?? now,
    lastAt: num(raw.lastAt),
    attempts: count(raw.attempts),
    solved: count(raw.solved),
    reviews: count(raw.reviews),
    lapses: count(raw.lapses),
    wrongRun: count(raw.wrongRun),
    // A card with no `fresh` flag but attempts behind it has plainly been seen.
    fresh: typeof raw.fresh === 'boolean' ? raw.fresh : count(raw.attempts) === 0
  }
}

/**
 * A kept progress value, read back as carefully as it can be.
 *
 * Every field is decoded on its own and every entry inside it is decoded on its own, so one bad row costs one row.
 * Ids that the curriculum no longer has are dropped and said, because content that has been corrected is a real
 * thing that happens and a dangling id would otherwise silently point at nothing.
 */
export function decodeProgress(raw: unknown, curriculum: Curriculum, now: number): DecodedProgress {
  const repaired: string[] = []
  const empty = emptyProgress(curriculum)
  if (raw === null || raw === undefined) return { progress: empty, repaired, fresh: true }
  if (!isObject(raw)) {
    return { progress: empty, repaired: ['The saved progress was not in a shape Orbis could read, so it has been started again.'], fresh: false }
  }

  const lessonIds = new Set(lessonsOf(curriculum).map((lesson) => lesson.id))
  const taskIds = new Set(lessonsOf(curriculum).flatMap((lesson) => lesson.tasks.map((task) => task.id)))

  const list = <T>(value: unknown, name: string, decode: (one: unknown) => T | null): T[] => {
    if (value === undefined) return []
    if (!Array.isArray(value)) {
      repaired.push(`The saved ${name} were not a list, so they have been left out. Everything else was kept.`)
      return []
    }
    const out: T[] = []
    let lost = 0
    for (const one of value) {
      const decoded = decode(one)
      if (decoded === null) lost += 1
      else out.push(decoded)
    }
    if (lost > 0) repaired.push(`${lost} saved ${name} could not be read and were left out.`)
    return out
  }

  const records = list(raw.records, 'attempt records', decodeRecord)
  const unknownRecords = records.filter((one) => !taskIds.has(one.exerciseId)).length
  const keptRecords = records.filter((one) => taskIds.has(one.exerciseId))
  if (unknownRecords > 0) {
    repaired.push(`${unknownRecords} attempt ${unknownRecords === 1 ? 'record belongs' : 'records belong'} to a task this curriculum no longer has, so ${unknownRecords === 1 ? 'it is' : 'they are'} not counted.`)
  }

  const reading = list(raw.reading, 'reading records', decodeReading).filter((one) => lessonIds.has(one.lessonId))
  const cards = list(raw.cards, 'review cards', (one) => decodeCard(one, now)).filter((one) => taskIds.has(one.exerciseId))

  const skipped = Array.isArray(raw.skipped)
    ? [...new Set(raw.skipped.filter((one): one is string => typeof one === 'string').filter((one) => lessonIds.has(one)))]
    : []
  if (raw.skipped !== undefined && !Array.isArray(raw.skipped)) {
    repaired.push('The list of lessons you had marked as already known could not be read, so nothing is marked.')
  }

  let place: AcademyPlace | null = null
  if (isObject(raw.place)) {
    const lessonId = str(raw.place.lessonId)
    if (lessonId !== null && lessonIds.has(lessonId)) place = { lessonId, block: count(raw.place.block) }
    else repaired.push('The lesson you were last in is not in this curriculum any more, so the Academy opens at the start.')
  }

  const curriculumId = str(raw.curriculumId)
  if (curriculumId !== null && curriculumId !== curriculum.id) {
    // Records keyed by task id cannot mean anything in another curriculum. Keep nothing rather than mix two.
    return {
      progress: empty,
      repaired: [`The saved progress belongs to a different course (${curriculumId}), so it has not been used.`],
      fresh: false
    }
  }

  const curriculumVersion = num(raw.curriculumVersion) ?? curriculum.version
  if (curriculumVersion !== curriculum.version) {
    repaired.push(`This progress was earned against version ${curriculumVersion} of the lessons; the lessons are now at version ${curriculum.version}.`)
  }

  return {
    progress: {
      version: PROGRESS_VERSION,
      curriculumId: curriculum.id,
      curriculumVersion,
      records: keptRecords.slice(-RECORD_CAP),
      reading,
      cards,
      skipped,
      place,
      savedAt: num(raw.savedAt)
    },
    repaired,
    fresh: false
  }
}

/** The same, from the text a store holds. Invalid JSON is a repair, not a crash. */
export function readProgress(text: string | null | undefined, curriculum: Curriculum, now: number): DecodedProgress {
  if (text === null || text === undefined || text.trim() === '') return { progress: emptyProgress(curriculum), repaired: [], fresh: true }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return {
      progress: emptyProgress(curriculum),
      repaired: ['The saved progress was damaged and could not be read at all, so the Academy has started again.'],
      fresh: false
    }
  }
  return decodeProgress(parsed, curriculum, now)
}

/** What to write. Stamped with the content version, so the next read can say what it was earned against. */
export function writeProgress(progress: AcademyProgress, curriculum: Curriculum, now: number): string {
  return JSON.stringify({
    ...progress,
    version: PROGRESS_VERSION,
    curriculumId: curriculum.id,
    curriculumVersion: curriculum.version,
    records: progress.records.slice(-RECORD_CAP),
    savedAt: now
  })
}

// ---------------------------------------------------------------- the map

export type LessonState =
  /** Its tasks have been demonstrated. */
  | 'done'
  /** Open, and not finished. */
  | 'open'
  /** Marked as already known. Open, and nothing has been demonstrated. */
  | 'skipped'
  /** Waiting on a concept nothing has taught yet. */
  | 'waiting'

export type OpenBecause =
  /** It needs nothing. */
  | 'nothing-needed'
  /** Everything it needs was taught by a lesson that was finished. */
  | 'earned'
  /** Everything it needs is covered, but partly by lessons that were marked as already known. */
  | 'skipped-past'

export interface LessonNode {
  lesson: AcademyLesson
  moduleId: string
  moduleTitle: string
  /** Where it comes in the whole curriculum, from 1. */
  position: number
  state: LessonState
  standing: LessonStanding
  open: boolean
  openBecause: OpenBecause | null
  /** Concepts it needs that nothing has covered, with their names. */
  waitingOn: readonly { id: string; name: string }[]
  /** Lessons that would open if this one were finished. */
  unlocks: readonly string[]
  /** How many tasks it has, and how many have been demonstrated. */
  tasks: { total: number; assessed: number; demonstrated: number }
  says: string
}

export interface ModuleNode {
  module: AcademyModule
  lessons: readonly LessonNode[]
  done: number
  skipped: number
  total: number
  /** Minutes the lessons themselves claim, added up. Never a prediction about a person. */
  minutes: number
  says: string
}

export interface AcademyMap {
  modules: readonly ModuleNode[]
  nodes: readonly LessonNode[]
  done: number
  skipped: number
  open: number
  waiting: number
  total: number
  says: string
}

/** The concepts a completed lesson has taught, and separately the ones only credited by a skip. */
export interface Credit {
  taught: ReadonlySet<string>
  credited: ReadonlySet<string>
}

export function creditOf(curriculum: Curriculum, records: readonly Performance[], skipped: readonly string[]): Credit {
  const taught = new Set<string>()
  const credited = new Set<string>()
  const skippedSet = new Set(skipped)
  for (const lesson of lessonsOf(curriculum)) {
    if (lessonStanding(lesson, records).complete) for (const concept of lesson.concepts) taught.add(concept)
    else if (skippedSet.has(lesson.id)) for (const concept of lesson.concepts) credited.add(concept)
  }
  return { taught, credited }
}

/**
 * The whole course, lesson by lesson.
 *
 * The same judgement as `availability` in `lessons.ts` -- concepts taught by *any* finished lesson, not only an
 * earlier one -- with the skip credit added on top, and with `openBecause` saying which of the two opened it. The
 * counts keep finished and skipped apart everywhere, because adding them together is how a progress figure starts
 * to describe something nobody did.
 */
export function academyMap(curriculum: Curriculum, records: readonly Performance[], skipped: readonly string[]): AcademyMap {
  const named = new Map(curriculum.concepts.map((concept) => [concept.id, concept.name]))
  const { taught, credited } = creditOf(curriculum, records, skipped)
  const skippedSet = new Set(skipped)
  const all = lessonsOf(curriculum)

  const standings = new Map(all.map((lesson) => [lesson.id, lessonStanding(lesson, records)]))
  const shortfall = new Map<string, string[]>()
  for (const lesson of all) {
    shortfall.set(lesson.id, lesson.requires.filter((concept) => !taught.has(concept) && !credited.has(concept)))
  }

  let position = 0
  const nodes: LessonNode[] = []
  const modules: ModuleNode[] = []

  for (const module of curriculum.modules) {
    const inModule: LessonNode[] = []
    for (const lesson of module.lessons) {
      position += 1
      const standing = standings.get(lesson.id) as LessonStanding
      const missing = shortfall.get(lesson.id) ?? []
      const open = missing.length === 0
      const missingWithoutSkip = lesson.requires.filter((concept) => !taught.has(concept))
      const openBecause: OpenBecause | null = !open
        ? null
        : lesson.requires.length === 0
          ? 'nothing-needed'
          : missingWithoutSkip.length === 0
            ? 'earned'
            : 'skipped-past'
      const state: LessonState = standing.complete ? 'done' : !open ? 'waiting' : skippedSet.has(lesson.id) ? 'skipped' : 'open'

      // What finishing this one would open: lessons whose whole shortfall is covered by this lesson's concepts.
      const unlocks = all
        .filter((other) => other.id !== lesson.id)
        .filter((other) => {
          const theirs = shortfall.get(other.id) ?? []
          return theirs.length > 0 && theirs.every((concept) => lesson.concepts.includes(concept))
        })
        .map((other) => other.id)

      const counted = assessedTasks(lesson)
      inModule.push({
        lesson,
        moduleId: module.id,
        moduleTitle: module.title,
        position,
        state,
        standing,
        open,
        openBecause,
        waitingOn: missing.map((concept) => ({ id: concept, name: named.get(concept) ?? concept })),
        unlocks,
        tasks: { total: lesson.tasks.length, assessed: counted.length, demonstrated: standing.demonstrated.length },
        says: state === 'done'
          ? standing.says
          : state === 'waiting'
            ? `Needs ${missing.map((concept) => named.get(concept) ?? concept).join(', ')} first.`
            : state === 'skipped'
              ? 'You marked this as already known. Nothing in it has been demonstrated, and it is not counted as done.'
              : openBecause === 'skipped-past'
                ? 'Open, because you marked what comes before it as already known.'
                : standing.says
      })
    }
    const done = inModule.filter((one) => one.state === 'done').length
    const skippedHere = inModule.filter((one) => one.state === 'skipped').length
    modules.push({
      module,
      lessons: inModule,
      done,
      skipped: skippedHere,
      total: inModule.length,
      minutes: inModule.reduce((sum, one) => sum + one.lesson.minutes, 0),
      says: `${done} of ${inModule.length} done${skippedHere > 0 ? `, ${skippedHere} skipped` : ''}.`
    })
    nodes.push(...inModule)
  }

  const done = nodes.filter((one) => one.state === 'done').length
  const skippedCount = nodes.filter((one) => one.state === 'skipped').length
  const openCount = nodes.filter((one) => one.state === 'open').length
  const waiting = nodes.filter((one) => one.state === 'waiting').length
  return {
    modules,
    nodes,
    done,
    skipped: skippedCount,
    open: openCount,
    waiting,
    total: nodes.length,
    says: nodes.length === 0
      ? 'There are no lessons.'
      : `${done} of ${nodes.length} lessons done${skippedCount > 0 ? `, ${skippedCount} marked as already known` : ''}.`
  }
}

export function nodeFor(map: AcademyMap, lessonId: string | null): LessonNode | null {
  if (lessonId === null) return null
  return map.nodes.find((one) => one.lesson.id === lessonId) ?? null
}

// ---------------------------------------------------------------- where to go next

export type ResumeKind =
  /** Part way through a lesson. */
  | 'carry-on'
  /** The next one worth starting. */
  | 'next'
  /** Everything open has been finished or skipped. */
  | 'all-done'
  /** Nothing is open and not everything is finished: the content has a gap. */
  | 'blocked'
  | 'nothing'

export interface Resume {
  lessonId: string | null
  block: number
  kind: ResumeKind
  says: string
}

/**
 * Where to pick up.
 *
 * A lesson left part way through wins over the next unstarted one, because that is what somebody means by
 * continuing. A lesson marked as already known is never offered as the next thing to do -- the point of marking it
 * was not to be sent back to it.
 */
export function resumePoint(curriculum: Curriculum, progress: AcademyProgress): Resume {
  const map = academyMap(curriculum, progress.records, progress.skipped)
  if (map.nodes.length === 0) return { lessonId: null, block: 0, kind: 'nothing', says: 'There are no lessons.' }

  const here = nodeFor(map, progress.place?.lessonId ?? null)
  if (here && here.open && here.state !== 'done') {
    const block = Math.max(0, Math.min(progress.place?.block ?? 0, here.lesson.blocks.length - 1))
    return {
      lessonId: here.lesson.id,
      block,
      kind: 'carry-on',
      says: `Carry on with ${here.lesson.title}, where you left off.`
    }
  }

  const next = map.nodes.find((one) => one.state === 'open')
  if (next) {
    return { lessonId: next.lesson.id, block: 0, kind: 'next', says: `Next: ${next.lesson.title}.` }
  }

  const unfinished = map.nodes.filter((one) => one.state !== 'done')
  if (unfinished.length === 0) {
    return { lessonId: null, block: 0, kind: 'all-done', says: 'Every lesson has been finished.' }
  }
  const skippedOnly = unfinished.every((one) => one.state === 'skipped')
  if (skippedOnly) {
    return {
      lessonId: unfinished[0].lesson.id,
      block: 0,
      kind: 'all-done',
      says: `Everything left is marked as already known. ${unfinished.length} ${unfinished.length === 1 ? 'lesson has' : 'lessons have'} nothing demonstrated in ${unfinished.length === 1 ? 'it' : 'them'}.`
    }
  }
  const stuck = unfinished.find((one) => one.state === 'waiting')
  return {
    lessonId: null,
    block: 0,
    kind: 'blocked',
    says: stuck
      ? `Nothing is open. ${stuck.lesson.title} is waiting on ${stuck.waitingOn.map((one) => one.name).join(', ')}, and no lesson here teaches that.`
      : 'Nothing is open, and not everything is finished.'
  }
}

export interface SkipPlan {
  /** The lessons that would be marked as already known. */
  lessonIds: readonly string[]
  /** Of those, how many have actually been finished already (and so would not change). */
  alreadyDone: number
  says: string
}

/**
 * Skipping ahead to a lesson: everything before it, marked as already known.
 *
 * Deliberately phrased as a plan rather than done on the spot, so a screen can say exactly what it is about to
 * claim on somebody's behalf before it claims it.
 */
export function skipPlan(curriculum: Curriculum, lessonId: string, records: readonly Performance[]): SkipPlan {
  const all = lessonsOf(curriculum)
  const target = all.findIndex((lesson) => lesson.id === lessonId)
  if (target < 0) return { lessonIds: [], alreadyDone: 0, says: 'There is no such lesson.' }
  const before = all.slice(0, target)
  const unfinished = before.filter((lesson) => !lessonStanding(lesson, records).complete)
  return {
    lessonIds: unfinished.map((lesson) => lesson.id),
    alreadyDone: before.length - unfinished.length,
    says: unfinished.length === 0
      ? 'Nothing needs skipping: everything before this is already done.'
      : `${unfinished.length} ${unfinished.length === 1 ? 'lesson' : 'lessons'} before this would be marked as already known. That opens them; it does not finish them, and they will not count as done.`
  }
}

export function markSkipped(progress: AcademyProgress, lessonIds: readonly string[]): AcademyProgress {
  return { ...progress, skipped: [...new Set([...progress.skipped, ...lessonIds])] }
}

export function clearSkipped(progress: AcademyProgress, lessonIds: readonly string[]): AcademyProgress {
  const drop = new Set(lessonIds)
  return { ...progress, skipped: progress.skipped.filter((one) => !drop.has(one)) }
}

// ---------------------------------------------------------------- reading, which finishes nothing

export function readingFor(progress: AcademyProgress, lessonId: string): LessonReading {
  return progress.reading.find((one) => one.lessonId === lessonId)
    ?? { lessonId, atBlock: 0, seconds: 0, visits: 0, firstAt: null, lastAt: null }
}

/** A lesson opened: one more visit. */
export function openedLesson(progress: AcademyProgress, lessonId: string, now: number): AcademyProgress {
  const held = readingFor(progress, lessonId)
  const next: LessonReading = {
    ...held,
    visits: held.visits + 1,
    firstAt: held.firstAt ?? now,
    lastAt: now
  }
  return {
    ...progress,
    reading: [...progress.reading.filter((one) => one.lessonId !== lessonId), next],
    place: { lessonId, block: progress.place?.lessonId === lessonId ? progress.place.block : 0 }
  }
}

/**
 * How far through, and how long the lesson has been on screen.
 *
 * `atBlock` only ever goes up: going back to re-read something does not undo having reached the end. Seconds are
 * added, and they measure time with the lesson open -- which is not the same as time spent learning, and is never
 * described as if it were.
 */
export function noteReading(
  progress: AcademyProgress,
  lessonId: string,
  o: { block?: number; addSeconds?: number },
  now: number
): AcademyProgress {
  const held = readingFor(progress, lessonId)
  const next: LessonReading = {
    ...held,
    atBlock: Math.max(held.atBlock, Math.max(0, Math.round(o.block ?? held.atBlock))),
    seconds: held.seconds + Math.max(0, Math.round(o.addSeconds ?? 0)),
    firstAt: held.firstAt ?? now,
    lastAt: now
  }
  return {
    ...progress,
    reading: [...progress.reading.filter((one) => one.lessonId !== lessonId), next],
    ...(o.block === undefined ? {} : { place: { lessonId, block: Math.max(0, Math.round(o.block)) } })
  }
}

// ---------------------------------------------------------------- review

/**
 * One card per task, kept in step with the content.
 *
 * A task that has gone from the curriculum loses its card; a task that has arrived gets one. An existing card keeps
 * everything it knows -- its interval, its history -- because the content changing is not a reason to forget that
 * somebody has been doing it.
 */
export function syncCards(
  curriculum: Curriculum,
  cards: readonly ReviewCard[],
  now: number
): { cards: ReviewCard[]; added: number; dropped: number } {
  const tasks = lessonsOf(curriculum).flatMap((lesson) => lesson.tasks)
  const held = new Map(cards.map((card) => [card.exerciseId, card]))
  const out: ReviewCard[] = []
  let added = 0
  for (const task of tasks) {
    const existing = held.get(task.id)
    if (existing) {
      // Themes come from the content, so a retagged task is retagged on its card too.
      out.push({ ...existing, themes: [...task.tags] })
      held.delete(task.id)
    } else {
      out.push(newCard({ exerciseId: task.id, themes: [...task.tags], now }))
      added += 1
    }
  }
  return { cards: out, added, dropped: held.size }
}

export interface DueItem {
  card: ReviewCard
  task: Exercise
  lesson: AcademyLesson
  /** Whole days it has been due. Zero means it came due today. */
  overdueDays: number
  /** Three wrong in a row: another go at the same puzzle is not the answer, and the lesson is. */
  teachInstead: boolean
  /** Why this is in front of you, from the card's own record and nothing else. */
  why: string
}

export interface ReviewToday {
  review: readonly DueItem[]
  teach: readonly DueItem[]
  fresh: readonly DueItem[]
  plan: SessionPlan
  /** What the scheduler is, where it came from, and what it cannot do. Shown wherever a schedule is shown. */
  scheduler: { label: string; origin: string; limitation: string }
  themes: readonly ThemeStanding[]
  weakest: readonly ThemeStanding[]
  says: string
}

const DAY = 86_400_000

function describeCard(card: ReviewCard, overdueDays: number, now: number): string {
  const parts: string[] = []
  if (card.fresh) parts.push('Not tried yet.')
  else if (overdueDays <= 0) parts.push('Came due today.')
  else parts.push(`Due ${overdueDays} ${overdueDays === 1 ? 'day' : 'days'} ago.`)
  if (card.lastAt !== null) {
    const since = Math.floor(Math.max(0, now - card.lastAt) / DAY)
    parts.push(since === 0 ? 'Last seen today.' : `Last seen ${since} ${since === 1 ? 'day' : 'days'} ago.`)
  }
  if (card.attempts > 0) parts.push(`Solved ${card.solved} of ${card.attempts}.`)
  if (card.wrongRun > 0) parts.push(`${card.wrongRun} wrong in a row.`)
  if (card.lapses > 0) parts.push(`Forgotten ${card.lapses} ${card.lapses === 1 ? 'time' : 'times'}.`)
  return parts.join(' ')
}

/**
 * What is due, and why.
 *
 * The plan itself is `sessionPlan` from `spaced.ts`; this joins each card back to the task and the lesson it came
 * from, works out how overdue it is, and says what the card's own record says. Nothing is added: no estimate of how
 * well anything is known, no prediction about the next attempt.
 */
export function reviewToday(
  curriculum: Curriculum,
  progress: AcademyProgress,
  now: number,
  limits: { review?: number; fresh?: number } = {}
): ReviewToday {
  const lessons = lessonsOf(curriculum)
  const where = new Map<string, { task: Exercise; lesson: AcademyLesson }>()
  for (const lesson of lessons) for (const task of lesson.tasks) where.set(task.id, { task, lesson })

  const cards = syncCards(curriculum, progress.cards, now).cards
  const plan = sessionPlan(cards, now, limits)
  const item = (card: ReviewCard): DueItem | null => {
    const found = where.get(card.exerciseId)
    if (!found) return null
    const overdueDays = Math.floor(Math.max(0, now - card.dueAt) / DAY)
    return {
      card,
      task: found.task,
      lesson: found.lesson,
      overdueDays,
      teachInstead: card.wrongRun >= 3,
      why: describeCard(card, overdueDays, now)
    }
  }
  const items = (list: readonly ReviewCard[]): DueItem[] => list.map(item).filter((one): one is DueItem => one !== null)

  return {
    review: items(plan.review),
    teach: items(plan.teach),
    fresh: items(plan.fresh),
    plan,
    scheduler: schedulerFacts(cards[0]?.scheduler ?? DEFAULT_SCHEDULER),
    themes: themeStandings(cards, now),
    weakest: weakestThemes(cards, now),
    says: plan.says
  }
}

/**
 * What "quickly" means for a task.
 *
 * `gradeFor` needs a threshold and says plainly that the caller knows it and the module does not guess. Orbis does
 * not have anybody's timing data either, so this is **a threshold Orbis sets**, derived from how much there is to
 * work out, and it is described that way on screen. It is not a measured average, and nothing here pretends it is.
 */
export function parSecondsFor(task: Exercise): number {
  if (task.objective === 'answer') return 45
  if (task.objective === 'mate-in-n') return 30 * Math.max(1, task.movesToMate ?? 1)
  if (task.objective === 'reconstruct') return 20 * Math.max(1, task.solution.lines.length)
  if (task.objective === 'hold-draw') return 90
  return 60
}

export interface Recorded {
  progress: AcademyProgress
  /** What the scheduler did with it, or null when the task has no card (it is not in this curriculum). */
  scheduled: Scheduled | null
}

/**
 * An attempt, filed.
 *
 * The record goes in the history and the card goes to the scheduler, and those are two different things on purpose:
 * the history is what completion is worked out from, the schedule is only about when something comes back.
 */
export function recordAttempt(
  progress: AcademyProgress,
  task: Exercise,
  performance: Performance,
  now: number
): Recorded {
  const records = [...progress.records, performance].slice(-RECORD_CAP)
  const existing = progress.cards.find((card) => card.exerciseId === task.id)
  const card = existing ?? newCard({ exerciseId: task.id, themes: [...task.tags], now })
  const scheduled = afterAttempt(card, performance, now, parSecondsFor(task))
  return {
    progress: {
      ...progress,
      records,
      cards: [...progress.cards.filter((one) => one.exerciseId !== task.id), scheduled.card]
    },
    scheduled
  }
}

// ---------------------------------------------------------------- concepts

export interface ConceptStanding {
  concept: Concept
  /** Lessons that teach it. */
  lessons: readonly string[]
  /** Tasks in those lessons, and how many have been demonstrated. */
  tasks: number
  demonstrated: number
  /** True only when every lesson teaching it has been finished. */
  taught: boolean
  /** True when it is only available because a lesson was marked as already known. */
  credited: boolean
  says: string
}

/**
 * How each concept stands, said in a way that cannot be mistaken for a claim about skill.
 *
 * It reports two things and no third: which lessons teaching it are finished, and how many of their tasks were
 * demonstrated. There is no mastery number, because nothing here measures mastery -- a learner who demonstrated
 * four fork tasks has demonstrated four fork tasks.
 */
export function conceptStandings(
  curriculum: Curriculum,
  records: readonly Performance[],
  skipped: readonly string[]
): ConceptStanding[] {
  const skippedSet = new Set(skipped)
  return curriculum.concepts.map((concept) => {
    const teaching = lessonsOf(curriculum).filter((lesson) => lesson.concepts.includes(concept.id))
    const standings = teaching.map((lesson) => ({ lesson, standing: lessonStanding(lesson, records) }))
    const tasks = teaching.reduce((sum, lesson) => sum + assessedTasks(lesson).length, 0)
    const demonstrated = standings.reduce((sum, one) => sum + one.standing.demonstrated.length, 0)
    const taught = teaching.length > 0 && standings.every((one) => one.standing.complete)
    const credited = !taught && teaching.some((one) => skippedSet.has(one.id))
    return {
      concept,
      lessons: teaching.map((lesson) => lesson.id),
      tasks,
      demonstrated,
      taught,
      credited,
      says: teaching.length === 0
        ? 'No lesson here teaches this.'
        : credited
          ? 'You marked the lesson for this as already known. Nothing has been demonstrated.'
          : taught
            ? `Taught: ${demonstrated} of ${tasks} tasks demonstrated.`
            : demonstrated === 0
              ? 'Nothing demonstrated yet.'
              : `${demonstrated} of ${tasks} tasks demonstrated.`
    }
  })
}

// ---------------------------------------------------------------- answers that are not moves

export interface AnswerVerdict {
  ok: boolean
  /**
   * What the rules say, worked out from the position: the squares, or the count. Null when the rules cannot say.
   */
  truth: readonly string[] | number | null
  /** Squares the answer is missing, and squares in it that do not belong. */
  missing: readonly string[]
  extra: readonly string[]
  says: string
  /** False when this answer form is not something the rules can settle. */
  checkable: boolean
}

const PIECE_NAME: Readonly<Record<PieceLetter, string>> = Object.freeze({
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king'
})

const SQUARE = /^[a-h][1-8]$/

/** The squares a piece really reaches, one entry per square, read out of the rules. */
export function trueDestinations(fen: string, from: string): string[] {
  return [...new Set(destinationsFrom(fen, from).map((move) => move.to))].sort()
}

/** How many of something a side has, counted off the board. */
export function truePieceCount(fen: string, side: 'w' | 'b', of: 'all' | PieceLetter): number {
  return boardSquares(fen).filter((one) => one.color === side && (of === 'all' || one.type === of)).length
}

/**
 * What somebody gave as an answer.
 *
 * `squares` being an empty list and `squares` being absent are **different answers**, and the difference is not a
 * nicety: one task in the curriculum ("show every square the king can go to", in a stalemate) has *no* squares as
 * its correct answer. Treating an empty list as "nothing given yet" would make that task unanswerable, so a screen
 * has to offer a way of saying "there are none" and this has to be able to tell the two apart.
 */
export interface GivenAnswer {
  squares?: readonly string[]
  value?: number
  text?: string
}

/**
 * Whether an answer that is not a move is right.
 *
 * `judge` in `attempt.ts` answers this for moves and refuses everything else, which is correct: it is a move judge.
 * This is the other half, and it keeps the same discipline. The truth is recomputed from the position, so a learner
 * is never told they are wrong by a typo in the content, and what the answer is missing is reported separately from
 * what it has too much of -- "you missed c2" and "b5 is not one of them" are different things to have got wrong.
 */
export function judgeAnswer(task: Exercise, given: GivenAnswer): AnswerVerdict {
  const answer = task.answer
  if (!answer) {
    return { ok: false, truth: null, missing: [], extra: [], checkable: false, says: 'This task does not say what its answer is, so nothing can be checked.' }
  }

  if (answer.kind === 'destinations') {
    const truth = trueDestinations(task.startFen, answer.from)
    const chosen = [...new Set((given.squares ?? []).map((one) => one.trim().toLowerCase()))].sort()
    const missing = truth.filter((square) => !chosen.includes(square))
    const extra = chosen.filter((square) => !truth.includes(square))
    const piece = boardSquares(task.startFen).find((one) => one.square === answer.from)
    const what = piece ? `${PIECE_NAME[piece.type]} on ${answer.from}` : `piece on ${answer.from}`
    if (given.squares === undefined) {
      return { ok: false, truth, missing, extra, checkable: true, says: 'Nothing picked yet.' }
    }
    const ok = missing.length === 0 && extra.length === 0
    if (ok && truth.length === 0) {
      return { ok: true, truth, missing, extra, checkable: true, says: 'Right: there are none.' }
    }

    // What a wrong answer is told, and what it is not.
    //
    // The squares that were missed are **counted and not named**. Naming them would put the answer on screen, and
    // the next try would then be recorded as an unaided solve -- the exact lie the hint ladder exists to stop. The
    // squares that were offered wrongly are named, because they were already on screen: the person put them there.
    const bits: string[] = []
    if (missing.length > 0) {
      bits.push(`${missing.length} more ${missing.length === 1 ? 'square is' : 'squares are'} legal`)
    }
    if (extra.length > 0) {
      const offBoard = extra.filter((square) => !SQUARE.test(square))
      const onBoard = extra.filter((square) => SQUARE.test(square))
      if (onBoard.length > 0) bits.push(`the ${what} cannot reach ${onBoard.join(', ')}`)
      if (offBoard.length > 0) bits.push(`${offBoard.join(', ')} ${offBoard.length === 1 ? 'is' : 'are'} not a square`)
    }
    return {
      ok,
      truth,
      missing,
      extra,
      checkable: true,
      says: ok
        ? `That is all ${truth.length} of them.`
        : `Not quite: ${bits.join(', and ')}.`
    }
  }

  if (answer.kind === 'count') {
    const truth = truePieceCount(task.startFen, answer.side, answer.of)
    const value = given.value
    if (value === undefined || !Number.isFinite(value)) {
      return { ok: false, truth, missing: [], extra: [], checkable: true, says: 'No number given yet.' }
    }
    const ok = Math.round(value) === truth
    const side = answer.side === 'w' ? 'White' : 'Black'
    const of = answer.of === 'all' ? 'pieces' : `${PIECE_NAME[answer.of]}s`
    return {
      ok,
      truth,
      missing: [],
      extra: [],
      checkable: true,
      says: ok ? `Right: ${truth}.` : `Not that. Count ${side}'s ${of} again.`
    }
  }

  if (answer.kind === 'fen') {
    return {
      ok: false,
      truth: null,
      missing: [],
      extra: [],
      checkable: false,
      says: 'This one is answered by playing the line on the board, not by typing an answer.'
    }
  }

  // Free text. The accepted wordings can be matched; whether a different wording would also be right cannot.
  const typed = (given.text ?? '').trim().toLowerCase()
  const ok = typed !== '' && answer.accepts.some((one) => one.trim().toLowerCase() === typed)
  return {
    ok,
    truth: null,
    missing: [],
    extra: [],
    checkable: false,
    says: ok
      ? 'That matches one of the answers this task accepts. Whether another wording would also be right is not something Orbis can judge.'
      : typed === ''
        ? 'Nothing written yet.'
        : 'That is not one of the wordings this task accepts, which is not the same as being wrong. Somebody has to read it.'
  }
}

/**
 * One go at a task that is answered rather than played.
 *
 * `AttemptSession` in `attempt.ts` is built around playing moves, and twelve of the curriculum's tasks do not have
 * one. Rather than feed that machine a move-shaped lie, this is the same idea with the parts that apply: tries,
 * wrong answers, hints taken, and a clock. The hint ladder is the same ladder -- `worthOf` from `attempt.ts` is
 * called for the worth, not reimplemented -- so an answer reached with the answer on screen is practice here too.
 */
export interface AnswerAttempt {
  taskId: string
  tries: number
  wrong: number
  hintsTaken: readonly number[]
  startedAt: number
  finishedAt: number | null
  outcome: 'solved' | 'failed' | 'given-up' | null
}

export function newAnswerAttempt(task: Exercise, now: number): AnswerAttempt {
  return { taskId: task.id, tries: 0, wrong: 0, hintsTaken: [], startedAt: now, finishedAt: null, outcome: null }
}

/** What the attempt proves, from the hints taken. The same ladder as a played attempt, by the same function. */
export function answerWorth(attempt: AnswerAttempt, task: Exercise): Worth {
  const session = newAttempt({ id: attempt.taskId, exercise: task, now: attempt.startedAt })
  return worthOf({ ...session, hintsTaken: [...attempt.hintsTaken] }, task)
}

/** How many wrong answers this task forgives, from its own failure conditions. */
export function wrongAllowed(task: Exercise): number {
  const condition = task.failure.find((one) => one.kind === 'wrong-moves')
  return condition && condition.kind === 'wrong-moves' ? condition.allowed : 0
}

/** The attempt after an answer was submitted. A wrong answer past the allowance ends it. */
export function answerSubmitted(attempt: AnswerAttempt, task: Exercise, verdict: AnswerVerdict, now: number): AnswerAttempt {
  if (attempt.outcome !== null) return attempt
  const tries = attempt.tries + 1
  if (verdict.ok) return { ...attempt, tries, finishedAt: now, outcome: 'solved' }
  const wrong = attempt.wrong + 1
  const over = wrong > wrongAllowed(task)
  return { ...attempt, tries, wrong, ...(over ? { finishedAt: now, outcome: 'failed' as const } : {}) }
}

export function answerHint(attempt: AnswerAttempt, task: Exercise): { attempt: AnswerAttempt; hint: ExerciseHint | null; worth: Worth } {
  const next = task.hints.find((one) => !attempt.hintsTaken.includes(one.level))
  if (!next) return { attempt, hint: null, worth: answerWorth(attempt, task) }
  const updated: AnswerAttempt = { ...attempt, hintsTaken: [...attempt.hintsTaken, next.level] }
  return { attempt: updated, hint: next, worth: answerWorth(updated, task) }
}

export function answerGaveUp(attempt: AnswerAttempt, now: number): AnswerAttempt {
  if (attempt.outcome !== null) return attempt
  return { ...attempt, finishedAt: now, outcome: 'given-up' }
}

/** The record an answered attempt leaves, in exactly the shape a played one leaves. */
export function answerPerformance(attempt: AnswerAttempt, task: Exercise, now: number): Performance {
  const at = attempt.finishedAt ?? now
  return {
    exerciseId: task.id,
    solved: attempt.outcome === 'solved',
    gaveUp: attempt.outcome === 'given-up',
    hintsUsed: attempt.hintsTaken.length,
    worth: answerWorth(attempt, task).worth,
    wrongMoves: attempt.wrong,
    illegalTries: 0,
    seconds: Math.max(0, Math.round((at - attempt.startedAt) / 1000)),
    at
  }
}

/**
 * What the next hint would cost, before it is taken.
 *
 * Shown on the button, because a hint that silently turns a solve into practice is a hint somebody would have
 * wanted to be asked about.
 */
export function nextHintCost(task: Exercise, hintsTaken: readonly number[]): { hint: ExerciseHint | null; worthAfter: number; warns: boolean } {
  const next = task.hints.find((one) => !hintsTaken.includes(one.level))
  if (!next) return { hint: null, worthAfter: 1, warns: false }
  let worth = 1
  for (const level of [...hintsTaken, next.level]) {
    const hint = task.hints.find((one) => one.level === level)
    if (hint) worth = Math.min(worth, HINT_WORTH[hint.shows])
  }
  return { hint: next, worthAfter: worth, warns: worth <= 0 }
}

// ---------------------------------------------------------------- one go at a task that is played

/**
 * How many positions the mate check may look at while judging a move.
 *
 * `judge` can sometimes prove that a move has thrown the mate away, and it does that with a small exhaustive
 * search. That search happens on the window's own thread, between a piece being let go of and the feedback
 * appearing, so it gets a budget a person will not notice rather than the generous one content generation uses.
 * Running out of budget makes `judge` say "whether it is any good is another question", which is the honest answer
 * and not a worse one.
 */
export const JUDGE_BUDGET = 20_000

/**
 * A fresh attempt, with the position on the board and the clock running.
 *
 * The machine insists on `ready -> loading -> active`, and `interrupted` leads back to `loading` rather than
 * straight to `active` for a reason worth keeping: a position has to be put back before a move can be taken. This
 * does the dance in one call so no screen has to remember it.
 */
export function startAttempt(task: Exercise, id: string, now: number): AttemptSession {
  const ready = newAttempt({ id, exercise: task, now })
  const loading = advance(ready, { kind: 'load' }, now)
  if (!loading.ok) return ready
  const active = advance(loading.session, { kind: 'loaded' }, now)
  return active.ok ? active.session : loading.session
}

export interface MoveStep {
  session: AttemptSession
  verdict: Verdict
  /** False when the attempt was not in a state to take a move. The session is then unchanged. */
  ok: boolean
  /** Why it was refused, when it was. */
  refused: string | null
}

/**
 * Submitting a move during a lesson task.
 *
 * `playMove` in `attempt.ts` does the same three steps and gives the mate search its default budget. This is the
 * long way round the machine's own docstring keeps available, taken for one reason: the budget. Everything else --
 * the machine, the judge, the failure conditions -- is that module's, called and not copied.
 */
export function submitMove(
  session: AttemptSession,
  task: Exercise,
  move: string,
  now: number,
  budget = JUDGE_BUDGET
): MoveStep {
  const submitted = advance(session, { kind: 'submit' }, now)
  if (!submitted.ok) {
    const refused = submitted.says ?? `An attempt in ${session.state} does not take moves.`
    return { session, verdict: { kind: 'not-now', says: refused }, ok: false, refused }
  }
  const sequence = [...session.played.map((one) => one.uci), move]
  const verdict = judge(task, sequence, { budget })
  const after = advance(submitted.session, { kind: 'verdict', verdict }, now)
  if (!after.ok) {
    return { session: submitted.session, verdict, ok: false, refused: after.says ?? null }
  }

  // A limit may have been passed by that move. The machine knows; the caller should not have to remember.
  const reason = failureNow(after.session, task, now)
  if (reason !== null && after.session.state === 'awaiting-feedback' && after.session.pending === 'continue') {
    // The only event that reaches `failed` from here is `give-up`, which writes its own reason. Running out of
    // wrong moves is not giving up, so the reason it wrote is replaced with the real one -- in the session and in
    // its history, because a history that says somebody asked to see the answer when they did not is a history
    // nothing downstream can trust.
    const failed = advance({ ...after.session, pending: null }, { kind: 'give-up' }, now)
    if (failed.ok) {
      const history = [...failed.session.history]
      history[history.length - 1] = { state: 'failed', at: now, why: reason }
      return {
        session: { ...failed.session, outcome: 'failed', why: reason, history },
        verdict,
        ok: true,
        refused: null
      }
    }
  }
  return { session: after.session, verdict, ok: true, refused: null }
}

export interface OpponentStep {
  session: AttemptSession
  reply: ChessMove | null
  says: string
  /** True when that reply was the end of the recorded line, so the task is finished. */
  finished: boolean
}

/**
 * The attempt held at the end, waiting to be told the person has read the result.
 *
 * Three of the curriculum's tasks are lines to play out rather than puzzles to solve, and one of them -- both sides
 * castling -- ends on the **opponent's** move. `attempt.ts` has no event for that: every event that reaches
 * `completed` carries a move the solver played, and handing it the reply would put the reply on the board twice.
 *
 * So the step is taken here, and taken the way that module takes it: `canGo` is asked whether the machine allows it
 * (it does -- `active` to `awaiting-feedback`), the clock is stopped exactly as `go` stops it, and the history is
 * appended. Nothing after this is hand-made: `pending: 'solved'` means the ordinary `feedback-done` event finishes
 * the attempt, with the outcome that event writes.
 *
 * A note for whoever owns `attempt.ts`: an event meaning "the opponent's reply ended it" would make this
 * unnecessary, and the state it would have to reach is already in `TRANSITIONS`.
 */
function holdAtEnd(session: AttemptSession, now: number, why: string): AttemptSession {
  if (!canGo(session.state, 'awaiting-feedback')) return session
  return {
    ...session,
    state: 'awaiting-feedback',
    pending: 'solved',
    activeMs: session.runningSince === null ? session.activeMs : elapsedMs(session, now),
    runningSince: null,
    why,
    history: [...session.history, { state: 'awaiting-feedback', at: now, why }]
  }
}

/**
 * The opponent's answer, from the task's own lines.
 *
 * `pick` is a number the caller supplies -- the number of goes already had at this task -- so a second attempt can
 * meet a different defence and the same attempt always meets the same one. There is no random source here.
 */
export function playOpponentReply(session: AttemptSession, task: Exercise, now: number, pick = 0): OpponentStep {
  if (session.state !== 'awaiting-opponent') {
    return { session, reply: null, finished: false, says: `There is no reply to play: the attempt is ${session.state}.` }
  }
  const reply = opponentReply(task, session.played.map((one) => one.uci), pick)
  if (!reply) {
    return {
      session,
      reply: null,
      finished: false,
      says: 'This task has no reply recorded for the position you have reached. That is a gap in the task, not a mistake by you.'
    }
  }
  const moved = advance(session, { kind: 'opponent-moved', move: reply }, now)
  if (!moved.ok) return { session, reply: null, finished: false, says: moved.says ?? 'That reply could not be played.' }

  // Did that reply end the line? Asked of `follow`, the same primitive the judge asks.
  const walk = follow(task, moved.session.played.map((one) => one.uci))
  if (walk.illegalAt === null && walk.divergedAt === null && walk.lineComplete) {
    const says = `${reply.san}. That is the end of the line.`
    return { session: holdAtEnd(moved.session, now, says), reply, finished: true, says }
  }
  return { session: moved.session, reply, finished: false, says: `${reply.san}.` }
}

/**
 * The recorded answer, in notation, for showing after a failed attempt or a request to see it.
 *
 * Taken from `validateExercise`, which walks the task's own tree against the real position, so the line shown is one
 * that can actually be played rather than the text an author typed. The first complete line: a task may have
 * several, and they are all correct.
 */
export function solutionLine(task: Exercise): readonly string[] {
  const check = validateExercise(task)
  const line = check.lines.find((one) => one.endsIn === 'checkmate') ?? check.lines[0]
  return line ? [...line.san] : []
}

/** The attempt record a played task leaves, or null while it is still going. */
export function playedPerformance(session: AttemptSession, task: Exercise, now: number): Performance | null {
  if (session.state !== 'completed' && session.state !== 'failed') return null
  return performanceOf(session, task, now)
}

// ---------------------------------------------------------------- arrows over a diagram

export interface ArrowGeometry {
  x1: number
  y1: number
  x2: number
  y2: number
}

/**
 * Where an arrow goes over the board, in per cent of the board's width and height.
 *
 * The board draws squares and the `BoardArrow` in a lesson block names two of them, so the line has to be worked out
 * from the square names and which way up the board is. The centre of a file is 6.25 per cent in from the edge plus
 * 12.5 per cent per file, which is what the two constants are.
 *
 * Null for anything that is not a square, so a mistake in content is nothing drawn rather than a line to the corner.
 */
export function arrowGeometry(from: string, to: string, orientation: 'w' | 'b'): ArrowGeometry | null {
  const point = (square: string): { x: number; y: number } | null => {
    const text = square.trim().toLowerCase()
    if (!SQUARE.test(text)) return null
    const file = text.charCodeAt(0) - 97
    const rank = Number(text[1]) - 1
    const column = orientation === 'w' ? file : 7 - file
    const row = orientation === 'w' ? 7 - rank : rank
    return { x: 6.25 + column * 12.5, y: 6.25 + row * 12.5 }
  }
  const a = point(from)
  const b = point(to)
  if (!a || !b) return null
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y }
}
