import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, LiveGraph, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

const schema = [
  { key: 'm', label: 'Mass m (kg)', min: 0.1, max: 5, step: 0.1, type: 'range' },
  { key: 'k', label: 'Spring k (N/m)', min: 1, max: 80, step: 0.5, type: 'range' },
  { key: 'b', label: 'Damping b', min: 0, max: 4, step: 0.02, type: 'range' },
  { key: 'F0', label: 'Drive force F0 (N)', min: 0, max: 10, step: 0.1, type: 'range' },
  { key: 'wd', label: 'Drive freq ωd (rad/s)', min: 0, max: 20, step: 0.05, type: 'range' },
  { key: 'x0', label: 'Initial x (m)', min: -3, max: 3, step: 0.05, type: 'range' },
];

function makeInitial(p) { return { x: p.x0, v: 0, t: 0 }; }
function step(s, dt, p, t) {
  // semi-implicit Euler with external drive: m x'' + b x' + k x = F0 cos(wd t)
  const a = (-p.k * s.x - p.b * s.v + p.F0 * Math.cos(p.wd * t)) / p.m;
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
}
function sample(s, p) {
  const KE = 0.5 * p.m * s.v * s.v, PE = 0.5 * p.k * s.x * s.x;
  return { x: +s.x.toFixed(3), v: +s.v.toFixed(3), KE: +KE.toFixed(3), PE: +PE.toFixed(3) };
}
function computeStats(s, p) {
  const w0 = Math.sqrt(p.k / p.m);
  const zeta = p.b / (2 * Math.sqrt(p.k * p.m));
  return { 'x (m)': s.x.toFixed(3), 'v (m/s)': s.v.toFixed(3), 'ω0': w0.toFixed(3), 'ζ damping': zeta.toFixed(3), 'ω0/ωd': (w0 / (p.wd || 1)).toFixed(2) };
}

export default function SpringMass() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ m: 1, k: 20, b: 0.2, F0: 0, wd: 4.47, x0: 1 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, sample, computeStats, resetKey: `${params.m}|${params.k}|${params.x0}` });
  const data = sim.graphData;
  return (
    <SimLayout title="Spring–Mass Oscillator (SHM · Damped · Driven)" configName="spring-mass" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      graph={<LiveGraph data={data} xKey="t" series={[{ key: 'x', color: '#22d3ee' }, { key: 'v', color: '#f97316' }, { key: 'KE', color: '#84cc16' }, { key: 'PE', color: '#a855f7' }]} />}
      exportBar={<ExportBar graphData={data} config={params} canvasRef={canvasRef} name="spring-mass" />} />
  );
}