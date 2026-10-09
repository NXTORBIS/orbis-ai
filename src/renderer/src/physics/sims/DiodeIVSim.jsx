import React, { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Card, NumField, SciTable, ResearchHeader, AIPanel, useAIExplain, downloadFile } from '../research.jsx';
import { Button } from '../ui/button.jsx';
import { Download } from 'lucide-react';

// Diode I-V — Shockley equation I = Is(exp(qV/nkT) − 1) with series
// resistance and reverse breakdown. Unique engine: full I-V curve with
// ideality factor, saturation current, breakdown voltage, and series R.
const k = 1.381e-23;
const q = 1.602e-19;

export default function DiodeIVSim() {
  const [p, setP] = useState({ Is: 1e-12, n: 1.5, T: 300, Rs: 10, Vbr: -50 });
  const { explain, explaining, output } = useAIExplain();

  const data = useMemo(() => {
    const pts = [];
    const Vt = (k * p.T) / q;
    for (let V = -2; V <= 1.5; V += 0.01) {
      let I;
      if (V < p.Vbr) {
        // breakdown: exponential growth
        I = -p.Is * Math.exp(-(V - p.Vbr) / 0.5);
      } else {
        const Vd = V - I * p.Rs; // implicit; approximate with explicit
        I = p.Is * (Math.exp(V / (p.n * Vt)) - 1);
        // series resistance correction (1 iteration)
        I = p.Is * (Math.exp((V - I * p.Rs) / (p.n * Vt)) - 1);
      }
      pts.push({ V: +V.toFixed(3), I: +I.toExponential(2) });
    }
    return pts;
  }, [p]);

  const atFwd = data.find((d) => d.V >= 0.7) || {};
  return (
    <div className="space-y-3">
      <ResearchHeader title="Diode I–V" subtitle="Shockley equation I = Is·(exp(qV/nkT) − 1) with series resistance and reverse breakdown. Forward bias conducts; reverse bias blocks until breakdown."
        onExplain={() => explain(`Diode: Is=${p.Is}, n=${p.n}, T=${p.T}K, Rs=${p.Rs}Ω, Vbr=${p.Vbr}V. Forward I@0.7V=${atFwd.I}A.`)} explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr_260px]">
        <div className="space-y-3">
          <Card title="Parameters">
            <div className="space-y-2">
              <NumField label="Saturation Is" value={p.Is} onChange={(v) => setP({ ...p, Is: v })} min={1e-15} max={1e-9} step={1e-13} unit="A" />
              <NumField label="Ideality n" value={p.n} onChange={(v) => setP({ ...p, n: v })} min={1} max={2} step={0.1} />
              <NumField label="Temperature" value={p.T} onChange={(v) => setP({ ...p, T: v })} min={200} max={400} step={5} unit="K" />
              <NumField label="Series Rs" value={p.Rs} onChange={(v) => setP({ ...p, Rs: v })} min={0} max={100} step={1} unit="Ω" />
              <NumField label="Breakdown Vbr" value={p.Vbr} onChange={(v) => setP({ ...p, Vbr: v })} min={-100} max={-5} step={5} unit="V" />
            </div>
          </Card>
          <Button size="sm" variant="outline" onClick={() => downloadFile(JSON.stringify({ params: p, data }, null, 2), 'diode.json', 'application/json')}><Download className="size-3.5" />Export JSON</Button>
        </div>
        <div className="rounded-xl border border-border/60 bg-card/40 p-2" style={{ height: 420 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 6, right: 10, bottom: 20, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
              <XAxis dataKey="V" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={{ value: 'V (volts)', position: 'insideBottom', offset: -5, fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" allowDataOverflow />
              <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
              <ReferenceLine x={0} stroke="hsl(var(--border))" />
              <ReferenceLine x={p.Vbr} stroke="#ef4444" strokeDasharray="4 4" label={{ value: 'Vbr', fontSize: 9, fill: '#ef4444' }} />
              <Line type="monotone" dataKey="I" stroke="#22d3ee" dot={false} strokeWidth={1.8} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="space-y-3">
          <SciTable headers={['Quantity', 'Value']} rows={[
            ['Is', p.Is.toExponential(1) + ' A'], ['n (ideality)', p.n.toFixed(1)],
            ['Vt', ((k * p.T) / q * 1000).toFixed(2) + ' mV'],
            ['Vbr', p.Vbr + ' V'], ['Rs', p.Rs + ' Ω'],
            ['I @ 0.7V', String(atFwd.I) + ' A'],
          ]} />
          <Card><p className="text-xs text-muted-foreground">Forward: exponential growth (linear on log scale). n=1 = ideal diffusion, n=2 = recombination-dominated. Series resistance bends the curve at high I. Reverse: tiny Is until avalanche breakdown at Vbr.</p></Card>
        </div>
      </div>
      <AIPanel output={output} />
    </div>
  );
}