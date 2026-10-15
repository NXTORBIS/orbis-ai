import { useCallback, useEffect, useState } from 'react';
import { call } from '../api';
import { toast, toastError } from '../state/app';
import { Button } from '../ui/components';
import { Icon } from '../ui/Icon';

interface FileNote { id: string; path: string; note: string; color: string | null; createdMs: number; updatedMs: number }

const NOTE_COLORS = [
  { id: 'yellow', value: '#f5c542' },
  { id: 'green', value: '#4caf50' },
  { id: 'blue', value: '#2196f3' },
  { id: 'red', value: '#f44336' },
  { id: 'purple', value: '#9c27b0' },
  { id: 'orange', value: '#ff9800' },
];

export interface FileNotePanelProps {
  path: string;
  onClose: () => void;
}

export function FileNotePanel({ path, onClose }: FileNotePanelProps) {
  const [note, setNote] = useState('');
  const [color, setColor] = useState<string>(NOTE_COLORS[0]!.value);
  const [existingNote, setExistingNote] = useState<FileNote | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    void call<FileNote | null>('note:get', { path }).then((n) => {
      setExistingNote(n ?? null);
      if (n) {
        setNote(n.note);
        setColor(n.color ?? NOTE_COLORS[0]!.value);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [path]);

  const save = useCallback(async () => {
    if (!note.trim()) return;
    try {
      await call('note:set', { path, note: note.trim(), color });
      toast({ level: 'success', title: 'Note saved' });
      onClose();
    } catch (err) {
      toastError(err, 'Failed to save note');
    }
  }, [path, note, color, onClose]);

  const remove = useCallback(async () => {
    try {
      await call('note:delete', { path });
      toast({ level: 'info', title: 'Note deleted' });
      onClose();
    } catch (err) {
      toastError(err, 'Failed to delete note');
    }
  }, [path, onClose]);

  const fileName = path.split(/[\\/]/).pop() ?? path;

  if (loading) return <div className="note-panel"><div className="note-panel-loading">Loading...</div></div>;

  return (
    <div className="note-panel">
      <div className="note-panel-header">
        <h3><Icon name="edit" size={14} /> Note on {fileName}</h3>
        <button className="note-close-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={14} /></button>
      </div>
      <textarea
        className="note-textarea"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Add a note about this file..."
        rows={6}
        autoFocus
      />
      <div className="note-color-picker">
        <span className="note-color-label">Color:</span>
        {NOTE_COLORS.map((c) => (
          <button
            key={c.id}
            className={`note-color-swatch${color === c.value ? ' note-color-active' : ''}`}
            style={{ backgroundColor: c.value }}
            onClick={() => setColor(c.value)}
            aria-label={c.id}
          />
        ))}
      </div>
      <div className="note-panel-actions">
        <Button size="sm" variant="primary" onClick={save} disabled={!note.trim()}>
          <Icon name="save" size={14} /> Save
        </Button>
        {existingNote && (
          <Button size="sm" onClick={remove}>
            <Icon name="trash" size={14} /> Delete
          </Button>
        )}
        <Button size="sm" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
}

/** Small indicator dot for files that have notes. */
export function NoteIndicator({ path }: { path: string }) {
  const [note, setNote] = useState<FileNote | null>(null);

  useEffect(() => {
    void call<FileNote | null>('note:get', { path }).then((n) => setNote(n ?? null)).catch(() => null);
  }, [path]);

  if (!note) return null;
  return (
    <span
      className="note-indicator"
      style={{ backgroundColor: note.color ?? NOTE_COLORS[0]!.value }}
      title={note.note.slice(0, 100)}
    />
  );
}

/** Note search dialog content */
export function NoteSearchPanel() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FileNote[]>([]);
  const [allNotes, setAllNotes] = useState<FileNote[]>([]);

  useEffect(() => {
    void call<FileNote[]>('note:list', {}).then(setAllNotes).catch(() => []);
  }, []);

  const search = useCallback(async () => {
    if (!query.trim()) {
      setResults(allNotes);
      return;
    }
    try {
      const res = await call<FileNote[]>('note:search', { text: query });
      setResults(res);
    } catch (err) {
      toastError(err, 'Search failed');
    }
  }, [query, allNotes]);

  useEffect(() => {
    if (!query.trim()) setResults(allNotes);
  }, [allNotes, query]);

  return (
    <div className="note-search-panel">
      <h3>File Notes</h3>
      <div className="note-search-bar">
        <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search notes..." onKeyDown={(e) => { if (e.key === 'Enter') search(); }} />
        <Button size="sm" onClick={search}><Icon name="search" size={14} /></Button>
      </div>
      <div className="note-search-results">
        {results.length === 0 && <div className="note-empty">No notes found</div>}
        {results.map((n) => (
          <div key={n.id} className="note-search-item">
            <span className="note-indicator-inline" style={{ backgroundColor: n.color ?? NOTE_COLORS[0]!.value }} />
            <div className="note-search-item-content">
              <div className="note-search-path">{n.path.split(/[\\/]/).pop()}</div>
              <div className="note-search-text">{n.note.slice(0, 200)}</div>
              <div className="note-search-path-full">{n.path}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
