/**
 * Types for engine jobs: long computations that are too slow to run on the
 * main thread.
 *
 * A job is a serialisable payload plus an id. The id is looked up in
 * `registry.ts`, exactly as a simulation model is looked up from
 * `src/engine/simulation/registry.ts`, so the same job runs unchanged in the
 * worker, on the main thread when no worker can be created, and in tests.
 *
 * Two rules make this work and both are load-bearing:
 *
 *  1. A job is a **generator** that yields between chunks of work. A worker
 *     blocked in a synchronous loop can never receive a `cancel` message, and
 *     `SharedArrayBuffer` is unavailable unless the page is cross-origin
 *     isolated, so yielding is the only way cancellation can take effect.
 *  2. Payloads and results are **plain data**, because they cross a
 *     `postMessage` boundary. A job must never return a value carrying
 *     functions (a compiled kernel, a closure); it returns the numbers needed
 *     to rebuild such a thing cheaply on the other side.
 */
import { EngineError } from '../core/result';
import type { JobProgress } from '../core/progress';

export type { JobProgress };

export interface EngineJobContext {
  /**
   * Checked by jobs that call into engine routines taking their own
   * cancellation flag. The driver also checks between yields, so a job that
   * only yields is still cancellable.
   */
  isCancelled?(): boolean;
}

/**
 * A job definition. `run` receives the payload as it arrived over
 * `postMessage` — that is, as untyped data — so it validates it first and
 * throws an `EngineError` naming what is missing rather than computing with a
 * plausible-looking substitute.
 */
export interface EngineJobDef<P, R> {
  readonly id: string;
  /** Short human-readable name, used in progress text and error messages. */
  readonly label: string;
  /** Narrow untyped input to the payload type, or throw an EngineError. */
  parse(payload: unknown): P;
  run(payload: P, context: EngineJobContext): Generator<JobProgress, R, void>;
}

/** A job whose payload and result types are erased, as the registry holds it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyEngineJob = EngineJobDef<any, any>;

/** Helper for the small amount of validation every job payload needs. */
export function requireObject(payload: unknown, jobLabel: string): Record<string, unknown> {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new EngineError(`The ${jobLabel} job needs an object payload; received ${payload === null ? 'null' : Array.isArray(payload) ? 'an array' : typeof payload}.`, 'payload');
  }
  return payload as Record<string, unknown>;
}

export function requireNumberArray(value: unknown, what: string): number[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
    throw new EngineError(`${what} must be an array of finite numbers.`, 'payload');
  }
  return value as number[];
}
