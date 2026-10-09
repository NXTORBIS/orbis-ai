import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, LiveGraph, stageBg } from '../ui.jsx';

const schema = [
  { key: 'mode', label: 'Motion type', type: 'select', options: [{ value: 'cyclotron', label: 'Cyclotron orbit' }, { value: 'exb', label: 'E×B drift' }, { value: 'mirror', label: 'Magnetic mirror' }] },
  { key: 'B', label: 'B field (T)', min: 0.5, max: 5, step: 0.1, type: 'range' },
  { key: 'E', label: 'E field (V/m)', min: 0, max: 3, step: 0.1, type: 'range' },
  { key: 'v0', label: 'Initial speed', min: 0.5, max: 3, step: 0.1, type: 'range' },
];
function makeInitial() { return { x: 0.3, y: 0.5, vx: 0, vy: 1, trail: [] }; }
function step(s, dt, p) {
  s.trail.push({ x: s.x, y: s.y });
  if (s.trail.length > 500) s.trail.shift();
  const B = p.B, E = p.E;
  let Bz = B;
  if (p.mode === 'mirror') {
    // B increases away from center (z=0.5): Bz = B * (1 + 4*(x-0.5)^2)
    Bz = B * (1 + 8 * (s.x - 0.5) * (s.x - 0.5));
  }
  // Lorentz: F = q(E + v×B), B in z-direction
  // v×B = (vx, vy, 0) × (0, 0, Bz) = (vy*Bz, -vx*Bz, 0)
  const ax = E + s.vy * Bz;
  const ay = -s.vx * Bz;
  if (p.mode === 'exb') {
    // E in x-direction, B in z → E×B drift in -y
    s.vx += (E + s.vy * B) * dt;
    s.vy += (-s.vx * B) * dt;
  } else {
    s.vx += ax * dt;
    s.vy += ay * dt;
  }
  s.x += s.vx * dt * 0.1;
  s.y += s.vy * dt * 0.1;
  // Bounce off walls
  if (s.x < 0.05 || s.x > 0.95) { s.vx *= -0.95; s.x = Math.max(0.05, Math.min(0.95, s.x)); }
  if (s.y < 0.05 || s.y > 0.95) { s.vy *= -0.95; s.y = Math.max(0.05, Math.min(0.95, s.y)); }
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  // B field indicators
  ctx.fillStyle = 'rgba(59,130,246,0.15)';
  for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
    const px = (i + 0.5) / 8 * w, py = (j + 0.5) / 8 * h;
    if (p.mode === 'mirror') {
      const Bz = p.B * (1 + 8 * ((i + 0.5) / 8 - 0.5) ** 2);
      ctx.globalAlpha = Math.min(0.3, Bz * 0.05);
    } else { ctx.globalAlpha = 0.1; }
    ctx.beginPath(); ctx.arc(px, py, 2, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
  // Trail
  ctx.strokeStyle = 'rgba(34,211,238,0.5)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); s.trail.forEach((pt, i) => { const px = pt.x * w, py = pt.y * h; if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); }); ctx.stroke();
  // Particle
  ctx.fillStyle = '#fde047'; ctx.beginPath(); ctx.arc(s.x * w, s.y * h, 6, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1; ctx.stroke();
  // Velocity vector
  ctx.strokeStyle = '#f97316'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(s.x * w, s.y * h); ctx.lineTo(s.x * w + s.vx * 15, s.y * h + s.vy * 15); ctx.stroke();
  // Info
  ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '10px monospace'; ctx.textAlign = 'left';
  const r_gyro = Math.hypot(s.vx, s.vy) / p.B;
  ctx.fillText(`r_gyro = mv/qB = ${r_gyro.toFixed(3)}`, 12, h - 16);
  if (p.mode === 'cyclotron') ctx.fillText(`f = qB/2πm = ${(p.B / (2 * Math.PI)).toFixed(3)}`, 12, h - 32);
}
function sample(s, p, t) { return { t: +t.toFixed(3), x: +s.x.toFixed(4), y: +s.y.toFixed(4), v: +Math.hypot(s.vx, s.vy).toFixed(4) }; }
function computeStats(s, p) {
  const v = Math.hypot(s.vx, s.vy);
  const r_gyro = v / p.B;
  return { 'Speed': v.toFixed(3), 'Gyro-radius': r_gyro.toFixed(3), 'B': p.B.toFixed(1) + ' T', 'E': p.E.toFixed(1) + ' V/m' };
}
export default function ChargedMotion() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ mode: 'cyclotron', B: 2, E: 0, v0: 1.5 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, sample, computeStats, resetKey: JSON.stringify(params) });
  return (
    <SimLayout title="Charged Particle Motion" configName="charged-motion" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      graph={<div><div className="text-xs text-muted-foreground mb-1">Speed (constant in pure B field)</div><LiveGraph data={sim.graphData} series={[{ key: 'v', color: '#fde047' }]} height={150} /></div>}
      exportBar={<ExportBar graphData={sim.graphData} config={params} canvasRef={canvasRef} name="charged-motion" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Cyclotron: circular orbit, r = mv/qB, f = qB/2πm. E×B drift: particle drifts perpendicular to both E and B. Magnetic mirror: B strengthens away from center, reflecting particles (cosmic ray trapping).</div>} />
  );
}