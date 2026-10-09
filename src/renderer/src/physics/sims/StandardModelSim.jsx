import React, { useState } from 'react';
import { ResearchHeader, Card, SciTable, AIPanel, useAIExplain } from '../research.jsx';

// Unique Standard Model explorer: interactive particle table with all
// fermions (quarks & leptons across 3 generations) and bosons, with force
// interactions and quantum numbers. No computation shared with any other sim.

const FERMIONS = [
  // Quarks
  { gen: 1, type: 'quark', name: 'up',        sym: 'u', mass: '2.2 MeV',  Q: '+2/3', spin: '1/2', color: true,  B: '1/3', L: '0', force: 'all' },
  { gen: 1, type: 'quark', name: 'down',      sym: 'd', mass: '4.7 MeV',  Q: '-1/3', spin: '1/2', color: true,  B: '1/3', L: '0', force: 'all' },
  { gen: 2, type: 'quark', name: 'charm',     sym: 'c', mass: '1.28 GeV', Q: '+2/3', spin: '1/2', color: true,  B: '1/3', L: '0', force: 'all' },
  { gen: 2, type: 'quark', name: 'strange',   sym: 's', mass: '95 MeV',   Q: '-1/3', spin: '1/2', color: true,  B: '1/3', L: '0', force: 'all' },
  { gen: 3, type: 'quark', name: 'top',       sym: 't', mass: '173 GeV',  Q: '+2/3', spin: '1/2', color: true,  B: '1/3', L: '0', force: 'all' },
  { gen: 3, type: 'quark', name: 'bottom',    sym: 'b', mass: '4.18 GeV', Q: '-1/3', spin: '1/2', color: true,  B: '1/3', L: '0', force: 'all' },
  // Leptons
  { gen: 1, type: 'lepton', name: 'electron',     sym: 'e⁻',  mass: '0.511 MeV', Q: '-1', spin: '1/2', color: false, B: '0', L: '1', force: 'EM+weak' },
  { gen: 1, type: 'lepton', name: 'e neutrino',    sym: 'νe',   mass: '<2 eV',     Q: '0',  spin: '1/2', color: false, B: '0', L: '1', force: 'weak' },
  { gen: 2, type: 'lepton', name: 'muon',          sym: 'μ⁻',   mass: '105.7 MeV', Q: '-1', spin: '1/2', color: false, B: '0', L: '1', force: 'EM+weak' },
  { gen: 2, type: 'lepton', name: 'μ neutrino',    sym: 'νμ',   mass: '<0.19 MeV', Q: '0',  spin: '1/2', color: false, B: '0', L: '1', force: 'weak' },
  { gen: 3, type: 'lepton', name: 'tau',            sym: 'τ⁻',   mass: '1.78 GeV',  Q: '-1', spin: '1/2', color: false, B: '0', L: '1', force: 'EM+weak' },
  { gen: 3, type: 'lepton', name: 'τ neutrino',     sym: 'ντ',   mass: '<18 MeV',   Q: '0',  spin: '1/2', color: false, B: '0', L: '1', force: 'weak' },
];

const BOSONS = [
  { name: 'photon',  sym: 'γ', mass: '0',       Q: '0', spin: '1', force: 'Electromagnetic', range: '∞' },
  { name: 'gluon',   sym: 'g', mass: '0',       Q: '0', spin: '1', force: 'Strong',          range: 'short (confined)' },
  { name: 'W boson', sym: 'W±', mass: '80.4 GeV', Q: '±1', spin: '1', force: 'Weak (charged)', range: 'very short' },
  { name: 'Z boson', sym: 'Z',  mass: '91.2 GeV', Q: '0',  spin: '1', force: 'Weak (neutral)', range: 'very short' },
  { name: 'Higgs',   sym: 'H',  mass: '125 GeV',  Q: '0',  spin: '0', force: 'Mass (Yukawa)',  range: 'short' },
];

const FORCES = [
  { name: 'Strong',          sym: 'g',  strength: '1',      range: '10⁻¹⁵ m',  carrier: 'gluon' },
  { name: 'Electromagnetic',  sym: 'γ',  strength: '1/137',  range: '∞',         carrier: 'photon' },
  { name: 'Weak',             sym: 'W,Z', strength: '10⁻⁶',  range: '10⁻¹⁸ m',  carrier: 'W, Z bosons' },
  { name: 'Gravity',          sym: 'G',  strength: '10⁻³⁹', range: '∞',         carrier: '(graviton?)' },
];

export default function StandardModelSim() {
  const [filter, setFilter] = useState('all');
  const [genFilter, setGenFilter] = useState('all');
  const { explain, explaining, output } = useAIExplain();

  const fermions = FERMIONS.filter((p) =>
    (filter === 'all' || p.type === filter) && (genFilter === 'all' || p.gen === parseInt(genFilter))
  );

  return (
    <div className="space-y-4">
      <ResearchHeader title="Standard Model Explorer" subtitle="All known fundamental particles: 12 fermions (6 quarks + 6 leptons in 3 generations) and 5 bosons. Three forces are mediated by gauge bosons; gravity is not part of the Standard Model."
        onExplain={() => explain(`Standard Model: ${FERMIONS.length} fermions, ${BOSONS.length} bosons, ${FORCES.length} forces. Currently showing ${filter} / gen ${genFilter}.`)} explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Fermions (matter)">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {['all', 'quark', 'lepton'].map((f) => <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-2.5 py-1 text-xs ${filter === f ? 'bg-cyan-j text-background' : 'bg-card/40'}`}>{f}</button>)}
            {['all', '1', '2', '3'].map((g) => <button key={g} onClick={() => setGenFilter(g)} className={`rounded-full px-2.5 py-1 text-xs ${genFilter === g ? 'bg-cyan-j text-background' : 'bg-card/40'}`}>Gen {g}</button>)}
          </div>
          <SciTable headers={['Sym', 'Name', 'Mass', 'Q', 'Spin', 'B', 'L']} rows={fermions.map((p) => [p.sym, p.name, p.mass, p.Q, p.spin, p.B, p.L])} />
        </Card>
        <div className="space-y-4">
          <Card title="Bosons (force carriers)">
            <SciTable headers={['Sym', 'Name', 'Mass', 'Q', 'Spin', 'Force']} rows={BOSONS.map((p) => [p.sym, p.name, p.mass, p.Q, p.spin, p.force])} />
          </Card>
          <Card title="Fundamental Forces">
            <SciTable headers={['Force', 'Strength', 'Range', 'Carrier']} rows={FORCES.map((f) => [f.name, f.strength, f.range, f.carrier])} />
          </Card>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-cyan-j/30 bg-cyan-j/5 p-3">
          <div className="text-xs font-semibold uppercase text-cyan-j">Quarks</div>
          <div className="mt-1 text-xs text-muted-foreground">Feel all 4 forces. Carry color charge (strong) and electric charge. Confined — never found alone.</div>
        </div>
        <div className="rounded-xl border border-orange-500/30 bg-orange-500/5 p-3">
          <div className="text-xs font-semibold uppercase text-orange-500">Leptons</div>
          <div className="mt-1 text-xs text-muted-foreground">No color charge. Charged leptons (e, μ, τ) feel EM + weak. Neutrinos only feel weak.</div>
        </div>
        <div className="rounded-xl border border-purple-500/30 bg-purple-500/5 p-3">
          <div className="text-xs font-semibold uppercase text-purple-500">Bosons</div>
          <div className="mt-1 text-xs text-muted-foreground">Force mediators. Integer spin. Higgs gives mass to W, Z and fermions via Yukawa coupling.</div>
        </div>
      </div>
      <AIPanel output={output} />
    </div>
  );
}