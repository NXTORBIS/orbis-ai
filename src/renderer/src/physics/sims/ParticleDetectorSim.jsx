import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, LiveGraph, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

// Unique particle-detector engine: simulates a cross-section of a collider
// detector (tracker, ECAL, HCAL, muon chamber). Particles are generated at
// the interaction point and leave signatures according to their type:
//   e⁻:    bend in tracker (EM), full stop in ECAL
//   γ:     no tracker signal, full stop in ECAL
//   μ⁻:    bends in tracker, passes through ECAL+HCAL, stops in muon chamber
//   hadron: bends in tracker, partial ECAL, full stop in HCAL
//   neutrino: invisible (missing energy)

const PARTICLE_TYPES = [
  { name: 'e⁻',    color: '#22d3ee', charge: -1, mass: 0.511,  key: 'electron' },
  { name: 'γ',     color: '#a855f7', charge: 0,  mass: 0,      key: 'photon' },
  { name: 'μ⁻',    color: '#f97316', charge: -1, mass: 105.7, key: 'muon' },
  { name: 'π⁺',    color: '#84cc16', charge: 1,  mass: 139.6,  key: 'hadron' },
  { name: 'ν',     color: '#475569', charge: 0,  mass: 0,      key: 'neutrino' },
];

const schema = [
  { key: 'B', label: 'Magnetic field B (T)', min: 0, max: 4, step: 0.1, type: 'range' },
  { key: 'rate', label: 'Event rate', min: 0.2, max: 5, step: 0.2, type: 'range' },
  { key: 'showNeutrino', label: 'Show ν (missing E)', type: 'toggle' },
];

// Detector regions (x boundaries in canvas px)
const TRACKER_END = 140;
const ECAL_END = 200;
const HCAL_END = 270;
const MUON_END = 360;

function makeInitial(p) { return { particles: [], events: 0, counts: { tracker: 0, ecal: 0, hcal: 0, muon: 0, missing: 0 } }; }
function step(s, dt, p) {
  // Generate new particles
  if (Math.random() < p.rate * dt) {
    const t = PARTICLE_TYPES[Math.floor(Math.random() * (p.showNeutrino ? 5 : 4))];
    const angle = (Math.random() - 0.5) * Math.PI * 0.8;
    const speed = 100 + Math.random() * 80;
    s.particles.push({
      x: 180, y: 200, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      type: t, alive: true, stopped: false, trail: [{ x: 180, y: 200 }],
    });
    s.events++;
  }
  for (const pt of s.particles) {
    if (!pt.alive) continue;
    // Bending in tracker (only charged)
    if (pt.type.charge !== 0 && pt.x < TRACKER_END) {
      const bend = p.B * pt.type.charge * 0.02;
      const tmp = pt.vx;
      pt.vx -= pt.vy * bend * dt * 50;
      pt.vy += tmp * bend * dt * 50;
    }
    pt.x += pt.vx * dt; pt.y += pt.vy * dt;
    pt.trail.push({ x: pt.x, y: pt.y });
    if (pt.trail.length > 200) pt.trail.shift();
    // Detector interactions
    if (pt.type.key === 'electron') {
      if (pt.x > ECAL_END) { pt.alive = false; s.counts.ecal++; }
    } else if (pt.type.key === 'photon') {
      if (pt.x > ECAL_END) { pt.alive = false; s.counts.ecal++; }
    } else if (pt.type.key === 'muon') {
      if (pt.x > MUON_END) { pt.alive = false; s.counts.muon++; }
    } else if (pt.type.key === 'hadron') {
      if (pt.x > HCAL_END) { pt.alive = false; s.counts.hcal++; }
    } else if (pt.type.key === 'neutrino') {
      if (pt.x > MUON_END) { pt.alive = false; s.counts.missing++; }
    }
    if (pt.x > 400 || pt.y < 0 || pt.y > 400) pt.alive = false;
  }
  s.particles = s.particles.filter((pt) => pt.alive || pt.trail.length > 1);
  s.particles = s.particles.slice(-50);
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  // Detector layers
  const layers = [
    { x0: 40, x1: TRACKER_END, color: '#22d3ee20', label: 'Tracker' },
    { x0: TRACKER_END, x1: ECAL_END, color: '#a855f720', label: 'ECAL' },
    { x0: ECAL_END, x1: HCAL_END, color: '#f9731620', label: 'HCAL' },
    { x0: HCAL_END, x1: MUON_END, color: '#84cc1620', label: 'Muon' },
  ];
  for (const l of layers) {
    ctx.fillStyle = l.color; ctx.fillRect(l.x0, 20, l.x1 - l.x0, h - 40);
    ctx.strokeStyle = 'hsl(var(--border))'; ctx.strokeRect(l.x0, 20, l.x1 - l.x0, h - 40);
    ctx.fillStyle = 'hsl(var(--muted-foreground))'; ctx.font = '8px monospace';
    ctx.fillText(l.label, l.x0 + 4, 32);
  }
  // Interaction point
  ctx.fillStyle = '#fde047'; ctx.beginPath(); ctx.arc(180, h / 2, 3, 0, Math.PI * 2); ctx.fill();
  // Particles
  for (const pt of s.particles) {
    if (pt.trail.length < 2) continue;
    ctx.strokeStyle = pt.type.color; ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < pt.trail.length; i++) {
      const t = pt.trail[i];
      if (i === 0) ctx.moveTo(t.x, t.y); else ctx.lineTo(t.x, t.y);
    }
    ctx.stroke();
    if (pt.alive) {
      ctx.fillStyle = pt.type.color;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, 2, 0, Math.PI * 2); ctx.fill();
    }
  }
}
function sample(s, p, t) { return { events: s.events, active: s.particles.filter((p) => p.alive).length }; }
function computeStats(s, p) {
  return { 'Events': s.events, 'Tracker hits': s.counts.tracker, 'ECAL hits': s.counts.ecal, 'HCAL hits': s.counts.hcal, 'Muon hits': s.counts.muon, 'Missing E (ν)': s.counts.missing };
}

export default function ParticleDetectorSim() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ B: 2, rate: 2, showNeutrino: true });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, sample, computeStats, resetKey: `${params.B}|${params.showNeutrino}` });
  return (
    <SimLayout title="Particle Detector" configName="particle-detector" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      graph={<LiveGraph data={sim.graphData} xKey="t" series={[{ key: 'events', color: '#22d3ee' }, { key: 'active', color: '#f97316' }]} />}
      exportBar={<ExportBar graphData={sim.graphData} config={params} canvasRef={canvasRef} name="particle-detector" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Collider detector cross-section: Tracker (charged particles bend in B field), ECAL (electrons/photons stop), HCAL (hadrons stop), Muon chamber (muons pass through). Neutrinos are invisible — detected as missing energy. PID from where each particle stops.</div>} />
  );
}