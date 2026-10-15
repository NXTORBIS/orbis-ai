// @ts-nocheck -- vendored Orbis Files code, checked by its own stricter-than-Orbis toolchain
import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FileEntry, SortSpec, ViewMode, Volume } from '../../shared/model';
import type { MediaSummary } from '../../shared/media';
import { app } from '../state/app';
import { applyCustom, useCustom } from '../state/custom';
import { checksumFor, checksums } from '../state/checksums';
import { DEFAULT_COLUMNS, type ColumnConfig } from '../../shared/customization/schema';
import { useStore } from '../state/store';
import { formatBytes, formatDate, formatMediaDuration, kindLabel } from '../ui/format';
import { permissionString } from '../../shared/permissions';
import { FileIcon, SEP, useMenu, type MenuItem } from '../ui/components';
import { Icon } from '../ui/Icon';
import { beginDrag, dragOut, dropEffectFor, endDrag, isDraggingPaths, readDragPaths } from './dnd';
import { dropOnto } from '../actions';
import { call, startListing } from '../api';
import { ensureRendererThumb } from './videoThumbs';
import { THUMB_SOURCE_LIMITS, thumbKindForExt, type ThumbKind } from '../../shared/thumbKinds';
import { folderSizeCell } from './folderSizeColumn';
import type { FolderSizesState } from '../state/folderSizes';
import { gitBadgeFor, type GitFolder } from '../state/git';
import { GIT_CODE_LABEL, GIT_CODE_LETTER, type GitBadge } from '../../shared/git';
import { TextMatch } from './ocr/TextMatch';

/* ---------------------------------------------------------------- arrange: see ./arrange.ts */
export { arrange, sortEntries, volumeOf, type ArrangeData, type Row, type TagMap, type ThenBy } from './arrange';
import { sortEntries, volumeOf, type Row, type TagMap, type ThenBy } from './arrange';

const isDir = (e: FileEntry) => e.kind === 'directory' || (e.kind === 'symlink' && e.linkTargetKind === 'directory');

/* ---------------------------------------------------------------- selection behaviour */

export interface ViewProps {
  rows: Row[];
  selection: string[];
  focus?: string;
  view: ViewMode;
  sort: SortSpec;
  thenBy?: ThenBy;
  active: boolean;
  scrollTop?: number;
  onSort: (s: SortSpec) => void;
  onSelect: (paths: string[], anchor?: string, focus?: string) => void;
  onOpen: (e: FileEntry, mode: 'here' | 'tab') => void;
  onContext: (e: React.MouseEvent, entry?: FileEntry) => void;
  onScroll: (top: number) => void;
  onActivate: () => void;
  dropDir?: string;
  tags?: TagMap;
  meta?: Record<string, MediaSummary>;
  owners?: Record<number, string>;
  showLocation?: boolean;
  /** Calculated child-folder sizes for this folder (View → Calculate folder sizes). */
  folderSizes?: FolderSizesState;
  /** Git status of this folder's items (badges in the Name cell and the Git column). */
  git?: GitFolder;
  /** Only these Details columns apply (remote folders: name, size, dates, type); thumbnails are not made. */
  onlyColumns?: ReadonlySet<string>;
}

function useSelectionHandlers(p: ViewProps, items: FileEntry[]) {
  const index = useMemo(() => new Map(items.map((e, i) => [e.path, i])), [items]);
  const anchorRef = useRef<string | undefined>(undefined);
  const click = (e: React.MouseEvent, entry: FileEntry) => {
    p.onActivate();
    const mod = e.ctrlKey || e.metaKey;
    if (e.shiftKey) {
      const a = index.get(anchorRef.current ?? p.focus ?? entry.path) ?? 0;
      const b = index.get(entry.path) ?? 0;
      const [lo, hi] = a < b ? [a, b] : [b, a];
      const range = items.slice(lo, hi + 1).map((x) => x.path);
      p.onSelect(mod ? [...new Set([...p.selection, ...range])] : range, anchorRef.current, entry.path);
    } else if (mod) {
      const set = new Set(p.selection);
      if (set.has(entry.path)) set.delete(entry.path);
      else set.add(entry.path);
      anchorRef.current = entry.path;
      p.onSelect([...set], entry.path, entry.path);
    } else {
      anchorRef.current = entry.path;
      if (!(p.selection.length > 1 && p.selection.includes(entry.path) && e.button === 2)) p.onSelect([entry.path], entry.path, entry.path);
    }
  };
  return { click, index, anchorRef };
}

const typeahead = { text: '', t: 0 };

function handleListKeys(e: React.KeyboardEvent, p: ViewProps, items: FileEntry[], columns: number, pageSize: number, anchorRef: React.MutableRefObject<string | undefined>) {
  const idx = p.focus ? items.findIndex((x) => x.path === p.focus) : -1;
  const move = (to: number) => {
    const t = Math.max(0, Math.min(items.length - 1, to));
    const target = items[t];
    if (!target) return;
    e.preventDefault();
    if (e.shiftKey) {
      const a = items.findIndex((x) => x.path === (anchorRef.current ?? p.focus ?? target.path));
      const [lo, hi] = a < t ? [a, t] : [t, a];
      p.onSelect(items.slice(Math.max(0, lo), hi + 1).map((x) => x.path), anchorRef.current, target.path);
    } else if (e.ctrlKey || e.metaKey) {
      p.onSelect(p.selection, anchorRef.current, target.path);
    } else {
      anchorRef.current = target.path;
      p.onSelect([target.path], target.path, target.path);
    }
  };
  switch (e.key) {
    case 'ArrowDown': return move(idx < 0 ? 0 : idx + columns);
    case 'ArrowUp': return move(idx < 0 ? 0 : idx - columns);
    case 'ArrowRight': if (columns > 1) return move(idx + 1); return;
    case 'ArrowLeft': if (columns > 1) return move(idx - 1); return;
    case 'Home': return move(0);
    case 'End': return move(items.length - 1);
    case 'PageDown': return move(idx + pageSize * columns);
    case 'PageUp': return move(idx - pageSize * columns);
    case ' ':
      if ((e.ctrlKey || e.metaKey) && p.focus) {
        e.preventDefault();
        const set = new Set(p.selection);
        if (set.has(p.focus)) set.delete(p.focus);
        else set.add(p.focus);
        p.onSelect([...set], p.focus, p.focus);
      }
      return;
    case 'ContextMenu': {
      e.preventDefault();
      const el = (e.currentTarget as HTMLElement).querySelector('.is-focused') as HTMLElement | null;
      const r = el?.getBoundingClientRect() ?? (e.currentTarget as HTMLElement).getBoundingClientRect();
      const entry = items[idx];
      p.onContext({ clientX: r.left + 40, clientY: r.top + r.height / 2, preventDefault() {}, stopPropagation() {} } as unknown as React.MouseEvent, entry);
      return;
    }
  }
  // Type-ahead: jump to the next item starting with the typed text.
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && /\S/.test(e.key)) {
    const now = Date.now();
    typeahead.text = now - typeahead.t > 800 ? e.key.toLowerCase() : typeahead.text + e.key.toLowerCase();
    typeahead.t = now;
    const start = typeahead.text.length === 1 ? idx + 1 : Math.max(0, idx);
    const order = [...items.slice(start), ...items.slice(0, start)];
    const hit = order.find((x) => x.name.toLowerCase().startsWith(typeahead.text));
    if (hit) {
      e.preventDefault();
      anchorRef.current = hit.path;
      p.onSelect([hit.path], hit.path, hit.path);
    }
  }
}

/* ---------------------------------------------------------------- virtual scrolling */

function useViewport(ref: React.RefObject<HTMLElement>, initialTop = 0) {
  const [state, setState] = useState({ top: initialTop, height: 600, width: 800 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = initialTop;
    const ro = new ResizeObserver(() => setState((s) => ({ ...s, height: el.clientHeight, width: el.clientWidth })));
    ro.observe(el);
    setState({ top: el.scrollTop, height: el.clientHeight, width: el.clientWidth });
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return [state, (top: number) => setState((s) => ({ ...s, top }))] as const;
}

function useScrollIntoView(ref: React.RefObject<HTMLElement>, focusIndex: number, rowTop: (i: number) => number, rowH: number, header = 0) {
  useEffect(() => {
    const el = ref.current;
    if (!el || focusIndex < 0) return;
    const top = rowTop(focusIndex);
    if (top < el.scrollTop + header) el.scrollTop = top - header;
    else if (top + rowH > el.scrollTop + el.clientHeight) el.scrollTop = top + rowH - el.clientHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusIndex]);
}

function useDropTarget(dropDir: string | undefined) {
  const [over, setOver] = useState<string | null>(null);
  const handlers = {
    onDragOver: (e: React.DragEvent, dir = dropDir, label?: string) => {
      if (!dir || !isDraggingPaths(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const mode = dropEffectFor(e, dir);
      e.dataTransfer.dropEffect = mode;
      setOver(`${dir}|${mode === 'move' ? 'Move' : 'Copy'} to ${label ?? 'this folder'}`);
    },
    onDrop: (e: React.DragEvent, dir = dropDir) => {
      if (!dir) return;
      e.preventDefault();
      e.stopPropagation();
      const mode = dropEffectFor(e, dir);
      setOver(null);
      const paths = readDragPaths(e);
      if (paths.length) void dropOnto(dir, paths, mode);
    },
    onDragLeave: () => setOver(null),
  };
  return { over, ...handlers, clear: () => setOver(null) };
}

/* ---------------------------------------------------------------- details / list / compact */

const COLUMN_DEFS: Record<string, { label: string; align?: 'right'; sortKey?: SortSpec['key'] }> = {
  name: { label: 'Name', sortKey: 'name' },
  modified: { label: 'Date modified', sortKey: 'modified' },
  created: { label: 'Date created', sortKey: 'created' },
  type: { label: 'Type', sortKey: 'type' },
  size: { label: 'Size', align: 'right', sortKey: 'size' },
  accessed: { label: 'Date accessed', sortKey: 'accessed' },
  ext: { label: 'Extension', sortKey: 'ext' },
  tags: { label: 'Tags', sortKey: 'tags' },
  location: { label: 'Location' },
  attributes: { label: 'Permissions' },
  owner: { label: 'Owner' },
  dimensions: { label: 'Dimensions', align: 'right', sortKey: 'dimensions' },
  duration: { label: 'Duration', align: 'right', sortKey: 'duration' },
  taken: { label: 'Date taken', sortKey: 'taken' },
  volume: { label: 'Volume' },
  checksum: { label: 'Checksum (SHA-256)' },
  git: { label: 'Git' },
};
export const COLUMN_LABEL = (id: string): string => COLUMN_DEFS[id]?.label ?? id;

const DEFAULT_WIDTHS: Record<string, number> = { accessed: 170, attributes: 110, owner: 110, dimensions: 110, duration: 90, taken: 170, ext: 80, tags: 160, created: 170, volume: 140, checksum: 170, git: 120 };

/** Column ids that can be shown in folder listings (Location is added automatically to search results). */
export const LISTING_COLUMNS = Object.keys(COLUMN_DEFS).filter((id) => id !== 'location');

/** Stored column preferences plus any columns added since they were saved (hidden). */
export function allColumns(stored: ColumnConfig[]): ColumnConfig[] {
  const known = stored.filter((c) => COLUMN_DEFS[c.id] && c.id !== 'location').map((c) => ({ ...c }));
  for (const id of LISTING_COLUMNS) {
    if (!known.some((c) => c.id === id)) known.push({ id: id as ColumnConfig['id'], width: DEFAULT_WIDTHS[id] ?? 140, visible: false, pinned: false });
  }
  return known;
}

/** Save a column arrangement (Customization → Columns; undoable, per workspace when it overrides columns). */
export function saveColumns(cols: ColumnConfig[], label: string): Promise<boolean> {
  return applyCustom({ op: 'set', section: 'view', path: ['columns'], value: cols, label }, { quiet: true });
}


/** Columns whose values come from reading inside files. */
export const META_COLUMNS = new Set(['dimensions', 'duration', 'taken']);

export function ListView(p: ViewProps) {
  const ref = useRef<HTMLDivElement>(null);
  const items = useMemo(() => p.rows.filter((r): r is Extract<Row, { type: 'item' }> => r.type === 'item').map((r) => r.entry), [p.rows]);
  const configured = useCustom((r) => r.view.columns);
  const geometry = useCustom((r) => ({ row: r.appearance.rowHeight, density: r.appearance.density, minTarget: r.accessibility.minTarget }));
  // Live widths while a column is being dragged; committed (one undoable change) on release.
  const [dragWidths, setDragWidths] = useState<Record<string, number>>({});
  const settings = useMemo(() => ({ cols: configured.map((c) => (dragWidths[c.id] ? { ...c, width: dragWidths[c.id]! } : c)) }), [configured, dragWidths]);
  const volumes = useStore(app, (s) => s.volumes);
  const sums = useStore(checksums, (s) => s.byPath);
  const baseRow = geometry.row ?? (geometry.density === 'compact' ? 24 : geometry.density === 'spacious' ? 36 : 30);
  // Rows are click targets, so they never get smaller than the minimum target size.
  const rowH = Math.max(p.view === 'compact' ? Math.min(22, baseRow) : baseRow, geometry.minTarget);
  const header = p.view === 'details' ? 30 : 0;
  const [vp, setTop] = useViewport(ref, p.scrollTop);
  const sel = useMemo(() => new Set(p.selection), [p.selection]);
  const { click, anchorRef } = useSelectionHandlers(p, items);
  const menu = useMenu();
  const drop = useDropTarget(p.dropDir);
  const [colDrag, setColDrag] = useState<string | null>(null);

  const cols = useMemo(() => {
    const visible = settings.cols.filter((c) => c.visible && COLUMN_DEFS[c.id] && (!p.onlyColumns || c.id === 'name' || p.onlyColumns.has(c.id)));
    // Pinned columns come first and stay in view when scrolling sideways.
    const base: Array<ColumnConfig & { left?: number }> = [...visible.filter((c) => c.pinned), ...visible.filter((c) => !c.pinned)];
    if (p.showLocation && !base.some((c) => c.id === 'location')) base.splice(base.filter((c) => c.pinned).length || 1, 0, { id: 'location', width: 260, visible: true, pinned: false });
    let left = 0;
    for (const c of base) {
      if (!c.pinned) break;
      c.left = left;
      left += c.id === 'name' ? Math.max(160, c.width) : c.width;
    }
    return p.view === 'details' ? base : [{ id: 'name' as const, width: 0, visible: true, pinned: false }];
  }, [settings.cols, p.view, p.showLocation, p.onlyColumns]);
  // The Name column narrows (down to 160px) before the list scrolls sideways, unless another pinned
  // column sticks after it (its sticky offset assumes the full Name width).
  const fixedName = cols.some((c) => c.pinned && c.id !== 'name');
  const template = p.view === 'details' ? cols.map((c) => (c.id === 'name' ? (fixedName ? `${Math.max(160, c.width)}px` : `minmax(160px, ${c.width}px)`) : `${c.width}px`)).join(' ') + ' 1fr' : '1fr';
  // Header and rows share one minimum width, so their grids resolve to the same column positions
  // (the rows are absolutely positioned and cannot size the scroll area themselves).
  const minCols = p.view === 'details' ? cols.reduce((a, c) => a + (c.id === 'name' ? (fixedName ? Math.max(160, c.width) : 160) : c.width), 0) : 0;
  const pinStyle = (c: { pinned: boolean; left?: number }): React.CSSProperties | undefined => (p.view === 'details' && c.pinned && c.left !== undefined ? { position: 'sticky', left: c.left, zIndex: 1 } : undefined);

  const rowTop = useCallback((i: number) => header + i * rowH, [header, rowH]);
  const focusIndex = p.focus ? p.rows.findIndex((r) => r.type === 'item' && r.entry.path === p.focus) : -1;
  useScrollIntoView(ref, focusIndex, rowTop, rowH, header);

  const first = Math.max(0, Math.floor((vp.top - header) / rowH) - 10);
  const last = Math.min(p.rows.length, Math.ceil((vp.top + vp.height) / rowH) + 10);
  const pageSize = Math.max(1, Math.floor(vp.height / rowH) - 1);

  const resizeCol = (id: string, startX: number, startW: number) => {
    let last = startW;
    const move = (ev: PointerEvent) => {
      last = Math.max(60, Math.min(1200, startW + ev.clientX - startX));
      setDragWidths((d) => ({ ...d, [id]: last }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      void saveColumns(allColumns(configured).map((c) => (c.id === id ? { ...c, width: Math.round(last) } : c)), `Resized the ${COLUMN_LABEL(id)} column`).then(() => setDragWidths({}));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const headerMenu = (e: React.MouseEvent, at?: string) => {
    e.preventDefault();
    const full = allColumns(configured);
    const target = at ? full.find((c) => c.id === at) : undefined;
    const items: MenuItem[] = [
      ...(target && target.id !== 'location' ? [
        { label: target.pinned ? `Unpin ${COLUMN_LABEL(target.id)}` : `Pin ${COLUMN_LABEL(target.id)}`, icon: target.pinned ? 'unpin' : 'pin', run: () => void saveColumns(full.map((x) => (x.id === target.id ? { ...x, pinned: !x.pinned } : x)), target.pinned ? 'Unpinned a column' : 'Pinned a column') },
        ...(target.id !== 'name' ? [
          { label: 'Move left', run: () => void moveCol(target.id, -1) },
          { label: 'Move right', run: () => void moveCol(target.id, 1) },
        ] : []),
        SEP,
      ] : []),
      ...full.filter((c) => c.id !== 'name').map((c) => ({
        label: COLUMN_DEFS[c.id]!.label + (META_COLUMNS.has(c.id) ? ' (read from files)' : c.id === 'checksum' ? ' (when calculated)' : c.id === 'git' ? ' (in Git repositories)' : ''),
        checked: c.visible,
        run: () => void saveColumns(full.map((x) => (x.id === c.id ? { ...x, visible: !x.visible } : x)), `${c.visible ? 'Hid' : 'Showed'} the ${COLUMN_LABEL(c.id)} column`),
      })),
      SEP,
      { label: 'Restore default columns', run: () => void saveColumns(DEFAULT_COLUMNS, 'Default columns') },
      { label: 'Column sets and options…', icon: 'palette', run: () => document.dispatchEvent(new CustomEvent('orbis:open-studio', { detail: { category: 'columns' } })) },
    ];
    menu.open(items, e.clientX, e.clientY);
  };

  const moveCol = (id: string, d: -1 | 1) => {
    const list = allColumns(configured);
    const i = list.findIndex((c) => c.id === id);
    const j = i + d;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    void saveColumns(list, `Moved the ${COLUMN_LABEL(id)} column`);
  };

  const reorder = (dragId: string, targetId: string) => {
    if (dragId === targetId || dragId === 'name') return;
    const list = allColumns(configured);
    const from = list.findIndex((c) => c.id === dragId);
    const [moved] = list.splice(from, 1);
    list.splice(list.findIndex((c) => c.id === targetId), 0, moved!);
    void saveColumns(list, `Moved the ${COLUMN_LABEL(dragId)} column`);
  };

  return (
    <div
      ref={ref}
      className={`fileview listview view-${p.view} ${drop.over && drop.over.startsWith(`${p.dropDir}|`) ? 'is-drop' : ''}`}
      style={minCols ? ({ '--cols-min': `${minCols}px` } as React.CSSProperties) : undefined}
      role="grid"
      aria-label="Files"
      aria-rowcount={items.length}
      aria-multiselectable
      tabIndex={0}
      onScroll={(e) => {
        const t = (e.target as HTMLElement).scrollTop;
        setTop(t);
        p.onScroll(t);
      }}
      onKeyDown={(e) => handleListKeys(e, p, items, 1, pageSize, anchorRef)}
      onFocus={p.onActivate}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('rows')) {
          p.onActivate();
          if (!e.ctrlKey && !e.metaKey && !e.shiftKey) p.onSelect([]);
        }
      }}
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest('.row, .colhead')) return;
        e.preventDefault();
        p.onContext(e);
      }}
      onDragOver={(e) => drop.onDragOver(e)}
      onDragLeave={drop.onDragLeave}
      onDrop={(e) => drop.onDrop(e)}
    >
      {p.view === 'details' && (
        <div className="colheads" role="row" style={{ gridTemplateColumns: template }} onContextMenu={(e) => headerMenu(e, (e.target as HTMLElement).closest<HTMLElement>('[data-col]')?.dataset.col)}>
          {cols.map((c) => {
            const def = COLUMN_DEFS[c.id]!;
            const sorted = def.sortKey && p.sort.key === def.sortKey;
            const thenIdx = def.sortKey ? (p.thenBy ?? []).findIndex((t) => t.key === def.sortKey) : -1;
            const then = thenIdx >= 0 ? p.thenBy![thenIdx]! : undefined;
            return (
              <div
                key={c.id}
                data-col={c.id}
                role="columnheader"
                aria-sort={sorted ? (p.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                style={pinStyle(c)}
                className={`colhead ${def.align === 'right' ? 'right' : ''} ${colDrag === c.id ? 'dragging' : ''} ${c.pinned ? 'is-pinned' : ''}`}
                draggable={c.id !== 'name'}
                onDragStart={(e) => {
                  setColDrag(c.id);
                  e.dataTransfer.setData('application/x-orbis-col', c.id);
                }}
                onDragEnd={() => setColDrag(null)}
                onDragOver={(e) => e.dataTransfer.types.includes('application/x-orbis-col') && e.preventDefault()}
                onDrop={(e) => {
                  const id = e.dataTransfer.getData('application/x-orbis-col');
                  if (id) {
                    e.stopPropagation();
                    reorder(id, c.id);
                  }
                }}
              >
                <button type="button" disabled={!def.sortKey} onClick={() => def.sortKey && p.onSort({ ...p.sort, key: def.sortKey, dir: sorted && p.sort.dir === 'asc' ? 'desc' : 'asc' })}>
                  <span>{def.label}</span>
                  {sorted && <Icon name={p.sort.dir === 'asc' ? 'up' : 'chevronDown'} size={11} />}
                  {then && <span className="sort-rank" title={`Sort key ${thenIdx + 2} (${then.dir === 'asc' ? 'ascending' : 'descending'})`}>{thenIdx + 2}{then.dir === 'asc' ? '↑' : '↓'}</span>}
                </button>
                <span className="col-resizer" onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); resizeCol(c.id, e.clientX, c.width); }} />
              </div>
            );
          })}
        </div>
      )}
      <div className="rows" style={{ height: p.rows.length * rowH, position: 'relative' }}>
        {p.rows.slice(first, last).map((r, k) => {
          const i = first + k;
          const top = i * rowH;
          if (r.type === 'group') {
            return (
              <div key={`g-${r.key}`} className="group-row" style={{ top, height: rowH }} role="row">
                <span>{r.label}</span>
                <span className="muted tabular">{r.count}</span>
              </div>
            );
          }
          const e = r.entry;
          const selected = sel.has(e.path);
          const dirTarget = isDir(e) ? e.path : undefined;
          const dropping = drop.over?.startsWith(`${dirTarget}|`);
          return (
            <div
              key={e.path}
              role="row"
              aria-selected={selected}
              className={`row ${selected ? 'is-selected' : ''} ${p.focus === e.path ? 'is-focused' : ''} ${e.hidden ? 'is-hidden' : ''} ${dropping ? 'is-drop' : ''} ${app.get().clipboard?.mode === 'cut' && app.get().clipboard?.paths.includes(e.path) ? 'is-cut' : ''}`}
              style={{ top, height: rowH, gridTemplateColumns: template }}
              onMouseDown={(ev) => {
                if (ev.button === 0 || ev.button === 2) click(ev, e);
              }}
              onDoubleClick={(ev) => p.onOpen(e, ev.ctrlKey || ev.metaKey ? 'tab' : 'here')}
              onAuxClick={(ev) => ev.button === 1 && isDir(e) && p.onOpen(e, 'tab')}
              onContextMenu={(ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                p.onContext(ev, e);
              }}
              draggable
              onDragStart={(ev) => {
                const paths = selected ? p.selection : [e.path];
                beginDrag(ev, paths);
                if (ev.altKey) {
                  ev.preventDefault();
                  dragOut(paths);
                }
              }}
              onDragEnd={endDrag}
              onDragOver={(ev) => dirTarget && drop.onDragOver(ev, dirTarget, e.name)}
              onDrop={(ev) => dirTarget && drop.onDrop(ev, dirTarget)}
              title={dropping ? drop.over!.split('|')[1] : undefined}
            >
              {cols.map((c) => (
                <div key={c.id} role="gridcell" style={pinStyle(c)} className={`cell cell-${c.id} ${COLUMN_DEFS[c.id]?.align === 'right' ? 'right' : ''} ${c.pinned && p.view === 'details' ? 'is-pinned' : ''}`}>
                  {c.id === 'name' ? (
                    <>
                      <FileIcon entry={e} size={p.view === 'compact' ? 14 : 16} />
                      <span className="name" title={e.name}>{e.name}</span>
                      <GitMark badge={gitBadgeFor(p.git, e.name)} />
                      {e.textMatch && <TextMatch m={e.textMatch} />}
                      {p.view !== 'details' && p.tags?.[e.path]?.length ? <TagDots tags={p.tags[e.path]!} /> : null}
                    </>
                  ) : c.id === 'modified' ? <span className="tabular">{formatDate(e.modifiedMs)}</span>
                    : c.id === 'created' ? <span className="tabular">{formatDate(e.createdMs)}</span>
                    : c.id === 'type' ? <span>{kindLabel(e)}</span>
                    : c.id === 'size' ? (isDir(e) ? <FolderSizeValue path={e.path} state={p.folderSizes} /> : <span className="tabular">{formatBytes(e.size)}</span>)
                    : c.id === 'ext' ? <span className="mono">{e.ext}</span>
                    : c.id === 'location' ? <span className="mono muted" title={e.path}>{e.path.slice(0, e.path.length - e.name.length - 1)}</span>
                    : c.id === 'tags' ? <TagDots tags={p.tags?.[e.path] ?? []} labels />
                    : c.id === 'accessed' ? <span className="tabular">{formatDate(e.accessedMs)}</span>
                    : c.id === 'attributes' ? <span className="mono" title={e.mode !== undefined ? `Mode ${(e.mode & 0o7777).toString(8)}` : undefined}>{attributesLabel(e)}</span>
                    : c.id === 'owner' ? <span className="muted">{e.uid === undefined ? '—' : p.owners?.[e.uid] ?? e.uid}</span>
                    : c.id === 'dimensions' ? <span className="tabular">{dimensionsLabel(p.meta?.[e.path])}</span>
                    : c.id === 'duration' ? <span className="tabular">{p.meta?.[e.path]?.durationSec !== undefined ? formatMediaDuration(p.meta[e.path]!.durationSec) : ''}</span>
                    : c.id === 'taken' ? <span className="tabular">{p.meta?.[e.path]?.takenAt ?? ''}</span>
                    : c.id === 'volume' ? <VolumeCell path={e.path} volumes={volumes} />
                    : c.id === 'checksum' ? <ChecksumCell entry={e} sums={sums} />
                    : c.id === 'git' ? <GitCell state={p.git} badge={gitBadgeFor(p.git, e.name)} /> : null}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      {menu.node}
    </div>
  );
}

/** How a Git badge is described (tooltip, screen readers, the Git column). */
export function gitBadgeText(b: GitBadge): string {
  if (b.inside) return `Contains ${GIT_CODE_LABEL[b.code].toLowerCase()} items`;
  return `${GIT_CODE_LABEL[b.code]}${b.staged ? ' (staged)' : ''}${b.from ? ` from ${b.from}` : ''}`;
}

/** Git badge after a name: a letter (M, A, U, R, D, !, I), or a dot for a folder that contains changes. */
export function GitMark({ badge }: { badge?: GitBadge }) {
  if (!badge) return null;
  const text = gitBadgeText(badge);
  return (
    <span className={`git-mark git-${badge.code} ${badge.inside ? 'is-inside' : ''}`} title={`Git: ${text}`}>
      <span aria-hidden="true">{badge.inside ? '' : GIT_CODE_LETTER[badge.code]}</span>
      <span className="sr-only">, Git: {text}</span>
    </span>
  );
}

function GitCell({ state, badge }: { state?: GitFolder; badge?: GitBadge }) {
  if (!state || state.state === 'none' || state.state === 'off') return null;
  if (state.state === 'unavailable') return <span className="muted small" title={state.reason}>Git not found</span>;
  if (state.state === 'error') return <span className="muted small" title={state.message}>—</span>;
  if (!badge) return <span className="muted small">{state.truncated ? '' : 'Unchanged'}</span>;
  return <span className={`git-text git-${badge.code}`}>{gitBadgeText(badge)}</span>;
}

/** A calculated folder size in the Size column, marked as calculated (and "≥" when partial). */
function FolderSizeValue({ path, state }: { path: string; state?: FolderSizesState }) {
  const cell = folderSizeCell(state?.sizes[path], { active: !!state, running: !!state?.running, current: state?.current === path });
  if (!cell) return null;
  return <span className={`tabular folder-size ${cell.partial ? 'is-partial' : ''} ${cell.pending ? 'muted' : ''}`} title={cell.title}>{cell.text}</span>;
}

function VolumeCell({ path, volumes }: { path: string; volumes: Volume[] }) {
  const v = volumeOf(path, volumes);
  if (!v) return <span className="muted" title="Volume information is not available for this location.">—</span>;
  return <span className="ellipsis" title={`${v.label} · ${v.mountPath}${v.fsType ? ` · ${v.fsType}` : ''}`}>{v.label}</span>;
}

function ChecksumCell({ entry, sums }: { entry: FileEntry; sums: ReturnType<typeof checksums.get>['byPath'] }) {
  if (entry.kind !== 'file') return <span className="muted">—</span>;
  const r = checksumFor(entry, sums);
  if (!r) return <span className="muted small" title="Right-click → Calculate checksum, or compute it in the details panel.">Not calculated</span>;
  return <span className="mono" title={`${r.algorithm.toUpperCase()} ${r.digest}`}>{r.algorithm === 'sha256' ? '' : `${r.algorithm} `}{r.digest.slice(0, 16)}…</span>;
}

function attributesLabel(e: FileEntry): string {
  if (e.mode === undefined) return '—';
  if (e.uid === undefined) return e.readOnly ? 'Read-only' : 'Writable';
  return permissionString(e.mode, e.kind);
}

function dimensionsLabel(m?: MediaSummary): string {
  if (!m) return '';
  if (m.width && m.height) return `${m.width} × ${m.height}`;
  if (m.pages) return `${m.pages} page${m.pages === 1 ? '' : 's'}`;
  return '';
}

function TagDots({ tags, labels }: { tags: Array<{ id: string; name: string; color: string | null }>; labels?: boolean }) {
  if (!tags.length) return null;
  return (
    <span className="tag-dots" title={tags.map((t) => t.name).join(', ')}>
      {tags.slice(0, labels ? 3 : 4).map((t) =>
        labels ? <span key={t.id} className="tag-chip"><i style={{ background: t.color ?? 'var(--accent)' }} /><span className="ellipsis">{t.name}</span></span> : <i key={t.id} style={{ background: t.color ?? 'var(--accent)' }} />,
      )}
    </span>
  );
}

/* ---------------------------------------------------------------- grid / gallery */

/**
 * The thumbnail a tile shows, if any: images and videos everywhere, PDF first pages, SVG and font
 * samples in every grid view, the first lines of text files in large thumbnails and the gallery.
 * Files over the size limit of their kind keep the file icon.
 */
export function tileThumbKind(e: FileEntry, view: string): ThumbKind | undefined {
  if (e.kind !== 'file') return undefined;
  const kind = thumbKindForExt(e.ext);
  if (!kind) return undefined;
  if (kind === 'text' && view !== 'thumbnails' && view !== 'gallery') return undefined;
  const limit = THUMB_SOURCE_LIMITS[kind];
  if (limit !== undefined && (e.size ?? 0) > limit) return undefined;
  return kind;
}

export function thumbUrl(path: string, size: number): string {
  return `orbis-thumb://t/${encodeURIComponent(path)}?s=${size}`;
}

export function GridView(p: ViewProps) {
  const ref = useRef<HTMLDivElement>(null);
  const items = useMemo(() => p.rows.filter((r): r is Extract<Row, { type: 'item' }> => r.type === 'item').map((r) => r.entry), [p.rows]);
  const sizes = useCustom((r) => ({ icon: r.appearance.iconSize, thumb: r.appearance.thumbnailSize }));
  const iconSize = sizes.icon;
  // Large thumbnails use the thumbnail size; the icon grid uses the icon size; the gallery sits between.
  const cell = p.view === 'thumbnails' ? sizes.thumb + 16 : p.view === 'gallery' ? Math.max(160, iconSize + 90) : Math.max(96, iconSize + 32);
  const cellH = p.view === 'gallery' ? cell + 10 : cell + 26;
  const [vp, setTop] = useViewport(ref, p.scrollTop);
  const cols = Math.max(1, Math.floor((vp.width - 16) / cell));
  const rowsCount = Math.ceil(items.length / cols);
  const sel = useMemo(() => new Set(p.selection), [p.selection]);
  const { click, anchorRef } = useSelectionHandlers(p, items);
  const drop = useDropTarget(p.dropDir);
  const focusIndex = p.focus ? items.findIndex((x) => x.path === p.focus) : -1;
  useScrollIntoView(ref, focusIndex < 0 ? -1 : Math.floor(focusIndex / cols), (r) => 8 + r * cellH, cellH);
  const firstRow = Math.max(0, Math.floor(vp.top / cellH) - 3);
  const lastRow = Math.min(rowsCount, Math.ceil((vp.top + vp.height) / cellH) + 3);
  const thumb = p.view === 'thumbnails' ? Math.min(512, sizes.thumb * 2) : p.view === 'gallery' ? Math.min(512, cell * 2) : Math.min(256, iconSize * 2);

  return (
    <div
      ref={ref}
      className={`fileview gridview view-${p.view}`}
      role="listbox"
      aria-label="Files"
      aria-multiselectable
      tabIndex={0}
      onScroll={(e) => {
        const t = (e.target as HTMLElement).scrollTop;
        setTop(t);
        p.onScroll(t);
      }}
      onFocus={p.onActivate}
      onKeyDown={(e) => handleListKeys(e, p, items, cols, Math.max(1, Math.floor(vp.height / cellH)), anchorRef)}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('grid-canvas')) {
          p.onActivate();
          if (!e.ctrlKey && !e.metaKey && !e.shiftKey) p.onSelect([]);
        }
      }}
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest('.tile')) return;
        e.preventDefault();
        p.onContext(e);
      }}
      onDragOver={(e) => drop.onDragOver(e)}
      onDragLeave={drop.onDragLeave}
      onDrop={(e) => drop.onDrop(e)}
    >
      <div className="grid-canvas" style={{ height: rowsCount * cellH + 16, position: 'relative' }}>
        {Array.from({ length: Math.max(0, lastRow - firstRow) }, (_, k) => firstRow + k).flatMap((r) =>
          items.slice(r * cols, r * cols + cols).map((e, c) => {
            const selected = sel.has(e.path);
            const dirTarget = isDir(e) ? e.path : undefined;
            return (
              <div
                key={e.path}
                role="option"
                aria-selected={selected}
                className={`tile ${selected ? 'is-selected' : ''} ${p.focus === e.path ? 'is-focused' : ''} ${drop.over?.startsWith(`${dirTarget}|`) ? 'is-drop' : ''}`}
                style={{ left: 8 + c * cell, top: 8 + r * cellH, width: cell - 8, height: cellH - 8 }}
                title={e.name}
                onMouseDown={(ev) => (ev.button === 0 || ev.button === 2) && click(ev, e)}
                onDoubleClick={(ev) => p.onOpen(e, ev.ctrlKey || ev.metaKey ? 'tab' : 'here')}
                onContextMenu={(ev) => {
                  ev.preventDefault();
                  ev.stopPropagation();
                  p.onContext(ev, e);
                }}
                draggable
                onDragStart={(ev) => beginDrag(ev, selected ? p.selection : [e.path])}
                onDragEnd={endDrag}
                onDragOver={(ev) => dirTarget && drop.onDragOver(ev, dirTarget, e.name)}
                onDrop={(ev) => dirTarget && drop.onDrop(ev, dirTarget)}
              >
                <div className="tile-visual">
                  {tileThumbKind(e, p.view) && !p.onlyColumns ? <Thumb path={e.path} size={thumb} entry={e} kind={tileThumbKind(e, p.view)} /> : <FileIcon entry={e} size={p.view === 'gallery' ? 56 : p.view === 'thumbnails' ? Math.round(Math.min(128, sizes.thumb * 0.4)) : Math.round(iconSize * 0.55)} />}
                </div>
                <div className="tile-name">{e.name}</div>
                {e.textMatch && <TextMatch m={e.textMatch} compact />}
              </div>
            );
          }),
        )}
      </div>
    </div>
  );
}

export function Thumb({ path, size, entry, kind = thumbKindForExt(entry.ext) ?? 'image' }: { path: string; size: number; entry: FileEntry; kind?: ThumbKind }) {
  const video = kind === 'video';
  const [state, setState] = useState<'try' | 'generating' | 'retry' | 'failed'>('try');
  // A new file, version or size (another view) starts over: the cache is keyed by size.
  useEffect(() => setState('try'), [path, entry.modifiedMs, size, kind]);
  if (state === 'failed' || state === 'generating') return <span className="thumb-fallback"><FileIcon entry={entry} size={40} />{state === 'generating' && <span className="sr-only">Creating preview</span>}</span>;
  const doc = kind === 'pdf' || kind === 'text' || kind === 'font' || kind === 'svg';
  return (
    <span className={`thumb-wrap thumb-${kind}${doc ? ' thumb-doc' : ''}`}>
      <img
        src={`${thumbUrl(path, size)}&m=${entry.modifiedMs ?? 0}${state === 'retry' ? '&r=1' : ''}`}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => {
          if (state === 'retry') return setState('failed');
          // No cached thumbnail and the main process does not draw this kind (video, PDF, SVG, font, text, WebP, GIF…):
          // draw it in this window, store it, then load it from the cache.
          setState('generating');
          void ensureRendererThumb(path, Math.min(512, Math.max(32, size)), kind).then((ok) => setState(ok ? 'retry' : 'failed'));
        }}
      />
      {video && <span className="thumb-badge" aria-hidden><Icon name="play" size={12} /></span>}
    </span>
  );
}

/* ---------------------------------------------------------------- columns (Miller) */

export function ColumnsView({ dir, selection, onSelect, onOpen, onContext, onNavigate, onActivate }: {
  dir: string; selection: string[]; onSelect: (paths: string[], anchor?: string, focus?: string) => void; onOpen: (e: FileEntry) => void;
  onContext: (e: React.MouseEvent, entry?: FileEntry) => void; onNavigate: (dir: string, select?: string) => void; onActivate: () => void;
}) {
  // Show the current folder and up to two ancestors, plus the selected child folder.
  const chain = useMemo(() => {
    const out: string[] = [dir];
    let cur = dir;
    for (let i = 0; i < 2; i++) {
      const sep = cur.includes('\\') ? '\\' : '/';
      const idx = cur.replace(/[\\/]+$/, '').lastIndexOf(sep);
      if (idx < 0 || cur === sep) break;
      cur = idx === 0 ? sep : cur.slice(0, idx);
      out.unshift(cur);
      if (cur === sep) break;
    }
    return out;
  }, [dir]);
  const showHidden = useStore(app, (s) => s.settings.showHidden);
  const [data, setData] = useState<Record<string, FileEntry[] | { error: string }>>({});
  const selectedChild = selection.length === 1 ? selection[0] : undefined;

  useEffect(() => {
    let cancelled = false;
    const dirs = [...chain];
    void (async () => {
      for (const d of dirs) {
        if (data[d]) continue;
        try {
          const r = await startListing(d, showHidden).done;
          if (!cancelled) setData((x) => ({ ...x, [d]: r.error ? { error: r.error.message } : sortEntries(r.entries, { key: 'name', dir: 'asc', foldersFirst: true }) }));
        } catch (err) {
          if (!cancelled) setData((x) => ({ ...x, [d]: { error: (err as Error).message } }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain.join('|'), showHidden]);

  // Keep the newest column (and the preview of the selection) in view, as Miller columns do.
  const ref = useRef<HTMLDivElement>(null);
  const revealEnd = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // As far right as possible, but never past the start of the current folder's column (narrow panes).
    const cur = el.querySelector<HTMLElement>('.mcolumn.is-current');
    const max = el.scrollWidth - el.clientWidth;
    el.scrollLeft = cur ? Math.min(max, cur.offsetLeft) : max;
  }, []);
  useLayoutEffect(revealEnd, [chain, data, selectedChild, revealEnd]);

  // Keyboard: the current folder's column is the one Tab stop. Up/Down/Home/End select, Right opens the
  // selected folder, Left goes back to the parent column (Enter and Backspace work through their commands).
  const uid = useId();
  const optionId = (ci: number, i: number) => `${uid}-c${ci}-o${i}`;
  const currentCol = () => ref.current?.querySelector<HTMLElement>('.mcolumn.is-current') ?? null;
  useEffect(() => {
    // Focus follows the current column when the folder changes from the keyboard.
    if (ref.current?.contains(document.activeElement)) currentCol()?.focus({ preventScroll: true });
  }, [dir]);
  useEffect(() => {
    currentCol()?.querySelector<HTMLElement>('.mrow.is-selected')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selectedChild, data]);
  const onColumnKey = (e: React.KeyboardEvent, list: FileEntry[]) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const idx = list.findIndex((x) => x.path === selectedChild);
    const pick = (i: number) => {
      const t = list[Math.max(0, Math.min(list.length - 1, i))];
      if (!t) return;
      e.preventDefault();
      onSelect([t.path], t.path, t.path);
    };
    const parent = chain[chain.indexOf(dir) - 1];
    if (e.key === 'ArrowDown') pick(idx < 0 ? 0 : idx + 1);
    else if (e.key === 'ArrowUp') pick(idx < 0 ? 0 : idx - 1);
    else if (e.key === 'Home') pick(0);
    else if (e.key === 'End') pick(list.length - 1);
    else if (e.key === 'ArrowRight' && idx >= 0 && isDir(list[idx]!)) {
      e.preventDefault();
      onNavigate(list[idx]!.path);
    } else if (e.key === 'ArrowLeft' && parent) {
      e.preventDefault();
      onNavigate(parent, dir);
    }
  };

  return (
    <div className="columnsview" ref={ref} onMouseDown={onActivate}>
      {chain.map((d, ci) => {
        const list = data[d];
        const next = chain[ci + 1];
        const current = d === dir;
        const items = Array.isArray(list) ? list : [];
        const active = current ? items.findIndex((x) => x.path === selectedChild) : -1;
        return (
          <div
            key={d}
            className={`mcolumn ${current ? 'is-current' : ''}`}
            role="listbox"
            aria-label={d}
            tabIndex={current ? 0 : -1}
            aria-activedescendant={active >= 0 ? optionId(ci, active) : undefined}
            onKeyDown={current && items.length ? (e) => onColumnKey(e, items) : undefined}
            onContextMenu={(e) => { e.preventDefault(); if (d === dir) onContext(e); }}
          >
            {!list ? <div className="muted pad">Loading…</div> : 'error' in list ? <div className="pad error-text">{list.error}</div> : list.length === 0 ? <div className="muted pad">Empty folder</div> : list.map((e, i) => {
              const inChain = e.path === next;
              const selected = d === dir ? selection.includes(e.path) : inChain;
              return (
                <div
                  key={e.path}
                  id={optionId(ci, i)}
                  role="option"
                  aria-selected={selected}
                  className={`mrow ${selected ? 'is-selected' : ''} ${inChain ? 'in-chain' : ''}`}
                  onClick={() => (d === dir ? onSelect([e.path], e.path, e.path) : isDir(e) ? onNavigate(e.path) : onNavigate(d, e.path))}
                  onDoubleClick={() => (isDir(e) ? onNavigate(e.path) : onOpen(e))}
                  onContextMenu={(ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    if (d === dir) {
                      onSelect([e.path], e.path, e.path);
                      onContext(ev, e);
                    }
                  }}
                  draggable
                  onDragStart={(ev) => beginDrag(ev, [e.path])}
                  onDragEnd={endDrag}
                >
                  <FileIcon entry={e} size={15} />
                  <span className="name">{e.name}</span>
                  {isDir(e) && <Icon name="chevronRight" size={12} className="muted" />}
                </div>
              );
            })}
          </div>
        );
      })}
      {selectedChild && <ColumnPreviewHint path={selectedChild} onNavigate={onNavigate} onShown={revealEnd} />}
    </div>
  );
}

function ColumnPreviewHint({ path, onNavigate, onShown }: { path: string; onNavigate: (dir: string) => void; onShown: () => void }) {
  const [entry, setEntry] = useState<FileEntry | null>(null);
  useEffect(() => {
    void call<FileEntry>('fs:stat', { path }).then(setEntry, () => setEntry(null));
  }, [path]);
  useLayoutEffect(() => {
    if (entry) onShown();
  }, [entry, onShown]);
  if (!entry) return null;
  return (
    <div className="mcolumn mcolumn-hint">
      <FileIcon entry={entry} size={40} />
      <div className="name">{entry.name}</div>
      <div className="muted">{kindLabel(entry)}</div>
      {isDir(entry) ? <button type="button" className="btn btn-default btn-sm" onClick={() => onNavigate(entry.path)}>Open folder</button> : <div className="muted tabular">{formatBytes(entry.size)}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------- tree */

/** List a folder once (not watched); used by the tree and columns views. */
export async function listDirOnce(dir: string, showHidden: boolean): Promise<FileEntry[]> {
  const r = await startListing(dir, showHidden).done;
  if (r.error) throw new Error(r.error.message);
  return r.entries;
}

type TreeChildren = FileEntry[] | 'loading' | { error: string };
type TreeRow = { kind: 'entry'; entry: FileEntry; depth: number } | { kind: 'note'; key: string; text: string; depth: number; error?: boolean };

const treeExpansion = new Map<string, Set<string>>();

export function TreeView(p: ViewProps & { paneId: string; root: string; onExtraEntries: (entries: FileEntry[]) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const showHidden = useStore(app, (s) => s.settings.showHidden);
  const nav = useCustom((r) => ({ density: r.navigation.density, indent: r.navigation.indent, expand: r.navigation.treeExpand, details: r.navigation.indicators.treeDetails, tagDots: r.navigation.indicators.tagDots, minTarget: r.accessibility.minTarget }));
  // Navigation density and indentation come from Customization → Navigation.
  const rowH = Math.max(nav.density === 'compact' ? 24 : nav.density === 'spacious' ? 34 : 28, nav.minTarget);
  // Expansion: remembered per pane, always start collapsed, or open the first level.
  const [expanded, setExpanded] = useState<Set<string>>(() => (nav.expand === 'remember' ? treeExpansion.get(p.paneId) ?? new Set() : new Set()));
  const [children, setChildren] = useState<Record<string, TreeChildren>>({});
  const rootItems = useMemo(() => p.rows.filter((r): r is Extract<Row, { type: 'item' }> => r.type === 'item').map((r) => r.entry), [p.rows]);

  useEffect(() => {
    if (nav.expand === 'remember') treeExpansion.set(p.paneId, expanded);
  }, [p.paneId, expanded, nav.expand]);
  // "First level": open the folders directly inside the root (bounded so a huge folder stays fast).
  const firstLevelDone = useRef(false);
  useEffect(() => {
    if (nav.expand !== 'first-level' || firstLevelDone.current || !rootItems.length) return;
    firstLevelDone.current = true;
    const dirs = rootItems.filter((e) => isDir(e) && e.kind !== 'symlink').slice(0, 40);
    setExpanded(new Set(dirs.map((d) => d.path)));
    for (const d of dirs) load(d.path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav.expand, rootItems]);

  const load = useCallback((dir: string) => {
    setChildren((c) => ({ ...c, [dir]: 'loading' }));
    listDirOnce(dir, showHidden).then(
      (entries) => setChildren((c) => ({ ...c, [dir]: sortEntries(entries, p.sort, { tags: p.tags, meta: p.meta }, p.thenBy) })),
      (err: Error) => setChildren((c) => ({ ...c, [dir]: { error: err.message } })),
    );
  }, [showHidden, p.sort, p.thenBy, p.tags, p.meta]);

  // Reload expanded folders whenever the root listing refreshes (files changed) or options change.
  useEffect(() => {
    setChildren({});
    for (const d of expanded) load(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.rows, showHidden, p.sort]);

  const toggle = (dir: string, open?: boolean) => {
    const willOpen = open ?? !expanded.has(dir);
    const sep = dir.includes('\\') && !dir.startsWith('/') ? '\\' : '/';
    const prefix = dir.endsWith(sep) ? dir : dir + sep;
    setExpanded((prev) => {
      const next = new Set(prev);
      if (willOpen) next.add(dir);
      // Collapsing also collapses everything below it.
      else for (const d of [...next]) if (d === dir || d.startsWith(prefix)) next.delete(d);
      return next;
    });
    if (willOpen) {
      const c = children[dir];
      if (!c || (typeof c === 'object' && !Array.isArray(c))) load(dir);
    }
  };

  const flat = useMemo(() => {
    const out: TreeRow[] = [];
    const walk = (list: FileEntry[], depth: number) => {
      for (const e of list) {
        out.push({ kind: 'entry', entry: e, depth });
        if (isDir(e) && e.kind !== 'symlink' && expanded.has(e.path)) {
          const c = children[e.path];
          if (!c || c === 'loading') out.push({ kind: 'note', key: `${e.path}#loading`, text: 'Loading…', depth: depth + 1 });
          else if ('error' in c) out.push({ kind: 'note', key: `${e.path}#error`, text: c.error, depth: depth + 1, error: true });
          else if (!c.length) out.push({ kind: 'note', key: `${e.path}#empty`, text: 'Empty folder', depth: depth + 1 });
          else walk(c, depth + 1);
        }
      }
    };
    walk(rootItems, 0);
    return out;
  }, [rootItems, children, expanded]);

  const items = useMemo(() => flat.filter((r): r is Extract<TreeRow, { kind: 'entry' }> => r.kind === 'entry').map((r) => r.entry), [flat]);
  useEffect(() => {
    p.onExtraEntries(items.filter((e) => !rootItems.includes(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const [vp, setTop] = useViewport(ref, p.scrollTop);
  const sel = useMemo(() => new Set(p.selection), [p.selection]);
  const { click, anchorRef } = useSelectionHandlers(p, items);
  const drop = useDropTarget(p.dropDir);
  const focusIndex = p.focus ? flat.findIndex((r) => r.kind === 'entry' && r.entry.path === p.focus) : -1;
  useScrollIntoView(ref, focusIndex, (i) => i * rowH, rowH);
  const first = Math.max(0, Math.floor(vp.top / rowH) - 10);
  const last = Math.min(flat.length, Math.ceil((vp.top + vp.height) / rowH) + 10);
  const depthOf = (path: string) => (flat.find((r) => r.kind === 'entry' && r.entry.path === path) as { depth: number } | undefined)?.depth ?? 0;

  const onKey = (e: React.KeyboardEvent) => {
    const cur = p.focus ? items.find((x) => x.path === p.focus) : undefined;
    if (cur && (e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const idx = items.indexOf(cur);
      if (e.key === 'ArrowRight') {
        if (isDir(cur) && cur.kind !== 'symlink' && !expanded.has(cur.path)) toggle(cur.path, true);
        else if (expanded.has(cur.path) && items[idx + 1] && depthOf(items[idx + 1]!.path) > depthOf(cur.path)) {
          const next = items[idx + 1]!;
          anchorRef.current = next.path;
          p.onSelect([next.path], next.path, next.path);
        }
      } else if (expanded.has(cur.path)) toggle(cur.path, false);
      else {
        const d = depthOf(cur.path);
        for (let i = idx - 1; i >= 0; i--) {
          if (depthOf(items[i]!.path) < d) {
            anchorRef.current = items[i]!.path;
            p.onSelect([items[i]!.path], items[i]!.path, items[i]!.path);
            break;
          }
        }
      }
      return;
    }
    handleListKeys(e, p, items, 1, Math.max(1, Math.floor(vp.height / rowH) - 1), anchorRef);
  };

  return (
    <div
      ref={ref}
      className="fileview treeview"
      role="tree"
      aria-label="Files"
      aria-multiselectable
      tabIndex={0}
      onScroll={(e) => {
        const t = (e.target as HTMLElement).scrollTop;
        setTop(t);
        p.onScroll(t);
      }}
      onKeyDown={onKey}
      onFocus={p.onActivate}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('rows')) {
          p.onActivate();
          if (!e.ctrlKey && !e.metaKey && !e.shiftKey) p.onSelect([]);
        }
      }}
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest('.row')) return;
        e.preventDefault();
        p.onContext(e);
      }}
      onDragOver={(e) => drop.onDragOver(e)}
      onDragLeave={drop.onDragLeave}
      onDrop={(e) => drop.onDrop(e)}
    >
      <div className="rows" style={{ height: flat.length * rowH, position: 'relative' }}>
        {flat.slice(first, last).map((r, k) => {
          const top = (first + k) * rowH;
          if (r.kind === 'note') {
            return <div key={r.key} className={`row tree-note ${r.error ? 'error-text' : 'muted'}`} style={{ top, height: rowH, paddingLeft: 12 + r.depth * nav.indent + 18 }} role="treeitem" aria-level={r.depth + 1}>{r.text}</div>;
          }
          const e = r.entry;
          const selected = sel.has(e.path);
          const folder = isDir(e) && e.kind !== 'symlink';
          const open = folder && expanded.has(e.path);
          const dropping = folder && drop.over?.startsWith(`${e.path}|`);
          return (
            <div
              key={e.path}
              role="treeitem"
              aria-level={r.depth + 1}
              aria-expanded={folder ? open : undefined}
              aria-selected={selected}
              className={`row tree-row ${selected ? 'is-selected' : ''} ${p.focus === e.path ? 'is-focused' : ''} ${e.hidden ? 'is-hidden' : ''} ${dropping ? 'is-drop' : ''}`}
              style={{ top, height: rowH, paddingLeft: 8 + r.depth * nav.indent }}
              onMouseDown={(ev) => (ev.button === 0 || ev.button === 2) && !(ev.target as HTMLElement).closest('.tree-twisty') && click(ev, e)}
              onDoubleClick={(ev) => (folder && !ev.ctrlKey && !ev.metaKey ? toggle(e.path) : p.onOpen(e, ev.ctrlKey || ev.metaKey ? 'tab' : 'here'))}
              onContextMenu={(ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                p.onContext(ev, e);
              }}
              draggable
              onDragStart={(ev) => beginDrag(ev, selected ? p.selection : [e.path])}
              onDragEnd={endDrag}
              onDragOver={(ev) => folder && drop.onDragOver(ev, e.path, e.name)}
              onDrop={(ev) => folder && drop.onDrop(ev, e.path)}
              title={dropping ? drop.over!.split('|')[1] : e.path}
            >
              <button
                type="button"
                className="tree-twisty"
                tabIndex={-1}
                aria-label={folder ? (open ? `Collapse ${e.name}` : `Expand ${e.name}`) : undefined}
                style={{ visibility: folder ? 'visible' : 'hidden' }}
                onClick={() => folder && toggle(e.path)}
              >
                <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
              </button>
              <FileIcon entry={e} size={16} />
              <span className="name">{e.name}</span>
              {nav.tagDots && p.tags?.[e.path]?.length ? <TagDots tags={p.tags[e.path]!} /> : null}
              {nav.details && <span className="tree-meta muted tabular">{folder ? '' : formatBytes(e.size)}</span>}
              {nav.details && <span className="tree-meta muted tabular">{formatDate(e.modifiedMs)}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
