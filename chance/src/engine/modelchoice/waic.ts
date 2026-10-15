/**
 * WAIC and PSIS-LOO from pointwise log-likelihood draws.
 *
 * Both estimate the expected log pointwise predictive density (elpd) for new
 * data from the same process. Both are estimates, with Monte Carlo error AND
 * sampling error over observations, so both carry a standard error. A WAIC or
 * LOO comparison quoted without the standard error of the DIFFERENCE is the
 * commonest misuse of these criteria, because the difference between two
 * serious models is usually inside the noise.
 */
import { logSumExp } from '../core/numeric';
import { EngineError } from '../core/result';
import type { ElpdEstimate } from './types';
import { MODEL_SET_CAVEAT } from './types';
import { checkLogLikMatrix, columnVariance, MIN_DRAWS } from './validate';
import { fitGeneralisedPareto, type ParetoFit } from './pareto';

/** Pareto k bands, after Vehtari, Gelman & Gabry. */
export const K_GOOD = 0.5;
export const K_BAD = 0.7;
export const K_VERY_BAD = 1;

/** log of the mean of exp(xs) — the log pointwise predictive density term. */
function logMeanExp(xs: readonly number[]): number {
  return logSumExp(xs) - Math.log(xs.length);
}

function elpdStandardError(pointwise: readonly number[]): number {
  const n = pointwise.length;
  if (n < 2) return NaN;
  let m = 0;
  for (const p of pointwise) m += p / n;
  let v = 0;
  for (const p of pointwise) v += (p - m) * (p - m);
  return Math.sqrt((n * v) / (n - 1));
}

/**
 * WAIC: elpd_waic = Σ_i [ log mean_s p(y_i|θ_s) − var_s log p(y_i|θ_s) ].
 *
 * The penalty term is the posterior variance of the pointwise log-likelihood,
 * summed; it is the effective number of parameters. A large per-observation
 * penalty (above about 0.4) means that observation's log-likelihood varies so
 * much over the posterior that the correction itself is unreliable, which is
 * reported rather than absorbed.
 */
export function waic(name: string, logLik: readonly (readonly number[])[], minDraws = MIN_DRAWS): ElpdEstimate {
  const shape = checkLogLikMatrix(logLik, `Model "${name}"`, minDraws);
  const n = shape.observations;
  const pointwise: number[] = [];
  const penalties: number[] = [];
  const column = new Array<number>(shape.draws);
  for (let i = 0; i < n; i++) {
    for (let s = 0; s < shape.draws; s++) column[s] = logLik[s][i];
    const lpd = logMeanExp(column);
    const pen = columnVariance(logLik, i);
    penalties.push(pen);
    pointwise.push(lpd - pen);
  }
  const elpd = pointwise.reduce((a, b) => a + b, 0);
  const pWaic = penalties.reduce((a, b) => a + b, 0);
  const warnings = [
    'WAIC is an estimate with two sources of error: Monte Carlo error over posterior draws and sampling error over observations. The standard error reported covers only the second.',
    'Compare WAIC between models using the standard error of the paired DIFFERENCE, never by ranking the point estimates. Differences smaller than about twice that standard error are not differences.',
    MODEL_SET_CAVEAT,
  ];
  const highPenalty = penalties.map((p, i) => ({ p, i })).filter((e) => e.p > 0.4);
  if (highPenalty.length) {
    warnings.push(
      `The WAIC penalty exceeds 0.4 for ${highPenalty.length} observation(s) (indices ${highPenalty
        .slice(0, 10)
        .map((e) => e.i)
        .join(', ')}${highPenalty.length > 10 ? ', …' : ''}). For those observations the bias correction is itself unreliable; prefer PSIS-LOO, which reports a per-observation diagnostic.`,
    );
  }
  return {
    name,
    method: 'waic',
    elpd,
    standardError: elpdStandardError(pointwise),
    pointwise,
    effectiveParameters: pWaic,
    informationCriterion: -2 * elpd,
    exactness: 'empirical',
    warnings,
  };
}

export interface PsisDiagnostics {
  /** Pareto shape k for each observation. */
  readonly paretoK: readonly number[];
  /** Counts in the bands k <= 0.5, 0.5 < k <= 0.7, 0.7 < k <= 1, k > 1. */
  readonly bands: { readonly good: number; readonly ok: number; readonly bad: number; readonly veryBad: number };
  /** Observations with k > 0.7, named individually. */
  readonly unreliableObservations: readonly { readonly index: number; readonly k: number }[];
  /** Tail length used for the generalised Pareto fit. */
  readonly tailLength: number;
  /** Per-observation relative effective sample size of the importance weights. */
  readonly relativeEffectiveSampleSize: readonly number[];
}

export interface PsisLooResult extends ElpdEstimate {
  readonly method: 'psis-loo';
  readonly diagnostics: PsisDiagnostics;
  /** True when no observation exceeds k = 0.7. */
  readonly reliable: boolean;
}

/**
 * Pareto-smoothed importance-sampling leave-one-out cross-validation.
 *
 * The leave-one-out predictive density is estimated from the full posterior by
 * importance sampling with weights proportional to 1/p(y_i|θ_s). Those weights
 * have heavy tails, so the largest are replaced by the quantiles of a
 * generalised Pareto distribution fitted to them. The fitted shape k IS the
 * diagnostic: for k > 0.7 the importance-sampling variance is effectively
 * infinite and the estimate for that observation cannot be believed.
 *
 * Offending observations are listed by index. They are never quietly averaged
 * into the total: `reliable` is false and the warnings name them.
 */
export function psisLoo(
  name: string,
  logLik: readonly (readonly number[])[],
  minDraws = MIN_DRAWS,
): PsisLooResult {
  const shape = checkLogLikMatrix(logLik, `Model "${name}"`, minDraws);
  const s = shape.draws;
  const n = shape.observations;
  const tail = Math.min(Math.floor(s / 5), Math.floor(3 * Math.sqrt(s)));
  if (tail < 5) {
    throw new EngineError(
      `PSIS-LOO for "${name}" needs enough draws to fit a tail: with ${s} draws the tail would be ${tail} points, below the 5 needed for a generalised Pareto fit. Draw more posterior samples.`,
      'insufficient',
    );
  }
  const pointwise: number[] = [];
  const paretoK: number[] = [];
  const reff: number[] = [];
  const lpdTerms: number[] = [];
  const column = new Array<number>(s);
  for (let i = 0; i < n; i++) {
    for (let d = 0; d < s; d++) column[d] = logLik[d][i];
    lpdTerms.push(logMeanExp(column));
    const smoothed = smoothLogWeights(column.map((x) => -x), tail);
    paretoK.push(smoothed.k);
    // elpd_loo,i = log( Σ_s w_s p(y_i|θ_s) / Σ_s w_s ), entirely in log space.
    const num = new Array<number>(s);
    for (let d = 0; d < s; d++) num[d] = smoothed.logWeights[d] + column[d];
    pointwise.push(logSumExp(num) - logSumExp(smoothed.logWeights));
    reff.push(relativeEffectiveSampleSize(smoothed.logWeights));
  }
  const elpd = pointwise.reduce((a, b) => a + b, 0);
  const lpd = lpdTerms.reduce((a, b) => a + b, 0);
  const unreliable = paretoK
    .map((k, index) => ({ index, k }))
    .filter((e) => e.k > K_BAD)
    .sort((a, b) => b.k - a.k);
  const bands = {
    good: paretoK.filter((k) => k <= K_GOOD).length,
    ok: paretoK.filter((k) => k > K_GOOD && k <= K_BAD).length,
    bad: paretoK.filter((k) => k > K_BAD && k <= K_VERY_BAD).length,
    veryBad: paretoK.filter((k) => k > K_VERY_BAD).length,
  };
  const warnings = [
    `Pareto k bands: ${bands.good} observation(s) with k ≤ 0.5 (reliable), ${bands.ok} with 0.5 < k ≤ 0.7 (usable), ${bands.bad} with 0.7 < k ≤ 1 (unreliable), ${bands.veryBad} with k > 1 (the importance-sampling estimate has no finite variance or mean).`,
    'PSIS-LOO is an estimate. Compare models by the standard error of the paired difference, not by the ranking.',
    MODEL_SET_CAVEAT,
  ];
  if (unreliable.length) {
    warnings.push(
      `The importance-sampling approximation FAILED for ${unreliable.length} observation(s): ${unreliable
        .slice(0, 12)
        .map((e) => `index ${e.index} (k = ${e.k.toFixed(2)})`)
        .join(', ')}${unreliable.length > 12 ? ', …' : ''}. Each of those observations is influential enough that the full posterior is a poor proposal for the leave-one-out posterior. The total elpd below includes their terms, and it should not be trusted: refit without those observations (exact leave-one-out, or k-fold) before comparing models.`,
    );
  }
  const lowReff = reff.map((r, i) => ({ r, i })).filter((e) => e.r < 0.1);
  if (lowReff.length) {
    warnings.push(
      `The importance weights are dominated by a few draws for ${lowReff.length} observation(s) (relative effective sample size below 0.1, e.g. index ${lowReff[0].i}). Monte Carlo error is large for those terms.`,
    );
  }
  return {
    name,
    method: 'psis-loo',
    elpd,
    standardError: elpdStandardError(pointwise),
    pointwise,
    effectiveParameters: lpd - elpd,
    informationCriterion: -2 * elpd,
    exactness: 'empirical',
    warnings,
    reliable: unreliable.length === 0,
    diagnostics: {
      paretoK,
      bands,
      unreliableObservations: unreliable,
      tailLength: tail,
      relativeEffectiveSampleSize: reff,
    },
  };
}

/** Relative effective sample size of normalised importance weights, 1/(n Σ w̄²). */
function relativeEffectiveSampleSize(logWeights: readonly number[]): number {
  const norm = logSumExp(logWeights);
  let sumSq = 0;
  for (const lw of logWeights) {
    const w = Math.exp(lw - norm);
    sumSq += w * w;
  }
  return sumSq > 0 ? 1 / (logWeights.length * sumSq) : 0;
}

export interface SmoothedWeights {
  readonly logWeights: readonly number[];
  readonly k: number;
  readonly fit: ParetoFit | null;
}

/**
 * Pareto-smooth a set of raw log importance weights (Vehtari et al. 2024).
 *
 * The `tail` largest weights are replaced by the expected order statistics of
 * a generalised Pareto distribution fitted to their exceedances over the
 * (tail+1)-th largest weight; all weights are then truncated at the largest
 * raw weight. Everything is done on the log scale apart from the Pareto fit
 * itself, which needs the exceedances on the natural scale — they are shifted
 * by the maximum first, so exp() is applied only to values ≤ 0.
 */
export function smoothLogWeights(rawLogWeights: readonly number[], tail: number): SmoothedWeights {
  const s = rawLogWeights.length;
  if (tail < 5 || tail >= s) {
    throw new EngineError(
      `Pareto smoothing needs 5 <= tail < number of draws; got tail = ${tail} with ${s} draws.`,
      'range',
    );
  }
  const max = Math.max(...rawLogWeights);
  if (!Number.isFinite(max)) {
    throw new EngineError('The raw importance weights are not finite, so they cannot be smoothed.', 'nonfinite');
  }
  const shifted = rawLogWeights.map((x) => x - max);
  const order = shifted.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const cutoffIndex = s - tail - 1;
  const cutoffLog = order[cutoffIndex].v;
  const exceedances: number[] = [];
  for (let j = cutoffIndex + 1; j < s; j++) exceedances.push(Math.exp(order[j].v) - Math.exp(cutoffLog));
  if (exceedances.every((e) => e <= 0)) {
    // All tail weights equal: there is nothing heavy-tailed to smooth, and the
    // estimate is as good as it gets. k = −Infinity is the degenerate fit, so
    // report k = 0 and leave the weights alone.
    return { logWeights: shifted.map((v) => Math.min(v, 0)), k: 0, fit: null };
  }
  const fit = fitGeneralisedPareto(exceedances);
  const out = shifted.slice();
  const cutoff = Math.exp(cutoffLog);
  for (let j = 0; j < tail; j++) {
    const p = (j + 0.5) / tail;
    const q = paretoQuantile(p, fit.k, fit.sigma) + cutoff;
    const idx = order[cutoffIndex + 1 + j].i;
    out[idx] = Math.min(Math.log(q), 0); // truncate at the largest raw weight (= 0 after shifting)
  }
  return { logWeights: out, k: fit.k, fit };
}

/** Quantile of the generalised Pareto distribution with shape k and scale sigma. */
function paretoQuantile(p: number, k: number, sigma: number): number {
  if (Math.abs(k) < 1e-10) return -sigma * Math.log1p(-p);
  return (sigma * (Math.pow(1 - p, -k) - 1)) / k;
}
