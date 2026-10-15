/**
 * Finite Markov decision processes: validation, value iteration, policy
 * iteration, finite-horizon backward induction, average reward, policy
 * evaluation and state visitation.
 *
 * Everything here is iterative. No routine recurses over the horizon or over
 * the state count, so a 10,000-stage finite-horizon problem is a loop, not a
 * stack overflow.
 */
import { EngineError, Validator, type Issue } from '../core/result';
import { solve, type Matrix } from '../stats/linalg';
import type {
  AverageRewardResult,
  FiniteHorizonResult,
  MDP,
  Policy,
  PolicyEvaluationResult,
  PolicyIterationResult,
  Provenance,
  StateVisitationResult,
  ValueIterationResult,
} from './types';

export const MDP_LIMITS = {
  maxStates: 2000,
  maxValueIterations: 200000,
  maxPolicyIterations: 10000,
  defaultTolerance: 1e-10,
};

const MODEL_ASSUMPTION = [
  'The transition probabilities and rewards are supplied by the user; the arithmetic on them is as labelled, but the model itself is an assumption.',
  'The process is assumed Markov: the next state depends on the current state and action only, not on the history.',
];

/* ------------------------------------------------------------ validation */

/**
 * Validate an MDP. Every failure names exactly what is wrong — in particular a
 * transition row that does not sum to 1 is reported with its state AND action,
 * because "some row is wrong" is not actionable.
 *
 * `discount` is checked only when supplied: γ ∈ [0, 1) is required for the
 * discounted infinite-horizon problem, and γ = 1 is an error there rather than
 * something to be quietly clamped (use the average-reward routines instead).
 */
export function validateMDP(mdp: MDP, discount?: number): Issue[] {
  const v = new Validator();
  const n = mdp.nStates;
  if (!Number.isInteger(n) || n < 1) {
    v.add('An MDP needs at least one state.', 'nStates', 'range');
    return v.issues;
  }
  if (n > MDP_LIMITS.maxStates) {
    v.add(`This implementation supports at most ${MDP_LIMITS.maxStates} states; ${n} were supplied.`, 'nStates', 'limit');
    return v.issues;
  }
  if (!Array.isArray(mdp.actions) || mdp.actions.length !== n) {
    v.add(`An action list is required for each of the ${n} states.`, 'actions', 'shape');
    return v.issues;
  }
  if (mdp.stateLabels && mdp.stateLabels.length !== n) {
    v.add(`${n} state labels are required; ${mdp.stateLabels.length} were supplied.`, 'stateLabels', 'shape');
  }
  for (let s = 0; s < n; s++) {
    const name = stateName(mdp, s);
    const acts = mdp.actions[s];
    if (!Array.isArray(acts) || acts.length === 0) {
      v.add(`State ${name} has no actions. Every state needs at least one action, even if it is "do nothing".`, `actions[${s}]`, 'empty');
      continue;
    }
    const rows = mdp.transitions?.[s];
    const rew = mdp.rewards?.[s];
    if (!Array.isArray(rows) || rows.length !== acts.length) {
      v.add(`State ${name} has ${acts.length} action(s) but ${Array.isArray(rows) ? rows.length : 0} transition row(s).`, `transitions[${s}]`, 'shape');
      continue;
    }
    if (!Array.isArray(rew) || rew.length !== acts.length) {
      v.add(`State ${name} has ${acts.length} action(s) but ${Array.isArray(rew) ? rew.length : 0} reward entr(ies).`, `rewards[${s}]`, 'shape');
      continue;
    }
    for (let a = 0; a < acts.length; a++) {
      const row = rows[a];
      const label = `(state ${name}, action "${acts[a]}")`;
      if (!Array.isArray(row) || row.length !== n) {
        v.add(`Transition row for ${label} must have one probability per state (${n}); it has ${Array.isArray(row) ? row.length : 0}.`, `transitions[${s}][${a}]`, 'shape');
        continue;
      }
      let sum = 0;
      let bad = false;
      for (let j = 0; j < n; j++) {
        const p = row[j];
        if (typeof p !== 'number' || !Number.isFinite(p)) {
          v.add(`Transition probability to state ${stateName(mdp, j)} for ${label} is not a finite number.`, `transitions[${s}][${a}][${j}]`, 'finite');
          bad = true;
          break;
        }
        if (p < 0) {
          v.add(`Transition probability to state ${stateName(mdp, j)} for ${label} is negative (${p}).`, `transitions[${s}][${a}][${j}]`, 'range');
          bad = true;
          break;
        }
        sum += p;
      }
      if (bad) continue;
      if (Math.abs(sum - 1) > 1e-9) {
        v.add(
          `Transition probabilities for ${label} sum to ${sum.toPrecision(12)}, not 1. A transition row must be a complete probability distribution over successor states.`,
          `transitions[${s}][${a}]`,
          'sum',
        );
      }
      const r = rew[a];
      if (Array.isArray(r)) {
        if (r.length !== n) {
          v.add(`Reward vector R(s,a,s') for ${label} must have one entry per state (${n}); it has ${r.length}.`, `rewards[${s}][${a}]`, 'shape');
        } else {
          for (let j = 0; j < n; j++) {
            if (!Number.isFinite(r[j])) {
              v.add(`Reward R(${name}, "${acts[a]}", ${stateName(mdp, j)}) is not a finite number.`, `rewards[${s}][${a}][${j}]`, 'finite');
              break;
            }
          }
        }
      } else if (typeof r !== 'number' || !Number.isFinite(r)) {
        v.add(`Reward for ${label} is not a finite number.`, `rewards[${s}][${a}]`, 'finite');
      }
    }
  }
  if (discount !== undefined) {
    if (!Number.isFinite(discount)) {
      v.add('The discount factor must be a finite number.', 'discount', 'finite');
    } else if (discount < 0) {
      v.add(`The discount factor must be at least 0; ${discount} was supplied.`, 'discount', 'range');
    } else if (discount >= 1) {
      v.add(
        `The discount factor must be strictly below 1 for a discounted infinite-horizon problem; ${discount} was supplied. At γ = 1 the total reward is generally infinite — use the average-reward routines (averageRewardMDP) or a finite horizon instead.`,
        'discount',
        'range',
      );
    }
  }
  return v.issues;
}

export function stateName(mdp: MDP, s: number): string {
  return mdp.stateLabels?.[s] ?? String(s);
}

function requireValid(mdp: MDP, discount?: number): void {
  const issues = validateMDP(mdp, discount);
  if (issues.length) throw new EngineError(issues);
}

/* --------------------------------------------------------------- helpers */

/** Expected immediate reward r(s,a), contracting R(s,a,s') when a vector. */
export function expectedReward(mdp: MDP, s: number, a: number): number {
  const r = mdp.rewards[s][a];
  if (!Array.isArray(r)) return r;
  const row = mdp.transitions[s][a];
  let acc = 0;
  for (let j = 0; j < row.length; j++) {
    if (row[j] !== 0) acc += row[j] * r[j];
  }
  return acc;
}

/** The full expected-reward table r(s,a), computed once per solve. */
export function rewardTable(mdp: MDP): number[][] {
  const out: number[][] = [];
  for (let s = 0; s < mdp.nStates; s++) {
    const row: number[] = [];
    for (let a = 0; a < mdp.actions[s].length; a++) row.push(expectedReward(mdp, s, a));
    out.push(row);
  }
  return out;
}

function qFromValues(mdp: MDP, r: number[][], values: number[], discount: number): number[][] {
  const n = mdp.nStates;
  const q: number[][] = [];
  for (let s = 0; s < n; s++) {
    const row: number[] = [];
    for (let a = 0; a < mdp.actions[s].length; a++) {
      const p = mdp.transitions[s][a];
      let acc = 0;
      for (let j = 0; j < n; j++) {
        if (p[j] !== 0) acc += p[j] * values[j];
      }
      row.push(r[s][a] + discount * acc);
    }
    q.push(row);
  }
  return q;
}

/**
 * Greedy action per state. Ties are broken towards the lowest action index so
 * that two independent routes landing on the same value function also report
 * the same policy — a tie-break that varied would break the cross-check.
 */
function greedy(q: number[][], tieTolerance = 0): Policy {
  return q.map((row) => {
    let best = 0;
    for (let a = 1; a < row.length; a++) {
      if (row[a] > row[best] + tieTolerance) best = a;
    }
    return best;
  });
}

function advantagesFrom(q: number[][], values: number[]): number[][] {
  return q.map((row, s) => row.map((x) => x - values[s]));
}

function labelsFor(mdp: MDP, policy: Policy): string[] {
  return policy.map((a, s) => mdp.actions[s][a]);
}

/* ------------------------------------------------------- value iteration */

export interface ValueIterationOptions {
  tolerance?: number;
  maxIterations?: number;
  initialValues?: number[];
  /** Gauss–Seidel style in-place sweeps; converges faster, same fixed point. */
  inPlace?: boolean;
}

/**
 * Value iteration with the contraction error bound.
 *
 * The Bellman operator is a γ-contraction in the sup norm, so if a sweep moves
 * the value function by at most ε then
 *
 *     ‖v − v*‖∞ ≤ ε · γ / (1 − γ)
 *
 * and the greedy policy's value is within 2εγ/(1−γ) of optimal. Both numbers
 * are returned. If the iteration cap is reached without meeting the tolerance
 * the result is reported with `converged: false` and the achieved Bellman
 * error — it is NOT presented as a solution.
 */
export function valueIteration(mdp: MDP, discount: number, opts: ValueIterationOptions = {}): ValueIterationResult {
  requireValid(mdp, discount);
  const tolerance = opts.tolerance ?? MDP_LIMITS.defaultTolerance;
  if (!(tolerance > 0)) throw new EngineError('The value-iteration tolerance must be greater than 0.', 'range');
  const maxIterations = opts.maxIterations ?? MDP_LIMITS.maxValueIterations;
  const n = mdp.nStates;
  const r = rewardTable(mdp);
  const values = opts.initialValues ? [...opts.initialValues] : new Array<number>(n).fill(0);
  if (values.length !== n) throw new EngineError(`initialValues must have one entry per state (${n}).`, 'shape');

  let bellmanError = Infinity;
  let iterations = 0;
  const inPlace = opts.inPlace ?? false;
  const next = new Array<number>(n).fill(0);

  while (iterations < maxIterations) {
    let delta = 0;
    for (let s = 0; s < n; s++) {
      let best = -Infinity;
      const acts = mdp.actions[s].length;
      for (let a = 0; a < acts; a++) {
        const p = mdp.transitions[s][a];
        let acc = 0;
        for (let j = 0; j < n; j++) {
          if (p[j] !== 0) acc += p[j] * values[j];
        }
        const qv = r[s][a] + discount * acc;
        if (qv > best) best = qv;
      }
      const d = Math.abs(best - values[s]);
      if (d > delta) delta = d;
      if (inPlace) values[s] = best;
      else next[s] = best;
    }
    if (!inPlace) {
      for (let s = 0; s < n; s++) values[s] = next[s];
    }
    iterations++;
    bellmanError = delta;
    if (delta <= tolerance) break;
  }

  const converged = bellmanError <= tolerance;
  // γ = 0 makes the bound exactly 0: one sweep is already optimal.
  const errorBound = discount === 0 ? 0 : (bellmanError * discount) / (1 - discount);
  const q = qFromValues(mdp, r, values, discount);
  const policy = greedy(q);
  const limitations = [
    `Value iteration stops at a tolerance, so the value function is numerical: ‖v − v*‖∞ ≤ ${errorBound.toExponential(3)}.`,
    `The greedy policy extracted from v is within ${(2 * errorBound).toExponential(3)} of optimal in value; it may still differ from an exactly optimal policy when two actions are nearly tied.`,
  ];
  if (!converged) {
    limitations.unshift(
      `NOT CONVERGED: the iteration cap of ${maxIterations} sweeps was reached with a Bellman error of ${bellmanError.toExponential(3)}, above the requested tolerance of ${tolerance.toExponential(3)}. These values are not a solution to the stated tolerance.`,
    );
  }
  const provenance: Provenance = {
    exactness: 'numerical',
    method: `Value iteration (${iterations} sweeps, γ = ${discount})`,
    assumedInputs: MODEL_ASSUMPTION,
    limitations,
  };
  return {
    values,
    qValues: q,
    advantages: advantagesFrom(q, values),
    policy,
    policyLabels: labelsFor(mdp, policy),
    discount,
    iterations,
    bellmanError,
    errorBound,
    converged,
    tolerance,
    provenance,
  };
}

/* ---------------------------------------------------- policy evaluation */

/**
 * Exact policy evaluation: solve (I − γ·P_π) v = r_π by Gaussian elimination.
 * For γ < 1 the matrix is strictly diagonally dominant in the sense needed for
 * invertibility, so a singular system is a genuine error (reported, not
 * patched).
 */
export function evaluatePolicyExact(mdp: MDP, policy: Policy, discount: number): number[] {
  requireValid(mdp, discount);
  const n = mdp.nStates;
  if (policy.length !== n) throw new EngineError(`The policy must name an action for each of the ${n} states; ${policy.length} were supplied.`, 'shape');
  for (let s = 0; s < n; s++) {
    const a = policy[s];
    if (!Number.isInteger(a) || a < 0 || a >= mdp.actions[s].length) {
      throw new EngineError(
        `The policy names action index ${a} in state ${stateName(mdp, s)}, which has ${mdp.actions[s].length} action(s) (valid indices 0..${mdp.actions[s].length - 1}).`,
        'range',
      );
    }
  }
  const A: Matrix = [];
  const b: number[] = [];
  for (let s = 0; s < n; s++) {
    const a = policy[s];
    const p = mdp.transitions[s][a];
    const row = new Array<number>(n).fill(0);
    for (let j = 0; j < n; j++) row[j] = (s === j ? 1 : 0) - discount * p[j];
    A.push(row);
    b.push(expectedReward(mdp, s, a));
  }
  const x = solve(A, b);
  if (!x || x.some((v) => !Number.isFinite(v))) {
    throw new EngineError(
      'The policy-evaluation system (I − γ·P_π)·v = r_π is singular to working precision, so the policy value cannot be computed. This should not happen for γ < 1; check the transition rows.',
      'singular',
    );
  }
  return x;
}

/** Evaluate a user-supplied policy and name the improvements available. */
export function evaluatePolicy(mdp: MDP, policy: Policy, discount: number): PolicyEvaluationResult {
  const values = evaluatePolicyExact(mdp, policy, discount);
  const r = rewardTable(mdp);
  const q = qFromValues(mdp, r, values, discount);
  const improvements: PolicyEvaluationResult['improvements'] = [];
  for (let s = 0; s < mdp.nStates; s++) {
    const cur = q[s][policy[s]];
    let best = policy[s];
    for (let a = 0; a < q[s].length; a++) if (q[s][a] > q[s][best]) best = a;
    if (best !== policy[s] && q[s][best] - cur > 1e-12) {
      improvements.push({ state: s, from: mdp.actions[s][policy[s]], to: mdp.actions[s][best], gain: q[s][best] - cur });
    }
  }
  return {
    values,
    qValues: q,
    improvements,
    provenance: {
      exactness: 'exact',
      method: 'Policy evaluation by direct linear solve of (I − γ·P_π)·v = r_π',
      assumedInputs: MODEL_ASSUMPTION,
      limitations: [
        'This is the value of the supplied policy, not the optimal value. The listed improvements are one-step improvements; applying them and re-evaluating (policy iteration) may improve further.',
      ],
    },
  };
}

/* ------------------------------------------------------ policy iteration */

export interface PolicyIterationOptions {
  initialPolicy?: Policy;
  maxIterations?: number;
  /**
   * Modified policy iteration: this many evaluation sweeps per improvement
   * instead of an exact solve. Omit (or Infinity) for the exact solve, which
   * makes the result exact rather than numerical.
   */
  evaluationSweeps?: number;
}

/**
 * Policy iteration. With an exact policy evaluation at each step the algorithm
 * terminates in finitely many improvements at the exactly optimal policy, and
 * the returned value function is the exact solution of a linear system — so
 * this route is labelled `exact`, unlike value iteration.
 *
 * `evaluationSweeps = k` gives modified policy iteration: k sweeps of iterative
 * evaluation instead of the solve. That variant is numerical and says so.
 */
export function policyIteration(mdp: MDP, discount: number, opts: PolicyIterationOptions = {}): PolicyIterationResult {
  requireValid(mdp, discount);
  const n = mdp.nStates;
  const r = rewardTable(mdp);
  const sweeps = opts.evaluationSweeps ?? Infinity;
  if (sweeps !== Infinity && (!Number.isInteger(sweeps) || sweeps < 1)) {
    throw new EngineError('evaluationSweeps must be a whole number of at least 1, or Infinity for an exact solve.', 'range');
  }
  const maxIterations = opts.maxIterations ?? MDP_LIMITS.maxPolicyIterations;
  let policy: Policy = opts.initialPolicy ? [...opts.initialPolicy] : new Array<number>(n).fill(0);
  if (policy.length !== n) throw new EngineError(`initialPolicy must name an action for each of the ${n} states.`, 'shape');
  const policyPath: Policy[] = [[...policy]];
  let values = new Array<number>(n).fill(0);
  let iterations = 0;
  let stable = false;

  while (iterations < maxIterations) {
    if (sweeps === Infinity) {
      values = evaluatePolicyExact(mdp, policy, discount);
    } else {
      for (let k = 0; k < sweeps; k++) {
        const next = new Array<number>(n).fill(0);
        for (let s = 0; s < n; s++) {
          const a = policy[s];
          const p = mdp.transitions[s][a];
          let acc = 0;
          for (let j = 0; j < n; j++) if (p[j] !== 0) acc += p[j] * values[j];
          next[s] = r[s][a] + discount * acc;
        }
        values = next;
      }
    }
    const q = qFromValues(mdp, r, values, discount);
    const improved = greedy(q);
    iterations++;
    // Keep the incumbent action when it is optimal to within round-off, so the
    // algorithm cannot cycle between two exactly-tied actions forever.
    const nextPolicy = improved.map((a, s) => (q[s][a] - q[s][policy[s]] > 1e-13 ? a : policy[s]));
    const changed = nextPolicy.some((a, s) => a !== policy[s]);
    policy = nextPolicy;
    policyPath.push([...policy]);
    if (!changed) {
      stable = true;
      break;
    }
  }
  if (!stable) {
    throw new EngineError(
      `Policy iteration did not stabilise within ${maxIterations} improvement steps. This is not expected for a valid discounted MDP; the result is withheld rather than reported as optimal.`,
      'convergence',
    );
  }
  // Final exact evaluation so the reported values match the reported policy.
  values = evaluatePolicyExact(mdp, policy, discount);
  const q = qFromValues(mdp, r, values, discount);
  return {
    values,
    qValues: q,
    advantages: advantagesFrom(q, values),
    policy,
    policyLabels: labelsFor(mdp, policy),
    discount,
    iterations,
    policyPath,
    evaluationSweeps: sweeps,
    provenance: {
      exactness: sweeps === Infinity ? 'exact' : 'numerical',
      method:
        sweeps === Infinity
          ? `Policy iteration with exact policy evaluation (${iterations} improvement steps)`
          : `Modified policy iteration with ${sweeps} evaluation sweep(s) per improvement (${iterations} improvement steps), followed by one exact evaluation of the final policy`,
      assumedInputs: MODEL_ASSUMPTION,
      limitations: [
        'The optimal policy is not always unique: when two actions have equal Q-values either is optimal, and this routine reports the lower action index.',
      ],
    },
  };
}

/* ------------------------------------------------- finite horizon (exact) */

/**
 * Backward induction over a finite horizon. The optimal policy here is
 * TIME-DEPENDENT: the best action with three stages left is frequently not the
 * best action with one stage left, because there is no longer time for an
 * investment to pay off. `policyIsTimeDependent` surfaces that explicitly,
 * since treating a finite-horizon policy as stationary is a common error.
 *
 * `terminalValues` is the value of ending in each state (default 0).
 */
export function finiteHorizonMDP(
  mdp: MDP,
  horizon: number,
  discount = 1,
  terminalValues?: number[],
): FiniteHorizonResult {
  // γ = 1 is legitimate over a finite horizon, so the discount is not checked
  // against 1 here; only finiteness and non-negativity.
  const issues = validateMDP(mdp);
  if (!Number.isFinite(discount) || discount < 0 || discount > 1) {
    issues.push({ code: 'range', field: 'discount', message: `The discount factor over a finite horizon must lie in [0, 1]; ${discount} was supplied.` });
  }
  if (!Number.isInteger(horizon) || horizon < 1) {
    issues.push({ code: 'range', field: 'horizon', message: `The horizon must be a whole number of at least 1; ${horizon} was supplied.` });
  }
  if (issues.length) throw new EngineError(issues);
  const n = mdp.nStates;
  if (terminalValues && terminalValues.length !== n) {
    throw new EngineError(`terminalValues must have one entry per state (${n}); ${terminalValues.length} were supplied.`, 'shape');
  }
  const r = rewardTable(mdp);
  const values: number[][] = new Array(horizon + 1);
  values[horizon] = terminalValues ? [...terminalValues] : new Array<number>(n).fill(0);
  const policy: number[][] = new Array(horizon);
  for (let t = horizon - 1; t >= 0; t--) {
    const vNext = values[t + 1];
    const vt = new Array<number>(n).fill(0);
    const pt = new Array<number>(n).fill(0);
    for (let s = 0; s < n; s++) {
      let best = -Infinity;
      let bestA = 0;
      for (let a = 0; a < mdp.actions[s].length; a++) {
        const p = mdp.transitions[s][a];
        let acc = 0;
        for (let j = 0; j < n; j++) if (p[j] !== 0) acc += p[j] * vNext[j];
        const qv = r[s][a] + discount * acc;
        if (qv > best) {
          best = qv;
          bestA = a;
        }
      }
      vt[s] = best;
      pt[s] = bestA;
    }
    values[t] = vt;
    policy[t] = pt;
  }
  let timeDependent = false;
  for (let t = 1; t < horizon && !timeDependent; t++) {
    for (let s = 0; s < n; s++) {
      if (policy[t][s] !== policy[0][s]) {
        timeDependent = true;
        break;
      }
    }
  }
  return {
    values,
    policy,
    policyLabels: policy.map((row) => row.map((a, s) => mdp.actions[s][a])),
    horizon,
    discount,
    policyIsTimeDependent: timeDependent,
    provenance: {
      exactness: 'exact',
      method: `Backward induction over ${horizon} stage(s) (γ = ${discount})`,
      assumedInputs: MODEL_ASSUMPTION,
      limitations: timeDependent
        ? ['The optimal policy depends on how many stages remain: the action for the same state differs between stages. A single stationary policy cannot reproduce this optimum.']
        : ['The optimal policy happens to be the same at every stage for this problem, but that is a property of these numbers, not a general rule.'],
    },
  };
}

/* ------------------------------------------------------- average reward */

/**
 * Relative (White's) value iteration for the undiscounted average-reward
 * criterion: h_{k+1}(s) = max_a [ r(s,a) + Σ P h_k(s') ] − max_a[...](s_ref),
 * with convergence measured by the span seminorm.
 *
 * The discounted and average-reward optima CAN DIFFER: discounting trades
 * long-run throughput for early reward, so a policy that is optimal at γ = 0.9
 * may be strictly suboptimal per-step in the long run. This is not a numerical
 * artefact; the two criteria ask different questions.
 */
export function averageRewardMDP(
  mdp: MDP,
  opts: { tolerance?: number; maxIterations?: number; referenceState?: number } = {},
): AverageRewardResult {
  requireValid(mdp);
  const n = mdp.nStates;
  const ref = opts.referenceState ?? 0;
  if (!Number.isInteger(ref) || ref < 0 || ref >= n) {
    throw new EngineError(`referenceState must be a state index in 0..${n - 1}.`, 'range');
  }
  const tolerance = opts.tolerance ?? 1e-10;
  if (!(tolerance > 0)) throw new EngineError('The average-reward tolerance must be greater than 0.', 'range');
  const maxIterations = opts.maxIterations ?? MDP_LIMITS.maxValueIterations;
  const r = rewardTable(mdp);
  let h = new Array<number>(n).fill(0);
  let gain = 0;
  let span = Infinity;
  let iterations = 0;
  const raw = new Array<number>(n).fill(0);
  const policy: Policy = new Array<number>(n).fill(0);

  while (iterations < maxIterations) {
    for (let s = 0; s < n; s++) {
      let best = -Infinity;
      let bestA = 0;
      for (let a = 0; a < mdp.actions[s].length; a++) {
        const p = mdp.transitions[s][a];
        let acc = 0;
        for (let j = 0; j < n; j++) if (p[j] !== 0) acc += p[j] * h[j];
        const qv = r[s][a] + acc;
        if (qv > best) {
          best = qv;
          bestA = a;
        }
      }
      raw[s] = best;
      policy[s] = bestA;
    }
    gain = raw[ref] - h[ref];
    const diff = new Array<number>(n);
    for (let s = 0; s < n; s++) diff[s] = raw[s] - h[s];
    span = Math.max(...diff) - Math.min(...diff);
    const shift = raw[ref];
    const next = new Array<number>(n);
    for (let s = 0; s < n; s++) next[s] = raw[s] - shift;
    h = next;
    iterations++;
    if (span <= tolerance) break;
  }
  const converged = span <= tolerance;
  const limitations = [
    'The discounted-optimal and average-reward-optimal policies can differ. The average-reward criterion ignores when reward arrives; the discounted criterion deliberately does not.',
    'Relative values h(s) are identified only up to an additive constant; h is reported with h(reference state) = 0. Differences h(s) − h(s\') are meaningful, absolute levels are not.',
    'The gain is constant across states only if the MDP is unichain under the optimal policy. For a multichain MDP the per-state gain can differ and this routine reports the gain at the reference state.',
  ];
  if (!converged) {
    limitations.unshift(
      `NOT CONVERGED: relative value iteration reached the cap of ${maxIterations} sweeps with a span of ${span.toExponential(3)}, above the tolerance of ${tolerance.toExponential(3)}. The gain reported is not accurate to the requested tolerance.`,
    );
  }
  return {
    gain,
    relativeValues: h,
    policy,
    policyLabels: labelsFor(mdp, policy),
    iterations,
    span,
    converged,
    provenance: {
      exactness: 'numerical',
      method: `Relative value iteration for average reward (${iterations} sweeps, span ${span.toExponential(3)})`,
      assumedInputs: MODEL_ASSUMPTION,
      limitations,
    },
  };
}

/* --------------------------------------------------- state visitation */

/**
 * Discounted state-occupancy measure under a policy:
 * d(s) = Σ_t γ^t P(s_t = s | s_0 ~ α, π), solved exactly from
 * dᵀ(I − γP_π) = αᵀ. The normalised version (×(1−γ)) is the discounted
 * visitation distribution, which sums to 1 and is what a policy-gradient
 * objective averages over.
 */
export function stateVisitation(mdp: MDP, policy: Policy, discount: number, initial?: number[]): StateVisitationResult {
  requireValid(mdp, discount);
  const n = mdp.nStates;
  if (policy.length !== n) throw new EngineError(`The policy must name an action for each of the ${n} states.`, 'shape');
  let alpha: number[];
  if (initial) {
    if (initial.length !== n) throw new EngineError(`The initial distribution must have one entry per state (${n}).`, 'shape');
    let sum = 0;
    for (const p of initial) {
      if (!Number.isFinite(p) || p < 0) throw new EngineError('The initial state distribution must contain non-negative finite probabilities.', 'range');
      sum += p;
    }
    if (Math.abs(sum - 1) > 1e-9) throw new EngineError(`The initial state distribution sums to ${sum.toPrecision(12)}, not 1.`, 'sum');
    alpha = [...initial];
  } else {
    alpha = new Array<number>(n).fill(1 / n);
  }
  // Solve (I − γ P_πᵀ) d = α.
  const A: Matrix = [];
  for (let i = 0; i < n; i++) {
    const row = new Array<number>(n).fill(0);
    for (let j = 0; j < n; j++) row[j] = (i === j ? 1 : 0) - discount * mdp.transitions[j][policy[j]][i];
    A.push(row);
  }
  const occ = solve(A, alpha);
  if (!occ || occ.some((x) => !Number.isFinite(x))) {
    throw new EngineError('The occupancy system (I − γ·P_πᵀ)·d = α is singular to working precision; the visitation measure cannot be computed.', 'singular');
  }
  const scale = 1 - discount;
  return {
    occupancy: occ,
    distribution: occ.map((x) => x * scale),
    provenance: {
      exactness: 'exact',
      method: 'Discounted state-occupancy measure by direct linear solve',
      assumedInputs: MODEL_ASSUMPTION,
      limitations: [
        'This is the DISCOUNTED visitation measure, which weights early visits more heavily. It is not the stationary distribution of the induced Markov chain (that is the γ → 1 limit, available from the average-reward routines).',
      ],
    },
  };
}
