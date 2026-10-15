/**
 * Reusable Monte Carlo simulation framework — type definitions.
 *
 * A simulation model is a pure, serialisable description: a model id plus a
 * JSON configuration. The model definition validates the configuration and
 * "prepares" a trial function. The runner executes trials with a seeded RNG,
 * records every output, and summarises results. Because models are looked up
 * by id from a static registry, the same code runs in a Web Worker and in
 * tests.
 */
import type { Issue } from '../core/result';
import type { Random } from '../random/rng';
import type { HistogramBin, Interval, SampleSummary, FrequencyRow } from '../stats/descriptive';

export type OutputKind = 'continuous' | 'discrete' | 'indicator';

export interface OutputSpec {
  key: string;
  label: string;
  kind: OutputKind;
  unit?: string;
  /** 'input' columns record sampled inputs (used for sensitivity/rank correlation). */
  role?: 'output' | 'input';
  description?: string;
}

/** Known exact values to compare simulation estimates against. */
export interface TheoreticalValue {
  mean?: number;
  /** For indicator outputs: the exact probability. */
  probability?: number;
  variance?: number;
  /** Explanation of where the value comes from. */
  source: string;
}

export interface PreparedModel {
  outputs: OutputSpec[];
  /** Run one trial, writing one value per output (same order as `outputs`). */
  runTrial(rng: Random, out: Float64Array): void;
  theoretical?: Record<string, TheoreticalValue>;
  /** Assumptions implied by this configuration, shown with the results. */
  assumptions: string[];
  /** Optional procedure description shown in the explanation panel. */
  procedure: string;
}

export interface SimulationModelDef<C = unknown> {
  id: string;
  name: string;
  description: string;
  validate(config: C): Issue[];
  prepare(config: C): PreparedModel;
}

export interface SimulationRequest {
  modelId: string;
  config: unknown;
  trials: number;
  seed: string;
  /** Keep raw samples in the result (needed for sensitivity / risk metrics). */
  keepSamples?: boolean;
  /** Stop early once every indicator/mean CI half-width is below this value. */
  targetPrecision?: number;
}

export interface ConvergencePoint {
  n: number;
  estimate: number;
  low: number;
  high: number;
}

export interface OutputResult {
  spec: OutputSpec;
  summary: SampleSummary;
  /** Monte Carlo confidence interval for the expected value (or probability). */
  estimateInterval: Interval;
  histogram: HistogramBin[];
  ecdf: { x: number; p: number }[];
  frequencies: FrequencyRow[] | null;
  convergence: ConvergencePoint[];
  theoretical?: TheoreticalValue;
  /** Count of non-finite trial values (excluded from the summary). */
  nonFinite: number;
  warnings: string[];
}

export interface SimulationResult {
  modelId: string;
  config: unknown;
  seed: string;
  trialsRequested: number;
  trialsCompleted: number;
  cancelled: boolean;
  stoppedEarly: boolean;
  durationMs: number;
  outputs: OutputResult[];
  assumptions: string[];
  procedure: string;
  /** Raw samples by output key, present when keepSamples was requested. */
  samples?: Record<string, Float64Array>;
  warnings: string[];
}

export interface RunProgress {
  completed: number;
  total: number;
}

export const SIMULATION_LIMITS = {
  maxTrials: 2_000_000,
  /** Total stored values across outputs (trials × outputs). */
  maxStoredValues: 8_000_000,
  chunkSize: 5_000,
  convergencePoints: 160,
};
