import { createStore } from './store';
import { call, on } from '../api';
import { toast } from './app';
import { activateTab, activePane, currentLocation, navigate, openTab, parentPath, refreshDir, ws } from './workspace';
import type { ShareSnapshot, ShareUploadEvent } from '../../shared/share';

/** Local-network shares running in the main process (mirrored here for the share panel and the status bar). */
export const shares = createStore<{ list: ShareSnapshot[]; loaded: boolean }>({ list: [], loaded: false });

let started = false;

/** Subscribe once to share changes and uploads (each upload is announced with a notification). */
export function followShares(): void {
  if (started) return;
  started = true;
  on<ShareSnapshot[]>('share:changed', (list) => shares.set({ list, loaded: true }));
  on<ShareUploadEvent>('share:upload', (e) => {
    const dir = parentPath(e.savedAs);
    if (dir) refreshDir(dir);
    const name = e.savedAs.split(/[\\/]/).pop() ?? e.savedAs;
    toast({
      level: 'info',
      title: `Received ${name}`,
      detail: `From ${e.from} over the local network${name !== e.name ? ` (sent as ${e.name}; a file with that name already existed)` : ''}.`,
      actions: dir ? [{ label: 'Show', run: () => void navigate(activePane().id, { kind: 'fs', path: dir }, { select: e.savedAs }) }] : undefined,
    });
  });
  void call<ShareSnapshot[]>('share:list').then((list) => shares.set({ list, loaded: true }), () => shares.set({ loaded: true }));
}

/** Show the share panel: the tab that already shows it, or a new tab (the folder shown in this tab stays). */
export function showSharesPanel(): void {
  const existing = ws.get().tabs.find((t) => t.panes.some((p) => {
    const l = currentLocation(p);
    return l.kind === 'tool' && l.tool === 'shares';
  }));
  if (existing) activateTab(existing.id);
  else openTab({ kind: 'tool', tool: 'shares' });
}

export const runningShares = (list: ShareSnapshot[]) => list.filter((s) => s.state === 'running');
