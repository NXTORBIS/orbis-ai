/**
 * Post-hoc pairwise procedures.
 *
 * Every procedure here controls multiplicity, and every result says how. There
 * is no option to turn the adjustment off: running all pairwise comparisons at
 * a nominal 5% after a significant omnibus test is the most common statistical
 * error in applied work, and with six groups (15 comparisons) it produces a
 * false positive more than half the time.
 */
import { EngineError } from '../core/result';
import { studentT } from '../distributions/continuous';
import { mean, ranks, variance } from '../stats/descriptive';
import { adjustPValues, type MultiplicityMethod } from './multiplicity';
import { studentizedRangeQuantile, studentizedRangeSf } from './studentizedRange';
import { P_VALUE_LIMITATIONS, pFromZ, requireGroups, requireVariation, tieInfo } from './support';
import type { GroupInput } from './multiGroup';
import type { PairwiseComparison, PostHocResult } from './types';

function pairs(k: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) out.push([i, j]);
  return out;
}

/**
 * Tukey's honest significant difference. The p-values come from the
 * studentised range distribution, which gives exact simultaneous coverage for
 * all pairwise comparisons in a balanced design; with unequal group sizes the
 * Tukey–Kramer variant used here is slightly conservative.
 */
export function tukeyHsd(groups: GroupInput[], options: { level?: number } = {}): PostHocResult {
  const level = options.level ?? 0.95;
  const alpha = 1 - level;
  const gs = requireGroups(groups, 2, 2, "Tukey's HSD");
  const k = gs.length;
  const sizes = gs.map((g) => g.values.length);
  const means = gs.map((g) => mean(g.values));
  const n = sizes.reduce((a, b) => a + b, 0);
  let ssWithin = 0;
  for (let i = 0; i < k; i++) for (const v of gs[i].values) ssWithin += (v - means[i]) ** 2;
  const dfWithin = n - k;
  if (!(ssWithin > 0)) {
    throw new EngineError(
      "Tukey's HSD needs within-group variation: every observation inside each group is identical, so the pooled standard error is 0.",
      'undefined',
    );
  }
  const msWithin = ssWithin / dfWithin;
  const qCrit = studentizedRangeQuantile(level, k, dfWithin);
  const balanced = sizes.every((s) => s === sizes[0]);
  const comparisons: PairwiseComparison[] = pairs(k).map(([i, j]) => {
    const diff = means[i] - means[j];
    const se = Math.sqrt((msWithin / 2) * (1 / sizes[i] + 1 / sizes[j]));
    const q = Math.abs(diff) / se;
    const pAdj = studentizedRangeSf(q, k, dfWithin);
    // The unadjusted comparison a naive analysis would report, for contrast.
    const t = diff / (se * Math.SQRT2);
    const pRaw = Math.min(1, 2 * studentT.sf(Math.abs(t), { nu: dfWithin, mu: 0, sigma: 1 }));
    const half = qCrit * se;
    return {
      a: gs[i].label,
      b: gs[j].label,
      difference: diff,
      statistic: q,
      statisticName: 'q (studentised range)',
      pValueUnadjusted: pRaw,
      pValueAdjusted: pAdj,
      rejected: pAdj < alpha,
      interval: {
        low: diff - half,
        high: diff + half,
        level,
        of: `the difference in means (${gs[i].label} − ${gs[j].label})`,
        method: `Tukey${balanced ? '' : '–Kramer'} simultaneous interval; all ${pairs(k).length} intervals hold together with ${(level * 100).toFixed(0)}% confidence`,
        kind: 'estimate',
      },
    };
  });
  return {
    name: `Tukey's HSD${balanced ? '' : ' (Tukey–Kramer, unequal group sizes)'}`,
    multiplicityControl:
      "the studentised range distribution, which controls the family-wise error rate across all pairwise comparisons exactly (balanced design) or conservatively (Tukey–Kramer, unequal n). The p-values below are already family-wise adjusted — they are not raw p-values and must not be adjusted again.",
    familywiseLevel: alpha,
    comparisons,
    exactness: 'numerical',
    assumptions: [
      'Observations are independent.',
      'Residuals are approximately normal with the same variance in every group — the same assumptions as the classical one-way ANOVA.',
      'The set of comparisons was decided before looking at the data.',
    ],
    limitations: [
      ...P_VALUE_LIMITATIONS,
      'Tukey inherits the equal-variance assumption. With clearly unequal variances use Games–Howell instead.',
      `The critical value is q = ${qCrit.toPrecision(5)} for k = ${k} and ${dfWithin} degrees of freedom; every interval is correspondingly wider than an unadjusted one, which is the price of simultaneous validity.`,
      'The studentised range probabilities are computed by numerical quadrature, accurate to about 1e-8.',
    ],
    notes: [
      `MS within = ${msWithin.toPrecision(6)} on ${dfWithin} degrees of freedom; group sizes ${sizes.join(', ')}.`,
      `${comparisons.length} pairwise comparison(s). Unadjusted, ${comparisons.filter((c) => c.pValueUnadjusted < alpha).length} would be significant; after Tukey adjustment, ${comparisons.filter((c) => c.rejected).length}.`,
    ],
  };
}

/**
 * Dunn's test: the rank-based post-hoc for Kruskal–Wallis. The comparison uses
 * the pooled ranks from the original Kruskal–Wallis analysis (not fresh
 * pairwise rankings), with the same tie correction, so it is consistent with
 * the omnibus test.
 */
export function dunnTest(
  groups: GroupInput[],
  options: { level?: number; adjust?: MultiplicityMethod } = {},
): PostHocResult {
  const level = options.level ?? 0.95;
  const alpha = 1 - level;
  const method = options.adjust ?? 'holm';
  const gs = requireGroups(groups, 2, 1, "Dunn's test");
  requireVariation(gs, "Dunn's test");
  const k = gs.length;
  const sizes = gs.map((g) => g.values.length);
  const all = gs.flatMap((g) => g.values);
  const n = all.length;
  const r = ranks(all);
  const meanRanks: number[] = [];
  let offset = 0;
  for (let i = 0; i < k; i++) {
    let sum = 0;
    for (let j = 0; j < sizes[i]; j++) sum += r[offset + j];
    offset += sizes[i];
    meanRanks.push(sum / sizes[i]);
  }
  const ties = tieInfo(all, true, 'the standard error of the rank difference');
  const tieAdjustment = ties.tieSum / (12 * (n - 1));
  const base = (n * (n + 1)) / 12 - tieAdjustment;
  if (!(base > 0)) throw new EngineError('After the tie correction the variance of the rank differences is 0.', 'undefined');
  const raw: number[] = [];
  const list = pairs(k);
  const zs: number[] = [];
  for (const [i, j] of list) {
    const se = Math.sqrt(base * (1 / sizes[i] + 1 / sizes[j]));
    const z = (meanRanks[i] - meanRanks[j]) / se;
    zs.push(z);
    raw.push(pFromZ(z, 'two-sided'));
  }
  const adjusted = adjustPValues(raw, method, alpha);
  const comparisons: PairwiseComparison[] = list.map(([i, j], idx) => ({
    a: gs[i].label,
    b: gs[j].label,
    difference: meanRanks[i] - meanRanks[j],
    statistic: zs[idx],
    statisticName: 'z (difference in mean ranks)',
    pValueUnadjusted: raw[idx],
    pValueAdjusted: adjusted.adjusted[idx],
    rejected: adjusted.rejected[idx],
    interval: null,
  }));
  return {
    name: "Dunn's test (post-hoc for Kruskal–Wallis)",
    multiplicityControl: `the ${method} method applied to the ${list.length} pairwise p-values, which controls ${adjusted.controls}`,
    familywiseLevel: alpha,
    comparisons,
    exactness: 'numerical',
    assumptions: [
      'Observations are independent.',
      'The measurement is at least ordinal.',
      'No normality assumption. The comparison is of mean ranks in the pooled sample.',
    ],
    limitations: [
      ...P_VALUE_LIMITATIONS,
      'The z statistics use the normal approximation, which needs about 5 or more observations per group.',
      'Differences in mean rank depend on all the other groups present, because the ranks are pooled. Dropping a group changes the comparisons.',
      'No confidence interval is defined for a difference in mean ranks; use the Hodges–Lehmann shift for a pair if an interval is needed.',
    ],
    notes: [
      `Mean ranks: ${gs.map((g, i) => `${g.label} ${meanRanks[i].toPrecision(5)}`).join(', ')}.`,
      ties.detail,
      ...adjusted.notes,
    ],
  };
}

/**
 * Games–Howell: pairwise comparisons that use each pair's own variances and
 * Welch degrees of freedom, with the studentised range for multiplicity. This
 * is the right post-hoc when the group variances differ.
 */
export function gamesHowell(groups: GroupInput[], options: { level?: number } = {}): PostHocResult {
  const level = options.level ?? 0.95;
  const alpha = 1 - level;
  const gs = requireGroups(groups, 2, 2, 'Games–Howell');
  const k = gs.length;
  const sizes = gs.map((g) => g.values.length);
  const means = gs.map((g) => mean(g.values));
  const vars = gs.map((g) => variance(g.values));
  const comparisons: PairwiseComparison[] = pairs(k).map(([i, j]) => {
    const se = Math.sqrt(vars[i] / sizes[i] + vars[j] / sizes[j]);
    if (!(se > 0)) {
      throw new EngineError(
        `Games–Howell cannot compare "${gs[i].label}" with "${gs[j].label}": both groups have zero variance, so the standard error is 0.`,
        'undefined',
      );
    }
    const diff = means[i] - means[j];
    const df =
      (vars[i] / sizes[i] + vars[j] / sizes[j]) ** 2 /
      (vars[i] ** 2 / (sizes[i] ** 2 * (sizes[i] - 1)) + vars[j] ** 2 / (sizes[j] ** 2 * (sizes[j] - 1)));
    const t = diff / se;
    const q = Math.SQRT2 * Math.abs(t);
    const pAdj = studentizedRangeSf(q, k, df);
    const pRaw = Math.min(1, 2 * studentT.sf(Math.abs(t), { nu: df, mu: 0, sigma: 1 }));
    const qCrit = studentizedRangeQuantile(level, k, df);
    const half = (qCrit / Math.SQRT2) * se;
    return {
      a: gs[i].label,
      b: gs[j].label,
      difference: diff,
      statistic: q,
      statisticName: 'q (studentised range, Welch standard error)',
      pValueUnadjusted: pRaw,
      pValueAdjusted: pAdj,
      rejected: pAdj < alpha,
      interval: {
        low: diff - half,
        high: diff + half,
        level,
        of: `the difference in means (${gs[i].label} − ${gs[j].label})`,
        method: `Games–Howell simultaneous interval (Welch standard error, studentised range critical value on ${df.toPrecision(4)} df)`,
        kind: 'estimate',
      },
    };
  });
  return {
    name: 'Games–Howell post-hoc comparisons',
    multiplicityControl:
      'the studentised range distribution applied pair by pair with Welch degrees of freedom, which controls the family-wise error rate approximately without assuming equal variances. The p-values are already adjusted.',
    familywiseLevel: alpha,
    comparisons,
    exactness: 'numerical',
    assumptions: [
      'Observations are independent.',
      'Each group mean is approximately normally distributed.',
      'Variances are NOT assumed equal — this is the reason to use this procedure instead of Tukey.',
    ],
    limitations: [
      ...P_VALUE_LIMITATIONS,
      'The family-wise control is approximate, not exact; with fewer than about 6 observations per group it can be liberal.',
      'Each comparison uses only the two groups involved, so a group with a wild variance does not contaminate the other comparisons — but neither does it borrow strength from them.',
    ],
    notes: [
      `Group SDs: ${gs.map((g, i) => `${g.label} ${Math.sqrt(vars[i]).toPrecision(5)}`).join(', ')}; largest-to-smallest variance ratio ${(Math.max(...vars) / Math.min(...vars)).toPrecision(3)}.`,
      `${comparisons.length} comparison(s); ${comparisons.filter((c) => c.rejected).length} significant after adjustment.`,
    ],
  };
}

/**
 * Nemenyi post-hoc for the Friedman test: pairwise comparison of mean ranks
 * against the studentised range with infinite degrees of freedom.
 */
export function nemenyiTest(
  blocks: ArrayLike<number>[],
  options: { level?: number; conditionLabels?: string[] } = {},
): PostHocResult {
  const level = options.level ?? 0.95;
  const alpha = 1 - level;
  const nBlocks = blocks.length;
  if (nBlocks < 2) throw new EngineError('The Nemenyi test needs at least 2 blocks.', 'insufficient');
  const k = blocks[0].length;
  if (k < 2) throw new EngineError('The Nemenyi test needs at least 2 conditions.', 'insufficient');
  const labels = options.conditionLabels ?? Array.from({ length: k }, (_, j) => `Condition ${j + 1}`);
  const rankSums = new Array<number>(k).fill(0);
  for (let i = 0; i < nBlocks; i++) {
    if (blocks[i].length !== k) throw new EngineError(`Block ${i + 1} has ${blocks[i].length} values but ${k} were expected.`, 'shape');
    const row = Array.from(blocks[i]);
    for (const v of row) if (!Number.isFinite(v)) throw new EngineError(`Block ${i + 1} contains a non-finite value.`, 'finite');
    const rr = ranks(row);
    for (let j = 0; j < k; j++) rankSums[j] += rr[j];
  }
  const meanRanks = rankSums.map((s) => s / nBlocks);
  const se = Math.sqrt((k * (k + 1)) / (6 * nBlocks));
  const qCrit = studentizedRangeQuantile(level, k, Infinity);
  const criticalDifference = qCrit * se;
  const comparisons: PairwiseComparison[] = pairs(k).map(([i, j]) => {
    const diff = meanRanks[i] - meanRanks[j];
    const q = Math.abs(diff) / se;
    const pAdj = studentizedRangeSf(q, k, Infinity);
    const pRaw = pFromZ(diff / se, 'two-sided');
    return {
      a: labels[i],
      b: labels[j],
      difference: diff,
      statistic: q,
      statisticName: 'q (studentised range on mean ranks)',
      pValueUnadjusted: pRaw,
      pValueAdjusted: pAdj,
      rejected: pAdj < alpha,
      interval: null,
    };
  });
  return {
    name: 'Nemenyi post-hoc comparisons (for the Friedman test)',
    multiplicityControl:
      'the studentised range distribution with infinite degrees of freedom, which controls the family-wise error rate across all pairwise comparisons of mean ranks. The p-values are already adjusted.',
    familywiseLevel: alpha,
    comparisons,
    exactness: 'numerical',
    assumptions: [
      'Blocks are independent of one another.',
      'Within each block the conditions can be ranked.',
      'The number of blocks is large enough for the asymptotic distribution of the mean ranks; the degrees of freedom are taken as infinite, which with few blocks makes the test conservative.',
    ],
    limitations: [
      ...P_VALUE_LIMITATIONS,
      `Any two mean ranks differing by less than the critical difference ${criticalDifference.toPrecision(5)} cannot be separated at this level, regardless of the omnibus result.`,
      'The Nemenyi procedure is known to be conservative; when every condition is compared to a single control, a Holm-adjusted set of sign or signed-rank tests has more power.',
      'Ties within blocks are handled by midranks but the variance is not tie-corrected here, which makes the test slightly conservative with many ties.',
    ],
    notes: [
      `n = ${nBlocks} block(s), k = ${k} condition(s); standard error of a mean-rank difference ${se.toPrecision(5)}.`,
      `Mean ranks: ${labels.map((l, j) => `${l} ${meanRanks[j].toPrecision(4)}`).join(', ')}.`,
      `Critical difference at the ${(level * 100).toFixed(0)}% family-wise level: ${criticalDifference.toPrecision(5)}.`,
    ],
  };
}
