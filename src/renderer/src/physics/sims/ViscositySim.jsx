import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';
import { ResearchHeader, AIPanel, useAIExplain, Card } from '../research.jsx';

// Couette flow: fluid between two parallel plates, top moving at U.
// No-slip → linear velocity profile u(y) = U * (y / H).
// Shear stress τ = μ (du/dy) = μ U / H.  Viscosity ν = μ/ρ.
const schema = [
  { key: 'U', label: 'Top plate speed U (m/s)', min: 0, max: 10, step: 0.1, type: 'range' },
  { key: 'mu', label: 'Dynamic μ (mPa·s)', min: 0.5, max: 2000, step: 0.5, type: 'range' },
  { key: 'H', label: 'Gap H (mm)', min: 1, max: 50, step: 0.5, type: 'range' },
  { key: 'rho', label: 'Density ρ (kg/m³)', min: 500, max: 14000, step: 50, type: 'range' },
];

const FLUIDS = [
  { name: 'Water', mu: 1.0, rho: 1000 }, { name: 'Honey', mu: 10000, rho: 1420 }, { name: 'Air', mu: 0.018, rho: 1.2 }, { name: 'Glycerin', mu: 1412, rho: 1260 }, { name: 'Mercury', mu: 1.5, rho: 13546 },
];

function makeInitial() { return { t: 0, particles: Array.from({ length: 40 }, (_, i) => ({ y: (i + 0.5) / 40, x: Math.random() })) }; }

function step(s, dt, p) {
  s.t += dt;
  for (const pt of s.particles) {
    const u = p.U * (pt.y); // linear profile
    pt.x += u * dt * 0.05;
    if (pt.x > 1) pt.x -= 1;
  }
}

function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const padX = w * 0.15, padY = h * 0.1;
  const gap = h - 2 * padY;
  // plates
  ctx.fillStyle = 'hsl(var(--card))';
  ctx.fillRect(padX - 10, padY - 8, w - 2 * padX + 20, 8); // top plate
  ctx.fillRect(padX - 10, h - padY, w - 2 * padX + 20, 8); // bottom plate
  // plate motion arrow
  ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(w / 2, padY - 14); ctx.lineTo(w / 2 + p.U * 15, padY - 14); ctx.stroke();
  // velocity profile
  ctx.strokeStyle = '#f97316'; ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i <= 50; i++) {
    const y = i / 50;
    const u = p.U * y;
    const px = padX + (u / 10) * (w - 2 * padX) * 0.4;
    const py = padY + y * gap;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();
  // fluid layers
  for (let i = 0; i < 20; i++) {
    const y = (i + 0.5) / 20;
    const u = p.U * y;
    ctx.strokeStyle = 'rgba(34,211,238,0.15)';
    ctx.beginPath(); ctx.moveTo(padX, padY + y * gap); ctx.lineTo(padX + (u / 10) * (w - 2 * padX) * 0.4, padY + y * gap); ctx.stroke();
  }
  // particles
  for (const pt of s.particles) {
    const px = padX + pt.x * (w - 2 * padX);
    const py = padY + pt.y * gap;
    const u = p.U * pt.y;
    ctx.fillStyle = `hsl(${190 + u * 5}, 70%, 60%)`;
    ctx.beginPath(); ctx.arc(px, py, 2, 0, Math.PI * 2); ctx.fill();
  }
  // labels
  ctx.fillStyle = '#fff'; ctx.font = '11px monospace';
  ctx.fillText(`U = ${p.U.toFixed(1)} m/s →`, w / 2 - 40, padY - 18);
  ctx.fillText(`τ = μU/H = ${(p.mu * 1e-3 * p.U / (p.H * 1e-3)).toFixed(2)} Pa`, 10, h - 4);
}

function computeStats(s, p) {
  const H_m = p.H * 1e-3;
  const tau = (p.mu * 1e-3 * p.U) / H_m;
  const nu = (p.mu * 1e-3) / p.rho;
  const Re = (p.rho * p.U * H_m) / (p.mu * 1e-3);
  return {
    'Shear stress τ': `${tau.toFixed(3)} Pa`,
    'du/dy': `${(p.U / H_m).toFixed(1)} 1/s`,
    'Kinematic ν': `${(nu * 1e6).toFixed(2)} mm²/s`,
    'Re (Couette)': Re.toFixed(1),
    'Profile': 'linear (no-slip)',
    'Regime': Re < 1 ? 'Stokes (creeping)' : Re < 2300 ? 'Laminar' : 'Transitional',
  };
}

export default function ViscositySim() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ U: 3, mu: 1, H: 10, rho: 1000 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats, resetKey: `${params.U}-${params.mu}-${params.H}` });
  const { explain, explaining, output } = useAIExplain();
  return (
    <div className="space-y-3">
      <ResearchHeader title="Viscosity — Couette Flow" subtitle="No-slip condition: fluid at each plate matches the plate speed. Between parallel plates the profile is linear; shear stress τ = μ du/dy." onExplain={() => explain(`Viscosity: μ=${params.mu} mPa·s, U=${params.U}, H=${params.H}mm. ${sim.stats}`)} explaining={explaining} />
      <SimLayout title="Viscosity" configName="viscosity" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
        controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
        stats={<StatGrid stats={sim.stats} />}
        exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="viscosity" />}
        extra={<Card title="Fluid presets"><div className="flex flex-wrap gap-1.5">{FLUIDS.map((f) => <button key={f.name} onClick={() => setParams({ ...params, mu: f.mu, rho: f.rho })} className="rounded-md border border-border/60 px-2 py-0.5 text-xs hover:bg-accent">{f.name}</button>)}</div></Card>} />
      <AIPanel output={output} />
    </div>
  );
}