import { mkStep, newStats } from '../stepUtils.js';

// Extra graph algorithms. View type: 'graph'.
// viewData: { nodes, edges, visited, current, path, edge, dist, mst, done }

const NODES = [
  { id: 0, label: 'A', x: 0, y: 0 },
  { id: 1, label: 'B', x: 1, y: -1 },
  { id: 2, label: 'C', x: 1, y: 1 },
  { id: 3, label: 'D', x: 2, y: -1 },
  { id: 4, label: 'E', x: 2, y: 1 },
  { id: 5, label: 'F', x: 3, y: 0 },
];
const label = (i) => NODES[i].label;

// Directed acyclic graph
const DAG_EDGES = [
  { from: 0, to: 1 }, { from: 0, to: 2 }, { from: 1, to: 3 },
  { from: 1, to: 4 }, { from: 2, to: 4 }, { from: 3, to: 5 }, { from: 4, to: 5 },
];

// Directed graph carrying a negative edge
const NEG_EDGES = [
  { from: 0, to: 1, w: 6 }, { from: 0, to: 2, w: 7 }, { from: 1, to: 3, w: 5 },
  { from: 1, to: 4, w: -4 }, { from: 2, to: 4, w: 9 }, { from: 3, to: 5, w: 2 }, { from: 4, to: 5, w: 7 },
];

// Undirected weighted graph
const WEIGHTED_EDGES = [
  { from: 0, to: 1, w: 4 }, { from: 0, to: 2, w: 4 }, { from: 1, to: 2, w: 2 },
  { from: 1, to: 3, w: 5 }, { from: 2, to: 4, w: 3 }, { from: 3, to: 4, w: 5 },
  { from: 3, to: 5, w: 3 }, { from: 4, to: 5, w: 4 },
];

const distLabels = (dist) => Object.fromEntries(NODES.map((n) => [n.label, dist[n.id] === Infinity ? '∞' : dist[n.id]]));

// ── Topological Sort (Kahn's algorithm) ──
export function topologicalSort() {
  const stats = newStats(); const steps = [];
  const adj = {}; const indeg = {};
  for (const n of NODES) { adj[n.id] = []; indeg[n.id] = 0; }
  for (const e of DAG_EDGES) { adj[e.from].push(e.to); indeg[e.to]++; }

  const code = [
    'indeg[v] = number of incoming edges',
    'queue = every node with indeg 0',
    'while queue:',
    '  u = dequeue(); append u to the order',
    '  for v in adj[u]: indeg[v]--; if indeg[v] == 0: enqueue v',
    'order complete ⇒ it is a topological order',
  ];
  const push = (p) => steps.push(mkStep(p, stats));
  const snap = (extra) => ({ nodes: NODES, edges: DAG_EDGES, visited: [], current: null, ...extra });
  const order = [];
  const q = NODES.filter((n) => indeg[n.id] === 0).map((n) => n.id);

  push({ array: [], view: 'graph', viewData: snap(), vars: { indegree: distLabels(indeg), queue: q.map(label).join(', ') }, codeLine: 1, desc: `Sources with no incoming edge: ${q.map(label).join(', ')}` });

  while (q.length) {
    const u = q.shift(); order.push(u); stats.nodeVisits++; stats.queueOps++;
    push({ array: [], view: 'graph', viewData: snap({ visited: order.slice(), current: u }), vars: { u: label(u), order: order.map(label).join(' → '), queue: q.map(label).join(', ') || 'empty' }, codeLine: 3, desc: `Take ${label(u)} into the order` });

    for (const v of adj[u]) {
      indeg[v]--; stats.edgeTraversals++; stats.assignments++;
      push({ array: [], view: 'graph', viewData: snap({ visited: order.slice(), current: u, edge: [u, v] }), vars: { edge: `${label(u)} → ${label(v)}`, indegree: distLabels(indeg) }, codeLine: 4, desc: `${label(v)} now has indegree ${indeg[v]}` });
      if (indeg[v] === 0) {
        q.push(v);
        push({ array: [], view: 'graph', viewData: snap({ visited: order.slice(), current: v }), vars: { enqueue: label(v), queue: q.map(label).join(', ') }, codeLine: 4, desc: `${label(v)} has no remaining dependencies — enqueue` });
      }
    }
  }

  const complete = order.length === NODES.length;
  push({ array: [], view: 'graph', viewData: snap({ visited: order.slice(), path: order.slice(), done: true }), vars: { order: order.map(label).join(' → ') }, codeLine: 5, desc: complete ? `Topological order: ${order.map(label).join(' → ')}` : 'Cycle detected — no topological order exists' });
  return { steps, code };
}

// ── Bellman-Ford (handles negative edge weights) ──
export function bellmanFord() {
  const stats = newStats(); const steps = [];
  const dist = {}; for (const n of NODES) dist[n.id] = Infinity; dist[0] = 0;

  const code = [
    'dist[start] = 0; all others ∞',
    'repeat V-1 passes:',
    '  for every edge (u, v, w):',
    '    if dist[u] + w < dist[v]: dist[v] = dist[u] + w',
    'stop early when a pass changes nothing',
  ];
  const push = (p) => steps.push(mkStep(p, stats));
  const snap = (extra) => ({ nodes: NODES, edges: NEG_EDGES, visited: [], current: null, dist: distLabels(dist), ...extra });

  push({ array: [], view: 'graph', viewData: snap(), vars: { dist: distLabels(dist) }, codeLine: 0, desc: 'Initialize — A = 0, everything else ∞' });

  for (let pass = 1; pass <= NODES.length - 1; pass++) {
    let changed = false;
    push({ array: [], view: 'graph', viewData: snap(), vars: { pass, dist: distLabels(dist) }, codeLine: 1, desc: `Pass ${pass} over every edge` });

    for (const e of NEG_EDGES) {
      stats.comparisons++;
      if (dist[e.from] === Infinity) continue;
      if (dist[e.from] + e.w < dist[e.to]) {
        dist[e.to] = dist[e.from] + e.w; changed = true; stats.assignments++;
        push({ array: [], view: 'graph', viewData: snap({ edge: [e.from, e.to], current: e.from }), vars: { edge: `${label(e.from)} → ${label(e.to)} (${e.w})`, value: dist[e.to], dist: distLabels(dist) }, codeLine: 3, desc: `Relax ${label(e.from)} → ${label(e.to)}: ${dist[e.to]}` });
      }
    }

    if (!changed) {
      push({ array: [], view: 'graph', viewData: snap(), vars: { pass, dist: distLabels(dist) }, codeLine: 4, desc: `Pass ${pass} changed nothing — distances are final` });
      break;
    }
  }

  push({ array: [], view: 'graph', viewData: snap({ path: [0, 1, 4, 5], done: true }), vars: { shortest: `A→E = ${dist[4]}`, dist: distLabels(dist) }, codeLine: 4, desc: `Shortest distances from A: ${NODES.map((n) => `${n.label}=${dist[n.id]}`).join(', ')}. The edge B→E (−4) is why Dijkstra cannot be used here.` });
  return { steps, code };
}

// ── Prim's Minimum Spanning Tree ──
export function primMST() {
  const stats = newStats(); const steps = [];
  const inTree = new Set([0]);
  const mst = [];
  let total = 0;

  const code = [
    'tree = {start}; total = 0',
    'while tree does not cover every node:',
    '  scan all edges crossing the cut',
    '  pick the cheapest crossing edge',
    '  add its far node and the edge to the tree',
  ];
  const push = (p) => steps.push(mkStep(p, stats));
  const snap = (extra) => ({ nodes: NODES, edges: WEIGHTED_EDGES, visited: [...inTree], current: null, mst: mst.map((e) => [...e]), ...extra });

  push({ array: [], view: 'graph', viewData: snap(), vars: { tree: 'A', total: 0 }, codeLine: 0, desc: 'Start the tree at A' });

  while (inTree.size < NODES.length) {
    let best = null;
    for (const e of WEIGHTED_EDGES) {
      stats.edgeTraversals++; stats.comparisons++;
      if (inTree.has(e.from) === inTree.has(e.to)) continue;
      if (!best || e.w < best.w) best = e;
    }
    if (!best) break;

    const add = inTree.has(best.from) ? best.to : best.from;
    push({ array: [], view: 'graph', viewData: snap({ edge: [best.from, best.to] }), vars: { cheapest: `${label(best.from)}–${label(best.to)} (${best.w})` }, codeLine: 3, desc: `Cheapest edge crossing the cut: ${label(best.from)}–${label(best.to)} = ${best.w}` });

    inTree.add(add); mst.push([best.from, best.to]); total += best.w; stats.assignments++;
    push({ array: [], view: 'graph', viewData: snap({ edge: [best.from, best.to], current: add }), vars: { added: label(add), total }, codeLine: 4, desc: `Add ${label(add)} — running total ${total}` });
  }

  push({ array: [], view: 'graph', viewData: snap({ done: true }), vars: { total, edges: mst.map(([a, b]) => `${label(a)}–${label(b)}`).join(', ') }, codeLine: 4, desc: `Minimum spanning tree complete — total weight ${total}` });
  return { steps, code };
}

// ── Kruskal's Minimum Spanning Tree (union-find) ──
export function kruskalMST() {
  const stats = newStats(); const steps = [];
  const sorted = [...WEIGHTED_EDGES].sort((a, b) => a.w - b.w);
  const parent = {}; for (const n of NODES) parent[n.id] = n.id;

  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra === rb) return false; parent[rb] = ra; return true; };

  const mst = []; const touched = new Set(); let total = 0;
  const code = [
    'sort every edge by weight',
    'groups = one group per node (union-find)',
    'for edge in sorted order:',
    '  if its endpoints are in different groups: take it, merge the groups',
    '  else: skip it — taking it would close a cycle',
  ];
  const push = (p) => steps.push(mkStep(p, stats));
  const snap = (extra) => ({ nodes: NODES, edges: WEIGHTED_EDGES, visited: [...touched], current: null, mst: mst.map((e) => [...e]), ...extra });

  push({ array: [], view: 'graph', viewData: snap(), vars: { edges: sorted.map((e) => e.w).join(' ≤ ') }, codeLine: 0, desc: 'Edges sorted by weight — every node starts in its own group' });

  for (const e of sorted) {
    stats.comparisons++;
    if (find(e.from) !== find(e.to)) {
      union(e.from, e.to);
      mst.push([e.from, e.to]); touched.add(e.from); touched.add(e.to);
      total += e.w; stats.assignments++;
      push({ array: [], view: 'graph', viewData: snap({ edge: [e.from, e.to] }), vars: { take: `${label(e.from)}–${label(e.to)} (${e.w})`, total }, codeLine: 3, desc: `Take ${label(e.from)}–${label(e.to)} = ${e.w} — different groups, no cycle` });
    } else {
      push({ array: [], view: 'graph', viewData: snap({ edge: [e.from, e.to] }), vars: { skip: `${label(e.from)}–${label(e.to)} (${e.w})` }, codeLine: 4, desc: `Skip ${label(e.from)}–${label(e.to)} = ${e.w} — both ends already connected` });
    }
    if (mst.length === NODES.length - 1) break;
  }

  push({ array: [], view: 'graph', viewData: snap({ done: true }), vars: { total, edges: mst.length }, codeLine: 4, desc: `Minimum spanning tree complete — ${mst.length} edges, total weight ${total}` });
  return { steps, code };
}

export const graphAdvancedAlgorithms = [
  {
    id: 'topologicalSort', name: "Topological Sort (Kahn)", category: 'Graphs', view: 'graph',
    inputType: 'none', generate: topologicalSort,
    description: 'Orders a directed acyclic graph so every edge points forward, using in-degrees and a queue.',
    complexity: { best: 'O(V+E)', avg: 'O(V+E)', worst: 'O(V+E)', space: 'O(V)' },
    stable: true, inplace: true,
    useCases: 'Build systems, task scheduling', advantages: 'Linear time, detects cycles', disadvantages: 'Needs a DAG',
  },
  {
    id: 'bellmanFord', name: 'Bellman-Ford', category: 'Shortest Path', view: 'graph',
    inputType: 'none', generate: bellmanFord,
    description: 'Relaxes every edge V−1 times, so negative edge weights are handled correctly.',
    complexity: { best: 'O(E)', avg: 'O(VE)', worst: 'O(VE)', space: 'O(V)' },
    stable: true, inplace: true,
    useCases: 'Negative weights, arbitrage detection', advantages: 'Works with negative edges', disadvantages: 'Slower than Dijkstra',
  },
  {
    id: 'primMST', name: "Prim's MST", category: 'Graphs', view: 'graph',
    inputType: 'none', generate: primMST,
    description: 'Grows a minimum spanning tree by repeatedly taking the cheapest edge leaving the tree.',
    complexity: { best: 'O(V²)', avg: 'O(V²)', worst: 'O(V²)', space: 'O(V)' },
    stable: true, inplace: true,
    useCases: 'Network and cable layout', advantages: 'Simple and greedy-optimal', disadvantages: 'Slower on dense graphs than a heap version',
  },
  {
    id: 'kruskalMST', name: "Kruskal's MST", category: 'Graphs', view: 'graph',
    inputType: 'none', generate: kruskalMST,
    description: 'Sorts all edges and adds each one whose endpoints are still in different groups, using union-find.',
    complexity: { best: 'O(E log E)', avg: 'O(E log E)', worst: 'O(E log E)', space: 'O(V)' },
    stable: true, inplace: false,
    useCases: 'Sparse graphs, clustering', advantages: 'Great on sparse graphs', disadvantages: 'Must sort every edge first',
  },
];