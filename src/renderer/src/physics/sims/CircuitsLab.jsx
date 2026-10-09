import { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Card, NumField, SciTable, downloadFile } from '../research.jsx';
import { Button } from '../ui/button.jsx';
import { Download } from 'lucide-react';

// Real transient solver for RC / RL / RLC circuits via 4th-order Runge–Kutta.
const TYPES = [
  { value: 'rc', label: 'RC (resistor–capacitor)' },
  { value: 'rl', label: 'RL (resistor–inductor)' },
  { value: 'rlc', label: 'RLC (series, damped)' },
];

function rk4(f, y, dt) {
  const k1 = f(y);
  const y2 = y.map((v, i) => v + 0.5 * dt * k1[i]);
  const k2 = f(y2);
  const y3 = y.map((v, i) => v + 0.5 * dt * k2[i]);
  const k3 = f(y3);
  const y4 = y.map((v, i) => v + dt * k3[i]);
  const k4 = f(y4);
  return y.map((v, i) => v + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
}

function simulate(p) {
  const { type, R, L, C, V0, freq, tmax } = p;
  const dt = 1e-4;
  const n = Math.min(4000, Math.floor(tmax / dt));
  const out = [];
  const w = 2 * Math.PI * freq;
  let y = type === 'rc' ? [0] : type === 'rl' ? [0] : [0, 0];
  for (let i = 0; i <= n; i++) {
    const t = i * dt;
    const Vin = freq > 0 ? V0 * Math.sin(w * t) : V0;
    let f;
    if (type === 'rc') f = (s) => [(Vin - s[0]) / (R * C)];
    else if (type === 'rl') f = (s) => [(Vin - R * s[0]) / L];
    else f = (s) => [(Vin - R * s[0] - s[1]) / L, s[0] / C];
    const I = type === 'rc' ? (Vin - y[0]) / R : type === 'rl' ? y[0] : y[0];
    const Vc = type === 'rc' ? y[0] : type === 'rl' ? Vin - R * y[0] : y[1];
    if (i % 8 === 0) out.push({ t: +t.toFixed(4), Vin: +Vin.toFixed(4), I: +I.toFixed(4), Vc: +Vc.toFixed(4) });
    y = rk4(f, y, dt);
  }
  return out;
}

export default function CircuitsLab() {
  const [type, setType] = useState('rlc');
  const [p, setP] = useState({ R: 50, L: 0.5, C: 0.0002, V0: 5, freq: 0, tmax: 0.4 });
  const data = useMemo(() => simulate({ ...p, type }), [p, type]);

  const tau = type === 'rc' ? p.R * p.C : type === 'rl' ? p.L / p.R : null;
  const omega0 = type === 'rlc' ? 1 / Math.sqrt(p.L * p.C) : null;
  const alpha = type === 'rlc' ? p.R / (2 * p.L) : null;
  const damp = type === 'rlc' ? (alpha < omega0 ? 'Underdamped' : alpha > omega0 ? 'Overdamped' : 'Critically damped') : null;

  const stats = {
    'Type': TYPES.find((x) => x.value === type).label,
    ...(tau ? { 'τ (time const)': tau.toFixed(4) + ' s' } : {}),
    ...(omega0 ? { 'ω₀ (nat. freq)': omega0.toFixed(2) + ' rad/s' } : {}),
    ...(alpha != null ? { 'α (damping)': alpha.toFixed(2) + ' s⁻¹' } : {}),
    ...(damp ? { 'Regime': damp } : {}),
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {TYPES.map((o) => (
          <button key={o.value} onClick={() => setType(o.value)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${type === o.value ? 'bg-cyan-j text-black' : 'bg-card/40 text-muted-foreground hover:bg-card/70'}`}>{o.label}</button>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <div className="space-y-3">
          <Card title="Parameters">
            <div className="space-y-2">
              <NumField label="R" value={p.R} onChange={(v) => setP({ ...p, R: v })} min={1} max={500} step={1} unit="Ω" />
              {type !== 'rc' && <NumField label="L" value={p.L} onChange={(v) => setP({ ...p, L: v })} min={0.01} max={2} step={0.01} unit="H" />}
              {type !== 'rl' && <NumField label="C" value={p.C} onChange={(v) => setP({ ...p, C: v })} min={1e-5} max={0.01} step={1e-5} unit="F" />}
              <NumField label="Source V₀" value={p.V0} onChange={(v) => setP({ ...p, V0: v })} min={0} max={20} step={0.1} unit="V" />
              <NumField label="Drive freq" value={p.freq} onChange={(v) => setP({ ...p, freq: v })} min={0} max={200} step={1} unit="Hz" />
              <NumField label="t max" value={p.tmax} onChange={(v) => setP({ ...p, tmax: v })} min={0.05} max={2} step={0.05} unit="s" />
            </div>
          </Card>
          <SciTable headers={['Quantity', 'Value']} rows={Object.entries(stats)} />
          <Button size="sm" variant="outline" onClick={() => downloadFile(JSON.stringify({ type, params: p, data }, null, 2), 'circuit.json', 'application/json')}><Download className="size-3.5" />Export JSON</Button>
        </div>
        <div className="space-y-3">
          <div className="rounded-xl border border-border/60 bg-card/40 p-2" style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 6, right: 10, bottom: 4, left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                <XAxis dataKey="t" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={{ value: 't (s)', position: 'insideBottom', offset: -2, fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
                <ReferenceLine y={0} stroke="hsl(var(--border))" />
                <Line type="monotone" dataKey="Vin" stroke="#94a3b8" dot={false} strokeWidth={1} isAnimationActive={false} />
                <Line type="monotone" dataKey="I" stroke="#22d3ee" dot={false} strokeWidth={1.6} isAnimationActive={false} />
                <Line type="monotone" dataKey="Vc" stroke="#f97316" dot={false} strokeWidth={1.6} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">
            Real RK4 integration of the circuit ODE. Grey = source, cyan = current I, orange = capacitor voltage Vc. Set drive freq = 0 for a step response; above 0 for AC steady-state.
          </div>
        </div>
      </div>
    </div>
  );
}