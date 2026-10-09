import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, LiveGraph, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

const schema = [
  { key: 'm1', label: 'Mass m₁', min: 10, max: 500, step: 10, type: 'range' },
  { key: 'm2', label: 'Mass m₂', min: 10, max: 500, step: 10, type: 'range' },
  { key: 'sep', label: 'Separation', min: 40, max: 200, step: 5, type: 'range' },
  { key: 'ecc', label: 'Eccentricity', min: 0, max: 0.8, step: 0.05, type: 'range' },
  { key: 'trails', label: 'Show trails', type: 'toggle' },
];

function makeInitial(p) {
  const M = p.m1 + p.m2;
  const r1 = p.sep * p.m2 / M; // distance of m1 from COM
  const r2 = p.sep * p.m1 / M;
  const v = Math.sqrt(M / p.sep); // circular orbit speed (relative)
  const v1 = v * p.m2 / M, v2 = v * p.m1 / M;
  // elliptical: scale velocity by sqrt(1+e) for perihelion start
  const vf = Math.sqrt(1 + p.ecc);
  return {
    bodies: [
      { x: -r1, y: 0, vx: 0, vy: -v1 * vf, m: p.m1, c: '#f97316', size: Math.cbrt(p.m1) * 2 },
      { x: r2, y: 0, vx: 0, vy: v2 * vf, m: p.m2, c: '#22d3ee', size: Math.cbrt(p.m2) * 2 },
    ],
    trail: [],
  };
}

function accel(bodies) {
  const a = bodies.map(() => [0, 0]);
  for (let i = 0; i < bodies.length; i++) {
    for (let j = 0; j < bodies.length; j++) {
      if (i === j) continue;
      const dx = bodies[j].x - bodies[i].x, dy = bodies[j].y - bodies[i].y;
      const r2 = dx * dx + dy * dy + 0.5;
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
  if (s.trail.length > 500) s.trail.shift();
}

function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const cx = w / 2, cy = h / 2;
  // COM
  const M = p.m1 + p.m2;
  const comx = (s.bodies[0].x * p.m1 + s.bodies[1].x * p.m2) / M;
  const comy = (s.bodies[0].y * p.m1 + s.bodies[1].y * p.m2) / M;
  // trails
  for (let bi = 0; bi < 2; bi++) {
    ctx.strokeStyle = s.bodies[bi].c + '55'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let fi = 0; fi < s.trail.length; fi++) {
      const pt = s.trail[fi][bi]; if (!pt) continue;
      const x = cx + pt[0], y = cy + pt[1];
      if (fi === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // COM marker
  ctx.fillStyle = '#ffffff44'; ctx.beginPath(); ctx.arc(cx + comx, cy + comy, 2, 0, Math.PI * 2); ctx.fill();
  // bodies
  for (const b of s.bodies) {
    const x = cx + b.x, y = cy + b.y;
    ctx.fillStyle = b.c; ctx.beginPath(); ctx.arc(x, y, b.size, 0, Math.PI * 2); ctx.fill();
  }
}

function sample(s, p) {
  const M = p.m1 + p.m2;
  let KE = 0, PE = 0;
  for (const b of s.bodies) KE += 0.5 * b.m * (b.vx * b.vx + b.vy * b.vy);
  const dx = s.bodies[1].x - s.bodies[0].x, dy = s.bodies[1].y - s.bodies[0].y;
  const r = Math.sqrt(dx * dx + dy * dy + 0.5);
  PE = -p.m1 * p.m2 / r;
  return { E: +(KE + PE).toFixed(2), r: +r.toFixed(1) };
}

function computeStats(s, p) {
  const d = sample(s, p);
  const T = 2 * Math.PI * Math.sqrt(Math.pow(p.sep, 3) / (p.m1 + p.m2));
  return { 'm₁': p.m1, 'm₂': p.m2, 'q': (Math.min(p.m1, p.m2) / Math.max(p.m1, p.m2)).toFixed(2), 'T': T.toFixed(1), 'E': d.E };
}

export default function BinaryStarsSim() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ m1: 200, m2: 200, sep: 100, ecc: 0, trails: true });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, sample, computeStats, resetKey: `${params.m1}|${params.m2}|${params.sep}|${params.ecc}` });
  return (
    <SimLayout title="Binary Stars" configName="binary-stars" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      graph={<LiveGraph data={sim.graphData} xKey="t" series={[{ key: 'E', color: '#22d3ee' }, { key: 'r', color: '#f97316' }]} />}
      exportBar={<ExportBar graphData={sim.graphData} config={params} canvasRef={canvasRef} name="binary-stars" />} />
  );
}