/**
 * A constraint-programming core: finite domains, propagation, and depth-first search
 * with branch and bound — plus independent exact solvers (the Hungarian algorithm for
 * assignment, dynamic programming for packing) whose answers are used to check the
 * search rather than being trusted blindly.
 *
 * Every solver returns a solution and the search's own account of itself (nodes
 * explored, branches pruned, whether optimality was proved). Callers must still run
 * the matching verify* function: it re-checks the finished solution against the raw
 * model, independently of the state the search carried.
 */

import { SearchStopped, yieldToBrowser } from './run';

// ── search bookkeeping ────────────────────────────────────────────────────────
// The search runs on the main thread, so it hands control back to the browser every
// few thousand nodes. That is where progress is reported, cancellation is noticed and
// the time limit is enforced — a stop is thrown, caught by the caller, and the best
// solution found so far is returned with an honest status.
function clock({ onProgress, signal, timeLimitMs = 8000, every = 1200 }) {
  const started = performance.now();
  let nodes = 0;
  return async (snapshot) => {
    nodes += 1;
    if (nodes % every !== 0) return;
    await yieldToBrowser();
    const elapsed = performance.now() - started;
    onProgress?.({ nodes, elapsed, ...snapshot });
    if (signal?.aborted) throw new SearchStopped('cancelled');
    if (elapsed > timeLimitMs) throw new SearchStopped('timeout');
  };
}

// ── assignment ────────────────────────────────────────────────────────────────

/**
 * Hungarian algorithm (Kuhn–Munkres with potentials) — exact, and independent of the
 * search. Blocked pairs are given a prohibitive cost, so a solution that needs one is
 * reported as infeasible instead of silently expensive.
 */
export function hungarian(costs, forbidden = [], blockedCost = 1e7) {
  const rows = costs.length;
  const cols = costs[0]?.length ?? 0;
  const size = Math.max(rows, cols);
  const blocked = new Set(forbidden.map(([r, c]) => `${r}:${c}`));
  const a = Array.from({ length: size }, (_, i) =>
    Array.from({ length: size }, (_, j) => {
      if (i >= rows || j >= cols) return 0;
      return blocked.has(`${i}:${j}`) ? blockedCost : costs[i][j];
    }));

  const u = new Array(size + 1).fill(0);
  const v = new Array(size + 1).fill(0);
  const p = new Array(size + 1).fill(0);
  const way = new Array(size + 1).fill(0);
  for (let i = 1; i <= size; i += 1) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(size + 1).fill(Infinity);
    const used = new Array(size + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= size; j += 1) {
        if (used[j]) continue;
        const cur = a[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= size; j += 1) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }

  const assignment = new Array(rows).fill(-1);
  let cost = 0;
  let feasible = rows > 0 && cols > 0;
  for (let j = 1; j <= size; j += 1) {
    const row = p[j] - 1;
    const col = j - 1;
    if (row >= rows) continue; // a dummy row using a real column
    if (col >= cols) {
      feasible = false; // a real row left over: no complete assignment exists
      continue;
    }
    assignment[row] = col;
    if (a[row][col] >= blockedCost) feasible = false;
    else cost += a[row][col];
  }
  if (assignment.some((col) => col < 0)) feasible = false;
  return { assignment, cost: feasible ? cost : Infinity, feasible };
}

export function verifyAssignment({ costs, forbidden = [] }, assignment) {
  const violations = [];
  const blocked = new Set(forbidden.map(([r, c]) => `${r}:${c}`));
  const seen = new Set();
  let cost = 0;
  assignment.forEach((col, row) => {
    if (col == null || col < 0) {
      violations.push(`row ${row} has no column`);
      return;
    }
    if (col >= (costs[0]?.length ?? 0)) {
      violations.push(`row ${row} points at a column outside the matrix`);
      return;
    }
    if (seen.has(col)) violations.push(`column ${col} is used twice`);
    seen.add(col);
    if (blocked.has(`${row}:${col}`)) violations.push(`row ${row} uses a blocked pair`);
    cost += costs[row][col];
  });
  return { ok: violations.length === 0, violations, cost };
}

export async function solveAssignment({
  costs,
  forbidden = [],
  useIncumbent = true,
  onProgress,
  signal,
  timeLimitMs,
}) {
  const rows = costs.length;
  const cols = costs[0]?.length ?? 0;
  const blocked = new Set(forbidden.map(([r, c]) => `${r}:${c}`));
  const domains = Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => col).filter((col) => !blocked.has(`${row}:${col}`)));
  if (!rows || !cols || domains.some((domain) => !domain.length)) {
    return { status: 'infeasible', best: null, nodes: 0, prunes: 0, exact: { feasible: false } };
  }

  const exact = hungarian(costs, forbidden);
  let best = useIncumbent && exact.feasible
    ? { assignment: exact.assignment.slice(), cost: exact.cost }
    : null;
  let source = useIncumbent && exact.feasible ? 'exact solver incumbent' : 'search';

  const used = new Array(cols).fill(false);
  const current = new Array(rows).fill(-1);
  const tick = clock({ onProgress, signal, timeLimitMs });
  let nodes = 0;
  let prunes = 0;
  let status = 'optimal';

  const dfs = async (partial) => {
    nodes += 1;
    await tick({ incumbent: best ? best.cost : null, prunes });

    let pick = -1;
    let pickDomain = null;
    let bound = partial;
    for (let row = 0; row < rows; row += 1) {
      if (current[row] >= 0) continue;
      const available = domains[row].filter((col) => !used[col]);
      if (!available.length) {
        prunes += 1;
        return;
      }
      let cheapest = Infinity;
      for (const col of available) if (costs[row][col] < cheapest) cheapest = costs[row][col];
      bound += cheapest;
      if (pick < 0 || available.length < pickDomain.length) {
        pick = row;
        pickDomain = available;
      }
    }

    if (pick < 0) {
      const check = verifyAssignment({ costs, forbidden }, current);
      if (check.ok && (!best || check.cost < best.cost)) {
        best = { assignment: current.slice(), cost: check.cost };
        source = 'search';
      }
      return;
    }
    // Nothing left to do can beat the incumbent: the branch is closed.
    if (best && bound >= best.cost) {
      prunes += 1;
      return;
    }

    pickDomain.sort((x, y) => costs[pick][x] - costs[pick][y]);
    for (const col of pickDomain) {
      current[pick] = col;
      used[col] = true;
      await dfs(partial + costs[pick][col]);
      current[pick] = -1;
      used[col] = false;
    }
  };

  try {
    await dfs(0);
  } catch (error) {
    if (!(error instanceof SearchStopped)) throw error;
    status = error.reason;
  }

  const agreement = !best || !exact.feasible
    ? 'unknown'
    : best.cost === exact.cost
      ? 'agree'
      : best.cost > exact.cost ? 'search worse' : 'search better';

  return {
    status,
    best,
    source,
    nodes,
    prunes,
    exact: { feasible: exact.feasible, cost: exact.feasible ? exact.cost : null, assignment: exact.assignment },
    agreement,
  };
}

// ── packing ──────────────────────────────────────────────────────────────────

/** Exact 0/1 knapsack by dynamic programming — the reference the search is checked against. */
export function knapsackExact({ weights, values, capacity }) {
  const cap = Math.max(0, Math.round(capacity));
  const best = new Array(cap + 1).fill(0);
  const take = Array.from({ length: weights.length }, () => new Uint8Array(cap + 1));
  for (let i = 0; i < weights.length; i += 1) {
    const weight = Math.round(weights[i]);
    const value = values[i];
    for (let c = cap; c >= weight; c -= 1) {
      const candidate = best[c - weight] + value;
      if (candidate > best[c]) {
        best[c] = candidate;
        take[i][c] = 1;
      }
    }
  }
  const chosen = [];
  let c = cap;
  for (let i = weights.length - 1; i >= 0; i -= 1) {
    if (take[i][c]) {
      chosen.push(i);
      c -= Math.round(weights[i]);
    }
  }
  chosen.reverse();
  return { value: best[cap], chosen, weight: chosen.reduce((sum, i) => sum + Math.round(weights[i]), 0) };
}

export function verifyKnapsack({ weights, values, capacity }, chosen) {
  const violations = [];
  const unique = [...new Set(chosen)];
  if (unique.length !== chosen.length) violations.push('the same item is listed more than once');
  const weight = unique.reduce((sum, i) => sum + Math.round(weights[i]), 0);
  const value = unique.reduce((sum, i) => sum + values[i], 0);
  if (weight > Math.round(capacity)) violations.push(`total weight ${weight} exceeds the capacity`);
  return { ok: violations.length === 0, violations, weight, value };
}

export async function solveKnapsack({ weights, values, capacity, onProgress, signal, timeLimitMs }) {
  const cap = Math.max(0, Math.round(capacity));
  const free = [];
  weights.forEach((weight, i) => { if (Math.round(weight) === 0) free.push(i); });
  const freeValue = free.reduce((sum, i) => sum + values[i], 0);
  const order = weights
    .map((weight, i) => i)
    .filter((i) => !free.includes(i))
    .sort((a, b) => values[b] / weights[b] - values[a] / weights[a]);

  const exact = knapsackExact({ weights, values, capacity: cap });
  const tick = clock({ onProgress, signal, timeLimitMs });
  let best = null;
  let nodes = 0;
  let prunes = 0;
  // The best value still reachable, allowing fractions of the next item — an optimistic
  // bound, which is exactly what branch and bound needs to be safe.
  const relax = (index, valueLeft, weightLeft) => {
    let bound = valueLeft;
    let room = weightLeft;
    for (let i = index; i < order.length; i += 1) {
      const item = order[i];
      if (weights[item] <= room) {
        bound += values[item];
        room -= weights[item];
      } else {
        bound += (room * values[item]) / weights[item];
        break;
      }
    }
    return bound;
  };

  const dfs = async (index, value, weight, chosen) => {
    nodes += 1;
    await tick({ incumbent: best ? best.value + freeValue : null, prunes });
    if (index === order.length) {
      const check = verifyKnapsack({ weights, values, capacity: cap }, chosen);
      if (check.ok && (!best || check.value > best.value)) best = { chosen: chosen.slice(), value: check.value, weight: check.weight };
      return;
    }
    if (best && relax(index, value, weight) <= best.value) {
      prunes += 1;
      return;
    }
    const item = order[index];
    if (weight + weights[item] <= cap) {
      chosen.push(item);
      await dfs(index + 1, value + values[item], weight + weights[item], chosen);
      chosen.pop();
    }
    await dfs(index + 1, value, weight, chosen);
  };

  let status = 'optimal';
  try {
    await dfs(0, 0, 0, []);
  } catch (error) {
    if (!(error instanceof SearchStopped)) throw error;
    status = error.reason;
  }

  const solution = best ? { chosen: [...best.chosen, ...free].sort((a, b) => a - b), value: best.value + freeValue, weight: best.weight } : { chosen: free, value: freeValue, weight: 0 };
  const agreement = solution.value === exact.value ? 'agree' : solution.value > exact.value ? 'search better' : 'search worse';
  return { status, best: solution, nodes, prunes, exact, agreement };
}

// ── scheduling ───────────────────────────────────────────────────────────────

/** Recomputed from the model, never from the search's own bookkeeping. */
export function verifySchedule(jobs, starts, capacity = 1) {
  const violations = [];
  jobs.forEach((job, i) => {
    const start = starts[i];
    const name = job.name || `job ${i + 1}`;
    if (start == null || start < 0) {
      violations.push(`${name} has no start time`);
      return;
    }
    if (job.release != null && start < job.release) violations.push(`${name} starts before its release`);
    if (job.deadline != null && start + job.duration > job.deadline) violations.push(`${name} finishes after its deadline`);
    (job.predecessors ?? []).forEach((p) => {
      const finish = (starts[p] ?? 0) + jobs[p].duration;
      if (start < finish) violations.push(`${name} starts before ${jobs[p].name || `job ${p + 1}`} finishes`);
    });
  });

  const span = Math.max(0, ...jobs.map((job, i) => (starts[i] ?? 0) + job.duration));
  for (let t = 0; t < span; t += 1) {
    const load = new Map();
    jobs.forEach((job, i) => {
      const start = starts[i];
      if (start == null || t < start || t >= start + job.duration) return;
      const machine = job.machine ?? 0;
      load.set(machine, (load.get(machine) ?? 0) + 1);
    });
    load.forEach((count, machine) => {
      if (count > capacity) violations.push(`machine ${machine + 1} runs ${count} jobs at t=${t} (capacity ${capacity})`);
    });
  }
  return { ok: violations.length === 0, violations: [...new Set(violations)], makespan: span };
}

export async function solveSchedule({
  jobs,
  capacity = 1,
  onProgress,
  signal,
  timeLimitMs,
}) {
  const n = jobs.length;
  if (!n) return { status: 'infeasible', best: null, nodes: 0, prunes: 0, lowerBound: 0 };
  const duration = jobs.map((job) => Math.max(1, Math.round(job.duration)));
  const machine = jobs.map((job) => job.machine ?? 0);
  const release = jobs.map((job) => Math.round(job.release ?? 0));
  const deadline = jobs.map((job, i) => (jobs[i].deadline == null ? Infinity : Math.round(job.deadline)));
  const preds = jobs.map((job, index) => (job.predecessors ?? []).filter((p) => p >= 0 && p < n && p !== index));
  const totalDuration = duration.reduce((a, b) => a + b, 0);
  const span = Math.max(1, ...release.map((r, i) => r + duration[i]), totalDuration);

  const earliest = release.slice();
  for (let pass = 0; pass < n + 1; pass += 1) {
    let changed = false;
    for (let i = 0; i < n; i += 1) {
      for (const p of preds[i]) {
        const bound = earliest[p] + duration[p];
        if (bound > earliest[i]) {
          earliest[i] = bound;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  const domain = Array.from({ length: n }, (_, i) => {
    const low = earliest[i];
    const high = Math.min(deadline[i] - duration[i], span - duration[i]);
    return high < low ? [] : Array.from({ length: high - low + 1 }, (_, k) => low + k);
  });
  if (domain.some((d) => !d.length)) {
    return { status: 'infeasible', best: null, nodes: 0, prunes: 0, lowerBound: 0 };
  }

  const load = new Array(Math.max(...machine) + 1).fill(0);
  duration.forEach((d, i) => { load[machine[i]] += d; });
  const criticalPath = (() => {
    const finish = new Array(n).fill(0);
    for (let pass = 0; pass < n + 1; pass += 1) {
      let changed = false;
      for (let i = 0; i < n; i += 1) {
        const bound = duration[i] + Math.max(0, ...preds[i].map((p) => finish[p]));
        if (bound > finish[i]) {
          finish[i] = bound;
          changed = true;
        }
      }
      if (!changed) break;
    }
    return Math.max(0, ...finish);
  })();
  const lowerBound = Math.max(criticalPath, ...load.map((total) => Math.ceil(total / capacity)));

  const starts = new Array(n).fill(null);
  const tick = clock({ onProgress, signal, timeLimitMs });
  let best = null;
  let nodes = 0;
  let prunes = 0;

  const profileOk = (candidateIndex, candidateStart) => {
    const end = candidateStart + duration[candidateIndex];
    for (let t = candidateStart; t < end; t += 1) {
      let count = 1;
      for (let i = 0; i < n; i += 1) {
        if (i === candidateIndex || starts[i] == null) continue;
        if (machine[i] !== machine[candidateIndex]) continue;
        if (t >= starts[i] && t < starts[i] + duration[i]) count += 1;
      }
      if (count > capacity) return false;
    }
    return true;
  };

  const dfs = async (assigned) => {
    nodes += 1;
    await tick({ incumbent: best ? best.makespan : null, prunes });
    if (assigned === n) {
      const check = verifySchedule(jobs, starts, capacity);
      if (check.ok && (!best || check.makespan < best.makespan)) best = { starts: starts.slice(), makespan: check.makespan };
      return;
    }
    // Earliest-start variable first, then earliest value first: a schedule is built the
    // way a planner reads one, which finds a good incumbent quickly.
    let pick = -1;
    for (let i = 0; i < n; i += 1) {
      if (starts[i] != null) continue;
      if (pick < 0 || domain[i][0] < domain[pick][0]) pick = i;
    }
    const partial = Math.max(0, ...starts.map((start, i) => (start == null ? 0 : start + duration[i])));
    if (best && Math.max(partial, lowerBound) >= best.makespan) {
      prunes += 1;
      return;
    }
    for (const start of domain[pick]) {
      if (!profileOk(pick, start)) continue;
      starts[pick] = start;
      await dfs(assigned + 1);
      starts[pick] = null;
    }
  };

  let status = 'optimal';
  try {
    await dfs(0);
  } catch (error) {
    if (!(error instanceof SearchStopped)) throw error;
    status = error.reason;
  }
  return { status, best, nodes, prunes, lowerBound };
}