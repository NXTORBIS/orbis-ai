/**
 * Types for state-space filtering and smoothing with CONTINUOUS latent states.
 *
 * Relationship to the rest of the engine:
 *  - `hmm/` infers a DISCRETE hidden state (forward/backward, Viterbi,
 *    Baum-Welch). Nothing here duplicates it.
 *  - `processes/` runs continuous-time processes forward. It does not condition
 *    on noisy measurements.
 *  - `timeseries/arima.ts` has a Kalman filter specialised to the ARMA state
 *    space, used for its exact likelihood. This module is the general toolkit:
 *    arbitrary A, B, C, Q, R, time-varying, missing data, smoothing, EM,
 *    non-linear and particle methods.
 *
 * Models are plain serialisable objects so the same definition runs on the main
 * thread, in the simulation worker and in tests.
 */
import type { Explanation, Exactness } from '../core/result';
import type { Mat, Vec } from './matrix';

/** A matrix that is either constant over time or supplied per time step. */
export type TimeVarying = Mat | Mat[];

/**
 * A linear-Gaussian state-space model:
 *
 *   x_t = A_t x_{t−1} + B_t u_t + w_t,   w_t ~ N(0, Q_t)
 *   y_t = C_t x_t + v_t,                 v_t ~ N(0, R_t)
 *   x_0 ~ N(mu0, Sigma0)
 *
 * The time index of the observations is 0-based; `A` and `Q` with index t are
 * the ones that carry the state from t−1 to t, and the first step uses the
 * prior (mu0, Sigma0) propagated through A_0.
 */
export interface LinearGaussianModel {
  A: TimeVarying;
  C: TimeVarying;
  Q: TimeVarying;
  R: TimeVarying;
  /** Optional control gain (n×k). Requires `controls` at run time. */
  B?: TimeVarying;
  mu0: Vec;
  Sigma0: Mat;
  stateNames?: string[];
  observationNames?: string[];
}

/**
 * One observation. `null` means the whole vector is missing at this time; a
 * `null` component means that one channel is missing while the others are not.
 * Missing data skips the corresponding part of the update and keeps the
 * prediction — it is never imputed with a zero.
 */
export type Observation = (number | null)[] | null;

/**
 * Which covariance update to use.
 *  - 'joseph'  (the default) — P = (I−KC) P (I−KC)ᵀ + K R Kᵀ. Symmetric and
 *    positive semi-definite by construction for ANY K, so rounding error
 *    cannot push it indefinite the way the short form can.
 *  - 'sqrt'    — a square-root (Cholesky) filter propagating a factor of P.
 *    The most robust of the three; roughly twice the cost.
 *  - 'naive'   — P = (I−KC) P. Provided only so the test suite can demonstrate
 *    that it fails on an ill-conditioned problem where the other two survive.
 */
export type CovarianceForm = 'joseph' | 'sqrt' | 'naive';

export interface FilterStep {
  /** One-step-ahead state prediction x_{t|t−1}. */
  predictedMean: Vec;
  /** Its covariance P_{t|t−1}: uncertainty in the STATE before the measurement. */
  predictedCov: Mat;
  /** Filtered state x_{t|t}. */
  filteredMean: Vec;
  /** Its covariance P_{t|t}: uncertainty in the STATE, not the spread of future observations. */
  filteredCov: Mat;
  /**
   * Predictive mean and covariance of the OBSERVATION, C P_{t|t−1} Cᵀ + R.
   * Reported separately and labelled separately from the state covariance,
   * because the two are different statements about different quantities.
   */
  observationPredMean: Vec | null;
  observationPredCov: Mat | null;
  /** y_t − C x_{t|t−1}; null when the observation is missing. */
  innovation: Vec | null;
  /** Innovation covariance S_t = C P Cᵀ + R (equals observationPredCov). */
  innovationCov: Mat | null;
  /** S^{−1/2}·innovation — white with identity covariance under a correct model. */
  standardisedInnovation: Vec | null;
  /** Kalman gain; null when the observation is missing. */
  gain: Mat | null;
  /** Contribution of this step to the log-likelihood; 0 for a missing observation. */
  logLikelihoodTerm: number;
  /** True when no measurement information entered at this step. */
  missing: boolean;
}

export interface KalmanFilterResult {
  steps: FilterStep[];
  /** Exact log p(y_1..y_T) under the model, by the prediction-error decomposition. */
  logLikelihood: number;
  /** Number of scalar observations that actually entered the likelihood. */
  observedCount: number;
  form: CovarianceForm;
  stateDim: number;
  obsDim: number;
  exactness: Exactness;
  explanation: Explanation;
  warnings: string[];
  /** True when a generator run was cancelled before the end of the series. */
  partial: boolean;
}

export interface KalmanSmootherResult {
  smoothedMean: Vec[];
  smoothedCov: Mat[];
  /** Cov(x_t, x_{t−1} | y_{1..T}), the lag-one covariance EM needs. Index t ≥ 1. */
  lagOneCov: Mat[];
  /** RTS gains J_t. */
  gains: Mat[];
  /** Smoothed distribution of the initial state. */
  initialMean: Vec;
  initialCov: Mat;
  logLikelihood: number;
  exactness: Exactness;
  explanation: Explanation;
  warnings: string[];
  partial: boolean;
}

export interface StructuralResult {
  /** rank [C; CA; …; CA^{n−1}] */
  observabilityRank: number;
  observable: boolean;
  /** rank [G; AG; …; A^{n−1}G] with G a factor of Q (or of B when supplied). */
  controllabilityRank: number;
  controllable: boolean;
  stateDim: number;
  /** Which state directions are invisible to the measurements, when any are. */
  unobservableDimensions: number;
  explanation: Explanation;
  warnings: string[];
}

export interface SteadyStateResult {
  /** Steady-state prediction covariance, the stabilising solution of the DARE. */
  predictedCov: Mat;
  /** Steady-state filtered (posterior) covariance. */
  filteredCov: Mat;
  /** Asymptotic Kalman gain. */
  gain: Mat;
  /** Steady-state innovation covariance. */
  innovationCov: Mat;
  iterations: number;
  /** Max |ΔP| at the last iteration. */
  residual: number;
  exactness: Exactness;
  explanation: Explanation;
  warnings: string[];
}

export interface WhitenessResult {
  /** Ljung-Box statistic on the standardised innovations (summed over channels). */
  statistic: number;
  df: number;
  pValue: number;
  lags: number;
  /** Autocorrelations of the standardised innovations, per channel. */
  autocorrelations: number[][];
  /** Sample covariance of the standardised innovations; should be the identity. */
  sampleCovariance: Mat;
  /** Max |sampleCovariance − I| over entries. */
  covarianceDeviation: number;
  /** True when the whiteness null is rejected at the requested level. */
  rejected: boolean;
  level: number;
  n: number;
  exactness: Exactness;
  explanation: Explanation;
  warnings: string[];
}

export interface NeesResult {
  /** Per-step normalised estimation error squared. */
  perStep: number[];
  mean: number;
  stateDim: number;
  /** Expected value of the mean NEES under a correct filter: the state dimension. */
  expected: number;
  /** Two-sided chi-square interval for the mean NEES at `level`. */
  interval: { low: number; high: number };
  consistent: boolean;
  level: number;
  n: number;
  exactness: Exactness;
  explanation: Explanation;
  warnings: string[];
}

export interface CoverageResult {
  /** Fraction of steps where the true state fell inside the per-component interval. */
  coverage: number[];
  nominal: number;
  n: number;
  exactness: Exactness;
  warnings: string[];
}

/** A non-linear state-space model with additive Gaussian noise. */
export interface NonlinearModel {
  /** State dimension. */
  stateDim: number;
  /** Observation dimension. */
  obsDim: number;
  /** x_t = f(x_{t−1}, t, u). */
  f(x: Vec, t: number, u?: Vec): Vec;
  /** y_t = h(x_t, t). */
  h(x: Vec, t: number): Vec;
  /** ∂f/∂x. Omit to use a numerical Jacobian, which is reported as less accurate. */
  jacobianF?(x: Vec, t: number, u?: Vec): Mat;
  /** ∂h/∂x. Omit to use a numerical Jacobian. */
  jacobianH?(x: Vec, t: number): Mat;
  Q: TimeVarying;
  R: TimeVarying;
  mu0: Vec;
  Sigma0: Mat;
  stateNames?: string[];
  observationNames?: string[];
}

export interface NonlinearFilterResult {
  steps: FilterStep[];
  /** Gaussian approximation to the log-likelihood — NOT the exact value. */
  approximateLogLikelihood: number;
  observedCount: number;
  stateDim: number;
  obsDim: number;
  /** 'ekf' or 'ukf'. */
  method: 'ekf' | 'ukf';
  /** True when any Jacobian was obtained by finite differences. */
  numericalJacobian: boolean;
  exactness: Exactness;
  explanation: Explanation;
  warnings: string[];
  partial: boolean;
}

/** State-space model for particle methods: sampling and densities, no Gaussianity. */
export interface ParticleModel {
  stateDim: number;
  obsDim: number;
  /** Draw x_0. */
  sampleInitial(normal: () => number, uniform: () => number): Vec;
  /** Draw x_t | x_{t−1}. */
  samplePropagate(x: Vec, t: number, normal: () => number, uniform: () => number): Vec;
  /** log p(y_t | x_t). Returning −Infinity is allowed (impossible observation). */
  logObservationDensity(y: Vec, x: Vec, t: number): number;
  /** Optional: E[x_t | x_{t−1}], used by the auxiliary particle filter's first stage. */
  propagateMean?(x: Vec, t: number): Vec;
  /** Optional: log p(x_t | x_{t−1}), needed by particle smoothing. */
  logTransitionDensity?(xNext: Vec, x: Vec, t: number): number;
  stateNames?: string[];
}

export type ResamplingScheme = 'multinomial' | 'stratified' | 'systematic' | 'residual';

export interface ParticleStep {
  /** Weighted particle mean — the filtered state estimate. */
  mean: Vec;
  /** Weighted particle covariance: uncertainty in the STATE. */
  covariance: Mat;
  /** Effective sample size, 1 / Σ w_i². Between 1 and N. */
  ess: number;
  /** ess / N. */
  essRatio: number;
  /** Largest single normalised weight: 1 means one particle carries everything. */
  maxWeight: number;
  /** True when resampling was triggered at this step. */
  resampled: boolean;
  /** Incremental log-likelihood estimate log(Σ w̃_i) − log N. */
  logLikelihoodIncrement: number;
}

export interface ParticleFilterResult {
  steps: ParticleStep[];
  /** Unbiased-in-expectation estimate of the log-likelihood (biased as a log). */
  logLikelihood: number;
  /** Particle count. */
  particles: number;
  /** Times at which resampling happened. */
  resampleTimes: number[];
  /** Minimum ESS over the run, and where it happened. */
  minEss: number;
  minEssTime: number;
  /** Steps whose ESS ratio fell below the degeneracy threshold. */
  degenerateSteps: number[];
  scheme: ResamplingScheme;
  method: 'bootstrap' | 'auxiliary' | 'sir' | 'rao-blackwellised';
  /** Final particle cloud and weights, for smoothing or continuation. */
  finalParticles: Vec[];
  finalWeights: number[];
  /** Monte Carlo standard error of each final state component. */
  monteCarloStandardError: Vec;
  /** Per-step particle clouds and normalised weights, kept only when asked for. */
  history?: { particles: Vec[][]; weights: number[][] };
  /** Full ancestral trajectories, kept only when asked for. */
  trajectories?: Vec[][];
  /** Online fixed-lag smoothed moments, produced during the run when a lag was requested. */
  fixedLag?: { lag: number; mean: Vec[]; covariance: Mat[]; distinctAncestors: number[] };
  exactness: Exactness;
  explanation: Explanation;
  warnings: string[];
  partial: boolean;
}

export interface ParticleSmootherResult {
  /** Backward-sampled trajectories; trajectories[j][t] is a state vector. */
  trajectories: Vec[][];
  /** Posterior mean at each time from the smoothed trajectories. */
  smoothedMean: Vec[];
  smoothedCov: Mat[];
  method: 'ffbs' | 'fixed-lag';
  /** Fixed-lag smoothers only. */
  lag?: number;
  exactness: Exactness;
  explanation: Explanation;
  warnings: string[];
  partial: boolean;
}

export interface EmResult {
  model: LinearGaussianModel;
  /** Log-likelihood after every iteration, in order. */
  logLikelihoodPath: number[];
  logLikelihood: number;
  iterations: number;
  converged: boolean;
  /** Set when an iteration DECREASED the log-likelihood, which EM cannot do. */
  monotonicityViolations: { iteration: number; decrease: number }[];
  exactness: Exactness;
  explanation: Explanation;
  warnings: string[];
  partial: boolean;
}

/** Progress report yielded by the generator-based long runs. */
export interface FilterProgress {
  completed: number;
  total: number;
}

export interface RunControl {
  /** Steps processed between yields. */
  chunk?: number;
  /** Checked between chunks; returning true stops the run and marks it partial. */
  isCancelled?(): boolean;
}

export function explainFiltering(
  method: string,
  exactness: Exactness,
  steps: { label: string; expression?: string; value?: string }[],
  assumptions: string[],
  limitations: string[],
  formula?: string,
): Explanation {
  return { method, formula, steps, assumptions, limitations, exactness };
}
