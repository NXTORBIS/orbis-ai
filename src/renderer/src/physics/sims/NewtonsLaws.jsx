import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, LiveGraph, StatGrid, ExportBar, SimLayout, CameraControls, stageBg } from '../ui.jsx';

// Newton's Laws — F=ma interactive with force diagrams.
// Unique focus: multiple forces on a block, net force, equilibrium, inertia.
const schema = [
  { key: 'm', label: 'Mass m (kg)', min: 0.5, max: 10, step: 0.1, type: 'range' },
  { key: 'Fapp', label: 'Applied force F (N)', min: -30, max: 30, step: 0.5, type: 'range' },
  { key: 'mu', label: 'Friction μ', min: 0, max: 1, step: 0.01, type: 'range' },
  { key: 'g', label: 'Gravity g (m/s²)', min: 0, max: 20, step: 0.1, type: 'range' },
];

function makeInitial(p) { return { x: 0, v: 0, t: 0 }; }
function step(s, dt, p, t) {
  const N = p.m * p.g;
  const fricMax = p.mu * N;
  let fric = 0;
  if (Math.abs(s.v) > 0.01) fric = -Math.sign(s.v) * Math.min(fricMax, Math.abs(p.mu * N * 100));
  else {
    fric = -Math.sign(p.Fapp) * Math.min(fricMax, Math.abs(p.Fapp));
    if (Math.abs(p.Fapp) <= fricMax) fric = -p.Fapp;
  }
  const Fnet = p.Fapp + fric;
  const a = Fnet / p.m;
  s.v += a * dt; s.x += s.v * dt; s.t += dt;
  s._fric = fric; s._Fnet = Fnet; s._a = a; s._N = N;
}
function draw(ctx, s, p, w, h, t, cam) {
  stageBg(ctx, w, h);
  const cy = h / 2;
  const scale = Math.min(w, h) / 20;
  const px = w / 2 + s.x * scale;
  ctx.save();
  if (cam) ctx.translate(-cam.x, -cam.y);
  // ground extended across the visible region so it never runs out
  const camX = cam ? cam.x : 0;
  const visL = camX - 40, visR = camX + w + 40;
  ctx.strokeStyle = 'hsl(var(--muted-foreground))'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(visL, cy + 30); ctx.lineTo(visR, cy + 30); ctx.stroke();
  for (let i = Math.floor(visL / 20) * 20; i <= visR; i += 20) { ctx.beginPath(); ctx.moveTo(i, cy + 30); ctx.lineTo(i + 10, cy + 40); ctx.stroke(); }
  // block
  const sz = 40 + p.m * 3;
  ctx.fillStyle = '#f97316'; ctx.fillRect(px - sz / 2, cy + 30 - sz, sz, sz);
  ctx.strokeStyle = '#f97316'; ctx.lineWidth = 1; ctx.strokeRect(px - sz / 2, cy + 30 - sz, sz, sz);
  // force arrows
  const arrowScale = 3;
  if (Math.abs(p.Fapp) > 0.1) {
    ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 3;
    const ay = cy + 30 - sz / 2;
    ctx.beginPath(); ctx.moveTo(px, ay); ctx.lineTo(px + p.Fapp * arrowScale, ay); ctx.stroke();
    const dir = Math.sign(p.Fapp);
    ctx.beginPath(); ctx.moveTo(px + p.Fapp * arrowScale, ay);
    ctx.lineTo(px + p.Fapp * arrowScale - dir * 10, ay - 6); ctx.moveTo(px + p.Fapp * arrowScale, ay);
    ctx.lineTo(px + p.Fapp * arrowScale - dir * 10, ay + 6); ctx.stroke();
    ctx.fillStyle = '#22d3ee'; ctx.font = '12px monospace'; ctx.fillText('F', px + p.Fapp * arrowScale + 5, ay - 5);
  }
  if (Math.abs(s._fric) > 0.1) {
    ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 3;
    const ay = cy + 30 - sz / 2 + 15;
    ctx.beginPath(); ctx.moveTo(px, ay); ctx.lineTo(px + s._fric * arrowScale, ay); ctx.stroke();
    const dir = Math.sign(s._fric);
    ctx.beginPath(); ctx.moveTo(px + s._fric * arrowScale, ay);
    ctx.lineTo(px + s._fric * arrowScale - dir * 10, ay - 6); ctx.moveTo(px + s._fric * arrowScale, ay);
    ctx.lineTo(px + s._fric * arrowScale - dir * 10, ay + 6); ctx.stroke();
    ctx.fillStyle = '#ef4444'; ctx.font = '12px monospace'; ctx.fillText('f', px + s._fric * arrowScale + 5, ay + 12);
  }
  if (Math.abs(s._Fnet) > 0.1) {
    ctx.strokeStyle = '#eab308'; ctx.lineWidth = 2;
    const ay = cy + 30 + 25;
    ctx.beginPath(); ctx.moveTo(px, ay); ctx.lineTo(px + s._Fnet * arrowScale * 0.7, ay); ctx.stroke();
    const dir = Math.sign(s._Fnet);
    ctx.beginPath(); ctx.moveTo(px + s._Fnet * arrowScale * 0.7, ay);
    ctx.lineTo(px + s._Fnet * arrowScale * 0.7 - dir * 8, ay - 5); ctx.moveTo(px + s._Fnet * arrowScale * 0.7, ay);
    ctx.lineTo(px + s._Fnet * arrowScale * 0.7 - dir * 8, ay + 5); ctx.stroke();
    ctx.fillStyle = '#eab308'; ctx.font = '11px monospace'; ctx.fillText('F_net', px + s._Fnet * arrowScale * 0.7 + 5, ay + 3);
  }
  ctx.restore();
}
function sample(s, p) {
  return { x: +s.x.toFixed(3), v: +s.v.toFixed(3), Fnet: +(s._Fnet || 0).toFixed(3), a: +(s._a || 0).toFixed(3) };
}
function computeStats(s, p) {
  const N = p.m * p.g;
  const fricMax = p.mu * N;
  const moving = Math.abs(s.v) > 0.01;
  const eq = !moving && Math.abs(p.Fapp) <= fricMax;
  return { 'F_net (N)': (s._Fnet || 0).toFixed(2), 'a (m/s²)': (s._a || 0).toFixed(3), 'v (m/s)': s.v.toFixed(3), 'N (N)': N.toFixed(2), 'f_max (N)': fricMax.toFixed(2), 'State': eq ? 'Equilibrium' : moving ? 'Moving' : 'Static' };
}

const camera = {
  mode: 'edge',
  margin: 0.2,
  smoothing: 0.08,
  restEps: 2,
  threshold: 0.5,
  getFocus: (s, p, w, h) => { const scale = Math.min(w, h) / 20; return { x: w / 2 + s.x * scale, y: h / 2 }; },
  getVelocity: (s, p, w, h) => { const scale = Math.min(w, h) / 20; return { x: s.v * scale, y: 0 }; },
};

export default function NewtonsLaws() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ m: 2, Fapp: 10, mu: 0.1, g: 9.81 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, sample, computeStats, resetKey: `${params.m}|${params.mu}|${params.g}`, camera });
  const data = sim.graphData;
  return (
    <SimLayout title="Newton's Laws — Force & Acceleration" configName="newtons-laws" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<>
        <TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />
        <CameraControls cameraMode={sim.cameraMode} setCameraMode={sim.setCameraMode} onRecenter={sim.recenterCamera} enabled={sim.cameraEnabled} />
      </>}
      stats={<StatGrid stats={sim.stats} />}
      graph={<LiveGraph data={data} xKey="t" series={[{ key: 'x', color: '#22d3ee' }, { key: 'v', color: '#f97316' }, { key: 'Fnet', color: '#eab308' }, { key: 'a', color: '#a855f7' }]} />}
      exportBar={<ExportBar graphData={data} config={params} canvasRef={canvasRef} name="newtons-laws" />} />
  );
}