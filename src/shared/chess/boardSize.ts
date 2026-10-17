/**
 * How big the board should be drawn, given the room it has been left.
 *
 * This exists because of a real fault, not for tidiness. The board had exactly one width rule --
 * `width: min(72vh, 100%)` inside a wrapper that was shrink-to-fit -- so the "100%" was resolved against a box
 * whose width had itself come from whatever text happened to sit under the board. On the real screens it settled
 * at about 357 pixels and stayed there however large the window was. A chess program whose board is 357 pixels
 * wide is a page of text with a diagram on it.
 *
 * So the size is now a measurement. Whoever lays the board out measures the space it has -- with a resize
 * observer, because that space changes with the window, with the panel beside it and with the text size -- and
 * hands the numbers here. Nothing in this file touches the screen, which is what makes the rule testable.
 *
 * ## Why the size is rounded down to a multiple of eight
 *
 * The board is eight squares across. At a width of 501 pixels a square is 62.625 pixels, and the browser paints
 * some squares 62 wide and some 63, which shows up as pale seams between files and as pieces that are a pixel
 * off centre in some columns. Rounding down to 496 makes every square exactly 62. One pixel of unused room is
 * invisible; uneven squares are not.
 */

/** The space the board has to sit in, in CSS pixels. */
export interface Room {
  width: number
  height: number
}

export interface SizeRules {
  /**
   * The smallest board worth drawing. Below this the pieces stop being recognisable and the coordinates stop
   * being readable, and a board you cannot read is worse than a board that overflows a little.
   */
  min?: number
  /**
   * The largest board. Left out there is no ceiling, which is what a full window should do: on a tall screen the
   * board gets the whole height.
   */
  max?: number
}

export const BOARD_MIN = 240
export const SQUARES = 8

const whole = (value: number): number => Math.floor(value / SQUARES) * SQUARES

/**
 * The side of the board, in CSS pixels.
 *
 * Square, so it is the smaller of the two sides of the room. Rounded down to a multiple of eight. Never below
 * `min`, even when that means the board is wider than the room it was given -- a board squeezed to 90 pixels
 * tells nobody anything, and a board that overflows can at least be scrolled to.
 *
 * A room with nothing in it yet -- zero, or a number that is not a number, which is what a box measures before it
 * has been laid out -- answers with the minimum rather than with zero, so the first frame draws a real board
 * instead of a collapsed one that then jumps.
 */
export function boardSize(room: Room, rules: SizeRules = {}): number {
  const min = rules.min !== undefined && Number.isFinite(rules.min) && rules.min > 0 ? rules.min : BOARD_MIN
  const width = Number.isFinite(room.width) ? room.width : 0
  const height = Number.isFinite(room.height) ? room.height : 0
  let side = Math.min(width, height)
  if (rules.max !== undefined && Number.isFinite(rules.max) && rules.max > 0) side = Math.min(side, rules.max)
  const rounded = whole(side)
  if (rounded < min) return whole(min) === min ? min : whole(min) + SQUARES
  return rounded
}

/** One square, for anything that has to line up with the board in pixels. */
export function squareSize(side: number): number {
  return side / SQUARES
}

/**
 * Whether the board had to be made smaller than it wanted to be, which is what a screen says out loud rather than
 * silently drawing a board that does not fit.
 */
export function squeezed(room: Room, rules: SizeRules = {}): boolean {
  const side = boardSize(room, rules)
  const width = Number.isFinite(room.width) ? room.width : 0
  const height = Number.isFinite(room.height) ? room.height : 0
  return side > width || side > height
}
