/**
 * Structural measures on a given graph.
 *
 * Everything here is `exact`: a deterministic function of the adjacency
 * structure supplied. (That says nothing about whether the structure itself is
 * right — see `CONDITIONAL_ON_STRUCTURE`.)
 *
 * Every traversal is written as an explicit loop over an array-backed stack or
 * queue. A recursive depth-first search is shorter and overflows the call
 * stack somewhere around 10^4 nodes deep, which a path-like 10^5-node
 * dependency graph reaches easily; the project rules forbid it.
 */
import { EngineError } from '../core/result';
import { mean, variance } from '../stats/descriptive';
import { requireSize } from './graph';
import type { Graph, NetworkQuantity } from './types';
import { CONDITIONAL_ON_STRUCTURE, NETWORK_LIMITS, nq } from './types';

/* ------------------------------------------------------------------ degrees */

export interface DegreeSummary {
  /** Total degree per node (out+in for a directed graph). */
  degree: number[];
  outDegree: number[];
  inDegree: number[];
  /** Weighted degree ("strength"). */
  strength: number[];
  meanDegree: NetworkQuantity;
  /** Second moment of the degree distribution — the quantity that governs
   *  epidemic thresholds, and which diverges for a heavy-tailed network. */
  secondMoment: NetworkQuantity;
  varianceOfDegree: NetworkQuantity;
  maxDegree: NetworkQuantity;
  /** P(k) over k = 0..maxDegree. */
  distribution: { k: number; count: number; p: number }[];
  density: NetworkQuantity;
  conditionalOn: string;
}

export function degreeSummary(g: Graph): DegreeSummary {
  const outDegree = new Array<number>(g.n);
  const inDegree = new Array<number>(g.n);
  const degree = new Array<number>(g.n);
  const strength = new Array<number>(g.n);
  let maxK = 0;
  for (let i = 0; i < g.n; i++) {
    outDegree[i] = g.out[i].length;
    inDegree[i] = g.directed ? g.in[i].length : g.out[i].length;
    degree[i] = g.directed ? outDegree[i] + inDegree[i] : outDegree[i];
    let s = 0;
    const ws = g.outWeights[i];
    for (let k = 0; k < ws.length; k++) s += ws[k];
    if (g.directed) {
      const iw = g.inWeights[i];
      for (let k = 0; k < iw.length; k++) s += iw[k];
    }
    strength[i] = s;
    if (degree[i] > maxK) maxK = degree[i];
  }
  const counts = new Array<number>(maxK + 1).fill(0);
  for (let i = 0; i < g.n; i++) counts[degree[i]]++;
  const distribution = counts.map((count, k) => ({ k, count, p: count / g.n }));

  let m2 = 0;
  for (let i = 0; i < g.n; i++) m2 += degree[i] * degree[i];
  m2 /= g.n;

  const possible = g.directed ? g.n * (g.n - 1) : (g.n * (g.n - 1)) / 2;

  return {
    degree,
    outDegree,
    inDegree,
    strength,
    meanDegree: nq('Mean degree', mean(degree), 'exact', { formula: '<k> = 2m/n (undirected)' }),
    secondMoment: nq('Second moment of degree', m2, 'exact', {
      formula: '<k^2> = (1/n) sum k_i^2',
      note: 'Epidemic thresholds depend on <k^2>/<k>, not on <k>. For a heavy-tailed degree distribution <k^2> is ' +
        'dominated by the few largest hubs and grows with n rather than converging.',
    }),
    varianceOfDegree: nq('Variance of degree', g.n > 1 ? variance(degree) : 0, 'exact'),
    maxDegree: nq('Maximum degree', maxK, 'exact'),
    distribution,
    density: nq('Density', possible > 0 ? g.m / possible : 0, 'exact', { formula: 'm / C(n,2)' }),
    conditionalOn: CONDITIONAL_ON_STRUCTURE,
  };
}

/* ------------------------------------------------------- degree correlation */

export interface AssortativityResult {
  coefficient: NetworkQuantity;
  /** Mean degree of the neighbours of a degree-k node, for the k present. */
  neighbourDegreeByDegree: { k: number; meanNeighbourDegree: number; nodes: number }[];
  conditionalOn: string;
}

/**
 * Newman's degree assortativity: the Pearson correlation of the degrees at the
 * two ends of an edge, taken over both orientations of every edge.
 *
 * Positive means hubs attach to hubs (typical of social networks); negative
 * means hubs attach to low-degree nodes (typical of technological ones). The
 * sign matters for spreading: a disassortative network spreads differently
 * from an assortative one with the same degree distribution.
 */
export function degreeAssortativity(g: Graph): AssortativityResult {
  if (g.m === 0) {
    throw new EngineError(
      'Degree assortativity is undefined on a graph with no edges: there are no edge endpoints to correlate.',
      'undefined',
    );
  }
  const deg = degreeSummary(g).degree;
  let sJK = 0;
  let sJ = 0;
  let sJ2 = 0;
  let count = 0;
  for (let i = 0; i < g.n; i++) {
    const nb = g.out[i];
    for (let t = 0; t < nb.length; t++) {
      const j = deg[i];
      const k = deg[nb[t]];
      sJK += j * k;
      sJ += (j + k) / 2;
      sJ2 += (j * j + k * k) / 2;
      count++;
    }
  }
  const M = count;
  const num = sJK / M - (sJ / M) * (sJ / M);
  const den = sJ2 / M - (sJ / M) * (sJ / M);
  if (Math.abs(den) < 1e-12) {
    throw new EngineError(
      'Degree assortativity is undefined here: every edge endpoint has the same degree (a regular graph), so the ' +
        'correlation has zero denominator. A regular graph has no degree variation to correlate.',
      'undefined',
    );
  }
  // Mean neighbour degree by degree, the same information resolved by k.
  const byK = new Map<number, { sum: number; nodes: number }>();
  for (let i = 0; i < g.n; i++) {
    const nb = g.out[i];
    if (nb.length === 0) continue;
    let s = 0;
    for (let t = 0; t < nb.length; t++) s += deg[nb[t]];
    const row = byK.get(deg[i]) ?? { sum: 0, nodes: 0 };
    row.sum += s / nb.length;
    row.nodes += 1;
    byK.set(deg[i], row);
  }
  const neighbourDegreeByDegree = [...byK.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([k, r]) => ({ k, meanNeighbourDegree: r.sum / r.nodes, nodes: r.nodes }));

  return {
    coefficient: nq('Degree assortativity', num / den, 'exact', {
      formula: 'r = (M^-1 sum j_e k_e - [M^-1 sum (j_e+k_e)/2]^2) / (M^-1 sum (j_e^2+k_e^2)/2 - [...]^2)',
    }),
    neighbourDegreeByDegree,
    conditionalOn: CONDITIONAL_ON_STRUCTURE,
  };
}

/* ----------------------------------------------------------- clustering */

export interface ClusteringResult {
  /** 2 T_i / (k_i (k_i - 1)); NaN-free: nodes of degree < 2 are excluded. */
  local: (number | null)[];
  /** Average of the defined local values (Watts–Strogatz convention). */
  averageLocal: NetworkQuantity;
  /** 3 x triangles / connected triples (the transitivity). */
  global: NetworkQuantity;
  triangles: number;
  triples: number;
  conditionalOn: string;
}

/**
 * Clustering, both conventions, because they differ and people quote both.
 * `averageLocal` is the mean over nodes of the local coefficient (what
 * Watts–Strogatz used); `global` is the transitivity, 3T/triples, which
 * weights high-degree nodes more.
 *
 * Directed graphs are treated as undirected for this measure; the
 * neighbourhood is the union of in- and out-neighbours.
 */
export function clustering(g: Graph): ClusteringResult {
  const nbSets: Set<number>[] = Array.from({ length: g.n }, () => new Set<number>());
  for (let i = 0; i < g.n; i++) {
    for (const j of g.out[i]) if (j !== i) nbSets[i].add(j);
    if (g.directed) for (const j of g.in[i]) if (j !== i) nbSets[i].add(j);
  }
  const local = new Array<number | null>(g.n).fill(null);
  let triangleEnds = 0;
  let triples = 0;
  for (let i = 0; i < g.n; i++) {
    const nb = [...nbSets[i]];
    const k = nb.length;
    if (k < 2) {
      local[i] = null;
      continue;
    }
    let links = 0;
    for (let a = 0; a < k; a++) {
      for (let b = a + 1; b < k; b++) if (nbSets[nb[a]].has(nb[b])) links++;
    }
    const pairs = (k * (k - 1)) / 2;
    local[i] = links / pairs;
    triangleEnds += links;
    triples += pairs;
  }
  const defined = local.filter((x): x is number => x !== null);
  const triangles = triangleEnds / 3;
  if (triples === 0) {
    throw new EngineError(
      'Clustering is undefined on this graph: no node has two or more neighbours, so there are no connected ' +
        'triples that could be closed. Reporting 0 would suggest the triples exist and are open.',
      'undefined',
    );
  }
  return {
    local,
    averageLocal: nq('Average local clustering', defined.length ? mean(defined) : 0, 'exact', {
      formula: 'C = (1/n\') sum_i 2T_i / (k_i(k_i-1)), over the n\' nodes with k_i >= 2',
      note: `${g.n - defined.length} of ${g.n} nodes have degree below 2 and are excluded; their local clustering is undefined, not zero.`,
    }),
    global: nq('Global clustering (transitivity)', (3 * triangles) / triples, 'exact', {
      formula: 'C = 3 x triangles / connected triples',
    }),
    triangles,
    triples,
    conditionalOn: CONDITIONAL_ON_STRUCTURE,
  };
}

/* ----------------------------------------------------------- components */

export interface ComponentsResult {
  /** Component index per node. */
  label: Int32Array;
  /** Node indices per component, largest first. */
  components: number[][];
  count: number;
  largestSize: number;
  /** The headline quantity: fraction of nodes in the largest component. */
  giantFraction: NetworkQuantity;
  /** Size of the second-largest component — the finite-size order parameter
   *  whose peak locates a percolation threshold. */
  secondLargestSize: number;
  isolatedNodes: number;
  kind: 'undirected' | 'weakly-connected' | 'strongly-connected';
  conditionalOn: string;
}

function componentsFromLabels(
  g: Graph,
  label: Int32Array,
  count: number,
  kind: ComponentsResult['kind'],
): ComponentsResult {
  const buckets: number[][] = Array.from({ length: count }, () => []);
  for (let i = 0; i < g.n; i++) buckets[label[i]].push(i);
  buckets.sort((a, b) => b.length - a.length);
  const relabel = new Int32Array(g.n);
  for (let c = 0; c < buckets.length; c++) for (const i of buckets[c]) relabel[i] = c;
  const largest = buckets.length ? buckets[0].length : 0;
  const second = buckets.length > 1 ? buckets[1].length : 0;
  let isolated = 0;
  for (let i = 0; i < g.n; i++) if (g.out[i].length === 0 && (!g.directed || g.in[i].length === 0)) isolated++;
  return {
    label: relabel,
    components: buckets,
    count: buckets.length,
    largestSize: largest,
    giantFraction: nq('Giant component fraction', largest / g.n, 'exact', {
      formula: 'S = |largest component| / n',
      note: 'On a random graph this is an order parameter with a phase transition, not a smooth function of ' +
        'connectivity: near the threshold a small change in edge density changes it discontinuously in the large-n limit.',
    }),
    secondLargestSize: second,
    isolatedNodes: isolated,
    kind,
    conditionalOn: CONDITIONAL_ON_STRUCTURE,
  };
}

/**
 * Connected components by iterative breadth-first search. For a directed graph
 * this gives the *weakly* connected components (orientation ignored); use
 * `stronglyConnectedComponents` for the directed notion.
 */
export function connectedComponents(g: Graph): ComponentsResult {
  const label = new Int32Array(g.n).fill(-1);
  const queue = new Int32Array(g.n);
  let count = 0;
  for (let s = 0; s < g.n; s++) {
    if (label[s] >= 0) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = s;
    label[s] = count;
    while (head < tail) {
      const u = queue[head++];
      const nb = g.out[u];
      for (let t = 0; t < nb.length; t++) {
        const w = nb[t];
        if (label[w] < 0) {
          label[w] = count;
          queue[tail++] = w;
        }
      }
      if (g.directed) {
        const nb2 = g.in[u];
        for (let t = 0; t < nb2.length; t++) {
          const w = nb2[t];
          if (label[w] < 0) {
            label[w] = count;
            queue[tail++] = w;
          }
        }
      }
    }
    count++;
  }
  return componentsFromLabels(g, label, count, g.directed ? 'weakly-connected' : 'undirected');
}

/**
 * Strongly connected components, iterative Kosaraju.
 *
 * Iterative in both passes: the first pass maintains an explicit stack of
 * (node, next-neighbour-cursor) frames so that a long directed chain cannot
 * overflow the call stack.
 */
export function stronglyConnectedComponents(g: Graph): ComponentsResult {
  if (!g.directed) return connectedComponents(g);
  const visited = new Uint8Array(g.n);
  const order = new Int32Array(g.n);
  let ordered = 0;
  const stack = new Int32Array(g.n + 1);
  const cursor = new Int32Array(g.n + 1);
  for (let s = 0; s < g.n; s++) {
    if (visited[s]) continue;
    let top = 0;
    stack[0] = s;
    cursor[0] = 0;
    visited[s] = 1;
    while (top >= 0) {
      const u = stack[top];
      const nb = g.out[u];
      if (cursor[top] < nb.length) {
        const w = nb[cursor[top]++];
        if (!visited[w]) {
          visited[w] = 1;
          top++;
          stack[top] = w;
          cursor[top] = 0;
        }
      } else {
        order[ordered++] = u;
        top--;
      }
    }
  }
  const label = new Int32Array(g.n).fill(-1);
  const queue = new Int32Array(g.n);
  let count = 0;
  for (let t = ordered - 1; t >= 0; t--) {
    const s = order[t];
    if (label[s] >= 0) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = s;
    label[s] = count;
    while (head < tail) {
      const u = queue[head++];
      const nb = g.in[u];
      for (let k = 0; k < nb.length; k++) {
        const w = nb[k];
        if (label[w] < 0) {
          label[w] = count;
          queue[tail++] = w;
        }
      }
    }
    count++;
  }
  return componentsFromLabels(g, label, count, 'strongly-connected');
}

/* --------------------------------------------------------------- distances */

/** Unweighted shortest-path distances from one source. -1 means unreachable. */
export function bfsDistances(g: Graph, source: number): Int32Array {
  if (source < 0 || source >= g.n || !Number.isInteger(source)) {
    throw new EngineError(`Source node index ${source} is outside 0..${g.n - 1}.`, 'range');
  }
  const dist = new Int32Array(g.n).fill(-1);
  const queue = new Int32Array(g.n);
  let head = 0;
  let tail = 0;
  dist[source] = 0;
  queue[tail++] = source;
  while (head < tail) {
    const u = queue[head++];
    const nb = g.out[u];
    const du = dist[u] + 1;
    for (let k = 0; k < nb.length; k++) {
      const w = nb[k];
      if (dist[w] < 0) {
        dist[w] = du;
        queue[tail++] = w;
      }
    }
  }
  return dist;
}

export interface PathLengthResult {
  /** Mean shortest path over *reachable* ordered pairs only. */
  meanPathLength: NetworkQuantity;
  /** Harmonic mean distance — defined even when some pairs are unreachable. */
  globalEfficiency: NetworkQuantity;
  reachablePairs: number;
  totalPairs: number;
  /** Per-component diameter, largest component first. */
  componentDiameters: { component: number; size: number; diameter: number }[];
  /** The diameter of the whole graph, present only when it is connected. */
  diameter: NetworkQuantity | null;
  connected: boolean;
  conditionalOn: string;
}

/**
 * Mean path length and diameter via BFS from every node.
 *
 * A disconnected graph has no finite diameter. Returning Infinity (or, worse,
 * the largest finite distance as if it were the diameter) misleads, so
 * `diameter` is null and `componentDiameters` carries the per-component
 * answers, which is the information actually wanted. `requireDiameter` turns
 * the same situation into an `EngineError` for callers that need one number.
 */
export function pathLengths(g: Graph): PathLengthResult {
  requireSize(g, NETWORK_LIMITS.pathsMaxNodes, 'All-pairs shortest-path analysis', 'O(n*m) time (a BFS from every node)');
  const comps = connectedComponents(g);
  let sum = 0;
  let invSum = 0;
  let reachable = 0;
  const compDiameter = new Array<number>(comps.count).fill(0);
  for (let s = 0; s < g.n; s++) {
    const dist = bfsDistances(g, s);
    for (let t = 0; t < g.n; t++) {
      if (t === s || dist[t] < 0) continue;
      sum += dist[t];
      invSum += 1 / dist[t];
      reachable++;
      const c = comps.label[s];
      if (c === comps.label[t] && dist[t] > compDiameter[c]) compDiameter[c] = dist[t];
    }
  }
  const totalPairs = g.n * (g.n - 1);
  if (reachable === 0) {
    throw new EngineError(
      'No pair of nodes in this graph is connected by a path, so there is no mean path length to report. The graph ' +
        `has ${g.n} nodes and ${g.m} edges.`,
      'undefined',
    );
  }
  const componentDiameters = comps.components.map((nodes, c) => ({
    component: c,
    size: nodes.length,
    diameter: compDiameter[c],
  }));
  const connected = comps.count === 1;
  return {
    meanPathLength: nq('Mean shortest path length', sum / reachable, 'exact', {
      formula: 'L = (1/|reachable pairs|) sum d(u,v)',
      note: connected
        ? undefined
        : `Averaged over the ${reachable} reachable ordered pairs of ${totalPairs}; unreachable pairs are excluded, ` +
          'not treated as distance 0 or as some large finite number.',
    }),
    globalEfficiency: nq('Global efficiency', invSum / totalPairs, 'exact', {
      formula: 'E = (1/n(n-1)) sum 1/d(u,v), with 1/d = 0 for unreachable pairs',
      note: 'Unlike the mean path length this is well defined on a disconnected graph, because an unreachable pair ' +
        'contributes 0 rather than infinity.',
    }),
    reachablePairs: reachable,
    totalPairs,
    componentDiameters,
    diameter: connected ? nq('Diameter', compDiameter[0], 'exact', { formula: 'max over pairs of d(u,v)' }) : null,
    connected,
  conditionalOn: CONDITIONAL_ON_STRUCTURE,
  };
}

/** The diameter, or a refusal naming the components if the graph is disconnected. */
export function requireDiameter(g: Graph): NetworkQuantity {
  const res = pathLengths(g);
  if (res.diameter) return res.diameter;
  const sizes = res.componentDiameters.map((c) => `${c.size} nodes / diameter ${c.diameter}`).join(', ');
  throw new EngineError(
    `This graph is disconnected (${res.componentDiameters.length} components), so it has no finite diameter. The ` +
      `per-component diameters are: ${sizes}. Reporting infinity as a number, or the largest finite distance as if ` +
      'it were the diameter, would both be wrong.',
    'disconnected',
  );
}

/* ---------------------------------------------------------------- k-cores */

export interface KCoreResult {
  /** Largest k such that the node survives the k-core peeling. */
  coreNumber: number[];
  maxCore: number;
  /** Node indices of the maximum k-core. */
  maxCoreNodes: number[];
  /** Size of the k-core for each k. */
  coreSizes: { k: number; size: number }[];
  conditionalOn: string;
}

/**
 * k-core decomposition by iterative peeling (Batagelj–Zaveršnik): repeatedly
 * remove the lowest-degree node and record its core number.
 *
 * The k-core is the practically useful notion of "the densely interlocked part
 * of the network": a high core number means a node is in a mutually
 * reinforcing cluster, which is where cascades sustain themselves.
 */
export function kCoreDecomposition(g: Graph): KCoreResult {
  const deg = new Int32Array(g.n);
  const nbs: number[][] = Array.from({ length: g.n }, () => []);
  for (let i = 0; i < g.n; i++) {
    const seen = new Set<number>();
    for (const j of g.out[i]) if (j !== i) seen.add(j);
    if (g.directed) for (const j of g.in[i]) if (j !== i) seen.add(j);
    nbs[i] = [...seen];
    deg[i] = nbs[i].length;
  }
  // Bucket sort by degree, then peel.
  // Spread-argument Math.max would itself overflow the stack on a large graph.
  let maxDeg = 0;
  for (let i = 0; i < g.n; i++) if (deg[i] > maxDeg) maxDeg = deg[i];
  const bins = new Array<number[]>(maxDeg + 1);
  for (let d = 0; d <= maxDeg; d++) bins[d] = [];
  for (let i = 0; i < g.n; i++) bins[deg[i]].push(i);
  const removed = new Uint8Array(g.n);
  const core = new Array<number>(g.n).fill(0);
  let k = 0;
  let processed = 0;
  while (processed < g.n) {
    let d = 0;
    while (d <= maxDeg && bins[d].length === 0) d++;
    if (d > maxDeg) break;
    const u = bins[d].pop() as number;
    if (removed[u] || deg[u] !== d) continue;
    if (d > k) k = d;
    core[u] = k;
    removed[u] = 1;
    processed++;
    for (const w of nbs[u]) {
      if (removed[w]) continue;
      if (deg[w] > d) {
        deg[w]--;
        bins[deg[w]].push(w);
      }
    }
  }
  let maxCore = 0;
  for (let i = 0; i < g.n; i++) if (core[i] > maxCore) maxCore = core[i];
  const maxCoreNodes: number[] = [];
  for (let i = 0; i < g.n; i++) if (core[i] === maxCore) maxCoreNodes.push(i);
  const coreSizes: { k: number; size: number }[] = [];
  for (let kk = 0; kk <= maxCore; kk++) {
    let size = 0;
    for (let i = 0; i < g.n; i++) if (core[i] >= kk) size++;
    coreSizes.push({ k: kk, size });
  }
  return { coreNumber: core, maxCore, maxCoreNodes, coreSizes, conditionalOn: CONDITIONAL_ON_STRUCTURE };
}
