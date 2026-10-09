// Free Particle — Gaussian wave packet dispersion. A free particle (V=0)
// has no bound states; its wave packet spreads because different momentum
// components travel at different phase velocities. Shows ⟨x⟩, packet width
// σ(t), and the group velocity.
import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, LiveGraph, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';
import { fft } from '../lib/math.js';

const N = 256;
const schema = [
  { key: 'k0', label: 'Momentum k₀', min: -25, max: 25, step: 0.5, type: 'range' },
  { key: 'sigma', label: 'Initial width σ₀', min: 0.02, max: 0.15, step: 0.005, type: 'range' },
  { key: 'x0', label: 'Initial centre x₀', min: 0.1, max: 0.9, step: 0.02, type: 'range' },
];

function makeInitial(p) {
  const L = 1, dx = L / N; const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) { const x = i * dx; const g = Math.exp(-((x - p.x0) ** 2) / (2 * p.sigma * p.sigma)); re[i] = g * Math.cos(p.k0 * x); im[i] = g * Math.sin(p.k0 * x); }
  let norm = 0; for (let i = 0; i < N; i++) norm += re[i] * re[i] + im[i] * im[i]; norm = Math.sqrt(norm);
  for (let i = 0; i < N; i++) { re[i] /= norm; im[i] /= norm; }
  return { re, im, dx, sigma0: p.sigma };
}
function step(s, dt) {
  fft(s.re, s.im);
  for (let i = 0; i < N; i++) { const k = (i <= N / 2 ? i : i - N) * 2 * Math.PI / (N * s.dx); const th = k * k * dt / 2; const c = Math.cos(th), si = Math.sin(th); const nr = s.re[i] * c + s.im[i] * si, ni = s.im[i] * c - s.re[i] * si; s.re[i] = nr; s.im[i] = ni; }
  fft(s.re, s.im, true);
}
function measureWidth(s) {
  let norm = 0, xexp = 0, x2 = 0; for (let i = 0; i < N; i++) { const p = s.re[i] * s.re[i] + s.im[i] * s.im[i]; norm += p; xexp += (i / N) * p; x2 += (i / N) * (i / N) * p; }
  const xm = xexp / norm; const varX = x2 / norm - xm * xm; return { x: xm, sigma: Math.sqrt(Math.max(0, varX)) };
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const padX = 30, padY = 24; const W = w - 2 * padX, H = h - 2 * padY; const baseY = padY + H;
  let maxP = 0; for (let i = 0; i < N; i++) maxP = Math.max(maxP, s.re[i] * s.re[i] + s.im[i] * s.im[i]); maxP = Math.max(maxP, 1e-9);
  ctx.fillStyle = '#22d3ee66'; ctx.beginPath(); ctx.moveTo(padX, baseY);
  for (let i = 0; i < N; i++) { const x = padX + (i / (N - 1)) * W; const y = baseY - (s.re[i] * s.re[i] + s.im[i] * s.im[i]) / maxP * H * 0.7; ctx.lineTo(x, y); }
  ctx.lineTo(padX + W, baseY); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#f97316'; ctx.lineWidth = 1.5; ctx.beginPath();
  for (let i = 0; i < N; i++) { const x = padX + (i / (N - 1)) * W; const y = baseY - s.re[i] / Math.sqrt(maxP) * H * 0.3; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.stroke();
  // width indicator
  const m = measureWidth(s); ctx.strokeStyle = '#84cc16'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(padX + m.x * W, padY); ctx.lineTo(padX + m.x * W, baseY); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = '#84cc16'; ctx.font = '10px monospace'; ctx.fillText(`σ=${m.sigma.toFixed(3)}`, padX + m.x * W + 4, padY + 10);
}
function sample(s) { const m = measureWidth(s); return { x: +m.x.toFixed(3), sigma: +m.sigma.toFixed(4) }; }
function computeStats(s, p) { const m = measureWidth(s); const vg = p.k0; return { '⟨x⟩': m.x.toFixed(3), 'σ(t)': m.sigma.toFixed(4), 'σ₀': p.sigma.toFixed(3), 'v_g (k₀)': vg.toFixed(2), 'Spreading': m.sigma > p.sigma ? 'yes' : 'no' }; }

export default function FreeParticle() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ k0: 15, sigma: 0.05, x0: 0.3 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, sample, computeStats, resetKey: `${params.k0}|${params.sigma}|${params.x0}` });
  return (
    <SimLayout title="Free Particle (Wave-Packet Dispersion)" configName="free-particle" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      graph={<LiveGraph data={sim.graphData} xKey="t" series={[{ key: 'sigma', color: '#84cc16' }, { key: 'x', color: '#f97316' }]} />}
      exportBar={<ExportBar graphData={sim.graphData} config={params} canvasRef={canvasRef} name="free-particle" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">A free particle (V=0) has no bound states. The Gaussian packet travels at group velocity v_g = k₀ and spreads because different momentum components have different phase velocities. σ(t) grows as the packet delocalises.</div>} />
  );
}