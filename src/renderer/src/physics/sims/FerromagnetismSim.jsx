import React, { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Card, NumField, SciTable, ResearchHeader, AIPanel, useAIExplain, downloadFile } from '../research.jsx';
import { Button } from '../ui/button.jsx';
import { Download } from 'lucide-react';

// Ferromagnetism — mean-field M(T) = tanh(Tc·M/T) solved self-consistently,
// plus a hysteresis M(H) loop (Jiles-Atherton-style). Unique engine: solves
// the mean-field equation iteratively for M(T) and simulates a hysteresis
// loop with coercivity and remanence.
function solveMF(Tc, T) {
  // M = tanh(Tc M / T); solve by fixed-point iteration
  let M = 0.5;
  for (let i = 0; i < 100; i++) M = Math.tanh((Tc * M) / T);
  return M;
}

export default function FerromagnetismSim() {
  const [p, setP] = useState({ Tc: 1043, Ms: 1, a: 0.1, k: 0.05, Hmax: 2 });
  const { explain, explaining, output } = useAIExplain();

  const mT = useMemo(() => {
    const pts = [];
    for (let T = 10; T <= 1500; T += 10) {
      const M = T < p.Tc ? solveMF(p.Tc, T) * p.Ms : 0;
      pts.push({ T, M: +M.toFixed(4) });
    }
    return pts;
  }, [p]);

  const hyst = useMemo(() => {
    // Simple hysteresis: M = Ms * tanh((H ± Hc)/a), with Hc = k*Ms
    const pts = [];
    const Hc = p.k * p.Ms * 5;
    for (let i = 0; i <= 200; i++) {
      const phase = i / 200;
      const H = p.Hmax * Math.cos(phase * 2 * Math.PI);
      const branch = Math.sin(phase * 2 * Math.PI) > 0 ? 1 : -1;
      const M = p.Ms * Math.tanh((H + branch * Hc) / (p.a * p.Ms * 2));
      pts.push({ H: +H.toFixed(3), M: +M.toFixed(4) });
    }
    return { pts, Hc, Mr: p.Ms * Math.tanh(Hc / (p.a * p.Ms * 2)) };
  }, [p]);

  return (
    <div className="space-y-3">
      <ResearchHeader title="Ferromagnetism" subtitle="Mean-field M(T) = tanh(Tc·M/T) below Curie temperature Tc, plus a hysteresis M(H) loop with coercivity and remanence. Spontaneous order below Tc."
        onExplain={() => explain(`Ferromagnet: Tc=${p.Tc}K, Ms=${p.Ms}. Hc=${hyst.Hc.toFixed(3)}, Mr=${hyst.Mr.toFixed(3)}.`)} explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr_260px]">
        <div className="space-y-3">
          <Card title="Parameters">
            <div className="space-y-2">
              <NumField label="Curie Tc" value={p.Tc} onChange={(v) => setP({ ...p, Tc: v })} min={10} max={1500} step={10} unit="K" />
              <NumField label="Ms (saturation)" value={p.Ms} onChange={(v) => setP({ ...p, Ms: v })} min={0.1} max={2} step={0.1} />
              <NumField label="a (aniso)" value={p.a} onChange={(v) => setP({ ...p, a: v })} min={0.02} max={0.5} step={0.02} />
              <NumField label="k (coercivity)" value={p.k} onChange={(v) => setP({ ...p, k: v })} min={0.01} max={0.3} step={0.01} />
              <NumField label="Hmax" value={p.Hmax} onChange={(v) => setP({ ...p, Hmax: v })} min={0.5} max={5} step={0.1} unit="T" />
            </div>
          </Card>
          <Button size="sm" variant="outline" onClick={() => downloadFile(JSON.stringify({ params: p, mT, hyst }, null, 2), 'ferro.json', 'application/json')}><Download className="size-3.5" />Export JSON</Button>
        </div>
        <div className="space-y-3">
          <div className="rounded-xl border border-border/60 bg-card/40 p-2" style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={mT} margin={{ top: 4, right: 10, bottom: 18, left: -6 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                <XAxis dataKey="T" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={{ value: 'T (K)', position: 'insideBottom', offset: -4, fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={{ value: 'M', angle: -90, position: 'insideLeft', fontSize: 10 }} />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
                <ReferenceLine x={p.Tc} stroke="#ef4444" strokeDasharray="4 4" label={{ value: 'Tc', fontSize: 9, fill: '#ef4444' }} />
                <Line type="monotone" dataKey="M" stroke="#22d3ee" dot={false} strokeWidth={1.8} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="rounded-xl border border-border/60 bg-card/40 p-2" style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={hyst.pts} margin={{ top: 4, right: 10, bottom: 18, left: -6 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                <XAxis dataKey="H" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={{ value: 'H (T)', position: 'insideBottom', offset: -4, fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={{ value: 'M', angle: -90, position: 'insideLeft', fontSize: 10 }} />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
                <ReferenceLine x={0} stroke="hsl(var(--border))" /><ReferenceLine y={0} stroke="hsl(var(--border))" />
                <Line type="monotone" dataKey="M" stroke="#f97316" dot={false} strokeWidth={1.8} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="space-y-3">
          <SciTable headers={['Quantity', 'Value']} rows={[
            ['Tc', p.Tc + ' K'], ['Ms', p.Ms.toFixed(2)],
            ['Hc (coercivity)', hyst.Hc.toFixed(3)], ['Mr (remanence)', hyst.Mr.toFixed(3)],
            ['T &lt; Tc', 'Ferromagnetic'], ['T &gt; Tc', 'Paramagnetic'],
          ]} />
          <Card><p className="text-xs text-muted-foreground">Top: M(T) vanishes at Tc (mean-field). Bottom: hysteresis loop — area = energy lost per cycle. Hard magnets (high Hc) make permanent magnets; soft magnets (low Hc) for transformers.</p></Card>
        </div>
      </div>
      <AIPanel output={output} />
    </div>
  );
}