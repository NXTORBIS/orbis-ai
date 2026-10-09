// Carnot engine — thermodynamic P-V cycle
import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

const schema = [
  { key: 'Th', label: 'Hot reservoir T_h (K)', min: 300, max: 1200, step: 10, type: 'range' },
  { key: 'Tc', label: 'Cold reservoir T_c (K)', min: 100, max: 800, step: 10, type: 'range' },
  { key: 'r', label: 'Compression ratio V2/V1', min: 1.5, max: 8, step: 0.1, type: 'range' },
  { key: 'gamma', label: 'Adiabatic index γ', min: 1.2, max: 1.7, step: 0.01, type: 'range' },
];

function makeInitial() { return { phase: 0 }; }
function cycle(p) {
  const { Th, Tc, r, gamma } = p;
  const V1 = 1, V2 = r;
  const V3 = V2 * Math.pow(Th / Tc, 1 / (gamma - 1));
  const V4 = V1 * Math.pow(Th / Tc, 1 / (gamma - 1));
  const P = (V, T) => T / V; // nR=1
  const pts = [
    { V: V1, T: Th, P: P(V1, Th) }, { V: V2, T: Th, P: P(V2, Th) },
    { V: V3, T: Tc, P: P(V3, Tc) }, { V: V4, T: Tc, P: P(V4, Tc) },
  ];
  const Qh = Th * Math.log(V2 / V1), Qc = Tc * Math.log(V3 / V4), W = Qh - Qc, eta = 1 - Tc / Th;
  return { pts, Qh, Qc, W, eta, V1, V2, V3, V4, Th, Tc };
}
function step(s, dt) { s.phase = (s.phase + dt * 0.5) % 1; }
function pointOnCycle(p, phase) {
  const c = cycle(p); const { V1, V2, V3, V4, Th, Tc, gamma } = p;
  const segs = [
    { from: 0, to: 0.25, fn: (u) => { const V = V1 * Math.pow(V2 / V1, u); return { V, P: Th / V }; } }, // isothermal Th
    { from: 0.25, to: 0.5, fn: (u) => { const V = V2 * Math.pow(V3 / V2, u); const T = Th * Math.pow(V2 / V, gamma - 1); return { V, P: T / V }; } }, // adiabatic
    { from: 0.5, to: 0.75, fn: (u) => { const V = V3 * Math.pow(V4 / V3, u); return { V, P: Tc / V }; } }, // isothermal Tc
    { from: 0.75, to: 1, fn: (u) => { const V = V4 * Math.pow(V1 / V4, u); const T = Tc * Math.pow(V4 / V, gamma - 1); return { V, P: T / V }; } }, // adiabatic
  ];
  const seg = segs.find((s) => phase >= s.from && phase <= s.to) || segs[3];
  const u = (phase - seg.from) / (seg.to - seg.from);
  return seg.fn(u);
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h); const c = cycle(p);
  const padX = 40, padY = 24; const W = w - 2 * padX, H = h - 2 * padY;
  const Vmax = c.V3 * 1.1, Pmax = c.pts[0].P * 1.1;
  const X = (V) => padX + (V / Vmax) * W; const Y = (P) => padY + H - (P / Pmax) * H;
  // isotherms (full curves)
  ctx.strokeStyle = '#f97316'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
  for (let u = 0; u <= 1; u += 0.02) { const V = c.V1 * Math.pow(c.V3 / c.V1, u); const x = X(V), y = Y(c.Th / V); if (u === 0) ctx.beginPath(), ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.stroke();
  for (let u = 0; u <= 1; u += 0.02) { const V = c.V1 * Math.pow(c.V3 / c.V1, u); const x = X(V), y = Y(c.Tc / V); if (u === 0) ctx.beginPath(), ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.stroke();
  ctx.setLineDash([]);
  // cycle
  ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2.5; ctx.beginPath();
  for (let i = 0; i <= 100; i++) { const ph = i / 100; const pt = pointOnCycle(p, ph); const x = X(pt.V), y = Y(pt.P); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.closePath(); ctx.stroke();
  // current point
  const cur = pointOnCycle(p, s.phase); ctx.fillStyle = '#f43f5e'; ctx.beginPath(); ctx.arc(X(cur.V), Y(cur.P), 7, 0, Math.PI * 2); ctx.fill();
  // labels
  ctx.fillStyle = 'hsl(var(--muted-foreground))'; ctx.font = '11px monospace'; ctx.fillText('V →', padX + W - 24, padY + H + 16); ctx.fillText('P ↑', padX - 24, padY + 10);
}
function computeStats(s, p) { const c = cycle(p); return { 'η (Carnot)': c.eta.toFixed(4), 'Q_h': c.Qh.toFixed(2), 'Q_c': c.Qc.toFixed(2), 'W_net': c.W.toFixed(2), 'T_h': p.Th, 'T_c': p.Tc }; }

export default function CarnotEngine() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ Th: 800, Tc: 300, r: 3, gamma: 1.4 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats, resetKey: `${params.Th}|${params.Tc}|${params.r}|${params.gamma}` });
  return (
    <SimLayout title="Carnot Engine (P–V Cycle)" configName="carnot" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="carnot" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Two isotherms + two adiabats. η = 1 − T_c/T_h is the maximum possible efficiency between two reservoirs.</div>} />
  );
}