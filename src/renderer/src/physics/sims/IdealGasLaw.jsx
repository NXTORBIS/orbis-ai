// Ideal Gas Law — PV = NkT. A unified interactive gas where the user sets
// P, V, N, and T independently and sees the equation of state verified,
// with a live state-space diagram showing where the gas sits on the PV surface.
import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

const schema = [
  { key: 'N', label: 'Particle count N', min: 10, max: 150, step: 5, type: 'range' },
  { key: 'T', label: 'Temperature T', min: 0.2, max: 4, step: 0.05, type: 'range' },
  { key: 'boxW', label: 'Volume V', min: 0.2, max: 0.95, step: 0.01, type: 'range' },
];

function gauss(rng, sigma) { let u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * sigma; }
function makeInitial(p) {
  const rng = (() => { let s = 99; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
  const x = [], y = [], vx = [], vy = []; const sigma = Math.sqrt(p.T);
  for (let i = 0; i < p.N; i++) { x.push((0.05 + 0.9 * rng()) * p.boxW); y.push(0.05 + 0.9 * rng()); vx.push(gauss(rng, sigma)); vy.push(gauss(rng, sigma)); }
  return { x, y, vx, vy, wallAcc: 0, wallTime: 0, pressure: 0 };
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
  s.wallTime += dt;
  if (s.wallTime > 0.15) { const perim = 2 * (W + H); s.pressure = s.wallAcc / (perim * s.wallTime); s.wallAcc = 0; s.wallTime = 0; }
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const boxX = 20, boxY = 20, boxH = h - 40, boxWpx = boxH * p.boxW;
  ctx.strokeStyle = 'hsl(var(--muted-foreground))'; ctx.lineWidth = 2; ctx.strokeRect(boxX, boxY, boxWpx, boxH);
  const sx = boxWpx / p.boxW, sy = boxH / 1;
  for (let i = 0; i < s.x.length; i++) { const sp = Math.hypot(s.vx[i], s.vy[i]); ctx.fillStyle = `hsl(${200 - sp * 40} 90% 60%)`; ctx.beginPath(); ctx.arc(boxX + s.x[i] * sx, boxY + s.y[i] * sy, 3, 0, Math.PI * 2); ctx.fill(); }
  // PV isotherm family
  const pvX = boxX + boxH + 30, pvW = w - pvX - 16, pvH = boxH;
  ctx.strokeStyle = 'hsl(var(--border))'; ctx.strokeRect(pvX, boxY, pvW, pvH);
  const Vmax = 1, Pmax = p.N * 4 / (0.2 * 20);
  const X = (V) => pvX + (V / Vmax) * pvW, Y = (P) => boxY + pvH - Math.min(P / Pmax, 1) * pvH;
  for (const Tc of [0.5, 1, 2, 4]) {
    ctx.strokeStyle = `hsla(${200 - Tc * 30}, 80%, 60%, 0.4)`; ctx.lineWidth = 1; ctx.beginPath();
    for (let i = 0; i <= 60; i++) { const V = 0.1 + (i / 60) * 0.85; const Pth = p.N * Tc / (V * 20); if (i === 0) ctx.moveTo(X(V), Y(Pth)); else ctx.lineTo(X(V), Y(Pth)); } ctx.stroke();
  }
  // current state
  const Pth = p.N * p.T / (p.boxW * 20);
  ctx.fillStyle = '#f43f5e'; ctx.beginPath(); ctx.arc(X(p.boxW), Y(Pth), 6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'hsl(var(--muted-foreground))'; ctx.font = '10px monospace'; ctx.fillText('V →', pvX + pvW - 24, boxY + pvH + 14); ctx.fillText('P ↑', pvX - 14, boxY + 10);
}
function computeStats(s, p) { const Pth = p.N * p.T / (p.boxW * 20); return { 'N': p.N, 'T': p.T.toFixed(2), 'V': p.boxW.toFixed(2), 'P (theory)': Pth.toFixed(3), 'PV/(NT)': (Pth * p.boxW / (p.N * p.T)).toFixed(3) }; }

export default function IdealGasLaw() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ N: 60, T: 1, boxW: 0.6 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats, resetKey: `${params.N}|${params.T}|${params.boxW}` });
  return (
    <SimLayout title="Ideal Gas Law (PV = NkT)" configName="ideal-gas-law" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="ideal-gas-law" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">PV = NkT unifies Boyle, Charles, and Gay-Lussac. The red dot is the current state on the P-V plane; coloured curves are isotherms at different T. PV/(NT) ≈ 1 confirms the law.</div>} />
  );
}