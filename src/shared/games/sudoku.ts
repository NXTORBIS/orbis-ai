/**
 * Sudoku: the rules, a solver, and a generator that proves what it hands out.
 *
 * The whole point of this file is the word *proves*. A Sudoku with two answers is worse than no Sudoku at all, because
 * the player fills it in correctly, the check says they are wrong, and they have no way of telling that from their own
 * mistake. So the generator never guesses: it takes a finished grid, and every single clue it takes away is put back
 * unless the solver can show that exactly one answer is still possible.
 *
 * Nothing here touches the screen, so all of it is tested.
 */

/** 81 numbers, row by row. 0 is an empty square. */
export type SudokuGrid = number[]

export const CELLS = 81

export const rowOf = (index: number): number => Math.floor(index / 9)
export const colOf = (index: number): number => index % 9
export const boxOf = (index: number): number => Math.floor(rowOf(index) / 3) * 3 + Math.floor(colOf(index) / 3)

/** The twenty squares that can never hold the same number as this one: its row, its column and its box. */
export function peersOf(index: number): number[] {
  const out = new Set<number>()
  const r = rowOf(index)
  const c = colOf(index)
  for (let i = 0; i < 9; i++) {
    out.add(r * 9 + i)
    out.add(i * 9 + c)
  }
  const br = Math.floor(r / 3) * 3
  const bc = Math.floor(c / 3) * 3
  for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) out.add((br + dr) * 9 + bc + dc)
  out.delete(index)
  return [...out]
}

// Candidates are kept as bits 1..9 of a number, so "which numbers are still free here" is one bitwise or.
const ALL = 0b1111111110

const bitCount = (bits: number): number => {
  let n = 0
  for (let v = bits; v; v &= v - 1) n++
  return n
}

interface Used {
  rows: number[]
  cols: number[]
  boxes: number[]
}

/** The numbers already used in each row, column and box; null when the grid breaks the rules as given. */
function usedIn(grid: SudokuGrid): Used | null {
  const used: Used = { rows: Array(9).fill(0), cols: Array(9).fill(0), boxes: Array(9).fill(0) }
  for (let i = 0; i < CELLS; i++) {
    const value = grid[i]
    if (!value) continue
    if (value < 1 || value > 9) return null
    const bit = 1 << value
    if (used.rows[rowOf(i)] & bit || used.cols[colOf(i)] & bit || used.boxes[boxOf(i)] & bit) return null
    used.rows[rowOf(i)] |= bit
    used.cols[colOf(i)] |= bit
    used.boxes[boxOf(i)] |= bit
  }
  return used
}

/**
 * Answers to a grid, up to `limit` of them.
 *
 * It always fills the square with the fewest numbers left to try, which is what makes counting two answers fast enough
 * to run after every clue the generator takes away.
 */
export function solutionsOf(grid: SudokuGrid, limit = 2, order?: () => number[]): SudokuGrid[] {
  if (grid.length !== CELLS) return []
  const used = usedIn(grid)
  if (!used) return []
  const work = grid.slice()
  const found: SudokuGrid[] = []

  const place = (index: number, value: number, on: boolean): void => {
    const bit = 1 << value
    if (on) {
      work[index] = value
      used.rows[rowOf(index)] |= bit
      used.cols[colOf(index)] |= bit
      used.boxes[boxOf(index)] |= bit
    } else {
      work[index] = 0
      used.rows[rowOf(index)] &= ~bit
      used.cols[colOf(index)] &= ~bit
      used.boxes[boxOf(index)] &= ~bit
    }
  }

  const search = (): void => {
    let target = -1
    let free = 0
    let fewest = 10
    for (let i = 0; i < CELLS; i++) {
      if (work[i]) continue
      const open = ALL & ~(used.rows[rowOf(i)] | used.cols[colOf(i)] | used.boxes[boxOf(i)])
      const count = bitCount(open)
      // Nothing fits here, so this branch is already wrong.
      if (count === 0) return
      if (count < fewest) {
        target = i
        free = open
        fewest = count
        if (count === 1) break
      }
    }
    if (target < 0) {
      found.push(work.slice())
      return
    }
    const values = order ? order() : [1, 2, 3, 4, 5, 6, 7, 8, 9]
    for (const value of values) {
      if (!(free & (1 << value))) continue
      place(target, value, true)
      search()
      place(target, value, false)
      if (found.length >= limit) return
    }
  }

  search()
  return found
}

/** The one answer, or null when there is none or more than one. */
export function solveSudoku(grid: SudokuGrid): SudokuGrid | null {
  const found = solutionsOf(grid, 2)
  return found.length === 1 ? found[0] : null
}

export const countSolutions = (grid: SudokuGrid, limit = 2): number => solutionsOf(grid, limit).length

/** Which numbers could still go in this square, going by the squares that are filled in. */
export function candidatesAt(grid: SudokuGrid, index: number): number[] {
  const taken = new Set(peersOf(index).map((p) => grid[p]))
  const out: number[] = []
  for (let value = 1; value <= 9; value++) if (!taken.has(value)) out.push(value)
  return out
}

/** Squares holding a number that another filled square in the same row, column or box already holds. */
export function conflictsIn(grid: SudokuGrid): number[] {
  const out: number[] = []
  for (let i = 0; i < CELLS; i++) {
    if (!grid[i]) continue
    if (peersOf(i).some((p) => grid[p] === grid[i])) out.push(i)
  }
  return out
}

export const isFull = (grid: SudokuGrid): boolean => grid.length === CELLS && grid.every((v) => v >= 1 && v <= 9)
export const isSolvedSudoku = (grid: SudokuGrid): boolean => isFull(grid) && conflictsIn(grid).length === 0

/** Filled squares that disagree with the answer. This is what the Check button reports. */
export function wrongCells(grid: SudokuGrid, solution: SudokuGrid): number[] {
  const out: number[] = []
  for (let i = 0; i < CELLS; i++) if (grid[i] && grid[i] !== solution[i]) out.push(i)
  return out
}

// ---------------------------------------------------------------- making one

export type SudokuDifficulty = 'easy' | 'normal' | 'hard'

/**
 * How many clues are left, and what kind of help the board gives.
 *
 * Easy keeps enough clues that every step can be found by looking at one row, column or box. Hard digs as deep as the
 * one-answer rule allows and switches the automatic marking of wrong numbers off, so a mistake is yours to find.
 */
export const SUDOKU_LEVELS: Record<SudokuDifficulty, { clues: number; markMistakes: boolean; hints: number }> = {
  easy: { clues: 45, markMistakes: true, hints: 5 },
  normal: { clues: 32, markMistakes: true, hints: 3 },
  hard: { clues: 26, markMistakes: false, hints: 1 }
}

const shuffled = <T>(items: T[], random: () => number): T[] => {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** A finished grid, different every time: the solver run on an empty grid with the numbers tried in a shuffled order. */
export function completeGrid(random: () => number = Math.random): SudokuGrid {
  const found = solutionsOf(Array(CELLS).fill(0), 1, () => shuffled([1, 2, 3, 4, 5, 6, 7, 8, 9], random))
  return found[0]
}

export interface SudokuPuzzle {
  puzzle: SudokuGrid
  solution: SudokuGrid
  /** Squares the puzzle gives you, which can never be changed. */
  given: boolean[]
  clues: number
  difficulty: SudokuDifficulty
}

/**
 * A puzzle with exactly one answer.
 *
 * Clues come away one at a time, in a random order, and each removal is kept only while the solver can still find one
 * answer and no more. The target number of clues is where it stops asking; sometimes the grid refuses to go that far,
 * and then it hands back the deepest it could honestly manage.
 */
export function generateSudoku(difficulty: SudokuDifficulty, random: () => number = Math.random): SudokuPuzzle {
  const solution = completeGrid(random)
  const puzzle = solution.slice()
  const target = SUDOKU_LEVELS[difficulty].clues
  let clues = CELLS
  for (const index of shuffled(Array.from({ length: CELLS }, (_, i) => i), random)) {
    if (clues <= target) break
    const keep = puzzle[index]
    puzzle[index] = 0
    if (countSolutions(puzzle, 2) === 1) clues--
    else puzzle[index] = keep
  }
  return { puzzle, solution, given: puzzle.map((v) => v !== 0), clues, difficulty }
}

/**
 * Points for finishing: how hard it was, less the time it took and what it cost you.
 *
 * Finishing is always worth something, however long it took, because a Sudoku solved in an hour is still a Sudoku
 * solved.
 */
export function sudokuScore(difficulty: SudokuDifficulty, seconds: number, mistakes: number, hints: number): number {
  const base = difficulty === 'hard' ? 1800 : difficulty === 'normal' ? 1100 : 650
  const spent = Math.round(Math.max(0, seconds) * 0.8) + Math.max(0, mistakes) * 25 + Math.max(0, hints) * 90
  return Math.max(60, base - spent)
}

// ---------------------------------------------------------------- saving one

export interface SudokuSave {
  puzzle: SudokuGrid
  solution: SudokuGrid
  entries: SudokuGrid
  notes: number[]
  seconds: number
  mistakes: number
  hints: number
  difficulty: SudokuDifficulty
}

const isGrid = (value: unknown): value is SudokuGrid => Array.isArray(value) && value.length === CELLS && value.every((v) => Number.isInteger(v) && v >= 0 && v <= 9)

/** A saved game is only loaded back when it is whole and its answer really answers its puzzle. */
export function isSudokuSave(value: unknown): value is SudokuSave {
  const save = value as SudokuSave
  if (!save || !isGrid(save.puzzle) || !isGrid(save.solution) || !isGrid(save.entries)) return false
  if (!Array.isArray(save.notes) || save.notes.length !== CELLS || !save.notes.every((n) => Number.isInteger(n) && n >= 0)) return false
  if (!isSolvedSudoku(save.solution)) return false
  for (let i = 0; i < CELLS; i++) if (save.puzzle[i] && save.puzzle[i] !== save.solution[i]) return false
  return ['easy', 'normal', 'hard'].includes(save.difficulty)
}
