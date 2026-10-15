/**
 * `useEngineJob` — run one registered engine job from a screen, off the main
 * thread, with real progress and a Cancel that actually stops the work.
 *
 * The progress values come from the job generator itself, after the work they
 * describe has been done, so a moving bar always corresponds to completed
 * iterations. Cancellation is honoured at the next chunk boundary, and a
 * cancelled job reports no result: these jobs are fits, and a half-finished
 * iterate is not a less precise estimate of the same quantity, so it is not
 * offered as one.
 *
 * Progress is deliberately NOT React state. These tool screens are large, and
 * re-rendering a whole screen several times a second is itself enough
 * main-thread work to undo the point of moving the computation off it. Progress
 * is published through a tiny store instead, so only the progress bar
 * re-renders while the fit runs; the screen re-renders when the status changes.
 *
 * The worker is created on the first run and terminated on unmount, so leaving
 * a screen stops its computation. When no worker can be created the same
 * generator runs on the main thread and `fallbackReason` explains what that
 * costs; the screen shows it rather than failing.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { EngineError, type Issue } from '../../engine/core/result';
import type { JobProgress } from '../../engine/core/progress';
import type { EngineJobId, EngineJobPayload, EngineJobResult } from '../../engine/jobs/registry';
import { EngineJobClient, type EngineJobHandle } from '../../workers/jobClient';

export type EngineJobStatus = 'idle' | 'running' | 'done' | 'cancelled' | 'error';

export interface EngineJobState<R> {
  status: EngineJobStatus;
  /** The result, present only when the status is 'done'. */
  result: R | null;
  issues: Issue[];
}

/** A `useSyncExternalStore`-shaped source of the live progress. */
export interface ProgressSource {
  subscribe(listener: () => void): () => void;
  get(): JobProgress;
}

const IDLE: EngineJobState<never> = { status: 'idle', result: null, issues: [] };
const NO_PROGRESS: JobProgress = { completed: 0, total: 0 };

export interface EngineJobApi<K extends EngineJobId> {
  state: EngineJobState<EngineJobResult<K>>;
  progress: ProgressSource;
  start(payload: EngineJobPayload<K>): void;
  cancel(): void;
  reset(): void;
  usesWorker: boolean;
  /** Non-null when the job runs on the main thread; show it in the interface. */
  fallbackReason: string | null;
}

export function useEngineJob<K extends EngineJobId>(job: K): EngineJobApi<K> {
  type R = EngineJobResult<K>;
  const [state, setState] = useState<EngineJobState<R>>(IDLE as EngineJobState<R>);
  const clientRef = useRef<EngineJobClient | null>(null);
  const handleRef = useRef<EngineJobHandle<R> | null>(null);
  // Only the newest run may publish anything, so a late reply from a cancelled
  // run can never be shown as the current result.
  const runRef = useRef(0);
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [usesWorker, setUsesWorker] = useState(true);

  const progressRef = useRef<JobProgress>(NO_PROGRESS);
  const listenersRef = useRef(new Set<() => void>());
  const publish = useCallback((next: JobProgress) => {
    progressRef.current = next;
    for (const listener of listenersRef.current) listener();
  }, []);
  const subscribe = useCallback((listener: () => void) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);
  const get = useCallback(() => progressRef.current, []);
  const progressRefSource = useRef<ProgressSource>({ subscribe, get });
  progressRefSource.current = { subscribe, get };

  const client = useCallback(() => {
    if (!clientRef.current) {
      clientRef.current = new EngineJobClient();
      setFallbackReason(clientRef.current.fallbackReason);
      setUsesWorker(clientRef.current.usesWorker);
    }
    return clientRef.current;
  }, []);

  useEffect(
    () => () => {
      handleRef.current?.cancel();
      handleRef.current = null;
      clientRef.current?.dispose();
      clientRef.current = null;
    },
    [],
  );

  const start = useCallback(
    (payload: EngineJobPayload<K>) => {
      handleRef.current?.cancel();
      const run = ++runRef.current;
      publish(NO_PROGRESS);
      setState({ status: 'running', result: null, issues: [] });
      const handle = client().start(job, payload, {
        onProgress: (next) => {
          if (runRef.current !== run) return;
          publish(next);
        },
      });
      handleRef.current = handle;
      void handle.promise
        .then((outcome) => {
          if (runRef.current !== run) return;
          if (outcome.status === 'cancelled') {
            setState({ status: 'cancelled', result: null, issues: [] });
          } else {
            const { completed, total } = progressRef.current;
            publish({ completed: Math.max(completed, total), total });
            setState({ status: 'done', result: outcome.result, issues: [] });
          }
        })
        .catch((e: unknown) => {
          if (runRef.current !== run) return;
          const issues =
            e instanceof EngineError
              ? e.issues
              : [{ code: 'unexpected', message: e instanceof Error && e.message ? e.message : `The computation failed: ${String(e)}` }];
          setState({ status: 'error', result: null, issues });
        })
        .finally(() => {
          if (handleRef.current === handle) handleRef.current = null;
        });
    },
    [client, job, publish],
  );

  const cancel = useCallback(() => {
    handleRef.current?.cancel();
  }, []);

  const reset = useCallback(() => {
    runRef.current++;
    handleRef.current?.cancel();
    handleRef.current = null;
    publish(NO_PROGRESS);
    setState(IDLE as EngineJobState<R>);
  }, [publish]);

  return { state, progress: progressRefSource.current, start, cancel, reset, usesWorker, fallbackReason };
}
