/**
 * Multiplicity corrections.
 *
 * Twenty independent tests at the 5% level produce a false positive 64% of the
 * time. Any family of comparisons therefore needs either family-wise error
 * control (Bonferroni, Holm, Hochberg) or false-discovery-rate control
 * (Benjamini–Hochberg, Benjamini–Yekutieli), and the result must say which.
 *
 * Every method here returns adjusted p-values that are monotone in the
 * original ordering, so comparing two adjusted values never reverses the
 * comparison of the raw ones.
 */
import { EngineError } from '../core/result';
import { benjaminiHochberg } from '../stats/tests';

export type MultiplicityMethod =
  | 'bonferroni'
  | 'holm'
  | 'hochberg'
  | 'benjamini-hochberg'
  | 'benjamini-yekutieli';

export interface MultiplicityResult {
  method: MultiplicityMethod;
  /** What the method controls, in words. */
  controls: string;
  level: number;
  pValues: number[];
  adjusted: number[];
  rejected: boolean[];
  rejectedCount: number;
  notes: string[];
}

export const MULTIPLICITY_DESCRIPTIONS: Record<MultiplicityMethod, string> = {
  bonferroni:
    'the family-wise error rate (the chance of at least one false rejection), under any dependence between the tests. It is the most conservative choice.',
  holm: 'the family-wise error rate, under any dependence. It is uniformly at least as powerful as Bonferroni, so there is no reason to prefer Bonferroni over it.',
  hochberg:
    'the family-wise error rate, but only when the test statistics are independent or positively dependent. It is slightly more powerful than Holm under those conditions.',
  'benjamini-hochberg':
    'the false discovery rate — the expected share of false positives among the rejected hypotheses — for independent or positively dependent tests. It rejects more hypotheses than family-wise methods and makes a weaker promise.',
  'benjamini-yekutieli': 'the false discovery rate under arbitrary dependence, at the cost of a log-factor penalty.',
};

function validate(pValues: number[]): void {
  if (!pValues.length) throw new EngineError('No p-values were supplied to adjust.', 'empty');
  for (const p of pValues) {
    if (!Number.isFinite(p) || p < 0 || p > 1) {
      throw new EngineError(`"${p}" is not a valid p-value; every entry must be a number between 0 and 1.`, 'range');
    }
  }
}

/** Adjusted p-values for one of the five methods. */
export function adjustPValues(
  pValues: number[],
  method: MultiplicityMethod = 'holm',
  level = 0.05,
): MultiplicityResult {
  validate(pValues);
  const m = pValues.length;
  const order = pValues.map((p, i) => ({ p, i })).sort((x, y) => x.p - y.p);
  const adjusted = new Array<number>(m).fill(NaN);
  switch (method) {
    case 'bonferroni':
      for (let i = 0; i < m; i++) adjusted[i] = Math.min(1, pValues[i] * m);
      break;
    case 'holm': {
      // Step-down: (m − rank + 1)·p, then a running maximum so the sequence
      // is monotone in the sorted order.
      let running = 0;
      for (let rank = 0; rank < m; rank++) {
        const value = (m - rank) * order[rank].p;
        running = Math.max(running, value);
        adjusted[order[rank].i] = Math.min(1, running);
      }
      break;
    }
    case 'hochberg': {
      // Step-up: a running minimum from the largest p downwards.
      let running = Infinity;
      for (let rank = m - 1; rank >= 0; rank--) {
        const value = (m - rank) * order[rank].p;
        running = Math.min(running, value);
        adjusted[order[rank].i] = Math.min(1, running);
      }
      break;
    }
    case 'benjamini-hochberg': {
      const bh = benjaminiHochberg(pValues);
      for (let i = 0; i < m; i++) adjusted[i] = bh[i];
      break;
    }
    case 'benjamini-yekutieli': {
      let harmonic = 0;
      for (let i = 1; i <= m; i++) harmonic += 1 / i;
      const bh = benjaminiHochberg(pValues);
      for (let i = 0; i < m; i++) adjusted[i] = Math.min(1, bh[i] * harmonic);
      break;
    }
  }
  const rejected = adjusted.map((p) => p < level);
  return {
    method,
    controls: MULTIPLICITY_DESCRIPTIONS[method],
    level,
    pValues: [...pValues],
    adjusted,
    rejected,
    rejectedCount: rejected.filter(Boolean).length,
    notes: [
      `${m} hypothesis/hypotheses adjusted by the ${method} method, which controls ${MULTIPLICITY_DESCRIPTIONS[method]}`,
      `Rejected at the ${level} level: ${rejected.filter(Boolean).length} of ${m}.`,
      `Without any adjustment, ${pValues.filter((p) => p < level).length} of ${m} would be called significant; the probability of at least one false positive among ${m} independent true nulls at level ${level} is ${(1 - (1 - level) ** m).toPrecision(3)}.`,
    ],
  };
}

/** All five methods side by side, so the cost of each choice is visible. */
export function compareAdjustments(pValues: number[], level = 0.05): MultiplicityResult[] {
  return (['bonferroni', 'holm', 'hochberg', 'benjamini-hochberg', 'benjamini-yekutieli'] as const).map((m) =>
    adjustPValues(pValues, m, level),
  );
}
