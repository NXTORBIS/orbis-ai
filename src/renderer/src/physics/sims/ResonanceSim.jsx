import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, LiveGraph, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

// Resonance — driven harmonic oscillator with frequency response curve.
// Unique focus: resonance peak, amplitude vs drive frequency, phase shift through resonance.
const schema = [
  { key: 'm', label: 'Mass m (kg)', min: 0.1, max: 5, step: 0.1, type: 'range' },
  { key: 'k', label: 'Spring k (N/m)', min: 1, max: 100, step: 1, type: 'range' },
  { key: 'b', label: 'Damping b (N·s/m)', min: 0.01, max: 5, step: 0.01, type: 'range' },
  { key: 'F0', label: 'Drive amplitude F₀ (N)', min: 0.1, max: 10, step: 0.1, type: 'range' },
  { key: 'wd', label: 'Drive freq ω_d (rad/s)', min: 0.1, max: 20, step: 0.05, type: 'range' },
];

function makeInitial(p) { return { x: 0, v: 0, t: 0 }; }
function step(s, dt, p, t) {
  // m x'' + b x' + k x = F0 cos(wd t)
  const a = (-p.k * s.x - p.b * s.v + p.F0 * Math.cos(p.wd * t)) / p.m;
  s.v += a * dt; s.x += s.v * dt; s.t += dt;
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  // Left half: frequency response curve
  const plotW = w * 0.5;
  const w0 = Math.sqrt(p.k / p.m);
  const zeta = p.b / (2 * Math.sqrt(p.k * p.m));
  const wdMax = w0 * 2.5;
  // Steady-state amplitude: A = F0 / sqrt((k - m wd^2)^2 + (b wd)^2)
  const ampAt = (wd) => p.F0 / Math.sqrt(Math.pow(p.k - p.m * wd * wd, 2) + Math.pow(p.b * wd, 2));
  const ampMax = ampAt(w0 * Math.sqrt(Math.max(0, 1 - 2 * zeta * zeta))) || ampAt(w0);
  const yScale = (h * 0.35) / Math.max(ampMax, 0.01);
  // axes
  ctx.strokeStyle = 'hsl(var(--muted-foreground) / 0.3)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(20, h - 30); ctx.lineTo(plotW - 10, h - 30); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(20, 20); ctx.lineTo(20, h - 30); ctx.stroke();
  // curve
  ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i <= plotW - 30; i++) {
    const wd = (i / (plotW - 30)) * wdMax;
    const amp = ampAt(wd);
    const px = 20 + i, py = h - 30 - amp * yScale;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();
  // current drive frequency marker
  const curX = 20 + (p.wd / wdMax) * (plotW - 30);
  const curAmp = ampAt(p.wd);
  const curY = h - 30 - curAmp * yScale;
  ctx.strokeStyle = '#f97316'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(curX, h - 30); ctx.lineTo(curX, curY); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = '#f97316'; ctx.beginPath(); ctx.arc(curX, curY, 6, 0, Math.PI * 2); ctx.fill();
  // labels
  ctx.font = '10px monospace'; ctx.fillStyle = 'hsl(var(--muted-foreground))';
  ctx.fillText('ω_d', plotW - 25, h - 15);
  ctx.fillText('A(ω)', 25, 30);
  ctx.fillStyle = '#22d3ee'; ctx.fillText('ω₀=' + w0.toFixed(2), plotW * 0.4, h - 42);
  // Right half: time series (drive + response)
  const tsX = plotW + 20;
  const tsW = w - tsX - 20;
  ctx.strokeStyle = 'hsl(var(--muted-foreground) / 0.3)';
  ctx.beginPath(); ctx.moveTo(tsX, h / 2); ctx.lineTo(tsX + tsW, h / 2); ctx.stroke();
  // drive signal
  ctx.strokeStyle = '#a855f744'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i <= tsW; i++) {
    const ti = (i / tsW) * Math.max(s.t, 10);
    const val = (p.F0 / p.k) * Math.cos(p.wd * ti);
    const py = h / 2 - val * 30;
    if (i === 0) ctx.moveTo(tsX + i, py); else ctx.lineTo(tsX + i, py);
  }
  ctx.stroke();
  // response
  ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i <= tsW; i++) {
    const ti = Math.max(0, s.t - (1 - i / tsW) * 10);
    // approximate response at time ti (use current state trajectory)
    const val = s.x * Math.cos(p.wd * (ti - s.t));
    const py = h / 2 - val * 30;
    if (i === 0) ctx.moveTo(tsX + i, py); else ctx.lineTo(tsX + i, py);
  }
  ctx.stroke();
  ctx.font = '10px monospace';
  ctx.fillStyle = '#a855f7'; ctx.fillText('Drive', tsX + 5, 20);
  ctx.fillStyle = '#22d3ee'; ctx.fillText('Response', tsX + 60, 20);
}
function sample(s, p) {
  const w0 = Math.sqrt(p.k / p.m);
  const zeta = p.b / (2 * Math.sqrt(p.k * p.m));
  const amp = p.F0 / Math.sqrt(Math.pow(p.k - p.m * p.wd * p.wd, 2) + Math.pow(p.b * p.wd, 2));
  const phase = Math.atan2(p.b * p.wd, p.k - p.m * p.wd * p.wd);
  return { x: +s.x.toFixed(3), amp: +amp.toFixed(3), phase: +phase.toFixed(3) };
}
function computeStats(s, p) {
  const w0 = Math.sqrt(p.k / p.m);
  const zeta = p.b / (2 * Math.sqrt(p.k * p.m));
  const wr = w0 * Math.sqrt(Math.max(0, 1 - 2 * zeta * zeta));
  const amp = p.F0 / Math.sqrt(Math.pow(p.k - p.m * p.wd * p.wd, 2) + Math.pow(p.b * p.wd, 2));
  const phase = Math.atan2(p.b * p.wd, p.k - p.m * p.wd * p.wd);
  const Q = 1 / (2 * zeta);
  return { 'ω₀ (rad/s)': w0.toFixed(3), 'ω_r (rad/s)': wr.toFixed(3), 'ω_d/ω₀': (p.wd / w0).toFixed(3), 'A (m)': amp.toFixed(3), 'φ (rad)': phase.toFixed(3), 'Q': Q.toFixed(2) };
}

export default function ResonanceSim() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ m: 1, k: 25, b: 0.5, F0: 2, wd: 5 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, sample, computeStats, resetKey: `${params.m}|${params.k}|${params.b}|${params.F0}|${params.wd}` });
  const data = sim.graphData;
  return (
    <SimLayout title="Resonance — Driven Oscillator Response" configName="resonance" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      graph={<LiveGraph data={data} xKey="t" series={[{ key: 'x', color: '#22d3ee' }, { key: 'amp', color: '#f97316' }, { key: 'phase', color: '#a855f7' }]} />}
      exportBar={<ExportBar graphData={data} config={params} canvasRef={canvasRef} name="resonance" />} />
  );
}