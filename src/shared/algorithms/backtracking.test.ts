import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isAlgorithmError, type Run } from './trace.ts'
import {
  BACKTRACK_NAMES,
  hanoi,
  permutations,
  queens,
  runBacktrack,
  subsets,
  type ChoiceResult,
  type HanoiResult,
  type QueensResult
} from './backtracking.ts'

/**
 * Recursion and backtracking, checked against counts that are known in advance.
 *
 * Every expectation here is arithmetic nobody has to trust the code for: Hanoi takes exactly 2ⁿ − 1 moves, there are
 * exactly n! arrangements and 2ⁿ subsets, and the number of N-Queens solutions for each board size is a published
 * sequence. A test that only asserted "it produced something" would pass on an algorithm that quietly missed half
 * the answers.
 */

const ran = (what: string, run: Run | { error: string; message: string }): Run => {
  assert.ok(!isAlgorithmError(run), `${what} was refused: ${isAlgorithmError(run) ? run.message : ''}`)
  return run as Run
}

describe('Towers of Hanoi', () => {
  it('takes exactly 2^n - 1 moves', () => {
    for (let discs = 1; discs <= 8; discs += 1) {
      const result = ran(`hanoi(${discs})`, hanoi(discs)).result as HanoiResult
      assert.equal(result.moves.length, 2 ** discs - 1, `hanoi(${discs}) made ${result.moves.length} moves`)
      assert.equal(result.fewest, 2 ** discs - 1)
    }
  })

  it('never puts a larger disc on a smaller one', () => {
    const result = ran('hanoi(5)', hanoi(5)).result as HanoiResult
    const pegs: Record<string, number[]> = { A: [5, 4, 3, 2, 1], B: [], C: [] }
    for (const move of result.moves) {
      const top = pegs[move.from].pop()
      assert.equal(top, move.disc, `the move claims disc ${move.disc} but the top of ${move.from} was ${top}`)
      const landing = pegs[move.to][pegs[move.to].length - 1]
      assert.ok(landing === undefined || landing > move.disc, `disc ${move.disc} was put on the smaller disc ${landing}`)
      pegs[move.to].push(move.disc)
    }
    assert.deepEqual(pegs.C, [5, 4, 3, 2, 1], 'the discs did not all end on peg C in order')
    assert.deepEqual(pegs.A, [])
    assert.deepEqual(pegs.B, [])
  })

  it('refuses what it will not run', () => {
    assert.ok(isAlgorithmError(hanoi(0)))
    assert.ok(isAlgorithmError(hanoi(30)))
    assert.ok(isAlgorithmError(hanoi(2.5)))
  })
})

describe('permutations', () => {
  it('finds exactly n! of them, all different', () => {
    for (let count = 1; count <= 6; count += 1) {
      const items = Array.from({ length: count }, (_, one) => one + 1)
      const result = ran(`permutations of ${count}`, permutations(items)).result as ChoiceResult
      const expected = items.reduce((out, _, at) => out * (at + 1), 1)
      assert.equal(result.found.length, expected, `${count} items gave ${result.found.length} arrangements, not ${expected}`)
      assert.equal(result.expected, expected)
      const seen = new Set(result.found.map((one) => one.join(',')))
      assert.equal(seen.size, expected, 'an arrangement was produced twice')
      for (const one of result.found) {
        assert.equal(one.length, count)
        assert.equal(new Set(one).size, count, `an arrangement repeats an item: ${one.join(',')}`)
      }
    }
  })

  it('records putting an item back, not just taking it', () => {
    const run = ran('permutations', permutations([1, 2, 3]))
    const kinds = run.steps.map((one) => one.kind)
    assert.ok(kinds.includes('push'), 'nothing was ever taken')
    assert.ok(kinds.includes('pop'), 'nothing was ever put back, so the trace cannot show backtracking')
  })
})

describe('subsets', () => {
  it('finds exactly 2^n of them, all different', () => {
    for (let count = 1; count <= 8; count += 1) {
      const items = Array.from({ length: count }, (_, one) => one + 1)
      const result = ran(`subsets of ${count}`, subsets(items)).result as ChoiceResult
      assert.equal(result.found.length, 2 ** count, `${count} items gave ${result.found.length} subsets`)
      const seen = new Set(result.found.map((one) => [...one].sort().join(',')))
      assert.equal(seen.size, 2 ** count, 'a subset was produced twice')
    }
  })

  it('includes the empty subset and the whole set', () => {
    const result = ran('subsets', subsets([1, 2, 3])).result as ChoiceResult
    const shown = result.found.map((one) => one.join(','))
    assert.ok(shown.includes(''), 'the empty subset is missing')
    assert.ok(shown.includes('1,2,3'), 'the whole set is missing')
  })
})

describe('N-Queens', () => {
  /** The published number of solutions for each board size. Not from this code. */
  const KNOWN: Readonly<Record<number, number>> = { 1: 1, 2: 0, 3: 0, 4: 2, 5: 10, 6: 4, 7: 40, 8: 92 }

  it('finds the known number of solutions for every board up to eight', () => {
    for (const [size, count] of Object.entries(KNOWN)) {
      const result = ran(`queens(${size})`, queens(Number(size))).result as QueensResult
      assert.equal(result.solutions.length, count, `a ${size}x${size} board has ${count} solutions and this found ${result.solutions.length}`)
    }
  })

  it('every solution it reports is genuinely safe', () => {
    const result = ran('queens(8)', queens(8)).result as QueensResult
    for (const board of result.solutions) {
      assert.equal(new Set(board).size, board.length, `two queens share a column: ${board.join(',')}`)
      for (let row = 0; row < board.length; row += 1) {
        for (let other = row + 1; other < board.length; other += 1) {
          assert.notEqual(
            Math.abs(board[row] - board[other]),
            other - row,
            `two queens share a diagonal: ${board.join(',')}`
          )
        }
      }
    }
  })

  it('counts what it took back, which is most of the work', () => {
    const run = ran('queens(6)', queens(6))
    const result = run.result as QueensResult
    assert.ok(result.removals > result.solutions.length, 'a backtracking search that never took a queen back did not backtrack')
    assert.ok(
      run.steps.some((one) => one.kind === 'pop'),
      'no removal was recorded, so the board on screen would change with no cause'
    )
  })

  it('says plainly when there is no answer', () => {
    const run = ran('queens(3)', queens(3))
    const result = run.result as QueensResult
    assert.equal(result.solutions.length, 0)
    assert.ok(
      run.steps.some((one) => one.says.includes('no way to place')),
      'an impossible board finished without saying so'
    )
  })

  it('refuses a board it will not trace', () => {
    assert.ok(isAlgorithmError(queens(0)))
    assert.ok(isAlgorithmError(queens(20)))
  })
})

describe('the registry', () => {
  it('runs every name through one door', () => {
    for (const name of BACKTRACK_NAMES) {
      const run = ran(name, runBacktrack(name, { n: 4, items: [1, 2, 3] }))
      assert.ok(run.steps.length > 0, `${name} recorded nothing`)
    }
  })

  it('refuses a name it does not have', () => {
    assert.ok(isAlgorithmError(runBacktrack('nope' as never, {})))
  })
})
