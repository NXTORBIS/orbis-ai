import { useState, useMemo, useCallback } from 'react';
import { Icon } from '../../ui/Icon';

interface TagItem {
  id: string;
  name: string;
  color: string;
  group: string;
  createdAt: number;
}

type SortKey = 'name' | 'count' | 'date';

const now = Date.now();
const INITIAL_TAGS: TagItem[] = [
  { id: 't1', name: 'Important', color: '#ef4444', group: 'Priority', createdAt: now - 5 * 86400000 },
  { id: 't2', name: 'Work', color: '#3b82f6', group: 'Category', createdAt: now - 4 * 86400000 },
  { id: 't3', name: 'Personal', color: '#8b5cf6', group: 'Category', createdAt: now - 3 * 86400000 },
  { id: 't4', name: 'Archive', color: '#6b7280', group: 'Status', createdAt: now - 2 * 86400000 },
  { id: 't5', name: 'Review', color: '#f59e0b', group: 'Priority', createdAt: now - 1 * 86400000 },
];

const DEFAULT_GROUPS = ['Priority', 'Category', 'Status'];

let idCounter = 100;
const nextId = () => `t${++idCounter}`;

export function TagManagerView() {
  const [tags, setTags] = useState<TagItem[]>(INITIAL_TAGS);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [groupFilter, setGroupFilter] = useState('all');
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#10b981');
  const [newGroup, setNewGroup] = useState('Category');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('#000000');
  const [editGroup, setEditGroup] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [mergeSel, setMergeSel] = useState<string[]>([]);
  const [mergeTarget, setMergeTarget] = useState<string | null>(null);
  const [confirmUnused, setConfirmUnused] = useState(false);
  const [message, setMessage] = useState('');

  // No backend: file counts are unknown, so every tag is treated as unused-unknown.
  const fileCount = (_t: TagItem): number | null => null;

  const groups = useMemo(() => {
    const set = new Set<string>(DEFAULT_GROUPS);
    tags.forEach((t) => set.add(t.group));
    return Array.from(set).sort();
  }, [tags]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = tags.filter(
      (t) =>
        (groupFilter === 'all' || t.group === groupFilter) &&
        (!q || t.name.toLowerCase().includes(q) || t.group.toLowerCase().includes(q)),
    );
    list.sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name);
      if (sortKey === 'date') return b.createdAt - a.createdAt;
      return (fileCount(b) ?? 0) - (fileCount(a) ?? 0) || a.name.localeCompare(b.name);
    });
    return list;
  }, [tags, query, groupFilter, sortKey]);

  const nameTaken = useCallback(
    (name: string, exceptId?: string) =>
      tags.some((t) => t.id !== exceptId && t.name.toLowerCase() === name.trim().toLowerCase()),
    [tags],
  );

  const createTag = useCallback(() => {
    const name = newName.trim();
    if (!name) return setMessage('Enter a tag name.');
    if (nameTaken(name)) return setMessage(`A tag named "${name}" already exists.`);
    setTags((prev) => [...prev, { id: nextId(), name, color: newColor, group: newGroup.trim() || 'Ungrouped', createdAt: Date.now() }]);
    setNewName('');
    setMessage(`Created "${name}".`);
  }, [newName, newColor, newGroup, nameTaken]);

  const startEdit = (t: TagItem) => {
    setEditingId(t.id);
    setEditName(t.name);
    setEditColor(t.color);
    setEditGroup(t.group);
    setConfirmDeleteId(null);
  };

  const saveEdit = useCallback(() => {
    const name = editName.trim();
    if (!editingId) return;
    if (!name) return setMessage('Tag name cannot be empty.');
    if (nameTaken(name, editingId)) return setMessage(`A tag named "${name}" already exists.`);
    setTags((prev) =>
      prev.map((t) => (t.id === editingId ? { ...t, name, color: editColor, group: editGroup.trim() || 'Ungrouped' } : t)),
    );
    setEditingId(null);
    setMessage(`Saved "${name}".`);
  }, [editingId, editName, editColor, editGroup, nameTaken]);

  const deleteTag = useCallback((id: string) => {
    setTags((prev) => prev.filter((t) => t.id !== id));
    setMergeSel((prev) => prev.filter((x) => x !== id));
    setConfirmDeleteId(null);
    setMessage('Tag deleted.');
  }, []);

  const toggleMerge = (id: string) => {
    setMergeSel((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      return prev.length >= 2 ? [prev[1]!, id] : [...prev, id];
    });
    setMergeTarget(null);
  };

  const mergePair = useMemo(() => mergeSel.map((id) => tags.find((t) => t.id === id)).filter(Boolean) as TagItem[], [mergeSel, tags]);

  const doMerge = useCallback(() => {
    if (mergePair.length !== 2) return;
    const target = mergePair.find((t) => t.id === mergeTarget) ?? mergePair[0]!;
    const source = mergePair.find((t) => t.id !== target!.id)!;
    setTags((prev) => prev.filter((t) => t.id !== source.id));
    setMergeSel([]);
    setMergeTarget(null);
    setMessage(`Merged "${source.name}" into "${target.name}".`);
  }, [mergePair, mergeTarget]);

  // File counts are unavailable, so "unused" means a count of exactly 0; none can be proven here.
  const unusedTags = useMemo(() => tags.filter((t) => fileCount(t) === 0), [tags]);

  const deleteUnused = useCallback(() => {
    const ids = new Set(unusedTags.map((t) => t.id));
    setTags((prev) => prev.filter((t) => !ids.has(t.id)));
    setMergeSel((prev) => prev.filter((x) => !ids.has(x)));
    setConfirmUnused(false);
    setMessage(`Removed ${ids.size} unused tag${ids.size === 1 ? '' : 's'}.`);
  }, [unusedTags]);

  return (
    <div className="tool-view scroll-y tag-manager">
      <header className="view-header">
        <h1><Icon name="tag" /> Tag Manager</h1>
        <span className="tag-mgr-total">{tags.length} tag{tags.length === 1 ? '' : 's'}</span>
      </header>

      <div className="tag-mgr-toolbar">
        <div className="tag-mgr-search">
          <Icon name="search" size={14} />
          <input
            type="text"
            placeholder="Search tags or groups..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search tags"
          />
          {query && (
            <button type="button" className="tag-mgr-icon-btn" onClick={() => setQuery('')} aria-label="Clear search">
              <Icon name="x" size={12} />
            </button>
          )}
        </div>
        <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} aria-label="Filter by group">
          <option value="all">All groups</option>
          {groups.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} aria-label="Sort tags">
          <option value="name">Sort: Alphabetical</option>
          <option value="count">Sort: File count</option>
          <option value="date">Sort: Newest first</option>
        </select>
      </div>

      <section className="tag-mgr-create">
        <h2>Create tag</h2>
        <div className="tag-mgr-form">
          <input
            type="color"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            aria-label="Tag color"
          />
          <input
            type="text"
            placeholder="Tag name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && createTag()}
          />
          <input
            type="text"
            list="tag-mgr-groups"
            placeholder="Group"
            value={newGroup}
            onChange={(e) => setNewGroup(e.target.value)}
          />
          <datalist id="tag-mgr-groups">
            {groups.map((g) => <option key={g} value={g} />)}
          </datalist>
          <button type="button" className="tag-mgr-btn primary" onClick={createTag}>
            <Icon name="plus" size={14} /> Add
          </button>
        </div>
      </section>

      <div className="tag-mgr-bulk">
        {confirmUnused ? (
          <>
            <span>Delete {unusedTags.length} unused tag{unusedTags.length === 1 ? '' : 's'}?</span>
            <button type="button" className="tag-mgr-btn danger" onClick={deleteUnused}><Icon name="check" size={14} /> Confirm</button>
            <button type="button" className="tag-mgr-btn" onClick={() => setConfirmUnused(false)}><Icon name="x" size={14} /> Cancel</button>
          </>
        ) : (
          <button
            type="button"
            className="tag-mgr-btn"
            disabled={unusedTags.length === 0}
            title={unusedTags.length === 0 ? 'No unused tags detected (file counts unavailable)' : undefined}
            onClick={() => setConfirmUnused(true)}
          >
            <Icon name="trash" size={14} /> Delete unused tags ({unusedTags.length})
          </button>
        )}
        {message && <span className="tag-mgr-message" role="status">{message}</span>}
      </div>

      {mergePair.length > 0 && (
        <section className="tag-mgr-merge">
          <Icon name="merge" size={14} />
          {mergePair.length < 2 ? (
            <span>Select one more tag to merge with "{mergePair[0]!.name}".</span>
          ) : (
            <>
              <span>Merge into:</span>
              {mergePair.map((t) => (
                <label key={t.id} className="tag-mgr-radio">
                  <input
                    type="radio"
                    name="tag-mgr-merge-target"
                    checked={(mergeTarget ?? mergePair[0]!.id) === t.id}
                    onChange={() => setMergeTarget(t.id)}
                  />
                  <span className="tag-mgr-dot" style={{ background: t.color }} />
                  {t.name}
                </label>
              ))}
              <button type="button" className="tag-mgr-btn primary" onClick={doMerge}>
                <Icon name="merge" size={14} /> Merge
              </button>
            </>
          )}
          <button type="button" className="tag-mgr-btn" onClick={() => { setMergeSel([]); setMergeTarget(null); }}>
            <Icon name="x" size={14} /> Clear
          </button>
        </section>
      )}

      <table className="tag-mgr-table">
        <thead>
          <tr>
            <th aria-label="Select for merge" />
            <th>Tag</th>
            <th>Group</th>
            <th>Files</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((t) =>
            editingId === t.id ? (
              <tr key={t.id} className="tag-mgr-row editing">
                <td />
                <td>
                  <div className="tag-mgr-form">
                    <input type="color" value={editColor} onChange={(e) => setEditColor(e.target.value)} aria-label="Edit color" />
                    <input
                      type="text"
                      value={editName}
                      autoFocus
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditingId(null); }}
                    />
                  </div>
                </td>
                <td>
                  <input type="text" list="tag-mgr-groups" value={editGroup} onChange={(e) => setEditGroup(e.target.value)} />
                </td>
                <td>--</td>
                <td className="tag-mgr-actions">
                  <button type="button" className="tag-mgr-icon-btn" onClick={saveEdit} aria-label="Save"><Icon name="check" size={14} /></button>
                  <button type="button" className="tag-mgr-icon-btn" onClick={() => setEditingId(null)} aria-label="Cancel"><Icon name="x" size={14} /></button>
                </td>
              </tr>
            ) : (
              <tr key={t.id} className={`tag-mgr-row${mergeSel.includes(t.id) ? ' selected' : ''}`}>
                <td>
                  <input
                    type="checkbox"
                    checked={mergeSel.includes(t.id)}
                    onChange={() => toggleMerge(t.id)}
                    aria-label={`Select ${t.name} for merge`}
                  />
                </td>
                <td>
                  <span className="tag-mgr-dot" style={{ background: t.color }} />
                  <span className="tag-mgr-name">{t.name}</span>
                </td>
                <td><span className="tag-mgr-group">{t.group}</span></td>
                <td>{fileCount(t) ?? '--'}</td>
                <td className="tag-mgr-actions">
                  {confirmDeleteId === t.id ? (
                    <>
                      <span>Delete?</span>
                      <button type="button" className="tag-mgr-icon-btn danger" onClick={() => deleteTag(t.id)} aria-label="Confirm delete"><Icon name="check" size={14} /></button>
                      <button type="button" className="tag-mgr-icon-btn" onClick={() => setConfirmDeleteId(null)} aria-label="Cancel delete"><Icon name="x" size={14} /></button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="tag-mgr-icon-btn" onClick={() => startEdit(t)} aria-label={`Edit ${t.name}`} title="Edit"><Icon name="edit" size={14} /></button>
                      <button type="button" className="tag-mgr-icon-btn" onClick={() => { setNewName(`${t.name} copy`); setNewColor(t.color); setNewGroup(t.group); }} aria-label={`Duplicate ${t.name}`} title="Use as template"><Icon name="copy" size={14} /></button>
                      <button type="button" className="tag-mgr-icon-btn" onClick={() => setConfirmDeleteId(t.id)} aria-label={`Delete ${t.name}`} title="Delete"><Icon name="trash" size={14} /></button>
                    </>
                  )}
                </td>
              </tr>
            ),
          )}
          {visible.length === 0 && (
            <tr><td colSpan={5} className="tag-mgr-empty">No tags match.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
