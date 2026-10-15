import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { clearShelf, loadShelf, removeFromShelf, shelf, shelfTargets, addToShelf, type ShelfItem } from '../state/shelf';
import { activePane, currentLocation, navigate, parentPath, ws } from '../state/workspace';
import { applyCustom } from '../state/custom';
import { call } from '../api';
import { toastError } from '../state/app';
import { runCommand, shortcutFor } from '../commands';
import { FileIcon, IconButton, SEP, useMenu, type MenuItem } from '../ui/components';
import { Icon } from '../ui/Icon';
import { formatBytes } from '../ui/format';
import { beginDrag, dragOut, endDrag, isDraggingPaths, readDragPaths } from './dnd';
import type { FileEntry } from '../../shared/model';

/**
 * The shelf (drop stack): a tray under the file area. Drop items on it from
 * any folder, pane or tab (or use "Add to shelf"); they stay where they are.
 * Drag them out onto a folder or pane (move/copy like any drag), or copy/move
 * them all — or the ones selected here — into the folder shown.
 */

const extOf = (name: string) => (name.lastIndexOf('.') > 0 ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '');

let collapsedForSession = false;

export function Shelf() {
  const { items, selection, loaded } = useStore(shelf, (s) => ({ items: s.items, selection: s.selection, loaded: s.loaded }));
  const dir = useStore(ws, () => {
    const l = currentLocation(activePane());
    return l.kind === 'fs' ? l.path : undefined;
  });
  const [collapsed, setCollapsed] = useState(collapsedForSession);
  const [over, setOver] = useState(false);
  const [focus, setFocus] = useState<string | undefined>();
  const anchor = useRef<string | undefined>(undefined);
  const listRef = useRef<HTMLDivElement>(null);
  const menu = useMenu();
  useEffect(() => {
    if (!loaded) void loadShelf();
  }, [loaded]);
  // Items can disappear (or come back) through other programs: check again when the window is back in front.
  useEffect(() => {
    const onFocus = () => void loadShelf();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const sel = useMemo(() => new Set(selection), [selection]);
  const missing = items.filter((i) => !i.exists).length;
  const targets = shelfTargets();
  const setSel = (paths: string[]) => shelf.set({ selection: paths });
  const toggleCollapsed = () => {
    collapsedForSession = !collapsed;
    setCollapsed(!collapsed);
  };

  const select = (e: React.MouseEvent | React.KeyboardEvent, item: ShelfItem) => {
    setFocus(item.path);
    if (e.shiftKey && anchor.current) {
      const a = items.findIndex((i) => i.path === anchor.current);
      const b = items.findIndex((i) => i.path === item.path);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      setSel(items.slice(lo, hi + 1).map((i) => i.path));
      return;
    }
    anchor.current = item.path;
    if (e.ctrlKey || e.metaKey) setSel(sel.has(item.path) ? selection.filter((p) => p !== item.path) : [...selection, item.path]);
    else setSel(sel.has(item.path) && selection.length === 1 ? [] : [item.path]);
  };

  const showInFolder = (item: ShelfItem) => {
    const parent = parentPath(item.path);
    if (parent) void navigate(activePane().id, { kind: 'fs', path: parent }, { select: item.path });
  };
  const open = async (item: ShelfItem) => {
    if (!item.exists) return;
    if (item.kind === 'directory') return void navigate(activePane().id, { kind: 'fs', path: item.path });
    try {
      const entry = await call<FileEntry>('fs:stat', { path: item.path });
      const { openEntry } = await import('../actions');
      await openEntry(activePane().id, entry);
    } catch (err) {
      toastError(err);
    }
  };

  const itemMenu = (e: React.MouseEvent | { clientX: number; clientY: number }, item: ShelfItem) => {
    const chosen = sel.has(item.path) ? selection : [item.path];
    const items: MenuItem[] = item.exists ? [
      { label: item.kind === 'directory' ? 'Open' : 'Open', icon: 'open', run: () => void open(item) },
      { label: 'Show in folder', icon: 'folderOpen', run: () => showInFolder(item) },
      { label: 'Copy path', icon: 'path', run: () => void call('fs:copyText', { text: chosen.join('\n') }) },
      SEP,
      { label: chosen.length > 1 ? `Remove ${chosen.length} from the shelf` : 'Remove from the shelf', icon: 'close', run: () => void removeFromShelf(chosen) },
    ] : [
      { label: item.reason === 'permission' ? 'Not readable (permission denied)' : item.reason === 'unavailable' ? 'Not available (drive or network)' : 'Not found: moved or deleted outside Orbis Files', disabled: true, reason: item.path },
      ...(parentPath(item.path) ? [{ label: 'Open the folder it was in', icon: 'folderOpen', run: () => showInFolder(item) }] : []),
      SEP,
      { label: chosen.length > 1 ? `Remove ${chosen.length} from the shelf` : 'Remove from the shelf', icon: 'close', run: () => void removeFromShelf(chosen) },
    ];
    menu.open(items, e.clientX, e.clientY);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!items.length) return;
    const idx = Math.max(0, items.findIndex((i) => i.path === focus));
    // Keys handled here never reach the file commands (Delete would otherwise move the pane's selection to the Trash).
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    const move = (to: number) => {
      const t = items[Math.max(0, Math.min(items.length - 1, to))]!;
      handled();
      setFocus(t.path);
      if (e.shiftKey) select(e, t);
      else if (!e.ctrlKey && !e.metaKey) {
        anchor.current = t.path;
        setSel([t.path]);
      }
    };
    const cur = items[idx]!;
    switch (e.key) {
      case 'ArrowRight': case 'ArrowDown': return move(focus ? idx + 1 : 0);
      case 'ArrowLeft': case 'ArrowUp': return move(idx - 1);
      case 'Home': return move(0);
      case 'End': return move(items.length - 1);
      case ' ':
        handled();
        setFocus(cur.path);
        setSel(sel.has(cur.path) ? selection.filter((p) => p !== cur.path) : [...selection, cur.path]);
        return;
      case 'Enter':
        handled();
        if (e.altKey) showInFolder(cur);
        else void open(cur);
        return;
      case 'Delete': case 'Backspace':
        handled();
        void removeFromShelf(selection.length ? selection : [cur.path]);
        return;
      case 'Escape':
        if (selection.length) {
          handled();
          setSel([]);
        }
        return;
      case 'ContextMenu': {
        handled();
        const el = listRef.current?.querySelector('.shelf-item.is-focused') ?? listRef.current;
        const r = el!.getBoundingClientRect();
        itemMenu({ clientX: r.left + 20, clientY: r.top + r.height / 2 }, cur);
        return;
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      handled();
      setSel(items.map((i) => i.path));
    }
  };

  const countLabel = `${items.length.toLocaleString()} item${items.length === 1 ? '' : 's'}${missing ? ` · ${missing} missing` : ''}${selection.length ? ` · ${selection.length} selected` : ''}`;
  const verb = (v: string) => (targets.selected ? `${v} ${selection.length} here` : `${v} all here`);
  const transferWhy = !dir ? 'Open a folder first.' : !targets.paths.length ? (items.length ? 'The shelf items are missing.' : 'The shelf is empty.') : undefined;

  return (
    <section
      className={`shelf ${over ? 'is-drop' : ''} ${collapsed ? 'is-collapsed' : ''}`}
      aria-label="Shelf"
      onDragOver={(e) => {
        if (!isDraggingPaths(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'link';
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const paths = readDragPaths(e).filter((p) => !items.some((i) => i.path === p));
        if (paths.length) void addToShelf(paths);
      }}
    >
      <div className="shelf-head">
        <button type="button" className="shelf-toggle" aria-expanded={!collapsed} aria-controls="shelf-items" onClick={toggleCollapsed} title={collapsed ? 'Show the shelf items' : 'Collapse the shelf'}>
          <Icon name={collapsed ? 'chevronRight' : 'chevronDown'} size={12} />
          <Icon name="shelf" size={14} />
          <span className="shelf-title">Shelf</span>
          <span className="shelf-count tabular">{countLabel}</span>
        </button>
        <span className="spacer" />
        <button type="button" className="btn btn-ghost btn-sm shelf-act" disabled={!!transferWhy} title={transferWhy ?? `Copy into ${dir}`} aria-label={verb('Copy')} onClick={() => void runCommand('shelf.copyHere')}>
          <Icon name="copyTo" size={14} /><span className="shelf-act-label">{verb('Copy')}</span>
        </button>
        <button type="button" className="btn btn-ghost btn-sm shelf-act" disabled={!!transferWhy} title={transferWhy ?? `Move into ${dir}`} aria-label={verb('Move')} onClick={() => void runCommand('shelf.moveHere')}>
          <Icon name="moveTo" size={14} /><span className="shelf-act-label">{verb('Move')}</span>
        </button>
        {selection.length > 0 && <IconButton icon="minus" label={`Remove ${selection.length} selected from the shelf`} onClick={() => void removeFromShelf(selection)} />}
        <IconButton icon="trash" className="shelf-clear" label="Clear the shelf (files are not touched)" disabled={!items.length} onClick={() => void clearShelf()} />
        <IconButton icon="close" label="Hide the shelf" shortcut={shortcutFor('shelf.toggle')} onClick={() => void applyCustom({ op: 'set', section: 'layout', path: ['shelf', 'visible'], value: false, label: 'Shelf' })} />
      </div>
      {!collapsed && (items.length ? (
        <div
          ref={listRef}
          id="shelf-items"
          className="shelf-items"
          role="listbox"
          aria-label="Items on the shelf"
          aria-multiselectable
          tabIndex={0}
          aria-activedescendant={focus ? `shelf-${items.findIndex((i) => i.path === focus)}` : undefined}
          onKeyDown={onKeyDown}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !e.ctrlKey && !e.metaKey) setSel([]);
          }}
        >
          {items.map((item, i) => {
            const selected = sel.has(item.path);
            return (
              <div
                key={item.path}
                id={`shelf-${i}`}
                role="option"
                aria-selected={selected}
                className={`shelf-item ${selected ? 'is-selected' : ''} ${focus === item.path ? 'is-focused' : ''} ${item.exists ? '' : 'is-missing'}`}
                title={`${item.path}${item.exists ? (item.size !== undefined ? ` · ${formatBytes(item.size)}` : '') : item.reason === 'permission' ? ' — permission denied' : item.reason === 'unavailable' ? ' — not available' : ' — not found (moved or deleted outside Orbis Files)'}`}
                draggable={item.exists}
                onMouseDown={(e) => {
                  if (e.button === 0) select(e, item);
                  else if (e.button === 2 && !sel.has(item.path)) {
                    setFocus(item.path);
                    setSel([item.path]);
                  }
                }}
                onDoubleClick={() => void open(item)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  itemMenu(e, item);
                }}
                onDragStart={(e) => {
                  const paths = selected ? items.filter((x) => sel.has(x.path) && x.exists).map((x) => x.path) : [item.path];
                  beginDrag(e, paths);
                  if (e.altKey) {
                    e.preventDefault();
                    dragOut(paths);
                  }
                }}
                onDragEnd={endDrag}
              >
                {item.exists ? <FileIcon entry={{ kind: item.kind === 'symlink' ? 'symlink' : item.kind === 'directory' ? 'directory' : 'file', ext: item.kind === 'directory' ? '' : extOf(item.name) }} size={15} /> : <Icon name="removeLocation" size={15} className="shelf-missing-icon" />}
                <span className="shelf-name">{item.name}</span>
                {!item.exists && <span className="shelf-flag">{item.reason === 'permission' ? 'no access' : item.reason === 'unavailable' ? 'unavailable' : 'missing'}</span>}
                {/* Mouse shortcut only (like a tab's close control): with the keyboard, Delete removes the focused or selected items. */}
                <span className="shelf-remove" aria-hidden="true" title="Remove from the shelf" onMouseDown={(e) => e.stopPropagation()} onClick={() => void removeFromShelf([item.path])}>
                  <Icon name="close" size={11} />
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <p id="shelf-items" className="shelf-empty">
          <Icon name="shelfAdd" size={14} />
          <span>Drop files or folders here, or use Add to shelf{shortcutFor('shelf.add') ? ` (${shortcutFor('shelf.add')})` : ''}. They stay where they are; the shelf keeps a reference.</span>
        </p>
      ))}
      {menu.node}
    </section>
  );
}
