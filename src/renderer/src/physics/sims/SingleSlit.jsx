import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, LiveGraph, stageBg } from '../ui.jsx';

const schema = [
  { key: 'slitWidth', label: 'Slit width a (µm)', min: 1, max: 20, step: 0.5, type: 'range' },
  { key: 'wavelength', label: 'Wavelength λ (nm)', min: 380, max: 750, step: 10, type: 'range' },
  { key: 'screenDist', label: 'Screen dist L (m)', min: 0.5, max: 5, step: 0.1, type: 'range' },
];
function makeInitial() { return {}; }
function step() {}
function sinc(x) { return x === 0 ? 1 : Math.sin(x) / x; }
function wavelengthToRGB(wl) {
  let r = 0, g = 0, b = 0;
  if (wl >= 380 && wl < 440) { r = -(wl - 440) / 60; b = 1; }
  else if (wl < 490) { g = (wl - 440) / 50; b = 1; }
  else if (wl < 510) { g = 1; b = -(wl - 510) / 20; }
  else if (wl < 580) { r = (wl - 510) / 70; g = 1; }
  else if (wl < 645) { r = 1; g = -(wl - 645) / 65; }
  else if (wl <= 750) { r = 1; }
  return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const a = p.slitWidth * 1e-6, lambda = p.wavelength * 1e-9, L = p.screenDist;
  const color = wavelengthToRGB(p.wavelength);
  // Pattern on screen (top)
  const screenH = 60, screenY = 20;
  for (let x = 0; x < w; x++) {
    const theta = (x / w - 0.5) * 0.1;
    const beta = Math.PI * a * Math.sin(theta) / lambda;
    const sv = sinc(beta); const I = sv * sv;
    ctx.fillStyle = color; ctx.globalAlpha = I;
    ctx.fillRect(x, screenY, 1, screenH);
  }
  ctx.globalAlpha = 1;
  // Slit
  ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillRect(w / 2 - 3, h * 0.5, 6, 40);
  ctx.fillStyle = color; ctx.fillRect(w / 2 - p.slitWidth / 2, h * 0.5, p.slitWidth, 4);
  // Intensity curve
  ctx.strokeStyle = color; ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = 0; x < w; x++) {
    const theta = (x / w - 0.5) * 0.1;
    const beta = Math.PI * a * Math.sin(theta) / lambda;
    const sv2 = sinc(beta); const I = sv2 * sv2;
    const y = h - 30 - I * 100;
    if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  // Labels
  ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '10px monospace'; ctx.textAlign = 'left';
  ctx.fillText(`a = ${p.slitWidth} µm, λ = ${p.wavelength} nm`, 12, h - 16);
  const firstMin = lambda / a * L * 1000;
  ctx.fillText(`First minimum at y = λL/a = ${firstMin.toFixed(2)} mm`, 12, h - 32);
}
function computeStats(s, p) {
  const a = p.slitWidth * 1e-6, lambda = p.wavelength * 1e-9;
  const firstMin = lambda / a * p.screenDist * 1000;
  return { 'Slit a': p.slitWidth + ' µm', 'λ': p.wavelength + ' nm', 'L': p.screenDist + ' m', '1st min (λL/a)': firstMin.toFixed(2) + ' mm' };
}
export default function SingleSlit() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ slitWidth: 5, wavelength: 550, screenDist: 2 });
  const graphData = [];
  const a = params.slitWidth * 1e-6, lambda = params.wavelength * 1e-9;
  for (let i = 0; i <= 200; i++) { const theta = (i / 200 - 0.5) * 0.1; const beta = Math.PI * a * Math.sin(theta) / lambda; const sincVal = beta === 0 ? 1 : Math.sin(beta) / beta; graphData.push({ theta: +(theta * 1000).toFixed(2), I: +(sincVal * sincVal) }); }
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats });
  return (
    <SimLayout title="Single-Slit Diffraction" configName="single-slit" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      graph={<div><div className="text-xs text-muted-foreground mb-1">I(θ) = sinc²(πa sinθ/λ) — sinc² pattern</div><LiveGraph data={graphData} series={[{ key: 'I', color: '#a855f7' }]} xKey="theta" height={150} /></div>}
      exportBar={<ExportBar graphData={graphData} config={params} canvasRef={canvasRef} name="single-slit" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Single slit spreads light into a sinc² pattern: wide central maximum flanked by weaker side bands. Minima at a sinθ = mλ. Narrower slit = wider spread. The envelope modulates multi-slit patterns.</div>} />
  );
}