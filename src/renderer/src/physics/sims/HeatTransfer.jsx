// Heat Transfer — conduction between two bodies coupled by a thermal link,
// with optional radiative loss. Shows T(t) convergence to equilibrium and the
// heat flux Q̇ through the link. Newton's law of cooling + Fourier conduction.
import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

const schema = [
  { key: 'Thot', label: 'Hot body T₁', min: 100, max: 800, step: 10, type: 'range' },
  { key: 'Tcold', label: 'Cold body T₂', min: 50, max: 500, step: 10, type: 'range' },
  { key: 'k', label: 'Conductivity k', min: 0.01, max: 1, step: 0.01, type: 'range' },
  { key: 'rad', label: 'Radiative loss ε', min: 0, max: 0.3, step: 0.01, type: 'range' },
];

function makeInitial(p) { return { T1: p.Thot, T2: p.Tcold, Qflow: 0, t: 0, hist: [] }; }
function step(s, dt, p) {
  // conduction: dQ/dt = k (T1 - T2); capacities C1 = C2 = 1
  const dT = p.k * (s.T1 - s.T2);
  s.T1 -= dT * dt; s.T2 += dT * dt;
  // radiative loss to ambient (T_env = 0): ε (T^4 - Tenv^4) ≈ ε T^4 (Stefan-Boltzmann, normalised)
  s.T1 -= p.rad * Math.pow(s.T1 / 100, 4) * dt * 1e-6;
  s.T2 -= p.rad * Math.pow(s.T2 / 100, 4) * dt * 1e-6;
  s.Qflow = dT; s.t += dt;
  if (Math.floor(s.t * 10) % 2 === 0) { s.hist.push({ t: +s.t.toFixed(2), T1: +s.T1.toFixed(1), T2: +s.T2.toFixed(1) }); if (s.hist.length > 200) s.hist.shift(); }
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.28;
  // hot body
  const tCol = (T) => `hsl(${Math.max(0, 240 - T * 0.4)}, 90%, ${Math.min(60, 30 + T * 0.04)}%)`;
  ctx.fillStyle = tCol(s.T1); ctx.beginPath(); ctx.arc(cx - r * 0.9, cy, r * 0.55, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = tCol(s.T2); ctx.beginPath(); ctx.arc(cx + r * 0.9, cy, r * 0.55, 0, Math.PI * 2); ctx.fill();
  // conducting link
  ctx.strokeStyle = `hsl(${30 + p.k * 100} 90% 60%)`; ctx.lineWidth = 2 + p.k * 12; ctx.beginPath(); ctx.moveTo(cx - r * 0.9 + r * 0.55, cy); ctx.lineTo(cx + r * 0.9 - r * 0.55, cy); ctx.stroke();
  // heat-flow arrows
  const dir = s.T1 > s.T2 ? 1 : -1; const nArrows = 5;
  ctx.fillStyle = '#f97316';
  for (let i = 0; i < nArrows; i++) { const ax = cx - r * 0.3 + (i / nArrows) * r * 0.6; const off = Math.sin(s.t * 4 + i) * 4; ctx.beginPath(); ctx.moveTo(ax + dir * 6, cy + off); ctx.lineTo(ax - dir * 6, cy + off - 4); ctx.lineTo(ax - dir * 6, cy + off + 4); ctx.closePath(); ctx.fill(); }
  // labels
  ctx.fillStyle = 'white'; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center';
  ctx.fillText(`T₁=${s.T1.toFixed(0)}K`, cx - r * 0.9, cy + 4); ctx.fillText(`T₂=${s.T2.toFixed(0)}K`, cx + r * 0.9, cy + 4);
  ctx.textAlign = 'left';
  // T(t) plot
  const pX = 16, pY = h - 90, pW = w - 32, pH = 70;
  ctx.strokeStyle = 'hsl(var(--border))'; ctx.strokeRect(pX, pY, pW, pH);
  const Tmax = Math.max(p.Thot, p.Tcold) * 1.1;
  const X = (i) => pX + (i / Math.max(1, s.hist.length - 1)) * pW;
  const Y = (T) => pY + pH - (T / Tmax) * pH;
  ctx.strokeStyle = '#f97316'; ctx.lineWidth = 1.5; ctx.beginPath();
  for (let i = 0; i < s.hist.length; i++) { if (i === 0) ctx.moveTo(X(i), Y(s.hist[i].T1)); else ctx.lineTo(X(i), Y(s.hist[i].T1)); } ctx.stroke();
  ctx.strokeStyle = '#22d3ee'; ctx.beginPath();
  for (let i = 0; i < s.hist.length; i++) { if (i === 0) ctx.moveTo(X(i), Y(s.hist[i].T2)); else ctx.lineTo(X(i), Y(s.hist[i].T2)); } ctx.stroke();
}
function computeStats(s, p) { const Teq = (p.Thot + p.Tcold) / 2; return { 'T₁': s.T1.toFixed(1), 'T₂': s.T2.toFixed(1), 'T_eq': Teq.toFixed(1), 'Q̇': s.Qflow.toFixed(3), 'ΔT': (s.T1 - s.T2).toFixed(1) }; }

export default function HeatTransfer() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ Thot: 600, Tcold: 200, k: 0.2, rad: 0.05 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats, resetKey: `${params.Thot}|${params.Tcold}|${params.k}|${params.rad}` });
  return (
    <SimLayout title="Heat Transfer (Conduction + Radiation)" configName="heat-transfer" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      exportBar={<ExportBar graphData={sim.stateRef.current?.hist || []} config={params} canvasRef={canvasRef} name="heat-transfer" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Fourier conduction: Q̇ = kΔT. Two bodies exchange heat through a conducting link (thickness ∝ k) and radiate to ambient. They converge to thermal equilibrium.</div>} />
  );
}