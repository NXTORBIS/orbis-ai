import { mkStep, newStats } from '../stepUtils.js';

function arr(a) { return a.slice(); }
function range(a, b) { return Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i); }

// ── Linear Search ──
export function linearSearch(input, opts = {}) {
  const a = arr(input); const stats = newStats(); const steps = [];
  const target = opts.target ?? a[Math.floor(a.length / 2)];
  const code = ['for i in 0..n-1:', '  if arr[i] == target: return i', 'return -1'];
  const push = (p) => steps.push(mkStep(p, stats));
  push({ array: arr(a), vars: { target }, codeLine: 0, desc: `Search for ${target}` });
  for (let i = 0; i < a.length; i++) {
    stats.comparisons++;
    push({ array: arr(a), hl: { current: i, eliminated: [0, i] }, vars: { i, target }, codeLine: 1, desc: `Compare A[${i}]=${a[i]} with target ${target}` });
    if (a[i] === target) { push({ array: arr(a), hl: { found: i }, vars: { i, target }, codeLine: 2, desc: `Found ${target} at index ${i}` }); return { steps, code }; }
  }
  push({ array: arr(a), hl: { eliminated: [0, a.length] }, vars: { target }, codeLine: 2, desc: `${target} not found` });
  return { steps, code };
}

// ── Binary Search ──
export function binarySearch(input, opts = {}) {
  const a = arr(input).sort((x, y) => x - y); const stats = newStats(); const steps = [];
  const target = opts.target ?? a[Math.floor(a.length / 2)];
  const code = ['lo=0; hi=n-1', 'while lo<=hi:', '  mid=(lo+hi)//2', '  if arr[mid]==target: return mid', '  elif arr[mid]<target: lo=mid+1', '  else: hi=mid-1', 'return -1'];
  const push = (p) => steps.push(mkStep(p, stats));
  push({ array: arr(a), vars: { target }, codeLine: 0, desc: `Binary search for ${target} (sorted)` });
  let lo = 0, hi = a.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    stats.comparisons++;
    push({ array: arr(a), hl: { current: mid, range: [lo, hi], eliminated: [0, lo] }, vars: { lo, hi, mid, target }, codeLine: 2, desc: `Check mid A[${mid}]=${a[mid]}` });
    if (a[mid] === target) { push({ array: arr(a), hl: { found: mid, range: [lo, hi] }, vars: { lo, hi, mid, target }, codeLine: 3, desc: `Found ${target} at index ${mid}` }); return { steps, code }; }
    else if (a[mid] < target) { push({ array: arr(a), hl: { eliminated: [lo, mid + 1], range: [mid + 1, hi] }, vars: { lo, hi, mid, target }, codeLine: 4, desc: `${a[mid]} < ${target} → search right` }); lo = mid + 1; }
    else { push({ array: arr(a), hl: { eliminated: [mid, hi + 1], range: [lo, mid - 1] }, vars: { lo, hi, mid, target }, codeLine: 5, desc: `${a[mid]} > ${target} → search left` }); hi = mid - 1; }
  }
  push({ array: arr(a), hl: { eliminated: [0, a.length] }, vars: { target }, codeLine: 6, desc: `${target} not found` });
  return { steps, code };
}

// ── Jump Search ──
export function jumpSearch(input, opts = {}) {
  const a = arr(input).sort((x, y) => x - y); const stats = newStats(); const steps = [];
  const target = opts.target ?? a[Math.floor(a.length / 2)];
  const code = ['step = sqrt(n); prev = 0', 'while arr[min(step,n)-1] < target:', '  prev = step; step += sqrt(n)', '  if prev >= n: return -1', 'linear search in [prev, step]'];
  const push = (p) => steps.push(mkStep(p, stats));
  const n = a.length; let step = Math.floor(Math.sqrt(n)), prev = 0;
  push({ array: arr(a), vars: { target, step, prev }, codeLine: 0, desc: `Jump search for ${target}, step=${step}` });
  while (prev < n && a[Math.min(step, n) - 1] < target) {
    stats.comparisons++;
    push({ array: arr(a), hl: { current: Math.min(step, n) - 1, range: [prev, Math.min(step, n) - 1] }, vars: { step, prev, target }, codeLine: 1, desc: `Jump to ${Math.min(step, n) - 1}: A=${a[Math.min(step, n) - 1]}` });
    prev = step; step += Math.floor(Math.sqrt(n));
    if (prev >= n) { push({ array: arr(a), hl: { eliminated: [0, n] }, vars: { target }, codeLine: 3, desc: `Not found` }); return { steps, code }; }
  }
  for (let i = prev; i < Math.min(step, n); i++) {
    stats.comparisons++;
    push({ array: arr(a), hl: { current: i, range: [prev, Math.min(step, n) - 1] }, vars: { i, target }, codeLine: 4, desc: `Linear scan A[${i}]=${a[i]}` });
    if (a[i] === target) { push({ array: arr(a), hl: { found: i }, vars: { i, target }, codeLine: 4, desc: `Found ${target} at ${i}` }); return { steps, code }; }
    if (a[i] > target) break;
  }
  push({ array: arr(a), hl: { eliminated: [0, n] }, vars: { target }, codeLine: 4, desc: `Not found` });
  return { steps, code };
}

// ── Interpolation Search ──
export function interpolationSearch(input, opts = {}) {
  const a = arr(input).sort((x, y) => x - y); const stats = newStats(); const steps = [];
  const target = opts.target ?? a[Math.floor(a.length / 2)];
  const code = ['lo=0; hi=n-1', 'while lo<=hi and target in range:', '  pos = lo + (target-arr[lo])*(hi-lo)/(arr[hi]-arr[lo])', '  compare arr[pos] with target', '  adjust lo/hi'];
  const push = (p) => steps.push(mkStep(p, stats));
  let lo = 0, hi = a.length - 1;
  push({ array: arr(a), vars: { target, lo, hi }, codeLine: 0, desc: `Interpolation search for ${target}` });
  while (lo <= hi && target >= a[lo] && target <= a[hi]) {
    let pos = lo + Math.floor(((target - a[lo]) * (hi - lo)) / Math.max(1, a[hi] - a[lo]));
    pos = Math.max(lo, Math.min(hi, pos));
    stats.comparisons++;
    push({ array: arr(a), hl: { current: pos, range: [lo, hi] }, vars: { lo, hi, pos, target }, codeLine: 2, desc: `Probe A[${pos}]=${a[pos]}` });
    if (a[pos] === target) { push({ array: arr(a), hl: { found: pos }, vars: { pos, target }, codeLine: 3, desc: `Found at ${pos}` }); return { steps, code }; }
    if (a[pos] < target) lo = pos + 1; else hi = pos - 1;
  }
  push({ array: arr(a), hl: { eliminated: [0, a.length] }, vars: { target }, codeLine: 4, desc: `Not found` });
  return { steps, code };
}

// ── Exponential Search ──
export function exponentialSearch(input, opts = {}) {
  const a = arr(input).sort((x, y) => x - y); const stats = newStats(); const steps = [];
  const target = opts.target ?? a[Math.floor(a.length / 2)];
  const code = ['if arr[0]==target: return 0', 'bound = 1', 'while bound<n and arr[bound]<target: bound*=2', 'binary search in [bound/2, min(bound,n-1)]'];
  const push = (p) => steps.push(mkStep(p, stats));
  push({ array: arr(a), vars: { target }, codeLine: 0, desc: `Exponential search for ${target}` });
  let bound = 1;
  while (bound < a.length && a[bound] < target) {
    stats.comparisons++;
    push({ array: arr(a), hl: { current: bound, range: [0, Math.min(bound, a.length - 1)] }, vars: { bound, target }, codeLine: 2, desc: `Check A[${bound}]=${a[bound]}` });
    bound *= 2;
  }
  let lo = Math.floor(bound / 2), hi = Math.min(bound, a.length - 1);
  push({ array: arr(a), hl: { range: [lo, hi] }, vars: { lo, hi, target }, codeLine: 3, desc: `Binary search in [${lo}, ${hi}]` });
  while (lo <= hi) {
    const mid = (lo + hi) >> 1; stats.comparisons++;
    push({ array: arr(a), hl: { current: mid, range: [lo, hi] }, vars: { lo, hi, mid, target }, codeLine: 3, desc: `Probe A[${mid}]=${a[mid]}` });
    if (a[mid] === target) { push({ array: arr(a), hl: { found: mid }, vars: { mid, target }, codeLine: 3, desc: `Found at ${mid}` }); return { steps, code }; }
    if (a[mid] < target) lo = mid + 1; else hi = mid - 1;
  }
  push({ array: arr(a), hl: { eliminated: [0, a.length] }, vars: { target }, codeLine: 3, desc: `Not found` });
  return { steps, code };
}

// ── Fibonacci Search ──
export function fibonacciSearch(input, opts = {}) {
  const a = arr(input).sort((x, y) => x - y); const stats = newStats(); const steps = [];
  const target = opts.target ?? a[Math.floor(a.length / 2)];
  const code = ['find smallest fibM >= n+1', 'offset = -1', 'while fibM > 1:', '  i = min(offset+fibM2, n-1)', '  if arr[i] < target: fibM=fibM1; offset=i', '  elif arr[i] > target: fibM=fibM2', '  else: return i'];
  const push = (p) => steps.push(mkStep(p, stats));
  const n = a.length;
  let fib2 = 0, fib1 = 1, fibM = 1;
  while (fibM < n) { fib2 = fib1; fib1 = fibM; fibM = fib1 + fib2; }
  let offset = -1;
  push({ array: arr(a), vars: { target, fibM, fib1, fib2, offset }, codeLine: 0, desc: `Fibonacci search for ${target}` });
  while (fibM > 1) {
    const i = Math.min(offset + fib2, n - 1);
    stats.comparisons++;
    push({ array: arr(a), hl: { current: i, range: [Math.max(0, offset + 1), Math.min(offset + fibM, n - 1)] }, vars: { i, fibM, fib1, fib2, offset, target }, codeLine: 3, desc: `Check A[${i}]=${a[i]}` });
    if (a[i] < target) { fibM = fib1; fib1 = fib2; fib2 = fibM - fib1; offset = i; push({ array: arr(a), hl: { eliminated: [Math.max(0, offset), i + 1] }, vars: { i, fibM, fib1, fib2, offset, target }, codeLine: 4, desc: `Go right` }); }
    else if (a[i] > target) { fibM = fib2; fib1 = fib1 - fib2; fib2 = fibM - fib1; push({ array: arr(a), hl: { eliminated: [i, Math.min(offset + fibM, n)] }, vars: { i, fibM, fib1, fib2, offset, target }, codeLine: 5, desc: `Go left` }); }
    else { push({ array: arr(a), hl: { found: i }, vars: { i, target }, codeLine: 6, desc: `Found at ${i}` }); return { steps, code }; }
  }
  if (fib1 && a[offset + 1] === target) { push({ array: arr(a), hl: { found: offset + 1 }, vars: { target }, codeLine: 6, desc: `Found at ${offset + 1}` }); return { steps, code }; }
  push({ array: arr(a), hl: { eliminated: [0, n] }, vars: { target }, codeLine: 6, desc: `Not found` });
  return { steps, code };
}

// ── Ternary Search ──
export function ternarySearch(input, opts = {}) {
  const a = arr(input).sort((x, y) => x - y); const stats = newStats(); const steps = [];
  const target = opts.target ?? a[Math.floor(a.length / 2)];
  const code = ['lo=0; hi=n-1', 'while lo<=hi:', '  mid1=lo+(hi-lo)//3', '  mid2=hi-(hi-lo)//3', '  if arr[mid1]==target: return mid1', '  if arr[mid2]==target: return mid2', '  if target<arr[mid1]: hi=mid1-1', '  elif target>arr[mid2]: lo=mid2+1', '  else: lo=mid1+1; hi=mid2-1'];
  const push = (p) => steps.push(mkStep(p, stats));
  let lo = 0, hi = a.length - 1;
  push({ array: arr(a), vars: { target, lo, hi }, codeLine: 0, desc: `Ternary search for ${target}` });
  while (lo <= hi) {
    const mid1 = lo + Math.floor((hi - lo) / 3), mid2 = hi - Math.floor((hi - lo) / 3);
    stats.comparisons += 2;
    push({ array: arr(a), hl: { compare: [mid1, mid2], range: [lo, hi] }, vars: { lo, hi, mid1, mid2, target }, codeLine: 3, desc: `Probe A[${mid1}]=${a[mid1]}, A[${mid2}]=${a[mid2]}` });
    if (a[mid1] === target) { push({ array: arr(a), hl: { found: mid1 }, vars: { mid1, target }, codeLine: 4, desc: `Found at ${mid1}` }); return { steps, code }; }
    if (a[mid2] === target) { push({ array: arr(a), hl: { found: mid2 }, vars: { mid2, target }, codeLine: 5, desc: `Found at ${mid2}` }); return { steps, code }; }
    if (target < a[mid1]) { hi = mid1 - 1; push({ array: arr(a), hl: { eliminated: [mid1, hi + 1 > mid2 ? hi + 1 : mid2], range: [lo, hi] }, vars: { lo, hi, target }, codeLine: 6, desc: `Search first third` }); }
    else if (target > a[mid2]) { lo = mid2 + 1; push({ array: arr(a), hl: { range: [lo, hi] }, vars: { lo, hi, target }, codeLine: 7, desc: `Search last third` }); }
    else { lo = mid1 + 1; hi = mid2 - 1; push({ array: arr(a), hl: { range: [lo, hi] }, vars: { lo, hi, target }, codeLine: 8, desc: `Search middle third` }); }
  }
  push({ array: arr(a), hl: { eliminated: [0, a.length] }, vars: { target }, codeLine: 9, desc: `Not found` });
  return { steps, code };
}

export const searchingAlgorithms = [
  { id: 'linearSearch', name: 'Linear Search', category: 'Searching', view: 'bar', inputType: 'array', needsTarget: true, generate: linearSearch, description: 'Scans each element until the target is found.', complexity: { best: 'O(1)', avg: 'O(n)', worst: 'O(n)', space: 'O(1)' }, stable: true, inplace: true, useCases: 'Unsorted/small data', advantages: 'Works on any list', disadvantages: 'Slow on large data' },
  { id: 'binarySearch', name: 'Binary Search', category: 'Searching', view: 'bar', inputType: 'array', needsTarget: true, generate: binarySearch, description: 'Halves the search range each comparison on sorted data.', complexity: { best: 'O(1)', avg: 'O(log n)', worst: 'O(log n)', space: 'O(1)' }, stable: true, inplace: true, useCases: 'Sorted arrays', advantages: 'Logarithmic', disadvantages: 'Needs sorted data' },
  { id: 'jumpSearch', name: 'Jump Search', category: 'Searching', view: 'bar', inputType: 'array', needsTarget: true, generate: jumpSearch, description: 'Jumps ahead by √n then linear-scans the block.', complexity: { best: 'O(1)', avg: 'O(√n)', worst: 'O(√n)', space: 'O(1)' }, stable: true, inplace: true, useCases: 'Sorted arrays', advantages: 'Better than linear', disadvantages: 'Needs sorted data' },
  { id: 'interpolationSearch', name: 'Interpolation Search', category: 'Searching', view: 'bar', inputType: 'array', needsTarget: true, generate: interpolationSearch, description: 'Estimates the position from value distribution.', complexity: { best: 'O(1)', avg: 'O(log log n)', worst: 'O(n)', space: 'O(1)' }, stable: true, inplace: true, useCases: 'Uniformly distributed sorted data', advantages: 'Very fast on uniform data', disadvantages: 'O(n) on clustered data' },
  { id: 'exponentialSearch', name: 'Exponential Search', category: 'Searching', view: 'bar', inputType: 'array', needsTarget: true, generate: exponentialSearch, description: 'Doubles a bound to find the range, then binary searches it.', complexity: { best: 'O(1)', avg: 'O(log n)', worst: 'O(log n)', space: 'O(1)' }, stable: true, inplace: true, useCases: 'Unbounded/sorted streams', advantages: 'Good for unknown size', disadvantages: 'Needs sorted data' },
  { id: 'fibonacciSearch', name: 'Fibonacci Search', category: 'Searching', view: 'bar', inputType: 'array', needsTarget: true, generate: fibonacciSearch, description: 'Uses Fibonacci numbers to divide the search range.', complexity: { best: 'O(1)', avg: 'O(log n)', worst: 'O(log n)', space: 'O(1)' }, stable: true, inplace: true, useCases: 'Sorted arrays, systems avoiding division', advantages: 'No division needed', disadvantages: 'Needs sorted data' },
  { id: 'ternarySearch', name: 'Ternary Search', category: 'Searching', view: 'bar', inputType: 'array', needsTarget: true, generate: ternarySearch, description: 'Splits the range into three parts and discards two-thirds each step.', complexity: { best: 'O(1)', avg: 'O(log₃ n)', worst: 'O(log₃ n)', space: 'O(1)' }, stable: true, inplace: true, useCases: 'Sorted arrays', advantages: 'Fewer iterations', disadvantages: 'More comparisons per step than binary' },
];