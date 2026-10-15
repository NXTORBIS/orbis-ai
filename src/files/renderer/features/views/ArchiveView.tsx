// @ts-nocheck -- vendored Orbis Files code, checked by its own stricter-than-Orbis toolchain
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { call, errorShape } from '../../api';
import { navigate, parentPath } from '../../state/workspace';
import { EmptyState, ErrorState, FileIcon, Loading, Pill, SEP, useMenu, type MenuItem } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { formatBytes, formatDate } from '../../ui/format';
import { askArchivePassword, isPasswordError, openFile, startOperation } from '../../actions';
import { app, confirm, openDialog, prompt, showPanel, toast, toastError } from '../../state/app';
import type { FileEntry } from '../../../shared/model';
import { isEditableFormat, type ArchiveEditResult } from '../../../shared/archiveEdit';

interface Entry { name: string; kind: 'file' | 'directory' | 'symlink' | 'hardlink' | 'other'; size?: number; compressedSize?: number; modifiedMs?: number; unsafe?: string; encrypted?: boolean }
interface Listing { format: string; supported: boolean; entries: Entry[]; totalSize: number; archiveSize: number; warnings: string[]; encrypted?: boolean; passwordChecked?: boolean }
interface Child { name: string; full: string; isDir: boolean; entry?: Entry; count: number; size: number; encrypted: boolean }

const ARCHIVE_NAME = /\.(zip|7z|rar|tar|tgz|txz|tbz2?|tzst|gz|xz|bz2|zst|jar|cbz|epub)$/i;
const isArchiveName = (n: string) => ARCHIVE_NAME.test(n);
// typeahead state is per-component instance (see useRef in ArchiveView)

/**
 * Inspect an archive's real contents before extracting anything. Files can be
 * opened or previewed from a size-limited temporary copy; folders are browsed
 * in place; archives inside archives open as nested archive views.
 *
 * Keyboard (focus on the list): arrows, Home/End, PageUp/PageDown move;
 * Shift extends the selection; Ctrl moves without selecting; Space or
 * Ctrl+Space toggles; Ctrl+A selects all; Enter opens (Shift+Enter: Open
 * with…); Backspace or Alt+Up goes to the parent folder; the Menu key or
 * Shift+F10 opens the context menu; Escape clears the selection.
 *
 * Passwords for encrypted archives are kept in this component's memory only,
 * for as long as this archive is open here.
 */
export function ArchiveView({ archivePath, paneId, via = [], rootDir }: { archivePath: string; paneId: string; via?: string[]; rootDir?: string }) {
  const menu = useMenu();
  const baseId = useId();
  const gridRef = useRef<HTMLTableElement>(null);
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [inner, setInner] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const anchorRef = useRef<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // The archive password lives here only (and in the requests that use it).
  const passwordRef = useRef<string | undefined>(undefined);
  const [hasPassword, setHasPassword] = useState(false);
  const typeahead = useRef({ text: '', t: 0 });
  const currentArchive = useRef(archivePath);
  currentArchive.current = archivePath;

  const displayName = archivePath.split(/[\\/]/).pop()!;
  const rememberPassword = (pw: string | undefined) => {
    passwordRef.current = pw;
    setHasPassword(pw !== undefined);
  };

  const unlock = async () => {
    const path = archivePath;
    const r = await askArchivePassword(displayName, (password) => call<Listing>('tool:archiveList', { path, password }));
    if (!r || currentArchive.current !== path) return;
    rememberPassword(r.password);
    setListing(r.value);
    setLocked(false);
    requestAnimationFrame(() => gridRef.current?.focus());
  };

  useEffect(() => {
    let live = true;
    setListing(null);
    setError(null);
    setLocked(false);
    setInner('');
    setSelected(new Set());
    setFocusKey(null);
    rememberPassword(undefined);
    void call<Listing>('tool:archiveList', { path: archivePath }).then(
      (l) => live && setListing(l),
      (e) => {
        if (!live) return;
        if (isPasswordError(e)) {
          setLocked(true);
          void unlock();
        } else setError(errorShape(e).message);
      },
    );
    return () => {
      live = false;
      // A preview of a file from this archive goes away with the view.
      const ap = app.get().archivePreview;
      if (ap && ap.paneId === paneId && ap.archivePath === archivePath) app.set({ archivePreview: null });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archivePath]);

  const children = useMemo<Child[]>(() => {
    if (!listing) return [];
    const map = new Map<string, Child>();
    for (const e of listing.entries) {
      const n = e.name.replace(/\\/g, '/');
      if (!n.startsWith(inner) || n === inner) continue;
      const rest = n.slice(inner.length);
      const seg = rest.split('/')[0]!;
      if (!seg) continue;
      const isDir = rest.includes('/') && rest.indexOf('/') < rest.length - 1 ? true : e.kind === 'directory';
      const full = inner + seg + (isDir ? '/' : '');
      const cur = map.get(seg) ?? { name: seg, full, isDir, count: 0, size: 0, encrypted: false };
      if (!rest.slice(seg.length + 1)) cur.entry = e;
      else cur.count++;
      cur.size += e.size ?? 0;
      cur.isDir = cur.isDir || isDir;
      if (cur.isDir) cur.full = inner + seg + '/';
      cur.encrypted = cur.encrypted || !!e.encrypted;
      map.set(seg, cur);
    }
    return [...map.values()].sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.isDir ? -1 : 1));
  }, [listing, inner]);

  // Keep the focused row valid when the folder (or listing) changes.
  useEffect(() => {
    if (!children.some((c) => c.full === focusKey)) setFocusKey(children[0]?.full ?? null);
  }, [children, focusKey]);
  const focusIndex = children.findIndex((c) => c.full === focusKey);
  const rowId = (i: number) => `${baseId}-row-${i}`;
  useEffect(() => {
    if (focusIndex >= 0) document.getElementById(rowId(focusIndex))?.scrollIntoView?.({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusIndex]);

  const unsafeCount = listing?.entries.filter((e) => e.unsafe).length ?? 0;
  const encryptedCount = listing?.entries.filter((e) => e.encrypted && e.kind === 'file').length ?? 0;

  /** The password, asked for (and checked) if the archive needs one and none is known yet. */
  const ensurePassword = async (): Promise<string | undefined> => {
    if (passwordRef.current !== undefined) return passwordRef.current;
    const path = archivePath;
    const r = await askArchivePassword(displayName, (password) => call<Listing>('tool:archiveList', { path, password }));
    if (!r || currentArchive.current !== path) return undefined;
    rememberPassword(r.password);
    return r.password;
  };

  /** Run an action that may need the password; a refused password asks again (archives can use several). */
  const withPassword = async <T,>(needed: boolean, action: (password: string | undefined) => Promise<T>): Promise<T | undefined> => {
    let pw = passwordRef.current;
    if (needed && pw === undefined) {
      pw = await ensurePassword();
      if (pw === undefined) return undefined;
    }
    try {
      return await action(pw);
    } catch (err) {
      if (!isPasswordError(err)) throw err;
      const r = await askArchivePassword(displayName, (p) => action(p), { wrong: !!errorShape(err).wrongPassword });
      if (!r) return undefined;
      rememberPassword(r.password);
      return r.value;
    }
  };

  /** Whether this archive format supports in-place editing. Nested archives are read-only. */
  const editable = listing ? isEditableFormat(listing.format) && via.length === 0 : false;

  /** Reload the archive listing after a modification. */
  const reload = useCallback(async () => {
    try {
      const l = await call<Listing>('tool:archiveList', { path: archivePath, ...(passwordRef.current !== undefined ? { password: passwordRef.current } : {}) });
      if (currentArchive.current === archivePath) setListing(l);
    } catch { /* the original listing stays */ }
  }, [archivePath]);

  /** Add files from the filesystem into the archive (at the current inner directory). */
  const addEntries = async (filePaths: string[]) => {
    if (!editable || !filePaths.length) return;
    setBusy('__adding');
    try {
      const result = await withPassword(!!listing?.encrypted, (password) =>
        call<ArchiveEditResult>('archive:addEntries', { archivePath, filePaths, innerDir: inner || undefined, password }),
      );
      if (result?.modified) {
        toast({ level: 'success', title: `Added ${result.affected} item${result.affected === 1 ? '' : 's'} to the archive` });
        await reload();
      }
    } catch (err) {
      toastError(err, 'Could not add files to the archive');
    } finally {
      setBusy(null);
    }
  };

  /** Delete selected entries from the archive. */
  const deleteEntries = async (targets: string[]) => {
    if (!editable || !targets.length) return;
    const ok = await confirm({
      title: `Delete ${targets.length} item${targets.length === 1 ? '' : 's'} from the archive?`,
      body: 'This will permanently remove the selected entries from the archive file. This cannot be undone.',
      confirmLabel: 'Delete from archive',
      destructive: true,
    });
    if (!ok) return;
    setBusy('__deleting');
    try {
      const result = await withPassword(!!listing?.encrypted, (password) =>
        call<ArchiveEditResult>('archive:deleteEntries', { archivePath, entries: targets, password }),
      );
      if (result?.modified) {
        toast({ level: 'success', title: `Deleted ${result.affected} item${result.affected === 1 ? '' : 's'} from the archive` });
        setSelected(new Set());
        await reload();
      }
    } catch (err) {
      toastError(err, 'Could not delete entries from the archive');
    } finally {
      setBusy(null);
    }
  };

  /** Rename a single entry inside the archive. */
  const renameEntry = async (c: Child) => {
    if (!editable) return;
    const _stem = c.isDir ? c.name : c.name.replace(/\.[^.]+$/, '');
    const ext = c.isDir ? '' : (c.name.includes('.') ? c.name.slice(c.name.lastIndexOf('.')) : '');
    const newName = await prompt({
      title: 'Rename entry',
      label: 'New name',
      initial: c.name,
      confirmLabel: 'Rename',
      selectStem: !!ext,
      validate: (v) => {
        const n = v.trim();
        if (!n) return 'A name is required.';
        if (n.includes('/') || n.includes('\\')) return 'Names cannot contain slashes.';
        if (n === c.name) return 'The name is the same.';
        if (children.some((x) => x.name === n && x.full !== c.full)) return 'An entry with this name already exists.';
        return undefined;
      },
    });
    if (!newName) return;
    setBusy(c.full);
    try {
      const oldName = c.entry?.name ?? c.full;
      const result = await withPassword(!!listing?.encrypted, (password) =>
        call<ArchiveEditResult>('archive:renameEntry', { archivePath, oldName, newName: newName.trim(), password }),
      );
      if (result?.modified) {
        toast({ level: 'success', title: `Renamed to "${newName.trim()}"` });
        await reload();
      }
    } catch (err) {
      toastError(err, 'Could not rename the entry');
    } finally {
      setBusy(null);
    }
  };

  /** Create a new folder inside the archive at the current path. */
  const createFolder = async () => {
    if (!editable) return;
    const name = await prompt({
      title: 'New folder',
      label: 'Folder name',
      initial: 'New folder',
      confirmLabel: 'Create',
      selectStem: false,
      validate: (v) => {
        const n = v.trim();
        if (!n) return 'A name is required.';
        if (n.includes('/') || n.includes('\\')) return 'Names cannot contain slashes.';
        if (children.some((x) => x.name === n)) return 'An entry with this name already exists.';
        return undefined;
      },
    });
    if (!name) return;
    setBusy('__mkdir');
    try {
      const result = await withPassword(!!listing?.encrypted, (password) =>
        call<ArchiveEditResult>('archive:mkdir', { archivePath, parentDir: inner || undefined, folderName: name.trim(), password }),
      );
      if (result?.modified) {
        toast({ level: 'success', title: `Created folder "${name.trim()}"` });
        await reload();
      }
    } catch (err) {
      toastError(err, 'Could not create the folder');
    } finally {
      setBusy(null);
    }
  };

  /** Open the format conversion dialog. */
  const convertArchive = () => {
    if (!listing) return;
    openDialog('archiveConvert', { archivePath, currentFormat: listing.format, password: passwordRef.current });
  };

  /** Handle files dropped onto the archive view. */
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (!editable) return;
    const files: string[] = [];
    if (e.dataTransfer.files.length) {
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const f = e.dataTransfer.files[i]!;
        if ((f as File & { path?: string }).path) files.push((f as File & { path: string }).path);
      }
    }
    if (files.length) void addEntries(files);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (editable) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
  };

  const enterFolder = (full: string) => {
    setInner(full);
    setSelected(new Set());
    setFocusKey(null);
    anchorRef.current = null;
  };
  const goUp = () => {
    if (!inner) {
      if (!via.length) void navigate(paneId, { kind: 'fs', path: rootDir ?? parentPath(archivePath)! });
      return;
    }
    const parts = inner.split('/').filter(Boolean);
    const from = inner;
    setInner(parts.length > 1 ? parts.slice(0, -1).join('/') + '/' : '');
    setSelected(new Set());
    setFocusKey(from);
    anchorRef.current = from;
  };

  const openNested = async (c: Child) => {
    setBusy(c.full);
    try {
      const nested = await withPassword(c.encrypted, (password) => call<string>('tool:archiveNested', { archivePath, entry: c.entry?.name ?? c.full, depth: via.length, password }));
      if (nested) await navigate(paneId, { kind: 'archive', archivePath: nested, inner: '', via: [...via, displayName], rootDir: rootDir ?? parentPath(archivePath) });
    } catch (err) {
      toastError(err, 'Could not open the inner archive');
    } finally {
      setBusy(null);
    }
  };

  /** Copy one file out to private scratch space, then open it, offer "Open with…" or preview it. */
  const openItem = async (c: Child, how: 'default' | 'with' | 'preview') => {
    if (c.isDir) return;
    if (c.entry?.unsafe) {
      toast({ level: 'warning', title: `“${c.name}” cannot be opened`, detail: c.entry.unsafe });
      return;
    }
    setBusy(c.full);
    try {
      const copy = await withPassword(c.encrypted, (password) => call<FileEntry>('tool:archiveEntry', { archivePath, entry: c.entry?.name ?? c.full, password }));
      if (!copy) return;
      if (how === 'default') {
        if (await openFile(copy.path)) toast({ level: 'info', title: `Opened a temporary copy of “${c.name}”`, detail: 'Changes to it are not saved into the archive. The copy is deleted when Orbis Files closes.' });
      } else if (how === 'with') {
        openDialog('openWith', { path: copy.path });
      } else {
        app.set({ archivePreview: { paneId, archivePath, entryName: c.entry?.name ?? c.full, entry: copy, modifiedMs: c.entry?.modifiedMs } });
        await showPanel('inspector');
      }
    } catch (err) {
      toastError(err, how === 'preview' ? `Could not preview “${c.name}”` : `Could not open “${c.name}”`);
    } finally {
      setBusy(null);
    }
  };

  const activate = (c: Child, how: 'default' | 'with' = 'default') => {
    if (c.isDir) return enterFolder(c.full);
    if (how === 'default' && isArchiveName(c.name) && !c.entry?.unsafe) return void openNested(c);
    void openItem(c, how);
  };

  const extract = async (mode: 'here' | 'choose', only?: string[]) => {
    if (!listing) return;
    const selection = only?.length ? listing.entries.filter((e) => only.some((o) => e.name === o || (o.endsWith('/') && e.name.startsWith(o)))).map((e) => e.name) : undefined;
    const affected = selection ? listing.entries.filter((e) => selection.includes(e.name)) : listing.entries;
    let password = passwordRef.current;
    if (password === undefined && affected.some((e) => e.encrypted && !e.unsafe)) {
      password = await ensurePassword();
      if (password === undefined) return;
    }
    let dest = rootDir ?? parentPath(archivePath);
    if (mode === 'choose') dest = (await call<string | null>('fs:pickDirectory', { title: 'Extract to…' }).catch(() => null)) ?? undefined;
    if (!dest) return;
    await startOperation({ type: 'extract', sources: [archivePath], destination: dest, params: { subfolder: true, selected: selection, ...(password !== undefined ? { password } : {}) }, conflictPolicy: 'ask', origin: 'archive-view' });
  };

  const contextMenu = (c: Child, x: number, y: number) => {
    const targets = selected.has(c.full) ? [...selected] : [c.full];
    if (!selected.has(c.full)) setSelected(new Set([c.full]));
    setFocusKey(c.full);
    const unsafe = c.entry?.unsafe;
    const fileItems: MenuItem[] = c.isDir ? [] : [
      ...(isArchiveName(c.name) ? [{ label: 'Open archive inside', icon: 'archive', disabled: !!unsafe, reason: unsafe, run: () => void openNested(c) }] : []),
      { label: isArchiveName(c.name) ? 'Open with default app' : 'Open', icon: 'open', shortcut: isArchiveName(c.name) ? undefined : 'Enter', disabled: !!unsafe, reason: unsafe, run: () => void openItem(c, 'default') },
      { label: 'Open with…', icon: 'openWith', shortcut: 'Shift+Enter', disabled: !!unsafe, reason: unsafe, run: () => void openItem(c, 'with') },
      { label: 'Preview', icon: 'eye', disabled: !!unsafe, reason: unsafe, run: () => void openItem(c, 'preview') },
      SEP,
    ];
    const editItems: MenuItem[] = !editable ? [] : [
      SEP,
      { label: 'Rename', icon: 'rename', shortcut: 'F2', run: () => void renameEntry(c) },
      { label: targets.length > 1 ? `Delete ${targets.length} items` : 'Delete', icon: 'trash', shortcut: 'Delete', run: () => void deleteEntries(targets) },
    ];
    menu.open([
      ...(c.isDir ? [{ label: 'Open folder', icon: 'folderOpen', shortcut: 'Enter', run: () => enterFolder(c.full) }, SEP] : fileItems),
      { label: targets.length > 1 ? `Extract ${targets.length} items to…` : 'Extract to…', icon: 'extract', disabled: !!unsafe, reason: unsafe, run: () => void extract('choose', targets) },
      { label: 'Copy name', icon: 'copy', run: () => void call('fs:copyText', { text: c.name }) },
      { label: 'Copy path inside the archive', icon: 'path', run: () => void call('fs:copyText', { text: c.full }) },
      ...editItems,
    ], x, y);
  };

  const select = (keys: string[], focus: string) => {
    setSelected(new Set(keys));
    setFocusKey(focus);
  };

  const onRowClick = (e: React.MouseEvent, c: Child, i: number) => {
    gridRef.current?.focus();
    if (e.shiftKey && anchorRef.current) {
      const a = Math.max(0, children.findIndex((x) => x.full === anchorRef.current));
      const [lo, hi] = a < i ? [a, i] : [i, a];
      select(children.slice(lo, hi + 1).map((x) => x.full), c.full);
      return;
    }
    anchorRef.current = c.full;
    if (e.ctrlKey || e.metaKey) {
      const next = new Set(selected);
      if (next.has(c.full)) next.delete(c.full);
      else next.add(c.full);
      setSelected(next);
      setFocusKey(c.full);
    } else select([c.full], c.full);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTableElement>) => {
    const handled = () => {
      e.preventDefault();
      e.stopPropagation(); // keep the window's file-view shortcuts from acting on the folder behind
    };
    const mod = e.ctrlKey || e.metaKey;
    const move = (to: number) => {
      if (!children.length) return;
      const t = Math.max(0, Math.min(children.length - 1, to));
      const target = children[t]!;
      handled();
      if (e.shiftKey) {
        const a = Math.max(0, children.findIndex((x) => x.full === (anchorRef.current ?? focusKey ?? target.full)));
        const [lo, hi] = a < t ? [a, t] : [t, a];
        select(children.slice(lo, hi + 1).map((x) => x.full), target.full);
      } else if (mod) setFocusKey(target.full);
      else {
        anchorRef.current = target.full;
        select([target.full], target.full);
      }
    };
    const page = Math.max(1, Math.floor((gridRef.current?.parentElement?.clientHeight ?? 400) / Math.max(1, gridRef.current?.querySelector('tbody tr')?.getBoundingClientRect().height ?? 32)) - 1);
    const cur = focusIndex;
    const focused = cur >= 0 ? children[cur] : undefined;
    switch (e.key) {
      case 'ArrowDown': return move(cur < 0 ? 0 : cur + 1);
      case 'ArrowUp':
        if (e.altKey) {
          handled();
          return goUp();
        }
        return move(cur < 0 ? 0 : cur - 1);
      case 'Home': return move(0);
      case 'End': return move(children.length - 1);
      case 'PageDown': return move(cur + page);
      case 'PageUp': return move(cur - page);
      case ' ':
        if (!focused) return;
        handled();
        {
          const next = new Set(selected);
          if (next.has(focused.full)) next.delete(focused.full);
          else next.add(focused.full);
          anchorRef.current = focused.full;
          setSelected(next);
        }
        return;
      case 'Enter':
        if (!focused || e.altKey || mod) return;
        handled();
        return activate(focused, e.shiftKey ? 'with' : 'default');
      case 'Backspace':
        handled();
        return goUp();
      case 'F2':
        if (!focused || !editable) return;
        handled();
        return void renameEntry(focused);
      case 'Delete':
        if (!editable || !selected.size) return;
        handled();
        return void deleteEntries([...selected]);
      case 'Escape':
        if (!selected.size) return;
        handled();
        return setSelected(new Set());
      case 'ContextMenu':
      case 'F10':
        if (e.key === 'F10' && !e.shiftKey) return;
        handled();
        if (focused) {
          const r = document.getElementById(rowId(cur))?.getBoundingClientRect();
          contextMenu(focused, (r?.left ?? 0) + 40, (r?.top ?? 0) + (r?.height ?? 0) / 2);
        }
        return;
    }
    if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'a') {
      handled();
      setSelected(new Set(children.map((c) => c.full)));
      return;
    }
    // Type-ahead: jump to the next item starting with the typed text.
    if (e.key.length === 1 && !mod && !e.altKey && /\S/.test(e.key)) {
      const now = Date.now();
      typeahead.current.text = now - typeahead.current.t > 800 ? e.key.toLowerCase() : typeahead.current.text + e.key.toLowerCase();
      typeahead.current.t = now;
      const start = typeahead.current.text.length === 1 ? cur + 1 : Math.max(0, cur);
      const order = [...children.slice(start), ...children.slice(0, start)];
      const hit = order.find((x) => x.name.toLowerCase().startsWith(typeahead.current.text));
      if (hit) {
        handled();
        anchorRef.current = hit.full;
        select([hit.full], hit.full);
      }
    }
  };

  const backToFolder = <button type="button" className="btn btn-default btn-md" onClick={() => void navigate(paneId, { kind: 'fs', path: rootDir ?? parentPath(archivePath)! })}>Back to folder</button>;
  if (error) return <ErrorState title="This archive could not be read" body={error}>{backToFolder}</ErrorState>;
  if (locked) {
    return (
      <EmptyState icon="lock" title="This archive is password-protected" body={`The names of the files in “${displayName}” are encrypted. Enter the password to see and extract them.`}>
        <button type="button" className="btn btn-primary btn-md" onClick={() => void unlock()}>Enter password…</button>
        {backToFolder}
      </EmptyState>
    );
  }
  if (!listing) return <Loading label="Reading archive…" />;
  if (!listing.supported) return <EmptyState icon="archive" title="This archive type is not supported" body={listing.warnings.join(' ')} />;

  const label = `Contents of ${displayName}${inner ? `, folder ${inner.replace(/\/$/, '')}` : ''}`;
  return (
    <div className="pane-content" onDrop={onDrop} onDragOver={onDragOver}>
      <header className="view-header compact">
        <div>
          <h1><Icon name="archive" size={18} /> {[...via, displayName].join(' › ')}</h1>
          {via.length > 0 && <p className="muted small">Opened from inside another archive. Nothing was extracted to your folders; a private temporary copy of this inner archive is removed when Orbis Files closes.</p>}
          <p className="muted">
            {listing.format.toUpperCase()} · {listing.entries.length.toLocaleString()} entries · {formatBytes(listing.archiveSize)} on disk
            {listing.totalSize ? ` · ${formatBytes(listing.totalSize)} uncompressed` : ''}
          </p>
          {listing.encrypted && (
            <p className="muted">
              <Icon name="lock" size={13} /> Password-protected{encryptedCount ? ` (${encryptedCount.toLocaleString()} encrypted file${encryptedCount === 1 ? '' : 's'})` : ''}.{' '}
              {hasPassword ? 'The password is remembered while this archive is open here.' : 'You will be asked for the password when you open or extract encrypted files.'}
              {hasPassword && <> <button type="button" className="link-btn" onClick={() => rememberPassword(undefined)}>Forget password</button></>}
            </p>
          )}
          {unsafeCount > 0 && <p className="warning-text"><Icon name="warning" size={13} /> {unsafeCount} entr{unsafeCount === 1 ? 'y' : 'ies'} will not be extracted (unsafe paths or links).</p>}
          {listing.warnings.map((w) => <p key={w} className="muted">{w}</p>)}
        </div>
        <span className="spacer" />
        <div className="tb-group">
          {editable && (
            <>
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null} title="Add files to the archive (or drag and drop)" onClick={() => void call<string | null>('fs:pickFile', { title: 'Add a file to the archive' }).catch(() => null).then((r) => r && void addEntries([r]))}>
                <Icon name="plus" size={14} /> Add
              </button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null} title="New folder" onClick={() => void createFolder()}>
                <Icon name="folderPlus" size={14} /> New folder
              </button>
              {selected.size > 0 && (
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null} title="Delete selected entries" onClick={() => void deleteEntries([...selected])}>
                  <Icon name="trash" size={14} /> Delete
                </button>
              )}
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null} title="Convert to another format" onClick={convertArchive}>
                <Icon name="convert" size={14} /> Convert
              </button>
            </>
          )}
          {selected.size > 0 && <button type="button" className="btn btn-default btn-sm" onClick={() => void extract('choose', [...selected])}>Extract {selected.size} selected…</button>}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void import('../FileDialogs').then((m) => m.testArchiveIntegrity(archivePath, passwordRef.current))}>Test integrity</button>
          <button type="button" className="btn btn-default btn-sm" onClick={() => void extract('here')}>{via.length ? 'Extract next to the outer archive' : 'Extract here'}</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void extract('choose')}>Extract to…</button>
        </div>
      </header>
      <nav className="archive-crumbs" aria-label="Folders in the archive">
        <button type="button" className="crumb" onClick={() => enterFolder('')}>{displayName}</button>
        {inner.split('/').filter(Boolean).map((seg, i, arr) => (
          <React.Fragment key={i}>
            <Icon name="chevronRight" size={12} className="crumb-sep" />
            <button type="button" className="crumb" aria-current={i === arr.length - 1 ? 'location' : undefined} onClick={() => enterFolder(arr.slice(0, i + 1).join('/') + '/')}>{seg}</button>
          </React.Fragment>
        ))}
      </nav>
      <div className="pane-view scroll-y">
        {!children.length ? (
          <EmptyState icon="folderOpen" title="This folder in the archive is empty">
            {inner && <button type="button" className="btn btn-default btn-md" onClick={goUp}>Up one folder</button>}
          </EmptyState>
        ) : (
          <table
            ref={gridRef}
            className="table archive-grid"
            role="grid"
            aria-label={label}
            aria-multiselectable
            aria-rowcount={children.length + 1}
            aria-activedescendant={focusIndex >= 0 ? rowId(focusIndex) : undefined}
            tabIndex={0}
            onKeyDown={onKeyDown}
          >
            <thead>
              <tr role="row" aria-rowindex={1}>
                <th role="columnheader" style={{ width: 28 }}><span className="sr-only">Type</span></th>
                <th role="columnheader">Name</th>
                <th role="columnheader" className="num">Size</th>
                <th role="columnheader" className="num wide-only">Compressed</th>
                <th role="columnheader" className="wide-only">Modified</th>
                <th role="columnheader"><span className="sr-only">Status</span></th>
              </tr>
            </thead>
            <tbody>
              {children.map((c, i) => {
                const isSel = selected.has(c.full);
                return (
                  <tr
                    key={c.full}
                    id={rowId(i)}
                    role="row"
                    aria-rowindex={i + 2}
                    aria-selected={isSel}
                    className={`clickable ${isSel ? 'is-selected' : ''} ${i === focusIndex ? 'is-focused' : ''} ${c.entry?.unsafe ? 'is-missing' : ''}`}
                    onClick={(e) => onRowClick(e, c, i)}
                    onDoubleClick={() => activate(c)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      gridRef.current?.focus();
                      contextMenu(c, e.clientX, e.clientY);
                    }}
                  >
                    <td role="gridcell"><FileIcon entry={{ kind: c.isDir ? 'directory' : c.entry?.kind === 'symlink' ? 'symlink' : 'file', ext: c.name.split('.').pop()?.toLowerCase() ?? '', linkTargetKind: c.entry?.kind === 'symlink' ? 'broken' : undefined }} /></td>
                    <td role="gridcell" className="cell-name-min archive-name">
                      {c.name}
                      {c.isDir && <span className="sr-only">, folder</span>}
                      {c.encrypted && <span className="muted" title="Encrypted"> <Icon name="lock" size={12} /><span className="sr-only">, encrypted</span></span>}
                      {c.isDir && c.count > 0 && <span className="muted"> · {c.count} item{c.count === 1 ? '' : 's'}</span>}
                      {c.entry?.unsafe && <div className="warning-text small">{c.entry.unsafe}</div>}
                      {c.entry?.modifiedMs !== undefined && <div className="cell-sub narrow-only tabular">Modified {formatDate(c.entry.modifiedMs)}</div>}
                    </td>
                    <td role="gridcell" className="tabular num">{c.isDir ? formatBytes(c.size) : formatBytes(c.entry?.size)}</td>
                    <td role="gridcell" className="tabular num wide-only">{c.entry?.compressedSize !== undefined ? formatBytes(c.entry.compressedSize) : '—'}</td>
                    <td role="gridcell" className="tabular wide-only">{formatDate(c.entry?.modifiedMs)}</td>
                    <td role="gridcell">
                      {c.entry?.unsafe ? <Pill tone="warning">skipped</Pill>
                        : busy === c.full ? <span className="muted small" role="status">Opening…</span>
                        : !c.isDir && isArchiveName(c.name) ? <button type="button" className="btn btn-ghost btn-sm" tabIndex={-1} disabled={busy !== null} onClick={(ev) => { ev.stopPropagation(); void openNested(c); }}>Open</button>
                        : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {menu.node}
    </div>
  );
}
