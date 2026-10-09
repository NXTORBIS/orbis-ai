import React, { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Card, NumField, SciTable, ResearchHeader, AIPanel, useAIExplain, downloadFile } from '../research.jsx';
import { Button } from '../ui/button.jsx';
import { Download } from 'lucide-react';

// Band Structure — tight-binding E(k) along Γ-X-M-Γ path in 2D square
// lattice, with s and p orbitals, gap, and Fermi level. Unique engine:
// multi-band tight-binding with nearest-neighbour hopping along the full
// irreducible Brillouin-zone path.
const PATH = [
  { label: 'Γ', k: [0, 0] }, { label: 'X', k: [Math.PI, 0] },
  { label: 'M', k: [Math.PI, Math.PI] }, { label: 'Γ', k: [0, 0] },
];

export default function BandStructureSim() {
  const [p, setP] = useState({ t: 1, tp: 0.3, Eg: 0.5, Ef: 0, bands: 2 });
  const { explain, explaining, output } = useAIExplain();

  const data = useMemo(() => {
    const pts = [];
    const N = 40;
    let cum = 0;
    for (let seg = 0; seg < PATH.length - 1; seg++) {
      const k0 = PATH[seg].k, k1 = PATH[seg + 1].k;
      const dx = k1[0] - k0[0], dy = k1[1] - k0[1];
      const segLen = Math.sqrt(dx * dx + dy * dy);
      for (let i = 0; i <= N; i++) {
        const kx = k0[0] + (dx * i) / N, ky = k0[1] + (dy * i) / N;
        const dist = cum + (i / N) * segLen;
        // s-band: E = -2t(cos kx + cos ky)
        const Es = -2 * p.t * (Math.cos(kx) + Math.cos(ky));
        // p-band (px-like): E = +2t(cos kx - cos ky) + Eg
        const Ep = 2 * p.tp * (Math.cos(kx) - Math.cos(ky)) + p.Eg;
        const row = { dist: +dist.toFixed(3), k: `${PATH[seg].label}→${PATH[seg + 1].label}` };
        row['s-band'] = +Es.toFixed(4);
        if (p.bands >= 2) row['p-band'] = +Ep.toFixed(4);
        if (p.bands >= 3) row['d-band'] = +(2 * p.t * (Math.cos(kx) + Math.cos(ky)) + 2 * p.Eg).toFixed(4);
        pts.push(row);
      }
      cum += segLen;
    }
    return pts;
  }, [p]);

  const bandKeys = p.bands === 1 ? ['s-band'] : p.bands === 2 ? ['s-band', 'p-band'] : ['s-band', 'p-band', 'd-band'];
  const colors = { 's-band': '#22d3ee', 'p-band': '#f97316', 'd-band': '#a855f7' };
  const gap = p.Eg;

  return (
    <div className="space-y-3">
      <ResearchHeader title="Band Structure" subtitle="Tight-binding E(k) along Γ→X→M→Γ in a 2D square lattice. s and p orbital bands with a tunable gap. The Fermi level decides metal vs insulator."
        onExplain={() => explain(`Band structure: t=${p.t}, tp=${p.tp}, Eg=${p.Eg} eV, Ef=${p.Ef}. ${p.bands} bands. Direct gap=${gap.toFixed(2)} eV.`)} explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr_260px]">
        <div className="space-y-3">
          <Card title="Parameters">
            <div className="space-y-2">
              <NumField label="Hopping t (s)" value={p.t} onChange={(v) => setP({ ...p, t: v })} min={0.1} max={3} step={0.1} unit="eV" />
              <NumField label="Hopping t (p)" value={p.tp} onChange={(v) => setP({ ...p, tp: v })} min={0} max={1.5} step={0.1} unit="eV" />
              <NumField label="Gap Eg" value={p.Eg} onChange={(v) => setP({ ...p, Eg: v })} min={0} max={3} step={0.1} unit="eV" />
              <NumField label="Fermi Ef" value={p.Ef} onChange={(v) => setP({ ...p, Ef: v })} min={-4} max={4} step={0.1} unit="eV" />
              <label className="block text-sm"><span className="text-muted-foreground">Bands</span>
                <select value={p.bands} onChange={(e) => setP({ ...p, bands: parseInt(e.target.value) })} className="mt-1 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm">
                  <option value={1} className="bg-background">1 (s only)</option>
                  <option value={2} className="bg-background">2 (s+p)</option>
                  <option value={3} className="bg-background">3 (s+p+d)</option>
                </select>
              </label>
            </div>
          </Card>
          <Button size="sm" variant="outline" onClick={() => downloadFile(JSON.stringify({ params: p, data }, null, 2), 'bandstructure.json', 'application/json')}><Download className="size-3.5" />Export JSON</Button>
        </div>
        <div className="rounded-xl border border-border/60 bg-card/40 p-2" style={{ height: 420 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 6, right: 10, bottom: 20, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
              <XAxis dataKey="dist" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={{ value: 'k-path (Γ→X→M→Γ)', position: 'insideBottom', offset: -5, fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={{ value: 'E (eV)', angle: -90, position: 'insideLeft', fontSize: 10 }} />
              <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
              <ReferenceLine y={p.Ef} stroke="#ef4444" strokeDasharray="4 4" label={{ value: 'Ef', fontSize: 9, fill: '#ef4444' }} />
              {bandKeys.map((k) => <Line key={k} type="monotone" dataKey={k} stroke={colors[k]} dot={false} strokeWidth={1.8} isAnimationActive={false} />)}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="space-y-3">
          <SciTable headers={['Property', 'Value']} rows={[
            ['Bands', p.bands], ['Gap Eg', gap.toFixed(2) + ' eV'], ['Fermi Ef', p.Ef.toFixed(2) + ' eV'],
            ['Ef in gap?', (p.Ef > 0 && p.Ef < gap) ? 'Yes (insulator)' : 'No (metal)'],
            ['Bandwidth s', (8 * p.t).toFixed(2) + ' eV'], ['Path', 'Γ→X→M→Γ'],
          ]} />
          <Card><p className="text-xs text-muted-foreground">If Ef falls in a gap → insulator/semiconductor. If it crosses a band → metal. The 2D square-lattice s-band spans [−4t, +4t]. Van Hove singularities occur at band extrema (saddle points at X, M).</p></Card>
        </div>
      </div>
      <AIPanel output={output} />
    </div>
  );
}