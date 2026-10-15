import { useState, useCallback } from 'react';
import { Icon } from '../../ui/Icon';

interface DiffEntry {
  relativePath: string;
  status: 'added' | 'removed' | 'modified' | 'same';
  leftSize?: number;
  rightSize?: number;
  kind: string;
}

interface DiffResult {
  leftPath: string;
  rightPath: string;
  entries: DiffEntry[];
  stats: { added: number; removed: number; modified: number; same: number; leftTotal: number; rightTotal: number; leftBytes: number; rightBytes: number };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

export function FolderDiffView() {
  const [leftPath, setLeftPath] = useState('');
  const [rightPath, setRightPath] = useState('');
  const [result, setResult] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<string>('all');
  const [compareContent, setCompareContent] = useState(false);

  const invoke = useCallback(async (channel: string, data: any = {}) => {
    return (window as any).orbis.invoke(channel, data);
  }, []);

  const pickFolder = async (side: 'left' | 'right') => {
    try {
      const result = await invoke('fs:pickDirectory', {});
      if (result) {
        if (side === 'left') setLeftPath(result);
        else setRightPath(result);
      }
    } catch {}
  };

  const runDiff = async () => {
    if (!leftPath || !rightPath) return;
    setLoading(true);
    try {
      const r = await invoke('universe:diff', { leftPath, rightPath, deep: true, compareContent });
      setResult(r);
    } catch {
    } finally {
      setLoading(false);
    }
  };

  const filtered = result?.entries.filter(e => filter === 'all' || e.status === filter) || [];

  const statusColor = (s: string) => {
    switch (s) {
      case 'added': return 'var(--accent)';
      case 'removed': return 'var(--error)';
      case 'modified': return '#ff9800';
      case 'same': return 'var(--text-2)';
      default: return 'var(--text)';
    }
  };

  return (
    <div className="tool-view universe-diff">
      <header className="view-header">
        <h1><Icon name="compare" /> Folder Diff</h1>
      </header>

      <div className="diff-setup">
        <div className="diff-folders">
          <div className="diff-folder">
            <label>Left Folder</label>
            <div className="diff-folder-input">
              <input type="text" value={leftPath} onChange={e => setLeftPath(e.target.value)} placeholder="Select left folder..." />
              <button className="btn btn-sm" onClick={() => pickFolder('left')}><Icon name="folder" /></button>
            </div>
          </div>
          <div className="diff-arrow"><Icon name="arrowLeftRight" /></div>
          <div className="diff-folder">
            <label>Right Folder</label>
            <div className="diff-folder-input">
              <input type="text" value={rightPath} onChange={e => setRightPath(e.target.value)} placeholder="Select right folder..." />
              <button className="btn btn-sm" onClick={() => pickFolder('right')}><Icon name="folder" /></button>
            </div>
          </div>
        </div>
        <div className="diff-options">
          <label className="checkbox-label">
            <input type="checkbox" checked={compareContent} onChange={e => setCompareContent(e.target.checked)} />
            Compare content (slower but more accurate)
          </label>
          <button className="btn btn-primary" onClick={runDiff} disabled={loading || !leftPath || !rightPath}>
            <Icon name="compare" /> {loading ? 'Comparing...' : 'Compare'}
          </button>
        </div>
      </div>

      {result && (
        <>
          <div className="diff-summary">
            <div className="diff-stat" style={{ color: 'var(--accent)' }}>
              <span className="diff-stat-num">{result.stats.added}</span> Added
            </div>
            <div className="diff-stat" style={{ color: 'var(--error)' }}>
              <span className="diff-stat-num">{result.stats.removed}</span> Removed
            </div>
            <div className="diff-stat" style={{ color: '#ff9800' }}>
              <span className="diff-stat-num">{result.stats.modified}</span> Modified
            </div>
            <div className="diff-stat" style={{ color: 'var(--text-2)' }}>
              <span className="diff-stat-num">{result.stats.same}</span> Same
            </div>
            <div className="diff-size-compare">
              Left: {formatBytes(result.stats.leftBytes)} ({result.stats.leftTotal} items) &mdash; Right: {formatBytes(result.stats.rightBytes)} ({result.stats.rightTotal} items)
            </div>
          </div>

          <div className="diff-filter-bar">
            {['all', 'added', 'removed', 'modified', 'same'].map(f => (
              <button key={f} className={`btn btn-sm ${filter === f ? 'btn-primary' : ''}`} onClick={() => setFilter(f)}>
                {f.charAt(0).toUpperCase() + f.slice(1)} {f === 'all' ? `(${result.entries.length})` : `(${result.stats[f as keyof typeof result.stats] || 0})`}
              </button>
            ))}
          </div>

          <div className="diff-list scroll-y">
            {filtered.map((e, i) => (
              <div key={i} className={`diff-entry diff-${e.status}`}>
                <span className="diff-status-badge" style={{ color: statusColor(e.status) }}>
                  {e.status === 'added' ? '+' : e.status === 'removed' ? '−' : e.status === 'modified' ? '~' : '='}
                </span>
                <Icon name={e.kind === 'directory' ? 'folder' : 'file'} />
                <span className="diff-path">{e.relativePath}</span>
                <span className="diff-sizes">
                  {e.leftSize !== undefined && formatBytes(e.leftSize)}
                  {e.leftSize !== undefined && e.rightSize !== undefined && ' → '}
                  {e.rightSize !== undefined && formatBytes(e.rightSize)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
