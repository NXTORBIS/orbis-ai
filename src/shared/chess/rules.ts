import { Chess, validateFen as libValidateFen } from 'chess.js'
import type { Side } from './evaluation.ts'

/**
 * The one place that knows the rules of chess.
 *
 * Everything in Chess World -- the board, the engine, training, imports, live games -- asks this module whether a move
 * is legal and what the position becomes. There is deliberately no second opinion: a board that decided for itself
 * what was legal would disagree with the engine the moment castling rights or en passant were involved, and the
 * disagreement would show up as a position that cannot be reached (Sections 032, 341).
 *
 * chess.js (BSD-2-Clause) does the work. This module is the contract around it: it fixes the shape of a move, keeps
 * the errors useful, and never lets an invalid position through as if it were fine.
 */

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

export type PieceLetter = 'p' | 'n' | 'b' | 'r' | 'q' | 'k'

/** A move as Orbis stores it. The coordinates are the identity; the notation is for people to read. */
export interface ChessMove {
  from: string
  to: string
  /** The piece a pawn became, when it reached the last rank. */
  promotion?: PieceLetter
  /** Standard notation, correct for the position the move was made in. */
  san: string
  /** The engine's own notation, e.g. "e7e8q". */
  uci: string
  piece: PieceLetter
  /** The piece taken, when one was. */
  captured?: PieceLetter
  color: Side
  /** The position before the move, and after it. */
  before: string
  after: string
  /** 'k' or 'q' for castling, 'e' for en passant, when the move was one of those. */
  special?: 'k' | 'q' | 'e'
  check: boolean
  checkmate: boolean
}

export type FenProblem =
  | 'empty'
  | 'fields'
  | 'ranks'
  | 'piece'
  | 'rank-length'
  | 'kings'
  | 'turn'
  | 'castling'
  | 'en-passant'
  | 'halfmove'
  | 'fullmove'
  | 'illegal'
  | 'unknown'

export interface FenCheck {
  ok: boolean
  problem?: FenProblem
  /** Said plainly, for a person: what is wrong with it. */
  reason?: string
}

/** Which part of a FEN is wrong, said in a way that helps rather than "Invalid FEN" (Section 404). */
export function checkFen(fen: string): FenCheck {
  const text = (fen ?? '').trim()
  if (!text) return { ok: false, problem: 'empty', reason: 'There is no position here.' }
  const fields = text.split(/\s+/)
  if (fields.length < 4) return { ok: false, problem: 'fields', reason: `A position needs at least four parts; this has ${fields.length}.` }
  const ranks = fields[0].split('/')
  if (ranks.length !== 8) return { ok: false, problem: 'ranks', reason: `A board has eight rows; this has ${ranks.length}.` }
  for (const [i, rank] of ranks.entries()) {
    let squares = 0
    for (const ch of rank) {
      if (/[1-8]/.test(ch)) squares += Number(ch)
      else if (/[prnbqkPRNBQK]/.test(ch)) squares += 1
      else return { ok: false, problem: 'piece', reason: `Row ${8 - i} contains "${ch}", which is not a chess piece.` }
    }
    if (squares !== 8) return { ok: false, problem: 'rank-length', reason: `Row ${8 - i} describes ${squares} squares instead of 8.` }
  }
  const whiteKings = (fields[0].match(/K/g) ?? []).length
  const blackKings = (fields[0].match(/k/g) ?? []).length
  if (whiteKings !== 1 || blackKings !== 1) {
    return { ok: false, problem: 'kings', reason: `A position needs one king each; this has ${whiteKings} white and ${blackKings} black.` }
  }
  if (fields[1] !== 'w' && fields[1] !== 'b') return { ok: false, problem: 'turn', reason: 'The side to move must be w or b.' }
  if (!/^(-|K?Q?k?q?)$/.test(fields[2]) || fields[2] === '') return { ok: false, problem: 'castling', reason: 'The castling part is not valid.' }
  if (!/^(-|[a-h][36])$/.test(fields[3])) return { ok: false, problem: 'en-passant', reason: 'The en passant square is not valid.' }
  if (fields[4] !== undefined && !/^\d+$/.test(fields[4])) return { ok: false, problem: 'halfmove', reason: 'The halfmove clock must be a whole number.' }
  if (fields[5] !== undefined && !/^\d+$/.test(fields[5])) return { ok: false, problem: 'fullmove', reason: 'The move number must be a whole number.' }
  // The library has the last word: it knows the cases the checks above cannot see.
  const result = libValidateFen(text)
  if (!result.ok) return { ok: false, problem: 'illegal', reason: result.error ?? 'This position is not legal.' }
  return { ok: true }
}

/** A position that can be loaded, or null. Nothing else in Orbis loads a FEN without coming through here. */
export function loadFen(fen: string): Chess | null {
  if (!checkFen(fen).ok) return null
  try {
    return new Chess(fen)
  } catch {
    return null
  }
}

const describe = (m: {
  from: string; to: string; promotion?: string; san: string; piece: string; captured?: string; color: string;
  before: string; after: string; flags: string; lan?: string
}): ChessMove => {
  const board = new Chess(m.after)
  return {
    from: m.from,
    to: m.to,
    ...(m.promotion ? { promotion: m.promotion as PieceLetter } : {}),
    san: m.san,
    uci: `${m.from}${m.to}${m.promotion ?? ''}`,
    piece: m.piece as PieceLetter,
    ...(m.captured ? { captured: m.captured as PieceLetter } : {}),
    color: m.color as Side,
    before: m.before,
    after: m.after,
    ...(m.flags.includes('k') ? { special: 'k' as const } : m.flags.includes('q') ? { special: 'q' as const } : m.flags.includes('e') ? { special: 'e' as const } : {}),
    check: board.inCheck(),
    checkmate: board.isCheckmate()
  }
}

/** Every legal move in a position. The board shows these and nothing else (Section 037). */
export function legalMoves(fen: string): ChessMove[] {
  const game = loadFen(fen)
  if (!game) return []
  return game.moves({ verbose: true }).map((m) => describe(m as never))
}

/** The legal destinations for one square, for highlighting. */
export function destinationsFrom(fen: string, square: string): ChessMove[] {
  const game = loadFen(fen)
  if (!game) return []
  try {
    return game.moves({ square: square as never, verbose: true }).map((m) => describe(m as never))
  } catch {
    return []
  }
}

export type MoveInput = string | { from: string; to: string; promotion?: PieceLetter }

/**
 * Playing a move, if it is legal.
 *
 * Accepts standard notation ("Nf3"), coordinates ("g1f3"), or an object. An illegal move comes back as null and
 * nothing is changed -- no half-applied position, no history that has moved on (Sections 033, 343).
 */
export function applyMove(fen: string, move: MoveInput): ChessMove | null {
  const game = loadFen(fen)
  if (!game) return null
  const attempt = (value: MoveInput): ChessMove | null => {
    try {
      const made = game.move(value as never)
      return made ? describe(made as never) : null
    } catch {
      return null
    }
  }
  if (typeof move === 'string') {
    const text = move.trim()
    if (!text) return null
    // Coordinate notation, which chess.js does not take as SAN.
    const coord = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(text)
    if (coord) return attempt({ from: coord[1], to: coord[2], ...(coord[3] ? { promotion: coord[3] as PieceLetter } : {}) })
    return attempt(text)
  }
  return attempt(move)
}

/** Does this move need a promotion piece chosen before it can be played? */
export function needsPromotion(fen: string, from: string, to: string): boolean {
  return destinationsFrom(fen, from).some((m) => m.to === to && m.promotion !== undefined)
}

export type Outcome =
  | { over: false; check: boolean }
  | { over: true; result: '1-0' | '0-1' | '1/2-1/2'; reason: 'checkmate' | 'stalemate' | 'insufficient-material' | 'threefold' | 'fifty-move' }

/**
 * Whether the game is over, and why.
 *
 * `history` matters: repetition and the fifty-move rule are facts about how the position was reached, which a FEN on
 * its own cannot answer (Sections 034, 348).
 */
export function outcome(fen: string, history: string[] = []): Outcome {
  const game = loadFen(fen)
  if (!game) return { over: false, check: false }
  if (history.length) {
    const replay = new Chess()
    let ok = true
    for (const san of history) {
      try { replay.move(san) } catch { ok = false; break }
    }
    if (ok && replay.fen() === fen) {
      if (replay.isCheckmate()) return { over: true, result: replay.turn() === 'w' ? '0-1' : '1-0', reason: 'checkmate' }
      if (replay.isStalemate()) return { over: true, result: '1/2-1/2', reason: 'stalemate' }
      if (replay.isInsufficientMaterial()) return { over: true, result: '1/2-1/2', reason: 'insufficient-material' }
      if (replay.isThreefoldRepetition()) return { over: true, result: '1/2-1/2', reason: 'threefold' }
      if (replay.isDraw()) return { over: true, result: '1/2-1/2', reason: 'fifty-move' }
      return { over: false, check: replay.inCheck() }
    }
  }
  if (game.isCheckmate()) return { over: true, result: game.turn() === 'w' ? '0-1' : '1-0', reason: 'checkmate' }
  if (game.isStalemate()) return { over: true, result: '1/2-1/2', reason: 'stalemate' }
  if (game.isInsufficientMaterial()) return { over: true, result: '1/2-1/2', reason: 'insufficient-material' }
  if (game.isDraw()) return { over: true, result: '1/2-1/2', reason: 'fifty-move' }
  return { over: false, check: game.inCheck() }
}

/** Whose turn it is. */
export function sideToMove(fen: string): Side {
  const game = loadFen(fen)
  return game ? (game.turn() as Side) : 'w'
}

/** The move number shown beside a move. */
export function moveNumber(fen: string): number {
  const n = Number.parseInt(fen.trim().split(/\s+/)[5] ?? '1', 10)
  return Number.isFinite(n) && n > 0 ? n : 1
}

/**
 * The engine's notation turned into readable notation, against the position it was played in.
 *
 * It has to be done position by position: the same "g1f3" is "Nf3" in one position and needs a disambiguating letter
 * in another, so a line can only be written out by walking it (Section 405).
 */
export function uciLineToSan(fen: string, uciMoves: string[]): { san: string[]; fens: string[]; legal: boolean } {
  const san: string[] = []
  const fens: string[] = []
  let current = fen
  for (const uci of uciMoves) {
    const made = applyMove(current, uci)
    if (!made) return { san, fens, legal: false }
    san.push(made.san)
    current = made.after
    fens.push(current)
  }
  return { san, fens, legal: true }
}

/** Reading notation into coordinates, against the position it belongs to. */
export function sanToUci(fen: string, san: string): string | null {
  const made = applyMove(fen, san)
  return made ? made.uci : null
}

/** A position's identity, including the state that decides what is legal, so two boards are not confused. */
export function positionKey(fen: string): string {
  const f = fen.trim().split(/\s+/)
  // Piece placement, side to move, castling rights and the en passant square. The clocks are left out: they change
  // what a draw claim does, not what is legal now, and including them would miss every real repeat of a position.
  return `${f[0]} ${f[1]} ${f[2] ?? '-'} ${f[3] ?? '-'}`
}

export interface BoardSquare { square: string; type: PieceLetter; color: Side }

/** The pieces on the board, for drawing it. */
export function boardSquares(fen: string): BoardSquare[] {
  const game = loadFen(fen)
  if (!game) return []
  const out: BoardSquare[] = []
  for (const row of game.board()) {
    for (const cell of row) {
      if (cell) out.push({ square: cell.square, type: cell.type as PieceLetter, color: cell.color as Side })
    }
  }
  return out
}

/** Builds a position from pieces placed by hand, for the position editor (Sections 040, 241-245). */
export function buildFen(input: {
  pieces: BoardSquare[]
  turn: Side
  castling?: string
  enPassant?: string
  halfmove?: number
  fullmove?: number
}): { fen: string; check: FenCheck } {
  const grid: (BoardSquare | null)[][] = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => null))
  for (const piece of input.pieces) {
    const file = piece.square.charCodeAt(0) - 97
    const rank = Number(piece.square[1])
    if (file < 0 || file > 7 || !Number.isFinite(rank) || rank < 1 || rank > 8) continue
    grid[8 - rank][file] = piece
  }
  const rows = grid.map((row) => {
    let text = ''
    let empty = 0
    for (const cell of row) {
      if (!cell) { empty += 1; continue }
      if (empty) { text += String(empty); empty = 0 }
      text += cell.color === 'w' ? cell.type.toUpperCase() : cell.type
    }
    if (empty) text += String(empty)
    return text
  })
  const castling = (input.castling ?? '').replace(/[^KQkq]/g, '') || '-'
  const enPassant = /^[a-h][36]$/.test(input.enPassant ?? '') ? (input.enPassant as string) : '-'
  const fen = `${rows.join('/')} ${input.turn} ${castling} ${enPassant} ${Math.max(0, input.halfmove ?? 0)} ${Math.max(1, input.fullmove ?? 1)}`
  return { fen, check: checkFen(fen) }
}
