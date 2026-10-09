// Potential Barrier — transmission coefficient T(E) vs particle energy E
// for a rectangular barrier. Shows the classical cutoff at E=V₀, the
// exponential tunneling regime below V₀, and the resonant oscillations above.
import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

const schema = [
  { key: 'V0', label: 'Barrier height V₀', min: 10, max: 150, step: 5, type: 'range' },
  { key: 'width', label: 'Barrier width a', min: 0.05, max: 0.4, step: 0.01, type: 'range' },
];

function makeInitial() { return {}; }
function step() {}
function TofE(E, V0, a) {
  if (E < 1e-6) return 0;
  if (E < V0) { const k = Math.sqrt(2 * E); const kappa = Math.sqrt(2 * (V0 - E)); const denom = (V0 * V0) * Math.sinh(kappa * a) ** 2 / (4 * E * (V0 - E)); return 1 / (1 + denom); }
  if (E === V0) return 1 / (1 + 2 * V0 * a * a); // limit
  const k = Math.sqrt(2 * E); const q = Math.sqrt(2 * (E - V0)); const denom = (V0 * V0) * Math.sin(q * a) ** 2 / (4 * E * (E - V0)); return 1 / (1 + denom);
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const padX = 40, padY = 24; const W = w - 2 * padX, H = h - 2 * padY; const baseY = padY + H;
  const Emax = p.V0 * 2.5;
  const X = (E) => padX + (E / Emax) * W; const Y = (T) => baseY - T * H * 0.85;
  // axes
  ctx.strokeStyle = 'hsl(var(--muted-foreground))'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(padX, padY); ctx.lineTo(padX, baseY); ctx.lineTo(padX + W, baseY); ctx.stroke();
  // V0 line
  ctx.strokeStyle = '#f43f5e'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(X(p.V0), padY); ctx.lineTo(X(p.V0), baseY); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = '#f43f5e'; ctx.font = '10px monospace'; ctx.fillText('V₀', X(p.V0) - 8, padY - 4);
  // T(E) curve
  ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2; ctx.beginPath();
  for (let i = 0; i <= 200; i++) { const E = (i / 200) * Emax; const T = TofE(E, p.V0, p.width); if (i === 0) ctx.moveTo(X(E), Y(T)); else ctx.lineTo(X(E), Y(T)); } ctx.stroke();
  // classical line
  ctx.strokeStyle = 'hsl(var(--muted-foreground) / 0.4)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(p.V0), Y(0)); ctx.lineTo(X(p.V0), Y(1)); ctx.lineTo(X(Emax), Y(1)); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = 'hsl(var(--muted-foreground))'; ctx.font = '10px monospace'; ctx.fillText('E →', padX + W - 20, baseY + 14); ctx.fillText('T →', padX - 16, padY + 4);
}
function computeStats(s, p) { const E = p.V0 * 0.5; const Tbelow = TofE(E, p.V0, p.width); const Eabove = p.V0 * 1.5; const Tabove = TofE(Eabove, p.V0, p.width); return { 'V₀': p.V0.toFixed(1), 'a': p.width.toFixed(2), 'T(E=V₀/2)': Tbelow.toExponential(3), 'T(E=3V₀/2)': Tabove.toFixed(4), 'Classical': '0 below V₀' }; }

export default function PotentialBarrier() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ V0: 50, width: 0.15 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats, resetKey: `${params.V0}|${params.width}` });
  return (
    <SimLayout title="Potential Barrier (T vs E)" configName="potential-barrier" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="potential-barrier" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Transmission T(E) through a rectangular barrier. Below V₀ (dashed red), T decays exponentially — quantum tunneling. Above V₀, T oscillates with resonances (unlike the classical step). Dashed grey = classical prediction.</div>} />
  );
}