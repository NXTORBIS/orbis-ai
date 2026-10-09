// Wavefunction Visualizer — shows Re(ψ), Im(ψ), |ψ|², and the phase
// arg(ψ) as a colour wheel, for a superposition of particle-in-a-box states.
// The phase colour helps visualise the complex nature of the wavefunction.
import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

const NX = 200;
const schema = [
  { key: 'w1', label: 'n=1 weight', min: 0, max: 1, step: 0.05, type: 'range' },
  { key: 'w2', label: 'n=2 weight', min: 0, max: 1, step: 0.05, type: 'range' },
  { key: 'w3', label: 'n=3 weight', min: 0, max: 1, step: 0.05, type: 'range' },
  { key: 'showPhase', label: 'Phase colour wheel', type: 'toggle' },
];

function makeInitial() { return {}; }
function step() {}
function psi(p, x, t) { let re = 0, im = 0; for (let n = 1; n <= 3; n++) { const w = p['w' + n]; if (!w) continue; const En = (n * n * Math.PI * Math.PI) / 2; const phi = Math.sqrt(2) * Math.sin(n * Math.PI * x); const ph = -En * t; re += w * phi * Math.cos(ph); im += w * phi * Math.sin(ph); } return [re, im]; }
function hslPhase(angle) { const hue = (angle * 180 / Math.PI + 360) % 360; return `hsl(${hue} 90% 60%)`; }
function draw(ctx, s, p, w, h, t) {
  stageBg(ctx, w, h);
  const padX = 40, padY = 30; const W = w - 2 * padX, H = h - 2 * padY; const baseY = padY + H;
  ctx.strokeStyle = 'hsl(var(--muted-foreground))'; ctx.lineWidth = 2; ctx.strokeRect(padX, padY, W, H);
  let norm = 0; for (let n = 1; n <= 3; n++) { const ww = p['w' + n] || 0; norm += ww * ww; } norm = Math.sqrt(norm) || 1;
  // phase colour strip
  if (p.showPhase) { for (let i = 0; i < NX; i++) { const x = i / NX; const [re, im] = psi(p, x, t); const phase = Math.atan2(im, re); ctx.fillStyle = hslPhase(phase); ctx.fillRect(padX + x * W, padY, W / NX + 1, 6); } }
  // |psi|^2
  ctx.fillStyle = '#22d3ee44'; ctx.beginPath(); ctx.moveTo(padX, baseY);
  for (let i = 0; i <= NX; i++) { const x = i / NX; const [re, im] = psi(p, x, t); const prob = (re * re + im * im) / (norm * norm); ctx.lineTo(padX + x * W, baseY - prob * H * 0.85); } ctx.lineTo(padX + W, baseY); ctx.closePath(); ctx.fill();
  // Re
  ctx.strokeStyle = '#f97316'; ctx.lineWidth = 2; ctx.beginPath();
  for (let i = 0; i <= NX; i++) { const x = i / NX; const [re] = psi(p, x, t); ctx.lineTo(padX + x * W, baseY - (re / norm) * H * 0.42); } ctx.stroke();
  // Im
  ctx.strokeStyle = '#a855f7'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5; ctx.beginPath();
  for (let i = 0; i <= NX; i++) { const x = i / NX; const [, im] = psi(p, x, t); ctx.lineTo(padX + x * W, baseY - (im / norm) * H * 0.42); } ctx.stroke(); ctx.setLineDash([]);
  // legend
  ctx.fillStyle = '#f97316'; ctx.font = '10px monospace'; ctx.fillText('Re(ψ)', padX + W - 80, padY + 20);
  ctx.fillStyle = '#a855f7'; ctx.fillText('Im(ψ)', padX + W - 40, padY + 20);
  ctx.fillStyle = '#22d3ee'; ctx.fillText('|ψ|²', padX + 4, padY + 20);
}
function computeStats(s, p) { let norm = 0; for (let n = 1; n <= 3; n++) { const ww = p['w' + n] || 0; norm += ww * ww; } norm = Math.sqrt(norm) || 1; let E = 0; for (let n = 1; n <= 3; n++) { const ww = p['w' + n] || 0; E += ww * ww * (n * n * Math.PI * Math.PI) / 2; } return { '⟨E⟩': (E / (norm * norm)).toFixed(3), 'Norm': norm.toFixed(3), 'States': 'n=1,2,3', 'Phase': p.showPhase ? 'colour wheel' : 'off' }; }

export default function WavefunctionViz() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ w1: 0.7, w2: 0.7, w3: 0, showPhase: true });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats, resetKey: `${params.w1}|${params.w2}|${params.w3}|${params.showPhase}` });
  return (
    <SimLayout title="Wavefunction Visualizer (Re/Im/|ψ|²/Phase)" configName="wavefunction-viz" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="wavefunction-viz" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">The wavefunction is complex-valued. Orange = Re(ψ), dashed purple = Im(ψ), cyan fill = |ψ|². The top strip shows the phase arg(ψ) as a colour wheel — each hue is a phase angle. Watch Re and Im oscillate into each other as the state evolves.</div>} />
  );
}