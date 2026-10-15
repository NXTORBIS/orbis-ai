/**
 * The engine-job worker protocol.
 *
 * The main thread posts a `start` command carrying a job id (looked up in
 * `src/engine/jobs/registry.ts`) and a serialisable payload. The worker
 * answers with `progress` events, then exactly one of `result`, `cancelled` or
 * `error`. `cancel` stops a running job.
 *
 * Everything in both directions is plain data, so it survives structured
 * cloning. In particular an `EngineError` is sent as its `Issue[]`, never as
 * the error object: an `Error` subclass loses its class across `postMessage`,
 * and a refusal that arrives as "[object Object]" or an empty string would be
 * a correctness failure, not a cosmetic one. The client rebuilds an
 * `EngineError` from the issues, so the message is identical on both sides.
 *
 * Cancellation works because every job is a generator that yields between
 * chunks of work and the driver awaits a macrotask at each yield. That lets
 * the worker's message queue drain so a `cancel` message is actually
 * received — a worker blocked in a synchronous loop can never see one, and
 * `SharedArrayBuffer` is unavailable unless the page is cross-origin isolated,
 * so there is no flag to poll instead.
 *
 * A cancelled job reports `cancelled` and no result. These jobs are fits, not
 * sampling runs: a half-finished EM iterate is not a worse estimate of the
 * same thing, so presenting one as a result would be reporting a number that
 * is not an answer.
 */
import { EngineError, type Issue } from '../engine/core/result';
import { getEngineJob } from '../engine/jobs/registry';
import type { JobProgress } from '../engine/core/progress';

export type JobCommand =
  | { kind: 'start'; jobId: string; job: string; payload: unknown }
  | { kind: 'cancel'; jobId: string };

export type JobEvent =
  | { kind: 'progress'; jobId: string; progress: JobProgress }
  | { kind: 'result'; jobId: string; result: unknown }
  | { kind: 'cancelled'; jobId: string }
  | { kind: 'error'; jobId: string; issues: Issue[] };

/** Minimum milliseconds between progress events. Each one re-renders the screen,
 * which on a dense tool screen is real main-thread work, so they are spaced far
 * enough apart to stay invisible and still show the fit moving. */
export const PROGRESS_INTERVAL_MS = 200;

/** Convert anything thrown into displayable issues, never losing the message. */
export function toIssues(e: unknown): Issue[] {
  if (e instanceof EngineError) return e.issues.map((i) => ({ ...i }));
  if (e instanceof Error) return [{ code: 'unexpected', message: e.message || `${e.name} was thrown with no message.` }];
  if (typeof e === 'string' && e.length > 0) return [{ code: 'unexpected', message: e }];
  return [{ code: 'unexpected', message: `A non-error value was thrown: ${safeDescribe(e)}.` }];
}

function safeDescribe(e: unknown): string {
  try {
    const text = JSON.stringify(e);
    return text === undefined ? String(e) : text;
  } catch {
    return String(e);
  }
}

/** Rebuild the error the worker refused with, with its message intact. */
export function errorFromIssues(issues: Issue[]): EngineError {
  if (!issues.length) return new EngineError('The job failed, but no reason was reported.', 'unexpected');
  return new EngineError(issues);
}

export type JobOutcome<R> = { status: 'done'; result: R } | { status: 'cancelled' };

/** Yield to the event loop so queued messages (notably `cancel`) are delivered. */
function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Run a registered job to completion, giving the event loop a turn between
 * steps. This is the single implementation used by the worker AND by the
 * main-thread fallback, so the behaviour is the same either way.
 *
 * Throws an `EngineError` when the payload is invalid or the computation
 * refuses. Resolves with `{ status: 'cancelled' }` and no result when
 * `isCancelled` becomes true.
 */
export async function driveEngineJob<R>(
  job: string,
  payload: unknown,
  handlers: { isCancelled?(): boolean; onProgress?(progress: JobProgress): void } = {},
): Promise<JobOutcome<R>> {
  const def = getEngineJob(job);
  const parsed = def.parse(payload);
  const steps = def.run(parsed, { isCancelled: handlers.isCancelled });
  let last = 0;
  try {
    if (handlers.isCancelled?.()) return { status: 'cancelled' };
    let step = steps.next();
    while (!step.done) {
      const progress = step.value;
      const now = Date.now();
      if (now - last >= PROGRESS_INTERVAL_MS) {
        last = now;
        handlers.onProgress?.({ ...progress });
      }
      await nextTick();
      if (handlers.isCancelled?.()) return { status: 'cancelled' };
      step = steps.next();
    }
    return { status: 'done', result: step.value as R };
  } finally {
    // Release any resources the generator holds if we stopped early.
    steps.return?.(undefined as never);
  }
}

/**
 * The worker-side half of the protocol, independent of `self` so the same code
 * can be driven over a loopback in tests.
 */
export function createJobResponder(post: (event: JobEvent) => void): (command: JobCommand) => void {
  const cancelled = new Set<string>();
  return (command: JobCommand) => {
    if (command.kind === 'cancel') {
      cancelled.add(command.jobId);
      return;
    }
    const { jobId } = command;
    void (async () => {
      try {
        const outcome = await driveEngineJob(command.job, command.payload, {
          isCancelled: () => cancelled.has(jobId),
          onProgress: (progress) => post({ kind: 'progress', jobId, progress }),
        });
        if (outcome.status === 'cancelled') post({ kind: 'cancelled', jobId });
        else post({ kind: 'result', jobId, result: outcome.result });
      } catch (e) {
        post({ kind: 'error', jobId, issues: toIssues(e) });
      } finally {
        cancelled.delete(jobId);
      }
    })();
  };
}
