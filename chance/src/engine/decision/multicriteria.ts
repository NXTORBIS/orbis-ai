/**
 * Multi-criteria decisions.
 *
 * A weighted additive value model is the standard way to trade several
 * criteria off against each other: normalise each criterion onto a common
 * scale, weight the criteria, add. It is also the standard way to produce a
 * ranking that looks objective and is in fact an artefact of the
 * normalisation. Two honest choices of normalisation can reverse a ranking, so
 * every result here names the normalisation used and warns about it, and the
 * two outputs that do not depend on it are given alongside:
 *
 *  - the **Pareto frontier**, the options that no other option beats on every
 *    criterion at once. It needs no weights and no normalisation at all.
 *  - **weight sensitivity**, the range over which a criterion's weight can
 *    move before the recommendation changes. The score is linear in a single
 *    weight once the others are held in proportion, so the switching points
 *    are solved exactly rather than scanned.
 */
import { EngineError, Validator } from '../core/result';
import { stableSum } from '../core/numeric';
import type { Provenance } from './types';

export type CriterionDirection = 'benefit' | 'cost';
export type Normalisation = 'none' | 'max' | 'sum' | 'range';

export interface Criterion {
  key: string;
  label: string;
  /** Relative importance; weights are normalised to sum to 1. */
  weight: number;
  direction: CriterionDirection;
  unit?: string;
}

export interface MultiCriteriaOption {
  label: string;
  values: Record<string, number>;
}

export interface MultiCriteriaInput {
  criteria: Criterion[];
  options: MultiCriteriaOption[];
  normalisation?: Normalisation;
}

interface Prepared {
  criteria: Criterion[];
  options: MultiCriteriaOption[];
  normalisation: Normalisation;
  weights: number[];
  /** normalised[option][criterion], oriented so that higher is always better. */
  normalised: number[][];
  /** raw[option][criterion], oriented so that higher is always better. */
  oriented: number[][];
  warnings: string[];
}

const NORMALISATION_LABEL: Record<Normalisation, string> = {
  none: 'none (raw values used directly)',
  max: 'divide by the best value on the criterion',
  sum: 'divide by the sum of the values on the criterion',
  range: 'min–max rescaling onto [0, 1]',
};

function prepare(input: MultiCriteriaInput): Prepared {
  const v = new Validator();
  const { criteria, options } = input;
  if (!criteria?.length) v.add('A multi-criteria model needs at least one criterion.', 'criteria', 'required');
  if (!options?.length) v.add('A multi-criteria model needs at least one option.', 'options', 'required');
  v.throwIfInvalid();
  const keys = new Set<string>();
  criteria.forEach((c, i) => {
    if (keys.has(c.key)) v.add(`Duplicate criterion key "${c.key}".`, `criteria[${i}].key`, 'duplicate');
    keys.add(c.key);
    v.nonNegative(c.weight, `criteria[${i}].weight`, `Weight of criterion "${c.label}"`);
  });
  v.throwIfInvalid();
  const weightTotal = stableSum(criteria.map((c) => c.weight));
  if (!(weightTotal > 0)) {
    throw new EngineError('The criterion weights are all zero, so no ranking can be produced.', 'range');
  }
  const weights = criteria.map((c) => c.weight / weightTotal);
  options.forEach((o, i) => {
    criteria.forEach((c) => {
      const x = o.values[c.key];
      if (typeof x !== 'number' || !Number.isFinite(x)) {
        v.add(
          `Option "${o.label}" has no finite value for criterion "${c.label}" (key "${c.key}"). A missing criterion value will not be filled in with a guess.`,
          `options[${i}].values.${c.key}`,
          'required',
        );
      }
    });
  });
  v.throwIfInvalid();

  // Orient every criterion so that larger is better.
  const oriented = options.map((o) => criteria.map((c) => (c.direction === 'benefit' ? o.values[c.key] : -o.values[c.key])));

  const normalisation = input.normalisation ?? 'range';
  const warnings: string[] = [];
  const normalised = options.map(() => new Array<number>(criteria.length).fill(0));
  criteria.forEach((c, j) => {
    const column = oriented.map((row) => row[j]);
    const min = Math.min(...column);
    const max = Math.max(...column);
    if (max === min) {
      warnings.push(
        `Every option has the same value on criterion "${c.label}", so it cannot discriminate between them; it is scored equally for all and its weight has no effect on the ranking.`,
      );
      for (let i = 0; i < options.length; i++) normalised[i][j] = 1;
      return;
    }
    switch (normalisation) {
      case 'none':
        for (let i = 0; i < options.length; i++) normalised[i][j] = column[i];
        break;
      case 'range':
        for (let i = 0; i < options.length; i++) normalised[i][j] = (column[i] - min) / (max - min);
        break;
      case 'max': {
        const denominator = Math.max(...column.map(Math.abs));
        if (!(denominator > 0)) {
          throw new EngineError(
            `The "max" normalisation cannot be applied to criterion "${c.label}" because every value is 0.`,
            'range',
          );
        }
        for (let i = 0; i < options.length; i++) normalised[i][j] = column[i] / denominator;
        break;
      }
      case 'sum': {
        const denominator = stableSum(column.map(Math.abs));
        if (!(denominator > 0)) {
          throw new EngineError(
            `The "sum" normalisation cannot be applied to criterion "${c.label}" because the values sum to 0.`,
            'range',
          );
        }
        for (let i = 0; i < options.length; i++) normalised[i][j] = column[i] / denominator;
        break;
      }
    }
  });
  return { criteria, options, normalisation, weights, normalised, oriented, warnings };
}

export interface ScoredOption {
  label: string;
  score: number;
  rank: number;
  /** Weighted contribution of each criterion to the score. */
  contributions: { key: string; label: string; normalisedValue: number; weight: number; contribution: number }[];
  onParetoFrontier: boolean;
}

export interface MultiCriteriaResult {
  normalisation: Normalisation;
  normalisationLabel: string;
  weights: { key: string; label: string; weight: number }[];
  options: ScoredOption[];
  recommended: string;
  /** Options that nothing dominates on every criterion. Needs no weights. */
  paretoFrontier: string[];
  dominated: { option: string; dominatedBy: string[] }[];
  provenance: Provenance;
  warnings: string[];
  notes: string[];
}

/**
 * Identify the Pareto frontier: the options that no other option is at least
 * as good as on every criterion and strictly better on at least one.
 *
 * Options that are exactly equal on every criterion do not dominate each
 * other — neither is strictly better anywhere — so both stay on the frontier.
 * This is deliberate: a duplicate is not evidence against either copy.
 */
export function paretoFrontier(input: MultiCriteriaInput): {
  frontier: string[];
  frontierIndices: number[];
  dominated: { option: string; dominatedBy: string[] }[];
  notes: string[];
} {
  const p = prepare(input);
  const m = p.criteria.length;
  const frontierIndices: number[] = [];
  const dominated: { option: string; dominatedBy: string[] }[] = [];
  for (let i = 0; i < p.options.length; i++) {
    const dominatedBy: string[] = [];
    for (let k = 0; k < p.options.length; k++) {
      if (k === i) continue;
      let allAtLeast = true;
      let oneStrict = false;
      for (let j = 0; j < m; j++) {
        if (p.oriented[k][j] < p.oriented[i][j]) {
          allAtLeast = false;
          break;
        }
        if (p.oriented[k][j] > p.oriented[i][j]) oneStrict = true;
      }
      if (allAtLeast && oneStrict) dominatedBy.push(p.options[k].label);
    }
    if (dominatedBy.length) dominated.push({ option: p.options[i].label, dominatedBy });
    else frontierIndices.push(i);
  }
  return {
    frontier: frontierIndices.map((i) => p.options[i].label),
    frontierIndices,
    dominated,
    notes: [
      'The frontier uses the raw criterion values only. It needs no weights and no normalisation, so it cannot be an artefact of either.',
      'Options that tie on every criterion both remain on the frontier, because neither is strictly better than the other anywhere.',
      'Being on the frontier does not make an option good; it means no other option on the table beats it outright.',
    ],
  };
}

/** Weighted additive value model, with the Pareto frontier alongside it. */
export function weightedAdditiveValue(input: MultiCriteriaInput): MultiCriteriaResult {
  const p = prepare(input);
  const pareto = paretoFrontier(input);
  const scores = p.options.map((_o, i) => stableSum(p.criteria.map((_c, j) => p.weights[j] * p.normalised[i][j])));
  const order = scores
    .map((s, i) => ({ s, i }))
    .sort((a, b) => b.s - a.s)
    .map(({ i }) => i);
  const rank = new Array<number>(p.options.length).fill(0);
  order.forEach((i, r) => {
    rank[i] = r + 1;
  });
  const options: ScoredOption[] = p.options.map((o, i) => ({
    label: o.label,
    score: scores[i],
    rank: rank[i],
    contributions: p.criteria.map((c, j) => ({
      key: c.key,
      label: c.label,
      normalisedValue: p.normalised[i][j],
      weight: p.weights[j],
      contribution: p.weights[j] * p.normalised[i][j],
    })),
    onParetoFrontier: pareto.frontierIndices.includes(i),
  }));

  return {
    normalisation: p.normalisation,
    normalisationLabel: NORMALISATION_LABEL[p.normalisation],
    weights: p.criteria.map((c, j) => ({ key: c.key, label: c.label, weight: p.weights[j] })),
    options,
    recommended: p.options[order[0]].label,
    paretoFrontier: pareto.frontier,
    dominated: pareto.dominated,
    provenance: {
      exactness: 'exact',
      assumedInputs: [
        'The criterion weights are a statement of preference, not a measurement.',
        'The criterion values are user estimates.',
      ],
      regime: 'probabilities-given',
    },
    warnings: [
      `Normalisation used: ${NORMALISATION_LABEL[p.normalisation]}. THE NORMALISATION CAN CHANGE THE RANKING. ` +
        'Min–max rescaling stretches whichever criterion happens to have the narrowest spread among the options on the table, ' +
        'so adding or removing an option can reorder the rest. Dividing by the maximum or the sum keeps ratios but gives options ' +
        'with values far from zero a compressed spread. Re-run with another normalisation before trusting a close ranking.',
      'A weighted sum also assumes the criteria are mutually independent in value and that trade-offs are constant. Where that is wrong, the score is not meaningful even if the arithmetic is right.',
      ...p.warnings,
    ],
    notes: [
      'The Pareto frontier and the weight sensitivity are the parts of this analysis that do not depend on the normalisation.',
      ...pareto.notes,
    ],
  };
}

export interface WeightSensitivityResult {
  criterionKey: string;
  criterionLabel: string;
  /** The weight currently given to this criterion (after normalisation to 1). */
  currentWeight: number;
  currentRecommendation: string;
  /** Range of this criterion's weight over which the recommendation is unchanged. */
  stableRange: { lower: number; upper: number };
  /** Weight values at which the top-ranked option changes, with the new winner. */
  switchingPoints: { weight: number; from: string; to: string }[];
  /** True when no weight in [0, 1] changes the recommendation. */
  alwaysSame: boolean;
  provenance: Provenance;
  notes: string[];
}

/**
 * Over what range of one criterion's weight does the recommendation stay the
 * same?
 *
 * The other criteria keep their relative proportions and share the remaining
 * weight 1 − w, so each option's score is exactly linear in w:
 *
 *     score_i(w) = (1 − w)·S_i + w·v_ik
 *
 * where S_i is option i's score on the other criteria alone (renormalised) and
 * v_ik its normalised value on criterion k. Crossings are therefore solved in
 * closed form, not scanned on a grid.
 */
export function weightSensitivity(input: MultiCriteriaInput, criterionKey: string): WeightSensitivityResult {
  const p = prepare(input);
  const k = p.criteria.findIndex((c) => c.key === criterionKey);
  if (k < 0) {
    throw new EngineError(
      `There is no criterion with key "${criterionKey}" in this model.`,
      'unknown',
    );
  }
  const others = p.criteria.map((_c, j) => j).filter((j) => j !== k);
  const otherTotal = stableSum(others.map((j) => p.weights[j]));
  const base = p.options.map((_o, i) =>
    otherTotal > 0 ? stableSum(others.map((j) => (p.weights[j] / otherTotal) * p.normalised[i][j])) : 0,
  );
  const vk = p.options.map((_o, i) => p.normalised[i][k]);
  const scoreAt = (i: number, w: number) => (1 - w) * base[i] + w * vk[i];
  const winnerAt = (w: number) => {
    let bestI = 0;
    for (let i = 1; i < p.options.length; i++) if (scoreAt(i, w) > scoreAt(bestI, w)) bestI = i;
    return bestI;
  };

  const currentWeight = p.weights[k];
  const currentWinner = winnerAt(currentWeight);

  // Collect every pairwise crossing in [0, 1].
  const crossings = new Set<number>([0, 1]);
  for (let i = 0; i < p.options.length; i++) {
    for (let j = i + 1; j < p.options.length; j++) {
      const a = base[i] - base[j];
      const b = vk[i] - vk[j];
      const denominator = a - b;
      if (Math.abs(denominator) < 1e-15) continue;
      const w = a / denominator;
      if (w > 0 && w < 1) crossings.add(w);
    }
  }
  const sorted = [...crossings].sort((x, y) => x - y);
  // Segment [sorted[i], sorted[i+1]] has a single winner; probe its midpoint.
  const segments = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    segments.push({ lo: sorted[i], hi: sorted[i + 1], winner: winnerAt((sorted[i] + sorted[i + 1]) / 2) });
  }
  const switchingPoints: { weight: number; from: string; to: string }[] = [];
  for (let i = 0; i + 1 < segments.length; i++) {
    if (segments[i].winner !== segments[i + 1].winner) {
      switchingPoints.push({
        weight: segments[i].hi,
        from: p.options[segments[i].winner].label,
        to: p.options[segments[i + 1].winner].label,
      });
    }
  }
  let here = segments.findIndex((s2) => currentWeight >= s2.lo && currentWeight <= s2.hi && s2.winner === currentWinner);
  if (here < 0) here = segments.findIndex((s2) => s2.winner === currentWinner);
  let lower = 0;
  let upper = 1;
  if (here >= 0) {
    let a = here;
    let b = here;
    while (a > 0 && segments[a - 1].winner === currentWinner) a--;
    while (b + 1 < segments.length && segments[b + 1].winner === currentWinner) b++;
    lower = segments[a].lo;
    upper = segments[b].hi;
  }

  const alwaysSame = lower === 0 && upper === 1 && switchingPoints.length === 0;
  return {
    criterionKey,
    criterionLabel: p.criteria[k].label,
    currentWeight,
    currentRecommendation: p.options[currentWinner].label,
    stableRange: { lower, upper },
    switchingPoints,
    alwaysSame,
    provenance: {
      exactness: 'exact',
      assumedInputs: ['The weights of the other criteria keep their stated proportions as this weight varies.'],
      regime: 'probabilities-given',
    },
    notes: [
      alwaysSame
        ? `The recommendation is "${p.options[currentWinner].label}" for every weight on "${p.criteria[k].label}" between 0 and 1: on this criterion the recommendation is as robust as it can be.`
        : `The recommendation stays "${p.options[currentWinner].label}" while the weight on "${p.criteria[k].label}" is between ${lower} and ${upper} (it is currently ${currentWeight}).`,
      'The crossings are exact: each option\'s score is linear in this one weight once the others keep their proportions.',
      'A narrow stable range means the recommendation is an artefact of the weight, not of the options.',
    ],
  };
}
