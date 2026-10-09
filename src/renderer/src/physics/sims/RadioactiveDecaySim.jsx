import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, LiveGraph, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

// Unique Monte Carlo radioactive-decay engine with emitted-particle energy
// spectrum and selectable decay mode. Each atom decays stochastically with
// probability 1−e^(−λΔt); emitted particles are tracked for a live spectrum.

const MODES = {
  alpha:  { label: 'Alpha (α)',  E: 5.0,  color: '#ef4444', spread: 0.05 },
  beta:   { label: 'Beta (β⁻)',  E: 1.0,  color: '#22d3ee', spread: 0.40 },
  gamma:  { label: 'Gamma (γ)',  E: 2.0,  color: '#a855f7', spread: 0.02 },
};

const schema = [
  { key: 'N0', label: 'Initial atoms N₀', min: 200, max: 4000, step: 100, type: 'range' },
  { key: 'halfLife', label: 'Half-life (s)', min: 0.3, max: 8, step: 0.1, type: 'range' },
  { key: 'mode', label: 'Decay mode', type: 'select', options: Object.entries(MODES).map(([v, m]) => ({ value: v, label: m.label })) },
];

function makeInitial(p) {
  return { alive: new Array(p.N0).fill(true), count: p.N0, emissions: [], spectrum: new Array(20).fill(0) };
}
function step(s, dt, p) {
  const lambda = Math.LN2 / p.halfLife;
  const pdecay = 1 - Math.exp(-lambda * dt);
  const m = MODES[p.mode];
  for (let i = 0; i < s.alive.length; i++) {
    if (s.alive[i] && Math.random() < pdecay) {
      s.alive[i] = false; s.count--;
      const E = m.E * (1 + (Math.random() - 0.5) * 2 * m.spread);
      s.emissions.push({ E, age: 0 });
      const bin = Math.min(19, Math.floor((E / (m.E * 1.5)) * 20));
      s.spectrum[bin]++;
    }
  }
  for (const e of s.emissions) e.age += dt;
  s.emissions = s.emissions.filter((e) => e.age < 2);
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const m = MODES[p.mode];
  // Atom grid (left 60%)
  const gw = w * 0.6, n = s.alive.length;
  const cols = Math.ceil(Math.sqrt(n * (gw / h))); const rows = Math.ceil(n / cols);
  const cw = gw / cols, ch = h / rows;
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = s.alive[i] ? '#22d3ee' : 'hsl(var(--border))';
    ctx.fillRect((i % cols) * cw + 1, Math.floor(i / cols) * ch + 1, cw - 2, ch - 2);
  }
  // Emitted particles flying right
  for (const e of s.emissions) {
    const x = gw + e.age * 120;
    const y = h * 0.3 + ((e.E * 137) % (h * 0.4));
    const alpha = 1 - e.age / 2;
    ctx.fillStyle = m.color + Math.floor(alpha * 255).toString(16).padStart(2, '0');
    ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
  }
  // Spectrum histogram (right panel)
  const sx = gw + 10, sw = w - gw - 20, maxBin = Math.max(1, ...s.spectrum);
  const bw = sw / 20;
  ctx.fillStyle = m.color + '60';
  for (let i = 0; i < 20; i++) {
    const bh = (s.spectrum[i] / maxBin) * (h * 0.3);
    ctx.fillRect(sx + i * bw, h - bh - 10, bw - 1, bh);
  }
  ctx.strokeStyle = 'hsl(var(--border))'; ctx.strokeRect(sx, h * 0.65, sw, h * 0.35);
  ctx.fillStyle = 'hsl(var(--muted-foreground))'; ctx.font = '10px monospace';
  ctx.fillText('Energy →', sx + sw / 2 - 25, h - 2);
  ctx.fillText('N(t)', 4, 14);
}
function sample(s, p, t) {
  return { N: s.count, Ntheory: Math.round(p.N0 * Math.exp(-(Math.LN2 / p.halfLife) * t)), rate: s.emissions.length };
}
function computeStats(s, p) {
  const lambda = Math.LN2 / p.halfLife;
  return { 'N alive': s.count, 'Decayed': p.N0 - s.count, 'λ (1/s)': lambda.toFixed(3), 'τ (s)': (1 / lambda).toFixed(2), 'Emissions/s': s.emissions.length.toFixed(0) };
}

export default function RadioactiveDecaySim() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ N0: 1600, halfLife: 2, mode: 'beta' });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, sample, computeStats, resetKey: `${params.N0}|${params.halfLife}|${params.mode}` });
  return (
    <SimLayout title="Radioactive Decay (Monte Carlo)" configName="radioactive-decay-mc" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      graph={<LiveGraph data={sim.graphData} xKey="t" series={[{ key: 'N', color: '#22d3ee' }, { key: 'Ntheory', color: '#f97316' }, { key: 'rate', color: '#a855f7' }]} />}
      exportBar={<ExportBar graphData={sim.graphData} config={params} canvasRef={canvasRef} name="radioactive-decay-mc" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Monte Carlo: each atom decays with P=1−e^(−λΔt). Left grid = atoms (cyan=alive). Right = emitted particles flying outward + live energy spectrum histogram.</div>} />
  );
}