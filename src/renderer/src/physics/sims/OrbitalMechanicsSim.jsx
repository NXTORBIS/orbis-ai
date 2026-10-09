import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, LiveGraph, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

const schema = [
  { key: 'v0', label: 'Initial velocity', min: 2, max: 12, step: 0.1, type: 'range' },
  { key: 'angle', label: 'Launch angle (°)', min: 0, max: 90, step: 1, type: 'range' },
  { key: 'M', label: 'Central mass', min: 100, max: 1000, step: 10, type: 'range' },
  { key: 'trails', label: 'Show trail', type: 'toggle' },
];

function makeInitial(p) {
  const v = p.v0;
  const ang = (p.angle * Math.PI) / 180;
  return { x: 150, y: 0, vx: v * Math.cos(ang), vy: v * Math.sin(ang), trail: [] };
}

function step(s, dt, p) {
  const r2 = s.x * s.x + s.y * s.y + 1;
  const r = Math.sqrt(r2);
  const a = -p.M / r2;
  s.vx += (a * s.x / r) * dt;
  s.vy += (a * s.y / r) * dt;
  s.x += s.vx * dt;
  s.y += s.vy * dt;
  if (p.trails) { s.trail.push([s.x, s.y]); if (s.trail.length > 800) s.trail.shift(); }
}

function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const cx = w / 2, cy = h / 2;
  // central body
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 20);
  grad.addColorStop(0, '#fde047'); grad.addColorStop(0.5, '#f97316'); grad.addColorStop(1, '#f9731600');
  ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(cx, cy, 20, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fde047'; ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2); ctx.fill();
  // trail
  if (p.trails && s.trail.length > 1) {
    ctx.strokeStyle = '#22d3ee88'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < s.trail.length; i++) {
      const x = cx + s.trail[i][0], y = cy + s.trail[i][1];
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // orbiting body
  ctx.fillStyle = '#22d3ee'; ctx.beginPath(); ctx.arc(cx + s.x, cy + s.y, 5, 0, Math.PI * 2); ctx.fill();
  // velocity vector
  ctx.strokeStyle = '#84cc16'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(cx + s.x, cy + s.y); ctx.lineTo(cx + s.x + s.vx * 5, cy + s.y + s.vy * 5); ctx.stroke();
}

function sample(s, p) {
  const r = Math.sqrt(s.x * s.x + s.y * s.y + 1);
  const v2 = s.vx * s.vx + s.vy * s.vy;
  const KE = 0.5 * v2, PE = -p.M / r;
  const E = KE + PE;
  const L = s.x * s.vy - s.y * s.vx;
  return { E: +E.toFixed(2), L: +L.toFixed(2), r: +r.toFixed(1) };
}

function computeStats(s, p) {
  const d = sample(s, p);
  const v2 = s.vx * s.vx + s.vy * s.vy;
  const r = Math.sqrt(s.x * s.x + s.y * s.y + 1);
  const vEsc = Math.sqrt(2 * p.M / r);
  const type = v2 < vEsc * vEsc ? 'Bound (ellipse)' : v2 > vEsc * vEsc * 1.001 ? 'Hyperbolic' : 'Parabolic';
  return { 'E': d.E, 'L': d.L, 'r': d.r, 'Orbit': type };
}

export default function OrbitalMechanicsSim() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ v0: 6, angle: 0, M: 500, trails: true });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, sample, computeStats, resetKey: `${params.v0}|${params.angle}|${params.M}` });
  return (
    <SimLayout title="Orbital Mechanics" configName="orbital-mech" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      graph={<LiveGraph data={sim.graphData} xKey="t" series={[{ key: 'E', color: '#22d3ee' }, { key: 'L', color: '#f97316' }, { key: 'r', color: '#84cc16' }]} />}
      exportBar={<ExportBar graphData={sim.graphData} config={params} canvasRef={canvasRef} name="orbital-mech" />} />
  );
}