/**
 * Shared types for the regression and predictive-modelling module.
 *
 * Regression measures association, never causation. Every fit returned from
 * this module carries that statement in `limitations`, together with the fact
 * that each coefficient is conditional on the model's functional form and on
 * exactly which other variables were included. Omitted-variable bias is the
 * rule rather than the exception, so a coefficient here is "the association
 * that remains after adjusting for the listed variables", nothing more.
 */
import type { Exactness } from '../core/result';

/** A named predictor column. */
export interface Column {
  name: string;
  values: readonly (number | null | undefined)[];
}

/** Input for a linear model fit. */
export interface LinearSpec {
  y: readonly (number | null | undefined)[];
  /** Response name, used in the explanation text only. */
  yName?: string;
  predictors: readonly Column[];
  /** Include an intercept column of ones (default true). */
  intercept?: boolean;
  /** Observation weights for weighted least squares (all > 0). */
  weights?: readonly (number | null | undefined)[];
  /** Confidence level for intervals (default 0.95). */
  level?: number;
  /**
   * Which standard errors the reported inference uses.
   * 'classical' assumes constant error variance; HC0–HC3 do not.
   */
  seType?: SEType;
}

export type SEType = 'classical' | 'HC0' | 'HC1' | 'HC2' | 'HC3';

export interface CoefficientEstimate {
  name: string;
  estimate: number;
  stdError: number;
  tStatistic: number;
  pValue: number;
  ciLow: number;
  ciHigh: number;
}

export interface AnovaTable {
  /** Σ (ŷ − ȳ)² — variation the model accounts for. */
  regressionSS: number;
  /** Σ (y − ŷ)² — variation left over. */
  residualSS: number;
  /** Σ (y − ȳ)². */
  totalSS: number;
  regressionDf: number;
  residualDf: number;
  totalDf: number;
  regressionMS: number;
  residualMS: number;
  fStatistic: number;
  fPValue: number;
}

export interface CollinearityReport {
  /** Condition number of the design matrix (ratio of largest to smallest singular value). */
  conditionNumber: number;
  /** Variance inflation factor per non-intercept predictor. */
  vif: { name: string; value: number }[];
  warnings: string[];
}

/** Residual-and-influence measures, one entry per retained observation. */
export interface InfluenceRow {
  index: number;
  fitted: number;
  residual: number;
  /** Diagonal of the hat matrix. */
  leverage: number;
  standardisedResidual: number;
  /** Externally studentised (observation i excluded from the variance estimate). */
  studentisedResidual: number;
  cooksDistance: number;
  dffits: number;
  /** Change in each coefficient when observation i is dropped, in SE units. */
  dfbetas: number[];
  flags: string[];
}

export interface DiagnosticPlots {
  residualsVsFitted: { x: number; y: number }[];
  /** Theoretical normal quantile against the ordered standardised residual. */
  qq: { x: number; y: number }[];
  /** √|standardised residual| against the fitted value. */
  scaleLocation: { x: number; y: number }[];
  residualsVsLeverage: { x: number; y: number }[];
}

export interface IntervalPoint {
  /** Predictor values used (excluding the intercept). */
  x: number[];
  fit: number;
  /** Interval for the mean response at these predictor values. */
  meanLow: number;
  meanHigh: number;
  /** Interval for a single new observation at these predictor values. */
  predictionLow: number;
  predictionHigh: number;
}

export interface MissingReport {
  /** Rows supplied. */
  suppliedRows: number;
  /** Rows dropped because the response, a predictor or the weight was missing. */
  droppedRows: number;
  rowsUsed: number;
}

export interface LinearFit {
  kind: 'ols' | 'wls' | 'ridge' | 'lasso' | 'elasticnet';
  yName: string;
  coefficients: CoefficientEstimate[];
  /** Coefficient vector in the same order as `coefficients`. */
  beta: number[];
  hasIntercept: boolean;
  n: number;
  /** Number of estimated coefficients, intercept included. */
  p: number;
  fitted: number[];
  residuals: number[];
  /** Diagonal of the hat matrix for the (possibly weighted) design. */
  leverage: number[];
  rSquared: number;
  adjustedRSquared: number;
  residualStandardError: number;
  sigmaSquared: number;
  logLikelihood: number;
  aic: number;
  bic: number;
  anova: AnovaTable;
  collinearity: CollinearityReport;
  /** (XᵀX)⁻¹ for the weighted design; the basis of every standard error. */
  xtxInverse: number[][];
  seType: SEType;
  /** Classical standard errors, always reported for comparison. */
  classicalStdErrors: number[];
  /** HC0–HC3 heteroskedasticity-robust standard errors. */
  robustStdErrors: Record<'HC0' | 'HC1' | 'HC2' | 'HC3', number[]>;
  level: number;
  missing: MissingReport;
  durbinWatson: number;
  exactness: Exactness;
  /** True when inference (SEs, p-values) is valid for this fit. False for penalised fits. */
  inferenceValid: boolean;
  warnings: string[];
  limitations: string[];
}
