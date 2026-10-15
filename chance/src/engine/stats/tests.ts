/**
 * Classical hypothesis tests.
 *
 * Every result reports the test statistic, degrees of freedom, p-value, the
 * exact hypotheses being compared, and an effect-size measure, because a
 * p-value on its own says nothing about how large a difference is.
 *
 * A p-value is the probability of a test statistic at least as extreme as the
 * observed one, assuming the null hypothesis is true. It is not the
 * probability that the null hypothesis is true, and it is not the probability
 * that the result occurred by chance.
 */
import { EngineError } from '../core/result';
import { chiSquare, normal, studentT } from '../distributions/continuous';
import { incompleteBeta } from '../special/gamma';
import { mean, pearson, ranks, sortedCopy, variance } from './descriptive';

export interface TestResult {
  name: string;
  nullHypothesis: string;
  alternativeHypothesis: string;
  statistic: number;
  statisticName: string;
  degreesOfFreedom: number | [number, number] | null;
  pValue: number;
  /** Effect size with its name, e.g. Cohen's d. */
  effectSize: { name: string; value: number; interpretation: string } | null;
  /** Confidence interval for the estimated difference, where defined. */
  interval: { low: number; high: number; level: number; of: string } | null;
  assumptions: string[];
  limitations: string[];
  notes: string[];
}

export type Alternative = 'two-sided' | 'greater' | 'less';

function alternativeText(alt: Alternative, what: string): string {
  switch (alt) {
    case 'two-sided':
      return `${what} differs from the null value`;
    case 'greater':
      return `${what} is greater than the null value`;
    case 'less':
      return `${what} is less than the null value`;
  }
}

function pFromT(t: number, df: number, alt: Alternative): number {
  const params = { nu: df, mu: 0, sigma: 1 };
  switch (alt) {
    case 'greater':
      return studentT.sf(t, params);
    case 'less':
      return studentT.cdf(t, params);
    case 'two-sided':
      return 2 * studentT.sf(Math.abs(t), params);
  }
}

function pFromZ(z: number, alt: Alternative): number {
  const params = { mu: 0, sigma: 1 };
  switch (alt) {
    case 'greater':
      return normal.sf(z, params);
    case 'less':
      return normal.cdf(z, params);
    case 'two-sided':
      return 2 * normal.sf(Math.abs(z), params);
  }
}

const P_VALUE_LIMITATIONS = [
  'A p-value is the probability of seeing a result at least this extreme if the null hypothesis were true. It is not the probability that the null hypothesis is true.',
  'A result that is statistically significant is not necessarily large or important. Read the effect size and the interval alongside the p-value.',
  'A large p-value is not evidence that the null hypothesis is true; it means this data does not distinguish it from the alternative.',
];

/** One-sample t test for a mean. */
export function oneSampleTTest(data: ArrayLike<number>, nullMean: number, alt: Alternative = 'two-sided', level = 0.95): TestResult {
  const n = data.length;
  if (n < 2) throw new EngineError('A one-sample t test needs at least 2 observations.', 'insufficient');
  if (!Number.isFinite(nullMean)) throw new EngineError('The null-hypothesis mean must be a finite number.', 'finite');
  const m = mean(data);
  const s = Math.sqrt(variance(data));
  if (!(s > 0)) {
    throw new EngineError(
      'Every observation is identical, so the sample standard deviation is 0 and the t statistic is undefined.',
      'undefined',
    );
  }
  const se = s / Math.sqrt(n);
  const t = (m - nullMean) / se;
  const df = n - 1;
  const tCrit = studentT.quantile(0.5 + level / 2, { nu: df, mu: 0, sigma: 1 });
  const d = (m - nullMean) / s;
  return {
    name: 'One-sample t test',
    nullHypothesis: `The population mean equals ${nullMean}`,
    alternativeHypothesis: alternativeText(alt, 'The population mean'),
    statistic: t,
    statisticName: 't',
    degreesOfFreedom: df,
    pValue: pFromT(t, df, alt),
    effectSize: { name: "Cohen's d", value: d, interpretation: interpretCohensD(d) },
    interval: { low: m - tCrit * se, high: m + tCrit * se, level, of: 'the population mean' },
    assumptions: [
      'Observations are independent.',
      'The sample mean is approximately normally distributed — satisfied when the data are roughly normal, or when the sample is large enough for the central limit theorem.',
    ],
    limitations: [...P_VALUE_LIMITATIONS, ...(n < 15 ? ['With fewer than about 15 observations this test is sensitive to outliers and to skew in the data.'] : [])],
    notes: [`Sample mean ${m.toPrecision(6)}, standard deviation ${s.toPrecision(6)}, n = ${n}.`],
  };
}

/** Welch's two-sample t test (does not assume equal variances). */
export function welchTTest(a: ArrayLike<number>, b: ArrayLike<number>, alt: Alternative = 'two-sided', level = 0.95): TestResult {
  if (a.length < 2 || b.length < 2) throw new EngineError('Each group needs at least 2 observations.', 'insufficient');
  const ma = mean(a);
  const mb = mean(b);
  const va = variance(a);
  const vb = variance(b);
  const na = a.length;
  const nb = b.length;
  if (!(va > 0) || !(vb > 0)) {
    if (va === 0 && vb === 0) throw new EngineError('Both groups have zero variance, so no test statistic can be computed.', 'undefined');
  }
  const se = Math.sqrt(va / na + vb / nb);
  if (!(se > 0)) throw new EngineError('The standard error is 0, so the t statistic is undefined.', 'undefined');
  const t = (ma - mb) / se;
  // Welch–Satterthwaite degrees of freedom.
  const df = (va / na + vb / nb) ** 2 / (va ** 2 / (na ** 2 * (na - 1)) + vb ** 2 / (nb ** 2 * (nb - 1)));
  const tCrit = studentT.quantile(0.5 + level / 2, { nu: df, mu: 0, sigma: 1 });
  // Pooled SD for Cohen's d (reported even though the test is unpooled).
  const pooledSd = Math.sqrt(((na - 1) * va + (nb - 1) * vb) / (na + nb - 2));
  const d = pooledSd > 0 ? (ma - mb) / pooledSd : NaN;
  return {
    name: "Welch's two-sample t test",
    nullHypothesis: 'The two populations have the same mean',
    alternativeHypothesis: alternativeText(alt, 'The difference in means'),
    statistic: t,
    statisticName: 't',
    degreesOfFreedom: df,
    pValue: pFromT(t, df, alt),
    effectSize: { name: "Cohen's d", value: d, interpretation: interpretCohensD(d) },
    interval: { low: ma - mb - tCrit * se, high: ma - mb + tCrit * se, level, of: 'the difference in means (group A − group B)' },
    assumptions: [
      'The two groups are independent of each other, and observations within each group are independent.',
      'Each group mean is approximately normally distributed.',
      "Welch's test does not assume the two variances are equal.",
    ],
    limitations: [
      ...P_VALUE_LIMITATIONS,
      'This compares means. Two groups can have the same mean and still differ in spread or shape.',
    ],
    notes: [
      `Group A: n = ${na}, mean ${ma.toPrecision(6)}, SD ${Math.sqrt(va).toPrecision(6)}.`,
      `Group B: n = ${nb}, mean ${mb.toPrecision(6)}, SD ${Math.sqrt(vb).toPrecision(6)}.`,
      `Degrees of freedom are fractional (${df.toPrecision(5)}) because Welch's correction is used.`,
    ],
  };
}

/** Paired t test on matched observations. */
export function pairedTTest(a: ArrayLike<number>, b: ArrayLike<number>, alt: Alternative = 'two-sided', level = 0.95): TestResult {
  if (a.length !== b.length) throw new EngineError('A paired test needs the same number of observations in both columns.', 'shape');
  const diffs: number[] = [];
  for (let i = 0; i < a.length; i++) {
    if (Number.isFinite(a[i]) && Number.isFinite(b[i])) diffs.push(a[i] - b[i]);
  }
  if (diffs.length < 2) throw new EngineError('At least 2 complete pairs are needed.', 'insufficient');
  const r = oneSampleTTest(diffs, 0, alt, level);
  return {
    ...r,
    name: 'Paired t test',
    nullHypothesis: 'The mean difference between the paired observations is 0',
    alternativeHypothesis: alternativeText(alt, 'The mean difference'),
    interval: r.interval ? { ...r.interval, of: 'the mean paired difference' } : null,
    assumptions: ['Pairs are independent of one another.', 'The mean of the differences is approximately normally distributed.'],
    notes: [
      `${diffs.length} complete pair(s) used${a.length - diffs.length > 0 ? `; ${a.length - diffs.length} incomplete pair(s) excluded` : ''}.`,
      `Mean difference ${mean(diffs).toPrecision(6)}.`,
    ],
  };
}

/** Two-proportion z test. */
export function twoProportionTest(
  successesA: number,
  nA: number,
  successesB: number,
  nB: number,
  alt: Alternative = 'two-sided',
  level = 0.95,
): TestResult {
  for (const [s, n, label] of [[successesA, nA, 'A'], [successesB, nB, 'B']] as const) {
    if (!Number.isInteger(s) || !Number.isInteger(n) || n < 1 || s < 0 || s > n) {
      throw new EngineError(`Group ${label}: successes must be a whole number between 0 and the number of trials.`, 'range');
    }
  }
  const pA = successesA / nA;
  const pB = successesB / nB;
  const pooled = (successesA + successesB) / (nA + nB);
  const sePooled = Math.sqrt(pooled * (1 - pooled) * (1 / nA + 1 / nB));
  if (!(sePooled > 0)) {
    throw new EngineError('Both groups have the same outcome in every trial, so no test statistic can be computed.', 'undefined');
  }
  const z = (pA - pB) / sePooled;
  const seUnpooled = Math.sqrt((pA * (1 - pA)) / nA + (pB * (1 - pB)) / nB);
  const zCrit = normal.quantile(0.5 + level / 2, { mu: 0, sigma: 1 });
  const expectedCounts = [nA * pooled, nA * (1 - pooled), nB * pooled, nB * (1 - pooled)];
  const notes = [
    `Group A: ${successesA}/${nA} = ${(pA * 100).toPrecision(4)}%.`,
    `Group B: ${successesB}/${nB} = ${(pB * 100).toPrecision(4)}%.`,
  ];
  if (Math.min(...expectedCounts) < 5) {
    notes.push(
      `The smallest expected count is ${Math.min(...expectedCounts).toPrecision(3)}, below the usual minimum of 5. The normal approximation is unreliable here — use an exact test (such as Fisher's) instead.`,
    );
  }
  return {
    name: 'Two-proportion z test',
    nullHypothesis: 'The two populations have the same proportion',
    alternativeHypothesis: alternativeText(alt, 'The difference in proportions'),
    statistic: z,
    statisticName: 'z',
    degreesOfFreedom: null,
    pValue: pFromZ(z, alt),
    effectSize: { name: 'Difference in proportions', value: pA - pB, interpretation: `${((pA - pB) * 100).toPrecision(3)} percentage points` },
    interval: { low: pA - pB - zCrit * seUnpooled, high: pA - pB + zCrit * seUnpooled, level, of: 'the difference in proportions (A − B)' },
    assumptions: [
      'Each observation is an independent trial with two outcomes.',
      'The counts are large enough for the normal approximation (every expected count at least 5).',
    ],
    limitations: [...P_VALUE_LIMITATIONS, 'The test statistic uses the pooled proportion; the interval uses the unpooled standard error, which is the standard convention.'],
    notes,
  };
}

/** Chi-square goodness-of-fit test against expected proportions. */
export function chiSquareGoodnessOfFit(observed: number[], expectedProportions: number[]): TestResult {
  if (observed.length !== expectedProportions.length) {
    throw new EngineError('The number of observed counts must match the number of expected proportions.', 'shape');
  }
  if (observed.length < 2) throw new EngineError('At least 2 categories are needed.', 'insufficient');
  for (const o of observed) {
    if (!Number.isInteger(o) || o < 0) throw new EngineError('Observed counts must be whole numbers of 0 or more.', 'range');
  }
  const propSum = expectedProportions.reduce((a, b) => a + b, 0);
  if (Math.abs(propSum - 1) > 1e-9) {
    throw new EngineError(`The expected proportions sum to ${propSum.toPrecision(8)}, not 1.`, 'sum');
  }
  const n = observed.reduce((a, b) => a + b, 0);
  if (n === 0) throw new EngineError('The total observed count is 0.', 'empty');
  const expected = expectedProportions.map((p) => p * n);
  let stat = 0;
  for (let i = 0; i < observed.length; i++) {
    if (expected[i] === 0) {
      if (observed[i] > 0) {
        throw new EngineError(
          `Category ${i + 1} has an expected probability of 0 but ${observed[i]} observation(s). The model assigns that outcome probability 0, so it cannot be tested this way.`,
          'inconsistent',
        );
      }
      continue;
    }
    stat += (observed[i] - expected[i]) ** 2 / expected[i];
  }
  const df = observed.length - 1;
  const notes = [`Total observations: ${n.toLocaleString('en-US')}.`];
  const minExpected = Math.min(...expected.filter((e) => e > 0));
  if (minExpected < 5) {
    notes.push(
      `The smallest expected count is ${minExpected.toPrecision(3)}, below the usual minimum of 5. The chi-square approximation is unreliable; combine categories or use an exact test.`,
    );
  }
  // √(χ²/n) is Cohen's w, the conventional effect size for a goodness-of-fit
  // test. It is not Cramér's V: w is not bounded by 1 (it reaches √(k−1) when
  // every observation falls in the least expected category), whereas V is, so
  // reporting w under V's name would overstate a bounded measure.
  const w = Math.sqrt(stat / n);
  return {
    name: 'Chi-square goodness-of-fit test',
    nullHypothesis: 'The observed counts come from the stated expected proportions',
    alternativeHypothesis: 'The observed counts come from different proportions',
    statistic: stat,
    statisticName: 'χ²',
    degreesOfFreedom: df,
    pValue: chiSquare.sf(stat, { k: df }),
    effectSize: {
      name: "Cohen's w",
      value: w,
      interpretation: `${w < 0.1 ? 'negligible' : w < 0.3 ? 'small' : w < 0.5 ? 'moderate' : 'large'} departure from the expected proportions (w can exceed 1; its maximum here is √${df} = ${Math.sqrt(df).toPrecision(4)})`,
    },
    interval: null,
    assumptions: ['Observations are independent and each falls into exactly one category.', 'Expected counts are large enough for the chi-square approximation.'],
    limitations: [
      ...P_VALUE_LIMITATIONS,
      'This test detects any departure from the expected proportions but does not say which category is responsible. Compare the per-category contributions to see that.',
    ],
    notes,
  };
}

/** Chi-square test of independence on a contingency table. */
export function chiSquareIndependence(table: number[][]): TestResult {
  const rows = table.length;
  if (rows < 2) throw new EngineError('The table needs at least 2 rows.', 'shape');
  const cols = table[0].length;
  if (cols < 2) throw new EngineError('The table needs at least 2 columns.', 'shape');
  for (const r of table) {
    if (r.length !== cols) throw new EngineError('Every row must have the same number of columns.', 'shape');
    for (const v of r) if (!Number.isInteger(v) || v < 0) throw new EngineError('Counts must be whole numbers of 0 or more.', 'range');
  }
  const rowSums = table.map((r) => r.reduce((a, b) => a + b, 0));
  const colSums = Array.from({ length: cols }, (_, j) => table.reduce((a, r) => a + r[j], 0));
  const n = rowSums.reduce((a, b) => a + b, 0);
  if (n === 0) throw new EngineError('The table is empty.', 'empty');
  if (rowSums.some((s) => s === 0) || colSums.some((s) => s === 0)) {
    throw new EngineError('Every row and column must contain at least one observation. Remove empty rows or columns.', 'empty');
  }
  let stat = 0;
  let minExpected = Infinity;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const e = (rowSums[i] * colSums[j]) / n;
      minExpected = Math.min(minExpected, e);
      stat += (table[i][j] - e) ** 2 / e;
    }
  }
  const df = (rows - 1) * (cols - 1);
  const v = Math.sqrt(stat / (n * Math.min(rows - 1, cols - 1)));
  const notes = [`${rows} × ${cols} table with ${n.toLocaleString('en-US')} observations.`];
  if (minExpected < 5) {
    notes.push(`The smallest expected count is ${minExpected.toPrecision(3)}, below the usual minimum of 5; the approximation is unreliable.`);
  }
  return {
    name: 'Chi-square test of independence',
    nullHypothesis: 'The row and column variables are independent',
    alternativeHypothesis: 'The row and column variables are associated',
    statistic: stat,
    statisticName: 'χ²',
    degreesOfFreedom: df,
    pValue: chiSquare.sf(stat, { k: df }),
    effectSize: { name: "Cramér's V", value: v, interpretation: v < 0.1 ? 'negligible' : v < 0.3 ? 'small' : v < 0.5 ? 'moderate' : 'large' },
    interval: null,
    assumptions: ['Each observation falls into exactly one cell and observations are independent.', 'Expected counts are large enough for the chi-square approximation.'],
    limitations: [
      ...P_VALUE_LIMITATIONS,
      'An association found here does not show that one variable causes the other. A third variable may explain both.',
    ],
    notes,
  };
}

/** Correlation test: is the Pearson correlation different from zero? */
export function correlationTest(x: ArrayLike<number>, y: ArrayLike<number>, alt: Alternative = 'two-sided', level = 0.95): TestResult {
  if (x.length !== y.length) {
    throw new EngineError(
      `A correlation test needs paired observations: received ${x.length} and ${y.length} values. Drop the rows that are missing either value first.`,
      'shape',
    );
  }
  const n = x.length;
  if (n < 3) throw new EngineError('A correlation test needs at least 3 paired observations.', 'insufficient');
  const r = pearson(x, y);
  if (Number.isNaN(r)) {
    throw new EngineError('One of the columns does not vary, so the correlation is undefined.', 'undefined');
  }
  if (Math.abs(r) === 1) {
    throw new EngineError('The correlation is exactly ±1, so the test statistic is infinite. The two columns are perfectly linearly related.', 'undefined');
  }
  const df = n - 2;
  const t = (r * Math.sqrt(df)) / Math.sqrt(1 - r * r);
  // Fisher z transformation for the interval.
  const z = 0.5 * Math.log((1 + r) / (1 - r));
  const seZ = 1 / Math.sqrt(n - 3);
  const zCrit = normal.quantile(0.5 + level / 2, { mu: 0, sigma: 1 });
  const lo = Math.tanh(z - zCrit * seZ);
  const hi = Math.tanh(z + zCrit * seZ);
  return {
    name: 'Pearson correlation test',
    nullHypothesis: 'The population correlation is 0',
    alternativeHypothesis: alternativeText(alt, 'The population correlation'),
    statistic: t,
    statisticName: 't',
    degreesOfFreedom: df,
    pValue: pFromT(t, df, alt),
    effectSize: { name: 'r (correlation)', value: r, interpretation: `r² = ${(r * r).toPrecision(4)}: ${((r * r) * 100).toPrecision(3)}% of the variance in one variable is matched by linear variation in the other` },
    interval: { low: lo, high: hi, level, of: 'the population correlation (Fisher z interval)' },
    assumptions: ['Paired observations are independent.', 'The relationship is linear and the pairs come from an approximately bivariate normal distribution.'],
    limitations: [
      ...P_VALUE_LIMITATIONS,
      'Correlation measures linear association only. A strong curved relationship can produce a correlation near 0.',
      'Correlation does not establish causation: a third factor may drive both variables, or the direction of influence may be the reverse of what is assumed.',
    ],
    notes: [`n = ${n} paired observations, r = ${r.toPrecision(6)}.`],
  };
}

/** Mann–Whitney U test (rank-based comparison of two groups). */
export function mannWhitneyTest(a: ArrayLike<number>, b: ArrayLike<number>, alt: Alternative = 'two-sided'): TestResult {
  const na = a.length;
  const nb = b.length;
  if (na < 3 || nb < 3) throw new EngineError('Each group needs at least 3 observations for the normal approximation used here.', 'insufficient');
  const combined = Float64Array.from([...Array.from(a), ...Array.from(b)]);
  const r = ranks(combined);
  let rankSumA = 0;
  for (let i = 0; i < na; i++) rankSumA += r[i];
  const u1 = rankSumA - (na * (na + 1)) / 2;
  const u2 = na * nb - u1;
  const u = Math.min(u1, u2);
  const meanU = (na * nb) / 2;
  // Tie correction for the variance of U.
  const counts = new Map<number, number>();
  for (const v of combined) counts.set(v, (counts.get(v) ?? 0) + 1);
  const n = na + nb;
  let tieTerm = 0;
  for (const c of counts.values()) if (c > 1) tieTerm += c ** 3 - c;
  const varU = ((na * nb) / 12) * (n + 1 - tieTerm / (n * (n - 1)));
  if (!(varU > 0)) throw new EngineError('All observations are identical, so no rank-based comparison is possible.', 'undefined');
  const z = (u1 - meanU) / Math.sqrt(varU);
  // Common-language effect size: probability a random A exceeds a random B.
  const pSuperiority = u1 / (na * nb);
  return {
    name: 'Mann–Whitney U test (normal approximation)',
    nullHypothesis: 'A randomly chosen value from one group is equally likely to be above or below one from the other group',
    alternativeHypothesis: alternativeText(alt, 'The tendency of one group to exceed the other'),
    statistic: u,
    statisticName: 'U',
    degreesOfFreedom: null,
    pValue: pFromZ(z, alt),
    effectSize: {
      name: 'Common-language effect size',
      value: pSuperiority,
      interpretation: `A randomly chosen value from group A exceeds one from group B about ${(pSuperiority * 100).toPrecision(3)}% of the time (ties counted as half)`,
    },
    interval: null,
    assumptions: ['The two groups are independent and observations within each are independent.', 'The sample sizes are large enough for the normal approximation to U.'],
    limitations: [
      ...P_VALUE_LIMITATIONS,
      'This test compares the whole distributions by rank. It is not a test of medians unless the two distributions have the same shape.',
      'With small samples an exact permutation test is preferable to this normal approximation.',
    ],
    notes: [
      `U₁ = ${u1}, U₂ = ${u2}, nA = ${na}, nB = ${nb}.`,
      ...(tieTerm > 0 ? ['Tied values are present; the variance of U has been corrected for ties.'] : []),
    ],
  };
}

/**
 * One-sample Kolmogorov–Smirnov test against a fully specified continuous
 * distribution. The asymptotic p-value is used, which is accurate for n ≳ 30.
 */
export function kolmogorovSmirnovTest(data: ArrayLike<number>, cdf: (x: number) => number): TestResult {
  const n = data.length;
  if (n < 5) throw new EngineError('A Kolmogorov–Smirnov test needs at least 5 observations.', 'insufficient');
  const sorted = sortedCopy(data);
  let dPlus = 0;
  let dMinus = 0;
  for (let i = 0; i < n; i++) {
    const f = cdf(sorted[i]);
    if (!Number.isFinite(f) || f < 0 || f > 1) throw new EngineError('The reference distribution returned an invalid probability.', 'invalid');
    dPlus = Math.max(dPlus, (i + 1) / n - f);
    dMinus = Math.max(dMinus, f - i / n);
  }
  const d = Math.max(dPlus, dMinus);
  // Kolmogorov asymptotic distribution: P(D > d) ≈ 2 Σ (−1)^{k−1} exp(−2k²nd²)
  const lambda = (Math.sqrt(n) + 0.12 + 0.11 / Math.sqrt(n)) * d;
  let p = 0;
  for (let k = 1; k <= 100; k++) {
    const term = 2 * (-1) ** (k - 1) * Math.exp(-2 * k * k * lambda * lambda);
    p += term;
    if (Math.abs(term) < 1e-14) break;
  }
  p = Math.min(1, Math.max(0, p));
  return {
    name: 'One-sample Kolmogorov–Smirnov test',
    nullHypothesis: 'The data come from the specified distribution',
    alternativeHypothesis: 'The data come from a different distribution',
    statistic: d,
    statisticName: 'D',
    degreesOfFreedom: null,
    pValue: p,
    effectSize: { name: 'D (largest gap)', value: d, interpretation: `The empirical and reference cumulative distributions differ by at most ${(d * 100).toPrecision(3)} percentage points` },
    interval: null,
    assumptions: [
      'Observations are independent.',
      'The reference distribution is continuous and fully specified in advance — its parameters were not estimated from this same data.',
    ],
    limitations: [
      ...P_VALUE_LIMITATIONS,
      'If the distribution parameters were estimated from this data, this p-value is too large (the test becomes conservative) and a Lilliefors-type correction is needed instead.',
      'The p-value uses the asymptotic Kolmogorov distribution, which is accurate for roughly 30 or more observations.',
      'The test is most sensitive near the centre of the distribution and relatively insensitive in the tails.',
    ],
    notes: [`n = ${n}, D⁺ = ${dPlus.toPrecision(6)}, D⁻ = ${dMinus.toPrecision(6)}.`],
  };
}

/** One-way ANOVA across several groups. */
export function oneWayAnova(groups: { label: string; values: ArrayLike<number> }[]): TestResult {
  const usable = groups.filter((g) => g.values.length >= 2);
  if (usable.length < 2) throw new EngineError('At least 2 groups with 2 or more observations each are needed.', 'insufficient');
  const k = usable.length;
  const allValues = usable.flatMap((g) => Array.from(g.values));
  const n = allValues.length;
  const grand = mean(allValues);
  let ssBetween = 0;
  let ssWithin = 0;
  for (const g of usable) {
    const m = mean(g.values);
    ssBetween += g.values.length * (m - grand) ** 2;
    for (let i = 0; i < g.values.length; i++) ssWithin += (g.values[i] - m) ** 2;
  }
  const dfBetween = k - 1;
  const dfWithin = n - k;
  if (ssWithin === 0) {
    throw new EngineError('There is no variation within the groups, so the F statistic is infinite.', 'undefined');
  }
  const msBetween = ssBetween / dfBetween;
  const msWithin = ssWithin / dfWithin;
  const f = msBetween / msWithin;
  // F distribution survival function via the incomplete beta identity.
  const p = fSurvival(f, dfBetween, dfWithin);
  const etaSquared = ssBetween / (ssBetween + ssWithin);
  const skipped = groups.length - usable.length;
  return {
    name: 'One-way ANOVA',
    nullHypothesis: 'Every group has the same population mean',
    alternativeHypothesis: 'At least one group mean differs from the others',
    statistic: f,
    statisticName: 'F',
    degreesOfFreedom: [dfBetween, dfWithin],
    pValue: p,
    effectSize: {
      name: 'η² (eta squared)',
      value: etaSquared,
      interpretation: `${(etaSquared * 100).toPrecision(3)}% of the total variation lies between groups rather than within them`,
    },
    interval: null,
    assumptions: [
      'Observations are independent within and between groups.',
      'Group variances are approximately equal (this test assumes equal variances; Welch’s ANOVA does not).',
      'Group means are approximately normally distributed.',
    ],
    limitations: [
      ...P_VALUE_LIMITATIONS,
      'A significant result says that the groups are not all the same; it does not say which groups differ. That needs a follow-up comparison with an adjustment for multiple testing.',
    ],
    notes: [
      ...usable.map((g) => `${g.label}: n = ${g.values.length}, mean ${mean(g.values).toPrecision(6)}.`),
      ...(skipped ? [`${skipped} group(s) with fewer than 2 observations were excluded.`] : []),
    ],
  };
}

/** P(F > f) for the F distribution with (d1, d2) degrees of freedom. */
export function fSurvival(f: number, d1: number, d2: number): number {
  if (f <= 0) return 1;
  // F → Beta relationship: P(F ≤ f) = I_{d1·f/(d1·f+d2)}(d1/2, d2/2)
  const x = (d1 * f) / (d1 * f + d2);
  return incompleteBeta(x, d1 / 2, d2 / 2).upper;
}

function interpretCohensD(d: number): string {
  const a = Math.abs(d);
  const size = a < 0.2 ? 'negligible' : a < 0.5 ? 'small' : a < 0.8 ? 'medium' : 'large';
  return `${size} (|d| = ${a.toPrecision(3)}); the means differ by ${a.toPrecision(3)} standard deviation(s)`;
}

/** Benjamini–Hochberg adjusted p-values for a family of tests. */
export function benjaminiHochberg(pValues: number[]): number[] {
  const n = pValues.length;
  if (!n) return [];
  const order = pValues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  const adjusted = new Array<number>(n);
  let prev = 1;
  for (let rank = n; rank >= 1; rank--) {
    const { p, i } = order[rank - 1];
    const q = Math.min(prev, (p * n) / rank);
    adjusted[i] = Math.min(1, q);
    prev = adjusted[i];
  }
  return adjusted;
}
