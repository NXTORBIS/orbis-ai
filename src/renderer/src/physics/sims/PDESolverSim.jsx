// PDE Solver — 1D heat equation u_t = α u_xx via explicit finite differences
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { CanvasStage, stageBg, TransportBar, StatGrid, ExportBar } from '../ui.jsx';
import { useSim } from '../useSim.js';
import { ResearchHeader, Card, NumField, AIPanel, useAIExplain } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';

const NX = 80;
const L = 1;

function makeInitial(p) {
  const u = new Array(NX);
  for (let i = 0; i < NX; i++) {
    const x = (i / (NX - 1)) * L;
    // Gaussian bump centered at p.center
    u[i] = Math.exp(-((x - p.center) ** 2) / (2 * p.sigma * p.sigma));
  }
  return { u, t: 0 };
}

function step(s, dt, p) {
  const alpha = p.alpha;
  const dx = L / (NX - 1);
  const r = alpha * dt / (dx * dx); // CFL number
  const u = s.u;
  const un = new Array(NX);
  // Dirichlet BC: u[0]=u[NX-1]=0
  un[0] = 0; un[NX - 1] = 0;
  for (let i = 1; i < NX - 1; i++) {
    un[i] = u[i] + r * (u[i - 1] - 2 * u[i] + u[i + 1]);
  }
  s.u = un; s.t += dt;
}

function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const padX = 30, padY = 20;
  const W = w - 2 * padX, H = h - 2 * padY;
  const dx = L / (NX - 1);
  // color-mapped temperature bar
  for (let i = 0; i < NX; i++) {
    const x = padX + (i / (NX - 1)) * W;
    const bw = W / NX + 1;
    const v = Math.max(0, Math.min(1, s.u[i]));
    const r = Math.floor(255 * v), b = Math.floor(255 * (1 - v));
    ctx.fillStyle = `rgb(${r}, ${Math.floor(80 * (1 - v))}, ${b})`;
    ctx.fillRect(x, padY, bw, H);
  }
  // profile line
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < NX; i++) {
    const x = padX + (i / (NX - 1)) * W;
    const y = padY + H - s.u[i] * H * 0.9;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  // labels
  ctx.fillStyle = 'hsl(var(--muted-foreground))'; ctx.font = '10px monospace';
  ctx.fillText('x=0', padX, padY + H + 14);
  ctx.fillText('x=L', padX + W - 20, padY + H + 14);
  ctx.fillText('u(x,t)', padX - 24, padY + 8);
}

function sample(s, p) {
  // sample at a few probe points
  return { t: s.t, mid: s.u[Math.floor(NX / 2)], q1: s.u[Math.floor(NX / 4)], q3: s.u[Math.floor(3 * NX / 4)] };
}

function computeStats(s, p) {
  const dx = L / (NX - 1);
  const cfl = p.alpha * (1 / 60) / (dx * dx);
  let maxU = 0, totalE = 0;
  for (let i = 0; i < NX; i++) { maxU = Math.max(maxU, s.u[i]); totalE += s.u[i] * dx; }
  return { 'α': p.alpha.toFixed(3), 'CFL (at dt=1/60)': cfl.toFixed(3), 'max u': maxU.toFixed(4), '∫u dx': totalE.toFixed(4), 't': s.t.toFixed(2) };
}

export default function PDESolverSim() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ alpha: 0.01, center: 0.5, sigma: 0.08 });
  const { explain, explaining, output } = useAIExplain();
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, sample, computeStats, resetKey: `${params.alpha}|${params.center}|${params.sigma}` });

  const cfl = params.alpha * (1 / 60) / Math.pow(L / (NX - 1), 2);

  return (
    <div className="space-y-4">
      <ResearchHeader title="PDE Solver — 1D Heat Equation u_t = α u_xx"
        subtitle="Explicit forward-time central-space (FTCS) finite differences. Dirichlet BCs u(0)=u(L)=0. Stability requires CFL = αΔt/Δx² ≤ ½."
        onExplain={() => explain(`Heat equation with α=${params.alpha}, Gaussian initial profile centered at ${params.center}. CFL number at dt=1/60 is ${cfl.toFixed(3)} — ${cfl > 0.5 ? 'UNSTABLE (CFL > 0.5)' : 'stable'}. The bump diffuses and decays; total thermal energy ∫u dx decreases as heat exits the boundaries.`)}
        explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr_280px]">
        <div className="space-y-3">
          <Card title="Parameters">
            <NumField label="diffusivity α" value={params.alpha} onChange={(v) => setParams({ ...params, alpha: v })} min={0.001} max={0.05} step={0.001} />
            <div className="mt-2"><NumField label="bump center" value={params.center} onChange={(v) => setParams({ ...params, center: v })} min={0.1} max={0.9} step={0.05} /></div>
            <div className="mt-2"><NumField label="bump width σ" value={params.sigma} onChange={(v) => setParams({ ...params, sigma: v })} min={0.02} max={0.3} step={0.01} /></div>
          </Card>
          <div className={`rounded-xl border p-3 text-xs ${cfl > 0.5 ? 'border-red-500/40 bg-red-500/5 text-red-500' : 'border-emerald-500/40 bg-emerald-500/5 text-emerald-500'}`}>
            CFL = {cfl.toFixed(3)} {cfl > 0.5 ? '⚠ UNSTABLE' : '✓ stable'}
          </div>
        </div>
        <div className="space-y-3">
          <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden" style={{ height: 300 }}>
            <CanvasStage ref={canvasRef} />
          </div>
          <TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />
          <ExportBar graphData={sim.graphData} config={params} canvasRef={canvasRef} name="heat-pde" />
        </div>
        <div className="space-y-3">
          <StatGrid stats={sim.stats} />
          <SciPlot type="line" data={sim.graphData} xKey="t" height={160}
            series={[{ key: 'mid', label: 'u(L/2)', color: '#22d3ee' }, { key: 'q1', label: 'u(L/4)', color: '#f97316' }, { key: 'q3', label: 'u(3L/4)', color: '#a855f7' }]}
            xLabel="t" yLabel="u" exportName="heat-probes" />
        </div>
      </div>
      <AIPanel output={output} />
    </div>
  );
}