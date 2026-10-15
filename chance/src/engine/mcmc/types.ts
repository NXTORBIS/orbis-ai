/**
 * Markov chain Monte Carlo: shared types.
 *
 * MCMC removes the conjugacy restriction of `src/engine/probability/bayesian.ts`:
 * any prior with any likelihood, as long as the unnormalised posterior
 * log-density can be evaluated pointwise. In exchange every number produced
 * here is `empirical` — a sampling estimate carrying Monte Carlo error — and
 * is only meaningful once the convergence diagnostics say the chains have
 * mixed. A summary is never reported without its verdict attached.
 */
import type { Matrix } from '../stats/linalg';
import type { Random } from '../random/rng';

/** Unnormalised log posterior density over R^d. May return -Infinity outside the support. */
export type LogDensity = (x: readonly number[]) => number;

/** Gradient of the log density; must return d finite components inside the support. */
export type GradLogDensity = (x: readonly number[]) => number[];

/**
 * A full conditional draw for Gibbs sampling: returns a new value for
 * coordinate `index` given the current value of every other coordinate.
 * The caller supplies these; the engine cannot derive them.
 */
export type FullConditional = (state: readonly number[], rng: Random) => number;

export interface TargetSpec {
  readonly id: string;
  readonly name: string;
  /** Number of parameters, d >= 1. */
  readonly dimension: number;
  readonly parameterNames: readonly string[];
  readonly logDensity: LogDensity;
  /** Analytic gradient, when available. HMC falls back to finite differences otherwise. */
  readonly gradLogDensity?: GradLogDensity;
  /** Suggested dispersed starting points, one per chain (reused cyclically). */
  readonly suggestedStarts?: readonly (readonly number[])[];
  /** Full conditionals, required only by the Gibbs sampler. */
  readonly fullConditionals?: readonly FullConditional[];
  /** What the parameters mean, for the explanation. */
  readonly description?: string;
}

export interface MetropolisConfig {
  readonly kind: 'metropolis';
  /** Scalar multiplier on the proposal standard deviations. */
  readonly proposalScale?: number;
  /** Per-coordinate proposal standard deviations (diagonal proposal). */
  readonly proposalSd?: readonly number[];
  /** Full proposal covariance; takes precedence over `proposalSd`. */
  readonly proposalCovariance?: Matrix;
}

export interface AdaptiveMetropolisConfig {
  readonly kind: 'adaptive-metropolis';
  readonly initialScale?: number;
  /**
   * Target acceptance rate. Defaults to 0.44 in one dimension and 0.234 in
   * higher dimensions (Roberts & Rosenthal 2001).
   */
  readonly targetAcceptance?: number;
}

export interface HmcConfig {
  readonly kind: 'hmc';
  readonly stepSize?: number;
  readonly leapfrogSteps?: number;
  readonly targetAcceptance?: number;
  /**
   * Force the finite-difference gradient even when an analytic one exists.
   * The numerical gradient is slower (2d density evaluations per leapfrog
   * step) and less accurate; it is reported as such.
   */
  readonly useNumericalGradient?: boolean;
  readonly finiteDifferenceStep?: number;
}

export interface SliceConfig {
  readonly kind: 'slice';
  /** Initial stepping-out width per coordinate. */
  readonly width?: number;
  readonly maxStepOut?: number;
}

export interface GibbsConfig {
  readonly kind: 'gibbs';
  /** Overrides `target.fullConditionals` when given. */
  readonly conditionals?: readonly FullConditional[];
}

export type SamplerConfig =
  | MetropolisConfig
  | AdaptiveMetropolisConfig
  | HmcConfig
  | SliceConfig
  | GibbsConfig;

export interface McmcRequest {
  readonly target: TargetSpec;
  readonly sampler: SamplerConfig;
  /** Number of independent chains, at least 1 (at least 2 for R-hat). */
  readonly chains: number;
  /** Retained draws per chain, after warm-up and thinning. */
  readonly iterations: number;
  /** Warm-up iterations per chain; adaptation happens here and only here. */
  readonly warmup?: number;
  /** Keep every `thin`-th draw. Thinning never improves ESS; it only saves memory. */
  readonly thin?: number;
  readonly seed: string;
  /** Explicit dispersed starting points, one per chain. */
  readonly initialPoints?: readonly (readonly number[])[];
  /** Iterations between generator yields. */
  readonly chunkSize?: number;
  /** Spread of the automatic dispersed starts (in units of the start scale). */
  readonly startDispersion?: number;
}

export interface SamplerStats {
  proposals: number;
  accepted: number;
  /** HMC only: leapfrog trajectories whose energy error was not acceptable. */
  divergences: number;
  logDensityEvaluations: number;
  gradientEvaluations: number;
}

export interface ChainOutput {
  readonly chain: number;
  readonly start: readonly number[];
  /** Retained draws, indexed [parameter][iteration]. */
  readonly draws: Float64Array[];
  /** Log density at each retained draw. */
  readonly logDensity: Float64Array;
  readonly acceptanceRate: number;
  /** Divergences in the sampling phase. These are the ones that matter. */
  readonly divergences: number;
  /**
   * Divergences during warm-up. Expected while the step size is still being
   * tuned, so they are counted separately and do not drive the verdict.
   */
  readonly warmupDivergences: number;
  readonly warmupAcceptanceRate: number;
  /** Frozen tuning parameters at the end of warm-up. */
  readonly tuning: Readonly<Record<string, number>>;
  readonly stats: Readonly<SamplerStats>;
}

export interface AutocorrelationData {
  readonly lags: number[];
  readonly values: number[];
}

export interface ParameterDiagnostics {
  readonly parameter: string;
  /** Classic Gelman–Rubin R-hat on the chains as given. */
  readonly rHat: number;
  /** R-hat after splitting each chain in half; detects within-chain drift. */
  readonly splitRHat: number;
  /** Rank-normalised split R-hat (bulk and tail), Vehtari et al. 2021. */
  readonly rankNormalisedRHat: number;
  /** The figure the verdict uses: the largest of the three. */
  readonly worstRHat: number;
  readonly effectiveSampleSize: number;
  readonly effectiveSampleSizePerSecond: number;
  /** Integrated autocorrelation time, tau = N / ESS. */
  readonly integratedAutocorrelationTime: number;
  /** Monte Carlo standard error of the posterior mean, sd / sqrt(ESS). */
  readonly mcseMean: number;
  readonly autocorrelation: AutocorrelationData;
}

export interface Interval {
  readonly lower: number;
  readonly upper: number;
  readonly level: number;
}

export interface ParameterSummary {
  readonly parameter: string;
  readonly mean: number;
  readonly sd: number;
  readonly median: number;
  readonly quantiles: { readonly p: number; readonly value: number }[];
  /**
   * Equal-tailed credible interval: equal posterior probability excluded in
   * each tail. Not the same statement as the HDI.
   */
  readonly equalTailedInterval: Interval;
  /**
   * Highest density interval: the shortest interval containing the given
   * probability. Every point inside has higher posterior density than any
   * point outside. For a skewed posterior this differs from the equal-tailed
   * interval, and for a multimodal posterior a single interval is misleading.
   */
  readonly highestDensityInterval: Interval;
  readonly draws: number;
}

export type ConvergenceVerdict = 'converged' | 'marginal' | 'not converged';

export interface ConvergenceAssessment {
  readonly verdict: ConvergenceVerdict;
  /** Plain statement of what the verdict means for the numbers below it. */
  readonly headline: string;
  readonly reasons: string[];
  readonly worstRHat: number;
  readonly worstRHatParameter: string;
  readonly lowestEffectiveSampleSize: number;
  readonly lowestEffectiveSampleSizeParameter: string;
  readonly thresholds: { readonly rHat: number; readonly ess: number };
  readonly divergences: number;
}

export interface PlotData {
  readonly parameter: string;
  /** One trace per chain: the retained draws in order. */
  readonly trace: number[][];
  /** Running mean per chain; a converged chain's running means coincide. */
  readonly runningMean: number[][];
  /** Rank plot: histogram of within-pool ranks per chain; uniform when mixed. */
  readonly rankHistogram: { readonly binCentres: number[]; readonly counts: number[][] };
  readonly autocorrelation: AutocorrelationData;
}

export interface McmcResult {
  readonly target: string;
  readonly samplerLabel: string;
  readonly parameterNames: string[];
  readonly chains: ChainOutput[];
  readonly diagnostics: ParameterDiagnostics[];
  readonly summaries: ParameterSummary[];
  readonly convergence: ConvergenceAssessment;
  readonly plots: PlotData[];
  readonly drawsPerChain: number;
  readonly totalDraws: number;
  readonly warmup: number;
  readonly thin: number;
  readonly elapsedMs: number;
  readonly acceptanceRate: number;
  readonly divergences: number;
  /** True when the run was cancelled: the draws below are an incomplete chain. */
  readonly partial: boolean;
  readonly warnings: string[];
  readonly explanation: import('../core/result').Explanation;
}

export interface McmcProgress {
  readonly phase: 'warmup' | 'sampling';
  readonly chain: number;
  readonly chains: number;
  readonly chainIteration: number;
  readonly chainTotal: number;
  readonly completedIterations: number;
  readonly totalIterations: number;
}

export interface McmcHooks {
  onProgress?(p: McmcProgress): void;
  /** Checked between chunks; returning true stops the run with partial results. */
  isCancelled?(): boolean;
}

export const MCMC_LIMITS = {
  maxChains: 16,
  maxIterations: 200_000,
  maxStoredValues: 8_000_000,
  defaultChunkSize: 250,
  maxAutocorrelationLag: 120,
} as const;
