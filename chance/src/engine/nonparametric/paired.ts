/**
 * Tests for paired (matched) data: Wilcoxon signed rank, the sign test and
 * McNemar's test for paired binary outcomes.
 *
 * Pairing is information. Analysing paired data as two independent samples
 * throws away the within-pair matching and usually loses a great deal of
 * power, so these tests are not interchangeable with the two-sample ones.
 */
import { EngineError } from '../core/result';
import { chiSquare } from '../distributions/continuous';
import { binomial } from '../distributions/discrete';
import { clopperPearsonInterval, quantile, ranks } from '../stats/descriptive';
import { SIGNED_RANK_EXACT_MAX_N, signedRankExactP, signedRankNullDistribution } from './exact';
import {
  type Alternative,
  NO_TIES,
  P_VALUE_LIMITATIONS,
  alternativeText,
  interpretMagnitude,
  pFromZ,
  requirePairs,
  sensitivity,
  summarizeGroups,
  tieInfo,
} from './support';
import type { NonparametricInterval, NonparametricResult } from './types';

function differences(a: ArrayLike<number>, b: ArrayLike<number>, mu: number, what: string) {
  const pairs = requirePairs(a, b, what);
  const diffs = pairs.a.map((x, i) => x - pairs.b[i] - mu);
  return { pairs, diffs };
}

/**
 * Wilcoxon signed-rank test on the paired differences.
 *
 * Zero differences are removed and n is reduced accordingly — the standard
 * reduction. The exact null distribution of W⁺ is enumerated when there are no
 * ties among the absolute differences and n is small; otherwise the normal
 * approximation is used with the tie correction to the variance and a
 * continuity correction.
 */
export function wilcoxonSignedRankTest(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  options: { alternative?: Alternative; level?: number; mu?: number } = {},
): NonparametricResult {
  const alt = options.alternative ?? 'two-sided';
  const level = options.level ?? 0.95;
  const mu = options.mu ?? 0;
  const what = 'The Wilcoxon signed-rank test';
  const { pairs, diffs } = differences(a, b, mu, what);
  const nAll = diffs.length;
  const nonZero = diffs.filter((d) => d !== 0);
  const zeros = nAll - nonZero.length;
  const n = nonZero.length;
  if (n === 0) {
    throw new EngineError(
      `${what}: every one of the ${nAll} differences is exactly ${mu}, so there is nothing to rank and no statistic can be computed.`,
      'undefined',
    );
  }
  if (n < 2) {
    throw new EngineError(
      `${what}: only ${n} non-zero difference(s) remain after dropping ${zeros} zero difference(s); at least 2 are needed.`,
      'insufficient',
    );
  }
  const abs = nonZero.map(Math.abs);
  const r = ranks(abs);
  let wPlus = 0;
  let wMinus = 0;
  for (let i = 0; i < n; i++) {
    if (nonZero[i] > 0) wPlus += r[i];
    else wMinus += r[i];
  }
  const ties = tieInfo(abs, true, 'the variance of W⁺');
  const meanW = (n * (n + 1)) / 4;
  const varNoTies = (n * (n + 1) * (2 * n + 1)) / 24;
  const varW = varNoTies - ties.tieSum / 48;
  if (!(varW > 0)) {
    throw new EngineError('The variance of W⁺ is 0, so no test statistic can be computed.', 'undefined');
  }
  const sd = Math.sqrt(varW);
  const zUncorrected = (wPlus - meanW) / sd;
  let z: number;
  switch (alt) {
    case 'two-sided':
      z = Math.max(0, (Math.abs(wPlus - meanW) - 0.5) / sd) * Math.sign(wPlus - meanW || 1);
      break;
    case 'greater':
      z = (wPlus - meanW - 0.5) / sd;
      break;
    case 'less':
      z = (wPlus - meanW + 0.5) / sd;
      break;
  }
  const useExact = !ties.tiesPresent && n <= SIGNED_RANK_EXACT_MAX_N;
  const pValue = useExact ? signedRankExactP(wPlus, n, alt) : pFromZ(z, alt);
  // Hodges–Lehmann estimate of the median difference: the median of the Walsh
  // averages, with the interval obtained by inverting the signed-rank test.
  const walsh: number[] = [];
  for (let i = 0; i < n; i++) for (let j = i; j < n; j++) walsh.push((nonZero[i] + nonZero[j]) / 2);
  walsh.sort((p, q) => p - q);
  const M = walsh.length;
  const hl = quantile(walsh, 0.5) + mu;
  let interval: NonparametricInterval | null = null;
  if (n <= SIGNED_RANK_EXACT_MAX_N) {
    const { pmf } = signedRankNullDistribution(n);
    const alpha = 1 - level;
    let k = 0;
    let cum = 0;
    for (let w = 0; w < pmf.length; w++) {
      cum += pmf[w];
      if (cum <= alpha / 2) k = w + 1;
      else break;
    }
    if (2 * k < M) {
      interval = {
        low: walsh[k] + mu,
        high: walsh[M - 1 - k] + mu,
        level,
        of: 'the median paired difference (the location shift)',
        method: 'distribution-free, by inverting the exact signed-rank test over the Walsh averages',
        kind: 'estimate',
      };
    }
  }
  const rankBiserial = (wPlus - wMinus) / (wPlus + wMinus);
  const totalRank = (n * (n + 1)) / 2;
  return {
    name: 'Wilcoxon signed-rank test',
    nullHypothesis:
      mu === 0
        ? 'The distribution of the paired differences is symmetric about 0'
        : `The distribution of the paired differences is symmetric about ${mu}`,
    alternativeHypothesis: alternativeText(alt, 'The centre of the paired differences'),
    statistic: wPlus,
    statisticName: 'W⁺',
    degreesOfFreedom: null,
    pValue,
    pValueRoute: useExact ? 'exact' : 'asymptotic',
    pValueRouteReason: useExact
      ? `No ties among the absolute differences and n = ${n} ≤ ${SIGNED_RANK_EXACT_MAX_N}, so the exact null distribution of W⁺ was enumerated over all 2^${n} = ${(2 ** n).toLocaleString('en-US')} sign patterns.`
      : ties.tiesPresent
        ? 'Tied absolute differences are present, so the exact sign-pattern enumeration does not apply. The normal approximation is used with the tie correction to the variance and a continuity correction; it is trustworthy from about n ≥ 20.'
        : `n = ${n} exceeds the exact limit of ${SIGNED_RANK_EXACT_MAX_N}, so the normal approximation with a continuity correction is used; it is trustworthy from about n ≥ 20.`,
    exactness: useExact ? 'exact' : 'numerical',
    effectSizes: [
      {
        name: 'Matched-pairs rank-biserial correlation',
        value: rankBiserial,
        interpretation: `${interpretMagnitude(rankBiserial, 0.1, 0.3, 0.5)} (r = ${rankBiserial.toPrecision(3)}): the signed rank mass favouring increases minus that favouring decreases, as a proportion of the total.`,
      },
      {
        name: 'Hodges–Lehmann median difference',
        value: hl,
        interpretation: `The median of the ${M} Walsh averages is ${hl.toPrecision(6)} in the units of the data.`,
        interval,
      },
      {
        name: 'Proportion of pairs that increased',
        value: nonZero.filter((d) => d > 0).length / n,
        interpretation: `${nonZero.filter((d) => d > 0).length} of ${n} non-zero differences are positive.`,
      },
    ],
    interval,
    assumptions: [
      'Pairs are independent of one another.',
      'The differences are measured on at least an interval-like scale so that their magnitudes can be ranked.',
      'The distribution of the differences is symmetric about its centre — this is what makes the test a test of the median difference rather than only of symmetry.',
      'No normality is assumed.',
    ],
    limitations: [
      ...P_VALUE_LIMITATIONS,
      'If the differences are not symmetric, a rejection may reflect the asymmetry rather than a shift in location. The sign test needs no symmetry assumption and is the fallback.',
      ...(zeros > 0
        ? [
            `${zeros} zero difference(s) were dropped and n reduced to ${n} (the standard reduction). This conditions on the non-zero pairs; Pratt's alternative, which keeps them, can give a different p-value.`,
          ]
        : []),
      ...(ties.tiesPresent ? ['Tied absolute differences force the asymptotic route; with many ties, a permutation test is preferable.'] : []),
    ],
    notes: [
      `W⁺ = ${wPlus}, W⁻ = ${wMinus}, W⁺ + W⁻ = ${totalRank}, n = ${n} non-zero difference(s) out of ${nAll} pair(s).`,
      ties.detail,
      ...(ties.tiesPresent ? [`Variance of W⁺: ${varW.toPrecision(8)} with the tie correction, ${varNoTies.toPrecision(8)} without.`] : []),
    ],
    ties,
    sensitivity: sensitivity(pValue, 1 - level, { kind: 'one-sample', n, rank: true }),
    groups: summarizeGroups([
      { label: 'First measurement', values: pairs.a },
      { label: 'Second measurement', values: pairs.b },
      { label: 'Differences', values: diffs.map((d) => d + mu) },
    ]),
    diagnostics: {
      wPlus,
      wMinus,
      n,
      zerosDropped: zeros,
      z,
      zUncorrected,
      varianceW: varW,
      varianceWNoTieCorrection: varNoTies,
      tieSum: ties.tieSum,
      hodgesLehmann: hl,
    },
  };
}

/**
 * Sign test on the paired differences: exact binomial, assuming only that each
 * difference is independently positive or negative with probability ½ under
 * the null. It needs no symmetry and no scale beyond ordering.
 */
export function signTest(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  options: { alternative?: Alternative; level?: number; mu?: number } = {},
): NonparametricResult {
  const alt = options.alternative ?? 'two-sided';
  const level = options.level ?? 0.95;
  const mu = options.mu ?? 0;
  const what = 'The sign test';
  const { pairs, diffs } = differences(a, b, mu, what);
  const positives = diffs.filter((d) => d > 0).length;
  const negatives = diffs.filter((d) => d < 0).length;
  const zeros = diffs.length - positives - negatives;
  const n = positives + negatives;
  if (n === 0) {
    throw new EngineError(
      `${what}: all ${diffs.length} differences are exactly ${mu}, so there are no signs to count and no statistic can be computed.`,
      'undefined',
    );
  }
  const params = { n, p: 0.5 };
  let pValue: number;
  switch (alt) {
    case 'greater':
      pValue = binomial.sf(positives - 1, params);
      break;
    case 'less':
      pValue = binomial.cdf(positives, params);
      break;
    case 'two-sided': {
      const k = Math.min(positives, negatives);
      pValue = Math.min(1, 2 * binomial.cdf(k, params));
      break;
    }
  }
  const prop = positives / n;
  const propCi = clopperPearsonInterval(positives, n, level);
  // Distribution-free interval for the median difference from the order
  // statistics of the differences (the inverted sign test).
  const sortedDiffs = [...diffs].sort((p, q) => p - q);
  const alpha = 1 - level;
  const nd = diffs.length;
  let kk = 0;
  let cum = 0;
  for (let m = 0; m < nd; m++) {
    cum += binomial.pdf(m, { n: nd, p: 0.5 });
    if (cum <= alpha / 2) kk = m + 1;
    else break;
  }
  const interval: NonparametricInterval | null =
    2 * kk < nd
      ? {
          low: sortedDiffs[kk] + mu,
          high: sortedDiffs[nd - 1 - kk] + mu,
          level,
          of: 'the population median of the paired differences',
          method: 'distribution-free order-statistic interval (inverted sign test); its actual coverage is at least the stated level and is discrete, so it is usually a little wider',
          kind: 'estimate',
        }
      : null;
  const median = quantile(diffs, 0.5) + mu;
  return {
    name: 'Sign test',
    nullHypothesis: `The median paired difference is ${mu}: a difference is equally likely to be positive or negative`,
    alternativeHypothesis: alternativeText(alt, 'The median paired difference'),
    statistic: positives,
    statisticName: 'number of positive differences',
    degreesOfFreedom: null,
    pValue,
    pValueRoute: 'exact',
    pValueRouteReason: `Under the null the number of positive differences is Binomial(${n}, ½), so the p-value is an exact binomial tail probability — no approximation is involved at any sample size.`,
    exactness: 'exact',
    effectSizes: [
      {
        name: 'Proportion of pairs that increased',
        value: prop,
        interpretation: `${positives} of ${n} non-zero differences are positive (${(prop * 100).toPrecision(3)}%); ½ is no effect.`,
        interval: { low: propCi.low, high: propCi.high, level, of: 'the probability that a pair increases', method: propCi.method, kind: 'estimate' },
      },
      {
        name: 'Median difference',
        value: median,
        interpretation: `The sample median of the differences is ${median.toPrecision(6)}.`,
        interval,
      },
    ],
    interval,
    assumptions: [
      'Pairs are independent of one another.',
      'The differences are measured on at least an ordinal scale.',
      'No symmetry and no normality are assumed — this is the least demanding paired test available.',
    ],
    limitations: [
      ...P_VALUE_LIMITATIONS,
      'The test uses only the direction of each difference, not its size, so it has lower power than the signed-rank test when the differences are symmetric. A pair that changed enormously counts the same as one that barely changed.',
      ...(zeros > 0 ? [`${zeros} difference(s) of exactly ${mu} were excluded; the test is conditional on the ${n} non-zero pairs.`] : []),
    ],
    notes: [`${positives} positive, ${negatives} negative, ${zeros} zero out of ${diffs.length} pair(s).`],
    ties: {
      ...NO_TIES,
      tiesPresent: zeros > 0,
      detail: zeros > 0 ? `${zeros} pair(s) tied at exactly ${mu} and were excluded from the count.` : 'No pairs are exactly tied.',
    },
    sensitivity: sensitivity(pValue, 1 - level, { kind: 'one-sample', n, rank: true }),
    groups: summarizeGroups([
      { label: 'First measurement', values: pairs.a },
      { label: 'Second measurement', values: pairs.b },
      { label: 'Differences', values: diffs.map((d) => d + mu) },
    ]),
    diagnostics: { positives, negatives, zeros, n, proportion: prop, median },
  };
}

/**
 * McNemar's test for paired binary data, given the 2 × 2 table of paired
 * outcomes [[both yes, yes→no], [no→yes, both no]].
 *
 * Only the discordant cells carry information; the concordant pairs cancel.
 * Three p-values are reported: the exact binomial, its mid-p variant (which
 * removes most of the conservativeness of the exact test while keeping its
 * validity in practice), and the continuity-corrected χ².
 */
export function mcnemarTest(
  table: number[][],
  options: { alternative?: Alternative; level?: number; variant?: 'exact' | 'mid-p' | 'chi-square' } = {},
): NonparametricResult {
  const alt = options.alternative ?? 'two-sided';
  const level = options.level ?? 0.95;
  const variant = options.variant ?? 'exact';
  if (table.length !== 2 || table[0].length !== 2 || table[1].length !== 2) {
    throw new EngineError("McNemar's test needs a 2 × 2 table of paired counts.", 'shape');
  }
  for (const row of table) {
    for (const v of row) {
      if (!Number.isInteger(v) || v < 0) throw new EngineError('Paired counts must be whole numbers of 0 or more.', 'range');
    }
  }
  const [[n11, b], [c, n22]] = table as [[number, number], [number, number]];
  const discordant = b + c;
  const total = n11 + b + c + n22;
  if (total === 0) throw new EngineError('The table is empty.', 'empty');
  if (discordant === 0) {
    throw new EngineError(
      `All ${total} pairs are concordant (no pair changed), so there is no information about a change and no test statistic can be computed. McNemar's test uses only the discordant cells.`,
      'undefined',
    );
  }
  const params = { n: discordant, p: 0.5 };
  const exactTwoSided = Math.min(1, 2 * binomial.cdf(Math.min(b, c), params));
  const kMin = Math.min(b, c);
  const midP = Math.min(1, 2 * (binomial.cdf(kMin - 1, params) + 0.5 * binomial.pdf(kMin, params)));
  const exactP =
    alt === 'greater' ? binomial.sf(b - 1, params) : alt === 'less' ? binomial.cdf(b, params) : exactTwoSided;
  const midPp =
    alt === 'greater'
      ? binomial.sf(b, params) + 0.5 * binomial.pdf(b, params)
      : alt === 'less'
        ? binomial.cdf(b - 1, params) + 0.5 * binomial.pdf(b, params)
        : midP;
  const chiCorrected = (Math.abs(b - c) - 1) ** 2 / discordant;
  const chiUncorrected = (b - c) ** 2 / discordant;
  const chiP = chiSquare.sf(Math.max(0, chiCorrected), { k: 1 });
  const chosen = variant === 'exact' ? exactP : variant === 'mid-p' ? midPp : alt === 'two-sided' ? chiP : pFromZ(Math.sign(b - c) * Math.sqrt(chiCorrected), alt);
  const route = variant === 'chi-square' ? 'asymptotic' : 'exact';
  // Conditional odds ratio b/c, with an exact interval from the binomial
  // proportion b/(b+c): OR = p/(1−p).
  const propCi = clopperPearsonInterval(b, discordant, level);
  const orInterval: NonparametricInterval | null =
    propCi.low > 0 || propCi.high < 1
      ? {
          low: propCi.low <= 0 ? 0 : propCi.low / (1 - propCi.low),
          high: propCi.high >= 1 ? Infinity : propCi.high / (1 - propCi.high),
          level,
          of: 'the conditional odds ratio for change (b/c)',
          method: 'exact, from the Clopper–Pearson interval for b/(b+c)',
          kind: 'estimate',
        }
      : null;
  const or = c === 0 ? Infinity : b / c;
  const riskDifference = (b - c) / total;
  return {
    name: `McNemar's test (${variant === 'chi-square' ? 'continuity-corrected χ²' : variant === 'mid-p' ? 'mid-p' : 'exact binomial'})`,
    nullHypothesis: 'The two paired measurements have the same marginal probability — changes in each direction are equally likely',
    alternativeHypothesis: alternativeText(alt, 'The probability of changing one way rather than the other'),
    statistic: variant === 'chi-square' ? chiCorrected : b,
    statisticName: variant === 'chi-square' ? 'χ² (continuity corrected)' : 'b (changes in one direction)',
    degreesOfFreedom: variant === 'chi-square' ? 1 : null,
    pValue: chosen,
    pValueRoute: route,
    pValueRouteReason:
      variant === 'chi-square'
        ? `The χ² form with Yates's continuity correction is used; it needs b + c ≥ about 25 and here b + c = ${discordant}${discordant < 25 ? ', which is too few — prefer the exact or mid-p value' : ''}.`
        : variant === 'mid-p'
          ? `Conditional on the ${discordant} discordant pairs, b is Binomial(${discordant}, ½). The mid-p value counts half the probability of the observed outcome, which removes most of the exact test's conservativeness.`
          : `Conditional on the ${discordant} discordant pairs, b is Binomial(${discordant}, ½), so the p-value is an exact binomial tail probability. It is slightly conservative because the distribution is discrete.`,
    exactness: variant === 'chi-square' ? 'numerical' : 'exact',
    effectSizes: [
      {
        name: 'Conditional odds ratio for change',
        value: or,
        interpretation:
          c === 0
            ? `Every one of the ${discordant} discordant pairs changed in the same direction, so the odds ratio is unbounded.`
            : `Among pairs that changed, a change in the first direction is ${or.toPrecision(3)} times as likely as one in the other.`,
        interval: orInterval,
      },
      {
        name: 'Difference in marginal proportions',
        value: riskDifference,
        interpretation: `The marginal proportion differs by ${(riskDifference * 100).toPrecision(3)} percentage points across all ${total} pairs.`,
      },
    ],
    interval: orInterval,
    assumptions: ['Pairs are independent of one another.', 'Each member of a pair has a binary outcome.'],
    limitations: [
      ...P_VALUE_LIMITATIONS,
      'Only the discordant pairs contribute, so a large study with few changes carries little information however many pairs it has.',
      'The test compares the marginal probabilities; it says nothing about agreement between the two measurements.',
    ],
    notes: [
      `Discordant pairs: b = ${b}, c = ${c} (total ${discordant}); concordant: ${n11} and ${n22}; ${total} pairs in all.`,
      `Exact p = ${exactP.toPrecision(6)}, mid-p = ${midPp.toPrecision(6)}, continuity-corrected χ² = ${chiCorrected.toPrecision(6)} (p = ${chiP.toPrecision(6)}), uncorrected χ² = ${chiUncorrected.toPrecision(6)}.`,
    ],
    ties: { ...NO_TIES, detail: 'Concordant pairs carry no information and are excluded by construction, not by a tie rule.' },
    sensitivity: sensitivity(chosen, 1 - level, { kind: 'chi-square', df: 1, n: discordant }),
    groups: [],
    diagnostics: {
      b,
      c,
      discordant,
      total,
      exactP,
      midP: midPp,
      chiSquareCorrected: chiCorrected,
      chiSquareUncorrected: chiUncorrected,
      chiSquareP: chiP,
      oddsRatio: or,
    },
  };
}
