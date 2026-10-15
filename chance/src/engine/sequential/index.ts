/**
 * Sequential decisions and learning under uncertainty.
 *
 * `src/engine/decision/` answers "given what I believe now, what is the best
 * single choice?". This module answers the harder question: what to do
 * REPEATEDLY, over time, when each choice changes both what you will face next
 * and what you will know next.
 *
 *  - `mdp`         — finite Markov decision processes: strict validation, value
 *                    iteration WITH its contraction error bound, policy
 *                    iteration and modified policy iteration, finite-horizon
 *                    backward induction (whose optimal policy is
 *                    time-dependent), average reward by relative value
 *                    iteration, Q-values, advantages, policy evaluation for a
 *                    user-supplied policy and the state-visitation measure.
 *  - `lp`          — the dual occupancy linear program, a third route to the
 *                    optimum that shares no code with the other two. The
 *                    agreement of all three is the module's strongest check.
 *  - `sensitivity` — how far the discount factor or a reward can move before
 *                    the recommendation changes, and the exact switching point.
 *  - `pomdp`       — hidden state: belief updating, EXACT finite-horizon
 *                    alpha-vector value iteration with witness-LP pruning, the
 *                    QMDP and fast-informed-bound approximations labelled as
 *                    the optimistic upper bounds they are, and the value of
 *                    information.
 *  - `stopping`    — when to stop looking: the secretary problem and its
 *                    variants, the odds algorithm, house-selling and job
 *                    search, the SPRT with the warning that its error rates
 *                    hold only for the pre-declared boundaries, Bayesian
 *                    sequential analysis, O'Brien–Fleming and Pocock
 *                    alpha-spending with the maximum-sample-size inflation that
 *                    interim looks cost, and Markov stopping by the one-stage
 *                    look-ahead rule with its monotonicity condition CHECKED.
 *  - `bandits`     — explore versus exploit: Thompson sampling, UCB1,
 *                    UCB-tuned, KL-UCB, ε-greedy, EXP3, successive elimination
 *                    and the exactly optimal Gittins index, run as a
 *                    cancellable generator and reported as a distribution over
 *                    replications with Monte Carlo error, against the
 *                    Lai–Robbins lower bound.
 *  - `rl`          — learning from samples when the model is unknown:
 *                    Q-learning, SARSA, TD(0) and TD(λ), each refusing to call
 *                    itself converged when the visitation and residual
 *                    diagnostics say otherwise.
 *
 * Nothing here imports from `src/ui/`, `src/app/` or `src/ai/`.
 */
export * from './types';
export * from './mdp';
export * from './lp';
export * from './sensitivity';
export * from './pomdp';
export * from './stopping';
export * from './bandits';
export * from './rl';
