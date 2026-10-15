import { mkStep, newStats } from '../stepUtils';

// Graph algorithms. View type: 'graph'.
// viewData: { nodes: [{id,label,x,y}], edges: [{from,to,w}], visited: [], current, path, queue/stack, dist }

const DEMO = {
  nodes: [
    { id: 0, label: 'A', x: 1, y: 0 }, { id: 1, label: 'B', x: 2, y: 1 }, { id: 2, label: 'C', x: 2, y: -1 },
    { id: 3, label: 'D', x: 3, y: 1 }, { id: 4, label: 'E', x: 3, y: -1 }, { id: 5, label: 'F', x: 4, y: 0 },
  ],
  edges: [
    { from: 0, to: 1, w: 4 }, { from: 0, to: 2, w: 2 }, { from: 1, to: 3, w: 5 },
    { from: 1, to: 4, w: 1 }, { from: 2, to: 4, w: 8 }, { from: 2, to: 5, w: 10 },
    { from: 3, to: 5, w: 2 }, { from: 4, to: 5, w: 6 },
  ],
};

function snap(extra) { return { nodes: DEMO.nodes, edges: DEMO.edges, ...extra }; }

// ── BFS ──
export function bfs(input) {
  const stats = newStats(); const steps = [];
  const adj = {}; for (const n of DEMO.nodes) adj[n.id] = []; for (const e of DEMO.edges) { adj[e.from].push(e.to); adj[e.to].push(e.from); }
  const code = ['queue=[start]; visited={start}', 'while queue:', '  node=dequeue(); visit', '  for nb in adj[node]:', '    if not visited: enqueue'];
  const push = (p) => steps.push(mkStep(p, stats));
  const q = [0]; const visited = new Set([0]); const order = [];
  push({ array: [], view: 'graph', viewData: snap({ visited: [], current: 0, queue: [0] }), vars: { queue: 'A' }, codeLine: 0, desc: 'Start BFS at A' });
  while (q.length) {
    const node = q.shift(); order.push(node); stats.nodeVisits++;
    push({ array: [], view: 'graph', viewData: snap({ visited: order.slice(), current: node, queue: q.slice() }), vars: { node: DEMO.nodes[node].label, queue: q.map((i) => DEMO.nodes[i].label).join(',') || 'empty' }, codeLine: 2, desc: `Visit ${DEMO.nodes[node].label}` });
    for (const nb of adj[node]) { stats.edgeTraversals++; if (!visited.has(nb)) { visited.add(nb); q.push(nb); push({ array: [], view: 'graph', viewData: snap({ visited: order.slice(), current: node, queue: q.slice(), edge: [node, nb] }), vars: { nb: DEMO.nodes[nb].label }, codeLine: 4, desc: `Enqueue ${DEMO.nodes[nb].label}` }); } }
  }
  push({ array: [], view: 'graph', viewData: snap({ visited: order.slice(), done: true }), vars: { order: order.map((i) => DEMO.nodes[i].label).join(' → ') }, codeLine: 5, desc: `BFS: ${order.map((i) => DEMO.nodes[i].label).join(' → ')}` });
  return { steps, code };
}

// ── DFS ──
export function dfs(input) {
  const stats = newStats(); const steps = [];
  const adj = {}; for (const n of DEMO.nodes) adj[n.id] = []; for (const e of DEMO.edges) { adj[e.from].push(e.to); adj[e.to].push(e.from); }
  const code = ['stack=[start]; visited={}', 'while stack:', '  node=pop()', '  if not visited: visit', '  push unvisited neighbors'];
  const push = (p) => steps.push(mkStep(p, stats));
  const st = [0]; const visited = new Set(); const order = [];
  push({ array: [], view: 'graph', viewData: snap({ visited: [], current: 0, stack: [0] }), vars: { stack: 'A' }, codeLine: 0, desc: 'Start DFS at A' });
  while (st.length) {
    const node = st.pop();
    if (visited.has(node)) continue;
    visited.add(node); order.push(node); stats.nodeVisits++;
    push({ array: [], view: 'graph', viewData: snap({ visited: order.slice(), current: node, stack: st.slice() }), vars: { node: DEMO.nodes[node].label, stack: st.map((i) => DEMO.nodes[i].label).join(',') || 'empty' }, codeLine: 3, desc: `Visit ${DEMO.nodes[node].label}` });
    for (const nb of [...adj[node]].reverse()) { stats.edgeTraversals++; if (!visited.has(nb)) { st.push(nb); push({ array: [], view: 'graph', viewData: snap({ visited: order.slice(), current: node, stack: st.slice(), edge: [node, nb] }), vars: { nb: DEMO.nodes[nb].label }, codeLine: 4, desc: `Push ${DEMO.nodes[nb].label}` }); } }
  }
  push({ array: [], view: 'graph', viewData: snap({ visited: order.slice(), done: true }), vars: { order: order.map((i) => DEMO.nodes[i].label).join(' → ') }, codeLine: 5, desc: `DFS: ${order.map((i) => DEMO.nodes[i].label).join(' → ')}` });
  return { steps, code };
}

// ── Dijkstra ──
export function dijkstra(input) {
  const stats = newStats(); const steps = [];
  const adj = {}; for (const n of DEMO.nodes) adj[n.id] = []; for (const e of DEMO.edges) { adj[e.from].push({ to: e.to, w: e.w }); adj[e.to].push({ to: e.from, w: e.w }); }
  const code = ['dist[start]=0; pq=[(0,start)]', 'while pq:', '  (d,u)=pop min', '  if d>dist[u]: skip', '  for (v,w) in adj[u]:', '    if d+w < dist[v]: relax'];
  const push = (p) => steps.push(mkStep(p, stats));
  const dist = {}; for (const n of DEMO.nodes) dist[n.id] = Infinity; dist[0] = 0;
  const pq = [{ d: 0, u: 0 }]; const visited = new Set(); const prev = {};
  push({ array: [], view: 'graph', viewData: snap({ dist: { ...dist }, current: 0 }), vars: { dist: distObj(dist) }, codeLine: 0, desc: 'Init distances, A=0' });
  while (pq.length) {
    pq.sort((a, b) => a.d - b.d); const { d, u } = pq.shift();
    if (visited.has(u)) continue; visited.add(u); stats.nodeVisits++;
    push({ array: [], view: 'graph', viewData: snap({ visited: [...visited], current: u, dist: { ...dist } }), vars: { node: DEMO.nodes[u].label, d, dist: distObj(dist) }, codeLine: 2, desc: `Process ${DEMO.nodes[u].label} (d=${d})` });
    for (const { to: v, w } of adj[u]) {
      stats.edgeTraversals++; stats.comparisons++;
      if (d + w < dist[v]) { dist[v] = d + w; prev[v] = u; stats.assignments++; push({ array: [], view: 'graph', viewData: snap({ visited: [...visited], current: u, edge: [u, v], dist: { ...dist } }), vars: { u: DEMO.nodes[u].label, v: DEMO.nodes[v].label, nd: dist[v] }, codeLine: 5, desc: `Relax ${DEMO.nodes[v].label} → ${dist[v]}` }); pq.push({ d: dist[v], u: v }); }
    }
  }
  const path = []; let cur = 5; while (cur !== undefined) { path.unshift(cur); cur = prev[cur]; }
  push({ array: [], view: 'graph', viewData: snap({ visited: [...visited], path, dist: { ...dist }, done: true }), vars: { dist: distObj(dist), path: path.map((i) => DEMO.nodes[i].label).join(' → ') }, codeLine: 6, desc: `Shortest path to F: ${path.map((i) => DEMO.nodes[i].label).join(' → ')}` });
  return { steps, code };
}

function distObj(dist) { const o = {}; for (const k in dist) o[DEMO.nodes[k].label] = dist[k] === Infinity ? '∞' : dist[k]; return o; }

export const graphAlgorithms = [
  { id: 'bfs', name: 'Breadth-First Search', category: 'Graphs', view: 'graph', inputType: 'none', generate: bfs, description: 'Explores neighbors level by level using a queue.', complexity: { best: 'O(V+E)', avg: 'O(V+E)', worst: 'O(V+E)', space: 'O(V)' }, stable: true, inplace: true, useCases: 'Shortest path in edges', advantages: 'Finds shortest hops', disadvantages: 'O(V) space' },
  { id: 'dfs', name: 'Depth-First Search', category: 'Graphs', view: 'graph', inputType: 'none', generate: dfs, description: 'Explores as far as possible along each branch using a stack.', complexity: { best: 'O(V+E)', avg: 'O(V+E)', worst: 'O(V+E)', space: 'O(V)' }, stable: true, inplace: true, useCases: 'Connectivity, cycles', advantages: 'Low memory', disadvantages: 'Not shortest' },
  { id: 'dijkstra', name: "Dijkstra's Algorithm", category: 'Shortest Path', view: 'graph', inputType: 'none', generate: dijkstra, description: 'Shortest weighted paths from a source using a priority queue.', complexity: { best: 'O(E log V)', avg: 'O(E log V)', worst: 'O(E log V)', space: 'O(V)' }, stable: true, inplace: true, useCases: 'Non-negative weights', advantages: 'Optimal paths', disadvantages: 'No negative weights' },
];