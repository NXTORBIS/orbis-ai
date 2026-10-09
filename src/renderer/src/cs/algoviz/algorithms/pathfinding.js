import { mkStep, newStats } from '../stepUtils.js';

// Grid-based pathfinding. View type: 'pathgrid'.
// Input: { rows, cols, start:{r,c}, end:{r,c}, walls:[ "r,c", ... ] }
// Each step's viewData carries: rows, cols, start, end, walls (Set),
// visited (Set), frontier (Set), current ({r,c}|null), path ([{r,c}]), dist map.

export const key = (r, c) => `${r},${c}`;
export const DIRS4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];

export function buildGrid(input) {
  const rows = Math.max(5, Math.min(40, input.rows || 15));
  const cols = Math.max(5, Math.min(50, input.cols || 25));
  const start = input.start || { r: 1, c: 1 };
  const end = input.end || { r: rows - 2, c: cols - 2 };
  const walls = new Set((input.walls || []).filter((w) => {
    const [r, c] = w.split(',').map(Number);
    return r >= 0 && r < rows && c >= 0 && c < cols;
  }));
  return { rows, cols, start, end, walls };
}

export function reconstruct(prev, end) {
  const path = [];
  let cur = key(end.r, end.c);
  while (cur) {
    const [r, c] = cur.split(',').map(Number);
    path.unshift({ r, c });
    cur = prev[cur];
  }
  return path;
}

// ── Dijkstra (uniform-cost on a 4-connected grid) ──
export function gridDijkstra(input) {
  const stats = newStats(); const steps = [];
  const { rows, cols, start, end, walls } = buildGrid(input);
  const isWall = (r, c) => walls.has(key(r, c));
  const inBounds = (r, c) => r >= 0 && r < rows && c >= 0 && c < cols;

  const code = [
    'dist[start] = 0; pq = [(0, start)]',
    'while pq not empty:',
    '  u = pop node with min dist',
    '  if u is end: done',
    '  for each neighbor v (up/down/left/right):',
    '    if not wall and dist[u]+1 < dist[v]:',
    '      dist[v] = dist[u]+1; prev[v] = u; enqueue',
    'reconstruct path from end to start',
  ];
  const push = (p) => steps.push(mkStep(p, stats));
  const dist = {}; const prev = {};
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) dist[key(r, c)] = Infinity;
  const sk = key(start.r, start.c); dist[sk] = 0;
  const visited = new Set(); const frontier = new Set([sk]);
  const pq = [{ r: start.r, c: start.c, d: 0 }];

  const snap = (extra) => ({
    rows, cols, start, end, walls,
    visited: new Set(visited), frontier: new Set(frontier),
    current: null, path: [], dist: { ...dist },
    ...extra,
  });

  push({ array: [], view: 'pathgrid', viewData: snap({ current: { ...start } }), vars: { pqSize: 1, visited: 0 }, codeLine: 0, desc: `Initialize — start at (${start.r}, ${start.c}), target (${end.r}, ${end.c})` });

  let found = false;
  while (pq.length) {
    pq.sort((a, b) => a.d - b.d);
    const { r: ur, c: uc, d } = pq.shift();
    const uk = key(ur, uc);
    frontier.delete(uk);
    if (visited.has(uk)) continue;
    visited.add(uk); stats.nodeVisits++;
    push({ array: [], view: 'pathgrid', viewData: snap({ current: { r: ur, c: uc } }), vars: { node: `(${ur},${uc})`, d, pqSize: pq.length, visited: visited.size }, codeLine: 2, desc: `Process (${ur}, ${uc}) — distance ${d}` });

    if (ur === end.r && uc === end.c) { found = true; break; }

    for (const [dr, dc] of DIRS4) {
      const vr = ur + dr, vc = uc + dc, vk = key(vr, vc);
      stats.edgeTraversals++; stats.comparisons++;
      if (!inBounds(vr, vc) || isWall(vr, vc) || visited.has(vk)) continue;
      const nd = d + 1;
      if (nd < dist[vk]) {
        dist[vk] = nd; prev[vk] = uk; stats.assignments++;
        if (!frontier.has(vk)) { frontier.add(vk); pq.push({ r: vr, c: vc, d: nd }); }
        push({ array: [], view: 'pathgrid', viewData: snap({ current: { r: ur, c: uc } }), vars: { from: `(${ur},${uc})`, to: `(${vr},${vc})`, nd, pqSize: pq.length }, codeLine: 5, desc: `Relax (${vr}, ${vc}) → dist ${nd}` });
      }
    }
  }

  const path = found ? reconstruct(prev, end) : [];
  push({ array: [], view: 'pathgrid', viewData: snap({ current: null, path, done: true }), vars: { pathLen: path.length, visited: visited.size }, codeLine: 7, desc: found ? `Path found — ${path.length} cells, explored ${visited.size}` : `No path to target — explored ${visited.size}` });
  return { steps, code };
}

// ── A* (Manhattan heuristic, 4-connected grid) ──
export function gridAStar(input) {
  const stats = newStats(); const steps = [];
  const { rows, cols, start, end, walls } = buildGrid(input);
  const isWall = (r, c) => walls.has(key(r, c));
  const inBounds = (r, c) => r >= 0 && r < rows && c >= 0 && c < cols;
  const h = (r, c) => Math.abs(r - end.r) + Math.abs(c - end.c);

  const code = [
    'g[start] = 0; f = h(start); open = [start]',
    'while open not empty:',
    '  u = pop node with min f (= g + h)',
    '  if u is end: done',
    '  for each neighbor v:',
    '    tentative_g = g[u] + 1',
    '    if tentative_g < g[v]: update g, f; prev[v] = u',
    'reconstruct path from end to start',
  ];
  const push = (p) => steps.push(mkStep(p, stats));
  const g = {}; const f = {}; const prev = {};
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { g[key(r, c)] = Infinity; f[key(r, c)] = Infinity; }
  const sk = key(start.r, start.c); g[sk] = 0; f[sk] = h(start.r, start.c);
  const visited = new Set(); const frontier = new Set([sk]);
  const open = [{ r: start.r, c: start.c, f: f[sk] }];

  const snap = (extra) => ({
    rows, cols, start, end, walls,
    visited: new Set(visited), frontier: new Set(frontier),
    current: null, path: [], g: { ...g }, h: h, ...extra,
  });

  push({ array: [], view: 'pathgrid', viewData: snap({ current: { ...start } }), vars: { openSize: 1, visited: 0, h: h(start.r, start.c) }, codeLine: 0, desc: `Initialize A* — start (${start.r}, ${start.c}), target (${end.r}, ${end.c})` });

  let found = false;
  while (open.length) {
    open.sort((a, b) => a.f - b.f || h(a.r, a.c) - h(b.r, b.c));
    const { r: ur, c: uc } = open.shift();
    const uk = key(ur, uc);
    frontier.delete(uk);
    if (visited.has(uk)) continue;
    visited.add(uk); stats.nodeVisits++;
    push({ array: [], view: 'pathgrid', viewData: snap({ current: { r: ur, c: uc } }), vars: { node: `(${ur},${uc})`, g: g[uk], f: f[uk], openSize: open.length, visited: visited.size }, codeLine: 2, desc: `Process (${ur}, ${uc}) — g=${g[uk]}, f=${f[uk]}` });

    if (ur === end.r && uc === end.c) { found = true; break; }

    for (const [dr, dc] of DIRS4) {
      const vr = ur + dr, vc = uc + dc, vk = key(vr, vc);
      stats.edgeTraversals++; stats.comparisons++;
      if (!inBounds(vr, vc) || isWall(vr, vc) || visited.has(vk)) continue;
      const tg = g[uk] + 1;
      if (tg < g[vk]) {
        g[vk] = tg; f[vk] = tg + h(vr, vc); prev[vk] = uk; stats.assignments++;
        if (!frontier.has(vk)) { frontier.add(vk); open.push({ r: vr, c: vc, f: f[vk] }); }
        else open.push({ r: vr, c: vc, f: f[vk] });
        push({ array: [], view: 'pathgrid', viewData: snap({ current: { r: ur, c: uc } }), vars: { from: `(${ur},${uc})`, to: `(${vr},${vc})`, g: tg, f: f[vk], openSize: open.length }, codeLine: 5, desc: `Update (${vr}, ${vc}) — g=${tg}, f=${f[vk]}` });
      }
    }
  }

  const path = found ? reconstruct(prev, end) : [];
  push({ array: [], view: 'pathgrid', viewData: snap({ current: null, path, done: true }), vars: { pathLen: path.length, visited: visited.size }, codeLine: 7, desc: found ? `Path found — ${path.length} cells, explored ${visited.size}` : `No path to target — explored ${visited.size}` });
  return { steps, code };
}

export const pathfindingAlgorithms = [
  {
    id: 'gridDijkstra', name: 'Dijkstra (Grid)', category: 'Shortest Path', view: 'pathgrid',
    inputType: 'grid', generate: gridDijkstra,
    description: 'Uniform-cost search across a grid — expands the closest unvisited cell first.',
    complexity: { best: 'O(E log V)', avg: 'O(E log V)', worst: 'O(E log V)', space: 'O(V)' },
    stable: true, inplace: true,
    useCases: 'Maze routing, equal-cost grids', advantages: 'Guarantees shortest path', disadvantages: 'Explores in all directions',
  },
  {
    id: 'gridAStar', name: 'A* Search (Grid)', category: 'Shortest Path', view: 'pathgrid',
    inputType: 'grid', generate: gridAStar,
    description: 'Best-first search guided by a Manhattan-distance heuristic toward the target.',
    complexity: { best: 'O(E)', avg: 'O(E log V)', worst: 'O(E log V)', space: 'O(V)' },
    stable: true, inplace: true,
    useCases: 'Game pathfinding, navigation', advantages: 'Faster than Dijkstra with good heuristic', disadvantages: 'Heuristic must be admissible',
  },
];