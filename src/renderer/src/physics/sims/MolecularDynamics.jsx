import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, LiveGraph, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';
import SciPlot from '../SciPlot.jsx';
import { ResearchHeader, AIPanel, useAIExplain, Card } from '../research.jsx';

// Real 2D Lennard–Jones molecular dynamics: velocity-Verlet integration,
// periodic boundaries, reduced units (σ=ε=m=1). Computes kinetic/potential/
// total energy, temperature, pressure (virial) and the radial distribution fn.
const schema = [
  { key: 'N', label: 'Particles', min: 20, max: 200, step: 10, type: 'range' },
  { key: 'rho', label: 'Density ρ', min: 0.2, max: 0.9, step: 0.05, type: 'range' },
  { key: 'T0', label: 'Target T*', min: 0.1, max: 3, step: 0.1, type: 'range' },
  { key: 'dt', label: 'Time step Δt*', min: 0.002, max: 0.02, step: 0.001, type: 'range' },
  { key: 'rc', label: 'Cutoff r_c*', min: 1.5, max: 3.5, step: 0.1, type: 'range' },
];

function makeInitial(p) {
  const N = p.N; const L = Math.sqrt(N / p.rho);
  const x = new Float64Array(N * 2), v = new Float64Array(N * 2), f = new Float64Array(N * 2);
  // lattice init
  const m = Math.ceil(Math.sqrt(N)); const a = L / m;
  for (let i = 0; i < N; i++) { x[2 * i] = (i % m + 0.5) * a; x[2 * i + 1] = (Math.floor(i / m) + 0.5) * a; v[2 * i] = (Math.random() - 0.5); v[2 * i + 1] = (Math.random() - 0.5); }
  return { x, v, f, L, N, rdf: new Array(40).fill(0), rdfN: 0 };
}
function computeForces(s, p) {
  const { N, L, x, f } = s; const rc = p.rc, rc2 = rc * rc;
  f.fill(0); let PE = 0, virial = 0;
  const bins = 40; const rdf = new Array(bins).fill(0); const rmax = L / 2; const dr = rmax / bins;
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      let dx = x[2 * i] - x[2 * j], dy = x[2 * i + 1] - x[2 * j + 1];
      dx -= L * Math.round(dx / L); dy -= L * Math.round(dy / L); // minimum image
      const r2 = dx * dx + dy * dy;
      if (r2 < rc2) {
        const inv2 = 1 / r2, inv6 = inv2 * inv2 * inv2, inv12 = inv6 * inv6;
        const fmag = 24 * (2 * inv12 - inv6) * inv2; // F/r
        f[2 * i] += fmag * dx; f[2 * i + 1] += fmag * dy; f[2 * j] -= fmag * dx; f[2 * j + 1] -= fmag * dy;
        PE += 4 * (inv12 - inv6); virial += fmag * r2;
      }
      // RDF
      const r = Math.sqrt(r2); if (r < rmax) { const b = Math.floor(r / dr); if (b < bins) rdf[b] += 2; }
    }
  }
  s.PE = PE; s.virial = virial;
  // accumulate RDF
  for (let b = 0; b < bins; b++) s.rdf[b] = (s.rdf[b] || 0) + rdf[b];
  s.rdfN = (s.rdfN || 0) + 1;
}
function step(s, dt, p) {
  const { N, L, x, v, f } = s;
  // velocity-Verlet
  for (let i = 0; i < 2 * N; i++) { v[i] += 0.5 * dt * f[i]; x[i] += dt * v[i]; }
  for (let i = 0; i < 2 * N; i++) { x[i] = ((x[i] % L) + L) % L; }
  computeForces(s, p);
  for (let i = 0; i < 2 * N; i++) v[i] += 0.5 * dt * f[i];
  // velocity rescaling thermostat (Berendsen-ish)
  let KE = 0; for (let i = 0; i < 2 * N; i++) KE += 0.5 * v[i] * v[i];
  const T = KE / N; const lam = Math.sqrt(1 + (0.05 / Math.max(1e-9, T)) * (p.T0 - T));
  for (let i = 0; i < 2 * N; i++) v[i] *= lam;
  s.KE = KE; s.T = T; s.E = KE + s.PE; s.P = (s.KE + 0.5 * s.virial) / (L * L);
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h); const { N, L, x } = s; const sc = Math.min(w, h) / L;
  ctx.fillStyle = 'rgba(34,211,238,0.9)';
  for (let i = 0; i < N; i++) { ctx.beginPath(); ctx.arc(x[2 * i] * sc, x[2 * i + 1] * sc, 3, 0, Math.PI * 2); ctx.fill(); }
  ctx.strokeStyle = 'hsl(var(--border) / 0.4)'; ctx.strokeRect(0, 0, L * sc, L * sc);
}
function sample(s) { return { E: +s.E.toFixed(3), T: +s.T.toFixed(3), P: +s.P.toFixed(3) }; }
function computeStats(s, p) { return { '⟨T*⟩': s.T?.toFixed(3), 'PE': s.PE?.toFixed(2), 'KE': s.KE?.toFixed(2), 'E_total': s.E?.toFixed(2), 'P*': s.P?.toFixed(3), 'N': s.N }; }

export default function MolecularDynamics() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ N: 80, rho: 0.5, T0: 1.0, dt: 0.005, rc: 2.5 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, sample, computeStats, resetKey: `${params.N}|${params.rho}` });
  const { explain, explaining, output } = useAIExplain();
  const rdfData = (sim.stateRef.current?.rdf || []).map((c, i) => ({ r: (i + 0.5) * (sim.stateRef.current?.L || 1) / 80, g: c / Math.max(1, sim.stateRef.current?.rdfN || 1) / (2 * Math.PI * i + 1) })).filter((d) => d.r < (sim.stateRef.current?.L || 1) / 2);
  return (
    <div className="space-y-3">
      <ResearchHeader title="Molecular Dynamics Laboratory" subtitle="Real 2D Lennard–Jones fluid: velocity-Verlet integration, periodic boundaries, thermostat. Energy, temperature, pressure (virial) and radial distribution function computed live."
        onExplain={() => explain(`MD: N=${params.N}, density=${params.rho}, T*≈${sim.stats['⟨T*⟩']}, total energy=${sim.stats.E_total}. LJ potential 4ε[(σ/r)^12−(σ/r)^6].`)} explaining={explaining} />
      <SimLayout title="Molecular Dynamics" configName="md" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
        controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
        stats={<StatGrid stats={sim.stats} />}
        graph={<LiveGraph data={sim.graphData} xKey="t" series={[{ key: 'E', color: '#22d3ee' }, { key: 'T', color: '#f97316' }, { key: 'P', color: '#a855f7' }]} />}
        exportBar={<ExportBar graphData={sim.graphData} config={params} canvasRef={canvasRef} name="md" />}
        extra={<Card title="Radial Distribution g(r)"><SciPlot type="line" data={rdfData} xKey="r" series={[{ key: 'g', label: 'g(r)', color: '#22d3ee' }]} xLabel="r/σ" yLabel="g(r)" height={140} exportName="rdf" /></Card>} />
      <AIPanel output={output} />
    </div>
  );
}