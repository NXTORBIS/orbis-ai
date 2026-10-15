import React, { useState, useMemo, useCallback } from 'react';
import { Icon } from '../../ui/Icon';

interface WorkspaceSession {
  id: string;
  name: string;
  description: string;
  pinned: boolean;
  createdAt: number;
  tabs: { title: string; path: string }[];
}

const NOW = Date.now();

const INITIAL_SESSIONS: WorkspaceSession[] = [
  {
    id: 'ws-1',
    name: 'Default Layout',
    description: 'Home and documents side by side',
    pinned: true,
    createdAt: NOW - 1000 * 60 * 60 * 24 * 3,
    tabs: [
      { title: 'Home', path: '~' },
      { title: 'Documents', path: '~/Documents' },
    ],
  },
  {
    id: 'ws-2',
    name: 'Development Setup',
    description: 'Project folders for daily coding',
    pinned: false,
    createdAt: NOW - 1000 * 60 * 60 * 5,
    tabs: [
      { title: 'Projects', path: '~/Projects' },
      { title: 'Downloads', path: '~/Downloads' },
      { title: 'Desktop', path: '~/Desktop' },
    ],
  },
];

// Stand-in for the live tab set; replace with real workspace state when wired up.
const CURRENT_TABS: { title: string; path: string }[] = [
  { title: 'Home', path: '~' },
  { title: 'Pictures', path: '~/Pictures' },
  { title: 'Music', path: '~/Music' },
];

let idCounter = 100;
const newId = () => `ws-${++idCounter}-${Date.now().toString(36)}`;

export function WorkspaceSessionsView() {
  const [sessions, setSessions] = useState<WorkspaceSession[]>(INITIAL_SESSIONS);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveDesc, setSaveDesc] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [autoSave, setAutoSave] = useState(false);
  const [restoredId, setRestoredId] = useState<string | null>(null);
  const [showIO, setShowIO] = useState(false);
  const [ioText, setIoText] = useState('');
  const [ioError, setIoError] = useState('');

  const sorted = useMemo(
    () =>
      [...sessions].sort((a, b) =>
        a.pinned !== b.pinned ? (a.pinned ? -1 : 1) : b.createdAt - a.createdAt
      ),
    [sessions]
  );

  const handleSave = useCallback(() => {
    const name = saveName.trim();
    if (!name) return;
    const s: WorkspaceSession = {
      id: newId(),
      name,
      description: saveDesc.trim() || `${CURRENT_TABS.length} tabs saved`,
      pinned: false,
      createdAt: Date.now(),
      tabs: CURRENT_TABS.map(t => ({ ...t })),
    };
    setSessions(prev => [s, ...prev]);
    setSaveName('');
    setSaveDesc('');
    setSaving(false);
  }, [saveName, saveDesc]);

  const handleDelete = useCallback((id: string) => {
    setSessions(prev => prev.filter(s => s.id !== id));
    setExpandedId(e => (e === id ? null : e));
  }, []);

  const togglePin = useCallback((id: string) => {
    setSessions(prev => prev.map(s => (s.id === id ? { ...s, pinned: !s.pinned } : s)));
  }, []);

  const startRename = useCallback((s: WorkspaceSession) => {
    setRenamingId(s.id);
    setRenameValue(s.name);
  }, []);

  const commitRename = useCallback(() => {
    const name = renameValue.trim();
    if (renamingId && name) {
      setSessions(prev => prev.map(s => (s.id === renamingId ? { ...s, name } : s)));
    }
    setRenamingId(null);
  }, [renamingId, renameValue]);

  const restoreTimerRef = React.useRef<number | null>(null);

  const handleRestore = useCallback((id: string) => {
    setRestoredId(id);
    if (restoreTimerRef.current !== null) {
      window.clearTimeout(restoreTimerRef.current);
    }
    restoreTimerRef.current = window.setTimeout(() => {
      setRestoredId(cur => (cur === id ? null : cur));
      restoreTimerRef.current = null;
    }, 2000);
  }, []);

  // Cleanup restore timer on unmount
  React.useEffect(() => {
    return () => {
      if (restoreTimerRef.current !== null) {
        window.clearTimeout(restoreTimerRef.current);
      }
    };
  }, []);

  const handleExport = useCallback(() => {
    setIoText(JSON.stringify(sessions, null, 2));
    setIoError('');
    setShowIO(true);
  }, [sessions]);

  const handleImport = useCallback(() => {
    try {
      const data = JSON.parse(ioText);
      const arr: unknown[] = Array.isArray(data) ? data : [data];
      const imported: WorkspaceSession[] = arr.map((raw: any) => {
        if (!raw || typeof raw.name !== 'string' || !Array.isArray(raw.tabs)) {
          throw new Error('Each session needs a name and a tabs array');
        }
        return {
          id: newId(),
          name: raw.name,
          description: typeof raw.description === 'string' ? raw.description : '',
          pinned: !!raw.pinned,
          createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
          tabs: raw.tabs
            .filter((t: any) => t && typeof t.path === 'string')
            .map((t: any) => ({ title: String(t.title ?? t.path), path: t.path })),
        };
      });
      setSessions(prev => [...imported, ...prev]);
      setIoError('');
      setShowIO(false);
      setIoText('');
    } catch (e) {
      setIoError(e instanceof Error ? e.message : 'Invalid JSON');
    }
  }, [ioText]);

  const fmt = (ts: number) =>
    new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <div className="tool-view scroll-y workspace-sessions">
      <header className="view-header">
        <h1>
          <Icon name="workspace" /> Workspace Sessions
        </h1>
        <div className="ws-sessions-toolbar">
          <button className="btn" onClick={handleExport}>Export JSON</button>
          <button className="btn" onClick={() => { setIoText(''); setIoError(''); setShowIO(true); }}>
            Import JSON
          </button>
          <button className="btn btn-primary" onClick={() => setSaving(s => !s)}>
            <Icon name="save" /> Save Current Session
          </button>
        </div>
      </header>

      {saving && (
        <div className="ws-sessions-save">
          <input
            autoFocus
            placeholder="Session name"
            value={saveName}
            onChange={e => setSaveName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleSave();
              if (e.key === 'Escape') setSaving(false);
            }}
          />
          <input
            placeholder="Description (optional)"
            value={saveDesc}
            onChange={e => setSaveDesc(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSave()}
          />
          <button className="btn btn-primary" disabled={!saveName.trim()} onClick={handleSave}>
            <Icon name="check" /> Save
          </button>
          <button className="btn" onClick={() => setSaving(false)}>
            <Icon name="x" /> Cancel
          </button>
        </div>
      )}

      {showIO && (
        <div className="ws-sessions-io">
          <textarea
            rows={8}
            value={ioText}
            placeholder="Paste session JSON here to import"
            onChange={e => setIoText(e.target.value)}
          />
          {ioError && <div className="ws-sessions-error">{ioError}</div>}
          <div className="ws-sessions-io-actions">
            <button className="btn btn-primary" disabled={!ioText.trim()} onClick={handleImport}>
              Import
            </button>
            <button className="btn" onClick={() => setShowIO(false)}>Close</button>
          </div>
        </div>
      )}

      <div className="ws-sessions-auto">
        <label>
          <input type="checkbox" checked={autoSave} onChange={e => setAutoSave(e.target.checked)} />
          <Icon name="clock" /> Auto-save session on exit
        </label>
        <span className="ws-sessions-hint">
          {autoSave ? 'Your layout will be saved when Orbis Files closes.' : 'Auto-save is off.'}
        </span>
      </div>

      <div className="ws-sessions-list">
        {sorted.length === 0 && (
          <div className="ws-sessions-empty">No saved sessions yet.</div>
        )}
        {sorted.map(s => {
          const open = expandedId === s.id;
          return (
            <div key={s.id} className={'ws-sessions-card' + (open ? ' expanded' : '')}>
              <div
                className="ws-sessions-card-head"
                onClick={() => setExpandedId(open ? null : s.id)}
              >
                <div className="ws-sessions-info">
                  {renamingId === s.id ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onClick={e => e.stopPropagation()}
                      onChange={e => setRenameValue(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={e => {
                        if (e.key === 'Enter') commitRename();
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                    />
                  ) : (
                    <div className="ws-sessions-name">
                      {s.pinned && <Icon name="pin" size={14} />} {s.name}
                    </div>
                  )}
                  <div className="ws-sessions-meta">
                    {fmt(s.createdAt)} · {s.tabs.length} {s.tabs.length === 1 ? 'tab' : 'tabs'}
                  </div>
                  {s.description && <div className="ws-sessions-desc">{s.description}</div>}
                </div>
                <div className="ws-sessions-actions" onClick={e => e.stopPropagation()}>
                  <button className="btn" onClick={() => handleRestore(s.id)} title="Restore">
                    <Icon name={restoredId === s.id ? 'check' : 'play'} />
                    {restoredId === s.id ? 'Restored' : 'Restore'}
                  </button>
                  <button className="btn" onClick={() => startRename(s)} title="Rename">
                    <Icon name="edit" />
                  </button>
                  <button
                    className={'btn' + (s.pinned ? ' btn-primary' : '')}
                    onClick={() => togglePin(s.id)}
                    title={s.pinned ? 'Unpin' : 'Pin'}
                  >
                    <Icon name="pin" />
                  </button>
                  <button className="btn" onClick={() => handleDelete(s.id)} title="Delete">
                    <Icon name="trash" />
                  </button>
                </div>
              </div>
              {open && (
                <ul className="ws-sessions-tabs">
                  {s.tabs.map((t, i) => (
                    <li key={i}>
                      <Icon name="folder" size={14} />
                      <strong>{t.title}</strong>
                      <span className="ws-sessions-path">{t.path}</span>
                    </li>
                  ))}
                  {s.tabs.length === 0 && <li>No tabs in this session.</li>}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
