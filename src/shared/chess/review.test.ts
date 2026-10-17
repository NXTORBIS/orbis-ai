import { test } from 'node:test'
import assert from 'node:assert/strict'
import { START_FEN, legalMoves } from './rules.ts'
import { buildMoves, fenAt, fingerprintOf, type StoredGame } from './model.ts'
import { ACCURACY_FORMULA } from './progress.ts'
import { EVIDENCE } from './coach.ts'
import type { MoveClass, Score, Side } from './evaluation.ts'
import { openSession, recordEvaluation, type PositionEval } from './analysis.ts'
import {
  AWARD_RULES, BRILLIANT_RULE, GREAT_RULE, analysedGameFrom, bookRun, buildGameReview, coachWouldCount, judgeAward,
  linesFrom, reviewFromSession, sideAccuracy,
  type CandidateLine, type PositionLines, type ReviewMove
} from './review.ts'

/**
 * Game Review, tested on values.
 *
 * No engine runs here. Every score and every line below was written by hand, which is the only way to test what the
 * review does with a search that was too shallow, a search that gave one line where two were needed, and a stretch
 * of the game nobody looked at. The chess itself is real: every line is played through the rules before it is used,
 * so a typo in the notation fails the test rather than quietly producing a position nobody could reach.
 */

const cp = (n: number): Score => ({ kind: 'cp', cp: n })
const mate = (n: number): Score => ({ kind: 'mate', moves: n })

function gameOf(sans: string[], startFen = START_FEN): StoredGame {
  const built = buildMoves(startFen, sans.map((san) => ({ san })))
  assert.ok(built.ok, `the test line is not playable: ${JSON.stringify(built.failedAt)}`)
  return {
    id: 'g1',
    profileId: 'p1',
    source: { kind: 'study' },
    startFen,
    moves: built.moves,
    meta: { white: {}, black: {}, result: '*' },
    variant: 'standard',
    createdAt: 1,
    updatedAt: 1,
    fingerprint: fingerprintOf(startFen, built.moves)
  }
}

/** The Italian, four moves each side, so there is real theory to look up and real material to give up. */
const ITALIAN = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5']

const line = (multipv: number, score: Score, pvUci: string[], depth: number | null = 20, provisional?: boolean): CandidateLine => ({
  multipv,
  score,
  depth,
  pvUci,
  ...(provisional === undefined ? {} : { provisional })
})

/** The position after 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5, where White can give a bishop up on f7. */
function italianPosition(): { game: StoredGame; at: (lines: CandidateLine[]) => PositionLines } {
  const game = gameOf(ITALIAN)
  const fen = fenAt(game, 6)
  return { game, at: (lines) => ({ ply: 6, fen, lines }) }
}

// ---------------------------------------------------------------- the awards: what they refuse to say

test('one line is not enough to call a move the only move', () => {
  const { at } = italianPosition()
  const verdict = judgeAward({ uci: 'f3g5' }, at([line(1, cp(50), ['f3g5', 'g8f6'])]))
  assert.equal(verdict.award, null)
  assert.equal(verdict.settled, false, 'with one line the question is unanswered, not answered no')
  assert.match(verdict.why, /[Oo]nly one line/)
  assert.equal(AWARD_RULES.linesNeeded, 2)
})

test('two lines searched to different depths cannot be ranked against each other', () => {
  const { at } = italianPosition()
  const verdict = judgeAward({ uci: 'f3g5' }, at([
    line(1, cp(50), ['f3g5', 'g8f6'], 20),
    line(2, cp(-400), ['f3e5'], 14)
  ]))
  assert.equal(verdict.settled, false)
  assert.match(verdict.why, /different depths \(20 and 14\)/)
})

test('a shallow search names no award, whatever the numbers say', () => {
  const { at } = italianPosition()
  const verdict = judgeAward({ uci: 'f3g5' }, at([
    line(1, cp(50), ['f3g5', 'g8f6'], 5),
    line(2, cp(-400), ['f3e5'], 5)
  ]), { minDepth: 12 })
  assert.equal(verdict.award, null)
  assert.equal(verdict.settled, false)
  assert.match(verdict.why, /only 5 deep/)
})

test('a bound is not a number, so it settles nothing', () => {
  const { at } = italianPosition()
  const verdict = judgeAward({ uci: 'f3g5' }, at([
    line(1, cp(50), ['f3g5', 'g8f6'], 20, true),
    line(2, cp(-400), ['f3e5'], 20)
  ]))
  assert.equal(verdict.settled, false)
  assert.match(verdict.why, /bound/)
})

test('a position with one legal move is never an award', () => {
  // Black's king on h8 has exactly one square to go to, and the rules are what say so.
  const fen = '7k/5R2/6K1/8/8/8/8/8 b - - 0 1'
  const moves = legalMoves(fen)
  assert.equal(moves.length, 1, 'the test position must really have one legal move')
  const verdict = judgeAward({ uci: moves[0].uci }, { ply: 0, fen, lines: [line(1, cp(0), [moves[0].uci])] })
  assert.equal(verdict.award, null)
  assert.equal(verdict.settled, true, 'this one is settled: there was nothing to find')
  assert.match(verdict.why, /one legal move/)
})

test('a move the engine would not have played is not the only move', () => {
  const { at } = italianPosition()
  const verdict = judgeAward({ uci: 'f3g5' }, at([
    line(1, cp(50), ['c4f7', 'e8f7']),
    line(2, cp(-400), ['f3e5'])
  ]))
  assert.equal(verdict.award, null)
  assert.equal(verdict.settled, true)
  assert.match(verdict.why, /something else/)
})

test('an award needs every other move to lose: a second move that also holds settles it no', () => {
  const { at } = italianPosition()
  const verdict = judgeAward({ uci: 'f3g5' }, at([
    line(1, cp(50), ['f3g5', 'g8f6']),
    line(2, cp(20), ['f3e5'])
  ]))
  assert.equal(verdict.award, null)
  assert.equal(verdict.settled, true)
  assert.match(verdict.why, /[Aa]nother move holds/)
})

test('a move that does not hold the position either is no award', () => {
  const { at } = italianPosition()
  const verdict = judgeAward({ uci: 'f3g5' }, at([
    line(1, cp(-600), ['f3g5', 'g8f6']),
    line(2, cp(-900), ['f3e5'])
  ]))
  assert.equal(verdict.award, null)
  assert.equal(verdict.settled, true)
  assert.match(verdict.why, /does not hold/)
})

test('the gap has to be the difference between holding and losing, not a rounding of it', () => {
  const { at } = italianPosition()
  // Line 1 is just inside the holding line and line 2 just outside it: the hold test alone would award this.
  const verdict = judgeAward({ uci: 'f3g5' }, at([
    line(1, cp(-90), ['f3g5', 'g8f6']),
    line(2, cp(-120), ['f3e5'])
  ]))
  assert.equal(verdict.award, null)
  assert.equal(verdict.settled, true)
  assert.match(verdict.why, /not the difference between holding/)
  assert.equal(AWARD_RULES.gapCp, 150)
})

// ---------------------------------------------------------------- the awards: what they do say

test('the only move that holds, costing nothing, is Great', () => {
  const { at } = italianPosition()
  const verdict = judgeAward({ uci: 'f3g5' }, at([
    line(1, cp(50), ['f3g5', 'g8f6']),
    line(2, cp(-400), ['f3e5'])
  ]))
  assert.equal(verdict.award, 'great')
  assert.equal(verdict.settled, true)
  assert.equal(verdict.depth, 20)
  assert.equal(verdict.gaveUp, 0)
  assert.match(verdict.why, /only move that holds/)
  assert.match(verdict.why, /Searched 20 deep/)
})

test('the only move that holds, giving material up, is Brilliant -- measured along the engine s own line', () => {
  const { at } = italianPosition()
  // Bxf7+ Kxf7: a bishop for a pawn. The sacrifice is not read off the move, it is counted along the line.
  const verdict = judgeAward({ uci: 'c4f7' }, at([
    line(1, cp(50), ['c4f7', 'e8f7']),
    line(2, cp(-400), ['f3e5'])
  ]))
  assert.equal(verdict.award, 'brilliant')
  assert.equal(verdict.gaveUp, 200, 'a bishop given for a pawn is two pawns down at the lowest point')
  assert.match(verdict.why, /gives material up/)
})

test('the same move with no reply in the line is Great, and says the sacrifice could not be checked', () => {
  const { at } = italianPosition()
  const verdict = judgeAward({ uci: 'c4f7' }, at([
    line(1, cp(50), ['c4f7']),
    line(2, cp(-400), ['f3e5'])
  ]))
  assert.equal(verdict.award, 'great')
  assert.equal(verdict.gaveUp, null, 'nothing was measured, so nothing is reported')
  assert.match(verdict.why, /too short/)
})

test('a forced mate for the mover beats any centipawn score, so no gap is demanded', () => {
  const { at } = italianPosition()
  const verdict = judgeAward({ uci: 'f3g5' }, at([
    line(1, mate(3), ['f3g5', 'g8f6']),
    line(2, cp(-150), ['f3e5'])
  ]))
  assert.equal(verdict.award, 'great')
  assert.match(verdict.why, /forced mate in 3/)
})

test('a line the rules will not play is not used to claim a sacrifice', () => {
  const { at } = italianPosition()
  const verdict = judgeAward({ uci: 'c4f7' }, at([
    line(1, cp(50), ['c4f7', 'a1a8']),
    line(2, cp(-400), ['f3e5'])
  ]))
  assert.equal(verdict.award, 'great')
  assert.equal(verdict.gaveUp, null)
})

test('the rules behind both awards are written down and shown, with the numbers the code uses', () => {
  assert.match(GREAT_RULE, /only move that holds/)
  assert.match(GREAT_RULE, /1\.50 of a pawn worse/)
  assert.match(BRILLIANT_RULE, /1\.00 of a pawn down/)
  assert.equal(AWARD_RULES.holdCp, -100)
  assert.equal(AWARD_RULES.sacrificeCp, 100)
})

// ---------------------------------------------------------------- book moves

test('theory is looked up position by position, and the run stops where the game leaves it', () => {
  const game = gameOf([...ITALIAN, 'Kf1'])
  const book = bookRun(game)
  assert.equal(book.moves.length, 6, 'all six moves of the Italian are in the dataset')
  assert.equal(book.leftAt, 7, '4.Kf1 is not theory')
  assert.equal(book.leftLabel, '4.Kf1')
  assert.ok(book.last)
  assert.match(book.last.eco, /^[A-E]\d\d$/)
  assert.match(book.says, /left the dataset at 4\.Kf1/)
  for (const move of book.moves) assert.match(move.eco, /^[A-E]\d\d$/)
})

test('a game that leaves theory and transposes back into it is not called theory again', () => {
  /*
   * A real one, not a contrived one. After 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5, the move 4.Nc3 is not in the dataset -- but
   * 4...Nf6 reaches a position that is, the Four Knights Game by transposition. The run has to stop at 4.Nc3 and stay
   * stopped: once a game has left theory, arriving back at a named position was not theory either.
   */
  const game = gameOf([...ITALIAN, 'Nc3', 'Nf6'])
  const book = bookRun(game)
  assert.equal(book.leftAt, 7)
  assert.equal(book.moves.length, 6)
  assert.ok(book.moves.every((move) => move.ply < 7), 'nothing after the game left theory may be called Book')
})

test('a game set up from a position nobody names has no book moves', () => {
  const game = gameOf(['Kg2'], '7k/8/8/8/8/8/8/6K1 w - - 0 1')
  const book = bookRun(game)
  assert.deepEqual(book.moves, [])
  assert.equal(book.last, null)
  assert.match(book.says, /no move of this game is called Book/)
})

// ---------------------------------------------------------------- accuracy

const reviewRow = (over: Partial<ReviewMove> & { ply: number; mover: Side; klass: MoveClass }): ReviewMove => ({
  san: 'e4',
  uci: 'e2e4',
  number: 1,
  fenBefore: START_FEN,
  before: cp(0),
  after: cp(0),
  loss: 0,
  depth: 20,
  why: '',
  analysed: true,
  award: null,
  awardSettled: true,
  awardWhy: '',
  gaveUp: null,
  book: null,
  label: '',
  ...over
})

test('accuracy is a share of the moves that were judged, and says so when that is not the whole game', () => {
  const rows: ReviewMove[] = [
    reviewRow({ ply: 1, mover: 'w', klass: 'best' }),
    reviewRow({ ply: 3, mover: 'w', klass: 'good' }),
    reviewRow({ ply: 5, mover: 'w', klass: 'blunder' }),
    reviewRow({ ply: 7, mover: 'w', klass: 'unclear', depth: null }),
    reviewRow({ ply: 2, mover: 'b', klass: 'excellent' })
  ]
  const white = sideAccuracy(rows, 'w')
  assert.equal(white.judged, 3)
  assert.equal(white.good, 2)
  assert.equal(white.unjudged, 1)
  assert.equal(white.moves, 4)
  assert.equal(white.whole, false)
  assert.ok(white.value !== null && Math.abs(white.value - 2 / 3) < 1e-9)
  assert.match(white.says, /67 per cent: 2 of 3/)
  assert.match(white.says, /not of the whole game/)
  assert.equal(white.formula, ACCURACY_FORMULA, 'the number and the sentence explaining it come from one place')

  const black = sideAccuracy(rows, 'b')
  assert.equal(black.value, 1)
  assert.equal(black.whole, true)
  assert.match(black.says, /every one of Black's moves/)
})

test('no judged move is no figure, never nought per cent', () => {
  const rows = [reviewRow({ ply: 1, mover: 'w', klass: 'unclear', depth: null })]
  const white = sideAccuracy(rows, 'w')
  assert.equal(white.value, null)
  assert.equal(white.judged, 0)
  assert.doesNotMatch(white.says, /0 per cent/)
  assert.match(white.says, /no accuracy figure/)
})

test('an awarded move is already counted with the best moves, not twice', () => {
  const rows = [
    reviewRow({ ply: 1, mover: 'w', klass: 'best', award: 'brilliant' }),
    reviewRow({ ply: 3, mover: 'w', klass: 'best', award: 'great' })
  ]
  const white = sideAccuracy(rows, 'w')
  assert.equal(white.good, 2)
  assert.equal(white.judged, 2)
  assert.equal(white.value, 1)
})

test('mixed depths are reported, because the figure then mixes two measurements', () => {
  const rows = [
    reviewRow({ ply: 1, mover: 'w', klass: 'best', depth: 12 }),
    reviewRow({ ply: 3, mover: 'w', klass: 'good', depth: 20 })
  ]
  const white = sideAccuracy(rows, 'w')
  assert.deepEqual(white.depths, [12, 20])
  assert.match(white.says, /different depths \(12, 20\)/)
})

// ---------------------------------------------------------------- a whole review

/** An evaluation for every position of the game, from a list of scores. */
function sweep(game: StoredGame, scores: (Score | null)[], depth: number | null = 20): PositionEval[] {
  const out: PositionEval[] = []
  for (const [ply, score] of scores.entries()) {
    if (!score) continue
    out.push({ ply, fen: fenAt(game, ply), score, depth })
  }
  return out
}

test('a review names the moves, counts them per side, and never calls a theory move a find', () => {
  const game = gameOf([...ITALIAN, 'Ng5'])
  // Level all the way through, then 4.Ng5 drops a long way: a blunder, and the only measured swing.
  const review = buildGameReview(game, sweep(game, [cp(20), cp(15), cp(25), cp(10), cp(30), cp(20), cp(25), cp(-400)]))
  assert.equal(review.moves.length, 7)
  for (const row of review.moves.slice(0, 6)) {
    assert.equal(row.label, 'Book', `${row.san} is theory and must read as theory`)
    assert.ok(row.book, 'a Book move carries the opening it reached')
  }
  const last = review.moves[6]
  assert.equal(last.book, null)
  assert.equal(last.klass, 'blunder')
  assert.equal(last.label, 'Blunder')
  assert.equal(last.depth, 20, 'the class carries the depth it was judged at')

  assert.equal(review.counts.w.book, 3)
  assert.equal(review.counts.b.book, 3)
  assert.equal(review.counts.w.classes.blunder, 1)
  assert.equal(review.accuracy.w.judged, 4)
  assert.equal(review.accuracy.w.good, 3)
  assert.equal(review.accuracy.b.value, 1)
  assert.match(review.says, /White 75%, Black 100%/)
})

test('a shallow sweep judges nothing, finds no moments, and gives no accuracy', () => {
  const game = gameOf([...ITALIAN, 'Ng5'])
  const review = buildGameReview(game, sweep(game, [cp(20), cp(15), cp(25), cp(10), cp(30), cp(20), cp(25), cp(-400)], 4))
  for (const row of review.moves) assert.equal(row.klass, 'unclear', `${row.san} was searched 4 deep and must not be named`)
  assert.equal(review.accuracy.w.value, null)
  assert.equal(review.accuracy.b.value, null)
  assert.deepEqual(review.key.moments, [])
  assert.equal(review.key.measured, 0)
  assert.equal(review.key.unmeasured.tooShallow, 7)
  assert.match(review.key.says, /too shallowly/)
  assert.match(review.key.says, /Not one move could be measured/)
  // The book run does not need an engine, so it is still there.
  assert.equal(review.moves[0].label, 'Book')
})

test('a key moment is measured off the graph, and nothing is taken from a stretch nobody analysed', () => {
  const game = gameOf([...ITALIAN, 'Ng5', 'Nf6'])
  // Positions 3 and 4 were never analysed, so moves 4 and 5 cannot be measured at all.
  const review = buildGameReview(game, sweep(game, [cp(20), cp(15), cp(25), null, null, cp(20), cp(25), cp(-400), cp(-420)]))
  assert.equal(review.key.moments.length, 1)
  const moment = review.key.moments[0]
  assert.equal(moment.ply, 7)
  assert.equal(moment.san, 'Ng5')
  assert.equal(moment.gained, 'b', 'the drop favoured Black')
  assert.equal(moment.movedCp, 425)
  assert.equal(moment.depth, 20)
  assert.match(moment.explain, /handed the game to Black/)
  assert.equal(review.key.unmeasured.notAnalysed, 3, 'two moves either side of the hole, plus the one inside it')
  assert.match(review.key.says, /could be hiding/)
  assert.ok(review.key.moments.every((one) => one.moved >= review.key.threshold))
})

test('a small change is not a moment, and a mate on the board is the biggest one there is', () => {
  const game = gameOf(['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#'])
  const review = buildGameReview(game, sweep(game, [cp(20), cp(15), cp(25), cp(30), cp(35), cp(40), cp(45), mate(1)]))
  const plies = review.key.moments.map((one) => one.ply)
  assert.deepEqual(plies, [7], 'only the mate moved the graph far enough')
  assert.equal(review.key.measured, 7)
  const moment = review.key.moments[0]
  assert.equal(moment.movedCp, null, 'a mate is not a centipawn number, so none is reported')
  assert.equal(moment.gained, 'w')
  assert.equal(moment.klass, 'unclear', 'the engine will not name this move, and the moment says the mate instead')
  assert.match(moment.explain, /put a forced mate on the board for White/)
  assert.doesNotMatch(moment.explain, /of a pawn/)
})

test('without the engine s other moves, no move is called Brilliant or Great -- and the review says why', () => {
  const game = gameOf([...ITALIAN, 'Ng5'])
  const review = buildGameReview(game, sweep(game, [cp(20), cp(15), cp(25), cp(10), cp(30), cp(20), cp(25), cp(-400)]))
  assert.equal(review.counts.w.brilliant, 0)
  assert.equal(review.counts.w.great, 0)
  assert.equal(review.awards.asked, 0)
  assert.match(review.awards.says, /more than one line/)
  for (const row of review.moves) assert.equal(row.awardSettled, false)
})

/** The Italian with two quiet moves, then the bishop given up on f7 -- past where the dataset stops naming. */
const SACRIFICE = [...ITALIAN, 'Nc3', 'Nf6', 'Bxf7+']

function sacrificeLines(game: StoredGame, bound?: 'lower' | 'upper'): PositionLines[] {
  return [
    linesFrom(8, fenAt(game, 8), [
      { multipv: 1, score: cp(50), depth: 20, pvUci: ['c4f7', 'e8f7'], ...(bound ? { bound } : {}) },
      { multipv: 2, score: cp(-400), depth: 20, pvUci: ['f3e5'] }
    ])
  ]
}

const QUIET_SACRIFICE_SWEEP = [cp(20), cp(15), cp(25), cp(10), cp(30), cp(20), cp(25), cp(20), cp(50), cp(45)]

test('with the engine s other moves recorded, the review awards the move and shows the material it cost', () => {
  const game = gameOf(SACRIFICE)
  const review = buildGameReview(game, sweep(game, QUIET_SACRIFICE_SWEEP), { alternatives: sacrificeLines(game) })
  const row = review.moves[8]
  assert.equal(row.san, 'Bxf7+')
  assert.equal(row.book, null, 'this one is past where the dataset stops naming positions')
  assert.equal(row.award, 'brilliant')
  assert.equal(row.label, 'Brilliant')
  assert.equal(row.gaveUp, 200)
  assert.equal(review.counts.w.brilliant, 1)
  assert.equal(review.awards.asked, 1)
  assert.equal(review.awards.settled, 1)
  assert.equal(review.awards.notLookedAt, 8)
  assert.match(review.says, /1 brilliant/)
})

test('a move that is theory still reads as theory, even when it is also the only move', () => {
  // 4.Bxf7+ in the Italian is the Jerome Gambit, and the dataset names it. A move out of a book is not a move the
  // person found, so Book is what the screen says -- while the award itself is kept on the row.
  const game = gameOf([...ITALIAN, 'Bxf7+'])
  const alternatives: PositionLines[] = [
    linesFrom(6, fenAt(game, 6), [
      { multipv: 1, score: cp(50), depth: 20, pvUci: ['c4f7', 'e8f7'] },
      { multipv: 2, score: cp(-400), depth: 20, pvUci: ['f3e5'] }
    ])
  ]
  const review = buildGameReview(game, sweep(game, [cp(20), cp(15), cp(25), cp(10), cp(30), cp(20), cp(50), cp(45)]), { alternatives })
  const row = review.moves[6]
  assert.ok(row.book)
  assert.match(row.book.name, /Jerome Gambit/)
  assert.equal(row.label, 'Book')
  assert.equal(row.award, 'brilliant', 'the award is still on the row, so a screen can say both')
})

test('a bound on the engine s first line leaves the award unsettled rather than refused', () => {
  const game = gameOf(SACRIFICE)
  const review = buildGameReview(game, sweep(game, QUIET_SACRIFICE_SWEEP), { alternatives: sacrificeLines(game, 'lower') })
  const row = review.moves[8]
  assert.equal(row.award, null)
  assert.equal(row.awardSettled, false)
  assert.equal(review.awards.asked, 1)
  assert.equal(review.awards.settled, 0)
  assert.equal(review.awards.unknown, 1)
})

test('a game already analysed in the Studio reviews from what is on its nodes, with no engine', () => {
  const game = gameOf([...ITALIAN, 'Ng5'])
  let session = openSession(game)
  for (const found of sweep(game, [cp(20), cp(15), cp(25), cp(10), cp(30), cp(20), cp(25), cp(-400)])) {
    const nodeId = session.original[found.ply]
    assert.ok(nodeId, 'the session must have a node for every position of the game')
    session = recordEvaluation(session, nodeId, { fen: found.fen, score: found.score, depth: found.depth })
  }
  const review = reviewFromSession(session)
  assert.equal(review.moves.length, 7)
  assert.equal(review.moves[6].klass, 'blunder')
  assert.equal(review.accuracy.w.judged, 4)
  // The ranked alternatives are not kept on a session, so the awards are unasked rather than refused.
  assert.equal(review.awards.asked, 0)
  assert.match(review.awards.says, /more than one line/)
})

test('the review carries the report it was built on, so nothing measures the game twice', () => {
  const game = gameOf(ITALIAN)
  const review = buildGameReview(game, sweep(game, [cp(20), cp(15), cp(25), cp(10), cp(30), cp(20), cp(25)]))
  assert.equal(review.report.gameId, game.id)
  assert.equal(review.report.graph.length, game.moves.length + 1)
  assert.equal(review.report.moves.length, review.moves.length)
  assert.equal(review.gameId, game.id)
  assert.ok(review.rules.includes(ACCURACY_FORMULA))
})

test('next steps come from positions in this game, and there are none when nothing went wrong', () => {
  const quiet = gameOf(ITALIAN)
  const calm = buildGameReview(quiet, sweep(quiet, [cp(20), cp(15), cp(25), cp(10), cp(30), cp(20), cp(25)]))
  assert.deepEqual(calm.nextSteps, [], 'a well-played game gets no generic advice')

  const game = gameOf([...ITALIAN, 'Ng5'])
  const review = buildGameReview(game, sweep(game, [cp(20), cp(15), cp(25), cp(10), cp(30), cp(20), cp(25), cp(-400)]))
  assert.ok(review.nextSteps.length >= 1)
  for (const step of review.nextSteps) {
    assert.ok(review.moves.some((row) => row.ply === step.ply) || step.ply === review.book.leftAt)
    assert.ok(step.what.length > 20)
  }
  assert.ok(review.nextSteps.some((step) => /Go back to 4\.Ng5/.test(step.what)))
})

// ---------------------------------------------------------------- handing it to the coach

test('a review with nothing judged is evidence about nobody', () => {
  const game = gameOf([...ITALIAN, 'Ng5'])
  const review = buildGameReview(game, sweep(game, [cp(20), cp(15), cp(25), cp(10), cp(30), cp(20), cp(25), cp(-400)], 4))
  assert.equal(analysedGameFrom(review, { you: 'w', analysedAt: 10 }), null)
  const would = coachWouldCount(review, 'w')
  assert.equal(would.counts, false)
  assert.match(would.why, /Not one move was judged/)
})

test('the record handed to the coach keeps the shallowest judgement, not the deepest', () => {
  const game = gameOf([...ITALIAN, 'Ng5'])
  const evaluations = sweep(game, [cp(20), cp(15), cp(25), cp(10), cp(30), cp(20), cp(25), cp(-400)])
  // One position searched shallower than the rest: the judgements that rest on it are the weakest link.
  evaluations[7] = { ...evaluations[7], depth: 13 }
  const review = buildGameReview(game, evaluations)
  const record = analysedGameFrom(review, { you: 'w', analysedAt: 99 })
  assert.ok(record)
  assert.equal(record.depth, 13)
  assert.equal(record.gameId, game.id)
  assert.equal(record.you, 'w')
  assert.equal(record.moves.length, 7)
  assert.equal(record.moves[0].before, START_FEN, 'the coach needs the position a move was played in')
  assert.ok(record.opening, 'the opening comes from the dataset, not from the source tags')
  assert.equal(coachWouldCount(review, 'w').counts, true)
})

test('a game that does not say which side you played says nothing about you, and says that', () => {
  const game = gameOf([...ITALIAN, 'Ng5'])
  const review = buildGameReview(game, sweep(game, [cp(20), cp(15), cp(25), cp(10), cp(30), cp(20), cp(25), cp(-400)]))
  const would = coachWouldCount(review, null)
  assert.equal(would.counts, false)
  assert.match(would.why, /which side you played/)
})

test('a judgement shallower than the coach accepts is refused in words, not silently', () => {
  const game = gameOf([...ITALIAN, 'Ng5'])
  const shallow = sweep(game, [cp(20), cp(15), cp(25), cp(10), cp(30), cp(20), cp(25), cp(-400)], 9)
  const review = buildGameReview(game, shallow)
  const would = coachWouldCount(review, 'w')
  assert.equal(would.counts, false)
  assert.match(would.why, new RegExp(`${EVIDENCE.minDepth} is what a claim about a player needs`))
})
