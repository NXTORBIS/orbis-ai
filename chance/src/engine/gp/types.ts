/**
 * Gaussian processes: shared types, limits and labels.
 *
 * ## What a Gaussian process is for, in this app
 *
 * Every other regression here asks the user to choose a functional form. A
 * Gaussian process does not: it places a distribution directly over functions
 * and returns, for every input, a predictive distribution whose width grows
 * where there is no data. That is the whole point of the module — it is the
 * only regression in the app that knows what it does not know.
 *
 * ## Two different intervals, never merged
 *
 * A GP produces two intervals at every test point and they mean different
 * things:
 *
 *  - the **latent credible interval** for f(x), the unknown function value.
 *    Its variance is kᵗ-corrected prior variance only.
 *  - the **predictive interval** for a NEW NOISY OBSERVATION y(x) = f(x) + ε.
 *    Its variance is the latent variance PLUS the observation-noise variance.
 *
 * The predictive interval is strictly wider whenever the noise variance is
 * positive. Reporting one when the user wanted the other is a real and common
 * error, so both are always returned and both are labelled.
 *
 * ## Exactness
 *
 *  - Given the hyperparameters, the predictive mean and variance are `exact`:
 *    they are the closed-form conditional of a joint Gaussian.
 *  - Hyperparameter point estimates, acquisition maximisation and variogram
 *    fits are `numerical` (iterative optimisation).
 *  - Sparse approximations are `numerical` and carry an explicit bias
 *    direction.
 *  - Sampled functions, Monte-Carlo-averaged fully Bayesian predictions and
 *    Bayesian-optimisation traces are `empirical`.
 */
import type { Exactness } from '../core/result';

/**
 * Hard limits. An exact GP is O(n³) in time and O(n²) in memory; this module
 * refuses rather than freezing the browser, and names the limit when it does.
 */
export const GP_LIMITS = {
  /** Default refusal threshold for exact inference. */
  maxExactN: 1200,
  /** The largest n this module will accept even with an explicit override. */
  absoluteMaxN: 4000,
  /** Test points scored in one prediction call. */
  maxPredictPoints: 50000,
  /** Jitter escalation steps before the covariance matrix is declared non-PD. */
  maxJitterAttempts: 12,
} as const;

/** Bytes held by a dense n×n float64 covariance matrix (plus its factor). */
export function covarianceMemoryBytes(n: number): number {
  // K and its Cholesky factor are both stored: 2·n²·8 bytes.
  return 2 * n * n * 8;
}

export function describeBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Which statement an interval makes. They are never interchangeable. */
export type IntervalKind = 'latent-credible' | 'predictive';

export const INTERVAL_LABEL: Record<IntervalKind, string> = {
  'latent-credible': 'Credible interval for the latent function f(x)',
  predictive: 'Predictive interval for a new noisy observation y(x)',
};

export interface GpInterval {
  readonly kind: IntervalKind;
  /** Nominal central mass, e.g. 0.95. */
  readonly level: number;
  readonly lower: number;
  readonly upper: number;
  readonly label: string;
}

export interface GpPrediction {
  readonly x: readonly number[];
  /** Posterior mean of the latent function. Also the mean of a new y. */
  readonly mean: number;
  /** Var[f(x) | data]. Excludes observation noise. */
  readonly latentVariance: number;
  readonly latentSd: number;
  readonly latentInterval: GpInterval;
  /** Var[y(x) | data] = latentVariance + noiseVariance. */
  readonly predictiveVariance: number;
  readonly predictiveSd: number;
  readonly predictiveInterval: GpInterval;
  /** The noise variance assumed for a new observation at this input. */
  readonly noiseVariance: number;
}

/** What jitter had to be added to factorise (K + σ²I), and why. */
export interface JitterReport {
  /** Jitter actually added to the diagonal. 0 when none was needed. */
  readonly added: number;
  /** Jitter values tried before one succeeded. */
  readonly attempts: readonly number[];
  /** True when any jitter at all was needed. */
  readonly needed: boolean;
  /**
   * Honest statement of what the jitter did. Jitter is extra assumed noise;
   * a result that needed it is not the result for the model as specified.
   */
  readonly note: string;
}

export interface ArdEntry {
  readonly dimension: number;
  readonly lengthScale: number;
  /** 1 / lengthScale — larger means the output varies faster in this input. */
  readonly relevance: number;
  /** relevance normalised to sum to 1 across dimensions. */
  readonly relevanceShare: number;
  readonly rank: number;
}

export interface ArdReport {
  readonly entries: readonly ArdEntry[];
  readonly exactness: Exactness;
  readonly note: string;
  readonly limitations: readonly string[];
}

/** One restart of the marginal-likelihood optimiser. */
export interface RestartOutcome {
  readonly restart: number;
  readonly startLog: readonly number[];
  readonly finalLog: readonly number[];
  readonly logMarginalLikelihood: number;
  readonly converged: boolean;
  readonly iterations: number;
  readonly reason: string;
}

export interface FitReport {
  readonly restarts: number;
  readonly convergedRestarts: number;
  readonly best: RestartOutcome;
  readonly outcomes: readonly RestartOutcome[];
  /** Spread of the attained log marginal likelihood across converged restarts. */
  readonly logMarginalLikelihoodRange: readonly [number, number];
  readonly logMarginalLikelihoodSd: number;
  /**
   * False when restarts reached materially different optima: the marginal
   * likelihood is multimodal here and the point estimate is not identified.
   */
  readonly identifiable: boolean;
  readonly note: string;
  readonly exactness: Exactness;
}
