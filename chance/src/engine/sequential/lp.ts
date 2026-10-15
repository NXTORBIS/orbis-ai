/**
 * The linear-programming route to the optimal policy of a discounted MDP.
 *
 * This exists as a THIRD independent route, deliberately sharing no code with
 * value iteration or policy iteration. The dual (occupancy-measure) LP is
 *
 *     maximise   Σ_{s,a} r(s,a) · x(s,a)
 *     subject to Σ_a x(s',a) − γ Σ_{s,a} P(s'|s,a) · x(s,a) = α(s')   ∀ s'
 *                x ≥ 0
 *
 * whose optimal basis names one action per state (the optimal policy) whenever
 * α > 0 everywhere, because then every state carries positive discounted
 * occupancy. The policy is then evaluated exactly, so the value function this
 * route returns is the exact solution of a linear system found by a completely
 * different algorithm. Agreement between the three routes is the strongest
 * correctness evidence the module has.
 */
import { EngineError } from '../core/result';
import { evaluatePolicyExact, expectedReward, rewardTable, stateName, validateMDP } from './mdp';
import type { MDP, Policy, Provenance, ValueFunctionResult } from './types';

export type LPStatus = 'optimal' | 'infeasible' | 'unbounded' | 'iteration-limit';

export interface LPSolution {
  status: LPStatus;
  x: number[];
  objective: number;
  iterations: number;
}

const PIVOT_TOL = 1e-11;

/**
 * Two-phase primal simplex for  maximise cᵀx  s.t.  A·x = b,  x ≥ 0.
 *
 * Dense tableau with partial-pivot-free Dantzig entering rule and a lowest-index
 * tie-break in the ratio test (Bland's rule on ties), which rules out cycling in
 * practice for the problem sizes here. A failure to reach optimality is returned
 * as a status, never as a plausible-looking vector.
 */
export function simplexMaximize(A: number[][], b: number[], c: number[], maxIterations = 20000): LPSolution {
  const m = A.length;
  const n = c.length;
  if (m === 0) return { status: 'optimal', x: new Array<number>(n).fill(0), objective: 0, iterations: 0 };
  for (const row of A) {
    if (row.length !== n) throw new EngineError('Every constraint row must have one coefficient per variable.', 'shape');
  }
  if (b.length !== m) throw new EngineError('The right-hand side must have one entry per constraint.', 'shape');

  const width = n + m + 1; // variables, artificials, rhs
  const T: number[][] = [];
  for (let i = 0; i < m; i++) {
    const sign = b[i] < 0 ? -1 : 1;
    const row = new Array<number>(width).fill(0);
    for (let j = 0; j < n; j++) row[j] = sign * A[i][j];
    row[n + i] = 1;
    row[width - 1] = sign * b[i];
    T.push(row);
  }
  const basis = Array.from({ length: m }, (_, i) => n + i);
  let iterations = 0;

  // Reduced-cost row maintained by elimination: obj[j] = cost_j − Σ_i cB_i·T[i][j].
  const obj = new Array<number>(width).fill(0);
  const buildObjective = (cost: (j: number) => number): void => {
    for (let j = 0; j < width; j++) obj[j] = j === width - 1 ? 0 : cost(j);
    for (let i = 0; i < m; i++) {
      const cb = cost(basis[i]);
      if (cb === 0) continue;
      for (let j = 0; j < width; j++) obj[j] -= cb * T[i][j];
    }
  };

  const pivot = (row: number, col: number): void => {
    const p = T[row][col];
    for (let j = 0; j < width; j++) T[row][j] /= p;
    for (let i = 0; i < m; i++) {
      if (i === row) continue;
      const f = T[i][col];
      if (f === 0) continue;
      for (let j = 0; j < width; j++) T[i][j] -= f * T[row][j];
    }
    const f = obj[col];
    if (f !== 0) {
      for (let j = 0; j < width; j++) obj[j] -= f * T[row][j];
    }
    basis[row] = col;
  };

  /** One simplex phase. Columns with index ≥ `limit` may not enter. */
  const run = (limit: number): LPStatus => {
    for (;;) {
      let enter = -1;
      let bestVal = -PIVOT_TOL;
      for (let j = 0; j < limit; j++) {
        if (obj[j] < bestVal) {
          bestVal = obj[j];
          enter = j;
        }
      }
      if (enter < 0) return 'optimal';
      let leave = -1;
      let bestRatio = Infinity;
      for (let i = 0; i < m; i++) {
        const a = T[i][enter];
        if (a <= PIVOT_TOL) continue;
        const ratio = T[i][width - 1] / a;
        if (ratio < bestRatio - 1e-12 || (ratio < bestRatio + 1e-12 && leave >= 0 && basis[i] < basis[leave])) {
          bestRatio = ratio;
          leave = i;
        }
      }
      if (leave < 0) return 'unbounded';
      pivot(leave, enter);
      iterations++;
      if (iterations > maxIterations) return 'iteration-limit';
    }
  };

  // Phase 1: minimise the sum of artificials, i.e. maximise its negative.
  buildObjective((j) => (j >= n ? 1 : 0));
  const p1 = run(n + m);
  if (p1 !== 'optimal') return { status: p1, x: new Array<number>(n).fill(0), objective: 0, iterations };
  let infeasibility = 0;
  for (let i = 0; i < m; i++) if (basis[i] >= n) infeasibility += Math.abs(T[i][width - 1]);
  if (infeasibility > 1e-8) {
    return { status: 'infeasible', x: new Array<number>(n).fill(0), objective: 0, iterations };
  }
  // Drive any remaining (zero-level) artificials out of the basis.
  for (let i = 0; i < m; i++) {
    if (basis[i] < n) continue;
    let col = -1;
    for (let j = 0; j < n; j++) {
      if (Math.abs(T[i][j]) > 1e-9) {
        col = j;
        break;
      }
    }
    if (col >= 0) pivot(i, col);
    // Otherwise the row is redundant: all-zero in the real variables, rhs 0.
  }

  // Phase 2: maximise cᵀx, i.e. minimise −cᵀx; artificials are frozen out.
  buildObjective((j) => (j < n ? -c[j] : 0));
  const p2 = run(n);
  const x = new Array<number>(n).fill(0);
  for (let i = 0; i < m; i++) {
    if (basis[i] < n) x[basis[i]] = T[i][width - 1];
  }
  let objective = 0;
  for (let j = 0; j < n; j++) objective += c[j] * x[j];
  return { status: p2, x, objective, iterations };
}

export interface LPPolicyResult extends ValueFunctionResult {
  /** The optimal occupancy measure x(s,a) from the LP basis. */
  occupancy: number[][];
  lpObjective: number;
  lpIterations: number;
}

/**
 * Solve a discounted MDP by linear programming.
 *
 * `initial` must put positive probability on every state (the default is
 * uniform). With α(s) = 0 somewhere the LP still optimises the stated
 * objective, but the occupancy of an unvisited state is 0 and the LP then says
 * nothing about the action to take there — so that case is refused rather than
 * answered with an arbitrary action.
 */
export function lpSolveMDP(mdp: MDP, discount: number, initial?: number[]): LPPolicyResult {
  const issues = validateMDP(mdp, discount);
  if (issues.length) throw new EngineError(issues);
  const n = mdp.nStates;
  let alpha: number[];
  if (initial) {
    if (initial.length !== n) throw new EngineError(`The initial distribution must have one entry per state (${n}).`, 'shape');
    let sum = 0;
    for (let s = 0; s < n; s++) {
      if (!Number.isFinite(initial[s]) || initial[s] <= 0) {
        throw new EngineError(
          `The LP route needs a strictly positive initial probability for every state so that each state carries occupancy; state ${stateName(mdp, s)} has ${initial[s]}. With zero occupancy the LP determines no action for that state.`,
          'range',
        );
      }
      sum += initial[s];
    }
    if (Math.abs(sum - 1) > 1e-9) throw new EngineError(`The initial state distribution sums to ${sum.toPrecision(12)}, not 1.`, 'sum');
    alpha = [...initial];
  } else {
    alpha = new Array<number>(n).fill(1 / n);
  }

  // Variable index for (s, a).
  const index: number[][] = [];
  const pairs: { s: number; a: number }[] = [];
  for (let s = 0; s < n; s++) {
    const row: number[] = [];
    for (let a = 0; a < mdp.actions[s].length; a++) {
      row.push(pairs.length);
      pairs.push({ s, a });
    }
    index.push(row);
  }
  const nVars = pairs.length;
  const A: number[][] = [];
  for (let sp = 0; sp < n; sp++) {
    const row = new Array<number>(nVars).fill(0);
    for (let k = 0; k < nVars; k++) {
      const { s, a } = pairs[k];
      row[k] = (s === sp ? 1 : 0) - discount * mdp.transitions[s][a][sp];
    }
    A.push(row);
  }
  const c = pairs.map(({ s, a }) => expectedReward(mdp, s, a));
  const sol = simplexMaximize(A, alpha, c);
  if (sol.status !== 'optimal') {
    throw new EngineError(
      `The MDP linear program terminated with status "${sol.status}" after ${sol.iterations} pivots, so no optimal policy can be reported from this route. For a valid discounted MDP the program is always feasible and bounded; this indicates a numerically degenerate model.`,
      'convergence',
    );
  }
  const occupancy: number[][] = index.map((row) => row.map((k) => sol.x[k]));
  const policy: Policy = [];
  for (let s = 0; s < n; s++) {
    let best = 0;
    for (let a = 1; a < occupancy[s].length; a++) if (occupancy[s][a] > occupancy[s][best]) best = a;
    if (!(occupancy[s][best] > 1e-12)) {
      throw new EngineError(
        `The linear program gave state ${stateName(mdp, s)} total occupancy ${occupancy[s].reduce((p, q) => p + q, 0).toExponential(3)}, which is too small to identify an action there. Increase the initial probability of that state.`,
        'degenerate',
      );
    }
    policy.push(best);
  }
  const values = evaluatePolicyExact(mdp, policy, discount);
  const r = rewardTable(mdp);
  const qValues: number[][] = [];
  for (let s = 0; s < n; s++) {
    const row: number[] = [];
    for (let a = 0; a < mdp.actions[s].length; a++) {
      const p = mdp.transitions[s][a];
      let acc = 0;
      for (let j = 0; j < n; j++) if (p[j] !== 0) acc += p[j] * values[j];
      row.push(r[s][a] + discount * acc);
    }
    qValues.push(row);
  }
  const provenance: Provenance = {
    exactness: 'exact',
    method: `Dual (occupancy) linear program solved by two-phase simplex (${sol.iterations} pivots), then exact evaluation of the resulting policy`,
    assumedInputs: [
      'The transition probabilities and rewards are supplied by the user.',
      'The initial state distribution affects the LP objective value but not the optimal policy, provided every state has positive probability.',
    ],
    limitations: [
      'The LP objective value is the α-weighted expected discounted reward, not the per-state value function; the per-state values are obtained by evaluating the LP-optimal policy exactly.',
      'A degenerate optimal basis can leave two actions tied; this routine reports the one with the larger occupancy.',
    ],
  };
  return {
    values,
    qValues,
    advantages: qValues.map((row, s) => row.map((x) => x - values[s])),
    policy,
    policyLabels: policy.map((a, s) => mdp.actions[s][a]),
    discount,
    occupancy,
    lpObjective: sol.objective,
    lpIterations: sol.iterations,
    provenance,
  };
}
