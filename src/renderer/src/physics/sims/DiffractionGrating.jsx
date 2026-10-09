import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, LiveGraph, stageBg } from '../ui.jsx';

const schema = [
  { key: 'N', label: 'Number of slits N', min: 2, max: 50, step: 1, type: 'range' },
  { key: 'spacing', label: 'Slit spacing d (µm)', min: 2, max: 20, step: 0.5, type: 'range' },
  { key: 'wavelength', label: 'Wavelength λ (nm)', min: 380, max: 750, step: 10, type: 'range' },
];
function makeInitial() { return {}; }
function step() {}
function wavelengthToRGB(wl) {
  let r = 0, g = 0, b = 0;
  if (wl >= 380 && wl < 440) { r = -(wl - 440) / 60; b = 1; } else if (wl < 490) { g = (wl - 440) / 50; b = 1; } else if (wl < 510) { g = 1; b = -(wl - 510) / 20; } else if (wl < 580) { r = (wl - 510) / 70; g = 1; } else if (wl < 645) { r = 1; g = -(wl - 645) / 65; } else if (wl <= 750) { r = 1; }
  return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const d = p.spacing * 1e-6, lambda = p.wavelength * 1e-9, N = Math.round(p.N);
  const color = wavelengthToRGB(p.wavelength);
  // Pattern
  const screenH = 60, screenY = 20;
  for (let x = 0; x < w; x++) {
    const theta = (x / w - 0.5) * 0.06;
    const beta = Math.PI * d * Math.sin(theta) / lambda;
    const ratio = N > 1 ? Math.sin(N * beta) / (N * Math.sin(beta)) : 1;
    const I = ratio * ratio;
    ctx.fillStyle = color; ctx.globalAlpha = Math.min(1, I);
    ctx.fillRect(x, screenY, 1, screenH);
  }
  ctx.globalAlpha = 1;
  // Slits
  for (let i = 0; i < Math.min(N, 10); i++) { ctx.fillStyle = color; ctx.fillRect(w / 2 + (i - N / 2) * 3, h * 0.5, 1.5, 30); }
  // Intensity curve
  ctx.strokeStyle = color; ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = 0; x < w; x++) {
    const theta = (x / w - 0.5) * 0.06;
    const beta = Math.PI * d * Math.sin(theta) / lambda;
    const ratio2 = N > 1 ? Math.sin(N * beta) / (N * Math.sin(beta)) : 1;
    const I = ratio2 * ratio2;
    const y = h - 30 - I * 100;
    if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '10px monospace'; ctx.textAlign = 'left';
  ctx.fillText(`N=${N} slits, d=${p.spacing} µm, λ=${p.wavelength} nm`, 12, h - 16);
  ctx.fillText('Peaks sharpen as N increases (width ∝ 1/N)', 12, h - 32);
}
function computeStats(s, p) { const d = p.spacing * 1e-6, lambda = p.wavelength * 1e-9; return { 'N slits': Math.round(p.N), 'd': p.spacing + ' µm', 'λ': p.wavelength + ' nm', 'Peak width': '∝ 1/N' }; }
export default function DiffractionGrating() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ N: 10, spacing: 5, wavelength: 550 });
  const graphData = [];
  const d = params.spacing * 1e-6, lambda = params.wavelength * 1e-9, N = Math.round(params.N);
  for (let i = 0; i <= 300; i++) { const theta = (i / 300 - 0.5) * 0.06; const beta = Math.PI * d * Math.sin(theta) / lambda; const ratio = N > 1 ? Math.sin(N * beta) / (N * Math.sin(beta)) : 1; const I = ratio * ratio; graphData.push({ theta: +(theta * 1000).toFixed(3), I: +I.toFixed(4) }); }
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats });
  return (
    <SimLayout title="Diffraction Grating" configName="diffraction-grating" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      graph={<div><div className="text-xs text-muted-foreground mb-1">N-slit interference: sharp peaks at d sinθ = mλ</div><LiveGraph data={graphData} series={[{ key: 'I', color: '#a855f7' }]} xKey="theta" height={150} /></div>}
      exportBar={<ExportBar graphData={graphData} config={params} canvasRef={canvasRef} name="diffraction-grating" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">N slits: d sinθ = mλ. More slits → sharper, brighter peaks (width ∝ 1/N). White light splits into rainbow spectra at each order. Basis of spectroscopy, CD/DVD reading.</div>} />
  );
}