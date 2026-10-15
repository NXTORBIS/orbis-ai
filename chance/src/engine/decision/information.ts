/**
 * The value of information.
 *
 * A probability tells you how uncertain you are. The value of information
 * tells you what that uncertainty costs you, which is the only form in which
 * uncertainty can be traded against money.
 *
 *  - **EVPI**, expected value of perfect information, is the gain from knowing
 *    the state of nature for certain *before* choosing:
 *
 *        EVPI = Σ_s p(s)·max_a V(a,s)  −  max_a Σ_s p(s)·V(a,s)
 *
 *    the expected value with perfect information minus the expected value of
 *    the best single action. It is an **upper bound**: no real study, test or
 *    consultant can be worth more, because none is better than certainty. It
 *    is 0 exactly when one action is already best in every state.
 *
 *  - **EVSI**, expected value of sample information, is the gain from an
 *    imperfect test. It is computed by preposterior analysis: for every signal
 *    the test could return, form the Bayesian posterior over states, take the
 *    best action under that posterior, and average over the marginal
 *    probability of the signals:
 *
 *        EVSI = Σ_z p(z)·max_a Σ_s p(s|z)·V(a,s)  −  max_a Σ_s p(s)·V(a,s)
 *
 *  - **EVIU**, expected value of including uncertainty, is the gain from
 *    treating the quantity as uncertain at all, rather than plugging in a
 *    single base-case number and optimising against it.
 *
 * All three obey 0 ≤ EVSI ≤ EVPI and 0 ≤ EVIU, and this module enforces those
 * identities rather than trusting them: a violation is a bug and is reported
 * as an error, never as a plausible number.
 *
 * The arithmetic is exact on a discrete problem. The probabilities themselves
 * are user assumptions, which every result states.
 */
import { EngineError, Validator } from '../core/result';
import { stableSum } from '../core/numeric';
import type { DecisionProblem, Provenance } from './types';
import { certaintyEquivalent, type UtilitySpec } from './utility';

export interface ValidatedProblem {
  actions: string[];
  states: string[];
  payoffs: number[][];
  priors: number[];
}

/** Validate a payoff matrix. `priors` are required only when requested. */
export function validateProblem(problem: DecisionProblem, requirePriors: boolean): ValidatedProblem {
  const v = new Validator();
  const { actions, states, payoffs } = problem;
  if (!actions?.length) v.add('A decision problem needs at least one action.', 'actions', 'required');
  if (!states?.length) v.add('A decision problem needs at least one state of nature.', 'states', 'required');
  v.throwIfInvalid();
  if (payoffs.length !== actions.length) {
    v.add(`The payoff matrix has ${payoffs.length} rows but there are ${actions.length} actions.`, 'payoffs', 'shape');
  }
  payoffs.forEach((row, i) => {
    if (!row || row.length !== states.length) {
      v.add(
        `Row ${i + 1} ("${actions[i] ?? i}") of the payoff matrix has ${row?.length ?? 0} entries but there are ${states.length} states.`,
        'payoffs',
        'shape',
      );
      return;
    }
    row.forEach((x, j) => {
      v.finite(x, `payoffs[${i}][${j}]`, `Payoff for "${actions[i]}" in state "${states[j]}"`);
    });
  });
  v.throwIfInvalid();

  let priors = problem.priors;
  if (priors === undefined) {
    if (requirePriors) {
      throw new EngineError(
        'This calculation needs a probability for every state of nature, and none were supplied. ' +
          'Probabilities must not be invented: if they are genuinely unknown, use the non-probabilistic criteria ' +
          '(maximin, maximax, Hurwicz, minimax regret, Laplace) instead, which say so in their output.',
        'required',
      );
    }
    priors = [];
  } else {
    if (priors.length !== states.length) {
      v.add(`There are ${priors.length} prior probabilities but ${states.length} states.`, 'priors', 'shape');
    }
    priors.forEach((p, j) => v.probability(p, `priors[${j}]`, `Prior probability of state "${states[j]}"`));
    v.throwIfInvalid();
    const total = stableSum(priors);
    if (Math.abs(total - 1) > 1e-9) {
      throw new EngineError(
        `The prior probabilities over the states sum to ${total}, not 1.`,
        'sum',
      );
    }
  }
  return { actions, states, payoffs, priors };
}

function valueOfAction(row: number[], probs: number[], spec: UtilitySpec): number {
  if (spec.kind === 'linear') {
    const terms = new Array<number>(probs.length);
    for (let j = 0; j < probs.length; j++) terms[j] = probs[j] * row[j];
    return stableSum(terms);
  }
  return certaintyEquivalent(
    { outcomes: probs.map((p, j) => ({ payoff: row[j], probability: p })) },
    spec,
  ).certaintyEquivalent;
}

export interface BestAction {
  index: number;
  label: string;
  value: number;
  /** Value of every action, in the same order as `actions`. */
  values: number[];
}

/** The best action under a given probability distribution over the states. */
export function bestAction(p: ValidatedProblem, probs: number[], spec: UtilitySpec = { kind: 'linear' }): BestAction {
  const values = p.payoffs.map((row) => valueOfAction(row, probs, spec));
  let index = 0;
  for (let i = 1; i < values.length; i++) if (values[i] > values[index]) index = i;
  return { index, label: p.actions[index], value: values[index], values };
}

const INFO_NOTES = [
  'EVPI and EVSI are upper bounds on what information is worth: they assume the information arrives before the decision and is used perfectly.',
  'EVPI ≥ EVSI ≥ 0 always. Any real study costs money and takes time, so the value computed here is a ceiling on what it can be worth, not a forecast of its benefit.',
];

export interface EvpiResult {
  /** Σ_s p(s)·max_a V(a,s) */
  expectedValueWithPerfectInformation: number;
  /** max_a Σ_s p(s)·V(a,s) */
  expectedValueBestAction: number;
  evpi: number;
  bestActionWithoutInformation: BestAction;
  /** The action perfect information would select in each state. */
  bestActionByState: { state: string; probability: number; action: string; payoff: number }[];
  /** True when one action is best in every state, in which case EVPI is exactly 0. */
  oneActionDominates: boolean;
  isUpperBound: true;
  provenance: Provenance;
  notes: string[];
}

/**
 * Expected value of perfect information on the state of nature: the most any
 * information about it could possibly be worth.
 */
export function expectedValueOfPerfectInformation(
  problem: DecisionProblem,
  spec: UtilitySpec = { kind: 'linear' },
): EvpiResult {
  const p = validateProblem(problem, true);
  const best = bestAction(p, p.priors, spec);

  const bestByState: { state: string; probability: number; action: string; payoff: number }[] = [];
  const bestPayoffRow = new Array<number>(p.states.length);
  for (let j = 0; j < p.states.length; j++) {
    let bi = 0;
    for (let i = 1; i < p.actions.length; i++) if (p.payoffs[i][j] > p.payoffs[bi][j]) bi = i;
    bestPayoffRow[j] = p.payoffs[bi][j];
    bestByState.push({ state: p.states[j], probability: p.priors[j], action: p.actions[bi], payoff: p.payoffs[bi][j] });
  }
  const evwpi = valueOfAction(bestPayoffRow, p.priors, spec);
  const raw = evwpi - best.value;
  if (raw < -1e-9 * Math.max(1, Math.abs(best.value))) {
    throw new EngineError(
      `Internal inconsistency: EVPI came out negative (${raw}). EVPI cannot be negative, so the inputs or the ` +
        'computation are inconsistent; no value is reported.',
      'inconsistent',
    );
  }
  const oneActionDominates = p.payoffs.some((row) => row.every((x, j) => x >= bestPayoffRow[j]));
  const evpi = raw > 0 ? raw : 0;

  return {
    expectedValueWithPerfectInformation: evwpi,
    expectedValueBestAction: best.value,
    evpi,
    bestActionWithoutInformation: best,
    bestActionByState: bestByState,
    oneActionDominates,
    isUpperBound: true,
    provenance: {
      exactness: 'exact',
      assumedInputs: ['The prior probabilities over the states of nature are user assumptions.'],
      regime: 'probabilities-given',
    },
    notes: [
      'EVPI = (expected value with perfect information) − (expected value of the best single action).',
      ...INFO_NOTES,
      ...(oneActionDominates
        ? ['One action is at least as good as every other in every state, so no information can change the decision and EVPI is exactly 0.']
        : []),
    ],
  };
}

/** P(signal | state) for every state. Rows are states, columns are signals. */
export interface TestInformation {
  label: string;
  signals: string[];
  /** likelihood[state][signal] = P(signal | state); each row sums to 1. */
  likelihood: number[][];
}

/**
 * Build a 2-signal likelihood matrix from a test's sensitivity and
 * specificity. Sensitivity is P(positive | the named state holds);
 * specificity is P(negative | it does not).
 */
export function testFromSensitivitySpecificity(options: {
  sensitivity: number;
  specificity: number;
  /** Index of the state the test is positive for. */
  positiveStateIndex: number;
  stateCount: number;
  label?: string;
  signalLabels?: [string, string];
}): TestInformation {
  const v = new Validator();
  v.probability(options.sensitivity, 'sensitivity', 'Sensitivity');
  v.probability(options.specificity, 'specificity', 'Specificity');
  v.integer(options.stateCount, 'stateCount', 'Number of states', 2);
  v.integer(options.positiveStateIndex, 'positiveStateIndex', 'Index of the positive state', 0, options.stateCount - 1);
  v.throwIfInvalid();
  const { sensitivity: sens, specificity: spec, positiveStateIndex: k, stateCount } = options;
  const likelihood: number[][] = [];
  for (let s = 0; s < stateCount; s++) {
    likelihood.push(s === k ? [sens, 1 - sens] : [1 - spec, spec]);
  }
  const [pos, neg] = options.signalLabels ?? ['Positive', 'Negative'];
  return { label: options.label ?? `Test (sensitivity ${sens}, specificity ${spec})`, signals: [pos, neg], likelihood };
}

export function validateTest(test: TestInformation, stateCount: number): TestInformation {
  const v = new Validator();
  if (!test.signals.length) v.add('A test must have at least one possible signal.', 'signals', 'required');
  if (test.likelihood.length !== stateCount) {
    v.add(
      `The likelihood matrix has ${test.likelihood.length} rows but there are ${stateCount} states; it needs one row of P(signal | state) per state.`,
      'likelihood',
      'shape',
    );
  }
  v.throwIfInvalid();
  test.likelihood.forEach((row, s) => {
    if (row.length !== test.signals.length) {
      v.add(`Row ${s + 1} of the likelihood matrix has ${row.length} entries but there are ${test.signals.length} signals.`, 'likelihood', 'shape');
      return;
    }
    row.forEach((x, z) => v.probability(x, `likelihood[${s}][${z}]`, `P(signal "${test.signals[z]}" | state ${s + 1})`));
  });
  v.throwIfInvalid();
  test.likelihood.forEach((row, s) => {
    const total = stableSum(row);
    if (Math.abs(total - 1) > 1e-9) {
      v.add(
        `Row ${s + 1} of the likelihood matrix sums to ${total}, not 1: P(signal | state) must be a distribution over the signals.`,
        'likelihood',
        'sum',
      );
    }
  });
  v.throwIfInvalid();
  return test;
}

export interface SignalAnalysis {
  signal: string;
  /** Marginal probability of seeing this signal. */
  probability: number;
  /** Posterior over the states after seeing it. */
  posterior: number[];
  bestAction: string;
  bestActionIndex: number;
  value: number;
}

export interface EvsiResult {
  testLabel: string;
  /** Σ_z p(z)·max_a Σ_s p(s|z)·V(a,s) */
  expectedValueWithSampleInformation: number;
  expectedValueBestAction: number;
  evsi: number;
  evpi: number;
  /** EVSI / EVPI: how much of the attainable information value this test captures. */
  efficiency: number | null;
  signals: SignalAnalysis[];
  /** True when the test never changes the action, in which case EVSI is exactly 0. */
  changesDecision: boolean;
  isUpperBound: true;
  provenance: Provenance;
  notes: string[];
}

/**
 * Expected value of sample information for an imperfect test, by Bayesian
 * preposterior analysis.
 *
 * Limits worth knowing, both of which this implementation reproduces exactly:
 * a test with sensitivity = specificity = 1 gives EVSI = EVPI, and a test
 * whose signal does not depend on the state (sensitivity = specificity = ½)
 * gives EVSI = 0.
 */
export function expectedValueOfSampleInformation(
  problem: DecisionProblem,
  test: TestInformation,
  spec: UtilitySpec = { kind: 'linear' },
): EvsiResult {
  const p = validateProblem(problem, true);
  validateTest(test, p.states.length);
  const perfect = expectedValueOfPerfectInformation(problem, spec);
  const base = perfect.expectedValueBestAction;

  const signals: SignalAnalysis[] = [];
  const terms: number[] = [];
  for (let z = 0; z < test.signals.length; z++) {
    const joint = p.priors.map((pr, s) => pr * test.likelihood[s][z]);
    const marginal = stableSum(joint);
    if (marginal <= 0) {
      signals.push({
        signal: test.signals[z],
        probability: 0,
        posterior: p.priors.map(() => 0),
        bestAction: perfect.bestActionWithoutInformation.label,
        bestActionIndex: perfect.bestActionWithoutInformation.index,
        value: base,
      });
      continue;
    }
    const posterior = joint.map((x) => x / marginal);
    const best = bestAction(p, posterior, spec);
    signals.push({
      signal: test.signals[z],
      probability: marginal,
      posterior,
      bestAction: best.label,
      bestActionIndex: best.index,
      value: best.value,
    });
    terms.push(marginal * best.value);
  }
  const evwsi = stableSum(terms);
  const raw = evwsi - base;
  if (raw < -1e-9 * Math.max(1, Math.abs(base))) {
    throw new EngineError(
      `Internal inconsistency: EVSI came out negative (${raw}). Information cannot have negative value under ` +
        'expected-value maximisation, so no value is reported.',
      'inconsistent',
    );
  }
  if (raw > perfect.evpi + 1e-9 * Math.max(1, Math.abs(base))) {
    throw new EngineError(
      `Internal inconsistency: EVSI (${raw}) exceeds EVPI (${perfect.evpi}). Sample information cannot be worth ` +
        'more than certainty, so no value is reported.',
      'inconsistent',
    );
  }
  const evsi = raw > 0 ? Math.min(raw, perfect.evpi) : 0;
  const changesDecision = signals.some(
    (s) => s.probability > 0 && s.bestActionIndex !== perfect.bestActionWithoutInformation.index,
  );

  return {
    testLabel: test.label,
    expectedValueWithSampleInformation: evwsi,
    expectedValueBestAction: base,
    evsi,
    evpi: perfect.evpi,
    efficiency: perfect.evpi > 0 ? evsi / perfect.evpi : null,
    signals,
    changesDecision,
    isUpperBound: true,
    provenance: {
      exactness: 'exact',
      assumedInputs: [
        'The prior probabilities over the states of nature are user assumptions.',
        "The test's sensitivity and specificity (or likelihood matrix) are user assumptions.",
      ],
      regime: 'probabilities-given',
    },
    notes: [
      'Preposterior analysis: Bayes rule for every possible signal, best action under each posterior, averaged over the marginal signal probabilities.',
      ...INFO_NOTES,
      'EVSI is the value of the information only. The cost of the test must be subtracted separately to decide whether to run it.',
      ...(changesDecision
        ? []
        : ['This test never changes the chosen action, so its information value is exactly 0 whatever it costs.']),
    ],
  };
}

export interface EviuResult {
  /** Best action accounting for the uncertainty. */
  bestUnderUncertainty: BestAction;
  /** The action chosen by optimising against a single base-case state. */
  deterministicAction: { index: number; label: string; baseState: string };
  /** True expected value of that deterministic choice. */
  expectedValueOfDeterministicChoice: number;
  eviu: number;
  provenance: Provenance;
  notes: string[];
}

/**
 * Expected value of including uncertainty: what is gained by treating the
 * quantity as uncertain instead of replacing it with a single base case and
 * optimising against that. EVIU ≥ 0, and it is 0 exactly when the base-case
 * optimisation happens to pick the same action.
 *
 * The base case is either a state index given explicitly, or — when numeric
 * values are attached to the states — the state closest to their
 * probability-weighted mean. This is the "plug in the average" practice whose
 * cost EVIU measures.
 */
export function expectedValueOfIncludingUncertainty(
  problem: DecisionProblem,
  options: { baseStateIndex?: number; stateValues?: number[] } = {},
  spec: UtilitySpec = { kind: 'linear' },
): EviuResult {
  const p = validateProblem(problem, true);
  let baseIndex: number;
  if (options.baseStateIndex !== undefined) {
    const v = new Validator();
    v.integer(options.baseStateIndex, 'baseStateIndex', 'Base-case state index', 0, p.states.length - 1);
    v.throwIfInvalid();
    baseIndex = options.baseStateIndex;
  } else if (options.stateValues) {
    const vals = options.stateValues;
    const v = new Validator();
    if (vals.length !== p.states.length) {
      v.add(`There are ${vals.length} state values but ${p.states.length} states.`, 'stateValues', 'shape');
    }
    v.throwIfInvalid();
    vals.forEach((x, j) => v.finite(x, `stateValues[${j}]`, `Value of state "${p.states[j]}"`));
    v.throwIfInvalid();
    const mean = stableSum(vals.map((x, j) => x * p.priors[j]));
    baseIndex = 0;
    let bestGap = Infinity;
    vals.forEach((x, j) => {
      const gap = Math.abs(x - mean);
      if (gap < bestGap) {
        bestGap = gap;
        baseIndex = j;
      }
    });
  } else {
    throw new EngineError(
      'EVIU needs to know which single number the base case uses: supply either a base-case state index or a ' +
        'numeric value per state so the base case can be identified. It will not be guessed.',
      'required',
    );
  }

  const bestUnderUncertainty = bestAction(p, p.priors, spec);
  // Optimise against the base case alone: probability 1 on that state.
  const degenerate = p.states.map((_s, j) => (j === baseIndex ? 1 : 0));
  const detChoice = bestAction(p, degenerate, spec);
  const detValue = valueOfAction(p.payoffs[detChoice.index], p.priors, spec);
  const raw = bestUnderUncertainty.value - detValue;
  if (raw < -1e-9 * Math.max(1, Math.abs(detValue))) {
    throw new EngineError(
      `Internal inconsistency: EVIU came out negative (${raw}), which is impossible because the uncertainty-aware ` +
        'choice maximises the same objective. No value is reported.',
      'inconsistent',
    );
  }
  return {
    bestUnderUncertainty,
    deterministicAction: { index: detChoice.index, label: detChoice.label, baseState: p.states[baseIndex] },
    expectedValueOfDeterministicChoice: detValue,
    eviu: raw > 0 ? raw : 0,
    provenance: {
      exactness: 'exact',
      assumedInputs: ['The prior probabilities over the states of nature are user assumptions.'],
      regime: 'probabilities-given',
    },
    notes: [
      'EVIU = (value of the best action under the full distribution) − (value of the action chosen by optimising against the base case).',
      'It is 0 when the base case happens to select the same action; that does not mean the uncertainty is harmless, only that it does not change this decision.',
      'EVIU is not the value of information: it is the cost of the modelling shortcut of replacing a distribution by one number.',
    ],
  };
}
