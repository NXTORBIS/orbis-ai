import React, { useState, useMemo } from 'react';
import { Activity, Layers } from 'lucide-react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, ReferenceLine } from 'recharts';
import Section from './Section';
import { basisLabel } from '../quantum/spinEngine.js';

export default function SpectrumPanel({ result, params, selectedState, setSelectedState }) {
  const [sortBy, setSortBy] = useState('index');
  const eig = result?.eigenvalues || [];
  const states = result?.states || [];
  const sel = Math.min(selectedState, states.length - 1);
  const psi = states[sel];
  const E0 = eig[0];
  const E1 = eig[1] ?? eig[0];
  const gap = E1 - E0;

  const spectrumData = eig.map((e, i) => ({ idx: i, E: e, isGS: i === 0 }));

  // eigenstate coefficients
  const coeffs = useMemo(() => {
    if (!psi) return [];
    const D = psi.length;
    const arr = [];
    for (let s = 0; s < D; s++) {
      if (Math.abs(psi[s]) < 1e-12) continue;
      arr.push({ idx: s, c: psi[s], re: psi[s], im: 0, mag: Math.abs(psi[s]), p: psi[s] * psi[s], label: basisLabel(s, params.N) });
    }
    if (sortBy === 'probability') arr.sort((a, b) => b.p - a.p);
    else if (sortBy === 'magnitude') arr.sort((a, b) => b.mag - a.mag);
    else arr.sort((a, b) => a.idx - b.idx);
    return arr.slice(0, 60);
  }, [psi, sortBy, params.N]);

  // validation
  const norm = psi ? psi.reduce((s, x) => s + x * x, 0) : 0;
  const residual = result?.residuals?.[sel];

  return (
    <Section title="Energy Spectrum & Eigenstates" icon={Activity}>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <div className="rounded-lg border border-border/50 bg-secondary/30 p-3">
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Ground state</span>
              <span className="font-mono text-xs text-emerald-500">E₀ = {E0 != null ? E0.toFixed(6) : '—'}</span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <KV k="Energy gap Δ" v={gap != null ? gap.toFixed(6) : '—'} />
              <KV k="Solver" v={result?.solverInfo?.method || '—'} />
              <KV k="Converged" v={result?.solverInfo?.converged ? '✓' : '✗'} />
              <KV k="⟨ψ₀|ψ₀⟩" v={norm.toFixed(8)} />
              <KV k="Residual" v={residual != null ? residual.toExponential(2) : '—'} />
            </div>
          </div>

          <div className="mt-3">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Energy spectrum (lowest {eig.length})</div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={spectrumData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis dataKey="idx" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} label={{ value: 'state n', position: 'insideBottom', offset: -2, fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} domain={['auto', 'auto']} />
                <Tooltip formatter={(v) => v.toFixed(6)} labelFormatter={(l) => `state ${l}`} contentStyle={{ fontSize: 11 }} />
                <ReferenceLine y={E0} stroke="#10b981" strokeDasharray="4 2" />
                <Bar dataKey="E" radius={[2, 2, 0, 0]} onClick={(d) => setSelectedState(d.idx)}>
                  {spectrumData.map((d, i) => (<Cell key={i} fill={d.idx === sel ? '#f59e0b' : d.isGS ? '#10b981' : '#06b6d4'} cursor="pointer" />))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <p className="text-[10px] text-muted-foreground">Click a bar to inspect that eigenstate. Green = ground state, amber = selected.</p>
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Eigenstate |ψ_{sel}⟩ = Σ c_k |k⟩</div>
            <div className="flex gap-1">
              {[['index', 'Index'], ['probability', 'Probability'], ['magnitude', 'Magnitude']].map(([k, l]) => (
                <button key={k} onClick={() => setSortBy(k)} className={`rounded px-2 py-0.5 text-[10px] ${sortBy === k ? 'bg-cyan-j/20 text-cyan-j' : 'text-muted-foreground'}`}>{l}</button>
              ))}
            </div>
          </div>
          {!psi ? (
            <p className="text-xs text-muted-foreground">Run the simulation to view eigenstates.</p>
          ) : (
            <>
              <div className="max-h-40 overflow-auto rounded-md border border-border/40">
                <table className="w-full text-[10px]">
                  <thead className="sticky top-0 bg-secondary/80"><tr className="text-left text-muted-foreground"><th className="px-2 py-1">k</th><th className="px-2 py-1">State</th><th className="px-2 py-1 text-right">Re(c)</th><th className="px-2 py-1 text-right">|c|</th><th className="px-2 py-1 text-right">P_k</th></tr></thead>
                  <tbody>
                    {coeffs.map((r) => (
                      <tr key={r.idx} className="border-t border-border/20"><td className="px-2 py-0.5 font-mono text-muted-foreground">{r.idx}</td><td className="px-2 py-0.5 font-mono">{r.label}</td><td className="px-2 py-0.5 text-right font-mono">{r.re.toFixed(4)}</td><td className="px-2 py-0.5 text-right font-mono">{r.mag.toFixed(4)}</td><td className="px-2 py-0.5 text-right font-mono">{r.p.toFixed(4)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-2">
                <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Probability distribution P_k = |c_k|²</div>
                <ResponsiveContainer width="100%" height={120}>
                  <BarChart data={coeffs} margin={{ top: 2, right: 5, bottom: 2, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                    <XAxis dataKey="idx" tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} />
                    <Tooltip formatter={(v) => v.toFixed(4)} contentStyle={{ fontSize: 10 }} />
                    <Bar dataKey="p" fill="#06b6d4" radius={[1, 1, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>
      </div>
    </Section>
  );
}

function KV({ k, v }) { return <span className="text-muted-foreground">{k}: <span className="font-mono text-foreground">{v}</span></span>; }