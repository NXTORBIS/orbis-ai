import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, LiveGraph, StatGrid, ExportBar, SimLayout, CameraControls, stageBg } from '../ui.jsx';

const schema = [
  { key: 'preset', label: 'Preset', type: 'select', options: [{ value: 'solar', label: 'Solar system' }, { value: 'figure8', label: 'Three-body figure-8' }, { value: 'binary', label: 'Binary star' }, { value: 'chaos', label: 'Three-body chaos' }] },
  { key: 'G', label: 'G', min: 0.1, max: 5, step: 0.05, type: 'range' },
  { key: 'softening', label: 'Softening ε', min: 0.001, max: 0.2, step: 0.001, type: 'range' },
  { key: 'trails', label: 'Show trails', type: 'toggle' },
];

function makeInitial(p) {
  const G = p.G;
  if (p.preset === 'solar') {
    const sun = { x: 0, y: 0, vx: 0, vy: 0, m: 1000, c: '#f97316' };
    const planets = [{ r: 80, m: 1, c: '#22d3ee' }, { r: 130, m: 1.5, c: '#84cc16' }, { r: 190, m: 2, c: '#a855f7' }, { r: 260, m: 1, c: '#ec4899' }];
    const bodies = [sun, ...planets.map((pl) => ({ x: pl.r, y: 0, vx: 0, vy: Math.sqrt(G * sun.m / pl.r), m: pl.m, c: pl.c }))];
    return { bodies, trail: [] };
  }
  if (p.preset === 'figure8') {
    return { bodies: [
      { x: -0.97000436, y: 0.24308753, vx: 0.466203685, vy: 0.43236573, m: 1, c: '#22d3ee' },
      { x: 0.97000436, y: -0.24308753, vx: 0.466203685, vy: 0.43236573, m: 1, c: '#f97316' },
      { x: 0, y: 0, vx: -0.93240737, vy: -0.86473146, m: 1, c: '#a855f7' },
    ], trail: [], scale: 120 };
  }
  if (p.preset === 'binary') {
    return { bodies: [{ x: -40, y: 0, vx: 0, vy: -1.2, m: 200, c: '#f97316' }, { x: 40, y: 0, vx: 0, vy: 1.2, m: 200, c: '#22d3ee' }], trail: [] };
  }
  return { bodies: [{ x: -60, y: 0, vx: 0, vy: -0.8, m: 50, c: '#22d3ee' }, { x: 60, y: 0, vx: 0, vy: 0.8, m: 50, c: '#f97316' }, { x: 0, y: 80, vx: -1.1, vy: 0, m: 50, c: '#a855f7' }], trail: [] };
}
function accel(bodies, G, eps) {
  const a = bodies.map(() => [0, 0]);
  for (let i = 0; i < bodies.length; i++) for (let j = 0; j < bodies.length; j++) {
    if (i === j) continue; const dx = bodies[j].x - bodies[i].x, dy = bodies[j].y - bodies[i].y; const r2 = dx * dx + dy * dy + eps * eps; const inv = G * bodies[j].m / (r2 * Math.sqrt(r2)); a[i][0] += inv * dx; a[i][1] += inv * dy;
  }
  return a;
}
function step(s, dt, p) {
  const b = s.bodies; const a0 = accel(b, p.G, p.softening);
  for (let i = 0; i < b.length; i++) { b[i].x += b[i].vx * dt + 0.5 * a0[i][0] * dt * dt; b[i].y += b[i].vy * dt + 0.5 * a0[i][1] * dt * dt; }
  const a1 = accel(b, p.G, p.softening);
  for (let i = 0; i < b.length; i++) { b[i].vx += 0.5 * (a0[i][0] + a1[i][0]) * dt; b[i].vy += 0.5 * (a0[i][1] + a1[i][1]) * dt; }
  if (p.trails) { s.trail.push(b.map((bd) => [bd.x, bd.y])); if (s.trail.length > 400) s.trail.shift(); }
}
function bodyScreen(b, s, w, h) {
  const sc = s.scale || Math.min(w, h) * 0.16;
  const factor = s.scale ? sc * 0.3 : 1;
  return { x: w / 2 + b.x * factor, y: h / 2 + b.y * factor };
}
function draw(ctx, s, p, w, h, t, cam) {
  stageBg(ctx, w, h);
  const cx = w / 2, cy = h / 2;
  const sc = s.scale || Math.min(w, h) * 0.16;
  const factor = s.scale ? sc * 0.3 : 1;
  ctx.save();
  if (cam) ctx.translate(-cam.x, -cam.y);
  if (p.trails) {
    ctx.strokeStyle = '#22d3ee55'; ctx.lineWidth = 1;
    for (const fr of s.trail) {
      ctx.beginPath();
      for (let i = 0; i < fr.length; i++) { const x = cx + fr[i][0] * factor, y = cy + fr[i][1] * factor; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.stroke();
    }
  }
  for (const b of s.bodies) { const pos = bodyScreen(b, s, w, h); ctx.fillStyle = b.c; ctx.beginPath(); ctx.arc(pos.x, pos.y, Math.max(3, Math.cbrt(b.m) * 1.6), 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}
function sample(s, p) {
  let KE = 0, PE = 0, Lz = 0;
  for (const b of s.bodies) KE += 0.5 * b.m * (b.vx * b.vx + b.vy * b.vy);
  for (let i = 0; i < s.bodies.length; i++) for (let j = i + 1; j < s.bodies.length; j++) { const dx = s.bodies[j].x - s.bodies[i].x, dy = s.bodies[j].y - s.bodies[i].y; const r = Math.sqrt(dx * dx + dy * dy + p.softening * p.softening); PE -= p.G * s.bodies[i].m * s.bodies[j].m / r; }
  for (const b of s.bodies) Lz += b.m * (b.x * b.vy - b.y * b.vx);
  return { E: +(KE + PE).toFixed(2), L: +Lz.toFixed(2) };
}
function computeStats(s, p) { return { 'Bodies': s.bodies.length, '⟨E⟩': sample(s, p).E, 'L_z': sample(s, p).L, 'G': p.G.toFixed(2) }; }

export default function NBody() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ preset: 'solar', G: 1, softening: 0.05, trails: true });
  const [targetIndex, setTargetIndex] = useState(0); // 0 = Center of Mass, i = body i
  const bodyCount = makeInitial(params).bodies.length;
  const targets = ['Center of Mass', ...Array.from({ length: bodyCount }, (_, i) => `Body ${i + 1}`)];
  const camera = {
    mode: 'continuous',
    margin: 0.2,
    smoothing: 0.08,
    restEps: 0.5,
    threshold: 0.5,
    getFocus: (s, p, w, h) => {
      if (targetIndex === 0) {
        let M = 0, x = 0, y = 0;
        for (const b of s.bodies) { M += b.m; x += b.m * b.x; y += b.m * b.y; }
        return bodyScreen({ x: x / M, y: y / M }, s, w, h);
      }
      const b = s.bodies[targetIndex - 1] || s.bodies[0];
      return bodyScreen(b, s, w, h);
    },
    getVelocity: (s, p, w, h) => {
      const sc = s.scale || Math.min(w, h) * 0.16;
      const factor = s.scale ? sc * 0.3 : 1;
      if (targetIndex === 0) {
        let M = 0, vx = 0, vy = 0;
        for (const b of s.bodies) { M += b.m; vx += b.m * b.vx; vy += b.m * b.vy; }
        return { x: (vx / M) * factor, y: (vy / M) * factor };
      }
      const b = s.bodies[targetIndex - 1] || s.bodies[0];
      return { x: b.vx * factor, y: b.vy * factor };
    },
  };
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, sample, computeStats, resetKey: `${params.preset}|${params.G}|${params.softening}`, camera });
  return (
    <SimLayout title="N-Body Gravity (Solar · Three-Body)" configName="nbody" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<>
        <TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />
        <CameraControls cameraMode={sim.cameraMode} setCameraMode={sim.setCameraMode} onRecenter={sim.recenterCamera} enabled={sim.cameraEnabled} targets={targets} targetIndex={targetIndex} setTargetIndex={setTargetIndex} />
      </>}
      stats={<StatGrid stats={sim.stats} />}
      graph={<LiveGraph data={sim.graphData} xKey="t" series={[{ key: 'E', color: '#22d3ee' }, { key: 'L', color: '#f97316' }]} />}
      exportBar={<ExportBar graphData={sim.graphData} config={params} canvasRef={canvasRef} name="nbody" />} />
  );
}