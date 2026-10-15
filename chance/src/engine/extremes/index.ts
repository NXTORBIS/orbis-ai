/**
 * Extreme value theory: how bad can the worst case get?
 *
 * Monte Carlo percentiles cannot answer that question beyond the range they
 * simulated. Extreme value theory can, because the distribution of maxima and
 * of threshold exceedances has a limiting form with only three (or two)
 * parameters, so the tail can be extrapolated from the largest values observed
 * — provided the limit is believed, which every result here states.
 *
 * Two routes, both standard (Coles, *An Introduction to Statistical Modeling
 * of Extreme Values*, 2001):
 *   - Block maxima → generalised extreme value distribution.
 *   - Peaks over threshold → generalised Pareto distribution.
 */
export {
  type GevParams,
  type Support,
  type MomentValue,
  EULER_MASCHERONI,
  validateGev,
  gevSupport,
  gevPdf,
  gevLogPdf,
  gevCdf,
  gevSf,
  gevQuantile,
  gevSample,
  gevMean,
  gevVariance,
  gevMedian,
} from './gev';

export {
  type GpdParams,
  validateGpd,
  gpdSupport,
  gpdPdf,
  gpdLogPdf,
  gpdCdf,
  gpdSf,
  gpdLogSf,
  gpdQuantile,
  gpdSample,
  gpdMean,
  gpdVariance,
  gpdMeanExcess,
} from './gpd';

export {
  type MinimizeOptions,
  type MinimizeResult,
  nelderMead,
  numericalHessian,
  numericalGradient,
} from './optimize';

export {
  type ProfileInterval,
  type StandardErrorResult,
  gevNegLogLik,
  gpdNegLogLik,
  chiSquare1Quantile,
  invertMatrix,
  observedInformationErrors,
  profileLikelihoodInterval,
  constrainedMinimum,
} from './likelihood';

export {
  type FitDiagnostics,
  type ParameterEstimate,
  type GevFit,
  type GpdFit,
  type BlockMaximaResult,
  type PotOptions,
  MIN_BLOCK_MAXIMA,
  RECOMMENDED_BLOCK_MAXIMA,
  MIN_EXCEEDANCES,
  RECOMMENDED_EXCEEDANCES,
  blockMaxima,
  fitGev,
  fitGevBlockMaxima,
  fitGpdPot,
} from './fit';

export {
  type MeanExcessPoint,
  type MeanResidualLifePlot,
  type StabilityPoint,
  type ParameterStabilityPlot,
  type ThresholdSuggestion,
  meanResidualLifePlot,
  parameterStabilityPlot,
  suggestThreshold,
} from './threshold';

export {
  type TailIndexEstimate,
  type TailIndexPlot,
  type TailIndexPlotPoint,
  hillEstimator,
  pickandsEstimator,
  hillPlot,
} from './tailIndex';

export { type Cluster, type DeclusterResult, runsDecluster } from './declustering';

export {
  type ReturnLevelResult,
  type ReturnPeriodResult,
  type EvtRiskMeasure,
  type ReturnLevelCurvePoint,
  gpdReturnLevel,
  gpdReturnLevelYears,
  gevReturnLevel,
  gpdReturnPeriod,
  gevReturnPeriod,
  evtRiskMeasures,
  gpdReturnLevelCurve,
} from './returnLevels';

export {
  type ProbabilityPlotPoint,
  type QuantilePlotPoint,
  type DensityPoint,
  type FitDiagnosticsData,
  gevDiagnostics,
  gpdDiagnostics,
  gevReturnLevelCurve,
} from './diagnostics';
