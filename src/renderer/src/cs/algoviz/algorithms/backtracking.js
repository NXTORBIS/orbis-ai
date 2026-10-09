import { mkStep, newStats } from '../stepUtils.js';

// Backtracking. View type: 'grid' (N-Queens) or 'tree' (permutations).

// ── N-Queens ──
export function nQueens(input) {
  const stats = newStats(); const steps = [];
  const n = Array.isArray(input) ? Math.min(Math.max(input.length, 1), 6) : 4;
  const code = ['solve(row, board):', '  if row==n: record solution', '  for col in 0..n-1:', '    if safe(row,col): place; solve(row+1)', '    remove (backtrack)'];
  const push = (p) => steps.push(mkStep(p, stats));
  const board = new Array(n).fill(-1);
  function safe(r, c) { for (let i = 0; i < r; i++) { if (board[i] === c || Math.abs(board[i] - c) === r - i) return false; } return true; }
  function snap(extra) { return { board: board.slice(), n, ...extra }; }
  push({ array: [], view: 'grid', viewData: snap({}), vars: { n }, codeLine: 0, desc: `N-Queens, n=${n}` });
  let solutions = 0;
  function solve(row) {
    if (row === n) { solutions++; push({ array: [], view: 'grid', viewData: snap({ solution: true }), vars: { solutions }, codeLine: 1, desc: `Solution ${solutions} found` }); return; }
    for (let col = 0; col < n; col++) {
      stats.comparisons++;
      if (safe(row, col)) {
        board[row] = col; stats.assignments++;
        push({ array: [], view: 'grid', viewData: snap({ place: [row, col] }), vars: { row, col }, codeLine: 3, desc: `Place queen at (${row},${col})` });
        solve(row + 1);
        board[row] = -1;
        push({ array: [], view: 'grid', viewData: snap({ backtrack: [row, col] }), vars: { row, col }, codeLine: 4, desc: `Backtrack from (${row},${col})` });
      } else { push({ array: [], view: 'grid', viewData: snap({ reject: [row, col] }), vars: { row, col }, codeLine: 3, desc: `(${row},${col}) unsafe` }); }
    }
  }
  solve(0);
  push({ array: [], view: 'grid', viewData: snap({ done: true }), vars: { solutions }, codeLine: 0, desc: `${solutions} solutions found` });
  return { steps, code };
}

// ── Permutations ──
export function permutations(input) {
  const stats = newStats(); const steps = [];
  const a = [...input].slice(0, 5);
  const code = ['perm(path, used):', '  if len(path)==n: record', '  for i in 0..n-1:', '    if not used[i]: use; perm; unuse'];
  const push = (p) => steps.push(mkStep(p, stats));
  const n = a.length; const used = new Array(n).fill(false); const path = []; const results = [];
  push({ array: a, view: 'grid', viewData: { path: [], used: used.slice(), n }, vars: { n }, codeLine: 0, desc: `Permutations of [${a.join(',')}]` });
  function perm() {
    if (path.length === n) { results.push(path.slice()); push({ array: a, view: 'grid', viewData: { path: path.slice(), used: used.slice(), n, solution: true }, vars: { perm: path.join(',') }, codeLine: 1, desc: `Permutation: [${path.join(',')}]` }); return; }
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      used[i] = true; path.push(a[i]); stats.assignments++;
      push({ array: a, view: 'grid', viewData: { path: path.slice(), used: used.slice(), n, place: [path.length - 1, i] }, vars: { i, val: a[i] }, codeLine: 3, desc: `Pick ${a[i]}` });
      perm();
      used[i] = false; path.pop();
      push({ array: a, view: 'grid', viewData: { path: path.slice(), used: used.slice(), n, backtrack: true }, vars: { i }, codeLine: 3, desc: `Unpick ${a[i]}` });
    }
  }
  perm();
  push({ array: a, view: 'grid', viewData: { path: [], used: used.slice(), n, done: true }, vars: { count: results.length }, codeLine: 0, desc: `${results.length} permutations` });
  return { steps, code };
}

export const backtrackingAlgorithms = [
  { id: 'nQueens', name: 'N-Queens', category: 'Backtracking', view: 'grid', inputType: 'array', generate: nQueens, description: 'Place N queens so none attack each other, backtracking on dead ends.', complexity: { best: 'O(n)', avg: 'O(n!)', worst: 'O(n!)', space: 'O(n)' }, stable: true, inplace: true, useCases: 'Constraint problems', advantages: 'Classic backtracking', disadvantages: 'Factorial' },
  { id: 'permutations', name: 'Permutations', category: 'Backtracking', view: 'grid', inputType: 'array', generate: permutations, description: 'Generate all permutations by choosing, recursing, and un-choosing.', complexity: { best: 'O(n)', avg: 'O(n!)', worst: 'O(n!)', space: 'O(n)' }, stable: true, inplace: true, useCases: 'Orderings', advantages: 'Clear backtracking', disadvantages: 'Factorial' },
];