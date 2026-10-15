/**
 * Elicitation: turning human judgement into a usable probability distribution,
 * and measuring whether that judgement was any good.
 *
 * The engine's `Exactness` has four values, and `assumed` — a number supplied
 * as somebody's opinion — was the one with no tooling behind it. Yet most real
 * inputs to this application are opinions. This module gives them the rigour
 * the other three already have.
 *
 * WHAT IS HERE
 * ------------
 *  - `types`       the `assumed` convention every result in this module carries,
 *                  and validation of elicited quantiles that refuses by name.
 *  - `quantiles`   least-squares fitting of a parametric family to stated
 *                  quantiles across the whole registry, with the family
 *                  sensitivity that is usually the dominant uncertainty.
 *  - `protocols`   trial roulette / chip allocation, the bisection and
 *                  fixed-interval drivers that produce the next question, the
 *                  probability wheel, and the framing effects between them.
 *  - `completion`  maximum-entropy completion of a partial judgement, and
 *                  p-boxes / credal sets when the judge gives a range instead
 *                  of a number.
 *  - `coherence`   the probability axioms, conjunction and disjunction,
 *                  subadditivity, partition dependence, anchoring and format
 *                  effects — reported, never silently repaired.
 *  - `aggregate`   linear and logarithmic opinion pools, Cooke's classical
 *                  method with equal weighting as the benchmark, correlated
 *                  (supra-Bayesian) aggregation, and disagreement measures.
 *  - `tracking`    interval hit rates and the calibration-corrected width,
 *                  proper scoring with the Murphy decomposition, PIT
 *                  histograms, Brier skill, and how little a short record says.
 *
 * EVERY result-producing function returns a value whose `exactness` is
 * `assumed` and whose `basis` names the judgement it rests on. That is the
 * point of the module: a number derived from an opinion must never be
 * presented with the authority of a measurement.
 */
export type {
  ElicitedQuantile,
  JudgementBasis,
  JudgementExactness,
  JudgementResult,
} from './types';
export {
  asJudgement,
  judgementBasis,
  JUDGEMENT_EXACTNESS,
  quantilesFromInterval,
  UNIVERSAL_ELICITATION_CAVEATS,
  validateElicitedQuantiles,
} from './types';

export type {
  FamilyProbe,
  FamilySensitivity,
  QuantileFit,
  QuantileFitOptions,
  QuantileFitResult,
  QuantileResidual,
} from './quantiles';
export { EXCLUDED_FAMILIES, fitElicitedQuantiles, fitQuantilesToFamily } from './quantiles';

export type {
  BisectionOptions,
  ChipAllocationResult,
  ChipBin,
  FixedIntervalOptions,
  Framing,
  FramingComparison,
  FramingEntry,
  FramingNote,
  NextQuestion,
  ProbabilityWheelResult,
} from './protocols';
export {
  compareFramings,
  fitChipAllocation,
  FRAMING_NOTES,
  nextBisectionQuestion,
  nextFixedIntervalQuestion,
  quantilesFromFixedInterval,
  readProbabilityWheel,
  sumProbabilities,
} from './protocols';

export type {
  ImpreciseProbabilityResult,
  ImpreciseQuantileResult,
  IntervalProbabilityJudgement,
  IntervalQuantileJudgement,
  JudgedSupport,
  MaxEntropyCompletionResult,
  PartialJudgement,
} from './completion';
export {
  elicitImpreciseProbabilities,
  elicitImpreciseQuantiles,
  maximumEntropyCompletion,
} from './completion';

export type {
  AdjustmentRule,
  AnchoredJudgement,
  AnchoringResult,
  CoherenceAdjustment,
  CoherenceViolation,
  ConjunctionAssessment,
  ConjunctionCheckResult,
  FormatComparisonResult,
  PartitionAssessment,
  PartitionCoherenceResult,
  PartitionDependenceResult,
  ProbabilityFormat,
  StatedProbability,
  SubadditivityResult,
  ViolationCode,
} from './coherence';
export {
  checkConjunction,
  checkPartitionCoherence,
  checkSubadditivity,
  COHERENCE_TOLERANCE,
  compareProbabilityFormats,
  detectAnchoring,
  detectPartitionDependence,
  FORMAT_NOTES,
} from './coherence';

export type {
  CookeExpertScore,
  CookeOptions,
  CookeResult,
  CorrelatedAggregateResult,
  CrossValidationResult,
  DisagreementResult,
  ExpertDistribution,
  ExpertEstimate,
  ExpertSeedRecord,
  PoolComparison,
  PoolKind,
  PoolOptions,
  PoolResult,
  SeedAssessment,
} from './aggregate';
export {
  comparePools,
  cookeClassicalMethod,
  correlatedExpertAggregate,
  crossValidateWeighting,
  disagreementMeasures,
  linearPool,
  logarithmicPool,
  POOL_COMPARISON_NOTE,
} from './aggregate';

export type {
  BinaryRecordResult,
  CalibrationUncertaintyResult,
  ContinuousRecordResult,
  IntervalCalibrationResult,
  IntervalDiagnosis,
  PredictiveJudgement,
  StatedInterval,
} from './tracking';
export {
  calibrationUncertainty,
  intervalCalibration,
  scoreBinaryRecord,
  scoreContinuousRecord,
} from './tracking';
