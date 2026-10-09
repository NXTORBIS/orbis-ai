import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, LiveGraph, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';
import { rk4, deg } from '../lib/math.js';

const schema = [
  { key: 'L', label: 'Length L (m)', min: 0.2, max: 4, step: 0.05, type: 'range' },
  { key: 'g', label: 'Gravity (m/s²)', min: 0.5, max: 25, step: 0.01, type: 'range' },
  { key: 'theta0', label: 'Initial angle (°)', min: -150, max: 150, step: 1, type: 'range' },
  { key: 'damping', label: 'Damping b', min: 0, max: 1.5, step: 0.01, type: 'range' },
];

function makeInitial(p) { return { y: [deg(p.theta0) * Math.PI / 180, 0], trail: [], L: p.L }; }
function deriv(t, y) { return [y[1], -(9.81 / 1) * Math.sin(y[0])]; } // placeholder, replaced below
function step(s, dt, p) {
  const f = (tt, y) => [y[1], -(p.g / p.L) * Math.sin(y[0]) - p.damping * y[1]];
  s.y = rk4(f, 0, s.y, dt);
  s.L = p.L;
  const x = Math.sin(s.y[0]) * p.L, yy = -Math.cos(s.y[0]) * p.L;
  s.trail.push(x, yy); if (s.trail.length > 600) s.trail.splice(0, 2);
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const cx = w / 2, cy = 70;
  const scale = Math.min(w, h) * 0.32;
  // arc reference
  ctx.strokeStyle = 'hsl(var(--border) / 0.3)'; ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.arc(cx, cy, p.L * scale, Math.PI / 2 - 1.4, Math.PI / 2 + 1.4); ctx.stroke(); ctx.setLineDash([]);
  // trail
  ctx.strokeStyle = '#22d3ee88'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < s.trail.length; i += 2) { const x = cx + s.trail[i] * scale, y = cy - s.trail[i + 1] * scale; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
  ctx.stroke();
  // rod
  const bx = cx + Math.sin(s.y[0]) * p.L * scale, by = cy + Math.cos(s.y[0]) * p.L * scale;
  ctx.strokeStyle = 'hsl(var(--muted-foreground))'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(bx, by); ctx.stroke();
  // pivot
  ctx.fillStyle = 'hsl(var(--muted-foreground))'; ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();
  // bob
  ctx.fillStyle = '#f97316'; ctx.beginPath(); ctx.arc(bx, by, 12, 0, Math.PI * 2); ctx.fill();
  // angle arc
  ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, 26, Math.PI / 2, Math.PI / 2 + s.y[0], s.y[0] < 0); ctx.stroke();
}
function sample(s) { return { t: 0, theta: +deg(s.y[0]).toFixed(2), omega: +s.y[1].toFixed(3) }; }
function computeStats(s, p) {
  const small = 2 * Math.PI * Math.sqrt(p.L / p.g);
  const E = 0.5 * (p.L) * s.y[1] * s.y[1] + p.g * p.L * (1 - Math.cos(s.y[0]));
  return { 'θ (°)': deg(s.y[0]).toFixed(1), 'ω (rad/s)': s.y[1].toFixed(3), 'T small (s)': small.toFixed(3), 'Energy (J)': E.toFixed(3) };
}

export default function SimplePendulum() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ L: 1, g: 9.81, theta0: 45, damping: 0 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, sample, computeStats, resetKey: `${params.L}|${params.g}|${params.theta0}|${params.damping}` });
  // tag t onto samples
  const data = sim.graphData;
  return (
    <SimLayout title="Simple Pendulum" configName="pendulum" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      graph={<LiveGraph data={data} xKey="t" series={[{ key: 'theta', color: '#22d3ee' }, { key: 'omega', color: '#f97316' }]} />}
      exportBar={<ExportBar graphData={data} config={params} canvasRef={canvasRef} name="pendulum" />} />
  );
}