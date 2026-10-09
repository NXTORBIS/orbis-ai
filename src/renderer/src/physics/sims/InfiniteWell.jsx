// Infinite Potential Well — dedicated energy-level & eigenstate viewer.
// Shows the n² energy scaling, standing-wave eigenfunctions, and lets the
// user select any n to see its wavefunction and energy level highlighted.
import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

const NX = 200;
const schema = [
  { key: 'n', label: 'Quantum number n', min: 1, max: 8, step: 1, type: 'range' },
  { key: 'showLevels', label: 'Show all levels', type: 'toggle' },
];

function makeInitial() { return {}; }
function step() {}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const padX = 50, padY = 30; const W = w - 2 * padX, H = h - 2 * padY; const baseY = padY + H;
  // box walls
  ctx.strokeStyle = 'hsl(var(--muted-foreground))'; ctx.lineWidth = 2; ctx.strokeRect(padX, padY, W, H);
  const Emax = 64 * Math.PI * Math.PI / 2; // n=8
  const Y = (E) => baseY - (E / Emax) * H * 0.85;
  // energy levels
  if (p.showLevels) {
    for (let n = 1; n <= 8; n++) {
      const En = (n * n * Math.PI * Math.PI) / 2; const y = Y(En);
      ctx.strokeStyle = n === p.n ? '#22d3ee' : 'hsl(var(--muted-foreground) / 0.3)'; ctx.lineWidth = n === p.n ? 2 : 1;
      ctx.setLineDash(n === p.n ? [] : [3, 3]); ctx.beginPath(); ctx.moveTo(padX, y); ctx.lineTo(padX + W, y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = n === p.n ? '#22d3ee' : 'hsl(var(--muted-foreground))'; ctx.font = '10px monospace'; ctx.fillText(`E_${n}=${En.toFixed(1)}`, padX + W + 4, y + 3);
    }
  }
  // selected eigenfunction
  const n = p.n; const En = (n * n * Math.PI * Math.PI) / 2; const yE = Y(En);
  ctx.strokeStyle = '#f97316'; ctx.lineWidth = 2; ctx.beginPath();
  for (let i = 0; i <= NX; i++) { const x = i / NX; const psi = Math.sqrt(2) * Math.sin(n * Math.PI * x); ctx.lineTo(padX + x * W, yE - psi * H * 0.12); } ctx.stroke();
  // |psi|^2 fill
  ctx.fillStyle = '#22d3ee44'; ctx.beginPath(); ctx.moveTo(padX, yE);
  for (let i = 0; i <= NX; i++) { const x = i / NX; const psi = Math.sqrt(2) * Math.sin(n * Math.PI * x); ctx.lineTo(padX + x * W, yE - psi * psi * H * 0.08); }
  ctx.lineTo(padX + W, yE); ctx.closePath(); ctx.fill();
  // labels
  ctx.fillStyle = 'hsl(var(--muted-foreground))'; ctx.font = '10px monospace'; ctx.fillText('x →', padX + W - 20, baseY + 14); ctx.fillText('E ↑', padX - 20, padY + 4);
}
function computeStats(s, p) { const En = (p.n * p.n * Math.PI * Math.PI) / 2; return { 'n': p.n, 'E_n': En.toFixed(3), 'E_n (n²π²/2)': (p.n * p.n * Math.PI * Math.PI / 2).toFixed(3), 'Nodes': p.n - 1, 'Wavelength': (2 / p.n).toFixed(3) }; }

export default function InfiniteWell() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ n: 2, showLevels: true });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats, resetKey: `${params.n}|${params.showLevels}` });
  return (
    <SimLayout title="Infinite Potential Well (Energy Levels)" configName="infinite-well" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="infinite-well" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Eₙ = n²π²ℏ²/2mL². The n² scaling means levels get farther apart as n grows. Each eigenstate has n−1 nodes. Toggle all levels to see the full ladder.</div>} />
  );
}