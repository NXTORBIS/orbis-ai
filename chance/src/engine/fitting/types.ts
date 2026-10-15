/**
 * Shared types for distribution fitting and model selection.
 *
 * Honesty rules encoded here:
 *  - every fit reports how many observations were used, how many were
 *    discarded and why, whether the optimiser converged, and the
 *    log-likelihood it reached;
 *  - a goodness-of-fit test that fails to reject is never evidence that the
 *    distribution is correct, and every `GofResult` carries that statement;
 *  - exactness is `exact` only for closed-form maximum likelihood estimates.
 */
import type { Exactness, Explanation } from '../core/result';
import type { Params } from '../distributions/types';

export type FitMethod =
  | 'analytic-mle'
  | 'numerical-mle'
  | 'moments'
  | 'censored-mle'
  | 'em';

export interface Convergence {
  converged: boolean;
  iterations: number;
  /** Plain statement of why it stopped. */
  message: string;
}

export interface FitInterval {
  low: number;
  high: number;
  level: number;
  method: string;
}

/** Per-parameter uncertainty, when it could be computed at all. */
export interface ParamUncertainty {
  key: string;
  estimate: number;
  /** Standard error from the observed information, or null if unavailable. */
  standardError: number | null;
  wald: FitInterval | null;
  /** Why the standard error is unavailable, when it is. */
  unavailableReason?: string;
}

export interface FitResult {
  distributionId: string;
  distributionName: string;
  params: Params;
  /** Parameters held fixed by the caller (not estimated, not counted in k). */
  fixedParams: Params;
  /** Number of parameters actually estimated from the data. */
  estimatedParams: number;
  logLikelihood: number;
  n: number;
  nDiscarded: number;
  discardReasons: string[];
  method: FitMethod;
  exactness: Exactness;
  convergence: Convergence;
  uncertainty: ParamUncertainty[];
  aic: number;
  aicc: number;
  bic: number;
  warnings: string[];
  explanation: Explanation;
}

export interface GofResult {
  name: string;
  statistic: number;
  statisticName: string;
  /** null when only critical values are available. */
  pValue: number | null;
  pValueBasis: 'asymptotic' | 'case-specific-table' | 'exact' | 'none';
  degreesOfFreedom: number | null;
  /** Tabulated critical values, when the p-value rests on a table. */
  criticalValues?: { level: number; value: number }[];
  /** Reject at this level? null when no p-value and no table applies. */
  rejectedAt05: boolean | null;
  /** Statements that must be shown with the result. */
  caveats: string[];
  notes: string[];
}

/**
 * The two statements that must accompany every goodness-of-fit result.
 * They are not decoration: without them the test is routinely misread.
 */
export const GOF_CAVEATS = {
  notEvidenceOfFit:
    'Failing to reject is not evidence that this distribution is correct. It means the data are not inconsistent enough with it to be detected at this sample size; many other distributions would also survive the same test.',
  estimatedParams:
    'The parameters were estimated from the same data being tested, so the test is conservative: the p-value is too large and rejection is harder than the nominal level suggests. A parametric bootstrap of the statistic, or a case-specific table, is needed for a calibrated p-value.',
  knownParams: 'The parameters were supplied, not estimated from this data, so the null distribution of the statistic applies as stated.',
} as const;

export interface PlotPoint {
  x: number;
  y: number;
}

export interface QqEnvelopePoint {
  /** Theoretical quantile (x axis). */
  theoretical: number;
  /** Observed order statistic (y axis). */
  observed: number;
  low: number;
  high: number;
}

export interface SkipReason {
  distributionId: string;
  distributionName: string;
  reason: string;
}
