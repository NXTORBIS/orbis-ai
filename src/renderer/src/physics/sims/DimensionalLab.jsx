import React, { useState } from 'react';
import { verifyEquation } from '../lib/dimensional.js';
import { ResearchHeader, Card, AIPanel, useAIExplain, SciTable } from '../research.jsx';

const PRESETS = [
  { eq: 'v = d / t', note: 'velocity = distance / time' },
  { eq: 'F = m * a', note: "Newton's second law" },
  { eq: 'E = m * c^2', note: 'mass–energy equivalence' },
  { eq: 'F = G * m * m / r^2', note: 'Newton gravitation' },
  { eq: 'E = 0.5 * m * v^2', note: 'kinetic energy' },
  { eq: 'v = m * a', note: 'dimensionally INVALID' },
  { eq: 'T = 2 * pi * sqrt(m / k)', note: 'SHM period (k treated dimensionless here — check!)' },
  { eq: 'p = F / A', note: 'pressure = force / area' },
];

export default function DimensionalLab() {
  const [eq, setEq] = useState('F = m * a');
  const res = verifyEquation(eq);
  const { explain, explaining, output } = useAIExplain();

  return (
    <div className="space-y-4">
      <ResearchHeader title="Dimensional Analysis" subtitle="Deterministic symbolic checker: every symbol carries an SI dimension vector; + / − require matching dimensions, × / ÷ combine them, ^ scales. No AI in the check."
        onExplain={() => explain(`Dimensional analysis of "${eq}": ${res.ok ? (res.consistent ? 'dimensions are CONSISTENT (' + res.lhs + ' = ' + res.rhs + ')' : 'INCONSISTENT (' + res.lhs + ' ≠ ' + res.rhs + ')') : 'parse error: ' + res.error}.`)} explaining={explaining} />
      <Card title="Equation">
        <input value={eq} onChange={(e) => setEq(e.target.value)} className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm" />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {PRESETS.map((p) => <button key={p.eq} onClick={() => setEq(p.eq)} className="rounded-full border border-border/60 bg-card/40 px-2.5 py-1 text-xs hover:border-cyan-j">{p.eq}</button>)}
        </div>
      </Card>
      <div className={`rounded-xl border p-4 ${res.ok ? (res.consistent ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-red-500/40 bg-red-500/5') : 'border-amber-500/40 bg-amber-500/5'}`}>
        {res.ok ? (
          <div className="flex items-center gap-3">
            <span className={`font-display text-sm font-bold uppercase ${res.consistent ? 'text-emerald-500' : 'text-red-500'}`}>{res.consistent ? '✓ Dimensionally Consistent' : '✗ Dimensionally Inconsistent'}</span>
            <span className="font-mono text-sm text-muted-foreground">{res.lhs} = {res.rhs}</span>
          </div>
        ) : <span className="text-sm text-amber-600">⚠ {res.error}</span>}
      </div>
      <Card title="Supported symbols">
        <p className="text-xs text-muted-foreground">Variables (x,y,z,t,v,a,m,F,E,p,W,P,q,I,V,R,T,n,k,r,d,s,h,lambda,f,g,…) and units (m,kg,s,A,K,mol,N,Pa,J,W,C,V,ohm,F,H,Wb,T,Hz,eV,…) each carry a dimension. Numbers are dimensionless. Use + − × ÷ ^ and parentheses.</p>
      </Card>
      <AIPanel output={output} />
    </div>
  );
}