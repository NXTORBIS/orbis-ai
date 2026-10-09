import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, LiveGraph, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

// Circular Motion — uniform circular motion with centripetal force.
// Unique focus: angular velocity, centripetal acceleration, period, force vectors.
const schema = [
  { key: 'r', label: 'Radius r (m)', min: 0.5, max: 10, step: 0.1, type: 'range' },
  { key: 'omega', label: 'Angular vel ω (rad/s)', min: 0.1, max: 10, step: 0.05, type: 'range' },
  { key: 'm', label: 'Mass m (kg)', min: 0.1, max: 10, step: 0.1, type: 'range' },
];

function makeInitial(p) { return { theta: 0, t: 0 }; }
function step(s, dt, p, t) { s.theta += p.omega * dt; s.t += dt; }
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const cx = w / 2, cy = h / 2;
  const scale = Math.min(w, h) / 25;
  const r = p.r * scale;
  // orbit
  ctx.strokeStyle = 'hsl(var(--muted-foreground) / 0.3)'; ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  // center
  ctx.fillStyle = 'hsl(var(--muted-foreground))';
  ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();
  // object position
  const px = cx + r * Math.cos(s.theta), py = cy + r * Math.sin(s.theta);
  // radius line
  ctx.strokeStyle = 'hsl(var(--muted-foreground) / 0.4)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(px, py); ctx.stroke();
  // object
  ctx.fillStyle = '#f97316';
  ctx.beginPath(); ctx.arc(px, py, 10 + p.m, 0, Math.PI * 2); ctx.fill();
  // velocity (tangent, cyan)
  const vtan = p.omega * p.r;
  const vx = -Math.sin(s.theta), vy = Math.cos(s.theta);
  ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + vx * vtan * 5, py + vy * vtan * 5); ctx.stroke();
  // centripetal (inward, purple)
  const ac = p.omega * p.omega * p.r;
  const fc = p.m * ac;
  const cxv = -Math.cos(s.theta), cyv = -Math.sin(s.theta);
  ctx.strokeStyle = '#a855f7'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + cxv * fc * 3, py + cyv * fc * 3); ctx.stroke();
  // labels
  ctx.font = '11px monospace';
  ctx.fillStyle = '#22d3ee'; ctx.fillText('v', px + vx * vtan * 5 + 5, py + vy * vtan * 5);
  ctx.fillStyle = '#a855f7'; ctx.fillText('F_c', px + cxv * fc * 3 - 20, py + cyv * fc * 3 + 3);
}
function sample(s, p) {
  const v = p.omega * p.r;
  const ac = p.omega * p.omega * p.r;
  return { theta: +s.theta.toFixed(3), v: +v.toFixed(3), ac: +ac.toFixed(3), x: +(p.r * Math.cos(s.theta)).toFixed(3), y: +(p.r * Math.sin(s.theta)).toFixed(3) };
}
function computeStats(s, p) {
  const v = p.omega * p.r;
  const ac = p.omega * p.omega * p.r;
  const fc = p.m * ac;
  const T = (2 * Math.PI) / p.omega;
  const f = 1 / T;
  return { 'ω (rad/s)': p.omega.toFixed(3), 'v (m/s)': v.toFixed(3), 'a_c (m/s²)': ac.toFixed(3), 'F_c (N)': fc.toFixed(3), 'T (s)': T.toFixed(3), 'f (Hz)': f.toFixed(3) };
}

export default function CircularMotion() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ r: 3, omega: 2, m: 1 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, sample, computeStats, resetKey: `${params.r}|${params.omega}|${params.m}` });
  const data = sim.graphData;
  return (
    <SimLayout title="Circular Motion — Centripetal Force" configName="circular-motion" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      graph={<LiveGraph data={data} xKey="t" series={[{ key: 'x', color: '#22d3ee' }, { key: 'y', color: '#f97318' }, { key: 'v', color: '#84cc16' }, { key: 'ac', color: '#a855f7' }]} />}
      exportBar={<ExportBar graphData={data} config={params} canvasRef={canvasRef} name="circular-motion" />} />
  );
}