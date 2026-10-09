import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

const schema = [
  { key: 'freq', label: 'Frequency (Hz)', min: 50, max: 2000, step: 50, type: 'range' },
  { key: 'medium', label: 'Medium', type: 'select', options: [{ value: 'air', label: 'Air (343 m/s)' }, { value: 'water', label: 'Water (1480 m/s)' }, { value: 'steel', label: 'Steel (5000 m/s)' }] },
  { key: 'amp', label: 'Amplitude (dB)', min: 20, max: 120, step: 5, type: 'range' },
];
function makeInitial() { return { t: 0 }; }
function step(s, dt) { s.t += dt; }
const speeds = { air: 343, water: 1480, steel: 5000 };
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const cy = h / 2, v = speeds[p.medium], lambda = v / p.freq, A = (p.amp - 60) * 0.5;
  const k = 2 * Math.PI / (lambda * 0.01), omega = 2 * Math.PI * p.freq * 0.005;
  // Particles showing compression/rarefaction
  const N = 80, dw = w / N;
  for (let i = 0; i < N; i++) {
    const x0 = i * dw;
    const disp = A * 0.4 * Math.sin(k * x0 - omega * s.t);
    const px = x0 + disp + dw / 2;
    const pressure = Math.sin(k * x0 - omega * s.t);
    const intensity = 0.3 + 0.5 * (pressure + 1) / 2;
    ctx.fillStyle = `rgba(168,85,247,${intensity})`;
    ctx.beginPath(); ctx.arc(px, cy, 2.5 + intensity * 2, 0, Math.PI * 2); ctx.fill();
  }
  // Pressure wave curve
  ctx.strokeStyle = 'rgba(249,115,22,0.6)'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let x = 0; x < w; x += 2) { const y = cy + A * 0.3 * Math.sin(k * x - omega * s.t) - 60; if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '10px monospace'; ctx.textAlign = 'left';
  ctx.fillText(`v = ${v} m/s, λ = ${lambda.toFixed(3)} m`, 12, h - 16);
  ctx.fillText(`β = ${p.amp} dB (I/I₀ = ${(10 ** (p.amp / 10)).toExponential(1)})`, 12, h - 32);
  // Compression/rarefaction labels
  ctx.fillStyle = '#f97316'; ctx.fillText('C', w * 0.15, 30);
  ctx.fillStyle = '#22d3ee'; ctx.fillText('R', w * 0.4, 30);
}
function computeStats(s, p) { const v = speeds[p.medium]; const lambda = v / p.freq; return { 'Medium': p.medium, 'Speed': v + ' m/s', 'λ': lambda.toFixed(3) + ' m', 'dB': p.amp }; }
export default function SoundWaves() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ freq: 440, medium: 'air', amp: 60 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats });
  return (
    <SimLayout title="Sound Waves" configName="sound-waves" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="sound-waves" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Longitudinal pressure wave. Speed depends on medium stiffness/density: v = √(B/ρ). Louder = higher dB (logarithmic). 440 Hz = concert pitch A4.</div>} />
  );
}