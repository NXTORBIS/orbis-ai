// Schrödinger solver — split-step Fourier method
import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, LiveGraph, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';
import { fft, clamp } from '../lib/math.js';

const N = 256;
const schema = [
  { key: 'potential', label: 'Potential', type: 'select', options: [{ value: 'free', label: 'Free particle' }, { value: 'barrier', label: 'Potential barrier' }, { value: 'well', label: 'Finite well' }, { value: 'step', label: 'Step potential' }, { key: 'harmonic', value: 'harmonic', label: 'Harmonic oscillator' }, { value: 'double', label: 'Double well' }] },
  { key: 'V0', label: 'Potential height V₀', min: 0, max: 200, step: 1, type: 'range' },
  { key: 'width', label: 'Feature width', min: 0.05, max: 0.6, step: 0.01, type: 'range' },
  { key: 'k0', label: 'Wave-packet momentum k₀', min: -30, max: 30, step: 0.5, type: 'range' },
  { key: 'sigma', label: 'Packet width σ', min: 0.02, max: 0.3, step: 0.005, type: 'range' },
  { key: 'x0', label: 'Packet centre x₀', min: 0.1, max: 0.9, step: 0.01, type: 'range' },
];

function makeInitial(p) {
  const L = 1, dx = L / N;
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) { const x = i * dx; const g = Math.exp(-((x - p.x0) ** 2) / (2 * p.sigma * p.sigma)); re[i] = g * Math.cos(p.k0 * x); im[i] = g * Math.sin(p.k0 * x); }
  // normalise
  let norm = 0; for (let i = 0; i < N; i++) norm += re[i] * re[i] + im[i] * im[i]; norm = Math.sqrt(norm);
  for (let i = 0; i < N; i++) { re[i] /= norm; im[i] /= norm; }
  return { re, im, dx, k: new Float64Array(N) };
}
function buildV(p) {
  const V = new Float64Array(N); const L = 1, dx = L / N; const c = 0.5;
  for (let i = 0; i < N; i++) { const x = i * dx; if (p.potential === 'barrier') V[i] = Math.abs(x - c) < p.width / 2 ? p.V0 : 0;
    else if (p.potential === 'well') V[i] = Math.abs(x - c) < p.width / 2 ? 0 : p.V0;
    else if (p.potential === 'step') V[i] = x > c ? p.V0 : 0;
    else if (p.potential === 'harmonic') V[i] = p.V0 * ((x - c) * 6) ** 2;
    else if (p.potential === 'double') V[i] = p.V0 * ((x - c) ** 2 - p.width) ** 2 * 0.0001;
  }
  return V;
}
function step(s, dt, p) {
  const V = buildV(p); const N2 = N;
  // half potential step
  for (let i = 0; i < N2; i++) { const th = V[i] * dt / 2; const c = Math.cos(th), si = Math.sin(th); const nr = s.re[i] * c + s.im[i] * si, ni = s.im[i] * c - s.re[i] * si; s.re[i] = nr; s.im[i] = ni; }
  // kinetic in k-space
  fft(s.re, s.im);
  for (let i = 0; i < N2; i++) { const k = (i <= N2 / 2 ? i : i - N2) * 2 * Math.PI / (N2 * s.dx); const th = k * k * dt / 2; const c = Math.cos(th), si = Math.sin(th); const nr = s.re[i] * c + s.im[i] * si, ni = s.im[i] * c - s.re[i] * si; s.re[i] = nr; s.im[i] = ni; }
  fft(s.re, s.im, true);
  // half potential step
  for (let i = 0; i < N2; i++) { const th = V[i] * dt / 2; const c = Math.cos(th), si = Math.sin(th); const nr = s.re[i] * c + s.im[i] * si, ni = s.im[i] * c - s.re[i] * si; s.re[i] = nr; s.im[i] = ni; }
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const padX = 30, padY = 24; const W = w - 2 * padX, H = h - 2 * padY; const baseY = padY + H;
  const V = buildV(p); const Vmax = Math.max(...V, 1);
  // potential
  ctx.strokeStyle = 'hsl(var(--muted-foreground) / 0.6)'; ctx.lineWidth = 1.5; ctx.beginPath();
  for (let i = 0; i < N; i++) { const x = padX + (i / (N - 1)) * W; const y = baseY - (V[i] / Vmax) * H * 0.5; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.stroke();
  // |psi|^2
  let maxP = 0; for (let i = 0; i < N; i++) maxP = Math.max(maxP, s.re[i] ** 2 + s.im[i] ** 2); maxP = Math.max(maxP, 1e-9);
  ctx.fillStyle = '#22d3ee66'; ctx.beginPath(); ctx.moveTo(padX, baseY);
  for (let i = 0; i < N; i++) { const x = padX + (i / (N - 1)) * W; const y = baseY - (s.re[i] ** 2 + s.im[i] ** 2) / maxP * H * 0.8; ctx.lineTo(x, y); }
  ctx.lineTo(padX + W, baseY); ctx.closePath(); ctx.fill();
  // Re psi
  ctx.strokeStyle = '#f97316'; ctx.lineWidth = 1.5; ctx.beginPath();
  for (let i = 0; i < N; i++) { const x = padX + (i / (N - 1)) * W; const y = baseY - s.re[i] / Math.sqrt(maxP) * H * 0.4; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.stroke();
}
function sample(s) { let norm = 0, xexp = 0; for (let i = 0; i < N; i++) { const p = s.re[i] ** 2 + s.im[i] ** 2; norm += p; xexp += (i / N) * p; } return { norm: +norm.toFixed(3), x: +(xexp / norm).toFixed(3) }; }
function computeStats(s) { let norm = 0; for (let i = 0; i < N; i++) norm += s.re[i] ** 2 + s.im[i] ** 2; return { 'Norm²': norm.toFixed(3), '⟨x⟩': sample(s).x, 'Grid': N, 'Method': 'split-step FFT' }; }

export default function Schrodinger() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ potential: 'barrier', V0: 40, width: 0.15, k0: 15, sigma: 0.08, x0: 0.25 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, sample, computeStats, resetKey: `${params.potential}|${params.V0}|${params.width}|${params.k0}|${params.sigma}|${params.x0}` });
  return (
    <SimLayout title="Schrödinger Equation Solver (Split-Step Fourier)" configName="schrodinger" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      graph={<LiveGraph data={sim.graphData} xKey="t" series={[{ key: 'norm', color: '#22d3ee' }, { key: 'x', color: '#f97316' }]} />}
      exportBar={<ExportBar graphData={sim.graphData} config={params} canvasRef={canvasRef} name="schrodinger" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">iℏ∂ₜψ = Ĥψ solved by split-step Fourier: exp(−iVΔt/2) → FFT → exp(−ik²Δt/2m) → iFFT → exp(−iVΔt/2). Filled = |ψ|², orange = Re ψ, grey = V(x).</div>} />
  );
}