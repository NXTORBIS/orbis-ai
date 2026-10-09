// Quantum Superposition — two Gaussian wave packets colliding and interfering.
// Shows constructive/destructive interference fringes when they overlap, and
// the multi-state nature of quantum superposition.
import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';
import { fft } from '../lib/math.js';

const N = 256;
const schema = [
  { key: 'k1', label: 'Packet 1 momentum k₁', min: 5, max: 25, step: 0.5, type: 'range' },
  { key: 'k2', label: 'Packet 2 momentum k₂', min: -25, max: -5, step: 0.5, type: 'range' },
  { key: 'sigma', label: 'Packet width σ', min: 0.02, max: 0.1, step: 0.005, type: 'range' },
];

function makeInitial(p) {
  const L = 1, dx = L / N; const re = new Float64Array(N), im = new Float64Array(N);
  const x1 = 0.25, x2 = 0.75;
  for (let i = 0; i < N; i++) { const x = i * dx; const g1 = Math.exp(-((x - x1) ** 2) / (2 * p.sigma * p.sigma)); const g2 = Math.exp(-((x - x2) ** 2) / (2 * p.sigma * p.sigma)); re[i] = g1 * Math.cos(p.k1 * x) + g2 * Math.cos(p.k2 * x); im[i] = g1 * Math.sin(p.k1 * x) + g2 * Math.sin(p.k2 * x); }
  let norm = 0; for (let i = 0; i < N; i++) norm += re[i] * re[i] + im[i] * im[i]; norm = Math.sqrt(norm);
  for (let i = 0; i < N; i++) { re[i] /= norm; im[i] /= norm; }
  return { re, im, dx };
}
function step(s, dt) {
  fft(s.re, s.im);
  for (let i = 0; i < N; i++) { const k = (i <= N / 2 ? i : i - N) * 2 * Math.PI / (N * s.dx); const th = k * k * dt / 2; const c = Math.cos(th), si = Math.sin(th); const nr = s.re[i] * c + s.im[i] * si, ni = s.im[i] * c - s.re[i] * si; s.re[i] = nr; s.im[i] = ni; }
  fft(s.re, s.im, true);
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const padX = 30, padY = 24; const W = w - 2 * padX, H = h - 2 * padY; const baseY = padY + H;
  let maxP = 0; for (let i = 0; i < N; i++) maxP = Math.max(maxP, s.re[i] * s.re[i] + s.im[i] * s.im[i]); maxP = Math.max(maxP, 1e-9);
  ctx.fillStyle = '#22d3ee66'; ctx.beginPath(); ctx.moveTo(padX, baseY);
  for (let i = 0; i < N; i++) { const x = padX + (i / (N - 1)) * W; const y = baseY - (s.re[i] * s.re[i] + s.im[i] * s.im[i]) / maxP * H * 0.7; ctx.lineTo(x, y); }
  ctx.lineTo(padX + W, baseY); ctx.closePath(); ctx.fill();
  // interference fringes highlighted
  ctx.strokeStyle = '#f97316'; ctx.lineWidth = 1.5; ctx.beginPath();
  for (let i = 0; i < N; i++) { const x = padX + (i / (N - 1)) * W; const y = baseY - (s.re[i] * s.re[i] + s.im[i] * s.im[i]) / maxP * H * 0.7; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.stroke();
}
function computeStats(s, p) { let norm = 0, xexp = 0; for (let i = 0; i < N; i++) { const pr = s.re[i] * s.re[i] + s.im[i] * s.im[i]; norm += pr; xexp += (i / N) * pr; } return { '⟨x⟩': (xexp / norm).toFixed(3), 'k₁': p.k1.toFixed(1), 'k₂': p.k2.toFixed(1), 'Δk': (p.k1 - p.k2).toFixed(1), 'Fringe λ': (2 * Math.PI / Math.abs(p.k1 - p.k2)).toFixed(3) }; }

export default function QuantumSuperposition() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ k1: 15, k2: -15, sigma: 0.05 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats, resetKey: `${params.k1}|${params.k2}|${params.sigma}` });
  return (
    <SimLayout title="Quantum Superposition (Interference)" configName="quantum-superposition" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="quantum-superposition" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Two Gaussian wave packets travel toward each other and interfere. When they overlap, constructive/destructive fringes appear with wavelength λ = 2π/|Δk|. This is the essence of quantum superposition — states add as complex amplitudes.</div>} />
  );
}