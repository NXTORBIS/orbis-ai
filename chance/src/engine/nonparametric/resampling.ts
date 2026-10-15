/**
 * Permutation and bootstrap: the most assumption-free route available.
 *
 * A permutation test needs no distributional assumption at all — only
 * exchangeability of the labels under the null. A bootstrap interval needs no
 * formula for the standard error of the statistic.
 *
 * Both are exposed as generators that yield between chunks of work, for the
 * same reason as the Monte Carlo runner in `simulation/runner.ts`: a Web
 * Worker blocked inside a synchronous loop can never receive a `cancel`
 * message, so the loop has to hand control back periodically.
 */
import { EngineError } from '../core/result';
import { Random } from '../random/rng';
import { logFactorial, normalCdf, normalQuantile } from '../special/gamma';
import { mean, quantileSorted } from '../stats/descriptive';
import { P_VALUE_LIMITATIONS, type Alternative, requireGroups, sensitivity, summarizeGroups } from './support';
import type { NonparametricInterval, NonparametricResult } from './types';

export interface PermutationProgress {
  completed: number;
  total: number;
  route: 'exact' | 'monte-carlo';
}

export interface PermutationOptions {
  alternative?: Alternative;
  /** Enumerate exhaustively when the number of distinct label assignments is at most this. */
  maxExactPermutations?: number;
  /** Monte Carlo sample count used when exhaustive enumeration is impossible. */
  monteCarloSamples?: number;
  seed?: string;
  chunkSize?: number;
  level?: number;
  statisticName?: string;
  labels?: string[];
}

/** Number of distinct assignments of the pooled values to groups of these sizes. */
export function permutationCount(sizes: number[]): number {
  const n = sizes.reduce((a, b) => a + b, 0);
  let log = logFactorial(n);
  for (const s of sizes) log -= logFactorial(s);
  return Math.exp(log);
}

/** Difference in means between the first two groups — the usual default statistic. */
export function meanDifference(groups: number[][]): number {
  if (groups.length < 2) throw new EngineError('A difference in means needs two groups.', 'insufficient');
  return mean(groups[0]) - mean(groups[1]);
}

function* enumerateAssignments(pool: number[], sizes: number[]): Generator<number[][], void, void> {
  const n = pool.length;
  const used = new Array<boolean>(n).fill(false);
  const groups: number[][] = sizes.map(() => []);
  function* place(g: number, start: number): Generator<number[][], void, void> {
    if (g === sizes.length) {
      yield groups.map((x) => [...x]);
      return;
    }
    if (groups[g].length === sizes[g]) {
      yield* place(g + 1, 0);
      return;
    }
    for (let i = start; i < n; i++) {
      if (used[i]) continue;
      used[i] = true;
      groups[g].push(pool[i]);
      yield* place(g, i + 1);
      groups[g].pop();
      used[i] = false;
    }
  }
  yield* place(0, 0);
}

/**
 * Permutation test for an arbitrary statistic.
 *
 * The two-sided route compares |T| against |T_observed|, which is correct for
 * a statistic centred at 0 under the null (a difference, a correlation, a
 * standardised statistic). For a statistic that is not centred at 0, use a
 * one-sided alternative or re-express the statistic.
 */
export function* permutationTestSteps(
  groups: { label?: string; values: ArrayLike<number> }[],
  statistic: (groups: number[][]) => number,
  options: PermutationOptions = {},
): Generator<PermutationProgress, NonparametricResult, void> {
  const alt = options.alternative ?? 'two-sided';
  const level = options.level ?? 0.95;
  const chunkSize = Math.max(1, options.chunkSize ?? 2000);
  const maxExact = options.maxExactPermutations ?? 200_000;
  const samples = options.monteCarloSamples ?? 9999;
  const statisticName = options.statisticName ?? 'T (user statistic)';
  const gs = requireGroups(groups, 2, 1, 'A permutation test');
  const sizes = gs.map((g) => g.values.length);
  const values = gs.map((g) => g.values);
  const observed = statistic(values);
  if (!Number.isFinite(observed)) {
    throw new EngineError('The statistic returned a value that is not a finite number for the observed data.', 'finite');
  }
  const pool = gs.flatMap((g) => g.values);
  const totalAssignments = permutationCount(sizes);
  const useExact = totalAssignments <= maxExact;
  const isExtreme = (t: number): boolean => {
    switch (alt) {
      case 'greater':
        return t >= observed - 1e-12 * Math.max(1, Math.abs(observed));
      case 'less':
        return t <= observed + 1e-12 * Math.max(1, Math.abs(observed));
      case 'two-sided':
        return Math.abs(t) >= Math.abs(observed) - 1e-12 * Math.max(1, Math.abs(observed));
    }
  };
  let extreme = 0;
  let done = 0;
  const total = useExact ? Math.round(totalAssignments) : samples;
  if (useExact) {
    for (const assignment of enumerateAssignments(pool, sizes)) {
      const t = statistic(assignment);
      if (!Number.isFinite(t)) {
        throw new EngineError('The statistic returned a non-finite value for a permuted data set, so no p-value can be formed.', 'finite');
      }
      if (isExtreme(t)) extreme++;
      done++;
      if (done % chunkSize === 0) yield { completed: done, total, route: 'exact' };
    }
  } else {
    const rng = new Random(options.seed ?? 'orbis-permutation');
    const shuffled = [...pool];
    for (let s = 0; s < samples; s++) {
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = rng.int(0, i);
        const tmp = shuffled[i];
        shuffled[i] = shuffled[j];
        shuffled[j] = tmp;
      }
      const assignment: number[][] = [];
      let offset = 0;
      for (const size of sizes) {
        assignment.push(shuffled.slice(offset, offset + size));
        offset += size;
      }
      const t = statistic(assignment);
      if (!Number.isFinite(t)) {
        throw new EngineError('The statistic returned a non-finite value for a permuted data set, so no p-value can be formed.', 'finite');
      }
      if (isExtreme(t)) extreme++;
      done++;
      if (done % chunkSize === 0) yield { completed: done, total, route: 'monte-carlo' };
    }
  }
  // Exact: the observed arrangement is one of those enumerated, so the ratio
  // is already a valid p-value. Monte Carlo: the (r+1)/(B+1) estimator keeps
  // the test valid and never returns 0, which a bare r/B can.
  const pValue = useExact ? extreme / done : (extreme + 1) / (done + 1);
  const monteCarloSe = useExact ? 0 : Math.sqrt((pValue * (1 - pValue)) / done);
  return {
    name: `Permutation test (${useExact ? 'exact enumeration' : 'Monte Carlo'})`,
    nullHypothesis: 'The group labels are exchangeable: every assignment of the observed values to the groups is equally likely',
    alternativeHypothesis:
      alt === 'two-sided'
        ? 'The statistic is further from 0 than label-shuffling alone would produce'
        : `The statistic is ${alt === 'greater' ? 'larger' : 'smaller'} than label-shuffling alone would produce`,
    statistic: observed,
    statisticName,
    degreesOfFreedom: null,
    pValue,
    pValueRoute: useExact ? 'exact' : 'monte-carlo',
    pValueRouteReason: useExact
      ? `All ${done.toLocaleString('en-US')} distinct label assignments were enumerated, so the p-value is the exact permutation probability — no distributional assumption and no sampling error.`
      : `There are about ${totalAssignments.toPrecision(4)} distinct label assignments, more than the enumeration limit of ${maxExact.toLocaleString('en-US')}, so ${done.toLocaleString('en-US')} random assignments were drawn with seed "${options.seed ?? 'orbis-permutation'}". The p-value is (r+1)/(B+1) = (${extreme}+1)/(${done}+1); its Monte Carlo standard error is ${monteCarloSe.toPrecision(3)}.`,
    exactness: useExact ? 'exact' : 'empirical',
    effectSizes: [
      {
        name: statisticName,
        value: observed,
        interpretation: `The observed statistic is ${observed.toPrecision(6)}. ${extreme} of ${done.toLocaleString('en-US')} ${useExact ? 'possible' : 'sampled'} label assignments were at least as extreme.`,
      },
    ],
    interval: null,
    assumptions: [
      'Under the null hypothesis the group labels are exchangeable — the one assumption of a permutation test.',
      'No distributional assumption of any kind is made about the data.',
      ...(alt === 'two-sided'
        ? ['The two-sided comparison uses |T|, which assumes the statistic is centred at 0 under the null. For a statistic that is not, use a one-sided alternative.']
        : []),
    ],
    limitations: [
      ...P_VALUE_LIMITATIONS,
      'Exchangeability is a real assumption: if the groups differ in spread as well as location, shuffling the labels does not reproduce the null for a difference-in-means statistic, and the test can be invalid rather than merely inefficient.',
      ...(useExact
        ? []
        : [
            `The p-value carries Monte Carlo error of about ±${(1.96 * monteCarloSe).toPrecision(3)} (95%). Increase the number of resamples to shrink it; a p-value near the decision threshold should never be read off a small resample count.`,
          ]),
    ],
    notes: [
      `${useExact ? 'Enumerated' : 'Sampled'} ${done.toLocaleString('en-US')} label assignments of a possible ${totalAssignments < 1e15 ? Math.round(totalAssignments).toLocaleString('en-US') : totalAssignments.toPrecision(4)}.`,
      `Group sizes ${sizes.join(', ')}.`,
    ],
    ties: {
      tiesPresent: false,
      correctionApplied: false,
      tiedGroups: 0,
      detail: 'A permutation test needs no tie correction: ties are carried through the resampling automatically.',
    },
    sensitivity: sensitivity(pValue, 1 - level, {
      kind: 'none',
      reason: 'the statistic is user-supplied, so no standard effect-size scale applies. Judge sensitivity from the spread of the permutation distribution relative to the observed statistic.',
    }),
    groups: summarizeGroups(gs),
    diagnostics: {
      observed,
      extreme,
      permutations: done,
      possiblePermutations: totalAssignments,
      monteCarloStandardError: monteCarloSe,
    },
  };
}

/** Drain the permutation generator. */
export function permutationTest(
  groups: { label?: string; values: ArrayLike<number> }[],
  statistic: (groups: number[][]) => number,
  options: PermutationOptions = {},
): NonparametricResult {
  const steps = permutationTestSteps(groups, statistic, options);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export interface BootstrapResult {
  estimate: number;
  resamples: number;
  seed: string;
  /** Mean of the bootstrap replicates minus the original estimate. */
  bias: number;
  standardError: number;
  acceleration: number;
  biasCorrection: number;
  percentile: NonparametricInterval;
  basic: NonparametricInterval;
  bca: NonparametricInterval;
  exactness: 'empirical';
  assumptions: string[];
  limitations: string[];
  notes: string[];
}

export interface BootstrapOptions {
  resamples?: number;
  level?: number;
  seed?: string;
  chunkSize?: number;
}

/**
 * Bootstrap confidence intervals: percentile, basic (reverse percentile) and
 * BCa.
 *
 * BCa corrects for both the bias of the bootstrap distribution (z₀) and the
 * dependence of the standard error on the parameter (the acceleration a,
 * estimated here by the jackknife). It is second-order accurate, whereas the
 * percentile interval is only first-order accurate, so for a skewed statistic
 * the percentile interval's coverage can be noticeably below its nominal
 * level while BCa stays close.
 */
export function* bootstrapIntervalSteps(
  data: ArrayLike<number>,
  statistic: (xs: number[]) => number,
  options: BootstrapOptions = {},
): Generator<{ completed: number; total: number }, BootstrapResult, void> {
  const resamples = options.resamples ?? 2000;
  const level = options.level ?? 0.95;
  const seed = options.seed ?? 'orbis-bootstrap';
  const chunkSize = Math.max(1, options.chunkSize ?? 500);
  const xs = Array.from(data);
  const n = xs.length;
  if (n < 2) throw new EngineError('A bootstrap needs at least 2 observations.', 'insufficient');
  for (const v of xs) if (!Number.isFinite(v)) throw new EngineError('The data contain a value that is not a finite number.', 'finite');
  if (!(resamples >= 100)) throw new EngineError('At least 100 bootstrap resamples are needed for a usable interval.', 'range');
  const estimate = statistic(xs);
  if (!Number.isFinite(estimate)) throw new EngineError('The statistic is not finite for the observed data.', 'finite');
  const rng = new Random(seed);
  const replicates = new Float64Array(resamples);
  const buffer = new Array<number>(n);
  for (let b = 0; b < resamples; b++) {
    for (let i = 0; i < n; i++) buffer[i] = xs[rng.int(0, n - 1)];
    const t = statistic(buffer);
    if (!Number.isFinite(t)) {
      throw new EngineError(
        `The statistic returned a non-finite value on bootstrap resample ${b + 1}. A statistic that can be undefined on a resample (for example a variance when every value is identical) cannot be bootstrapped this way.`,
        'finite',
      );
    }
    replicates[b] = t;
    if ((b + 1) % chunkSize === 0) yield { completed: b + 1, total: resamples };
  }
  const sorted = Float64Array.from(replicates).sort();
  if (sorted[0] === sorted[sorted.length - 1]) {
    throw new EngineError(
      'Every bootstrap replicate is identical, so no interval can be formed. The statistic does not vary under resampling of this data.',
      'undefined',
    );
  }
  const alpha = 1 - level;
  const bootMean = mean(replicates);
  let sumSq = 0;
  for (let b = 0; b < resamples; b++) sumSq += (replicates[b] - bootMean) ** 2;
  const standardError = Math.sqrt(sumSq / (resamples - 1));
  const percentileLow = quantileSorted(sorted, alpha / 2);
  const percentileHigh = quantileSorted(sorted, 1 - alpha / 2);
  // Bias correction z₀ from the proportion of replicates below the estimate.
  let below = 0;
  let equal = 0;
  for (let b = 0; b < resamples; b++) {
    if (replicates[b] < estimate) below++;
    else if (replicates[b] === estimate) equal++;
  }
  const proportionBelow = (below + 0.5 * equal) / resamples;
  const z0 = normalQuantile(Math.min(1 - 1e-9, Math.max(1e-9, proportionBelow)));
  // Jackknife acceleration.
  const jack = new Float64Array(n);
  const reduced = new Array<number>(n - 1);
  for (let i = 0; i < n; i++) {
    let k = 0;
    for (let j = 0; j < n; j++) if (j !== i) reduced[k++] = xs[j];
    const t = statistic(reduced);
    if (!Number.isFinite(t)) {
      throw new EngineError(
        'The statistic is not finite with one observation removed, so the jackknife acceleration for BCa cannot be computed.',
        'finite',
      );
    }
    jack[i] = t;
  }
  const jackMean = mean(jack);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const d = jackMean - jack[i];
    num += d ** 3;
    den += d ** 2;
  }
  const acceleration = den > 0 ? num / (6 * den ** 1.5) : 0;
  const zAlpha = normalQuantile(alpha / 2);
  const zBeta = normalQuantile(1 - alpha / 2);
  const adjust = (z: number): number => {
    const denom = 1 - acceleration * (z0 + z);
    if (!(Math.abs(denom) > 1e-12)) {
      throw new EngineError(
        'The BCa adjustment is undefined for this statistic: the acceleration drives the adjusted level outside (0, 1). Use the percentile or basic interval and say which.',
        'undefined',
      );
    }
    return normalCdf(z0 + (z0 + z) / denom);
  };
  const a1 = Math.min(1 - 1e-9, Math.max(1e-9, adjust(zAlpha)));
  const a2 = Math.min(1 - 1e-9, Math.max(1e-9, adjust(zBeta)));
  const warnings: string[] = [];
  if (a1 < 1 / (resamples + 1) || a2 > resamples / (resamples + 1)) {
    warnings.push(
      `The BCa adjusted percentiles (${(a1 * 100).toPrecision(3)}% and ${(a2 * 100).toPrecision(3)}%) reach into the extreme tail of only ${resamples} replicates, so the endpoints rest on a handful of values. Increase the number of resamples to at least ${Math.ceil(2 / Math.min(a1, 1 - a2))}.`,
    );
  }
  return {
    estimate,
    resamples,
    seed,
    bias: bootMean - estimate,
    standardError,
    acceleration,
    biasCorrection: z0,
    percentile: {
      low: percentileLow,
      high: percentileHigh,
      level,
      of: 'the statistic',
      method: 'bootstrap percentile interval (first-order accurate; biased when the bootstrap distribution is skewed)',
      kind: 'estimate',
    },
    basic: {
      low: 2 * estimate - percentileHigh,
      high: 2 * estimate - percentileLow,
      level,
      of: 'the statistic',
      method: 'basic (reverse percentile) bootstrap interval',
      kind: 'estimate',
    },
    bca: {
      low: quantileSorted(sorted, a1),
      high: quantileSorted(sorted, a2),
      level,
      of: 'the statistic',
      method: `BCa interval (bias correction z₀ = ${z0.toPrecision(4)}, jackknife acceleration a = ${acceleration.toPrecision(4)}); second-order accurate and the one to prefer`,
      kind: 'estimate',
    },
    exactness: 'empirical',
    assumptions: [
      'Observations are independent and identically distributed, and the sample is large enough to stand in for the population — the bootstrap resamples the data, so it can only reproduce the information the sample contains.',
      'The statistic is a smooth function of the data. Non-smooth statistics such as a sample maximum are not bootstrappable this way.',
    ],
    limitations: [
      'These are confidence intervals for the parameter, estimated from resampling. They are not percentiles of the data and not a predictive range for a new observation.',
      `All three intervals carry resampling error from using ${resamples} replicates with seed "${seed}"; a different seed gives slightly different endpoints.`,
      'With a very small sample the bootstrap distribution is discrete and all three intervals undercover; no amount of resampling fixes that.',
      ...warnings,
    ],
    notes: [
      `n = ${n}, ${resamples} resamples. Estimate ${estimate.toPrecision(6)}, bootstrap SE ${standardError.toPrecision(6)}, bias ${(bootMean - estimate).toPrecision(4)}.`,
      `BCa adjusted percentiles: ${(a1 * 100).toPrecision(4)}% and ${(a2 * 100).toPrecision(4)}% (against ${((alpha / 2) * 100).toPrecision(3)}% and ${((1 - alpha / 2) * 100).toPrecision(4)}% for the plain percentile interval).`,
    ],
  };
}

/** Drain the bootstrap generator. */
export function bootstrapInterval(
  data: ArrayLike<number>,
  statistic: (xs: number[]) => number,
  options: BootstrapOptions = {},
): BootstrapResult {
  const steps = bootstrapIntervalSteps(data, statistic, options);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}
