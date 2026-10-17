/**
 * The chess pieces, drawn.
 *
 * Until now a piece was a letter from the chess alphabet -- `♞`, `♚` -- styled with a text shadow. That is why the
 * board looked thin and cheap, and why it looked different on different machines: a glyph is drawn by whatever font
 * the computer happens to have, at whatever weight that font chose, and no amount of CSS makes a font character
 * into a chess piece. The settings screen said so out loud: "The pieces are letters from the chess alphabet rather
 * than pictures."
 *
 * These are pictures. Solid Staunton shapes on a 45x45 grid, the size every chess piece set is drawn on, so they
 * stay sharp at any board size -- a wall-sized board and a diagram the width of a thumbnail come off the same
 * paths.
 *
 * **They are drawn here, by hand, on purpose.** Chess.com's sets are their own artwork and are not ours to copy.
 * The well-known free sets are mostly GPL or share-alike, which this product does not take. So the shapes below owe
 * nothing to either: plain Staunton forms, which are a 19th-century design nobody owns.
 *
 * Every piece is one filled shape plus an outline. `fill` is the piece's own colour and `stroke` is the line round
 * it, and those two come from the board theme rather than from here -- which is what lets a white piece stay
 * visible on a pale square and a black piece on a dark one.
 */

export type PieceColor = 'w' | 'b'
export type PieceType = 'k' | 'q' | 'r' | 'b' | 'n' | 'p'

/** How heavily a piece is outlined. The board theme picks the colours; this picks the weight. */
export type PieceStyle = 'classic' | 'bold' | 'flat'

const STROKE_WIDTH: Record<PieceStyle, number> = { classic: 1.3, bold: 2.2, flat: 0 }

/*
 * The shapes.
 *
 * Each is written as one or more paths over a 45x45 box, with the piece standing on a base at about y=39 and its
 * head reaching about y=6. They share a base and a collar so a row of pieces sits on one line and reads as one set
 * rather than six drawings that happen to be in the same folder.
 */

/** The base every piece stands on: a foot, and the spread above it. */
const BASE = 'M 11.5,39.5 L 33.5,39.5 L 33.5,36.2 C 33.5,33.6 30.4,33.2 28.6,31.6 L 16.4,31.6 C 14.6,33.2 11.5,33.6 11.5,36.2 z'

const PAWN = `
  M 22.5,9.2 C 20.1,9.2 18.2,11.1 18.2,13.5 C 18.2,14.6 18.6,15.6 19.3,16.4
  C 17.2,17.6 15.6,19.9 15.6,22.6 C 15.6,25.6 17.4,27.4 19.0,29.0
  C 19.9,29.9 20.3,30.6 20.3,31.6 L 24.7,31.6 C 24.7,30.6 25.1,29.9 26.0,29.0
  C 27.6,27.4 29.4,25.6 29.4,22.6 C 29.4,19.9 27.8,17.6 25.7,16.4
  C 26.4,15.6 26.8,14.6 26.8,13.5 C 26.8,11.1 24.9,9.2 22.5,9.2 z
  ${BASE}
`

const ROOK = `
  M 12.0,8.0 L 12.0,13.0 L 15.5,13.0 L 15.5,10.5 L 19.0,10.5 L 19.0,13.0
  L 26.0,13.0 L 26.0,10.5 L 29.5,10.5 L 29.5,13.0 L 33.0,13.0 L 33.0,8.0 z
  M 13.5,13.0 L 13.5,16.5 L 31.5,16.5 L 31.5,13.0 z
  M 15.2,16.5 L 15.2,29.5 C 15.2,30.5 14.8,31.0 14.2,31.6 L 30.8,31.6
  C 30.2,31.0 29.8,30.5 29.8,29.5 L 29.8,16.5 z
  ${BASE}
`

const BISHOP = `
  M 22.5,6.2 C 21.2,6.2 20.2,7.2 20.2,8.5 C 20.2,9.2 20.5,9.8 21.0,10.2
  C 18.2,11.8 15.6,15.4 15.6,20.0 C 15.6,23.4 17.4,25.6 19.2,27.2
  C 20.0,27.9 20.3,28.6 20.3,29.4 L 24.7,29.4 C 24.7,28.6 25.0,27.9 25.8,27.2
  C 27.6,25.6 29.4,23.4 29.4,20.0 C 29.4,15.4 26.8,11.8 24.0,10.2
  C 24.5,9.8 24.8,9.2 24.8,8.5 C 24.8,7.2 23.8,6.2 22.5,6.2 z
  M 16.8,29.4 L 28.2,29.4 C 28.9,30.2 29.4,30.8 29.4,31.6 L 15.6,31.6
  C 15.6,30.8 16.1,30.2 16.8,29.4 z
  ${BASE}
`

/* The knight is the only piece that faces a direction. It faces left, as a white knight on the queen's side does. */
const KNIGHT = `
  M 22.0,8.0 C 24.6,8.0 27.2,9.0 29.0,10.8 C 31.4,13.2 32.4,16.6 32.4,20.4
  L 32.4,29.6 C 32.4,30.5 32.0,31.0 31.4,31.6 L 16.2,31.6
  C 16.2,30.2 16.6,29.0 17.6,27.8 C 19.2,25.8 21.8,24.4 23.6,22.8
  C 24.6,21.9 25.0,21.0 24.6,20.2 C 24.2,19.4 23.2,19.2 22.2,19.6
  L 17.4,21.6 C 15.6,22.4 14.2,22.0 13.4,20.8 C 12.6,19.6 12.8,18.0 13.8,16.6
  L 17.2,12.0 C 18.4,10.4 20.0,8.0 22.0,8.0 z
  M 16.6,16.4 C 17.4,16.4 18.0,17.0 18.0,17.8 C 18.0,18.6 17.4,19.2 16.6,19.2
  C 15.8,19.2 15.2,18.6 15.2,17.8 C 15.2,17.0 15.8,16.4 16.6,16.4 z
  ${BASE}
`

const QUEEN = `
  M 9.6,13.4 C 10.6,13.4 11.4,14.2 11.4,15.2 C 11.4,15.9 11.0,16.5 10.4,16.8
  L 13.4,24.6 L 16.0,15.0 C 15.4,14.6 15.0,14.0 15.0,13.2
  C 15.0,12.2 15.8,11.4 16.8,11.4 C 17.8,11.4 18.6,12.2 18.6,13.2
  C 18.6,13.9 18.2,14.5 17.7,14.9 L 20.6,22.8 L 20.7,12.6
  C 20.0,12.3 19.5,11.6 19.5,10.8 C 19.5,9.8 20.3,9.0 21.3,9.0
  L 23.7,9.0 C 24.7,9.0 25.5,9.8 25.5,10.8 C 25.5,11.6 25.0,12.3 24.3,12.6
  L 24.4,22.8 L 27.3,14.9 C 26.8,14.5 26.4,13.9 26.4,13.2
  C 26.4,12.2 27.2,11.4 28.2,11.4 C 29.2,11.4 30.0,12.2 30.0,13.2
  C 30.0,14.0 29.6,14.6 29.0,15.0 L 31.6,24.6 L 34.6,16.8
  C 34.0,16.5 33.6,15.9 33.6,15.2 C 33.6,14.2 34.4,13.4 35.4,13.4
  C 36.4,13.4 37.2,14.2 37.2,15.2 C 37.2,16.2 36.4,17.0 35.4,17.0
  L 32.2,28.0 L 12.8,28.0 L 9.6,17.0 C 8.6,17.0 7.8,16.2 7.8,15.2
  C 7.8,14.2 8.6,13.4 9.6,13.4 z
  M 12.8,28.0 L 32.2,28.0 C 32.2,29.4 31.6,30.4 30.8,31.6 L 14.2,31.6
  C 13.4,30.4 12.8,29.4 12.8,28.0 z
  ${BASE}
`

const KING = `
  M 22.5,5.0 L 22.5,11.0 M 20.0,7.4 L 25.0,7.4
  M 22.5,11.0 C 25.6,11.0 28.0,12.4 29.6,14.4 C 31.2,16.4 31.6,18.8 30.6,21.0
  C 29.8,22.8 28.2,24.2 26.6,25.6 C 25.4,26.6 24.7,27.6 24.7,28.6
  L 20.3,28.6 C 20.3,27.6 19.6,26.6 18.4,25.6 C 16.8,24.2 15.2,22.8 14.4,21.0
  C 13.4,18.8 13.8,16.4 15.4,14.4 C 17.0,12.4 19.4,11.0 22.5,11.0 z
  M 20.3,28.6 L 24.7,28.6 C 25.6,29.6 26.2,30.5 26.2,31.6 L 18.8,31.6
  C 18.8,30.5 19.4,29.6 20.3,28.6 z
  ${BASE}
`

const SHAPES: Record<PieceType, string> = { p: PAWN, r: ROOK, n: KNIGHT, b: BISHOP, q: QUEEN, k: KING }

/* The king's cross is two strokes rather than a filled shape, so it is drawn separately and never filled. */
const CROSS: Record<PieceType, string | null> = { k: 'M 22.5,5.0 L 22.5,11.0 M 20.0,7.4 L 25.0,7.4', p: null, r: null, n: null, b: null, q: null }

export interface PieceProps {
  color: PieceColor
  type: PieceType
  style?: PieceStyle
  /** A name for anyone who cannot see it. Leave it out and the piece is hidden from a screen reader. */
  title?: string
  className?: string
}

/**
 * One piece.
 *
 * The colours come from the stylesheet through `currentColor` and a custom property, not from here, so a board
 * theme can recolour a whole set without this file knowing any theme exists.
 */
export function Piece({ color, type, style = 'classic', title, className }: PieceProps): React.JSX.Element {
  const width = STROKE_WIDTH[style]
  const cross = CROSS[type]
  return (
    <svg
      viewBox="0 0 45 45"
      className={`cw-pc cw-pc-${color}${className ? ` ${className}` : ''}`}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <path
        d={SHAPES[type]}
        fill="currentColor"
        stroke="var(--cw-pc-line)"
        strokeWidth={width}
        strokeLinejoin="round"
        strokeLinecap="round"
        fillRule="evenodd"
      />
      {cross && (
        <path d={cross} fill="none" stroke="var(--cw-pc-line)" strokeWidth={Math.max(width, 1.8)} strokeLinecap="round" />
      )}
    </svg>
  )
}

/** The letters a piece is named by, kept here so a move list and a board agree about what a knight is called. */
export const PIECE_NAME: Record<PieceType, string> = {
  k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn'
}

export const COLOR_NAME: Record<PieceColor, string> = { w: 'White', b: 'Black' }

/** "White knight", for a screen reader and for a tooltip. */
export const pieceTitle = (color: PieceColor, type: PieceType): string => `${COLOR_NAME[color]} ${PIECE_NAME[type]}`
