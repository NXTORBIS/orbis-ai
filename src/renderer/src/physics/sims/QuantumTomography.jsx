// Quantum Tomography — dedicated simulator. Reconstructs an unknown quantum
// state ρ from repeated measurements in X, Y, Z bases. Shows the exponential
// cost (3^n measurement settings for n qubits).
import React, { useState, useEffect } from 'react';
import { QState, GATES, applySingle, probs } from '../lib/qsim.js';
import { ResearchHeader, Card, NumField, SciTable } from '../research.jsx';
import { Button } from '../ui/button.jsx';

export default function QuantumTomography() {
  const [theta, setTheta] = useState(Math.PI / 3);
  const [phi, setPhi] = useState(Math.PI / 4);
  const [shots, setShots] = useState(1000);

  const c = Math.cos(theta / 2), s = Math.sin(theta / 2);
  const trueState = { x: 2 * c * s * Math.cos(phi), y: 2 * c * s * Math.sin(phi), z: c * c - s * s };

  const measureBasis = (basis) => {
    let sx = 0, sy = 0, sz = 0;
    for (let i = 0; i < shots; i++) {
      const st = new QState(1);
      const re0 = c, im0 = 0, re1 = s * Math.cos(phi), im1 = s * Math.sin(phi);
      st.re[0] = re0; st.im[0] = im0; st.re[1] = re1; st.im[1] = im1;
      let norm = Math.sqrt(re0 * re0 + im0 * im0 + re1 * re1 + im1 * im1);
      st.re[0] /= norm; st.im[0] /= norm; st.re[1] /= norm; st.im[1] /= norm;
      if (basis === 'X') applySingle(st, 0, GATES.H);
      else if (basis === 'Y') { applySingle(st, 0, GATES.S); applySingle(st, 0, GATES.H); }
      const p = probs(st); const r = Math.random() < p[1] ? 1 : 0;
      const val = r === 0 ? 1 : -1;
      if (basis === 'X') sx += val; else if (basis === 'Y') sy += val; else sz += val;
    }
    return { x: sx / shots, y: sy / shots, z: sz / shots };
  };

  const [measured, setMeasured] = useState(null);
  const run = () => { setMeasured({ X: measureBasis('X'), Y: measureBasis('Y'), Z: measureBasis('Z') }); };
  useEffect(() => { run(); }, [theta, phi, shots]);

  const rho = measured ? { 'ρ00': ((1 + measured.Z.z) / 2).toFixed(3), 'ρ01': ((measured.X.x - measured.Y.y * 0) / 2).toFixed(3) + '+' + (measured.Y.y / 2).toFixed(3) + 'i', 'ρ10': ((measured.X.x) / 2).toFixed(3) + '+' + (-measured.Y.y / 2).toFixed(3) + 'i', 'ρ11': ((1 - measured.Z.z) / 2).toFixed(3) } : null;

  const rows = [
    ['⟨X⟩', trueState.x.toFixed(3), measured ? measured.X.x.toFixed(3) : '—'],
    ['⟨Y⟩', trueState.y.toFixed(3), measured ? measured.Y.y.toFixed(3) : '—'],
    ['⟨Z⟩', trueState.z.toFixed(3), measured ? measured.Z.z.toFixed(3) : '—'],
  ];

  return (
    <div className="space-y-4">
      <ResearchHeader title="Quantum Tomography (State Reconstruction)" subtitle="Reconstruct an unknown state ρ from measurements in X, Y, Z bases. Shows the exponential cost — 3^n settings for n qubits." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="True state |ψ⟩ = cos(θ/2)|0⟩ + e^{iφ}sin(θ/2)|1⟩">
          <NumField label="θ" value={theta} onChange={setTheta} min={0} max={Math.PI} step={0.05} />
          <div className="mt-2"><NumField label="φ" value={phi} onChange={setPhi} min={0} max={2 * Math.PI} step={0.05} /></div>
          <div className="mt-2"><NumField label="shots per basis" value={shots} onChange={setShots} min={100} max={10000} step={100} /></div>
          <div className="mt-2 text-xs text-muted-foreground">Bloch: x={trueState.x.toFixed(3)} y={trueState.y.toFixed(3)} z={trueState.z.toFixed(3)}</div>
        </Card>
        <Card title="Measured expectations & reconstruction">
          <SciTable headers={['⟨σ⟩', 'True', 'Measured']} rows={rows} />
          {rho && <div className="mt-3 text-xs font-mono">ρ = [[{rho.ρ00}, {rho.ρ01}], [{rho.ρ10}, {rho.ρ11}]]</div>}
          <p className="mt-2 text-xs text-muted-foreground">ρ = ½(I + ⟨X⟩σx + ⟨Y⟩σy + ⟨Z⟩σz). More shots → closer to true values. For n qubits you need 3^n measurement configurations — the exponential cost of tomography.</p>
        </Card>
      </div>
    </div>
  );
}