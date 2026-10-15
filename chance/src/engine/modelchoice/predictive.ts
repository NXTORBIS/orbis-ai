/**
 * Predictive assessment: posterior predictive checks and proper scoring of
 * predictive distributions.
 *
 * Scoring rules are reused from `src/engine/information/scoring.ts` (logScore,
 * brierScore, crpsNormal, crpsEnsemble, calibration, sharpness) rather than
 * reimplemented. What this file adds is the model-choice framing: calibration
 * and sharpness reported SEPARATELY, because a forecast can be perfectly
 * calibrated and useless, and the honest statement of what a posterior
 * predictive p-value is and is not.
 */
import { EngineError, type Explanation } from '../core/result';
import {
  brierScore,
  calibration,
  crpsEnsemble,
  crpsNormal,
  logScore,
  sharpness,
  type BrierResult,
  type CalibrationResult,
  type CrpsResult,
  type LogScoreResult,
  type SharpnessResult,
} from '../information';

/* ------------------------------------------------------------------ */
/* Posterior predictive checks                                        */
/* ------------------------------------------------------------------ */

export interface PosteriorPredictiveCheck {
  readonly statistic: string;
  readonly observed: number;
  /** The discrepancy evaluated on each replicated dataset. */
  readonly replicated: readonly number[];
  /** Pr(T(y_rep) >= T(y)) under the posterior predictive distribution. */
  readonly pValue: number;
  /** min(p, 1 − p) × 2, the two-sided reading. */
  readonly twoSidedPValue: number;
  /** Monte Carlo standard error of the p-value from the finite replicate count. */
  readonly monteCarloStandardError: number;
  readonly replicates: number;
  readonly extreme: boolean;
  readonly exactness: 'empirical';
  readonly statement: string;
  readonly warnings: readonly string[];
  readonly explanation: Explanation;
}

export const PPC_WARNINGS: readonly string[] = [
  'A posterior predictive p-value is NOT uniform under the null. The data were used twice — once to fit the parameters the replicates were drawn with, and again to compute the observed discrepancy — so the replicates are pulled toward the observed data and the p-value is shrunk toward 0.5. It is a conservative check: an extreme value is informative, a value near 0.5 is close to meaningless.',
  'Because of that double use it cannot be interpreted as a tail probability under a null hypothesis, and it should never be compared against 0.05 as if it were. Treat it as a measure of how visibly the model fails on this discrepancy, not as a test.',
  'A check can only detect what the discrepancy statistic looks at. Passing every check you thought of is not evidence of adequacy; it is evidence about the checks.',
  'A discrepancy that the model fits by construction (the sample mean for a model with a free mean parameter) will always pass. Choose statistics the model does not control.',
];

/**
 * Posterior predictive check for a user-supplied discrepancy statistic.
 *
 * @param observed  T(y), the discrepancy on the real data.
 * @param replicated T(y_rep) for each draw from the posterior predictive.
 */
export function posteriorPredictiveCheck(input: {
  readonly statistic: string;
  readonly observed: number;
  readonly replicated: readonly number[];
}): PosteriorPredictiveCheck {
  const rep = input.replicated;
  if (rep.length < 100) {
    throw new EngineError(
      `A posterior predictive p-value needs at least 100 replicated datasets to be worth quoting; ${rep.length} were supplied. Its Monte Carlo standard error would be about ${(0.5 / Math.sqrt(Math.max(1, rep.length))).toFixed(3)}.`,
      'insufficient',
    );
  }
  if (!Number.isFinite(input.observed)) {
    throw new EngineError(`The observed discrepancy is ${String(input.observed)}, so no check can be performed.`, 'nonfinite');
  }
  const bad: number[] = [];
  for (let i = 0; i < rep.length && bad.length < 8; i++) if (!Number.isFinite(rep[i])) bad.push(i);
  if (bad.length) {
    throw new EngineError(
      `The replicated discrepancy is non-finite for replicate(s) ${bad.join(', ')}. Dropping them would bias the p-value, so they are reported instead.`,
      'nonfinite',
    );
  }
  let atLeast = 0;
  for (const r of rep) if (r >= input.observed) atLeast++;
  const p = atLeast / rep.length;
  const twoSided = 2 * Math.min(p, 1 - p);
  const mcse = Math.sqrt((p * (1 - p)) / rep.length);
  const extreme = Math.min(p, 1 - p) < 0.05;
  const warnings = [...PPC_WARNINGS];
  if (p === 0 || p === 1) {
    warnings.push(
      `No replicate out of ${rep.length} fell on ${p === 0 ? 'or above' : 'or below'} the observed side, so the p-value is only bounded: it is below ${(1 / rep.length).toFixed(4)}. The model fails this check clearly; more replicates would only refine a number that is already decisive.`,
    );
  }
  return {
    statistic: input.statistic,
    observed: input.observed,
    replicated: rep,
    pValue: p,
    twoSidedPValue: twoSided,
    monteCarloStandardError: mcse,
    replicates: rep.length,
    extreme,
    exactness: 'empirical',
    statement: extreme
      ? `The observed ${input.statistic} (${input.observed.toPrecision(5)}) is in the tail of its posterior predictive distribution: p = ${p.toPrecision(3)} (± ${mcse.toPrecision(2)} Monte Carlo). The model cannot reproduce this feature of the data. Because this p-value is conservative by construction, an extreme value like this is strong evidence of misfit.`
      : `The observed ${input.statistic} (${input.observed.toPrecision(5)}) sits at p = ${p.toPrecision(3)} (± ${mcse.toPrecision(2)} Monte Carlo) in its posterior predictive distribution. The model reproduces this feature, but note that this p-value is shrunk toward 0.5 by construction — a value near 0.5 is weak evidence of anything.`,
    warnings,
    explanation: {
      method: 'Posterior predictive check',
      formula: 'p_B = Pr( T(y_rep) ≥ T(y) | y ), over draws from the posterior predictive distribution',
      steps: [
        { label: `Observed ${input.statistic}`, value: input.observed.toPrecision(8) },
        { label: 'Replicates at least as extreme', value: `${atLeast} of ${rep.length}` },
        { label: 'Bayesian p-value', value: `${p.toPrecision(5)} ± ${mcse.toPrecision(3)}` },
      ],
      assumptions: [
        'The replicated datasets were drawn from the posterior predictive distribution of the fitted model, one per posterior draw.',
      ],
      limitations: warnings,
      exactness: 'empirical',
    },
  };
}

/* ------------------------------------------------------------------ */
/* Proper scoring of predictive distributions                         */
/* ------------------------------------------------------------------ */

export interface ScoredBinaryForecast {
  readonly name: string;
  readonly logScore: LogScoreResult;
  readonly brier: BrierResult;
  readonly calibration: CalibrationResult;
  readonly sharpness: SharpnessResult;
  readonly exactness: 'exact';
  readonly statement: string;
  readonly warnings: readonly string[];
}

/**
 * Score a binary probabilistic forecast with two proper rules, and report
 * calibration and sharpness separately.
 *
 * Calibration and sharpness are different virtues and a single score mixes
 * them. The climatological forecast — always the base rate — is perfectly
 * calibrated and worthless; a confident forecast can be sharp and badly
 * calibrated. Reporting one number hides which failure you have.
 */
export function scoreBinaryForecast(
  name: string,
  forecasts: ArrayLike<number>,
  outcomes: ArrayLike<number>,
  options: { readonly bins?: number } = {},
): ScoredBinaryForecast {
  const ls = logScore(forecasts, outcomes);
  const bs = brierScore(forecasts, outcomes);
  const cal = calibration(forecasts, outcomes, { bins: options.bins ?? 10 });
  const sharp = sharpness(forecasts);
  const warnings = [
    'Calibration and sharpness are reported separately on purpose. A perfectly calibrated forecast can be useless (always predict the base rate), and a sharp forecast can be badly calibrated. A single proper score adds the two together and hides which one failed.',
    'The log score is unbounded: one confident mistake dominates the average, which is correct behaviour and makes the mean fragile. The Brier score is bounded and less sensitive to the same mistake. They can rank forecasters differently; both are proper.',
    ...ls.explanation.limitations,
  ];
  if (!ls.finite) {
    warnings.push(
      `The log score is infinite because the forecast gave probability 0 to what happened at observation(s) ${ls.offendingIndices.slice(0, 10).join(', ')}. That is the honest value, not a defect to clip away.`,
    );
  }
  return {
    name,
    logScore: ls,
    brier: bs,
    calibration: cal,
    sharpness: sharp,
    exactness: 'exact',
    statement: `"${name}": mean log score ${ls.finite ? ls.value.toPrecision(4) : 'infinite'} and Brier score ${bs.brierScore.toPrecision(4)}. Calibration and sharpness are reported separately; neither is a substitute for the other.`,
    warnings,
  };
}

export interface ScoredDistributionalForecast {
  readonly name: string;
  /** Mean CRPS over observations (lower is better, in the units of y). */
  readonly meanCrps: number;
  readonly perObservation: readonly CrpsResult[];
  /** Mean log predictive density (higher is better), where supplied. */
  readonly meanLogPredictiveDensity: number | null;
  readonly observations: number;
  readonly exactness: 'exact' | 'empirical';
  readonly statement: string;
  readonly warnings: readonly string[];
}

/**
 * Score continuous predictive distributions by CRPS, either from normal
 * predictive distributions (closed form) or from predictive samples (the
 * exact formula for the empirical CDF). Delegates to
 * `src/engine/information/scoring.ts`.
 */
export function scoreDistributionalForecast(input: {
  readonly name: string;
  readonly observations: readonly number[];
  /** Either normal predictive parameters, or an ensemble of predictive draws per observation. */
  readonly normal?: readonly { readonly mean: number; readonly sd: number }[];
  readonly ensembles?: readonly (readonly number[])[];
  /** Optional log predictive densities, to report the log score alongside CRPS. */
  readonly logPredictiveDensity?: readonly number[];
}): ScoredDistributionalForecast {
  const y = input.observations;
  if (y.length === 0) throw new EngineError('There are no observations to score.', 'empty');
  if ((input.normal === undefined) === (input.ensembles === undefined)) {
    throw new EngineError(
      'Supply exactly one of `normal` (predictive mean and standard deviation per observation) or `ensembles` (predictive draws per observation).',
      'invalid',
    );
  }
  const ensembles = input.ensembles;
  const source = input.normal ?? ensembles;
  if (source === undefined || source.length !== y.length) {
    throw new EngineError(
      `${source?.length ?? 0} predictive distributions were supplied for ${y.length} observations; there must be one per observation.`,
      'shape',
    );
  }
  const per: CrpsResult[] = [];
  for (let i = 0; i < y.length; i++) {
    if (!Number.isFinite(y[i])) throw new EngineError(`Observation ${i} is ${String(y[i])}.`, 'nonfinite');
    per.push(
      input.normal
        ? crpsNormal(input.normal[i].mean, input.normal[i].sd, y[i])
        : crpsEnsemble(ensembles === undefined ? [] : ensembles[i], y[i]),
    );
  }
  let mean = 0;
  for (const r of per) mean += r.value / per.length;
  let meanLpd: number | null = null;
  if (input.logPredictiveDensity) {
    if (input.logPredictiveDensity.length !== y.length) {
      throw new EngineError(
        `${input.logPredictiveDensity.length} log predictive densities were supplied for ${y.length} observations.`,
        'shape',
      );
    }
    const bad = input.logPredictiveDensity.findIndex((v) => !Number.isFinite(v));
    if (bad >= 0) {
      throw new EngineError(
        `The log predictive density at observation ${bad} is ${String(input.logPredictiveDensity[bad])}: the model assigned zero density to an observed value. That is the finding; it is not averaged over.`,
        'nonfinite',
      );
    }
    meanLpd = input.logPredictiveDensity.reduce((a, b) => a + b, 0) / y.length;
  }
  return {
    name: input.name,
    meanCrps: mean,
    perObservation: per,
    meanLogPredictiveDensity: meanLpd,
    observations: y.length,
    exactness: input.normal ? 'exact' : 'empirical',
    statement: `"${input.name}": mean CRPS ${mean.toPrecision(5)} over ${y.length} observations${meanLpd === null ? '' : `, mean log predictive density ${meanLpd.toPrecision(5)}`}. CRPS has the units of the observation, so it cannot be compared across differently measured quantities.`,
    warnings: [
      'CRPS is proper but less sensitive to the tails than the log score: a badly calibrated tail costs little. The two can rank models differently, and the log score is the one that corresponds to elpd, WAIC and cross-validation.',
      'These scores are in-sample unless the predictive distributions were formed without the scored observations. A score computed from a model that has seen the observation is not a measure of predictive performance.',
      ...(input.ensembles
        ? ['The ensemble CRPS is that of the empirical CDF of the draws, which is biased low by order 1/m in the number of draws.']
        : []),
    ],
  };
}
