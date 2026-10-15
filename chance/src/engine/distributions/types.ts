import type { Issue } from '../core/result';
import type { Random } from '../random/rng';

export type DistributionKind = 'discrete' | 'continuous';
export type Params = Record<string, number>;

export interface ParamSpec {
  key: string;
  label: string;
  /** Conventional symbol, e.g. "μ". */
  symbol: string;
  description: string;
  defaultValue: number;
  /** Inclusive lower bound unless `minExclusive`. */
  min?: number;
  minExclusive?: boolean;
  max?: number;
  maxExclusive?: boolean;
  integer?: boolean;
  /** Suggested slider range for interactive exploration. */
  sliderMin: number;
  sliderMax: number;
  step: number;
}

/** A moment that may be undefined/infinite for some parameter values. */
export type Moment = { defined: true; value: number } | { defined: false; reason: string };

export interface DistributionSummary {
  mean: Moment;
  variance: Moment;
  sd: Moment;
  skewness: Moment;
  excessKurtosis: Moment;
  median: number;
  mode: Moment;
}

export interface DistributionDef {
  id: string;
  name: string;
  kind: DistributionKind;
  /** Short plain-language description of what the distribution models. */
  description: string;
  /** Typical uses. */
  useCases: string[];
  /** pmf/pdf formula in conventional notation. */
  formula: string;
  /** Support description, e.g. "k ∈ {0, 1, …, n}". */
  supportText: string;
  params: ParamSpec[];
  /** Additional notes / conventions (e.g. which parameterisation is used). */
  notes: string[];
  /** Cross-parameter validation beyond per-parameter bounds. */
  validateExtra?(p: Params): Issue[];
  /** Inclusive support bounds; may be ±Infinity. */
  support(p: Params): { min: number; max: number };
  /** Probability mass (discrete) or density (continuous). */
  pdf(x: number, p: Params): number;
  logPdf(x: number, p: Params): number;
  /** P(X ≤ x). */
  cdf(x: number, p: Params): number;
  /** P(X > x), computed directly where possible for tail accuracy. */
  sf(x: number, p: Params): number;
  /** Smallest x with F(x) ≥ q (generalised inverse). */
  quantile(q: number, p: Params): number;
  mean(p: Params): Moment;
  variance(p: Params): Moment;
  skewness(p: Params): Moment;
  excessKurtosis(p: Params): Moment;
  mode(p: Params): Moment;
  sample(rng: Random, p: Params): number;
  /** Quantile is available in closed form (true) or by numerical inversion (false). */
  closedFormQuantile: boolean;
}

export const defined = (value: number): Moment => ({ defined: true, value });
export const undefinedMoment = (reason: string): Moment => ({ defined: false, reason });
