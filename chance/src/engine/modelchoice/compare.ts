/**
 * Pairwise and set-wise comparison of elpd estimates.
 *
 * The standard error of a difference is NOT the difference, or the sum, of the
 * individual standard errors. Two models fitted to the same observations make
 * correlated errors: the same hard observations are hard for both. The correct
 * standard error comes from the PAIRED pointwise differences, and it is
 * typically much smaller than the independent-models formula, which is why
 * using the wrong one both overstates the uncertainty of the comparison and
 * hides how much of the apparent difference is shared structure.
 */
import { EngineError, type Explanation } from '../core/result';
import type { ComparisonVerdict, ElpdDifference, ElpdEstimate } from './types';
import { MODEL_SET_CAVEAT } from './types';

/** |difference| / se below which two models are called indistinguishable. */
export const INDISTINGUISHABLE_Z = 2;
/** Between this and INDISTINGUISHABLE_Z the preference is called weak. */
export const WEAK_Z = 4;

/**
 * Difference in elpd between two models, with the standard error of the
 * difference computed from the paired pointwise terms.
 */
export function elpdDifference(a: ElpdEstimate, b: ElpdEstimate): ElpdDifference {
  if (a.pointwise.length !== b.pointwise.length) {
    throw new EngineError(
      `"${a.name}" has ${a.pointwise.length} pointwise terms and "${b.name}" has ${b.pointwise.length}. A paired difference requires the same observations in the same order.`,
      'shape',
    );
  }
  if (a.name === b.name) {
    throw new EngineError(`Cannot compare model "${a.name}" with itself.`, 'invalid');
  }
  const n = a.pointwise.length;
  if (n < 2) {
    throw new EngineError('The standard error of a difference needs at least 2 observations.', 'insufficient');
  }
  const better = a.elpd >= b.elpd ? a : b;
  const worse = a.elpd >= b.elpd ? b : a;
  const d = new Array<number>(n);
  for (let i = 0; i < n; i++) d[i] = better.pointwise[i] - worse.pointwise[i];
  let mean = 0;
  for (const v of d) mean += v / n;
  let varSum = 0;
  for (const v of d) varSum += (v - mean) * (v - mean);
  const se = Math.sqrt((n * varSum) / (n - 1));
  const naive = Math.sqrt(a.standardError * a.standardError + b.standardError * b.standardError);
  const difference = better.elpd - worse.elpd;
  const z = se > 0 ? difference / se : Infinity;
  const verdict: ComparisonVerdict = z < INDISTINGUISHABLE_Z ? 'indistinguishable' : z < WEAK_Z ? 'weak' : 'clear';
  const statement =
    verdict === 'indistinguishable'
      ? `"${better.name}" and "${worse.name}" cannot be separated on this data: the elpd difference is ${difference.toFixed(2)} with a standard error of ${se.toFixed(2)} (${z.toFixed(2)} standard errors). There is no winner here; report both, or average over them.`
      : verdict === 'weak'
        ? `"${better.name}" is ahead of "${worse.name}" by ${difference.toFixed(2)} ± ${se.toFixed(2)} (${z.toFixed(2)} standard errors). That is a weak preference, not a decision.`
        : `"${better.name}" predicts better than "${worse.name}" by ${difference.toFixed(2)} ± ${se.toFixed(2)} (${z.toFixed(2)} standard errors).`;
  return {
    better: better.name,
    worse: worse.name,
    difference,
    standardError: se,
    naiveStandardError: naive,
    zScore: z,
    verdict,
    statement,
  };
}

export interface ComparisonTable {
  /** Estimates sorted best first. */
  readonly ranked: readonly ElpdEstimate[];
  /** Difference of every model from the best, paired. */
  readonly differencesFromBest: readonly ElpdDifference[];
  /** All pairwise differences. */
  readonly allPairs: readonly ElpdDifference[];
  readonly best: string;
  /** Models that cannot be separated from the best one. */
  readonly tiedWithBest: readonly string[];
  readonly verdict: ComparisonVerdict;
  readonly statement: string;
  readonly explanation: Explanation;
  readonly warnings: readonly string[];
}

/** Rank a set of elpd estimates, with paired standard errors throughout. */
export function compareElpd(estimates: readonly ElpdEstimate[]): ComparisonTable {
  if (estimates.length === 0) {
    throw new EngineError('The model set is empty, so there is nothing to compare.', 'empty');
  }
  const ranked = [...estimates].sort((x, y) => y.elpd - x.elpd);
  const best = ranked[0];
  if (estimates.length === 1) {
    return {
      ranked,
      differencesFromBest: [],
      allPairs: [],
      best: best.name,
      tiedWithBest: [],
      verdict: 'indistinguishable',
      statement: `Only one model was supplied ("${best.name}"), so nothing was compared. Its elpd is ${best.elpd.toFixed(2)} ± ${best.standardError.toFixed(2)}, which is a statement about this model alone.`,
      explanation: singleExplanation(best),
      warnings: [MODEL_SET_CAVEAT],
    };
  }
  const differencesFromBest = ranked.slice(1).map((m) => elpdDifference(best, m));
  const allPairs: ElpdDifference[] = [];
  for (let i = 0; i < ranked.length; i++) {
    for (let j = i + 1; j < ranked.length; j++) allPairs.push(elpdDifference(ranked[i], ranked[j]));
  }
  const tied = differencesFromBest.filter((d) => d.verdict === 'indistinguishable').map((d) => d.worse);
  const verdict = differencesFromBest[0].verdict;
  const statement =
    tied.length === ranked.length - 1
      ? `No model in this set can be separated from the others: every elpd difference from "${best.name}" is within ${INDISTINGUISHABLE_Z} standard errors. Do not pick one; average over them, and report that the data does not distinguish these models.`
      : tied.length > 0
        ? `"${best.name}" has the highest elpd, but ${tied.map((t) => `"${t}"`).join(', ')} ${tied.length === 1 ? 'is' : 'are'} statistically indistinguishable from it. The remaining models are behind by more than ${INDISTINGUISHABLE_Z} standard errors.`
        : `"${best.name}" predicts better than every other model in the set by more than ${INDISTINGUISHABLE_Z} standard errors of the paired difference. ${differencesFromBest[0].statement}`;
  const warnings = [
    'The standard error of a difference is computed from the PAIRED pointwise differences. It is not the sum or the difference of the two models’ standard errors; because models fitted to the same data make correlated errors, the paired value is usually smaller and is the only correct one.',
    'A difference within about 2 of its own standard error is not a preference.',
    MODEL_SET_CAVEAT,
    ...new Set(estimates.flatMap((e) => e.warnings)),
  ];
  return {
    ranked,
    differencesFromBest,
    allPairs,
    best: best.name,
    tiedWithBest: tied,
    verdict,
    statement,
    explanation: {
      method: `Model comparison by ${best.method}`,
      formula: 'se(elpd_A − elpd_B) = sqrt( n · var_i( elpd_A,i − elpd_B,i ) )',
      steps: [
        ...ranked.map((m) => ({
          label: m.name,
          expression: `elpd = ${m.elpd.toFixed(3)} ± ${m.standardError.toFixed(3)}`,
          value: `${m.method === 'waic' ? 'WAIC' : m.method === 'psis-loo' ? 'LOOIC' : 'IC'} = ${m.informationCriterion.toFixed(3)}`,
        })),
        ...differencesFromBest.map((d) => ({
          label: `${d.better} − ${d.worse}`,
          expression: `Δelpd = ${d.difference.toFixed(3)} ± ${d.standardError.toFixed(3)} (paired); naive independent se would be ${d.naiveStandardError.toFixed(3)}`,
          value: d.verdict,
        })),
      ],
      assumptions: [
        'The models were evaluated on the same observations in the same order, so the pointwise terms can be paired.',
        'The pointwise terms are treated as a sample from the population of observations, which is what makes the standard error over observations meaningful.',
      ],
      limitations: warnings,
      exactness: best.exactness,
    },
    warnings,
  };
}

function singleExplanation(m: ElpdEstimate): Explanation {
  return {
    method: `Single-model ${m.method} estimate`,
    formula: 'elpd = Σ_i elpd_i,  se = sqrt(n · var_i(elpd_i))',
    steps: [
      { label: 'elpd', value: m.elpd.toPrecision(8) },
      { label: 'Standard error', value: m.standardError.toPrecision(6) },
    ],
    assumptions: ['Nothing is being compared; this is one model on its own.'],
    limitations: [MODEL_SET_CAVEAT, 'An elpd on its own has no scale. It only means something next to another model’s.'],
    exactness: m.exactness,
  };
}
