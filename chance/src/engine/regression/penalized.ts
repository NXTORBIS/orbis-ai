/**
 * Penalised linear regression: ridge, lasso and elastic net.
 *
 * THE POINT THAT IS ALMOST ALWAYS GLOSSED OVER: penalised coefficients are
 * deliberately biased. The penalty buys lower variance by shrinking the
 * estimates towards zero, and that trade is the entire purpose of the method.
 * It also means the standard errors, t statistics, p-values and confidence
 * intervals of ordinary least squares DO NOT APPLY to these coefficients. A
 * "significance test" on a lasso coefficient — and in particular on a
 * coefficient the lasso selected — has no valid interpretation, because the
 * sampling distribution is neither centred on the truth nor t-shaped, and the
 * selection event is itself random. This module therefore returns no standard
 * errors and no p-values for penalised fits, and sets `inferenceValid: false`.
 * The honest summary of a penalised fit is its cross-validated predictive
 * error.
 *
 * Standardisation: the penalty is not scale invariant, so the predictors are
 * centred and scaled before fitting (otherwise a predictor measured in metres
 * is penalised a thousand times more lightly than the same predictor in
 * millimetres). The coefficients are transformed back to the original units
 * before being returned, and the intercept is recovered as
 * ȳ − Σ β_j x̄_j, so the returned numbers apply directly to the user's data.
 */
import { EngineError, type Exactness } from '../core/result';
import { stableSum } from '../core/numeric';
import { householderQR, qrSolve } from './qr';
import { buildDesign } from './design';
import { kFoldGeneric } from './crossval';
import type { Column, MissingReport } from './types';

export type PenaltyKind = 'ridge' | 'lasso' | 'elasticnet';

export interface PenalizedSpec {
  y: readonly (number | null | undefined)[];
  predictors: readonly Column[];
  /** Penalty strength λ ≥ 0. λ = 0 reproduces ordinary least squares exactly. */
  lambda: number;
  /**
   * Elastic-net mixing: 1 = pure lasso (L1), 0 = pure ridge (L2).
   * Anything between is the elastic net.
   */
  alpha?: number;
  yName?: string;
  maxIterations?: number;
  tolerance?: number;
}

export interface PenalizedFit {
  kind: PenaltyKind;
  yName: string;
  lambda: number;
  alpha: number;
  intercept: number;
  /** Coefficients in the user's original units. */
  coefficients: { name: string; estimate: number }[];
  /** Coefficients on the standardised scale, where the penalty acts. */
  standardisedBeta: number[];
  /** Predictors whose coefficient is exactly zero (lasso / elastic net only). */
  zeroed: string[];
  fitted: number[];
  residuals: number[];
  /** Number of non-zero coefficients, the effective size of the model. */
  nonZero: number;
  n: number;
  p: number;
  /** In-sample R², for description only. */
  rSquared: number;
  iterations: number;
  converged: boolean;
  missing: MissingReport;
  exactness: Exactness;
  inferenceValid: false;
  warnings: string[];
  limitations: string[];
}

interface Standardised {
  Z: number[][];
  yc: number[];
  xbar: number[];
  sd: number[];
  ybar: number;
}

/** Centre and scale the predictors; the scale uses the 1/n (population) divisor. */
function standardise(X: readonly (readonly number[])[], y: readonly number[]): Standardised {
  const n = X.length;
  const k = X[0].length;
  const xbar = new Array<number>(k).fill(0);
  for (let j = 0; j < k; j++) xbar[j] = stableSum(X.map((r) => r[j])) / n;
  const sd = new Array<number>(k).fill(0);
  for (let j = 0; j < k; j++) {
    const v = stableSum(X.map((r) => (r[j] - xbar[j]) ** 2)) / n;
    sd[j] = Math.sqrt(v);
    if (!(sd[j] > 0)) throw new EngineError(`Predictor ${j} has zero variance, so it cannot be standardised.`, 'degenerate');
  }
  const Z = X.map((r) => r.map((v, j) => (v - xbar[j]) / sd[j]));
  const ybar = stableSum(y) / n;
  return { Z, yc: y.map((v) => v - ybar), xbar, sd, ybar };
}

const PENALTY_LIMITATIONS = [
  'Penalised coefficients are biased towards zero on purpose: that is how the penalty reduces variance. They are not estimates of the same quantity ordinary least squares estimates.',
  'The usual standard errors, t statistics, p-values and confidence intervals DO NOT apply to these coefficients, and none are reported. The penalty changes the sampling distribution, and for the lasso the set of selected variables is itself random, so a conventional interval would have the wrong coverage by an unknown amount.',
  'Which variables the lasso keeps is unstable: with correlated predictors it picks one of a group essentially arbitrarily, and a small change in the data can change the choice. A variable being dropped is not evidence that it is unrelated to the response.',
  'The penalty λ chosen by cross-validation is itself estimated from the data. Reporting the fit at that λ as if λ had been fixed in advance understates the uncertainty.',
  'Regression measures association, not causation, penalised or not.',
];

/** Ridge by augmented least squares: minimise ‖y − Zb‖² + nλ‖b‖², solved by QR. */
function ridgeSolve(Z: readonly (readonly number[])[], yc: readonly number[], lambda: number, l2: number): number[] {
  const n = Z.length;
  const k = Z[0].length;
  if (lambda === 0 || l2 === 0) {
    const qr = householderQR(Z);
    if (qr.rank < qr.p) {
      throw new EngineError(
        'With no penalty the standardised design is rank deficient, so the unpenalised solution is not unique. Use a positive λ, which is exactly the situation ridge regression exists for.',
        'singular',
      );
    }
    return qrSolve(qr, yc);
  }
  // Augmenting with √(nλ)·I is algebraically identical to the ridge normal
  // equations but, again, never forms ZᵀZ.
  const root = Math.sqrt(n * lambda * l2);
  const A: number[][] = [...Z.map((r) => [...r])];
  for (let j = 0; j < k; j++) {
    const row = new Array<number>(k).fill(0);
    row[j] = root;
    A.push(row);
  }
  const b = [...yc, ...new Array<number>(k).fill(0)];
  const qr = householderQR(A);
  return qrSolve(qr, b);
}

/**
 * Lasso / elastic net by cyclic coordinate descent with soft thresholding.
 * Objective: (1/2n)‖y − Zb‖² + λ(α‖b‖₁ + ((1−α)/2)‖b‖²).
 * Soft thresholding is what produces coefficients that are EXACTLY zero
 * rather than merely small — the defining behaviour of the L1 penalty.
 */
function coordinateDescent(
  Z: readonly (readonly number[])[],
  yc: readonly number[],
  lambda: number,
  alpha: number,
  maxIterations: number,
  tolerance: number,
  warmStart?: readonly number[],
): { beta: number[]; iterations: number; converged: boolean } {
  const n = Z.length;
  const k = Z[0].length;
  const beta = warmStart ? [...warmStart] : new Array<number>(k).fill(0);
  const resid = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let f = 0;
    for (let j = 0; j < k; j++) f += Z[i][j] * beta[j];
    resid[i] = yc[i] - f;
  }
  // Σ z_ij² / n = 1 exactly, because the columns were standardised.
  const l1 = lambda * alpha;
  const l2 = lambda * (1 - alpha);
  let iterations = 0;
  let converged = false;
  for (let iter = 0; iter < maxIterations; iter++) {
    iterations = iter + 1;
    let maxChange = 0;
    for (let j = 0; j < k; j++) {
      const bOld = beta[j];
      let rho = 0;
      for (let i = 0; i < n; i++) rho += Z[i][j] * (resid[i] + Z[i][j] * bOld);
      rho /= n;
      const soft = Math.sign(rho) * Math.max(Math.abs(rho) - l1, 0);
      const bNew = soft / (1 + l2);
      if (bNew !== bOld) {
        const d = bNew - bOld;
        for (let i = 0; i < n; i++) resid[i] -= Z[i][j] * d;
        beta[j] = bNew;
        maxChange = Math.max(maxChange, Math.abs(d));
      }
    }
    if (maxChange < tolerance) {
      converged = true;
      break;
    }
  }
  if (!converged) {
    throw new EngineError(
      `Coordinate descent did not converge in ${maxIterations} passes (largest coefficient change still above the tolerance ${tolerance}). No coefficients are reported: a non-converged optimiser returns a point that is not the solution to anything, and printing it as an estimate would be a fabrication.`,
      'convergence',
    );
  }
  return { beta, iterations, converged };
}

export function fitPenalized(spec: PenalizedSpec): PenalizedFit {
  const alpha = spec.alpha ?? 1;
  if (!(alpha >= 0 && alpha <= 1)) throw new EngineError('The elastic-net mixing parameter α must be between 0 and 1.', 'range');
  if (!(spec.lambda >= 0) || !Number.isFinite(spec.lambda)) throw new EngineError('λ must be a finite number ≥ 0.', 'range');
  const design = buildDesign({ y: spec.y, predictors: spec.predictors, intercept: false });
  const { X, y, names } = design;
  const n = X.length;
  const k = names.length;
  const st = standardise(X, y);
  const kind: PenaltyKind = alpha === 0 ? 'ridge' : alpha === 1 ? 'lasso' : 'elasticnet';
  let b: number[];
  let iterations = 1;
  if (kind === 'ridge') {
    b = ridgeSolve(st.Z, st.yc, spec.lambda, 1);
  } else if (spec.lambda === 0) {
    // At λ = 0 every penalty is the unpenalised problem; solve it exactly
    // rather than iterating towards it.
    b = ridgeSolve(st.Z, st.yc, 0, 0);
  } else {
    const cd = coordinateDescent(
      st.Z,
      st.yc,
      spec.lambda,
      alpha,
      spec.maxIterations ?? 20000,
      spec.tolerance ?? 1e-12,
    );
    b = cd.beta;
    iterations = cd.iterations;
  }
  const beta = b.map((v, j) => v / st.sd[j]);
  const intercept = st.ybar - stableSum(beta.map((v, j) => v * st.xbar[j]));
  const fitted = X.map((row) => intercept + stableSum(row.map((v, j) => v * beta[j])));
  const residuals = y.map((v, i) => v - fitted[i]);
  const rss = stableSum(residuals.map((e) => e * e));
  const tss = stableSum(y.map((v) => (v - st.ybar) ** 2));
  const zeroed = names.filter((_, j) => b[j] === 0);
  const nonZero = b.filter((v) => v !== 0).length;
  const warnings: string[] = [...design.warnings];
  if (spec.lambda === 0) {
    warnings.push('λ = 0: this is the ordinary least-squares fit. Use the unpenalised fit instead, which also gives valid standard errors and p-values.');
  }
  if (kind !== 'ridge' && nonZero === 0) {
    warnings.push(
      `λ = ${spec.lambda} has set every coefficient to exactly zero: the model is the mean of the response. The penalty is larger than the largest univariate signal in the data.`,
    );
  }
  if (zeroed.length) {
    warnings.push(
      `${zeroed.length} coefficient(s) are exactly zero (${zeroed.join(', ')}). That is the L1 penalty selecting variables, not a test: it is not evidence that these predictors are unrelated to the response, and with correlated predictors the choice between them is close to arbitrary.`,
    );
  }
  return {
    kind,
    yName: spec.yName ?? 'y',
    lambda: spec.lambda,
    alpha,
    intercept,
    coefficients: names.map((name, j) => ({ name, estimate: beta[j] })),
    standardisedBeta: b,
    zeroed,
    fitted,
    residuals,
    nonZero,
    n,
    p: k,
    rSquared: tss > 0 ? 1 - rss / tss : Number.NaN,
    iterations,
    converged: true,
    missing: design.missing,
    // λ = 0 ridge is the exact least-squares solution; anything else is the
    // output of an iterative or augmented numerical solve.
    exactness: spec.lambda === 0 ? 'exact' : 'numerical',
    inferenceValid: false,
    warnings,
    limitations: [...PENALTY_LIMITATIONS],
  };
}

export interface PenaltyPath {
  lambda: number;
  /** Held-out root mean squared error from k-fold cross-validation. */
  rmse: number;
  mae: number;
  nonZero: number;
}

export interface PenaltySelection {
  alpha: number;
  path: PenaltyPath[];
  /** λ with the lowest cross-validated error. */
  lambdaMin: number;
  /**
   * The largest λ whose error is within one standard error of the minimum —
   * the conventional, more parsimonious choice, since the minimum of a noisy
   * curve is itself noisy.
   */
  lambdaOneStandardError: number;
  folds: number;
  exactness: Exactness;
  warnings: string[];
  notes: string[];
}

/** Default λ grid: log-spaced down from the smallest penalty that zeroes everything. */
export function defaultLambdaGrid(
  X: readonly (readonly number[])[],
  y: readonly number[],
  alpha: number,
  count = 40,
): number[] {
  const st = standardise(X, y);
  const n = X.length;
  let maxDot = 0;
  for (let j = 0; j < st.Z[0].length; j++) {
    const dot = Math.abs(stableSum(st.Z.map((r, i) => r[j] * st.yc[i]))) / n;
    if (dot > maxDot) maxDot = dot;
  }
  // For pure ridge nothing is ever exactly zero, so the α used to scale the
  // grid is floored (the glmnet convention).
  const lambdaMax = maxDot / Math.max(alpha, 0.01);
  if (!(lambdaMax > 0)) throw new EngineError('No predictor has any linear association with the response, so a penalty path is meaningless.', 'degenerate');
  const ratio = 1e-4;
  return Array.from({ length: count }, (_, i) => lambdaMax * Math.pow(ratio, i / (count - 1)));
}

/** Choose λ by k-fold cross-validation. The folds are refitted, never reused. */
export function crossValidatePenalty(
  spec: Omit<PenalizedSpec, 'lambda'>,
  options: { lambdas?: number[]; folds?: number; seed?: string | number } = {},
): PenaltySelection {
  const alpha = spec.alpha ?? 1;
  const design = buildDesign({ y: spec.y, predictors: spec.predictors, intercept: false });
  const { X, y } = design;
  const n = X.length;
  const folds = options.folds ?? 10;
  const lambdas = (options.lambdas ?? defaultLambdaGrid(X, y, alpha)).slice().sort((a, b) => b - a);
  const path: PenaltyPath[] = [];
  const perLambdaErrors: number[][] = [];
  for (const lambda of lambdas) {
    const cv = kFoldGeneric(
      n,
      folds,
      (trainIdx, testIdx) => {
        const fit = fitPenalized({
          y: trainIdx.map((i) => y[i]),
          predictors: spec.predictors.map((c, j) => ({
            name: c.name,
            values: trainIdx.map((i) => X[i][j]),
          })),
          lambda,
          alpha,
          maxIterations: spec.maxIterations,
          tolerance: spec.tolerance,
        });
        return testIdx.map((i) => fit.intercept + stableSum(X[i].map((v, j) => v * fit.coefficients[j].estimate)));
      },
      y,
      options.seed ?? 'orbis-penalty',
    );
    const full = fitPenalized({ ...spec, lambda });
    path.push({ lambda, rmse: cv.rmse, mae: cv.mae, nonZero: full.nonZero });
    perLambdaErrors.push(cv.errors);
  }
  let best = 0;
  for (let i = 1; i < path.length; i++) if (path[i].rmse < path[best].rmse) best = i;
  // Standard error of the mean squared error at the best λ, propagated to RMSE.
  const e2 = perLambdaErrors[best].map((e) => e * e);
  const mse = stableSum(e2) / n;
  const varMse = stableSum(e2.map((v) => (v - mse) ** 2)) / (n - 1);
  const seMse = Math.sqrt(varMse / n);
  const threshold = Math.sqrt(Math.max(mse + seMse, 0));
  let oneSe = path[best].lambda;
  for (const row of path) {
    // path is ordered from the largest λ down, so the first λ under the
    // threshold is the largest (most parsimonious) acceptable one.
    if (row.rmse <= threshold) {
      oneSe = row.lambda;
      break;
    }
  }
  const warnings: string[] = [...design.warnings];
  if (best === 0) {
    warnings.push('The best λ is the largest one on the grid: the data prefers even more shrinkage than was offered. Extend the grid upwards.');
  }
  if (best === path.length - 1) {
    warnings.push('The best λ is the smallest one on the grid, i.e. essentially no penalty. Extend the grid downwards, or use the unpenalised fit, which at least comes with valid inference.');
  }
  return {
    alpha,
    path,
    lambdaMin: path[best].lambda,
    lambdaOneStandardError: oneSe,
    folds,
    exactness: 'empirical',
    warnings,
    notes: [
      `λ chosen by ${folds}-fold cross-validation over ${lambdas.length} candidate values; each fold was refitted from scratch.`,
      'The one-standard-error λ is the usual recommendation: the minimum of a cross-validation curve is a noisy statistic, and the more heavily penalised model within one standard error of it is generally the more reliable choice.',
      'Because λ was selected using the data, the fit at the chosen λ is slightly optimistic, and the standard errors of ordinary least squares still do not apply to its coefficients.',
    ],
  };
}
