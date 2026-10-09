import { Recorder, fail, type AlgorithmError, type Run } from './trace.ts'

/**
 * Graph algorithms that record what they do.
 *
 * ## Why these are written again rather than reusing `shared/compute/discrete.ts`
 *
 * `discrete.ts` already has correct BFS, DFS, Dijkstra, Bellman-Ford, Kruskal and topological sort, and they stay —
 * they are what Orbis uses when it needs an *answer*. These versions exist because a laboratory needs the *journey*:
 * the frontier at each step, which node was taken off the queue and why, which distance was improved and from what.
 * A function that returns a shortest path cannot be made to yield that by wrapping it.
 *
 * The duplication is therefore deliberate and bounded: these are traced teaching implementations, and
 * `graphs.test.ts` checks every one of them against `discrete.ts` on the same input. If the two ever disagree, the
 * test fails — which is the only honest way to keep two implementations of one algorithm.
 *
 * Pure.
 */

export interface Edge {
  from: string
  to: string
  weight: number
}

export interface Graph {
  nodes: readonly string[]
  edges: readonly Edge[]
  directed: boolean
}

const MOST_NODES = 2_000
const MOST_EDGES = 20_000

export function graphOf(
  nodes: readonly string[],
  edges: readonly { from: string; to: string; weight?: number }[],
  directed = false
): Graph | AlgorithmError {
  if (nodes.length === 0) return fail('empty', 'A graph needs at least one node.', 'Add a node.')
  if (nodes.length > MOST_NODES) return fail('too-big', `${nodes.length} nodes is more than this laboratory draws.`, `Use at most ${MOST_NODES}.`)
  if (edges.length > MOST_EDGES) return fail('too-many-edges', `${edges.length} edges is too many.`, `Use at most ${MOST_EDGES}.`)

  const seen = new Set<string>()
  for (const one of nodes) {
    if (typeof one !== 'string' || one.trim() === '') return fail('node', 'Every node needs a name.', 'Name them.')
    if (seen.has(one)) return fail('duplicate', `Two nodes are both called "${one}".`, 'Give each node its own name.')
    seen.add(one)
  }
  for (const one of edges) {
    if (!seen.has(one.from)) return fail('edge', `An edge starts at "${one.from}", which is not a node.`, 'Add the node, or fix the edge.')
    if (!seen.has(one.to)) return fail('edge', `An edge ends at "${one.to}", which is not a node.`, 'Add the node, or fix the edge.')
    if (one.weight !== undefined && (typeof one.weight !== 'number' || !Number.isFinite(one.weight))) {
      return fail('weight', `The edge ${one.from}–${one.to} has a weight that is not a finite number.`, 'Give it a number, or leave it out for 1.')
    }
  }

  return { nodes: [...nodes], edges: edges.map((one) => ({ from: one.from, to: one.to, weight: one.weight ?? 1 })), directed }
}

/** Neighbours by node. Built once per run; an undirected edge appears from both ends. */
function neighbours(graph: Graph): Map<string, { to: string; weight: number }[]> {
  const out = new Map<string, { to: string; weight: number }[]>()
  for (const node of graph.nodes) out.set(node, [])
  for (const edge of graph.edges) {
    out.get(edge.from)?.push({ to: edge.to, weight: edge.weight })
    if (!graph.directed) out.get(edge.to)?.push({ to: edge.from, weight: edge.weight })
  }
  // Sorted so a traversal's order is reproducible rather than depending on insertion order.
  for (const list of out.values()) list.sort((a, b) => a.to.localeCompare(b.to))
  return out
}

const startsIn = (graph: Graph, start: string): AlgorithmError | null =>
  graph.nodes.includes(start) ? null : fail('no-start', `There is no node called "${start}".`, `Start from one of: ${graph.nodes.slice(0, 8).join(', ')}.`)

export interface Traversal {
  order: readonly string[]
  parent: Readonly<Record<string, string | null>>
  /** Distance in edges from the start, for BFS. Depth in the tree, for DFS. */
  level: Readonly<Record<string, number>>
  unreached: readonly string[]
}

// ---------------------------------------------------------------- traversal

export function breadthFirst(graph: Graph, start: string, ceiling?: number): Run | AlgorithmError {
  const bad = startsIn(graph, start)
  if (bad) return bad
  const rec = new Recorder(ceiling)
  const near = neighbours(graph)

  const queue: string[] = [start]
  const parent: Record<string, string | null> = { [start]: null }
  const level: Record<string, number> = { [start]: 0 }
  const order: string[] = []
  const seen = new Set<string>([start])

  rec.where(1, { queued: queue.length })
  rec.step('push', `start at ${start}`, [start], { extra: { queue: [start] } })

  while (queue.length > 0 && !rec.cut) {
    rec.where(2, { queued: queue.length })
    const node = queue.shift() as string
    rec.where(3, { node, queued: queue.length })
    rec.step('pop', `take ${node} off the front of the queue`, [node], { extra: { queue: [...queue] } })
    rec.step('visit', `visit ${node}, ${level[node]} edge${level[node] === 1 ? '' : 's'} from ${start}`, [node], { extra: { level: level[node] } })
    order.push(node)

    for (const edge of near.get(node) ?? []) {
      rec.where(5, { neighbour: edge.to })
      rec.step('read', `${node} has a neighbour ${edge.to}`, [node, edge.to])
      rec.where(6)
      if (seen.has(edge.to)) {
        rec.step('note', `${edge.to} has already been seen, so skip it`, [edge.to])
        continue
      }
      seen.add(edge.to)
      parent[edge.to] = node
      level[edge.to] = level[node] + 1
      rec.where(7)
      queue.push(edge.to)
      rec.where(8, { queued: queue.length })
      rec.step('push', `add ${edge.to} to the back of the queue`, [edge.to], { extra: { queue: [...queue] } })
    }
  }

  const unreached = graph.nodes.filter((one) => !seen.has(one))
  if (!rec.cut) {
    if (unreached.length > 0) rec.step('note', `${unreached.length} node${unreached.length === 1 ? '' : 's'} cannot be reached from ${start}`, unreached)
    rec.step('done', `visited ${order.length} of ${graph.nodes.length} nodes`, [])
  }
  return rec.finish('breadth-first search', { start, nodes: graph.nodes.length, edges: graph.edges.length }, {
    order,
    parent,
    level,
    unreached
  } satisfies Traversal)
}

export function depthFirst(graph: Graph, start: string, ceiling?: number): Run | AlgorithmError {
  const bad = startsIn(graph, start)
  if (bad) return bad
  const rec = new Recorder(ceiling)
  const near = neighbours(graph)

  const parent: Record<string, string | null> = { [start]: null }
  const level: Record<string, number> = { [start]: 0 }
  const order: string[] = []
  const seen = new Set<string>()

  // Recursive, because the recursion *is* what distinguishes depth-first — and the frames give the recursion tree.
  const walk = (node: string, from: string | null, depth: number): void => {
    rec.where(3, { node, depth })
    if (rec.cut || seen.has(node)) {
      // Line 4 is the skip: reaching a node already seen is the single most common thing depth-first does, and
      // without this the code panel would sit on line 3 while the trace said "already visited".
      rec.where(4, { node })
      return
    }
    const frame = rec.enter(`visit ${node}`)
    seen.add(node)
    parent[node] = from
    level[node] = depth
    rec.where(5)
    rec.step('visit', `visit ${node} at depth ${depth}`, [node], { extra: { depth } })
    order.push(node)

    for (const edge of near.get(node) ?? []) {
      if (rec.cut) break
      rec.where(7, { neighbour: edge.to })
      rec.step('read', `${node} has a neighbour ${edge.to}`, [node, edge.to])
      if (seen.has(edge.to)) {
        rec.where(4, { neighbour: edge.to })
        rec.step('note', `${edge.to} has already been visited, so do not follow it`, [edge.to])
        continue
      }
      walk(edge.to, node, depth + 1)
      rec.where(7, { node, depth })
    }
    rec.leave(frame, `finished ${node}`)
  }

  walk(start, null, 0)
  const unreached = graph.nodes.filter((one) => !seen.has(one))
  if (!rec.cut) {
    if (unreached.length > 0) rec.step('note', `${unreached.length} node${unreached.length === 1 ? '' : 's'} cannot be reached from ${start}`, unreached)
    rec.step('done', `visited ${order.length} of ${graph.nodes.length} nodes`, [])
  }
  return rec.finish('depth-first search', { start, nodes: graph.nodes.length, edges: graph.edges.length }, {
    order,
    parent,
    level,
    unreached
  } satisfies Traversal)
}

// ---------------------------------------------------------------- shortest paths

export interface Shortest {
  distance: Readonly<Record<string, number>>
  parent: Readonly<Record<string, string | null>>
  /** The path to the target, when one was asked for and found. */
  path: readonly string[]
  unreachable: readonly string[]
  /** Set by Bellman-Ford when a negative cycle makes the answer meaningless. */
  negativeCycle: boolean
}

/**
 * Dijkstra, with the frontier recorded at every step.
 *
 * Uses a linear scan for the smallest tentative distance rather than a binary heap. Deliberate: the laboratory's
 * graphs are at most a couple of thousand nodes, the scan is the version the algorithm is taught as, and the trace
 * shows *which* node was chosen and why — which a heap's internal reordering would obscure for no benefit here.
 */
export function dijkstra(graph: Graph, start: string, target?: string, ceiling?: number): Run | AlgorithmError {
  const bad = startsIn(graph, start)
  if (bad) return bad
  if (target !== undefined && !graph.nodes.includes(target)) {
    return fail('no-target', `There is no node called "${target}".`, 'Pick a node that is in the graph.')
  }
  const negative = graph.edges.find((one) => one.weight < 0)
  if (negative) {
    return fail(
      'negative-weight',
      `Dijkstra cannot handle the negative edge ${negative.from}–${negative.to} (${negative.weight}): it assumes a settled distance can never improve.`,
      'Use Bellman-Ford, which handles negative weights and detects negative cycles.'
    )
  }

  const rec = new Recorder(ceiling)
  const near = neighbours(graph)
  const distance: Record<string, number> = {}
  const parent: Record<string, string | null> = {}
  const settled = new Set<string>()

  for (const node of graph.nodes) distance[node] = Infinity
  distance[start] = 0
  parent[start] = null
  rec.where(1, { settled: 0 })
  rec.step('update', `${start} is 0 from itself; every other node starts at infinity`, [start], { extra: { distance: 0 } })

  while (settled.size < graph.nodes.length && !rec.cut) {
    rec.where(2, { settled: settled.size })
    let chosen: string | null = null
    for (const node of graph.nodes) {
      if (settled.has(node) || distance[node] === Infinity) continue
      if (chosen === null || distance[node] < distance[chosen]) chosen = node
    }
    if (chosen === null) break

    rec.where(3, { node: chosen })
    rec.step('visit', `the nearest unsettled node is ${chosen}, at ${distance[chosen]}`, [chosen], { extra: { distance: distance[chosen] } })
    settled.add(chosen)
    rec.where(4, { settled: settled.size })
    rec.step('settle', `${chosen} is settled: nothing can make it closer now`, [chosen])

    if (target !== undefined && chosen === target) {
      rec.step('note', `${target} is settled, so its distance is final and the rest need not be explored`, [target])
      break
    }

    for (const edge of near.get(chosen) ?? []) {
      if (rec.cut) break
      const through = distance[chosen] + edge.weight
      rec.where(6, { neighbour: edge.to, through })
      rec.step('compare', `going to ${edge.to} through ${chosen} costs ${through}; the best known is ${distance[edge.to] === Infinity ? 'infinity' : distance[edge.to]}`, [chosen, edge.to], {
        values: [through, distance[edge.to]]
      })
      rec.where(7)
      if (through < distance[edge.to]) {
        distance[edge.to] = through
        parent[edge.to] = chosen
        rec.where(8)
        rec.step('update', `that is better, so ${edge.to} is now ${through} away, through ${chosen}`, [edge.to], { extra: { distance: through } })
        rec.count('improvements')
      }
    }
  }

  const path: string[] = []
  if (target !== undefined && distance[target] !== Infinity) {
    let at: string | null = target
    while (at !== null && at !== undefined) {
      path.unshift(at)
      at = parent[at] ?? null
    }
    if (!rec.cut) rec.step('done', `shortest path: ${path.join(' → ')} (${distance[target]})`, path)
  } else if (!rec.cut) {
    rec.step('done', target === undefined ? 'every reachable distance is final' : `${target} cannot be reached from ${start}`, [])
  }

  return rec.finish('Dijkstra', { start, target: target ?? null, nodes: graph.nodes.length }, {
    distance,
    parent,
    path,
    unreachable: graph.nodes.filter((one) => distance[one] === Infinity),
    negativeCycle: false
  } satisfies Shortest)
}

/**
 * Bellman-Ford.
 *
 * Handles negative weights, and the point of it is the extra pass: after `n-1` rounds every distance should be
 * final, so a distance that still improves on round `n` proves a negative cycle. That round is recorded as its own
 * step, because it is the whole reason to use this over Dijkstra.
 */
export function bellmanFord(graph: Graph, start: string, target?: string, ceiling?: number): Run | AlgorithmError {
  const bad = startsIn(graph, start)
  if (bad) return bad

  const rec = new Recorder(ceiling)
  const distance: Record<string, number> = {}
  const parent: Record<string, string | null> = {}
  for (const node of graph.nodes) distance[node] = Infinity
  distance[start] = 0
  parent[start] = null

  // Both directions of an undirected edge have to be relaxed, or half the graph is unreachable.
  const all: Edge[] = graph.directed ? [...graph.edges] : graph.edges.flatMap((one) => [one, { from: one.to, to: one.from, weight: one.weight }])

  rec.where(1, { round: 0 })
  rec.step('note', `relax every edge ${graph.nodes.length - 1} times, then once more to look for a negative cycle`, [])

  rec.where(1, { round: 0 })
  for (let round = 1; round < graph.nodes.length && !rec.cut; round += 1) {
    let changed = false
    rec.where(2, { round })
    rec.step('range', `round ${round} of ${graph.nodes.length - 1}`, [], { extra: { round } })
    for (const edge of all) {
      if (rec.cut) break
      if (distance[edge.from] === Infinity) continue
      const through = distance[edge.from] + edge.weight
      rec.where(3, { from: edge.from, to: edge.to })
      rec.step('compare', `${edge.from} \u2192 ${edge.to} would cost ${through}`, [edge.from, edge.to], { values: [through, distance[edge.to]] })
      rec.where(4)
      if (through < distance[edge.to]) {
        distance[edge.to] = through
        parent[edge.to] = edge.from
        changed = true
        rec.where(5)
        rec.step('update', `${edge.to} improves to ${through}`, [edge.to], { extra: { distance: through } })
        rec.count('improvements')
      }
    }
    if (!changed) {
      rec.step('note', `nothing improved in round ${round}, so every distance is already final`, [])
      break
    }
  }

  let negativeCycle = false
  if (!rec.cut) {
    rec.where(6)
    rec.step('range', 'the extra round: anything that improves now is on a negative cycle', [])
    for (const edge of all) {
      if (distance[edge.from] === Infinity) continue
      if (distance[edge.from] + edge.weight < distance[edge.to]) {
        negativeCycle = true
        rec.step('note', `${edge.from} → ${edge.to} still improves, so there is a negative cycle and no shortest path exists`, [edge.from, edge.to])
        break
      }
    }
  }

  const path: string[] = []
  if (!negativeCycle && target !== undefined && distance[target] !== Infinity) {
    let at: string | null = target
    const guard = new Set<string>()
    while (at !== null && at !== undefined && !guard.has(at)) {
      guard.add(at)
      path.unshift(at)
      at = parent[at] ?? null
    }
  }
  if (!rec.cut) {
    rec.step('done', negativeCycle ? 'a negative cycle means there is no shortest path' : path.length > 0 ? `shortest path: ${path.join(' → ')}` : 'distances are final', path)
  }

  return rec.finish('Bellman-Ford', { start, target: target ?? null }, {
    distance,
    parent,
    path,
    unreachable: graph.nodes.filter((one) => distance[one] === Infinity),
    negativeCycle
  } satisfies Shortest)
}

/**
 * A* on a graph with coordinates.
 *
 * Needs a position per node to estimate the remaining distance, so it refuses a graph without them rather than
 * falling back to a zero heuristic — which would silently be Dijkstra and teach the wrong thing.
 */
export function aStar(
  graph: Graph,
  start: string,
  target: string,
  at: Readonly<Record<string, { x: number; y: number }>>,
  ceiling?: number
): Run | AlgorithmError {
  const bad = startsIn(graph, start)
  if (bad) return bad
  if (!graph.nodes.includes(target)) return fail('no-target', `There is no node called "${target}".`, 'Pick a node in the graph.')
  const missing = graph.nodes.filter((one) => !at[one])
  if (missing.length > 0) {
    return fail(
      'no-positions',
      `A* estimates the distance left to go, so every node needs a position. ${missing.length} ${missing.length === 1 ? 'has' : 'have'} none.`,
      'Give every node a position, or use Dijkstra, which needs none.'
    )
  }
  if (graph.edges.some((one) => one.weight < 0)) {
    return fail('negative-weight', 'A* assumes no negative edges, as Dijkstra does.', 'Use Bellman-Ford for negative weights.')
  }

  const rec = new Recorder(ceiling)
  const near = neighbours(graph)
  const straightLine = (a: string, b: string): number => Math.hypot(at[a].x - at[b].x, at[a].y - at[b].y)

  const best: Record<string, number> = {}
  const guess: Record<string, number> = {}
  const parent: Record<string, string | null> = { [start]: null }
  for (const node of graph.nodes) {
    best[node] = Infinity
    guess[node] = Infinity
  }
  best[start] = 0
  guess[start] = straightLine(start, target)

  const open = new Set<string>([start])
  const settled = new Set<string>()
  rec.where(1, { g: 0, h: Number(guess[start].toFixed(2)), f: Number(guess[start].toFixed(2)) })
  rec.step('note', `estimate the remaining distance as a straight line to ${target}`, [start], { extra: { estimate: guess[start].toFixed(2) } })

  while (open.size > 0 && !rec.cut) {
    let chosen: string | null = null
    rec.where(2)
    for (const node of open) if (chosen === null || guess[node] < guess[chosen]) chosen = node
    if (chosen === null) break

    rec.where(3, { node: chosen, g: Number(best[chosen].toFixed(2)), f: Number(guess[chosen].toFixed(2)) })
    rec.step('visit', `take ${chosen}: ${best[chosen].toFixed(2)} so far plus about ${(guess[chosen] - best[chosen]).toFixed(2)} to go`, [chosen], {
      extra: { soFar: best[chosen].toFixed(2), estimate: guess[chosen].toFixed(2) }
    })

    rec.where(4)
    if (chosen === target) {
      const path: string[] = []
      let walk: string | null = chosen
      while (walk !== null) {
        path.unshift(walk)
        walk = parent[walk] ?? null
      }
      rec.step('done', `reached ${target}: ${path.join(' → ')} (${best[target].toFixed(2)})`, path)
      return rec.finish('A*', { start, target }, {
        distance: best,
        parent,
        path,
        unreachable: [],
        negativeCycle: false
      } satisfies Shortest)
    }

    open.delete(chosen)
    settled.add(chosen)
    rec.step('settle', `${chosen} is done`, [chosen])

    for (const edge of near.get(chosen) ?? []) {
      if (rec.cut || settled.has(edge.to)) continue
      const through = best[chosen] + edge.weight
      rec.where(6, { neighbour: edge.to, h: Number(straightLine(edge.to, target).toFixed(2)) })
      rec.step('compare', `${edge.to} through ${chosen} costs ${through.toFixed(2)}`, [chosen, edge.to], { values: [through, best[edge.to]] })
      rec.where(7)
      if (through < best[edge.to]) {
        best[edge.to] = through
        guess[edge.to] = through + straightLine(edge.to, target)
        parent[edge.to] = chosen
        open.add(edge.to)
        rec.where(8, { g: Number(through.toFixed(2)), f: Number(guess[edge.to].toFixed(2)) })
        rec.step('update', `${edge.to}: ${through.toFixed(2)} so far, about ${guess[edge.to].toFixed(2)} in total`, [edge.to], {
          extra: { soFar: through.toFixed(2), total: guess[edge.to].toFixed(2) }
        })
      }
    }
  }

  if (!rec.cut) rec.step('done', `${target} cannot be reached from ${start}`, [])
  return rec.finish('A*', { start, target }, {
    distance: best,
    parent,
    path: [],
    unreachable: graph.nodes.filter((one) => best[one] === Infinity),
    negativeCycle: false
  } satisfies Shortest)
}

// ---------------------------------------------------------------- spanning trees and ordering

export interface Spanning {
  chosen: readonly Edge[]
  weight: number
  /** True when the graph was connected and a spanning tree really covers it. */
  spans: boolean
}

/** Kruskal, with the union-find structure recorded as it merges. */
export function kruskal(graph: Graph, ceiling?: number): Run | AlgorithmError {
  if (graph.directed) return fail('directed', 'A minimum spanning tree is for an undirected graph.', 'Make the graph undirected.')
  const rec = new Recorder(ceiling)

  const parent = new Map<string, string>(graph.nodes.map((one) => [one, one]))
  const find = (node: string): string => {
    let at = node
    while (parent.get(at) !== at) at = parent.get(at) as string
    return at
  }

  const byWeight = [...graph.edges].sort((a, b) => a.weight - b.weight || a.from.localeCompare(b.from))
  rec.where(1, { taken: 0 })
  rec.step('note', 'take the edges in order of weight, keeping any that joins two separate pieces', [])

  const chosen: Edge[] = []
  let weight = 0
  rec.where(1, { taken: 0 })
  for (const edge of byWeight) {
    if (rec.cut || chosen.length === graph.nodes.length - 1) break
    const a = find(edge.from)
    const b = find(edge.to)
    rec.where(2, { weight: edge.weight })
    rec.step('compare', `${edge.from}\u2013${edge.to} (${edge.weight}): are they already joined?`, [edge.from, edge.to], { values: [edge.weight] })
    rec.where(3)
    if (a === b) {
      rec.where(5)
      rec.step('note', `yes \u2014 taking it would make a cycle, so skip it`, [edge.from, edge.to])
      rec.count('skipped')
      continue
    }
    parent.set(a, b)
    chosen.push(edge)
    weight += edge.weight
    rec.where(4, { taken: chosen.length })
    rec.step('visit', `keep ${edge.from}\u2013${edge.to}; the tree now weighs ${weight}`, [edge.from, edge.to], { extra: { weight } })
  }

  const spans = chosen.length === graph.nodes.length - 1
  if (!rec.cut) {
    rec.step('done', spans ? `spanning tree of weight ${weight}` : `the graph is in pieces, so there is a forest of weight ${weight} rather than a spanning tree`, [])
  }
  return rec.finish('Kruskal', { nodes: graph.nodes.length, edges: graph.edges.length }, { chosen, weight, spans } satisfies Spanning)
}

export interface Ordering {
  order: readonly string[]
  /** True when a valid order exists. False when the graph has a cycle. */
  possible: boolean
  /** The nodes caught in a cycle, when there is one. */
  inCycle: readonly string[]
}

/** Topological sort by Kahn's method, with the in-degrees recorded as they fall. */
export function topologicalSort(graph: Graph, ceiling?: number): Run | AlgorithmError {
  if (!graph.directed) return fail('undirected', 'A topological order only means something for a directed graph.', 'Make the graph directed.')
  const rec = new Recorder(ceiling)

  const into: Record<string, number> = {}
  rec.where(1)
  for (const node of graph.nodes) into[node] = 0
  for (const edge of graph.edges) into[edge.to] += 1

  const ready = graph.nodes.filter((one) => into[one] === 0).sort()
  rec.where(2, { ready: ready.length, placed: 0 })
  rec.step('note', `start with the nodes nothing points at: ${ready.length > 0 ? ready.join(', ') : 'there are none, which already means a cycle'}`, ready)

  const order: string[] = []
  const queue = [...ready]
  rec.where(3, { ready: queue.length })
  while (queue.length > 0 && !rec.cut) {
    const node = queue.shift() as string
    rec.where(4, { node, ready: queue.length })
    rec.step('pop', `take ${node}, which has nothing left pointing at it`, [node], { extra: { queue: [...queue] } })
    order.push(node)
    rec.where(5, { placed: order.length })
    rec.step('visit', `${node} is position ${order.length} in the order`, [node])

    for (const edge of graph.edges.filter((one) => one.from === node)) {
      if (rec.cut) break
      into[edge.to] -= 1
      rec.where(7)
      rec.step('update', `${edge.to} now has ${into[edge.to]} thing${into[edge.to] === 1 ? '' : 's'} pointing at it`, [edge.to], { extra: { into: into[edge.to] } })
      if (into[edge.to] === 0) {
        queue.push(edge.to)
        rec.where(7, { ready: queue.length })
        rec.step('push', `${edge.to} is ready`, [edge.to], { extra: { queue: [...queue] } })
      }
    }
  }
  rec.where(8)

  const possible = order.length === graph.nodes.length
  const inCycle = graph.nodes.filter((one) => !order.includes(one))
  if (!rec.cut) {
    rec.step('done', possible ? `order: ${order.join(' → ')}` : `no order exists: ${inCycle.join(', ')} are in a cycle`, possible ? order : inCycle)
  }
  return rec.finish('topological sort', { nodes: graph.nodes.length, edges: graph.edges.length }, { order, possible, inCycle } satisfies Ordering)
}

// ---------------------------------------------------------------- the registry

export type GraphName = 'bfs' | 'dfs' | 'dijkstra' | 'bellman-ford' | 'a-star' | 'kruskal' | 'topological'

export const GRAPH_NAMES: readonly GraphName[] = Object.freeze(['bfs', 'dfs', 'dijkstra', 'bellman-ford', 'a-star', 'kruskal', 'topological'])

export function runGraph(
  name: GraphName,
  graph: Graph,
  options: { start?: string; target?: string; at?: Readonly<Record<string, { x: number; y: number }>>; ceiling?: number } = {}
): Run | AlgorithmError {
  const start = options.start ?? graph.nodes[0]
  switch (name) {
    case 'bfs':
      return breadthFirst(graph, start, options.ceiling)
    case 'dfs':
      return depthFirst(graph, start, options.ceiling)
    case 'dijkstra':
      return dijkstra(graph, start, options.target, options.ceiling)
    case 'bellman-ford':
      return bellmanFord(graph, start, options.target, options.ceiling)
    case 'a-star':
      if (!options.target) return fail('no-target', 'A* needs somewhere to go.', 'Name a target node.')
      return aStar(graph, start, options.target, options.at ?? {}, options.ceiling)
    case 'kruskal':
      return kruskal(graph, options.ceiling)
    case 'topological':
      return topologicalSort(graph, options.ceiling)
    default:
      return fail('unknown', `There is no graph algorithm called "${String(name)}".`, `Choose one of: ${GRAPH_NAMES.join(', ')}.`)
  }
}
