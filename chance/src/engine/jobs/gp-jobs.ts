/** Engine jobs for Gaussian process regression. */
import { EngineError } from '../core/result';
import { fitHyperparametersSteps, type FitOptions, type GpModelRequest } from '../gp/regression';
import type { FitReport } from '../gp/types';
import { requireObject, type EngineJobDef } from './types';

export interface GpFitJobPayload {
  request: GpModelRequest;
  options?: FitOptions;
}

/**
 * The result deliberately does NOT contain the fitted `GpModel`. A `GpModel`
 * holds a compiled kernel with methods on it, which cannot cross a
 * `postMessage` boundary; what crosses is the fitted parameter values, and the
 * caller rebuilds the model with one `conditionGp` call — a single Cholesky
 * factorisation, next to nothing beside the multi-restart optimisation.
 */
export interface GpFitJobResult {
  fit: FitReport;
  /** Fitted kernel parameter values, in kernel slot order. */
  kernelValues: number[];
  /** Fitted noise variance, or the supplied one when the noise was held fixed. */
  noiseVariance: number;
  /** Names of the free log-parameters that were optimised. */
  names: string[];
}

export const gpFitHyperparametersJob: EngineJobDef<GpFitJobPayload, GpFitJobResult> = {
  id: 'gp.fit-hyperparameters',
  label: 'Gaussian process hyperparameter fit',
  parse(payload) {
    const o = requireObject(payload, 'Gaussian process hyperparameter fit');
    const request = o.request;
    if (request === null || typeof request !== 'object') {
      throw new EngineError('The hyperparameter fit job needs a model request with X, y, a kernel specification and a noise variance.', 'payload');
    }
    const r = request as Record<string, unknown>;
    if (!Array.isArray(r.X) || !Array.isArray(r.y)) {
      throw new EngineError('The hyperparameter fit job needs the training inputs X and outputs y as arrays.', 'payload');
    }
    if (r.kernel === null || typeof r.kernel !== 'object') {
      throw new EngineError('The hyperparameter fit job needs a kernel specification.', 'payload');
    }
    if (typeof r.noiseVariance !== 'number' || !Number.isFinite(r.noiseVariance)) {
      throw new EngineError('The hyperparameter fit job needs a finite noise variance.', 'payload');
    }
    return { request: request as GpModelRequest, options: (o.options as FitOptions | undefined) ?? {} };
  },
  *run(payload) {
    const steps = fitHyperparametersSteps(payload.request, payload.options ?? {});
    let step = steps.next();
    while (!step.done) {
      yield step.value;
      step = steps.next();
    }
    const { model, fit, objective } = step.value;
    return {
      fit,
      kernelValues: Array.from(model.kernel.values),
      noiseVariance: model.noiseVariance,
      names: Array.from(objective.names),
    };
  },
};
