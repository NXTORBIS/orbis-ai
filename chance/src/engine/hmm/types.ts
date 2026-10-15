/**
 * Hidden Markov model types and the emission interface.
 *
 * A model is a plain serialisable object so the same definition can be used on
 * the main thread, inside the simulation worker and in tests.
 *
 * Observations are always encoded as numbers:
 *  - discrete emissions: the observation is an integer index into `symbols`;
 *  - Gaussian emissions: the observation is the measured real value.
 *
 * New emission families are added by extending `EmissionModel` and adding one
 * case to `emissionOps` / `reestimateEmission`; nothing else in the module
 * needs to change.
 */
import type { Matrix } from '../stats/linalg';

/** Categorical emissions: B[state][symbol]. */
export interface DiscreteEmission {
  kind: 'discrete';
  symbols: string[];
  /** Row per hidden state, column per symbol; each row sums to 1. */
  matrix: Matrix;
}

/** Univariate Gaussian emissions, one mean and variance per hidden state. */
export interface GaussianEmission {
  kind: 'gaussian';
  mean: number[];
  variance: number[];
}

export type EmissionModel = DiscreteEmission | GaussianEmission;

export interface HmmModel {
  stateNames: string[];
  /** Initial distribution π over hidden states; sums to 1. */
  initial: number[];
  /** Transition matrix A[i][j] = P(q_{t+1}=j | q_t=i); rows sum to 1. */
  transition: Matrix;
  emission: EmissionModel;
}

/** The operations the sequence algorithms need from an emission family. */
export interface EmissionOps {
  kind: string;
  /** Number of hidden states the emission model is defined for. */
  states: number;
  /** log P(observation | state). −Infinity is allowed (impossible symbol). */
  logProb(state: number, observation: number): number;
  /** Free parameters, for AIC/BIC. */
  freeParameters(): number;
  /** Checks a raw observation is in the support; throws EngineError if not. */
  checkObservation(observation: number, index: number): void;
  /** A human description of the emission model. */
  describe(): string;
}
