import React, { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea } from 'recharts';
import { Card, NumField, SciTable, downloadFile } from '../research.jsx';
import { Button } from '../ui/button.jsx';
import { Download } from 'lucide-react';

// Unique half-life engine: exponential decay curve with half-life markers,
// activity (Bq) calculation, and radiocarbon (C-14) dating calculator.

const ISOTOPES = {
  C14:  { name: 'Carbon-14',  hl: 5730,       unit: 'yr' },
  I131: { name: 'Iodine-131',  hl: 8.02,       unit: 'd'  },
  Co60: { name: 'Cobalt-60',  hl: 5.27,       unit: 'yr' },
  Rn222:{ name: 'Radon-222',  hl: 3.82,       unit: 'd'  },
  Cs137:{ name: 'Cesium-137', hl: 30.17,      unit: 'yr' },
};

export default function HalfLifeSim() {
  const [iso, setIso] = useState('C14');
  const [N0, setN0] = useState(1000);
  const [tmax, setTmax] = useState(5);
  const [sampleC14, setSampleC14] = useState(85); // % of modern carbon

  const hl = ISOTOPES[iso].hl;
  const lambda = Math.LN2 / hl;

  const data = useMemo(() => {
    const pts = [];
    for (let i = 0; i <= 200; i++) {
      const t = (i / 200) * tmax * hl;
      const N = N0 * Math.exp(-lambda * t);
      const A = lambda * N; // activity in Bq (if N0 is atom count)
      pts.push({ t: +t.toFixed(3), N: +N.toFixed(2), A: +A.toExponential(3), halfLives: +(t / hl).toFixed(2) });
    }
    return pts;
  }, [N0, lambda, hl, tmax]);

  const c14age = useMemo(() => {
    // t = -ln(fraction)/lambda, fraction = sampleC14/100
    return -(Math.log(sampleC14 / 100) / lambda);
  }, [sampleC14, lambda]);

  const stats = {
    'Isotope': ISOTOPES[iso].name,
    'Half-life': `${hl} ${ISOTOPES[iso].unit}`,
    'λ': `${lambda.toExponential(4)} 1/${ISOTOPES[iso].unit}`,
    'τ mean life': `${(1 / lambda).toFixed(2)} ${ISOTOPES[iso].unit}`,
    'C-14 age': `${c14age.toFixed(0)} yr`,
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(ISOTOPES).map(([k, v]) => (
          <button key={k} onClick={() => setIso(k)} className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${iso === k ? 'bg-cyan-j text-black' : 'bg-card/40 text-muted-foreground hover:bg-card/70'}`}>{v.name}</button>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <div className="space-y-3">
          <Card title="Parameters">
            <div className="space-y-2">
              <NumField label="N₀" value={N0} onChange={setN0} min={100} max={10000} step={100} />
              <NumField label="t max (× half-life)" value={tmax} onChange={setTmax} min={1} max={10} step={0.5} />
            </div>
          </Card>
          <Card title="C-14 Dating">
            <NumField label="Sample % of modern C" value={sampleC14} onChange={setSampleC14} min={1} max={100} step={1} unit="%" />
            <div className="mt-2 rounded-lg border border-cyan-j/30 bg-cyan-j/5 p-2 text-center">
              <div className="text-[10px] uppercase text-muted-foreground">Estimated age</div>
              <div className="font-mono text-lg text-cyan-j">{c14age.toFixed(0)} yr</div>
            </div>
          </Card>
          <SciTable headers={['Stat', 'Value']} rows={Object.entries(stats)} />
          <Button size="sm" variant="outline" onClick={() => downloadFile(JSON.stringify({ isotope: ISOTOPES[iso], N0, tmax, c14age, data }, null, 2), 'half-life.json', 'application/json')}><Download className="size-3.5" />Export</Button>
        </div>
        <div className="space-y-3">
          <div className="rounded-xl border border-border/60 bg-card/40 p-2" style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 12, bottom: 10, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                <XAxis dataKey="halfLives" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={{ value: 't / t½', position: 'insideBottom', offset: -2, fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={{ value: 'N(t)', angle: -90, fontSize: 10, position: 'insideLeft' }} />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
                {[1, 2, 3, 4].map((n) => <ReferenceLine key={n} x={n} stroke="#f9731660" strokeDasharray="4 2" />)}
                <ReferenceLine y={N0 / 2} stroke="#22d3ee60" strokeDasharray="4 2" />
                <Line type="monotone" dataKey="N" stroke="#22d3ee" dot={false} strokeWidth={2} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">
            Exponential decay N(t) = N₀·e^(−λt) with λ = ln2/t½. Orange dashed lines mark each half-life; at each, N drops by half. C-14 dating uses t = −ln(N/N₀)/λ — the sample's remaining C-14 fraction gives its age.
          </div>
        </div>
      </div>
    </div>
  );
}