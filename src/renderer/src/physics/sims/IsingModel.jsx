// 2D Ising model — Metropolis Monte Carlo
import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, LiveGraph, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

const schema = [
  { key: 'N', label: 'Lattice size N', min: 16, max: 80, step: 2, type: 'range' },
  { key: 'T', label: 'Temperature T (J/kB)', min: 0.1, max: 5, step: 0.05, type: 'range' },
  { key: 'J', label: 'Coupling J', min: 0.1, max: 3, step: 0.1, type: 'range' },
  { key: 'H', label: 'External field h', min: -3, max: 3, step: 0.1, type: 'range' },
];

function makeInitial(p) {
  const N = p.N; const spins = new Int8Array(N * N);
  for (let i = 0; i < N * N; i++) spins[i] = Math.random() < 0.5 ? 1 : -1;
  return { spins, M: 0, E: 0 };
}
function energyAt(spins, N, i, j, J, h) {
  const s = spins[i * N + j]; let nb = 0;
  nb += spins[((i + 1) % N) * N + j] + spins[((i - 1 + N) % N) * N + j] + spins[i * N + ((j + 1) % N)] + spins[i * N + ((j - 1 + N) % N)];
  return -J * s * nb - h * s;
}
function step(s, dt, p) {
  const N = p.N, spins = s.spins; const sweeps = 1;
  for (let k = 0; k < sweeps * N * N; k++) {
    const i = (Math.random() * N) | 0, j = (Math.random() * N) | 0;
    const dE = -2 * energyAt(spins, N, i, j, p.J, p.H);
    if (dE <= 0 || Math.random() < Math.exp(-dE / p.T)) spins[i * N + j] *= -1;
  }
  // measure
  let M = 0, E = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { M += spins[i * N + j]; E += energyAt(spins, N, i, j, p.J, p.H); }
  s.M = M / (N * N); s.E = E / (N * N);
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h); const N = p.N; const cw = w / N, ch = h / N;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { ctx.fillStyle = s.spins[i * N + j] > 0 ? '#22d3ee' : '#1e293b'; ctx.fillRect(j * cw, i * ch, cw + 1, ch + 1); }
}
function sample(s) { return { M: +s.M.toFixed(4), E: +s.E.toFixed(4) }; }
function computeStats(s, p) { return { '⟨M⟩': s.M.toFixed(4), '⟨E⟩': s.E.toFixed(4), 'T': p.T.toFixed(2), 'Tc≈': '2.269 (J=1)', 'N': p.N }; }

export default function IsingModel() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ N: 40, T: 2.2, J: 1, H: 0 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, sample, computeStats, resetKey: `${params.N}` });
  return (
    <SimLayout title="2D Ising Model (Metropolis Monte Carlo)" configName="ising" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      graph={<LiveGraph data={sim.graphData} xKey="t" series={[{ key: 'M', color: '#22d3ee' }, { key: 'E', color: '#f97316' }]} />}
      exportBar={<ExportBar graphData={sim.graphData} config={params} canvasRef={canvasRef} name="ising" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Real Metropolis dynamics on a periodic N×N lattice. Below Tc≈2.269 (J=1) spins spontaneously order — watch ⟨M⟩ jump to ±1.</div>} />
  );
}