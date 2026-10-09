import React, { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Card, NumField, SciTable, downloadFile } from '../research.jsx';
import { Button } from '../ui/button.jsx';
import { Download } from 'lucide-react';

// Unique nuclear-reactions engine: Q-value calculator from atomic masses,
// threshold energy for endothermic reactions, and 1/v cross-section model.

const uMeV = 931.494;
const MASS = {
  n: 1.008665, p: 1.007276, d: 2.014102, t: 3.016049,
  He3: 3.016029, He4: 4.002602, Li6: 6.015123, Li7: 7.016004,
  Be9: 9.012182, B10: 10.012937, B11: 11.009305, C12: 12.0,
  N14: 14.003074, O16: 15.994915, F19: 18.998403, Na23: 22.989769,
  Al27: 26.981539, U235: 235.043930, U238: 238.050788,
};

const PRESET_RXNS = [
  { label: '²H(d,n)³He',  reactants: ['d','d'],     products: ['n','He3']  },
  { label: '²H(d,p)³H',   reactants: ['d','d'],     products: ['p','t']    },
  { label: '³H(d,n)⁴He', reactants: ['t','d'],     products: ['n','He4'] },
  { label: '⁶Li(n,α)³H', reactants: ['Li6','n'],   products: ['He4','t']  },
  { label: '¹⁰B(n,α)⁷Li',reactants: ['B10','n'],   products: ['He4','Li7'] },
  { label: '⁴He(α,2p)⁶Li',reactants:['He4','He4'], products: ['p','p','Li6'] },
];

function massSum(syms) { return syms.reduce((s, k) => s + (MASS[k] || 0), 0); }

export default function NuclearReactionsSim() {
  const [rxIdx, setRxIdx] = useState(0);
  const [energy, setEnergy] = useState(1.0); // projectile energy MeV
  const [sigma0, setSigma0] = useState(5.0); // cross-section at 1 eV (barns)

  const rxn = PRESET_RXNS[rxIdx];
  const Q = useMemo(() => {
    return (massSum(rxn.reactants) - massSum(rxn.products)) * uMeV;
  }, [rxn]);

  // Threshold: for a + X -> ..., E_th = -Q * (1 + m_a/m_X)
  const threshold = useMemo(() => {
    if (Q >= 0) return 0;
    const ma = MASS[rxn.reactants[0]];
    const mX = MASS[rxn.reactants[1]];
    return -Q * (1 + ma / mX);
  }, [Q, rxn]);

  // 1/v cross-section model: σ(E) = σ0 * sqrt(E0/E), E0 = 1 eV = 1e-6 MeV
  const crossData = useMemo(() => {
    const pts = [];
    for (let i = 0; i <= 100; i++) {
      const E = 0.001 + energy * (i / 100); // MeV
      const sigma = sigma0 * Math.sqrt(1e-6 / E);
      pts.push({ E: +E.toFixed(4), sigma: +sigma.toFixed(4) });
    }
    return pts;
  }, [energy, sigma0]);

  const canReact = energy >= threshold;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {PRESET_RXNS.map((r, i) => (
          <button key={i} onClick={() => setRxIdx(i)} className={`rounded-full px-3 py-1.5 text-xs font-mono transition ${rxIdx === i ? 'bg-cyan-j text-black' : 'bg-card/40 text-muted-foreground hover:bg-card/70'}`}>{r.label}</button>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <div className="space-y-3">
          <Card title="Parameters">
            <div className="space-y-2">
              <NumField label="Projectile E (MeV)" value={energy} onChange={setEnergy} min={0.001} max={50} step={0.1} />
              <NumField label="σ₀ at 1 eV (barns)" value={sigma0} onChange={setSigma0} min={0.1} max={50} step={0.1} />
            </div>
          </Card>
          <SciTable headers={['Quantity', 'Value']} rows={[
            ['Reaction', rxn.label],
            ['Q-value', Q.toFixed(3) + ' MeV'],
            ['Type', Q >= 0 ? 'Exothermic' : 'Endothermic'],
            ['Threshold', threshold.toFixed(3) + ' MeV'],
            ['Can react', canReact ? '✓ Yes' : '✗ Below threshold'],
            ['σ at E', (sigma0 * Math.sqrt(1e-6 / energy)).toFixed(3) + ' b'],
          ]} />
          <div className={`rounded-lg border p-2.5 text-xs ${canReact ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-red-500/40 bg-red-500/5'}`}>
            <div className={`font-semibold ${canReact ? 'text-emerald-500' : 'text-red-500'}`}>{canReact ? 'Reaction allowed' : 'Below threshold'}</div>
            <div className="text-muted-foreground">Q = Δm·c². Endothermic reactions need E ≥ E_th = −Q(1+m_a/m_X).</div>
          </div>
          <Button size="sm" variant="outline" onClick={() => downloadFile(JSON.stringify({ reaction: rxn, Q, threshold, energy, sigma0, crossData }, null, 2), 'nuclear-reaction.json', 'application/json')}><Download className="size-3.5" />Export</Button>
        </div>
        <div className="space-y-3">
          <div className="rounded-xl border border-border/60 bg-card/40 p-2" style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={crossData} margin={{ top: 8, right: 12, bottom: 10, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                <XAxis dataKey="E" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={{ value: 'Energy (MeV)', position: 'insideBottom', offset: -2, fontSize: 10 }} />
                <YAxis dataKey="sigma" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={{ value: 'σ (barns)', angle: -90, fontSize: 10, position: 'insideLeft' }} />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
                {threshold > 0 && threshold < energy && <ReferenceLine x={threshold} stroke="#ef4444" strokeDasharray="4 2" label={{ value: 'E_th', fontSize: 9, fill: '#ef4444' }} />}
                <Line type="monotone" dataKey="sigma" stroke="#22d3ee" dot={false} strokeWidth={2} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">
            Q-value from mass defect: Q = (Σm_reactants − Σm_products)·931.5 MeV/u. Positive Q releases energy (exothermic). Negative Q requires threshold energy from the projectile. Cross-section follows the 1/v law at low energies: σ ∝ 1/√E.
          </div>
        </div>
      </div>
    </div>
  );
}