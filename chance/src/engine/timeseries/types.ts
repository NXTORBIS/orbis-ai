/**
 * Shared types for the time-series module.
 *
 * The rest of the engine treats observations as exchangeable. Nothing in this
 * module may: order matters everywhere here, and the headline practical point
 * of the module is that applying an i.i.d. standard error to autocorrelated
 * data understates uncertainty — often by a large factor. Every result
 * therefore carries an `Explanation` whose `exactness` says how the number was
 * obtained, and forecasts additionally carry the statement that a prediction
 * interval is conditional on the fitted model being correct.
 */
import type { Exactness, Explanation } from '../core/result';

/** A value together with how it was obtained and what it rests on. */
export interface Reported<T> {
  value: T;
  explanation: Explanation;
  warnings: string[];
}

/** Interval for an estimated parameter, or a range of future outcomes. */
export interface TsInterval {
  low: number;
  high: number;
  level: number;
  /** What the interval is an interval *for*. */
  of: string;
  method: string;
  /**
   * `estimate` — a confidence interval for a parameter or an expected value.
   * `outcomes` — a prediction interval for a single future realisation.
   * These are different statements and are never merged or relabelled.
   */
  kind: 'estimate' | 'outcomes';
}

/** Result shape shared by every hypothesis test in this module. */
export interface TsTestResult {
  name: string;
  statistic: number;
  /** Degrees of freedom where the reference distribution has them. */
  df: number | null;
  /**
   * p-value, or null when only a tabulated critical-value comparison is
   * available (ADF, KPSS, Phillips–Perron). Never a fabricated number.
   */
  pValue: number | null;
  /** Bracket on the p-value when only a table is available, e.g. "p < 0.01". */
  pValueBracket: string | null;
  /** Tabulated critical values by significance level, where applicable. */
  criticalValues: { level: number; value: number }[] | null;
  /** Direction of rejection against the critical values. */
  rejectAt: { level: number; reject: boolean }[] | null;
  nullHypothesis: string;
  alternative: string;
  /** Plain-language reading of this particular outcome. */
  interpretation: string;
  explanation: Explanation;
  warnings: string[];
}

export function explain(
  method: string,
  exactness: Exactness,
  opts: {
    formula?: string;
    steps?: { label: string; expression?: string; value?: string }[];
    assumptions?: string[];
    limitations?: string[];
  } = {},
): Explanation {
  return {
    method,
    formula: opts.formula,
    steps: opts.steps ?? [],
    assumptions: opts.assumptions ?? [],
    limitations: opts.limitations ?? [],
    exactness,
  };
}

/** Caveats attached to every forecast produced by this module. */
export const FORECAST_CAVEATS: string[] = [
  'The forecast assumes the fitted model structure persists unchanged into the forecast horizon.',
  'Prediction intervals are conditional on the fitted model being the correct model. They do not cover model misspecification, which is usually the dominant source of forecast error.',
  'Intervals widen with the horizon only as far as the model says they should; a structural break makes them meaningless at any horizon.',
];
