import { applyMove, boardSquares, destinationsFrom, legalMoves, outcome, type ChessMove, type PieceLetter } from './rules.ts'
import { follow, playablePosition, type Exercise } from './exercise.ts'

/**
 * Typing a line out from your head, and being told exactly what went wrong (Sections 213, 216).
 *
 * The Calculation Gym asks for a whole line rather than a move: "1.Nf7+ Kg8 2.Nxd8". That is a different skill from
 * finding one move, and it fails in a different way, which is what this file is for.
 *
 * ## Each move is read in the position it is played in
 *
 * A line is walked, move by move, against the position *reached* -- never against the starting position. Notation
 * only means anything relative to a position: "Nf3" is a different move in two different positions and is not a
 * move at all in a third, and "Ne7" may need a letter to say which knight. A gym that checked the whole line against
 * the start would accept lines that cannot be played and reject lines that can.
 *
 * ## A notation mistake is not a chess mistake
 *
 * The distinction this file refuses to blur (Section 216):
 *
 * ```
 * notation   -- the writing is wrong. Unreadable, ambiguous, a promotion with no piece named, an x where nothing is
 *               taken. The person may well have seen the right move; they wrote it badly, and are told so, with the
 *               way it is written.
 * chess      -- the writing is fine and the move cannot be played. There is no such move in this position. That is
 *               a chess problem and is reported as one.
 * ```
 *
 * Telling somebody their notation was illegal, or that their illegal move was a typo, teaches them something false.
 * So the two never share a message.
 *
 * ## Divergence, not a mark out of ten
 *
 * A submitted line is compared with the accepted ones and the result says **where the two parted company** -- the
 * ply, what was written, and what was accepted there. A line that is right as far as it goes is "short", not wrong.
 *
 * Pure: no clock, no storage, no engine.
 */

// ---------------------------------------------------------------- reading one move

const CASTLE = /^(?:O-O-O|O-O|0-0-0|0-0)$/
const SAN = /^(?<piece>[KQRBN])?(?<fromFile>[a-h])?(?<fromRank>[1-8])?(?<take>x)?(?<to>[a-h][1-8])(?:=(?<promo>[QRBN]))?$/
const UCI = /^(?<from>[a-h][1-8])(?<uto>[a-h][1-8])(?<upromo>[qrbn])?$/

export type NotationFault = 'cannot-read' | 'ambiguous' | 'needs-promotion' | 'capture-mark' | 'decoration'
export type ChessFault = 'no-such-move' | 'nothing-of-that-kind' | 'square-taken' | 'in-check' | 'piece-cannot-move' | 'no-castling'

export type ReadResult =
  | {
      ok: true
      move: ChessMove
      /** What was typed, trimmed. */
      wrote: string
      /** How it is written properly, when that differs from what was typed. */
      tidied?: string
    }
  | {
      ok: false
      /** Which kind of mistake this is. The whole point of the file. */
      fault: 'notation'
      code: NotationFault
      says: string
      /** Ways of writing what they may have meant. */
      suggest?: readonly string[]
    }
  | {
      ok: false
      fault: 'chess'
      code: ChessFault
      says: string
      suggest?: readonly string[]
    }

const PIECE_NAME: Readonly<Record<PieceLetter, string>> = Object.freeze({
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king'
})

const notation = (code: NotationFault, says: string, suggest?: readonly string[]): ReadResult =>
  ({ ok: false, fault: 'notation', code, says, ...(suggest?.length ? { suggest } : {}) })

const chessFault = (code: ChessFault, says: string, suggest?: readonly string[]): ReadResult =>
  ({ ok: false, fault: 'chess', code, says, ...(suggest?.length ? { suggest } : {}) })

/** The squares a king crosses when it castles, and the one it lands on. */
const CASTLE_PATH: Readonly<Record<'wk' | 'wq' | 'bk' | 'bq', { right: string; between: string[] }>> = Object.freeze({
  wk: { right: 'K', between: ['f1', 'g1'] },
  wq: { right: 'Q', between: ['d1', 'c1', 'b1'] },
  bk: { right: 'k', between: ['f8', 'g8'] },
  bq: { right: 'q', between: ['d8', 'c8', 'b8'] }
})

function whyNoCastling(fen: string, long: boolean): ReadResult {
  const fields = fen.trim().split(/\s+/)
  const white = fields[1] === 'w'
  const key = white ? (long ? 'wq' : 'wk') : long ? 'bq' : 'bk'
  const path = CASTLE_PATH[key]
  const rights = fields[2] ?? '-'
  if (!rights.includes(path.right)) {
    return chessFault('no-castling', `${white ? 'White' : 'Black'} cannot castle ${long ? 'long' : 'short'} any more: the king or that rook has already moved.`)
  }
  const occupied = boardSquares(fen).filter((s) => path.between.includes(s.square))
  if (occupied.length > 0) {
    return chessFault('no-castling', `Castling ${long ? 'long' : 'short'} is blocked: the ${PIECE_NAME[occupied[0].type]} on ${occupied[0].square} is in the way.`)
  }
  const now = outcome(fen)
  if (!now.over && now.check) {
    return chessFault('in-check', 'You cannot castle out of check.')
  }
  // Rights, clear squares and no check: what is left is a square the king would cross or land on being attacked.
  return chessFault('no-castling', `Castling ${long ? 'long' : 'short'} is not legal here: one of the squares the king crosses is attacked.`)
}

/**
 * Reading one written move against one position.
 *
 * Tries the plain way first -- if the rules take it, it is a move, and the properly written form comes back in
 * `tidied` when what was typed was not it. Only when the rules refuse does the work of saying *why* begin, and the
 * answer is always one of the two kinds: the writing, or the chess.
 */
export function readMove(fen: string, text: string): ReadResult {
  const raw = (text ?? '').trim()
  if (!raw) return notation('cannot-read', 'Nothing was written.')
  const playable = playablePosition(fen)
  if (!playable.ok) return chessFault('no-such-move', `This position cannot be played from: ${playable.reason ?? ''}`.trim())

  // Annotation marks are not part of the move: "Nf3!!" is "Nf3" with an opinion attached.
  const cleaned = raw.replace(/[+#]+$/, '').replace(/[!?]+$/, '').replace(/\s+/g, '')
  if (!cleaned) return notation('cannot-read', `"${raw}" is punctuation, not a move.`)

  const direct = applyMove(fen, cleaned)
  if (direct) {
    const written = direct.san
    return { ok: true, move: direct, wrote: raw, ...(written !== raw ? { tidied: written } : {}) }
  }

  const legal = legalMoves(fen)
  const mover: 'w' | 'b' = fen.trim().split(/\s+/)[1] === 'b' ? 'b' : 'w'
  const inCheck = (() => {
    const state = outcome(fen)
    return state.over ? state.reason === 'checkmate' : state.check
  })()

  if (CASTLE.test(cleaned)) return whyNoCastling(fen, cleaned.length > 3)

  const uci = UCI.exec(cleaned)
  if (uci?.groups) {
    const { from, uto } = uci.groups
    const fromSquare = boardSquares(fen).find((s) => s.square === from)
    const sameFrom = legal.filter((m) => m.from === from)
    const toward = sameFrom.filter((m) => m.to === uto)
    if (toward.length > 0) {
      // The only way the rules refused is a promotion with no piece named.
      return notation('needs-promotion', `A pawn reaching ${uto} has to become something. Write ${toward.map((m) => m.uci).join(', ')}.`, toward.map((m) => m.san))
    }
    if (!fromSquare) return chessFault('nothing-of-that-kind', `There is nothing on ${from}.`)
    if (fromSquare.color !== mover) {
      return chessFault('no-such-move', `The ${PIECE_NAME[fromSquare.type]} on ${from} belongs to the other side.`)
    }
    if (sameFrom.length === 0) {
      return chessFault(
        inCheck ? 'in-check' : 'piece-cannot-move',
        inCheck
          ? `You are in check, so only a move that answers the check is legal -- and the ${PIECE_NAME[fromSquare.type]} on ${from} has none.`
          : `The ${PIECE_NAME[fromSquare.type]} on ${from} has no legal move at all in this position.`
      )
    }
    return chessFault('no-such-move', `The ${PIECE_NAME[fromSquare.type]} on ${from} cannot go to ${uto}. It can go to ${[...new Set(sameFrom.map((m) => m.to))].join(', ')}.`, sameFrom.map((m) => m.san))
  }

  const san = SAN.exec(cleaned)
  if (!san?.groups) {
    return notation('cannot-read', `"${raw}" cannot be read as a move. A move is written like e4, Nf3, exd5, O-O or e8=Q.`)
  }

  const g = san.groups
  const piece: PieceLetter = (g.piece ? (g.piece.toLowerCase() as PieceLetter) : 'p')
  const to = g.to
  const byDestination = legal.filter((m) => m.to === to && m.piece === piece)
  const hinted = byDestination.filter((m) =>
    (!g.fromFile || m.from[0] === g.fromFile) && (!g.fromRank || m.from[1] === g.fromRank)
  )
  const promoted = g.promo ? hinted.filter((m) => m.promotion === g.promo.toLowerCase()) : hinted

  if (promoted.length > 1) {
    const needsPiece = promoted.every((m) => m.promotion !== undefined)
    if (needsPiece) {
      return notation('needs-promotion', `A pawn reaching ${to} has to become something: write ${promoted.map((m) => m.san).join(', ')}.`, promoted.map((m) => m.san))
    }
    return notation(
      'ambiguous',
      `"${raw}" could be ${promoted.map((m) => m.san).join(' or ')}. Say which by adding the square it comes from.`,
      promoted.map((m) => m.san)
    )
  }

  if (promoted.length === 1) {
    const only = promoted[0]
    if (only.captured && !g.take) {
      return notation('capture-mark', `That move takes a piece, so it is written ${only.san}.`, [only.san])
    }
    if (!only.captured && g.take) {
      return notation('capture-mark', `Nothing is taken on ${to}, so the x does not belong: it is written ${only.san}.`, [only.san])
    }
    return notation('decoration', `The move is there; it is written ${only.san}.`, [only.san])
  }

  // Nothing of that kind reaches that square. This is a chess answer, and it says which.
  const mine = boardSquares(fen).filter((s) => s.type === piece && s.color === mover)
  if (mine.length === 0) {
    return chessFault('nothing-of-that-kind', `You have no ${PIECE_NAME[piece]} on the board.`)
  }
  const target = boardSquares(fen).find((s) => s.square === to)
  if (target && target.color === mover) {
    return chessFault('square-taken', `Your own ${PIECE_NAME[target.type]} is on ${to}.`)
  }
  if (inCheck) {
    return chessFault('in-check', `You are in check. Only a move that answers the check is legal, and no ${PIECE_NAME[piece]} move to ${to} does.`)
  }
  const stuck = mine.find((s) => destinationsFrom(fen, s.square).length === 0)
  if (stuck) {
    return chessFault('piece-cannot-move', `The ${PIECE_NAME[piece]} on ${stuck.square} has no legal move at all in this position.`)
  }
  const reachable = [...new Set(byDestination.length ? byDestination.map((m) => m.to) : legal.filter((m) => m.piece === piece).map((m) => m.to))].sort()
  return chessFault(
    'no-such-move',
    `No ${PIECE_NAME[piece]} can go to ${to} in this position.${reachable.length ? ` ${PIECE_NAME[piece][0].toUpperCase()}${PIECE_NAME[piece].slice(1)} moves available: ${reachable.join(', ')}.` : ''}`
  )
}

// ---------------------------------------------------------------- reading a whole line

export interface LineStop {
  /** Which entry failed, counting from zero. */
  at: number
  wrote: string
  /** The position it was read against. */
  fen: string
  fault: 'notation' | 'chess'
  code: NotationFault | ChessFault
  says: string
  suggest: readonly string[]
}

export interface LineEntry {
  startFen: string
  /** What was typed, as typed. */
  wrote: readonly string[]
  /** The moves that could be played, in order. */
  moves: readonly ChessMove[]
  /** The position after each move. */
  fens: readonly string[]
  /** Where it stopped, or null when the whole line was played. */
  stopped: LineStop | null
  /** True when every entry was read and played. */
  ok: boolean
  /** Entries that were playable but written another way, so the gym can show how they are written. */
  tidied: readonly { at: number; wrote: string; properly: string }[]
}

/**
 * A whole line, read move by move against the position reached.
 *
 * Both sides' moves, in order, the way a line is written out. Nothing after the first entry that cannot be played is
 * read, because every position after that one is imaginary.
 */
export function enterLine(startFen: string, texts: readonly string[]): LineEntry {
  const moves: ChessMove[] = []
  const fens: string[] = []
  const tidied: { at: number; wrote: string; properly: string }[] = []
  let fen = startFen

  for (const [at, text] of texts.entries()) {
    const read = readMove(fen, text)
    if (!read.ok) {
      return {
        startFen,
        wrote: [...texts],
        moves,
        fens,
        ok: false,
        tidied,
        stopped: {
          at,
          wrote: (text ?? '').trim(),
          fen,
          fault: read.fault,
          code: read.code,
          says: read.says,
          suggest: read.suggest ?? []
        }
      }
    }
    if (read.tidied) tidied.push({ at, wrote: read.wrote, properly: read.tidied })
    moves.push(read.move)
    fen = read.move.after
    fens.push(fen)
  }

  return { startFen, wrote: [...texts], moves, fens, ok: true, stopped: null, tidied }
}

/** One written line, split the way people write them: "1.Nf7+ Kg8 2.Nxd8" becomes the four moves. */
export function splitLine(text: string): string[] {
  return (text ?? '')
    .replace(/\{[^}]*\}/g, ' ')
    .split(/\s+/)
    .map((piece) => piece.replace(/^\d+\.(\.\.)?/, '').trim())
    .filter((piece) => piece.length > 0 && !/^(\d+|\.+|1-0|0-1|1\/2-1\/2|\*)$/.test(piece))
}

// ---------------------------------------------------------------- comparing with the answers

export interface Divergence {
  /** The ply, counting from zero. */
  at: number
  /** Whose move it was. */
  by: 'solver' | 'opponent'
  wrote: string
  played: string
  /** What the recorded lines accept at that point. */
  accepted: readonly string[]
  says: string
}

export interface Comparison {
  verdict:
    /** The line is one of the answers, all the way to the end. */
    | 'solves'
    /** Right as far as it goes, and it stops early. Not wrong. */
    | 'short'
    /** It left the recorded answers. */
    | 'diverges'
    /** It could not be played or could not be read; nothing was compared. */
    | 'unplayable'
  /** How many plies matched the recorded answers before anything went wrong. */
  matched: number
  /** How long the shortest recorded answer is, in plies, for "you are two moves from the end". */
  shortestAnswer: number
  entry: LineEntry
  divergence: Divergence | null
  says: string
}

function shortestAnswerPlies(exercise: Exercise): number {
  const depth = (nodes: readonly { move: string; children?: readonly unknown[] }[]): number => {
    let best = Infinity
    for (const node of nodes) {
      const kids = (node.children ?? []) as readonly { move: string; children?: readonly unknown[] }[]
      best = Math.min(best, kids.length === 0 ? 1 : 1 + depth(kids))
    }
    return best === Infinity ? 0 : best
  }
  return depth(exercise.solution.lines)
}

/**
 * A submitted line against the exercise's answers.
 *
 * Reading comes first and is kept separate: a line that cannot be played is `unplayable`, and the entry says whether
 * that was the writing or the chess. Only a line that can be played is compared, and the comparison reports the
 * first place the two parted company rather than a score.
 */
export function compareLine(exercise: Exercise, texts: readonly string[]): Comparison {
  const entry = enterLine(exercise.startFen, texts)
  const shortest = shortestAnswerPlies(exercise)
  if (!entry.ok) {
    return {
      verdict: 'unplayable',
      matched: 0,
      shortestAnswer: shortest,
      entry,
      divergence: null,
      says: entry.stopped
        ? entry.stopped.fault === 'notation'
          ? `Move ${entry.stopped.at + 1} could not be read: ${entry.stopped.says}`
          : `Move ${entry.stopped.at + 1} cannot be played: ${entry.stopped.says}`
        : 'The line could not be read.'
    }
  }

  const walk = follow(exercise, entry.moves.map((m) => m.uci))
  if (walk.divergedAt !== null) {
    const at = walk.divergedAt
    const acceptedHere = acceptedSan(exercise, entry.moves.slice(0, at).map((m) => m.uci))
    return {
      verdict: 'diverges',
      matched: at,
      shortestAnswer: shortest,
      entry,
      divergence: {
        at,
        by: at % 2 === 0 ? 'solver' : 'opponent',
        wrote: entry.wrote[at] ?? entry.moves[at].san,
        played: entry.moves[at].san,
        accepted: acceptedHere,
        says: at % 2 === 0
          ? `The first ${at} ${at === 1 ? 'ply' : 'plies'} match. At ply ${at + 1} you wrote ${entry.moves[at].san}; the answer plays ${acceptedHere.join(' or ') || 'something else'}.`
          : `At ply ${at + 1} you gave the opponent ${entry.moves[at].san}. The exercise answers ${acceptedHere.join(' or ') || 'other defences'}, so the rest of your line is against a defence it does not cover.`
      },
      says: `The first ${at} ${at === 1 ? 'ply' : 'plies'} match, and then the lines part.`
    }
  }

  if (walk.lineComplete) {
    return {
      verdict: 'solves',
      matched: entry.moves.length,
      shortestAnswer: shortest,
      entry,
      divergence: null,
      says: 'The whole line is right.'
    }
  }
  return {
    verdict: 'short',
    matched: entry.moves.length,
    shortestAnswer: shortest,
    entry,
    divergence: null,
    says: entry.moves.length === 0
      ? 'Nothing was entered.'
      : `Right as far as it goes, and it stops ${Math.max(1, shortest - entry.moves.length)} ${shortest - entry.moves.length === 1 ? 'ply' : 'plies'} early.`
  }
}

function acceptedSan(exercise: Exercise, played: readonly string[]): string[] {
  const walk = follow(exercise, played)
  if (walk.illegalAt !== null || walk.divergedAt !== null) return []
  const out: string[] = []
  for (const node of walk.accepted) {
    const made = applyMove(walk.fen, node.move)
    if (made) out.push(made.san)
  }
  return out
}

/**
 * The solver's own moves with the opponent's replies filled in from the exercise.
 *
 * For the way the Gym is usually used: somebody types only their own moves. The replies come out of the exercise's
 * recorded defences, deterministically, so the line that is checked is a real line and not a guess at one. It stops
 * as soon as a solver move is not one of the answers, because after that there is no recorded defence to supply.
 */
export function interleave(exercise: Exercise, solverTexts: readonly string[], pick = 0): { line: string[]; stoppedAt: number | null } {
  const line: string[] = []
  let played: string[] = []
  for (const [index, text] of solverTexts.entries()) {
    const walk = follow(exercise, played)
    if (walk.turn !== 'solver' || walk.divergedAt !== null || walk.illegalAt !== null) return { line, stoppedAt: index }
    const made = applyMove(walk.fen, text)
    if (!made) return { line, stoppedAt: index }
    line.push(made.san)
    played = [...played, made.uci]
    const after = follow(exercise, played)
    if (after.divergedAt !== null) return { line, stoppedAt: null }
    if (after.accepted.length === 0) return { line, stoppedAt: null }
    if (after.turn !== 'opponent') continue
    const choices = after.accepted
    const chosen = choices[((Math.trunc(pick) % choices.length) + choices.length) % choices.length]
    const reply = applyMove(after.fen, chosen.move)
    if (!reply) return { line, stoppedAt: null }
    line.push(reply.san)
    played = [...played, reply.uci]
  }
  return { line, stoppedAt: null }
}
