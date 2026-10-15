import { createStore } from './store';

/**
 * Background analysis tasks (storage scans, duplicate and similar-image
 * searches, folder comparisons, archive tests, project discovery). They are
 * read-only, so they run outside the file-operation queue, but they are shown
 * next to it — in the Operations panel and the status bar — with the same
 * progress, pause and cancel controls.
 */
export interface BackgroundJob {
  id: string;
  label: string;
  startedMs: number;
  progress?: string;
  fraction?: number;
  cancel: () => void;
  pause?: () => void;
  resume?: () => void;
}

/** Pause state of a running job as last reported by the main process (labelled or not). */
export interface JobControlState {
  pausable: boolean;
  paused: boolean;
  pause: () => void;
  resume: () => void;
  cancel: () => void;
}

export const jobs = createStore<{ list: BackgroundJob[]; index?: { state: string; scanned: number; currentRoot?: string }; controls: Record<string, JobControlState> }>({ list: [], controls: {} });

export function setJobControl(id: string, patch: Partial<JobControlState> | null): void {
  jobs.set((s) => {
    const controls = { ...s.controls };
    if (patch === null) delete controls[id];
    else if (controls[id] || (patch.pause && patch.resume && patch.cancel)) controls[id] = { ...(controls[id] ?? { pausable: false, paused: false }), ...patch } as JobControlState;
    return { controls };
  });
}

export function addJob(j: BackgroundJob): void {
  jobs.set((s) => ({ list: [...s.list.filter((x) => x.id !== j.id), j] }));
}

export function updateJob(id: string, patch: Partial<BackgroundJob>): void {
  jobs.set((s) => ({ list: s.list.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
}

export const jobHooks: { finished?: (j: BackgroundJob, outcome: 'done' | 'cancelled' | 'failed') => void } = {};

export function removeJob(id: string, outcome: 'done' | 'cancelled' | 'failed' = 'done'): void {
  const j = jobs.get().list.find((x) => x.id === id);
  jobs.set((s) => ({ list: s.list.filter((x) => x.id !== id) }));
  if (j) jobHooks.finished?.(j, outcome);
}

/** A short, honest description of a job's progress payload (counts only; no guessing a percentage). */
export function describeProgress(p: unknown): { text?: string; fraction?: number } {
  if (!p || typeof p !== 'object') return {};
  const o = p as Record<string, unknown>;
  const num = (k: string) => (typeof o[k] === 'number' ? (o[k] as number) : undefined);
  const parts: string[] = [];
  const files = num('files') ?? num('scanned') ?? num('checked') ?? num('entries') ?? num('items') ?? num('hashed');
  if (files !== undefined) parts.push(`${files.toLocaleString()} checked`);
  const total = num('total');
  if (typeof o.stage === 'string') parts.unshift(o.stage);
  if (typeof o.current === 'string') parts.push(o.current.split(/[\\/]/).pop() ?? '');
  const fraction = num('fraction') ?? (total && files !== undefined ? Math.min(1, files / total) : undefined);
  return { text: parts.filter(Boolean).join(' · ') || undefined, fraction };
}
