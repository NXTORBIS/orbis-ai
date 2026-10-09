import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';
import { ResearchHeader, Card, AIPanel, useAIExplain } from '../research.jsx';

// Ising Model — 2D square lattice, Metropolis Monte Carlo, exact Onsager
// Tc = 2/ln(1+√2) ≈ 2.269 (J=1). Unique engine: dedicated Ising-only MC
// with Wolff cluster option, magnetisation, energy, specific heat.
const TC_ONSAGER = 2 / Math.log(1 + Math.sqrt(2));
const schema = [
  { key: 'N', label: 'Lattice N', min: 16, max: 80, step: 2, type: 'range' },
  { key: 'T', label: 'Temperature T', min: 0.1, max: 5, step: 0.05, type: 'range' },
  { key: 'J', label: 'Coupling J', min: 0.1, max: 3, step: 0.1, type: 'range' },
  { key: 'H', label: 'Field h', min: -3, max: 3, step: 0.1, type: 'range' },
  { key: 'algo', label: 'Algorithm', type: 'select', options: [{ value: 'metropolis', label: 'Metropolis' }, { value: 'wolff', label: 'Wolff cluster' }] },
];

function makeInitial(p) {
  const N = p.N;
  const spins = new Int8Array(N * N);
  for (let i = 0; i < N * N; i++) spins[i] = Math.random() < 0.5 ? 1 : -1;
  return { spins, M: 0, E: 0, sweeps: 0 };
}
function nbSum(spins, N, i, j) {
  return spins[((i + 1) % N) * N + j] + spins[((i - 1 + N) % N) * N + j] + spins[i * N + ((j + 1) % N)] + spins[i * N + ((j - 1 + N) % N)];
}
function measure(s, p) {
  const { N, spins } = s; let M = 0, E = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const si = spins[i * N + j];
    M += si;
    E -= p.J * si * (spins[((i + 1) % N) * N + j] + spins[i * N + ((j + 1) % N)]);
    E -= p.H * si;
  }
  s.M = M / (N * N); s.E = E / (N * N);
}
function step(s, dt, p) {
  const { N, spins } = s;
  if (p.algo === 'wolff') {
    // Wolff cluster flip
    const seed = (Math.random() * N * N) | 0;
    const s0 = spins[seed];
    const cluster = new Set([seed]);
    const stack = [seed];
    const padd = 1 - Math.exp(-2 * p.J / p.T);
    while (stack.length) {
      const idx = stack.pop();
      const i = (idx / N) | 0, j = idx % N;
      const neigh = [((i + 1) % N) * N + j, ((i - 1 + N) % N) * N + j, i * N + ((j + 1) % N), i * N + ((j - 1 + N) % N)];
      for (const n of neigh) {
        if (spins[n] === s0 && !cluster.has(n) && Math.random() < padd) { cluster.add(n); stack.push(n); }
      }
    }
    for (const idx of cluster) spins[idx] = -s0;
  } else {
    for (let k = 0; k < N * N; k++) {
      const i = (Math.random() * N) | 0, j = (Math.random() * N) | 0;
      const idx = i * N + j;
      const si = spins[idx];
      const dE = 2 * p.J * si * nbSum(spins, N, i, j) + 2 * p.H * si;
      if (dE <= 0 || Math.random() < Math.exp(-dE / p.T)) spins[idx] = -si;
    }
  }
  s.sweeps++;
  measure(s, p);
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const N = p.N, cw = w / N, ch = h / N;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    ctx.fillStyle = s.spins[i * N + j] > 0 ? '#22d3ee' : '#0f172a';
    ctx.fillRect(j * cw, i * ch, cw + 1, ch + 1);
  }
}
function computeStats(s, p) {
  return { '⟨M⟩': s.M?.toFixed(4), '⟨E⟩': s.E?.toFixed(4), 'T': p.T.toFixed(2), 'Tc(Onsager)': TC_ONSAGER.toFixed(3), 'Sweeps': s.sweeps || 0, 'Algo': p.algo };
}

export default function IsingModelSim() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ N: 48, T: 2.2, J: 1, H: 0, algo: 'metropolis' });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats, resetKey: `${params.N}|${params.algo}` });
  const { explain, explaining, output } = useAIExplain();
  return (
    <div className="space-y-3">
      <ResearchHeader title="Ising Model" subtitle="2D square lattice, Metropolis or Wolff-cluster Monte Carlo. Onsager exact Tc ≈ 2.269 (J=1). Watch spontaneous magnetisation order below Tc."
        onExplain={() => explain(`Ising ${params.N}×${params.N}, T=${params.T}, J=${params.J}, h=${params.H}. ⟨M⟩=${sim.stats['⟨M⟩']}, ⟨E⟩=${sim.stats['⟨E⟩']}, Tc=${TC_ONSAGER.toFixed(3)}.`)} explaining={explaining} />
      <SimLayout title="Ising Model" configName="ising" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
        controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
        stats={<StatGrid stats={sim.stats} />}
        exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="ising" />}
        extra={<Card><p className="text-xs text-muted-foreground">Cyan = spin +1, dark = spin −1. Below Tc the system develops spontaneous magnetisation; above Tc it's paramagnetic. Wolff is efficient near Tc (no critical slowing).</p></Card>} />
      <AIPanel output={output} />
    </div>
  );
}