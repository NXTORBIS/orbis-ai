/**
 * Descriptive statistics shared by the simulation engine, experiments, risk
 * explorer and data lab.
 *
 * Conventions (documented because several definitions exist):
 *  - Variance / SD: sample versions with denominator n − 1 (Bessel's
 *    correction) unless stated; population versions use n.
 *  - Quantiles: Hyndman & Fan type 7 (linear interpolation between order
 *    statistics; the default in R, NumPy and Excel's PERCENTILE.INC).
 *  - Skewness: adjusted Fisher–Pearson coefficient G1 (as in Excel SKEW and
 *    SciPy skew(bias=False)); requires n ≥ 3.
 *  - Kurtosis: sample excess kurtosis G2 (as in Excel KURT and SciPy
 *    kurtosis(bias=False)); requires n ≥ 4.
 */
import { normalQuantile } from '../special/gamma';
import { EngineError } from '../core/result';
import { stableSum } from '../core/numeric';
import { getDistribution } from '../distributions/registry';

export interface SampleSummary {
  n: number;
  mean: number;
  /** Sample variance (n − 1); NaN when n < 2. */
  variance: number;
  sd: number;
  min: number;
  max: number;
  median: number;
  q1: number;
  q3: number;
  iqr: number;
  /** Quantiles at standard levels (type 7). */
  quantiles: { p: number; value: number }[];
  /** NaN when undefined (n < 3 or zero variance). */
  skewness: number;
  /** Excess kurtosis; NaN when undefined (n < 4 or zero variance). */
  excessKurtosis: number;
  /** Standard error of the mean, s/√n. */
  standardError: number;
}

export const STANDARD_QUANTILES = [0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99];

export function mean(xs: ArrayLike<number>): number {
  if (xs.length === 0) return NaN;
  return stableSum(xs) / xs.length;
}

/** Two-pass variance with compensation; denominator n − ddof. */
export function variance(xs: ArrayLike<number>, ddof = 1): number {
  const n = xs.length;
  if (n - ddof <= 0) return NaN;
  const m = mean(xs);
  let ss = 0;
  let comp = 0;
  for (let i = 0; i < n; i++) {
    const d = xs[i] - m;
    ss += d * d;
    comp += d;
  }
  return (ss - (comp * comp) / n) / (n - ddof);
}

export function sortedCopy(xs: ArrayLike<number>): Float64Array {
  const a = Float64Array.from(xs as ArrayLike<number>);
  a.sort();
  return a;
}

/** Type-7 quantile of an already sorted array. */
export function quantileSorted(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (p <= 0) return sorted[0];
  if (p >= 1) return sorted[n - 1];
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(n - 1, lo + 1);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

export function quantile(xs: ArrayLike<number>, p: number): number {
  return quantileSorted(sortedCopy(xs), p);
}

export function skewness(xs: ArrayLike<number>): number {
  const n = xs.length;
  if (n < 3) return NaN;
  const m = mean(xs);
  let m2 = 0;
  let m3 = 0;
  for (let i = 0; i < n; i++) {
    const d = xs[i] - m;
    m2 += d * d;
    m3 += d * d * d;
  }
  m2 /= n;
  m3 /= n;
  if (m2 === 0) return NaN;
  const g1 = m3 / Math.pow(m2, 1.5);
  return (Math.sqrt(n * (n - 1)) / (n - 2)) * g1;
}

export function excessKurtosis(xs: ArrayLike<number>): number {
  const n = xs.length;
  if (n < 4) return NaN;
  const m = mean(xs);
  let m2 = 0;
  let m4 = 0;
  for (let i = 0; i < n; i++) {
    const d = xs[i] - m;
    const d2 = d * d;
    m2 += d2;
    m4 += d2 * d2;
  }
  m2 /= n;
  m4 /= n;
  if (m2 === 0) return NaN;
  const g2 = m4 / (m2 * m2) - 3;
  return ((n - 1) / ((n - 2) * (n - 3))) * ((n + 1) * g2 + 6);
}

export function summarizeSample(xs: ArrayLike<number>, sortedIn?: ArrayLike<number>): SampleSummary {
  const n = xs.length;
  const sorted = sortedIn ?? sortedCopy(xs);
  const v = variance(xs);
  const q1 = quantileSorted(sorted, 0.25);
  const q3 = quantileSorted(sorted, 0.75);
  return {
    n,
    mean: mean(xs),
    variance: v,
    sd: Math.sqrt(v),
    min: n ? sorted[0] : NaN,
    max: n ? sorted[n - 1] : NaN,
    median: quantileSorted(sorted, 0.5),
    q1,
    q3,
    iqr: q3 - q1,
    quantiles: STANDARD_QUANTILES.map((p) => ({ p, value: quantileSorted(sorted, p) })),
    skewness: skewness(xs),
    excessKurtosis: excessKurtosis(xs),
    standardError: Math.sqrt(v / n),
  };
}

export interface FrequencyRow {
  value: number;
  count: number;
  proportion: number;
}

/** Exact frequency table for discrete-valued data (at most `maxDistinct` rows). */
export function frequencyTable(xs: ArrayLike<number>, maxDistinct = 2000): FrequencyRow[] | null {
  const counts = new Map<number, number>();
  for (let i = 0; i < xs.length; i++) {
    counts.set(xs[i], (counts.get(xs[i]) ?? 0) + 1);
    if (counts.size > maxDistinct) return null;
  }
  const n = xs.length;
  return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([value, count]) => ({ value, count, proportion: count / n }));
}

export interface HistogramBin {
  x0: number;
  x1: number;
  count: number;
  /** count / (n · width): comparable to a probability density. */
  density: number;
  proportion: number;
}

/**
 * Histogram with Freedman–Diaconis bin width (falls back to Sturges when the
 * IQR is zero), clamped to [minBins, maxBins] bins.
 */
export function histogram(
  sorted: ArrayLike<number>,
  options: { bins?: number; minBins?: number; maxBins?: number; range?: [number, number] } = {},
): HistogramBin[] {
  const n = sorted.length;
  if (n === 0) return [];
  const lo = options.range ? options.range[0] : sorted[0];
  const hi = options.range ? options.range[1] : sorted[n - 1];
  if (!(hi > lo)) return [{ x0: lo - 0.5, x1: lo + 0.5, count: n, density: 1, proportion: 1 }];
  let bins = options.bins;
  if (!bins) {
    const iqr = quantileSorted(sorted, 0.75) - quantileSorted(sorted, 0.25);
    const width = 2 * iqr * Math.pow(n, -1 / 3);
    bins = width > 0 ? Math.ceil((hi - lo) / width) : Math.ceil(Math.log2(n) + 1);
  }
  bins = Math.max(options.minBins ?? 5, Math.min(options.maxBins ?? 80, bins));
  const width = (hi - lo) / bins;
  const counts = new Array<number>(bins).fill(0);
  for (let i = 0; i < n; i++) {
    const x = sorted[i];
    if (x < lo || x > hi) continue;
    let b = Math.floor((x - lo) / width);
    if (b >= bins) b = bins - 1;
    counts[b]++;
  }
  return counts.map((count, i) => ({
    x0: lo + i * width,
    x1: i === bins! - 1 ? hi : lo + (i + 1) * width,
    count,
    density: count / (n * width),
    proportion: count / n,
  }));
}

/** Empirical CDF evaluated at up to `maxPoints` evenly spaced order statistics. */
export function ecdfPoints(sorted: ArrayLike<number>, maxPoints = 400): { x: number; p: number }[] {
  const n = sorted.length;
  if (n === 0) return [];
  const out: { x: number; p: number }[] = [];
  const m = Math.min(n, maxPoints);
  let lastX = NaN;
  for (let k = 0; k < m; k++) {
    const i = m === 1 ? n - 1 : Math.round((k * (n - 1)) / (m - 1));
    const x = sorted[i];
    if (x === lastX) continue;
    // F̂(x) = (number of observations ≤ x) / n: find the last index of the tie run.
    let lo = i;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (sorted[mid] <= x) lo = mid;
      else hi = mid - 1;
    }
    out.push({ x, p: (lo + 1) / n });
    lastX = x;
  }
  return out;
}

export interface Interval {
  low: number;
  high: number;
  level: number;
  method: string;
}

/**
 * Approximate confidence interval for an expected value from a large sample
 * (normal approximation using the standard error). Appropriate for Monte
 * Carlo estimates of a finite-variance mean.
 */
export function meanConfidenceInterval(m: number, se: number, level = 0.95): Interval {
  const z = normalQuantile(0.5 + level / 2);
  return { low: m - z * se, high: m + z * se, level, method: 'Normal approximation: mean ± z·s/√n' };
}

/** Student-t confidence interval for a mean from a sample of size n. */
export function tConfidenceInterval(m: number, sd: number, n: number, level = 0.95): Interval {
  if (n < 2) return { low: NaN, high: NaN, level, method: 'Undefined for fewer than 2 observations' };
  const t = getDistribution('studentT').quantile(0.5 + level / 2, { nu: n - 1, mu: 0, sigma: 1 });
  const se = sd / Math.sqrt(n);
  return { low: m - t * se, high: m + t * se, level, method: `Student t interval with ${n - 1} degrees of freedom` };
}

/** Wilson score interval for a binomial proportion — reliable even near 0 and 1. */
export function wilsonInterval(successes: number, n: number, level = 0.95): Interval {
  if (n === 0) return { low: 0, high: 1, level, method: 'No observations' };
  const z = normalQuantile(0.5 + level / 2);
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half), level, method: 'Wilson score interval' };
}

/** Exact Clopper–Pearson interval for a binomial proportion (conservative). */
export function clopperPearsonInterval(successes: number, n: number, level = 0.95): Interval {
  const alpha = 1 - level;
  const b = getDistribution('beta');
  const low = successes === 0 ? 0 : b.quantile(alpha / 2, { alpha: successes, beta: n - successes + 1 });
  const high = successes === n ? 1 : b.quantile(1 - alpha / 2, { alpha: successes + 1, beta: n - successes });
  return { low, high, level, method: 'Clopper–Pearson exact interval' };
}

/** Online mean/variance accumulator (Welford). */
export class RunningStats {
  n = 0;
  mean = 0;
  private m2 = 0;
  push(x: number) {
    this.n++;
    const d = x - this.mean;
    this.mean += d / this.n;
    this.m2 += d * (x - this.mean);
  }
  get variance(): number {
    return this.n > 1 ? this.m2 / (this.n - 1) : NaN;
  }
}

/**
 * Reject mismatched lengths rather than silently pairing a prefix.
 *
 * Truncating to the shorter array while computing means over the whole of each
 * one produces a plausible-looking number that is simply wrong, so an explicit
 * error is the honest behaviour. Callers that expect to drop incomplete rows
 * should use `pairedValues` first.
 */
function assertSameLength(x: ArrayLike<number>, y: ArrayLike<number>, what: string): void {
  if (x.length !== y.length) {
    throw new EngineError(
      `${what} needs two equal-length sets of values; received ${x.length} and ${y.length}. Pair the observations first so each row contributes both values.`,
      'shape',
    );
  }
}

/** Pearson correlation; NaN when either variable is constant or n < 2. */
export function pearson(x: ArrayLike<number>, y: ArrayLike<number>): number {
  assertSameLength(x, y, 'Pearson correlation');
  const n = x.length;
  if (n < 2) return NaN;
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return NaN;
  return sxy / Math.sqrt(sxx * syy);
}

/** Average ranks (ties receive the mean of their positions), 1-based. */
export function ranks(xs: ArrayLike<number>): Float64Array {
  const n = xs.length;
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => xs[a] - xs[b]);
  const r = new Float64Array(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && xs[idx[j + 1]] === xs[idx[i]]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k]] = avg;
    i = j + 1;
  }
  return r;
}

/** Spearman rank correlation (Pearson correlation of average ranks). */
export function spearman(x: ArrayLike<number>, y: ArrayLike<number>): number {
  assertSameLength(x, y, 'Spearman correlation');
  return pearson(ranks(x), ranks(y));
}

export function covariance(x: ArrayLike<number>, y: ArrayLike<number>, ddof = 1): number {
  assertSameLength(x, y, 'Covariance');
  const n = x.length;
  if (n - ddof <= 0) return NaN;
  const mx = mean(x);
  const my = mean(y);
  let s = 0;
  for (let i = 0; i < n; i++) s += (x[i] - mx) * (y[i] - my);
  return s / (n - ddof);
}
