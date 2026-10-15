import { useCallback, useState } from 'react';
import { call } from '../../api';
import { EmptyState, IconButton } from '../../ui/components';
import { toast, toastError } from '../../state/app';
import type { FileVersion } from '../../../shared/fileVersions';

export function FileVersionsView() {
  const [filePath, setFilePath] = useState('');
  const [versions, setVersions] = useState<FileVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [diffResult, setDiffResult] = useState<{ hunks: Array<{ lineA: number; lineB: number; removed: string[]; added: string[] }>; versionA: FileVersion; versionB: FileVersion } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [maxVersions, setMaxVersions] = useState(50);

  const loadVersions = useCallback(async (fp: string) => {
    if (!fp.trim()) return;
    setLoading(true);
    try {
      const list = await call<FileVersion[]>('version:list', { filePath: fp });
      setVersions(list);
    } catch (e) { toastError(e); }
    setLoading(false);
  }, []);

  const handlePickFile = useCallback(async () => {
    const result = await call<string | null>('fs:pickFile', { title: 'Select file for version history' });
    if (result) {
      setFilePath(result);
      void loadVersions(result);
    }
  }, [loadVersions]);

  const handleSnapshot = useCallback(async () => {
    if (!filePath.trim()) {
      toast({ level: 'warning', title: 'Select a file first.' });
      return;
    }
    try {
      await call('version:create', { filePath, label: '' });
      toast({ level: 'success', title: 'Version snapshot created' });
      void loadVersions(filePath);
    } catch (e) { toastError(e); }
  }, [filePath, loadVersions]);

  const handleRestore = useCallback(async (versionId: string) => {
    try {
      await call('version:restore', { versionId });
      toast({ level: 'success', title: 'Version restored' });
    } catch (e) { toastError(e); }
  }, []);

  const handleDelete = useCallback(async (versionId: string) => {
    try {
      await call('version:delete', { versionId });
      toast({ level: 'success', title: 'Version deleted' });
      void loadVersions(filePath);
    } catch (e) { toastError(e); }
  }, [filePath, loadVersions]);

  const handleDiff = useCallback(async () => {
    const ids = Array.from(selected);
    if (ids.length !== 2) {
      toast({ level: 'warning', title: 'Select exactly two versions to compare.' });
      return;
    }
    try {
      const result = await call<typeof diffResult>('version:diff', { versionA: ids[0]!, versionB: ids[1]! });
      setDiffResult(result);
    } catch (e) { toastError(e); }
  }, [selected]);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleSetMax = useCallback(async (val: number) => {
    try {
      await call('version:setMax', { max: val });
      setMaxVersions(val);
      toast({ level: 'success', title: `Max versions set to ${val}` });
    } catch (e) { toastError(e); }
  }, []);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (diffResult) {
    return (
      <div className="tool-view scroll-y file-versions-view">
        <header className="view-header">
          <h1>Version Diff</h1>
          <div className="tb-group">
            <button type="button" className="btn btn-ghost" onClick={() => setDiffResult(null)}>Back</button>
          </div>
        </header>
        <div className="pad">
          <p className="small muted">
            Comparing v{diffResult.versionA.versionNumber} with v{diffResult.versionB.versionNumber}
          </p>
          {!diffResult.hunks.length ? (
            <EmptyState icon="verify" title="No differences" body="The two versions are identical." />
          ) : (
            <div className="diff-view mono">
              {diffResult.hunks.map((hunk, i) => (
                <div key={i} className="diff-hunk">
                  <div className="diff-header muted small">@@ -{hunk.lineA} +{hunk.lineB} @@</div>
                  {hunk.removed.map((line, j) => (
                    <div key={`r${j}`} className="diff-removed">- {line}</div>
                  ))}
                  {hunk.added.map((line, j) => (
                    <div key={`a${j}`} className="diff-added">+ {line}</div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="tool-view scroll-y file-versions-view">
      <header className="view-header">
        <h1>File Version History</h1>
        <div className="tb-group">
          <IconButton icon="plus" label="Snapshot" onClick={handleSnapshot} />
          {selected.size === 2 && <IconButton icon="compare" label="Diff" onClick={handleDiff} />}
        </div>
      </header>
      <div className="pad">
        <div className="field-row" style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
          <input
            type="text" value={filePath} onChange={(e) => setFilePath(e.target.value)}
            placeholder="File path" style={{ flex: 1 }}
            onKeyDown={(e) => { if (e.key === 'Enter') void loadVersions(filePath); }}
          />
          <button type="button" className="btn btn-ghost" onClick={handlePickFile}>Browse</button>
          <button type="button" className="btn btn-primary" onClick={() => void loadVersions(filePath)}>Load</button>
        </div>

        <div className="field-row" style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center', marginTop: 'var(--sp-3)' }}>
          <label className="small">Max versions</label>
          <input
            type="number" value={maxVersions} min={1} max={500}
            onChange={(e) => setMaxVersions(Number(e.target.value))}
            style={{ width: 80 }}
          />
          <button type="button" className="btn btn-ghost small" onClick={() => handleSetMax(maxVersions)}>Apply</button>
        </div>

        {loading && <p className="muted">Loading versions...</p>}

        {!loading && filePath && !versions.length && (
          <EmptyState icon="clock" title="No versions" body="Take a snapshot to start tracking versions of this file." />
        )}

        {versions.length > 0 && (
          <div className="version-list">
            {versions.map((v) => (
              <div
                key={v.id}
                className={`version-item glass-card ${selected.has(v.id) ? 'version-selected' : ''}`}
                onClick={() => toggleSelect(v.id)}
              >
                <div className="version-item-header">
                  <strong>v{v.versionNumber}</strong>
                  <span className="muted small">{formatSize(v.sizeBytes)}</span>
                  <span className="muted small">{new Date(v.createdMs).toLocaleString()}</span>
                </div>
                {v.label && <p className="small">{v.label}</p>}
                <p className="muted small mono ellipsis">{v.hash.slice(0, 16)}...</p>
                <div className="tb-group">
                  <IconButton icon="refresh" label="Restore" onClick={(e) => { e.stopPropagation(); void handleRestore(v.id); }} />
                  <IconButton icon="trash" label="Delete" onClick={(e) => { e.stopPropagation(); void handleDelete(v.id); }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
