/**
 * The small decisions the Play screen makes before and around a game, kept here so they can be tested without a
 * window: how the clocks are grouped for the grid of choices, which colour "Either" really gave you, what the
 * setup says in a row of chips rather than four paragraphs, and whether the strip beside the board may be drawn.
 *
 * None of it decides anything about chess. The rules are in `rules.ts`, the game is in `arena.ts`, the clock is in
 * `clock.ts`. This is only the wording and the grouping, which is exactly the part that used to be loose prose on
 * screen and so could never be checked.
 */

import { KIND_NAME, TIME_CONTROLS, type TimeControl, type TimeControlKind } from './clock.ts'
import type { Score } from './evaluation.ts'

/** 'w' and 'b' are the two colours; 'random' means "let Orbis choose". The same three words `arena.ts` uses. */
export type ColourChoice = 'w' | 'b' | 'random'

/** One family of clocks: all the bullet ones together, all the blitz ones together, and so on. */
export interface ClockFamily {
  kind: TimeControlKind
  /** What the family is called on screen: Bullet, Blitz, Rapid, Classical, Untimed. */
  name: string
  controls: TimeControl[]
}

/**
 * The order the families are shown in: fastest first, and "no clock at all" last because it is not a speed.
 */
export const FAMILY_ORDER: readonly TimeControlKind[] = Object.freeze([
  'bullet',
  'blitz',
  'rapid',
  'classical',
  'untimed'
])

/**
 * The clocks grouped into families, in `FAMILY_ORDER`, with empty families left out.
 *
 * This is what lets the screen show a grid of times the way a chess site does, instead of one long drop-down of
 * thirteen entries where nothing tells you that 3 + 2 and 30 + 20 are different kinds of game.
 */
export function clockFamilies(controls: readonly TimeControl[] = TIME_CONTROLS): ClockFamily[] {
  const families: ClockFamily[] = []
  for (const kind of FAMILY_ORDER) {
    const mine = controls.filter((one) => one.kind === kind)
    if (!mine.length) continue
    families.push({ kind, name: KIND_NAME[kind], controls: mine })
  }
  return families
}

/**
 * Which colour a choice really gives, from a roll the caller supplies.
 *
 * It is the same rule `startArena` uses, written once here so the screen can say what happened rather than leaving
 * somebody who picked "Either" to work out from the board which colour they got. That was the whole fault with the
 * "Either" button: the choice was honoured, and nothing on screen ever mentioned it again.
 */
export function sideFor(choice: ColourChoice, roll: number): 'w' | 'b' {
  if (choice === 'w' || choice === 'b') return choice
  const safe = Number.isFinite(roll) ? Math.max(0, Math.min(0.999_999, roll)) : 0
  return safe < 0.5 ? 'w' : 'b'
}

const COLOUR_NAME: Readonly<Record<'w' | 'b', string>> = Object.freeze({ w: 'White', b: 'Black' })

/** The name of a colour, for anywhere one is shown. */
export const colourName = (side: 'w' | 'b'): string => COLOUR_NAME[side]

/**
 * What to say about the colour a game is being played with.
 *
 * `given` is the colour the game really started with. When "Either" was chosen, the sentence says so and names
 * the colour it landed on.
 */
export function colourWords(choice: ColourChoice, given: 'w' | 'b'): string {
  if (choice === 'random') return `You asked Orbis to choose, and it gave you ${COLOUR_NAME[given]}.`
  return `You are playing ${COLOUR_NAME[given]}.`
}

/** One fact about the game, said in two or three words instead of a sentence. */
export interface SetupChip {
  /** What the fact is: "Opponent", "Clock". */
  label: string
  /** The fact itself: "Pebble", "3 + 2". */
  value: string
  /** The longer version, for the chip's tooltip. Left out when there is nothing more to say. */
  title?: string
}

export interface SetupFacts {
  opponent: string
  opponentAbout?: string
  colour: ColourChoice
  clock: TimeControl
  clockAbout?: string
  help: string
  helpAbout?: string
}

/**
 * The setup as a row of chips.
 *
 * Every one of these used to be a labelled select with a two-sentence hint under it, which is four paragraphs of
 * reading above the board. The longer wording is kept, as the chip's tooltip, so nothing honest is lost.
 */
export function setupChips(facts: SetupFacts): SetupChip[] {
  const colour =
    facts.colour === 'random' ? 'Either' : COLOUR_NAME[facts.colour]
  const chips: SetupChip[] = [
    { label: 'Opponent', value: facts.opponent, ...(facts.opponentAbout ? { title: facts.opponentAbout } : {}) },
    {
      label: 'You play',
      value: colour,
      ...(facts.colour === 'random' ? { title: 'Orbis picks a colour when the game starts, and says which.' } : {})
    },
    { label: 'Clock', value: facts.clock.label, ...(facts.clockAbout ? { title: facts.clockAbout } : {}) },
    { label: 'Help', value: facts.help, ...(facts.helpAbout ? { title: facts.helpAbout } : {}) }
  ]
  return chips
}

/**
 * Whether the strip beside the board may be drawn, and with what.
 *
 * Two things have to be true: the person has it switched on, and a real search has produced a score for the
 * position actually on screen. A score from a different position is not shown under this one, and a position
 * nothing has looked at gets no bar rather than a bar in the middle — which would read as "the engine looked and
 * found it level".
 */
export function barFor(options: {
  wanted: boolean
  /** The score, and the position it was really about. */
  score?: { score: Score; fen: string; text?: string } | null
  /** The position on screen now. */
  fen: string
}): { score: Score; text?: string } | null {
  if (!options.wanted) return null
  const got = options.score
  if (!got || got.fen !== options.fen) return null
  if (got.score.kind === 'none') return null
  return { score: got.score, ...(got.text ? { text: got.text } : {}) }
}

/**
 * Whether the person is looking back through the game rather than at the position they must play in.
 *
 * `ply` is where they are looking; `total` is how many moves have been played. Browsing is not playing: the board
 * must not accept a move, and the screen has to say so, or a move made while looking at move 4 of a 30-move game
 * would be a move nobody meant.
 */
export function browsing(ply: number, total: number): boolean {
  return ply < total
}

/** What to say while somebody is looking back: where they are, and how to get back to the game. */
export function browsingWords(ply: number, total: number): string | null {
  if (!browsing(ply, total)) return null
  return `You are looking back at move ${ply} of ${total}. Go to the last move to play on.`
}
