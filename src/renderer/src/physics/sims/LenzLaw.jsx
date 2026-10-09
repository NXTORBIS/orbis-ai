import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

const schema = [
  { key: 'speed', label: 'Magnet speed', min: 0.2, max: 2, step: 0.1, type: 'range' },
  { key: 'strength', label: 'Magnet strength', min: 0.5, max: 3, step: 0.1, type: 'range' },
];
function makeInitial() { return { magnetX: 0.15, dir: 1, approaching: true }; }
function step(s, dt, p) {
  s.magnetX += s.dir * p.speed * dt * 0.25;
  if (s.magnetX > 0.42) { s.dir = -1; s.approaching = false; }
  if (s.magnetX < 0.15) { s.dir = 1; s.approaching = true; }
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const cy = h / 2;
  const coilX = w * 0.6;
  // Coil
  ctx.strokeStyle = '#f97316'; ctx.lineWidth = 2;
  for (let i = 0; i < 8; i++) {
    ctx.beginPath(); ctx.ellipse(coilX + i * 5, cy, 5, 35, 0, 0, Math.PI * 2); ctx.stroke();
  }
  // Magnet
  const mx = s.magnetX * w;
  ctx.fillStyle = '#ef4444'; ctx.fillRect(mx - 18, cy - 10, 18, 20);
  ctx.fillStyle = '#3b82f6'; ctx.fillRect(mx, cy - 10, 18, 20);
  ctx.fillStyle = 'white'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('N', mx - 9, cy); ctx.fillText('S', mx + 9, cy);
  // Induced current direction
  const dist = coilX - mx;
  const dFlux = s.approaching ? -1 : 1; // approaching: flux increasing through coil
  const currentDir = s.approaching ? 1 : -1; // Lenz: oppose the change
  // Induced B field arrows (opposing magnet)
  const inducedB = p.strength / (1 + dist * dist * 0.01) * (s.approaching ? 1 : -1);
  ctx.strokeStyle = `rgba(34,211,238,${0.3 + 0.5 * Math.abs(inducedB)})`; ctx.lineWidth = 2;
  if (Math.abs(inducedB) > 0.1) {
    for (let i = 0; i < 4; i++) {
      const ay = cy - 25 + i * 17;
      const dir = currentDir;
      ctx.beginPath();
      ctx.moveTo(coilX + 50, ay); ctx.lineTo(coilX + 50 + dir * 20, ay);
      ctx.moveTo(coilX + 50 + dir * 20, ay); ctx.lineTo(coilX + 50 + dir * 14, ay - 4); ctx.lineTo(coilX + 50 + dir * 14, ay + 4); ctx.closePath();
      ctx.fillStyle = `rgba(34,211,238,${0.3 + 0.5 * Math.abs(inducedB)})`; ctx.fill();
      ctx.stroke();
    }
  }
  // Labels
  ctx.fillStyle = '#fde047'; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center';
  ctx.fillText(s.approaching ? 'APPROACHING' : 'RECEDING', w / 2, 30);
  ctx.fillStyle = '#22d3ee'; ctx.font = '11px monospace'; ctx.textAlign = 'left';
  ctx.fillText(`Induced current: ${currentDir > 0 ? '↻ CW' : '↺ CCW'}`, 12, h - 16);
  ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.font = '10px monospace';
  ctx.fillText('Lenz: induced current opposes flux change', 12, h - 32);
}
function computeStats(s, p) {
  const dist = 0.6 - s.magnetX;
  const flux = p.strength / (1 + dist * dist * 5);
  return { 'Magnet pos': s.magnetX.toFixed(2), 'State': s.approaching ? 'Approaching' : 'Receding', 'Flux trend': s.approaching ? '↑ increasing' : '↓ decreasing', 'Induced I': s.approaching ? 'CW (oppose)' : 'CCW (oppose)' };
}
export default function LenzLaw() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ speed: 1, strength: 1.5 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats });
  return (
    <SimLayout title="Lenz's Law — Induced Current Direction" configName="lenz" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="lenz" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Magnet oscillates toward and away from the coil. When approaching, flux increases → induced current creates an opposing field (CW). When receding, flux decreases → current reverses (CCW) to sustain the flux. This is energy conservation in action.</div>} />
  );
}