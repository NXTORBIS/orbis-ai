import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, LiveGraph, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

// Unique particle-collision engine: 2→2 scattering with relativistic
// kinematics in the centre-of-mass frame. Visualises incoming beams,
// the COM system, and outgoing products with momentum vectors.

const c = 1; // natural units (energy in MeV, momentum in MeV/c)

const PRESETS = [
  { name: 'e⁻ + e⁻ → μ⁻ + μ⁻', m1: 0.511, m2: 0.511, m3: 105.7, m4: 105.7, Ebeam: 200 },
  { name: 'p + p → p + p (elastic)', m1: 938, m2: 938, m3: 938, m4: 938, Ebeam: 1000 },
  { name: 'p + p → p + p + π⁰', m1: 938, m2: 938, m3: 938, m4: 938, m5: 135, Ebeam: 5000 },
  { name: 'e + p → e + p (deep inelastic)', m1: 0.511, m2: 938, m3: 0.511, m4: 938, Ebeam: 10000 },
];

const schema = [
  { key: 'preset', label: 'Reaction', type: 'select', options: PRESETS.map((p, i) => ({ value: i, label: p.name })) },
  { key: 'Ebeam', label: 'Beam energy (MeV)', min: 10, max: 20000, step: 10, type: 'range' },
  { key: 'angle', label: 'Scatter angle θ (°)', min: 0, max: 180, step: 5, type: 'range' },
];

function gamma(v) { return 1 / Math.sqrt(1 - v * v); }
function energyFromP(p, m) { return Math.sqrt(p * p + m * m); }

function compute(p) {
  const pr = PRESETS[p.preset];
  const m1 = pr.m1, m2 = pr.m2, m3 = pr.m3, m4 = pr.m4;
  // Particle 1 has total energy Ebeam, particle 2 at rest
  const E1 = p.Ebeam;
  const p1z = Math.sqrt(E1 * E1 - m1 * m1);
  // COM energy
  const s = m1 * m1 + m2 * m2 + 2 * m2 * E1;
  const sqrtS = Math.sqrt(s);
  // COM momenta
  const pCM = Math.sqrt(Math.max(0, (s - (m1 + m2) ** 2) * (s - (m1 - m2) ** 2))) / (2 * sqrtS);
  // Outgoing in COM: isotropic at angle θ
  const theta = p.angle * Math.PI / 180;
  const p3CM = Math.sqrt(Math.max(0, (s - (m3 + m4) ** 2) * (s - (m3 - m4) ** 2))) / (2 * sqrtS);
  const E3CM = Math.sqrt(p3CM * p3CM + m3 * m3);
  const E4CM = Math.sqrt(p3CM * p3CM + m4 * m4);
  // Boost back to lab: beta_CM = p1z / (E1 + m2)
  const betaCM = p1z / (E1 + m2);
  const gammaCM = 1 / Math.sqrt(1 - betaCM * betaCM);
  // Particle 3 in lab
  const p3x = p3CM * Math.sin(theta);
  const p3z = gammaCM * (p3CM * Math.cos(theta) + betaCM * E3CM);
  const E3lab = gammaCM * (E3CM + betaCM * p3CM * Math.cos(theta));
  // Particle 4 in lab (opposite in COM)
  const p4x = -p3CM * Math.sin(theta);
  const p4z = gammaCM * (-p3CM * Math.cos(theta) + betaCM * E4CM);
  const E4lab = gammaCM * (E4CM - betaCM * p3CM * Math.cos(theta));
  return { sqrtS, p1z, p3x, p3z, p4x, p4z, E3lab, E4lab, betaCM, pr };
}

function makeInitial(p) { return { phase: 0, particles: [] }; }
function step(s, dt, p) {
  s.phase += dt * 0.5;
  if (s.phase > 1) s.phase = 0;
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const r = compute(p);
  const cx = w / 2, cy = h / 2;
  const scale = Math.min(w, h) * 0.3 / Math.max(1, r.p1z);
  // Beam axis
  ctx.strokeStyle = 'hsl(var(--border))'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(20, cy); ctx.lineTo(w - 20, cy); ctx.stroke();
  // Incoming particle 1 (left to center)
  const x1 = 20 + (cx - 20) * s.phase;
  ctx.fillStyle = '#22d3ee'; ctx.beginPath(); ctx.arc(x1, cy, 4, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#22d3ee80'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(20, cy); ctx.lineTo(x1, cy); ctx.stroke();
  // Incoming particle 2 (at rest, center)
  ctx.fillStyle = '#f97316'; ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();
  // After collision: outgoing particles
  if (s.phase > 0.5) {
    const f = (s.phase - 0.5) * 2;
    const x3 = cx + r.p3x * scale * f * 2;
    const y3 = cy - r.p3z * scale * f * 2 * 0.3;
    const x4 = cx + r.p4x * scale * f * 2;
    const y4 = cy - r.p4z * scale * f * 2 * 0.3;
    ctx.fillStyle = '#a855f7'; ctx.beginPath(); ctx.arc(x3, y3, 4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#a855f780'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x3, y3); ctx.stroke();
    ctx.fillStyle = '#84cc16'; ctx.beginPath(); ctx.arc(x4, y4, 4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#84cc1680'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x4, y4); ctx.stroke();
  }
  // Labels
  ctx.fillStyle = 'hsl(var(--muted-foreground))'; ctx.font = '9px monospace';
  ctx.fillText('beam →', 4, cy - 8);
  ctx.fillText('target', cx - 12, cy + 18);
}
function sample(s, p, t) { return { phase: s.phase }; }
function computeStats(s, p) {
  const r = compute(p);
  return { '√s (MeV)': r.sqrtS.toFixed(1), 'E₁ (MeV)': p.Ebeam.toFixed(0), 'p₁z': r.p1z.toFixed(1), 'β_CM': r.betaCM.toFixed(4), 'E₃ lab': r.E3lab.toFixed(1), 'E₄ lab': r.E4lab.toFixed(1) };
}

export default function ParticleCollisionSim() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ preset: 0, Ebeam: 200, angle: 90 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, sample, computeStats, resetKey: `${params.preset}|${params.Ebeam}|${params.angle}` });
  return (
    <SimLayout title="Particle Collision (COM Kinematics)" configName="particle-collision" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      graph={<LiveGraph data={sim.graphData} xKey="t" series={[{ key: 'phase', color: '#22d3ee' }]} />}
      exportBar={<ExportBar graphData={sim.graphData} config={params} canvasRef={canvasRef} name="particle-collision" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Relativistic 2→2 scattering. Cyan = incoming beam, orange = target at rest, purple/lime = outgoing products. √s = invariant mass of the COM system. Boost from COM to lab via β_CM = p₁/(E₁+m₂).</div>} />
  );
}