import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, LiveGraph, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

// Spring–Mass System — Hooke's law, ideal SHM with energy analysis.
// Unique focus: spring constant, amplitude, period relationship, energy oscillation.
// No damping or driving — pure Hooke's law F = -kx.
const schema = [
  { key: 'm', label: 'Mass m (kg)', min: 0.1, max: 5, step: 0.1, type: 'range' },
  { key: 'k', label: 'Spring k (N/m)', min: 1, max: 100, step: 1, type: 'range' },
  { key: 'A', label: 'Amplitude A (m)', min: 0.1, max: 3, step: 0.05, type: 'range' },
];

function makeInitial(p) { return { x: p.A, v: 0, t: 0 }; }
function step(s, dt, p, t) {
  // Pure Hooke's law: m x'' = -k x  (semi-implicit Euler)
  const a = (-p.k * s.x) / p.m;
  s.v += a * dt; s.x += s.v * dt; s.t += dt;
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const cy = h / 2;
  const wallX = 60;
  const restX = w * 0.5;
  const px = restX + s.x * 40;
  // wall
  ctx.strokeStyle = 'hsl(var(--muted-foreground))'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(wallX, cy - 50); ctx.lineTo(wallX, cy + 50); ctx.stroke();
  for (let i = 0; i < 10; i++) { ctx.beginPath(); ctx.moveTo(wallX - 12, cy - 50 + i * 10); ctx.lineTo(wallX, cy - 42 + i * 10); ctx.stroke(); }
  // spring zigzag
  ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2;
  const coils = 14, seg = (px - wallX - 20) / coils;
  ctx.beginPath(); ctx.moveTo(wallX, cy);
  for (let i = 0; i < coils; i++) { const xx = wallX + 10 + seg * (i + 0.5); ctx.lineTo(xx, cy + (i % 2 ? 14 : -14)); }
  ctx.lineTo(px - 20, cy); ctx.lineTo(px, cy); ctx.stroke();
  // mass
  ctx.fillStyle = '#f97316'; ctx.fillRect(px, cy - 24, 48, 48);
  // equilibrium
  ctx.strokeStyle = 'hsl(var(--muted-foreground) / 0.4)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(restX, cy - 60); ctx.lineTo(restX, cy + 60); ctx.stroke(); ctx.setLineDash([]);
  // amplitude markers
  ctx.strokeStyle = 'hsl(var(--muted-foreground) / 0.2)'; ctx.setLineDash([2, 6]);
  ctx.beginPath(); ctx.moveTo(restX + p.A * 40, cy - 40); ctx.lineTo(restX + p.A * 40, cy + 40); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(restX - p.A * 40, cy - 40); ctx.lineTo(restX - p.A * 40, cy + 40); ctx.stroke();
  ctx.setLineDash([]);
  // energy bars
  const KE = 0.5 * p.m * s.v * s.v;
  const PE = 0.5 * p.k * s.x * s.x;
  const Etot = 0.5 * p.k * p.A * p.A;
  const maxE = Math.max(Etot, 0.001);
  const barH = 80, barY = h - 100;
  const drawEBar = (label, val, color, x) => {
    const bh = (val / maxE) * barH;
    ctx.fillStyle = color; ctx.fillRect(x, barY + barH - bh, 30, bh);
    ctx.strokeStyle = 'hsl(var(--muted-foreground) / 0.3)'; ctx.lineWidth = 1;
    ctx.strokeRect(x, barY, 30, barH);
    ctx.fillStyle = color; ctx.font = '10px monospace'; ctx.fillText(label, x, barY - 5);
  };
  drawEBar('KE', KE, '#22d3ee', w - 130);
  drawEBar('PE', PE, '#a855f7', w - 90);
  drawEBar('E', Etot, '#84cc16', w - 50);
}
function sample(s, p) {
  const KE = 0.5 * p.m * s.v * s.v;
  const PE = 0.5 * p.k * s.x * s.x;
  return { x: +s.x.toFixed(3), v: +s.v.toFixed(3), KE: +KE.toFixed(3), PE: +PE.toFixed(3), E: +(KE + PE).toFixed(3) };
}
function computeStats(s, p) {
  const w0 = Math.sqrt(p.k / p.m);
  const T = (2 * Math.PI) / w0;
  const f = 1 / T;
  const vmax = w0 * p.A;
  const amax = w0 * w0 * p.A;
  const Etot = 0.5 * p.k * p.A * p.A;
  return { 'ω₀ (rad/s)': w0.toFixed(3), 'T (s)': T.toFixed(3), 'f (Hz)': f.toFixed(3), 'v_max (m/s)': vmax.toFixed(3), 'a_max (m/s²)': amax.toFixed(3), 'E (J)': Etot.toFixed(3) };
}

export default function SpringMassSystem() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ m: 1, k: 25, A: 1.5 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, sample, computeStats, resetKey: `${params.m}|${params.k}|${params.A}` });
  const data = sim.graphData;
  return (
    <SimLayout title="Spring–Mass System — Hooke's Law SHM" configName="spring-mass-system" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      graph={<LiveGraph data={data} xKey="t" series={[{ key: 'x', color: '#22d3ee' }, { key: 'v', color: '#f97316' }, { key: 'KE', color: '#84cc16' }, { key: 'PE', color: '#a855f7' }, { key: 'E', color: '#eab308' }]} />}
      exportBar={<ExportBar graphData={data} config={params} canvasRef={canvasRef} name="spring-mass-system" />} />
  );
}