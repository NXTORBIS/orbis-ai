// Quantum circuit builder — real state-vector simulation
import React, { useEffect, useRef, useState, useReducer } from 'react';
import { QState, GATES, runCircuit, probs } from '../lib/qsim.js';
import { CanvasStage, stageBg } from '../ui.jsx';
import { Button } from '../ui/button.jsx';

const SINGLE = ['H', 'X', 'Y', 'Z', 'S', 'T'];
const TWO = [
  { name: 'CNOT', gate: 'X' }, { name: 'CZ', gate: 'Z' }, { name: 'SWAP', gate: null },
];

export default function QuantumCircuits() {
  const canvasRef = useRef(null);
  const [n, setN] = useState(2);
  const [ins, setIns] = useState([]);
  const [stepIdx, setStepIdx] = useState(-1);
  const [, force] = useReducer((x) => x + 1, 0);
  const [selSingle, setSelSingle] = useState('H');
  const [ctrl, setCtrl] = useState(0);
  const [tgt, setTgt] = useState(1);
  const [two, setTwo] = useState('CNOT');
  const [measured, setMeasured] = useState(null);

  const buildState = (upTo) => {
    const st = new QState(n);
    const limit = upTo < 0 ? ins.length : upTo + 1;
    for (let i = 0; i < limit; i++) runCircuit([ins[i]], n, st);
    return st;
  };

  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const ctx = cv.getContext('2d'); const w = cv.width, h = cv.height;
    stageBg(ctx, w, h);
    const st = buildState(stepIdx);
    const p = probs(st);
    const padX = 40, padY = 24; const bw = w - 2 * padX; const barW = bw / p.length;
    const maxP = Math.max(...p, 0.001);
    for (let i = 0; i < p.length; i++) { const bh = (p[i] / maxP) * (h - 2 * padY); ctx.fillStyle = '#22d3ee'; ctx.fillRect(padX + i * barW + 1, h - padY - bh, barW - 2, bh); ctx.fillStyle = 'hsl(var(--muted-foreground))'; ctx.font = '9px monospace'; ctx.textAlign = 'center'; ctx.fillText(i.toString(2).padStart(n, '0'), padX + i * barW + barW / 2, h - 6); }
    ctx.strokeStyle = 'hsl(var(--border))'; ctx.beginPath(); ctx.moveTo(padX, h - padY); ctx.lineTo(w - padX, h - padY); ctx.stroke();
    ctx.fillStyle = 'white'; ctx.textAlign = 'left'; ctx.fillText(`Probability distribution${stepIdx >= 0 ? ` (after step ${stepIdx + 1}/${ins.length})` : ' (final)'}`, padX, 16);
  });

  const addSingle = (q) => { setIns((a) => [...a, { t: 'g', gate: selSingle, target: q }]); setMeasured(null); };
  const addTwo = () => {
    if (ctrl === tgt) return;
    const t = TWO.find((x) => x.name === two);
    if (t.name === 'SWAP') setIns((a) => [...a, { t: 'swap', q1: ctrl, q2: tgt }]); else setIns((a) => [...a, { t: 'c', gate: t.gate, control: ctrl, target: tgt }]);
    setMeasured(null);
  };
  const runAll = () => { setStepIdx(-1); force(); };
  const step = () => setStepIdx((i) => Math.min(i + 1, ins.length - 1));
  const reset = () => { setIns([]); setStepIdx(-1); setMeasured(null); };
  const measureAll = () => { const st = buildState(stepIdx); let out = 0; for (let q = 0; q < n; q++) out |= (runCircuit([{ t: 'm', qubit: q }], n, st) ? 1 : 0) << q; setMeasured(out.toString(2).padStart(n, '0')); force(); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-muted-foreground">Qubits</label>
        <select value={n} onChange={(e) => { setN(+e.target.value); reset(); }} className="rounded-md border border-input bg-transparent px-2 py-1 text-sm">
          {[2, 3, 4].map((m) => <option key={m} value={m} className="bg-background">{m}</option>)}
        </select>
        <span className="text-xs text-muted-foreground ml-2">Single-qubit gate:</span>
        <select value={selSingle} onChange={(e) => setSelSingle(e.target.value)} className="rounded-md border border-input bg-transparent px-2 py-1 text-sm">
          {SINGLE.map((g) => <option key={g} value={g} className="bg-background">{g}</option>)}
        </select>
        <div className="flex gap-1">{Array.from({ length: n }, (_, q) => <Button key={q} size="sm" variant="outline" onClick={() => addSingle(q)}>{selSingle}·q{q}</Button>)}</div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select value={two} onChange={(e) => setTwo(e.target.value)} className="rounded-md border border-input bg-transparent px-2 py-1 text-sm">
          {TWO.map((t) => <option key={t.name} value={t.name} className="bg-background">{t.name}</option>)}
        </select>
        <label className="text-xs text-muted-foreground">ctrl</label>
        <select value={ctrl} onChange={(e) => setCtrl(+e.target.value)} className="rounded-md border border-input bg-transparent px-2 py-1 text-sm">{Array.from({ length: n }, (_, q) => <option key={q} value={q} className="bg-background">q{q}</option>)}</select>
        <label className="text-xs text-muted-foreground">tgt</label>
        <select value={tgt} onChange={(e) => setTgt(+e.target.value)} className="rounded-md border border-input bg-transparent px-2 py-1 text-sm">{Array.from({ length: n }, (_, q) => <option key={q} value={q} className="bg-background">q{q}</option>)}</select>
        <Button size="sm" onClick={addTwo}>Add {two}</Button>
      </div>
      <div className="rounded-xl border border-border/60 bg-card/40 p-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Circuit ({ins.length} gates)</div>
        {ins.length === 0 ? <div className="text-xs text-muted-foreground">Add gates above to build a circuit.</div> :
          <div className="space-y-1 font-mono text-xs">
            {Array.from({ length: n }, (_, q) => (
              <div key={q} className="flex items-center gap-1"><span className="text-muted-foreground w-6">q{q}⟩</span>
                {ins.map((g, i) => {
                  let label = '·';
                  if (g.t === 'g' && g.target === q) label = g.gate;
                  else if (g.t === 'c' && g.target === q) label = '●' + g.gate;
                  else if (g.t === 'c' && g.control === q) label = '●';
                  else if (g.t === 'swap' && (g.q1 === q || g.q2 === q)) label = '×';
                  return <span key={i} className={`inline-flex items-center justify-center w-8 h-7 rounded border ${i === stepIdx ? 'border-cyan-j bg-cyan-j/20 text-cyan-j' : 'border-border/60'} ${label === '·' ? 'text-muted-foreground/30' : ''}`}>{label}</span>;
                })}
              </div>
            ))}
          </div>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={runAll}>Run all</Button>
        <Button size="sm" variant="outline" onClick={step}>Step</Button>
        <Button size="sm" variant="secondary" onClick={measureAll}>Measure</Button>
        <Button size="sm" variant="ghost" onClick={reset}>Reset</Button>
        {measured !== null && <span className="self-center text-sm font-mono">Outcome: |{measured}⟩</span>}
      </div>
      <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden" style={{ height: 220 }}><CanvasStage ref={canvasRef} /></div>
    </div>
  );
}