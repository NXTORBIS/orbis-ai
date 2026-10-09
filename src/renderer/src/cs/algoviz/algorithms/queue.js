import { mkStep, newStats } from '../stepUtils.js';

// Queue algorithms. View type: 'queue'. viewData: { items, front, rear, op, highlight }

// ── BFS on a small graph (queue demo) ──
export function bfsQueue(input, opts = {}) {
  const stats = newStats(); const steps = [];
  // Build a small fixed graph for demonstration
  const adj = { 0: [1, 2], 1: [3, 4], 2: [5], 3: [], 4: [], 5: [] };
  const labels = ['A', 'B', 'C', 'D', 'E', 'F'];
  const code = ['queue = [start]; visited = {start}', 'while queue:', '  node = dequeue()', '  for neighbor of node:', '    if not visited: enqueue', 'visited order recorded'];
  const push = (p) => steps.push(mkStep(p, stats));
  const q = [0]; const visited = new Set([0]); const order = [];
  push({ array: labels, view: 'queue', viewData: { items: q.map((i) => labels[i]), op: 'init', highlight: [0] }, vars: { queue: q.map((i) => labels[i]).join(','), visited: [...visited].map((i) => labels[i]).join(',') }, codeLine: 0, desc: 'Start BFS from A' });
  while (q.length) {
    const node = q.shift(); stats.queueOps++; order.push(node);
    push({ array: labels, view: 'queue', viewData: { items: q.map((i) => labels[i]), op: 'dequeue', highlight: [] }, vars: { node: labels[node], queue: q.map((i) => labels[i]).join(',') || 'empty', visited: order.map((i) => labels[i]).join(',') }, codeLine: 2, desc: `Dequeue ${labels[node]}` });
    for (const nb of adj[node]) {
      if (!visited.has(nb)) { visited.add(nb); q.push(nb); stats.queueOps++; push({ array: labels, view: 'queue', viewData: { items: q.map((i) => labels[i]), op: 'enqueue', highlight: [q.length - 1] }, vars: { node: labels[node], neighbor: labels[nb], queue: q.map((i) => labels[i]).join(',') }, codeLine: 4, desc: `Enqueue ${labels[nb]}` }); }
    }
  }
  push({ array: labels, view: 'queue', viewData: { items: [], op: 'done' }, vars: { order: order.map((i) => labels[i]).join(' → ') }, codeLine: 5, desc: `BFS order: ${order.map((i) => labels[i]).join(' → ')}` });
  return { steps, code };
}

// ── Circular Queue simulation ──
export function circularQueue(input, opts = {}) {
  const stats = newStats(); const steps = [];
  const cap = 5; const q = new Array(cap).fill(null);
  let front = -1, rear = -1;
  const ops = [1, 2, 3, 4, 5, 'd', 'd', 6, 7];
  const code = ['enqueue: rear=(rear+1)%cap; q[rear]=x', 'dequeue: x=q[front]; front=(front+1)%cap'];
  const push = (p) => steps.push(mkStep(p, stats));
  push({ array: [], view: 'queue', viewData: { items: q.slice(), front, rear, op: 'init', circular: true, cap }, vars: { front, rear }, codeLine: 0, desc: `Circular queue, capacity ${cap}` });
  for (const op of ops) {
    if (op === 'd') {
      if (front === -1) { push({ array: [], view: 'queue', viewData: { items: q.slice(), front, rear, op: 'underflow', circular: true, cap }, vars: { front, rear }, codeLine: 1, desc: 'Underflow' }); continue; }
      const x = q[front]; if (front === rear) { front = -1; rear = -1; } else front = (front + 1) % cap; stats.queueOps++;
      push({ array: [], view: 'queue', viewData: { items: q.slice(), front, rear, op: 'dequeue', circular: true, cap }, vars: { front, rear, dequeued: x }, codeLine: 1, desc: `Dequeue ${x}` });
    } else {
      if ((rear + 1) % cap === front) { push({ array: [], view: 'queue', viewData: { items: q.slice(), front, rear, op: 'overflow', circular: true, cap }, vars: { front, rear }, codeLine: 0, desc: 'Overflow' }); continue; }
      if (front === -1) front = 0; rear = (rear + 1) % cap; q[rear] = op; stats.queueOps++;
      push({ array: [], view: 'queue', viewData: { items: q.slice(), front, rear, op: 'enqueue', circular: true, cap, highlight: rear }, vars: { front, rear, enqueued: op }, codeLine: 0, desc: `Enqueue ${op}` });
    }
  }
  push({ array: [], view: 'queue', viewData: { items: q.slice(), front, rear, op: 'done', circular: true, cap }, vars: { front, rear }, codeLine: 0, desc: 'Done' });
  return { steps, code };
}

export const queueAlgorithms = [
  { id: 'bfsQueue', name: 'BFS Queue Demo', category: 'Queues', view: 'queue', inputType: 'none', generate: bfsQueue, description: 'Shows a queue driving breadth-first traversal of a small graph.', complexity: { best: 'O(V+E)', avg: 'O(V+E)', worst: 'O(V+E)', space: 'O(V)' }, stable: true, inplace: true, useCases: 'Level-order traversal', advantages: 'Shortest in edges', disadvantages: 'O(V) space' },
  { id: 'circularQueue', name: 'Circular Queue', category: 'Queues', view: 'queue', inputType: 'none', generate: circularQueue, description: 'Fixed-capacity queue wrapping around using modulo arithmetic.', complexity: { best: 'O(1)', avg: 'O(1)', worst: 'O(1)', space: 'O(k)' }, stable: true, inplace: true, useCases: 'Ring buffers', advantages: 'O(1) ops, fixed memory', disadvantages: 'Fixed capacity' },
];