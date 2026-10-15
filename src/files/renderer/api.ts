import type { EventChannel, InvokeChannel, InvokeRequest } from '../shared/ipc';
import type { OrbisErrorShape, Result } from '../shared/errors';
import type { FileEntry } from '../shared/model';
import { addJob, describeProgress, removeJob, setJobControl, updateJob } from './state/jobs';

/** Typed client for the preload bridge. */

interface Bridge {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
  on(channel: string, listener: (payload: unknown) => void): () => void;
  getPathForFile?(file: File): string;
  platform: string;
  initialPath?: string;
}

declare global {
  interface Window {
    orbis: Bridge;
  }
}

export class UiError extends Error {
  constructor(readonly shape: OrbisErrorShape) {
    super(shape.message);
  }
}

export async function call<T = unknown, C extends InvokeChannel = InvokeChannel>(channel: C, payload?: InvokeRequest<C>): Promise<T> {
  const res = (await window.orbis.invoke(channel, payload ?? {})) as Result<T>;
  if (!res || typeof res !== 'object' || !('ok' in res)) throw new UiError({ category: 'internal', operation: channel, message: 'Unexpected response.', dataChanged: 'unknown', retryable: false });
  if (!res.ok) throw new UiError(res.error);
  return res.value;
}

export function on<T = unknown>(channel: EventChannel, listener: (payload: T) => void): () => void {
  return window.orbis.on(channel, listener as (p: unknown) => void);
}

export function errorShape(err: unknown, operation = 'ui'): OrbisErrorShape {
  if (err instanceof UiError) return err.shape;
  return { category: 'internal', operation, message: (err as Error)?.message ?? 'Unexpected error.', dataChanged: 'unknown', retryable: false };
}

export const platform = (): string => window.orbis.platform;

let jobCounter = 0;
export function newId(prefix = 'job'): string {
  jobCounter++;
  return `${prefix}-${Date.now().toString(36)}-${jobCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface JobHandle<T> {
  jobId: string;
  promise: Promise<{ value?: T; cancelled: boolean }>;
  cancel: () => void;
  /** Pause between items (the main process reports whether the job can be paused). */
  pause: () => void;
  resume: () => void;
}

/**
 * Run a background job channel and resolve with its result. Its pause state
 * (as reported by the main process) is kept in `jobs.controls[jobId]` while it runs.
 */
export function runJob<T>(start: (jobId: string) => Promise<unknown>, onProgress?: (p: unknown) => void, label?: string): JobHandle<T> {
  const jobId = newId();
  let offP = () => {};
  let offD = () => {};
  const cancel = () => void call('fs:jobCancel', { jobId });
  const control = (channel: 'fs:jobPause' | 'fs:jobResume') => () => void call<{ paused: boolean }>(channel, { jobId }).then(
    (r) => setJobControl(jobId, { paused: r.paused }),
    (err) => {
      // A job that just finished is not an error worth reporting; anything else is.
      if (err instanceof UiError && err.shape.category === 'not_found') return;
      void import('./state/app').then((m) => m.toastError(err, channel === 'fs:jobPause' ? 'Could not pause' : 'Could not resume'));
    },
  );
  const pause = control('fs:jobPause');
  const resume = control('fs:jobResume');
  setJobControl(jobId, { pausable: false, paused: false, pause, resume, cancel });
  // Labelled jobs are listed as background tasks next to file operations.
  if (label) addJob({ id: jobId, label, startedMs: Date.now(), cancel, pause, resume });
  const promise = new Promise<{ value?: T; cancelled: boolean }>((resolve, reject) => {
    offP = on<{ jobId: string; progress: unknown; paused?: boolean; pausable?: boolean; stateOnly?: boolean }>('job:progress', (e) => {
      if (e.jobId !== jobId) return;
      if (e.paused !== undefined) setJobControl(jobId, { paused: e.paused, pausable: e.pausable ?? true });
      if (e.stateOnly) return;
      onProgress?.(e.progress);
      if (label) {
        const d = describeProgress(e.progress);
        updateJob(jobId, { progress: d.text, fraction: d.fraction });
      }
    });
    offD = on<{ jobId: string; ok: boolean; value?: T; error?: OrbisErrorShape; cancelled: boolean }>('job:done', (e) => {
      if (e.jobId !== jobId) return;
      offP();
      offD();
      setJobControl(jobId, null);
      if (label) removeJob(jobId, e.ok ? (e.cancelled ? 'cancelled' : 'done') : e.cancelled ? 'cancelled' : 'failed');
      if (e.ok) resolve({ value: e.value, cancelled: e.cancelled });
      else if (e.cancelled) resolve({ cancelled: true });
      else reject(new UiError(e.error!));
    });
    start(jobId).then(
      (r) => {
        // The start reply says whether this kind of job can be paused.
        const pausable = (r as { pausable?: unknown } | null)?.pausable;
        if (typeof pausable === 'boolean') setJobControl(jobId, { pausable });
      },
      (err) => {
        offP();
        offD();
        setJobControl(jobId, null);
        if (label) removeJob(jobId, 'failed');
        reject(err);
      },
    );
  });
  return { jobId, promise, cancel, pause, resume };
}

export interface ListingResult { entries: FileEntry[]; error?: OrbisErrorShape }

/**
 * List a folder in batches. The batch listener is registered BEFORE the
 * request is sent, with an id chosen here: the reply to an invoke and pushed
 * events travel separately and can arrive in either order, so subscribing
 * after the reply could miss the first batches of a small folder.
 */
export function startListing(dir: string, showHidden: boolean, onProgress?: (entriesSoFar: FileEntry[], batch: FileEntry[]) => void): { listingId: string; done: Promise<ListingResult> } {
  const listingId = newId('ls');
  const entries: FileEntry[] = [];
  let off = () => {};
  const done = new Promise<ListingResult>((resolve) => {
    off = on<{ listingId: string; entries: FileEntry[]; done: boolean; error?: OrbisErrorShape }>('fs:listBatch', (b) => {
      if (b.listingId !== listingId) return;
      entries.push(...b.entries);
      if (b.done) {
        off();
        resolve({ entries, error: b.error });
      } else if (b.entries.length) onProgress?.(entries, b.entries);
    });
    call('fs:listStart', { path: dir, showHidden, listingId }).catch((err) => {
      off();
      resolve({ entries: [], error: errorShape(err, 'fs.list') });
    });
  });
  return { listingId, done };
}
