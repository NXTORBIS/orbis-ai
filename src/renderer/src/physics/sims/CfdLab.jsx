import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';
import { ResearchHeader, AIPanel, useAIExplain, Card } from '../research.jsx';

// 2D incompressible Navier–Stokes via Jos Stam's "stable fluids" method:
// semi-Lagrangian advection + Gauss–Seidel pressure projection enforces
// ∇·v = 0. Real vorticity, streamlines, obstacle, inlet/outlet.
const N = 80;
const schema = [
  { key: 'viscosity', label: 'Viscosity ν', min: 0, max: 0.0005, step: 0.00001, type: 'range' },
  { key: 'inflow', label: 'Inlet speed', min: 0, max: 4, step: 0.1, type: 'range' },
  { key: 'obstacle', label: 'Obstacle radius', min: 0, max: 12, step: 1, type: 'range' },
];

function makeInitial() {
  return { u: new Float32Array(N * N), v: new Float32Array(N * N), u0: new Float32Array(N * N), v0: new Float32Array(N * N), p: new Float32Array(N * N) };
}
const IX = (i, j) => (i < 0 ? 0 : i >= N ? N - 1 : i) + (j < 0 ? 0 : j >= N ? N - 1 : j) * N;
function setBnd(b, x) { for (let i = 0; i < N; i++) { x[IX(0, i)] = b === 1 ? -x[IX(1, i)] : x[IX(1, i)]; x[IX(N - 1, i)] = b === 1 ? -x[IX(N - 2, i)] : x[IX(N - 2, i)]; x[IX(i, 0)] = b === 2 ? -x[IX(i, 1)] : x[IX(i, 1)]; x[IX(i, N - 1)] = b === 2 ? -x[IX(i, N - 2)] : x[IX(i, N - 2)]; } }
function linSolve(b, x, x0, a, c, iters = 8) { const cR = 1 / c; for (let k = 0; k < iters; k++) { for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) { x[IX(i, j)] = (x0[IX(i, j)] + a * (x[IX(i + 1, j)] + x[IX(i - 1, j)] + x[IX(i, j + 1)] + x[IX(i, j - 1)])) * cR; } setBnd(b, x); } }
function project(u, v, p, div) {
  for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) { div[IX(i, j)] = -0.5 * (u[IX(i + 1, j)] - u[IX(i - 1, j)] + v[IX(i, j + 1)] - v[IX(i, j - 1)]) / N; p[IX(i, j)] = 0; }
  setBnd(0, div); setBnd(0, p); linSolve(0, p, div, 1, 4);
  for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) { u[IX(i, j)] -= 0.5 * N * (p[IX(i + 1, j)] - p[IX(i - 1, j)]); v[IX(i, j)] -= 0.5 * N * (p[IX(i, j + 1)] - p[IX(i, j - 1)]); }
  setBnd(1, u); setBnd(2, v);
}
function advect(b, d, d0, u, v, dt) {
  for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) { let x = i - dt * N * u[IX(i, j)], y = j - dt * N * v[IX(i, j)]; x = Math.max(0.5, Math.min(N - 1.5, x)); y = Math.max(0.5, Math.min(N - 1.5, y)); const i0 = x | 0, i1 = i0 + 1, j0 = y | 0, j1 = j0 + 1; const s1 = x - i0, s0 = 1 - s1, t1 = y - j0, t0 = 1 - t1; d[IX(i, j)] = s0 * (t0 * d0[IX(i0, j0)] + t1 * d0[IX(i0, j1)]) + s1 * (t0 * d0[IX(i1, j0)] + t1 * d0[IX(i1, j1)]); } setBnd(b, d);
}
function step(s, dt, p) {
  const { u, v, u0, v0, div, p: pr } = s; if (!div) s.div = new Float32Array(N * N);
  // inflow on left
  for (let j = 0; j < N; j++) u[IX(0, j)] = p.inflow;
  // obstacle
  const cx = N * 0.3, cy = N * 0.5, r = p.obstacle;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { if ((i - cx) ** 2 + (j - cy) ** 2 < r * r) { u[IX(i, j)] = 0; v[IX(i, j)] = 0; } }
  u0.set(u); v0.set(v);
  advect(1, u, u0, u0, v0, dt); advect(2, v, v0, u0, v0, dt);
  if (p.viscosity > 0) { linSolve(1, u, u, p.viscosity, 1 + 4 * p.viscosity); linSolve(2, v, v, p.viscosity, 1 + 4 * p.viscosity); }
  project(u, v, pr, s.div);
  // re-zero obstacle
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { if ((i - cx) ** 2 + (j - cy) ** 2 < r * r) { u[IX(i, j)] = 0; v[IX(i, j)] = 0; } }
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h); const { u, v } = s; const cw = w / N, ch = h / N;
  // vorticity colour
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const om = (v[IX(i + 1, j)] - v[IX(i - 1, j)] - (u[IX(i, j + 1)] - u[IX(i, j - 1)])) * 0.5; const t = Math.max(-1, Math.min(1, om * 3)); ctx.fillStyle = t > 0 ? `rgba(34,211,238,${t * 0.6})` : `rgba(249,115,22,${-t * 0.6})`; ctx.fillRect(i * cw, j * ch, cw + 1, ch + 1); }
  // streamlines (sparse velocity arrows)
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 0.8;
  for (let j = 2; j < N; j += 5) for (let i = 2; i < N; i += 5) { const ux = u[IX(i, j)], vy = v[IX(i, j)]; const m = Math.hypot(ux, vy); if (m < 0.01) continue; const len = Math.min(8, m * 4); ctx.beginPath(); ctx.moveTo(i * cw, j * ch); ctx.lineTo(i * cw + (ux / m) * len, j * ch + (vy / m) * len); ctx.stroke(); }
  // obstacle
  const cx = N * 0.3 * cw, cy = N * 0.5 * ch; ctx.fillStyle = 'hsl(var(--card))'; ctx.beginPath(); ctx.arc(cx, cy, p.obstacle * cw, 0, Math.PI * 2); ctx.fill();
}
function computeStats(s, p) { let vmax = 0; for (let i = 0; i < N * N; i++) vmax = Math.max(vmax, Math.hypot(s.u[i], s.v[i])); return { 'Grid': `${N}×${N}`, 'Inflow': p.inflow.toFixed(1), 'ν (viscosity)': p.viscosity.toExponential(1), 'Max |v|': vmax.toFixed(3), 'Solver': 'Stam stable fluids', 'Re≈': (p.inflow * 2 * p.obstacle / Math.max(1e-9, p.viscosity)).toExponential(2) }; }

export default function CfdLab() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ viscosity: 0.00005, inflow: 2, obstacle: 6 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats, resetKey: `${params.obstacle}` });
  const { explain, explaining, output } = useAIExplain();
  return (
    <div className="space-y-3">
      <ResearchHeader title="Computational Fluid Dynamics Laboratory" subtitle="2D incompressible Navier–Stokes (Jos Stam stable fluids): semi-Lagrangian advection + pressure projection enforces ∇·v=0. Vorticity (colour), streamlines (arrows), obstacle, inlet."
        onExplain={() => explain(`CFD: ${N}×${N} grid, inflow=${params.inflow}, viscosity=${params.viscosity.toExponential(1)}, obstacle r=${params.obstacle}. ${JSON.stringify(sim.stats)}`)} explaining={explaining} />
      <SimLayout title="CFD — 2D Navier–Stokes" configName="cfd" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
        controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
        stats={<StatGrid stats={sim.stats} />}
        exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="cfd" />}
        extra={<Card><p className="text-xs text-muted-foreground">Cyan = positive vorticity (CCW), orange = negative (CW). A cylinder sheds a Kármán vortex street at moderate Reynolds number.</p></Card>} />
      <AIPanel output={output} />
    </div>
  );
}