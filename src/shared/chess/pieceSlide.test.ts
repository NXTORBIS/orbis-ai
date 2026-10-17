import assert from 'node:assert/strict'
import { test } from 'node:test'

import { START_FEN, applyMove, boardSquares, type BoardSquare } from './rules.ts'
import { SLIDE_MS, slidesFor } from './pieceSlide.ts'

/** Plays the moves through the real rules and hands back every position along the way. */
function positions(moves: string[], from = START_FEN): string[] {
  const out = [from]
  let fen = from
  for (const move of moves) {
    const made = applyMove(fen, move)
    assert.ok(made, `${move} is not legal in ${fen}`)
    fen = made.after
    out.push(fen)
  }
  return out
}

const after = (fen: string, move: string): string => {
  const made = applyMove(fen, move)
  assert.ok(made, `${move} is not legal in ${fen}`)
  return made.after
}

const squares = (fen: string): BoardSquare[] => boardSquares(fen)

test('one piece moving slides from one square to the other', () => {
  const [start, played] = positions(['e4'])
  assert.deepEqual(slidesFor(squares(start), squares(played), { from: 'e2', to: 'e4' }), [{ from: 'e2', to: 'e4' }])
})

test('nothing slides when the board was not told which move was played', () => {
  const [start, played] = positions(['e4'])
  assert.deepEqual(slidesFor(squares(start), squares(played), null), [])
  assert.deepEqual(slidesFor(squares(start), squares(played), undefined), [])
})

test('castling slides the rook too, because two pieces really moved', () => {
  // A short castle for White, reached through the real rules.
  const fens = positions(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O'])
  const before = fens[fens.length - 2]
  const now = fens[fens.length - 1]
  assert.deepEqual(slidesFor(squares(before), squares(now), { from: 'e1', to: 'g1' }), [
    { from: 'e1', to: 'g1' },
    { from: 'h1', to: 'f1' }
  ])
})

test('a long castle brings the rook from the other corner', () => {
  const fen = 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1'
  const now = after(fen, 'O-O-O')
  assert.deepEqual(slidesFor(squares(fen), squares(now), { from: 'e1', to: 'c1' }), [
    { from: 'e1', to: 'c1' },
    { from: 'a1', to: 'd1' }
  ])
})

test("Black's castling is Black's rook", () => {
  const fen = 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R b KQkq - 0 1'
  const now = after(fen, 'O-O')
  assert.deepEqual(slidesFor(squares(fen), squares(now), { from: 'e8', to: 'g8' }), [
    { from: 'e8', to: 'g8' },
    { from: 'h8', to: 'f8' }
  ])
})

/**
 * The guard that makes castling safe to detect at all.
 *
 * Positions are handed in from everywhere -- a puzzle, an edited board, a broadcast -- so "the king went two
 * files" is not on its own a castle. With no rook on the corner, only the king slides.
 */
test('a king that goes two squares with no rook behind it drags nothing', () => {
  const before: BoardSquare[] = [
    { square: 'e1', type: 'k', color: 'w' },
    { square: 'e8', type: 'k', color: 'b' }
  ]
  const now: BoardSquare[] = [
    { square: 'g1', type: 'k', color: 'w' },
    { square: 'e8', type: 'k', color: 'b' }
  ]
  assert.deepEqual(slidesFor(before, now, { from: 'e1', to: 'g1' }), [{ from: 'e1', to: 'g1' }])
})

test('a captured piece does not slide anywhere, because no move moved it', () => {
  const fens = positions(['e4', 'd5', 'exd5'])
  const before = fens[2]
  const now = fens[3]
  assert.deepEqual(slidesFor(squares(before), squares(now), { from: 'e4', to: 'd5' }), [{ from: 'e4', to: 'd5' }])
})

test('the pawn taken past on en passant simply goes; one piece slides', () => {
  const fens = positions(['e4', 'a6', 'e5', 'd5', 'exd6'])
  const before = fens[4]
  const now = fens[5]
  assert.deepEqual(slidesFor(squares(before), squares(now), { from: 'e5', to: 'd6' }), [{ from: 'e5', to: 'd6' }])
})

test('a pawn that arrives as a queen is still one piece travelling', () => {
  const fen = '8/P6k/8/8/8/8/8/K7 w - - 0 1'
  const now = after(fen, 'a8=Q')
  assert.deepEqual(slidesFor(squares(fen), squares(now), { from: 'a7', to: 'a8' }), [{ from: 'a7', to: 'a8' }])
})

/**
 * The refusals. Every one of these is a case where pairing a piece up would animate a move nobody played, and a
 * piece sliding the wrong way across a board is worse than a piece that appears.
 */
test('two positions that are not that move apart animate nothing', () => {
  const fens = positions(['e4', 'e5', 'Nf3'])
  // The move named is not the move between these two positions.
  assert.deepEqual(slidesFor(squares(fens[0]), squares(fens[2]), { from: 'g1', to: 'f3' }), [])
  // Stepping backwards: the position before the move, with the move that led into it.
  assert.deepEqual(slidesFor(squares(fens[3]), squares(fens[2]), { from: 'g1', to: 'f3' }), [])
  // A position from another game entirely.
  assert.deepEqual(slidesFor(squares(START_FEN), squares('8/8/4k3/8/8/4K3/8/8 w - - 0 1'), { from: 'e2', to: 'e4' }), [])
})

test('a square to itself is not a move', () => {
  const [start] = positions([])
  assert.deepEqual(slidesFor(squares(start), squares(start), { from: 'e2', to: 'e2' }), [])
})

test('the other side arriving on the square is not the same piece', () => {
  // Hand-built: a white pawn left e2 and a *black* piece is on e4. Nothing travelled from one to the other.
  const before: BoardSquare[] = [{ square: 'e2', type: 'p', color: 'w' }]
  const now: BoardSquare[] = [{ square: 'e4', type: 'p', color: 'b' }]
  assert.deepEqual(slidesFor(before, now, { from: 'e2', to: 'e4' }), [])
})

test('a piece still standing on the square it left is not a move either', () => {
  const before: BoardSquare[] = [{ square: 'e2', type: 'p', color: 'w' }]
  const now: BoardSquare[] = [
    { square: 'e2', type: 'p', color: 'w' },
    { square: 'e4', type: 'p', color: 'w' }
  ]
  assert.deepEqual(slidesFor(before, now, { from: 'e2', to: 'e4' }), [])
})

test('the slide is short, because a long one is what makes a board feel slow', () => {
  assert.ok(SLIDE_MS >= 80 && SLIDE_MS <= 200, `${SLIDE_MS}ms is not the length of a move being played`)
})
