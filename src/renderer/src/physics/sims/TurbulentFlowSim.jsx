import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';
import { ResearchHeader, AIPanel, useAIExplain, Card } from '../research.jsx';

// Turbulent flow: high-Re flow past a cylinder → Kármán vortex street.
// Synthetic turbulent velocity field (sum of random Fourier modes) advects
// particles past an obstacle, showing eddies, mixing, and the energy cascade.
const N = 60;
const schema = [
  { key: 'Re', label: 'Reynolds number Re', min: 100, max: 100000, step: 100, type: 'range' },
  { key: 'obstacle', label: 'Cylinder radius', min: 3, max: 12, step: 1, type: 'range' },
  { key: 'modes', label: 'Turbulent modes', min: 4, max: 20, step: 1, type: 'range' },
];

function makeInitial(p) {
  const modes = [];
  for (let i = 0; i < 20; i++) {
    modes.push({ kx: (Math.random() - 0.5) * 0.3, ky: (Math.random() - 0.5) * 0.3, phase: Math.random() * 6.28, amp: Math.random() });
  }
  const particles = [];
  for (let i = 0; i < 400; i++) particles.push({ x: Math.random(), y: Math.random(), c: Math.random() });
  return { modes, particles, t: 0 };
}

function turbField(x, y, t, modes, Re) {
  const intensity = Math.min(1, Math.log(Re) / 12);
  let u = 1, v = 0;
  for (const m of modes) {
    const phase = m.kx * x * 10 + m.ky * y * 10 + m.phase + t * 2;
    u += m.amp * Math.sin(phase) * intensity * 0.5;
    v += m.amp * Math.cos(phase) * intensity * 0.5;
  }
  return [u, v];
}

function step(s, dt, p) {
  s.t += dt;
  const cx = 0.25, cy = 0.5, r = p.obstacle / N;
  for (const pt of s.particles) {
    const [u, v] = turbField(pt.x, pt.y, s.t, s.modes, p.Re);
    pt.x += u * dt * 0.15;
    pt.y += v * dt * 0.15;
    // bypass obstacle
    const dx = pt.x - cx, dy = pt.y - cy;
    if (dx * dx + dy * dy < r * r) { pt.x = cx + (dx / Math.hypot(dx, dy)) * r; pt.y = cy + (dy / Math.hypot(dx, dy)) * r; }
    if (pt.x > 1.05) { pt.x = -0.05; pt.y = Math.random(); pt.c = Math.random(); }
    if (pt.x < -0.05) pt.x = 1.05;
    if (pt.y < 0) pt.y = 0; if (pt.y > 1) pt.y = 1;
  }
}

function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const cx = 0.25 * w, cy = 0.5 * h, r = (p.obstacle / N) * w;
  // particles coloured by their initial hue
  for (const pt of s.particles) {
    ctx.fillStyle = `hsl(${pt.c * 360}, 70%, 60%)`;
    ctx.globalAlpha = 0.7;
    ctx.fillRect(pt.x * w - 1, pt.y * h - 1, 2.5, 2.5);
  }
  ctx.globalAlpha = 1;
  // obstacle
  ctx.fillStyle = 'hsl(var(--card))';
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 1.5; ctx.stroke();
}

function computeStats(s, p) {
  const intensity = Math.min(1, Math.log(p.Re) / 12);
  return {
    'Re': p.Re.toExponential(0),
    'Turbulence intensity': intensity.toFixed(3),
    'Modes': Math.floor(p.modes),
    'Regime': p.Re < 40 ? 'Steady' : p.Re < 200 ? 'Vortex street' : p.Re < 2000 ? 'Transitional' : 'Turbulent',
    'Eddy scale': 'multiple (cascade)',
    'Mixing': p.Re > 1000 ? 'strong' : 'moderate',
  };
}

export default function TurbulentFlowSim() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ Re: 5000, obstacle: 6, modes: 12 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats, resetKey: `${params.Re}-${params.modes}` });
  const { explain, explaining, output } = useAIExplain();
  return (
    <div className="space-y-3">
      <ResearchHeader title="Turbulent Flow — Vortex Shedding" subtitle="High-Re flow past a cylinder sheds a Kármán vortex street. Particles (coloured by origin) mix chaotically — the energy cascade transfers energy from large to small eddies." onExplain={() => explain(`Turbulent flow: Re=${params.Re}, ${sim.stats}`)} explaining={explaining} />
      <SimLayout title="Turbulent Flow" configName="turbulent" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
        controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
        stats={<StatGrid stats={sim.stats} />}
        exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="turbulent" />}
        extra={<Card><p className="text-xs text-muted-foreground">Particles coloured by entry position show mixing. At high Re the inertial cascade dominates viscosity; at low Re you see a steady recirculation. This is a synthetic turbulent field — real DNS resolves all scales.</p></Card>} />
      <AIPanel output={output} />
    </div>
  );
}