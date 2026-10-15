/**
 * Stochastic processes: probability evolving over time.
 *
 * Every other part of the engine answers a static question — one distribution,
 * one experiment, one simulated outcome. This module adds the time dimension:
 * trajectories, first-passage times and time-dependent probabilities.
 *
 * Three principles hold throughout:
 *
 *  1. Exact where exact is possible. Marginal laws, stationary laws,
 *     reflection-principle first-passage probabilities, gambler's-ruin
 *     probabilities and durations, and compound-Poisson moments are closed
 *     forms. Matrix exponentials, numerical integrals of an intensity,
 *     Euler–Maruyama and fixed-point iterations are 'numerical'. Simulated
 *     paths are 'empirical'.
 *  2. No plausible-looking numbers. A non-stationary AR(1), a negative rate,
 *     an invalid generator, a violated thinning bound and a non-convergent
 *     extinction iteration each raise an `EngineError` saying what is wrong.
 *  3. Long simulations are generators that yield between chunks, as in
 *     `src/engine/simulation/runner.ts`, so a Web Worker can be cancelled. A
 *     cancelled run returns what it finished, marked partial.
 */
export * from './types';
export * from './ensemble';
export * from './counting';
export * from './diffusions';
export * from './discrete';
export * from './ctmc';

import { EngineError } from '../core/result';
import type { ProcessDefinition } from './types';
import { compoundPoissonDefinition, nonHomogeneousPoissonDefinition, poissonProcessDefinition, renewalProcessDefinition } from './counting';
import { brownianMotionDefinition, geometricBrownianDefinition, jumpDiffusionDefinition, ornsteinUhlenbeckDefinition } from './diffusions';
import { ar1Definition, branchingProcessDefinition, randomWalkDefinition } from './discrete';
import { ctmcDefinition } from './ctmc';

/** Every process definition, for listing in an interface. */
export const PROCESS_DEFINITIONS: ProcessDefinition[] = [
  poissonProcessDefinition,
  nonHomogeneousPoissonDefinition,
  compoundPoissonDefinition,
  renewalProcessDefinition,
  brownianMotionDefinition,
  geometricBrownianDefinition,
  ornsteinUhlenbeckDefinition,
  jumpDiffusionDefinition,
  randomWalkDefinition,
  ar1Definition,
  branchingProcessDefinition,
  ctmcDefinition,
];

export function getProcessDefinition(id: string): ProcessDefinition {
  const found = PROCESS_DEFINITIONS.find((d) => d.id === id);
  if (!found) {
    throw new EngineError(
      `Unknown process "${id}". Available processes: ${PROCESS_DEFINITIONS.map((d) => d.id).join(', ')}.`,
      'unknown',
    );
  }
  return found;
}

/** Processes for which this module provides an exact first-passage result. */
export const EXACT_FIRST_PASSAGE_PROCESSES = ['brownian-motion', 'gbm', 'random-walk'] as const;
