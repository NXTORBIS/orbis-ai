import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';
import { ResearchHeader, AIPanel, useAIExplain, Card } from '../research.jsx';

// 2D incompressible Navier–Stokes via Jos Stam's "stable fluids" method,
// focused on dye visualisation + interactive force injection.
// Distinct from CfdLab: this version tracks a dye density field (for vivid
// mixing visualisation) and lets the user inject forces by clicking.
// ∂u/∂t = -(u·∇)u - ∇p/ρ + ν∇²u,  ∇·u = 0.
const N = 64;
const schema = [
  { key: 'viscosity', label: 'Viscosity ν', min: 0, max: 0.0005, step: 0.00001, type: 'range' },
  { key: 'diffusion', label: 'Dye diffusion', min: 0, max: 0.0001, step: 0.000001, type: 'range' },
  { key: 'inflow', label: 'Inlet speed', min: 0, max: 3, step: 0.1, type: 'range' },
];

function makeInitial() {
  return { u: new Float32Array(N * N), v: new Float32Array(N * N), u0: new Float32Array(N * N), v0: new Float32Array(N * N),
           dens: new Float32Array(N * N), dens0: new Float32Array(N * N), p: new Float32Array(N * N), div: new Float32Array(N * N) };
}
const IX = (i, j) => (i < 0 ? 0 : i >= N ? N - 1 : i) + (j < 0 ? 0 : j >= N ? N - 1 : j) * N;
function setBnd(b, x) {
  for (let i = 0; i < N; i++) {
    x[IX(0, i)] = b === 1 ? -x[IX(1, i)] : x[IX(1, i)];
    x[IX(N - 1, i)] = b === 1 ? -x[IX(N - 2, i)] : x[IX(N - 2, i)];
    x[IX(i, 0)] = b === 2 ? -x[IX(i, 1)] : x[IX(i, 1)];
    x[IX(i, N - 1)] = b === 2 ? -x[IX(i, N - 2)] : x[IX(i, N - 2)];
  }
}
function linSolve(b, x, x0, a, c, iters = 6) {
  const cR = 1 / c;
  for (let k = 0; k < iters; k++) {
    for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++)
      x[IX(i, j)] = (x0[IX(i, j)] + a * (x[IX(i + 1, j)] + x[IX(i - 1, j)] + x[IX(i, j + 1)] + x[IX(i, j - 1)])) * cR;
    setBnd(b, x);
  }
}
function project(u, v, p, div) {
  for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++)
    div[IX(i, j)] = -0.5 * (u[IX(i + 1, j)] - u[IX(i - 1, j)] + v[IX(i, j + 1)] - v[IX(i, j - 1)]) / N;
  setBnd(0, div); setBnd(0, p); linSolve(0, p, div, 1, 4);
  for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
    u[IX(i, j)] -= 0.5 * N * (p[IX(i + 1, j)] - p[IX(i - 1, j)]);
    v[IX(i, j)] -= 0.5 * N * (p[IX(i, j + 1)] - p[IX(i, j - 1)]);
  }
  setBnd(1, u); setBnd(2, v);
}
function advect(b, d, d0, u, v, dt) {
  for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
    let x = i - dt * N * u[IX(i, j)], y = j - dt * N * v[IX(i, j)];
    x = Math.max(0.5, Math.min(N - 1.5, x)); y = Math.max(0.5, Math.min(N - 1.5, y));
    const i0 = x | 0, i1 = i0 + 1, j0 = y | 0, j1 = j0 + 1;
    const s1 = x - i0, s0 = 1 - s1, t1 = y - j0, t0 = 1 - t1;
    d[IX(i, j)] = s0 * (t0 * d0[IX(i0, j0)] + t1 * d0[IX(i0, j1)]) + s1 * (t0 * d0[IX(i1, j0)] + t1 * d0[IX(i1, j1)]);
  }
  setBnd(b, d);
}
function step(s, dt, p) {
  const { u, v, u0, v0, dens, dens0, pr: pr } = s;
  // inflow on left
  for (let j = 0; j < N; j++) { u[IX(0, j)] = p.inflow; dens[IX(0, j)] = (j % 8 < 4) ? 1 : 0; }
  u0.set(u); v0.set(v); dens0.set(dens);
  advect(1, u, u0, u0, v0, dt); advect(2, v, v0, u0, v0, dt);
  if (p.viscosity > 0) { linSolve(1, u, u, p.viscosity, 1 + 4 * p.viscosity); linSolve(2, v, v, p.viscosity, 1 + 4 * p.viscosity); }
  project(u, v, s.p, s.div);
  advect(0, dens, dens0, u, v, dt);
  if (p.diffusion > 0) linSolve(0, dens, dens, p.diffusion, 1 + 4 * p.diffusion);
}

function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const { u, v, dens } = s;
  const cw = w / N, ch = h / N;
  // dye field
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const d = Math.min(1, dens[IX(i, j)]);
    if (d > 0.01) {
      ctx.fillStyle = `rgba(34,211,238,${d * 0.8})`;
      ctx.fillRect(i * cw, j * ch, cw + 1, ch + 1);
    }
  }
  // velocity arrows
  ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 0.8;
  for (let j = 4; j < N; j += 6) for (let i = 4; i < N; i += 6) {
    const ux = u[IX(i, j)], vy = v[IX(i, j)]; const m = Math.hypot(ux, vy);
    if (m < 0.01) continue;
    const len = Math.min(7, m * 5);
    ctx.beginPath(); ctx.moveTo(i * cw, j * ch); ctx.lineTo(i * cw + (ux / m) * len, j * ch + (vy / m) * len); ctx.stroke();
  }
}

function computeStats(s, p) {
  let dmax = 0, vmax = 0;
  for (let i = 0; i < N * N; i++) { dmax = Math.max(dmax, s.dens[i]); vmax = Math.max(vmax, Math.hypot(s.u[i], s.v[i])); }
  return { 'Grid': `${N}×${N}`, 'Inflow': p.inflow.toFixed(1), 'ν': p.viscosity.toExponential(1), 'Max |v|': vmax.toFixed(3), 'Max dye': dmax.toFixed(2), 'Solver': 'Stam (dye)' };
}

export default function NavierStokesVizSim() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ viscosity: 0.00005, diffusion: 0.00001, inflow: 1.5 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats, resetKey: `${params.viscosity}` });
  const { explain, explaining, output } = useAIExplain();
  // inject force + dye on click
  React.useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const handler = (e) => {
      const rect = cv.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * N | 0;
      const y = ((e.clientY - rect.top) / rect.height) * N | 0;
      const s = sim.stateRef.current; if (!s) return;
      for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
        const i = IX(x + di, y + dj);
        s.u[i] += 4; s.v[i] += (Math.random() - 0.5) * 4; s.dens[i] = 1;
      }
    };
    cv.addEventListener('click', handler);
    return () => cv.removeEventListener('click', handler);
  }, []);
  return (
    <div className="space-y-3">
      <ResearchHeader title="Navier–Stokes Visualisation — Stable Fluids" subtitle="Full 2D incompressible Navier–Stokes: semi-Lagrangian advection + pressure projection enforces ∇·u=0. Dye marks the fluid; click to inject momentum and dye. Cyan streaks show mixing and turbulence." onExplain={() => explain(`Navier-Stokes: ${N}x${N}, inflow=${params.inflow}, ν=${params.viscosity.toExponential(1)}. ${JSON.stringify(sim.stats)}`)} explaining={explaining} />
      <SimLayout title="Navier–Stokes" configName="ns-viz" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
        controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
        stats={<StatGrid stats={sim.stats} />}
        exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="ns-viz" />}
        extra={<Card><p className="text-xs text-muted-foreground">Click the canvas to inject momentum + dye. The solver is Stam's stable-fluids method — the standard real-time approach for incompressible flow. Inlet on the left alternates dye bands so you can see shear and mixing.</p></Card>} />
      <AIPanel output={output} />
      <p className="text-xs text-center text-muted-foreground">Click the simulation canvas to inject fluid.</p>
    </div>
  );
}