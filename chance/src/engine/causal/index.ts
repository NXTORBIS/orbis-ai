/**
 * Causal effect estimation from observational data.
 *
 * Everything else in this application reports association. This module asks
 * the causal question explicitly, names the untestable assumptions each answer
 * depends on, and quantifies how wrong the answer would be if they fail.
 *
 * Three rules hold throughout:
 *  - no estimate is returned without its identifying assumptions, and the
 *    result constructor refuses to build one that lacks them;
 *  - a design that does not identify anything (no overlap, no matched pairs,
 *    one DiD period, an empty side of an RDD cutoff, a first stage with no
 *    variation) produces an `EngineError` naming the problem, never a number;
 *  - estimates are labelled `empirical`, sensitivity bounds `numerical`, and
 *    the Manski no-assumption bounds `exact` given the data and the outcome's
 *    logical range.
 *
 * It is the graphical module's sibling: `src/engine/bayesnet/` handles DAGs,
 * d-separation, the do-operator and the backdoor/frontdoor criteria as graph
 * properties. This one is the statistical half — what to do once a design has
 * been chosen, and how little the data alone can say.
 */

export type {
  AssumptionStatement,
  BalanceReport,
  CausalEstimate,
  CovariateBalanceRow,
  Estimand,
  EstimandDescription,
  Interval,
  OverlapReport,
  SampleAccounting,
  WeightReport,
} from './types.ts';

export {
  CONSISTENCY,
  CORE_ADJUSTMENT,
  CORRECT_OUTCOME_MODEL,
  CORRECT_PS_MODEL,
  DOUBLE_ROBUSTNESS,
  FUNDAMENTAL_PROBLEM,
  IGNORABILITY,
  ITS_COUNTERFACTUAL,
  IV_EXCLUSION,
  IV_INDEPENDENCE,
  IV_MONOTONICITY,
  IV_RELEVANCE,
  NO_ANTICIPATION,
  PARALLEL_TRENDS,
  PC_EQUIVALENCE_ONLY,
  PC_FAITHFULNESS,
  PC_MARKOV,
  PC_SUFFICIENCY,
  POSITIVITY,
  RDD_CONTINUITY,
  RDD_NO_MANIPULATION,
  SC_FIT,
  SC_NO_SPILLOVER,
  SUTVA,
  UNTESTABILITY,
  describeEstimand,
} from './assumptions.ts';

export { makeEstimate, normalInterval, accounting, twoSidedNormalP, type EstimateInput } from './build.ts';

export {
  SMD_THRESHOLD,
  balanceReport,
  covariateBalance,
  overlapReport,
  subsetMean,
  weightReport,
  type Covariate,
} from './balance.ts';

export {
  classicalVcov,
  clusterVcov,
  fitPropensity,
  leastSquares,
  robustVcovHC1,
  standardErrors,
  type LeastSquares,
  type PropensityModel,
} from './fit.ts';

export {
  coarsenedExactMatch,
  mahalanobisMatch,
  nearestNeighbourMatch,
  optimalMatch,
  propensityStrata,
  type CoarsenedMatchResult,
  type CoarsenedStratum,
  type MatchOptions,
  type MatchOrder,
  type MatchPair,
  type MatchResult,
  type PropensityStratum,
} from './matching.ts';

export {
  aipwEstimate,
  gComputation,
  ipwEstimate,
  matchedEstimate,
  naiveDifference,
  propensityWorkspace,
  stratifiedEstimate,
  tmleEstimate,
  type AdjustmentSpec,
  type AipwResult,
  type GComputationOptions,
  type GComputationResult,
  type IpwOptions,
  type IpwResult,
  type PropensityWorkspace,
  type TrimSpec,
} from './estimators.ts';

export {
  WEAK_INSTRUMENT_F,
  andersonRubinSet,
  firstStageDiagnostics,
  twoStageLeastSquares,
  waldEstimator,
  type AndersonRubinSet,
  type FirstStage,
  type IvDiagnostics,
  type IvResult,
  type IvSpec,
} from './iv.ts';

export {
  diffInDiff2x2,
  eventStudy,
  interruptedTimeSeries,
  twoWayFixedEffects,
  type EventStudyPoint,
  type EventStudyResult,
  type ItsResult,
  type PanelCovariate,
  type PanelRow,
  type TwfeResult,
} from './did.ts';

export {
  covariateSmoothness,
  imbensKalyaramanBandwidth,
  mccraryDensityTest,
  regressionDiscontinuity,
  type CovariateSmoothnessRow,
  type McCraryResult,
  type RddResult,
  type RddSpec,
} from './rdd.ts';

export { syntheticControl, type SyntheticControlResult, type SyntheticControlSpec } from './synth.ts';

export {
  cinelliHazlettSensitivity,
  eValue,
  eValueForMeanDifference,
  manskiBounds,
  negativeControlTest,
  outcomeStandardDeviation,
  rosenbaumBounds,
  standardisedDifferenceToRiskRatio,
  type CinelliHazlettResult,
  type EValueResult,
  type ManskiBoundsResult,
  type NegativeControlResult,
  type RosenbaumBound,
  type RosenbaumResult,
} from './sensitivity.ts';

export {
  fisherZTest,
  gSquareTest,
  pcAlgorithm,
  structureStability,
  type CiTestResult,
  type ContinuousDataset,
  type Cpdag,
  type Dataset,
  type DiscreteDataset,
  type StabilityReport,
} from './discovery.ts';
