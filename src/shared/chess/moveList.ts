/**
 * The move list, as rows of a table rather than a run of words.
 *
 * A game read as "1. e4 e5 2. Nf3 Nc6" is a sentence. A move list you can use is a column of numbered rows with
 * White's move and Black's move beside each other, the move you are looking at marked, and every move a thing you
 * can click or walk onto with the keyboard. Getting from one to the other is entirely counting, so it is counted
 * here where it can be tested, and the screen only draws the answer.
 *
 * ## Plies, and why the cursor is a count and not an index
 *
 * A ply is one move by one side. `ply` here means *how many moves have been played*, so 0 is the starting
 * position, 1 is after White's first move, and the last ply is the number of moves in the game. That makes the
 * cursor and the move count the same kind of number, which is what stops the off-by-one that every move list gets
 * wrong at least once: stepping back from the first move lands on the starting position, not on nothing.
 *
 * ## A game that does not start at move one
 *
 * A position set up by hand, a puzzle, or an endgame drill can begin with Black to move and at move 24. So the
 * first side and the first move number are given rather than assumed, and a game that begins with Black to move
 * gets a first row with an empty White cell -- which is how it is written on paper, and the only honest way to
 * number it.
 */

export type Side = 'w' | 'b'

export interface MoveCell {
  /** How many moves have been played once this one has: what to pass back to jump here. */
  ply: number
  san: string
  side: Side
}

export interface MoveRow {
  /** The move number as it is written down, which is not the row's place in the list when the game starts late. */
  number: number
  white: MoveCell | null
  black: MoveCell | null
}

export interface ListShape {
  /** Which side plays the first move in the list. */
  firstSide?: Side
  /** The number the first move is written as. */
  firstNumber?: number
}

/** The rows, in the order they are read. */
export function moveRows(moves: readonly string[], shape: ListShape = {}): MoveRow[] {
  const firstSide: Side = shape.firstSide === 'b' ? 'b' : 'w'
  const firstNumber = Number.isFinite(shape.firstNumber) && (shape.firstNumber as number) >= 1
    ? Math.floor(shape.firstNumber as number)
    : 1
  const rows: MoveRow[] = []
  let number = firstNumber
  let side: Side = firstSide
  // A game that begins with Black to move leaves White's cell of the first row empty, the way it is written down.
  let row: MoveRow = { number, white: null, black: null }
  for (let index = 0; index < moves.length; index += 1) {
    const cell: MoveCell = { ply: index + 1, san: moves[index], side }
    if (side === 'w') {
      row.white = cell
      side = 'b'
    } else {
      row.black = cell
      rows.push(row)
      number += 1
      row = { number, white: null, black: null }
      side = 'w'
    }
  }
  // The row in hand is only pushed when something was written in it, so a finished game has no trailing blank row.
  if (row.white !== null || row.black !== null) rows.push(row)
  return rows
}

/** Which side moved to reach this ply. Null for the starting position, which nobody moved to reach. */
export function sideOfPly(ply: number, shape: ListShape = {}): Side | null {
  if (!Number.isFinite(ply) || ply <= 0) return null
  const firstSide: Side = shape.firstSide === 'b' ? 'b' : 'w'
  const offset = firstSide === 'w' ? 0 : 1
  return (Math.floor(ply) - 1 + offset) % 2 === 0 ? 'w' : 'b'
}

/** How the move at a ply is written when it is said on its own: "24… Nf3", or "25. Rd1". */
export function plyLabel(ply: number, san: string, shape: ListShape = {}): string {
  const side = sideOfPly(ply, shape)
  if (side === null) return 'the starting position'
  const firstNumber = Number.isFinite(shape.firstNumber) && (shape.firstNumber as number) >= 1
    ? Math.floor(shape.firstNumber as number)
    : 1
  const offset = (shape.firstSide === 'b' ? 1 : 0)
  const number = firstNumber + Math.floor((Math.floor(ply) - 1 + offset) / 2)
  return side === 'w' ? `${number}. ${san}` : `${number}… ${san}`
}

export type Step = 'first' | 'back' | 'forward' | 'last'

/** A ply that is really in this game: never below the starting position, never past the last move. */
export function clampPly(ply: number, total: number): number {
  const top = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0
  if (!Number.isFinite(ply)) return 0
  return Math.max(0, Math.min(top, Math.floor(ply)))
}

/** Where a step lands, clamped. Stepping back off the front or forward off the end stays where it is. */
export function stepPly(ply: number, total: number, step: Step): number {
  const here = clampPly(ply, total)
  const top = clampPly(total, total)
  if (step === 'first') return 0
  if (step === 'last') return top
  return clampPly(step === 'back' ? here - 1 : here + 1, total)
}

/** Which keyboard keys walk a move list, so the board and the list cannot disagree about them. */
export function stepForKey(key: string): Step | null {
  if (key === 'ArrowLeft' || key === 'ArrowUp') return 'back'
  if (key === 'ArrowRight' || key === 'ArrowDown') return 'forward'
  if (key === 'Home') return 'first'
  if (key === 'End') return 'last'
  return null
}

/**
 * Where the list is, in words.
 *
 * Said out loud for anybody who cannot see which row is marked, and it is deliberately a count of the whole game
 * rather than a percentage: "move 12 of 41" is a place in a game, and "29%" is not.
 */
export function placeWords(ply: number, total: number): string {
  const here = clampPly(ply, total)
  const top = clampPly(total, total)
  if (top === 0) return 'No moves have been played.'
  if (here === 0) return `The starting position, before the first of ${top} moves.`
  return `Move ${here} of ${top}.`
}
