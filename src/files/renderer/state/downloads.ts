import { createStore } from './store';
import { call, on } from '../api';
import type { DownloadRecord, DownloadProgressEvent, DownloadStateEvent, DownloadSettings, DownloadOptions } from '../../shared/downloads';

export interface DownloadsState {
  records: DownloadRecord[];
  /** Live progress keyed by download id. */
  progress: Record<string, DownloadProgressEvent>;
  settings: DownloadSettings | null;
  loading: boolean;
}

export const downloads = createStore<DownloadsState>({
  records: [],
  progress: {},
  settings: null,
  loading: true,
});

let progressOff: (() => void) | undefined;
let stateOff: (() => void) | undefined;

/** Load downloads from the main process and subscribe to events. */
export function initDownloads(): void {
  void loadDownloads();
  void loadSettings();

  progressOff?.();
  stateOff?.();

  progressOff = on<DownloadProgressEvent>('download:progress', (ev) => {
    downloads.set((s) => ({
      progress: { ...s.progress, [ev.id]: ev },
    }));
  });

  stateOff = on<DownloadStateEvent>('download:state', (ev) => {
    downloads.set((s) => {
      const idx = s.records.findIndex((r) => r.id === ev.id);
      const next = [...s.records];
      if (idx >= 0) next[idx] = ev.record;
      else next.unshift(ev.record);
      // Clean up progress for terminal states.
      const prog = { ...s.progress };
      if (['completed', 'failed', 'cancelled'].includes(ev.state)) {
        delete prog[ev.id];
      }
      return { records: next, progress: prog };
    });
  });
}

export async function loadDownloads(): Promise<void> {
  downloads.set({ loading: true });
  try {
    const records = await call<DownloadRecord[]>('download:list', { filter: 'all' });
    downloads.set({ records, loading: false });
  } catch {
    downloads.set({ loading: false });
  }
}

export async function loadSettings(): Promise<void> {
  try {
    const settings = await call<DownloadSettings>('download:settings', {});
    downloads.set({ settings });
  } catch { /* ignore */ }
}

export async function startDownload(url: string, destination: string, options?: DownloadOptions): Promise<DownloadRecord> {
  return call<DownloadRecord>('download:start', { url, destination, options });
}

export async function pauseDownload(id: string): Promise<void> {
  await call('download:pause', { id });
}

export async function resumeDownload(id: string): Promise<void> {
  await call('download:resume', { id });
}

export async function cancelDownload(id: string): Promise<void> {
  await call('download:cancel', { id });
}

export async function retryDownload(id: string): Promise<void> {
  await call('download:retry', { id });
}

export async function removeDownload(id: string): Promise<void> {
  await call('download:remove', { id });
  downloads.set((s) => ({
    records: s.records.filter((r) => r.id !== id),
    progress: (() => { const p = { ...s.progress }; delete p[id]; return p; })(),
  }));
}

export async function clearDownloadHistory(): Promise<void> {
  await call('download:clearHistory', {});
  await loadDownloads();
}

export async function updateDownloadSettings(update: Partial<DownloadSettings>): Promise<void> {
  const settings = await call<DownloadSettings>('download:settings', { update });
  downloads.set({ settings });
}
