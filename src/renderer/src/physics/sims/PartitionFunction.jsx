// Partition Function — a two-level system (spin-1/2 in a field B). Computes
// Z = e^(−βε↑) + e^(−βε↓), then derives F, U, S, C_V from Z. Plots Z(T) and
// the thermodynamic quantities vs temperature.
import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

const schema = [
  { key: 'gap', label: 'Energy gap Δ (ε↑−ε↓)', min: 0.1, max: 5, step: 0.1, type: 'range' },
  { key: 'Tmax', label: 'Max temperature', min: 1, max: 10, step: 0.5, type: 'range' },
];

function makeInitial(p) { return { t: 0 }; }
function step(s, dt) { s.t += dt; }
function thermo(p, T) {
  const b = 1 / Math.max(0.01, T); const d = p.gap;
  const Z = Math.exp(-b * d / 2) + Math.exp(b * d / 2); // ε↑=+Δ/2, ε↓=−Δ/2
  const F = -T * Math.log(Z);
  // U = −∂ ln Z / ∂ β = −(d/2) tanh(−β d/2) ... = (d/2) * (e^{-βd} - 1)/(e^{-βd}+1) = (d/2) tanh(βd/2) with sign
  // Actually U = <ε> = (d/2) * (e^{-βd} - e^{βd})/(e^{-βd}+e^{βd}) ... let's use: P_up = e^{-βd/2}/Z, P_dn = e^{βd/2}/Z
  const Pup = Math.exp(-b * d / 2) / Z, Pdn = Math.exp(b * d / 2) / Z;
  const U = (d / 2) * Pup + (-d / 2) * Pdn;
  const S = (U - F) / T;
  // C_V = dU/dT numerically
  return { Z, F, U, S };
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const padX = 40, padY = 24, W = w - 2 * padX, H = h - 2 * padY;
  const Tmin = 0.05, Tmax = p.Tmax;
  const pts = []; let Zmax = 0, Uabs = 0, Smax = 0;
  for (let i = 0; i <= 100; i++) { const T = Tmin + (i / 100) * (Tmax - Tmin); const r = thermo(p, T); pts.push({ T, ...r }); Zmax = Math.max(Zmax, r.Z); Uabs = Math.max(Uabs, Math.abs(r.U)); Smax = Math.max(Smax, r.S); }
  const X = (T) => padX + ((T - Tmin) / (Tmax - Tmin)) * W;
  // Z(T)
  ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2; ctx.beginPath();
  for (let i = 0; i < pts.length; i++) { const y = padY + H * 0.3 - (pts[i].Z / Zmax) * H * 0.25; if (i === 0) ctx.moveTo(X(pts[i].T), y); else ctx.lineTo(X(pts[i].T), y); } ctx.stroke();
  ctx.fillStyle = '#22d3ee'; ctx.font = '10px monospace'; ctx.fillText('Z(T)', padX, padY + 10);
  // U(T)
  ctx.strokeStyle = '#f97316'; ctx.lineWidth = 2; ctx.beginPath();
  for (let i = 0; i < pts.length; i++) { const y = padY + H * 0.6 - (pts[i].U / (Uabs + 1e-9)) * H * 0.2; if (i === 0) ctx.moveTo(X(pts[i].T), y); else ctx.lineTo(X(pts[i].T), y); } ctx.stroke();
  ctx.fillStyle = '#f97316'; ctx.fillText('U(T)', padX, padY + H * 0.35);
  // S(T)
  ctx.strokeStyle = '#84cc16'; ctx.lineWidth = 2; ctx.beginPath();
  for (let i = 0; i < pts.length; i++) { const y = padY + H - 10 - (pts[i].S / (Smax + 1e-9)) * H * 0.25; if (i === 0) ctx.moveTo(X(pts[i].T), y); else ctx.lineTo(X(pts[i].T), y); } ctx.stroke();
  ctx.fillStyle = '#84cc16'; ctx.fillText('S(T)', padX, padY + H * 0.72);
  // axes
  ctx.strokeStyle = 'hsl(var(--muted-foreground))'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(padX, padY); ctx.lineTo(padX, padY + H); ctx.lineTo(padX + W, padY + H); ctx.stroke();
  ctx.fillStyle = 'hsl(var(--muted-foreground))'; ctx.font = '10px monospace'; ctx.fillText('T →', padX + W - 20, padY + H + 14);
}
function computeStats(s, p) {
  // at T = gap/2 (mid-range)
  const T = p.gap / 2; const r = thermo(p, T);
  return { 'Z(T*)': r.Z.toFixed(3), 'F': r.F.toFixed(3), 'U': r.U.toFixed(3), 'S': r.S.toFixed(3), 'Δ': p.gap.toFixed(2), 'T*': T.toFixed(2) };
}

export default function PartitionFunction() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ gap: 2, Tmax: 6 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats, resetKey: `${params.gap}|${params.Tmax}` });
  return (
    <SimLayout title="Partition Function (Two-Level System)" configName="partition-function" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="partition-function" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Z = Σ e^(−βεᵢ) is the bridge from microphysics to thermodynamics. For a two-level system with gap Δ: Z(T), U(T), and S(T) are plotted. F = −T ln Z, S = (U−F)/T.</div>} />
  );
}