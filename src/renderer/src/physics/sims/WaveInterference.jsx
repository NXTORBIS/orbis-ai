import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

const schema = [
  { key: 'sep', label: 'Source separation', min: 0.1, max: 0.4, step: 0.02, type: 'range' },
  { key: 'wavelength', label: 'Wavelength', min: 20, max: 80, step: 2, type: 'range' },
];
function makeInitial() { return { t: 0 }; }
function step(s, dt) { s.t += dt; }
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const s1x = w / 2 - p.sep * w / 2, s2x = w / 2 + p.sep * w / 2, sy = h * 0.7;
  const lambda = p.wavelength, k = 2 * Math.PI / lambda;
  // 2D interference pattern
  const gw = 120, gh = 80, cw = w / gw, ch = h / gh;
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const x = (i + 0.5) / gw * w, y = (j + 0.5) / gh * h;
    const r1 = Math.hypot(x - s1x, y - sy), r2 = Math.hypot(x - s2x, y - sy);
    const phase = k * (r1 - r2);
    const amp = Math.cos(phase);
    const intensity = (amp + 1) / 2;
    ctx.fillStyle = `rgba(168,85,247,${0.05 + 0.3 * intensity})`;
    ctx.fillRect(i * cw, j * ch, cw + 1, ch + 1);
  }
  // Sources
  ctx.fillStyle = '#f97316'; ctx.beginPath(); ctx.arc(s1x, sy, 6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#22d3ee'; ctx.beginPath(); ctx.arc(s2x, sy, 6, 0, Math.PI * 2); ctx.fill();
  // Screen (top)
  ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, 20); ctx.lineTo(w, 20); ctx.stroke();
  // Intensity on screen
  for (let i = 0; i < w; i += 2) {
    const r1 = Math.hypot(i - s1x, 20 - sy), r2 = Math.hypot(i - s2x, 20 - sy);
    const phase = k * (r1 - r2);
    const intensity = (Math.cos(phase) + 1) / 2;
    ctx.fillStyle = `rgba(253,224,71,${intensity})`;
    ctx.fillRect(i, 0, 2, 20);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '10px monospace'; ctx.textAlign = 'left';
  ctx.fillText('Two-source circular wave interference', 12, h - 16);
  ctx.fillText('Yellow strip = intensity on screen', 12, h - 32);
}
function computeStats(s, p) { return { 'Separation': p.sep.toFixed(2), 'λ': p.wavelength.toFixed(0) + ' px', 'Pattern': '2D interference', 'Fringes': 'visible on screen' }; }
export default function WaveInterference() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ sep: 0.2, wavelength: 40 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats });
  return (
    <SimLayout title="Wave Interference (Two Sources)" configName="wave-interference" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="wave-interference" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Two point sources emit circular waves. Path difference Δr = mλ → constructive (bright); Δr = (m+½)λ → destructive (dark). Like water ripples from two stones.</div>} />
  );
}