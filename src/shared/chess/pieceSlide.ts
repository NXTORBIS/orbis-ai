import type { BoardSquare } from './rules.ts'

/**
 * What slides, when the board goes from one position to the next.
 *
 * A piece used to simply appear on its new square: the board is drawn from a FEN, a new FEN arrives, and the knight
 * is somewhere else. It reads as a diagram being swapped rather than as a move being played, and of everything on a
 * board it is the single thing that most decides whether the board feels like a piece of software or a thing you
 * are playing with.
 *
 * This decides nothing about chess. Both positions were produced by the rules; all this does is pair up what left
 * one square with what arrived on another, and it refuses to pair anything it is not sure about -- because a piece
 * sliding the wrong way is far worse than a piece that appears.
 *
 * ## What it refuses
 *
 * It is handed the move the board says was just played, and it animates that move and nothing else. If the two
 * positions are not that move apart -- somebody jumped to another position, stepped backwards, loaded a game, or
 * the board was handed a FEN from somewhere else entirely -- the pairing would be a guess, so it returns nothing
 * and the pieces appear as they always did (Sections 031, 036).
 *
 * Castling is the one move where two pieces travel, and the rook is only added when the rook really did move: it
 * was on the corner before and is on the square beside the king now. Everything else is one piece. A captured
 * piece, including the pawn taken past on en passant, does not slide anywhere -- it is gone, and sliding it off
 * would be inventing a movement no move made.
 */

export interface Slide {
  from: string
  to: string
}

const at = (pieces: readonly BoardSquare[], square: string): BoardSquare | undefined =>
  pieces.find((one) => one.square === square)

const FILES = 'abcdefgh'

/** How far apart two squares are across the board. -1 when either is not a square. */
const fileGap = (from: string, to: string): number => {
  const a = FILES.indexOf(from[0] ?? '')
  const b = FILES.indexOf(to[0] ?? '')
  if (a < 0 || b < 0) return -1
  return Math.abs(a - b)
}

export function slidesFor(
  before: readonly BoardSquare[],
  after: readonly BoardSquare[],
  move: { from: string; to: string } | null | undefined
): Slide[] {
  if (!move || move.from === move.to) return []
  const left = at(before, move.from)
  const arrived = at(after, move.to)
  // The piece has to have left the one square and arrived on the other, and be the same side's piece. The type may
  // differ: a pawn that reaches the eighth rank arrives as a queen, and that is still one piece travelling.
  if (!left || !arrived || left.color !== arrived.color) return []
  if (at(after, move.from)) return []

  const slides: Slide[] = [{ from: move.from, to: move.to }]

  // Castling: the king goes two files, and the rook comes round it. Checked against both positions rather than
  // worked out from the king's move, so a king walking two squares in some other position never drags a rook.
  if (left.type === 'k' && fileGap(move.from, move.to) === 2) {
    const rank = move.to[1]
    const corner = move.to[0] === 'g' ? `h${rank}` : move.to[0] === 'c' ? `a${rank}` : null
    const beside = move.to[0] === 'g' ? `f${rank}` : move.to[0] === 'c' ? `d${rank}` : null
    if (corner && beside) {
      const rookWas = at(before, corner)
      const rookIs = at(after, beside)
      if (rookWas?.type === 'r' && rookWas.color === left.color && rookIs?.type === 'r' && rookIs.color === left.color && !at(after, corner)) {
        slides.push({ from: corner, to: beside })
      }
    }
  }

  return slides
}

/**
 * How long a piece takes to arrive, in milliseconds.
 *
 * Short on purpose. Long animation is what makes a board feel slow: every move waits for it, and the wait is not
 * work being done. This is roughly the length of chess.com's own slide and is the shortest length at which the eye
 * reads the movement as a piece travelling rather than as a flicker.
 *
 * A machine asking for less movement gets none of it -- that decision is the board's, and is made in the
 * stylesheet with `prefers-reduced-motion`, so it holds even if this number is ever used somewhere else.
 */
export const SLIDE_MS = 140
