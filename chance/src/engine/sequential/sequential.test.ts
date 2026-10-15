/**
 * Tests for the sequential-decision module.
 *
 * Reference values are independent of the implementation under test: hand
 * algebra in comments, closed forms computed afresh in the test, mutual
 * agreement between three algorithms that share no code, published Gittins
 * indices, and Monte Carlo simulations whose tolerances are justified from the
 * binomial standard error at the point of assertion.
 */
import { describe, expect, it } from 'vitest';
import { Random, Xoshiro128 } from '../random/rng';
import { identity, matMul, matVec } from '../stats/linalg';
import { lpSolveMDP, simplexMaximize } from './lp';
import {
  averageRewardMDP,
  evaluatePolicy,
  evaluatePolicyExact,
  finiteHorizonMDP,
  policyIteration,
  stateVisitation,
  validateMDP,
  valueIteration,
} from './mdp';
import { discountSensitivity, rewardSensitivity } from './sensitivity';
import {
  alphaVectorValue,
  beliefUpdate,
  exactPOMDPValueIteration,
  fastInformedBound,
  qmdpBound,
  valueOfInformation,
  type POMDP,
} from './pomdp';
import {
  alphaSpendingBoundaries,
  bayesianSequential,
  finiteHorizonSearch,
  jobSearch,
  latticeSequentialOC,
  markovStopping,
  multipleChoiceSecretary,
  oddsAlgorithm,
  rankBasedStopping,
  secretaryProblem,
  sprt,
} from './stopping';
import {
  bestArmIdentification,
  gittinsIndex,
  gittinsIndexTable,
  klBernoulli,
  laiRobbinsBound,
  linUCB,
  runBanditExperiment,
  banditSteps,
  type BanditSpec,
} from './bandits';
import { qLearning, sarsa, temporalDifference } from './rl';
import type { MDP } from './types';

/* ------------------------------------------------------------- fixtures */

/** A random MDP with a fixed seed, for the three-routes cross-check. */
function randomMDP(rng: Random, nStates: number, nActions: number): MDP {
  const actions: string[][] = [];
  const transitions: number[][][] = [];
  const rewards: number[][] = [];
  for (let s = 0; s < nStates; s++) {
    actions.push(Array.from({ length: nActions }, (_, a) => `a${a}`));
    const rows: number[][] = [];
    const rew: number[] = [];
    for (let a = 0; a < nActions; a++) {
      const raw = Array.from({ length: nStates }, () => rng.uniform() + 0.05);
      const total = raw.reduce((p, q) => p + q, 0);
      rows.push(raw.map((x) => x / total));
      rew.push(rng.uniformRange(-2, 4));
    }
    transitions.push(rows);
    rewards.push(rew);
  }
  return { nStates, actions, transitions, rewards };
}

/**
 * Hand-solved MDP. States {0, 1}, γ = 1/2.
 *   state 0: "stay"  r = 1, P = (1, 0)
 *            "move"  r = 0, P = (0, 1)
 *   state 1: "idle"  r = 3, P = (0, 1)
 *
 * State 1 is absorbing with a constant reward: v(1) = 3 + v(1)/2, so v(1) = 6.
 * In state 0 the two actions give
 *   Q(0, stay) = 1 + v(0)/2      Q(0, move) = 0 + 6/2 = 3.
 * Suppose "stay" were optimal: v(0) = 1 + v(0)/2 ⇒ v(0) = 2, but then
 * Q(0, move) = 3 > 2, a contradiction. So "move" is optimal and v(0) = 3,
 * which satisfies the Bellman equation: max(1 + 3/2, 3) = max(2.5, 3) = 3.
 * Exact answer: v = (3, 6), policy = (move, idle).
 */
const HAND_MDP: MDP = {
  nStates: 2,
  stateLabels: ['start', 'sink'],
  actions: [['stay', 'move'], ['idle']],
  transitions: [[[1, 0], [0, 1]], [[0, 1]]],
  rewards: [[1, 0], [3]],
};

/**
 * Second hand-solved MDP, this one requiring a genuine 2×2 solve. γ = 9/10,
 * one action per state:
 *   state 0: r = 0, P = (1/2, 1/2)      state 1: r = 1, P = (0, 1)
 * v(1) = 1 + 0.9·v(1) ⇒ v(1) = 10.
 * v(0) = 0 + 0.9·(v(0)/2 + 10/2) = 0.45·v(0) + 4.5 ⇒ v(0) = 4.5/0.55 = 90/11.
 */
const HAND_MDP_2: MDP = {
  nStates: 2,
  actions: [['drift'], ['collect']],
  transitions: [[[0.5, 0.5]], [[0, 1]]],
  rewards: [[0], [1]],
};

/**
 * Discounting versus throughput. From "start" you can sprint (reward 10 now,
 * then a low-yield loop) or build (nothing now, then a high-yield loop). Both
 * loops leak back to "start" with probability 0.01, which keeps the chain
 * communicating so the average-reward gain is well defined.
 *
 * Sprinting wins at moderate γ and loses on long-run reward per step, so the
 * discounted-optimal and average-reward-optimal policies DIFFER.
 */
const SPRINT_MDP: MDP = {
  nStates: 3,
  stateLabels: ['start', 'low-loop', 'high-loop'],
  actions: [['sprint', 'build'], ['stay'], ['stay']],
  transitions: [
    [
      [0, 1, 0],
      [0, 0, 1],
    ],
    [[0.01, 0.99, 0]],
    [[0.01, 0, 0.99]],
  ],
  rewards: [[10, 0], [1], [2]],
};

/** The tiger problem: the state is hidden and listening costs money. */
const TIGER: POMDP = {
  nStates: 2,
  nObservations: 2,
  actions: ['listen', 'open-left', 'open-right'],
  stateLabels: ['tiger-left', 'tiger-right'],
  observationLabels: ['hear-left', 'hear-right'],
  transitions: [
    [[1, 0], [0, 1]],
    [[0.5, 0.5], [0.5, 0.5]],
    [[0.5, 0.5], [0.5, 0.5]],
  ],
  observations: [
    [[0.85, 0.15], [0.15, 0.85]],
    [[0.5, 0.5], [0.5, 0.5]],
    [[0.5, 0.5], [0.5, 0.5]],
  ],
  rewards: [[-1, -1], [-100, 10], [10, -100]],
};

/* ------------------------------------------- the three-routes cross-check */

describe('MDP: three independent routes must agree', () => {
  it('value iteration, policy iteration and the LP give the same optimum on random MDPs', () => {
    const rng = new Random(new Xoshiro128('three-routes-seed'));
    for (let trial = 0; trial < 14; trial++) {
      const n = 2 + (trial % 5);
      const mdp = randomMDP(rng, n, 2 + (trial % 3));
      const gamma = 0.5 + 0.09 * (trial % 5);
      const vi = valueIteration(mdp, gamma, { tolerance: 1e-14, maxIterations: 200000 });
      const pi = policyIteration(mdp, gamma);
      const lp = lpSolveMDP(mdp, gamma);
      expect(vi.converged).toBe(true);
      for (let s = 0; s < n; s++) {
        expect(Math.abs(vi.values[s] - pi.values[s])).toBeLessThan(1e-9);
        expect(Math.abs(lp.values[s] - pi.values[s])).toBeLessThan(1e-9);
      }
      expect(vi.policy).toEqual(pi.policy);
      expect(lp.policy).toEqual(pi.policy);
      // Modified policy iteration must land on the same optimum too.
      const mpi = policyIteration(mdp, gamma, { evaluationSweeps: 20 });
      expect(mpi.policy).toEqual(pi.policy);
      for (let s = 0; s < n; s++) expect(Math.abs(mpi.values[s] - pi.values[s])).toBeLessThan(1e-9);
    }
  });

  it('the three routes agree on the hand-built MDPs', () => {
    for (const [mdp, gamma] of [
      [HAND_MDP, 0.5],
      [HAND_MDP_2, 0.9],
      [SPRINT_MDP, 0.8],
    ] as const) {
      const vi = valueIteration(mdp, gamma, { tolerance: 1e-14, maxIterations: 200000 });
      const pi = policyIteration(mdp, gamma);
      const lp = lpSolveMDP(mdp, gamma);
      expect(vi.policy).toEqual(pi.policy);
      expect(lp.policy).toEqual(pi.policy);
      for (let s = 0; s < mdp.nStates; s++) {
        expect(Math.abs(vi.values[s] - pi.values[s])).toBeLessThan(1e-9);
        expect(Math.abs(lp.values[s] - pi.values[s])).toBeLessThan(1e-9);
      }
    }
  });

  it('the simplex solver agrees with a hand-solved linear program', () => {
    // maximise 3x + 2y s.t. x + y + s1 = 4, x + 3y + s2 = 6, x, y ≥ 0.
    // The optimum is at x = 4, y = 0 with objective 12 (the 3x coefficient
    // dominates and the first constraint binds).
    const sol = simplexMaximize(
      [
        [1, 1, 1, 0],
        [1, 3, 0, 1],
      ],
      [4, 6],
      [3, 2, 0, 0],
    );
    expect(sol.status).toBe('optimal');
    expect(sol.objective).toBeCloseTo(12, 12);
    expect(sol.x[0]).toBeCloseTo(4, 12);
    expect(sol.x[1]).toBeCloseTo(0, 12);
  });
});

/* ----------------------------------------------------- analytic checks */

describe('MDP: analytic and hand-computed values', () => {
  it('one state, one action: v = r/(1 − γ) exactly', () => {
    const mdp: MDP = { nStates: 1, actions: [['stay']], transitions: [[[1]]], rewards: [[3]] };
    for (const gamma of [0, 0.5, 0.9, 0.99]) {
      const pi = policyIteration(mdp, gamma);
      expect(pi.values[0]).toBeCloseTo(3 / (1 - gamma), 12);
      const lp = lpSolveMDP(mdp, gamma);
      expect(lp.values[0]).toBeCloseTo(3 / (1 - gamma), 12);
    }
  });

  it('the hand-solved 2-state MDP matches the algebra to 1e-12', () => {
    const pi = policyIteration(HAND_MDP, 0.5);
    expect(pi.values[0]).toBeCloseTo(3, 12);
    expect(pi.values[1]).toBeCloseTo(6, 12);
    expect(pi.policyLabels).toEqual(['move', 'idle']);
    const pi2 = policyIteration(HAND_MDP_2, 0.9);
    expect(pi2.values[0]).toBeCloseTo(90 / 11, 12);
    expect(pi2.values[1]).toBeCloseTo(10, 12);
  });

  it('value iteration respects its own error bound, judged against a far longer run', () => {
    const rng = new Random(new Xoshiro128('bound-seed'));
    for (let trial = 0; trial < 6; trial++) {
      const mdp = randomMDP(rng, 4, 3);
      const gamma = 0.9;
      // Ground truth from the exact route, which shares no code with value iteration.
      const truth = policyIteration(mdp, gamma).values;
      const loose = valueIteration(mdp, gamma, { tolerance: 1e-3, maxIterations: 200000 });
      expect(loose.converged).toBe(true);
      let worst = 0;
      for (let s = 0; s < mdp.nStates; s++) worst = Math.max(worst, Math.abs(loose.values[s] - truth[s]));
      // The contraction bound must hold, with a little slack for round-off.
      expect(worst).toBeLessThanOrEqual(loose.errorBound + 1e-12);
      // And it must be a real bound, not a vacuous one.
      expect(loose.errorBound).toBeLessThan(1);
      // The Bellman residual of the returned values is within the reported error.
      for (let s = 0; s < mdp.nStates; s++) {
        const best = Math.max(...loose.qValues[s]);
        expect(Math.abs(best - loose.values[s])).toBeLessThanOrEqual(loose.bellmanError + 1e-12);
      }
    }
  });

  it('policy evaluation matches an independent Neumann-series solve to 1e-10', () => {
    const rng = new Random(new Xoshiro128('evaluate-seed'));
    for (let trial = 0; trial < 5; trial++) {
      const mdp = randomMDP(rng, 4, 2);
      const gamma = 0.6;
      const policy = [0, 1, 0, 1];
      const got = evaluatePolicyExact(mdp, policy, gamma);
      // v_π = Σ_k γ^k P_π^k r_π, summed directly in the test. With γ = 0.6 and
      // 200 terms the truncation error is 0.6^200 ≈ 1e-44: far below 1e-10.
      const P = policy.map((a, s) => mdp.transitions[s][a]);
      const r = policy.map((a, s) => mdp.rewards[s][a] as number);
      let power = identity(mdp.nStates);
      const series = new Array<number>(mdp.nStates).fill(0);
      for (let k = 0; k < 200; k++) {
        const term = matVec(power, r);
        for (let s = 0; s < mdp.nStates; s++) series[s] += Math.pow(gamma, k) * term[s];
        power = matMul(power, P);
      }
      for (let s = 0; s < mdp.nStates; s++) expect(Math.abs(got[s] - series[s])).toBeLessThan(1e-10);
    }
  });

  it('a user-supplied policy is evaluated and its improvements named', () => {
    // Deliberately take the wrong action in the hand-solved MDP.
    const got = evaluatePolicy(HAND_MDP, [0, 0], 0.5);
    expect(got.values[0]).toBeCloseTo(2, 12); // v = 1 + v/2 ⇒ 2
    expect(got.values[1]).toBeCloseTo(6, 12);
    expect(got.improvements).toHaveLength(1);
    expect(got.improvements[0]).toMatchObject({ state: 0, from: 'stay', to: 'move' });
    expect(got.improvements[0].gain).toBeCloseTo(1, 12); // Q(0,move) − Q(0,stay) = 3 − 2
    expect(got.provenance.exactness).toBe('exact');
  });

  it('γ → 0 makes the optimal policy exactly the one-step-greedy policy', () => {
    const rng = new Random(new Xoshiro128('myopic-seed'));
    for (let trial = 0; trial < 6; trial++) {
      const mdp = randomMDP(rng, 4, 3);
      const greedy = mdp.rewards.map((row) => {
        let best = 0;
        for (let a = 1; a < row.length; a++) if ((row[a] as number) > (row[best] as number)) best = a;
        return best;
      });
      expect(policyIteration(mdp, 0).policy).toEqual(greedy);
      expect(valueIteration(mdp, 0, { tolerance: 1e-14 }).policy).toEqual(greedy);
      // At γ = 0 the value is exactly the immediate reward of the greedy action.
      const pi = policyIteration(mdp, 0);
      for (let s = 0; s < mdp.nStates; s++) expect(pi.values[s]).toBeCloseTo(mdp.rewards[s][greedy[s]] as number, 12);
    }
  });

  it('the discounted and average-reward optima genuinely differ, and γ → 1⁻ bridges them', () => {
    const moderate = policyIteration(SPRINT_MDP, 0.8);
    const avg = averageRewardMDP(SPRINT_MDP, { tolerance: 1e-11 });
    expect(avg.converged).toBe(true);
    // At moderate γ the discounted optimum sprints; on reward per step it builds.
    expect(moderate.policyLabels[0]).toBe('sprint');
    expect(avg.policyLabels[0]).toBe('build');
    expect(moderate.policy).not.toEqual(avg.policy);
    // As γ → 1⁻ the discounted optimum must agree with the average-reward optimum.
    expect(policyIteration(SPRINT_MDP, 0.9999).policy).toEqual(avg.policy);
    // The gain of "build": one step in "start" earning 0, then a mean of 100
    // steps in the high loop earning 2 each: 200/101 per step.
    expect(avg.gain).toBeCloseTo(200 / 101, 8);
    expect(avg.provenance.exactness).toBe('numerical');
  });

  it('the finite-horizon optimal policy is time-dependent and surfaced as such', () => {
    const fh = finiteHorizonMDP(SPRINT_MDP, 4, 1);
    expect(fh.provenance.exactness).toBe('exact');
    // With one stage left, sprinting for 10 beats building for 0.
    expect(fh.policyLabels[3][0]).toBe('sprint');
    // Hand check with γ = 1, horizon 4, terminal value 0. At stage 3 there is
    // one decision left and the successor's value is 0, so the value is just
    // the immediate reward: v(low) = 1, v(high) = 2,
    // v(start) = max(10, 0) = 10.
    expect(fh.values[3][0]).toBeCloseTo(10, 12);
    expect(fh.values[3][1]).toBeCloseTo(1, 12);
    expect(fh.values[3][2]).toBeCloseTo(2, 12);
    // A long enough horizon makes building better at the first stage while
    // sprinting is still right at the last: the optimal policy is genuinely
    // TIME-DEPENDENT, and no stationary policy reproduces it.
    const long = finiteHorizonMDP(SPRINT_MDP, 60, 1);
    expect(long.policyLabels[0][0]).toBe('build');
    expect(long.policyLabels[59][0]).toBe('sprint');
    expect(long.policyIsTimeDependent).toBe(true);
    expect(long.provenance.limitations.join(' ')).toMatch(/depends on how many stages remain/);
    // Backward induction with γ < 1 must agree with the infinite-horizon
    // optimum for a horizon long enough that the tail is negligible.
    const inf = policyIteration(HAND_MDP, 0.5);
    const fin = finiteHorizonMDP(HAND_MDP, 80, 0.5);
    for (let s = 0; s < HAND_MDP.nStates; s++) expect(fin.values[0][s]).toBeCloseTo(inf.values[s], 10);
  });

  it('the discounted state-visitation distribution sums to 1 and matches a direct sum', () => {
    const vis = stateVisitation(HAND_MDP_2, [0, 0], 0.5, [1, 0]);
    const total = vis.distribution.reduce((p, q) => p + q, 0);
    expect(total).toBeCloseTo(1, 12);
    // Starting in state 0 which moves to {0, 1} with probability 1/2 each:
    // occupancy(0) = Σ γ^t 2^-t = 1/(1 − 0.25) = 4/3.
    expect(vis.occupancy[0]).toBeCloseTo(4 / 3, 12);
    // Total occupancy must be 1/(1 − γ) = 2.
    expect(vis.occupancy.reduce((p, q) => p + q, 0)).toBeCloseTo(2, 12);
  });
});

/* -------------------------------------------------------- sensitivity */

describe('MDP: sensitivity and switching points', () => {
  it('finds the exact discount switching point of a hand-solvable problem', () => {
    // Sprint gives 10 now then a loop worth 1 per step; build gives a loop
    // worth 2 per step. With no leakage the two values are
    //   sprint: 10 + γ/(1 − γ)      build: 2γ/(1 − γ)
    // so they cross when 10 = γ/(1 − γ), i.e. γ = 10/11.
    const clean: MDP = {
      nStates: 3,
      stateLabels: ['start', 'low', 'high'],
      actions: [['sprint', 'build'], ['stay'], ['stay']],
      transitions: [
        [
          [0, 1, 0],
          [0, 0, 1],
        ],
        [[0, 1, 0]],
        [[0, 0, 1]],
      ],
      rewards: [[10, 0], [1], [2]],
    };
    const sens = discountSensitivity(clean, 0.5, 0.99, { gridPoints: 51 });
    expect(sens.stable).toBe(false);
    expect(sens.switchPoints).toHaveLength(1);
    expect(sens.switchPoints[0].at).toBeCloseTo(10 / 11, 9);
    expect(sens.switchPoints[0].changedStates[0]).toMatchObject({ stateLabel: 'start', before: 'sprint', after: 'build' });
  });

  it('finds the break-even reward at which the recommendation flips', () => {
    // In HAND_MDP at γ = 1/2, "move" is worth 3 and "stay" is worth r/(1 − 1/2)
    // = 2r, so the two are indifferent at r = 1.5.
    const sens = rewardSensitivity(HAND_MDP, 0, 0, 0.5, 0, 4, { gridPoints: 81 });
    expect(sens.switchPoints).toHaveLength(1);
    expect(sens.switchPoints[0].at).toBeCloseTo(1.5, 9);
  });

  it('reports a stable policy when the discount makes no difference', () => {
    const sens = discountSensitivity(HAND_MDP_2, 0, 0.95, { gridPoints: 21 });
    expect(sens.stable).toBe(true);
    expect(sens.switchPoints).toHaveLength(0);
  });
});

/* ------------------------------------------------------------- POMDP */

describe('POMDP', () => {
  it('belief updates are normalised and a zero-probability observation is refused', () => {
    const up = beliefUpdate(TIGER, [0.5, 0.5], 0, 0);
    expect(up.belief.reduce((p, q) => p + q, 0)).toBeCloseTo(1, 12);
    // Listening is perfectly informative-free: P(hear-left | uniform) = 0.5 and
    // the posterior is (0.85, 0.15).
    expect(up.observationProbability).toBeCloseTo(0.5, 12);
    expect(up.belief[0]).toBeCloseTo(0.85, 12);
    // A certain belief plus a ruled-out observation is a contradiction.
    const blind: POMDP = {
      ...TIGER,
      observations: [
        [[1, 0], [1, 0]],
        [[0.5, 0.5], [0.5, 0.5]],
        [[0.5, 0.5], [0.5, 0.5]],
      ],
    };
    expect(() => beliefUpdate(blind, [0.5, 0.5], 0, 1)).toThrowError(/probability 0/);
    expect(() => beliefUpdate(TIGER, [0.5, 0.6], 0, 0)).toThrowError(/sums to/);
  });

  it('exact alpha-vector value iteration is consistent and QMDP is optimistic above it', () => {
    const horizon = 12;
    const discount = 0.75;
    const exact = exactPOMDPValueIteration(TIGER, horizon, discount);
    expect(exact.provenance.exactness).toBe('exact');
    const atUniform = alphaVectorValue(exact, [0.5, 0.5]);
    // Longer horizons can only help: the value is non-decreasing in the horizon
    // because "listen" is always available and the extra stage can be wasted.
    const shorter = alphaVectorValue(exactPOMDPValueIteration(TIGER, horizon - 2, discount), [0.5, 0.5]);
    expect(atUniform.value).toBeGreaterThan(shorter.value);
    // Truncating the horizon costs at most discount^h · Rmax/(1 − discount).
    const tail = (Math.pow(discount, horizon) * 10) / (1 - discount);
    const infiniteHorizonCeiling = atUniform.value + tail;
    const qmdp = qmdpBound(TIGER, [0.5, 0.5], discount);
    const fib = fastInformedBound(TIGER, [0.5, 0.5], discount);
    expect(qmdp.biasDirection).toBe('upper');
    // QMDP and FIB must both sit ABOVE any upper bound on the true value: they
    // are optimistic, exactly as their documentation claims.
    expect(qmdp.value).toBeGreaterThan(infiniteHorizonCeiling);
    expect(fib.value).toBeGreaterThan(infiniteHorizonCeiling);
    // FIB is the tighter of the two optimistic bounds.
    expect(fib.value).toBeLessThan(qmdp.value);
  });

  it('the value of information is non-negative and strictly positive when the state matters', () => {
    const voi = valueOfInformation(TIGER, [0.5, 0.5], 0.75, 10);
    expect(voi.pomdpValueKind).toBe('exact-finite-horizon');
    expect(voi.valueOfInformation).toBeGreaterThan(0);
    expect(voi.observableValue).toBeGreaterThan(voi.pomdpValue);
    // Information is worth something in the tiger problem because listening is
    // imperfect AND the state resets after a door is opened — so even starting
    // from certainty the POMDP agent falls behind an observer. Where the
    // observations are perfect and the initial state is known, the POMDP and
    // the fully observable MDP are the same problem and the gap must vanish.
    const perfect: POMDP = {
      nStates: 2,
      nObservations: 2,
      actions: ['a', 'b'],
      transitions: [
        [[0.8, 0.2], [0.3, 0.7]],
        [[0.5, 0.5], [0.1, 0.9]],
      ],
      observations: [
        [[1, 0], [0, 1]],
        [[1, 0], [0, 1]],
      ],
      rewards: [[1, 0], [0, 2]],
    };
    expect(valueOfInformation(perfect, [1, 0], 0.8, 8).valueOfInformation).toBeCloseTo(0, 9);
    expect(valueOfInformation(perfect, [0, 1], 0.8, 8).valueOfInformation).toBeCloseTo(0, 9);
    // With the state unknown at the outset, even perfect future observations
    // leave a positive gap, because the first action is taken in the dark.
    expect(valueOfInformation(perfect, [0.5, 0.5], 0.8, 8).valueOfInformation).toBeGreaterThan(0);
  });
});

/* --------------------------------------------------- optimal stopping */

describe('Optimal stopping: secretary problem', () => {
  it('matches the exact threshold and probability for n = 10, computed independently', () => {
    const n = 10;
    // P(skip r) = (r/n)·Σ_{i=r+1}^{n} 1/(i−1), summed here in the test.
    const exact = (r: number): number => {
      if (r === 0) return 1 / n;
      let acc = 0;
      for (let i = r + 1; i <= n; i++) acc += 1 / (i - 1);
      return (r / n) * acc;
    };
    let bestR = 0;
    for (let r = 1; r < n; r++) if (exact(r) > exact(bestR)) bestR = r;
    expect(bestR).toBe(3);
    expect(exact(3)).toBeCloseTo(0.3987, 4);
    const got = secretaryProblem(n);
    expect(got.skip).toBe(3);
    expect(got.successProbability).toBeCloseTo(exact(3), 14);
    expect(got.provenance.exactness).toBe('exact');
  });

  it('approaches 1/e as n grows', () => {
    const limit = 1 / Math.E;
    expect(secretaryProblem(100).successProbability).toBeCloseTo(limit, 2);
    expect(secretaryProblem(10000).successProbability).toBeCloseTo(limit, 4);
    // And the threshold approaches n/e.
    expect(secretaryProblem(10000).skip / 10000).toBeCloseTo(limit, 3);
    // Monotone improvement is NOT claimed; the finite-n value sits above 1/e.
    expect(secretaryProblem(10000).successProbability).toBeGreaterThan(limit);
  });

  it("Bruss's odds algorithm reproduces the secretary answer", () => {
    // In the secretary problem trial i is a record with probability 1/i, and
    // the last record is the best candidate. Trial 1 is a certain record, which
    // the backward odds sum never reaches for n ≥ 3.
    for (const n of [5, 10, 50, 500]) {
      const odds = oddsAlgorithm(Array.from({ length: n }, (_, i) => 1 / (i + 1)));
      const sec = secretaryProblem(n);
      expect(odds.startIndex).toBe(sec.skip);
      expect(odds.winProbability).toBeCloseTo(sec.successProbability, 12);
    }
  });

  it('the exact rank dynamic programme reproduces the closed form and extends it', () => {
    expect(rankBasedStopping(10).successProbability).toBeCloseTo(secretaryProblem(10).successProbability, 12);
    expect(rankBasedStopping(20).successProbability).toBeCloseTo(secretaryProblem(20).successProbability, 12);
    // A more forgiving objective can only help: landing in the top 3 of 10 is
    // achievable about 79% of the time against 39.9% for the single best.
    expect(rankBasedStopping(10, { topK: 3 }).successProbability).toBeGreaterThan(rankBasedStopping(10).successProbability);
    expect(rankBasedStopping(10, { topK: 10 }).successProbability).toBeCloseTo(1, 10);
  });

  it('the second-choice variant reproduces the classical answer and its published limit', () => {
    // With one choice the independent recursion must match the closed form.
    for (const n of [5, 10, 100, 1000]) {
      expect(multipleChoiceSecretary(n, 1).successProbability).toBeCloseTo(secretaryProblem(n).successProbability, 12);
    }
    // Gilbert and Mosteller's asymptotic value for two choices is 0.5910, and
    // like the single-choice case the finite-n value approaches it from above.
    const two = multipleChoiceSecretary(1000, 2).successProbability;
    expect(two).toBeCloseTo(0.5910, 2);
    expect(two).toBeGreaterThan(0.591);
    expect(multipleChoiceSecretary(20000, 2).successProbability).toBeLessThan(two);
    expect(multipleChoiceSecretary(20000, 2).successProbability).toBeGreaterThan(0.591);
    expect(multipleChoiceSecretary(10, 2).successProbability).toBeGreaterThan(multipleChoiceSecretary(10, 1).successProbability);
    // Enough choices to accept every record makes success certain.
    expect(multipleChoiceSecretary(6, 6).successProbability).toBeCloseTo(1, 10);
    expect(() => multipleChoiceSecretary(5, 6)).toThrowError(/1\.\.5/);
  });

  it('a Monte Carlo simulation of the optimal rule achieves the stated probability', () => {
    const n = 10;
    const skip = secretaryProblem(n).skip;
    const target = secretaryProblem(n).successProbability;
    const reps = 200000;
    const rng = new Random(new Xoshiro128('secretary-mc'));
    let wins = 0;
    const order = new Array<number>(n);
    for (let rep = 0; rep < reps; rep++) {
      for (let i = 0; i < n; i++) order[i] = i;
      for (let i = n - 1; i > 0; i--) {
        const j = rng.int(0, i);
        const tmp = order[i];
        order[i] = order[j];
        order[j] = tmp;
      }
      // Ranks: n − 1 is the best candidate.
      let bestSeen = -1;
      for (let i = 0; i < skip; i++) bestSeen = Math.max(bestSeen, order[i]);
      let chosen = order[n - 1];
      for (let i = skip; i < n; i++) {
        if (order[i] > bestSeen) {
          chosen = order[i];
          break;
        }
      }
      if (chosen === n - 1) wins++;
    }
    const phat = wins / reps;
    // Binomial standard error at p ≈ 0.3987 with 200,000 draws is
    // √(0.3987·0.6013/200000) = 0.00110, so a 4-sigma tolerance is 0.0044.
    expect(Math.abs(phat - target)).toBeLessThan(0.0044);
  });
});

describe('Optimal stopping: search with a known value distribution', () => {
  const uniformQuantile = (p: number): number => p;

  it('reproduces the exact finite-horizon reservation values for uniform offers', () => {
    // With X ~ U(0,1): E[max(X, v)] = (1 + v²)/2 for v ∈ [0,1]. With n = 3 and
    // no cost or discount, v_3 = −∞ (take the last), v_2 = E[X] = 1/2,
    // v_1 = (1 + 1/4)/2 = 5/8, and the policy's value is (1 + 25/64)/2
    // = 89/128 = 0.6953125.
    const got = finiteHorizonSearch(3, uniformQuantile);
    expect(got.reservationValues[2]).toBe(-Infinity);
    expect(got.reservationValues[1]).toBeCloseTo(0.5, 6);
    expect(got.reservationValues[0]).toBeCloseTo(0.625, 6);
    expect(got.expectedValue).toBeCloseTo(89 / 128, 6);
    // Reservation values decline as the deadline approaches.
    expect(got.reservationValues[0]).toBeGreaterThan(got.reservationValues[1]);
  });

  it('reproduces the exact reservation value of the infinite-horizon job search', () => {
    // The reservation value solves E[(X − y)⁺] = c. For U(0,1) that is
    // (1 − y)²/2 = c, so c = 0.02 gives y = 1 − √0.04 = 0.8 and the expected
    // number of offers is 1/P(X ≥ 0.8) = 5.
    const got = jobSearch(uniformQuantile, { searchCost: 0.02 });
    expect(got.reservationValue).toBeCloseTo(0.8, 6);
    expect(got.expectedOffers).toBeCloseTo(5, 2);
    // A higher search cost makes the searcher less choosy.
    expect(jobSearch(uniformQuantile, { searchCost: 0.08 }).reservationValue).toBeLessThan(got.reservationValue);
    // Free, undiscounted search has no answer and must be refused.
    expect(() => jobSearch(uniformQuantile, { searchCost: 0, discount: 1 })).toThrowError(/no reason ever to stop/);
  });
});

describe('Optimal stopping: sequential testing', () => {
  it('SPRT holds its error targets AND needs materially fewer observations', () => {
    const p0 = 0.5;
    const p1 = 0.7;
    const alpha = 0.05;
    const beta = 0.1;
    const test = sprt(p0, p1, alpha, beta, { maxSteps: 3000, grid: [p0, p1] });
    const cSuccess = Math.log(p1 / p0);
    const cFailure = Math.log((1 - p1) / (1 - p0));
    // Both halves of the claim, from simulation rather than from the formulas.
    const reps = 20000;
    const simulate = (p: number): { rejectRate: number; meanN: number } => {
      const rng = new Random(new Xoshiro128(`sprt-${p}`));
      let rejects = 0;
      let totalN = 0;
      for (let rep = 0; rep < reps; rep++) {
        let llr = 0;
        let n = 0;
        for (;;) {
          llr += rng.uniform() < p ? cSuccess : cFailure;
          n++;
          if (llr >= test.upperBoundary) {
            rejects++;
            break;
          }
          if (llr <= test.lowerBoundary) break;
          if (n >= 3000) break;
        }
        totalN += n;
      }
      return { rejectRate: rejects / reps, meanN: totalN / reps };
    };
    const underNull = simulate(p0);
    const underAlt = simulate(p1);
    // Binomial standard error at α = 0.05 with 20,000 replications is
    // √(0.05·0.95/20000) = 0.00154; 3 sigma is 0.0046. Wald's boundaries ignore
    // overshoot, so the realised rates should land BELOW the targets.
    expect(underNull.rejectRate).toBeLessThan(alpha + 0.0046);
    expect(1 - underAlt.rejectRate).toBeLessThan(beta + 0.0062);
    // The exact lattice enumeration must agree with the simulation and respect
    // the targets outright.
    const exactNull = test.operatingCharacteristic[0];
    const exactAlt = test.operatingCharacteristic[1];
    expect(exactNull.rejectH0).toBeLessThanOrEqual(alpha);
    expect(1 - exactAlt.rejectH0).toBeLessThanOrEqual(beta);
    expect(Math.abs(exactNull.rejectH0 - underNull.rejectRate)).toBeLessThan(0.0046);
    // Second half of the claim: the saving over the fixed-sample test is the
    // whole point of the SPRT.
    expect(test.expectedSampleSize.underH0).toBeLessThan(0.65 * test.fixedSampleSize);
    expect(test.expectedSampleSize.underH1).toBeLessThan(0.75 * test.fixedSampleSize);
    expect(underNull.meanN).toBeLessThan(0.7 * test.fixedSampleSize);
    expect(underAlt.meanN).toBeLessThan(0.8 * test.fixedSampleSize);
    expect(test.provenance.limitations.join(' ')).toMatch(/PRE-DECLARED BOUNDARIES/);
  });

  it('a Bayesian posterior-probability rule has its frequentist rate reported honestly', () => {
    const design = bayesianSequential(0.5, 0.95, { maxSteps: 200, grid: [0.5, 0.75] });
    const atNull = design.operatingCharacteristic[0];
    // The posterior threshold is 0.95, yet the frequentist probability of
    // stopping for H1 when p = 0.5 is far above 0.05. That gap is the point.
    expect(atNull.stopForH1).toBeGreaterThan(0.1);
    expect(design.operatingCharacteristic[1].stopForH1).toBeGreaterThan(0.9);
    expect(design.provenance.limitations.join(' ')).toMatch(/NOT a type I error rate/);
    // The lattice enumeration is the same machinery the SPRT uses; a rule that
    // never stops leaves all the mass unresolved.
    const never = latticeSequentialOC(0.5, 50, () => 'continue');
    expect(never.unresolved).toBeCloseTo(1, 12);
  });

  it('alpha-spending boundaries hold the nominal level and price the interim looks', () => {
    const looks = 5;
    const alpha = 0.05;
    const obf = alphaSpendingBoundaries(looks, alpha, 'obrien-fleming');
    const pocock = alphaSpendingBoundaries(looks, alpha, 'pocock');
    // O'Brien–Fleming is far more conservative at the first look and slightly
    // more permissive at the last.
    expect(obf.boundaries[0]).toBeGreaterThan(pocock.boundaries[0] + 1.5);
    expect(obf.boundaries[looks - 1]).toBeLessThan(pocock.boundaries[looks - 1]);
    // Pocock's near-constant boundary sits close to the published 2.413 for
    // K = 5 at α = 0.05.
    expect(pocock.boundaries[looks - 1]).toBeCloseTo(2.41, 1);
    // The α actually spent adds up to the nominal level.
    const spent = obf.incrementalAlpha.reduce((p, q) => p + q, 0);
    expect(spent).toBeCloseTo(alpha, 3);
    // Interim looks are not free, and Pocock's licence to stop early costs more.
    expect(obf.maximumSampleSizeInflation).toBeGreaterThan(1);
    expect(pocock.maximumSampleSizeInflation).toBeGreaterThan(obf.maximumSampleSizeInflation);
    expect(obf.maximumSampleSizeInflation).toBeLessThan(1.1);
    expect(pocock.maximumSampleSizeInflation).toBeGreaterThan(1.1);

    // Simulation: Brownian increments in information time, boundaries applied
    // at each look. The total type I error must not exceed the nominal level.
    const reps = 40000;
    const simulateTypeI = (bounds: number[]): number => {
      const rng = new Random(new Xoshiro128(`spend-${bounds[0]}`));
      const dt = 1 / looks;
      let crossings = 0;
      for (let rep = 0; rep < reps; rep++) {
        let s = 0;
        for (let k = 0; k < looks; k++) {
          s += Math.sqrt(dt) * rng.normal();
          if (Math.abs(s) >= bounds[k] * Math.sqrt((k + 1) * dt)) {
            crossings++;
            break;
          }
        }
      }
      return crossings / reps;
    };
    // √(0.05·0.95/40000) = 0.00109; 3 sigma is 0.0033, plus the grid error in
    // the boundary calculation (≈2e-4 in total α) gives a 0.004 allowance.
    expect(simulateTypeI(obf.boundaries)).toBeLessThan(alpha + 0.004);
    expect(simulateTypeI(pocock.boundaries)).toBeLessThan(alpha + 0.004);
  });
});

describe('Optimal stopping: Markov problems and the one-stage rule', () => {
  it('solves a monotone problem and agrees with the exact optimum', () => {
    // Climbing rewards with an absorbing top state: stopping is only attractive
    // at the top, and once there the process stays, so the set is closed.
    const got = markovStopping({
      stopReward: [0, 1, 2, 3],
      transitions: [
        [0, 1, 0, 0],
        [0, 0, 1, 0],
        [0, 0, 0, 1],
        [0, 0, 0, 1],
      ],
      discount: 0.9,
      stateLabels: ['a', 'b', 'c', 'top'],
    });
    expect(got.monotone).toBe(true);
    expect(got.oneStageSet).toEqual([false, false, false, true]);
    expect(got.disagreements).toEqual([]);
    // Exact values: v(top) = 3, v(c) = 0.9·3 = 2.7, v(b) = 2.43, v(a) = 2.187.
    expect(got.values[3]).toBeCloseTo(3, 10);
    expect(got.values[2]).toBeCloseTo(2.7, 10);
    expect(got.values[0]).toBeCloseTo(2.187, 10);
  });

  it('refuses a non-monotone problem rather than reporting the one-stage answer', () => {
    // A burglar who can stash a haul now or risk one more job: from the "rich"
    // state, where stopping beats one more step, the process can fall back to a
    // state where it does not. The one-stage set is not closed.
    expect(() =>
      markovStopping({
        stopReward: [0, 10, 1],
        transitions: [
          [0, 1, 0],
          [0, 0, 1],
          [0, 1, 0],
        ],
        discount: 0.9,
        stateLabels: ['empty', 'rich', 'caught'],
      }),
    ).toThrowError(/NOT monotone/);
  });
});

/* ------------------------------------------------------------ bandits */

describe('Bandits', () => {
  const spec: BanditSpec = { family: 'bernoulli', means: [0.5, 0.45, 0.4] };

  it('reports sublinear regret and beats a fixed large epsilon', () => {
    const res = runBanditExperiment({
      spec,
      horizon: 20000,
      replications: 40,
      seed: 'regret-study',
      algorithms: [
        { id: 'thompson-beta' },
        { id: 'ucb1' },
        { id: 'kl-ucb' },
        { id: 'epsilon-greedy', epsilon: 0.5, label: 'eps-0.5' },
      ],
    });
    const by = new Map(res.algorithms.map((a) => [a.label, a]));
    const ts = by.get('thompson-beta');
    const ucb = by.get('ucb1');
    const kl = by.get('kl-ucb');
    const eps = by.get('eps-0.5');
    if (!ts || !ucb || !kl || !eps) throw new Error('missing algorithm outcome');
    // Sub-linear regret: the log–log slope of cumulative regret against t must
    // be clearly below 1. A linear-regret algorithm sits at 1.
    expect(ts.regretLogLogSlope).toBeLessThan(0.6);
    expect(ucb.regretLogLogSlope).toBeLessThan(0.85);
    expect(kl.regretLogLogSlope).toBeLessThan(0.75);
    // ε-greedy with a fixed ε of 0.5 has LINEAR regret, so its slope sits near
    // 1. The fit is over a finite window, which biases the estimate down a
    // little; 0.85 separates it cleanly from Thompson sampling's 0.4.
    expect(eps.regretLogLogSlope).toBeGreaterThan(0.85);
    expect(eps.regretLogLogSlope).toBeGreaterThan(ts.regretLogLogSlope + 0.3);
    // Both adaptive algorithms must beat it by many Monte Carlo standard errors.
    for (const good of [ts, ucb, kl]) {
      const se = Math.hypot(good.finalRegret.standardError, eps.finalRegret.standardError);
      expect(eps.finalRegret.meanRegret - good.finalRegret.meanRegret).toBeGreaterThan(5 * se);
    }
    // Regret is random, and the result must say so with real spread.
    expect(ts.finalRegret.p95).toBeGreaterThan(ts.finalRegret.p05);
    expect(ts.finalRegret.standardError).toBeGreaterThan(0);
    expect(res.provenance.exactness).toBe('empirical');
    // The regret decomposition must add up to the mean regret.
    const decomposed = ucb.regretDecomposition.reduce((p, q) => p + q.contribution, 0);
    expect(decomposed).toBeCloseTo(ucb.finalRegret.meanRegret, 6);
  }, 60000);

  it('no algorithm beats the Lai–Robbins lower bound asymptotically', () => {
    // A well-separated instance, so the asymptotic regime is within reach: the
    // Lai–Robbins constant here is about 1.05, not the 15 of a near-tie.
    const separated: BanditSpec = { family: 'bernoulli', means: [0.9, 0.6] };
    const lowerT = 5000;
    const upperT = 50000;
    const bound = (T: number): number => laiRobbinsBound(separated, T).bound;
    const run = (T: number) =>
      runBanditExperiment({
        spec: separated,
        horizon: T,
        replications: 50,
        seed: 'lai-robbins',
        algorithms: [{ id: 'thompson-beta' }, { id: 'ucb1' }, { id: 'kl-ucb' }],
      });
    const lo = run(lowerT);
    const hi = run(upperT);
    // Sanity: the bound itself is the published form Σ Δ/KL.
    const kl = klBernoulli(0.6, 0.9);
    expect(laiRobbinsBound(separated, upperT).constant).toBeCloseTo(0.3 / kl, 12);

    for (let i = 0; i < hi.algorithms.length; i++) {
      const ratioLo = lo.algorithms[i].finalRegret.meanRegret / bound(lowerT);
      const ratioHi = hi.algorithms[i].finalRegret.meanRegret / bound(upperT);
      // THE CORE CHECK. The bound constrains liminf R_T / log T ≥ C, so regret
      // must keep pace with C·log T: the ratio must not fall as the horizon
      // grows by an order of magnitude. An algorithm whose regret stopped
      // growing (a bug, or an inconsistent rule hard-coded to one instance)
      // would show a collapsing ratio here.
      expect(ratioHi).toBeGreaterThan(ratioLo - 0.05);
      // And the ratio must stay within reach of 1 rather than tending to 0.
      // Thompson sampling, which is asymptotically optimal, sits around 0.57 at
      // T = 50,000 and rises; anything below 0.4 at this horizon on this
      // instance would be inconsistent with matching the bound in the limit.
      expect(ratioHi).toBeGreaterThan(0.4);
    }
    // UCB1 and KL-UCB, whose constants exceed the optimal one, must sit above
    // the bound outright at this horizon.
    expect(hi.algorithms[1].finalRegret.meanRegret).toBeGreaterThan(bound(upperT));
    expect(hi.algorithms[2].finalRegret.meanRegret).toBeGreaterThan(bound(upperT));
  }, 90000);

  it('runs as a cancellable generator that yields progress', () => {
    const gen = banditSteps({ spec, horizon: 200, replications: 12, seed: 'gen', algorithms: [{ id: 'ucb1' }] });
    let yields = 0;
    let step = gen.next();
    while (!step.done) {
      expect(step.value).toBeGreaterThan(0);
      expect(step.value).toBeLessThanOrEqual(1);
      yields++;
      step = gen.next();
    }
    expect(yields).toBeGreaterThan(1);
    expect(step.value.algorithms).toHaveLength(1);
    // Abandoning the generator early must not throw: that is cancellation.
    const partial = banditSteps({ spec, horizon: 200, replications: 12, seed: 'gen', algorithms: [{ id: 'ucb1' }] });
    partial.next();
    expect(() => partial.return(undefined as never)).not.toThrow();
  });

  it('the Gittins index matches published values and is optimal on the discounted objective', () => {
    // Gittins' published index for a Beta(1,1) arm (no data yet): 0.7029 at a
    // discount factor of 0.9, and 0.5 in the undiscounted-myopic limit.
    expect(gittinsIndex(0, 0, 0.9).index).toBeCloseTo(0.7029, 3);
    expect(gittinsIndex(0, 0, 0.5).index).toBeCloseTo(0.5590, 3);
    expect(gittinsIndex(0, 0, 0.95).index).toBeCloseTo(0.7614, 3);
    // One success raises the index, one failure lowers it, and both stay in
    // [0, 1] where the posterior mean lives.
    expect(gittinsIndex(1, 0, 0.9).index).toBeGreaterThan(gittinsIndex(0, 0, 0.9).index);
    expect(gittinsIndex(0, 1, 0.9).index).toBeLessThan(gittinsIndex(0, 0, 0.9).index);
    // As the discount factor falls to 0 the index becomes the posterior mean,
    // because there is no future left to learn for.
    expect(gittinsIndex(0, 0, 0.01).index).toBeCloseTo(0.5, 2);

    // On the DISCOUNTED objective the index policy is exactly optimal, so
    // nothing may beat it by a significant margin.
    const discount = 0.9;
    const table = gittinsIndexTable(discount, 160, { lambdaGrid: 500 });
    const res = runBanditExperiment({
      spec: { family: 'bernoulli', means: [0.7, 0.4] },
      horizon: 160,
      replications: 800,
      seed: 'gittins-objective',
      discount,
      algorithms: [{ id: 'gittins', indexTable: table }, { id: 'thompson-beta' }, { id: 'ucb1' }],
    });
    const [git, ts, ucb] = res.algorithms;
    if (!git.discountedReward || !ts.discountedReward || !ucb.discountedReward) throw new Error('no discounted reward');
    const sigma = (a: number, b: number): number => Math.hypot(a, b);
    // Nothing significantly beats the exactly optimal policy.
    expect(ts.discountedReward.mean - git.discountedReward.mean).toBeLessThan(
      2 * sigma(ts.discountedReward.standardError, git.discountedReward.standardError),
    );
    expect(ucb.discountedReward.mean - git.discountedReward.mean).toBeLessThan(
      2 * sigma(ucb.discountedReward.standardError, git.discountedReward.standardError),
    );
    // UCB1, which ignores the discount entirely, is clearly worse here.
    expect(git.discountedReward.mean - ucb.discountedReward.mean).toBeGreaterThan(
      2 * sigma(ucb.discountedReward.standardError, git.discountedReward.standardError),
    );
  }, 120000);

  it('best-arm identification respects its confidence guarantee', () => {
    const got = bestArmIdentification({ family: 'bernoulli', means: [0.6, 0.4, 0.3] }, 0.05, { replications: 80, budget: 400000, seed: 'bai' });
    // The guarantee is at least 1 − δ = 0.95. Hoeffding bounds are loose, so
    // the realised rate should be far above it; with 80 replications a rate
    // below 0.95 would already be suspicious.
    expect(got.correctProbability).toBeGreaterThanOrEqual(0.95);
    expect(got.budgetExhausted).toBe(0);
    expect(got.meanSampleSize).toBeGreaterThan(100);
    expect(got.provenance.exactness).toBe('empirical');
    // An unidentifiable instance must be refused, not answered.
    expect(() => bestArmIdentification({ family: 'bernoulli', means: [0.5, 0.5] }, 0.05)).toThrowError(/not identifiable/);
  }, 60000);

  it('LinUCB recovers the per-context best arm', () => {
    const got = linUCB([[1, 0], [0, 1]], (rng) => [rng.normal(), rng.normal()], { horizon: 600, replications: 8, seed: 'linucb-test' });
    expect(got.meanRegret).toBeGreaterThan(0);
    // The coefficients must converge towards the truth, which is how we know
    // the regret figure is measuring the right thing.
    expect(got.coefficients[0][0]).toBeCloseTo(1, 1);
    expect(got.coefficients[0][1]).toBeCloseTo(0, 1);
    expect(got.coefficients[1][1]).toBeCloseTo(1, 1);
    // Regret per round must be small compared with the typical context gap.
    expect(got.meanRegret / 600).toBeLessThan(0.1);
  }, 60000);
});

/* ------------------------------------------- reinforcement learning */

describe('Reinforcement learning from samples', () => {
  const learningMDP: MDP = {
    nStates: 3,
    stateLabels: ['left', 'middle', 'right'],
    actions: [
      ['stay', 'push'],
      ['back', 'push'],
      ['stay', 'back'],
    ],
    transitions: [
      [
        [0.9, 0.1, 0],
        [0.2, 0.8, 0],
      ],
      [
        [0.8, 0.2, 0],
        [0, 0.3, 0.7],
      ],
      [
        [0, 0.1, 0.9],
        [0, 0.8, 0.2],
      ],
    ],
    rewards: [
      [0, 0],
      [0, 1],
      [2, 0],
    ],
  };

  it('Q-learning approaches the exactly computed optimum and matches the optimal policy', () => {
    const exact = policyIteration(learningMDP, 0.9);
    const got = qLearning({
      mdp: learningMDP,
      discount: 0.9,
      episodes: 1200,
      stepsPerEpisode: 400,
      seed: 'q-learning',
      stepSize: { kind: 'polynomial', initial: 1, exponent: 0.7 },
      exploration: { kind: 'epsilon-greedy', epsilon: 0.3 },
      compareWithOptimum: true,
      minVisitsPerPair: 1000,
    });
    expect(got.diagnostics.converged).toBe(true);
    expect(got.diagnostics.comparison).toBeDefined();
    const cmp = got.diagnostics.comparison;
    if (!cmp) throw new Error('no comparison');
    // The optimal values here are of order 15–19, so 0.5 is a 3% tolerance:
    // loose, but a sampled estimate from a finite run cannot claim better.
    expect(cmp.maxAbsQError).toBeLessThan(0.5);
    expect(got.diagnostics.tailMeanBellmanResidual).toBeLessThan(0.1);
    expect(cmp.policyMatchesOptimum).toBe(true);
    expect(got.policy).toEqual(exact.policy);
    expect(got.provenance.exactness).toBe('empirical');
    expect(got.provenance.limitations.join(' ')).toMatch(/CONVERGENCE CONDITIONS ARE NOT MET/);
  }, 60000);

  it('reports NOT CONVERGED when the run is too short, instead of presenting an answer', () => {
    const got = qLearning({
      mdp: learningMDP,
      discount: 0.9,
      episodes: 2,
      stepsPerEpisode: 20,
      seed: 'q-learning-short',
      exploration: { kind: 'epsilon-greedy', epsilon: 0.3 },
      compareWithOptimum: true,
      minVisitsPerPair: 100,
    });
    expect(got.diagnostics.converged).toBe(false);
    expect(got.diagnostics.visitationAdequate).toBe(false);
    expect(got.diagnostics.notConvergedReason).toMatch(/NOT CONVERGED/);
    expect(got.provenance.limitations[0]).toMatch(/NOT CONVERGED/);
    // And the estimates really are far from the optimum, which is why the
    // warning matters.
    const cmp = got.diagnostics.comparison;
    if (!cmp) throw new Error('no comparison');
    expect(cmp.maxAbsQError).toBeGreaterThan(1);
  });

  it('refuses to call a run converged when the step size decayed too fast', () => {
    // α_n = 1/n satisfies the theory but in practice stalls: the updates become
    // tiny long before the estimates are right. Small updates are therefore NOT
    // evidence of convergence, and the mean temporal-difference error catches it.
    const got = qLearning({
      mdp: learningMDP,
      discount: 0.9,
      episodes: 600,
      stepsPerEpisode: 400,
      seed: 'q-learning-stalled',
      stepSize: { kind: 'inverse-count', initial: 1 },
      exploration: { kind: 'epsilon-greedy', epsilon: 0.3 },
      compareWithOptimum: true,
      minVisitsPerPair: 1000,
    });
    const cmp = got.diagnostics.comparison;
    if (!cmp) throw new Error('no comparison');
    // Every update was tiny, yet the Q-values are badly wrong.
    expect(got.diagnostics.recentMaxChange).toBeLessThan(0.01);
    expect(cmp.maxAbsQError).toBeGreaterThan(1);
    // Visitation was ample, so this is purely the residual criterion working.
    expect(got.diagnostics.visitationAdequate).toBe(true);
    expect(got.diagnostics.converged).toBe(false);
    expect(got.diagnostics.notConvergedReason).toMatch(/temporal-difference error/);
  }, 60000);

  it('SARSA learns the value of the policy it follows, which is below the optimum', () => {
    const got = sarsa({
      mdp: learningMDP,
      discount: 0.9,
      episodes: 400,
      stepsPerEpisode: 400,
      seed: 'sarsa',
      stepSize: { kind: 'polynomial', initial: 1, exponent: 0.7 },
      exploration: { kind: 'epsilon-greedy', epsilon: 0.3 },
      compareWithOptimum: true,
    });
    const cmp = got.diagnostics.comparison;
    if (!cmp) throw new Error('no comparison');
    // On-policy values must not exceed the optimal values (beyond noise).
    for (let s = 0; s < learningMDP.nStates; s++) {
      expect(got.values[s]).toBeLessThan(cmp.optimalValues[s] + 0.5);
    }
    expect(got.provenance.limitations.join(' ')).toMatch(/on-policy/);
  }, 60000);

  it('TD(0) and TD(λ) approach the exact policy value', () => {
    const policy = [1, 1, 0];
    const exact = evaluatePolicyExact(learningMDP, policy, 0.9);
    for (const lambda of [0, 0.6]) {
      const got = temporalDifference({
        mdp: learningMDP,
        policy,
        discount: 0.9,
        episodes: 400,
        stepsPerEpisode: 300,
        seed: `td-${lambda}`,
        lambda,
        stepSize: { kind: 'polynomial', initial: 0.5, exponent: 0.7 },
        compareWithExact: true,
      });
      expect(got.exactValues).toEqual(exact);
      if (got.maxAbsError === undefined) throw new Error('no error reported');
      // Values are of order 10 here; 1.0 is a 10% tolerance for a sampled
      // estimate with serially dependent updates.
      expect(got.maxAbsError).toBeLessThan(1.0);
      expect(got.provenance.exactness).toBe('empirical');
    }
  }, 60000);
});

/* ----------------------------------------------------------- refusals */

describe('Refusals: nothing plausible is returned on bad input', () => {
  it('names the state and action of a transition row that does not sum to 1', () => {
    const broken: MDP = {
      nStates: 2,
      stateLabels: ['alpha', 'beta'],
      actions: [['hold', 'switch'], ['wait']],
      transitions: [[[1, 0], [0.5, 0.3]], [[0, 1]]],
      rewards: [[1, 1], [1]],
    };
    const issues = validateMDP(broken, 0.9);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('state alpha');
    expect(issues[0].message).toContain('"switch"');
    expect(issues[0].message).toContain('0.8');
    expect(() => valueIteration(broken, 0.9)).toThrowError(/sum to/);
    expect(() => lpSolveMDP(broken, 0.9)).toThrowError(/sum to/);
  });

  it('refuses γ = 1 for a discounted infinite-horizon problem', () => {
    expect(() => valueIteration(HAND_MDP, 1)).toThrowError(/strictly below 1/);
    expect(() => policyIteration(HAND_MDP, 1)).toThrowError(/strictly below 1/);
    expect(() => lpSolveMDP(HAND_MDP, 1)).toThrowError(/strictly below 1/);
    expect(() => valueIteration(HAND_MDP, 1.2)).toThrowError(/strictly below 1/);
    // γ = 1 IS legitimate over a finite horizon, and must be accepted there.
    expect(() => finiteHorizonMDP(HAND_MDP, 5, 1)).not.toThrow();
  });

  it('refuses a state with no actions', () => {
    const noActions: MDP = {
      nStates: 2,
      stateLabels: ['busy', 'idle'],
      actions: [['go'], []],
      transitions: [[[0, 1]], []],
      rewards: [[1], []],
    };
    const issues = validateMDP(noActions, 0.9);
    expect(issues.some((i) => i.message.includes('State idle has no actions'))).toBe(true);
    expect(() => valueIteration(noActions, 0.9)).toThrowError(/no actions/);
  });

  it('reports non-convergence honestly instead of presenting the iterates as a solution', () => {
    const got = valueIteration(HAND_MDP_2, 0.999, { tolerance: 1e-14, maxIterations: 5 });
    expect(got.converged).toBe(false);
    expect(got.iterations).toBe(5);
    expect(got.bellmanError).toBeGreaterThan(1e-14);
    expect(got.provenance.limitations[0]).toMatch(/NOT CONVERGED/);
    // The error bound must be reported and must be large, not quietly dropped.
    expect(got.errorBound).toBeGreaterThan(1);
    const avg = averageRewardMDP(SPRINT_MDP, { tolerance: 1e-14, maxIterations: 3 });
    expect(avg.converged).toBe(false);
    expect(avg.provenance.limitations[0]).toMatch(/NOT CONVERGED/);
  });

  it('refuses zero arms and a single-run bandit comparison', () => {
    expect(() => laiRobbinsBound({ family: 'bernoulli', means: [] }, 100)).toThrowError(/at least one arm/);
    expect(() =>
      runBanditExperiment({ spec: { family: 'bernoulli', means: [] }, horizon: 10, replications: 10, seed: 's', algorithms: [{ id: 'ucb1' }] }),
    ).toThrowError(/at least one arm/);
    expect(() =>
      runBanditExperiment({ spec: { family: 'bernoulli', means: [0.5, 0.4] }, horizon: 10, replications: 1, seed: 's', algorithms: [{ id: 'ucb1' }] }),
    ).toThrowError(/single run cannot be reported/);
    // A degenerate instance has no finite Lai–Robbins constant.
    expect(() => laiRobbinsBound({ family: 'bernoulli', means: [1, 0.5] }, 100)).toThrowError(/not finite/);
  });

  it('refuses a policy that names an action a state does not have', () => {
    expect(() => evaluatePolicyExact(HAND_MDP, [5, 0], 0.5)).toThrowError(/action index 5/);
    expect(() => evaluatePolicyExact(HAND_MDP, [0], 0.5)).toThrowError(/must name an action/);
  });

  it('refuses an exact POMDP horizon that would exceed the alpha-vector cap', () => {
    expect(() => exactPOMDPValueIteration(TIGER, 12, 0.75, { maxVectors: 20 })).toThrowError(/above the cap/);
    expect(() => exactPOMDPValueIteration(TIGER, 0, 0.75)).toThrowError(/at least 1/);
  });

  it('refuses ε = 0 exploration and an impossible step size', () => {
    const base = { mdp: HAND_MDP, discount: 0.5, episodes: 10, stepsPerEpisode: 10, seed: 'rl' };
    expect(() => qLearning({ ...base, exploration: { kind: 'epsilon-greedy', epsilon: 0 } })).toThrowError(/purely greedy/);
    expect(() => qLearning({ ...base, stepSize: { kind: 'polynomial', initial: 1, exponent: 0.3 } })).toThrowError(/0.5, 1/);
  });
});
