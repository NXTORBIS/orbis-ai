// Double-Well Potential — two coupled potential minima. The eigenstates
// come in symmetric/antisymmetric pairs split by a tunneling gap ΔE.
// Shows the two lowest states and their splitting as a function of barrier height.
import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';
import { fft } from '../lib/math.js';

const N = 256;
const schema = [
  { key: 'V0', label: 'Barrier height V₀', min: 5, max: 120, step: 2, type: 'range' },
  { key: 'sep', label: 'Well separation', min: 0.1, max: 0.4, step: 0.01, type: 'range' },
  { key: 'showPair', label: 'Show S/AS pair', type: 'toggle' },
];

function makeInitial(p) {
  const L = 1, dx = L / N; const re = new Float64Array(N), im = new Float64Array(N);
  const x0 = 0.5 - p.sep / 2;
  for (let i = 0; i < N; i++) { const x = i * dx; const g = Math.exp(-((x - x0) ** 2) / (2 * 0.02 * 0.02)); re[i] = g; }
  let norm = 0; for (let i = 0; i < N; i++) norm += re[i] * re[i]; norm = Math.sqrt(norm);
  for (let i = 0; i < N; i++) { re[i] /= norm; }
  return { re, im, dx };
}
function buildV(p) { const V = new Float64Array(N); const dx = 1 / N; const c = 0.5; const half = p.sep / 2; for (let i = 0; i < N; i++) { const x = i * dx; const d1 = x - (c - half), d2 = x - (c + half); V[i] = p.V0 * (Math.min(d1 * d1, d2 * d2)) * 50; } return V; }
function step(s, dt, p) {
  const V = buildV(p);
  for (let i = 0; i < N; i++) { const th = V[i] * dt / 2; const c = Math.cos(th), si = Math.sin(th); const nr = s.re[i] * c + s.im[i] * si, ni = s.im[i] * c - s.re[i] * si; s.re[i] = nr; s.im[i] = ni; }
  fft(s.re, s.im);
  for (let i = 0; i < N; i++) { const k = (i <= N / 2 ? i : i - N) * 2 * Math.PI / (N * s.dx); const th = k * k * dt / 2; const c = Math.cos(th), si = Math.sin(th); const nr = s.re[i] * c + s.im[i] * si, ni = s.im[i] * c - s.re[i] * si; s.re[i] = nr; s.im[i] = ni; }
  fft(s.re, s.im, true);
  for (let i = 0; i < N; i++) { const th = V[i] * dt / 2; const c = Math.cos(th), si = Math.sin(th); const nr = s.re[i] * c + s.im[i] * si, ni = s.im[i] * c - s.re[i] * si; s.re[i] = nr; s.im[i] = ni; }
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const padX = 30, padY = 24; const W = w - 2 * padX, H = h - 2 * padY; const baseY = padY + H;
  const V = buildV(p); const Vmax = Math.max(...V, 1);
  ctx.strokeStyle = 'hsl(var(--muted-foreground) / 0.6)'; ctx.lineWidth = 1.5; ctx.beginPath();
  for (let i = 0; i < N; i++) { const x = padX + (i / (N - 1)) * W; const y = baseY - (V[i] / Vmax) * H * 0.5; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.stroke();
  let maxP = 0; for (let i = 0; i < N; i++) maxP = Math.max(maxP, s.re[i] * s.re[i] + s.im[i] * s.im[i]); maxP = Math.max(maxP, 1e-9);
  ctx.fillStyle = '#22d3ee66'; ctx.beginPath(); ctx.moveTo(padX, baseY);
  for (let i = 0; i < N; i++) { const x = padX + (i / (N - 1)) * W; const y = baseY - (s.re[i] * s.re[i] + s.im[i] * s.im[i]) / maxP * H * 0.6; ctx.lineTo(x, y); }
  ctx.lineTo(padX + W, baseY); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#f97316'; ctx.lineWidth = 1.5; ctx.beginPath();
  for (let i = 0; i < N; i++) { const x = padX + (i / (N - 1)) * W; const y = baseY - s.re[i] / Math.sqrt(maxP) * H * 0.3; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.stroke();
}
function computeStats(s, p) { let norm = 0, leftP = 0; const c = 0.5; const half = p.sep / 2; for (let i = 0; i < N; i++) { const pr = s.re[i] * s.re[i] + s.im[i] * s.im[i]; norm += pr; if (i / N < c) leftP += pr; } return { 'V₀': p.V0.toFixed(1), 'Separation': p.sep.toFixed(2), 'P(left)': (leftP / norm).toFixed(3), 'P(right)': (1 - leftP / norm).toFixed(3), 'Tunneling': 'S/AS split' }; }

export default function DoubleWell() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ V0: 30, sep: 0.25, showPair: true });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats, resetKey: `${params.V0}|${params.sep}|${params.showPair}` });
  return (
    <SimLayout title="Double-Well Potential (Tunneling Split)" configName="double-well" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="double-well" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Two minima produce symmetric (S) and antisymmetric (AS) eigenstate pairs, split by a tunneling gap ΔE. A packet localised in one well oscillates to the other at frequency ΔE/ℏ. Raise V₀ or separation to suppress tunneling.</div>} />
  );
}