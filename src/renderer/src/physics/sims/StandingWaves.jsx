import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

const schema = [
  { key: 'harmonic', label: 'Harmonic n', min: 1, max: 6, step: 1, type: 'range' },
  { key: 'amp', label: 'Amplitude', min: 0.2, max: 0.8, step: 0.05, type: 'range' },
  { key: 'boundary', label: 'Boundary', type: 'select', options: [{ value: 'fixed', label: 'Fixed-Fixed' }, { value: 'free', label: 'Free-Free' }] },
];
function makeInitial() { return { t: 0 }; }
function step(s, dt) { s.t += dt; }
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const cy = h / 2, L = w - 80, x0 = 40, A = p.amp * 80, n = Math.round(p.harmonic), omega = 2;
  // String
  ctx.strokeStyle = '#a855f7'; ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (let i = 0; i <= L; i += 2) {
    const x = x0 + i, xn = i / L;
    const envelope = p.boundary === 'fixed' ? Math.sin(n * Math.PI * xn) : Math.cos(n * Math.PI * xn);
    const y = cy + A * envelope * Math.cos(omega * s.t);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  // Envelope (max amplitude shape)
  ctx.strokeStyle = 'rgba(168,85,247,0.2)'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= L; i += 2) { const x = x0 + i, xn = i / L; const env = p.boundary === 'fixed' ? Math.sin(n * Math.PI * xn) : Math.cos(n * Math.PI * xn); const y = cy + A * Math.abs(env); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
  ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i <= L; i += 2) { const x = x0 + i, xn = i / L; const env = p.boundary === 'fixed' ? Math.sin(n * Math.PI * xn) : Math.cos(n * Math.PI * xn); const y = cy - A * Math.abs(env); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
  ctx.stroke();
  // Nodes
  for (let m = 0; m <= n; m++) {
    const xn = p.boundary === 'fixed' ? m / n : (m + 0.5) / n;
    if (xn < 0 || xn > 1) continue;
    const px = x0 + xn * L;
    ctx.fillStyle = '#fde047'; ctx.beginPath(); ctx.arc(px, cy, 4, 0, Math.PI * 2); ctx.fill();
  }
  // Antinodes
  for (let m = 0; m < n; m++) {
    const xn = (m + 0.5) / n;
    const px = x0 + xn * L;
    ctx.strokeStyle = 'rgba(34,211,238,0.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(px, cy, 6, 0, Math.PI * 2); ctx.stroke();
  }
  // Endpoints
  ctx.fillStyle = '#64748b'; ctx.beginPath(); ctx.arc(x0, cy, 5, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(x0 + L, cy, 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '10px monospace'; ctx.textAlign = 'left';
  ctx.fillText(`n=${n}: ${n + 1} nodes, ${n} antinodes`, 12, h - 16);
}
function computeStats(s, p) { const n = Math.round(p.harmonic); return { 'Harmonic n': n, 'Nodes': n + 1, 'Antinodes': n, 'f_n/f_1': n }; }
export default function StandingWaves() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ harmonic: 2, amp: 0.5, boundary: 'fixed' });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats });
  return (
    <SimLayout title="Standing Waves" configName="standing-waves" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="standing-waves" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Standing wave: y = 2A sin(kx) cos(ωt). Yellow dots = nodes (zero motion), cyan circles = antinodes (max motion). Only resonant frequencies f_n = nv/2L persist on a bounded string.</div>} />
  );
}