import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, LiveGraph, stageBg } from '../ui.jsx';

const schema = [
  { key: 'f1', label: 'Frequency 1 (Hz)', min: 5, max: 30, step: 0.5, type: 'range' },
  { key: 'f2', label: 'Frequency 2 (Hz)', min: 5, max: 30, step: 0.5, type: 'range' },
];
function makeInitial() { return { t: 0 }; }
function step(s, dt) { s.t += dt; }
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const cy = h / 2, A = 50;
  const f1 = p.f1, f2 = p.f2;
  // Combined wave
  ctx.strokeStyle = '#a855f7'; ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = 0; x < w; x += 1) {
    const t = s.t + x * 0.01;
    const y = cy + A * (Math.cos(2 * Math.PI * f1 * t) + Math.cos(2 * Math.PI * f2 * t));
    if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  // Envelope
  const fbeat = Math.abs(f1 - f2);
  ctx.strokeStyle = 'rgba(253,224,71,0.4)'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let x = 0; x < w; x += 1) { const t = s.t + x * 0.01; const env = 2 * A * Math.abs(Math.cos(Math.PI * fbeat * t)); const y = cy + env; if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
  ctx.stroke();
  ctx.beginPath();
  for (let x = 0; x < w; x += 1) { const t = s.t + x * 0.01; const env = 2 * A * Math.abs(Math.cos(Math.PI * fbeat * t)); const y = cy - env; if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '10px monospace'; ctx.textAlign = 'left';
  ctx.fillText(`f_beat = |f1 - f2| = ${fbeat.toFixed(1)} Hz`, 12, h - 16);
  ctx.fillText(`Carrier = (f1+f2)/2 = ${((f1 + f2) / 2).toFixed(1)} Hz`, 12, h - 32);
}
function sample(s, p, t) { const A = 50; return { t: +t.toFixed(3), wave: +(A * (Math.cos(2 * Math.PI * p.f1 * t) + Math.cos(2 * Math.PI * p.f2 * t))).toFixed(2), env: +(2 * A * Math.abs(Math.cos(Math.PI * Math.abs(p.f1 - p.f2) * t))).toFixed(2) }; }
function computeStats(s, p) { return { 'f1': p.f1.toFixed(1) + ' Hz', 'f2': p.f2.toFixed(1) + ' Hz', 'f_beat': Math.abs(p.f1 - p.f2).toFixed(1) + ' Hz', 'Carrier': ((p.f1 + p.f2) / 2).toFixed(1) + ' Hz' }; }
export default function BeatsSim() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ f1: 10, f2: 12 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, sample, computeStats });
  return (
    <SimLayout title="Beats Simulator" configName="beats" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      graph={<div><div className="text-xs text-muted-foreground mb-1">Wave + beat envelope</div><LiveGraph data={sim.graphData} series={[{ key: 'wave', color: '#a855f7' }, { key: 'env', color: '#fde047' }]} height={150} /></div>}
      exportBar={<ExportBar graphData={sim.graphData} config={params} canvasRef={canvasRef} name="beats" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Two close frequencies produce a pulsing envelope at f_beat = |f1−f2|. Tune instruments by zeroing the beat. The carrier pitch is the average (f1+f2)/2.</div>} />
  );
}