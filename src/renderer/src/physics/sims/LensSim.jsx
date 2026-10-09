import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

const schema = [
  { key: 'type', label: 'Lens type', type: 'select', options: [{ value: 'convex', label: 'Convex (converging)' }, { value: 'concave', label: 'Concave (diverging)' }] },
  { key: 'f', label: 'Focal length f', min: 50, max: 250, step: 10, type: 'range' },
  { key: 'do', label: 'Object distance d_o', min: 60, max: 400, step: 10, type: 'range' },
];
function makeInitial() { return {}; }
function step() {}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const cx = w / 2, cy = h / 2;
  const f = p.f, isConvex = p.type === 'convex';
  const fSign = isConvex ? f : -f;
  // Optical axis
  ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke();
  // Lens
  ctx.strokeStyle = '#a855f7'; ctx.lineWidth = 3;
  if (isConvex) { ctx.beginPath(); ctx.moveTo(cx, cy - 70); ctx.quadraticCurveTo(cx + 15, cy, cx, cy + 70); ctx.moveTo(cx, cy - 70); ctx.quadraticCurveTo(cx - 15, cy, cx, cy + 70); ctx.stroke(); }
  else { ctx.beginPath(); ctx.moveTo(cx, cy - 70); ctx.quadraticCurveTo(cx - 15, cy, cx, cy + 70); ctx.moveTo(cx, cy - 70); ctx.quadraticCurveTo(cx + 15, cy, cx, cy + 70); ctx.stroke(); }
  // Focal points
  ctx.fillStyle = '#fde047'; ctx.beginPath(); ctx.arc(cx - f, cy, 3, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(cx + f, cy, 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fde047'; ctx.font = '9px monospace'; ctx.textAlign = 'center'; ctx.fillText('F', cx - f, cy + 14); ctx.fillText("F'", cx + f, cy + 14);
  // Object (arrow)
  const objX = cx - p.do, objH = 40;
  ctx.strokeStyle = '#f97316'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(objX, cy); ctx.lineTo(objX, cy - objH); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(objX, cy - objH); ctx.lineTo(objX - 4, cy - objH + 6); ctx.lineTo(objX + 4, cy - objH + 6); ctx.fill();
  // Image
  const di = 1 / (1 / fSign - 1 / p.do);
  if (Math.abs(di) > 5 && Math.abs(di) < 2000) {
    const imgX = cx + di, imgH = -objH * di / p.do;
    ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(imgX, cy); ctx.lineTo(imgX, cy - imgH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(imgX, cy - imgH); ctx.lineTo(imgX - 4, cy - imgH + (imgH > 0 ? 6 : -6)); ctx.lineTo(imgX + 4, cy - imgH + (imgH > 0 ? 6 : -6)); ctx.fill();
  }
  // Ray 1: parallel → through F
  ctx.strokeStyle = 'rgba(34,211,238,0.6)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(objX, cy - objH); ctx.lineTo(cx, cy - objH); ctx.stroke();
  if (isConvex) { ctx.beginPath(); ctx.moveTo(cx, cy - objH); ctx.lineTo(cx + Math.min(di > 0 ? di : w - cx, w - cx), cy - objH + (cy - objH - cy) * 0); ctx.lineTo(cx + 200, cy - objH + (objH / f) * 200); ctx.stroke(); }
  else { ctx.beginPath(); ctx.moveTo(cx, cy - objH); ctx.lineTo(cx + 200, cy - objH - (objH / Math.abs(f)) * 200); ctx.stroke(); }
  // Ray 2: through center
  ctx.strokeStyle = 'rgba(168,85,247,0.6)'; ctx.beginPath(); ctx.moveTo(objX, cy - objH); ctx.lineTo(w - 20, cy - objH * (w - cx) / (cx - objX)); ctx.stroke();
  // Labels
  ctx.fillStyle = '#f97316'; ctx.font = '10px monospace'; ctx.textAlign = 'left'; ctx.fillText('Object', objX - 20, cy + 14);
  if (Math.abs(di) > 5 && Math.abs(di) < 2000) { ctx.fillStyle = '#22d3ee'; ctx.fillText('Image', cx + di - 20, cy + 14); }
}
function computeStats(s, p) {
  const fSign = p.type === 'convex' ? p.f : -p.f;
  const di = 1 / (1 / fSign - 1 / p.do);
  const M = -di / p.do;
  return { 'f': p.f + ' px', 'd_o': p.do + ' px', 'd_i': Math.abs(di) > 2000 ? '∞' : di.toFixed(0) + ' px', 'M = −d_i/d_o': Math.abs(M) > 10 ? '∞' : M.toFixed(2) };
}
export default function LensSim() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ type: 'convex', f: 120, do: 200 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats });
  return (
    <SimLayout title="Lens Imaging" configName="lens-sim" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="lens-sim" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Thin-lens equation: 1/f = 1/d_o + 1/d_i. Convex: converges parallel rays to F. Object beyond 2f → real inverted image; inside f → virtual upright (magnifier). Concave always produces virtual, smaller, upright images.</div>} />
  );
}