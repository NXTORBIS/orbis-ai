/**
 * Shared types for stochastic processes — probability evolving over time.
 *
 * Every process in this module is described by a `ProcessDefinition` (what it
 * models, its parameters, its defining equation, what it assumes and where it
 * breaks down) and exposes three kinds of output:
 *
 *  - exact analytic results, where a closed form exists (marginal laws,
 *    stationary laws, first-passage probabilities, ruin probabilities);
 *  - numerical results, where a deterministic approximation is used (matrix
 *    exponentials, numerical integrals of an intensity, Euler–Maruyama
 *    discretisation, fixed-point iteration);
 *  - empirical results from simulated paths, which carry sampling error.
 *
 * The `exactness` field on every `Quantity` says which of those it is. Nothing
 * here returns a plausible-looking number in place of a failed computation: an
 * invalid parameter raises an `EngineError` naming the problem.
 */
import type { Exactness } from '../core/result';

export type ProcessCategory = 'counting' | 'diffusion' | 'discrete-time' | 'markov-jump';

export interface ProcessParamSpec {
  key: string;
  label: string;
  /** Conventional symbol, e.g. "λ". */
  symbol: string;
  description: string;
  defaultValue: number;
  /** Inclusive lower bound unless `minExclusive`. */
  min?: number;
  minExclusive?: boolean;
  max?: number;
  maxExclusive?: boolean;
  integer?: boolean;
}

export interface ProcessDefinition {
  id: string;
  name: string;
  category: ProcessCategory;
  /** Plain-language description of what the process models. */
  description: string;
  /** Defining equation in conventional notation. */
  formula: string;
  /** Index set / state space description. */
  stateSpaceText: string;
  params: ProcessParamSpec[];
  /** What must be true of the world for this process to apply. */
  assumptions: string[];
  /** Where the model is known to be wrong or inapplicable. */
  limitations: string[];
  /** Closed forms the module provides for this process. */
  exactResults: string[];
}

/** A single number together with how it was obtained. */
export interface Quantity {
  label: string;
  value: number;
  exactness: Exactness;
  /** Formula or method used, for display next to the number. */
  formula?: string;
  note?: string;
}

export function quantity(
  label: string,
  value: number,
  exactness: Exactness,
  extra: { formula?: string; note?: string } = {},
): Quantity {
  return { label, value, exactness, ...extra };
}

/** A Gaussian law, used for the many processes whose marginals are normal. */
export interface NormalLaw {
  mean: number;
  variance: number;
  sd: number;
  exactness: Exactness;
  formula: string;
}

/** One simulated trajectory sampled on a time grid. */
export interface Path {
  times: number[];
  values: number[];
}

/**
 * A set of simulated paths on a common time grid.
 *
 * `partial` is true when the run was cancelled or stopped short; every
 * statistic derived from a partial ensemble is labelled as such rather than
 * presented as the requested run.
 */
export interface PathEnsemble {
  times: number[];
  /** paths[i][j] is path i at times[j]. */
  paths: number[][];
  pathsRequested: number;
  pathsCompleted: number;
  partial: boolean;
  seed: string;
}

export interface RunHooks {
  onProgress?(p: { completed: number; total: number }): void;
  /** Checked between chunks; returning true stops the run. */
  isCancelled?(): boolean;
}
