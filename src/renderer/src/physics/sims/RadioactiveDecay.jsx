import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, LiveGraph, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

const schema = [
  { key: 'N0', label: 'Initial atoms N₀', min: 100, max: 5000, step: 100, type: 'range' },
  { key: 'halfLife', label: 'Half-life (s)', min: 0.2, max: 10, step: 0.1, type: 'range' },
];

function makeInitial(p) { return { alive: new Array(p.N0).fill(true), count: p.N0, decayedTimes: [] }; }
function step(s, dt, p) {
  const lambda = Math.LN2 / p.halfLife; const pdecay = 1 - Math.exp(-lambda * dt);
  for (let i = 0; i < s.alive.length; i++) { if (s.alive[i] && Math.random() < pdecay) { s.alive[i] = false; s.count--; s.decayedTimes.push(0); } }
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const n = s.alive.length; const cols = Math.ceil(Math.sqrt(n * (w / h))); const rows = Math.ceil(n / cols);
  const cw = w / cols, ch = h / rows;
  for (let i = 0; i < n; i++) { ctx.fillStyle = s.alive[i] ? '#22d3ee' : 'hsl(var(--border))'; ctx.fillRect(i % cols * cw + 1, Math.floor(i / cols) * ch + 1, cw - 2, ch - 2); }
  // exponential overlay N(t)=N0 e^{-lambda t}
  const lambda = Math.LN2 / p.halfLife; const N0 = n;
  ctx.strokeStyle = '#f97316'; ctx.lineWidth = 2; ctx.beginPath();
  const tmax = p.halfLife * 5;
  for (let i = 0; i <= 100; i++) { const tt = (i / 100) * tmax; const N = N0 * Math.exp(-lambda * tt); const x = (tt / tmax) * w; const y = h - (N / N0) * h; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
  ctx.stroke();
}
function sample(s, p, t) { return { N: s.count, Ntheory: Math.round(p.N0 * Math.exp(-(Math.LN2 / p.halfLife) * t)) }; }
function computeStats(s, p) {
  const lambda = Math.LN2 / p.halfLife;
  return { 'N (alive)': s.count, 'Decayed': s.alive.length - s.count, 'λ (1/s)': lambda.toFixed(3), 't½ (s)': p.halfLife.toFixed(2), 'τ mean life': (1 / lambda).toFixed(2) };
}

export default function RadioactiveDecay() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ N0: 1600, halfLife: 2 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, sample, computeStats, resetKey: `${params.N0}|${params.halfLife}` });
  return (
    <SimLayout title="Radioactive Decay (Monte Carlo)" configName="radioactive-decay" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      graph={<LiveGraph data={sim.graphData} xKey="t" series={[{ key: 'N', color: '#22d3ee' }, { key: 'Ntheory', color: '#f97316' }]} />}
      exportBar={<ExportBar graphData={sim.graphData} config={params} canvasRef={canvasRef} name="radioactive-decay" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Each atom decays with probability 1−e^(−λΔt) per step (λ=ln2/t½). Orange curve = N₀e^(−λt) theory; blue dots = live atoms.</div>} />
  );
}