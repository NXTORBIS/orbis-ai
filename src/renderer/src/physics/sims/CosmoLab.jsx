import { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Card, NumField, SciTable, downloadFile } from '../research.jsx';
import { Button } from '../ui/button.jsx';
import { Download } from 'lucide-react';

const MODES = [
  { value: 'hubble', label: 'Hubble Expansion' },
  { value: 'rotation', label: 'Dark Matter Rotation Curve' },
];

export default function CosmoLab() {
  const [mode, setMode] = useState('rotation');
  const [p, setP] = useState({ H0: 70, dmax: 500, Mdisk: 1e11, Rdisk: 10, Mhalo: 5e11, Rhalo: 30, rmax: 40 });

  const res = useMemo(() => {
    if (mode === 'hubble') {
      // v = H0 * d, recession; also redshift z ≈ v/c
      const c = 3e5; // km/s
      const pts = [];
      for (let d = 0; d <= p.dmax; d += p.dmax / 60) {
        const v = p.H0 * d;
        pts.push({ d: +d.toFixed(1), v: +v.toFixed(1), z: +(v / c).toFixed(5) });
      }
      const age = 1 / p.H0; // Hubble time in Gyr (H0 in km/s/Mpc -> ~14 Gyr)
      return { pts, age: (age * 0.978).toFixed(2) };
    }
    // rotation curve: v(r) = sqrt(G M(r)/r)
    // M(r): disk exponential Mdisk(1 - (1+r/Rd)e^{-r/Rd}) + halo NFW-ish Mhalo (r/(r+Rh))^2 * Mhalo
    const G = 4.3e-6; // kpc (km/s)^2 / Msun
    const pts = [];
    for (let r = 0.5; r <= p.rmax; r += p.rmax / 60) {
      const Mdisk = p.Mdisk * (1 - (1 + r / p.Rdisk) * Math.exp(-r / p.Rdisk));
      const Mhalo = p.Mhalo * Math.pow(r / (r + p.Rhalo), 2);
      const vNoHalo = Math.sqrt(G * Mdisk / r);
      const vWithHalo = Math.sqrt(G * (Mdisk + Mhalo) / r);
      pts.push({ r: +r.toFixed(2), disk: +vNoHalo.toFixed(1), total: +vWithHalo.toFixed(1) });
    }
    return { pts };
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
              {mode === 'hubble' && <>
                <NumField label="H₀" value={p.H0} onChange={(v) => setP({ ...p, H0: v })} min={40} max={100} step={1} unit="km/s/Mpc" />
                <NumField label="d max" value={p.dmax} onChange={(v) => setP({ ...p, dmax: v })} min={100} max={2000} step={50} unit="Mpc" />
              </>}
              {mode === 'rotation' && <>
                <NumField label="M disk" value={p.Mdisk} onChange={(v) => setP({ ...p, Mdisk: v })} min={1e10} max={5e11} step={1e10} unit="M☉" />
                <NumField label="R disk" value={p.Rdisk} onChange={(v) => setP({ ...p, Rdisk: v })} min={2} max={20} step={1} unit="kpc" />
                <NumField label="M halo" value={p.Mhalo} onChange={(v) => setP({ ...p, Mhalo: v })} min={0} max={2e12} step={1e11} unit="M☉" />
                <NumField label="R halo" value={p.Rhalo} onChange={(v) => setP({ ...p, Rhalo: v })} min={5} max={80} step={1} unit="kpc" />
              </>}
            </div>
          </Card>
          {mode === 'hubble' && <SciTable headers={['Quantity', 'Value']} rows={[['Hubble time', res.age + ' Gyr'], ['H₀', p.H0 + ' km/s/Mpc']]} />}
          <Button size="sm" variant="outline" onClick={() => downloadFile(JSON.stringify({ mode, params: p, res }, null, 2), 'cosmo.json', 'application/json')}><Download className="size-3.5" />Export JSON</Button>
        </div>
        <div className="space-y-3">
          <div className="rounded-xl border border-border/60 bg-card/40 p-2" style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={res.pts} margin={{ top: 6, right: 10, bottom: 4, left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                <XAxis dataKey={mode === 'hubble' ? 'd' : 'r'} tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={{ value: mode === 'hubble' ? 'd (Mpc)' : 'r (kpc)', position: 'insideBottom', offset: -2, fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={mode === 'hubble' ? { value: 'v (km/s)', angle: -90, fontSize: 10, position: 'insideLeft' } : { value: 'v (km/s)', angle: -90, fontSize: 10, position: 'insideLeft' }} />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                {mode === 'hubble'
                  ? <Line type="monotone" dataKey="v" stroke="#22d3ee" dot={false} strokeWidth={1.8} isAnimationActive={false} name="recession v" />
                  : <><Line type="monotone" dataKey="disk" stroke="#f97316" dot={false} strokeWidth={1.6} isAnimationActive={false} name="disk only" /><Line type="monotone" dataKey="total" stroke="#22d3ee" dot={false} strokeWidth={1.8} isAnimationActive={false} name="disk + halo" /></>}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">
            {mode === 'hubble' ? "Hubble's law v = H₀d with cosmological redshift z ≈ v/c. Hubble time ≈ 1/H₀ gives the age of the universe." : 'Galactic rotation curve v(r)=√(GM(r)/r). Disk-only (orange) falls off Keplerian; adding a dark-matter halo (cyan) keeps the curve flat — the classic evidence for dark matter.'}
          </div>
        </div>
      </div>
    </div>
  );
}