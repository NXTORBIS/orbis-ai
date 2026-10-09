import { mkStep, newStats } from '../stepUtils.js';

// DP algorithms. View type: 'table'. viewData: { rows, cols, cells, cur: [r,c], prev: [[r,c]], labels }

// ── Fibonacci DP ──
export function fibDP(input) {
  const stats = newStats(); const steps = [];
  const n = Array.isArray(input) ? Math.min(Math.max(input.length, 2), 20) : 10;
  const code = ['dp[0]=0; dp[1]=1', 'for i in 2..n:', '  dp[i] = dp[i-1] + dp[i-2]', 'return dp[n]'];
  const push = (p) => steps.push(mkStep(p, stats));
  const dp = [0, 1];
  push({ array: dp, view: 'table', viewData: { rows: [dp.slice()], cols: ['i', 'fib'], cur: [0, 0], prev: [] }, vars: { n }, codeLine: 0, desc: 'Base: fib(0)=0, fib(1)=1' });
  for (let i = 2; i <= n; i++) {
    dp[i] = dp[i - 1] + dp[i - 2]; stats.assignments++;
    push({ array: dp, view: 'table', viewData: { rows: [dp.slice()], cols: ['i', 'fib'], cur: [0, i], prev: [[0, i - 1], [0, i - 2]] }, vars: { i, val: dp[i] }, codeLine: 2, desc: `fib(${i}) = ${dp[i - 1]} + ${dp[i - 2]} = ${dp[i]}` });
  }
  push({ array: dp, view: 'table', viewData: { rows: [dp.slice()], cols: ['i', 'fib'], cur: [0, n], done: true }, vars: { result: dp[n] }, codeLine: 3, desc: `fib(${n}) = ${dp[n]}` });
  return { steps, code };
}

// ── Longest Common Subsequence ──
export function lcs(input, opts = {}) {
  const stats = newStats(); const steps = [];
  const a = (opts.string ?? 'ABCBDAB').split('');
  const b = (opts.string2 ?? 'BDCABA').split('');
  const code = ['for i in 1..m:', '  for j in 1..n:', '    if A[i]==B[j]: dp[i][j]=dp[i-1][j-1]+1', '    else: dp[i][j]=max(dp[i-1][j], dp[i][j-1])'];
  const push = (p) => steps.push(mkStep(p, stats));
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  push({ array: [], view: 'table', viewData: { rows: dp, rowLabels: ['∅', ...a], colLabels: ['∅', ...b], cur: [0, 0] }, vars: { A: a.join(''), B: b.join('') }, codeLine: 0, desc: 'Init LCS table' });
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      stats.comparisons++;
      if (a[i - 1] === b[j - 1]) { dp[i][j] = dp[i - 1][j - 1] + 1; stats.assignments++; push({ array: [], view: 'table', viewData: { rows: dp.map((r) => r.slice()), rowLabels: ['∅', ...a], colLabels: ['∅', ...b], cur: [i, j], prev: [[i - 1, j - 1]] }, vars: { i, j, match: a[i - 1] }, codeLine: 2, desc: `Match '${a[i - 1]}' → dp=${dp[i][j]}` }); }
      else { dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]); stats.assignments++; push({ array: [], view: 'table', viewData: { rows: dp.map((r) => r.slice()), rowLabels: ['∅', ...a], colLabels: ['∅', ...b], cur: [i, j], prev: [[i - 1, j], [i, j - 1]] }, vars: { i, j }, codeLine: 3, desc: `No match → max(${dp[i - 1][j]}, ${dp[i][j - 1]})=${dp[i][j]}` }); }
    }
  }
  push({ array: [], view: 'table', viewData: { rows: dp.map((r) => r.slice()), rowLabels: ['∅', ...a], colLabels: ['∅', ...b], cur: [m, n], done: true }, vars: { result: dp[m][n] }, codeLine: 3, desc: `LCS length = ${dp[m][n]}` });
  return { steps, code };
}

// ── 0/1 Knapsack ──
export function knapsack(input, opts = {}) {
  const stats = newStats(); const steps = [];
  const W = opts.W ?? 7;
  const items = opts.items ?? [{ w: 1, v: 1 }, { w: 3, v: 4 }, { w: 4, v: 5 }, { w: 5, v: 7 }];
  const code = ['for i in 1..n:', '  for w in 0..W:', '    if items[i].w <= w:', '      dp[i][w] = max(dp[i-1][w], dp[i-1][w-wi]+vi)', '    else: dp[i][w] = dp[i-1][w]'];
  const push = (p) => steps.push(mkStep(p, stats));
  const n = items.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(W + 1).fill(0));
  push({ array: [], view: 'table', viewData: { rows: dp, rowLabels: ['∅', ...items.map((it) => `w${it.w},v${it.v}`)], colLabels: Array.from({ length: W + 1 }, (_, i) => i), cur: [0, 0] }, vars: { W }, codeLine: 0, desc: 'Init knapsack table' });
  for (let i = 1; i <= n; i++) {
    for (let w = 0; w <= W; w++) {
      if (items[i - 1].w <= w) { dp[i][w] = Math.max(dp[i - 1][w], dp[i - 1][w - items[i - 1].w] + items[i - 1].v); stats.comparisons++; push({ array: [], view: 'table', viewData: { rows: dp.map((r) => r.slice()), rowLabels: ['∅', ...items.map((it) => `w${it.w},v${it.v}`)], colLabels: Array.from({ length: W + 1 }, (_, k) => k), cur: [i, w], prev: [[i - 1, w], [i - 1, w - items[i - 1].w]] }, vars: { i, w, val: dp[i][w] }, codeLine: 3, desc: `Item ${i}: dp=${dp[i][w]}` }); }
      else { dp[i][w] = dp[i - 1][w]; push({ array: [], view: 'table', viewData: { rows: dp.map((r) => r.slice()), rowLabels: ['∅', ...items.map((it) => `w${it.w},v${it.v}`)], colLabels: Array.from({ length: W + 1 }, (_, k) => k), cur: [i, w], prev: [[i - 1, w]] }, vars: { i, w }, codeLine: 4, desc: `Too heavy → carry ${dp[i][w]}` }); }
    }
  }
  push({ array: [], view: 'table', viewData: { rows: dp.map((r) => r.slice()), rowLabels: ['∅', ...items.map((it) => `w${it.w},v${it.v}`)], colLabels: Array.from({ length: W + 1 }, (_, k) => k), cur: [n, W], done: true }, vars: { result: dp[n][W] }, codeLine: 4, desc: `Max value = ${dp[n][W]}` });
  return { steps, code };
}

// ── Coin Change (min coins) ──
export function coinChange(input, opts = {}) {
  const stats = newStats(); const steps = [];
  const coins = opts.coins ?? [1, 3, 4];
  const amount = opts.amount ?? 6;
  const code = ['dp[0]=0', 'for a in 1..amount:', '  for c in coins:', '    if c<=a: dp[a]=min(dp[a], dp[a-c]+1)'];
  const push = (p) => steps.push(mkStep(p, stats));
  const dp = new Array(amount + 1).fill(Infinity); dp[0] = 0;
  push({ array: dp, view: 'table', viewData: { rows: [dp.slice()], cols: ['amount', 'coins'], cur: [0, 0] }, vars: { coins: coins.join(','), amount }, codeLine: 0, desc: 'Init dp[0]=0' });
  for (let a = 1; a <= amount; a++) {
    for (const c of coins) {
      if (c <= a) { stats.comparisons++; if (dp[a - c] + 1 < dp[a]) { dp[a] = dp[a - c] + 1; stats.assignments++; push({ array: dp, view: 'table', viewData: { rows: [dp.slice()], cols: ['amount', 'coins'], cur: [0, a], prev: [[0, a - c]] }, vars: { a, c, val: dp[a] }, codeLine: 2, desc: `Use coin ${c}: dp[${a}]=${dp[a]}` }); } }
    }
  }
  push({ array: dp, view: 'table', viewData: { rows: [dp.slice()], cols: ['amount', 'coins'], cur: [0, amount], done: true }, vars: { result: dp[amount] }, codeLine: 3, desc: `Min coins for ${amount} = ${dp[amount]}` });
  return { steps, code };
}

export const dpAlgorithms = [
  { id: 'fibDP', name: 'Fibonacci DP', category: 'Dynamic Programming', view: 'table', inputType: 'array', generate: fibDP, description: 'Bottom-up Fibonacci using a 1D table.', complexity: { best: 'O(n)', avg: 'O(n)', worst: 'O(n)', space: 'O(n)' }, stable: true, inplace: true, useCases: 'Teaching DP', advantages: 'No recomputation', disadvantages: 'O(n) space' },
  { id: 'lcs', name: 'Longest Common Subsequence', category: 'Dynamic Programming', view: 'table', inputType: 'string', generate: lcs, description: 'Finds the LCS length of two strings with a 2D table.', complexity: { best: 'O(nm)', avg: 'O(nm)', worst: 'O(nm)', space: 'O(nm)' }, stable: true, inplace: false, useCases: 'Diff tools', advantages: 'Exact', disadvantages: 'O(nm) space' },
  { id: 'knapsack', name: '0/1 Knapsack', category: 'Dynamic Programming', view: 'table', inputType: 'none', generate: knapsack, description: 'Maximizes value under a weight limit using a 2D table.', complexity: { best: 'O(nW)', avg: 'O(nW)', worst: 'O(nW)', space: 'O(nW)' }, stable: true, inplace: false, useCases: 'Resource allocation', advantages: 'Optimal', disadvantages: 'Pseudo-polynomial' },
  { id: 'coinChange', name: 'Coin Change (min coins)', category: 'Dynamic Programming', view: 'table', inputType: 'none', generate: coinChange, description: 'Minimum coins to make an amount using bottom-up DP.', complexity: { best: 'O(na)', avg: 'O(na)', worst: 'O(na)', space: 'O(a)' }, stable: true, inplace: false, useCases: 'Making change', advantages: 'Optimal', disadvantages: 'Pseudo-polynomial' },
];