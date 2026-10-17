import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Performance } from './attempt.ts'
import { newExercise } from './exercise.ts'
import {
  ATTEMPTS_FOR_A_RATING, MAX_STEP, OUTCOME_RULES, RATING_MODEL, START_RATING, confidenceWidth,
  describeDifficulty, expected, kFor, newPersonRating, newPuzzleRating, rateAttempt, ratePuzzleFromAttempt,
  scoreOf, standingOf, type PersonRating
} from './puzzleRating.ts'

/**
 * The rating model, and mostly its refusals.
 *
 * What is checked here is what a number on a screen cannot be checked for by looking at it: that one attempt does
 * not produce a rating, that a puzzle nobody has rated cannot move one, that no single attempt can move it by more
 * than the cap however the arithmetic comes out, and that the thing which answers "how hard is this?" for an unrated
 * puzzle returns facts counted off the board and never a number.
 */

function attempt(over: Partial<Performance> = {}): Performance {
  return {
    exerciseId: 'p1',
    solved: true,
    gaveUp: false,
    hintsUsed: 0,
    worth: 1,
    wrongMoves: 0,
    illegalTries: 0,
    seconds: 20,
    at: 1_700_000_000_000,
    ...over
  }
}

// ---------------------------------------------------------------- the model is written down

test('the formula and its limits are text a screen can show, not something only the code knows', () => {
  assert.ok(RATING_MODEL.formula.length >= 5)
  assert.ok(RATING_MODEL.limits.length >= 5)
  assert.match(RATING_MODEL.origin, /Elo/)
  // The two refusals that matter most are stated, not implied.
  assert.ok(RATING_MODEL.limits.some((one) => /no rating cannot move yours/i.test(one)))
  assert.ok(RATING_MODEL.limits.some((one) => /working figure, not a rating/i.test(one)))
  // The cap is in the words as well as in the arithmetic.
  assert.ok(RATING_MODEL.formula.some((one) => one.includes(String(MAX_STEP))))
})

test('every K step is reachable', () => {
  const seen = new Set<number>()
  for (let attempts = 0; attempts < 200; attempts++) seen.add(kFor(attempts))
  assert.equal(seen.size, 3)
  assert.equal(kFor(0), 32)
  assert.equal(kFor(10), 24)
  assert.equal(kFor(30), 16)
  assert.equal(kFor(-5), 32)
})

test('the Elo expectation is symmetric and ordered', () => {
  assert.equal(expected(1200, 1200), 0.5)
  assert.ok(expected(1600, 1200) > 0.9)
  assert.ok(expected(1200, 1600) < 0.1)
  assert.ok(Math.abs(expected(1400, 1200) + expected(1200, 1400) - 1) < 1e-12)
})

// ---------------------------------------------------------------- what an attempt scores

test('a solve with the move shown scores nothing, and says which rule decided it', () => {
  const shown = scoreOf(attempt({ solved: true, worth: 0, hintsUsed: 5 }))
  assert.equal(shown.score, 0)
  assert.equal(shown.rule, OUTCOME_RULES[2].when)
  const gaveUp = scoreOf(attempt({ gaveUp: true, solved: false }))
  assert.equal(gaveUp.score, 0)
  assert.equal(gaveUp.rule, OUTCOME_RULES[0].when)
  const failed = scoreOf(attempt({ solved: false }))
  assert.equal(failed.score, 0)
  assert.equal(failed.rule, OUTCOME_RULES[1].when)
})

test('wrong moves take a quarter off a solve, down to a floor', () => {
  assert.equal(scoreOf(attempt()).score, 1)
  assert.equal(scoreOf(attempt({ wrongMoves: 1 })).score, 0.75)
  assert.equal(scoreOf(attempt({ wrongMoves: 2 })).score, 0.5)
  assert.equal(scoreOf(attempt({ wrongMoves: 9 })).score, 0.25)
  // A hint and a wrong move compound, and still never go below the floor.
  assert.equal(scoreOf(attempt({ worth: 0.5, wrongMoves: 1 })).score, 0.25)
})

// ---------------------------------------------------------------- the refusals

test('one attempt is not a rating', () => {
  const start = newPersonRating()
  assert.equal(standingOf(start).meansAnything, false)
  assert.match(standingOf(start).says, /No rating yet/)

  const after = rateAttempt(start, { id: 'p1', rating: 1500 }, attempt(), 1)
  assert.equal(after.measured, true)
  assert.equal(after.person.attempts, 1)
  const standing = standingOf(after.person)
  assert.equal(standing.meansAnything, false)
  assert.match(standing.says, /Not enough yet to call it a rating/)
  assert.match(standing.says, new RegExp(`of ${ATTEMPTS_FOR_A_RATING}`))
  // And the figure is still there for whoever wants to show it as the working figure it is.
  assert.ok(standing.rating > START_RATING)
  assert.ok(standing.width > 100)
})

test('it takes exactly the stated number of attempts before the number may be called a rating', () => {
  let person: PersonRating = newPersonRating()
  for (let i = 0; i < ATTEMPTS_FOR_A_RATING - 1; i++) {
    person = rateAttempt(person, { id: `p${i}`, rating: 1300 }, attempt(), i).person
    assert.equal(standingOf(person).meansAnything, false, `still not a rating at ${i + 1} attempts`)
  }
  person = rateAttempt(person, { id: 'last', rating: 1300 }, attempt(), 99).person
  assert.equal(person.attempts, ATTEMPTS_FOR_A_RATING)
  assert.equal(standingOf(person).meansAnything, true)
  assert.match(standingOf(person).says, /give or take about/)
})

test('a puzzle with no rating cannot move a rating, and says why', () => {
  const start = newPersonRating()
  const after = rateAttempt(start, { id: 'made-from-my-game', rating: null }, attempt(), 5)
  assert.equal(after.measured, false)
  assert.equal(after.step, null)
  assert.equal(after.person.rating, start.rating)
  assert.equal(after.person.attempts, 0, 'an attempt that measured nothing does not count towards the rating')
  assert.equal(after.person.unmeasured, 1)
  assert.equal(after.person.finished, 1, 'it is still recorded as a finished attempt')
  assert.match(after.says, /no rating/i)

  // And the standing says so rather than pretending nothing has happened.
  assert.match(standingOf(after.person).says, /none of those puzzles had a rating/)
})

test('no single attempt moves the figure by more than the cap', () => {
  // The most lopsided pairing the band allows, both ways round.
  const low = newPersonRating(400)
  const win = rateAttempt(low, { id: 'hard', rating: 3000 }, attempt(), 1)
  assert.ok(win.step !== null)
  assert.ok(Math.abs(win.person.rating - low.rating) <= MAX_STEP)
  assert.equal(win.step?.capped, true)

  const high = newPersonRating(3000)
  const loss = rateAttempt(high, { id: 'easy', rating: 400 }, attempt({ solved: false }), 1)
  assert.ok(Math.abs(loss.person.rating - high.rating) <= MAX_STEP)
  assert.equal(loss.step?.capped, true)
  assert.match(loss.says, /held back by the cap/)
})

test('a run of attempts cannot walk the figure outside the band', () => {
  let person = newPersonRating()
  for (let i = 0; i < 300; i++) person = rateAttempt(person, { id: 'x', rating: 3000 }, attempt(), i).person
  assert.ok(person.rating <= 3000)
  for (let i = 0; i < 300; i++) person = rateAttempt(person, { id: 'y', rating: 400 }, attempt({ solved: false }), i).person
  assert.ok(person.rating >= 400)
})

test('the width narrows with history and never claims to be precise', () => {
  assert.equal(confidenceWidth(0), 350)
  assert.ok(confidenceWidth(4) < confidenceWidth(1))
  assert.ok(confidenceWidth(10_000) >= 50, 'it never narrows past the floor')
  assert.equal(confidenceWidth(10_000), 50)
})

test('the history is kept short rather than growing without end', () => {
  let person = newPersonRating()
  for (let i = 0; i < 200; i++) person = rateAttempt(person, { id: 'x', rating: 1200 }, attempt(), i).person
  assert.ok(person.history.length <= 50)
  assert.equal(person.history[person.history.length - 1].at, 199)
})

// ---------------------------------------------------------------- the puzzle's own figure

test('a puzzle rating from a source is not overwritten by how one person did at it', () => {
  const state = newPuzzleRating('p1', 1750)
  assert.equal(state.rating, 1750)
  assert.equal(state.from, 'source')
  const after = ratePuzzleFromAttempt(state, newPersonRating(), attempt())
  assert.equal(after.measured, false)
  assert.equal(after.state.rating, 1750)
  assert.equal(after.state.attempts, 1)
  assert.match(after.says, /from its source/)
})

test('a puzzle nobody has rated does not get one from a single solver', () => {
  let state = newPuzzleRating('made-here')
  assert.equal(state.rating, null)
  for (let i = 0; i < 5; i++) {
    const after = ratePuzzleFromAttempt(state, newPersonRating(), attempt())
    assert.equal(after.measured, false)
    assert.equal(after.state.rating, null, 'still no rating after attempt ' + (i + 1))
    state = after.state
  }
  assert.match(ratePuzzleFromAttempt(state, newPersonRating(), attempt()).says, /not a puzzle rating/)
})

// ---------------------------------------------------------------- difficulty with no number in it

test('difficulty is answered with counted facts and never with a rating', () => {
  const exercise = newExercise({
    id: 'd1',
    kind: 'puzzle',
    startFen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1',
    objective: 'mate-in-n',
    movesToMate: 1,
    prompt: 'White to play. There is a forced mate in 1.',
    solution: { lines: [{ move: 'a1a8' }] },
    source: { kind: 'authored' }
  })
  const difficulty = describeDifficulty(exercise)
  assert.equal(difficulty.rating, null)
  assert.match(difficulty.says, /No rating/)
  // Real counts off the real board: twenty legal moves, one of them recorded as working.
  assert.ok(difficulty.facts.some((one) => one.includes('20 legal moves')))
  assert.ok(difficulty.facts.some((one) => one.includes('1 of them')))
  assert.ok(difficulty.facts.some((one) => /forced mate in 1/.test(one)))
  assert.ok(difficulty.facts.some((one) => /White to play/.test(one)))
  // Ra8 is a check, and that is said because it is true of the move.
  assert.ok(difficulty.facts.some((one) => /The move is a check/.test(one)))
})

test('difficulty refuses a position it cannot load', () => {
  const exercise = newExercise({
    id: 'd2',
    kind: 'puzzle',
    startFen: 'not a position',
    objective: 'find-best',
    prompt: 'x',
    source: { kind: 'authored' }
  })
  const difficulty = describeDifficulty(exercise)
  assert.equal(difficulty.rating, null)
  assert.match(difficulty.says, /cannot be loaded/)
})
