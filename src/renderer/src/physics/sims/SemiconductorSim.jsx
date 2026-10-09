import React, { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Card, NumField, SciTable, ResearchHeader, AIPanel, useAIExplain, downloadFile } from '../research.jsx';
import { Button } from '../ui/button.jsx';
import { Download } from 'lucide-react';

// Semiconductor Simulator — intrinsic carrier concentration, Fermi level,
// doping dependence. Unique engine: n_i = √(Nc·Nv)·exp(−Eg/2kT), Fermi level
// with doping, carrier concentrations vs temperature.
const k = 8.617e-5; // eV/K

export default function SemiconductorSim() {
  const [p, setP] = useState({ Eg: 1.12, mat: 'Si', Na: 0, Nd: 1e16, T: 300, meff: 1.08, meffp: 0.56 });
  const { explain, explaining, output } = useAIExplain();

  const data = useMemo(() => {
    const pts = [];
    const Nc0 = 2.8e19 * Math.pow(p.meff, 1.5);
    const Nv0 = 1.04e19 * Math.pow(p.meffp, 1.5);
    for (let T = 100; T <= 600; T += 10) {
      const Nc = Nc0 * Math.pow(T / 300, 1.5);
      const Nv = Nv0 * Math.pow(T / 300, 1.5);
      const ni = Math.sqrt(Nc * Nv) * Math.exp(-p.Eg / (2 * k * T));
      // charge neutrality: n - p = Nd - Na; n·p = ni²
      const D = p.Nd - p.Na;
      const n = 0.5 * (D + Math.sqrt(D * D + 4 * ni * ni));
      const pp = 0.5 * (-D + Math.sqrt(D * D + 4 * ni * ni));
      // Fermi level (from n = Nc exp(-(Ec-Ef)/kT))
      const Ef = p.Eg / 2 + (k * T / 2) * Math.log(Nv / Nc) + (k * T) * Math.log(n / ni || 1e-30);
      pts.push({ T, ni: +ni.toExponential(2), n: +n.toExponential(2), p: +pp.toExponential(2), Ef: +Ef.toFixed(3) });
    }
    return pts;
  }, [p]);

  const at300 = data.find((d) => d.T === 300) || {};
  const ni300 = Math.sqrt((2.8e19 * Math.pow(p.meff, 1.5)) * (1.04e19 * Math.pow(p.meffp, 1.5))) * Math.exp(-p.Eg / (2 * k * 300));

  return (
    <div className="space-y-3">
      <ResearchHeader title="Semiconductor Simulator" subtitle="Intrinsic carrier concentration n_i = √(Nc·Nv)·exp(−Eg/2kT), Fermi level and carrier density vs temperature, with donor/acceptor doping."
        onExplain={() => explain(`Semiconductor ${p.mat}: Eg=${p.Eg} eV, Nd=${p.Nd}, Na=${p.Na}, T=${p.T}K. n_i(300K)=${ni300.toExponential(2)}, n=${at300.n}, p=${at300.p}.`)} explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr_260px]">
        <div className="space-y-3">
          <Card title="Parameters">
            <div className="space-y-2">
              <label className="block text-sm"><span className="text-muted-foreground">Material</span>
                <select value={p.mat} onChange={(e) => {
                  const m = { Si: { Eg: 1.12, meff: 1.08, meffp: 0.56 }, Ge: { Eg: 0.66, meff: 0.55, meffp: 0.37 }, GaAs: { Eg: 1.42, meff: 0.067, meffp: 0.47 } };
                  const v = m[e.target.value]; setP({ ...p, mat: e.target.value, ...v });
                }} className="mt-1 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm">
                  <option value="Si" className="bg-background">Silicon (Si)</option>
                  <option value="Ge" className="bg-background">Germanium (Ge)</option>
                  <option value="GaAs" className="bg-background">GaAs</option>
                </select>
              </label>
              <NumField label="Gap Eg" value={p.Eg} onChange={(v) => setP({ ...p, Eg: v })} min={0.1} max={3} step={0.01} unit="eV" />
              <NumField label="Donor Nd" value={p.Nd} onChange={(v) => setP({ ...p, Nd: v })} min={0} max={1e19} step={1e14} unit="cm⁻³" />
              <NumField label="Acceptor Na" value={p.Na} onChange={(v) => setP({ ...p, Na: v })} min={0} max={1e19} step={1e14} unit="cm⁻³" />
              <NumField label="m*e (rel)" value={p.meff} onChange={(v) => setP({ ...p, meff: v })} min={0.01} max={2} step={0.01} />
              <NumField label="m*h (rel)" value={p.meffp} onChange={(v) => setP({ ...p, meffp: v })} min={0.01} max={2} step={0.01} />
            </div>
          </Card>
          <Button size="sm" variant="outline" onClick={() => downloadFile(JSON.stringify({ params: p, data }, null, 2), 'semiconductor.json', 'application/json')}><Download className="size-3.5" />Export JSON</Button>
        </div>
        <div className="space-y-3">
          <div className="rounded-xl border border-border/60 bg-card/40 p-2" style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 4, right: 10, bottom: 18, left: -6 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                <XAxis dataKey="T" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={{ value: 'T (K)', position: 'insideBottom', offset: -4, fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" scale="log" domain={['auto', 'auto']} />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
                <Line type="monotone" dataKey="ni" stroke="#22d3ee" dot={false} strokeWidth={1.6} isAnimationActive={false} />
                <Line type="monotone" dataKey="n" stroke="#f97316" dot={false} strokeWidth={1.6} isAnimationActive={false} />
                <Line type="monotone" dataKey="p" stroke="#a855f7" dot={false} strokeWidth={1.6} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="rounded-xl border border-border/60 bg-card/40 p-2" style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 4, right: 10, bottom: 18, left: -6 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                <XAxis dataKey="T" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={{ value: 'T (K)', position: 'insideBottom', offset: -4, fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={{ value: 'Ef (eV)', angle: -90, position: 'insideLeft', fontSize: 10 }} />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
                <ReferenceLine y={p.Eg / 2} stroke="#22d3ee" strokeDasharray="4 4" />
                <Line type="monotone" dataKey="Ef" stroke="#ef4444" dot={false} strokeWidth={1.6} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="space-y-3">
          <SciTable headers={['Property', 'Value']} rows={[
            ['Material', p.mat], ['Eg', p.Eg + ' eV'],
            ['n_i (300K)', ni300.toExponential(2)],
            ['n (300K)', String(at300.n)], ['p (300K)', String(at300.p)],
            ['Type', p.Nd > p.Na ? 'n-type' : p.Na > p.Nd ? 'p-type' : 'intrinsic'],
          ]} />
          <Card><p className="text-xs text-muted-foreground">Cyan = n_i, orange = n, purple = p. At high T, n_i exceeds doping → intrinsic regime. At low T, carriers freeze out. Fermi level shifts toward the majority-carrier band edge with doping.</p></Card>
        </div>
      </div>
      <AIPanel output={output} />
    </div>
  );
}