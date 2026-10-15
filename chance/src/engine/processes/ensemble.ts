/**
 * Path ensembles: running many trajectories and summarising them over time.
 *
 * The simulation loop is a generator that yields between chunks of paths, for
 * the same reason as `src/engine/simulation/runner.ts`: a Web Worker blocked
 * in a synchronous loop can never receive a `cancel` message, and
 * `SharedArrayBuffer` is unavailable unless the page is cross-origin isolated.
 * Yielding between chunks lets the worker's message queue drain. A cancelled
 * run returns the paths it finished, with `partial: true`.
 *
 * Two bands are reported and they are NOT the same statement:
 *
 *  - the band for the MEAN path is a confidence interval for E[X(t)]. It
 *    shrinks like 1/√n and says where the average lies.
 *  - the band for the PATHS is a pair of quantiles of the simulated values at
 *    each time. It does not shrink with n and says where a given percentage of
 *    individual trajectories lie.
 *
 * Conflating them is the standard error in fan charts, so both carry an
 * explicit `meaning` string.
 */
import { EngineError, Validator } from '../core/result';
import { Random, Xoshiro128 } from '../random/rng';
import { normalQuantile } from '../special/gamma';
import { mean as meanOf, quantileSorted, sortedCopy, variance as varianceOf, wilsonInterval } from '../stats/descriptive';
import type { PathEnsemble, RunHooks } from './types';

export const DEFAULT_CHUNK_PATHS = 200;

/** Draws one path on the given grid. */
export type PathSampler = (rng: Random, times: number[]) => number[];

export function validateGrid(times: number[]): void {
  const v = new Validator();
  if (times.length < 1) v.add('The time grid needs at least one point.', 'times', 'shape');
  for (let i = 0; i < times.length; i++) {
    if (!Number.isFinite(times[i])) v.add(`Time grid entry ${i + 1} is not a finite number.`, 'times', 'finite');
    else if (i > 0 && !(times[i] > times[i - 1])) {
      v.add(`The time grid must be strictly increasing: entry ${i + 1} (${times[i]}) does not exceed entry ${i} (${times[i - 1]}).`, 'times', 'order');
    }
  }
  if (times.length && times[0] < 0) v.add('The time grid must start at 0 or later.', 'times', 'range');
  v.throwIfInvalid();
}

/**
 * Run `paths` trajectories on a fixed time grid, yielding the number of
 * completed paths between chunks.
 */
export function* ensembleSteps(
  sampler: PathSampler,
  times: number[],
  paths: number,
  seed: string,
  hooks: RunHooks = {},
  chunkSize = DEFAULT_CHUNK_PATHS,
): Generator<number, PathEnsemble, void> {
  validateGrid(times);
  const v = new Validator();
  v.integer(paths, 'paths', 'Number of paths', 1);
  if (typeof seed !== 'string' || !seed.length) v.add('A seed is required so the run can be reproduced.', 'seed', 'required');
  v.throwIfInvalid();

  const rng = new Random(new Xoshiro128(seed));
  const out: number[][] = [];
  let cancelled = false;
  while (out.length < paths) {
    const end = Math.min(paths, out.length + chunkSize);
    while (out.length < end) {
      const path = sampler(rng, times);
      if (path.length !== times.length) {
        throw new EngineError(
          `The path sampler returned ${path.length} values for a grid of ${times.length} times.`,
          'shape',
        );
      }
      out.push(path);
    }
    hooks.onProgress?.({ completed: out.length, total: paths });
    yield out.length;
    if (hooks.isCancelled?.()) {
      cancelled = true;
      break;
    }
  }
  return {
    times: [...times],
    paths: out,
    pathsRequested: paths,
    pathsCompleted: out.length,
    partial: cancelled || out.length < paths,
    seed,
  };
}

/** Run an ensemble to completion (no cancellation). */
export function runEnsemble(
  sampler: PathSampler,
  times: number[],
  paths: number,
  seed: string,
  chunkSize = DEFAULT_CHUNK_PATHS,
): PathEnsemble {
  const steps = ensembleSteps(sampler, times, paths, seed, {}, chunkSize);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export interface Band {
  level: number;
  low: number[];
  high: number[];
  /** What the band is a statement about. Deliberately verbose. */
  meaning: string;
}

export interface FanChart {
  times: number[];
  meanPath: number[];
  /** Confidence interval for the expected value E[X(t)] at each time. */
  meanBand: Band;
  /** Quantiles of the simulated paths at each time. */
  pathBand: Band;
  pathsUsed: number;
  partial: boolean;
  exactness: 'empirical';
  warnings: string[];
}

/**
 * Fan chart from an ensemble.
 *
 * `level` is used for both bands but they mean different things; see the module
 * comment and the `meaning` strings.
 */
export function fanChart(ensemble: PathEnsemble, level = 0.9): FanChart {
  const v = new Validator();
  v.range(level, 'level', 'Band level', 0.5, 0.9999);
  if (ensemble.pathsCompleted < 2) {
    v.add('At least 2 completed paths are needed to form a band. Run more paths.', 'paths', 'insufficient');
  }
  v.throwIfInvalid();

  const n = ensemble.pathsCompleted;
  const k = ensemble.times.length;
  const meanPath = new Array<number>(k);
  const meanLow = new Array<number>(k);
  const meanHigh = new Array<number>(k);
  const pathLow = new Array<number>(k);
  const pathHigh = new Array<number>(k);
  const alpha = (1 - level) / 2;
  const z = normalQuantile(1 - alpha);
  const column = new Float64Array(n);
  for (let j = 0; j < k; j++) {
    for (let i = 0; i < n; i++) column[i] = ensemble.paths[i][j];
    const m = meanOf(column);
    const sd = Math.sqrt(varianceOf(column, 1));
    const se = sd / Math.sqrt(n);
    meanPath[j] = m;
    meanLow[j] = m - z * se;
    meanHigh[j] = m + z * se;
    const sorted = sortedCopy(column);
    pathLow[j] = quantileSorted(sorted, alpha);
    pathHigh[j] = quantileSorted(sorted, 1 - alpha);
  }

  const warnings: string[] = [];
  if (ensemble.partial) {
    warnings.push(
      `This fan chart uses ${n.toLocaleString('en-US')} of ${ensemble.pathsRequested.toLocaleString('en-US')} requested paths because the run was stopped early. The results are partial.`,
    );
  }
  if (n < 200) warnings.push(`Only ${n} paths were simulated, so both bands are imprecise. The outer path quantiles need the most paths.`);
  return {
    times: [...ensemble.times],
    meanPath,
    meanBand: {
      level,
      low: meanLow,
      high: meanHigh,
      meaning: `A ${(level * 100).toFixed(0)}% confidence interval for the MEAN of the process at each time, from Monte Carlo sampling error only (mean ± z·s/√n). It narrows as more paths are run. It does NOT say where individual paths lie.`,
    },
    pathBand: {
      level,
      low: pathLow,
      high: pathHigh,
      meaning: `The ${(alpha * 100).toFixed(1)}% and ${((1 - alpha) * 100).toFixed(1)}% quantiles of the simulated PATHS at each time, so about ${(level * 100).toFixed(0)}% of individual trajectories fall inside the band at any one time. It does not narrow as more paths are run. It is NOT a confidence interval for the mean, and because it is computed time by time it is not a band containing whole paths with that probability.`,
    },
    pathsUsed: n,
    partial: ensemble.partial,
    exactness: 'empirical',
    warnings,
  };
}

export type CrossingDirection = 'above' | 'below';

export interface FirstPassageEstimate {
  level: number;
  direction: CrossingDirection;
  /** Fraction of paths that crossed by the end of the grid. */
  probability: number;
  probabilityInterval: { low: number; high: number; level: number };
  crossed: number;
  pathsUsed: number;
  /** Quantiles of the crossing time, over the paths that crossed. */
  crossingTimeQuantiles: { p: number; t: number }[];
  meanCrossingTime: number | null;
  exactness: 'empirical';
  notes: string[];
  warnings: string[];
}

/**
 * First-passage analysis from simulated paths: the probability of crossing a
 * level by the end of the grid, and the distribution of the crossing time
 * among the paths that crossed.
 *
 * The crossing time is only resolved to the time grid: a path that goes above
 * the level and back between two grid points is not seen. The returned
 * probability is therefore a LOWER bound on the continuous-time crossing
 * probability for a continuous process, which the notes state.
 */
export function firstPassageFromEnsemble(
  ensemble: PathEnsemble,
  level: number,
  direction: CrossingDirection = 'above',
  quantiles: number[] = [0.1, 0.25, 0.5, 0.75, 0.9],
): FirstPassageEstimate {
  const v = new Validator();
  v.finite(level, 'level', 'Threshold level');
  if (ensemble.pathsCompleted < 1) v.add('No completed paths: nothing to analyse.', 'paths', 'insufficient');
  for (const q of quantiles) v.range(q, 'quantiles', 'Quantile', 0, 1);
  v.throwIfInvalid();

  const crossingTimes: number[] = [];
  const n = ensemble.pathsCompleted;
  for (let i = 0; i < n; i++) {
    const path = ensemble.paths[i];
    for (let j = 0; j < path.length; j++) {
      const hit = direction === 'above' ? path[j] >= level : path[j] <= level;
      if (hit) {
        crossingTimes.push(ensemble.times[j]);
        break;
      }
    }
  }
  const crossed = crossingTimes.length;
  const interval = wilsonInterval(crossed, n);
  const sorted = sortedCopy(crossingTimes);
  const notes = [
    'The crossing time is resolved only to the simulation time grid. For a continuous process a path can cross and return between two grid points, so this probability is a lower bound on the continuous-time crossing probability; refine the grid to tighten it.',
    'The quantiles of the crossing time are conditional on crossing at all. They are not comparable with the unconditional probability above.',
  ];
  const warnings: string[] = [];
  if (ensemble.partial) warnings.push(`Partial run: ${n.toLocaleString('en-US')} of ${ensemble.pathsRequested.toLocaleString('en-US')} paths completed.`);
  if (crossed === 0) {
    warnings.push('No simulated path crossed the level. That does not make crossing impossible — it means the probability is small relative to the number of paths. Use the interval above for the range consistent with the data.');
  } else if (crossed < 10) {
    warnings.push(`Only ${crossed} path(s) crossed, so the crossing-time quantiles are very imprecise.`);
  }
  return {
    level,
    direction,
    probability: crossed / n,
    probabilityInterval: { low: interval.low, high: interval.high, level: 0.95 },
    crossed,
    pathsUsed: n,
    crossingTimeQuantiles: crossed ? quantiles.map((p) => ({ p, t: quantileSorted(sorted, p) })) : [],
    meanCrossingTime: crossed ? meanOf(sorted) : null,
    exactness: 'empirical',
    notes,
    warnings,
  };
}
