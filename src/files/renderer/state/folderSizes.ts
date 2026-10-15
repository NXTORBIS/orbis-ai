import { createStore } from './store';
import { call, on, runJob, type JobHandle } from '../api';
import { listings } from './workspace';
import { app, toast, toastError } from './app';

/**
 * "Calculate folder sizes" (View menu): the sizes of the child folders of a
 * folder, calculated on request as a pausable, cancellable background job and
 * shown in the Size column. Values are only ever real totals: a folder whose
 * count stopped early (entry limit, unreadable subfolders, cancellation) is
 * marked partial ("at least"). The values are dropped when the folder's
 * listing changes on disk, when Orbis Files changes something inside it, and
 * when no pane shows the folder any more — they are never refreshed silently.
 */

export interface FolderTotal { bytes: number; files: number; directories: number; errors: number; symlinksSkipped: number; complete: boolean; limited?: boolean }

export interface FolderSizesState {
  dir: string;
  jobId?: string;
  running: boolean;
  checked: number;
  total: number;
  current?: string;
  sizes: Record<string, FolderTotal>;
  startedMs: number;
  finishedMs?: number;
  cancelled?: boolean;
  error?: string;
}

export const folderSizes = createStore<Record<string, FolderSizesState>>({});

const handles = new Map<string, JobHandle<unknown>>();

const sepOf = (p: string) => (p.includes('\\') && !p.includes('/') ? '\\' : '/');
/** `p` is `dir` or inside it. */
export function isInside(dir: string, p: string): boolean {
  if (p === dir) return true;
  const sep = sepOf(dir);
  return p.startsWith(dir.endsWith(sep) ? dir : dir + sep);
}

function patch(dir: string, next: Partial<FolderSizesState> | null): void {
  folderSizes.set((s) => {
    const out = { ...s };
    if (next === null) delete out[dir];
    else if (out[dir]) out[dir] = { ...out[dir]!, ...next };
    return out;
  });
}

let wired = false;
function wire(): void {
  if (wired) return;
  wired = true;
  // The folder's own listing changed on disk (shallow watch): its child folder sizes may be wrong now.
  on<{ path: string }>('fs:changed', (e) => invalidateFolderSizes([e.path], 'changed'));
  // No pane shows the folder any more: nothing would notice changes, so the values are dropped.
  listings.subscribe(() => {
    const keys = Object.keys(listings.get());
    for (const dir of Object.keys(folderSizes.get())) if (!keys.some((k) => k.endsWith(`:fs:${dir}`))) stopFolderSizes(dir);
  });
}

export function folderSizesActive(dir: string | undefined): boolean {
  return !!dir && !!folderSizes.get()[dir];
}

/** Start calculating the sizes of `dir`'s child folders (restarts a previous calculation). */
export function startFolderSizes(dir: string): void {
  wire();
  stopFolderSizes(dir);
  folderSizes.set((s) => ({ ...s, [dir]: { dir, running: true, checked: 0, total: 0, sizes: {}, startedMs: Date.now() } }));
  const name = dir.split(/[\\/]/).filter(Boolean).pop() ?? dir;
  const h = runJob<{ sizes: Record<string, FolderTotal>; folders: number; complete: boolean }>(
    // Only the folders the view shows: hidden ones are left out unless hidden items are shown.
    (jobId) => call('fs:childFolderSizes', { path: dir, jobId, skipHidden: !app.get().settings.showHidden }),
    (p) => {
      const x = p as { checked: number; total: number; current?: string; sizes: Record<string, FolderTotal> };
      if (folderSizes.get()[dir]?.jobId === h.jobId) patch(dir, { checked: x.checked, total: x.total, current: x.current, sizes: { ...x.sizes } });
    },
    `Folder sizes in ${name}`,
  );
  handles.set(dir, h);
  patch(dir, { jobId: h.jobId });
  h.promise.then(
    (r) => {
      if (folderSizes.get()[dir]?.jobId !== h.jobId) return;
      handles.delete(dir);
      patch(dir, { running: false, finishedMs: Date.now(), cancelled: r.cancelled, current: undefined, ...(r.value ? { sizes: r.value.sizes, checked: Object.keys(r.value.sizes).length, total: r.value.folders } : {}) });
    },
    (err) => {
      if (folderSizes.get()[dir]?.jobId !== h.jobId) return;
      handles.delete(dir);
      patch(dir, { running: false, finishedMs: Date.now(), error: (err as Error).message });
      toastError(err, 'Folder sizes could not be calculated');
    },
  );
}

/** Stop a running calculation (keeping what was calculated) or, with `clear`, drop the values too. */
export function stopFolderSizes(dir: string, clear = true): void {
  const h = handles.get(dir);
  if (h) {
    handles.delete(dir);
    h.cancel();
  }
  if (clear) patch(dir, null);
  else patch(dir, { running: false, cancelled: true, current: undefined });
}

/**
 * Something changed at these paths (a refreshed folder, or the folders an
 * operation touched): drop the sizes of every folder that contains one.
 */
export function invalidateFolderSizes(paths: string[], why: 'changed' | 'operation' = 'operation'): void {
  for (const dir of Object.keys(folderSizes.get())) {
    if (!paths.some((p) => isInside(dir, p))) continue;
    const had = folderSizes.get()[dir]!;
    stopFolderSizes(dir);
    if (Object.keys(had.sizes).length || had.running) {
      toast({ level: 'info', title: 'Folder sizes were cleared', detail: `${why === 'changed' ? 'The folder changed on disk' : 'Files changed inside the folder'}, so the calculated sizes may no longer be right. Use View → Calculate folder sizes to calculate them again.` });
    }
  }
}
