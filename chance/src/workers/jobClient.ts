/**
 * Main-thread client for the engine-job worker.
 *
 * One client owns one worker. When a worker cannot be created at all — an
 * environment that forbids them, or a construction failure — the same job
 * generator is driven on the main thread instead, with the same yields, and
 * `fallbackReason` says so in words a screen can show. The work still
 * finishes and cancellation still takes effect between chunks; what is lost is
 * the repaint during the run, so the interface says that rather than failing.
 */
import { EngineError } from '../engine/core/result';
import type { JobProgress } from '../engine/core/progress';
import type { EngineJobId, EngineJobPayload, EngineJobResult } from '../engine/jobs/registry';
import { driveEngineJob, errorFromIssues, type JobCommand, type JobEvent, type JobOutcome } from './jobProtocol';

export interface EngineJobHandle<R> {
  readonly promise: Promise<JobOutcome<R>>;
  cancel(): void;
}

export interface EngineJobOptions {
  onProgress?(progress: JobProgress): void;
}

/** The part of `Worker` this client uses; a test can supply a loopback. */
export interface WorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: { data: JobEvent }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
}

type Pending = {
  settle(outcome: JobOutcome<unknown>): void;
  fail(error: unknown): void;
  onProgress?(progress: JobProgress): void;
};

export class EngineJobClient {
  private worker: WorkerLike | null = null;
  private readonly pending = new Map<string, Pending>();
  private counter = 0;
  /** Set when no worker could be created; jobs then run on the main thread. */
  readonly fallbackReason: string | null;

  constructor(createWorker: (() => WorkerLike) | null = defaultWorkerFactory()) {
    if (!createWorker) {
      this.fallbackReason =
        'This browser does not support Web Workers, so this computation runs on the main thread and the page will not redraw until it finishes. It can still be cancelled, which takes effect at the next chunk boundary.';
      return;
    }
    try {
      const worker = createWorker();
      worker.onmessage = (event) => this.handleEvent(event.data);
      worker.onerror = (event) => this.failAll(`The engine worker stopped unexpectedly: ${event?.message || 'unknown error'}.`);
      this.worker = worker;
      this.fallbackReason = null;
    } catch (e) {
      this.worker = null;
      this.fallbackReason = `The engine worker could not be started (${e instanceof Error ? e.message : String(e)}), so this computation runs on the main thread and the page will not redraw until it finishes.`;
    }
  }

  get usesWorker(): boolean {
    return this.worker !== null;
  }

  private handleEvent(event: JobEvent): void {
    const job = this.pending.get(event.jobId);
    if (!job) return;
    switch (event.kind) {
      case 'progress':
        job.onProgress?.(event.progress);
        break;
      case 'result':
        this.pending.delete(event.jobId);
        job.settle({ status: 'done', result: event.result });
        break;
      case 'cancelled':
        this.pending.delete(event.jobId);
        job.settle({ status: 'cancelled' });
        break;
      case 'error':
        this.pending.delete(event.jobId);
        job.fail(errorFromIssues(event.issues));
        break;
    }
  }

  private failAll(message: string): void {
    for (const [id, job] of [...this.pending]) {
      this.pending.delete(id);
      job.fail(new EngineError(message, 'worker'));
    }
  }

  /** Start a job. The promise resolves with the result, or reports cancellation. */
  start<K extends EngineJobId>(job: K, payload: EngineJobPayload<K>, options: EngineJobOptions = {}): EngineJobHandle<EngineJobResult<K>> {
    const jobId = `engine-job-${++this.counter}`;
    const worker = this.worker;
    if (!worker) {
      let cancelled = false;
      const promise = new Promise<JobOutcome<EngineJobResult<K>>>((resolve, reject) => {
        // Deferred so the caller can render a "running" state before the main
        // thread is taken over by the computation.
        setTimeout(() => {
          driveEngineJob<EngineJobResult<K>>(job, payload, {
            isCancelled: () => cancelled,
            onProgress: options.onProgress,
          }).then(resolve, reject);
        }, 0);
      });
      return {
        promise,
        cancel: () => {
          cancelled = true;
        },
      };
    }
    const promise = new Promise<JobOutcome<EngineJobResult<K>>>((resolve, reject) => {
      this.pending.set(jobId, {
        settle: (outcome) => resolve(outcome as JobOutcome<EngineJobResult<K>>),
        fail: reject,
        onProgress: options.onProgress,
      });
      worker.postMessage({ kind: 'start', jobId, job, payload } satisfies JobCommand);
    });
    return {
      promise,
      cancel: () => {
        if (!this.pending.has(jobId)) return;
        worker.postMessage({ kind: 'cancel', jobId } satisfies JobCommand);
      },
    };
  }

  dispose(): void {
    this.failAll('The engine job client was closed.');
    this.worker?.terminate();
    this.worker = null;
  }
}

/** A factory for the real worker, or null when Workers are unavailable. */
export function defaultWorkerFactory(): (() => WorkerLike) | null {
  if (typeof Worker === 'undefined') return null;
  return () => new Worker(new URL('./engine-job.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
}
