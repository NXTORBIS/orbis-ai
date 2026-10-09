import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, LiveGraph, stageBg } from '../ui.jsx';

const schema = [
  { key: 'B', label: 'Magnetic field B (T)', min: 0.1, max: 3, step: 0.1, type: 'range' },
  { key: 'A', label: 'Loop area A (m²)', min: 0.01, max: 0.5, step: 0.01, type: 'range' },
  { key: 'omega', label: 'Angular vel ω (rad/s)', min: 0.5, max: 10, step: 0.5, type: 'range' },
  { key: 'turns', label: 'Turns N', min: 1, max: 20, step: 1, type: 'range' },
];
function makeInitial() { return { theta: 0 }; }
function step(s, dt, p) { s.theta += p.omega * dt; }
function flux(p, theta) { return p.B * p.A * Math.cos(theta); }
function emf(p, theta) { return p.turns * p.B * p.A * p.omega * Math.sin(theta); }
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const cx = w / 2, cy = h / 2;
  const R = Math.min(w, h) * 0.25;
  // B field arrows (horizontal)
  ctx.strokeStyle = 'rgba(59,130,246,0.3)'; ctx.lineWidth = 1;
  for (let y = 0.1; y < 1; y += 0.15) {
    ctx.beginPath(); ctx.moveTo(0, y * h); ctx.lineTo(w, y * h); ctx.stroke();
    ctx.fillStyle = 'rgba(59,130,246,0.4)';
    ctx.beginPath(); ctx.moveTo(w - 8, y * h); ctx.lineTo(w - 14, y * h - 3); ctx.lineTo(w - 14, y * h + 3); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = 'rgba(59,130,246,0.6)'; ctx.font = '10px monospace'; ctx.textAlign = 'left'; ctx.fillText('B', 12, 20);
  // Rotating loop (ellipse to show 3D perspective)
  const flat = Math.abs(Math.cos(s.theta));
  ctx.strokeStyle = '#f97316'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.ellipse(cx, cy, R, R * flat, 0, 0, Math.PI * 2); ctx.stroke();
  // Normal vector
  const nx = Math.sin(s.theta) * R * 0.8, ny = -Math.cos(s.theta) * R * 0.8 * flat;
  ctx.strokeStyle = '#fde047'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + nx, cy + ny); ctx.stroke();
  ctx.fillStyle = '#fde047'; ctx.beginPath(); ctx.arc(cx + nx, cy + ny, 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fde047'; ctx.font = '10px monospace'; ctx.textAlign = 'left'; ctx.fillText('n', cx + nx + 6, cy + ny);
  // Values
  ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '11px monospace'; ctx.textAlign = 'left';
  ctx.fillText(`θ = ${s.theta.toFixed(2)} rad`, 12, h - 32);
  ctx.fillText(`Φ = ${flux(p, s.theta).toFixed(4)} Wb`, 12, h - 18);
  ctx.fillText(`EMF = ${emf(p, s.theta).toFixed(4)} V`, 12, h - 4);
}
function sample(s, p, t) { return { t: +t.toFixed(3), flux: +flux(p, s.theta).toFixed(4), emf: +emf(p, s.theta).toFixed(4) }; }
function computeStats(s, p) { return { 'Φ': flux(p, s.theta).toFixed(4) + ' Wb', 'EMF': emf(p, s.theta).toFixed(4) + ' V', 'ω': p.omega.toFixed(1) + ' rad/s', 'θ': s.theta.toFixed(2) + ' rad' }; }
export default function FaradayLaw() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ B: 1, A: 0.1, omega: 2, turns: 10 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, sample, computeStats });
  return (
    <SimLayout title="Faraday's Law — Rotating Loop" configName="faraday" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      graph={<div><div className="text-xs text-muted-foreground mb-1">Φ(t) and EMF(t) = −N dΦ/dt</div><LiveGraph data={sim.graphData} series={[{ key: 'flux', color: '#3b82f6' }, { key: 'emf', color: '#f97316' }]} height={150} /></div>}
      exportBar={<ExportBar graphData={sim.graphData} config={params} canvasRef={canvasRef} name="faraday" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Loop rotates in uniform B. Φ = BA cos(θ), EMF = −N dΦ/dt = NBAω sin(θ). The EMF is 90° out of phase with flux — this is how generators work.</div>} />
  );
}