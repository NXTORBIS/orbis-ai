import React, { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Card, NumField, SciTable, ResearchHeader, AIPanel, useAIExplain, downloadFile } from '../research.jsx';
import { Button } from '../ui/button.jsx';
import { Download } from 'lucide-react';

// Superconductivity — BCS gap Δ(T), resistance R(T), and DOS with the gap.
// Unique engine: BCS gap equation solution Δ(T)/Δ₀ vs T/Tc (approximated),
// R(T) transition, and gapped DOS N(E) = N₀·|E|/√(E²−Δ²).
function bcsGap(t) {
  // t = T/Tc. Δ(0)/kTc = 1.764. Approximate Δ(T)/Δ0 via the standard curve.
  if (t >= 1) return 0;
  return Math.tanh(1.74 * Math.sqrt(1 - t));
}

export default function SuperconductivitySim() {
  const [p, setP] = useState({ Tc: 9.25, T: 4.2, N0: 1, D0: 1.5 });
  const { explain, explaining, output } = useAIExplain();

  const rT = useMemo(() => {
    const pts = [];
    for (let T = 1; T <= 20; T += 0.2) {
      const t = T / p.Tc;
      const D = p.D0 * bcsGap(t);
      const R = T >= p.Tc ? 1 : Math.exp(-p.D0 * bcsGap(t) / (0.086 * T)) * 0.001;
      pts.push({ T: +T.toFixed(1), gap: +D.toFixed(3), R: +R.toFixed(4) });
    }
    return pts;
  }, [p]);

  const dos = useMemo(() => {
    const pts = [];
    for (let E = -3; E <= 3; E += 0.02) {
      const t = p.T / p.Tc;
      const D = p.D0 * bcsGap(t);
      let N = 0;
      if (Math.abs(E) > D) N = p.N0 * Math.abs(E) / Math.sqrt(E * E - D * D);
      pts.push({ E: +E.toFixed(2), dos: +N.toFixed(3) });
    }
    return pts;
  }, [p]);

  const Dnow = p.D0 * bcsGap(p.T / p.Tc);

  return (
    <div className="space-y-3">
      <ResearchHeader title="Superconductivity" subtitle="BCS gap Δ(T), resistance R(T) dropping to zero at Tc, and the gapped density of states N(E) = N₀|E|/√(E²−Δ²). Cooper pairs condense below Tc."
        onExplain={() => explain(`Superconductor: Tc=${p.Tc}K, T=${p.T}K, Δ₀=${p.D0}meV. Δ(T)=${Dnow.toFixed(2)}meV. ${p.T < p.Tc ? 'Superconducting' : 'Normal'}.`)} explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr_260px]">
        <div className="space-y-3">
          <Card title="Parameters">
            <div className="space-y-2">
              <NumField label="Tc" value={p.Tc} onChange={(v) => setP({ ...p, Tc: v })} min={1} max={150} step={0.5} unit="K" />
              <NumField label="Temperature T" value={p.T} onChange={(v) => setP({ ...p, T: v })} min={0.1} max={150} step={0.1} unit="K" />
              <NumField label="Δ₀ (gap at 0)" value={p.D0} onChange={(v) => setP({ ...p, D0: v })} min={0.1} max={5} step={0.1} unit="meV" />
              <NumField label="N₀ (normal DOS)" value={p.N0} onChange={(v) => setP({ ...p, N0: v })} min={0.1} max={3} step={0.1} />
            </div>
          </Card>
          <Button size="sm" variant="outline" onClick={() => downloadFile(JSON.stringify({ params: p, rT, dos }, null, 2), 'supercon.json', 'application/json')}><Download className="size-3.5" />Export JSON</Button>
        </div>
        <div className="space-y-3">
          <div className="rounded-xl border border-border/60 bg-card/40 p-2" style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rT} margin={{ top: 4, right: 10, bottom: 18, left: -6 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                <XAxis dataKey="T" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={{ value: 'T (K)', position: 'insideBottom', offset: -4, fontSize: 10 }} />
                <YAxis yAxisId="L" tick={{ fontSize: 10 }} stroke="#22d3ee" />
                <YAxis yAxisId="R" orientation="right" tick={{ fontSize: 10 }} stroke="#f97316" />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
                <ReferenceLine yAxisId="L" x={p.Tc} stroke="#ef4444" strokeDasharray="4 4" />
                <Line yAxisId="L" type="monotone" dataKey="gap" stroke="#22d3ee" dot={false} strokeWidth={1.6} isAnimationActive={false} />
                <Line yAxisId="R" type="monotone" dataKey="R" stroke="#f97316" dot={false} strokeWidth={1.6} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="rounded-xl border border-border/60 bg-card/40 p-2" style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dos} margin={{ top: 4, right: 10, bottom: 18, left: -6 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                <XAxis dataKey="E" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={{ value: 'E (meV)', position: 'insideBottom', offset: -4, fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={{ value: 'N(E)', angle: -90, position: 'insideLeft', fontSize: 10 }} />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
                <ReferenceLine x={-Dnow} stroke="#ef4444" strokeDasharray="3 3" />
                <ReferenceLine x={Dnow} stroke="#ef4444" strokeDasharray="3 3" />
                <Line type="monotone" dataKey="dos" stroke="#a855f7" dot={false} strokeWidth={1.8} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="space-y-3">
          <SciTable headers={['Quantity', 'Value']} rows={[
            ['Tc', p.Tc + ' K'], ['T', p.T + ' K'],
            ['Δ(T)', Dnow.toFixed(3) + ' meV'], ['Δ₀', p.D0 + ' meV'],
            ['2Δ₀/kTc', (2 * p.D0 / (0.0862 * p.Tc)).toFixed(2) + ' (BCS=3.53)'],
            ['State', p.T < p.Tc ? 'Superconducting' : 'Normal'],
          ]} />
          <Card><p className="text-xs text-muted-foreground">Cyan = gap Δ(T), orange = R(T). Below Tc, Δ opens and R→0 (Cooper pairs). The DOS shows the gap with divergent peaks at ±Δ — measured by tunneling spectroscopy.</p></Card>
        </div>
      </div>
      <AIPanel output={output} />
    </div>
  );
}