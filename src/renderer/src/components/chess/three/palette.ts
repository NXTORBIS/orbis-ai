/**
 * The colours, taken from the app rather than invented here.
 *
 * Orbis's accent colour is a token that changes with the theme, so the 3D board reads it out of the page instead of
 * hard-coding one. The reading can fail in a way worth being careful about: a token can be a colour three.js has
 * never heard of (`oklch(...)` and friends), and handing three.js a colour it cannot parse does not fall back
 * quietly -- it warns and leaves the material black, which on a chessboard looks like a bug in the chess.
 *
 * So every value is checked before it is used, and anything unreadable falls back to the literal colour the flat
 * board already uses. That way the 3D board is never a different board, only a differently lit one.
 */

/** The squares are the flat board's own two colours, so switching between the two looks like one board. */
export const LIGHT_SQUARE = '#b9c6d4'
export const DARK_SQUARE = '#4f6076'

export interface Palette {
  light: string
  dark: string
  /** The frame around the squares and the text on it. */
  frame: string
  frameText: string
  whitePiece: string
  blackPiece: string
  /**
   * The bands at the foot of the pieces, which exist so you can see where a piece ends and a square begins.
   *
   * Each is chosen against the square its own colour is weak on: a white piece barely separates from a light
   * square, and a black piece barely separates from a dark one, so the white pieces wear a dark band and the black
   * pieces a light one. `palette.test.ts` holds this to three to one for every piece against every square.
   */
  rimOnWhite: string
  rimOnBlack: string
  /** The grey used for the one detail a shape cannot carry on its own -- the slot in a bishop's mitre. */
  accent: string
  /** Everything the board marks: picked up, able to move there, the move just played. */
  mark: string
  /** A square marked by a lesson or a puzzle. */
  noted: string
  /** The square of a king in check. */
  danger: string
  /** Behind the board. Transparent in the page; this is only used when a still picture is taken of the scene. */
  backdrop: string
}

export const DEFAULT_PALETTE: Palette = {
  light: LIGHT_SQUARE,
  dark: DARK_SQUARE,
  frame: '#2a3340',
  frameText: '#dfe6ee',
  whitePiece: '#f2f4f7',
  blackPiece: '#171d25',
  rimOnWhite: '#3a4350',
  rimOnBlack: '#c9d4e0',
  accent: '#555f6c',
  mark: '#3fd8ff',
  noted: '#e0b341',
  danger: '#8d3b45',
  backdrop: '#060708'
}

/**
 * Colours three.js can read.
 *
 * Hex, `rgb()`, `rgba()`, `hsl()` and the plain colour names are all fine. Modern colour spaces are not, and
 * neither is a token that was never set, so both come back as the fallback.
 */
const READABLE = /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|[a-z]+)$/i

export function normaliseColour(value: string | null | undefined, fallback: string): string {
  const text = (value ?? '').trim()
  if (!text) return fallback
  // A colour function is read by its opening, because the inside can hold spaces, slashes and percentages.
  const head = text.includes('(') ? text.slice(0, text.indexOf('(') + 1) : text
  if (!READABLE.test(head)) return fallback
  // These are valid CSS and nothing three.js parses, so they are rejected by name rather than by guessing.
  if (/^(oklch|oklab|lch|lab|color|color-mix|light-dark|hwb)\(/i.test(text)) return fallback
  if (/^(currentcolor|inherit|initial|unset|revert|transparent|none)$/i.test(text)) return fallback
  if (text.startsWith('#') && ![4, 5, 7, 9].includes(text.length)) return fallback
  return text
}

/** Looks a CSS custom property up. The component passes a reader over the real page; a test passes a map. */
export type TokenReader = (token: string) => string

/**
 * The palette for this theme.
 *
 * Only the accent is taken from the page. The squares, the pieces and the danger colour are fixed on purpose: they
 * have to hold their contrast against each other whatever the theme does, and a theme that turned the light squares
 * dark would make the board unreadable without anything reporting a fault.
 */
export function readPalette(read: TokenReader): Palette {
  return {
    ...DEFAULT_PALETTE,
    mark: normaliseColour(read('--cyan'), DEFAULT_PALETTE.mark),
    frame: normaliseColour(read('--bg-mid'), DEFAULT_PALETTE.frame),
    frameText: normaliseColour(read('--text'), DEFAULT_PALETTE.frameText),
    backdrop: normaliseColour(read('--bg-mid'), DEFAULT_PALETTE.backdrop)
  }
}

/** The brightness of a colour, 0 to 1, for the one check that matters: can you see a piece against a square? */
export function luminanceOf(colour: string): number | null {
  const text = colour.trim()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text)
  if (!hex) return null
  const digits = hex[1].length === 3 ? [...hex[1]].map((one) => one + one).join('') : hex[1]
  const channel = (at: number): number => {
    const value = Number.parseInt(digits.slice(at, at + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
}

/** How far apart two colours are, by the usual measure. 1 is no difference; 21 is black against white. */
export function contrastBetween(a: string, b: string): number | null {
  const first = luminanceOf(a)
  const second = luminanceOf(b)
  if (first === null || second === null) return null
  const lighter = Math.max(first, second)
  const darker = Math.min(first, second)
  return (lighter + 0.05) / (darker + 0.05)
}

export interface Separation {
  piece: 'white' | 'black'
  square: 'light' | 'dark'
  /** How far the body of the piece stands from the square, in flat colour. */
  body: number | null
  /** How far the band at its foot stands from the square. */
  rim: number | null
  /** Whichever of the two does the job. */
  best: number | null
}

/**
 * Can each piece be told from each square?
 *
 * Four pairings, and two of them are genuinely difficult: a white piece on a light square and a black piece on a
 * dark one. Flat colour cannot solve either -- against these squares even pure white only reaches 1.75 to 1, which
 * is why a real wooden chess set relies on edges and shadows too.
 *
 * So each piece is allowed to pass on either its body or the band at its foot, and the band for each colour is
 * chosen against the square that colour is weak on. This returns both numbers so a test can say which did the job
 * rather than only that something did.
 */
export function pieceSeparation(palette: Palette = DEFAULT_PALETTE): Separation[] {
  const out: Separation[] = []
  for (const piece of ['white', 'black'] as const) {
    for (const square of ['light', 'dark'] as const) {
      const pieceColour = piece === 'white' ? palette.whitePiece : palette.blackPiece
      const rimColour = piece === 'white' ? palette.rimOnWhite : palette.rimOnBlack
      const squareColour = square === 'light' ? palette.light : palette.dark
      const body = contrastBetween(pieceColour, squareColour)
      const rim = contrastBetween(rimColour, squareColour)
      const best = body === null && rim === null ? null : Math.max(body ?? 0, rim ?? 0)
      out.push({ piece, square, body, rim, best })
    }
  }
  return out
}
