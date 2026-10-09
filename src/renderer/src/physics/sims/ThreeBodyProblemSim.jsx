import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, LiveGraph, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

const schema = [
  { key: 'preset', label: 'Preset', type: 'select', options: [
    { value: 'figure8', label: 'Figure-8 (stable)' },
    { value: 'chaos', label: 'Chaotic (generic)' },
    { value: 'lagrange', label: 'Lagrange triangle' },
  ] },
  { key: 'perturbation', label: 'Perturbation', min: 0, max: 0.1, step: 0.001, type: 'range' },
  { key: 'trails', label: 'Show trails', type: 'toggle' },
];

function makeInitial(p) {
  const eps = p.perturbation;
  if (p.preset === 'figure8') {
    return { bodies: [
      { x: -0.97000436, y: 0.24308753, vx: 0.466203685 + eps, vy: 0.43236573, m: 1, c: '#22d3ee' },
      { x: 0.97000436, y: -0.24308753, vx: 0.466203685, vy: 0.43236573, m: 1, c: '#f97316' },
      { x: 0, y: 0, vx: -0.93240737, vy: -0.86473146, m: 1, c: '#a855f7' },
    ], trail: [], scale: 120 };
  }
  if (p.preset === 'lagrange') {
    const r = 1, v = 0.57735;
    return { bodies: [
      { x: r, y: 0, vx: 0, vy: v, m: 1, c: '#22d3ee' },
      { x: r * Math.cos(2.094), y: r * Math.sin(2.094), vx: v * Math.cos(2.094 + 1.571), vy: v * Math.sin(2.094 + 1.571), m: 1, c: '#f97316' },
      { x: r * Math.cos(4.189), y: r * Math.sin(4.189), vx: v * Math.cos(4.189 + 1.571), vy: v * Math.sin(4.189 + 1.571), m: 1, c: '#a855f7' },
    ], trail: [], scale: 120 };
  }
  return { bodies: [
    { x: -1, y: 0, vx: 0, vy: -0.4 + eps, m: 1, c: '#22d3ee' },
    { x: 1, y: 0, vx: 0, vy: 0.4, m: 1, c: '#f97316' },
    { x: 0, y: 1, vx: -0.5, vy: 0, m: 1, c: '#a855f7' },
  ], trail: [], scale: 120 };
}

function accel(bodies) {
  const a = bodies.map(() => [0, 0]);
  for (let i = 0; i < bodies.length; i++) {
    for (let j = 0; j < bodies.length; j++) {
      if (i === j) continue;
      const dx = bodies[j].x - bodies[i].x, dy = bodies[j].y - bodies[i].y;
      const r2 = dx * dx + dy * dy + 0.001;
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
  s.trail.push(b.map((bd) => [bd.x, bd.y]));
  if (s.trail.length > 600) s.trail.shift();
}

function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const cx = w / 2, cy = h / 2;
  const sc = s.scale || 120;
  // trails
  for (let bi = 0; bi < s.bodies.length; bi++) {
    ctx.strokeStyle = s.bodies[bi].c + '55'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let fi = 0; fi < s.trail.length; fi++) {
      const pt = s.trail[fi][bi]; if (!pt) continue;
      const x = cx + pt[0] * sc, y = cy + pt[1] * sc;
      if (fi === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // bodies
  for (const b of s.bodies) {
    const x = cx + b.x * sc, y = cy + b.y * sc;
    ctx.fillStyle = b.c; ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
  }
}

function sample(s) {
  let KE = 0, PE = 0;
  for (const b of s.bodies) KE += 0.5 * b.m * (b.vx * b.vx + b.vy * b.vy);
  for (let i = 0; i < s.bodies.length; i++) for (let j = i + 1; j < s.bodies.length; j++) {
    const dx = s.bodies[j].x - s.bodies[i].x, dy = s.bodies[j].y - s.bodies[i].y;
    PE -= s.bodies[i].m * s.bodies[j].m / Math.sqrt(dx * dx + dy * dy + 0.001);
  }
  return { E: +(KE + PE).toFixed(4) };
}

function computeStats(s) {
  return { 'E': sample(s).E, 'Bodies': 3, 'Integrator': 'Verlet' };
}

export default function ThreeBodyProblemSim() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ preset: 'figure8', perturbation: 0, trails: true });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, sample, computeStats, resetKey: `${params.preset}|${params.perturbation}` });
  return (
    <SimLayout title="Three-Body Problem" configName="three-body" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      graph={<LiveGraph data={sim.graphData} xKey="t" series={[{ key: 'E', color: '#22d3ee' }]} />}
      exportBar={<ExportBar graphData={sim.graphData} config={params} canvasRef={canvasRef} name="three-body" />} />
  );
}