// Step Potential — a sudden potential step at x = c. Shows the wavefunction
// for E > V₀ (partial reflection, oscillation on both sides) and E < V₀
// (total reflection with evanescent decay into the step).
import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

const NX = 300;
const schema = [
  { key: 'V0', label: 'Step height V₀', min: 5, max: 100, step: 1, type: 'range' },
  { key: 'E', label: 'Particle energy E', min: 5, max: 150, step: 1, type: 'range' },
];

function makeInitial() { return {}; }
function step() {}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const padX = 40, padY = 24; const W = w - 2 * padX, H = h - 2 * padY; const baseY = padY + H;
  const cx = 0.5; const Vmax = Math.max(p.V0, p.E) * 1.2;
  const Y = (E) => baseY - (E / Vmax) * H * 0.5;
  // step
  ctx.strokeStyle = 'hsl(var(--muted-foreground))'; ctx.lineWidth = 2; ctx.beginPath();
  ctx.moveTo(padX, Y(0)); ctx.lineTo(padX + cx * W, Y(0)); ctx.lineTo(padX + cx * W, Y(p.V0)); ctx.lineTo(padX + W, Y(p.V0)); ctx.stroke();
  // energy line
  ctx.strokeStyle = '#f43f5e'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(padX, Y(p.E)); ctx.lineTo(padX + W, Y(p.E)); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = '#f43f5e'; ctx.font = '10px monospace'; ctx.fillText(`E=${p.E.toFixed(0)}`, padX + W - 40, Y(p.E) - 4);
  // wavefunction
  const k = Math.sqrt(2 * p.E); const above = p.E > p.V0;
  const q = above ? Math.sqrt(2 * (p.E - p.V0)) : Math.sqrt(2 * (p.V0 - p.E));
  const r = above ? (k - q) / (k + q) : 1; const t = above ? 2 * k / (k + q) : 2 * k / (k + q);
  ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2; ctx.beginPath();
  for (let i = 0; i <= NX; i++) {
    const x = i / NX; let rePart;
    if (x < cx) { rePart = Math.cos(k * x * 10) + (above ? r * Math.cos(-k * x * 10) : Math.cos(k * x * 10)); }
    else { if (above) rePart = t * Math.cos(q * (x - cx) * 10); else rePart = 2 * Math.exp(-q * (x - cx) * 5); }
    ctx.lineTo(padX + x * W, Y(p.E) - rePart * H * 0.08);
  } ctx.stroke();
  ctx.fillStyle = 'hsl(var(--muted-foreground))'; ctx.font = '10px monospace'; ctx.fillText('x →', padX + W - 20, baseY + 14);
}
function computeStats(s, p) { const k = Math.sqrt(2 * p.E); const above = p.E > p.V0; const q = above ? Math.sqrt(2 * (p.E - p.V0)) : Math.sqrt(2 * (p.V0 - p.E)); const R = above ? ((k - q) / (k + q)) ** 2 : 1; const T = above ? 1 - R : 0; return { 'E': p.E.toFixed(1), 'V₀': p.V0.toFixed(1), 'Regime': above ? 'E > V₀' : 'E < V₀', 'R': R.toFixed(4), 'T': T.toFixed(4) }; }

export default function StepPotential() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ V0: 30, E: 50 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats, resetKey: `${params.V0}|${params.E}` });
  return (
    <SimLayout title="Step Potential (Reflection & Transmission)" configName="step-potential" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="step-potential" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">A potential step at x=c. When E &gt; V₀, the wave partially reflects (R) and transmits (T). When E &lt; V₀, total reflection with evanescent decay into the step. Compare R and T for both regimes.</div>} />
  );
}