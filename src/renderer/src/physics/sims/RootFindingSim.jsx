// Root Finding — Newton, bisection, secant convergence comparison
import React, { useState, useMemo } from 'react';
import { ResearchHeader, Card, NumField, SciTable, AIPanel, useAIExplain } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';
import { newton, bisection, secant } from '../lib/numerics.js';

const FUNCS = {
  'x³ − 2 (∛2)': { f: (x) => x * x * x - 2, fp: (x) => 3 * x * x, root: Math.cbrt(2), lo: 0, hi: 2, x0: 1, x1: 1.5 },
  'cos(x) − x (Dottie)': { f: (x) => Math.cos(x) - x, fp: (x) => -Math.sin(x) - 1, root: 0.7390851332, lo: 0, hi: 1, x0: 0.5, x1: 1 },
  'x·e^x − 1 (Omega)': { f: (x) => x * Math.exp(x) - 1, fp: (x) => (x + 1) * Math.exp(x), root: 0.5671432904, lo: 0, hi: 1, x0: 0.5, x1: 1 },
  'ln(x) + x − 2': { f: (x) => Math.log(x) + x - 2, fp: (x) => 1 / x + 1, root: 1.5571455990, lo: 1, hi: 3, x0: 1.5, x1: 2.5 },
};

export default function RootFindingSim() {
  const [funcKey, setFuncKey] = useState('x³ − 2 (∛2)');
  const [x0, setX0] = useState(1);
  const { explain, explaining, output } = useAIExplain();
  const cfg = FUNCS[funcKey];

  const results = useMemo(() => {
    const n = newton(cfg.f, cfg.fp, x0);
    const b = bisection(cfg.f, cfg.lo, cfg.hi);
    const s = secant(cfg.f, x0, x0 + 0.3);
    const maxLen = Math.max(n.iters.length, b.iters.length, s.iters.length);
    const conv = [];
    for (let i = 0; i < maxLen; i++) {
      conv.push({
        i,
        newton: n.iters[i] ? Math.abs(n.iters[i].x - cfg.root) : null,
        bisection: b.iters[i] ? Math.abs(b.iters[i].x - cfg.root) : null,
        secant: s.iters[i] ? Math.abs(s.iters[i].x - cfg.root) : null,
      });
    }
    return { n, b, s, conv };
  }, [funcKey, x0, cfg]);

  return (
    <div className="space-y-4">
      <ResearchHeader title="Root Finding — Convergence Rate Comparison"
        subtitle="Newton (quadratic), bisection (linear, ½ bit/step), secant (superlinear, φ≈1.618). Log-scale |xₙ − root| vs iteration."
        onExplain={() => explain(`Root finding on ${funcKey}, exact root = ${cfg.root.toExponential(10)}. Newton from x₀=${x0}: ${results.n.iters.length} iters, final err ${Math.abs(results.n.root - cfg.root).toExponential(3)}. Bisection: ${results.b.iters.length} iters. Secant: ${results.s.iters.length} iters. Newton converges fastest (quadratic), bisection slowest (linear), secant in between (superlinear ~1.618).`)}
        explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card title="Settings">
          <label className="block text-sm"><span className="text-muted-foreground">Function</span>
            <select value={funcKey} onChange={(e) => { setFuncKey(e.target.value); setX0(FUNCS[e.target.value].x0); }} className="mt-1 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm">
              {Object.keys(FUNCS).map((k) => <option key={k} className="bg-background">{k}</option>)}
            </select>
          </label>
          <div className="mt-3"><NumField label="x₀ (Newton/secant)" value={x0} onChange={setX0} min={0.1} max={3} step={0.05} /></div>
        </Card>
        <div className="space-y-3">
          <SciPlot type="line" data={results.conv} xKey="i" log="semi-logy"
            series={[{ key: 'newton', label: 'Newton', color: '#22d3ee' },
                    { key: 'bisection', label: 'Bisection', color: '#f97316' },
                    { key: 'secant', label: 'Secant', color: '#a855f7' }]}
            xLabel="iteration" yLabel="|xₙ − root|" height={240} exportName="root-convergence" />
          <SciTable headers={['Method', 'Root found', 'Iters', '|Error|', 'Rate']} rows={[
            ['Newton', results.n.root.toFixed(14), results.n.iters.length, Math.abs(results.n.root - cfg.root).toExponential(3), 'quadratic'],
            ['Bisection', results.b.root.toFixed(14), results.b.iters.length, Math.abs(results.b.root - cfg.root).toExponential(3), 'linear (½ bit)'],
            ['Secant', results.s.root.toFixed(14), results.s.iters.length, Math.abs(results.s.root - cfg.root).toExponential(3), 'superlinear φ'],
            ['Exact', cfg.root.toFixed(14), '—', '—', '—'],
          ]} />
        </div>
      </div>
      <Card title="Newton iteration detail">
        <SciTable headers={['iter', 'xₙ', 'f(xₙ)']} rows={results.n.iters.slice(0, 10).map((r) => [r.i, r.x.toFixed(14), r.fx.toExponential(3)])} />
      </Card>
      <AIPanel output={output} />
    </div>
  );
}