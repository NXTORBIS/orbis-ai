import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PIECE_VALUE, UNVERIFIED, firstMoves, follow, forcedMateTree, hasMateIn, isVerified, materialFor, materialSwing,
  newExercise, playablePosition, sayVerification, validateExercise, verifyExercise,
  type Exercise, type ProblemCode
} from './exercise.ts'
import { START_FEN } from './rules.ts'

/**
 * The validator is the only thing standing between the Academy and a puzzle that is quietly wrong, so these tests
 * are mostly about the things it has to refuse.
 */

const base = {
  id: 'x',
  kind: 'puzzle' as const,
  prompt: 'Mate in one.',
  source: { kind: 'authored' as const }
}

const codes = (ex: Exercise): ProblemCode[] => validateExercise(ex).problems.filter((p) => p.severity === 'fault').map((p) => p.code)

// ---------------------------------------------------------------- the good cases

test('a mate in one with every mating move recorded is verified, with complete coverage', () => {
  const ex = newExercise({
    ...base,
    startFen: '7k/8/6K1/8/8/8/8/5Q2 w - - 0 1',
    objective: 'mate-in-n',
    movesToMate: 1,
    solution: { lines: [{ move: 'f1f8' }] }
  })
  assert.equal(ex.verification.status, 'unverified', 'a new exercise never claims to be checked')
  const check = validateExercise(ex, 500)
  assert.equal(check.ok, true, check.problems.map((p) => p.says).join(' / '))
  assert.equal(check.verification.status, 'verified')
  assert.equal(check.verification.coverage, 'complete')
  assert.equal(check.verification.at, 500)
  assert.equal(check.objective, 'proved')
  assert.deepEqual(check.lines.map((l) => l.san), [['Qf8#']])
  assert.equal(check.lines[0].endsIn, 'checkmate')
  const { exercise } = verifyExercise(ex, 500)
  assert.equal(isVerified(exercise), true)
  assert.match(sayVerification(exercise.verification), /every defence/)
})

test('two different mates are both accepted, and the solver may play either', () => {
  const ex = newExercise({
    ...base,
    startFen: 'k7/1R5P/2K5/8/8/8/8/8 w - - 0 1',
    objective: 'mate-in-n',
    movesToMate: 1,
    solution: { lines: [{ move: 'h7h8q' }, { move: 'h7h8r' }] }
  })
  assert.equal(validateExercise(ex).ok, true)
  assert.deepEqual(firstMoves(ex).map((m) => m.san).sort(), ['h8=Q#', 'h8=R#'])
})

test('a mate in two is verified only when every defence is answered', () => {
  const full: Exercise = newExercise({
    ...base,
    prompt: 'Mate in two.',
    startFen: '7k/8/5K2/8/8/8/8/R7 w - - 0 1',
    objective: 'mate-in-n',
    movesToMate: 2,
    solution: {
      lines: [
        { move: 'f6g6', children: [{ move: 'h8g8', children: [{ move: 'a1a8' }] }] },
        { move: 'f6f7', children: [{ move: 'h8h7', children: [{ move: 'a1h1' }] }] }
      ]
    }
  })
  const good = validateExercise(full)
  assert.equal(good.ok, true, good.problems.map((p) => p.says).join(' / '))
  assert.equal(good.coverage, 'complete')

  // The same exercise with the king's only move left unanswered.
  const thin: Exercise = { ...full, solution: { lines: [{ move: 'f6g6' }] } }
  const bad = validateExercise(thin)
  assert.equal(bad.ok, false)
  assert.ok(codes(thin).includes('objective-not-met'), codes(thin).join(','))
})

test('material is counted, and a win is proved against the recapture', () => {
  assert.equal(PIECE_VALUE.q, 900)
  assert.equal(materialFor(START_FEN, 'w'), materialFor(START_FEN, 'b'))
  const ex = newExercise({
    ...base,
    prompt: 'Win the queen.',
    startFen: '4k3/8/8/8/3q4/5N2/8/4K3 w - - 0 1',
    objective: 'win-material',
    materialAtLeast: 900,
    solution: { lines: [{ move: 'f3d4' }] }
  })
  const check = validateExercise(ex)
  assert.equal(check.ok, true, check.problems.map((p) => p.says).join(' / '))
  assert.equal(materialSwing(ex.startFen, check.lines[0].fens[0], 'w'), 900)
})

test('a line that stops one move before the material comes back is refused', () => {
  // The pawn on e5 recaptures on d4, so Nxd4 wins a queen for a knight -- not a queen.
  const ex = newExercise({
    ...base,
    prompt: 'Win the queen.',
    startFen: '4k3/8/8/4p3/3q4/5N2/8/4K3 w - - 0 1',
    objective: 'win-material',
    materialAtLeast: 900,
    solution: { lines: [{ move: 'f3d4' }] }
  })
  assert.deepEqual(codes(ex), ['premature-end'])
  // The honest version of the same exercise passes.
  const honest = { ...ex, materialAtLeast: 600 }
  assert.equal(validateExercise(honest).ok, true)
})

test('a draw is only proved when the line really ends in one', () => {
  const real = newExercise({
    ...base,
    prompt: 'Hold the draw.',
    startFen: '8/8/8/4k3/8/4p3/4K3/8 w - - 0 1',
    objective: 'hold-draw',
    solution: { lines: [{ move: 'e2e3' }] }
  })
  const check = validateExercise(real)
  assert.equal(check.ok, true, check.problems.map((p) => p.says).join(' / '))
  assert.equal(check.lines[0].endsIn, 'draw')

  // A position that is merely holdable cannot be settled here, and says so instead of claiming it.
  const hopeful = newExercise({
    ...base,
    prompt: 'Hold the draw.',
    startFen: '8/8/8/4k3/8/4p3/4K3/8 w - - 0 1',
    objective: 'hold-draw',
    solution: { lines: [{ move: 'e2e1' }] }
  })
  const soft = validateExercise(hopeful)
  assert.equal(soft.ok, true)
  assert.equal(soft.verification.status, 'unverified')
  assert.equal(soft.verification.needs, 'engine')
  assert.equal(soft.objective, 'needs-engine')
  assert.match(sayVerification(soft.verification), /needs an engine/)
})

test('an answer that is a fact about the position is checked against the position', () => {
  const right = newExercise({
    ...base,
    prompt: 'Where can the knight go?',
    objective: 'answer',
    startFen: '4k3/7p/8/8/8/8/8/N3K3 w - - 0 1',
    answer: { kind: 'destinations', from: 'a1', squares: ['b3', 'c2'] }
  })
  assert.equal(validateExercise(right).ok, true)

  const wrong = { ...right, answer: { kind: 'destinations' as const, from: 'a1', squares: ['b3', 'c2', 'd4'] } }
  assert.deepEqual(codes(wrong), ['answer-wrong'])
  assert.match(validateExercise(wrong).problems[0].says, /b3, c2/)

  const counted = newExercise({
    ...base,
    prompt: 'How many pawns has Black?',
    objective: 'answer',
    startFen: '4k3/7p/8/8/8/8/8/N3K3 w - - 0 1',
    answer: { kind: 'count', of: 'p', side: 'b', value: 1 }
  })
  assert.equal(validateExercise(counted).ok, true)
  assert.deepEqual(codes({ ...counted, answer: { kind: 'count', of: 'p', side: 'b', value: 2 } }), ['answer-wrong'])

  // Free text cannot be checked here, and is never called verified.
  const text = newExercise({
    ...base,
    prompt: 'What is the idea?',
    objective: 'answer',
    startFen: START_FEN,
    answer: { kind: 'text', accepts: ['develop'] }
  })
  const check = validateExercise(text)
  assert.equal(check.ok, true)
  assert.equal(check.verification.status, 'unverified')
  assert.equal(check.verification.needs, 'review')
})

test('a line to play out is checked against the position it really reaches', () => {
  const ex = newExercise({
    ...base,
    kind: 'calculation',
    prompt: 'Play it out.',
    startFen: 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1',
    objective: 'reconstruct',
    solution: { lines: [{ move: 'O-O', children: [{ move: 'O-O' }] }] },
    answer: { kind: 'fen', fen: 'r4rk1/pppppppp/8/8/8/8/PPPPPPPP/R4RK1 w - - 2 2' }
  })
  assert.equal(validateExercise(ex).ok, true)
  const wrong = { ...ex, answer: { kind: 'fen' as const, fen: START_FEN } }
  assert.deepEqual(codes(wrong), ['answer-wrong'])
})

// ---------------------------------------------------------------- the refusals

test('a position that cannot be reached in a game is refused rather than crashed into', () => {
  // Black is in check and it is White to move: the move generator would offer a capture of the king.
  const impossible = '7k/8/5QK1/8/8/8/8/8 w - - 0 1'
  const playable = playablePosition(impossible)
  assert.equal(playable.ok, false)
  assert.match(playable.reason ?? '', /in check/)
  const ex = newExercise({ ...base, startFen: impossible, objective: 'mate-in-n', movesToMate: 1, solution: { lines: [] } })
  assert.deepEqual(codes(ex), ['bad-position'])
  assert.equal(playablePosition(START_FEN).ok, true)
})

test('every kind of broken exercise is refused, and the reason says what is wrong', () => {
  const sound = {
    ...base,
    startFen: '7k/8/6K1/8/8/8/8/5Q2 w - - 0 1',
    sideToMove: 'w' as const,
    objective: 'mate-in-n' as const,
    movesToMate: 1,
    solution: { lines: [{ move: 'f1f8' }] },
    failure: [],
    hints: [],
    verification: UNVERIFIED,
    tags: []
  }
  const cases: [string, Exercise, ProblemCode][] = [
    ['a position that is not a position', { ...sound, startFen: 'nonsense' }, 'bad-position'],
    ['the wrong side named as the solver', { ...sound, sideToMove: 'b' }, 'side-mismatch'],
    ['no solution at all', { ...sound, solution: { lines: [] } }, 'no-solution'],
    ['no mate count', { ...sound, movesToMate: undefined }, 'needs-mate-count'],
    ['a move that cannot be played', { ...sound, solution: { lines: [{ move: 'f1f9' }] } }, 'illegal-move'],
    ['a legal move that does not mate', { ...sound, solution: { lines: [{ move: 'f1f7' }] } }, 'objective-not-met'],
    ['the same first move twice', { ...sound, solution: { lines: [{ move: 'f1f8' }, { move: 'Qf8' }] } }, 'duplicate-line'],
    ['an empty prompt', { ...sound, prompt: '  ' }, 'no-prompt'],
    ['no id', { ...sound, id: '' }, 'no-id'],
    ['hints out of order', { ...sound, hints: [{ level: 2, text: 'later', shows: 'theme' }] }, 'hint-order'],
    [
      'a hint showing the move before the rest',
      { ...sound, hints: [{ level: 1, text: 'Qf8', shows: 'move' }, { level: 2, text: 'the back rank', shows: 'theme' }] },
      'hint-shows-move-early'
    ],
    ['a nonsense failure condition', { ...sound, failure: [{ kind: 'move-limit', moves: 0 }] }, 'bad-failure'],
    ['a position that is already over', { ...sound, startFen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1', solution: { lines: [] } }, 'already-over']
  ]
  for (const [name, broken, expected] of cases) {
    const found = codes(broken)
    assert.ok(found.includes(expected), `${name}: expected ${expected}, got ${found.join(',') || 'nothing'}`)
    assert.equal(validateExercise(broken).verification.status, 'rejected', name)
    assert.ok((validateExercise(broken).problems[0].says ?? '').length > 15, `${name} needs a readable reason`)
  }
})

test('a mate in two that is really a mate in one is refused', () => {
  const ex = newExercise({
    ...base,
    prompt: 'Mate in two.',
    startFen: '7k/8/6K1/8/8/8/8/5Q2 w - - 0 1',
    objective: 'mate-in-n',
    movesToMate: 2,
    solution: { lines: [{ move: 'f1f8' }] }
  })
  assert.deepEqual(codes(ex), ['wrong-mate-count'])
  assert.match(validateExercise(ex).problems[0].says, /mates in 1/)
})

test('a solution that leaves the solver with nothing to play is refused', () => {
  const ex = newExercise({
    ...base,
    prompt: 'Mate in two.',
    startFen: '7k/8/5K2/8/8/8/8/R7 w - - 0 1',
    objective: 'mate-in-n',
    movesToMate: 2,
    solution: { lines: [{ move: 'f6g6', children: [{ move: 'h8g8' }] }] }
  })
  assert.ok(codes(ex).includes('dead-end'), codes(ex).join(','))
})

test('a record that claims to be verified is checked again, not believed', () => {
  const lying: Exercise = {
    ...base,
    startFen: '7k/8/6K1/8/8/8/8/5Q2 w - - 0 1',
    sideToMove: 'w',
    objective: 'mate-in-n',
    movesToMate: 1,
    solution: { lines: [{ move: 'f1f2' }] },
    failure: [],
    hints: [],
    tags: [],
    verification: { status: 'verified', by: 'rules', coverage: 'complete' }
  }
  const { exercise, check } = verifyExercise(lying, 10)
  assert.equal(check.ok, false)
  assert.equal(exercise.verification.status, 'rejected')
  assert.equal(exercise.verification.needs, 'fixing')
  assert.equal(isVerified(exercise), false)
  assert.ok((exercise.verification.problems ?? []).length > 0)
})

// ---------------------------------------------------------------- the mate search

test('the mate search finds every mate and nothing that is not one', () => {
  const twoWays = forcedMateTree('k7/1R5P/2K5/8/8/8/8/8 w - - 0 1', 1)
  assert.equal(twoWays.solution?.lines.length, 2)
  assert.deepEqual(twoWays.solution?.lines.map((l) => l.move).sort(), ['h7h8q', 'h7h8r'])

  // Stalemate is not mate, and a search that confused the two would find one here.
  assert.equal(forcedMateTree('7k/8/5K2/8/8/8/8/6Q1 w - - 0 1', 1).solution?.lines.length, 1)
  assert.equal(hasMateIn('7k/8/5K2/8/8/8/8/R7 w - - 0 1', 1), false)
  assert.equal(hasMateIn('7k/8/5K2/8/8/8/8/R7 w - - 0 1', 2), true)
  assert.equal(forcedMateTree(START_FEN, 2).solution, null)

  // Running out of budget says nothing rather than something wrong.
  const starved = forcedMateTree('7k/8/5K2/8/8/8/8/R7 w - - 0 1', 2, 5)
  assert.equal(starved.exceeded, true)
  assert.equal(starved.solution, null)
})

test('a generated mate tree passes the validator it was built for', () => {
  for (const [fen, moves] of [['7k/8/5K2/8/8/8/8/1Q6 w - - 0 1', 2], ['6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1', 1]] as const) {
    const found = forcedMateTree(fen, moves)
    assert.ok(found.solution, fen)
    const ex = newExercise({
      ...base,
      prompt: `Mate in ${moves}.`,
      startFen: fen,
      objective: 'mate-in-n',
      movesToMate: moves,
      solution: found.solution,
      source: { kind: 'generated', by: 'forcedMateTree' }
    })
    const check = validateExercise(ex)
    assert.equal(check.ok, true, `${fen}: ${check.problems.map((p) => p.says).join(' / ')}`)
    assert.equal(check.coverage, 'complete', fen)
  }
})

// ---------------------------------------------------------------- following a line

test('following a played sequence keeps "cannot be played" apart from "not the answer"', () => {
  const ex = newExercise({
    ...base,
    prompt: 'Mate in two.',
    startFen: '7k/8/5K2/8/8/8/8/R7 w - - 0 1',
    objective: 'mate-in-n',
    movesToMate: 2,
    solution: { lines: [{ move: 'f6g6', children: [{ move: 'h8g8', children: [{ move: 'a1a8' }] }] }] }
  })
  const onLine = follow(ex, ['f6g6', 'h8g8', 'a1a8'])
  assert.equal(onLine.illegalAt, null)
  assert.equal(onLine.divergedAt, null)
  assert.equal(onLine.lineComplete, true)

  const halfway = follow(ex, ['f6g6'])
  assert.equal(halfway.lineComplete, false)
  assert.equal(halfway.turn, 'opponent')
  assert.equal(halfway.accepted.length, 1)

  const wrong = follow(ex, ['a1a8'])
  assert.equal(wrong.illegalAt, null, 'Ra8 is a legal move')
  assert.equal(wrong.divergedAt, 0)

  const unplayable = follow(ex, ['a1a9'])
  assert.equal(unplayable.illegalAt, 0)
  assert.equal(unplayable.divergedAt, null)
})
