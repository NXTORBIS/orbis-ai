import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

const schema = [
  { key: 'N', label: 'Particles', min: 20, max: 200, step: 5, type: 'range' },
  { key: 'T', label: 'Temperature (set)', min: 0.1, max: 5, step: 0.05, type: 'range' },
  { key: 'boxW', label: 'Box width', min: 0.4, max: 1, step: 0.01, type: 'range' },
];

function gauss(rng, sigma) { let u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * sigma; }
function makeInitial(p) {
  const rng = (() => { let s = 12345; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
  const x = [], y = [], vx = [], vy = [];
  const sigma = Math.sqrt(p.T);
  for (let i = 0; i < p.N; i++) { x.push((0.1 + 0.8 * rng()) * p.boxW); y.push(0.1 + 0.8 * rng()); vx.push(gauss(rng, sigma)); vy.push(gauss(rng, sigma)); }
  return { x, y, vx, vy, wallAcc: 0, wallTime: 0, pressure: 0, hist: new Array(20).fill(0) };
}
function step(s, dt, p) {
  const W = p.boxW, H = 1, r = 0.012;
  for (let i = 0; i < s.x.length; i++) { s.x[i] += s.vx[i] * dt; s.y[i] += s.vy[i] * dt; }
  for (let i = 0; i < s.x.length; i++) {
    if (s.x[i] < r) { s.x[i] = r; s.wallAcc += 2 * Math.abs(s.vx[i]); s.vx[i] = Math.abs(s.vx[i]); }
    if (s.x[i] > W - r) { s.x[i] = W - r; s.wallAcc += 2 * Math.abs(s.vx[i]); s.vx[i] = -Math.abs(s.vx[i]); }
    if (s.y[i] < r) { s.y[i] = r; s.wallAcc += 2 * Math.abs(s.vy[i]); s.vy[i] = Math.abs(s.vy[i]); }
    if (s.y[i] > H - r) { s.y[i] = H - r; s.wallAcc += 2 * Math.abs(s.vy[i]); s.vy[i] = -Math.abs(s.vy[i]); }
  }
  // pairwise elastic collisions
  for (let i = 0; i < s.x.length; i++) for (let j = i + 1; j < s.x.length; j++) {
    const dx = s.x[j] - s.x[i], dy = s.y[j] - s.y[i]; const d2 = dx * dx + dy * dy; const rr = 2 * r;
    if (d2 < rr * rr && d2 > 1e-9) {
      const d = Math.sqrt(d2); const nx = dx / d, ny = dy / d; const dvx = s.vx[j] - s.vx[i], dvy = s.vy[j] - s.vy[i];
      const vn = dvx * nx + dvy * ny; if (vn < 0) { s.vx[i] += vn * nx; s.vy[i] += vn * ny; s.vx[j] -= vn * nx; s.vy[j] -= vn * ny; }
      const overlap = (rr - d) / 2; s.x[i] -= nx * overlap; s.y[i] -= ny * overlap; s.x[j] += nx * overlap; s.y[j] += ny * overlap;
    }
  }
  s.wallTime += dt;
  if (s.wallTime > 0.1) { const perim = 2 * (W + H); s.pressure = s.wallAcc / (perim * s.wallTime); s.wallAcc = 0; s.wallTime = 0; }
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const boxX = 20, boxY = 20, boxH = h - 40, boxWpx = boxH * (p.boxW / 1);
  ctx.strokeStyle = 'hsl(var(--muted-foreground))'; ctx.lineWidth = 2; ctx.strokeRect(boxX, boxY, boxWpx, boxH);
  const sx = boxWpx / p.boxW, sy = boxH / 1;
  // particles coloured by speed
  let maxV = 0.001; for (let i = 0; i < s.x.length; i++) maxV = Math.max(maxV, Math.hypot(s.vx[i], s.vy[i]));
  for (let i = 0; i < s.x.length; i++) { const sp = Math.hypot(s.vx[i], s.vy[i]); const hue = 200 - (sp / maxV) * 160; ctx.fillStyle = `hsl(${hue} 90% 60%)`; ctx.beginPath(); ctx.arc(boxX + s.x[i] * sx, boxY + s.y[i] * sy, 3, 0, Math.PI * 2); ctx.fill(); }
  // speed histogram + Maxwell–Boltzmann overlay
  const hbX = boxX + boxWpx + 24, hbW = w - hbX - 16, hbH = boxH, bins = 20; const hist = new Array(bins).fill(0); const vmax = maxV * 1.05;
  for (let i = 0; i < s.x.length; i++) { const sp = Math.hypot(s.vx[i], s.vy[i]); const b = Math.min(bins - 1, Math.floor(sp / vmax * bins)); hist[b]++; }
  const maxC = Math.max(...hist, 1); const bw = hbW / bins;
  ctx.fillStyle = '#22d3ee88'; for (let i = 0; i < bins; i++) { const bh = (hist[i] / maxC) * hbH; ctx.fillRect(hbX + i * bw, boxY + hbH - bh, bw - 1, bh); }
  // MB curve f(v) = (m/kT) v exp(-m v^2 / 2kT), 2D
  ctx.strokeStyle = '#f97316'; ctx.lineWidth = 2; ctx.beginPath();
  const Tmeas = Math.max(0.01, (s.x.reduce((a, _, i) => a + 0.5 * (s.vx[i] ** 2 + s.vy[i] ** 2), 0) / s.x.length));
  for (let i = 0; i <= 80; i++) { const v = (i / 80) * vmax; const f = (v / Tmeas) * Math.exp(-v * v / (2 * Tmeas)); const y = boxY + hbH - (f / (1 / Tmeas)) * hbH * 0.8; if (i === 0) ctx.moveTo(hbX + i * (vmax / 80) * (bw * bins / vmax), y); else ctx.lineTo(hbX + (i / 80) * hbW, y); }
  ctx.stroke();
  ctx.fillStyle = 'hsl(var(--muted-foreground))'; ctx.font = '10px monospace'; ctx.fillText('speed →', hbX, h - 6);
}
function computeStats(s, p) {
  let ke = 0; for (let i = 0; i < s.x.length; i++) ke += 0.5 * (s.vx[i] ** 2 + s.vy[i] ** 2);
  const T = ke / s.x.length; // 2D: T = <KE> (k=m=1)
  return { 'N': s.x.length, '⟨KE⟩': ke.toFixed(2), 'T (meas)': T.toFixed(3), 'P (meas)': s.pressure.toFixed(4), 'PV/NT': (s.pressure * p.boxW / (s.x.length * (T || 1))).toFixed(2) };
}

export default function IdealGas() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ N: 80, T: 1, boxW: 0.8 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats, resetKey: `${params.N}|${params.T}|${params.boxW}` });
  return (
    <SimLayout title="Ideal Gas & Maxwell–Boltzmann" configName="ideal-gas" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="ideal-gas" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Real kinetic theory: 2D elastic particles, wall-momentum pressure, Maxwell–Boltzmann speed distribution (orange curve = theory).</div>} />
  );
}