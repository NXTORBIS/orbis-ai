/**
 * Information criteria: AIC, AICc, BIC, Akaike weights, and DIC.
 *
 * These are not interchangeable and they do not answer the same question.
 *   AIC  estimates out-of-sample predictive loss (expected log predictive
 *        density), with a bias correction of k. It is not consistent: as n
 *        grows it keeps a non-vanishing chance of selecting a model too large,
 *        because predicting well and identifying the truth are different aims.
 *   BIC  approximates −2 log of the marginal likelihood under a prior whose
 *        information is worth one observation. It is consistent when the true
 *        model is in the set, and it is answering a question about truth, not
 *        about prediction. Its "prior" is an artefact of the approximation,
 *        not anyone's belief.
 * Choosing between them means choosing which question you are asking.
 */
import { logSumExp } from '../core/numeric';
import { EngineError, Validator, type Explanation } from '../core/result';
import type { CriterionValue, CriterionWeight } from './types';
import { MODEL_SET_CAVEAT } from './types';

/**
 * The size of criterion gap below which there is no meaningful preference.
 * Burnham & Anderson's rule of thumb; the point is that it is a rule of thumb
 * and not a test, which is why every comparison here also reports a standard
 * error where one exists.
 */
export const NEGLIGIBLE_GAP = 2;

export interface CriterionInput {
  readonly name: string;
  /** Maximised log-likelihood (natural log). */
  readonly logLikelihood: number;
  /** Number of estimated parameters, including any variance parameters. */
  readonly parameters: number;
  /** Number of observations the likelihood was computed from. */
  readonly observations: number;
}

/** AIC, AICc and BIC for one model. Exact arithmetic given the inputs. */
export function informationCriteria(input: CriterionInput): CriterionValue {
  const v = new Validator();
  v.finite(input.logLikelihood, 'logLikelihood', 'The maximised log-likelihood');
  v.integer(input.parameters, 'parameters', 'The number of parameters', 0);
  v.integer(input.observations, 'observations', 'The number of observations', 1);
  v.throwIfInvalid();
  const k = input.parameters;
  const n = input.observations;
  const aic = 2 * k - 2 * input.logLikelihood;
  const denom = n - k - 1;
  const aicc = denom > 0 ? aic + (2 * k * (k + 1)) / denom : null;
  const bic = k * Math.log(n) - 2 * input.logLikelihood;
  return {
    name: input.name,
    logLikelihood: input.logLikelihood,
    parameters: k,
    observations: n,
    aic,
    aicc,
    bic,
  };
}

export type CriterionKind = 'aic' | 'aicc' | 'bic';

export interface CriterionRanking {
  readonly criterion: CriterionKind;
  readonly values: readonly CriterionValue[];
  readonly weights: readonly CriterionWeight[];
  readonly best: string;
  /** True when the runner-up is within NEGLIGIBLE_GAP of the best. */
  readonly indistinguishable: boolean;
  readonly statement: string;
  readonly explanation: Explanation;
  readonly warnings: readonly string[];
}

function pick(value: CriterionValue, kind: CriterionKind): number {
  if (kind === 'aic') return value.aic;
  if (kind === 'bic') return value.bic;
  if (value.aicc === null) {
    throw new EngineError(
      `AICc is undefined for model "${value.name}": n − k − 1 = ${value.observations - value.parameters - 1} is not positive (n = ${value.observations}, k = ${value.parameters}). With this many parameters per observation no criterion of this kind is usable.`,
      'undefined',
    );
  }
  return value.aicc;
}

/**
 * Akaike weights (or the BIC analogue): exp(−Δ/2) normalised over the set.
 *
 * Computed through logSumExp, so a set spanning hundreds of criterion units
 * does not underflow to a row of zeros. The weights sum to 1 by construction;
 * they are the relative likelihood of each model being the best in THIS SET by
 * this criterion, which is not the probability that it is true.
 */
export function criterionWeights(
  inputs: readonly CriterionInput[],
  kind: CriterionKind = 'aic',
): CriterionRanking {
  if (inputs.length === 0) {
    throw new EngineError(
      'The model set is empty, so there are no information criteria to rank. Supply at least one model.',
      'empty',
    );
  }
  const values = inputs.map(informationCriteria);
  const raw = values.map((val) => pick(val, kind));
  let bestIdx = 0;
  for (let i = 1; i < raw.length; i++) if (raw[i] < raw[bestIdx]) bestIdx = i;
  const deltas = raw.map((r) => r - raw[bestIdx]);
  const logTerms = deltas.map((d) => -d / 2);
  const logNorm = logSumExp(logTerms);
  const weights: CriterionWeight[] = values.map((val, i) => {
    const w = Math.exp(logTerms[i] - logNorm);
    return {
      name: val.name,
      delta: deltas[i],
      relativeLikelihood: Math.exp(logTerms[i]),
      weight: w,
      evidenceRatio: w > 0 ? Math.exp(-logTerms[i]) : Infinity,
    };
  });
  // Renormalise against floating point so the weights sum to exactly 1.
  const total = weights.reduce((a, b) => a + b.weight, 0);
  const normalised: CriterionWeight[] = weights.map((w, i) =>
    i === weights.length - 1
      ? { ...w, weight: 1 - weights.slice(0, -1).reduce((a, b) => a + b.weight / total, 0) }
      : { ...w, weight: w.weight / total },
  );
  const sorted = [...deltas].sort((a, b) => a - b);
  const runnerUp = sorted.length > 1 ? sorted[1] : Infinity;
  const indistinguishable = runnerUp < NEGLIGIBLE_GAP;
  const label = kind.toUpperCase();
  const statement = indistinguishable
    ? `The best ${label} is "${values[bestIdx].name}", but the runner-up is only ${runnerUp.toFixed(2)} ${label} units behind. A gap under about ${NEGLIGIBLE_GAP} is not a meaningful preference: these models cannot be separated by ${label} on this data.`
    : `"${values[bestIdx].name}" has the lowest ${label}, ahead of the runner-up by ${runnerUp.toFixed(2)} units.`;
  const warnings = [
    MODEL_SET_CAVEAT,
    `A ${label} gap below about ${NEGLIGIBLE_GAP} is not evidence of a preference.`,
    kind === 'bic'
      ? 'BIC approximates a marginal likelihood under a unit-information prior. It is not an estimate of predictive accuracy, and the implied prior was never chosen by anyone.'
      : 'AIC estimates predictive loss. It is not consistent for identifying a true model, and it is not a hypothesis test.',
    'AIC and BIC answer different questions. Where they disagree, neither is wrong; they are being asked different things.',
  ];
  if (kind === 'aic') {
    const small = values.filter((val) => val.observations / Math.max(1, val.parameters) < 40);
    if (small.length) {
      warnings.push(
        `For ${small.map((s) => `"${s.name}"`).join(', ')} the ratio n/k is below 40, where AIC is noticeably biased. Use AICc.`,
      );
    }
  }
  return {
    criterion: kind,
    values,
    weights: normalised,
    best: values[bestIdx].name,
    indistinguishable,
    statement,
    explanation: {
      method: `${label} ranking with relative likelihoods`,
      formula:
        kind === 'bic'
          ? 'BIC = k·ln(n) − 2·lnL;  w_i = exp(−Δ_i/2) / Σ exp(−Δ_j/2)'
          : kind === 'aicc'
            ? 'AICc = 2k − 2·lnL + 2k(k+1)/(n−k−1);  w_i = exp(−Δ_i/2) / Σ exp(−Δ_j/2)'
            : 'AIC = 2k − 2·lnL;  w_i = exp(−Δ_i/2) / Σ exp(−Δ_j/2)',
      steps: normalised.map((w) => ({
        label: w.name,
        expression: `Δ${label} = ${w.delta.toFixed(3)}`,
        value: `weight ${w.weight.toPrecision(4)}`,
      })),
      assumptions: [
        'The models were fitted to the same observations, with likelihoods on the same scale (no dropped constants that differ between models).',
        'The parameter counts include every estimated quantity, variance parameters included.',
      ],
      limitations: warnings,
      exactness: 'exact',
    },
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* DIC                                                                */
/* ------------------------------------------------------------------ */

export interface DicInput {
  readonly name: string;
  /** Total log-likelihood at each posterior draw: logLikDraws[s] = Σ_i log p(y_i | theta_s). */
  readonly logLikDraws: readonly number[];
  /** Log-likelihood evaluated at the posterior mean of the parameters, if available. */
  readonly logLikAtPosteriorMean?: number;
}

export interface DicResult {
  readonly name: string;
  readonly dic: number;
  /** Effective number of parameters. */
  readonly effectiveParameters: number;
  /** Which pD definition was used. */
  readonly effectiveParametersMethod: 'plug-in' | 'variance';
  readonly posteriorMeanDeviance: number;
  /** Deviance at the posterior mean; null for the variance-based pD. */
  readonly devianceAtPosteriorMean: number | null;
  readonly exactness: 'empirical';
  readonly warnings: readonly string[];
  readonly explanation: Explanation;
}

/**
 * Deviance information criterion.
 *
 * DIC = D(theta-bar) + 2·pD with the plug-in pD = D-bar − D(theta-bar), or
 * pD = var(D)/2 when no plug-in deviance is supplied.
 *
 * DIC is reported here for continuity with older work, not recommended. It is
 * not invariant to reparameterisation (the posterior mean of a parameter is
 * not the posterior mean of its logarithm, so the plug-in deviance changes),
 * its pD can be negative for a non-log-concave posterior, and the criterion
 * itself can be negative for continuous data because a density can exceed 1.
 * WAIC and PSIS-LOO have none of these defects.
 */
export function dic(input: DicInput): DicResult {
  const draws = input.logLikDraws;
  if (draws.length < 50) {
    throw new EngineError(
      `DIC for "${input.name}" needs at least 50 posterior draws; ${draws.length} were supplied.`,
      'insufficient',
    );
  }
  const badIdx: number[] = [];
  for (let s = 0; s < draws.length && badIdx.length < 8; s++) if (!Number.isFinite(draws[s])) badIdx.push(s);
  if (badIdx.length) {
    throw new EngineError(
      `DIC for "${input.name}": the log-likelihood is non-finite at draw(s) ${badIdx.join(', ')}.`,
      'nonfinite',
    );
  }
  const s = draws.length;
  let mean = 0;
  for (const d of draws) mean += d / s;
  let varSum = 0;
  for (const d of draws) varSum += (d - mean) * (d - mean);
  const varDev = (4 * varSum) / (s - 1); // deviance = −2·logLik, so var scales by 4
  const dBar = -2 * mean;
  const warnings = [
    'DIC is not invariant to reparameterisation: rewriting the model in terms of a transformed parameter changes the plug-in deviance and so the criterion.',
    'DIC can be negative when the data are continuous, because a density may exceed 1. A negative DIC is not an error and is not meaningful on its own; only differences are.',
    'DIC assumes an approximately normal posterior and a well-defined plug-in point. WAIC and PSIS-LOO are preferred; DIC is provided for comparison with older analyses.',
    MODEL_SET_CAVEAT,
  ];
  let pD: number;
  let method: 'plug-in' | 'variance';
  let dHat: number | null;
  if (input.logLikAtPosteriorMean !== undefined) {
    if (!Number.isFinite(input.logLikAtPosteriorMean)) {
      throw new EngineError(
        `DIC for "${input.name}": the log-likelihood at the posterior mean is not finite, so the plug-in effective parameter count cannot be formed.`,
        'nonfinite',
      );
    }
    dHat = -2 * input.logLikAtPosteriorMean;
    pD = dBar - dHat;
    method = 'plug-in';
    if (pD < 0) {
      warnings.push(
        `The plug-in effective parameter count is negative (pD = ${pD.toFixed(3)}). This happens when the posterior mean is a poor plug-in point, typically a skewed or multimodal posterior, and it makes the DIC uninterpretable here.`,
      );
    }
  } else {
    pD = varDev / 2;
    method = 'variance';
    dHat = null;
    warnings.push(
      'No log-likelihood at the posterior mean was supplied, so the variance-based pD = var(D)/2 was used. It is a different criterion from the plug-in DIC and the two are not comparable with each other.',
    );
  }
  const value = method === 'plug-in' && dHat !== null ? dHat + 2 * pD : dBar + pD;
  return {
    name: input.name,
    dic: value,
    effectiveParameters: pD,
    effectiveParametersMethod: method,
    posteriorMeanDeviance: dBar,
    devianceAtPosteriorMean: dHat,
    exactness: 'empirical',
    warnings,
    explanation: {
      method: `DIC with ${method} effective parameter count`,
      formula: method === 'plug-in' ? 'DIC = D(θ̄) + 2·pD,  pD = D̄ − D(θ̄)' : 'DIC = D̄ + pD,  pD = var(D)/2',
      steps: [
        { label: 'Posterior mean deviance D̄', value: dBar.toPrecision(8) },
        ...(dHat === null ? [] : [{ label: 'Deviance at posterior mean D(θ̄)', value: dHat.toPrecision(8) }]),
        { label: 'Effective parameters pD', value: pD.toPrecision(6) },
        { label: 'DIC', value: value.toPrecision(8) },
      ],
      assumptions: ['The posterior draws are a converged sample from the posterior.'],
      limitations: warnings,
      exactness: 'empirical',
    },
  };
}
