import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, LiveGraph, StatGrid, ExportBar, SimLayout, CameraControls, stageBg } from '../ui.jsx';

const schema = [
  { key: 'N', label: 'Number of bodies', min: 3, max: 20, step: 1, type: 'range' },
  { key: 'G', label: 'G', min: 0.1, max: 3, step: 0.1, type: 'range' },
  { key: 'softening', label: 'Softening ε', min: 0.01, max: 0.5, step: 0.01, type: 'range' },
  { key: 'trails', label: 'Show trails', type: 'toggle' },
];

function makeInitial(p) {
  const bodies = [];
  bodies.push({ x: 0, y: 0, vx: 0, vy: 0, m: 200, c: '#fde047' });
  for (let i = 1; i < p.N; i++) {
    const r = 60 + Math.random() * 120;
    const ang = Math.random() * 2 * Math.PI;
    const v = Math.sqrt((p.G * 200) / r) * (0.8 + Math.random() * 0.4);
    bodies.push({
      x: r * Math.cos(ang), y: r * Math.sin(ang),
      vx: -v * Math.sin(ang), vy: v * Math.cos(ang),
      m: 1 + Math.random() * 3,
      c: `hsl(${(i * 137) % 360}, 70%, 60%)`,
    });
  }
  return { bodies, trail: [] };
}

function accel(bodies, G, eps) {
  const a = bodies.map(() => [0, 0]);
  for (let i = 0; i < bodies.length; i++) {
    for (let j = 0; j < bodies.length; j++) {
      if (i === j) continue;
      const dx = bodies[j].x - bodies[i].x, dy = bodies[j].y - bodies[i].y;
      const r2 = dx * dx + dy * dy + eps * eps;
      const inv = G * bodies[j].m / (r2 * Math.sqrt(r2));
      a[i][0] += inv * dx; a[i][1] += inv * dy;
    }
  }
  return a;
}

function step(s, dt, p) {
  const b = s.bodies;
  const a0 = accel(b, p.G, p.softening);
  for (let i = 0; i < b.length; i++) { b[i].x += b[i].vx * dt + 0.5 * a0[i][0] * dt * dt; b[i].y += b[i].vy * dt + 0.5 * a0[i][1] * dt * dt; }
  const a1 = accel(b, p.G, p.softening);
  for (let i = 0; i < b.length; i++) { b[i].vx += 0.5 * (a0[i][0] + a1[i][0]) * dt; b[i].vy += 0.5 * (a0[i][1] + a1[i][1]) * dt; }
  if (p.trails) { s.trail.push(b.map((bd) => [bd.x, bd.y])); if (s.trail.length > 300) s.trail.shift(); }
}

function draw(ctx, s, p, w, h, t, cam) {
  stageBg(ctx, w, h);
  const cx = w / 2, cy = h / 2;
  ctx.save();
  if (cam) ctx.translate(-cam.x, -cam.y);
  if (p.trails) {
    for (const fr of s.trail) {
      for (let i = 0; i < fr.length; i++) {
        ctx.fillStyle = s.bodies[i]?.c + '33' || '#22d3ee33';
        ctx.fillRect(cx + fr[i][0], cy + fr[i][1], 1, 1);
      }
    }
  }
  for (const b of s.bodies) {
    ctx.fillStyle = b.c;
    ctx.beginPath(); ctx.arc(cx + b.x, cy + b.y, Math.max(2, Math.cbrt(b.m) * 1.5), 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function sample(s, p) {
  let KE = 0, PE = 0;
  for (const b of s.bodies) KE += 0.5 * b.m * (b.vx * b.vx + b.vy * b.vy);
  for (let i = 0; i < s.bodies.length; i++) for (let j = i + 1; j < s.bodies.length; j++) {
    const dx = s.bodies[j].x - s.bodies[i].x, dy = s.bodies[j].y - s.bodies[i].y;
    PE -= p.G * s.bodies[i].m * s.bodies[j].m / Math.sqrt(dx * dx + dy * dy + p.softening * p.softening);
  }
  return { E: +(KE + PE).toFixed(2), KE: +KE.toFixed(2), PE: +PE.toFixed(2) };
}

function computeStats(s, p) {
  return { 'N': s.bodies.length, 'E': sample(s, p).E, 'KE': sample(s, p).KE, 'PE': sample(s, p).PE };
}

export default function NBodyGravitySim() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ N: 8, G: 1, softening: 0.1, trails: true });
  const [targetIndex, setTargetIndex] = useState(0); // 0 = Center of Mass, i = body i (1-based)
  const targets = ['Center of Mass', ...Array.from({ length: params.N }, (_, i) => `Body ${i + 1}`)];
  const camera = {
    mode: 'continuous',
    margin: 0.2,
    smoothing: 0.08,
    restEps: 0.5,
    threshold: 0.5,
    getFocus: (s, p, w, h) => {
      const cx = w / 2, cy = h / 2;
      if (targetIndex === 0) {
        let M = 0, x = 0, y = 0;
        for (const b of s.bodies) { M += b.m; x += b.m * b.x; y += b.m * b.y; }
        return { x: cx + x / M, y: cy + y / M };
      }
      const b = s.bodies[targetIndex - 1] || s.bodies[0];
      return { x: cx + b.x, y: cy + b.y };
    },
    getVelocity: (s, p, w, h) => {
      if (targetIndex === 0) {
        let M = 0, vx = 0, vy = 0;
        for (const b of s.bodies) { M += b.m; vx += b.m * b.vx; vy += b.m * b.vy; }
        return { x: vx / M, y: vy / M };
      }
      const b = s.bodies[targetIndex - 1] || s.bodies[0];
      return { x: b.vx, y: b.vy };
    },
  };
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, sample, computeStats, resetKey: `${params.N}|${params.G}|${params.softening}`, camera });
  return (
    <SimLayout title="N-Body Gravity (Velocity-Verlet)" configName="nbody-gravity" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<>
        <TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />
        <CameraControls cameraMode={sim.cameraMode} setCameraMode={sim.setCameraMode} onRecenter={sim.recenterCamera} enabled={sim.cameraEnabled} targets={targets} targetIndex={targetIndex} setTargetIndex={setTargetIndex} />
      </>}
      stats={<StatGrid stats={sim.stats} />}
      graph={<LiveGraph data={sim.graphData} xKey="t" series={[{ key: 'E', color: '#22d3ee' }, { key: 'KE', color: '#84cc16' }, { key: 'PE', color: '#f97316' }]} />}
      exportBar={<ExportBar graphData={sim.graphData} config={params} canvasRef={canvasRef} name="nbody-gravity" />} />
  );
}