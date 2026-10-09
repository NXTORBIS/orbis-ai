import React, { useMemo, useState } from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { ResearchHeader, Card, SciTable, AIPanel, useAIExplain } from '../research.jsx';

// Unique particle-properties engine: plots particle mass vs spin with
// charge-colored points, and lets users filter by type, charge, and
// generation. Mass axis is logarithmic to span 11 orders of magnitude.

const PARTICLES = [
  // Fermions
  { name: 'νe',    mass: 0.000001, spin: 0.5, Q: 0,    type: 'lepton', gen: 1, color: '#64748b' },
  { name: 'νμ',    mass: 0.00019, spin: 0.5, Q: 0,    type: 'lepton', gen: 2, color: '#64748b' },
  { name: 'ντ',    mass: 0.018,   spin: 0.5, Q: 0,    type: 'lepton', gen: 3, color: '#64748b' },
  { name: 'e⁻',    mass: 0.511,   spin: 0.5, Q: -1,   type: 'lepton', gen: 1, color: '#22d3ee' },
  { name: 'u',     mass: 2.2,     spin: 0.5, Q: 0.667,type: 'quark',  gen: 1, color: '#ef4444' },
  { name: 'd',     mass: 4.7,     spin: 0.5, Q: -0.333,type: 'quark', gen: 1, color: '#ef4444' },
  { name: 's',     mass: 95,      spin: 0.5, Q: -0.333,type: 'quark', gen: 2, color: '#f97316' },
  { name: 'μ⁻',    mass: 105.7,   spin: 0.5, Q: -1,   type: 'lepton', gen: 2, color: '#22d3ee' },
  { name: 'c',     mass: 1275,    spin: 0.5, Q: 0.667,type: 'quark',  gen: 2, color: '#f97316' },
  { name: 'τ⁻',    mass: 1777,    spin: 0.5, Q: -1,   type: 'lepton', gen: 3, color: '#22d3ee' },
  { name: 'b',     mass: 4180,    spin: 0.5, Q: -0.333,type: 'quark', gen: 3, color: '#eab308' },
  { name: 't',     mass: 173000,  spin: 0.5, Q: 0.667,type: 'quark',  gen: 3, color: '#eab308' },
  // Bosons
  { name: 'γ',     mass: 0,       spin: 1,   Q: 0,    type: 'boson',  gen: 0, color: '#a855f7' },
  { name: 'g',     mass: 0,       spin: 1,   Q: 0,    type: 'boson',  gen: 0, color: '#a855f7' },
  { name: 'H',     mass: 125000,  spin: 0,   Q: 0,    type: 'boson',  gen: 0, color: '#84cc16' },
  { name: 'Z',     mass: 91188,   spin: 1,   Q: 0,    type: 'boson',  gen: 0, color: '#a855f7' },
  { name: 'W±',    mass: 80379,   spin: 1,   Q: 1,    type: 'boson',  gen: 0, color: '#a855f7' },
];

const CHARGE_COLORS = { '-1': '#22d3ee', '0': '#a855f7', '0.667': '#ef4444', '-0.333': '#f97316', '1': '#eab308' };

export default function ParticlePropertiesSim() {
  const [typeFilter, setTypeFilter] = useState('all');
  const [genFilter, setGenFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const { explain, explaining, output } = useAIExplain();

  const filtered = useMemo(() => {
    return PARTICLES.filter((p) =>
      (typeFilter === 'all' || p.type === typeFilter) &&
      (genFilter === 'all' || p.gen === parseInt(genFilter))
    ).map((p) => ({
      ...p,
      logMass: p.mass > 0 ? Math.log10(p.mass) : -6,
      chargeKey: String(p.Q),
    }));
  }, [typeFilter, genFilter]);

  return (
    <div className="space-y-4">
      <ResearchHeader title="Particle Properties" subtitle="Mass vs spin for all Standard Model particles. Mass spans 11 orders of magnitude (neutrinos to top quark). Point color = electric charge. Filter by type and generation."
        onExplain={() => explain(`Particle properties: showing ${filtered.length} particles, type=${typeFilter}, gen=${genFilter}.`)} explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
        <Card title="Mass vs Spin (log scale)">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {['all', 'quark', 'lepton', 'boson'].map((f) => <button key={f} onClick={() => setTypeFilter(f)} className={`rounded-full px-2.5 py-1 text-xs ${typeFilter === f ? 'bg-cyan-j text-background' : 'bg-card/40'}`}>{f}</button>)}
            {['all', '1', '2', '3'].map((g) => <button key={g} onClick={() => setGenFilter(g)} className={`rounded-full px-2.5 py-1 text-xs ${genFilter === g ? 'bg-cyan-j text-background' : 'bg-card/40'}`}>Gen {g}</button>)}
          </div>
          <div className="rounded-xl border border-border/60 bg-card/20" style={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 12, right: 16, bottom: 16, left: 12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                <XAxis type="number" dataKey="spin" name="Spin" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" domain={[-0.5, 1.5]} label={{ value: 'Spin (ℏ)', position: 'insideBottom', offset: -2, fontSize: 10 }} />
                <YAxis type="number" dataKey="logMass" name="log₁₀(m/MeV)" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" domain={[-7, 6]} label={{ value: 'log₁₀(m / MeV)', angle: -90, fontSize: 10, position: 'insideLeft' }} />
                <ZAxis type="number" dataKey="Q" range={[60, 200]} name="Charge" />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
                <Scatter data={filtered} onClick={(d) => setSelected(d)}>
                  {filtered.map((p, i) => <Cell key={i} fill={CHARGE_COLORS[p.chargeKey] || '#888'} fillOpacity={0.7} />)}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {Object.entries(CHARGE_COLORS).map(([q, c]) => (
              <span key={q} className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: c }} />Q={q}e</span>
            ))}
          </div>
        </Card>
        <div className="space-y-3">
          <Card title="Selected">
            {selected ? (
              <SciTable headers={['Prop', 'Value']} rows={[
                ['Name', selected.name],
                ['Mass', selected.mass > 0 ? `${selected.mass} MeV` : '0 (massless)'],
                ['Spin', selected.spin + ' ℏ'],
                ['Charge', selected.Q + ' e'],
                ['Type', selected.type],
                ['Generation', selected.gen || '—'],
              ]} />
            ) : <div className="text-xs text-muted-foreground">Click a point to inspect.</div>}
          </Card>
          <Card title="By Type">
            <SciTable headers={['Type', 'Count']} rows={
              ['quark', 'lepton', 'boson'].map((t) => [t, PARTICLES.filter((p) => p.type === t).length])
            } />
          </Card>
        </div>
      </div>
      <AIPanel output={output} />
    </div>
  );
}