/**
 * Out-of-sample assessment.
 *
 * In-sample R² is not a measure of predictive performance: adding a predictor
 * can only increase it, and with enough predictors it reaches 1 while the
 * model predicts nothing. The figures here are what the model does on data it
 * did not see, and the report deliberately places them next to R² so the two
 * cannot be confused.
 */
import { EngineError } from '../core/result';
import { Random } from '../random/rng';
import { stableSum } from '../core/numeric';
import { householderQR, qrSolve } from './qr';
import type { Exactness } from '../core/result';

export interface CrossValidationResult {
  method: string;
  folds: number;
  /** Root mean squared prediction error on held-out data. */
  rmse: number;
  /** Mean absolute prediction error on held-out data. */
  mae: number;
  /** 1 − PRESS/TSS: the out-of-sample analogue of R². Can be negative. */
  predictiveRSquared: number;
  /** In-sample R² of the full fit, for contrast. */
  inSampleRSquared: number;
  /** Sum of squared held-out prediction errors. */
  press: number;
  n: number;
  exactness: Exactness;
  warnings: string[];
  notes: string[];
}

function olsBeta(X: readonly (readonly number[])[], y: readonly number[]): number[] {
  const qr = householderQR(X);
  if (qr.rank < qr.p) {
    throw new EngineError(
      'A cross-validation fold produced a rank-deficient design: at least one predictor becomes an exact linear combination of the others once part of the data is held out. The out-of-sample estimate cannot be computed for this model; reduce the number of predictors or the number of folds.',
      'singular',
    );
  }
  return qrSolve(qr, y);
}

function summarise(
  method: string,
  folds: number,
  y: readonly number[],
  errors: readonly number[],
  inSampleRSquared: number,
  exactness: Exactness,
  extraNotes: string[],
): CrossValidationResult {
  const n = y.length;
  const press = stableSum(errors.map((e) => e * e));
  const ybar = stableSum(y) / n;
  const tss = stableSum(y.map((v) => (v - ybar) ** 2));
  const predictiveRSquared = tss > 0 ? 1 - press / tss : Number.NaN;
  const warnings: string[] = [];
  if (Number.isFinite(predictiveRSquared) && predictiveRSquared < 0) {
    warnings.push(
      `The out-of-sample predictive R² is negative (${predictiveRSquared.toPrecision(3)}): on data it has not seen, this model predicts worse than simply using the mean of the response. The in-sample R² of ${inSampleRSquared.toPrecision(3)} is describing noise it has fitted.`,
    );
  } else if (Number.isFinite(predictiveRSquared) && inSampleRSquared - predictiveRSquared > 0.15) {
    warnings.push(
      `In-sample R² is ${inSampleRSquared.toPrecision(3)} but out-of-sample predictive R² is ${predictiveRSquared.toPrecision(3)}. The gap is the amount of the apparent fit that is fitted noise.`,
    );
  }
  return {
    method,
    folds,
    rmse: Math.sqrt(press / n),
    mae: stableSum(errors.map((e) => Math.abs(e))) / n,
    predictiveRSquared,
    inSampleRSquared,
    press,
    n,
    exactness,
    warnings,
    notes: [
      'Prediction errors are measured on observations excluded from the fit that predicted them.',
      'Cross-validation estimates the error of this modelling procedure on data from the same source. It does not cover a change in the population, and it is optimistic if any choice (which variables, which transformation, which penalty) was made by looking at all of the data first.',
      ...extraNotes,
    ],
  };
}

/**
 * Leave-one-out cross-validation for a linear model by the exact hat-matrix
 * identity: the held-out residual is e_i/(1 − h_i). No model is refitted, and
 * the result is identical to brute-force refitting n times, so there is no
 * reason to pay for the refits.
 */
export function leaveOneOutLinear(
  residuals: readonly number[],
  leverage: readonly number[],
  y: readonly number[],
  inSampleRSquared: number,
): CrossValidationResult {
  const n = residuals.length;
  if (leverage.length !== n || y.length !== n) throw new EngineError('Inconsistent array lengths for leave-one-out.', 'shape');
  const errors = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const oneMinusH = 1 - leverage[i];
    if (!(oneMinusH > 1e-10)) {
      throw new EngineError(
        `Observation ${i} has leverage ${leverage[i].toPrecision(6)}, effectively 1. Removing it leaves the model unidentified, so its leave-one-out prediction does not exist. This observation is the only source of information for part of the model.`,
        'degenerate',
      );
    }
    errors[i] = residuals[i] / oneMinusH;
  }
  return summarise('Leave-one-out cross-validation (exact hat-matrix identity)', n, y, errors, inSampleRSquared, 'empirical', [
    'Computed from the hat matrix, which makes it exactly equal to refitting the model n times, at no extra cost.',
    'Leave-one-out has low bias but high variance as an estimate of predictive error, and for model selection 5- or 10-fold is usually the more stable choice.',
  ]);
}

/**
 * k-fold cross-validation, refitting the linear model on each training split.
 * Folds are assigned by a seeded shuffle so the result is reproducible; it
 * remains an empirical estimate that depends on that assignment.
 */
export function kFoldLinear(
  X: readonly (readonly number[])[],
  y: readonly number[],
  k: number,
  inSampleRSquared: number,
  seed: string | number = 'orbis-cv',
): CrossValidationResult {
  const n = y.length;
  if (X.length !== n) throw new EngineError('The design matrix and response have different lengths.', 'shape');
  if (!Number.isInteger(k) || k < 2 || k > n) {
    throw new EngineError(`The number of folds must be a whole number between 2 and n = ${n}; received ${k}.`, 'range');
  }
  const rng = new Random(seed);
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const errors = new Array<number>(n).fill(Number.NaN);
  for (let fold = 0; fold < k; fold++) {
    const testIdx: number[] = [];
    const trainIdx: number[] = [];
    for (let pos = 0; pos < n; pos++) {
      (pos % k === fold ? testIdx : trainIdx).push(order[pos]);
    }
    const beta = olsBeta(
      trainIdx.map((i) => X[i]),
      trainIdx.map((i) => y[i]),
    );
    for (const i of testIdx) {
      let pred = 0;
      for (let j = 0; j < beta.length; j++) pred += X[i][j] * beta[j];
      errors[i] = y[i] - pred;
    }
  }
  return summarise(`${k}-fold cross-validation`, k, y, errors, inSampleRSquared, 'empirical', [
    `Fold membership comes from a seeded shuffle (seed "${seed}"); a different seed gives a slightly different number, which is the sampling noise of the estimate itself.`,
  ]);
}

/** Generic k-fold for an arbitrary fit/predict pair (used by the penalised fits). */
export function kFoldGeneric(
  n: number,
  k: number,
  fitPredict: (trainIdx: number[], testIdx: number[]) => number[],
  y: readonly number[],
  seed: string | number = 'orbis-cv',
): { errors: number[]; press: number; rmse: number; mae: number } {
  if (!Number.isInteger(k) || k < 2 || k > n) {
    throw new EngineError(`The number of folds must be a whole number between 2 and n = ${n}; received ${k}.`, 'range');
  }
  const rng = new Random(seed);
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const errors = new Array<number>(n).fill(Number.NaN);
  for (let fold = 0; fold < k; fold++) {
    const testIdx: number[] = [];
    const trainIdx: number[] = [];
    for (let pos = 0; pos < n; pos++) (pos % k === fold ? testIdx : trainIdx).push(order[pos]);
    const preds = fitPredict(trainIdx, testIdx);
    testIdx.forEach((i, t) => {
      errors[i] = y[i] - preds[t];
    });
  }
  const press = stableSum(errors.map((e) => e * e));
  return { errors, press, rmse: Math.sqrt(press / n), mae: stableSum(errors.map((e) => Math.abs(e))) / n };
}
