/**
 * Road Cross: the rules of a crossing, and the proof that it can be made.
 *
 * Everything here is whole squares and whole ticks, which is the point. A car or a log moves by one square at a time,
 * so the traffic can never jump over you, and the whole state of a level at tick `t` is worked out from `t` alone.
 * That means the search at the bottom of this file -- which asks "can somebody get from the kerb to each home bay
 * before the time runs out?" -- is an exact answer rather than a sample, and it runs on the same rules the game plays
 * by, not a copy of them.
 *
 * Why that matters: a generated crossing nobody can make looks exactly like a player being bad at it. The generator
 * refuses to hand out a level until the search says every home bay can be reached, so that bug cannot ship.
 *
 * The drawing is somebody else's problem. A row's things glide between squares on screen (see `roadCross.ts` in the
 * games folder), and they land on the square at the same moment the rules here say they have.
 */

import { range, seeded } from './random.ts'

export const COLS = 13
/** Row 0 is the kerb you start on; row 12 is the row of home bays; the river and the road are the rows between. */
export const ROWS = 13
export const HOME_ROW = ROWS - 1
/** The strip of grass halfway up, where nothing can hurt you. */
export const MEDIAN_ROW = 6
export const HOME_COLS = [0, 3, 6, 9, 12]
export const START_COL = 6
/** The model counts in thirtieths of a second. */
export const TICK_HZ = 30
/** A move is taken on every third tick, so holding a key cannot out-run the traffic. */
export const MOVE_TICKS = 3
/** A turtle row is under water for three steps out of every thirteen, and starts sinking on the twelfth. */
export const DIVE_CYCLE = 13
export const DIVE_FROM = 10

export type LaneKind = 'kerb' | 'road' | 'river' | 'home'

export interface Lane {
  kind: LaneKind
  /** Which way the row travels: -1 towards the left, 1 towards the right, 0 for a row that holds still. */
  dir: -1 | 0 | 1
  /** How many ticks one square takes. Smaller is faster. */
  ticksPerStep: number
  /** One flag per column -- a car on a road row, something to stand on a river row. It repeats round the row. */
  mask: boolean[]
  /** River rows: a log stays up, a turtle goes under. */
  float?: 'log' | 'turtle'
}

export interface Level {
  lanes: Lane[]
  /** How long one crossing may take, in ticks. */
  timerTicks: number
  seed: number
  difficulty: Difficulty
}

export type Difficulty = 'easy' | 'normal' | 'hard'
export type Action = 'wait' | 'up' | 'down' | 'left' | 'right'
export type Death = 'traffic' | 'water' | 'swept' | 'time'

export interface Position {
  row: number
  col: number
}

export interface TickResult extends Position {
  /** The tick this result describes: one after the one handed in. */
  tick: number
  /** The home bay just filled, by its place in `HOME_COLS`, or null. */
  home: number | null
  death: Death | null
  /** The move was turned down -- the grid's edge, or the hedge between two home bays. */
  blocked: boolean
}

// ---------------------------------------------------------------- what is where, at a given tick

/** How many squares a row has moved by this tick. */
export const laneStep = (lane: Lane, tick: number): number => (lane.ticksPerStep > 0 ? Math.floor(tick / lane.ticksPerStep) : 0)

/** Whether the row moved a square between the tick before this one and this one. */
export const laneStepped = (lane: Lane, tick: number): boolean => tick > 0 && laneStep(lane, tick) !== laneStep(lane, tick - 1)

/** Whether a car (road) or something to stand on (river) is in this square at this tick. */
export function occupied(lane: Lane, col: number, tick: number): boolean {
  const length = lane.mask.length
  if (!length) return false
  const shift = laneStep(lane, tick) * lane.dir
  return lane.mask[(((col - shift) % length) + length) % length]
}

/** A turtle row is under water for part of its cycle; a log row never is. */
export function diving(lane: Lane, tick: number): boolean {
  if (lane.float !== 'turtle') return false
  return laneStep(lane, tick) % DIVE_CYCLE >= DIVE_FROM
}

/** How far through its dive a turtle row is, 0 to 1, so the drawing can warn before it goes under. */
export function divePhase(lane: Lane, tick: number): number {
  if (lane.float !== 'turtle') return 0
  const within = laneStep(lane, tick) % DIVE_CYCLE
  return within >= DIVE_FROM - 1 ? (within - (DIVE_FROM - 1)) / (DIVE_CYCLE - DIVE_FROM + 1) : 0
}

/** What standing on this square at this tick does to you. */
export function standing(level: Level, row: number, col: number, tick: number): Death | null {
  const lane = level.lanes[row]
  if (!lane) return null
  if (lane.kind === 'road') return occupied(lane, col, tick) ? 'traffic' : null
  if (lane.kind === 'river') return occupied(lane, col, tick) && !diving(lane, tick) ? null : 'water'
  return null
}

export const isHomeCol = (col: number): boolean => HOME_COLS.includes(col)

// ---------------------------------------------------------------- one tick

/**
 * One tick of a crossing: the move (when this tick allows one), then the rows move, then whatever that leaves you
 * standing on. The game and the search below both go through here, so neither can be playing different rules.
 */
export function tickCrossing(level: Level, from: Position, tick: number, action: Action): TickResult {
  let { row, col } = from
  let blocked = false
  if (action !== 'wait' && tick % MOVE_TICKS === 0) {
    let nextRow = row
    let nextCol = col
    if (action === 'up') nextRow = row + 1
    else if (action === 'down') nextRow = row - 1
    else if (action === 'left') nextCol = col - 1
    else nextCol = col + 1
    const offGrid = nextRow < 0 || nextRow >= ROWS || nextCol < 0 || nextCol >= COLS
    // The hedge between the home bays is not a square you can be in.
    const hedge = nextRow === HOME_ROW && !isHomeCol(nextCol)
    if (offGrid || hedge) blocked = true
    else {
      row = nextRow
      col = nextCol
    }
  }
  if (row === HOME_ROW) {
    // Only a bay counts. Being on the home row anywhere else cannot happen -- the hedge refuses the move -- and if it
    // somehow did, "no bay" is the honest answer rather than bay number minus one.
    const bay = HOME_COLS.indexOf(col)
    return { row, col, tick: tick + 1, home: bay >= 0 ? bay : null, death: null, blocked }
  }

  const next = tick + 1
  const lane = level.lanes[row]
  // A river row carries you with it, and over the edge if that is where it is going.
  if (lane.kind === 'river' && laneStepped(lane, next)) {
    col += lane.dir
    if (col < 0 || col >= COLS) return { row, col: Math.max(0, Math.min(COLS - 1, col)), tick: next, home: null, death: 'swept', blocked }
  }
  return { row, col, tick: next, home: null, death: standing(level, row, col, next), blocked }
}

// ---------------------------------------------------------------- can it be done?

const key = (row: number, col: number): number => row * COLS + col

/**
 * Which home bays can be reached from the kerb inside the time limit.
 *
 * A complete search, not a sample: at every tick there are at most 169 places to be, so the whole set of them is
 * carried forward one tick at a time until the time runs out. If a bay is not in the answer, nobody can reach it --
 * which is the one thing a generated level must never do.
 */
export function reachableHomes(level: Level, startCol = START_COL): boolean[] {
  const found = HOME_COLS.map(() => false)
  let frontier = new Set<number>([key(0, startCol)])
  const actions: Action[] = ['wait', 'up', 'down', 'left', 'right']
  for (let tick = 0; tick < level.timerTicks && frontier.size; tick++) {
    const next = new Set<number>()
    for (const at of frontier) {
      const from = { row: Math.floor(at / COLS), col: at % COLS }
      for (const action of tick % MOVE_TICKS === 0 ? actions : (['wait'] as Action[])) {
        const result = tickCrossing(level, from, tick, action)
        if (result.home !== null) {
          found[result.home] = true
          continue
        }
        if (!result.death) next.add(key(result.row, result.col))
      }
    }
    frontier = next
    if (found.every(Boolean)) return found
  }
  return found
}

export const solvable = (level: Level): boolean => reachableHomes(level).every(Boolean)

// ---------------------------------------------------------------- making a level

interface Shape {
  road: { ticks: [number, number]; car: [number, number]; gap: [number, number] }
  river: { ticks: [number, number]; float: [number, number]; gap: [number, number]; turtles: number }
  timerTicks: number
}

const SHAPES: Record<Difficulty, Shape> = {
  easy: { road: { ticks: [9, 14], car: [1, 2], gap: [3, 5] }, river: { ticks: [10, 16], float: [3, 5], gap: [1, 2], turtles: 1 }, timerTicks: 60 * TICK_HZ },
  normal: { road: { ticks: [6, 11], car: [1, 2], gap: [2, 4] }, river: { ticks: [7, 13], float: [2, 4], gap: [1, 2], turtles: 2 }, timerTicks: 45 * TICK_HZ },
  hard: { road: { ticks: [4, 9], car: [1, 3], gap: [2, 3] }, river: { ticks: [5, 11], float: [2, 3], gap: [1, 2], turtles: 3 }, timerTicks: 35 * TICK_HZ }
}

/**
 * A row of things with gaps between them, laid out so that it reads the same way round the wrap: the pattern always
 * ends on empty squares, so the last thing in the row can never be joined to the first one.
 */
function makeMask(rng: () => number, thing: [number, number], gap: [number, number], atLeast: number): boolean[] {
  // Clamped, because a "thing" wider than the row would lay out an empty row -- a river nobody can cross.
  const low = Math.max(1, Math.min(4, thing[0]))
  const high = Math.max(low, Math.min(5, thing[1]))
  const gapLow = Math.max(1, Math.min(5, gap[0]))
  const gapHigh = Math.max(gapLow, Math.min(6, gap[1]))
  const cells: boolean[] = []
  let things = 0
  while (cells.length < COLS) {
    const width = range(rng, low, high)
    const space = range(rng, gapLow, gapHigh)
    if (cells.length + width + space > COLS) break
    for (let i = 0; i < width; i++) cells.push(true)
    for (let i = 0; i < space; i++) cells.push(false)
    things++
  }
  while (cells.length < COLS) cells.push(false)
  if (things < atLeast) {
    // Too few fitted. Lay them out by hand instead, evenly, and keep the last square empty so the wrap stays a gap.
    cells.fill(false)
    const stride = Math.max(low + gapLow, Math.floor((COLS - 1) / atLeast))
    for (let start = 0; start + low <= COLS - 1; start += stride) for (let i = 0; i < low; i++) cells[start + i] = true
  }
  return cells
}

function build(seed: number, difficulty: Difficulty, looseness: number): Level {
  const rng = seeded(seed)
  const shape = SHAPES[difficulty]
  const lanes: Lane[] = []
  for (let row = 0; row < ROWS; row++) {
    if (row === 0 || row === MEDIAN_ROW) {
      lanes.push({ kind: 'kerb', dir: 0, ticksPerStep: 0, mask: [] })
      continue
    }
    if (row === HOME_ROW) {
      lanes.push({ kind: 'home', dir: 0, ticksPerStep: 0, mask: [] })
      continue
    }
    const dir: -1 | 1 = row % 2 === 0 ? 1 : -1
    const slower = (from: number, to: number): number => range(rng, Math.min(20, from + looseness), Math.min(22, Math.max(from + looseness, to + looseness * 2)))
    if (row < MEDIAN_ROW) {
      lanes.push({ kind: 'road', dir, ticksPerStep: slower(shape.road.ticks[0], shape.road.ticks[1]), mask: makeMask(rng, shape.road.car, [shape.road.gap[0] + looseness, shape.road.gap[1] + looseness], 1) })
      continue
    }
    const ticks = slower(shape.river.ticks[0], shape.river.ticks[1])
    // The turtle rows are the ones nearest the top, so the dive is the last thing between you and a home bay.
    const turtle = row >= ROWS - 1 - shape.river.turtles
    lanes.push({ kind: 'river', dir, ticksPerStep: ticks, float: turtle ? 'turtle' : 'log', mask: makeMask(rng, [shape.river.float[0] + looseness, shape.river.float[1] + looseness], shape.river.gap, 2) })
  }
  return { lanes, timerTicks: shape.timerTicks, seed, difficulty }
}

/**
 * A crossing that can be made. Each try is looser than the last -- slower rows, wider gaps in the traffic, longer logs
 * -- and nothing is handed back until the search says every home bay is reachable. The loosest try is sparse enough
 * that it is always crossable, and the test holds that claim to a thousand seeds.
 */
export function makeLevel(seed: number, difficulty: Difficulty = 'normal'): Level {
  for (let attempt = 0; attempt < 12; attempt++) {
    const level = build((seed + attempt * 0x9e3779b9) >>> 0, difficulty, attempt)
    if (solvable(level)) return level
  }
  return gentleLevel(seed, difficulty)
}

/**
 * The crossing of last resort: slow traffic with a five-square gap behind every car, long logs, and no turtles. It is
 * written out by hand rather than generated so that there is something solvable to fall back to, and the test checks
 * it alongside the generated ones.
 */
export function gentleLevel(seed = 1, difficulty: Difficulty = 'easy'): Level {
  // One car at each end of a five-square gap; logs four squares long with two squares of water between them.
  const road = Array.from({ length: COLS }, (_, col) => col === 0 || col === 6)
  const float = Array.from({ length: COLS }, (_, col) => col < 4 || (col >= 6 && col < 10))
  const lanes: Lane[] = []
  for (let row = 0; row < ROWS; row++) {
    if (row === 0 || row === MEDIAN_ROW) lanes.push({ kind: 'kerb', dir: 0, ticksPerStep: 0, mask: [] })
    else if (row === HOME_ROW) lanes.push({ kind: 'home', dir: 0, ticksPerStep: 0, mask: [] })
    else if (row < MEDIAN_ROW) lanes.push({ kind: 'road', dir: row % 2 === 0 ? 1 : -1, ticksPerStep: 12, mask: [...road] })
    else lanes.push({ kind: 'river', dir: row % 2 === 0 ? 1 : -1, ticksPerStep: 14, float: 'log', mask: [...float] })
  }
  return { lanes, timerTicks: 60 * TICK_HZ, seed, difficulty }
}

// ---------------------------------------------------------------- the score

export const ROW_POINTS = 10
export const HOME_POINTS = 150
export const ALL_HOMES_POINTS = 500

/**
 * What a crossing is worth: every row you got further than you ever have this life, the home bay itself, what was left
 * on the clock, and a lump for filling all five.
 */
export function crossingScore(opts: { rowsForward: number; homesFilled: number; ticksLeft: number }): number {
  const time = Math.max(0, Math.round(opts.ticksLeft / TICK_HZ)) * 5
  return Math.max(0, opts.rowsForward) * ROW_POINTS + opts.homesFilled * HOME_POINTS + time + (opts.homesFilled >= HOME_COLS.length ? ALL_HOMES_POINTS : 0)
}
