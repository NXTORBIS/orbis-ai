import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { call, on } from '../../api';
import { app, confirm, toast, toastError } from '../../state/app';
import { useStore } from '../../state/store';
import { activePane, navigate, parentPath } from '../../state/workspace';
import { Button, EmptyState, ErrorState, Loading, Pill } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { formatBytes, formatCount, formatDate } from '../../ui/format';
import { startOperation } from '../../actions';
import type { TrashItem, TrashListing } from '../../../shared/trash';
import { useStickyHead } from './common';

type SortKey = 'name' | 'original' | 'deleted' | 'size';
const COLUMNS: Array<{ key: SortKey; label: string; numeric?: boolean }> = [
  { key: 'name', label: 'Name' },
  { key: 'original', label: 'Original location' },
  { key: 'deleted', label: 'Deleted' },
  { key: 'size', label: 'Size', numeric: true },
];

const displayName = (it: TrashItem) => (it.originalPath ? (it.originalPath.split(/[\\/]/).pop() ?? it.name) : it.name);

function compare(a: TrashItem, b: TrashItem, key: SortKey): number {
  switch (key) {
    case 'name': return displayName(a).localeCompare(displayName(b), undefined, { numeric: true, sensitivity: 'base' });
    case 'original': return (a.originalPath ?? '￿').localeCompare(b.originalPath ?? '￿');
    case 'deleted': return (a.deletedMs ?? 0) - (b.deletedMs ?? 0);
    case 'size': return (a.size ?? -1) - (b.size ?? -1);
  }
}

/**
 * The system Trash (Linux, freedesktop.org Trash specification): every item
 * in the home Trash and the Trash folders of mounted drives, with Restore,
 * Restore to…, Delete permanently and Empty Trash. Restoring and deleting run
 * as operations (progress, results and conflicts in Operations); restoring
 * never replaces an item that is already at the destination.
 */
export function TrashView() {
  const [listing, setListing] = useState<TrashListing | null>(null);
  const [error, setError] = useState<{ message: string; errorId?: string } | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'deleted', dir: 'desc' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusId, setFocusId] = useState<string | null>(null);
  const anchor = useRef<string | null>(null);
  const tbody = useRef<HTMLTableSectionElement>(null);
  const loadSeq = useRef(0);
  const stickyBar = useStickyHead();

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const l = await call<TrashListing>('trash:list');
      if (seq !== loadSeq.current) return;
      setListing(l);
      setError(null);
      if (l.supported) {
        const ids = new Set(l.items.map((i) => i.id));
        setSelected((s) => new Set([...s].filter((id) => ids.has(id))));
      }
    } catch (err) {
      if (seq !== loadSeq.current) return;
      const shape = (err as { shape?: { message: string; errorId?: string } }).shape;
      setError({ message: shape?.message ?? (err as Error).message, errorId: shape?.errorId });
    }
  }, []);

  useEffect(() => {
    void load();
    // The main process watches the Trash folders and reports finished Trash operations.
    return on('trash:changed', () => void load());
  }, [load]);

  const items = useMemo(() => {
    if (!listing?.supported) return [];
    const list = listing.items.slice().sort((a, b) => compare(a, b, sort.key));
    return sort.dir === 'desc' ? list.reverse() : list;
  }, [listing, sort]);
  const chosen = items.filter((i) => selected.has(i.id));
  const totalBytes = items.reduce((a, i) => a + (i.size ?? 0), 0);

  // ------------------------------------------------------------------ actions
  const restore = async (list: TrashItem[]) => {
    const ok = list.filter((i) => i.originalPath);
    const unknown = list.length - ok.length;
    if (!ok.length) {
      toast({ level: 'warning', title: 'The original location of the selected items is not known', detail: 'Use Restore to… to choose a folder.' });
      return;
    }
    const rec = await startOperation({ type: 'trash-restore', sources: ok.map((i) => i.id), conflictPolicy: 'ask', origin: 'trash-view' });
    if (rec && unknown) toast({ level: 'info', title: `${formatCount(unknown, 'item')} not restored`, detail: 'Their original location is not known. Use Restore to… for them.' });
  };

  const restoreTo = async (list: TrashItem[]) => {
    if (!list.length) return;
    const dir = await call<string | null>('fs:pickDirectory', { title: `Restore ${formatCount(list.length, 'item')} to…` }).catch((e) => {
      toastError(e);
      return null;
    });
    if (!dir) return;
    await startOperation({ type: 'trash-restore', sources: list.map((i) => i.id), destination: dir, conflictPolicy: 'ask', origin: 'trash-view' });
  };

  const deleteForever = async (list: TrashItem[]) => {
    if (!list.length) return;
    const folders = list.filter((i) => i.kind === 'directory').length;
    const ok = await confirm({
      title: `Permanently delete ${formatCount(list.length, 'item')}?`,
      body: `${folders ? `${formatCount(folders, 'folder')} and everything inside ${folders === 1 ? 'it' : 'them'} will be deleted. ` : ''}They are removed from the Trash and cannot be restored.`,
      confirmLabel: 'Delete permanently',
      destructive: true,
      detail: list.slice(0, 8).map((i) => i.originalPath ?? i.name).concat(list.length > 8 ? [`…and ${list.length - 8} more`] : []),
    });
    if (ok) await startOperation({ type: 'trash-delete', sources: list.map((i) => i.id), origin: 'trash-view' });
  };

  const emptyTrash = async () => {
    if (!listing?.supported || !listing.items.length) return;
    const n = listing.items.length;
    const ok = await confirm({
      title: `Empty the Trash?`,
      body: `All ${formatCount(n, 'item')} (${formatBytes(totalBytes)}) in the Trash will be permanently deleted. This cannot be undone. Items moved to the Trash after this list was read are not included.`,
      confirmLabel: `Delete ${formatCount(n, 'item')} permanently`,
      destructive: true,
      detail: listing.dirs.map((d) => `${d.kind === 'home' ? 'Home Trash' : `Trash on ${d.topdir}`}: ${d.path}`),
    });
    if (ok) await startOperation({ type: 'trash-delete', sources: listing.items.map((i) => i.id), origin: 'trash-empty' });
  };

  // ------------------------------------------------------------------ selection and keyboard
  const indexOf = (id: string | null) => (id ? items.findIndex((i) => i.id === id) : -1);
  const focusRow = (id: string) => {
    setFocusId(id);
    requestAnimationFrame(() => tbody.current?.querySelector<HTMLElement>(`tr[data-id="${CSS.escape(id)}"]`)?.focus());
  };
  const selectRange = (from: string, to: string, add: boolean) => {
    const a = indexOf(from);
    const b = indexOf(to);
    if (a < 0 || b < 0) return;
    const range = items.slice(Math.min(a, b), Math.max(a, b) + 1).map((i) => i.id);
    setSelected((s) => new Set([...(add ? s : []), ...range]));
  };
  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const onRowClick = (e: React.MouseEvent, id: string) => {
    if (e.shiftKey && anchor.current) selectRange(anchor.current, id, e.ctrlKey || e.metaKey);
    else if (e.ctrlKey || e.metaKey) {
      toggle(id);
      anchor.current = id;
    } else {
      setSelected(new Set([id]));
      anchor.current = id;
    }
    setFocusId(id);
  };
  /** Keys handled here are not passed on to the window's shortcuts (Delete, Enter and Ctrl+A act on the Trash, not on files). */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!items.length) return;
    const cur = Math.max(0, indexOf(focusId));
    const move = (to: number) => {
      const next = items[Math.max(0, Math.min(items.length - 1, to))]!;
      if (e.shiftKey) selectRange(anchor.current ?? items[cur]!.id, next.id, false);
      else if (!(e.ctrlKey || e.metaKey)) {
        setSelected(new Set([next.id]));
        anchor.current = next.id;
      }
      focusRow(next.id);
    };
    let handled = true;
    if (e.key === 'ArrowDown') move(cur + 1);
    else if (e.key === 'ArrowUp') move(cur - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(items.length - 1);
    else if (e.key === 'PageDown') move(cur + 10);
    else if (e.key === 'PageUp') move(cur - 10);
    else if (e.key === ' ') {
      toggle(items[cur]!.id);
      anchor.current = items[cur]!.id;
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') setSelected(new Set(items.map((i) => i.id)));
    else if (e.key === 'Escape' && selected.size) setSelected(new Set());
    else if (e.key === 'Delete' && chosen.length) void deleteForever(chosen);
    else if (e.key === 'Enter' && chosen.length) void restore(chosen);
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const ops = useStore(app, (s) => Object.values(s.ops).filter((o) => (o.type === 'trash-restore' || o.type === 'trash-delete') && !['completed', 'completed_with_errors', 'failed', 'cancelled', 'interrupted'].includes(o.state)).length);
  // Track completed trash operations and auto-refresh the listing.
  const completedTrashOps = useStore(app, (s) => Object.values(s.ops).filter((o) => (o.type === 'trash-restore' || o.type === 'trash-delete') && ['completed', 'completed_with_errors', 'failed', 'cancelled', 'interrupted'].includes(o.state)).length);
  const prevCompleted = useRef(completedTrashOps);
  useEffect(() => {
    if (completedTrashOps > prevCompleted.current) void load();
    prevCompleted.current = completedTrashOps;
  }, [completedTrashOps, load]);

  // ------------------------------------------------------------------ render
  if (error) {
    return (
      <div className="tool-view scroll-y">
        <header className="view-header"><h1>Trash</h1></header>
        <ErrorState title="The Trash could not be read" body={error.message} errorId={error.errorId}><Button onClick={() => void load()}>Try again</Button></ErrorState>
      </div>
    );
  }
  if (!listing) return <div className="tool-view"><Loading label="Reading the Trash…" /></div>;
  if (!listing.supported) {
    return (
      <div className="tool-view scroll-y">
        <header className="view-header"><h1>{listing.systemTrashName}</h1></header>
        <EmptyState icon="trash" title={`The ${listing.systemTrashName} is managed by your system`} body={listing.note}>
          {listing.canOpenSystemTrash && (
            <Button icon="external" onClick={() => void call('trash:openSystem').catch(toastError)}>Open the {listing.systemTrashName}</Button>
          )}
        </EmptyState>
      </div>
    );
  }

  const restorable = chosen.filter((i) => i.originalPath).length;
  return (
    <div className="tool-view scroll-y">
      <header className="view-header">
        <h1>Trash</h1>
        <p className="muted">
          {items.length ? `${formatCount(items.length, 'item')} · ${formatBytes(totalBytes)}` : 'Nothing is in the Trash.'}
          {ops ? ` · ${ops} Trash operation${ops === 1 ? '' : 's'} running (see Operations)` : ''}
        </p>
      </header>
      <div ref={stickyBar} className="selection-bar sticky" role="toolbar" aria-label="Trash actions">
        <span>{chosen.length ? `${formatCount(chosen.length, 'item')} selected` : 'Select items to restore or delete them.'}</span>
        <span className="spacer" />
        <Button size="sm" icon="undo" disabled={!restorable} title={chosen.length && !restorable ? 'The original location of the selection is not known; use Restore to…' : undefined} onClick={() => void restore(chosen)}>Restore</Button>
        <Button size="sm" icon="folderOpen" disabled={!chosen.length} onClick={() => void restoreTo(chosen)}>Restore to…</Button>
        <Button size="sm" variant="danger" icon="deleteForever" disabled={!chosen.length} onClick={() => void deleteForever(chosen)}>Delete permanently…</Button>
        <Button size="sm" variant="danger" icon="trash" disabled={!items.length} onClick={() => void emptyTrash()}>Empty Trash…</Button>
        <Button size="sm" variant="ghost" icon="refresh" onClick={() => void load()}>Refresh</Button>
      </div>
      {listing.problems.map((p) => <p key={p} className="warning-text small">{p}</p>)}
      {!items.length ? (
        <EmptyState icon="trash" title="The Trash is empty" body={listing.dirs.length ? undefined : 'No Trash folder exists yet; one is created the first time something is moved to the Trash.'} />
      ) : (
        <table className="table" role="grid" aria-label="Items in the Trash" aria-multiselectable="true" aria-rowcount={items.length + 1}>
          <thead>
            <tr>
              <th style={{ width: 28 }}>
                <input type="checkbox" aria-label="Select all" checked={chosen.length === items.length} ref={(el) => {
                  if (el) el.indeterminate = chosen.length > 0 && chosen.length < items.length;
                }} onChange={(e) => setSelected(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())} />
              </th>
              {COLUMNS.map((c) => (
                <th key={c.key} aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={[c.numeric ? 'num' : '', c.key === 'original' || c.key === 'deleted' ? 'wide-only' : ''].join(' ').trim() || undefined}>
                  <button type="button" className="th-sort" onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key && s.dir === 'asc' ? 'desc' : s.key === c.key ? 'asc' : c.key === 'deleted' || c.key === 'size' ? 'desc' : 'asc' }))}>
                    {c.label}
                    {sort.key === c.key && <Icon name={sort.dir === 'asc' ? 'up' : 'down'} size={12} />}
                  </button>
                </th>
              ))}
              <th><span className="sr-only">Original folder</span></th>
            </tr>
          </thead>
          <tbody ref={tbody} onKeyDown={onKeyDown}>
            {items.map((it, i) => {
              const isSel = selected.has(it.id);
              const focusable = (focusId ?? items[0]!.id) === it.id;
              return (
                <tr
                  key={it.id}
                  data-id={it.id}
                  className={`clickable ${isSel ? 'is-selected' : ''}`}
                  aria-selected={isSel}
                  aria-rowindex={i + 2}
                  tabIndex={focusable ? 0 : -1}
                  onFocus={() => setFocusId(it.id)}
                  onClick={(e) => onRowClick(e, it.id)}
                  onDoubleClick={() => void restore([it])}
                >
                  <td><input type="checkbox" tabIndex={-1} aria-label={`Select ${displayName(it)}`} checked={isSel} onClick={(e) => e.stopPropagation()} onChange={() => { toggle(it.id); anchor.current = it.id; }} /></td>
                  <td className="cell-name-min">
                    <span className="trash-name"><Icon name={it.kind === 'directory' ? 'folder' : it.kind === 'symlink' ? 'link' : 'file'} size={14} /> {displayName(it)}</span>
                    <div className="cell-sub narrow-only">
                      <div className={it.originalPath ? 'mono' : undefined}>{it.originalPath ? parentPath(it.originalPath) ?? it.originalPath : 'Original location unknown'}</div>
                      <div>{it.deletedMs ? `Deleted ${formatDate(it.deletedMs)}` : 'Deletion date not recorded'}</div>
                    </div>
                  </td>
                  <td className="wide-only">
                    {it.originalPath ? <span className="mono small trash-origin">{parentPath(it.originalPath) ?? it.originalPath}</span> : <Pill tone="warning">Unknown</Pill>}
                    {it.problem && <div className="muted small">{it.problem}</div>}
                  </td>
                  <td className="tabular wide-only">{it.deletedMs ? formatDate(it.deletedMs) : <span className="muted">Not recorded</span>}</td>
                  <td className="tabular num">{it.size !== undefined ? `${it.sizeComplete ? '' : 'at least '}${formatBytes(it.size)}` : <span className="muted">—</span>}</td>
                  <td className="row-actions">
                    {it.originalPath && parentPath(it.originalPath) && (
                      <button type="button" tabIndex={-1} className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); void navigate(activePane().id, { kind: 'fs', path: parentPath(it.originalPath!)! }); }} title="Open the folder it was deleted from" aria-label={`Open the folder ${displayName(it)} was deleted from`}>Open folder</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="muted small">
        Reading {listing.dirs.length ? listing.dirs.map((d) => d.path).join(', ') : 'no Trash folders (none exist yet)'}.
        Restore puts items back where they were deleted from and never replaces anything that is there now — you choose Keep both or Skip.
        Keyboard: arrows move, Shift+arrows extend, Space selects, Enter restores, Delete deletes permanently.
      </p>
    </div>
  );
}
