// Quantum Phase Estimation — dedicated QPE simulator. Estimates the
// eigenphase θ of a unitary U=diag(1, e^{iθ}) using counting qubits + inverse QFT.
import React, { useState, useEffect } from 'react';
import { QState, GATES, applySingle, applyControlledPhase, probs } from '../lib/qsim.js';
import { ResearchHeader, Card } from '../research.jsx';
import { Button } from '../ui/button.jsx';

// Manual inverse QFT on counting qubits (avoids qftCircuit bundling issue)
function applyInverseQFT(st, qubits) {
  const n = qubits.length;
  // Swap qubits (reverse order)
  for (let k = 0; k < Math.floor(n / 2); k++) {
    const q1 = qubits[k], q2 = qubits[n - 1 - k];
    const b1 = 1 << q1, b2 = 1 << q2;
    for (let i = 0; i < st.N; i++) if ((i & b1) && !(i & b2)) { const j = i ^ b1 ^ b2; [st.re[i], st.re[j]] = [st.re[j], st.re[i]]; [st.im[i], st.im[j]] = [st.im[j], st.im[i]]; }
  }
  // Inverse QFT: H then controlled-R(-theta) gates, in reverse order
  for (let a = n - 1; a >= 0; a--) {
    const qi = qubits[a];
    for (let b = n - 1; b > a; b--) { const qj = qubits[b]; applyControlledPhase(st, qj, qi, -Math.PI / 2 ** (b - a)); }
    applySingle(st, qi, GATES.H);
  }
}

export default function QuantumPhaseEstimation() {
  const [theta, setTheta] = useState(Math.PI / 4);
  const [nc, setNc] = useState(3);
  const [result, setResult] = useState(null);

  const run = () => {
    const n = nc + 1; const work = nc;
    const st = new QState(n);
    applySingle(st, work, GATES.X);
    for (let q = 0; q < nc; q++) applySingle(st, q, GATES.H);
    for (let q = 0; q < nc; q++) { const reps = 2 ** q; for (let r = 0; r < reps; r++) applyControlledPhase(st, q, work, theta); }
    const countingQubits = Array.from({ length: nc }, (_, i) => i);
    applyInverseQFT(st, countingQubits);
    const p = probs(st);
    const counts = new Array(2 ** nc).fill(0); const shots = 1024;
    for (let s = 0; s < shots; s++) { let r = Math.random(), cum = 0, out = 0; for (let i = 0; i < p.length; i++) { cum += p[i]; if (r < cum) { out = i; break; } } let m = 0; for (let q = 0; q < nc; q++) m |= ((out >> q) & 1) << q; counts[m]++; }
    const maxIdx = counts.indexOf(Math.max(...counts));
    const thetaEst = maxIdx / (2 ** nc) * 2 * Math.PI;
    setResult({ thetaEst, maxIdx, counts, shots });
  };
  useEffect(() => { run(); }, [theta, nc]);

  const thetaDeg = (theta * 180 / Math.PI).toFixed(1);
  const estDeg = result ? (result.thetaEst * 180 / Math.PI).toFixed(1) : '—';

  return (
    <div className="space-y-4">
      <ResearchHeader title="Quantum Phase Estimation (QPE)" subtitle="Estimate the eigenphase θ of U=diag(1, e^{iθ}) using counting qubits and inverse QFT. A key subroutine for quantum chemistry and Shor's algorithm." />
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-muted-foreground">True θ: {thetaDeg}°</label>
        <input type="range" min={0} max={Math.PI} step={Math.PI / 16} value={theta} onChange={(e) => setTheta(parseFloat(e.target.value))} className="w-40 accent-cyan-500" />
        <label className="text-xs text-muted-foreground ml-2">Counting qubits:</label>
        <select value={nc} onChange={(e) => setNc(+e.target.value)} className="rounded-md border border-input bg-transparent px-2 py-1 text-sm">{[2, 3, 4].map((m) => <option key={m} value={m} className="bg-background">{m}</option>)}</select>
        <Button size="sm" onClick={run}>Run</Button>
      </div>
      {result && <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Result"><div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">True θ:</span><span className="font-mono">{thetaDeg}° ({theta.toFixed(4)})</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Estimated θ:</span><span className="font-mono text-cyan-j text-lg">{estDeg}° ({result.thetaEst.toFixed(4)})</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Measured m:</span><span className="font-mono">{result.maxIdx}/{2 ** nc}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Precision:</span><span className="font-mono">{(2 * Math.PI / (2 ** nc)).toFixed(4)} rad</span></div>
        </div></Card>
        <Card title="How it works"><p className="text-xs text-muted-foreground">{'1. Prepare eigenstate |1⟩ of U. 2. Apply controlled-U^(2^j) for j=0..nc-1 — this encodes the phase as a binary fraction in the counting register. 3. Inverse QFT converts the phase-encoded state to a computational-basis state we can measure. More counting qubits → finer precision (2π/2^nc).'}</p></Card>
      </div>}
    </div>
  );
}