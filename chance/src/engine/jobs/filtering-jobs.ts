/** Engine jobs for linear-Gaussian state-space models. */
import { EngineError } from '../core/result';
import { emSteps, type EmOptions } from '../filtering/em';
import type { EmResult, LinearGaussianModel, Observation } from '../filtering/types';
import { requireObject, type EngineJobDef } from './types';

export interface StateSpaceEmJobPayload {
  initial: LinearGaussianModel;
  observations: Observation[];
  options?: Pick<EmOptions, 'maxIterations' | 'tolerance' | 'update'>;
}

/**
 * EM for a linear-Gaussian state-space model. Each iteration is a complete
 * Kalman smoother pass over the whole series; `emSteps` already yields between
 * iterations, so it is used unchanged.
 */
export const stateSpaceEmJob: EngineJobDef<StateSpaceEmJobPayload, EmResult> = {
  id: 'filtering.em',
  label: 'state-space EM fit',
  parse(payload) {
    const o = requireObject(payload, 'state-space EM fit');
    if (o.initial === null || typeof o.initial !== 'object') {
      throw new EngineError('The EM job needs a starting model with A, C, Q, R, mu0 and Sigma0.', 'payload');
    }
    if (!Array.isArray(o.observations)) {
      throw new EngineError('The EM job needs the observation series as an array; a missing step is null rather than absent.', 'payload');
    }
    return {
      initial: o.initial as LinearGaussianModel,
      observations: o.observations as Observation[],
      options: (o.options as StateSpaceEmJobPayload['options']) ?? {},
    };
  },
  run(payload) {
    return emSteps(payload.initial, payload.observations, payload.options ?? {});
  },
};
