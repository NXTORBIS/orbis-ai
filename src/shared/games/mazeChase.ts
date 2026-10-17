/**
 * Maze Chase: the maze, and what the four hunters want.
 *
 * The maze is built, not drawn by hand, so every level is new — which means it has to be proved walkable. Walls are
 * rectangular islands that never touch each other or the outer wall, which leaves the corridors joined up; then the
 * maze is walked from the player's start and anything that walk cannot reach is filled in. After that, every dot on
 * the board is reachable by definition, and the test checks exactly that over many mazes.
 *
 * The hunters are the game. Each one wants a different square: one comes straight at you, one aims at where you are
 * going, one loses interest when you are close, and one hangs back behind you. They all walk the same way — at every
 * square, take the opening that gets closest to what you want, and never turn back on yourself — so the difference
 * between them is entirely the square they are aiming at.
 */

export interface Spot {
  x: number
  y: number
}

export interface Maze {
  cols: number
  rows: number
  walls: boolean[]
  dots: boolean[]
  pills: boolean[]
  /** The row that runs out of one side and in at the other. */
  tunnelRow: number
  /** Where the player starts. */
  start: Spot
  /** Where the hunters start, and go back to when they are eaten. */
  home: Spot
  /** The four squares the hunters break off to, one each. */
  corners: Spot[]
}

export type HunterKind = 'chaser' | 'ambusher' | 'erratic' | 'keeper'

export const HUNTER_KINDS: HunterKind[] = ['chaser', 'ambusher', 'erratic', 'keeper']

/** What each hunter is like, in the player's words. */
export const HUNTER_NOTES: Record<HunterKind, string> = {
  chaser: 'comes straight at you',
  ambusher: 'aims where you are going',
  erratic: 'wanders once you are close',
  keeper: 'hangs back behind you'
}

export const at = (maze: Pick<Maze, 'cols'>, x: number, y: number): number => y * maze.cols + x

export const insideMaze = (maze: Maze, x: number, y: number): boolean => x >= 0 && y >= 0 && x < maze.cols && y < maze.rows

/** The tunnel: leaving one side of that row brings you in at the other. */
export const wrapX = (maze: Maze, x: number, y: number): number => (y === maze.tunnelRow ? ((x % maze.cols) + maze.cols) % maze.cols : x)

export function isWall(maze: Maze, x: number, y: number): boolean {
  const wx = wrapX(maze, x, y)
  if (!insideMaze(maze, wx, y)) return true
  return maze.walls[at(maze, wx, y)]
}

const DIRS: Spot[] = [
  { x: 0, y: -1 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 1, y: 0 }
]

export const walkDirections = (): Spot[] => DIRS.map((d) => ({ ...d }))

const manhattan = (a: Spot, b: Spot): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)

// ---------------------------------------------------------------- building a maze

interface Block {
  x: number
  y: number
  w: number
  h: number
}

/** Every square a block covers, plus the ring of squares around it: nothing else may be built there. */
function blockClear(blocked: boolean[], maze: Pick<Maze, 'cols' | 'rows'>, block: Block): boolean {
  for (let y = block.y - 1; y <= block.y + block.h; y++)
    for (let x = block.x - 1; x <= block.x + block.w; x++) {
      if (x < 0 || y < 0 || x >= maze.cols || y >= maze.rows) continue
      if (blocked[y * maze.cols + x]) return false
    }
  return true
}

export interface MazeOptions {
  cols?: number
  rows?: number
  /** How many walls to try to build. More walls means a tighter maze. */
  attempts?: number
}

/**
 * Builds a maze. Walls are kept one square clear of each other and of the outer wall, which is what keeps the
 * corridors joined; then anything unreachable is filled in, so what is left is walkable end to end.
 */
export function buildMaze(random: () => number, options: MazeOptions = {}): Maze {
  const cols = options.cols ?? 23
  const rows = options.rows ?? 15
  const attempts = options.attempts ?? 70
  const tunnelRow = Math.floor(rows / 2)
  const walls = Array.from({ length: cols * rows }, () => false)
  const grid = { cols, rows }

  for (let x = 0; x < cols; x++) {
    walls[0 * cols + x] = true
    walls[(rows - 1) * cols + x] = true
  }
  for (let y = 0; y < rows; y++) {
    walls[y * cols] = true
    walls[y * cols + cols - 1] = true
  }
  // The tunnel mouths are the only gaps in the outer wall.
  walls[tunnelRow * cols] = false
  walls[tunnelRow * cols + cols - 1] = false

  const centre = Math.floor((cols - 1) / 2)
  const home: Spot = { x: centre, y: tunnelRow }
  const start: Spot = { x: centre, y: rows - 2 }

  const blocked = Array.from({ length: cols * rows }, () => false)
  for (let tries = 0; tries < attempts; tries++) {
    const w = 1 + Math.floor(random() * 3)
    const h = 1 + Math.floor(random() * 3)
    const x = 2 + Math.floor(random() * Math.max(1, cols - 4 - (w - 1)))
    const y = 2 + Math.floor(random() * Math.max(1, rows - 4 - (h - 1)))
    const block: Block = { x, y, w, h }
    const mirrored: Block = { x: cols - 1 - (x + w - 1), y, w, h }
    const onTunnel = (b: Block): boolean => tunnelRow >= b.y && tunnelRow < b.y + b.h
    const fits = (b: Block): boolean =>
      b.x >= 2 && b.y >= 2 && b.x + b.w <= cols - 2 && b.y + b.h <= rows - 2 && !onTunnel(b) && blockClear(blocked, grid, b)
    if (!fits(block)) continue
    // The mirror image goes up with it where it fits, which is what gives the maze its symmetry.
    const pair: Block[] = fits(mirrored) && mirrored.x > block.x + block.w ? [block, mirrored] : [block]
    let ok = true
    const taken = blocked.slice()
    for (const b of pair) {
      if (!blockClear(taken, grid, b)) {
        ok = false
        break
      }
      for (let yy = b.y; yy < b.y + b.h; yy++) for (let xx = b.x; xx < b.x + b.w; xx++) taken[yy * cols + xx] = true
    }
    if (!ok) continue
    for (let i = 0; i < taken.length; i++) if (taken[i]) blocked[i] = true
  }
  for (let i = 0; i < walls.length; i++) if (blocked[i]) walls[i] = true
  // The hunters need their own patch of floor in the middle.
  for (let dx = -2; dx <= 2; dx++) walls[tunnelRow * cols + Math.min(cols - 2, Math.max(1, centre + dx))] = false
  walls[start.y * cols + start.x] = false

  const maze: Maze = { cols, rows, walls, dots: walls.map(() => false), pills: walls.map(() => false), tunnelRow, start, home, corners: [] }

  // Walk the maze from the start; anything that walk never reaches is filled in, so nothing is left stranded.
  const seen = walls.map(() => false)
  const queue: Spot[] = [start]
  seen[at(maze, start.x, start.y)] = true
  while (queue.length) {
    const spot = queue.shift()!
    for (const d of DIRS) {
      const y = spot.y + d.y
      if (y < 0 || y >= rows) continue
      const x = wrapX(maze, spot.x + d.x, y)
      if (x < 0 || x >= cols) continue
      const i = at(maze, x, y)
      if (seen[i] || walls[i]) continue
      seen[i] = true
      queue.push({ x, y })
    }
  }
  for (let i = 0; i < walls.length; i++) if (!walls[i] && !seen[i]) walls[i] = true

  const corners: Spot[] = [
    { x: 1, y: 1 },
    { x: cols - 2, y: 1 },
    { x: 1, y: rows - 2 },
    { x: cols - 2, y: rows - 2 }
  ]
  maze.corners = corners
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const i = at(maze, x, y)
      if (walls[i]) continue
      const isHome = y === tunnelRow && Math.abs(x - home.x) <= 2
      maze.dots[i] = !isHome && !(x === start.x && y === start.y)
    }
  for (const corner of corners) {
    const i = at(maze, corner.x, corner.y)
    maze.pills[i] = true
    maze.dots[i] = false
  }
  return maze
}

export const dotsLeft = (maze: Maze): number => maze.dots.filter(Boolean).length + maze.pills.filter(Boolean).length

/** Every open square the player can walk to from the start, counted by walking there. */
export function reachable(maze: Maze, from: Spot = maze.start): boolean[] {
  const seen = maze.walls.map(() => false)
  const queue: Spot[] = [from]
  seen[at(maze, from.x, from.y)] = true
  while (queue.length) {
    const spot = queue.shift()!
    for (const d of DIRS) {
      const y = spot.y + d.y
      if (y < 0 || y >= maze.rows) continue
      const x = wrapX(maze, spot.x + d.x, y)
      const i = at(maze, x, y)
      if (x < 0 || x >= maze.cols || seen[i] || maze.walls[i]) continue
      seen[i] = true
      queue.push({ x, y })
    }
  }
  return seen
}

// ---------------------------------------------------------------- the hunters

export interface ChaseSituation {
  player: Spot
  /** The way the player is facing, one square. */
  facing: Spot
  hunter: Spot
  /** This hunter's own corner. */
  corner: Spot
  corners: Spot[]
  /** How many squares ahead the ambusher aims. */
  look: number
  /** The erratic hunter's current whim, 0 to 1. */
  whim: number
  frightened: boolean
  cols: number
  rows: number
}

const clampSpot = (s: ChaseSituation, spot: Spot): Spot => ({ x: Math.min(s.cols - 1, Math.max(0, Math.round(spot.x))), y: Math.min(s.rows - 1, Math.max(0, Math.round(spot.y))) })

/** The square a hunter is trying to get to. This, and only this, is what makes the four of them different. */
export function hunterTarget(kind: HunterKind, s: ChaseSituation): Spot {
  if (s.frightened) {
    // Running away: head for the point directly opposite the player.
    return clampSpot(s, { x: s.hunter.x + (s.hunter.x - s.player.x) * 2, y: s.hunter.y + (s.hunter.y - s.player.y) * 2 })
  }
  const gap = manhattan(s.hunter, s.player)
  switch (kind) {
    case 'chaser':
      return { ...s.player }
    case 'ambusher':
      return clampSpot(s, { x: s.player.x + s.facing.x * s.look, y: s.player.y + s.facing.y * s.look })
    case 'erratic':
      // Interested from a distance, distractible up close.
      return gap > 8 ? { ...s.player } : { ...s.corners[Math.min(s.corners.length - 1, Math.floor(s.whim * s.corners.length))] }
    case 'keeper':
      // Too close and it backs off; at middling range it waits behind you, cutting off the way back.
      if (gap <= 5) return { ...s.corner }
      if (gap <= 12) return clampSpot(s, { x: s.player.x - s.facing.x * 5, y: s.player.y - s.facing.y * 5 })
      return { ...s.player }
  }
}

/** How far apart two squares are, counting the tunnel as the short way round. */
export function gapTo(maze: Maze, from: Spot, to: Spot): number {
  const dx = Math.abs(from.x - to.x)
  const dy = Math.abs(from.y - to.y)
  const short = from.y === maze.tunnelRow && to.y === maze.tunnelRow ? Math.min(dx, maze.cols - dx) : dx
  return short + dy
}

/**
 * One step of a hunter's walk: of the openings here, take the one that gets closest to the target, and never turn
 * back on yourself unless there is nowhere else to go. Returns the direction to move in.
 */
export function hunterStep(maze: Maze, pos: Spot, dir: Spot, target: Spot, mayReverse = false): Spot {
  const open = DIRS.filter((d) => {
    const y = pos.y + d.y
    if (y < 0 || y >= maze.rows) return false
    return !isWall(maze, pos.x + d.x, y)
  })
  if (!open.length) return { x: 0, y: 0 }
  const back = open.filter((d) => !(d.x === -dir.x && d.y === -dir.y) || mayReverse)
  const choices = back.length ? back : open
  let best = choices[0]
  let bestGap = Infinity
  for (const d of choices) {
    const next = { x: wrapX(maze, pos.x + d.x, pos.y + d.y), y: pos.y + d.y }
    const gap = gapTo(maze, next, target)
    if (gap < bestGap) {
      bestGap = gap
      best = d
    }
  }
  return { ...best }
}

// ---------------------------------------------------------------- points and levels

export const DOT_POINTS = 10
export const PILL_POINTS = 50
/** Each hunter caught while the pill lasts is worth more than the last. */
export const HUNTER_POINTS = [200, 400, 800, 1600]
export const clearBonus = (level: number): number => 500 * level

export interface MazeLevel {
  /** Squares per second. */
  playerSpeed: number
  hunterSpeed: number
  /** How long a power pill lasts, in seconds. */
  fright: number
  lives: number
  /** How far ahead the ambusher aims. */
  look: number
  /** How often the erratic hunter changes its mind, in seconds. */
  whimEvery: number
  /** How many walls the maze is built with. */
  attempts: number
}

export const MAZE_LEVELS: Record<'easy' | 'normal' | 'hard', MazeLevel> = {
  easy: { playerSpeed: 5.4, hunterSpeed: 3.8, fright: 9, lives: 4, look: 3, whimEvery: 4, attempts: 100 },
  normal: { playerSpeed: 5.8, hunterSpeed: 4.7, fright: 7, lives: 3, look: 4, whimEvery: 3, attempts: 150 },
  hard: { playerSpeed: 6, hunterSpeed: 5.5, fright: 4, lives: 3, look: 6, whimEvery: 1.8, attempts: 210 }
}

/**
 * Later levels are faster and the pills wear off sooner, but the hunters never get much quicker than the player: a
 * maze you cannot out-walk is not a chase, it is a countdown.
 */
export function levelTuning(base: MazeLevel, level: number): { hunterSpeed: number; fright: number } {
  return { hunterSpeed: Math.min(base.playerSpeed + 0.3, base.hunterSpeed + (level - 1) * 0.35), fright: Math.max(2, base.fright - (level - 1) * 0.6) }
}
