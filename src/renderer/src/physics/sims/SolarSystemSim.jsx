import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, LiveGraph, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

const schema = [
  { key: 'G', label: 'G', min: 0.5, max: 3, step: 0.05, type: 'range' },
  { key: 'trails', label: 'Show trails', type: 'toggle' },
  { key: 'speedFactor', label: 'Orbit speed', min: 0.1, max: 3, step: 0.1, type: 'range' },
];

const PLANETS = [
  { name: 'Mercury', r: 50, m: 0.5, c: '#a8a29e', size: 2.5 },
  { name: 'Venus', r: 75, m: 0.8, c: '#fbbf24', size: 3.5 },
  { name: 'Earth', r: 105, m: 1, c: '#22d3ee', size: 4 },
  { name: 'Mars', r: 140, m: 0.6, c: '#ef4444', size: 3 },
  { name: 'Jupiter', r: 200, m: 5, c: '#f97316', size: 7 },
  { name: 'Saturn', r: 260, m: 4, c: '#eab308', size: 6 },
];

function makeInitial(p) {
  const sun = { x: 0, y: 0, vx: 0, vy: 0, m: 500, c: '#fde047', size: 10, name: 'Sun' };
  const bodies = [sun, ...PLANETS.map((pl) => ({
    x: pl.r, y: 0, vx: 0, vy: Math.sqrt(p.G * sun.m / pl.r) * p.speedFactor, m: pl.m, c: pl.c, size: pl.size, name: pl.name,
  }))];
  return { bodies, trail: [] };
}

function accel(bodies, G) {
  const a = bodies.map(() => [0, 0]);
  for (let i = 0; i < bodies.length; i++) {
    for (let j = 0; j < bodies.length; j++) {
      if (i === j) continue;
      const dx = bodies[j].x - bodies[i].x, dy = bodies[j].y - bodies[i].y;
      const r2 = dx * dx + dy * dy + 1;
      const inv = G * bodies[j].m / (r2 * Math.sqrt(r2));
      a[i][0] += inv * dx; a[i][1] += inv * dy;
    }
  }
  return a;
}

function step(s, dt, p) {
  const b = s.bodies;
  const a0 = accel(b, p.G);
  for (let i = 0; i < b.length; i++) { b[i].x += b[i].vx * dt + 0.5 * a0[i][0] * dt * dt; b[i].y += b[i].vy * dt + 0.5 * a0[i][1] * dt * dt; }
  const a1 = accel(b, p.G);
  for (let i = 0; i < b.length; i++) { b[i].vx += 0.5 * (a0[i][0] + a1[i][0]) * dt; b[i].vy += 0.5 * (a0[i][1] + a1[i][1]) * dt; }
  if (p.trails) {
    s.trail.push(b.slice(1).map((bd) => [bd.x, bd.y]));
    if (s.trail.length > 500) s.trail.shift();
  }
}

function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const cx = w / 2, cy = h / 2;
  if (p.trails) {
    for (let pi = 0; pi < PLANETS.length; pi++) {
      ctx.strokeStyle = PLANETS[pi].c + '44'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let fi = 0; fi < s.trail.length; fi++) {
        const pt = s.trail[fi][pi]; if (!pt) continue;
        const x = cx + pt[0], y = cy + pt[1];
        if (fi === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  for (const b of s.bodies) {
    const x = cx + b.x, y = cy + b.y;
    if (b.name === 'Sun') {
      const grad = ctx.createRadialGradient(x, y, 0, x, y, b.size * 2.5);
      grad.addColorStop(0, '#fef3c7'); grad.addColorStop(0.4, '#fde047'); grad.addColorStop(1, '#f9731600');
      ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(x, y, b.size * 2.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = b.c; ctx.beginPath(); ctx.arc(x, y, b.size, 0, Math.PI * 2); ctx.fill();
  }
}

function sample(s, p) {
  let KE = 0, PE = 0;
  for (const b of s.bodies) KE += 0.5 * b.m * (b.vx * b.vx + b.vy * b.vy);
  for (let i = 0; i < s.bodies.length; i++) for (let j = i + 1; j < s.bodies.length; j++) {
    const dx = s.bodies[j].x - s.bodies[i].x, dy = s.bodies[j].y - s.bodies[i].y;
    PE -= p.G * s.bodies[i].m * s.bodies[j].m / Math.sqrt(dx * dx + dy * dy + 1);
  }
  return { E: +(KE + PE).toFixed(2) };
}

function computeStats(s, p) {
  return { 'Planets': s.bodies.length - 1, 'G': p.G.toFixed(2), 'E': sample(s, p).E, 'Integrator': 'Verlet' };
}

export default function SolarSystemSim() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ G: 1, trails: true, speedFactor: 1 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, sample, computeStats, resetKey: `${params.G}|${params.speedFactor}` });
  return (
    <SimLayout title="Solar System Simulator" configName="solar-system" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      graph={<LiveGraph data={sim.graphData} xKey="t" series={[{ key: 'E', color: '#22d3ee' }]} />}
      exportBar={<ExportBar graphData={sim.graphData} config={params} canvasRef={canvasRef} name="solar-system" />} />
  );
}