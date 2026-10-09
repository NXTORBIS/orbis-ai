import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, LiveGraph, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

const schema = [
  { key: 'N', label: 'Planets', min: 2, max: 8, step: 1, type: 'range' },
  { key: 'perturb', label: 'Jupiter mass', min: 1, max: 50, step: 1, type: 'range' },
  { key: 'trails', label: 'Show trails', type: 'toggle' },
  { key: 'resonance', label: 'Resonance pair', type: 'toggle' },
];

function makeInitial(p) {
  const sun = { x: 0, y: 0, vx: 0, vy: 0, m: 1000, c: '#fde047', size: 8 };
  const planets = [{ x: 50, y: 0, vx: 0, vy: Math.sqrt(1000 / 50), m: 1, c: '#a8a29e', size: 3 }];
  if (p.N >= 2) planets.push({ x: 80, y: 0, vx: 0, vy: Math.sqrt(1000 / 80), m: 1, c: '#fbbf24', size: 3.5 });
  // Jupiter — the perturber
  if (p.N >= 3) planets.push({ x: 130, y: 0, vx: 0, vy: Math.sqrt(1000 / 130), m: p.perturb, c: '#f97316', size: 5 });
  if (p.N >= 4) planets.push({ x: 180, y: 0, vx: 0, vy: Math.sqrt(1000 / 180), m: 1, c: '#ef4444', size: 3 });
  // resonance pair: 2:1 mean-motion resonance
  if (p.resonance && p.N >= 5) {
    planets.push({ x: 230, y: 0, vx: 0, vy: Math.sqrt(1000 / 230) * 1.0, m: 1, c: '#a855f7', size: 3 });
    planets.push({ x: 365, y: 0, vx: 0, vy: Math.sqrt(1000 / 365) * 0.99, m: 1, c: '#22d3ee', size: 3 });
  } else if (p.N >= 5) {
    planets.push({ x: 230, y: 0, vx: 0, vy: Math.sqrt(1000 / 230), m: 1, c: '#a855f7', size: 3 });
  }
  if (p.N >= 6) planets.push({ x: 290, y: 0, vx: 0, vy: Math.sqrt(1000 / 290), m: 1, c: '#3b82f6', size: 3 });
  if (p.N >= 7) planets.push({ x: 340, y: 0, vx: 0, vy: Math.sqrt(1000 / 340), m: 1, c: '#14b8a6', size: 3 });
  if (p.N >= 8) planets.push({ x: 390, y: 0, vx: 0, vy: Math.sqrt(1000 / 390), m: 1, c: '#eab308', size: 3 });
  return { bodies: [sun, ...planets], trail: [] };
}

function accel(bodies) {
  const a = bodies.map(() => [0, 0]);
  for (let i = 0; i < bodies.length; i++) {
    for (let j = 0; j < bodies.length; j++) {
      if (i === j) continue;
      const dx = bodies[j].x - bodies[i].x, dy = bodies[j].y - bodies[i].y;
      const r2 = dx * dx + dy * dy + 1;
      const inv = bodies[j].m / (r2 * Math.sqrt(r2));
      a[i][0] += inv * dx; a[i][1] += inv * dy;
    }
  }
  return a;
}

function step(s, dt) {
  const b = s.bodies;
  const a0 = accel(b);
  for (let i = 0; i < b.length; i++) { b[i].x += b[i].vx * dt + 0.5 * a0[i][0] * dt * dt; b[i].y += b[i].vy * dt + 0.5 * a0[i][1] * dt * dt; }
  const a1 = accel(b);
  for (let i = 0; i < b.length; i++) { b[i].vx += 0.5 * (a0[i][0] + a1[i][0]) * dt; b[i].vy += 0.5 * (a0[i][1] + a1[i][1]) * dt; }
}

function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const cx = w / 2, cy = h / 2;
  for (const b of s.bodies) {
    const x = cx + b.x, y = cy + b.y;
    if (b.size > 5) {
      const grad = ctx.createRadialGradient(x, y, 0, x, y, b.size * 2);
      grad.addColorStop(0, b.c + 'aa'); grad.addColorStop(1, b.c + '00');
      ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(x, y, b.size * 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = b.c; ctx.beginPath(); ctx.arc(x, y, b.size, 0, Math.PI * 2); ctx.fill();
  }
}

function sample(s) {
  let KE = 0, PE = 0;
  for (const b of s.bodies) KE += 0.5 * b.m * (b.vx * b.vx + b.vy * b.vy);
  for (let i = 0; i < s.bodies.length; i++) for (let j = i + 1; j < s.bodies.length; j++) {
    const dx = s.bodies[j].x - s.bodies[i].x, dy = s.bodies[j].y - s.bodies[i].y;
    PE -= s.bodies[i].m * s.bodies[j].m / Math.sqrt(dx * dx + dy * dy + 1);
  }
  return { E: +(KE + PE).toFixed(2) };
}

function computeStats(s, p) {
  return { 'Planets': s.bodies.length - 1, 'Jupiter m': p.perturb, 'E': sample(s).E };
}

export default function PlanetaryOrbitsSim() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ N: 5, perturb: 10, trails: true, resonance: false });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, sample, computeStats, resetKey: `${params.N}|${params.perturb}|${params.resonance}` });
  return (
    <SimLayout title="Planetary Orbits (Stability & Perturbations)" configName="planetary-orbits" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      graph={<LiveGraph data={sim.graphData} xKey="t" series={[{ key: 'E', color: '#22d3ee' }]} />}
      exportBar={<ExportBar graphData={sim.graphData} config={params} canvasRef={canvasRef} name="planetary-orbits" />} />
  );
}