/** Static registry of simulation models, used by the runner and the worker. */
import { EngineError } from '../core/result';
import { scenarioModel } from '../scenario/model';
import type { SimulationModelDef } from './types';

/**
 * A model whose configuration type is erased. The runner receives configuration
 * as JSON from the UI or a worker message, so each model validates its own
 * configuration before use.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyModel = SimulationModelDef<any>;
import { diceSumModel, markovModel, piModel, projectModel, queueModel, riskAggregateModel, samplingModel } from './models';
import { experimentModel } from '../experiments/model';
import { bootstrapModel, permutationTestModel } from '../stats/resampling-models';

export const SIMULATION_MODELS: AnyModel[] = [
  piModel,
  diceSumModel,
  projectModel,
  queueModel,
  markovModel,
  riskAggregateModel,
  samplingModel,
  scenarioModel,
  experimentModel,
  bootstrapModel,
  permutationTestModel,
];

const BY_ID = new Map(SIMULATION_MODELS.map((m) => [m.id, m]));

export function getSimulationModel(id: string): AnyModel {
  const m = BY_ID.get(id);
  if (!m) throw new EngineError(`Unknown simulation model "${id}".`, 'unknown');
  return m;
}

export function hasSimulationModel(id: string): boolean {
  return BY_ID.has(id);
}
