// Charles's Law — isobaric V–T relationship. At constant P, V ∝ T.
// A piston under fixed external pressure heats up; the gas expands and V(T)
// is plotted against temperature, extrapolating to V=0 at T=0 (absolute zero).
import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

const schema = [
  { key: 'N', label: 'Particles', min: 20, max: 120, step: 5, type: 'range' },
  { key: 'Pext', label: 'External pressure', min: 0.5, max: 5, step: 0.1, type: 'range' },
  { key: 'T', label: 'Temperature', min: 0.1, max: 4, step: 0.05, type: 'range' },
];

function gauss(rng, sigma) { let u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * sigma; }
function makeInitial(p) {
  const rng = (() => { let s = 4242; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
  const V0 = p.N * p.T / (p.Pext * 20); const W = Math.min(0.95, Math.max(0.15, V0));
  const x = [], y = [], vx = [], vy = []; const sigma = Math.sqrt(p.T);
  for (let i = 0; i < p.N; i++) { x.push((0.05 + 0.9 * rng()) * W); y.push(0.05 + 0.9 * rng()); vx.push(gauss(rng, sigma)); vy.push(gauss(rng, sigma)); }
  return { x, y, vx, vy, wallAcc: 0, wallTime: 0, pressure: 0, boxW: W, samples: [] };
}
function step(s, dt, p) {
  // rescale velocities to target temperature
  let ke = 0; for (let i = 0; i < s.x.length; i++) ke += 0.5 * (s.vx[i] * s.vx[i] + s.vy[i] * s.vy[i]);
  const Tcur = ke / s.x.length; if (Tcur > 0) { const scale = Math.sqrt(p.T / Tcur); for (let i = 0; i < s.x.length; i++) { s.vx[i] *= scale; s.vy[i] *= scale; } }
  // equilibrium box width from V = NkT/P
  const Veq = p.N * p.T / (p.Pext * 20); const Weq = Math.min(0.95, Math.max(0.15, Veq));
  s.boxW += (Weq - s.boxW) * 0.05;
  const W = s.boxW, H = 1, r = 0.012;
  for (let i = 0; i < s.x.length; i++) { s.x[i] += s.vx[i] * dt; s.y[i] += s.vy[i] * dt; }
  for (let i = 0; i < s.x.length; i++) {
    if (s.x[i] < r) { s.x[i] = r; s.wallAcc += 2 * Math.abs(s.vx[i]); s.vx[i] = Math.abs(s.vx[i]); }
    if (s.x[i] > W - r) { s.x[i] = W - r; s.wallAcc += 2 * Math.abs(s.vx[i]); s.vx[i] = -Math.abs(s.vx[i]); }
    if (s.y[i] < r) { s.y[i] = r; s.wallAcc += 2 * Math.abs(s.vy[i]); s.vy[i] = Math.abs(s.vy[i]); }
    if (s.y[i] > H - r) { s.y[i] = H - r; s.wallAcc += 2 * Math.abs(s.vy[i]); s.vy[i] = -Math.abs(s.vy[i]); }
  }
  s.wallTime += dt;
  if (s.wallTime > 0.2) { const perim = 2 * (W + H); s.pressure = s.wallAcc / (perim * s.wallTime); s.wallAcc = 0; s.wallTime = 0; s.samples.push({ T: p.T, V: s.boxW }); if (s.samples.length > 100) s.samples.shift(); }
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const boxX = 20, boxY = 20, boxH = h - 40, boxWpx = boxH * s.boxW;
  ctx.strokeStyle = 'hsl(var(--muted-foreground))'; ctx.lineWidth = 2; ctx.strokeRect(boxX, boxY, boxWpx, boxH);
  ctx.fillStyle = '#84cc16'; ctx.fillRect(boxX + boxWpx, boxY, 6, boxH); // piston
  // pressure arrows
  ctx.strokeStyle = '#f97316'; ctx.lineWidth = 1.5;
  for (let j = 0; j < 5; j++) { const yy = boxY + (j + 0.5) * boxH / 5; ctx.beginPath(); ctx.moveTo(boxX + boxWpx + 20, yy); ctx.lineTo(boxX + boxWpx + 8, yy); ctx.stroke(); }
  const sx = boxWpx / s.boxW, sy = boxH / 1;
  for (let i = 0; i < s.x.length; i++) { ctx.fillStyle = `hsl(${200 - p.T * 30} 90% 60%)`; ctx.beginPath(); ctx.arc(boxX + s.x[i] * sx, boxY + s.y[i] * sy, 3, 0, Math.PI * 2); ctx.fill(); }
  // V-T plot
  const vtX = boxX + boxH + 30, vtW = w - vtX - 16, vtH = boxH;
  ctx.strokeStyle = 'hsl(var(--border))'; ctx.strokeRect(vtX, boxY, vtW, vtH);
  const Tmax = 4, Vmax = 0.95;
  const X = (T) => vtX + (T / Tmax) * vtW, Y = (V) => boxY + vtH - (V / Vmax) * vtH;
  ctx.strokeStyle = '#f97316'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(Tmax), Y(p.N * Tmax / (p.Pext * 20))); ctx.stroke();
  ctx.fillStyle = '#22d3ee'; for (const sm of s.samples) { ctx.beginPath(); ctx.arc(X(sm.T), Y(sm.V), 3, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = 'hsl(var(--muted-foreground))'; ctx.font = '10px monospace'; ctx.fillText('T →', vtX + vtW - 24, boxY + vtH + 14); ctx.fillText('V ↑', vtX - 14, boxY + 10);
}
function computeStats(s, p) { const Vth = p.N * p.T / (p.Pext * 20); return { 'T': p.T.toFixed(2), 'P (ext)': p.Pext.toFixed(2), 'V (meas)': s.boxW.toFixed(3), 'V (theory)': Vth.toFixed(3), 'V/T': (s.boxW / Math.max(0.01, p.T)).toFixed(3) }; }

export default function CharlesLaw() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ N: 50, Pext: 1.5, T: 1 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats, resetKey: `${params.N}|${params.Pext}` });
  return (
    <SimLayout title="Charles's Law (Isobaric V–T)" configName="charles-law" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      exportBar={<ExportBar graphData={sim.stateRef.current?.samples || []} config={params} canvasRef={canvasRef} name="charles-law" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">At constant pressure, V ∝ T. Heat the gas — the piston rises and measured V (cyan) follows the theoretical line (orange), extrapolating to absolute zero.</div>} />
  );
}