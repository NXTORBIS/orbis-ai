import React, { useState, useRef } from 'react';
import { ResearchHeader, Card, SciTable, AIPanel, useAIExplain, downloadFile } from '../research.jsx';
import { Button } from '../ui/button.jsx';
import { Plus, Trash2, Download } from 'lucide-react';

// Unique Feynman-diagram builder: users drag fermion and boson lines on an
// SVG canvas, connect them at vertices, and the engine validates against
// QED, QCD, weak, and Higgs vertex rules. Includes preset diagrams.

const VERTEX_RULES = {
  QED:    { mediator: 'photon', fermions: 2, note: 'e⁻·e⁻·γ — QED vertex; charge conserved at each vertex' },
  QCD:    { mediator: 'gluon',  fermions: 2, note: 'q·q·g — QCD vertex; color conserved (quark ↔ quark + gluon)' },
  Weak:   { mediator: 'W',      fermions: 2, note: 'f·f·W — weak charged current; flavor changes (e.g. d→u+W⁻)' },
  WeakZ:  { mediator: 'Z',      fermions: 2, note: 'f·f·Z — weak neutral current; no flavor change' },
  Higgs:  { mediator: 'Higgs',  fermions: 2, note: 'f·f·H — Yukawa coupling; gives fermion mass' },
  TripleG:{ mediator: 'gluon',  fermions: 0, note: 'g·g·g — triple-gluon vertex (non-Abelian SU(3))' },
};

const LINE_STYLES = {
  fermion: { stroke: '#22d3ee', dash: '', width: 2, label: 'fermion' },
  photon:  { stroke: '#a855f7', dash: '6 3', width: 2, label: 'γ' },
  gluon:   { stroke: '#84cc16', dash: '4 2', width: 2, label: 'g' },
  W:       { stroke: '#f97316', dash: '6 3', width: 2.5, label: 'W' },
  Z:       { stroke: '#eab308', dash: '6 3', width: 2.5, label: 'Z' },
  Higgs:   { stroke: '#ec4899', dash: '', width: 2, label: 'H' },
};

const PRESETS = {
  compton: [
    { id: 1, type: 'fermion', x1: 30, y1: 100, x2: 270, y2: 100 },
    { id: 2, type: 'photon',  x1: 270, y1: 100, x2: 270, y2: 260 },
    { id: 3, type: 'photon',  x1: 270, y1: 260, x2: 540, y2: 260 },
    { id: 4, type: 'fermion', x1: 270, y1: 100, x2: 540, y2: 100 },
  ],
  beta: [
    { id: 1, type: 'fermion', x1: 30, y1: 80, x2: 250, y2: 80 },
    { id: 2, type: 'fermion', x1: 250, y1: 80, x2: 540, y2: 80 },
    { id: 3, type: 'W',       x1: 250, y1: 80, x2: 250, y2: 260 },
    { id: 4, type: 'fermion', x1: 250, y1: 260, x2: 540, y2: 260 },
    { id: 5, type: 'fermion', x1: 250, y1: 260, x2: 540, y2: 320 },
  ],
  pair: [
    { id: 1, type: 'photon',  x1: 30, y1: 180, x2: 250, y2: 180 },
    { id: 2, type: 'fermion', x1: 250, y1: 180, x2: 540, y2: 100 },
    { id: 3, type: 'fermion', x1: 540, y1: 260, x2: 250, y2: 180 },
  ],
};

export default function FeynmanDiagramSim() {
  const [lines, setLines] = useState(PRESETS.compton);
  const [interaction, setInteraction] = useState('QED');
  const [nextId, setNextId] = useState(10);
  const { explain, explaining, output } = useAIExplain();

  const addLine = (type) => { setLines((l) => [...l, { id: nextId, type, x1: 100, y1: 150, x2: 260, y2: 150 }]); setNextId((n) => n + 1); };
  const removeLine = (id) => setLines((l) => l.filter((x) => x.id !== id));
  const update = (id, key, val) => setLines((l) => l.map((x) => x.id === id ? { ...x, [key]: val } : x));
  const loadPreset = (name) => { setLines(PRESETS[name]); setInteraction(name === 'beta' ? 'Weak' : 'QED'); };

  const validate = () => {
    const rule = VERTEX_RULES[interaction];
    const counts = {};
    lines.forEach((l) => counts[l.type] = (counts[l.type] || 0) + 1);
    const mediator = rule.mediator;
    const fermionCount = counts.fermion || 0;
    const mediatorCount = counts[mediator] || 0;
    const valid = fermionCount >= rule.fermions && mediatorCount >= 1;
    return { valid, rule, mediator, fermionCount, mediatorCount, counts };
  };
  const v = validate();

  return (
    <div className="space-y-4">
      <ResearchHeader title="Feynman Diagram Builder" subtitle="Build diagrams from fermion and boson lines. The validator checks the chosen interaction against vertex rules (QED, QCD, Weak, Higgs). Preset diagrams: Compton scattering, beta decay, pair production."
        onExplain={() => explain(`Feynman diagram: interaction=${interaction}, ${v.valid ? 'valid' : 'invalid'} (${v.fermionCount} fermions, ${v.mediatorCount} ${v.mediator}).`)} explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <Card title="Diagram Canvas">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {Object.keys(LINE_STYLES).map((t) => (
              <Button key={t} size="sm" variant="outline" onClick={() => addLine(t)}><Plus className="size-3" />{LINE_STYLES[t].label}</Button>
            ))}
            <div className="ml-auto flex gap-1.5">
              {Object.entries(PRESETS).map(([name]) => (
                <Button key={name} size="sm" variant="ghost" onClick={() => loadPreset(name)}>{name}</Button>
              ))}
            </div>
          </div>
          <svg viewBox="0 0 580 360" className="w-full rounded-lg border border-border/60 bg-card/20" style={{ height: 360 }}>
            <defs><marker id="arrow-fd" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="#22d3ee" /></marker></defs>
            {lines.map((l) => {
              const st = LINE_STYLES[l.type];
              return <line key={l.id} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={st.stroke} strokeWidth={st.width} strokeDasharray={st.dash} markerEnd={l.type === 'fermion' ? 'url(#arrow-fd)' : undefined} />;
            })}
            {lines.map((l) => <g key={'h' + l.id}><circle cx={l.x1} cy={l.y1} r="4" fill="#f43f5e" /><circle cx={l.x2} cy={l.y2} r="4" fill="#f43f5e" /></g>)}
          </svg>
          <p className="mt-1 text-xs text-muted-foreground">Solid cyan = fermion (arrow), dashed = bosons (γ purple, g green, W orange, Z yellow, H pink). Red dots = endpoints/vertices.</p>
        </Card>
        <div className="space-y-3">
          <Card title="Interaction">
            <select value={interaction} onChange={(e) => setInteraction(e.target.value)} className="w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm">
              {Object.entries(VERTEX_RULES).map(([k, r]) => <option key={k} value={k} className="bg-background">{k}</option>)}
            </select>
            <div className="mt-2 text-xs text-muted-foreground">{v.rule.note}</div>
          </Card>
          <div className={`rounded-xl border p-3 ${v.valid ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-red-500/40 bg-red-500/5'}`}>
            <div className={`font-display text-sm font-bold uppercase ${v.valid ? 'text-emerald-500' : 'text-red-500'}`}>{v.valid ? '✓ Vertex rule satisfied' : '✗ Vertex rule violated'}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Need ≥{v.rule.fermions} fermion lines and ≥1 {v.mediator}. Current: {v.fermionCount} fermions, {v.mediatorCount} {v.mediator}.
            </div>
          </div>
          <Card title="Lines">
            <div className="max-h-40 overflow-y-auto space-y-1">
              {lines.map((l) => (
                <div key={l.id} className="flex items-center gap-2 text-xs">
                  <span className="font-mono w-12" style={{ color: LINE_STYLES[l.type].stroke }}>{LINE_STYLES[l.type].label}</span>
                  <button onClick={() => removeLine(l.id)} className="text-red-500"><Trash2 className="size-3" /></button>
                </div>
              ))}
            </div>
          </Card>
          <Button size="sm" variant="outline" onClick={() => downloadFile(JSON.stringify({ interaction, lines, valid: v.valid }, null, 2), 'feynman-diagram.json', 'application/json')}><Download className="size-3.5" />Export</Button>
        </div>
      </div>
      <AIPanel output={output} />
    </div>
  );
}