/**
 * Two-sample tests that make no distributional assumption.
 *
 * Mann–Whitney tests stochastic equality, not equality of medians: it only
 * becomes a test of medians when the two distributions have the same shape.
 * Brunner–Munzel drops even the equal-variance/equal-shape requirement and
 * tests the relative effect P(X < Y) + ½P(X = Y) directly, which is why it is
 * offered alongside.
 */
import { EngineError } from '../core/result';
import { chiSquare, studentT } from '../distributions/continuous';
import { normalQuantile } from '../special/gamma';
import { quantile, ranks, sortedCopy } from '../stats/descriptive';
import {
  KS_EXACT_MAX_PRODUCT,
  MANN_WHITNEY_EXACT_MAX_PRODUCT,
  ksTwoSampleExactP,
  mannWhitneyExactP,
  mannWhitneyNullDistribution,
} from './exact';
import {
  type Alternative,
  P_VALUE_LIMITATIONS,
  alternativeText,
  interpretMagnitude,
  pFromZ,
  requireGroups,
  requireVariation,
  sensitivity,
  summarizeGroups,
  tieInfo,
} from './support';
import type { NonparametricInterval, NonparametricResult } from './types';

function twoSampleInput(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  what: string,
  minPerGroup: number,
  labels: [string, string],
) {
  const groups = requireGroups(
    [
      { label: labels[0], values: a },
      { label: labels[1], values: b },
    ],
    2,
    minPerGroup,
    what,
  );
  requireVariation(groups, what);
  return groups;
}

export interface HodgesLehmannEstimate {
  /** Median of all n₁·n₂ pairwise differences a − b. */
  estimate: number;
  interval: NonparametricInterval;
  /** Number of pairwise differences trimmed from each end to form the interval. */
  trimmed: number;
  exact: boolean;
}

/**
 * Hodges–Lehmann estimator of the location shift between two samples, with the
 * distribution-free interval obtained by inverting the Mann–Whitney test: the
 * interval is exactly the set of shifts the test would not reject, so it is
 * consistent with the test by construction.
 */
export function hodgesLehmannShift(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  level = 0.95,
): HodgesLehmannEstimate {
  const groups = twoSampleInput(a, b, 'The Hodges–Lehmann shift estimate', 1, ['A', 'B']);
  const xs = groups[0].values;
  const ys = groups[1].values;
  const n1 = xs.length;
  const n2 = ys.length;
  const diffs: number[] = [];
  for (const x of xs) for (const y of ys) diffs.push(x - y);
  diffs.sort((p, q) => p - q);
  const N = diffs.length;
  const estimate = quantile(diffs, 0.5);
  const alpha = 1 - level;
  let k = 0;
  let exact = true;
  if (n1 * n2 <= MANN_WHITNEY_EXACT_MAX_PRODUCT) {
    const { pmf } = mannWhitneyNullDistribution(n1, n2);
    let cum = 0;
    for (let u = 0; u < pmf.length; u++) {
      cum += pmf[u];
      if (cum <= alpha / 2) k = u + 1;
      else break;
    }
  } else {
    exact = false;
    const z = normalQuantile(1 - alpha / 2);
    const sd = Math.sqrt((n1 * n2 * (n1 + n2 + 1)) / 12);
    k = Math.floor(N / 2 - z * sd);
    if (k < 0) k = 0;
  }
  if (2 * k >= N) {
    throw new EngineError(
      `A ${(level * 100).toFixed(0)}% distribution-free interval for the shift is not attainable with n₁ = ${n1} and n₂ = ${n2}: there are only ${N} pairwise differences. Collect more data or ask for a lower confidence level.`,
      'insufficient',
    );
  }
  return {
    estimate,
    trimmed: k,
    exact,
    interval: {
      low: diffs[k],
      high: diffs[N - 1 - k],
      level,
      of: 'the location shift (group A − group B)',
      method: exact
        ? 'distribution-free, by inverting the exact Mann–Whitney test (the set of shifts the test would not reject)'
        : 'distribution-free, by inverting the normal approximation to the Mann–Whitney test',
      kind: 'estimate',
    },
  };
}

/**
 * Mann–Whitney U / Wilcoxon rank-sum test. The exact null distribution is used
 * when there are no ties and n₁·n₂ is small; otherwise the normal
 * approximation with both the tie correction and the continuity correction.
 */
export function mannWhitneyUTest(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  options: { alternative?: Alternative; level?: number; labels?: [string, string]; exactMaxProduct?: number } = {},
): NonparametricResult {
  const alt = options.alternative ?? 'two-sided';
  const level = options.level ?? 0.95;
  const labels = options.labels ?? ['A', 'B'];
  const exactMax = options.exactMaxProduct ?? MANN_WHITNEY_EXACT_MAX_PRODUCT;
  const groups = twoSampleInput(a, b, 'The Mann–Whitney U test', 1, labels);
  const xs = groups[0].values;
  const ys = groups[1].values;
  const n1 = xs.length;
  const n2 = ys.length;
  const combined = [...xs, ...ys];
  const r = ranks(combined);
  let rankSumA = 0;
  for (let i = 0; i < n1; i++) rankSumA += r[i];
  const u1 = rankSumA - (n1 * (n1 + 1)) / 2;
  const u2 = n1 * n2 - u1;
  const meanU = (n1 * n2) / 2;
  const n = n1 + n2;
  const ties = tieInfo(combined, true, 'the variance of U');
  const varNoTies = (n1 * n2 * (n + 1)) / 12;
  const varU = ((n1 * n2) / 12) * (n + 1 - ties.tieSum / (n * (n - 1)));
  if (!(varU > 0)) {
    throw new EngineError('All observations are identical, so U has zero variance and no comparison is possible.', 'undefined');
  }
  const sd = Math.sqrt(varU);
  const zUncorrected = (u1 - meanU) / sd;
  let z: number;
  switch (alt) {
    case 'two-sided':
      z = (Math.abs(u1 - meanU) - 0.5) / sd;
      z = Math.max(0, z) * Math.sign(u1 - meanU || 1);
      break;
    case 'greater':
      z = (u1 - meanU - 0.5) / sd;
      break;
    case 'less':
      z = (u1 - meanU + 0.5) / sd;
      break;
  }
  const useExact = !ties.tiesPresent && n1 * n2 <= exactMax;
  const pValue = useExact ? mannWhitneyExactP(u1, n1, n2, alt) : pFromZ(z, alt);
  const cles = u1 / (n1 * n2);
  const rankBiserial = 2 * cles - 1;
  const meanRanks = [rankSumA / n1, (r.reduce((s, v) => s + v, 0) - rankSumA) / n2];
  let shift: HodgesLehmannEstimate | null = null;
  let shiftNote = '';
  try {
    shift = hodgesLehmannShift(xs, ys, level);
  } catch (e) {
    shiftNote = e instanceof EngineError ? `No distribution-free interval for the shift: ${e.message}` : '';
  }
  return {
    name: 'Mann–Whitney U test (Wilcoxon rank-sum)',
    nullHypothesis:
      'The two distributions are stochastically equal: a value drawn from one group is as likely to exceed a value from the other as to fall below it',
    alternativeHypothesis: alternativeText(alt, 'The tendency of group A to exceed group B'),
    statistic: u1,
    statisticName: 'U₁',
    degreesOfFreedom: null,
    pValue,
    pValueRoute: useExact ? 'exact' : 'asymptotic',
    pValueRouteReason: useExact
      ? `No ties are present and n₁·n₂ = ${n1 * n2} ≤ ${exactMax}, so the exact null distribution of U was enumerated by dynamic programming over all ${mannWhitneyNullDistribution(n1, n2).total.toLocaleString('en-US')} rank splits.`
      : ties.tiesPresent
        ? `Tied observations are present, so the exact null distribution of U does not apply. The normal approximation with the tie correction and a continuity correction is used instead; it is trustworthy from about n₁, n₂ ≥ 8 upwards.`
        : `n₁·n₂ = ${n1 * n2} exceeds the exact limit of ${exactMax}, so the normal approximation with a continuity correction is used; it is trustworthy from about n₁, n₂ ≥ 8 upwards.`,
    exactness: useExact ? 'exact' : 'numerical',
    effectSizes: [
      {
        name: 'Common-language effect size (probability of superiority)',
        value: cles,
        interpretation: `A value drawn at random from ${labels[0]} exceeds one drawn at random from ${labels[1]} about ${(cles * 100).toPrecision(3)}% of the time (ties split evenly). 50% is no difference.`,
      },
      {
        name: 'Rank-biserial correlation',
        value: rankBiserial,
        interpretation: `${interpretMagnitude(rankBiserial, 0.1, 0.3, 0.5)} (r_rb = ${rankBiserial.toPrecision(3)}); it is the difference between the proportion of pairs favouring ${labels[0]} and the proportion favouring ${labels[1]}.`,
      },
      ...(shift
        ? [
            {
              name: 'Hodges–Lehmann location shift',
              value: shift.estimate,
              interpretation: `The median of all ${n1 * n2} pairwise differences is ${shift.estimate.toPrecision(6)} in the units of the data.`,
              interval: shift.interval,
            },
          ]
        : []),
    ],
    interval: shift ? shift.interval : null,
    assumptions: [
      'The two samples are independent of each other and the observations within each are independent.',
      'The measurement is at least ordinal.',
      'No normality is assumed.',
      ...(useExact ? [] : ['The samples are large enough for the normal approximation to U.']),
    ],
    limitations: [
      ...P_VALUE_LIMITATIONS,
      'This is a test of stochastic equality, not of medians. Two distributions with identical medians but different shapes can be separated by this test, and a significant result does not by itself mean the medians differ.',
      'If the two distributions differ in spread, the test can reject even when neither group tends to be larger; Brunner–Munzel or a comparison of spreads is the better tool then.',
      ...(ties.tiesPresent ? ['Ties make the exact permutation distribution inapplicable; the tie-corrected normal approximation is used.'] : []),
      ...(shiftNote ? [shiftNote] : []),
    ],
    notes: [
      `U₁ = ${u1}, U₂ = ${u2}, n₁ = ${n1}, n₂ = ${n2}.`,
      `Mean rank: ${labels[0]} ${meanRanks[0].toPrecision(5)}, ${labels[1]} ${meanRanks[1].toPrecision(5)}.`,
      ties.detail,
      ...(ties.tiesPresent
        ? [`Variance of U: ${varU.toPrecision(8)} with the tie correction, ${varNoTies.toPrecision(8)} without it.`]
        : []),
    ],
    ties,
    sensitivity: sensitivity(pValue, 1 - level, { kind: 'two-sample', n1, n2, rank: true }),
    groups: summarizeGroups(groups, meanRanks),
    diagnostics: {
      u1,
      u2,
      rankSumA,
      z,
      zUncorrected,
      varianceU: varU,
      varianceUNoTieCorrection: varNoTies,
      tieSum: ties.tieSum,
      cles,
      rankBiserial,
      // The χ² form of the normal approximation, for the Kruskal–Wallis cross-check.
      chiSquareEquivalent: zUncorrected * zUncorrected,
    },
  };
}

/**
 * Brunner–Munzel test of the relative effect p = P(X < Y) + ½P(X = Y) = ½.
 * Unlike Mann–Whitney it does not require the two distributions to have the
 * same shape or spread, so it stays valid under heteroscedasticity.
 */
export function brunnerMunzelTest(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  options: { alternative?: Alternative; level?: number; labels?: [string, string] } = {},
): NonparametricResult {
  const alt = options.alternative ?? 'two-sided';
  const level = options.level ?? 0.95;
  const labels = options.labels ?? ['A', 'B'];
  const groups = twoSampleInput(a, b, 'The Brunner–Munzel test', 2, labels);
  const xs = groups[0].values;
  const ys = groups[1].values;
  const n1 = xs.length;
  const n2 = ys.length;
  const combined = [...xs, ...ys];
  const rAll = ranks(combined);
  const r1Within = ranks(xs);
  const r2Within = ranks(ys);
  let m1 = 0;
  for (let i = 0; i < n1; i++) m1 += rAll[i];
  m1 /= n1;
  let m2 = 0;
  for (let j = 0; j < n2; j++) m2 += rAll[n1 + j];
  m2 /= n2;
  // Relative effect: the probability that a value from B exceeds one from A.
  const pHat = (m2 - (n2 + 1) / 2) / n1;
  let s1 = 0;
  for (let i = 0; i < n1; i++) s1 += (rAll[i] - r1Within[i] - m1 + (n1 + 1) / 2) ** 2;
  s1 /= n1 - 1;
  let s2 = 0;
  for (let j = 0; j < n2; j++) s2 += (rAll[n1 + j] - r2Within[j] - m2 + (n2 + 1) / 2) ** 2;
  s2 /= n2 - 1;
  const a1 = s1 / (n2 * n2 * n1);
  const a2 = s2 / (n1 * n1 * n2);
  const varP = a1 + a2;
  if (!(varP > 0)) {
    throw new EngineError(
      'The estimated variance of the relative effect is 0 — the two samples do not overlap at all or are completely tied, so the Brunner–Munzel statistic is undefined. Use Fisher-style reasoning on the separation instead.',
      'undefined',
    );
  }
  const se = Math.sqrt(varP);
  const stat = (pHat - 0.5) / se;
  const df = (a1 + a2) ** 2 / (a1 ** 2 / (n1 - 1) + a2 ** 2 / (n2 - 1));
  const params = { nu: df, mu: 0, sigma: 1 };
  const pValue =
    alt === 'two-sided'
      ? Math.min(1, 2 * studentT.sf(Math.abs(stat), params))
      : alt === 'greater'
        ? studentT.cdf(stat, params) // "A greater than B" means a small relative effect p
        : studentT.sf(stat, params);
  const tCrit = studentT.quantile(0.5 + level / 2, params);
  const ties = tieInfo(combined, true, 'the midranks and the variance estimate');
  return {
    name: 'Brunner–Munzel test',
    nullHypothesis: 'The relative effect P(X < Y) + ½P(X = Y) equals ½',
    alternativeHypothesis: alternativeText(alt, 'The tendency of group A to exceed group B'),
    statistic: stat,
    statisticName: 'W',
    degreesOfFreedom: df,
    pValue,
    pValueRoute: 'asymptotic',
    pValueRouteReason:
      'The statistic is referred to a t distribution with Satterthwaite-type degrees of freedom (Brunner & Munzel, 2000). This is an asymptotic result; it is reliable from roughly n₁, n₂ ≥ 10 and is known to be liberal for very small samples, where a permutation version should be preferred.',
    exactness: 'numerical',
    effectSizes: [
      {
        name: 'Relative effect P(A < B) + ½P(A = B)',
        value: pHat,
        interpretation: `A value from ${labels[1]} exceeds one from ${labels[0]} about ${(pHat * 100).toPrecision(3)}% of the time (ties split evenly); equivalently ${labels[0]} exceeds ${labels[1]} ${((1 - pHat) * 100).toPrecision(3)}% of the time. ½ is no difference.`,
        interval: {
          low: Math.max(0, pHat - tCrit * se),
          high: Math.min(1, pHat + tCrit * se),
          level,
          of: 'the relative effect P(A < B) + ½P(A = B)',
          method: 'Brunner–Munzel standard error with t quantiles',
          kind: 'estimate',
        },
      },
    ],
    interval: {
      low: Math.max(0, pHat - tCrit * se),
      high: Math.min(1, pHat + tCrit * se),
      level,
      of: 'the relative effect P(A < B) + ½P(A = B)',
      method: 'Brunner–Munzel standard error with t quantiles',
      kind: 'estimate',
    },
    assumptions: [
      'The two samples are independent of each other and the observations within each are independent.',
      'The measurement is at least ordinal.',
      'Neither equal variances nor equal distribution shapes are assumed — this is the point of the test.',
    ],
    limitations: [
      ...P_VALUE_LIMITATIONS,
      'The relative effect is a statement about pairs of observations, not about means or medians.',
      'For n below about 10 per group the t approximation is anti-conservative; prefer a permutation test.',
    ],
    notes: [
      `Relative effect p̂ = ${pHat.toPrecision(6)}, standard error ${se.toPrecision(6)}, df = ${df.toPrecision(5)}.`,
      `Placement variances: S₁² = ${s1.toPrecision(6)}, S₂² = ${s2.toPrecision(6)}.`,
      ties.detail,
    ],
    ties,
    sensitivity: sensitivity(pValue, 1 - level, { kind: 'two-sample', n1, n2, rank: true }),
    groups: summarizeGroups(groups, [m1, m2]),
    diagnostics: { pHat, se, df, statistic: stat, s1, s2 },
  };
}

/** Two-sample Kolmogorov–Smirnov test of equality of the whole distributions. */
export function ksTwoSampleTest(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  options: { level?: number; labels?: [string, string] } = {},
): NonparametricResult {
  const level = options.level ?? 0.95;
  const labels = options.labels ?? ['A', 'B'];
  const groups = twoSampleInput(a, b, 'The two-sample Kolmogorov–Smirnov test', 2, labels);
  const xs = sortedCopy(groups[0].values);
  const ys = sortedCopy(groups[1].values);
  const n1 = xs.length;
  const n2 = ys.length;
  let i = 0;
  let j = 0;
  let d = 0;
  let at = NaN;
  while (i < n1 && j < n2) {
    const v = Math.min(xs[i], ys[j]);
    while (i < n1 && xs[i] === v) i++;
    while (j < n2 && ys[j] === v) j++;
    const gap = Math.abs(i / n1 - j / n2);
    if (gap > d) {
      d = gap;
      at = v;
    }
  }
  const combined = [...groups[0].values, ...groups[1].values];
  const ties = tieInfo(combined, false, 'the KS statistic');
  const product = n1 * n2;
  const useExact = !ties.tiesPresent && product <= KS_EXACT_MAX_PRODUCT;
  const en = Math.sqrt(product / (n1 + n2));
  let pValue: number;
  if (useExact) {
    pValue = ksTwoSampleExactP(d, n1, n2);
  } else {
    const lambda = (en + 0.12 + 0.11 / en) * d;
    let p = 0;
    for (let k = 1; k <= 200; k++) {
      const term = 2 * (-1) ** (k - 1) * Math.exp(-2 * k * k * lambda * lambda);
      p += term;
      if (Math.abs(term) < 1e-15) break;
    }
    pValue = Math.min(1, Math.max(0, p));
  }
  return {
    name: 'Two-sample Kolmogorov–Smirnov test',
    nullHypothesis: 'The two samples come from the same distribution',
    alternativeHypothesis: 'The two distributions differ somewhere',
    statistic: d,
    statisticName: 'D',
    degreesOfFreedom: null,
    pValue,
    pValueRoute: useExact ? 'exact' : 'asymptotic',
    pValueRouteReason: useExact
      ? `No ties are present and n₁·n₂ = ${product} ≤ ${KS_EXACT_MAX_PRODUCT}, so the exact p-value was obtained by counting the lattice paths that avoid the band |F₁ − F₂| ≥ D.`
      : ties.tiesPresent
        ? 'Tied values are present, so the exact lattice-path count does not apply; the asymptotic Kolmogorov distribution is used and is conservative in the presence of ties.'
        : `n₁·n₂ = ${product} exceeds the exact limit of ${KS_EXACT_MAX_PRODUCT}, so the asymptotic Kolmogorov distribution is used; it is accurate once the effective sample size √(n₁n₂/(n₁+n₂)) exceeds about 5.`,
    exactness: useExact ? 'exact' : 'numerical',
    effectSizes: [
      {
        name: 'D (largest vertical gap between the two empirical CDFs)',
        value: d,
        interpretation: `The cumulative proportions differ by at most ${(d * 100).toPrecision(3)} percentage points${Number.isFinite(at) ? `, at a value of about ${at.toPrecision(6)}` : ''}.`,
      },
    ],
    interval: null,
    assumptions: [
      'The two samples are independent.',
      'The underlying distributions are continuous (the exact route assumes no ties).',
    ],
    limitations: [
      ...P_VALUE_LIMITATIONS,
      'The test is sensitive to any difference — location, spread or shape — and does not say which. A significant result needs a look at the two CDFs to interpret.',
      'It is most sensitive near the middle of the distributions and comparatively blind in the tails.',
      ...(ties.tiesPresent ? ['With ties, the p-value reported here is conservative (too large).'] : []),
    ],
    notes: [`D = ${d.toPrecision(6)}, n₁ = ${n1}, n₂ = ${n2}, effective size √(n₁n₂/(n₁+n₂)) = ${en.toPrecision(4)}.`, ties.detail],
    ties,
    sensitivity: sensitivity(pValue, 1 - level, {
      kind: 'none',
      reason: 'the KS test has no single effect-size parameter, so sensitivity is read from D itself: an effect smaller than the sampling noise in D, roughly 1.36/√(n₁n₂/(n₁+n₂)) at the 5% level, would be missed.',
    }),
    groups: summarizeGroups(groups),
    diagnostics: { d, n1, n2, effectiveN: en, criticalD005: 1.36 / en },
  };
}

/**
 * Mood's median test: are the groups equally likely to fall above the pooled
 * median? Counting is "> pooled median" against "≤ pooled median", which is
 * the convention that keeps every observation in the table.
 */
export function moodMedianTest(
  groups: { label?: string; values: ArrayLike<number> }[],
  options: { level?: number } = {},
): NonparametricResult {
  const level = options.level ?? 0.95;
  const gs = requireGroups(groups, 2, 1, "Mood's median test");
  requireVariation(gs, "Mood's median test");
  const all = gs.flatMap((g) => g.values);
  const grandMedian = quantile(all, 0.5);
  const above = gs.map((g) => g.values.filter((v) => v > grandMedian).length);
  const atOrBelow = gs.map((g, i) => g.values.length - above[i]);
  const totalAbove = above.reduce((x, y) => x + y, 0);
  const n = all.length;
  if (totalAbove === 0 || totalAbove === n) {
    throw new EngineError(
      `Every observation falls on the same side of the pooled median (${grandMedian}), so the 2 × ${gs.length} table has an empty row and no statistic can be computed. This happens when more than half the data share a single value; use a rank test instead.`,
      'undefined',
    );
  }
  const k = gs.length;
  let stat = 0;
  let minExpected = Infinity;
  for (let i = 0; i < k; i++) {
    const ni = gs[i].values.length;
    const eAbove = (ni * totalAbove) / n;
    const eBelow = (ni * (n - totalAbove)) / n;
    minExpected = Math.min(minExpected, eAbove, eBelow);
    stat += (above[i] - eAbove) ** 2 / eAbove + (atOrBelow[i] - eBelow) ** 2 / eBelow;
  }
  const df = k - 1;
  const pValue = chiSquare.sf(stat, { k: df });
  const cramersV = Math.sqrt(stat / (n * Math.min(1, k - 1)));
  const ties = tieInfo(all, false, 'the median split');
  return {
    name: "Mood's median test",
    nullHypothesis: 'Every group has the same population median',
    alternativeHypothesis: 'At least one group has a different median',
    statistic: stat,
    statisticName: 'χ²',
    degreesOfFreedom: df,
    pValue,
    pValueRoute: 'asymptotic',
    pValueRouteReason: `The 2 × ${k} table of counts above and at-or-below the pooled median is referred to the χ² distribution with ${df} degree(s) of freedom. This needs every expected count to be about 5 or more; the smallest here is ${minExpected.toPrecision(3)}.`,
    exactness: 'numerical',
    effectSizes: [
      {
        name: "Cramér's V on the median split",
        value: cramersV,
        interpretation: `${interpretMagnitude(cramersV, 0.1, 0.3, 0.5)} association between group and being above the pooled median.`,
      },
    ],
    interval: null,
    assumptions: ['Observations are independent.', 'The counts are large enough for the χ² approximation.'],
    limitations: [
      ...P_VALUE_LIMITATIONS,
      'Reducing each observation to "above or not above the median" throws away most of the information in the data, so this test has markedly lower power than Kruskal–Wallis or Mann–Whitney. Its advantage is that it is unaffected by extreme outliers.',
      ...(minExpected < 5
        ? [`The smallest expected count is ${minExpected.toPrecision(3)}, below the usual minimum of 5, so this p-value is unreliable; use an exact test on the table.`]
        : []),
      ...(ties.tiesPresent ? ['Values exactly equal to the pooled median are counted in the "at or below" row, which makes the test slightly conservative.'] : []),
    ],
    notes: [
      `Pooled median = ${grandMedian.toPrecision(6)}.`,
      ...gs.map((g, i) => `${g.label}: ${above[i]} above, ${atOrBelow[i]} at or below (n = ${g.values.length}).`),
    ],
    ties,
    sensitivity: sensitivity(pValue, 1 - level, { kind: 'chi-square', df, n }),
    groups: summarizeGroups(gs),
    diagnostics: { chiSquare: stat, df, grandMedian, minExpected, totalAbove },
  };
}
