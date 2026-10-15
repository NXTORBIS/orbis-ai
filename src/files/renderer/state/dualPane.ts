import { createStore } from './store';
import {
  activeTab, isSplit, navigate, otherPane, paneCount, selectedEntries, setActivePane, toggleSplit,
  visiblePanes, type Pane,
} from './workspace';
import { call } from '../api';
import { toast, toastError, openDialog } from './app';
import type { Location } from '../../shared/model';

/**
 * Dual-pane mode: a dedicated Total Commander / Midnight Commander–style
 * file manager overlay. Activating it ensures two panes are shown and adds
 * a toolbar strip between them with F5–F8 actions and a sync-navigation toggle.
 */

export interface DualPaneState {
  /** Dual-pane mode is active. */
  active: boolean;
  /** Both panes navigate in sync (entering a subfolder in one enters it in the other). */
  syncNav: boolean;
}

export const dualPane = createStore<DualPaneState>({ active: false, syncNav: false });

/** The pane index that is NOT active. */
function otherIndex(): number {
  const tab = activeTab();
  return (tab.activePane + 1) % paneCount(tab);
}

/** Activate dual-pane mode. */
export function enableDualPane(): void {
  const tab = activeTab();
  if (!isSplit(tab)) toggleSplit(tab.id);
  dualPane.set({ active: true });
}

/** Deactivate dual-pane mode (keeps the split open). */
export function disableDualPane(): void {
  dualPane.set({ active: false });
}

export function toggleDualPane(): void {
  if (dualPane.get().active) disableDualPane();
  else enableDualPane();
}

export function toggleSyncNav(): void {
  const next = !dualPane.get().syncNav;
  dualPane.set({ syncNav: next });
  toast({ level: 'info', title: next ? 'Sync navigation on' : 'Sync navigation off' });
}

/** Switch active pane (Tab key in dual-pane mode). */
export function switchPane(): void {
  const tab = activeTab();
  if (!isSplit(tab)) return;
  setActivePane(tab.id, otherIndex());
}

/** Directory of a pane's current location (undefined when not in a folder). */
function paneDir(p: Pane): string | undefined {
  const loc = p.history[p.index];
  return loc?.kind === 'fs' ? loc.path : undefined;
}

/** F5: Copy selected files from the active pane to the other pane's directory. */
export function copyToOther(): void {
  const tab = activeTab();
  if (!isSplit(tab)) return;
  const panes = visiblePanes(tab);
  const srcPane = panes[tab.activePane]!;
  const dstPane = panes[otherIndex()]!;
  const sel = selectedEntries(srcPane.id);
  const dstDir = paneDir(dstPane);
  if (!sel.length) { toast({ level: 'info', title: 'Select files to copy.' }); return; }
  if (!dstDir) { toast({ level: 'info', title: 'The other pane is not in a folder.' }); return; }
  void call('ops:start', {
    type: 'copy',
    sources: sel.map((e) => e.path),
    destination: dstDir,
    conflictPolicy: 'ask',
  }).catch(toastError);
}

/** F6: Move selected files from the active pane to the other pane's directory. */
export function moveToOther(): void {
  const tab = activeTab();
  if (!isSplit(tab)) return;
  const panes = visiblePanes(tab);
  const srcPane = panes[tab.activePane]!;
  const dstPane = panes[otherIndex()]!;
  const sel = selectedEntries(srcPane.id);
  const dstDir = paneDir(dstPane);
  if (!sel.length) { toast({ level: 'info', title: 'Select files to move.' }); return; }
  if (!dstDir) { toast({ level: 'info', title: 'The other pane is not in a folder.' }); return; }
  void call('ops:start', {
    type: 'move',
    sources: sel.map((e) => e.path),
    destination: dstDir,
    conflictPolicy: 'ask',
  }).catch(toastError);
}

/** F7: Create a new folder in the active pane's directory. */
export function newFolderInActive(): void {
  const tab = activeTab();
  const panes = visiblePanes(tab);
  const p = panes[tab.activePane];
  const dir = p ? paneDir(p) : undefined;
  if (!dir) { toast({ level: 'info', title: 'Navigate to a folder first.' }); return; }
  openDialog('newFolder', { parent: dir });
}

/** F8: Delete selected files in the active pane. */
export function deleteSelected(): void {
  const tab = activeTab();
  const panes = visiblePanes(tab);
  const p = panes[tab.activePane];
  if (!p) return;
  const sel = selectedEntries(p.id);
  if (!sel.length) { toast({ level: 'info', title: 'Select files to delete.' }); return; }
  void call('ops:start', {
    type: 'trash',
    sources: sel.map((e) => e.path),
  }).catch(toastError);
}

/**
 * Navigate both panes in sync: when the active pane enters a subdirectory
 * and sync is on, navigate the other pane to the same absolute path.
 */
export function syncNavigate(location: Location): void {
  if (!dualPane.get().active || !dualPane.get().syncNav) return;
  const tab = activeTab();
  if (!isSplit(tab)) return;
  const other = otherPane(visiblePanes(tab)[tab.activePane]!.id);
  if (!other) return;
  if (location.kind === 'fs') {
    void navigate(other.id, location);
  }
}
