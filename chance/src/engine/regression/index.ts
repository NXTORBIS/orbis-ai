/**
 * Regression and predictive modelling.
 *
 * Linear models by Householder QR (never the normal equations), generalised
 * linear models by IRLS, penalised fits, basis expansions, selection search,
 * the full diagnostic set and out-of-sample assessment.
 *
 * Two things this module will not do: return a number when the estimate does
 * not exist (rank-deficient design, n ≤ p, perfect separation, a
 * non-converged optimiser, a constant response or a zero-variance predictor
 * each produce an EngineError naming the problem), and let a coefficient be
 * read as a causal effect without saying so.
 */
export type {
  AnovaTable,
  CoefficientEstimate,
  CollinearityReport,
  Column,
  DiagnosticPlots,
  InfluenceRow,
  IntervalPoint,
  LinearFit,
  LinearSpec,
  MissingReport,
  SEType,
} from './types';

export { buildDesign, designFromSpec, type Design, type DesignWithOffset } from './design';
export {
  householderQR,
  qrSolve,
  qTranspose,
  backSolve,
  forwardSolveT,
  invertUpper,
  xtxInverseFromR,
  singularValues,
  conditionNumber,
  type QR,
} from './qr';
export {
  fitLinearModel,
  finishLinearFit,
  fitCore,
  predictIntervals,
  robustStandardErrors,
  breuschPaganTest,
  whiteTest,
  durbinWatson,
  assertDesignFullRank,
  REGRESSION_LIMITATIONS,
  type FittedCore,
  type HeteroskedasticityTest,
} from './linear';
export {
  influenceMeasures,
  diagnosticPlots,
  autocorrelation,
  residualNormality,
  type AutocorrelationReport,
  type InfluenceReport,
} from './diagnostics';
export {
  leaveOneOutLinear,
  kFoldLinear,
  kFoldGeneric,
  type CrossValidationResult,
} from './crossval';
export {
  polynomialBasis,
  naturalCubicSplineBasis,
  bSplineBasis,
  type BasisExpansion,
} from './basis';
export {
  fitPenalized,
  crossValidatePenalty,
  defaultLambdaGrid,
  type PenalizedFit,
  type PenalizedSpec,
  type PenaltyKind,
  type PenaltyPath,
  type PenaltySelection,
} from './penalized';
export {
  stepwiseSelection,
  bestSubsetSelection,
  type SelectionCriterion,
  type SelectionResult,
  type SelectionSpec,
  type SelectionStep,
} from './selection';
export {
  fitGlm,
  glmFamily,
  fitNegativeBinomial,
  overdispersionCheck,
  classificationReport,
  confusionAt,
  areaUnderRoc,
  hosmerLemeshowTest,
  type ClassificationReport,
  type ConfusionMatrix,
  type FamilyName,
  type GlmCoefficient,
  type GlmFamily,
  type GlmFit,
  type GlmSpec,
  type HosmerLemeshow,
  type LinkName,
  type NegativeBinomialFit,
  type OverdispersionCheck,
} from './glm';
export { tCritical, tTwoSided, chiSquareSf, chiSquareQuantile, fSf } from './dist';
