/**
 * Four in a Row: the rules and the opponent, kept pure so both can be tested.
 *
 * The board is one flat list, column by column, each column filled from the bottom: index = column * 6 + row, row 0
 * is the bottom cell. That is the order counters actually land in, so dropping is a push and nothing has to be
 * shuffled around. The opponent is a minimax search with alpha-beta cutoffs; the one thing it must never do is miss a
 * win it can take now or a win it has to stop, so that is checked first at every position and tested directly.
 */

export const C4_COLS = 7
export const C4_ROWS = 6

export type C4Player = 1 | 2
export type C4Cell = 0 | 1 | 2
export type C4Difficulty = 'easy' | 'normal' | 'hard'

export interface C4Board {
  cells: C4Cell[]
  /** Counters played so far. */
  moves: number
  /** Who has won, or 0 while nobody has. */
  winner: C4Cell
  /** The board is full and nobody won. */
  draw: boolean
  /** The cells of the winning line, for the board to mark. */
  line: number[]
}

export const cellIndex = (col: number, row: number): number => col * C4_ROWS + row

export const otherPlayer = (player: C4Player): C4Player => (player === 1 ? 2 : 1)

export const newC4Board = (): C4Board => ({ cells: Array.from({ length: C4_COLS * C4_ROWS }, () => 0 as C4Cell), moves: 0, winner: 0, draw: false, line: [] })

/** How many counters are already in a column. */
export function columnHeight(cells: readonly C4Cell[], col: number): number {
  let height = 0
  while (height < C4_ROWS && cells[cellIndex(col, height)]) height++
  return height
}

export const columnOpen = (board: C4Board, col: number): boolean => col >= 0 && col < C4_COLS && !board.winner && !board.draw && columnHeight(board.cells, col) < C4_ROWS

export function legalColumns(board: C4Board): number[] {
  const out: number[] = []
  for (let col = 0; col < C4_COLS; col++) if (columnOpen(board, col)) out.push(col)
  return out
}

const DIRECTIONS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1]
] as const

/**
 * The run of four or more through one cell, in any of the four directions: up the column, across, and both diagonals.
 * Returns the cells of that run, or an empty list when there is none.
 */
export function runThrough(cells: readonly C4Cell[], col: number, row: number): number[] {
  const player = cells[cellIndex(col, row)]
  if (!player) return []
  for (const [dc, dr] of DIRECTIONS) {
    const run = [cellIndex(col, row)]
    for (const sign of [1, -1]) {
      let c = col + dc * sign
      let r = row + dr * sign
      while (c >= 0 && c < C4_COLS && r >= 0 && r < C4_ROWS && cells[cellIndex(c, r)] === player) {
        run.push(cellIndex(c, r))
        c += dc * sign
        r += dr * sign
      }
    }
    if (run.length >= 4) return run
  }
  return []
}

/** Whether dropping into (col, row) would finish a line — asked before the counter is there. */
function winsAt(cells: readonly C4Cell[], col: number, row: number, player: C4Player): boolean {
  for (const [dc, dr] of DIRECTIONS) {
    let inLine = 1
    for (const sign of [1, -1]) {
      let c = col + dc * sign
      let r = row + dr * sign
      while (c >= 0 && c < C4_COLS && r >= 0 && r < C4_ROWS && cells[cellIndex(c, r)] === player) {
        inLine++
        c += dc * sign
        r += dr * sign
      }
    }
    if (inLine >= 4) return true
  }
  return false
}

/** Drops a counter down a column. Returns a new board, or null when the column is full or the game is already over. */
export function dropAt(board: C4Board, col: number, player: C4Player): C4Board | null {
  if (!columnOpen(board, col)) return null
  const row = columnHeight(board.cells, col)
  const cells = board.cells.slice()
  cells[cellIndex(col, row)] = player
  const line = runThrough(cells, col, row)
  const moves = board.moves + 1
  return { cells, moves, winner: line.length ? player : 0, draw: !line.length && moves >= C4_COLS * C4_ROWS, line }
}

/** The columns where this player wins by dropping now. */
export function immediateWins(board: C4Board, player: C4Player): number[] {
  const out: number[] = []
  for (const col of legalColumns(board)) if (winsAt(board.cells, col, columnHeight(board.cells, col), player)) out.push(col)
  return out
}

// ---------------------------------------------------------------- the opponent

/** Centre first: a counter in the middle column belongs to more possible lines than one at the edge. */
const ORDER = [3, 2, 4, 1, 5, 0, 6]

const WIN = 1_000_000

/** Every four-in-a-row the board holds, as cell indexes. Built once. */
const WINDOWS: number[][] = (() => {
  const out: number[][] = []
  for (let col = 0; col < C4_COLS; col++)
    for (let row = 0; row < C4_ROWS; row++)
      for (const [dc, dr] of DIRECTIONS) {
        const lastCol = col + dc * 3
        const lastRow = row + dr * 3
        if (lastCol >= C4_COLS || lastRow < 0 || lastRow >= C4_ROWS) continue
        out.push([0, 1, 2, 3].map((k) => cellIndex(col + dc * k, row + dr * k)))
      }
  return out
})()

/**
 * How good a position looks when nobody has won yet: count the fours that are still open to one side only. Three with
 * a gap is nearly a win, so it counts for a lot; the opponent's three counts for slightly more than our own, which
 * makes the search defend rather than race.
 */
function evaluate(cells: readonly C4Cell[], player: C4Player): number {
  const foe = otherPlayer(player)
  let score = 0
  for (const window of WINDOWS) {
    let mine = 0
    let theirs = 0
    for (const i of window) {
      const v = cells[i]
      if (v === player) mine++
      else if (v === foe) theirs++
    }
    if (mine && theirs) continue
    if (mine === 3) score += 60
    else if (mine === 2) score += 12
    else if (mine === 1) score += 2
    else if (theirs === 3) score -= 75
    else if (theirs === 2) score -= 14
    else if (theirs === 1) score -= 2
  }
  for (let row = 0; row < C4_ROWS; row++) {
    const v = cells[cellIndex(3, row)]
    if (v === player) score += 6
    else if (v === foe) score -= 6
  }
  return score
}

function negamax(cells: C4Cell[], heights: number[], player: C4Player, depth: number, alpha: number, beta: number): number {
  const moves: number[] = []
  for (const col of ORDER) if (heights[col] < C4_ROWS) moves.push(col)
  if (!moves.length) return 0
  // A win now beats anything deeper, and a deeper win is worth less than a quick one, so the depth is in the score.
  for (const col of moves) if (winsAt(cells, col, heights[col], player)) return WIN + depth
  if (depth <= 0) return evaluate(cells, player)
  let best = -Infinity
  for (const col of moves) {
    const row = heights[col]
    cells[cellIndex(col, row)] = player
    heights[col]++
    const value = -negamax(cells, heights, otherPlayer(player), depth - 1, -beta, -Math.max(alpha, best))
    cells[cellIndex(col, row)] = 0
    heights[col]--
    if (value > best) best = value
    if (best >= beta) break
  }
  return best
}

function shuffled(values: number[], random: () => number): number[] {
  const out = values.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * The best column this player has, searched to `depth` moves ahead. Equally good columns are picked between at
 * random, so the opponent does not play the same game twice.
 */
export function bestMove(board: C4Board, player: C4Player, depth: number, random: () => number = Math.random): number {
  const moves = shuffled(legalColumns(board), random)
  if (!moves.length) return -1
  const cells = board.cells.slice()
  const heights = Array.from({ length: C4_COLS }, (_, col) => columnHeight(cells, col))
  let bestCol = moves[0]
  let best = -Infinity
  for (const col of moves) {
    const row = heights[col]
    let value: number
    if (winsAt(cells, col, row, player)) value = WIN + depth
    else {
      cells[cellIndex(col, row)] = player
      heights[col]++
      value = -negamax(cells, heights, otherPlayer(player), depth - 1, -Infinity, best === -Infinity ? Infinity : -best)
      cells[cellIndex(col, row)] = 0
      heights[col]--
    }
    if (value > best) {
      best = value
      bestCol = col
    }
  }
  return bestCol
}

/**
 * How far ahead the opponent looks, and how often it simply plays badly. The blunder is what makes easy winnable: a
 * search that never slips, however shallow, beats a beginner every time.
 */
export const C4_LEVELS: Record<C4Difficulty, { depth: number; blunder: number }> = {
  easy: { depth: 2, blunder: 0.55 },
  normal: { depth: 5, blunder: 0.1 },
  hard: { depth: 7, blunder: 0 }
}

export function chooseMove(board: C4Board, player: C4Player, difficulty: C4Difficulty, random: () => number = Math.random): number {
  const level = C4_LEVELS[difficulty]
  const moves = legalColumns(board)
  if (!moves.length) return -1
  if (level.blunder > 0 && random() < level.blunder) return moves[Math.min(moves.length - 1, Math.floor(random() * moves.length))]
  return bestMove(board, player, level.depth, random)
}

/** A finished game's points: winning is worth most, winning quickly worth more, and a hard opponent worth more again. */
export function c4Score(outcome: 'win' | 'draw' | 'loss', moves: number, difficulty: C4Difficulty): number {
  const weight = difficulty === 'hard' ? 3 : difficulty === 'normal' ? 2 : 1
  const base = outcome === 'win' ? 600 : outcome === 'draw' ? 200 : 40
  const quick = outcome === 'win' ? Math.max(0, C4_COLS * C4_ROWS - moves) * 15 : 0
  return base * weight + quick
}

export function isC4Board(value: unknown): value is C4Board {
  const b = value as C4Board
  if (!b || !Array.isArray(b.cells) || b.cells.length !== C4_COLS * C4_ROWS) return false
  if (!b.cells.every((c) => c === 0 || c === 1 || c === 2)) return false
  if (!Number.isInteger(b.moves) || b.moves < 0 || b.moves > C4_COLS * C4_ROWS) return false
  // No counter may float above a gap: that board never came from this game.
  for (let col = 0; col < C4_COLS; col++) {
    let gap = false
    for (let row = 0; row < C4_ROWS; row++) {
      if (!b.cells[cellIndex(col, row)]) gap = true
      else if (gap) return false
    }
  }
  return b.cells.filter((c) => c).length === b.moves
}
