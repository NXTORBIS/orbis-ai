import { mkStep, newStats } from '../stepUtils.js';

// Recursion visualizer. View type: 'tree' (call tree).
// viewData: { root: callNode, callStack, depth }

let _cid = 0;
function call(name, args) { return { id: ++_cid, name, args, children: [], result: null }; }

function snapTree(node, extra = {}) {
  function conv(n) { return { val: `${n.name}(${n.args})`, result: n.result, children: n.children.map(conv) }; }
  return { root: node ? conv(node) : null, ...extra };
}

// ── Factorial ──
export function factorial(input) {
  _cid = 0; const stats = newStats(); const steps = [];
  const n = Array.isArray(input) ? Math.min(Math.max(input.length, 1), 8) : 5;
  const code = ['fact(n):', '  if n <= 1: return 1', '  return n * fact(n-1)'];
  const push = (p) => steps.push(mkStep(p, stats));
  const root = call('fact', `${n}`);
  function rec(n, node) {
    stats.recursiveCalls++;
    push({ array: [], view: 'tree', viewData: snapTree(root, { current: node.id, callStack: [] }), vars: { n }, codeLine: 1, desc: `fact(${n}) called` });
    if (n <= 1) { node.result = 1; push({ array: [], view: 'tree', viewData: snapTree(root, { current: node.id }), vars: { n, result: 1 }, codeLine: 2, desc: `Base: fact(${n}) = 1` }); return 1; }
    const child = call('fact', `${n - 1}`); node.children.push(child);
    const r = rec(n - 1, child);
    node.result = n * r;
    push({ array: [], view: 'tree', viewData: snapTree(root, { current: node.id }), vars: { n, result: node.result }, codeLine: 3, desc: `fact(${n}) = ${n} * ${r} = ${node.result}` });
    return node.result;
  }
  rec(n, root);
  push({ array: [], view: 'tree', viewData: snapTree(root, { done: true }), vars: { result: root.result }, codeLine: 0, desc: `fact(${n}) = ${root.result}` });
  return { steps, code };
}

// ── Fibonacci ──
export function fibRec(input) {
  _cid = 0; const stats = newStats(); const steps = [];
  const n = Array.isArray(input) ? Math.min(Math.max(input.length, 1), 6) : 5;
  const code = ['fib(n):', '  if n <= 1: return n', '  return fib(n-1) + fib(n-2)'];
  const push = (p) => steps.push(mkStep(p, stats));
  const root = call('fib', `${n}`);
  function rec(n, node) {
    stats.recursiveCalls++;
    push({ array: [], view: 'tree', viewData: snapTree(root, { current: node.id }), vars: { n }, codeLine: 1, desc: `fib(${n}) called` });
    if (n <= 1) { node.result = n; push({ array: [], view: 'tree', viewData: snapTree(root, { current: node.id }), vars: { n, result: n }, codeLine: 2, desc: `Base: fib(${n}) = ${n}` }); return n; }
    const l = call('fib', `${n - 1}`), r = call('fib', `${n - 2}`); node.children.push(l, r);
    const a = rec(n - 1, l), b = rec(n - 2, r);
    node.result = a + b;
    push({ array: [], view: 'tree', viewData: snapTree(root, { current: node.id }), vars: { n, result: node.result }, codeLine: 3, desc: `fib(${n}) = ${a} + ${b} = ${node.result}` });
    return node.result;
  }
  rec(n, root);
  push({ array: [], view: 'tree', viewData: snapTree(root, { done: true }), vars: { result: root.result }, codeLine: 0, desc: `fib(${n}) = ${root.result}` });
  return { steps, code };
}

// ── Tower of Hanoi ──
export function hanoi(input) {
  _cid = 0; const stats = newStats(); const steps = [];
  const n = Array.isArray(input) ? Math.min(Math.max(input.length, 1), 4) : 3;
  const code = ['hanoi(n, src, aux, dst):', '  if n==1: move src→dst', '  hanoi(n-1, src, dst, aux)', '  move src→dst', '  hanoi(n-1, aux, src, dst)'];
  const push = (p) => steps.push(mkStep(p, stats));
  const rods = { A: [...Array(n)].map((_, i) => n - i), B: [], C: [] };
  function snap(extra) { return { rods: { A: rods.A.slice(), B: rods.B.slice(), C: rods.C.slice() }, n, ...extra }; }
  push({ array: [], view: 'hanoi', viewData: snap({}), vars: { n }, codeLine: 0, desc: `Tower of Hanoi, ${n} disks` });
  function rec(n, src, aux, dst, node) {
    if (n === 1) { const d = rods[src].pop(); rods[dst].push(d); stats.assignments++; push({ array: [], view: 'hanoi', viewData: snap({ move: [src, dst] }), vars: { src, dst, disk: d }, codeLine: 1, desc: `Move disk ${d}: ${src}→${dst}` }); return; }
    const c1 = call('hanoi', `${n - 1},${src},${dst},${aux}`); node.children.push(c1);
    rec(n - 1, src, dst, aux, c1);
    const d = rods[src].pop(); rods[dst].push(d); stats.assignments++;
    push({ array: [], view: 'hanoi', viewData: snap({ move: [src, dst] }), vars: { src, dst, disk: d }, codeLine: 3, desc: `Move disk ${d}: ${src}→${dst}` });
    const c2 = call('hanoi', `${n - 1},${aux},${src},${dst}`); node.children.push(c2);
    rec(n - 1, aux, src, dst, c2);
  }
  const root = call('hanoi', `${n},A,B,C`); rec(n, 'A', 'B', 'C', root);
  push({ array: [], view: 'hanoi', viewData: snap({ done: true }), vars: { n }, codeLine: 0, desc: 'Solved' });
  return { steps, code };
}

export const recursionAlgorithms = [
  { id: 'factorial', name: 'Factorial (recursion)', category: 'Recursion', view: 'tree', inputType: 'array', generate: factorial, description: 'Recursive factorial showing the call tree and return values.', complexity: { best: 'O(n)', avg: 'O(n)', worst: 'O(n)', space: 'O(n)' }, stable: true, inplace: true, useCases: 'Teaching recursion', advantages: 'Clear', disadvantages: 'Stack overflow for large n' },
  { id: 'fibRec', name: 'Fibonacci (recursion)', category: 'Recursion', view: 'tree', inputType: 'array', generate: fibRec, description: 'Naive recursive Fibonacci showing the exponential call tree.', complexity: { best: 'O(2^n)', avg: 'O(2^n)', worst: 'O(2^n)', space: 'O(n)' }, stable: true, inplace: true, useCases: 'Teaching overlapping subproblems', advantages: 'Shows why DP helps', disadvantages: 'Exponential' },
  { id: 'hanoi', name: 'Tower of Hanoi', category: 'Recursion', view: 'hanoi', inputType: 'array', generate: hanoi, description: 'Classic recursive puzzle moving disks between three rods.', complexity: { best: 'O(2^n)', avg: 'O(2^n)', worst: 'O(2^n)', space: 'O(n)' }, stable: true, inplace: true, useCases: 'Teaching recursion', advantages: 'Elegant', disadvantages: 'Exponential moves' },
];