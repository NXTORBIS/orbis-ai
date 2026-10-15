import { mkStep, newStats } from '../stepUtils';

// Linked-list algorithms. View type: 'list'.
// viewData: { nodes: [{id,val}], links: [{from,to}], head, tail, highlight: [ids], type: 'singly'|'doubly'|'circular' }

let _id = 0;
function node(val) { return { id: ++_id, val, next: null, prev: null }; }

function snapshot(head, hl = [], type = 'singly') {
  const nodes = []; const links = [];
  let cur = head; const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id); nodes.push({ id: cur.id, val: cur.val });
    if (cur.next) links.push({ from: cur.id, to: cur.next.id });
    cur = cur.next;
  }
  return { nodes, links, head: head ? head.id : null, highlight: hl, type };
}

// ── Singly Linked List: insert at end, then reverse ──
export function listReverse(input) {
  _id = 0; const stats = newStats(); const steps = [];
  const a = [...input];
  const code = ['build list from array', 'prev = null; cur = head', 'while cur:', '  nxt = cur.next; cur.next = prev', '  prev = cur; cur = nxt', 'head = prev'];
  const push = (p) => steps.push(mkStep(p, stats));
  let head = null, tail = null;
  for (const v of a) { const n = node(v); if (!head) head = n; else tail.next = n; tail = n; }
  push({ array: a, view: 'list', viewData: snapshot(head, [], 'singly'), vars: {}, codeLine: 0, desc: 'Built linked list' });
  let prev = null, cur = head;
  while (cur) {
    push({ array: a, view: 'list', viewData: snapshot(head, [cur.id], 'singly'), vars: { cur: cur.val, prev: prev ? prev.val : 'null' }, codeLine: 2, desc: `Visit node ${cur.val}` });
    const nxt = cur.next;
    cur.next = prev; stats.assignments++;
    head = cur;
    push({ array: a, view: 'list', viewData: snapshot(head, [cur.id], 'singly'), vars: { cur: cur.val }, codeLine: 3, desc: `Reverse link from ${cur.val}` });
    prev = cur; cur = nxt;
  }
  head = prev;
  push({ array: a, view: 'list', viewData: snapshot(head, [], 'singly'), vars: {}, codeLine: 5, desc: 'List reversed' });
  return { steps, code };
}

// ── Find middle (slow/fast pointers) ──
export function listMiddle(input) {
  _id = 0; const stats = newStats(); const steps = [];
  const a = [...input];
  const code = ['slow = head; fast = head', 'while fast and fast.next:', '  slow = slow.next', '  fast = fast.next.next', 'return slow'];
  const push = (p) => steps.push(mkStep(p, stats));
  let head = null, tail = null;
  for (const v of a) { const n = node(v); if (!head) head = n; else tail.next = n; tail = n; }
  let slow = head, fast = head;
  push({ array: a, view: 'list', viewData: snapshot(head, [slow.id], 'singly'), vars: { slow: slow.val, fast: fast.val }, codeLine: 0, desc: 'Start slow & fast at head' });
  while (fast && fast.next) {
    slow = slow.next; fast = fast.next.next;
    push({ array: a, view: 'list', viewData: snapshot(head, [slow.id, fast ? fast.id : -1], 'singly'), vars: { slow: slow.val, fast: fast ? fast.val : 'null' }, codeLine: 3, desc: `slow=${slow.val}, fast=${fast ? fast.val : 'null'}` });
  }
  push({ array: a, view: 'list', viewData: snapshot(head, [slow.id], 'singly'), vars: { middle: slow.val }, codeLine: 4, desc: `Middle = ${slow.val}` });
  return { steps, code };
}

// ── Detect cycle (Floyd) ──
export function listCycleDetect(input) {
  _id = 0; const stats = newStats(); const steps = [];
  const a = [...input];
  const code = ['slow=head; fast=head', 'while fast and fast.next:', '  slow=slow.next; fast=fast.next.next', '  if slow==fast: cycle found', 'no cycle'];
  const push = (p) => steps.push(mkStep(p, stats));
  let head = null, tail = null;
  for (const v of a) { const n = node(v); if (!head) head = n; else tail.next = n; tail = n; }
  // create a cycle: tail -> head.next (if length >= 3)
  let hasCycle = false;
  if (a.length >= 3) { tail.next = head.next; hasCycle = true; }
  let slow = head, fast = head; let iter = 0; const MAX = a.length * 4 + 10;
  push({ array: a, view: 'list', viewData: { ...snapshot(head, [slow.id], 'singly'), cycle: hasCycle }, vars: { slow: slow.val, fast: fast.val }, codeLine: 0, desc: hasCycle ? 'List has an injected cycle' : 'No cycle injected' });
  while (iter++ < MAX) {
    if (!fast || !fast.next) { push({ array: a, view: 'list', viewData: snapshot(head, [], 'singly'), vars: {}, codeLine: 4, desc: 'No cycle' }); return { steps, code }; }
    slow = slow.next; fast = fast.next.next;
    push({ array: a, view: 'list', viewData: { ...snapshot(head, [slow.id, fast.id], 'singly'), cycle: hasCycle }, vars: { slow: slow.val, fast: fast.val }, codeLine: 2, desc: `slow=${slow.val}, fast=${fast.val}` });
    if (slow === fast) { push({ array: a, view: 'list', viewData: { ...snapshot(head, [slow.id], 'singly'), cycle: true }, vars: { slow: slow.val }, codeLine: 3, desc: `Cycle detected at ${slow.val}` }); return { steps, code }; }
  }
  push({ array: a, view: 'list', viewData: snapshot(head, [], 'singly'), vars: {}, codeLine: 4, desc: 'No cycle' });
  return { steps, code };
}

// ── Search in list ──
export function listSearch(input, opts = {}) {
  _id = 0; const stats = newStats(); const steps = [];
  const a = [...input]; const target = opts.target ?? a[Math.floor(a.length / 2)];
  const code = ['cur = head', 'while cur:', '  if cur.val == target: return cur', '  cur = cur.next', 'return null'];
  const push = (p) => steps.push(mkStep(p, stats));
  let head = null, tail = null;
  for (const v of a) { const n = node(v); if (!head) head = n; else tail.next = n; tail = n; }
  let cur = head;
  push({ array: a, view: 'list', viewData: snapshot(head, [], 'singly'), vars: { target }, codeLine: 0, desc: `Search for ${target}` });
  while (cur) {
    stats.comparisons++;
    push({ array: a, view: 'list', viewData: snapshot(head, [cur.id], 'singly'), vars: { cur: cur.val, target }, codeLine: 2, desc: `Compare ${cur.val} with ${target}` });
    if (cur.val === target) { push({ array: a, view: 'list', viewData: snapshot(head, [cur.id], 'singly'), vars: { found: cur.val }, codeLine: 2, desc: `Found ${target}` }); return { steps, code }; }
    cur = cur.next;
  }
  push({ array: a, view: 'list', viewData: snapshot(head, [], 'singly'), vars: { target }, codeLine: 4, desc: `Not found` });
  return { steps, code };
}

export const linkedListAlgorithms = [
  { id: 'listReverse', name: 'Linked List Reverse', category: 'Linked Lists', view: 'list', inputType: 'array', generate: listReverse, description: 'Reverses a singly linked list by flipping each pointer.', complexity: { best: 'O(n)', avg: 'O(n)', worst: 'O(n)', space: 'O(1)' }, stable: true, inplace: true, useCases: 'List utilities', advantages: 'In-place', disadvantages: '—' },
  { id: 'listMiddle', name: 'Find Middle (slow/fast)', category: 'Linked Lists', view: 'list', inputType: 'array', generate: listMiddle, description: 'Slow & fast pointers find the middle in one pass.', complexity: { best: 'O(n)', avg: 'O(n)', worst: 'O(n)', space: 'O(1)' }, stable: true, inplace: true, useCases: 'Middle of list', advantages: 'One pass', disadvantages: '—' },
  { id: 'listCycleDetect', name: 'Detect Cycle (Floyd)', category: 'Linked Lists', view: 'list', inputType: 'array', generate: listCycleDetect, description: "Floyd's tortoise & hare detect a cycle in O(1) space.", complexity: { best: 'O(n)', avg: 'O(n)', worst: 'O(n)', space: 'O(1)' }, stable: true, inplace: true, useCases: 'Cycle detection', advantages: 'O(1) space', disadvantages: '—' },
  { id: 'listSearch', name: 'Linked List Search', category: 'Linked Lists', view: 'list', inputType: 'array', needsTarget: true, generate: listSearch, description: 'Linear search through a linked list.', complexity: { best: 'O(1)', avg: 'O(n)', worst: 'O(n)', space: 'O(1)' }, stable: true, inplace: true, useCases: 'Unsorted lists', advantages: 'Simple', disadvantages: 'Linear' },
];