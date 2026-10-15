/**
 * State-space filtering and smoothing for CONTINUOUS latent states.
 *
 * The question this module answers is the one a noisy measured system actually
 * raises: given everything observed so far, where is the system now, and where
 * is it going? `processes/` runs a model forward but never conditions on data;
 * `hmm/` conditions on data but only for a discrete hidden state;
 * `timeseries/arima.ts` has a Kalman filter tied to the ARMA state space for
 * its likelihood. None of them filters a general continuous state, which is
 * what this does.
 *
 * Exactness, as the project requires it:
 *  - Kalman filter and RTS smoother on a linear-Gaussian model: `exact`
 *    (closed-form conditional Gaussians, up to floating point).
 *  - EKF and UKF: `numerical`, and they carry their approximation caveat in
 *    the result, not only in a comment.
 *  - Particle methods: `empirical`, with the effective sample size and the
 *    Monte Carlo standard error reported at every step.
 */
export type {
  CovarianceForm,
  CoverageResult,
  EmResult,
  FilterProgress,
  FilterStep,
  KalmanFilterResult,
  KalmanSmootherResult,
  LinearGaussianModel,
  NeesResult,
  NonlinearFilterResult,
  NonlinearModel,
  Observation,
  ParticleFilterResult,
  ParticleModel,
  ParticleSmootherResult,
  ParticleStep,
  ResamplingScheme,
  RunControl,
  SteadyStateResult,
  StructuralResult,
  TimeVarying,
  WhitenessResult,
} from './types';

export type { Mat, Vec } from './matrix';
export {
  cholesky,
  choleskyOrThrow,
  conditionNumberSym,
  inverseSPD,
  logDetSPD,
  matrixRank,
  mvnLogPdf,
  psdCholesky,
  qrR,
  symmetricEigenvalues,
  symmetrise,
} from './matrix';

export {
  accessModel,
  informationMatrix,
  kalmanFilter,
  kalmanFilterSteps,
  kalmanLogLikelihood,
  kalmanSmoother,
  kalmanSmootherSteps,
  steadyStateGain,
  structuralAnalysis,
  type KalmanOptions,
  type ModelAccess,
} from './kalman';

export {
  extendedKalmanFilter,
  extendedKalmanSteps,
  numericalJacobian,
  unscentedKalmanFilter,
  unscentedKalmanSteps,
  type NonlinearOptions,
  type UnscentedParameters,
} from './nonlinear';

export {
  auxiliaryParticleFilter,
  bootstrapParticleFilter,
  effectiveSampleSize,
  fixedLagSmoother,
  particleFilter,
  particleSmootherFFBS,
  raoBlackwellisedParticleFilter,
  resampleIndices,
  sequentialImportanceResamplingSteps,
  type ConditionalLinearBlock,
  type ParticleOptions,
  type RaoBlackwellisedModel,
  type RaoBlackwellisedResult,
  type SirOptions,
} from './particle';

export {
  chiSquareQuantile,
  chiSquareUpperTail,
  innovationWhiteness,
  intervalCoverage,
  nees,
  stateDimensionOf,
} from './diagnostics';

export {
  defaultStart,
  emSteps,
  fitByEm,
  maximiseLikelihood,
  maximiseLikelihoodSteps,
  type DirectFitResult,
  type EmOptions,
  type EmUpdateFlags,
} from './em';

export { simulateLinearGaussian, simulateNonlinear, type SimulatedSeries } from './simulate';

export {
  FILTERING_MODELS,
  constantVelocityTracker,
  gaussianObservationLogDensity,
  linearGaussianAsParticleModel,
  localLevel,
  localLinearTrend,
  noisyPendulum,
  stochasticVolatility,
  univariateGrowth,
  type ConstantVelocityConfig,
  type FilteringModelEntry,
  type GrowthConfig,
  type LocalLevelConfig,
  type LocalLinearTrendConfig,
  type PendulumConfig,
  type StochasticVolatilityConfig,
} from './models';
