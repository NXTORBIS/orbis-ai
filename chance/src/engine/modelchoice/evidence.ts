/**
 * Bayesian evidence: marginal likelihoods, Bayes factors, posterior model
 * probabilities, Savage-Dickey ratios, and a prior sensitivity curve.
 *
 * READ THIS BEFORE USING ANY OF IT.
 *
 * A Bayes factor is not a measure of predictive accuracy. It is the ratio of
 * two marginal likelihoods, each of which averages the likelihood over the
 * PRIOR, so each depends on the prior everywhere the prior has mass — not just
 * where the posterior ends up. The dependence does not wash out with data: for
 * a parameter that appears in only one model, multiplying the width of its
 * prior by c divides the Bayes factor for that model by roughly c, without
 * bound and for any sample size (the Jeffreys-Lindley paradox). A diffuse
 * prior, chosen to look uninformative, therefore mechanically favours the
 * simpler model. `bayesFactorPriorSensitivity` makes this visible instead of
 * leaving it as a warning: it returns the whole curve, so a user can see how
 * much of the answer is theirs and how much is the prior's.
 *
 * Marginal likelihood estimation itself is delegated to `src/engine/mcmc`
 * (bridge sampling and importance sampling with a Gaussian proposal).
 */
import { logSumExp } from '../core/numeric';
import { EngineError, type Explanation } from '../core/result';
import {
  marginalLikelihood as mcmcMarginalLikelihood,
  type LogDensity,
  type MarginalLikelihoodResult,
} from '../mcmc';

export type { MarginalLikelihoodResult };

export interface EvidenceEstimate {
  readonly name: string;
  readonly logMarginalLikelihood: number;
  readonly method: 'bridge-sampling' | 'importance-sampling' | 'analytic';
  /** Relative standard error of the normalising constant; 0 for an analytic value. */
  readonly relativeStandardError: number;
  /** Approximate standard error of log Z, which is the relative error of Z. */
  readonly logStandardError: number;
  readonly exactness: 'empirical' | 'exact';
  readonly warnings: readonly string[];
}

/**
 * Estimate a model's marginal likelihood from posterior draws and the
 * unnormalised log joint density (log likelihood + log prior, with BOTH
 * properly normalised — an improper prior makes the number meaningless).
 */
export function estimateEvidence(
  name: string,
  posteriorDraws: readonly (readonly number[])[],
  logJointDensity: LogDensity,
  seed: string,
  options: { readonly method?: 'bridge-sampling' | 'importance-sampling'; readonly proposalDraws?: number } = {},
): EvidenceEstimate {
  const res: MarginalLikelihoodResult = mcmcMarginalLikelihood(posteriorDraws, logJointDensity, seed, options);
  const warnings = [
    ...res.warnings,
    'A marginal likelihood is defined only for a proper, normalised prior. If the prior used here was improper or arbitrarily wide, this number is arbitrary too.',
  ];
  if (res.relativeStandardError > 0.1) {
    warnings.push(
      `The relative standard error of the evidence estimate is ${(res.relativeStandardError * 100).toFixed(1)}%, which is ±${res.relativeStandardError.toFixed(3)} on the log scale. Differences in log evidence smaller than that are noise.`,
    );
  }
  return {
    name,
    logMarginalLikelihood: res.logMarginalLikelihood,
    method: res.method,
    relativeStandardError: res.relativeStandardError,
    logStandardError: res.relativeStandardError,
    exactness: 'empirical',
    warnings,
  };
}

/** Wrap an analytically known marginal likelihood in the same shape. */
export function analyticEvidence(name: string, logMarginalLikelihood: number): EvidenceEstimate {
  if (!Number.isFinite(logMarginalLikelihood)) {
    throw new EngineError(`The analytic log marginal likelihood for "${name}" must be finite; got ${String(logMarginalLikelihood)}.`, 'finite');
  }
  return {
    name,
    logMarginalLikelihood,
    method: 'analytic',
    relativeStandardError: 0,
    logStandardError: 0,
    exactness: 'exact',
    warnings: ['An analytic marginal likelihood has no Monte Carlo error, but it depends on the prior exactly as much as an estimated one does.'],
  };
}

/* ------------------------------------------------------------------ */
/* Bayes factors                                                      */
/* ------------------------------------------------------------------ */

export type EvidenceStrength =
  | 'not worth more than a bare mention'
  | 'substantial'
  | 'strong'
  | 'very strong'
  | 'decisive';

/** Jeffreys' scale, on log10 of the Bayes factor. It is a convention, not a measurement. */
export function interpretBayesFactor(log10Bf: number): EvidenceStrength {
  const a = Math.abs(log10Bf);
  if (a < 0.5) return 'not worth more than a bare mention';
  if (a < 1) return 'substantial';
  if (a < 1.5) return 'strong';
  if (a < 2) return 'very strong';
  return 'decisive';
}

export interface BayesFactorResult {
  readonly numerator: string;
  readonly denominator: string;
  readonly logBayesFactor: number;
  readonly bayesFactor: number;
  readonly log10BayesFactor: number;
  /** Approximate standard error of log BF, adding the two relative errors in quadrature. */
  readonly logStandardError: number;
  readonly interpretation: EvidenceStrength;
  readonly favours: string | 'neither';
  readonly statement: string;
  readonly exactness: 'empirical' | 'exact';
  readonly warnings: readonly string[];
  readonly explanation: Explanation;
}

export const BAYES_FACTOR_WARNINGS: readonly string[] = [
  'A Bayes factor depends on the prior and keeps depending on it in the limit of infinite data. Widening the prior on a parameter that only one model contains drives the Bayes factor toward the other model without bound — the Jeffreys-Lindley paradox. Use bayesFactorPriorSensitivity to see how much of your answer is the prior.',
  'A diffuse prior is not a neutral prior. Spreading a parameter’s prior mass over a range the data rules out is a statement that the parameter is probably large, and it mechanically penalises the model that has the parameter.',
  'A Bayes factor is not a measure of predictive accuracy. It compares average fit over the PRIOR, not expected performance on new data. For prediction, use elpd (WAIC, PSIS-LOO or cross-validation) instead.',
  'A Bayes factor is a ratio between two specific models. It says nothing about whether either is adequate, and the ratio can be large while both models fit badly.',
];

export function bayesFactor(numerator: EvidenceEstimate, denominator: EvidenceEstimate): BayesFactorResult {
  const logBf = numerator.logMarginalLikelihood - denominator.logMarginalLikelihood;
  const se = Math.sqrt(
    numerator.logStandardError * numerator.logStandardError + denominator.logStandardError * denominator.logStandardError,
  );
  const log10 = logBf / Math.LN10;
  const interpretation = interpretBayesFactor(log10);
  const indecisive = Math.abs(logBf) < Math.max(1, 2 * se);
  const favours = indecisive ? 'neither' : logBf > 0 ? numerator.name : denominator.name;
  const statement = indecisive
    ? `The Bayes factor for "${numerator.name}" over "${denominator.name}" is ${Math.exp(logBf).toPrecision(3)} (log ${logBf.toFixed(3)} ± ${se.toFixed(3)}). That is not evidence for either model.`
    : `The Bayes factor for "${numerator.name}" over "${denominator.name}" is ${Math.exp(logBf).toPrecision(3)} (log ${logBf.toFixed(3)} ± ${se.toFixed(3)}): ${interpretation} evidence for "${favours}" on Jeffreys’ scale — under these priors, and only under these priors.`;
  const warnings = [...BAYES_FACTOR_WARNINGS, ...numerator.warnings, ...denominator.warnings];
  return {
    numerator: numerator.name,
    denominator: denominator.name,
    logBayesFactor: logBf,
    bayesFactor: Math.exp(logBf),
    log10BayesFactor: log10,
    logStandardError: se,
    interpretation,
    favours,
    statement,
    exactness: numerator.exactness === 'exact' && denominator.exactness === 'exact' ? 'exact' : 'empirical',
    warnings,
    explanation: {
      method: 'Bayes factor from two marginal likelihoods',
      formula: 'log BF₁₀ = log p(y | M₁) − log p(y | M₀)',
      steps: [
        { label: `log evidence, ${numerator.name}`, value: numerator.logMarginalLikelihood.toPrecision(10) },
        { label: `log evidence, ${denominator.name}`, value: denominator.logMarginalLikelihood.toPrecision(10) },
        { label: 'log Bayes factor', value: `${logBf.toPrecision(8)} ± ${se.toPrecision(3)}` },
        { label: 'Jeffreys interpretation', value: interpretation },
      ],
      assumptions: [
        'Both priors are proper and normalised.',
        'Both marginal likelihoods were computed from the same data with the same likelihood normalisation.',
      ],
      limitations: warnings,
      exactness: numerator.exactness === 'exact' && denominator.exactness === 'exact' ? 'exact' : 'empirical',
    },
  };
}

/* ------------------------------------------------------------------ */
/* Prior sensitivity: the Jeffreys-Lindley paradox, demonstrated      */
/* ------------------------------------------------------------------ */

export interface PriorSensitivityPoint {
  readonly priorScale: number;
  readonly logMarginalLikelihood: number;
  readonly logBayesFactor: number;
  readonly bayesFactor: number;
}

export interface PriorSensitivityResult {
  readonly curve: readonly PriorSensitivityPoint[];
  /** True when the Bayes factor falls monotonically as the prior widens. */
  readonly monotoneTowardSimpler: boolean;
  /** Range of log BF across the prior scales examined. */
  readonly logBayesFactorRange: readonly [number, number];
  /** Slope of log BF against log prior scale over the widest half of the range. */
  readonly asymptoticSlope: number;
  readonly statement: string;
  readonly exactness: 'exact' | 'empirical';
  readonly warnings: readonly string[];
  readonly explanation: Explanation;
}

/**
 * Bayes factor as a function of the prior width on the extra parameter, with
 * the data held fixed.
 *
 * This is the Jeffreys-Lindley paradox made visible. The slope of log BF
 * against log prior scale tends to −1 for a single extra parameter: every
 * tenfold widening of a prior the data has already ruled out costs the richer
 * model a factor of about ten, no matter how much data there is and no matter
 * what the data say. If your conclusion changes over the range of prior widths
 * you could defend, the conclusion is the prior's, not the data's.
 */
export function bayesFactorPriorSensitivity(input: {
  readonly priorScales: readonly number[];
  /** log p(y | M₁) as a function of the prior scale on the extra parameter. */
  readonly logEvidenceRicher: (priorScale: number) => number;
  /** log p(y | M₀); the simpler model has no such parameter, so it is constant. */
  readonly logEvidenceSimpler: number;
  readonly richerName?: string;
  readonly simplerName?: string;
  readonly exactness?: 'exact' | 'empirical';
}): PriorSensitivityResult {
  const scales = [...input.priorScales].sort((a, b) => a - b);
  if (scales.length < 3) {
    throw new EngineError(
      `A prior sensitivity curve needs at least 3 prior scales to show a trend; ${scales.length} were supplied.`,
      'insufficient',
    );
  }
  if (scales.some((s) => !(s > 0) || !Number.isFinite(s))) {
    throw new EngineError('Every prior scale must be a finite positive number.', 'range');
  }
  if (!Number.isFinite(input.logEvidenceSimpler)) {
    throw new EngineError('The log evidence of the simpler model must be finite.', 'finite');
  }
  const curve: PriorSensitivityPoint[] = scales.map((priorScale) => {
    const lz = input.logEvidenceRicher(priorScale);
    if (!Number.isFinite(lz)) {
      throw new EngineError(
        `The log evidence of the richer model is ${String(lz)} at prior scale ${priorScale}, so the sensitivity curve cannot be drawn there.`,
        'nonfinite',
      );
    }
    const logBf = lz - input.logEvidenceSimpler;
    return { priorScale, logMarginalLikelihood: lz, logBayesFactor: logBf, bayesFactor: Math.exp(logBf) };
  });
  let monotone = true;
  for (let i = 1; i < curve.length; i++) {
    if (curve[i].logBayesFactor > curve[i - 1].logBayesFactor) monotone = false;
  }
  const lo = Math.min(...curve.map((c) => c.logBayesFactor));
  const hi = Math.max(...curve.map((c) => c.logBayesFactor));
  const half = Math.max(1, Math.floor(curve.length / 2));
  const a = curve[curve.length - half];
  const b = curve[curve.length - 1];
  const slope =
    b.priorScale !== a.priorScale
      ? (b.logBayesFactor - a.logBayesFactor) / (Math.log(b.priorScale) - Math.log(a.priorScale))
      : NaN;
  const richer = input.richerName ?? 'the richer model';
  const simpler = input.simplerName ?? 'the simpler model';
  const statement = monotone
    ? `With the data fixed, widening the prior on the extra parameter from ${scales[0]} to ${scales[scales.length - 1]} moves log BF for ${richer} over ${simpler} from ${curve[0].logBayesFactor.toFixed(2)} to ${curve[curve.length - 1].logBayesFactor.toFixed(2)} — monotonically toward ${simpler}, with slope ${slope.toFixed(2)} per e-fold of prior width. This is the Jeffreys-Lindley paradox: the Bayes factor can be driven to any value in favour of ${simpler} by a choice that expresses no opinion about the data. Over this range the conclusion is the prior’s.`
    : `log BF for ${richer} over ${simpler} ranges from ${lo.toFixed(2)} to ${hi.toFixed(2)} across the prior scales examined, without a single monotone trend. A range of ${(hi - lo).toFixed(2)} in log BF from the prior alone, with the data fixed, is how much of this answer is not data.`;
  const warnings = [
    ...BAYES_FACTOR_WARNINGS,
    `Across the prior scales supplied, the Bayes factor spans ${(hi - lo).toFixed(2)} on the log scale (a factor of ${Math.exp(hi - lo).toPrecision(3)}) with the data unchanged.`,
  ];
  return {
    curve,
    monotoneTowardSimpler: monotone,
    logBayesFactorRange: [lo, hi],
    asymptoticSlope: slope,
    statement,
    exactness: input.exactness ?? 'empirical',
    warnings,
    explanation: {
      method: 'Bayes factor prior sensitivity (Jeffreys-Lindley)',
      formula: 'log BF₁₀(τ) = log p(y | M₁, prior scale τ) − log p(y | M₀)',
      steps: curve.map((c) => ({
        label: `prior scale ${c.priorScale.toPrecision(4)}`,
        value: `log BF = ${c.logBayesFactor.toFixed(4)}  (BF = ${c.bayesFactor.toPrecision(4)})`,
      })),
      assumptions: ['The data are identical at every prior scale; only the prior width changes.'],
      limitations: warnings,
      exactness: input.exactness ?? 'empirical',
    },
  };
}

/* ------------------------------------------------------------------ */
/* Posterior model probabilities                                      */
/* ------------------------------------------------------------------ */

export interface PosteriorModelProbability {
  readonly name: string
  readonly priorProbability: number;
  readonly posteriorProbability: number;
  readonly logMarginalLikelihood: number;
}

export interface PosteriorModelProbabilityResult {
  readonly probabilities: readonly PosteriorModelProbability[];
  readonly best: string;
  readonly statement: string;
  readonly exactness: 'empirical' | 'exact';
  readonly warnings: readonly string[];
  readonly explanation: Explanation;
}

/**
 * Posterior model probabilities over a model set, via logSumExp.
 *
 * These are probabilities CONDITIONAL ON ONE OF THESE MODELS BEING TRUE. That
 * condition is never satisfied. A posterior probability of 0.97 for one model
 * means it is 0.97 of the probability this set can allocate, which is not the
 * same as a 97% chance of being right.
 */
export function posteriorModelProbabilities(
  evidence: readonly EvidenceEstimate[],
  priorProbabilities?: readonly number[],
): PosteriorModelProbabilityResult {
  if (evidence.length === 0) {
    throw new EngineError('The model set is empty, so no posterior model probabilities exist.', 'empty');
  }
  const m = evidence.length;
  const priors = priorProbabilities ?? new Array<number>(m).fill(1 / m);
  if (priors.length !== m) {
    throw new EngineError(
      `${priors.length} prior model probabilities were supplied for ${m} models. There must be exactly one per model.`,
      'shape',
    );
  }
  const total = priors.reduce((a, b) => a + b, 0);
  if (!(total > 0) || priors.some((p) => !(p >= 0) || !Number.isFinite(p))) {
    throw new EngineError('Prior model probabilities must be finite, non-negative and not all zero.', 'range');
  }
  const logTerms = evidence.map((e, i) => Math.log(priors[i] / total) + e.logMarginalLikelihood);
  const norm = logSumExp(logTerms);
  if (!Number.isFinite(norm)) {
    throw new EngineError('Every model in the set has zero posterior weight, so no posterior model probability can be formed.', 'degenerate');
  }
  const probabilities = evidence.map((e, i) => ({
    name: e.name,
    priorProbability: priors[i] / total,
    posteriorProbability: Math.exp(logTerms[i] - norm),
    logMarginalLikelihood: e.logMarginalLikelihood,
  }));
  const best = probabilities.reduce((a, b) => (b.posteriorProbability > a.posteriorProbability ? b : a));
  const warnings = [
    'These probabilities are conditional on the model set being exhaustive — on one of these models being the true one. It never is. They redistribute a certainty that does not exist, and they cannot express "none of the above".',
    ...BAYES_FACTOR_WARNINGS,
    ...new Set(evidence.flatMap((e) => e.warnings)),
  ];
  return {
    probabilities,
    best: best.name,
    statement: `Conditional on one of these ${m} models being true — which is not a condition that holds — "${best.name}" has posterior probability ${best.posteriorProbability.toPrecision(3)}. Read it as a share of the probability this set can allocate, not as a chance of being right.`,
    exactness: evidence.every((e) => e.exactness === 'exact') ? 'exact' : 'empirical',
    warnings,
    explanation: {
      method: 'Posterior model probabilities',
      formula: 'p(M_k | y) = π_k p(y | M_k) / Σ_j π_j p(y | M_j), computed by logSumExp',
      steps: probabilities.map((p) => ({
        label: p.name,
        expression: `prior ${p.priorProbability.toPrecision(3)}, log evidence ${p.logMarginalLikelihood.toPrecision(8)}`,
        value: `posterior ${p.posteriorProbability.toPrecision(4)}`,
      })),
      assumptions: ['The model set is exhaustive and mutually exclusive.', 'Each marginal likelihood used a proper prior.'],
      limitations: warnings,
      exactness: evidence.every((e) => e.exactness === 'exact') ? 'exact' : 'empirical',
    },
  };
}

/* ------------------------------------------------------------------ */
/* Savage-Dickey density ratio                                        */
/* ------------------------------------------------------------------ */

export interface SavageDickeyResult {
  /** BF for the restricted (nested, simpler) model over the unrestricted one. */
  readonly bayesFactorRestricted: number;
  readonly logBayesFactorRestricted: number;
  readonly posteriorDensityAtPoint: number;
  readonly priorDensityAtPoint: number;
  readonly point: number;
  readonly bandwidth: number;
  /** Fraction of draws within one bandwidth of the test point. */
  readonly localDrawFraction: number;
  readonly exactness: 'empirical';
  readonly statement: string;
  readonly warnings: readonly string[];
  readonly explanation: Explanation;
}

/**
 * Savage-Dickey density ratio for a nested pair: BF₀₁ = p(θ = θ₀ | y) / p(θ = θ₀).
 *
 * Valid only when the restricted model is the unrestricted one with θ fixed at
 * θ₀ AND the prior on the remaining parameters does not depend on θ. The
 * posterior ordinate is estimated by a Gaussian kernel density, which is the
 * weak point: if few draws land near θ₀ the ordinate is extrapolated from the
 * kernel, not measured, so the local draw fraction is reported and a thin
 * neighbourhood is a refusal rather than a number.
 */
export function savageDickey(input: {
  readonly posteriorDraws: readonly number[];
  readonly priorDensityAt: (theta: number) => number;
  readonly point?: number;
  readonly bandwidth?: number;
}): SavageDickeyResult {
  const draws = input.posteriorDraws;
  const point = input.point ?? 0;
  if (draws.length < 200) {
    throw new EngineError(
      `A Savage-Dickey ratio needs at least 200 posterior draws of the tested parameter to estimate a density ordinate; ${draws.length} were supplied.`,
      'insufficient',
    );
  }
  const badIdx = draws.findIndex((d) => !Number.isFinite(d));
  if (badIdx >= 0) {
    throw new EngineError(`Posterior draw ${badIdx} of the tested parameter is ${String(draws[badIdx])}.`, 'nonfinite');
  }
  const n = draws.length;
  let mean = 0;
  for (const d of draws) mean += d / n;
  let v = 0;
  for (const d of draws) v += (d - mean) * (d - mean);
  const sd = Math.sqrt(v / (n - 1));
  if (!(sd > 0)) {
    throw new EngineError('The posterior draws of the tested parameter have zero spread, so no density can be estimated.', 'degenerate');
  }
  const sorted = [...draws].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(0.25 * (n - 1))];
  const q3 = sorted[Math.floor(0.75 * (n - 1))];
  const iqr = q3 - q1;
  const spread = iqr > 0 ? Math.min(sd, iqr / 1.349) : sd;
  const h = input.bandwidth ?? 0.9 * spread * Math.pow(n, -0.2); // Silverman's rule
  if (!(h > 0)) {
    throw new EngineError('The kernel bandwidth for the Savage-Dickey ordinate is not positive.', 'degenerate');
  }
  let density = 0;
  let local = 0;
  for (const d of draws) {
    const z = (point - d) / h;
    density += Math.exp(-0.5 * z * z) / (h * Math.sqrt(2 * Math.PI) * n);
    if (Math.abs(d - point) <= h) local++;
  }
  const fraction = local / n;
  const priorDensity = input.priorDensityAt(point);
  if (!(priorDensity > 0) || !Number.isFinite(priorDensity)) {
    throw new EngineError(
      `The prior density at the tested point is ${String(priorDensity)}. A Savage-Dickey ratio is undefined where the prior puts no mass, and a prior ordinate is only defined for a proper, normalised prior.`,
      'range',
    );
  }
  if (fraction < 0.005) {
    throw new EngineError(
      `Only ${(fraction * 100).toFixed(2)}% of the posterior draws lie within one bandwidth of θ = ${point}, so the posterior ordinate there would be extrapolated from the kernel tails rather than estimated. The Savage-Dickey ratio is not computable from these draws; sample the restricted region directly or use a bridge-sampling Bayes factor.`,
      'insufficient',
    );
  }
  if (!(density > 0)) {
    throw new EngineError(`The estimated posterior density at θ = ${point} is zero, so the Savage-Dickey ratio is not computable.`, 'degenerate');
  }
  const bf01 = density / priorDensity;
  const warnings = [
    'The posterior ordinate is a kernel density estimate. It is biased toward the local average of the posterior, so a sharply peaked posterior near the test point gives a slightly conservative ratio; the bandwidth used is reported.',
    'Savage-Dickey requires the prior on the remaining parameters to be independent of the tested parameter. If it is not, this ratio is not the Bayes factor.',
    ...BAYES_FACTOR_WARNINGS,
  ];
  if (fraction < 0.05) {
    warnings.push(
      `Only ${(fraction * 100).toFixed(1)}% of posterior draws are within one bandwidth of the test point, so the ordinate rests on few draws and the ratio is correspondingly uncertain.`,
    );
  }
  return {
    bayesFactorRestricted: bf01,
    logBayesFactorRestricted: Math.log(bf01),
    posteriorDensityAtPoint: density,
    priorDensityAtPoint: priorDensity,
    point,
    bandwidth: h,
    localDrawFraction: fraction,
    exactness: 'empirical',
    statement: `Savage-Dickey: BF for the restricted model (θ = ${point}) over the unrestricted one is ${bf01.toPrecision(4)}. It is the ratio of the posterior to the prior ordinate at θ = ${point}, so it inherits the prior’s width directly: a wider prior lowers the denominator and raises this ratio without the data changing.`,
    warnings,
    explanation: {
      method: 'Savage-Dickey density ratio',
      formula: 'BF₀₁ = p(θ = θ₀ | y) / p(θ = θ₀)',
      steps: [
        { label: 'Posterior ordinate (Gaussian KDE)', value: density.toPrecision(8) },
        { label: 'Bandwidth (Silverman)', value: h.toPrecision(6) },
        { label: 'Prior ordinate', value: priorDensity.toPrecision(8) },
        { label: 'BF₀₁', value: bf01.toPrecision(8) },
      ],
      assumptions: [
        'The restricted model is the unrestricted model with θ fixed at θ₀.',
        'The prior on the remaining parameters does not depend on θ.',
      ],
      limitations: warnings,
      exactness: 'empirical',
    },
  };
}
