import { mkStep, newStats } from '../stepUtils.js';

function arr(a) { return a.slice(); }
function range(a, b) { return Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i); }

// ── Array Traversal ──
export function traversal(input) {
  const a = arr(input); const stats = newStats(); const steps = [];
  const code = ['for i in 0..n-1:', '  visit arr[i]'];
  const push = (p) => steps.push(mkStep(p, stats));
  for (let i = 0; i < a.length; i++) { stats.accesses++; push({ array: arr(a), hl: { current: i, visited: range(0, i) }, vars: { i }, codeLine: 1, desc: `Visit A[${i}] = ${a[i]}` }); }
  push({ array: arr(a), hl: { sorted: range(0, a.length) }, vars: {}, codeLine: 0, desc: 'Traversal complete' });
  return { steps, code };
}

// ── Array Reversal ──
export function reversal(input) {
  const a = arr(input); const stats = newStats(); const steps = [];
  const code = ['l=0; r=n-1', 'while l<r:', '  swap(arr[l], arr[r]); l++; r--'];
  const push = (p) => steps.push(mkStep(p, stats));
  let l = 0, r = a.length - 1;
  while (l < r) {
    push({ array: arr(a), hl: { compare: [l, r] }, vars: { l, r }, codeLine: 2, desc: `Swap A[${l}]=${a[l]} and A[${r}]=${a[r]}` });
    [a[l], a[r]] = [a[r], a[l]]; stats.swaps++;
    push({ array: arr(a), hl: { swap: [l, r], sorted: range(0, l).concat(range(r + 1, a.length)) }, vars: { l, r }, codeLine: 2, desc: `Reversed` });
    l++; r--;
  }
  push({ array: arr(a), hl: { sorted: range(0, a.length) }, vars: {}, codeLine: 0, desc: 'Reversed' });
  return { steps, code };
}

// ── Array Rotation (left by k) ──
export function rotation(input, opts = {}) {
  const a = arr(input); const stats = newStats(); const steps = [];
  const k = ((opts.k ?? 2) % a.length + a.length) % a.length;
  const code = ['k = k % n', 'reverse(0, k-1)', 'reverse(k, n-1)', 'reverse(0, n-1)'];
  const push = (p) => steps.push(mkStep(p, stats));
  function rev(lo, hi) { while (lo < hi) { [a[lo], a[hi]] = [a[hi], a[lo]]; stats.swaps++; push({ array: arr(a), hl: { swap: [lo, hi] }, vars: { k, lo, hi }, codeLine: 1, desc: `Reverse A[${lo}] and A[${hi}]` }); lo++; hi--; } }
  push({ array: arr(a), vars: { k }, codeLine: 0, desc: `Rotate left by ${k}` });
  rev(0, k - 1); push({ array: arr(a), hl: { active: range(0, k) }, vars: { k }, codeLine: 1, desc: `Reverse first part` });
  rev(k, a.length - 1); push({ array: arr(a), hl: { active: range(k, a.length) }, vars: { k }, codeLine: 2, desc: `Reverse second part` });
  rev(0, a.length - 1);
  push({ array: arr(a), hl: { sorted: range(0, a.length) }, vars: { k }, codeLine: 0, desc: `Rotated left by ${k}` });
  return { steps, code };
}

// ── Prefix Sum ──
export function prefixSum(input) {
  const a = arr(input); const stats = newStats(); const steps = [];
  const code = ['ps[0] = arr[0]', 'for i in 1..n-1: ps[i] = ps[i-1] + arr[i]'];
  const push = (p) => steps.push(mkStep(p, stats));
  const ps = new Array(a.length);
  ps[0] = a[0]; stats.assignments++;
  push({ array: arr(ps), hl: { active: [0] }, vars: { i: 0, sum: ps[0] }, codeLine: 0, desc: `ps[0] = ${a[0]}` });
  for (let i = 1; i < a.length; i++) { ps[i] = ps[i - 1] + a[i]; stats.assignments++; stats.accesses++; push({ array: arr(ps), hl: { current: i, active: [i - 1] }, vars: { i, sum: ps[i] }, codeLine: 1, desc: `ps[${i}] = ps[${i - 1}] + A[${i}] = ${ps[i]}` }); }
  push({ array: arr(ps), hl: { sorted: range(0, a.length) }, vars: {}, codeLine: 0, desc: 'Prefix sums computed' });
  return { steps, code };
}

// ── Kadane's Algorithm (max subarray) ──
export function kadane(input) {
  const a = arr(input); const stats = newStats(); const steps = [];
  const code = ['best = arr[0]; cur = arr[0]', 'for i in 1..n-1:', '  cur = max(arr[i], cur+arr[i])', '  best = max(best, cur)'];
  const push = (p) => steps.push(mkStep(p, stats));
  let best = a[0], cur = a[0], bestL = 0, bestR = 0, curL = 0;
  push({ array: arr(a), hl: { active: [0] }, vars: { best, cur }, codeLine: 0, desc: `best = cur = ${a[0]}` });
  for (let i = 1; i < a.length; i++) {
    stats.comparisons++;
    if (a[i] > cur + a[i]) { cur = a[i]; curL = i; } else { cur = cur + a[i]; }
    push({ array: arr(a), hl: { current: i, range: [curL, i] }, vars: { i, cur, best }, codeLine: 2, desc: `cur = max(${a[i]}, ${cur}) = ${cur}` });
    stats.comparisons++;
    if (cur > best) { best = cur; bestL = curL; bestR = i; push({ array: arr(a), hl: { swap: [bestL, bestR], range: [bestL, bestR] }, vars: { i, cur, best, bestL, bestR }, codeLine: 3, desc: `New best = ${best} over [${bestL}..${bestR}]` }); }
  }
  push({ array: arr(a), hl: { found: range(bestL, bestR + 1) }, vars: { best, bestL, bestR }, codeLine: 0, desc: `Max subarray sum = ${best}` });
  return { steps, code };
}

// ── Two-Pointer (pair sum to target) ──
export function twoPointer(input, opts = {}) {
  const a = arr(input).sort((x, y) => x - y); const stats = newStats(); const steps = [];
  const target = opts.target ?? (a[0] + a[a.length - 1]);
  const code = ['l=0; r=n-1', 'while l<r:', '  s = arr[l]+arr[r]', '  if s==target: return (l,r)', '  elif s<target: l++', '  else: r--'];
  const push = (p) => steps.push(mkStep(p, stats));
  let l = 0, r = a.length - 1;
  push({ array: arr(a), vars: { target, l, r }, codeLine: 0, desc: `Find pair summing to ${target}` });
  while (l < r) {
    const s = a[l] + a[r]; stats.comparisons++;
    push({ array: arr(a), hl: { compare: [l, r] }, vars: { l, r, s, target }, codeLine: 2, desc: `A[${l}]+A[${r}] = ${s}` });
    if (s === target) { push({ array: arr(a), hl: { found: [l, r] }, vars: { l, r, s, target }, codeLine: 3, desc: `Found pair (${a[l]}, ${a[r]})` }); return { steps, code }; }
    else if (s < target) { l++; push({ array: arr(a), hl: { current: l, eliminated: [0, l] }, vars: { l, r, target }, codeLine: 4, desc: `Sum too small → move left` }); }
    else { r--; push({ array: arr(a), hl: { current: r, eliminated: [r + 1, a.length] }, vars: { l, r, target }, codeLine: 5, desc: `Sum too big → move right` }); }
  }
  push({ array: arr(a), hl: { eliminated: [0, a.length] }, vars: { target }, codeLine: 6, desc: `No pair found` });
  return { steps, code };
}

// ── Sliding Window (max sum subarray of size k) ──
export function slidingWindow(input, opts = {}) {
  const a = arr(input); const stats = newStats(); const steps = [];
  const k = opts.k ?? 3;
  const code = ['window = sum(arr[0..k-1])', 'for i in k..n-1:', '  window += arr[i] - arr[i-k]', '  best = max(best, window)'];
  const push = (p) => steps.push(mkStep(p, stats));
  let win = 0; for (let i = 0; i < k && i < a.length; i++) win += a[i];
  let best = win, bestStart = 0;
  push({ array: arr(a), hl: { range: [0, Math.min(k, a.length) - 1] }, vars: { k, window: win, best }, codeLine: 0, desc: `Initial window sum = ${win}` });
  for (let i = k; i < a.length; i++) {
    win += a[i] - a[i - k]; stats.accesses += 2;
    push({ array: arr(a), hl: { range: [i - k + 1, i] }, vars: { i, k, window: win, best }, codeLine: 2, desc: `Slide: +A[${i}] -A[${i - k}] → ${win}` });
    if (win > best) { best = win; bestStart = i - k + 1; push({ array: arr(a), hl: { swap: [bestStart, bestStart + k - 1], range: [bestStart, bestStart + k - 1] }, vars: { best, bestStart }, codeLine: 3, desc: `New best = ${best}` }); }
  }
  push({ array: arr(a), hl: { found: range(bestStart, bestStart + k) }, vars: { best, bestStart, k }, codeLine: 0, desc: `Max window sum = ${best}` });
  return { steps, code };
}

// ── Dutch National Flag (0,1,2 sort) ──
export function dutchFlag(input) {
  const a = arr(input).map((v) => Math.max(0, Math.min(2, Math.floor(v / 4)))); const stats = newStats(); const steps = [];
  const code = ['lo=0; mid=0; hi=n-1', 'while mid<=hi:', '  if arr[mid]==0: swap(lo,mid); lo++; mid++', '  elif arr[mid]==1: mid++', '  else: swap(mid,hi); hi--'];
  const push = (p) => steps.push(mkStep(p, stats));
  let lo = 0, mid = 0, hi = a.length - 1;
  push({ array: arr(a), hl: { active: [lo, mid, hi] }, vars: { lo, mid, hi }, codeLine: 0, desc: `Partition into 0s, 1s, 2s` });
  while (mid <= hi) {
    stats.comparisons++;
    push({ array: arr(a), hl: { current: mid, active: [lo, hi] }, vars: { lo, mid, hi }, codeLine: 2, desc: `A[${mid}]=${a[mid]}` });
    if (a[mid] === 0) { [a[lo], a[mid]] = [a[mid], a[lo]]; stats.swaps++; lo++; mid++; push({ array: arr(a), hl: { swap: [lo - 1, mid - 1] }, vars: { lo, mid, hi }, codeLine: 2, desc: `0 → swap to left` }); }
    else if (a[mid] === 1) { mid++; push({ array: arr(a), hl: { current: mid - 1 }, vars: { lo, mid, hi }, codeLine: 3, desc: `1 → keep` }); }
    else { [a[mid], a[hi]] = [a[hi], a[mid]]; stats.swaps++; hi--; push({ array: arr(a), hl: { swap: [mid, hi + 1] }, vars: { lo, mid, hi }, codeLine: 4, desc: `2 → swap to right` }); }
  }
  push({ array: arr(a), hl: { sorted: range(0, a.length) }, vars: {}, codeLine: 0, desc: 'Partitioned' });
  return { steps, code };
}

// ── Move Zeros to end ──
export function moveZeros(input) {
  const a = arr(input); const stats = newStats(); const steps = [];
  const code = ['pos = 0', 'for i in 0..n-1:', '  if arr[i] != 0: swap(arr[pos], arr[i]); pos++'];
  const push = (p) => steps.push(mkStep(p, stats));
  let pos = 0;
  push({ array: arr(a), vars: { pos }, codeLine: 0, desc: `Move zeros to the end` });
  for (let i = 0; i < a.length; i++) {
    stats.comparisons++;
    push({ array: arr(a), hl: { current: i, active: [pos] }, vars: { i, pos }, codeLine: 2, desc: `A[${i}]=${a[i]}` });
    if (a[i] !== 0) { if (i !== pos) { [a[pos], a[i]] = [a[i], a[pos]]; stats.swaps++; push({ array: arr(a), hl: { swap: [pos, i] }, vars: { i, pos }, codeLine: 2, desc: `Swap to pos ${pos}` }); } pos++; }
  }
  push({ array: arr(a), hl: { sorted: range(0, a.length) }, vars: { pos }, codeLine: 0, desc: 'Zeros moved' });
  return { steps, code };
}

// ── Remove Duplicates (sorted) ──
export function removeDuplicates(input) {
  const a = arr(input).sort((x, y) => x - y); const stats = newStats(); const steps = [];
  const code = ['w = 1', 'for r in 1..n-1:', '  if arr[r] != arr[w-1]: arr[w]=arr[r]; w++', 'return arr[0..w]'];
  const push = (p) => steps.push(mkStep(p, stats));
  let w = 1;
  push({ array: arr(a), vars: { w }, codeLine: 0, desc: `Remove duplicates in place` });
  for (let r = 1; r < a.length; r++) {
    stats.comparisons++;
    push({ array: arr(a), hl: { current: r, active: [w - 1] }, vars: { r, w }, codeLine: 2, desc: `Compare A[${r}]=${a[r]} with A[${w - 1}]=${a[w - 1]}` });
    if (a[r] !== a[w - 1]) { a[w] = a[r]; stats.assignments++; w++; push({ array: arr(a), hl: { swap: [w - 1, r], sorted: range(0, w) }, vars: { r, w }, codeLine: 2, desc: `Keep ${a[r]} at ${w - 1}` }); }
  }
  push({ array: arr(a), hl: { sorted: range(0, w) }, vars: { w }, codeLine: 0, desc: `${w} unique values` });
  return { steps, code };
}

// ── Two Sum (hash) ──
export function twoSum(input, opts = {}) {
  const a = arr(input); const stats = newStats(); const steps = [];
  const target = opts.target ?? (a[0] + a[a.length - 1]);
  const code = ['seen = {}', 'for i in 0..n-1:', '  need = target - arr[i]', '  if need in seen: return (seen[need], i)', '  seen[arr[i]] = i'];
  const push = (p) => steps.push(mkStep(p, stats));
  const seen = {};
  push({ array: arr(a), vars: { target }, codeLine: 0, desc: `Find indices summing to ${target}` });
  for (let i = 0; i < a.length; i++) {
    const need = target - a[i];
    push({ array: arr(a), hl: { current: i }, vars: { i, need, target, seen: Object.keys(seen).join(',') }, codeLine: 2, desc: `Need ${need}` });
    if (seen[need] !== undefined) { stats.comparisons++; push({ array: arr(a), hl: { found: [seen[need], i] }, vars: { i, need, target }, codeLine: 3, desc: `Found: A[${seen[need]}]+A[${i}] = ${target}` }); return { steps, code }; }
    seen[a[i]] = i; push({ array: arr(a), hl: { active: [i] }, vars: { i, seen: Object.keys(seen).join(',') }, codeLine: 4, desc: `Remember A[${i}]=${a[i]}` });
  }
  push({ array: arr(a), hl: { eliminated: [0, a.length] }, vars: { target }, codeLine: 4, desc: `No pair found` });
  return { steps, code };
}

// ── Missing Number (0..n) ──
export function missingNumber(input) {
  const a = arr(input); const stats = newStats(); const steps = [];
  const n = a.length;
  const code = ['expected = n*(n+1)//2', 'actual = sum(arr)', 'return expected - actual'];
  const push = (p) => steps.push(mkStep(p, stats));
  const expected = (n * (n + 1)) >> 1;
  let actual = 0;
  for (let i = 0; i < n; i++) { actual += a[i]; stats.accesses++; push({ array: arr(a), hl: { current: i }, vars: { i, actual, expected }, codeLine: 1, desc: `Sum so far = ${actual}` }); }
  const missing = expected - actual;
  push({ array: arr(a), hl: { found: [missing] }, vars: { expected, actual, missing }, codeLine: 2, desc: `Missing number = ${missing}` });
  return { steps, code };
}

// ── Majority Element (Boyer-Moore) ──
export function majorityElement(input) {
  const a = arr(input); const stats = newStats(); const steps = [];
  const code = ['candidate = None; count = 0', 'for v in arr:', '  if count == 0: candidate = v', '  count += (v==candidate)*2-1', 'return candidate'];
  const push = (p) => steps.push(mkStep(p, stats));
  let cand = null, count = 0;
  push({ array: arr(a), vars: { candidate: cand, count }, codeLine: 0, desc: `Boyer-Moore majority vote` });
  for (let i = 0; i < a.length; i++) {
    if (count === 0) { cand = a[i]; push({ array: arr(a), hl: { current: i, active: [i] }, vars: { i, candidate: cand, count }, codeLine: 2, desc: `New candidate = ${cand}` }); }
    count += (a[i] === cand) ? 1 : -1;
    push({ array: arr(a), hl: { current: i }, vars: { i, candidate: cand, count }, codeLine: 3, desc: `count → ${count}` });
  }
  push({ array: arr(a), hl: { found: [a.indexOf(cand)] }, vars: { candidate: cand, count }, codeLine: 4, desc: `Majority = ${cand}` });
  return { steps, code };
}

export const arrayAlgorithms = [
  { id: 'traversal', name: 'Array Traversal', category: 'Arrays', view: 'bar', inputType: 'array', generate: traversal, description: 'Visit every element in order.', complexity: { best: 'O(n)', avg: 'O(n)', worst: 'O(n)', space: 'O(1)' }, stable: true, inplace: true, useCases: 'Reading data', advantages: 'Simple', disadvantages: 'Linear only' },
  { id: 'reversal', name: 'Array Reversal', category: 'Arrays', view: 'bar', inputType: 'array', generate: reversal, description: 'Reverse the array in place with two pointers.', complexity: { best: 'O(n)', avg: 'O(n)', worst: 'O(n)', space: 'O(1)' }, stable: true, inplace: true, useCases: 'Utility', advantages: 'In-place', disadvantages: '—' },
  { id: 'rotation', name: 'Array Rotation', category: 'Arrays', view: 'bar', inputType: 'array', needsK: true, generate: rotation, description: 'Rotate the array left by k using the reversal trick.', complexity: { best: 'O(n)', avg: 'O(n)', worst: 'O(n)', space: 'O(1)' }, stable: true, inplace: true, useCases: 'Circular buffers', advantages: 'In-place', disadvantages: '—' },
  { id: 'prefixSum', name: 'Prefix Sum', category: 'Arrays', view: 'bar', inputType: 'array', generate: prefixSum, description: 'Build a prefix-sum array for range queries.', complexity: { best: 'O(n)', avg: 'O(n)', worst: 'O(n)', space: 'O(n)' }, stable: true, inplace: false, useCases: 'Range sum queries', advantages: 'O(1) range sum', disadvantages: 'O(n) space' },
  { id: 'kadane', name: "Kadane's Algorithm", category: 'Arrays', view: 'bar', inputType: 'array', generate: kadane, description: 'Find the maximum-sum contiguous subarray in one pass.', complexity: { best: 'O(n)', avg: 'O(n)', worst: 'O(n)', space: 'O(1)' }, stable: true, inplace: true, useCases: 'Max subarray problem', advantages: 'Linear', disadvantages: '—' },
  { id: 'twoPointer', name: 'Two-Pointer (pair sum)', category: 'Arrays', view: 'bar', inputType: 'array', needsTarget: true, generate: twoPointer, description: 'Find a pair summing to target on sorted data.', complexity: { best: 'O(n)', avg: 'O(n)', worst: 'O(n)', space: 'O(1)' }, stable: true, inplace: true, useCases: 'Sorted pair problems', advantages: 'Linear, no hash', disadvantages: 'Needs sorted data' },
  { id: 'slidingWindow', name: 'Sliding Window (max sum, size k)', category: 'Arrays', view: 'bar', inputType: 'array', needsK: true, generate: slidingWindow, description: 'Find the max sum of any length-k window.', complexity: { best: 'O(n)', avg: 'O(n)', worst: 'O(n)', space: 'O(1)' }, stable: true, inplace: true, useCases: 'Fixed-size window queries', advantages: 'Linear', disadvantages: 'Fixed window size' },
  { id: 'dutchFlag', name: 'Dutch National Flag', category: 'Arrays', view: 'bar', inputType: 'array', generate: dutchFlag, description: 'Three-way partition into 0s, 1s, 2s in one pass.', complexity: { best: 'O(n)', avg: 'O(n)', worst: 'O(n)', space: 'O(1)' }, stable: true, inplace: true, useCases: '3-value partitioning', advantages: 'Linear, in-place', disadvantages: 'Only 3 values' },
  { id: 'moveZeros', name: 'Move Zeros', category: 'Arrays', view: 'bar', inputType: 'array', generate: moveZeros, description: 'Move all zeros to the end, keeping order.', complexity: { best: 'O(n)', avg: 'O(n)', worst: 'O(n)', space: 'O(1)' }, stable: true, inplace: true, useCases: 'Compaction', advantages: 'In-place', disadvantages: '—' },
  { id: 'removeDuplicates', name: 'Remove Duplicates (sorted)', category: 'Arrays', view: 'bar', inputType: 'array', generate: removeDuplicates, description: 'Remove duplicates in place on sorted data.', complexity: { best: 'O(n)', avg: 'O(n)', worst: 'O(n)', space: 'O(1)' }, stable: true, inplace: true, useCases: 'Dedup sorted arrays', advantages: 'In-place', disadvantages: 'Needs sorted data' },
  { id: 'twoSum', name: 'Two Sum (hash)', category: 'Arrays', view: 'bar', inputType: 'array', needsTarget: true, generate: twoSum, description: 'Find two indices whose values sum to target using a hash map.', complexity: { best: 'O(n)', avg: 'O(n)', worst: 'O(n)', space: 'O(n)' }, stable: true, inplace: true, useCases: 'Pair-sum problems', advantages: 'One pass', disadvantages: 'O(n) space' },
  { id: 'missingNumber', name: 'Missing Number', category: 'Arrays', view: 'bar', inputType: 'array', generate: missingNumber, description: 'Find the missing number in 0..n using the sum formula.', complexity: { best: 'O(n)', avg: 'O(n)', worst: 'O(n)', space: 'O(1)' }, stable: true, inplace: true, useCases: 'Missing-number puzzles', advantages: 'O(1) space', disadvantages: 'Risk of overflow' },
  { id: 'majorityElement', name: 'Majority Element (Boyer-Moore)', category: 'Arrays', view: 'bar', inputType: 'array', generate: majorityElement, description: 'Find the majority element with O(1) space.', complexity: { best: 'O(n)', avg: 'O(n)', worst: 'O(n)', space: 'O(1)' }, stable: true, inplace: true, useCases: 'Voting/majority', advantages: 'O(1) space', disadvantages: 'Needs a true majority' },
];