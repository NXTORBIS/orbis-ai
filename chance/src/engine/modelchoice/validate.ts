/**
 * Input validation for model comparison.
 *
 * Every refusal here names the dimension or the index that is wrong. A
 * pointwise log-likelihood matrix of the wrong shape, or with a non-finite
 * entry, is the commonest way a model comparison silently becomes fiction:
 * one −Infinity makes a sum −Infinity, and a NaN propagates into a ranking
 * that still looks like a ranking.
 */
import { EngineError } from '../core/result';
import type { ModelPointwise } from './types';

export interface MatrixShape {
  readonly draws: number;
  readonly observations: number;
}

/** Minimum posterior draws for a WAIC/PSIS estimate that means anything. */
export const MIN_DRAWS = 50;

/** Validate a draws × observations log-likelihood matrix. Returns its shape. */
export function checkLogLikMatrix(
  logLik: readonly (readonly number[])[],
  label: string,
  minDraws = MIN_DRAWS,
): MatrixShape {
  if (logLik.length === 0) {
    throw new EngineError(
      `${label}: the pointwise log-likelihood matrix has no rows. It must be indexed [draw][observation], with one row per posterior draw.`,
      'empty',
    );
  }
  const observations = logLik[0].length;
  if (observations === 0) {
    throw new EngineError(
      `${label}: the pointwise log-likelihood matrix has 0 columns. It must be indexed [draw][observation], with one column per observation.`,
      'empty',
    );
  }
  for (let s = 0; s < logLik.length; s++) {
    if (logLik[s].length !== observations) {
      throw new EngineError(
        `${label}: row ${s} of the pointwise log-likelihood matrix has ${logLik[s].length} entries but row 0 has ${observations}. The matrix must be rectangular, indexed [draw=${logLik.length}][observation=${observations}].`,
        'shape',
      );
    }
  }
  const bad: string[] = [];
  for (let s = 0; s < logLik.length && bad.length < 8; s++) {
    for (let i = 0; i < observations && bad.length < 8; i++) {
      if (!Number.isFinite(logLik[s][i])) bad.push(`[draw ${s}][observation ${i}] = ${String(logLik[s][i])}`);
    }
  }
  if (bad.length) {
    throw new EngineError(
      `${label}: the pointwise log-likelihood matrix contains non-finite values at ${bad.join(', ')}${bad.length >= 8 ? ' (and possibly more)' : ''}. A log-likelihood of −Infinity means the model assigns probability zero to an observation it must explain; that is a modelling failure, not a number to average over.`,
      'nonfinite',
    );
  }
  if (logLik.length < minDraws) {
    throw new EngineError(
      `${label}: ${logLik.length} posterior draws is too few for a stable estimate; at least ${minDraws} are needed. With this many draws the Monte Carlo error would be larger than the differences being compared.`,
      'insufficient',
    );
  }
  return { draws: logLik.length, observations };
}

/** Validate a model set and assert every member has the same observations. */
export function checkModelSet(models: readonly ModelPointwise[], minDraws = MIN_DRAWS): MatrixShape {
  if (models.length === 0) {
    throw new EngineError(
      'The model set is empty. There is nothing to compare; supply at least one fitted model with its pointwise log-likelihood draws.',
      'empty',
    );
  }
  const shapes = models.map((m) => checkLogLikMatrix(m.logLik, `Model "${m.name}"`, minDraws));
  const n0 = shapes[0].observations;
  for (let k = 1; k < shapes.length; k++) {
    if (shapes[k].observations !== n0) {
      throw new EngineError(
        `Model "${models[k].name}" has ${shapes[k].observations} observations but model "${models[0].name}" has ${n0}. Models can only be compared on the same data, observation by observation.`,
        'shape',
      );
    }
  }
  const names = new Set<string>();
  for (const m of models) {
    if (names.has(m.name)) {
      throw new EngineError(`Two models in the set are both named "${m.name}"; names must be distinct so the comparison can be read.`, 'duplicate');
    }
    names.add(m.name);
  }
  return { draws: shapes[0].draws, observations: n0 };
}

/** Variance over draws of a column, with the 1/(S−1) divisor. */
export function columnVariance(logLik: readonly (readonly number[])[], i: number): number {
  const s = logLik.length;
  let m = 0;
  for (let d = 0; d < s; d++) m += logLik[d][i] / s;
  let v = 0;
  for (let d = 0; d < s; d++) {
    const e = logLik[d][i] - m;
    v += e * e;
  }
  return v / (s - 1);
}
