// Random Walk — many 2D walkers taking independent random steps. Shows
// ⟨r²⟩ ∝ t (diffusion) and the Gaussian envelope emerging from central-limit
// behaviour. Mean displacement ⟨r⟩ ≈ 0, RMS displacement ∝ √t.
import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

const schema = [
  { key: 'N', label: 'Walkers', min: 50, max: 500, step: 50, type: 'range' },
  { key: 'stepSize', label: 'Step size', min: 0.005, max: 0.03, step: 0.001, type: 'range' },
  { key: 'showTrails', label: 'Show trails', type: 'toggle' },
];

function makeInitial(p) { const x = [], y = []; for (let i = 0; i < p.N; i++) { x.push(0); y.push(0); } return { x, y, t: 0, r2: 0, hist: [] }; }
function step(s, dt, p) {
  s.t += dt;
  const steps = Math.max(1, Math.round(dt * 60));
  for (let k = 0; k < steps; k++) for (let i = 0; i < s.x.length; i++) { const a = Math.random() * Math.PI * 2; s.x[i] += Math.cos(a) * p.stepSize; s.y[i] += Math.sin(a) * p.stepSize; }
  let r2 = 0; for (let i = 0; i < s.x.length; i++) r2 += s.x[i] * s.x[i] + s.y[i] * s.y[i];
  s.r2 = r2 / s.x.length;
  if (Math.floor(s.t * 10) % 2 === 0) { s.hist.push({ t: +s.t.toFixed(2), r2: +s.r2.toFixed(4), sqrt_t: +Math.sqrt(s.t).toFixed(3) }); if (s.hist.length > 200) s.hist.shift(); }
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const cx = w / 2, cy = h / 2, scale = Math.min(w, h) * 0.4;
  // RMS circle
  const rms = Math.sqrt(s.r2);
  ctx.strokeStyle = '#f97316'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.arc(cx, cy, rms * scale, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  // walkers
  ctx.fillStyle = '#22d3ee';
  for (let i = 0; i < s.x.length; i++) { ctx.beginPath(); ctx.arc(cx + s.x[i] * scale, cy + s.y[i] * scale, 1.5, 0, Math.PI * 2); ctx.fill(); }
  // origin
  ctx.fillStyle = '#f43f5e'; ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();
  // ⟨r²⟩ vs t plot
  const pX = 16, pY = h - 80, pW = w - 32, pH = 60;
  ctx.strokeStyle = 'hsl(var(--border))'; ctx.strokeRect(pX, pY, pW, pH);
  const r2max = Math.max(0.01, s.hist.length ? s.hist[s.hist.length - 1].r2 * 1.1 : 0.1);
  const X = (i) => pX + (i / Math.max(1, s.hist.length - 1)) * pW;
  const Y = (r) => pY + pH - (r / r2max) * pH;
  ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 1.5; ctx.beginPath();
  for (let i = 0; i < s.hist.length; i++) { if (i === 0) ctx.moveTo(X(i), Y(s.hist[i].r2)); else ctx.lineTo(X(i), Y(s.hist[i].r2)); } ctx.stroke();
  ctx.fillStyle = 'hsl(var(--muted-foreground))'; ctx.font = '10px monospace'; ctx.fillText('⟨r²⟩ ∝ t', pX, pY - 3); ctx.fillText('t →', pX + pW - 20, pY + pH + 12);
}
function computeStats(s, p) { let r1 = 0; for (let i = 0; i < s.x.length; i++) r1 += Math.hypot(s.x[i], s.y[i]); return { '⟨r⟩': (r1 / s.x.length).toFixed(4), '⟨r²⟩': s.r2.toFixed(4), '√⟨r²⟩': Math.sqrt(s.r2).toFixed(4), 't': s.t.toFixed(2), '√t': Math.sqrt(s.t).toFixed(3) }; }

export default function RandomWalk() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ N: 200, stepSize: 0.015, showTrails: false });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats, resetKey: `${params.N}|${params.stepSize}` });
  return (
    <SimLayout title="Random Walk (Diffusion)" configName="random-walk" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      exportBar={<ExportBar graphData={sim.stateRef.current?.hist || []} config={params} canvasRef={canvasRef} name="random-walk" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Each walker takes random 2D steps. The cloud spreads as √t (dashed circle = RMS radius). ⟨r⟩ ≈ 0 but ⟨r²⟩ grows linearly — the signature of diffusion.</div>} />
  );
}