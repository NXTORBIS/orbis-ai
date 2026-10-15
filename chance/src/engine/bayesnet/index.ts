/**
 * Discrete Bayesian networks: structure, exact inference, causal reasoning,
 * sampling and parameter learning.
 *
 * A Bayesian network is how this engine states a dependence structure instead
 * of assuming one. Nothing here assumes independence by default: every
 * independence it reports is one the stated graph entails, and d-separation
 * returns the trail along which dependence survives when it does not.
 */
export type { Factor } from './factor';
export {
  argmaxIndex,
  decodeIndex,
  encodeIndex,
  factorTotal,
  factorValueAt,
  indicatorFactor,
  makeFactor,
  marginalizeFactor,
  marginalizeTo,
  maxOutFactor,
  multiplyAll,
  multiplyFactors,
  normalizeFactor,
  reduceFactor,
  reorderFactor,
  scalarFactor,
  strides,
  tableSize,
} from './factor';

export type { DiGraph, EliminationHeuristic } from './graph';
export {
  ancestorsOf,
  childrenMap,
  descendantsOf,
  directedPaths,
  greedyEliminationOrder,
  moralGraph,
  requireAcyclic,
  topologicalOrder,
} from './graph';

export type { BayesNode, Evidence, NetworkSpec, NodeSpec } from './network';
export { BayesNet } from './network';

export type {
  EvidenceProbabilityResult,
  ExplanationAssignment,
  InferenceDiagnostics,
  InferenceOptions,
  MarginalDistribution,
  QueryResult,
} from './inference';
export {
  DEFAULT_MAX_FACTOR_ENTRIES,
  evidenceProbability,
  mapQuery,
  marginal,
  mostProbableExplanation,
  probabilityOf,
  query,
} from './inference';

export type { AllMarginalsResult, JunctionTreeStructure } from './junctionTree';
export { allMarginals, buildJunctionTree } from './junctionTree';

export type { ActivePath, DSeparationResult } from './dseparation';
export { dSeparated } from './dseparation';

export type {
  AdjustmentCheck,
  AdjustmentSearchResult,
  CausalRoles,
  FrontdoorCheck,
  InterventionComparison,
} from './causal';
export {
  backdoorAdjustedDistribution,
  causalRoles,
  checkBackdoor,
  checkFrontdoor,
  cutIncoming,
  cutOutgoing,
  doQuery,
  findBackdoorAdjustmentSets,
  interventionDistribution,
} from './causal';

export type { ForwardSamplingResult, LikelihoodWeightingResult, SampleStats } from './sampling';
export { forwardSample, forwardSamplingMarginals, likelihoodWeighting, sampleDataset } from './sampling';

export type { DataRow, LearnedParameters, LearningOptions, RowEvidenceReport } from './learning';
export { learnParameters } from './learning';

export {
  EXAMPLE_NETWORK_SPECS,
  alarmSpec,
  asiaSpec,
  confoundedTreatmentSpec,
  diagnosisChainSpec,
  exampleNetwork,
  exampleSpec,
  sprinklerSpec,
  structuresSpec,
} from './examples';
