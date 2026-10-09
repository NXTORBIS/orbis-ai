import { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Card, NumField, SciTable, downloadFile } from '../research.jsx';
import { Button } from '../ui/button.jsx';
import { Download } from 'lucide-react';

const MODES = [
  { value: 'binding', label: 'Binding Energy Curve' },
  { value: 'chain', label: 'Decay Chain (Bateman)' },
  { value: 'fission', label: 'Fission / Fusion Q-value' },
];

// Semi-empirical mass formula (Weizsäcker). Returns binding energy (MeV).
function binding(A, Z) {
  const av = 15.8, as = 18.3, ac = 0.714, aa = 23.2, ap = 12;
  const pairing = (A % 2 === 1) ? 0 : (Z % 2 === 0 ? -ap / Math.sqrt(A) : ap / Math.sqrt(A));
  return av * A - as * Math.pow(A, 2 / 3) - ac * Z * (Z - 1) / Math.pow(A, 1 / 3) - aa * Math.pow(A - 2 * Z, 2) / A + pairing;
}

// Approximate atomic masses (u) for selected nuclides for Q-value calc.
const MASS = {
  'n': 1.008665, 'p': 1.007276, 'H2': 2.014102, 'H3': 3.016049, 'He3': 3.016029, 'He4': 4.002602,
  'U235': 235.043930, 'U236': 236.045568, 'Ba141': 140.914411, 'Kr92': 91.926156, 'n235': 235.043930,
};
const uMeV = 931.494;

export default function NuclearLab() {
  const [mode, setMode] = useState('binding');
  const [p, setP] = useState({ Z: 26, Amin: 1, Amax: 250, N0: 1000, l1: 0.5, l2: 1.2, l3: 0.3, tmax: 8 });

  const res = useMemo(() => {
    if (mode === 'binding') {
      // For fixed Z, scan A >= Z; also plot B/A vs A for beta-stable valley approx (A ≈ 2Z for light, Z²/A < 41 for heavy)
      const pts = [];
      for (let A = Math.max(p.Z, 1); A <= 250; A++) {
        const Z = p.Z;
        if (Z > A) continue;
        const B = binding(A, Z);
        if (B > 0) pts.push({ A, BA: +(B / A).toFixed(4) });
      }
      return { pts };
    }
    if (mode === 'chain') {
      // Bateman: N1->N2->N3, dN1/dt=-l1 N1, dN2/dt=l1 N1 - l2 N2, dN3/dt=l2 N2 - l3 N3
      const dt = 0.02, n = Math.floor(p.tmax / dt);
      const out = [];
      let N1 = p.N0, N2 = 0, N3 = 0;
      for (let i = 0; i <= n; i++) {
        const t = i * dt;
        if (i % 3 === 0) out.push({ t: +t.toFixed(3), N1: +N1.toFixed(2), N2: +N2.toFixed(2), N3: +N3.toFixed(2) });
        const dN1 = -p.l1 * N1, dN2 = p.l1 * N1 - p.l2 * N2, dN3 = p.l2 * N2 - p.l3 * N3;
        N1 += dN1 * dt; N2 += dN2 * dt; N3 += dN3 * dt;
      }
      return { out, hl1: Math.LN2 / p.l1, hl2: Math.LN2 / p.l2, hl3: Math.LN2 / p.l3 };
    }
    // fission/fusion Q
    // U-235 + n -> Ba-141 + Kr-92 + 3n
    const mBefore = MASS['U235'] + MASS['n'];
    const mAfter = MASS['Ba141'] + MASS['Kr92'] + 3 * MASS['n'];
    const Qfission = (mBefore - mAfter) * uMeV;
    // D + T -> He-4 + n  (fusion)
    const Qfusion = (MASS['H2'] + MASS['H3'] - MASS['He4'] - MASS['n']) * uMeV;
    return { Qfission, Qfusion };
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
              {mode === 'binding' && <NumField label="Proton number Z" value={p.Z} onChange={(v) => setP({ ...p, Z: v })} min={1} max={92} step={1} />}
              {mode === 'chain' && <>
                <NumField label="N₀ (parent)" value={p.N0} onChange={(v) => setP({ ...p, N0: v })} min={100} max={10000} step={100} />
                <NumField label="λ₁" value={p.l1} onChange={(v) => setP({ ...p, l1: v })} min={0.01} max={3} step={0.01} />
                <NumField label="λ₂" value={p.l2} onChange={(v) => setP({ ...p, l2: v })} min={0.01} max={3} step={0.01} />
                <NumField label="λ₃" value={p.l3} onChange={(v) => setP({ ...p, l3: v })} min={0.01} max={3} step={0.01} />
                <NumField label="t max" value={p.tmax} onChange={(v) => setP({ ...p, tmax: v })} min={2} max={30} step={1} unit="s" />
              </>}
            </div>
          </Card>
          {mode === 'chain' && <SciTable headers={['Nuclide', 'Half-life']} rows={[['1', res.hl1?.toFixed(3) + ' s'], ['2', res.hl2?.toFixed(3) + ' s'], ['3', res.hl3?.toFixed(3) + ' s']]} />}
          {mode === 'fission' && <SciTable headers={['Reaction', 'Q (MeV)']} rows={[['²³⁵U + n → ¹⁴¹Ba + ⁹²Kr + 3n', res.Qfission?.toFixed(2)], ['²H + ³H → ⁴He + n', res.Qfusion?.toFixed(2)]]} />}
          <Button size="sm" variant="outline" onClick={() => downloadFile(JSON.stringify({ mode, params: p, res }, null, 2), 'nuclear.json', 'application/json')}><Download className="size-3.5" />Export JSON</Button>
        </div>
        <div className="space-y-3">
          <div className="rounded-xl border border-border/60 bg-card/40 p-2" style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={mode === 'binding' ? res.pts : res.out} margin={{ top: 6, right: 10, bottom: 4, left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                <XAxis dataKey={mode === 'binding' ? 'A' : 't'} tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={{ value: mode === 'binding' ? 'A' : 't (s)', position: 'insideBottom', offset: -2, fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={mode === 'binding' ? { value: 'B/A (MeV)', angle: -90, fontSize: 10, position: 'insideLeft' } : undefined} />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
                <ReferenceLine y={0} stroke="hsl(var(--border))" />
                {mode === 'binding'
                  ? <Line type="monotone" dataKey="BA" stroke="#22d3ee" dot={false} strokeWidth={1.6} isAnimationActive={false} />
                  : <><Line type="monotone" dataKey="N1" stroke="#22d3ee" dot={false} strokeWidth={1.6} isAnimationActive={false} /><Line type="monotone" dataKey="N2" stroke="#f97316" dot={false} strokeWidth={1.6} isAnimationActive={false} /><Line type="monotone" dataKey="N3" stroke="#a855f7" dot={false} strokeWidth={1.6} isAnimationActive={false} /></>}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">
            {mode === 'binding' ? 'Weizsäcker semi-empirical mass formula: binding energy per nucleon vs mass number A (fixed Z). Peak near iron-56.' : mode === 'chain' ? 'Bateman equations for a 3-step decay chain, integrated with Euler steps. Cyan = parent, orange = daughter, purple = granddaughter.' : 'Q = Δm c² from tabulated atomic masses. Fission of U-235 and D–T fusion.'}
          </div>
        </div>
      </div>
    </div>
  );
}