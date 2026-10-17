import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { checkRunSays, duplicateIdProblems, startCheckRun, tookGame, type CheckRun } from './famousCheckRun.ts'
import { START_FEN } from './rules.ts'
import type { FamousCheck } from './famous.ts'

const ok = (id: string): FamousCheck => ({ id, ok: true, moves: 40, finalFen: START_FEN, problems: [] })
const notOk = (id: string, message: string): FamousCheck => ({
  id, ok: false, moves: 0, finalFen: START_FEN, problems: [{ code: 'no-moves', message }]
})

const walk = (run: CheckRun, checks: readonly FamousCheck[]): CheckRun =>
  checks.reduce((held, check) => tookGame(held, check), run)

test('a run starts with nothing checked, because nothing has been', () => {
  const run = startCheckRun(15)
  assert.equal(run.at, 0)
  assert.equal(run.verified, 0)
  assert.equal(run.done, false)
  assert.match(checkRunSays(run), /0 of 15/)
})

test('an empty collection is already finished and says so', () => {
  const run = startCheckRun(0)
  assert.equal(run.done, true)
  assert.equal(checkRunSays(run), 'There are no games in the collection to replay.')
})

test('each game taken in moves the count on, and only the finished run claims the lot', () => {
  let run = startCheckRun(3)
  run = tookGame(run, ok('a'))
  assert.equal(run.at, 1)
  assert.equal(run.done, false)
  assert.match(checkRunSays(run), /1 of 3/)
  run = walk(run, [ok('b'), ok('c')])
  assert.equal(run.done, true)
  assert.equal(run.verified, 3)
  assert.equal(checkRunSays(run), 'All 3 games replayed move by move against the rules.')
})

test('a game that did not replay is counted apart and its reason kept', () => {
  const run = walk(startCheckRun(3), [ok('a'), notOk('b', 'b: there are no moves.'), ok('c')])
  assert.equal(run.verified, 2)
  assert.deepEqual(run.problems.map((one) => one.message), ['b: there are no moves.'])
  assert.match(checkRunSays(run), /2 of 3 games replayed/)
  assert.match(checkRunSays(run), /1 did not, and it is listed below/)
})

test('two that did not replay are said in the plural', () => {
  const run = walk(startCheckRun(3), [notOk('a', 'one'), notOk('b', 'two'), ok('c')])
  assert.match(checkRunSays(run), /2 did not, and they are listed below/)
})

test('a result handed in after the run finished is ignored rather than counted twice', () => {
  const run = walk(startCheckRun(1), [ok('a'), ok('a'), ok('a')])
  assert.equal(run.at, 1)
  assert.equal(run.verified, 1)
})

test('a duplicated id is reported once, with how many copies there are', () => {
  const found = duplicateIdProblems(['a', 'b', 'a', 'c', 'a'])
  assert.equal(found.length, 1)
  assert.equal(found[0]?.code, 'duplicate-id')
  assert.match(found[0]?.message ?? '', /a appears 3 times/)
})

test('ids that are all different produce nothing', () => {
  assert.deepEqual(duplicateIdProblems(['a', 'b', 'c']), [])
})
