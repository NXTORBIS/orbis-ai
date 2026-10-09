import { useMemo, useState } from 'react';
import { Globe, TrendingUp } from 'lucide-react';
import { INORGANIC_FAMILIES } from './lib/inorganicData.js';
import { ALL_ELEMENTS } from './lib/elementsData.js';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import AIPanel from './parts/AIPanel.jsx';
import PageTitle from './ui/PageTitle.jsx';

const TRENDS = {
  electronegativity: { label: 'Electronegativity (Pauling)', key: 'electronegativity' },
  atomic_radius: { label: 'Atomic radius — approx via period (inverse)', key: 'period' },
  melting_point: { label: 'Melting point (K)', key: 'melting_point' },
  boiling_point: { label: 'Boiling point (K)', key: 'boiling_point' },
};

export default function InorganicExplorer() {
  const [trend, setTrend] = useState('electronegativity');
  const [sel, setSel] = useState(INORGANIC_FAMILIES[0]);

  const data = useMemo(() => {
    return ALL_ELEMENTS.slice(0, 20).map((e) => ({ name: e.symbol, val: e[TRENDS[trend].key] || 0 }));
  }, [trend]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <PageTitle title="INORGANIC CHEMISTRY" subtitle="Volume 8 · Compound families & periodic trends" />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="glass glass-border rounded-2xl p-5">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Compound families</div>
          <div className="space-y-1.5">
            {INORGANIC_FAMILIES.map((f) => (
              <button key={f.id} onClick={() => setSel(f)} className={`w-full rounded-xl border px-3 py-2 text-left transition ${f.id === sel.id ? 'border-cyan-j/60 bg-cyan-j/10' : 'border-border/60 bg-card/40 hover:border-border'}`}>
                <div className="text-sm font-medium">{f.name}</div>
                <div className="font-mono-j text-[11px] text-muted-foreground">{f.examples}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div className="glass glass-border rounded-2xl p-5">
            <div className="mb-2 flex items-center gap-2"><Globe className="h-5 w-5 text-cyan-j" /><h3 className="font-display text-xl font-bold">{sel.name}</h3></div>
            <p className="text-sm text-foreground/85">{sel.desc}</p>
            <p className="mt-3 rounded-lg border border-border/60 bg-card/40 p-3 text-xs text-muted-foreground">{sel.note}</p>
          </div>

          <div className="glass glass-border rounded-2xl p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><TrendingUp className="h-4 w-4 text-cyan-j" /> Periodic trend</div>
              <select value={trend} onChange={(e) => setTrend(e.target.value)} className="rounded-lg border border-border bg-card/70 px-2 py-1 text-xs">
                <option value="electronegativity">Electronegativity</option>
                <option value="atomic_radius">Atomic radius (period)</option>
                <option value="melting_point">Melting point</option>
                <option value="boiling_point">Boiling point</option>
              </select>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                <Line type="monotone" dataKey="val" stroke="hsl(var(--cyan))" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
            <div className="mt-2 text-center text-[11px] text-muted-foreground">{TRENDS[trend].label} — first 20 elements</div>
          </div>
        </div>
      </div>

      <div className="glass glass-border mt-4 rounded-2xl p-4">
        <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Inorganic chemistry assistant</div>
        <AIPanel systemContext="You are an inorganic chemistry expert. Explain compound families, periodic trends, and reactions." initialPrompt={`Explain the ${sel.name} family and give examples of their reactions.`} />
      </div>
    </div>
  );
}