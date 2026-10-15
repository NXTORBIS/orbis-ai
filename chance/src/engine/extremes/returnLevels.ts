/**
 * Return levels, return periods and extreme-tail risk measures.
 *
 * The return level is the headline answer to "how bad can it get?": the level
 * exceeded on average once in m observations (or once in T years). Unlike a
 * Monte Carlo percentile it can be extrapolated past the largest value
 * observed, because the extreme value limit supplies the shape of the tail —
 * at the price of trusting that limit, which is why every number here carries
 * an interval and a limitation.
 *
 * GPD (peaks over threshold), with ζ = P(X > u) estimated by N_u/n:
 *   x_m = u + (σ/ξ)((mζ)^ξ − 1),       ξ ≠ 0
 *   x_m = u + σ·ln(mζ),                ξ = 0
 *
 * GEV (block maxima), for a return period of T blocks:
 *   z_T = F^{-1}(1 − 1/T)
 *
 * Intervals are given two ways. The delta method propagates the asymptotic
 * covariance of the estimates through a numerical gradient; it is symmetric
 * and understates the upper limit for heavy tails. The profile-likelihood
 * interval reparameterises the model in terms of the return level itself and
 * is asymmetric; it is the one to quote.
 */
import { type EngineResult, type Explanation, fail, ok } from '../core/result';
import { numericalGradient } from './optimize';
import {
  constrainedMinimum,
  gevNegLogLik,
  gpdNegLogLik,
  profileLikelihoodInterval,
  type ProfileInterval,
} from './likelihood';
import { normalQuantile } from '../special/gamma';
import { gevQuantile, gevSf, type GevParams } from './gev';
import { gpdLogSf, type GpdParams } from './gpd';
import type { GevFit, GpdFit } from './fit';

export interface ReturnLevelResult {
  /** Return period expressed in observations (GPD) or blocks (GEV). */
  returnPeriod: number;
  /** The unit the return period is counted in. */
  periodUnit: 'observations' | 'blocks' | 'years';
  /** Return level: the level exceeded once per return period on average. */
  level: number;
  /** Delta-method standard error, or null when the covariance was unavailable. */
  standardError: number | null;
  /** Symmetric delta-method interval. */
  deltaInterval: { lower: number; upper: number } | null;
  /** Profile-likelihood interval, asymmetric; the preferred statement. */
  profileInterval: ProfileInterval;
  confidenceLevel: number;
  /** True when the return level is above the largest observed value, i.e. extrapolated. */
  extrapolatedBeyondData: boolean;
  explanation: Explanation;
}

const EXTRAPOLATION_LIMITATION =
  'A return level beyond the observed range is an extrapolation justified by the extreme value limit, not by data. Its interval reflects parameter uncertainty only: it does not include the possibility that the limit model, the threshold or the block size is wrong.';

function gpdLevelFrom(u: number, scale: number, shape: number, m: number, zeta: number): number {
  const mz = m * zeta;
  if (shape === 0) return u + scale * Math.log(mz);
  return u + (scale / shape) * Math.expm1(shape * Math.log(mz));
}

/**
 * m-observation return level from a POT (GPD) fit: the level exceeded once per
 * m observations of the original series.
 */
export function gpdReturnLevel(
  fit: GpdFit,
  m: number,
  options: {
    level?: number;
    periodUnit?: 'observations' | 'years';
    reportedPeriod?: number;
    /** Skip the profile-likelihood interval (it costs a constrained refit per evaluation). */
    skipProfile?: boolean;
  } = {},
): EngineResult<ReturnLevelResult> {
  if (!Number.isFinite(m) || m <= 0) return fail('The return period must be a finite number of observations above 0.');
  const level = options.level ?? 0.95;
  const { threshold: u, scale, shape } = fit.params;
  const zeta = fit.exceedanceRate;
  const n = fit.totalObservations;
  const mz = m * zeta;
  if (!(mz > 1)) {
    return fail(
      `A return period of ${m} observations is not above the threshold's own return period: with an exceedance rate of ${zeta.toPrecision(3)} the threshold itself is exceeded once per ${(1 / zeta).toPrecision(4)} observations. The threshold model says nothing below that, so no return level is reported. Ask for a longer return period or refit with a lower threshold.`,
    );
  }

  const value = gpdLevelFrom(u, scale, shape, m, zeta);
  if (!Number.isFinite(value)) return fail('The return level evaluated to a non-finite value; the fit is unusable.');

  // Delta method over (ζ, σ, ξ) with the binomial variance for ζ and the
  // observed-information covariance for (σ, ξ).
  let standardError: number | null = null;
  if (fit.covariance) {
    const g = numericalGradient((x) => gpdLevelFrom(u, x[1], x[2], m, x[0]), [zeta, scale, shape]);
    if (g !== null) {
      const varZeta = (zeta * (1 - zeta)) / n;
      const c = fit.covariance;
      const quadratic =
        g[0] * g[0] * varZeta +
        g[1] * g[1] * c[0][0] +
        g[2] * g[2] * c[1][1] +
        2 * g[1] * g[2] * c[0][1];
      if (quadratic > 0 && Number.isFinite(quadratic)) standardError = Math.sqrt(quadratic);
    }
  }
  const z = normalQuantile((1 + level) / 2);
  const deltaInterval =
    standardError === null ? null : { lower: value - z * standardError, upper: value + z * standardError };

  // Profile likelihood: reparameterise (σ, ξ) → (x_m, ξ) at fixed ζ.
  const profileInterval: ProfileInterval = options.skipProfile
    ? {
        lower: null,
        upper: null,
        level,
        curve: [],
        notes: ['The profile-likelihood interval was not computed for this point; the delta-method interval is reported.'],
      }
    : profileLikelihoodInterval(
    (xm) => {
      const objective = (x: number[]): number => {
        const xi = x[0];
        const logMz = Math.log(mz);
        const sigma = xi === 0 ? (xm - u) / logMz : (xi * (xm - u)) / Math.expm1(xi * logMz);
        if (!(sigma > 0) || !Number.isFinite(sigma)) return Infinity;
        return gpdNegLogLik(fit.exceedances, { scale: sigma, shape: xi, threshold: u });
      };
      const m2 = constrainedMinimum(objective, [shape], [0.1]);
      return m2 === null ? null : m2.fx;
    },
    value,
    -fit.diagnostics.logLikelihood,
        { level, initialStep: Math.max(standardError ?? Math.abs(value - u) * 0.2, 1e-6) },
      );

  const largestObserved = fit.exceedances[fit.exceedances.length - 1];
  const periodUnit = options.periodUnit ?? 'observations';
  const reportedPeriod = options.reportedPeriod ?? m;

  return ok({
    returnPeriod: reportedPeriod,
    periodUnit,
    level: value,
    standardError,
    deltaInterval,
    profileInterval,
    confidenceLevel: level,
    extrapolatedBeyondData: value > largestObserved,
    explanation: {
      method: 'Return level from a peaks-over-threshold GPD fit',
      formula: 'x_m = u + (σ/ξ)((mζ)^ξ − 1), with x_m = u + σ·ln(mζ) at ξ = 0 and ζ = P(X > u)',
      steps: [
        { label: 'Return period m', value: `${m} observations` },
        { label: 'Exceedance rate ζ', value: zeta.toPrecision(5) },
        { label: 'Expected exceedances in m observations, mζ', value: mz.toPrecision(5) },
        { label: 'Return level x_m', value: value.toPrecision(8) },
        {
          label: 'Delta-method standard error',
          value: standardError === null ? 'unavailable (covariance could not be formed)' : standardError.toPrecision(4),
        },
        {
          label: `Profile-likelihood ${(level * 100).toFixed(0)}% interval`,
          value:
            profileInterval.lower === null || profileInterval.upper === null
              ? 'one or both limits could not be bracketed'
              : `${profileInterval.lower.toPrecision(6)} to ${profileInterval.upper.toPrecision(6)}`,
        },
      ],
      assumptions: [
        'Exceedances are independent and generalised Pareto above the threshold.',
        'The exceedance rate ζ is constant over the period of extrapolation — no trend, no change in the process.',
      ],
      limitations: [
        value > largestObserved ? EXTRAPOLATION_LIMITATION : 'This return level lies inside the observed range.',
        `Everything here is conditional on the chosen threshold u = ${u}, which is a judgement call and materially changes the answer.`,
        'The delta-method interval is symmetric and typically too narrow on the upper side for a heavy tail; prefer the profile-likelihood interval.',
        'The profile interval holds ζ fixed at its estimate, so it omits the (smaller) uncertainty in the exceedance rate, which the delta-method interval does include.',
      ],
      exactness: 'numerical',
    },
  });
}

/** T-year return level from a POT fit, given how many observations make a year. */
export function gpdReturnLevelYears(
  fit: GpdFit,
  years: number,
  observationsPerYear: number,
  options: { level?: number } = {},
): EngineResult<ReturnLevelResult> {
  if (!Number.isFinite(years) || years <= 0) return fail('The return period in years must be above 0.');
  if (!Number.isFinite(observationsPerYear) || observationsPerYear <= 0) {
    return fail('The number of observations per year must be above 0.');
  }
  const result = gpdReturnLevel(fit, years * observationsPerYear, {
    ...options,
    periodUnit: 'years',
    reportedPeriod: years,
  });
  if (!result.ok) return result;
  result.value.explanation.steps.unshift({
    label: 'Return period',
    value: `${years} year(s) = ${years * observationsPerYear} observations at ${observationsPerYear} per year`,
  });
  result.value.explanation.assumptions.push(
    `The record is assumed to contain ${observationsPerYear} observations per year; a wrong rate rescales the return period directly.`,
  );
  return result;
}

/** Return level for a return period of T blocks from a GEV (block maxima) fit. */
export function gevReturnLevel(
  fit: GevFit,
  blocks: number,
  options: { level?: number; periodUnit?: 'blocks' | 'years'; reportedPeriod?: number } = {},
): EngineResult<ReturnLevelResult> {
  if (!Number.isFinite(blocks) || blocks <= 1) {
    return fail('The return period must be more than one block: a one-block return level is just the typical maximum.');
  }
  const level = options.level ?? 0.95;
  const p = 1 / blocks; // exceedance probability per block
  const params = fit.params;
  const levelValue = gevQuantile(1 - p, params);
  if (!Number.isFinite(levelValue)) {
    return fail(
      'The GEV return level is not finite. With the fitted shape the quantile is unbounded at this return period.',
    );
  }

  let standardError: number | null = null;
  if (fit.covariance) {
    const g = numericalGradient(
      (x) => gevQuantile(1 - p, { location: x[0], scale: x[1], shape: x[2] }),
      [params.location, params.scale, params.shape],
    );
    if (g !== null) {
      const c = fit.covariance;
      let quadratic = 0;
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) quadratic += g[i] * g[j] * c[i][j];
      if (quadratic > 0 && Number.isFinite(quadratic)) standardError = Math.sqrt(quadratic);
    }
  }
  const z = normalQuantile((1 + level) / 2);
  const deltaInterval =
    standardError === null ? null : { lower: levelValue - z * standardError, upper: levelValue + z * standardError };

  // Profile likelihood: reparameterise (μ, σ, ξ) → (z_p, σ, ξ) using
  // μ = z_p + (σ/ξ)(1 − y^(−ξ)), y = −ln(1 − p).
  const y = -Math.log(1 - p);
  const profileInterval = profileLikelihoodInterval(
    (zp) => {
      const objective = (x: number[]): number => {
        const sigma = Math.exp(x[0]);
        const xi = x[1];
        const mu = xi === 0 ? zp + sigma * Math.log(y) : zp + (sigma / xi) * (1 - Math.pow(y, -xi));
        if (!Number.isFinite(mu)) return Infinity;
        return gevNegLogLik(fit.maxima, { location: mu, scale: sigma, shape: xi });
      };
      const m = constrainedMinimum(objective, [Math.log(params.scale), params.shape], [0.15, 0.1]);
      return m === null ? null : m.fx;
    },
    levelValue,
    -fit.diagnostics.logLikelihood,
    { level, initialStep: Math.max(standardError ?? params.scale * 0.5, 1e-6) },
  );

  const largestObserved = Math.max(...fit.maxima);
  return ok({
    returnPeriod: options.reportedPeriod ?? blocks,
    periodUnit: options.periodUnit ?? 'blocks',
    level: levelValue,
    standardError,
    deltaInterval,
    profileInterval,
    confidenceLevel: level,
    extrapolatedBeyondData: levelValue > largestObserved,
    explanation: {
      method: 'Return level from a GEV fit to block maxima',
      formula: 'z_T = μ − (σ/ξ)(1 − (−ln(1 − 1/T))^(−ξ)), with z_T = μ − σ·ln(−ln(1 − 1/T)) at ξ = 0',
      steps: [
        { label: 'Return period T', value: `${blocks} blocks` },
        { label: 'Per-block exceedance probability 1/T', value: p.toPrecision(5) },
        { label: 'Return level z_T', value: levelValue.toPrecision(8) },
        {
          label: 'Delta-method standard error',
          value: standardError === null ? 'unavailable (covariance could not be formed)' : standardError.toPrecision(4),
        },
      ],
      assumptions: [
        'Block maxima are independent and GEV distributed.',
        'The process is stationary over the extrapolation period.',
      ],
      limitations: [
        levelValue > largestObserved ? EXTRAPOLATION_LIMITATION : 'This return level lies inside the observed range.',
        'The return period is counted in blocks. Converting it to years requires the block length, which is a modelling choice.',
        'The delta-method interval is symmetric; the profile-likelihood interval is asymmetric and is the better statement.',
      ],
      exactness: 'numerical',
    },
  });
}

export interface ReturnPeriodResult {
  /** The level asked about. */
  level: number;
  /** Probability that one observation (GPD) or one block maximum (GEV) exceeds it. */
  exceedanceProbability: number;
  /** Return period in observations (GPD) or blocks (GEV). */
  returnPeriod: number;
  periodUnit: 'observations' | 'blocks';
  /** Return period in years, when an observation rate was supplied. */
  returnPeriodYears: number | null;
  explanation: Explanation;
}

/** The inverse question: how often is a given level exceeded, under a POT fit? */
export function gpdReturnPeriod(
  fit: GpdFit,
  levelValue: number,
  options: { observationsPerYear?: number } = {},
): EngineResult<ReturnPeriodResult> {
  if (!Number.isFinite(levelValue)) return fail('The level must be a finite number.');
  if (levelValue <= fit.params.threshold) {
    return fail(
      `The level ${levelValue} is at or below the threshold ${fit.params.threshold}, where the threshold model does not apply. Its exceedance frequency should be read off the data directly, not from the GPD fit.`,
    );
  }
  const logSf = gpdLogSf(levelValue, fit.params);
  const probability = fit.exceedanceRate * Math.exp(logSf);
  if (probability === 0) {
    const upper = fit.params.threshold - fit.params.scale / fit.params.shape;
    return fail(
      `The fitted shape ξ = ${fit.params.shape.toPrecision(4)} is negative, which puts a hard upper bound of ${upper.toPrecision(6)} on the distribution. The level ${levelValue} is above that bound, so the fitted model gives it probability exactly 0 and no finite return period exists. Treat the bound itself as the claim being made, and check it against the parameter-stability plot.`,
    );
  }
  const periodObs = 1 / probability;
  const perYear = options.observationsPerYear;
  return ok({
    level: levelValue,
    exceedanceProbability: probability,
    returnPeriod: periodObs,
    periodUnit: 'observations',
    returnPeriodYears: perYear && perYear > 0 ? periodObs / perYear : null,
    explanation: {
      method: 'Return period of a level from a peaks-over-threshold GPD fit',
      formula: 'P(X > x) = ζ(1 + ξ(x − u)/σ)^(−1/ξ); return period = 1/P(X > x)',
      steps: [
        { label: 'Level', value: levelValue.toPrecision(8) },
        { label: 'Exceedance probability per observation', value: probability.toExponential(4) },
        { label: 'Return period', value: `${periodObs.toPrecision(6)} observations` },
      ],
      assumptions: ['Observations are independent and the exceedance rate is stable over time.'],
      limitations: [
        `Conditional on the threshold u = ${fit.params.threshold}, which is a judgement call and changes this number.`,
        'No interval is attached to this return period here; take the uncertainty from the return level at the matching period, where it is computed properly.',
      ],
      exactness: 'numerical',
    },
  });
}

/** How often does a block maximum exceed a level, under a GEV fit? */
export function gevReturnPeriod(fit: GevFit, levelValue: number): EngineResult<ReturnPeriodResult> {
  if (!Number.isFinite(levelValue)) return fail('The level must be a finite number.');
  const sf = gevSf(levelValue, fit.params);
  if (sf === 0) {
    const bound = fit.params.location - fit.params.scale / fit.params.shape;
    return fail(
      `The fitted GEV has shape ξ = ${fit.params.shape.toPrecision(4)} < 0 and therefore a hard upper bound of ${bound.toPrecision(6)}. The level ${levelValue} is above it, so the model assigns probability exactly 0 and no finite return period exists.`,
    );
  }
  return ok({
    level: levelValue,
    exceedanceProbability: sf,
    returnPeriod: 1 / sf,
    periodUnit: 'blocks',
    returnPeriodYears: null,
    explanation: {
      method: 'Return period of a level from a GEV fit to block maxima',
      formula: 'T = 1/(1 − F(x))',
      steps: [
        { label: 'Level', value: levelValue.toPrecision(8) },
        { label: 'Probability a block maximum exceeds it', value: sf.toExponential(4) },
        { label: 'Return period', value: `${(1 / sf).toPrecision(6)} blocks` },
      ],
      assumptions: ['Block maxima are independent and GEV distributed.'],
      limitations: ['Counted in blocks; converting to years needs the block length.'],
      exactness: 'numerical',
    },
  });
}

export interface EvtRiskMeasure {
  /** Confidence level, e.g. 0.999. */
  level: number;
  /** Value at Risk: the level exceeded with probability 1 − level. */
  valueAtRisk: number;
  /** Delta-method standard error of the VaR, or null when unavailable. */
  valueAtRiskStandardError: number | null;
  /** Profile-likelihood interval for the VaR. */
  valueAtRiskInterval: ProfileInterval;
  /** Expected shortfall E[X | X > VaR], or null when it does not exist (ξ ≥ 1). */
  expectedShortfall: number | null;
  expectedShortfallUndefinedReason?: string;
  /** Number of observations that actually exceeded this VaR in the sample. */
  empiricalExceedances: number;
  explanation: Explanation;
}

/**
 * EVT value at risk and expected shortfall at an extreme level, from a POT fit.
 *
 *   VaR_p = u + (σ/ξ)((ζ/(1−p))^ξ − 1)
 *   ES_p  = VaR_p/(1 − ξ) + (σ − ξu)/(1 − ξ)     for ξ < 1
 *
 * This is the regime where empirical quantiles stop working: at p = 0.9999 an
 * empirical quantile is a function of a handful of order statistics, or of
 * none at all if the sample is smaller than 10,000.
 */
export function evtRiskMeasures(
  fit: GpdFit,
  level: number,
  options: { confidenceLevel?: number } = {},
): EngineResult<EvtRiskMeasure> {
  if (!Number.isFinite(level) || level <= 0 || level >= 1) {
    return fail('The risk level must be strictly between 0 and 1 (for example 0.999).');
  }
  const tail = 1 - level;
  if (tail >= fit.exceedanceRate) {
    return fail(
      `A ${(level * 100).toFixed(4)}% quantile is not in the tail this model describes: the threshold is exceeded with probability ${fit.exceedanceRate.toPrecision(3)}, so the fit only speaks about levels beyond the ${((1 - fit.exceedanceRate) * 100).toFixed(4)}% quantile. Refit with a lower threshold or ask for a more extreme level.`,
    );
  }
  const m = 1 / tail;
  const rl = gpdReturnLevel(fit, m, { level: options.confidenceLevel });
  if (!rl.ok) return rl;
  const varValue = rl.value.level;
  const { scale, shape, threshold: u } = fit.params;

  let expectedShortfall: number | null = null;
  let esReason: string | undefined;
  if (shape >= 1) {
    esReason = `The fitted shape ξ = ${shape.toPrecision(4)} is at or above 1, so the exceedance distribution has an infinite mean and the expected shortfall does not exist. No finite average tail loss can be quoted.`;
  } else {
    const es = varValue / (1 - shape) + (scale - shape * u) / (1 - shape);
    if (Number.isFinite(es)) expectedShortfall = es;
    else esReason = 'The expected shortfall evaluated to a non-finite value and is not reported.';
  }

  const empiricalExceedances = fit.exceedances.filter((x) => x > varValue).length;
  const warnings: string[] = [];
  if (empiricalExceedances === 0) {
    warnings.push(
      `No observation in the record exceeds this VaR, so it rests entirely on the fitted tail shape. That is the point of using EVT here — an empirical quantile at this level would be undefined — but it is an extrapolation.`,
    );
  }

  return ok(
    {
      level,
      valueAtRisk: varValue,
      valueAtRiskStandardError: rl.value.standardError,
      valueAtRiskInterval: rl.value.profileInterval,
      expectedShortfall,
      expectedShortfallUndefinedReason: esReason,
      empiricalExceedances,
      explanation: {
        method: 'Value at Risk and Expected Shortfall from a peaks-over-threshold GPD fit',
        formula: 'VaR_p = u + (σ/ξ)((ζ/(1−p))^ξ − 1);  ES_p = (VaR_p + σ − ξu)/(1 − ξ) for ξ < 1',
        steps: [
          { label: 'Level p', value: level.toString() },
          { label: 'Tail probability 1 − p', value: tail.toExponential(4) },
          { label: 'VaR', value: varValue.toPrecision(8) },
          {
            label: 'Expected shortfall',
            value: expectedShortfall === null ? (esReason ?? 'undefined') : expectedShortfall.toPrecision(8),
          },
          { label: 'Observations in the record above this VaR', value: String(empiricalExceedances) },
        ],
        assumptions: [
          'Losses are independent and identically distributed above the threshold; a sign convention of larger = worse is assumed.',
          'The fitted tail continues to hold beyond the observed range.',
        ],
        limitations: [
          `Conditional on the threshold u = ${u}: threshold choice is a judgement call and moves both VaR and ES.`,
          'Expected shortfall is more sensitive to ξ than VaR is, so its interval is wider than the VaR interval even where both are computable.',
          ...warnings,
        ],
        exactness: 'numerical',
      },
    },
    warnings,
  );
}

/** Return-level plot data: level against return period on a log period axis. */
export interface ReturnLevelCurvePoint {
  returnPeriod: number;
  level: number;
  lower: number | null;
  upper: number | null;
}

export function gpdReturnLevelCurve(
  fit: GpdFit,
  options: { fromPeriod?: number; toPeriod?: number; points?: number; level?: number } = {},
): EngineResult<{ points: ReturnLevelCurvePoint[]; explanation: Explanation }> {
  const from = options.fromPeriod ?? Math.ceil(1.5 / fit.exceedanceRate);
  const to = options.toPeriod ?? from * 1000;
  if (!(to > from) || from <= 0) return fail('The return period range for the curve is empty.');
  const count = options.points ?? 40;
  const points: ReturnLevelCurvePoint[] = [];
  const logFrom = Math.log(from);
  const logTo = Math.log(to);
  for (let i = 0; i < count; i++) {
    const m = Math.exp(logFrom + ((logTo - logFrom) * i) / (count - 1));
    const rl = gpdReturnLevel(fit, m, { level: options.level, skipProfile: true });
    if (!rl.ok) continue;
    points.push({
      returnPeriod: m,
      level: rl.value.level,
      lower: rl.value.profileInterval.lower ?? rl.value.deltaInterval?.lower ?? null,
      upper: rl.value.profileInterval.upper ?? rl.value.deltaInterval?.upper ?? null,
    });
  }
  if (points.length === 0) return fail('No return period in the requested range produced a return level.');
  return ok({
    points,
    explanation: {
      method: 'Return level plot from a peaks-over-threshold GPD fit',
      steps: [
        { label: 'Return periods plotted', value: String(points.length) },
        { label: 'Range', value: `${from.toPrecision(4)} to ${to.toPrecision(4)} observations` },
      ],
      assumptions: ['Interval limits are profile-likelihood where they could be bracketed, delta-method otherwise.'],
      limitations: [
        'The curve becomes a straight extrapolation once the return period passes the length of the record; its slope is the fitted ξ and nothing more.',
        EXTRAPOLATION_LIMITATION,
      ],
      exactness: 'numerical',
    },
  });
}

export type { GevParams, GpdParams };
