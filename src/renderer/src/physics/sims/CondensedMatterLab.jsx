import { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Card, NumField, SciTable, downloadFile } from '../research.jsx';
import { Button } from '../ui/button.jsx';
import { Download } from 'lucide-react';

const MODES = [
  { value: 'band', label: 'Band Structure (tight-binding)' },
  { value: 'dos', label: 'Density of States' },
  { value: 'pn', label: 'PN Junction' },
  { value: 'hall', label: 'Hall Effect' },
];

export default function CondensedMatterLab() {
  const [mode, setMode] = useState('band');
  const [p, setP] = useState({ t: 1, a: 1, Eg: 0, Na: 1e16, Nd: 1e16, Vbi: 0.7, eps: 11.7, B: 0.5, I: 1e-3, n: 1e16, q: 1.6e-19 });

  const res = useMemo(() => {
    const kpts = [];
    if (mode === 'band') {
      // 1D tight-binding: E(k) = E0 ± t·(1 - cos ka)  -> two bands separated by Eg
      for (let i = 0; i <= 100; i++) {
        const k = (i / 100) * 2 - 1; // -1..1 in units of π/a
        const E = p.t * (1 - Math.cos(k * Math.PI));
        kpts.push({ k: +k.toFixed(3), valence: +(-E - p.Eg / 2).toFixed(4), conduction: +(E + p.Eg / 2).toFixed(4) });
      }
      return { kpts };
    }
    if (mode === 'dos') {
      // 1D DOS g(E) ∝ 1/sqrt(E - Eedge) within each band
      for (let i = 0; i <= 100; i++) {
        const E = (i / 100) * 4 * p.t - 2 * p.t;
        const Ev = -p.t - p.Eg / 2, Ec = p.t + p.Eg / 2;
        const gv = E <= Ev ? 0 : 1 / Math.sqrt(Math.max(1e-4, E - Ev));
        const gc = E >= Ec ? 0 : 1 / Math.sqrt(Math.max(1e-4, Ec - E));
        kpts.push({ E: +E.toFixed(3), dos: +(gv + gc).toFixed(2) });
      }
      return { kpts };
    }
    if (mode === 'pn') {
      // Depletion width W = sqrt(2 eps (Na+Nd)/(q Na Nd) (Vbi - V))
      const eps0 = 8.854e-12;
      const eps = p.eps * eps0;
      const W = Math.sqrt((2 * eps * (p.Na + p.Nd)) / (p.q * p.Na * p.Nd) * p.Vbi);
      const xn = (p.Na / (p.Na + p.Nd)) * W;
      const xp = (p.Nd / (p.Na + p.Nd)) * W;
      // field profile E(x) linear, max at junction
      const pts = [];
      for (let i = 0; i <= 40; i++) {
        const x = (i / 40 - 0.5) * W * 1.5e6; // nm
        const xx = x * 1e-9;
        let E = 0;
        if (xx >= -xp && xx <= 0) E = (p.q * p.Nd * (xx + xp)) / eps;
        else if (xx > 0 && xx <= xn) E = (p.q * p.Na * (xn - xx)) / eps * -1;
        pts.push({ x: +x.toFixed(1), E: +E.toExponential(2) });
      }
      return { W: W * 1e9, xn: xn * 1e9, xp: xp * 1e9, pts };
    }
    // hall: VH = I B / (n q t), t = thickness 1um
    const t = 1e-6;
    const VH = (p.I * p.B) / (p.n * p.q * t);
    const RH = 1 / (p.n * p.q);
    return { VH, RH };
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
              {(mode === 'band' || mode === 'dos') && <>
                <NumField label="Hopping t" value={p.t} onChange={(v) => setP({ ...p, t: v })} min={0.1} max={3} step={0.1} unit="eV" />
                <NumField label="Gap Eg" value={p.Eg} onChange={(v) => setP({ ...p, Eg: v })} min={0} max={3} step={0.1} unit="eV" />
              </>}
              {mode === 'pn' && <>
                <NumField label="Na (acceptor)" value={p.Na} onChange={(v) => setP({ ...p, Na: v })} min={1e14} max={1e18} step={1e14} unit="cm⁻³" />
                <NumField label="Nd (donor)" value={p.Nd} onChange={(v) => setP({ ...p, Nd: v })} min={1e14} max={1e18} step={1e14} unit="cm⁻³" />
                <NumField label="Vbi" value={p.Vbi} onChange={(v) => setP({ ...p, Vbi: v })} min={0.1} max={1.5} step={0.05} unit="V" />
                <NumField label="εr (Si)" value={p.eps} onChange={(v) => setP({ ...p, eps: v })} min={1} max={20} step={0.1} />
              </>}
              {mode === 'hall' && <>
                <NumField label="B field" value={p.B} onChange={(v) => setP({ ...p, B: v })} min={0.01} max={2} step={0.01} unit="T" />
                <NumField label="Current I" value={p.I} onChange={(v) => setP({ ...p, I: v })} min={1e-5} max={1e-2} step={1e-5} unit="A" />
                <NumField label="Carrier n" value={p.n} onChange={(v) => setP({ ...p, n: v })} min={1e14} max={1e19} step={1e14} unit="cm⁻³" />
              </>}
            </div>
          </Card>
          {mode === 'pn' && <SciTable headers={['Quantity', 'Value']} rows={[['W (depletion)', res.W?.toFixed(2) + ' nm'], ['xp (p-side)', res.xp?.toFixed(2) + ' nm'], ['xn (n-side)', res.xn?.toFixed(2) + ' nm']]} />}
          {mode === 'hall' && <SciTable headers={['Quantity', 'Value']} rows={[['Hall voltage', res.VH?.toExponential(3) + ' V'], ['Hall coeff', res.RH?.toExponential(3) + ' m³/C']]} />}
          <Button size="sm" variant="outline" onClick={() => downloadFile(JSON.stringify({ mode, params: p, res }, null, 2), 'condensed.json', 'application/json')}><Download className="size-3.5" />Export JSON</Button>
        </div>
        <div className="space-y-3">
          <div className="rounded-xl border border-border/60 bg-card/40 p-2" style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={mode === 'pn' ? res.pts : res.kpts} margin={{ top: 6, right: 10, bottom: 4, left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                <XAxis dataKey={mode === 'pn' ? 'x' : mode === 'dos' ? 'E' : 'k'} tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={{ value: mode === 'pn' ? 'x (nm)' : mode === 'dos' ? 'E (eV)' : 'k (π/a)', position: 'insideBottom', offset: -2, fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
                <ReferenceLine y={0} stroke="hsl(var(--border))" />
                {mode === 'band' ? <><Line type="monotone" dataKey="valence" stroke="#f97316" dot={false} strokeWidth={1.6} isAnimationActive={false} /><Line type="monotone" dataKey="conduction" stroke="#22d3ee" dot={false} strokeWidth={1.6} isAnimationActive={false} /></>
                  : mode === 'dos' ? <Line type="monotone" dataKey="dos" stroke="#a855f7" dot={false} strokeWidth={1.6} isAnimationActive={false} />
                  : <Line type="monotone" dataKey="E" stroke="#22d3ee" dot={false} strokeWidth={1.6} isAnimationActive={false} />}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">
            {mode === 'band' ? '1D tight-binding dispersion E(k) = ±t(1−cos ka) with gap Eg. Orange = valence, cyan = conduction.' : mode === 'dos' ? '1D van Hove density of states g(E) with square-root singularities at band edges.' : mode === 'pn' ? 'Depletion-region electric field E(x) from Poisson’s equation (linear profile, peak at junction).' : 'Hall voltage V_H = IB/(nqt) and Hall coefficient R_H = 1/(nq).'}
          </div>
        </div>
      </div>
    </div>
  );
}