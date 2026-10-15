/**
 * Quasi-Monte Carlo and variance reduction.
 *
 * Two independent ways to buy accuracy without buying samples:
 *
 *  1. Replace the random points with a low-discrepancy point set (Sobol,
 *     Halton, Faure, lattice rules) or a stratified design (Latin hypercube,
 *     orthogonal arrays). For a smooth integrand of low effective dimension
 *     this moves the error from O(N^{-1/2}) towards O(N^{-1}) — a thousand-fold
 *     reduction in the samples needed for a given accuracy is routine.
 *  2. Change the estimator rather than the points: antithetic variates,
 *     control variates, importance sampling, conditioning, common random
 *     numbers, splitting.
 *
 * Three rules this module enforces rather than merely documents:
 *
 *  - A QMC point set is NOT a random stream. See `types.ts` and `QmcStream`.
 *  - Unrandomised QMC has no statistical error estimate, and a single
 *    randomised replication does not either. Only the spread across
 *    independent randomisations does. `integrate` returns
 *    `standardError: null` where that is the truth; `randomisedQmcIntegrate`
 *    gives the valid one.
 *  - Every efficiency claim is a measured number from the run that produced it.
 *    Antithetic variates and control variates both report when they did not
 *    help, including when they made things worse.
 */
export type {
  EfficiencyReport,
  ErrorBasis,
  EstimateReport,
  PointSequence,
  PointSet,
  VarianceReductionResult,
} from './types';

export { SobolSequence, sobolSequence, SOBOL_MAX_DIMENSION, type SobolOptions, type SobolRandomisation } from './sobol';
export { HaltonSequence, haltonSequence, radicalInverse, PRIMES, HALTON_MAX_DIMENSION, type HaltonOptions } from './halton';
export { FaureSequence, faureSequence, type FaureOptions } from './faure';
export { LatticeRule, latticeRule, searchLatticeGenerator, LATTICE_SEARCH_WORK_LIMIT, type LatticeOptions, type LatticeSearchResult } from './lattice';

export {
  starDiscrepancyL2,
  centredDiscrepancyL2,
  expectedRandomStarDiscrepancy,
  maxAbsPairCorrelation,
  materialise,
} from './discrepancy';

export {
  latinHypercube,
  imanConover,
  rankCorrelationMatrix,
  orthogonalArrayLhs,
  allocateStrata,
  stratifiedSample,
  equalStrata,
  systematicSample,
  uniformPointSet,
  type AllocationResult,
  type LhsOptions,
  type Stratum,
} from './stratified';

export {
  plainMonteCarlo,
  antitheticVariates,
  controlVariates,
  importanceSampling,
  tiltedNormalTailProbability,
  plainNormalTailProbability,
  conditionalMonteCarlo,
  commonRandomNumbers,
  multilevelMonteCarlo,
  russianRoulette,
  fixedEffortSplitting,
  type CrnComparison,
  type ImportanceDraw,
  type ImportanceSamplingResult,
  type Integrand,
  type MlmcResult,
  type MlmcLevelReport,
  type SplittingResult,
  type SplittingSpec,
} from './variance';

export {
  integrate,
  integrationSteps,
  randomisedQmcIntegrate,
  RQMC_WORK_LIMIT,
  integrationWork,
  QmcStream,
  type IntegrationRequest,
  type IntegrationResult,
  type IntegrationHooks,
  type IntegrationProgress,
  type MarginalSpec,
  type RqmcResult,
  type SamplerSpec,
} from './integrate';

export {
  compareConvergence,
  CONVERGENCE_WORK_LIMIT,
  convergenceWork,
  fitLogLogSlope,
  TEST_INTEGRANDS,
  type ComparisonRequest,
  type ConvergenceComparison,
  type ConvergencePoint,
  type MethodConvergence,
  type SlopeFit,
} from './convergence';
