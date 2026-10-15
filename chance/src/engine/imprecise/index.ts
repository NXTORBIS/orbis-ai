/**
 * Imprecise probability: honest mathematics for partial ignorance.
 *
 * A single probability is a commitment. When the user does not know the
 * probability, this module supplies formalisms that say so rather than
 * inventing a number:
 *
 *  - possibility theory (maxitive, ordinal plausibility);
 *  - fuzzy numbers and the extension principle (vague quantities);
 *  - Dempster–Shafer belief functions (evidence on sets, with conflict);
 *  - probability boxes (bounding CDFs, with or without a dependence assumption);
 *  - credal sets and robust Bayes (a convex set of distributions).
 *
 * Every result carries a `Provenance` naming its formalism, the question that
 * formalism answers and what accepting the result commits you to. Every
 * interval is a bound, never a point estimate.
 */
export type { Bound, Formalism, Labelled, Provenance } from './types';
export { bound, FORMALISM_COMMITMENT, FORMALISM_QUESTION, labelled, NORM_TOL, provenance } from './types';

export type { Frame } from './frame';
export {
  cardinality,
  elementIndex,
  labelsOf,
  makeFrame,
  maskOf,
  MAX_FRAME_SIZE,
  mobiusSubsets,
  subsetName,
  zetaSubsets,
  zetaSupersets,
} from './frame';

export type { AlphaCut, ConsistencyReport, PossibilisticDecision, PossibilityDistribution } from './possibility';
export {
  alphaCuts,
  checkConsistency,
  dominatedProbabilityVertices,
  makePossibility,
  MAX_VERTEX_FRAME,
  necessityOf,
  possibilisticUtility,
  possibilityFromAlphaCuts,
  possibilityInterval,
  possibilityOf,
  possibilityToProbability,
  probabilityToPossibility,
  vacuousPossibility,
} from './possibility';

export type { AlphaInterval, ExtensionMode, ExtensionOptions, FuzzyKind, FuzzyNumber, Ival } from './fuzzy';
export {
  alphaCutOf,
  alphaGrid,
  centroid,
  DEFAULT_ALPHA_LEVELS,
  discretisedFuzzy,
  extensionPrinciple,
  extensionPrinciple2,
  fuzzyAdd,
  fuzzyBinary,
  fuzzyDiv,
  fuzzyMul,
  fuzzySub,
  ivAdd,
  ivDiv,
  ivMul,
  ivSub,
  membership,
  naiveIntervalFunction,
  trapezoidalFuzzy,
  triangularFuzzy,
} from './fuzzy';

export type {
  CombinationResult,
  CommitmentOrder,
  ConflictPolicy,
  FocalSet,
  MassFunction,
  UncertaintyMeasures,
} from './belief';
export {
  averageCombine,
  bayesianMass,
  belief,
  beliefArray,
  beliefInterval,
  commitmentOrder,
  commonality,
  commonalityArray,
  consonantMassFromPossibility,
  contextualDiscount,
  dempsterCombine,
  disjunctiveCombine,
  discount,
  duboisPradeCombine,
  HIGH_CONFLICT,
  makeMass,
  massFromBelief,
  pignisticTransform,
  plausibility,
  plausibilityArray,
  possibilityFromConsonantMass,
  uncertaintyMeasures,
  vacuousMass,
  yagerCombine,
} from './belief';

export type { Dependence, DistributionBoxOptions, PBox } from './pbox';
export {
  cantelliBound,
  cdfBound,
  cdfLower,
  cdfUpper,
  cdfWidthAt,
  chebyshevBound,
  containsCdf,
  DEFAULT_PBOX_STEPS,
  DEPENDENCE_MEANING,
  exceedanceBound,
  expectationBound,
  invertCdfBounds,
  makePBox,
  markovBound,
  meanBound,
  pboxAdd,
  pboxBinary,
  pboxFromData,
  pboxFromDistribution,
  pboxFromIntervalParams,
  pboxFromMoments,
  pboxFromPossibility,
  pboxMul,
  pboxNegate,
  pboxSub,
  quantileBound,
  varianceBound,
} from './pbox';

export type {
  Assessment,
  CoherenceReport,
  CredalSet,
  IDMResult,
  IntervalTableReport,
  LinearConstraint,
  RobustPosterior,
} from './credal';
export {
  avoidsSureLoss,
  checkCoherence,
  credalFromConstraints,
  credalFromIntervals,
  credalFromVertices,
  impreciseDirichlet,
  impreciseDirichletEvent,
  MAX_CREDAL_CONSTRAINTS,
  MAX_CREDAL_ELEMENTS,
  naturalExtension,
  previsionBound,
  probabilityBound,
  reachableIntervals,
  robustPosterior,
} from './credal';
