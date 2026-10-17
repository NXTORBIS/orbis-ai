import { checkFen, playable, uciLineToSan, START_FEN } from './rules.ts'
import { readPgn } from './pgn.ts'

/**
 * The analysis board's own counting: reading a position somebody pasted, and turning an engine line into moves you
 * can click.
 *
 * Both of these used to be missing, and the hole each one left was the same shape. There was no way to put a
 * position on the analysis board at all -- it only ever showed a game out of the library -- so "look at this
 * position" meant saving a game first. And an engine line was one run of text, so the third move of the engine's
 * best line was something to read rather than somewhere to go.
 *
 * Everything here refuses rather than guesses. A paste that is neither a position nor a game says which it failed
 * to be. An engine line that stops being legal part way along is cut at that point and says how far it got, because
 * the rest of it describes moves that cannot be played in this position and offering them as buttons would be
 * offering moves that do not exist.
 */

/** What a paste turned out to be, once it was read. */
export interface LoadedPosition {
  /** Which of the two it was read as. */
  kind: 'fen' | 'pgn'
  /** The position the board starts from. */
  startFen: string
  /** The moves to play from it, as they are written. Empty for a bare position. */
  moves: string[]
  /** A name for it out of the paste itself, when it carried one. Never invented. */
  name: string | null
  /** Anything true about the paste worth saying: moves that would not play, games that were left out. */
  notes: string[]
}

export type ReadPasted =
  | { ok: true; loaded: LoadedPosition }
  | { ok: false; problem: string }

/** The longest paste this will look at, so a pasted megabyte cannot lock the window up. */
export const PASTE_LIMIT = 1024 * 512

/**
 * Does this text look like it is meant to be a position rather than a game?
 *
 * One line, no PGN tag in it, and at least four space-separated parts the first of which has the eight-rank shape.
 * It is deliberately a shape test and not a validity test: a FEN with a real mistake in it must reach `checkFen`,
 * which says what is wrong with it, rather than being quietly read as a game and failing as one.
 */
export function looksLikeFen(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed || trimmed.includes('\n') || trimmed.startsWith('[')) return false
  const fields = trimmed.split(/\s+/)
  if (fields.length < 4) return false
  return fields[0].split('/').length === 8
}

/** Reading what somebody pasted into the analysis board: a position, or a whole game. */
export function readPasted(text: string): ReadPasted {
  const trimmed = (text ?? '').trim()
  if (!trimmed) return { ok: false, problem: 'There is nothing to read. Paste a position or a game first.' }
  if (trimmed.length > PASTE_LIMIT) {
    return { ok: false, problem: `That is ${Math.round(trimmed.length / 1024)}KB of text, which is too much to read here. Import it in the Library instead.` }
  }

  if (looksLikeFen(trimmed)) {
    const check = checkFen(trimmed)
    if (!check.ok) return { ok: false, problem: check.reason ?? 'That is not a position this board can use.' }
    const can = playable(trimmed)
    // A position that is valid but could not occur in a game is still worth putting on the board -- you may be
    // setting one up -- so it loads, and what is odd about it is said rather than refused.
    const notes = can.ok ? [] : [can.reason ?? 'That position could not occur in a game.']
    return { ok: true, loaded: { kind: 'fen', startFen: trimmed, moves: [], name: null, notes } }
  }

  const read = readPgn(trimmed, { limit: 1 })
  const first = read.games[0]
  if (!first) {
    const why = read.warnings[0]?.message
    return { ok: false, problem: why ? `That is neither a position nor a game Orbis could read: ${why}` : 'That is neither a position nor a game Orbis could read.' }
  }

  const notes: string[] = []
  if (!first.ok) notes.push(first.reason ?? 'Part of that game could not be played out, so it stops where it stopped.')
  for (const warning of first.warnings) notes.push(warning.message)

  const white = first.meta.white.name ?? null
  const black = first.meta.black.name ?? null
  const name = white && black ? `${white} vs ${black}` : first.meta.event ?? null

  return {
    ok: true,
    loaded: {
      kind: 'pgn',
      startFen: first.startFen,
      moves: first.moves.map((one) => one.san),
      name,
      notes
    }
  }
}

/** One move of an engine's line, with the position it reaches, so clicking it can go there. */
export interface LineMove {
  /** 1 for the first move of the line. */
  step: number
  san: string
  uci: string
  /** The position after it. */
  fen: string
}

export interface LineWalked {
  moves: LineMove[]
  /** True when every move the engine gave could be played. */
  whole: boolean
  /** How many moves the engine gave, so a cut line can say what it cut. */
  given: number
}

/** How many moves of a line are worth drawing as buttons. Past this it is a wall of text, not a line. */
export const LINE_SHOWN = 12

/**
 * An engine line as moves you can play, rather than a run of text.
 *
 * `uciLineToSan` does the chess; this turns its answer into one object per move with the position it reaches, and
 * stops at the first move that would not play. A line that was cut says so through `whole`, and the caller shows
 * that rather than letting the shorter list look like the whole of what the engine said.
 */
export function lineMoves(fen: string, uci: readonly string[], limit: number = LINE_SHOWN): LineWalked {
  const given = uci.length
  if (!given) return { moves: [], whole: true, given: 0 }
  const asked = uci.slice(0, Math.max(0, limit))
  const written = uciLineToSan(fen, [...asked])
  const moves: LineMove[] = []
  for (let index = 0; index < written.san.length; index += 1) {
    const reached = written.fens[index]
    if (reached === undefined) break
    moves.push({ step: index + 1, san: written.san[index], uci: asked[index], fen: reached })
  }
  const whole = written.legal && moves.length === given
  return { moves, whole, given }
}

/**
 * How deep a search got, in words, with nothing filled in.
 *
 * An engine that has not said a depth is not a search at depth zero, so it says that instead of printing a number
 * the engine never gave.
 */
export function depthWords(depth: number | null, seldepth?: number | null): string {
  if (depth === null) return 'depth not reported'
  if (seldepth !== null && seldepth !== undefined && seldepth > depth) return `depth ${depth}, ${seldepth} in places`
  return `depth ${depth}`
}

/** The starting position, for a board that has been cleared back to it. */
export const SCRATCH_FEN = START_FEN
