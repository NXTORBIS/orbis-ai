import React, { useRef, useEffect, useState, useMemo } from 'react';
import { Magnet } from 'lucide-react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, ReferenceLine } from 'recharts';
import Section from './Section';

export default function ObservablesPanel({ observables, params }) {
  const { mag, corr } = observables || {};
  const [corrType, setCorrType] = useState('iso');
  const [hoverSite, setHoverSite] = useState(null);

  const N = params.N;
  const C = corr ? (corrType === 'xx' ? corr.Cxx : corrType === 'yy' ? corr.Cyy : corrType === 'zz' ? corr.Czz : corr.Ciso) : null;
  const distData = useMemo(() => {
    if (!C || !Array.isArray(C)) return [];
    const sums = new Array(N).fill(0), counts = new Array(N).fill(0);
    for (let i = 0; i < N; i++) {
      const row = C[i];
      if (!Array.isArray(row)) continue;
      for (let j = 0; j < N; j++) { const v = row[j]; if (v == null || isNaN(v)) continue; const r = Math.abs(i - j); sums[r] += v; counts[r]++; }
    }
    return sums.map((s, r) => ({ r, C: counts[r] ? s / counts[r] : 0 }));
  }, [C, N]);

  if (!mag || !corr) {
    return (
      <Section title="Observables" icon={Magnet}>
        <p className="text-xs text-muted-foreground">Run the simulation to compute magnetization and correlations.</p>
      </Section>
    );
  }

  const magData = mag.sz.map((z, i) => ({ i, sz: z, sx: mag.sx[i], sy: mag.sy[i] }));
  const MzTot = mag.sz.reduce((a, b) => a + b, 0);

  return (
    <Section title="Observables" icon={Magnet}>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Local magnetization ⟨S_iᶻ⟩</div>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={magData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis dataKey="i" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
              <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} domain={[-0.6, 0.6]} />
              <Tooltip formatter={(v) => v.toFixed(4)} contentStyle={{ fontSize: 11 }} />
              <ReferenceLine y={0} stroke="hsl(var(--border))" />
              <Bar dataKey="sz" radius={[2, 2, 0, 0]}>
                {magData.map((d, i) => <Cell key={i} fill={d.sz >= 0 ? '#10b981' : '#ef4444'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
            <span>⟨Sz_tot⟩ = <span className="font-mono text-foreground">{MzTot.toFixed(6)}</span></span>
            <span>⟨Sx_tot⟩ = <span className="font-mono text-foreground">{mag.sx.reduce((a, b) => a + b, 0).toFixed(6)}</span></span>
          </div>
        </div>

        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Spin chain (magnetization ↑↓, bonds = ⟨Sᵢ·Sⱼ⟩)</div>
          <SpinChain N={N} mag={mag} C={corr.Ciso} onHover={setHoverSite} hover={hoverSite} h={params.h} />
          {hoverSite != null && (
            <div className="mt-1 text-[11px] font-mono text-muted-foreground">
              Site {hoverSite}: ⟨Sx⟩={mag.sx[hoverSite].toFixed(4)} ⟨Sy⟩={mag.sy[hoverSite].toFixed(4)} ⟨Sz⟩={mag.sz[hoverSite].toFixed(4)}
            </div>
          )}
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Correlation heatmap C(i,j)</span>
            <div className="flex gap-1">
              {[['iso', 'iso'], ['zz', 'zz'], ['xx', 'xx'], ['yy', 'yy']].map(([k, l]) => (
                <button key={k} onClick={() => setCorrType(k)} className={`rounded px-1.5 py-0.5 text-[10px] ${corrType === k ? 'bg-cyan-j/20 text-cyan-j' : 'text-muted-foreground'}`}>{l}</button>
              ))}
            </div>
          </div>
          <CorrHeatmap C={C} N={N} />
        </div>

        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Correlation vs distance C(r)</div>
          <ResponsiveContainer width="100%" height={150}>
            <LineChart data={distData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis dataKey="r" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} label={{ value: 'r = |i−j|', position: 'insideBottom', offset: -2, fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
              <Tooltip formatter={(v) => v.toFixed(4)} contentStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="C" stroke="#06b6d4" dot={{ r: 2 }} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Section>
  );
}

function CorrHeatmap({ C, N }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext('2d');
    const size = 240; cv.width = size; cv.height = size;
    const cell = size / N;
    let maxAbs = 0;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) maxAbs = Math.max(maxAbs, Math.abs(C[i][j]));
    maxAbs = maxAbs || 1;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const t = C[i][j] / maxAbs;
      ctx.fillStyle = t >= 0 ? `rgba(6,182,212,${0.1 + 0.9 * t})` : `rgba(239,68,68,${0.1 + 0.9 * -t})`;
      ctx.fillRect(j * cell, i * cell, Math.ceil(cell), Math.ceil(cell));
    }
  }, [C, N]);
  return <canvas ref={ref} className="rounded-lg border border-border/50" style={{ width: '100%', maxWidth: 240, aspectRatio: '1/1' }} />;
}

function SpinChain({ N, mag, C, onHover, hover, h }) {
  const w = 460, hgt = 120;
  const gap = w / (N + 1);
  const bondMax = Math.max(...Array.from({ length: Math.max(1, N - 1) }, (_, k) => Math.abs(C[k][k + 1]))) || 1;
  return (
    <svg viewBox={`0 0 ${w} ${hgt}`} className="w-full" style={{ maxHeight: 130 }}>
      <defs>
        <marker id="arrUp" markerWidth="6" markerHeight="6" refX="3" refY="0" orient="auto"><path d="M0,6 L3,0 L6,6 Z" fill="#10b981" /></marker>
        <marker id="arrDn" markerWidth="6" markerHeight="6" refX="3" refY="6" orient="auto"><path d="M0,0 L3,6 L6,0 Z" fill="#ef4444" /></marker>
        <marker id="arrField" markerWidth="6" markerHeight="6" refX="3" refY="0" orient="auto"><path d="M0,6 L3,0 L6,6 Z" fill="#f59e0b" /></marker>
      </defs>
      {Array.from({ length: N - 1 }, (_, i) => {
        const x1 = gap * (i + 1), x2 = gap * (i + 2);
        const c = C[i][i + 1];
        const op = 0.2 + 0.8 * Math.abs(c) / bondMax;
        return <line key={i} x1={x1} y1={hgt / 2} x2={x2} y2={hgt / 2} stroke={c >= 0 ? '#06b6d4' : '#ef4444'} strokeWidth={2 + 4 * Math.abs(c) / bondMax} opacity={op} />;
      })}
      {Array.from({ length: N }, (_, i) => {
        const x = gap * (i + 1), y = hgt / 2;
        const sz = mag.sz[i];
        const len = 6 + 22 * Math.min(1, Math.abs(sz) * 4);
        const up = sz >= 0;
        return (
          <g key={i} onMouseEnter={() => onHover(i)} onMouseLeave={() => onHover(null)} style={{ cursor: 'pointer' }}>
            <circle cx={x} cy={y} r={9} fill="hsl(var(--card))" stroke={hover === i ? '#06b6d4' : 'hsl(var(--border))'} strokeWidth={hover === i ? 2 : 1} />
            <text x={x} y={y + 3} textAnchor="middle" fontSize={8} fill="hsl(var(--muted-foreground))">{i + 1}</text>
            {Math.abs(sz) > 1e-6 && (
              <line x1={x} y1={up ? y + len : y - len} x2={x} y2={up ? y - len : y + len} stroke={up ? '#10b981' : '#ef4444'} strokeWidth={2} markerEnd={up ? 'url(#arrUp)' : 'url(#arrDn)'} />
            )}
          </g>
        );
      })}
      {h !== 0 && (
        <g>
          <line x1={w - 26} y1={hgt - 18} x2={w - 26} y2={18} stroke="#f59e0b" strokeWidth={2} markerEnd="url(#arrField)" />
          <text x={w - 18} y={hgt / 2} fontSize={9} fill="#f59e0b">h</text>
        </g>
      )}
    </svg>
  );
}