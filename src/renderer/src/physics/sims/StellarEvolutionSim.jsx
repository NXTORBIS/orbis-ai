import React, { useState, useMemo } from 'react';
import { ResearchHeader, Card, AIPanel, useAIExplain, SciTable, NumField } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

// Stellar evolution: main sequence → red giant → white dwarf
// Empirical: L ∝ M^3.5, R ∝ M^0.8, T ∝ (L/R²)^0.25
function starProps(M) {
  const L = Math.pow(M, 3.5);
  const R = Math.pow(M, 0.8);
  const T = Math.pow(L / (R * R), 0.25) * 5778;
  return { M, L, R, T };
}

export default function StellarEvolutionSim() {
  const [mass, setMass] = useState(1);
  const { explain, explaining, output } = useAIExplain();

  const track = useMemo(() => {
    const out = [];
    const ms = starProps(mass);
    // Phase 1: Main sequence (stable)
    for (let i = 0; i <= 20; i++) {
      out.push({ T: +ms.T.toFixed(0), L: +ms.L.toFixed(3), phase: 'MS' });
    }
    // Phase 2: Red giant branch (L rises, T drops)
    for (let i = 1; i <= 30; i++) {
      const f = i / 30;
      const L = ms.L * (1 + f * Math.pow(mass, 2) * 50);
      const T = ms.T * (1 - f * 0.5);
      out.push({ T: +T.toFixed(0), L: +L.toFixed(3), phase: 'RGB' });
    }
    // Phase 3: Horizontal branch / AGN
    for (let i = 1; i <= 10; i++) {
      const f = i / 10;
      const L = ms.L * (1 + Math.pow(mass, 2) * 50) * (1 - f * 0.3);
      const T = ms.T * 0.5 * (1 + f * 0.3);
      out.push({ T: +T.toFixed(0), L: +L.toFixed(3), phase: 'HB' });
    }
    // Phase 4: White dwarf cooling (L drops, T drops)
    for (let i = 1; i <= 30; i++) {
      const f = i / 30;
      const L = ms.L * 0.01 * Math.pow(1 - f, 2);
      const T = 12000 * (1 - f * 0.8);
      out.push({ T: +Math.max(4000, T).toFixed(0), L: +Math.max(1e-4, L).toFixed(4), phase: 'WD' });
    }
    return out;
  }, [mass]);

  const ms = starProps(mass);
  const lifetime = Math.pow(mass, -2.5); // in solar lifetimes (~10 Gyr)

  return (
    <div className="space-y-4">
      <ResearchHeader title="Stellar Evolution — HR Track" subtitle="A star's path on the HR diagram from main sequence through red giant to white dwarf. Driven by nuclear fusion and gravity."
        onExplain={() => explain(`Stellar evolution for M=${mass} M☉. MS luminosity L=${ms.L.toFixed(2)} L☉, T_eff=${ms.T.toFixed(0)} K. Lifetime ≈ ${lifetime.toFixed(2)} solar lifetimes. The track shows expansion to red giant, then collapse to white dwarf.`)} explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <div className="space-y-3">
          <Card title="Star Parameters">
            <NumField label="Initial mass" value={mass} onChange={setMass} min={0.1} max={30} step={0.1} unit="M☉" />
          </Card>
          <SciTable headers={['Quantity', 'Value']} rows={[
            ['Luminosity', ms.L.toFixed(2) + ' L☉'],
            ['Radius', ms.R.toFixed(2) + ' R☉'],
            ['T_eff', ms.T.toFixed(0) + ' K'],
            ['MS lifetime', lifetime.toFixed(2) + ' τ☉'],
            ['End state', mass < 8 ? 'White dwarf' : 'Neutron star / BH'],
          ]} />
        </div>
        <div className="space-y-3">
          <div className="rounded-xl border border-border/60 bg-card/40 p-2" style={{ height: 340 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 8, right: 16, bottom: 30, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                <XAxis type="number" dataKey="T" domain={[30000, 2000]} scale="log" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" name="T" reversed label={{ value: 'T_eff (K, reversed)', position: 'insideBottom', offset: -14, fontSize: 10 }} />
                <YAxis type="number" dataKey="L" domain={[1e-4, 1e6]} scale="log" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" name="L" label={{ value: 'L (L☉)', angle: -90, fontSize: 10, position: 'insideLeft' }} />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
                <Scatter data={track} fill="#22d3ee" line={{ stroke: '#22d3ee', strokeWidth: 2 }} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">
            The star begins on the main sequence (hot, stable), expands and cools along the red giant branch, then collapses to a hot faint white dwarf. More massive stars burn faster (lifetime ∝ M⁻²·⁵).
          </p>
        </div>
      </div>
      <AIPanel output={output} />
    </div>
  );
}