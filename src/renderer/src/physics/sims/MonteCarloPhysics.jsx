// Monte Carlo Physics — stochastic sampling to estimate π (needle/ball
// dropping) and to integrate a function. Shows convergence of the estimate
// with sample count and the √N error scaling.
import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

const schema = [
  { key: 'mode', label: 'Estimator', type: 'select', options: [{ value: 'pi', label: 'π via unit-circle sampling' }, { value: 'integrate', label: '∫₀¹ sin(x) dx via sampling' }] },
  { key: 'batch', label: 'Samples per frame', min: 10, max: 500, step: 10, type: 'range' },
];

function makeInitial() { return { inside: 0, total: 0, points: [], estimate: 0, hist: [], t: 0, sum: 0 }; }
function step(s, dt, p) {
  s.t += dt; const n = Math.round(p.batch * dt * 60);
  for (let k = 0; k < n; k++) {
    const x = Math.random(), y = Math.random();
    if (p.mode === 'pi') { const inside = x * x + y * y < 1; if (inside) s.inside++; s.total++; s.points.push({ x, y, inside }); if (s.points.length > 2000) s.points.shift(); s.estimate = 4 * s.inside / s.total; }
    else { s.sum += Math.sin(x); s.total++; s.points.push({ x, y: Math.random(), inside: y < Math.sin(x) }); if (s.points.length > 2000) s.points.shift(); s.estimate = s.sum / s.total; }
  }
  if (Math.floor(s.t * 10) % 2 === 0) { const exact = p.mode === 'pi' ? Math.PI : 1 - Math.cos(1); const err = Math.abs(s.estimate - exact); s.hist.push({ t: s.t, estimate: +s.estimate.toFixed(5), error: +err.toFixed(5) }); if (s.hist.length > 200) s.hist.shift(); }
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const bx = 20, by = 20, bh = h - 120, bw = bh;
  ctx.strokeStyle = 'hsl(var(--muted-foreground))'; ctx.lineWidth = 2; ctx.strokeRect(bx, by, bw, bh);
  if (p.mode === 'pi') { ctx.strokeStyle = '#f97316'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(bx, by, bw, 0, Math.PI / 2); ctx.stroke(); }
  else { ctx.strokeStyle = '#f97316'; ctx.lineWidth = 2; ctx.beginPath(); for (let i = 0; i <= 50; i++) { const x = i / 50; const px = bx + x * bw, py = by + bh - Math.sin(x) * bh; if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); } ctx.stroke(); }
  for (const pt of s.points) { ctx.fillStyle = pt.inside ? '#22d3ee88' : '#f43f5e44'; ctx.fillRect(bx + pt.x * bw - 1, by + (1 - pt.y) * bh - 1, 2, 2); }
  // estimate plot
  const pX = 16, pY = h - 80, pW = w - 32, pH = 60;
  ctx.strokeStyle = 'hsl(var(--border))'; ctx.strokeRect(pX, pY, pW, pH);
  const exact = p.mode === 'pi' ? Math.PI : 1 - Math.cos(1);
  const X = (i) => pX + (i / Math.max(1, s.hist.length - 1)) * pW;
  const Y = (e) => { const lo = exact * 0.8, hi = exact * 1.2; return pY + pH - ((e - lo) / (hi - lo + 1e-9)) * pH; };
  ctx.strokeStyle = '#f97316'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(pX, Y(exact)); ctx.lineTo(pX + pW, Y(exact)); ctx.stroke(); ctx.setLineDash([]);
  ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 1.5; ctx.beginPath();
  for (let i = 0; i < s.hist.length; i++) { if (i === 0) ctx.moveTo(X(i), Y(s.hist[i].estimate)); else ctx.lineTo(X(i), Y(s.hist[i].estimate)); } ctx.stroke();
  ctx.fillStyle = 'hsl(var(--muted-foreground))'; ctx.font = '10px monospace'; ctx.fillText(`${p.mode === 'pi' ? 'π' : '∫sin'} estimate (exact dashed)`, pX, pY - 3);
}
function computeStats(s, p) { const exact = p.mode === 'pi' ? Math.PI : 1 - Math.cos(1); return { 'Samples': s.total, 'Estimate': s.estimate.toFixed(5), 'Exact': exact.toFixed(5), 'Error': Math.abs(s.estimate - exact).toFixed(5), '√N': Math.sqrt(s.total).toFixed(1) }; }

export default function MonteCarloPhysics() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ mode: 'pi', batch: 100 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats, resetKey: `${params.mode}` });
  return (
    <SimLayout title="Monte Carlo Physics" configName="monte-carlo-physics" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      exportBar={<ExportBar graphData={sim.stateRef.current?.hist || []} config={params} canvasRef={canvasRef} name="monte-carlo-physics" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Random sampling estimates π (fraction of points inside the quarter circle) or ∫sin(x)dx. The estimate converges to the exact value (dashed) as samples accumulate; error scales as 1/√N.</div>} />
  );
}