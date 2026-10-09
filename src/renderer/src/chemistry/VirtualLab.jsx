import { useMemo, useState } from 'react';
import { motion } from './ui/motion.jsx';
import { Droplet, Flame } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceDot } from 'recharts';
import PageTitle from './ui/PageTitle.jsx';

const FLAME_TESTS = [
  { el: 'Li', name: 'Lithium', color: '#dc2626' },
  { el: 'Na', name: 'Sodium', color: '#f59e0b' },
  { el: 'K', name: 'Potassium', color: '#a855f7' },
  { el: 'Ca', name: 'Calcium', color: '#f97316' },
  { el: 'Sr', name: 'Strontium', color: '#ef4444' },
  { el: 'Ba', name: 'Barium', color: '#16a34a' },
  { el: 'Cu', name: 'Copper', color: '#06b6d4' },
  { el: 'Cs', name: 'Cesium', color: '#3b82f6' },
];

export default function VirtualLab() {
  const [exp, setExp] = useState('titration');
  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <PageTitle title="VIRTUAL LABORATORY" subtitle="Volume 10 · Simulated experiments — titration & flame tests" />
      <div className="mb-5 flex gap-1.5">
        <button onClick={() => setExp('titration')} className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${exp === 'titration' ? 'border-cyan-j/60 bg-cyan-j/10 text-cyan-j' : 'border-border/60 bg-card/50'}`}><Droplet className="h-4 w-4" /> Acid–Base Titration</button>
        <button onClick={() => setExp('flame')} className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${exp === 'flame' ? 'border-cyan-j/60 bg-cyan-j/10 text-cyan-j' : 'border-border/60 bg-card/50'}`}><Flame className="h-4 w-4" /> Flame Test</button>
      </div>
      {exp === 'titration' ? <Titration /> : <FlameTest />}
    </div>
  );
}

function Titration() {
  const [vb, setVb] = useState(0);
  const Ca = 0.1, Va = 25, Cb = 0.1;
  const pH = (v) => {
    const total = Va + v;
    const ma = Ca * Va, mb = Cb * v;
    if (mb < ma) { const h = (ma - mb) / total; return -Math.log10(h); }
    if (mb === ma) return 7;
    const oh = (mb - ma) / total; return 14 + Math.log10(oh);
  };
  const curve = useMemo(() => {
    const pts = [];
    for (let v = 0; v <= 50; v += 0.5) pts.push({ v: +v.toFixed(1), pH: +pH(v).toFixed(2) });
    return pts;
  }, []);
  const current = +pH(vb).toFixed(2);

  return (
    <div className="glass glass-border rounded-2xl p-6">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">25 mL of 0.1 M HCl titrated with 0.1 M NaOH</div>
      <div className="mb-4 flex items-center gap-3">
        <span className="text-xs text-muted-foreground">NaOH added:</span>
        <input type="range" min={0} max={50} value={vb} onChange={(e) => setVb(+e.target.value)} className="flex-1 accent-cyan-500" />
        <span className="w-16 text-right text-sm font-medium">{vb} mL</span>
      </div>
      <div className="mb-4 flex items-center gap-4">
        <div className="rounded-xl border border-cyan-j/30 bg-cyan-j/10 px-4 py-2"><span className="text-xs text-muted-foreground">pH</span> <span className="text-xl font-bold text-cyan-j">{current}</span></div>
        <div className="text-xs text-muted-foreground">{vb < 25 ? 'Acidic (excess H⁺)' : vb === 25 ? 'Equivalence point (neutral)' : 'Basic (excess OH⁻)'}</div>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={curve}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="v" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} label={{ value: 'mL NaOH', position: 'insideBottom', offset: -2, fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
          <YAxis domain={[0, 14]} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
          <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
          <Line type="monotone" dataKey="pH" stroke="hsl(var(--cyan))" strokeWidth={2} dot={false} />
          <ReferenceDot x={25} y={7} r={4} fill="#f59e0b" stroke="#fff" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function FlameTest() {
  const [sel, setSel] = useState(FLAME_TESTS[1]);
  return (
    <div className="glass glass-border rounded-2xl p-6">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Select a metal ion</div>
      <div className="mb-5 flex flex-wrap gap-2">
        {FLAME_TESTS.map((f) => (
          <button key={f.el} onClick={() => setSel(f)} className={`rounded-full border px-3 py-1.5 text-xs ${sel.el === f.el ? 'border-cyan-j/60 bg-cyan-j/10' : 'border-border/60 bg-card/50'}`}>{f.name}</button>
        ))}
      </div>
      <div className="flex flex-col items-center">
        <div className="relative h-48 w-24">
          <div className="absolute bottom-0 left-1/2 h-24 w-8 -translate-x-1/2 rounded-b-md bg-muted" />
          <motion.div animate={{ scaleY: [1, 1.15, 1] }} transition={{ duration: 1.4, repeat: Infinity }} style={{ background: `linear-gradient(to top, ${sel.color}, transparent)`, transformOrigin: 'bottom' }} className="absolute bottom-24 left-1/2 h-28 w-12 -translate-x-1/2 rounded-full blur-sm" />
          <div className="absolute bottom-16 left-1/2 h-10 w-6 -translate-x-1/2 rounded-full" style={{ background: sel.color, filter: 'blur(2px)' }} />
        </div>
        <p className="mt-3 text-sm">{sel.name} ({sel.el}) produces a <span className="font-medium" style={{ color: sel.color }}>{sel.color}</span> flame.</p>
      </div>
    </div>
  );
}