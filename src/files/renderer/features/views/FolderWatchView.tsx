import { useCallback, useEffect, useState } from 'react';
import { call } from '../../api';
import { EmptyState, IconButton } from '../../ui/components';
import { toast, toastError } from '../../state/app';
import type { FolderWatch, WatchEvent } from '../../../shared/folderWatch';

export function FolderWatchView() {
  const [watches, setWatches] = useState<FolderWatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newPath, setNewPath] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newInclude, setNewInclude] = useState('');
  const [newIgnore, setNewIgnore] = useState('');
  const [newAction, setNewAction] = useState<'none' | 'notify' | 'copy' | 'move'>('none');
  const [newActionDest, setNewActionDest] = useState('');
  const [logView, setLogView] = useState<string | null>(null);
  const [logEntries, setLogEntries] = useState<WatchEvent[]>([]);

  const load = useCallback(async () => {
    try {
      const list = await call<FolderWatch[]>('watch:list');
      setWatches(list);
    } catch (e) { toastError(e); }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleCreate = useCallback(async () => {
    if (!newPath.trim()) {
      toast({ level: 'warning', title: 'Path is required.' });
      return;
    }
    try {
      await call('watch:create', {
        path: newPath.trim(),
        label: newLabel.trim() || undefined,
        rule: {
          include: newInclude.trim() ? newInclude.split(',').map((s) => s.trim()).filter(Boolean) : [],
          ignore: newIgnore.trim() ? newIgnore.split(',').map((s) => s.trim()).filter(Boolean) : [],
          autoAction: newAction,
          actionDest: newActionDest.trim() || undefined,
        },
      });
      toast({ level: 'success', title: 'Watch created' });
      setCreating(false);
      setNewPath(''); setNewLabel(''); setNewInclude(''); setNewIgnore(''); setNewAction('none'); setNewActionDest('');
      await load();
    } catch (e) { toastError(e); }
  }, [newPath, newLabel, newInclude, newIgnore, newAction, newActionDest, load]);

  const handlePickDir = useCallback(async () => {
    const result = await call<string | null>('fs:pickDirectory', { title: 'Select folder to watch' });
    if (result) setNewPath(result);
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await call('watch:delete', { id });
      await load();
    } catch (e) { toastError(e); }
  }, [load]);

  const handleToggle = useCallback(async (w: FolderWatch) => {
    try {
      if (w.enabled) {
        await call('watch:stop', { id: w.id });
        await call('watch:update', { id: w.id, enabled: false });
      } else {
        await call('watch:update', { id: w.id, enabled: true });
        await call('watch:start', { id: w.id });
      }
      await load();
    } catch (e) { toastError(e); }
  }, [load]);

  const handleStart = useCallback(async (id: string) => {
    try {
      await call('watch:start', { id });
      toast({ level: 'success', title: 'Watcher started' });
    } catch (e) { toastError(e); }
  }, []);

  const handleStop = useCallback(async (id: string) => {
    try {
      await call('watch:stop', { id });
      toast({ level: 'success', title: 'Watcher stopped' });
    } catch (e) { toastError(e); }
  }, []);

  const handleViewLog = useCallback(async (id: string) => {
    try {
      const log = await call<WatchEvent[]>('watch:log', { id });
      setLogEntries(log);
      setLogView(id);
    } catch (e) { toastError(e); }
  }, []);

  if (loading) return <div className="tool-view scroll-y"><div className="pad"><p className="muted">Loading watches...</p></div></div>;

  if (logView) {
    return (
      <div className="tool-view scroll-y folder-watch-view">
        <header className="view-header">
          <h1>Watch Log</h1>
          <div className="tb-group">
            <button type="button" className="btn btn-ghost" onClick={() => setLogView(null)}>Back</button>
          </div>
        </header>
        <div className="pad">
          {!logEntries.length ? (
            <EmptyState icon="activity" title="No events" body="No file changes detected yet." />
          ) : (
            <div className="watch-log">
              {logEntries.map((ev, i) => (
                <div key={i} className="watch-log-entry">
                  <span className={`watch-event-type watch-event-${ev.eventType}`}>{ev.eventType}</span>
                  <span className="watch-event-path ellipsis">{ev.path}</span>
                  <span className="muted small">{new Date(ev.timestampMs).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="tool-view scroll-y folder-watch-view">
      <header className="view-header">
        <h1>Folder Watcher</h1>
        <div className="tb-group">
          <IconButton icon="plus" label="Add watch" onClick={() => setCreating(true)} />
        </div>
      </header>
      <div className="pad">
        {creating && (
          <div className="glass-card" style={{ padding: 'var(--sp-4)', marginBottom: 'var(--sp-4)' }}>
            <h3>New Watch</h3>
            <div className="field-row">
              <label>Folder path</label>
              <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                <input type="text" value={newPath} onChange={(e) => setNewPath(e.target.value)} placeholder="/path/to/folder" style={{ flex: 1 }} />
                <button type="button" className="btn btn-ghost" onClick={handlePickDir}>Browse</button>
              </div>
            </div>
            <div className="field-row">
              <label>Label</label>
              <input type="text" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Optional label" />
            </div>
            <div className="field-row">
              <label>Include patterns (comma-separated)</label>
              <input type="text" value={newInclude} onChange={(e) => setNewInclude(e.target.value)} placeholder="*.txt, *.md" />
            </div>
            <div className="field-row">
              <label>Ignore patterns (comma-separated)</label>
              <input type="text" value={newIgnore} onChange={(e) => setNewIgnore(e.target.value)} placeholder="*.tmp, node_modules/**" />
            </div>
            <div className="field-row">
              <label>Auto-action</label>
              <select value={newAction} onChange={(e) => setNewAction(e.target.value as typeof newAction)}>
                <option value="none">None</option>
                <option value="notify">Notify only</option>
                <option value="copy">Copy to destination</option>
                <option value="move">Move to destination</option>
              </select>
            </div>
            {(newAction === 'copy' || newAction === 'move') && (
              <div className="field-row">
                <label>Action destination</label>
                <input type="text" value={newActionDest} onChange={(e) => setNewActionDest(e.target.value)} placeholder="/path/to/destination" />
              </div>
            )}
            <div className="tb-group" style={{ marginTop: 'var(--sp-3)' }}>
              <button type="button" className="btn btn-primary" onClick={handleCreate}>Create</button>
              <button type="button" className="btn btn-ghost" onClick={() => setCreating(false)}>Cancel</button>
            </div>
          </div>
        )}
        {!watches.length && !creating ? (
          <EmptyState icon="eye" title="No folder watches" body="Watch folders for file changes, set up rules, and trigger auto-actions." />
        ) : (
          <div className="watch-list">
            {watches.map((w) => (
              <div key={w.id} className="watch-item glass-card">
                <div className="watch-item-header">
                  <strong>{w.label || w.path}</strong>
                  <span className={`badge ${w.enabled ? 'badge-success' : 'badge-muted'}`}>{w.enabled ? 'Enabled' : 'Disabled'}</span>
                </div>
                <p className="muted small ellipsis">{w.path}</p>
                {w.rule.include.length > 0 && <p className="small">Include: {w.rule.include.join(', ')}</p>}
                {w.rule.ignore.length > 0 && <p className="small">Ignore: {w.rule.ignore.join(', ')}</p>}
                {w.rule.autoAction !== 'none' && <p className="small">Action: {w.rule.autoAction}{w.rule.actionDest ? ` → ${w.rule.actionDest}` : ''}</p>}
                <div className="tb-group">
                  <IconButton icon="play" label="Start" onClick={() => handleStart(w.id)} />
                  <IconButton icon="pause" label="Stop" onClick={() => handleStop(w.id)} />
                  <IconButton icon="activity" label="View log" onClick={() => handleViewLog(w.id)} />
                  <IconButton icon="toggle" label={w.enabled ? 'Disable' : 'Enable'} onClick={() => handleToggle(w)} />
                  <IconButton icon="trash" label="Delete" onClick={() => handleDelete(w.id)} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
