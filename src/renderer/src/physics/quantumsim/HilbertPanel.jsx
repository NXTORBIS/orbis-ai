import React, { useState, useMemo } from 'react';
import { Boxes, Search } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import Section from './Section';
import { hilbertDim, basisLabel, basisBinary } from '../quantum/spinEngine.js';

const SCALE = [1, 2, 4, 6, 8, 10, 12, 14, 16, 20, 30, 40, 50];

export default function HilbertPanel({ params, probabilities }) {
  const [jump, setJump] = useState(0);
  const [q, setQ] = useState('');
  const D = hilbertDim(params.N);

  const scaleData = useMemo(() => SCALE.map((n) => ({ n, D: Math.pow(2, n) })), []);

  // basis list window (virtualized: 40 rows around jump)
  const windowSize = 40;
  const start = Math.max(0, Math.min(D - windowSize, jump));
  const rows = useMemo(() => {
    const r = [];
    for (let i = 0; i < windowSize && start + i < D; i++) {
      const idx = start + i;
      r.push({ idx, label: basisLabel(idx, params.N), bin: basisBinary(idx, params.N), p: probabilities ? probabilities[idx] || 0 : null });
    }
    return r;
  }, [start, params.N, D, probabilities]);

  const filtered = q ? rows.filter((r) => r.label.includes(q) || r.bin.includes(q) || String(r.idx) === q) : rows;

  return (
    <Section title="Hilbert Space" icon={Boxes}>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Box label="Sites N" value={params.N} />
            <Box label="Hilbert dim D" value={D.toLocaleString()} />
            <Box label="Matrix" value={`${D}×${D}`} />
          </div>
          <div className="mt-3 rounded-lg border border-border/50 bg-secondary/30 p-3">
            <div className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">Exponential scaling 2^N</div>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={scaleData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis dataKey="n" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} label={{ value: 'N', position: 'insideBottom', offset: -2, fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={(v) => (v >= 1e6 ? v.toExponential(0) : v.toLocaleString())} />
                <Tooltip formatter={(v) => v.toLocaleString()} labelFormatter={(l) => `N = ${l}`} contentStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="D" stroke="#06b6d4" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-[11px]">
              <tbody>
                {SCALE.slice(0, 9).map((n) => (
                  <tr key={n} className={`border-b border-border/30 ${n === params.N ? 'bg-cyan-j/10' : ''}`}>
                    <td className="py-1 px-2 text-muted-foreground">N = {n}</td>
                    <td className="py-1 px-2 text-right font-mono">{Math.pow(2, n).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">Basis-state explorer</div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ↑↓ or index…" className="w-full rounded-md border border-input bg-transparent py-1.5 pl-8 pr-2 text-xs" />
            </div>
            <input type="number" min={0} max={D - 1} value={jump} onChange={(e) => setJump(Math.max(0, Math.min(D - 1, +e.target.value)))} className="w-24 rounded-md border border-input bg-transparent px-2 py-1.5 text-xs" />
          </div>
          <div className="mt-2 max-h-64 overflow-auto rounded-md border border-border/40">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-secondary/80 backdrop-blur">
                <tr className="text-left text-muted-foreground">
                  <th className="px-2 py-1">Index</th><th className="px-2 py-1">State</th><th className="px-2 py-1">Binary</th>
                  {probabilities && <th className="px-2 py-1 text-right">P_k</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.idx} className="border-t border-border/20 hover:bg-accent/40">
                    <td className="px-2 py-1 font-mono text-muted-foreground">{r.idx}</td>
                    <td className="px-2 py-1 font-mono">{r.label}</td>
                    <td className="px-2 py-1 font-mono text-muted-foreground">{r.bin}</td>
                    {probabilities && <td className="px-2 py-1 text-right font-mono">{r.p > 0 ? r.p.toExponential(2) : '—'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">Showing {filtered.length} of {D.toLocaleString()} basis states (virtualized window).</p>
        </div>
      </div>
    </Section>
  );
}

function Box({ label, value }) {
  return (
    <div className="rounded-lg border border-border/50 bg-secondary/30 p-2.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-mono text-base font-semibold">{value}</div>
    </div>
  );
}