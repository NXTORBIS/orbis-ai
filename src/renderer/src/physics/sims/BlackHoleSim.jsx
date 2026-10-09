import React, { useState, useMemo, useRef } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';
import { ResearchHeader, Card, AIPanel, useAIExplain, SciTable } from '../research.jsx';

const schema = [
  { key: 'rs', label: 'Schwarzschild r_s', min: 10, max: 60, step: 2, type: 'range' },
  { key: 'b', label: 'Impact parameter b', min: 15, max: 120, step: 5, type: 'range' },
  { key: 'type', label: 'Particle type', type: 'select', options: [
    { value: 'photon', label: 'Photon (light)' },
    { value: 'massive', label: 'Massive particle' },
  ] },
];

function makeInitial(p) {
  const rs = p.rs;
  const b = p.b;
  // Start far away, moving horizontally
  const x0 = 300, y0 = b;
  const v0 = p.type === 'photon' ? 3 : 2;
  return { x: x0, y: y0, vx: -v0, vy: 0, rs, b, type: p.type, captured: false };
}

// Schwarzschild geodesic in equatorial plane (2D)
// Using effective potential: for photons, d²u/dφ² + u = 3/2 rs u²
// For massive: d²u/dφ² + u = rs/2 + 3/2 rs u² (with appropriate scaling)
function step(s, dt, p) {
  const r = Math.sqrt(s.x * s.x + s.y * s.y);
  if (r < s.rs * 0.95) { s.captured = true; return; }
  if (r > 500) return;
  // Acceleration in Cartesian: a = -GM/r² * r_hat, with GR correction
  // Leading order: a = -GM/r² (1 + 3b²/r²) for light bending
  const rs = s.rs;
  const r2 = r * r;
  const r3 = r2 * r;
  let factor;
  if (s.type === 'photon') {
    factor = -(1.5 * rs) / (r2 * r); // GR correction for photons
  } else {
    factor = -(rs / 2) / r2 - (1.5 * rs) / r3; // Newtonian + GR
  }
  s.vx += factor * s.x * dt;
  s.vy += factor * s.y * dt;
  s.x += s.vx * dt;
  s.y += s.vy * dt;
}

function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const cx = w / 2, cy = h / 2;
  const rs = s.rs;
  // event horizon
  ctx.fillStyle = '#000000';
  ctx.beginPath(); ctx.arc(cx, cy, rs, 0, Math.PI * 2); ctx.fill();
  // photon sphere
  ctx.strokeStyle = '#f9731655'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, rs * 1.5, 0, Math.PI * 2); ctx.stroke();
  // ISCO (innermost stable circular orbit)
  ctx.strokeStyle = '#22d3ee33'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, rs * 3, 0, Math.PI * 2); ctx.stroke();
  // trajectory
  if (s.trail) {
    ctx.strokeStyle = s.type === 'photon' ? '#fde047' : '#22d3ee';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < s.trail.length; i++) {
      const x = cx + s.trail[i][0], y = cy + s.trail[i][1];
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // particle
  if (!s.captured) {
    ctx.fillStyle = s.type === 'photon' ? '#fde047' : '#22d3ee';
    ctx.beginPath(); ctx.arc(cx + s.x, cy + s.y, 3, 0, Math.PI * 2); ctx.fill();
  }
  // label
  ctx.fillStyle = '#94a3b8'; ctx.font = '10px monospace';
  ctx.fillText('r_s', cx - 8, cy + 3);
}

function computeStats(s, p) {
  const r = Math.sqrt(s.x * s.x + s.y * s.y);
  const v = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
  const deflection = s.captured ? 'Captured' : (Math.atan2(s.vy, s.vx) * 180 / Math.PI).toFixed(1) + '°';
  return { 'r_s': p.rs, 'r': r.toFixed(0), 'v': v.toFixed(2), 'deflection': deflection };
}

export default function BlackHoleSim() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ rs: 30, b: 50, type: 'photon' });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats, resetKey: `${params.rs}|${params.b}|${params.type}` });
  const { explain, explaining, output } = useAIExplain();

  return (
    <div className="space-y-3">
      <ResearchHeader title="Black Hole Simulator — Schwarzschild Geodesics" subtitle="Particle trajectories near a non-rotating black hole. The event horizon (black), photon sphere (orange), and ISCO (cyan) are shown."
        onExplain={() => explain(`Black hole: r_s=${params.rs}, impact parameter b=${params.b}, particle=${params.type}. ${sim.stats.deflection === 'Captured' ? 'The particle was captured by the event horizon.' : `Deflection angle ≈ ${sim.stats.deflection}.`} Light bends by 4GM/c²b at leading order.`)} explaining={explaining} />
      <SimLayout title="Schwarzschild Geodesics" configName="blackhole" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
        controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
        stats={<StatGrid stats={sim.stats} />}
        exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="blackhole" />} />
      <AIPanel output={output} />
    </div>
  );
}