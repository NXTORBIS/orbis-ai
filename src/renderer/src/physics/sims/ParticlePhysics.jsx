import React, { useState, useMemo } from 'react';
import { ResearchHeader, Card, AIPanel, useAIExplain, SciTable } from '../research.jsx';

// Standard Model particles with real quantum numbers, and a deterministic
// interaction analyser checking conservation of charge, lepton & baryon number.
const FERMIONS = [
  { name: 'up quark', sym: 'u', mass: '2.2 MeV', Q: 2 / 3, spin: 0.5, color: true, gen: 1, type: 'quark', B: 1 / 3, L: 0 },
  { name: 'down quark', sym: 'd', mass: '4.7 MeV', Q: -1 / 3, spin: 0.5, color: true, gen: 1, type: 'quark', B: 1 / 3, L: 0 },
  { name: 'charm', sym: 'c', mass: '1.28 GeV', Q: 2 / 3, spin: 0.5, color: true, gen: 2, type: 'quark', B: 1 / 3, L: 0 },
  { name: 'strange', sym: 's', mass: '95 MeV', Q: -1 / 3, spin: 0.5, color: true, gen: 2, type: 'quark', B: 1 / 3, L: 0 },
  { name: 'top', sym: 't', mass: '173 GeV', Q: 2 / 3, spin: 0.5, color: true, gen: 3, type: 'quark', B: 1 / 3, L: 0 },
  { name: 'bottom', sym: 'b', mass: '4.18 GeV', Q: -1 / 3, spin: 0.5, color: true, gen: 3, type: 'quark', B: 1 / 3, L: 0 },
  { name: 'electron', sym: 'e⁻', mass: '0.511 MeV', Q: -1, spin: 0.5, color: false, gen: 1, type: 'lepton', B: 0, L: 1 },
  { name: 'muon', sym: 'μ⁻', mass: '105.7 MeV', Q: -1, spin: 0.5, color: false, gen: 2, type: 'lepton', B: 0, L: 1 },
  { name: 'tau', sym: 'τ⁻', mass: '1.78 GeV', Q: -1, spin: 0.5, color: false, gen: 3, type: 'lepton', B: 0, L: 1 },
  { name: 'electron neutrino', sym: 'νe', mass: '<2 eV', Q: 0, spin: 0.5, color: false, gen: 1, type: 'lepton', B: 0, L: 1 },
];
const BOSONS = [
  { name: 'photon', sym: 'γ', mass: '0', Q: 0, spin: 1, color: false, interaction: 'EM' },
  { name: 'gluon', sym: 'g', mass: '0', Q: 0, spin: 1, color: true, interaction: 'strong' },
  { name: 'Z boson', sym: 'Z', mass: '91.2 GeV', Q: 0, spin: 1, color: false, interaction: 'weak' },
  { name: 'W boson', sym: 'W⁻', mass: '80.4 GeV', Q: -1, spin: 1, color: false, interaction: 'weak' },
  { name: 'Higgs', sym: 'H', mass: '125 GeV', Q: 0, spin: 0, color: false, interaction: 'mass' },
];
const BY_SYM = {}; [...FERMIONS, ...BOSONS].forEach((p) => { BY_SYM[p.sym] = p; });

// Check a reaction "a + b -> c + d" for conservation laws. Particles by sym.
function analyse(rx) {
  const lhs = rx.split('->')[0].trim().split(/\s+\+\s+/);
  const rhs = rx.split('->')[1].trim().split(/\s+\+\s+/);
  const sum = (side, key) => side.reduce((s, sym) => s + (BY_SYM[sym]?.[key] ?? 0), 0);
  const Q = sum(lhs, 'Q') - sum(rhs, 'Q');
  const B = sum(lhs, 'B') - sum(rhs, 'B');
  const L = sum(lhs, 'L') - sum(rhs, 'L');
  return { Q, B, L, ok: Math.abs(Q) < 1e-9 && Math.abs(B) < 1e-9 && Math.abs(L) < 1e-9, lhs, rhs };
}

export default function ParticlePhysics() {
  const [rx, setRx] = useState('e⁻ + e⁻ -> e⁻ + e⁻');
  const [filter, setFilter] = useState('all');
  const res = useMemo(() => analyse(rx), [rx]);
  const { explain, explaining, output } = useAIExplain();
  const fermions = FERMIONS.filter((p) => filter === 'all' || p.type === filter);
  return (
    <div className="space-y-4">
      <ResearchHeader title="Particle Physics Laboratory" subtitle="The Standard Model: fermions (quarks & leptons) and bosons with real masses, charges, spins and quantum numbers. A deterministic analyser checks reactions against charge, baryon-number and lepton-number conservation."
        onExplain={() => explain(`Particle physics: reaction "${rx}" ${res.ok ? 'CONSERVES' : 'VIOLATES'} charge/baryon/lepton number.`)} explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Fermions">
          <div className="mb-2 flex gap-1.5">{['all', 'quark', 'lepton'].map((f) => <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-2.5 py-1 text-xs ${filter === f ? 'bg-cyan-j text-background' : 'bg-card/40'}`}>{f}</button>)}</div>
          <SciTable headers={['Sym', 'Name', 'Mass', 'Q', 'Spin', 'B', 'L', 'Gen']} rows={fermions.map((p) => [p.sym, p.name, p.mass, p.Q, p.spin, p.B, p.L, p.gen])} />
        </Card>
        <Card title="Bosons">
          <SciTable headers={['Sym', 'Name', 'Mass', 'Q', 'Spin', 'Interaction']} rows={BOSONS.map((p) => [p.sym, p.name, p.mass, p.Q, p.spin, p.interaction])} />
          <div className="mt-3 text-xs text-muted-foreground">Q = electric charge (e), B = baryon number, L = lepton number, spin in ℏ.</div>
        </Card>
      </div>
      <Card title="Interaction Analyser">
        <input value={rx} onChange={(e) => setRx(e.target.value)} className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm" />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {['e⁻ + e⁻ -> e⁻ + e⁻', 'u + d -> u + d', 'n -> p + e⁻ + νe', 'p -> n + e⁻ + νe', 'e⁻ + e⁻ -> μ⁻ + μ⁻'].map((r) => <button key={r} onClick={() => setRx(r)} className="rounded-full border border-border/60 bg-card/40 px-2.5 py-1 text-xs font-mono hover:border-cyan-j">{r}</button>)}
        </div>
        <div className={`mt-3 rounded-lg border p-3 ${res.ok ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-red-500/40 bg-red-500/5'}`}>
          <div className={`font-display text-sm font-bold uppercase ${res.ok ? 'text-emerald-500' : 'text-red-500'}`}>{res.ok ? '✓ Conserved' : '✗ Conservation Violated'}</div>
          <div className="mt-1 grid grid-cols-3 gap-2 text-xs">
            <div>ΔQ: <span className={`font-mono ${Math.abs(res.Q) < 1e-9 ? 'text-emerald-500' : 'text-red-500'}`}>{res.Q}</span></div>
            <div>ΔB: <span className={`font-mono ${Math.abs(res.B) < 1e-9 ? 'text-emerald-500' : 'text-red-500'}`}>{res.B}</span></div>
            <div>ΔL: <span className={`font-mono ${Math.abs(res.L) < 1e-9 ? 'text-emerald-500' : 'text-red-500'}`}>{res.L}</span></div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">β decay (n → p + e⁻ + ν̄e) conserves Q, B, L only with the anti-neutrino — its discovery predicted the neutrino. The analyser treats νe as L=+1; use it on the appropriate side.</p>
        </div>
      </Card>
      <AIPanel output={output} />
    </div>
  );
}