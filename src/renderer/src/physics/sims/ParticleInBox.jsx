import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, LiveGraph, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

const NX = 220;
const schema = [
  { key: 'w1', label: 'State n=1 weight', min: 0, max: 1, step: 0.05, type: 'range' },
  { key: 'w2', label: 'State n=2 weight', min: 0, max: 1, step: 0.05, type: 'range' },
  { key: 'w3', label: 'State n=3 weight', min: 0, max: 1, step: 0.05, type: 'range' },
  { key: 'w4', label: 'State n=4 weight', min: 0, max: 1, step: 0.05, type: 'range' },
  { key: 'w5', label: 'State n=5 weight', min: 0, max: 1, step: 0.05, type: 'range' },
  { key: 'w6', label: 'State n=6 weight', min: 0, max: 1, step: 0.05, type: 'range' },
];

function makeInitial() { return {}; }
function step() {}
function psi(s, p, x, t) {
  let re = 0, im = 0;
  for (let n = 1; n <= 6; n++) { const w = p['w' + n]; if (!w) continue; const En = (n * n * Math.PI * Math.PI) / 2; const phi = Math.sqrt(2) * Math.sin(n * Math.PI * x); const ph = -En * t; re += w * phi * Math.cos(ph); im += w * phi * Math.sin(ph); }
  return [re, im];
}
function draw(ctx, s, p, w, h, t) {
  stageBg(ctx, w, h);
  const padX = 40, padY = 30; const W = w - 2 * padX, H = h - 2 * padY; const baseY = padY + H;
  // box walls
  ctx.strokeStyle = 'hsl(var(--muted-foreground))'; ctx.lineWidth = 2; ctx.strokeRect(padX, padY, W, H);
  // normalise
  let norm = 0; for (let n = 1; n <= 6; n++) norm += (p['w' + n] || 0) ** 2; norm = Math.sqrt(norm) || 1;
  // |psi|^2 filled
  ctx.fillStyle = '#22d3ee44';
  ctx.beginPath(); ctx.moveTo(padX, baseY);
  for (let i = 0; i <= NX; i++) { const x = i / NX; const [re, im] = psi(s, p, x, t); const prob = (re * re + im * im) / (norm * norm); ctx.lineTo(padX + x * W, baseY - prob * H * 0.9); }
  ctx.lineTo(padX + W, baseY); ctx.closePath(); ctx.fill();
  // Re(psi)
  ctx.strokeStyle = '#f97316'; ctx.lineWidth = 2; ctx.beginPath();
  for (let i = 0; i <= NX; i++) { const x = i / NX; const [re] = psi(s, p, x, t); const val = re / norm; ctx.lineTo(padX + x * W, baseY - val * H * 0.45); }
  ctx.stroke();
  // Im(psi)
  ctx.strokeStyle = '#a855f7'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5; ctx.beginPath();
  for (let i = 0; i <= NX; i++) { const x = i / NX; const [, im] = psi(s, p, x, t); const val = im / norm; ctx.lineTo(padX + x * W, baseY - val * H * 0.45); }
  ctx.stroke(); ctx.setLineDash([]);
}
function sample(s, p, t) {
  let norm = 0, E = 0; for (let n = 1; n <= 6; n++) { const w = p['w' + n] || 0; norm += w * w; E += w * w * (n * n * Math.PI * Math.PI) / 2; }
  norm = norm || 1; return { E: +(E / norm).toFixed(3), t: +t.toFixed(2) };
}
function computeStats(s, p) {
  let norm = 0, E = 0; for (let n = 1; n <= 6; n++) { const w = p['w' + n] || 0; norm += w * w; E += w * w * (n * n * Math.PI * Math.PI) / 2; }
  norm = norm || 1;
  // <x>
  let xexp = 0; for (let i = 0; i <= NX; i++) { const x = i / NX; const [re, im] = psi(s, p, x, 0); const prob = (re * re + im * im) / norm; xexp += x * prob / NX; }
  return { '⟨E⟩': (E / norm).toFixed(3), '⟨x⟩': xexp.toFixed(3), 'Norm²': norm.toFixed(3), 'L': '1 (natural)' };
}

export default function ParticleInBox() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ w1: 1, w2: 0, w3: 0, w4: 0, w5: 0, w6: 0 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, sample, computeStats, resetKey: `${params.w1}|${params.w2}|${params.w3}|${params.w4}|${params.w5}|${params.w6}` });
  return (
    <SimLayout title="Particle in a Box (Quantum)" configName="particle-in-box" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      graph={<LiveGraph data={sim.graphData} xKey="t" series={[{ key: 'E', color: '#22d3ee' }]} />}
      exportBar={<ExportBar graphData={sim.graphData} config={params} canvasRef={canvasRef} name="particle-in-box" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">ψ(x,t)=Σ cₙ√2·sin(nπx)·e^(−iEₙt), Eₙ=n²π²/2 (ℏ=m=L=1). Filled = |ψ|², orange = Re ψ, dashed = Im ψ.</div>} />
  );
}