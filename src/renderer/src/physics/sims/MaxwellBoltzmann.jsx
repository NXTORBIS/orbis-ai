// Maxwell–Boltzmann Distribution — dedicated speed-distribution analyser.
// Particles equilibrate at temperature T; the measured speed histogram is
// overlaid with the exact 2D MB curve and the three characteristic speeds
// (most-probable, mean, RMS) are marked and reported.
import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

const schema = [
  { key: 'N', label: 'Particles', min: 50, max: 300, step: 10, type: 'range' },
  { key: 'T', label: 'Temperature T', min: 0.2, max: 4, step: 0.05, type: 'range' },
  { key: 'bins', label: 'Histogram bins', min: 10, max: 40, step: 2, type: 'range' },
];

function gauss(rng, sigma) { let u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * sigma; }
function makeInitial(p) {
  const rng = (() => { let s = 2024; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
  const x = [], y = [], vx = [], vy = []; const sigma = Math.sqrt(p.T);
  for (let i = 0; i < p.N; i++) { x.push(0.05 + 0.9 * rng()); y.push(0.05 + 0.9 * rng()); vx.push(gauss(rng, sigma)); vy.push(gauss(rng, sigma)); }
  return { x, y, vx, vy };
}
function step(s, dt, p) {
  const W = 1, H = 1, r = 0.01;
  for (let i = 0; i < s.x.length; i++) { s.x[i] += s.vx[i] * dt; s.y[i] += s.vy[i] * dt; }
  for (let i = 0; i < s.x.length; i++) {
    if (s.x[i] < r) { s.x[i] = r; s.vx[i] = Math.abs(s.vx[i]); }
    if (s.x[i] > W - r) { s.x[i] = W - r; s.vx[i] = -Math.abs(s.vx[i]); }
    if (s.y[i] < r) { s.y[i] = r; s.vy[i] = Math.abs(s.vy[i]); }
    if (s.y[i] > H - r) { s.y[i] = H - r; s.vy[i] = -Math.abs(s.vy[i]); }
  }
  // pairwise elastic collisions to maintain equilibrium
  for (let i = 0; i < s.x.length; i++) {
    for (let j = i + 1; j < s.x.length; j++) {
      const dx = s.x[j] - s.x[i], dy = s.y[j] - s.y[i];
      const d2 = dx * dx + dy * dy; const rr = 2 * r;
      if (d2 < rr * rr && d2 > 1e-9) {
        const d = Math.sqrt(d2); const nx = dx / d, ny = dy / d;
        const dvx = s.vx[j] - s.vx[i], dvy = s.vy[j] - s.vy[i];
        const vn = dvx * nx + dvy * ny;
        if (vn < 0) { s.vx[i] += vn * nx; s.vy[i] += vn * ny; s.vx[j] -= vn * nx; s.vy[j] -= vn * ny; }
      }
    }
  }
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  for (let i = 0; i < s.x.length; i++) { const sp = Math.hypot(s.vx[i], s.vy[i]); ctx.fillStyle = `hsl(${200 - sp * 40} 90% 60%)`; ctx.beginPath(); ctx.arc(20 + s.x[i] * (h - 40), 20 + s.y[i] * (h - 40), 2.5, 0, Math.PI * 2); ctx.fill(); }
  // distribution plot
  const pX = 20, pY = h - 130, pW = w - 40, pH = 100;
  ctx.strokeStyle = 'hsl(var(--border))'; ctx.strokeRect(pX, pY, pW, pH);
  const speeds = []; for (let i = 0; i < s.x.length; i++) speeds.push(Math.hypot(s.vx[i], s.vy[i]));
  const vmax = Math.max(0.1, p.T * 4); const bins = p.bins; const hist = new Array(bins).fill(0);
  for (const sp of speeds) { const b = Math.min(bins - 1, Math.floor(sp / vmax * bins)); hist[b]++; }
  const maxC = Math.max(...hist, 1); const bw = pW / bins;
  ctx.fillStyle = '#22d3ee66';
  for (let i = 0; i < bins; i++) { const bh = (hist[i] / maxC) * pH; ctx.fillRect(pX + i * bw, pY + pH - bh, bw - 1, bh); }
  // MB theory 2D: f(v) = (m/kT) v exp(-m v^2 / 2kT), m=k=1
  const Tmeas = Math.max(0.01, speeds.reduce((a, v) => a + 0.5 * v * v, 0) / speeds.length);
  const fmax = (1 / Tmeas) * Math.exp(-0.5);
  ctx.strokeStyle = '#f97316'; ctx.lineWidth = 2; ctx.beginPath();
  for (let i = 0; i <= 100; i++) { const v = (i / 100) * vmax; const f = (v / Tmeas) * Math.exp(-v * v / (2 * Tmeas)); const y = pY + pH - (f / fmax) * pH * 0.95; if (i === 0) ctx.moveTo(pX + i * (pW / 100), y); else ctx.lineTo(pX + i * (pW / 100), y); } ctx.stroke();
  // characteristic speeds (2D): vp = sqrt(T), vmean = sqrt(pi T / 2), vrms = sqrt(2T)
  const vp = Math.sqrt(Tmeas), vmean = Math.sqrt(Math.PI * Tmeas / 2), vrms = Math.sqrt(2 * Tmeas);
  const markX = (v) => pX + (v / vmax) * pW;
  ctx.strokeStyle = '#84cc16'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(markX(vp), pY); ctx.lineTo(markX(vp), pY + pH); ctx.stroke();
  ctx.strokeStyle = '#a855f7'; ctx.beginPath(); ctx.moveTo(markX(vmean), pY); ctx.lineTo(markX(vmean), pY + pH); ctx.stroke();
  ctx.strokeStyle = '#f43f5e'; ctx.beginPath(); ctx.moveTo(markX(vrms), pY); ctx.lineTo(markX(vrms), pY + pH); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#84cc16'; ctx.font = '9px monospace'; ctx.fillText('vp', markX(vp) - 6, pY - 3);
  ctx.fillStyle = '#a855f7'; ctx.fillText('v_mean', markX(vmean) - 12, pY - 3);
  ctx.fillStyle = '#f43f5e'; ctx.fillText('vrms', markX(vrms) - 10, pY - 3);
  ctx.fillStyle = 'hsl(var(--muted-foreground))'; ctx.font = '10px monospace'; ctx.fillText('speed ->', pX + pW - 40, pY + pH + 12);
}
function computeStats(s, p) {
  let ke = 0; const speeds = []; for (let i = 0; i < s.x.length; i++) { const sp = Math.hypot(s.vx[i], s.vy[i]); speeds.push(sp); ke += 0.5 * sp * sp; }
  const Tm = ke / s.x.length; const vp = Math.sqrt(Tm); const vmean = speeds.reduce((a, v) => a + v, 0) / speeds.length; const vrms = Math.sqrt(speeds.reduce((a, v) => a + v * v, 0) / speeds.length);
  return { 'T (meas)': Tm.toFixed(3), 'v_p': vp.toFixed(3), 'v_mean': vmean.toFixed(3), 'v_rms': vrms.toFixed(3), 'vrms/vp': (vrms / vp).toFixed(3) };
}

export default function MaxwellBoltzmann() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ N: 150, T: 1, bins: 24 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats, resetKey: `${params.N}|${params.T}` });
  return (
    <SimLayout title="Maxwell-Boltzmann Distribution" configName="maxwell-boltzmann" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="maxwell-boltzmann" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">The 2D MB speed distribution f(v) = (v/T) exp(-v^2/2T). Dashed lines mark v_p (green), v_mean (purple), and v_rms (red). Raise T to see the curve flatten and shift right.</div>} />
  );
}