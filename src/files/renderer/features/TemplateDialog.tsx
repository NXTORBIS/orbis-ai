import { useCallback, useEffect, useMemo, useState } from 'react';
import { call } from '../api';
import { closeDialog, toast, toastError } from '../state/app';
import { activePane, currentLocation, ws } from '../state/workspace';
import { useStore } from '../state/store';
import { Button, Dialog, TextField } from '../ui/components';
import { Icon } from '../ui/Icon';
import type { FileTemplate, TemplateCategory } from '../../shared/templates';

const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  code: 'Code',
  document: 'Document',
  config: 'Config',
  web: 'Web',
  data: 'Data',
  other: 'Other',
};

const CATEGORY_ICONS: Record<TemplateCategory, string> = {
  code: 'code',
  document: 'file',
  config: 'settings',
  web: 'globe',
  data: 'grid',
  other: 'file',
};

export function TemplatePickerDialog() {
  const pane = useStore(ws, activePane);
  const loc = currentLocation(pane);
  const dir = loc.kind === 'fs' ? loc.path : undefined;

  const [templates, setTemplates] = useState<FileTemplate[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<FileTemplate | null>(null);
  const [fileName, setFileName] = useState('');
  const [creating, setCreating] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editTemplate, setEditTemplate] = useState<Partial<FileTemplate>>({});
  const [previewContent, setPreviewContent] = useState('');

  const load = useCallback(async () => {
    try {
      const list = await call<FileTemplate[]>('template:list');
      setTemplates(list);
    } catch (err) {
      toastError(err);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    if (!search.trim()) return templates;
    const q = search.toLowerCase();
    return templates.filter((t) =>
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.category.toLowerCase().includes(q) ||
      t.ext.toLowerCase().includes(q),
    );
  }, [templates, search]);

  const grouped = useMemo(() => {
    const groups = new Map<TemplateCategory, FileTemplate[]>();
    for (const t of filtered) {
      const list = groups.get(t.category) ?? [];
      list.push(t);
      groups.set(t.category, list);
    }
    return groups;
  }, [filtered]);

  const selectTemplate = (t: FileTemplate) => {
    setSelected(t);
    const baseName = t.name.toLowerCase().replace(/\s+/g, '-');
    const ext = t.ext ? `.${t.ext}` : '';
    if (t.id === 'gitignore') setFileName('.gitignore');
    else if (t.id === 'dockerfile') setFileName('Dockerfile');
    else setFileName(`${baseName}${ext}`);
    setPreviewContent(t.content);
  };

  const handleCreate = async () => {
    if (!dir || !selected || !fileName.trim()) return;
    setCreating(true);
    try {
      await call<{ path: string }>('template:create', { dir, templateId: selected.id, fileName: fileName.trim() });
      toast({ level: 'success', title: `Created ${fileName.trim()}` });
      closeDialog();
    } catch (err) {
      toastError(err);
    } finally {
      setCreating(false);
    }
  };

  const handleSaveCustom = async () => {
    if (!editTemplate.name || !editTemplate.content) return;
    try {
      const id = editTemplate.id || `custom-${Date.now().toString(36)}`;
      await call('template:save', {
        template: {
          id,
          name: editTemplate.name,
          ext: editTemplate.ext ?? '',
          category: editTemplate.category ?? ('other' as TemplateCategory),
          content: editTemplate.content,
          description: editTemplate.description ?? '',
        },
      });
      toast({ level: 'success', title: 'Template saved' });
      setEditMode(false);
      setEditTemplate({});
      void load();
    } catch (err) {
      toastError(err);
    }
  };

  const handleDeleteCustom = async (id: string) => {
    try {
      await call('template:delete', { id });
      toast({ level: 'success', title: 'Template deleted' });
      if (selected?.id === id) setSelected(null);
      void load();
    } catch (err) {
      toastError(err);
    }
  };

  const startEdit = (t?: FileTemplate) => {
    setEditMode(true);
    if (t) {
      setEditTemplate({ ...t });
    } else {
      setEditTemplate({ name: '', ext: '', category: 'other', content: '', description: '' });
    }
  };

  if (!dir) {
    return (
      <Dialog title="New from template" onClose={closeDialog}>
        <p className="muted">Navigate to a folder first.</p>
      </Dialog>
    );
  }

  if (editMode) {
    return (
      <Dialog title={editTemplate.id ? 'Edit template' : 'Create custom template'} onClose={() => setEditMode(false)} width={600}>
        <div className="template-edit-form">
          <TextField label="Name" value={editTemplate.name ?? ''} onChange={(e) => setEditTemplate((p) => ({ ...p, name: e.target.value }))} autoFocus />
          <TextField label="Extension" value={editTemplate.ext ?? ''} onChange={(e) => setEditTemplate((p) => ({ ...p, ext: e.target.value }))} placeholder="ts" />
          <TextField label="Description" value={editTemplate.description ?? ''} onChange={(e) => setEditTemplate((p) => ({ ...p, description: e.target.value }))} />
          <div className="template-category-select">
            <label className="batchdate-label">Category</label>
            <select value={editTemplate.category ?? 'other'} onChange={(e) => setEditTemplate((p) => ({ ...p, category: e.target.value as TemplateCategory }))}>
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="template-content-edit">
            <label className="batchdate-label">Content</label>
            <textarea
              className="template-textarea"
              value={editTemplate.content ?? ''}
              onChange={(e) => setEditTemplate((p) => ({ ...p, content: e.target.value }))}
              rows={12}
              placeholder="Template content. Use {{name}}, {{date}}, {{author}}, {{year}} as variables."
            />
          </div>
          <p className="muted small">{'Variables: {{name}}, {{date}}, {{author}}, {{year}}'}</p>
          <div className="template-edit-actions">
            <Button onClick={() => setEditMode(false)}>Cancel</Button>
            <Button variant="primary" onClick={handleSaveCustom} disabled={!editTemplate.name?.trim() || !editTemplate.content?.trim()}>Save template</Button>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title="New from template" onClose={closeDialog} width={720}>
      <div className="template-dialog">
        <div className="template-sidebar">
          <div className="template-search">
            <TextField value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search templates..." autoFocus />
          </div>
          <div className="template-grid scroll-y">
            {Array.from(grouped.entries()).map(([cat, items]) => (
              <div key={cat} className="template-group">
                <h3 className="template-group-title"><Icon name={CATEGORY_ICONS[cat]} size={14} /> {CATEGORY_LABELS[cat]}</h3>
                {items.map((t) => (
                  <button
                    key={t.id}
                    className={`template-card ${selected?.id === t.id ? 'selected' : ''}`}
                    onClick={() => selectTemplate(t)}
                    type="button"
                  >
                    <span className="template-card-name">{t.name}</span>
                    <span className="template-card-desc muted small">{t.description}</span>
                    {t.custom && (
                      <span className="template-card-actions" onClick={(e) => e.stopPropagation()}>
                        <Button size="sm" variant="ghost" onClick={() => startEdit(t)}>Edit</Button>
                        <Button size="sm" variant="danger" onClick={() => handleDeleteCustom(t.id)}>Delete</Button>
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="template-custom-btn">
            <Button size="sm" variant="ghost" onClick={() => startEdit()}>Save as custom template</Button>
          </div>
        </div>

        {selected && (
          <div className="template-detail">
            <div className="template-filename">
              <TextField label="File name" value={fileName} onChange={(e) => setFileName(e.target.value)} />
            </div>
            <div className="template-preview scroll-y">
              <pre className="template-preview-code mono small">{previewContent}</pre>
            </div>
            <div className="template-create-actions">
              <Button variant="primary" onClick={handleCreate} disabled={creating || !fileName.trim()}>
                {creating ? 'Creating...' : 'Create file'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
