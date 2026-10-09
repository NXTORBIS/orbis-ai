import React, { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Card, NumField, SciTable, ResearchHeader, AIPanel, useAIExplain, downloadFile } from '../research.jsx';
import { Button } from '../ui/button.jsx';
import { Download } from 'lucide-react';

// Hall Effect — transverse voltage V_H = IB/(nqt), Hall coefficient
// R_H = 1/(nq), carrier sign and density. Unique engine: full Hall bar
// geometry with carrier type, field sweep, and Hall voltage.
const q = 1.602e-19;

export default function HallEffectSim() {
  const [p, setP] = useState({ B: 0.5, I: 1e-3, n: 1e16, t: 1e-6, carrier: 'electron' });
  const { explain, explaining, output } = useAIExplain();

  const data = useMemo(() => {
    const pts = [];
    const sign = p.carrier === 'electron' ? -1 : 1;
    for (let B = -2; B <= 2; B += 0.05) {
      const VH = (p.I * B) / (p.n * q * p.t) * sign;
      const RH = 1 / (p.n * q) * sign;
      pts.push({ B: +B.toFixed(2), VH: +VH.toExponential(2), RH: +RH.toExponential(2) });
    }
    return pts;
  }, [p]);

  const VH = (p.I * p.B) / (p.n * q * p.t) * (p.carrier === 'electron' ? -1 : 1);
  const RH = 1 / (p.n * q) * (p.carrier === 'electron' ? -1 : 1);

  return (
    <div className="space-y-3">
      <ResearchHeader title="Hall Effect" subtitle="Transverse voltage V_H = IB/(nqt) perpendicular to current and field. Sign of V_H reveals carrier type (electron vs hole); magnitude gives density."
        onExplain={() => explain(`Hall effect: B=${p.B}T, I=${p.I}A, n=${p.n}, carrier=${p.carrier}. V_H=${VH.toExponential(2)}V, R_H=${RH.toExponential(2)}m³/C.`)} explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr_260px]">
        <div className="space-y-3">
          <Card title="Parameters">
            <div className="space-y-2">
              <NumField label="B field" value={p.B} onChange={(v) => setP({ ...p, B: v })} min={-2} max={2} step={0.01} unit="T" />
              <NumField label="Current I" value={p.I} onChange={(v) => setP({ ...p, I: v })} min={1e-5} max={1e-2} step={1e-5} unit="A" />
              <NumField label="Carrier n" value={p.n} onChange={(v) => setP({ ...p, n: v })} min={1e14} max={1e20} step={1e14} unit="cm⁻³" />
              <NumField label="Thickness t" value={p.t} onChange={(v) => setP({ ...p, t: v })} min={1e-7} max={1e-5} step={1e-7} unit="m" />
              <label className="block text-sm"><span className="text-muted-foreground">Carrier type</span>
                <select value={p.carrier} onChange={(e) => setP({ ...p, carrier: e.target.value })} className="mt-1 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm">
                  <option value="electron" className="bg-background">Electron (n)</option>
                  <option value="hole" className="bg-background">Hole (p)</option>
                </select>
              </label>
            </div>
          </Card>
          <Button size="sm" variant="outline" onClick={() => downloadFile(JSON.stringify({ params: p, data }, null, 2), 'hall.json', 'application/json')}><Download className="size-3.5" />Export JSON</Button>
        </div>
        <div className="rounded-xl border border-border/60 bg-card/40 p-2" style={{ height: 420 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 6, right: 10, bottom: 20, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
              <XAxis dataKey="B" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={{ value: 'B (T)', position: 'insideBottom', offset: -5, fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={{ value: 'V_H (V)', angle: -90, position: 'insideLeft', fontSize: 10 }} />
              <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
              <ReferenceLine x={0} stroke="hsl(var(--border))" />
              <ReferenceLine y={0} stroke="hsl(var(--border))" />
              <Line type="monotone" dataKey="VH" stroke={p.carrier === 'electron' ? '#22d3ee' : '#f97316'} dot={false} strokeWidth={1.8} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="space-y-3">
          <SciTable headers={['Quantity', 'Value']} rows={[
            ['V_H', VH.toExponential(3) + ' V'], ['R_H', RH.toExponential(3) + ' m³/C'],
            ['Carrier', p.carrier === 'electron' ? 'Electron (−)' : 'Hole (+)'],
            ['n', p.n.toExponential(1) + ' cm⁻³'], ['μ = R_H/ρ', '— (need ρ)'],
            ['Slope dV_H/dB', ((p.I) / (p.n * q * p.t) * (p.carrier === 'electron' ? -1 : 1)).toExponential(2) + ' V/T'],
          ]} />
          <Card><p className="text-xs text-muted-foreground">V_H is linear in B with a slope that gives carrier density. Negative slope = electrons; positive = holes. The Hall effect is the basis of magnetic sensors (Hall probes) and carrier characterisation in semiconductors.</p></Card>
        </div>
      </div>
      <AIPanel output={output} />
    </div>
  );
}