import type { Concept, Difficulty } from '../courses/types.ts'
import type { Performance } from './attempt.ts'
import { validateExercise, type Exercise, type ExerciseCheck, type MoveNode } from './exercise.ts'
import { checkFen } from './rules.ts'

/**
 * The Academy: lessons made of content and tasks, and what finishing one means (Sections 061-070).
 *
 * ## A lesson is data
 *
 * The same decision the rest of Orbis made (`src/shared/courses/types.ts`): a lesson is a structure, never a React
 * file. Content can then be written, checked, versioned and corrected without touching the application, and the
 * curriculum in `curriculum.ts` is exactly that -- data, every position in it machine-checked.
 *
 * ## Opening a page is not learning
 *
 * The rule this file exists for (Section 068). A lesson is finished when its tasks have been **demonstrated** --
 * solved, by the person, without the answer having been shown. Scrolling to the bottom finishes nothing. Reading is
 * recorded, because it is worth knowing, and it never moves the completion. The same rule the Student's mastery map
 * is built on: a progress bar that climbs while nothing is being done is worse than no progress bar, because
 * everything downstream inherits the lie.
 *
 * And a task solved with the move on screen does not count as demonstrated. It is practice, which is a real thing
 * and a different thing.
 *
 * ## A task is an exercise
 *
 * Not a special lesson-shaped thing. Every interactive task in a lesson is an `Exercise` from `exercise.ts`, so it
 * is judged by the same judge as a puzzle, validated by the same validator, and scheduled by the same scheduler.
 * There is no second training engine hiding in the Academy.
 *
 * Pure: no clock, no storage. `now` is passed in where it is needed at all.
 */

// ---------------------------------------------------------------- content

export interface BoardArrow {
  from: string
  to: string
  /** Why the arrow is there, for a screen reader and for the caption. */
  says?: string
}

export type LessonBlock =
  | { kind: 'text'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'list'; items: string[]; ordered?: boolean }
  | { kind: 'callout'; tone: 'note' | 'warning' | 'tip'; text: string }
  | { kind: 'table'; headers: string[]; rows: string[][] }
  /** A position to look at. `highlight` and `arrows` are drawn over it. */
  | { kind: 'board'; fen: string; caption?: string; highlight?: string[]; arrows?: BoardArrow[] }
  /** A line to step through, from a position. The moves are checked by the validator like any others. */
  | { kind: 'moves'; fen: string; moves: string[]; caption?: string }
  /** One of the lesson's own tasks, placed in the text. */
  | { kind: 'task'; taskId: string }

export interface LessonAssessment {
  id: string
  title: string
  /** The tasks that count. Empty means every task in the lesson. */
  taskIds: string[]
  /** How many of them have to be demonstrated. */
  needs: number
  /**
   * Whether a task solved after the move was shown counts.
   *
   * False everywhere in the Orbis curriculum. It is here because an imported course may say otherwise, and because
   * a setting that exists and is visible is better than a rule somebody later hard-codes differently.
   */
  countHinted: boolean
}

export interface AcademyLesson {
  id: string
  title: string
  /** Why this lesson exists and what somebody will be able to do afterwards. */
  intro: string
  objectives: string[]
  /** Concepts somebody should have already. A gap here is what the order of the curriculum is for. */
  requires: string[]
  /** Concepts this lesson teaches. Everything measured about it hangs off these. */
  concepts: string[]
  blocks: LessonBlock[]
  /** The interactive tasks. Each one is a real exercise. */
  tasks: Exercise[]
  assessment: LessonAssessment
  minutes: number
  difficulty: Difficulty
}

export interface AcademyModule {
  id: string
  title: string
  summary: string
  lessons: AcademyLesson[]
}

export interface Curriculum {
  id: string
  title: string
  blurb: string
  /** Every concept the curriculum teaches, and what each one depends on. */
  concepts: Concept[]
  modules: AcademyModule[]
  /** Bumped when the content changes, so progress can say which version it was earned against. */
  version: number
}

export function lessonsOf(curriculum: Curriculum): AcademyLesson[] {
  return curriculum.modules.flatMap((module) => module.lessons)
}

export function allTasks(curriculum: Curriculum): Exercise[] {
  return lessonsOf(curriculum).flatMap((lesson) => lesson.tasks)
}

export function findLesson(curriculum: Curriculum, lessonId: string): AcademyLesson | null {
  return lessonsOf(curriculum).find((lesson) => lesson.id === lessonId) ?? null
}

export function findTask(curriculum: Curriculum, taskId: string): Exercise | null {
  return allTasks(curriculum).find((task) => task.id === taskId) ?? null
}

// ---------------------------------------------------------------- what somebody has done

/**
 * Reading is recorded and never completes anything.
 *
 * Kept as a named constant rather than a comment in a condition, so that "opening the page finishes the lesson"
 * cannot be reintroduced quietly by somebody who thought the condition looked wrong.
 */
export const READING_COUNTS_TOWARD_COMPLETION = false

export interface LessonReading {
  lessonId: string
  /** How far they got through the blocks. Worth knowing; proves nothing. */
  atBlock: number
  seconds: number
  visits: number
  firstAt: number | null
  lastAt: number | null
}

export interface TaskStanding {
  taskId: string
  attempts: number
  /** Solved at least once with the move not shown. */
  demonstrated: boolean
  /** Solved at least once, however much help was taken. */
  solvedSomehow: boolean
  /** The best the task has been done: 0..1, from the hint ladder. */
  bestWorth: number
  says: string
}

export interface LessonStanding {
  lessonId: string
  tasks: readonly TaskStanding[]
  /** Which of the assessment's tasks have been demonstrated. */
  demonstrated: readonly string[]
  outstanding: readonly string[]
  needs: number
  complete: boolean
  /** 0..1, from demonstrated tasks only. */
  progress: number
  says: string
}

/** The tasks an assessment counts: the ones it names, or all of them when it names none. */
export function assessedTasks(lesson: AcademyLesson): Exercise[] {
  if (lesson.assessment.taskIds.length === 0) return [...lesson.tasks]
  return lesson.tasks.filter((task) => lesson.assessment.taskIds.includes(task.id))
}

function standingForTask(task: Exercise, records: readonly Performance[], countHinted: boolean): TaskStanding {
  const mine = records.filter((record) => record.exerciseId === task.id)
  const solved = mine.filter((record) => record.solved)
  const bestWorth = solved.reduce((best, record) => Math.max(best, record.worth), 0)
  const demonstrated = solved.some((record) => (countHinted ? true : record.worth > 0))
  return {
    taskId: task.id,
    attempts: mine.length,
    demonstrated,
    solvedSomehow: solved.length > 0,
    bestWorth,
    says: demonstrated
      ? bestWorth >= 1
        ? 'Done, unaided.'
        : 'Done, with some help.'
      : solved.length > 0
        ? 'Solved with the move on screen, which is practice rather than a solve. Worth one more go.'
        : mine.length > 0
          ? 'Tried, not solved yet.'
          : 'Not tried yet.'
  }
}

/**
 * Where somebody is in a lesson.
 *
 * Takes the attempt records and nothing else. There is no parameter for "marked as read", because it would not
 * change the answer.
 */
export function lessonStanding(lesson: AcademyLesson, records: readonly Performance[]): LessonStanding {
  const counted = assessedTasks(lesson)
  const tasks = lesson.tasks.map((task) => standingForTask(task, records, lesson.assessment.countHinted))
  const demonstrated = counted.filter((task) => tasks.find((one) => one.taskId === task.id)?.demonstrated).map((task) => task.id)
  const outstanding = counted.map((task) => task.id).filter((id) => !demonstrated.includes(id))
  const needs = Math.max(0, Math.min(lesson.assessment.needs, counted.length))
  const complete = demonstrated.length >= needs && needs > 0
  return {
    lessonId: lesson.id,
    tasks,
    demonstrated,
    outstanding,
    needs,
    complete,
    progress: needs === 0 ? 0 : Math.min(1, demonstrated.length / needs),
    says: complete
      ? `Done: ${demonstrated.length} of ${counted.length} tasks shown.`
      : needs === 0
        ? 'This lesson has nothing to demonstrate yet.'
        : `${demonstrated.length} of ${needs} tasks done. Reading the rest will not finish it -- the tasks will.`
  }
}

/** Which lessons are open, which are waiting on something, and what they are waiting on. */
export interface LessonAvailability {
  lessonId: string
  open: boolean
  /** Concepts the lesson needs that no completed lesson has taught. */
  waitingOn: readonly string[]
  says: string
}

export function availability(curriculum: Curriculum, records: readonly Performance[]): LessonAvailability[] {
  const lessons = lessonsOf(curriculum)
  const taught = new Set<string>()
  for (const lesson of lessons) {
    if (lessonStanding(lesson, records).complete) for (const concept of lesson.concepts) taught.add(concept)
  }
  const named = new Map(curriculum.concepts.map((concept) => [concept.id, concept.name]))
  return lessons.map((lesson) => {
    const waitingOn = lesson.requires.filter((concept) => !taught.has(concept))
    return {
      lessonId: lesson.id,
      open: waitingOn.length === 0,
      waitingOn,
      says: waitingOn.length === 0
        ? 'Open.'
        : `Needs ${waitingOn.map((concept) => named.get(concept) ?? concept).join(', ')} first.`
    }
  })
}

/** The next lesson worth doing: the first open one that is not finished. */
export function nextLesson(curriculum: Curriculum, records: readonly Performance[]): AcademyLesson | null {
  const open = new Map(availability(curriculum, records).map((one) => [one.lessonId, one.open]))
  for (const lesson of lessonsOf(curriculum)) {
    if (!open.get(lesson.id)) continue
    if (!lessonStanding(lesson, records).complete) return lesson
  }
  return null
}

export interface CurriculumStanding {
  lessons: readonly LessonStanding[]
  complete: number
  total: number
  /** 0..1, over lessons, from demonstrated tasks only. */
  progress: number
  says: string
}

export function curriculumStanding(curriculum: Curriculum, records: readonly Performance[]): CurriculumStanding {
  const lessons = lessonsOf(curriculum).map((lesson) => lessonStanding(lesson, records))
  const complete = lessons.filter((one) => one.complete).length
  return {
    lessons,
    complete,
    total: lessons.length,
    progress: lessons.length === 0 ? 0 : complete / lessons.length,
    says: lessons.length === 0 ? 'Nothing here yet.' : `${complete} of ${lessons.length} lessons done.`
  }
}

// ---------------------------------------------------------------- checking the content

export type LessonProblemCode =
  | 'duplicate-id'
  | 'no-title'
  | 'no-objectives'
  | 'no-tasks'
  | 'task-not-verified'
  | 'task-rejected'
  | 'missing-task'
  | 'assessment-impossible'
  | 'unknown-concept'
  | 'teaches-nothing'
  | 'concept-not-taught'
  | 'concept-cycle'
  | 'bad-board'
  | 'bad-line'
  | 'no-minutes'

export interface LessonProblem {
  code: LessonProblemCode
  severity: 'fault' | 'caution'
  says: string
  lessonId?: string
  taskId?: string
}

export interface LessonCheck {
  ok: boolean
  problems: readonly LessonProblem[]
  /** Every task's own check, by task id. */
  tasks: ReadonlyMap<string, ExerciseCheck>
}

/**
 * Whether a lesson is sound.
 *
 * Every task goes through `validateExercise`, and a task that is not **verified** is a fault, not a warning: a
 * lesson that teaches with a position nobody has checked is the thing this whole layer exists to prevent. Boards
 * and lines in the content are checked too -- a diagram with an impossible position is just as wrong as a broken
 * task, and nothing else would ever catch it.
 */
export function validateLesson(lesson: AcademyLesson, now?: number): LessonCheck {
  const problems: LessonProblem[] = []
  const tasks = new Map<string, ExerciseCheck>()
  const fault = (code: LessonProblemCode, says: string, taskId?: string): void => {
    problems.push({ code, severity: 'fault', says, lessonId: lesson.id, ...(taskId ? { taskId } : {}) })
  }
  const caution = (code: LessonProblemCode, says: string, taskId?: string): void => {
    problems.push({ code, severity: 'caution', says, lessonId: lesson.id, ...(taskId ? { taskId } : {}) })
  }

  if (!lesson.title.trim()) fault('no-title', 'The lesson has no title.')
  if (lesson.objectives.length === 0) fault('no-objectives', 'The lesson does not say what somebody will be able to do afterwards.')
  if (lesson.concepts.length === 0) fault('teaches-nothing', 'The lesson teaches no concept, so nothing it does can be measured.')
  if (!(lesson.minutes > 0)) fault('no-minutes', 'The lesson does not say how long it takes.')

  const seen = new Set<string>()
  for (const task of lesson.tasks) {
    if (seen.has(task.id)) fault('duplicate-id', `Two tasks share the id ${task.id}.`, task.id)
    seen.add(task.id)
    const check = validateExercise(task, now)
    tasks.set(task.id, check)
    if (!check.ok) {
      fault('task-rejected', `${task.id}: ${check.problems.filter((p) => p.severity === 'fault').map((p) => p.says).join(' ')}`, task.id)
    } else if (check.verification.status !== 'verified') {
      fault('task-not-verified', `${task.id} cannot be checked by the rules alone (${check.verification.needs ?? 'unknown'}), so it must not be taught as if it had been.`, task.id)
    }
  }

  for (const block of lesson.blocks) {
    if (block.kind === 'board') {
      if (!checkFen(block.fen).ok) fault('bad-board', `A diagram in this lesson is not a legal position: ${checkFen(block.fen).reason ?? ''}`.trim())
      for (const square of block.highlight ?? []) {
        if (!/^[a-h][1-8]$/.test(square)) fault('bad-board', `A diagram highlights "${square}", which is not a square.`)
      }
    }
    if (block.kind === 'moves') {
      if (!checkFen(block.fen).ok) {
        fault('bad-line', 'A line in this lesson starts from a position that is not legal.')
      } else {
        const asExercise = validateExercise(
          {
            id: `${lesson.id}-line`,
            kind: 'lesson-task',
            startFen: block.fen,
            sideToMove: block.fen.trim().split(/\s+/)[1] === 'b' ? 'b' : 'w',
            objective: 'reconstruct',
            prompt: block.caption ?? 'A line shown in the lesson.',
            solution: { lines: nestLine(block.moves) },
            failure: [],
            hints: [],
            source: { kind: 'authored' },
            verification: { status: 'unverified' },
            tags: []
          },
          now
        )
        // Only the problems about the moves themselves: the stand-in exercise has no answer to check against, and
        // would complain about that too.
        const aboutTheMoves = new Set(['illegal-move', 'line-continues-after-end', 'opponent-ends-line', 'already-over', 'bad-position'])
        const broken = asExercise.problems.find((p) => aboutTheMoves.has(p.code))
        if (broken) fault('bad-line', `A line in this lesson cannot be played: ${broken.says}`)
      }
    }
    if (block.kind === 'task' && !lesson.tasks.some((task) => task.id === block.taskId)) {
      fault('missing-task', `The lesson places a task "${block.taskId}" that it does not contain.`)
    }
  }

  for (const id of lesson.assessment.taskIds) {
    if (!lesson.tasks.some((task) => task.id === id)) {
      fault('missing-task', `The assessment names a task "${id}" that the lesson does not contain.`)
    }
  }
  const counted = assessedTasks(lesson)
  if (counted.length === 0) fault('no-tasks', 'The lesson has nothing to demonstrate, so it could only ever be finished by opening it.')
  if (lesson.assessment.needs > counted.length) {
    fault('assessment-impossible', `The assessment asks for ${lesson.assessment.needs} tasks and the lesson has ${counted.length}.`)
  }
  if (lesson.assessment.needs < 1 && counted.length > 0) {
    caution('assessment-impossible', 'The assessment asks for no tasks, which means the lesson finishes itself.')
  }

  return { ok: problems.every((p) => p.severity !== 'fault'), problems, tasks }
}

/** A straight line of moves as a one-branch tree. */
export function nestLine(moves: readonly string[]): MoveNode[] {
  if (moves.length === 0) return []
  const build = (index: number): MoveNode =>
    index === moves.length - 1 ? { move: moves[index] } : { move: moves[index], children: [build(index + 1)] }
  return [build(0)]
}

export interface CurriculumCheck {
  ok: boolean
  problems: readonly LessonProblem[]
  /** How many exercises there are, and how they came out. */
  counted: { tasks: number; verified: number; rejected: number; unverified: number }
  tasks: ReadonlyMap<string, ExerciseCheck>
}

/**
 * Whether a whole curriculum is sound.
 *
 * On top of every lesson's own check: ids are unique across the curriculum, every concept a lesson needs is taught
 * by a lesson that comes earlier, and the concept graph does not loop. The order matters as much as the content --
 * a lesson that needs something taught three lessons later is unteachable, and nothing but an order walk finds it.
 */
export function validateCurriculum(curriculum: Curriculum, now?: number): CurriculumCheck {
  const problems: LessonProblem[] = []
  const tasks = new Map<string, ExerciseCheck>()
  const counted = { tasks: 0, verified: 0, rejected: 0, unverified: 0 }
  const fault = (code: LessonProblemCode, says: string, lessonId?: string, taskId?: string): void => {
    problems.push({ code, severity: 'fault', says, ...(lessonId ? { lessonId } : {}), ...(taskId ? { taskId } : {}) })
  }

  const conceptIds = new Set<string>()
  for (const concept of curriculum.concepts) {
    if (conceptIds.has(concept.id)) fault('duplicate-id', `Two concepts share the id ${concept.id}.`)
    conceptIds.add(concept.id)
  }
  for (const concept of curriculum.concepts) {
    for (const needed of concept.requires) {
      if (!conceptIds.has(needed)) fault('unknown-concept', `The concept ${concept.id} requires ${needed}, which the curriculum does not have.`)
    }
  }

  // Loops in the concept graph, found by walking it.
  const requiring = new Map(curriculum.concepts.map((concept) => [concept.id, concept.requires]))
  const state = new Map<string, 'open' | 'done'>()
  const walk = (id: string, trail: string[]): void => {
    if (state.get(id) === 'done') return
    if (state.get(id) === 'open') {
      fault('concept-cycle', `The concepts ${[...trail, id].join(' -> ')} depend on each other in a circle.`)
      return
    }
    state.set(id, 'open')
    for (const needed of requiring.get(id) ?? []) walk(needed, [...trail, id])
    state.set(id, 'done')
  }
  for (const concept of curriculum.concepts) walk(concept.id, [])

  const lessonIds = new Set<string>()
  const taskIds = new Set<string>()
  const taughtSoFar = new Set<string>()

  for (const lesson of lessonsOf(curriculum)) {
    if (lessonIds.has(lesson.id)) fault('duplicate-id', `Two lessons share the id ${lesson.id}.`, lesson.id)
    lessonIds.add(lesson.id)

    for (const concept of [...lesson.concepts, ...lesson.requires]) {
      if (!conceptIds.has(concept)) fault('unknown-concept', `The lesson ${lesson.id} names the concept ${concept}, which the curriculum does not have.`, lesson.id)
    }
    for (const needed of lesson.requires) {
      if (!taughtSoFar.has(needed)) {
        fault('concept-not-taught', `The lesson ${lesson.id} needs ${needed}, and no lesson before it teaches that.`, lesson.id)
      }
    }

    const check = validateLesson(lesson, now)
    problems.push(...check.problems)
    for (const [id, result] of check.tasks) {
      if (taskIds.has(id)) fault('duplicate-id', `Two tasks share the id ${id}.`, lesson.id, id)
      taskIds.add(id)
      tasks.set(id, result)
      counted.tasks += 1
      if (!result.ok) counted.rejected += 1
      else if (result.verification.status === 'verified') counted.verified += 1
      else counted.unverified += 1
    }

    for (const concept of lesson.concepts) taughtSoFar.add(concept)
  }

  return { ok: problems.every((p) => p.severity !== 'fault'), problems, counted, tasks }
}

/** The curriculum with every task's verification worked out, for loading once and using everywhere. */
export function verifyCurriculum(curriculum: Curriculum, now?: number): Curriculum {
  return {
    ...curriculum,
    modules: curriculum.modules.map((module) => ({
      ...module,
      lessons: module.lessons.map((lesson) => ({
        ...lesson,
        tasks: lesson.tasks.map((task) => ({ ...task, verification: validateExercise(task, now).verification }))
      }))
    }))
  }
}
