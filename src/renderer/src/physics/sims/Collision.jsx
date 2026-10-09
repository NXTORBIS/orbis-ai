import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, LiveGraph, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

const schema = [
  { key: 'm1', label: 'Mass m1 (kg)', min: 0.1, max: 10, step: 0.1, type: 'range' },
  { key: 'm2', label: 'Mass m2 (kg)', min: 0.1, max: 10, step: 0.1, type: 'range' },
  { key: 'u1', label: 'Initial v1 (m/s)', min: -10, max: 10, step: 0.1, type: 'range' },
  { key: 'u2', label: 'Initial v2 (m/s)', min: -10, max: 10, step: 0.1, type: 'range' },
  { key: 'e', label: 'Restitution e', min: 0, max: 1, step: 0.01, type: 'range' },
];

const R1 = 22, R2 = 22, XMIN = 40, XMAX = 760; // world units before scale
function makeInitial(p) { return { x1: 150, x2: 600, v1: p.u1, v2: p.u2, hit: false, hits: 0 }; }
function step(s, dt, p) {
  s.x1 += s.v1 * dt; s.x2 += s.v2 * dt;
  // walls
  if (s.x1 < XMIN + R1) { s.x1 = XMIN + R1; s.v1 = Math.abs(s.v1); }
  if (s.x2 > XMAX - R2) { s.x2 = XMAX - R2; s.v2 = -Math.abs(s.v2); }
  if (s.x1 > s.x2 - R1 - R2) {
    // collide
    const m1 = p.m1, m2 = p.m2, u1 = s.v1, u2 = s.v2, e = p.e;
    s.v1 = (m1 * u1 + m2 * u2 - m2 * e * (u1 - u2)) / (m1 + m2);
    s.v2 = (m1 * u1 + m2 * u2 + m1 * e * (u1 - u2)) / (m1 + m2);
    s.x1 = s.x2 - R1 - R2 - 0.1; s.hits++;
  }
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const scale = w / (XMAX + 40);
  const cy = h / 2;
  // floor
  ctx.strokeStyle = 'hsl(var(--border))'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, cy + 40); ctx.lineTo(w, cy + 40); ctx.stroke();
  // walls
  ctx.strokeStyle = 'hsl(var(--muted-foreground))'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo((XMIN - 10) * scale, cy - 60); ctx.lineTo((XMIN - 10) * scale, cy + 40); ctx.stroke();
  ctx.beginPath(); ctx.moveTo((XMAX + 10) * scale, cy - 60); ctx.lineTo((XMAX + 10) * scale, cy + 40); ctx.stroke();
  // balls
  ctx.fillStyle = '#22d3ee'; ctx.beginPath(); ctx.arc(s.x1 * scale, cy, R1 * scale, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f97316'; ctx.beginPath(); ctx.arc(s.x2 * scale, cy, R2 * scale, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'white'; ctx.font = `${12 * scale}px monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(`${p.m1}`, s.x1 * scale, cy); ctx.fillText(`${p.m2}`, s.x2 * scale, cy);
  // velocity arrows
  ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(s.x1 * scale, cy - 40); ctx.lineTo(s.x1 * scale + s.v1 * 10, cy - 40); ctx.stroke();
  ctx.strokeStyle = '#f97316'; ctx.beginPath(); ctx.moveTo(s.x2 * scale, cy - 40); ctx.lineTo(s.x2 * scale + s.v2 * 10, cy - 40); ctx.stroke();
}
function sample(s, p) {
  const P = p.m1 * s.v1 + p.m2 * s.v2;
  const KE = 0.5 * p.m1 * s.v1 * s.v1 + 0.5 * p.m2 * s.v2 * s.v2;
  return { v1: +s.v1.toFixed(3), v2: +s.v2.toFixed(3), P: +P.toFixed(3), KE: +KE.toFixed(3) };
}
function computeStats(s, p) {
  const P = p.m1 * s.v1 + p.m2 * s.v2;
  const KE = 0.5 * p.m1 * s.v1 * s.v1 + 0.5 * p.m2 * s.v2 * s.v2;
  const KEi = 0.5 * p.m1 * p.u1 * p.u1 + 0.5 * p.m2 * p.u2 * p.u2;
  return { 'v1': s.v1.toFixed(2), 'v2': s.v2.toFixed(2), 'P (kg·m/s)': P.toFixed(2), 'KE (J)': KE.toFixed(2), 'KE lost %': (100 * (1 - KE / (KEi || 1))).toFixed(1), 'Hits': s.hits };
}

export default function Collision() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ m1: 2, m2: 1, u1: 4, u2: -2, e: 1 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, sample, computeStats, resetKey: `${params.m1}|${params.m2}|${params.u1}|${params.u2}|${params.e}` });
  const data = sim.graphData;
  return (
    <SimLayout title="1D Collision Simulator" configName="collision" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      graph={<LiveGraph data={data} xKey="t" series={[{ key: 'v1', color: '#22d3ee' }, { key: 'v2', color: '#f97316' }, { key: 'P', color: '#84cc16' }, { key: 'KE', color: '#a855f7' }]} />}
      exportBar={<ExportBar graphData={data} config={params} canvasRef={canvasRef} name="collision" />} />
  );
}