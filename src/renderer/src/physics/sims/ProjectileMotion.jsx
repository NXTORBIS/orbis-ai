import React, { useEffect, useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, LiveGraph, StatGrid, ExportBar, SimLayout, CameraControls, stageBg } from '../ui.jsx';
import { rad } from '../lib/math.js';

const schema = [
  { key: 'v0', label: 'Initial speed (m/s)', min: 1, max: 80, step: 1, type: 'range' },
  { key: 'angle', label: 'Launch angle (°)', min: 0, max: 90, step: 1, type: 'range' },
  { key: 'g', label: 'Gravity (m/s²)', min: 0.1, max: 25, step: 0.01, type: 'range' },
  { key: 'height', label: 'Launch height (m)', min: 0, max: 60, step: 0.5, type: 'range' },
];

// Fixed scale: ~70 m visible across the canvas. The world is never compressed
// to fit the trajectory — the viewport follows the projectile instead.
const PAD = 34;
const VISIBLE_M = 70;
function projScale(w) { return (w - 2 * PAD) / VISIBLE_M; }

function makeInitial(p) {
  const a = rad(p.angle);
  return { x: 0, y: p.height, vx: p.v0 * Math.cos(a), vy: p.v0 * Math.sin(a), t: 0, trail: [], landed: false, maxX: 0, maxY: p.height };
}
function step(s, dt, p) {
  if (s.landed) return;
  s.vy -= p.g * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.t += dt;
  if (s.y > s.maxY) s.maxY = s.y;
  if (s.x > s.maxX) s.maxX = s.x;
  if (s.y <= 0) { s.y = 0; s.landed = true; }
  s.trail.push(s.x, s.y);
  if (s.trail.length > 4000) s.trail.splice(0, 2);
}
function draw(ctx, s, p, w, h, t, cam) {
  stageBg(ctx, w, h);
  const scale = projScale(w);
  const baseY = h - PAD;
  const X = (x) => PAD + x * scale;
  const Y = (y) => baseY - y * scale;
  ctx.save();
  if (cam) ctx.translate(-cam.x, -cam.y);
  // Grid + ground cover the visible world range (not just [0, spanX]) so they
  // remain correct as the viewport scrolls. Coordinate labels stay in metres.
  const camX = cam ? cam.x : 0;
  const visLeft = (camX - PAD) / scale;
  const visRight = (camX + w - PAD) / scale;
  const gridStep = Math.max(5, Math.round((visRight - visLeft) / 10));
  const gStart = Math.max(0, Math.floor(visLeft / gridStep) * gridStep);
  const gEnd = Math.ceil(visRight / gridStep) * gridStep;
  ctx.strokeStyle = 'hsl(var(--border))'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(X(gStart), baseY); ctx.lineTo(X(gEnd), baseY); ctx.stroke();
  ctx.strokeStyle = 'hsl(var(--border) / 0.25)'; ctx.lineWidth = 1;
  ctx.fillStyle = 'hsl(var(--muted-foreground))'; ctx.font = '11px monospace'; ctx.textAlign = 'center';
  for (let gx = gStart; gx <= gEnd; gx += gridStep) {
    ctx.beginPath(); ctx.moveTo(X(gx), PAD); ctx.lineTo(X(gx), baseY); ctx.stroke();
    ctx.fillText(`${gx} m`, X(gx), baseY + 16);
  }
  // Trail — stored in world coordinates, stays attached to the trajectory.
  ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < s.trail.length; i += 2) {
    const x = X(s.trail[i]), y = Y(s.trail[i]);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  // Predicted (analytic) dashed
  ctx.strokeStyle = 'hsl(var(--muted-foreground) / 0.5)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
  ctx.beginPath();
  const a = rad(p.angle), vx = p.v0 * Math.cos(a), vy = p.v0 * Math.sin(a);
  for (let tt = 0; tt <= 8; tt += 0.05) {
    const x = vx * tt, y = p.height + vy * tt - 0.5 * p.g * tt * tt;
    if (y < 0) break;
    if (tt === 0) ctx.moveTo(X(x), Y(y)); else ctx.lineTo(X(x), Y(y));
  }
  ctx.stroke(); ctx.setLineDash([]);
  // Ball
  ctx.fillStyle = '#f97316';
  ctx.beginPath(); ctx.arc(X(s.x), Y(s.y), 7, 0, Math.PI * 2); ctx.fill();
  // Velocity arrow
  ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(X(s.x), Y(s.y)); ctx.lineTo(X(s.x) + s.vx * scale * 0.3, Y(s.y) - s.vy * scale * 0.3); ctx.stroke();
  ctx.restore();
}
function sample(s) { return { t: +s.t.toFixed(3), x: +s.x.toFixed(2), y: +s.y.toFixed(2), vx: +s.vx.toFixed(2), vy: +s.vy.toFixed(2) }; }
function computeStats(s, p) {
  const a = rad(p.angle), vx = p.v0 * Math.cos(a), vy = p.v0 * Math.sin(a);
  const range = (vy * Math.abs(vy) + vx * Math.sqrt(vy * vy + 2 * p.g * p.height)) / p.g;
  const tFlight = (vy + Math.sqrt(vy * vy + 2 * p.g * p.height)) / p.g;
  const maxH = p.height + (vy * vy) / (2 * p.g);
  return { 'Range (m)': range.toFixed(2), 'Max H (m)': maxH.toFixed(2), 'Flight (s)': tFlight.toFixed(2), 'v_x': vx.toFixed(2), 'v_y (now)': s.vy.toFixed(2) };
}

const camera = {
  mode: 'edge',
  margin: 0.2,
  smoothing: 0.08,
  restEps: 3,
  threshold: 0.5,
  getFocus: (s, p, w, h) => { const scale = projScale(w); return { x: PAD + s.x * scale, y: (h - PAD) - s.y * scale }; },
  getVelocity: (s, p, w, h) => { const scale = projScale(w); if (s.landed) return { x: 0, y: 0 }; return { x: s.vx * scale, y: -s.vy * scale }; },
};

export default function ProjectileMotion() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ v0: 30, angle: 45, g: 9.81, height: 0 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, sample, computeStats, resetKey: `${params.v0}|${params.angle}|${params.g}|${params.height}`, camera });
  // Changing any launch parameter restarts the motion so the new trajectory is visible immediately.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    sim.recenterCamera();
    sim.setPlaying(true);
  }, [params.v0, params.angle, params.g, params.height]); // eslint-disable-line
  return (
    <SimLayout title="Projectile Motion" configName="projectile" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<>
        <TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />
        <CameraControls cameraMode={sim.cameraMode} setCameraMode={sim.setCameraMode} onRecenter={sim.recenterCamera} enabled={sim.cameraEnabled} />
      </>}
      stats={<StatGrid stats={sim.stats} />}
      graph={<LiveGraph data={sim.graphData} xKey="t" series={[{ key: 'x', color: '#22d3ee' }, { key: 'y', color: '#f97316' }]} />}
      exportBar={<ExportBar graphData={sim.graphData} config={params} canvasRef={canvasRef} name="projectile" />} />
  );
}