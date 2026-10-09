import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, LiveGraph, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

// Unique alpha/beta/gamma decay engine: visualizes the three disintegration
// modes with their distinct penetration depths in matter. Alpha (stopped by
// paper), beta (stopped by aluminium), gamma (stopped by lead).

const MODES = {
  alpha: { label: 'Alpha (α)', color: '#ef4436', mass: 4, charge: 2, range: 40,  Q: 5.0 },
  beta:  { label: 'Beta (β⁻)', color: '#22d3ee', mass: 0.0005, charge: -1, range: 120, Q: 1.0 },
  gamma: { label: 'Gamma (γ)', color: '#a855f7', mass: 0, charge: 0, range: 280, Q: 2.0 },
};

const BARRIERS = [
  { name: 'Vacuum',   stop: 0,    color: 'hsl(var(--card))' },
  { name: 'Paper',    stop: 50,   color: '#fef3c7' },
  { name: 'Aluminium',stop: 130,  color: '#94a3b8' },
  { name: 'Lead',     stop: 260,  color: '#475569' },
];

const schema = [
  { key: 'mode', label: 'Decay mode', type: 'select', options: Object.entries(MODES).map(([v, m]) => ({ value: v, label: m.label })) },
  { key: 'barrier', label: 'Barrier', type: 'select', options: BARRIERS.map((b, i) => ({ value: i, label: b.name })) },
  { key: 'rate', label: 'Emission rate', min: 1, max: 20, step: 1, type: 'range' },
];

function makeInitial(p) { return { particles: [], emitted: 0, absorbed: 0 }; }
function step(s, dt, p) {
  const m = MODES[p.mode];
  const barrier = BARRIERS[p.barrier];
  // Emit new particles
  if (Math.random() < p.rate * dt) {
    s.particles.push({ x: 30, y: 80 + Math.random() * 200, vx: 80 + Math.random() * 40, vy: (Math.random() - 0.5) * 10, E: m.Q, alive: true });
    s.emitted++;
  }
  for (const pt of s.particles) {
    if (!pt.alive) continue;
    pt.x += pt.vx * dt; pt.y += pt.vy * dt;
    // Check barrier stopping
    if (barrier.stop > 0 && pt.x > barrier.stop && m.range < barrier.stop) {
      pt.alive = false; s.absorbed++;
    }
    // Range limit
    if (pt.x > m.range + 30) { pt.alive = false; }
    if (pt.x > 380) pt.alive = false;
  }
  s.particles = s.particles.filter((pt) => pt.alive || pt.x < 50);
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const m = MODES[p.mode];
  // Source
  ctx.fillStyle = '#fde047'; ctx.beginPath(); ctx.arc(20, h / 2, 12, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fde04780'; ctx.beginPath(); ctx.arc(20, h / 2, 20, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'hsl(var(--muted-foreground))'; ctx.font = '9px monospace'; ctx.fillText('Source', 4, h - 4);
  // Barriers
  for (let i = 1; i < BARRIERS.length; i++) {
    const b = BARRIERS[i];
    if (b.stop === 0) continue;
    ctx.fillStyle = b.color + '40'; ctx.fillRect(b.stop, 20, 6, h - 40);
    ctx.fillStyle = b.color; ctx.fillRect(b.stop, 20, 2, h - 40);
    ctx.fillStyle = 'hsl(var(--muted-foreground))'; ctx.font = '8px monospace';
    ctx.save(); ctx.translate(b.stop + 8, 16); ctx.fillText(b.name, 0, 0); ctx.restore();
  }
  // Particles
  for (const pt of s.particles) {
    if (!pt.alive) continue;
    ctx.fillStyle = m.color;
    if (p.mode === 'gamma') {
      // wavy
      ctx.beginPath(); ctx.arc(pt.x, pt.y, 1.5, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.beginPath(); ctx.arc(pt.x, pt.y, p.mode === 'alpha' ? 3 : 1.5, 0, Math.PI * 2); ctx.fill();
    }
  }
  // Range indicator
  ctx.strokeStyle = m.color + '40'; ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(m.range + 30, 20); ctx.lineTo(m.range + 30, h - 20); ctx.stroke();
  ctx.setLineDash([]);
}
function sample(s, p, t) { return { emitted: s.emitted, absorbed: s.absorbed, transmitted: s.emitted - s.absorbed }; }
function computeStats(s, p) {
  const m = MODES[p.mode];
  const b = BARRIERS[p.barrier];
  const stopped = m.range < b.stop;
  return { 'Mode': m.label, 'Q (MeV)': m.Q.toFixed(2), 'Charge': m.charge, 'Range (px)': m.range, 'Barrier': b.name, 'Penetrates': stopped ? 'No' : 'Yes' };
}

export default function AlphaBetaGammaSim() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ mode: 'alpha', barrier: 1, rate: 8 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, sample, computeStats, resetKey: `${params.mode}|${params.barrier}` });
  return (
    <SimLayout title="Alpha / Beta / Gamma Decay" configName="alpha-beta-gamma" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      graph={<LiveGraph data={sim.graphData} xKey="t" series={[{ key: 'emitted', color: '#22d3ee' }, { key: 'absorbed', color: '#ef4444' }, { key: 'transmitted', color: '#a855f7' }]} />}
      exportBar={<ExportBar graphData={sim.graphData} config={params} canvasRef={canvasRef} name="alpha-beta-gamma" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">α (He-4 nucleus, +2e): stopped by paper. β⁻ (electron, −1e): stopped by aluminium. γ (photon, 0): needs thick lead. Range scales with energy and inversely with mass·charge².</div>} />
  );
}