// Numerical Integration — convergence study of quadrature rules
import React, { useState, useMemo } from 'react';
import { ResearchHeader, Card, NumField, SciTable, AIPanel, useAIExplain } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';
import { trapezoid, simpson, gaussLegendre } from '../lib/numerics.js';

const FUNCS = {
  'sin(x)·e^(−0.2x)': { f: (x) => Math.sin(x) * Math.exp(-x * 0.2), a: 0, b: Math.PI,
    exact: (Math.exp(-Math.PI * 0.2) * (-Math.sin(Math.PI) - 0.2 * Math.cos(Math.PI)) + 0.2) / 1.04 },
  'x²·sin(x)': { f: (x) => x * x * Math.sin(x), a: 0, b: Math.PI, exact: Math.PI * Math.PI - 4 },
  '1/(1+x²)': { f: (x) => 1 / (1 + x * x), a: 0, b: 1, exact: Math.PI / 4 },
  'e^(−x²)': { f: (x) => Math.exp(-x * x), a: 0, b: 2, exact: 0.8820813888 },
};

export default function NumericalIntegrationSim() {
  const [funcKey, setFuncKey] = useState('sin(x)·e^(−0.2x)');
  const [maxN, setMaxN] = useState(200);
  const { explain, explaining, output } = useAIExplain();
  const { f, a, b, exact } = FUNCS[funcKey];

  const convergence = useMemo(() => {
    const pts = [];
    for (let n = 2; n <= maxN; n += 2) {
      const tr = trapezoid(f, a, b, n);
      const si = simpson(f, a, b, n);
      pts.push({ n, trap_err: Math.abs(tr - exact), simp_err: Math.abs(si - exact) });
    }
    // Gauss-Legendre is fixed-point; show for n=2..6
    const glPts = [];
    for (let np = 2; np <= 6; np++) {
      const gl = gaussLegendre(f, a, b, np);
      glPts.push({ np, gl_err: Math.abs(gl - exact) });
    }
    return { pts, glPts };
  }, [funcKey, maxN, f, a, b, exact]);

  const current = { trap: trapezoid(f, a, b, maxN), simp: simpson(f, a, b, maxN), gl5: gaussLegendre(f, a, b, 5) };

  return (
    <div className="space-y-4">
      <ResearchHeader title="Numerical Integration — Quadrature Convergence"
        subtitle="Trapezoid (O(h²)), Simpson (O(h⁴)), Gauss–Legendre (spectral). Watch error vs panel count on a log plot."
        onExplain={() => explain(`Numerical integration of ${funcKey} on [${a.toFixed(2)}, ${b.toFixed(2)}]. Exact = ${exact.toExponential(8)}. Trapezoid error at N=${maxN}: ${Math.abs(current.trap - exact).toExponential(3)}. Simpson: ${Math.abs(current.simp - exact).toExponential(3)}. Gauss-Legendre(5): ${Math.abs(current.gl5 - exact).toExponential(3)}.`)}
        explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card title="Settings">
          <label className="block text-sm"><span className="text-muted-foreground">Integrand</span>
            <select value={funcKey} onChange={(e) => setFuncKey(e.target.value)} className="mt-1 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm">
              {Object.keys(FUNCS).map((k) => <option key={k} className="bg-background">{k}</option>)}
            </select>
          </label>
          <div className="mt-3"><NumField label="max panels N" value={maxN} onChange={setMaxN} min={4} max={2000} step={2} /></div>
        </Card>
        <div className="space-y-3">
          <SciPlot type="line" data={convergence.pts} xKey="n" log="semi-logy"
            series={[{ key: 'trap_err', label: 'Trapezoid', color: '#f97316' }, { key: 'simp_err', label: 'Simpson', color: '#22d3ee' }]}
            xLabel="panels N" yLabel="|error|" height={240} exportName="quadrature-convergence" />
          <SciTable headers={['Method', 'Result', '|Error|', 'Convergence']} rows={[
            ['Exact', exact.toExponential(10), '—', '—'],
            ['Trapezoid', current.trap.toExponential(10), Math.abs(current.trap - exact).toExponential(3), 'O(h²)'],
            ['Simpson', current.simp.toExponential(10), Math.abs(current.simp - exact).toExponential(3), 'O(h⁴)'],
            ['Gauss–Legendre(5)', current.gl5.toExponential(10), Math.abs(current.gl5 - exact).toExponential(3), 'spectral'],
          ]} />
        </div>
      </div>
      <Card title="Gauss–Legendre error vs points (spectral accuracy)">
        <SciPlot type="bar" data={convergence.glPts} xKey="np"
          series={[{ key: 'gl_err', label: 'GL error', color: '#a855f7' }]}
          xLabel="quadrature points" yLabel="|error|" height={180} exportName="gauss-legendre" />
      </Card>
      <AIPanel output={output} />
    </div>
  );
}