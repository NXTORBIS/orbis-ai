import type { Performance } from './attempt.ts'
import type { Side } from './evaluation.ts'
import {
  PIECE_VALUE, STRICT_FAILURE, firstMoves, materialSwing, newExercise, playablePosition, validateExercise,
  type Exercise, type ExerciseCheck, type ExerciseHint, type NewExercise, type Provenance, type Verification,
  type WalkedLine
} from './exercise.ts'
import {
  applyMove, boardSquares, buildFen, destinationsFrom, legalMoves, moveNumber, sideToMove,
  type BoardSquare, type ChessMove
} from './rules.ts'
import {
  newPersonRating, ratePuzzleFromAttempt, rateAttempt, type PersonRating, type PuzzleRatingState,
  type PuzzleRatingUpdate, type RatingUpdate
} from './puzzleRating.ts'

/**
 * What a puzzle is: an exercise with a theme, a rating and a provenance (Sections 071-076, 079, 080).
 *
 * The exercise half is `exercise.ts` and is not repeated here -- the position, the objective, the solution tree, the
 * hints and the verification all live there, and `validateExercise` is still the only thing that may stamp something
 * verified. What this file adds is the three things a *puzzle* has that a bare exercise does not: what it is about,
 * how hard it is, and where it came from; plus the collection those puzzles live in and the record of how somebody
 * has got on with each one.
 *
 * ## A theme is a claim, and the claim says who made it
 *
 * "Back-rank mate" is either a fact about the final position or it is somebody's opinion, and the difference matters:
 * a trainer that files a puzzle under *fork* because a model said so will happily build a whole session of forks
 * that contain no forks. So a theme is never a bare string. It is a `ThemeClaim` carrying the evidence behind it:
 *
 *   - `checked`    -- a check in this file proved it from the position, and `says` is the criterion it used.
 *   - `source`     -- the place the puzzle came from said so, and `by` names that place.
 *   - `convention` -- counted off the board by a rule Orbis chose. Real arithmetic; the boundary is a convention.
 *                     The phase of the game and the length of the solution are the only two.
 *   - `claimed`    -- somebody said so and nothing has checked it. Kept because imported material has it, never
 *                     shown as a fact, and `isFact` returns false for it.
 *
 * Only a handful of themes can be checked, and the two that cannot be are said plainly rather than fudged: Orbis
 * cannot see what one of its own pieces attacks in a position where it has just given check, because the rules
 * module will not generate moves on a board where a king could be captured. So `fork` is only ever claimed for a
 * move that gives no check, and `double-check`, `pin`, `skewer` and `discovered-attack` are never checked at all --
 * they can only arrive from a source. A missing label is a small loss; a wrong one is a lie.
 *
 * ## Filters work on what is really stored
 *
 * `puzzleFacets` counts the themes, statuses and rating bands that actually occur in a collection. It never returns
 * a fixed list of themes with zeroes beside them, because a filter bar built from a fixed list tells somebody they
 * own puzzles they do not own.
 *
 * ## The daily challenge cannot be rerolled
 *
 * `pickDaily` is a hash of the local date, so it is the same every time it is asked -- but the pool it picks from
 * grows as puzzles are made, and a deterministic pick over a growing pool is not stable. So the day's choice is
 * *written down* the first time it is made (`store.daily`) and `dailyFor` returns the recorded one ever after.
 * Closing the app and opening it again cannot produce a different puzzle, and neither can making more puzzles.
 *
 * Pure: no clock, no storage, no network. Every time comes in as an argument.
 */

// ---------------------------------------------------------------- themes

export type PuzzleTheme =
  // What the puzzle asks for. Read off the objective, and only once the rules have proved it.
  | 'mate'
  | 'win-material'
  | 'hold-draw'
  | 'best-move'
  // Named mating patterns, from the final position of a proved mate.
  | 'back-rank-mate'
  | 'smothered-mate'
  // Tactical devices. Only `fork`, `sacrifice` and `hanging-piece` can be checked here.
  | 'fork'
  | 'sacrifice'
  | 'hanging-piece'
  | 'pin'
  | 'skewer'
  | 'discovered-attack'
  | 'double-check'
  | 'double-attack'
  | 'deflection'
  | 'decoy'
  | 'interference'
  | 'trapped-piece'
  | 'zugzwang'
  | 'perpetual-check'
  | 'stalemate'
  // Moves that are special by the rules.
  | 'promotion'
  | 'underpromotion'
  | 'en-passant'
  | 'castling'
  // Phase and length: counted, by a stated convention.
  | 'opening'
  | 'middlegame'
  | 'endgame'
  | 'one-move'
  | 'short'
  | 'long'

export const PUZZLE_THEMES: readonly PuzzleTheme[] = Object.freeze([
  'mate', 'win-material', 'hold-draw', 'best-move',
  'back-rank-mate', 'smothered-mate',
  'fork', 'sacrifice', 'hanging-piece', 'pin', 'skewer', 'discovered-attack', 'double-check', 'double-attack',
  'deflection', 'decoy', 'interference', 'trapped-piece', 'zugzwang', 'perpetual-check', 'stalemate',
  'promotion', 'underpromotion', 'en-passant', 'castling',
  'opening', 'middlegame', 'endgame', 'one-move', 'short', 'long'
])

export const THEME_LABEL: Readonly<Record<PuzzleTheme, string>> = Object.freeze({
  mate: 'Mate',
  'win-material': 'Win material',
  'hold-draw': 'Hold the draw',
  'best-move': 'Best move',
  'back-rank-mate': 'Back-rank mate',
  'smothered-mate': 'Smothered mate',
  fork: 'Fork',
  sacrifice: 'Sacrifice',
  'hanging-piece': 'Hanging piece',
  pin: 'Pin',
  skewer: 'Skewer',
  'discovered-attack': 'Discovered attack',
  'double-check': 'Double check',
  'double-attack': 'Double attack',
  deflection: 'Deflection',
  decoy: 'Decoy',
  interference: 'Interference',
  'trapped-piece': 'Trapped piece',
  zugzwang: 'Zugzwang',
  'perpetual-check': 'Perpetual check',
  stalemate: 'Stalemate',
  promotion: 'Promotion',
  underpromotion: 'Underpromotion',
  'en-passant': 'En passant',
  castling: 'Castling',
  opening: 'Opening',
  middlegame: 'Middlegame',
  endgame: 'Endgame',
  'one-move': 'One move',
  short: 'Short',
  long: 'Long'
})

/** What each theme means, in everyday words, for a screen that has to be able to explain its own filter. */
export const THEME_MEANING: Readonly<Record<PuzzleTheme, string>> = Object.freeze({
  mate: 'A forced checkmate is on the board.',
  'win-material': 'There is material to be won, and it stays won.',
  'hold-draw': 'The position is worse and there is a way to draw it.',
  'best-move': 'Find the move the engine would play. Nothing but an engine can settle this one.',
  'back-rank-mate': 'The king is mated on its own back row, hemmed in by its own pieces.',
  'smothered-mate': 'A knight mates a king that is surrounded by its own pieces.',
  fork: 'One piece attacks two things at once.',
  sacrifice: 'Material is given away on purpose, and it still works.',
  'hanging-piece': 'A piece is there for the taking and nothing can take it back.',
  pin: 'A piece cannot move because something behind it would be lost.',
  skewer: 'A valuable piece is attacked and something behind it is lost when it moves.',
  'discovered-attack': 'Moving one piece opens a line for another.',
  'double-check': 'Two pieces give check at once, so only the king can move.',
  'double-attack': 'Two things are threatened at the same time.',
  deflection: 'A defender is pulled away from what it was guarding.',
  decoy: 'A piece is lured onto a square where it is in the way.',
  interference: 'A line between two defenders is blocked.',
  'trapped-piece': 'A piece has nowhere to go and is won.',
  zugzwang: 'Having to move is what loses the position.',
  'perpetual-check': 'A draw by checking for ever.',
  stalemate: 'A draw by leaving the other side with no legal move.',
  promotion: 'A pawn reaches the last row.',
  underpromotion: 'A pawn promotes to something other than a queen, on purpose.',
  'en-passant': 'A pawn is taken in passing.',
  castling: 'The king and rook move together.',
  opening: 'Early in the game, with most pieces still on.',
  middlegame: 'The middle of the game.',
  endgame: 'Few pieces left.',
  'one-move': 'One move and it is done.',
  short: 'Two of your own moves.',
  long: 'Three or more of your own moves.'
})

export type ThemeEvidence =
  /** A check in this file proved it from the position. */
  | 'checked'
  /** The place the puzzle came from said so. */
  | 'source'
  /** Counted off the board by a rule Orbis chose. The arithmetic is real; the boundary is a convention. */
  | 'convention'
  /** Somebody said so and nothing checked it. Never a fact. */
  | 'claimed'

export interface ThemeClaim {
  theme: PuzzleTheme
  evidence: ThemeEvidence
  /** The criterion that was used, or who said it. Never empty. */
  says: string
  /** For `source` and `claimed`: who or what said it. */
  by?: string
}

/** Whether a claim may be shown as a fact about the position. Only a check earns that. */
export function isFact(claim: ThemeClaim): boolean {
  return claim.evidence === 'checked'
}

/** The themes this file is able to prove. Everything else can only come from a source. */
export const CHECKABLE_THEMES: readonly PuzzleTheme[] = Object.freeze([
  'mate', 'win-material', 'hold-draw', 'best-move', 'back-rank-mate', 'smothered-mate',
  'fork', 'sacrifice', 'hanging-piece', 'stalemate', 'promotion', 'underpromotion', 'en-passant', 'castling'
])

/** The themes counted off the board by a convention of Orbis's own, with the numbers in `says`. */
export const CONVENTION_THEMES: readonly PuzzleTheme[] = Object.freeze([
  'opening', 'middlegame', 'endgame', 'one-move', 'short', 'long'
])

/**
 * Why some themes can never be checked here, said once so a screen can repeat it.
 *
 * The cause is specific and worth knowing: to see what one of its own pieces attacks, Orbis puts the same board in
 * front of the rules with its own side to move. That works -- unless the move just played gave check, because then
 * the board has a king that could be captured and the rules module refuses to generate moves on it at all. Every
 * theme that needs to know what attacks what *after a check* is therefore out of reach.
 */
export const UNCHECKABLE_BECAUSE: Readonly<Partial<Record<PuzzleTheme, string>>> = Object.freeze({
  'double-check': 'Seeing two pieces give check at once needs Orbis to look at what its own pieces attack in a position where a king is already in check, and the rules module will not generate moves on such a board. So this is never claimed from the position.',
  pin: 'A pin is about what would happen if a piece moved, which needs a search Orbis does not do here.',
  skewer: 'A skewer is about what is behind the piece being attacked, which needs a search Orbis does not do here.',
  'discovered-attack': 'A discovered attack is about the line a piece left behind, which Orbis cannot look at without taking a piece off the board.',
  'double-attack': 'Two threats at once, where one of them is a check, runs into the same wall as double check.',
  deflection: 'What a defender was guarding is not something Orbis can read off one position.',
  decoy: 'Why a square is bad for a piece is not something Orbis can read off one position.',
  interference: 'Which line was blocked is not something Orbis can read off one position.',
  'trapped-piece': 'Whether a piece has nowhere to go needs a search of the replies.',
  zugzwang: 'Zugzwang is a statement about every move being bad, which needs an engine.',
  'perpetual-check': 'A draw by checking for ever needs a repetition search Orbis does not do here.'
})

// ---------------------------------------------------------------- the conventions, written down

/** The convention for the phase of the game, in centipawns of pieces other than kings and pawns, both sides. */
export const PHASE_RULE = Object.freeze({
  /** Both sides' rooks, knights, bishops and queens when nothing has been taken. */
  fullPieces: 6200,
  endgameAtOrBelow: 1300,
  openingAtOrAbove: 5200,
  openingUpToMoveNumber: 12
})

/** Pieces other than kings and pawns, both sides, in centipawns. The number the phase convention reads. */
export function pieceMaterial(fen: string): number {
  let total = 0
  for (const square of boardSquares(fen)) {
    if (square.type === 'k' || square.type === 'p') continue
    total += PIECE_VALUE[square.type]
  }
  return total
}

export function phaseOf(fen: string): { theme: 'opening' | 'middlegame' | 'endgame'; says: string } {
  const pieces = pieceMaterial(fen)
  const number = moveNumber(fen)
  if (pieces <= PHASE_RULE.endgameAtOrBelow) {
    return { theme: 'endgame', says: `Counted as an endgame: ${pieces} centipawns of pieces other than kings and pawns, and Orbis calls ${PHASE_RULE.endgameAtOrBelow} or less an endgame.` }
  }
  if (pieces >= PHASE_RULE.openingAtOrAbove && number <= PHASE_RULE.openingUpToMoveNumber) {
    return { theme: 'opening', says: `Counted as an opening: move ${number}, with ${pieces} of ${PHASE_RULE.fullPieces} centipawns of pieces still on.` }
  }
  return { theme: 'middlegame', says: `Counted as a middlegame: ${pieces} centipawns of pieces other than kings and pawns, at move ${number}.` }
}

// ---------------------------------------------------------------- the puzzle

export interface Puzzle {
  /** The same id as the exercise it wraps, so one id names one puzzle everywhere. */
  id: string
  exercise: Exercise
  themes: readonly ThemeClaim[]
  /** Null until something has given it one. A puzzle Orbis made has none, on purpose. */
  rating: number | null
  ratingFrom: 'source' | 'measured' | null
  addedAt: number
}

export interface NewPuzzle extends NewExercise {
  /** Themes a source carried. They arrive as `source` claims, never as checked ones. */
  sourceThemes?: readonly string[]
  /** Who said them, for the record. */
  themesBy?: string
  rating?: number
  addedAt: number
}

/**
 * A new puzzle, always unverified, with its source themes kept apart from anything checked.
 *
 * There is deliberately no way to build one that claims a checked theme: `verifyPuzzle` is the only thing that adds
 * those, and only for what it could prove.
 */
export function newPuzzle(input: NewPuzzle): Puzzle {
  const exercise = newExercise(input)
  const by = input.themesBy ?? (input.source.by ?? undefined)
  const claims: ThemeClaim[] = []
  for (const text of input.sourceThemes ?? []) {
    const theme = readTheme(text)
    if (!theme) continue
    claims.push({
      theme,
      evidence: 'source',
      says: `${by ? `${by} says` : 'The source says'} this is a ${THEME_LABEL[theme].toLowerCase()} puzzle. Nothing here has checked it.`,
      ...(by ? { by } : {})
    })
  }
  return {
    id: exercise.id,
    exercise,
    themes: dedupeClaims(claims),
    rating: input.rating !== undefined && Number.isFinite(input.rating) ? Math.round(input.rating) : null,
    ratingFrom: input.rating !== undefined && Number.isFinite(input.rating) ? 'source' : null,
    addedAt: input.addedAt
  }
}

/** A theme name from a source turned into one of Orbis's, or null when it is not one Orbis knows. */
export function readTheme(text: string): PuzzleTheme | null {
  const key = text.trim().toLowerCase().replace(/[\s_]+/g, '-')
  if ((PUZZLE_THEMES as readonly string[]).includes(key)) return key as PuzzleTheme
  // The few spellings other sources use for the same idea. Anything else is left alone rather than guessed at.
  const known: Readonly<Record<string, PuzzleTheme>> = {
    mateinone: 'mate', 'mate-in-one': 'mate', 'mate-in-1': 'mate', mate1: 'mate', matein1: 'mate',
    'mate-in-two': 'mate', 'mate-in-2': 'mate', mate2: 'mate', matein2: 'mate',
    'mate-in-three': 'mate', 'mate-in-3': 'mate', mate3: 'mate', matein3: 'mate',
    'mate-in-four': 'mate', 'mate-in-4': 'mate', matein4: 'mate',
    'mate-in-five': 'mate', 'mate-in-5': 'mate', matein5: 'mate',
    checkmate: 'mate', mating: 'mate',
    backrankmate: 'back-rank-mate', 'back-rank': 'back-rank-mate', backrank: 'back-rank-mate',
    smotheredmate: 'smothered-mate',
    doublecheck: 'double-check',
    discoveredattack: 'discovered-attack', discovery: 'discovered-attack',
    hangingpiece: 'hanging-piece', hanging: 'hanging-piece',
    trappedpiece: 'trapped-piece',
    enpassant: 'en-passant',
    advancedpawn: 'promotion', promotions: 'promotion',
    'material-gain': 'win-material', material: 'win-material', wins_material: 'win-material',
    draw: 'hold-draw', 'defensive-move': 'hold-draw',
    equality: 'hold-draw',
    oneMove: 'one-move', onemove: 'one-move',
    middlegame: 'middlegame', opening: 'opening', endgame: 'endgame',
    sac: 'sacrifice', sacrifices: 'sacrifice',
    bestmove: 'best-move'
  }
  return known[key] ?? known[key.replace(/-/g, '')] ?? null
}

function dedupeClaims(claims: readonly ThemeClaim[]): readonly ThemeClaim[] {
  // One claim per theme, and the strongest evidence wins -- a checked fact is never pushed out by a source's word.
  const rank: Readonly<Record<ThemeEvidence, number>> = { checked: 3, convention: 2, source: 1, claimed: 0 }
  const best = new Map<PuzzleTheme, ThemeClaim>()
  for (const claim of claims) {
    const held = best.get(claim.theme)
    if (!held || rank[claim.evidence] > rank[held.evidence]) best.set(claim.theme, claim)
  }
  return Object.freeze([...best.values()].sort((a, b) => a.theme.localeCompare(b.theme)))
}

// ---------------------------------------------------------------- checking the themes

/** The same board with the given side to move, for asking the rules what one of its own pieces attacks. */
function withSideToMove(fen: string, side: Side): string | null {
  const fields = fen.trim().split(/\s+/)
  if (fields[1] === side) return fen
  // En passant is dropped: it belongs to the other side's last move, so a pawn capture in passing is missed here.
  const built = buildFen({ pieces: boardSquares(fen), turn: side, castling: fields[2] ?? '-', halfmove: 0, fullmove: 1 })
  if (!built.check.ok) return null
  return playablePosition(built.fen).ok ? built.fen : null
}

/**
 * The enemy pieces one of your own pieces attacks, from where it stands.
 *
 * Returns nothing at all when the position cannot be put in front of the rules with your side to move -- which is
 * exactly the case where you have just given check. Callers must treat an empty answer as "cannot tell", never as
 * "attacks nothing", and the only caller does.
 */
function enemiesAttackedFrom(fen: string, from: string, side: Side): BoardSquare[] {
  const flipped = withSideToMove(fen, side)
  if (!flipped) return []
  const here = new Map(boardSquares(fen).map((s) => [s.square, s]))
  const found = new Map<string, BoardSquare>()
  for (const move of destinationsFrom(flipped, from)) {
    if (!move.captured) continue
    const victim = here.get(move.to)
    // A king is never among these: the only position in which you attack one is a check, and then `flipped` is null.
    if (victim && victim.color !== side && victim.type !== 'k') found.set(victim.square, victim)
  }
  return [...found.values()]
}

/** The moves of one line, resolved against the positions they are played in. */
function walkMoves(startFen: string, uci: readonly string[]): ChessMove[] {
  const out: ChessMove[] = []
  let fen = startFen
  for (const one of uci) {
    const made = applyMove(fen, one)
    if (!made) return out
    fen = made.after
    out.push(made)
  }
  return out
}

function squareAt(file: number, rank: number): string | null {
  if (file < 0 || file > 7 || rank < 1 || rank > 8) return null
  return `${String.fromCharCode(97 + file)}${rank}`
}

/** A mate delivered along the mated king's own back row, with the king hemmed in by its own pieces. */
function isBackRankMate(mate: ChessMove): boolean {
  if (mate.piece !== 'r' && mate.piece !== 'q') return false
  const mated: Side = mate.color === 'w' ? 'b' : 'w'
  const backRank = mated === 'w' ? 1 : 8
  if (Number(mate.to[1]) !== backRank) return false
  const pieces = boardSquares(mate.after)
  const king = pieces.find((p) => p.type === 'k' && p.color === mated)
  if (!king || Number(king.square[1]) !== backRank) return false
  const own = new Set(pieces.filter((p) => p.color === mated).map((p) => p.square))
  const infrontRank = backRank + (mated === 'w' ? 1 : -1)
  const file = king.square.charCodeAt(0) - 97
  for (const shift of [-1, 0, 1]) {
    const square = squareAt(file + shift, infrontRank)
    if (square && own.has(square)) return true
  }
  return false
}

/** A knight mate where every square around the king is taken by one of the king's own pieces. */
function isSmotheredMate(mate: ChessMove): boolean {
  if (mate.piece !== 'n') return false
  const mated: Side = mate.color === 'w' ? 'b' : 'w'
  const pieces = boardSquares(mate.after)
  const king = pieces.find((p) => p.type === 'k' && p.color === mated)
  if (!king) return false
  const own = new Set(pieces.filter((p) => p.color === mated).map((p) => p.square))
  const file = king.square.charCodeAt(0) - 97
  const rank = Number(king.square[1])
  for (const df of [-1, 0, 1]) {
    for (const dr of [-1, 0, 1]) {
      if (df === 0 && dr === 0) continue
      const square = squareAt(file + df, rank + dr)
      if (square && !own.has(square)) return false
    }
  }
  return true
}

/** The most the opponent can take back, as a swing for the solver. Null when they can take nothing. */
function worstCaptureSwing(exercise: Exercise, fenAfter: string): number | null {
  let worst: number | null = null
  for (const reply of legalMoves(fenAfter)) {
    if (!reply.captured) continue
    const swing = materialSwing(exercise.startFen, reply.after, exercise.sideToMove)
    if (worst === null || swing < worst) worst = swing
  }
  return worst
}

/** The last move of every line that ends in checkmate. */
function matingMoves(exercise: Exercise, lines: readonly WalkedLine[]): ChessMove[] {
  const out: ChessMove[] = []
  for (const line of lines) {
    if (line.endsIn !== 'checkmate') continue
    const moves = walkMoves(exercise.startFen, line.uci)
    const last = moves[moves.length - 1]
    if (last && last.checkmate) out.push(last)
  }
  return out
}

/**
 * The themes a position and a checked solution can be shown to have.
 *
 * `check` must be the result of `validateExercise` on this exercise. An exercise with faults gets no themes at all:
 * there is no sense in saying what a broken puzzle is about.
 */
export function checkedThemes(exercise: Exercise, check: ExerciseCheck): readonly ThemeClaim[] {
  const claims: ThemeClaim[] = []
  const add = (theme: PuzzleTheme, evidence: ThemeEvidence, says: string): void => { claims.push({ theme, evidence, says }) }
  if (!check.ok) return Object.freeze([])
  if (!playablePosition(exercise.startFen).ok) return Object.freeze([])

  const proved = check.objective === 'proved'
  const first = firstMoves(exercise)

  // ---- what the exercise asks for, once the rules have settled it
  if (exercise.objective === 'mate-in-n' && proved) {
    add('mate', 'checked', `Every line ends in checkmate, in ${exercise.movesToMate ?? 1} of your own ${(exercise.movesToMate ?? 1) === 1 ? 'move' : 'moves'}, against every defence.`)
  }
  if (exercise.objective === 'win-material' && proved) {
    add('win-material', 'checked', `Every line ends at least ${exercise.materialAtLeast ?? 0} centipawns ahead, and no capture takes it straight back.`)
  }
  if (exercise.objective === 'hold-draw' && proved) {
    add('hold-draw', 'checked', 'Every line ends in a position the rules call a draw.')
    if (check.lines.some((line) => line.endsIn === 'stalemate')) {
      add('stalemate', 'checked', 'A line ends in stalemate: the other side is left with no legal move and is not in check.')
    }
  }
  if (exercise.objective === 'find-best') {
    add('best-move', 'checked', 'The exercise asks for the engine’s best move. That is what it asks; whether the move given is best is not settled here.')
  }

  // ---- named mating patterns, from the final position of a proved mate
  if (exercise.objective === 'mate-in-n' && proved) {
    const mates = matingMoves(exercise, check.lines)
    if (mates.length > 0 && mates.every(isBackRankMate)) {
      add('back-rank-mate', 'checked', 'Every mate is given by a rook or queen on the mated king’s own back row, with the king boxed in by at least one of its own pieces.')
    }
    if (mates.length > 0 && mates.every(isSmotheredMate)) {
      add('smothered-mate', 'checked', 'Every mate is given by a knight to a king with one of its own pieces on every square around it.')
    }
  }

  // ---- moves that are special by the rules. Claimed only when every accepted first move is one.
  if (first.length > 0) {
    if (first.every((m) => m.promotion !== undefined)) {
      add('promotion', 'checked', `Every move that works promotes a pawn${first.length > 1 ? '' : ` -- ${first[0].san}`}.`)
      const queenAvailable = first.every((m) => destinationsFrom(exercise.startFen, m.from).some((alt) => alt.to === m.to && alt.promotion === 'q'))
      if (first.every((m) => m.promotion !== 'q') && queenAvailable) {
        add('underpromotion', 'checked', 'Every move that works promotes to something other than a queen, and a queen was available on the same square, so the choice is a real one.')
      }
    }
    if (first.every((m) => m.special === 'e')) add('en-passant', 'checked', 'Every move that works takes a pawn in passing.')
    if (first.every((m) => m.special === 'k' || m.special === 'q')) add('castling', 'checked', 'Every move that works is castling.')
  }

  // ---- a fork. Only for a single quiet-or-capturing move, because a check puts the answer out of reach.
  if (first.length === 1 && !first[0].check) {
    const move = first[0]
    const attacked = enemiesAttackedFrom(move.after, move.to, exercise.sideToMove)
    const worthMore = attacked.filter((victim) => PIECE_VALUE[victim.type] > PIECE_VALUE[move.piece])
    if (worthMore.length >= 2) {
      add('fork', 'checked', `After ${move.san} the ${move.piece === 'p' ? 'pawn' : move.piece.toUpperCase()} on ${move.to} attacks ${worthMore.length} enemy pieces worth more than it is: ${worthMore.map((v) => v.square).sort().join(', ')}.`)
    }
  }

  // ---- a capture of something nothing can take back
  if (first.length === 1 && first[0].captured) {
    const move = first[0]
    const recapture = legalMoves(move.after).some((reply) => reply.to === move.to && reply.captured)
    if (!recapture) {
      add('hanging-piece', 'checked', `${move.san} takes the ${move.captured === 'p' ? 'pawn' : (move.captured as string).toUpperCase()} on ${move.to}, and no legal reply takes anything back on that square.`)
    }
  }

  // ---- a sacrifice. Only once the objective is proved, so "and it still works" is not an assumption.
  if (first.length === 1 && proved && (exercise.objective === 'mate-in-n' || exercise.objective === 'win-material')) {
    const worst = worstCaptureSwing(exercise, first[0].after)
    if (worst !== null && worst < 0) {
      add('sacrifice', 'checked', `After ${first[0].san} the other side can take, leaving you ${Math.abs(worst)} centipawns down, and the exercise still works out.`)
    }
  }

  // ---- phase and length, by the written-down convention
  const phase = phaseOf(exercise.startFen)
  add(phase.theme, 'convention', phase.says)
  const longest = check.lines.reduce((most, line) => Math.max(most, line.solverMoves), 0)
  if (longest === 1) add('one-move', 'convention', 'One of your own moves and it is finished.')
  else if (longest === 2) add('short', 'convention', 'Two of your own moves.')
  else if (longest >= 3) add('long', 'convention', `${longest} of your own moves.`)

  return dedupeClaims(claims)
}

/**
 * The puzzle with its verification worked out and its checked themes recomputed.
 *
 * The only way a puzzle gets a checked theme, and -- through `exercise.ts` -- the only way it becomes verified.
 * Source claims are kept; a checked fact replaces a source claim about the same theme.
 */
export function verifyPuzzle(puzzle: Puzzle, now?: number): { puzzle: Puzzle; check: ExerciseCheck } {
  const check = validateExercise(puzzle.exercise, now)
  const kept = puzzle.themes.filter((claim) => claim.evidence === 'source' || claim.evidence === 'claimed')
  return {
    puzzle: {
      ...puzzle,
      exercise: { ...puzzle.exercise, verification: check.verification },
      themes: dedupeClaims([...checkedThemes({ ...puzzle.exercise, verification: check.verification }, check), ...kept])
    },
    check
  }
}

/** The themes of a puzzle as plain names, for a filter or a list. */
export function themeNames(puzzle: Puzzle, onlyFacts = false): PuzzleTheme[] {
  return puzzle.themes.filter((claim) => !onlyFacts || isFact(claim)).map((claim) => claim.theme)
}

// ---------------------------------------------------------------- hints, built from the position

/**
 * A hint ladder for a puzzle, built out of facts about its own solution.
 *
 * The rungs are `exercise.ts`'s: where to look, what to look for, which piece, which square, the move. A rung is
 * **left out** when the accepted first moves do not agree about it -- telling somebody "move the knight" when two of
 * the three answers move a rook is worse than saying nothing. The levels are then renumbered so they run 1, 2, 3,
 * which is what `validateExercise` insists on.
 */
export function hintsFor(exercise: Exercise, themes: readonly ThemeClaim[] = []): ExerciseHint[] {
  const first = firstMoves(exercise)
  if (first.length === 0) return []
  const rungs: { shows: ExerciseHint['shows']; text: string }[] = []

  // 1. What it is about, but only from something that was checked or counted. Never a guess.
  const headline = themes.find((claim) => claim.theme === 'mate' && isFact(claim))
    ?? themes.find((claim) => claim.theme === 'win-material' && isFact(claim))
    ?? themes.find((claim) => claim.theme === 'hold-draw' && isFact(claim))
  if (headline) {
    const text = headline.theme === 'mate'
      ? `There is a forced mate here${exercise.movesToMate ? `, in ${exercise.movesToMate}` : ''}.`
      : headline.theme === 'win-material'
        ? 'There is material to be won, and it stays won.'
        : 'The position is worse than it looks and there is a way to draw it.'
    rungs.push({ shows: 'theme', text })
  }

  // 2. What kind of move to look for. Only when every answer agrees.
  if (first.every((m) => m.check)) rungs.push({ shows: 'target', text: 'The move you want gives check.' })
  else if (first.every((m) => Boolean(m.captured))) rungs.push({ shows: 'target', text: 'The move you want takes something.' })
  else if (first.every((m) => !m.check && !m.captured)) rungs.push({ shows: 'target', text: 'The move you want gives no check and takes nothing. It is a quiet one.' })

  // 3. Which piece.
  const pieces = new Set(first.map((m) => m.piece))
  if (pieces.size === 1) {
    const names: Readonly<Record<string, string>> = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' }
    const froms = [...new Set(first.map((m) => m.from))]
    rungs.push({
      shows: 'piece',
      text: froms.length === 1
        ? `Move the ${names[first[0].piece]} on ${froms[0]}.`
        : `Move a ${names[first[0].piece]}.`
    })
  }

  // 4. Which square it ends on.
  const tos = new Set(first.map((m) => m.to))
  if (tos.size === 1) rungs.push({ shows: 'square', text: `The move ends on ${first[0].to}.` })

  // 5. The move itself, always last.
  const sans = [...new Set(first.map((m) => m.san))]
  rungs.push({
    shows: 'move',
    text: sans.length === 1 ? `Play ${sans[0]}.` : `Any of these works: ${sans.join(', ')}.`
  })

  return rungs.map((rung, i) => ({ level: i + 1, text: rung.text, shows: rung.shows }))
}

// ---------------------------------------------------------------- how somebody has got on

/** One finished attempt at a puzzle: the record `attempt.ts` leaves, plus the day it counted for. */
export interface PuzzleAttempt extends Performance {
  /** The local day, as YYYY-MM-DD, when this attempt was the daily challenge. Absent otherwise. */
  day?: string
}

export interface PuzzleRecord {
  puzzleId: string
  /** Oldest first. */
  attempts: readonly PuzzleAttempt[]
}

export type PuzzleStatus =
  /** Never attempted. */
  | 'unseen'
  /** The most recent finished attempt was a solve that counted. */
  | 'solved'
  /** Attempted, and the most recent finished attempt was not a solve that counted. */
  | 'missed'

export const PUZZLE_STATUSES: readonly PuzzleStatus[] = Object.freeze(['unseen', 'solved', 'missed'])

export const STATUS_LABEL: Readonly<Record<PuzzleStatus, string>> = Object.freeze({
  unseen: 'Not tried',
  solved: 'Solved',
  missed: 'Missed'
})

/** Whether an attempt counts as a solve. A solve reached with the move on screen does not, same as everywhere else. */
export function counts(attempt: PuzzleAttempt): boolean {
  return attempt.solved && attempt.worth > 0
}

export function statusOf(record: PuzzleRecord | undefined): PuzzleStatus {
  if (!record || record.attempts.length === 0) return 'unseen'
  return counts(record.attempts[record.attempts.length - 1]) ? 'solved' : 'missed'
}

export function everSolved(record: PuzzleRecord | undefined): boolean {
  return Boolean(record?.attempts.some(counts))
}

/** What to say about a puzzle's history, with the numbers kept apart rather than flattened into one. */
export function recordWords(record: PuzzleRecord | undefined): string {
  if (!record || record.attempts.length === 0) return 'Not tried yet.'
  const solved = record.attempts.filter(counts).length
  const last = record.attempts[record.attempts.length - 1]
  const lastWords = counts(last)
    ? last.hintsUsed > 0 || last.wrongMoves > 0
      ? `Last time: solved, with ${[last.hintsUsed ? `${last.hintsUsed} ${last.hintsUsed === 1 ? 'hint' : 'hints'}` : '', last.wrongMoves ? `${last.wrongMoves} wrong ${last.wrongMoves === 1 ? 'move' : 'moves'}` : ''].filter(Boolean).join(' and ')}.`
      : 'Last time: solved cleanly.'
    : last.gaveUp ? 'Last time: the answer was asked for.' : 'Last time: not solved.'
  return `${solved} of ${record.attempts.length} ${record.attempts.length === 1 ? 'attempt' : 'attempts'} solved. ${lastWords}`
}

// ---------------------------------------------------------------- the collection

export const PUZZLE_STORE_VERSION = 1

export interface PuzzleStore {
  version: number
  puzzles: readonly Puzzle[]
  records: Readonly<Record<string, PuzzleRecord>>
  /** The daily challenge fixed for each local day, as YYYY-MM-DD to a puzzle id. Written once, never changed. */
  daily: Readonly<Record<string, string>>
  person: PersonRating
}

export function emptyStore(): PuzzleStore {
  return { version: PUZZLE_STORE_VERSION, puzzles: [], records: {}, daily: {}, person: newPersonRating() }
}

export function findPuzzle(store: PuzzleStore, id: string): Puzzle | null {
  return store.puzzles.find((one) => one.id === id) ?? null
}

export function recordFor(store: PuzzleStore, id: string): PuzzleRecord | undefined {
  return store.records[id]
}

/**
 * Puzzles added to the collection, with the ones already there left alone.
 *
 * Added by id: making the same puzzle twice from the same moment of the same game produces the same id, so a second
 * pass over a game does not fill the collection with copies.
 */
export function addPuzzles(store: PuzzleStore, puzzles: readonly Puzzle[]): { store: PuzzleStore; added: number; alreadyHere: number } {
  const have = new Set(store.puzzles.map((one) => one.id))
  const fresh = puzzles.filter((one) => !have.has(one.id))
  return {
    store: fresh.length === 0 ? store : { ...store, puzzles: [...store.puzzles, ...fresh] },
    added: fresh.length,
    alreadyHere: puzzles.length - fresh.length
  }
}

export function removePuzzle(store: PuzzleStore, id: string): PuzzleStore {
  if (!store.puzzles.some((one) => one.id === id)) return store
  const records = { ...store.records }
  delete records[id]
  // The day's choice stays: a day that has been fixed is not unfixed by the puzzle going away, and `dailyFor` says
  // plainly that the puzzle is gone rather than quietly picking another one.
  return { ...store, puzzles: store.puzzles.filter((one) => one.id !== id), records }
}

export interface AttemptRecorded {
  store: PuzzleStore
  rating: RatingUpdate
  puzzleRating: PuzzleRatingUpdate
  /** False when the puzzle is not in the collection, in which case nothing was recorded. */
  ok: boolean
  says: string
}

/**
 * One finished attempt written into the collection.
 *
 * Everything that follows from an attempt happens here and in one place: the record, the person's figure, the
 * puzzle's own figure. `day` is passed in only when this attempt was that day's challenge, which is what makes a
 * streak a record of real completions rather than of app launches.
 */
export function recordAttempt(store: PuzzleStore, performance: Performance, now: number, day?: string): AttemptRecorded {
  const puzzle = findPuzzle(store, performance.exerciseId)
  if (!puzzle) {
    return {
      store,
      rating: { person: store.person, step: null, measured: false, score: { score: 0, rule: '', says: '' }, says: 'Nothing was recorded.' },
      puzzleRating: { state: { puzzleId: performance.exerciseId, rating: null, from: null, attempts: 0 }, measured: false, says: 'Nothing was recorded.' },
      ok: false,
      says: 'That puzzle is not in this collection, so the attempt was not recorded.'
    }
  }
  const held = store.records[puzzle.id] ?? { puzzleId: puzzle.id, attempts: [] }
  const attempt: PuzzleAttempt = { ...performance, ...(day ? { day } : {}) }
  const rating = rateAttempt(store.person, { id: puzzle.id, rating: puzzle.rating }, performance, now)
  const before: PuzzleRatingState = { puzzleId: puzzle.id, rating: puzzle.rating, from: puzzle.ratingFrom, attempts: held.attempts.length }
  const puzzleRating = ratePuzzleFromAttempt(before, store.person, performance)
  return {
    store: {
      ...store,
      puzzles: store.puzzles.map((one) => (one.id === puzzle.id ? { ...one, rating: puzzleRating.state.rating, ratingFrom: puzzleRating.state.from } : one)),
      records: { ...store.records, [puzzle.id]: { puzzleId: puzzle.id, attempts: [...held.attempts, attempt] } },
      person: rating.person
    },
    rating,
    puzzleRating,
    ok: true,
    says: rating.says
  }
}

// ---------------------------------------------------------------- reading a stored collection

export type StoreRead =
  /** There was nothing stored. Safe to start from empty and safe to write. */
  | { kind: 'empty'; store: PuzzleStore; says: string }
  /** It was read. `dropped` lists what could not be read inside it, which is not the same as it being absent. */
  | { kind: 'ok'; store: PuzzleStore; dropped: readonly string[]; says: string }
  /**
   * Something is stored and it cannot be read.
   *
   * The caller must **not** write over it. Every store Orbis has ever got wrong has got it wrong here: it treated
   * "I cannot read this" as "there is nothing here", wrote its defaults on top, and the real data was gone.
   */
  | { kind: 'unreadable'; says: string }

function readPuzzle(value: unknown, dropped: string[], at: number): Puzzle | null {
  if (typeof value !== 'object' || value === null) { dropped.push(`Entry ${at} is not a puzzle.`); return null }
  const row = value as Partial<Puzzle>
  const exercise = row.exercise
  if (typeof row.id !== 'string' || !row.id || typeof exercise !== 'object' || exercise === null) {
    dropped.push(`Entry ${at} has no id or no exercise.`)
    return null
  }
  if (typeof exercise.startFen !== 'string' || !playablePosition(exercise.startFen).ok) {
    dropped.push(`"${row.id}" has a position that cannot be used, so it was left out.`)
    return null
  }
  const themes: ThemeClaim[] = []
  for (const claim of Array.isArray(row.themes) ? row.themes : []) {
    if (typeof claim !== 'object' || claim === null) continue
    const one = claim as Partial<ThemeClaim>
    if (typeof one.theme !== 'string' || !(PUZZLE_THEMES as readonly string[]).includes(one.theme)) continue
    const evidence: ThemeEvidence = one.evidence === 'checked' || one.evidence === 'source' || one.evidence === 'convention' ? one.evidence : 'claimed'
    themes.push({ theme: one.theme as PuzzleTheme, evidence, says: typeof one.says === 'string' && one.says ? one.says : 'No reason was recorded.', ...(typeof one.by === 'string' ? { by: one.by } : {}) })
  }
  return {
    id: row.id,
    exercise: exercise as Exercise,
    themes: dedupeClaims(themes),
    rating: typeof row.rating === 'number' && Number.isFinite(row.rating) ? Math.round(row.rating) : null,
    ratingFrom: row.ratingFrom === 'source' || row.ratingFrom === 'measured' ? row.ratingFrom : null,
    addedAt: typeof row.addedAt === 'number' && Number.isFinite(row.addedAt) ? row.addedAt : 0
  }
}

/**
 * A stored collection read back, with "could not be read" kept apart from "was not there".
 *
 * `raw` is whatever came out of storage: null or an empty string for nothing, a string of JSON, or an already-parsed
 * object. Anything present that cannot be understood comes back as `unreadable`, and the caller is expected to leave
 * it where it is and say so.
 */
export function readStore(raw: unknown): StoreRead {
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
    return { kind: 'empty', store: emptyStore(), says: 'Nothing has been stored yet.' }
  }
  let value: unknown = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      return { kind: 'unreadable', says: 'There is something stored here and it is not readable as JSON. It has been left exactly as it is; nothing has been written over it.' }
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { kind: 'unreadable', says: 'There is something stored here and it is not a puzzle collection. It has been left exactly as it is.' }
  }
  const row = value as Partial<PuzzleStore> & { version?: unknown }
  if (row.version !== undefined && typeof row.version !== 'number') {
    return { kind: 'unreadable', says: 'There is something stored here whose version is not a number, so it cannot be read safely. It has been left exactly as it is.' }
  }
  if (typeof row.version === 'number' && row.version > PUZZLE_STORE_VERSION) {
    return { kind: 'unreadable', says: `This collection was written by a newer version of Orbis (${row.version}, and this one reads ${PUZZLE_STORE_VERSION}). It has been left exactly as it is rather than read wrongly.` }
  }
  if (!Array.isArray(row.puzzles)) {
    return { kind: 'unreadable', says: 'There is something stored here with no list of puzzles in it, so it is not a collection this version wrote. It has been left exactly as it is.' }
  }

  const dropped: string[] = []
  const puzzles: Puzzle[] = []
  for (const [at, entry] of row.puzzles.entries()) {
    const puzzle = readPuzzle(entry, dropped, at)
    if (puzzle) puzzles.push(puzzle)
  }
  const ids = new Set(puzzles.map((one) => one.id))

  const records: Record<string, PuzzleRecord> = {}
  const rawRecords = typeof row.records === 'object' && row.records !== null ? (row.records as Record<string, unknown>) : {}
  for (const [id, entry] of Object.entries(rawRecords)) {
    if (typeof entry !== 'object' || entry === null) { dropped.push(`The history for "${id}" could not be read.`); continue }
    const list = (entry as { attempts?: unknown }).attempts
    if (!Array.isArray(list)) { dropped.push(`The history for "${id}" has no attempts in it.`); continue }
    const attempts: PuzzleAttempt[] = []
    for (const one of list) {
      if (typeof one !== 'object' || one === null) continue
      const a = one as Partial<PuzzleAttempt>
      if (typeof a.at !== 'number' || !Number.isFinite(a.at)) continue
      attempts.push({
        exerciseId: typeof a.exerciseId === 'string' ? a.exerciseId : id,
        solved: a.solved === true,
        gaveUp: a.gaveUp === true,
        hintsUsed: typeof a.hintsUsed === 'number' ? a.hintsUsed : 0,
        worth: typeof a.worth === 'number' ? a.worth : 0,
        wrongMoves: typeof a.wrongMoves === 'number' ? a.wrongMoves : 0,
        illegalTries: typeof a.illegalTries === 'number' ? a.illegalTries : 0,
        seconds: typeof a.seconds === 'number' ? a.seconds : 0,
        at: a.at,
        ...(typeof a.day === 'string' && isDay(a.day) ? { day: a.day } : {})
      })
    }
    // A history for a puzzle that is no longer here is kept rather than thrown away: the puzzle may come back, and
    // deleting somebody's record of their own attempts is not a repair.
    records[id] = { puzzleId: id, attempts }
    if (!ids.has(id)) dropped.push(`There is a history for "${id}", which is not in the collection. It has been kept.`)
  }

  const daily: Record<string, string> = {}
  const rawDaily = typeof row.daily === 'object' && row.daily !== null ? (row.daily as Record<string, unknown>) : {}
  for (const [day, id] of Object.entries(rawDaily)) {
    if (!isDay(day) || typeof id !== 'string' || !id) { dropped.push(`The daily challenge recorded for "${day}" could not be read.`); continue }
    daily[day] = id
  }

  const rawPerson = typeof row.person === 'object' && row.person !== null ? (row.person as Partial<PersonRating>) : null
  const person: PersonRating = rawPerson && typeof rawPerson.rating === 'number' && Number.isFinite(rawPerson.rating)
    ? {
        rating: Math.round(rawPerson.rating),
        attempts: typeof rawPerson.attempts === 'number' ? rawPerson.attempts : 0,
        finished: typeof rawPerson.finished === 'number' ? rawPerson.finished : 0,
        unmeasured: typeof rawPerson.unmeasured === 'number' ? rawPerson.unmeasured : 0,
        lastAt: typeof rawPerson.lastAt === 'number' ? rawPerson.lastAt : null,
        history: Array.isArray(rawPerson.history) ? rawPerson.history : []
      }
    : newPersonRating()
  if (row.person !== undefined && !rawPerson) dropped.push('The rating could not be read, so it has started again.')

  return {
    kind: 'ok',
    store: { version: PUZZLE_STORE_VERSION, puzzles, records, daily, person },
    dropped: Object.freeze(dropped),
    says: dropped.length === 0
      ? `${puzzles.length} ${puzzles.length === 1 ? 'puzzle' : 'puzzles'} read.`
      : `${puzzles.length} ${puzzles.length === 1 ? 'puzzle' : 'puzzles'} read, and ${dropped.length} ${dropped.length === 1 ? 'thing' : 'things'} in the file could not be: ${dropped[0]}`
  }
}

/** The collection as something that can be stored. Nothing is computed here; it is the store as it stands. */
export function writeStore(store: PuzzleStore): PuzzleStore {
  return { ...store, version: PUZZLE_STORE_VERSION }
}

// ---------------------------------------------------------------- the local day

/** Whether a string is a local day the way this file writes them. */
export function isDay(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
  const [y, m, d] = text.split('-').map(Number)
  if (m < 1 || m > 12 || d < 1 || d > 31) return false
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

/**
 * The local day a moment falls in, as YYYY-MM-DD.
 *
 * `offsetMinutes` is what `Date.prototype.getTimezoneOffset` gives: the minutes to add to local time to get UTC.
 * It is an argument because this file has no clock and no timezone -- the caller knows where it is and this does not.
 */
export function dayKey(now: number, offsetMinutes: number): string {
  const shifted = new Date(now - offsetMinutes * 60_000)
  return shifted.toISOString().slice(0, 10)
}

/** The day before, as YYYY-MM-DD. Calendar arithmetic, done in UTC on a date with no time in it. */
export function previousDay(day: string): string {
  if (!isDay(day)) return day
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

/** How many days between two days, which may be negative. */
export function daysBetween(from: string, to: string): number | null {
  if (!isDay(from) || !isDay(to)) return null
  const at = (day: string): number => {
    const [y, m, d] = day.split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((at(to) - at(from)) / 86_400_000)
}

// ---------------------------------------------------------------- the daily challenge

/** A small, stable, non-cryptographic hash. It names a day's choice; it does not protect one. */
function hashOf(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0
  return h >>> 0
}

/** Puzzles that may be put in front of somebody as the day's challenge: answered with moves, and not rejected. */
export function dailyEligible(puzzles: readonly Puzzle[]): { verified: Puzzle[]; checkedOnly: Puzzle[] } {
  const usable = puzzles.filter((one) =>
    one.exercise.objective !== 'answer'
    && one.exercise.solution.lines.length > 0
    && one.exercise.verification.status !== 'rejected')
  return {
    verified: usable.filter((one) => one.exercise.verification.status === 'verified'),
    checkedOnly: usable.filter((one) => one.exercise.verification.status !== 'verified')
  }
}

/**
 * The day's choice from a pool, by a hash of the date.
 *
 * Deterministic, which is necessary but on its own not enough: the pool grows as puzzles are made, so this is only
 * ever used to make the choice *once*. `dailyFor` is what callers use.
 */
export function pickDaily(puzzles: readonly Puzzle[], day: string): string | null {
  const pool = [...puzzles].sort((a, b) => a.id.localeCompare(b.id))
  if (pool.length === 0) return null
  return pool[hashOf(day) % pool.length].id
}

export interface Daily {
  day: string
  /** Null when there was nothing to pick from. */
  puzzleId: string | null
  puzzle: Puzzle | null
  /** The store with the day's choice written into it. Pass this on, or the choice is not fixed. */
  store: PuzzleStore
  /** True when the choice was already written down, so this call did not make it. */
  wasFixed: boolean
  /** False when the pool had nothing fully checked in it, and the day's puzzle still needs an engine. */
  fromVerified: boolean
  /** True when the day's choice points at a puzzle that is no longer in the collection. */
  gone: boolean
  says: string
}

/**
 * The challenge for a local day, fixed the first time it is asked and the same ever afterwards.
 *
 * This is the whole of "cannot be rerolled by reopening the app". The hash makes the *first* choice; the record in
 * `store.daily` makes it the only one. Making more puzzles afterwards does not change today, and neither does
 * closing the app, because the choice is not recomputed -- it is read.
 */
export function dailyFor(store: PuzzleStore, day: string): Daily {
  const recorded = store.daily[day]
  if (recorded) {
    const puzzle = findPuzzle(store, recorded)
    return {
      day,
      puzzleId: recorded,
      puzzle,
      store,
      wasFixed: true,
      fromVerified: puzzle?.exercise.verification.status === 'verified',
      gone: puzzle === null,
      says: puzzle
        ? 'Today’s puzzle was chosen the first time you opened this today. It does not change.'
        : 'Today’s puzzle was chosen earlier and is no longer in your collection. Nothing has been chosen in its place, because the day is already settled.'
    }
  }
  const pools = dailyEligible(store.puzzles)
  const fromVerified = pools.verified.length > 0
  const pool = fromVerified ? pools.verified : pools.checkedOnly
  const puzzleId = pickDaily(pool, day)
  if (puzzleId === null) {
    return {
      day,
      puzzleId: null,
      puzzle: null,
      store,
      wasFixed: false,
      fromVerified: false,
      gone: false,
      says: 'There is nothing to choose from. Make some puzzles from your own games and there will be one tomorrow — and today.'
    }
  }
  return {
    day,
    puzzleId,
    puzzle: findPuzzle(store, puzzleId),
    store: { ...store, daily: { ...store.daily, [day]: puzzleId } },
    wasFixed: false,
    fromVerified,
    gone: false,
    says: fromVerified
      ? 'Chosen for today, and now fixed. Reopening Orbis will not change it.'
      : 'Chosen for today, and now fixed. Nothing in your collection has been fully checked yet, so this one still needs an engine to settle.'
  }
}

// ---------------------------------------------------------------- streaks

export interface Streak {
  /** Days in a row up to today, counting today only once it has been done. */
  current: number
  longest: number
  /** True when today's challenge has been finished successfully. */
  todayDone: boolean
  /** True when the run is alive but today is still to do. */
  aliveButUndone: boolean
  /** The days that were really completed, newest first. */
  days: readonly string[]
  says: string
}

/**
 * The streak, from completions that really happened.
 *
 * A day counts when the puzzle recorded as that day's challenge has an attempt **tagged with that day** that counts
 * as a solve. Tagging the attempt rather than the date it was recorded is what stops a streak growing for days when
 * nothing was attempted, and the attempt having to count is what stops it growing from a solve with the answer on
 * screen.
 */
export function dailyStreak(store: PuzzleStore, today: string): Streak {
  const done = new Set<string>()
  for (const [day, puzzleId] of Object.entries(store.daily)) {
    if (!isDay(day)) continue
    const record = store.records[puzzleId]
    if (!record) continue
    if (record.attempts.some((attempt) => attempt.day === day && counts(attempt))) done.add(day)
  }
  const days = [...done].sort().reverse()
  const todayDone = done.has(today)

  let current = 0
  let walk = todayDone ? today : previousDay(today)
  while (done.has(walk)) {
    current += 1
    walk = previousDay(walk)
  }

  let longest = 0
  let run = 0
  let previous: string | null = null
  for (const day of [...done].sort()) {
    run = previous !== null && daysBetween(previous, day) === 1 ? run + 1 : 1
    longest = Math.max(longest, run)
    previous = day
  }

  return {
    current,
    longest,
    todayDone,
    aliveButUndone: !todayDone && current > 0,
    days: Object.freeze(days),
    says: done.size === 0
      ? 'No daily challenges finished yet.'
      : todayDone
        ? `${current} ${current === 1 ? 'day' : 'days'} in a row, today included. Longest run: ${longest}.`
        : current > 0
          ? `${current} ${current === 1 ? 'day' : 'days'} in a row up to yesterday. Today is still to do. Longest run: ${longest}.`
          : `${done.size} ${done.size === 1 ? 'day' : 'days'} finished altogether, and not one in a row at the moment. Longest run: ${longest}.`
  }
}

export type DayState =
  /** That day's challenge was chosen and really solved. */
  | 'done'
  /** It was chosen and not solved. */
  | 'missed'
  /** Nothing was chosen that day, because Orbis was not opened. Not the same as having missed it. */
  | 'nothing'

export interface DayMark {
  day: string
  state: DayState
  says: string
}

/**
 * The last few days, each one saying which of three things it was.
 *
 * The third state is the whole point. A day with no challenge recorded is a day Orbis was never opened, and showing
 * that as a miss would tell somebody they failed something that was never put in front of them. `dailyFor` only
 * fixes a day when it is asked, so gaps in the record are gaps in the record and are drawn as such.
 *
 * Newest first, and `days` is held to something a strip can actually show.
 */
export function recentDays(store: PuzzleStore, today: string, days = 7): DayMark[] {
  const out: DayMark[] = []
  let day = today
  for (let back = 0; back < Math.max(1, Math.min(60, Math.trunc(days))); back++) {
    const puzzleId = store.daily[day]
    if (puzzleId === undefined) {
      out.push({ day, state: 'nothing', says: `${day}: nothing was chosen, because Orbis was not opened that day.` })
    } else {
      const record = store.records[puzzleId]
      const solved = Boolean(record?.attempts.some((attempt) => attempt.day === day && counts(attempt)))
      out.push({
        day,
        state: solved ? 'done' : 'missed',
        says: solved ? `${day}: solved.` : `${day}: chosen, and not solved.`
      })
    }
    day = previousDay(day)
  }
  return out
}

// ---------------------------------------------------------------- filtering

export interface PuzzleFilter {
  /** Any one of these is enough. Empty or absent means every theme. */
  themes?: readonly PuzzleTheme[]
  /** True to count only themes a check proved, so a source's word does not satisfy a theme filter. */
  onlyCheckedThemes?: boolean
  ratingFrom?: number
  ratingTo?: number
  /**
   * What to do with puzzles nobody has rated, which is most of them.
   *
   * With no rating band asked for they are kept, unless this is explicitly false. With a band asked for they are
   * left out unless this is explicitly true -- "rated 1400 to 1799" says nothing at all about a puzzle with no
   * rating, and quietly including it would be answering a question that was not asked.
   */
  includeUnrated?: boolean
  status?: readonly PuzzleStatus[]
  verification?: readonly Verification['status'][]
  source?: readonly Provenance['kind'][]
  /** Only puzzles made from this game. */
  fromGameId?: string
  /** Matched against the prompt, the lesson, the theme names and the source's game names. */
  text?: string
}

export const EMPTY_PUZZLE_FILTER: PuzzleFilter = Object.freeze({})

export function filterIsEmpty(filter: PuzzleFilter): boolean {
  return !(filter.themes?.length)
    && filter.ratingFrom === undefined
    && filter.ratingTo === undefined
    && filter.includeUnrated !== false
    && !(filter.status?.length)
    && !(filter.verification?.length)
    && !(filter.source?.length)
    && filter.fromGameId === undefined
    && !(filter.text ?? '').trim()
}

/** Everything a text search looks at. */
export function puzzleText(puzzle: Puzzle): string {
  const game = puzzle.exercise.source.game
  return [
    puzzle.exercise.prompt,
    puzzle.exercise.lesson ?? '',
    puzzle.exercise.source.note ?? '',
    puzzle.exercise.source.by ?? '',
    game?.white ?? '', game?.black ?? '', game?.event ?? '', game?.date ?? '',
    ...puzzle.themes.map((claim) => THEME_LABEL[claim.theme]),
    ...puzzle.exercise.tags
  ].join(' ').toLowerCase()
}

export function matchesPuzzle(puzzle: Puzzle, record: PuzzleRecord | undefined, filter: PuzzleFilter): boolean {
  if (filter.themes?.length) {
    const have = new Set(themeNames(puzzle, filter.onlyCheckedThemes === true))
    if (!filter.themes.some((theme) => have.has(theme))) return false
  }
  const bandAsked = filter.ratingFrom !== undefined || filter.ratingTo !== undefined
  if (puzzle.rating === null) {
    // A band says nothing about a puzzle with no rating, so a band leaves it out unless it was asked for by name.
    if (bandAsked ? filter.includeUnrated !== true : filter.includeUnrated === false) return false
  } else if (bandAsked) {
    if (filter.ratingFrom !== undefined && puzzle.rating < filter.ratingFrom) return false
    if (filter.ratingTo !== undefined && puzzle.rating > filter.ratingTo) return false
  }
  if (filter.status?.length && !filter.status.includes(statusOf(record))) return false
  if (filter.verification?.length && !filter.verification.includes(puzzle.exercise.verification.status)) return false
  if (filter.source?.length && !filter.source.includes(puzzle.exercise.source.kind)) return false
  if (filter.fromGameId !== undefined && !(puzzle.exercise.tags.includes(gameTag(filter.fromGameId)))) return false
  const text = (filter.text ?? '').trim().toLowerCase()
  if (text) {
    const haystack = puzzleText(puzzle)
    if (!text.split(/\s+/).every((word) => haystack.includes(word))) return false
  }
  return true
}

/** The tag that records which saved game a puzzle came out of, so a filter can ask for it. */
export const GAME_TAG_PREFIX = 'game:'
export const gameTag = (gameId: string): string => `${GAME_TAG_PREFIX}${gameId}`
export const gameIdOf = (puzzle: Puzzle): string | null => {
  const tag = puzzle.exercise.tags.find((one) => one.startsWith(GAME_TAG_PREFIX))
  return tag ? tag.slice(GAME_TAG_PREFIX.length) : null
}

export function filterPuzzles(store: PuzzleStore, filter: PuzzleFilter): Puzzle[] {
  return store.puzzles.filter((puzzle) => matchesPuzzle(puzzle, store.records[puzzle.id], filter))
}

export interface Facet { value: string; label: string; count: number }

export interface PuzzleFacets {
  themes: readonly Facet[]
  statuses: readonly Facet[]
  verification: readonly Facet[]
  sources: readonly Facet[]
  /** The rating bands that really occur, and how many have no rating at all. */
  ratings: readonly Facet[]
  unrated: number
  total: number
}

export const RATING_BANDS: readonly { from: number; to: number; label: string }[] = Object.freeze([
  { from: 0, to: 999, label: 'Under 1000' },
  { from: 1000, to: 1399, label: '1000–1399' },
  { from: 1400, to: 1799, label: '1400–1799' },
  { from: 1800, to: 2199, label: '1800–2199' },
  { from: 2200, to: 9999, label: '2200 and up' }
])

/**
 * What is really in a collection.
 *
 * Only values that occur are returned. A filter bar built from `PUZZLE_THEMES` would show thirty-one themes with
 * zeroes beside them and tell somebody they own a stalemate puzzle they do not own.
 */
export function puzzleFacets(store: PuzzleStore): PuzzleFacets {
  const themes = new Map<PuzzleTheme, number>()
  const statuses = new Map<PuzzleStatus, number>()
  const verification = new Map<string, number>()
  const sources = new Map<string, number>()
  const bands = new Map<string, number>()
  let unrated = 0

  for (const puzzle of store.puzzles) {
    for (const theme of new Set(themeNames(puzzle))) themes.set(theme, (themes.get(theme) ?? 0) + 1)
    const status = statusOf(store.records[puzzle.id])
    statuses.set(status, (statuses.get(status) ?? 0) + 1)
    const v = puzzle.exercise.verification.status
    verification.set(v, (verification.get(v) ?? 0) + 1)
    const s = puzzle.exercise.source.kind
    sources.set(s, (sources.get(s) ?? 0) + 1)
    if (puzzle.rating === null) unrated += 1
    else {
      const band = RATING_BANDS.find((one) => puzzle.rating !== null && puzzle.rating >= one.from && puzzle.rating <= one.to)
      if (band) bands.set(band.label, (bands.get(band.label) ?? 0) + 1)
    }
  }

  const sourceWords: Readonly<Record<string, string>> = {
    authored: 'Written by hand', generated: 'Made by Orbis', imported: 'Brought in from a file', 'from-game': 'From one of your games'
  }
  const verificationWords: Readonly<Record<string, string>> = {
    verified: 'Checked', unverified: 'Not checked', rejected: 'Not usable'
  }

  return {
    themes: Object.freeze([...themes.entries()].map(([value, count]) => ({ value, label: THEME_LABEL[value], count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))),
    statuses: Object.freeze(PUZZLE_STATUSES.filter((one) => statuses.has(one)).map((one) => ({ value: one, label: STATUS_LABEL[one], count: statuses.get(one) ?? 0 }))),
    verification: Object.freeze([...verification.entries()].map(([value, count]) => ({ value, label: verificationWords[value] ?? value, count }))),
    sources: Object.freeze([...sources.entries()].map(([value, count]) => ({ value, label: sourceWords[value] ?? value, count }))),
    ratings: Object.freeze(RATING_BANDS.filter((one) => bands.has(one.label)).map((one) => ({ value: `${one.from}-${one.to}`, label: one.label, count: bands.get(one.label) ?? 0 }))),
    unrated,
    total: store.puzzles.length
  }
}

/** What a filter is asking for, in words, so a screen can show it and offer to take one part off. */
export function describePuzzleFilter(filter: PuzzleFilter): { key: keyof PuzzleFilter; words: string }[] {
  const out: { key: keyof PuzzleFilter; words: string }[] = []
  if (filter.themes?.length) out.push({ key: 'themes', words: filter.themes.map((one) => THEME_LABEL[one]).join(' or ') })
  if (filter.onlyCheckedThemes) out.push({ key: 'onlyCheckedThemes', words: 'themes Orbis has checked' })
  if (filter.ratingFrom !== undefined || filter.ratingTo !== undefined) {
    out.push({ key: 'ratingFrom', words: `rated ${filter.ratingFrom ?? 'anything'} to ${filter.ratingTo ?? 'anything'}` })
  }
  if (filter.includeUnrated === false) out.push({ key: 'includeUnrated', words: 'rated ones only' })
  if (filter.status?.length) out.push({ key: 'status', words: filter.status.map((one) => STATUS_LABEL[one]).join(' or ') })
  if (filter.verification?.length) out.push({ key: 'verification', words: filter.verification.join(' or ') })
  if (filter.source?.length) out.push({ key: 'source', words: filter.source.join(' or ') })
  if (filter.fromGameId) out.push({ key: 'fromGameId', words: 'one game' })
  if ((filter.text ?? '').trim()) out.push({ key: 'text', words: `“${(filter.text ?? '').trim()}”` })
  return out
}

export function withoutPart(filter: PuzzleFilter, key: keyof PuzzleFilter): PuzzleFilter {
  const next = { ...filter }
  delete next[key]
  if (key === 'ratingFrom') delete next.ratingTo
  return next
}

// ---------------------------------------------------------------- the review list

export interface Missed {
  puzzle: Puzzle
  record: PuzzleRecord
  /** When it last went wrong. */
  at: number
  /** True when it has been solved at some point, just not the last time. */
  solvedBefore: boolean
  tries: number
  says: string
}

/**
 * The puzzles to go back to: attempted, and the last attempt was not a solve that counted.
 *
 * Newest failure first, because the thing you got wrong five minutes ago is the one worth another look. Nothing is
 * added for a puzzle that has never been tried -- that is new material, which is not the same as a weakness.
 */
export function missedPuzzles(store: PuzzleStore): Missed[] {
  const out: Missed[] = []
  for (const puzzle of store.puzzles) {
    const record = store.records[puzzle.id]
    if (!record || record.attempts.length === 0) continue
    const last = record.attempts[record.attempts.length - 1]
    if (counts(last)) continue
    out.push({
      puzzle,
      record,
      at: last.at,
      solvedBefore: record.attempts.some(counts),
      tries: record.attempts.length,
      says: last.gaveUp
        ? 'The answer was asked for last time.'
        : last.solved
          ? 'Solved last time with the move on screen, which is not a solve.'
          : `Not solved last time${last.wrongMoves ? `, after ${last.wrongMoves} wrong ${last.wrongMoves === 1 ? 'move' : 'moves'}` : ''}.`
    })
  }
  return out.sort((a, b) => b.at - a.at || a.puzzle.id.localeCompare(b.puzzle.id))
}

// ---------------------------------------------------------------- saying where a puzzle came from

/** Where a puzzle came from, in words, with nothing filled in that the record does not say. */
export function provenanceWords(puzzle: Puzzle): string {
  const source = puzzle.exercise.source
  const game = source.game
  if (source.kind === 'from-game' || source.kind === 'generated') {
    const who = game && (game.white || game.black) ? `${game.white ?? 'White'} against ${game.black ?? 'Black'}` : null
    const where = game?.event ? ` at ${game.event}` : ''
    const when = game?.date ? ` (${game.date})` : ''
    const at = game?.ply !== undefined ? `, after ${game.ply} ${game.ply === 1 ? 'move' : 'moves'}` : ''
    return who
      ? `From your game: ${who}${where}${when}${at}.`
      : `Made from one of your saved games${at}.`
  }
  if (source.kind === 'imported') return source.file ? `Brought in from ${source.file}.` : 'Brought in from a file.'
  if (source.kind === 'authored') return source.by ? `Written by ${source.by}.` : 'Written by hand.'
  return 'Where this came from was not recorded.'
}

/** A short line for a list row: what it asks, and how it stands. */
export function puzzleLine(puzzle: Puzzle, record: PuzzleRecord | undefined): string {
  const facts = puzzle.themes.filter(isFact).map((claim) => THEME_LABEL[claim.theme])
  const length = puzzle.themes.find((claim) => claim.theme === 'one-move' || claim.theme === 'short' || claim.theme === 'long')
  return [
    facts.length ? facts.join(', ') : 'Not classified',
    length ? THEME_LABEL[length.theme].toLowerCase() : '',
    puzzle.rating === null ? 'no rating' : `rated ${puzzle.rating}`,
    STATUS_LABEL[statusOf(record)].toLowerCase()
  ].filter(Boolean).join(' · ')
}

/** The default failure conditions for a puzzle: two wrong moves forgiven, so feedback has somewhere to happen. */
export const PUZZLE_FAILURE = Object.freeze([{ kind: 'wrong-moves' as const, allowed: 2 }])

/** The strict ones, for a daily challenge or anything that asks for it first time. */
export const PUZZLE_FAILURE_STRICT = STRICT_FAILURE

/** Whose puzzle it is, from the position. Convenience so a screen does not reach past this file for it. */
export const solverOf = (puzzle: Puzzle): Side => sideToMove(puzzle.exercise.startFen)
