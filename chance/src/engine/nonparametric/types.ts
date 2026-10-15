/**
 * Shared result shape for the non-parametric and multi-group tests.
 *
 * Every test in this module returns the same structure so the interface can
 * present them uniformly: the statistic, the p-value together with *how* it
 * was obtained and why that route was chosen, one or more effect sizes with a
 * plain-language reading, a confidence interval where one is defined, the
 * assumptions actually being made, the limitations, how ties were handled, and
 * — for a result that fails to reject — an explicit statement that failing to
 * reject is not evidence of no effect, accompanied by the smallest effect the
 * observed sample size could reliably have detected.
 */
import type { Exactness } from '../core/result';

/** How the reported p-value was computed. */
export type PValueRoute = 'exact' | 'asymptotic' | 'monte-carlo';

export interface EffectSize {
  name: string;
  value: number;
  /** Plain-language reading of this particular value. */
  interpretation: string;
  /** Interval for the effect size itself, where one is defined. */
  interval?: NonparametricInterval | null;
}

export interface NonparametricInterval {
  low: number;
  high: number;
  level: number;
  /** What the interval is an interval *for*. */
  of: string;
  /** How it was constructed, e.g. "distribution-free (Mann–Whitney inversion)". */
  method: string;
  /**
   * Whether this is an interval for an estimated parameter (`estimate`) or a
   * range of simulated/observed outcomes (`outcomes`). The two are different
   * statements and are never mixed.
   */
  kind: 'estimate' | 'outcomes';
}

export interface TieHandling {
  /** Whether tied observations are present at all. */
  tiesPresent: boolean;
  /** Whether a tie correction was applied to the statistic or variance. */
  correctionApplied: boolean;
  /** Number of tied groups of size > 1. */
  tiedGroups: number;
  detail: string;
}

export interface GroupSummary {
  label: string;
  n: number;
  mean: number;
  sd: number;
  median: number;
  /** Mean rank in the pooled sample, where the test is rank based. */
  meanRank?: number;
}

export interface SensitivityStatement {
  level: number;
  rejected: boolean;
  /** The sentence shown to the user, including the "absence of evidence" caveat. */
  statement: string;
  /** Approximate power against a conventional effect at this sample size. */
  achievedPower: number | null;
  /** Smallest effect detectable with the stated power at this sample size. */
  minimumDetectableEffect: { value: number; scale: string; power: number; note: string } | null;
}

export interface NonparametricResult {
  name: string;
  nullHypothesis: string;
  alternativeHypothesis: string;
  statistic: number;
  statisticName: string;
  degreesOfFreedom: number | [number, number] | null;
  pValue: number;
  /** Which p-value route was used. */
  pValueRoute: PValueRoute;
  /** Why that route was used rather than the alternative. */
  pValueRouteReason: string;
  exactness: Exactness;
  effectSizes: EffectSize[];
  interval: NonparametricInterval | null;
  assumptions: string[];
  limitations: string[];
  notes: string[];
  ties: TieHandling;
  sensitivity: SensitivityStatement;
  groups: GroupSummary[];
  /** Raw intermediate quantities, for cross-checks and for the explanation panel. */
  diagnostics: Record<string, number>;
}

/** A single pairwise comparison from a post-hoc procedure. */
export interface PairwiseComparison {
  a: string;
  b: string;
  difference: number;
  statistic: number;
  statisticName: string;
  pValueUnadjusted: number;
  pValueAdjusted: number;
  rejected: boolean;
  interval: NonparametricInterval | null;
}

export interface PostHocResult {
  name: string;
  /** The multiplicity control in force. Never "none". */
  multiplicityControl: string;
  familywiseLevel: number;
  comparisons: PairwiseComparison[];
  exactness: Exactness;
  assumptions: string[];
  limitations: string[];
  notes: string[];
}
