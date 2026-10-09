import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

const schema = [
  { key: 'mode', label: 'Wave type', type: 'select', options: [{ value: 'transverse', label: 'Transverse' }, { value: 'longitudinal', label: 'Longitudinal' }] },
  { key: 'freq', label: 'Frequency', min: 0.5, max: 4, step: 0.1, type: 'range' },
  { key: 'amp', label: 'Amplitude', min: 0.1, max: 0.8, step: 0.05, type: 'range' },
  { key: 'wavelength', label: 'Wavelength', min: 40, max: 200, step: 5, type: 'range' },
];
function makeInitial() { return { t: 0 }; }
function step(s, dt) { s.t += dt; }
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const cy = h / 2, k = 2 * Math.PI / p.wavelength, omega = 2 * Math.PI * p.freq, A = p.amp * 60;
  if (p.mode === 'transverse') {
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke();
    ctx.strokeStyle = '#a855f7'; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x < w; x += 2) { const y = cy + A * Math.sin(k * x - omega * s.t); if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.stroke();
    for (let x = 0; x < w; x += 25) { const y = cy + A * Math.sin(k * x - omega * s.t); ctx.strokeStyle = 'rgba(168,85,247,0.4)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, cy); ctx.lineTo(x, y); ctx.stroke(); }
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '10px monospace'; ctx.textAlign = 'left';
    ctx.fillText('Oscillation ⊥ to propagation', 12, h - 16);
  } else {
    const N = 60, dw = w / N;
    for (let i = 0; i < N; i++) {
      const x0 = i * dw;
      const displacement = A * 0.3 * Math.sin(k * x0 - omega * s.t);
      const px = x0 + displacement + dw / 2;
      const density = 1 + 0.5 * Math.sin(k * x0 - omega * s.t);
      ctx.fillStyle = `rgba(168,85,247,${0.3 + 0.4 * density})`;
      ctx.beginPath(); ctx.arc(px, cy, 3 + density * 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '10px monospace'; ctx.textAlign = 'left';
    ctx.fillText('Compression / rarefaction along propagation', 12, h - 16);
    ctx.fillStyle = '#f97316'; ctx.fillText('C', w * 0.2, 30); ctx.fillStyle = '#22d3ee'; ctx.fillText('R', w * 0.7, 30);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.font = '10px monospace'; ctx.textAlign = 'right';
  ctx.fillText(`v = fλ = ${(p.freq * p.wavelength).toFixed(0)} px/s`, w - 12, h - 16);
}
function computeStats(s, p) { return { 'Type': p.mode, 'f': p.freq.toFixed(1), 'λ': p.wavelength.toFixed(0), 'v = fλ': (p.freq * p.wavelength).toFixed(0) }; }
export default function TransverseLongitudinal() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ mode: 'transverse', freq: 1.5, amp: 0.5, wavelength: 100 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats });
  return (
    <SimLayout title="Transverse & Longitudinal Waves" configName="trans-long" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="trans-long" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Transverse: medium oscillates perpendicular to travel (string, light). Longitudinal: medium compresses/rarefies along travel (sound, spring). Only transverse waves can be polarised.</div>} />
  );
}