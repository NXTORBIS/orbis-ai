/**
 * Pipeworks, kept pure: what a pipe piece is, what turning one does, where the water gets to, and how a board is
 * made.
 *
 * A piece is the four sides it is open on, so turning it is moving those four bits round by one. Water crosses
 * between two pieces only when both are open on the side they share -- a pipe pointing at a wall is a pipe pointing
 * at nothing.
 *
 * A board is made by laying real plumbing first: a path is grown from the tap until it has been through every square,
 * each piece is then set to the sides its own plumbing uses, and only then is every piece turned away from where it
 * belongs. So the board in front of the player is always a turned-around copy of plumbing that worked, and there is
 * always a way back to it. Scattering pieces at random would look the same and be unsolvable most of the time.
 */

export const N = 1
export const E = 2
export const S = 4
export const W = 8

export interface PipeBoard {
  cols: number
  rows: number
  /** One piece per cell, row by row: which sides it is open on. */
  tiles: number[]
  /** The tap feeds into this square from the west. */
  source: number
  /** The tank takes water out of this square to the east. */
  sink: number
}

/** Turning a piece clockwise moves every opening round one side. */
export const rotateMask = (mask: number, turns = 1): number => {
  const t = ((turns % 4) + 4) % 4
  return ((mask << t) | (mask >> (4 - t))) & 15
}

const OPPOSITE: Record<number, number> = { [N]: S, [E]: W, [S]: N, [W]: E }
const STEP: Record<number, { dx: number; dy: number }> = { [N]: { dx: 0, dy: -1 }, [E]: { dx: 1, dy: 0 }, [S]: { dx: 0, dy: 1 }, [W]: { dx: -1, dy: 0 } }
export const SIDES = [N, E, S, W]

const step = (board: Pick<PipeBoard, 'cols' | 'rows'>, index: number, side: number): number => {
  const x = (index % board.cols) + STEP[side].dx
  const y = Math.floor(index / board.cols) + STEP[side].dy
  if (x < 0 || y < 0 || x >= board.cols || y >= board.rows) return -1
  return y * board.cols + x
}

/**
 * How far the water has got, in pieces travelled, so the screen can show it arriving rather than appearing. Empty
 * when the tap's own piece is not open to the west, because then the water never gets in at all.
 */
export function floodDepths(board: PipeBoard): Map<number, number> {
  const depths = new Map<number, number>()
  if (!(board.tiles[board.source] & W)) return depths
  depths.set(board.source, 0)
  const queue = [board.source]
  let head = 0
  while (head < queue.length) {
    const at = queue[head++]
    for (const side of SIDES) {
      if (!(board.tiles[at] & side)) continue
      const next = step(board, at, side)
      if (next < 0 || depths.has(next) || !(board.tiles[next] & OPPOSITE[side])) continue
      depths.set(next, depths.get(at)! + 1)
      queue.push(next)
    }
  }
  return depths
}

/** Whether the water runs all the way through: into the tap's piece, along the pipes, and out of the tank's. */
export const connected = (board: PipeBoard): boolean => Boolean(board.tiles[board.sink] & E) && floodDepths(board).has(board.sink)

/** Every piece the water reaches -- the bonus for a board where nothing is left dry. */
export const filledCount = (board: PipeBoard): number => floodDepths(board).size

/** The fewest turns that put one piece the way another one sits, or -1 when they are not the same piece at all. */
export function turnsTo(from: number, to: number): number {
  for (let r = 0; r < 4; r++) if (rotateMask(from, r) === to) return r
  return -1
}

/** The fewest turns that put every piece back where the plumbing was laid. */
export const turnsToSolution = (tiles: readonly number[], solution: readonly number[]): number => tiles.reduce((sum, mask, i) => sum + Math.max(0, turnsTo(mask, solution[i])), 0)

/**
 * Lays the plumbing and then turns it away.
 *
 * The path is grown from the tap by always stepping somewhere it has not been, backing up when it is boxed in, until
 * every square has been visited -- so every piece is real plumbing and the tank is on the end of it. The tap's piece
 * is then opened to the west and the tank's to the east, which are the two openings that let the water in and out.
 */
export function generatePipes(cols: number, rows: number, random: () => number = Math.random): { board: PipeBoard; solution: number[] } {
  const count = cols * rows
  const solution = new Array<number>(count).fill(0)
  const seen = new Array<boolean>(count).fill(false)
  const source = 0
  const sink = count - 1
  const stack = [source]
  seen[source] = true
  while (stack.length) {
    const at = stack[stack.length - 1]
    const options = SIDES.filter((side) => {
      const next = step({ cols, rows }, at, side)
      return next >= 0 && !seen[next]
    })
    if (!options.length) {
      stack.pop()
      continue
    }
    const side = options[Math.floor(random() * options.length)]
    const next = step({ cols, rows }, at, side)
    solution[at] |= side
    solution[next] |= OPPOSITE[side]
    seen[next] = true
    stack.push(next)
  }
  solution[source] |= W
  solution[sink] |= E

  // Every piece is turned at random; a board that happens to come out already working is turned again.
  let tiles = solution.slice()
  for (let attempt = 0; attempt < 30; attempt++) {
    tiles = solution.map((mask) => rotateMask(mask, Math.floor(random() * 4)))
    if (!connected({ cols, rows, tiles, source, sink })) break
  }
  return { board: { cols, rows, tiles, source, sink }, solution }
}

/** The boards in a run: they get bigger, and hard starts where normal finishes. */
export function boardPlan(difficulty: 'easy' | 'normal' | 'hard'): { cols: number; rows: number }[] {
  if (difficulty === 'easy') return [{ cols: 4, rows: 3 }, { cols: 5, rows: 4 }, { cols: 5, rows: 4 }, { cols: 6, rows: 4 }]
  if (difficulty === 'hard') return [{ cols: 6, rows: 5 }, { cols: 7, rows: 5 }, { cols: 8, rows: 6 }, { cols: 9, rows: 6 }]
  return [{ cols: 5, rows: 4 }, { cols: 6, rows: 4 }, { cols: 6, rows: 5 }, { cols: 7, rows: 5 }]
}

/** What a finished board is worth: the plumbing it took to lay, less what you spent finding it. */
export const boardScore = (par: number, turns: number, everythingFilled: boolean): number => Math.max(30, Math.round(120 + par * 10 - turns * 4)) + (everythingFilled ? 80 : 0)

export interface PipeSave {
  round: number
  cols: number
  rows: number
  tiles: number[]
  solution: number[]
  turns: number
  score: number
}

export function isPipeSave(value: unknown): value is PipeSave {
  const s = value as PipeSave
  return Boolean(
    s &&
      typeof s === 'object' &&
      Number.isInteger(s.round) &&
      s.round >= 0 &&
      s.round < 12 &&
      Number.isInteger(s.cols) &&
      Number.isInteger(s.rows) &&
      s.cols >= 3 &&
      s.rows >= 3 &&
      s.cols <= 12 &&
      s.rows <= 12 &&
      Array.isArray(s.tiles) &&
      Array.isArray(s.solution) &&
      s.tiles.length === s.cols * s.rows &&
      s.solution.length === s.tiles.length &&
      s.tiles.every((mask, i) => Number.isInteger(mask) && mask >= 0 && mask <= 15 && turnsTo(mask, s.solution[i]) >= 0) &&
      Number.isFinite(s.turns) &&
      Number.isFinite(s.score)
  )
}
