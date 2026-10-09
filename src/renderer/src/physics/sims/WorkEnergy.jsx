import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, LiveGraph, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

// Work & Energy — work-energy theorem with KE/PE bars and conservation.
// Unique focus: work done by a force, energy transformation, conservation.
const schema = [
  { key: 'm', label: 'Mass m (kg)', min: 0.5, max: 10, step: 0.1, type: 'range' },
  { key: 'Fapp', label: 'Applied force F (N)', min: -20, max: 20, step: 0.5, type: 'range' },
  { key: 'v0', label: 'Initial velocity v₀ (m/s)', min: -10, max: 10, step: 0.1, type: 'range' },
  { key: 'x0', label: 'Initial position x₀ (m)', min: 0, max: 10, step: 0.1, type: 'range' },
  { key: 'g', label: 'Gravity g (m/s²)', min: 0, max: 20, step: 0.1, type: 'range' },
];

function makeInitial(p) { return { x: p.x0, v: p.v0, t: 0, W: 0 }; }
function step(s, dt, p, t) {
  const a = p.Fapp / p.m;
  const v0 = s.v;
  s.v += a * dt; s.x += s.v * dt; s.t += dt;
  // Work = F * dx (only applied force does work on the block)
  const dx = s.v * dt;
  s.W += p.Fapp * dx;
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const cy = h / 2;
  const scale = Math.min(w, h) / 25;
  const px = w / 2 + s.x * scale;
  // ground
  ctx.strokeStyle = 'hsl(var(--muted-foreground))'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, cy + 30); ctx.lineTo(w, cy + 30); ctx.stroke();
  // block
  const sz = 35 + p.m * 2;
  ctx.fillStyle = '#f97316'; ctx.fillRect(px - sz / 2, cy + 30 - sz, sz, sz);
  // force arrow
  if (Math.abs(p.Fapp) > 0.1) {
    ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(px, cy + 30 - sz / 2); ctx.lineTo(px + p.Fapp * 3, cy + 30 - sz / 2); ctx.stroke();
  }
  // energy bars (right side)
  const KE = 0.5 * p.m * s.v * s.v;
  const h0 = p.x0; // reference height for PE (using x as "height" proxy for visual)
  const PE = p.m * p.g * Math.max(0, s.x);
  const Etotal = KE + PE;
  const maxE = Math.max(0.5 * p.m * 100, p.m * p.g * 20, 1);
  const barW = 40, barX = w - 180;
  const drawBar = (label, val, color, yOff) => {
    const bh = (val / maxE) * (h * 0.4);
    const by = h - 40 - bh;
    ctx.fillStyle = color; ctx.fillRect(barX + yOff, by, barW, bh);
    ctx.strokeStyle = 'hsl(var(--muted-foreground) / 0.3)'; ctx.lineWidth = 1;
    ctx.strokeRect(barX + yOff, h - 40 - h * 0.4, barW, h * 0.4);
    ctx.fillStyle = color; ctx.font = '11px monospace'; ctx.fillText(label, barX + yOff, h - 25);
    ctx.fillText(val.toFixed(1), barX + yOff, h - 12);
  };
  drawBar('KE', KE, '#22d3ee', 0);
  drawBar('PE', PE, '#a855f7', 55);
  drawBar('Total', Etotal, '#84cc16', 110);
}
function sample(s, p) {
  const KE = 0.5 * p.m * s.v * s.v;
  const PE = p.m * p.g * Math.max(0, s.x);
  return { KE: +KE.toFixed(3), PE: +PE.toFixed(3), E: +(KE + PE).toFixed(3), W: +s.W.toFixed(3), v: +s.v.toFixed(3) };
}
function computeStats(s, p) {
  const KE = 0.5 * p.m * s.v * s.v;
  const PE = p.m * p.g * Math.max(0, s.x);
  const E = KE + PE;
  const power = p.Fapp * s.v;
  return { 'KE (J)': KE.toFixed(3), 'PE (J)': PE.toFixed(3), 'E_total (J)': E.toFixed(3), 'W (J)': s.W.toFixed(3), 'P (W)': power.toFixed(3), 'v (m/s)': s.v.toFixed(3) };
}

export default function WorkEnergy() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ m: 2, Fapp: 5, v0: 0, x0: 0, g: 9.81 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, sample, computeStats, resetKey: `${params.m}|${params.v0}|${params.x0}|${params.g}` });
  const data = sim.graphData;
  return (
    <SimLayout title="Work & Energy — Conservation Theorem" configName="work-energy" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      graph={<LiveGraph data={data} xKey="t" series={[{ key: 'KE', color: '#22d3ee' }, { key: 'PE', color: '#a855f7' }, { key: 'E', color: '#84cc16' }, { key: 'W', color: '#eab308' }]} />}
      exportBar={<ExportBar graphData={data} config={params} canvasRef={canvasRef} name="work-energy" />} />
  );
}