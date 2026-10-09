import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, LiveGraph, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

// SHM Simulator — displacement, velocity, acceleration, and phase relationships.
// Unique focus: x-t, v-t, a-t curves and the phase circle (x vs v parametric plot).
const schema = [
  { key: 'A', label: 'Amplitude A (m)', min: 0.1, max: 3, step: 0.05, type: 'range' },
  { key: 'omega', label: 'Angular freq ω (rad/s)', min: 0.1, max: 15, step: 0.05, type: 'range' },
  { key: 'phase', label: 'Phase φ (rad)', min: 0, max: 6.28, step: 0.05, type: 'range' },
];

function makeInitial(p) { return { t: 0 }; }
function step(s, dt, p, t) { s.t += dt; }
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const cx = w / 2, cy = h / 2;
  const scale = Math.min(w, h) / 8;
  // Phase circle (x horizontal, v scaled vertical)
  const r = p.A * scale;
  ctx.strokeStyle = 'hsl(var(--muted-foreground) / 0.3)'; ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  // axes
  ctx.strokeStyle = 'hsl(var(--muted-foreground) / 0.3)';
  ctx.beginPath(); ctx.moveTo(cx - r - 20, cy); ctx.lineTo(cx + r + 20, cy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx, cy + r + 20); ctx.lineTo(cx, cy - r - 20); ctx.stroke();
  // current point on phase circle
  const x = p.A * Math.cos(p.omega * s.t + p.phase);
  const v = -p.A * p.omega * Math.sin(p.omega * s.t + p.phase);
  const px = cx + x * scale, py = cy - v / p.omega * scale; // normalize v by omega for circle
  // trail (phase trajectory)
  ctx.strokeStyle = '#22d3ee44'; ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i <= 60; i++) {
    const ti = s.t - (60 - i) * 0.02;
    const xi = p.A * Math.cos(p.omega * ti + p.phase);
    const vi = -p.A * p.omega * Math.sin(p.omega * ti + p.phase);
    const tx = cx + xi * scale, ty = cy - vi / p.omega * scale;
    if (i === 0) ctx.moveTo(tx, ty); else ctx.lineTo(tx, ty);
  }
  ctx.stroke();
  // current point
  ctx.fillStyle = '#f97316';
  ctx.beginPath(); ctx.arc(px, py, 8, 0, Math.PI * 2); ctx.fill();
  // radius line
  ctx.strokeStyle = '#f9731666'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(px, py); ctx.stroke();
  // labels
  ctx.font = '11px monospace';
  ctx.fillStyle = '#22d3ee'; ctx.fillText('x', cx + r + 10, cy + 4);
  ctx.fillStyle = '#f97316'; ctx.fillText('v/ω', cx + 5, cy - r - 10);
}
function sample(s, p) {
  const x = p.A * Math.cos(p.omega * s.t + p.phase);
  const v = -p.A * p.omega * Math.sin(p.omega * s.t + p.phase);
  const a = -p.A * p.omega * p.omega * Math.cos(p.omega * s.t + p.phase);
  return { x: +x.toFixed(3), v: +v.toFixed(3), a: +a.toFixed(3) };
}
function computeStats(s, p) {
  const x = p.A * Math.cos(p.omega * s.t + p.phase);
  const v = -p.A * p.omega * Math.sin(p.omega * s.t + p.phase);
  const a = -p.omega * p.omega * x;
  const T = (2 * Math.PI) / p.omega;
  const E = 0.5 * p.omega * p.omega * p.A * p.A; // E = 0.5 k A^2, k = omega^2 (unit mass)
  return { 'x (m)': x.toFixed(3), 'v (m/s)': v.toFixed(3), 'a (m/s²)': a.toFixed(3), 'T (s)': T.toFixed(3), 'ω (rad/s)': p.omega.toFixed(3), 'E (J/kg)': E.toFixed(3) };
}

export default function SHMSim() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ A: 1.5, omega: 3, phase: 0 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, sample, computeStats, resetKey: `${params.A}|${params.omega}|${params.phase}` });
  const data = sim.graphData;
  return (
    <SimLayout title="SHM Simulator — Phase & Kinematics" configName="shm-sim" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      graph={<LiveGraph data={data} xKey="t" series={[{ key: 'x', color: '#22d3ee' }, { key: 'v', color: '#f97316' }, { key: 'a', color: '#a855f7' }]} />}
      exportBar={<ExportBar graphData={data} config={params} canvasRef={canvasRef} name="shm-sim" />} />
  );
}