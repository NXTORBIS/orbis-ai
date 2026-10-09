import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, LiveGraph, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

// Damped Oscillations — under/critical/over-damped harmonic oscillator.
// Unique focus: damping ratio regimes, decay envelope, damped frequency, Q factor.
const schema = [
  { key: 'm', label: 'Mass m (kg)', min: 0.1, max: 5, step: 0.1, type: 'range' },
  { key: 'k', label: 'Spring k (N/m)', min: 1, max: 100, step: 1, type: 'range' },
  { key: 'b', label: 'Damping b (N·s/m)', min: 0, max: 20, step: 0.1, type: 'range' },
  { key: 'x0', label: 'Initial x₀ (m)', min: -3, max: 3, step: 0.05, type: 'range' },
];

function makeInitial(p) { return { x: p.x0, v: 0, t: 0 }; }
function step(s, dt, p, t) {
  // m x'' + b x' + k x = 0  (semi-implicit Euler)
  const a = (-p.k * s.x - p.b * s.v) / p.m;
  s.v += a * dt; s.x += s.v * dt; s.t += dt;
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const cy = h / 2;
  const scale = Math.min(w, h) / 8;
  // equilibrium line
  ctx.strokeStyle = 'hsl(var(--muted-foreground) / 0.3)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke(); ctx.setLineDash([]);
  // envelope curves ±A * exp(-ζω₀ t)
  const w0 = Math.sqrt(p.k / p.m);
  const zeta = p.b / (2 * Math.sqrt(p.k * p.m));
  const env = p.x0 * Math.exp(-zeta * w0 * s.t);
  ctx.strokeStyle = '#ef444466'; ctx.lineWidth = 1; ctx.setLineDash([6, 4]);
  ctx.beginPath();
  for (let i = 0; i <= w; i += 2) {
    const ti = (i / w) * Math.max(s.t, 10);
    const ei = p.x0 * Math.exp(-zeta * w0 * ti);
    const py = cy - ei * scale;
    if (i === 0) ctx.moveTo(i, py); else ctx.lineTo(i, py);
  }
  ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i <= w; i += 2) {
    const ti = (i / w) * Math.max(s.t, 10);
    const ei = -p.x0 * Math.exp(-zeta * w0 * ti);
    const py = cy - ei * scale;
    if (i === 0) ctx.moveTo(i, py); else ctx.lineTo(i, py);
  }
  ctx.stroke(); ctx.setLineDash([]);
  // current oscillation point (mapped to canvas width by time)
  const tFrac = Math.min(s.t / Math.max(s.t, 10), 1);
  const px = tFrac * w;
  const py = cy - s.x * scale;
  ctx.fillStyle = '#22d3ee';
  ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.fill();
  // trail
  ctx.strokeStyle = '#22d3ee44'; ctx.lineWidth = 2;
  ctx.beginPath();
  const N = 200;
  for (let i = 0; i <= N; i++) {
    const ti = (i / N) * s.t;
    // recompute x at past time analytically for trail (approximate)
    const xi = p.x0 * Math.exp(-zeta * w0 * ti) * Math.cos(w0 * Math.sqrt(Math.max(0, 1 - zeta * zeta)) * ti);
    const tx = (ti / Math.max(s.t, 10)) * w;
    const ty = cy - xi * scale;
    if (i === 0) ctx.moveTo(tx, ty); else ctx.lineTo(tx, ty);
  }
  ctx.stroke();
}
function sample(s, p) {
  const w0 = Math.sqrt(p.k / p.m);
  const zeta = p.b / (2 * Math.sqrt(p.k * p.m));
  const env = Math.abs(p.x0 * Math.exp(-zeta * w0 * s.t));
  return { x: +s.x.toFixed(3), v: +s.v.toFixed(3), env: +env.toFixed(3) };
}
function computeStats(s, p) {
  const w0 = Math.sqrt(p.k / p.m);
  const zeta = p.b / (2 * Math.sqrt(p.k * p.m));
  const regime = zeta < 1 ? 'Underdamped' : zeta > 1 ? 'Overdamped' : 'Critically damped';
  const wd = zeta < 1 ? w0 * Math.sqrt(1 - zeta * zeta) : 0;
  const Q = zeta > 0 ? 1 / (2 * zeta) : Infinity;
  const tau = 1 / (zeta * w0 || 0.001);
  return { 'ω₀ (rad/s)': w0.toFixed(3), 'ζ': zeta.toFixed(3), 'Regime': regime, 'ω_d (rad/s)': wd.toFixed(3), 'Q factor': isFinite(Q) ? Q.toFixed(2) : '∞', 'τ (s)': tau.toFixed(3) };
}

export default function DampedOscillations() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ m: 1, k: 20, b: 1, x0: 2 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, sample, computeStats, resetKey: `${params.m}|${params.k}|${params.b}|${params.x0}` });
  const data = sim.graphData;
  return (
    <SimLayout title="Damped Oscillations — Decay Regimes" configName="damped-osc" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      graph={<LiveGraph data={data} xKey="t" series={[{ key: 'x', color: '#22d3ee' }, { key: 'env', color: '#ef4444' }, { key: 'v', color: '#f97316' }]} />}
      exportBar={<ExportBar graphData={data} config={params} canvasRef={canvasRef} name="damped-osc" />} />
  );
}