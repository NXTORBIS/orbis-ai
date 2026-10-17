/**
 * Stacker's rules, kept pure so they can be tested without a canvas: the seven shapes and how they turn, whether a
 * shape fits where it is being put, the nudges that let a shape turn while it is against a wall, clearing full rows,
 * what a clear is worth, and the row of rubbish that rises on the hardest setting.
 *
 * Nothing here draws, waits or reads the clock. The screen owns the falling; this owns what is allowed.
 */

export type ShapeId = 'I' | 'J' | 'L' | 'O' | 'S' | 'T' | 'Z'

/** The order shapes are numbered in the well: well value 1 is an I, 7 is a Z, and 8 is a row of rubbish. */
export const SHAPE_IDS: readonly ShapeId[] = ['I', 'J', 'L', 'O', 'S', 'T', 'Z']
export const RUBBISH = 8

/**
 * Each shape is four squares inside a box, and turning is turning the box: a square at (x, y) in a box of side n
 * lands at (n - 1 - y, x). That is why the boxes differ -- a long shape turns inside four, most inside three, and the
 * square inside two, which is what makes it the one shape that never changes when you turn it.
 */
const SHAPES: Record<ShapeId, { box: number; cells: [number, number][] }> = {
  I: { box: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]] },
  J: { box: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]] },
  L: { box: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]] },
  O: { box: 2, cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  S: { box: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  T: { box: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]] },
  Z: { box: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]] }
}

export interface Piece {
  id: ShapeId
  rotation: number
  x: number
  y: number
}

export interface StackerState {
  cols: number
  rows: number
  /** Row by row from the top. 0 is empty; anything else is what landed there. */
  well: number[]
  piece: Piece | null
  /** What is coming next, soonest first. */
  queue: ShapeId[]
  /** The shapes left in this round of seven. */
  bag: ShapeId[]
  lines: number
  score: number
  pieces: number
  over: boolean
}

/** The four squares of a shape, turned, as offsets inside its box. */
export function shapeCells(id: ShapeId, rotation: number): [number, number][] {
  const { box, cells } = SHAPES[id]
  const turns = ((rotation % 4) + 4) % 4
  return cells.map(([x, y]) => {
    let cx = x
    let cy = y
    for (let t = 0; t < turns; t++) {
      const nx = box - 1 - cy
      cy = cx
      cx = nx
    }
    return [cx, cy] as [number, number]
  })
}

/** Where a piece's four squares really are in the well. */
export const pieceCells = (piece: Piece): [number, number][] => shapeCells(piece.id, piece.rotation).map(([x, y]) => [piece.x + x, piece.y + y] as [number, number])

/** Whether a piece can be where it is: inside the walls and the floor, and not on top of anything already landed. */
export function fits(state: Pick<StackerState, 'cols' | 'rows' | 'well'>, piece: Piece): boolean {
  for (const [x, y] of pieceCells(piece)) {
    if (x < 0 || x >= state.cols || y < 0 || y >= state.rows) return false
    if (state.well[y * state.cols + x]) return false
  }
  return true
}

/** A fresh round of all seven shapes, shuffled, so no shape is ever missing for long. */
export function refill(random: () => number): ShapeId[] {
  const bag = [...SHAPE_IDS]
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[bag[i], bag[j]] = [bag[j], bag[i]]
  }
  return bag
}

const take = (bag: ShapeId[], random: () => number): { id: ShapeId; bag: ShapeId[] } => {
  const left = bag.length ? bag : refill(random)
  return { id: left[0], bag: left.slice(1) }
}

/** The piece at the top of the well, centred, with its highest squares on the first row. */
export function startingPiece(id: ShapeId, cols: number): Piece {
  const cells = shapeCells(id, 0)
  const minX = Math.min(...cells.map((c) => c[0]))
  const maxX = Math.max(...cells.map((c) => c[0]))
  const minY = Math.min(...cells.map((c) => c[1]))
  return { id, rotation: 0, x: Math.floor((cols - (maxX - minX + 1)) / 2) - minX, y: -minY }
}

export function newGame(cols = 10, rows = 20, previews = 3, random: () => number = Math.random): StackerState {
  let bag: ShapeId[] = []
  const queue: ShapeId[] = []
  // The queue holds what is coming. Spawning takes the first and adds one to the end, so it stays this long.
  for (let i = 0; i < Math.max(1, previews); i++) {
    const drawn = take(bag, random)
    bag = drawn.bag
    queue.push(drawn.id)
  }
  const state: StackerState = { cols, rows, well: new Array<number>(cols * rows).fill(0), piece: null, queue, bag, lines: 0, score: 0, pieces: 0, over: false }
  return spawn(state, random)
}

/** Brings in the next shape. When it has no room, the game is over -- which is the only way this game ends. */
export function spawn(state: StackerState, random: () => number = Math.random): StackerState {
  const queue = [...state.queue]
  const id = queue.shift()
  if (!id) return { ...state, over: true }
  const drawn = take(state.bag, random)
  queue.push(drawn.id)
  const piece = startingPiece(id, state.cols)
  const next: StackerState = { ...state, piece, queue, bag: drawn.bag, pieces: state.pieces + 1 }
  if (!fits(next, piece)) return { ...next, piece, over: true }
  return next
}

/** Moves the falling piece, or returns null when something is in the way. */
export function move(state: StackerState, dx: number, dy: number): StackerState | null {
  if (!state.piece || state.over) return null
  const piece = { ...state.piece, x: state.piece.x + dx, y: state.piece.y + dy }
  return fits(state, piece) ? { ...state, piece } : null
}

/**
 * The nudges tried when a turn does not fit where the piece stands: one square sideways, then two (which is what a
 * long shape lying against a wall needs), then one up, then one down. Without them a piece beside a wall simply
 * refuses to turn, which feels broken rather than hard.
 */
const KICKS: [number, number][] = [[0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0], [0, -1], [0, 1]]

/** Turns the falling piece, nudging it off a wall or the floor if that is what it takes. */
export function turn(state: StackerState, direction: 1 | -1): StackerState | null {
  if (!state.piece || state.over) return null
  const rotation = (((state.piece.rotation + direction) % 4) + 4) % 4
  for (const [dx, dy] of KICKS) {
    const piece: Piece = { ...state.piece, rotation, x: state.piece.x + dx, y: state.piece.y + dy }
    if (fits(state, piece)) return { ...state, piece }
  }
  return null
}

/** How far the piece would fall if it were dropped from here. */
export function dropDistance(state: StackerState): number {
  if (!state.piece) return 0
  let distance = 0
  while (fits(state, { ...state.piece, y: state.piece.y + distance + 1 })) distance++
  return distance
}

/** Drops the piece as far as it will go, and says how far that was -- a hard drop pays by the row. */
export function drop(state: StackerState): { state: StackerState; distance: number } {
  const distance = dropDistance(state)
  return { state: distance ? (move(state, 0, distance) ?? state) : state, distance }
}

/** Takes out every full row and reports which ones went. */
export function clearRows(well: number[], cols: number, rows: number): { well: number[]; cleared: number[] } {
  const cleared: number[] = []
  const kept: number[][] = []
  for (let r = 0; r < rows; r++) {
    const row = well.slice(r * cols, r * cols + cols)
    if (row.every((v) => v)) cleared.push(r)
    else kept.push(row)
  }
  if (!cleared.length) return { well, cleared }
  const empty = Array.from({ length: cleared.length }, () => new Array<number>(cols).fill(0))
  return { well: [...empty, ...kept].flat(), cleared }
}

/**
 * What a clear pays. One row at a time is worth a quarter of what four at once are worth, and that gap is the whole
 * game: anybody can clear rows one by one, and nobody reaches a high score that way.
 */
export const LINE_SCORES = [0, 100, 300, 500, 800]
/** Clearing the well out completely. */
export const PERFECT_BONUS = 1200

export const lineScore = (cleared: number, level: number): number => LINE_SCORES[Math.min(cleared, 4)] * level

export const levelOf = (lines: number): number => 1 + Math.floor(lines / 10)

/** How long a piece takes to fall one row, in milliseconds. Easy starts gentle; hard starts fast and gets faster. */
export function dropMs(level: number, difficulty: 'easy' | 'normal' | 'hard'): number {
  const base = difficulty === 'easy' ? 950 : difficulty === 'hard' ? 620 : 800
  const quicker = difficulty === 'hard' ? 58 : 45
  return Math.max(70, Math.round(base - (level - 1) * quicker))
}

/** How many previews of what is coming you get. Knowing less is the hard part of hard. */
export const previewsFor = (difficulty: 'easy' | 'normal' | 'hard'): number => (difficulty === 'easy' ? 5 : difficulty === 'hard' ? 1 : 3)

/** How often a row of rubbish rises from the floor, in pieces placed. Never, unless you asked for hard. */
export const rubbishEvery = (difficulty: 'easy' | 'normal' | 'hard'): number => (difficulty === 'hard' ? 18 : 0)

/**
 * Lands the piece: writes it into the well, clears what filled up, and brings in the next shape. The points are
 * returned as well as added, so the screen can say what the clear was worth.
 */
export function lock(state: StackerState, random: () => number = Math.random): { state: StackerState; cleared: number; gained: number; perfect: boolean } {
  if (!state.piece) return { state, cleared: 0, gained: 0, perfect: false }
  const well = [...state.well]
  const value = SHAPE_IDS.indexOf(state.piece.id) + 1
  for (const [x, y] of pieceCells(state.piece)) well[y * state.cols + x] = value
  const result = clearRows(well, state.cols, state.rows)
  const lines = state.lines + result.cleared.length
  const perfect = result.cleared.length > 0 && result.well.every((v) => !v)
  const gained = lineScore(result.cleared.length, levelOf(state.lines)) + (perfect ? PERFECT_BONUS : 0)
  const landed: StackerState = { ...state, well: result.well, piece: null, lines, score: state.score + gained }
  return { state: spawn(landed, random), cleared: result.cleared.length, gained, perfect }
}

/**
 * Pushes a row of rubbish in under the stack, with a gap or two in it so it can always be cleared. If the stack was
 * already touching the top, this is what finishes the game.
 */
export function addRubbish(state: StackerState, random: () => number = Math.random): StackerState {
  const topRowUsed = state.well.slice(0, state.cols).some((v) => v)
  const row = new Array<number>(state.cols).fill(RUBBISH)
  const gaps = 1 + Math.floor(random() * 2)
  for (let n = 0; n < gaps; n++) row[Math.floor(random() * state.cols)] = 0
  if (!row.includes(0)) row[0] = 0
  const well = [...state.well.slice(state.cols), ...row]
  const risen: StackerState = { ...state, well }
  if (topRowUsed || (risen.piece && !fits(risen, risen.piece))) return { ...risen, over: true }
  return risen
}

/** Whether a saved game can be used. Anything else starts fresh rather than half-loading. */
export function isStackerState(value: unknown): value is StackerState {
  const s = value as StackerState
  return Boolean(
    s &&
      typeof s === 'object' &&
      Number.isInteger(s.cols) &&
      Number.isInteger(s.rows) &&
      s.cols >= 6 &&
      s.cols <= 16 &&
      s.rows >= 10 &&
      s.rows <= 30 &&
      Array.isArray(s.well) &&
      s.well.length === s.cols * s.rows &&
      s.well.every((v) => Number.isInteger(v) && v >= 0 && v <= RUBBISH) &&
      Array.isArray(s.queue) &&
      s.queue.length > 0 &&
      s.queue.every((id) => SHAPE_IDS.includes(id)) &&
      Array.isArray(s.bag) &&
      s.bag.every((id) => SHAPE_IDS.includes(id)) &&
      Number.isFinite(s.score) &&
      Number.isFinite(s.lines) &&
      (s.piece === null || (SHAPE_IDS.includes(s.piece?.id) && Number.isInteger(s.piece?.rotation)))
  )
}
