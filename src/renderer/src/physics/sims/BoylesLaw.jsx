// Boyle's Law — isothermal PV relationship. At constant T, P ∝ 1/V.
// Live particle gas where the user compresses the piston at fixed temperature;
// measured P is plotted against V alongside the theoretical P = NkT/V curve.
import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

const schema = [
  { key: 'N', label: 'Particles', min: 20, max: 150, step: 5, type: 'range' },
  { key: 'T', label: 'Temperature (fixed)', min: 0.2, max: 4, step: 0.1, type: 'range' },
  { key: 'boxW', label: 'Piston position V', min: 0.25, max: 0.95, step: 0.01, type: 'range' },
];

function gauss(rng, sigma) { let u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * sigma; }
function makeInitial(p) {
  const rng = (() => { let s = 777; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
  const x = [], y = [], vx = [], vy = []; const sigma = Math.sqrt(p.T);
  for (let i = 0; i < p.N; i++) { x.push((0.05 + 0.9 * rng()) * p.boxW); y.push(0.05 + 0.9 * rng()); vx.push(gauss(rng, sigma)); vy.push(gauss(rng, sigma)); }
  return { x, y, vx, vy, wallAcc: 0, wallTime: 0, pressure: 0, samples: [] };
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
  if (s.wallTime > 0.15) { const perim = 2 * (W + H); s.pressure = s.wallAcc / (perim * s.wallTime); s.wallAcc = 0; s.wallTime = 0; s.samples.push({ V: W, P: s.pressure }); if (s.samples.length > 120) s.samples.shift(); }
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const boxX = 20, boxY = 20, boxH = h - 40, boxWpx = boxH * p.boxW;
  ctx.strokeStyle = 'hsl(var(--muted-foreground))'; ctx.lineWidth = 2; ctx.strokeRect(boxX, boxY, boxWpx, boxH);
  // piston
  ctx.fillStyle = '#84cc16'; ctx.fillRect(boxX + boxWpx, boxY, 6, boxH);
  const sx = boxWpx / p.boxW, sy = boxH / 1;
  for (let i = 0; i < s.x.length; i++) { ctx.fillStyle = '#22d3ee'; ctx.beginPath(); ctx.arc(boxX + s.x[i] * sx, boxY + s.y[i] * sy, 3, 0, Math.PI * 2); ctx.fill(); }
  // P-V plot
  const pvX = boxX + boxH + 30, pvW = w - pvX - 16, pvH = boxH;
  ctx.strokeStyle = 'hsl(var(--border))'; ctx.strokeRect(pvX, boxY, pvW, pvH);
  const Vmax = 1, Pmax = p.N * p.T * 0.5;
  const X = (V) => pvX + (V / Vmax) * pvW, Y = (P) => boxY + pvH - Math.min(P / Pmax, 1) * pvH;
  // theory P = NkT/V
  ctx.strokeStyle = '#f97316'; ctx.lineWidth = 2; ctx.beginPath();
  for (let i = 0; i <= 80; i++) { const V = 0.1 + (i / 80) * 0.85; const Pth = p.N * p.T / (V * 20); if (i === 0) ctx.moveTo(X(V), Y(Pth)); else ctx.lineTo(X(V), Y(Pth)); } ctx.stroke();
  // measured samples
  ctx.fillStyle = '#22d3ee'; for (const sm of s.samples) { ctx.beginPath(); ctx.arc(X(sm.V), Y(sm.P), 3, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = 'hsl(var(--muted-foreground))'; ctx.font = '10px monospace'; ctx.fillText('V →', pvX + pvW - 24, boxY + pvH + 14); ctx.fillText('P ↑', pvX - 14, boxY + 10);
}
function computeStats(s, p) { const Pth = p.N * p.T / (p.boxW * 20); return { 'V': p.boxW.toFixed(2), 'T (fixed)': p.T.toFixed(2), 'P (meas)': s.pressure.toFixed(4), 'P (theory)': Pth.toFixed(4), 'PV': (s.pressure * p.boxW).toFixed(3) }; }

export default function BoylesLaw() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ N: 60, T: 1, boxW: 0.7 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats, resetKey: `${params.N}|${params.T}` });
  return (
    <SimLayout title="Boyle's Law (Isothermal P–V)" configName="boyles-law" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      exportBar={<ExportBar graphData={sim.stateRef.current?.samples || []} config={params} canvasRef={canvasRef} name="boyles-law" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">At constant temperature, P·V = const. Move the piston (green bar) — measured pressure (cyan dots) tracks the theoretical P = NkT/V curve (orange).</div>} />
  );
}