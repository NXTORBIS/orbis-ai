/**
 * Bootstrap methods for dependent data.
 *
 * The ordinary i.i.d. bootstrap is INVALID on an autocorrelated series: it
 * resamples single observations, destroying the dependence, so it estimates
 * the variance of a statistic as if the observations were independent and
 * understates it by roughly the variance-inflation factor. The moving-block
 * and stationary bootstraps resample blocks instead, preserving the
 * within-block dependence.
 *
 * The i.i.d. version is provided here only so the two can be compared, and it
 * always carries that warning.
 */
import { EngineError } from '../core/result';
import { stableSum } from '../core/numeric';
import { Random, type Seed } from '../random/rng';
import { explain, type TsInterval } from './types';
import { checkSeries, meanOf } from './util';

export type BlockBootstrapKind = 'moving-block' | 'stationary' | 'iid';

export interface BootstrapResult {
  kind: BlockBootstrapKind;
  /** Statistic on the observed series. */
  observed: number;
  /** Bootstrap replicates of the statistic. */
  replicates: number[];
  /** Bootstrap standard error: the standard deviation of the replicates. */
  standardError: number;
  bias: number;
  /** Percentile interval for the statistic. */
  interval: TsInterval;
  blockLength: number;
  replications: number;
  valid: boolean;
  explanation: ReturnType<typeof explain>;
  warnings: string[];
}

/**
 * Rule-of-thumb block length n^{1/3}, which is the right order for the mean
 * of a weakly dependent series. The result always says the choice is a
 * tuning parameter, because the bootstrap variance depends on it.
 */
export function defaultBlockLength(n: number): number {
  return Math.max(2, Math.min(n - 1, Math.round(Math.pow(n, 1 / 3))));
}

/**
 * Block bootstrap for a statistic of a single series.
 *
 * `moving-block`: concatenate ⌈n/L⌉ blocks of fixed length L, each starting at
 * a uniformly chosen position in 0..n−L, then trim to length n.
 * `stationary` (Politis & Romano): geometric block lengths with mean L and
 * wrap-around, which makes the resampled series stationary.
 * `iid`: single observations — included only for comparison and flagged as
 * invalid for dependent data.
 */
export function blockBootstrap(
  series: ArrayLike<number>,
  options: {
    statistic?: (x: number[]) => number;
    kind?: BlockBootstrapKind;
    blockLength?: number;
    replications?: number;
    seed?: Seed;
    level?: number;
  } = {},
): BootstrapResult {
  const y = checkSeries(series, 12, 'series');
  const n = y.length;
  const kind = options.kind ?? 'moving-block';
  const statistic = options.statistic ?? meanOf;
  const replications = options.replications ?? 1000;
  if (!Number.isInteger(replications) || replications < 50) {
    throw new EngineError(`The number of bootstrap replications must be a whole number of at least 50 (received ${replications}).`, 'range');
  }
  const level = options.level ?? 0.95;
  if (!(level > 0 && level < 1)) throw new EngineError(`The interval level must be between 0 and 1 (received ${level}).`, 'range');
  const blockLength = kind === 'iid' ? 1 : (options.blockLength ?? defaultBlockLength(n));
  if (!Number.isInteger(blockLength) || blockLength < 1 || blockLength > n) {
    throw new EngineError(`The block length must be a whole number in [1, ${n}] (received ${blockLength}).`, 'range');
  }
  if (kind === 'moving-block' && blockLength >= n) {
    throw new EngineError(`A block length of ${blockLength} for a series of ${n} observations gives a single block and no resampling at all.`, 'range');
  }
  const rng = new Random(options.seed ?? 'orbis-chance-block-bootstrap');
  const observed = statistic(y);
  if (!Number.isFinite(observed)) throw new EngineError('The statistic is not finite on the observed series; no bootstrap is possible.', 'numerical');
  const replicates = new Array<number>(replications);
  const sample = new Array<number>(n);
  for (let b = 0; b < replications; b++) {
    let filled = 0;
    while (filled < n) {
      if (kind === 'iid') {
        sample[filled++] = y[rng.int(0, n - 1)];
      } else if (kind === 'moving-block') {
        const start = rng.int(0, n - blockLength);
        for (let j = 0; j < blockLength && filled < n; j++) sample[filled++] = y[start + j];
      } else {
        // Stationary bootstrap: geometric length with mean blockLength, circular.
        const p = 1 / blockLength;
        let start = rng.int(0, n - 1);
        do {
          sample[filled++] = y[start % n];
          start++;
        } while (filled < n && rng.uniform() > p);
      }
    }
    const v = statistic(sample.slice(0, n));
    if (!Number.isFinite(v)) {
      throw new EngineError(`The statistic came out non-finite on bootstrap replicate ${b}; the bootstrap is abandoned rather than reporting a filtered distribution.`, 'numerical');
    }
    replicates[b] = v;
  }
  const m = meanOf(replicates);
  const se = Math.sqrt(stableSum(replicates.map((v) => (v - m) * (v - m))) / (replications - 1));
  const sorted = [...replicates].sort((a, b) => a - b);
  const q = (p: number): number => {
    const h = (sorted.length - 1) * p;
    const lo = Math.floor(h);
    const hi = Math.min(sorted.length - 1, lo + 1);
    return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
  };
  const warnings: string[] = [];
  if (kind === 'iid') {
    warnings.push(
      'The i.i.d. bootstrap is NOT VALID for an autocorrelated series. It resamples single observations and so destroys the dependence, giving a standard error that is too small — typically by the square root of the variance-inflation factor. It is provided here only for comparison with a block bootstrap.',
    );
  } else {
    warnings.push(
      `The block length (${blockLength}) is a tuning parameter, not an estimate. Too short and the dependence is still broken; too long and there are too few distinct blocks. The reported standard error depends on it.`,
    );
  }
  if (kind === 'moving-block') {
    warnings.push('The moving-block bootstrap resampled series is not stationary (the join points between blocks break the dependence), which biases the variance slightly downwards. The stationary bootstrap avoids that at the cost of a random block length.');
  }
  warnings.push(`The percentile interval is a bootstrap approximation from ${replications} replicates; its own Monte Carlo error is about ${(se / Math.sqrt(2 * replications)).toExponential(2)} on the standard error.`);
  return {
    kind,
    observed,
    replicates,
    standardError: se,
    bias: m - observed,
    interval: {
      low: q((1 - level) / 2),
      high: q(1 - (1 - level) / 2),
      level,
      of: 'the statistic computed on the series',
      method: `${kind} bootstrap percentile interval (${replications} replicates, block length ${blockLength})`,
      kind: 'estimate',
    },
    blockLength,
    replications,
    valid: kind !== 'iid',
    explanation: explain(
      kind === 'moving-block'
        ? 'Moving-block bootstrap'
        : kind === 'stationary'
          ? 'Stationary bootstrap (Politis & Romano, geometric block lengths)'
          : 'i.i.d. bootstrap — invalid for dependent data, shown for comparison',
      'empirical',
      {
        steps: [
          { label: 'Observations', value: String(n) },
          { label: 'Replications', value: String(replications) },
          { label: 'Block length', value: String(blockLength) },
          { label: 'Observed statistic', value: observed.toExponential(6) },
          { label: 'Bootstrap standard error', value: se.toExponential(6) },
          { label: 'Bootstrap bias estimate', value: (m - observed).toExponential(6) },
        ],
        assumptions: [
          kind === 'iid'
            ? 'Independence — which is exactly what a time series does not have.'
            : 'Weak dependence that decays fast enough that blocks of this length capture most of it.',
          'The statistic is smooth enough for a bootstrap to work at all; a quantile at the edge of the sample is not.',
        ],
        limitations: [
          'A bootstrap standard error is a Monte Carlo estimate and has its own sampling error.',
          'Block methods cannot capture dependence longer than the block length, so a long-memory series will still have its variance understated.',
          'The percentile interval is first-order accurate only; it does not correct for skewness or bias.',
        ],
      },
    ),
    warnings,
  };
}

export interface BootstrapComparison {
  iid: BootstrapResult;
  movingBlock: BootstrapResult;
  stationary: BootstrapResult;
  /** How much larger the block standard error is than the i.i.d. one. */
  ratio: number;
  interpretation: string;
  warnings: string[];
}

/**
 * Run the i.i.d. and block bootstraps side by side on the same series and
 * report the ratio of their standard errors. On autocorrelated data the i.i.d.
 * bootstrap is visibly too small, which is the point.
 */
export function compareBootstraps(
  series: ArrayLike<number>,
  options: { statistic?: (x: number[]) => number; blockLength?: number; replications?: number; seed?: Seed } = {},
): BootstrapComparison {
  const common = { statistic: options.statistic, blockLength: options.blockLength, replications: options.replications ?? 600 };
  const iid = blockBootstrap(series, { ...common, kind: 'iid', blockLength: 1, seed: `${options.seed ?? 'cmp'}-iid` });
  const mb = blockBootstrap(series, { ...common, kind: 'moving-block', seed: `${options.seed ?? 'cmp'}-mb` });
  const st = blockBootstrap(series, { ...common, kind: 'stationary', seed: `${options.seed ?? 'cmp'}-st` });
  const ratio = iid.standardError > 0 ? mb.standardError / iid.standardError : Infinity;
  return {
    iid,
    movingBlock: mb,
    stationary: st,
    ratio,
    interpretation:
      ratio > 1.15
        ? `The moving-block bootstrap standard error is ${ratio.toFixed(2)}× the i.i.d. one. The series is autocorrelated, so the i.i.d. bootstrap understates the uncertainty by that factor and must not be used here.`
        : ratio < 0.87
          ? `The moving-block standard error is ${ratio.toFixed(2)}× the i.i.d. one, i.e. smaller. That points to negative autocorrelation (possibly over-differencing): the mean is estimated more precisely than independent sampling would allow.`
          : `The two standard errors agree to within ${(Math.abs(ratio - 1) * 100).toFixed(1)}%, which is consistent with little or no autocorrelation at the block length used. The i.i.d. bootstrap is not obviously wrong on this series — but that is a finding about this series, not a general licence.`,
    warnings: [...mb.warnings, 'Comparing the two is diagnostic. Report the block bootstrap, not the i.i.d. one, whenever the data are time-ordered.'],
  };
}
