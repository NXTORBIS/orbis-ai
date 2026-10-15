/**
 * Shared types for sequential decision making under uncertainty.
 *
 * Scope
 * -----
 * `src/engine/decision/` answers "given what I believe now, what is the best
 * single choice?". This module answers the harder question: "what should I do
 * repeatedly, over time, when each choice changes both what I will face next
 * and what I will know next?". That is the Markov decision process, its
 * partially observable cousin, optimal stopping, bandits and reinforcement
 * learning from samples.
 *
 * Provenance convention
 * ---------------------
 * Every result carries a `Provenance` naming how it was obtained:
 *
 *  - `exact`     — policy iteration, the linear-programming route, finite
 *                  horizon backward induction, exact policy evaluation by
 *                  linear solve, the exact secretary threshold, exact
 *                  alpha-vector POMDP value iteration. These are exact given
 *                  the model; the model itself is a user assumption.
 *  - `numerical` — value iteration and relative value iteration, which stop at
 *                  a tolerance. These ALWAYS report the achieved Bellman error
 *                  and the contraction bound ‖v − v*‖∞ ≤ ε·γ/(1−γ). A value
 *                  function reported without its error bound is an unverified
 *                  claim, so the bound is a required field, not an option.
 *  - `empirical` — bandit and reinforcement-learning runs. Regret and learned
 *                  values are random quantities; these results report a
 *                  distribution over replications with Monte Carlo error, never
 *                  a single run.
 */
import type { Exactness } from '../core/result';

export interface Provenance {
  exactness: Exactness;
  method: string;
  /** Inputs the conclusion rests on that are assumptions, not facts. */
  assumedInputs: string[];
  limitations: string[];
}

/* ------------------------------------------------------------------- MDP */

/**
 * A finite Markov decision process.
 *
 * States are indices 0..nStates-1. For each state, `actions[s]` lists the
 * actions available there (as labels); `transitions[s][a]` is the row
 * P(·|s, actions[s][a]) and must sum to 1. `rewards[s][a]` is either a scalar
 * R(s,a) (the expected immediate reward) or a vector R(s,a,s') over successor
 * states, in which case the expected reward is contracted against the
 * transition row.
 */
export interface MDP {
  nStates: number;
  stateLabels?: string[];
  actions: string[][];
  transitions: number[][][];
  rewards: (number | number[])[][];
}

/** A deterministic stationary policy: the action index chosen in each state. */
export type Policy = number[];

/** A time-dependent policy from backward induction: policy[t][s]. */
export type TimePolicy = number[][];

export interface ValueFunctionResult {
  /** v(s) for every state. */
  values: number[];
  /** Q(s,a) for every state and available action. */
  qValues: number[][];
  /** Advantage A(s,a) = Q(s,a) − v(s); zero at the greedy action. */
  advantages: number[][];
  policy: Policy;
  /** Human-readable action label chosen in each state. */
  policyLabels: string[];
  discount: number;
  provenance: Provenance;
}

export interface ValueIterationResult extends ValueFunctionResult {
  iterations: number;
  /** max_s |v_{k+1}(s) − v_k(s)| at the final sweep. */
  bellmanError: number;
  /**
   * Guaranteed distance to the optimal value function:
   * ‖v − v*‖∞ ≤ bellmanError · γ/(1−γ).
   */
  errorBound: number;
  converged: boolean;
  tolerance: number;
}

export interface PolicyIterationResult extends ValueFunctionResult {
  iterations: number;
  /** The policy after each improvement step, so the path is visible. */
  policyPath: Policy[];
  /** Policy evaluation sweeps per improvement (Infinity = exact solve). */
  evaluationSweeps: number;
}

export interface PolicyEvaluationResult {
  values: number[];
  /** Q(s,a) under the evaluated policy, for comparison with the optimum. */
  qValues: number[][];
  /** Actions that would improve on the supplied policy, if any. */
  improvements: { state: number; from: string; to: string; gain: number }[];
  provenance: Provenance;
}

export interface AverageRewardResult {
  /** The optimal gain g (reward per step), identical in every state for a
   *  unichain MDP. */
  gain: number;
  /** Relative values h(s), identified up to an additive constant (h(0) = 0). */
  relativeValues: number[];
  policy: Policy;
  policyLabels: string[];
  iterations: number;
  span: number;
  converged: boolean;
  provenance: Provenance;
}

export interface FiniteHorizonResult {
  /** values[t][s] = optimal expected reward from stage t to the horizon. */
  values: number[][];
  /** policy[t][s]: the optimal action index at stage t. Time-dependent. */
  policy: TimePolicy;
  policyLabels: string[][];
  horizon: number;
  discount: number;
  /** True when the optimal action differs between stages for some state. */
  policyIsTimeDependent: boolean;
  provenance: Provenance;
}

export interface StateVisitationResult {
  /** Discounted state-occupancy measure, normalised to sum to 1. */
  distribution: number[];
  /** Unnormalised discounted occupancy Σ_t γ^t P(s_t = s). */
  occupancy: number[];
  provenance: Provenance;
}
