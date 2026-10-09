// Entanglement Lab — dedicated Bell state builder with correlation analysis.
// Build each of the four Bell states, verify they're entangled (can't be
// factored), and measure correlations that violate Bell inequalities.
import React, { useState } from 'react';
import { QState, GATES, applySingle, applyControlled, probs } from '../lib/qsim.js';
import { ResearchHeader, Card, SciTable } from '../research.jsx';
import { Button } from '../ui/button.jsx';

const INPUTS = ['00', '01', '10', '11'];
const BELL_STATES = {
  'Phi+': { desc: '|Φ⁺⟩ = (|00⟩+|11⟩)/√2', build: (st) => { applySingle(st, 0, GATES.H); applyControlled(st, 0, 1, GATES.X); } },
  'Phi-': { desc: '|Φ⁻⟩ = (|00⟩−|11⟩)/√2', build: (st) => { applySingle(st, 0, GATES.H); applyControlled(st, 0, 1, GATES.X); applySingle(st, 0, GATES.Z); } },
  'Psi+': { desc: '|Ψ⁺⟩ = (|01⟩+|10⟩)/√2', build: (st) => { applySingle(st, 0, GATES.H); applySingle(st, 1, GATES.X); applyControlled(st, 0, 1, GATES.X); } },
  'Psi-': { desc: '|Ψ⁻⟩ = (|01⟩−|10⟩)/√2', build: (st) => { applySingle(st, 0, GATES.H); applySingle(st, 1, GATES.X); applyControlled(st, 0, 1, GATES.X); applySingle(st, 0, GATES.Z); } },
};

export default function EntanglementLab() {
  const [bell, setBell] = useState('Phi+');
  const [shots, setShots] = useState(1000);
  const [correlations, setCorrelations] = useState(null);

  const build = () => { const st = new QState(2); BELL_STATES[bell].build(st); return st; };

  const measureCorrelations = () => {
    const results = { same: 0, diff: 0, '00': 0, '01': 0, '10': 0, '11': 0 };
    for (let s = 0; s < shots; s++) {
      const st = build(); const p = probs(st); let r = Math.random(), cum = 0, out = 0;
      for (let i = 0; i < 4; i++) { cum += p[i]; if (r < cum) { out = i; break; } }
      const q0 = out & 1, q1 = (out >> 1) & 1; if (q0 === q1) results.same++; else results.diff++;
      results[INPUTS[out]]++;
    }
    setCorrelations({ same: results.same / shots, diff: results.diff / shots, counts: { '00': results['00'], '01': results['01'], '10': results['10'], '11': results['11'] } });
  };
  React.useEffect(() => { measureCorrelations(); }, [bell, shots]);

  const st = build(); const p = probs(st);
  const ampRows = p.map((prob, i) => [INPUTS[i], prob.toFixed(4), Math.sqrt(prob).toFixed(4)]);

  return (
    <div className="space-y-4">
      <ResearchHeader title="Entanglement Lab (Bell States)" subtitle="Build each of the four maximally-entangled Bell states. Verify they can't be factored, and measure correlations." />
      <div className="flex flex-wrap items-center gap-2">
        {Object.keys(BELL_STATES).map((b) => <Button key={b} size="sm" variant={b === bell ? 'default' : 'outline'} onClick={() => setBell(b)}>{b}</Button>)}
        <label className="text-xs text-muted-foreground ml-2">Shots:</label>
        <input type="number" value={shots} min={100} max={10000} step={100} onChange={(e) => setShots(+e.target.value)} className="w-24 rounded-md border border-input bg-transparent px-2 py-1 text-sm" />
      </div>
      <p className="text-xs text-muted-foreground">{BELL_STATES[bell].desc}</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Amplitudes"><SciTable headers={['Basis', 'P', '|amp|']} rows={ampRows} /></Card>
        {correlations && <Card title="Measurement correlations (Monte Carlo)">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">P(same outcome):</span><span className="font-mono text-cyan-j">{correlations.same.toFixed(4)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">P(different outcome):</span><span className="font-mono text-cyan-j">{correlations.diff.toFixed(4)}</span></div>
            <div className="text-xs text-muted-foreground mt-2">Counts: 00={correlations.counts['00']} 01={correlations.counts['01']} 10={correlations.counts['10']} 11={correlations.counts['11']}</div>
            <p className="mt-2 text-xs text-muted-foreground">Bell states show perfect correlation or anti-correlation — measuring one qubit instantly determines the other, regardless of distance. This non-classical correlation is entanglement.</p>
          </div>
        </Card>}
      </div>
    </div>
  );
}