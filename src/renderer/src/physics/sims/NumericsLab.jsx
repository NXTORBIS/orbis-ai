import React, { useState, useMemo } from 'react';
import { euler, improvedEuler, rk2, rk4, rk45, simpson, trapezoid, gaussLegendre, newton, bisection, secant, monteCarloIntegrate, powerIteration, jacobiEigen } from '../lib/numerics.js';
import { absError, relError } from '../lib/uncertainty.js';
import { ResearchHeader, Card, NumField, SciTable, AIPanel, useAIExplain, downloadFile } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';

export default function NumericsLab() {
  const [tab, setTab] = useState('ode');
  const { explain, explaining, output } = useAIExplain();
  const tabs = [['ode', 'ODE Solvers'], ['int', 'Integration'], ['root', 'Root Finding'], ['eig', 'Eigenvalues'], ['mc', 'Monte Carlo']];
  return (
    <div className="space-y-4">
      <ResearchHeader title="Numerical Simulation Laboratory" subtitle="Real numerical methods with convergence & error analysis against analytic solutions. Euler → RK4 → adaptive RK45, quadrature, root finding, eigenvalue solvers, Monte Carlo."
        onExplain={() => explain('Numerical methods lab comparing solvers with absolute/relative error and convergence.')} explaining={explaining} />
      <div className="flex flex-wrap gap-1.5">{tabs.map(([id, name]) => <button key={id} onClick={() => setTab(id)} className={`rounded-full px-3 py-1.5 text-xs ${tab === id ? 'bg-cyan-j text-background' : 'bg-card/40 text-muted-foreground'}`}>{name}</button>)}</div>
      {tab === 'ode' && <ODEPanel />}
      {tab === 'int' && <IntPanel />}
      {tab === 'root' && <RootPanel />}
      {tab === 'eig' && <EigPanel />}
      {tab === 'mc' && <MCPanel />}
      <AIPanel output={output} />
    </div>
  );
}

function ODEPanel() {
  const [method, setMethod] = useState('RK4'); const [dt, setDt] = useState(0.1); const [steps, setSteps] = useState(200);
  const f = (t, y) => [y[1], -y[0]]; // y'' = -y → y = cos t
  const analytic = (t) => Math.cos(t);
  const run = useMemo(() => {
    const methods = { Euler: euler, 'Improved Euler': improvedEuler, RK2: rk2, RK4: rk4 };
    const out = {}; let maxErr = 0; const series = [];
    let y = [1, 0]; series.push({ t: 0, num: 1, ana: 1, err: 0 });
    for (let i = 1; i <= steps; i++) { y = methods[method](f, (i - 1) * dt, y, dt); const t = i * dt; const e = Math.abs(y[0] - analytic(t)); maxErr = Math.max(maxErr, e); series.push({ t, num: y[0], ana: analytic(t), err: e }); }
    out.series = series; out.maxErr = maxErr;
    // adaptive reference
    const ad = rk45(f, 0, [1, 0], steps * dt, { h0: dt, tol: 1e-8 }); out.adaptiveSteps = ad.accepted;
    return out;
  }, [method, dt, steps]);
  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <Card title="Settings">
        <label className="block text-sm"><span className="text-muted-foreground">Method</span>
        <select value={method} onChange={(e) => setMethod(e.target.value)} className="mt-1 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm">{['Euler', 'Improved Euler', 'RK2', 'RK4'].map((m) => <option key={m} className="bg-background">{m}</option>)}</select></label>
        <div className="mt-2"><NumField label="Δt" value={dt} onChange={setDt} min={0.01} max={0.5} step={0.01} /></div>
        <div className="mt-2"><NumField label="steps" value={steps} onChange={setSteps} min={50} max={2000} step={50} /></div>
      </Card>
      <div className="space-y-3">
        <SciPlot type="line" data={run.series} xKey="t" series={[{ key: 'ana', label: 'analytic', color: '#f97316' }, { key: 'num', label: method, color: '#22d3ee' }]} xLabel="t" yLabel="y" height={220} exportName="ode" />
        <SciTable headers={['Metric', 'Value']} rows={[['Max |error|', run.maxErr.toExponential(4)], ['Relative (final)', relError(run.series[run.series.length - 1].num, run.series[run.series.length - 1].ana).toExponential(4)], ['Adaptive RK45 steps', run.adaptiveSteps], ['Test problem', "y'' = −y,  y(0)=1"]]} />
        <p className="text-xs text-muted-foreground">Watch Euler drift while RK4 stays on the analytic curve. The adaptive RK45 reference uses error-controlled step sizing.</p>
      </div>
    </div>
  );
}

function IntPanel() {
  const [n, setN] = useState(20);
  const f = (x) => Math.sin(x) * Math.exp(-x * 0.2);
  const exact = (Math.exp(-Math.PI * 0.2) * (-Math.sin(Math.PI) - 0.2 * Math.cos(Math.PI)) + 0.2) / 1.04;
  const trap = trapezoid(f, 0, Math.PI, n); const simp = simpson(f, 0, Math.PI, n); const gl = gaussLegendre(f, 0, Math.PI, 5);
  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <Card title="Settings"><NumField label="panels n" value={n} onChange={setN} min={2} max={500} step={2} /></Card>
      <Card title="∫₀^π sin(x)·e^(−0.2x) dx">
        <SciTable headers={['Method', 'Result', 'Abs Error', 'Rel Error']} rows={[
          ['Exact', exact.toExponential(10), '—', '—'],
          ['Trapezoid', trap.toExponential(10), absError(trap, exact).toExponential(3), relError(trap, exact).toExponential(3)],
          ['Simpson', simp.toExponential(10), absError(simp, exact).toExponential(3), relError(simp, exact).toExponential(3)],
          ['Gauss–Legendre(5)', gl.toExponential(10), absError(gl, exact).toExponential(3), relError(gl, exact).toExponential(3)],
        ]} />
        <p className="mt-2 text-xs text-muted-foreground">Gauss–Legendre with just 5 points often beats Simpson with hundreds — spectral accuracy on smooth integrands.</p>
      </Card>
    </div>
  );
}

function RootPanel() {
  const [method, setMethod] = useState('Newton'); const [x0, setX0] = useState(1);
  const f = (x) => x * x * x - 2, fp = (x) => 3 * x * x; const exact = Math.cbrt(2);
  const res = method === 'Newton' ? newton(f, fp, x0) : method === 'Bisection' ? bisection(f, 0, 2) : secant(f, x0, x0 + 0.5);
  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <Card title="Settings">
        <select value={method} onChange={(e) => setMethod(e.target.value)} className="w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm">{['Newton', 'Bisection', 'Secant'].map((m) => <option key={m} className="bg-background">{m}</option>)}</select>
        {method !== 'Bisection' && <div className="mt-2"><NumField label="x₀" value={x0} onChange={setX0} min={0.1} max={3} step={0.1} /></div>}
      </Card>
      <Card title="f(x) = x³ − 2,  exact = ∛2">
        <SciTable headers={['iter', 'x', 'f(x)']} rows={res.iters.slice(0, 12).map((r) => [r.i, r.x.toFixed(12), r.fx.toExponential(3)])} />
        <div className="mt-2 text-xs text-muted-foreground">Root = <span className="font-mono text-cyan-j">{res.root.toFixed(14)}</span> · abs error = <span className="font-mono">{absError(res.root, exact).toExponential(4)}</span> · iters = {res.iters.length}</div>
      </Card>
    </div>
  );
}

function EigPanel() {
  const A = [[2, 1, 0], [1, 3, 1], [0, 1, 2]];
  const eigs = jacobiEigen(A); const lead = powerIteration(A);
  return (
    <Card title="Eigenvalue Solvers (symmetric 3×3)">
      <SciTable headers={['Method', 'Eigenvalues']} rows={[
        ['Jacobi (all)', eigs.map((e) => e.toFixed(6)).join(',  ')],
        ['Power iteration (largest)', lead.eigenvalue.toFixed(6)],
        ['Iterations (power)', lead.iterations],
      ]} />
      <p className="mt-2 text-xs text-muted-foreground">Jacobi rotation gives the full spectrum of a real symmetric matrix; power iteration converges to the dominant eigenvalue.</p>
    </Card>
  );
}

function MCPanel() {
  const [n, setN] = useState(100000);
  const f = (x) => x * x; const exact = 1 / 3;
  const res = monteCarloIntegrate(f, 0, 1, n);
  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <Card title="Settings"><NumField label="samples N" value={n} onChange={setN} min={100} max={5000000} step={10000} /></Card>
      <Card title="∫₀¹ x² dx (Monte Carlo)">
        <SciTable headers={['Quantity', 'Value']} rows={[
          ['Estimate', res.value.toFixed(6)], ['Exact', exact.toFixed(6)], ['MC error bar', res.error.toExponential(3)], ['Abs error', absError(res.value, exact).toExponential(3)], ['Samples', n.toLocaleString()],
        ]} />
        <p className="mt-2 text-xs text-muted-foreground">Error scales as 1/√N — quadruple the samples to halve the uncertainty.</p>
      </Card>
    </div>
  );
}