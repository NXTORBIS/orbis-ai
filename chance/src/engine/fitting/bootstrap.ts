/**
 * Parametric bootstrap confidence intervals: a third, assumption-light route
 * to uncertainty, independent of both the Wald approximation and the profile
 * likelihood.
 *
 * Written as a generator that yields after each chunk of resamples, the same
 * pattern as `simulationSteps` in the simulation runner: a worker stuck in a
 * synchronous loop can never receive a cancel message.
 */
import { EngineError } from '../core/result';
import { Random, Xoshiro128, type Seed } from '../random/rng';
import type { DistributionDef, Params } from '../distributions/types';
import { fitDistribution } from './mle';
import type { FitInterval, FitResult } from './types';

export interface BootstrapOptions {
  replicates?: number;
  level?: number;
  seed?: Seed;
  /** Resamples between yields. */
  chunk?: number;
}

export interface BootstrapResult {
  replicates: number;
  completed: number;
  /** Resamples whose own fit failed (reported, never ignored silently). */
  failures: number;
  failureReasons: string[];
  intervals: Record<string, FitInterval>;
  /** Bootstrap distribution of each parameter, sorted. */
  samples: Record<string, number[]>;
  bias: Record<string, number>;
  warnings: string[];
}

const DEFAULT_REPLICATES = 500;

/**
 * Percentile bootstrap intervals for a fitted distribution. Each resample is
 * drawn from the FITTED distribution (parametric bootstrap) and refitted by
 * the same estimator, so the interval reflects the estimator's own sampling
 * behaviour at that sample size.
 */
export function* parametricBootstrapSteps(
  def: DistributionDef,
  fit: FitResult,
  options: BootstrapOptions = {},
): Generator<number, BootstrapResult, void> {
  const replicates = options.replicates ?? DEFAULT_REPLICATES;
  const level = options.level ?? 0.95;
  const chunk = Math.max(1, options.chunk ?? 25);
  if (!Number.isInteger(replicates) || replicates < 50) {
    throw new EngineError('A parametric bootstrap needs at least 50 resamples for a usable interval.', 'range');
  }
  if (!(level > 0 && level < 1)) throw new EngineError('Confidence level must be between 0 and 1.', 'range');
  const keys = def.params.filter((s) => !(s.key in fit.fixedParams)).map((s) => s.key);
  const rng = new Random(new Xoshiro128(options.seed ?? 'bootstrap'));
  const draws: Record<string, number[]> = Object.fromEntries(keys.map((k) => [k, [] as number[]]));
  const failureReasons: string[] = [];
  let failures = 0;
  let completed = 0;

  while (completed < replicates) {
    const end = Math.min(replicates, completed + chunk);
    for (; completed < end; completed++) {
      const resample = new Array<number>(fit.n);
      for (let i = 0; i < fit.n; i++) resample[i] = def.sample(rng, fit.params);
      try {
        const r = fitDistribution(def, resample, { fixed: fit.fixedParams, level });
        for (const k of keys) draws[k].push(r.params[k]);
      } catch (e) {
        failures++;
        if (e instanceof EngineError && failureReasons.length < 3) failureReasons.push(e.message);
      }
    }
    yield completed;
  }

  const usable = draws[keys[0]]?.length ?? 0;
  if (usable < Math.max(50, replicates * 0.5)) {
    throw new EngineError(
      `Only ${usable} of ${replicates} bootstrap resamples could be refitted (${failures} failed). A percentile interval from so few resamples would be misleading, so none is reported. First failure: ${failureReasons[0] ?? 'unknown'}.`,
      'numerical',
    );
  }
  const alpha = (1 - level) / 2;
  const intervals: Record<string, FitInterval> = {};
  const samples: Record<string, number[]> = {};
  const bias: Record<string, number> = {};
  for (const k of keys) {
    const s = [...draws[k]].sort((a, b) => a - b);
    samples[k] = s;
    const pick = (q: number): number => {
      // Type-7 style interpolation on the sorted resample values.
      const h = (s.length - 1) * q;
      const lo = Math.floor(h);
      const hi = Math.min(s.length - 1, lo + 1);
      return s[lo] + (h - lo) * (s[hi] - s[lo]);
    };
    intervals[k] = {
      low: pick(alpha),
      high: pick(1 - alpha),
      level,
      method: `Parametric bootstrap percentile interval from ${s.length} resamples of size ${fit.n} drawn from the fitted distribution and refitted`,
    };
    const m = s.reduce((a, b) => a + b, 0) / s.length;
    bias[k] = m - fit.params[k];
  }
  const warnings: string[] = [];
  if (failures) warnings.push(`${failures} of ${replicates} resamples could not be refitted and were excluded; the interval rests on the remainder. Reasons include: ${failureReasons.join(' | ')}`);
  warnings.push('A parametric bootstrap assumes the fitted family is correct: it measures estimation uncertainty, not the risk that the family itself is wrong.');
  for (const k of keys) {
    const se = fit.uncertainty.find((u) => u.key === k)?.standardError;
    if (se && Math.abs(bias[k]) > se) {
      warnings.push(`The bootstrap mean of ${k} differs from the estimate by more than one standard error (bias ${bias[k].toPrecision(3)}), so the estimator is noticeably biased at this sample size and the symmetric Wald interval is misplaced.`);
    }
  }
  return { replicates, completed, failures, failureReasons, intervals, samples, bias, warnings };
}

/** Run the bootstrap to completion (no cancellation). */
export function parametricBootstrap(def: DistributionDef, fit: FitResult, options: BootstrapOptions = {}): BootstrapResult {
  const steps = parametricBootstrapSteps(def, fit, options);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

/** Draw one sample of size n from a distribution — shared by the bootstrap and the Q–Q envelope. */
export function sampleFrom(def: DistributionDef, params: Params, n: number, rng: Random): number[] {
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = def.sample(rng, params);
  return out;
}
