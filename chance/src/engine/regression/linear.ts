/**
 * Linear models: ordinary and weighted least squares with full inference,
 * solved by Householder QR.
 *
 * Reported honestly, which for regression means:
 *  - a coefficient is an association, conditional on the model's form and on
 *    exactly the other variables included; it is not a causal effect;
 *  - the interval for the mean response and the interval for a new
 *    observation are different statements and are labelled separately;
 *  - collinearity is measured and warned about, because it can make an
 *    individual coefficient meaningless while the model still predicts well;
 *  - a rank-deficient design is refused, naming the dependent columns, rather
 *    than silently returning one of infinitely many solutions.
 */
import { EngineError } from '../core/result';
import { mean } from '../stats/descriptive';
import { stableSum } from '../core/numeric';
import {
  conditionNumber,
  householderQR,
  invertUpper,
  qrSolve,
  qTranspose,
  xtxInverseFromR,
  type QR,
} from './qr';
import { chiSquareSf, fSf, tCritical, tTwoSided } from './dist';
import { designFromSpec, type DesignWithOffset } from './design';
import type {
  AnovaTable,
  CoefficientEstimate,
  CollinearityReport,
  IntervalPoint,
  LinearFit,
  LinearSpec,
  SEType,
} from './types';

export const REGRESSION_LIMITATIONS: string[] = [
  'Regression measures association, not causation. A non-zero coefficient means the response and the predictor move together in this data after adjusting for the other variables listed; it does not mean changing the predictor would change the response.',
  'Every coefficient is conditional on the functional form assumed here and on exactly which variables were included. Add or remove a variable and the remaining coefficients generally change, sometimes sign. Omitted-variable bias is the rule, not the exception.',
  'The inference below assumes the errors are independent of each other and of the predictors. Clustered, time-ordered or spatially related data violates this and makes the standard errors too small.',
  'R² describes this sample. It is not a measure of predictive performance; read the cross-validated figures for that.',
];

/** Scale each row by √w so that ordinary QR solves the weighted problem. */
function weightedDesign(X: readonly (readonly number[])[], y: readonly number[], w: readonly number[]) {
  const n = X.length;
  const Xw: number[][] = new Array<number[]>(n);
  const yw = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const s = Math.sqrt(w[i]);
    Xw[i] = X[i].map((v) => v * s);
    yw[i] = y[i] * s;
  }
  return { Xw, yw };
}

/**
 * Name the linear dependency behind a collapsed pivot: regress the offending
 * column on the columns that preceded it and report the ones it actually
 * involves. Without this the user is told only "singular matrix", which is
 * the single least useful message a regression tool can produce.
 */
function describeDependency(X: readonly (readonly number[])[], names: readonly string[], k: number): string {
  const target = X.map((row) => row[k]);
  if (k === 0) {
    return `Column "${names[0]}" is identically zero, so it carries no information.`;
  }
  const prior = X.map((row) => row.slice(0, k));
  try {
    const qr = householderQR(prior);
    if (qr.rank === qr.p) {
      const coef = qrSolve(qr, target);
      const involved: string[] = [];
      for (let j = 0; j < k; j++) {
        if (Math.abs(coef[j]) > 1e-8) involved.push(`${coef[j].toPrecision(6)}·${names[j]}`);
      }
      if (involved.length) {
        return `Column "${names[k]}" is an exact linear combination of the earlier columns: ${names[k]} = ${involved.join(' + ')}. Drop one of the columns involved.`;
      }
    }
  } catch {
    // Fall through to the generic message below.
  }
  return `Column "${names[k]}" is a linear combination of the columns before it (${names.slice(0, k).join(', ')}). Drop one of the columns involved.`;
}

/** Refuse a rank-deficient design, naming the dependent columns. */
export function assertFullRank(qr: QR, X: readonly (readonly number[])[], names: readonly string[]): void {
  if (qr.rank === qr.p) return;
  const messages = qr.dependentColumns.map((k) => describeDependency(X, names, k));
  throw new EngineError(
    [
      {
        code: 'singular',
        message: `The design matrix is rank deficient (rank ${qr.rank} of ${qr.p}), so the coefficients are not uniquely determined: infinitely many coefficient vectors fit the data identically well. ${messages.join(' ')}`,
      },
    ],
  );
}

/** Rank-check a design matrix directly, naming any dependent column. */
export function assertDesignFullRank(X: readonly (readonly number[])[], names: readonly string[]): void {
  assertFullRank(householderQR(X), X, names);
}

/** Variance inflation factor for each non-intercept column. */
function varianceInflation(
  X: readonly (readonly number[])[],
  names: readonly string[],
  hasIntercept: boolean,
): { name: string; value: number }[] {
  const p = names.length;
  const start = hasIntercept ? 1 : 0;
  const out: { name: string; value: number }[] = [];
  if (p - start < 2) return out;
  for (let j = start; j < p; j++) {
    const target = X.map((row) => row[j]);
    const others = X.map((row) => {
      const r: number[] = hasIntercept ? [1] : [];
      for (let q = start; q < p; q++) if (q !== j) r.push(row[q]);
      return r;
    });
    let value = Number.NaN;
    try {
      const qr = householderQR(others);
      if (qr.rank === qr.p) {
        const beta = qrSolve(qr, target);
        const fit = others.map((row) => row.reduce((s, v, i) => s + v * beta[i], 0));
        const ybar = mean(target);
        const rss = stableSum(target.map((v, i) => (v - fit[i]) ** 2));
        const tss = stableSum(target.map((v) => (v - ybar) ** 2));
        // VIF_j = 1/(1 − R²_j) = TSS_j / RSS_j for the regression of column j
        // on the other predictors. Written as the ratio of sums of squares so
        // that a near-perfect auxiliary fit gives a large finite number rather
        // than a catastrophic 1/0.
        value = tss > 0 ? tss / Math.max(rss, Number.MIN_VALUE) : Infinity;
      }
    } catch {
      value = Infinity;
    }
    out.push({ name: names[j], value });
  }
  return out;
}

function collinearityReport(
  R: readonly (readonly number[])[],
  X: readonly (readonly number[])[],
  names: readonly string[],
  hasIntercept: boolean,
): CollinearityReport {
  const cond = conditionNumber(R);
  const vif = varianceInflation(X, names, hasIntercept);
  const warnings: string[] = [];
  const high = vif.filter((v) => v.value >= 10);
  const moderate = vif.filter((v) => v.value >= 5 && v.value < 10);
  if (high.length) {
    warnings.push(
      `Severe collinearity: variance inflation factor ≥ 10 for ${high
        .map((v) => `${v.name} (VIF ${v.value.toPrecision(4)})`)
        .join(', ')}. These predictors carry nearly the same information, so the model can predict well while the individual coefficients are close to meaningless — their standard errors are inflated by roughly √VIF and their signs can flip on a small change in the data. Do not interpret them separately.`,
    );
  } else if (moderate.length) {
    warnings.push(
      `Moderate collinearity: VIF between 5 and 10 for ${moderate
        .map((v) => `${v.name} (VIF ${v.value.toPrecision(4)})`)
        .join(', ')}. The individual coefficients are less stable than their standard errors alone suggest.`,
    );
  }
  if (cond > 1e3) {
    warnings.push(
      `The design matrix has condition number ${cond.toPrecision(5)}. Above about 1000 the predictors are nearly linearly dependent; this fit is solved by QR decomposition rather than the normal equations precisely so that such a design does not lose half its significant digits, but the statistical instability remains.`,
    );
  }
  return { conditionNumber: cond, vif, warnings };
}

/** Sandwich standard errors that do not assume constant error variance. */
export function robustStandardErrors(
  Xw: readonly (readonly number[])[],
  xtxInv: readonly (readonly number[])[],
  residualsWeighted: readonly number[],
  leverage: readonly number[],
  type: 'HC0' | 'HC1' | 'HC2' | 'HC3',
): number[] {
  const n = Xw.length;
  const p = xtxInv.length;
  const omega = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const e2 = residualsWeighted[i] * residualsWeighted[i];
    const h = Math.min(leverage[i], 1 - 1e-12);
    switch (type) {
      case 'HC0':
        omega[i] = e2;
        break;
      case 'HC1':
        omega[i] = (e2 * n) / (n - p);
        break;
      case 'HC2':
        omega[i] = e2 / (1 - h);
        break;
      case 'HC3':
        omega[i] = e2 / ((1 - h) * (1 - h));
        break;
    }
  }
  // meat = Xᵀ Ω X
  const meat: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  for (let i = 0; i < n; i++) {
    const row = Xw[i];
    const o = omega[i];
    for (let a = 0; a < p; a++) {
      const ra = row[a] * o;
      for (let b = a; b < p; b++) meat[a][b] += ra * row[b];
    }
  }
  for (let a = 0; a < p; a++) for (let b = 0; b < a; b++) meat[a][b] = meat[b][a];
  // V = (XᵀX)⁻¹ meat (XᵀX)⁻¹
  const tmp: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  for (let a = 0; a < p; a++)
    for (let b = 0; b < p; b++) {
      let s = 0;
      for (let k = 0; k < p; k++) s += xtxInv[a][k] * meat[k][b];
      tmp[a][b] = s;
    }
  const se = new Array<number>(p).fill(0);
  for (let a = 0; a < p; a++) {
    let s = 0;
    for (let k = 0; k < p; k++) s += tmp[a][k] * xtxInv[k][a];
    se[a] = Math.sqrt(Math.max(0, s));
  }
  return se;
}

export interface FittedCore {
  design: DesignWithOffset;
  qr: QR;
  Xw: number[][];
  beta: number[];
  fitted: number[];
  residuals: number[];
  leverage: number[];
  xtxInv: number[][];
  rss: number;
  n: number;
  p: number;
}

/** Shared least-squares core: QR solve plus the quantities every report needs. */
export function fitCore(design: DesignWithOffset): FittedCore {
  const { X, y, w, names } = design;
  const { Xw, yw } = weightedDesign(X, y, w);
  const qr = householderQR(Xw);
  assertFullRank(qr, Xw, names);
  const beta = qrSolve(qr, yw);
  const n = X.length;
  const p = names.length;
  const fitted = new Array<number>(n);
  const residuals = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < p; j++) s += X[i][j] * beta[j];
    fitted[i] = s;
    residuals[i] = y[i] - s;
  }
  const leverage = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < p; j++) s += qr.Q[i][j] * qr.Q[i][j];
    leverage[i] = s;
  }
  const xtxInv = xtxInverseFromR(qr.R);
  const rss = stableSum(residuals.map((e, i) => w[i] * e * e));
  return { design, qr, Xw, beta, fitted, residuals, leverage, xtxInv, rss, n, p };
}

function anovaTable(core: FittedCore, hasIntercept: boolean): AnovaTable {
  const { design, fitted, rss, n, p } = core;
  const { y, w } = design;
  const wsum = stableSum(w);
  const ybar = hasIntercept ? stableSum(y.map((v, i) => w[i] * v)) / wsum : 0;
  const totalSS = hasIntercept
    ? stableSum(y.map((v, i) => w[i] * (v - ybar) ** 2))
    : stableSum(y.map((v, i) => w[i] * v * v));
  const regressionSS = hasIntercept
    ? stableSum(fitted.map((v, i) => w[i] * (v - ybar) ** 2))
    : stableSum(fitted.map((v, i) => w[i] * v * v));
  const regressionDf = hasIntercept ? p - 1 : p;
  const residualDf = n - p;
  const regressionMS = regressionDf > 0 ? regressionSS / regressionDf : Number.NaN;
  const residualMS = rss / residualDf;
  const fStatistic = regressionDf > 0 ? (residualMS > 0 ? regressionMS / residualMS : Infinity) : Number.NaN;
  const fPValue = Number.isFinite(fStatistic)
    ? fSf(fStatistic, regressionDf, residualDf)
    : Number.isNaN(fStatistic)
      ? Number.NaN
      : 0;
  return {
    regressionSS,
    residualSS: rss,
    totalSS,
    regressionDf,
    residualDf,
    totalDf: hasIntercept ? n - 1 : n,
    regressionMS,
    residualMS,
    fStatistic,
    fPValue,
  };
}

/** Durbin–Watson statistic for first-order autocorrelation of the residuals. */
export function durbinWatson(residuals: readonly number[]): number {
  const n = residuals.length;
  if (n < 2) return Number.NaN;
  let num = 0;
  for (let i = 1; i < n; i++) num += (residuals[i] - residuals[i - 1]) ** 2;
  const den = stableSum(residuals.map((e) => e * e));
  return den > 0 ? num / den : Number.NaN;
}

/** Fit an ordinary or weighted least-squares model with full inference. */
export function fitLinearModel(spec: LinearSpec): LinearFit {
  const design = designFromSpec(spec);
  return finishLinearFit(design, spec);
}

export function finishLinearFit(design: DesignWithOffset, spec: Omit<LinearSpec, 'y' | 'predictors'>): LinearFit {
  const level = spec.level ?? 0.95;
  if (!(level > 0 && level < 1)) throw new EngineError('The confidence level must be between 0 and 1.', 'range');
  const seType: SEType = spec.seType ?? 'classical';
  const core = fitCore(design);
  const { n, p, rss, beta, fitted, residuals, leverage, xtxInv, Xw } = core;
  const { w, names, hasIntercept } = design;
  const df = n - p;
  const sigmaSq = rss / df;
  const sigma = Math.sqrt(sigmaSq);
  const warnings = [...design.warnings];

  const classicalSE = new Array<number>(p);
  for (let j = 0; j < p; j++) classicalSE[j] = Math.sqrt(Math.max(0, sigmaSq * xtxInv[j][j]));
  const residualsWeighted = residuals.map((e, i) => e * Math.sqrt(w[i]));
  const robust = {
    HC0: robustStandardErrors(Xw, xtxInv, residualsWeighted, leverage, 'HC0'),
    HC1: robustStandardErrors(Xw, xtxInv, residualsWeighted, leverage, 'HC1'),
    HC2: robustStandardErrors(Xw, xtxInv, residualsWeighted, leverage, 'HC2'),
    HC3: robustStandardErrors(Xw, xtxInv, residualsWeighted, leverage, 'HC3'),
  };
  const usedSE = seType === 'classical' ? classicalSE : robust[seType];

  // "Exactly zero" must be judged on the scale of the data: a design that
  // interpolates leaves residuals of rounding size, not of literal size 0.
  const responseScale = stableSum(design.y.map((v, i) => w[i] * v * v));
  const exactFit = rss <= 1e-24 * Math.max(responseScale, 1);
  if (exactFit) {
    warnings.push(
      'The residuals are exactly zero to within rounding error: the model reproduces the data perfectly. The residual variance is 0, so there is nothing left to estimate the standard errors from — they are reported as exactly 0 and no p-value is meaningful. With p coefficients and p+… points this usually means the model is interpolating rather than describing anything.',
    );
  }

  const tcrit = tCritical(level, df);
  const coefficients: CoefficientEstimate[] = names.map((name, j) => {
    const est = beta[j];
    const se = usedSE[j];
    let t: number;
    let pv: number;
    if (se > 0) {
      t = est / se;
      pv = tTwoSided(t, df);
    } else if (est === 0) {
      // 0/0 — no information either way. Reported as a zero statistic with p = 1,
      // never as NaN.
      t = 0;
      pv = 1;
    } else {
      t = est > 0 ? Infinity : -Infinity;
      pv = 0;
    }
    return {
      name,
      estimate: est,
      stdError: se,
      tStatistic: t,
      pValue: pv,
      ciLow: est - tcrit * se,
      ciHigh: est + tcrit * se,
    };
  });

  const anova = anovaTable(core, hasIntercept);
  const rSquared = anova.totalSS > 0 ? 1 - rss / anova.totalSS : Number.NaN;
  const adjusted = anova.totalSS > 0 ? 1 - (rss / df) / (anova.totalSS / anova.totalDf) : Number.NaN;
  const collinearity = collinearityReport(core.qr.R, Xw, names, hasIntercept);
  warnings.push(...collinearity.warnings);

  // Gaussian log-likelihood at the ML variance estimate (R's convention), so
  // AIC/BIC are comparable with the GLM figures from this module.
  const sigmaMl = rss / n;
  const logLikelihood =
    sigmaMl > 0
      ? -0.5 * n * (Math.log(2 * Math.PI) + Math.log(sigmaMl) + 1) + 0.5 * stableSum(w.map((v) => Math.log(v)))
      : Infinity;
  const k = p + 1; // coefficients plus the error variance
  const aic = Number.isFinite(logLikelihood) ? -2 * logLikelihood + 2 * k : -Infinity;
  const bic = Number.isFinite(logLikelihood) ? -2 * logLikelihood + Math.log(n) * k : -Infinity;

  const dw = durbinWatson(residuals);
  if (Number.isFinite(dw) && (dw < 1.2 || dw > 2.8)) {
    warnings.push(
      `Durbin–Watson is ${dw.toPrecision(4)} (2 means no first-order autocorrelation, below 2 positive, above 2 negative). The residuals appear autocorrelated in the order the rows were supplied; if that order is meaningful (time, space, repeated measures) the standard errors and p-values above are wrong, usually too small.`,
    );
  }

  const limitations = [...REGRESSION_LIMITATIONS];
  if (seType === 'classical') {
    limitations.push(
      'The classical standard errors assume the error variance is the same for every observation. Robust HC0–HC3 standard errors are reported alongside; if they differ materially from the classical ones, prefer HC3 and treat the classical p-values as unreliable.',
    );
  } else {
    limitations.push(
      `${seType} standard errors are used: they do not assume constant error variance, but they still assume the observations are independent, and in small samples they are themselves noisy (HC3 is the least bad choice below about n = 250).`,
    );
  }
  if (design.weighted) {
    limitations.push(
      'Weighted least squares treats the supplied weights as known and proportional to the inverse error variance. If the weights are estimated, the standard errors understate the true uncertainty.',
    );
  }

  return {
    kind: design.weighted ? 'wls' : 'ols',
    yName: spec.yName ?? 'y',
    coefficients,
    beta,
    hasIntercept,
    n,
    p,
    fitted,
    residuals,
    leverage,
    rSquared,
    adjustedRSquared: adjusted,
    residualStandardError: sigma,
    sigmaSquared: sigmaSq,
    logLikelihood,
    aic,
    bic,
    anova,
    collinearity,
    xtxInverse: xtxInv,
    seType,
    classicalStdErrors: classicalSE,
    robustStdErrors: robust,
    level,
    missing: design.missing,
    durbinWatson: dw,
    exactness: 'exact',
    inferenceValid: true,
    warnings,
    limitations,
  };
}

/**
 * Intervals at new predictor values.
 *
 * Two different questions, two different widths:
 *  - the confidence interval for the MEAN response asks where the average
 *    response at these predictor values lies: width ∝ √(x₀ᵀ(XᵀX)⁻¹x₀);
 *  - the prediction interval for a NEW OBSERVATION asks where a single future
 *    measurement will fall: width ∝ √(1 + x₀ᵀ(XᵀX)⁻¹x₀), because the new
 *    observation carries its own error on top of the uncertainty in the line.
 * The prediction interval is therefore strictly wider everywhere. Quoting the
 * mean-response interval for an individual prediction is a common and serious
 * understatement of uncertainty.
 */
export function predictIntervals(
  fit: LinearFit,
  rows: readonly (readonly number[])[],
  options: { level?: number; newWeight?: number } = {},
): IntervalPoint[] {
  if (!fit.inferenceValid) {
    throw new EngineError(
      'Prediction intervals are only defined for the unpenalised least-squares fit. A penalised fit (ridge, lasso, elastic net) has biased coefficients and no exact interval theory; use cross-validation to describe its predictive error instead.',
      'unsupported',
    );
  }
  const level = options.level ?? fit.level;
  const wNew = options.newWeight ?? 1;
  if (!(wNew > 0)) throw new EngineError('The weight for the new observation must be positive.', 'range');
  const df = fit.n - fit.p;
  const t = tCritical(level, df);
  const inv = fit.xtxInverse;
  return rows.map((raw) => {
    if (raw.length !== fit.p - (fit.hasIntercept ? 1 : 0)) {
      throw new EngineError(
        `Prediction needs ${fit.p - (fit.hasIntercept ? 1 : 0)} predictor value(s) per row; received ${raw.length}.`,
        'shape',
      );
    }
    const x = fit.hasIntercept ? [1, ...raw] : [...raw];
    let quad = 0;
    for (let a = 0; a < fit.p; a++) {
      for (let b = 0; b < fit.p; b++) quad += x[a] * inv[a][b] * x[b];
    }
    quad = Math.max(0, quad);
    let fitVal = 0;
    for (let j = 0; j < fit.p; j++) fitVal += x[j] * fit.beta[j];
    const seMean = Math.sqrt(fit.sigmaSquared * quad);
    const sePred = Math.sqrt(fit.sigmaSquared * (1 / wNew + quad));
    return {
      x: [...raw],
      fit: fitVal,
      meanLow: fitVal - t * seMean,
      meanHigh: fitVal + t * seMean,
      predictionLow: fitVal - t * sePred,
      predictionHigh: fitVal + t * sePred,
    };
  });
}

export interface HeteroskedasticityTest {
  name: string;
  statistic: number;
  degreesOfFreedom: number;
  pValue: number;
  /** True when the test rejects constant error variance at the 5% level. */
  rejects: boolean;
  interpretation: string;
}

/**
 * Breusch–Pagan test: regress the squared residuals (scaled by their mean) on
 * the predictors; half the resulting regression sum of squares is χ² with
 * (p − 1) degrees of freedom under constant variance.
 */
export function breuschPaganTest(fit: LinearFit, predictors: readonly (readonly number[])[]): HeteroskedasticityTest {
  const n = fit.n;
  const e2 = fit.residuals.map((e) => e * e);
  const sigmaHat = stableSum(e2) / n;
  if (!(sigmaHat > 0)) {
    throw new EngineError('The residuals are all zero, so there is no variance to test for heteroskedasticity.', 'degenerate');
  }
  const g = e2.map((v) => v / sigmaHat);
  const X = predictors.map((row) => [1, ...row]);
  const qr = householderQR(X);
  if (qr.rank < qr.p) throw new EngineError('The auxiliary regression for the Breusch–Pagan test is rank deficient.', 'singular');
  const beta = qrSolve(qr, g);
  const gbar = mean(g);
  const fittedG = X.map((row) => row.reduce((s, v, i) => s + v * beta[i], 0));
  const ssr = stableSum(fittedG.map((v) => (v - gbar) ** 2));
  const stat = ssr / 2;
  const dfTest = qr.p - 1;
  const pValue = chiSquareSf(stat, dfTest);
  return {
    name: 'Breusch–Pagan test',
    statistic: stat,
    degreesOfFreedom: dfTest,
    pValue,
    rejects: pValue < 0.05,
    interpretation:
      pValue < 0.05
        ? `The squared residuals vary systematically with the predictors (χ² = ${stat.toPrecision(4)}, p = ${pValue.toPrecision(3)}). The error variance is not constant, so the classical standard errors are wrong; use the HC3 robust standard errors.`
        : `No detectable dependence of the squared residuals on the predictors (χ² = ${stat.toPrecision(4)}, p = ${pValue.toPrecision(3)}). This does not prove constant variance — it means this test cannot distinguish it from the data, and the test assumes the error variance depends on the predictors linearly.`,
  };
}

/**
 * White test: the same idea against a more general alternative — the squared
 * residuals are regressed on the predictors, their squares and their
 * cross-products, and n·R² is χ² with the auxiliary model's degrees of freedom.
 */
export function whiteTest(fit: LinearFit, predictors: readonly (readonly number[])[]): HeteroskedasticityTest {
  const n = fit.n;
  const k = predictors[0]?.length ?? 0;
  if (k === 0) throw new EngineError('The White test needs at least one predictor.', 'insufficient');
  const rows = predictors.map((row) => {
    const r: number[] = [1, ...row];
    for (let a = 0; a < k; a++) for (let b = a; b < k; b++) r.push(row[a] * row[b]);
    return r;
  });
  const e2 = fit.residuals.map((e) => e * e);
  if (!(stableSum(e2) > 0)) {
    throw new EngineError('The residuals are all zero, so there is no variance to test for heteroskedasticity.', 'degenerate');
  }
  // Drop auxiliary columns that are collinear (e.g. a dummy squared equals itself).
  const keep: number[] = [0];
  for (let j = 1; j < rows[0].length; j++) {
    const trial = rows.map((r) => keep.concat(j).map((c) => r[c]));
    const qr = householderQR(trial);
    if (qr.rank === qr.p) keep.push(j);
  }
  const X = rows.map((r) => keep.map((c) => r[c]));
  const qr = householderQR(X);
  const beta = qrSolve(qr, e2);
  const ybar = mean(e2);
  const fittedE = X.map((row) => row.reduce((s, v, i) => s + v * beta[i], 0));
  const rssAux = stableSum(e2.map((v, i) => (v - fittedE[i]) ** 2));
  const tssAux = stableSum(e2.map((v) => (v - ybar) ** 2));
  const r2 = tssAux > 0 ? 1 - rssAux / tssAux : 0;
  const stat = n * r2;
  const dfTest = X[0].length - 1;
  const pValue = chiSquareSf(stat, dfTest);
  return {
    name: 'White test',
    statistic: stat,
    degreesOfFreedom: dfTest,
    pValue,
    rejects: pValue < 0.05,
    interpretation:
      pValue < 0.05
        ? `The error variance depends on the predictors, their squares or their interactions (n·R² = ${stat.toPrecision(4)}, p = ${pValue.toPrecision(3)}). Use robust standard errors.`
        : `No detectable heteroskedasticity of this general form (n·R² = ${stat.toPrecision(4)}, p = ${pValue.toPrecision(3)}). The White test spends degrees of freedom on many auxiliary terms, so it has low power in small samples; a non-rejection is weak evidence.`,
  };
}

/** R⁻¹, exposed for callers that need the covariance factor directly. */
export { invertUpper, qTranspose };
