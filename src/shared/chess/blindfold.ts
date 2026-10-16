import type { Side } from './evaluation.ts'
import { applyMove, boardSquares, checkFen, positionKey, sideToMove as turnOf, type PieceLetter } from './rules.ts'

/**
 * Holding a board in your head (Sections 221-224).
 *
 * Three things, and they are deliberately separate:
 *
 *   1. **Questions about a position**, every one with an answer read out of the position itself. Nothing is asked
 *      that Orbis cannot mark, because a blindfold trainer that marks a guess against another guess is worse than
 *      no trainer: it tells people their memory is wrong when the question was.
 *   2. **Following the pieces through a line**, which is what blindfold play actually is. This is where the traps
 *      are, and they are all here: en passant takes a pawn that is not on the square the capturing pawn lands on,
 *      castling moves two pieces, and a promoted pawn is a queen now and was a pawn -- it is the same piece, with
 *      the same identity, and a tracker that forgets that cannot answer "where is the pawn that started on h2".
 *   3. **Marking a remembered board** against the real one, with the partial-credit rule written down rather than
 *      buried in an average.
 *
 * Pure: the questions are drawn with a seed the caller supplies, so the same seed gives the same questions and a
 * failing case can be reproduced. No clock, no storage.
 */

// ---------------------------------------------------------------- the board, said in words

const PIECE_NAME: Readonly<Record<PieceLetter, string>> = Object.freeze({
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king'
})

const SIDE_NAME: Readonly<Record<Side, string>> = Object.freeze({ w: 'White', b: 'Black' })

export const FILES: readonly string[] = Object.freeze(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])

/** Every square, a1 to h8. */
export function allSquares(): string[] {
  const out: string[] = []
  for (const file of FILES) for (let rank = 1; rank <= 8; rank += 1) out.push(`${file}${rank}`)
  return out
}

export function isSquare(square: string): boolean {
  return /^[a-h][1-8]$/.test(square)
}

/** Light or dark. a1 is dark, and everything else follows from that. */
export function squareColour(square: string): 'light' | 'dark' | null {
  if (!isSquare(square)) return null
  const file = square.charCodeAt(0) - 97
  const rank = Number(square[1])
  return (file + rank) % 2 === 0 ? 'light' : 'dark'
}

// ---------------------------------------------------------------- questions

export type BlindQuestionKind = 'piece-on-square' | 'square-colour' | 'count' | 'where-is' | 'side-to-move'

export type BlindAnswer =
  /** Both null means the square is empty, which is a real answer and a common one. */
  | { kind: 'piece'; side: Side | null; piece: PieceLetter | null }
  | { kind: 'colour'; colour: 'light' | 'dark' }
  | { kind: 'count'; value: number }
  | { kind: 'squares'; squares: readonly string[] }
  | { kind: 'side'; side: Side }

export interface BlindQuestion {
  id: string
  kind: BlindQuestionKind
  /** What is asked, in words. */
  ask: string
  /** Read out of the position. There is no way to build a question without one. */
  answer: BlindAnswer
  /** The position the answer was read from, so a question can always be checked again. */
  fen: string
}

export function sayAnswer(answer: BlindAnswer): string {
  if (answer.kind === 'piece') {
    return answer.piece === null || answer.side === null ? 'nothing' : `${SIDE_NAME[answer.side]}'s ${PIECE_NAME[answer.piece]}`
  }
  if (answer.kind === 'colour') return answer.colour
  if (answer.kind === 'count') return String(answer.value)
  if (answer.kind === 'side') return SIDE_NAME[answer.side]
  return answer.squares.length ? answer.squares.join(', ') : 'nowhere -- there are none left'
}

// A small, named generator. Deterministic from the seed, so the same sitting can be reproduced exactly.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface QuestionOptions {
  count?: number
  seed?: number
  kinds?: readonly BlindQuestionKind[]
}

/**
 * Questions about one position, each with its answer already worked out.
 *
 * Drawn without repeats where the position allows it. A position with four pieces cannot supply twenty different
 * "where is" questions, and the list comes back shorter rather than padded with repeats.
 */
export function questionsFor(fen: string, options: QuestionOptions = {}): BlindQuestion[] {
  if (!checkFen(fen).ok) return []
  const want = Math.max(1, Math.min(60, Math.trunc(options.count ?? 6)))
  const random = mulberry32(options.seed ?? 1)
  const kinds = options.kinds?.length ? options.kinds : (['piece-on-square', 'square-colour', 'count', 'where-is', 'side-to-move'] as const)
  const pieces = boardSquares(fen)
  const occupied = pieces.map((p) => p.square)
  const empties = allSquares().filter((square) => !occupied.includes(square))

  const pool: BlindQuestion[] = []
  let serial = 0
  const add = (q: Omit<BlindQuestion, 'id' | 'fen'>): void => {
    serial += 1
    pool.push({ ...q, id: `q${serial}`, fen })
  }

  if (kinds.includes('piece-on-square')) {
    for (const piece of pieces) {
      add({
        kind: 'piece-on-square',
        ask: `What is on ${piece.square}?`,
        answer: { kind: 'piece', side: piece.color, piece: piece.type }
      })
    }
    for (const square of empties) {
      add({ kind: 'piece-on-square', ask: `What is on ${square}?`, answer: { kind: 'piece', side: null, piece: null } })
    }
  }
  if (kinds.includes('square-colour')) {
    for (const square of allSquares()) {
      const colour = squareColour(square)
      if (colour) add({ kind: 'square-colour', ask: `Is ${square} a light square or a dark one?`, answer: { kind: 'colour', colour } })
    }
  }
  if (kinds.includes('count')) {
    for (const side of ['w', 'b'] as const) {
      add({
        kind: 'count',
        ask: `How many pieces does ${SIDE_NAME[side]} have, counting the king?`,
        answer: { kind: 'count', value: pieces.filter((p) => p.color === side).length }
      })
      for (const type of ['p', 'n', 'b', 'r', 'q'] as const) {
        const held = pieces.filter((p) => p.color === side && p.type === type).length
        if (held === 0) continue
        add({
          kind: 'count',
          ask: `How many ${PIECE_NAME[type]}s does ${SIDE_NAME[side]} have?`,
          answer: { kind: 'count', value: held }
        })
      }
    }
  }
  if (kinds.includes('where-is')) {
    for (const side of ['w', 'b'] as const) {
      for (const type of ['k', 'q', 'r', 'b', 'n', 'p'] as const) {
        const squares = pieces.filter((p) => p.color === side && p.type === type).map((p) => p.square).sort()
        if (squares.length === 0) continue
        add({
          kind: 'where-is',
          ask: squares.length === 1 ? `Where is ${SIDE_NAME[side]}'s ${PIECE_NAME[type]}?` : `Where are ${SIDE_NAME[side]}'s ${PIECE_NAME[type]}s? Name all ${squares.length}.`,
          answer: { kind: 'squares', squares }
        })
      }
    }
  }
  if (kinds.includes('side-to-move')) {
    add({ kind: 'side-to-move', ask: 'Whose move is it?', answer: { kind: 'side', side: turnOf(fen) } })
  }

  // Draw without repeats, in a stable order for a given seed.
  const chosen: BlindQuestion[] = []
  const left = [...pool]
  while (chosen.length < want && left.length > 0) {
    const index = Math.floor(random() * left.length) % left.length
    chosen.push(left[index])
    left.splice(index, 1)
  }
  return chosen.map((q, i) => ({ ...q, id: `q${i + 1}` }))
}

// ---------------------------------------------------------------- marking an answer

const PIECE_WORDS: Readonly<Record<string, PieceLetter>> = Object.freeze({
  p: 'p', pawn: 'p', n: 'n', knight: 'n', b: 'b', bishop: 'b', r: 'r', rook: 'r', castle: 'r',
  q: 'q', queen: 'q', k: 'k', king: 'k'
})

const EMPTY_WORDS: readonly string[] = Object.freeze(['empty', 'nothing', 'none', 'no piece', 'nil', '-'])

export interface Marked {
  right: boolean
  /** What the answer was, in words, whether or not they got it. */
  answer: string
  says: string
}

/**
 * Marking one answer.
 *
 * Generous about wording and strict about facts: "white knight", "N", "wn" and "Knight (white)" are the same answer,
 * and "knight" on its own is not -- a square holds one side's knight, and which side is the whole question.
 */
export function markAnswer(question: BlindQuestion, given: string): Marked {
  const text = (given ?? '').trim().toLowerCase()
  const answer = sayAnswer(question.answer)
  const no = (says: string): Marked => ({ right: false, answer, says })
  const yes = (says: string): Marked => ({ right: true, answer, says })
  if (!text) return no('Nothing was answered.')

  if (question.answer.kind === 'piece') {
    const expected = question.answer
    if (expected.piece === null) {
      return EMPTY_WORDS.some((word) => text === word || text.startsWith(word))
        ? yes('Empty, yes.')
        : no(`That square is empty.`)
    }
    // Words first, because that is how people write it. Then the short forms, where the capital letter is the side,
    // which is how a board is written down.
    let side: Side | null = /\bwhite\b/.test(text) ? 'w' : /\bblack\b/.test(text) ? 'b' : null
    let type: PieceLetter | null = null
    for (const word of text.replace(/[^a-z]/g, ' ').split(/\s+/).filter(Boolean)) {
      const found = PIECE_WORDS[word] ?? (word.length > 1 && word.endsWith('s') ? PIECE_WORDS[word.slice(0, -1)] : undefined)
      if (found) { type = found; break }
    }
    const compact = (given ?? '').trim().replace(/[^a-zA-Z]/g, '')
    if (/^[PNBRQK]$/.test(compact)) {
      side = side ?? 'w'
      type = type ?? PIECE_WORDS[compact.toLowerCase()]
    } else if (/^[pnbrqk]$/.test(compact)) {
      side = side ?? 'b'
      type = type ?? PIECE_WORDS[compact]
    } else if (/^[wbWB][pnbrqkPNBRQK]$/.test(compact)) {
      side = side ?? (compact[0].toLowerCase() === 'w' ? 'w' : 'b')
      type = type ?? PIECE_WORDS[compact[1].toLowerCase()]
    }
    if (!type) return no(`It is ${answer}.`)
    if (side === null) return no(`Which side? It is ${answer}.`)
    return side === expected.side && type === expected.piece ? yes(`${answer}, yes.`) : no(`It is ${answer}.`)
  }

  if (question.answer.kind === 'colour') {
    const said = /light|white|pale/.test(text) ? 'light' : /dark|black/.test(text) ? 'dark' : null
    if (!said) return no(`It is a ${answer} square.`)
    return said === question.answer.colour ? yes(`${answer}, yes.`) : no(`It is a ${answer} square.`)
  }

  if (question.answer.kind === 'count') {
    const number = Number.parseInt(text.replace(/[^0-9-]/g, ''), 10)
    if (!Number.isFinite(number)) return no(`It is ${answer}.`)
    return number === question.answer.value ? yes(`${answer}, yes.`) : no(`It is ${answer}.`)
  }

  if (question.answer.kind === 'side') {
    const said = /\bwhite\b|^w$/.test(text) ? 'w' : /\bblack\b|^b$/.test(text) ? 'b' : null
    if (!said) return no(`It is ${answer} to move.`)
    return said === question.answer.side ? yes(`${answer}, yes.`) : no(`It is ${answer} to move.`)
  }

  const said = [...new Set((text.match(/[a-h][1-8]/g) ?? []))].sort()
  const expected = [...question.answer.squares].sort()
  if (said.length === 0) return no(`${answer}.`)
  const same = said.length === expected.length && said.every((square, i) => square === expected[i])
  if (same) return yes(`${answer}, yes.`)
  const missing = expected.filter((square) => !said.includes(square))
  const extra = said.filter((square) => !expected.includes(square))
  return no(
    `${answer}.${missing.length ? ` Missed: ${missing.join(', ')}.` : ''}${extra.length ? ` Not there: ${extra.join(', ')}.` : ''}`
  )
}

// ---------------------------------------------------------------- following the pieces

export interface TrackedPiece {
  /** Stable for the whole line. A promoted pawn keeps its id, because it is the same piece. */
  id: string
  side: Side
  /** What it is now. */
  type: PieceLetter
  /** What it was when the line started. */
  startedAs: PieceLetter
  /** Where it is, or null once it has been taken. */
  square: string | null
  /** Every square it has stood on, starting with the first. */
  path: readonly string[]
  /** The ply it was taken on, counting from 1. */
  takenAtPly: number | null
  /** The id of the piece that took it. */
  takenBy: string | null
  /** The ply it was promoted on. */
  promotedAtPly: number | null
}

export interface Tracking {
  pieces: readonly TrackedPiece[]
  /** The position after each move. */
  fens: readonly string[]
  /** The moves, written out properly for the position each was played in. */
  san: readonly string[]
  /** The index of the first move that could not be played, or null. */
  stoppedAt: number | null
  ok: boolean
}

const ROOK_CASTLE: Readonly<Record<string, { from: string; to: string }>> = Object.freeze({
  'w-k': { from: 'h1', to: 'f1' },
  'w-q': { from: 'a1', to: 'd1' },
  'b-k': { from: 'h8', to: 'f8' },
  'b-q': { from: 'a8', to: 'd8' }
})

/**
 * Where every piece is after a line, and how it got there.
 *
 * The three things that make a naive tracker wrong, all handled here:
 *
 *   - **En passant.** The pawn that is taken is not on the square the capturing pawn lands on. It is on the landing
 *     file, on the rank the capturing pawn came from. A tracker that clears the destination square leaves a ghost
 *     pawn on the board and every answer after that is wrong.
 *   - **Castling.** Two pieces move. The rook's squares are fixed by which castling it was, not guessed from the
 *     king's.
 *   - **Promotion.** The piece is the same piece. Its type changes and its identity does not, so "the pawn that
 *     started on a2" can still be followed after it has become a queen.
 */
export function trackPieces(startFen: string, moves: readonly string[]): Tracking {
  if (!checkFen(startFen).ok) return { pieces: [], fens: [], san: [], stoppedAt: 0, ok: false }

  const counters = new Map<string, number>()
  const byId = new Map<string, TrackedPiece>()
  const atSquare = new Map<string, string>()
  for (const piece of boardSquares(startFen)) {
    const key = `${piece.color}-${piece.type}`
    const n = (counters.get(key) ?? 0) + 1
    counters.set(key, n)
    const id = `${key}-${n}`
    byId.set(id, {
      id,
      side: piece.color,
      type: piece.type,
      startedAs: piece.type,
      square: piece.square,
      path: [piece.square],
      takenAtPly: null,
      takenBy: null,
      promotedAtPly: null
    })
    atSquare.set(piece.square, id)
  }

  const fens: string[] = []
  const san: string[] = []
  let fen = startFen

  const take = (square: string, ply: number, byPiece: string | null): void => {
    const id = atSquare.get(square)
    if (!id) return
    const held = byId.get(id)
    if (!held) return
    byId.set(id, { ...held, square: null, takenAtPly: ply, takenBy: byPiece })
    atSquare.delete(square)
  }

  const shift = (from: string, to: string): string | null => {
    const id = atSquare.get(from)
    if (!id) return null
    const held = byId.get(id)
    if (!held) return null
    atSquare.delete(from)
    atSquare.set(to, id)
    byId.set(id, { ...held, square: to, path: [...held.path, to] })
    return id
  }

  for (const [index, text] of moves.entries()) {
    const made = applyMove(fen, text)
    if (!made) {
      return { pieces: [...byId.values()], fens, san, stoppedAt: index, ok: false }
    }
    const ply = index + 1
    const mover = atSquare.get(made.from) ?? null

    if (made.special === 'e') {
      // The pawn taken en passant stands on the landing file, on the rank the capturing pawn started from.
      take(`${made.to[0]}${made.from[1]}`, ply, mover)
    } else if (made.captured) {
      take(made.to, ply, mover)
    }

    shift(made.from, made.to)

    if (made.special === 'k' || made.special === 'q') {
      const rook = ROOK_CASTLE[`${made.color}-${made.special}`]
      if (rook) shift(rook.from, rook.to)
    }

    if (made.promotion) {
      const id = atSquare.get(made.to)
      const held = id ? byId.get(id) : undefined
      if (id && held) byId.set(id, { ...held, type: made.promotion, promotedAtPly: ply })
    }

    fen = made.after
    fens.push(fen)
    san.push(made.san)
  }

  return { pieces: [...byId.values()], fens, san, stoppedAt: null, ok: true }
}

/** Where one piece ended up, by the square it started on. Null when nothing started there. */
export function pieceFrom(tracking: Tracking, startSquare: string): TrackedPiece | null {
  return tracking.pieces.find((piece) => piece.path[0] === startSquare) ?? null
}

/** The board as the tracker has it, for comparing with a position. */
export function placementsOf(tracking: Tracking): { square: string; side: Side; type: PieceLetter }[] {
  return tracking.pieces
    .filter((piece): piece is TrackedPiece & { square: string } => piece.square !== null)
    .map((piece) => ({ square: piece.square, side: piece.side, type: piece.type }))
    .sort((a, b) => a.square.localeCompare(b.square))
}

/**
 * Whether the tracker and the rules agree about the final position.
 *
 * A self-check worth having: the tracker follows identities and the rules follow the board, and if the two disagree
 * the tracker is wrong. Used in the tests on every line, and available to anything that wants to be sure.
 */
export function trackingAgrees(tracking: Tracking): boolean {
  const lastFen = tracking.fens[tracking.fens.length - 1]
  if (!lastFen) return tracking.ok
  const fromRules = boardSquares(lastFen)
    .map((s) => `${s.square}${s.color}${s.type}`)
    .sort()
    .join(' ')
  const fromTracker = placementsOf(tracking)
    .map((s) => `${s.square}${s.side}${s.type}`)
    .sort()
    .join(' ')
  return fromRules === fromTracker
}

// ---------------------------------------------------------------- marking a remembered board

export interface Placement {
  square: string
  side: Side
  type: PieceLetter
}

export interface SquareVerdict {
  square: string
  /** What is really there, in words, or null for an empty square. */
  expected: string | null
  given: string | null
  verdict: 'right' | 'nearly' | 'missed' | 'invented'
}

export interface RecallScore {
  /** True only when the remembered board is the real one, piece for piece. */
  exact: boolean
  /** Right side, right piece, right square. */
  right: number
  /** Right side and square, wrong piece. Half credit, and said separately. */
  nearly: number
  /** A piece on a square that is really empty. */
  invented: number
  /** A piece that is really there and was not mentioned. */
  missed: number
  /** How many pieces are really on the board. */
  outOf: number
  /** 0..1, by the rule below. */
  score: number
  /** The rule, in words. The number is never shown without it. */
  rule: string
  squares: readonly SquareVerdict[]
  says: string
}

export interface RecallRules {
  /** What a right-side, wrong-piece answer is worth. Half, unless the caller says otherwise. */
  nearlyCredit?: number
  /** What inventing a piece costs. Half, so a board covered in guesses does not score well. */
  inventedPenalty?: number
}

/**
 * Marking a remembered board against the real one.
 *
 * The rule, stated because a partial-credit number that does not say how it was worked out is not a measurement:
 *
 * ```
 * score = (right + nearly x nearlyCredit - invented x inventedPenalty) / pieces on the board
 * ```
 *
 * clamped to 0..1, with `nearlyCredit` and `inventedPenalty` both a half by default. Inventing pieces costs,
 * because without that the best strategy is to name a piece on every square -- and a scoring rule that rewards
 * guessing measures guessing.
 *
 * The four counts are also reported on their own, because they say different things: missing a piece is forgetting,
 * and putting a bishop where a knight stands is remembering the square and not the piece.
 *
 * Naming the wrong *side* on an occupied square earns nothing and counts as missed. Remembering that a square was
 * busy is not remembering the position: whose piece it is changes everything about what the position means.
 */
export function scoreRecall(referenceFen: string, given: readonly Placement[], rules: RecallRules = {}): RecallScore {
  const nearlyCredit = rules.nearlyCredit ?? 0.5
  const inventedPenalty = rules.inventedPenalty ?? 0.5
  const real = new Map<string, Placement>()
  for (const piece of boardSquares(referenceFen)) real.set(piece.square, { square: piece.square, side: piece.color, type: piece.type })
  const said = new Map<string, Placement>()
  for (const piece of given) if (isSquare(piece.square)) said.set(piece.square, piece)

  const squares: SquareVerdict[] = []
  let right = 0
  let nearly = 0
  let missed = 0
  let invented = 0

  const describe = (piece: Placement): string => `${SIDE_NAME[piece.side]}'s ${PIECE_NAME[piece.type]}`

  for (const square of allSquares()) {
    const there = real.get(square)
    const claimed = said.get(square)
    if (!there && !claimed) continue
    if (there && claimed) {
      if (there.side === claimed.side && there.type === claimed.type) {
        right += 1
        squares.push({ square, expected: describe(there), given: describe(claimed), verdict: 'right' })
      } else if (there.side === claimed.side) {
        nearly += 1
        squares.push({ square, expected: describe(there), given: describe(claimed), verdict: 'nearly' })
      } else {
        missed += 1
        squares.push({ square, expected: describe(there), given: describe(claimed), verdict: 'missed' })
      }
      continue
    }
    if (there) {
      missed += 1
      squares.push({ square, expected: describe(there), given: null, verdict: 'missed' })
      continue
    }
    invented += 1
    squares.push({ square, expected: null, given: claimed ? describe(claimed) : null, verdict: 'invented' })
  }

  const outOf = real.size
  const raw = outOf === 0 ? 0 : (right + nearly * nearlyCredit - invented * inventedPenalty) / outOf
  const score = Math.max(0, Math.min(1, raw))
  const exact = right === outOf && nearly === 0 && invented === 0 && missed === 0

  return {
    exact,
    right,
    nearly,
    invented,
    missed,
    outOf,
    score,
    rule: `(right + ${nearlyCredit} x right square wrong piece - ${inventedPenalty} x pieces that are not there) / ${outOf} pieces, kept between 0 and 1.`,
    squares,
    says: exact
      ? `The whole board, all ${outOf} pieces.`
      : `${right} of ${outOf} exactly${nearly ? `, ${nearly} on the right square as the wrong piece` : ''}${missed ? `, ${missed} missed` : ''}${invented ? `, ${invented} that are not there` : ''}.`
  }
}

/** The same, when the remembered board arrives as a position rather than a list. */
export function scoreRecallFen(referenceFen: string, givenFen: string, rules?: RecallRules): RecallScore | null {
  if (!checkFen(givenFen).ok) return null
  const placements = boardSquares(givenFen).map((s) => ({ square: s.square, side: s.color, type: s.type }))
  return scoreRecall(referenceFen, placements, rules)
}

/** Whether two positions are the same position, ignoring the clocks. */
export function samePosition(a: string, b: string): boolean {
  return checkFen(a).ok && checkFen(b).ok && positionKey(a) === positionKey(b)
}
