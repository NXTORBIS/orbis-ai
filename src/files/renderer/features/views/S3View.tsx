import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { call, errorShape, newId } from '../../api';
import { useStore } from '../../state/store';
import { s3Store, ensureS3Connected, listBuckets, listObjects, deleteS3Object, createS3Folder, renameS3Object, presignS3Url } from '../../state/s3';
import { openDialog, prompt, toast, toastError, confirm } from '../../state/app';
import { Button, EmptyState, ErrorState, Loading, Pill, SEP, useMenu, type MenuItem } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { formatBytes } from '../../ui/format';
import { S3_PROVIDERS, type S3Bucket, type S3ConnectionInfo, type S3Object } from '../../../shared/s3';

/* ---------------------------------------------------------------- helpers */

function objectIcon(obj: S3Object): string {
  if (obj.isPrefix) return 'folder';
  const ext = obj.name.split('.').pop()?.toLowerCase() ?? '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'flac', 'ogg', 'aac'].includes(ext)) return 'music';
  if (['zip', 'tar', 'gz', '7z', 'rar'].includes(ext)) return 'archive';
  if (['pdf'].includes(ext)) return 'fileText';
  if (['doc', 'docx', 'txt', 'md', 'rtf'].includes(ext)) return 'fileText';
  return 'file';
}

/* ---------------------------------------------------------------- bucket list */

function BucketList({ connId, conn, onSelect }: { connId: string; conn: S3ConnectionInfo; onSelect: (bucket: string) => void }) {
  const [buckets, setBuckets] = useState<S3Bucket[] | null>(null);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    listBuckets(connId).then(
      (b) => { if (!cancelled) { setBuckets(b); setLoading(false); } },
      (e) => { if (!cancelled) { setError(errorShape(e).message); setLoading(false); } },
    );
    return () => { cancelled = true; };
  }, [connId]);

  if (loading) return <Loading label={`Listing buckets on ${conn.name}…`} />;
  if (error) return <ErrorState title="Could not list buckets" body={error} />;
  if (!buckets?.length) return <EmptyState icon="cloud" title="No buckets found" body="This account has no buckets, or the credentials do not have ListBuckets permission." />;

  return (
    <div className="s3-bucket-list">
      {buckets.map((b) => (
        <button key={b.name} type="button" className="s3-bucket-item" onClick={() => onSelect(b.name)}>
          <Icon name="database" size={16} />
          <span className="s3-bucket-name">{b.name}</span>
          {b.creationDate && <span className="s3-bucket-date muted">{b.creationDate.slice(0, 10)}</span>}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- object list */

function ObjectList({ connId, conn: _conn, bucket, prefix, onNavigate, onBucketBack }: {
  connId: string;
  conn: S3ConnectionInfo;
  bucket: string;
  prefix: string;
  onNavigate: (prefix: string) => void;
  onBucketBack: () => void;
}) {
  const [objects, setObjects] = useState<S3Object[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const menu = useMenu();

  const load = useCallback(() => {
    setLoading(true);
    setError(undefined);
    listObjects(connId, bucket, prefix).then(
      (r) => { setObjects(r.objects); setLoading(false); },
      (e) => { setError(errorShape(e).message); setLoading(false); },
    );
  }, [connId, bucket, prefix]);

  useEffect(() => { load(); }, [load]);

  const sorted = useMemo(() => {
    const folders = objects.filter((o) => o.isPrefix).sort((a, b) => a.name.localeCompare(b.name));
    const files = objects.filter((o) => !o.isPrefix).sort((a, b) => a.name.localeCompare(b.name));
    return [...folders, ...files];
  }, [objects]);

  const onContext = (e: React.MouseEvent, obj?: S3Object) => {
    e.preventDefault();
    const items: MenuItem[] = [];
    if (obj) {
      if (obj.isPrefix) {
        items.push({ label: 'Open folder', run: () => onNavigate(obj.key) });
        items.push(SEP);
      } else {
        items.push({ label: 'Download', run: () => void doDownload(connId, bucket, obj.key) });
        items.push({ label: 'Presigned URL…', run: () => void doPresign(connId, bucket, obj.key) });
        items.push(SEP);
      }
      items.push({ label: 'Rename…', run: () => void doRename(connId, bucket, obj, load) });
      items.push({ label: 'Delete', danger: true, run: () => void doDelete(connId, bucket, obj.key, obj.name, load) });
    } else {
      items.push({ label: 'New folder…', run: () => void doNewFolder(connId, bucket, prefix, load) });
      items.push({ label: 'Upload file…', run: () => void doUpload(connId, bucket, prefix, load) });
      items.push(SEP);
      items.push({ label: 'Refresh', run: load });
    }
    menu.open(items, e.clientX, e.clientY);
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const files = e.dataTransfer.files;
    if (!files.length) return;
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      const filePath = window.orbis.getPathForFile?.(file) ?? file.name;
      const key = prefix + file.name;
      void doUploadFile(connId, bucket, key, filePath, load);
    }
  }, [connId, bucket, prefix, load]);

  const crumbs = useMemo(() => {
    const parts: Array<{ label: string; prefix: string }> = [{ label: bucket, prefix: '' }];
    if (prefix) {
      const segments = prefix.split('/').filter(Boolean);
      let acc = '';
      for (const seg of segments) {
        acc += seg + '/';
        parts.push({ label: seg, prefix: acc });
      }
    }
    return parts;
  }, [bucket, prefix]);

  if (loading && !objects.length) return <Loading label={`Reading ${bucket}/${prefix}…`} />;

  return (
    <div className="s3-object-view" onContextMenu={(e) => onContext(e)} onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }} onDrop={onDrop}>
      <div className="s3-toolbar">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onBucketBack} title="Back to buckets">
          <Icon name="arrowLeft" size={14} />
        </button>
        <div className="s3-crumbs">
          {crumbs.map((c, i) => (
            <React.Fragment key={c.prefix}>
              {i > 0 && <span className="s3-crumb-sep">/</span>}
              <button type="button" className="s3-crumb" onClick={() => i === 0 ? onNavigate('') : onNavigate(c.prefix)}>
                {c.label}
              </button>
            </React.Fragment>
          ))}
        </div>
        <div className="s3-toolbar-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void doNewFolder(connId, bucket, prefix, load)} title="New folder">
            <Icon name="folderPlus" size={14} />
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void doUpload(connId, bucket, prefix, load)} title="Upload">
            <Icon name="upload" size={14} />
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={load} title="Refresh">
            <Icon name="refresh" size={14} />
          </button>
        </div>
      </div>

      {error && <ErrorState title="Could not list objects" body={error}><Button onClick={load}>Try again</Button></ErrorState>}

      {!error && !sorted.length && !loading && (
        <EmptyState icon="cloud" title="This prefix is empty" body="Drop files here or use Upload to add objects.">
          <Button onClick={() => void doNewFolder(connId, bucket, prefix, load)}>New folder</Button>
        </EmptyState>
      )}

      {sorted.length > 0 && (
        <div className="s3-list" role="list">
          {sorted.map((obj) => (
            <div
              key={obj.key}
              className="s3-row"
              role="listitem"
              onClick={() => { if (obj.isPrefix) onNavigate(obj.key); }}
              onContextMenu={(e) => onContext(e, obj)}
              onDoubleClick={() => { if (!obj.isPrefix) void doDownload(connId, bucket, obj.key); }}
            >
              <Icon name={objectIcon(obj)} size={16} />
              <span className="s3-row-name">{obj.name}{obj.isPrefix && !obj.name.endsWith('/') ? '/' : ''}</span>
              {!obj.isPrefix && obj.size !== undefined && <span className="s3-row-size muted">{formatBytes(obj.size)}</span>}
              {obj.lastModified && <span className="s3-row-date muted">{obj.lastModified.slice(0, 16).replace('T', ' ')}</span>}
              {obj.storageClass && obj.storageClass !== 'STANDARD' && <Pill tone="neutral">{obj.storageClass}</Pill>}
            </div>
          ))}
        </div>
      )}
      {menu.node}
    </div>
  );
}

/* ---------------------------------------------------------------- actions */

async function doDownload(connId: string, bucket: string, key: string) {
  const jobId = newId('s3dl');
  try {
    const res = await call<{ localPath: string }>('s3:download', { id: connId, bucket, key, jobId });
    toast({ level: 'success', title: 'Downloaded', detail: res.localPath });
  } catch (e) {
    toastError(e, 'S3 download');
  }
}

async function doUpload(connId: string, bucket: string, prefix: string, reload: () => void) {
  const localPath = await call<string | null>('fs:pickFile', { title: 'Choose a file to upload' });
  if (!localPath) return;
  const fileName = localPath.split(/[\\/]/).pop() ?? localPath;
  const key = prefix + fileName;
  await doUploadFile(connId, bucket, key, localPath, reload);
}

async function doUploadFile(connId: string, bucket: string, key: string, localPath: string, reload: () => void) {
  const jobId = newId('s3up');
  try {
    await call('s3:upload', { id: connId, bucket, key, localPath, jobId });
    toast({ level: 'success', title: `Uploaded ${key.split('/').pop()}` });
    reload();
  } catch (e) {
    toastError(e, 'S3 upload');
  }
}

async function doNewFolder(connId: string, bucket: string, prefix: string, reload: () => void) {
  const name = await prompt({ title: 'New folder', label: 'Folder name', initial: 'New folder', confirmLabel: 'Create' });
  if (!name) return;
  try {
    await createS3Folder(connId, bucket, prefix + name);
    toast({ level: 'success', title: `Created folder "${name}"` });
    reload();
  } catch (e) {
    toastError(e, 'Create S3 folder');
  }
}

async function doDelete(connId: string, bucket: string, key: string, name: string, reload: () => void) {
  const ok = await confirm({ title: 'Delete from S3?', body: `Permanently delete "${name}"? This cannot be undone.`, confirmLabel: 'Delete', destructive: true });
  if (!ok) return;
  try {
    await deleteS3Object(connId, bucket, key);
    toast({ level: 'success', title: `Deleted "${name}"` });
    reload();
  } catch (e) {
    toastError(e, 'Delete S3 object');
  }
}

async function doRename(connId: string, bucket: string, obj: S3Object, reload: () => void) {
  const newName = await prompt({ title: 'Rename', label: 'New name', initial: obj.name, confirmLabel: 'Rename', selectStem: !obj.isPrefix });
  if (!newName || newName === obj.name) return;
  const oldKey = obj.key;
  const parts = oldKey.split('/');
  parts[parts.length - (obj.isPrefix ? 2 : 1)] = newName;
  const newKey = parts.join('/');
  try {
    await renameS3Object(connId, bucket, oldKey, newKey);
    toast({ level: 'success', title: `Renamed to "${newName}"` });
    reload();
  } catch (e) {
    toastError(e, 'Rename S3 object');
  }
}

async function doPresign(connId: string, bucket: string, key: string) {
  try {
    const result = await presignS3Url(connId, bucket, key);
    await call('fs:copyText', { text: result.url });
    toast({ level: 'success', title: 'Presigned URL copied to clipboard', detail: `Expires in ${Math.round(result.expiresInSeconds / 60)} minutes.` });
  } catch (e) {
    toastError(e, 'Generate presigned URL');
  }
}

/* ---------------------------------------------------------------- tool view (shown from the ToolViews switch) */

/**
 * Top-level S3 tool view. Lists all saved connections and lets the user
 * pick one to open, or add a new connection. Once a connection is chosen
 * it delegates to S3Browser.
 */
export function S3ToolView() {
  const connections = useStore(s3Store, (s) => s.connections);
  const [activeConnId, setActiveConnId] = useState<string | null>(null);

  if (activeConnId) {
    return <S3Browser connectionId={activeConnId} onBack={() => setActiveConnId(null)} />;
  }

  return (
    <div className="tool-view scroll-y">
      <header className="view-header">
        <h1>S3 Storage</h1>
        <Button onClick={() => openDialog('s3Edit')}>Add connection</Button>
      </header>
      {connections.length === 0 ? (
        <EmptyState icon="cloud" title="No S3 connections" body="Add a connection to browse S3-compatible cloud storage." />
      ) : (
        <div className="s3-bucket-list">
          {connections.map((c) => (
            <button key={c.id} type="button" className="s3-bucket-item" onClick={() => setActiveConnId(c.id)}>
              <Icon name="cloud" size={16} />
              <span className="s3-bucket-name">{c.name}</span>
              <span className="s3-bucket-date muted">{S3_PROVIDERS[c.provider]?.name ?? c.provider} &middot; {c.region}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- main view */

/**
 * S3 browser panel. Shown when the user opens an S3 connection.
 * First shows the bucket list (or goes straight to a default bucket),
 * then shows the object browser within a bucket.
 */
export function S3Browser({ connectionId, onBack }: { connectionId: string; onBack?: () => void }) {
  const conn = useStore(s3Store, (s) => s.connections.find((c) => c.id === connectionId));
  const [connected, setConnected] = useState(false);
  const [bucket, setBucket] = useState<string | null>(null);
  const [prefix, setPrefix] = useState('');
  const [connectError, setConnectError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    setConnectError(undefined);
    ensureS3Connected(connectionId).then(
      (ok) => {
        if (cancelled) return;
        setConnected(ok);
        if (ok && conn?.bucket) setBucket(conn.bucket);
        if (!ok) setConnectError('Could not connect. Check your credentials.');
      },
      (e) => { if (!cancelled) setConnectError(errorShape(e).message); },
    );
    return () => { cancelled = true; };
  }, [connectionId, conn?.bucket]);

  if (!conn) {
    return <ErrorState title="S3 connection not found" body="This connection was removed." />;
  }

  if (!connected) {
    if (connectError) {
      return (
        <ErrorState title={`Could not connect to ${conn.name}`} body={connectError}>
          <Button onClick={() => void ensureS3Connected(connectionId).then(setConnected)}>Retry</Button>
          <Button variant="ghost" onClick={() => openDialog('s3Edit', { id: connectionId })}>Edit connection</Button>
        </ErrorState>
      );
    }
    return <Loading label={`Connecting to ${conn.name}…`} />;
  }

  const providerName = S3_PROVIDERS[conn.provider]?.name ?? conn.provider;

  return (
    <div className="s3-browser">
      <div className="s3-header">
        {onBack && <button type="button" className="btn btn-ghost btn-sm" onClick={onBack} title="Back to connections"><Icon name="arrowLeft" size={14} /></button>}
        <Icon name="cloud" size={16} />
        <span className="s3-header-name">{conn.name}</span>
        <span className="s3-header-info muted">{providerName} &middot; {conn.region}</span>
        <Pill tone={conn.secure ? 'success' : 'warning'}>{conn.secure ? 'HTTPS' : 'HTTP'}</Pill>
      </div>
      {bucket === null ? (
        <BucketList connId={connectionId} conn={conn} onSelect={(b) => { setBucket(b); setPrefix(''); }} />
      ) : (
        <ObjectList
          connId={connectionId}
          conn={conn}
          bucket={bucket}
          prefix={prefix}
          onNavigate={(p) => setPrefix(p)}
          onBucketBack={() => { setBucket(null); setPrefix(''); }}
        />
      )}
    </div>
  );
}
