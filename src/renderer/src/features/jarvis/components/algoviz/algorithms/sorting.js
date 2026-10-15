import { mkStep, newStats } from '../stepUtils';

// Each generator returns { steps, code }.
// `code` is an array of pseudocode lines; step.codeLine indexes into it.
// Steps carry: array snapshot, highlights (hl), vars, cumulative stats, desc, codeLine, callStack.

function arr(a) { return a.slice(); }

// ── Bubble Sort ──
export function bubbleSort(input) {
  const a = arr(input); const stats = newStats(); const steps = [];
  const code = ['for i in 0..n-1:', '  for j in 0..n-i-1:', '    if arr[j] > arr[j+1]:', '      swap(arr[j], arr[j+1])'];
  const push = (p) => steps.push(mkStep(p, stats));
  const n = a.length;
  for (let i = 0; i < n - 1; i++) {
    let swapped = false;
    for (let j = 0; j < n - i - 1; j++) {
      stats.comparisons++; stats.reads += 2; stats.accesses += 2;
      push({ array: arr(a), hl: { compare: [j, j + 1], sorted: range(n - i, n) }, vars: { i, j }, codeLine: 2, desc: `Compare A[${j}]=${a[j]} and A[${j + 1}]=${a[j + 1]}` });
      if (a[j] > a[j + 1]) {
        [a[j], a[j + 1]] = [a[j + 1], a[j]]; stats.swaps++; stats.writes += 2; swapped = true;
        push({ array: arr(a), hl: { swap: [j, j + 1], sorted: range(n - i, n) }, vars: { i, j }, codeLine: 3, desc: `${a[j + 1]} > ${a[j]} → swap` });
      }
    }
    if (!swapped) break;
  }
  push({ array: arr(a), hl: { sorted: range(0, n) }, vars: {}, codeLine: 0, desc: 'Sorted' });
  return { steps, code };
}

// ── Selection Sort ──
export function selectionSort(input) {
  const a = arr(input); const stats = newStats(); const steps = [];
  const code = ['for i in 0..n-1:', '  min = i', '  for j in i+1..n:', '    if arr[j] < arr[min]: min = j', '  swap(arr[i], arr[min])'];
  const push = (p) => steps.push(mkStep(p, stats));
  const n = a.length;
  for (let i = 0; i < n - 1; i++) {
    let mi = i;
    push({ array: arr(a), hl: { active: [i], sorted: range(0, i) }, vars: { i, min: mi }, codeLine: 1, desc: `Assume min = A[${i}] = ${a[i]}` });
    for (let j = i + 1; j < n; j++) {
      stats.comparisons++; stats.reads++;
      push({ array: arr(a), hl: { compare: [mi, j], sorted: range(0, i) }, vars: { i, j, min: mi }, codeLine: 3, desc: `Compare A[${j}]=${a[j]} with min A[${mi}]=${a[mi]}` });
      if (a[j] < a[mi]) { mi = j; push({ array: arr(a), hl: { current: j, sorted: range(0, i) }, vars: { i, j, min: mi }, codeLine: 3, desc: `New min = A[${j}] = ${a[j]}` }); }
    }
    if (mi !== i) { [a[i], a[mi]] = [a[mi], a[i]]; stats.swaps++; stats.writes += 2; push({ array: arr(a), hl: { swap: [i, mi], sorted: range(0, i) }, vars: { i, min: mi }, codeLine: 4, desc: `Swap A[${i}] and A[${mi}]` }); }
  }
  push({ array: arr(a), hl: { sorted: range(0, n) }, vars: {}, codeLine: 0, desc: 'Sorted' });
  return { steps, code };
}

// ── Insertion Sort ──
export function insertionSort(input) {
  const a = arr(input); const stats = newStats(); const steps = [];
  const code = ['for i in 1..n-1:', '  key = arr[i]', '  j = i - 1', '  while j>=0 and arr[j]>key:', '    arr[j+1] = arr[j]; j--', '  arr[j+1] = key'];
  const push = (p) => steps.push(mkStep(p, stats));
  const n = a.length;
  for (let i = 1; i < n; i++) {
    const key = a[i]; stats.reads++;
    push({ array: arr(a), hl: { current: i, sorted: range(0, i) }, vars: { i, key }, codeLine: 1, desc: `Pick key = A[${i}] = ${key}` });
    let j = i - 1;
    while (j >= 0 && a[j] > key) {
      stats.comparisons++; stats.reads++;
      push({ array: arr(a), hl: { compare: [j, i], sorted: range(0, i) }, vars: { i, j, key }, codeLine: 4, desc: `A[${j}]=${a[j]} > key=${key}, shift right` });
      a[j + 1] = a[j]; stats.assignments++; stats.writes++;
      push({ array: arr(a), hl: { swap: [j, j + 1], sorted: range(0, i) }, vars: { i, j, key }, codeLine: 4, desc: `Shift A[${j}] → A[${j + 1}]` });
      j--;
    }
    a[j + 1] = key; stats.assignments++; stats.writes++;
    push({ array: arr(a), hl: { active: [j + 1], sorted: range(0, i + 1) }, vars: { i, j, key }, codeLine: 5, desc: `Insert key=${key} at A[${j + 1}]` });
  }
  push({ array: arr(a), hl: { sorted: range(0, n) }, vars: {}, codeLine: 0, desc: 'Sorted' });
  return { steps, code };
}

// ── Quick Sort (Lomuto, deterministic) ──
export function quickSort(input) {
  const a = arr(input); const stats = newStats(); const steps = [];
  const code = ['qs(lo, hi):', '  if lo >= hi: return', '  pivot = arr[hi]', '  i = lo', '  for j in lo..hi-1:', '    if arr[j] < pivot: swap(i,j); i++', '  swap(i, hi)', '  qs(lo, i-1); qs(i+1, hi)'];
  const push = (p) => steps.push(mkStep(p, stats));
  const n = a.length;
  const stack = [];
  function qs(lo, hi, depth) {
    stats.recursiveCalls++;
    stack.push({ name: 'qs', args: `lo=${lo}, hi=${hi}` });
    push({ array: arr(a), hl: { range: [lo, hi] }, vars: { lo, hi }, codeLine: 1, callStack: stack.slice(), desc: `Call qs(${lo}, ${hi})` });
    if (lo >= hi) { stack.pop(); push({ array: arr(a), hl: { range: [lo, hi] }, vars: { lo, hi }, codeLine: 2, callStack: stack.slice(), desc: `Base case: return` }); return; }
    const piv = a[hi]; stats.reads++;
    push({ array: arr(a), hl: { pivot: hi, range: [lo, hi] }, vars: { lo, hi, pivot: piv }, codeLine: 3, callStack: stack.slice(), desc: `Pivot = A[${hi}] = ${piv}` });
    let i = lo;
    for (let j = lo; j < hi; j++) {
      stats.comparisons++; stats.reads++;
      push({ array: arr(a), hl: { compare: [j, hi], pivot: hi, range: [lo, hi], current: i }, vars: { lo, hi, i, j, pivot: piv }, codeLine: 5, callStack: stack.slice(), desc: `Compare A[${j}]=${a[j]} with pivot ${piv}` });
      if (a[j] < piv) { [a[i], a[j]] = [a[j], a[i]]; stats.swaps++; stats.writes += 2; push({ array: arr(a), hl: { swap: [i, j], pivot: hi, range: [lo, hi] }, vars: { lo, hi, i, j, pivot: piv }, codeLine: 5, callStack: stack.slice(), desc: `A[${j}] < pivot → swap A[${i}], A[${j}]` }); i++; }
    }
    [a[i], a[hi]] = [a[hi], a[i]]; stats.swaps++; stats.writes += 2;
    push({ array: arr(a), hl: { swap: [i, hi], pivot: i, range: [lo, hi] }, vars: { lo, hi, i, pivot: piv }, codeLine: 6, callStack: stack.slice(), desc: `Place pivot at A[${i}]` });
    stack.pop();
    qs(lo, i - 1, depth + 1); qs(i + 1, hi, depth + 1);
  }
  qs(0, n - 1, 0);
  push({ array: arr(a), hl: { sorted: range(0, n) }, vars: {}, codeLine: 0, desc: 'Sorted' });
  return { steps, code };
}

// ── Randomized Quick Sort ──
export function randomizedQuickSort(input) {
  const a = arr(input); const stats = newStats(); const steps = [];
  const code = ['rqs(lo, hi):', '  if lo >= hi: return', '  r = random(lo..hi)', '  swap(r, hi)', '  pivot = arr[hi]; i = lo', '  for j in lo..hi-1:', '    if arr[j] < pivot: swap(i,j); i++', '  swap(i, hi)', '  rqs(lo,i-1); rqs(i+1,hi)'];
  const push = (p) => steps.push(mkStep(p, stats));
  const n = a.length; const stack = [];
  function rqs(lo, hi) {
    stats.recursiveCalls++; stack.push({ name: 'rqs', args: `lo=${lo}, hi=${hi}` });
    if (lo >= hi) { push({ array: arr(a), hl: { range: [lo, hi] }, vars: { lo, hi }, codeLine: 2, callStack: stack.slice(), desc: `Base case` }); stack.pop(); return; }
    const r = lo + Math.floor(Math.random() * (hi - lo + 1));
    push({ array: arr(a), hl: { current: r, range: [lo, hi] }, vars: { lo, hi, r }, codeLine: 3, callStack: stack.slice(), desc: `Random pivot index = ${r}` });
    [a[r], a[hi]] = [a[hi], a[r]]; stats.swaps++;
    push({ array: arr(a), hl: { swap: [r, hi], pivot: hi, range: [lo, hi] }, vars: { lo, hi, r }, codeLine: 4, callStack: stack.slice(), desc: `Move random pivot to end` });
    const piv = a[hi]; let i = lo;
    for (let j = lo; j < hi; j++) {
      stats.comparisons++;
      push({ array: arr(a), hl: { compare: [j, hi], pivot: hi, range: [lo, hi], current: i }, vars: { lo, hi, i, j, pivot: piv }, codeLine: 6, callStack: stack.slice(), desc: `Compare A[${j}]=${a[j]} with pivot ${piv}` });
      if (a[j] < piv) { [a[i], a[j]] = [a[j], a[i]]; stats.swaps++; push({ array: arr(a), hl: { swap: [i, j], pivot: hi, range: [lo, hi] }, vars: { lo, hi, i, j, pivot: piv }, codeLine: 6, callStack: stack.slice(), desc: `Swap A[${i}], A[${j}]` }); i++; }
    }
    [a[i], a[hi]] = [a[hi], a[i]]; stats.swaps++;
    push({ array: arr(a), hl: { swap: [i, hi], pivot: i, range: [lo, hi] }, vars: { lo, hi, i, pivot: piv }, codeLine: 8, callStack: stack.slice(), desc: `Place pivot at A[${i}]` });
    stack.pop(); rqs(lo, i - 1); rqs(i + 1, hi);
  }
  rqs(0, n - 1);
  push({ array: arr(a), hl: { sorted: range(0, n) }, vars: {}, codeLine: 0, desc: 'Sorted' });
  return { steps, code };
}

// ── 3-Way Quick Sort (Dutch flag partition) ──
export function threeWayQuickSort(input) {
  const a = arr(input); const stats = newStats(); const steps = [];
  const code = ['qs3(lo, hi):', '  if lo >= hi: return', '  lt=i=lo; gt=hi; pivot=arr[lo]', '  while i <= gt:', '    if arr[i]<pivot: swap(i,lt); i++; lt++', '    elif arr[i]>pivot: swap(i,gt); gt--', '    else: i++', '  qs3(lo,lt-1); qs3(gt+1,hi)'];
  const push = (p) => steps.push(mkStep(p, stats));
  const n = a.length; const stack = [];
  function qs(lo, hi) {
    stats.recursiveCalls++; stack.push({ name: 'qs3', args: `lo=${lo}, hi=${hi}` });
    if (lo >= hi) { stack.pop(); return; }
    const piv = a[lo]; let lt = lo, i = lo, gt = hi;
    push({ array: arr(a), hl: { pivot: lo, range: [lo, hi] }, vars: { lo, hi, lt, i, gt, pivot: piv }, codeLine: 3, callStack: stack.slice(), desc: `Pivot = A[${lo}] = ${piv}` });
    while (i <= gt) {
      stats.comparisons++;
      push({ array: arr(a), hl: { compare: [i], pivot: lo, active: [lt, gt], range: [lo, hi] }, vars: { lo, hi, lt, i, gt, pivot: piv }, codeLine: 4, callStack: stack.slice(), desc: `A[${i}]=${a[i]} vs pivot ${piv}` });
      if (a[i] < piv) { [a[i], a[lt]] = [a[lt], a[i]]; stats.swaps++; lt++; i++; push({ array: arr(a), hl: { swap: [i - 1, lt - 1], range: [lo, hi] }, vars: { lo, hi, lt, i, gt, pivot: piv }, codeLine: 5, callStack: stack.slice(), desc: `< pivot → swap into <region` }); }
      else if (a[i] > piv) { [a[i], a[gt]] = [a[gt], a[i]]; stats.swaps++; gt--; push({ array: arr(a), hl: { swap: [i, gt + 1], range: [lo, hi] }, vars: { lo, hi, lt, i, gt, pivot: piv }, codeLine: 6, callStack: stack.slice(), desc: `> pivot → swap into >region` }); }
      else { i++; push({ array: arr(a), hl: { current: i - 1, range: [lo, hi] }, vars: { lo, hi, lt, i, gt, pivot: piv }, codeLine: 7, callStack: stack.slice(), desc: `= pivot → keep` }); }
    }
    stack.pop(); qs(lo, lt - 1); qs(gt + 1, hi);
  }
  qs(0, n - 1);
  push({ array: arr(a), hl: { sorted: range(0, n) }, vars: {}, codeLine: 0, desc: 'Sorted' });
  return { steps, code };
}

// ── Merge Sort (top-down) ──
export function mergeSort(input) {
  const a = arr(input); const stats = newStats(); const steps = [];
  const code = ['ms(lo, hi):', '  if lo >= hi: return', '  mid = (lo+hi)//2', '  ms(lo, mid); ms(mid+1, hi)', '  merge(lo, mid, hi)', 'merge: compare L,R; copy smaller', '  copy back to arr'];
  const push = (p) => steps.push(mkStep(p, stats));
  const n = a.length; const stack = [];
  function ms(lo, hi) {
    stats.recursiveCalls++; stack.push({ name: 'ms', args: `lo=${lo}, hi=${hi}` });
    if (lo >= hi) { stack.pop(); return; }
    const mid = (lo + hi) >> 1;
    push({ array: arr(a), hl: { range: [lo, hi], current: mid }, vars: { lo, mid, hi }, codeLine: 3, callStack: stack.slice(), desc: `Split [${lo}..${hi}] at mid=${mid}` });
    ms(lo, mid); ms(mid + 1, hi);
    stack.push({ name: 'merge', args: `lo=${lo}, mid=${mid}, hi=${hi}` });
    merge(lo, mid, hi);
    stack.pop(); stack.pop();
  }
  function merge(lo, mid, hi) {
    const L = a.slice(lo, mid + 1), R = a.slice(mid + 1, hi + 1);
    let i = 0, j = 0, k = lo;
    while (i < L.length && j < R.length) {
      stats.comparisons++;
      push({ array: arr(a), hl: { compare: [lo + i, mid + 1 + j], range: [lo, hi] }, vars: { lo, mid, hi, i, j, k }, codeLine: 5, callStack: stack.slice(), desc: `Compare L[${i}]=${L[i]} and R[${j}]=${R[j]}` });
      if (L[i] <= R[j]) { a[k] = L[i]; i++; } else { a[k] = R[j]; j++; }
      stats.assignments++; stats.writes++; k++;
      push({ array: arr(a), hl: { active: [k - 1], range: [lo, hi] }, vars: { lo, mid, hi, i, j, k }, codeLine: 6, callStack: stack.slice(), desc: `Write A[${k - 1}] = ${a[k - 1]}` });
    }
    while (i < L.length) { a[k] = L[i]; stats.assignments++; stats.writes++; push({ array: arr(a), hl: { active: [k], range: [lo, hi] }, vars: { lo, mid, hi, i, j, k }, codeLine: 6, callStack: stack.slice(), desc: `Copy remaining L[${i}]=${L[i]}` }); i++; k++; }
    while (j < R.length) { a[k] = R[j]; stats.assignments++; stats.writes++; push({ array: arr(a), hl: { active: [k], range: [lo, hi] }, vars: { lo, mid, hi, i, j, k }, codeLine: 6, callStack: stack.slice(), desc: `Copy remaining R[${j}]=${R[j]}` }); j++; k++; }
  }
  ms(0, n - 1);
  push({ array: arr(a), hl: { sorted: range(0, n) }, vars: {}, codeLine: 0, desc: 'Sorted' });
  return { steps, code };
}

// ── Merge Sort (bottom-up) ──
export function mergeSortBottomUp(input) {
  const a = arr(input); const stats = newStats(); const steps = [];
  const code = ['width = 1', 'while width < n:', '  for lo in 0,2*width, ...:', '    mid = lo+width-1', '    hi = min(lo+2*width-1, n-1)', '    merge(lo, mid, hi)', '  width *= 2'];
  const push = (p) => steps.push(mkStep(p, stats));
  const n = a.length;
  let width = 1;
  while (width < n) {
    push({ array: arr(a), hl: {}, vars: { width }, codeLine: 1, desc: `Width = ${width}` });
    for (let lo = 0; lo < n; lo += 2 * width) {
      const mid = Math.min(lo + width - 1, n - 1);
      const hi = Math.min(lo + 2 * width - 1, n - 1);
      push({ array: arr(a), hl: { range: [lo, hi], current: mid }, vars: { lo, mid, hi, width }, codeLine: 5, desc: `Merge [${lo}..${mid}] and [${mid + 1}..${hi}]` });
      const L = a.slice(lo, mid + 1), R = a.slice(mid + 1, hi + 1);
      let i = 0, j = 0, k = lo;
      while (i < L.length && j < R.length) {
        stats.comparisons++;
        if (L[i] <= R[j]) { a[k] = L[i++]; } else { a[k] = R[j++]; }
        stats.assignments++; stats.writes++; k++;
        push({ array: arr(a), hl: { active: [k - 1], range: [lo, hi] }, vars: { lo, mid, hi, i, j, k, width }, codeLine: 5, desc: `Compare & write A[${k - 1}] = ${a[k - 1]}` });
      }
      while (i < L.length) { a[k] = L[i++]; stats.assignments++; stats.writes++; push({ array: arr(a), hl: { active: [k], range: [lo, hi] }, vars: { lo, mid, hi, k, width }, codeLine: 5, desc: `Copy L remainder` }); k++; }
      while (j < R.length) { a[k] = R[j++]; stats.assignments++; stats.writes++; push({ array: arr(a), hl: { active: [k], range: [lo, hi] }, vars: { lo, mid, hi, k, width }, codeLine: 5, desc: `Copy R remainder` }); k++; }
    }
    width *= 2;
  }
  push({ array: arr(a), hl: { sorted: range(0, n) }, vars: {}, codeLine: 0, desc: 'Sorted' });
  return { steps, code };
}

// ── Heap Sort ──
export function heapSort(input) {
  const a = arr(input); const stats = newStats(); const steps = [];
  const code = ['build max-heap (i from n/2..0)', '  heapify(i, n)', 'for end in n-1..1:', '  swap(0, end)', '  heapify(0, end)', 'heapify(i, size):', '  largest = i; l=2i+1; r=2i+2', '  if l<size and arr[l]>arr[largest]: largest=l', '  if r<size and arr[r]>arr[largest]: largest=r', '  if largest!=i: swap(i,largest); heapify(largest,size)'];
  const push = (p) => steps.push(mkStep(p, stats));
  const n = a.length;
  function heapify(i, size) {
    stats.heapOps++;
    while (true) {
      let largest = i, l = 2 * i + 1, r = 2 * i + 2;
      if (l < size) { stats.comparisons++; if (a[l] > a[largest]) largest = l; }
      if (r < size) { stats.comparisons++; if (a[r] > a[largest]) largest = r; }
      push({ array: arr(a), hl: { current: i, compare: [l, r].filter((x) => x < size), active: [largest] }, vars: { i, size, largest, l, r }, codeLine: 6, desc: `Heapify i=${i}: largest=${largest}` });
      if (largest === i) break;
      [a[i], a[largest]] = [a[largest], a[i]]; stats.swaps++;
      push({ array: arr(a), hl: { swap: [i, largest] }, vars: { i, size, largest }, codeLine: 9, desc: `Swap A[${i}] and A[${largest}]` });
      i = largest;
    }
  }
  for (let i = (n >> 1) - 1; i >= 0; i--) heapify(i, n);
  push({ array: arr(a), hl: { active: [0] }, vars: {}, codeLine: 1, desc: 'Max-heap built' });
  for (let end = n - 1; end > 0; end--) {
    [a[0], a[end]] = [a[end], a[0]]; stats.swaps++;
    push({ array: arr(a), hl: { swap: [0, end], sorted: range(end, n) }, vars: { end }, codeLine: 3, desc: `Move max A[0] to A[${end}]` });
    heapify(0, end);
  }
  push({ array: arr(a), hl: { sorted: range(0, n) }, vars: {}, codeLine: 0, desc: 'Sorted' });
  return { steps, code };
}

// ── Counting Sort ──
export function countingSort(input) {
  const a = arr(input); const stats = newStats(); const steps = [];
  const code = ['max = max(arr)', 'count = [0]*(max+1)', 'for v in arr: count[v]++', 'for i in 1..max: count[i]+=count[i-1]', 'build output from count', 'copy output to arr'];
  const push = (p) => steps.push(mkStep(p, stats));
  const n = a.length; const max = Math.max(...a, 0);
  const count = new Array(max + 1).fill(0);
  const out = new Array(n);
  push({ array: arr(a), hl: { current: max }, vars: { max }, codeLine: 1, desc: `Max value = ${max}` });
  for (const v of a) { count[v]++; stats.accesses++; push({ array: arr(a), hl: { active: [a.indexOf(v)] }, vars: { v, count: count.slice() }, viewData: { count: count.slice() }, codeLine: 2, desc: `count[${v}]++ → ${count[v]}` }); }
  for (let i = 1; i <= max; i++) { count[i] += count[i - 1]; stats.accesses++; push({ array: arr(a), vars: { i, count: count.slice() }, viewData: { count: count.slice() }, codeLine: 3, desc: `Prefix: count[${i}] = ${count[i]}` }); }
  for (let i = n - 1; i >= 0; i--) { const v = a[i]; out[--count[v]] = v; stats.assignments++; push({ array: arr(out.map((x, k) => x ?? a[k])), hl: { active: [count[v]] }, vars: { i, v }, viewData: { count: count.slice() }, codeLine: 4, desc: `Place A[${i}]=${v} at output[${count[v]}]` }); }
  for (let i = 0; i < n; i++) a[i] = out[i];
  push({ array: arr(a), hl: { sorted: range(0, n) }, vars: {}, codeLine: 5, desc: 'Sorted' });
  return { steps, code };
}

// ── Radix Sort (LSD, base 10) ──
export function radixSort(input) {
  const a = arr(input); const stats = newStats(); const steps = [];
  const code = ['max = max(arr); d = digits(max)', 'for exp in 1,10,100,...:', '  counting by digit (arr[i]/exp)%10', '  distribute into buckets', '  collect back into arr'];
  const push = (p) => steps.push(mkStep(p, stats));
  const n = a.length; const max = Math.max(...a, 0);
  let exp = 1;
  while (Math.floor(max / exp) > 0) {
    const buckets = Array.from({ length: 10 }, () => []);
    push({ array: arr(a), vars: { exp }, viewData: { buckets: [], phase: 'distribute', exp }, codeLine: 1, desc: `Pass for digit place exp=${exp}` });
    for (let i = 0; i < n; i++) {
      const d = Math.floor(a[i] / exp) % 10; buckets[d].push(a[i]); stats.accesses++;
      push({ array: arr(a), hl: { current: i, active: [d] }, vars: { exp, digit: d }, viewData: { buckets: buckets.map((b) => b.slice()), phase: 'distribute', exp }, codeLine: 3, desc: `A[${i}]=${a[i]} → bucket[${d}]` });
    }
    let k = 0;
    for (let d = 0; d < 10; d++) for (const v of buckets[d]) { a[k] = v; stats.assignments++; k++; }
    push({ array: arr(a), vars: { exp }, viewData: { buckets: buckets.map((b) => b.slice()), phase: 'collect', exp }, codeLine: 4, desc: `Collect buckets back into array` });
    exp *= 10;
  }
  push({ array: arr(a), hl: { sorted: range(0, n) }, vars: {}, codeLine: 0, desc: 'Sorted' });
  return { steps, code };
}

// ── Bucket Sort ──
export function bucketSort(input) {
  const a = arr(input); const stats = newStats(); const steps = [];
  const code = ['n = len(arr)', 'buckets = [[] for _ in range(n)]', 'for v in arr: buckets[int(v*n/max)].append(v)', 'sort each bucket', 'concatenate buckets'];
  const push = (p) => steps.push(mkStep(p, stats));
  const n = a.length; const max = Math.max(...a, 1);
  const nb = Math.min(n, 10);
  const buckets = Array.from({ length: nb }, () => []);
  for (const v of a) { const bi = Math.min(nb - 1, Math.floor((v / max) * nb)); buckets[bi].push(v); stats.accesses++; push({ array: arr(a), hl: { current: a.indexOf(v) }, vars: { v, bi }, viewData: { buckets: buckets.map((b) => b.slice()), phase: 'distribute' }, codeLine: 2, desc: `Distribute ${v} → bucket[${bi}]` }); }
  for (const b of buckets) b.sort((x, y) => x - y);
  let k = 0;
  for (const b of buckets) for (const v of b) { a[k] = v; stats.assignments++; k++; }
  push({ array: arr(a), vars: {}, viewData: { buckets: buckets.map((b) => b.slice()), phase: 'collect' }, codeLine: 4, desc: 'Sort each bucket & concatenate' });
  push({ array: arr(a), hl: { sorted: range(0, n) }, vars: {}, codeLine: 0, desc: 'Sorted' });
  return { steps, code };
}

// ── Shell Sort ──
export function shellSort(input) {
  const a = arr(input); const stats = newStats(); const steps = [];
  const code = ['gap = n//2', 'while gap > 0:', '  for i in gap..n-1:', '    temp = arr[i]; j = i', '    while j>=gap and arr[j-gap]>temp:', '      arr[j]=arr[j-gap]; j-=gap', '    arr[j] = temp', '  gap //= 2'];
  const push = (p) => steps.push(mkStep(p, stats));
  const n = a.length;
  for (let gap = n >> 1; gap > 0; gap >>= 1) {
    push({ array: arr(a), vars: { gap }, codeLine: 1, desc: `Gap = ${gap}` });
    for (let i = gap; i < n; i++) {
      const temp = a[i]; let j = i; stats.reads++;
      push({ array: arr(a), hl: { current: i }, vars: { gap, i, temp }, codeLine: 3, desc: `Pick temp = A[${i}] = ${temp}` });
      while (j >= gap && a[j - gap] > temp) {
        stats.comparisons++;
        push({ array: arr(a), hl: { compare: [j - gap, j], current: j }, vars: { gap, i, j, temp }, codeLine: 5, desc: `A[${j - gap}]=${a[j - gap]} > temp=${temp}, shift` });
        a[j] = a[j - gap]; stats.assignments++; j -= gap;
        push({ array: arr(a), hl: { swap: [j, j + gap], current: j }, vars: { gap, i, j, temp }, codeLine: 6, desc: `Shift A[${j + gap}] ← A[${j}]` });
      }
      a[j] = temp; stats.assignments++;
      push({ array: arr(a), hl: { active: [j] }, vars: { gap, i, j, temp }, codeLine: 7, desc: `Place temp=${temp} at A[${j}]` });
    }
  }
  push({ array: arr(a), hl: { sorted: range(0, n) }, vars: {}, codeLine: 0, desc: 'Sorted' });
  return { steps, code };
}

// ── Cocktail Shaker Sort ──
export function cocktailSort(input) {
  const a = arr(input); const stats = newStats(); const steps = [];
  const code = ['do:', '  forward pass: bubble largest right', '  backward pass: bubble smallest left', 'while swapped'];
  const push = (p) => steps.push(mkStep(p, stats));
  const n = a.length; let lo = 0, hi = n - 1; let swapped = true;
  while (swapped) {
    swapped = false;
    for (let i = lo; i < hi; i++) {
      stats.comparisons++;
      push({ array: arr(a), hl: { compare: [i, i + 1], sorted: range(hi + 1, n) }, vars: { lo, hi, i }, codeLine: 1, desc: `Forward: compare A[${i}], A[${i + 1}]` });
      if (a[i] > a[i + 1]) { [a[i], a[i + 1]] = [a[i + 1], a[i]]; stats.swaps++; swapped = true; push({ array: arr(a), hl: { swap: [i, i + 1] }, vars: { lo, hi, i }, codeLine: 1, desc: `Swap` }); }
    }
    hi--;
    for (let i = hi; i > lo; i--) {
      stats.comparisons++;
      push({ array: arr(a), hl: { compare: [i, i - 1], sorted: range(hi + 1, n) }, vars: { lo, hi, i }, codeLine: 2, desc: `Backward: compare A[${i}], A[${i - 1}]` });
      if (a[i - 1] > a[i]) { [a[i - 1], a[i]] = [a[i], a[i - 1]]; stats.swaps++; swapped = true; push({ array: arr(a), hl: { swap: [i - 1, i] }, vars: { lo, hi, i }, codeLine: 2, desc: `Swap` }); }
    }
    lo++;
  }
  push({ array: arr(a), hl: { sorted: range(0, n) }, vars: {}, codeLine: 0, desc: 'Sorted' });
  return { steps, code };
}

// ── Comb Sort ──
export function combSort(input) {
  const a = arr(input); const stats = newStats(); const steps = [];
  const code = ['gap = n; shrink = 1.3', 'while gap>1 or swapped:', '  gap = max(1, int(gap/shrink))', '  for i in 0..n-gap-1:', '    if arr[i] > arr[i+gap]: swap; swapped=True'];
  const push = (p) => steps.push(mkStep(p, stats));
  const n = a.length; let gap = n; let swapped = true;
  while (gap > 1 || swapped) {
    gap = Math.max(1, Math.floor(gap / 1.3));
    swapped = false;
    push({ array: arr(a), vars: { gap }, codeLine: 2, desc: `Gap = ${gap}` });
    for (let i = 0; i + gap < n; i++) {
      stats.comparisons++;
      push({ array: arr(a), hl: { compare: [i, i + gap] }, vars: { gap, i }, codeLine: 4, desc: `Compare A[${i}]=${a[i]} and A[${i + gap}]=${a[i + gap]}` });
      if (a[i] > a[i + gap]) { [a[i], a[i + gap]] = [a[i + gap], a[i]]; stats.swaps++; swapped = true; push({ array: arr(a), hl: { swap: [i, i + gap] }, vars: { gap, i }, codeLine: 4, desc: `Swap` }); }
    }
  }
  push({ array: arr(a), hl: { sorted: range(0, n) }, vars: {}, codeLine: 0, desc: 'Sorted' });
  return { steps, code };
}

// ── Gnome Sort ──
export function gnomeSort(input) {
  const a = arr(input); const stats = newStats(); const steps = [];
  const code = ['i = 0', 'while i < n:', '  if i==0 or arr[i]>=arr[i-1]: i++', '  else: swap(i,i-1); i--'];
  const push = (p) => steps.push(mkStep(p, stats));
  const n = a.length; let i = 0;
  while (i < n) {
    if (i === 0 || a[i] >= a[i - 1]) {
      stats.comparisons++;
      push({ array: arr(a), hl: { current: i, sorted: range(0, i) }, vars: { i }, codeLine: 2, desc: `A[${i}] in order → advance` });
      i++;
    } else {
      stats.comparisons++;
      push({ array: arr(a), hl: { compare: [i - 1, i] }, vars: { i }, codeLine: 3, desc: `A[${i - 1}] > A[${i}] → swap & step back` });
      [a[i], a[i - 1]] = [a[i - 1], a[i]]; stats.swaps++;
      push({ array: arr(a), hl: { swap: [i - 1, i] }, vars: { i }, codeLine: 3, desc: `Swap` });
      i--;
    }
  }
  push({ array: arr(a), hl: { sorted: range(0, n) }, vars: {}, codeLine: 0, desc: 'Sorted' });
  return { steps, code };
}

// ── Cycle Sort ──
export function cycleSort(input) {
  const a = arr(input); const stats = newStats(); const steps = [];
  const code = ['for cycle_start in 0..n-2:', '  item = arr[cycle_start]', '  pos = cycle_start', '  for i in cycle_start+1..n-1:', '    if arr[i] < item: pos++', '  if pos == cycle_start: continue', '  while item == arr[pos]: pos++', '  swap(item, arr[pos])', '  while pos != cycle_start: repeat'];
  const push = (p) => steps.push(mkStep(p, stats));
  const n = a.length;
  for (let cs = 0; cs < n - 1; cs++) {
    let item = a[cs]; stats.reads++;
    let pos = cs;
    for (let i = cs + 1; i < n; i++) { stats.comparisons++; if (a[i] < item) pos++; }
    push({ array: arr(a), hl: { current: cs, active: [pos] }, vars: { cycle_start: cs, item, pos }, codeLine: 5, desc: `Cycle from A[${cs}]=${item}, destination=${pos}` });
    if (pos === cs) continue;
    while (item === a[pos]) pos++;
    [a[pos], item] = [item, a[pos]]; stats.writes++;
    push({ array: arr(a), hl: { swap: [pos], current: cs }, vars: { cycle_start: cs, item, pos }, codeLine: 8, desc: `Write ${item} to A[${pos}], pick up ${a[pos]}` });
    while (pos !== cs) {
      pos = cs;
      for (let i = cs + 1; i < n; i++) { stats.comparisons++; if (a[i] < item) pos++; }
      while (item === a[pos]) pos++;
      [a[pos], item] = [item, a[pos]]; stats.writes++;
      push({ array: arr(a), hl: { swap: [pos], current: cs }, vars: { cycle_start: cs, item, pos }, codeLine: 9, desc: `Continue cycle: write to A[${pos}]` });
    }
  }
  push({ array: arr(a), hl: { sorted: range(0, n) }, vars: {}, codeLine: 0, desc: 'Sorted' });
  return { steps, code };
}

// ── Odd-Even Sort ──
export function oddEvenSort(input) {
  const a = arr(input); const stats = newStats(); const steps = [];
  const code = ['sorted = False', 'while not sorted:', '  sorted = True', '  for i in 1,3,5,...: compare/swap(i,i+1)', '  for i in 0,2,4,...: compare/swap(i,i+1)'];
  const push = (p) => steps.push(mkStep(p, stats));
  const n = a.length; let sorted = false;
  while (!sorted) {
    sorted = true;
    for (let i = 1; i < n - 1; i += 2) { stats.comparisons++; push({ array: arr(a), hl: { compare: [i, i + 1] }, vars: { phase: 'odd', i }, codeLine: 3, desc: `Odd phase: compare A[${i}], A[${i + 1}]` }); if (a[i] > a[i + 1]) { [a[i], a[i + 1]] = [a[i + 1], a[i]]; stats.swaps++; sorted = false; push({ array: arr(a), hl: { swap: [i, i + 1] }, vars: { phase: 'odd', i }, codeLine: 3, desc: `Swap` }); } }
    for (let i = 0; i < n - 1; i += 2) { stats.comparisons++; push({ array: arr(a), hl: { compare: [i, i + 1] }, vars: { phase: 'even', i }, codeLine: 4, desc: `Even phase: compare A[${i}], A[${i + 1}]` }); if (a[i] > a[i + 1]) { [a[i], a[i + 1]] = [a[i + 1], a[i]]; stats.swaps++; sorted = false; push({ array: arr(a), hl: { swap: [i, i + 1] }, vars: { phase: 'even', i }, codeLine: 4, desc: `Swap` }); } }
  }
  push({ array: arr(a), hl: { sorted: range(0, n) }, vars: {}, codeLine: 0, desc: 'Sorted' });
  return { steps, code };
}

// ── Pancake Sort ──
export function pancakeSort(input) {
  const a = arr(input); const stats = newStats(); const steps = [];
  const code = ['for size in n..2:', '  find index mi of max in 0..size-1', '  flip(mi): reverse 0..mi', '  flip(size-1): reverse 0..size-1'];
  const push = (p) => steps.push(mkStep(p, stats));
  const n = a.length;
  function flip(k) { let l = 0, r = k; while (l < r) { [a[l], a[r]] = [a[r], a[l]]; stats.swaps++; l++; r--; } }
  for (let size = n; size > 1; size--) {
    let mi = 0;
    for (let i = 1; i < size; i++) { stats.comparisons++; if (a[i] > a[mi]) mi = i; }
    push({ array: arr(a), hl: { current: mi, active: [size - 1], sorted: range(size, n) }, vars: { size, mi }, codeLine: 1, desc: `Max in 0..${size - 1} is A[${mi}]=${a[mi]}` });
    if (mi !== size - 1) {
      if (mi > 0) { flip(mi); push({ array: arr(a), hl: { swap: range(0, mi + 1), sorted: range(size, n) }, vars: { size, mi }, codeLine: 2, desc: `Flip top ${mi + 1} to bring max to front` }); }
      flip(size - 1); push({ array: arr(a), hl: { swap: range(0, size), sorted: range(size, n) }, vars: { size, mi }, codeLine: 3, desc: `Flip ${size} to put max at bottom` });
    }
  }
  push({ array: arr(a), hl: { sorted: range(0, n) }, vars: {}, codeLine: 0, desc: 'Sorted' });
  return { steps, code };
}

// ── Tim Sort (simplified: runs + merge) ──
export function timSort(input) {
  const a = arr(input); const stats = newStats(); const steps = [];
  const code = ['RUN = 16', 'for lo in 0,2*RUN,...:', '  insertionSort(lo, min(lo+RUN-1, n-1))', 'merge runs with increasing width'];
  const push = (p) => steps.push(mkStep(p, stats));
  const n = a.length; const RUN = 16;
  for (let lo = 0; lo < n; lo += RUN) {
    const mid = Math.min(lo + RUN - 1, n - 1);
    for (let i = lo + 1; i <= mid; i++) { const key = a[i]; let j = i - 1; while (j >= lo && a[j] > key) { stats.comparisons++; a[j + 1] = a[j]; stats.assignments++; j--; } a[j + 1] = key; stats.assignments++; push({ array: arr(a), hl: { active: [lo, mid], range: [lo, mid] }, vars: { lo, mid }, codeLine: 2, desc: `Insertion sort run [${lo}..${mid}]` }); }
  }
  for (let width = RUN; width < n; width *= 2) {
    for (let lo = 0; lo < n; lo += 2 * width) {
      const mid = Math.min(lo + width - 1, n - 1), hi = Math.min(lo + 2 * width - 1, n - 1);
      const L = a.slice(lo, mid + 1), R = a.slice(mid + 1, hi + 1); let i = 0, j = 0, k = lo;
      while (i < L.length && j < R.length) { stats.comparisons++; if (L[i] <= R[j]) a[k++] = L[i++]; else a[k++] = R[j++]; stats.assignments++; }
      while (i < L.length) { a[k++] = L[i++]; stats.assignments++; } while (j < R.length) { a[k++] = R[j++]; stats.assignments++; }
      push({ array: arr(a), hl: { range: [lo, hi] }, vars: { lo, mid, hi, width }, codeLine: 3, desc: `Merge runs [${lo}..${mid}] and [${mid + 1}..${hi}]` });
    }
  }
  push({ array: arr(a), hl: { sorted: range(0, n) }, vars: {}, codeLine: 0, desc: 'Sorted' });
  return { steps, code };
}

// ── Tree Sort (BST insert + in-order) ──
export function treeSort(input) {
  const a = arr(input); const stats = newStats(); const steps = [];
  const code = ['root = null', 'for v in arr: root = insert(root, v)', 'inorder(root) → sorted output'];
  const push = (p) => steps.push(mkStep(p, stats));
  const n = a.length; let root = null;
  function insert(node, v) {
    stats.nodeVisits++;
    if (!node) return { val: v, left: null, right: null };
    if (v < node.val) node.left = insert(node.left, v); else node.right = insert(node.right, v);
    return node;
  }
  function toTree(node) { return node ? { val: node.val, left: toTree(node.left), right: toTree(node.right) } : null; }
  for (const v of a) { root = insert(root, v); push({ array: arr(a), vars: { v }, view: 'tree', viewData: { root: toTree(root), current: v }, codeLine: 1, desc: `Insert ${v} into BST` }); }
  const out = [];
  function inorder(node) { if (!node) return; inorder(node.left); out.push(node.val); push({ array: out.concat(a.slice(out.length)), hl: { active: [out.length - 1], sorted: range(0, out.length) }, vars: { v: node.val }, view: 'tree', viewData: { root: toTree(root), current: node.val }, codeLine: 2, desc: `In-order visit ${node.val}` }); inorder(node.right); }
  inorder(root);
  for (let i = 0; i < n; i++) a[i] = out[i];
  push({ array: arr(a), hl: { sorted: range(0, n) }, vars: {}, view: 'tree', viewData: { root: toTree(root) }, codeLine: 0, desc: 'Sorted' });
  return { steps, code };
}

// ── Bitonic Sort ──
export function bitonicSort(input) {
  const a = arr(input); const stats = newStats(); const steps = [];
  const code = ['bitonicSort(low, cnt, dir):', '  if cnt > 1:', '    k = cnt/2', '    bitonicSort(low, k, asc)', '    bitonicSort(low+k, k, desc)', '    bitonicMerge(low, cnt, dir)', 'compareAndSwap(i, j, dir)'];
  const push = (p) => steps.push(mkStep(p, stats));
  let n = 1; while (n < input.length) n <<= 1;
  const arr2 = a.concat(new Array(n - a.length).fill(Math.max(...a) + 1));
  function cmpSwap(i, j, dir) { stats.comparisons++; if (dir === (arr2[i] > arr2[j])) { [arr2[i], arr2[j]] = [arr2[j], arr2[i]]; stats.swaps++; push({ array: arr2.slice(0, input.length), hl: { swap: [i, j] }, vars: { i, j, dir }, codeLine: 6, desc: `Compare-swap A[${i}], A[${j}]` }); } else { push({ array: arr2.slice(0, input.length), hl: { compare: [i, j] }, vars: { i, j, dir }, codeLine: 6, desc: `Compare A[${i}], A[${j}] — no swap` }); } }
  function merge(lo, cnt, dir) { if (cnt > 1) { const k = cnt >> 1; for (let i = lo; i < lo + k; i++) cmpSwap(i, i + k, dir); merge(lo, k, dir); merge(lo + k, k, dir); } }
  function sort(lo, cnt, dir) { if (cnt > 1) { const k = cnt >> 1; sort(lo, k, 1); sort(lo + k, k, 0); merge(lo, cnt, dir); } }
  sort(0, n, 1);
  for (let i = 0; i < input.length; i++) a[i] = arr2[i];
  push({ array: arr(a), hl: { sorted: range(0, input.length) }, vars: {}, codeLine: 0, desc: 'Sorted' });
  return { steps, code };
}

// ── IntroSort (quick + heap + insertion fallback) ──
export function introSort(input) {
  const a = arr(input); const stats = newStats(); const steps = [];
  const code = ['introSort(lo, hi, depth):', '  if hi-lo < 16: insertionSort', '  elif depth == 0: heapSort', '  else: partition (quick) recurse'];
  const push = (p) => steps.push(mkStep(p, stats));
  const n = a.length; const dl = 2 * Math.floor(Math.log2(Math.max(n, 1)));
  function ins(lo, hi) { for (let i = lo + 1; i <= hi; i++) { const key = a[i]; let j = i - 1; while (j >= lo && a[j] > key) { stats.comparisons++; a[j + 1] = a[j]; stats.assignments++; j--; } a[j + 1] = key; stats.assignments++; } push({ array: arr(a), hl: { range: [lo, hi] }, vars: { lo, hi, mode: 'insertion' }, codeLine: 2, desc: `Insertion sort [${lo}..${hi}]` }); }
  function heap(lo, hi) { const size = hi - lo + 1; function hf(i, sz) { while (true) { let lar = i, l = 2 * (i - lo) + 1 + lo, r = 2 * (i - lo) + 2 + lo; if (l < lo + sz && a[l] > a[lar]) lar = l; if (r < lo + sz && a[r] > a[lar]) lar = r; if (lar === i) break; [a[i], a[lar]] = [a[lar], a[i]]; stats.swaps++; i = lar; } } for (let i = lo + (size >> 1) - 1; i >= lo; i--) hf(i, size); for (let e = hi; e > lo; e--) { [a[lo], a[e]] = [a[e], a[lo]]; stats.swaps++; hf(lo, e - lo); } push({ array: arr(a), hl: { range: [lo, hi] }, vars: { lo, hi, mode: 'heap' }, codeLine: 2, desc: `Heap sort [${lo}..${hi}]` }); }
  function qs(lo, hi, depth) {
    if (hi - lo < 16) { ins(lo, hi); return; }
    if (depth === 0) { heap(lo, hi); return; }
    const piv = a[hi]; let i = lo;
    push({ array: arr(a), hl: { pivot: hi, range: [lo, hi] }, vars: { lo, hi, depth, mode: 'quick', pivot: piv }, codeLine: 3, desc: `Quick partition [${lo}..${hi}] pivot=${piv}` });
    for (let j = lo; j < hi; j++) { stats.comparisons++; if (a[j] < piv) { [a[i], a[j]] = [a[j], a[i]]; stats.swaps++; i++; } }
    [a[i], a[hi]] = [a[hi], a[i]]; stats.swaps++;
    push({ array: arr(a), hl: { swap: [i, hi], range: [lo, hi] }, vars: { lo, hi, depth, mode: 'quick' }, codeLine: 3, desc: `Place pivot at ${i}` });
    qs(lo, i - 1, depth - 1); qs(i + 1, hi, depth - 1);
  }
  qs(0, n - 1, dl);
  push({ array: arr(a), hl: { sorted: range(0, n) }, vars: {}, codeLine: 0, desc: 'Sorted' });
  return { steps, code };
}

// ── Stooge Sort ──
export function stoogeSort(input) {
  const a = arr(input); const stats = newStats(); const steps = [];
  const code = ['stooge(l, r):', '  if arr[l] > arr[r]: swap', '  if r-l+1 > 2:', '    t = (r-l+1)//3', '    stooge(l, r-t); stooge(l+t, r); stooge(l, r-t)'];
  const push = (p) => steps.push(mkStep(p, stats));
  const n = a.length; const stack = [];
  function stooge(l, r) {
    stats.recursiveCalls++; stack.push({ name: 'stooge', args: `l=${l}, r=${r}` });
    stats.comparisons++;
    push({ array: arr(a), hl: { compare: [l, r], range: [l, r] }, vars: { l, r }, codeLine: 2, callStack: stack.slice(), desc: `Compare A[${l}]=${a[l]} and A[${r}]=${a[r]}` });
    if (a[l] > a[r]) { [a[l], a[r]] = [a[r], a[l]]; stats.swaps++; push({ array: arr(a), hl: { swap: [l, r], range: [l, r] }, vars: { l, r }, codeLine: 2, callStack: stack.slice(), desc: `Swap ends` }); }
    if (r - l + 1 > 2) { const t = Math.floor((r - l + 1) / 3); stooge(l, r - t); stooge(l + t, r); stooge(l, r - t); }
    stack.pop();
  }
  stooge(0, n - 1);
  push({ array: arr(a), hl: { sorted: range(0, n) }, vars: {}, codeLine: 0, desc: 'Sorted' });
  return { steps, code };
}

// ── Bogo Sort (educational only) ──
export function bogoSort(input) {
  const a = arr(input); const stats = newStats(); const steps = [];
  const code = ['while not sorted(arr):', '  shuffle(arr)'];
  const push = (p) => steps.push(mkStep(p, stats));
  const n = a.length; let attempts = 0; const MAX = 5000;
  function sorted() { for (let i = 1; i < n; i++) { stats.comparisons++; if (a[i - 1] > a[i]) return false; } return true; }
  while (!sorted() && attempts < MAX) {
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; stats.swaps++; }
    attempts++;
    push({ array: arr(a), vars: { attempts }, codeLine: 1, desc: `Shuffle attempt ${attempts}` });
  }
  push({ array: arr(a), hl: { sorted: range(0, n) }, vars: { attempts }, codeLine: 0, desc: attempts < MAX ? 'Sorted (lucky!)' : 'Gave up after 5000 shuffles' });
  return { steps, code };
}

function range(a, b) { return Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i); }

export const sortingAlgorithms = [
  { id: 'bubbleSort', name: 'Bubble Sort', category: 'Sorting', view: 'bar', inputType: 'array', generate: bubbleSort, description: 'Repeatedly swaps adjacent out-of-order pairs, bubbling the largest to the end each pass.', complexity: { best: 'O(n)', avg: 'O(n²)', worst: 'O(n²)', space: 'O(1)' }, stable: true, inplace: true, useCases: 'Teaching, tiny arrays', advantages: 'Simple, stable', disadvantages: 'Very slow on large data' },
  { id: 'selectionSort', name: 'Selection Sort', category: 'Sorting', view: 'bar', inputType: 'array', generate: selectionSort, description: 'Selects the minimum from the unsorted region and swaps it into place.', complexity: { best: 'O(n²)', avg: 'O(n²)', worst: 'O(n²)', space: 'O(1)' }, stable: false, inplace: true, useCases: 'Small arrays, minimal writes', advantages: 'Few writes', disadvantages: 'Not stable, slow' },
  { id: 'insertionSort', name: 'Insertion Sort', category: 'Sorting', view: 'bar', inputType: 'array', generate: insertionSort, description: 'Builds a sorted prefix by inserting each element into its correct spot.', complexity: { best: 'O(n)', avg: 'O(n²)', worst: 'O(n²)', space: 'O(1)' }, stable: true, inplace: true, useCases: 'Small / nearly sorted arrays', advantages: 'Fast on nearly-sorted', disadvantages: 'Quadratic worst case' },
  { id: 'quickSort', name: 'Quick Sort', category: 'Sorting', view: 'bar', inputType: 'array', generate: quickSort, description: 'Partitions around a pivot, then recurses on each side (Lomuto scheme).', complexity: { best: 'O(n log n)', avg: 'O(n log n)', worst: 'O(n²)', space: 'O(log n)' }, stable: false, inplace: true, useCases: 'General-purpose in-memory sort', advantages: 'Fast average case', disadvantages: 'O(n²) worst case' },
  { id: 'randomizedQuickSort', name: 'Randomized Quick Sort', category: 'Sorting', view: 'bar', inputType: 'array', generate: randomizedQuickSort, description: 'Quick sort with a randomly chosen pivot to avoid worst-case inputs.', complexity: { best: 'O(n log n)', avg: 'O(n log n)', worst: 'O(n²)', space: 'O(log n)' }, stable: false, inplace: true, useCases: 'Avoiding adversarial inputs', advantages: 'Expected O(n log n)', disadvantages: 'Still O(n²) in theory' },
  { id: 'threeWayQuickSort', name: '3-Way Quick Sort', category: 'Sorting', view: 'bar', inputType: 'array', generate: threeWayQuickSort, description: 'Partitions into < pivot, = pivot, > pivot regions — efficient with duplicates.', complexity: { best: 'O(n)', avg: 'O(n log n)', worst: 'O(n²)', space: 'O(log n)' }, stable: false, inplace: true, useCases: 'Arrays with many duplicates', advantages: 'Handles duplicates well', disadvantages: 'More complex partition' },
  { id: 'mergeSort', name: 'Merge Sort (top-down)', category: 'Sorting', view: 'bar', inputType: 'array', generate: mergeSort, description: 'Recursively splits the array, then merges sorted halves.', complexity: { best: 'O(n log n)', avg: 'O(n log n)', worst: 'O(n log n)', space: 'O(n)' }, stable: true, inplace: false, useCases: 'Stable sort, linked lists, external', advantages: 'Guaranteed O(n log n), stable', disadvantages: 'O(n) extra space' },
  { id: 'mergeSortBottomUp', name: 'Merge Sort (bottom-up)', category: 'Sorting', view: 'bar', inputType: 'array', generate: mergeSortBottomUp, description: 'Iteratively merges runs of increasing width — no recursion.', complexity: { best: 'O(n log n)', avg: 'O(n log n)', worst: 'O(n log n)', space: 'O(n)' }, stable: true, inplace: false, useCases: 'Avoiding recursion', advantages: 'No recursion overhead', disadvantages: 'O(n) space' },
  { id: 'heapSort', name: 'Heap Sort', category: 'Sorting', view: 'bar', inputType: 'array', generate: heapSort, description: 'Builds a max-heap, then repeatedly extracts the root to the end.', complexity: { best: 'O(n log n)', avg: 'O(n log n)', worst: 'O(n log n)', space: 'O(1)' }, stable: false, inplace: true, useCases: 'Guaranteed O(n log n) in-place', advantages: 'No worst-case blowup', disadvantages: 'Not stable, poor cache' },
  { id: 'countingSort', name: 'Counting Sort', category: 'Sorting', view: 'bar', inputType: 'array', generate: countingSort, description: 'Counts occurrences, computes prefix sums, places elements by count.', complexity: { best: 'O(n+k)', avg: 'O(n+k)', worst: 'O(n+k)', space: 'O(n+k)' }, stable: true, inplace: false, useCases: 'Small integer ranges', advantages: 'Linear time', disadvantages: 'Needs bounded range' },
  { id: 'radixSort', name: 'Radix Sort (LSD)', category: 'Sorting', view: 'bar', inputType: 'array', generate: radixSort, description: 'Sorts by each digit place using a stable counting pass.', complexity: { best: 'O(nk)', avg: 'O(nk)', worst: 'O(nk)', space: 'O(n+k)' }, stable: true, inplace: false, useCases: 'Fixed-width integers', advantages: 'Linear-ish for fixed keys', disadvantages: 'Needs integers' },
  { id: 'bucketSort', name: 'Bucket Sort', category: 'Sorting', view: 'bar', inputType: 'array', generate: bucketSort, description: 'Distributes into buckets, sorts each, then concatenates.', complexity: { best: 'O(n+k)', avg: 'O(n+k)', worst: 'O(n²)', space: 'O(n+k)' }, stable: true, inplace: false, useCases: 'Uniformly distributed data', advantages: 'Fast on uniform data', disadvantages: 'Bad on skewed data' },
  { id: 'shellSort', name: 'Shell Sort', category: 'Sorting', view: 'bar', inputType: 'array', generate: shellSort, description: 'Insertion sort with decreasing gaps — elements jump far then settle.', complexity: { best: 'O(n log n)', avg: 'O(n^1.25)', worst: 'O(n²)', space: 'O(1)' }, stable: false, inplace: true, useCases: 'Medium arrays', advantages: 'Better than insertion', disadvantages: 'Gap-dependent complexity' },
  { id: 'cocktailSort', name: 'Cocktail Shaker Sort', category: 'Sorting', view: 'bar', inputType: 'array', generate: cocktailSort, description: 'Bidirectional bubble sort — forward then backward each pass.', complexity: { best: 'O(n)', avg: 'O(n²)', worst: 'O(n²)', space: 'O(1)' }, stable: true, inplace: true, useCases: 'Teaching', advantages: 'Slightly better than bubble', disadvantages: 'Still quadratic' },
  { id: 'combSort', name: 'Comb Sort', category: 'Sorting', view: 'bar', inputType: 'array', generate: combSort, description: 'Bubble sort with a shrinking gap to eliminate turtles quickly.', complexity: { best: 'O(n log n)', avg: 'O(n²/2^p)', worst: 'O(n²)', space: 'O(1)' }, stable: false, inplace: true, useCases: 'Improved bubble sort', advantages: 'Faster than bubble', disadvantages: 'Not stable' },
  { id: 'gnomeSort', name: 'Gnome Sort', category: 'Sorting', view: 'bar', inputType: 'array', generate: gnomeSort, description: 'A gnome moves forward when sorted, swaps and steps back otherwise.', complexity: { best: 'O(n)', avg: 'O(n²)', worst: 'O(n²)', space: 'O(1)' }, stable: true, inplace: true, useCases: 'Teaching', advantages: 'Trivial code', disadvantages: 'Quadratic' },
  { id: 'cycleSort', name: 'Cycle Sort', category: 'Sorting', view: 'bar', inputType: 'array', generate: cycleSort, description: 'Writes each element to its final position in cycles — minimal writes.', complexity: { best: 'O(n²)', avg: 'O(n²)', worst: 'O(n²)', space: 'O(1)' }, stable: false, inplace: true, useCases: 'Minimizing writes (flash)', advantages: 'Fewest writes', disadvantages: 'Quadratic, complex' },
  { id: 'oddEvenSort', name: 'Odd-Even Sort', category: 'Sorting', view: 'bar', inputType: 'array', generate: oddEvenSort, description: 'Alternates comparing odd-indexed and even-indexed pairs.', complexity: { best: 'O(n)', avg: 'O(n²)', worst: 'O(n²)', space: 'O(1)' }, stable: true, inplace: true, useCases: 'Parallel teaching', advantages: 'Parallelizable', disadvantages: 'Quadratic' },
  { id: 'pancakeSort', name: 'Pancake Sort', category: 'Sorting', view: 'bar', inputType: 'array', generate: pancakeSort, description: 'Flips prefixes to move the largest to the bottom each round.', complexity: { best: 'O(n)', avg: 'O(n²)', worst: 'O(n²)', space: 'O(1)' }, stable: false, inplace: true, useCases: 'Teaching, prefix-reversal problems', advantages: 'Interesting model', disadvantages: 'Quadratic' },
  { id: 'timSort', name: 'Tim Sort (simplified)', category: 'Sorting', view: 'bar', inputType: 'array', generate: timSort, description: 'Insertion-sorts small runs then merges them — the basis of real Tim Sort.', complexity: { best: 'O(n)', avg: 'O(n log n)', worst: 'O(n log n)', space: 'O(n)' }, stable: true, inplace: false, useCases: 'Real-world standard (Python, Java)', advantages: 'Fast on real data', disadvantages: 'Complex to implement fully' },
  { id: 'treeSort', name: 'Tree Sort', category: 'Sorting', view: 'tree', inputType: 'array', generate: treeSort, description: 'Inserts all elements into a BST, then reads them in-order.', complexity: { best: 'O(n log n)', avg: 'O(n log n)', worst: 'O(n²)', space: 'O(n)' }, stable: false, inplace: false, useCases: 'Streaming into a sorted structure', advantages: 'Natural for streaming', disadvantages: 'O(n²) if unbalanced' },
  { id: 'bitonicSort', name: 'Bitonic Sort', category: 'Sorting', view: 'bar', inputType: 'array', generate: bitonicSort, description: 'Builds bitonic sequences and merges — designed for parallel hardware.', complexity: { best: 'O(log²n)', avg: 'O(log²n)', worst: 'O(log²n)', space: 'O(n log n)' }, stable: false, inplace: false, useCases: 'Parallel sorting networks', advantages: 'Highly parallel', disadvantages: 'Needs power-of-two size' },
  { id: 'introSort', name: 'IntroSort', category: 'Sorting', view: 'bar', inputType: 'array', generate: introSort, description: 'Quick sort that falls back to heap sort at depth limit and insertion sort for small ranges.', complexity: { best: 'O(n log n)', avg: 'O(n log n)', worst: 'O(n log n)', space: 'O(log n)' }, stable: false, inplace: true, useCases: 'C++ std::sort basis', advantages: 'Best practical worst case', disadvantages: 'Complex' },
  { id: 'stoogeSort', name: 'Stooge Sort', category: 'Sorting', view: 'bar', inputType: 'array', generate: stoogeSort, description: 'Recursively sorts the first 2/3, last 2/3, then first 2/3 again — very inefficient.', complexity: { best: 'O(n^2.71)', avg: 'O(n^2.71)', worst: 'O(n^2.71)', space: 'O(n)' }, stable: false, inplace: true, useCases: 'Educational only', advantages: 'Interesting recursion', disadvantages: 'Extremely slow' },
  { id: 'bogoSort', name: 'Bogo Sort', category: 'Sorting', view: 'bar', inputType: 'array', generate: bogoSort, description: 'Shuffles randomly until sorted. EXTREMELY INEFFICIENT — educational only.', complexity: { best: 'O(n)', avg: 'O(n·n!)', worst: 'O(∞)', space: 'O(1)' }, stable: false, inplace: true, useCases: 'Educational joke', advantages: 'None', disadvantages: 'Unbounded runtime' },
];