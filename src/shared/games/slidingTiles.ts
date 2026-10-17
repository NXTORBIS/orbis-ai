/**
 * Sliding Tiles (the fifteen puzzle): the gap, what a slide moves, and which shuffles can be solved at all.
 *
 * Half of all the ways you could lay these tiles out cannot be solved, however long anybody works at them. A shuffle
 * that lands on one of those is not a hard puzzle, it is a lie. Two things here prevent it. The shuffle is a walk of
 * real slides away from the finished board, so it can always be walked back. And `isTilesSolvable` can tell, of any
 * arrangement at all, which half it is in — which is what a saved game is checked against before it is loaded.
 *
 * Nothing here touches the screen.
 */

/** The tiles, row by row. 0 is the gap. */
export type Tiles = number[]

export type TileDifficulty = 'easy' | 'normal' | 'hard'

/** Three, four or five tiles across. Four across is the fifteen puzzle everybody means. */
export const TILE_SIZES: Record<TileDifficulty, number> = { easy: 3, normal: 4, hard: 5 }

export const solvedTiles = (size: number): Tiles => Array.from({ length: size * size }, (_, i) => (i === size * size - 1 ? 0 : i + 1))

export const isTilesSolved = (tiles: Tiles): boolean => tiles.every((t, i) => t === (i === tiles.length - 1 ? 0 : i + 1))

export const gapOf = (tiles: Tiles): number => tiles.indexOf(0)

/** Pairs of tiles that are the wrong way round. The gap is not a tile and takes no part. */
export function inversions(tiles: Tiles): number {
  const order = tiles.filter((t) => t !== 0)
  let count = 0
  for (let i = 0; i < order.length; i++) for (let j = i + 1; j < order.length; j++) if (order[i] > order[j]) count++
  return count
}

/**
 * Whether this arrangement can be reached from the finished board.
 *
 * Every slide swaps the gap with one neighbour, which flips whether the number of out-of-order pairs is odd or even
 * and also moves the gap one row. On an odd-width board a sideways slide changes nothing about the rows, so the rule
 * is only about the pairs; on an even-width board the gap's row has to be counted in too.
 */
export function isTilesSolvable(tiles: Tiles, size: number): boolean {
  if (tiles.length !== size * size) return false
  const gapRow = Math.floor(gapOf(tiles) / size)
  return size % 2 === 1 ? inversions(tiles) % 2 === 0 : (inversions(tiles) + gapRow) % 2 === 1
}

/** The squares a slide could come from: the tiles touching the gap. */
export function slidable(tiles: Tiles, size: number): number[] {
  const gap = gapOf(tiles)
  const r = Math.floor(gap / size)
  const c = gap % size
  const out: number[] = []
  if (r > 0) out.push(gap - size)
  if (r < size - 1) out.push(gap + size)
  if (c > 0) out.push(gap - 1)
  if (c < size - 1) out.push(gap + 1)
  return out
}

/**
 * The slide that starts at this square.
 *
 * Clicking a tile that is not next to the gap but is in the same row or column still slides: the whole run between it
 * and the gap shuffles along. It saves a great many clicks and it is the one thing that makes a five-across board
 * bearable. Null when that square cannot reach the gap in a straight line.
 */
export function slideAt(tiles: Tiles, size: number, index: number): { tiles: Tiles; moved: number[] } | null {
  const gap = gapOf(tiles)
  if (index < 0 || index >= tiles.length || index === gap) return null
  const gr = Math.floor(gap / size)
  const gc = gap % size
  const r = Math.floor(index / size)
  const c = index % size
  if (r !== gr && c !== gc) return null
  const step = r === gr ? (c < gc ? 1 : -1) : c === gc ? (r < gr ? size : -size) : 0
  const next = tiles.slice()
  const moved: number[] = []
  // Walk from the gap towards the square that was clicked, pulling each tile one place along.
  for (let hole = gap; hole !== index; hole -= step) {
    next[hole] = next[hole - step]
    moved.push(hole - step)
  }
  next[index] = 0
  return { tiles: next, moved }
}

export type TileDirection = 'up' | 'down' | 'left' | 'right'

/** The keyboard slide: the tile on that side of the gap moves into it, so the arrow points the way the tile goes. */
export function slideByKey(tiles: Tiles, size: number, direction: TileDirection): { tiles: Tiles; moved: number[] } | null {
  const gap = gapOf(tiles)
  const r = Math.floor(gap / size)
  const c = gap % size
  if (direction === 'left') return c === size - 1 ? null : slideAt(tiles, size, gap + 1)
  if (direction === 'right') return c === 0 ? null : slideAt(tiles, size, gap - 1)
  if (direction === 'up') return r === size - 1 ? null : slideAt(tiles, size, gap + size)
  return r === 0 ? null : slideAt(tiles, size, gap - size)
}

/**
 * A shuffle made of real slides, so it can always be undone.
 *
 * It never slides a tile straight back where it came from, which is what stops a long walk from wandering in circles
 * near the finished board, and it keeps going until the tiles are a decent distance from home.
 */
export function shuffleTiles(size: number, random: () => number = Math.random, walk = size * size * 14): Tiles {
  let tiles = solvedTiles(size)
  let last = -1
  for (let step = 0; step < walk; step++) {
    const choices = slidable(tiles, size).filter((i) => i !== last)
    const pick = choices[Math.floor(random() * choices.length)]
    last = gapOf(tiles)
    tiles = slideAt(tiles, size, pick)!.tiles
  }
  // A walk can wander back towards the finished board, and on a small one it sometimes does. Keep going until the
  // tiles are a decent way from home, which cannot take long: every slide moves one tile one place.
  for (let push = 0; push < 400 && tileDistance(tiles, size) < size * 2; push++) {
    const choices = slidable(tiles, size).filter((i) => i !== last)
    const pick = choices[Math.floor(random() * choices.length)]
    last = gapOf(tiles)
    tiles = slideAt(tiles, size, pick)!.tiles
  }
  return tiles
}

/** How far every tile is from where it belongs, counted in slides. It can only be as low as 0 when you have finished. */
export function tileDistance(tiles: Tiles, size: number): number {
  let total = 0
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i]
    if (!tile) continue
    const home = tile - 1
    total += Math.abs(Math.floor(i / size) - Math.floor(home / size)) + Math.abs((i % size) - (home % size))
  }
  return total
}

/** Tiles already in their own place: what the board says about how you are getting on. */
export const tilesHome = (tiles: Tiles): number => tiles.filter((t, i) => t !== 0 && t === i + 1).length

/**
 * The time that goes on the board, in thousandths of a second.
 *
 * It is the time it really took and nothing else. This game is scored on time, lower being better, and a bigger board
 * is honestly slower -- so the end of a game says which board it was rather than quietly adjusting the clock to make
 * three sizes look comparable.
 */
export const tileTime = (ms: number): number => Math.max(1, Math.round(ms))

/** Minutes and seconds, for the clock on screen. */
export function tileClock(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

// ---------------------------------------------------------------- saving one

export interface TileSave {
  tiles: Tiles
  size: number
  moves: number
  ms: number
  difficulty: TileDifficulty
}

/** A saved board is only loaded back when it holds each tile once and is one of the half that can be finished. */
export function isTileSave(value: unknown): value is TileSave {
  const save = value as TileSave
  if (!save || !Number.isInteger(save.size) || save.size < 3 || save.size > 6) return false
  if (!Array.isArray(save.tiles) || save.tiles.length !== save.size * save.size) return false
  const seen = new Set(save.tiles)
  if (seen.size !== save.tiles.length || !save.tiles.every((t) => Number.isInteger(t) && t >= 0 && t < save.tiles.length)) return false
  if (!Number.isInteger(save.moves) || save.moves < 0 || !Number.isFinite(save.ms) || save.ms < 0) return false
  if (!isTilesSolvable(save.tiles, save.size)) return false
  return ['easy', 'normal', 'hard'].includes(save.difficulty)
}
