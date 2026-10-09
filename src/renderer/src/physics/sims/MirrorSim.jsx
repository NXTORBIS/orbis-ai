import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

const schema = [
  { key: 'type', label: 'Mirror type', type: 'select', options: [{ value: 'concave', label: 'Concave (converging)' }, { value: 'convex', label: 'Convex (diverging)' }] },
  { key: 'R', label: 'Radius R', min: 100, max: 500, step: 20, type: 'range' },
  { key: 'do', label: 'Object distance d_o', min: 60, max: 400, step: 10, type: 'range' },
];
function makeInitial() { return {}; }
function step() {}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const cx = w / 2, cy = h / 2;
  const R = p.R, f = R / 2, isConcave = p.type === 'concave';
  const fSign = isConcave ? f : -f;
  // Axis
  ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke();
  // Mirror (arc)
  ctx.strokeStyle = '#a855f7'; ctx.lineWidth = 3;
  const arcR = R * 0.6, startA = -Math.PI / 2 + 0.3, endA = Math.PI / 2 - 0.3;
  const center = isConcave ? cx + R * 0.5 : cx - R * 0.5;
  ctx.beginPath(); ctx.arc(center, cy, arcR, isConcave ? startA + Math.PI : startA, isConcave ? endA + Math.PI : endA); ctx.stroke();
  // Focal points
  ctx.fillStyle = '#fde047'; ctx.beginPath(); ctx.arc(cx - f, cy, 3, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(cx + f, cy, 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fde047'; ctx.font = '9px monospace'; ctx.textAlign = 'center'; ctx.fillText('F', cx - f, cy + 14); ctx.fillText("F'", cx + f, cy + 14);
  // Object
  const objX = cx - p.do, objH = 40;
  ctx.strokeStyle = '#f97316'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(objX, cy); ctx.lineTo(objX, cy - objH); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(objX, cy - objH); ctx.lineTo(objX - 4, cy - objH + 6); ctx.lineTo(objX + 4, cy - objH + 6); ctx.fill();
  // Image
  const di = 1 / (1 / fSign - 1 / p.do);
  if (Math.abs(di) > 5 && Math.abs(di) < 2000) {
    const imgX = cx - di, imgH = -objH * di / p.do;
    ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(imgX, cy); ctx.lineTo(imgX, cy - imgH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(imgX, cy - imgH); ctx.lineTo(imgX - 4, cy - imgH + (imgH > 0 ? 6 : -6)); ctx.lineTo(imgX + 4, cy - imgH + (imgH > 0 ? 6 : -6)); ctx.fill();
  }
  // Labels
  ctx.fillStyle = '#f97316'; ctx.font = '10px monospace'; ctx.textAlign = 'left'; ctx.fillText('Object', objX - 20, cy + 14);
  if (Math.abs(di) > 5 && Math.abs(di) < 2000) { ctx.fillStyle = '#22d3ee'; ctx.fillText('Image', cx - di - 20, cy + 14); }
}
function computeStats(s, p) {
  const fSign = p.type === 'concave' ? p.R / 2 : -p.R / 2;
  const di = 1 / (1 / fSign - 1 / p.do);
  const M = -di / p.do;
  return { 'f = R/2': (p.R / 2) + ' px', 'd_o': p.do + ' px', 'd_i': Math.abs(di) > 2000 ? '∞' : di.toFixed(0) + ' px', 'M': Math.abs(M) > 10 ? '∞' : M.toFixed(2) };
}
export default function MirrorSim() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ type: 'concave', R: 240, do: 200 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats });
  return (
    <SimLayout title="Mirror Imaging" configName="mirror-sim" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="mirror-sim" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Spherical mirror: f = R/2. Concave: converges light (telescopes, shaving mirrors). Convex: diverges, always virtual/smaller/upright (car mirrors). Same imaging equation as lenses: 1/f = 1/d_o + 1/d_i.</div>} />
  );
}