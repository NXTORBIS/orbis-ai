import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ATTEMPT_STATES, FINAL_STATES, TRANSITIONS, acceptedAt, advance, canGo, elapsedMs, failureNow, isFinal, judge,
  lineFinished, newAttempt, opponentReply, performanceOf, playMove, playOpponent, takeHint, worthOf
} from './attempt.ts'
import { FORGIVING_FAILURE, newExercise, validateExercise, type Exercise } from './exercise.ts'

/**
 * Two things are being tested here and they are deliberately separate: the machine, which must refuse every step it
 * does not allow, and the judge, which must never tell somebody their legal move was illegal.
 */

const hints = [
  { level: 1, text: 'The king is doing half the work.', shows: 'theme' as const },
  { level: 2, text: 'The rook wants the eighth rank.', shows: 'piece' as const },
  { level: 3, text: 'Ra8.', shows: 'move' as const }
]

const rookMateInTwo: Exercise = newExercise({
  id: 'rook-two',
  kind: 'puzzle',
  startFen: '7k/8/5K2/8/8/8/8/R7 w - - 0 1',
  objective: 'mate-in-n',
  movesToMate: 2,
  prompt: 'Mate in two.',
  solution: { lines: [{ move: 'f6g6', children: [{ move: 'h8g8', children: [{ move: 'a1a8' }] }] }] },
  failure: FORGIVING_FAILURE,
  hints,
  source: { kind: 'generated', by: 'forcedMateTree' }
})

const twoMates: Exercise = newExercise({
  id: 'two-mates',
  kind: 'puzzle',
  startFen: '6k1/8/6K1/8/8/8/8/Q7 w - - 0 1',
  objective: 'mate-in-n',
  movesToMate: 1,
  prompt: 'Mate in one.',
  // Only one of the two mates is written down, on purpose.
  solution: { lines: [{ move: 'a1a8' }] },
  failure: FORGIVING_FAILURE,
  hints: [{ level: 1, text: 'The eighth rank.', shows: 'theme' }],
  source: { kind: 'generated', by: 'forcedMateTree' }
})

test('the exercises these tests are built on are themselves sound', () => {
  assert.equal(validateExercise(rookMateInTwo).ok, true)
  assert.equal(validateExercise(twoMates).ok, true)
})

// ---------------------------------------------------------------- the machine

test('the machine allows only the steps it lists, and nothing follows a final state', () => {
  for (const state of ATTEMPT_STATES) assert.ok(TRANSITIONS[state], state)
  for (const state of FINAL_STATES) {
    assert.deepEqual(TRANSITIONS[state], [])
    assert.equal(isFinal(state), true)
  }
  assert.equal(canGo('ready', 'loading'), true)
  assert.equal(canGo('ready', 'active'), false, 'a position has to be loaded before a move can be made')
  assert.equal(canGo('interrupted', 'active'), false, 'an interrupted attempt reloads before it accepts a move')
  assert.equal(canGo('interrupted', 'loading'), true)
  assert.equal(canGo('completed', 'active'), false)
  assert.equal(canGo('active', 'validating'), true)
  assert.equal(canGo('paused', 'validating'), false)
  // Every state except the final ones can be left.
  for (const state of ATTEMPT_STATES) {
    if (isFinal(state)) continue
    assert.ok(TRANSITIONS[state].length > 0, state)
  }
})

test('a refused step changes nothing at all', () => {
  const session = newAttempt({ id: 'a', exercise: rookMateInTwo, now: 0 })
  const refused = advance(session, { kind: 'loaded' }, 10)
  assert.equal(refused.ok, false)
  assert.match(refused.says ?? '', /cannot go from ready to active/)
  assert.deepEqual(refused.session, session)
})

test('the clock runs while the solver is thinking and not while they are not', () => {
  let session = newAttempt({ id: 'a', exercise: rookMateInTwo, now: 0 })
  session = advance(session, { kind: 'load' }, 0).session
  session = advance(session, { kind: 'loaded' }, 1_000).session
  assert.equal(session.startedAt, 1_000)
  assert.equal(elapsedMs(session, 4_000), 3_000)
  session = advance(session, { kind: 'pause' }, 4_000).session
  assert.equal(session.runningSince, null)
  assert.equal(elapsedMs(session, 99_000), 3_000, 'a pause does not tick')
  session = advance(session, { kind: 'resume' }, 100_000).session
  assert.equal(elapsedMs(session, 101_000), 4_000)
})

test('a whole attempt: a wrong move, a hint, the answer, and what it leaves behind', () => {
  let session = newAttempt({ id: 'a', exercise: rookMateInTwo, now: 0 })
  session = advance(session, { kind: 'load' }, 0).session
  session = advance(session, { kind: 'loaded' }, 0).session

  // A legal move that is not the idea: recorded as a wrong move, and the position does not change.
  const wrong = playMove(session, rookMateInTwo, 'a1a8', 5_000)
  assert.equal(wrong.verdict.kind, 'not-the-idea')
  assert.equal(wrong.session.state, 'awaiting-feedback')
  assert.equal(wrong.session.wrongMoves, 1)
  assert.equal(wrong.session.fen, rookMateInTwo.startFen, 'a wrong move does not move the pieces on')
  session = advance(wrong.session, { kind: 'feedback-done' }, 6_000).session
  assert.equal(session.state, 'active')

  // A hint. It changes what the attempt proves, not whether the answer is right.
  const helped = takeHint(session, rookMateInTwo)
  assert.equal(helped.hint?.level, 1)
  assert.equal(helped.worth, 0.85)
  session = helped.session

  // The right move. The opponent has to answer, so the machine waits for them.
  const right = playMove(session, rookMateInTwo, 'f6g6', 10_000)
  assert.equal(right.verdict.kind, 'on-track')
  assert.equal(right.session.state, 'awaiting-opponent')
  session = right.session

  const reply = opponentReply(rookMateInTwo, session.played.map((m) => m.uci))
  assert.equal(reply?.san, 'Kg8')
  session = advance(session, { kind: 'opponent-moved', move: reply! }, 11_000).session
  assert.equal(session.state, 'active')
  assert.equal(session.played.length, 2)

  const done = playMove(session, rookMateInTwo, 'a1a8', 14_000)
  assert.equal(done.verdict.kind, 'solved')
  if (done.verdict.kind === 'solved') assert.equal(done.verdict.viaRecordedLine, true)
  session = advance(done.session, { kind: 'feedback-done' }, 15_000).session
  assert.equal(session.state, 'completed')
  assert.equal(session.outcome, 'solved')

  const performance = performanceOf(session, rookMateInTwo, 20_000)
  assert.equal(performance.solved, true)
  assert.equal(performance.wrongMoves, 1)
  assert.equal(performance.hintsUsed, 1)
  assert.equal(performance.worth, 0.85)
  assert.equal(performance.illegalTries, 0)
  // Twelve, not fifteen: the clock does not run while the opponent is moving or while the feedback is being read.
  assert.equal(performance.seconds, 12)
})

test('a line that ends on the opponent’s move finishes instead of waiting for one that is not there', () => {
  const playItOut: Exercise = newExercise({
    id: 'castle-both',
    kind: 'lesson-task',
    startFen: 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1',
    objective: 'reconstruct',
    prompt: 'Castle short for both sides.',
    solution: { lines: [{ move: 'O-O', children: [{ move: 'O-O' }] }] },
    answer: { kind: 'fen', fen: 'r4rk1/pppppppp/8/8/8/8/PPPPPPPP/R4RK1 w - - 2 2' },
    failure: FORGIVING_FAILURE,
    hints: [{ level: 1, text: 'The king goes two squares.', shows: 'theme' }],
    source: { kind: 'authored' }
  })
  assert.equal(validateExercise(playItOut).ok, true)

  let session = newAttempt({ id: 'a', exercise: playItOut, now: 0 })
  session = advance(session, { kind: 'load' }, 0).session
  session = advance(session, { kind: 'loaded' }, 0).session
  const mine = playMove(session, playItOut, 'O-O', 1_000)
  assert.equal(mine.verdict.kind, 'on-track')
  assert.equal(mine.session.state, 'awaiting-opponent')
  assert.equal(lineFinished(playItOut, mine.session), false)

  const theirs = playOpponent(mine.session, playItOut, 2_000)
  assert.equal(theirs.reply?.san, 'O-O')
  assert.equal(theirs.session.state, 'awaiting-feedback', 'there is no move left for the solver to make')
  assert.equal(theirs.session.pending, 'solved')
  assert.equal(lineFinished(playItOut, theirs.session), true)
  const done = advance(theirs.session, { kind: 'feedback-done' }, 3_000).session
  assert.equal(done.state, 'completed')
  assert.equal(done.outcome, 'solved')

  // Without the exercise the machine cannot know, and says nothing rather than guessing.
  const blind = advance(mine.session, { kind: 'opponent-moved', move: theirs.reply! }, 2_000)
  assert.equal(blind.session.state, 'active')
  assert.equal(playOpponent(blind.session, playItOut, 3_000).ok, false)
})

test('an illegal move is not a wrong answer, and nothing moves', () => {
  let session = newAttempt({ id: 'a', exercise: rookMateInTwo, now: 0 })
  session = advance(session, { kind: 'load' }, 0).session
  session = advance(session, { kind: 'loaded' }, 0).session
  const tried = playMove(session, rookMateInTwo, 'a1a9', 1_000)
  assert.equal(tried.verdict.kind, 'illegal')
  assert.equal(tried.session.state, 'active', 'an unplayable move leaves the solver on the clock')
  assert.equal(tried.session.illegalTries, 1)
  assert.equal(tried.session.wrongMoves, 0, 'an illegal move is never counted as a wrong answer')
  assert.equal(tried.session.played.length, 0)
})

test('a strict exercise ends on the first wrong move, and says which rule did it', () => {
  const strict: Exercise = { ...rookMateInTwo, failure: [{ kind: 'wrong-moves', allowed: 0 }] }
  let session = newAttempt({ id: 'a', exercise: strict, now: 0 })
  session = advance(session, { kind: 'load' }, 0).session
  session = advance(session, { kind: 'loaded' }, 0).session
  const wrong = playMove(session, strict, 'a1a8', 1_000)
  assert.equal(wrong.verdict.kind, 'not-the-idea')
  assert.equal(wrong.session.state, 'failed')
  assert.equal(wrong.session.outcome, 'failed')
  assert.match(wrong.session.why ?? '', /first time/)

  const limited: Exercise = { ...rookMateInTwo, failure: [{ kind: 'time-limit', seconds: 30 }] }
  let timed = newAttempt({ id: 'b', exercise: limited, now: 0 })
  timed = advance(timed, { kind: 'load' }, 0).session
  timed = advance(timed, { kind: 'loaded' }, 0).session
  assert.equal(failureNow(timed, limited, 10_000), null)
  assert.match(failureNow(timed, limited, 40_000) ?? '', /Time is up/)
})

test('giving up is recorded as giving up, not as failing to solve it', () => {
  let session = newAttempt({ id: 'a', exercise: rookMateInTwo, now: 0 })
  session = advance(session, { kind: 'load' }, 0).session
  session = advance(session, { kind: 'loaded' }, 0).session
  session = advance(session, { kind: 'give-up' }, 9_000).session
  assert.equal(session.state, 'failed')
  assert.equal(session.outcome, 'given-up')
  const performance = performanceOf(session, rookMateInTwo, 9_000)
  assert.equal(performance.gaveUp, true)
  assert.equal(performance.solved, false)
})

test('an interrupted attempt can be picked up again, and an abandoned one cannot', () => {
  let session = newAttempt({ id: 'a', exercise: rookMateInTwo, now: 0 })
  session = advance(session, { kind: 'load' }, 0).session
  session = advance(session, { kind: 'loaded' }, 0).session
  session = advance(session, { kind: 'interrupt' }, 3_000).session
  assert.equal(session.state, 'interrupted')
  assert.equal(isFinal(session.state), false)
  const back = advance(session, { kind: 'restore' }, 100_000)
  assert.equal(back.ok, true)
  assert.equal(back.session.state, 'loading')
  assert.equal(back.session.activeMs, 3_000, 'the clock kept what it had and did not run while away')

  const gone = advance(back.session, { kind: 'abandon' }, 101_000)
  assert.equal(gone.session.state, 'abandoned')
  assert.equal(advance(gone.session, { kind: 'restore' }, 102_000).ok, false)
})

// ---------------------------------------------------------------- the judge

test('legality is answered first, and never with the vocabulary of correctness', () => {
  const illegal = judge(rookMateInTwo, ['a1a9'])
  assert.equal(illegal.kind, 'illegal')
  if (illegal.kind === 'illegal') {
    assert.equal(illegal.at, 0)
    assert.match(illegal.says, /cannot be played/)
    assert.doesNotMatch(illegal.says, /wrong|idea|mistake/i)
  }
})

test('a legal move that misses the point is "not the idea", and says what was accepted', () => {
  const verdict = judge(rookMateInTwo, ['a1h1'])
  assert.equal(verdict.kind, 'not-the-idea')
  if (verdict.kind === 'not-the-idea') {
    assert.equal(verdict.san, 'Rh1+')
    assert.doesNotMatch(verdict.says, /illegal/i)
    assert.match(verdict.says, /legal move/)
    assert.deepEqual(verdict.accepted, ['Kg6'])
  }
})

test('a move that cannot reach the objective is said to be hopeless, and one that might is not', () => {
  // Mate in one: a move that does not mate cannot be right, and the rules can prove it.
  const hopeless = judge(twoMates, ['a1a7'])
  assert.equal(hopeless.kind, 'not-the-idea')
  if (hopeless.kind === 'not-the-idea') {
    assert.equal(hopeless.couldStillBeGood, false)
    assert.match(hopeless.says, /no mate in 1/)
  }
  // Mate in two: Kf7 is not the recorded line and does force mate, so nothing is claimed against it.
  const other = judge(rookMateInTwo, ['f6f7'])
  assert.equal(other.kind, 'not-the-idea')
  if (other.kind === 'not-the-idea') {
    assert.equal(other.couldStillBeGood, true)
    assert.match(other.says, /another question/)
  }
})

test('a solver who finds a mate the author never wrote down has solved it', () => {
  const verdict = judge(twoMates, ['a1g7'])
  assert.equal(verdict.kind, 'solved')
  if (verdict.kind === 'solved') {
    assert.equal(verdict.viaRecordedLine, false)
    assert.match(verdict.says, /Qg7# is mate/)
  }
})

test('a defence the exercise has no answer for is the exercise’s problem, not the solver’s', () => {
  // The fork gives Black two legal answers to Nf7+, and this exercise only writes one of them down.
  const oneDefence: Exercise = newExercise({
    id: 'fork-thin',
    kind: 'puzzle',
    startFen: '3q3k/6p1/3N4/8/8/8/8/6K1 w - - 0 1',
    objective: 'win-material',
    materialAtLeast: 900,
    prompt: 'Win the queen.',
    solution: { lines: [{ move: 'd6f7', children: [{ move: 'h8g8', children: [{ move: 'f7d8' }] }] }] },
    failure: FORGIVING_FAILURE,
    hints: [{ level: 1, text: 'Two targets, one square.', shows: 'theme' }],
    source: { kind: 'authored' }
  })
  assert.equal(validateExercise(oneDefence).coverage, 'partial', 'and the validator says so')
  const verdict = judge(oneDefence, ['d6f7', 'h8h7'])
  assert.equal(verdict.kind, 'opponent-off-book')
  if (verdict.kind === 'opponent-off-book') assert.match(verdict.says, /gap in the exercise/)
})

test('an exercise that is not answered with moves says so', () => {
  const squares = newExercise({
    id: 'squares',
    kind: 'lesson-task',
    startFen: '4k3/7p/8/8/8/8/8/N3K3 w - - 0 1',
    objective: 'answer',
    prompt: 'Where can the knight go?',
    answer: { kind: 'destinations', from: 'a1', squares: ['b3', 'c2'] },
    source: { kind: 'authored' }
  })
  assert.equal(judge(squares, ['a1b3']).kind, 'not-a-move-exercise')
})

test('the accepted moves at a point are written out for the position they are played in', () => {
  assert.deepEqual(acceptedAt(rookMateInTwo, []).map((m) => m.san), ['Kg6'])
  assert.deepEqual(acceptedAt(rookMateInTwo, ['f6g6']).map((m) => m.san), ['Kg8'])
  assert.deepEqual(acceptedAt(rookMateInTwo, ['f6g6', 'h8g8']).map((m) => m.san), ['Ra8#'])
  assert.deepEqual(acceptedAt(rookMateInTwo, ['a1a8']), [], 'off the line, nothing is accepted')
})

test('the opponent is deterministic, so the same exercise is the same exercise', () => {
  const first = opponentReply(rookMateInTwo, ['f6g6'], 0)
  const again = opponentReply(rookMateInTwo, ['f6g6'], 0)
  assert.equal(first?.uci, again?.uci)
  assert.equal(opponentReply(rookMateInTwo, ['f6g6'], 7)?.uci, first?.uci, 'one defence recorded, so any pick gives it')
  assert.equal(opponentReply(rookMateInTwo, []), null, 'it is not the opponent’s move at the start')
})

test('the hint ladder decides what a solve proves, and the move shown proves nothing about recall', () => {
  let session = newAttempt({ id: 'a', exercise: rookMateInTwo, now: 0 })
  assert.equal(worthOf(session, rookMateInTwo).worth, 1)
  assert.equal(worthOf(session, rookMateInTwo).counts, true)
  for (const level of [1, 2, 3]) {
    const taken = takeHint(session, rookMateInTwo)
    assert.equal(taken.hint?.level, level)
    session = taken.session
  }
  const after = worthOf(session, rookMateInTwo)
  assert.equal(after.worth, 0)
  assert.equal(after.counts, false)
  assert.match(after.says, /practice rather than a solve/)
  assert.equal(takeHint(session, rookMateInTwo).hint, null)
  assert.equal(performanceOf(session, rookMateInTwo, 1_000).hintsUsed, 3)
})
