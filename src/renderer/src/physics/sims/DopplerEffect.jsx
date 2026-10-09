import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

const schema = [
  { key: 'vs', label: 'Source speed (v/c)', min: 0, max: 0.8, step: 0.05, type: 'range' },
  { key: 'freq', label: 'Source freq (Hz)', min: 1, max: 5, step: 0.5, type: 'range' },
];
function makeInitial() { return { t: 0, sourceX: 0.1, dir: 1, wavefronts: [] }; }
function step(s, dt, p) {
  s.t += dt;
  s.sourceX += s.dir * p.vs * dt * 0.3;
  if (s.sourceX > 0.9) s.dir = -1;
  if (s.sourceX < 0.1) s.dir = 1;
  // Emit wavefronts
  if (!s.lastEmit) s.lastEmit = 0;
  s.lastEmit += dt;
  const period = 1 / p.freq;
  if (s.lastEmit >= period) { s.lastEmit = 0; s.wavefronts.push({ x: s.sourceX, y: 0.5, r: 0, t0: s.t }); }
  // Grow wavefronts
  const c = 0.3;
  s.wavefronts = s.wavefronts.filter((wf) => wf.r < 1.5);
  for (const wf of s.wavefronts) wf.r += c * dt;
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  // Wavefronts
  for (const wf of s.wavefronts) {
    const cx = wf.x * w, cy = wf.y * h, r = wf.r * Math.min(w, h);
    ctx.strokeStyle = `rgba(168,85,247,${Math.max(0, 0.5 - wf.r)})`; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  }
  // Source
  const sx = s.sourceX * w, sy = h / 2;
  ctx.fillStyle = '#f97316'; ctx.beginPath(); ctx.arc(sx, sy, 8, 0, Math.PI * 2); ctx.fill();
  // Observer
  const ox = w * 0.9, oy = h / 2;
  ctx.fillStyle = '#22d3ee'; ctx.beginPath(); ctx.arc(ox, oy, 8, 0, Math.PI * 2); ctx.fill();
  // Velocity arrow
  ctx.strokeStyle = '#fde047'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + s.dir * 30, sy); ctx.stroke();
  // Observed frequency
  const c = 0.3, vs = p.vs * s.dir;
  const fObs = p.freq * c / (c - vs);
  ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '11px monospace'; ctx.textAlign = 'left';
  ctx.fillText(`f' = f·c/(c−v_s) = ${fObs.toFixed(2)} Hz`, 12, h - 16);
  ctx.fillText(`f source = ${p.freq.toFixed(1)} Hz`, 12, h - 32);
}
function computeStats(s, p) {
  const c = 0.3, vs = p.vs * s.dir;
  const fObs = p.freq * c / (c - vs);
  return { 'f source': p.freq.toFixed(1) + ' Hz', 'v_s/c': p.vs.toFixed(2), 'f observed': fObs.toFixed(2) + ' Hz', 'Shift': ((fObs - p.freq) / p.freq * 100).toFixed(1) + '%' };
}
export default function DopplerEffect() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ vs: 0.3, freq: 2 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats });
  return (
    <SimLayout title="Doppler Effect" configName="doppler" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="doppler" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Moving source emits circular wavefronts. Ahead of the source, wavefronts compress (higher f'); behind, they spread (lower f'). f' = f·c/(c−v_s). Same principle as redshift in astronomy.</div>} />
  );
}