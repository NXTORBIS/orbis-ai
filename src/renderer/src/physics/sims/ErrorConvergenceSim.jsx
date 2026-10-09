// Error & Convergence Analysis — truncation, round-off, convergence rates
import React, { useState, useMemo } from 'react';
import { ResearchHeader, Card, NumField, SciTable, AIPanel, useAIExplain } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';
import { euler, rk4, simpson, trapezoid } from '../lib/numerics.js';

export default function ErrorConvergenceSim() {
  const [method, setMethod] = useState('ode');
  const { explain, explaining, output } = useAIExplain();

  // ODE convergence: y'' = -y, y(0)=1 → cos(t)
  const odeConv = useMemo(() => {
    const f = (t, y) => [y[1], -y[0]];
    const pts = [];
    for (let e = -1; e >= -6; e -= 0.25) {
      const h = Math.pow(10, e);
      const nSteps = Math.round(10 / h);
      let yE = [1, 0], yR = [1, 0];
      let meE = 0, meR = 0;
      for (let i = 1; i <= nSteps; i++) {
        yE = euler(f, (i - 1) * h, yE, h);
        yR = rk4(f, (i - 1) * h, yR, h);
        meE = Math.max(meE, Math.abs(yE[0] - Math.cos(i * h)));
        meR = Math.max(meR, Math.abs(yR[0] - Math.cos(i * h)));
      }
      pts.push({ h, euler: meE, rk4: meR });
    }
    return pts;
  }, []);

  // Integration convergence: ∫₀^π sin(x) dx = 2
  const intConv = useMemo(() => {
    const f = (x) => Math.sin(x);
    const pts = [];
    for (let e = 0; e >= -4; e -= 0.25) {
      const n = Math.max(2, Math.round(Math.pow(10, e)));
      const tr = trapezoid(f, 0, Math.PI, n);
      const si = simpson(f, 0, Math.PI, n);
      pts.push({ h: 1 / n, trapezoid: Math.abs(tr - 2), simpson: Math.abs(si - 2) });
    }
    return pts;
  }, []);

  // Round-off accumulation: sum 1/n N times
  const roundoff = useMemo(() => {
    const pts = [];
    for (let e = 1; e <= 8; e++) {
      const N = Math.pow(10, e);
      let s32 = 0, s64 = 0;
      for (let i = 1; i <= N; i++) { s32 += 1 / i; }
      // Kahan summation for reference
      let sum = 0, c = 0;
      for (let i = 1; i <= N; i++) { const x = 1 / i - c; const t = sum + x; c = (t - sum) - x; sum = t; }
      pts.push({ N, naive: s32, kahan: sum, exact: Math.log(N) + 0.5772156649 });
    }
    return pts;
  }, []);

  const data = method === 'ode' ? odeConv : method === 'int' ? intConv : roundoff;
  const series = method === 'ode'
    ? [{ key: 'euler', label: 'Euler O(h)', color: '#f97316' }, { key: 'rk4', label: 'RK4 O(h⁴)', color: '#22d3ee' }]
    : method === 'int'
    ? [{ key: 'trapezoid', label: 'Trapezoid O(h²)', color: '#f97316' }, { key: 'simpson', label: 'Simpson O(h⁴)', color: '#22d3ee' }]
    : [{ key: 'naive', label: 'Naive sum', color: '#f97316' }, { key: 'kahan', label: 'Kahan', color: '#22d3ee' }, { key: 'exact', label: 'ln(N)+γ', color: '#a855f7' }];

  return (
    <div className="space-y-4">
      <ResearchHeader title="Error & Convergence Analysis"
        subtitle="Truncation error (discretisation) decreases with h. Round-off (machine ε) is fixed per operation and accumulates. Total error = truncation + round-off; optimal h balances them."
        onExplain={() => explain(`Error analysis for ${method === 'ode' ? 'ODE solvers' : method === 'int' ? 'quadrature' : 'summation'}. The log-log slope reveals the convergence rate: Euler is O(h¹), RK4 is O(h⁴), trapezoid O(h²), Simpson O(h⁴). Kahan summation compensates for round-off, keeping the sum accurate to machine precision even at N=10⁸ where naive accumulation loses digits.`)}
        explaining={explaining} />
      <div className="flex flex-wrap gap-1.5">
        {[['ode', 'ODE convergence'], ['int', 'Quadrature convergence'], ['roundoff', 'Round-off accumulation']].map(([id, name]) => (
          <button key={id} onClick={() => setMethod(id)} className={`rounded-full px-3 py-1.5 text-xs ${method === id ? 'bg-cyan-j text-background' : 'bg-card/40 text-muted-foreground'}`}>{name}</button>
        ))}
      </div>
      <SciPlot type="line" data={data} xKey={method === 'roundoff' ? 'N' : 'h'} log={method === 'roundoff' ? 'log' : 'log'}
        series={series} xLabel={method === 'roundoff' ? 'N' : 'step h'} yLabel={method === 'roundoff' ? 'Hₙ' : '|error|'} height={280} exportName="error-convergence" />
      <SciTable headers={['Concept', 'Value']} rows={[
        ['Machine ε', '2.22e-16'],
        ['Euler rate', 'O(h) — slope 1'],
        ['RK4 rate', 'O(h⁴) — slope 4'],
        ['Trapezoid', 'O(h²) — slope 2'],
        ['Simpson', 'O(h⁴) — slope 4'],
        ['Kahan summation', 'compensates round-off'],
      ]} />
      <AIPanel output={output} />
    </div>
  );
}