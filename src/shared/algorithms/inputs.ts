import { intFrom, randomFrom, fail, type AlgorithmError } from './trace.ts'
import type { Graph } from './graphs.ts'

/**
 * Inputs to run an algorithm against, including the ones designed to make it behave badly.
 *
 * ## The adversarial cases are the point
 *
 * Sorted input is where bubble sort is O(n) and quicksort-with-last-pivot is O(n²). Reverse-sorted input is the
 * worst case for insertion sort. Many-duplicates is where a naive partition degrades. A laboratory that only ever
 * offers random input teaches that all sorts are much the same, which is the opposite of true.
 *
 * ## Every random input carries its seed
 *
 * Not `Math.random`. A comparison between two algorithms has to be on the *same* list, and a run somebody saved has
 * to be repeatable — so the seed is an input and it is recorded with the result.
 *
 * Pure.
 */

export type Shape =
  | 'random'
  | 'sorted'
  | 'reversed'
  | 'nearly-sorted'
  | 'many-duplicates'
  | 'few-unique'
  | 'organ-pipe'
  | 'sawtooth'
  /** The sequence that makes a last-element-pivot quicksort take quadratic time. */
  | 'quicksort-killer'

export const SHAPES: readonly Shape[] = Object.freeze([
  'random',
  'sorted',
  'reversed',
  'nearly-sorted',
  'many-duplicates',
  'few-unique',
  'organ-pipe',
  'sawtooth',
  'quicksort-killer'
])

/** What each shape is for, so the control that offers them can say so rather than listing nine words. */
export const SHAPE_NOTES: Readonly<Record<Shape, string>> = Object.freeze({
  random: 'The ordinary case. Most algorithms behave close to their average here.',
  sorted: 'Already in order. The best case for bubble and insertion sort, and the worst for a last-element pivot.',
  reversed: 'Exactly backwards. The worst case for insertion sort, which has to shift every value past every other.',
  'nearly-sorted': 'A few values out of place. Insertion sort is close to linear here, which is why it is used to finish other sorts.',
  'many-duplicates': 'Most values repeat. Hard for a naive partition, which keeps splitting unevenly.',
  'few-unique': 'Only a handful of distinct values. Counting sort is at its best; comparison sorts gain nothing.',
  'organ-pipe': 'Up then down. Defeats the assumption that a run going up will keep going up.',
  sawtooth: 'Repeating short runs. Punishes algorithms that detect order over a whole pass.',
  'quicksort-killer': 'Arranged so a last-element pivot always splits off one element — quicksort at its O(n²) worst.'
})

const MOST = 20_000

/**
 * A list of the requested shape and size.
 *
 * `quicksort-killer` is built by actually running the pivot choice backwards: every arrangement here is the real
 * thing rather than a shuffle labelled as a worst case.
 */
export function makeNumbers(shape: Shape, size: number, seed = 1): readonly number[] | AlgorithmError {
  if (!Number.isInteger(size) || size < 0) return fail('size', 'The size has to be a whole number of zero or more.', 'Give a whole number.')
  if (size > MOST) return fail('too-big', `${size.toLocaleString('en-GB')} values is more than this laboratory generates.`, `Use at most ${MOST.toLocaleString('en-GB')}.`)
  if (size === 0) return []

  const random = randomFrom(seed)
  const top = Math.max(10, size * 2)

  switch (shape) {
    case 'sorted':
      return Array.from({ length: size }, (_, at) => at + 1)
    case 'reversed':
      return Array.from({ length: size }, (_, at) => size - at)
    case 'nearly-sorted': {
      const out = Array.from({ length: size }, (_, at) => at + 1)
      // About one in twenty positions disturbed, which is what "nearly" should mean rather than a vague shuffle.
      const moves = Math.max(1, Math.floor(size / 20))
      for (let one = 0; one < moves; one += 1) {
        const a = intFrom(random, 0, size - 1)
        const b = Math.min(size - 1, a + intFrom(random, 1, 3))
        const held = out[a]
        out[a] = out[b]
        out[b] = held
      }
      return out
    }
    case 'many-duplicates': {
      const distinct = Math.max(2, Math.floor(Math.sqrt(size)))
      return Array.from({ length: size }, () => intFrom(random, 1, distinct))
    }
    case 'few-unique':
      return Array.from({ length: size }, () => intFrom(random, 1, 5))
    case 'organ-pipe': {
      const half = Math.ceil(size / 2)
      const up = Array.from({ length: half }, (_, at) => at + 1)
      const down = Array.from({ length: size - half }, (_, at) => half - at)
      return [...up, ...down]
    }
    case 'sawtooth': {
      const tooth = Math.max(2, Math.floor(Math.sqrt(size)))
      return Array.from({ length: size }, (_, at) => (at % tooth) + 1)
    }
    case 'quicksort-killer': {
      /*
       * Built the way the killer is actually constructed: start sorted, then repeatedly place the current median at
       * the end of the remaining range, which is where a last-element pivot will look. Each partition then peels off
       * exactly one element.
       */
      const out = Array.from({ length: size }, (_, at) => at + 1)
      for (let at = size - 1; at > 0; at -= 1) {
        const middle = Math.floor(at / 2)
        const held = out[middle]
        out[middle] = out[at]
        out[at] = held
      }
      return out
    }
    default:
      return Array.from({ length: size }, () => intFrom(random, 1, top))
  }
}

// ---------------------------------------------------------------- graphs

export type GraphShape = 'random' | 'grid' | 'tree' | 'cycle' | 'complete' | 'bipartite' | 'dag' | 'disconnected'

export const GRAPH_SHAPES: readonly GraphShape[] = Object.freeze(['random', 'grid', 'tree', 'cycle', 'complete', 'bipartite', 'dag', 'disconnected'])

export const GRAPH_SHAPE_NOTES: Readonly<Record<GraphShape, string>> = Object.freeze({
  random: 'Edges placed at random. The ordinary case.',
  grid: 'A rectangular lattice, with positions — the shape pathfinding is usually shown on.',
  tree: 'No cycles, one path between any two nodes. Every traversal visits each node once.',
  cycle: 'A single ring. The simplest graph where depth-first and breadth-first differ visibly.',
  complete: 'Every node joined to every other. The densest case, and where edge counts explode.',
  bipartite: 'Two groups, with edges only between them. Nothing joins a node to its own group.',
  dag: 'Directed with no cycles, so a topological order exists.',
  disconnected: 'Two or more separate pieces, so some nodes cannot be reached from others.'
})

export interface MadeGraph {
  graph: Graph
  /** Positions, for the shapes that have them. A* needs these; the others may be laid out freely. */
  at: Readonly<Record<string, { x: number; y: number }>>
}

const MOST_NODES = 400

/** A graph of the requested shape. Weights are whole numbers so a distance reads cleanly. */
export function makeGraph(shape: GraphShape, size: number, seed = 1, weighted = true): MadeGraph | AlgorithmError {
  if (!Number.isInteger(size) || size < 1) return fail('size', 'A graph needs at least one node.', 'Give a whole number of 1 or more.')
  if (size > MOST_NODES) return fail('too-big', `${size} nodes is more than this laboratory draws.`, `Use at most ${MOST_NODES}.`)

  const random = randomFrom(seed)
  const weight = (): number => (weighted ? intFrom(random, 1, 9) : 1)
  const name = (at: number): string => `n${at + 1}`

  const nodes = Array.from({ length: size }, (_, at) => name(at))
  const edges: { from: string; to: string; weight: number }[] = []
  const at: Record<string, { x: number; y: number }> = {}
  let directed = false

  switch (shape) {
    case 'grid': {
      const side = Math.max(1, Math.round(Math.sqrt(size)))
      nodes.length = 0
      for (let row = 0; row < side; row += 1) {
        for (let column = 0; column < side; column += 1) {
          const id = `r${row}c${column}`
          nodes.push(id)
          at[id] = { x: column, y: row }
          if (column > 0) edges.push({ from: `r${row}c${column - 1}`, to: id, weight: weight() })
          if (row > 0) edges.push({ from: `r${row - 1}c${column}`, to: id, weight: weight() })
        }
      }
      break
    }
    case 'tree': {
      for (let one = 1; one < size; one += 1) {
        // A random earlier parent: acyclic by construction rather than by checking afterwards.
        edges.push({ from: name(intFrom(random, 0, one - 1)), to: name(one), weight: weight() })
      }
      break
    }
    case 'cycle': {
      for (let one = 0; one < size; one += 1) edges.push({ from: name(one), to: name((one + 1) % size), weight: weight() })
      break
    }
    case 'complete': {
      if (size > 60) return fail('too-dense', `A complete graph of ${size} nodes has ${(size * (size - 1)) / 2} edges.`, 'Use 60 nodes or fewer for a complete graph.')
      for (let a = 0; a < size; a += 1) for (let b = a + 1; b < size; b += 1) edges.push({ from: name(a), to: name(b), weight: weight() })
      break
    }
    case 'bipartite': {
      const half = Math.floor(size / 2)
      for (let a = 0; a < half; a += 1) {
        for (let b = half; b < size; b += 1) if (random() < 0.4) edges.push({ from: name(a), to: name(b), weight: weight() })
      }
      break
    }
    case 'dag': {
      directed = true
      for (let a = 0; a < size; a += 1) {
        // Edges only ever point forwards, so there can be no cycle.
        for (let b = a + 1; b < size; b += 1) if (random() < 0.3) edges.push({ from: name(a), to: name(b), weight: weight() })
      }
      break
    }
    case 'disconnected': {
      const split = Math.max(1, Math.floor(size / 2))
      for (let one = 1; one < split; one += 1) edges.push({ from: name(intFrom(random, 0, one - 1)), to: name(one), weight: weight() })
      for (let one = split + 1; one < size; one += 1) edges.push({ from: name(intFrom(random, split, one - 1)), to: name(one), weight: weight() })
      break
    }
    default: {
      // Connected first, so a traversal has something to do, then extra edges for density.
      for (let one = 1; one < size; one += 1) edges.push({ from: name(intFrom(random, 0, one - 1)), to: name(one), weight: weight() })
      const extra = Math.floor(size * 0.6)
      for (let one = 0; one < extra; one += 1) {
        const a = intFrom(random, 0, size - 1)
        const b = intFrom(random, 0, size - 1)
        if (a !== b) edges.push({ from: name(a), to: name(b), weight: weight() })
      }
      break
    }
  }

  // Everything without its own layout gets one on a circle, so a renderer always has positions to use.
  if (Object.keys(at).length === 0) {
    nodes.forEach((id, index) => {
      const angle = (index / nodes.length) * Math.PI * 2
      at[id] = { x: Number((Math.cos(angle) * 10).toFixed(3)), y: Number((Math.sin(angle) * 10).toFixed(3)) }
    })
  }

  return { graph: { nodes, edges, directed }, at }
}

/** A few items for the knapsack, with a seed. Weights are whole, because the table needs whole columns. */
export function makeItems(count: number, seed = 1): readonly { name: string; weight: number; value: number }[] | AlgorithmError {
  if (!Number.isInteger(count) || count < 1) return fail('count', 'Give a whole number of items, 1 or more.', 'Try 5.')
  if (count > 60) return fail('too-many', `${count} items makes a table too wide to read.`, 'Use at most 60.')
  const random = randomFrom(seed)
  return Array.from({ length: count }, (_, at) => ({
    name: `item ${at + 1}`,
    weight: intFrom(random, 1, 12),
    value: intFrom(random, 5, 60)
  }))
}
