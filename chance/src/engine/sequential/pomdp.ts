/**
 * Partially observable MDPs: the realistic case, where the state is hidden and
 * all you ever see is an observation.
 *
 * What is implemented, and how honestly it is labelled:
 *
 *  - Belief updating (exact Bayes). A zero-probability observation is REFUSED,
 *    not renormalised from a zero denominator into a uniform belief.
 *  - EXACT finite-horizon value iteration over alpha-vectors, by the full
 *    cross-sum backup with dominance pruning. This is exact (the pruning only
 *    removes vectors that are nowhere the maximum, so the upper envelope is
 *    unchanged) but it is exponential in the horizon before pruning, so the
 *    vector count is capped and exceeding the cap is an error rather than a
 *    silent truncation of the value function.
 *  - QMDP and the fast informed bound (FIB) as APPROXIMATIONS, with their bias
 *    direction stated: both are UPPER bounds — optimistic. QMDP assumes the
 *    state becomes fully observable after one step, so it never pays for
 *    information gathering and overvalues the problem; FIB assumes it becomes
 *    observable after the observation, which is weaker, so FIB ≤ QMDP.
 *  - The value of information: the gap between the fully observable MDP
 *    optimum and the POMDP optimum, which is what perfect state knowledge is
 *    worth.
 */
import { EngineError, Validator, type Issue } from '../core/result';
import { simplexMaximize } from './lp';
import { valueIteration } from './mdp';
import type { MDP, Provenance } from './types';

/**
 * A finite POMDP with a common action set. `transitions[a][s][s']`,
 * `observations[a][s'][o]` (the probability of observation o on ARRIVING in s'
 * after action a) and `rewards[a][s]` = R(s, a).
 */
export interface POMDP {
  nStates: number;
  nObservations: number;
  actions: string[];
  stateLabels?: string[];
  observationLabels?: string[];
  transitions: number[][][];
  observations: number[][][];
  rewards: number[][];
}

export const POMDP_LIMITS = { maxAlphaVectors: 20000 };

export function validatePOMDP(pomdp: POMDP, discount?: number): Issue[] {
  const v = new Validator();
  const n = pomdp.nStates;
  const m = pomdp.nObservations;
  if (!Number.isInteger(n) || n < 1) {
    v.add('A POMDP needs at least one state.', 'nStates', 'range');
    return v.issues;
  }
  if (!Number.isInteger(m) || m < 1) {
    v.add('A POMDP needs at least one observation.', 'nObservations', 'range');
    return v.issues;
  }
  if (!Array.isArray(pomdp.actions) || pomdp.actions.length < 1) {
    v.add('A POMDP needs at least one action.', 'actions', 'empty');
    return v.issues;
  }
  const k = pomdp.actions.length;
  const label = (a: number): string => `action "${pomdp.actions[a]}"`;
  const sName = (s: number): string => pomdp.stateLabels?.[s] ?? String(s);
  for (let a = 0; a < k; a++) {
    const T = pomdp.transitions?.[a];
    const O = pomdp.observations?.[a];
    const R = pomdp.rewards?.[a];
    if (!Array.isArray(T) || T.length !== n) {
      v.add(`Transition matrix for ${label(a)} must have one row per state (${n}).`, `transitions[${a}]`, 'shape');
      continue;
    }
    if (!Array.isArray(O) || O.length !== n) {
      v.add(`Observation matrix for ${label(a)} must have one row per successor state (${n}).`, `observations[${a}]`, 'shape');
      continue;
    }
    if (!Array.isArray(R) || R.length !== n) {
      v.add(`Reward vector for ${label(a)} must have one entry per state (${n}).`, `rewards[${a}]`, 'shape');
      continue;
    }
    for (let s = 0; s < n; s++) {
      if (!Array.isArray(T[s]) || T[s].length !== n) {
        v.add(`Transition row for (state ${sName(s)}, ${label(a)}) must have one probability per successor state (${n}).`, `transitions[${a}][${s}]`, 'shape');
        continue;
      }
      let sum = 0;
      let bad = false;
      for (const p of T[s]) {
        if (!Number.isFinite(p) || p < 0) {
          v.add(`Transition row for (state ${sName(s)}, ${label(a)}) contains a value that is not a probability.`, `transitions[${a}][${s}]`, 'range');
          bad = true;
          break;
        }
        sum += p;
      }
      if (!bad && Math.abs(sum - 1) > 1e-9) {
        v.add(`Transition probabilities for (state ${sName(s)}, ${label(a)}) sum to ${sum.toPrecision(12)}, not 1.`, `transitions[${a}][${s}]`, 'sum');
      }
      if (!Array.isArray(O[s]) || O[s].length !== m) {
        v.add(`Observation row for (successor state ${sName(s)}, ${label(a)}) must have one probability per observation (${m}).`, `observations[${a}][${s}]`, 'shape');
        continue;
      }
      let osum = 0;
      let obad = false;
      for (const p of O[s]) {
        if (!Number.isFinite(p) || p < 0) {
          v.add(`Observation row for (successor state ${sName(s)}, ${label(a)}) contains a value that is not a probability.`, `observations[${a}][${s}]`, 'range');
          obad = true;
          break;
        }
        osum += p;
      }
      if (!obad && Math.abs(osum - 1) > 1e-9) {
        v.add(`Observation probabilities for (successor state ${sName(s)}, ${label(a)}) sum to ${osum.toPrecision(12)}, not 1.`, `observations[${a}][${s}]`, 'sum');
      }
      if (!Number.isFinite(R[s])) {
        v.add(`Reward R(state ${sName(s)}, ${label(a)}) is not a finite number.`, `rewards[${a}][${s}]`, 'finite');
      }
    }
  }
  if (discount !== undefined) {
    if (!Number.isFinite(discount) || discount < 0) v.add('The discount factor must be a finite number of at least 0.', 'discount', 'range');
    else if (discount >= 1) v.add(`The discount factor must be strictly below 1 for an infinite-horizon POMDP; ${discount} was supplied.`, 'discount', 'range');
  }
  return v.issues;
}

function requireValidPOMDP(pomdp: POMDP, discount?: number): void {
  const issues = validatePOMDP(pomdp, discount);
  if (issues.length) throw new EngineError(issues);
}

export function validateBelief(belief: number[], nStates: number): void {
  if (belief.length !== nStates) throw new EngineError(`The belief must have one probability per state (${nStates}); ${belief.length} were supplied.`, 'shape');
  let sum = 0;
  for (const p of belief) {
    if (!Number.isFinite(p) || p < 0) throw new EngineError('A belief must contain non-negative finite probabilities.', 'range');
    sum += p;
  }
  if (Math.abs(sum - 1) > 1e-9) throw new EngineError(`The belief sums to ${sum.toPrecision(12)}, not 1. A belief is a probability distribution over the hidden state.`, 'sum');
}

export interface BeliefUpdate {
  belief: number[];
  /** P(observation | belief, action): the normalising constant. */
  observationProbability: number;
  provenance: Provenance;
}

/**
 * Exact Bayes update of the belief after taking an action and seeing an
 * observation:
 *
 *     b'(s') ∝ O(o | s', a) · Σ_s T(s' | s, a) · b(s)
 *
 * An observation with probability 0 under the current belief cannot be
 * conditioned on: that is a contradiction in the model or the data, and it is
 * reported as such rather than resolved by dividing by zero.
 */
export function beliefUpdate(pomdp: POMDP, belief: number[], action: number, observation: number): BeliefUpdate {
  requireValidPOMDP(pomdp);
  validateBelief(belief, pomdp.nStates);
  if (!Number.isInteger(action) || action < 0 || action >= pomdp.actions.length) {
    throw new EngineError(`The action must be an index in 0..${pomdp.actions.length - 1}.`, 'range');
  }
  if (!Number.isInteger(observation) || observation < 0 || observation >= pomdp.nObservations) {
    throw new EngineError(`The observation must be an index in 0..${pomdp.nObservations - 1}.`, 'range');
  }
  const n = pomdp.nStates;
  const T = pomdp.transitions[action];
  const O = pomdp.observations[action];
  const raw = new Array<number>(n).fill(0);
  let total = 0;
  for (let sp = 0; sp < n; sp++) {
    let pred = 0;
    for (let s = 0; s < n; s++) if (belief[s] !== 0) pred += belief[s] * T[s][sp];
    const w = pred * O[sp][observation];
    raw[sp] = w;
    total += w;
  }
  if (!(total > 0)) {
    const oLabel = pomdp.observationLabels?.[observation] ?? String(observation);
    throw new EngineError(
      `Observation "${oLabel}" has probability 0 after action "${pomdp.actions[action]}" from the supplied belief, so it cannot be conditioned on. Either the observation model rules it out or the belief does; one of the two is wrong.`,
      'impossible',
    );
  }
  return {
    belief: raw.map((x) => x / total),
    observationProbability: total,
    provenance: {
      exactness: 'exact',
      method: 'Bayes update of the belief state',
      assumedInputs: ['The transition and observation models are supplied by the user.'],
      limitations: ['The update is exact given the model. A misspecified observation model produces a confidently wrong belief, and nothing in the arithmetic reveals that.'],
    },
  };
}

/* ------------------------------------------------- the underlying MDP view */

/** The fully observable MDP obtained by assuming the state is seen. */
export function underlyingMDP(pomdp: POMDP): MDP {
  const n = pomdp.nStates;
  return {
    nStates: n,
    stateLabels: pomdp.stateLabels,
    actions: Array.from({ length: n }, () => [...pomdp.actions]),
    transitions: Array.from({ length: n }, (_, s) => pomdp.transitions.map((T) => [...T[s]])),
    rewards: Array.from({ length: n }, (_, s) => pomdp.rewards.map((R) => R[s])),
  };
}

/* ------------------------------------------------------------- alpha-vectors */

export interface AlphaVectorResult {
  /** The pruned alpha-vector set: value(b) = max_α b·α. */
  alphaVectors: number[][];
  /** The action each alpha-vector prescribes at the first step. */
  actions: number[];
  horizon: number;
  discount: number;
  provenance: Provenance;
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/**
 * Prune an alpha-vector set to the vectors that are maximal somewhere on the
 * belief simplex — EXACTLY, by Lark's witness-LP filtering.
 *
 * Cheap pointwise dominance alone is not enough: on the tiger problem it leaves
 * hundreds of thousands of vectors by stage 8 and the backup becomes
 * impossible. The witness test is what keeps exact value iteration tractable.
 * For each candidate α the linear program
 *
 *     maximise d   s.t.  (α − β)·b ≥ d  ∀ β ∈ W,   Σ b = 1,   b ≥ 0
 *
 * finds the belief at which α beats every vector kept so far by the widest
 * margin. If no such belief gives a positive margin, α is nowhere uniquely
 * maximal and is discarded; otherwise the vector that is actually best at that
 * witness belief joins the kept set. The result is the minimal exact
 * representation of the upper envelope.
 */
function prune(vectors: { v: number[]; a: number }[]): { v: number[]; a: number }[] {
  if (vectors.length <= 1) return vectors.slice();
  const n = vectors[0].v.length;
  // Deduplicate first: identical vectors would make the witness LP degenerate.
  const deduped: { v: number[]; a: number }[] = [];
  const seen = new Set<string>();
  for (const cand of vectors) {
    const key = cand.v.map((x) => (Math.abs(x) < 1e-12 ? 0 : Number(x.toPrecision(12)))).join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(cand);
  }
  if (deduped.length <= 1) return deduped;
  // Cheap pass: drop vectors dominated pointwise by another kept vector.
  const pointwise: { v: number[]; a: number }[] = [];
  for (let i = 0; i < deduped.length; i++) {
    let dominated = false;
    for (let j = 0; j < deduped.length && !dominated; j++) {
      if (i === j) continue;
      let allGE = true;
      let strict = false;
      for (let s = 0; s < n; s++) {
        if (deduped[j].v[s] < deduped[i].v[s] - 1e-12) {
          allGE = false;
          break;
        }
        if (deduped[j].v[s] > deduped[i].v[s] + 1e-12) strict = true;
      }
      if (allGE && strict) dominated = true;
    }
    if (!dominated) pointwise.push(deduped[i]);
  }
  if (pointwise.length <= 1) return pointwise;

  const pending = pointwise.slice();
  const kept: { v: number[]; a: number }[] = [];
  const takeBestAt = (belief: number[]): void => {
    let bestIdx = 0;
    let bestVal = -Infinity;
    for (let i = 0; i < pending.length; i++) {
      let acc = 0;
      for (let s = 0; s < n; s++) acc += pending[i].v[s] * belief[s];
      if (acc > bestVal + 1e-14) {
        bestVal = acc;
        bestIdx = i;
      }
    }
    kept.push(pending[bestIdx]);
    pending.splice(bestIdx, 1);
  };
  // Seed with the vectors maximal at each vertex of the simplex.
  for (let s = 0; s < n && pending.length > 0; s++) {
    const vertex = new Array<number>(n).fill(0);
    vertex[s] = 1;
    takeBestAt(vertex);
  }

  let guard = 0;
  const guardLimit = 50 * (pointwise.length + n) + 1000;
  while (pending.length > 0) {
    if (++guard > guardLimit) {
      throw new EngineError(
        `Alpha-vector pruning failed to terminate within ${guardLimit} witness tests, which indicates a numerically degenerate alpha-vector set. No value function is reported.`,
        'numerical',
      );
    }
    const phi = pending[pending.length - 1];
    const witness = findWitness(phi.v, kept.map((e) => e.v));
    if (!witness) {
      pending.pop();
      continue;
    }
    takeBestAt(witness);
  }
  return kept;
}

/**
 * The witness LP: a belief at which `candidate` strictly beats every vector in
 * `others`, or null when none exists.
 *
 *     maximise d   s.t.  (α − β)·b ≥ d  ∀ β,   Σ b = 1,   b ≥ 0
 *
 * d is free in that statement, which a standard-form solver cannot take, so it
 * is shifted by a margin M large enough that d + M ≥ 0 always holds, and each
 * comparison carries a slack variable. A witness exists iff the optimum exceeds
 * M.
 */
function findWitness(candidate: number[], others: number[][]): number[] | null {
  const n = candidate.length;
  const m = others.length;
  if (m === 0) return new Array<number>(n).fill(1 / n);
  let M = 1;
  for (const other of others) {
    for (let s = 0; s < n; s++) M = Math.max(M, Math.abs(candidate[s] - other[s]) + 1);
  }
  const nVars = n + 1 + m; // b (n), shifted margin d' = d + M, slacks (m)
  const A: number[][] = [];
  const rhs: number[] = [];
  for (let k = 0; k < m; k++) {
    const row = new Array<number>(nVars).fill(0);
    for (let s = 0; s < n; s++) row[s] = candidate[s] - others[k][s];
    row[n] = -1;
    row[n + 1 + k] = -1;
    A.push(row);
    rhs.push(-M);
  }
  const simplexRow = new Array<number>(nVars).fill(0);
  for (let s = 0; s < n; s++) simplexRow[s] = 1;
  A.push(simplexRow);
  rhs.push(1);
  const c = new Array<number>(nVars).fill(0);
  c[n] = 1;
  const sol = simplexMaximize(A, rhs, c, 20000);
  if (sol.status !== 'optimal') {
    throw new EngineError(
      `The alpha-vector witness linear program terminated with status "${sol.status}", so the pruned set cannot be certified exact. No value function is reported.`,
      'numerical',
    );
  }
  if (sol.objective - M <= 1e-9) return null;
  const belief = sol.x.slice(0, n);
  let total = 0;
  for (const p of belief) total += Math.max(0, p);
  if (!(total > 0)) return null;
  return belief.map((p) => Math.max(0, p) / total);
}

/**
 * EXACT finite-horizon POMDP value iteration over alpha-vectors.
 *
 * Backup (Sondik's enumeration):
 *   Γ^{a,o} = { γ · Σ_{s'} T(s'|s,a)·O(o|s',a)·α(s')  :  α ∈ Γ_{k−1} }
 *   Γ^a     = { r(·,a) } ⊕ ⊕_o Γ^{a,o}        (cross sum over observations)
 *   Γ_k     = prune( ∪_a Γ^a )
 *
 * The cross sum multiplies the vector count by |Γ_{k−1}|^{|O|} per action
 * before pruning, which is why this is only viable for small POMDPs. The cap
 * is enforced and exceeding it is an EngineError: a truncated alpha-vector set
 * would silently understate the value function everywhere.
 */
export function exactPOMDPValueIteration(
  pomdp: POMDP,
  horizon: number,
  discount: number,
  opts: { maxVectors?: number } = {},
): AlphaVectorResult {
  const issues = validatePOMDP(pomdp);
  if (!Number.isFinite(discount) || discount < 0 || discount > 1) {
    issues.push({ code: 'range', field: 'discount', message: `The discount factor over a finite horizon must lie in [0, 1]; ${discount} was supplied.` });
  }
  if (!Number.isInteger(horizon) || horizon < 1) {
    issues.push({ code: 'range', field: 'horizon', message: `The horizon must be a whole number of at least 1; ${horizon} was supplied.` });
  }
  if (issues.length) throw new EngineError(issues);
  const cap = opts.maxVectors ?? POMDP_LIMITS.maxAlphaVectors;
  const n = pomdp.nStates;
  const nO = pomdp.nObservations;
  const nA = pomdp.actions.length;

  let gamma: { v: number[]; a: number }[] = [{ v: new Array<number>(n).fill(0), a: 0 }];
  for (let t = 0; t < horizon; t++) {
    const next: { v: number[]; a: number }[] = [];
    for (let a = 0; a < nA; a++) {
      const T = pomdp.transitions[a];
      const O = pomdp.observations[a];
      // Γ^{a,o} for each observation.
      const perObs: number[][][] = [];
      for (let o = 0; o < nO; o++) {
        const set: number[][] = [];
        for (const { v } of gamma) {
          const w = new Array<number>(n).fill(0);
          for (let s = 0; s < n; s++) {
            let acc = 0;
            for (let sp = 0; sp < n; sp++) {
              const p = T[s][sp] * O[sp][o];
              if (p !== 0) acc += p * v[sp];
            }
            w[s] = discount * acc;
          }
          set.push(w);
        }
        perObs.push(prune(set.map((v) => ({ v, a }))).map((e) => e.v));
      }
      // Cross sum, started from the immediate reward vector.
      let acc: number[][] = [pomdp.rewards[a].slice()];
      for (let o = 0; o < nO; o++) {
        const grown: number[][] = [];
        for (const base of acc) {
          for (const add of perObs[o]) {
            const w = new Array<number>(n);
            for (let s = 0; s < n; s++) w[s] = base[s] + add[s];
            grown.push(w);
          }
        }
        if (grown.length > cap) {
          throw new EngineError(
            `Exact POMDP value iteration would need ${grown.length} alpha-vectors at stage ${t + 1} of ${horizon}, above the cap of ${cap}. Exact value iteration is exponential in the horizon; reduce the horizon or use the QMDP / fast-informed-bound approximations, which are labelled as optimistic upper bounds.`,
            'limit',
          );
        }
        acc = prune(grown.map((v) => ({ v, a }))).map((e) => e.v);
      }
      for (const v of acc) next.push({ v, a });
    }
    gamma = prune(next);
    if (gamma.length > cap) {
      throw new EngineError(
        `Exact POMDP value iteration retained ${gamma.length} alpha-vectors after stage ${t + 1}, above the cap of ${cap}.`,
        'limit',
      );
    }
  }
  return {
    alphaVectors: gamma.map((e) => e.v),
    actions: gamma.map((e) => e.a),
    horizon,
    discount,
    provenance: {
      exactness: 'exact',
      method: `Exact alpha-vector value iteration over ${horizon} stage(s), ${gamma.length} vector(s) retained`,
      assumedInputs: ['The transition, observation and reward models are supplied by the user.'],
      limitations: [
        'This is the exact FINITE-horizon POMDP value function. It is a lower bound on the infinite-horizon value when all rewards are non-negative, and in general it is simply a different problem from the infinite-horizon one.',
        'Pruning removes only duplicates and pointwise-dominated vectors, so the set is exact but not necessarily minimal.',
      ],
    },
  };
}

/** Value of an alpha-vector set at a belief, with the prescribed action. */
export function alphaVectorValue(result: AlphaVectorResult, belief: number[]): { value: number; action: number } {
  validateBelief(belief, result.alphaVectors[0].length);
  let best = -Infinity;
  let action = 0;
  for (let i = 0; i < result.alphaVectors.length; i++) {
    const v = dot(result.alphaVectors[i], belief);
    if (v > best) {
      best = v;
      action = result.actions[i];
    }
  }
  return { value: best, action };
}

/* ------------------------------------------------------ QMDP and the FIB */

export interface POMDPBoundResult {
  /** Q(a) at the supplied belief. */
  qValues: number[];
  value: number;
  action: number;
  actionLabel: string;
  /** 'upper' — both bounds implemented here are optimistic. */
  biasDirection: 'upper';
  provenance: Provenance;
}

/**
 * QMDP: Q(b, a) = Σ_s b(s)·Q_MDP(s, a).
 *
 * This assumes the hidden state becomes fully observable immediately after the
 * current action, so it never pays anything for gathering information and
 * never chooses an action purely to learn. It is therefore an UPPER bound on
 * the true POMDP value — OPTIMISTIC — and it is exactly the POMDP value only
 * when the state really is revealed after one step. Its characteristic failure
 * is refusing to take a costly information-gathering action that the optimal
 * POMDP policy would take.
 */
export function qmdpBound(pomdp: POMDP, belief: number[], discount: number): POMDPBoundResult {
  requireValidPOMDP(pomdp, discount);
  validateBelief(belief, pomdp.nStates);
  const mdp = underlyingMDP(pomdp);
  const vi = valueIteration(mdp, discount, { tolerance: 1e-13, maxIterations: 200000 });
  if (!vi.converged) {
    throw new EngineError(
      `The underlying MDP needed for the QMDP bound did not converge (Bellman error ${vi.bellmanError.toExponential(3)}), so no bound is reported.`,
      'convergence',
    );
  }
  const q = pomdp.actions.map((_, a) => {
    let acc = 0;
    for (let s = 0; s < pomdp.nStates; s++) if (belief[s] !== 0) acc += belief[s] * vi.qValues[s][a];
    return acc;
  });
  let action = 0;
  for (let a = 1; a < q.length; a++) if (q[a] > q[action]) action = a;
  return {
    qValues: q,
    value: q[action],
    action,
    actionLabel: pomdp.actions[action],
    biasDirection: 'upper',
    provenance: {
      exactness: 'numerical',
      method: 'QMDP approximation (one-step-then-observable)',
      assumedInputs: ['The transition, observation and reward models are supplied by the user.'],
      limitations: [
        'APPROXIMATION, OPTIMISTIC: QMDP assumes the state becomes fully observable after one step, so it is an upper bound on the true POMDP value and overstates what is achievable.',
        'QMDP never takes an action whose only benefit is information, because in its world information arrives for free next step. On problems where looking before leaping is essential its policy is poor even though its value estimate is high.',
        `The underlying MDP values come from value iteration, so they carry a numerical error of at most ${vi.errorBound.toExponential(3)}.`,
      ],
    },
  };
}

/**
 * The fast informed bound: Q_FIB(a, s) = r(s,a) + γ Σ_o max_{a'} Σ_{s'}
 * T(s'|s,a)·O(o|s',a)·Q(a', s'). It assumes the state becomes observable only
 * after the NEXT observation is seen, which is a weaker assumption than QMDP's,
 * so FIB is a tighter — but still optimistic — upper bound: V* ≤ FIB ≤ QMDP.
 */
export function fastInformedBound(
  pomdp: POMDP,
  belief: number[],
  discount: number,
  opts: { tolerance?: number; maxIterations?: number } = {},
): POMDPBoundResult {
  requireValidPOMDP(pomdp, discount);
  validateBelief(belief, pomdp.nStates);
  const n = pomdp.nStates;
  const nA = pomdp.actions.length;
  const nO = pomdp.nObservations;
  const tol = opts.tolerance ?? 1e-12;
  const maxIter = opts.maxIterations ?? 200000;
  // Initialise at the QMDP values, which already bound the FIB fixed point.
  let Q: number[][] = Array.from({ length: nA }, (_, a) => pomdp.rewards[a].slice());
  let delta = Infinity;
  let iterations = 0;
  while (iterations < maxIter) {
    const next: number[][] = Array.from({ length: nA }, () => new Array<number>(n).fill(0));
    delta = 0;
    for (let a = 0; a < nA; a++) {
      const T = pomdp.transitions[a];
      const O = pomdp.observations[a];
      for (let s = 0; s < n; s++) {
        let acc = 0;
        for (let o = 0; o < nO; o++) {
          let best = -Infinity;
          for (let ap = 0; ap < nA; ap++) {
            let inner = 0;
            for (let sp = 0; sp < n; sp++) {
              const p = T[s][sp] * O[sp][o];
              if (p !== 0) inner += p * Q[ap][sp];
            }
            if (inner > best) best = inner;
          }
          acc += best;
        }
        const val = pomdp.rewards[a][s] + discount * acc;
        const d = Math.abs(val - Q[a][s]);
        if (d > delta) delta = d;
        next[a][s] = val;
      }
    }
    Q = next;
    iterations++;
    if (delta <= tol) break;
  }
  if (delta > tol) {
    throw new EngineError(
      `The fast informed bound did not converge within ${maxIter} sweeps (achieved change ${delta.toExponential(3)}, tolerance ${tol.toExponential(3)}). No bound is reported.`,
      'convergence',
    );
  }
  const q = Q.map((row) => {
    let acc = 0;
    for (let s = 0; s < n; s++) if (belief[s] !== 0) acc += belief[s] * row[s];
    return acc;
  });
  let action = 0;
  for (let a = 1; a < q.length; a++) if (q[a] > q[action]) action = a;
  const errorBound = discount === 0 ? 0 : (delta * discount) / (1 - discount);
  return {
    qValues: q,
    value: q[action],
    action,
    actionLabel: pomdp.actions[action],
    biasDirection: 'upper',
    provenance: {
      exactness: 'numerical',
      method: `Fast informed bound (${iterations} sweeps)`,
      assumedInputs: ['The transition, observation and reward models are supplied by the user.'],
      limitations: [
        'APPROXIMATION, OPTIMISTIC: an upper bound on the true POMDP value, tighter than QMDP (V* ≤ FIB ≤ QMDP) but still above it.',
        `The fixed point is reached to within ${errorBound.toExponential(3)} in sup norm.`,
      ],
    },
  };
}

/* --------------------------------------------- value of information */

export interface ValueOfInformationResult {
  /** Optimal value if the state were observable, evaluated at the belief. */
  observableValue: number;
  /** The POMDP optimum (or the best available bound on it). */
  pomdpValue: number;
  /** observableValue − pomdpValue ≥ 0: what perfect state knowledge is worth. */
  valueOfInformation: number;
  /** Whether `pomdpValue` is the exact POMDP optimum or an upper bound. */
  pomdpValueKind: 'exact-finite-horizon' | 'qmdp-upper-bound';
  provenance: Provenance;
}

/**
 * The value of knowing the state. For the fully observable problem the value at
 * a belief is Σ_s b(s)·V_MDP(s) — the expected value of being told the state
 * and then acting optimally. The POMDP optimum is at most that, and the gap is
 * what the information is worth.
 *
 * With `horizon` supplied the POMDP side is the EXACT finite-horizon value (and
 * the MDP side is computed over the same horizon, so the comparison is between
 * like and like). Without it, the POMDP side is the QMDP upper bound, so the
 * reported value of information is a LOWER bound on the true value of
 * information — and the result says so.
 */
export function valueOfInformation(
  pomdp: POMDP,
  belief: number[],
  discount: number,
  horizon?: number,
): ValueOfInformationResult {
  requireValidPOMDP(pomdp);
  validateBelief(belief, pomdp.nStates);
  const mdp = underlyingMDP(pomdp);
  if (horizon !== undefined) {
    if (!Number.isInteger(horizon) || horizon < 1) throw new EngineError('The horizon must be a whole number of at least 1.', 'range');
    if (!Number.isFinite(discount) || discount < 0 || discount > 1) throw new EngineError('The discount factor over a finite horizon must lie in [0, 1].', 'range');
    const exact = exactPOMDPValueIteration(pomdp, horizon, discount);
    const pomdpValue = alphaVectorValue(exact, belief).value;
    // Finite-horizon MDP over the same number of stages.
    let v = new Array<number>(pomdp.nStates).fill(0);
    for (let t = 0; t < horizon; t++) {
      const next = new Array<number>(pomdp.nStates).fill(0);
      for (let s = 0; s < pomdp.nStates; s++) {
        let best = -Infinity;
        for (let a = 0; a < pomdp.actions.length; a++) {
          let acc = 0;
          for (let sp = 0; sp < pomdp.nStates; sp++) {
            const p = pomdp.transitions[a][s][sp];
            if (p !== 0) acc += p * v[sp];
          }
          const qv = pomdp.rewards[a][s] + discount * acc;
          if (qv > best) best = qv;
        }
        next[s] = best;
      }
      v = next;
    }
    let observableValue = 0;
    for (let s = 0; s < pomdp.nStates; s++) observableValue += belief[s] * v[s];
    return {
      observableValue,
      pomdpValue,
      valueOfInformation: observableValue - pomdpValue,
      pomdpValueKind: 'exact-finite-horizon',
      provenance: {
        exactness: 'exact',
        method: `Exact ${horizon}-stage POMDP optimum compared with the ${horizon}-stage fully observable optimum`,
        assumedInputs: ['The models and the initial belief are supplied by the user.'],
        limitations: [
          'The value of information is relative to this belief: it is what perfect state knowledge is worth to someone who currently believes exactly this. At a degenerate belief (the state already known) it is 0.',
          'Both sides are computed over the same finite horizon. A different horizon gives a different answer.',
        ],
      },
    };
  }
  if (!Number.isFinite(discount) || discount < 0 || discount >= 1) {
    throw new EngineError('Without a horizon the infinite-horizon discounted problem is solved, which needs γ ∈ [0, 1).', 'range');
  }
  const vi = valueIteration(mdp, discount, { tolerance: 1e-13, maxIterations: 200000 });
  if (!vi.converged) throw new EngineError('The fully observable MDP did not converge, so no value of information is reported.', 'convergence');
  let observableValue = 0;
  for (let s = 0; s < pomdp.nStates; s++) observableValue += belief[s] * vi.values[s];
  const qmdp = qmdpBound(pomdp, belief, discount);
  return {
    observableValue,
    pomdpValue: qmdp.value,
    valueOfInformation: observableValue - qmdp.value,
    pomdpValueKind: 'qmdp-upper-bound',
    provenance: {
      exactness: 'numerical',
      method: 'Fully observable MDP optimum minus the QMDP upper bound on the POMDP optimum',
      assumedInputs: ['The models and the initial belief are supplied by the user.'],
      limitations: [
        'LOWER BOUND ONLY: the POMDP side is the optimistic QMDP bound, so the true value of information is at least as large as the figure reported. Supply a horizon to get the exact gap over that horizon.',
        'The value of information is relative to this belief and to this discount factor.',
      ],
    },
  };
}
