import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

const schema = [
  { key: 'f1', label: 'Frequency 1', min: 0.5, max: 3, step: 0.1, type: 'range' },
  { key: 'f2', label: 'Frequency 2', min: 0.5, max: 3, step: 0.1, type: 'range' },
  { key: 'phase', label: 'Phase diff Δφ', min: 0, max: 6.28, step: 0.1, type: 'range' },
  { key: 'amp', label: 'Amplitude', min: 0.2, max: 0.8, step: 0.05, type: 'range' },
];
function makeInitial() { return { t: 0 }; }
function step(s, dt) { s.t += dt; }
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const cy = h / 2, A = p.amp * 50, k = 0.03;
  const omega1 = 2 * Math.PI * p.f1, omega2 = 2 * Math.PI * p.f2;
  // Wave 1
  ctx.strokeStyle = 'rgba(59,130,246,0.5)'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let x = 0; x < w; x += 2) { const y = cy + A * Math.sin(k * x - omega1 * s.t); if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
  ctx.stroke();
  // Wave 2
  ctx.strokeStyle = 'rgba(249,115,22,0.5)'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let x = 0; x < w; x += 2) { const y = cy + A * Math.sin(k * x - omega2 * s.t + p.phase); if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
  ctx.stroke();
  // Sum
  ctx.strokeStyle = '#a855f7'; ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (let x = 0; x < w; x += 2) {
    const y1 = A * Math.sin(k * x - omega1 * s.t);
    const y2 = A * Math.sin(k * x - omega2 * s.t + p.phase);
    const ysum = cy + y1 + y2;
    if (x === 0) ctx.moveTo(x, ysum); else ctx.lineTo(x, ysum);
  }
  ctx.stroke();
  ctx.fillStyle = '#3b82f6'; ctx.font = '10px monospace'; ctx.textAlign = 'left'; ctx.fillText('Wave 1', 12, 20);
  ctx.fillStyle = '#f97316'; ctx.fillText('Wave 2', 12, 36);
  ctx.fillStyle = '#a855f7'; ctx.fillText('Sum (superposition)', 12, 52);
  const phaseDiff = p.phase;
  const interference = phaseDiff < 0.3 || phaseDiff > 5.98 ? 'Constructive' : (phaseDiff > 2.8 && phaseDiff < 3.5 ? 'Destructive' : 'Partial');
  ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.textAlign = 'right'; ctx.fillText(interference, w - 12, 20);
}
function computeStats(s, p) {
  const maxAmp = 2 * p.amp * 50;
  return { 'f1': p.f1.toFixed(1), 'f2': p.f2.toFixed(1), 'Δφ': p.phase.toFixed(2) + ' rad', 'Max |sum|': maxAmp.toFixed(0) };
}
export default function WaveSuperposition() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ f1: 1, f2: 1.5, phase: 0, amp: 0.5 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats });
  return (
    <SimLayout title="Wave Superposition" configName="wave-superposition" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="wave-superposition" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Two travelling waves add point-by-point. Same phase = constructive (double amplitude); opposite phase (π) = destructive (cancel). Different frequencies create beats.</div>} />
  );
}