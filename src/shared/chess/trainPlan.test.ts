import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  TRAINERS, goesFor, longestRun, nextUp, recentGoes, standingWords, trainBoard, trainTotal, trainerFacts,
  trainerStanding
} from './trainPlan.ts'
import type { TrainingAttempt } from './trainingView.ts'

/** A go, with only the fields the counting looks at spelled out. */
function go(over: Partial<TrainingAttempt> & Pick<TrainingAttempt, 'area' | 'at'>): TrainingAttempt {
  return {
    id: `a-${over.at}-${over.area}`,
    item: 'something',
    strict: false,
    verdict: 'something happened',
    passed: false,
    ...over
  }
}

test('the four trainers are listed once each, in a settled order', () => {
  assert.deepEqual(TRAINERS.map((one) => one.id), ['vision', 'calculation', 'blindfold', 'drill'])
  assert.equal(new Set(TRAINERS.map((one) => one.id)).size, TRAINERS.length)
  for (const one of TRAINERS) {
    // The blurb is a tooltip, so it has to stay one short line.
    assert.ok(one.about.length <= 70, `${one.id}: ${one.about}`)
    assert.ok(one.title.length > 0)
  }
})

test('a trainer nobody has used says so rather than reading as nought out of nought', () => {
  const standing = trainerStanding([], 'vision')
  assert.equal(standing.goes, 0)
  assert.equal(standing.lastAt, null)
  assert.equal(standing.lastVerdict, null)
  assert.match(standing.says, /No goes recorded/)
  assert.doesNotMatch(standing.says, /0 of 0/)
})

test('goes are counted per trainer and nothing leaks between them', () => {
  const attempts = [
    go({ area: 'vision', at: 1, passed: true, strict: true }),
    go({ area: 'vision', at: 2, passed: false }),
    go({ area: 'drill', at: 3, passed: true })
  ]
  const vision = trainerStanding(attempts, 'vision')
  assert.equal(vision.goes, 2)
  assert.equal(vision.passed, 1)
  assert.equal(vision.passedUnaided, 1)
  const drill = trainerStanding(attempts, 'drill')
  assert.equal(drill.goes, 1)
  assert.equal(drill.passedUnaided, 0)
})

test('a pass with the answer on screen is not counted as a pass with it off', () => {
  const attempts = [go({ area: 'blindfold', at: 1, passed: true, strict: false })]
  const standing = trainerStanding(attempts, 'blindfold')
  assert.equal(standing.passed, 1)
  assert.equal(standing.passedUnaided, 0)
  assert.match(standing.says, /None of them with the answer off the screen/)
})

test('the goes are put back in the order they happened before anything is counted', () => {
  const attempts = [
    go({ area: 'vision', at: 30, verdict: 'last' }),
    go({ area: 'vision', at: 10, verdict: 'first' }),
    go({ area: 'vision', at: 20, verdict: 'middle' })
  ]
  assert.deepEqual(goesFor(attempts, 'vision').map((one) => one.at), [10, 20, 30])
  assert.equal(trainerStanding(attempts, 'vision').lastVerdict, 'last')
  assert.equal(trainerStanding(attempts, 'vision').lastAt, 30)
})

test('the longest run is a run, not a total', () => {
  const passes = [true, true, false, true, true, true, false]
  const attempts = passes.map((passed, at) => go({ area: 'drill', at, passed }))
  assert.equal(longestRun(goesFor(attempts, 'drill')), 3)
  assert.equal(longestRun([]), 0)
})

test('the words never invent a figure', () => {
  assert.match(standingWords('Board vision', 0, 0, 0), /No goes recorded at board vision yet/)
  assert.match(standingWords('Board vision', 4, 0, 0), /4 goes, none passed yet/)
  assert.match(standingWords('Board vision', 1, 1, 1), /1 go, 1 passed\. All of them/)
  assert.match(standingWords('Board vision', 5, 3, 2), /2 of those with the answer off the screen/)
})

test('the board holds every trainer whether it has been used or not', () => {
  const board = trainBoard([go({ area: 'drill', at: 1, passed: true })])
  assert.equal(board.length, TRAINERS.length)
  assert.deepEqual(board.map((one) => one.id), TRAINERS.map((one) => one.id))
  assert.equal(board.filter((one) => one.goes > 0).length, 1)
})

test('an empty record totals to a refusal, not to noughts', () => {
  const total = trainTotal([])
  assert.equal(total.goes, 0)
  assert.equal(total.used, 0)
  assert.match(total.says, /Nothing has been recorded/)
})

test('the totals add up the trainers and say how many have been used', () => {
  const attempts = [
    go({ area: 'vision', at: 1, passed: true, strict: true }),
    go({ area: 'vision', at: 2, passed: true, strict: false }),
    go({ area: 'drill', at: 3, passed: false })
  ]
  const total = trainTotal(attempts)
  assert.equal(total.goes, 3)
  assert.equal(total.passed, 2)
  assert.equal(total.passedUnaided, 1)
  assert.equal(total.used, 2)
  assert.match(total.says, /3 goes across 2 of the 4 trainers/)
})

test('with nothing recorded anywhere, the first untouched trainer is the one pointed at', () => {
  const up = nextUp([])
  assert.ok(up !== null)
  assert.equal(up.id, 'vision')
  assert.match(up.why, /Nothing recorded here yet/)
})

test('a trainer with three failed goes in a row is pointed at, once every trainer has been used', () => {
  const attempts = [
    ...TRAINERS.map((one, at) => go({ area: one.id, at: at + 1, passed: true })),
    go({ area: 'blindfold', at: 10, passed: false }),
    go({ area: 'blindfold', at: 11, passed: false }),
    go({ area: 'blindfold', at: 12, passed: false })
  ]
  const up = nextUp(attempts)
  assert.ok(up !== null)
  assert.equal(up.id, 'blindfold')
  assert.match(up.why, /last three goes/)
})

test('nothing is suggested when the record has nothing to say', () => {
  const attempts = TRAINERS.map((one, at) => go({ area: one.id, at: at + 1, passed: true }))
  assert.equal(nextUp(attempts), null)
})

test('two failures in a row is not three, so nothing is suggested for it', () => {
  const attempts = [
    ...TRAINERS.map((one, at) => go({ area: one.id, at: at + 1, passed: true })),
    go({ area: 'drill', at: 10, passed: false }),
    go({ area: 'drill', at: 11, passed: false })
  ]
  assert.equal(nextUp(attempts), null)
})

test('the recent goes come back newest first and are capped', () => {
  const attempts = [1, 2, 3, 4, 5].map((at) => go({ area: 'vision', at }))
  assert.deepEqual(recentGoes(attempts, 3).map((one) => one.at), [5, 4, 3])
  assert.deepEqual(recentGoes(attempts, 0), [])
  assert.equal(recentGoes(attempts).length, 5)
})

test('a trainer id nobody knows gets no facts rather than invented ones', () => {
  assert.equal(trainerFacts('vision')?.title, 'Board vision')
  assert.equal(trainerFacts('nothing-like-this' as never), null)
})
