/**
 * The rules of the offline puzzle games, kept pure so they can be tested: 2048-style sliding, Minesweeper boards and
 * reveals, Memory Match decks, and typing speed and accuracy.
 */

// ---------------------------------------------------------------- number puzzle (2048-style)

export type Grid = number[][]

export const emptyGrid = (size: number): Grid => Array.from({ length: size }, () => Array<number>(size).fill(0))

/** Slides one row to the left, merging equal neighbours once each. */
export function slideRow(row: number[]): { row: number[]; gained: number; moved: boolean } {
  const values = row.filter((v) => v)
  const out: number[] = []
  let gained = 0
  for (let i = 0; i < values.length; i++) {
    if (values[i] === values[i + 1]) {
      out.push(values[i] * 2)
      gained += values[i] * 2
      i++
    } else out.push(values[i])
  }
  while (out.length < row.length) out.push(0)
  return { row: out, gained, moved: out.some((v, i) => v !== row[i]) }
}

export type Direction = 'left' | 'right' | 'up' | 'down'

export function move(grid: Grid, direction: Direction): { grid: Grid; gained: number; moved: boolean } {
  const n = grid.length
  const next = emptyGrid(n)
  let gained = 0
  let moved = false
  for (let i = 0; i < n; i++) {
    const line = Array.from({ length: n }, (_, j) => (direction === 'left' ? grid[i][j] : direction === 'right' ? grid[i][n - 1 - j] : direction === 'up' ? grid[j][i] : grid[n - 1 - j][i]))
    const result = slideRow(line)
    gained += result.gained
    moved ||= result.moved
    result.row.forEach((v, j) => {
      if (direction === 'left') next[i][j] = v
      else if (direction === 'right') next[i][n - 1 - j] = v
      else if (direction === 'up') next[j][i] = v
      else next[n - 1 - j][i] = v
    })
  }
  return { grid: next, gained, moved }
}

/** Adds a 2 (or, one time in ten, a 4) to a random empty cell. */
export function spawnTile(grid: Grid, random = Math.random): Grid {
  const empty: [number, number][] = []
  grid.forEach((row, i) => row.forEach((v, j) => !v && empty.push([i, j])))
  if (!empty.length) return grid
  const [i, j] = empty[Math.floor(random() * empty.length)]
  const next = grid.map((row) => [...row])
  next[i][j] = random() < 0.9 ? 2 : 4
  return next
}

export const canMove = (grid: Grid): boolean => (['left', 'right', 'up', 'down'] as const).some((d) => move(grid, d).moved)

export const maxTile = (grid: Grid): number => Math.max(0, ...grid.flat())

export function isGrid(value: unknown): value is Grid {
  return Array.isArray(value) && value.length >= 3 && value.length <= 8 && value.every((row) => Array.isArray(row) && row.length === value.length && row.every((v) => Number.isInteger(v) && v >= 0))
}

// ---------------------------------------------------------------- minesweeper

export interface MineCell {
  mine: boolean
  adjacent: number
  revealed: boolean
  flagged: boolean
}

export interface MineBoard {
  rows: number
  cols: number
  mines: number
  cells: MineCell[]
  /** Mines are placed on the first reveal, never on or next to it. */
  placed: boolean
  lost: boolean
  won: boolean
}

export const MINE_LEVELS = {
  easy: { rows: 9, cols: 9, mines: 10 },
  normal: { rows: 16, cols: 16, mines: 40 },
  hard: { rows: 16, cols: 30, mines: 99 }
} as const

export function newBoard(rows: number, cols: number, mines: number): MineBoard {
  return { rows, cols, mines: Math.min(mines, rows * cols - 9), cells: Array.from({ length: rows * cols }, () => ({ mine: false, adjacent: 0, revealed: false, flagged: false })), placed: false, lost: false, won: false }
}

export function neighbours(board: Pick<MineBoard, 'rows' | 'cols'>, index: number): number[] {
  const r = Math.floor(index / board.cols)
  const c = index % board.cols
  const out: number[] = []
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue
      const nr = r + dr
      const nc = c + dc
      if (nr >= 0 && nc >= 0 && nr < board.rows && nc < board.cols) out.push(nr * board.cols + nc)
    }
  return out
}

function placeMines(board: MineBoard, safeIndex: number, random: () => number): void {
  const forbidden = new Set([safeIndex, ...neighbours(board, safeIndex)])
  const candidates = board.cells.map((_, i) => i).filter((i) => !forbidden.has(i))
  for (let placed = 0; placed < board.mines && candidates.length; placed++) {
    const pick = Math.floor(random() * candidates.length)
    board.cells[candidates[pick]].mine = true
    candidates.splice(pick, 1)
  }
  board.cells.forEach((cell, i) => (cell.adjacent = neighbours(board, i).filter((n) => board.cells[n].mine).length))
  board.placed = true
}

const cloneBoard = (board: MineBoard): MineBoard => ({ ...board, cells: board.cells.map((c) => ({ ...c })) })

/** Reveals a cell; empty areas open up to their numbered edge. Returns a new board. */
export function reveal(board: MineBoard, index: number, random = Math.random): MineBoard {
  const next = cloneBoard(board)
  if (next.lost || next.won) return next
  const cell = next.cells[index]
  if (!cell || cell.flagged || cell.revealed) return next
  if (!next.placed) placeMines(next, index, random)
  if (cell.mine) {
    cell.revealed = true
    next.lost = true
    for (const c of next.cells) if (c.mine) c.revealed = true
    return next
  }
  const queue = [index]
  while (queue.length) {
    const i = queue.pop()!
    const c = next.cells[i]
    if (c.revealed || c.flagged) continue
    c.revealed = true
    if (c.adjacent === 0) for (const n of neighbours(next, i)) if (!next.cells[n].revealed && !next.cells[n].mine) queue.push(n)
  }
  next.won = next.cells.every((c) => c.mine || c.revealed)
  return next
}

/** On a revealed number whose flags all are placed, reveals the rest of its neighbours. */
export function chord(board: MineBoard, index: number): MineBoard {
  const cell = board.cells[index]
  if (!cell?.revealed || !cell.adjacent) return board
  const around = neighbours(board, index)
  if (around.filter((n) => board.cells[n].flagged).length !== cell.adjacent) return board
  let next = board
  for (const n of around) if (!next.cells[n].flagged && !next.cells[n].revealed) next = reveal(next, n)
  return next
}

export function toggleFlag(board: MineBoard, index: number): MineBoard {
  const cell = board.cells[index]
  if (!cell || cell.revealed || board.lost || board.won) return board
  const next = cloneBoard(board)
  next.cells[index].flagged = !cell.flagged
  return next
}

export function isBoard(value: unknown): value is MineBoard {
  const b = value as MineBoard
  return Boolean(b && Number.isInteger(b.rows) && Number.isInteger(b.cols) && Array.isArray(b.cells) && b.cells.length === b.rows * b.cols && b.cells.every((c) => c && typeof c.mine === 'boolean'))
}

// ---------------------------------------------------------------- memory match

/** A shuffled deck of pairs (Fisher–Yates). */
export function deal<T>(faces: T[], pairs: number, random = Math.random): T[] {
  const deck = faces.slice(0, pairs).flatMap((f) => [f, f])
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[deck[i], deck[j]] = [deck[j], deck[i]]
  }
  return deck
}

/** Fewer moves and less time score higher; never below a floor for finishing. */
export const memoryScore = (pairs: number, moves: number, seconds: number): number => Math.max(pairs * 10, Math.round(pairs * 100 - Math.max(0, moves - pairs) * 12 - seconds * 2))

// ---------------------------------------------------------------- typing

/** Standard words per minute (five characters per word), counting only correct characters. */
export function typingStats(target: string, typed: string, ms: number): { wpm: number; accuracy: number; correct: number; errors: number } {
  let correct = 0
  for (let i = 0; i < typed.length; i++) if (typed[i] === target[i]) correct++
  const errors = typed.length - correct
  const minutes = Math.max(ms, 1) / 60000
  return { wpm: Math.round(correct / 5 / minutes), accuracy: typed.length ? Math.round((correct / typed.length) * 100) : 100, correct, errors }
}
