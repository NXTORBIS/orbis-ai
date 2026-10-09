import { mkStep, newStats } from '../stepUtils.js';

// Greedy + hashing. 

// ── Activity Selection (greedy) ──
export function activitySelection(input) {
  const stats = newStats(); const steps = [];
  const acts = (Array.isArray(input) ? input.slice(0, 8).map((v, i) => ({ start: i, end: v })) : [1, 2, 3, 4, 5, 6].map((v, i) => ({ start: i, end: v + 2 })));
  // Build activities from input as end times with staggered starts
  const items = acts.map((a, i) => ({ id: i, start: a.start, end: a.end })).sort((a, b) => a.end - b.end);
  const code = ['sort by finish time', 'selected = [first]', 'for i in 1..n-1:', '  if start[i] >= last_end: select; update last_end'];
  const push = (p) => steps.push(mkStep(p, stats));
  const selected = [];
  let lastEnd = -1;
  push({ array: items.map((it) => it.end), view: 'greedy', viewData: { items: items.map((it) => ({ ...it })), selected: [] }, vars: {}, codeLine: 0, desc: 'Sort activities by finish time' });
  for (let i = 0; i < items.length; i++) {
    stats.comparisons++;
    if (items[i].start >= lastEnd) { selected.push(items[i].id); lastEnd = items[i].end; push({ array: items.map((it) => it.end), view: 'greedy', viewData: { items: items.map((it) => ({ ...it })), selected: selected.slice(), current: i }, vars: { i, lastEnd }, codeLine: 3, desc: `Select activity ${items[i].id} (end ${lastEnd})` }); }
    else { push({ array: items.map((it) => it.end), view: 'greedy', viewData: { items: items.map((it) => ({ ...it })), selected: selected.slice(), reject: i }, vars: { i }, codeLine: 3, desc: `Reject activity ${items[i].id} (overlaps)` }); }
  }
  push({ array: items.map((it) => it.end), view: 'greedy', viewData: { items: items.map((it) => ({ ...it })), selected: selected.slice(), done: true }, vars: { count: selected.length }, codeLine: 0, desc: `${selected.length} activities selected` });
  return { steps, code };
}

// ── Fractional Knapsack (greedy) ──
export function fractionalKnapsack(input) {
  const stats = newStats(); const steps = [];
  const W = 15;
  const items = [{ w: 5, v: 30 }, { w: 10, v: 40 }, { w: 7, v: 35 }, { w: 3, v: 20 }].map((it) => ({ ...it, ratio: it.v / it.w })).sort((a, b) => b.ratio - a.ratio);
  const code = ['sort by value/weight ratio', 'for item in items:', '  if item.w <= W: take all', '  else: take fraction W/item.w'];
  const push = (p) => steps.push(mkStep(p, stats));
  let cap = W, total = 0;
  push({ array: items.map((it) => it.ratio), view: 'greedy', viewData: { items: items.map((it) => ({ ...it })), cap, total: 0 }, vars: { W }, codeLine: 0, desc: 'Sort by value/weight ratio' });
  for (let i = 0; i < items.length; i++) {
    if (cap <= 0) break;
    const take = Math.min(items[i].w, cap);
    const gain = take * items[i].ratio; total += gain; cap -= take; stats.assignments++;
    push({ array: items.map((it) => it.ratio), view: 'greedy', viewData: { items: items.map((it) => ({ ...it })), current: i, cap, total, taken: take }, vars: { i, take, total, cap }, codeLine: take === items[i].w ? 2 : 3, desc: `Take ${take} of item ${i} → +${gain.toFixed(1)}` });
  }
  push({ array: items.map((it) => it.ratio), view: 'greedy', viewData: { items: items.map((it) => ({ ...it })), done: true, total }, vars: { total: total.toFixed(2) }, codeLine: 0, desc: `Total value = ${total.toFixed(2)}` });
  return { steps, code };
}

// ── Hash Table: separate chaining ──
export function hashChaining(input) {
  const stats = newStats(); const steps = [];
  const a = [...input].slice(0, 12);
  const code = ['h = key % size', 'buckets[h].append(key)', 'search: scan bucket[h]'];
  const push = (p) => steps.push(mkStep(p, stats));
  const size = 7; const buckets = Array.from({ length: size }, () => []);
  push({ array: a, view: 'buckets', viewData: { buckets: buckets.map((b) => b.slice()), size, op: 'init' }, vars: { size }, codeLine: 0, desc: `Hash table, ${size} buckets (chaining)` });
  for (const key of a) {
    const h = ((key % size) + size) % size; stats.accesses++;
    push({ array: a, view: 'buckets', viewData: { buckets: buckets.map((b) => b.slice()), size, op: 'hash', h, key }, vars: { key, h }, codeLine: 0, desc: `hash(${key}) = ${h}` });
    buckets[h].push(key); stats.assignments++;
    push({ array: a, view: 'buckets', viewData: { buckets: buckets.map((b) => b.slice()), size, op: 'insert', h, key, highlight: h }, vars: { key, h }, codeLine: 1, desc: `Insert ${key} into bucket ${h}` });
  }
  push({ array: a, view: 'buckets', viewData: { buckets: buckets.map((b) => b.slice()), size, op: 'done' }, vars: {}, codeLine: 2, desc: 'All keys inserted' });
  return { steps, code };
}

// ── Hash Table: linear probing ──
export function hashProbing(input) {
  const stats = newStats(); const steps = [];
  const a = [...input].slice(0, 10);
  const code = ['h = key % size', 'while table[h] is full: h = (h+1) % size', 'table[h] = key'];
  const push = (p) => steps.push(mkStep(p, stats));
  const size = 11; const table = new Array(size).fill(null);
  push({ array: a, view: 'buckets', viewData: { buckets: table.map((v) => (v === null ? '·' : v)), size, op: 'init', probing: true }, vars: { size }, codeLine: 0, desc: `Hash table, ${size} slots (linear probing)` });
  for (const key of a) {
    let h = ((key % size) + size) % size; stats.accesses++;
    push({ array: a, view: 'buckets', viewData: { buckets: table.map((v) => (v === null ? '·' : v)), size, op: 'hash', h, key, probing: true }, vars: { key, h }, codeLine: 0, desc: `hash(${key}) = ${h}` });
    let probes = 0;
    while (table[h] !== null && probes < size) { stats.comparisons++; const old = h; h = (h + 1) % size; probes++; push({ array: a, view: 'buckets', viewData: { buckets: table.map((v) => (v === null ? '·' : v)), size, op: 'probe', h, key, probing: true, from: old }, vars: { key, h, probes }, codeLine: 1, desc: `Collision → probe ${h}` }); }
    table[h] = key; stats.assignments++;
    push({ array: a, view: 'buckets', viewData: { buckets: table.map((v) => (v === null ? '·' : v)), size, op: 'insert', h, key, probing: true, highlight: h }, vars: { key, h, probes }, codeLine: 2, desc: `Place ${key} at slot ${h}` });
  }
  push({ array: a, view: 'buckets', viewData: { buckets: table.map((v) => (v === null ? '·' : v)), size, op: 'done', probing: true }, vars: {}, codeLine: 2, desc: 'All keys placed' });
  return { steps, code };
}

export const greedyAlgorithms = [
  { id: 'activitySelection', name: 'Activity Selection', category: 'Greedy', view: 'greedy', inputType: 'array', generate: activitySelection, description: 'Selects the maximum number of non-overlapping activities by finish time.', complexity: { best: 'O(n log n)', avg: 'O(n log n)', worst: 'O(n log n)', space: 'O(1)' }, stable: true, inplace: true, useCases: 'Interval scheduling', advantages: 'Optimal, simple', disadvantages: 'Needs sorted input' },
  { id: 'fractionalKnapsack', name: 'Fractional Knapsack', category: 'Greedy', view: 'greedy', inputType: 'none', generate: fractionalKnapsack, description: 'Takes items by best value/weight ratio, including fractions.', complexity: { best: 'O(n log n)', avg: 'O(n log n)', worst: 'O(n log n)', space: 'O(1)' }, stable: true, inplace: true, useCases: 'Divisible goods', advantages: 'Optimal for fractional', disadvantages: 'Not for 0/1' },
];

export const hashingAlgorithms = [
  { id: 'hashChaining', name: 'Hash Table (chaining)', category: 'Hashing', view: 'buckets', inputType: 'array', generate: hashChaining, description: 'Separate chaining resolves collisions with linked lists per bucket.', complexity: { best: 'O(1)', avg: 'O(1)', worst: 'O(n)', space: 'O(n)' }, stable: true, inplace: false, useCases: 'Dictionaries', advantages: 'Simple collision handling', disadvantages: 'Cache-unfriendly' },
  { id: 'hashProbing', name: 'Hash Table (linear probing)', category: 'Hashing', view: 'buckets', inputType: 'array', generate: hashProbing, description: 'Linear probing resolves collisions by scanning forward.', complexity: { best: 'O(1)', avg: 'O(1)', worst: 'O(n)', space: 'O(n)' }, stable: false, inplace: true, useCases: 'Open addressing', advantages: 'Cache-friendly', disadvantages: 'Clustering' },
];