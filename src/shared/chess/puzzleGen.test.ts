import { test } from 'node:test'
import assert from 'node:assert/strict'
import { judge } from './attempt.ts'
import type { Score } from './evaluation.ts'
import { validateExercise } from './exercise.ts'
import { buildMoves, fingerprintOf, type GameMeta, type GameMove, type StoredGame } from './model.ts'
import { applyMove } from './rules.ts'
import {
  GENERATE_DEFAULTS, considerPly, engineWords, generateFromGame, indexEvaluations, mateAt, plyRange,
  scanCost, scanForMates, sourceGameId, type GenEval, type GenerateOptions, type SourceGame
} from './puzzleGen.ts'
import { themeNames } from './puzzles.ts'

/**
 * Making puzzles out of a game, and -- mostly -- refusing to.
 *
 * ## About the evaluations in here
 *
 * The `GenEval` values below are **fixtures for a pure function**, not claims about what any engine said. They exist
 * to drive the thresholds: a 400-centipawn drop, a 30-centipawn gap between two first moves, a depth of 6. The
 * engine route is deliberately built so that nothing in it believes an engine about chess -- the engine only says
 * *where to look*, and the rules say what is there. The tests that assert a puzzle is correct all go through
 * `forcedMateTree` and `validateExercise`, which read the real board.
 *
 * ## The games in here are real
 *
 * Every game is built by `buildMoves`, which plays the moves. A game in a test that cannot be played does not exist.
 */

const NOW = 1_700_000_000_000

function game(o: { id?: string; startFen: string; san: string[]; meta?: Partial<GameMeta> }): SourceGame & StoredGame {
  const built = buildMoves(o.startFen, o.san.map((san) => ({ san })))
  assert.equal(built.ok, true, `the test game must be playable: ${JSON.stringify(built.failedAt)}`)
  const moves: GameMove[] = built.moves
  return {
    id: o.id ?? 'g1',
    profileId: 'p',
    source: { kind: 'custom-position' },
    startFen: o.startFen,
    moves,
    meta: { white: {}, black: {}, result: '*', ...o.meta },
    variant: 'standard',
    createdAt: NOW,
    updatedAt: NOW,
    fingerprint: fingerprintOf(o.startFen, moves)
  }
}

const cp = (value: number): Score => ({ kind: 'cp', cp: value })
const mateIn = (moves: number): Score => ({ kind: 'mate', moves })

function evaluation(o: Partial<GenEval> & { ply: number; fen: string; score: Score }): GenEval {
  return { depth: 20, ...o }
}

const options = (over: Partial<GenerateOptions> = {}): GenerateOptions => ({ now: NOW, ...over })

/** The back-rank mate position, with White throwing the mate away. */
const BACK_RANK = '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1'
/** Mate in two: 1.Kg6 Kg8 2.Ra8#. Two first moves work, which a puzzle may have. */
const MATE_IN_TWO = '7k/8/5K2/8/8/8/8/R7 w - - 0 1'
/** Two mates in one, so the puzzle has two answers. */
const TWO_MATES = '6k1/5ppp/8/8/8/8/5PPP/R2R2K1 w - - 0 1'
/** Black to move with exactly one legal move. */
const ONE_LEGAL = '7k/8/6KQ/8/8/8/8/8 b - - 0 1'
/** White's knight on b7 can take an undefended queen on d8. */
const HANGING_QUEEN = '3q3k/1N6/8/8/8/8/8/4K3 w - - 0 1'
/** A king and a pawn against a king: nothing to prove here, whatever an engine prefers. */
const NOTHING_TO_PROVE = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1'

// ---------------------------------------------------------------- the rules-only mate scan

test('a mate missed in a game becomes a puzzle that is checked before it ships', () => {
  // One move long on purpose: with those three pawns in front of the king, almost any rook check on the back row
  // is mate, so a longer game would make several puzzles and this test is about one of them.
  const missed = game({ startFen: BACK_RANK, san: ['Rb1'], meta: { white: { name: 'Ada' }, black: { name: 'Bo' }, event: 'Club night', date: '2026.02.11' } })
  const result = scanForMates(missed, options({ mateDepth: 1 }))

  assert.equal(result.generated.length, 1)
  const made = result.generated[0]

  // Checked, by the rules, before anybody is shown it.
  assert.equal(made.puzzle.exercise.verification.status, 'verified')
  assert.equal(made.puzzle.exercise.verification.by, 'rules')
  assert.equal(made.puzzle.exercise.verification.coverage, 'complete')
  assert.equal(validateExercise(made.puzzle.exercise, NOW).ok, true, 'and it passes the check again, from the position')
  assert.equal(made.check.objective, 'proved')
  assert.match(made.says, /Checked by the rules/)

  // It is the moment it says it is, and the solution is the move that was missed.
  assert.equal(made.moment.ply, 0)
  assert.equal(made.moment.playedSan, 'Rb1')
  assert.equal(made.moment.side, 'w')
  assert.equal(made.moment.found, 'rules-mate-scan')
  assert.equal(made.puzzle.exercise.startFen, BACK_RANK)
  assert.equal(made.puzzle.exercise.movesToMate, 1)
  assert.equal(applyMove(BACK_RANK, made.puzzle.exercise.solution.lines[0].move)?.san, 'Ra8#')

  // The source game and the fact that no engine was involved are both on the record.
  assert.equal(sourceGameId(made.puzzle), 'g1')
  assert.equal(made.puzzle.exercise.source.kind, 'from-game')
  assert.deepEqual(made.puzzle.exercise.source.game, { white: 'Ada', black: 'Bo', event: 'Club night', date: '2026.02.11', ply: 0 })
  assert.match(made.puzzle.exercise.source.note ?? '', /no engine/)
  assert.equal(made.engine, null)
  assert.equal(made.shallow, false)

  // Themes, hints and an explanation, all built off what was proved.
  assert.ok(themeNames(made.puzzle).includes('back-rank-mate'))
  assert.ok(made.puzzle.exercise.hints.length >= 2)
  assert.deepEqual(made.puzzle.exercise.hints.map((one) => one.level), made.puzzle.exercise.hints.map((_one, i) => i + 1))
  assert.match(made.puzzle.exercise.lesson ?? '', /Rb1 was played here/)
  assert.match(made.puzzle.exercise.prompt, /forced mate in 1/)

  // And it has no rating, because nothing has rated it.
  assert.equal(made.puzzle.rating, null)
  assert.equal(made.puzzle.ratingFrom, null)
})

test('a mate that was actually played is not a puzzle, and the reason is recorded', () => {
  const played = game({ startFen: BACK_RANK, san: ['Ra8#'] })
  const skipped = scanForMates(played, options({ mateDepth: 1 }))
  assert.equal(skipped.generated.length, 0)
  assert.ok(skipped.skipped.some((one) => one.ply === 0 && one.reason === 'mate-was-played'))
  assert.match(skipped.says, /No puzzles came out/)

  // Asked for them anyway, it comes through and says so.
  const wanted = scanForMates(played, options({ mateDepth: 1, onlyMissed: false }))
  assert.equal(wanted.generated.length, 1)
  assert.match(wanted.generated[0].puzzle.exercise.lesson ?? '', /was played in the game, and it is the mate/)
})

test('a mate in two is found by the rules, with every defence answered', () => {
  const missed = game({ startFen: MATE_IN_TWO, san: ['Ra8+', 'Kh7'] })
  const result = scanForMates(missed, options({ mateDepth: 2 }))
  const found = result.generated.find((one) => one.moment.ply === 0)
  assert.ok(found, 'the position at the start is a mate in two')
  const made = found
  assert.equal(made.puzzle.exercise.movesToMate, 2)
  assert.equal(made.puzzle.exercise.verification.status, 'verified')
  assert.equal(made.puzzle.exercise.verification.coverage, 'complete')
  assert.ok(themeNames(made.puzzle).includes('short'))

  // Two first moves force it, and both are accepted.
  const lines = made.puzzle.exercise.solution.lines
  assert.equal(lines.length, 2)
  const first = lines.map((one) => applyMove(MATE_IN_TWO, one.move)?.san).sort()
  assert.deepEqual(first, ['Kf7', 'Kg6'])
  for (const line of lines) {
    const verdict = judge(made.puzzle.exercise, [line.move])
    assert.equal(verdict.kind, 'on-track', 'the first move of a mate in two is not the end of it')
  }
  // And Ra8+, which was played in the game, is a legal move that is not the idea.
  const wrong = judge(made.puzzle.exercise, ['a1a8'])
  assert.equal(wrong.kind, 'not-the-idea')
  if (wrong.kind === 'not-the-idea') assert.equal(wrong.couldStillBeGood, false, 'the rules can show there is no mate in two after it')
})

test('a position with too many answers is not a puzzle', () => {
  // "Rb1" would be ambiguous with two rooks on the first row, so the king steps aside instead.
  const twoMates = game({ startFen: TWO_MATES, san: ['Kh1'] })
  assert.equal(scanForMates(twoMates, options({ mateDepth: 1, maxAnswers: 1 })).generated.length, 0)
  assert.ok(scanForMates(twoMates, options({ mateDepth: 1, maxAnswers: 1 })).skipped.some((one) => one.reason === 'too-many-answers'))
  // Two is within the default, so it ships with both answers recorded.
  const kept = scanForMates(twoMates, options({ mateDepth: 1 }))
  assert.equal(kept.generated.length, 1)
  assert.equal(kept.generated[0].puzzle.exercise.solution.lines.length, 2)
})

test('a position with one legal move is thrown out as trivial', () => {
  const trivial = game({ startFen: ONE_LEGAL, san: ['Kg8'] })
  const result = scanForMates(trivial, options({ mateDepth: 1, toPly: 0 }))
  assert.equal(result.generated.length, 0)
  assert.ok(result.skipped.some((one) => one.ply === 0 && one.reason === 'one-legal-move'))
  assert.match(result.skipped.find((one) => one.reason === 'one-legal-move')?.says ?? '', /nothing to find/)
})

test('a position the game has already finished in is thrown out', () => {
  const finished = game({ startFen: BACK_RANK, san: ['Ra8#'] })
  const result = scanForMates(finished, options({ mateDepth: 1, onlyMissed: false }))
  assert.ok(result.skipped.some((one) => one.ply === 1 && one.reason === 'position-over'))
})

test('the scan can be told which side and which stretch of the game to look at', () => {
  const both = game({ startFen: BACK_RANK, san: ['Rb1', 'Kh8', 'Rb2', 'Kg8', 'Rb1'] })
  assert.deepEqual(plyRange(both, options()), [0, 1, 2, 3, 4, 5])
  assert.deepEqual(plyRange(both, options({ fromPly: 2, toPly: 3 })), [2, 3])
  assert.deepEqual(plyRange(both, options({ fromPly: -5, toPly: 500 })), [0, 1, 2, 3, 4, 5])

  const white = scanForMates(both, options({ mateDepth: 1, side: 'w' }))
  assert.equal(white.skipped.filter((one) => one.reason === 'wrong-side').length, 3, 'the three black positions are left alone')
  const narrowed = scanForMates(both, options({ mateDepth: 1, fromPly: 2, toPly: 2 }))
  assert.equal(narrowed.coverage.considered, 1)
})

test('the scan can be done one position at a time, which is how a screen stays alive', () => {
  const missed = game({ startFen: BACK_RANK, san: ['Rb1', 'Kh8'] })
  const whole = scanForMates(missed, options({ mateDepth: 1 }))
  const piecemeal = plyRange(missed, options()).map((ply) => mateAt(missed, ply, options({ mateDepth: 1 })))
  assert.equal(piecemeal.filter((one) => one.kind === 'puzzle').length, whole.generated.length)
  const first = piecemeal[0]
  assert.equal(first.kind, 'puzzle')
  if (first.kind === 'puzzle') assert.equal(first.made.puzzle.id, whole.generated[0].puzzle.id)
})

test('the same scan run twice gives the same puzzle ids, so nothing is made twice', () => {
  const missed = game({ startFen: BACK_RANK, san: ['Rb1', 'Kh8'] })
  const a = scanForMates(missed, options({ mateDepth: 1 }))
  const b = scanForMates(missed, options({ mateDepth: 1, now: NOW + 86_400_000 }))
  assert.deepEqual(a.generated.map((one) => one.puzzle.id), b.generated.map((one) => one.puzzle.id))
})

test('a scan says roughly what it will cost before it starts', () => {
  const long = game({ startFen: BACK_RANK, san: ['Rb1', 'Kh8', 'Rb2', 'Kg8'] })
  const cheap = scanCost(long, options({ mateDepth: 1 }))
  const dear = scanCost(long, options({ mateDepth: 2 }))
  assert.equal(cheap.positions, 5)
  assert.ok(dear.roughlySeconds >= cheap.roughlySeconds)
  assert.match(dear.says, /you can stop it/)
})

test('nothing shipped by the scan has a fault in it', () => {
  const long = game({ startFen: MATE_IN_TWO, san: ['Ra8+', 'Kh7', 'Rb8', 'Kh6'] })
  const result = scanForMates(long, options({ mateDepth: 2 }))
  assert.equal(result.rejected.length, 0)
  for (const made of result.generated) {
    const again = validateExercise(made.puzzle.exercise, NOW)
    assert.equal(again.ok, true, `${made.puzzle.id}: ${again.problems.map((one) => one.says).join(' | ')}`)
    assert.notEqual(made.puzzle.exercise.verification.status, 'rejected')
  }
})

// ---------------------------------------------------------------- the engine route

test('evaluations that belong to another position are not used, and say so', () => {
  const played = game({ startFen: BACK_RANK, san: ['Rb1', 'Kh8'] })
  const index = indexEvaluations(played, [
    evaluation({ ply: 0, fen: BACK_RANK, score: cp(900) }),
    evaluation({ ply: 1, fen: TWO_MATES, score: cp(10) }),
    evaluation({ ply: 99, fen: BACK_RANK, score: cp(0) })
  ])
  assert.equal(index.byPly.size, 1)
  assert.ok(index.ignored.some((one) => one.ply === 1 && /does not match this game/.test(one.reason)))
  assert.ok(index.ignored.some((one) => one.ply === 99 && /not in this game/.test(one.reason)))
})

test('a deeper search of the same position replaces a shallower one', () => {
  const played = game({ startFen: BACK_RANK, san: ['Rb1'] })
  const index = indexEvaluations(played, [
    evaluation({ ply: 0, fen: BACK_RANK, score: cp(100), depth: 8 }),
    evaluation({ ply: 0, fen: BACK_RANK, score: cp(900), depth: 24 }),
    evaluation({ ply: 0, fen: BACK_RANK, score: cp(50), depth: 4 })
  ])
  assert.equal(index.byPly.get(0)?.depth, 24)
  assert.equal(index.ignored.length, 2)
})

test('a swing with a better move becomes a mate puzzle, proved by the rules rather than believed', () => {
  const missed = game({ startFen: BACK_RANK, san: ['Rb1', 'Kh8'] })
  const after = missed.moves[0].fen
  const result = generateFromGame(missed, [
    evaluation({ ply: 0, fen: BACK_RANK, score: mateIn(1), bestmove: 'a1a8', pvUci: ['a1a8'], alternatives: [{ uci: 'a1a8', score: mateIn(1) }, { uci: 'a1b1', score: cp(120) }] }),
    evaluation({ ply: 1, fen: after, score: cp(120) })
  ], options({ engine: { name: 'Stockfish', version: '17', depth: 20, multipv: 2 } }))

  assert.equal(result.generated.length, 1)
  const made = result.generated[0]
  assert.equal(made.puzzle.exercise.objective, 'mate-in-n')
  assert.equal(made.puzzle.exercise.movesToMate, 1)
  assert.equal(made.puzzle.exercise.verification.status, 'verified')
  assert.equal(made.moment.found, 'engine-swing')
  assert.equal(made.moment.depth, 20)
  assert.equal(made.answersChecked, true)
  assert.deepEqual(made.engine, { name: 'Stockfish', version: '17', depth: 20, multipv: 2 })
  assert.match(made.puzzle.exercise.source.note ?? '', /Stockfish 17/)
  assert.match(made.puzzle.exercise.source.note ?? '', /depth 20/)
  assert.equal(result.coverage.evaluated, 2)
})

test('a swing with no proof behind it is not made into a puzzle unless it is asked for', () => {
  const missed = game({ startFen: NOTHING_TO_PROVE, san: ['Kd1', 'Kd8'] })
  const after = missed.moves[0].fen
  const evals: GenEval[] = [
    evaluation({ ply: 0, fen: missed.startFen, score: cp(300), bestmove: 'e2e4', pvUci: ['e2e4'], alternatives: [{ uci: 'e2e4', score: cp(300) }, { uci: 'e1d1', score: cp(-200) }] }),
    evaluation({ ply: 1, fen: after, score: cp(-200) })
  ]
  const refused = generateFromGame(missed, evals, options())
  assert.equal(refused.generated.length, 0)
  assert.ok(refused.skipped.some((one) => one.reason === 'not-provable'))
  assert.match(refused.skipped.find((one) => one.reason === 'not-provable')?.says ?? '', /no way to tell a solver whether they were right/)

  const asked = generateFromGame(missed, evals, options({ includeEngineOnly: true }))
  assert.equal(asked.generated.length, 1)
  const made = asked.generated[0]
  assert.equal(made.puzzle.exercise.objective, 'find-best')
  assert.equal(made.puzzle.exercise.verification.status, 'unverified')
  assert.equal(made.puzzle.exercise.verification.needs, 'engine')
  assert.match(made.says, /Not checked/)
  assert.match(made.puzzle.exercise.lesson ?? '', /engine’s opinion/)
})

test('material the rules can count becomes a win-material puzzle', () => {
  // White's knight on b7 can take an undefended queen. The engine only points at the moment.
  const missed = game({ startFen: HANGING_QUEEN, san: ['Kf1', 'Kg8'] })
  const after = missed.moves[0].fen
  const result = generateFromGame(missed, [
    evaluation({ ply: 0, fen: HANGING_QUEEN, score: cp(900), bestmove: 'b7d8', pvUci: ['b7d8'], alternatives: [{ uci: 'b7d8', score: cp(900) }, { uci: 'e1f1', score: cp(-200) }] }),
    evaluation({ ply: 1, fen: after, score: cp(-200) })
  ], options())

  assert.equal(result.generated.length, 1)
  const made = result.generated[0]
  assert.equal(made.puzzle.exercise.objective, 'win-material')
  assert.equal(made.puzzle.exercise.materialAtLeast, 900, 'the target is what the line really wins, counted off the board')
  assert.equal(made.puzzle.exercise.verification.status, 'verified')
  assert.ok(themeNames(made.puzzle).includes('hanging-piece'))
  assert.match(made.puzzle.exercise.prompt, /at least 900 centipawns/)
  assert.equal(judge(made.puzzle.exercise, ['b7d8']).kind, 'solved')
})

test('a move that gave up almost nothing is left alone', () => {
  const played = game({ startFen: BACK_RANK, san: ['Rb1', 'Kh8'] })
  const after = played.moves[0].fen
  const result = generateFromGame(played, [
    evaluation({ ply: 0, fen: BACK_RANK, score: cp(120), bestmove: 'a1a8', pvUci: ['a1a8'] }),
    evaluation({ ply: 1, fen: after, score: cp(100) })
  ], options())
  assert.equal(result.generated.length, 0)
  assert.ok(result.skipped.some((one) => one.reason === 'loss-too-small'))
})

test('a position that was already decided before the mistake and still was after it is thrown out', () => {
  const played = game({ startFen: HANGING_QUEEN, san: ['Kf1', 'Kg8'] })
  const after = played.moves[0].fen
  const result = generateFromGame(played, [
    evaluation({ ply: 0, fen: HANGING_QUEEN, score: cp(2500), bestmove: 'b7d8', pvUci: ['b7d8'] }),
    evaluation({ ply: 1, fen: after, score: cp(1200) })
  ], options())
  assert.equal(result.generated.length, 0)
  assert.ok(result.skipped.some((one) => one.reason === 'already-decided'))
  assert.match(result.skipped.find((one) => one.reason === 'already-decided')?.says ?? '', /2500 centipawns before/)
})

test('two moves the engine scores about the same make the position ambiguous, and it is thrown out', () => {
  const played = game({ startFen: HANGING_QUEEN, san: ['Kf1', 'Kg8'] })
  const after = played.moves[0].fen
  const evals: GenEval[] = [
    evaluation({
      ply: 0,
      fen: HANGING_QUEEN,
      score: cp(900),
      bestmove: 'b7d8',
      pvUci: ['b7d8'],
      alternatives: [{ uci: 'b7d8', score: cp(900) }, { uci: 'b7c5', score: cp(870) }]
    }),
    evaluation({ ply: 1, fen: after, score: cp(-200) })
  ]
  const result = generateFromGame(played, evals, options())
  assert.equal(result.generated.length, 0)
  const ambiguous = result.skipped.find((one) => one.reason === 'two-good-moves')
  assert.ok(ambiguous)
  assert.match(ambiguous?.says ?? '', /30 centipawns behind/)
  assert.match(ambiguous?.says ?? '', /told they were wrong/)

  // Widen the window the other way and it is no longer two answers, so the puzzle is made.
  const narrow = generateFromGame(played, evals, options({ ambiguityCp: 10 }))
  assert.equal(narrow.generated.length, 1)
  assert.equal(narrow.generated[0].answersChecked, true)
})

test('with no alternatives reported, nobody has shown the puzzle has one answer, and it says so', () => {
  const played = game({ startFen: HANGING_QUEEN, san: ['Kf1', 'Kg8'] })
  const after = played.moves[0].fen
  const result = generateFromGame(played, [
    evaluation({ ply: 0, fen: HANGING_QUEEN, score: cp(900), bestmove: 'b7d8', pvUci: ['b7d8'] }),
    evaluation({ ply: 1, fen: after, score: cp(-200) })
  ], options())
  assert.equal(result.generated.length, 1)
  assert.equal(result.generated[0].answersChecked, false)
  assert.match(result.generated[0].says, /only one answer/)
})

test('a search too shallow to judge a move is skipped, and marked rather than hidden when it is asked for', () => {
  const missed = game({ startFen: NOTHING_TO_PROVE, san: ['Kd1', 'Kd8'] })
  const after = missed.moves[0].fen
  const evals: GenEval[] = [
    evaluation({ ply: 0, fen: missed.startFen, score: cp(300), depth: 6, bestmove: 'e2e4', pvUci: ['e2e4'] }),
    evaluation({ ply: 1, fen: after, score: cp(-200), depth: 6 })
  ]
  const skipped = generateFromGame(missed, evals, options())
  assert.equal(skipped.generated.length, 0)
  const why = skipped.skipped.find((one) => one.reason === 'shallow')
  assert.ok(why)
  assert.match(why?.says ?? '', /depth 6/)
  assert.equal(skipped.coverage.shallow, 1)

  const asked = generateFromGame(missed, evals, options({ includeShallow: true, includeEngineOnly: true }))
  assert.equal(asked.generated.length, 1)
  assert.equal(asked.generated[0].shallow, true)
  assert.match(asked.generated[0].says, /shallower than asked for/)
})

test('a shallow search that happened to point at a forced mate still ships verified, because the rules settled it', () => {
  const missed = game({ startFen: BACK_RANK, san: ['Rb1', 'Kh8'] })
  const after = missed.moves[0].fen
  const result = generateFromGame(missed, [
    evaluation({ ply: 0, fen: BACK_RANK, score: mateIn(1), depth: 4, bestmove: 'a1a8', pvUci: ['a1a8'] }),
    evaluation({ ply: 1, fen: after, score: cp(100), depth: 4 })
  ], options({ includeShallow: true }))
  assert.equal(result.generated.length, 1)
  assert.equal(result.generated[0].puzzle.exercise.verification.status, 'verified')
  assert.equal(result.generated[0].shallow, false, 'the engine only chose where to look; the rules proved the mate')
})

test('a score the engine had not settled is not used', () => {
  const played = game({ startFen: HANGING_QUEEN, san: ['Kf1', 'Kg8'] })
  const after = played.moves[0].fen
  const result = generateFromGame(played, [
    evaluation({ ply: 0, fen: HANGING_QUEEN, score: cp(900), bestmove: 'b7d8', pvUci: ['b7d8'], provisional: true }),
    evaluation({ ply: 1, fen: after, score: cp(-200) })
  ], options())
  assert.equal(result.generated.length, 0)
  assert.ok(result.skipped.some((one) => one.reason === 'provisional'))
})

test('a position with nothing searched gives nothing, and says which half was missing', () => {
  const played = game({ startFen: HANGING_QUEEN, san: ['Kf1', 'Kg8'] })
  const result = generateFromGame(played, [
    evaluation({ ply: 0, fen: HANGING_QUEEN, score: cp(900), bestmove: 'b7d8', pvUci: ['b7d8'] })
  ], options())
  assert.equal(result.generated.length, 0)
  assert.ok(result.skipped.some((one) => /after the move was not searched/.test(one.says)))
})

test('the engine naming the move that was actually played is not a mistake to find', () => {
  const played = game({ startFen: HANGING_QUEEN, san: ['Nxd8', 'Kg8'] })
  const after = played.moves[0].fen
  const result = generateFromGame(played, [
    evaluation({ ply: 0, fen: HANGING_QUEEN, score: cp(900), bestmove: 'b7d8', pvUci: ['b7d8'] }),
    evaluation({ ply: 1, fen: after, score: cp(900) })
  ], options())
  assert.equal(result.generated.length, 0)
  assert.ok(result.skipped.some((one) => one.reason === 'no-better-move'))
  assert.match(result.skipped.find((one) => one.reason === 'no-better-move')?.says ?? '', /the engine’s own choice/)
})

test('a recapture that is the only way to take back is not a puzzle', () => {
  /*
   * White's knight takes the queen on d8, and Black's rook on f8 is the only thing that can take back there.
   * Black does not, which is what makes it a swing at all -- a recapture that was played is the engine's own choice
   * and is caught earlier. Either way nobody has to *find* the only recapture, so it is not a puzzle.
   */
  const forced = game({ startFen: '3q1r1k/1N6/8/8/8/8/8/4K3 w - - 0 1', san: ['Nxd8', 'Kg8'] })
  const atPly1 = forced.moves[0].fen
  const atPly2 = forced.moves[1].fen
  const result = generateFromGame(forced, [
    evaluation({ ply: 1, fen: atPly1, score: cp(600), bestmove: 'f8d8', pvUci: ['f8d8'] }),
    evaluation({ ply: 2, fen: atPly2, score: cp(900) })
  ], options({ minLossCp: 100, alreadyDecidedCp: 2000 }))
  assert.ok(result.skipped.some((one) => one.ply === 1 && one.reason === 'forced-recapture'), result.skipped.map((one) => `${one.ply}:${one.reason}`).join(' '))
})

test('no more than the number of puzzles asked for come out of one game', () => {
  const long = game({ startFen: MATE_IN_TWO, san: ['Ra8+', 'Kh7', 'Rb8', 'Kh6', 'Rc8', 'Kh7'] })
  const capped = scanForMates(long, options({ mateDepth: 1, maxPuzzles: 1, onlyMissed: false }))
  assert.equal(capped.generated.length <= 1, true)
  const all = scanForMates(long, options({ mateDepth: 2, onlyMissed: false }))
  assert.ok(all.generated.length >= 1)
})

test('a mate search that runs out of budget says nothing either way', () => {
  const open = game({ startFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', san: ['e4', 'e5'] })
  const result = scanForMates(open, options({ mateDepth: 2, mateBudget: 50 }))
  assert.equal(result.generated.length, 0)
  assert.ok(result.skipped.some((one) => one.reason === 'mate-search-exceeded'))
  assert.match(result.skipped.find((one) => one.reason === 'mate-search-exceeded')?.says ?? '', /50 positions were not enough/)
})

// ---------------------------------------------------------------- the small things that have to be right

test('the engine settings are said in words, and nothing unknown is filled in', () => {
  assert.match(engineWords(undefined), /no engine/)
  assert.equal(engineWords({}), 'Found from an engine search; the settings were not recorded.')
  assert.equal(engineWords({ name: 'Stockfish', depth: 18 }), 'Found from an engine search: Stockfish, depth 18.')
  assert.match(engineWords({ name: 'Stockfish', version: '17', movetime: 1500, multipv: 1 }), /Stockfish 17, 1500 ms a position, 1 line\./)
})

test('the defaults are the ones the comments describe', () => {
  assert.equal(GENERATE_DEFAULTS.minDepth, 12)
  assert.equal(GENERATE_DEFAULTS.includeShallow, false)
  assert.equal(GENERATE_DEFAULTS.includeEngineOnly, false)
  assert.equal(GENERATE_DEFAULTS.onlyMissed, true)
})

test('one position considered on its own agrees with the whole game', () => {
  const missed = game({ startFen: BACK_RANK, san: ['Rb1', 'Kh8'] })
  const after = missed.moves[0].fen
  const evals: GenEval[] = [
    evaluation({ ply: 0, fen: BACK_RANK, score: mateIn(1), bestmove: 'a1a8', pvUci: ['a1a8'] }),
    evaluation({ ply: 1, fen: after, score: cp(100) })
  ]
  const index = indexEvaluations(missed, evals)
  const one = considerPly(missed, 0, index, options())
  assert.equal(one.kind, 'puzzle')
  const whole = generateFromGame(missed, evals, options())
  if (one.kind === 'puzzle') assert.equal(one.made.puzzle.id, whole.generated[0].puzzle.id)
})

test('a game with no moves in it gives nothing and does not fall over', () => {
  const empty = game({ startFen: BACK_RANK, san: [] })
  const scanned = scanForMates(empty, options({ mateDepth: 1, onlyMissed: false }))
  assert.equal(scanned.generated.length, 1, 'the starting position is still a position')
  const engine = generateFromGame(empty, [], options())
  assert.equal(engine.generated.length, 0)
  assert.ok(engine.skipped.some((one) => one.reason === 'no-evaluation'))
})
