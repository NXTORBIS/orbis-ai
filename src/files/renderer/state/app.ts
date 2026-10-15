import { createStore } from './store';
import { call, errorShape, on } from '../api';
import { jobHooks, jobs } from './jobs';
import { DEFAULT_SETTINGS, type Settings } from '../../shared/settings';
import type { AppInfo, FileEntry, KnownLocation, PlatformCapabilities, StartupNotice, Volume } from '../../shared/model';
import type { ConflictInfo, OperationRecord } from '../../shared/operations';
import type { OrbisErrorShape } from '../../shared/errors';

/** Global, non-workspace application state. */

export interface Pin { path: string; label: string | null; position: number }
export interface Recent { path: string; kind: 'file' | 'directory'; lastMs: number; count: number; exists: boolean }
export interface Tag { id: string; name: string; color: string | null; count: number }
export interface Collection { id: string; name: string; count: number; createdMs: number }
export interface SavedSearch { id: string; name: string; query: string; scope: string[]; createdMs: number }
export interface SmartFolderInfo { id: string; name: string; icon: string | null; color: string | null; query: Record<string, unknown>; createdMs: number; updatedMs: number }
export interface ClipPinInfo { id: string; mode: 'copy' | 'cut'; paths: string[]; label: string | null; pinnedMs: number }

export interface Toast {
  id: number;
  level: 'info' | 'success' | 'warning' | 'error';
  title: string;
  detail?: string;
  errorId?: string;
  actions?: Array<{ label: string; run: () => void }>;
  sticky?: boolean;
}

export interface ProjectInfo { id: string; name: string; root: string; kind: string; markers: string[]; createdMs: number; itemCount: number; rootExists?: boolean }

export interface ProviderInfo { id: string; label: string; types: string[]; availability: string; storage: string; actions: string[]; removalSemantics: string; note?: string; builtIn: boolean }
export interface HostPick { token: string; requestId?: string; title?: string; multiple: boolean; kinds: 'files' | 'folders' | 'both'; receivedMs: number }

export interface AppState {
  ready: boolean;
  info?: AppInfo;
  settings: Settings;
  notices: StartupNotice[];
  capabilities?: PlatformCapabilities;
  known: KnownLocation[];
  volumes: Volume[];
  pins: Pin[];
  recents: Recent[];
  tags: Tag[];
  collections: Collection[];
  projects: ProjectInfo[];
  /** Library content sources (built in, and feeds registered by the Orbis app). */
  providers: ProviderInfo[];
  /** Open "choose a file" requests from the Orbis app, oldest first. */
  hostPicks: HostPick[];
  /** In a narrow window the side panels are hidden automatically; these record the user showing them anyway. */
  narrowShow: { sidebar?: boolean; inspector?: boolean };
  savedSearches: SavedSearch[];
  smartFolders: SmartFolderInfo[];
  clipPins: ClipPinInfo[];
  sidebar: { collapsed: Record<string, boolean>; hidden: Record<string, boolean> };
  ops: Record<string, OperationRecord>;
  conflicts: ConflictInfo[];
  clipboard: { mode: 'copy' | 'cut'; paths: string[] } | null;
  toasts: Toast[];
  paletteOpen: boolean;
  /** Quick switcher ("Go to file or folder…", Ctrl+P). */
  switcherOpen: boolean;
  /** The terminal "Open terminal here" starts: its name, null when none was found, undefined until detected. */
  terminal?: { label: string; via: string } | null;
  opsPanelOpen: boolean;
  dialog: DialogRequest | null;
  /** A file inside an archive shown in the details panel, from a temporary copy (`entry` is the copy). */
  archivePreview: ArchivePreview | null;
  windowState: { maximized: boolean; fullscreen: boolean; focused: boolean; platform: string };
}

export interface ArchivePreview { paneId: string; archivePath: string; entryName: string; entry: FileEntry; modifiedMs?: number }

export type DialogRequest =
  | { kind: 'confirm'; title: string; body: string; confirmLabel: string; destructive?: boolean; detail?: string[]; resolve: (ok: boolean) => void }
  | { kind: 'prompt'; title: string; label: string; initial: string; confirmLabel: string; selectStem?: boolean; validate?: (v: string) => Promise<string | undefined> | string | undefined; resolve: (v: string | null) => void }
  | { kind: 'custom'; id: string; props?: Record<string, unknown> };

export const app = createStore<AppState>({
  ready: false,
  settings: DEFAULT_SETTINGS,
  notices: [],
  known: [],
  volumes: [],
  pins: [],
  recents: [],
  tags: [],
  collections: [],
  projects: [],
  providers: [],
  hostPicks: [],
  narrowShow: {},
  savedSearches: [],
  smartFolders: [],
  clipPins: [],
  sidebar: { collapsed: {}, hidden: {} },
  ops: {},
  conflicts: [],
  clipboard: null,
  toasts: [],
  paletteOpen: false,
  switcherOpen: false,
  opsPanelOpen: false,
  dialog: null,
  archivePreview: null,
  windowState: { maximized: false, fullscreen: false, focused: true, platform: 'linux' },
});

let toastSeq = 0;
export function toast(t: Omit<Toast, 'id'>): number {
  const id = ++toastSeq;
  app.set((s) => ({ toasts: [...s.toasts.slice(-4), { ...t, id }] }));
  if (!t.sticky) setTimeout(() => dismissToast(id), t.level === 'error' ? 9000 : 4500);
  return id;
}

export function dismissToast(id: number): void {
  app.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

export function toastError(err: unknown, title?: string): void {
  const e: OrbisErrorShape = errorShape(err);
  toast({ level: 'error', title: title ?? e.message, detail: title ? e.message : e.cause && e.category !== 'validation' ? undefined : e.cause, errorId: e.errorId });
}

export function confirm(opts: Omit<Extract<DialogRequest, { kind: 'confirm' }>, 'kind' | 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => app.set({ dialog: { kind: 'confirm', ...opts, resolve } }));
}

export function prompt(opts: Omit<Extract<DialogRequest, { kind: 'prompt' }>, 'kind' | 'resolve'>): Promise<string | null> {
  return new Promise((resolve) => app.set({ dialog: { kind: 'prompt', ...opts, resolve } }));
}

export function openDialog(id: string, props?: Record<string, unknown>): void {
  app.set({ dialog: { kind: 'custom', id, props } });
}

export function closeDialog(): void {
  app.set({ dialog: null });
}

export async function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
  const prev = app.get().settings;
  app.set({ settings: { ...prev, [key]: value } }); // optimistic; reverted on failure
  try {
    const next = await call<Settings>('settings:set', { key, value });
    app.set({ settings: next });
  } catch (err) {
    app.set({ settings: prev });
    toastError(err, 'The setting could not be saved');
  }
}

/** Back to the built-in default for one setting (the stored value is removed). */
export async function resetSetting(key: keyof Settings): Promise<void> {
  try {
    app.set({ settings: await call<Settings>('settings:reset', { key }) });
  } catch (err) {
    toastError(err, 'The setting could not be reset');
  }
}

export async function refreshCatalog(what?: string): Promise<void> {
  const tasks: Array<Promise<unknown>> = [];
  if (!what || what === 'pins') tasks.push(call<Pin[]>('cat:pins').then((pins) => app.set({ pins })));
  if (!what || what === 'recents') tasks.push(call<Recent[]>('cat:recents', { limit: 60 }).then((recents) => app.set({ recents })));
  if (!what || what === 'tags' || what === 'items') tasks.push(call<Tag[]>('cat:tags').then((tags) => app.set({ tags })));
  if (!what || what === 'collections' || what === 'items') tasks.push(call<Collection[]>('cat:collections').then((collections) => app.set({ collections })));
  if (!what || what === 'projects' || what === 'items') tasks.push(call<ProjectInfo[]>('proj:list').then((projects) => app.set({ projects })));
  if (!what || what === 'providers') tasks.push(call<ProviderInfo[]>('lib:providers').then((providers) => app.set({ providers })));
  if (!what || what === 'savedSearches') tasks.push(call<SavedSearch[]>('cat:savedSearches').then((savedSearches) => app.set({ savedSearches })));
  if (!what || what === 'smartFolders') tasks.push(call<SmartFolderInfo[]>('cat:smartFolders').then((smartFolders) => app.set({ smartFolders })));
  if (!what || what === 'clipPins') tasks.push(call<ClipPinInfo[]>('clip:pins').then((clipPins) => app.set({ clipPins })));
  await Promise.allSettled(tasks);
}

let volumesSeen = false;
export async function refreshVolumes(): Promise<void> {
  try {
    applyVolumes(await call<Volume[]>('fs:volumes'));
  } catch {
    /* volumes are optional information */
  }
}

/** Show a new drive list (from a request or the main process's fs:volumesChanged event). */
function applyVolumes(volumes: Volume[]): void {
  const before = app.get().volumes;
  // Tell the user when a drive disappears or appears (not on the first read).
  if (volumesSeen) {
    const now = new Set(volumes.map((v) => v.mountPath));
    const was = new Set(before.map((v) => v.mountPath));
    for (const v of before) if (!now.has(v.mountPath)) toast({ level: 'warning', title: `${v.label} was disconnected`, detail: `${v.mountPath} is no longer available. Operations on it stop with an error per item; nothing else is affected.` });
    for (const v of volumes) if (!was.has(v.mountPath)) toast({ level: 'info', title: `${v.label} is available`, detail: v.mountPath });
  }
  volumesSeen = true;
  app.set({ volumes });
}

export async function bootApp(): Promise<void> {
  const [info, settings, notices, capabilities, known, ops, sidebar] = await Promise.all([
    call<AppInfo>('app:info'),
    call<Settings>('settings:getAll'),
    call<StartupNotice[]>('app:startupNotices'),
    call<PlatformCapabilities>('fs:capabilities'),
    call<KnownLocation[]>('fs:knownLocations'),
    call<OperationRecord[]>('ops:list'),
    call<AppState['sidebar']>('cat:sidebar'),
  ]);
  app.set({
    info, settings, notices, capabilities, known, sidebar,
    ops: Object.fromEntries(ops.map((o) => [o.id, o])),
    windowState: { ...app.get().windowState, platform: info.platform },
  });
  await Promise.all([refreshCatalog(), refreshVolumes()]);
  // Text recognition: languages, capabilities and the background job's status.
  void import('./ocr').then((m) => m.initOcr());
  on<OperationRecord & { removed?: boolean }>('ops:update', (rec) => {
    app.set((s) => {
      const ops = { ...s.ops };
      if (rec.removed) delete ops[rec.id];
      else ops[rec.id] = rec;
      return { ops, conflicts: rec.removed || rec.state !== 'awaiting_conflict' ? s.conflicts.filter((c) => c.operationId !== rec.id) : s.conflicts };
    });
  });
  on<ConflictInfo>('ops:conflict', (c) => app.set((s) => ({ conflicts: [...s.conflicts.filter((x) => x.operationId !== c.operationId), c] })));
  on<Settings>('settings:changed', (settings) => app.set({ settings }));
  on<{ what: string }>('cat:changed', (e) => void refreshCatalog(e.what));
  // Indexing is shown with the other background tasks, and its completion is announced.
  const indexStatus = (st: { state: string; scanned: number; currentRoot?: string }) => {
    const prev = jobs.get().index;
    jobs.set({ index: { state: st.state, scanned: st.scanned, currentRoot: st.currentRoot } });
    if (prev?.state === 'scanning' && st.state === 'idle' && st.scanned > 0) toast({ level: 'success', title: 'Search index is up to date', detail: `${st.scanned.toLocaleString()} items checked.` });
    if (prev?.state === 'scanning' && st.state === 'error') toast({ level: 'error', title: 'Indexing stopped with an error', detail: 'See Settings → Search index.' });
  };
  on<{ state: string; scanned: number; currentRoot?: string }>('index:status', indexStatus);
  // Long background tasks announce that they finished (their results are in their view).
  jobHooks.finished = (j, outcome) => {
    if (outcome === 'done' && Date.now() - j.startedMs > 5000) toast({ level: 'success', title: `${j.label} finished`, detail: 'The results are in its view.' });
  };
  void call<{ state: string; scanned: number; currentRoot?: string }>('index:status').then((st) => jobs.set({ index: { state: st.state, scanned: st.scanned, currentRoot: st.currentRoot } }), () => undefined);
  on<HostPick[]>('host:pick', (hostPicks) => app.set({ hostPicks }));
  void call<{ label: string; via: string } | null>('fs:terminalInfo').then((terminal) => app.set({ terminal }), () => app.set({ terminal: null }));
  void call<HostPick[]>('host:pendingPicks').then((hostPicks) => app.set({ hostPicks }), () => undefined);
  on<AppState['windowState']>('win:state', (w) => app.set({ windowState: w }));
  // Drives appearing or disappearing are pushed by the main process; the slow poll only refreshes free space.
  on<Volume[]>('fs:volumesChanged', (volumes) => applyVolumes(volumes));
  setInterval(() => void refreshVolumes(), 60000);
  app.set({ ready: true });
}

export function opsActive(s: AppState): OperationRecord[] {
  return Object.values(s.ops).filter((o) => !['completed', 'completed_with_errors', 'failed', 'cancelled', 'interrupted'].includes(o.state));
}

/**
 * Toggle a side panel. When the window is too small for the panel and it is
 * hidden by fitting, it is shown for this session only (the saved layout is
 * unchanged); otherwise the layout setting changes (undoable).
 */
/** Show a side panel if it is not visible (no change when it already is). */
export async function showPanel(which: 'sidebar' | 'inspector'): Promise<void> {
  const [{ resolvedNow }, { fitState }] = await Promise.all([import('./custom'), import('./layoutFit')]);
  const key = which === 'sidebar' ? 'sidebar' : 'details';
  const visible = resolvedNow().layout[key].visible;
  if (visible && (!fitState.get().hidden[key] || app.get().narrowShow[which])) return;
  await togglePanel(which);
}

export async function togglePanel(which: 'sidebar' | 'inspector'): Promise<void> {
  const [{ resolvedNow, applyCustom }, { fitState }] = await Promise.all([import('./custom'), import('./layoutFit')]);
  const key = which === 'sidebar' ? 'sidebar' : 'details';
  const visible = resolvedNow().layout[key].visible;
  const shownAnyway = !!app.get().narrowShow[which];
  if (visible && (fitState.get().hidden[key] || shownAnyway)) {
    app.set((s) => ({ narrowShow: { ...s.narrowShow, [which]: !shownAnyway } }));
    return;
  }
  await applyCustom({ op: 'set', section: 'layout', path: [key, 'visible'], value: !visible, label: which === 'sidebar' ? (visible ? 'Hid the sidebar' : 'Showed the sidebar') : visible ? 'Hid the details panel' : 'Showed the details panel' });
}
