import { useState, useCallback } from 'react';
import { Icon } from '../../ui/Icon';

interface ImpactResult {
  path: string;
  kind: string;
  size: number;
  impacts: { type: string; description: string; path?: string; value?: number }[];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

export function ImpactSimulatorView() {
  const [paths, setPaths] = useState<string[]>([]);
  const [operation, setOperation] = useState<'delete' | 'move' | 'rename'>('delete');
  const [destination, setDestination] = useState('');
  const [results, setResults] = useState<ImpactResult[]>([]);
  const [loading, setLoading] = useState(false);

  const invoke = useCallback(async (channel: string, data: any = {}) => {
    return (window as any).orbis.invoke(channel, data);
  }, []);

  const addPath = async () => {
    try {
      const result = await invoke('fs:pickDirectory', {});
      if (result && !paths.includes(result)) {
        setPaths(prev => [...prev, result]);
      }
    } catch {}
  };

  const simulate = async () => {
    if (!paths.length) return;
    setLoading(true);
    try {
      const r = await invoke('universe:impact', {
        paths,
        operation,
        ...(operation === 'move' && destination ? { destination } : {}),
      });
      setResults(r);
    } catch {
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="tool-view impact-simulator">
      <header className="view-header">
        <h1><Icon name="alertTriangle" /> Impact Simulator</h1>
      </header>

      <div className="impact-setup">
        <div className="impact-paths">
          <label>Files/Folders to Analyze</label>
          {paths.map((p, i) => (
            <div key={i} className="impact-path-item">
              <Icon name="file" />
              <span>{p}</span>
              <button className="btn btn-sm" onClick={() => setPaths(prev => prev.filter((_, j) => j !== i))}>
                <Icon name="x" />
              </button>
            </div>
          ))}
          <button className="btn" onClick={addPath}><Icon name="plus" /> Add Path</button>
        </div>

        <div className="impact-operation">
          <label>Operation</label>
          <select value={operation} onChange={e => setOperation(e.target.value as any)}>
            <option value="delete">Delete</option>
            <option value="move">Move</option>
            <option value="rename">Rename</option>
          </select>
        </div>

        {operation === 'move' && (
          <div className="impact-destination">
            <label>Destination</label>
            <input type="text" value={destination} onChange={e => setDestination(e.target.value)} placeholder="Target path..." />
          </div>
        )}

        <button className="btn btn-primary" onClick={simulate} disabled={loading || !paths.length}>
          <Icon name="search" /> {loading ? 'Analyzing...' : 'Simulate Impact'}
        </button>
      </div>

      {results.length > 0 && (
        <div className="impact-results scroll-y">
          {results.map((r, i) => (
            <div key={i} className="impact-result-card">
              <div className="impact-result-header">
                <Icon name={r.kind === 'directory' ? 'folder' : 'file'} />
                <span className="impact-result-path">{r.path}</span>
                <span className="impact-result-size">{formatBytes(r.size)}</span>
              </div>
              <div className="impact-result-impacts">
                {r.impacts.map((imp, j) => (
                  <div key={j} className={`impact-item impact-${imp.type}`}>
                    <Icon name={imp.type === 'broken_symlink' ? 'alertTriangle' : imp.type === 'space_freed' ? 'storage' : 'info'} />
                    <span>{imp.description}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
