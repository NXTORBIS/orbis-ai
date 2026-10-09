// Brownian Motion — a large tracer particle bombarded by many small fluid
// molecules. The tracer's erratic path is recorded; its MSD grows ∝ t
// (Einstein 1905), confirming the atomic nature of matter.
import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

const schema = [
  { key: 'Nfluid', label: 'Fluid molecules', min: 50, max: 250, step: 10, type: 'range' },
  { key: 'T', label: 'Temperature', min: 0.2, max: 3, step: 0.1, type: 'range' },
  { key: 'mass', label: 'Tracer mass', min: 2, max: 20, step: 1, type: 'range' },
];

function gauss(rng, sigma) { let u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * sigma; }
function makeInitial(p) {
  const rng = (() => { let s = 555; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
  const fx = [], fy = [], fvx = [], fvy = []; const sigma = Math.sqrt(p.T);
  for (let i = 0; i < p.Nfluid; i++) { fx.push(0.05 + 0.9 * rng()); fy.push(0.05 + 0.9 * rng()); fvx.push(gauss(rng, sigma)); fvy.push(gauss(rng, sigma)); }
  return { fx, fy, fvx, fvy, tx: 0.5, ty: 0.5, tvx: 0, tvy: 0, trail: [], t: 0, msd: 0, hist: [] };
}
function step(s, dt, p) {
  const W = 1, H = 1, r = 0.01, R = 0.03;
  for (let i = 0; i < s.fx.length; i++) { s.fx[i] += s.fvx[i] * dt; s.fy[i] += s.fvy[i] * dt; }
  for (let i = 0; i < s.fx.length; i++) {
    if (s.fx[i] < r) { s.fx[i] = r; s.fvx[i] = Math.abs(s.fvx[i]); }
    if (s.fx[i] > W - r) { s.fx[i] = W - r; s.fvx[i] = -Math.abs(s.fvx[i]); }
    if (s.fy[i] < r) { s.fy[i] = r; s.fvy[i] = Math.abs(s.fvy[i]); }
    if (s.fy[i] > H - r) { s.fy[i] = H - r; s.fvy[i] = -Math.abs(s.fvy[i]); }
  }
  // tracer moves + collides with fluid molecules
  s.tx += s.tvx * dt; s.ty += s.tvy * dt;
  if (s.tx < R) { s.tx = R; s.tvx = Math.abs(s.tvx); }
  if (s.tx > W - R) { s.tx = W - R; s.tvx = -Math.abs(s.tvx); }
  if (s.ty < R) { s.ty = R; s.tvy = Math.abs(s.tvy); }
  if (s.ty > H - R) { s.ty = H - R; s.tvy = -Math.abs(s.tvy); }
  for (let i = 0; i < s.fx.length; i++) {
    const dx = s.fx[i] - s.tx, dy = s.fy[i] - s.ty; const d2 = dx * dx + dy * dy; const rr = R + r;
    if (d2 < rr * rr && d2 > 1e-9) {
      const d = Math.sqrt(d2); const nx = dx / d, ny = dy / d;
      const dvx = s.fvx[i] - s.tvx, dvy = s.fvy[i] - s.tvy; const vn = dvx * nx + dvy * ny;
      if (vn < 0) { const J = 2 * vn / (1 + 1 / p.mass); s.tvx += J * nx / p.mass; s.tvy += J * ny / p.mass; s.fvx[i] -= J * nx; s.fvy[i] -= J * ny; }
      const overlap = (rr - d) / 2; s.fx[i] += nx * overlap; s.fy[i] += ny * overlap; s.tx -= nx * overlap; s.ty -= ny * overlap;
    }
  }
  s.t += dt;
  s.trail.push({ x: s.tx, y: s.ty }); if (s.trail.length > 300) s.trail.shift();
  const dx = s.tx - 0.5, dy = s.ty - 0.5; s.msd = dx * dx + dy * dy;
  if (Math.floor(s.t * 10) % 2 === 0) { s.hist.push({ t: +s.t.toFixed(2), msd: +s.msd.toFixed(5) }); if (s.hist.length > 200) s.hist.shift(); }
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const bx = 20, by = 20, bh = h - 120, bw = bh;
  ctx.strokeStyle = 'hsl(var(--muted-foreground))'; ctx.lineWidth = 2; ctx.strokeRect(bx, by, bw, bh);
  const sx = bw, sy = bh;
  // trail
  ctx.strokeStyle = '#f9731666'; ctx.lineWidth = 1; ctx.beginPath();
  for (let i = 0; i < s.trail.length; i++) { const px = bx + s.trail[i].x * sx, py = by + s.trail[i].y * sy; if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); } ctx.stroke();
  // fluid
  ctx.fillStyle = '#22d3ee44';
  for (let i = 0; i < s.fx.length; i++) { ctx.beginPath(); ctx.arc(bx + s.fx[i] * sx, by + s.fy[i] * sy, 2, 0, Math.PI * 2); ctx.fill(); }
  // tracer
  ctx.fillStyle = '#f43f5e'; ctx.beginPath(); ctx.arc(bx + s.tx * sx, by + s.ty * sy, 7, 0, Math.PI * 2); ctx.fill();
  // MSD plot
  const pX = 16, pY = h - 80, pW = w - 32, pH = 60;
  ctx.strokeStyle = 'hsl(var(--border))'; ctx.strokeRect(pX, pY, pW, pH);
  const msdmax = Math.max(0.001, s.hist.length ? s.hist[s.hist.length - 1].msd * 1.2 : 0.01);
  const X = (i) => pX + (i / Math.max(1, s.hist.length - 1)) * pW;
  const Y = (m) => pY + pH - (m / msdmax) * pH;
  ctx.strokeStyle = '#f97316'; ctx.lineWidth = 1.5; ctx.beginPath();
  for (let i = 0; i < s.hist.length; i++) { if (i === 0) ctx.moveTo(X(i), Y(s.hist[i].msd)); else ctx.lineTo(X(i), Y(s.hist[i].msd)); } ctx.stroke();
  ctx.fillStyle = 'hsl(var(--muted-foreground))'; ctx.font = '10px monospace'; ctx.fillText('MSD ∝ t', pX, pY - 3); ctx.fillText('t →', pX + pW - 20, pY + pH + 12);
}
function computeStats(s, p) { return { 'Tracer pos': `(${s.tx.toFixed(2)}, ${s.ty.toFixed(2)})`, 'Tracer v': Math.hypot(s.tvx, s.tvy).toFixed(3), 'MSD': s.msd.toFixed(5), 't': s.t.toFixed(2), 'Fluid N': s.fx.length }; }

export default function BrownianMotion() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ Nfluid: 120, T: 1, mass: 8 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats, resetKey: `${params.Nfluid}|${params.T}|${params.mass}` });
  return (
    <SimLayout title="Brownian Motion" configName="brownian-motion" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      exportBar={<ExportBar graphData={sim.stateRef.current?.hist || []} config={params} canvasRef={canvasRef} name="brownian-motion" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">A large tracer (red) is bombarded by small fluid molecules (cyan). Its erratic path (orange trail) is direct evidence of atoms. The mean-squared displacement grows linearly with time — Einstein's 1905 result.</div>} />
  );
}