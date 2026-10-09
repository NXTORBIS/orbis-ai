import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, LiveGraph, stageBg } from '../ui.jsx';

const schema = [
  { key: 'angle', label: 'Polarizer 2 angle (°)', min: 0, max: 180, step: 1, type: 'range' },
  { key: 'I0', label: 'Initial intensity I₀', min: 0.2, max: 1, step: 0.05, type: 'range' },
];
function makeInitial() { return { t: 0 }; }
function step(s, dt) { s.t += dt; }
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const cy = h / 2, I0 = p.I0;
  const I1 = I0 / 2; // after polarizer 1 (unpolarized → half)
  const I2 = I1 * Math.cos(p.angle * Math.PI / 180) ** 2; // Malus's law
  // Light source
  ctx.fillStyle = `rgba(253,224,71,${I0})`; ctx.fillRect(20, cy - 20, 30, 40);
  ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '9px monospace'; ctx.textAlign = 'center'; ctx.fillText('Unpolarized', 35, cy + 35);
  // Polarizer 1 (vertical)
  ctx.strokeStyle = '#a855f7'; ctx.lineWidth = 2; ctx.strokeRect(80, cy - 30, 8, 60);
  for (let y = cy - 28; y < cy + 30; y += 4) { ctx.beginPath(); ctx.moveTo(80, y); ctx.lineTo(88, y); ctx.stroke(); }
  ctx.fillStyle = '#a855f7'; ctx.font = '9px monospace'; ctx.fillText('P1 (0°)', 84, cy - 38);
  // Light between polarizers
  ctx.fillStyle = `rgba(253,224,71,${I1})`; ctx.fillRect(88, cy - 15, 100, 30);
  // Polarizer 2 (rotated)
  ctx.save(); ctx.translate(200, cy); ctx.rotate(p.angle * Math.PI / 180);
  ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2; ctx.strokeRect(-4, -30, 8, 60);
  for (let y = -28; y < 30; y += 4) { ctx.beginPath(); ctx.moveTo(-4, y); ctx.lineTo(4, y); ctx.stroke(); }
  ctx.restore();
  ctx.fillStyle = '#22d3ee'; ctx.font = '9px monospace'; ctx.fillText(`P2 (${p.angle}°)`, 200, cy - 38);
  // Final light
  ctx.fillStyle = `rgba(253,224,71,${I2})`; ctx.fillRect(208, cy - 15, 100, 30);
  ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '10px monospace'; ctx.textAlign = 'left';
  ctx.fillText(`I = I₀/2 · cos²(${p.angle}°) = ${I2.toFixed(3)}`, 12, h - 16);
  ctx.fillText(`Malus's Law: I = I₁ cos²θ`, 12, h - 32);
}
function sample(s, p, t) { const I1 = p.I0 / 2; return { t: +t.toFixed(3), I: +(I1 * Math.cos(p.angle * Math.PI / 180) ** 2).toFixed(4) }; }
function computeStats(s, p) { const I1 = p.I0 / 2; const I2 = I1 * Math.cos(p.angle * Math.PI / 180) ** 2; return { 'I₀': p.I0.toFixed(2), 'I₁ (after P1)': I1.toFixed(3), 'θ': p.angle + '°', 'I₂ (after P2)': I2.toFixed(3) }; }
export default function PolarizationSim() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ angle: 45, I0: 1 });
  const graphData = [];
  for (let a = 0; a <= 180; a += 2) graphData.push({ angle: a, I: (params.I0 / 2) * Math.cos(a * Math.PI / 180) ** 2 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, sample, computeStats });
  return (
    <SimLayout title="Polarization & Malus's Law" configName="polarization" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      graph={<div><div className="text-xs text-muted-foreground mb-1">Transmitted intensity vs angle: I = I₁cos²θ</div><LiveGraph data={graphData} series={[{ key: 'I', color: '#fde047' }]} xKey="angle" height={150} /></div>}
      exportBar={<ExportBar graphData={graphData} config={params} canvasRef={canvasRef} name="polarization" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Unpolarized light through polarizer 1 → half intensity, polarised vertically. Rotate polarizer 2: transmitted I = I₁cos²θ (Malus's law). At 90° → dark (crossed polarizers). Sunglasses, LCDs, 3D glasses.</div>} />
  );
}