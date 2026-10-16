import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CHESS_CONCEPTS, CHESS_CURRICULUM } from './curriculum.ts'
import { validateCurriculum, allTasks, lessonsOf, verifyCurriculum } from './lessons.ts'
import { follow, validateExercise, type Exercise } from './exercise.ts'
import { judge } from './attempt.ts'
import { applyMove } from './rules.ts'

/**
 * The curriculum, checked from scratch.
 *
 * This is the test the whole content layer exists for. Every position in `curriculum.ts` is re-validated here, on
 * every run: the position must be legal and reachable, every solution move must be playable in the position it is
 * attached to, every mate claim must mate against every defence, every material claim must survive the recapture,
 * and every "show me the squares" answer must match what the rules actually allow.
 *
 * It also checks the thing a validator cannot: that each task can be *solved*, by playing its own first answer
 * through the judge and seeing a solve come back.
 */

test('every authored position passes the validator', () => {
  const check = validateCurriculum(CHESS_CURRICULUM, 1_000)
  const faults = check.problems.filter((p) => p.severity === 'fault')
  assert.deepEqual(
    faults.map((p) => `${p.lessonId ?? ''}/${p.taskId ?? ''}: ${p.code} -- ${p.says}`),
    [],
    'the curriculum must contain nothing a machine cannot check'
  )
  assert.equal(check.ok, true)
  assert.equal(check.counted.rejected, 0)
  assert.equal(check.counted.unverified, 0, 'nothing may be taught as checked when it is not')
  assert.equal(check.counted.verified, check.counted.tasks)
  // A floor rather than an exact number, so adding a lesson does not fail the suite for the wrong reason.
  assert.ok(check.counted.tasks >= 28, `only ${check.counted.tasks} tasks`)
  assert.ok(lessonsOf(CHESS_CURRICULUM).length >= 15, 'the curriculum should cover the rules, tactics and endings')
})

test('the task ids are unique across the whole curriculum', () => {
  const ids = allTasks(CHESS_CURRICULUM).map((task) => task.id)
  assert.deepEqual([...new Set(ids)].sort(), [...ids].sort())
  assert.equal(ids.length, new Set(ids).size)
})

test('every task can actually be solved by playing its own answer', () => {
  for (const task of allTasks(CHESS_CURRICULUM)) {
    if (task.objective === 'answer') continue
    const played: string[] = []
    let guard = 0
    let solved = false
    while (guard < 40) {
      guard += 1
      const walk = follow(task, played)
      if (walk.accepted.length === 0) break
      const next = applyMove(walk.fen, walk.accepted[0].move)
      assert.ok(next, `${task.id}: ${walk.accepted[0].move} cannot be played`)
      played.push(next.uci)
      const verdict = judge(task, played)
      assert.notEqual(verdict.kind, 'illegal', `${task.id}: the recorded answer was called illegal`)
      if (verdict.kind === 'solved') { solved = true; break }
      assert.ok(
        verdict.kind === 'on-track' || verdict.kind === 'not-the-idea',
        `${task.id}: unexpected verdict ${verdict.kind}`
      )
      assert.notEqual(verdict.kind, 'not-the-idea', `${task.id}: its own answer was called "not the idea"`)
    }
    assert.equal(solved, true, `${task.id} could not be solved by following its own solution`)
  }
})

test('every mate task mates in exactly the number of moves it claims', () => {
  for (const task of allTasks(CHESS_CURRICULUM)) {
    if (task.objective !== 'mate-in-n') continue
    const check = validateExercise(task)
    assert.equal(check.coverage, 'complete', `${task.id}: a mate claim needs every defence`)
    const deepest = Math.max(...check.lines.map((line) => line.solverMoves))
    assert.equal(deepest, task.movesToMate, task.id)
    for (const line of check.lines) assert.equal(line.endsIn, 'checkmate', `${task.id}: ${line.san.join(' ')}`)
  }
})

test('every task says where it came from and offers hints that end with the move', () => {
  for (const task of allTasks(CHESS_CURRICULUM)) {
    assert.ok(task.source.kind, `${task.id} has no provenance`)
    assert.ok((task.source.note ?? '').length > 10, `${task.id} does not say how it was checked`)
    assert.ok(task.prompt.length > 10, `${task.id} has no readable prompt`)
    assert.ok((task.lesson ?? '').length > 20, `${task.id} does not say what it taught`)
    assert.ok(task.hints.length >= 1, `${task.id} has no hints`)
    task.hints.forEach((hint, index) => {
      assert.equal(hint.level, index + 1, `${task.id} hint levels`)
      assert.ok(hint.text.trim().length > 3, `${task.id} hint ${hint.level}`)
    })
    const shown = task.hints.findIndex((hint) => hint.shows === 'move')
    if (shown !== -1) assert.equal(shown, task.hints.length - 1, `${task.id}: the move must be the last hint`)
  }
})

test('nothing in the curriculum claims an engine opinion', () => {
  for (const task of allTasks(CHESS_CURRICULUM)) {
    assert.notEqual(task.objective, 'find-best', `${task.id}: "best move" cannot be checked here`)
  }
})

test('the concept graph is sound and every lesson is reachable in order', () => {
  const ids = new Set(CHESS_CONCEPTS.map((concept) => concept.id))
  for (const concept of CHESS_CONCEPTS) {
    for (const needed of concept.requires) assert.ok(ids.has(needed), `${concept.id} requires ${needed}`)
    assert.ok(concept.blurb.length > 10, concept.id)
  }
  // Every concept a lesson teaches is declared, and nothing needs something taught later.
  const taught = new Set<string>()
  for (const lesson of lessonsOf(CHESS_CURRICULUM)) {
    for (const needed of lesson.requires) {
      assert.ok(taught.has(needed), `${lesson.id} needs ${needed}, which no earlier lesson teaches`)
    }
    for (const concept of lesson.concepts) {
      assert.ok(ids.has(concept), `${lesson.id} teaches ${concept}, which is not a concept`)
      taught.add(concept)
    }
  }
  // The things the brief asked the curriculum to cover.
  for (const concept of [
    'piece-moves', 'captures', 'check', 'checkmate', 'stalemate', 'castling', 'en-passant', 'promotion',
    'mate-with-queen', 'mate-with-rook', 'opening-principles', 'fork', 'pin', 'skewer', 'discovered-attack',
    'removing-the-defender', 'opposition', 'square-of-the-pawn', 'rook-endgame-ideas'
  ]) {
    assert.ok(taught.has(concept), `nothing teaches ${concept}`)
  }
})

test('the curriculum as data claims nothing, and verifyCurriculum works it out', () => {
  for (const task of allTasks(CHESS_CURRICULUM)) {
    assert.equal(task.verification.status, 'unverified', `${task.id} must not ship claiming to be checked`)
  }
  const verified = verifyCurriculum(CHESS_CURRICULUM, 7)
  const tasks: Exercise[] = allTasks(verified)
  assert.ok(tasks.length > 0)
  for (const task of tasks) {
    assert.equal(task.verification.status, 'verified', task.id)
    assert.equal(task.verification.by, 'rules')
    assert.equal(task.verification.at, 7)
  }
  // The original is untouched: verification is worked out, not written back into the data.
  assert.equal(allTasks(CHESS_CURRICULUM)[0].verification.status, 'unverified')
})
