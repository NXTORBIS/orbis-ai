import { useCallback, useEffect, useMemo, useState } from 'react';
import { call } from '../../api';
import { EmptyState, IconButton, TextField } from '../../ui/components';
import { toast, toastError } from '../../state/app';
import type { Macro, MacroStep } from '../../../shared/macros';
import { listMacros, createMacro, updateMacro, deleteMacro, playbackMacro } from '../../state/macros';

const STEP_TYPES: MacroStep['type'][] = ['copy', 'move', 'rename', 'create'];

function StepEditor({ step, onChange, onRemove }: { step: MacroStep; onChange: (s: MacroStep) => void; onRemove: () => void }) {
  return (
    <div className="macro-step">
      <select value={step.type} onChange={(e) => onChange({ ...step, type: e.target.value as MacroStep['type'] })}>
        {STEP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <input
        type="text" placeholder="Source name" value={step.sourceName}
        onChange={(e) => onChange({ ...step, sourceName: e.target.value })}
      />
      {(step.type === 'copy' || step.type === 'move' || step.type === 'rename') && (
        <input
          type="text" placeholder="Destination name" value={step.destName ?? ''}
          onChange={(e) => onChange({ ...step, destName: e.target.value || undefined })}
        />
      )}
      {step.type === 'create' && (
        <select value={step.template ?? 'empty'} onChange={(e) => onChange({ ...step, template: e.target.value as MacroStep['template'] })}>
          <option value="empty">Empty</option>
          <option value="text">Text</option>
          <option value="markdown">Markdown</option>
          <option value="json">JSON</option>
        </select>
      )}
      <IconButton icon="close" label="Remove step" onClick={onRemove} />
    </div>
  );
}

function MacroEditor({ macro, onSave, onCancel }: { macro?: Macro; onSave: () => void; onCancel: () => void }) {
  const [name, setName] = useState(macro?.name ?? '');
  const [description, setDescription] = useState(macro?.description ?? '');
  const [steps, setSteps] = useState<MacroStep[]>(macro?.steps ?? [{ type: 'copy', sourceName: '' }]);
  const [saving, setSaving] = useState(false);

  const addStep = () => setSteps([...steps, { type: 'copy', sourceName: '' }]);
  const updateStep = (i: number, s: MacroStep) => { const next = [...steps]; next[i] = s; setSteps(next); };
  const removeStep = (i: number) => setSteps(steps.filter((_, j) => j !== i));

  const handleSave = async () => {
    if (!name.trim() || !steps.length || steps.some((s) => !s.sourceName.trim())) {
      toast({ level: 'warning', title: 'Name and at least one step with a source are required.' });
      return;
    }
    setSaving(true);
    try {
      if (macro) {
        await updateMacro({ id: macro.id, name: name.trim(), description: description.trim(), steps });
      } else {
        await createMacro({ name: name.trim(), description: description.trim(), steps });
      }
      toast({ level: 'success', title: macro ? 'Macro updated' : 'Macro created' });
      onSave();
    } catch (e) { toastError(e); }
    setSaving(false);
  };

  return (
    <div className="macro-editor pad">
      <div className="field-row">
        <label>Name</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Macro name" />
      </div>
      <div className="field-row">
        <label>Description</label>
        <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional description" />
      </div>
      <h3>Steps</h3>
      {steps.map((step, i) => (
        <StepEditor key={i} step={step} onChange={(s) => updateStep(i, s)} onRemove={() => removeStep(i)} />
      ))}
      <button type="button" className="btn btn-ghost" onClick={addStep}>+ Add step</button>
      <div className="tb-group" style={{ marginTop: 'var(--sp-4)' }}>
        <button type="button" className="btn btn-primary" disabled={saving} onClick={handleSave}>{macro ? 'Update' : 'Create'}</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export function MacroView() {
  const [macros, setMacros] = useState<Macro[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Macro | null>(null);
  const [creating, setCreating] = useState(false);
  const load = useCallback(async () => {
    try {
      const list = await listMacros();
      setMacros(list);
    } catch (e) { toastError(e); }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    if (!search.trim()) return macros;
    const q = search.toLowerCase();
    return macros.filter((m) => m.name.toLowerCase().includes(q) || m.description.toLowerCase().includes(q));
  }, [macros, search]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteMacro(id);
      await load();
    } catch (e) { toastError(e); }
  }, [load]);

  const handlePlayback = useCallback(async (macroId: string) => {
    try {
      const result = await call<string | null>('fs:pickDirectory', { title: 'Select target folder for playback' });
      if (!result) return;
      const res = await playbackMacro(macroId, result);
      const errors = res.results.filter((r) => r.status === 'error');
      if (errors.length) {
        toast({ level: 'warning', title: `Playback completed with ${errors.length} error(s)` });
      } else {
        toast({ level: 'success', title: `Playback completed: ${res.results.length} step(s) executed` });
      }
    } catch (e) { toastError(e); }
  }, []);

  if (loading) return <div className="tool-view scroll-y"><div className="pad"><p className="muted">Loading macros...</p></div></div>;
  if (creating) return <div className="tool-view scroll-y"><header className="view-header"><h1>New Macro</h1></header><MacroEditor onSave={() => { setCreating(false); void load(); }} onCancel={() => setCreating(false)} /></div>;
  if (editing) return <div className="tool-view scroll-y"><header className="view-header"><h1>Edit Macro</h1></header><MacroEditor macro={editing} onSave={() => { setEditing(null); void load(); }} onCancel={() => setEditing(null)} /></div>;

  return (
    <div className="tool-view scroll-y macro-view">
      <header className="view-header">
        <h1>Macro Recorder</h1>
        <div className="tb-group">
          <IconButton icon="plus" label="New macro" onClick={() => setCreating(true)} />
        </div>
      </header>
      <div className="pad">
        <TextField value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search macros..." />
        {!filtered.length ? (
          <EmptyState icon="activity" title="No macros" body={macros.length ? 'No macros match your search.' : 'Record file operation sequences and play them back on different targets.'} />
        ) : (
          <div className="macro-list">
            {filtered.map((m) => (
              <div key={m.id} className="macro-item glass-card">
                <div className="macro-item-header">
                  <strong>{m.name}</strong>
                  <span className="muted small">{m.steps.length} step{m.steps.length !== 1 ? 's' : ''}</span>
                </div>
                {m.description && <p className="muted small">{m.description}</p>}
                <div className="macro-steps-summary">
                  {m.steps.map((s, i) => (
                    <span key={i} className="macro-step-badge">{s.type}: {s.sourceName}</span>
                  ))}
                </div>
                <div className="tb-group">
                  <IconButton icon="play" label="Play" onClick={() => handlePlayback(m.id)} />
                  <IconButton icon="edit" label="Edit" onClick={() => setEditing(m)} />
                  <IconButton icon="trash" label="Delete" onClick={() => handleDelete(m.id)} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
