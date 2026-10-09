// Double-slit / diffraction — real Fraunhofer pattern
import React, { useEffect, useRef, useState } from 'react';
import { CanvasStage, stageBg, StatGrid } from '../ui.jsx';

const schema = [
  { key: 'd', label: 'Slit separation d (μm)', min: 5, max: 200, step: 1, type: 'range' },
  { key: 'a', label: 'Slit width a (μm)', min: 1, max: 80, step: 1, type: 'range' },
  { key: 'lambda', label: 'Wavelength λ (nm)', min: 380, max: 750, step: 5, type: 'range' },
  { key: 'L', label: 'Screen distance L (m)', min: 0.2, max: 5, step: 0.1, type: 'range' },
  { key: 'mode', label: 'Pattern', type: 'select', options: [{ value: 'double', label: 'Double slit' }, { value: 'single', label: 'Single slit' }, { value: 'grating', label: 'Grating (5 slits)' }] },
];

function wavelengthToColor(nm) {
  // approximate visible spectrum mapping
  let r = 0, g = 0, b = 0;
  if (nm < 440) { r = (440 - nm) / 60; b = 1; } else if (nm < 490) { g = (nm - 440) / 50; b = 1; } else if (nm < 510) { g = 1; b = (510 - nm) / 20; } else if (nm < 580) { r = (nm - 510) / 70; g = 1; } else if (nm < 645) { r = 1; g = (645 - nm) / 65; } else { r = 1; }
  return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
}

export default function DoubleSlit() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ d: 50, a: 10, lambda: 550, L: 1, mode: 'double' });
  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return; const ctx = cv.getContext('2d'); const w = cv.width, h = cv.height;
    stageBg(ctx, w, h);
    const lam = params.lambda * 1e-9; const d = params.d * 1e-6, a = params.a * 1e-6;
    const yMax = 0.05; const samples = 600;
    const I = new Array(samples);
    for (let i = 0; i < samples; i++) {
      const y = (i / samples - 0.5) * 2 * yMax;
      const sinTh = y / Math.sqrt(params.L * params.L + y * y);
      let intensity;
      if (params.mode === 'single') { const beta = Math.PI * a * sinTh / lam; intensity = (Math.abs(beta) < 1e-9 ? 1 : (Math.sin(beta) / beta) ** 2); }
      else if (params.mode === 'double') { const alpha = Math.PI * d * sinTh / lam; const beta = Math.PI * a * sinTh / lam; intensity = (Math.abs(beta) < 1e-9 ? 1 : (Math.sin(beta) / beta) ** 2) * Math.cos(alpha) ** 2; }
      else { const N = 5; const alpha = Math.PI * d * sinTh / lam; const beta = Math.PI * a * sinTh / lam; intensity = (Math.abs(beta) < 1e-9 ? 1 : (Math.sin(beta) / beta) ** 2) * (Math.sin(N * alpha) / (N * Math.sin(alpha))) ** 2; }
      I[i] = intensity;
    }
    const maxI = Math.max(...I);
    // screen pattern
    const screenH = h * 0.55; const screenY = 0;
    for (let i = 0; i < samples; i++) { const x = (i / samples) * w; const v = I[i] / maxI; ctx.fillStyle = wavelengthToColor(params.lambda); ctx.globalAlpha = v; ctx.fillRect(x, screenY, w / samples + 1, screenH); }
    ctx.globalAlpha = 1;
    // intensity curve
    const padX = 0, baseY = h - 10, plotH = h * 0.35;
    ctx.strokeStyle = 'white'; ctx.lineWidth = 1.5; ctx.beginPath();
    for (let i = 0; i < samples; i++) { const x = (i / samples) * w; const y = baseY - (I[i] / maxI) * plotH; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.stroke();
  }, [params]);
  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr_300px]">
      <div className="space-y-2">
        {schema.map((p) => (
          <label key={p.key} className="block text-sm">
            <div className="flex items-center justify-between"><span className="text-muted-foreground">{p.label}</span><span className="font-mono text-xs">{params[p.key]}{p.type === 'select' ? '' : p.key === 'lambda' ? ' nm' : ' μm'}</span></div>
            {p.type === 'select'
              ? <select value={params[p.key]} onChange={(e) => setParams({ ...params, [p.key]: e.target.value })} className="mt-1 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm">{p.options.map((o) => <option key={o.value} value={o.value} className="bg-background">{o.label}</option>)}</select>
              : <input type="range" min={p.min} max={p.max} step={p.step} value={params[p.key]} onChange={(e) => setParams({ ...params, [p.key]: +e.target.value })} className="w-full accent-cyan-500" />}
          </label>
        ))}
      </div>
      <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden" style={{ height: 380 }}><CanvasStage ref={canvasRef} /></div>
      <div className="space-y-3">
        <StatGrid stats={{ 'λ': `${params.lambda} nm`, 'd': `${params.d} μm`, 'a': `${params.a} μm`, 'L': `${params.L} m`, 'v=fλ': `${(3e8 / (params.lambda * 1e-9)).toExponential(2)} Hz`, 'Fringe Δy': `${(params.lambda * 1e-9 * params.L / (params.d * 1e-6) * 1e3).toFixed(2)} mm` }} />
        <div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Real Fraunhofer diffraction: I(θ)=(sin β/β)²·(cos α)² (double), with β=πa sinθ/λ, α=πd sinθ/λ. Top = colour screen pattern, bottom = intensity curve.</div>
      </div>
    </div>
  );
}