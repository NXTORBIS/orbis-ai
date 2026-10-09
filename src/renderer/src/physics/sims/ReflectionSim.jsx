import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

const schema = [
  { key: 'angle', label: 'Incidence angle (°)', min: 0, max: 80, step: 1, type: 'range' },
  { key: 'surface', label: 'Surface', type: 'select', options: [{ value: 'smooth', label: 'Smooth (specular)' }, { value: 'rough', label: 'Rough (diffuse)' }] },
];
function makeInitial() { return {}; }
function step() {}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const cx = w / 2, surfaceY = h * 0.65, angleRad = p.angle * Math.PI / 180;
  // Surface
  if (p.surface === 'smooth') { ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, surfaceY); ctx.lineTo(w, surfaceY); ctx.stroke(); }
  else { ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 2; for (let x = 0; x < w; x += 8) { ctx.beginPath(); ctx.moveTo(x, surfaceY + Math.sin(x * 0.3) * 3); ctx.lineTo(x + 8, surfaceY + Math.sin((x + 8) * 0.3) * 3); ctx.stroke(); } }
  // Normal
  ctx.strokeStyle = 'rgba(253,224,71,0.4)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(cx, surfaceY - 100); ctx.lineTo(cx, surfaceY); ctx.stroke(); ctx.setLineDash([]);
  // Incident ray
  const incLen = 120;
  const ix2 = cx - Math.sin(angleRad) * incLen, iy2 = surfaceY - Math.cos(angleRad) * incLen;
  ctx.strokeStyle = '#a855f7'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(ix2, iy2); ctx.lineTo(cx, surfaceY); ctx.stroke();
  // Arrow on incident
  ctx.fillStyle = '#a855f7'; ctx.beginPath(); ctx.moveTo(cx, surfaceY); ctx.lineTo(cx - Math.sin(angleRad) * 8 + Math.cos(angleRad) * 5, surfaceY - Math.cos(angleRad) * 8 - Math.sin(angleRad) * 5); ctx.lineTo(cx - Math.sin(angleRad) * 8 - Math.cos(angleRad) * 5, surfaceY - Math.cos(angleRad) * 8 + Math.sin(angleRad) * 5); ctx.fill();
  if (p.surface === 'smooth') {
    // Reflected ray (specular: θ_i = θ_r)
    const rx2 = cx + Math.sin(angleRad) * incLen, ry2 = surfaceY - Math.cos(angleRad) * incLen;
    ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(cx, surfaceY); ctx.lineTo(rx2, ry2); ctx.stroke();
    ctx.fillStyle = '#22d3ee'; ctx.beginPath(); ctx.moveTo(rx2, ry2); ctx.lineTo(rx2 - Math.sin(angleRad) * 8 + Math.cos(angleRad) * 5, ry2 + Math.cos(angleRad) * 8 + Math.sin(angleRad) * 5); ctx.lineTo(rx2 - Math.sin(angleRad) * 8 - Math.cos(angleRad) * 5, ry2 + Math.cos(angleRad) * 8 - Math.sin(angleRad) * 5); ctx.fill();
  } else {
    // Diffuse: multiple reflected rays at random angles
    ctx.strokeStyle = 'rgba(34,211,238,0.4)'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI - Math.PI / 2; const rl = 80; ctx.beginPath(); ctx.moveTo(cx, surfaceY); ctx.lineTo(cx + Math.cos(a) * rl, surfaceY + Math.sin(a) * rl * 0.5); ctx.stroke(); }
  }
  // Labels
  ctx.fillStyle = '#a855f7'; ctx.font = '11px monospace'; ctx.textAlign = 'left'; ctx.fillText('Incident', ix2 - 50, iy2 - 5);
  ctx.fillStyle = '#22d3ee'; ctx.fillText('Reflected', cx + 50, surfaceY - 60);
  ctx.fillStyle = '#fde047'; ctx.fillText('Normal', cx + 8, surfaceY - 80);
  ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '10px monospace';
  ctx.fillText(`θ_i = θ_r = ${p.angle}°`, 12, h - 16);
}
function computeStats(s, p) { return { 'θ_i': p.angle + '°', 'θ_r': p.surface === 'smooth' ? p.angle + '°' : 'scattered', 'Type': p.surface, 'Law': 'θ_i = θ_r (specular)' }; }
export default function ReflectionSim() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ angle: 35, surface: 'smooth' });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats });
  return (
    <SimLayout title="Reflection Simulator" configName="reflection" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="reflection" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Law of reflection: angle of incidence = angle of reflection (both from the normal). Smooth surface = specular (mirror); rough = diffuse (scattered). Mirrors, periscopes, solar concentrators.</div>} />
  );
}