import { mkStep, newStats } from '../stepUtils.js';
import { buildGrid, reconstruct, DIRS4, key } from './pathfinding.js';

// Extra grid searches. View type: 'pathgrid'.
// Input: { rows, cols, start:{r,c}, end:{r,c}, walls:[ "r,c", ... ] }

// ── Greedy Best-First Search (heuristic only, not guaranteed optimal) ──
export function gridGreedy(input) {
  const stats = newStats(); const steps = [];
  const { rows, cols, start, end, walls } = buildGrid(input);
  const isWall = (r, c) => walls.has(key(r, c));
  const inBounds = (r, c) => r >= 0 && r < rows && c >= 0 && c < cols;
  const h = (r, c) => Math.abs(r - end.r) + Math.abs(c - end.c);

  const code = [
    'open = [start]            # ranked by h only',
    'while open not empty:',
    '  u = pop cell with smallest h(u)',
    '  if u is end: done',
    '  for each neighbor v (up/down/left/right):',
    '    if not wall and not seen: mark seen; push v',
    'reconstruct path from end to start',
  ];
  const push = (p) => steps.push(mkStep(p, stats));
  const prev = {}; const seen = new Set([key(start.r, start.c)]);
  const visited = new Set(); const frontier = new Set([key(start.r, start.c)]);
  const open = [{ r: start.r, c: start.c, h: h(start.r, start.c) }];
  const snap = (extra) => ({ rows, cols, start, end, walls, visited: new Set(visited), frontier: new Set(frontier), current: null, path: [], ...extra });

  push({ array: [], view: 'pathgrid', viewData: snap({ current: { ...start } }), vars: { h: h(start.r, start.c), open: 1 }, codeLine: 0, desc: `Initialize — h(start) = ${h(start.r, start.c)}, target (${end.r}, ${end.c})` });

  let found = false;
  while (open.length) {
    open.sort((a, b) => a.h - b.h);
    const { r: ur, c: uc } = open.shift();
    const uk = key(ur, uc);
    frontier.delete(uk);
    if (visited.has(uk)) continue;
    visited.add(uk); stats.nodeVisits++;
    push({ array: [], view: 'pathgrid', viewData: snap({ current: { r: ur, c: uc } }), vars: { node: `(${ur},${uc})`, h: h(ur, uc), open: open.length, visited: visited.size }, codeLine: 2, desc: `Process (${ur}, ${uc}) — h = ${h(ur, uc)}` });

    if (ur === end.r && uc === end.c) { found = true; break; }

    for (const [dr, dc] of DIRS4) {
      const vr = ur + dr, vc = uc + dc, vk = key(vr, vc);
      stats.edgeTraversals++; stats.comparisons++;
      if (!inBounds(vr, vc) || isWall(vr, vc) || visited.has(vk) || seen.has(vk)) continue;
      seen.add(vk); prev[vk] = uk; frontier.add(vk); stats.assignments++;
      open.push({ r: vr, c: vc, h: h(vr, vc) });
      push({ array: [], view: 'pathgrid', viewData: snap({ current: { r: ur, c: uc } }), vars: { add: `(${vr},${vc})`, h: h(vr, vc), open: open.length }, codeLine: 5, desc: `Push (${vr}, ${vc}) — h = ${h(vr, vc)}` });
    }
  }

  const path = found ? reconstruct(prev, end) : [];
  push({ array: [], view: 'pathgrid', viewData: snap({ current: null, path, done: true }), vars: { pathLen: path.length, visited: visited.size }, codeLine: 6, desc: found ? `Path found — ${path.length} cells, ${visited.size} explored. Greedy can be longer than the optimal path.` : `No path to target — explored ${visited.size}` });
  return { steps, code };
}

// ── Bidirectional BFS (two frontiers growing from both ends) ──
export function gridBidirectional(input) {
  const stats = newStats(); const steps = [];
  const { rows, cols, start, end, walls } = buildGrid(input);
  const isWall = (r, c) => walls.has(key(r, c));
  const inBounds = (r, c) => r >= 0 && r < rows && c >= 0 && c < cols;

  const code = [
    'frontA = {start}; frontB = {end}',
    'while both frontiers not empty:',
    '  expand the smaller frontier by one layer',
    '  if a cell is claimed by both trees: meet',
    'stitch start → meet → end',
  ];
  const push = (p) => steps.push(mkStep(p, stats));
  const prevA = {}; const prevB = {};
  const visitedA = new Set([key(start.r, start.c)]);
  const visitedB = new Set([key(end.r, end.c)]);
  let frontA = [{ r: start.r, c: start.c }];
  let frontB = [{ r: end.r, c: end.c }];
  let meet = null;

  const snap = (extra) => ({
    rows, cols, start, end, walls,
    visited: new Set([...visitedA, ...visitedB]),
    frontier: new Set([...frontA, ...frontB].map((n) => key(n.r, n.c))),
    current: null, path: [],
    ...extra,
  });

  push({ array: [], view: 'pathgrid', viewData: snap({ current: { ...start } }), vars: { frontA: 1, frontB: 1 }, codeLine: 0, desc: 'Two searches grow at once — one from start, one from target' });

  while (frontA.length && frontB.length && !meet) {
    const growA = frontA.length <= frontB.length;
    const front = growA ? frontA : frontB;
    const visited = growA ? visitedA : visitedB;
    const prev = growA ? prevA : prevB;
    const next = [];

    for (const { r, c } of front) {
      const k = key(r, c);
      stats.nodeVisits++;
      push({ array: [], view: 'pathgrid', viewData: snap({ current: { r, c } }), vars: { expanding: growA ? 'start side' : 'target side', cell: `(${r},${c})`, frontA: frontA.length, frontB: frontB.length }, codeLine: 2, desc: `${growA ? 'Start' : 'Target'}-side expands (${r}, ${c})` });

      for (const [dr, dc] of DIRS4) {
        const vr = r + dr, vc = c + dc, vk = key(vr, vc);
        stats.edgeTraversals++;
        if (!inBounds(vr, vc) || isWall(vr, vc) || visited.has(vk)) continue;
        visited.add(vk); prev[vk] = k; next.push({ r: vr, c: vc }); stats.assignments++;
        if (visitedA.has(vk) && visitedB.has(vk)) meet = vk;
        push({ array: [], view: 'pathgrid', viewData: snap({ current: { r: vr, c: vc } }), vars: { add: `(${vr},${vc})`, frontA: frontA.length, frontB: frontB.length }, codeLine: 3, desc: `Claim (${vr}, ${vc})${meet ? ' — the two searches meet!' : ''}` });
        if (meet) break;
      }
      if (meet) break;
    }
    if (growA) frontA = next; else frontB = next;
  }

  let path = [];
  if (meet) {
    const left = []; let cur = meet;
    while (cur) { const [r, c] = cur.split(',').map(Number); left.unshift({ r, c }); cur = prevA[cur]; }
    const right = []; let nxt = prevB[meet];
    while (nxt) { const [r, c] = nxt.split(',').map(Number); right.push({ r, c }); nxt = prevB[nxt]; }
    path = [...left, ...right];
  } else if (visitedA.has(key(end.r, end.c))) {
    path = reconstruct(prevA, end);
  }

  push({ array: [], view: 'pathgrid', viewData: snap({ current: null, path, done: true }), vars: { pathLen: path.length, visited: visitedA.size + visitedB.size }, codeLine: 4, desc: path.length ? `Path found — ${path.length} cells, ${visitedA.size + visitedB.size} cells explored in total` : 'No path to target — the frontiers were exhausted' });
  return { steps, code };
}

// ── Depth-First maze walk (recursive, with backtracking) ──
export function gridDFS(input) {
  const stats = newStats(); const steps = [];
  const { rows, cols, start, end, walls } = buildGrid(input);
  const isWall = (r, c) => walls.has(key(r, c));
  const inBounds = (r, c) => r >= 0 && r < rows && c >= 0 && c < cols;

  const code = [
    'walk(cell):',
    '  mark visited; push onto the trail',
    '  if cell is the target: return true',
    '  for each neighbor:',
    '    if open and unvisited: walk(neighbor)',
    '  backtrack — pop the trail',
  ];
  const push = (p) => steps.push(mkStep(p, stats));
  const visited = new Set();
  const trail = [];
  let solution = null;

  const snap = (extra) => ({ rows, cols, start, end, walls, visited: new Set(visited), frontier: new Set(), current: null, path: trail.map((p) => ({ ...p })), ...extra });

  push({ array: [], view: 'pathgrid', viewData: snap({ current: { ...start } }), vars: { depth: 0 }, codeLine: 0, desc: 'Follow one corridor to its end, then backtrack — the trail is the current stack' });

  const walk = (r, c) => {
    visited.add(r, c); trail.push({ r, c }); stats.nodeVisits++; stats.stackOps++;
    push({ array: [], view: 'pathgrid', viewData: snap({ current: { r, c } }), vars: { depth: trail.length, visited: visited.size }, codeLine: 1, desc: `Visit (${r}, ${c}) — trail depth ${trail.length}` });

    if (r === end.r && c === end.c) { solution = trail.map((p) => ({ ...p })); return true; }

    for (const [dr, dc] of DIRS4) {
      const vr = r + dr, vc = c + dc;
      stats.edgeTraversals++;
      if (!inBounds(vr, vc) || isWall(vr, vc) || visited.has(key(vr, vc))) continue;
      if (walk(vr, vc)) return true;
    }

    trail.pop(); stats.stackOps++; stats.comparisons++;
    if (trail.length) push({ array: [], view: 'pathgrid', viewData: snap({ current: { ...trail[trail.length - 1] } }), vars: { depth: trail.length, backtracked: `(${r},${c})` }, codeLine: 5, desc: `Dead end at (${r}, ${c}) — backtrack` });
    return false;
  };

  walk(start.r, start.c);

  push({ array: [], view: 'pathgrid', viewData: { rows, cols, start, end, walls, visited: new Set(visited), frontier: new Set(), current: null, path: solution || [], done: true }, vars: { pathLen: solution ? solution.length : 0, visited: visited.size }, codeLine: 5, desc: solution ? `Path found — ${solution.length} cells, ${visited.size} explored. DFS paths are not the shortest.` : `No path to target — explored ${visited.size}` });
  return { steps, code };
}

export const pathfindingAdvancedAlgorithms = [
  {
    id: 'gridGreedy', name: 'Greedy Best-First (Grid)', category: 'Shortest Path', view: 'pathgrid',
    inputType: 'grid', generate: gridGreedy,
    description: 'Always steps toward the cell that looks closest to the target, ignoring the distance already travelled.',
    complexity: { best: 'O(E)', avg: 'O(E log V)', worst: 'O(E log V)', space: 'O(V)' },
    stable: false, inplace: true,
    useCases: 'Fast approximate routing', advantages: 'Very few cells expanded', disadvantages: 'Can be far from optimal',
  },
  {
    id: 'gridBidirectional', name: 'Bidirectional BFS (Grid)', category: 'Shortest Path', view: 'pathgrid',
    inputType: 'grid', generate: gridBidirectional,
    description: 'Grows two breadth-first frontiers — one from the start, one from the target — until they meet.',
    complexity: { best: 'O(V)', avg: 'O(V)', worst: 'O(V)', space: 'O(V)' },
    stable: true, inplace: true,
    useCases: 'Maze solving on large grids', advantages: 'Explores roughly half the area of BFS', disadvantages: 'Needs a known target',
  },
  {
    id: 'gridDFS', name: 'DFS Maze Walk (Grid)', category: 'Shortest Path', view: 'pathgrid',
    inputType: 'grid', generate: gridDFS,
    description: 'Recursive depth-first walk down each corridor with explicit backtracking when it hits a dead end.',
    complexity: { best: 'O(V)', avg: 'O(V+E)', worst: 'O(V+E)', space: 'O(V)' },
    stable: false, inplace: true,
    useCases: 'Maze traversal, connectivity', advantages: 'Tiny memory footprint', disadvantages: 'Path is usually not the shortest',
  },
];