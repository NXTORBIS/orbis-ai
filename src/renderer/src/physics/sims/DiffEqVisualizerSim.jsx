// Differential Equation Visualizer — phase portraits, solution curves, error growth
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { CanvasStage, stageBg } from '../ui.jsx';
import { ResearchHeader, Card, NumField, SciTable, AIPanel, useAIExplain } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';
import { rk4 } from '../lib/numerics.js';

const SYSTEMS = {
  'Predator–Prey': {
    f: (t, y, p) => [p.a * y[0] - p.b * y[0] * y[1], p.c * y[0] * y[1] - p.d * y[1]],
    labels: ['prey x', 'predator y'],
    init: [40, 9],
    params: { a: 0.5, b: 0.02, c: 0.01, d: 0.4 },
    range: [0, 80],
    phaseDim: [0, 80, 0, 20],
  },
  'Van der Pol': {
    f: (t, y, p) => [y[1], p.mu * (1 - y[0] * y[0]) * y[1] - y[0]],
    labels: ['x', 'x′'],
    init: [1, 0],
    params: { mu: 1 },
    range: [0, 40],
    phaseDim: [-3, 3, -3, 3],
  },
  'Damped Pendulum': {
    f: (t, y, p) => [y[1], -p.w * p.w * Math.sin(y[0]) - p.g * y[1]],
    labels: ['θ', 'θ′'],
    init: [2.5, 0],
    params: { w: 1, g: 0.2 },
    range: [0, 30],
    phaseDim: [-Math.PI, Math.PI, -3, 3],
  },
  'Harmonic Oscillator': {
    f: (t, y, p) => [y[1], -p.w * p.w * y[0]],
    labels: ['x', 'v'],
    init: [1, 0],
    params: { w: 1 },
    range: [0, 20],
    phaseDim: [-1.5, 1.5, -1.5, 1.5],
  },
};

export default function DiffEqVisualizerSim() {
  const [sysKey, setSysKey] = useState('Predator–Prey');
  const [x0, setX0] = useState(40);
  const [y0, setY0] = useState(9);
  const phaseRef = useRef(null);
  const { explain, explaining, output } = useAIExplain();
  const sys = SYSTEMS[sysKey];

  const { trajectory, timeSeries } = useMemo(() => {
    const f = (t, y) => sys.f(t, y, sys.params);
    let y = [x0, y0];
    const traj = [{ x: y[0], y: y[1] }];
    const ts = [{ t: 0, y0: y[0], y1: y[1] }];
    const dt = 0.01;
    const [tEnd] = sys.range;
    for (let i = 1; i <= tEnd / dt; i++) {
      y = rk4(f, (i - 1) * dt, y, dt);
      traj.push({ x: y[0], y: y[1] });
      ts.push({ t: i * dt, y0: y[0], y1: y[1] });
    }
    return { trajectory: traj, timeSeries: ts };
  }, [sysKey, x0, y0, sys]);

  // Draw phase portrait
  useEffect(() => {
    const cv = phaseRef.current; if (!cv) return;
    const ctx = cv.getContext('2d');
    const w = cv.width, h = cv.height;
    stageBg(ctx, w, h);
    const [xMin, xMax, yMin, yMax] = sys.phaseDim;
    const pad = 30;
    const W = w - 2 * pad, H = h - 2 * pad;
    const X = (x) => pad + ((x - xMin) / (xMax - xMin)) * W;
    const Y = (y) => pad + H - ((y - yMin) / (yMax - yMin)) * H;
    // axes
    ctx.strokeStyle = 'hsl(var(--border) / 0.4)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad, Y(0)); ctx.lineTo(pad + W, Y(0)); ctx.moveTo(X(0), pad); ctx.lineTo(X(0), pad + H); ctx.stroke();
    // vector field
    ctx.strokeStyle = 'hsl(var(--muted-foreground) / 0.2)'; ctx.lineWidth = 0.5;
    for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) {
      const vx = xMin + (xMax - xMin) * i / 15, vy = yMin + (yMax - yMin) * j / 15;
      const [dx, dy] = sys.f(0, [vx, vy], sys.params);
      const mag = Math.hypot(dx, dy);
      if (mag > 0.001) { const n = 8; ctx.beginPath(); ctx.moveTo(X(vx), Y(vy)); ctx.lineTo(X(vx + dx / mag * n * 0.01), Y(vy + dy / mag * n * 0.01)); ctx.stroke(); }
    }
    // trajectory
    ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    trajectory.forEach((p, i) => { if (i === 0) ctx.moveTo(X(p.x), Y(p.y)); else ctx.lineTo(X(p.x), Y(p.y)); });
    ctx.stroke();
    // start point
    ctx.fillStyle = '#f97316'; ctx.beginPath(); ctx.arc(X(x0), Y(y0), 4, 0, 7); ctx.fill();
    // labels
    ctx.fillStyle = 'hsl(var(--muted-foreground))'; ctx.font = '10px monospace';
    ctx.fillText(sys.labels[0], pad + W - 20, Y(0) - 4);
    ctx.fillText(sys.labels[1], X(0) + 4, pad + 10);
  }, [trajectory, sysKey, x0, y0, sys]);

  return (
    <div className="space-y-4">
      <ResearchHeader title="Differential Equation Visualizer — Phase Portrait & Trajectory"
        subtitle="RK4 integration of a 2D dynamical system. The phase portrait shows the vector field and orbit; the time series shows how each variable evolves."
        onExplain={() => explain(`Phase portrait of ${sysKey} starting at (${x0}, ${y0}). The cyan curve is the trajectory through phase space. ${sysKey === 'Predator–Prey' ? 'The closed orbit shows periodic predator-prey cycles.' : sysKey === 'Van der Pol' ? 'The trajectory spirals toward a limit cycle.' : sysKey === 'Damped Pendulum' ? 'The pendulum spirals toward the stable fixed point at the origin.' : 'The harmonic oscillator traces an ellipse in phase space.'}`)}
        explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card title="Settings">
          <label className="block text-sm"><span className="text-muted-foreground">System</span>
            <select value={sysKey} onChange={(e) => { setSysKey(e.target.value); const s = SYSTEMS[e.target.value]; setX0(s.init[0]); setY0(s.init[1]); }} className="mt-1 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm">
              {Object.keys(SYSTEMS).map((k) => <option key={k} className="bg-background">{k}</option>)}
            </select>
          </label>
          <div className="mt-3"><NumField label={`initial ${sys.labels[0]}`} value={x0} onChange={setX0} min={-5} max={80} step={0.5} /></div>
          <div className="mt-2"><NumField label={`initial ${sys.labels[1]}`} value={y0} onChange={setY0} min={-5} max={20} step={0.5} /></div>
        </Card>
        <div className="space-y-3">
          <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden" style={{ height: 280 }}>
            <CanvasStage ref={phaseRef} />
          </div>
          <SciPlot type="line" data={timeSeries} xKey="t"
            series={[{ key: 'y0', label: sys.labels[0], color: '#22d3ee' }, { key: 'y1', label: sys.labels[1], color: '#f97316' }]}
            xLabel="t" yLabel="value" height={200} exportName="diffeq-timeseries" />
        </div>
      </div>
      <AIPanel output={output} />
    </div>
  );
}