import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, LiveGraph, StatGrid, ExportBar, SimLayout, CameraControls, stageBg } from '../ui.jsx';

// Friction & Inclined Planes — block on a slope with static/kinetic friction.
// Unique focus: gravity decomposition, normal force, friction regimes on inclines.
const schema = [
  { key: 'angle', label: 'Incline angle θ (°)', min: 0, max: 60, step: 0.5, type: 'range' },
  { key: 'm', label: 'Mass m (kg)', min: 0.5, max: 10, step: 0.1, type: 'range' },
  { key: 'mus', label: 'Static μ_s', min: 0, max: 1.5, step: 0.01, type: 'range' },
  { key: 'muk', label: 'Kinetic μ_k', min: 0, max: 1.5, step: 0.01, type: 'range' },
  { key: 'g', label: 'Gravity g (m/s²)', min: 0, max: 20, step: 0.1, type: 'range' },
];

function makeInitial(p) { return { s: 0, v: 0, t: 0 }; }
function step(s, dt, p, t) {
  const rad = p.angle * Math.PI / 180;
  const Fg = p.m * p.g;
  const Fpar = Fg * Math.sin(rad);
  const Fperp = Fg * Math.cos(rad);
  const N = Fperp;
  const fricMaxS = p.mus * N;
  const fricMaxK = p.muk * N;
  let fric = 0;
  if (Math.abs(s.v) > 0.01) {
    fric = -Math.sign(s.v) * fricMaxK;
  } else {
    if (Fpar > fricMaxS) fric = -fricMaxS;
    else fric = -Fpar;
  }
  const Fnet = Fpar + fric;
  const a = Fnet / p.m;
  s.v += a * dt; s.s += s.v * dt; s.t += dt;
  s._N = N; s._fric = fric; s._Fpar = Fpar; s._Fnet = Fnet; s._a = a;
}
function draw(ctx, s, p, w, h, t, cam) {
  stageBg(ctx, w, h);
  const rad = p.angle * Math.PI / 180;
  const cx = w / 2, cy = h * 0.62;
  const rampLen = Math.max(w, h) * 1.5; // long enough to stay visible as camera scrolls
  ctx.save();
  if (cam) ctx.translate(-cam.x, -cam.y);
  // Inclined plane — filled right-triangle (ramp body)
  // Slope rises to the right; bottom-left = base of slope, top-right = apex.
  const baseX = cx - rampLen * Math.cos(rad);   // bottom-left  (low end)
  const baseY = cy + rampLen * Math.sin(rad);    // ground level at base
  const apexX = cx + rampLen * Math.cos(rad);    // top-right    (high end)
  const apexY = cy - rampLen * Math.sin(rad);
  const cornerX = apexX;                          // right-angle corner (below apex, at ground)
  const cornerY = baseY;
  ctx.fillStyle = 'rgba(51, 65, 85, 0.55)';  // slate-700 fill — clearly visible ramp body
  ctx.beginPath();
  ctx.moveTo(baseX, baseY);
  ctx.lineTo(cornerX, cornerY);
  ctx.lineTo(apexX, apexY);
  ctx.closePath();
  ctx.fill();
  // slope surface (hypotenuse) — bright thick edge so it stays visible as camera scrolls
  ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(baseX, baseY); ctx.lineTo(apexX, apexY); ctx.stroke();
  // ground line
  ctx.strokeStyle = '#64748b'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(baseX - rampLen, baseY); ctx.lineTo(apexX + rampLen, baseY); ctx.stroke();
  // hatch the vertical wall for a "solid" look
  ctx.strokeStyle = 'hsl(var(--muted-foreground) / 0.3)'; ctx.lineWidth = 1;
  for (let yy = cornerY; yy > apexY; yy -= 12) { ctx.beginPath(); ctx.moveTo(cornerX, yy); ctx.lineTo(cornerX + 8, yy + 8); ctx.stroke(); }
  // block — slides DOWN the incline (positive s → toward bottom-left)
  const blockPos = s.s * 15;
  const bx = cx - blockPos * Math.cos(rad);  // down = left
  const by = cy + blockPos * Math.sin(rad);  // down = lower on screen
  const sz = 28 + p.m * 2;
  ctx.save();
  ctx.translate(bx, by);
  ctx.rotate(-rad);
  ctx.translate(0, -sz / 2);                  // sit on top of the slope surface
  ctx.fillStyle = '#f97316'; ctx.fillRect(-sz / 2, -sz / 2, sz, sz);
  ctx.strokeStyle = '#fb923c'; ctx.lineWidth = 1.5; ctx.strokeRect(-sz / 2, -sz / 2, sz, sz);
  ctx.restore();
  // force arrows from block centre
  const aScale = 0.12;
  const ox = bx, oy = by - sz / 2;
  // gravity (down)
  ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 2;
  arrow(ctx, ox, oy, ox, oy + p.m * p.g * aScale);
  // normal (perpendicular to slope, away from surface)
  ctx.strokeStyle = '#22d3ee';
  const Nnx = -Math.sin(rad), Nny = -Math.cos(rad);
  arrow(ctx, ox, oy, ox + Nnx * s._N * aScale, oy + Nny * s._N * aScale);
  // friction (along slope, opposing motion)
  ctx.strokeStyle = '#ef4444';
  const Fdx = -Math.cos(rad), Fdy = Math.sin(rad); // down-slope direction
  arrow(ctx, ox, oy, ox + Fdx * s._fric * aScale, oy + Fdy * s._fric * aScale);
  ctx.restore();
}
function arrow(ctx, x1, y1, x2, y2) {
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  const ang = Math.atan2(y2 - y1, x2 - x1), hl = 7;
  ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - hl * Math.cos(ang - 0.4), y2 - hl * Math.sin(ang - 0.4)); ctx.lineTo(x2 - hl * Math.cos(ang + 0.4), y2 - hl * Math.sin(ang + 0.4)); ctx.closePath(); ctx.fill();
}
function sample(s, p) {
  return { s: +s.s.toFixed(3), v: +s.v.toFixed(3), Fnet: +(s._Fnet || 0).toFixed(3), a: +(s._a || 0).toFixed(3) };
}
function computeStats(s, p) {
  const rad = p.angle * Math.PI / 180;
  const Fpar = p.m * p.g * Math.sin(rad);
  const fricMaxS = p.mus * p.m * p.g * Math.cos(rad);
  const sliding = Math.abs(s.v) > 0.01 || Fpar > fricMaxS;
  return { 'N (N)': (s._N || 0).toFixed(2), 'F_∥ (N)': (s._Fpar || 0).toFixed(2), 'f (N)': (s._fric || 0).toFixed(2), 'F_net (N)': (s._Fnet || 0).toFixed(2), 'a (m/s²)': (s._a || 0).toFixed(3), 'State': sliding ? 'Sliding' : 'At rest' };
}

const camera = {
  mode: 'follow-until-stop',
  margin: 0.2,
  smoothing: 0.08,
  restEps: 2,
  restFrames: 30,
  threshold: 0.5,
  getFocus: (s, p, w, h) => {
    const rad = p.angle * Math.PI / 180;
    const cx = w / 2, cy = h * 0.62;
    const blockPos = s.s * 15;
    return { x: cx - blockPos * Math.cos(rad), y: cy + blockPos * Math.sin(rad) };
  },
  getVelocity: (s, p) => {
    const rad = p.angle * Math.PI / 180;
    return { x: -s.v * 15 * Math.cos(rad), y: s.v * 15 * Math.sin(rad) };
  },
};

export default function FrictionIncline() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ angle: 25, m: 2, mus: 0.4, muk: 0.3, g: 9.81 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, sample, computeStats, resetKey: `${params.angle}|${params.m}|${params.mus}|${params.muk}|${params.g}`, camera });
  const data = sim.graphData;
  return (
    <SimLayout title="Friction & Inclined Planes" configName="friction-incline" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<>
        <TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />
        <CameraControls cameraMode={sim.cameraMode} setCameraMode={sim.setCameraMode} onRecenter={sim.recenterCamera} enabled={sim.cameraEnabled} />
      </>}
      stats={<StatGrid stats={sim.stats} />}
      graph={<LiveGraph data={data} xKey="t" series={[{ key: 's', color: '#22d3ee' }, { key: 'v', color: '#f97316' }, { key: 'Fnet', color: '#eab308' }, { key: 'a', color: '#a855f7' }]} />}
      exportBar={<ExportBar graphData={data} config={params} canvasRef={canvasRef} name="friction-incline" />} />
  );
}