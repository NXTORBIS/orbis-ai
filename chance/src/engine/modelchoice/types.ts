/**
 * Shared types for the predictive model comparison toolkit.
 *
 * Everything in this module answers one question: given several fitted
 * models, which should be believed for PREDICTION, and by how much more than
 * the others? The second half of that question is the important one. A
 * ranking without the standard error of the difference is not a comparison,
 * and this module refuses to produce one.
 */
import type { Exactness } from '../core/result';

/** The universal caveat attached to every comparison this module produces. */
export const MODEL_SET_CAVEAT =
  'This ranks only the models supplied. It says nothing about models that were not fitted, and none of the models in the set is likely to be true; the best of a set of wrong models is still wrong.';

export const AVERAGING_CAVEAT =
  'Averaging predictions over the model set usually predicts better than selecting one model, and selecting a single model understates uncertainty because the choice itself was estimated from the same data.';

/** A pointwise log-likelihood matrix: draws × observations. */
export interface PointwiseLogLik {
  /** logLik[s][i] = log p(y_i | theta_s). */
  readonly logLik: readonly (readonly number[])[];
}

/** One model's identity plus its pointwise log-likelihood draws. */
export interface ModelPointwise extends PointwiseLogLik {
  readonly name: string;
}

/** An information criterion evaluated for one model. */
export interface CriterionValue {
  readonly name: string;
  /** Maximised log-likelihood at the fitted parameters. */
  readonly logLikelihood: number;
  /** Number of estimated parameters. */
  readonly parameters: number;
  readonly observations: number;
  readonly aic: number;
  /** Second-order corrected AIC; null when n − k − 1 <= 0, where it is undefined. */
  readonly aicc: number | null;
  readonly bic: number;
}

export interface CriterionWeight {
  readonly name: string;
  /** Difference from the best model on this criterion (always >= 0). */
  readonly delta: number;
  /** exp(-delta/2), the relative likelihood of the model. */
  readonly relativeLikelihood: number;
  /** Normalised weight; the weights sum to 1. */
  readonly weight: number;
  /** Evidence ratio of the best model over this one. */
  readonly evidenceRatio: number;
}

export type ComparisonVerdict = 'clear' | 'weak' | 'indistinguishable';

/** Elpd-style estimate for one model, with its pointwise contributions. */
export interface ElpdEstimate {
  readonly name: string;
  readonly method: 'waic' | 'psis-loo' | 'exact-loo' | 'k-fold';
  /** Estimated expected log pointwise predictive density (higher is better). */
  readonly elpd: number;
  /** Standard error of elpd, from the spread of the pointwise terms. */
  readonly standardError: number;
  /** Pointwise elpd contributions, one per observation. */
  readonly pointwise: readonly number[];
  /** Effective number of parameters, where the method defines one. */
  readonly effectiveParameters: number | null;
  /** Information criterion on the deviance scale: -2 * elpd. */
  readonly informationCriterion: number;
  readonly exactness: Exactness;
  readonly warnings: readonly string[];
}

/** A pairwise difference, computed from PAIRED pointwise terms. */
export interface ElpdDifference {
  readonly better: string;
  readonly worse: string;
  /** elpd(better) − elpd(worse), >= 0. */
  readonly difference: number;
  /** Standard error of the difference, from the pointwise differences. */
  readonly standardError: number;
  /** sqrt(se_a^2 + se_b^2): what the standard error would be if the two models
   *  were independent. They never are, so this is always reported as the wrong
   *  number, for contrast. */
  readonly naiveStandardError: number;
  /** difference / standardError. */
  readonly zScore: number;
  readonly verdict: ComparisonVerdict;
  readonly statement: string;
}
