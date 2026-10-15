/**
 * Gaussian processes, Bayesian optimisation and kriging.
 *
 * The one regression in this app that does not require the user to choose a
 * functional form, and the only one that returns a calibrated uncertainty
 * which grows where there is no data.
 *
 * Where to start:
 *
 *  - `conditionGp` + `predictGp` — exact inference given hyperparameters.
 *  - `fitHyperparameters` — multi-restart marginal-likelihood fit, with the
 *    restart spread reported so a non-identified fit is visible.
 *  - `fullyBayesianGp` — the honest alternative to a point estimate.
 *  - `bayesOptSteps` — Bayesian optimisation as a cancellable generator.
 *  - `krige` — the same mathematics in geostatistical language.
 *
 * Nothing in this directory imports from `src/ui/`, `src/app/` or `src/ai/`.
 * `fullyBayesian.ts` is the only file that depends on `src/engine/mcmc/`, and
 * `bayesopt.ts` the only one that depends on `src/engine/qmc/`.
 */
export * from './types';
export {
  KERNEL_DEFS,
  KERNEL_IDS,
  DEFAULT_KERNEL_ID,
  buildKernel,
  kernel,
  priorVariance,
  type Kernel,
  type KernelDef,
  type KernelId,
  type KernelParamSpec,
  type KernelSpec,
  type ParamSlot,
} from './kernels';
export { besselK } from './bessel';
export {
  cholesky,
  choleskyInverseDiagonal,
  choleskySolve,
  choleskySolveMatrix,
  choleskyWithJitter,
  logDetFromCholesky,
  minimizeLbfgs,
  smallestEigenvalue,
  solveLower,
  solveLowerMatrix,
  solveLowerTranspose,
  symmetricEigenvalues,
  traceCholeskySolve,
  type JitteredCholesky,
  type LbfgsOptions,
  type OptimiserResult,
} from './linalg';
export {
  ardReport,
  conditionGp,
  covarianceMatrix,
  fitHyperparameters,
  fitHyperparametersSteps,
  hyperObjective,
  looCrossValidation,
  predictGp,
  predictiveCovariance,
  priorPrediction,
  samplePosteriorFunctions,
  samplePriorFunctions,
  type FitOptions,
  type FunctionSamples,
  type GpModel,
  type GpModelRequest,
  type GpPredictionSet,
  type GpTrainingData,
  type HyperObjective,
  type LooResult,
  type MeanSpec,
  type PredictOptions,
} from './regression';
export {
  fitSparseGp,
  selectInducingPoints,
  type SparseMethod,
  type SparseModel,
  type SparseRequest,
} from './sparse';
export {
  fitGpClassifier,
  predictGpClassifier,
  type ClassPrediction,
  type GpClassificationModel,
  type GpClassificationRequest,
} from './classification';
export {
  ACQUISITION_NOTES,
  BRANIN,
  bayesOptSteps,
  candidateSet,
  expectedImprovement,
  expectedMaxOfLines,
  knowledgeGradient,
  lowerConfidenceBound,
  maximiseAcquisition,
  probabilityOfImprovement,
  runBayesOpt,
  ucbBeta,
  validateBox,
  type AcquisitionInput,
  type AcquisitionSearch,
  type AcquisitionSpec,
  type BatchStrategy,
  type BayesOptHooks,
  type BayesOptProgress,
  type BayesOptRequest,
  type BayesOptResult,
  type Box,
  type CandidateOptions,
  type ConstraintSpec,
  type Observation,
} from './bayesopt';
export {
  VARIOGRAM_MODELS,
  directionalVariograms,
  empiricalVariogram,
  fitVariogram,
  gpEquivalentOfKriging,
  krige,
  krigingVarianceMap,
  variogramToKernel,
  type EmpiricalVariogram,
  type KrigingPrediction,
  type KrigingRequest,
  type KrigingResult,
  type KrigingType,
  type VariogramBin,
  type VariogramFit,
  type VariogramModelDef,
  type VariogramModelId,
} from './kriging';
export { fullyBayesianGp, type FullyBayesianOptions, type FullyBayesianResult } from './fullyBayesian';
