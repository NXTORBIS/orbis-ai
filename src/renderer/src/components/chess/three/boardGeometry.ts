/**
 * Where a square is in space.
 *
 * The 3D board draws the same sixty-four squares the flat board draws, so the only thing it needs that the flat
 * board does not is a place in space for each one. That is all this file is: names to coordinates and coordinates
 * back to names, plus the one bit of arithmetic that turns a line from the camera into the square under the pointer.
 *
 * It is deliberately plain arithmetic with no three.js and no browser in it, because the thing most likely to be
 * wrong in a 3D board is which square you just clicked, and that is only provable by a test if the maths can run
 * without a graphics card.
 */

/** A square is one unit across, so the eight-by-eight playing surface runs from -4 to +4 on both axes. */
export const SQUARE = 1
/** Half the playing surface, which is also the distance from the middle to the edge of the squares. */
export const HALF = 4
/** The height of the playing surface. Pieces stand on it; the markers float a hair above it. */
export const SURFACE_Y = 0
/** How thick the board is under the surface. Only used for drawing; nothing is decided by it. */
export const SLAB = 0.34
/** The border around the squares, where the coordinates are written. */
export const FRAME = 0.44

export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const
export const RANKS = [1, 2, 3, 4, 5, 6, 7, 8] as const

export type Orientation = 'w' | 'b'

/** A point in space. Kept as a plain object so nothing here needs three.js. */
export interface Vec3 { x: number; y: number; z: number }

/** Every square, in a fixed order, so a test can walk all sixty-four. */
export const ALL_SQUARES: string[] = RANKS.flatMap((rank) => FILES.map((file) => `${file}${rank}`))

/** Is this the name of a square on the board? */
export function isSquare(name: string): boolean {
  return /^[a-h][1-8]$/.test(name)
}

/** The file as a number, a = 0 through h = 7, or -1 when the name is not a square. */
export function fileIndexOf(square: string): number {
  if (!isSquare(square)) return -1
  return square.charCodeAt(0) - 97
}

/** The rank as a number, 1 through 8, or -1 when the name is not a square. */
export function rankOf(square: string): number {
  if (!isSquare(square)) return -1
  return Number(square[1])
}

export function squareName(fileIndex: number, rank: number): string | null {
  if (!Number.isInteger(fileIndex) || fileIndex < 0 || fileIndex > 7) return null
  if (!Number.isInteger(rank) || rank < 1 || rank > 8) return null
  return `${FILES[fileIndex]}${rank}`
}

/**
 * Is this one of the dark squares?
 *
 * a1 is dark, which fixes the whole board: a square is dark when its file number plus its rank is odd. This is
 * worth stating because it is the one thing about a chessboard that is easy to get backwards, and a board drawn
 * the other way up still looks like a chessboard to anybody not looking for it.
 */
export function isDarkSquare(square: string): boolean {
  const file = fileIndexOf(square)
  const rank = rankOf(square)
  if (file < 0 || rank < 0) return false
  return (file + rank) % 2 === 1
}

/**
 * The middle of a square, in world coordinates.
 *
 * The board lies flat: x runs across it, z runs up and down it, and y is height. Which way round depends on the
 * orientation, exactly as it does on the flat board -- turning the board round moves the squares rather than
 * spinning the scene, so the coordinates stay the right way up and the camera does not have to know about it.
 *
 * With White at the bottom, file a is on the left (x = -3.5) and rank 1 is nearest the viewer (z = +3.5).
 */
export function squareToWorld(square: string, orientation: Orientation = 'w'): Vec3 | null {
  const file = fileIndexOf(square)
  const rank = rankOf(square)
  if (file < 0 || rank < 0) return null
  const x = orientation === 'w' ? file - 3.5 : 3.5 - file
  const z = orientation === 'w' ? 4.5 - rank : rank - 4.5
  return { x, y: SURFACE_Y, z }
}

/**
 * The square a point on the surface falls in, or null when the point is off the board.
 *
 * Floors rather than rounds, so the boundary between two squares belongs to exactly one of them and a click on the
 * line never lands on neither.
 */
export function squareAtWorld(x: number, z: number, orientation: Orientation = 'w'): string | null {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null
  if (x < -HALF || x >= HALF || z < -HALF || z >= HALF) return null
  const across = Math.floor(x + HALF)
  const along = Math.floor(z + HALF)
  const file = orientation === 'w' ? across : 7 - across
  const rank = orientation === 'w' ? 8 - along : along + 1
  return squareName(file, rank)
}

/**
 * The square a line from the camera lands on.
 *
 * The line has to be going downward to meet a flat board at all, and it has to meet it in front of the camera
 * rather than behind it. A line that does neither returns null, which is the honest answer: the pointer is not
 * over the board, so no square was clicked.
 */
export function squareFromRay(origin: Vec3, direction: Vec3, orientation: Orientation = 'w'): string | null {
  if (!Number.isFinite(direction.y) || direction.y >= -1e-6) return null
  const distance = (SURFACE_Y - origin.y) / direction.y
  if (!Number.isFinite(distance) || distance <= 0) return null
  return squareAtWorld(origin.x + direction.x * distance, origin.z + direction.z * distance, orientation)
}

/** The outer extent of the board including its border, for sizing the frame and placing the coordinates. */
export const OUTER = HALF + FRAME

/**
 * Where a coordinate letter or number goes.
 *
 * Along the near edge for the files and the left edge for the ranks, so the labels are the ones you would read if
 * you were sitting at the board. "Near" and "left" are from the camera's default side, which is why the
 * orientation matters here too.
 */
export function fileLabelSpot(fileIndex: number, orientation: Orientation = 'w'): Vec3 {
  const square = squareName(fileIndex, 1)
  const world = square ? squareToWorld(square, orientation) : null
  const x = world ? world.x : 0
  return { x, y: SURFACE_Y + 0.02, z: (HALF + FRAME / 2) }
}

export function rankLabelSpot(rank: number, orientation: Orientation = 'w'): Vec3 {
  const square = squareName(0, rank)
  const world = square ? squareToWorld(square, orientation) : null
  const z = world ? world.z : 0
  return { x: -(HALF + FRAME / 2), y: SURFACE_Y + 0.02, z }
}
