import { mkStep, newStats } from '../stepUtils';

// Additional dynamic-programming algorithms. View type: 'table'.

function twoWords(input) {
  const parts = String(input ?? '').trim().split(/[\s,]+/).filter(Boolean);
  const ok = (s) => !!s && /^[A-Za-z]+$/.test(s);
  return [
    (ok(parts[0]) ? parts[0] : 'kitten').slice(0, 9),
    (ok(parts[1]) ? parts[1] : 'sitting').slice(0, 9),
  ];
}

// ── Edit Distance (Levenshtein) ──
export function editDistance(input) {
  const stats = newStats(); const steps = [];
  const [sa, sb] = twoWords(input);
  const m = sa.length, n = sb.length;
  const rowLabels = ['∅', ...sa.split('')];
  const colLabels = ['∅', ...sb.split('')];

  const code = [
    'dp[i][0] = i; dp[0][j] = j',
    'for i in 1..m: for j in 1..n:',
    '  if A[i-1] == B[j-1]: dp[i][j] = dp[i-1][j-1]',
    '  else: dp[i][j] = 1 + min(delete, insert, replace)',
    'answer = dp[m][n]',
  ];
  const push = (p) => steps.push(mkStep(p, stats));
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  const snap = (extra) => ({ rows: dp.map((r) => r.slice()), rowLabels, colLabels, ...extra });

  push({ array: [], view: 'table', viewData: snap({ cur: [0, 0] }), vars: { A: sa, B: sb }, codeLine: 0, desc: `Base row and column set for "${sa}" → "${sb}"` });

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      stats.comparisons++;
      if (sa[i - 1] === sb[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1]; stats.assignments++;
        push({ array: [], view: 'table', viewData: snap({ cur: [i, j], prev: [[i - 1, j - 1]] }), vars: { i, j, match: sa[i - 1] }, codeLine: 2, desc: `'${sa[i - 1]}' = '${sb[j - 1]}' — copy the diagonal (${dp[i][j]})` });
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]); stats.assignments++;
        push({ array: [], view: 'table', viewData: snap({ cur: [i, j], prev: [[i - 1, j], [i, j - 1], [i - 1, j - 1]] }), vars: { i, j, cost: dp[i][j] }, codeLine: 3, desc: `Mismatch — 1 + min(${dp[i - 1][j]}, ${dp[i][j - 1]}, ${dp[i - 1][j - 1]}) = ${dp[i][j]}` });
      }
    }
  }

  push({ array: [], view: 'table', viewData: snap({ cur: [m, n], done: true }), vars: { result: dp[m][n] }, codeLine: 4, desc: `Edit distance "${sa}" → "${sb}" = ${dp[m][n]}` });
  return { steps, code };
}

// ── Longest Increasing Subsequence ──
export function lis(input) {
  const stats = newStats(); const steps = [];
  const arr = (Array.isArray(input) && input.length >= 2 ? input : [10, 9, 2, 5, 3, 7, 101, 18]).slice(0, 12);
  const n = arr.length;
  const dp = new Array(n).fill(1);
  const prev = new Array(n).fill(-1);

  const code = [
    'dp[i] = 1 for every element',
    'for i in 0..n-1:',
    '  for j in 0..i-1:',
    '    if arr[j] < arr[i] and dp[j]+1 > dp[i]: dp[i] = dp[j]+1',
    'best = argmax(dp); walk prev[] back to the start',
  ];
  const push = (p) => steps.push(mkStep(p, stats));
  const table = (cur, prevCells, extra) => ({ rows: [dp.slice()], rowLabels: ['dp'], colLabels: arr, cur, prev: prevCells, ...extra });

  push({ array: [], view: 'table', viewData: table([0, 0], []), vars: { n }, codeLine: 0, desc: 'dp[i] = length of the longest increasing subsequence ending at index i' });

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      stats.comparisons++;
      if (arr[j] < arr[i] && dp[j] + 1 > dp[i]) {
        dp[i] = dp[j] + 1; prev[i] = j; stats.assignments++;
        push({ array: [], view: 'table', viewData: table([0, i], [[0, j]]), vars: { i, j, cmp: `${arr[j]} < ${arr[i]}`, dp: dp[i] }, codeLine: 3, desc: `${arr[j]} < ${arr[i]} → dp[${i}] = ${dp[i]}` });
      }
    }
  }

  let best = 0;
  for (let i = 1; i < n; i++) if (dp[i] > dp[best]) best = i;
  const idx = []; let cur = best;
  while (cur >= 0) { idx.unshift(cur); cur = prev[cur]; }

  push({ array: [], view: 'table', viewData: table([0, best], [], { done: true }), vars: { length: dp[best] }, codeLine: 4, desc: `Longest increasing subsequence length = ${dp[best]}` });
  push({ array: arr.slice(), view: 'bar', hl: { sorted: idx, current: best }, vars: { subsequence: idx.map((i) => arr[i]).join(' → ') }, codeLine: 4, desc: `Subsequence: ${idx.map((i) => arr[i]).join(' → ')}` });
  return { steps, code };
}

// ── Longest Palindromic Subsequence ──
export function longestPalindromeSubseq(input) {
  const stats = newStats(); const steps = [];
  const clean = String(input ?? '').trim();
  const s = (/^[A-Za-z]{2,}$/.test(clean) ? clean : 'BBABCBCAB').slice(0, 9);
  const ch = s.split('');
  const n = ch.length;

  const code = [
    'dp[i][i] = 1  for every single character',
    'for len in 2..n:',
    '  for i in 0..n-len:',
    '    j = i+len-1',
    '    if ch[i] == ch[j]: dp[i][j] = dp[i+1][j-1] + 2',
    '    else: dp[i][j] = max(dp[i+1][j], dp[i][j-1])',
  ];
  const push = (p) => steps.push(mkStep(p, stats));
  const dp = Array.from({ length: n }, () => new Array(n).fill(0));
  const snap = (extra) => ({ rows: dp.map((r) => r.slice()), rowLabels: ch, colLabels: ch, ...extra });

  for (let i = 0; i < n; i++) dp[i][i] = 1;
  push({ array: [], view: 'table', viewData: snap({ cur: [0, n - 1] }), vars: { string: s }, codeLine: 0, desc: `Single characters are palindromes — starting table for "${s}"` });

  for (let len = 2; len <= n; len++) {
    for (let i = 0; i + len - 1 < n; i++) {
      const j = i + len - 1;
      stats.comparisons++;
      if (ch[i] === ch[j]) {
        dp[i][j] = (len === 2 ? 0 : dp[i + 1][j - 1]) + 2; stats.assignments++;
        push({ array: [], view: 'table', viewData: snap({ cur: [i, j], prev: len === 2 ? [] : [[i + 1, j - 1]] }), vars: { i, j, len }, codeLine: 4, desc: `'${ch[i]}' = '${ch[j]}' — wrap the inner palindrome (${dp[i][j]})` });
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j - 1]); stats.assignments++;
        push({ array: [], view: 'table', viewData: snap({ cur: [i, j], prev: [[i + 1, j], [i, j - 1]] }), vars: { i, j, len }, codeLine: 5, desc: `'${ch[i]}' ≠ '${ch[j]}' — take the better of the two inner ranges (${dp[i][j]})` });
      }
    }
  }

  const build = (i, j) => {
    if (i > j) return '';
    if (i === j) return ch[i];
    if (ch[i] === ch[j]) return ch[i] + build(i + 1, j - 1) + ch[j];
    return dp[i + 1][j] >= dp[i][j - 1] ? build(i + 1, j) : build(i, j - 1);
  };

  push({ array: [], view: 'table', viewData: snap({ cur: [0, n - 1], done: true }), vars: { length: dp[0][n - 1], palindrome: build(0, n - 1) }, codeLine: 6, desc: `Longest palindromic subsequence = "${build(0, n - 1)}" (${dp[0][n - 1]})` });
  return { steps, code };
}

// ── Rod Cutting ──
export function rodCutting() {
  const stats = newStats(); const steps = [];
  const prices = [1, 5, 8, 9, 10, 17, 17, 20];
  const n = prices.length;
  const dp = new Array(n + 1).fill(0);
  const choice = new Array(n + 1).fill(0);

  const code = [
    'prices = [1, 5, 8, 9, 10, 17, 17, 20]   # length 1..8',
    'dp[0] = 0',
    'for len in 1..n:',
    '  for cut in 1..len:',
    '    if prices[cut-1] + dp[len-cut] > dp[len]: dp[len] = that; choice[len] = cut',
    'walk choice[] back to recover the cuts',
  ];
  const push = (p) => steps.push(mkStep(p, stats));
  const snap = (cur, prevCells, extra) => ({ rows: [dp.slice()], rowLabels: ['best'], colLabels: Array.from({ length: n + 1 }, (_, i) => i), cur: [0, cur], prev: prevCells, ...extra });

  push({ array: [], view: 'table', viewData: snap(0, []), vars: { n }, codeLine: 1, desc: 'dp[len] = best revenue for a rod of that length' });

  for (let len = 1; len <= n; len++) {
    for (let cut = 1; cut <= len; cut++) {
      stats.comparisons++;
      const candidate = prices[cut - 1] + dp[len - cut];
      if (candidate > dp[len]) {
        dp[len] = candidate; choice[len] = cut; stats.assignments++;
        push({ array: [], view: 'table', viewData: snap(len, [[0, len - cut]]), vars: { len, cut, gain: candidate }, codeLine: 4, desc: `Cut ${cut} + best of ${len - cut} → ${candidate}` });
      }
    }
  }

  const cuts = []; let rem = n; let guard = 0;
  while (rem > 0 && guard++ < n) { cuts.push(choice[rem]); rem -= choice[rem]; }

  push({ array: [], view: 'table', viewData: snap(n, [], { done: true }), vars: { revenue: dp[n], cuts: cuts.join(' + ') }, codeLine: 5, desc: `Best revenue for length ${n} = ${dp[n]} (cuts ${cuts.join(' + ')})` });
  return { steps, code };
}

export const dpAdvancedAlgorithms = [
  {
    id: 'editDistance', name: 'Edit Distance (Levenshtein)', category: 'Dynamic Programming', view: 'table',
    inputType: 'string', generate: editDistance,
    description: 'Fewest insertions, deletions and replacements turning one word into another.',
    complexity: { best: 'O(nm)', avg: 'O(nm)', worst: 'O(nm)', space: 'O(nm)' },
    stable: true, inplace: false,
    useCases: 'Spell-check, fuzzy search, diffing', advantages: 'Exact answer', disadvantages: 'Quadratic table',
  },
  {
    id: 'lis', name: 'Longest Increasing Subsequence', category: 'Dynamic Programming', view: 'table',
    inputType: 'array', generate: lis,
    description: 'Builds the longest strictly increasing subsequence using a 1D table.',
    complexity: { best: 'O(n²)', avg: 'O(n²)', worst: 'O(n²)', space: 'O(n)' },
    stable: true, inplace: true,
    useCases: 'Trend analysis, patience sorting', advantages: 'Simple to follow', disadvantages: 'O(n log n) solution is faster',
  },
  {
    id: 'lpsDP', name: 'Longest Palindromic Subsequence', category: 'Dynamic Programming', view: 'table',
    inputType: 'string', generate: longestPalindromeSubseq,
    description: 'Finds the longest subsequence of a string that reads the same both ways.',
    complexity: { best: 'O(n²)', avg: 'O(n²)', worst: 'O(n²)', space: 'O(n²)' },
    stable: true, inplace: false,
    useCases: 'Text analysis, bioinformatics', advantages: 'Handles gaps', disadvantages: 'Only subsequences, not substrings',
  },
  {
    id: 'rodCutting', name: 'Rod Cutting', category: 'Dynamic Programming', view: 'table',
    inputType: 'none', generate: rodCutting,
    description: 'Maximises revenue by choosing the best cuts of a rod for a given price list.',
    complexity: { best: 'O(n²)', avg: 'O(n²)', worst: 'O(n²)', space: 'O(n)' },
    stable: true, inplace: true,
    useCases: 'Resource splitting, pricing', advantages: 'Optimal split', disadvantages: 'Assumes a fixed price list',
  },
];