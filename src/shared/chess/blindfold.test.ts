import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  allSquares, markAnswer, pieceFrom, placementsOf, questionsFor, samePosition, sayAnswer, scoreRecall,
  scoreRecallFen, squareColour, trackPieces, trackingAgrees, type BlindQuestion
} from './blindfold.ts'
import { START_FEN, boardSquares } from './rules.ts'

/**
 * The questions have to have answers, and the tracker has to survive the three moves that are not what they look
 * like: en passant, castling and promotion.
 */

test('the board can be described without looking at it', () => {
  assert.equal(allSquares().length, 64)
  assert.equal(squareColour('a1'), 'dark')
  assert.equal(squareColour('h1'), 'light')
  assert.equal(squareColour('a8'), 'light')
  assert.equal(squareColour('h8'), 'dark')
  assert.equal(squareColour('e4'), 'light')
  assert.equal(squareColour('j9'), null)
})

// ---------------------------------------------------------------- questions

test('every question drawn from a position has an answer that is true of that position', () => {
  const fen = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 5 5'
  const asked = questionsFor(fen, { count: 40, seed: 3 })
  assert.ok(asked.length >= 20, `${asked.length}`)
  const pieces = boardSquares(fen)
  for (const question of asked) {
    assert.ok(question.ask.length > 5, question.id)
    assert.equal(question.fen, fen)
    if (question.answer.kind === 'piece') {
      const square = /\b([a-h][1-8])\b/.exec(question.ask)?.[1]
      assert.ok(square, question.ask)
      const there = pieces.find((p) => p.square === square)
      if (question.answer.piece === null) assert.equal(there, undefined, question.ask)
      else {
        assert.equal(there?.type, question.answer.piece, question.ask)
        assert.equal(there?.color, question.answer.side, question.ask)
      }
    }
    if (question.answer.kind === 'squares') {
      for (const square of question.answer.squares) {
        assert.ok(pieces.some((p) => p.square === square), `${question.ask} -> ${square}`)
      }
    }
    if (question.answer.kind === 'colour') {
      const square = /\b([a-h][1-8])\b/.exec(question.ask)?.[1] ?? ''
      assert.equal(squareColour(square), question.answer.colour)
    }
    // Marking the true answer must always come back right.
    assert.equal(markAnswer(question, sayAnswer(question.answer)).right, true, `${question.ask} / ${sayAnswer(question.answer)}`)
  }
})

test('the same seed draws the same questions, and a different one does not', () => {
  const a = questionsFor(START_FEN, { count: 8, seed: 11 }).map((q) => q.ask)
  const b = questionsFor(START_FEN, { count: 8, seed: 11 }).map((q) => q.ask)
  const c = questionsFor(START_FEN, { count: 8, seed: 12 }).map((q) => q.ask)
  assert.deepEqual(a, b)
  assert.notDeepEqual(a, c)
  assert.equal(new Set(a).size, a.length, 'no question twice')
})

test('a position with four pieces gives fewer questions rather than repeats', () => {
  const sparse = questionsFor('4k3/8/8/8/8/8/8/4K2R w - - 0 1', { count: 50, seed: 1, kinds: ['where-is', 'count'] })
  assert.ok(sparse.length < 50)
  assert.equal(new Set(sparse.map((q) => q.ask)).size, sparse.length)
  assert.equal(questionsFor('nonsense', { count: 4 }).length, 0)
})

test('an answer is marked on what it says, not on how it is typed', () => {
  const fen = '4k3/8/8/8/8/8/8/4K2R w - - 0 1'
  const ask = (answer: BlindQuestion['answer'], text: string): BlindQuestion =>
    ({ id: 'q', kind: 'piece-on-square', ask: text, answer, fen })

  const rook = ask({ kind: 'piece', side: 'w', piece: 'r' }, 'What is on h1?')
  for (const said of ['white rook', 'White Rook', 'R', 'wR', 'rook (white)']) {
    assert.equal(markAnswer(rook, said).right, true, said)
  }
  for (const said of ['black rook', 'queen', 'r', 'nothing', '']) {
    assert.equal(markAnswer(rook, said).right, false, said)
  }
  assert.match(markAnswer(rook, 'rook').says, /Which side/)
  assert.match(markAnswer(rook, 'queen').says, /White's rook/)

  const empty = ask({ kind: 'piece', side: null, piece: null }, 'What is on d4?')
  assert.equal(markAnswer(empty, 'empty').right, true)
  assert.equal(markAnswer(empty, 'nothing').right, true)
  assert.equal(markAnswer(empty, 'white rook').right, false)

  const count = ask({ kind: 'count', value: 2 }, 'How many pieces has White?')
  assert.equal(markAnswer(count, '2').right, true)
  assert.equal(markAnswer(count, 'two').right, false, 'a number is a number')
  assert.equal(markAnswer(count, '3').right, false)
  assert.equal(markAnswer(count, 'lots').right, false)

  const where = ask({ kind: 'squares', squares: ['e1', 'h1'] }, 'Where are White’s pieces?')
  assert.equal(markAnswer(where, 'e1 and h1').right, true)
  assert.equal(markAnswer(where, 'h1, e1').right, true, 'the order is not the answer')
  assert.equal(markAnswer(where, 'e1 h1 a1').right, false)
  assert.match(markAnswer(where, 'e1').says, /Missed: h1/)
  assert.match(markAnswer(where, 'a1').says, /Not there: a1/)

  const side = ask({ kind: 'side', side: 'w' }, 'Whose move is it?')
  assert.equal(markAnswer(side, 'white').right, true)
  assert.equal(markAnswer(side, 'black').right, false)

  const colour = ask({ kind: 'colour', colour: 'dark' }, 'Is a1 light or dark?')
  assert.equal(markAnswer(colour, 'dark').right, true)
  assert.equal(markAnswer(colour, 'light').right, false)
  assert.equal(markAnswer(colour, 'no idea').right, false)
})

// ---------------------------------------------------------------- following the pieces

test('a piece keeps its identity through a line, and the tracker agrees with the rules', () => {
  const tracking = trackPieces(START_FEN, ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Bxc6', 'dxc6'])
  assert.equal(tracking.ok, true)
  assert.equal(tracking.stoppedAt, null)
  assert.equal(trackingAgrees(tracking), true)
  const bishop = pieceFrom(tracking, 'f1')
  assert.equal(bishop?.square, null, 'the bishop went to c6 and was taken there')
  assert.equal(bishop?.takenAtPly, 8)
  const knight = pieceFrom(tracking, 'b8')
  assert.equal(knight?.square, null)
  assert.equal(knight?.takenAtPly, 7)
  assert.equal(knight?.takenBy, bishop?.id)
  const pawn = pieceFrom(tracking, 'd7')
  assert.equal(pawn?.square, 'c6')
  assert.deepEqual(pawn?.path, ['d7', 'c6'])
})

test('en passant takes the pawn that is not on the square the capture lands on', () => {
  const fen = '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1'
  const tracking = trackPieces(fen, ['exd6'])
  assert.equal(tracking.ok, true)
  assert.equal(trackingAgrees(tracking), true, 'the tracker and the rules must see the same board')
  const taken = pieceFrom(tracking, 'd5')
  assert.equal(taken?.square, null, 'the pawn on d5 is gone, although nothing landed on d5')
  assert.equal(taken?.takenAtPly, 1)
  const capturer = pieceFrom(tracking, 'e5')
  assert.equal(capturer?.square, 'd6')
  assert.equal(placementsOf(tracking).length, 3)
  assert.ok(!placementsOf(tracking).some((p) => p.square === 'd5'), 'no ghost pawn left behind')
})

test('castling moves two pieces, and the rook’s squares are not guessed', () => {
  const tracking = trackPieces('r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1', ['O-O', 'O-O-O'])
  assert.equal(tracking.ok, true)
  assert.equal(trackingAgrees(tracking), true)
  assert.equal(pieceFrom(tracking, 'e1')?.square, 'g1')
  assert.equal(pieceFrom(tracking, 'h1')?.square, 'f1')
  assert.equal(pieceFrom(tracking, 'e8')?.square, 'c8')
  assert.equal(pieceFrom(tracking, 'a8')?.square, 'd8')
  assert.deepEqual(pieceFrom(tracking, 'h1')?.path, ['h1', 'f1'])
})

test('a promoted pawn is the same piece, and remembers what it was', () => {
  const tracking = trackPieces('8/P7/8/8/8/8/8/K6k w - - 0 1', ['a8=Q'])
  assert.equal(tracking.ok, true)
  assert.equal(trackingAgrees(tracking), true)
  const promoted = pieceFrom(tracking, 'a7')
  assert.equal(promoted?.type, 'q')
  assert.equal(promoted?.startedAs, 'p')
  assert.equal(promoted?.promotedAtPly, 1)
  assert.equal(promoted?.square, 'a8')
  assert.deepEqual(promoted?.path, ['a7', 'a8'])
})

test('a line that cannot be played stops where it stopped, and says so', () => {
  const tracking = trackPieces(START_FEN, ['e4', 'e5', 'Ke2', 'Qh4'])
  assert.equal(tracking.ok, true)
  const broken = trackPieces(START_FEN, ['e4', 'e9'])
  assert.equal(broken.ok, false)
  assert.equal(broken.stoppedAt, 1)
  assert.equal(broken.san.length, 1)
  assert.equal(trackPieces('nonsense', ['e4']).ok, false)
})

test('a long line with everything in it stays in step with the rules', () => {
  // Castling, an en passant capture, a promotion and a handful of ordinary captures, all in one line.
  const tracking = trackPieces(START_FEN, [
    'e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qd8', 'Nf3', 'Nf6', 'Bc4', 'e6', 'O-O', 'Be7', 'd4', 'O-O',
    'd5', 'exd5', 'Nxd5', 'Nxd5', 'Bxd5', 'c6', 'Bxf7+', 'Kxf7'
  ])
  assert.equal(tracking.ok, true, `stopped at ${tracking.stoppedAt}`)
  assert.equal(trackingAgrees(tracking), true)
  assert.equal(pieceFrom(tracking, 'e1')?.square, 'g1')
  assert.equal(pieceFrom(tracking, 'e8')?.square, 'f7')
})

// ---------------------------------------------------------------- marking a remembered board

test('a board remembered exactly is marked exactly, with the rule stated', () => {
  const fen = '4k3/8/8/8/8/8/8/4K2R w - - 0 1'
  const score = scoreRecall(fen, [
    { square: 'e8', side: 'b', type: 'k' },
    { square: 'e1', side: 'w', type: 'k' },
    { square: 'h1', side: 'w', type: 'r' }
  ])
  assert.equal(score.exact, true)
  assert.equal(score.right, 3)
  assert.equal(score.outOf, 3)
  assert.equal(score.score, 1)
  assert.equal(score.missed, 0)
  assert.equal(score.invented, 0)
  assert.ok(score.rule.includes('/ 3 pieces'), score.rule)
  assert.match(score.says, /all 3 pieces/)
})

test('the partial credit is the stated rule, and the counts are kept apart', () => {
  const fen = '4k3/8/8/8/8/8/8/4K2R w - - 0 1'
  const score = scoreRecall(fen, [
    { square: 'e8', side: 'b', type: 'k' },
    { square: 'h1', side: 'w', type: 'q' },
    { square: 'a4', side: 'w', type: 'n' }
  ])
  assert.equal(score.exact, false)
  assert.equal(score.right, 1)
  assert.equal(score.nearly, 1, 'a queen where the rook stands is the square without the piece')
  assert.equal(score.missed, 1, 'the king on e1 was not mentioned')
  assert.equal(score.invented, 1, 'there is no knight on a4')
  // (1 + 0.5 - 0.5) / 3
  assert.equal(Math.round(score.score * 1000) / 1000, 0.333)
  assert.equal(score.squares.find((s) => s.square === 'h1')?.verdict, 'nearly')
  assert.equal(score.squares.find((s) => s.square === 'a4')?.verdict, 'invented')
  assert.equal(score.squares.find((s) => s.square === 'e1')?.verdict, 'missed')
})

test('naming the wrong side on a busy square earns nothing', () => {
  const score = scoreRecall('4k3/8/8/8/8/8/8/4K2R w - - 0 1', [{ square: 'h1', side: 'b', type: 'r' }])
  assert.equal(score.right, 0)
  assert.equal(score.nearly, 0)
  assert.equal(score.missed, 3)
})

test('a board covered in guesses does not score well', () => {
  const guessed = allSquares().map((square) => ({ square, side: 'w' as const, type: 'p' as const }))
  const score = scoreRecall('4k3/8/8/8/8/8/8/4K2R w - - 0 1', guessed)
  assert.equal(score.score, 0, 'the penalty is what stops guessing being a strategy')
  assert.ok(score.invented > 50)
})

test('a remembered board can arrive as a position instead of a list', () => {
  const fen = '4k3/8/8/8/8/8/8/4K2R w - - 0 1'
  assert.equal(scoreRecallFen(fen, fen)?.exact, true)
  assert.equal(scoreRecallFen(fen, '4k3/8/8/8/8/8/8/4K1R1 w - - 0 1')?.right, 2)
  assert.equal(scoreRecallFen(fen, 'nonsense'), null)
  assert.equal(samePosition(fen, '4k3/8/8/8/8/8/8/4K2R w - - 9 40'), true, 'the clocks are not part of the position')
  assert.equal(samePosition(fen, START_FEN), false)
})
