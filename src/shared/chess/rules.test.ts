import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  START_FEN, applyMove, boardSquares, buildFen, checkFen, destinationsFrom, legalMoves, moveNumber, needsPromotion,
  outcome, playable, positionKey, sanToUci, sideToMove, uciLineToSan
} from './rules.ts'

/** The rules are the foundation: if these are wrong, everything above them is wrong and looks right. */

test('the opening position has twenty legal moves and White to play', () => {
  assert.equal(legalMoves(START_FEN).length, 20)
  assert.equal(sideToMove(START_FEN), 'w')
  assert.equal(moveNumber(START_FEN), 1)
})

test('a legal move is played and an illegal one changes nothing', () => {
  const made = applyMove(START_FEN, 'e4')
  assert.ok(made)
  assert.equal(made.san, 'e4')
  assert.equal(made.uci, 'e2e4')
  assert.equal(made.before, START_FEN)
  assert.match(made.after, /^rnbqkbnr\/pppppppp\/8\/8\/4P3/)
  for (const bad of ['e5', 'Ke2', 'e2e5', 'Qd8', 'xyz', '', 'O-O']) {
    assert.equal(applyMove(START_FEN, bad), null, bad)
  }
})

test('coordinates and notation both work, and a promotion keeps the piece asked for', () => {
  assert.equal(applyMove(START_FEN, 'g1f3')?.san, 'Nf3')
  const promo = '8/P7/8/8/8/8/8/K6k w - - 0 1'
  assert.equal(applyMove(promo, 'a8=Q')?.promotion, 'q')
  assert.equal(applyMove(promo, 'a7a8n')?.promotion, 'n')
  assert.equal(applyMove(promo, 'a7a8n')?.san, 'a8=N')
  assert.ok(needsPromotion(promo, 'a7', 'a8'))
  assert.ok(!needsPromotion(START_FEN, 'e2', 'e4'))
})

test('castling follows the rights in the position, not the look of it', () => {
  const ready = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'
  assert.ok(applyMove(ready, 'O-O'))
  assert.ok(applyMove(ready, 'O-O-O'))
  // Same pieces on the same squares, but the rights are gone: castling is not legal.
  const noRights = 'r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1'
  assert.equal(applyMove(noRights, 'O-O'), null)
  assert.equal(applyMove(noRights, 'O-O-O'), null)
  // Through check is not allowed either.
  const attacked = 'r3k2r/8/8/8/8/8/5q2/R3K2R w KQkq - 0 1'
  assert.equal(applyMove(attacked, 'O-O'), null)
  assert.equal(applyMove(ready, 'O-O')?.special, 'k')
})

test('en passant depends on the square in the position', () => {
  const ok = 'rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3'
  const made = applyMove(ok, 'exf6')
  assert.ok(made)
  assert.equal(made.special, 'e')
  assert.equal(made.captured, 'p')
  // The same board without the en passant square: the capture is not available.
  const gone = ok.replace(' f6 ', ' - ')
  assert.equal(applyMove(gone, 'exf6'), null)
})

test('checkmate, stalemate and insufficient material are reported with a result', () => {
  // Fool's mate: 1.f3 e5 2.g4 Qh4#. White is mated and has no move at all.
  const mateFen = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3'
  assert.equal(legalMoves(mateFen).length, 0)
  const mate = outcome(mateFen)
  assert.equal(mate.over, true)
  if (mate.over) {
    assert.equal(mate.reason, 'checkmate')
    assert.equal(mate.result, '0-1')
  }
  const stalemate = outcome('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')
  assert.equal(stalemate.over, true)
  if (stalemate.over) assert.equal(stalemate.reason, 'stalemate')
  const bare = outcome('7k/8/6K1/8/8/8/8/8 w - - 0 1')
  assert.equal(bare.over, true)
  if (bare.over) {
    assert.equal(bare.reason, 'insufficient-material')
    assert.equal(bare.result, '1/2-1/2')
  }
  const ordinary = outcome(START_FEN)
  assert.equal(ordinary.over, false)
})

test('a position in check is reported as such without ending the game', () => {
  const check = outcome('4k3/8/8/8/7q/8/8/4K3 w - - 0 1')
  assert.equal(check.over, false)
  if (!check.over) assert.equal(check.check, true)
})

test('repetition is decided by the history, not by the board alone', () => {
  const shuffle = ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8']
  let fen = START_FEN
  for (const san of shuffle) {
    const made = applyMove(fen, san)
    assert.ok(made, san)
    fen = made.after
  }
  const withHistory = outcome(fen, shuffle)
  assert.equal(withHistory.over, true)
  if (withHistory.over) assert.equal(withHistory.reason, 'threefold')
  // The same position with no history behind it is just a position.
  assert.equal(outcome(fen).over, false)
})

test('a broken position is refused, and the reason says which part is wrong', () => {
  const cases: [string, string][] = [
    ['', 'empty'],
    ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR', 'fields'],
    ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP w KQkq - 0 1', 'ranks'],
    ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNX w KQkq - 0 1', 'piece'],
    ['rnbqkbnr/ppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'rank-length'],
    ['rnbq1bnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'kings'],
    ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR x KQkq - 0 1', 'turn'],
    ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq z9 0 1', 'en-passant']
  ]
  for (const [fen, problem] of cases) {
    const result = checkFen(fen)
    assert.equal(result.ok, false, fen)
    assert.equal(result.problem, problem, fen)
    assert.ok((result.reason ?? '').length > 10, `${fen} needs a readable reason`)
  }
  assert.equal(checkFen(START_FEN).ok, true)
})

test('an engine line is turned into notation only while it stays legal', () => {
  const good = uciLineToSan(START_FEN, ['e2e4', 'e7e5', 'g1f3'])
  assert.equal(good.legal, true)
  assert.deepEqual(good.san, ['e4', 'e5', 'Nf3'])
  assert.equal(good.fens.length, 3)
  const bad = uciLineToSan(START_FEN, ['e2e4', 'e7e5', 'e4e5'])
  assert.equal(bad.legal, false)
  assert.deepEqual(bad.san, ['e4', 'e5'])
})

test('notation is written for the position it belongs to', () => {
  // Two knights can reach the same square, so the notation needs a letter to say which.
  const two = '8/8/8/3N1N2/8/8/8/K6k w - - 0 1'
  const moves = legalMoves(two).filter((m) => m.to === 'e7')
  assert.equal(moves.length, 2)
  assert.ok(moves.every((m) => /^N[df]e7$/.test(m.san)), moves.map((m) => m.san).join(','))
  assert.equal(sanToUci(START_FEN, 'Nf3'), 'g1f3')
  assert.equal(sanToUci(START_FEN, 'Nf6'), null)
})

test('a position is named by what decides its legal moves', () => {
  const a = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'
  const b = 'r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1'
  assert.notEqual(positionKey(a), positionKey(b), 'different castling rights are different positions')
  // The clocks do not change what is legal now, so they do not change the name.
  assert.equal(positionKey(`${a.slice(0, -3)}9 7`), positionKey(a))
})

test('only legal destinations are offered for a square', () => {
  // The bishop is pinned down the e-file, and every bishop move leaves that file.
  const pinned = '4r2k/8/8/8/8/8/4B3/4K3 w - - 0 1'
  const squares = destinationsFrom(pinned, 'e2')
  assert.deepEqual(squares, [])
  assert.equal(destinationsFrom(START_FEN, 'e2').length, 2)
  assert.deepEqual(destinationsFrom(START_FEN, 'e4'), [])
})

test('the board can be read and a position can be built by hand', () => {
  assert.equal(boardSquares(START_FEN).length, 32)
  const built = buildFen({
    pieces: [
      { square: 'e1', type: 'k', color: 'w' },
      { square: 'e8', type: 'k', color: 'b' },
      { square: 'd4', type: 'q', color: 'w' }
    ],
    turn: 'w'
  })
  assert.equal(built.check.ok, true)
  assert.equal(built.fen, '4k3/8/8/8/3Q4/8/8/4K3 w - - 0 1')
  // A board with no black king is refused rather than quietly corrected.
  const noKing = buildFen({ pieces: [{ square: 'e1', type: 'k', color: 'w' }], turn: 'w' })
  assert.equal(noKing.check.ok, false)
  assert.equal(noKing.check.problem, 'kings')
})

test('a position the game could never reach is refused, and asking about it does not crash', () => {
  // Black is to move, but White's king is in check: the last move would have left a king attacked.
  const impossible = '4k3/8/8/8/8/8/4r3/4K3 b - - 0 1'
  assert.equal(checkFen(impossible).ok, true, 'it is well formed')
  const verdict = playable(impossible)
  assert.equal(verdict.ok, false)
  assert.match(verdict.reason ?? '', /could not have been reached/)
  // It used to throw from here, taking the caller with it.
  assert.doesNotThrow(() => legalMoves(impossible))
  assert.doesNotThrow(() => outcome(impossible))
  assert.equal(playable(START_FEN).ok, true)
  assert.equal(playable('nonsense').ok, false)
})
