import { applyMove, outcome, boardSquares, type PieceLetter } from './rules.ts'
import { classify, lossFrom, formatScore, type MoveClass, type Score, type Side } from './evaluation.ts'

/**
 * What the opponent says while you play.
 *
 * The whole of this module exists to make one thing impossible: a remark that sounds like chess and is not true of
 * the game in front of you. A commentary line is the easiest place in a chess program to lie, because the words
 * read perfectly whether or not anything behind them happened -- "nice fork!" after a move that forks nothing is
 * indistinguishable, to the person reading it, from the real thing. So:
 *
 * **A remark may only say what something else established.** Two sources, and only two. The board, read through
 * `rules.ts` -- this move was a capture, this is check, this is mate, the game is drawn by repetition. Or a real
 * engine evaluation that was actually made, judged through `evaluation.ts`. There is no third source, and in
 * particular there is no pattern matching that names a tactic: nothing here says fork, pin, skewer, trap or
 * sacrifice, because nothing here can see one.
 *
 * **Every remark carries its evidence.** `facts` lists the keys the words leaned on, each of them independently
 * checkable against the position. A test re-derives every one of them from the rules and refuses any phrasing
 * whose words claim more than the keys do. That is the only reason the phrasings below can be trusted: not
 * because they were written carefully, but because they cannot pass the guard if they overreach.
 *
 * **With nothing to go on it stays quiet.** No engine evaluation means no judgement of the move -- not a hedged
 * one, none. The remark then speaks only about what the board plainly shows, and when the board shows nothing
 * worth saying, there is no remark at all. Silence is a correct answer here and is used often.
 *
 * **Style changes the tone and how often, never the content.** The five styles below pick different words for the
 * same facts and speak at different rates. Not one of them can say something another cannot, because they all draw
 * from the same fact set (Sections 056, 057).
 */

export type CommentaryStyle = 'silent' | 'coach' | 'grandmaster' | 'rival' | 'tactical'

export interface CommentaryStyleInfo {
  id: CommentaryStyle
  name: string
  /** Said plainly on the setup screen. */
  about: string
  /**
   * How often it speaks: a remark is offered every `cadence` half-moves. Notable moves -- the end of the game,
   * mate, check, a move a real evaluation judged seriously wrong -- are never held back by the cadence.
   *
   * Always an odd number, which is not a detail. Half-moves alternate between the sides, so an even cadence lands
   * on the same colour for ever: a coach set to every second half-move would comment on every one of the engine's
   * moves and never once on yours.
   */
  cadence: number
  /** True when the style only speaks about concrete things: captures, checks, promotions, engine judgements. */
  concreteOnly: boolean
}

export const COMMENTARY_STYLES: readonly CommentaryStyleInfo[] = Object.freeze([
  Object.freeze({
    id: 'coach' as const,
    name: 'Friendly coach',
    about: 'Warm and frequent. Says what happened and what it means, and never pretends to see more than it does.',
    cadence: 3,
    concreteOnly: false
  }),
  Object.freeze({
    id: 'grandmaster' as const,
    name: 'Grandmaster',
    about: 'Formal and sparing. Speaks a few times a game, about the position rather than about you.',
    cadence: 11,
    concreteOnly: false
  }),
  Object.freeze({
    id: 'rival' as const,
    name: 'Witty rival',
    about: 'Needles you. Still only about things that really happened on the board.',
    cadence: 5,
    concreteOnly: false
  }),
  Object.freeze({
    id: 'tactical' as const,
    name: 'Tactical',
    about: 'Only the concrete: captures, checks, promotions, and what a real engine search said.',
    cadence: 1,
    concreteOnly: true
  }),
  Object.freeze({
    id: 'silent' as const,
    name: 'Silent',
    about: 'Nothing is said at all.',
    cadence: 0,
    concreteOnly: true
  })
])

export const styleInfo = (id: CommentaryStyle): CommentaryStyleInfo =>
  COMMENTARY_STYLES.find((one) => one.id === id) ?? COMMENTARY_STYLES[COMMENTARY_STYLES.length - 1]

// ---------------------------------------------------------------- what the board says

export const PIECE_NAME: Readonly<Record<PieceLetter, string>> = Object.freeze({
  k: 'king',
  q: 'queen',
  r: 'rook',
  b: 'bishop',
  n: 'knight',
  p: 'pawn'
})

/**
 * The ordinary teaching values, used for one thing only: saying how much material is on each side.
 *
 * These are not an evaluation and are never presented as one. "Three points of material ahead" is arithmetic over
 * the pieces on the board, which is checkable; "better" is a judgement, which only the engine may make here.
 */
export const PIECE_POINTS: Readonly<Record<PieceLetter, number>> = Object.freeze({ p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 })

export const MATERIAL_NOTE = 'Material is counted with the ordinary teaching values; it is not an engine evaluation.'

export interface MoveContext {
  /** The position the move was made in. */
  before: string
  /** The move in coordinates. It is replayed against `before`; a move that does not fit produces no remark at all. */
  uci: string
  /** The game's notation up to and including this move, so repetition and the fifty-move rule can be seen. */
  history?: readonly string[]
  /** Which move this is, counted in half-moves from the start of the game. Decides the cadence. */
  ply: number
}

export interface MoveFacts {
  /** Every fact as a key, so what a remark leaned on can be checked one at a time. */
  keys: readonly string[]
  san: string
  uci: string
  mover: Side
  piece: PieceLetter
  pieceName: string
  captured: PieceLetter | null
  capturedName: string | null
  check: boolean
  checkmate: boolean
  castle: 'k' | 'q' | null
  enPassant: boolean
  promotion: PieceLetter | null
  promotionName: string | null
  /** How the game ended on this move, when it did. */
  ended: { result: '1-0' | '0-1' | '1/2-1/2'; reason: 'checkmate' | 'stalemate' | 'insufficient-material' | 'threefold' | 'fifty-move' } | null
  /** Material in points after the move, White-positive. */
  material: number
  /** The position after the move. */
  after: string
  ply: number
}

/** Material in points, White-positive, counted off the board. */
export function materialOf(fen: string): number {
  let total = 0
  for (const square of boardSquares(fen)) {
    const points = PIECE_POINTS[square.type]
    total += square.color === 'w' ? points : -points
  }
  return total
}

/**
 * What is plainly true of a move, worked out rather than taken on trust.
 *
 * The move is replayed through the rules against the position it claims to have been made in. Null when it does
 * not fit: a remark about a move that cannot be played is worse than no remark.
 */
export function factsOf(move: MoveContext): MoveFacts | null {
  const played = applyMove(move.before, move.uci)
  if (!played) return null
  const history = move.history ? [...move.history] : []
  const state = outcome(played.after, history)
  const material = materialOf(played.after)
  const keys: string[] = [`piece:${played.piece}`, `mover:${played.color}`]
  if (played.captured) keys.push(`capture:${played.captured}`)
  if (played.special === 'k') keys.push('castle:k')
  if (played.special === 'q') keys.push('castle:q')
  if (played.special === 'e') keys.push('en-passant')
  if (played.promotion) keys.push(`promotion:${played.promotion}`)
  if (played.checkmate) keys.push('checkmate')
  else if (played.check) keys.push('check')
  if (state.over) {
    keys.push('ended', `ended:${state.reason}`, `result:${state.result}`)
  }
  if (material === 0) keys.push('material:level')
  else keys.push(`material:${material > 0 ? 'w' : 'b'}:${Math.abs(material)}`)
  return {
    keys: Object.freeze(keys),
    san: played.san,
    uci: played.uci,
    mover: played.color,
    piece: played.piece,
    pieceName: PIECE_NAME[played.piece],
    captured: played.captured ?? null,
    capturedName: played.captured ? PIECE_NAME[played.captured] : null,
    check: played.check && !played.checkmate,
    checkmate: played.checkmate,
    castle: played.special === 'k' ? 'k' : played.special === 'q' ? 'q' : null,
    enPassant: played.special === 'e',
    promotion: played.promotion ?? null,
    promotionName: played.promotion ? PIECE_NAME[played.promotion] : null,
    ended: state.over ? { result: state.result, reason: state.reason } : null,
    material,
    after: played.after,
    ply: move.ply
  }
}

// ---------------------------------------------------------------- what the engine said

export interface Judgement {
  /** A real engine score for the position before the move, White-positive. */
  before: Score
  /** A real engine score for the position after it, White-positive. */
  after: Score
  /** The depth the shallower of the two searches reached. A shallow search is not quoted as a verdict. */
  depth?: number
  /** True when the engine said the score was only a bound, so it is not settled and is not used. */
  bounded?: boolean
  /** The engine's own best move in the position before, when it was asked. Used only to say a move WAS the best. */
  bestUci?: string
}

export interface EngineFacts {
  keys: readonly string[]
  /** What the move was, named by `evaluation.ts`. `unclear` when the evidence does not support a name. */
  moveClass: MoveClass
  /** Centipawns given up, from the mover's point of view. Null when the two scores are not on one scale. */
  loss: number | null
  after: Score
  wasBest: boolean
  depth: number | null
  /** False when the judgement cannot be used: a bound, too shallow, or a missing score. Then nothing is said about it. */
  usable: boolean
}

/** The depth below which an engine's opinion is not quoted as a judgement. The same floor `classify` uses. */
export const MIN_JUDGEMENT_DEPTH = 8

export function engineFactsOf(judgement: Judgement | undefined, mover: Side, uci: string): EngineFacts | null {
  if (!judgement) return null
  const depth = typeof judgement.depth === 'number' ? judgement.depth : null
  const bounded = judgement.bounded === true
  const scored = judgement.before.kind !== 'none' && judgement.after.kind !== 'none'
  const deepEnough = depth === null ? false : depth >= MIN_JUDGEMENT_DEPTH
  const usable = scored && !bounded && deepEnough
  const moveClass = usable
    ? classify(judgement.before, judgement.after, mover, { depth: depth ?? undefined, minDepth: MIN_JUDGEMENT_DEPTH })
    : 'unclear'
  const loss = usable ? lossFrom(judgement.before, judgement.after, mover) : null
  const wasBest = usable && typeof judgement.bestUci === 'string' && judgement.bestUci === uci
  const keys: string[] = []
  if (usable) {
    keys.push('engine', `class:${moveClass}`, `depth:${depth ?? 0}`)
    if (loss !== null) keys.push(`loss:${loss}`)
    if (wasBest) keys.push('engine-best')
    if (judgement.after.kind === 'mate') keys.push('engine-mate')
    if (judgement.after.kind === 'cp') keys.push('engine-cp')
  }
  return {
    keys: Object.freeze(keys),
    moveClass,
    loss,
    after: judgement.after,
    wasBest,
    depth,
    usable
  }
}

// ---------------------------------------------------------------- a remark

export interface CommentaryInput {
  move: MoveContext
  /** Which side the person is playing, so a remark can be addressed to them rather than about them. */
  human: Side
  /** A real engine judgement of this move, when one was made. Absent means the board is the only source. */
  judgement?: Judgement
}

export interface Remark {
  text: string
  /** `board` when the words rest only on the rules; `engine` when a real evaluation was used. */
  from: 'board' | 'engine'
  /** The fact keys the words leaned on. Every one is checkable on its own. */
  facts: readonly string[]
  /** Which candidate produced it, for tests and for not repeating the same line twice in a row. */
  id: string
}

/** Who the remark is talking about. */
interface Voice {
  /** "you" / "I" -- the mover. */
  mover: string
  /** The mover as a possessive: "your" / "my". */
  moverOwns: string
  /** The side that did not move. */
  other: string
  otherOwns: string
  /** True when the person made the move. */
  byHuman: boolean
}

const voiceFor = (facts: MoveFacts, human: Side): Voice =>
  facts.mover === human
    ? { mover: 'you', moverOwns: 'your', other: 'I', otherOwns: 'my', byHuman: true }
    : { mover: 'I', moverOwns: 'my', other: 'you', otherOwns: 'your', byHuman: false }

interface Candidate {
  id: string
  /** Higher speaks first. */
  priority: number
  /** Fact keys that must all be present. A key ending in ':' matches any fact that starts with it. */
  needs: readonly string[]
  /** True when this candidate rests on a real engine evaluation. */
  engine?: boolean
  /** Extra conditions the keys cannot express. */
  when?: (f: MoveFacts, e: EngineFacts | null, v: Voice) => boolean
  /** One phrasing per style. A style with no phrasing does not say this at all. */
  say: Partial<Record<CommentaryStyle, readonly ((f: MoveFacts, e: EngineFacts | null, v: Voice) => string)[]>>
}

const has = (keys: readonly string[], need: string): boolean =>
  need.endsWith(':') ? keys.some((key) => key.startsWith(need)) : keys.includes(need)

const points = (n: number): string => `${n} point${n === 1 ? '' : 's'} of material`

const pawns = (cp: number): string => (cp / 100).toFixed(2)

/**
 * Everything that can be said, with what has to be true for it.
 *
 * Read it as a table of claims, not as prose. Each phrasing is allowed to mention exactly what its `needs` have
 * established and nothing else, and the guard in the tests holds it to that. Adding a line here means adding the
 * fact that proves it.
 */
const CANDIDATES: readonly Candidate[] = Object.freeze([
  // ---- the game is over. Always said, whatever the cadence, by every style that speaks at all.
  {
    id: 'mate-delivered',
    priority: 100,
    needs: ['checkmate', 'ended:checkmate'],
    say: {
      coach: [
        (f, _e, v) => `${v.mover === 'you' ? 'Checkmate — that is the game, and it is yours' : 'Checkmate. That is the game'}. ${f.san} ended it.`
      ],
      grandmaster: [(f) => `Checkmate. ${f.san} concludes the game.`],
      rival: [(f, _e, v) => (v.byHuman ? `Checkmate. Fine — ${f.san} did it. Again?` : `Checkmate, with ${f.san}. I enjoyed that.`)],
      tactical: [(f) => `Checkmate: ${f.san}.`]
    }
  },
  {
    id: 'stalemate',
    priority: 99,
    needs: ['ended:stalemate'],
    say: {
      coach: [() => 'Stalemate — no legal move and no check, so the game is drawn.'],
      grandmaster: [() => 'Stalemate. The game is drawn.'],
      rival: [() => 'Stalemate. Nobody gets anything. Typical.'],
      tactical: [() => 'Stalemate: drawn.']
    }
  },
  {
    id: 'draw-insufficient',
    priority: 99,
    needs: ['ended:insufficient-material'],
    say: {
      coach: [() => 'Drawn — there is not enough material left on the board for either side to force mate.'],
      grandmaster: [() => 'Drawn by insufficient material.'],
      rival: [() => 'Drawn. There is nothing left to mate with.'],
      tactical: [() => 'Drawn: insufficient material.']
    }
  },
  {
    id: 'draw-threefold',
    priority: 99,
    needs: ['ended:threefold'],
    say: {
      coach: [() => 'Drawn — that is the same position for the third time.'],
      grandmaster: [() => 'Drawn by threefold repetition.'],
      rival: [() => 'Third time in the same position. Drawn.'],
      tactical: [() => 'Drawn: threefold repetition.']
    }
  },
  {
    id: 'draw-fifty',
    priority: 99,
    needs: ['ended:fifty-move'],
    say: {
      coach: [() => 'Drawn — fifty moves each with nothing captured and no pawn moved.'],
      grandmaster: [() => 'Drawn by the fifty-move rule.'],
      rival: [() => 'Fifty moves of nothing. Drawn.'],
      tactical: [() => 'Drawn: fifty-move rule.']
    }
  },

  // ---- what a real engine search said about the move. Only with a settled, deep enough evaluation.
  {
    id: 'engine-missed-mate',
    priority: 90,
    needs: ['engine', 'class:missed-mate'],
    engine: true,
    say: {
      coach: [(_f, _e, v) => `There was a forced mate there and ${v.mover === 'you' ? 'you' : 'I'} played something else. The engine found it; worth looking at afterwards.`],
      grandmaster: [() => 'A forced mate was available and was not played.'],
      rival: [(_f, _e, v) => (v.byHuman ? 'A forced mate, and you walked past it.' : 'I had a forced mate and missed it. Embarrassing.')],
      tactical: [() => 'A forced mate was available in the position before this move.']
    }
  },
  {
    id: 'engine-blunder',
    priority: 88,
    needs: ['engine', 'class:blunder'],
    engine: true,
    when: (_f, e) => e !== null && e.loss !== null,
    say: {
      coach: [
        (_f, e, v) => `That gives up ${pawns(e?.loss ?? 0)} by the engine's count. Worth seeing why, once ${v.byHuman ? 'you have' : 'I have'} finished the game.`
      ],
      grandmaster: [(_f, e) => `A serious concession: ${pawns(e?.loss ?? 0)} by the engine's reckoning.`],
      rival: [(_f, e, v) => (v.byHuman ? `${pawns(e?.loss ?? 0)} handed over. Thank you.` : `I dropped ${pawns(e?.loss ?? 0)} there. Do not get used to it.`)],
      tactical: [(_f, e) => `Blunder by the engine's count: ${pawns(e?.loss ?? 0)} given up at depth ${e?.depth ?? 0}.`]
    }
  },
  {
    id: 'engine-mistake',
    priority: 80,
    needs: ['engine', 'class:mistake'],
    engine: true,
    when: (_f, e) => e !== null && e.loss !== null,
    say: {
      coach: [(_f, e) => `That costs about ${pawns(e?.loss ?? 0)} by the engine's count. There was something better.`],
      grandmaster: [(_f, e) => `Inexact: ${pawns(e?.loss ?? 0)} by the engine's reckoning.`],
      rival: [(_f, e, v) => (v.byHuman ? `About ${pawns(e?.loss ?? 0)} to me. Noted.` : `That cost me ${pawns(e?.loss ?? 0)}.`)],
      tactical: [(_f, e) => `Mistake: ${pawns(e?.loss ?? 0)} given up at depth ${e?.depth ?? 0}.`]
    }
  },
  {
    id: 'engine-best',
    priority: 60,
    needs: ['engine', 'engine-best'],
    engine: true,
    say: {
      coach: [(f, _e, v) => `${f.san} was the engine's first choice too${v.byHuman ? ' — well found' : ''}.`],
      grandmaster: [(f) => `${f.san} is the engine's own first choice.`],
      rival: [(f, _e, v) => (v.byHuman ? `${f.san}. Fine. The engine agrees with you. Once.` : `${f.san} — the first choice, naturally.`)],
      tactical: [(f, e) => `${f.san} is the engine's first choice at depth ${e?.depth ?? 0}.`]
    }
  },
  {
    id: 'engine-score',
    priority: 30,
    needs: ['engine', 'engine-cp'],
    engine: true,
    when: (_f, e) => e !== null && e.after.kind === 'cp' && Math.abs(e.after.cp) >= 150,
    say: {
      coach: [(f, e) => `The engine has this at ${formatScore(e?.after ?? { kind: 'none' }, f.mover === 'w' ? 'w' : 'b')} for ${f.mover === 'w' ? 'White' : 'Black'} at depth ${e?.depth ?? 0}.`],
      grandmaster: [(_f, e) => `The engine reads the position as ${formatScore(e?.after ?? { kind: 'none' })} at depth ${e?.depth ?? 0}.`],
      tactical: [(_f, e) => `Engine: ${formatScore(e?.after ?? { kind: 'none' })} at depth ${e?.depth ?? 0}.`]
    }
  },

  // ---- what the board plainly shows.
  {
    id: 'check',
    priority: 70,
    needs: ['check'],
    say: {
      coach: [(f, _e, v) => `${f.san} — check. ${v.other === 'you' ? 'Your' : 'My'} king has to answer that first.`],
      grandmaster: [(f) => `${f.san}, with check.`],
      rival: [(f, _e, v) => (v.byHuman ? `Check. All right, I will deal with it.` : `${f.san}. Check. Over to you.`)],
      tactical: [(f) => `${f.san}: check.`]
    }
  },
  {
    id: 'promotion',
    priority: 65,
    needs: ['promotion:'],
    say: {
      coach: [(f, _e, v) => `The pawn reaches the end and becomes a ${f.promotionName}. ${v.mover === 'you' ? 'That is' : 'That gives me'} a new piece.`],
      grandmaster: [(f) => `${f.san}: the pawn promotes to a ${f.promotionName}.`],
      rival: [(f, _e, v) => (v.byHuman ? `A new ${f.promotionName}. Lovely for you.` : `A new ${f.promotionName} for me.`)],
      tactical: [(f) => `${f.san}: promotion to a ${f.promotionName}.`]
    }
  },
  {
    id: 'capture-big',
    priority: 55,
    needs: ['capture:'],
    when: (f) => f.captured !== null && PIECE_POINTS[f.captured] >= 5,
    say: {
      coach: [(f, _e, v) => `${f.san} takes ${v.otherOwns} ${f.capturedName}. ${f.material === 0 ? 'Material is level now.' : `That leaves ${f.material > 0 ? 'White' : 'Black'} ${points(Math.abs(f.material))} ahead.`}`],
      grandmaster: [(f) => `${f.san}, taking the ${f.capturedName}.`],
      rival: [(f, _e, v) => (v.byHuman ? `My ${f.capturedName}. Noted.` : `Your ${f.capturedName}, thank you.`)],
      tactical: [(f) => `${f.san} takes the ${f.capturedName}.`]
    }
  },
  {
    id: 'capture',
    priority: 45,
    needs: ['capture:'],
    say: {
      coach: [(f, _e, v) => `${f.san} takes ${v.otherOwns} ${f.capturedName}.`],
      grandmaster: [(f) => `${f.san}, taking the ${f.capturedName}.`],
      rival: [(f, _e, v) => (v.byHuman ? `There goes my ${f.capturedName}.` : `Your ${f.capturedName} is mine.`)],
      tactical: [(f) => `${f.san} takes the ${f.capturedName}.`]
    }
  },
  {
    id: 'en-passant',
    priority: 50,
    needs: ['en-passant', 'capture:'],
    say: {
      coach: [(f) => `${f.san} — en passant. The pawn is taken on the square it passed over.`],
      grandmaster: [(f) => `${f.san}, en passant.`],
      rival: [(f) => `${f.san}. En passant. Somebody has been reading.`],
      tactical: [(f) => `${f.san}: en passant.`]
    }
  },
  {
    id: 'castle',
    priority: 40,
    needs: ['castle:'],
    say: {
      coach: [(f, _e, v) => `${v.mover === 'you' ? 'You castle' : 'I castle'} ${f.castle === 'k' ? 'short' : 'long'} — king and rook in one move, the only move that moves two pieces.`],
      grandmaster: [(f) => `Castling ${f.castle === 'k' ? 'short' : 'long'}.`],
      rival: [(f, _e, v) => (v.byHuman ? `Castled ${f.castle === 'k' ? 'short' : 'long'}. Sensible. Boring.` : `I castle ${f.castle === 'k' ? 'short' : 'long'}.`)],
      tactical: [(f) => `${f.san}: castles ${f.castle === 'k' ? 'short' : 'long'}.`]
    }
  },
  {
    id: 'material-level',
    priority: 20,
    needs: ['material:level'],
    when: (f) => f.captured !== null,
    say: {
      coach: [() => 'That makes material level.'],
      grandmaster: [() => 'Material is level.']
    }
  },
  {
    id: 'quiet-move',
    priority: 10,
    needs: ['piece:'],
    when: (f) => f.captured === null && !f.check && !f.checkmate && f.ended === null,
    say: {
      coach: [
        (f, _e, v) => `${f.san} — ${v.moverOwns} ${f.pieceName} moves, nothing taken.`,
        (f) => `${f.san}. A quiet ${f.pieceName} move.`
      ],
      grandmaster: [(f) => `${f.san}.`],
      rival: [(f, _e, v) => (v.byHuman ? `${f.san}. Thinking about it, are you.` : `${f.san}.`)]
    }
  }
])

/** Facts that make a move notable enough to be worth breaking the cadence for. */
const NOTABLE = Object.freeze(['checkmate', 'check', 'ended', 'class:blunder', 'class:mistake', 'class:missed-mate', 'promotion:'])

/** True when this move is one every speaking style comments on, whatever the cadence. */
export function notable(keys: readonly string[]): boolean {
  return NOTABLE.some((need) => has(keys, need))
}

/** True when the move has something concrete about it: a capture, a check, a castle, a promotion, an engine verdict. */
export function concrete(keys: readonly string[]): boolean {
  // The end of the game is as concrete as anything gets, which is why it is in this list.
  return ['capture:', 'check', 'checkmate', 'castle:', 'promotion:', 'en-passant', 'engine', 'ended'].some((need) => has(keys, need))
}

/**
 * Does this style speak about this move at all?
 *
 * Deliberately not random. A remark that appears or does not depending on a coin toss cannot be tested, and
 * cannot be explained to somebody who saw it once; the cadence is arithmetic on the move number, so the same game
 * always reads the same way.
 */
export function speaksAbout(style: CommentaryStyle, keys: readonly string[], ply: number): boolean {
  const info = styleInfo(style)
  if (info.cadence <= 0) return false
  if (info.concreteOnly && !concrete(keys)) return false
  if (notable(keys)) return true
  return ply > 0 && ply % info.cadence === 0
}

export interface RemarkOptions {
  /**
   * Which phrasing to take when a candidate has several. Defaults to the move number, so a game reads the same way
   * every time rather than differently on each replay.
   */
  phrasing?: number
  /** A remark this style just made. The same one is not made twice in a row. */
  last?: string | null
}

/**
 * What the opponent says about a move, or nothing.
 *
 * Nothing is the common answer, and it is the right one whenever the inputs do not support a sentence.
 */
export function remarkOn(input: CommentaryInput, style: CommentaryStyle, options: RemarkOptions = {}): Remark | null {
  if (style === 'silent') return null
  const facts = factsOf(input.move)
  // A move that cannot be played in the position it claims is not commented on at all.
  if (!facts) return null
  const engine = engineFactsOf(input.judgement, facts.mover, facts.uci)
  const keys = engine?.usable ? [...facts.keys, ...engine.keys] : [...facts.keys]
  if (!speaksAbout(style, keys, facts.ply)) return null
  const voice = voiceFor(facts, input.human)

  const usable = CANDIDATES.filter((candidate) => {
    const phrasings = candidate.say[style]
    if (!phrasings || phrasings.length === 0) return false
    // An engine candidate needs a usable engine judgement, never a hopeful one.
    if (candidate.engine === true && !(engine?.usable === true)) return false
    if (!candidate.needs.every((need) => has(keys, need))) return false
    if (candidate.when && !candidate.when(facts, engine, voice)) return false
    return true
  }).sort((a, b) => b.priority - a.priority)

  // The same line twice in a row says nothing the second time; the next best one does.
  const chosen = usable.find((candidate) => candidate.id !== options.last) ?? usable[0]
  if (!chosen) return null
  const phrasings = chosen.say[style]
  if (!phrasings || phrasings.length === 0) return null
  let index = Math.abs(Math.floor(options.phrasing ?? facts.ply)) % phrasings.length
  if (chosen.id === options.last) {
    /*
     * Nothing else fits and this was the last thing said.
     *
     * A different wording of it is still worth having -- "a quiet knight move" after "your knight moves" reads as
     * a conversation. The same sentence twice does not, so with only one wording it says nothing instead, unless
     * the move is one nobody may be left to notice on their own.
     */
    if (phrasings.length <= 1 && !notable(keys)) return null
    index = (index + 1) % phrasings.length
  }
  const text = phrasings[index](facts, engine, voice)

  /*
   * The evidence, narrowed to what this line actually leaned on.
   *
   * Not every fact about the move -- the ones its `needs` established, plus the material fact when the line quotes
   * a material count. A remark that listed every fact would pass a guard that only checks the facts are true, while
   * saying things none of them supports.
   */
  const cited = new Set<string>()
  for (const need of chosen.needs) {
    for (const key of keys) if (need.endsWith(':') ? key.startsWith(need) : key === need) cited.add(key)
  }
  if (/point[s]? of material|Material is level/.test(text)) {
    for (const key of keys) if (key.startsWith('material:')) cited.add(key)
  }
  if (chosen.engine === true || /engine/i.test(text)) {
    for (const key of keys) if (key.startsWith('class:') || key.startsWith('depth:') || key.startsWith('loss:') || key === 'engine' || key === 'engine-best' || key === 'engine-cp' || key === 'engine-mate') cited.add(key)
  }
  if (facts.san && text.includes(facts.san)) cited.add(`san:${facts.san}`)

  return {
    text,
    from: chosen.engine === true ? 'engine' : 'board',
    facts: Object.freeze([...cited]),
    id: chosen.id
  }
}

/**
 * The words no remark may use without the fact that proves them, checked by the tests.
 *
 * This is the list of ways a chess program lies. A tactic cannot be seen by anything in this module, so the first
 * group is simply forbidden: no phrasing above contains them, and the guard fails if one ever does. The rest are
 * allowed only where the matching evidence is present.
 */
export const FORBIDDEN_WORDS: readonly string[] = Object.freeze([
  'fork',
  'pin',
  'pinned',
  'skewer',
  'discovered',
  'trap',
  'sacrifice',
  'sacrificed',
  'brilliant',
  'brilliancy',
  'threat',
  'threatens',
  'attack on',
  'winning',
  'losing',
  'crushing',
  'equalised',
  'tempo',
  'initiative',
  'weak square',
  'outpost'
])

/** A claim and the fact key that has to be present for it to be made. */
export const CLAIM_EVIDENCE: readonly { phrase: string; needs: readonly string[] }[] = Object.freeze([
  { phrase: 'checkmate', needs: Object.freeze(['checkmate', 'ended:checkmate']) },
  { phrase: 'check', needs: Object.freeze(['check', 'checkmate']) },
  { phrase: 'stalemate', needs: Object.freeze(['ended:stalemate']) },
  { phrase: 'drawn', needs: Object.freeze(['ended:stalemate', 'ended:insufficient-material', 'ended:threefold', 'ended:fifty-move']) },
  { phrase: 'en passant', needs: Object.freeze(['en-passant']) },
  { phrase: 'promot', needs: Object.freeze(['promotion:']) },
  { phrase: 'castl', needs: Object.freeze(['castle:']) },
  { phrase: 'take', needs: Object.freeze(['capture:']) },
  { phrase: 'forced mate', needs: Object.freeze(['class:missed-mate', 'engine-mate']) },
  { phrase: 'of material', needs: Object.freeze(['material:']) },
  { phrase: 'engine', needs: Object.freeze(['engine']) },
  { phrase: 'depth', needs: Object.freeze(['depth:']) },
  { phrase: 'blunder', needs: Object.freeze(['class:blunder']) },
  { phrase: 'mistake', needs: Object.freeze(['class:mistake']) },
  { phrase: 'first choice', needs: Object.freeze(['engine-best']) }
])

/** Every phrasing in the table, for the guard to walk. Exported so a test can reach what is otherwise private. */
export function allPhrasings(): { id: string; style: CommentaryStyle; count: number }[] {
  const out: { id: string; style: CommentaryStyle; count: number }[] = []
  for (const candidate of CANDIDATES) {
    for (const info of COMMENTARY_STYLES) {
      const phrasings = candidate.say[info.id]
      if (phrasings && phrasings.length) out.push({ id: candidate.id, style: info.id, count: phrasings.length })
    }
  }
  return out
}
