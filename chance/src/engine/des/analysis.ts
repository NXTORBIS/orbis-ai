/**
 * Output analysis for discrete-event simulation.
 *
 * One simulation run is one sample from a random process. Reporting its mean
 * as "the answer" is the defining error of amateur simulation: it is a number
 * with no stated precision, and it is usually biased as well, because the run
 * started from an empty system that the real one never is.
 *
 * This module supplies the machinery that turns runs into statements:
 *
 *  - terminating models  → independent replications, with an interval and the
 *                          number of replications a target precision needs;
 *  - steady-state models → warm-up detection (Welch, MSER-5) with the discarded
 *                          period reported, then batch means WITH a test that
 *                          the batches are actually uncorrelated, or the
 *                          regenerative method where cycles exist;
 *  - comparisons         → paired-t and Welch intervals, common random numbers
 *                          with the measured variance reduction, and
 *                          multiple-comparison control.
 *
 * Batch means with correlated batches is the most common silent error in
 * steady-state simulation: positive correlation between batches makes the
 * variance of the batch means smaller than the variance of the mean, so the
 * interval comes out too narrow and looks impressive. The lag-1 test here
 * exists to catch exactly that, and its verdict is part of the result rather
 * than a footnote.
 */
import { EngineError } from '../core/result';
import { getDistribution } from '../distributions/registry';
import { stableSum } from '../core/numeric';
import type { Interval } from '../stats/descriptive';
import { quantileSorted, sortedCopy } from '../stats/descriptive';

const studentT = getDistribution('studentT');

/** Two-sided Student-t critical value with `df` degrees of freedom. */
export function tCritical(level: number, df: number): number {
  if (!(level > 0 && level < 1)) {
    throw new EngineError(`A confidence level must be strictly between 0 and 1 (got ${level}).`, 'range');
  }
  if (!(df >= 1)) {
    throw new EngineError(`A t critical value needs at least 1 degree of freedom (got ${df}).`, 'range');
  }
  return studentT.quantile(0.5 + level / 2, { nu: df, mu: 0, sigma: 1 });
}

function meanOf(xs: readonly number[]): number {
  return stableSum(xs as number[]) / xs.length;
}

function sampleVariance(xs: readonly number[]): number {
  const n = xs.length;
  const m = meanOf(xs);
  let s = 0;
  for (let i = 0; i < n; i++) {
    const d = xs[i] - m;
    s += d * d;
  }
  return s / (n - 1);
}

function requireFiniteSeries(xs: readonly number[], what: string): void {
  for (let i = 0; i < xs.length; i++) {
    if (!Number.isFinite(xs[i])) {
      throw new EngineError(
        `${what} contains a value that is not a finite number at position ${i} (${xs[i]}). A non-finite observation is not silently dropped, because the resulting mean would misrepresent the run.`,
        'finite',
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Terminating simulations: independent replications
// ---------------------------------------------------------------------------

export interface ReplicationReport {
  method: string;
  replications: number;
  mean: number;
  sd: number;
  /** Monte Carlo standard error of the reported mean. */
  standardError: number;
  /** Confidence interval for the long-run MEAN. */
  meanInterval: Interval;
  halfWidth: number;
  /** Half-width as a fraction of the mean, when the mean is non-zero. */
  relativePrecision: number | null;
  /**
   * Percentiles of the REPLICATION MEANS. These describe how one replication's
   * average varies, not the distribution of individual entities, and not the
   * precision of the overall mean. Three different statements; kept apart.
   */
  replicationPercentiles: { p: number; value: number }[];
  exactness: 'empirical';
}

/**
 * Mean and interval across independent replications. Each value must be the
 * summary of one complete, independently seeded run.
 */
export function replicationAnalysis(values: readonly number[], options: { level?: number } = {}): ReplicationReport {
  const level = options.level ?? 0.95;
  if (values.length === 0) {
    throw new EngineError(
      'Replication analysis was given no replications. There is no estimate and no interval from zero runs.',
      'no-observations',
    );
  }
  if (values.length < 2) {
    throw new EngineError(
      'Replication analysis needs at least 2 independent replications to estimate the variance between runs. With one run there is a number but no way to say how precise it is, and reporting it without an interval is exactly the false precision this engine refuses.',
      'insufficient-data',
    );
  }
  requireFiniteSeries(values, 'The set of replication results');
  const n = values.length;
  const mean = meanOf(values);
  const variance = sampleVariance(values);
  const sd = Math.sqrt(variance);
  const standardError = sd / Math.sqrt(n);
  const t = tCritical(level, n - 1);
  const halfWidth = t * standardError;
  const sorted = sortedCopy(values as number[]);
  return {
    method: `Independent replications: mean ± t(${n - 1}) · s/√n`,
    replications: n,
    mean,
    sd,
    standardError,
    meanInterval: { low: mean - halfWidth, high: mean + halfWidth, level, method: `Student t interval across ${n} independent replications` },
    halfWidth,
    relativePrecision: mean !== 0 ? Math.abs(halfWidth / mean) : null,
    replicationPercentiles: [0.05, 0.25, 0.5, 0.75, 0.95].map((p) => ({ p, value: quantileSorted(sorted, p) })),
    exactness: 'empirical',
  };
}

export interface PrecisionPlan {
  targetHalfWidth: number;
  currentHalfWidth: number;
  currentReplications: number;
  /** Replications needed for the target, using the variance observed so far. */
  requiredReplications: number;
  additionalReplications: number;
  note: string;
}

/**
 * How many replications a target half-width needs, solving
 * t(n−1, 1−α/2)·s/√n ≤ h by iteration because the critical value depends on n.
 */
export function replicationsForPrecision(
  report: ReplicationReport,
  targetHalfWidth: number,
  options: { level?: number; maxReplications?: number } = {},
): PrecisionPlan {
  if (!(targetHalfWidth > 0) || !Number.isFinite(targetHalfWidth)) {
    throw new EngineError(`The target half-width must be a finite positive number (got ${targetHalfWidth}).`, 'range');
  }
  const level = options.level ?? report.meanInterval.level;
  const maxReplications = options.maxReplications ?? 10_000_000;
  const s = report.sd;
  let n = Math.max(2, report.replications);
  for (;;) {
    const half = tCritical(level, n - 1) * (s / Math.sqrt(n));
    if (half <= targetHalfWidth) break;
    const next = Math.max(n + 1, Math.ceil((tCritical(level, n - 1) * s / targetHalfWidth) ** 2));
    if (next > maxReplications) {
      throw new EngineError(
        `Reaching a half-width of ${targetHalfWidth} would need more than ${maxReplications.toLocaleString('en-US')} replications given the observed between-run standard deviation of ${s}. No replication count is reported, because the honest answer is that this precision is out of reach for this model; reduce the variance (common random numbers, a longer run per replication) or accept a wider interval.`,
        'limit',
      );
    }
    n = next;
  }
  return {
    targetHalfWidth,
    currentHalfWidth: report.halfWidth,
    currentReplications: report.replications,
    requiredReplications: n,
    additionalReplications: Math.max(0, n - report.replications),
    note: 'The required count uses the between-replication standard deviation observed so far, which is itself an estimate; recompute it after the extra replications rather than trusting it exactly.',
  };
}

// ---------------------------------------------------------------------------
// Steady state: warm-up / initialisation bias
// ---------------------------------------------------------------------------

export interface WarmupReport {
  method: 'Welch' | 'MSER-5';
  /** Observations (or time batches) to discard. */
  truncation: number;
  /** True when initialisation bias was actually found. */
  biasDetected: boolean;
  observations: number;
  /** Mean of the series after truncation — the estimate to use. */
  truncatedMean: number;
  /** Mean of the whole series, including the biased start, for comparison. */
  untruncatedMean: number;
  message: string;
  exactness: 'empirical';
}

export interface WelchReport extends WarmupReport {
  method: 'Welch';
  replications: number;
  window: number;
  ensembleMeans: number[];
  movingAverage: number[];
  tailMean: number;
  band: number;
}

/**
 * Welch's graphical method, made into a decision.
 *
 * Average the series across replications to damp the noise, smooth that with a
 * moving average, then find the earliest point from which the smoothed curve
 * stays inside a band around its own tail. Averaging across replications is
 * what makes this work: a single run is far too noisy for the eye or for a
 * rule to see where the transient ends.
 */
export function welchWarmup(
  replicationSeries: readonly (readonly number[])[],
  options: { window?: number; tolerance?: number; tailFraction?: number } = {},
): WelchReport {
  if (replicationSeries.length < 2) {
    throw new EngineError(
      `Welch's method needs at least 2 replications of the same model (got ${replicationSeries.length}). Its whole purpose is to average the transient across runs; one run cannot be averaged.`,
      'insufficient-data',
    );
  }
  const m = replicationSeries[0].length;
  if (m === 0) {
    throw new EngineError("Welch's method was given replication series of length 0; there is nothing to analyse.", 'no-observations');
  }
  for (let r = 0; r < replicationSeries.length; r++) {
    if (replicationSeries[r].length !== m) {
      throw new EngineError(
        `Welch's method needs every replication to have the same number of observations. Replication 1 has ${m} and replication ${r + 1} has ${replicationSeries[r].length}; averaging across runs of different lengths would compare different points of the transient.`,
        'shape',
      );
    }
    requireFiniteSeries(replicationSeries[r], `Replication ${r + 1}`);
  }
  const window = options.window ?? Math.max(1, Math.min(50, Math.floor(m / 20)));
  if (!Number.isInteger(window) || window < 1) {
    throw new EngineError(`The moving-average window must be a whole number of at least 1 (got ${window}).`, 'range');
  }
  if (2 * window + 1 > m) {
    throw new EngineError(
      `The moving-average window of ${window} needs at least ${2 * window + 1} observations per replication, but each has only ${m}. Use a shorter window or longer replications.`,
      'range',
    );
  }
  const R = replicationSeries.length;
  const ensembleMeans = new Array<number>(m);
  for (let i = 0; i < m; i++) {
    let s = 0;
    for (let r = 0; r < R; r++) s += replicationSeries[r][i];
    ensembleMeans[i] = s / R;
  }
  const movingAverage: number[] = [];
  for (let i = window; i < m - window; i++) {
    let s = 0;
    for (let k = -window; k <= window; k++) s += ensembleMeans[i + k];
    movingAverage.push(s / (2 * window + 1));
  }
  const tailFraction = options.tailFraction ?? 0.25;
  const tailStart = Math.max(0, movingAverage.length - Math.max(1, Math.floor(movingAverage.length * tailFraction)));
  const tailMean = meanOf(movingAverage.slice(tailStart));
  const tolerance = options.tolerance ?? 0.05;
  const tailSd = movingAverage.length - tailStart > 1 ? Math.sqrt(sampleVariance(movingAverage.slice(tailStart))) : 0;
  const band = Math.max(tolerance * Math.abs(tailMean), 2 * tailSd);
  let j = 0;
  for (let i = 0; i < movingAverage.length; i++) {
    if (Math.abs(movingAverage[i] - tailMean) > band) j = i + 1;
  }
  const truncation = Math.min(m - 1, j + window);
  const whole = meanOf(ensembleMeans);
  const kept = ensembleMeans.slice(truncation);
  const biasDetected = truncation > 0;
  return {
    method: 'Welch',
    truncation,
    biasDetected,
    observations: m,
    truncatedMean: meanOf(kept),
    untruncatedMean: whole,
    replications: R,
    window,
    ensembleMeans,
    movingAverage,
    tailMean,
    band,
    message: biasDetected
      ? `Initialisation bias was detected: the smoothed ensemble average does not settle inside a band of ±${band.toPrecision(3)} around its tail mean of ${tailMean.toPrecision(4)} until observation ${truncation}. Those first ${truncation} observations must be discarded, and that decision is part of the result.`
      : 'No initialisation bias was detected: the smoothed ensemble average is inside the band around its tail mean from the first observation, so nothing needs discarding. That is a statement about this series and this band, not a guarantee.',
    exactness: 'empirical',
  };
}

/**
 * MSER-5 (White 1997): batch the series in fives, then choose the truncation
 * point that minimises the estimated variance of the mean of what is kept.
 * Unlike Welch's method it works on a single run and needs no judgement call.
 */
export function mser5(series: readonly number[], options: { batchSize?: number } = {}): WarmupReport {
  const batchSize = options.batchSize ?? 5;
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new EngineError(`The MSER batch size must be a whole number of at least 1 (got ${batchSize}).`, 'range');
  }
  if (series.length < 20 * batchSize) {
    throw new EngineError(
      `MSER-${batchSize} needs at least ${20 * batchSize} observations to have enough batches to choose a truncation point, but the series has ${series.length}. A truncation point chosen from a handful of batches is noise, not a warm-up estimate.`,
      'insufficient-data',
    );
  }
  requireFiniteSeries(series, 'The series given to MSER');
  const k = Math.floor(series.length / batchSize);
  const batches = new Array<number>(k);
  for (let i = 0; i < k; i++) {
    let s = 0;
    for (let j = 0; j < batchSize; j++) s += series[i * batchSize + j];
    batches[i] = s / batchSize;
  }
  // Suffix sums let every candidate truncation be evaluated in O(1).
  const suffixSum = new Array<number>(k + 1).fill(0);
  const suffixSquares = new Array<number>(k + 1).fill(0);
  for (let i = k - 1; i >= 0; i--) {
    suffixSum[i] = suffixSum[i + 1] + batches[i];
    suffixSquares[i] = suffixSquares[i + 1] + batches[i] * batches[i];
  }
  const maxD = Math.floor(k / 2);
  let bestD = 0;
  let bestValue = Number.POSITIVE_INFINITY;
  for (let d = 0; d <= maxD; d++) {
    const count = k - d;
    if (count < 2) break;
    const sum = suffixSum[d];
    const sq = suffixSquares[d];
    const ssd = sq - (sum * sum) / count;
    const value = ssd / (count * count);
    if (value < bestValue) {
      bestValue = value;
      bestD = d;
    }
  }
  const truncation = bestD * batchSize;
  const kept = series.slice(truncation);
  return {
    method: 'MSER-5',
    truncation,
    biasDetected: truncation > 0,
    observations: series.length,
    truncatedMean: meanOf(kept),
    untruncatedMean: meanOf(series),
    message:
      truncation > 0
        ? `MSER-${batchSize} discards the first ${truncation} observations (${bestD} of ${k} batches): that truncation minimises the estimated variance of the mean of what remains. The mean of the kept observations is ${meanOf(kept).toPrecision(5)}, against ${meanOf(series).toPrecision(5)} for the whole series; the difference is the initialisation bias.`
        : `MSER-${batchSize} found no truncation point better than keeping the whole series, so no initialisation bias was detected in it.`,
    exactness: 'empirical',
  };
}

// ---------------------------------------------------------------------------
// Steady state: batch means
// ---------------------------------------------------------------------------

export interface BatchIndependenceCheck {
  /** Lag-1 autocorrelation of the batch-mean sequence. */
  lag1: number;
  /** Standardised statistic; positive values mean positive correlation. */
  statistic: number;
  /** One-sided critical value at the test's level. */
  critical: number;
  level: number;
  /** True when positive correlation between batches was NOT detected. */
  passed: boolean;
  message: string;
}

export interface BatchMeansReport {
  method: string;
  observations: number;
  batchCount: number;
  batchSize: number;
  /** Observations dropped so the batches are equal sized. */
  discardedRemainder: number;
  mean: number;
  /** Monte Carlo standard error from the between-batch variance. */
  standardError: number;
  meanInterval: Interval;
  halfWidth: number;
  batchMeans: number[];
  independence: BatchIndependenceCheck;
  warnings: string[];
  exactness: 'empirical';
}

export const MIN_BATCHES = 10;

/**
 * Batch means: cut the series into equal consecutive batches and treat the
 * batch means as (nearly) independent observations.
 *
 * The validity rests entirely on the batches being long enough to be
 * uncorrelated, so that is tested rather than assumed. The test is one-sided
 * on the lag-1 autocorrelation of the batch means, because positive
 * correlation is the failure that matters: it shrinks the interval and makes a
 * wrong answer look precise.
 */
export function batchMeans(
  series: readonly number[],
  options: { batchCount?: number; batchSize?: number; level?: number; testLevel?: number } = {},
): BatchMeansReport {
  const level = options.level ?? 0.95;
  const n = series.length;
  if (n === 0) {
    throw new EngineError('Batch means was given no observations. There is no mean and no interval from an empty series.', 'no-observations');
  }
  requireFiniteSeries(series, 'The series given to batch means');
  let batchCount: number;
  let batchSize: number;
  if (options.batchSize !== undefined) {
    batchSize = options.batchSize;
    if (!Number.isInteger(batchSize) || batchSize < 1) {
      throw new EngineError(`The batch size must be a whole number of at least 1 (got ${batchSize}).`, 'range');
    }
    batchCount = Math.floor(n / batchSize);
  } else {
    batchCount = options.batchCount ?? 20;
    if (!Number.isInteger(batchCount) || batchCount < 1) {
      throw new EngineError(`The batch count must be a whole number of at least 1 (got ${batchCount}).`, 'range');
    }
    batchSize = Math.floor(n / batchCount);
  }
  if (batchCount < MIN_BATCHES || batchSize < 1) {
    throw new EngineError(
      `Batch means was asked for ${batchCount} batch(es) of size ${batchSize} from ${n} observations, but at least ${MIN_BATCHES} batches are needed before the between-batch variance means anything. With fewer batches the interval is driven by the handful of batch values rather than by the process, so no interval is reported. Run the model for longer or ask for fewer, larger batches.`,
      'insufficient-data',
    );
  }
  const used = batchCount * batchSize;
  const discardedRemainder = n - used;
  const means = new Array<number>(batchCount);
  for (let b = 0; b < batchCount; b++) {
    let s = 0;
    for (let i = 0; i < batchSize; i++) s += series[b * batchSize + i];
    means[b] = s / batchSize;
  }
  const mean = meanOf(means);
  const variance = sampleVariance(means);
  const standardError = Math.sqrt(variance / batchCount);
  const t = tCritical(level, batchCount - 1);
  const halfWidth = t * standardError;
  const independence = lag1IndependenceTest(means, options.testLevel ?? 0.95);
  const warnings: string[] = [];
  if (!independence.passed) {
    warnings.push(
      `The batch means are positively correlated (lag-1 correlation ${independence.lag1.toFixed(3)}), so the interval below is too narrow: the between-batch variance understates the variance of the mean. Increase the batch size — not the batch count — until the correlation test passes. The point estimate is still usable; the stated precision is not.`,
    );
  }
  if (discardedRemainder > 0) {
    warnings.push(`${discardedRemainder} observation(s) at the end of the series were not used, so that every batch has exactly ${batchSize} observations.`);
  }
  return {
    method: `Batch means: ${batchCount} batches of ${batchSize}, interval mean ± t(${batchCount - 1}) · s/√k`,
    observations: n,
    batchCount,
    batchSize,
    discardedRemainder,
    mean,
    standardError,
    meanInterval: { low: mean - halfWidth, high: mean + halfWidth, level, method: `Batch-means t interval with ${batchCount - 1} degrees of freedom` },
    halfWidth,
    batchMeans: means,
    independence,
    warnings,
    exactness: 'empirical',
  };
}

/**
 * One-sided test for positive lag-1 autocorrelation in a sequence. Under
 * independence the estimator has mean −1/(k−1) and variance (k−3)/(k²−1)
 * approximately (von Neumann); the statistic below standardises it.
 */
export function lag1IndependenceTest(values: readonly number[], level = 0.95): BatchIndependenceCheck {
  const k = values.length;
  if (k < 4) {
    throw new EngineError(
      `A lag-1 correlation test needs at least 4 values (got ${k}). With fewer, the test has no power and reporting "independent" would be a guess dressed as a check.`,
      'insufficient-data',
    );
  }
  const m = meanOf(values);
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < k; i++) {
    const d = values[i] - m;
    denominator += d * d;
    if (i < k - 1) numerator += d * (values[i + 1] - m);
  }
  if (!(denominator > 0)) {
    throw new EngineError(
      'A lag-1 correlation test was asked about a sequence with zero variance; correlation is undefined when nothing varies, and 0 is not the answer.',
      'degenerate',
    );
  }
  const lag1 = numerator / denominator;
  const expected = -1 / (k - 1);
  const sd = Math.sqrt((k - 3) / ((k - 1) * (k + 1)));
  const statistic = (lag1 - expected) / sd;
  const z = getDistribution('normal').quantile(level, { mu: 0, sigma: 1 });
  const passed = statistic <= z;
  return {
    lag1,
    statistic,
    critical: z,
    level,
    passed,
    message: passed
      ? `The lag-1 autocorrelation of the ${k} batch means is ${lag1.toFixed(3)}, which is not significantly positive at the ${(level * 100).toFixed(0)}% level (statistic ${statistic.toFixed(2)} against a critical value of ${z.toFixed(2)}). Treating the batches as uncorrelated is supported by the data.`
      : `The lag-1 autocorrelation of the ${k} batch means is ${lag1.toFixed(3)}, significantly positive at the ${(level * 100).toFixed(0)}% level (statistic ${statistic.toFixed(2)} against a critical value of ${z.toFixed(2)}). The batches are too short to be treated as independent.`,
  };
}

// ---------------------------------------------------------------------------
// Steady state: regenerative method
// ---------------------------------------------------------------------------

export interface RegenerativeCycle {
  /** Sum of the quantity of interest accumulated over the cycle. */
  sum: number;
  /** Length of the cycle, in time units or in observations. */
  length: number;
}

export interface RegenerativeReport {
  method: string;
  cycles: number;
  /** Ratio estimator Σ sum / Σ length. */
  estimate: number;
  standardError: number;
  meanInterval: Interval;
  meanCycleLength: number;
  note: string;
  exactness: 'empirical';
}

/**
 * The regenerative method. Where the system returns to a state from which its
 * future is independent of its past — an M/M/1 emptying, for example — the
 * cycles between those regeneration points are genuinely independent, so no
 * warm-up removal and no batching assumption is needed. The estimator is a
 * ratio of two means, so its variance comes from the delta method.
 */
export function regenerativeAnalysis(
  cycles: readonly RegenerativeCycle[],
  options: { level?: number; minCycles?: number } = {},
): RegenerativeReport {
  const level = options.level ?? 0.95;
  const minCycles = options.minCycles ?? 10;
  if (cycles.length < minCycles) {
    throw new EngineError(
      `The regenerative method was given ${cycles.length} cycle(s) but needs at least ${minCycles}. The ratio estimator's variance is estimated across cycles, and from a handful of cycles that estimate is meaningless.`,
      'insufficient-data',
    );
  }
  const sums = cycles.map((c) => c.sum);
  const lengths = cycles.map((c) => c.length);
  requireFiniteSeries(sums, 'The cycle sums');
  requireFiniteSeries(lengths, 'The cycle lengths');
  for (const l of lengths) {
    if (!(l > 0)) {
      throw new EngineError(`A regeneration cycle of length ${l} was supplied. Every cycle must have a positive length.`, 'range');
    }
  }
  const n = cycles.length;
  const meanSum = meanOf(sums);
  const meanLength = meanOf(lengths);
  const estimate = meanSum / meanLength;
  let vYY = 0;
  let vXX = 0;
  let vXY = 0;
  for (let i = 0; i < n; i++) {
    const dy = sums[i] - meanSum;
    const dx = lengths[i] - meanLength;
    vYY += dy * dy;
    vXX += dx * dx;
    vXY += dy * dx;
  }
  vYY /= n - 1;
  vXX /= n - 1;
  vXY /= n - 1;
  const sigma2 = vYY - 2 * estimate * vXY + estimate * estimate * vXX;
  if (!(sigma2 >= 0)) {
    throw new EngineError('The regenerative variance estimate came out negative, which means the cycle data is inconsistent; no interval is reported.', 'numerical');
  }
  const standardError = Math.sqrt(sigma2 / n) / meanLength;
  const t = tCritical(level, n - 1);
  return {
    method: 'Regenerative method: ratio estimator with a delta-method standard error',
    cycles: n,
    estimate,
    standardError,
    meanInterval: {
      low: estimate - t * standardError,
      high: estimate + t * standardError,
      level,
      method: `Regenerative t interval across ${n} independent cycles`,
    },
    meanCycleLength: meanLength,
    note: 'Cycles between regeneration points are independent by construction, so this interval needs no warm-up removal and no assumption about batch length. It does need the chosen point to be a genuine regeneration point: the system\'s future must depend on nothing but that state.',
    exactness: 'empirical',
  };
}

// ---------------------------------------------------------------------------
// Comparing alternatives
// ---------------------------------------------------------------------------

export interface ComparisonReport {
  method: string;
  labelA: string;
  labelB: string;
  meanA: number;
  meanB: number;
  /** Estimated mean of A − B. */
  meanDifference: number;
  standardError: number;
  degreesOfFreedom: number;
  differenceInterval: Interval;
  /** True when the interval for the difference excludes zero. */
  significant: boolean;
  conclusion: string;
  exactness: 'empirical';
}

/**
 * Paired-t comparison. Use this when run i of A and run i of B share a seed
 * (common random numbers): the pairing removes the variability the two
 * configurations have in common, which is usually most of it.
 */
export function pairedTComparison(
  a: readonly number[],
  b: readonly number[],
  options: { level?: number; labelA?: string; labelB?: string } = {},
): ComparisonReport {
  const level = options.level ?? 0.95;
  if (a.length !== b.length) {
    throw new EngineError(
      `A paired comparison needs the same number of observations on both sides (got ${a.length} and ${b.length}). Pairing run i of one configuration with run i of the other is the whole point; unequal lengths mean the pairing is broken, and a Welch comparison should be used instead.`,
      'shape',
    );
  }
  if (a.length < 2) {
    throw new EngineError('A paired comparison needs at least 2 pairs to estimate the variance of the difference.', 'insufficient-data');
  }
  requireFiniteSeries(a, 'Configuration A');
  requireFiniteSeries(b, 'Configuration B');
  const differences = a.map((v, i) => v - b[i]);
  const n = differences.length;
  const mean = meanOf(differences);
  const sd = Math.sqrt(sampleVariance(differences));
  const standardError = sd / Math.sqrt(n);
  const t = tCritical(level, n - 1);
  const low = mean - t * standardError;
  const high = mean + t * standardError;
  const labelA = options.labelA ?? 'A';
  const labelB = options.labelB ?? 'B';
  const significant = low > 0 || high < 0;
  return {
    method: `Paired t comparison across ${n} matched pairs`,
    labelA,
    labelB,
    meanA: meanOf(a),
    meanB: meanOf(b),
    meanDifference: mean,
    standardError,
    degreesOfFreedom: n - 1,
    differenceInterval: { low, high, level, method: `Paired t interval with ${n - 1} degrees of freedom` },
    significant,
    conclusion: significant
      ? `The interval for ${labelA} − ${labelB} is [${low.toPrecision(4)}, ${high.toPrecision(4)}] and excludes zero, so the difference is larger than the simulation's own noise at the ${(level * 100).toFixed(0)}% level.`
      : `The interval for ${labelA} − ${labelB} is [${low.toPrecision(4)}, ${high.toPrecision(4)}] and contains zero. That does not mean the configurations are equal: it means this many runs cannot tell them apart. The interval's width is the resolution of the experiment.`,
    exactness: 'empirical',
  };
}

/** Welch comparison for two independent, unpaired sets of runs. */
export function welchComparison(
  a: readonly number[],
  b: readonly number[],
  options: { level?: number; labelA?: string; labelB?: string } = {},
): ComparisonReport {
  const level = options.level ?? 0.95;
  if (a.length < 2 || b.length < 2) {
    throw new EngineError(`A Welch comparison needs at least 2 observations on each side (got ${a.length} and ${b.length}).`, 'insufficient-data');
  }
  requireFiniteSeries(a, 'Configuration A');
  requireFiniteSeries(b, 'Configuration B');
  const na = a.length;
  const nb = b.length;
  const ma = meanOf(a);
  const mb = meanOf(b);
  const va = sampleVariance(a);
  const vb = sampleVariance(b);
  const se = Math.sqrt(va / na + vb / nb);
  if (!(se > 0)) {
    throw new EngineError('Both sets of runs have zero variance, so no interval for the difference can be formed.', 'degenerate');
  }
  const df = (va / na + vb / nb) ** 2 / ((va / na) ** 2 / (na - 1) + (vb / nb) ** 2 / (nb - 1));
  const t = tCritical(level, Math.max(1, df));
  const mean = ma - mb;
  const low = mean - t * se;
  const high = mean + t * se;
  const labelA = options.labelA ?? 'A';
  const labelB = options.labelB ?? 'B';
  const significant = low > 0 || high < 0;
  return {
    method: 'Welch comparison of two independent sets of runs (unequal variances)',
    labelA,
    labelB,
    meanA: ma,
    meanB: mb,
    meanDifference: mean,
    standardError: se,
    degreesOfFreedom: df,
    differenceInterval: { low, high, level, method: `Welch–Satterthwaite t interval with ${df.toFixed(1)} degrees of freedom` },
    significant,
    conclusion: significant
      ? `The interval for ${labelA} − ${labelB} excludes zero at the ${(level * 100).toFixed(0)}% level.`
      : `The interval for ${labelA} − ${labelB} contains zero: these runs cannot separate the configurations.`,
    exactness: 'empirical',
  };
}

export interface CrnReport {
  paired: ComparisonReport;
  independent: ComparisonReport;
  /** Variance of the estimated difference with common random numbers. */
  varianceWithCrn: number;
  /** Variance of the estimated difference with independent streams. */
  varianceIndependent: number;
  /** varianceIndependent / varianceWithCrn. Greater than 1 means CRN helped. */
  varianceReductionFactor: number;
  /** Equivalent saving in runs: the factor expressed as a percentage. */
  percentVarianceRemoved: number;
  effective: boolean;
  message: string;
  exactness: 'empirical';
}

/**
 * Common random numbers, with the reduction measured rather than asserted.
 *
 * Driving both configurations with the same seeds makes their outputs
 * positively correlated, and the variance of a difference of positively
 * correlated variables is smaller than that of independent ones. The size of
 * the gain depends entirely on the model and on the streams staying aligned,
 * so it is measured here against runs that did not share seeds.
 */
export function commonRandomNumbersReport(options: {
  crnA: readonly number[];
  crnB: readonly number[];
  independentA: readonly number[];
  independentB: readonly number[];
  level?: number;
  labelA?: string;
  labelB?: string;
}): CrnReport {
  const level = options.level ?? 0.95;
  const paired = pairedTComparison(options.crnA, options.crnB, { level, labelA: options.labelA, labelB: options.labelB });
  const independent = welchComparison(options.independentA, options.independentB, { level, labelA: options.labelA, labelB: options.labelB });
  const n = options.crnA.length;
  const differences = options.crnA.map((v, i) => v - options.crnB[i]);
  const varianceWithCrn = sampleVariance(differences) / n;
  const varianceIndependent = independent.standardError ** 2;
  if (!(varianceWithCrn > 0)) {
    throw new EngineError('The paired differences have zero variance, so no variance-reduction factor can be computed.', 'degenerate');
  }
  const factor = varianceIndependent / varianceWithCrn;
  const effective = factor > 1;
  return {
    paired,
    independent,
    varianceWithCrn,
    varianceIndependent,
    varianceReductionFactor: factor,
    percentVarianceRemoved: 100 * (1 - 1 / factor),
    effective,
    message: effective
      ? `Common random numbers reduced the variance of the estimated difference by a factor of ${factor.toFixed(2)} (${(100 * (1 - 1 / factor)).toFixed(1)}% of it removed). Reaching the same precision with independent streams would need about ${factor.toFixed(1)} times as many runs.`
      : `Common random numbers did NOT reduce the variance here (factor ${factor.toFixed(2)}). That happens when the shared streams drive the two configurations out of step — a different number of draws, or a different order — and it can make things worse rather than better. Check that each stochastic component has its own substream and that both configurations consume them identically.`,
    exactness: 'empirical',
  };
}

export interface MultipleComparisonReport {
  method: string;
  configurations: string[];
  comparisons: ComparisonReport[];
  /** Simultaneous confidence level across all comparisons. */
  familyLevel: number;
  /** Level used for each individual interval. */
  perComparisonLevel: number;
  comparisonCount: number;
  best: { name: string; mean: number };
  note: string;
  exactness: 'empirical';
}

/**
 * Several configurations at once, with the family-wise error rate controlled.
 *
 * Making m comparisons at 95% each leaves a much larger chance that at least
 * one interval misses: with ten comparisons it is about 40%. The Bonferroni
 * adjustment widens each interval so that the stated level holds for all of
 * them together. It is conservative, which is the right direction to err when
 * the output is a ranking someone will act on.
 */
export function multipleComparisons(
  configurations: readonly { name: string; values: readonly number[] }[],
  options: { familyLevel?: number; baseline?: string; paired?: boolean } = {},
): MultipleComparisonReport {
  if (configurations.length < 2) {
    throw new EngineError(`Comparing alternatives needs at least 2 configurations (got ${configurations.length}).`, 'insufficient-data');
  }
  const familyLevel = options.familyLevel ?? 0.95;
  const names = configurations.map((c) => c.name);
  if (options.baseline !== undefined && !names.includes(options.baseline)) {
    throw new EngineError(`The baseline configuration "${options.baseline}" is not among the configurations supplied (${names.join(', ')}).`, 'unknown');
  }
  const pairs: [number, number][] = [];
  if (options.baseline !== undefined) {
    const base = names.indexOf(options.baseline);
    for (let i = 0; i < configurations.length; i++) if (i !== base) pairs.push([i, base]);
  } else {
    for (let i = 0; i < configurations.length; i++) {
      for (let j = i + 1; j < configurations.length; j++) pairs.push([i, j]);
    }
  }
  const m = pairs.length;
  const perComparisonLevel = 1 - (1 - familyLevel) / m;
  const paired = options.paired ?? configurations.every((c) => c.values.length === configurations[0].values.length);
  const comparisons = pairs.map(([i, j]) =>
    paired
      ? pairedTComparison(configurations[i].values, configurations[j].values, {
          level: perComparisonLevel,
          labelA: names[i],
          labelB: names[j],
        })
      : welchComparison(configurations[i].values, configurations[j].values, {
          level: perComparisonLevel,
          labelA: names[i],
          labelB: names[j],
        }),
  );
  const means = configurations.map((c) => ({ name: c.name, mean: meanOf(c.values) }));
  const best = means.reduce((acc, cur) => (cur.mean < acc.mean ? cur : acc));
  return {
    method: `Bonferroni-adjusted simultaneous ${paired ? 'paired-t' : 'Welch'} intervals`,
    configurations: names,
    comparisons,
    familyLevel,
    perComparisonLevel,
    comparisonCount: m,
    best,
    note: `Each of the ${m} intervals is at the ${(perComparisonLevel * 100).toFixed(2)}% level so that all of them hold simultaneously at ${(familyLevel * 100).toFixed(0)}%. "Best" is the smallest mean, which is the right direction for a waiting time or a cost; for a throughput take the largest instead. A configuration whose interval against the best one contains zero is not distinguishable from it by these runs.`,
    exactness: 'empirical',
  };
}
