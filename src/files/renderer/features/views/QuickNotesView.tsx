import React, { useCallback, useMemo, useState } from 'react';
import { Icon } from '../../ui/Icon';

interface Note {
  id: string;
  title: string;
  content: string;
  pinned: boolean;
  createdAt: number;
  modifiedAt: number;
}

type SortKey = 'created' | 'modified' | 'alpha';

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2);

function deriveTitle(content: string): string {
  const line = content.split('\n').find((l) => l.trim());
  return line ? line.trim().slice(0, 60) : 'Untitled note';
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', cursor: 'pointer',
  background: 'var(--bg-overlay, rgba(255,255,255,0.06))', border: '1px solid var(--border, rgba(255,255,255,0.12))',
  borderRadius: 6, color: 'inherit', font: 'inherit',
};

export function QuickNotesView() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('modified');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const selected = notes.find((n) => n.id === selectedId) ?? null;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = notes.filter((n) => !q || n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q));
    const cmp = (a: Note, b: Note) =>
      sort === 'alpha' ? a.title.localeCompare(b.title)
        : sort === 'created' ? b.createdAt - a.createdAt
          : b.modifiedAt - a.modifiedAt;
    return list.sort((a, b) => (a.pinned === b.pinned ? cmp(a, b) : a.pinned ? -1 : 1));
  }, [notes, query, sort]);

  const createNote = useCallback(() => {
    const now = Date.now();
    const n: Note = { id: newId(), title: 'Untitled note', content: '', pinned: false, createdAt: now, modifiedAt: now };
    setNotes((p) => [n, ...p]);
    setSelectedId(n.id);
    setQuery('');
    setSavedAt(now);
  }, []);

  const updateContent = useCallback((id: string, content: string) => {
    const now = Date.now();
    setNotes((p) => p.map((n) => (n.id === id ? { ...n, content, title: deriveTitle(content), modifiedAt: now } : n)));
    setSavedAt(now);
  }, []);

  const togglePin = useCallback((id: string) => {
    setNotes((p) => p.map((n) => (n.id === id ? { ...n, pinned: !n.pinned } : n)));
  }, []);

  const deleteNote = useCallback((id: string) => {
    setNotes((p) => p.filter((n) => n.id !== id));
    setSelectedId((cur) => (cur === id ? null : cur));
  }, []);

  const copyNote = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      const id = window.setTimeout(() => setCopied(false), 1500);
      return () => window.clearTimeout(id);
    } catch { /* clipboard unavailable */ }
  }, []);

  const words = selected ? (selected.content.trim() ? selected.content.trim().split(/\s+/).length : 0) : 0;
  const chars = selected ? selected.content.length : 0;

  return (
    <div className="tool-view scroll-y quick-notes">
      <header className="view-header">
        <h1><Icon name="edit" /> Quick Notes</h1>
        <button className="quick-notes-new" style={btn} onClick={createNote}><Icon name="plus" size={14} /> New note</button>
      </header>

      <div className="quick-notes-body" style={{ display: 'flex', gap: 12, minHeight: 420, height: 'calc(100% - 60px)' }}>
        <aside className="quick-notes-sidebar" style={{ width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, ...btn, cursor: 'text' }}>
            <Icon name="search" size={14} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search notes"
              aria-label="Search notes"
              style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: 'inherit', font: 'inherit' }}
            />
            {query && (
              <button aria-label="Clear search" onClick={() => setQuery('')} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0 }}>
                <Icon name="x" size={12} />
              </button>
            )}
          </div>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort notes" style={{ ...btn }}>
            <option value="modified">Sort: Modified</option>
            <option value="created">Sort: Created</option>
            <option value="alpha">Sort: Alphabetical</option>
          </select>
          <div className="scroll-y quick-notes-list" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {notes.length === 0 && <div className="muted small" style={{ padding: 12 }}>No notes yet. Create one to get started.</div>}
            {notes.length > 0 && visible.length === 0 && <div className="muted small" style={{ padding: 12 }}>No notes match "{query}".</div>}
            {visible.map((n) => {
              const active = n.id === selectedId;
              const preview = n.content.split('\n').slice(1).join(' ').trim() || 'No additional text';
              return (
                <div
                  key={n.id}
                  className={'quick-notes-item' + (active ? ' quick-notes-item--active' : '')}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedId(n.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedId(n.id); } }}
                  style={{
                    padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                    border: '1px solid ' + (active ? 'var(--accent, #6aa9ff)' : 'transparent'),
                    background: active ? 'var(--bg-active, rgba(106,169,255,0.14))' : 'var(--bg-overlay, rgba(255,255,255,0.04))',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {n.pinned && <Icon name="pin" size={12} />}
                    <strong className="ellipsis" style={{ flex: 1, minWidth: 0 }}>{n.title}</strong>
                  </div>
                  <div className="muted small ellipsis">{preview}</div>
                  <div className="muted small" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Icon name="clock" size={11} /> {fmtTime(n.modifiedAt)}
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        <section className="quick-notes-editor" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {!selected ? (
            <div className="muted" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
              <Icon name="edit" size={32} />
              <div>{notes.length === 0 ? 'Jot down your first note' : 'Select a note to edit'}</div>
              <button style={btn} onClick={createNote}><Icon name="plus" size={14} /> New note</button>
            </div>
          ) : (
            <>
              <div className="quick-notes-toolbar" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button style={btn} onClick={() => togglePin(selected.id)} aria-pressed={selected.pinned}>
                  <Icon name="pin" size={14} /> {selected.pinned ? 'Unpin' : 'Pin'}
                </button>
                <button style={btn} onClick={() => copyNote(selected.content)} disabled={!selected.content}>
                  <Icon name={copied ? 'check' : 'copy'} size={14} /> {copied ? 'Copied' : 'Copy'}
                </button>
                <button style={btn} onClick={() => deleteNote(selected.id)}>
                  <Icon name="trash" size={14} /> Delete
                </button>
                <span className="muted small" style={{ marginLeft: 'auto' }}>Created {new Date(selected.createdAt).toLocaleString()}</span>
              </div>
              <textarea
                className="quick-notes-textarea"
                value={selected.content}
                onChange={(e) => updateContent(selected.id, e.target.value)}
                placeholder="Start typing..."
                autoFocus
                spellCheck
                style={{
                  flex: 1, minHeight: 260, resize: 'none', padding: 12, borderRadius: 8, font: 'inherit', lineHeight: 1.5,
                  color: 'inherit', background: 'var(--bg-overlay, rgba(255,255,255,0.04))', border: '1px solid var(--border, rgba(255,255,255,0.12))', outline: 'none',
                }}
              />
              <div className="quick-notes-footer muted small" style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                <span>{words} {words === 1 ? 'word' : 'words'}</span>
                <span>{chars} {chars === 1 ? 'character' : 'characters'}</span>
                <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Icon name="save" size={12} />
                  {savedAt ? `Auto-saved ${fmtTime(savedAt)}` : 'Saved'}
                </span>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
