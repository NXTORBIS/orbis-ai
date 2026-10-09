import React, { useMemo, useState } from 'react';
import { ResearchHeader, Card, AIPanel, useAIExplain, SciTable, NumField } from '../research.jsx';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ZAxis, Cell } from 'recharts';

// Real stellar sample: [name, M/M☉, L/L☉, T_eff K, type]
const STARS = [
  ['Sun', 1, 1, 5772, 'main'], ['Sirius A', 2.06, 25.4, 9940, 'main'], ['Betelgeuse', 12, 126000, 3500, 'supergiant'],
  ['Rigel', 23, 120000, 12100, 'supergiant'], ['Proxima Cen', 0.12, 0.0017, 3042, 'dwarf'], ['Barnard', 0.14, 0.0035, 3134, 'dwarf'],
  ['Vega', 2.1, 40, 9602, 'main'], ['Arcturus', 1.08, 170, 4286, 'giant'], ['Aldebaran', 1.7, 400, 3910, 'giant'],
  ['Spica', 11, 12500, 22400, 'main'], ['Polaris', 5.4, 1260, 6015, 'giant'], ['Wolf 359', 0.09, 0.0011, 2800, 'dwarf'],
  ['Antares', 15, 75000, 3660, 'supergiant'], ['Capella', 2.7, 78, 4940, 'giant'], ['Altair', 1.8, 10.6, 7550, 'main'],
  ['Sirius B', 1.0, 0.026, 25000, 'wd'], ['Procyon', 1.5, 7, 6530, 'main'], ['Deneb', 19, 196000, 8525, 'supergiant'],
];

const TYPE_COLOR = (T) => T > 30000 ? '#9bb0ff' : T > 10000 ? '#aabfff' : T > 7500 ? '#cad7ff' : T > 6000 ? '#fff4ea' : T > 5000 ? '#ffd2a1' : T > 3500 ? '#ff9966' : '#ff6644';
const TYPE_LABEL = { main: 'Main Sequence', giant: 'Giant', supergiant: 'Supergiant', dwarf: 'Dwarf', wd: 'White Dwarf' };

export default function HertzsprungRussellSim() {
  const [filter, setFilter] = useState('all');
  const { explain, explaining, output } = useAIExplain();

  const data = useMemo(() => {
    return STARS.filter(([n, m, L, T, t]) => filter === 'all' || t === filter).map(([name, m, L, T, t]) => ({ name, T, L, M: m, type: t, color: TYPE_COLOR(T) }));
  }, [filter]);

  const mainSeq = useMemo(() => {
    const out = [];
    for (let m = 0.08; m <= 60; m *= 1.1) {
      const L = Math.pow(m, 3.5);
      const R = Math.pow(m, 0.8);
      const T = Math.pow(L / (R * R), 0.25) * 5778;
      out.push({ T: +T.toFixed(0), L: +L.toFixed(3) });
    }
    return out;
  }, []);

  return (
    <div className="space-y-4">
      <ResearchHeader title="Hertzsprung–Russell Diagram" subtitle="Luminosity vs effective temperature for real stars. Reveals the main sequence, giants, supergiants, and white dwarfs."
        onExplain={() => explain(`HR diagram with ${data.length} stars. Hot luminous stars top-left, cool faint stars bottom-right. Main sequence runs diagonally; giants are above, white dwarfs below.`)} explaining={explaining} />
      <div className="flex flex-wrap gap-1.5">
        {['all', 'main', 'giant', 'supergiant', 'dwarf', 'wd'].map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-3 py-1.5 text-xs ${filter === f ? 'bg-cyan-j text-background' : 'bg-card/40 text-muted-foreground'}`}>{f === 'all' ? 'All stars' : TYPE_LABEL[f] || f}</button>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
        <div className="rounded-xl border border-border/60 bg-card/40 p-2" style={{ height: 380 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 8, right: 16, bottom: 30, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
              <XAxis type="number" dataKey="T" domain={[30000, 2000]} scale="log" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" name="T" reversed label={{ value: 'T_eff (K, reversed)', position: 'insideBottom', offset: -14, fontSize: 10 }} />
              <YAxis type="number" dataKey="L" domain={[1e-4, 1e6]} scale="log" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" name="L" label={{ value: 'L (L☉)', angle: -90, fontSize: 10, position: 'insideLeft' }} />
              <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
              <Scatter data={mainSeq} fill="#94a3b8" fillOpacity={0.15} name="MS fit" />
              <Scatter data={data} name="Stars">
                {data.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
        <div className="space-y-3">
          <Card title="Star Catalog">
            <div className="max-h-80 overflow-y-auto scrollbar-thin space-y-1">
              {data.map((s) => (
                <div key={s.name} className="flex items-center justify-between text-xs">
                  <span style={{ color: s.color }}>●{s.name}</span>
                  <span className="font-mono text-muted-foreground">{s.T}K · {s.L}L☉</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
      <p className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">
        The main sequence (grey band) follows L ∝ M³·⁵. Hot blue stars (top-left) are massive and short-lived; cool red stars (bottom-right) are low-mass and long-lived. Giants and supergiants sit above the MS; white dwarfs below.
      </p>
      <AIPanel output={output} />
    </div>
  );
}