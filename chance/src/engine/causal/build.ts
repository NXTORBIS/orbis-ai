/**
 * The one constructor every causal estimate in this module goes through.
 *
 * It exists so that the assumptions, the untestability notice and the
 * statement of the fundamental problem cannot be forgotten: there is no code
 * path that produces a `CausalEstimate` without them.
 */

import { EngineError } from '../core/result.ts';
import { normalCdf, normalQuantile } from '../special/gamma.ts';
import { FUNDAMENTAL_PROBLEM, UNTESTABILITY } from './assumptions.ts';
import type { AssumptionStatement, CausalEstimate, EstimandDescription, Interval, SampleAccounting } from './types.ts';

export function normalInterval(estimate: number, se: number, level: number): Interval {
  if (!(level > 0 && level < 1)) throw new EngineError(`Confidence level must be in (0,1); got ${level}.`, 'range');
  const z = normalQuantile(1 - (1 - level) / 2);
  return { low: estimate - z * se, high: estimate + z * se, level };
}

export function twoSidedNormalP(estimate: number, se: number): number {
  if (!(se > 0)) {
    throw new EngineError(
      'A p-value was requested with a zero or non-finite standard error. That would be a p-value of exactly 0, ' +
        'which is an artefact rather than evidence; none is reported.',
      'variance',
    );
  }
  return 2 * (1 - normalCdf(Math.abs(estimate / se)));
}

export interface EstimateInput {
  method: string;
  estimand: EstimandDescription;
  estimate: number;
  standardError: number | null;
  level: number;
  exactness: CausalEstimate['exactness'];
  sample: SampleAccounting;
  assumptions: AssumptionStatement[];
  inferenceNote: string;
  warnings?: string[];
  notes?: string[];
  /** Supply an interval directly (bootstrap percentile, Anderson–Rubin, Manski). */
  interval?: Interval | null;
  pValue?: number | null;
}

export function makeEstimate(input: EstimateInput): CausalEstimate {
  if (input.assumptions.length === 0) {
    throw new EngineError(
      `Internal: the estimator "${input.method}" produced no assumption list. A causal estimate without its ` +
        'identifying assumptions is not publishable by this module, so the result is refused rather than shown.',
      'assumptions',
    );
  }
  if (!Number.isFinite(input.estimate)) {
    throw new EngineError(
      `${input.method}: the point estimate came out non-finite. This is a computational failure, not an effect of ` +
        'zero or an infinite effect; no number is reported.',
      'finite',
    );
  }
  const se = input.standardError;
  if (se !== null && (!Number.isFinite(se) || se < 0)) {
    throw new EngineError(
      `${input.method}: the standard error came out ${se}. No interval is reported; an estimate without a valid ` +
        'standard error must not be dressed up with one.',
      'variance',
    );
  }
  const interval =
    input.interval !== undefined
      ? input.interval
      : se !== null && se > 0
        ? normalInterval(input.estimate, se, input.level)
        : null;
  const pValue =
    input.pValue !== undefined ? input.pValue : se !== null && se > 0 ? twoSidedNormalP(input.estimate, se) : null;
  return {
    method: input.method,
    estimand: input.estimand,
    estimate: input.estimate,
    standardError: se,
    confidenceInterval: interval,
    pValue,
    exactness: input.exactness,
    sample: input.sample,
    assumptions: input.assumptions,
    untestability: UNTESTABILITY,
    fundamentalProblem: FUNDAMENTAL_PROBLEM,
    inferenceNote: input.inferenceNote,
    warnings: input.warnings ?? [],
    notes: input.notes ?? [],
  };
}

export function accounting(
  treatment: readonly number[],
  nUsed: number,
  nMatched: number | null,
  dropReasons: string[],
): SampleAccounting {
  let nT = 0;
  for (const t of treatment) nT += t === 1 ? 1 : 0;
  const nTotal = treatment.length;
  return {
    nTotal,
    nTreated: nT,
    nControl: nTotal - nT,
    nUsed,
    nMatched,
    nDropped: nTotal - nUsed,
    dropReasons,
  };
}
