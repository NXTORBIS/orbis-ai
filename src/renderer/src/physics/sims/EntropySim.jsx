// Entropy Simulator — two gases mixing in a divided box. The partition is
// removed and particles diffuse; entropy S = -k Σ p_i ln p_i is computed
// from the spatial occupancy distribution and rises monotonically to
// equilibrium, illustrating the Second Law.
import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

const schema = [
  { key: 'N', label: 'Particles per side', min: 20, max: 120, step: 5, type: 'range' },
  { key: 'speed', label: 'Particle speed', min: 0.2, max: 2, step: 0.05, type: 'range' },
  { key: 'cells', label: 'Entropy grid cells', min: 4, max: 16, step: 2, type: 'range' },
];

function makeInitial(p) {
  const rng = (() => { let s = 31337; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
  const x = [], y = [], side = [];
  for (let i = 0; i < p.N; i++) { x.push(0.02 + 0.46 * rng()); y.push(0.05 + 0.9 * rng()); side.push(0); }
  for (let i = 0; i < p.N; i++) { x.push(0.52 + 0.46 * rng()); y.push(0.05 + 0.9 * rng()); side.push(1); }
  return { x, y, vx: [], vy: [], side, removed: false, t: 0, hist: [] };
}
function step(s, dt, p) {
  if (!s.vx.length) { const rng = (() => { let seed = 42; return () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })(); for (let i = 0; i < s.x.length; i++) { const a = rng() * Math.PI * 2; s.vx.push(Math.cos(a) * p.speed); s.vy.push(Math.sin(a) * p.speed); } }
  s.t += dt;
  if (s.t > 1.5 && !s.removed) s.removed = true;
  const W = 1, H = 1, r = 0.008;
  for (let i = 0; i < s.x.length; i++) { s.x[i] += s.vx[i] * dt; s.y[i] += s.vy[i] * dt; }
  for (let i = 0; i < s.x.length; i++) {
    if (s.x[i] < r) { s.x[i] = r; s.vx[i] = Math.abs(s.vx[i]); }
    if (s.x[i] > W - r) { s.x[i] = W - r; s.vx[i] = -Math.abs(s.vx[i]); }
    if (s.y[i] < r) { s.y[i] = r; s.vy[i] = Math.abs(s.vy[i]); }
    if (s.y[i] > H - r) { s.y[i] = H - r; s.vy[i] = -Math.abs(s.vy[i]); }
    if (!s.removed && s.side[i] === 0 && s.x[i] > 0.5 - r) { s.x[i] = 0.5 - r; s.vx[i] = -Math.abs(s.vx[i]); }
    if (!s.removed && s.side[i] === 1 && s.x[i] < 0.5 + r) { s.x[i] = 0.5 + r; s.vx[i] = Math.abs(s.vx[i]); }
  }
  // entropy from spatial distribution
  const cells = p.cells; const grid = new Array(cells * cells).fill(0);
  for (let i = 0; i < s.x.length; i++) { const gx = Math.min(cells - 1, Math.floor(s.x[i] * cells)); const gy = Math.min(cells - 1, Math.floor(s.y[i] * cells)); grid[gy * cells + gx]++; }
  let S = 0; const N = s.x.length;
  for (const c of grid) { if (c > 0) { const pi = c / N; S -= pi * Math.log(pi); } }
  if (Math.floor(s.t * 5) % 2 === 0) { s.hist.push({ t: +s.t.toFixed(2), S: +S.toFixed(4) }); if (s.hist.length > 200) s.hist.shift(); }
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const bx = 20, by = 20, bh = h - 130, bw = h - 40;
  ctx.strokeStyle = 'hsl(var(--muted-foreground))'; ctx.lineWidth = 2; ctx.strokeRect(bx, by, bw, bh);
  if (!s.removed) { ctx.strokeStyle = '#f43f5e'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(bx + bw / 2, by); ctx.lineTo(bx + bw / 2, by + bh); ctx.stroke(); }
  const sx = bw, sy = bh;
  for (let i = 0; i < s.x.length; i++) { ctx.fillStyle = s.side[i] === 0 ? '#22d3ee' : '#f97316'; ctx.beginPath(); ctx.arc(bx + s.x[i] * sx, by + s.y[i] * sy, 3, 0, Math.PI * 2); ctx.fill(); }
  // entropy plot
  const pX = 16, pY = h - 90, pW = w - 32, pH = 70;
  ctx.strokeStyle = 'hsl(var(--border))'; ctx.strokeRect(pX, pY, pW, pH);
  const Smax = Math.log(p.cells * p.cells);
  const X = (i) => pX + (i / Math.max(1, s.hist.length - 1)) * pW;
  const Y = (S) => pY + pH - (S / Smax) * pH;
  ctx.strokeStyle = '#84cc16'; ctx.lineWidth = 2; ctx.beginPath();
  for (let i = 0; i < s.hist.length; i++) { if (i === 0) ctx.moveTo(X(i), Y(s.hist[i].S)); else ctx.lineTo(X(i), Y(s.hist[i].S)); } ctx.stroke();
  ctx.fillStyle = 'hsl(var(--muted-foreground))'; ctx.font = '10px monospace'; ctx.fillText('S ↑', pX, pY - 3); ctx.fillText('t →', pX + pW - 20, pY + pH + 12);
}
function computeStats(s, p) {
  const cells = p.cells; const grid = new Array(cells * cells).fill(0);
  for (let i = 0; i < s.x.length; i++) { const gx = Math.min(cells - 1, Math.floor(s.x[i] * cells)); const gy = Math.min(cells - 1, Math.floor(s.y[i] * cells)); grid[gy * cells + gx]++; }
  let S = 0; const N = s.x.length;
  for (const c of grid) { if (c > 0) { const pi = c / N; S -= pi * Math.log(pi); } }
  const left = s.x.filter((x) => x < 0.5).length; const right = s.x.length - left;
  return { 'S (measured)': S.toFixed(4), 'S_max': Math.log(cells * cells).toFixed(4), 'Left': left, 'Right': right, 'Partition': s.removed ? 'removed' : 'in place' };
}

export default function EntropySim() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ N: 60, speed: 0.8, cells: 8 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats, resetKey: `${params.N}|${params.speed}|${params.cells}` });
  return (
    <SimLayout title="Entropy Simulator (Second Law)" configName="entropy-sim" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      exportBar={<ExportBar graphData={sim.stateRef.current?.hist || []} config={params} canvasRef={canvasRef} name="entropy-sim" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Two gases (cyan/orange) separated by a partition. The partition lifts after 1.5s — particles mix and entropy S = −Σ p ln p rises monotonically, never reversing (Second Law).</div>} />
  );
}