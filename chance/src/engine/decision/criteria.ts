/**
 * Decisions without probabilities.
 *
 * Sometimes the probabilities genuinely are not known — not "hard to
 * estimate", but unknown. Inventing them would hide the fact, so this module
 * offers the classical non-probabilistic criteria instead. Each one encodes an
 * *attitude*, and they disagree with one another on purpose:
 *
 *  - **Maximin** (Wald): the best worst case. Encodes extreme pessimism; it
 *    ignores everything but the worst column of each row.
 *  - **Maximax**: the best best case. Encodes extreme optimism; it ignores
 *    everything but the best column.
 *  - **Hurwicz α**: α·best + (1 − α)·worst, interpolating between the two.
 *    α is a declared degree of optimism, not a probability.
 *  - **Minimax regret** (Savage): minimise the largest opportunity loss
 *    relative to what the best action in that state would have earned.
 *    Encodes aversion to hindsight.
 *  - **Laplace** (insufficient reason): treat the states as equally likely.
 *    This one does assume a probability — a uniform one — and is labelled as
 *    such, because "no information" and "equal probabilities" are different
 *    statements.
 *
 * Which criterion to use is a value judgement, not a calculation. When they
 * disagree, the result says so and names the disagreement rather than
 * presenting one of them as "the" answer.
 */
import { Validator } from '../core/result';
import { stableSum } from '../core/numeric';
import type { DecisionProblem, Provenance } from './types';
import { validateProblem } from './information';

export type CriterionId = 'maximin' | 'maximax' | 'hurwicz' | 'minimax-regret' | 'laplace';

export interface CriterionResult {
  criterion: CriterionId;
  name: string;
  /** The attitude the criterion encodes, stated plainly. */
  attitude: string;
  /** Score per action, in the order of `actions`. */
  scores: number[];
  /** Index of the chosen action; ties list every index in `tiedWith`. */
  chosenIndex: number;
  chosenAction: string;
  tiedWith: number[];
  /** Whether the score is maximised or minimised. */
  objective: 'maximise' | 'minimise';
  notes: string[];
}

export interface RegretMatrix {
  states: string[];
  actions: string[];
  /** regret[action][state] = max over actions of payoff in that state − this payoff. */
  regret: number[][];
  /** Largest regret per action. */
  maxRegret: number[];
  /** The best payoff attainable in each state. */
  bestByState: number[];
  notes: string[];
}

/** Opportunity loss of every action in every state. */
export function regretMatrix(problem: DecisionProblem): RegretMatrix {
  const p = validateProblem(problem, false);
  const bestByState = p.states.map((_s, j) => {
    let best = -Infinity;
    for (let i = 0; i < p.actions.length; i++) if (p.payoffs[i][j] > best) best = p.payoffs[i][j];
    return best;
  });
  const regret = p.payoffs.map((row) => row.map((x, j) => bestByState[j] - x));
  return {
    states: p.states,
    actions: p.actions,
    regret,
    maxRegret: regret.map((row) => Math.max(...row)),
    bestByState,
    notes: [
      'Regret is measured against the best action *in that state*, so it is hindsight loss, not loss relative to a forecast.',
      'Regret is not invariant to adding or removing an action: a new action can change the best payoff in a state and therefore every regret in that column.',
    ],
  };
}

function pick(scores: number[], actions: string[], objective: 'maximise' | 'minimise'): {
  chosenIndex: number;
  chosenAction: string;
  tiedWith: number[];
} {
  let bestIdx = 0;
  for (let i = 1; i < scores.length; i++) {
    const better = objective === 'maximise' ? scores[i] > scores[bestIdx] : scores[i] < scores[bestIdx];
    if (better) bestIdx = i;
  }
  const tiedWith = scores
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => Math.abs(s - scores[bestIdx]) <= 1e-12)
    .map(({ i }) => i);
  return { chosenIndex: bestIdx, chosenAction: actions[bestIdx], tiedWith };
}

export interface NoProbabilityResult {
  actions: string[];
  states: string[];
  results: CriterionResult[];
  regret: RegretMatrix;
  /** True when every criterion picks the same action. */
  criteriaAgree: boolean;
  /** Distinct actions chosen across the criteria. */
  chosenActions: string[];
  /** The plain statement that these criteria need not agree. */
  statement: string;
  hurwiczAlpha: number;
  provenance: Provenance;
  notes: string[];
}

/**
 * Apply all five non-probabilistic criteria to a payoff matrix.
 *
 * `hurwiczAlpha` is the declared degree of optimism in [0, 1]: α = 0 reproduces
 * maximin and α = 1 reproduces maximax. It is not a probability of anything.
 */
export function decideWithoutProbabilities(
  problem: DecisionProblem,
  options: { hurwiczAlpha?: number } = {},
): NoProbabilityResult {
  const p = validateProblem(problem, false);
  const alpha = options.hurwiczAlpha ?? 0.5;
  const v = new Validator();
  v.range(alpha, 'hurwiczAlpha', 'Hurwicz optimism α', 0, 1);
  v.throwIfInvalid();

  const worst = p.payoffs.map((row) => Math.min(...row));
  const best = p.payoffs.map((row) => Math.max(...row));
  const regret = regretMatrix(problem);
  const nStates = p.states.length;

  const results: CriterionResult[] = [
    {
      criterion: 'maximin',
      name: 'Maximin (Wald)',
      attitude: 'Extreme pessimism: judge each action only by its worst possible outcome.',
      scores: worst,
      objective: 'maximise',
      ...pick(worst, p.actions, 'maximise'),
      notes: ['Ignores how good an action can be; an action with an excellent upside and one bad state scores badly.'],
    },
    {
      criterion: 'maximax',
      name: 'Maximax',
      attitude: 'Extreme optimism: judge each action only by its best possible outcome.',
      scores: best,
      objective: 'maximise',
      ...pick(best, p.actions, 'maximise'),
      notes: ['Ignores downside entirely; it will choose a ruinous action for a small chance of the best payoff.'],
    },
    {
      criterion: 'hurwicz',
      name: `Hurwicz α-criterion (α = ${alpha})`,
      attitude: `A declared degree of optimism α = ${alpha}: score = α·best + (1 − α)·worst. α is a stated attitude, not a probability.`,
      scores: p.actions.map((_a, i) => alpha * best[i] + (1 - alpha) * worst[i]),
      objective: 'maximise',
      ...pick(
        p.actions.map((_a, i) => alpha * best[i] + (1 - alpha) * worst[i]),
        p.actions,
        'maximise',
      ),
      notes: ['Uses only the two extreme outcomes of each action; everything in between is discarded.'],
    },
    {
      criterion: 'minimax-regret',
      name: 'Minimax regret (Savage)',
      attitude: 'Aversion to hindsight: minimise the largest opportunity loss you could look back on.',
      scores: regret.maxRegret,
      objective: 'minimise',
      ...pick(regret.maxRegret, p.actions, 'minimise'),
      notes: [
        'Depends on which other actions are on the table: adding an irrelevant alternative can change the choice.',
      ],
    },
    {
      criterion: 'laplace',
      name: 'Laplace (principle of insufficient reason)',
      attitude: 'Treat the states as equally likely. This assumes a uniform probability — it is not the same as having no probabilities.',
      scores: p.payoffs.map((row) => stableSum(row) / nStates),
      objective: 'maximise',
      ...pick(
        p.payoffs.map((row) => stableSum(row) / nStates),
        p.actions,
        'maximise',
      ),
      notes: [
        'The uniform prior is a real assumption and depends on how the states were carved up: splitting one state into two changes the answer.',
      ],
    },
  ];

  const chosen = [...new Set(results.map((r) => r.chosenAction))];
  const agree = chosen.length === 1;
  const statement = agree
    ? `All five criteria choose "${chosen[0]}". That agreement is a strong signal, but it is not a proof: each criterion is still a value judgement, not a calculation.`
    : `These criteria DISAGREE: ${results
        .map((r) => `${r.name} → "${r.chosenAction}"`)
        .join('; ')}. There is no computation that resolves the disagreement. Choosing among maximin, maximax, Hurwicz, minimax regret and Laplace is a value judgement about how much weight to give the worst case, the best case and hindsight. The engine will not pick one for you.`;

  return {
    actions: p.actions,
    states: p.states,
    results,
    regret,
    criteriaAgree: agree,
    chosenActions: chosen,
    statement,
    hurwiczAlpha: alpha,
    provenance: {
      exactness: 'exact',
      assumedInputs: ['The payoffs are user estimates. No probabilities are assumed or implied, except by the Laplace criterion, which is labelled.'],
      regime: 'no-probabilities',
    },
    notes: [
      'This is the no-probability regime: no probability over the states of nature was supplied and none has been invented.',
      'If probabilities can honestly be stated, expected value or expected utility uses strictly more information than any of these criteria.',
      'The Laplace criterion is the one exception: it assumes a uniform distribution, which is an assumption and is reported as one.',
    ],
  };
}
