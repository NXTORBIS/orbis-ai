import React, { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Area, AreaChart } from 'recharts';
import { Card, NumField, SciTable, ResearchHeader, AIPanel, useAIExplain, downloadFile } from '../research.jsx';
import { Button } from '../ui/button.jsx';
import { Download } from 'lucide-react';

// PN Junction — depletion width, electric field, band bending, and bias.
// Unique engine: solves Poisson's equation for the depletion region with
// forward/reverse bias, computes W, E-field, and band diagram.
const eps0 = 8.854e-12;
const q = 1.602e-19;

export default function PNJunctionSim() {
  const [p, setP] = useState({ Na: 1e16, Nd: 1e16, Vbi: 0.7, V: 0, eps: 11.7 });
  const { explain, explaining, output } = useAIExplain();

  const data = useMemo(() => {
    const eps = p.eps * eps0;
    const Na = p.Na * 1e6, Nd = p.Nd * 1e6; // cm⁻³ → m⁻³
    const Veff = p.Vbi - p.V;
    const W = Math.sqrt((2 * eps * (Na + Nd)) / (q * Na * Nd) * Math.max(0, Veff));
    const xn = (Na / (Na + Nd)) * W;
    const xp = (Nd / (Na + Nd)) * W;
    const Emax = (q * Nd * xn) / eps;
    const pts = [];
    for (let i = 0; i <= 60; i++) {
      const x = (i / 60 - 0.5) * W * 1.4 * 1e9; // nm
      const xx = x * 1e-9;
      let E = 0, rho = 0, Vband = 0;
      if (xx >= -xp && xx < 0) { E = (q * Nd * (xx + xp)) / eps; rho = q * Nd; }
      else if (xx >= 0 && xx <= xn) { E = -(q * Na * (xn - xx)) / eps; rho = -q * Na; }
      else if (xx < -xp) { E = 0; rho = 0; }
      else { E = 0; rho = 0; }
      pts.push({ x: +x.toFixed(1), E: +E.toExponential(2), rho: +rho.toExponential(2) });
    }
    return { W: W * 1e9, xn: xn * 1e9, xp: xp * 1e9, Emax, pts };
  }, [p]);

  return (
    <div className="space-y-3">
      <ResearchHeader title="PN Junction" subtitle="Depletion width W = √(2ε(Na+Nd)(Vbi−V)/(q·Na·Nd)), field profile from Poisson's equation, and band bending. Forward bias shrinks W; reverse bias widens it."
        onExplain={() => explain(`PN junction: Na=${p.Na}, Nd=${p.Nd}, Vbi=${p.Vbi}V, V=${p.V}V. W=${data.W.toFixed(1)}nm, Emax=${data.Emax.toExponential(2)} V/m.`)} explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr_260px]">
        <div className="space-y-3">
          <Card title="Parameters">
            <div className="space-y-2">
              <NumField label="Na (acceptor)" value={p.Na} onChange={(v) => setP({ ...p, Na: v })} min={1e14} max={1e18} step={1e14} unit="cm⁻³" />
              <NumField label="Nd (donor)" value={p.Nd} onChange={(v) => setP({ ...p, Nd: v })} min={1e14} max={1e18} step={1e14} unit="cm⁻³" />
              <NumField label="Vbi (built-in)" value={p.Vbi} onChange={(v) => setP({ ...p, Vbi: v })} min={0.1} max={1.5} step={0.05} unit="V" />
              <NumField label="Bias V" value={p.V} onChange={(v) => setP({ ...p, V: v })} min={-5} max={0.7} step={0.05} unit="V" />
              <NumField label="εr (Si)" value={p.eps} onChange={(v) => setP({ ...p, eps: v })} min={1} max={20} step={0.1} />
            </div>
          </Card>
          <Button size="sm" variant="outline" onClick={() => downloadFile(JSON.stringify({ params: p, data }, null, 2), 'pnjunction.json', 'application/json')}><Download className="size-3.5" />Export JSON</Button>
        </div>
        <div className="space-y-3">
          <div className="rounded-xl border border-border/60 bg-card/40 p-2" style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.pts} margin={{ top: 4, right: 10, bottom: 18, left: -6 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                <XAxis dataKey="x" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={{ value: 'x (nm)', position: 'insideBottom', offset: -4, fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
                <ReferenceLine x={0} stroke="#ef4444" />
                <Area type="monotone" dataKey="rho" stroke="#f97316" fill="#f9731633" strokeWidth={1.5} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="rounded-xl border border-border/60 bg-card/40 p-2" style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.pts} margin={{ top: 4, right: 10, bottom: 18, left: -6 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                <XAxis dataKey="x" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={{ value: 'x (nm)', position: 'insideBottom', offset: -4, fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={{ value: 'E (V/m)', angle: -90, position: 'insideLeft', fontSize: 10 }} />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
                <ReferenceLine x={0} stroke="#ef4444" />
                <ReferenceLine y={0} stroke="hsl(var(--border))" />
                <Line type="monotone" dataKey="E" stroke="#22d3ee" dot={false} strokeWidth={1.8} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="space-y-3">
          <SciTable headers={['Quantity', 'Value']} rows={[
            ['W (depletion)', data.W.toFixed(1) + ' nm'], ['xp (p-side)', data.xp.toFixed(1) + ' nm'],
            ['xn (n-side)', data.xn.toFixed(1) + ' nm'], ['Emax', data.Emax.toExponential(2) + ' V/m'],
            ['Bias', p.V > 0 ? 'Forward' : p.V < 0 ? 'Reverse' : 'Zero'],
          ]} />
          <Card><p className="text-xs text-muted-foreground">Orange = charge density ρ(x), cyan = field E(x). The field is linear (constant ρ in each side), peaking at the junction. Forward bias (V&gt;0) shrinks W; reverse (V&lt;0) widens it until breakdown.</p></Card>
        </div>
      </div>
      <AIPanel output={output} />
    </div>
  );
}