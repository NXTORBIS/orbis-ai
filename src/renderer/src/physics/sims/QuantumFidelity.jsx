// Quantum Fidelity & Trace Distance — dedicated simulator.
// F(ρ,σ) measures how close two states are; D(ρ,σ) how distinguishable.
// Shows operational meanings: fidelity 1 = identical, 0 = orthogonal.
import React, { useState } from 'react';
import { ResearchHeader, Card, NumField, SciTable } from '../research.jsx';
import { jacobiEigen } from '../lib/numerics.js';

function density(psi) { const n = psi.length; const rho = Array.from({ length: n }, () => new Array(n).fill(0)); for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) rho[i][j] = psi[i] * psi[j]; return rho; }
function fidelity(rho, sigma) { const a = [Math.sqrt(Math.max(0, rho[0][0]))]; const b = [rho[0][1] / (a[0] || 1), Math.sqrt(Math.max(0, rho[1][1]))]; let dot = 0; const pa = [Math.sqrt(Math.max(0, rho[0][0])), rho[0][1] / (Math.sqrt(Math.max(1e-12, rho[0][0])))]; const pb = [Math.sqrt(Math.max(0, sigma[0][0])), sigma[0][1] / (Math.sqrt(Math.max(1e-12, sigma[0][0])))]; for (let i = 0; i < 2; i++) dot += pa[i] * pb[i]; return Math.min(1, Math.max(0, dot * dot)); }
function traceDistance(rho, sigma) { const d = rho.map((r, i) => r.map((v, j) => Math.abs(v - sigma[i][j]))); const eigs = jacobiEigen(d); return 0.5 * eigs.reduce((s, e) => s + Math.abs(e), 0); }

export default function QuantumFidelity() {
  const [theta, setTheta] = useState(Math.PI / 4);

  const rho0 = density([1, 0]);
  const psi = [Math.cos(theta / 2), Math.sin(theta / 2)];
  const sigma = density(psi);
  const F = fidelity(rho0, sigma);
  const D = traceDistance(rho0, sigma);

  const rows = [
    ['|0⟩ vs |0⟩', '1.0000', '0.0000'],
    [`|0⟩ vs |ψ(θ=${(theta * 180 / Math.PI).toFixed(0)}°)⟩`, F.toFixed(4), D.toFixed(4)],
    ['|0⟩ vs |1⟩', '0.0000', '1.0000'],
    ['|0⟩ vs |+⟩', '0.5000', '0.7071'],
  ];

  return (
    <div className="space-y-4">
      <ResearchHeader title="Quantum Fidelity & Trace Distance" subtitle="F(ρ,σ) measures overlap (1=identical, 0=orthogonal). D(ρ,σ) measures distinguishability (0=same, 1=perfectly distinguishable)." />
      <Card title="Compare |0⟩ with |ψ⟩ = cos(θ/2)|0⟩ + sin(θ/2)|1⟩">
        <NumField label="θ (radians)" value={theta} onChange={setTheta} min={0} max={Math.PI} step={0.05} />
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-cyan-j/30 bg-cyan-j/5 p-3"><div className="text-xs text-muted-foreground">Fidelity F</div><div className="font-mono text-2xl text-cyan-j">{F.toFixed(4)}</div></div>
          <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-3"><div className="text-xs text-muted-foreground">Trace distance D</div><div className="font-mono text-2xl text-orange-400">{D.toFixed(4)}</div></div>
        </div>
      </Card>
      <Card title="Reference table"><SciTable headers={['States', 'Fidelity F', 'Trace distance D']} rows={rows} />
        <p className="mt-2 text-xs text-muted-foreground">Fidelity F(ρ,σ)=|⟨ψ|φ⟩|² for pure states. Trace distance D=½‖ρ−σ‖₁. They're related: 1−F ≤ D ≤ √(1−F). D gives the maximum advantage for distinguishing the two states in a single measurement.</p>
      </Card>
    </div>
  );
}