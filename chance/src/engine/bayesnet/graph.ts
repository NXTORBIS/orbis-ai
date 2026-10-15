/**
 * Directed-graph utilities for Bayesian networks: cycle detection, topological
 * ordering, ancestry, moralisation and greedy elimination orderings.
 *
 * Every algorithm here is iterative. A recursive depth-first search would
 * overflow the JavaScript stack on a graph with tens of thousands of nodes,
 * and these routines must stay usable on networks that size.
 */
import { EngineError } from '../core/result';

/** Directed graph given as a parent list keyed by node id. */
export interface DiGraph {
  readonly nodes: readonly string[];
  /** Parents of each node. Every parent must itself be a node. */
  readonly parents: ReadonlyMap<string, readonly string[]>;
}

export function childrenMap(g: DiGraph): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const n of g.nodes) out.set(n, []);
  for (const n of g.nodes) {
    for (const p of g.parents.get(n) ?? []) out.get(p)!.push(n);
  }
  return out;
}

/**
 * Kahn's algorithm. Returns the topological order, or the nodes of one cycle
 * (in cycle order) when the graph is cyclic.
 */
export function topologicalOrder(g: DiGraph): { order: string[] } | { cycle: string[] } {
  const children = childrenMap(g);
  const indegree = new Map<string, number>();
  for (const n of g.nodes) indegree.set(n, (g.parents.get(n) ?? []).length);
  const queue: string[] = [];
  for (const n of g.nodes) if (indegree.get(n) === 0) queue.push(n);
  const order: string[] = [];
  let head = 0;
  while (head < queue.length) {
    const n = queue[head++];
    order.push(n);
    for (const c of children.get(n)!) {
      const d = indegree.get(c)! - 1;
      indegree.set(c, d);
      if (d === 0) queue.push(c);
    }
  }
  if (order.length === g.nodes.length) return { order };
  const remaining = new Set(g.nodes.filter((n) => indegree.get(n)! > 0));
  return { cycle: findCycle(g, remaining) };
}

/**
 * Extract one cycle from the sub-graph induced by `remaining` (all of whose
 * nodes lie on or downstream of a cycle). Iterative walk: follow a parent that
 * is still in `remaining` until a node repeats.
 */
function findCycle(g: DiGraph, remaining: ReadonlySet<string>): string[] {
  const start = [...remaining][0];
  const seenAt = new Map<string, number>();
  const walk: string[] = [];
  let current: string | undefined = start;
  while (current !== undefined) {
    const prior = seenAt.get(current);
    if (prior !== undefined) {
      // Cycle is walk[prior..], reversed because we followed parent edges.
      return walk.slice(prior).reverse();
    }
    seenAt.set(current, walk.length);
    walk.push(current);
    const next: string | undefined = (g.parents.get(current) ?? []).find((p) => remaining.has(p));
    current = next;
  }
  return walk.reverse();
}

/** Throws an EngineError naming the cycle if the graph is not acyclic. */
export function requireAcyclic(g: DiGraph): string[] {
  const r = topologicalOrder(g);
  if ('cycle' in r) {
    const loop = [...r.cycle, r.cycle[0]].join(' -> ');
    throw new EngineError(
      `A Bayesian network must be acyclic, but this graph contains the cycle ${loop}. ` +
        `Remove one of these edges.`,
      'cycle',
    );
  }
  return r.order;
}

/** Ancestors of every node in `seeds` (not including the seeds themselves). */
export function ancestorsOf(g: DiGraph, seeds: Iterable<string>): Set<string> {
  const out = new Set<string>();
  const stack: string[] = [];
  for (const s of seeds) for (const p of g.parents.get(s) ?? []) stack.push(p);
  while (stack.length) {
    const n = stack.pop()!;
    if (out.has(n)) continue;
    out.add(n);
    for (const p of g.parents.get(n) ?? []) if (!out.has(p)) stack.push(p);
  }
  return out;
}

/** Descendants of every node in `seeds` (not including the seeds themselves). */
export function descendantsOf(g: DiGraph, seeds: Iterable<string>): Set<string> {
  const children = childrenMap(g);
  const out = new Set<string>();
  const stack: string[] = [];
  for (const s of seeds) for (const c of children.get(s) ?? []) stack.push(c);
  while (stack.length) {
    const n = stack.pop()!;
    if (out.has(n)) continue;
    out.add(n);
    for (const c of children.get(n) ?? []) if (!out.has(c)) stack.push(c);
  }
  return out;
}

/** All directed paths from `from` to `to`, as node sequences, capped in count. */
export function directedPaths(g: DiGraph, from: string, to: string, maxPaths = 2000): string[][] {
  const children = childrenMap(g);
  const out: string[][] = [];
  // Iterative DFS over partial paths.
  const stack: string[][] = [[from]];
  while (stack.length) {
    const path = stack.pop()!;
    const last = path[path.length - 1];
    if (last === to && path.length > 1) {
      out.push(path);
      if (out.length >= maxPaths) break;
      continue;
    }
    for (const c of children.get(last) ?? []) {
      if (!path.includes(c)) stack.push([...path, c]);
    }
  }
  return out;
}

/** Undirected adjacency of the moral graph: parents married, edges dropped. */
export function moralGraph(g: DiGraph): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const n of g.nodes) adj.set(n, new Set());
  const link = (a: string, b: string): void => {
    if (a === b) return;
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  };
  for (const n of g.nodes) {
    const ps = g.parents.get(n) ?? [];
    for (const p of ps) link(n, p);
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) link(ps[i], ps[j]);
  }
  return adj;
}

export type EliminationHeuristic = 'min-fill' | 'min-degree';

/**
 * Greedy elimination ordering over `targets` in the undirected graph `adj`.
 * At each step the node with the fewest fill-in edges (or lowest degree) is
 * eliminated and its neighbours are connected, which is exactly the induced
 * graph that variable elimination builds.
 *
 * Returns the order plus the induced width (largest clique size minus one).
 */
export function greedyEliminationOrder(
  adj: ReadonlyMap<string, ReadonlySet<string>>,
  targets: readonly string[],
  heuristic: EliminationHeuristic = 'min-fill',
): { order: string[]; inducedWidth: number; cliques: string[][] } {
  const work = new Map<string, Set<string>>();
  for (const [k, v] of adj) work.set(k, new Set(v));
  const pending = new Set(targets);
  const order: string[] = [];
  const cliques: string[][] = [];
  let inducedWidth = 0;
  while (pending.size) {
    let best: string | null = null;
    let bestScore = Infinity;
    for (const n of pending) {
      const nb = work.get(n) ?? new Set<string>();
      let score: number;
      if (heuristic === 'min-degree') {
        score = nb.size;
      } else {
        let fill = 0;
        const list = [...nb];
        for (let i = 0; i < list.length; i++) {
          for (let j = i + 1; j < list.length; j++) {
            if (!work.get(list[i])!.has(list[j])) fill++;
          }
        }
        score = fill;
      }
      if (score < bestScore || (score === bestScore && best !== null && n < best)) {
        bestScore = score;
        best = n;
      }
    }
    const n = best!;
    const nb = [...(work.get(n) ?? new Set<string>())];
    cliques.push([n, ...nb]);
    inducedWidth = Math.max(inducedWidth, nb.length);
    for (let i = 0; i < nb.length; i++) {
      for (let j = i + 1; j < nb.length; j++) {
        work.get(nb[i])!.add(nb[j]);
        work.get(nb[j])!.add(nb[i]);
      }
    }
    for (const m of nb) work.get(m)!.delete(n);
    work.delete(n);
    pending.delete(n);
    order.push(n);
  }
  return { order, inducedWidth, cliques };
}
