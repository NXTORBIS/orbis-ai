import React, { useEffect, useMemo, useState } from 'react';
import { call, runJob } from '../api';
import { app, confirm, openDialog, toast, toastError, type ArchivePreview } from '../state/app';
import { openFile } from '../actions';
import { useStore } from '../state/store';
import { activePane, activeTab, currentLocation, listingKeyFor, listings, reload, selectedEntries, ws } from '../state/workspace';
import { Button, EmptyState, FileIcon, IconButton, Pill, Tabs, tabId } from '../ui/components';
import { Icon } from '../ui/Icon';
import { formatBytes, formatDate, formatFullDate, formatMediaDuration, kindLabel } from '../ui/format';
import { permissionString } from '../../shared/permissions';
import type { MediaMeta } from '../../shared/media';
import { removeEmbedded } from './FileDialogs';
import { Preview } from './Preview';
import { PanelBoundary } from '../ui/PanelBoundary';
import type { FileEntry } from '../../shared/model';
import { useCustom } from '../state/custom';
import { checksumFor, checksums, loadStoredChecksums, recordChecksum } from '../state/checksums';
import { JobPauseButton, useJobPaused } from './views/common';
import { connectionOf, displayPath, previewRemoteFile, remote, remoteAddress } from '../state/remote';
import { runCommand } from '../commands';
import { parseRemoteRef, remoteRef } from '../../shared/remote';
import { ocrKindOf } from '../../shared/ocr';
import { OcrPanel } from './ocr/OcrPanel';
import { textTabSticky } from '../state/ocr';


interface Meta { item?: { id: string; description: string | null; rating: number | null; status?: string }; tags: Array<{ id: string; name: string; color: string | null }>; collections: Array<{ id: string; name: string }> }
interface Snap { id: string; path: string; kind: 'file-copy' | 'folder-manifest'; createdMs: number; bytes: number; restorable: boolean; manifestCount?: number }

export function Inspector() {
  const data = useStore(ws, (s) => {
    const tab = activeTab(s);
    const pane = activePane(s);
    return { tabId: tab.id, pane, sel: pane.selection };
  });
  const key = listingKeyFor(data.tabId, data.pane);
  const entries = useStore(listings, (s) => s[key]?.entries);
  // Includes entries shown outside the listing (expanded tree folders).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const selected = useMemo(() => selectedEntries(data.pane.id), [entries, data.sel, data.pane.id]);
  const loc = currentLocation(data.pane);

  // Single selection from views that don't use listings (collections, library).
  const [fallback, setFallback] = useState<FileEntry | null>(null);
  useEffect(() => {
    setFallback(null);
    if (selected.length === 0 && data.sel.length === 1 && !data.sel[0]!.startsWith('orbis-remote://')) void call<FileEntry>('fs:stat', { path: data.sel[0]! }).then(setFallback, () => setFallback(null));
  }, [data.sel, selected.length]);

  const sel = selected.length ? selected : fallback ? [fallback] : [];
  const archivePreview = useStore(app, (s) => s.archivePreview);

  if (loc.kind === 'remote') {
    return (
      <div className="inspector">
        {selected.length === 1 ? <RemoteItem key={selected[0]!.path} entry={selected[0]!} /> : selected.length > 1 ? <RemoteMulti entries={selected} /> : <RemoteFolderSummary connectionId={loc.connectionId} path={loc.path} count={entries?.length} />}
      </div>
    );
  }

  if (loc.kind === 'archive') {
    const shown = archivePreview && archivePreview.paneId === data.pane.id && archivePreview.archivePath === loc.archivePath ? archivePreview : null;
    return (
      <div className="inspector">
        {shown ? <ArchiveEntryItem key={shown.entry.path} preview={shown} /> : <EmptyState icon="archive" title="Nothing previewed" body="Choose Preview from a file's context menu (right-click, Shift+F10 or the Menu key) to see a temporary copy of it here." />}
      </div>
    );
  }

  return (
    <div className="inspector">
      {sel.length === 1 ? <SingleItem key={sel[0]!.path} entry={sel[0]!} /> : sel.length > 1 ? <MultiItem entries={sel} /> : loc.kind === 'fs' ? <FolderSummary path={loc.path} count={entries?.length} /> : <EmptyState icon="info" title="Nothing selected" body="Select an item to see its preview and properties." />}
    </div>
  );
}

/**
 * A file inside an archive, previewed from a temporary copy with the same
 * preview providers as ordinary files. No tags, notes or edits: the copy is
 * private scratch space and is deleted when Orbis Files closes.
 */
function ArchiveEntryItem({ preview }: { preview: ArchivePreview }) {
  const { entry, entryName, archivePath } = preview;
  const archiveName = archivePath.split(/[\\/]/).pop();
  return (
    <div className="insp-body">
      <div className="insp-title">
        <FileIcon entry={entry} size={28} />
        <div className="min0">
          <h2 className="break" title={entry.name}>{entry.name}</h2>
          <span className="muted">{kindLabel(entry)} · {formatBytes(entry.size)}</span>
        </div>
      </div>
      <div className="callout" role="note">
        <Icon name="archive" size={14} />
        <span>Temporary copy from <strong>{archiveName}</strong>. It is read from the archive for viewing only and deleted when Orbis Files closes; changes are not saved into the archive.</span>
      </div>
      <div className="insp-actions">
        <Button size="sm" icon="open" onClick={() => void openFile(entry.path)}>Open</Button>
        <Button size="sm" icon="openWith" onClick={() => openDialog('openWith', { path: entry.path })}>Open with…</Button>
        <Button size="sm" variant="ghost" icon="close" onClick={() => app.set({ archivePreview: null })}>Close preview</Button>
      </div>
      <div className="insp-preview"><PanelBoundary label="preview" resetKey={entry.path}><Preview entry={entry} /></PanelBoundary></div>
      <dl className="props">
        <dt>Inside the archive</dt><dd className="mono small break">{entryName}</dd>
        {preview.modifiedMs !== undefined && <><dt>Modified</dt><dd className="tabular">{formatFullDate(preview.modifiedMs)}</dd></>}
      </dl>
    </div>
  );
}

/**
 * An item on a server: its properties as the server reports them, and a
 * preview made from a size-limited private copy only when asked for (nothing
 * is downloaded just by selecting it).
 */
function RemoteItem({ entry }: { entry: FileEntry }) {
  const r = parseRemoteRef(entry.path);
  const conn = r ? connectionOf(r.connectionId) : undefined;
  const requested = useStore(remote, (s) => s.previewRef === entry.path);
  const [preview, setPreview] = useState<{ state: 'idle' | 'loading' | 'ready' | 'error'; copy?: FileEntry; error?: string }>({ state: 'idle' });
  const isFile = entry.kind === 'file';
  const load = async () => {
    setPreview({ state: 'loading' });
    try {
      const copy = await previewRemoteFile(entry.path);
      setPreview(copy ? { state: 'ready', copy } : { state: 'idle' });
    } catch (err) {
      setPreview({ state: 'error', error: (err as { shape?: { message?: string } }).shape?.message ?? 'The preview could not be made.' });
    }
  };
  useEffect(() => {
    if (requested && isFile && preview.state === 'idle') void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested]);
  useEffect(() => () => {
    if (remote.get().previewRef === entry.path) remote.set({ previewRef: undefined });
  }, [entry.path]);
  return (
    <div className="insp-body">
      <div className="insp-title">
        <FileIcon entry={entry} size={28} />
        <div className="min0">
          <h2 className="break" title={entry.name}>{entry.name}</h2>
          <span className="muted">{kindLabel(entry)}{isFile ? ` · ${formatBytes(entry.size)}` : ''}</span>
        </div>
      </div>
      <div className="callout" role="note">
        <Icon name="server" size={14} />
        <span>On <strong>{conn?.name ?? 'a server'}</strong>. Opening or previewing downloads a private copy to this computer.</span>
      </div>
      <div className="insp-actions">
        <Button size="sm" icon="open" onClick={() => void runCommand('file.open')}>Open</Button>
        {isFile && preview.state !== 'ready' && <Button size="sm" icon="eye" disabled={preview.state === 'loading'} onClick={() => void load()}>{preview.state === 'loading' ? 'Downloading preview…' : 'Preview'}</Button>}
        <Button size="sm" icon="download" onClick={() => void runCommand('remote.download')}>Download to…</Button>
      </div>
      {preview.state === 'error' && <p className="error-text small" role="alert">{preview.error}</p>}
      {preview.state === 'ready' && preview.copy && <div className="insp-preview"><PanelBoundary label="preview" resetKey={preview.copy.path}><Preview entry={preview.copy} /></PanelBoundary></div>}
      <dl className="props">
        <dt>On the server</dt><dd className="mono small break">{r?.path}</dd>
        <dt>Address</dt><dd className="mono small break">{remoteAddress(entry.path) ?? ''}</dd>
        {entry.size !== undefined && <><dt>Size</dt><dd className="tabular">{formatBytes(entry.size)} <span className="muted">({entry.size.toLocaleString()} bytes)</span></dd></>}
        {entry.modifiedMs !== undefined && <><dt>Modified</dt><dd className="tabular">{formatFullDate(entry.modifiedMs)}</dd></>}
        {entry.mode !== undefined && <><dt>Permissions</dt><dd className="mono">{permissionString(entry.mode, entry.kind)}</dd></>}
        {entry.kind === 'symlink' && <><dt>Link</dt><dd>{entry.linkTargetKind === 'broken' ? 'Points to an item that cannot be read' : `Points to a ${entry.linkTargetKind}`}</dd></>}
      </dl>
    </div>
  );
}

function RemoteMulti({ entries }: { entries: FileEntry[] }) {
  const files = entries.filter((e) => e.kind === 'file');
  const bytes = files.reduce((a, e) => a + (e.size ?? 0), 0);
  return (
    <div className="insp-body">
      <div className="insp-title">
        <Icon name="duplicates" size={28} />
        <div>
          <h2>{entries.length.toLocaleString()} items selected</h2>
          <span className="muted">{files.length} files · {entries.length - files.length} folders</span>
        </div>
      </div>
      <dl className="props"><dt>Size of files</dt><dd className="tabular">{formatBytes(bytes)}</dd></dl>
      <div className="insp-actions">
        <Button size="sm" icon="download" onClick={() => void runCommand('remote.download')}>Download to…</Button>
      </div>
    </div>
  );
}

function RemoteFolderSummary({ connectionId, path, count }: { connectionId: string; path: string; count?: number }) {
  const conn = useStore(remote, (s) => s.connections.find((c) => c.id === connectionId));
  return (
    <div className="insp-body">
      <div className="insp-title">
        <Icon name="server" size={28} />
        <div className="min0">
          <h2 className="ellipsis" title={displayPath(remoteRef(connectionId, path))}>{path === '/' ? conn?.name ?? 'Server' : path.slice(path.lastIndexOf('/') + 1)}</h2>
          <span className="muted">{count !== undefined ? `${count.toLocaleString()} item${count === 1 ? '' : 's'}` : ''}</span>
        </div>
      </div>
      <p className="mono small muted break">{remoteAddress(remoteRef(connectionId, path))}</p>
      <p className="muted small">Select an item to see its properties. Files are only downloaded when you open or preview them.</p>
    </div>
  );
}

function FolderSummary({ path, count }: { path: string; count?: number }) {
  return (
    <div className="insp-body">
      <div className="insp-title">
        <FileIcon entry={{ kind: 'directory', ext: '' }} size={28} />
        <div>
          <h2 className="ellipsis" title={path}>{path.split(/[\\/]/).filter(Boolean).pop() ?? path}</h2>
          <span className="muted">{count !== undefined ? `${count.toLocaleString()} items` : ''}</span>
        </div>
      </div>
      <p className="mono small muted break">{path}</p>
      <p className="muted small">Select an item to see its preview and properties.</p>
    </div>
  );
}

function MultiItem({ entries }: { entries: FileEntry[] }) {
  const files = entries.filter((e) => e.kind === 'file');
  const folders = entries.filter((e) => e.kind === 'directory');
  const bytes = files.reduce((a, e) => a + (e.size ?? 0), 0);
  return (
    <div className="insp-body">
      <div className="insp-title">
        <Icon name="duplicates" size={28} />
        <div>
          <h2>{entries.length.toLocaleString()} items selected</h2>
          <span className="muted">{files.length} files · {folders.length} folders</span>
        </div>
      </div>
      <dl className="props">
        <dt>Size of files</dt><dd className="tabular">{formatBytes(bytes)}{folders.length ? <span className="muted"> (folder contents not included)</span> : null}</dd>
      </dl>
      <div className="insp-actions">
        <Button size="sm" icon="tag" onClick={() => openDialog('tag', { paths: entries.map((e) => e.path) })}>Tags…</Button>
        <Button size="sm" icon="collection" onClick={() => openDialog('collect', { paths: entries.map((e) => e.path) })}>Add to collection…</Button>
        {entries.length > 1 && <Button size="sm" icon="bulkRename" onClick={() => openDialog('bulkRename', { paths: entries.map((e) => e.path) })}>Bulk rename…</Button>}
      </div>
    </div>
  );
}

function SingleItem({ entry }: { entry: FileEntry }) {
  // Customization → Layout: the details panel can show the preview, the properties, or both.
  const show = useCustom((r) => r.layout.details);
  // Images and PDFs have a Text tab (text recognition); it stays chosen while moving between such files.
  const ocrable = entry.kind === 'file' && !!ocrKindOf(entry.name);
  const [chosen, setChosen] = useState<'preview' | 'info' | 'text'>(() => (ocrable && textTabSticky.on ? 'text' : 'preview'));
  const setTab = (t: 'preview' | 'info' | 'text') => {
    textTabSticky.on = t === 'text';
    setChosen(t);
  };
  const plain = !show.showPreview ? 'info' : !show.showProperties ? 'preview' : chosen === 'text' ? 'preview' : chosen;
  const tab = chosen === 'text' && ocrable ? 'text' : plain;
  // "Properties" (Alt+Enter, Ctrl+I) shows this tab; "Recognize text" shows the Text tab.
  useEffect(() => {
    const onShow = () => setTab('info');
    const onText = () => setTab('text');
    document.addEventListener('orbis:show-properties', onShow);
    document.addEventListener('orbis:show-ocr', onText);
    return () => {
      document.removeEventListener('orbis:show-properties', onShow);
      document.removeEventListener('orbis:show-ocr', onText);
    };
  }, []);
  const tabbed = (show.showPreview && show.showProperties) || ocrable;
  const tabList: Array<{ value: 'preview' | 'info' | 'text'; label: string }> = [
    ...(show.showPreview ? [{ value: 'preview' as const, label: 'Preview' }] : []),
    ...(show.showProperties ? [{ value: 'info' as const, label: 'Properties' }] : []),
    ...(ocrable ? [{ value: 'text' as const, label: 'Text' }] : []),
  ];
  const [meta, setMeta] = useState<Meta | null>(null);
  const [sniff, setSniff] = useState<{ detected?: string; mismatch?: string; family: string } | null>(null);
  const catTick = useStore(app, (s) => s.tags);
  useEffect(() => {
    void call<Meta>('cat:itemMeta', { path: entry.path }).then(setMeta, () => setMeta(null));
  }, [entry.path, catTick]);
  useEffect(() => {
    if (entry.kind === 'file') void call<typeof sniff>('fs:sniff', { path: entry.path }).then(setSniff, () => setSniff(null));
  }, [entry.path, entry.kind]);

  return (
    <div className="insp-body">
      <div className="insp-title">
        <FileIcon entry={entry} size={28} />
        <div className="min0">
          <h2 className="break" title={entry.name}>{entry.name}</h2>
          <span className="muted">{kindLabel(entry)}{entry.kind === 'file' ? ` · ${formatBytes(entry.size)}` : ''}</span>
        </div>
      </div>
      {sniff?.mismatch && (
        <div className="callout warning" role="note">
          <Icon name="warning" size={14} />
          <span>{sniff.mismatch} This is only a hint{sniff.family === 'executable' ? '; be careful opening it' : ''}.</span>
        </div>
      )}
      {tabbed && <Tabs idPrefix="insp" label="Details" value={tab} onChange={setTab} tabs={tabList} />}
      <div className="insp-panel" {...(tabbed ? { role: 'tabpanel', id: 'insp-panel', 'aria-labelledby': tabId('insp', tab) } : {})}>
        {tab === 'text' ? (
          <PanelBoundary label="text recognition" resetKey={entry.path}><OcrPanel entry={entry} /></PanelBoundary>
        ) : tab === 'preview' ? (
          <div className="insp-preview"><PanelBoundary label="preview" resetKey={entry.path}><Preview entry={entry} /></PanelBoundary></div>
        ) : (
          <Properties entry={entry} sniff={sniff} />
        )}
      </div>
      <CatalogSection entry={entry} meta={meta} onChange={() => void call<Meta>('cat:itemMeta', { path: entry.path }).then(setMeta)} />
    </div>
  );
}

function Properties({ entry, sniff }: { entry: FileEntry; sniff: { detected?: string } | null }) {
  const [hash, setHash] = useState<{ algorithm: string; digest?: string; done?: number; total?: number; cancel?: () => void; jobId?: string; error?: string } | null>(null);
  const hashPaused = useJobPaused(hash?.jobId);
  const [snaps, setSnaps] = useState<Snap[] | null>(null);
  const loadSnaps = () => void call<Snap[]>('snap:list', { path: entry.path }).then(setSnaps, () => setSnaps([]));
  useEffect(loadSnaps, [entry.path]);
  useEffect(() => () => hash?.cancel?.(), [hash]);
  // A SHA-256 calculated earlier (this session or before) for the file as it is now.
  const stored = useStore(checksums, (s) => checksumFor(entry, s.byPath));
  useEffect(() => {
    if (entry.kind === 'file') void loadStoredChecksums([entry]);
  }, [entry]);
  const compute = (algorithm: 'sha256' | 'sha1' | 'md5' | 'sha512') => {
    const j = runJob<{ digest: string }>((jobId) => call('fs:hash', { path: entry.path, algorithm, jobId }), (p) => setHash((h) => ({ ...(h ?? { algorithm }), ...(p as { done: number; total: number }) })));
    setHash({ algorithm, cancel: j.cancel, jobId: j.jobId });
    j.promise.then((r) => {
      setHash(r.cancelled ? null : { algorithm, digest: r.value?.digest });
      if (!r.cancelled && r.value?.digest) recordChecksum(entry, algorithm, r.value.digest);
    }, (e) => setHash({ algorithm, error: (e as Error).message }));
  };
  const mode = entry.mode !== undefined ? (entry.mode & 0o7777).toString(8).padStart(3, '0') : undefined;
  const parent = entry.path.slice(0, entry.path.length - entry.name.length).replace(/[\\/]$/, '') || '/';
  const [owners, setOwners] = useState<{ user?: string; group?: string }>({});
  const caps = useStore(app, (s) => s.capabilities);
  useEffect(() => {
    if (entry.uid === undefined) return;
    void call<{ users: Record<number, string>; groups: Record<number, string> }>('fs:owners', { uids: [entry.uid], gids: entry.gid !== undefined ? [entry.gid] : [] })
      .then((r) => setOwners({ user: r.users[entry.uid!], group: entry.gid !== undefined ? r.groups[entry.gid] : undefined }), () => undefined);
  }, [entry.uid, entry.gid]);
  const [shortcut, setShortcut] = useState<{ target: string; targetKind: string } | null>(null);
  useEffect(() => {
    setShortcut(null);
    if (entry.ext !== 'lnk' && entry.ext !== 'desktop') return;
    void call<{ target: string; targetKind: string } | null>('fs:resolveShortcut', { path: entry.path }).then(setShortcut, () => undefined);
  }, [entry.path, entry.ext]);
  const canChmod = entry.kind !== 'symlink' && entry.mode !== undefined && (caps?.posixPermissions || entry.readOnly !== undefined);
  return (
    <div className="insp-props">
      <dl className="props">
        <dt>Location</dt><dd className="mono break">{parent}</dd>
        <dt>Type</dt><dd>{kindLabel(entry)}{sniff?.detected ? <span className="muted"> · content: {sniff.detected}</span> : null}</dd>
        {entry.kind === 'file' && <><dt>Size</dt><dd className="tabular">{formatBytes(entry.size)} {entry.size !== undefined && entry.size >= 1024 ? <span className="muted">({entry.size.toLocaleString()} bytes)</span> : null}</dd></>}
        <dt>Modified</dt><dd className="tabular">{formatFullDate(entry.modifiedMs)}</dd>
        <dt>Created</dt><dd className="tabular">{entry.createdMs ? formatFullDate(entry.createdMs) : <span className="muted">Not available on this file system</span>}</dd>
        <dt>Accessed</dt><dd className="tabular">{entry.accessedMs ? formatFullDate(entry.accessedMs) : <span className="muted">Not available</span>}</dd>
        {shortcut && <><dt>Shortcut to</dt><dd className="mono break">{shortcut.target} {shortcut.targetKind === 'missing' && <Pill tone="error">missing</Pill>}</dd></>}
        {entry.kind === 'symlink' && <><dt>Link target</dt><dd className="mono break">{entry.linkTarget ?? '—'} {entry.linkTargetKind === 'broken' && <Pill tone="error">missing</Pill>}</dd></>}
        {entry.kind === 'file' && entry.allocatedBytes !== undefined && <><dt>On disk</dt><dd className="tabular">{formatBytes(entry.allocatedBytes)} <span className="muted">allocated</span></dd></>}
        {entry.uid !== undefined && <><dt>Owner</dt><dd>{owners.user ?? entry.uid}{entry.gid !== undefined ? <span className="muted"> · group {owners.group ?? entry.gid}</span> : null}</dd></>}
        {mode && entry.uid !== undefined && <><dt>Permissions</dt><dd className="mono">{permissionString(entry.mode!, entry.kind)} <span className="muted">({mode})</span> {canChmod && <Button size="sm" variant="ghost" icon="permissions" onClick={() => openDialog('permissions', { entry, onDone: () => reload(activePane().id) })}>Change…</Button>}</dd></>}
        {entry.readOnly !== undefined && <><dt>Read-only</dt><dd>{entry.readOnly ? 'Yes' : 'No'} {canChmod && <Button size="sm" variant="ghost" onClick={() => openDialog('permissions', { entry, onDone: () => reload(activePane().id) })}>Change…</Button>}</dd></>}
        {entry.statError && <><dt>Status</dt><dd className="error-text">Could not read properties ({entry.statError})</dd></>}
      </dl>
      {entry.kind === 'file' && <EmbeddedMeta entry={entry} />}
      {entry.kind === 'file' && (
        <div className="insp-section">
          <h3>Checksum</h3>
          {hash?.digest ? (
            <div className="hash">
              <span className="muted small">{hash.algorithm.toUpperCase()}</span>
              <code className="break">{hash.digest}</code>
              <IconButton icon="copy" label="Copy checksum" onClick={() => void call('fs:copyText', { text: hash.digest! })} />
            </div>
          ) : hash?.cancel ? (
            <div className="hash">
              <span className="muted tabular">{hashPaused ? 'Paused' : 'Computing'} {hash.algorithm.toUpperCase()}… {hash.total ? `${Math.round(((hash.done ?? 0) / hash.total) * 100)}%` : ''}</span>
              <JobPauseButton jobId={hash.jobId} size="sm" />
              <Button size="sm" variant="ghost" onClick={hash.cancel}>Stop</Button>
            </div>
          ) : (
            <div className="tb-group wrap">
              {stored && (
                <div className="hash">
                  <span className="muted small">{stored.algorithm.toUpperCase()}</span>
                  <code className="break">{stored.digest}</code>
                  <IconButton icon="copy" label="Copy checksum" onClick={() => void call('fs:copyText', { text: stored.digest })} />
                  <span className="muted small">Calculated {formatDate(stored.computedMs)}; the file has not changed since.</span>
                </div>
              )}
              {hash?.error && <span className="error-text">{hash.error}</span>}
              {(['sha256', 'sha512', 'sha1', 'md5'] as const).map((a) => <Button key={a} size="sm" variant="ghost" onClick={() => compute(a)}>{a.toUpperCase()}</Button>)}
            </div>
          )}
        </div>
      )}
      <div className="insp-section">
        <h3>Snapshots</h3>
        {!snaps ? null : !snaps.length ? <p className="muted small">No snapshots. Right-click → Save a snapshot keeps a {entry.kind === 'directory' ? 'record of names and checksums (metadata only)' : 'restorable copy in Orbis Files storage'}.</p> : snaps.map((s) => (
          <div key={s.id} className="snap-row">
            <span className="tabular">{formatDate(s.createdMs)}</span>
            <Pill tone={s.restorable ? 'success' : 'neutral'}>{s.restorable ? `copy · ${formatBytes(s.bytes)}` : `metadata · ${s.manifestCount} files`}</Pill>
            <span className="spacer" />
            <Button size="sm" variant="ghost" onClick={() => void call<{ added: string[]; removed: string[]; changed: string[]; unchanged: number; unverified: string[] }>('snap:diff', { id: s.id }).then((d) => toast({ level: 'info', title: d.added.length + d.removed.length + d.changed.length ? `Since then: ${d.changed.length} changed, ${d.added.length} added, ${d.removed.length} removed` : 'No changes since this snapshot', detail: [...d.changed, ...d.added, ...d.removed].slice(0, 6).join(', ') + (d.unverified.length ? ` · ${d.unverified.length} large file(s) compared by size and time only` : '') }), toastError)}>Compare</Button>
            {s.restorable && <Button size="sm" variant="ghost" onClick={() => void call<string>('snap:restore', { id: s.id, destination: parent }).then((p) => toast({ level: 'success', title: 'Restored as a new file', detail: p }), toastError)}>Restore copy</Button>}
            <IconButton icon="trash" label="Delete snapshot" onClick={async () => {
              if (await confirm({ title: 'Delete this snapshot?', body: 'Only the snapshot is deleted, not the current file.', confirmLabel: 'Delete snapshot' })) await call('snap:delete', { id: s.id }).then(loadSnaps, toastError);
            }} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Metadata stored inside the file (EXIF, tags, document properties), with edits where supported. */
function EmbeddedMeta({ entry }: { entry: FileEntry }) {
  const [m, setM] = useState<MediaMeta | null>(null);
  const [gps, setGps] = useState<MediaMeta['gps'] | null>(null);
  const opsTick = useStore(app, (s) => Object.values(s.ops).filter((o) => o.type === 'edit-metadata' && o.state === 'completed').length);
  useEffect(() => {
    setGps(null);
    void call<MediaMeta>('meta:read', { path: entry.path }).then(setM, () => setM(null));
  }, [entry.path, entry.modifiedMs, opsTick]);
  if (!m || (m.kind === 'none' && !m.warnings.length)) return null;
  const rows: Array<[string, React.ReactNode]> = [];
  if (m.format) rows.push(['Format', m.format]);
  if (m.width && m.height) rows.push(['Dimensions', `${m.width.toLocaleString()} × ${m.height.toLocaleString()} px${m.width * m.height >= 1e6 ? ` (${(m.width * m.height / 1e6).toFixed(1)} MP)` : ''}`]);
  if (m.durationSec !== undefined) rows.push(['Duration', `${formatMediaDuration(m.durationSec, m.durationEstimated)}${m.durationEstimated ? ' (estimated)' : ''}`]);
  if (m.frameRate) rows.push(['Frame rate', `${m.frameRate} fps`]);
  if (m.videoCodec || m.audioCodec) rows.push(['Codecs', [m.videoCodec, m.audioCodec].filter(Boolean).join(' · ')]);
  if (m.sampleRateHz) rows.push(['Audio', `${(m.sampleRateHz / 1000).toFixed(1)} kHz${m.channels ? ` · ${m.channels === 1 ? 'mono' : m.channels === 2 ? 'stereo' : `${m.channels} channels`}` : ''}${m.bitDepth && m.kind === 'audio' ? ` · ${m.bitDepth}-bit` : ''}`]);
  if (m.bitrateKbps) rows.push(['Bit rate', `${m.bitrateKbps.toLocaleString()} kbps`]);
  if (m.colorType) rows.push(['Colour', `${m.colorType}${m.bitDepth && m.kind === 'image' ? ` · ${m.bitDepth}-bit` : ''}`]);
  if (m.pages !== undefined) rows.push(['Pages', m.pages.toLocaleString()]);
  const e = m.exif;
  if (e?.make || e?.model) rows.push(['Camera', [e.make, e.model].filter(Boolean).join(' ')]);
  if (e?.lens) rows.push(['Lens', e.lens]);
  if (e?.takenAt) rows.push(['Taken', e.takenAt]);
  const exposure = [e?.exposureTime, e?.fNumber ? `f/${e.fNumber}` : undefined, e?.iso ? `ISO ${e.iso}` : undefined, e?.focalLengthMm ? `${e.focalLengthMm} mm` : undefined].filter(Boolean);
  if (exposure.length) rows.push(['Exposure', exposure.join(' · ')]);
  if (e?.software) rows.push(['Software', e.software]);
  const t = m.tags;
  if (t) for (const [k, label] of [['title', 'Title'], ['artist', 'Artist'], ['album', 'Album'], ['albumArtist', 'Album artist'], ['year', 'Year'], ['track', 'Track'], ['genre', 'Genre'], ['comment', 'Comment']] as const) if (t[k]) rows.push([label, t[k]]);
  const it = m.imageText;
  if (it) for (const [k, label] of [['title', 'Title'], ['author', 'Author'], ['description', 'Description'], ['copyright', 'Copyright'], ['comment', 'Comment'], ['software', 'Software (text)']] as const) if (it[k]) rows.push([label, it[k]]);
  const d = m.doc;
  if (d) for (const [k, label] of [['title', 'Title'], ['subject', 'Subject'], ['creator', 'Author'], ['keywords', 'Keywords'], ['description', 'Description'], ['lastModifiedBy', 'Last saved by'], ['created', 'Created (stored)'], ['modified', 'Modified (stored)'], ['application', 'Application'], ['words', 'Words'], ['slides', 'Slides']] as const) if (d[k] !== undefined) rows.push([label, String(d[k])]);
  return (
    <div className="insp-section">
      <h3>Inside the file <span className="muted small">— read from the file itself</span></h3>
      {rows.length ? <dl className="props">{rows.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd className="break">{v}</dd></React.Fragment>)}</dl> : null}
      {m.hasLocation && (
        <div className="callout" role="note">
          <Icon name="warning" size={14} />
          <span>
            This photo contains location data.{' '}
            {gps ? <span className="mono">{gps.latitude}, {gps.longitude}{gps.altitudeM !== undefined ? ` · ${gps.altitudeM} m` : ''}</span> : (
              <button type="button" className="linklike" onClick={() => void call<MediaMeta>('meta:read', { path: entry.path, includeLocation: true }).then((x) => setGps(x.gps ?? null), toastError)}>Show coordinates</button>
            )}
          </span>
        </div>
      )}
      {m.warnings.map((w) => <p key={w} className="muted small">{w}</p>)}
      {!!m.editable?.length && (
        <div className="tb-group wrap">
          {m.editable.includes('audioTags') && <Button size="sm" variant="ghost" icon="rename" onClick={() => openDialog('editEmbedded', { path: entry.path, kind: 'audioTags' })}>Edit tags…</Button>}
          {m.editable.includes('removeAudioTags') && <Button size="sm" variant="ghost" onClick={() => void removeEmbedded(entry.path, 'removeAudioTags')}>Remove all tags…</Button>}
          {m.editable.includes('documentProps') && <Button size="sm" variant="ghost" icon="rename" onClick={() => openDialog('editEmbedded', { path: entry.path, kind: 'documentProps' })}>Edit properties…</Button>}
          {m.editable.includes('imageText') && <Button size="sm" variant="ghost" icon="rename" onClick={() => openDialog('editEmbedded', { path: entry.path, kind: 'imageText' })}>Edit text…</Button>}
          {m.editable.includes('removeImageText') && <Button size="sm" variant="ghost" onClick={() => void removeEmbedded(entry.path, 'removeImageText')}>Remove all text…</Button>}
          {m.editable.includes('removeLocation') && <Button size="sm" variant="ghost" icon="removeLocation" onClick={() => void removeEmbedded(entry.path, 'removeLocation')}>Remove location…</Button>}
          {m.editable.includes('removeExif') && <Button size="sm" variant="ghost" onClick={() => void removeEmbedded(entry.path, 'removeExif')}>Remove EXIF…</Button>}
        </div>
      )}
    </div>
  );
}

function CatalogSection({ entry, meta, onChange }: { entry: FileEntry; meta: Meta | null; onChange: () => void }) {
  const [note, setNote] = useState(meta?.item?.description ?? '');
  useEffect(() => setNote(meta?.item?.description ?? ''), [meta?.item?.description]);
  const saveNote = () => {
    if ((meta?.item?.description ?? '') === note) return;
    void call('cat:setItemMeta', { path: entry.path, description: note || null }).then(onChange, toastError);
  };
  return (
    <div className="insp-section catalog">
      <h3>Orbis Files notes <span className="muted small">— stored by Orbis Files, not inside the file</span></h3>
      <div className="tag-row">
        {meta?.tags.map((t) => (
          <span key={t.id} className="tag-chip">
            <i style={{ background: t.color ?? 'var(--accent)' }} />{t.name}
            <button type="button" aria-label={`Remove tag ${t.name}`} onClick={() => void call('cat:untagItems', { tagId: t.id, paths: [entry.path] }).then(onChange, toastError)}><Icon name="close" size={11} /></button>
          </span>
        ))}
        <Button size="sm" variant="ghost" icon="tag" onClick={() => openDialog('tag', { paths: [entry.path] })}>{meta?.tags.length ? 'Edit' : 'Add tags'}</Button>
      </div>
      {meta?.collections.length ? <p className="muted small">In collections: {meta.collections.map((c) => c.name).join(', ')}</p> : null}
      <div className="rating" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={meta?.item?.rating === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} className={(meta?.item?.rating ?? 0) >= n ? 'on' : ''} onClick={() => void call('cat:setItemMeta', { path: entry.path, rating: meta?.item?.rating === n ? null : n }).then(onChange, toastError)}>
            <Icon name="star" size={14} />
          </button>
        ))}
      </div>
      <textarea className="input note" rows={3} placeholder="Add a note…" value={note} aria-label="Note" onChange={(e) => setNote(e.target.value)} onBlur={saveNote} />
    </div>
  );
}
