import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

const schema = [
  { key: 'n1', label: 'Index n1', min: 1, max: 2.5, step: 0.05, type: 'range' },
  { key: 'n2', label: 'Index n2', min: 1, max: 2.5, step: 0.05, type: 'range' },
  { key: 'angle', label: 'Incidence angle (deg)', min: 0, max: 85, step: 1, type: 'range' },
];
function makeInitial() { return {}; }
function step() {}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const cx = w / 2, cy = h / 2;
  ctx.fillStyle = `rgba(59,130,246,${0.05 + 0.05 * p.n1})`; ctx.fillRect(0, 0, w, cy);
  ctx.fillStyle = `rgba(168,85,247,${0.05 + 0.05 * p.n2})`; ctx.fillRect(0, cy, w, h - cy);
  ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke();
  ctx.strokeStyle = 'rgba(253,224,71,0.4)'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(cx, 20); ctx.lineTo(cx, h - 20); ctx.stroke(); ctx.setLineDash([]);
  const angleRad = p.angle * Math.PI / 180;
  const sinTheta2 = p.n1 * Math.sin(angleRad) / p.n2;
  const tir = sinTheta2 > 1;
  const theta2 = tir ? 0 : Math.asin(Math.min(1, sinTheta2));
  const incLen = 120;
  const ix = cx - Math.sin(angleRad) * incLen, iy = cy - Math.cos(angleRad) * incLen;
  ctx.strokeStyle = '#a855f7'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(ix, iy); ctx.lineTo(cx, cy); ctx.stroke();
  if (!tir) {
    const rx = cx + Math.sin(theta2) * incLen, ry = cy + Math.cos(theta2) * incLen;
    ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(rx, ry); ctx.stroke();
  }
  const rfx = cx + Math.sin(angleRad) * incLen, rfy = cy - Math.cos(angleRad) * incLen;
  ctx.strokeStyle = 'rgba(168,85,247,0.4)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(rfx, rfy); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '11px monospace'; ctx.textAlign = 'left';
  ctx.fillText('n1 = ' + p.n1.toFixed(2), 12, 25);
  ctx.fillText('n2 = ' + p.n2.toFixed(2), 12, h - 12);
  ctx.fillStyle = '#a855f7'; ctx.fillText('theta1 = ' + p.angle + ' deg', cx - 80, cy - 10);
  ctx.fillStyle = '#22d3ee';
  if (tir) ctx.fillText('Total Internal Reflection', cx + 10, cy + 30);
  else ctx.fillText('theta2 = ' + (theta2 * 180 / Math.PI).toFixed(1) + ' deg', cx + 10, cy + 20);
}
function computeStats(s, p) {
  const sinTheta2 = p.n1 * Math.sin(p.angle * Math.PI / 180) / p.n2;
  const tir = sinTheta2 > 1;
  const theta2 = tir ? 90 : Math.asin(Math.min(1, sinTheta2)) * 180 / Math.PI;
  const critical = p.n1 > p.n2 ? Math.asin(p.n2 / p.n1) * 180 / Math.PI : null;
  return { 'theta1': p.angle + ' deg', 'theta2': tir ? 'TIR' : theta2.toFixed(1) + ' deg', 'Critical': critical ? critical.toFixed(1) + ' deg' : 'none', 'TIR': tir ? 'YES' : 'no' };
}
export default function RefractionSim() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ n1: 1.0, n2: 1.5, angle: 30 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats });
  return (
    <SimLayout title="Refraction Simulator" configName="refraction" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="refraction" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Light bends at the interface: n1 sin(theta1) = n2 sin(theta2). Into denser medium bends toward normal. Past the critical angle (n1 greater than n2) total internal reflection occurs. Fibre optics, lenses, rainbows.</div>} />
  );
}