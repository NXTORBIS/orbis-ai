import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, LiveGraph, StatGrid, ExportBar, SimLayout, CameraControls, stageBg } from '../ui.jsx';

// Kinematics — 1D/2D motion: position, velocity, acceleration relationships.
// Unique focus: x(t), v(t), a(t) time series and motion diagrams, not just trajectories.
const schema = [
  { key: 'x0', label: 'Initial position x₀ (m)', min: -10, max: 10, step: 0.1, type: 'range' },
  { key: 'v0', label: 'Initial velocity v₀ (m/s)', min: -20, max: 20, step: 0.1, type: 'range' },
  { key: 'a', label: 'Acceleration a (m/s²)', min: -10, max: 10, step: 0.1, type: 'range' },
  { key: 'mode', label: 'Mode', type: 'select', options: [{ value: '1d', label: '1D Motion' }, { value: '2d', label: '2D Motion (angle)' }] },
  { key: 'angle', label: 'Launch angle θ (°)', min: 0, max: 90, step: 1, type: 'range' },
];

function makeInitial(p) {
  if (p.mode === '2d') {
    const rad = p.angle * Math.PI / 180;
    return { x: 0, y: 0, vx: p.v0 * Math.cos(rad), vy: p.v0 * Math.sin(rad), t: 0 };
  }
  return { x: p.x0, v: p.v0, t: 0 };
}
function step(s, dt, p, t) {
  if (p.mode === '2d') {
    s.vx += 0 * dt; s.vy += p.a * dt;
    s.x += s.vx * dt; s.y += s.vy * dt; s.t += dt;
  } else {
    s.v += p.a * dt; s.x += s.v * dt; s.t += dt;
  }
}
function draw(ctx, s, p, w, h, t, cam) {
  stageBg(ctx, w, h);
  ctx.save();
  if (cam) ctx.translate(-cam.x, -cam.y);
  if (p.mode === '2d') {
    const cx = 40, cy = h - 40;
    const sx = (w - 80) / 40, sy = (h - 80) / 30;
    // ground extended across visible area
    const camX = cam ? cam.x : 0;
    ctx.strokeStyle = 'hsl(var(--muted-foreground) / 0.3)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(camX - 40, cy); ctx.lineTo(camX + w + 40, cy); ctx.stroke();
    // trail
    ctx.strokeStyle = '#22d3ee44'; ctx.lineWidth = 2;
    ctx.beginPath();
    const steps = 200;
    for (let i = 0; i <= steps; i++) {
      const ti = (i / steps) * s.t;
      const rad = p.angle * Math.PI / 180;
      const xi = p.v0 * Math.cos(rad) * ti;
      const yi = p.v0 * Math.sin(rad) * ti + 0.5 * p.a * ti * ti;
      const px = cx + xi * sx, py = cy - yi * sy;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    const px = cx + s.x * sx, py = cy - s.y * sy;
    if (py < cy) {
      ctx.fillStyle = '#f97316';
      ctx.beginPath(); ctx.arc(px, py, 8, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + s.vx * 1.5, py - s.vy * 1.5); ctx.stroke();
    }
  } else {
    const cy = h / 2;
    const scale = Math.min(w, h) / 25;
    const px = w / 2 + s.x * scale;
    // axis extended across visible area
    const camX = cam ? cam.x : 0;
    ctx.strokeStyle = 'hsl(var(--muted-foreground) / 0.3)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(camX - 40, cy); ctx.lineTo(camX + w + 40, cy); ctx.stroke();
    // ruler ticks across a generous world range (canvas clips off-screen ones)
    for (let i = -100; i <= 100; i++) {
      const tx = w / 2 + i * scale;
      ctx.beginPath(); ctx.moveTo(tx, cy - 5); ctx.lineTo(tx, cy + 5); ctx.stroke();
    }
    // object
    ctx.fillStyle = '#f97316';
    ctx.beginPath(); ctx.arc(px, cy, 12, 0, Math.PI * 2); ctx.fill();
    if (Math.abs(s.v) > 0.1) {
      ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px, cy); ctx.lineTo(px + s.v * scale * 0.3, cy); ctx.stroke();
      const dir = Math.sign(s.v);
      ctx.beginPath(); ctx.moveTo(px + s.v * scale * 0.3, cy);
      ctx.lineTo(px + s.v * scale * 0.3 - dir * 8, cy - 5); ctx.moveTo(px + s.v * scale * 0.3, cy);
      ctx.lineTo(px + s.v * scale * 0.3 - dir * 8, cy + 5); ctx.stroke();
    }
    if (Math.abs(p.a) > 0.1) {
      ctx.strokeStyle = '#a855f7'; ctx.lineWidth = 2;
      const ay = cy + 30;
      ctx.beginPath(); ctx.moveTo(px, ay); ctx.lineTo(px + p.a * scale * 0.2, ay); ctx.stroke();
    }
  }
  ctx.restore();
}
function sample(s, p) {
  if (p.mode === '2d') {
    const speed = Math.hypot(s.vx, s.vy);
    return { x: +s.x.toFixed(3), y: +s.y.toFixed(3), vx: +s.vx.toFixed(3), vy: +s.vy.toFixed(3), speed: +speed.toFixed(3) };
  }
  return { x: +s.x.toFixed(3), v: +s.v.toFixed(3), a: +p.a.toFixed(3) };
}
function computeStats(s, p) {
  if (p.mode === '2d') {
    const speed = Math.hypot(s.vx, s.vy);
    return { 'x (m)': s.x.toFixed(2), 'y (m)': s.y.toFixed(2), 'vx (m/s)': s.vx.toFixed(2), 'vy (m/s)': s.vy.toFixed(2), '|v| (m/s)': speed.toFixed(2) };
  }
  return { 'x (m)': s.x.toFixed(3), 'v (m/s)': s.v.toFixed(3), 'a (m/s²)': p.a.toFixed(3), 't (s)': s.t.toFixed(2) };
}

export default function KinematicsSim() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ x0: 0, v0: 5, a: -2, mode: '1d', angle: 45 });
  const camera = {
    mode: 'edge', margin: 0.2, smoothing: 0.08, restEps: 2, threshold: 0.5,
    getFocus: (s, p, w, h) => {
      if (p.mode === '2d') {
        const cx = 40, cy = h - 40, sx = (w - 80) / 40, sy = (h - 80) / 30;
        return { x: cx + s.x * sx, y: cy - s.y * sy };
      }
      const scale = Math.min(w, h) / 25;
      return { x: w / 2 + s.x * scale, y: h / 2 };
    },
    getVelocity: (s, p, w, h) => {
      if (p.mode === '2d') {
        const sx = (w - 80) / 40, sy = (h - 80) / 30;
        return { x: s.vx * sx, y: -s.vy * sy };
      }
      const scale = Math.min(w, h) / 25;
      return { x: s.v * scale, y: 0 };
    },
  };
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, sample, computeStats, resetKey: `${params.mode}|${params.x0}|${params.v0}|${params.a}|${params.angle}`, camera });
  const data = sim.graphData;
  return (
    <SimLayout title="Kinematics — 1D/2D Motion" configName="kinematics" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<>
        <TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />
        <CameraControls cameraMode={sim.cameraMode} setCameraMode={sim.setCameraMode} onRecenter={sim.recenterCamera} enabled={sim.cameraEnabled} />
      </>}
      stats={<StatGrid stats={sim.stats} />}
      graph={<LiveGraph data={data} xKey="t" series={params.mode === '2d'
        ? [{ key: 'x', color: '#22d3ee' }, { key: 'y', color: '#f97316' }, { key: 'speed', color: '#84cc16' }]
        : [{ key: 'x', color: '#22d3ee' }, { key: 'v', color: '#f97316' }, { key: 'a', color: '#a855f7' }]} />}
      exportBar={<ExportBar graphData={data} config={params} canvasRef={canvasRef} name="kinematics" />} />
  );
}