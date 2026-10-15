/**
 * Reinforcement learning from samples: the case where the model is NOT known.
 *
 * These routines never look at the transition probabilities while learning;
 * they only sample transitions from them, exactly as an agent interacting with
 * the real process would. The model is used afterwards, and only when asked, to
 * produce a convergence diagnostic against the exactly computed optimum — which
 * is a luxury available here and never available in the field.
 *
 * The honesty problem specific to this family: the convergence theorems for
 * Q-learning, SARSA and TD require decaying step sizes satisfying Σα = ∞,
 * Σα² < ∞ AND infinite visitation of every state-action pair. A finite run
 * meets neither condition. Every result therefore reports whether each pair was
 * visited enough times to mean anything, and refuses to call itself converged
 * when it was not.
 */
import { EngineError, type Issue } from '../core/result';
import { Random, Xoshiro128 } from '../random/rng';
import { evaluatePolicyExact, policyIteration, rewardTable, validateMDP } from './mdp';
import type { MDP, Policy, Provenance } from './types';

export type StepSizeSchedule =
  /** α_n = initial / n for the n-th visit to the pair: satisfies the theory. */
  | { kind: 'inverse-count'; initial: number }
  /** α_n = initial / n^exponent, exponent ∈ (0.5, 1]. */
  | { kind: 'polynomial'; initial: number; exponent: number }
  /** A constant step size: tracks a moving target but never converges. */
  | { kind: 'constant'; value: number };

export interface ExplorationPolicy {
  kind: 'epsilon-greedy';
  epsilon: number;
  /** ε_t = epsilon / (1 + decay·t) when a decay is given. */
  decay?: number;
}

export interface RLRequest {
  mdp: MDP;
  discount: number;
  episodes: number;
  stepsPerEpisode: number;
  seed: string;
  stepSize?: StepSizeSchedule;
  exploration?: ExplorationPolicy;
  /** States that end an episode when entered. */
  terminalStates?: number[];
  /** Start-state distribution; uniform by default. */
  initialDistribution?: number[];
  /** Minimum visits per state-action pair before convergence can be claimed. */
  minVisitsPerPair?: number;
  /** Largest tolerated mean temporal-difference error in the run's tail. */
  residualTolerance?: number;
  /** Compare against the exactly computed optimum (needs the model). */
  compareWithOptimum?: boolean;
}

export interface RLDiagnostics {
  /** Visits to each (state, action) pair. */
  visits: number[][];
  leastVisitedPair: { state: number; action: number; visits: number };
  /** Largest |ΔQ| over the final tenth of the run. */
  recentMaxChange: number;
  /**
   * The largest MEAN temporal-difference error per state-action pair over the
   * final tenth of the run, estimated from the observed transitions alone.
   *
   * This is the diagnostic that matters: a tiny step size makes the updates
   * small whether or not the estimates are right, so stability of the iterates
   * is not evidence of convergence. A systematically non-zero mean TD error
   * means Q is NOT at the fixed point, however still it looks.
   */
  tailMeanBellmanResidual: number;
  /** Every pair visited at least minVisitsPerPair times. */
  visitationAdequate: boolean;
  /** Both the visitation and the stability criteria are met. */
  converged: boolean;
  /** Reason the run is not considered converged, when it is not. */
  notConvergedReason?: string;
  /** Present only when compareWithOptimum was requested. */
  comparison?: {
    maxAbsQError: number;
    maxAbsValueError: number;
    policyMatchesOptimum: boolean;
    optimalValues: number[];
    optimalPolicy: Policy;
  };
}

export interface RLResult {
  qValues: number[][];
  values: number[];
  policy: Policy;
  policyLabels: string[];
  episodes: number;
  steps: number;
  diagnostics: RLDiagnostics;
  provenance: Provenance;
}

function validateRLRequest(req: RLRequest): Issue[] {
  const issues = validateMDP(req.mdp, req.discount);
  if (!Number.isInteger(req.episodes) || req.episodes < 1) {
    issues.push({ code: 'range', field: 'episodes', message: `The number of episodes must be a whole number of at least 1; ${req.episodes} was supplied.` });
  }
  if (!Number.isInteger(req.stepsPerEpisode) || req.stepsPerEpisode < 1) {
    issues.push({ code: 'range', field: 'stepsPerEpisode', message: `The steps per episode must be a whole number of at least 1; ${req.stepsPerEpisode} was supplied.` });
  }
  if (typeof req.seed !== 'string' || !req.seed.length) {
    issues.push({ code: 'required', field: 'seed', message: 'A seed is required so the run can be reproduced.' });
  }
  const ss = req.stepSize ?? { kind: 'inverse-count' as const, initial: 1 };
  if (ss.kind === 'constant') {
    if (!Number.isFinite(ss.value) || ss.value <= 0 || ss.value > 1) issues.push({ code: 'range', field: 'stepSize', message: 'A constant step size must lie in (0, 1].' });
  } else if (ss.kind === 'polynomial') {
    if (!Number.isFinite(ss.exponent) || ss.exponent <= 0.5 || ss.exponent > 1) {
      issues.push({ code: 'range', field: 'stepSize.exponent', message: `A polynomial step-size exponent must lie in (0.5, 1] for Σα = ∞ and Σα² < ∞; ${ss.exponent} was supplied.` });
    }
    if (!Number.isFinite(ss.initial) || ss.initial <= 0 || ss.initial > 1) issues.push({ code: 'range', field: 'stepSize.initial', message: 'The initial step size must lie in (0, 1].' });
  } else if (!Number.isFinite(ss.initial) || ss.initial <= 0 || ss.initial > 1) {
    issues.push({ code: 'range', field: 'stepSize.initial', message: 'The initial step size must lie in (0, 1].' });
  }
  const ex = req.exploration ?? { kind: 'epsilon-greedy' as const, epsilon: 0.2 };
  if (ex.kind !== 'epsilon-greedy') {
    issues.push({ code: 'unknown', field: 'exploration.kind', message: `Unknown exploration policy "${String(ex.kind)}".` });
  } else if (!Number.isFinite(ex.epsilon) || ex.epsilon < 0 || ex.epsilon > 1) {
    issues.push({ code: 'range', field: 'exploration.epsilon', message: 'The exploration ε must lie in [0, 1].' });
  } else if (ex.epsilon === 0) {
    issues.push({
      code: 'range',
      field: 'exploration.epsilon',
      message: 'With ε = 0 the behaviour policy is purely greedy, so most state-action pairs are never tried and the learned values for them are whatever they were initialised to. Use a positive ε.',
    });
  }
  if (req.terminalStates) {
    for (const s of req.terminalStates) {
      if (!Number.isInteger(s) || s < 0 || s >= req.mdp.nStates) {
        issues.push({ code: 'range', field: 'terminalStates', message: `Terminal state ${s} is not a state index in 0..${req.mdp.nStates - 1}.` });
      }
    }
  }
  return issues;
}

interface Runtime {
  rng: Random;
  n: number;
  r: number[][];
  terminal: boolean[];
  start: number[];
  epsilonAt: (t: number) => number;
  alpha: (count: number) => number;
  sampleNext: (s: number, a: number) => number;
  drawStart: () => number;
}

function prepare(req: RLRequest): Runtime {
  const n = req.mdp.nStates;
  const rng = new Random(new Xoshiro128(req.seed));
  const r = rewardTable(req.mdp);
  const terminal = new Array<boolean>(n).fill(false);
  for (const s of req.terminalStates ?? []) terminal[s] = true;
  let start = req.initialDistribution;
  if (start) {
    if (start.length !== n) throw new EngineError(`The initial distribution must have one entry per state (${n}).`, 'shape');
    let sum = 0;
    for (const p of start) {
      if (!Number.isFinite(p) || p < 0) throw new EngineError('The initial distribution must contain non-negative finite probabilities.', 'range');
      sum += p;
    }
    if (Math.abs(sum - 1) > 1e-9) throw new EngineError(`The initial distribution sums to ${sum.toPrecision(12)}, not 1.`, 'sum');
  } else {
    start = new Array<number>(n).fill(1 / n);
  }
  const ss = req.stepSize ?? { kind: 'inverse-count' as const, initial: 1 };
  const alpha = (count: number): number => {
    if (ss.kind === 'constant') return ss.value;
    if (ss.kind === 'polynomial') return ss.initial / Math.pow(Math.max(count, 1), ss.exponent);
    return ss.initial / Math.max(count, 1);
  };
  const ex = req.exploration ?? { kind: 'epsilon-greedy' as const, epsilon: 0.2 };
  const epsilonAt = (t: number): number => (ex.decay ? ex.epsilon / (1 + ex.decay * t) : ex.epsilon);
  const startDist = start;
  return {
    rng,
    n,
    r,
    terminal,
    start: startDist,
    epsilonAt,
    alpha,
    sampleNext: (s, a) => {
      const row = req.mdp.transitions[s][a];
      let u = rng.uniform();
      for (let j = 0; j < row.length; j++) {
        u -= row[j];
        if (u < 0) return j;
      }
      // Floating-point shortfall: return the last state with positive mass.
      for (let j = row.length - 1; j >= 0; j--) if (row[j] > 0) return j;
      throw new EngineError(`Transition row for state ${s}, action ${a} has no positive probability.`, 'internal');
    },
    drawStart: () => {
      let u = rng.uniform();
      for (let j = 0; j < startDist.length; j++) {
        u -= startDist[j];
        if (u < 0) return j;
      }
      return startDist.length - 1;
    },
  };
}

function greedyFromQ(q: number[][]): Policy {
  return q.map((row) => {
    let best = 0;
    for (let a = 1; a < row.length; a++) if (row[a] > row[best]) best = a;
    return best;
  });
}

function finish(
  req: RLRequest,
  q: number[][],
  visits: number[][],
  recentMaxChange: number,
  tailErrorSum: number[][],
  tailErrorCount: number[][],
  steps: number,
  method: string,
  extraLimitations: string[],
): RLResult {
  const minVisits = req.minVisitsPerPair ?? 100;
  let least = { state: 0, action: 0, visits: Infinity };
  for (let s = 0; s < visits.length; s++) {
    for (let a = 0; a < visits[s].length; a++) {
      if (visits[s][a] < least.visits) least = { state: s, action: a, visits: visits[s][a] };
    }
  }
  const visitationAdequate = least.visits >= minVisits;
  let tailMeanBellmanResidual = 0;
  let worstPair = { state: 0, action: 0 };
  for (let s = 0; s < q.length; s++) {
    for (let a = 0; a < q[s].length; a++) {
      if (tailErrorCount[s][a] < 10) continue;
      const m = Math.abs(tailErrorSum[s][a] / tailErrorCount[s][a]);
      if (m > tailMeanBellmanResidual) {
        tailMeanBellmanResidual = m;
        worstPair = { state: s, action: a };
      }
    }
  }
  const residualTolerance = req.residualTolerance ?? 0.1;
  const stable = tailMeanBellmanResidual <= residualTolerance;
  let notConvergedReason: string | undefined;
  if (!visitationAdequate) {
    notConvergedReason = `NOT CONVERGED: state-action pair (state ${least.state}, action "${req.mdp.actions[least.state][least.action]}") was visited only ${least.visits} time(s), below the ${minVisits} required before its value means anything. Convergence of ${method} requires every pair to be visited infinitely often; this run does not come close for that pair.`;
  } else if (!stable) {
    notConvergedReason = `NOT CONVERGED: over the final tenth of the run the mean temporal-difference error at (state ${worstPair.state}, action "${req.mdp.actions[worstPair.state][worstPair.action]}") was ${tailMeanBellmanResidual.toExponential(3)}, above the tolerance of ${residualTolerance}. A systematically non-zero mean TD error means the estimates are not at the fixed point; the largest single update was only ${recentMaxChange.toExponential(3)}, which shows how misleading small updates are as evidence of convergence (a step size that has decayed too fast makes every update small while the estimates stay wrong).`;
  }
  const converged = visitationAdequate && stable;
  const policy = greedyFromQ(q);
  const values = q.map((row) => Math.max(...row));
  const diagnostics: RLDiagnostics = {
    visits,
    leastVisitedPair: least,
    recentMaxChange,
    tailMeanBellmanResidual,
    visitationAdequate,
    converged,
    notConvergedReason,
  };
  if (req.compareWithOptimum) {
    const exact = policyIteration(req.mdp, req.discount);
    let maxQ = 0;
    for (let s = 0; s < q.length; s++) {
      for (let a = 0; a < q[s].length; a++) maxQ = Math.max(maxQ, Math.abs(q[s][a] - exact.qValues[s][a]));
    }
    let maxV = 0;
    for (let s = 0; s < q.length; s++) maxV = Math.max(maxV, Math.abs(values[s] - exact.values[s]));
    diagnostics.comparison = {
      maxAbsQError: maxQ,
      maxAbsValueError: maxV,
      policyMatchesOptimum: policy.every((a, s) => a === exact.policy[s]),
      optimalValues: exact.values,
      optimalPolicy: exact.policy,
    };
  }
  const limitations = [
    `CONVERGENCE CONDITIONS ARE NOT MET BY ANY FINITE RUN. ${method} converges to the optimum only with step sizes satisfying Σα = ∞ and Σα² < ∞ and with every state-action pair visited infinitely often. This run made ${steps} steps; the least-visited pair was tried ${least.visits} time(s), and the largest mean temporal-difference error in the final tenth of the run was ${tailMeanBellmanResidual.toExponential(3)}.`,
    'The values reported are estimates from samples, so they carry sampling error that is not quantified by a standard error here: the updates are serially dependent, which makes a naive standard error wrong.',
    ...extraLimitations,
  ];
  if (notConvergedReason) limitations.unshift(notConvergedReason);
  return {
    qValues: q,
    values,
    policy,
    policyLabels: policy.map((a, s) => req.mdp.actions[s][a]),
    episodes: req.episodes,
    steps,
    diagnostics,
    provenance: {
      exactness: 'empirical',
      method,
      assumedInputs: ['The learner sees only sampled transitions and rewards; the transition probabilities are used solely to generate the samples (and, if requested, to produce the diagnostic comparison with the exact optimum).'],
      limitations,
    },
  };
}

/**
 * Tabular Q-learning: an OFF-POLICY method. The behaviour policy is
 * ε-greedy — which is stated, because "Q-learning" without the exploration
 * policy is an incomplete description — while the target is the greedy maximum,
 * so the learned Q approximates the OPTIMAL Q regardless of how exploratory the
 * behaviour was, provided every pair keeps being visited.
 */
export function qLearning(req: RLRequest): RLResult {
  const issues = validateRLRequest(req);
  if (issues.length) throw new EngineError(issues);
  const rt = prepare(req);
  const q: number[][] = req.mdp.actions.map((acts) => new Array<number>(acts.length).fill(0));
  const visits: number[][] = req.mdp.actions.map((acts) => new Array<number>(acts.length).fill(0));
  const tailErrorSum: number[][] = req.mdp.actions.map((acts) => new Array<number>(acts.length).fill(0));
  const tailErrorCount: number[][] = req.mdp.actions.map((acts) => new Array<number>(acts.length).fill(0));
  const totalSteps = req.episodes * req.stepsPerEpisode;
  const tailStart = Math.floor(totalSteps * 0.9);
  let recentMaxChange = 0;
  let step = 0;
  for (let ep = 0; ep < req.episodes; ep++) {
    let s = rt.drawStart();
    for (let k = 0; k < req.stepsPerEpisode; k++) {
      const eps = rt.epsilonAt(step);
      let a: number;
      if (rt.rng.uniform() < eps) a = rt.rng.int(0, req.mdp.actions[s].length - 1);
      else {
        a = 0;
        for (let i = 1; i < q[s].length; i++) if (q[s][i] > q[s][a]) a = i;
      }
      const sp = rt.sampleNext(s, a);
      const reward = sampleReward(req.mdp, s, a, sp);
      visits[s][a]++;
      const bootstrap = rt.terminal[sp] ? 0 : Math.max(...q[sp]);
      const target = reward + req.discount * bootstrap;
      const alpha = rt.alpha(visits[s][a]);
      const delta = alpha * (target - q[s][a]);
      if (step >= tailStart) {
        tailErrorSum[s][a] += target - q[s][a];
        tailErrorCount[s][a]++;
        recentMaxChange = Math.max(recentMaxChange, Math.abs(delta));
      }
      q[s][a] += delta;
      step++;
      if (rt.terminal[sp]) break;
      s = sp;
    }
  }
  return finish(req, q, visits, recentMaxChange, tailErrorSum, tailErrorCount, step, 'Tabular Q-learning (off-policy) with an ε-greedy behaviour policy', [
    'Q-learning is off-policy: the learned Q targets the optimal policy, not the ε-greedy policy actually followed. The value of what the agent DID is lower, and is what SARSA estimates instead.',
  ]);
}

/**
 * SARSA: an ON-POLICY method. The target uses the action actually taken next by
 * the same ε-greedy policy, so SARSA converges to the value of THAT policy, not
 * to the optimum. On a problem where exploration is dangerous the two differ
 * substantially, and SARSA's answer is the one that reflects what the agent
 * will actually experience.
 */
export function sarsa(req: RLRequest): RLResult {
  const issues = validateRLRequest(req);
  if (issues.length) throw new EngineError(issues);
  const rt = prepare(req);
  const q: number[][] = req.mdp.actions.map((acts) => new Array<number>(acts.length).fill(0));
  const visits: number[][] = req.mdp.actions.map((acts) => new Array<number>(acts.length).fill(0));
  const tailErrorSum: number[][] = req.mdp.actions.map((acts) => new Array<number>(acts.length).fill(0));
  const tailErrorCount: number[][] = req.mdp.actions.map((acts) => new Array<number>(acts.length).fill(0));
  const totalSteps = req.episodes * req.stepsPerEpisode;
  const tailStart = Math.floor(totalSteps * 0.9);
  let recentMaxChange = 0;
  let step = 0;
  const chooseAction = (s: number, t: number): number => {
    if (rt.rng.uniform() < rt.epsilonAt(t)) return rt.rng.int(0, req.mdp.actions[s].length - 1);
    let a = 0;
    for (let i = 1; i < q[s].length; i++) if (q[s][i] > q[s][a]) a = i;
    return a;
  };
  for (let ep = 0; ep < req.episodes; ep++) {
    let s = rt.drawStart();
    let a = chooseAction(s, step);
    for (let k = 0; k < req.stepsPerEpisode; k++) {
      const sp = rt.sampleNext(s, a);
      const reward = sampleReward(req.mdp, s, a, sp);
      const ap = chooseAction(sp, step + 1);
      visits[s][a]++;
      const bootstrap = rt.terminal[sp] ? 0 : q[sp][ap];
      const alpha = rt.alpha(visits[s][a]);
      const delta = alpha * (reward + req.discount * bootstrap - q[s][a]);
      if (step >= tailStart) {
        tailErrorSum[s][a] += reward + req.discount * bootstrap - q[s][a];
        tailErrorCount[s][a]++;
        recentMaxChange = Math.max(recentMaxChange, Math.abs(delta));
      }
      q[s][a] += delta;
      step++;
      if (rt.terminal[sp]) break;
      s = sp;
      a = ap;
    }
  }
  return finish(req, q, visits, recentMaxChange, tailErrorSum, tailErrorCount, step, 'Tabular SARSA (on-policy) with an ε-greedy behaviour policy', [
    'SARSA is on-policy: it converges to the value of the ε-greedy policy it follows, NOT to the optimal value. Comparing its Q-values with the optimal Q-values is comparing two different quantities, and the gap grows with ε.',
  ]);
}

/** Draw the immediate reward for a realised transition. */
function sampleReward(mdp: MDP, s: number, a: number, sp: number): number {
  const r = mdp.rewards[s][a];
  return Array.isArray(r) ? r[sp] : r;
}

/* ----------------------------------------------- TD policy evaluation */

export interface TDRequest {
  mdp: MDP;
  policy: Policy;
  discount: number;
  episodes: number;
  stepsPerEpisode: number;
  seed: string;
  stepSize?: StepSizeSchedule;
  /** TD(λ) trace decay; 0 gives TD(0), 1 gives every-visit Monte Carlo. */
  lambda?: number;
  terminalStates?: number[];
  initialDistribution?: number[];
  compareWithExact?: boolean;
}

export interface TDResult {
  values: number[];
  visits: number[];
  lambda: number;
  /** Max |v̂ − v_π| against the exact linear solve, when requested. */
  maxAbsError?: number;
  exactValues?: number[];
  provenance: Provenance;
}

/**
 * TD(λ) policy evaluation with accumulating eligibility traces. λ = 0 is TD(0)
 * (one-step bootstrapping, low variance and biased by the current estimate);
 * λ = 1 is every-visit Monte Carlo (unbiased, high variance). Nothing about the
 * intermediate λ is optimal in general — it trades those two properties, and
 * the trade depends on the problem.
 */
export function temporalDifference(req: TDRequest): TDResult {
  const issues = validateMDP(req.mdp, req.discount);
  if (!Number.isInteger(req.episodes) || req.episodes < 1) issues.push({ code: 'range', field: 'episodes', message: 'The number of episodes must be a whole number of at least 1.' });
  if (!Number.isInteger(req.stepsPerEpisode) || req.stepsPerEpisode < 1) issues.push({ code: 'range', field: 'stepsPerEpisode', message: 'The steps per episode must be a whole number of at least 1.' });
  if (typeof req.seed !== 'string' || !req.seed.length) issues.push({ code: 'required', field: 'seed', message: 'A seed is required so the run can be reproduced.' });
  const lambda = req.lambda ?? 0;
  if (!Number.isFinite(lambda) || lambda < 0 || lambda > 1) issues.push({ code: 'range', field: 'lambda', message: `The trace decay λ must lie in [0, 1]; ${lambda} was supplied.` });
  if (issues.length) throw new EngineError(issues);
  const n = req.mdp.nStates;
  if (req.policy.length !== n) throw new EngineError(`The policy must name an action for each of the ${n} states.`, 'shape');
  for (let s = 0; s < n; s++) {
    const a = req.policy[s];
    if (!Number.isInteger(a) || a < 0 || a >= req.mdp.actions[s].length) {
      throw new EngineError(`The policy names action index ${a} in state ${s}, which has ${req.mdp.actions[s].length} action(s).`, 'range');
    }
  }
  const rt = prepare({ ...req, exploration: { kind: 'epsilon-greedy', epsilon: 1 } } as RLRequest);
  const v = new Array<number>(n).fill(0);
  const visits = new Array<number>(n).fill(0);
  const trace = new Array<number>(n).fill(0);
  for (let ep = 0; ep < req.episodes; ep++) {
    let s = rt.drawStart();
    for (let i = 0; i < n; i++) trace[i] = 0;
    for (let k = 0; k < req.stepsPerEpisode; k++) {
      const a = req.policy[s];
      const sp = rt.sampleNext(s, a);
      const reward = sampleReward(req.mdp, s, a, sp);
      visits[s]++;
      const bootstrap = rt.terminal[sp] ? 0 : v[sp];
      const tdError = reward + req.discount * bootstrap - v[s];
      trace[s] += 1;
      const alpha = rt.alpha(visits[s]);
      for (let i = 0; i < n; i++) {
        if (trace[i] === 0) continue;
        v[i] += alpha * tdError * trace[i];
        trace[i] *= req.discount * lambda;
      }
      if (rt.terminal[sp]) break;
      s = sp;
    }
  }
  const out: TDResult = {
    values: v,
    visits,
    lambda,
    provenance: {
      exactness: 'empirical',
      method: `TD(${lambda}) policy evaluation with accumulating traces over ${req.episodes} episode(s)`,
      assumedInputs: ['Only sampled transitions and rewards are used; the policy being evaluated is supplied by the user.'],
      limitations: [
        'This estimates the value of the SUPPLIED policy, not the optimal value.',
        'The step size is shared by every state in a trace update, so states updated through a long trace receive a step size calibrated to the state that generated the error. That is the standard accumulating-trace formulation and it is a known source of instability at large λ and large α.',
        'Convergence requires decaying step sizes and every state being visited infinitely often under the policy. States the policy never reaches keep their initial value of 0, which is NOT an estimate of anything.',
      ],
    },
  };
  if (req.compareWithExact) {
    const exact = evaluatePolicyExact(req.mdp, req.policy, req.discount);
    out.exactValues = exact;
    let m = 0;
    for (let s = 0; s < n; s++) m = Math.max(m, Math.abs(v[s] - exact[s]));
    out.maxAbsError = m;
  }
  return out;
}
