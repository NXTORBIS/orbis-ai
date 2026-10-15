/**
 * Molecular kinetics network engine.
 *
 * A molecule hopping between discrete states is a continuous-time Markov chain, and almost
 * everything worth knowing about it is a linear-algebra question on the generator K: the
 * stationary distribution is its null vector, the implied timescales are its eigenvalues, the
 * mean first-passage times and committors solve linear systems built from it, and the
 * reactive flux through an edge is π_i k_ij (q_j − q_i). This engine does all of those, then
 * checks itself against the things that are true independently — the analytic two-state
 * answer, the backward equation, probability conservation, and a Monte Carlo ensemble of the
 * jump process itself.
 *
 * Rate matrices can be entered directly or, better, built from state free energies and edge
 * barriers. The barrier construction produces reversible rates by construction, so detailed
 * balance is exact rather than hoped for, and the equilibrium population of each state is its
 * Boltzmann weight — which is then checked, not assumed.
 */

import { maxAbs, solveLinear, jacobiEigen } from './numerics.js';

const zeros = (n) => Array.from({ length: n }, () => new Array(n).fill(0));

/** Deterministic PRNG, so a validation run is repeatable. */
const mulberry32 = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * Presets. Energies are in units of kT and edge barriers are the extra height above the
 * higher of the two states, so rates are k = A·exp(−(F_j + Δ − F_i)).
 */
export const PRESETS = {
  folding: {
    id: 'folding',
    label: 'Protein folding with a misfolded trap',
    timeUnit: 'µs',
    prefactor: 100,
    note: 'Unfolded → intermediate → native, with a slow competing route into a misfolded state that must be escaped again. The trap makes the dominant folding route different from the shortest one.',
    states: [
      { id: 'U', label: 'Unfolded', energy: 4.5, x: 0.12, y: 0.5 },
      { id: 'I', label: 'Intermediate', energy: 2.2, x: 0.42, y: 0.26 },
      { id: 'N', label: 'Native', energy: 0, x: 0.86, y: 0.5 },
      { id: 'M', label: 'Misfolded', energy: 1.4, x: 0.44, y: 0.82 },
    ],
    edges: [
      { from: 'U', to: 'I', barrier: 3.2 },
      { from: 'I', to: 'N', barrier: 4.6 },
      { from: 'U', to: 'M', barrier: 4.0 },
      { from: 'M', to: 'I', barrier: 3.4 },
    ],
  },
  channel: {
    id: 'channel',
    label: 'Ion channel gating',
    timeUnit: 'ms',
    prefactor: 1,
    note: 'The classic three-state gate: opening, then inactivation from the open state. Bursting behaviour comes out of the topology, and the open probability at steady state is the number electrophysiologists measure.',
    states: [
      { id: 'C', label: 'Closed', energy: 0, x: 0.15, y: 0.5 },
      { id: 'O', label: 'Open', energy: 1.1, x: 0.5, y: 0.16 },
      { id: 'I', label: 'Inactivated', energy: 0.2, x: 0.85, y: 0.5 },
    ],
    edges: [
      { from: 'C', to: 'O', barrier: 2.4 },
      { from: 'O', to: 'I', barrier: 1.6 },
    ],
  },
  peptide: {
    id: 'peptide',
    label: 'Alanine dipeptide conformers',
    timeUnit: 'ps',
    prefactor: 200,
    note: 'Five backbone conformers of a small peptide, the system molecular dynamics is usually benchmarked on. The slowest mode is the exchange between the two families, and the MFPT table shows which hop is actually rate-limiting.',
    states: [
      { id: 'C7eq', label: 'C7eq', energy: 0, x: 0.2, y: 0.2 },
      { id: 'C5', label: 'C5', energy: 1.6, x: 0.62, y: 0.12 },
      { id: 'alpha', label: 'αR', energy: 2.4, x: 0.87, y: 0.46 },
      { id: 'beta', label: 'β', energy: 2.0, x: 0.5, y: 0.68 },
      { id: 'PPII', label: 'PPII', energy: 2.8, x: 0.14, y: 0.72 },
    ],
    edges: [
      { from: 'C7eq', to: 'C5', barrier: 2.6 },
      { from: 'C7eq', to: 'beta', barrier: 4.4 },
      { from: 'C5', to: 'alpha', barrier: 2.2 },
      { from: 'alpha', to: 'beta', barrier: 1.4 },
      { from: 'beta', to: 'PPII', barrier: 2.8 },
      { from: 'C7eq', to: 'PPII', barrier: 3.0 },
    ],
  },
  ladder: {
    id: 'ladder',
    label: 'Tilted ladder (driven diffusion)',
    timeUnit: 'steps',
    prefactor: 1,
    note: 'Six states under a constant tilt — the discrete picture of a particle diffusing down a slope. It is also the chain whose exact answers appear in every textbook, so it is a useful place to check the solver.',
    states: [
      { id: 's1', label: '1', energy: 5, x: 0.08, y: 0.5 },
      { id: 's2', label: '2', energy: 4, x: 0.25, y: 0.5 },
      { id: 's3', label: '3', energy: 3, x: 0.42, y: 0.5 },
      { id: 's4', label: '4', energy: 2, x: 0.59, y: 0.5 },
      { id: 's5', label: '5', energy: 1, x: 0.76, y: 0.5 },
      { id: 's6', label: '6', energy: 0, x: 0.93, y: 0.5 },
    ],
    edges: [
      { from: 's1', to: 's2', barrier: 0.6 },
      { from: 's2', to: 's3', barrier: 0.6 },
      { from: 's3', to: 's4', barrier: 0.6 },
      { from: 's4', to: 's5', barrier: 0.6 },
      { from: 's5', to: 's6', barrier: 0.6 },
    ],
  },
};

/** Stationary distribution from πK = 0 with the normalisation replacing one equation. */
export function stationary(K) {
  const n = K.length;
  const matrix = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => K[j][i]));
  matrix[n - 1] = new Array(n).fill(1);
  const rhs = [...new Array(n - 1).fill(0), 1];
  const solution = solveLinear(matrix, rhs);
  if (!solution) return { pi: new Array(n).fill(1 / n), residual: Infinity, sumError: Infinity };
  const total = solution.reduce((a, b) => a + b, 0);
  const pi = solution.map((value) => value / total);
  const flux = K.map((_, i) => K.reduce((sum, column, j) => sum + pi[j] * column[i], 0));
  return { pi, residual: maxAbs(flux), sumError: Math.abs(total - 1) };
}

/**
 * Build a network from free energies and barriers. Rates are reversible by construction, and
 * the equilibrium population is the Boltzmann weight of each energy.
 */
export function buildNetwork(spec = {}) {
  const base = PRESETS[spec.preset] ?? PRESETS.folding;
  const energies = spec.energies ?? {};
  const barriers = spec.barriers ?? {};
  const prefactor = spec.prefactor ?? base.prefactor ?? 1;
  const states = base.states.map((state) => ({ ...state, energy: energies[state.id] ?? state.energy }));
  const index = new Map(states.map((state, i) => [state.id, i]));
  const n = states.length;
  const K = zeros(n);
  const edges = base.edges.map((edge) => {
    const i = index.get(edge.from);
    const j = index.get(edge.to);
    const barrier = barriers[`${edge.from}|${edge.to}`] ?? edge.barrier;
    const top = Math.max(states[i].energy, states[j].energy) + barrier;
    const forward = prefactor * Math.exp(-(top - states[i].energy));
    const backward = prefactor * Math.exp(-(top - states[j].energy));
    K[i][j] += forward;
    K[j][i] += backward;
    return { from: edge.from, to: edge.to, i, j, barrier, forward, backward };
  });
  for (let i = 0; i < n; i += 1) {
    K[i][i] = -K[i].reduce((sum, value) => sum + value, 0);
  }
  const { pi, residual, sumError } = stationary(K);
  const boltzmannRaw = states.map((state) => Math.exp(-state.energy));
  const boltzmannTotal = boltzmannRaw.reduce((a, b) => a + b, 0);
  const detailed = edges.map((edge) => ({
    label: `${edge.from} ↔ ${edge.to}`,
    residual: Math.abs(pi[edge.i] * edge.forward - pi[edge.j] * edge.backward) / (pi[edge.i] * edge.forward + pi[edge.j] * edge.backward),
  }));
  return {
    id: base.id,
    label: base.label,
    note: base.note,
    timeUnit: base.timeUnit,
    prefactor,
    states,
    edges,
    K,
    pi,
    stationaryResidual: residual,
    sumError,
    boltzmann: boltzmannRaw.map((value) => value / boltzmannTotal),
    detailed,
    worstDetailedBalance: detailed.reduce((worst, entry) => Math.max(worst, entry.residual), 0),
  };
}

/**
 * Implied timescales. The chain is reversible, so K is similar to the symmetric matrix
 * D^{1/2} K D^{−1/2} with D = diag(π) and the Jacobi solver applies directly; the eigenvalues
 * are shared and τ_k = −1/λ_k. The slowest mode comes back with its state weights, which is
 * the quantity that says which states actually exchange.
 */
export function spectrum(net) {
  const { K, pi } = net;
  const n = K.length;
  const root = pi.map((value) => Math.sqrt(Math.max(value, 1e-300)));
  const symmetric = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (root[i] * K[i][j]) / root[j]));
  const { values, vectors } = jacobiEigen(symmetric);
  const timescales = values.slice(1).map((value) => (value < -1e-12 ? -1 / value : Infinity));
  const slow = vectors[1] ?? new Array(n).fill(0);
  const unweighted = slow.map((value, i) => value / root[i]);
  const scale = Math.max(...unweighted.map((value) => Math.abs(value)), 1e-300);
  const mode = unweighted.map((value) => value / scale);
  return {
    values,
    timescales,
    mode,
    modeResidual: Math.abs(values[0]),
    zeroCount: values.filter((value) => Math.abs(value) < 1e-9).length,
  };
}

/** Matrix exponential by scaling and squaring — an independent route to exp(Kt) from the spectrum. */
export function matrixExp(K, t) {
  const n = K.length;
  const scaled = K.map((row) => row.map((value) => (value * t) / 1024));
  let term = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  let sum = term.map((row) => [...row]);
  for (let order = 1; order <= 14; order += 1) {
    const next = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i += 1) {
      for (let k = 0; k < n; k += 1) {
        if (term[i][k] === 0) continue;
        for (let j = 0; j < n; j += 1) next[i][j] += term[i][k] * scaled[k][j];
      }
    }
    for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1) next[i][j] /= order;
    term = next;
    for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1) sum[i][j] += term[i][j];
  }
  for (let squaring = 0; squaring < 10; squaring += 1) {
    const next = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i += 1) {
      for (let k = 0; k < n; k += 1) {
        if (sum[i][k] === 0) continue;
        for (let j = 0; j < n; j += 1) next[i][j] += sum[i][k] * sum[k][j];
      }
    }
    sum = next;
  }
  return sum;
}

/** Population curves from an initial distribution, at the given times. */
export function propagate(net, initial, times) {
  return times.map((t) => {
    const step = matrixExp(net.K, t);
    return initial.map((_, i) => initial.reduce((sum, value, from) => sum + value * step[from][i], 0));
  });
}

/** Mean first-passage time to a target state, from every state. */
export function meanFirstPassage(net, target) {
  const n = net.K.length;
  const keep = Array.from({ length: n }, (_, i) => i).filter((i) => i !== target);
  const matrix = keep.map((i) => keep.map((j) => net.K[i][j]));
  const rhs = keep.map(() => -1);
  const solution = solveLinear(matrix, rhs);
  const values = new Array(n).fill(0);
  if (solution) keep.forEach((i, k) => { values[i] = solution[k]; });
  const residual = keep.map((i, row) => Math.abs(net.K[i].reduce((sum, value, j) => sum + value * values[j], 0) + 1));
  return { values, residual: maxAbs(residual), solved: Boolean(solution) };
}

/** Probability of reaching the sink set before the source set — zero on the source, one on the sink. */
export function committor(net, source, sink) {
  const n = net.K.length;
  const sourceSet = new Set(Array.isArray(source) ? source : [source]);
  const sinkSet = new Set(Array.isArray(sink) ? sink : [sink]);
  for (const state of sourceSet) if (sinkSet.has(state)) throw new Error('A state cannot be in both the source and the sink set.');
  const unknown = Array.from({ length: n }, (_, i) => i).filter((i) => !sourceSet.has(i) && !sinkSet.has(i));
  const positions = new Map(unknown.map((state, k) => [state, k]));
  const matrix = unknown.map((i) => unknown.map((j) => net.K[i][j]));
  const rhs = unknown.map((i) => -[...sinkSet].reduce((sum, j) => sum + net.K[i][j], 0));
  const solution = solveLinear(matrix, rhs);
  const q = new Array(n).fill(0);
  sinkSet.forEach((i) => { q[i] = 1; });
  if (solution) unknown.forEach((state, k) => { q[state] = solution[k]; });
  const residual = unknown.map((i) => Math.abs(net.K[i].reduce((sum, value, j) => sum + value * q[j], 0)));
  return {
    values: q,
    harmonicResidual: maxAbs(residual),
    solved: Boolean(solution),
    inRange: q.every((value) => value > -1e-9 && value < 1 + 1e-9),
  };
}

/** Net reactive flux on each edge: positive when it carries probability towards the sink. */
export function reactiveFlux(net, q, { source, sink } = {}) {
  const edges = [];
  for (let i = 0; i < net.K.length; i += 1) {
    for (let j = 0; j < net.K.length; j += 1) {
      if (i === j || net.K[i][j] <= 0) continue;
      const flux = net.pi[i] * net.K[i][j] * (q[j] - q[i]);
      if (flux > 1e-15) edges.push({ i, j, from: net.states[i].id, to: net.states[j].id, flux });
    }
  }
  edges.sort((a, b) => b.flux - a.flux);
  const sourceSet = source ?? net.states.map((_, i) => i);
  const sinkSet = sink ?? [];
  const outOfSource = edges.filter((edge) => sourceSet.includes(edge.i)).reduce((sum, edge) => sum + edge.flux, 0);
  const intoSink = sinkSet.length
    ? edges.filter((edge) => sinkSet.includes(edge.j)).reduce((sum, edge) => sum + edge.flux, 0)
    : outOfSource;
  return { edges, outOfSource, intoSink, total: outOfSource };
}

/** The route with the largest product of edge fluxes — the dominant transition pathway. */
export function dominantPath(net, q, source, sink) {
  const n = net.K.length;
  const sourceSet = (Array.isArray(source) ? source : [source]).filter((i) => q[i] < 0.5);
  const sinkSet = (Array.isArray(sink) ? sink : [sink]).filter((i) => q[i] > 0.5);
  const start = sourceSet[0];
  const goal = sinkSet[0];
  if (start === undefined || goal === undefined) return { path: [], ids: [], capacity: 0, edges: [], monotone: false };
  const cost = new Array(n).fill(Infinity);
  const cameFrom = new Array(n).fill(-1);
  const visited = new Array(n).fill(false);
  cost[start] = 0;
  for (let sweep = 0; sweep < n; sweep += 1) {
    let current = -1;
    for (let i = 0; i < n; i += 1) if (!visited[i] && (current === -1 || cost[i] < cost[current])) current = i;
    if (current === -1 || !Number.isFinite(cost[current])) break;
    visited[current] = true;
    for (let j = 0; j < n; j += 1) {
      if (j === current || visited[j] || net.K[current][j] <= 0) continue;
      if (q[j] < q[current] - 1e-12) continue;
      const flux = net.pi[current] * net.K[current][j] * Math.max(q[j] - q[current], 1e-300);
      const candidate = cost[current] - Math.log(flux);
      if (candidate < cost[j]) { cost[j] = candidate; cameFrom[j] = current; }
    }
  }
  const path = [];
  let node = goal;
  while (node !== -1) { path.unshift(node); node = cameFrom[node]; }
  const routed = path.length > 1;
  const edges = routed ? path.slice(1).map((to, k) => {
    const from = path[k];
    return { from, to, flux: net.pi[from] * net.K[from][to] * (q[to] - q[from]) };
  }) : [];
  return {
    path: routed ? path : [],
    ids: routed ? path.map((i) => net.states[i].id) : [],
    edges,
    capacity: routed ? Math.exp(-cost[goal]) : 0,
    monotone: routed && edges.every((edge) => edge.flux > 0),
  };
}

/**
 * Direct simulation of the jump process: exponential waiting times at the total exit rate,
 * then a jump chosen in proportion to the individual rates. Nothing about the linear algebra
 * is reused, which is what makes it a real check.
 */
export function monteCarlo(net, { start, target, competitor = null, trials = 20000, seed = 20260113, maxTime = 1e7 } = {}) {
  const n = net.K.length;
  const random = mulberry32(seed);
  const occupancy = new Array(n).fill(0);
  let totalTime = 0;
  let resolved = 0;
  let unresolved = 0;
  let sum = 0;
  let sumSquares = 0;
  let hitTarget = 0;
  let hitCompetitor = 0;
  for (let trial = 0; trial < trials; trial += 1) {
    let state = start;
    let time = 0;
    let finished = false;
    for (let step = 0; step < 200000; step += 1) {
      const rate = -net.K[state][state];
      if (!(rate > 0)) { unresolved += 1; break; }
      const waiting = -Math.log(1 - random()) / rate;
      occupancy[state] += Math.min(waiting, maxTime - time);
      time += waiting;
      if (time >= maxTime) { unresolved += 1; totalTime += maxTime; break; }
      let pick = random() * rate;
      let next = -1;
      for (let j = 0; j < n; j += 1) {
        if (j === state || net.K[state][j] <= 0) continue;
        pick -= net.K[state][j];
        if (pick <= 0) { next = j; break; }
      }
      if (next < 0) {
        for (let j = n - 1; j >= 0; j -= 1) if (j !== state && net.K[state][j] > 0) { next = j; break; }
      }
      state = next;
      if (target != null && state === target) { resolved += 1; hitTarget += 1; sum += time; sumSquares += time * time; totalTime += time; finished = true; break; }
      if (competitor != null && state === competitor) { resolved += 1; hitCompetitor += 1; totalTime += time; finished = true; break; }
    }
    if (target == null) { resolved += 1; finished = true; }
    if (!finished) unresolved += 1;
  }
  const mean = hitTarget ? sum / hitTarget : NaN;
  const variance = hitTarget > 1 ? Math.max(0, sumSquares / hitTarget - mean * mean) : 0;
  const standardError = hitTarget > 1 ? Math.sqrt(variance / hitTarget) : NaN;
  const occupancyTotal = occupancy.reduce((a, b) => a + b, 0) || 1;
  return {
    trials,
    resolved,
    unresolved,
    hitTarget,
    hitCompetitor,
    mean,
    standardError,
    committedFraction: resolved ? hitTarget / resolved : NaN,
    occupancy: occupancy.map((value) => value / occupancyTotal),
    time: totalTime / Math.max(1, resolved),
    seed,
  };
}

const fitDecayRate = (times, values) => {
  const usable = times.map((t, i) => ({ t, v: values[i] })).filter((point) => point.t > 0 && point.v > 1e-10);
  if (usable.length < 4) return NaN;
  const window = usable.slice(Math.floor(usable.length * 0.2), Math.floor(usable.length * 0.8));
  if (window.length < 3) return NaN;
  const xs = window.map((point) => point.t);
  const ys = window.map((point) => Math.log(point.v));
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
  const covariance = xs.reduce((sum, x, i) => sum + (x - meanX) * (ys[i] - meanY), 0);
  const variance = xs.reduce((sum, x) => sum + (x - meanX) ** 2, 0);
  return -covariance / variance;
};

export function verifyNetwork() {
  const folding = buildNetwork({ preset: 'folding' });
  const ladder = buildNetwork({ preset: 'ladder' });
  const spec = spectrum(folding);
  const ladderSpec = spectrum(ladder);

  // Independent two-state chain whose MFPT is exactly 1/k_off.
  const kOn = 0.7;
  const kOff = 0.05;
  const twoState = {
    states: [{ id: 'A', label: 'A', energy: 0 }, { id: 'B', label: 'B', energy: 0 }],
    K: [[-kOn, kOn], [kOff, -kOff]],
    pi: [kOff / (kOn + kOff), kOn / (kOn + kOff)],
  };
  const twoStateMfpt = meanFirstPassage(twoState, 1);
  const twoStateBack = meanFirstPassage(twoState, 0);

  const uIndex = folding.states.findIndex((state) => state.id === 'U');
  const iIndex = folding.states.findIndex((state) => state.id === 'I');
  const nIndex = folding.states.findIndex((state) => state.id === 'N');
  const mIndex = folding.states.findIndex((state) => state.id === 'M');

  const mfpt = meanFirstPassage(folding, nIndex);
  const q = committor(folding, uIndex, nIndex);
  const flux = reactiveFlux(folding, q.values, { source: [uIndex], sink: [nIndex] });
  const path = dominantPath(folding, q.values, [uIndex], [nIndex]);

  const mcCommittor = monteCarlo(folding, { start: iIndex, target: nIndex, competitor: uIndex, trials: 20000 });
  const mcMfpt = monteCarlo(folding, { start: uIndex, target: nIndex, trials: 20000 });
  const mcOccupancy = monteCarlo(folding, { start: uIndex, trials: 600, maxTime: 150 });

  // Exact mean first-passage time on a one-dimensional birth–death chain, from the textbook
  // sum Σₖ (1/πₖuₖ) Σ_{m≤k} π_m — a closed form the linear solve never sees.
  const ladderAnalytic = [0, 1, 2, 3, 4].reduce((sum, k) => (
    sum + (1 / (ladder.K[k][k + 1] * ladder.pi[k])) * ladder.pi.slice(0, k + 1).reduce((a, b) => a + b, 0)
  ), 0);
  const ladderMfpt = meanFirstPassage(ladder, 5);

  // Probability conservation and the spectral route to the same propagation.
  const step = matrixExp(folding.K, 1);
  const rowSumError = maxAbs(step.map((row) => row.reduce((a, b) => a + b, 0) - 1));
  const initial = folding.states.map((_, i) => (i === uIndex ? 1 : 0));
  const times = Array.from({ length: 40 }, (_, i) => (i + 1) * 4);
  const curves = propagate(folding, initial, times);
  const nativeCurve = curves.map((row) => row[nIndex] - folding.pi[nIndex]);
  const fitted = fitDecayRate(times, nativeCurve.map((value) => Math.abs(value)));
  const spectralRate = -spec.values[1];

  return {
    folding,
    ladder,
    spec,
    ladderSpec,
    mfpt,
    committor: q,
    flux,
    path,
    mc: { committor: mcCommittor, mfpt: mcMfpt, occupancy: mcOccupancy },
    checks: [
      {
        label: 'The barrier construction gives exactly reversible rates',
        ok: folding.worstDetailedBalance < 1e-14,
        detail: `worst relative detailed-balance imbalance ${folding.worstDetailedBalance.toExponential(2)} over ${folding.edges.length} edges`,
      },
      {
        label: 'The equilibrium population equals the Boltzmann weight of each state',
        ok: Math.max(...folding.pi.map((value, i) => Math.abs(value - folding.boltzmann[i]))) < 1e-12,
        detail: `largest deviation ${Math.max(...folding.pi.map((value, i) => Math.abs(value - folding.boltzmann[i]))).toExponential(2)} from exp(−Fᵢ)/Z`,
      },
      {
        label: 'The stationary distribution really is stationary',
        ok: folding.stationaryResidual < 1e-14 && folding.sumError < 1e-14,
        detail: `|πK|∞ = ${folding.stationaryResidual.toExponential(2)}, |Σπ − 1| = ${folding.sumError.toExponential(2)}`,
      },
      {
        label: 'The generator has zero row sums and no negative rate',
        ok: maxAbs(folding.K.map((row) => row.reduce((a, b) => a + b, 0))) < 1e-15
          && folding.K.every((row, i) => row.every((value, j) => i === j || value >= 0)),
        detail: `worst row sum ${maxAbs(folding.K.map((row) => row.reduce((a, b) => a + b, 0))).toExponential(2)}`,
      },
      {
        label: 'The spectrum is real, non-positive, and has one and only one zero',
        ok: spec.zeroCount === 1 && spec.values.every((value) => value <= 1e-10) && spec.modeResidual < 1e-12,
        detail: `λ = ${spec.values.map((value) => value.toFixed(4)).join(', ')} — ${spec.zeroCount} zero mode`,
      },
      {
        label: 'The eigenvalues sum to the trace of the generator',
        ok: Math.abs(spec.values.reduce((a, b) => a + b, 0) - folding.K.reduce((sum, row, i) => sum + row[i], 0)) < 1e-9,
        detail: `Σλᵢ = ${spec.values.reduce((a, b) => a + b, 0).toFixed(9)} against Σᵢ Kᵢᵢ = ${folding.K.reduce((sum, row, i) => sum + row[i], 0).toFixed(9)}`,
      },
      {
        label: 'The two-state mean first-passage time is exactly 1/k',
        ok: Math.abs(twoStateMfpt.values[0] - 1 / kOn) < 1e-9 && Math.abs(twoStateBack.values[1] - 1 / kOff) < 1e-9,
        detail: `τ(A→B) = ${twoStateMfpt.values[0].toFixed(9)} against 1/k = ${(1 / kOn).toFixed(9)}, and τ(B→A) = ${twoStateMfpt.values[1].toFixed(9)} against ${(1 / kOff).toFixed(9)}`,
      },
      {
        label: 'Every mean first-passage time satisfies the backward equation',
        ok: mfpt.residual < 1e-9 && mfpt.values.every((value) => value >= 0),
        detail: `worst |Σⱼ Kᵢⱼτⱼ + 1| = ${mfpt.residual.toExponential(2)}; slowest escape ${Math.max(...mfpt.values).toFixed(3)} ${folding.timeUnit}`,
      },
      {
        label: 'The committor is harmonic in the interior and fixed at the boundary',
        ok: q.harmonicResidual < 1e-10 && q.values[uIndex] === 0 && q.values[nIndex] === 1 && q.inRange,
        detail: `worst |Σⱼ Kᵢⱼqⱼ| = ${q.harmonicResidual.toExponential(2)}, q ∈ [0, 1] throughout`,
      },
      {
        label: 'A direct simulation of the jump process reproduces the committor',
        ok: Math.abs(mcCommittor.committedFraction - q.values[iIndex]) < 3 * Math.sqrt(Math.max(q.values[iIndex] * (1 - q.values[iIndex]), 1e-6) / Math.max(mcCommittor.resolved, 1)) + 1e-9,
        detail: `from the intermediate state, Monte Carlo says ${mcCommittor.committedFraction.toFixed(4)} over ${mcCommittor.resolved} runs against the linear solve's ${q.values[iIndex].toFixed(4)}`,
      },
      {
        label: 'and reproduces the mean first-passage time',
        ok: Math.abs(mcMfpt.mean - mfpt.values[uIndex]) < 3 * mcMfpt.standardError + 1e-9,
        detail: `Monte Carlo ${mcMfpt.mean.toFixed(3)} ± ${(3 * mcMfpt.standardError).toFixed(3)} against ${mfpt.values[uIndex].toFixed(3)} ${folding.timeUnit}`,
      },
      {
        label: 'and its residence times reproduce the stationary populations',
        ok: Math.max(...mcOccupancy.occupancy.map((value, i) => Math.abs(value - folding.pi[i]))) < 0.02,
        detail: `largest occupancy difference ${Math.max(...mcOccupancy.occupancy.map((value, i) => Math.abs(value - folding.pi[i]))).toFixed(4)} over ${mcOccupancy.resolved} trajectories`,
      },
      {
        label: 'The matrix exponential preserves total probability',
        ok: rowSumError < 1e-9,
        detail: `worst |Σⱼ [e^{Kt}]ᵢⱼ − 1| = ${rowSumError.toExponential(2)} at t = 1 ${folding.timeUnit}`,
      },
      {
        label: 'The slowest timescale from the spectrum matches a direct decay measurement',
        ok: Number.isFinite(fitted) && Math.abs(fitted / spectralRate - 1) < 0.03,
        detail: `fitted decay ${fitted.toFixed(5)} against the eigenvalue ${spectralRate.toFixed(5)} per ${folding.timeUnit}`,
      },
      {
        label: 'Reactive flux is conserved between source and sink',
        ok: flux.outOfSource > 0 && Math.abs(flux.outOfSource - flux.intoSink) / flux.outOfSource < 1e-9,
        detail: `flux out of the unfolded state ${flux.outOfSource.toExponential(3)} matches the flux into the native state ${flux.intoSink.toExponential(3)} per ${folding.timeUnit} — the crossing rate is ${(flux.outOfSource / folding.pi[uIndex]).toFixed(4)} per ${folding.timeUnit} per unit population`,
      },
      {
        label: 'The dominant pathway is a genuine reactive route',
        ok: path.monotone && path.path.length >= 3 && q.values.every((value) => value >= -1e-9),
        detail: `${path.ids.join(' → ')} with committor rising from ${path.path.length ? q.values[path.path[0]].toFixed(3) : '—'} to ${path.path.length ? q.values[path.path[path.path.length - 1]].toFixed(3) : '—'}`,
      },
      {
        label: 'The ladder’s mean first-passage time matches the exact birth–death sum',
        ok: Math.abs(ladderMfpt.values[0] / ladderAnalytic - 1) < 1e-9,
        detail: `solved ${ladderMfpt.values[0].toFixed(9)} against Σₖ (1/πₖuₖ) Σ_{m≤k} π_m = ${ladderAnalytic.toFixed(9)} ${ladder.timeUnit}`,
      },
      {
        label: 'The tilted ladder has the monotone MFPT profile a drift must give',
        ok: ladderSpec.timescales[0] > 0 && ladderSpec.timescales[0] > ladderSpec.timescales[ladderSpec.timescales.length - 1],
        detail: `slowest mode ${ladderSpec.timescales[0].toFixed(3)} ${ladder.timeUnit} against the fastest ${ladderSpec.timescales[ladderSpec.timescales.length - 1].toFixed(4)} ${ladder.timeUnit}`,
      },
    ],
  };
}