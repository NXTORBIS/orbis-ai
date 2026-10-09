import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';
import { ResearchHeader, Card, AIPanel, useAIExplain } from '../research.jsx';

// General lattice-model laboratory: Ising, XY, and (classical) Heisenberg on
// a 2D periodic lattice, with Metropolis Monte Carlo. Control size, coupling,
// temperature, field and boundary; visualise spin config, energy, magnetisation.
const MODELS = ['Ising', 'XY', 'Heisenberg'];
const schema = [
  { key: 'model', label: 'Model', type: 'select', options: MODELS.map((m) => ({ value: m, label: m })) },
  { key: 'N', label: 'Lattice N', min: 16, max: 64, step: 2, type: 'range' },
  { key: 'T', label: 'Temperature T', min: 0.1, max: 5, step: 0.05, type: 'range' },
  { key: 'J', label: 'Coupling J', min: 0.1, max: 3, step: 0.1, type: 'range' },
  { key: 'H', label: 'Field h', min: -3, max: 3, step: 0.1, type: 'range' },
];

function makeInitial(p) {
  const N = p.N; const spins = new Float32Array(N * N * 3);
  for (let i = 0; i < N * N; i++) { if (p.model === 'Ising') { spins[3 * i] = Math.random() < 0.5 ? 1 : -1; spins[3 * i + 1] = 0; spins[3 * i + 2] = 0; }
    else if (p.model === 'XY') { const a = Math.random() * Math.PI * 2; spins[3 * i] = Math.cos(a); spins[3 * i + 1] = Math.sin(a); spins[3 * i + 2] = 0; }
    else { const u = Math.random() * 2 - 1, ph = Math.random() * Math.PI * 2; const r = Math.sqrt(1 - u * u); spins[3 * i] = r * Math.cos(ph); spins[3 * i + 1] = r * Math.sin(ph); spins[3 * i + 2] = u; } }
  return { spins, M: 0, E: 0 };
}
function nb(spins, N, i, j, k) {
  return [spins[3 * (((i + 1) % N) * N + j) + k], spins[3 * (((i - 1 + N) % N) * N + j) + k], spins[3 * (i * N + ((j + 1) % N)) + k], spins[3 * (i * N + ((j - 1 + N) % N)) + k]];
}
function step(s, dt, p) {
  const { N, spins } = s; const sweeps = 1;
  for (let k = 0; k < sweeps * N * N; k++) {
    const i = (Math.random() * N) | 0, j = (Math.random() * N) | 0; const idx = 3 * (i * N + j);
    if (p.model === 'Ising') {
      const si = spins[idx]; let nbSum = 0; for (let d = 0; d < 4; d++) nbSum += nb(spins, N, i, j, 0)[d]; const dE = 2 * p.J * si * nbSum + 2 * p.H * si;
      if (dE <= 0 || Math.random() < Math.exp(-dE / p.T)) spins[idx] = -si;
    } else {
      // propose a small rotation
      const theta = (Math.random() - 0.5) * 2; const axis = Math.random() * Math.PI * 2;
      const ox = spins[idx], oy = spins[idx + 1], oz = spins[idx + 2];
      const nx = rotate(ox, oy, oz, theta, axis);
      const nbv = nb(spins, N, i, j, 0); const nby = nb(spins, N, i, j, 1); const nbz = nb(spins, N, i, j, 2);
      let eOld = 0, eNew = 0;
      for (let d = 0; d < 4; d++) { eOld -= p.J * (ox * nbv[d] + oy * nby[d] + oz * nbz[d]); eNew -= p.J * (nx[0] * nbv[d] + nx[1] * nby[d] + nx[2] * nbz[d]); }
      eOld -= p.H * oz; eNew -= p.H * nx[2];
      const dE = eNew - eOld;
      if (dE <= 0 || Math.random() < Math.exp(-dE / p.T)) { spins[idx] = nx[0]; spins[idx + 1] = nx[1]; spins[idx + 2] = nx[2]; }
    }
  }
  // measure
  let M = 0, E = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const idx = 3 * (i * N + j); M += spins[idx + 2]; const nbv = nb(spins, N, i, j, 0); E -= p.J * spins[idx] * (nbv[0] + nbv[1]); E -= p.H * spins[idx + 2]; }
  s.M = M / (N * N); s.E = E / (N * N);
}
function rotate(x, y, z, th, ax) {
  const c = Math.cos(th), s2 = Math.sin(th);
  // rotate about a random axis in xy-plane (simplified)
  return [x * c - y * s2, x * s2 + y * c, z];
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h); const N = p.N; const cw = w / N, ch = h / N;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const idx = 3 * (i * N + j); const z = s.spins[idx + 2];
    if (p.model === 'Ising') ctx.fillStyle = s.spins[idx] > 0 ? '#22d3ee' : '#1e293b';
    else { const ang = Math.atan2(s.spins[idx + 1], s.spins[idx]); ctx.fillStyle = `hsl(${(ang / Math.PI * 180 + 180) % 360},80%,55%)`; }
    ctx.fillRect(j * cw, i * ch, cw + 1, ch + 1);
  }
}
function computeStats(s, p) { return { '⟨M⟩': s.M?.toFixed(4), '⟨E⟩': s.E?.toFixed(4), 'T': p.T.toFixed(2), 'Model': p.model, 'N': p.N, 'Tc(Ising,J=1)': '2.269' }; }

export default function LatticeLab() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ model: 'Ising', N: 40, T: 2.2, J: 1, H: 0 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats, resetKey: `${params.model}|${params.N}` });
  const { explain, explaining, output } = useAIExplain();
  return (
    <div className="space-y-3">
      <ResearchHeader title="Lattice Physics Laboratory" subtitle="General lattice-model Monte Carlo: Ising, XY and classical Heisenberg on a 2D periodic lattice. Control size, coupling, temperature and field; watch magnetisation order below Tc."
        onExplain={() => explain(`Lattice lab: ${params.model} on ${params.N}×${params.N}, T=${params.T}, J=${params.J}. ⟨M⟩=${sim.stats['⟨M⟩']}, ⟨E⟩=${sim.stats['⟨E⟩']}.`)} explaining={explaining} />
      <SimLayout title="Lattice Models" configName="lattice" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
        controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
        stats={<StatGrid stats={sim.stats} />}
        exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="lattice" />}
        extra={<Card><p className="text-xs text-muted-foreground">Ising: cyan=+1, dark=−1. XY: hue = spin angle. The 2D Ising model has an exact Onsager solution Tc = 2/ln(1+√2) ≈ 2.269 (J=1).</p></Card>} />
      <AIPanel output={output} />
    </div>
  );
}