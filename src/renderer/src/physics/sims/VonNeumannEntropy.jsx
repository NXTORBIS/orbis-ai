// Von Neumann Entropy — dedicated simulator for S = −Tr(ρ log ρ).
// Shows how entropy varies with mixedness, and the link to entanglement.
import React, { useState } from 'react';
import { ResearchHeader, Card, NumField, SciTable } from '../research.jsx';
import { jacobiEigen } from '../lib/numerics.js';

function vonNeumann(rho) { const eigs = jacobiEigen(rho); let S = 0; for (const e of eigs) if (e > 1e-12) S -= e * Math.log2(e); return S; }

export default function VonNeumannEntropy() {
  const [p, setP] = useState(0.3);
  const [theta, setTheta] = useState(0);

  // Mixed state diag(1-p, p)
  const rhoMixed = [[1 - p, 0], [0, p]];
  const S_mixed = vonNeumann(rhoMixed);

  // Pure state |ψ⟩ = cos(θ/2)|0⟩ + sin(θ/2)|1⟩ — entropy always 0
  const c = Math.cos(theta / 2), s = Math.sin(theta / 2);
  const rhoPure = [[c * c, c * s], [c * s, s * s]];
  const S_pure = vonNeumann(rhoPure);

  // Entanglement entropy: Bell-like state (1-p)|00⟩+p|11⟩, trace out q1
  const rhoEntangled = [[1 - p, 0], [0, p]]; // reduced state of q0
  const S_ent = vonNeumann(rhoEntangled);

  const sweepRows = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1].map((pp) => { const S = vonNeumann([[1 - pp, 0], [0, pp]]); return [pp.toFixed(1), S.toFixed(4)]; });

  return (
    <div className="space-y-4">
      <ResearchHeader title="Von Neumann Entropy (S = −Tr(ρ log ρ))" subtitle="Measures the mixedness of a quantum state. 0 for pure states, maximum (log₂d) for maximally mixed. Also quantifies entanglement." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Mixed state ρ = diag(1−p, p)">
          <NumField label="p" value={p} onChange={setP} min={0} max={1} step={0.01} />
          <div className="mt-3 rounded-lg border border-cyan-j/30 bg-cyan-j/5 p-3"><div className="font-mono text-2xl text-cyan-j">S = {S_mixed.toFixed(4)} bits</div></div>
          <p className="mt-2 text-xs text-muted-foreground">Maximum (1 bit) at p=½ — maximally mixed. Zero at p=0 or 1 — pure state.</p>
        </Card>
        <Card title="Pure state |ψ⟩ = cos(θ/2)|0⟩ + sin(θ/2)|1⟩">
          <NumField label="θ (radians)" value={theta} onChange={setTheta} min={0} max={Math.PI} step={0.05} />
          <div className="mt-3 rounded-lg border border-cyan-j/30 bg-cyan-j/5 p-3"><div className="font-mono text-2xl text-cyan-j">S = {S_pure.toFixed(4)} bits</div></div>
          <p className="mt-2 text-xs text-muted-foreground">Always 0 — a pure state has no mixedness, regardless of superposition angle.</p>
        </Card>
      </div>
      <Card title="Entropy vs mixedness (sweep)">
        <SciTable headers={['p', 'S (bits)']} rows={sweepRows} />
        <p className="mt-2 text-xs text-muted-foreground">The curve peaks at p=½ (S=1) and vanishes at the extremes. This same formula gives the entanglement entropy when ρ is a reduced density matrix of a pure bipartite state.</p>
      </Card>
    </div>
  );
}