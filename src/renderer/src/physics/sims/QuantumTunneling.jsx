// Quantum Tunneling — a Gaussian wave packet encounters a rectangular barrier.
// Uses split-step FFT propagation. Shows the packet splitting into reflected
// and transmitted parts, and reports the transmission probability T(E).
import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, LiveGraph, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';
import { fft } from '../lib/math.js';

const N = 256;
const schema = [
  { key: 'V0', label: 'Barrier height V₀', min: 5, max: 100, step: 1, type: 'range' },
  { key: 'width', label: 'Barrier width', min: 0.03, max: 0.25, step: 0.01, type: 'range' },
  { key: 'k0', label: 'Packet momentum k₀', min: 5, max: 25, step: 0.5, type: 'range' },
  { key: 'sigma', label: 'Packet width σ', min: 0.02, max: 0.12, step: 0.005, type: 'range' },
];

function makeInitial(p) {
  const L = 1, dx = L / N; const re = new Float64Array(N), im = new Float64Array(N);
  const x0 = 0.2;
  for (let i = 0; i < N; i++) { const x = i * dx; const g = Math.exp(-((x - x0) ** 2) / (2 * p.sigma * p.sigma)); re[i] = g * Math.cos(p.k0 * x); im[i] = g * Math.sin(p.k0 * x); }
  let norm = 0; for (let i = 0; i < N; i++) norm += re[i] * re[i] + im[i] * im[i]; norm = Math.sqrt(norm);
  for (let i = 0; i < N; i++) { re[i] /= norm; im[i] /= norm; }
  return { re, im, dx, Tleft: 1, Tright: 0 };
}
function buildV(p) { const V = new Float64Array(N); const dx = 1 / N; const c = 0.5; for (let i = 0; i < N; i++) { const x = i * dx; V[i] = Math.abs(x - c) < p.width / 2 ? p.V0 : 0; } return V; }
function step(s, dt, p) {
  const V = buildV(p);
  for (let i = 0; i < N; i++) { const th = V[i] * dt / 2; const c = Math.cos(th), si = Math.sin(th); const nr = s.re[i] * c + s.im[i] * si, ni = s.im[i] * c - s.re[i] * si; s.re[i] = nr; s.im[i] = ni; }
  fft(s.re, s.im);
  for (let i = 0; i < N; i++) { const k = (i <= N / 2 ? i : i - N) * 2 * Math.PI / (N * s.dx); const th = k * k * dt / 2; const c = Math.cos(th), si = Math.sin(th); const nr = s.re[i] * c + s.im[i] * si, ni = s.im[i] * c - s.re[i] * si; s.re[i] = nr; s.im[i] = ni; }
  fft(s.re, s.im, true);
  for (let i = 0; i < N; i++) { const th = V[i] * dt / 2; const c = Math.cos(th), si = Math.sin(th); const nr = s.re[i] * c + s.im[i] * si, ni = s.im[i] * c - s.re[i] * si; s.re[i] = nr; s.im[i] = ni; }
  // measure T, R
  let Tl = 0, Tr = 0; for (let i = 0; i < N; i++) { const pr = s.re[i] * s.re[i] + s.im[i] * s.im[i]; if (i / N < 0.5) Tl += pr; else Tr += pr; } s.Tleft = Tl; s.Tright = Tr;
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const padX = 30, padY = 24; const W = w - 2 * padX, H = h - 2 * padY; const baseY = padY + H;
  const V = buildV(p); const Vmax = Math.max(p.V0, 1);
  ctx.strokeStyle = 'hsl(var(--muted-foreground) / 0.6)'; ctx.lineWidth = 1.5; ctx.beginPath();
  for (let i = 0; i < N; i++) { const x = padX + (i / (N - 1)) * W; const y = baseY - (V[i] / Vmax) * H * 0.4; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.stroke();
  let maxP = 0; for (let i = 0; i < N; i++) maxP = Math.max(maxP, s.re[i] * s.re[i] + s.im[i] * s.im[i]); maxP = Math.max(maxP, 1e-9);
  ctx.fillStyle = '#22d3ee66'; ctx.beginPath(); ctx.moveTo(padX, baseY);
  for (let i = 0; i < N; i++) { const x = padX + (i / (N - 1)) * W; const y = baseY - (s.re[i] * s.re[i] + s.im[i] * s.im[i]) / maxP * H * 0.7; ctx.lineTo(x, y); }
  ctx.lineTo(padX + W, baseY); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#f97316'; ctx.lineWidth = 1.5; ctx.beginPath();
  for (let i = 0; i < N; i++) { const x = padX + (i / (N - 1)) * W; const y = baseY - s.re[i] / Math.sqrt(maxP) * H * 0.35; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.stroke();
}
function sample(s) { return { T: +s.Tright.toFixed(4), R: +s.Tleft.toFixed(4) }; }
function computeStats(s, p) { const E = p.k0 * p.k0 / 2; const Tanal = E > p.V0 ? 1 / (1 + p.V0 * p.V0 * Math.sin(Math.sqrt(2 * (E - p.V0)) * p.width) ** 2 / (4 * E * (E - p.V0))) : 4 * E * (p.V0 - E) / (4 * E * (p.V0 - E) + p.V0 * p.V0 * Math.sinh(Math.sqrt(2 * (p.V0 - E)) * p.width) ** 2); return { 'E = k₀²/2': E.toFixed(2), 'V₀': p.V0.toFixed(1), 'T (meas)': s.Tright.toFixed(4), 'T (theory)': Tanal.toExponential(3), 'R (meas)': s.Tleft.toFixed(4) }; }

export default function QuantumTunneling() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ V0: 40, width: 0.08, k0: 12, sigma: 0.06 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, sample, computeStats, resetKey: `${params.V0}|${params.width}|${params.k0}|${params.sigma}` });
  return (
    <SimLayout title="Quantum Tunneling (Wave Packet)" configName="quantum-tunneling" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      graph={<LiveGraph data={sim.graphData} xKey="t" series={[{ key: 'T', color: '#22d3ee' }, { key: 'R', color: '#f97316' }]} />}
      exportBar={<ExportBar graphData={sim.graphData} config={params} canvasRef={canvasRef} name="quantum-tunneling" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">A Gaussian wave packet hits a barrier. Even when E &lt; V₀, part of the packet tunnels through. T(E) is compared with the analytical rectangular-barrier formula. Raise V₀ or width to suppress tunneling.</div>} />
  );
}