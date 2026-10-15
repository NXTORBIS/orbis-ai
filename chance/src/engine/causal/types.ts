/**
 * Causal effect estimation from observational data — shared types.
 *
 * Everything in this module answers a causal question: what would the outcome
 * have been under a different treatment? That question is NOT answered by the
 * data alone. Each estimator therefore returns its identifying assumptions
 * alongside the number, and every one of those assumptions is flagged as
 * untestable from the observed data.
 */

import type { Exactness } from '../core/result.ts';

/** The sample sizes every method must report. */
export interface SampleAccounting {
  nTotal: number;
  nTreated: number;
  nControl: number;
  /** Units actually contributing to the reported estimate. */
  nUsed: number;
  /** Matched units (matching designs) — null when the method does not match. */
  nMatched: number | null;
  nDropped: number;
  /** Why units were dropped, one reason per line. Empty when none were. */
  dropReasons: string[];
}

/**
 * One identifying assumption. `testable` exists so the interface can show it;
 * for the core causal assumptions it is always false, and that is the point.
 */
export interface AssumptionStatement {
  name: string;
  statement: string;
  testable: boolean;
  /** What the estimate becomes if this fails. */
  ifViolated: string;
}

/** Which potential-outcomes contrast an estimate targets. */
export type Estimand =
  | 'ATE'
  | 'ATT'
  | 'ATC'
  | 'CATE'
  | 'LATE'
  | 'ATE-trimmed'
  | 'ATT-matched'
  | 'ATE-overlap'
  | 'local-at-cutoff'
  | 'ATT-event-time';

export interface EstimandDescription {
  kind: Estimand;
  /** Plain statement of the contrast, in potential-outcome notation. */
  contrast: string;
  /** Who the estimate is about. Changes under trimming and matching. */
  targetPopulation: string;
}

export interface Interval {
  low: number;
  high: number;
  level: number;
}

/**
 * Every causal number this module produces is wrapped in this.
 *
 * `fundamentalProblem` is repeated on every single result deliberately: a user
 * reading one estimate in isolation must still be told that no unit's
 * counterfactual was ever observed.
 */
export interface CausalEstimate {
  method: string;
  estimand: EstimandDescription;
  estimate: number;
  standardError: number | null;
  confidenceInterval: Interval | null;
  /** Standard-normal / bootstrap p-value against a zero effect, when defined. */
  pValue: number | null;
  exactness: Exactness;
  sample: SampleAccounting;
  assumptions: AssumptionStatement[];
  /** The untestability notice. Non-empty on every result. */
  untestability: string;
  fundamentalProblem: string;
  /** How the standard error was obtained (analytic, influence-function, bootstrap, clustered). */
  inferenceNote: string;
  warnings: string[];
  /** Extra method-specific diagnostics for the interface to display. */
  notes: string[];
}

export interface CovariateBalanceRow {
  name: string;
  treatedMean: number;
  controlMean: number;
  /** Standardised mean difference, pooled SD of the unadjusted sample. */
  smd: number;
  /** var(treated)/var(control). 1 means equal spread. */
  varianceRatio: number | null;
  balanced: boolean;
}

export interface BalanceReport {
  before: CovariateBalanceRow[];
  after: CovariateBalanceRow[] | null;
  /** The conventional cut-off used for `balanced`. */
  smdThreshold: number;
  worstBeforeSmd: number;
  worstAfterSmd: number | null;
  warnings: string[];
}

export interface OverlapReport {
  /** Propensity range of the treated and of the control group. */
  treatedRange: [number, number];
  controlRange: [number, number];
  /** Intersection of the two ranges; null when they do not intersect at all. */
  commonSupport: [number, number] | null;
  proportionOutsideCommonSupport: number;
  nOutsideCommonSupport: number;
  /** Histogram of the propensity score by arm, shared bin edges. */
  binEdges: number[];
  treatedCounts: number[];
  controlCounts: number[];
  warnings: string[];
}

export interface WeightReport {
  kind: 'ipw-ate' | 'ipw-att' | 'stabilised-ate' | 'overlap';
  maxWeight: number;
  /** Kish effective sample size, (Σw)² / Σw². */
  effectiveSampleSize: number;
  effectiveSampleSizeTreated: number;
  effectiveSampleSizeControl: number;
  /** Share of the total weight held by the heaviest 1% of units. */
  topOnePercentWeightShare: number;
  warnings: string[];
}
