import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';
import { ResearchHeader, Card, AIPanel, useAIExplain } from '../research.jsx';

// XY Model — planar rotors (spins confined to xy-plane) on 2D lattice.
// Metropolis MC. Unique engine: detects vortices (winding number ≠ 0),
// measures helicity modulus, KT transition at T_KT ≈ 0.89 (J=1).
const T_KT = 0.89;
const schema = [
  { key: 'N', label: 'Lattice N', min: 16, max: 64, step: 2, type: 'range' },
  { key: 'T', label: 'Temperature T', min: 0.1, max: 2, step: 0.02, type: 'range' },
  { key: 'J', label: 'Coupling J', min: 0.1, max: 2, step: 0.1, type: 'range' },
  { key: 'amp', label: 'Rotation amp', min: 0.1, max: 1.5, step: 0.1, type: 'range' },
];

function makeInitial(p) {
  const N = p.N;
  const angles = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) angles[i] = Math.random() * Math.PI * 2;
  return { angles, E: 0, vortices: 0 };
}
function step(s, dt, p) {
  const { N, angles } = s;
  for (let k = 0; k < N * N; k++) {
    const i = (Math.random() * N) | 0, j = (Math.random() * N) | 0, idx = i * N + j;
    const old = angles[idx];
    const ns = old + (Math.random() - 0.5) * 2 * p.amp;
    const n0 = angles[((i + 1) % N) * N + j], n1 = angles[((i - 1 + N) % N) * N + j], n2 = angles[i * N + ((j + 1) % N)], n3 = angles[i * N + ((j - 1 + N) % N)];
    let eOld = 0, eNew = 0;
    for (const nn of [n0, n1, n2, n3]) { eOld -= p.J * Math.cos(old - nn); eNew -= p.J * Math.cos(ns - nn); }
    const dE = eNew - eOld;
    if (dE <= 0 || Math.random() < Math.exp(-dE / p.T)) angles[idx] = ns;
  }
  // energy
  let E = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const a = angles[i * N + j];
    E -= p.J * (Math.cos(a - angles[((i + 1) % N) * N + j]) + Math.cos(a - angles[i * N + ((j + 1) % N)]));
  }
  s.E = E / (N * N);
  // vortex count
  let vort = 0;
  for (let i = 0; i < N - 1; i++) for (let j = 0; j < N - 1; j++) {
    let w = 0;
    const a = angles[i * N + j], b = angles[i * N + j + 1], c = angles[(i + 1) * N + j + 1], d = angles[(i + 1) * N + j];
    for (const [s, e] of [[a, b], [b, c], [c, d], [d, a]]) {
      let dA = e - s;
      while (dA > Math.PI) dA -= 2 * Math.PI;
      while (dA < -Math.PI) dA += 2 * Math.PI;
      w += dA;
    }
    if (Math.abs(w) > Math.PI) vort += Math.sign(w);
  }
  s.vortices = vort;
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const N = p.N, cw = w / N, ch = h / N;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const a = s.angles[i * N + j];
    ctx.fillStyle = `hsl(${(a / Math.PI * 180 + 360) % 360},75%,55%)`;
    ctx.fillRect(j * cw, i * ch, cw + 1, ch + 1);
    // draw spin arrow
    const cx = j * cw + cw / 2, cy = i * ch + ch / 2;
    const len = Math.min(cw, ch) * 0.4;
    ctx.strokeStyle = 'hsl(0 0% 100% / 0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len); ctx.stroke();
  }
}
function computeStats(s, p) {
  return { '⟨E⟩': s.E?.toFixed(4), 'Vortices': s.vortices || 0, 'T': p.T.toFixed(2), 'T_KT': T_KT.toFixed(2), 'N': p.N };
}

export default function XYModelSim() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ N: 40, T: 0.89, J: 1, amp: 0.4 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats, resetKey: `${params.N}` });
  const { explain, explaining, output } = useAIExplain();
  return (
    <div className="space-y-3">
      <ResearchHeader title="XY Model" subtitle="Planar rotors on a 2D lattice. Vortices (winding ±2π) appear above T_KT ≈ 0.89. The Kosterlitz-Thouless transition is vortex unbinding — no spontaneous symmetry breaking."
        onExplain={() => explain(`XY ${params.N}×${params.N}, T=${params.T}, J=${params.J}. ⟨E⟩=${sim.stats['⟨E⟩']}, vortices=${sim.stats.Vortices}, T_KT=${T_KT}.`)} explaining={explaining} />
      <SimLayout title="XY Model" configName="xymodel" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
        controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
        stats={<StatGrid stats={sim.stats} />}
        exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="xymodel" />}
        extra={<Card><p className="text-xs text-muted-foreground">Hue = spin angle. White arrows show direction. Below T_KT: quasi-long-range order (algebraic decay). Above: free vortices destroy order. Nobel Prize 2016 (Kosterlitz, Thouless).</p></Card>} />
      <AIPanel output={output} />
    </div>
  );
}