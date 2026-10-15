/**
 * Goodness-of-fit tests, reported together rather than one at a time.
 *
 * Each of these tests is blind to something: Kolmogorov–Smirnov is
 * insensitive in the tails, chi-square throws away information by binning,
 * Jarque–Bera only looks at two moments, and Anderson–Darling weights the
 * tails heavily (which is why it is here — tail behaviour is what matters for
 * risk). Reporting them side by side is the only honest way to use them.
 *
 * Two statements accompany every result, in `caveats`:
 *  1. failing to reject is not evidence that the distribution is correct;
 *  2. if the parameters were estimated from the same data, the test is
 *     conservative and the p-value is too large.
 */
import { EngineError } from '../core/result';
import { chiSquare, normal } from '../distributions/continuous';
import { normalQuantile, normalSf } from '../special/gamma';
import { sortedCopy } from '../stats/descriptive';
import { kolmogorovSmirnovTest } from '../stats/tests';
import type { DistributionDef, Params } from '../distributions/types';
import { GOF_CAVEATS, type GofResult } from './types';

export interface GofContext {
  /** Were the parameters estimated from this same data? */
  parametersEstimated: boolean;
  /** How many were estimated (needed for the chi-square degrees of freedom). */
  estimatedParams: number;
}

function baseCaveats(ctx: GofContext): string[] {
  return [GOF_CAVEATS.notEvidenceOfFit, ctx.parametersEstimated ? GOF_CAVEATS.estimatedParams : GOF_CAVEATS.knownParams];
}

/** Clamp CDF values away from 0 and 1 so logs stay finite, and say so if it bit. */
function cdfValues(sorted: ArrayLike<number>, cdf: (x: number) => number): { u: number[]; clamped: number } {
  const u: number[] = [];
  let clamped = 0;
  for (let i = 0; i < sorted.length; i++) {
    let f = cdf(sorted[i]);
    if (!Number.isFinite(f)) throw new EngineError('The fitted distribution returned a non-finite probability; the goodness-of-fit statistic cannot be computed.', 'numerical');
    if (f <= 0) {
      f = 1e-300;
      clamped++;
    } else if (f >= 1) {
      f = 1 - 1e-16;
      clamped++;
    }
    u.push(f);
  }
  return { u, clamped };
}

/** Marsaglia & Marsaglia (2004) CDF of the Anderson–Darling statistic, known-parameter case. */
function adInf(z: number): number {
  if (z < 0.01) return 0;
  if (z < 2) {
    return (
      Math.pow(z, -0.5) *
      Math.exp(-1.2337141 / z) *
      (2.00012 + (0.247105 - (0.0649821 - (0.0347962 - (0.011672 - 0.00168691 * z) * z) * z) * z) * z)
    );
  }
  return Math.exp(-Math.exp(1.0776 - (2.30695 - (0.43424 - (0.082433 - (0.008056 - 0.0003146 * z) * z) * z) * z) * z));
}

function adCdf(n: number, z: number): number {
  const x = adInf(z);
  if (x > 0.8) {
    const v = (-130.2137 + (745.2337 - (1705.091 - (1950.646 - (1116.36 - 255.7844 * x) * x) * x) * x) * x) / n;
    return Math.min(1, Math.max(0, x + v));
  }
  const c = 0.01265 + 0.1757 / n;
  if (x < c) {
    let v = x / c;
    v = Math.sqrt(v) * (1 - v) * (49 * v - 102);
    return Math.min(1, Math.max(0, x + (v * (0.0037 / (n * n) + 0.00078 / n + 0.00006)) / n));
  }
  let v = (x - c) / (0.8 - c);
  v = -0.00022633 + (6.54034 - (14.6538 - (14.458 - (8.259 - 1.91864 * v) * v) * v) * v) * v;
  return Math.min(1, Math.max(0, x + (v * (0.04213 + 0.01365 / n)) / n));
}

/** Interpolate a p-value from tabulated critical values; returns a bound outside the table. */
function pFromTable(stat: number, table: { level: number; value: number }[]): { p: number; exactWithinTable: boolean } {
  const sorted = [...table].sort((a, b) => a.value - b.value);
  if (stat <= sorted[0].value) return { p: sorted[0].level, exactWithinTable: false };
  const last = sorted[sorted.length - 1];
  if (stat >= last.value) return { p: last.level, exactWithinTable: false };
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (stat >= a.value && stat <= b.value) {
      const t = (stat - a.value) / (b.value - a.value);
      // Interpolate on the log of the level: the tail decays roughly geometrically.
      return { p: Math.exp(Math.log(a.level) + t * (Math.log(b.level) - Math.log(a.level))), exactWithinTable: true };
    }
  }
  return { p: last.level, exactWithinTable: false };
}

export const AD_NORMAL_CRITICAL = [
  { level: 0.15, value: 0.576 },
  { level: 0.1, value: 0.656 },
  { level: 0.05, value: 0.787 },
  { level: 0.025, value: 0.918 },
  { level: 0.01, value: 1.092 },
];

export const AD_EXPONENTIAL_CRITICAL = [
  { level: 0.15, value: 0.922 },
  { level: 0.1, value: 1.078 },
  { level: 0.05, value: 1.341 },
  { level: 0.025, value: 1.606 },
  { level: 0.01, value: 1.957 },
];

export const CVM_ASYMPTOTIC_CRITICAL = [
  { level: 0.15, value: 0.284 },
  { level: 0.1, value: 0.347 },
  { level: 0.05, value: 0.461 },
  { level: 0.025, value: 0.581 },
  { level: 0.01, value: 0.743 },
];

/**
 * Anderson–Darling test. The statistic weights the tails by 1/(F(1−F)), so it
 * detects tail misfit that KS cannot see.
 *
 * Case-specific treatment:
 *  - normal with both parameters estimated: D'Agostino & Stephens modified
 *    statistic A*² = A²(1 + 0.75/n + 2.25/n²) and its p-value approximation;
 *  - exponential with the mean estimated: A*² = A²(1 + 0.6/n) against the
 *    case-specific critical values;
 *  - otherwise: the known-parameter asymptotic distribution, which is
 *    conservative when parameters were in fact estimated.
 */
export function andersonDarling(
  data: ArrayLike<number>,
  cdf: (x: number) => number,
  ctx: GofContext & { family?: 'normal' | 'exponential' | 'other' },
): GofResult {
  const n = data.length;
  if (n < 5) throw new EngineError('An Anderson–Darling test needs at least 5 observations.', 'insufficient');
  const sorted = sortedCopy(data);
  const { u, clamped } = cdfValues(sorted, cdf);
  let s = 0;
  for (let i = 0; i < n; i++) {
    s += (2 * (i + 1) - 1) * (Math.log(u[i]) + Math.log1p(-u[n - 1 - i]));
  }
  const a2 = -n - s / n;
  if (!Number.isFinite(a2)) throw new EngineError('The Anderson–Darling statistic is not finite: observations fall where the fitted distribution has essentially zero probability.', 'numerical');
  const notes = [`n = ${n}, A² = ${a2.toPrecision(6)}.`];
  if (clamped) notes.push(`${clamped} observation(s) sit in a region where the fitted CDF is numerically 0 or 1; the statistic there is dominated by rounding and the fit is very poor in that tail.`);
  const caveats = baseCaveats(ctx);
  caveats.push('Anderson–Darling weights the tails heavily. A large A² with a small KS statistic means the centre fits and the tails do not — which is exactly the case that matters for risk.');

  const family = ctx.family ?? 'other';
  if (family === 'normal' && ctx.parametersEstimated) {
    const star = a2 * (1 + 0.75 / n + 2.25 / (n * n));
    let p: number;
    if (star < 0.2) p = 1 - Math.exp(-13.436 + 101.14 * star - 223.73 * star * star);
    else if (star < 0.34) p = 1 - Math.exp(-8.318 + 42.796 * star - 59.938 * star * star);
    else if (star < 0.6) p = Math.exp(0.9177 - 4.279 * star - 1.38 * star * star);
    else p = Math.exp(1.2937 - 5.709 * star + 0.0186 * star * star);
    p = Math.min(1, Math.max(0, p));
    return {
      name: 'Anderson–Darling test for normality (case: mean and variance estimated)',
      statistic: star,
      statisticName: 'A*²',
      pValue: p,
      pValueBasis: 'case-specific-table',
      degreesOfFreedom: null,
      criticalValues: AD_NORMAL_CRITICAL,
      rejectedAt05: p < 0.05,
      caveats: [
        GOF_CAVEATS.notEvidenceOfFit,
        'The case-specific null distribution for estimated mean and variance is used, so this p-value is calibrated and is NOT conservative — unlike a general-purpose Anderson–Darling p-value applied to an estimated fit.',
      ],
      notes: [...notes, `A*² = A²(1 + 0.75/n + 2.25/n²) = ${star.toPrecision(6)} (D'Agostino & Stephens).`],
    };
  }
  if (family === 'exponential' && ctx.parametersEstimated) {
    const star = a2 * (1 + 0.6 / n);
    const { p, exactWithinTable } = pFromTable(star, AD_EXPONENTIAL_CRITICAL);
    return {
      name: 'Anderson–Darling test for the exponential distribution (case: mean estimated)',
      statistic: star,
      statisticName: 'A*²',
      pValue: p,
      pValueBasis: 'case-specific-table',
      degreesOfFreedom: null,
      criticalValues: AD_EXPONENTIAL_CRITICAL,
      rejectedAt05: star > 1.341,
      caveats: [
        GOF_CAVEATS.notEvidenceOfFit,
        'The case-specific critical values for an estimated mean are used, so the 5% decision is calibrated.',
        exactWithinTable
          ? 'The p-value is interpolated between tabulated critical values (Stephens); treat it as accurate to about one significant figure.'
          : `The statistic lies outside the tabulated range, so the p-value is reported as the nearest table bound (${p}), not an interpolation.`,
      ],
      notes: [...notes, `A*² = A²(1 + 0.6/n) = ${star.toPrecision(6)}; the 5% critical value is 1.341.`],
    };
  }
  const p = 1 - adCdf(n, a2);
  return {
    name: 'Anderson–Darling test',
    statistic: a2,
    statisticName: 'A²',
    pValue: Math.min(1, Math.max(0, p)),
    pValueBasis: 'asymptotic',
    degreesOfFreedom: null,
    rejectedAt05: p < 0.05,
    caveats,
    notes: [...notes, 'The p-value uses the known-parameter null distribution of A² (Marsaglia & Marsaglia 2004).'],
  };
}

/**
 * Cramér–von Mises test. Equal weight across the whole distribution, so it
 * sits between KS (peak-sensitive) and AD (tail-sensitive).
 */
export function cramerVonMises(data: ArrayLike<number>, cdf: (x: number) => number, ctx: GofContext): GofResult {
  const n = data.length;
  if (n < 5) throw new EngineError('A Cramér–von Mises test needs at least 5 observations.', 'insufficient');
  const sorted = sortedCopy(data);
  const { u } = cdfValues(sorted, cdf);
  let s = 0;
  for (let i = 0; i < n; i++) s += (u[i] - (2 * (i + 1) - 1) / (2 * n)) ** 2;
  const w2 = s + 1 / (12 * n);
  const { p, exactWithinTable } = pFromTable(w2, CVM_ASYMPTOTIC_CRITICAL);
  return {
    name: 'Cramér–von Mises test',
    statistic: w2,
    statisticName: 'W²',
    pValue: p,
    pValueBasis: 'asymptotic',
    degreesOfFreedom: null,
    criticalValues: CVM_ASYMPTOTIC_CRITICAL,
    rejectedAt05: w2 > 0.461,
    caveats: [
      ...baseCaveats(ctx),
      exactWithinTable
        ? 'The p-value is interpolated between tabulated asymptotic critical values for the known-parameter case; it is accurate to about one significant figure between the 1% and 15% points.'
        : `The statistic lies outside the tabulated range, so the p-value is reported as the nearest table bound (${p}) rather than an interpolation.`,
    ],
    notes: [`n = ${n}, W² = ${w2.toPrecision(6)}; the 5% asymptotic critical value is 0.461.`],
  };
}

/** KS test against a fitted distribution, with the fitting caveat carried through. */
export function ksGoodnessOfFit(data: ArrayLike<number>, cdf: (x: number) => number, ctx: GofContext): GofResult {
  const r = kolmogorovSmirnovTest(data, cdf);
  return {
    name: r.name,
    statistic: r.statistic,
    statisticName: r.statisticName,
    pValue: r.pValue,
    pValueBasis: 'asymptotic',
    degreesOfFreedom: null,
    rejectedAt05: r.pValue < 0.05,
    caveats: [
      ...baseCaveats(ctx),
      'The p-value uses the asymptotic Kolmogorov distribution, which is accurate for roughly 30 or more observations.',
      'KS is driven by the largest single gap, usually near the middle of the distribution, and is insensitive in the tails.',
    ],
    notes: r.notes,
  };
}

export interface ChiSquareBin {
  low: number;
  high: number;
  observed: number;
  expected: number;
}

export interface ChiSquareGofResult extends GofResult {
  bins: ChiSquareBin[];
}

/**
 * Chi-square goodness of fit with equiprobable bins.
 *
 * The degrees of freedom are bins − 1 − (number of parameters estimated from
 * this data). Using bins − 1 when parameters were estimated is a common error
 * and makes the test anti-conservative (p-values too small).
 */
export function chiSquareFitTest(
  data: ArrayLike<number>,
  def: DistributionDef,
  params: Params,
  ctx: GofContext,
  requestedBins?: number,
): ChiSquareGofResult {
  const n = data.length;
  if (n < 10) throw new EngineError('A chi-square goodness-of-fit test needs at least 10 observations.', 'insufficient');
  // Mann–Wald style rule, capped so that every expected count is at least 5.
  const auto = Math.max(4, Math.min(Math.round(2 * Math.pow(n, 0.4)), Math.floor(n / 5)));
  const bins = requestedBins ?? auto;
  if (!Number.isInteger(bins) || bins < 2) throw new EngineError('The number of bins must be a whole number of 2 or more.', 'range');
  const df = bins - 1 - ctx.estimatedParams;
  if (df < 1) {
    throw new EngineError(
      `With ${bins} bins and ${ctx.estimatedParams} estimated parameter(s) the degrees of freedom would be ${df} (bins − 1 − estimated parameters). The test needs at least 1 degree of freedom: use more bins or more data.`,
      'insufficient',
    );
  }
  const edges: number[] = [];
  for (let i = 1; i < bins; i++) edges.push(def.quantile(i / bins, params));
  const unique = new Set(edges.map((e) => e.toPrecision(12)));
  if (unique.size !== edges.length) {
    throw new EngineError(
      `Equiprobable binning failed: the fitted ${def.name} puts more than 1/${bins} of its probability on a single value, so ${bins} distinct bins do not exist. This typically happens with discrete data and few distinct values.`,
      'degenerate',
    );
  }
  const counts = new Array<number>(bins).fill(0);
  for (let i = 0; i < data.length; i++) {
    const x = data[i];
    let b = 0;
    while (b < edges.length && x > edges[b]) b++;
    counts[b]++;
  }
  const probs: number[] = [];
  for (let b = 0; b < bins; b++) {
    const lo = b === 0 ? -Infinity : edges[b - 1];
    const hi = b === bins - 1 ? Infinity : edges[b];
    const pLow = Number.isFinite(lo) ? def.cdf(lo, params) : 0;
    const pHigh = Number.isFinite(hi) ? def.cdf(hi, params) : 1;
    probs.push(Math.max(0, pHigh - pLow));
  }
  const total = probs.reduce((a, b) => a + b, 0);
  const binsOut: ChiSquareBin[] = [];
  let stat = 0;
  let minExpected = Infinity;
  for (let b = 0; b < bins; b++) {
    const expected = (probs[b] / total) * n;
    if (!(expected > 0)) {
      throw new EngineError(`Bin ${b + 1} has expected count 0 under the fitted ${def.name}, so the chi-square statistic is undefined.`, 'degenerate');
    }
    minExpected = Math.min(minExpected, expected);
    stat += (counts[b] - expected) ** 2 / expected;
    binsOut.push({ low: b === 0 ? -Infinity : edges[b - 1], high: b === bins - 1 ? Infinity : edges[b], observed: counts[b], expected });
  }
  if (minExpected < 1) {
    throw new EngineError(
      `The smallest expected cell count is ${minExpected.toPrecision(3)}, below 1. The chi-square approximation is invalid here; use fewer bins, more data, or the Anderson–Darling test, which needs no binning.`,
      'insufficient',
    );
  }
  const notes = [
    `${bins} equiprobable bins, n = ${n}, smallest expected count ${minExpected.toPrecision(4)}.`,
    `Degrees of freedom = bins − 1 − estimated parameters = ${bins} − 1 − ${ctx.estimatedParams} = ${df}.`,
  ];
  if (minExpected < 5) {
    notes.push(`The smallest expected count is below the usual minimum of 5, so the chi-square approximation is unreliable; treat this p-value as indicative only.`);
  }
  const p = chiSquare.sf(stat, { k: df });
  return {
    name: 'Chi-square goodness-of-fit test (equiprobable bins)',
    statistic: stat,
    statisticName: 'χ²',
    pValue: p,
    pValueBasis: 'asymptotic',
    degreesOfFreedom: df,
    rejectedAt05: p < 0.05,
    caveats: [
      ...baseCaveats(ctx),
      'Binning discards information: two different distributions with the same bin probabilities are indistinguishable to this test.',
      'The degrees of freedom have been reduced by the number of estimated parameters. Using bins − 1 instead would make the test reject too often.',
    ],
    notes,
    bins: binsOut,
  };
}

/**
 * Shapiro–Wilk test of normality, Royston's AS R94 approximation.
 * Valid for 3 ≤ n ≤ 5000; beyond that the p-value approximation drifts and
 * the test rejects trivial departures, which is said rather than hidden.
 */
export function shapiroWilk(data: ArrayLike<number>): GofResult {
  const n = data.length;
  if (n < 3) throw new EngineError('A Shapiro–Wilk test needs at least 3 observations.', 'insufficient');
  const x = sortedCopy(data);
  const m = new Array<number>(n);
  for (let i = 0; i < n; i++) m[i] = normalQuantile((i + 1 - 0.375) / (n + 0.25));
  let ssumm2 = 0;
  for (const v of m) ssumm2 += v * v;
  const rsn = 1 / Math.sqrt(n);
  const a = new Array<number>(n).fill(0);
  const sq = Math.sqrt(ssumm2);
  const an =
    -2.706056 * rsn ** 5 + 4.434685 * rsn ** 4 - 2.07119 * rsn ** 3 - 0.147981 * rsn ** 2 + 0.221157 * rsn + m[n - 1] / sq;
  let phi: number;
  if (n === 3) {
    // Exact for n = 3: a = (−1/√2, 0, 1/√2). The general formula divides by
    // zero here because ssumm2 = 2m₃² exactly.
    a[0] = -Math.SQRT1_2;
    a[1] = 0;
    a[2] = Math.SQRT1_2;
    phi = 1;
  } else if (n > 5) {
    const an1 =
      -3.582633 * rsn ** 5 + 5.682633 * rsn ** 4 - 1.752461 * rsn ** 3 - 0.293762 * rsn ** 2 + 0.042981 * rsn + m[n - 2] / sq;
    phi = (ssumm2 - 2 * m[n - 1] ** 2 - 2 * m[n - 2] ** 2) / (1 - 2 * an ** 2 - 2 * an1 ** 2);
    a[n - 1] = an;
    a[n - 2] = an1;
    a[0] = -an;
    a[1] = -an1;
    for (let i = 2; i < n - 2; i++) a[i] = m[i] / Math.sqrt(phi);
  } else {
    phi = (ssumm2 - 2 * m[n - 1] ** 2) / (1 - 2 * an ** 2);
    a[n - 1] = an;
    a[0] = -an;
    for (let i = 1; i < n - 1; i++) a[i] = m[i] / Math.sqrt(phi);
  }
  let mean = 0;
  for (let i = 0; i < n; i++) mean += x[i];
  mean /= n;
  let ss = 0;
  let num = 0;
  for (let i = 0; i < n; i++) {
    ss += (x[i] - mean) ** 2;
    num += a[i] * x[i];
  }
  if (!(ss > 0)) throw new EngineError('All observations are identical, so the Shapiro–Wilk statistic is undefined.', 'degenerate');
  const w = Math.min(1, (num * num) / ss);
  let p: number;
  if (n === 3) {
    const pi6 = 6 / Math.PI;
    p = Math.min(1, Math.max(0, pi6 * (Math.asin(Math.sqrt(w)) - Math.asin(Math.sqrt(0.75)))));
  } else if (n <= 11) {
    const g = -2.273 + 0.459 * n;
    const mu = 0.544 - 0.39978 * n + 0.025054 * n * n - 0.0006714 * n ** 3;
    const sigma = Math.exp(1.3822 - 0.77857 * n + 0.062767 * n * n - 0.0020322 * n ** 3);
    const arg = g - Math.log(1 - w);
    if (!(arg > 0)) p = 0;
    else p = normalSf((-Math.log(arg) - mu) / sigma);
  } else {
    const u = Math.log(n);
    const mu = -1.5861 - 0.31082 * u - 0.083751 * u * u + 0.0038915 * u ** 3;
    const sigma = Math.exp(-0.4803 - 0.082676 * u + 0.0030302 * u * u);
    p = normalSf((Math.log(1 - w) - mu) / sigma);
  }
  p = Math.min(1, Math.max(0, p));
  const notes = [`n = ${n}, W = ${w.toPrecision(8)}.`];
  if (n > 5000) notes.push('n exceeds 5000, beyond the range of Royston’s approximation; the p-value is unreliable and the test will flag departures too small to matter.');
  return {
    name: 'Shapiro–Wilk test of normality',
    statistic: w,
    statisticName: 'W',
    pValue: p,
    pValueBasis: 'asymptotic',
    degreesOfFreedom: null,
    rejectedAt05: p < 0.05,
    caveats: [
      GOF_CAVEATS.notEvidenceOfFit,
      'Shapiro–Wilk already accounts for the mean and variance being estimated: it tests normality of shape, not a fully specified normal. It is therefore not conservative in the way a KS test on an estimated fit is.',
      'With a large sample the test rejects departures from normality too small to affect any practical conclusion. Look at the Q–Q plot alongside the p-value.',
      'Ties and rounded data inflate W and make the test harder to interpret.',
    ],
    notes,
  };
}

/**
 * Jarque–Bera test: looks only at skewness and excess kurtosis. The χ²₂
 * approximation is poor for small samples, where the test is far too
 * reluctant to reject.
 */
export function jarqueBera(data: ArrayLike<number>): GofResult {
  const n = data.length;
  if (n < 8) throw new EngineError('A Jarque–Bera test needs at least 8 observations, and even then the chi-square approximation is poor.', 'insufficient');
  let mean = 0;
  for (let i = 0; i < n; i++) mean += data[i];
  mean /= n;
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  for (let i = 0; i < n; i++) {
    const d = data[i] - mean;
    m2 += d * d;
    m3 += d ** 3;
    m4 += d ** 4;
  }
  m2 /= n;
  m3 /= n;
  m4 /= n;
  if (!(m2 > 0)) throw new EngineError('All observations are identical, so skewness and kurtosis are undefined.', 'degenerate');
  const s = m3 / Math.pow(m2, 1.5);
  const kExcess = m4 / (m2 * m2) - 3;
  const jb = (n / 6) * (s * s + (kExcess * kExcess) / 4);
  const p = chiSquare.sf(jb, { k: 2 });
  return {
    name: 'Jarque–Bera test of normality',
    statistic: jb,
    statisticName: 'JB',
    pValue: p,
    pValueBasis: 'asymptotic',
    degreesOfFreedom: 2,
    rejectedAt05: p < 0.05,
    caveats: [
      GOF_CAVEATS.notEvidenceOfFit,
      'Jarque–Bera only uses the third and fourth moments. A distribution with normal skewness and kurtosis but the wrong shape passes it easily.',
      'The χ²₂ null distribution is asymptotic and is noticeably inaccurate below a few hundred observations; the test is then too conservative.',
    ],
    notes: [`n = ${n}, sample skewness ${s.toPrecision(6)}, excess kurtosis ${kExcess.toPrecision(6)}.`],
  };
}

/** A standard normal CDF helper for callers testing normality of standardised data. */
export function standardNormalCdf(x: number): number {
  return normal.cdf(x, { mu: 0, sigma: 1 });
}
