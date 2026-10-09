import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

const schema = [
  { key: 'f1', label: 'Focal length f₁', min: 50, max: 200, step: 10, type: 'range' },
  { key: 'f2', label: 'Focal length f₂', min: 20, max: 150, step: 10, type: 'range' },
  { key: 'sep', label: 'Separation L', min: 100, max: 400, step: 10, type: 'range' },
  { key: 'do', label: 'Object distance', min: 80, max: 300, step: 10, type: 'range' },
];
function makeInitial() { return {}; }
function step() {}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const cy = h / 2;
  const L1x = w * 0.3, L2x = w * 0.3 + p.sep;
  // Axis
  ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke();
  // Lens 1
  ctx.strokeStyle = '#a855f7'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(L1x, cy - 50); ctx.quadraticCurveTo(L1x + 10, cy, L1x, cy + 50); ctx.moveTo(L1x, cy - 50); ctx.quadraticCurveTo(L1x - 10, cy, L1x, cy + 50); ctx.stroke();
  // Lens 2
  ctx.beginPath(); ctx.moveTo(L2x, cy - 50); ctx.quadraticCurveTo(L2x + 10, cy, L2x, cy + 50); ctx.moveTo(L2x, cy - 50); ctx.quadraticCurveTo(L2x - 10, cy, L2x, cy + 50); ctx.stroke();
  // Object
  const objX = L1x - p.do, objH = 35;
  ctx.strokeStyle = '#f97316'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(objX, cy); ctx.lineTo(objX, cy - objH); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(objX, cy - objH); ctx.lineTo(objX - 4, cy - objH + 6); ctx.lineTo(objX + 4, cy - objH + 6); ctx.fill();
  // Image 1 (through lens 1)
  const di1 = 1 / (1 / p.f1 - 1 / p.do);
  const img1X = L1x + di1, img1H = -objH * di1 / p.do;
  if (Math.abs(di1) > 5 && Math.abs(di1) < 1000) {
    ctx.strokeStyle = 'rgba(34,211,238,0.5)'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(img1X, cy); ctx.lineTo(img1X, cy - img1H); ctx.stroke(); ctx.setLineDash([]);
  }
  // Image 2 (through lens 2, using image1 as object)
  const do2 = L2x - img1X;
  let finalImgX = 0, finalImgH = 0;
  if (Math.abs(do2) > 5) {
    const di2 = 1 / (1 / p.f2 - 1 / do2);
    if (Math.abs(di2) > 5 && Math.abs(di2) < 3000) { finalImgX = L2x + di2; finalImgH = -img1H * di2 / do2; }
  }
  if (finalImgX > 0 && finalImgX < w) {
    ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(finalImgX, cy); ctx.lineTo(finalImgX, cy - finalImgH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(finalImgX, cy - finalImgH); ctx.lineTo(finalImgX - 4, cy - finalImgH + (finalImgH > 0 ? 6 : -6)); ctx.lineTo(finalImgX + 4, cy - finalImgH + (finalImgH > 0 ? 6 : -6)); ctx.fill();
  }
  // Labels
  ctx.fillStyle = '#a855f7'; ctx.font = '9px monospace'; ctx.textAlign = 'center'; ctx.fillText('L1', L1x, cy + 65); ctx.fillText('L2', L2x, cy + 65);
  ctx.fillStyle = '#f97316'; ctx.textAlign = 'left'; ctx.fillText('Object', objX - 20, cy + 14);
  ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '10px monospace';
  const M1 = -di1 / p.do;
  const Mtotal = finalImgH ? finalImgH / -objH : 0;
  ctx.fillText(`M_total = M₁×M₂ = ${Mtotal.toFixed(2)}`, 12, h - 16);
}
function computeStats(s, p) {
  const di1 = 1 / (1 / p.f1 - 1 / p.do);
  const M1 = -di1 / p.do;
  const do2 = p.sep - di1;
  let M2 = 0, Mtot = 0;
  if (Math.abs(do2) > 5) { const di2 = 1 / (1 / p.f2 - 1 / do2); M2 = -di2 / do2; Mtot = M1 * M2; }
  return { 'f₁': p.f1 + ' px', 'f₂': p.f2 + ' px', 'M₁': M1.toFixed(2), 'M_total': Mtot.toFixed(2) };
}
export default function LensCombo() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ f1: 120, f2: 40, sep: 180, do: 200 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats });
  return (
    <SimLayout title="Lens Combinations" configName="lens-combo" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="lens-combo" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Two lenses in series: image of lens 1 becomes the object for lens 2. Total magnification M = M₁×M₂. Telescope: f₁≫f₂, separation = f₁+f₂. Microscope: short f₁, close object.</div>} />
  );
}