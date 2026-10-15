/**
 * Tests for more than two groups: one-way ANOVA, Welch's ANOVA,
 * Kruskal–Wallis, Friedman and two-way ANOVA.
 *
 * A significant omnibus test says only that the groups are not all alike. It
 * never says which groups differ — that needs a post-hoc procedure *with*
 * multiplicity control, which is what `posthoc.ts` provides.
 */
import { EngineError } from '../core/result';
import { chiSquare } from '../distributions/continuous';
import { mean, ranks, variance } from '../stats/descriptive';
import { fSurvival } from '../stats/tests';
import {
  P_VALUE_LIMITATIONS,
  interpretMagnitude,
  requireGroups,
  requireVariation,
  sensitivity,
  summarizeGroups,
  tieInfo,
} from './support';
import type { NonparametricResult } from './types';

const OMNIBUS_LIMITATION =
  'This is an omnibus test: a significant result means the groups are not all the same, not which of them differ. Comparing pairs afterwards without a multiplicity adjustment is the single most common error in applied statistics — use one of the post-hoc procedures, which always adjust.';

export interface GroupInput {
  label?: string;
  values: ArrayLike<number>;
}

/** Classical one-way ANOVA with η², ω² and partial η². */
export function oneWayAnovaTest(groups: GroupInput[], options: { level?: number } = {}): NonparametricResult {
  const level = options.level ?? 0.95;
  const gs = requireGroups(groups, 2, 2, 'One-way ANOVA');
  const k = gs.length;
  const sizes = gs.map((g) => g.values.length);
  const all = gs.flatMap((g) => g.values);
  const n = all.length;
  const grand = mean(all);
  let ssBetween = 0;
  let ssWithin = 0;
  for (const g of gs) {
    const m = mean(g.values);
    ssBetween += g.values.length * (m - grand) ** 2;
    for (const v of g.values) ssWithin += (v - m) ** 2;
  }
  const dfBetween = k - 1;
  const dfWithin = n - k;
  if (!(ssWithin > 0)) {
    throw new EngineError(
      'Every observation within each group is identical, so the within-group variance is 0 and the F statistic is infinite. There is nothing for the test to compare against.',
      'undefined',
    );
  }
  const msBetween = ssBetween / dfBetween;
  const msWithin = ssWithin / dfWithin;
  const f = msBetween / msWithin;
  const pValue = fSurvival(f, dfBetween, dfWithin);
  const ssTotal = ssBetween + ssWithin;
  const etaSquared = ssBetween / ssTotal;
  const partialEta = ssBetween / (ssBetween + ssWithin); // identical to η² in a one-way design
  const omegaSquared = (ssBetween - dfBetween * msWithin) / (ssTotal + msWithin);
  const cohensF = Math.sqrt(etaSquared / (1 - etaSquared));
  const variances = gs.map((g) => variance(g.values));
  const varianceRatio = Math.max(...variances) / Math.min(...variances);
  return {
    name: 'One-way ANOVA',
    nullHypothesis: 'Every group has the same population mean',
    alternativeHypothesis: 'At least one group mean differs from the others',
    statistic: f,
    statisticName: 'F',
    degreesOfFreedom: [dfBetween, dfWithin],
    pValue,
    pValueRoute: 'asymptotic',
    pValueRouteReason:
      'The ratio of mean squares is referred to the F distribution. That is exact if the data are normal with equal variances; otherwise it is an approximation that improves with sample size.',
    exactness: 'numerical',
    effectSizes: [
      {
        name: 'η² (eta squared)',
        value: etaSquared,
        interpretation: `${(etaSquared * 100).toPrecision(3)}% of the total variation lies between the groups. η² is biased upwards as an estimate of the population value; ω² corrects that.`,
      },
      {
        name: 'ω² (omega squared)',
        value: omegaSquared,
        interpretation:
          omegaSquared <= 0
            ? 'The unbiased estimate is 0 or negative, which means the between-group variation is no larger than sampling noise would produce. Read it as "no detectable effect", not as a negative proportion.'
            : `An approximately unbiased estimate that ${(omegaSquared * 100).toPrecision(3)}% of the population variance is between groups.`,
      },
      {
        name: 'Partial η²',
        value: partialEta,
        interpretation: `${(partialEta * 100).toPrecision(3)}%. In a one-way design partial η² and η² coincide, because there are no other effects to partial out.`,
      },
      {
        name: "Cohen's f",
        value: cohensF,
        interpretation: `${interpretMagnitude(cohensF, 0.1, 0.25, 0.4)} (f = ${cohensF.toPrecision(3)}) by Cohen's conventions.`,
      },
    ],
    interval: null,
    assumptions: [
      'Observations are independent within and between groups.',
      'The residuals are approximately normal (or each group is large enough for the central limit theorem).',
      'The group variances are equal. This test assumes it; the largest-to-smallest variance ratio here is ' +
        `${varianceRatio.toPrecision(3)}. If that is far from 1, use Welch's ANOVA instead.`,
    ],
    limitations: [
      ...P_VALUE_LIMITATIONS,
      OMNIBUS_LIMITATION,
      "The equal-variance assumption is routinely violated and routinely ignored. Welch's ANOVA costs almost nothing in power when variances are equal and is substantially more reliable when they are not, so it is the safer default.",
    ],
    notes: [
      `SS between = ${ssBetween.toPrecision(6)} (df ${dfBetween}), SS within = ${ssWithin.toPrecision(6)} (df ${dfWithin}).`,
      `MS between = ${msBetween.toPrecision(6)}, MS within = ${msWithin.toPrecision(6)}.`,
      ...gs.map((g) => `${g.label}: n = ${g.values.length}, mean ${mean(g.values).toPrecision(6)}, SD ${Math.sqrt(variance(g.values)).toPrecision(6)}.`),
    ],
    ties: { tiesPresent: false, correctionApplied: false, tiedGroups: 0, detail: 'Ties do not affect an F test on the raw values.' },
    sensitivity: sensitivity(pValue, 1 - level, { kind: 'anova', groupSizes: sizes }),
    groups: summarizeGroups(gs),
    diagnostics: {
      f,
      dfBetween,
      dfWithin,
      ssBetween,
      ssWithin,
      msBetween,
      msWithin,
      etaSquared,
      omegaSquared,
      partialEtaSquared: partialEta,
      cohensF,
      varianceRatio,
    },
  };
}

/** Welch's heteroscedastic one-way ANOVA. */
export function welchAnovaTest(groups: GroupInput[], options: { level?: number } = {}): NonparametricResult {
  const level = options.level ?? 0.95;
  const gs = requireGroups(groups, 2, 2, "Welch's ANOVA");
  const k = gs.length;
  const sizes = gs.map((g) => g.values.length);
  const means = gs.map((g) => mean(g.values));
  const vars = gs.map((g) => variance(g.values));
  gs.forEach((g, i) => {
    if (!(vars[i] > 0)) {
      throw new EngineError(
        `Welch's ANOVA weights each group by n/s², so group "${g.label}" having zero variance makes the weight infinite and the statistic undefined. Every group must vary.`,
        'undefined',
      );
    }
  });
  const w = sizes.map((ni, i) => ni / vars[i]);
  const sumW = w.reduce((a, b) => a + b, 0);
  const weightedMean = w.reduce((a, wi, i) => a + wi * means[i], 0) / sumW;
  let numerator = 0;
  for (let i = 0; i < k; i++) numerator += w[i] * (means[i] - weightedMean) ** 2;
  numerator /= k - 1;
  let lambda = 0;
  for (let i = 0; i < k; i++) lambda += (1 / (sizes[i] - 1)) * (1 - w[i] / sumW) ** 2;
  const denominator = 1 + ((2 * (k - 2)) / (k * k - 1)) * lambda;
  const f = numerator / denominator;
  const df1 = k - 1;
  const df2 = (k * k - 1) / (3 * lambda);
  const pValue = fSurvival(f, df1, df2);
  const all = gs.flatMap((g) => g.values);
  const grand = mean(all);
  let ssBetween = 0;
  let ssWithin = 0;
  for (let i = 0; i < k; i++) {
    ssBetween += sizes[i] * (means[i] - grand) ** 2;
    for (const v of gs[i].values) ssWithin += (v - means[i]) ** 2;
  }
  const etaSquared = ssBetween / (ssBetween + ssWithin);
  const varianceRatio = Math.max(...vars) / Math.min(...vars);
  return {
    name: "Welch's ANOVA (heteroscedastic one-way)",
    nullHypothesis: 'Every group has the same population mean',
    alternativeHypothesis: 'At least one group mean differs from the others',
    statistic: f,
    statisticName: 'F*',
    degreesOfFreedom: [df1, df2],
    pValue,
    pValueRoute: 'asymptotic',
    pValueRouteReason:
      "Welch's statistic is referred to an F distribution with fractional denominator degrees of freedom from the Welch–Satterthwaite approximation. The approximation is good from about 10 observations per group.",
    exactness: 'numerical',
    effectSizes: [
      {
        name: 'η² (from the unweighted sums of squares)',
        value: etaSquared,
        interpretation: `${(etaSquared * 100).toPrecision(3)}% of the total variation lies between the groups. Note that η² itself assumes a common variance, so with very unequal variances read it only as a rough summary.`,
      },
    ],
    interval: null,
    assumptions: [
      'Observations are independent within and between groups.',
      'Each group mean is approximately normally distributed.',
      'Variances are NOT assumed equal — this is the reason to use this test.',
    ],
    limitations: [
      ...P_VALUE_LIMITATIONS,
      OMNIBUS_LIMITATION,
      `Prefer this test over the classical F test whenever the group variances might differ or the group sizes are unequal — which is almost always. Here the largest-to-smallest variance ratio is ${varianceRatio.toPrecision(3)} and the group sizes are ${sizes.join(', ')}. The classical test is only safe when the design is balanced and the variances are close; Welch's loses very little power when they are, so it is the better default. It remains sensitive to strong skew in small samples, where Kruskal–Wallis or a permutation test is preferable.`,
    ],
    notes: [
      `Weighted grand mean ${weightedMean.toPrecision(6)}; weights n/s² = ${w.map((x) => x.toPrecision(4)).join(', ')}.`,
      `Denominator degrees of freedom are fractional (${df2.toPrecision(5)}) because of the Welch correction.`,
      ...gs.map((g, i) => `${g.label}: n = ${sizes[i]}, mean ${means[i].toPrecision(6)}, SD ${Math.sqrt(vars[i]).toPrecision(6)}.`),
    ],
    ties: { tiesPresent: false, correctionApplied: false, tiedGroups: 0, detail: 'Ties do not affect an F test on the raw values.' },
    sensitivity: sensitivity(pValue, 1 - level, { kind: 'anova', groupSizes: sizes }),
    groups: summarizeGroups(gs),
    diagnostics: { f, df1, df2, lambda, weightedMean, etaSquared, varianceRatio },
  };
}

/** Kruskal–Wallis test: the non-parametric one-way analysis of ranks. */
export function kruskalWallisTest(groups: GroupInput[], options: { level?: number } = {}): NonparametricResult {
  const level = options.level ?? 0.95;
  const gs = requireGroups(groups, 2, 1, 'The Kruskal–Wallis test');
  requireVariation(gs, 'The Kruskal–Wallis test');
  const k = gs.length;
  const sizes = gs.map((g) => g.values.length);
  const all = gs.flatMap((g) => g.values);
  const n = all.length;
  const r = ranks(all);
  const meanRanks: number[] = [];
  let offset = 0;
  let hRaw = 0;
  for (let i = 0; i < k; i++) {
    let sum = 0;
    for (let j = 0; j < sizes[i]; j++) sum += r[offset + j];
    offset += sizes[i];
    meanRanks.push(sum / sizes[i]);
    hRaw += (sum * sum) / sizes[i];
  }
  hRaw = (12 / (n * (n + 1))) * hRaw - 3 * (n + 1);
  const ties = tieInfo(all, true, 'the H statistic');
  const tieDivisor = 1 - ties.tieSum / (n ** 3 - n);
  if (!(tieDivisor > 0)) {
    throw new EngineError('All observations are tied at a single value, so the rank statistic is undefined.', 'undefined');
  }
  const h = hRaw / tieDivisor;
  const df = k - 1;
  const pValue = chiSquare.sf(h, { k: df });
  const epsilonSquared = h / (n - 1);
  const etaSquaredH = (h - k + 1) / (n - k);
  return {
    name: 'Kruskal–Wallis test',
    nullHypothesis: 'All groups have the same distribution — no group tends to produce larger values than another',
    alternativeHypothesis: 'At least one group tends to produce larger values than another',
    statistic: h,
    statisticName: 'H',
    degreesOfFreedom: df,
    pValue,
    pValueRoute: 'asymptotic',
    pValueRouteReason: `H is referred to the χ² distribution with ${df} degree(s) of freedom. That approximation is reliable once every group has about 5 or more observations (here the smallest is ${Math.min(...sizes)}); below that, use a permutation test on H.`,
    exactness: 'numerical',
    effectSizes: [
      {
        name: 'ε² (epsilon squared)',
        value: epsilonSquared,
        interpretation: `${(epsilonSquared * 100).toPrecision(3)}% of the variability in the ranks is explained by the grouping (ε² = H/(n−1), which runs from 0 to 1).`,
      },
      {
        name: 'η²_H',
        value: etaSquaredH,
        interpretation:
          etaSquaredH <= 0
            ? 'The bias-adjusted rank effect is 0 or negative, meaning the between-group rank variation is no more than chance would give.'
            : `${(etaSquaredH * 100).toPrecision(3)}% after adjusting for the degrees of freedom.`,
      },
    ],
    interval: null,
    assumptions: [
      'The groups are independent and the observations within each are independent.',
      'The measurement is at least ordinal.',
      'No normality and no equal-variance assumption. Interpreting the result as a statement about medians does, however, require the group distributions to have similar shapes.',
    ],
    limitations: [
      ...P_VALUE_LIMITATIONS,
      OMNIBUS_LIMITATION,
      'Like Mann–Whitney, this tests stochastic ordering rather than medians. Groups differing only in spread can produce a significant H.',
    ],
    notes: [
      `H = ${h.toPrecision(6)} after the tie correction (${hRaw.toPrecision(6)} before), n = ${n}, k = ${k}.`,
      `Mean ranks: ${gs.map((g, i) => `${g.label} ${meanRanks[i].toPrecision(5)}`).join(', ')}.`,
      ties.detail,
    ],
    ties,
    sensitivity: sensitivity(pValue, 1 - level, { kind: 'anova', groupSizes: sizes }),
    groups: summarizeGroups(gs, meanRanks),
    diagnostics: {
      h,
      hUncorrected: hRaw,
      df,
      tieDivisor,
      tieSum: ties.tieSum,
      epsilonSquared,
      etaSquaredH,
      n,
    },
  };
}

/**
 * Friedman test for repeated measures: each block (subject) is ranked across
 * the k conditions, so between-subject differences cancel out.
 *
 * `blocks` is one array per block, each of length k.
 */
export function friedmanTest(
  blocks: ArrayLike<number>[],
  options: { level?: number; conditionLabels?: string[] } = {},
): NonparametricResult {
  const level = options.level ?? 0.95;
  const nBlocks = blocks.length;
  if (nBlocks < 2) throw new EngineError('The Friedman test needs at least 2 blocks (subjects).', 'insufficient');
  const k = blocks[0].length;
  if (k < 2) throw new EngineError('The Friedman test needs at least 2 conditions per block.', 'insufficient');
  const labels = options.conditionLabels ?? Array.from({ length: k }, (_, j) => `Condition ${j + 1}`);
  if (labels.length !== k) throw new EngineError('The number of condition labels must match the number of conditions.', 'shape');
  const rows: number[][] = [];
  for (let i = 0; i < nBlocks; i++) {
    if (blocks[i].length !== k) {
      throw new EngineError(
        `Block ${i + 1} has ${blocks[i].length} values but block 1 has ${k}. Repeated-measures data must be complete and rectangular; drop incomplete blocks first.`,
        'shape',
      );
    }
    const row = Array.from(blocks[i]);
    for (const v of row) {
      if (!Number.isFinite(v)) throw new EngineError(`Block ${i + 1} contains a value that is not a finite number.`, 'finite');
    }
    rows.push(row);
  }
  const rankMatrix = rows.map((row) => Array.from(ranks(row)));
  let tieSum = 0;
  let tiedGroups = 0;
  for (const row of rows) {
    const info = tieInfo(row, true);
    tieSum += info.tieSum;
    tiedGroups += info.tiedGroups;
  }
  const rankSums = new Array<number>(k).fill(0);
  for (const rr of rankMatrix) for (let j = 0; j < k; j++) rankSums[j] += rr[j];
  let q = 0;
  for (let j = 0; j < k; j++) q += rankSums[j] ** 2;
  q = (12 / (nBlocks * k * (k + 1))) * q - 3 * nBlocks * (k + 1);
  const tieDivisor = 1 - tieSum / (nBlocks * k * (k * k - 1));
  if (!(tieDivisor > 0)) {
    throw new EngineError(
      'Every value is tied within every block, so all ranks are equal and the Friedman statistic is undefined.',
      'undefined',
    );
  }
  const qCorrected = q / tieDivisor;
  const df = k - 1;
  const pValue = chiSquare.sf(qCorrected, { k: df });
  const kendallsW = qCorrected / (nBlocks * (k - 1));
  const meanRanks = rankSums.map((s) => s / nBlocks);
  return {
    name: 'Friedman test (repeated measures)',
    nullHypothesis: 'The k conditions have the same distribution within blocks — no condition tends to rank higher than another',
    alternativeHypothesis: 'At least one condition tends to rank higher or lower than the others',
    statistic: qCorrected,
    statisticName: 'Q',
    degreesOfFreedom: df,
    pValue,
    pValueRoute: 'asymptotic',
    pValueRouteReason: `Q is referred to the χ² distribution with ${df} degree(s) of freedom. That needs a reasonable number of blocks — about 10 or more for k = 3, fewer as k grows; here there are ${nBlocks}. With very few blocks the exact permutation distribution (k!^n sign patterns) should be used instead.`,
    exactness: 'numerical',
    effectSizes: [
      {
        name: "Kendall's W (coefficient of concordance)",
        value: kendallsW,
        interpretation: `${interpretMagnitude(kendallsW, 0.1, 0.3, 0.5)} agreement between blocks about the ordering of the conditions (W = ${kendallsW.toPrecision(3)}; 0 means no agreement, 1 means every block gives the same ranking).`,
      },
    ],
    interval: null,
    assumptions: [
      'Blocks (subjects) are independent of one another.',
      'Within a block the k values are comparable and can be ranked.',
      'No normality and no sphericity assumption, unlike repeated-measures ANOVA.',
    ],
    limitations: [
      ...P_VALUE_LIMITATIONS,
      OMNIBUS_LIMITATION,
      'Only the within-block ordering is used, so the sizes of the differences are discarded. With k = 2 the test uses only the direction of each difference and is equivalent to a two-sided sign test on the pairs.',
    ],
    notes: [
      `n = ${nBlocks} block(s), k = ${k} condition(s). Q = ${qCorrected.toPrecision(6)} after the tie correction (${q.toPrecision(6)} before).`,
      `Mean ranks: ${labels.map((l, j) => `${l} ${meanRanks[j].toPrecision(4)}`).join(', ')}.`,
    ],
    ties: {
      tiesPresent: tieSum > 0,
      correctionApplied: tieSum > 0,
      tiedGroups,
      detail:
        tieSum > 0
          ? `${tiedGroups} tied group(s) within blocks (Σ(t³−t) = ${tieSum}); Q has been divided by ${tieDivisor.toPrecision(6)} to correct for them.`
          : 'No ties within any block; no correction needed.',
    },
    sensitivity: sensitivity(pValue, 1 - level, { kind: 'chi-square', df, n: nBlocks * k }),
    groups: labels.map((label, j) => ({
      label,
      n: nBlocks,
      mean: mean(rows.map((row) => row[j])),
      sd: Math.sqrt(variance(rows.map((row) => row[j]))),
      median: rows.length ? [...rows.map((row) => row[j])].sort((p, qq) => p - qq)[Math.floor(nBlocks / 2)] : NaN,
      meanRank: meanRanks[j],
    })),
    diagnostics: {
      q: qCorrected,
      qUncorrected: q,
      df,
      tieDivisor,
      tieSum,
      kendallsW,
      blocks: nBlocks,
      conditions: k,
    },
  };
}

export interface TwoWayCell {
  levelA: string;
  levelB: string;
  values: ArrayLike<number>;
}

export interface TwoWayAnovaResult {
  factorA: NonparametricResult;
  factorB: NonparametricResult;
  interaction: NonparametricResult;
  cellMeans: { levelA: string; levelB: string; n: number; mean: number; sd: number }[];
  notes: string[];
}

/**
 * Two-way ANOVA with both main effects and the interaction.
 *
 * Only balanced designs (the same number of observations in every cell) are
 * accepted. With unbalanced cells the sums of squares depend on the order in
 * which the effects enter the model and there is no single right answer, so
 * the function refuses rather than quietly picking one convention.
 */
export function twoWayAnovaTest(cells: TwoWayCell[], options: { level?: number } = {}): TwoWayAnovaResult {
  const level = options.level ?? 0.95;
  if (cells.length < 4) throw new EngineError('A two-way ANOVA needs at least 2 × 2 = 4 cells.', 'insufficient');
  const levelsA = [...new Set(cells.map((c) => c.levelA))];
  const levelsB = [...new Set(cells.map((c) => c.levelB))];
  const a = levelsA.length;
  const b = levelsB.length;
  if (a < 2 || b < 2) throw new EngineError('Each factor needs at least 2 levels.', 'insufficient');
  if (cells.length !== a * b) {
    throw new EngineError(
      `A two-way ANOVA needs every combination of levels: ${a} × ${b} = ${a * b} cells were expected but ${cells.length} were supplied (duplicate or missing combinations).`,
      'shape',
    );
  }
  const byCell = new Map<string, number[]>();
  for (const c of cells) {
    const key = `${c.levelA}\u0000${c.levelB}`;
    if (byCell.has(key)) throw new EngineError(`Cell (${c.levelA}, ${c.levelB}) is given more than once.`, 'shape');
    const values = Array.from(c.values);
    if (values.length < 2) {
      throw new EngineError(
        `Cell (${c.levelA}, ${c.levelB}) has ${values.length} observation(s). At least 2 per cell are needed to separate the interaction from the error.`,
        'insufficient',
      );
    }
    for (const v of values) {
      if (!Number.isFinite(v)) throw new EngineError(`Cell (${c.levelA}, ${c.levelB}) contains a non-finite value.`, 'finite');
    }
    byCell.set(key, values);
  }
  const perCell = byCell.get(`${levelsA[0]}\u0000${levelsB[0]}`)?.length ?? 0;
  for (const [key, values] of byCell) {
    if (values.length !== perCell) {
      throw new EngineError(
        `This two-way ANOVA requires a balanced design: cell ${key.replace('\u0000', ', ')} has ${values.length} observations but the first cell has ${perCell}. With unbalanced cells the sums of squares depend on the order the effects enter the model, so no single F test is defined; use a regression model with an explicit Type II or Type III convention instead.`,
        'unbalanced',
      );
    }
  }
  const nPerCell = perCell;
  const all = [...byCell.values()].flat();
  const nTotal = all.length;
  const grand = mean(all);
  const cellMean = (i: string, j: string) => mean(byCell.get(`${i}\u0000${j}`) as number[]);
  const meansA = levelsA.map((i) => mean(levelsB.flatMap((j) => byCell.get(`${i}\u0000${j}`) as number[])));
  const meansB = levelsB.map((j) => mean(levelsA.flatMap((i) => byCell.get(`${i}\u0000${j}`) as number[])));
  let ssA = 0;
  for (let i = 0; i < a; i++) ssA += b * nPerCell * (meansA[i] - grand) ** 2;
  let ssB = 0;
  for (let j = 0; j < b; j++) ssB += a * nPerCell * (meansB[j] - grand) ** 2;
  let ssAB = 0;
  let ssE = 0;
  for (let i = 0; i < a; i++) {
    for (let j = 0; j < b; j++) {
      const cm = cellMean(levelsA[i], levelsB[j]);
      ssAB += nPerCell * (cm - meansA[i] - meansB[j] + grand) ** 2;
      for (const v of byCell.get(`${levelsA[i]}\u0000${levelsB[j]}`) as number[]) ssE += (v - cm) ** 2;
    }
  }
  const dfA = a - 1;
  const dfB = b - 1;
  const dfAB = dfA * dfB;
  const dfE = a * b * (nPerCell - 1);
  if (!(ssE > 0)) {
    throw new EngineError(
      'There is no variation within the cells, so the error mean square is 0 and every F statistic is infinite.',
      'undefined',
    );
  }
  const msE = ssE / dfE;
  const ssTotal = ssA + ssB + ssAB + ssE;
  const build = (
    name: string,
    nullH: string,
    altH: string,
    ss: number,
    df: number,
    extraLimitations: string[],
  ): NonparametricResult => {
    const ms = ss / df;
    const f = ms / msE;
    const p = fSurvival(f, df, dfE);
    const partialEta = ss / (ss + ssE);
    const omega = (ss - df * msE) / (ssTotal + msE);
    return {
      name,
      nullHypothesis: nullH,
      alternativeHypothesis: altH,
      statistic: f,
      statisticName: 'F',
      degreesOfFreedom: [df, dfE],
      pValue: p,
      pValueRoute: 'asymptotic',
      pValueRouteReason:
        'The mean-square ratio is referred to the F distribution, which is exact for normal residuals with a common variance and an approximation otherwise.',
      exactness: 'numerical',
      effectSizes: [
        {
          name: 'Partial η²',
          value: partialEta,
          interpretation: `${(partialEta * 100).toPrecision(3)}% of the variation left after removing the other effects is attributable to this one. Partial η² values from different effects do not add up to 1.`,
        },
        {
          name: 'η² (share of total variation)',
          value: ss / ssTotal,
          interpretation: `${((ss / ssTotal) * 100).toPrecision(3)}% of the total variation. These do add up (with the error term) to 1.`,
        },
        {
          name: 'ω²',
          value: omega,
          interpretation: omega <= 0 ? 'No effect detectable above sampling noise.' : `${(omega * 100).toPrecision(3)}%, approximately unbiased.`,
        },
      ],
      interval: null,
      assumptions: [
        'Observations are independent.',
        'Residuals are approximately normal with the same variance in every cell.',
        `The design is balanced (${nPerCell} observations in each of the ${a * b} cells), so the effects are orthogonal and the sums of squares are unambiguous.`,
      ],
      limitations: [...P_VALUE_LIMITATIONS, ...extraLimitations],
      notes: [`SS = ${ss.toPrecision(6)} (df ${df}), MS = ${ms.toPrecision(6)}, MS error = ${msE.toPrecision(6)} (df ${dfE}).`],
      ties: { tiesPresent: false, correctionApplied: false, tiedGroups: 0, detail: 'Ties do not affect an F test on the raw values.' },
      sensitivity: sensitivity(p, 1 - level, { kind: 'anova', groupSizes: new Array(df + 1).fill(Math.round(nTotal / (df + 1))) }),
      groups: [],
      diagnostics: { f, df1: df, df2: dfE, ss, ms, msError: msE, partialEtaSquared: partialEta, omegaSquared: omega },
    };
  };
  const interaction = build(
    'Two-way ANOVA: interaction',
    'The effect of one factor is the same at every level of the other',
    'The effect of one factor depends on the level of the other',
    ssAB,
    dfAB,
    [
      'A significant interaction means the main effects cannot be read on their own: the effect of each factor has to be described separately at each level of the other.',
      'A non-significant interaction does not establish additivity; interaction tests have low power.',
    ],
  );
  const interactionSignificant = interaction.pValue < 1 - level;
  const mainWarning = interactionSignificant
    ? ['The interaction is significant at this level, so this main effect is an average over conditions in which the factor behaves differently. Read the cell means rather than this test.']
    : [];
  return {
    factorA: build(
      'Two-way ANOVA: main effect of factor A',
      'The levels of factor A have the same mean, averaged over factor B',
      'At least one level of factor A differs',
      ssA,
      dfA,
      mainWarning,
    ),
    factorB: build(
      'Two-way ANOVA: main effect of factor B',
      'The levels of factor B have the same mean, averaged over factor A',
      'At least one level of factor B differs',
      ssB,
      dfB,
      mainWarning,
    ),
    interaction,
    cellMeans: levelsA.flatMap((i) =>
      levelsB.map((j) => {
        const values = byCell.get(`${i}\u0000${j}`) as number[];
        return { levelA: i, levelB: j, n: values.length, mean: mean(values), sd: Math.sqrt(variance(values)) };
      }),
    ),
    notes: [
      `Balanced ${a} × ${b} design with ${nPerCell} observations per cell (${nTotal} in total).`,
      `SS A = ${ssA.toPrecision(6)}, SS B = ${ssB.toPrecision(6)}, SS A×B = ${ssAB.toPrecision(6)}, SS error = ${ssE.toPrecision(6)}.`,
      'Sums of squares are orthogonal because the design is balanced, so Type I, II and III conventions all agree here.',
    ],
  };
}
