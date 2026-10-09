// Multi-Qubit Simulator — dedicated to tensor-product states and entanglement.
// Shows how 2–4 qubits combine via tensor products, and measures entanglement
// via the reduced density matrix and von Neumann entropy of subsystems.
import React, { useState } from 'react';
import { QState, GATES, applySingle, applyControlled, probs } from '../lib/qsim.js';
import { ResearchHeader, Card, SciTable, NumField } from '../research.jsx';
import { Button } from '../ui/button.jsx';

function reducedEntropy(st, qubits) {
  // Trace out all qubits NOT in `qubits`, compute von Neumann entropy of the reduced state.
  const keep = new Set(qubits); const dim = 2 ** qubits.length;
  const rho = Array.from({ length: dim }, () => new Array(dim).fill(0));
  const N = st.N;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    // check if traced-out bits match
    let match = true; for (let q = 0; q < st.n; q++) if (!keep.has(q) && ((i >> q) & 1) !== ((j >> q) & 1)) { match = false; break; }
    if (!match) continue;
    let ki = 0, kj = 0; for (let b = 0; b < qubits.length; b++) { ki |= ((i >> qubits[b]) & 1) << b; kj |= ((j >> qubits[b]) & 1) << b; }
    rho[ki][kj] += st.re[i] * st.re[j] + st.im[i] * st.im[j];
  }
  // eigenvalues via simple 2x2 / power iteration for dim 2
  if (dim === 2) { const tr = rho[0][0] + rho[1][1]; const det = rho[0][0] * rho[1][1] - rho[0][1] * rho[1][0]; const disc = Math.sqrt(Math.max(0, tr * tr / 4 - det)); const e1 = tr / 2 + disc, e2 = tr / 2 - disc; let S = 0; for (const e of [e1, e2]) if (e > 1e-12) S -= e * Math.log2(e); return S; }
  return 0;
}

export default function MultiQubitSim() {
  const [n, setN] = useState(2);
  const [preset, setPreset] = useState('bell');
  const stateRef = React.useRef(new QState(n));
  const [, force] = React.useReducer((x) => x + 1, 0);

  const presets = {
    bell: { desc: 'Bell pair: H on q0, CNOT q0→q1', build: (st) => { applySingle(st, 0, GATES.H); applyControlled(st, 0, 1, GATES.X); } },
    separable: { desc: 'Separable: H on q0 only', build: (st) => { applySingle(st, 0, GATES.H); } },
    ghz: { desc: 'GHZ state: H q0, CNOT q0→q1, CNOT q1→q2', build: (st) => { applySingle(st, 0, GATES.H); applyControlled(st, 0, 1, GATES.X); applyControlled(st, 1, 2, GATES.X); } },
    w: { desc: 'W-like: X on q0 only', build: (st) => { applySingle(st, 0, GATES.X); } },
  };
  const validPresets = Object.entries(presets).filter(([k]) => k !== 'ghz' || n >= 3).filter(([k]) => k !== 'bell' || n >= 2);

  const build = () => { stateRef.current = new QState(n); presets[preset].build(stateRef.current); force(); };
  React.useEffect(() => { build(); }, [n, preset]);

  const st = stateRef.current; const p = probs(st);
  const entQ01 = n >= 2 ? reducedEntropy(st, [0, 1]) : 0;
  const entQ0 = reducedEntropy(st, [0]);

  const rows = p.map((prob, i) => [i.toString(2).padStart(n, '0'), prob.toFixed(4), Math.sqrt(prob).toFixed(4)]);

  return (
    <div className="space-y-4">
      <ResearchHeader title="Multi-Qubit Simulator (Tensor Products & Entanglement)" subtitle="Build multi-qubit states from presets, see the full probability distribution, and measure entanglement via the reduced-density-matrix entropy." />
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-muted-foreground">Qubits</label>
        <select value={n} onChange={(e) => setN(+e.target.value)} className="rounded-md border border-input bg-transparent px-2 py-1 text-sm">{[2, 3, 4].map((m) => <option key={m} value={m} className="bg-background">{m}</option>)}</select>
        <select value={preset} onChange={(e) => setPreset(e.target.value)} className="rounded-md border border-input bg-transparent px-2 py-1 text-sm">{validPresets.map(([k, v]) => <option key={k} value={k} className="bg-background">{v.desc}</option>)}</select>
        <Button size="sm" onClick={build}>Rebuild</Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Probability distribution"><SciTable headers={['Basis', 'P', 'Amplitude']} rows={rows} /></Card>
        <Card title="Entanglement measures">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">S(q0) entropy:</span><span className="font-mono text-cyan-j">{entQ0.toFixed(4)} bits</span></div>
            {n >= 2 && <div className="flex justify-between"><span className="text-muted-foreground">S(q0,q1) entropy:</span><span className="font-mono text-cyan-j">{entQ01.toFixed(4)} bits</span></div>}
            <div className="flex justify-between"><span className="text-muted-foreground">Entangled?</span><span className="font-mono">{entQ0 > 0.01 ? 'YES' : 'no (separable)'}</span></div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Von Neumann entropy of a subsystem: 0 for separable states, &gt; 0 for entangled. Bell pair → S=1 bit.</p>
        </Card>
      </div>
    </div>
  );
}