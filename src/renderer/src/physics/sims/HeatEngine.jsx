// Heat Engine — a generic (non-Carnot) heat engine with irreversible losses.
// Shows the energy flow Q_h → W + Q_c, with efficiency η = W/Q_h below the
// Carnot limit due to finite-rate heat transfer and friction. Sankey-style.
import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

const schema = [
  { key: 'Th', label: 'Hot reservoir T_h (K)', min: 300, max: 1200, step: 10, type: 'range' },
  { key: 'Tc', label: 'Cold reservoir T_c (K)', min: 100, max: 800, step: 10, type: 'range' },
  { key: 'loss', label: 'Irreversibility (0=Carnot)', min: 0, max: 0.5, step: 0.02, type: 'range' },
];

function makeInitial(p) { return { phase: 0, cycle: 0, hist: [] }; }
function step(s, dt, p) {
  s.phase = (s.phase + dt * 0.4) % 1; s.cycle += dt * 0.4;
  const etaC = 1 - p.Tc / p.Th; const eta = etaC * (1 - p.loss);
  if (Math.floor(s.cycle * 4) % 2 === 0 && s.hist.length < 200) { s.hist.push({ t: +s.cycle.toFixed(2), eta: +eta.toFixed(4), etaC: +etaC.toFixed(4) }); }
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const etaC = 1 - p.Tc / p.Th; const eta = etaC * (1 - p.loss);
  const Qh = 1, W = Qh * eta, Qc = Qh - W;
  // hot reservoir
  const hx = 40, hy = h * 0.25, hw = 100, hh = 50;
  ctx.fillStyle = '#f97316'; ctx.fillRect(hx, hy, hw, hh);
  ctx.fillStyle = 'white'; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center'; ctx.fillText(`Q_h = ${Qh.toFixed(2)}`, hx + hw / 2, hy + hh / 2 + 4);
  // engine
  const ex = w * 0.42, ey = h * 0.3, ew = 120, eh = 80;
  ctx.fillStyle = '#22d3ee'; ctx.fillRect(ex, ey, ew, eh);
  ctx.fillStyle = '#0a0a0c'; ctx.fillText('ENGINE', ex + ew / 2, ey + eh / 2); ctx.fillText(`η = ${(eta * 100).toFixed(1)}%`, ex + ew / 2, ey + eh / 2 + 16);
  // work out
  ctx.fillStyle = '#84cc16'; ctx.fillRect(ex + ew, ey + 20, 80, 40);
  ctx.fillStyle = '#0a0a0c'; ctx.fillText(`W = ${W.toFixed(2)}`, ex + ew + 40, ey + 42);
  // cold reservoir
  const cxx = w * 0.42, cyy = h * 0.7, cwww = 120, chh = 40;
  ctx.fillStyle = '#3b82f6'; ctx.fillRect(cxx, cyy, cwww, chh);
  ctx.fillStyle = 'white'; ctx.fillText(`Q_c = ${Qc.toFixed(2)}`, cxx + cwww / 2, cyy + chh / 2 + 4);
  ctx.textAlign = 'left';
  // flow arrows (animated by phase)
  const flowOff = Math.sin(s.phase * Math.PI * 2) * 4;
  ctx.strokeStyle = '#f97316'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(hx + hw, hy + hh / 2); ctx.lineTo(ex, ey + eh / 2); ctx.stroke();
  ctx.strokeStyle = '#84cc16'; ctx.beginPath(); ctx.moveTo(ex + ew, ey + 40); ctx.lineTo(ex + ew + 80, ey + 40); ctx.stroke();
  ctx.strokeStyle = '#3b82f6'; ctx.beginPath(); ctx.moveTo(ex + ew / 2, ey + eh); ctx.lineTo(cxx + cwww / 2, cyy); ctx.stroke();
  // efficiency plot
  const pX = 16, pY = h - 70, pW = w - 32, pH = 50;
  ctx.strokeStyle = 'hsl(var(--border))'; ctx.strokeRect(pX, pY, pW, pH);
  const X = (i) => pX + (i / Math.max(1, s.hist.length - 1)) * pW;
  const Y = (e) => pY + pH - e * pH;
  ctx.strokeStyle = '#f97316'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(pX, Y(etaC)); ctx.lineTo(pX + pW, Y(etaC)); ctx.stroke(); ctx.setLineDash([]);
  ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 1.5; ctx.beginPath();
  for (let i = 0; i < s.hist.length; i++) { if (i === 0) ctx.moveTo(X(i), Y(s.hist[i].eta)); else ctx.lineTo(X(i), Y(s.hist[i].eta)); } ctx.stroke();
  ctx.fillStyle = 'hsl(var(--muted-foreground))'; ctx.font = '9px monospace'; ctx.fillText('η (Carnot limit dashed)', pX, pY - 3);
}
function computeStats(s, p) { const etaC = 1 - p.Tc / p.Th; const eta = etaC * (1 - p.loss); return { 'η_Carnot': etaC.toFixed(4), 'η_actual': eta.toFixed(4), 'Q_h': '1.00', 'W': eta.toFixed(3), 'Q_c': (1 - eta).toFixed(3) }; }

export default function HeatEngine() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ Th: 800, Tc: 300, loss: 0.2 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats, resetKey: `${params.Th}|${params.Tc}|${params.loss}` });
  return (
    <SimLayout title="Heat Engine (Q_h → W + Q_c)" configName="heat-engine" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      exportBar={<ExportBar graphData={sim.stateRef.current?.hist || []} config={params} canvasRef={canvasRef} name="heat-engine" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">A heat engine converts Q_h into work W, dumping Q_c to the cold reservoir. η = W/Q_h is always below the Carnot limit η_C = 1 − T_c/T_h (dashed) due to irreversibility.</div>} />
  );
}