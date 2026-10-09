import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, LiveGraph, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

const N = 240;
const schema = [
  { key: 'c', label: 'Wave speed c', min: 0.2, max: 3, step: 0.05, type: 'range' },
  { key: 'damping', label: 'Damping', min: 0, max: 0.3, step: 0.005, type: 'range' },
  { key: 'mode', label: 'Mode', type: 'select', options: [{ value: 'pulse', label: 'Pulse (fixed ends)' }, { value: 'sine', label: 'Driven sine (left end)' }, { value: 'standing', label: 'Standing wave' }] },
  { key: 'freq', label: 'Drive frequency (Hz)', min: 0.1, max: 5, step: 0.05, type: 'range' },
  { key: 'n', label: 'Harmonic n (standing)', min: 1, max: 6, step: 1, type: 'range' },
];

function makeInitial(p) {
  const u = new Array(N).fill(0), up = new Array(N).fill(0);
  if (p.mode === 'pulse') { for (let i = 0; i < N; i++) { const x = i / N - 0.5; u[i] = Math.exp(-x * x * 250); up[i] = u[i]; } }
  else if (p.mode === 'standing') { for (let i = 0; i < N; i++) u[i] = Math.sin(p.n * Math.PI * i / (N - 1)); for (let i = 0; i < N; i++) up[i] = u[i]; }
  return { u, up, t: 0 };
}
function step(s, dt, p, t) {
  const c = p.c; const internal = 0.4 / c; const nsub = Math.max(1, Math.ceil(dt / internal)); const h = dt / nsub; const r = (c * h) ** 2;
  for (let s2 = 0; s2 < nsub; s2++) {
    const u = s.u, up = s.up, un = new Array(N);
    for (let i = 1; i < N - 1; i++) un[i] = 2 * u[i] - up[i] + r * (u[i + 1] - 2 * u[i] + u[i - 1]) - p.damping * (u[i] - up[i]);
    un[0] = p.mode === 'sine' ? Math.sin(2 * Math.PI * p.freq * t) : 0; un[N - 1] = 0;
    s.up = u; s.u = un; s.t += h;
  }
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const cy = h / 2; const sx = w / (N - 1); const amp = h * 0.35;
  ctx.strokeStyle = 'hsl(var(--border) / 0.4)'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke(); ctx.setLineDash([]);
  ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2; ctx.beginPath();
  for (let i = 0; i < N; i++) { const x = i * sx, y = cy - s.u[i] * amp; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
  ctx.stroke();
  ctx.fillStyle = '#f97316'; for (let i = 0; i < N; i += 4) ctx.fillRect(i * sx - 1, cy - s.u[i] * amp - 1.5, 2, 3);
}
function sample(s) { let E = 0; for (let i = 0; i < N; i++) E += s.u[i] * s.u[i]; return { u_mid: +s.u[Math.floor(N / 2)].toFixed(3), E: +E.toFixed(2) }; }
function computeStats(s, p) {
  let E = 0; for (let i = 0; i < N; i++) E += s.u[i] * s.u[i];
  const f1 = p.c / (2 * (N - 1) * 0.0042); // approx fundamental (display only)
  return { 'u(centre)': s.u[Math.floor(N / 2)].toFixed(3), 'Energy': E.toFixed(2), 'c': p.c.toFixed(2), 'Courant': ((p.c * (0.4 / p.c)) ** 2).toFixed(2) };
}

export default function WaveString() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ c: 1, damping: 0.01, mode: 'pulse', freq: 1, n: 2 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, sample, computeStats, resetKey: `${params.mode}|${params.c}|${params.freq}|${params.n}|${params.damping}` });
  return (
    <SimLayout title="Wave on a String (FDTD)" configName="wave-string" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      graph={<LiveGraph data={sim.graphData} xKey="t" series={[{ key: 'u_mid', color: '#22d3ee' }, { key: 'E', color: '#f97316' }]} />}
      exportBar={<ExportBar graphData={sim.graphData} config={params} canvasRef={canvasRef} name="wave-string" />} />
  );
}