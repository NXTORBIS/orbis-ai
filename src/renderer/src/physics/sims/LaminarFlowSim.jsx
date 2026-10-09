import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';
import { ResearchHeader, AIPanel, useAIExplain, Card } from '../research.jsx';

// Laminar Poiseuille flow in a pipe: u(r) = u_max (1 - r²/R²).
// Parabolic profile, low Reynolds number (Re < 2300). Streamlines parallel.
const schema = [
  { key: 'uMax', label: 'Max speed u_max (m/s)', min: 0.1, max: 5, step: 0.05, type: 'range' },
  { key: 'R', label: 'Pipe radius R (cm)', min: 0.5, max: 10, step: 0.1, type: 'range' },
  { key: 'rho', label: 'Density ρ (kg/m³)', min: 500, max: 14000, step: 50, type: 'range' },
  { key: 'mu', label: 'Viscosity μ (mPa·s)', min: 0.5, max: 100, step: 0.5, type: 'range' },
];

function makeInitial() { return { particles: Array.from({ length: 60 }, (_, i) => ({ r: (i / 60) * 2 - 1, x: Math.random() })) }; }

function step(s, dt, p) {
  for (const pt of s.particles) {
    const u = p.uMax * (1 - pt.r * pt.r);
    pt.x += u * dt * 0.08;
    if (pt.x > 1) pt.x -= 1;
  }
}

function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const padX = w * 0.1, cy = h / 2, Rpix = Math.min(h * 0.35, p.R * 20);
  // pipe walls
  ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(padX, cy - Rpix); ctx.lineTo(w - padX, cy - Rpix); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(padX, cy + Rpix); ctx.lineTo(w - padX, cy + Rpix); ctx.stroke();
  // parabolic profile
  ctx.strokeStyle = '#f97316'; ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i <= 60; i++) {
    const r = (i / 60) * 2 - 1;
    const u = p.uMax * (1 - r * r);
    const px = padX + (u / 5) * (w - 2 * padX) * 0.5;
    const py = cy + r * Rpix;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();
  // velocity arrows
  for (let i = 1; i < 12; i++) {
    const r = (i / 12) * 2 - 1;
    const u = p.uMax * (1 - r * r);
    const px = padX + 20, py = cy + r * Rpix;
    const len = (u / 5) * 60;
    ctx.strokeStyle = `hsl(${190 + u * 10}, 70%, 55%)`;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + len, py); ctx.stroke();
  }
  // particles
  for (const pt of s.particles) {
    const px = padX + pt.x * (w - 2 * padX);
    const py = cy + pt.r * Rpix;
    const u = p.uMax * (1 - pt.r * pt.r);
    ctx.fillStyle = `hsl(${190 + u * 15}, 70%, 60%)`;
    ctx.beginPath(); ctx.arc(px, py, 2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#fff'; ctx.font = '11px monospace';
  ctx.fillText(`u(r) = u_max(1 − r²/R²)`, 10, h - 6);
}

function computeStats(s, p) {
  const R_m = p.R * 1e-2;
  const u_avg = p.uMax / 2;
  const Q = Math.PI * R_m * R_m * u_avg;
  const Re = (p.rho * u_avg * 2 * R_m) / (p.mu * 1e-3);
  return {
    'u_max': `${p.uMax.toFixed(2)} m/s`,
    'u_avg': `${u_avg.toFixed(3)} m/s`,
    'Flow rate Q': `${(Q * 1e6).toFixed(2)} mL/s`,
    'Re': Re.toFixed(1),
    'Profile': 'parabolic',
    'Regime': Re < 2300 ? 'Laminar ✓' : 'Transitional/Turbulent',
  };
}

export default function LaminarFlowSim() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ uMax: 1, R: 2, rho: 1000, mu: 1 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats, resetKey: `${params.uMax}-${params.R}` });
  const { explain, explaining, output } = useAIExplain();
  return (
    <div className="space-y-3">
      <ResearchHeader title="Laminar Flow — Poiseuille Profile" subtitle="Smooth, parallel, layered flow at low Reynolds number. Velocity profile is parabolic: u(r) = u_max(1 − r²/R²), zero at walls (no-slip)." onExplain={() => explain(`Laminar flow: u_max=${params.uMax}, R=${params.R}cm. ${sim.stats}`)} explaining={explaining} />
      <SimLayout title="Laminar Flow" configName="laminar" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
        controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
        stats={<StatGrid stats={sim.stats} />}
        exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="laminar" />}
        extra={<Card><p className="text-xs text-muted-foreground">Orange curve = parabolic velocity profile. Particles near the centre move fastest; those near the wall are nearly stationary. Re &lt; 2300 keeps flow laminar.</p></Card>} />
      <AIPanel output={output} />
    </div>
  );
}