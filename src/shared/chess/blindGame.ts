import { applyMove, boardSquares, sideToMove, type PieceLetter } from './rules.ts'
import { readMove, type ReadResult } from './calculation.ts'
import type { Side } from './evaluation.ts'

/**
 * A whole game with the board hidden (Section 225).
 *
 * The game itself is `arena.ts`: the same session, the same clock, the same engine, the same legal-move checking as
 * a normal game. **Nothing here plays chess.** This file answers three questions a hidden game raises that a normal
 * one does not, and `trainingView.ts` is the model for why they live in one place:
 *
 *   1. **May the board be drawn right now?** `gameView` is the only answer, exactly as `viewRules` is the only
 *      answer for the blindfold levels. A screen that drew the board and hid it with CSS has not hidden it: the
 *      position would be in the document, in the accessibility tree and in a screenshot.
 *
 *   2. **What was given away, and how much?** A look at the board is allowed in the modes that offer it, because a
 *      trainer that refuses to let somebody check is a trainer people stop using. What is not allowed is calling the
 *      game unassisted afterwards. Every look is counted and the count is carried with the result.
 *
 *   3. **What did they mean?** A move spoken or typed with no board in front of it is ambiguous far more often than
 *      one played with a mouse -- "Nd2" with two knights that can reach d2, "b4" with a bishop that can get there
 *      too. `readMove` already tells a notation mistake apart from a chess mistake, so this asks it and passes the
 *      question on. **A move is never guessed at.**
 *
 * Pure: no clock, no storage, no engine, no React.
 */

// ---------------------------------------------------------------- the modes

export type BlindGameMode =
  /** Nothing on screen but whose turn it is. The moves are announced as they are played and then they are gone. */
  | 'strict'
  /** The moves played are listed. How a blindfold game is played across a room: somebody reads the moves back. */
  | 'with-list'
  /** The list, and a button that shows the board while it is held. Every look is counted. */
  | 'with-looks'

export interface GameModeRules {
  id: BlindGameMode
  title: string
  /** What the mode is for, in a sentence. */
  asks: string
  /** Whether the moves played may be listed on screen. */
  moveList: boolean
  /** Whether a look at the board may be offered at all. */
  mayLook: boolean
}

export const GAME_MODES: readonly GameModeRules[] = Object.freeze([
  {
    id: 'strict',
    title: 'Nothing on screen',
    asks: 'The moves are announced as they happen and nothing is kept on screen. You hold the game in your head.',
    moveList: false,
    mayLook: false
  },
  {
    id: 'with-list',
    title: 'The moves listed',
    asks: 'The moves played are listed down the side, the way somebody reads them back to you across a room. The position is still yours to picture.',
    moveList: true,
    mayLook: false
  },
  {
    id: 'with-looks',
    title: 'The moves listed, and you can look',
    asks: 'The list, and a button that shows the board while you hold it. Every look is counted and said with the result.',
    moveList: true,
    mayLook: true
  }
])

export function gameMode(id: BlindGameMode): GameModeRules {
  return GAME_MODES.find((one) => one.id === id) ?? GAME_MODES[0]
}

// ---------------------------------------------------------------- the looks

export interface Looks {
  /** How many times the board was shown. */
  count: number
  /** The half-move each look was taken at, so a look can be put beside the move it helped with. */
  atPlies: readonly number[]
}

export const NO_LOOKS: Looks = Object.freeze({ count: 0, atPlies: Object.freeze([]) })

/** One more look. Append-only: a look taken cannot be taken back, which is the point of counting them. */
export function noteLook(looks: Looks, ply: number): Looks {
  return { count: looks.count + 1, atPlies: [...looks.atPlies, Math.max(0, Math.trunc(ply))] }
}

/**
 * Whether the game was played with nothing given away.
 *
 * Both halves matter. A game in `with-list` mode with no looks is still not unassisted: the list of moves is a
 * memory aid, and reading the moves back to somebody is an easier exercise than making them hold the line. So the
 * mode is part of the answer, not just the looks.
 */
export function unassisted(mode: BlindGameMode, looks: Looks): boolean {
  return mode === 'strict' && looks.count === 0
}

/** What the game established, in a sentence, so no screen has to work it out a second way. */
export function looksSay(mode: BlindGameMode, looks: Looks): string {
  const rules = gameMode(mode)
  if (looks.count > 0) {
    return `You looked at the board ${looks.count === 1 ? 'once' : `${looks.count} times`}, so this does not show that you held the game in your head all the way through.`
  }
  if (!rules.moveList) return 'Nothing was on screen and you did not look at the board. The whole game was held in your head.'
  return 'You did not look at the board. The moves played were listed, though, so remembering the order of them was not part of this.'
}

// ---------------------------------------------------------------- what may be on screen

export type GamePhase = 'setup' | 'playing' | 'over'

export interface GameView {
  /** The position to draw, or null when nothing may be drawn. A screen draws a board only when this is a string. */
  boardFen: string | null
  /** Why there is no board. Never names a square, a piece or a position. */
  because: string | null
  /** The label for the place the board would be. */
  label: string
  /** Whether the moves played may be listed. */
  moveList: boolean
  /** Whether a look button may be on screen at all. */
  lookButton: boolean
  /** Whether this game still counts as unassisted blindfold play. */
  clean: boolean
}

/**
 * Whether the board may be on screen, and what else may be.
 *
 * The one decision. A screen has no other way to get a position to draw, which is what makes "hidden" mean hidden
 * rather than mean "hidden in the four places somebody thought of".
 *
 * The board comes back when the game is over, because showing somebody the game they just played is the whole point
 * of the end of it, and the result is already settled by then. It comes back while a look is being held, in the mode
 * that offers looks -- and the look is counted by the caller before it asks, so a screen cannot show the board and
 * forget to record it.
 */
export function gameView(input: {
  mode: BlindGameMode
  phase: GamePhase
  /** True only while a look is actually being held down. */
  looking: boolean
  fen: string
  looks: Looks
}): GameView {
  const rules = gameMode(input.mode)
  const clean = unassisted(input.mode, input.looks)

  if (input.phase === 'setup') {
    return {
      boardFen: null,
      because: 'No game has started yet.',
      label: 'The board, before a game starts',
      moveList: false,
      lookButton: false,
      clean
    }
  }
  if (input.phase === 'over') {
    return {
      boardFen: input.fen,
      because: null,
      label: 'The position the game finished in',
      moveList: true,
      lookButton: false,
      clean
    }
  }
  if (input.looking && rules.mayLook) {
    return {
      boardFen: input.fen,
      because: null,
      label: 'The board, while you hold the button',
      moveList: rules.moveList,
      lookButton: true,
      clean
    }
  }
  return {
    boardFen: null,
    because: rules.mayLook
      ? 'The board is not on screen. Hold "Look at the board" to see it; every look is counted.'
      : 'The board is not on screen. That is the game.',
    label: 'The board is hidden for this game',
    moveList: rules.moveList,
    lookButton: rules.mayLook,
    clean
  }
}

// ---------------------------------------------------------------- entering a move

export interface MoveEntry {
  /** The move, when exactly one was meant. Null otherwise, and then nothing may be played. */
  uci: string | null
  san: string | null
  /** Set when the move could not be made out. The two faults are kept apart all the way to the message. */
  fault: 'notation' | 'chess' | null
  /** Said to the person, as it stands. */
  says: string
  /** Ways of writing what they may have meant, when there are any. For a screen to offer as buttons. */
  suggest: readonly string[]
  /** True when the answer is "which of these did you mean", rather than "that is wrong". */
  asking: boolean
}

/**
 * One move entered against the position it would be played in.
 *
 * `readMove` does the work, and the only thing added here is that an ambiguous move becomes a **question** with the
 * ways of writing it attached -- not a refusal, and never a choice made quietly. Blindfold is exactly where this
 * matters: somebody who cannot see the board is far more likely to write "Nd2" with two knights able to reach it,
 * and playing one of them for them would make the game stop being theirs.
 */
export function enterGameMove(fen: string, text: string): MoveEntry {
  const read: ReadResult = readMove(fen, text)
  if (read.ok) {
    return {
      uci: read.move.uci,
      san: read.move.san,
      fault: null,
      says: read.tidied ? `${read.move.san} -- written ${read.move.san}, not ${read.wrote}.` : read.move.san,
      suggest: [],
      asking: false
    }
  }
  const ambiguous = read.fault === 'notation' && read.code === 'ambiguous'
  return {
    uci: null,
    san: null,
    fault: read.fault,
    says: read.says,
    suggest: read.suggest ?? [],
    asking: ambiguous
  }
}

// ---------------------------------------------------------------- announcing a move

const PIECE_WORD: Readonly<Record<PieceLetter, string>> = Object.freeze({
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king'
})

const SIDE_WORD: Readonly<Record<Side, string>> = Object.freeze({ w: 'White', b: 'Black' })

/**
 * A move said out loud, for somebody who cannot see it.
 *
 * In notation **and** in words, because the two fail differently: notation is what a player wants and is easy to
 * misread by one letter, and the words are unmistakable. This is the one place where naming squares is right -- a
 * blindfold game is played by announcing moves, and a game whose moves are not announced cannot be played at all.
 *
 * Nothing is said about whether the move was good. That is an engine's opinion and no engine was asked.
 */
export function announce(fen: string, text: string): string | null {
  const made = applyMove(fen, text)
  if (!made) return null
  const who = SIDE_WORD[made.color]
  // `special` is the rules' own answer about castling. Reading it off the squares would be a second way to decide
  // something that is already decided, and it would be wrong in any variant where the king starts elsewhere.
  if (made.special === 'k') return `${made.san} -- ${who} castles short.`
  if (made.special === 'q') return `${made.san} -- ${who} castles long.`
  const parts: string[] = []
  if (made.special === 'e') {
    // En passant takes a pawn that is not on the square the capturing pawn lands on, and somebody picturing the
    // board will put the wrong pawn away if nobody says so. The square it really stood on is the destination file
    // at the capturing pawn's own rank.
    parts.push(`${who}'s pawn on ${made.from} takes the pawn on ${made.to[0]}${made.from[1]} as it passes, and lands on ${made.to}`)
  } else {
    parts.push(made.captured
      ? `${who}'s ${PIECE_WORD[made.piece]} on ${made.from} takes the ${PIECE_WORD[made.captured]} on ${made.to}`
      : `${who}'s ${PIECE_WORD[made.piece]} goes from ${made.from} to ${made.to}`)
  }
  if (made.promotion) parts.push(`and becomes a ${PIECE_WORD[made.promotion]}`)
  const end = made.checkmate ? '. Checkmate.' : made.check ? '. Check.' : '.'
  return `${made.san} -- ${parts.join(' ')}${end}`
}

/**
 * What is left on the board, for somebody who has lost the thread.
 *
 * Offered only in the modes that allow a look, and it counts as one: a list of every piece and where it stands is
 * the position, written out. Calling it anything else would be the leak this whole file exists to prevent.
 */
export function sayGamePosition(fen: string): string {
  const pieces = boardSquares(fen)
  if (pieces.length === 0) return 'There is no position here.'
  const parts: string[] = []
  for (const side of ['w', 'b'] as const) {
    const kinds: string[] = []
    for (const type of ['k', 'q', 'r', 'b', 'n', 'p'] as const) {
      const squares = pieces.filter((one) => one.color === side && one.type === type).map((one) => one.square).sort()
      if (squares.length === 0) continue
      kinds.push(`${PIECE_WORD[type]}${squares.length > 1 ? 's' : ''} ${squares.join(', ')}`)
    }
    if (kinds.length) parts.push(`${SIDE_WORD[side]}: ${kinds.join('; ')}.`)
  }
  parts.push(`${SIDE_WORD[sideToMove(fen)]} to move.`)
  return parts.join(' ')
}
