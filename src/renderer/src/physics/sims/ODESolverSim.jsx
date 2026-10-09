// ODE Solver — Euler, RK2, RK4, adaptive RK45 accuracy vs cost
import React, { useState, useMemo } from 'react';
import { ResearchHeader, Card, NumField, SciTable, AIPanel, useAIExplain } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';
import { euler, rk2, rk4, rk45 } from '../lib/numerics.js';

const SYSTEMS = {
  "y'' = −y (cosine)": { f: (t, y) => [y[1], -y[0]], y0: [1, 0], analytic: (t) => Math.cos(t) },
  "y'' = −ω²y (oscillator)": { f: (t, y, p) => [y[1], -p.w * p.w * y[0]], y0: [1, 0], analytic: (t, p) => Math.cos(p.w * t) },
  "Lotka–Volterra": { f: (t, y, p) => [p.a * y[0] - p.b * y[0] * y[1], p.c * y[0] * y[1] - p.d * y[1]], y0: [10, 5], analytic: null },
  "Van der Pol": { f: (t, y, p) => [y[1], p.mu * (1 - y[0] * y[0]) * y[1] - y[0]], y0: [1, 0], analytic: null },
};

export default function ODESolverSim() {
  const [sysKey, setSysKey] = useState("y'' = −y (cosine)");
  const [method, setMethod] = useState('RK4');
  const [dt, setDt] = useState(0.1);
  const [steps, setSteps] = useState(200);
  const [w, setW] = useState(1);
  const [mu, setMu] = useState(1);
  const { explain, explaining, output } = useAIExplain();
  const sys = SYSTEMS[sysKey];
  const params = { w, mu };

  const { series, maxErr, finalErr, adaptiveSteps } = useMemo(() => {
    const methods = { Euler: euler, RK2: rk2, RK4: (f, t, y, h) => rk4(f, t, y, h) };
    const f = (t, y) => sys.f(t, y, params);
    let y = sys.y0.slice();
    const ser = [{ t: 0, num: y[0], ana: sys.analytic ? sys.analytic(0, params) : null }];
    let me = 0, fe = 0;
    for (let i = 1; i <= steps; i++) {
      y = methods[method](f, (i - 1) * dt, y, dt);
      const t = i * dt;
      const ana = sys.analytic ? sys.analytic(t, params) : null;
      ser.push({ t, num: y[0], ana });
      if (ana !== null) { const e = Math.abs(y[0] - ana); me = Math.max(me, e); fe = e; }
    }
    const ad = rk45(f, 0, sys.y0, steps * dt, { h0: dt, tol: 1e-8 });
    return { series: ser, maxErr: me, finalErr: fe, adaptiveSteps: ad.accepted };
  }, [sysKey, method, dt, steps, w, mu]);

  const convergence = useMemo(() => {
    if (!sys.analytic) return [];
    const f = (t, y) => sys.f(t, y, params);
    const pts = [];
    for (let e = -1; e >= -5; e -= 0.25) {
      const h = Math.pow(10, e);
      const nSteps = Math.round(20 / h);
      let yE = sys.y0.slice(), yR = sys.y0.slice();
      let meE = 0, meR = 0;
      for (let i = 1; i <= nSteps; i++) {
        yE = euler(f, (i - 1) * h, yE, h);
        yR = rk4(f, (i - 1) * h, yR, h);
        const t = i * h;
        const a = sys.analytic(t, params);
        meE = Math.max(meE, Math.abs(yE[0] - a));
        meR = Math.max(meR, Math.abs(yR[0] - a));
      }
      pts.push({ h, euler: meE, rk4: meR });
    }
    return pts;
  }, [sysKey, w, mu, sys]);

  return (
    <div className="space-y-4">
      <ResearchHeader title="ODE Solver — Accuracy vs Cost"
        subtitle="Euler (O(h)), RK2 (O(h²)), RK4 (O(h⁴)), adaptive RK45 (error-controlled). Watch Euler drift while RK4 tracks the analytic curve."
        onExplain={() => explain(`Solving ${sysKey} with ${method}, dt=${dt}, steps=${steps}. Max error = ${maxErr.toExponential(4)}, final error = ${finalErr.toExponential(4)}. Adaptive RK45 used ${adaptiveSteps} accepted steps for the same interval. RK4 is 4× the cost per step but vastly more accurate.`)}
        explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card title="Settings">
          <label className="block text-sm"><span className="text-muted-foreground">System</span>
            <select value={sysKey} onChange={(e) => setSysKey(e.target.value)} className="mt-1 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm">
              {Object.keys(SYSTEMS).map((k) => <option key={k} className="bg-background">{k}</option>)}
            </select></label>
          <label className="block text-sm mt-2"><span className="text-muted-foreground">Method</span>
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="mt-1 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm">
              {['Euler', 'RK2', 'RK4'].map((m) => <option key={m} className="bg-background">{m}</option>)}
            </select></label>
          <div className="mt-2"><NumField label="Δt" value={dt} onChange={setDt} min={0.01} max={0.5} step={0.01} /></div>
          <div className="mt-2"><NumField label="steps" value={steps} onChange={setSteps} min={50} max={2000} step={50} /></div>
          {sysKey.includes('ω') && <div className="mt-2"><NumField label="ω" value={w} onChange={setW} min={0.5} max={5} step={0.1} /></div>}
          {sysKey.includes('Van der Pol') && <div className="mt-2"><NumField label="μ" value={mu} onChange={setMu} min={0.1} max={5} step={0.1} /></div>}
        </Card>
        <div className="space-y-3">
          <SciPlot type="line" data={series} xKey="t"
            series={[{ key: 'num', label: method, color: '#22d3ee' },
                    sys.analytic ? { key: 'ana', label: 'analytic', color: '#f97316' } : { key: '_skip', label: '', color: 'transparent' }].filter((s) => s.key !== '_skip')}
            xLabel="t" yLabel="y" height={240} exportName="ode-solution" />
          <SciTable headers={['Metric', 'Value']} rows={[
            ['Method', method], ['Max |error|', maxErr.toExponential(4)],
            ['Final |error|', finalErr.toExponential(4)],
            ['RK45 adaptive steps', adaptiveSteps],
            ['Cost per step', method === 'Euler' ? '1 eval' : method === 'RK2' ? '2 evals' : '4 evals'],
          ]} />
        </div>
      </div>
      {convergence.length > 0 && (
        <Card title="Convergence: error vs Δt (log-log)">
          <SciPlot type="line" data={convergence} xKey="h" log="log"
            series={[{ key: 'euler', label: 'Euler O(h)', color: '#f97316' },
                    { key: 'rk4', label: 'RK4 O(h⁴)', color: '#22d3ee' }]}
            xLabel="Δt" yLabel="max |error|" height={200} exportName="ode-convergence" />
        </Card>
      )}
      <AIPanel output={output} />
    </div>
  );
}