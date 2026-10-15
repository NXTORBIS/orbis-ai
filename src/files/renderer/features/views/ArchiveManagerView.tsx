import React, { useCallback, useState } from 'react';
import { call } from '../../api';
import { EmptyState, ErrorState, IconButton, Loading, Button } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { formatBytes, formatDate } from '../../ui/format';
import { toast, toastError } from '../../state/app';
import type { ArchiveManagerEntry, ArchiveInfo, ArchiveFormat, CompressionLevel } from '../../../shared/archiveManager';
import { FORMAT_LABELS, LEVEL_LABELS } from '../../../shared/archiveManager';

type Tab = 'browse' | 'create';

export function ArchiveManagerView() {
  const [tab, setTab] = useState<Tab>('browse');
  const [archivePath, setArchivePath] = useState('');
  const [innerPath, setInnerPath] = useState('');
  const [password, setPassword] = useState('');
  const [entries, setEntries] = useState<ArchiveManagerEntry[]>([]);
  const [info, setInfo] = useState<ArchiveInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Create archive state
  const [createFormat, setCreateFormat] = useState<ArchiveFormat>('zip');
  const [createLevel, setCreateLevel] = useState<CompressionLevel>('normal');
  const [createPassword, setCreatePassword] = useState('');
  const [createDestination, setCreateDestination] = useState('');
  const [createSources, setCreateSources] = useState('');

  const browseArchive = useCallback(async (path: string, inner = '') => {
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      const result = await call<{ entries: ArchiveManagerEntry[]; format: string; totalSize: number; archiveSize: number; encrypted: boolean }>(
        'archiveMgr:browse', { archivePath: path, innerPath: inner, password: password || undefined },
      );
      setEntries(result.entries);
      setInnerPath(inner);
      setSelected(new Set());
    } catch (e) {
      setError(String(e));
      setEntries([]);
    }
    setLoading(false);
  }, [password]);

  const loadInfo = useCallback(async (archPath: string) => {
    try {
      const result = await call<ArchiveInfo>('archiveMgr:info', { archivePath: archPath, password: password || undefined });
      setInfo(result);
    } catch {
      setInfo(null);
    }
  }, [password]);

  const handleOpen = () => {
    if (!archivePath) return;
    void browseArchive(archivePath, '');
    void loadInfo(archivePath);
  };

  const handlePickArchive = async () => {
    try {
      const result = await call<string | null>('fs:pickFile', { title: 'Select archive' });
      if (result) {
        setArchivePath(result);
        void browseArchive(result, '');
        void loadInfo(result);
      }
    } catch (e) { toastError(e); }
  };

  const navigateUp = () => {
    if (!innerPath) return;
    const parts = innerPath.replace(/\/$/, '').split('/');
    parts.pop();
    const newPath = parts.join('/');
    void browseArchive(archivePath, newPath);
  };

  const extractSelected = async () => {
    if (!selected.size) { toast({ level: 'info', title: 'Select files to extract.' }); return; }
    try {
      const dest = await call<string | null>('fs:pickDirectory', { title: 'Extract to' });
      if (!dest) return;
      const result = await call<{ extracted: string[]; count: number }>(
        'archiveMgr:extractFiles',
        { archivePath, entries: Array.from(selected), destination: dest, password: password || undefined },
      );
      toast({ level: 'success', title: `Extracted ${result.count} file(s).` });
    } catch (e) { toastError(e); }
  };

  const createArchive = async () => {
    if (!createSources.trim() || !createDestination.trim()) {
      toast({ level: 'info', title: 'Enter source paths and a destination.' }); return;
    }
    try {
      const sources = createSources.split('\n').map((s) => s.trim()).filter(Boolean);
      await call<unknown>('archiveMgr:create', {
        sources,
        destination: createDestination,
        format: createFormat,
        compressionLevel: createLevel,
        password: createPassword || undefined,
      });
      toast({ level: 'success', title: 'Archive creation started.' });
    } catch (e) { toastError(e); }
  };

  const toggleSelect = (entryPath: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(entryPath)) next.delete(entryPath);
      else next.add(entryPath);
      return next;
    });
  };

  const pathParts = innerPath ? innerPath.replace(/\/$/, '').split('/').filter(Boolean) : [];

  const formatOptions = (Object.entries(FORMAT_LABELS) as [ArchiveFormat, string][]).map(([k, v]) => ({ value: k, label: v }));
  const levelOptions = (Object.entries(LEVEL_LABELS) as [CompressionLevel, string][]).map(([k, v]) => ({ value: k, label: v }));

  return (
    <div className="tool-view scroll-y">
      <header className="view-header">
        <h1><Icon name="archive" size={22} /> Archive Manager</h1>
        <p style={{ color: 'var(--text-2)' }}>Browse archive contents, extract files, or create new archives with compression options.</p>
      </header>

      {/* Tab selector */}
      <div style={{ display: 'flex', gap: 'var(--sp-2)', marginBottom: 'var(--sp-5)' }}>
        <button type="button" className={`btn btn-sm ${tab === 'browse' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('browse')}>
          <Icon name="search" size={14} /> Browse archive
        </button>
        <button type="button" className={`btn btn-sm ${tab === 'create' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('create')}>
          <Icon name="archive" size={14} /> Create archive
        </button>
      </div>

      {tab === 'browse' && (
        <>
          {/* Archive picker */}
          <div style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end', marginBottom: 'var(--sp-4)' }}>
            <div style={{ flex: 1 }}>
              <label className="field">
                <span className="field-label">Archive path</span>
                <input type="text" value={archivePath} onChange={(e) => setArchivePath(e.target.value)}
                  placeholder="/path/to/archive.zip" />
              </label>
            </div>
            <Button size="sm" onClick={handlePickArchive}>Browse...</Button>
            <Button size="sm" variant="primary" onClick={handleOpen} disabled={!archivePath}>Open</Button>
          </div>

          {/* Password field */}
          <div style={{ maxWidth: 300, marginBottom: 'var(--sp-4)' }}>
            <label className="field">
              <span className="field-label">Password (if encrypted)</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
          </div>

          {/* Archive info bar */}
          {info && (
            <div style={{
              display: 'flex', gap: 'var(--sp-5)', padding: 'var(--sp-3) var(--sp-4)',
              background: 'var(--bg-inset)', borderRadius: 6,
              fontSize: 'var(--fs-xs)', color: 'var(--text-2)', marginBottom: 'var(--sp-4)',
            }}>
              <span>Format: {info.format}</span>
              <span>Files: {info.totalFiles}</span>
              <span>Size: {formatBytes(info.totalSize)}</span>
              <span>Compressed: {formatBytes(info.compressedSize)}</span>
              {info.encrypted && <span style={{ color: 'var(--accent)' }}>Encrypted</span>}
            </div>
          )}

          {/* Breadcrumbs */}
          {entries.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '2px', marginBottom: 'var(--sp-3)', flexWrap: 'wrap' }}>
              {innerPath && (
                <IconButton icon="up" label="Up" onClick={navigateUp} />
              )}
              <button type="button" className="btn btn-sm btn-ghost"
                onClick={() => void browseArchive(archivePath, '')}>
                <Icon name="archive" size={14} />
              </button>
              {pathParts.map((part, i) => (
                <React.Fragment key={i}>
                  <Icon name="chevronRight" size={12} />
                  <button type="button" className="btn btn-sm btn-ghost"
                    onClick={() => void browseArchive(archivePath, pathParts.slice(0, i + 1).join('/'))}>
                    {part}
                  </button>
                </React.Fragment>
              ))}
            </div>
          )}

          {/* Selection bar */}
          {selected.size > 0 && (
            <div className="selection-bar">
              <span>{selected.size} selected</span>
              <span className="spacer" />
              <Button size="sm" variant="primary" onClick={extractSelected}>
                <Icon name="extract" size={14} /> Extract selected
              </Button>
              <Button size="sm" onClick={() => setSelected(new Set())}>Clear selection</Button>
            </div>
          )}

          {loading && <Loading label="Reading archive..." />}
          {error && <ErrorState title="Error" body={error} />}

          {!loading && !error && entries.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 32 }}></th>
                  <th>Name</th>
                  <th>Size</th>
                  <th>Compressed</th>
                  <th>Modified</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.path} className={selected.has(entry.path) ? 'selected' : ''}>
                    <td>
                      {entry.kind === 'file' && (
                        <input type="checkbox" checked={selected.has(entry.path)}
                          onChange={() => toggleSelect(entry.path)} />
                      )}
                    </td>
                    <td>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
                        <Icon name={entry.kind === 'directory' ? 'folder' : 'file'} size={16} />
                        {entry.kind === 'directory' ? (
                          <button type="button" className="btn btn-ghost" style={{ padding: 0, textAlign: 'left' }}
                            onClick={() => void browseArchive(archivePath, entry.path)}>
                            {entry.name}
                          </button>
                        ) : entry.name}
                        {entry.encrypted && <span style={{ color: 'var(--accent)' }}><Icon name="lock" size={12} /></span>}
                      </span>
                    </td>
                    <td>{entry.size != null ? formatBytes(entry.size) : ''}</td>
                    <td>{entry.compressedSize != null ? formatBytes(entry.compressedSize) : ''}</td>
                    <td>{entry.modifiedMs ? formatDate(entry.modifiedMs) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {!loading && !error && entries.length === 0 && archivePath && (
            <EmptyState icon="archive" title="Empty" body="No entries found at this path." />
          )}
        </>
      )}

      {tab === 'create' && (
        <div style={{ maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
          <h2 style={{ margin: 0 }}>Create archive</h2>
          <label className="field">
            <span className="field-label">Source files (one path per line)</span>
            <textarea value={createSources} onChange={(e) => setCreateSources(e.target.value)} rows={4}
              placeholder={'/home/user/documents\n/home/user/photos'} />
          </label>
          <label className="field">
            <span className="field-label">Destination path</span>
            <input type="text" value={createDestination} onChange={(e) => setCreateDestination(e.target.value)}
              placeholder="/home/user/backup.zip" />
          </label>
          <label className="field">
            <span className="field-label">Format</span>
            <select value={createFormat} onChange={(e) => setCreateFormat(e.target.value as ArchiveFormat)}>
              {formatOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Compression level</span>
            <select value={createLevel} onChange={(e) => setCreateLevel(e.target.value as CompressionLevel)}>
              {levelOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Password (optional)</span>
            <input type="password" value={createPassword} onChange={(e) => setCreatePassword(e.target.value)} />
          </label>
          <Button variant="primary" onClick={createArchive}
            disabled={!createSources.trim() || !createDestination.trim()}>
            <Icon name="archive" size={14} /> Create archive
          </Button>
        </div>
      )}
    </div>
  );
}
