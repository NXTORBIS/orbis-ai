/**
 * Maximum-likelihood fitting of the two extreme value models.
 *
 *  - Block maxima → GEV. The series is cut into blocks of equal length, the
 *    maximum of each block is taken, and a GEV is fitted to those maxima.
 *  - Peaks over threshold → GPD. Values above a threshold u are taken and a
 *    GPD is fitted to the exceedances.
 *
 * Both fits are by Nelder–Mead on the negative log-likelihood (see
 * `optimize.ts`). Standard errors come from the observed information matrix
 * (numerical Hessian) and the shape parameter also gets a profile-likelihood
 * interval, which is markedly more reliable than the symmetric Wald interval
 * because the likelihood in ξ is skewed.
 *
 * Refusals: if there are too few maxima/exceedances to identify the model, or
 * if the optimiser does not converge, these functions return a failed
 * `EngineResult` stating what happened. The final iterate is never returned as
 * though it were a fit.
 */
import {
  type EngineResult,
  type Explanation,
  fail,
  ok,
  Validator,
} from '../core/result';
import { mean, variance } from '../stats/descriptive';
import type { Matrix } from '../stats/linalg';
import { nelderMead } from './optimize';
import {
  constrainedMinimum,
  gevNegLogLik,
  gpdNegLogLik,
  observedInformationErrors,
  profileLikelihoodInterval,
  type ProfileInterval,
} from './likelihood';
import { EULER_MASCHERONI, type GevParams } from './gev';
import type { GpdParams } from './gpd';

/** Fewest block maxima worth fitting a three-parameter GEV to. */
export const MIN_BLOCK_MAXIMA = 10;
/** Below this many maxima the fit is reported but flagged as weakly identified. */
export const RECOMMENDED_BLOCK_MAXIMA = 25;
/** Fewest exceedances worth fitting a two-parameter GPD to. */
export const MIN_EXCEEDANCES = 10;
export const RECOMMENDED_EXCEEDANCES = 50;

export interface FitDiagnostics {
  /** Observations actually entering the likelihood. */
  observationsUsed: number;
  /** Observations supplied but not used, and why. */
  observationsDiscarded: number;
  discardReason: string;
  converged: boolean;
  iterations: number;
  functionEvaluations: number;
  logLikelihood: number;
  optimiser: 'Nelder–Mead simplex on the negative log-likelihood';
}

export interface ParameterEstimate {
  name: string;
  estimate: number;
  /** Standard error from the observed information, or null when unavailable. */
  standardError: number | null;
}

export interface GevFit {
  kind: 'gev';
  params: GevParams;
  estimates: ParameterEstimate[];
  covariance: Matrix | null;
  /** Profile-likelihood interval for ξ. */
  shapeInterval: ProfileInterval;
  /** Wald interval for ξ, for comparison; null when standard errors failed. */
  shapeWaldInterval: { lower: number; upper: number } | null;
  /** The maxima the fit used. */
  maxima: number[];
  blockSize: number | null;
  diagnostics: FitDiagnostics;
  explanation: Explanation;
}

export interface GpdFit {
  kind: 'gpd';
  params: GpdParams;
  estimates: ParameterEstimate[];
  covariance: Matrix | null;
  shapeInterval: ProfileInterval;
  shapeWaldInterval: { lower: number; upper: number } | null;
  /** Values above the threshold, sorted ascending. */
  exceedances: number[];
  /** Number of observations in the whole series. */
  totalObservations: number;
  /** Estimated P(X > u) = N_u / n. */
  exceedanceRate: number;
  /** Standard error of the exceedance rate, from the binomial variance. */
  exceedanceRateStandardError: number;
  diagnostics: FitDiagnostics;
  explanation: Explanation;
}

function finiteValues(data: ArrayLike<number>): { values: number[]; discarded: number } {
  const values: number[] = [];
  let discarded = 0;
  for (let i = 0; i < data.length; i++) {
    if (Number.isFinite(data[i])) values.push(data[i]);
    else discarded++;
  }
  return { values, discarded };
}

export interface BlockMaximaResult {
  maxima: number[];
  blockSize: number;
  blocksUsed: number;
  /** Observations dropped: the trailing partial block and any non-finite values. */
  observationsDiscarded: number;
  discardReason: string;
}

/**
 * Split a series into consecutive blocks of `blockSize` and take each maximum.
 * A trailing partial block is dropped rather than used, because the maximum of
 * a shorter block does not have the same distribution.
 */
export function blockMaxima(data: ArrayLike<number>, blockSize: number): EngineResult<BlockMaximaResult> {
  const v = new Validator();
  v.integer(blockSize, 'blockSize', 'Block size', 2);
  if (data.length === 0) v.add('No data was supplied.', 'data', 'required');
  if (!v.valid) return fail(v.issues);
  const { values, discarded: nonFinite } = finiteValues(data);
  const blocksUsed = Math.floor(values.length / blockSize);
  if (blocksUsed < 1) {
    return fail(
      `A block size of ${blockSize} leaves no complete block: there are only ${values.length} usable observations.`,
    );
  }
  const maxima: number[] = [];
  for (let b = 0; b < blocksUsed; b++) {
    let m = -Infinity;
    for (let i = b * blockSize; i < (b + 1) * blockSize; i++) if (values[i] > m) m = values[i];
    maxima.push(m);
  }
  const partial = values.length - blocksUsed * blockSize;
  const reasons: string[] = [];
  if (nonFinite > 0) reasons.push(`${nonFinite} non-finite value(s)`);
  if (partial > 0) reasons.push(`${partial} observation(s) in a trailing incomplete block`);
  return ok({
    maxima,
    blockSize,
    blocksUsed,
    observationsDiscarded: nonFinite + partial,
    discardReason: reasons.length ? `Discarded ${reasons.join(' and ')}.` : 'Nothing was discarded.',
  });
}

function gevStartingPoint(maxima: number[]): GevParams {
  // Moment matching against the Gumbel case: Var = σ²π²/6, E = μ + σγ.
  const m = mean(maxima);
  const s2 = variance(maxima, 1);
  const sigma = s2 > 0 ? (Math.sqrt(s2) * Math.sqrt(6)) / Math.PI : Math.max(Math.abs(m) * 0.1, 1e-3);
  return { location: m - EULER_MASCHERONI * sigma, scale: sigma, shape: 0.1 };
}

/** Fit a GEV to data that are already block maxima (or any sample of maxima). */
export function fitGev(
  maxima: ArrayLike<number>,
  options: { level?: number; blockSize?: number | null } = {},
): EngineResult<GevFit> {
  const level = options.level ?? 0.95;
  const { values, discarded } = finiteValues(maxima);
  if (values.length < MIN_BLOCK_MAXIMA) {
    return fail(
      `Too few block maxima to fit a GEV: ${values.length} available, at least ${MIN_BLOCK_MAXIMA} are needed and ${RECOMMENDED_BLOCK_MAXIMA} or more are advisable for a three-parameter fit. Use a smaller block size or a longer record.`,
    );
  }
  if (values.every((x) => x === values[0])) {
    return fail('All block maxima are identical, so the scale parameter is not identified. A GEV cannot be fitted.');
  }

  const natural = (x: number[]): number =>
    gevNegLogLik(values, { location: x[0], scale: x[1], shape: x[2] });
  const transformed = (x: number[]): number =>
    gevNegLogLik(values, { location: x[0], scale: Math.exp(x[1]), shape: x[2] });

  const start = gevStartingPoint(values);
  const run = nelderMead(transformed, [start.location, Math.log(start.scale), start.shape], {
    step: [Math.max(start.scale * 0.5, 1e-3), 0.3, 0.2],
    maxIterations: 4000,
    restarts: 1,
  });
  if (!run.converged) {
    return fail(
      `The GEV maximum-likelihood fit did not converge (${run.reason}, ${run.iterations} iterations, ${run.evaluations} evaluations). No parameter estimates are reported; the last iterate is not a fit.`,
    );
  }
  const params: GevParams = { location: run.x[0], scale: Math.exp(run.x[1]), shape: run.x[2] };
  const nllAt = gevNegLogLik(values, params);
  if (!Number.isFinite(nllAt)) {
    return fail('The GEV log-likelihood is not finite at the optimum, so the fit is rejected.');
  }

  const errors = observedInformationErrors(natural, [params.location, params.scale, params.shape]);
  const names = ['location (μ)', 'scale (σ)', 'shape (ξ)'];
  const estimateValues = [params.location, params.scale, params.shape];
  const estimates: ParameterEstimate[] = names.map((name, i) => ({
    name,
    estimate: estimateValues[i],
    standardError: errors ? errors.standardErrors[i] : null,
  }));

  const shapeInterval = profileLikelihoodInterval(
    (xi) => {
      const fixed = (x: number[]): number =>
        gevNegLogLik(values, { location: x[0], scale: Math.exp(x[1]), shape: xi });
      const m = constrainedMinimum(fixed, [params.location, Math.log(params.scale)], [
        Math.max(params.scale * 0.2, 1e-3),
        0.1,
      ]);
      return m === null ? null : m.fx;
    },
    params.shape,
    nllAt,
    { level, initialStep: Math.max(errors ? errors.standardErrors[2] : 0.1, 0.02) },
  );

  const warnings: string[] = [];
  if (values.length < RECOMMENDED_BLOCK_MAXIMA) {
    warnings.push(
      `Only ${values.length} block maxima were used. The shape parameter is weakly identified with so few maxima; treat its interval, not its point estimate, as the answer.`,
    );
  }
  if (!errors) {
    warnings.push(
      'The observed information matrix could not be inverted, so no standard errors are reported. This normally means the optimum sits against the support boundary. The profile-likelihood interval for ξ is still valid.',
    );
  }
  if (params.shape > 0.5) {
    warnings.push(
      `The fitted shape ξ = ${params.shape.toFixed(3)} exceeds 1/2, so the fitted distribution has infinite variance.`,
    );
  }

  const se = errors ? errors.standardErrors[2] : null;
  const explanation: Explanation = {
    method: 'GEV fitted to block maxima by maximum likelihood (Nelder–Mead simplex)',
    formula: 'F(x) = exp(−(1 + ξ(x−μ)/σ)^(−1/ξ)), with the Gumbel limit exp(−exp(−(x−μ)/σ)) at ξ = 0',
    steps: [
      { label: 'Maxima used', value: String(values.length) },
      { label: 'Negative log-likelihood at the optimum', value: nllAt.toPrecision(8) },
      { label: 'Simplex iterations', value: String(run.iterations) },
      {
        label: 'Shape ξ',
        value: se === null ? params.shape.toPrecision(6) : `${params.shape.toPrecision(6)} (s.e. ${se.toPrecision(3)})`,
      },
    ],
    assumptions: [
      'Block maxima are independent and identically distributed.',
      'The blocks are long enough for the extreme value limit to be a good approximation — this is an assumption, not a result of the fit.',
    ],
    limitations: [
      'Block maxima discard every large value other than each block maximum, so the fit uses only a fraction of the record.',
      'Standard errors are asymptotic. With few maxima the profile-likelihood interval for ξ is the more trustworthy statement.',
      ...warnings,
    ],
    exactness: 'numerical',
  };

  return ok(
    {
      kind: 'gev',
      params,
      estimates,
      covariance: errors ? errors.covariance : null,
      shapeInterval,
      shapeWaldInterval:
        errors === null
          ? null
          : {
              lower: params.shape - 1.959963984540054 * errors.standardErrors[2],
              upper: params.shape + 1.959963984540054 * errors.standardErrors[2],
            },
      maxima: values.slice(),
      blockSize: options.blockSize ?? null,
      diagnostics: {
        observationsUsed: values.length,
        observationsDiscarded: discarded,
        discardReason: discarded ? `${discarded} non-finite value(s) were dropped.` : 'Nothing was discarded.',
        converged: true,
        iterations: run.iterations,
        functionEvaluations: run.evaluations,
        logLikelihood: -nllAt,
        optimiser: 'Nelder–Mead simplex on the negative log-likelihood',
      },
      explanation,
    },
    warnings,
  );
}

/** Convenience: block a raw series and fit the GEV to its maxima in one step. */
export function fitGevBlockMaxima(
  data: ArrayLike<number>,
  options: { blockSize: number; level?: number },
): EngineResult<GevFit> {
  const blocks = blockMaxima(data, options.blockSize);
  if (!blocks.ok) return blocks;
  const fit = fitGev(blocks.value.maxima, { level: options.level, blockSize: options.blockSize });
  if (!fit.ok) return fit;
  const value = fit.value;
  value.diagnostics.observationsDiscarded = blocks.value.observationsDiscarded;
  value.diagnostics.discardReason = blocks.value.discardReason;
  value.explanation.steps.unshift({
    label: 'Blocking',
    value: `${blocks.value.blocksUsed} blocks of ${options.blockSize} observations`,
  });
  value.explanation.limitations.push(
    `The block size (${options.blockSize}) is a modelling choice. A larger block makes the GEV limit a better approximation but leaves fewer maxima to fit; the answer changes with it.`,
  );
  return ok(value, fit.warnings);
}

function gpdStartingPoint(excesses: number[]): { scale: number; shape: number } {
  // Method of moments (Hosking & Wallis 1987): ξ = (1 − m²/s²)/2, σ = m(1 + m²/s²)/2.
  const m = mean(excesses);
  const s2 = variance(excesses, 1);
  if (!(s2 > 0) || !(m > 0)) return { scale: Math.max(m, 1e-6), shape: 0.1 };
  const ratio = (m * m) / s2;
  const shape = (1 - ratio) / 2;
  const scale = (m * (1 + ratio)) / 2;
  return {
    scale: scale > 0 ? scale : m,
    shape: Math.min(Math.max(shape, -0.45), 0.9),
  };
}

export interface PotOptions {
  threshold: number;
  level?: number;
  /** Total number of observations in the series, if the series itself is not passed. */
  totalObservations?: number;
}

/**
 * Fit a GPD to the exceedances of `data` over `options.threshold` by maximum
 * likelihood (peaks over threshold).
 */
export function fitGpdPot(data: ArrayLike<number>, options: PotOptions): EngineResult<GpdFit> {
  const v = new Validator();
  v.finite(options.threshold, 'threshold', 'Threshold u');
  if (!v.valid) return fail(v.issues);
  const level = options.level ?? 0.95;
  const u = options.threshold;
  const { values, discarded } = finiteValues(data);
  const total = options.totalObservations ?? values.length;
  if (total <= 0) return fail('No observations were supplied, so no threshold model can be fitted.');
  const exceedances = values.filter((x) => x > u).sort((a, b) => a - b);
  const excesses = exceedances.map((x) => x - u);

  if (exceedances.length < MIN_EXCEEDANCES) {
    return fail(
      `Too few exceedances above the threshold ${u} to fit a GPD: ${exceedances.length} of ${total} observations exceed it. At least ${MIN_EXCEEDANCES} are needed and about ${RECOMMENDED_EXCEEDANCES} are advisable. Lower the threshold or collect a longer record.`,
    );
  }
  if (excesses.every((y) => y === excesses[0])) {
    return fail('All exceedances are identical, so the GPD scale is not identified.');
  }

  const natural = (x: number[]): number => gpdNegLogLik(exceedances, { scale: x[0], shape: x[1], threshold: u });
  const transformed = (x: number[]): number =>
    gpdNegLogLik(exceedances, { scale: Math.exp(x[0]), shape: x[1], threshold: u });

  const start = gpdStartingPoint(excesses);
  const run = nelderMead(transformed, [Math.log(start.scale), start.shape], {
    step: [0.3, 0.2],
    maxIterations: 4000,
    restarts: 1,
  });
  if (!run.converged) {
    return fail(
      `The GPD maximum-likelihood fit did not converge (${run.reason}, ${run.iterations} iterations, ${run.evaluations} evaluations). No parameter estimates are reported.`,
    );
  }
  const params: GpdParams = { scale: Math.exp(run.x[0]), shape: run.x[1], threshold: u };
  const nllAt = gpdNegLogLik(exceedances, params);
  if (!Number.isFinite(nllAt)) {
    return fail('The GPD log-likelihood is not finite at the optimum, so the fit is rejected.');
  }

  const errors = observedInformationErrors(natural, [params.scale, params.shape]);
  const estimates: ParameterEstimate[] = [
    { name: 'scale (σ)', estimate: params.scale, standardError: errors ? errors.standardErrors[0] : null },
    { name: 'shape (ξ)', estimate: params.shape, standardError: errors ? errors.standardErrors[1] : null },
  ];

  const shapeInterval = profileLikelihoodInterval(
    (xi) => {
      const fixed = (x: number[]): number =>
        gpdNegLogLik(exceedances, { scale: Math.exp(x[0]), shape: xi, threshold: u });
      const m = constrainedMinimum(fixed, [Math.log(params.scale)], [0.15]);
      return m === null ? null : m.fx;
    },
    params.shape,
    nllAt,
    { level, initialStep: Math.max(errors ? errors.standardErrors[1] : 0.1, 0.02) },
  );

  const rate = exceedances.length / total;
  const rateSe = Math.sqrt((rate * (1 - rate)) / total);

  const warnings: string[] = [];
  if (exceedances.length < RECOMMENDED_EXCEEDANCES) {
    warnings.push(
      `Only ${exceedances.length} exceedances were used. Estimates of ξ, and any return level extrapolated with them, are correspondingly uncertain.`,
    );
  }
  if (!errors) {
    warnings.push(
      'The observed information matrix could not be inverted, so no standard errors are reported; the profile-likelihood interval for ξ is still valid.',
    );
  }
  if (params.shape >= 1) {
    warnings.push(
      `The fitted shape ξ = ${params.shape.toFixed(3)} is at or above 1: the fitted exceedance distribution has an infinite mean, so no expected shortfall exists.`,
    );
  }

  const explanation: Explanation = {
    method: 'Generalised Pareto distribution fitted to threshold exceedances by maximum likelihood (peaks over threshold)',
    formula: 'P(X > u + y | X > u) = (1 + ξy/σ)^(−1/ξ), with the exponential limit exp(−y/σ) at ξ = 0',
    steps: [
      { label: 'Threshold u', value: String(u) },
      { label: 'Exceedances used', value: `${exceedances.length} of ${total} observations` },
      { label: 'Exceedance rate ζ = N_u/n', value: `${rate.toPrecision(5)} (s.e. ${rateSe.toPrecision(3)})` },
      { label: 'Negative log-likelihood at the optimum', value: nllAt.toPrecision(8) },
      { label: 'Simplex iterations', value: String(run.iterations) },
    ],
    assumptions: [
      'Exceedances are independent. Clustered extremes break this; decluster first and refit if the series is dependent.',
      'The threshold is high enough for the generalised Pareto limit to hold.',
    ],
    limitations: [
      `The threshold u = ${u} is a judgement call, not an estimate. It materially changes σ, ξ and every return level computed from them: too low and the limit model is biased, too high and there is nothing left to fit. Compare the mean residual life and parameter-stability plots before accepting this fit.`,
      'Standard errors are asymptotic and condition on the chosen threshold; they do not include the uncertainty in choosing it.',
      ...warnings,
    ],
    exactness: 'numerical',
  };

  return ok(
    {
      kind: 'gpd',
      params,
      estimates,
      covariance: errors ? errors.covariance : null,
      shapeInterval,
      shapeWaldInterval:
        errors === null
          ? null
          : {
              lower: params.shape - 1.959963984540054 * errors.standardErrors[1],
              upper: params.shape + 1.959963984540054 * errors.standardErrors[1],
            },
      exceedances,
      totalObservations: total,
      exceedanceRate: rate,
      exceedanceRateStandardError: rateSe,
      diagnostics: {
        observationsUsed: exceedances.length,
        observationsDiscarded: total - exceedances.length + discarded,
        discardReason: `${total - exceedances.length} observation(s) at or below the threshold were not used by the likelihood${discarded ? `, and ${discarded} non-finite value(s) were dropped` : ''}.`,
        converged: true,
        iterations: run.iterations,
        functionEvaluations: run.evaluations,
        logLikelihood: -nllAt,
        optimiser: 'Nelder–Mead simplex on the negative log-likelihood',
      },
      explanation,
    },
    warnings,
  );
}
