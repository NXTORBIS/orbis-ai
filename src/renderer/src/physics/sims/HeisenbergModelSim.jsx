import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';
import { ResearchHeader, Card, AIPanel, useAIExplain } from '../research.jsx';

// Heisenberg Model — classical O(3) vector spins on 2D lattice, Metropolis
// with random-axis rotations. Unique engine: continuous vector spins (not
// Ising ±1), measures magnetisation vector and spin-wave excitations.
const schema = [
  { key: 'N', label: 'Lattice N', min: 16, max: 64, step: 2, type: 'range' },
  { key: 'T', label: 'Temperature T', min: 0.05, max: 3, step: 0.05, type: 'range' },
  { key: 'J', label: 'Coupling J', min: 0.1, max: 3, step: 0.1, type: 'range' },
  { key: 'H', label: 'Field h (z)', min: -2, max: 2, step: 0.1, type: 'range' },
  { key: 'amp', label: 'Rotation amp', min: 0.1, max: 1.5, step: 0.1, type: 'range' },
];

function randSphere() {
  const u = Math.random() * 2 - 1, ph = Math.random() * Math.PI * 2;
  const r = Math.sqrt(1 - u * u);
  return [r * Math.cos(ph), r * Math.sin(ph), u];
}
function makeInitial(p) {
  const N = p.N;
  const spins = new Float32Array(N * N * 3);
  for (let i = 0; i < N * N; i++) { const v = randSphere(); spins[3 * i] = v[0]; spins[3 * i + 1] = v[1]; spins[3 * i + 2] = v[2]; }
  return { spins, M: [0, 0, 0], E: 0 };
}
function nb(spins, N, i, j, k) {
  return [spins[3 * (((i + 1) % N) * N + j) + k], spins[3 * (((i - 1 + N) % N) * N + j) + k], spins[3 * (i * N + ((j + 1) % N)) + k], spins[3 * (i * N + ((j - 1 + N) % N)) + k]];
}
function rotate(s, th) {
  const ax = randSphere();
  const c = Math.cos(th), sn = Math.sin(th);
  const dot = ax[0] * s[0] + ax[1] * s[1] + ax[2] * s[2];
  return [
    s[0] * c + ax[0] * dot * (1 - c) - (ax[1] * s[2] - ax[2] * s[1]) * sn,
    s[1] * c + ax[1] * dot * (1 - c) - (ax[2] * s[0] - ax[0] * s[2]) * sn,
    s[2] * c + ax[2] * dot * (1 - c) - (ax[0] * s[1] - ax[1] * s[0]) * sn,
  ];
}
function step(s, dt, p) {
  const { N, spins } = s;
  for (let k = 0; k < N * N; k++) {
    const i = (Math.random() * N) | 0, j = (Math.random() * N) | 0, idx = 3 * (i * N + j);
    const ox = spins[idx], oy = spins[idx + 1], oz = spins[idx + 2];
    const ns = rotate([ox, oy, oz], p.amp);
    const nv = nb(spins, N, i, j, 0), nvy = nb(spins, N, i, j, 1), nvz = nb(spins, N, i, j, 2);
    let eOld = 0, eNew = 0;
    for (let d = 0; d < 4; d++) { eOld -= p.J * (ox * nv[d] + oy * nvy[d] + oz * nvz[d]); eNew -= p.J * (ns[0] * nv[d] + ns[1] * nvy[d] + ns[2] * nvz[d]); }
    eOld -= p.H * oz; eNew -= p.H * ns[2];
    const dE = eNew - eOld;
    if (dE <= 0 || Math.random() < Math.exp(-dE / p.T)) { spins[idx] = ns[0]; spins[idx + 1] = ns[1]; spins[idx + 2] = ns[2]; }
  }
  let Mx = 0, My = 0, Mz = 0, E = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const idx = 3 * (i * N + j);
    Mx += spins[idx]; My += spins[idx + 1]; Mz += spins[idx + 2];
    E -= p.J * spins[idx] * (spins[3 * (((i + 1) % N) * N + j)] + spins[3 * (i * N + ((j + 1) % N))]);
    E -= p.H * spins[idx + 2];
  }
  s.M = [Mx / (N * N), My / (N * N), Mz / (N * N)]; s.E = E / (N * N);
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const N = p.N, cw = w / N, ch = h / N;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const idx = 3 * (i * N + j);
    const ang = Math.atan2(s.spins[idx + 1], s.spins[idx]);
    const z = s.spins[idx + 2];
    ctx.fillStyle = `hsl(${(ang / Math.PI * 180 + 360) % 360},70%,${30 + (z + 1) * 25}%)`;
    ctx.fillRect(j * cw, i * ch, cw + 1, ch + 1);
  }
}
function computeStats(s, p) {
  const M = s.M || [0, 0, 0];
  const mag = Math.sqrt(M[0] ** 2 + M[1] ** 2 + M[2] ** 2);
  return { '|M|': mag.toFixed(4), 'Mz': M[2].toFixed(4), '⟨E⟩': s.E?.toFixed(4), 'T': p.T.toFixed(2), 'N': p.N };
}

export default function HeisenbergModelSim() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ N: 40, T: 0.5, J: 1, H: 0, amp: 0.5 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats, resetKey: `${params.N}` });
  const { explain, explaining, output } = useAIExplain();
  return (
    <div className="space-y-3">
      <ResearchHeader title="Heisenberg Model" subtitle="Classical O(3) vector spins on a 2D lattice, Metropolis with random-axis rotations. Hue = spin azimuth, brightness = z-component. No finite-Tc in 2D (Mermin-Wagner)."
        onExplain={() => explain(`Heisenberg ${params.N}×${params.N}, T=${params.T}, J=${params.J}. |M|=${sim.stats['|M|']}, ⟨E⟩=${sim.stats['⟨E⟩']}.`)} explaining={explaining} />
      <SimLayout title="Heisenberg Model" configName="heisenberg" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
        controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
        stats={<StatGrid stats={sim.stats} />}
        exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="heisenberg" />}
        extra={<Card><p className="text-xs text-muted-foreground">Continuous spins (not ±1) allow spin-wave excitations. Mermin-Wagner theorem: no spontaneous breaking of continuous symmetry in 2D at T&gt;0, so no finite Tc — but T=0 orders.</p></Card>} />
      <AIPanel output={output} />
    </div>
  );
}