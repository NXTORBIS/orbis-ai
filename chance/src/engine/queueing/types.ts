/**
 * Analytic queueing theory — shared types.
 *
 * Every queue in this module is described by a uniform `QueueModelDef`: an id,
 * a human name, Kendall notation, a parameter specification, the assumptions
 * the formulas rest on, and their limitations. `analyse` either returns a
 * complete `QueueAnalysis` or throws an `EngineError`; it never returns a
 * plausible-looking number for a configuration that has no steady state.
 */
import type { Explanation, Issue } from '../core/result';

export type QueueParamKind = 'rate' | 'time' | 'count' | 'scv' | 'variance' | 'cost' | 'probability';

export interface QueueParamSpec {
  key: string;
  label: string;
  kind: QueueParamKind;
  description: string;
  /** Inclusive lower bound on accepted values, when one applies. */
  min?: number;
  integer?: boolean;
  optional?: boolean;
}

/**
 * Internal consistency check of Little's law against the model's own output.
 * Finite-capacity and finite-population queues must use the EFFECTIVE arrival
 * rate (arrivals actually admitted), not the offered rate.
 */
export interface LittlesLawCheck {
  /** Arrival rate used in the identity (effective rate where they differ). */
  arrivalRate: number;
  L: number;
  lambdaW: number;
  /** Absolute difference |L − λW|. */
  systemResidual: number;
  Lq: number;
  lambdaWq: number;
  queueResidual: number;
  tolerance: number;
  holds: boolean;
  note: string;
}

/** Steady-state number-in-system distribution, truncated for display. */
export interface StateProbability {
  n: number;
  p: number;
}

export interface QueueMetrics {
  /** Offered arrival rate λ (before any blocking). */
  arrivalRate: number;
  /** Arrival rate actually admitted; equals λ for infinite-capacity queues. */
  effectiveArrivalRate: number;
  /** Service rate per busy server μ. */
  serviceRate: number;
  /** Mean service time E[S] = 1/μ. */
  meanServiceTime: number;
  servers: number;
  /** System capacity (customers in system), or null when unlimited. */
  capacity: number | null;
  /** Calling population size, or null when unlimited. */
  population: number | null;
  /** Offered load a = λ/μ, in erlangs. */
  offeredLoad: number;
  /** Server utilisation ρ (per server, computed from the effective rate). */
  utilisation: number;
  /** Probability an arrival is turned away; null when nothing can be blocked. */
  blockingProbability: number | null;
  /** Customers served per unit time in steady state. */
  throughput: number;
  /** Mean number in system. */
  L: number;
  /** Mean number waiting (excluding those in service). */
  Lq: number;
  /** Mean time in system (wait + service). */
  W: number;
  /** Mean time waiting before service. */
  Wq: number;
  /** P(an admitted arrival has to wait at all); null when not available. */
  probabilityOfWaiting: number | null;
  /** Steady-state P(n in system); truncated for infinite-capacity queues. */
  distribution: StateProbability[];
  /** True when `distribution` is a truncation of an infinite tail. */
  distributionTruncated: boolean;
  littlesLaw: LittlesLawCheck;
}

/**
 * Exact waiting-time distribution, where one is available in closed form.
 * `queueWait` is the time before service starts; `systemTime` is the total
 * sojourn time. Both are reported separately because they are different
 * statements about the queue.
 */
export interface WaitingTimeDistribution {
  /** Which quantity the functions describe. */
  quantity: 'queueWait' | 'systemTime';
  mean: number;
  /** P(wait > t). */
  tail(t: number): number;
  /** Smallest t with P(wait ≤ t) ≥ p. Returns 0 where there is an atom at 0. */
  quantile(p: number): number;
  /** Probability mass at exactly zero wait (no waiting at all). */
  atomAtZero: number;
  description: string;
}

export interface QueueAnalysis {
  modelId: string;
  modelName: string;
  kendall: string;
  metrics: QueueMetrics;
  /** Present only where a closed-form waiting-time law exists. */
  queueWait?: WaitingTimeDistribution;
  systemTime?: WaitingTimeDistribution;
  explanation: Explanation;
}

export interface QueueModelDef<C> {
  id: string;
  name: string;
  description: string;
  /** Kendall notation, e.g. "M/M/c/K". */
  kendall: string;
  params: QueueParamSpec[];
  assumptions: string[];
  limitations: string[];
  /** Collect configuration problems without throwing. */
  validate(config: C): Issue[];
  /** Analyse the queue, or throw an `EngineError` explaining what is wrong. */
  analyse(config: C): QueueAnalysis;
}
