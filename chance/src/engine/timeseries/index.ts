/**
 * Time-series analysis and forecasting for Orbis Chance.
 *
 * The rest of the engine treats observations as exchangeable. This module is
 * for data where the ORDER matters, which is most real data, and it exists as
 * much to correct a mistake as to add a feature: applying an i.i.d. standard
 * error to an autocorrelated series understates the uncertainty, often
 * severely. `effectiveSampleSize` quantifies by how much, and
 * `correctedMeanTest` gives the honest answer.
 *
 * Everything here refuses rather than guesses. A series shorter than the
 * requested model order, a missing observation (reported with its index), a
 * seasonal period no shorter than the series, a non-stationary fit, a
 * non-converged likelihood and a MAPE on data containing zeros each raise an
 * `EngineError` naming the problem.
 */
export type { Reported, TsInterval, TsTestResult } from './types';
export { FORECAST_CAVEATS } from './types';

export { acf, pacf, portmanteau, durbinWatson, crossCorrelation, effectiveSampleSize, correctedMeanTest } from './dependence';
export type { AcfResult, PacfResult, CrossCorrelationResult, EffectiveSampleSizeResult } from './dependence';

export {
  augmentedDickeyFuller,
  kpss,
  phillipsPerron,
  stationarityVerdict,
  difference,
  recommendDifferencing,
  centredMovingAverage,
  boxCox,
  logTransform,
} from './stationarity';
export type {
  AdfResult,
  AdfSpecification,
  KpssResult,
  KpssSpecification,
  PhillipsPerronResult,
  StationarityVerdict,
  DifferencingResult,
  DifferencingRecommendation,
  BoxCoxResult,
} from './stationarity';

export {
  classicalDecomposition,
  stl,
  loess,
  movingAverage,
  ewma,
  holt,
  holtWinters,
  smoothingForecast,
  hodrickPrescott,
} from './decomposition';
export type { DecompositionModel, DecompositionResult, StlResult, SmoothingResult, SmoothingForecast, HpFilterResult } from './decomposition';

export { fftRadix2, directDft, dft, periodogram, welch, dominantPeriod, MAX_DIRECT_DFT } from './spectral';
export type { PeriodogramResult, WelchResult, DominantPeriodResult } from './spectral';

export {
  yuleWalker,
  arConditionalLeastSquares,
  armaKalman,
  fitArima,
  psiWeights,
  forecastArima,
  selectArimaOrder,
} from './arima';
export type { ArFit, ArimaFit, ArimaForecast, KalmanOutput, OrderSelectionResult, OrderSelectionRow } from './arima';

export { jarqueBera, archTest, residualDiagnostics, garch11 } from './diagnostics';
export type { ResidualDiagnostics, Garch11Fit } from './diagnostics';

export { cusum, detectChangepoints, detectAnomalies } from './changepoint';
export type { CusumResult, ChangepointResult, Anomaly, AnomalyKind, AnomalyResult } from './changepoint';

export {
  accuracyMetrics,
  backtest,
  naiveForecaster,
  seasonalNaiveForecaster,
  meanForecaster,
  arimaForecaster,
  holtWintersForecaster,
  ewmaForecaster,
  holtForecaster,
} from './backtest';
export type { AccuracyMetrics, BacktestFold, BacktestResult, Forecaster } from './backtest';

export { blockBootstrap, compareBootstraps, defaultBlockLength } from './bootstrap';
export type { BlockBootstrapKind, BootstrapResult, BootstrapComparison } from './bootstrap';
