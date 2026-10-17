import { strict as assert } from 'node:assert'
import test from 'node:test'
import { CHESS_CURRICULUM } from './curriculum.ts'
import { lessonsOf, type AcademyLesson, type LessonBlock } from './lessons.ts'
import { START_FEN } from './rules.ts'
import {
  blockOfStep, boardForStep, clampStep, lessonSteps, stepForKey, stepOfBlock, stepOfTask, stepWords, taskSteps,
  walkLine, walkedShare
} from './lessonStage.ts'

const LESSONS = lessonsOf(CHESS_CURRICULUM)

/** A lesson built out of a real one, so its tasks are the real checked ones, with blocks of our choosing. */
function withBlocks(blocks: LessonBlock[]): AcademyLesson {
  const base = LESSONS.find((one) => one.tasks.length > 0)
  assert.ok(base, 'the curriculum should have a lesson with a task in it')
  return { ...(base as AcademyLesson), blocks }
}

test('the walk is the intro, every block, and the assessment', () => {
  const lesson = withBlocks([
    { kind: 'heading', text: 'How the rook moves' },
    { kind: 'text', text: 'It goes along a rank or a file, as far as it likes.' }
  ])
  const steps = lessonSteps(lesson)
  assert.equal(steps.length, 4)
  assert.equal(steps[0].kind, 'intro')
  assert.equal(steps[1].kind, 'heading')
  assert.equal(steps[3].kind, 'assessment')
  assert.deepEqual(steps.map((one) => one.index), [0, 1, 2, 3])
})

test('a step with no position of its own keeps the last one the lesson gave', () => {
  const fen = '8/8/8/8/8/8/8/R6k w - - 0 1'
  const lesson = withBlocks([
    { kind: 'board', fen, caption: 'The rook cuts the king off' },
    { kind: 'text', text: 'That is the whole idea.' },
    { kind: 'list', items: ['Cut it off', 'Walk your king up'] }
  ])
  const onTheBoard = boardForStep(lesson, 1)
  assert.equal(onTheBoard.fen, fen)
  assert.equal(onTheBoard.source, 'block')

  const carried = boardForStep(lesson, 3)
  assert.equal(carried.fen, fen, 'the list step should still be showing the position above it')
  assert.equal(carried.source, 'carried')
  assert.equal(carried.fromStep, 1)
  assert.match(carried.says, /step 2/)
})

test('a lesson that has not given a position yet shows the starting position and says so', () => {
  const lesson = withBlocks([{ kind: 'text', text: 'Chess is played on sixty-four squares.' }])
  const board = boardForStep(lesson, 1)
  assert.equal(board.fen, START_FEN)
  assert.equal(board.source, 'start')
  assert.match(board.says, /starting position/i)
})

test('a task step puts the task position on the board, the right way up', () => {
  const lesson = LESSONS.find((one) => one.tasks.length > 0 && one.blocks.some((block) => block.kind === 'task'))
  assert.ok(lesson, 'the curriculum should place at least one task in a lesson')
  const found = lesson as AcademyLesson
  const steps = taskSteps(found)
  assert.ok(steps.length > 0)
  const board = boardForStep(found, steps[0].index)
  const task = found.tasks.find((one) => one.id === steps[0].taskId)
  assert.ok(task)
  assert.equal(board.source, 'task')
  assert.equal(board.fen, task?.startFen)
  assert.equal(board.orientation, task?.sideToMove)
})

test('a task being attempted shows the position it has moved to', () => {
  const lesson = LESSONS.find((one) => one.blocks.some((block) => block.kind === 'task')) as AcademyLesson
  const step = taskSteps(lesson)[0].index
  const moved = '8/8/8/8/8/8/8/R6k b - - 1 1'
  assert.equal(boardForStep(lesson, step, { liveFen: moved }).fen, moved)
})

test('every step of every lesson in the curriculum has a position on the board', () => {
  for (const lesson of LESSONS) {
    const steps = lessonSteps(lesson)
    for (const step of steps) {
      const board = boardForStep(lesson, step.index)
      assert.equal(typeof board.fen, 'string')
      assert.ok(board.fen.length > 0, `${lesson.id} step ${step.index} had no position`)
      assert.ok(board.says.length > 0)
    }
  }
})

test('a written line is played out through the rules and stops where it stops', () => {
  const good = walkLine(START_FEN, ['e4', 'e5', 'Nf3'])
  assert.equal(good.broken, false)
  assert.equal(good.says, null)
  assert.equal(good.fens.length, 4)
  assert.deepEqual([...good.san], ['e4', 'e5', 'Nf3'])

  const bad = walkLine(START_FEN, ['e4', 'Qh5'])
  assert.equal(bad.broken, true)
  assert.equal(bad.san.length, 1)
  assert.match(bad.says ?? '', /cannot be played out past e4/)

  const wrongFromTheStart = walkLine(START_FEN, ['Kd2'])
  assert.equal(wrongFromTheStart.broken, true)
  assert.match(wrongFromTheStart.says ?? '', /the position it starts from/)
})

test('a line step keeps its moves and a step after it does not', () => {
  const lesson = withBlocks([
    { kind: 'moves', fen: START_FEN, moves: ['e4', 'e5'], caption: 'The open game' },
    { kind: 'text', text: 'Both sides have taken the middle.' }
  ])
  assert.deepEqual([...boardForStep(lesson, 1).moves], ['e4', 'e5'])
  assert.equal(boardForStep(lesson, 2).source, 'carried')
  assert.deepEqual([...boardForStep(lesson, 2).moves], ['e4', 'e5'])
})

test('a step number is kept inside the walk', () => {
  const steps = lessonSteps(withBlocks([{ kind: 'text', text: 'One block.' }]))
  assert.equal(clampStep(-4, steps), 0)
  assert.equal(clampStep(99, steps), steps.length - 1)
  assert.equal(clampStep(Number.NaN, steps), 0)
  assert.equal(clampStep(1.7, steps), 1)
})

test('the stored block number and the step number convert both ways', () => {
  assert.equal(blockOfStep(0), 0)
  assert.equal(blockOfStep(1), 0)
  assert.equal(blockOfStep(5), 4)
  assert.equal(stepOfBlock(0), 1)
  assert.equal(stepOfBlock(4), 5)
  assert.equal(blockOfStep(stepOfBlock(3)), 3)
})

test('the keys move through the walk and refuse at the ends', () => {
  const steps = lessonSteps(withBlocks([{ kind: 'text', text: 'a' }, { kind: 'text', text: 'b' }]))
  const last = steps.length - 1
  assert.equal(stepForKey('ArrowRight', 0, steps), 1)
  assert.equal(stepForKey('ArrowLeft', 0, steps), null)
  assert.equal(stepForKey('ArrowRight', last, steps), null)
  assert.equal(stepForKey('End', 0, steps), last)
  assert.equal(stepForKey('Home', last, steps), 0)
  assert.equal(stepForKey('Home', 0, steps), null)
  assert.equal(stepForKey('k', 1, steps), null)
})

test('how far through is a share of the walk and nothing else', () => {
  const steps = lessonSteps(withBlocks([{ kind: 'text', text: 'a' }, { kind: 'text', text: 'b' }]))
  assert.equal(walkedShare(0, steps), 0)
  assert.equal(walkedShare(steps.length - 1, steps), 1)
  assert.ok(walkedShare(1, steps) > 0 && walkedShare(1, steps) < 1)
})

test('where you are is said in words, and the task a step shows can be found again', () => {
  const lesson = LESSONS.find((one) => one.blocks.some((block) => block.kind === 'task')) as AcademyLesson
  const steps = lessonSteps(lesson)
  assert.match(stepWords(0, steps), /start of the lesson/i)
  assert.match(stepWords(steps.length - 1, steps), /Where you stand/i)
  const taskId = taskSteps(lesson)[0].taskId as string
  assert.equal(stepOfTask(lesson, taskId), taskSteps(lesson)[0].index)
  assert.equal(stepOfTask(lesson, 'nothing-like-this'), null)
})
