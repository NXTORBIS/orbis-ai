import { START_FEN, applyMove } from './rules.ts'
import type { AcademyLesson, BoardArrow, LessonBlock } from './lessons.ts'

/**
 * What a lesson puts on the board at every point in it.
 *
 * ## Why this exists
 *
 * A lesson used to be a walk through its blocks, and a block was only sometimes a position. So eleven of the
 * seventeen lessons showed a heading, a paragraph, a list or a table with no board on screen at all -- a page of
 * writing about chess. The board is the thing the Academy is about, so it is now always there, and this module is
 * what decides which position is on it.
 *
 * ## The rule it follows
 *
 * The board shows **the last position the lesson actually gave**. A paragraph that comes after a diagram is talking
 * about that diagram, so the diagram stays up while the paragraph is read. A paragraph that comes before any
 * position at all gets the starting position, and the screen says that is what it is rather than letting somebody
 * believe a point is being made about it.
 *
 * Nothing here invents a position. Every fen on the board came out of the lesson's own content, or it is the
 * standard starting position named as such, and a line is walked through the real rules so a line the content got
 * wrong is cut short and said out loud instead of drawn.
 *
 * Pure: no clock, no storage, no screen.
 */

/** What a step of a lesson is, which decides what goes beside the board. */
export type LessonStepKind = 'intro' | 'heading' | 'text' | 'list' | 'callout' | 'table' | 'board' | 'moves' | 'task' | 'assessment'

export interface LessonStep {
  /** Where it is in the walk, counting from zero. */
  index: number
  kind: LessonStepKind
  /** The block this step draws, or null for the intro and the assessment, which are not blocks. */
  block: LessonBlock | null
  /** A few words for the outline beside the board. Never more than a line. */
  label: string
  /** Set when this step is one of the lesson's tasks. */
  taskId: string | null
  /** True when the step carries a position of its own rather than borrowing the one before it. */
  carriesBoard: boolean
}

/** Where the position on the board came from. The screen says this, because it changes what the board means. */
export type BoardSource = 'block' | 'line' | 'task' | 'carried' | 'start'

export interface LessonBoard {
  fen: string
  orientation: 'w' | 'b'
  highlight: readonly string[]
  arrows: readonly BoardArrow[]
  /** The line this position belongs to, when the step is a line to step through. Empty otherwise. */
  moves: readonly string[]
  source: BoardSource
  /** Which step the position came from. The same as the step asked about unless it was carried forward. */
  fromStep: number
  /** One short line saying what is on the board, for the caption and for anybody reading the screen out. */
  says: string
}

export interface LineWalk {
  /** Every position the line passes through, starting with the one it was given. */
  fens: readonly string[]
  san: readonly string[]
  uci: readonly string[]
  /** True when the content asked for a move that cannot be played, so the rest of the line is not shown. */
  broken: boolean
  /** Said when it is broken, so the screen does not have to word the refusal itself. */
  says: string | null
}

/**
 * Play a written line out through the rules.
 *
 * A lesson's line is written by hand, so it can be wrong. Nothing is nudged into a nearby legal move: the walk
 * stops at the first move that cannot be played and says so.
 */
export function walkLine(fen: string, moves: readonly string[]): LineWalk {
  const fens: string[] = [fen]
  const san: string[] = []
  const uci: string[] = []
  let here = fen
  for (const move of moves) {
    const made = applyMove(here, move)
    if (!made) break
    here = made.after
    fens.push(made.after)
    san.push(made.san)
    uci.push(made.uci)
  }
  const broken = san.length !== moves.length
  return {
    fens,
    san,
    uci,
    broken,
    says: broken
      ? `This line cannot be played out past ${san.length === 0 ? 'the position it starts from' : san.join(' ')}, so the rest of it is not shown.`
      : null
  }
}

function firstWords(text: string, words: number): string {
  const parts = text.trim().split(/\s+/).filter((one) => one !== '')
  if (parts.length <= words) return parts.join(' ')
  return `${parts.slice(0, words).join(' ')}…`
}

function labelFor(block: LessonBlock): string {
  if (block.kind === 'heading') return firstWords(block.text, 6)
  if (block.kind === 'text') return firstWords(block.text, 6)
  if (block.kind === 'list') return block.items.length === 0 ? 'A list' : firstWords(block.items[0], 5)
  if (block.kind === 'callout') return block.tone === 'warning' ? 'Watch out' : block.tone === 'tip' ? 'Worth knowing' : 'A note'
  if (block.kind === 'table') return block.headers.length > 0 ? firstWords(block.headers.join(', '), 5) : 'A table'
  if (block.kind === 'board') return block.caption ? firstWords(block.caption, 5) : 'A position'
  if (block.kind === 'moves') return block.caption ? firstWords(block.caption, 5) : 'A line to play through'
  return 'A task'
}

/**
 * The whole walk through a lesson: an opening step, one per block, and the assessment at the end.
 *
 * The intro and the assessment are steps rather than extra screens because the board stays up for both of them,
 * and because the walk then has one set of numbers that the keyboard, the outline and the recorded place all agree
 * about.
 */
export function lessonSteps(lesson: AcademyLesson): LessonStep[] {
  const steps: LessonStep[] = [
    { index: 0, kind: 'intro', block: null, label: 'What this is for', taskId: null, carriesBoard: false }
  ]
  lesson.blocks.forEach((block, at) => {
    steps.push({
      index: at + 1,
      kind: block.kind,
      block,
      label: labelFor(block),
      taskId: block.kind === 'task' ? block.taskId : null,
      carriesBoard: block.kind === 'board' || block.kind === 'moves' || block.kind === 'task'
    })
  })
  steps.push({
    index: steps.length,
    kind: 'assessment',
    block: null,
    label: 'Where you stand',
    taskId: null,
    carriesBoard: false
  })
  return steps
}

/** Keep a step number inside the walk. */
export function clampStep(step: number, steps: readonly LessonStep[]): number {
  if (!Number.isFinite(step)) return 0
  const last = Math.max(0, steps.length - 1)
  return Math.max(0, Math.min(Math.floor(step), last))
}

/**
 * Which block number a step is, as the stored reading record counts them.
 *
 * The record was written before the intro became a step of its own, and it counts blocks: zero is the first block.
 * So the two numbering schemes are converted here, in one place, rather than each screen taking a guess.
 */
export function blockOfStep(step: number): number {
  return Math.max(0, step - 1)
}

/** And back again: the step that shows a given block. */
export function stepOfBlock(block: number): number {
  return Math.max(0, Math.floor(block)) + 1
}

function taskFen(lesson: AcademyLesson, taskId: string): { fen: string; orientation: 'w' | 'b' } | null {
  const task = lesson.tasks.find((one) => one.id === taskId)
  if (!task) return null
  return { fen: task.startFen, orientation: task.sideToMove }
}

/**
 * What is on the board at a step.
 *
 * `liveFen` is what a task being attempted has moved the position to. It is passed in rather than worked out here,
 * because the attempt is a running thing and this module has no state.
 */
export function boardForStep(
  lesson: AcademyLesson,
  step: number,
  options: { liveFen?: string | null } = {}
): LessonBoard {
  const steps = lessonSteps(lesson)
  const at = clampStep(step, steps)

  // The step itself, when it brought a position.
  const here = steps[at]
  if (here && here.block && here.block.kind === 'board') {
    const block = here.block
    return {
      fen: block.fen,
      orientation: 'w',
      highlight: block.highlight ?? [],
      arrows: block.arrows ?? [],
      moves: [],
      source: 'block',
      fromStep: at,
      says: block.caption ?? 'A position from this lesson.'
    }
  }
  if (here && here.block && here.block.kind === 'moves') {
    const block = here.block
    return {
      fen: block.fen,
      orientation: 'w',
      highlight: [],
      arrows: [],
      moves: block.moves,
      source: 'line',
      fromStep: at,
      says: block.caption ?? 'A line to play through, a move at a time.'
    }
  }
  if (here && here.taskId !== null) {
    const found = taskFen(lesson, here.taskId)
    if (found) {
      return {
        fen: options.liveFen ?? found.fen,
        orientation: found.orientation,
        highlight: [],
        arrows: [],
        moves: [],
        source: 'task',
        fromStep: at,
        says: 'The task is on the board. Play your move on it.'
      }
    }
  }

  // Nothing of its own, so the last position the lesson gave stays up: what is being said is about that position.
  for (let back = at - 1; back >= 0; back -= 1) {
    const earlier = steps[back]
    if (!earlier.carriesBoard) continue
    const carried = boardForStep(lesson, back)
    return {
      ...carried,
      moves: carried.source === 'line' ? carried.moves : [],
      source: 'carried',
      fromStep: back,
      says: `Still the position from step ${back + 1}: ${carried.says}`
    }
  }

  // The lesson has not given a position yet. The standard starting position, named as what it is.
  return {
    fen: START_FEN,
    orientation: 'w',
    highlight: [],
    arrows: [],
    moves: [],
    source: 'start',
    fromStep: at,
    says: 'The starting position. This lesson has not put a position of its own up yet.'
  }
}

/** Where you are in the lesson, in words, for anybody reading the screen rather than looking at it. */
export function stepWords(step: number, steps: readonly LessonStep[]): string {
  if (steps.length === 0) return 'This lesson has nothing in it.'
  const at = clampStep(step, steps)
  const which = steps[at]
  if (which.kind === 'intro') return `The start of the lesson. Step 1 of ${steps.length}.`
  if (which.kind === 'assessment') return `Where you stand. The last step, ${steps.length} of ${steps.length}.`
  return `Step ${at + 1} of ${steps.length}: ${which.label}`
}

/** Which way the arrow keys and the Back and Next buttons move. */
export function stepForKey(key: string, step: number, steps: readonly LessonStep[]): number | null {
  const last = Math.max(0, steps.length - 1)
  if (key === 'ArrowRight' || key === 'PageDown') return step >= last ? null : step + 1
  if (key === 'ArrowLeft' || key === 'PageUp') return step <= 0 ? null : step - 1
  if (key === 'Home') return step === 0 ? null : 0
  if (key === 'End') return step === last ? null : last
  return null
}

/**
 * How much of the lesson has been walked through, 0..1.
 *
 * It measures a walk and nothing else. It is never a measure of how much of the lesson was learnt, and the screen
 * that draws it says so: a lesson is finished when its tasks have been demonstrated.
 */
export function walkedShare(step: number, steps: readonly LessonStep[]): number {
  if (steps.length <= 1) return 0
  return clampStep(step, steps) / (steps.length - 1)
}

/** The steps that are one of the lesson's tasks, in the order the lesson puts them. */
export function taskSteps(lesson: AcademyLesson): LessonStep[] {
  return lessonSteps(lesson).filter((one) => one.taskId !== null)
}

/** The step a given task sits at, or null when the lesson's blocks never place it. */
export function stepOfTask(lesson: AcademyLesson, taskId: string): number | null {
  const found = lessonSteps(lesson).find((one) => one.taskId === taskId)
  return found ? found.index : null
}
