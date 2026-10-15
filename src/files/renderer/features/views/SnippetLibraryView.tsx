import { useCallback, useEffect, useMemo, useState } from 'react';
import { call } from '../../api';
import { EmptyState, IconButton, TextField } from '../../ui/components';
import { toast, toastError } from '../../state/app';
import type { Snippet } from '../../../shared/snippets';

export function SnippetLibraryView() {
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [editing, setEditing] = useState<Snippet | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await call<Snippet[]>('snippet:list');
      setSnippets(list);
    } catch (e) { toastError(e); }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const s of snippets) for (const t of s.tags) set.add(t);
    return Array.from(set).sort();
  }, [snippets]);

  const filtered = useMemo(() => {
    let list = snippets;
    if (tagFilter) list = list.filter((s) => s.tags.includes(tagFilter));
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((s) => s.title.toLowerCase().includes(q) || s.content.toLowerCase().includes(q) || s.tags.some((t) => t.toLowerCase().includes(q)));
    }
    return list;
  }, [snippets, search, tagFilter]);

  const handleCopy = useCallback(async (snippet: Snippet) => {
    await call('fs:copyText', { text: snippet.content });
    toast({ level: 'success', title: 'Copied to clipboard' });
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await call('snippet:delete', { id });
      await load();
    } catch (e) { toastError(e); }
  }, [load]);

  const handleExport = useCallback(async () => {
    try {
      const data = await call<unknown>('snippet:export');
      const json = JSON.stringify(data, null, 2);
      await call('fs:copyText', { text: json });
      toast({ level: 'success', title: 'Snippets exported to clipboard as JSON' });
    } catch (e) { toastError(e); }
  }, []);

  const handleImport = useCallback(async () => {
    try {
      const result = await call<{ path: string } | null>('fs:pickFile', { title: 'Import snippets JSON' });
      if (!result) return;
      const fileData = await call<{ text: string }>('fs:readText', { path: (result as { path: string }).path, maxBytes: 10 * 1024 * 1024 });
      const parsed = JSON.parse((fileData as { text: string }).text) as unknown;
      await call('snippet:import', { data: parsed });
      await load();
      toast({ level: 'success', title: 'Snippets imported' });
    } catch (e) { toastError(e); }
  }, [load]);

  if (loading) return <div className="tool-view scroll-y"><div className="pad"><p className="muted">Loading snippets…</p></div></div>;

  return (
    <div className="tool-view scroll-y snippet-library">
      <header className="view-header">
        <h1>Snippet Library</h1>
        <div className="tb-group">
          <IconButton icon="add" label="New snippet" onClick={() => { setCreating(true); setEditing(null); }} />
          <IconButton icon="import" label="Import" onClick={handleImport} />
          <IconButton icon="external" label="Export to clipboard" onClick={handleExport} />
        </div>
      </header>

      <div className="snippet-controls pad">
        <TextField value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search snippets…" autoFocus={false} />
        {allTags.length > 0 && (
          <div className="snippet-tags">
            <button type="button" className={`btn btn-xs ${tagFilter === null ? 'btn-default' : 'btn-ghost'}`} onClick={() => setTagFilter(null)}>All</button>
            {allTags.map((t) => (
              <button key={t} type="button" className={`btn btn-xs ${tagFilter === t ? 'btn-default' : 'btn-ghost'}`} onClick={() => setTagFilter(tagFilter === t ? null : t)}>{t}</button>
            ))}
          </div>
        )}
      </div>

      {(creating || editing) && (
        <SnippetEditor
          snippet={editing}
          onSave={async (data) => {
            try {
              if (editing) {
                await call('snippet:update', { id: editing.id, ...data });
              } else {
                await call('snippet:create', data);
              }
              setEditing(null);
              setCreating(false);
              await load();
            } catch (e) { toastError(e); }
          }}
          onCancel={() => { setEditing(null); setCreating(false); }}
        />
      )}

      {filtered.length === 0 && !creating && !editing ? (
        <EmptyState icon="code" title={snippets.length ? 'No matching snippets' : 'No snippets yet'} body={snippets.length ? 'Try a different search or tag.' : 'Create one with the + button above.'} />
      ) : (
        <div className="snippet-list">
          {filtered.map((s) => (
            <div key={s.id} className="snippet-card">
              <div className="snippet-card-header">
                <span className="snippet-title ellipsis">{s.title}</span>
                {s.language && <span className="snippet-lang">{s.language}</span>}
                <div className="snippet-actions">
                  <IconButton icon="copy" label="Copy" onClick={() => void handleCopy(s)} />
                  <IconButton icon="edit" label="Edit" onClick={() => { setEditing(s); setCreating(false); }} />
                  <IconButton icon="deleteForever" label="Delete" onClick={() => void handleDelete(s.id)} />
                </div>
              </div>
              <pre className="snippet-content mono">{s.content.length > 500 ? s.content.slice(0, 500) + '…' : s.content}</pre>
              {s.tags.length > 0 && (
                <div className="snippet-tag-list">
                  {s.tags.map((t) => <span key={t} className="snippet-tag" onClick={() => setTagFilter(t)}>{t}</span>)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SnippetEditor({ snippet, onSave, onCancel }: { snippet: Snippet | null; onSave: (data: { title: string; content: string; language?: string; tags?: string[] }) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(snippet?.title ?? '');
  const [content, setContent] = useState(snippet?.content ?? '');
  const [language, setLanguage] = useState(snippet?.language ?? '');
  const [tagsStr, setTagsStr] = useState(snippet?.tags.join(', ') ?? '');

  const valid = title.trim() && content.trim();

  return (
    <div className="snippet-editor pad">
      <h3>{snippet ? 'Edit snippet' : 'New snippet'}</h3>
      <label className="field-label">Title
        <input type="text" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Snippet title" autoFocus />
      </label>
      <label className="field-label">Language
        <input type="text" className="input" value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="e.g. javascript, python, sql" />
      </label>
      <label className="field-label">Tags (comma-separated)
        <input type="text" className="input" value={tagsStr} onChange={(e) => setTagsStr(e.target.value)} placeholder="e.g. utility, react, api" />
      </label>
      <label className="field-label">Content
        <textarea className="input snippet-textarea mono" value={content} onChange={(e) => setContent(e.target.value)} rows={10} placeholder="Paste your snippet here…" />
      </label>
      <div className="tb-group">
        <button type="button" className="btn btn-accent" disabled={!valid} onClick={() => {
          const tags = tagsStr.split(',').map((t) => t.trim()).filter(Boolean);
          onSave({ title: title.trim(), content, language: language.trim() || undefined, tags: tags.length ? tags : undefined });
        }}>Save</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
