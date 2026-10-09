// Bell-State Analysis — dedicated simulator for the four maximally entangled
// two-qubit Bell states. Shows their amplitudes, correlations, and uses.
import React, { useState } from 'react';
import { QState, GATES, applySingle, applyControlled, probs } from '../lib/qsim.js';
import { ResearchHeader, Card, SciTable } from '../research.jsx';
import { Button } from '../ui/button.jsx';

const BELLS = {
  '|Φ⁺⟩': { vec: [0.5, 0, 0, 0.5], build: (st) => { applySingle(st, 0, GATES.H); applyControlled(st, 0, 1, GATES.X); }, desc: '(|00⟩+|11⟩)/√2 — same outcomes, +phase' },
  '|Φ⁻⟩': { vec: [0.5, 0, 0, -0.5], build: (st) => { applySingle(st, 0, GATES.H); applyControlled(st, 0, 1, GATES.X); applySingle(st, 0, GATES.Z); }, desc: '(|00⟩−|11⟩)/√2 — same outcomes, −phase' },
  '|Ψ⁺⟩': { vec: [0, 0.5, 0.5, 0], build: (st) => { applySingle(st, 0, GATES.H); applySingle(st, 1, GATES.X); applyControlled(st, 0, 1, GATES.X); }, desc: '(|01⟩+|10⟩)/√2 — opposite outcomes, +phase' },
  '|Ψ⁻⟩': { vec: [0, 0.5, -0.5, 0], build: (st) => { applySingle(st, 0, GATES.H); applySingle(st, 1, GATES.X); applyControlled(st, 0, 1, GATES.X); applySingle(st, 0, GATES.Z); }, desc: '(|01⟩−|10⟩)/√2 — opposite outcomes, −phase' },
};

export default function BellStateAnalysis() {
  const [selected, setSelected] = useState('|Φ⁺⟩');
  const [shots, setShots] = useState(1000);
  const [correlations, setCorrelations] = useState(null);

  const run = () => {
    const st = new QState(2); BELLS[selected].build(st); const p = probs(st);
    const counts = [0, 0, 0, 0]; let same = 0, diff = 0;
    for (let s = 0; s < shots; s++) { let r = Math.random(), cum = 0, out = 0; for (let i = 0; i < 4; i++) { cum += p[i]; if (r < cum) { out = i; break; } } counts[out]++; const q0 = out & 1, q1 = (out >> 1) & 1; if (q0 === q1) same++; else diff++; }
    setCorrelations({ counts, same: same / shots, diff: diff / shots, probs: p });
  };
  React.useEffect(() => { run(); }, [selected, shots]);

  const st = new QState(2); BELLS[selected].build(st); const p = probs(st);
  const ampRows = ['00', '01', '10', '11'].map((b, i) => [b, p[i].toFixed(4), BELLS[selected].vec[i].toFixed(4)]);

  return (
    <div className="space-y-4">
      <ResearchHeader title="Bell-State Analysis (Maximally Entangled States)" subtitle="The four Bell states form a complete basis for 2-qubit entanglement. Each is pure globally but maximally mixed locally." />
      <div className="flex flex-wrap items-center gap-2">
        {Object.keys(BELLS).map((b) => <Button key={b} size="sm" variant={b === selected ? 'default' : 'outline'} onClick={() => setSelected(b)}>{b}</Button>)}
        <label className="text-xs text-muted-foreground ml-2">Shots:</label>
        <input type="number" value={shots} min={100} max={10000} step={100} onChange={(e) => setShots(+e.target.value)} className="w-24 rounded-md border border-input bg-transparent px-2 py-1 text-sm" />
      </div>
      <p className="text-xs text-muted-foreground">{BELLS[selected].desc}</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Amplitudes"><SciTable headers={['Basis', 'P (measured)', 'Amplitude']} rows={ampRows} /></Card>
        {correlations && <Card title="Correlations (Monte Carlo)">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">P(same):</span><span className="font-mono text-cyan-j">{correlations.same.toFixed(4)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">P(different):</span><span className="font-mono text-cyan-j">{correlations.diff.toFixed(4)}</span></div>
            <div className="text-xs text-muted-foreground mt-2">Counts: 00={correlations.counts[0]} 01={correlations.counts[1]} 10={correlations.counts[2]} 11={correlations.counts[3]}</div>
            <p className="mt-2 text-xs text-muted-foreground">Φ states → perfect same-correlation. Ψ states → perfect anti-correlation. These non-classical correlations violate Bell inequalities and enable teleportation & superdense coding.</p>
          </div>
        </Card>}
      </div>
    </div>
  );
}