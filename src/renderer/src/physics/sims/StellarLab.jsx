import { useMemo, useState } from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import { Card, NumField, SciTable, downloadFile } from '../research.jsx';
import { Button } from '../ui/button.jsx';
import { Download } from 'lucide-react';

const MODES = [
  { value: 'hr', label: 'HR Diagram + Stellar Track' },
  { value: 'pulsar', label: 'Pulsar Spin-down' },
];

// Empirical main-sequence relations: L ∝ M^3.5, R ∝ M^0.8, T_eff ∝ (L/R^2)^0.25
function star(M) {
  const L = Math.pow(M, 3.5);
  const R = Math.pow(M, 0.8);
  const T = Math.pow(L / (R * R), 0.25) * 5778; // solar T_eff scale
  return { M, L, R, T };
}

export default function StellarLab() {
  const [mode, setMode] = useState('hr');
  const [p, setP] = useState({ M: 1, P: 0.033, Pdot: 2e-15, tmax: 1e6 });

  const res = useMemo(() => {
    if (mode === 'hr') {
      const ms = [];
      for (let m = 0.1; m <= 50; m *= 1.15) {
        const s = star(m);
        ms.push({ T: +s.T.toFixed(0), L: +s.L.toFixed(3), M: +s.M.toFixed(2) });
      }
      // track for chosen mass: main sequence then giant (L rises, T drops)
      const track = [];
      for (let i = 0; i <= 40; i++) {
        const f = i / 40;
        const s = star(p.M);
        const L = s.L * (1 + f * 100); // brightens ~100x to giant branch
        const T = s.T * (1 - f * 0.45); // cools
        track.push({ T: +T.toFixed(0), L: +L.toFixed(3) });
      }
      return { ms, track, cur: star(p.M) };
    }
    // pulsar spin-down: L ∝ -I Ω Ωdot, Ωdot = -K Ω^n; evolve Ω(t)
    const I = 1e38; // moment of inertia (cgs-ish)
    const n = 3;
    let Omega = 2 * Math.PI / p.P;
    const dt = p.tmax / 200;
    const out = [];
    for (let i = 0; i <= 200; i++) {
      const t = i * dt;
      const P = 2 * Math.PI / Omega;
      const L = -0.5 * I * Omega * (-p.Pdot / (p.P * p.P) * 2 * Math.PI); // approx spin-down lum
      if (i % 4 === 0) out.push({ t: +t.toExponential(2), P: +P.toFixed(5), L: +Math.abs(L).toExponential(2) });
      const OmegaDot = -p.Pdot / (p.P * p.P) * (2 * Math.PI); // dΩ/dt from Pdot
      Omega += OmegaDot * dt;
    }
    const tau = p.P / (2 * p.Pdot); // characteristic age
    const B = 3.2e19 * Math.sqrt(p.P * p.Pdot); // surface B (Gauss)
    return { out, tau, B };
  }, [mode, p]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {MODES.map((o) => (
          <button key={o.value} onClick={() => setMode(o.value)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${mode === o.value ? 'bg-cyan-j text-black' : 'bg-card/40 text-muted-foreground hover:bg-card/70'}`}>{o.label}</button>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <div className="space-y-3">
          <Card title="Parameters">
            <div className="space-y-2">
              {mode === 'hr' && <NumField label="Stellar mass M" value={p.M} onChange={(v) => setP({ ...p, M: v })} min={0.1} max={50} step={0.1} unit="M☉" />}
              {mode === 'pulsar' && <>
                <NumField label="Period P" value={p.P} onChange={(v) => setP({ ...p, P: v })} min={0.001} max={1} step={0.001} unit="s" />
                <NumField label="Ṗ (P-dot)" value={p.Pdot} onChange={(v) => setP({ ...p, Pdot: v })} min={1e-18} max={1e-12} step={1e-16} />
                <NumField label="t max" value={p.tmax} onChange={(v) => setP({ ...p, tmax: v })} min={1e3} max={1e7} step={1e4} unit="yr" />
              </>}
            </div>
          </Card>
          {mode === 'hr' && res.cur && <SciTable headers={['Quantity', 'Value']} rows={[['Mass', res.cur.M + ' M☉'], ['Luminosity', res.cur.L.toFixed(2) + ' L☉'], ['Radius', res.cur.R.toFixed(2) + ' R☉'], ['T_eff', res.cur.T.toFixed(0) + ' K']]} />}
          {mode === 'pulsar' && <SciTable headers={['Quantity', 'Value']} rows={[['Char. age τ', res.tau?.toExponential(2) + ' yr'], ['B surface', res.B?.toExponential(2) + ' G']]} />}
          <Button size="sm" variant="outline" onClick={() => downloadFile(JSON.stringify({ mode, params: p, res }, null, 2), 'stellar.json', 'application/json')}><Download className="size-3.5" />Export JSON</Button>
        </div>
        <div className="space-y-3">
          <div className="rounded-xl border border-border/60 bg-card/40 p-2" style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              {mode === 'hr' ? (
                <ScatterChart margin={{ top: 8, right: 16, bottom: 30, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                  <XAxis type="number" dataKey="T" domain={[50000, 2000]} scale="log" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" name="T" reversed label={{ value: 'T_eff (K, reversed)', position: 'insideBottom', offset: -14, fontSize: 10 }} />
                  <YAxis type="number" dataKey="L" domain={[1e-4, 1e6]} scale="log" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" name="L" label={{ value: 'L (L☉)', angle: -90, fontSize: 10, position: 'insideLeft' }} />
                  <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
                  <Scatter data={res.ms} fill="#94a3b8" fillOpacity={0.5} />
                  <Scatter data={res.track} fill="#22d3ee" line={{ stroke: '#22d3ee', strokeWidth: 1.5 }} />
                </ScatterChart>
              ) : (
                <LineChart data={res.out} margin={{ top: 6, right: 10, bottom: 4, left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                  <XAxis dataKey="t" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={{ value: 't (yr)', position: 'insideBottom', offset: -2, fontSize: 10 }} />
                  <YAxis yAxisId="L" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
                  <Line yAxisId="L" type="monotone" dataKey="L" stroke="#22d3ee" dot={false} strokeWidth={1.6} isAnimationActive={false} />
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>
          <div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">
            {mode === 'hr' ? 'Hertzsprung–Russell diagram from empirical main-sequence relations (L∝M^3.5, T_eff∝(L/R²)^¼). Grey = main sequence, cyan = evolutionary track for the chosen mass.' : 'Pulsar spin-down luminosity L(t) from Ṗ and P. Characteristic age τ = P/2Ṗ and surface magnetic field B = 3.2×10¹⁹√(PṖ) G.'}
          </div>
        </div>
      </div>
    </div>
  );
}