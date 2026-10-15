/**
 * Hidden Markov models and advanced discrete-chain analysis.
 *
 * The existing Markov tooling in `stats/markov.ts` assumes the state is
 * visible. Usually it is not: you see symptoms rather than the disease,
 * readings rather than the condition of the machine, prices rather than the
 * market regime. Recovering the unobserved state from the evidence is what
 * this module is for.
 */
export type { DiscreteEmission, EmissionModel, EmissionOps, GaussianEmission, HmmModel } from './types';
export {
  backward,
  compareDecodings,
  emissionOps,
  forward,
  pathLogProbability,
  posteriors,
  predict,
  simulateHmm,
  validateHmm,
  validateObservations,
  viterbi,
  type BackwardResult,
  type DecodingComparison,
  type ForwardResult,
  type PosteriorResult,
  type PredictionResult,
  type SimulatedSequence,
  type ViterbiResult,
} from './hmm';
export {
  baumWelch,
  baumWelchSteps,
  canonicaliseStates,
  freeParameterCount,
  randomStart,
  selectStateCount,
  sequenceLogLikelihood,
  supervisedFit,
  type BaumWelchOptions,
  type BaumWelchResult,
  type BaumWelchRun,
  type ModelSelectionResult,
  type ModelSelectionRow,
  type SupervisedResult,
} from './learn';
export {
  convergenceRate,
  fundamentalMatrix,
  hittingProbabilities,
  markovPropertyTest,
  meanFirstPassageTimes,
  periodicity,
  qrEigenvalues,
  reversibility,
  selectChainOrder,
  slemByPowerMethod,
  tvDistanceToStationary,
  type Complex,
  type ConvergenceResult,
  type EigenvalueResult,
  type FundamentalMatrixResult,
  type HittingProbabilityResult,
  type MarkovOrderTestResult,
  type MeanFirstPassageResult,
  type OrderSelectionResult,
  type OrderSelectionRow,
  type PeriodicityResult,
  type PowerMethodResult,
  type ReversibilityResult,
} from './chain';
