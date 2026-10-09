import React, { useState, useEffect } from 'react';
import { base44 } from '../api/base44Client.js';
import { ResearchHeader, Card, AIPanel, useAIExplain, SciTable, downloadFile } from '../research.jsx';
import { Button } from '../ui/button.jsx';
import { Save, Copy, Trash2, Download, Loader2, FlaskConical } from 'lucide-react';

// Scientific laboratory notebook backed by the ExperimentRecord entity.
// Save full reproducible configurations (parameters, results, method, seed,
// runtime) and re-run / duplicate / export experiments.

export default function ResearchNotebook() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ experiment_name: '', lab: 'physics', hypothesis: '', parameters: '{}', results: '{}', observations: '', method: '', seed: '', tags: '' });
  const [saving, setSaving] = useState(false);
  const { explain, explaining, output } = useAIExplain();

  const load = async () => { setLoading(true); try { const r = await base44.entities.ExperimentRecord.list('-created_date', 50); setRecords(r); } catch (e) { console.error(e); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.experiment_name) return;
    setSaving(true);
    try {
      const payload = {
        experiment_name: form.experiment_name, lab: form.lab, hypothesis: form.hypothesis,
        parameters: safeParse(form.parameters), results: safeParse(form.results),
        observations: form.observations, method: form.method, seed: form.seed,
        tags: form.tags ? form.tags.split(',').map((t) => t.trim()) : [],
      };
      await base44.entities.ExperimentRecord.create(payload);
      setForm({ experiment_name: '', lab: 'physics', hypothesis: '', parameters: '{}', results: '{}', observations: '', method: '', seed: '', tags: '' });
      await load();
    } catch (e) { console.error(e); } finally { setSaving(false); }
  };
  const duplicate = async (r) => { setSaving(true); try { await base44.entities.ExperimentRecord.create({ ...r, experiment_name: r.experiment_name + ' (copy)', id: undefined, created_date: undefined, updated_date: undefined, created_by_id: undefined }); await load(); } finally { setSaving(false); } };
  const remove = async (id) => { await base44.entities.ExperimentRecord.delete(id); await load(); };
  const exportRec = (r) => downloadFile(JSON.stringify(r, null, 2), `${r.experiment_name.replace(/\s+/g, '_')}.json`, 'application/json');

  return (
    <div className="space-y-4">
      <ResearchHeader title="Research Notebook" subtitle="A reproducible scientific lab notebook. Every experiment saves its model, parameters, equations, results, method, seed and runtime — enough to reproduce it exactly. Re-run, duplicate, compare and export."
        onExplain={() => explain(`Research notebook: ${records.length} saved experiments.`)} explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Card title="New Experiment Entry">
          <div className="space-y-2">
            <input value={form.experiment_name} onChange={(e) => setForm({ ...form, experiment_name: e.target.value })} placeholder="Experiment name" className="w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm" />
            <input value={form.hypothesis} onChange={(e) => setForm({ ...form, hypothesis: e.target.value })} placeholder="Hypothesis" className="w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm" />
            <input value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} placeholder="Method / solver (e.g. RK4, Metropolis)" className="w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm" />
            <input value={form.seed} onChange={(e) => setForm({ ...form, seed: e.target.value })} placeholder="Random seed" className="w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm" />
            <textarea value={form.parameters} onChange={(e) => setForm({ ...form, parameters: e.target.value })} placeholder='Parameters (JSON)' rows={2} className="w-full rounded-md border border-input bg-transparent px-3 py-1.5 font-mono text-xs" />
            <textarea value={form.results} onChange={(e) => setForm({ ...form, results: e.target.value })} placeholder='Results (JSON)' rows={2} className="w-full rounded-md border border-input bg-transparent px-3 py-1.5 font-mono text-xs" />
            <textarea value={form.observations} onChange={(e) => setForm({ ...form, observations: e.target.value })} placeholder="Observations" rows={2} className="w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm" />
            <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="tags (comma separated)" className="w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm" />
            <Button size="sm" onClick={save} disabled={saving || !form.experiment_name}>{saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}Save experiment</Button>
          </div>
        </Card>
        <Card title={`Saved Experiments (${records.length})`}>
          {loading ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading…</div> : records.length === 0 ? <div className="py-8 text-center text-sm text-muted-foreground"><FlaskConical className="mx-auto size-6 mb-2" />No experiments yet. Save one to begin.</div> : (
            <div className="max-h-96 space-y-2 overflow-auto">
              {records.map((r) => (
                <div key={r.id} className="rounded-lg border border-border/50 bg-card/30 p-2.5">
                  <div className="flex items-center justify-between"><span className="text-sm font-medium">{r.experiment_name}</span><span className="text-[10px] text-muted-foreground">{new Date(r.created_date).toLocaleDateString()}</span></div>
                  {r.hypothesis && <div className="mt-0.5 text-xs text-muted-foreground">Hypothesis: {r.hypothesis}</div>}
                  {r.method && <div className="text-xs text-muted-foreground">Method: {r.method}{r.seed ? ` · seed ${r.seed}` : ''}</div>}
                  {r.observations && <div className="mt-1 text-xs">{r.observations}</div>}
                  <div className="mt-1.5 flex gap-1.5"><Button size="sm" variant="ghost" onClick={() => duplicate(r)} className="h-7 px-2 text-xs"><Copy className="size-3" />Duplicate</Button><Button size="sm" variant="ghost" onClick={() => exportRec(r)} className="h-7 px-2 text-xs"><Download className="size-3" />Export</Button><Button size="sm" variant="ghost" onClick={() => remove(r.id)} className="h-7 px-2 text-xs text-red-500"><Trash2 className="size-3" /></Button></div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
      <AIPanel output={output} />
    </div>
  );
}
function safeParse(s) { try { return JSON.parse(s); } catch { return s; } }