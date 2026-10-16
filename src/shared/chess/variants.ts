import {
  START_FEN, buildFen, checkFen, legalMoves, outcome,
  type BoardSquare, type FenCheck, type Outcome, type PieceLetter
} from './rules.ts'
import type { Side } from './evaluation.ts'

/**
 * What Orbis accepts as chess: which game, and which position.
 *
 * Two refusals live here, and they are the same kind of refusal, which is why they share a file.
 *
 *   - **Which game.** A file can say `[Variant "Chess960"]`. Orbis has one set of rules, in `rules.ts`, and they are
 *     the rules of ordinary chess. So a Chess960 game is not something Orbis can play, analyse, read or write, and the
 *     one thing it must never do is read it as ordinary chess anyway: the moves would be legal-looking nonsense and the
 *     castling would be wrong, silently, in a game somebody kept. The registry below says what Orbis can really do
 *     with each variant, and the answer for every one of them except standard chess is "nothing".
 *
 *   - **Which position.** The position editor lets a person put any piece on any square, which means it can build
 *     things that are not chess positions at all. Those are told apart here from positions that are perfectly legal
 *     but could not have arisen from a game, because the two deserve opposite answers: the first is refused, and the
 *     second is accepted without argument. Composed positions -- a study, a puzzle, an endgame to practise -- are
 *     unreachable almost by definition, and an editor that refused them would be useless.
 *
 * Nothing here guesses. The side to move, the castling rights and the en passant square are whatever the person set;
 * this module says when what they set contradicts itself, and never quietly writes something else.
 *
 * Nothing here is a second set of rules either. Whether a king stands in check is asked of `rules.ts`, by handing it
 * the position with the other side to move. What is computed here is arithmetic about men and squares, which is not a
 * matter of opinion.
 */

// ---------------------------------------------------------------------------------------------------------------
// Which game: the variant registry
// ---------------------------------------------------------------------------------------------------------------

export type VariantAction = 'play' | 'analyse' | 'import' | 'export'

/** What Orbis can really do with a variant. Four plain yes-or-no answers, no "partial". */
export interface VariantSupport {
  /** Make moves, enforce the rules, finish a game. */
  play: boolean
  /** Ask the engine about a position. */
  analyse: boolean
  /** Read a game of this kind from a file and replay its moves. */
  import: boolean
  /** Write a game of this kind back out as a file. */
  export: boolean
}

export interface VariantRecord {
  id: string
  /** What a person calls it. */
  name: string
  /**
   * The spellings that mean this variant, as they turn up in a PGN `Variant` tag. Matched after normalising, so
   * "Three-check", "three check" and "THREECHECK" all reach the same record without three entries.
   */
  aliases: readonly string[]
  support: VariantSupport
  /** What makes it a different game, so a refusal can say what the difference is rather than just "no". */
  differs: string
}

const FULL: VariantSupport = { play: true, analyse: true, import: true, export: true }
const NONE: VariantSupport = { play: false, analyse: false, import: false, export: false }

/**
 * Every variant Orbis has a name for.
 *
 * The list being short of some obscure variant costs nothing: a `Variant` tag Orbis has never heard of is refused as
 * well, because an unrecognised name is not evidence of ordinary chess. What the list buys is a refusal that can say
 * *what* the game is and why it is different, instead of "unknown variant".
 *
 * Variants that are plainly the same idea under different names are still listed separately where the rules really do
 * differ between the places that use the name -- Antichess, Giveaway, Suicide and Loser's chess disagree about
 * stalemate and about whether the king is an ordinary piece. Saying they are one game would be a claim Orbis cannot
 * back, and since all four are refused anyway there is nothing to gain by it.
 */
export const VARIANTS: readonly VariantRecord[] = Object.freeze([
  {
    id: 'standard',
    name: 'Standard chess',
    // "From Position" is what several programs write when a game starts from a set-up position. It is still ordinary
    // chess -- the position is in the FEN tag -- so it must not be refused as a variant.
    aliases: ['standard', 'chess', 'normal', 'classical', 'standard chess', 'from position', 'fromposition'],
    support: FULL,
    differs: ''
  },
  {
    id: 'chess960',
    name: 'Chess960',
    aliases: ['chess960', 'chess 960', '960', 'fischerandom', 'fischer random', 'fischerandomchess', 'fischer random chess'],
    support: NONE,
    differs: 'The back row is shuffled into one of 960 arrangements, and castling is recorded by the rook’s file rather than by the king’s two squares.'
  },
  {
    id: 'crazyhouse',
    name: 'Crazyhouse',
    aliases: ['crazyhouse', 'crazy house', 'zh'],
    support: NONE,
    differs: 'A piece you capture joins your own army and can be dropped back onto the board, so there are moves that put a piece on the board from nowhere.'
  },
  {
    id: 'bughouse',
    name: 'Bughouse',
    aliases: ['bughouse', 'bug house'],
    support: NONE,
    differs: 'Two boards and four players, with captured pieces passed to a partner. One board is not the whole game.'
  },
  {
    id: 'three-check',
    name: 'Three-check',
    aliases: ['three-check', 'three check', 'threecheck', '3check', '3 check'],
    support: NONE,
    differs: 'Giving check three times wins, so a game can end with both kings perfectly safe and no mate on the board.'
  },
  {
    id: 'five-check',
    name: 'Five-check',
    aliases: ['five-check', 'five check', 'fivecheck', '5check', '5 check'],
    support: NONE,
    differs: 'Giving check five times wins, which is a result ordinary chess has no way to record.'
  },
  {
    id: 'king-of-the-hill',
    name: 'King of the Hill',
    aliases: ['king of the hill', 'kingofthehill', 'koth'],
    support: NONE,
    differs: 'Walking your king to one of the four middle squares wins immediately.'
  },
  {
    id: 'racing-kings',
    name: 'Racing Kings',
    aliases: ['racing kings', 'racingkings'],
    support: NONE,
    differs: 'Both kings race to the eighth row and no move may give check, so the position never starts from the ordinary one.'
  },
  {
    id: 'horde',
    name: 'Horde',
    aliases: ['horde'],
    support: NONE,
    differs: 'White is a wall of pawns with no king at all, which is not a position ordinary chess allows to exist.'
  },
  {
    id: 'atomic',
    name: 'Atomic',
    aliases: ['atomic'],
    support: NONE,
    differs: 'A capture blows up the squares around it, so one move can take pieces that were never captured.'
  },
  {
    id: 'antichess',
    name: 'Antichess',
    aliases: ['antichess', 'anti chess', 'anti-chess'],
    support: NONE,
    differs: 'Capturing is compulsory and losing all your pieces wins, so almost every move Orbis would offer is the wrong one.'
  },
  {
    id: 'giveaway',
    name: 'Giveaway',
    aliases: ['giveaway', 'give away'],
    support: NONE,
    differs: 'Losing all your pieces wins and the king is an ordinary piece that can be taken.'
  },
  {
    id: 'suicide',
    name: 'Suicide chess',
    aliases: ['suicide', 'suicide chess'],
    support: NONE,
    differs: 'Losing all your pieces wins. It is listed apart from Antichess because the two disagree about what a stalemate means.'
  },
  {
    id: 'losers',
    name: 'Loser’s chess',
    aliases: ['losers', 'loser’s chess', "loser's chess", 'losers chess'],
    support: NONE,
    differs: 'Losing all your pieces wins, but the king stays a king and check still applies.'
  },
  {
    id: 'no-castling',
    name: 'No-castling chess',
    aliases: ['no castling', 'nocastling', 'no-castling chess'],
    support: NONE,
    differs: 'Ordinary chess with castling taken away. Orbis has one set of rules and they allow castling, so a game played here would quietly stop being this variant.'
  },
  {
    id: 'seirawan',
    name: 'Seirawan chess',
    aliases: ['seirawan', 'seirawan chess', 's-chess', 'schess', 'sharper chess'],
    support: NONE,
    differs: 'Two extra pieces, the hawk and the elephant, enter from off the board.'
  },
  {
    id: 'capablanca',
    name: 'Capablanca chess',
    aliases: ['capablanca', 'capablanca chess', 'capablanca random'],
    support: NONE,
    differs: 'A ten-by-eight board with two extra pieces. Orbis draws eight squares by eight.'
  },
  {
    id: 'grand',
    name: 'Grand chess',
    aliases: ['grand', 'grand chess'],
    support: NONE,
    differs: 'A ten-by-ten board with extra pieces.'
  },
  {
    id: 'shatranj',
    name: 'Shatranj',
    aliases: ['shatranj'],
    support: NONE,
    differs: 'The old game chess grew out of: no castling, a different queen and a different bishop.'
  },
  {
    id: 'makruk',
    name: 'Makruk',
    aliases: ['makruk', 'thai chess'],
    support: NONE,
    differs: 'Thai chess: different pieces, different promotion, different starting position.'
  },
  {
    id: 'xiangqi',
    name: 'Xiangqi',
    aliases: ['xiangqi', 'chinese chess'],
    support: NONE,
    differs: 'A different game: pieces sit on the lines of a nine-by-ten board, with a river and a palace.'
  },
  {
    id: 'shogi',
    name: 'Shogi',
    aliases: ['shogi', 'japanese chess'],
    support: NONE,
    differs: 'A different game on a nine-by-nine board, where captured pieces change sides and are dropped back.'
  },
  {
    id: 'janggi',
    name: 'Janggi',
    aliases: ['janggi', 'korean chess'],
    support: NONE,
    differs: 'A different game on a nine-by-ten board.'
  },
  {
    id: 'duck',
    name: 'Duck chess',
    aliases: ['duck', 'duck chess'],
    support: NONE,
    differs: 'A duck sits on a square nothing may pass through, and it is moved after every move.'
  },
  {
    id: 'fog-of-war',
    name: 'Fog of War',
    aliases: ['fog of war', 'fogofwar', 'dark chess'],
    support: NONE,
    differs: 'You see only the squares your own pieces attack, so a position is not a thing both players can agree on.'
  }
])

/**
 * One spelling for comparing names.
 *
 * Case, spaces, hyphens and apostrophes carry no meaning in a `Variant` tag -- "Three-check" and "three check" are
 * one variant written twice -- so they are taken out before matching. Letters and digits are kept, which is why
 * "chess960" and "chess 960" meet and "chess" and "chess960" do not.
 */
export function normaliseVariant(raw: string): string {
  return (raw ?? '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '')
}

const BY_ALIAS: Map<string, VariantRecord> = (() => {
  const map = new Map<string, VariantRecord>()
  for (const record of VARIANTS) {
    map.set(normaliseVariant(record.id), record)
    for (const alias of record.aliases) map.set(normaliseVariant(alias), record)
  }
  return map
})()

export const STANDARD: VariantRecord = VARIANTS[0]

/**
 * What a `Variant` tag turns out to be.
 *
 * Three answers, and the third is the one that matters. An absent tag means ordinary chess -- PGN says so, and nearly
 * every file in the world leaves it out. A name Orbis does not recognise means Orbis does not know what game this is,
 * and that is **not** the same as ordinary chess: it is refused.
 */
export type VariantIdentity =
  | { kind: 'standard'; record: VariantRecord; tag: string | null }
  | { kind: 'variant'; record: VariantRecord; tag: string }
  | { kind: 'unknown'; tag: string }

export function identifyVariant(tag: string | null | undefined): VariantIdentity {
  const text = (tag ?? '').trim()
  // No tag at all is ordinary chess. That is PGN's own rule, not a guess.
  if (!text) return { kind: 'standard', record: STANDARD, tag: null }
  const found = BY_ALIAS.get(normaliseVariant(text))
  if (!found) return { kind: 'unknown', tag: text }
  if (found.id === 'standard') return { kind: 'standard', record: found, tag: text }
  return { kind: 'variant', record: found, tag: text }
}

/** Is this ordinary chess? The only question the rest of Orbis usually needs to ask. */
export function isStandardVariant(tag: string | null | undefined): boolean {
  return identifyVariant(tag).kind === 'standard'
}

/** What Orbis can do with this tag. A name it does not know can be done nothing with. */
export function supportFor(tag: string | null | undefined): VariantSupport {
  const identity = identifyVariant(tag)
  return identity.kind === 'unknown' ? NONE : identity.record.support
}

export function allows(tag: string | null | undefined, action: VariantAction): boolean {
  return supportFor(tag)[action] === true
}

const ACTION_WORDS: Record<VariantAction, string> = {
  play: 'play',
  analyse: 'analyse',
  import: 'read a game of',
  export: 'write out a game of'
}

/**
 * Why not, in words a person can act on -- or null when there is nothing to refuse.
 *
 * Every refusal says three things: what the game is, what is different about it, and that the game was not read as
 * ordinary chess instead. The last one is the promise: nothing is reinterpreted behind anybody's back.
 */
export function refuse(tag: string | null | undefined, action: VariantAction): string | null {
  const identity = identifyVariant(tag)
  if (identity.kind === 'standard') return null
  if (identity.kind === 'unknown') {
    return `This says it is “${identity.tag}”, which Orbis does not recognise as a kind of chess, so it cannot ${ACTION_WORDS[action]} it. It has not been read as ordinary chess, because an unfamiliar name is not evidence that the moves are ordinary.`
  }
  if (identity.record.support[action]) return null
  return `This is ${identity.record.name}, which Orbis cannot ${ACTION_WORDS[action]}. ${identity.record.differs} Orbis plays one game, ordinary chess, and this has not been read as ordinary chess instead.`
}

/** A short name for a tag, for a list or a label. Never invents a name for something unrecognised. */
export function variantLabel(tag: string | null | undefined): string {
  const identity = identifyVariant(tag)
  if (identity.kind === 'unknown') return `“${identity.tag}” (not recognised)`
  return identity.record.name
}

/** The variants Orbis can really play. One, and the test holds it to one. */
export function playableVariants(): VariantRecord[] {
  return VARIANTS.filter((one) => one.support.play)
}

/** Everything Orbis has a name for and refuses, for a screen that wants to say so plainly. */
export function refusedVariants(): VariantRecord[] {
  return VARIANTS.filter((one) => !one.support.play)
}

// ---------------------------------------------------------------------------------------------------------------
// Which position: what the editor may build, and what it must refuse
// ---------------------------------------------------------------------------------------------------------------

/**
 * A position being built by hand.
 *
 * The castling rights and the en passant square are held as the person set them and are never worked out from where
 * the pieces stand. Working them out is tempting and wrong: a rook on h1 does not mean White may castle, and a pawn
 * on e4 does not mean it just moved there. Guessing would quietly change a composed position into a different one.
 */
export interface PositionDraft {
  pieces: BoardSquare[]
  turn: Side
  /** 'KQkq', 'Kq', '-'. Always in that order, so two drafts of the same position look the same. */
  castling: string
  /** 'e3', 'e6' or '-'. */
  enPassant: string
  halfmove: number
  fullmove: number
}

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const
export const CASTLING_FLAGS = ['K', 'Q', 'k', 'q'] as const
export type CastlingFlag = (typeof CASTLING_FLAGS)[number]

export const squareName = (file: number, rank: number): string => `${FILES[file]}${rank}`
export const fileOf = (square: string): number => square.charCodeAt(0) - 97
export const rankOf = (square: string): number => Number(square[1])

const onBoard = (square: string): boolean =>
  /^[a-h][1-8]$/.test(square)

/** The order rights are written in, so 'qK' and 'Kq' are the same draft. */
function orderCastling(flags: Iterable<string>): string {
  const held = new Set([...flags])
  const text = CASTLING_FLAGS.filter((flag) => held.has(flag)).join('')
  return text === '' ? '-' : text
}

export function emptyDraft(): PositionDraft {
  return { pieces: [], turn: 'w', castling: '-', enPassant: '-', halfmove: 0, fullmove: 1 }
}

export function startDraft(): PositionDraft {
  return readFen(START_FEN).draft
}

/** The draft as a FEN, through the rules module's own builder so there is one way of writing a position. */
export function draftToFen(draft: PositionDraft): string {
  return buildFen({
    pieces: draft.pieces,
    turn: draft.turn,
    castling: draft.castling,
    enPassant: draft.enPassant,
    halfmove: draft.halfmove,
    fullmove: draft.fullmove
  }).fen
}

export interface FenReading {
  /** The board could be read. False means nothing was read and `reason` says why. */
  ok: boolean
  draft: PositionDraft
  /**
   * What reading it changed or had to fill in, said out loud.
   *
   * This exists so a FEN is never quietly altered. A FEN with four fields and no clocks is readable, but the position
   * that comes out is not character for character the one that went in, and the person is told which part was filled.
   */
  notes: string[]
  reason?: string
}

/**
 * Reading a FEN into a draft, tolerantly, because this is what a paste box has to do.
 *
 * `rules.ts` refuses a FEN that is not a legal position, which is right for everything that plays chess and wrong for
 * an editor: a person pasting a position with nine pawns wants to see the nine pawns and be told about them, not get
 * an empty board. So the board itself is read as written, and judging it is a separate step (`inspectPosition`).
 *
 * A board that cannot be read at all -- a row of the wrong length, a character that is not a piece -- is refused
 * outright rather than half read, because half a board looks like a position and is not one.
 */
export function readFen(text: string): FenReading {
  const draft = emptyDraft()
  const notes: string[] = []
  const source = (text ?? '').trim()
  if (!source) return { ok: false, draft, notes, reason: 'There is no position here.' }
  const fields = source.split(/\s+/)
  const rows = fields[0].split('/')
  if (rows.length !== 8) {
    return { ok: false, draft, notes, reason: `A board has eight rows; this has ${rows.length}.` }
  }
  const pieces: BoardSquare[] = []
  for (const [index, row] of rows.entries()) {
    const rank = 8 - index
    let file = 0
    for (const ch of row) {
      if (/[1-8]/.test(ch)) { file += Number(ch); continue }
      if (!/[prnbqkPRNBQK]/.test(ch)) {
        return { ok: false, draft, notes, reason: `Row ${rank} contains “${ch}”, which is not a chess piece.` }
      }
      if (file > 7) {
        return { ok: false, draft, notes, reason: `Row ${rank} describes more than eight squares.` }
      }
      pieces.push({
        square: squareName(file, rank),
        type: ch.toLowerCase() as PieceLetter,
        color: ch === ch.toUpperCase() ? 'w' : 'b'
      })
      file += 1
    }
    if (file !== 8) {
      return { ok: false, draft, notes, reason: `Row ${rank} describes ${file} squares instead of 8.` }
    }
  }
  draft.pieces = pieces

  if (fields[1] === undefined) notes.push('That position gave only the board, so it has been read as White to move, nobody able to castle, and no en passant square.')
  else if (fields[1] === 'w' || fields[1] === 'b') draft.turn = fields[1]
  else notes.push(`The side to move was “${fields[1]}”, which is neither w nor b, so it has been read as White.`)

  const castling = fields[2]
  if (castling !== undefined && castling !== '-') {
    const kept = [...castling].filter((ch): ch is CastlingFlag => (CASTLING_FLAGS as readonly string[]).includes(ch))
    draft.castling = orderCastling(kept)
    if (kept.length !== castling.length) {
      notes.push(`The castling part was “${castling}”; only K, Q, k and q mean anything there, so it has been read as ${draft.castling}.`)
    }
  }

  const ep = fields[3]
  if (ep !== undefined && ep !== '-') {
    if (/^[a-h][36]$/.test(ep)) draft.enPassant = ep
    else notes.push(`The en passant square was “${ep}”. A pawn can only be taken that way on the third or sixth row, so it has been left empty.`)
  }

  const half = Number.parseInt(fields[4] ?? '', 10)
  if (Number.isFinite(half) && half >= 0) draft.halfmove = half
  else if (fields[4] !== undefined) notes.push(`The halfmove clock was “${fields[4]}”, which is not a whole number, so it has been read as 0.`)

  const full = Number.parseInt(fields[5] ?? '', 10)
  if (Number.isFinite(full) && full >= 1) draft.fullmove = full
  else if (fields[5] !== undefined) notes.push(`The move number was “${fields[5]}”, which is not a move number, so it has been read as 1.`)

  return { ok: true, draft, notes }
}

// ---- editing a draft. Every one returns a new draft; nothing is changed in place, so undo is a list of drafts.

/** Puts a piece on a square, or takes whatever is there off. One square holds one piece. */
export function placePiece(draft: PositionDraft, square: string, piece: { type: PieceLetter; color: Side } | null): PositionDraft {
  if (!onBoard(square)) return draft
  const pieces = draft.pieces.filter((one) => one.square !== square)
  if (piece) pieces.push({ square, type: piece.type, color: piece.color })
  return { ...draft, pieces }
}

/** Moves whatever is on one square to another, legal or not. This is an editor: a king may be put in check. */
export function movePiece(draft: PositionDraft, from: string, to: string): PositionDraft {
  if (!onBoard(from) || !onBoard(to) || from === to) return draft
  const moving = draft.pieces.find((one) => one.square === from)
  if (!moving) return draft
  const pieces = draft.pieces.filter((one) => one.square !== from && one.square !== to)
  pieces.push({ ...moving, square: to })
  return { ...draft, pieces }
}

/**
 * An empty board.
 *
 * The rights and the en passant square go with the pieces. Keeping "KQkq" on a board with no kings would be a
 * contradiction nobody asked for, and clearing the board is an explicit thing to ask for rather than an accident.
 */
export function clearBoard(draft: PositionDraft): PositionDraft {
  return { ...draft, pieces: [], castling: '-', enPassant: '-' }
}

/**
 * Whose turn it is.
 *
 * The en passant square is left exactly as it was, even though changing the side to move can make it impossible. That
 * is deliberate: the contradiction is shown rather than tidied away, because tidying it would throw away something
 * the person typed.
 */
export function withTurn(draft: PositionDraft, turn: Side): PositionDraft {
  return { ...draft, turn }
}

export function withCastling(draft: PositionDraft, flag: CastlingFlag, on: boolean): PositionDraft {
  const held = new Set(draft.castling === '-' ? [] : [...draft.castling])
  if (on) held.add(flag)
  else held.delete(flag)
  return { ...draft, castling: orderCastling(held) }
}

/** '-' or a square on the third or sixth row. Anything else is not a square a pawn can be taken on, and is ignored. */
export function withEnPassant(draft: PositionDraft, square: string): PositionDraft {
  if (square === '-' || square === '') return { ...draft, enPassant: '-' }
  if (!/^[a-h][36]$/.test(square)) return draft
  return { ...draft, enPassant: square }
}

export function withClocks(draft: PositionDraft, halfmove: number, fullmove: number): PositionDraft {
  return {
    ...draft,
    halfmove: Number.isFinite(halfmove) ? Math.max(0, Math.round(halfmove)) : draft.halfmove,
    fullmove: Number.isFinite(fullmove) ? Math.max(1, Math.round(fullmove)) : draft.fullmove
  }
}

/**
 * The same position with the colours swapped.
 *
 * Every man changes colour and crosses to the mirrored row, the side to move changes, the rights swap sides and the en
 * passant square mirrors with them. It is the one transformation of a position that keeps it exactly as hard for the
 * other player, which is why an editor has it: a study written for White becomes the same study for Black.
 */
export function mirrorDraft(draft: PositionDraft): PositionDraft {
  const swap: Record<string, CastlingFlag> = { K: 'k', Q: 'q', k: 'K', q: 'Q' }
  const pieces = draft.pieces.map((one) => ({
    square: squareName(fileOf(one.square), 9 - rankOf(one.square)),
    type: one.type,
    color: one.color === 'w' ? ('b' as Side) : ('w' as Side)
  }))
  const castling = draft.castling === '-'
    ? '-'
    : orderCastling([...draft.castling].map((flag) => swap[flag]).filter((flag): flag is CastlingFlag => flag !== undefined))
  const enPassant = draft.enPassant === '-'
    ? '-'
    : `${draft.enPassant[0]}${9 - Number(draft.enPassant[1])}`
  return { ...draft, pieces, castling, enPassant, turn: draft.turn === 'w' ? 'b' : 'w' }
}

// ---- counting men

export interface SideMaterial {
  p: number
  n: number
  b: number
  r: number
  q: number
  k: number
  /** Everything, kings included. Sixteen at the start. */
  men: number
  /** Bishops by the colour of the square they stand on: two on one colour cost a promotion. */
  lightBishops: number
  darkBishops: number
}

export interface Material { w: SideMaterial; b: SideMaterial }

const blankSide = (): SideMaterial => ({ p: 0, n: 0, b: 0, r: 0, q: 0, k: 0, men: 0, lightBishops: 0, darkBishops: 0 })

/** A light square is one where the file and the rank differ in oddness: a1 is dark, h1 is light. */
export const isLightSquare = (square: string): boolean => (fileOf(square) + rankOf(square)) % 2 === 1

export function materialOf(pieces: readonly BoardSquare[]): Material {
  const material: Material = { w: blankSide(), b: blankSide() }
  for (const piece of pieces) {
    const side = material[piece.color]
    side[piece.type] += 1
    side.men += 1
    if (piece.type === 'b') {
      if (isLightSquare(piece.square)) side.lightBishops += 1
      else side.darkBishops += 1
    }
  }
  return material
}

/**
 * The fewest promotions a side's army needs.
 *
 * A second queen, a third rook, a third knight or two bishops on squares of one colour cannot be the men the side
 * started with, so each one is a promoted pawn. Each promotion costs one of the eight pawns, which is what makes this
 * worth counting: `pawns + promotions` can exceed eight, and when it does the army could never have existed.
 */
export function promotionsNeeded(side: SideMaterial): number {
  return Math.max(0, side.q - 1)
    + Math.max(0, side.r - 2)
    + Math.max(0, side.n - 2)
    + Math.max(0, side.lightBishops - 1)
    + Math.max(0, side.darkBishops - 1)
}

/**
 * The fewest captures a side's pawns must have made.
 *
 * Pawns only change file by capturing. Eight pawns start on eight files, so if a side has three pawns on one file, at
 * least two of them arrived from somewhere else and each arrival took an enemy man. It is a floor, not a count: a
 * position can need far more captures than this and the test still holds.
 */
export function pawnCapturesAtLeast(pieces: readonly BoardSquare[], side: Side): number {
  const perFile = new Map<number, number>()
  for (const piece of pieces) {
    if (piece.type !== 'p' || piece.color !== side) continue
    const file = fileOf(piece.square)
    perFile.set(file, (perFile.get(file) ?? 0) + 1)
  }
  let least = 0
  for (const count of perFile.values()) least += Math.max(0, count - 1)
  return least
}

// ---- judging a position

export type PositionFaultKind =
  | 'fen'
  | 'kings'
  | 'pawn-count'
  | 'men-count'
  | 'pawn-rank'
  | 'opponent-in-check'
  | 'kings-adjacent'
  | 'castling-king'
  | 'castling-rook'
  | 'en-passant-side'
  | 'en-passant-pawn'
  | 'en-passant-path'

/** Something that stops this being a chess position at all. */
export interface PositionFault {
  kind: PositionFaultKind
  message: string
  /** Squares worth pointing at, when there are any. */
  squares: string[]
}

export type UnreachableKind = 'promotions' | 'captures' | 'clock' | 'en-passant-clock'

/** Legal as a position, but it could not have come from a game. Allowed, and said out loud. */
export interface UnreachableNote {
  kind: UnreachableKind
  message: string
}

export interface PositionInspection {
  fen: string
  /** What the rules module says about the FEN itself. */
  fenCheck: FenCheck
  /** Empty when this is a chess position. */
  faults: PositionFault[]
  /** Empty when nothing proves the position could not have been reached. Never a reason to refuse it. */
  unreachable: UnreachableNote[]
  /** A position Orbis will take: the FEN loads and nothing structural is wrong. */
  legal: boolean
  /** Legal, and nothing found says it could not have been played to. A composed position is often not this. */
  reachable: boolean
  turn: Side
  /** Whether the side to move stands in check. Only meaningful when `legal`. */
  check: boolean
  /** Checkmate, stalemate, or the game going on. Null when the position is not legal. */
  state: Outcome | null
  material: Material
  /** How many moves the side to move has. Null when the position is not legal. */
  moves: number | null
}

const SIDE_WORD: Record<Side, string> = { w: 'White', b: 'Black' }

/**
 * Whether the side **not** to move is standing in check.
 *
 * That cannot happen in a real game: you do not get to leave your king attacked and hand over the move. It is asked
 * of the rules rather than worked out here, by handing them the same board with the other side to move. The rights and
 * the en passant square are emptied in that copy because neither changes who is attacking whom, and keeping them could
 * make the copy unreadable for an unrelated reason.
 */
function opponentStandsInCheck(placement: string, turn: Side): boolean | null {
  const flipped = `${placement} ${turn === 'w' ? 'b' : 'w'} - - 0 1`
  if (!checkFen(flipped).ok) return null
  const state = outcome(flipped)
  return state.over ? state.reason === 'checkmate' : state.check
}

function castlingFaults(draft: PositionDraft, at: Map<string, BoardSquare>): PositionFault[] {
  const faults: PositionFault[] = []
  const held = draft.castling === '-' ? [] : [...draft.castling]
  const sides: { flags: CastlingFlag[]; colour: Side; king: string; rooks: Record<string, string> }[] = [
    { flags: ['K', 'Q'], colour: 'w', king: 'e1', rooks: { K: 'h1', Q: 'a1' } },
    { flags: ['k', 'q'], colour: 'b', king: 'e8', rooks: { k: 'h8', q: 'a8' } }
  ]
  for (const side of sides) {
    const wanted = side.flags.filter((flag) => held.includes(flag))
    if (!wanted.length) continue
    const king = at.get(side.king)
    if (!king || king.type !== 'k' || king.color !== side.colour) {
      faults.push({
        kind: 'castling-king',
        message: `${SIDE_WORD[side.colour]} is marked as able to castle, but there is no ${SIDE_WORD[side.colour].toLowerCase()} king on ${side.king}. Ordinary chess needs the king on its own square to castle; Chess960 allows other arrangements and Orbis does not play Chess960.`,
        squares: [side.king]
      })
      continue
    }
    for (const flag of wanted) {
      const square = side.rooks[flag]
      const rook = at.get(square)
      if (!rook || rook.type !== 'r' || rook.color !== side.colour) {
        faults.push({
          kind: 'castling-rook',
          message: `The rights say ${flag}, so ${SIDE_WORD[side.colour].toLowerCase()} may castle with the rook on ${square}, and there is no ${SIDE_WORD[side.colour].toLowerCase()} rook there.`,
          squares: [square]
        })
      }
    }
  }
  return faults
}

function enPassantFaults(draft: PositionDraft, at: Map<string, BoardSquare>): PositionFault[] {
  if (draft.enPassant === '-') return []
  const file = draft.enPassant[0]
  const rank = Number(draft.enPassant[1])
  // The square names the pawn that has just pushed two. A square on the third row means White pushed, and White has
  // therefore just moved, so it must be Black's turn. The sixth row is the same thing the other way up.
  const pusher: Side = rank === 3 ? 'w' : 'b'
  const mustMove: Side = pusher === 'w' ? 'b' : 'w'
  if (draft.turn !== mustMove) {
    return [{
      kind: 'en-passant-side',
      message: `${draft.enPassant} says a ${SIDE_WORD[pusher].toLowerCase()} pawn has just moved two squares, so it would be ${SIDE_WORD[mustMove]} to move, not ${SIDE_WORD[draft.turn]}.`,
      squares: [draft.enPassant]
    }]
  }
  const faults: PositionFault[] = []
  const landed = `${file}${pusher === 'w' ? 4 : 5}`
  const home = `${file}${pusher === 'w' ? 2 : 7}`
  const pawn = at.get(landed)
  if (!pawn || pawn.type !== 'p' || pawn.color !== pusher) {
    faults.push({
      kind: 'en-passant-pawn',
      message: `${draft.enPassant} can only be an en passant square if the ${SIDE_WORD[pusher].toLowerCase()} pawn that pushed two is standing on ${landed}, and it is not.`,
      squares: [landed, draft.enPassant]
    })
  }
  for (const square of [draft.enPassant, home]) {
    if (at.has(square)) {
      faults.push({
        kind: 'en-passant-path',
        message: `${square} has a piece on it, so the pawn could not have come through it to reach ${landed}.`,
        squares: [square]
      })
    }
  }
  return faults
}

function structuralFaults(draft: PositionDraft, placement: string): PositionFault[] {
  const faults: PositionFault[] = []
  const at = new Map(draft.pieces.map((one) => [one.square, one]))
  const material = materialOf(draft.pieces)

  for (const side of ['w', 'b'] as Side[]) {
    const count = material[side].k
    if (count !== 1) {
      faults.push({
        kind: 'kings',
        message: count === 0
          ? `${SIDE_WORD[side]} has no king. Every chess position has one king each.`
          : `${SIDE_WORD[side]} has ${count} kings. Every chess position has one king each.`,
        squares: draft.pieces.filter((one) => one.type === 'k' && one.color === side).map((one) => one.square)
      })
    }
    if (material[side].p > 8) {
      faults.push({
        kind: 'pawn-count',
        message: `${SIDE_WORD[side]} has ${material[side].p} pawns. A side starts with eight and can never gain one.`,
        squares: draft.pieces.filter((one) => one.type === 'p' && one.color === side).map((one) => one.square)
      })
    }
    if (material[side].men > 16) {
      faults.push({
        kind: 'men-count',
        message: `${SIDE_WORD[side]} has ${material[side].men} men on the board. A side starts with sixteen and can never gain one.`,
        squares: []
      })
    }
  }

  const stranded = draft.pieces.filter((one) => one.type === 'p' && (rankOf(one.square) === 1 || rankOf(one.square) === 8))
  if (stranded.length) {
    faults.push({
      kind: 'pawn-rank',
      message: `A pawn cannot stand on the first or the last row: it would have had to promote. ${stranded.map((one) => one.square).join(', ')}.`,
      squares: stranded.map((one) => one.square)
    })
  }

  const kings = draft.pieces.filter((one) => one.type === 'k')
  const white = kings.find((one) => one.color === 'w')
  const black = kings.find((one) => one.color === 'b')
  let adjacent = false
  if (white && black) {
    adjacent = Math.abs(fileOf(white.square) - fileOf(black.square)) <= 1
      && Math.abs(rankOf(white.square) - rankOf(black.square)) <= 1
    if (adjacent) {
      faults.push({
        kind: 'kings-adjacent',
        message: `The kings are touching, on ${white.square} and ${black.square}. Kings may never stand next to each other.`,
        squares: [white.square, black.square]
      })
    }
  }

  // Only worth asking when the board is otherwise a board: a position with two kings or nine pawns cannot be handed to
  // the rules, and the faults above already say what is wrong with it.
  if (!adjacent && !faults.length) {
    const inCheck = opponentStandsInCheck(placement, draft.turn)
    const idle: Side = draft.turn === 'w' ? 'b' : 'w'
    if (inCheck === true) {
      faults.push({
        kind: 'opponent-in-check',
        message: `${SIDE_WORD[idle]} is in check but it is ${SIDE_WORD[draft.turn]} to move. A player cannot leave their own king attacked and hand over the move.`,
        squares: draft.pieces.filter((one) => one.type === 'k' && one.color === idle).map((one) => one.square)
      })
    }
  }

  faults.push(...castlingFaults(draft, at))
  faults.push(...enPassantFaults(draft, at))
  return faults
}

function unreachableNotes(draft: PositionDraft): UnreachableNote[] {
  const notes: UnreachableNote[] = []
  const material = materialOf(draft.pieces)
  for (const side of ['w', 'b'] as Side[]) {
    const mine = material[side]
    const promotions = promotionsNeeded(mine)
    if (promotions > 0 && mine.p + promotions > 8) {
      notes.push({
        kind: 'promotions',
        message: `${SIDE_WORD[side]}’s army needs at least ${promotions} promoted pawn${promotions === 1 ? '' : 's'} on top of ${mine.p} pawn${mine.p === 1 ? '' : 's'} still on the board, which is more than the eight pawns a side ever has. This position could not have been played to.`
      })
    }
    const other: Side = side === 'w' ? 'b' : 'w'
    const captures = pawnCapturesAtLeast(draft.pieces, side)
    const missing = 16 - material[other].men
    if (captures > missing && missing >= 0) {
      notes.push({
        kind: 'captures',
        message: `${SIDE_WORD[side]}’s pawns are stacked so that they must have captured at least ${captures} times, and only ${missing} ${SIDE_WORD[other].toLowerCase()} ${missing === 1 ? 'man is' : 'men are'} missing. This position could not have been played to.`
      })
    }
  }
  const plies = (draft.fullmove - 1) * 2 + (draft.turn === 'b' ? 1 : 0)
  if (draft.halfmove > plies) {
    notes.push({
      kind: 'clock',
      message: `The position says ${draft.halfmove} moves have passed without a capture or a pawn move, but counting from move 1 only ${plies} have been played at all.`
    })
  }
  if (draft.enPassant !== '-' && draft.halfmove !== 0) {
    notes.push({
      kind: 'en-passant-clock',
      message: `${draft.enPassant} says a pawn moved last, which resets that count to zero, and the count here is ${draft.halfmove}.`
    })
  }
  return notes
}

/**
 * Everything Orbis can say about a position, and the two kinds of wrong kept apart.
 *
 * `faults` is refusal: those are not chess positions and nothing will take them. `unreachable` is a remark: the
 * position is fine and may be studied, analysed and saved, and it simply did not come from a game. A composed study is
 * the normal case of the second, which is why the two are never mixed into one list of "problems".
 */
export function inspectPosition(fen: string): PositionInspection {
  const fenCheck = checkFen(fen)
  const reading = readFen(fen)
  const material = materialOf(reading.draft.pieces)
  if (!reading.ok) {
    return {
      fen,
      fenCheck,
      faults: [{ kind: 'fen', message: reading.reason ?? 'This is not a position.', squares: [] }],
      unreachable: [],
      legal: false,
      reachable: false,
      turn: 'w',
      check: false,
      state: null,
      material,
      moves: null
    }
  }
  const placement = fen.trim().split(/\s+/)[0]
  const faults = structuralFaults(reading.draft, placement)
  // The rules module has the last word on the FEN. A position that passes everything here and still will not load is
  // refused: something is wrong that these checks do not know about, and pretending otherwise would hide it.
  if (!fenCheck.ok && !faults.some((one) => one.kind !== 'fen')) {
    faults.push({ kind: 'fen', message: fenCheck.reason ?? 'This position is not legal.', squares: [] })
  }
  const legal = fenCheck.ok && faults.length === 0
  const state = legal ? outcome(fen) : null
  const unreachable = legal ? unreachableNotes(reading.draft) : []
  return {
    fen,
    fenCheck,
    faults,
    unreachable,
    legal,
    reachable: legal && unreachable.length === 0,
    turn: reading.draft.turn,
    check: state ? (state.over ? state.reason === 'checkmate' : state.check) : false,
    state,
    material,
    moves: legal ? legalMoves(fen).length : null
  }
}

/** The draft judged, with the FEN it makes. */
export function inspectDraft(draft: PositionDraft): PositionInspection {
  return inspectPosition(draftToFen(draft))
}

/**
 * One line about a position, for a heading.
 *
 * It never says "valid" on its own: a position can be legal and unreachable at the same time, and that pair is the
 * interesting thing about a composed position rather than a contradiction.
 */
export function summarise(inspection: PositionInspection): string {
  if (!inspection.legal) {
    const first = inspection.faults[0]
    return inspection.faults.length === 1
      ? `Not a chess position: ${first?.message ?? ''}`.trim()
      : `Not a chess position: ${inspection.faults.length} things are wrong with it.`
  }
  const state = inspection.state
  const where = state && state.over
    ? state.reason === 'checkmate'
      ? `checkmate, ${state.result}`
      : `drawn already, ${state.reason.replace(/-/g, ' ')}`
    : `${SIDE_WORD[inspection.turn]} to move${inspection.check ? ', in check' : ''}`
  if (inspection.unreachable.length) return `A legal position — ${where} — that no game could have reached.`
  return `A legal position — ${where}.`
}
