import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, LiveGraph, stageBg } from '../ui.jsx';

const c = 3e8;
const schema = [
  { key: 'freq', label: 'Frequency (THz)', min: 100, max: 800, step: 10, type: 'range' },
  { key: 'amp', label: 'Amplitude', min: 0.3, max: 1.5, step: 0.1, type: 'range' },
  { key: 'polarization', label: 'Polarization', type: 'select', options: [{ value: 'linear', label: 'Linear' }, { value: 'circular', label: 'Circular' }] },
];
function makeInitial() { return { phase: 0 }; }
function step(s, dt, p) { s.phase += dt * 2; }
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const cx = w / 2, cy = h / 2;
  const wavelength = 60 + (800 - p.freq) * 0.3; // visual wavelength
  const k = 2 * Math.PI / wavelength;
  const amp = p.amp * 50;
  // Propagation axis
  ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke();
  // E field (vertical, orange) — sine wave
  ctx.strokeStyle = '#f97316'; ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = 0; x < w; x += 2) {
    const phase = k * x - s.phase * 50;
    const ey = amp * Math.sin(phase);
    if (x === 0) ctx.moveTo(x, cy - ey); else ctx.lineTo(x, cy - ey);
  }
  ctx.stroke();
  // E field arrows
  for (let x = 0; x < w; x += 30) {
    const phase = k * x - s.phase * 50;
    const ey = amp * Math.sin(phase);
    ctx.strokeStyle = 'rgba(249,115,22,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, cy); ctx.lineTo(x, cy - ey); ctx.stroke();
  }
  // B field (horizontal, cyan) — perpendicular to E, 90° phase for circular
  ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = 0; x < w; x += 2) {
    const phase = k * x - s.phase * 50 + (p.polarization === 'circular' ? Math.PI / 2 : 0);
    const bx = amp * 0.6 * Math.sin(phase);
    if (x === 0) ctx.moveTo(x + bx, cy + 40); else ctx.lineTo(x + bx, cy + 40);
  }
  ctx.stroke();
  // B field arrows
  for (let x = 0; x < w; x += 30) {
    const phase = k * x - s.phase * 50 + (p.polarization === 'circular' ? Math.PI / 2 : 0);
    const bx = amp * 0.6 * Math.sin(phase);
    ctx.strokeStyle = 'rgba(34,211,238,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, cy + 40); ctx.lineTo(x + bx, cy + 40); ctx.stroke();
  }
  // Propagation arrow
  ctx.fillStyle = '#fde047'; ctx.font = '11px monospace'; ctx.textAlign = 'left';
  ctx.fillText('→ propagation (k)', w - 120, 20);
  ctx.strokeStyle = '#fde047'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(w - 30, 18); ctx.lineTo(w - 15, 18); ctx.lineTo(w - 20, 14); ctx.moveTo(w - 15, 18); ctx.lineTo(w - 20, 22); ctx.stroke();
  // Labels
  ctx.fillStyle = '#f97316'; ctx.fillText('E field', 12, 20);
  ctx.fillStyle = '#22d3ee'; ctx.fillText('B field', 12, cy + 60);
  ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '10px monospace';
  ctx.fillText(`λ = ${wavelength.toFixed(0)} px (visual)`, 12, h - 16);
  ctx.fillText(`f = ${p.freq} THz, λ_real = ${(c / (p.freq * 1e12) * 1e9).toFixed(0)} nm`, 12, h - 32);
}
function sample(s, p, t) {
  const E = p.amp * Math.sin(-s.phase * 50);
  return { t: +t.toFixed(3), E: +E.toFixed(3), B: +(p.amp * 0.6 * Math.sin(-s.phase * 50 + (p.polarization === 'circular' ? Math.PI / 2 : 0))).toFixed(3) };
}
function computeStats(s, p) {
  const lambda_nm = (c / (p.freq * 1e12) * 1e9).toFixed(0);
  const spectrum = p.freq < 430 ? 'Red' : p.freq < 480 ? 'Orange' : p.freq < 530 ? 'Green' : p.freq < 580 ? 'Cyan' : p.freq < 680 ? 'Blue' : 'Violet';
  return { 'Frequency': p.freq + ' THz', 'Wavelength': lambda_nm + ' nm', 'Spectrum': spectrum, 'Polarization': p.polarization };
}
export default function EMWaves() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ freq: 500, amp: 1, polarization: 'linear' });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, sample, computeStats });
  return (
    <SimLayout title="Electromagnetic Wave Simulator" configName="em-waves" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      graph={<div><div className="text-xs text-muted-foreground mb-1">E (orange) & B (cyan) oscillation</div><LiveGraph data={sim.graphData} series={[{ key: 'E', color: '#f97316' }, { key: 'B', color: '#22d3ee' }]} height={150} /></div>}
      exportBar={<ExportBar graphData={sim.graphData} config={params} canvasRef={canvasRef} name="em-waves" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">E and B fields oscillate perpendicular to each other and to propagation direction k. Frequency slider maps to the visible spectrum (400–700 THz → 750–400 nm). Circular polarization has E and B 90° out of phase.</div>} />
  );
}