import { createStore } from './store';
import { app, toast, toastError } from './app';
import { call, on, startListing, UiError } from '../api';
import { locationKey, type FileEntry, type GroupKey, type Location, type SortSpec, type ViewMode } from '../../shared/model';
import type { OrbisErrorShape } from '../../shared/errors';
import { PANE_COUNT, PANE_ARRANGEMENTS, type PaneArrangement } from '../../shared/customization/schema';
import { normalizeRatios } from '../../shared/customization/resolve';
import { custom, resolvedNow } from './custom';
import { isRemoteRef, parseRemoteRef, remoteParent } from '../../shared/remote';
import { ensureConnected, isConnectionError, needsConnect } from './remote';

/**
 * Workspace: tabs → panes. Each pane has its own location history, view,
 * sort/group/filter and selection. Listing data lives in `listings` and is
 * never persisted; only locations and view preferences are saved.
 */

export interface Pane {
  id: string;
  history: Location[];
  index: number;
  view: ViewMode;
  sort: SortSpec;
  /** Further sort keys used when the primary key ties (in priority order). */
  thenBy: Array<{ key: SortSpec['key']; dir: 'asc' | 'desc' }>;
  groupBy: GroupKey;
  filter: string;
  selection: string[];
  anchor?: string;
  focus?: string;
  scrollTop?: number;
  /** Per-history-entry restoration data, keyed by locationKey. */
  restore?: Record<string, { scrollTop: number; focus?: string }>;
}

export interface Tab {
  id: string;
  /** Every pane of the tab; the first `paneCount(tab)` are shown, the rest keep their place for when more panes are shown again. */
  panes: Pane[];
  activePane: number;
  /** Pane arrangement of this tab (follows the layout setting when it changes). */
  arrangement: PaneArrangement;
  /** Split points between panes (fractions), per tab. */
  ratios: number[];
  /** The pane that was active before the current one: the target of "copy/move to other pane". */
  prevPane?: number;
  pinned: boolean;
  groupId?: string;
}

export const paneCount = (t: Tab): number => PANE_COUNT[t.arrangement] ?? 1;
export const isSplit = (t: Tab): boolean => paneCount(t) > 1;
export const visiblePanes = (t: Tab): Pane[] => t.panes.slice(0, paneCount(t));

export interface TabGroup { id: string; name: string; color: string; collapsed: boolean }

export interface WorkspaceState {
  tabs: Tab[];
  activeTabId: string;
  groups: TabGroup[];
  closed: Tab[];
}

export interface Listing {
  key: string;
  status: 'loading' | 'ready' | 'error';
  entries: FileEntry[];
  error?: OrbisErrorShape;
  /** Present when the listing came from a search. */
  search?: { query: string; report?: SearchReport; running: boolean; error?: OrbisErrorShape };
  loadedMs?: number;
  watching?: boolean;
  /** Remote listings: names the server reported that were refused (unsafe names). */
  refused?: string[];
}

export interface SearchReport { scanned: number; matched: number; skippedDirs: number; complete: boolean; cancelled: boolean; truncated: boolean; usedIndex: string[]; walked: string[]; notes: string[] }

const uid = () => Math.random().toString(36).slice(2, 10);

/**
 * Leaving a pane's location or closing panes. The editor (state/editor.ts) installs
 * these: `confirm` asks Save / Don't save / Cancel for panes with unsaved changes
 * (resolving false keeps everything as it is), `left` drops the editor session of
 * panes that no longer show it, and `refresh` re-reads an editor pane's file.
 */
export const leaveHooks: {
  confirm: (paneIds: string[], action: string) => Promise<boolean>;
  needsConfirm: (paneIds: string[]) => boolean;
  left: (paneIds: string[]) => void;
  refresh: (paneId: string) => void;
} = { confirm: async () => true, needsConfirm: () => false, left: () => undefined, refresh: () => undefined };

/** Ask before a pane leaves an editor with unsaved changes; true when it may go. */
async function mayLeave(pane: Pane, next: Location | undefined): Promise<boolean> {
  const cur = currentLocation(pane);
  if (cur.kind !== 'editor' || (next && locationKey(next) === locationKey(cur))) return true;
  if (!leaveHooks.needsConfirm([pane.id])) return true;
  return leaveHooks.confirm([pane.id], next?.kind === 'editor' ? 'open another file here' : 'leave the editor');
}

/** Live scroll positions per pane (kept outside the store to avoid re-rendering on scroll). */
export const scrollMemory = new Map<string, number>();

export function currentLocation(p: Pane): Location {
  return p.history[p.index] ?? { kind: 'home' };
}

/** A new pane takes the file-view defaults in effect (application → preset → workspace). */
export function newPane(loc: Location = { kind: 'home' }): Pane {
  const v = resolvedNow().view;
  return { id: uid(), history: [loc], index: 0, view: v.view, sort: { ...v.sort }, thenBy: v.thenBy.map((x) => ({ ...x })), groupBy: v.groupBy, filter: '', selection: [] };
}

function withPanes(panes: Pane[], arrangement: PaneArrangement): Pane[] {
  const out = [...panes];
  const base = out[0] ? currentLocation(out[0]) : ({ kind: 'home' } as Location);
  while (out.length < PANE_COUNT[arrangement]) out.push(newPane(base));
  return out;
}

export function newTab(loc: Location = { kind: 'home' }): Tab {
  const l = resolvedNow().layout;
  const arrangement = l.panes.arrangement;
  return { id: uid(), panes: withPanes([newPane(loc)], arrangement), activePane: 0, arrangement, ratios: normalizeRatios(arrangement, l.panes.ratios), pinned: false };
}

/** Bring a tab from a saved session or tab set (any version) to the current shape. */
export function normalizeTab(raw: Tab & { split?: boolean; splitRatio?: number }): Tab {
  const arrangement: PaneArrangement = (PANE_ARRANGEMENTS as readonly string[]).includes(raw.arrangement) ? raw.arrangement : raw.split ? 'dual' : 'single';
  const ratios = Array.isArray(raw.ratios) ? raw.ratios.filter((x) => typeof x === 'number' && x > 0.05 && x < 0.95) : typeof raw.splitRatio === 'number' ? [raw.splitRatio] : [];
  const panes = withPanes((raw.panes ?? []).map((p) => ({ ...p, thenBy: Array.isArray(p.thenBy) ? p.thenBy : [] })), arrangement);
  const { split: _s, splitRatio: _r, ...rest } = raw;
  void _s;
  void _r;
  return { ...rest, panes, arrangement, ratios: normalizeRatios(arrangement, ratios), activePane: Math.min(Math.max(0, raw.activePane ?? 0), PANE_COUNT[arrangement] - 1) };
}

const firstTab = newTab();
export const ws = createStore<WorkspaceState>({ tabs: [firstTab], activeTabId: firstTab.id, groups: [], closed: [] });
export const listings = createStore<Record<string, Listing>>({});

// ------------------------------------------------------------------ selectors
export function activeTab(s: WorkspaceState = ws.get()): Tab {
  return s.tabs.find((t) => t.id === s.activeTabId) ?? s.tabs[0]!;
}
export function activePane(s: WorkspaceState = ws.get()): Pane {
  const t = activeTab(s);
  return t.panes[t.activePane] ?? t.panes[0]!;
}
export function findPane(paneId: string, s: WorkspaceState = ws.get()): { tab: Tab; pane: Pane; index: number } | undefined {
  for (const tab of s.tabs) {
    const index = tab.panes.findIndex((p) => p.id === paneId);
    if (index >= 0) return { tab, pane: tab.panes[index]!, index };
  }
  return undefined;
}

export function updatePane(paneId: string, patch: Partial<Pane> | ((p: Pane) => Partial<Pane>)): void {
  ws.set((s) => ({
    tabs: s.tabs.map((t) => ({ ...t, panes: t.panes.map((p) => (p.id === paneId ? { ...p, ...(typeof patch === 'function' ? patch(p) : patch) } : p)) })),
  }));
  scheduleSave();
}

function updateTab(tabId: string, patch: Partial<Tab> | ((t: Tab) => Partial<Tab>)): void {
  ws.set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, ...(typeof patch === 'function' ? patch(t) : patch) } : t)) }));
  scheduleSave();
}

// ------------------------------------------------------------------ navigation
/**
 * Navigate a pane. Filesystem locations are verified first; on failure the
 * pane stays where it was and the error is shown.
 */
export async function navigate(paneId: string, loc: Location, opts: { push?: boolean; select?: string; confirmed?: boolean } = {}): Promise<boolean> {
  const found = findPane(paneId);
  if (!found) return false;
  if (!opts.confirmed && !(await mayLeave(found.pane, loc.kind === 'fs' ? undefined : loc))) return false;
  if (loc.kind === 'fs') {
    try {
      const st = await call<FileEntry>('fs:stat', { path: loc.path });
      const isDir = st.kind === 'directory' || (st.kind === 'symlink' && st.linkTargetKind === 'directory');
      if (!isDir) {
        // A file path: open its folder and select it.
        const parent = parentPath(loc.path);
        if (!parent) return false;
        return navigate(paneId, { kind: 'fs', path: parent }, { ...opts, select: loc.path, confirmed: true });
      }
    } catch (err) {
      toastError(err, `Cannot open ${loc.path}`);
      return false;
    }
  }
  const pane = findPane(paneId)?.pane ?? found.pane;
  const cur = currentLocation(pane);
  const sameLoc = locationKey(cur) === locationKey(loc);
  if (sameLoc && loc.kind === 'editor') return true;
  if (cur.kind === 'editor' && !sameLoc) leaveHooks.left([paneId]);
  const restore = { ...(pane.restore ?? {}), [locationKey(cur)]: { scrollTop: scrollMemory.get(pane.id) ?? 0, focus: pane.focus } };
  scrollMemory.set(pane.id, 0);
  if (sameLoc && !opts.select) {
    reload(paneId);
    return true;
  }
  const history = opts.push === false || sameLoc ? pane.history : [...pane.history.slice(0, pane.index + 1), loc];
  const index = opts.push === false || sameLoc ? pane.index : history.length - 1;
  updatePane(paneId, {
    history: history.slice(-200),
    index: Math.min(index, 199),
    selection: opts.select ? [opts.select] : [],
    anchor: opts.select,
    focus: opts.select,
    filter: '',
    scrollTop: 0,
    restore,
  });
  if (loc.kind === 'fs') void call('cat:recordRecent', { path: loc.path, kind: 'directory' }).catch(() => undefined);
  return true;
}

/** Show another location in place of the current one (same history entry), without asking or leaving: the editor after "Save as". */
export function replaceLocation(paneId: string, loc: Location): void {
  updatePane(paneId, (p) => ({ history: p.history.map((l, i) => (i === p.index ? loc : l)) }));
}

export async function goHistory(paneId: string, delta: -1 | 1): Promise<void> {
  const found = findPane(paneId);
  if (!found) return;
  const { pane } = found;
  const next = pane.index + delta;
  if (next < 0 || next >= pane.history.length) return;
  const loc = pane.history[next]!;
  if (!(await mayLeave(pane, loc))) return;
  if (loc.kind === 'fs' || loc.kind === 'editor') {
    const ok = await call<{ exists: boolean }>('fs:resolve', { input: loc.path }).then((r) => r.exists, () => false);
    if (!ok) {
      toastError(new UiError({ category: 'not_found', operation: 'navigate', message: `${loc.path} no longer exists.`, dataChanged: 'no', retryable: false }));
      // Drop the stale entry so history does not keep pointing at it.
      updatePane(paneId, (p) => ({ history: p.history.filter((_, i) => i !== next), index: delta < 0 ? p.index - 1 : p.index }));
      return;
    }
  }
  if (currentLocation(pane).kind === 'editor' && locationKey(currentLocation(pane)) !== locationKey(loc)) leaveHooks.left([paneId]);
  const restore = { ...(pane.restore ?? {}), [locationKey(currentLocation(pane))]: { scrollTop: scrollMemory.get(pane.id) ?? 0, focus: pane.focus } };
  const saved = pane.restore?.[locationKey(loc)];
  scrollMemory.set(pane.id, saved?.scrollTop ?? 0);
  updatePane(paneId, { index: next, selection: saved?.focus ? [saved.focus] : [], focus: saved?.focus, anchor: saved?.focus, scrollTop: saved?.scrollTop ?? 0, filter: '', restore });
}

export function parentPath(p: string): string | undefined {
  const sep = p.includes('\\') && !p.includes('/') ? '\\' : '/';
  const trimmed = p.length > 1 ? p.replace(/[\\/]+$/, '') : p;
  if (/^[A-Za-z]:\\?$/.test(trimmed) || trimmed === '/') return undefined;
  const idx = trimmed.lastIndexOf(sep);
  if (idx < 0) return undefined;
  if (idx === 0) return sep;
  const parent = trimmed.slice(0, idx);
  return /^[A-Za-z]:$/.test(parent) ? `${parent}\\` : parent;
}

export function goUp(paneId: string): void {
  const found = findPane(paneId);
  if (!found) return;
  const loc = currentLocation(found.pane);
  if (loc.kind === 'remote') {
    const up = remoteParent(loc.path);
    if (up) void navigate(paneId, { kind: 'remote', connectionId: loc.connectionId, path: up }, { select: `orbis-remote://${loc.connectionId}${loc.path}` });
    return;
  }
  if (loc.kind !== 'fs') return;
  const parent = parentPath(loc.path);
  if (parent) void navigate(paneId, { kind: 'fs', path: parent }, { select: loc.path });
}

// ------------------------------------------------------------------ tabs
export function openTab(loc: Location = { kind: 'home' }, opts: { activate?: boolean; after?: string } = {}): Tab {
  const tab = newTab(loc);
  ws.set((s) => {
    const idx = opts.after ? s.tabs.findIndex((t) => t.id === opts.after) : s.tabs.length - 1;
    const tabs = [...s.tabs];
    tabs.splice(idx + 1, 0, tab);
    return { tabs, activeTabId: opts.activate === false ? s.activeTabId : tab.id };
  });
  scheduleSave();
  return tab;
}

export function duplicateTab(tabId: string): void {
  const t = ws.get().tabs.find((x) => x.id === tabId);
  if (!t) return;
  const copy: Tab = { ...structuredClone(t), id: uid(), pinned: false, groupId: t.groupId, panes: t.panes.map((p) => ({ ...structuredClone(p), id: uid() })) };
  ws.set((s) => {
    const tabs = [...s.tabs];
    tabs.splice(tabs.findIndex((x) => x.id === tabId) + 1, 0, copy);
    return { tabs, activeTabId: copy.id };
  });
  scheduleSave();
}

export function closeTabs(ids: string[]): void {
  // Unsaved editor changes in these tabs (also in panes not shown) are asked about first.
  const paneIds = ws.get().tabs.filter((t) => ids.includes(t.id)).flatMap((t) => t.panes.map((p) => p.id));
  if (leaveHooks.needsConfirm(paneIds)) {
    void leaveHooks.confirm(paneIds, ids.length > 1 ? 'close these tabs' : 'close the tab').then((ok) => ok && closeTabsNow(ids, paneIds));
    return;
  }
  closeTabsNow(ids, paneIds);
}

function closeTabsNow(ids: string[], paneIds: string[]): void {
  leaveHooks.left(paneIds);
  ws.set((s) => {
    const closing = s.tabs.filter((t) => ids.includes(t.id));
    let tabs = s.tabs.filter((t) => !ids.includes(t.id));
    if (!tabs.length) tabs = [newTab()];
    const activeStillOpen = tabs.some((t) => t.id === s.activeTabId);
    const oldIdx = s.tabs.findIndex((t) => t.id === s.activeTabId);
    return {
      tabs,
      activeTabId: activeStillOpen ? s.activeTabId : tabs[Math.min(oldIdx, tabs.length - 1)]!.id,
      closed: [...s.closed, ...closing].slice(-30),
    };
  });
  for (const id of ids) for (const key of Object.keys(listings.get())) if (key.startsWith(`${id}:`)) disposeListing(key);
  scheduleSave();
}

export function closeTab(tabId: string): void {
  closeTabs([tabId]);
}

export function closeOtherTabs(tabId: string): void {
  closeTabs(ws.get().tabs.filter((t) => t.id !== tabId && !t.pinned).map((t) => t.id));
}

export function closeTabsToRight(tabId: string): void {
  const tabs = ws.get().tabs;
  const idx = tabs.findIndex((t) => t.id === tabId);
  closeTabs(tabs.slice(idx + 1).filter((t) => !t.pinned).map((t) => t.id));
}

export function reopenClosedTab(): void {
  const s = ws.get();
  const last = s.closed[s.closed.length - 1];
  if (!last) return;
  ws.set({ tabs: [...s.tabs, last], activeTabId: last.id, closed: s.closed.slice(0, -1) });
  scheduleSave();
}

export function activateTab(tabId: string): void {
  ws.set({ activeTabId: tabId });
  scheduleSave();
}

export function cycleTab(delta: number): void {
  const s = ws.get();
  const idx = s.tabs.findIndex((t) => t.id === s.activeTabId);
  const next = s.tabs[(idx + delta + s.tabs.length) % s.tabs.length]!;
  activateTab(next.id);
}

export function togglePinTab(tabId: string): void {
  ws.set((s) => {
    const tabs = s.tabs.map((t) => (t.id === tabId ? { ...t, pinned: !t.pinned } : t));
    // Pinned tabs sit at the start.
    return { tabs: [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)] };
  });
  scheduleSave();
}

export function moveTab(tabId: string, toIndex: number): void {
  ws.set((s) => {
    const tabs = [...s.tabs];
    const from = tabs.findIndex((t) => t.id === tabId);
    if (from < 0) return {};
    const [t] = tabs.splice(from, 1);
    tabs.splice(Math.max(0, Math.min(toIndex, tabs.length)), 0, t!);
    return { tabs };
  });
  scheduleSave();
}

const GROUP_COLORS = ['#5caae8', '#4cc28f', '#e2b450', '#c79bf0', '#f0909f', '#7fd3b0'];

export function createGroup(tabIds: string[], name: string): void {
  const s = ws.get();
  const g: TabGroup = { id: uid(), name, color: GROUP_COLORS[s.groups.length % GROUP_COLORS.length]!, collapsed: false };
  ws.set({ groups: [...s.groups, g], tabs: s.tabs.map((t) => (tabIds.includes(t.id) ? { ...t, groupId: g.id } : t)) });
  scheduleSave();
}

export function setTabGroup(tabId: string, groupId: string | undefined): void {
  updateTab(tabId, { groupId });
  pruneGroups();
}

export function renameGroup(groupId: string, name: string): void {
  ws.set((s) => ({ groups: s.groups.map((g) => (g.id === groupId ? { ...g, name } : g)) }));
  scheduleSave();
}

export function toggleGroup(groupId: string): void {
  ws.set((s) => ({ groups: s.groups.map((g) => (g.id === groupId ? { ...g, collapsed: !g.collapsed } : g)) }));
  scheduleSave();
}

export function ungroup(groupId: string): void {
  ws.set((s) => ({ groups: s.groups.filter((g) => g.id !== groupId), tabs: s.tabs.map((t) => (t.groupId === groupId ? { ...t, groupId: undefined } : t)) }));
  scheduleSave();
}

function pruneGroups(): void {
  ws.set((s) => ({ groups: s.groups.filter((g) => s.tabs.some((t) => t.groupId === g.id)) }));
}

// ------------------------------------------------------------------ panes
/** Show this tab's panes in a given arrangement; panes beyond it keep their locations for later. */
export function setTabArrangement(tabId: string, arrangement: PaneArrangement, ratios?: number[]): void {
  const before = ws.get().tabs.find((t) => t.id === tabId);
  updateTab(tabId, (t) => ({
    arrangement,
    panes: withPanes(t.panes, arrangement),
    ratios: normalizeRatios(arrangement, ratios ?? (t.arrangement === arrangement ? t.ratios : [])),
    activePane: Math.min(t.activePane, PANE_COUNT[arrangement] - 1),
  }));
  // Panes that are no longer shown stop listing and watching their folders.
  if (before) for (const p of before.panes.slice(PANE_COUNT[arrangement])) for (const key of Object.keys(listings.get())) if (key.startsWith(`${tabId}:${p.id}:`)) disposeListing(key);
}

/** Apply an arrangement to every open tab (the layout setting changed). Locations are kept. */
export function setArrangementAll(arrangement: PaneArrangement, ratios: number[]): void {
  for (const t of ws.get().tabs) if (t.arrangement !== arrangement || JSON.stringify(t.ratios) !== JSON.stringify(normalizeRatios(arrangement, ratios))) setTabArrangement(t.id, arrangement, ratios);
}

/** Toggle between one pane and several for the current tab (several = the layout's arrangement, or two side by side). */
export function toggleSplit(tabId = ws.get().activeTabId): void {
  const t = ws.get().tabs.find((x) => x.id === tabId);
  if (!t) return;
  if (isSplit(t)) {
    // Keep the active pane's location as the single pane.
    const active = t.panes[t.activePane] ?? t.panes[0]!;
    updateTab(tabId, { panes: [active, ...t.panes.filter((p) => p !== active)], activePane: 0 });
    setTabArrangement(tabId, 'single');
    return;
  }
  const configured = resolvedNow().layout.panes.arrangement;
  setTabArrangement(tabId, configured === 'single' ? 'dual' : configured);
  updateTab(tabId, (x) => ({ activePane: 1, prevPane: 0, panes: x.panes.map((p, i) => (i === 1 ? { ...newPane(currentLocation(x.panes[0]!)), id: p.id } : p)) }));
}

export function setActivePane(tabId: string, index: number): void {
  updateTab(tabId, (t) => (t.activePane === index ? {} : { activePane: index, prevPane: t.activePane }));
}

/** Swap the active pane with the other pane (two panes) or the previously active one. */
export function swapPanes(tabId = ws.get().activeTabId): void {
  updateTab(tabId, (t) => {
    if (!isSplit(t)) return {};
    const a = t.activePane;
    const b = otherIndex(t);
    const panes = [...t.panes];
    [panes[a], panes[b]] = [panes[b]!, panes[a]!];
    return { panes, activePane: b, prevPane: a };
  });
}

export function setPaneRatios(tabId: string, ratios: number[]): void {
  updateTab(tabId, (t) => ({ ratios: normalizeRatios(t.arrangement, ratios.map((r) => Math.min(0.85, Math.max(0.15, r)))) }));
}

function otherIndex(t: Tab): number {
  const n = paneCount(t);
  if (t.prevPane !== undefined && t.prevPane !== t.activePane && t.prevPane < n) return t.prevPane;
  return (t.activePane + 1) % n;
}

/** The pane that "copy/move to other pane" targets: the previously active visible pane, or the next one. */
export function otherPane(paneId: string): Pane | undefined {
  const f = findPane(paneId);
  if (!f || !isSplit(f.tab)) return undefined;
  const t = { ...f.tab, activePane: f.index };
  return t.panes[otherIndex(t)];
}

// ------------------------------------------------------------------ selection
export function setSelection(paneId: string, selection: string[], anchor?: string, focus?: string): void {
  updatePane(paneId, (p) => ({ selection, anchor: anchor ?? p.anchor, focus: focus ?? p.focus }));
}

/**
 * Entries shown in a pane that are not part of its listing (children expanded
 * in the tree view). Selection and commands resolve paths against these too.
 */
const extraEntries = new Map<string, Map<string, FileEntry>>();

export function setExtraEntries(paneId: string, entries: FileEntry[] | null): void {
  if (!entries) {
    extraEntries.delete(paneId);
    return;
  }
  extraEntries.set(paneId, new Map(entries.map((e) => [e.path, e])));
}

export function selectedEntries(paneId: string): FileEntry[] {
  const f = findPane(paneId);
  if (!f) return [];
  const l = listings.get()[listingKeyFor(f.tab.id, f.pane)];
  const set = new Set(f.pane.selection);
  const out = (l?.entries ?? []).filter((e) => set.has(e.path));
  const extra = extraEntries.get(paneId);
  if (extra && out.length < set.size) {
    const have = new Set(out.map((e) => e.path));
    for (const p of f.pane.selection) if (!have.has(p) && extra.has(p)) out.push(extra.get(p)!);
  }
  return out;
}

// ------------------------------------------------------------------ listings
export function listingKeyFor(tabId: string, pane: Pane): string {
  return `${tabId}:${pane.id}:${locationKey(currentLocation(pane))}`;
}

interface Controller { listingId?: string; searchId?: string; watched?: string; off: Array<() => void> }
const controllers = new Map<string, Controller>();

function setListing(key: string, patch: Partial<Listing> | ((l: Listing) => Partial<Listing>)): void {
  listings.set((s) => {
    const cur = s[key];
    if (!cur) return {};
    return { [key]: { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) } };
  });
}

export function disposeListing(key: string): void {
  const c = controllers.get(key);
  if (c) {
    c.off.forEach((f) => f());
    if (c.listingId) void call('fs:listCancel', { listingId: c.listingId }).catch(() => undefined);
    if (c.searchId) void call('search:cancel', { searchId: c.searchId }).catch(() => undefined);
    if (c.watched) void call('fs:unwatch', { path: c.watched }).catch(() => undefined);
    controllers.delete(key);
  }
  listings.set((s) => {
    const next = { ...s };
    delete next[key];
    return next;
  });
}

/** Ensure a listing exists for this pane's current location. Called by the pane view. */
export function ensureListing(tabId: string, pane: Pane): string {
  const key = listingKeyFor(tabId, pane);
  if (listings.get()[key]) return key;
  const loc = currentLocation(pane);
  listings.set({ [key]: { key, status: 'loading', entries: [] } });
  const ctrl: Controller = { off: [] };
  controllers.set(key, ctrl);
  if (loc.kind === 'fs') void loadDirectory(key, loc.path, ctrl, true);
  else if (loc.kind === 'remote') void loadRemote(key, loc.connectionId, loc.path, true);
  else if (loc.kind === 'search') void runSearchListing(key, loc.query, loc.scope, ctrl);
  else setListing(key, { status: 'ready' });
  return key;
}

async function loadDirectory(key: string, dir: string, ctrl: Controller, watch: boolean): Promise<void> {
  const showHidden = app.get().settings.showHidden;
  let shown = 0;
  const { listingId, done } = startListing(dir, showHidden, (soFar) => {
    // Show the first batch immediately, then periodic updates for huge folders.
    if (!controllers.has(key)) return;
    if (shown === 0 || soFar.length - shown >= 2000) {
      shown = soFar.length;
      setListing(key, { entries: soFar.slice() });
    }
  });
  ctrl.listingId = listingId;
  const r = await done;
  ctrl.listingId = undefined;
  if (!controllers.has(key)) return;
  if (r.error) {
    setListing(key, { status: 'error', error: r.error, entries: [] });
    return;
  }
  setListing(key, { status: 'ready', entries: r.entries.slice(), error: undefined, loadedMs: Date.now() });
  if (watch && controllers.has(key)) {
    const ok = await call<boolean>('fs:watch', { path: dir }).catch(() => false);
    ctrl.watched = ok ? dir : undefined;
    setListing(key, { watching: ok });
    if (ok) {
      const off = on<{ path: string; unavailable?: boolean }>('fs:changed', (e) => {
        if (e.path === dir) void refreshListing(key, dir);
      });
      ctrl.off.push(off);
    }
  }
}

/**
 * List a folder on a server. When the connection needs the user (a password,
 * a host key decision), the connect dialogs are shown once; cancelling them
 * leaves the pane with a "Not connected" state and a way to try again.
 */
async function loadRemote(key: string, id: string, dir: string, interactive: boolean): Promise<void> {
  const list = () => call<{ entries: FileEntry[]; refused: string[] }>('remote:listDir', { id, path: dir, showHidden: app.get().settings.showHidden });
  let r: { entries: FileEntry[]; refused: string[] };
  try {
    r = await list();
  } catch (err) {
    // Interactive needsConnect errors show the connect dialogs as before.
    // Non-interactive connection errors (dropped SSH, timeout) get one
    // silent reconnection attempt so background refreshes recover on their own.
    const wantsInteractive = interactive && needsConnect(err);
    const wantsAutoReconnect = !wantsInteractive && isConnectionError(err);
    if (!wantsInteractive && !wantsAutoReconnect) {
      if (listings.get()[key]) setListing(key, { status: 'error', error: err instanceof UiError ? err.shape : undefined, entries: [] });
      return;
    }
    const ok = wantsAutoReconnect
      ? await call<{ status: string }>('remote:connect', { id }).then((c) => c.status === 'connected', () => false)
      : await ensureConnected(id);
    if (!listings.get()[key]) return;
    if (!ok) {
      if (wantsInteractive) {
        setListing(key, { status: 'error', entries: [], error: { category: 'unavailable', operation: 'remote.connect', message: 'Not connected. Connect to see this folder.', cause: 'not_connected', dataChanged: 'no', retryable: true } });
      } else {
        setListing(key, { status: 'error', error: err instanceof UiError ? err.shape : undefined, entries: [] });
      }
      return;
    }
    try {
      r = await list();
    } catch (err2) {
      if (listings.get()[key]) setListing(key, { status: 'error', error: err2 instanceof UiError ? err2.shape : undefined, entries: [] });
      return;
    }
  }
  if (!listings.get()[key]) return;
  setListing(key, { status: 'ready', entries: r.entries, error: undefined, loadedMs: Date.now(), refused: r.refused.length ? r.refused : undefined });
  pruneSelections(key, r.entries);
}

const refreshing = new Set<string>();
async function refreshListing(key: string, dir: string): Promise<void> {
  if (refreshing.has(key)) return;
  refreshing.add(key);
  try {
    const r = await startListing(dir, app.get().settings.showHidden).done;
    if (!listings.get()[key]) return;
    if (r.error) setListing(key, { status: 'error', error: r.error });
    else {
      setListing(key, { entries: r.entries, status: 'ready', loadedMs: Date.now() });
      pruneSelections(key, r.entries);
    }
  } finally {
    refreshing.delete(key);
  }
}

/** Drop selected paths that no longer exist in the refreshed listing. */
function pruneSelections(key: string, entries: FileEntry[]): void {
  const [tabId, paneId] = key.split(':');
  const present = new Set([...entries.map((e) => e.path), ...(extraEntries.get(paneId!)?.keys() ?? [])]);
  const f = findPane(paneId!);
  if (!f || f.tab.id !== tabId) return;
  if (f.pane.selection.some((p) => !present.has(p))) updatePane(paneId!, { selection: f.pane.selection.filter((p) => present.has(p)) });
}

export function reload(paneId: string): void {
  const f = findPane(paneId);
  if (!f) return;
  if (currentLocation(f.pane).kind === 'editor') {
    leaveHooks.refresh(paneId);
    return;
  }
  const key = listingKeyFor(f.tab.id, f.pane);
  disposeListing(key);
  ensureListing(f.tab.id, f.pane);
}

/** Refresh every visible listing showing `dir` (after an operation); `dir` may be a remote reference. */
export function refreshDir(dir: string): void {
  if (isRemoteRef(dir)) {
    const r = parseRemoteRef(dir);
    if (!r) return;
    for (const key of Object.keys(listings.get())) if (key.endsWith(`:remote:${r.connectionId}:${r.path}`)) void loadRemote(key, r.connectionId, r.path, false);
    return;
  }
  for (const [key, l] of Object.entries(listings.get())) {
    if (l.search) continue;
    if (key.endsWith(`:fs:${dir}`)) void refreshListing(key, dir);
  }
}

async function runSearchListing(key: string, query: string, scope: string[], ctrl: Controller): Promise<void> {
  const searchId = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  ctrl.searchId = searchId;
  const entries: FileEntry[] = [];
  let pending = false;
  setListing(key, { status: 'ready', entries: [], search: { query, running: true } });
  const offR = on<{ searchId: string; entries: FileEntry[] }>('search:results', (e) => {
    if (e.searchId !== searchId) return;
    entries.push(...e.entries);
    if (!pending) {
      pending = true;
      setTimeout(() => {
        pending = false;
        setListing(key, { entries: entries.slice() });
      }, 120);
    }
  });
  const offD = on<{ searchId: string; report?: SearchReport; error?: OrbisErrorShape }>('search:done', (e) => {
    if (e.searchId !== searchId) return;
    offR();
    offD();
    ctrl.searchId = undefined;
    setListing(key, { entries: entries.slice(), search: { query, running: false, report: e.report, error: e.error } });
  });
  ctrl.off.push(offR, offD);
  try {
    await call('search:start', { query, scope, searchId, useIndex: true, showHidden: app.get().settings.showHidden });
  } catch (err) {
    offR();
    offD();
    setListing(key, { search: { query, running: false, error: err instanceof UiError ? err.shape : undefined } });
  }
}

export function cancelSearch(key: string): void {
  const c = controllers.get(key);
  if (c?.searchId) void call('search:cancel', { searchId: c.searchId });
}

// ------------------------------------------------------------------ persistence
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let restoring = false;
export function scheduleSave(): void {
  if (restoring) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!app.get().settings.restoreSession) return;
    const s = ws.get();
    const session = {
      version: 1,
      activeTabId: s.activeTabId,
      groups: s.groups,
      // Locations and view state only; no listing data or selections are stored.
      tabs: s.tabs.map((t) => ({ ...t, panes: t.panes.map((p) => ({ ...p, selection: [], restore: undefined, history: p.history.slice(-30), index: Math.min(p.index, 29) })) })),
    };
    void call('cat:saveSession', { session }).catch(() => undefined);
  }, 800);
}

/** Restore the saved session, revalidating every filesystem location. */
export async function restoreSession(initialPath?: string): Promise<void> {
  restoring = true;
  let restored = false;
  try {
    const s = app.get().settings;
    const start = resolvedNow().navigation.start;
    const saved = s.restoreSession && start.kind === 'last' ? await call<{ version: number; tabs: Tab[]; activeTabId: string; groups: TabGroup[] } | null>('cat:session') : null;
    if (saved?.version === 1 && Array.isArray(saved.tabs) && saved.tabs.length) {
      const tabs: Tab[] = [];
      for (const t of saved.tabs) {
        const panes: Pane[] = [];
        for (const p of t.panes) {
          const loc = p.history[p.index];
          let valid = true;
          if (loc?.kind === 'fs') valid = await call<{ exists: boolean; kind?: string }>('fs:resolve', { input: loc.path }).then((r) => r.exists && r.kind === 'directory', () => false);
          // Archives (including temporary copies of nested archives) must still exist.
          else if (loc?.kind === 'archive') valid = !loc.via?.length && (await call('fs:stat', { path: loc.archivePath }).then(() => true, () => false));
          // Files open in the editor are opened again from disk (unsaved changes are never stored).
          else if (loc?.kind === 'editor') valid = await call<FileEntry>('fs:stat', { path: loc.path }).then((e) => e.kind === 'file' || (e.kind === 'symlink' && e.linkTargetKind === 'file'), () => false);
          // Remote folders are not reopened at start (that would connect to servers without being asked).
          else if (loc?.kind === 'remote') valid = false;
          panes.push(valid && loc ? { ...newPane(), ...p, selection: [] } : { ...newPane({ kind: 'home' }), id: p.id });
        }
        tabs.push(normalizeTab({ ...t, panes }));
      }
      ws.set({ tabs, activeTabId: tabs.some((t) => t.id === saved.activeTabId) ? saved.activeTabId : tabs[0]!.id, groups: saved.groups ?? [] });
      restored = true;
    }
  } catch {
    /* fall back to a fresh workspace */
  } finally {
    restoring = false;
  }
  if (!restored) {
    // A fresh start uses the view and layout defaults now in effect, and the preferred start folder.
    let loc: Location = { kind: 'home' };
    const start = resolvedNow().navigation.start;
    if (start.kind === 'path' && start.path && !initialPath) {
      const r = await call<{ exists: boolean; kind?: string; error?: { message: string } }>('fs:resolve', { input: start.path }).catch(() => undefined);
      if (r?.exists && r.kind === 'directory') loc = { kind: 'fs', path: start.path };
      else startFolderUnavailable(start.path, r?.error?.message);
    }
    const t = newTab(loc);
    ws.set({ tabs: [t], activeTabId: t.id, groups: [], closed: [] });
  }
  if (initialPath) openTab({ kind: 'fs', path: initialPath });
}

/** The preferred start folder is missing or unreadable: say so instead of silently starting elsewhere. */
function startFolderUnavailable(path: string, reason?: string): void {
  const vol = app.get().volumes;
  const onMissingDrive = vol.length > 0 && !vol.some((v) => path === v.mountPath || path.startsWith(v.mountPath.endsWith('/') || v.mountPath.endsWith('\\') ? v.mountPath : `${v.mountPath}/`));
  toast({
    level: 'warning',
    sticky: true,
    title: 'Your start folder is not available, so Orbis Files opened Home',
    detail: `${path}${reason ? ` — ${reason}` : onMissingDrive ? ' — its drive may be disconnected.' : ' — it may have been moved, renamed or deleted.'}`,
    actions: [
      { label: 'Try again', run: () => void call<{ exists: boolean; kind?: string }>('fs:resolve', { input: path }).then((r) => (r.exists && r.kind === 'directory' ? void navigate(activePane().id, { kind: 'fs', path }) : toast({ level: 'warning', title: 'The start folder is still not available', detail: path })), () => undefined) },
      { label: 'Change start folder…', run: () => document.dispatchEvent(new CustomEvent('orbis:open-studio', { detail: { category: 'navigation', setting: 'navigation.start' } })) },
    ],
  });
}

// ------------------------------------------------------------------ renamed / moved locations
/** Replace `from` (or a path inside it) with the same path under `to`. */
export function remapPath(p: string, from: string, to: string): string | undefined {
  if (p === from) return to;
  const sep = from.includes('\\') && !from.includes('/') ? '\\' : '/';
  const prefix = from.endsWith(sep) ? from : from + sep;
  return p.startsWith(prefix) ? to + (to.endsWith(sep) ? '' : sep) + p.slice(prefix.length) : undefined;
}

function remapLocation(l: Location, from: string, to: string): Location {
  if (l.kind === 'fs') {
    const p = remapPath(l.path, from, to);
    return p ? { ...l, path: p } : l;
  }
  if (l.kind === 'editor') {
    const p = remapPath(l.path, from, to);
    return p ? { ...l, path: p } : l;
  }
  if (l.kind === 'archive') {
    const p = remapPath(l.archivePath, from, to);
    return p ? { ...l, archivePath: p } : l;
  }
  if (l.kind === 'search') {
    const scope = l.scope.map((s) => remapPath(s, from, to) ?? s);
    return scope.some((s, i) => s !== l.scope[i]) ? { ...l, scope } : l;
  }
  return l;
}

/**
 * After a folder or file was renamed or moved (by Orbis Files), keep every
 * tab's history, current location and selection pointing at the item in its
 * new place, in every pane, instead of leaving them at a path that no longer
 * exists.
 */
export function remapLocations(moves: Array<{ from: string; to: string }>): void {
  if (!moves.length) return;
  const remapSel = (paths: string[]) => paths.map((p) => moves.reduce<string>((acc, m) => remapPath(acc, m.from, m.to) ?? acc, p));
  ws.set((s) => ({
    tabs: s.tabs.map((t) => ({
      ...t,
      panes: t.panes.map((p) => {
        const history = p.history.map((l) => moves.reduce((acc, m) => remapLocation(acc, m.from, m.to), l));
        const changed = history.some((l, i) => l !== p.history[i]);
        const selection = remapSel(p.selection);
        if (!changed && selection.every((x, i) => x === p.selection[i])) return p;
        const focus = p.focus ? remapSel([p.focus])[0] : undefined;
        const anchor = p.anchor ? remapSel([p.anchor])[0] : undefined;
        return { ...p, history, selection, focus, anchor };
      }),
    })),
  }));
}

/** Move a whole tab group one step left or right, past a single tab or a whole neighbouring group. */
export function moveGroup(gid: string, dir: -1 | 1): void {
  ws.set((s) => {
    const members = s.tabs.filter((t) => t.groupId === gid);
    if (!members.length) return {};
    const rest = s.tabs.filter((t) => t.groupId !== gid);
    let pos = s.tabs.slice(0, s.tabs.indexOf(members[0]!)).filter((t) => t.groupId !== gid).length;
    if (dir < 0) {
      if (pos === 0) return {};
      const left = rest[pos - 1]!;
      pos -= 1;
      if (left.groupId) while (pos > 0 && rest[pos - 1]!.groupId === left.groupId) pos--;
    } else {
      if (pos >= rest.length) return {};
      const right = rest[pos]!;
      pos += 1;
      if (right.groupId) while (pos < rest.length && rest[pos]!.groupId === right.groupId) pos++;
    }
    return { tabs: [...rest.slice(0, pos), ...members, ...rest.slice(pos)] };
  });
}

// ------------------------------------------------------------------ following the customization
/** Apply the file-view defaults in effect to every open pane (locations and selections are kept). */
export function applyViewDefaultsToPanes(): void {
  const v = resolvedNow().view;
  ws.set((s) => ({
    tabs: s.tabs.map((t) => ({ ...t, panes: t.panes.map((p) => ({ ...p, view: v.view, sort: { ...v.sort }, thenBy: v.thenBy.map((x) => ({ ...x })), groupBy: v.groupBy })) })),
  }));
  scheduleSave();
}

/**
 * Keep open tabs in step with the customization: a changed pane arrangement
 * (layout editor, preset, workspace, or a preview of one) is shown in every
 * tab, and switching workspace or preset applies its view defaults to the
 * open panes. Folders shown are never changed and nothing is re-listed.
 */
export function followCustomization(): void {
  let lastPanes = resolvedNow().layout.panes;
  let lastScope = `${resolvedNow().workspace.id}|${resolvedNow().preset?.id ?? ''}`;
  const viewDefaultsKey = () => {
    const v = resolvedNow().view;
    return JSON.stringify([v.view, v.sort, v.thenBy, v.groupBy]);
  };
  let lastDefaults = viewDefaultsKey();
  custom.subscribe(() => {
    const r = resolvedNow();
    if (r.layout.panes !== lastPanes) {
      const changed = JSON.stringify(r.layout.panes) !== JSON.stringify(lastPanes);
      lastPanes = r.layout.panes;
      if (changed) setArrangementAll(r.layout.panes.arrangement, r.layout.panes.ratios);
    }
    // A workspace or preset switch applies its view defaults to open panes, but only when they
    // actually differ, so a colour-only preset never resets a pane's own view.
    const scope = `${r.workspace.id}|${r.preset?.id ?? ''}`;
    const defaults = viewDefaultsKey();
    if (scope !== lastScope) {
      lastScope = scope;
      if (defaults !== lastDefaults) applyViewDefaultsToPanes();
    }
    lastDefaults = defaults;
  });
}
