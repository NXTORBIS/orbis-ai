// Shared helpers for algorithm step generators.
// Every algorithm executes for real and records a sequence of "steps" —
// each step is a full snapshot of the algorithm's state at one operation.
// The UI scrubs through these steps; it never fakes animation.

export const newStats = () => ({
  comparisons: 0,
  swaps: 0,
  assignments: 0,
  accesses: 0,
  reads: 0,
  writes: 0,
  recursiveCalls: 0,
  queueOps: 0,
  stackOps: 0,
  nodeVisits: 0,
  edgeTraversals: 0,
  heapOps: 0,
});

// Build a single step snapshot. `stats` is the live counters object; we copy it
// so each step carries the cumulative totals up to that moment.
export function mkStep(partial, stats) {
  return {
    array: [],
    hl: {},
    vars: {},
    stats: stats ? { ...stats } : newStats(),
    desc: '',
    codeLine: 0,
    callStack: [],
    view: 'bar',
    viewData: null,
    ...partial,
  };
}

// Standard highlight keys used across bar-view algorithms:
// compare: [i,j]   swap: [i,j]   sorted: [...]   active: [...]
// current: i       pivot: i     range: [lo,hi]  found: i
// eliminated: [lo,hi]  (search range already ruled out)

export const COLORS = {
  idle: 'bg-cyan-j/40',
  compare: 'bg-amber-500',
  swap: 'bg-red-500',
  active: 'bg-violet-500',
  current: 'bg-fuchsia-500',
  pivot: 'bg-orange-500',
  sorted: 'bg-green-500',
  range: 'bg-slate-500/40',
  found: 'bg-emerald-500',
  eliminated: 'bg-zinc-700/50',
  path: 'bg-emerald-400',
  visited: 'bg-sky-500/70',
};