// Energy Eigenvalues — compares discrete vs continuous spectra across
// different potentials. Shows how boundary conditions produce quantisation:
// infinite well (discrete n²), harmonic oscillator (discrete n+½), and
// free particle (continuous).
import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

const schema = [
  { key: 'system', label: 'System', type: 'select', options: [{ value: 'infwell', label: 'Infinite well (Eₙ = n²π²/2)' }, { value: 'ho', label: 'Harmonic oscillator (Eₙ = n+½)' }, { value: 'free', label: 'Free particle (continuous)' }, { value: 'compare', label: 'Compare all three' }] },
  { key: 'nmax', label: 'Max levels to show', min: 3, max: 10, step: 1, type: 'range' },
];

function makeInitial() { return {}; }
function step() {}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const padX = 50, padY = 30; const W = w - 2 * padX, H = h - 2 * padY; const baseY = padY + H;
  const systems = p.system === 'compare' ? ['infwell', 'ho', 'free'] : [p.system];
  const colW = W / systems.length;
  const Emax = p.nmax * p.nmax * Math.PI * Math.PI / 2 * 1.1;
  const Y = (E) => baseY - (E / Emax) * H * 0.85;
  for (let si = 0; si < systems.length; si++) {
    const sys = systems[si]; const cx = padX + si * colW;
    ctx.fillStyle = 'hsl(var(--muted-foreground))'; ctx.font = '11px monospace'; ctx.textAlign = 'center';
    ctx.fillText(sys === 'infwell' ? 'Infinite Well' : sys === 'ho' ? 'Harmonic Osc.' : 'Free Particle', cx + colW / 2, padY - 6); ctx.textAlign = 'left';
    if (sys === 'infwell') {
      for (let n = 1; n <= p.nmax; n++) { const En = (n * n * Math.PI * Math.PI) / 2; const y = Y(En); ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx + 10, y); ctx.lineTo(cx + colW - 10, y); ctx.stroke(); ctx.fillStyle = '#22d3ee'; ctx.font = '9px monospace'; ctx.fillText(`${En.toFixed(1)}`, cx + colW - 30, y + 3); }
    } else if (sys === 'ho') {
      for (let n = 0; n < p.nmax; n++) { const En = n + 0.5; const y = Y(En * 5); ctx.strokeStyle = '#f97316'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx + 10, y); ctx.lineTo(cx + colW - 10, y); ctx.stroke(); ctx.fillStyle = '#f97316'; ctx.font = '9px monospace'; ctx.fillText(`${En.toFixed(1)}`, cx + colW - 30, y + 3); }
    } else {
      // continuous band
      ctx.fillStyle = '#a855f733'; ctx.fillRect(cx + 10, padY, colW - 20, H * 0.85);
      ctx.strokeStyle = '#a855f7'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx + 10, Y(0)); ctx.lineTo(cx + colW - 10, Y(0)); ctx.stroke();
      ctx.fillStyle = '#a855f7'; ctx.font = '9px monospace'; ctx.fillText('E ≥ 0', cx + colW / 2 - 12, padY + 14);
    }
  }
  ctx.fillStyle = 'hsl(var(--muted-foreground))'; ctx.font = '10px monospace'; ctx.fillText('E ↑', padX - 16, padY + 4);
}
function computeStats(s, p) {
  const inf = (1 * 1 * Math.PI * Math.PI) / 2; const ho = 0.5;
  return { 'System': p.system, 'E₁ (well)': inf.toFixed(3), 'E₀ (HO)': ho.toFixed(3), 'Well spacing': 'grows as n²', 'HO spacing': 'constant 1', 'Free': 'continuous' };
}

export default function EnergyEigenvalues() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ system: 'compare', nmax: 6 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats, resetKey: `${params.system}|${params.nmax}` });
  return (
    <SimLayout title="Energy Eigenvalues (Spectra)" configName="energy-eigenvalues" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="energy-eigenvalues" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Boundary conditions determine the spectrum. Infinite well: Eₙ = n²π²/2 (levels spread apart). Harmonic oscillator: Eₙ = n+½ (evenly spaced). Free particle: continuous E ≥ 0 (no quantisation). Compare all three side by side.</div>} />
  );
}