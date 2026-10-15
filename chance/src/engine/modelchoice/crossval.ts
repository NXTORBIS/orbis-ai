/**
 * Exact leave-one-out and k-fold cross-validation.
 *
 * This is the reference that WAIC and PSIS-LOO approximate. It is exact given
 * the refitting procedure supplied: nothing is importance-weighted and no tail
 * is smoothed, so there is no approximation to diagnose. It is also expensive,
 * which is the only reason the approximations exist. Use it on small problems
 * to check them, and on any problem where PSIS reported a high Pareto k.
 */
import { EngineError } from '../core/result';
import { Random } from '../random/rng';
import type { ElpdEstimate } from './types';
import { MODEL_SET_CAVEAT } from './types';

/**
 * Refit the model on `trainIndices` and return the log predictive density of
 * each observation in `testIndices`, in that order.
 */
export type FoldFit = (trainIndices: readonly number[], testIndices: readonly number[]) => readonly number[];

export interface CrossValidationResult extends ElpdEstimate {
  readonly folds: number;
  /** Which observations were held out in each fold. */
  readonly foldAssignment: readonly (readonly number[])[];
}

function stats(pointwise: readonly number[]): { elpd: number; se: number } {
  const n = pointwise.length;
  let elpd = 0;
  for (const p of pointwise) elpd += p;
  const m = elpd / n;
  let v = 0;
  for (const p of pointwise) v += (p - m) * (p - m);
  return { elpd, se: n > 1 ? Math.sqrt((n * v) / (n - 1)) : NaN };
}

/**
 * K-fold cross-validation. With `folds = n` and no shuffling this is exact
 * leave-one-out cross-validation; `exactLeaveOneOut` is that case by name.
 */
export function kFoldCrossValidation(
  name: string,
  observations: number,
  folds: number,
  fit: FoldFit,
  options: { readonly seed?: string; readonly shuffle?: boolean } = {},
): CrossValidationResult {
  if (!Number.isInteger(observations) || observations < 2) {
    throw new EngineError(`Cross-validation needs at least 2 observations; got ${String(observations)}.`, 'range');
  }
  if (!Number.isInteger(folds) || folds < 2 || folds > observations) {
    throw new EngineError(
      `The number of folds must be a whole number between 2 and the number of observations (${observations}); got ${String(folds)}.`,
      'range',
    );
  }
  const indices = Array.from({ length: observations }, (_, i) => i);
  const shuffle = options.shuffle ?? folds < observations;
  if (shuffle) {
    if (options.seed === undefined) {
      throw new EngineError(
        'Shuffled k-fold cross-validation needs an explicit seed, so the result can be reproduced and so the fold assignment is part of the record.',
        'required',
      );
    }
    const rng = new Random(options.seed);
    for (let i = observations - 1; i > 0; i--) {
      const j = rng.int(0, i);
      const t = indices[i];
      indices[i] = indices[j];
      indices[j] = t;
    }
  }
  const assignment: number[][] = Array.from({ length: folds }, () => []);
  for (let p = 0; p < observations; p++) assignment[p % folds].push(indices[p]);
  const pointwise = new Array<number>(observations).fill(NaN);
  for (let f = 0; f < folds; f++) {
    const test = assignment[f];
    const train = indices.filter((i) => !test.includes(i)).sort((a, b) => a - b);
    const out = fit(train, test);
    if (out.length !== test.length) {
      throw new EngineError(
        `Fold ${f}: the refit returned ${out.length} log predictive densities for ${test.length} held-out observations. It must return one value per held-out observation, in the order given.`,
        'shape',
      );
    }
    for (let t = 0; t < test.length; t++) {
      if (!Number.isFinite(out[t])) {
        throw new EngineError(
          `Fold ${f}: the log predictive density for held-out observation ${test[t]} is ${String(out[t])}. A model that assigns zero density to a held-out point has failed cross-validation for it; that is the result, not a number to average over.`,
          'nonfinite',
        );
      }
      pointwise[test[t]] = out[t];
    }
  }
  const { elpd, se } = stats(pointwise);
  const exact = folds === observations && !shuffle;
  return {
    name,
    method: exact ? 'exact-loo' : 'k-fold',
    elpd,
    standardError: se,
    pointwise,
    effectiveParameters: null,
    informationCriterion: -2 * elpd,
    exactness: 'exact',
    folds,
    foldAssignment: assignment,
    warnings: [
      exact
        ? 'Exact leave-one-out: each observation was predicted by a model refitted without it. This is the reference WAIC and PSIS-LOO approximate; it has no importance-sampling error to diagnose, but it is still an estimate of out-of-sample performance from a finite sample, so the standard error over observations still applies.'
        : `${folds}-fold cross-validation holds out ${Math.ceil(observations / folds)} observation(s) at a time, so each model is fitted to ${(100 * (1 - 1 / folds)).toFixed(0)}% of the data. It therefore estimates the predictive performance of a model fitted to less data than you have, and is pessimistic.`,
      'Cross-validation of time-ordered or grouped data by random folds is wrong: it lets the model learn from the future, or from a group member it is asked to predict. Use a structured fold assignment for such data.',
      MODEL_SET_CAVEAT,
    ],
  };
}

/** Exact leave-one-out cross-validation: n folds, each of one observation. */
export function exactLeaveOneOut(name: string, observations: number, fit: FoldFit): CrossValidationResult {
  return kFoldCrossValidation(name, observations, observations, fit, { shuffle: false });
}
