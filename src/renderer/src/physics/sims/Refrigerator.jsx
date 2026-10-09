// Refrigerator / Heat Pump — reverse heat engine. Work W moves heat Q_c from
// the cold reservoir to the hot one. COP = Q_c/W (fridge) or Q_h/W (heat pump).
// Includes irreversible losses so COP < COP_Carnot.
import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

const schema = [
  { key: 'Th', label: 'Hot reservoir T_h (K)', min: 300, max: 400, step: 5, type: 'range' },
  { key: 'Tc', label: 'Cold reservoir T_c (K)', min: 200, max: 350, step: 5, type: 'range' },
  { key: 'loss', label: 'Irreversibility', min: 0, max: 0.5, step: 0.02, type: 'range' },
  { key: 'mode', label: 'Mode', type: 'select', options: [{ value: 'fridge', label: 'Refrigerator (COP = Q_c/W)' }, { value: 'pump', label: 'Heat pump (COP = Q_h/W)' }] },
];

function makeInitial(p) { return { phase: 0, cycle: 0, hist: [] }; }
function step(s, dt, p) { s.phase = (s.phase + dt * 0.4) % 1; s.cycle += dt * 0.4; if (Math.floor(s.cycle * 4) % 2 === 0 && s.hist.length < 200) { const copC = p.Tc / (p.Th - p.Tc); const cop = copC * (1 - p.loss); s.hist.push({ t: +s.cycle.toFixed(2), cop: +cop.toFixed(3), copC: +copC.toFixed(3) }); } }
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const copC = p.Tc / Math.max(1, p.Th - p.Tc); const cop = copC * (1 - p.loss);
  const W = 1; const Qc = W * cop; const Qh = W + Qc;
  // cold reservoir
  const cx = 40, cy = h * 0.25, cw = 100, ch = 50;
  ctx.fillStyle = '#3b82f6'; ctx.fillRect(cx, cy, cw, ch);
  ctx.fillStyle = 'white'; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center'; ctx.fillText(`Q_c = ${Qc.toFixed(2)}`, cx + cw / 2, cy + ch / 2 + 4);
  // fridge
  const ex = w * 0.42, ey = h * 0.3, ew = 120, eh = 80;
  ctx.fillStyle = '#22d3ee'; ctx.fillRect(ex, ey, ew, eh);
  ctx.fillStyle = '#0a0a0c'; ctx.fillText(p.mode === 'fridge' ? 'FRIDGE' : 'HEAT PUMP', ex + ew / 2, ey + eh / 2 - 6); ctx.fillText(`COP = ${cop.toFixed(2)}`, ex + ew / 2, ey + eh / 2 + 12);
  // work in
  ctx.fillStyle = '#84cc16'; ctx.fillRect(ex + ew, ey + 20, 80, 40);
  ctx.fillStyle = '#0a0a0c'; ctx.fillText(`W = ${W.toFixed(2)}`, ex + ew + 40, ey + 42);
  // hot reservoir
  const hx = w * 0.42, hy = h * 0.7, hw = 120, hh = 40;
  ctx.fillStyle = '#f97316'; ctx.fillRect(hx, hy, hw, hh);
  ctx.fillStyle = 'white'; ctx.fillText(`Q_h = ${Qh.toFixed(2)}`, hx + hw / 2, hy + hh / 2 + 4);
  ctx.textAlign = 'left';
  // arrows (reverse direction — heat flows cold→hot)
  ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx + cw, cy + ch / 2); ctx.lineTo(ex, ey + eh / 2); ctx.stroke();
  ctx.strokeStyle = '#84cc16'; ctx.beginPath(); ctx.moveTo(ex + ew, ey + 40); ctx.lineTo(ex + ew + 80, ey + 40); ctx.stroke();
  ctx.strokeStyle = '#f97316'; ctx.beginPath(); ctx.moveTo(ex + ew / 2, ey + eh); ctx.lineTo(hx + hw / 2, hy); ctx.stroke();
  // COP plot
  const pX = 16, pY = h - 70, pW = w - 32, pH = 50;
  ctx.strokeStyle = 'hsl(var(--border))'; ctx.strokeRect(pX, pY, pW, pH);
  const X = (i) => pX + (i / Math.max(1, s.hist.length - 1)) * pW;
  const Yc = (c) => pY + pH - Math.min(c / (copC + 1), 1) * pH;
  ctx.strokeStyle = '#f97316'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(pX, Yc(copC)); ctx.lineTo(pX + pW, Yc(copC)); ctx.stroke(); ctx.setLineDash([]);
  ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 1.5; ctx.beginPath();
  for (let i = 0; i < s.hist.length; i++) { if (i === 0) ctx.moveTo(X(i), Yc(s.hist[i].cop)); else ctx.lineTo(X(i), Yc(s.hist[i].cop)); } ctx.stroke();
  ctx.fillStyle = 'hsl(var(--muted-foreground))'; ctx.font = '9px monospace'; ctx.fillText('COP (Carnot limit dashed)', pX, pY - 3);
}
function computeStats(s, p) { const copC = p.Tc / Math.max(1, p.Th - p.Tc); const cop = copC * (1 - p.loss); const W = 1; const Qc = W * cop; const Qh = W + Qc; return { 'COP_Carnot': copC.toFixed(3), 'COP_actual': cop.toFixed(3), 'W': W.toFixed(2), 'Q_c': Qc.toFixed(3), 'Q_h': Qh.toFixed(3) }; }

export default function Refrigerator() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ Th: 320, Tc: 270, loss: 0.2, mode: 'fridge' });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats, resetKey: `${params.Th}|${params.Tc}|${params.loss}|${params.mode}` });
  return (
    <SimLayout title="Refrigerator / Heat Pump" configName="refrigerator" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      exportBar={<ExportBar graphData={sim.stateRef.current?.hist || []} config={params} canvasRef={canvasRef} name="refrigerator" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">A refrigerator uses work W to move heat Q_c from cold to hot — the reverse of a heat engine. COP = Q_c/W (fridge) or Q_h/W (heat pump), always below the Carnot COP = T_c/(T_h−T_c).</div>} />
  );
}