/**
 * Least squares with the variance estimators the quasi-experimental designs
 * need (classical, heteroskedasticity-robust HC1, and cluster-robust), plus
 * the logistic propensity model.
 *
 * The linear algebra is weighted normal equations solved through
 * `stats/linalg.solve`. Designs here are small (a handful of columns), and a
 * singular system is refused rather than regularised: a rank-deficient causal
 * design means the contrast is not identified, and returning a number for it
 * would be exactly the fabrication this project forbids.
 */

import { EngineError } from '../core/result.ts';
import { solve, type Matrix } from '../stats/linalg.ts';
import { fitGlm, type GlmFit, type Column } from './deps.ts';

export interface LeastSquares {
  beta: number[];
  /** (X'WX)^{-1}, needed by every variance estimator below. */
  xwxInv: Matrix;
  fitted: number[];
  residuals: number[];
  n: number;
  p: number;
  /** Residual degrees of freedom, n − p. */
  df: number;
  /** Weighted residual variance with the n − p correction. */
  sigma2: number;
  weights: number[];
}

function invertSymmetric(a: Matrix, label: string): Matrix {
  const p = a.length;
  const inv: Matrix = [];
  for (let j = 0; j < p; j++) {
    const e = new Array<number>(p).fill(0);
    e[j] = 1;
    const col = solve(
      a.map((r) => r.slice()),
      e,
    );
    if (col === null) {
      throw new EngineError(
        `${label}: the design matrix is singular, so the coefficients are not identified. This happens when a ` +
          'column is constant, two columns are identical or one is an exact linear combination of the others — ' +
          'for example a treatment indicator that never varies, or a group dummy plus a full set of time dummies. ' +
          'No coefficients are reported: any value returned here would be an artefact of the solver, not an estimate.',
        'singular',
      );
    }
    inv.push(col);
  }
  // inv currently holds columns of the inverse; transpose into rows.
  const out: Matrix = [];
  for (let i = 0; i < p; i++) out.push(inv.map((c) => c[i]));
  return out;
}

/** Weighted least squares. `X` must already contain any intercept column. */
export function leastSquares(
  X: readonly (readonly number[])[],
  y: readonly number[],
  weights?: readonly number[],
  label = 'Least squares',
): LeastSquares {
  const n = X.length;
  if (n === 0) throw new EngineError(`${label}: no observations were supplied.`, 'empty');
  const p = X[0].length;
  if (y.length !== n) {
    throw new EngineError(`${label}: ${n} rows of predictors but ${y.length} outcomes.`, 'length');
  }
  if (n <= p) {
    throw new EngineError(
      `${label}: ${n} observations for ${p} parameters. With n ≤ p the fit interpolates the data exactly, the ` +
        'residual variance is zero by construction and no standard error exists. More data or fewer covariates ' +
        'are required; no estimate is reported.',
      'underdetermined',
    );
  }
  const w = weights ? weights.slice() : new Array<number>(n).fill(1);
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(w[i]) || w[i] < 0) {
      throw new EngineError(`${label}: observation ${i} has a non-finite or negative weight (${w[i]}).`, 'weight');
    }
    for (let j = 0; j < p; j++) {
      if (!Number.isFinite(X[i][j])) {
        throw new EngineError(`${label}: predictor column ${j} is not finite at observation ${i}.`, 'finite');
      }
    }
    if (!Number.isFinite(y[i])) {
      throw new EngineError(`${label}: the outcome is not finite at observation ${i}.`, 'finite');
    }
  }
  const xwx: Matrix = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const xwy = new Array<number>(p).fill(0);
  for (let i = 0; i < n; i++) {
    const wi = w[i];
    if (wi === 0) continue;
    const row = X[i];
    for (let j = 0; j < p; j++) {
      xwy[j] += wi * row[j] * y[i];
      for (let k = j; k < p; k++) xwx[j][k] += wi * row[j] * row[k];
    }
  }
  for (let j = 0; j < p; j++) for (let k = 0; k < j; k++) xwx[j][k] = xwx[k][j];

  const beta = solve(
    xwx.map((r) => r.slice()),
    xwy.slice(),
  );
  if (beta === null) {
    throw new EngineError(
      `${label}: the weighted design matrix is singular, so the coefficients are not identified (a constant ` +
        'column, duplicated columns, or an exact collinearity such as a complete set of dummies alongside an ' +
        'intercept). No coefficients are reported.',
      'singular',
    );
  }
  const xwxInv = invertSymmetric(xwx, label);
  const fitted = new Array<number>(n).fill(0);
  const residuals = new Array<number>(n).fill(0);
  let rss = 0;
  let wsum = 0;
  for (let i = 0; i < n; i++) {
    let f = 0;
    for (let j = 0; j < p; j++) f += X[i][j] * beta[j];
    fitted[i] = f;
    residuals[i] = y[i] - f;
    rss += w[i] * residuals[i] * residuals[i];
    wsum += w[i];
  }
  if (wsum <= 0) throw new EngineError(`${label}: all observation weights are zero.`, 'weight');
  const df = n - p;
  return { beta, xwxInv, fitted, residuals, n, p, df, sigma2: rss / df, weights: w };
}

function sandwich(X: readonly (readonly number[])[], fit: LeastSquares, meat: Matrix): Matrix {
  const p = fit.p;
  const out: Matrix = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  // (X'WX)^{-1} meat (X'WX)^{-1}
  const tmp: Matrix = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  for (let i = 0; i < p; i++)
    for (let j = 0; j < p; j++) {
      let s = 0;
      for (let k = 0; k < p; k++) s += fit.xwxInv[i][k] * meat[k][j];
      tmp[i][j] = s;
    }
  for (let i = 0; i < p; i++)
    for (let j = 0; j < p; j++) {
      let s = 0;
      for (let k = 0; k < p; k++) s += tmp[i][k] * fit.xwxInv[k][j];
      out[i][j] = s;
    }
  void X;
  return out;
}

/** Classical variance σ²(X'WX)^{-1}, valid only under constant error variance. */
export function classicalVcov(fit: LeastSquares): Matrix {
  return fit.xwxInv.map((r) => r.map((v) => v * fit.sigma2));
}

/** Heteroskedasticity-robust HC1 (the finite-sample-corrected White estimator). */
export function robustVcovHC1(X: readonly (readonly number[])[], fit: LeastSquares): Matrix {
  const p = fit.p;
  const meat: Matrix = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  for (let i = 0; i < fit.n; i++) {
    const s = fit.weights[i] * fit.weights[i] * fit.residuals[i] * fit.residuals[i];
    for (let j = 0; j < p; j++) for (let k = 0; k < p; k++) meat[j][k] += s * X[i][j] * X[i][k];
  }
  const c = fit.n / fit.df;
  return sandwich(X, fit, meat).map((r) => r.map((v) => v * c));
}

/**
 * Cluster-robust variance with the conventional G/(G−1) · (n−1)/(n−p) correction.
 *
 * Refused below two clusters: with one cluster there is no between-cluster
 * variation to estimate and the "standard error" would be arbitrary.
 */
export function clusterVcov(
  X: readonly (readonly number[])[],
  fit: LeastSquares,
  clusters: readonly (string | number)[],
): { vcov: Matrix; nClusters: number; warnings: string[] } {
  if (clusters.length !== fit.n) {
    throw new EngineError('Cluster-robust variance: one cluster label per observation is required.', 'length');
  }
  const groups = new Map<string, number[]>();
  for (let i = 0; i < fit.n; i++) {
    const key = String(clusters[i]);
    const g = groups.get(key);
    if (g) g.push(i);
    else groups.set(key, [i]);
  }
  const G = groups.size;
  if (G < 2) {
    throw new EngineError(
      `Cluster-robust variance needs at least 2 clusters; ${G} was supplied. With a single cluster there is no ` +
        'between-cluster variation to estimate, so no cluster-robust standard error exists. Report the design, ' +
        'not a number.',
      'clusters',
    );
  }
  const p = fit.p;
  const meat: Matrix = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  for (const idx of groups.values()) {
    const s = new Array<number>(p).fill(0);
    for (const i of idx) {
      const wr = fit.weights[i] * fit.residuals[i];
      for (let j = 0; j < p; j++) s[j] += wr * X[i][j];
    }
    for (let j = 0; j < p; j++) for (let k = 0; k < p; k++) meat[j][k] += s[j] * s[k];
  }
  const c = (G / (G - 1)) * ((fit.n - 1) / fit.df);
  const warnings: string[] = [];
  if (G < 30) {
    warnings.push(
      `Only ${G} clusters. Cluster-robust standard errors are asymptotic in the NUMBER OF CLUSTERS, not the ` +
        'number of observations, so with few clusters they are biased downwards and the confidence interval is ' +
        'too narrow. Treat the p-value as optimistic; a wild cluster bootstrap would be more honest.',
    );
  }
  return { vcov: sandwich(X, fit, meat).map((r) => r.map((v) => v * c)), nClusters: G, warnings };
}

export function standardErrors(vcov: Matrix): number[] {
  return vcov.map((r, i) => {
    const v = r[i];
    if (!(v >= 0) || !Number.isFinite(v)) {
      throw new EngineError(
        'The variance estimate for a coefficient came out negative or non-finite, which means the sandwich ' +
          'estimator has broken down (usually a near-singular design or a cluster that determines a coefficient ' +
          'on its own). No standard error is reported rather than the square root of a negative number.',
        'variance',
      );
    }
    return Math.sqrt(v);
  });
}

export interface PropensityModel {
  /** Fitted P(T=1 | X) for each unit, in input order. */
  scores: number[];
  coefficients: { name: string; estimate: number; stdError: number }[];
  names: string[];
  /** Area under the ROC curve of the treatment model: a measure of separation. */
  separation: number;
  warnings: string[];
}

/**
 * Logistic propensity model, fitted by `regression/glm`'s IRLS so that perfect
 * separation and non-convergence are refused there rather than silently
 * producing infinite coefficients.
 */
export function fitPropensity(
  covariates: readonly { name: string; values: readonly number[] }[],
  treatment: readonly number[],
): PropensityModel {
  const n = treatment.length;
  if (n === 0) throw new EngineError('Propensity model: no observations.', 'empty');
  for (const c of covariates) {
    if (c.values.length !== n) {
      throw new EngineError(
        `Propensity model: covariate "${c.name}" has ${c.values.length} values for ${n} units.`,
        'length',
      );
    }
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of c.values) {
      if (!Number.isFinite(v)) {
        throw new EngineError(`Propensity model: covariate "${c.name}" contains a non-finite value.`, 'finite');
      }
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (hi - lo === 0) {
      throw new EngineError(
        `Propensity model: covariate "${c.name}" has zero variance (every unit has the value ${lo}). A constant ` +
          'cannot confound anything and makes the design matrix singular, so no model is fitted. Remove it.',
        'zero-variance',
      );
    }
  }
  let nT = 0;
  for (const t of treatment) {
    if (t !== 0 && t !== 1) {
      throw new EngineError(`Propensity model: treatment must be 0 or 1; found ${t}.`, 'binary');
    }
    nT += t;
  }
  if (nT === 0 || nT === n) {
    throw new EngineError(
      `Propensity model: ${nT === 0 ? 'no unit is treated' : 'every unit is treated'}. A treatment effect needs ` +
        'both arms; with one arm empty there is nothing to contrast and no propensity model to fit.',
      'one-arm',
    );
  }
  const cols: Column[] = covariates.map((c) => ({ name: c.name, values: c.values.slice() }));
  let fit: GlmFit;
  try {
    fit = fitGlm({ y: treatment.slice(), predictors: cols, family: 'binomial', link: 'logit', yName: 'treatment' });
  } catch (e) {
    if (e instanceof EngineError) throw e;
    throw new EngineError(
      `Propensity model: the logistic fit failed (${e instanceof Error ? e.message : String(e)}).`,
      'fit',
    );
  }
  const scores = fit.fitted.slice();
  const warnings: string[] = [];
  let extreme = 0;
  for (const s of scores) {
    if (!Number.isFinite(s)) {
      throw new EngineError(
        'Propensity model: a fitted probability is not finite. The logistic fit has diverged, which is a ' +
          'separation symptom. No scores are reported.',
        'finite',
      );
    }
    if (s < 0.01 || s > 0.99) extreme++;
  }
  if (extreme > 0) {
    warnings.push(
      `${extreme} of ${n} units have a propensity score outside [0.01, 0.99]. These are near-violations of ` +
        'positivity: their inverse-probability weights are above 100 and they will dominate any weighted estimate.',
    );
  }
  // AUC of the treatment model, computed by rank sum, as a separation measure.
  const order = scores.map((s, i) => ({ s, t: treatment[i] })).sort((a, b) => a.s - b.s);
  let rankSum = 0;
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].s === order[i].s) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) if (order[k].t === 1) rankSum += avgRank;
    i = j + 1;
  }
  const auc = (rankSum - (nT * (nT + 1)) / 2) / (nT * (n - nT));
  if (auc > 0.95) {
    warnings.push(
      `The propensity model separates the two arms almost perfectly (AUC ${auc.toFixed(3)}). High separation is ` +
        'not a good propensity model — it means treated and control units are barely comparable, so overlap is ' +
        'thin and the adjustment is extrapolation.',
    );
  }
  return {
    scores,
    coefficients: fit.coefficients.map((c) => ({ name: c.name, estimate: c.estimate, stdError: c.stdError })),
    names: fit.names.slice(),
    separation: auc,
    warnings,
  };
}
