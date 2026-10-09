import React, { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Card, NumField, SciTable, ResearchHeader, AIPanel, useAIExplain, downloadFile } from '../research.jsx';
import { Button } from '../ui/button.jsx';
import { Download } from 'lucide-react';

// Density of States — compute g(E) from a 2D tight-binding band by
// histogramming E(k) over a dense k-mesh. Unique engine: real DOS
// extraction (not an analytic formula) showing van Hove singularities
// at saddle points.
export default function DensityOfStatesSim() {
  const [p, setP] = useState({ t: 1, Eg: 0.5, dim: 2, bins: 80, broadening: 0.05 });
  const { explain, explaining, output } = useAIExplain();

  const data = useMemo(() => {
    const Nk = 80;
    const minE = -4 * p.t - p.Eg / 2, maxE = 4 * p.t + p.Eg / 2;
    const hist = new Array(p.bins).fill(0);
    const edges = [];
    for (let i = 0; i < p.bins; i++) edges.push(minE + (i / p.bins) * (maxE - minE));
    for (let ix = 0; ix < Nk; ix++) for (let iy = 0; iy < Nk; iy++) {
      const kx = (ix / Nk) * 2 * Math.PI - Math.PI;
      const ky = (iy / Nk) * 2 * Math.PI - Math.PI;
      const Ev = -2 * p.t * (Math.cos(kx) + Math.cos(ky)) - p.Eg / 2;
      const Ec = 2 * p.t * (Math.cos(kx) + Math.cos(ky)) + p.Eg / 2;
      for (const E of [Ev, Ec]) {
        for (let b = 0; b < p.bins; b++) {
          const d = E - edges[b];
          hist[b] += Math.exp(-(d * d) / (2 * p.broadening * p.broadening));
        }
      }
    }
    const total = hist.reduce((a, b) => a + b, 0);
    return edges.map((E, i) => ({ E: +E.toFixed(3), dos: +(hist[i] / total * p.bins).toFixed(3) }));
  }, [p]);

  return (
    <div className="space-y-3">
      <ResearchHeader title="Density of States" subtitle="g(E) computed by histogramming a 2D tight-binding band over a dense k-mesh. Gaussian broadening reveals van Hove singularities at saddle points."
        onExplain={() => explain(`DOS: t=${p.t}, Eg=${p.Eg}, ${p.bins} bins, broadening=${p.broadening}. Peak g(E) at band edges = van Hove singularities.`)} explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr_260px]">
        <div className="space-y-3">
          <Card title="Parameters">
            <div className="space-y-2">
              <NumField label="Hopping t" value={p.t} onChange={(v) => setP({ ...p, t: v })} min={0.1} max={3} step={0.1} unit="eV" />
              <NumField label="Gap Eg" value={p.Eg} onChange={(v) => setP({ ...p, Eg: v })} min={0} max={3} step={0.1} unit="eV" />
              <NumField label="Bins" value={p.bins} onChange={(v) => setP({ ...p, bins: v })} min={20} max={150} step={10} />
              <NumField label="Broadening σ" value={p.broadening} onChange={(v) => setP({ ...p, broadening: v })} min={0.01} max={0.3} step={0.01} unit="eV" />
            </div>
          </Card>
          <Button size="sm" variant="outline" onClick={() => downloadFile(JSON.stringify({ params: p, data }, null, 2), 'dos.json', 'application/json')}><Download className="size-3.5" />Export JSON</Button>
        </div>
        <div className="rounded-xl border border-border/60 bg-card/40 p-2" style={{ height: 420 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 6, right: 10, bottom: 20, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
              <XAxis dataKey="E" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={{ value: 'E (eV)', position: 'insideBottom', offset: -5, fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={{ value: 'g(E)', angle: -90, position: 'insideLeft', fontSize: 10 }} />
              <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
              <ReferenceLine y={0} stroke="hsl(var(--border))" />
              <Line type="monotone" dataKey="dos" stroke="#a855f7" dot={false} strokeWidth={1.8} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="space-y-3">
          <SciTable headers={['Property', 'Value']} rows={[
            ['Bandwidth', (8 * p.t).toFixed(2) + ' eV'], ['Gap', p.Eg.toFixed(2) + ' eV'],
            ['Bins', p.bins], ['σ broadening', p.broadening + ' eV'],
            ['Peak g(E)', Math.max(...data.map((d) => d.dos)).toFixed(3)],
          ]} />
          <Card><p className="text-xs text-muted-foreground">In 2D, van Hove singularities are logarithmic divergences at saddle points (E = 0 here). In 3D they're square-root cusps. The DOS decides optical absorption, doping response, and superconductivity.</p></Card>
        </div>
      </div>
      <AIPanel output={output} />
    </div>
  );
}