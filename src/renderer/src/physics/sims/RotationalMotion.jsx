import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, LiveGraph, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

// Rotational Motion — torque, angular acceleration, moment of inertia.
// Unique focus: spinning disk with applied torque, angular velocity/acceleration, angular momentum.
const schema = [
  { key: 'I', label: 'Moment of inertia I (kg·m²)', min: 0.01, max: 5, step: 0.01, type: 'range' },
  { key: 'tau', label: 'Torque τ (N·m)', min: -20, max: 20, step: 0.1, type: 'range' },
  { key: 'omega0', label: 'Initial ω₀ (rad/s)', min: -10, max: 10, step: 0.1, type: 'range' },
  { key: 'shape', label: 'Object shape', type: 'select', options: [
    { value: 'disk', label: 'Solid disk (I=½mr²)' },
    { value: 'ring', label: 'Ring (I=mr²)' },
    { value: 'rod', label: 'Rod about center (I=⅓mL²)' },
  ] },
];

function makeInitial(p) { return { theta: 0, omega: p.omega0, t: 0 }; }
function step(s, dt, p, t) {
  // τ = I α  →  α = τ / I
  const alpha = p.tau / p.I;
  s.omega += alpha * dt; s.theta += s.omega * dt; s.t += dt;
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const cx = w / 2, cy = h / 2;
  const R = Math.min(w, h) * 0.3;
  // rotation
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(s.theta);
  // shape
  ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 3;
  if (p.shape === 'disk') {
    ctx.fillStyle = '#22d3ee22';
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // spoke
    ctx.strokeStyle = '#f97316'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(R, 0); ctx.stroke();
  } else if (p.shape === 'ring') {
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#f97316'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(R, 0); ctx.stroke();
  } else {
    ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(-R, 0); ctx.lineTo(R, 0); ctx.stroke();
    ctx.strokeStyle = '#f97316'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(R, 0); ctx.stroke();
  }
  ctx.restore();
  // center pivot
  ctx.fillStyle = 'hsl(var(--muted-foreground))';
  ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();
  // torque arrow (curved)
  if (Math.abs(p.tau) > 0.1) {
    ctx.strokeStyle = '#a855f7'; ctx.lineWidth = 2.5;
    const dir = Math.sign(p.tau);
    ctx.beginPath();
    ctx.arc(cx, cy, R + 20, -0.3, dir > 0 ? 1.5 : -1.5, dir < 0);
    ctx.stroke();
    // arrowhead
    const ah = dir > 0 ? 1.5 : -1.5;
    const ax = cx + (R + 20) * Math.cos(ah), ay = cy + (R + 20) * Math.sin(ah);
    ctx.beginPath(); ctx.moveTo(ax, ay);
    ctx.lineTo(ax - dir * 8, ay - 5); ctx.moveTo(ax, ay);
    ctx.lineTo(ax - dir * 8, ay + 5); ctx.stroke();
    ctx.font = '12px monospace'; ctx.fillStyle = '#a855f7';
    ctx.fillText('τ', ax + 8, ay);
  }
  // angular velocity indicator
  ctx.font = '11px monospace'; ctx.fillStyle = '#22d3ee';
  ctx.fillText('ω = ' + s.omega.toFixed(2) + ' rad/s', 15, h - 15);
}
function sample(s, p) {
  const alpha = p.tau / p.I;
  const L = p.I * s.omega;
  const KE = 0.5 * p.I * s.omega * s.omega;
  return { theta: +s.theta.toFixed(3), omega: +s.omega.toFixed(3), alpha: +alpha.toFixed(3), L: +L.toFixed(3), KE: +KE.toFixed(3) };
}
function computeStats(s, p) {
  const alpha = p.tau / p.I;
  const L = p.I * s.omega;
  const KE = 0.5 * p.I * s.omega * s.omega;
  const T = s.omega !== 0 ? Math.abs(2 * Math.PI / s.omega) : Infinity;
  return { 'θ (rad)': s.theta.toFixed(3), 'ω (rad/s)': s.omega.toFixed(3), 'α (rad/s²)': alpha.toFixed(3), 'L (kg·m²/s)': L.toFixed(3), 'KE (J)': KE.toFixed(3), 'T (s)': isFinite(T) ? T.toFixed(3) : '∞' };
}

export default function RotationalMotion() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ I: 0.5, tau: 2, omega0: 0, shape: 'disk' });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, sample, computeStats, resetKey: `${params.I}|${params.tau}|${params.omega0}|${params.shape}` });
  const data = sim.graphData;
  return (
    <SimLayout title="Rotational Motion — Torque & Angular Momentum" configName="rotational-motion" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      graph={<LiveGraph data={data} xKey="t" series={[{ key: 'omega', color: '#22d3ee' }, { key: 'alpha', color: '#f97316' }, { key: 'L', color: '#a855f7' }, { key: 'KE', color: '#84cc16' }]} />}
      exportBar={<ExportBar graphData={data} config={params} canvasRef={canvasRef} name="rotational-motion" />} />
  );
}