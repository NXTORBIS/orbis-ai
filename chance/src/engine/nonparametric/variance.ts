/**
 * Tests for equality of variance (homoscedasticity).
 *
 * These are usually run as a gate before choosing between the classical and
 * the Welch form of a test. That use has a trap: with small samples they have
 * little power to detect the heteroscedasticity that matters, and with large
 * samples they flag differences that do not. Preferring the heteroscedastic
 * test unconditionally is the more robust habit; these tests are for
 * describing the spreads, not for licensing a fragile assumption.
 */
import { EngineError } from '../core/result';
import { chiSquare } from '../distributions/continuous';
import { mean, quantile, ranks, variance } from '../stats/descriptive';
import { fSurvival } from '../stats/tests';
import { normalQuantile } from '../special/gamma';
import type { GroupInput } from './multiGroup';
import {
  P_VALUE_LIMITATIONS,
  requireGroups,
  sensitivity,
  summarizeGroups,
  tieInfo,
} from './support';
import type { NonparametricResult } from './types';

const SHARED_LIMITATION =
  'Using a variance test to decide whether to use the equal-variance version of another test makes the second p-value conditional on the first, which invalidates its stated level. Choose the heteroscedastic version on design grounds instead.';

/**
 * Levene's test. With `center: 'median'` it is the Brown–Forsythe variant,
 * which is markedly more robust to non-normality and is the better default.
 */
export function leveneTest(
  groups: GroupInput[],
  options: { center?: 'mean' | 'median'; level?: number } = {},
): NonparametricResult {
  const center = options.center ?? 'median';
  const level = options.level ?? 0.95;
  const name = center === 'median' ? "Levene's test (median-centred: Brown–Forsythe)" : "Levene's test (mean-centred)";
  const gs = requireGroups(groups, 2, 2, name);
  const k = gs.length;
  const sizes = gs.map((g) => g.values.length);
  const n = sizes.reduce((a, b) => a + b, 0);
  const centers = gs.map((g) => (center === 'median' ? quantile(g.values, 0.5) : mean(g.values)));
  const z = gs.map((g, i) => g.values.map((v) => Math.abs(v - centers[i])));
  const zMeans = z.map((zi) => mean(zi));
  const zGrand = mean(z.flat());
  let ssBetween = 0;
  let ssWithin = 0;
  for (let i = 0; i < k; i++) {
    ssBetween += sizes[i] * (zMeans[i] - zGrand) ** 2;
    for (const v of z[i]) ssWithin += (v - zMeans[i]) ** 2;
  }
  if (!(ssWithin > 0)) {
    throw new EngineError(
      `${name}: the absolute deviations from the group ${center}s are identical within every group, so the test statistic is infinite or undefined. This happens with perfectly regular data such as two-point groups.`,
      'undefined',
    );
  }
  const df1 = k - 1;
  const df2 = n - k;
  const f = ssBetween / df1 / (ssWithin / df2);
  const pValue = fSurvival(f, df1, df2);
  const sds = gs.map((g) => Math.sqrt(variance(g.values)));
  const ratio = Math.max(...sds) ** 2 / Math.min(...sds) ** 2;
  return {
    name,
    nullHypothesis: 'Every group has the same population variance',
    alternativeHypothesis: 'At least one group has a different variance',
    statistic: f,
    statisticName: 'W (F statistic on absolute deviations)',
    degreesOfFreedom: [df1, df2],
    pValue,
    pValueRoute: 'asymptotic',
    pValueRouteReason:
      'The F distribution is used for the one-way analysis of the absolute deviations. This is an approximation even under normality, reasonable from about 10 observations per group.',
    exactness: 'numerical',
    effectSizes: [
      {
        name: 'Largest-to-smallest variance ratio',
        value: ratio,
        interpretation:
          ratio < 2
            ? `The variances differ by a factor of ${ratio.toPrecision(3)}, which the classical equal-variance tests tolerate well when the groups are of similar size.`
            : `The variances differ by a factor of ${ratio.toPrecision(3)}. Beyond about 2, and especially with unequal group sizes, the equal-variance F test and pooled t test become unreliable; use Welch's versions.`,
      },
    ],
    interval: null,
    assumptions: [
      'Observations are independent.',
      center === 'median'
        ? 'No normality assumption of consequence: centring on the median makes the test robust to skewed and heavy-tailed data.'
        : 'Approximate normality — the mean-centred form is sensitive to skew and outliers, which is why the median-centred (Brown–Forsythe) version is usually preferred.',
    ],
    limitations: [...P_VALUE_LIMITATIONS, SHARED_LIMITATION],
    notes: [
      `Group SDs: ${gs.map((g, i) => `${g.label} ${sds[i].toPrecision(5)}`).join(', ')}.`,
      `Mean absolute deviation from the group ${center}: ${gs.map((g, i) => `${g.label} ${zMeans[i].toPrecision(5)}`).join(', ')}.`,
    ],
    ties: { tiesPresent: false, correctionApplied: false, tiedGroups: 0, detail: 'Ties do not affect this statistic.' },
    sensitivity: sensitivity(pValue, 1 - level, { kind: 'anova', groupSizes: sizes }),
    groups: summarizeGroups(gs),
    diagnostics: { f, df1, df2, varianceRatio: ratio, ssBetween, ssWithin },
  };
}

/** Bartlett's test for equal variances (optimal under normality, fragile otherwise). */
export function bartlettTest(groups: GroupInput[], options: { level?: number } = {}): NonparametricResult {
  const level = options.level ?? 0.95;
  const gs = requireGroups(groups, 2, 2, "Bartlett's test");
  const k = gs.length;
  const sizes = gs.map((g) => g.values.length);
  const vars = gs.map((g) => variance(g.values));
  gs.forEach((g, i) => {
    if (!(vars[i] > 0)) {
      throw new EngineError(
        `Bartlett's test takes the logarithm of each group variance, so group "${g.label}" having zero variance makes the statistic infinite. Every group must vary.`,
        'undefined',
      );
    }
  });
  const n = sizes.reduce((a, b) => a + b, 0);
  const pooled = sizes.reduce((acc, ni, i) => acc + (ni - 1) * vars[i], 0) / (n - k);
  const numerator = (n - k) * Math.log(pooled) - sizes.reduce((acc, ni, i) => acc + (ni - 1) * Math.log(vars[i]), 0);
  const c = 1 + (1 / (3 * (k - 1))) * (sizes.reduce((acc, ni) => acc + 1 / (ni - 1), 0) - 1 / (n - k));
  const stat = numerator / c;
  const df = k - 1;
  const pValue = chiSquare.sf(Math.max(0, stat), { k: df });
  const ratio = Math.max(...vars) / Math.min(...vars);
  return {
    name: "Bartlett's test",
    nullHypothesis: 'Every group has the same population variance',
    alternativeHypothesis: 'At least one group has a different variance',
    statistic: stat,
    statisticName: "Bartlett's K²",
    degreesOfFreedom: df,
    pValue,
    pValueRoute: 'asymptotic',
    pValueRouteReason: `K² is referred to the χ² distribution with ${df} degree(s) of freedom; the approximation needs about 5 or more observations per group (the smallest here is ${Math.min(...sizes)}).`,
    exactness: 'numerical',
    effectSizes: [
      {
        name: 'Largest-to-smallest variance ratio',
        value: ratio,
        interpretation: `The variances differ by a factor of ${ratio.toPrecision(3)}; pooled variance ${pooled.toPrecision(6)}.`,
      },
    ],
    interval: null,
    assumptions: [
      'Observations are independent.',
      'Each group is normally distributed. This is a strong requirement and the test is not approximately valid without it.',
    ],
    limitations: [
      ...P_VALUE_LIMITATIONS,
      "Bartlett's test is extremely sensitive to departures from normality: heavy tails or skew make it reject far too often, so a significant result may be telling you about the shape of the data rather than about its spread. Under exact normality it is the most powerful of these tests; otherwise prefer the median-centred Levene (Brown–Forsythe) or Fligner–Killeen test.",
      SHARED_LIMITATION,
    ],
    notes: [
      `Group variances: ${gs.map((g, i) => `${g.label} ${vars[i].toPrecision(6)}`).join(', ')}.`,
      `Correction factor C = ${c.toPrecision(6)}; uncorrected statistic ${numerator.toPrecision(6)}.`,
    ],
    ties: { tiesPresent: false, correctionApplied: false, tiedGroups: 0, detail: 'Ties do not affect this statistic.' },
    sensitivity: sensitivity(pValue, 1 - level, { kind: 'anova', groupSizes: sizes }),
    groups: summarizeGroups(gs),
    diagnostics: { statistic: stat, df, pooledVariance: pooled, correction: c, varianceRatio: ratio },
  };
}

/**
 * Fligner–Killeen test: a rank-based test of equal variances, built from the
 * normal scores of the pooled absolute deviations from the group medians. It
 * is the most robust of the three to non-normality.
 */
export function flignerKilleenTest(groups: GroupInput[], options: { level?: number } = {}): NonparametricResult {
  const level = options.level ?? 0.95;
  const gs = requireGroups(groups, 2, 2, 'The Fligner–Killeen test');
  const k = gs.length;
  const sizes = gs.map((g) => g.values.length);
  const n = sizes.reduce((a, b) => a + b, 0);
  const medians = gs.map((g) => quantile(g.values, 0.5));
  const deviations = gs.flatMap((g, i) => g.values.map((v) => Math.abs(v - medians[i])));
  if (deviations.every((d) => d === deviations[0])) {
    throw new EngineError(
      'Every absolute deviation from the group medians is identical, so the normal scores are all equal and the Fligner–Killeen statistic is undefined.',
      'undefined',
    );
  }
  const r = ranks(deviations);
  const scores = Array.from(r, (rank) => normalQuantile(0.5 + rank / (2 * (n + 1))));
  const grandScore = mean(scores);
  const v2 = variance(scores);
  if (!(v2 > 0)) throw new EngineError('The normal scores do not vary, so the statistic is undefined.', 'undefined');
  let stat = 0;
  const groupScoreMeans: number[] = [];
  let offset = 0;
  for (let i = 0; i < k; i++) {
    let sum = 0;
    for (let j = 0; j < sizes[i]; j++) sum += scores[offset + j];
    offset += sizes[i];
    const m = sum / sizes[i];
    groupScoreMeans.push(m);
    stat += sizes[i] * (m - grandScore) ** 2;
  }
  stat /= v2;
  const df = k - 1;
  const pValue = chiSquare.sf(stat, { k: df });
  const ties = tieInfo(deviations, false, 'the ranks of the absolute deviations');
  return {
    name: 'Fligner–Killeen test',
    nullHypothesis: 'Every group has the same population variance',
    alternativeHypothesis: 'At least one group has a different variance',
    statistic: stat,
    statisticName: 'χ² (Fligner–Killeen)',
    degreesOfFreedom: df,
    pValue,
    pValueRoute: 'asymptotic',
    pValueRouteReason: `The statistic is referred to the χ² distribution with ${df} degree(s) of freedom; the rank-based construction makes the approximation reliable from about 10 observations per group.`,
    exactness: 'numerical',
    effectSizes: [
      {
        name: 'Spread of the mean normal scores',
        value: Math.max(...groupScoreMeans) - Math.min(...groupScoreMeans),
        interpretation: `The group mean normal scores range over ${(Math.max(...groupScoreMeans) - Math.min(...groupScoreMeans)).toPrecision(3)}; larger means more unequal spreads. Group mean scores: ${gs.map((g, i) => `${g.label} ${groupScoreMeans[i].toPrecision(4)}`).join(', ')}.`,
      },
    ],
    interval: null,
    assumptions: [
      'Observations are independent.',
      'No normality assumption: only the ranks of the absolute deviations from the group medians are used.',
    ],
    limitations: [
      ...P_VALUE_LIMITATIONS,
      'Because it works on ranks it is the most robust of the variance tests to outliers and skew, at some cost in power when the data really are normal.',
      SHARED_LIMITATION,
      ...(ties.tiesPresent
        ? ['Tied absolute deviations are handled with midranks; the variance of the scores is estimated from the observed scores, so ties are absorbed rather than separately corrected.']
        : []),
    ],
    notes: [
      `Group medians: ${gs.map((g, i) => `${g.label} ${medians[i].toPrecision(6)}`).join(', ')}.`,
      `Variance of the normal scores V² = ${v2.toPrecision(6)}.`,
      ties.detail,
    ],
    ties,
    sensitivity: sensitivity(pValue, 1 - level, { kind: 'anova', groupSizes: sizes }),
    groups: summarizeGroups(gs),
    diagnostics: { statistic: stat, df, scoreVariance: v2, grandScore },
  };
}
