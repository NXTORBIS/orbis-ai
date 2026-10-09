import { fail, summarise, type AlgorithmError, type Run } from './trace.ts'
import { runSort, type Pivot, type SortName } from './sorting.ts'
import { runSearch, type SearchName } from './searching.ts'
import { runString, type StringName } from './strings.ts'
import { runBacktrack, type BacktrackName } from './backtracking.ts'
import { runStructure, type StructureName } from './structures.ts'
import { runTree, type TreeName } from './trees.ts'
import { runGraph, type Graph, type GraphName } from './graphs.ts'
import { runDynamic, type DynamicName, type Item } from './dynamic.ts'
import { makeNumbers, type Shape } from './inputs.ts'

/**
 * Every algorithm the laboratory has, and what is true about each one.
 *
 * ## The metadata is a claim that can be checked
 *
 * Each entry states its complexity, whether it is stable, whether it is in place. Those are not decoration: the
 * tests in `algorithms.test.ts` check the *stable* claim by sorting records with equal keys and looking at whether
 * their order survived, and check the *in place* claim against the recorded write count. A catalogue that merely
 * asserted "stable: true" would be documentation; this one is a statement the suite verifies.
 *
 * ## Complexity is stated and separately measured
 *
 * `complexity` is the textbook figure. It is never computed from a run, and a run never overrides it. What a run
 * produces is a measured operation count, and `complexity.ts` puts the two side by side — which is the only honest
 * way to show them, because a measurement on one input proves nothing about a bound.
 *
 * Pure.
 */

export type Family =
  | 'sorting'
  | 'searching'
  | 'graphs'
  | 'dynamic'
  | 'strings'
  | 'backtracking'
  | 'arrays'
  | 'lists'
  | 'stacks'
  | 'queues'
  | 'trees'
  | 'hashing'
  | 'greedy'

export interface Entry {
  id: string
  name: string
  family: Family
  /** One sentence on how it works. Shown before it runs. */
  idea: string
  /** Big-O, as the textbook gives it. Stated, never measured. */
  complexity: { best: string; average: string; worst: string; space: string }
  /** True when equal values keep their original order. Checked by the test suite. */
  stable: boolean
  /** True when it uses only a constant amount of extra room. Checked against the recorded writes. */
  inPlace: boolean
  /** False when it uses randomness; its seed is then part of the result. */
  deterministic: boolean
  /** What it needs to run. A search needs a target; a graph algorithm needs a start. */
  needs: readonly ('values' | 'target' | 'graph' | 'start' | 'graphTarget' | 'positions' | 'items' | 'capacity' | 'strings' | 'n')[]
  /** What it refuses, said before somebody finds out by failing. */
  limits: readonly string[]
  /**
   * The longest input it will take, when that is shorter than the laboratory's own ceiling.
   *
   * Only the deliberately terrible sorts set this: stooge sort is about n^2.71 and bogosort is n!, so both refuse
   * past a short list rather than running for ever. Absent means the usual ceiling applies.
   */
  most?: number
  /**
   * True when it may reach the step ceiling and stop without an answer, even on an input it accepted.
   *
   * Only bogosort. Its expected cost is n factorial on a list it will take, so eight random values genuinely may
   * not sort inside any ceiling. Declared here so a test can hold every other algorithm to finishing, rather than
   * the whole sweep being loosened to "it might not work" on account of one algorithm that is a joke on purpose.
   */
  mayNotFinish?: boolean
}

const O = (best: string, average: string, worst: string, space: string): Entry['complexity'] => ({ best, average, worst, space })

export const CATALOGUE: readonly Entry[] = Object.freeze([
  // ------------------------------------------------ sorting
  {
    id: 'bubble',
    name: 'Bubble sort',
    family: 'sorting',
    idea: 'Repeatedly walk the list, swapping any neighbours that are the wrong way round, until a whole pass makes no swaps.',
    complexity: O('O(n)', 'O(n²)', 'O(n²)', 'O(1)'),
    stable: true,
    inPlace: true,
    deterministic: true,
    needs: ['values'],
    limits: ['Far slower than the others on anything but an almost-sorted list. It is here to be understood, not used.']
  },
  {
    id: 'insertion',
    name: 'Insertion sort',
    family: 'sorting',
    idea: 'Take each value in turn and slide it back into its place among the ones already sorted.',
    complexity: O('O(n)', 'O(n²)', 'O(n²)', 'O(1)'),
    stable: true,
    inPlace: true,
    deterministic: true,
    needs: ['values'],
    limits: ['Quadratic on reversed input, where every value shifts past every other.']
  },
  {
    id: 'selection',
    name: 'Selection sort',
    family: 'sorting',
    idea: 'Find the smallest remaining value and swap it into place, then repeat on the rest.',
    complexity: O('O(n²)', 'O(n²)', 'O(n²)', 'O(1)'),
    stable: false,
    inPlace: true,
    deterministic: true,
    needs: ['values'],
    limits: [
      'Always makes exactly the same number of comparisons, whatever the input — so sorted input is no faster.',
      'Not stable: swapping a distant value in can jump it past an equal one.'
    ]
  },
  {
    id: 'merge',
    name: 'Merge sort',
    family: 'sorting',
    idea: 'Split the list in half, sort each half, then merge the two sorted halves together.',
    complexity: O('O(n log n)', 'O(n log n)', 'O(n log n)', 'O(n)'),
    stable: true,
    inPlace: false,
    deterministic: true,
    needs: ['values'],
    limits: ['Needs a second array of the same size, so it is not in place.']
  },
  {
    id: 'quick',
    name: 'Quicksort',
    family: 'sorting',
    idea: 'Pick a pivot, move everything smaller to its left and larger to its right, then sort the two sides.',
    complexity: O('O(n log n)', 'O(n log n)', 'O(n²)', 'O(log n)'),
    stable: false,
    inPlace: true,
    deterministic: false,
    needs: ['values'],
    limits: [
      'Quadratic in the worst case. With a last-element pivot, sorted input is that worst case.',
      'Not stable: the partition moves values past equal ones.'
    ]
  },
  {
    id: 'heap',
    name: 'Heap sort',
    family: 'sorting',
    idea: 'Arrange the list as a heap so the largest is on top, then repeatedly take the top off and fix the heap.',
    complexity: O('O(n log n)', 'O(n log n)', 'O(n log n)', 'O(1)'),
    stable: false,
    inPlace: true,
    deterministic: true,
    needs: ['values'],
    limits: ['Not stable. Usually a little slower than quicksort in practice despite the better worst case.']
  },
  {
    id: 'counting',
    name: 'Counting sort',
    family: 'sorting',
    idea: 'Count how many of each value there are, then write them back out in order. No comparisons at all.',
    complexity: O('O(n + k)', 'O(n + k)', 'O(n + k)', 'O(k)'),
    stable: true,
    inPlace: false,
    deterministic: true,
    needs: ['values'],
    limits: [
      'Whole numbers only.',
      'Needs one bucket per distinct value, so it refuses values spread more than a million apart.'
    ]
  },
  {
    id: 'radix',
    name: 'Radix sort',
    family: 'sorting',
    idea: 'Sort by the last digit, then the next, and so on. Each pass keeps the order of the previous one.',
    complexity: O('O(d·n)', 'O(d·n)', 'O(d·n)', 'O(n + k)'),
    stable: true,
    inPlace: false,
    deterministic: true,
    needs: ['values'],
    limits: ['Whole numbers of zero or more, in this implementation.']
  },

  // ------------------------------------------------ sorting: the other sixteen
  {
    id: 'shell',
    name: 'Shell sort',
    family: 'sorting',
    idea: 'Insertion sort, but comparing values a gap apart rather than neighbours, with the gap shrinking to one — so a value far from home moves a long way in one step.',
    complexity: O('O(n log n)', 'O(n^1.25)', 'O(n²)', 'O(1)'),
    stable: false,
    inPlace: true,
    deterministic: true,
    needs: ['values'],
    limits: [
      'Its average cost depends entirely on the gap sequence; the one used here is Knuth\u2019s, and a different sequence gives a different curve.',
      'Not stable: a value can jump over an equal one while the gap is large.'
    ]
  },
  {
    id: 'comb',
    name: 'Comb sort',
    family: 'sorting',
    idea: 'Bubble sort with a shrinking gap, which kills the small values stuck at the back that make bubble sort slow.',
    complexity: O('O(n log n)', 'O(n² / 2^p)', 'O(n²)', 'O(1)'),
    stable: false,
    inPlace: true,
    deterministic: true,
    needs: ['values'],
    limits: ['The shrink factor of 1.3 is empirical, not derived.', 'Not stable.']
  },
  {
    id: 'cocktail',
    name: 'Cocktail shaker sort',
    family: 'sorting',
    idea: 'Bubble sort that alternates direction, so small values at the end travel to the front as fast as large ones travel to the back.',
    complexity: O('O(n)', 'O(n²)', 'O(n²)', 'O(1)'),
    stable: true,
    inPlace: true,
    deterministic: true,
    needs: ['values'],
    limits: ['Still quadratic: alternating halves the number of passes on some inputs and changes no bound.']
  },
  {
    id: 'gnome',
    name: 'Gnome sort',
    family: 'sorting',
    idea: 'Walk forward; whenever a pair is out of order, swap it and step back. One pointer, no nested loop.',
    complexity: O('O(n)', 'O(n²)', 'O(n²)', 'O(1)'),
    stable: true,
    inPlace: true,
    deterministic: true,
    needs: ['values'],
    limits: ['Quadratic, and of interest for how little state it needs rather than for speed.']
  },
  {
    id: 'odd-even',
    name: 'Odd-even transposition sort',
    family: 'sorting',
    idea: 'Compare every odd-indexed pair, then every even-indexed pair, and repeat — every comparison in a phase is independent, so a parallel machine does them all at once.',
    complexity: O('O(n)', 'O(n²)', 'O(n²)', 'O(1)'),
    stable: true,
    inPlace: true,
    deterministic: true,
    needs: ['values'],
    limits: [
      'Run here one comparison at a time, so the count is quadratic. Its point is that the phases parallelise, which a single thread cannot show.'
    ]
  },
  {
    id: 'cycle',
    name: 'Cycle sort',
    family: 'sorting',
    idea: 'Work out where each value belongs and put it there directly, following the cycle of displaced values — which makes the number of writes the theoretical minimum.',
    complexity: O('O(n²)', 'O(n²)', 'O(n²)', 'O(1)'),
    stable: false,
    inPlace: true,
    deterministic: true,
    needs: ['values'],
    limits: [
      'Always quadratic in comparisons. It is chosen when writing is expensive — flash memory — and never when comparing is.',
      'Not stable.'
    ]
  },
  {
    id: 'pancake',
    name: 'Pancake sort',
    family: 'sorting',
    idea: 'The only move allowed is reversing a prefix. Find the largest value, flip it to the front, then flip it to its place.',
    complexity: O('O(n)', 'O(n²)', 'O(n²)', 'O(1)'),
    stable: false,
    inPlace: true,
    deterministic: true,
    needs: ['values'],
    limits: ['A puzzle about a restricted operation, not a practical sort.', 'Not stable.']
  },
  {
    id: 'three-way-quick',
    name: 'Three-way quicksort',
    family: 'sorting',
    idea: 'Quicksort that partitions into below, equal and above — so a list with many repeats finishes in one pass over the equal block instead of recursing through it.',
    complexity: O('O(n)', 'O(n log n)', 'O(n²)', 'O(log n)'),
    stable: false,
    inPlace: true,
    deterministic: false,
    needs: ['values'],
    limits: [
      'The pivot is random, so the seed is part of the result and two runs of the same input differ.',
      'The worst case is still quadratic, only far less likely.'
    ]
  },
  {
    id: 'bottom-up-merge',
    name: 'Bottom-up merge sort',
    family: 'sorting',
    idea: 'Merge sort without recursion: merge every pair of adjacent runs of length 1, then 2, then 4, until one run remains.',
    complexity: O('O(n log n)', 'O(n log n)', 'O(n log n)', 'O(n)'),
    stable: true,
    inPlace: false,
    deterministic: true,
    needs: ['values'],
    limits: ['Needs a second array the size of the first, like any merge sort.']
  },
  {
    id: 'tim',
    name: 'Timsort',
    family: 'sorting',
    idea: 'Find the runs already in order, extend short ones by insertion sort, then merge them — which is why it is O(n) on data that is nearly sorted, and why Python and Java use it.',
    complexity: O('O(n)', 'O(n log n)', 'O(n log n)', 'O(n)'),
    stable: true,
    inPlace: false,
    deterministic: true,
    needs: ['values'],
    limits: [
      'This is the shape of Timsort — run detection, a minimum run length, and merging — not the production algorithm, which has galloping and a carefully invariant-checked merge stack.'
    ]
  },
  {
    id: 'intro',
    name: 'Introsort',
    family: 'sorting',
    idea: 'Quicksort until the recursion gets too deep, then heapsort for that part, and insertion sort for the small pieces — so it keeps quicksort\u2019s speed and cannot hit its quadratic case.',
    complexity: O('O(n log n)', 'O(n log n)', 'O(n log n)', 'O(log n)'),
    stable: false,
    inPlace: true,
    deterministic: false,
    needs: ['values'],
    limits: [
      'The depth limit is 2·log₂ n, as in the usual implementation; a different limit changes where it switches.',
      'Not stable, and the pivot is random so the seed is part of the result.'
    ]
  },
  {
    id: 'tree',
    name: 'Tree sort',
    family: 'sorting',
    idea: 'Insert every value into a binary search tree, then read the tree in order.',
    complexity: O('O(n log n)', 'O(n log n)', 'O(n²)', 'O(n)'),
    stable: true,
    inPlace: false,
    deterministic: true,
    needs: ['values'],
    limits: [
      'The tree is not balanced, so sorted input makes it a list and the sort quadratic. That is the lesson, and it is why self-balancing trees exist.'
    ]
  },
  {
    id: 'bitonic',
    name: 'Bitonic sort',
    family: 'sorting',
    idea: 'A fixed network of compare-and-swap pairs that sorts any input of a power-of-two length — the same comparisons every time, whatever the data.',
    complexity: O('O(log² n)', 'O(n log² n)', 'O(n log² n)', 'O(1)'),
    stable: false,
    inPlace: true,
    deterministic: true,
    needs: ['values'],
    limits: [
      'Needs a length that is a power of two; a shorter list is padded, and the padding is said on screen.',
      'Its O(log² n) is the depth on parallel hardware. Run one comparison at a time it does more work than merge sort, which is the point of showing both.'
    ]
  },
  {
    id: 'bucket',
    name: 'Bucket sort',
    family: 'sorting',
    idea: 'Scatter the values into buckets by range, sort each bucket, then read the buckets in order.',
    complexity: O('O(n + k)', 'O(n + k)', 'O(n²)', 'O(n + k)'),
    stable: true,
    inPlace: false,
    deterministic: true,
    needs: ['values'],
    limits: [
      'Linear only when the values spread evenly across the buckets. Put them all in one bucket and it is whatever sorts that bucket.',
      'Needs to know the range in advance, which is a real assumption and not a detail.'
    ]
  },
  {
    id: 'stooge',
    name: 'Stooge sort',
    family: 'sorting',
    idea: 'Sort the first two thirds, then the last two thirds, then the first two thirds again. It works, and it is deliberately terrible.',
    complexity: O('O(n^2.71)', 'O(n^2.71)', 'O(n^2.71)', 'O(n)'),
    stable: false,
    inPlace: true,
    deterministic: true,
    needs: ['values'],
    most: 60,
    limits: [
      'Worse than quadratic. Here to show that correct and usable are different properties, and it is held to a small input for that reason.',
      'Refuses more than 60 values, because at n^2.71 that is already most of a step ceiling.'
    ]
  },
  {
    id: 'bogo',
    name: 'Bogosort',
    family: 'sorting',
    idea: 'Shuffle the list. Check whether it is sorted. Repeat. Expected O(n·n!) — unbounded in practice.',
    complexity: O('O(n)', 'O(n \u00b7 n!)', 'unbounded', 'O(1)'),
    stable: false,
    inPlace: true,
    deterministic: false,
    needs: ['values'],
    most: 8,
    mayNotFinish: true,
    limits: [
      'Refuses more than eight values. Its expected cost is n factorial, so nine is already a long wait and ten is a day.',
      'Even within that it often stops at the step ceiling before finishing. That is not a fault in the implementation — it is the algorithm.',
      'The shuffle is seeded, so a run can be repeated exactly.'
    ]
  },
  // ------------------------------------------------ searching
  {
    id: 'linear',
    name: 'Linear search',
    family: 'searching',
    idea: 'Look at each value in turn until the one wanted turns up.',
    complexity: O('O(1)', 'O(n)', 'O(n)', 'O(1)'),
    stable: true,
    inPlace: true,
    deterministic: true,
    needs: ['values', 'target'],
    limits: ['Slow on a long list — but it is the only one here that does not need the list in order.']
  },
  {
    id: 'binary',
    name: 'Binary search',
    family: 'searching',
    idea: 'Look at the middle. If it is too small, search the upper half; if too large, the lower half. Repeat.',
    complexity: O('O(1)', 'O(log n)', 'O(log n)', 'O(1)'),
    stable: true,
    inPlace: true,
    deterministic: true,
    needs: ['values', 'target'],
    limits: ['The list has to be in order. On unsorted input it is refused, because it would report a value as missing when it is there.']
  },
  {
    id: 'interpolation',
    name: 'Interpolation search',
    family: 'searching',
    idea: 'Guess where the value should be from how far along the range it falls, rather than always taking the middle.',
    complexity: O('O(1)', 'O(log log n)', 'O(n)', 'O(1)'),
    stable: true,
    inPlace: true,
    deterministic: true,
    needs: ['values', 'target'],
    limits: ['Needs the list in order, and beats binary search only when the values are evenly spread. On clustered values it is worse.']
  },
  {
    id: 'jump',
    name: 'Jump search',
    family: 'searching',
    idea: 'Step forward in blocks of about the square root of the length, then walk back through the last block.',
    complexity: O('O(1)', 'O(√n)', 'O(√n)', 'O(1)'),
    stable: true,
    inPlace: true,
    deterministic: true,
    needs: ['values', 'target'],
    limits: ['Needs the list in order. Slower than binary search, but only ever steps forwards — which matters on media you cannot seek backwards on.']
  },

  {
    id: 'exponential',
    name: 'Exponential search',
    family: 'searching',
    idea: 'Double a bound until it passes the target, then binary search the block just passed \u2014 so it finds the range without ever being told how long the list is.',
    complexity: O('O(1)', 'O(log i)', 'O(log i)', 'O(1)'),
    stable: true,
    inPlace: true,
    deterministic: true,
    needs: ['values', 'target'],
    limits: [
      'Needs the list in order, like every search but linear. Given unsorted input it is refused rather than returning not-found for a value that is there.',
      'Its cost is in the position of the answer, not the length of the list \u2014 which is the point of it, and means it is slower than binary search when the answer is near the end.'
    ]
  },
  {
    id: 'fibonacci-search',
    name: 'Fibonacci search',
    family: 'searching',
    idea: 'Divide the list by Fibonacci numbers instead of in half, using only addition and subtraction \u2014 no division and no midpoint.',
    complexity: O('O(1)', 'O(log n)', 'O(log n)', 'O(1)'),
    stable: true,
    inPlace: true,
    deterministic: true,
    needs: ['values', 'target'],
    limits: [
      'Needs the list in order.',
      'Makes slightly more comparisons than binary search. It was chosen on machines where dividing was expensive, and for how it touches memory on very large arrays \u2014 not for fewer comparisons.'
    ]
  },
  {
    id: 'ternary',
    name: 'Ternary search',
    family: 'searching',
    idea: 'Cut the window into three rather than two, with two comparisons a round.',
    complexity: O('O(1)', 'O(log\u2083 n)', 'O(log\u2083 n)', 'O(1)'),
    stable: true,
    inPlace: true,
    deterministic: true,
    needs: ['values', 'target'],
    limits: [
      'Needs the list in order.',
      'Makes about 1.26 times as many comparisons as binary search. Two comparisons to remove two thirds is worse than one to remove a half, and seeing that counted is the reason it is here.',
      'The version that searches for the peak of a unimodal function is a different algorithm with the same name, and is not this one.'
    ]
  },
  // ------------------------------------------------ graphs
  {
    id: 'bfs',
    name: 'Breadth-first search',
    family: 'graphs',
    idea: 'Visit everything one edge away, then everything two edges away, using a queue.',
    complexity: O('O(V + E)', 'O(V + E)', 'O(V + E)', 'O(V)'),
    stable: true,
    inPlace: false,
    deterministic: true,
    needs: ['graph', 'start'],
    limits: ['Finds the fewest-edges path, which is the shortest path only when every edge costs the same.']
  },
  {
    id: 'dfs',
    name: 'Depth-first search',
    family: 'graphs',
    idea: 'Follow one path as far as it goes, then back up and try the next.',
    complexity: O('O(V + E)', 'O(V + E)', 'O(V + E)', 'O(V)'),
    stable: true,
    inPlace: false,
    deterministic: true,
    needs: ['graph', 'start'],
    limits: ['Says nothing about shortest paths. Its recursion depth can reach the number of nodes.']
  },
  {
    id: 'dijkstra',
    name: 'Dijkstra',
    family: 'graphs',
    idea: 'Repeatedly settle the nearest unsettled node, improving its neighbours as you go.',
    complexity: O('O(V²)', 'O(V²)', 'O(V²)', 'O(V)'),
    stable: true,
    inPlace: false,
    deterministic: true,
    needs: ['graph', 'start'],
    limits: [
      'Refuses negative edge weights: it assumes a settled distance can never improve.',
      'This version scans for the nearest node rather than using a heap, so it is O(V²) — clearer to watch, and fine for the sizes here.'
    ]
  },
  {
    id: 'bellman-ford',
    name: 'Bellman-Ford',
    family: 'graphs',
    idea: 'Relax every edge n−1 times, then once more: anything that still improves is on a negative cycle.',
    complexity: O('O(V·E)', 'O(V·E)', 'O(V·E)', 'O(V)'),
    stable: true,
    inPlace: false,
    deterministic: true,
    needs: ['graph', 'start'],
    limits: ['Much slower than Dijkstra. Worth it only when weights can be negative.']
  },
  {
    id: 'a-star',
    name: 'A*',
    family: 'graphs',
    idea: 'Like Dijkstra, but prefer nodes that also look closer to the destination.',
    complexity: O('O(E)', 'O(E)', 'O(V²)', 'O(V)'),
    stable: true,
    inPlace: false,
    deterministic: true,
    needs: ['graph', 'start', 'graphTarget', 'positions'],
    limits: [
      'Every node needs a position, because the estimate is a straight-line distance. Without positions it is refused rather than quietly becoming Dijkstra.',
      'The estimate must never overshoot, or the path found may not be the shortest.'
    ]
  },
  {
    id: 'kruskal',
    name: 'Kruskal',
    family: 'graphs',
    idea: 'Take the edges in order of weight, keeping any that joins two pieces that were separate.',
    complexity: O('O(E log E)', 'O(E log E)', 'O(E log E)', 'O(V)'),
    stable: true,
    inPlace: false,
    deterministic: true,
    needs: ['graph'],
    limits: ['Undirected graphs only. On a graph in pieces it produces a forest, and says so rather than claiming a spanning tree.']
  },
  {
    id: 'topological',
    name: 'Topological sort',
    family: 'graphs',
    idea: 'Repeatedly take a node nothing points at, and remove its outgoing edges.',
    complexity: O('O(V + E)', 'O(V + E)', 'O(V + E)', 'O(V)'),
    stable: true,
    inPlace: false,
    deterministic: true,
    needs: ['graph'],
    limits: ['Directed graphs only, and only those without cycles. A cycle means no order exists, and it names the nodes caught in it.']
  },

  // ------------------------------------------------ arrays
  {
    id: 'traversal',
    name: 'Array traversal',
    family: 'arrays',
    idea: 'Walk the array once, reading each value. The baseline every other technique is measured against.',
    complexity: O('O(n)', 'O(n)', 'O(n)', 'O(1)'),
    stable: true, inPlace: true, deterministic: true, needs: ['values'],
    limits: ['There is nothing to be clever about: every value is read exactly once, which is the point of having it here.']
  },
  {
    id: 'reversal',
    name: 'Array reversal',
    family: 'arrays',
    idea: 'Swap from both ends towards the middle — half as many swaps as moving everything along.',
    complexity: O('O(n)', 'O(n)', 'O(n)', 'O(1)'),
    stable: false, inPlace: true, deterministic: true, needs: ['values'],
    limits: ['Only n/2 swaps happen, so the swap count is half what people expect.']
  },
  {
    id: 'rotation',
    name: 'Array rotation',
    family: 'arrays',
    idea: 'Rotate by reversing three times: the first part, the rest, then the whole thing. No second array at all.',
    complexity: O('O(n)', 'O(n)', 'O(n)', 'O(1)'),
    stable: false, inPlace: true, deterministic: true, needs: ['values'],
    limits: ['Rotating by a multiple of the length does nothing, and the trace says so rather than going through the motions.']
  },
  {
    id: 'prefix-sum',
    name: 'Prefix sum',
    family: 'arrays',
    idea: 'Build running totals once, then any range sums in a single subtraction.',
    complexity: O('O(n)', 'O(n)', 'O(n)', 'O(n)'),
    stable: true, inPlace: false, deterministic: true, needs: ['values'],
    limits: [
      'Needs an extra array of n+1, so it trades memory for every later query being free.',
      'The values must not change afterwards: one update means rebuilding the whole thing.'
    ]
  },
  {
    id: 'kadane',
    name: "Kadane's algorithm",
    family: 'arrays',
    idea: 'The largest sum of any run, in one pass, holding only two numbers.',
    complexity: O('O(n)', 'O(n)', 'O(n)', 'O(1)'),
    stable: true, inPlace: true, deterministic: true, needs: ['values'],
    limits: ['With every value negative it returns the least negative one, which is the right answer and surprises people.']
  },
  {
    id: 'two-pointer',
    name: 'Two pointers',
    family: 'arrays',
    idea: 'Two pointers closing in from the ends to find a pair that sums to a target.',
    complexity: O('O(1)', 'O(n)', 'O(n)', 'O(1)'),
    stable: true, inPlace: true, deterministic: true, needs: ['values', 'target'],
    limits: ['Needs the array sorted, and refuses an unsorted one rather than quietly returning not-found.']
  },
  {
    id: 'sliding-window',
    name: 'Sliding window',
    family: 'arrays',
    idea: 'The best run of k values, by adding one and dropping one rather than re-adding the whole window.',
    complexity: O('O(n)', 'O(n)', 'O(n)', 'O(1)'),
    stable: true, inPlace: true, deterministic: true, needs: ['values'],
    limits: ['This is the fixed-size window. The variable-size version, where the window grows and shrinks by a condition, is a different algorithm.']
  },
  {
    id: 'dutch-flag',
    name: 'Dutch national flag',
    family: 'arrays',
    idea: 'Three pointers sort three kinds of value in a single pass — the partition at the heart of three-way quicksort.',
    complexity: O('O(n)', 'O(n)', 'O(n)', 'O(1)'),
    stable: false, inPlace: true, deterministic: true, needs: ['values'],
    limits: ['Not stable: a value can jump over an equal one when it comes back from the far end.']
  },
  {
    id: 'move-zeros',
    name: 'Move zeros',
    family: 'arrays',
    idea: 'Push every zero to the end while keeping everything else in its original order.',
    complexity: O('O(n)', 'O(n)', 'O(n)', 'O(1)'),
    stable: true, inPlace: true, deterministic: true, needs: ['values'],
    limits: ['Only zero is treated as the value to move; it is not a general partition.']
  },
  {
    id: 'remove-duplicates',
    name: 'Remove duplicates',
    family: 'arrays',
    idea: 'Keep one of each value in a sorted array, writing over the repeats as it goes.',
    complexity: O('O(n)', 'O(n)', 'O(n)', 'O(1)'),
    stable: true, inPlace: true, deterministic: true, needs: ['values'],
    limits: ['Needs the array sorted, because it only compares neighbours. On unsorted input it is refused.']
  },
  {
    id: 'two-sum',
    name: 'Two sum',
    family: 'arrays',
    idea: 'A pair summing to the target, in one pass, by remembering what has been seen.',
    complexity: O('O(1)', 'O(n)', 'O(n)', 'O(n)'),
    stable: true, inPlace: true, deterministic: true, needs: ['values', 'target'],
    limits: [
      'Uses memory proportional to the input, which is the trade against the two-pointer version.',
      'Order does not matter, which is exactly what it buys with that memory.'
    ]
  },
  {
    id: 'missing-number',
    name: 'Missing number',
    family: 'arrays',
    idea: 'The one number missing from 0..n, by subtracting what is there from what the total should be.',
    complexity: O('O(n)', 'O(n)', 'O(n)', 'O(1)'),
    stable: true, inPlace: true, deterministic: true, needs: ['values'],
    limits: ['Only meaningful when the values really are 0..n with one gone. Given anything else it reports a difference, not a missing value.']
  },
  {
    id: 'majority-element',
    name: 'Majority element',
    family: 'arrays',
    idea: 'Boyer-Moore voting: one counter finds a value appearing more than half the time, and it looks wrong until you watch it.',
    complexity: O('O(n)', 'O(n)', 'O(n)', 'O(1)'),
    stable: true, inPlace: true, deterministic: true, needs: ['values'],
    limits: [
      'The vote only finds a candidate. A second pass is needed to prove it really is a majority, and skipping that is the usual mistake.',
      'With no true majority it still produces a candidate, which is why the check matters.'
    ]
  },
  // ------------------------------------------------ linked lists
  {
    id: 'list-reverse',
    name: 'Reverse a linked list',
    family: 'lists',
    idea: 'Turn every link around with three pointers, remembering what comes next before the link is broken.',
    complexity: O('O(n)', 'O(n)', 'O(n)', 'O(1)'),
    stable: false, inPlace: true, deterministic: true, needs: ['values'],
    limits: ['The order the three pointers move in is the whole difficulty, and getting it wrong loses the rest of the list.']
  },
  {
    id: 'list-middle',
    name: 'Find the middle',
    family: 'lists',
    idea: 'One pointer moves twice as fast as the other; when it reaches the end, the slow one is half way.',
    complexity: O('O(n)', 'O(n)', 'O(n)', 'O(1)'),
    stable: true, inPlace: true, deterministic: true, needs: ['values'],
    limits: ['With an even number of nodes it gives the second of the two middles, which is a choice rather than a fact.']
  },
  {
    id: 'list-cycle',
    name: 'Detect a cycle',
    family: 'lists',
    idea: "Floyd's tortoise and hare: two pointers at different speeds must meet inside a loop and cannot meet without one.",
    complexity: O('O(n)', 'O(n)', 'O(n)', 'O(1)'),
    stable: true, inPlace: true, deterministic: true, needs: ['values'],
    limits: ['It finds that there is a loop and where the two met — which is not where the loop starts; that needs a second walk.']
  },
  {
    id: 'list-search',
    name: 'Search a linked list',
    family: 'lists',
    idea: 'Walk the links until the value turns up. There is no shortcut, which is the point.',
    complexity: O('O(1)', 'O(n)', 'O(n)', 'O(1)'),
    stable: true, inPlace: true, deterministic: true, needs: ['values', 'target'],
    limits: ['A list cannot be binary searched however sorted it is, because there is no way to jump to the middle.']
  },
  // ------------------------------------------------ stacks
  {
    id: 'balanced-parens',
    name: 'Balanced brackets',
    family: 'stacks',
    idea: 'Push every opening bracket, pop on every closing one, and check they match.',
    complexity: O('O(n)', 'O(n)', 'O(n)', 'O(n)'),
    stable: true, inPlace: false, deterministic: true, needs: ['strings'],
    limits: ['Brackets only — it does not understand quotes, comments or escapes, so a bracket inside a string is still counted.']
  },
  {
    id: 'infix-to-postfix',
    name: 'Infix to postfix',
    family: 'stacks',
    idea: 'The shunting-yard rule: a stack decides precedence, and the result needs no brackets at all.',
    complexity: O('O(n)', 'O(n)', 'O(n)', 'O(n)'),
    stable: true, inPlace: false, deterministic: true, needs: ['strings'],
    limits: [
      'Left-associative operators only. Right-associative power is not handled correctly by this rule as written.',
      'Single-character operators and simple names; no function calls and no unary minus.'
    ]
  },
  {
    id: 'postfix-eval',
    name: 'Evaluate postfix',
    family: 'stacks',
    idea: 'Two values off, one back on, for every operator. No brackets needed because the order is already the order.',
    complexity: O('O(n)', 'O(n)', 'O(n)', 'O(n)'),
    stable: true, inPlace: false, deterministic: true, needs: ['strings'],
    limits: ['Values must be separated by spaces, and it refuses rather than guessing when the stack does not come out with exactly one value.']
  },
  // ------------------------------------------------ queues
  {
    id: 'circular-queue',
    name: 'Circular queue',
    family: 'queues',
    idea: 'A fixed number of slots used round and round, so nothing has to be shuffled along when something leaves.',
    complexity: O('O(1)', 'O(1)', 'O(1)', 'O(n)'),
    stable: true, inPlace: true, deterministic: true, needs: ['values'],
    limits: [
      'Full and empty both look like the head meeting the tail, so a count is kept — which is the real reason this is harder than it looks.',
      'It refuses to overwrite when full rather than silently dropping the oldest.'
    ]
  },
  {
    id: 'queue-bfs',
    name: 'Breadth-first with a queue',
    family: 'queues',
    idea: 'Walking a tree level by level, to show what a queue is actually for.',
    complexity: O('O(n)', 'O(n)', 'O(n)', 'O(n)'),
    stable: true, inPlace: false, deterministic: true, needs: ['values'],
    limits: ['The tree is held as an array, so it is complete by construction — a real tree needs the links instead.']
  },
  // ------------------------------------------------ trees
  {
    id: 'bst-insert',
    name: 'Insert into a search tree',
    family: 'trees',
    idea: 'Go left when smaller, right when larger, and hang the new value where the walk runs out.',
    complexity: O('O(log n)', 'O(log n)', 'O(n)', 'O(n)'),
    stable: true, inPlace: false, deterministic: true, needs: ['values'],
    limits: [
      'Nothing balances it. Insert values already in order and the tree becomes a list, and the depth shown says so — which is the entire argument for AVL and red-black trees.',
      'Equal values go right, which is a choice this makes and states.'
    ]
  },
  {
    id: 'bst-search',
    name: 'Search a tree',
    family: 'trees',
    idea: 'Halve the problem at every node — but only if the tree is balanced, which the step count reveals.',
    complexity: O('O(1)', 'O(log n)', 'O(n)', 'O(1)'),
    stable: true, inPlace: true, deterministic: true, needs: ['values', 'target'],
    limits: ['On an unbalanced tree this is a linear search wearing a tree, and the comparison count is how you find out.']
  },
  {
    id: 'in-order',
    name: 'In-order traversal',
    family: 'trees',
    idea: 'Left, then the node, then right — which on a search tree comes out sorted.',
    complexity: O('O(n)', 'O(n)', 'O(n)', 'O(h)'),
    stable: true, inPlace: true, deterministic: true, needs: ['values'],
    limits: ['The recursion goes as deep as the tree, so an unbalanced tree can run the stack out where a balanced one would not.']
  },
  {
    id: 'pre-order',
    name: 'Pre-order traversal',
    family: 'trees',
    idea: 'The node, then left, then right — the order you would write the tree down to rebuild it later.',
    complexity: O('O(n)', 'O(n)', 'O(n)', 'O(h)'),
    stable: true, inPlace: true, deterministic: true, needs: ['values'],
    limits: ['Differs from in-order by one line\u2019s position, which is why the three are shown together.']
  },
  {
    id: 'post-order',
    name: 'Post-order traversal',
    family: 'trees',
    idea: 'Left, then right, then the node — the order you would delete a tree in, children before parents.',
    complexity: O('O(n)', 'O(n)', 'O(n)', 'O(h)'),
    stable: true, inPlace: true, deterministic: true, needs: ['values'],
    limits: ['The root comes last, always, which is the property that makes it right for freeing memory.']
  },
  {
    id: 'level-order',
    name: 'Level-order traversal',
    family: 'trees',
    idea: 'Level by level, using a queue — the only one of the four that is not recursive and the only one that needs to be.',
    complexity: O('O(n)', 'O(n)', 'O(n)', 'O(n)'),
    stable: true, inPlace: false, deterministic: true, needs: ['values'],
    limits: ['The queue can hold a whole level at once, so the memory is the width of the tree rather than its depth.']
  },
  // ------------------------------------------------ hashing
  {
    id: 'hash-chaining',
    name: 'Hash table with chaining',
    family: 'hashing',
    idea: 'Each bucket holds a list, so a collision just makes the list longer.',
    complexity: O('O(1)', 'O(1)', 'O(n)', 'O(n)'),
    stable: true, inPlace: false, deterministic: true, needs: ['values'],
    limits: [
      'Constant time only while the chains stay short. The longest chain is reported, because that is the real cost of a lookup.',
      'The hash here is deliberately simple; a better one spreads the keys more evenly and the collision count is how you would tell.'
    ]
  },
  {
    id: 'hash-probing',
    name: 'Hash table with probing',
    family: 'hashing',
    idea: 'No chains: on a collision, try the next slot along, and the next.',
    complexity: O('O(1)', 'O(1)', 'O(n)', 'O(n)'),
    stable: true, inPlace: true, deterministic: true, needs: ['values'],
    limits: [
      'There must be more slots than values, and it refuses otherwise rather than looping for ever.',
      'Above about seventy per cent full the probe runs grow sharply, which chaining does not do — and that is the trade between them.'
    ]
  },
  // ------------------------------------------------ greedy
  {
    id: 'activity-selection',
    name: 'Activity selection',
    family: 'greedy',
    idea: 'Always take whatever finishes soonest. It is right because finishing early leaves the most room for everything after.',
    complexity: O('O(n log n)', 'O(n log n)', 'O(n log n)', 'O(n)'),
    stable: true, inPlace: false, deterministic: true, needs: ['items'],
    limits: [
      'Taking the shortest activity, or the one that starts first, both give the wrong answer — and the example here is chosen so they do.',
      'One resource only. Scheduling across several is a different and much harder problem.'
    ]
  },
  {
    id: 'fractional-knapsack',
    name: 'Fractional knapsack',
    family: 'greedy',
    idea: 'Take the best value per unit of weight, and cut the last item to fit.',
    complexity: O('O(n log n)', 'O(n log n)', 'O(n log n)', 'O(n)'),
    stable: true, inPlace: false, deterministic: true, needs: ['items', 'capacity'],
    limits: [
      'Greedy is provably right here only because an item may be cut. For the 0/1 version it is wrong, which is why that one needs dynamic programming.',
      'Zero-weight items would have infinite value per weight, so they are refused.'
    ]
  },
  {
    id: 'coin-change-greedy',
    name: 'Coin change, greedily',
    family: 'greedy',
    idea: 'Take the largest coin that fits, repeatedly — which is right for ordinary money and wrong for other coin sets.',
    complexity: O('O(n)', 'O(n)', 'O(n)', 'O(1)'),
    stable: true, inPlace: true, deterministic: true, needs: ['values'],
    limits: [
      'It checks its own answer against the true fewest, worked out properly, and says plainly when greedy was wrong. With coins 1, 3 and 4 making 6 it is.',
      'Whole-number coins and amounts only.'
    ]
  },
  // ------------------------------------------------ recursion and backtracking
  {
    id: 'hanoi',
    name: 'Towers of Hanoi',
    family: 'backtracking',
    idea: 'To move n discs, move n-1 out of the way, move the biggest, then move the n-1 back on top. No choices, only recursion.',
    complexity: O('O(2\u207f)', 'O(2\u207f)', 'O(2\u207f)', 'O(n)'),
    stable: true,
    inPlace: true,
    deterministic: true,
    needs: ['n'],
    most: 12,
    limits: [
      'Twelve discs or fewer. The number of moves doubles with each one, so thirteen is already over eight thousand steps.',
      'Three pegs. The four-peg version (Frame-Stewart) is a different and still unproven problem, and is not here.'
    ]
  },
  {
    id: 'permutations',
    name: 'Permutations',
    family: 'backtracking',
    idea: 'Choose an unused item, recurse, then put it back and choose a different one.',
    complexity: O('O(n!)', 'O(n!)', 'O(n \u00b7 n!)', 'O(n)'),
    stable: true,
    inPlace: true,
    deterministic: true,
    needs: ['items'],
    most: 9,
    limits: [
      'Nine items or fewer: ten already has 3,628,800 arrangements.',
      'Items are treated as distinct. Repeated items produce repeated arrangements rather than being collapsed.'
    ]
  },
  {
    id: 'subsets',
    name: 'Subsets',
    family: 'backtracking',
    idea: 'For each item in turn, try leaving it out and then try putting it in. Every leaf of that tree is a subset.',
    complexity: O('O(2\u207f)', 'O(2\u207f)', 'O(n \u00b7 2\u207f)', 'O(n)'),
    stable: true,
    inPlace: true,
    deterministic: true,
    needs: ['items'],
    most: 14,
    limits: [
      'Fourteen items or fewer.',
      'The order is the order the recursion finds them in, which is not sorted by size.'
    ]
  },
  {
    id: 'n-queens',
    name: 'N-Queens',
    family: 'backtracking',
    idea: 'Place one queen per row; when a row has no safe column, take the last queen back and move it along.',
    complexity: O('O(n!)', 'O(n!)', 'O(n!)', 'O(n)'),
    stable: true,
    inPlace: true,
    deterministic: true,
    needs: ['n'],
    most: 10,
    limits: [
      'Ten queens or fewer, because every placement, every attack check and every removal is a recorded step.',
      'It finds every solution rather than stopping at the first, which is why the step count is large.',
      'Solutions that are rotations or reflections of each other are counted separately \u2014 this counts placements, not distinct boards.'
    ]
  },
  // ------------------------------------------------ strings
  {
    id: 'naive-match',
    name: 'Naive string matching',
    family: 'strings',
    idea: 'Try the pattern at every position in turn, comparing from the left until something differs.',
    complexity: O('O(n)', 'O(n \u00b7 m)', 'O(n \u00b7 m)', 'O(1)'),
    stable: true,
    inPlace: true,
    deterministic: true,
    needs: ['strings'],
    limits: [
      'Re-reads characters it has already read after every mismatch. On a text of repeated characters that is the whole cost, and watching the comparison count beside KMP is the point of having it.',
      'Exact matching only \u2014 no wildcards, no regular expressions, no approximate match.'
    ]
  },
  {
    id: 'kmp',
    name: 'Knuth-Morris-Pratt',
    family: 'strings',
    idea: 'Build a table of how far the pattern can jump back after a mismatch, then walk the text once without ever re-reading a character.',
    complexity: O('O(n + m)', 'O(n + m)', 'O(n + m)', 'O(m)'),
    stable: true,
    inPlace: true,
    deterministic: true,
    needs: ['strings'],
    limits: [
      'The table costs O(m) to build and O(m) to hold, which is why it is not automatically the right choice for a one-off search of a short pattern.',
      'Exact matching only.'
    ]
  },
  {
    id: 'rabin-karp',
    name: 'Rabin-Karp',
    family: 'strings',
    idea: 'Hash the pattern and every window of the text, rolling the hash forward in constant time, and compare characters only when the hashes agree.',
    complexity: O('O(n + m)', 'O(n + m)', 'O(n \u00b7 m)', 'O(1)'),
    stable: true,
    inPlace: true,
    deterministic: true,
    needs: ['strings'],
    limits: [
      'Its worst case is as bad as the naive matcher, and it happens when the hash collides often. The spurious-hit count is reported so that is visible rather than taken on trust.',
      'The hash here is base 256 modulo 1,000,003. A different modulus gives different collisions and a different count.',
      'Exact matching only.'
    ]
  },
  // ------------------------------------------------ dynamic programming
  {
    id: 'knapsack',
    name: '0/1 knapsack',
    family: 'dynamic',
    idea: 'Fill a table: the best value using the first i items within weight w, then read the choices back out.',
    complexity: O('O(n·W)', 'O(n·W)', 'O(n·W)', 'O(n·W)'),
    stable: true,
    inPlace: false,
    deterministic: true,
    needs: ['items', 'capacity'],
    limits: ['Whole weights only: the table has one column per unit of capacity. It is pseudo-polynomial, not polynomial in the input size.']
  },
  {
    id: 'lcs',
    name: 'Longest common subsequence',
    family: 'dynamic',
    idea: 'Fill a grid comparing each letter of one string with each of the other, then walk back to read the sequence.',
    complexity: O('O(n·m)', 'O(n·m)', 'O(n·m)', 'O(n·m)'),
    stable: true,
    inPlace: false,
    deterministic: true,
    needs: ['strings'],
    limits: ['A subsequence need not be contiguous. For the longest common substring the recurrence is different.']
  },
  {
    id: 'lis',
    name: 'Longest increasing subsequence',
    family: 'dynamic',
    idea: 'For each position work out the longest increasing run ending there, then follow the trail back.',
    complexity: O('O(n²)', 'O(n²)', 'O(n²)', 'O(n)'),
    stable: true,
    inPlace: false,
    deterministic: true,
    needs: ['values'],
    limits: ['There is an O(n log n) version; this one is quadratic because the table it fills is what can be shown.']
  },
  {
    id: 'fibonacci',
    name: 'Fibonacci: recursion against a table',
    family: 'dynamic',
    idea: 'Run the naive recursion and the table side by side, and count what each one cost.',
    complexity: O('O(n)', 'O(n)', 'O(2ⁿ) naive', 'O(n)'),
    stable: true,
    inPlace: false,
    deterministic: true,
    needs: ['n'],
    limits: ['Capped at n = 30, because the naive recursion beyond that is a hang rather than a demonstration.']
  }
])

const BY_ID = new Map(CATALOGUE.map((one) => [one.id, one]))

export const entryFor = (id: string): Entry | null => BY_ID.get(id) ?? null

export const inFamily = (family: Family): readonly Entry[] => CATALOGUE.filter((one) => one.family === family)

// ---------------------------------------------------------------- running one by id

export interface RunRequest {
  values?: readonly number[]
  target?: number
  graph?: Graph
  start?: string
  graphTarget?: string
  at?: Readonly<Record<string, { x: number; y: number }>>
  items?: readonly Item[]
  capacity?: number
  a?: string
  b?: string
  n?: number
  pivot?: Pivot
  seed?: number
  ceiling?: number
}

/**
 * Any algorithm, by id, from one request shape.
 *
 * The single door the laboratory and Orion both go through. Without it, every caller would need a switch over four
 * families and the two would eventually disagree about what "binary search" takes.
 */
export function run(id: string, request: RunRequest): Run | AlgorithmError {
  const entry = entryFor(id)
  if (!entry) return fail('unknown', `There is no algorithm called "${id}".`, `Try one of: ${CATALOGUE.slice(0, 6).map((one) => one.id).join(', ')}.`)

  // What it needs, checked here rather than in each implementation, so a missing input is one message everywhere.
  for (const need of entry.needs) {
    switch (need) {
      case 'values':
        if (!request.values) return fail('needs-values', `${entry.name} needs a list of numbers.`, 'Give some numbers.')
        break
      case 'target':
        if (typeof request.target !== 'number') return fail('needs-target', `${entry.name} needs a value to look for.`, 'Say what to search for.')
        break
      case 'graph':
        if (!request.graph) return fail('needs-graph', `${entry.name} needs a graph.`, 'Build a graph first.')
        break
      case 'start':
        if (!request.start && !(request.graph && request.graph.nodes.length > 0)) {
          return fail('needs-start', `${entry.name} needs a node to start from.`, 'Pick a start node.')
        }
        break
      case 'graphTarget':
        if (!request.graphTarget) return fail('needs-target', `${entry.name} needs a destination.`, 'Pick a node to reach.')
        break
      case 'positions':
        if (!request.at || Object.keys(request.at).length === 0) {
          return fail('needs-positions', `${entry.name} needs a position for every node, to estimate the distance left.`, 'Use a grid graph, or give positions.')
        }
        break
      case 'items':
        if (!request.items || request.items.length === 0) return fail('needs-items', `${entry.name} needs some items.`, 'Add items.')
        break
      case 'capacity':
        if (typeof request.capacity !== 'number') return fail('needs-capacity', `${entry.name} needs a capacity.`, 'Give a whole number.')
        break
      case 'strings':
        if (typeof request.a !== 'string' || typeof request.b !== 'string') return fail('needs-strings', `${entry.name} needs two pieces of text.`, 'Give two strings.')
        break
      case 'n':
        if (typeof request.n !== 'number') return fail('needs-n', `${entry.name} needs a number.`, 'Give a whole number.')
        break
      default:
        break
    }
  }

  switch (entry.family) {
    case 'sorting':
      return runSort(entry.id as SortName, request.values ?? [], { pivot: request.pivot, seed: request.seed, ceiling: request.ceiling })
    case 'searching':
      return runSearch(entry.id as SearchName, request.values ?? [], request.target ?? 0, request.ceiling)
    case 'graphs':
      return runGraph(entry.id as GraphName, request.graph as Graph, {
        start: request.start,
        target: request.graphTarget,
        at: request.at,
        ceiling: request.ceiling
      })
    case 'arrays':
    case 'lists':
    case 'stacks':
    case 'queues':
      return runStructure(entry.id as StructureName, {
        values: request.values,
        target: request.target,
        ceiling: request.ceiling
      })
    case 'trees':
    case 'hashing':
    case 'greedy':
      return runTree(entry.id as TreeName, {
        values: request.values,
        target: request.target,
        capacity: request.capacity,
        ceiling: request.ceiling
      })
    case 'backtracking':
      return runBacktrack(entry.id as BacktrackName, {
        n: request.n,
        items: request.values,
        ceiling: request.ceiling
      })
    case 'strings':
      return runString(entry.id as StringName, request.a ?? '', request.b ?? '', request.ceiling)
    case 'dynamic':
      return runDynamic(entry.id as DynamicName, {
        items: request.items,
        capacity: request.capacity,
        a: request.a,
        b: request.b,
        values: request.values,
        n: request.n,
        ceiling: request.ceiling
      })
    default:
      return fail('unknown', `There is no family called "${String(entry.family)}".`, 'This is a programming error.')
  }
}

// ---------------------------------------------------------------- comparing

export interface Side {
  id: string
  name: string
  /** Null when that algorithm refused this input, with the reason beside it. */
  run: Run | null
  refused: string | null
}

export interface Comparison {
  /** What all of them were given. The same input, which is what makes it a comparison. */
  input: Readonly<Record<string, unknown>>
  sides: readonly Side[]
  /** The fewest comparisons, the fewest steps, and so on — worked out, never asserted. */
  winners: Readonly<Record<string, string>>
}

/**
 * Several algorithms over one input.
 *
 * The same array, the same seed, the same target. An algorithm that refuses the input — binary search on an
 * unsorted list, counting sort on decimals — appears with its reason rather than being dropped, because its absence
 * would otherwise look like a bug.
 */
export function compare(ids: readonly string[], request: RunRequest): Comparison | AlgorithmError {
  if (ids.length < 2) return fail('too-few', 'A comparison needs at least two algorithms.', 'Pick another one.')
  if (ids.length > 6) return fail('too-many', 'More than six at once is unreadable.', 'Pick at most six.')

  const sides: Side[] = []
  for (const id of ids) {
    const entry = entryFor(id)
    if (!entry) return fail('unknown', `There is no algorithm called "${id}".`, 'Check the name.')
    const made = run(id, request)
    if (isError(made)) sides.push({ id, name: entry.name, run: null, refused: `${made.message} ${made.fix}` })
    else sides.push({ id, name: entry.name, run: made, refused: null })
  }

  const ran = sides.filter((one): one is Side & { run: Run } => one.run !== null)
  const winners: Record<string, string> = {}
  const least = (pick: (run: Run) => number, label: string): void => {
    const sorted = ran.filter((one) => pick(one.run) > 0).sort((a, b) => pick(a.run) - pick(b.run))
    if (sorted.length > 0) winners[label] = sorted[0].name
  }
  least((one) => one.counts.comparisons, 'fewest comparisons')
  least((one) => one.counts.swaps, 'fewest swaps')
  least((one) => one.counts.steps, 'fewest steps')
  least((one) => one.counts.writes, 'fewest writes')

  return { input: { ...request, values: request.values ? [...request.values] : undefined }, sides, winners }
}

const isError = (value: Run | AlgorithmError): value is AlgorithmError => 'error' in value && 'fix' in value

/** A comparison in words, for Orion and for a result card. */
export function describeComparison(comparison: Comparison): string {
  const lines = comparison.sides.map((one) => (one.run ? `${one.name}: ${summarise(one.run)}` : `${one.name}: refused — ${one.refused}`))
  const won = Object.entries(comparison.winners).map(([what, who]) => `${what}: ${who}`)
  return [...lines, ...(won.length > 0 ? [won.join(' · ')] : [])].join('\n')
}

// ---------------------------------------------------------------- measured against stated

export interface Measurement {
  size: number
  comparisons: number
  swaps: number
  steps: number
  /** True when the step ceiling cut the run short, so this point is a floor rather than a measurement. */
  cut: boolean
}

export interface Growth {
  id: string
  name: string
  /** What the textbook says. Not derived from the measurements. */
  stated: Entry['complexity']
  /** What actually happened, at each size. */
  measured: readonly Measurement[]
  /** The shape the input had, because a growth curve means nothing without it. */
  shape: Shape
  seed: number
}

const SIZES = [10, 20, 40, 80, 160, 320, 640] as const

/**
 * How an algorithm's work grows with the input size.
 *
 * Runs it at several sizes on the same shape of input and reports the counts. Deliberately does *not* fit a curve
 * and announce "this is O(n log n)": a handful of points cannot establish a bound, and claiming it would be the
 * fabricated-convergence failure the brief names. The stated complexity and the measured points are shown together
 * and the reader draws the conclusion.
 */
export function growth(id: string, shape: Shape = 'random', seed = 1, sizes: readonly number[] = SIZES): Growth | AlgorithmError {
  const entry = entryFor(id)
  if (!entry) return fail('unknown', `There is no algorithm called "${id}".`, 'Check the name.')
  if (entry.family !== 'sorting' && entry.family !== 'searching') {
    return fail('not-measurable', `A growth curve here is for sorting and searching, not for ${entry.family}.`, 'Pick a sort or a search.')
  }

  const measured: Measurement[] = []
  for (const size of sizes) {
    const values = makeNumbers(shape, size, seed)
    if (isError(values as never)) return values as unknown as AlgorithmError
    const list = values as readonly number[]
    // A search needs something to look for, and the last value is the honest worst case for a present value.
    const made = run(id, { values: entry.family === 'searching' ? [...list].sort((a, b) => a - b) : list, target: list[list.length - 1], seed })
    if (isError(made)) return made
    measured.push({ size, comparisons: made.counts.comparisons, swaps: made.counts.swaps, steps: made.counts.steps, cut: made.cut })
  }

  return { id, name: entry.name, stated: entry.complexity, measured, shape, seed }
}
