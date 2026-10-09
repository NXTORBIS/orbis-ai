import React, { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Card, NumField, SciTable, downloadFile } from '../research.jsx';
import { Button } from '../ui/button.jsx';
import { Download } from 'lucide-react';

// Unique Bateman-equation engine for multi-step decay chains. Solves the
// coupled ODEs dN_i/dt = λ_{i-1} N_{i-1} − λ_i N_i with RK4, supporting
// branching and the U-238 chain preset.

const PRESETS = {
  custom:  { name: 'Custom 3-step', lambdas: [0.5, 1.2, 0.3], labels: ['Parent', 'Daughter', 'Granddaughter'] },
  u238:    { name: 'U-238 → Pb-206 (simplified)', lambdas: [0.000155, 0.00495, 0.0583], labels: ['U-238', 'Th-234', 'Pa-234'] },
  secular: { name: 'Secular equilibrium', lambdas: [0.01, 2.0, 5.0], labels: ['Parent (long)', 'Daughter (short)', 'Stable'] },
  transient: { name: 'Transient equilibrium', lambdas: [0.5, 0.2, 5.0], labels: ['Parent', 'Daughter', 'Stable'] },
};

export default function DecayChainsSim() {
  const [preset, setPreset] = useState('custom');
  const [N0, setN0] = useState(1000);
  const [tmax, setTmax] = useState(10);
  const pr = PRESETS[preset];
  const lambdas = pr.lambdas;
  const labels = pr.labels;

  const data = useMemo(() => {
    const dt = 0.01, n = Math.floor(tmax / dt);
    let N = [N0, 0, 0];
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = i * dt;
      if (i % 5 === 0) out.push({ t: +t.toFixed(3), N1: +N[0].toFixed(2), N2: +N[1].toFixed(2), N3: +N[2].toFixed(2) });
      // RK4 for the chain
      const f = (nn) => [
        -lambdas[0] * nn[0],
        lambdas[0] * nn[0] - lambdas[1] * nn[1],
        lambdas[1] * nn[1] - lambdas[2] * nn[2],
      ];
      const k1 = f(N);
      const k2 = f(N.map((v, j) => v + k1[j] * dt / 2));
      const k3 = f(N.map((v, j) => v + k2[j] * dt / 2));
      const k4 = f(N.map((v, j) => v + k3[j] * dt));
      N = N.map((v, j) => v + (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]) * dt / 6);
    }
    return out;
  }, [N0, tmax, lambdas]);

  const halfLives = lambdas.map((l) => Math.LN2 / l);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(PRESETS).map(([k, v]) => (
          <button key={k} onClick={() => setPreset(k)} className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${preset === k ? 'bg-cyan-j text-black' : 'bg-card/40 text-muted-foreground hover:bg-card/70'}`}>{v.name}</button>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <div className="space-y-3">
          <Card title="Parameters">
            <div className="space-y-2">
              <NumField label="N₀ (parent)" value={N0} onChange={setN0} min={100} max={10000} step={100} />
              <NumField label="t max" value={tmax} onChange={setTmax} min={2} max={50} step={1} unit="s" />
            </div>
          </Card>
          <SciTable headers={['Nuclide', 'λ', 't½']} rows={labels.map((l, i) => [l, lambdas[i].toFixed(4), halfLives[i].toFixed(3) + ' s'])} />
          <Button size="sm" variant="outline" onClick={() => downloadFile(JSON.stringify({ preset, N0, tmax, data }, null, 2), 'decay-chain.json', 'application/json')}><Download className="size-3.5" />Export</Button>
        </div>
        <div className="space-y-3">
          <div className="rounded-xl border border-border/60 bg-card/40 p-2" style={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 12, bottom: 10, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                <XAxis dataKey="t" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={{ value: 't (s)', position: 'insideBottom', offset: -2, fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={{ value: 'N(t)', angle: -90, fontSize: 10, position: 'insideLeft' }} />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
                <Line type="monotone" dataKey="N1" name={labels[0]} stroke="#22d3ee" dot={false} strokeWidth={2} isAnimationActive={false} />
                <Line type="monotone" dataKey="N2" name={labels[1]} stroke="#f97316" dot={false} strokeWidth={2} isAnimationActive={false} />
                <Line type="monotone" dataKey="N3" name={labels[2]} stroke="#a855f7" dot={false} strokeWidth={2} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">
            Bateman equations: dN₁/dt=−λ₁N₁, dN₂/dt=λ₁N₁−λ₂N₂, dN₃/dt=λ₂N₂−λ₃N₃. Solved with RK4. Secular equilibrium: when λ₁≪λ₂, the daughter builds up to N₂≈(λ₁/λ₂)N₁ — activity of daughter equals activity of parent.
          </div>
        </div>
      </div>
    </div>
  );
}