/**
 * Picking a piece up and putting it down.
 *
 * The 3D board holds no position and no history. All it ever holds is which square is picked up and where the
 * keyboard cursor is, and even that is thrown away the moment the position changes. Everything else is asked of
 * the rules, every time, for the exact position on screen.
 *
 * That is what makes switching between the flat board and this one safe: there is no second copy of the game to
 * drift. This file is the whole of the 3D board's opinion about chess, and its opinion is "ask `rules.ts`".
 */

import {
  applyMove, boardSquares, destinationsFrom, needsPromotion, outcome, sideToMove,
  type ChessMove, type PieceLetter
} from '../../../../../shared/chess/rules.ts'
import { FILES, isSquare, type Orientation } from './boardGeometry.ts'

/** What the 3D board remembers between clicks. Deliberately tiny. */
export interface Holding {
  /** The square whose piece is picked up, if any. */
  selected: string | null
  /** Where the keyboard cursor is. */
  cursor: string
  /** A move waiting on a choice of promotion piece. */
  promotion: { from: string; to: string } | null
}

export function emptyHolding(cursor = 'e4'): Holding {
  return { selected: null, cursor, promotion: null }
}

/** What a click or a key press did. The move, when there is one, is the rules' own move, unaltered. */
export type Result =
  | { kind: 'nothing'; holding: Holding }
  | { kind: 'held'; holding: Holding }
  | { kind: 'ask-promotion'; holding: Holding }
  | { kind: 'move'; holding: Holding; move: ChessMove }

/** Which squares to mark as somewhere the picked-up piece could go, split by whether something is there to take. */
export interface Destinations { empty: string[]; captures: string[] }

export function destinationsFor(fen: string, selected: string | null): Destinations {
  if (!selected) return { empty: [], captures: [] }
  const occupied = new Set(boardSquares(fen).map((one) => one.square))
  const empty: string[] = []
  const captures: string[] = []
  for (const move of destinationsFrom(fen, selected)) {
    // Promotions come back once per piece a pawn could become; the square only needs marking once.
    const list = occupied.has(move.to) ? captures : empty
    if (!list.includes(move.to)) list.push(move.to)
  }
  return { empty, captures }
}

/**
 * Clicking a square.
 *
 * The order matters and is the same as the flat board's: putting a piece down on a square it may go to wins over
 * picking up whatever is standing there, so taking a piece works by clicking it. Clicking anywhere else lets go.
 */
export function clickSquare(fen: string, holding: Holding, square: string, interactive = true): Result {
  if (!isSquare(square)) return { kind: 'nothing', holding }
  const cursorMoved: Holding = { ...holding, cursor: square }
  if (!interactive) return { kind: 'nothing', holding: cursorMoved }
  // A choice of promotion piece is outstanding; nothing else may happen until it is answered or cancelled.
  if (holding.promotion) return { kind: 'ask-promotion', holding: cursorMoved }

  const selected = holding.selected
  if (selected) {
    const reachable = destinationsFrom(fen, selected).some((one) => one.to === square)
    if (reachable) {
      if (needsPromotion(fen, selected, square)) {
        return { kind: 'ask-promotion', holding: { selected, cursor: square, promotion: { from: selected, to: square } } }
      }
      const move = applyMove(fen, { from: selected, to: square })
      // The rules refused it, so nothing happens. The board does not decide to allow it anyway.
      if (!move) return { kind: 'nothing', holding: { ...cursorMoved, selected: null } }
      return { kind: 'move', holding: { selected: null, cursor: square, promotion: null }, move }
    }
  }

  const piece = boardSquares(fen).find((one) => one.square === square)
  if (piece && piece.color === sideToMove(fen)) {
    // Clicking the piece you are already holding puts it back down.
    const next = square === selected ? null : square
    return { kind: next ? 'held' : 'nothing', holding: { ...cursorMoved, selected: next } }
  }
  return { kind: 'nothing', holding: { ...cursorMoved, selected: null } }
}

/** Answering the promotion question. Anything other than a piece a pawn may become is refused. */
export function choosePromotion(fen: string, holding: Holding, piece: PieceLetter): Result {
  const pending = holding.promotion
  if (!pending) return { kind: 'nothing', holding }
  if (piece === 'k' || piece === 'p') return { kind: 'ask-promotion', holding }
  const move = applyMove(fen, { from: pending.from, to: pending.to, promotion: piece })
  if (!move) return { kind: 'nothing', holding: { selected: null, cursor: holding.cursor, promotion: null } }
  return { kind: 'move', holding: { selected: null, cursor: pending.to, promotion: null }, move }
}

export function cancelPromotion(holding: Holding): Result {
  return { kind: 'nothing', holding: { ...holding, promotion: null } }
}

/** Letting go of whatever is held. */
export function release(holding: Holding): Result {
  return { kind: 'nothing', holding: { ...holding, selected: null, promotion: null } }
}

/**
 * Walking the squares with the arrow keys.
 *
 * The step is from the viewer's point of view, not from White's: pressing right moves right on the screen, which
 * when the board is turned round is the other way along the files. Anybody who has used a board that got this
 * wrong knows why it is worth a function of its own.
 */
export function walk(cursor: string, dFile: number, dRank: number, orientation: Orientation): string {
  const from = isSquare(cursor) ? cursor : 'e4'
  const sign = orientation === 'w' ? 1 : -1
  const file = FILES.indexOf(from[0] as (typeof FILES)[number]) + dFile * sign
  const rank = Number(from[1]) + dRank * sign
  const clampedFile = Math.min(7, Math.max(0, file))
  const clampedRank = Math.min(8, Math.max(1, rank))
  return `${FILES[clampedFile]}${clampedRank}`
}

/** Pressing Enter: the same as clicking wherever the cursor is. */
export function takeAtCursor(fen: string, holding: Holding, interactive = true): Result {
  return clickSquare(fen, holding, holding.cursor, interactive)
}

/**
 * Everything the board has to mark, worked out from the position and what is held.
 *
 * All of it comes from the rules: the squares offered are the rules' legal destinations, and the king shown in
 * check is the king the rules say is in check rather than one worked out from the look of the board.
 */
export interface Marks {
  selected: string | null
  legal: string[]
  captures: string[]
  check: string | null
  cursor: string
}

export function marksFor(fen: string, holding: Holding, showLegal: boolean, showCursor: boolean): Marks {
  const destinations = showLegal ? destinationsFor(fen, holding.selected) : { empty: [], captures: [] }
  const state = outcome(fen)
  const inCheck = state.over ? state.reason === 'checkmate' : state.check
  const turn = sideToMove(fen)
  const king = inCheck
    ? boardSquares(fen).find((one) => one.type === 'k' && one.color === turn)?.square ?? null
    : null
  return {
    selected: holding.selected,
    legal: destinations.empty,
    captures: destinations.captures,
    check: king,
    cursor: showCursor ? holding.cursor : ''
  }
}

/** The spoken description of a square, so the 3D board says the same things the flat one does. */
export function describeSquare(
  fen: string, square: string, marks: Marks, lastMove: { from: string; to: string } | null, marked: string[]
): string {
  const names: Record<PieceLetter, string> = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' }
  const piece = boardSquares(fen).find((one) => one.square === square)
  const what = piece ? `${piece.color === 'w' ? 'white' : 'black'} ${names[piece.type]}` : 'empty'
  const extra = [
    marks.selected === square ? 'picked up' : '',
    marks.legal.includes(square) || marks.captures.includes(square) ? 'can move here' : '',
    marks.check === square ? 'in check' : '',
    lastMove && (lastMove.from === square || lastMove.to === square) ? 'last move' : '',
    marked.includes(square) ? 'marked' : ''
  ].filter(Boolean).join(', ')
  return `${square}, ${what}${extra ? `, ${extra}` : ''}`
}
