import { mkStep, newStats } from '../stepUtils.js';

// Tree algorithms. View type: 'tree'. viewData: { root, current, path, visited, type }

function snap(node, extra = {}) {
  function conv(n) { return n ? { val: n.val, left: conv(n.left), right: conv(n.right) } : null; }
  return { root: conv(node), ...extra };
}

// ── BST Insert ──
function bstInsertFn(input) {
  const stats = newStats(); const steps = [];
  const a = [...input];
  const code = ['root = null', 'for v in arr:', '  insert v into BST', 'insert(node, v):', '  if v < node.val: node.left = insert(...)', '  else: node.right = insert(...)'];
  const push = (p) => steps.push(mkStep(p, stats));
  let root = null;
  function insert(node, v) {
    stats.nodeVisits++;
    if (!node) return { val: v, left: null, right: null };
    if (v < node.val) node.left = insert(node.left, v); else node.right = insert(node.right, v);
    return node;
  }
  push({ array: a, view: 'tree', viewData: snap(root, { current: null }), vars: {}, codeLine: 0, desc: 'Start empty BST' });
  for (const v of a) {
    root = insert(root, v);
    push({ array: a, view: 'tree', viewData: snap(root, { current: v }), vars: { v }, codeLine: 2, desc: `Insert ${v}` });
  }
  push({ array: a, view: 'tree', viewData: snap(root, { visited: [] }), vars: {}, codeLine: 0, desc: 'BST built' });
  return { steps, code };
}

// ── BST Search ──
export function bstSearch(input, opts = {}) {
  const stats = newStats(); const steps = [];
  const a = [...input]; const target = opts.target ?? a[Math.floor(a.length / 2)];
  const code = ['search(node, target):', '  if !node: return null', '  if node.val == target: return node', '  if target < node.val: search left', '  else: search right'];
  const push = (p) => steps.push(mkStep(p, stats));
  let root = null;
  function insert(node, v) { if (!node) return { val: v, left: null, right: null }; if (v < node.val) node.left = insert(node.left, v); else node.right = insert(node.right, v); return node; }
  for (const v of a) root = insert(root, v);
  const path = [];
  function search(node) {
    if (!node) { push({ array: a, view: 'tree', viewData: snap(root, { path: path.slice() }), vars: { target }, codeLine: 1, desc: `Not found` }); return; }
    path.push(node.val); stats.comparisons++;
    push({ array: a, view: 'tree', viewData: snap(root, { current: node.val, path: path.slice() }), vars: { node: node.val, target }, codeLine: 2, desc: `Visit ${node.val}` });
    if (node.val === target) { push({ array: a, view: 'tree', viewData: snap(root, { current: node.val, found: true, path: path.slice() }), vars: { target }, codeLine: 2, desc: `Found ${target}` }); return; }
    if (target < node.val) { push({ array: a, view: 'tree', viewData: snap(root, { current: node.val, path: path.slice() }), vars: { node: node.val, target }, codeLine: 3, desc: `Go left` }); search(node.left); }
    else { push({ array: a, view: 'tree', viewData: snap(root, { current: node.val, path: path.slice() }), vars: { node: node.val, target }, codeLine: 4, desc: `Go right` }); search(node.right); }
  }
  search(root);
  return { steps, code };
}

// ── Tree Traversals ──
function traversalAlgo(input, mode) {
  const stats = newStats(); const steps = [];
  const a = [...input];
  const codeMap = {
    inorder: ['inorder(node):', '  inorder(node.left)', '  visit(node)', '  inorder(node.right)'],
    preorder: ['preorder(node):', '  visit(node)', '  preorder(node.left)', '  preorder(node.right)'],
    postorder: ['postorder(node):', '  postorder(node.left)', '  postorder(node.right)', '  visit(node)'],
    levelorder: ['queue = [root]', 'while queue:', '  node = dequeue; visit', '  enqueue children'],
  };
  const code = codeMap[mode];
  const push = (p) => steps.push(mkStep(p, stats));
  let root = null;
  function insert(node, v) { if (!node) return { val: v, left: null, right: null }; if (v < node.val) node.left = insert(node.left, v); else node.right = insert(node.right, v); return node; }
  for (const v of a) root = insert(root, v);
  const visited = [];
  function rec(node, lineMap) {
    if (!node) return;
    if (lineMap.leftFirst) { rec(node.left, lineMap); push({ array: a, view: 'tree', viewData: snap(root, { current: node.val, visited: visited.slice() }), vars: { node: node.val }, codeLine: lineMap.visitLine, desc: `Visit ${node.val}` }); visited.push(node.val); rec(node.right, lineMap); }
    else if (lineMap.visitFirst) { push({ array: a, view: 'tree', viewData: snap(root, { current: node.val, visited: visited.slice() }), vars: { node: node.val }, codeLine: lineMap.visitLine, desc: `Visit ${node.val}` }); visited.push(node.val); rec(node.left, lineMap); rec(node.right, lineMap); }
    else { rec(node.left, lineMap); rec(node.right, lineMap); push({ array: a, view: 'tree', viewData: snap(root, { current: node.val, visited: visited.slice() }), vars: { node: node.val }, codeLine: lineMap.visitLine, desc: `Visit ${node.val}` }); visited.push(node.val); }
  }
  if (mode === 'levelorder') {
    const q = [root];
    while (q.length) {
      const node = q.shift(); push({ array: a, view: 'tree', viewData: snap(root, { current: node.val, visited: visited.slice() }), vars: { node: node.val }, codeLine: 2, desc: `Visit ${node.val}` }); visited.push(node.val);
      if (node.left) q.push(node.left); if (node.right) q.push(node.right);
    }
  } else {
    const lineMap = mode === 'inorder' ? { leftFirst: true, visitLine: 2 } : mode === 'preorder' ? { visitFirst: true, visitLine: 1 } : { visitLine: 3 };
    rec(root, lineMap);
  }
  push({ array: a, view: 'tree', viewData: snap(root, { visited: visited.slice(), done: true }), vars: { order: visited.join(' → ') }, codeLine: 0, desc: `${mode}: ${visited.join(' → ')}` });
  return { steps, code };
}

export const bstInsert = (i) => bstInsertFn(i);
export const inorder = (i) => traversalAlgo(i, 'inorder');
export const preorder = (i) => traversalAlgo(i, 'preorder');
export const postorder = (i) => traversalAlgo(i, 'postorder');
export const levelorder = (i) => traversalAlgo(i, 'levelorder');

export const treeAlgorithms = [
  { id: 'bstInsert', name: 'BST Insert', category: 'Trees', view: 'tree', inputType: 'array', generate: bstInsert, description: 'Inserts values into a binary search tree one by one.', complexity: { best: 'O(log n)', avg: 'O(log n)', worst: 'O(n)', space: 'O(n)' }, stable: true, inplace: true, useCases: 'Ordered sets', advantages: 'Ordered structure', disadvantages: 'Can degenerate' },
  { id: 'bstSearch', name: 'BST Search', category: 'Trees', view: 'tree', inputType: 'array', needsTarget: true, generate: bstSearch, description: 'Searches a BST, going left/right by comparison.', complexity: { best: 'O(log n)', avg: 'O(log n)', worst: 'O(n)', space: 'O(1)' }, stable: true, inplace: true, useCases: 'Ordered lookup', advantages: 'Fast on balanced', disadvantages: 'O(n) if unbalanced' },
  { id: 'inorder', name: 'In-order Traversal', category: 'Trees', view: 'tree', inputType: 'array', generate: inorder, description: 'Left → node → right, producing sorted order for a BST.', complexity: { best: 'O(n)', avg: 'O(n)', worst: 'O(n)', space: 'O(h)' }, stable: true, inplace: true, useCases: 'Sorted output', advantages: 'Sorted for BST', disadvantages: 'Recursive stack' },
  { id: 'preorder', name: 'Pre-order Traversal', category: 'Trees', view: 'tree', inputType: 'array', generate: preorder, description: 'Node → left → right — root first.', complexity: { best: 'O(n)', avg: 'O(n)', worst: 'O(n)', space: 'O(h)' }, stable: true, inplace: true, useCases: 'Copy/serialize tree', advantages: 'Root first', disadvantages: '—' },
  { id: 'postorder', name: 'Post-order Traversal', category: 'Trees', view: 'tree', inputType: 'array', generate: postorder, description: 'Left → right → node — children before parent.', complexity: { best: 'O(n)', avg: 'O(n)', worst: 'O(n)', space: 'O(h)' }, stable: true, inplace: true, useCases: 'Tree deletion', advantages: 'Children first', disadvantages: '—' },
  { id: 'levelorder', name: 'Level-order Traversal (BFS)', category: 'Trees', view: 'tree', inputType: 'array', generate: levelorder, description: 'Visits nodes level by level using a queue.', complexity: { best: 'O(n)', avg: 'O(n)', worst: 'O(n)', space: 'O(w)' }, stable: true, inplace: true, useCases: 'Level processing', advantages: 'Level-by-level', disadvantages: 'O(w) space' },
];