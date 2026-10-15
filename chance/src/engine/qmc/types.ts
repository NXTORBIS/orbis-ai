/**
 * Shared types for the quasi-Monte Carlo and variance-reduction module.
 *
 * ## The one thing to read before using this module
 *
 * A QMC point set is NOT a random stream. The points of a Sobol, Halton,
 * Faure or lattice point set are deliberately correlated with one another:
 * that correlation is exactly what makes them fill the cube more evenly than
 * random points, and it is the whole source of the accuracy gain. Consequences
 * that bite in practice:
 *
 *  1. A QMC point set is defined for a FIXED dimension d. Consuming its
 *     coordinates as if they were an endless stream of independent uniforms
 *     (for example feeding it to a rejection sampler, or to a model that draws
 *     a variable number of uniforms per trial) silently destroys the structure
 *     and can bias the answer. `QmcStream` exists for the narrow case of a
 *     model that consumes exactly d uniforms per trial, in the same order,
 *     every trial; it refuses to wrap around.
 *  2. An UNRANDOMISED QMC estimate has no statistical error estimate at all.
 *     The samples are not independent, so the usual s/√N standard error is
 *     meaningless — it is not conservative, it is simply not a statement about
 *     anything. This module therefore refuses to produce one, and reports
 *     `standardError: null` with a reason instead.
 *  3. The only valid error estimate for QMC is the spread ACROSS INDEPENDENT
 *     RANDOMISATIONS of the same point set (randomised QMC, "RQMC"). Use
 *     `randomisedQmcIntegrate` with R ≥ 8 replications. A single randomised
 *     replication is still one sample: it also has no error estimate.
 */
import type { Exactness } from '../core/result';

/** A deterministic or randomised point set in [0,1)^d, addressed by index. */
export interface PointSequence {
  /** Human-readable construction name, including the randomisation used. */
  readonly name: string;
  readonly dimension: number;
  /**
   * True when the construction carries an independent random element (digital
   * shift, Owen scramble, random digit permutation, random lattice shift,
   * stratified jitter). ONLY a randomised sequence can support a statistical
   * error estimate, and then only across independent replications.
   */
  readonly randomised: boolean;
  /** Writes point `index` into `out` (length ≥ dimension). */
  fill(index: number, out: Float64Array): void;
  /** Convenience: a freshly allocated point. */
  point(index: number): Float64Array;
}

/** Materialised point set, row-major: point i occupies [i*d, (i+1)*d). */
export interface PointSet {
  readonly name: string;
  readonly dimension: number;
  readonly count: number;
  readonly randomised: boolean;
  readonly values: Float64Array;
}

/** How the error bar on an estimate was obtained — or why there isn't one. */
export type ErrorBasis =
  | { kind: 'iid'; note: string }
  | { kind: 'replications'; replications: number; note: string }
  | { kind: 'unavailable'; reason: string };

export interface EstimateReport {
  /** Construction / technique that produced the estimate. */
  method: string;
  estimate: number;
  /** Standard error, or null when none can honestly be given. */
  standardError: number | null;
  errorBasis: ErrorBasis;
  /** Integrand evaluations actually spent. */
  evaluations: number;
  exactness: Exactness;
  warnings: string[];
}

/**
 * Measured efficiency of a variance-reduction technique. Every field here is
 * computed from the run that produced it; none is a theoretical assertion.
 */
export interface EfficiencyReport {
  /** Per-evaluation variance of the plain Monte Carlo estimator, measured. */
  baselineVariancePerEval: number;
  /** Per-evaluation variance of this technique's estimator, measured. */
  methodVariancePerEval: number;
  /**
   * baselineVariancePerEval / methodVariancePerEval. Greater than 1 means the
   * technique helped at equal evaluation budget; LESS than 1 means it HURT.
   */
  varianceReductionFactor: number;
  /**
   * Equivalent number of plain Monte Carlo evaluations this run bought:
   * evaluations × varianceReductionFactor.
   */
  effectiveSampleSize: number;
  /** effectiveSampleSize − evaluations, the sample-count gain (may be negative). */
  effectiveSampleSizeGain: number;
}

export interface VarianceReductionResult extends EstimateReport {
  efficiency: EfficiencyReport;
  /** Technique-specific measured diagnostics (correlations, coefficients, ESS). */
  diagnostics: Record<string, number>;
}
