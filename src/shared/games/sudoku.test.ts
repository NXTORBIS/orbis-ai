import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { candidatesAt, CELLS, completeGrid, conflictsIn, countSolutions, generateSudoku, isSolvedSudoku, isSudokuSave, peersOf, solveSudoku, solutionsOf, SUDOKU_LEVELS, sudokuScore, wrongCells, type SudokuGrid } from './sudoku.ts'

/** A small repeatable random, so a failure here can be run again and come out the same. */
const seeded = (seed: number): (() => number) => {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 4294967296
  }
}

const read = (text: string): SudokuGrid => text.replace(/[^0-9.]/g, '').split('').map((c) => (c === '.' ? 0 : Number(c)))

describe('the rules', () => {
  it('a square shares a row, a column and a box with twenty others', () => {
    assert.equal(peersOf(0).length, 20)
    assert.ok(peersOf(0).includes(8))
    assert.ok(peersOf(0).includes(72))
    assert.ok(peersOf(0).includes(10))
    assert.ok(!peersOf(0).includes(0))
    assert.ok(!peersOf(0).includes(30))
  })

  it('names the squares that clash, and says nothing about an empty board', () => {
    const grid: SudokuGrid = Array(CELLS).fill(0)
    assert.deepEqual(conflictsIn(grid), [])
    grid[0] = 5
    grid[4] = 5
    assert.deepEqual(conflictsIn(grid), [0, 4])
    grid[4] = 0
    grid[10] = 5 // same box
    assert.deepEqual(conflictsIn(grid), [0, 10])
    grid[10] = 0
    grid[72] = 5 // same column
    assert.deepEqual(conflictsIn(grid), [0, 72])
  })

  it('lists what could still go in a square', () => {
    const grid: SudokuGrid = Array(CELLS).fill(0)
    grid[1] = 1
    grid[2] = 2
    grid[9] = 3
    assert.deepEqual(candidatesAt(grid, 0), [4, 5, 6, 7, 8, 9])
  })
})

describe('the solver', () => {
  const puzzle = read(`
    53..7....
    6..195...
    .98....6.
    8...6...3
    4..8.3..1
    7...2...6
    .6....28.
    ...419..5
    ....8..79
  `)

  it('finds the one answer to a puzzle that has one', () => {
    const answer = solveSudoku(puzzle)
    assert.ok(answer)
    assert.ok(isSolvedSudoku(answer))
    // The clues it was given are untouched.
    for (let i = 0; i < CELLS; i++) if (puzzle[i]) assert.equal(answer[i], puzzle[i])
    assert.equal(countSolutions(puzzle, 2), 1)
  })

  it('refuses a grid that already breaks the rules', () => {
    const broken = puzzle.slice()
    broken[2] = 5 // a second 5 in the top row and the top-left box
    assert.equal(countSolutions(broken, 2), 0)
    assert.equal(solveSudoku(broken), null)
    assert.equal(countSolutions(Array(CELLS).fill(0), 2), 2)
  })

  it('counts two answers where there really are two, rather than picking one', () => {
    /*
     * The shape that makes a Sudoku ambiguous: four squares in two rows and two columns of the same stack of boxes,
     * holding two numbers crosswise. Empty those four and the two numbers can go in either way round -- both rows
     * keep the same pair, both columns keep the same pair, and both boxes keep the same pair -- so the puzzle has two
     * answers and no clue anywhere can tell them apart.
     *
     * The columns have to be in the same stack. With the four squares in four different boxes the swap always breaks
     * a box, because every box holds every number once, which is the first thing this test got wrong.
     */
    let found: number[] | null = null
    let solution: SudokuGrid = []
    for (let seed = 1; seed <= 40 && !found; seed++) {
      solution = completeGrid(seeded(seed * 31))
      for (let r1 = 0; r1 < 9 && !found; r1++)
        for (let r2 = r1 + 1; r2 < 9 && !found; r2++)
          for (let c1 = 0; c1 < 9 && !found; c1++)
            for (let c2 = c1 + 1; c2 < 9 && !found; c2++) {
              if (Math.floor(c1 / 3) !== Math.floor(c2 / 3)) continue
              if (solution[r1 * 9 + c1] !== solution[r2 * 9 + c2] || solution[r1 * 9 + c2] !== solution[r2 * 9 + c1]) continue
              found = [r1 * 9 + c1, r1 * 9 + c2, r2 * 9 + c1, r2 * 9 + c2]
            }
    }
    assert.ok(found, 'no crosswise pair found in forty finished grids')
    const ambiguous = solution.slice()
    for (const index of found) ambiguous[index] = 0
    assert.equal(countSolutions(ambiguous, 3), 2)
    assert.equal(solveSudoku(ambiguous), null)
  })

  it('fills an empty grid differently each time it is asked', () => {
    const one = completeGrid(seeded(11))
    const two = completeGrid(seeded(12))
    assert.ok(isSolvedSudoku(one))
    assert.ok(isSolvedSudoku(two))
    assert.notDeepEqual(one, two)
    // The limit is honoured: asking for one answer returns one.
    assert.equal(solutionsOf(Array(CELLS).fill(0), 1).length, 1)
  })
})

describe('making a puzzle', () => {
  /*
   * The one thing that must never be wrong.
   *
   * A Sudoku with two answers cannot be told apart from a mistake of the player's own: they fill it in correctly, the
   * check says no, and there is nothing they can do about it. So every puzzle the generator hands out is counted here,
   * at every difficulty, over many rolls of the dice.
   */
  for (const difficulty of ['easy', 'normal', 'hard'] as const) {
    it(`always has exactly one answer on ${difficulty}`, () => {
      for (let seed = 1; seed <= 14; seed++) {
        const made = generateSudoku(difficulty, seeded(seed * 977))
        assert.equal(countSolutions(made.puzzle, 2), 1, `seed ${seed} on ${difficulty} does not have exactly one answer`)
        assert.ok(isSolvedSudoku(made.solution))
        assert.deepEqual(made.given, made.puzzle.map((v) => v !== 0))
        for (let i = 0; i < CELLS; i++) if (made.puzzle[i]) assert.equal(made.puzzle[i], made.solution[i])
        assert.equal(made.clues, made.puzzle.filter((v) => v !== 0).length)
        // It got at least close to the number of clues it was aiming for.
        assert.ok(made.clues <= SUDOKU_LEVELS[difficulty].clues + 6, `${difficulty} seed ${seed} stopped at ${made.clues} clues`)
      }
    })
  }

  it('digs deeper for a harder puzzle', () => {
    const easy = generateSudoku('easy', seeded(5))
    const hard = generateSudoku('hard', seeded(5))
    assert.ok(hard.clues < easy.clues, `easy left ${easy.clues} clues and hard left ${hard.clues}`)
    assert.equal(SUDOKU_LEVELS.hard.markMistakes, false)
    assert.ok(SUDOKU_LEVELS.easy.hints > SUDOKU_LEVELS.hard.hints)
  })
})

describe('checking and scoring', () => {
  it('names only the filled squares that disagree with the answer', () => {
    const solution = completeGrid(seeded(3))
    const grid = solution.slice()
    grid[5] = 0
    grid[7] = (solution[7] % 9) + 1
    assert.deepEqual(wrongCells(grid, solution), [7])
  })

  it('pays more for a harder puzzle and less for time, mistakes and help, and never nothing', () => {
    assert.ok(sudokuScore('hard', 300, 0, 0) > sudokuScore('normal', 300, 0, 0))
    assert.ok(sudokuScore('normal', 60, 0, 0) > sudokuScore('normal', 600, 0, 0))
    assert.ok(sudokuScore('normal', 60, 0, 0) > sudokuScore('normal', 60, 4, 0))
    assert.ok(sudokuScore('normal', 60, 0, 0) > sudokuScore('normal', 60, 0, 2))
    assert.equal(sudokuScore('easy', 99999, 99, 99), 60)
  })
})

describe('a saved game', () => {
  const made = generateSudoku('easy', seeded(21))
  const save = { puzzle: made.puzzle, solution: made.solution, entries: made.puzzle.slice(), notes: Array(CELLS).fill(0), seconds: 12, mistakes: 0, hints: 0, difficulty: 'easy' as const }

  it('comes back when it is whole', () => {
    assert.ok(isSudokuSave(save))
  })

  it('is refused when it is not', () => {
    assert.equal(isSudokuSave(null), false)
    assert.equal(isSudokuSave({ ...save, puzzle: [1, 2, 3] }), false)
    assert.equal(isSudokuSave({ ...save, notes: [] }), false)
    assert.equal(isSudokuSave({ ...save, difficulty: 'brutal' }), false)
    // An answer that is not a finished Sudoku, or a puzzle whose clues disagree with it, is not loaded back.
    assert.equal(isSudokuSave({ ...save, solution: Array(CELLS).fill(1) }), false)
    const crossed = made.puzzle.slice()
    const spot = crossed.findIndex((v) => v !== 0)
    crossed[spot] = (crossed[spot] % 9) + 1
    assert.equal(isSudokuSave({ ...save, puzzle: crossed }), false)
  })
})
