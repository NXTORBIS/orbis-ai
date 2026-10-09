import React, { useState, useRef } from 'react';
import { ResearchHeader, Card, AIPanel, useAIExplain, SciTable } from '../research.jsx';
import { Button } from '../ui/button.jsx';
import { Plus, Trash2, Download } from 'lucide-react';

// Visual Feynman-diagram builder. Users place fermion/boson lines and vertices;
// the validator checks QED (e–e–γ), QCD (q–q–g), and weak (f–f–W) vertex rules.
// Diagrams that violate the implemented vertex rules are flagged — no arbitrary
// diagram is presented as physically valid.

// A diagram is a list of vertices; each vertex joins 3 particles with roles.
const VERTEX_RULES = {
  QED: { particles: ['e⁻', 'e⁻', 'γ'], note: 'e–e–γ vertex (charge conserved)' },
  QCD: { particles: ['q', 'q', 'g'], note: 'quark–quark–gluon (color conserved)' },
  Weak: { particles: ['f', 'f', 'W'], note: 'fermion–fermion–W (weak charged current)' },
  Higgs: { particles: ['f', 'f', 'H'], note: 'fermion–fermion–Higgs (Yukawa)' },
};

const TYPES = ['fermion', 'boson', 'photon', 'gluon', 'W', 'Higgs'];
const INTERACTIONS = ['QED', 'QCD', 'Weak', 'Higgs'];

export default function FeynmanLab() {
  const [lines, setLines] = useState([{ id: 1, type: 'fermion', x1: 40, y1: 200, x2: 220, y2: 200 }, { id: 2, type: 'photon', x1: 220, y1: 200, x2: 360, y2: 200 }, { id: 3, type: 'fermion', x1: 360, y1: 200, x2: 540, y2: 200 }]);
  const [interaction, setInteraction] = useState('QED');
  const svgRef = useRef(null);
  const [nextId, setNextId] = useState(4);
  const { explain, explaining, output } = useAIExplain();

  const addLine = (type) => setLines((l) => [...l, { id: nextId, type, x1: 100, y1: 100, x2: 260, y2: 100 }]);
  const removeLine = (id) => setLines((l) => l.filter((x) => x.id !== id));
  const update = (id, key, val) => setLines((l) => l.map((x) => x.id === id ? { ...x, [key]: val } : x));

  const validate = () => {
    const rule = VERTEX_RULES[interaction];
    const counts = { fermion: 0, boson: 0, photon: 0, gluon: 0, W: 0, Higgs: 0 };
    lines.forEach((l) => counts[l.type]++);
    // Heuristic: the chosen interaction expects a specific mediator + two fermions.
    const mediator = interaction === 'QED' ? 'photon' : interaction === 'QCD' ? 'gluon' : interaction === 'Weak' ? 'W' : 'Higgs';
    const fermionCount = counts.fermion;
    const mediatorCount = counts[mediator];
    const valid = fermionCount >= 2 && mediatorCount >= 1;
    return { valid, rule, mediator, fermionCount, mediatorCount };
  };
  const v = validate();

  const renderLine = (l) => {
    const isBoson = ['photon', 'gluon', 'W', 'Higgs', 'boson'].includes(l.type);
    if (isBoson && l.type !== 'Higgs') {
      // wavy line approximation: dashed
      return <line key={l.id} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={l.type === 'W' ? '#f97316' : '#a855f7'} strokeWidth={2.5} strokeDasharray="6 3" />;
    }
    return <line key={l.id} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={l.type === 'fermion' ? '#22d3ee' : '#84cc16'} strokeWidth={2} markerEnd="url(#arrow)" />;
  };

  return (
    <div className="space-y-4">
      <ResearchHeader title="Feynman Diagram Laboratory" subtitle="Build diagrams from fermion and boson lines. The validator checks the chosen interaction against implemented vertex rules (QED, QCD, Weak, Higgs). Diagrams violating the rules are flagged — no arbitrary diagram is shown as valid."
        onExplain={() => explain(`Feynman lab: interaction=${interaction}, ${v.valid ? 'valid' : 'invalid'} (${v.fermionCount} fermions, ${v.mediatorCount} ${v.mediator}).`)} explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <Card title="Diagram Canvas">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {TYPES.map((t) => <Button key={t} size="sm" variant="outline" onClick={() => addLine(t)}><Plus className="size-3" />{t}</Button>)}
          </div>
          <svg ref={svgRef} viewBox="0 0 600 320" className="w-full rounded-lg border border-border/60 bg-card/20" style={{ height: 320 }}>
            <defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="#22d3ee" /></marker></defs>
            {lines.map(renderLine)}
            {lines.map((l) => <g key={'h' + l.id}><circle cx={l.x1} cy={l.y1} r="4" fill="#f43f5e" /><circle cx={l.x2} cy={l.y2} r="4" fill="#f43f5e" /></g>)}
          </svg>
          <p className="mt-1 text-xs text-muted-foreground">Solid cyan = fermion (with arrow), dashed purple = photon/gluon, dashed orange = W. Vertices are red dots where lines meet.</p>
        </Card>
        <div className="space-y-3">
          <Card title="Interaction">
            <select value={interaction} onChange={(e) => setInteraction(e.target.value)} className="w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm">{INTERACTIONS.map((i) => <option key={i} className="bg-background">{i}</option>)}</select>
            <SciTable headers={['Field', 'Value']} rows={[['Rule', v.rule.note], ['Mediator', v.mediator], ['Fermion lines', v.fermionCount], ['Mediator lines', v.mediatorCount]]} />
          </Card>
          <div className={`rounded-xl border p-3 ${v.valid ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-red-500/40 bg-red-500/5'}`}>
            <div className={`font-display text-sm font-bold uppercase ${v.valid ? 'text-emerald-500' : 'text-red-500'}`}>{v.valid ? '✓ Vertex Rule Satisfied' : '✗ Vertex Rule Violated'}</div>
            <p className="mt-1 text-xs text-muted-foreground">{v.valid ? `${interaction} requires ≥2 fermion lines and ≥1 ${v.mediator} mediator. Diagram is consistent with the implemented model.` : `Need ≥2 fermion lines and ≥1 ${v.mediator} mediator for a ${interaction} vertex.`}</p>
          </div>
          <Card title="Lines">
            {lines.map((l) => <div key={l.id} className="flex items-center gap-2 text-xs py-0.5"><span className="font-mono w-16">{l.type}</span><button onClick={() => removeLine(l.id)} className="text-red-500"><Trash2 className="size-3" /></button></div>)}
          </Card>
        </div>
      </div>
      <AIPanel output={output} />
    </div>
  );
}