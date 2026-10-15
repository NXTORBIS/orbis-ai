/**
 * Main-thread client for the simulation worker.
 *
 * Falls back to running on the main thread when Workers are unavailable (and
 * says so), because correctness matters more than responsiveness: the
 * alternative would be a tool that silently does nothing.
 */
import { runSimulation, validateRequest } from '../engine/simulation/runner';
import { runSobol, runSweep, runTornado, type SobolRequest, type SobolResult, type SweepRequest, type SweepResult, type TornadoRequest, type TornadoResult } from '../engine/sensitivity/sensitivity';
import { EngineError, type Issue } from '../engine/core/result';
import type { SimulationRequest, SimulationResult } from '../engine/simulation/types';
import type { WorkerCommand, WorkerEvent } from './simulation.worker';

export interface JobHandle<T> {
  promise: Promise<T>;
  cancel(): void;
}

export interface JobOptions {
  onProgress?(completed: number, total: number): void;
}

type PendingJob = {
  resolve(value: unknown): void;
  reject(error: unknown): void;
  onProgress?: (completed: number, total: number) => void;
  cancelFlag?: Int32Array;
};

export class SimulationClient {
  private worker: Worker | null = null;
  private readonly jobs = new Map<string, PendingJob>();
  private counter = 0;
  /** Set when the worker could not be created; work then runs on the main thread. */
  readonly fallbackReason: string | null;

  constructor() {
    let reason: string | null = null;
    if (typeof Worker === 'undefined') {
      reason = 'This browser does not support Web Workers, so simulations run on the main thread and the interface may pause during long runs.';
    } else {
      try {
        this.worker = new Worker(new URL('./simulation.worker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e: MessageEvent<WorkerEvent>) => this.handleEvent(e.data);
        this.worker.onerror = (e) => this.failAll(`The simulation worker stopped unexpectedly: ${e.message || 'unknown error'}.`);
      } catch (e) {
        this.worker = null;
        reason = `The simulation worker could not be started (${e instanceof Error ? e.message : String(e)}), so simulations run on the main thread.`;
      }
    }
    this.fallbackReason = reason;
  }

  get usesWorker(): boolean {
    return this.worker !== null;
  }

  private nextJobId(): string {
    return `job-${++this.counter}`;
  }

  private handleEvent(event: WorkerEvent): void {
    const job = this.jobs.get(event.jobId);
    if (!job) return;
    switch (event.kind) {
      case 'progress':
        job.onProgress?.(event.completed, event.total);
        break;
      case 'result':
      case 'sweep-result':
      case 'tornado-result':
      case 'sobol-result':
        this.jobs.delete(event.jobId);
        job.resolve(event.result);
        break;
      case 'error':
        this.jobs.delete(event.jobId);
        job.reject(new EngineError(event.issues));
        break;
    }
  }

  private failAll(message: string): void {
    for (const [id, job] of this.jobs) {
      this.jobs.delete(id);
      job.reject(new EngineError(message, 'worker'));
    }
  }

  /** Allocate a cancellation flag in shared memory when the page allows it. */
  private makeCancelFlag(): Int32Array | undefined {
    try {
      if (typeof SharedArrayBuffer === 'undefined' || !self.crossOriginIsolated) return undefined;
      return new Int32Array(new SharedArrayBuffer(4));
    } catch {
      return undefined;
    }
  }

  private dispatch<T>(build: (jobId: string, cancelFlag?: Int32Array) => WorkerCommand, runLocally: (isCancelled: () => boolean, onProgress: (done: number, total: number) => void) => T, options: JobOptions): JobHandle<T> {
    const jobId = this.nextJobId();
    if (!this.worker) {
      // Main-thread fallback. Cancellation can only take effect between chunks,
      // and the UI cannot repaint during the run, which the caller is told about.
      let cancelled = false;
      const promise = new Promise<T>((resolve, reject) => {
        // Defer so the caller can render a "running" state first.
        setTimeout(() => {
          try {
            resolve(runLocally(() => cancelled, (done, total) => options.onProgress?.(done, total)));
          } catch (e) {
            reject(e);
          }
        }, 0);
      });
      return {
        promise,
        cancel: () => {
          cancelled = true;
        },
      };
    }
    const cancelFlag = this.makeCancelFlag();
    const promise = new Promise<T>((resolve, reject) => {
      this.jobs.set(jobId, { resolve: resolve as (v: unknown) => void, reject, onProgress: options.onProgress, cancelFlag });
      this.worker!.postMessage(build(jobId, cancelFlag));
    });
    return {
      promise,
      cancel: () => {
        const job = this.jobs.get(jobId);
        if (job?.cancelFlag) Atomics.store(job.cancelFlag, 0, 1);
        this.worker?.postMessage({ kind: 'cancel', jobId } satisfies WorkerCommand);
      },
    };
  }

  /** Validate before dispatching so errors surface immediately in the UI. */
  validate(request: SimulationRequest): Issue[] {
    return validateRequest(request);
  }

  run(request: SimulationRequest, options: JobOptions = {}): JobHandle<SimulationResult> {
    return this.dispatch(
      (jobId, cancelFlag) => ({ kind: 'run', jobId, request, cancelFlag }),
      (isCancelled, onProgress) => runSimulation(request, { isCancelled, onProgress: (p) => onProgress(p.completed, request.trials) }),
      options,
    );
  }

  sweep(request: SweepRequest, options: JobOptions = {}): JobHandle<SweepResult> {
    return this.dispatch(
      (jobId, cancelFlag) => ({ kind: 'sweep', jobId, request, cancelFlag }),
      (isCancelled, onProgress) => runSweep(request, { isCancelled, onProgress: (d, t) => onProgress(d, t) }),
      options,
    );
  }

  tornado(request: TornadoRequest, options: JobOptions = {}): JobHandle<TornadoResult> {
    return this.dispatch(
      (jobId, cancelFlag) => ({ kind: 'tornado', jobId, request, cancelFlag }),
      (isCancelled, onProgress) => runTornado(request, { isCancelled, onProgress: (d, t) => onProgress(d, t) }),
      options,
    );
  }

  sobol(request: SobolRequest, options: JobOptions = {}): JobHandle<SobolResult> {
    return this.dispatch(
      (jobId, cancelFlag) => ({ kind: 'sobol', jobId, request, cancelFlag }),
      (isCancelled, onProgress) => runSobol(request, { isCancelled, onProgress: (d, t) => onProgress(d, t) }),
      options,
    );
  }

  dispose(): void {
    this.failAll('The simulation client was closed.');
    this.worker?.terminate();
    this.worker = null;
  }
}

let shared: SimulationClient | null = null;

export function getSimulationClient(): SimulationClient {
  if (!shared) shared = new SimulationClient();
  return shared;
}
