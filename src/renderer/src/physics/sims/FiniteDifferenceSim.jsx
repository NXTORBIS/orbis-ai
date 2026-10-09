// Finite Difference Method — 1D wave equation u_tt = c² u_xx via leapfrog scheme
import React, { useState, useMemo, useRef } from 'react';
import { CanvasStage, stageBg, TransportBar, StatGrid, ExportBar } from '../ui.jsx';
import { useSim } from '../useSim.js';
import { ResearchHeader, Card, NumField, AIPanel, useAIExplain } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';

const NX = 100;
const L = 1;

function makeInitial(p) {
  const u = new Array(NX), uPrev = new Array(NX);
  for (let i = 0; i < NX; i++) {
    const x = (i / (NX - 1)) * L;
    // Gaussian pluck centered at p.pluck
    const v = Math.exp(-((x - p.pluck) ** 2) / (2 * 0.03 * 0.03));
    u[i] = v;
    uPrev[i] = v; // zero initial velocity → u_prev = u
  }
  return { u, uPrev, t: 0, energy: 0 };
}

function step(s, dt, p) {
  const c = p.c;
  const dx = L / (NX - 1);
  const r = c * dt / dx; // Courant number
  const u = s.u, uPrev = s.uPrev;
  const uNext = new Array(NX);
  uNext[0] = 0; uNext[NX - 1] = 0; // fixed ends
  for (let i = 1; i < NX - 1; i++) {
    uNext[i] = 2 * u[i] - uPrev[i] + r * r * (u[i - 1] - 2 * u[i] + u[i + 1]);
  }
  s.uPrev = u; s.u = uNext; s.t += dt;
}

function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const padX = 30, padY = 20;
  const W = w - 2 * padX, H = h - 2 * padY;
  // string
  ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < NX; i++) {
    const x = padX + (i / (NX - 1)) * W;
    const y = padY + H / 2 - s.u[i] * H * 0.4;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  // endpoints
  ctx.fillStyle = '#f97316';
  ctx.beginPath(); ctx.arc(padX, padY + H / 2, 4, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(padX + W, padY + H / 2, 4, 0, 7); ctx.fill();
  // CFL indicator
  const dx = L / (NX - 1);
  const r = p.c * (1 / 120) / dx;
  ctx.fillStyle = r > 1 ? '#ef4444' : '#22c55e';
  ctx.font = '11px monospace';
  ctx.fillText(`CFL = ${r.toFixed(3)} ${r > 1 ? '⚠ UNSTABLE' : '✓'}`, padX + 8, padY + 14);
}

function sample(s, p) {
  let ke = 0, pe = 0;
  for (let i = 1; i < NX - 1; i++) {
    const v = (s.u[i] - s.uPrev[i]) * 120; // approximate velocity
    ke += v * v;
    pe += (s.u[i + 1] - s.u[i]) ** 2;
  }
  return { t: s.t, mid: s.u[Math.floor(NX / 2)], energy: ke + pe };
}

function computeStats(s, p) {
  const dx = L / (NX - 1);
  const cfl = p.c * (1 / 120) / dx;
  let maxU = 0;
  for (let i = 0; i < NX; i++) maxU = Math.max(maxU, Math.abs(s.u[i]));
  return { 'c': p.c.toFixed(2), 'CFL': cfl.toFixed(3), 'max|u|': maxU.toFixed(4), 't': s.t.toFixed(3), 'stability': cfl > 1 ? '⚠' : '✓' };
}

export default function FiniteDifferenceSim() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ c: 0.5, pluck: 0.3 });
  const { explain, explaining, output } = useAIExplain();
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, sample, computeStats, resetKey: `${params.c}|${params.pluck}` });

  const cfl = params.c * (1 / 120) / (L / (NX - 1));

  return (
    <div className="space-y-4">
      <ResearchHeader title="Finite Difference Method — 1D Wave Equation u_tt = c²u_xx"
        subtitle="Leapfrog (central difference in both time and space). Fixed-end boundary conditions. CFL condition: c·Δt/Δx ≤ 1 for stability."
        onExplain={() => explain(`Wave equation with c=${params.c}, Gaussian pluck at x=${params.pluck}. CFL = ${cfl.toFixed(3)} ${cfl > 1 ? '— UNSTABLE, waves blow up' : '— stable'}. The wave splits into left- and right-traveling components, reflects off the fixed ends, and returns inverted. Energy is conserved when stable.`)}
        explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr_280px]">
        <div className="space-y-3">
          <Card title="Parameters">
            <NumField label="wave speed c" value={params.c} onChange={(v) => setParams({ ...params, c: v })} min={0.1} max={2} step={0.05} />
            <div className="mt-2"><NumField label="pluck position" value={params.pluck} onChange={(v) => setParams({ ...params, pluck: v })} min={0.1} max={0.9} step={0.05} /></div>
          </Card>
          <div className={`rounded-xl border p-3 text-xs ${cfl > 1 ? 'border-red-500/40 bg-red-500/5 text-red-500' : 'border-emerald-500/40 bg-emerald-500/5 text-emerald-500'}`}>
            CFL = {cfl.toFixed(3)} {cfl > 1 ? '⚠ UNSTABLE' : '✓ stable'}
          </div>
        </div>
        <div className="space-y-3">
          <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden" style={{ height: 300 }}>
            <CanvasStage ref={canvasRef} />
          </div>
          <TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />
          <ExportBar graphData={sim.graphData} config={params} canvasRef={canvasRef} name="fdm-wave" />
        </div>
        <div className="space-y-3">
          <StatGrid stats={sim.stats} />
          <SciPlot type="line" data={sim.graphData} xKey="t" height={160}
            series={[{ key: 'mid', label: 'u(L/2)', color: '#22d3ee' }]}
            xLabel="t" yLabel="u" exportName="fdm-probe" />
        </div>
      </div>
      <AIPanel output={output} />
    </div>
  );
}