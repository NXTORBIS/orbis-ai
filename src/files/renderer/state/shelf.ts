import { createStore } from './store';
import { call, on } from '../api';
import { toast, toastError } from './app';
import { applyCustom, resolvedNow } from './custom';
import { startOperation } from '../actions';
import { parentPath } from './workspace';

/**
 * The shelf (drop stack) in the renderer: the items as the main process
 * reports them (references with their state on disk) and the user's
 * selection on the shelf. Copy/Move "here" are ordinary operations.
 */

export interface ShelfItem {
  path: string;
  name: string;
  addedMs: number;
  exists: boolean;
  reason?: 'missing' | 'permission' | 'unavailable';
  kind?: 'file' | 'directory' | 'symlink' | 'other';
  size?: number;
  modifiedMs?: number;
}

export const shelf = createStore<{ items: ShelfItem[]; selection: string[]; loaded: boolean }>({ items: [], selection: [], loaded: false });

let subscribed = false;
export async function loadShelf(): Promise<void> {
  if (!subscribed) {
    subscribed = true;
    on('shelf:changed', () => void loadShelf());
    // Items moved or deleted by other programs show up as missing (and back) after operations finish.
    on<{ state: string }>('ops:update', (rec) => {
      if (['completed', 'completed_with_errors', 'failed', 'cancelled'].includes(rec?.state)) void loadShelf();
    });
  }
  try {
    const items = await call<ShelfItem[]>('shelf:list');
    const have = new Set(items.map((i) => i.path));
    shelf.set((s) => ({ items, loaded: true, selection: s.selection.filter((p) => have.has(p)) }));
  } catch (err) {
    toastError(err, 'The shelf could not be read');
  }
}

/** Items "Copy/Move … here" acts on: the selection on the shelf, else everything; missing items are left out. */
export function shelfTargets(): { paths: string[]; missing: number; selected: boolean } {
  const s = shelf.get();
  const sel = new Set(s.selection);
  const chosen = s.selection.length ? s.items.filter((i) => sel.has(i.path)) : s.items;
  return { paths: chosen.filter((i) => i.exists).map((i) => i.path), missing: chosen.filter((i) => !i.exists).length, selected: s.selection.length > 0 };
}

export async function showShelf(): Promise<void> {
  if (!resolvedNow().layout.shelf.visible) await applyCustom({ op: 'set', section: 'layout', path: ['shelf', 'visible'], value: true, label: 'Shelf' }, { quiet: true });
}

export async function addToShelf(paths: string[]): Promise<void> {
  if (!paths.length) return;
  try {
    const r = await call<{ added: number; already: number; missing: string[] }>('shelf:add', { paths: paths.slice(0, 500) });
    // With the shelf in view the new chips are the confirmation; otherwise it is shown and a note says what happened.
    const wasVisible = resolvedNow().layout.shelf.visible;
    void showShelf();
    if (r.added && !wasVisible) toast({ level: 'success', title: `Added ${r.added} item${r.added === 1 ? '' : 's'} to the shelf`, detail: r.already ? `${r.already} ${r.already === 1 ? 'was' : 'were'} already on it.` : 'The items stay where they are; the shelf keeps a reference.' });
    else if (r.already) toast({ level: 'info', title: r.already === 1 ? 'Already on the shelf' : 'All of these are already on the shelf' });
    if (r.missing.length) toast({ level: 'warning', title: `${r.missing.length} item${r.missing.length === 1 ? '' : 's'} no longer exist${r.missing.length === 1 ? 's' : ''} and ${r.missing.length === 1 ? 'was' : 'were'} not added` });
    await loadShelf();
  } catch (err) {
    toastError(err, 'Not added to the shelf');
  }
}

export async function removeFromShelf(paths: string[]): Promise<void> {
  if (!paths.length) return;
  await call('shelf:remove', { paths }).catch(toastError);
  shelf.set((s) => ({ selection: s.selection.filter((p) => !paths.includes(p)) }));
  await loadShelf();
}

export async function clearShelf(): Promise<void> {
  await call('shelf:clear').catch(toastError);
  shelf.set({ selection: [] });
  await loadShelf();
}

/** Copy or move the shelf's items (or the selected ones) into a folder, as one operation with conflict prompts. */
export async function shelfTransfer(mode: 'copy' | 'move', dest: string): Promise<void> {
  const t = shelfTargets();
  // Moving an item into the folder it is already in does nothing; copying it there makes a copy ("keep both" is asked).
  const paths = mode === 'move' ? t.paths.filter((p) => parentPath(p) !== dest && p !== dest) : t.paths.filter((p) => p !== dest);
  if (!paths.length) {
    toast({ level: 'info', title: t.missing ? 'The shelf items are missing' : mode === 'move' ? 'Everything is already in this folder' : 'Nothing to copy', detail: t.missing ? 'Missing items cannot be copied or moved.' : undefined });
    return;
  }
  if (t.missing) toast({ level: 'warning', title: `${t.missing} missing item${t.missing === 1 ? ' is' : 's are'} left out` });
  await startOperation({ type: mode, sources: paths, destination: dest, conflictPolicy: 'ask', origin: 'shelf' });
}
