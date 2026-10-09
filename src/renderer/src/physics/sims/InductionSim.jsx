import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, LiveGraph, stageBg } from '../ui.jsx';

const schema = [
  { key: 'Bstrength', label: 'Magnet B strength', min: 0.5, max: 5, step: 0.1, type: 'range' },
  { key: 'speed', label: 'Magnet speed', min: 0.3, max: 3, step: 0.1, type: 'range' },
  { key: 'turns', label: 'Coil turns N', min: 5, max: 50, step: 1, type: 'range' },
  { key: 'R', label: 'Circuit R (Ω)', min: 1, max: 20, step: 0.5, type: 'range' },
];
function makeInitial() { return { magnetX: 0.2, dir: 1, emf: 0, prevFlux: 0 }; }
function step(s, dt, p) {
  s.magnetX += s.dir * p.speed * dt * 0.3;
  if (s.magnetX > 0.8) s.dir = -1;
  if (s.magnetX < 0.2) s.dir = 1;
  // Flux through coil at x=0.5: depends on distance from magnet
  const dist = Math.abs(s.magnetX - 0.5);
  const flux = p.Bstrength / (1 + dist * dist * 20);
  s.emf = -p.turns * (flux - s.prevFlux) / dt;
  s.prevFlux = flux;
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const cy = h / 2;
  // Coil
  ctx.strokeStyle = '#f97316'; ctx.lineWidth = 2;
  for (let i = 0; i < p.turns; i++) {
    const cx = w * 0.5 + (i - p.turns / 2) * 4;
    ctx.beginPath(); ctx.ellipse(cx, cy, 4, 30, 0, 0, Math.PI * 2); ctx.stroke();
  }
  // Magnet
  const mx = s.magnetX * w;
  ctx.fillStyle = '#ef4444'; ctx.fillRect(mx - 20, cy - 12, 20, 24);
  ctx.fillStyle = '#3b82f6'; ctx.fillRect(mx, cy - 12, 20, 24);
  ctx.fillStyle = 'white'; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('N', mx - 10, cy); ctx.fillText('S', mx + 10, cy);
  // EMF indicator
  const emfAbs = Math.min(1, Math.abs(s.emf) / 10);
  ctx.strokeStyle = `rgba(34,211,238,${0.3 + 0.6 * emfAbs})`; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(w * 0.5, cy + 35); ctx.lineTo(w * 0.5 - 30, cy + 50); ctx.lineTo(w * 0.5 + 30, cy + 50); ctx.lineTo(w * 0.5, cy + 65); ctx.stroke();
  ctx.fillStyle = '#22d3ee'; ctx.font = '11px monospace'; ctx.textAlign = 'left';
  ctx.fillText(`EMF = ${s.emf.toFixed(3)} V`, 12, h - 16);
  // Current direction arrow
  if (Math.abs(s.emf) > 0.01) {
    const dir = s.emf > 0 ? 1 : -1;
    ctx.fillStyle = '#22d3ee';
    const ax = w * 0.5 + dir * 25;
    ctx.beginPath(); ctx.moveTo(ax, cy + 50); ctx.lineTo(ax - dir * 8, cy + 46); ctx.lineTo(ax - dir * 8, cy + 54); ctx.closePath(); ctx.fill();
  }
}
function sample(s, p, t) { return { t: +t.toFixed(3), emf: +s.emf.toFixed(4), flux: +(p.Bstrength / (1 + (s.magnetX - 0.5) ** 2 * 20)).toFixed(4) }; }
function computeStats(s, p) { return { 'EMF': s.emf.toFixed(3) + ' V', 'I = EMF/R': (s.emf / p.R).toFixed(3) + ' A', 'N turns': p.turns, 'Magnet pos': s.magnetX.toFixed(2) }; }
export default function InductionSim() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ Bstrength: 2, speed: 1, turns: 20, R: 5 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, sample, computeStats });
  return (
    <SimLayout title="Electromagnetic Induction" configName="induction" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      graph={<div><div className="text-xs text-muted-foreground mb-1">Induced EMF vs time</div><LiveGraph data={sim.graphData} series={[{ key: 'emf', color: '#22d3ee' }]} height={150} /></div>}
      exportBar={<ExportBar graphData={sim.graphData} config={params} canvasRef={canvasRef} name="induction" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Magnet oscillates through coil. EMF = −N dΦ/dt. Faster motion and more turns → larger EMF. The induced current direction reverses as the magnet passes through.</div>} />
  );
}