/**
 * Graph construction and validation.
 *
 * Validation is the whole point of this file: a network analysis that silently
 * accepts an edge naming a node that does not exist, or counts a duplicated
 * edge twice, produces numbers that look entirely reasonable and are wrong.
 * Each failure names the offending edge.
 */
import { EngineError, Validator } from '../core/result';
import type { EdgeInput, Graph, GraphInput } from './types';
import { NETWORK_LIMITS } from './types';

function edgeLabel(e: EdgeInput, i: number): string {
  return `edge ${i} (${e.source} -> ${e.target})`;
}

/**
 * Build a validated graph.
 *
 * Refuses: an empty node list, duplicate node ids, an edge endpoint that is
 * not a declared node, a duplicate edge, a self-loop unless explicitly
 * allowed, a non-positive or non-finite weight, and anything above the size
 * limits. For an undirected graph (a, b) and (b, a) are the same edge and the
 * second one is reported as a duplicate.
 */
export function buildGraph(input: GraphInput): Graph {
  const v = new Validator();
  const directed = input.directed ?? false;
  const allowSelfLoops = input.allowSelfLoops ?? false;

  if (!Array.isArray(input.nodes) || input.nodes.length === 0) {
    throw new EngineError(
      'A graph needs at least one node. An empty node list has no degree distribution, no components and no ' +
        'giant component; there is nothing to report.',
      'empty',
    );
  }
  if (input.nodes.length > NETWORK_LIMITS.maxNodes) {
    throw new EngineError(
      `This graph has ${input.nodes.length} nodes, above the limit of ${NETWORK_LIMITS.maxNodes}. Adjacency lists ` +
        'for a larger graph do not fit in browser memory.',
      'limit',
    );
  }
  if (!Array.isArray(input.edges)) {
    throw new EngineError('The edge list must be an array.', 'invalid');
  }
  if (input.edges.length > NETWORK_LIMITS.maxEdges) {
    throw new EngineError(
      `This graph has ${input.edges.length} edges, above the limit of ${NETWORK_LIMITS.maxEdges}.`,
      'limit',
    );
  }

  const index = new Map<string, number>();
  for (let i = 0; i < input.nodes.length; i++) {
    const id = input.nodes[i];
    if (typeof id !== 'string' || id.length === 0) {
      v.add(`Node ${i} has no id. Node ids must be non-empty strings.`, 'nodes', 'invalid');
      continue;
    }
    if (index.has(id)) {
      v.add(`Node id "${id}" appears more than once. Node ids must be unique.`, 'nodes', 'duplicate');
      continue;
    }
    index.set(id, i);
  }
  v.throwIfInvalid();

  const n = input.nodes.length;
  const out: number[][] = Array.from({ length: n }, () => []);
  const outWeights: number[][] = Array.from({ length: n }, () => []);
  const inn: number[][] = directed ? Array.from({ length: n }, () => []) : out;
  const innWeights: number[][] = directed ? Array.from({ length: n }, () => []) : outWeights;

  const seen = new Set<string>();
  let selfLoops = 0;
  let weighted = false;
  let m = 0;

  for (let i = 0; i < input.edges.length; i++) {
    const e = input.edges[i];
    if (!e || typeof e.source !== 'string' || typeof e.target !== 'string') {
      v.add(`Edge ${i} must have string "source" and "target" node ids.`, 'edges', 'invalid');
      continue;
    }
    const a = index.get(e.source);
    const b = index.get(e.target);
    if (a === undefined) {
      v.add(`${edgeLabel(e, i)} names source node "${e.source}", which is not in the node list.`, 'edges', 'missing-node');
      continue;
    }
    if (b === undefined) {
      v.add(`${edgeLabel(e, i)} names target node "${e.target}", which is not in the node list.`, 'edges', 'missing-node');
      continue;
    }
    const w = e.weight ?? 1;
    if (!Number.isFinite(w) || w <= 0) {
      v.add(`${edgeLabel(e, i)} has weight ${w}. Edge weights must be finite and strictly positive.`, 'edges', 'range');
      continue;
    }
    if (w !== 1) weighted = true;
    if (a === b) {
      if (!allowSelfLoops) {
        v.add(
          `${edgeLabel(e, i)} is a self-loop. Self-loops are rejected unless allowSelfLoops is set, because they ` +
            'change degree and clustering conventions silently.',
          'edges',
          'self-loop',
        );
        continue;
      }
      selfLoops++;
    }
    const key = directed || a <= b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(key)) {
      v.add(
        `${edgeLabel(e, i)} duplicates an earlier edge${directed ? '' : ' (undirected, so source and target order does not matter)'}. ` +
          'Duplicate edges would be counted twice in every degree and path computation.',
        'edges',
        'duplicate',
      );
      continue;
    }
    seen.add(key);
    m++;

    out[a].push(b);
    outWeights[a].push(w);
    if (directed) {
      inn[b].push(a);
      innWeights[b].push(w);
    } else if (a !== b) {
      out[b].push(a);
      outWeights[b].push(w);
    }
  }
  v.throwIfInvalid();

  return {
    directed,
    n,
    m,
    ids: input.nodes.slice(),
    index,
    out,
    outWeights,
    in: inn,
    inWeights: innWeights,
    selfLoops,
    weighted,
  };
}

/** Build an undirected graph from index pairs, for the generative models. */
export function graphFromPairs(
  n: number,
  pairs: ReadonlyArray<readonly [number, number]>,
  options: { directed?: boolean; prefix?: string } = {},
): Graph {
  const prefix = options.prefix ?? 'n';
  const nodes = new Array<string>(n);
  for (let i = 0; i < n; i++) nodes[i] = `${prefix}${i}`;
  const edges: EdgeInput[] = new Array(pairs.length);
  for (let k = 0; k < pairs.length; k++) {
    const p = pairs[k];
    edges[k] = { source: `${prefix}${p[0]}`, target: `${prefix}${p[1]}` };
  }
  return buildGraph({ nodes, edges, directed: options.directed ?? false });
}

/** Every undirected edge once, as index pairs. */
export function edgePairs(g: Graph): [number, number][] {
  const pairs: [number, number][] = [];
  for (let i = 0; i < g.n; i++) {
    const nb = g.out[i];
    for (let k = 0; k < nb.length; k++) {
      const j = nb[k];
      if (g.directed || i <= j) pairs.push([i, j]);
    }
  }
  return pairs;
}

/** The induced subgraph on `keep`, relabelled 0..k-1, with the index map back. */
export function inducedSubgraph(g: Graph, keep: ReadonlyArray<boolean>): { graph: Graph; original: number[] } {
  const original: number[] = [];
  const mapping = new Int32Array(g.n).fill(-1);
  for (let i = 0; i < g.n; i++) {
    if (keep[i]) {
      mapping[i] = original.length;
      original.push(i);
    }
  }
  if (original.length === 0) {
    throw new EngineError(
      'The induced subgraph is empty: every node was removed. There is no graph left to measure.',
      'empty',
    );
  }
  const nodes = original.map((i) => g.ids[i]);
  const edges: EdgeInput[] = [];
  for (let i = 0; i < g.n; i++) {
    if (!keep[i]) continue;
    const nb = g.out[i];
    const ws = g.outWeights[i];
    for (let k = 0; k < nb.length; k++) {
      const j = nb[k];
      if (!keep[j]) continue;
      if (!g.directed && i > j) continue;
      edges.push({ source: g.ids[i], target: g.ids[j], weight: ws[k] });
    }
  }
  return {
    graph: buildGraph({ nodes, edges, directed: g.directed, allowSelfLoops: g.selfLoops > 0 }),
    original,
  };
}

/** Guard a size-limited algorithm, naming the limit and the cost. */
export function requireSize(g: Graph, limit: number, what: string, cost: string): void {
  if (g.n > limit) {
    throw new EngineError(
      `${what} is refused on a graph of ${g.n} nodes: the limit is ${limit} nodes because the algorithm costs ${cost}. ` +
        'Reduce the graph (take the giant component, or a sample) rather than waiting on a computation that will not finish.',
      'limit',
    );
  }
}
