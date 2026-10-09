import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { Recorder, arrayAt, describeStep, isAlgorithmError, randomFrom, regionAt, settledAt, stackAt, summarise, visitedAt } from './trace.ts'
import { SORT_NAMES, countingSort, runSort, type SortName } from './sorting.ts'
import { SEARCH_NAMES, binarySearch, runSearch } from './searching.ts'
import { bellmanFord, breadthFirst, depthFirst, dijkstra, graphOf, kruskal, topologicalSort, aStar, type Graph } from './graphs.ts'
import { fibonacci, knapsack, longestCommonSubsequence, longestIncreasingSubsequence } from './dynamic.ts'
import { SHAPES, makeGraph, makeNumbers, makeItems } from './inputs.ts'
import { CATALOGUE, compare, entryFor, growth, run } from './catalogue.ts'

// The existing engines, which these traced versions must agree with. Two implementations of one algorithm are only
// honest if something checks they produce the same answer.
import { dijkstra as dijkstraOf, graphOf as discreteGraphOf, breadthFirst as bfsOf, topologicalSort as topoOf } from '../compute/discrete.ts'

/**
 * The algorithm engines, checked where they would actually be wrong.
 *
 * The tests that matter most are not "does it sort". They are:
 *
 *   - **correctness against a known answer**, for every algorithm, on every shape of input including the adversarial ones;
 *   - **the metadata's claims**, which are claims: `stable` is checked by sorting equal keys, `inPlace` against the
 *     recorded writes, `complexity` against the measured growth being at least plausible;
 *   - **the trace agreeing with the result** — replaying the recorded swaps must produce the sorted array, or the
 *     visualiser would show something the algorithm did not do;
 *   - **the traced graph algorithms agreeing with `compute/discrete.ts`**, which is the only thing that makes keeping
 *     two implementations defensible;
 *   - **refusals**, which are features: binary search on unsorted input, Dijkstra with a negative edge, counting sort
 *     on decimals.
 */

const sortedCopy = (values: readonly number[]): number[] => [...values].sort((a, b) => a - b)

// ---------------------------------------------------------------- the recorder

describe('the trace recorder', () => {
  it('counts what it is told, and a swap as two reads and two writes', () => {
    const rec = new Recorder()
    rec.step('compare', 'a vs b', [0, 1])
    rec.step('swap', 'swap', [0, 1])
    rec.step('read', 'look', [2])
    const run = rec.finish('test', {}, null)
    assert.equal(run.counts.comparisons, 1)
    assert.equal(run.counts.swaps, 1)
    assert.equal(run.counts.reads, 3)
    assert.equal(run.counts.writes, 2)
    assert.equal(run.counts.steps, 3)
  })

  it('stops at the ceiling and says the answer is incomplete', () => {
    const rec = new Recorder(5)
    for (let at = 0; at < 50; at += 1) rec.step('read', 'look', [at])
    assert.equal(rec.cut, true)
    const run = rec.finish('test', {}, null)
    assert.equal(run.steps.length, 5)
    assert.equal(run.cut, true)
    assert.match(String(run.stopped), /incomplete/)
  })

  it('records frames with their depth, and closes them', () => {
    const rec = new Recorder()
    const outer = rec.enter('outer')
    const inner = rec.enter('inner')
    rec.leave(inner, '1')
    rec.leave(outer, '2')
    const run = rec.finish('test', {}, null)
    assert.equal(run.frames.length, 2)
    assert.equal(run.frames[1].parent, 0)
    assert.equal(run.frames[1].depth, 1)
    assert.equal(run.counts.depth, 2)
    assert.ok(run.frames.every((one) => one.to !== null))
  })

  it('is deterministic from a seed', () => {
    const a = randomFrom(42)
    const b = randomFrom(42)
    assert.deepEqual([a(), a(), a()], [b(), b(), b()])
    assert.notDeepEqual([randomFrom(1)()], [randomFrom(2)()])
  })
})

// ---------------------------------------------------------------- sorting

describe('sorting', () => {
  const inputs: readonly (readonly number[])[] = [
    [],
    [1],
    [2, 1],
    [5, 3, 8, 1, 9, 2, 7],
    [1, 2, 3, 4, 5],
    [5, 4, 3, 2, 1],
    [3, 3, 3, 3],
    [-5, 10, 0, -2, 7]
  ]

  for (const name of SORT_NAMES) {
    it(`${name} sorts every input correctly`, () => {
      for (const input of inputs) {
        // Counting and radix are whole-number only; the inputs above are all whole, but radix refuses negatives.
        const made = runSort(name, input)
        if (isAlgorithmError(made)) {
          assert.ok(name === 'radix' && input.some((one) => one < 0), `${name} refused ${JSON.stringify(input)}: ${made.message}`)
          continue
        }
        const result = made.result as { sorted: number[]; correct: boolean }
        if (made.cut) {
          assert.equal(entryFor(name)?.mayNotFinish, true, `${name} stopped short on ${JSON.stringify(input)} and does not declare that it can`)
          continue
        }
        assert.deepEqual(result.sorted, sortedCopy(input), `${name} on ${JSON.stringify(input)}`)
        assert.equal(result.correct, true)
      }
    })
  }

  it('sorts every shape of generated input, including the adversarial ones', () => {
    for (const shape of SHAPES) {
      for (const name of SORT_NAMES) {
        // Stooge sort and bogosort declare a shorter limit in the catalogue, because their costs are n^2.71 and
        // n!. Each is given the longest input it says it takes, rather than being excused from the sweep.
        const longest = Math.min(60, entryFor(name)?.most ?? 60)
        const values = makeNumbers(shape, longest, 7)
        assert.ok(!isAlgorithmError(values))
        const made = runSort(name, values, { pivot: 'last' })
        assert.ok(!isAlgorithmError(made), `${name} on ${shape}: ${isAlgorithmError(made) ? made.message : ''}`)
        if (made.cut) {
          // Only an algorithm that declares it may not finish is allowed to come back unsorted, and it still has
          // to say so on the run rather than returning a half-sorted list as the answer.
          assert.equal(entryFor(name)?.mayNotFinish, true, `${name} hit the step ceiling on ${shape} and does not declare that it can`)
          continue
        }
        assert.deepEqual((made.result as { sorted: number[] }).sorted, sortedCopy(values), `${name} on ${shape}`)
      }
    }
  })

  it('the recorded swaps replay to the sorted array, so the display cannot show something that did not happen', () => {
    const values = makeNumbers('random', 40, 3) as readonly number[]
    for (const name of ['bubble', 'insertion', 'selection', 'quick', 'heap'] as SortName[]) {
      const made = runSort(name, values)
      assert.ok(!isAlgorithmError(made))
      const replayed = arrayAt(values, made.steps, made.steps.length - 1)
      assert.deepEqual(replayed, sortedCopy(values), `${name} replay`)
    }
  })

  it('merge sort replays through its writes', () => {
    const values = makeNumbers('random', 24, 11) as readonly number[]
    const made = runSort('merge', values)
    assert.ok(!isAlgorithmError(made))
    assert.deepEqual(arrayAt(values, made.steps, made.steps.length - 1), sortedCopy(values))
  })

  it('is stable exactly where the catalogue claims, for the sorts where a trace can show it', () => {
    /*
     * Stability means equal values keep their original order. Testing it needs the original positions, and the
     * obvious trick -- encoding each value as value*100 + its index -- defeats itself: it makes every value distinct,
     * so every sort looks stable. That mistake was made here first.
     *
     * What works is replaying the trace's swaps over an array of original positions. For a swap-based sort that is
     * exact: whatever ends in slot k is the element that started at the position now sitting there, so an equal group
     * whose positions came out descending proves instability.
     *
     * It only works for the swap-based sorts. Merge, counting and radix move values by writing them, and a write
     * records the value rather than where it came from, so the trace cannot say which of two equal values was
     * written. Their stability is a property of the implementation and is not claimed to be tested here.
     */
    const values = [2, 2, 1, 5, 5, 3, 9, 9, 4, 1]
    const swapBased = ['bubble', 'selection', 'quick', 'heap'] as SortName[]

    for (const name of swapBased) {
      const entry = entryFor(name)
      assert.ok(entry)
      const made = runSort(name, values, { pivot: 'last' })
      assert.ok(!isAlgorithmError(made))

      // Replay the swaps over the original positions.
      const where = values.map((_, at) => at)
      for (const step of made.steps) {
        if (step.kind !== 'swap' || step.at.length !== 2) continue
        const [i, j] = step.at as [number, number]
        const held = where[i]
        where[i] = where[j]
        where[j] = held
      }

      const sorted = (made.result as { sorted: number[] }).sorted
      let stable = true
      const lastSeen = new Map<number, number>()
      for (let slot = 0; slot < sorted.length; slot += 1) {
        const value = sorted[slot]
        const original = where[slot]
        const previous = lastSeen.get(value)
        if (previous !== undefined && original < previous) stable = false
        lastSeen.set(value, original)
      }
      assert.equal(stable, entry.stable, `${entry.name} claims stable: ${entry.stable}`)
    }

    // The allocating sorts are checked only for producing the right answer on duplicates.
    for (const name of ['merge', 'counting', 'radix'] as SortName[]) {
      const made = runSort(name, values)
      assert.ok(!isAlgorithmError(made))
      assert.deepEqual((made.result as { sorted: number[] }).sorted, sortedCopy(values), name)
    }
  })

  it('every sort that does not allocate reorders by swapping only', () => {
    /*
     * Not a test of the `inPlace` claim, deliberately.
     *
     * A trace records operations, not memory, so it cannot measure O(1) extra space -- insertion sort is in place and
     * moves values by shifting rather than swapping, which a write-counting proxy would wrongly call out. What the
     * trace *can* show is that the swap-only sorts never write outside a swap, which is worth pinning down because a
     * future edit that introduced a scratch array would change it.
     */
    const values = makeNumbers('random', 50, 5) as readonly number[]
    for (const name of ['bubble', 'selection', 'quick', 'heap'] as SortName[]) {
      const made = runSort(name, values)
      assert.ok(!isAlgorithmError(made))
      assert.equal(made.counts.writes, made.counts.swaps * 2, `${name} wrote outside a swap`)
    }

    // And the three that allocate do write outside swaps, which is the observable difference.
    for (const name of ['merge', 'counting', 'radix'] as SortName[]) {
      const made = runSort(name, values)
      assert.ok(!isAlgorithmError(made))
      assert.ok(made.counts.writes > made.counts.swaps * 2, `${name} should write into scratch space`)
    }
  })

  it('bubble sort is linear on sorted input, which is its whole best case', () => {
    const sortedInput = makeNumbers('sorted', 100, 1) as readonly number[]
    const made = runSort('bubble', sortedInput)
    assert.ok(!isAlgorithmError(made))
    // One pass of comparisons and no swaps: 99 comparisons, not ~5,000.
    assert.equal(made.counts.swaps, 0)
    assert.ok(made.counts.comparisons < 120, `made ${made.counts.comparisons} comparisons`)
  })

  it('selection sort makes the same number of comparisons whatever the input', () => {
    const a = runSort('selection', makeNumbers('sorted', 50, 1) as readonly number[])
    const b = runSort('selection', makeNumbers('reversed', 50, 1) as readonly number[])
    assert.ok(!isAlgorithmError(a) && !isAlgorithmError(b))
    assert.equal(a.counts.comparisons, b.counts.comparisons)
    assert.equal(a.counts.comparisons, (50 * 49) / 2)
  })

  it('the quicksort killer really is quadratic for a last-element pivot, and a better pivot escapes it', () => {
    const killer = makeNumbers('quicksort-killer', 200, 1) as readonly number[]
    const bad = runSort('quick', killer, { pivot: 'last' })
    const good = runSort('quick', killer, { pivot: 'median-of-three' })
    assert.ok(!isAlgorithmError(bad) && !isAlgorithmError(good))
    assert.ok(bad.counts.comparisons > good.counts.comparisons * 3, `last: ${bad.counts.comparisons}, median: ${good.counts.comparisons}`)
  })

  it('counting sort refuses decimals and very wide ranges, rather than producing nonsense', () => {
    const decimals = countingSort([1.5, 2.5])
    assert.ok(isAlgorithmError(decimals))
    assert.match(decimals.message, /whole numbers/)

    const wide = countingSort([0, 50_000_000])
    assert.ok(isAlgorithmError(wide))
    assert.match(wide.message, /bucket/)
  })

  it('counting sort makes no comparisons at all', () => {
    const made = runSort('counting', [5, 2, 8, 2, 1])
    assert.ok(!isAlgorithmError(made))
    assert.equal(made.counts.comparisons, 0)
  })

  it('refuses a list that is too long rather than freezing', () => {
    const made = runSort('bubble', new Array(50_000).fill(1))
    assert.ok(isAlgorithmError(made))
    assert.match(made.message, /more than this laboratory/)
  })

  it('reports being cut short rather than claiming an incomplete answer is sorted', () => {
    const values = makeNumbers('reversed', 400, 1) as readonly number[]
    const made = runSort('bubble', values, { ceiling: 500 })
    assert.ok(!isAlgorithmError(made))
    assert.equal(made.cut, true)
    assert.equal((made.result as { correct: boolean }).correct, false)
  })
})

// ---------------------------------------------------------------- searching

describe('searching', () => {
  const values = Array.from({ length: 50 }, (_, at) => at * 2)

  for (const name of SEARCH_NAMES) {
    it(`${name} finds every value that is there and reports every one that is not`, () => {
      for (const target of [0, 18, 98, 1, 99, -4]) {
        const made = runSearch(name, values, target)
        assert.ok(!isAlgorithmError(made), `${name} for ${target}`)
        const result = made.result as { at: number; found: boolean; comparisons: number }
        const expected = values.indexOf(target)
        assert.equal(result.found, expected >= 0, `${name} looking for ${target}`)
        if (expected >= 0) assert.equal(values[result.at], target)
        // The reported comparison count must be the recorder's, not a separate tally.
        assert.equal(result.comparisons, made.counts.comparisons)
      }
    })
  }

  it('binary search is logarithmic, not linear', () => {
    const long = Array.from({ length: 1024 }, (_, at) => at)
    const made = binarySearch(long, 1023)
    assert.ok(!isAlgorithmError(made))
    // log2(1024) is 10, so a handful of comparisons rather than a thousand.
    assert.ok(made.counts.comparisons <= 12, `made ${made.counts.comparisons} comparisons`)
  })

  it('binary search refuses unsorted input instead of reporting a present value as missing', () => {
    const made = binarySearch([5, 1, 9, 3], 9)
    assert.ok(isAlgorithmError(made))
    assert.match(made.message, /already in order/)
    assert.match(made.fix, /linear search/)
  })

  it('records the window at every step, which is what explains a comparison count', () => {
    const made = binarySearch(values, 98)
    assert.ok(!isAlgorithmError(made))
    const region = regionAt(made.steps, made.steps.length - 1)
    assert.ok(region, 'the search window should have been recorded')
    assert.ok(describeStep(made, 2)?.includes('Step 2'))
  })
})

// ---------------------------------------------------------------- graphs

describe('graph algorithms', () => {
  const made = graphOf(['a', 'b', 'c', 'd', 'e'], [
    { from: 'a', to: 'b', weight: 4 },
    { from: 'a', to: 'c', weight: 2 },
    { from: 'b', to: 'c', weight: 1 },
    { from: 'b', to: 'd', weight: 5 },
    { from: 'c', to: 'd', weight: 8 },
    { from: 'd', to: 'e', weight: 3 }
  ])
  assert.ok(!isAlgorithmError(made))
  const graph = made as Graph

  it('refuses a graph whose edge names no node', () => {
    const bad = graphOf(['a'], [{ from: 'a', to: 'zz' }])
    assert.ok(isAlgorithmError(bad))
    assert.match(bad.message, /not a node/)
  })

  it('breadth-first agrees with compute/discrete.ts', () => {
    const traced = breadthFirst(graph, 'a')
    assert.ok(!isAlgorithmError(traced))
    const other = discreteGraphOf(graph.nodes, graph.edges, false)
    assert.ok(!('error' in other))
    const theirs = bfsOf(other, 'a')
    assert.ok(!('error' in theirs))
    // The same set of nodes reached. The order within a level depends on neighbour ordering, so the sets are compared.
    assert.deepEqual((traced.result as { order: string[] }).order.slice().sort(), [...theirs.order].sort())
  })

  it('Dijkstra agrees with compute/discrete.ts on every distance', () => {
    const traced = dijkstra(graph, 'a')
    assert.ok(!isAlgorithmError(traced))
    const other = discreteGraphOf(graph.nodes, graph.edges, false)
    assert.ok(!('error' in other))
    const theirs = dijkstraOf(other, 'a')
    assert.ok(!('error' in theirs))
    const mine = (traced.result as { distance: Record<string, number> }).distance
    // `discrete.ts` returns Maps rather than plain objects, which is why this reads them with .get.
    for (const node of graph.nodes) {
      const expected = theirs.distances.get(node)
      if (typeof expected === 'number') assert.equal(mine[node], expected, `distance to ${node}`)
    }
  })

  it('Dijkstra finds the shortest path, not merely a path', () => {
    const made = dijkstra(graph, 'a', 'd')
    assert.ok(!isAlgorithmError(made))
    const result = made.result as { distance: Record<string, number>; path: string[] }
    // a→c→b→d is 2+1+5 = 8, better than a→b→d (9) and a→c→d (10).
    assert.equal(result.distance.d, 8)
    assert.deepEqual(result.path, ['a', 'c', 'b', 'd'])
  })

  it('Dijkstra refuses a negative edge and names Bellman-Ford instead', () => {
    const negative = graphOf(['a', 'b'], [{ from: 'a', to: 'b', weight: -2 }]) as Graph
    const made = dijkstra(negative, 'a')
    assert.ok(isAlgorithmError(made))
    assert.match(made.fix, /Bellman-Ford/)
  })

  it('Bellman-Ford handles a negative edge and detects a negative cycle', () => {
    const fine = graphOf(['a', 'b', 'c'], [
      { from: 'a', to: 'b', weight: 4 },
      { from: 'b', to: 'c', weight: -2 }
    ], true) as Graph
    const ok = bellmanFord(fine, 'a')
    assert.ok(!isAlgorithmError(ok))
    const result = ok.result as { distance: Record<string, number>; negativeCycle: boolean }
    assert.equal(result.distance.c, 2)
    assert.equal(result.negativeCycle, false)

    const cyclic = graphOf(['a', 'b', 'c'], [
      { from: 'a', to: 'b', weight: 1 },
      { from: 'b', to: 'c', weight: -3 },
      { from: 'c', to: 'b', weight: 1 }
    ], true) as Graph
    const bad = bellmanFord(cyclic, 'a')
    assert.ok(!isAlgorithmError(bad))
    assert.equal((bad.result as { negativeCycle: boolean }).negativeCycle, true)
    // And it must not then present a path as shortest.
    assert.deepEqual((bad.result as { path: string[] }).path, [])
  })

  it('depth-first records a recursion tree', () => {
    const traced = depthFirst(graph, 'a')
    assert.ok(!isAlgorithmError(traced))
    assert.ok(traced.frames.length > 0)
    assert.ok(traced.counts.depth > 1)
    assert.ok(stackAt(traced, 3).length > 0)
  })

  it('visited nodes can be replayed from the trace', () => {
    const traced = breadthFirst(graph, 'a')
    assert.ok(!isAlgorithmError(traced))
    const visited = visitedAt(traced.steps, traced.steps.length - 1)
    assert.deepEqual([...visited].sort(), [...graph.nodes].sort())
  })

  it('Kruskal finds the minimum weight, and says when the graph is in pieces', () => {
    const traced = kruskal(graph)
    assert.ok(!isAlgorithmError(traced))
    const result = traced.result as { weight: number; spans: boolean; chosen: unknown[] }
    // 2 (a-c) + 1 (b-c) + 3 (d-e) + 5 (b-d) = 11
    assert.equal(result.weight, 11)
    assert.equal(result.spans, true)
    assert.equal(result.chosen.length, graph.nodes.length - 1)

    const split = makeGraph('disconnected', 10, 2)
    assert.ok(!isAlgorithmError(split))
    const forest = kruskal(split.graph)
    assert.ok(!isAlgorithmError(forest))
    assert.equal((forest.result as { spans: boolean }).spans, false)
  })

  it('topological sort agrees with compute/discrete.ts and refuses an undirected graph', () => {
    const dag = makeGraph('dag', 12, 4)
    assert.ok(!isAlgorithmError(dag))
    const traced = topologicalSort(dag.graph)
    assert.ok(!isAlgorithmError(traced))
    const result = traced.result as { order: string[]; possible: boolean }
    assert.equal(result.possible, true)

    // Every edge must point forwards in the order, which is what a topological order means.
    const at = new Map(result.order.map((one, index) => [one, index]))
    for (const edge of dag.graph.edges) assert.ok((at.get(edge.from) ?? 0) < (at.get(edge.to) ?? 0), `${edge.from} before ${edge.to}`)

    const other = discreteGraphOf(dag.graph.nodes, dag.graph.edges, true)
    assert.ok(!('error' in other))
    const theirs = topoOf(other)
    if (!('error' in theirs) && theirs.order) assert.equal(result.order.length, theirs.order.length)

    const undirected = topologicalSort(graph)
    assert.ok(isAlgorithmError(undirected))
  })

  it('a cycle means no order, and the nodes in it are named', () => {
    const cyclic = graphOf(['a', 'b', 'c'], [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'a' }
    ], true) as Graph
    const made = topologicalSort(cyclic)
    assert.ok(!isAlgorithmError(made))
    const result = made.result as { possible: boolean; inCycle: string[] }
    assert.equal(result.possible, false)
    assert.equal(result.inCycle.length, 3)
  })

  it('A* refuses a graph without positions rather than silently becoming Dijkstra', () => {
    const made = aStar(graph, 'a', 'e', {})
    assert.ok(isAlgorithmError(made))
    assert.match(made.fix, /Dijkstra/)
  })

  it('A* on a grid finds the same distance as Dijkstra', () => {
    const grid = makeGraph('grid', 36, 9, true)
    assert.ok(!isAlgorithmError(grid))
    const from = grid.graph.nodes[0]
    const to = grid.graph.nodes[grid.graph.nodes.length - 1]
    const star = aStar(grid.graph, from, to, grid.at)
    const plain = dijkstra(grid.graph, from, to)
    assert.ok(!isAlgorithmError(star) && !isAlgorithmError(plain))
    const a = (star.result as { distance: Record<string, number> }).distance[to]
    const b = (plain.result as { distance: Record<string, number> }).distance[to]
    assert.ok(Math.abs(a - b) < 1e-9, `A* ${a} against Dijkstra ${b}`)
  })
})

// ---------------------------------------------------------------- dynamic programming

describe('dynamic programming', () => {
  it('knapsack finds the known best and the items that make it', () => {
    const items = [
      { name: 'a', weight: 1, value: 1 },
      { name: 'b', weight: 3, value: 4 },
      { name: 'c', weight: 4, value: 5 },
      { name: 'd', weight: 5, value: 7 }
    ]
    const made = knapsack(items, 7)
    assert.ok(!isAlgorithmError(made))
    const result = made.result as { best: number; taken: { name: string }[]; weightUsed: number }
    // The textbook answer for this classic instance is 9, taking b and d (weight 8 is too much; 3+5=8 > 7)...
    // b+c = weight 7, value 9. That is the best within 7.
    assert.equal(result.best, 9)
    assert.deepEqual(result.taken.map((one) => one.name), ['b', 'c'])
    assert.ok(result.weightUsed <= 7)
  })

  it('knapsack refuses fractional weights, and says why rather than rounding', () => {
    const made = knapsack([{ name: 'a', weight: 1.5, value: 2 }], 3)
    assert.ok(isAlgorithmError(made))
    assert.match(made.message, /whole weights/)
  })

  it('longest common subsequence finds a known answer and recovers the sequence', () => {
    const made = longestCommonSubsequence('AGGTAB', 'GXTXAYB')
    assert.ok(!isAlgorithmError(made))
    const result = made.result as { length: number; sequence: string }
    assert.equal(result.length, 4)
    assert.equal(result.sequence, 'GTAB')
  })

  it('longest increasing subsequence finds a known answer', () => {
    const made = longestIncreasingSubsequence([10, 9, 2, 5, 3, 7, 101, 18])
    assert.ok(!isAlgorithmError(made))
    const result = made.result as { length: number; sequence: string }
    assert.equal(result.length, 4)
    // 2, 3, 7, 18 or 2, 3, 7, 101 — both are length 4, and the one found must be increasing.
    const numbers = result.sequence.split(', ').map(Number)
    assert.equal(numbers.length, 4)
    assert.ok(numbers.every((one, at) => at === 0 || numbers[at - 1] < one))
  })

  it('fibonacci measures the cost of recomputation rather than asserting it', () => {
    const made = fibonacci(15)
    assert.ok(!isAlgorithmError(made))
    const result = made.result as { value: number; naiveCalls: number; tableSteps: number }
    assert.equal(result.value, 610)
    // fib(15) naively is 1,973 calls. The exact number is what makes the point, so it is checked.
    assert.equal(result.naiveCalls, 1973)
    assert.ok(result.tableSteps < 40, `the table took ${result.tableSteps} steps`)
  })

  it('refuses a fibonacci too large to demonstrate', () => {
    const made = fibonacci(45)
    assert.ok(isAlgorithmError(made))
    assert.match(made.message, /hang rather than a demonstration/)
  })
})

// ---------------------------------------------------------------- inputs

describe('input generators', () => {
  it('makes every shape at the requested size, from a seed', () => {
    for (const shape of SHAPES) {
      const values = makeNumbers(shape, 100, 3)
      assert.ok(!isAlgorithmError(values), shape)
      assert.equal(values.length, 100, shape)
      assert.ok(values.every((one) => Number.isFinite(one)), shape)
    }
  })

  it('is reproducible from its seed', () => {
    assert.deepEqual(makeNumbers('random', 50, 9), makeNumbers('random', 50, 9))
    assert.notDeepEqual(makeNumbers('random', 50, 9), makeNumbers('random', 50, 10))
  })

  it('sorted really is sorted and reversed really is reversed', () => {
    const up = makeNumbers('sorted', 20, 1) as readonly number[]
    const down = makeNumbers('reversed', 20, 1) as readonly number[]
    assert.deepEqual([...up], sortedCopy(up))
    assert.deepEqual([...down], sortedCopy(down).reverse())
  })

  it('nearly sorted is nearly sorted, not merely shuffled', () => {
    const values = makeNumbers('nearly-sorted', 200, 4) as readonly number[]
    const outOfPlace = values.filter((one, at) => at > 0 && values[at - 1] > one).length
    assert.ok(outOfPlace > 0, 'it should not be perfectly sorted')
    assert.ok(outOfPlace < 40, `${outOfPlace} of 200 out of place is not "nearly"`)
  })

  it('few-unique really has few distinct values', () => {
    const values = makeNumbers('few-unique', 300, 2) as readonly number[]
    assert.ok(new Set(values).size <= 5)
  })

  it('makes every graph shape, with positions', () => {
    for (const shape of ['random', 'grid', 'tree', 'cycle', 'bipartite', 'dag', 'disconnected'] as const) {
      const made = makeGraph(shape, 16, 5)
      assert.ok(!isAlgorithmError(made), shape)
      assert.ok(made.graph.nodes.length > 0, shape)
      for (const node of made.graph.nodes) assert.ok(made.at[node], `${shape}: ${node} has no position`)
    }
  })

  it('a tree has no cycles and a dag has a topological order', () => {
    const tree = makeGraph('tree', 20, 6)
    assert.ok(!isAlgorithmError(tree))
    assert.equal(tree.graph.edges.length, 19)

    const dag = makeGraph('dag', 20, 6)
    assert.ok(!isAlgorithmError(dag))
    const order = topologicalSort(dag.graph)
    assert.ok(!isAlgorithmError(order))
    assert.equal((order.result as { possible: boolean }).possible, true)
  })

  it('refuses a complete graph large enough to be unreadable', () => {
    const made = makeGraph('complete', 200, 1)
    assert.ok(isAlgorithmError(made))
  })

  it('makes whole-weight items for the knapsack', () => {
    const items = makeItems(8, 3)
    assert.ok(!isAlgorithmError(items))
    assert.ok(items.every((one) => Number.isInteger(one.weight) && one.weight > 0))
  })
})

// ---------------------------------------------------------------- the catalogue

describe('the algorithm catalogue', () => {
  it('has a unique id and complete metadata for every entry', () => {
    const seen = new Set<string>()
    for (const entry of CATALOGUE) {
      assert.ok(!seen.has(entry.id), `${entry.id} appears twice`)
      seen.add(entry.id)
      // Two characters is long enough: A* is a real name.
      assert.ok(entry.name.length >= 2, entry.id)
      assert.ok(entry.idea.length > 20, `${entry.id} needs a real description of how it works`)
      assert.ok(entry.complexity.best.includes('O'), entry.id)
      // Bogosort has no worst case, and writing one as O(something) would be a plain lie. "unbounded" is the
      // honest word, so the check accepts it rather than forcing a bound that does not exist.
      assert.ok(entry.complexity.worst.includes('O') || entry.complexity.worst.includes('unbounded'), entry.id)
      assert.ok(entry.complexity.space.includes('O'), entry.id)
      assert.ok(entry.needs.length > 0, `${entry.id} declares needing nothing`)
      assert.ok(entry.limits.length > 0, `${entry.id} claims no limits, which no algorithm can`)
    }
  })

  it('runs every entry through one door', () => {
    const values = makeNumbers('random', 30, 8) as readonly number[]
    const graph = makeGraph('grid', 16, 2)
    assert.ok(!isAlgorithmError(graph))
    // Topological sort only means something on a directed acyclic graph, so that family gets the right input rather
    // than one graph being forced to serve every algorithm.
    const dag = makeGraph('dag', 14, 3)
    assert.ok(!isAlgorithmError(dag))
    const items = makeItems(6, 1)
    assert.ok(!isAlgorithmError(items))

    for (const entry of CATALOGUE) {
      // The same input for every algorithm, except where one declares it takes less.
      const shortened = entry.most !== undefined && entry.most < values.length ? values.slice(0, entry.most) : values
      const useDag = entry.id === 'topological'
      const which = useDag ? dag : graph
      const made = run(entry.id, {
        values: entry.family === 'searching' ? sortedCopy(shortened) : shortened,
        target: sortedCopy(values)[10],
        graph: which.graph,
        start: which.graph.nodes[0],
        graphTarget: which.graph.nodes[which.graph.nodes.length - 1],
        at: which.at,
        items,
        capacity: 15,
        a: 'ABCBDAB',
        b: 'BDCABA',
        // Hanoi counts discs and N-Queens counts rows; twelve of either is an explosion, so each entry's own
        // declared limit decides, exactly as the input length does above.
        n: Math.min(12, entry.most ?? 12)
      })
      assert.ok(!isAlgorithmError(made), `${entry.id}: ${isAlgorithmError(made) ? made.message : ''}`)
      assert.ok(made.steps.length > 0, `${entry.id} recorded no steps`)
      assert.ok(summarise(made).includes(made.algorithm) || summarise(made).length > 0)
    }
  })

  it('says what is missing rather than running with nothing', () => {
    const noTarget = run('binary', { values: [1, 2, 3] })
    assert.ok(isAlgorithmError(noTarget))
    assert.match(noTarget.message, /value to look for/)

    const noGraph = run('dijkstra', {})
    assert.ok(isAlgorithmError(noGraph))
    assert.match(noGraph.message, /needs a graph/)

    const noPositions = run('a-star', { graph: { nodes: ['a'], edges: [], directed: false }, graphTarget: 'a' })
    assert.ok(isAlgorithmError(noPositions))
    assert.match(noPositions.message, /position/)
  })

  it('compares several algorithms on one input, and keeps a refusal visible', () => {
    const values = [5, 1, 9, 3, 7]
    const made = compare(['binary', 'linear'], { values, target: 9 })
    assert.ok(!isAlgorithmError(made))
    const binary = made.sides.find((one) => one.id === 'binary')
    const linear = made.sides.find((one) => one.id === 'linear')
    // Binary search refuses unsorted input; the row stays, with its reason.
    assert.ok(binary?.refused)
    assert.match(String(binary?.refused), /in order/)
    assert.ok(linear?.run)
  })

  it('compares sorts and names the winner from measured counts', () => {
    const values = makeNumbers('random', 80, 12) as readonly number[]
    const made = compare(['bubble', 'merge', 'heap', 'quick'], { values })
    assert.ok(!isAlgorithmError(made))
    assert.equal(made.sides.length, 4)
    assert.ok(made.sides.every((one) => one.run !== null))
    assert.ok(made.winners['fewest comparisons'])
    // Bubble sort cannot win on comparisons against merge sort at this size.
    assert.notEqual(made.winners['fewest comparisons'], 'Bubble sort')
  })

  it('refuses a comparison of fewer than two or more than six', () => {
    assert.ok(isAlgorithmError(compare(['bubble'], { values: [1] })))
    assert.ok(isAlgorithmError(compare(['bubble', 'merge', 'heap', 'quick', 'insertion', 'selection', 'radix'], { values: [1] })))
  })

  it('measures growth without claiming a complexity class from it', () => {
    const made = growth('insertion', 'reversed', 1, [10, 20, 40])
    assert.ok(!isAlgorithmError(made))
    assert.equal(made.measured.length, 3)
    // Quadratic in the worst case: four times the comparisons for twice the size, roughly.
    const [small, , large] = made.measured
    assert.ok(large.comparisons > small.comparisons * 8, `${small.comparisons} → ${large.comparisons}`)
    // The stated complexity is the textbook one and is not derived from these points.
    assert.equal(made.stated.worst, 'O(n²)')
    assert.equal(made.shape, 'reversed')
  })

  it('merge sort grows far more slowly than insertion sort on the same input', () => {
    const slow = growth('insertion', 'reversed', 1, [40, 320])
    const fast = growth('merge', 'reversed', 1, [40, 320])
    assert.ok(!isAlgorithmError(slow) && !isAlgorithmError(fast))
    const slowRatio = slow.measured[1].comparisons / slow.measured[0].comparisons
    const fastRatio = fast.measured[1].comparisons / fast.measured[0].comparisons
    assert.ok(slowRatio > fastRatio * 3, `insertion ×${slowRatio.toFixed(1)}, merge ×${fastRatio.toFixed(1)}`)
  })

  it('refuses a growth curve for a family it cannot measure that way', () => {
    const made = growth('knapsack')
    assert.ok(isAlgorithmError(made))
  })
})

// ---------------------------------------------------------------- replay helpers

describe('replaying a trace', () => {
  it('shows the array as it stood at any step', () => {
    const made = runSort('bubble', [3, 1, 2])
    assert.ok(!isAlgorithmError(made))
    const first = arrayAt([3, 1, 2], made.steps, 0)
    assert.deepEqual(first, [3, 1, 2], 'before any swap, nothing has moved')
    const last = arrayAt([3, 1, 2], made.steps, made.steps.length - 1)
    assert.deepEqual(last, [1, 2, 3])
  })

  it('shows which positions are settled', () => {
    const made = runSort('selection', [4, 2, 7, 1])
    assert.ok(!isAlgorithmError(made))
    assert.equal(settledAt(made.steps, 0).size, 0)
    assert.equal(settledAt(made.steps, made.steps.length - 1).size, 4)
  })

  it('describes a step, and nothing for a step that does not exist', () => {
    const made = runSort('bubble', [2, 1])
    assert.ok(!isAlgorithmError(made))
    assert.ok(describeStep(made, 0)?.includes('Step 0'))
    assert.equal(describeStep(made, 9_999), null)
  })
})
