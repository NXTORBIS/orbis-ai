/**
 * How robust is the recommended policy?
 *
 * A policy is a recommendation to act, and the honest question about one is not
 * "what is its value?" but "how far can the inputs move before the advice
 * changes?". Two knobs are treated here: the discount factor, which encodes how
 * much the future counts, and a single reward entry.
 *
 * The switching point is located exactly rather than read off a grid: between
 * two grid points where the optimal policy differs, the difference in exact
 * policy value is a continuous function of the parameter and its root is found
 * by Brent's method.
 */
import { brentRoot } from '../core/numeric';
import { EngineError } from '../core/result';
import { evaluatePolicyExact, policyIteration, stateName, validateMDP } from './mdp';
import type { MDP, Policy, Provenance } from './types';

export interface PolicyRegion {
  /** Parameter value at the start of the region (inclusive). */
  from: number;
  /** Parameter value at the end of the region. */
  to: number;
  policy: Policy;
  policyLabels: string[];
}

export interface SwitchPoint {
  /** The parameter value at which the two policies have equal value. */
  at: number;
  /** The states whose recommended action changes across the switch. */
  changedStates: { state: number; stateLabel: string; before: string; after: string }[];
  before: Policy;
  after: Policy;
}

export interface SensitivityResult {
  parameter: string;
  regions: PolicyRegion[];
  switchPoints: SwitchPoint[];
  /** True when the optimal policy is the same across the whole scanned range. */
  stable: boolean;
  provenance: Provenance;
}

function samePolicy(a: Policy, b: Policy): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function changed(mdp: MDP, before: Policy, after: Policy): SwitchPoint['changedStates'] {
  const out: SwitchPoint['changedStates'] = [];
  for (let s = 0; s < before.length; s++) {
    if (before[s] !== after[s]) {
      out.push({ state: s, stateLabel: stateName(mdp, s), before: mdp.actions[s][before[s]], after: mdp.actions[s][after[s]] });
    }
  }
  return out;
}

interface ScanOptions {
  /** Grid points used to locate regions before refining each boundary. */
  gridPoints?: number;
  /** State whose value decides the crossing; defaults to state 0. */
  referenceState?: number;
}

function scan(
  mdp: MDP,
  parameter: string,
  lo: number,
  hi: number,
  solveAt: (x: number) => { policy: Policy; discount: number },
  evaluateAt: (x: number, policy: Policy) => number[],
  opts: ScanOptions,
  provenance: Provenance,
): SensitivityResult {
  const grid = opts.gridPoints ?? 41;
  if (!Number.isInteger(grid) || grid < 3) throw new EngineError('gridPoints must be a whole number of at least 3.', 'range');
  if (!(hi > lo)) throw new EngineError(`The scan range for ${parameter} must have its upper end above its lower end.`, 'range');
  const ref = opts.referenceState ?? 0;
  if (!Number.isInteger(ref) || ref < 0 || ref >= mdp.nStates) {
    throw new EngineError(`referenceState must be a state index in 0..${mdp.nStates - 1}.`, 'range');
  }

  const xs: number[] = [];
  for (let i = 0; i < grid; i++) xs.push(lo + ((hi - lo) * i) / (grid - 1));
  const policies = xs.map((x) => solveAt(x).policy);

  const regions: PolicyRegion[] = [];
  const switchPoints: SwitchPoint[] = [];
  let regionStart = lo;
  for (let i = 1; i < xs.length; i++) {
    if (samePolicy(policies[i], policies[i - 1])) continue;
    const before = policies[i - 1];
    const after = policies[i];
    // Exact crossing: where the two policies' values at the reference state are
    // equal. Both are evaluated exactly, so the only approximation is the root
    // find, which runs to 1e-13.
    const f = (x: number): number => evaluateAt(x, after)[ref] - evaluateAt(x, before)[ref];
    let at = 0.5 * (xs[i - 1] + xs[i]);
    const fa = f(xs[i - 1]);
    const fb = f(xs[i]);
    if (fb === 0) {
      // The grid point itself is the indifference point.
      at = xs[i];
    } else if (fa === 0) {
      at = xs[i - 1];
    } else if (Number.isFinite(fa) && Number.isFinite(fb) && fa * fb < 0) {
      at = brentRoot(f, xs[i - 1], xs[i], { tol: 1e-13 });
    }
    regions.push({ from: regionStart, to: at, policy: before, policyLabels: before.map((a, s) => mdp.actions[s][a]) });
    switchPoints.push({ at, changedStates: changed(mdp, before, after), before, after });
    regionStart = at;
  }
  const last = policies[policies.length - 1];
  regions.push({ from: regionStart, to: hi, policy: last, policyLabels: last.map((a, s) => mdp.actions[s][a]) });

  return {
    parameter,
    regions,
    switchPoints,
    stable: switchPoints.length === 0,
    provenance: {
      ...provenance,
      limitations: [
        ...provenance.limitations,
        `Policy regions are located on a ${grid}-point grid: a region narrower than ${((hi - lo) / (grid - 1)).toExponential(2)} in ${parameter} can be missed entirely. Increase gridPoints to narrow that blind spot.`,
        `Each switch point is the parameter value at which the two policies have equal value in state ${stateName(mdp, ref)}. With more than one state changing, the crossing can occur at slightly different parameter values for different starting states.`,
      ],
    },
  };
}

/**
 * How the optimal policy depends on the discount factor, with the exact
 * switching points. γ is scanned over [lo, hi] ⊂ [0, 1).
 */
export function discountSensitivity(
  mdp: MDP,
  lo = 0,
  hi = 0.99,
  opts: ScanOptions = {},
): SensitivityResult {
  const issues = validateMDP(mdp);
  if (issues.length) throw new EngineError(issues);
  if (!(lo >= 0) || !(hi < 1)) {
    throw new EngineError(`The discount scan must lie inside [0, 1); [${lo}, ${hi}] was requested. γ = 1 is the average-reward problem, which is a different criterion.`, 'range');
  }
  return scan(
    mdp,
    'discount factor γ',
    lo,
    hi,
    (g) => ({ policy: policyIteration(mdp, g).policy, discount: g }),
    (g, policy) => evaluatePolicyExact(mdp, policy, g),
    opts,
    {
      exactness: 'exact',
      method: 'Policy iteration on a discount grid with Brent refinement of each switching point',
      assumedInputs: ['The transition probabilities and rewards are supplied by the user.'],
      limitations: [
        'A policy that is optimal over a wide range of γ is a robust recommendation; one that switches near the γ actually in use is not, and the switching point says how near.',
      ],
    },
  );
}

/**
 * How the optimal policy depends on a single reward entry R(s, a), scanned over
 * [lo, hi], with the exact value at which the recommendation flips. This is the
 * break-even reward: the point at which the decision changes.
 */
export function rewardSensitivity(
  mdp: MDP,
  state: number,
  action: number,
  discount: number,
  lo: number,
  hi: number,
  opts: ScanOptions = {},
): SensitivityResult {
  const issues = validateMDP(mdp, discount);
  if (issues.length) throw new EngineError(issues);
  if (!Number.isInteger(state) || state < 0 || state >= mdp.nStates) {
    throw new EngineError(`The state whose reward is varied must be an index in 0..${mdp.nStates - 1}.`, 'range');
  }
  if (!Number.isInteger(action) || action < 0 || action >= mdp.actions[state].length) {
    throw new EngineError(`State ${stateName(mdp, state)} has ${mdp.actions[state].length} action(s); action index ${action} is out of range.`, 'range');
  }
  if (Array.isArray(mdp.rewards[state][action])) {
    throw new EngineError(
      `The reward for (state ${stateName(mdp, state)}, action "${mdp.actions[state][action]}") is a vector R(s,a,s'), so there is no single number to vary. Convert it to the expected reward first, or vary a scalar entry.`,
      'unsupported',
    );
  }
  const withReward = (x: number): MDP => {
    const rewards = mdp.rewards.map((row) => [...row]);
    rewards[state][action] = x;
    return { ...mdp, rewards };
  };
  return scan(
    mdp,
    `R(${stateName(mdp, state)}, "${mdp.actions[state][action]}")`,
    lo,
    hi,
    (x) => ({ policy: policyIteration(withReward(x), discount).policy, discount }),
    (x, policy) => evaluatePolicyExact(withReward(x), policy, discount),
    opts,
    {
      exactness: 'exact',
      method: 'Policy iteration on a reward grid with Brent refinement of each break-even point',
      assumedInputs: [`The reward R(${stateName(mdp, state)}, "${mdp.actions[state][action]}") is treated as uncertain; every other input is held fixed.`],
      limitations: [
        'One reward is varied at a time. Several rewards moving together can flip the policy at a combination that no single-parameter scan reaches.',
      ],
    },
  );
}
