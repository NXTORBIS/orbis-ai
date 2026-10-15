/**
 * Static registry of engine jobs, used by the worker, by the main-thread
 * fallback and by tests. Jobs are looked up by id, the same convention as
 * `src/engine/simulation/registry.ts`: it is what keeps one implementation
 * runnable in all three places. Add new jobs here.
 */
import { EngineError } from '../core/result';
import { baumWelchJob, type BaumWelchJobPayload } from './hmm-jobs';
import { gpFitHyperparametersJob, type GpFitJobPayload, type GpFitJobResult } from './gp-jobs';
import { stateSpaceEmJob, type StateSpaceEmJobPayload } from './filtering-jobs';
import type { AnyEngineJob } from './types';
import type { BaumWelchResult } from '../hmm/learn';
import type { EmResult } from '../filtering/types';

export const ENGINE_JOBS: AnyEngineJob[] = [baumWelchJob, gpFitHyperparametersJob, stateSpaceEmJob];

const BY_ID = new Map(ENGINE_JOBS.map((j) => [j.id, j]));

export function getEngineJob(id: string): AnyEngineJob {
  const job = BY_ID.get(id);
  if (!job) throw new EngineError(`Unknown engine job "${id}".`, 'unknown');
  return job;
}

export function hasEngineJob(id: string): boolean {
  return BY_ID.has(id);
}

/**
 * The payload and result type of every registered job, so a caller gets the
 * right types from the job id alone.
 */
export interface EngineJobTypes {
  'hmm.baum-welch': { payload: BaumWelchJobPayload; result: BaumWelchResult };
  'gp.fit-hyperparameters': { payload: GpFitJobPayload; result: GpFitJobResult };
  'filtering.em': { payload: StateSpaceEmJobPayload; result: EmResult };
}

export type EngineJobId = keyof EngineJobTypes;
export type EngineJobPayload<K extends EngineJobId> = EngineJobTypes[K]['payload'];
export type EngineJobResult<K extends EngineJobId> = EngineJobTypes[K]['result'];
