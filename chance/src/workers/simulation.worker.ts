/**
 * Simulation worker.
 *
 * Runs the real computation off the main thread so the interface stays
 * responsive and long runs can be cancelled. Progress messages are real: they
 * are emitted by the runner after each completed chunk of trials, so a moving
 * progress bar always corresponds to work that has actually been done.
 *
 * Cancellation: the simulation runs as a generator that yields between chunks
 * of trials. The worker awaits a macrotask at each yield, which lets its
 * message queue drain so a `cancel` message is actually received — a worker
 * blocked in a synchronous loop can never see one. A SharedArrayBuffer flag is
 * also honoured when the page is cross-origin isolated, but the application
 * does not depend on it, because SharedArrayBuffer is unavailable unless the
 * page is served with cross-origin isolation headers. Either way the run stops
 * at a chunk boundary and returns the trials completed so far.
 *
 * The sensitivity analyses run many short simulations, so they check for
 * cancellation between those runs instead.
 */
import { simulationSteps, validateRequest } from '../engine/simulation/runner';
import { runSobol, runSweep, runTornado, sobolSteps, sweepSteps, tornadoSteps, type SobolRequest, type SweepRequest, type TornadoRequest } from '../engine/sensitivity/sensitivity';
import { EngineError, type Issue } from '../engine/core/result';
import type { SimulationRequest, SimulationResult } from '../engine/simulation/types';

export type WorkerCommand =
  | { kind: 'run'; jobId: string; request: SimulationRequest; cancelFlag?: Int32Array }
  | { kind: 'sweep'; jobId: string; request: SweepRequest; cancelFlag?: Int32Array }
  | { kind: 'tornado'; jobId: string; request: TornadoRequest; cancelFlag?: Int32Array }
  | { kind: 'sobol'; jobId: string; request: SobolRequest; cancelFlag?: Int32Array }
  | { kind: 'cancel'; jobId: string };

export type WorkerEvent =
  | { kind: 'progress'; jobId: string; completed: number; total: number }
  | { kind: 'result'; jobId: string; result: SimulationResult }
  | { kind: 'sweep-result'; jobId: string; result: ReturnType<typeof runSweep> }
  | { kind: 'tornado-result'; jobId: string; result: ReturnType<typeof runTornado> }
  | { kind: 'sobol-result'; jobId: string; result: ReturnType<typeof runSobol> }
  | { kind: 'error'; jobId: string; issues: Issue[] };

/** Job ids cancelled by message (used when SharedArrayBuffer is unavailable). */
const cancelledJobs = new Set<string>();
/** Minimum milliseconds between progress messages, to avoid flooding the main thread. */
const PROGRESS_INTERVAL_MS = 80;

function makeCancelChecker(jobId: string, flag?: Int32Array): () => boolean {
  return () => {
    if (flag && flag.length > 0 && Atomics.load(flag, 0) === 1) return true;
    return cancelledJobs.has(jobId);
  };
}

function post(event: WorkerEvent): void {
  self.postMessage(event);
}

function toIssues(e: unknown): Issue[] {
  if (e instanceof EngineError) return e.issues;
  if (e instanceof Error) return [{ code: 'unexpected', message: e.message }];
  return [{ code: 'unexpected', message: String(e) }];
}

/** Progress reporter that throttles messages but never fabricates them. */
function throttledProgress(jobId: string, total: number) {
  let last = 0;
  return (completed: number) => {
    const now = Date.now();
    if (completed >= total || now - last >= PROGRESS_INTERVAL_MS) {
      last = now;
      post({ kind: 'progress', jobId, completed, total });
    }
  };
}

/** Yield to the event loop so queued messages (notably `cancel`) are delivered. */
function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Drive a step generator to completion, giving the event loop a turn between
 * steps so a `cancel` message can be received, then post the result.
 */
async function drive<T>(steps: Generator<number, T, void>, toEvent: (result: T) => WorkerEvent, jobId: string): Promise<void> {
  try {
    let next = steps.next();
    while (!next.done) {
      await nextTick();
      next = steps.next();
    }
    post(toEvent(next.value));
  } catch (e) {
    post({ kind: 'error', jobId, issues: toIssues(e) });
  } finally {
    cancelledJobs.delete(jobId);
  }
}

self.onmessage = (event: MessageEvent<WorkerCommand>) => {
  const cmd = event.data;
  if (cmd.kind === 'cancel') {
    cancelledJobs.add(cmd.jobId);
    return;
  }
  const isCancelled = makeCancelChecker(cmd.jobId, cmd.cancelFlag);
  try {
    switch (cmd.kind) {
      case 'run': {
        const issues = validateRequest(cmd.request);
        if (issues.length) {
          post({ kind: 'error', jobId: cmd.jobId, issues });
          return;
        }
        const report = throttledProgress(cmd.jobId, cmd.request.trials);
        void (async () => {
          try {
            const steps = simulationSteps(cmd.request, { onProgress: (p) => report(p.completed), isCancelled });
            let next = steps.next();
            while (!next.done) {
              await nextTick();
              next = steps.next();
            }
            const result = next.value;
            // Transfer the sample buffers rather than copying them.
            const transfer = result.samples ? Object.values(result.samples).map((a) => a.buffer) : [];
            self.postMessage({ kind: 'result', jobId: cmd.jobId, result } satisfies WorkerEvent, transfer as Transferable[]);
          } catch (e) {
            post({ kind: 'error', jobId: cmd.jobId, issues: toIssues(e) });
          } finally {
            cancelledJobs.delete(cmd.jobId);
          }
        })();
        return;
      }
      case 'sweep': {
        const report = throttledProgress(cmd.jobId, cmd.request.steps);
        void drive(sweepSteps(cmd.request, { onProgress: (done) => report(done), isCancelled }), (result) => ({ kind: 'sweep-result', jobId: cmd.jobId, result }), cmd.jobId);
        return;
      }
      case 'tornado': {
        const report = throttledProgress(cmd.jobId, cmd.request.parameters.length);
        void drive(tornadoSteps(cmd.request, { onProgress: (done) => report(done), isCancelled }), (result) => ({ kind: 'tornado-result', jobId: cmd.jobId, result }), cmd.jobId);
        return;
      }
      case 'sobol': {
        const total = cmd.request.samples * (cmd.request.parameters.length + 2);
        const report = throttledProgress(cmd.jobId, total);
        void drive(sobolSteps(cmd.request, { onProgress: (done) => report(done), isCancelled }), (result) => ({ kind: 'sobol-result', jobId: cmd.jobId, result }), cmd.jobId);
        return;
      }
    }
  } catch (e) {
    post({ kind: 'error', jobId: cmd.jobId, issues: toIssues(e) });
  } finally {
    cancelledJobs.delete(cmd.jobId);
  }
};
