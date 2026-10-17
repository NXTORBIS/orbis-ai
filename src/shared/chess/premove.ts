/**
 * A move set up while it is still the other side's turn.
 *
 * On a chess site you can put your piece down before your opponent has moved, and the moment they do, your move
 * is played. It is the one board habit people miss most when it is not there, and it is what makes a fast game
 * playable at all.
 *
 * Nothing here decides anything about chess, and that is deliberate. A premove is two square names and, if the
 * pawn is going to the far rank, what it becomes. Whether it is legal cannot be known when it is set up -- the
 * position it will be played into does not exist yet -- so this file only says *when* to ask. The caller asks the
 * rules at that moment, and plays the move or throws it away.
 *
 * ## The one rule worth stating out loud
 *
 * A premove is never played without being checked again. The honest answers are therefore three, not two: it is
 * waiting for the other side, it is due to be tried now, or there is none. A premove that turns out to be illegal
 * in the position that actually arrived is dropped and said so -- it is never nudged into some nearby legal move,
 * because a board that plays a move you did not choose is worse than a board with no premoves at all.
 */

export type Side = 'w' | 'b'

export interface Premove {
  from: string
  to: string
  /** What a pawn reaching the far rank becomes. Chosen when the premove is set up, because there is nobody to ask later. */
  promotion?: string
}

const SQUARE = /^[a-h][1-8]$/
const PIECES = ['q', 'r', 'b', 'n']

export function isSquare(value: unknown): value is string {
  return typeof value === 'string' && SQUARE.test(value)
}

/**
 * A premove, or null when it is not one: a square that is not on a chessboard, a square to itself, or a promotion
 * to something a pawn cannot become.
 */
export function premove(from: string, to: string, promotion?: string): Premove | null {
  if (!isSquare(from) || !isSquare(to) || from === to) return null
  if (promotion !== undefined && !PIECES.includes(promotion)) return null
  return promotion === undefined ? { from, to } : { from, to, promotion }
}

export function samePremove(a: Premove | null, b: Premove | null): boolean {
  if (a === null || b === null) return a === b
  return a.from === b.from && a.to === b.to && (a.promotion ?? null) === (b.promotion ?? null)
}

/** The squares a premove is drawn on, so the board can show what is about to happen. */
export function premoveSquares(held: Premove | null): string[] {
  return held === null ? [] : [held.from, held.to]
}

export type PremoveStatus = 'none' | 'waiting' | 'due'

/**
 * What to do with the premove right now.
 *
 * `you` is the side the person is playing, or null for a board where they are playing both sides -- and on such a
 * board there is nothing to wait for, so a premove is due the moment it is set up. That is not a special case
 * being clever: it falls out of "it is due when it is your turn".
 */
export function premoveStatus(held: Premove | null, turn: Side, you: Side | null): PremoveStatus {
  if (held === null) return 'none'
  if (you === null) return 'due'
  return turn === you ? 'due' : 'waiting'
}

/**
 * Setting one up, or taking it back.
 *
 * Putting the same piece down on the same square again takes the premove off, which is how every board that has
 * these lets you change your mind. Anything else replaces what was held: one premove at a time, because a queue of
 * them played blind is how people lose games they were winning.
 */
export function nextPremove(held: Premove | null, from: string, to: string, promotion?: string): Premove | null {
  const made = premove(from, to, promotion)
  if (made === null) return held
  return samePremove(held, made) ? null : made
}

/** Whether this premove is allowed to be set up at all: only while it is not your turn, and never on a dead board. */
export function canSetPremove(options: { turn: Side; you: Side | null; playable: boolean }): boolean {
  if (!options.playable) return false
  if (options.you === null) return false
  return options.turn !== options.you
}

export type PremoveOutcome = 'played' | 'dropped'

/** What a screen says after a premove was tried. Plain words, because this is read out and shown. */
export function premoveWords(held: Premove, outcome: PremoveOutcome): string {
  if (outcome === 'played') return `Your move ${held.from} to ${held.to} was played.`
  return `Your move ${held.from} to ${held.to} could not be played in the position that arrived, so it was taken off.`
}
