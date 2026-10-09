import React, { useState, useEffect } from 'react';
import { Save, Trash2, Star, Bookmark } from 'lucide-react';
import { Button } from '../ui/button.jsx';
import { Input } from '../ui/input.jsx';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '../ui/select.jsx';

const STORAGE_KEY = 'quantum-sim-presets';

function loadSaved() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}

// A few useful starting points, always available.
const BUILTIN = [
  { id: 'builtin-af', name: 'Antiferromagnetic · N=10, J=+1', params: { N: 10, J: 1, h: 0, periodic: false, solver: 'lanczos', numStates: 5 } },
  { id: 'builtin-fm', name: 'Ferromagnetic · N=10, J=−1', params: { N: 10, J: -1, h: 0, periodic: false, solver: 'lanczos', numStates: 5 } },
  { id: 'builtin-field', name: 'Field-induced gap · N=12, h=2', params: { N: 12, J: 1, h: 2, periodic: false, solver: 'lanczos', numStates: 5 } },
  { id: 'builtin-periodic', name: 'Periodic chain · N=10, OBC→PBC', params: { N: 10, J: 1, h: 0, periodic: true, solver: 'lanczos', numStates: 5 } },
  { id: 'builtin-critical', name: 'Critical point · N=14, h=1.8', params: { N: 14, J: 1, h: 1.8, periodic: false, solver: 'lanczos', numStates: 8 } },
];

function describe(p) {
  const bc = p.periodic ? 'PBC' : 'OBC';
  return `N=${p.N}, J=${p.J}, h=${p.h}, ${bc}, ${p.solver}, k=${p.numStates}`;
}

export default function PresetManager({ params, setParams }) {
  const [saved, setSaved] = useState(() => loadSaved());
  const [name, setName] = useState('');
  const [selected, setSelected] = useState('');

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); }, [saved]);

  const apply = (preset) => {
    setParams({ ...preset.params });
    setSelected(preset.id);
  };

  const onSave = () => {
    const n = name.trim();
    if (!n) return;
    const preset = { id: `p-${Date.now()}`, name: n, params: { ...params }, savedAt: new Date().toISOString() };
    setSaved((s) => [preset, ...s]);
    setSelected(preset.id);
    setName('');
  };

  const onDelete = (id) => {
    setSaved((s) => s.filter((p) => p.id !== id));
    if (selected === id) setSelected('');
  };

  return (
    <div className="rounded-xl border border-border bg-card/60 p-3 space-y-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Bookmark className="h-3.5 w-3.5 text-cyan-j" /> System Presets
      </div>

      <div>
        <label className="text-xs text-muted-foreground">Load a preset</label>
        <Select value={selected} onValueChange={(id) => { const p = [...BUILTIN, ...saved].find((x) => x.id === id); if (p) apply(p); }}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Select a saved system state…" /></SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">Built-in</SelectLabel>
              {BUILTIN.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  <span className="flex items-center gap-2"><Star className="h-3 w-3 text-amber-500" /> {p.name}</span>
                </SelectItem>
              ))}
            </SelectGroup>
            {saved.length > 0 && (
              <SelectGroup>
                <SelectLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">Your saved presets</SelectLabel>
                {saved.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectGroup>
            )}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[180px]">
          <label className="text-xs text-muted-foreground">Save current as…</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Critical point N=14" onKeyDown={(e) => e.key === 'Enter' && onSave()} />
        </div>
        <Button size="sm" onClick={onSave} disabled={!name.trim()} className="gap-1.5"><Save className="h-4 w-4" /> Save</Button>
      </div>

      <div className="text-[11px] text-muted-foreground">
        Current: <span className="font-mono text-foreground">{describe(params)}</span>
      </div>

      {saved.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {saved.map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2 py-0.5 text-[11px]">
              <button onClick={() => apply(p)} className="hover:text-cyan-j" title={describe(p.params)}>{p.name}</button>
              <button onClick={() => onDelete(p.id)} className="text-muted-foreground hover:text-red-500" aria-label={`Delete ${p.name}`}>
                <Trash2 className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}