import React, { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea } from 'recharts';
import { Card, NumField, SciTable, downloadFile } from '../research.jsx';
import { Button } from '../ui/button.jsx';
import { Download } from 'lucide-react';

// Unique nuclear binding-energy engine: Weizsäcker SEMF with component
// breakdown (volume, surface, Coulomb, asymmetry, pairing), B/A vs A curve,
// and fission/fusion energy-release regions highlighted.

function semfComponents(A, Z) {
  const av = 15.8, as = 18.3, ac = 0.714, aa = 23.2, ap = 12;
  const vol = av * A;
  const surf = -as * Math.pow(A, 2 / 3);
  const coul = -ac * Z * (Z - 1) / Math.pow(A, 1 / 3);
  const asym = -aa * Math.pow(A - 2 * Z, 2) / A;
  const pair = (A % 2 === 1) ? 0 : (Z % 2 === 0 ? -ap / Math.sqrt(A) : ap / Math.sqrt(A));
  return { vol, surf, coul, asym, pair, total: vol + surf + coul + asym + pair };
}

// Beta-stable valley approximation: Z_stable ≈ A / (2 + 0.015·A^(2/3))
function zStable(A) { return Math.round(A / (2 + 0.015 * Math.pow(A, 2 / 3))); }

export default function NuclearBindingEnergySim() {
  const [Amax, setAmax] = useState(250);
  const [showComponents, setShowComponents] = useState(false);
  const [selA, setSelA] = useState(56);

  const data = useMemo(() => {
    const pts = [];
    for (let A = 1; A <= Amax; A++) {
      const Z = zStable(A);
      if (Z < 1 || Z > A) continue;
      const c = semfComponents(A, Z);
      pts.push({ A, BA: +(c.total / A).toFixed(4), vol: +(c.vol / A).toFixed(3), surf: +(c.surf / A).toFixed(3), coul: +(c.coul / A).toFixed(3), asym: +(c.asym / A).toFixed(3) });
    }
    return pts;
  }, [Amax]);

  const ironPeak = useMemo(() => {
    let max = 0, peakA = 56;
    for (const d of data) { if (d.BA > max) { max = d.BA; peakA = d.A; } }
    return { A: peakA, BA: max };
  }, [data]);

  const selDetail = useMemo(() => {
    const Z = zStable(selA);
    const c = semfComponents(selA, Z);
    return { A: selA, Z, N: selA - Z, ...c, BA: c.total / selA };
  }, [selA]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <div className="space-y-3">
          <Card title="Parameters">
            <div className="space-y-2">
              <NumField label="Max mass number A" value={Amax} onChange={setAmax} min={50} max={300} step={10} />
              <NumField label="Selected A" value={selA} onChange={setSelA} min={2} max={250} step={1} />
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input type="checkbox" checked={showComponents} onChange={(e) => setShowComponents(e.target.checked)} className="accent-cyan-500" />
                Show SEMF components
              </label>
            </div>
          </Card>
          <SciTable headers={['Quantity', 'Value']} rows={[
            ['A', selDetail.A], ['Z', selDetail.Z], ['N', selDetail.N],
            ['B/A (MeV)', selDetail.BA.toFixed(3)],
            ['Volume', selDetail.vol.toFixed(1)],
            ['Surface', selDetail.surf.toFixed(1)],
            ['Coulomb', selDetail.coul.toFixed(1)],
            ['Asymmetry', selDetail.asym.toFixed(1)],
          ]} />
          <div className="rounded-lg border border-cyan-j/30 bg-cyan-j/5 p-2.5 text-xs">
            <div className="font-semibold text-cyan-j">Iron Peak: A={ironPeak.A}</div>
            <div className="text-muted-foreground">B/A = {ironPeak.BA.toFixed(3)} MeV — most tightly bound nucleus.</div>
          </div>
          <Button size="sm" variant="outline" onClick={() => downloadFile(JSON.stringify({ Amax, ironPeak, selDetail, data }, null, 2), 'binding-energy.json', 'application/json')}><Download className="size-3.5" />Export</Button>
        </div>
        <div className="space-y-3">
          <div className="rounded-xl border border-border/60 bg-card/40 p-2" style={{ height: 340 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 12, bottom: 10, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                <XAxis dataKey="A" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={{ value: 'Mass number A', position: 'insideBottom', offset: -2, fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={{ value: 'B/A (MeV)', angle: -90, fontSize: 10, position: 'insideLeft' }} />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
                <ReferenceArea x1={2} x2={20} fill="#22d3ee" fillOpacity={0.06} />
                <ReferenceArea x1={200} x2={Amax} fill="#f97316" fillOpacity={0.06} />
                <ReferenceLine x={ironPeak.A} stroke="#fde047" strokeDasharray="4 2" label={{ value: 'Fe', fontSize: 10, fill: '#fde047' }} />
                <Line type="monotone" dataKey="BA" stroke="#22d3ee" dot={false} strokeWidth={2} isAnimationActive={false} />
                {showComponents && <>
                  <Line type="monotone" dataKey="vol" stroke="#84cc16" dot={false} strokeWidth={1} isAnimationActive={false} />
                  <Line type="monotone" dataKey="surf" stroke="#f97316" dot={false} strokeWidth={1} isAnimationActive={false} />
                  <Line type="monotone" dataKey="coul" stroke="#ef4444" dot={false} strokeWidth={1} isAnimationActive={false} />
                  <Line type="monotone" dataKey="asym" stroke="#a855f7" dot={false} strokeWidth={1} isAnimationActive={false} />
                </>}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">
            Weizsäcker semi-empirical mass formula: B = a_v·A − a_s·A^(2/3) − a_c·Z(Z−1)/A^(1/3) − a_a·(A−2Z)²/A ± δ. Peak near Fe-56 (B/A≈8.8 MeV). Fusion releases energy for A&lt;56 (cyan); fission for A&gt;56 (orange).
          </div>
        </div>
      </div>
    </div>
  );
}