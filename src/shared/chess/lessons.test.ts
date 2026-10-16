import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  READING_COUNTS_TOWARD_COMPLETION, allTasks, assessedTasks, availability, curriculumStanding, findLesson, findTask,
  lessonStanding, lessonsOf, nestLine, nextLesson, validateCurriculum, validateLesson,
  type AcademyLesson, type Curriculum
} from './lessons.ts'
import { FORGIVING_FAILURE, newExercise, type Exercise } from './exercise.ts'
import type { Performance } from './attempt.ts'
import { CHESS_CURRICULUM } from './curriculum.ts'

/**
 * The rule under test: a lesson is finished by doing its tasks, and by nothing else.
 */

const mateTask = (id: string): Exercise => newExercise({
  id,
  kind: 'lesson-task',
  startFen: '7k/8/6K1/8/8/8/8/5Q2 w - - 0 1',
  objective: 'mate-in-n',
  movesToMate: 1,
  prompt: 'Mate in one.',
  solution: { lines: [{ move: 'f1f8' }] },
  failure: FORGIVING_FAILURE,
  hints: [{ level: 1, text: 'The back rank.', shows: 'theme' }],
  source: { kind: 'generated', by: 'forcedMateTree', note: 'From an exhaustive search.' }
})

const lesson = (over: Partial<AcademyLesson> = {}): AcademyLesson => ({
  id: 'one',
  title: 'A lesson',
  intro: 'Something worth knowing.',
  objectives: ['Mate in one'],
  requires: [],
  concepts: ['checkmate'],
  blocks: [{ kind: 'text', text: 'Mate is the end of the game.' }, { kind: 'task', taskId: 't1' }],
  tasks: [mateTask('t1'), mateTask('t2')],
  assessment: { id: 'a', title: 'Check', taskIds: [], needs: 2, countHinted: false },
  minutes: 10,
  difficulty: 'beginner',
  ...over
})

const did = (exerciseId: string, over: Partial<Performance> = {}): Performance => ({
  exerciseId,
  solved: true,
  gaveUp: false,
  hintsUsed: 0,
  worth: 1,
  wrongMoves: 0,
  illegalTries: 0,
  seconds: 20,
  at: 0,
  ...over
})

// ---------------------------------------------------------------- completion

test('reading a lesson finishes nothing', () => {
  assert.equal(READING_COUNTS_TOWARD_COMPLETION, false)
  const standing = lessonStanding(lesson(), [])
  assert.equal(standing.complete, false)
  assert.equal(standing.progress, 0)
  assert.deepEqual(standing.outstanding, ['t1', 't2'])
  assert.match(standing.says, /Reading the rest will not finish it/)
  // There is no argument that could say "they read it", which is the point.
  assert.equal(lessonStanding(lesson(), []).demonstrated.length, 0)
})

test('a lesson is finished by demonstrating its tasks', () => {
  const half = lessonStanding(lesson(), [did('t1')])
  assert.equal(half.complete, false)
  assert.deepEqual(half.demonstrated, ['t1'])
  assert.equal(half.progress, 0.5)

  const whole = lessonStanding(lesson(), [did('t1'), did('t2')])
  assert.equal(whole.complete, true)
  assert.equal(whole.progress, 1)
  assert.match(whole.says, /Done/)
})

test('a task solved with the move on screen is practice, and does not count', () => {
  const shown = lessonStanding(lesson(), [did('t1', { worth: 0, hintsUsed: 3 }), did('t2')])
  assert.equal(shown.complete, false)
  assert.deepEqual(shown.demonstrated, ['t2'])
  const task = shown.tasks.find((one) => one.taskId === 't1')
  assert.equal(task?.solvedSomehow, true)
  assert.equal(task?.demonstrated, false)
  assert.match(task?.says ?? '', /practice rather than a solve/)

  // A course that says otherwise may say so, and it has to say so.
  const lenient = lesson({ assessment: { id: 'a', title: 'Check', taskIds: [], needs: 2, countHinted: true } })
  assert.equal(lessonStanding(lenient, [did('t1', { worth: 0 }), did('t2')]).complete, true)
})

test('a failed attempt is recorded and is not a demonstration', () => {
  const tried = lessonStanding(lesson(), [did('t1', { solved: false }), did('t1', { solved: false })])
  assert.equal(tried.complete, false)
  const task = tried.tasks.find((one) => one.taskId === 't1')
  assert.equal(task?.attempts, 2)
  assert.equal(task?.demonstrated, false)
  assert.match(task?.says ?? '', /not solved yet/)
})

test('an assessment can count some of a lesson’s tasks rather than all of them', () => {
  const picky = lesson({ assessment: { id: 'a', title: 'Check', taskIds: ['t2'], needs: 1, countHinted: false } })
  assert.deepEqual(assessedTasks(picky).map((task) => task.id), ['t2'])
  assert.equal(lessonStanding(picky, [did('t1')]).complete, false)
  assert.equal(lessonStanding(picky, [did('t2')]).complete, true)
})

// ---------------------------------------------------------------- order

const twoLessons: Curriculum = {
  id: 'c',
  title: 'Two lessons',
  blurb: 'One after the other.',
  version: 1,
  concepts: [
    { id: 'checkmate', name: 'Checkmate', blurb: 'The end of the game.', requires: [], weight: 1 },
    { id: 'basic-mates', name: 'Basic mates', blurb: 'King and queen.', requires: ['checkmate'], weight: 1 }
  ],
  modules: [
    {
      id: 'm',
      title: 'Module',
      summary: 'Two lessons.',
      lessons: [
        lesson({ id: 'first', concepts: ['checkmate'], requires: [] }),
        lesson({
          id: 'second',
          concepts: ['basic-mates'],
          requires: ['checkmate'],
          tasks: [mateTask('t3')],
          blocks: [{ kind: 'task', taskId: 't3' }],
          assessment: { id: 'a2', title: 'Check', taskIds: [], needs: 1, countHinted: false }
        })
      ]
    }
  ]
}

test('a lesson waits for what it needs, and says what it is waiting on', () => {
  const closed = availability(twoLessons, [])
  assert.equal(closed.find((one) => one.lessonId === 'first')?.open, true)
  const second = closed.find((one) => one.lessonId === 'second')
  assert.equal(second?.open, false)
  assert.deepEqual(second?.waitingOn, ['checkmate'])
  assert.match(second?.says ?? '', /Needs Checkmate first/)
  assert.equal(nextLesson(twoLessons, [])?.id, 'first')

  const afterFirst = [did('t1'), did('t2')]
  assert.equal(availability(twoLessons, afterFirst).find((one) => one.lessonId === 'second')?.open, true)
  assert.equal(nextLesson(twoLessons, afterFirst)?.id, 'second')

  const afterBoth = [...afterFirst, did('t3')]
  assert.equal(nextLesson(twoLessons, afterBoth), null)
  const standing = curriculumStanding(twoLessons, afterBoth)
  assert.equal(standing.complete, 2)
  assert.equal(standing.progress, 1)
  assert.match(standing.says, /2 of 2/)
})

test('a curriculum can be looked through', () => {
  assert.equal(lessonsOf(twoLessons).length, 2)
  assert.equal(allTasks(twoLessons).length, 3)
  assert.equal(findLesson(twoLessons, 'second')?.id, 'second')
  assert.equal(findLesson(twoLessons, 'nope'), null)
  assert.equal(findTask(twoLessons, 't3')?.id, 't3')
  assert.equal(findTask(twoLessons, 'nope'), null)
})

// ---------------------------------------------------------------- checking content

test('a sound lesson passes, and every task is checked by the exercise validator', () => {
  const check = validateLesson(lesson(), 100)
  assert.equal(check.ok, true, check.problems.map((p) => p.says).join(' / '))
  assert.equal(check.tasks.size, 2)
  assert.equal(check.tasks.get('t1')?.verification.status, 'verified')
})

test('a lesson with content a machine cannot stand behind is refused', () => {
  const codes = (one: AcademyLesson): string[] => validateLesson(one).problems.filter((p) => p.severity === 'fault').map((p) => p.code)

  assert.ok(codes(lesson({ title: ' ' })).includes('no-title'))
  assert.ok(codes(lesson({ objectives: [] })).includes('no-objectives'))
  assert.ok(codes(lesson({ concepts: [] })).includes('teaches-nothing'))
  assert.ok(codes(lesson({ minutes: 0 })).includes('no-minutes'))
  assert.ok(codes(lesson({ tasks: [] })).includes('no-tasks'), 'a lesson with nothing to do could only be finished by opening it')
  assert.ok(codes(lesson({ assessment: { id: 'a', title: 'x', taskIds: [], needs: 5, countHinted: false } })).includes('assessment-impossible'))
  assert.ok(codes(lesson({ assessment: { id: 'a', title: 'x', taskIds: ['nope'], needs: 1, countHinted: false } })).includes('missing-task'))
  assert.ok(codes(lesson({ blocks: [{ kind: 'task', taskId: 'nope' }] })).includes('missing-task'))
  assert.ok(codes(lesson({ tasks: [mateTask('t1'), mateTask('t1')] })).includes('duplicate-id'))

  // A diagram that is not a legal position is as wrong as a broken task, and nothing else would catch it.
  assert.ok(codes(lesson({ blocks: [{ kind: 'board', fen: 'nonsense', caption: 'x' }] })).includes('bad-board'))
  assert.ok(codes(lesson({ blocks: [{ kind: 'board', fen: '7k/8/6K1/8/8/8/8/5Q2 w - - 0 1', highlight: ['z9'] }] })).includes('bad-board'))
  // A line in the text that cannot be played, likewise.
  assert.ok(codes(lesson({ blocks: [{ kind: 'moves', fen: '7k/8/6K1/8/8/8/8/5Q2 w - - 0 1', moves: ['Qf8', 'Kh7'] }] })).includes('bad-line'))
  assert.deepEqual(codes(lesson({ blocks: [{ kind: 'moves', fen: '7k/8/5K2/8/8/8/8/R7 w - - 0 1', moves: ['Kg6', 'Kg8', 'Ra8'] }] })), [])
})

test('a task the rules cannot settle may not be taught as if they had', () => {
  const guess = newExercise({
    id: 'guess',
    kind: 'lesson-task',
    startFen: '7k/8/6K1/8/8/8/8/5Q2 w - - 0 1',
    objective: 'find-best',
    prompt: 'What is the best move?',
    solution: { lines: [{ move: 'f1f8' }] },
    source: { kind: 'authored' }
  })
  const check = validateLesson(lesson({ tasks: [guess] }))
  assert.equal(check.ok, false)
  const problem = check.problems.find((p) => p.code === 'task-not-verified')
  assert.ok(problem, check.problems.map((p) => p.code).join(','))
  assert.match(problem?.says ?? '', /engine/)
})

test('a curriculum is checked in order, and a lesson cannot need what comes later', () => {
  const backwards: Curriculum = {
    ...twoLessons,
    modules: [{ ...twoLessons.modules[0], lessons: [...twoLessons.modules[0].lessons].reverse() }]
  }
  const check = validateCurriculum(backwards)
  assert.equal(check.ok, false)
  const problem = check.problems.find((p) => p.code === 'concept-not-taught')
  assert.match(problem?.says ?? '', /needs checkmate/)
  assert.equal(validateCurriculum(twoLessons).ok, true)
})

test('a loop in the concept graph is found', () => {
  const looped: Curriculum = {
    ...twoLessons,
    concepts: [
      { id: 'checkmate', name: 'Checkmate', blurb: 'The end of the game.', requires: ['basic-mates'], weight: 1 },
      { id: 'basic-mates', name: 'Basic mates', blurb: 'King and queen.', requires: ['checkmate'], weight: 1 }
    ]
  }
  const check = validateCurriculum(looped)
  assert.equal(check.ok, false)
  assert.ok(check.problems.some((p) => p.code === 'concept-cycle'), check.problems.map((p) => p.code).join(','))
})

test('a concept nothing declares is refused', () => {
  const unknown: Curriculum = {
    ...twoLessons,
    modules: [{ ...twoLessons.modules[0], lessons: [lesson({ id: 'x', concepts: ['nonsense'] })] }]
  }
  assert.ok(validateCurriculum(unknown).problems.some((p) => p.code === 'unknown-concept'))
})

test('a line becomes a one-branch tree, and an empty one becomes nothing', () => {
  assert.deepEqual(nestLine([]), [])
  assert.deepEqual(nestLine(['e4']), [{ move: 'e4' }])
  assert.deepEqual(nestLine(['e4', 'e5']), [{ move: 'e4', children: [{ move: 'e5' }] }])
  assert.deepEqual(nestLine(['e4', 'e5', 'Nf3']), [{ move: 'e4', children: [{ move: 'e5', children: [{ move: 'Nf3' }] }] }])
})

test('the real curriculum is what these rules are for', () => {
  const first = lessonsOf(CHESS_CURRICULUM)[0]
  assert.equal(lessonStanding(first, []).complete, false)
  assert.equal(availability(CHESS_CURRICULUM, [])[0].open, true, 'the first lesson needs nothing')
  assert.equal(nextLesson(CHESS_CURRICULUM, [])?.id, first.id)
  const standing = curriculumStanding(CHESS_CURRICULUM, [])
  assert.equal(standing.complete, 0)
  assert.equal(standing.total, lessonsOf(CHESS_CURRICULUM).length)
})
