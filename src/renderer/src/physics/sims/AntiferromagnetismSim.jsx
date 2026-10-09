import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';
import { ResearchHeader, Card, AIPanel, useAIExplain } from '../research.jsx';

// Antiferromagnetism — two-sublattice Ising model with J < 0 on a
// checkerboard. Metropolis MC. Unique engine: staggered magnetisation
// M_s = (M_A - M_B)/2, Néel temperature T_N = 2|J|/ln(1+√2) (mean-field
// higher), real staggered order measurement.
const schema = [
  { key: 'N', label: 'Lattice N', min: 16, max: 64, step: 2, type: 'range' },
  { key: 'T', label: 'Temperature T', min: 0.1, max: 5, step: 0.05, type: 'range' },
  { key: 'J', label: 'Coupling |J|', min: 0.1, max: 3, step: 0.1, type: 'range' },
  { key: 'H', label: 'Staggered field h_s', min: -3, max: 3, step: 0.1, type: 'range' },
];

function makeInitial(p) {
  const N = p.N;
  const spins = new Int8Array(N * N);
  for (let i = 0; i < N * N; i++) spins[i] = (i % 2) === 0 ? 1 : -1; // start Néel
  return { spins, M: 0, Ms: 0, E: 0 };
}
function nbSum(spins, N, i, j) {
  return spins[((i + 1) % N) * N + j] + spins[((i - 1 + N) % N) * N + j] + spins[i * N + ((j + 1) % N)] + spins[i * N + ((j - 1 + N) % N)];
}
function step(s, dt, p) {
  const { N, spins } = s; const J = -p.J; // antiferromagnetic
  for (let k = 0; k < N * N; k++) {
    const i = (Math.random() * N) | 0, j = (Math.random() * N) | 0, idx = i * N + j;
    const si = spins[idx];
    const hs = (i + j) % 2 === 0 ? p.H : -p.H; // staggered field
    const dE = 2 * J * si * nbSum(spins, N, i, j) + 2 * hs * si;
    if (dE <= 0 || Math.random() < Math.exp(-dE / p.T)) spins[idx] = -si;
  }
  let MA = 0, MB = 0, E = 0, nA = 0, nB = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const si = spins[i * N + j];
    if ((i + j) % 2 === 0) { MA += si; nA++; } else { MB += si; nB++; }
    E -= J * si * (spins[((i + 1) % N) * N + j] + spins[i * N + ((j + 1) % N)]);
  }
  s.M = (MA + MB) / (N * N); s.Ms = (MA / nA - MB / nB) / 2; s.E = E / (N * N);
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const N = p.N, cw = w / N, ch = h / N;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const si = s.spins[i * N + j];
    const subA = (i + j) % 2 === 0;
    ctx.fillStyle = si > 0 ? (subA ? '#22d3ee' : '#3b82f6') : (subA ? '#1e293b' : '#0c1a3a');
    ctx.fillRect(j * cw, i * ch, cw + 1, ch + 1);
  }
}
function computeStats(s, p) {
  return { 'M (net)': s.M?.toFixed(4), 'M_s (staggered)': s.Ms?.toFixed(4), '⟨E⟩': s.E?.toFixed(4), 'T': p.T.toFixed(2), '|J|': p.J.toFixed(2), 'T_N≈': (2 * p.J / Math.log(1 + Math.sqrt(2))).toFixed(3) };
}

export default function AntiferromagnetismSim() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ N: 40, T: 1.5, J: 1, H: 0 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats, resetKey: `${params.N}` });
  const { explain, explaining, output } = useAIExplain();
  return (
    <div className="space-y-3">
      <ResearchHeader title="Antiferromagnetism" subtitle="Two-sublattice Ising model with J < 0 (checkerboard). Staggered magnetisation M_s orders below Néel temperature T_N. Net M ≈ 0 but alternating order is strong."
        onExplain={() => explain(`AFM ${params.N}×${params.N}, T=${params.T}, |J|=${params.J}. M_s=${sim.stats['M_s (staggered)']}, net M=${sim.stats['M (net)']}, T_N≈${(2 * params.J / Math.log(1 + Math.sqrt(2))).toFixed(2)}.`)} explaining={explaining} />
      <SimLayout title="Antiferromagnetism" configName="antiferro" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
        controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
        stats={<StatGrid stats={sim.stats} />}
        exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="antiferro" />}
        extra={<Card><p className="text-xs text-muted-foreground">Sublattice A (cyan/blue up) vs B (dark down). M_s = (M_A − M_B)/2 measures staggered order. T_N ≈ 2|J|/ln(1+√2) for the 2D Ising AFM. A staggered field couples to the order parameter.</p></Card>} />
      <AIPanel output={output} />
    </div>
  );
}