/**
 * Markov chain Monte Carlo for general Bayesian inference.
 *
 * Conjugate updating (`src/engine/probability/bayesian.ts`) gives exact
 * posteriors for three prior/likelihood pairs. This module gives approximate
 * posteriors for any pair, at the cost of Monte Carlo error and the need to
 * check convergence before believing anything. Results are `empirical`.
 */
export * from './types';
export {
  createSampler,
  defaultTargetAcceptance,
  numericalGradient,
  AdaptiveMetropolisSampler,
  GibbsSampler,
  HmcSampler,
  MetropolisSampler,
  SliceSampler,
  type Sampler,
} from './samplers';
export {
  CONVERGENCE_THRESHOLDS,
  assessConvergence,
  autocorrelationFunction,
  autocovariance,
  effectiveSampleSize,
  gelmanRubin,
  parameterDiagnostics,
  rankNormalise,
  rankNormalisedSplitRHat,
  splitChains,
  splitRHat,
} from './diagnostics';
export {
  SUMMARY_QUANTILES,
  equalTailedInterval,
  highestDensityInterval,
  logBayesFactor,
  marginalLikelihood,
  plotData,
  posteriorPredictive,
  summariseParameter,
  type MarginalLikelihoodResult,
} from './summaries';
export { dispersedStarts, drawsAsVectors, mcmcSteps, runMcmc, validateMcmcRequest } from './driver';
export * from './problems';
