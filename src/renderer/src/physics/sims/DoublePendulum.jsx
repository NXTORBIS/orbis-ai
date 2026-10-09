import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, LiveGraph, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';
import { rk4, deg } from '../lib/math.js';

const schema = [
  { key: 'L1', label: 'Length L1 (m)', min: 0.3, max: 2.5, step: 0.05, type: 'range' },
  { key: 'L2', label: 'Length L2 (m)', min: 0.3, max: 2.5, step: 0.05, type: 'range' },
  { key: 'm1', label: 'Mass m1 (kg)', min: 0.1, max: 5, step: 0.1, type: 'range' },
  { key: 'm2', label: 'Mass m2 (kg)', min: 0.1, max: 5, step: 0.1, type: 'range' },
  { key: 'g', label: 'Gravity (m/s²)', min: 0.5, max: 25, step: 0.01, type: 'range' },
  { key: 'a1', label: 'Angle θ1 (°)', min: -160, max: 160, step: 1, type: 'range' },
  { key: 'a2', label: 'Angle θ2 (°)', min: -160, max: 160, step: 1, type: 'range' },
];

// State y = [θ1, θ2, ω1, ω2]. Standard double-pendulum equations (Lagrangian).
function deriv(p, t, y) {
  const [t1, t2, w1, w2] = y;
  const { L1, L2, m1, m2, g } = p;
  const d = t1 - t2;
  const den = 2 * m1 + m2 - m2 * Math.cos(2 * d);
  const a1 = (-g * (2 * m1 + m2) * Math.sin(t1) - m2 * g * Math.sin(t1 - 2 * t2) - 2 * Math.sin(d) * m2 * (w2 * w2 * L2 + w1 * w1 * L1 * Math.cos(d))) / (L1 * den);
  const a2 = (2 * Math.sin(d) * (w1 * w1 * L1 * (m1 + m2) + g * (m1 + m2) * Math.cos(t1) + w2 * w2 * L2 * m2 * Math.cos(d))) / (L2 * den);
  return [w1, w2, a1, a2];
}
function makeInitial(p) { return { y: [deg(p.a1) * Math.PI / 180, deg(p.a2) * Math.PI / 180, 0, 0], trail: [] }; }
function step(s, dt, p) {
  s.y = rk4((t, y) => deriv(p, t, y), 0, s.y, dt);
  const x2 = Math.sin(s.y[0]) * p.L1 + Math.sin(s.y[1]) * p.L2;
  const y2 = -(Math.cos(s.y[0]) * p.L1 + Math.cos(s.y[1]) * p.L2);
  s.trail.push(x2, y2); if (s.trail.length > 800) s.trail.splice(0, 2);
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const cx = w / 2, cy = 80;
  const scale = Math.min(w, h) * 0.22;
  // trail
  ctx.strokeStyle = '#22d3ee66'; ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let i = 0; i < s.trail.length; i += 2) { const x = cx + s.trail[i] * scale, y = cy - s.trail[i + 1] * scale; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
  ctx.stroke();
  const x1 = cx + Math.sin(s.y[0]) * p.L1 * scale, y1 = cy + Math.cos(s.y[0]) * p.L1 * scale;
  const x2 = x1 + Math.sin(s.y[1]) * p.L2 * scale, y2 = y1 + Math.cos(s.y[1]) * p.L2 * scale;
  ctx.strokeStyle = 'hsl(var(--muted-foreground))'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.fillStyle = 'hsl(var(--muted-foreground))'; ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#22d3ee'; ctx.beginPath(); ctx.arc(x1, y1, 8 + p.m1, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f97316'; ctx.beginPath(); ctx.arc(x2, y2, 8 + p.m2, 0, Math.PI * 2); ctx.fill();
}
function computeStats(s, p) {
  const [t1, t2, w1, w2] = s.y;
  const KE = 0.5 * p.m1 * (p.L1 * w1) ** 2 + 0.5 * p.m2 * ((p.L1 * w1) ** 2 + (p.L2 * w2) ** 2 + 2 * p.L1 * p.L2 * w1 * w2 * Math.cos(t1 - t2));
  const PE = -(p.m1 + p.m2) * p.g * p.L1 * Math.cos(t1) - p.m2 * p.g * p.L2 * Math.cos(t2);
  return { 'θ1 (°)': deg(t1).toFixed(1), 'θ2 (°)': deg(t2).toFixed(1), 'ω1': w1.toFixed(2), 'ω2': w2.toFixed(2), 'E (J)': (KE + PE).toFixed(2) };
}
function sample(s) { return { a: +deg(s.y[0]).toFixed(1), b: +deg(s.y[1]).toFixed(1) }; }

export default function DoublePendulum() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ L1: 1, L2: 1, m1: 1, m2: 1, g: 9.81, a1: 120, a2: -10 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, sample, computeStats, resetKey: `${params.L1}|${params.L2}|${params.m1}|${params.m2}|${params.g}|${params.a1}|${params.a2}` });
  const data = sim.graphData;
  return (
    <SimLayout title="Double Pendulum (Chaotic)" configName="double-pendulum" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      graph={<LiveGraph data={data} xKey="t" series={[{ key: 'a', color: '#22d3ee' }, { key: 'b', color: '#f97316' }]} />}
      exportBar={<ExportBar graphData={data} config={params} canvasRef={canvasRef} name="double-pendulum" />} />
  );
}