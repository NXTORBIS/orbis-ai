/**
 * Predictive model comparison: choosing between models honestly.
 *
 * The app can fit a great many models. The naive answers to "which one?" are
 * actively misleading, and each of them is a thing this module refuses to do:
 *   - In-sample fit always improves with complexity, so it cannot choose.
 *   - A Bayes factor can be dominated by a prior nobody chose, in the limit of
 *     infinite data (the Jeffreys-Lindley paradox).
 *   - A small information-criterion gap, or a WAIC/LOO difference inside the
 *     standard error of the difference, is not a preference.
 *   - Selecting a single model and reporting its uncertainty as if the
 *     selection had not happened understates the uncertainty.
 *
 * Every comparison here reports the standard error of the DIFFERENCE, says
 * plainly when two models cannot be separated, and states that it ranks only
 * the models supplied — none of which is likely to be true.
 *
 * Reuses: `core/numeric` (logSumExp), `special/gamma` (chi-square tails via
 * incompleteGamma, normalCdf, logChoose), `stats/linalg` (solve),
 * `mcmc` (bridge and importance-sampling marginal likelihoods),
 * `information` (log score, Brier, CRPS, calibration, sharpness),
 * `random/rng` (Random).
 */
export * from './types';
export { fitGeneralisedPareto, type ParetoFit } from './pareto';
export { checkLogLikMatrix, checkModelSet, MIN_DRAWS, type MatrixShape } from './validate';
export {
  NEGLIGIBLE_GAP,
  criterionWeights,
  dic,
  informationCriteria,
  type CriterionInput,
  type CriterionKind,
  type CriterionRanking,
  type DicInput,
  type DicResult,
} from './criteria';
export {
  K_BAD,
  K_GOOD,
  K_VERY_BAD,
  psisLoo,
  smoothLogWeights,
  waic,
  type PsisDiagnostics,
  type PsisLooResult,
  type SmoothedWeights,
} from './waic';
export {
  INDISTINGUISHABLE_Z,
  WEAK_Z,
  compareElpd,
  elpdDifference,
  type ComparisonTable,
} from './compare';
export {
  exactLeaveOneOut,
  kFoldCrossValidation,
  type CrossValidationResult,
  type FoldFit,
} from './crossval';
export {
  BAYES_FACTOR_WARNINGS,
  analyticEvidence,
  bayesFactor,
  bayesFactorPriorSensitivity,
  estimateEvidence,
  interpretBayesFactor,
  posteriorModelProbabilities,
  savageDickey,
  type BayesFactorResult,
  type EvidenceEstimate,
  type EvidenceStrength,
  type MarginalLikelihoodResult,
  type PosteriorModelProbability,
  type PosteriorModelProbabilityResult,
  type PriorSensitivityPoint,
  type PriorSensitivityResult,
  type SavageDickeyResult,
} from './evidence';
export {
  averagePredictiveDraws,
  bayesianModelAverage,
  pseudoBmaWeights,
  stackingWeights,
  type ModelWeights,
} from './averaging';
export {
  PPC_WARNINGS,
  posteriorPredictiveCheck,
  scoreBinaryForecast,
  scoreDistributionalForecast,
  type PosteriorPredictiveCheck,
  type ScoredBinaryForecast,
  type ScoredDistributionalForecast,
} from './predictive';
export {
  chiSquareUpperTail,
  likelihoodRatioTest,
  scoreTest,
  vuongTest,
  waldTest,
  type LikelihoodRatioInput,
  type NestedTestResult,
  type VuongResult,
} from './tests';
export { compareModels, type ModelComparison } from './toolkit';
