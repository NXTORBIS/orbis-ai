import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ALGORITHM_CODE, codeFor } from './code.ts'
import { CATALOGUE, entryFor } from './catalogue.ts'
import { isAlgorithmError, lineAt, varsAt, type Run } from './trace.ts'
import { bubbleSort, countingSort, heapSort, insertionSort, mergeSort, quickSort, radixSort, selectionSort } from './sorting.ts'
import {
  bitonicSort,
  bogoSort,
  bottomUpMergeSort,
  bucketSort,
  cocktailSort,
  combSort,
  cycleSort,
  introSort,
  gnomeSort,
  oddEvenSort,
  pancakeSort,
  shellSort,
  stoogeSort,
  threeWayQuickSort,
  timSort,
  treeSort
} from './sorting.more.ts'
import {
  binarySearch,
  exponentialSearch,
  fibonacciSearch,
  interpolationSearch,
  jumpSearch,
  linearSearch,
  ternarySearch
} from './searching.ts'
import { aStar, bellmanFord, breadthFirst, depthFirst, dijkstra, kruskal, topologicalSort } from './graphs.ts'
import { makeGraph, type MadeGraph } from './inputs.ts'
import { fibonacci, knapsack, longestCommonSubsequence, longestIncreasingSubsequence } from './dynamic.ts'
import { knuthMorrisPratt, naiveMatch, rabinKarp } from './strings.ts'
import { hanoi, permutations, queens, subsets } from './backtracking.ts'
import { runStructure, STRUCTURE_NAMES } from './structures.ts'
import { runTree, TREE_NAMES } from './trees.ts'

/** A text with a pattern that nearly matches everywhere, which is where the three matchers differ most. */
const TEXT = 'abacabadabacaba'
const PATTERN = 'abacaba'

/**
 * The pseudocode and the instrumentation, held together.
 *
 * The code panel highlights the line a step says it is on. Nothing stops an implementation naming line 14 of an
 * eight-line listing, and the result would be a panel that highlights nothing while looking as if it works — or
 * worse, highlights the wrong line and teaches the wrong shape of the algorithm. So every instrumented algorithm is
 * run here and its lines are checked against the listing it is displayed with.
 */

const VALUES = [5, 3, 8, 1, 9, 2, 7, 4, 6]

const ran = (id: string, run: Run | { error: string }): Run => {
  assert.ok(!isAlgorithmError(run), `${id} refused to run: ${isAlgorithmError(run) ? run.message : ''}`)
  return run as Run
}

/** A graph to walk. Generated rather than written out, so it is the same graph the laboratory itself uses. */
function grid(): MadeGraph {
  const made = makeGraph('grid', 16, 1)
  assert.ok(!isAlgorithmError(made), `the grid graph could not be made: ${isAlgorithmError(made) ? made.message : ''}`)
  return made as MadeGraph
}


/*
 * What each of the newer families needs to run.
 *
 * They take different inputs — a target, a window size, a bucket count — so one shared object is given to all of
 * them and each takes what it needs. A family added later without an entry here still runs, on the defaults.
 */
const FOR_STRUCTURES = { values: VALUES, target: 11, by: 3, size: 3, cycleAt: null }
const FOR_TREES = { values: VALUES, target: 7, buckets: 16, amount: 6, coins: [1, 3, 4] }

/** Every algorithm that carries line numbers, with a real run of it. */
const INSTRUMENTED: readonly (readonly [string, () => Run])[] = Object.freeze([
  ['bubble', () => ran('bubble', bubbleSort(VALUES))],
  ['insertion', () => ran('insertion', insertionSort(VALUES))],
  ['selection', () => ran('selection', selectionSort(VALUES))],
  ['merge', () => ran('merge', mergeSort(VALUES))],
  ['heap', () => ran('heap', heapSort(VALUES))],
  ['shell', () => ran('shell', shellSort(VALUES))],
  ['comb', () => ran('comb', combSort(VALUES))],
  ['cocktail', () => ran('cocktail', cocktailSort(VALUES))],
  ['gnome', () => ran('gnome', gnomeSort(VALUES))],
  ['odd-even', () => ran('odd-even', oddEvenSort(VALUES))],
  ['cycle', () => ran('cycle', cycleSort(VALUES))],
  ['pancake', () => ran('pancake', pancakeSort(VALUES))],
  ['three-way-quick', () => ran('three-way-quick', threeWayQuickSort(VALUES, 1))],
  ['bottom-up-merge', () => ran('bottom-up-merge', bottomUpMergeSort(VALUES))],
  ['tim', () => ran('tim', timSort(VALUES))],
  ['intro', () => ran('intro', introSort(VALUES, 1))],
  ['tree', () => ran('tree', treeSort(VALUES))],
  ['bitonic', () => ran('bitonic', bitonicSort(VALUES))],
  ['bucket', () => ran('bucket', bucketSort(VALUES))],
  ['stooge', () => ran('stooge', stoogeSort(VALUES))],
  ['bogo', () => ran('bogo', bogoSort([3, 1, 2], 1))],
  ['quick', () => ran('quick', quickSort(VALUES, 'median-of-three', 1))],
  ['linear', () => ran('linear', linearSearch(VALUES, 7))],
  ['binary', () => ran('binary', binarySearch([1, 2, 3, 4, 5, 6, 7, 8, 9], 7))],
  ['interpolation', () => ran('interpolation', interpolationSearch([1, 2, 3, 4, 5, 6, 7, 8, 9], 7))],
  ['jump', () => ran('jump', jumpSearch([1, 2, 3, 4, 5, 6, 7, 8, 9], 7))],
  ['exponential', () => ran('exponential', exponentialSearch([1, 2, 3, 4, 5, 6, 7, 8, 9], 7))],
  ['fibonacci-search', () => ran('fibonacci-search', fibonacciSearch([1, 2, 3, 4, 5, 6, 7, 8, 9], 7))],
  ['ternary', () => ran('ternary', ternarySearch([1, 2, 3, 4, 5, 6, 7, 8, 9], 7))],
  ['counting', () => ran('counting', countingSort(VALUES))],
  ['radix', () => ran('radix', radixSort(VALUES))],
  ['bfs', () => ran('bfs', breadthFirst(grid().graph, grid().graph.nodes[0]))],
  ['dfs', () => ran('dfs', depthFirst(grid().graph, grid().graph.nodes[0]))],
  [
    'bellman-ford',
    () => {
      const made = grid().graph
      return ran('bellman-ford', bellmanFord(made, made.nodes[0], made.nodes[made.nodes.length - 1]))
    }
  ],
  [
    'a-star',
    () => {
      const made = grid()
      return ran('a-star', aStar(made.graph, made.graph.nodes[0], made.graph.nodes[made.graph.nodes.length - 1], made.at))
    }
  ],
  ['kruskal', () => ran('kruskal', kruskal(grid().graph))],
  [
    'topological',
    () => {
      const made = makeGraph('dag', 14, 3)
      assert.ok(!isAlgorithmError(made), 'the dag could not be made')
      return ran('topological', topologicalSort((made as MadeGraph).graph))
    }
  ],
  ...STRUCTURE_NAMES.map((id) => [id, () => ran(id, runStructure(id, FOR_STRUCTURES))] as const),
  ...TREE_NAMES.map((id) => [id, () => ran(id, runTree(id, FOR_TREES))] as const),
  ['hanoi', () => ran('hanoi', hanoi(4))],
  ['permutations', () => ran('permutations', permutations([1, 2, 3]))],
  ['subsets', () => ran('subsets', subsets([1, 2, 3]))],
  ['n-queens', () => ran('n-queens', queens(5))],
  ['naive-match', () => ran('naive-match', naiveMatch(TEXT, PATTERN))],
  ['kmp', () => ran('kmp', knuthMorrisPratt(TEXT, PATTERN))],
  ['rabin-karp', () => ran('rabin-karp', rabinKarp(TEXT, PATTERN))],
  ['lcs', () => ran('lcs', longestCommonSubsequence('ABCBDAB', 'BDCABA'))],
  ['lis', () => ran('lis', longestIncreasingSubsequence(VALUES))],
  ['fibonacci', () => ran('fibonacci', fibonacci(10))],
  [
    'knapsack',
    () =>
      ran(
        'knapsack',
        knapsack(
          [
            { name: 'a', weight: 2, value: 3 },
            { name: 'b', weight: 3, value: 4 },
            { name: 'c', weight: 4, value: 5 }
          ],
          7
        )
      )
  ],
  [
    'dijkstra',
    () => {
      const made = grid().graph
      return ran('dijkstra', dijkstra(made, made.nodes[0], made.nodes[made.nodes.length - 1]))
    }
  ]
])

describe('the pseudocode listings', () => {
  it('names an algorithm that is in the catalogue', () => {
    const known = new Set(CATALOGUE.map((one) => one.id))
    for (const one of ALGORITHM_CODE) {
      assert.ok(known.has(one.id), `there is pseudocode for "${one.id}" and no such algorithm`)
    }
  })

  it('has no duplicates and no empty listing', () => {
    assert.equal(new Set(ALGORITHM_CODE.map((one) => one.id)).size, ALGORITHM_CODE.length)
    for (const one of ALGORITHM_CODE) {
      assert.ok(one.lines.length >= 3, `${one.id}'s listing is ${one.lines.length} lines, which is not an algorithm`)
      assert.ok(Object.keys(one.names).length >= 1, `${one.id} names no variables`)
    }
  })

  it('covers every algorithm in the catalogue', () => {
    // Not strictly required for the panel to work — an algorithm without code says so — but a gap here is almost
    // always an algorithm somebody forgot rather than one deliberately left out.
    for (const entry of CATALOGUE) {
      assert.ok(codeFor(entry.id) !== null, `${entry.id} (${entry.name}) has no pseudocode`)
    }
  })
})

describe('the line numbers the algorithms record', () => {
  for (const [id, go] of INSTRUMENTED) {
    it(`${id} stays inside its own listing`, () => {
      const code = codeFor(id)
      assert.ok(code !== null, `${id} is instrumented and has no pseudocode`)
      const run = go()
      const lines = run.steps.map((one) => one.line).filter((one): one is number => typeof one === 'number')
      assert.ok(lines.length > 0, `${id} records no line numbers at all, so the code panel would follow nothing`)
      for (const line of lines) {
        assert.ok(
          line >= 1 && line <= code.lines.length,
          `${id} recorded line ${line} and its listing is ${code.lines.length} lines long`
        )
      }
      // Most steps should carry a line; a handful of setup and summary steps legitimately do not.
      assert.ok(
        lines.length > run.steps.length * 0.5,
        `${id} carries a line on only ${lines.length} of ${run.steps.length} steps, so the panel would sit still while the trace moved`
      )
    })

    it(`${id} reports variables the listing names`, () => {
      const code = codeFor(id)
      assert.ok(code !== null)
      const run = go()
      const held = varsAt(run.steps, run.steps.length - 1)
      const seen = Object.keys(held)
      assert.ok(seen.length > 0, `${id} records no variables, so the variables panel would be empty`)
      for (const name of seen) {
        assert.ok(
          code.names[name] !== undefined,
          `${id} records a variable called "${name}" that its listing does not explain. Either name it in code.ts or record the name the listing uses — a variable somebody cannot find in the code is worse than one not shown.`
        )
      }
    })

    it(`${id} is on a line from its very first step`, () => {
      // Not just "eventually". A run opens at step 0, and if that step carries no line the code panel marks
      // nothing at the exact moment somebody first looks at it — which reads as a panel that does not work.
      const run = go()
      assert.ok(run.steps.length > 0, `${id} recorded no steps at all`)
      assert.equal(
        typeof run.steps[0].line,
        'number',
        `${id}'s first step is before any rec.where(), so nothing is marked until the run moves`
      )
    })

    it(`${id} is on a line at every point in the run`, () => {
      const run = go()
      // lineAt carries the last line forward, so once a line has been recorded there is never a gap.
      const first = run.steps.findIndex((one) => typeof one.line === 'number')
      assert.ok(first >= 0)
      for (let at = first; at < run.steps.length; at += 1) {
        assert.ok(lineAt(run.steps, at) !== null, `${id} has no line at step ${at}`)
      }
    })
  }
})

describe('what the variables panel shows', () => {
  it('carries a value forward until it changes', () => {
    const run = ran('bubble', bubbleSort(VALUES))
    const early = varsAt(run.steps, 3)
    assert.ok('n' in early, 'n was set on the first step and lost by step 3')
    assert.equal(early.n, VALUES.length)
  })

  it('moves as the run moves', () => {
    const run = ran('binary', binarySearch([1, 2, 3, 4, 5, 6, 7, 8, 9], 9))
    const start = varsAt(run.steps, 0)
    const end = varsAt(run.steps, run.steps.length - 1)
    assert.equal(start.lo, 0)
    assert.notEqual(end.lo, start.lo, 'the window never moved, which for a search to the last value cannot be right')
  })

  it('names its variables as the code does, for binary search', () => {
    const run = ran('binary', binarySearch([1, 2, 3, 4, 5, 6, 7, 8, 9], 7))
    const held = varsAt(run.steps, run.steps.length - 1)
    for (const name of ['lo', 'hi', 'mid', 'target']) {
      assert.ok(name in held, `binary search does not report "${name}", which its listing uses`)
    }
  })
})

describe('every algorithm, not just the ones somebody remembered', () => {
  it('is instrumented and listed here', () => {
    // This is the guard that stops the set drifting. Adding an algorithm without line numbers is easy to do and
    // invisible on screen until somebody opens the code panel and watches nothing move, so the build says it
    // instead: register an algorithm and it must be given a listing, lines, and a row in INSTRUMENTED.
    const covered = new Set(INSTRUMENTED.map(([id]) => id))
    const missing = CATALOGUE.filter((one) => !covered.has(one.id)).map((one) => one.id)
    assert.deepEqual(
      missing,
      [],
      `these algorithms record no line numbers, so the code panel would sit still while they ran: ${missing.join(', ')}`
    )
  })
})

describe('the catalogue entry for an instrumented algorithm', () => {
  it('still exists and still states a complexity', () => {
    for (const [id] of INSTRUMENTED) {
      const entry = entryFor(id)
      assert.ok(entry, `${id} is instrumented and not in the catalogue`)
      assert.ok(entry.complexity.worst.length > 0)
    }
  })
})
