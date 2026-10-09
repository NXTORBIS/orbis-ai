// Quantum Harmonic Oscillator — analytical eigenfunctions of the 1D QHO.
// Shows evenly-spaced energy levels Eₙ = (n+½)ℏω, zero-point energy ½ℏω,
// and the Hermite–Gaussian eigenfunctions ψₙ(x) = Nₙ Hₙ(ξ) e^(−ξ²/2).
import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

const NX = 200;
const schema = [
  { key: 'n', label: 'Quantum number n', min: 0, max: 8, step: 1, type: 'range' },
  { key: 'omega', label: 'Frequency ω', min: 1, max: 10, step: 0.5, type: 'range' },
  { key: 'showLevels', label: 'Show level ladder', type: 'toggle' },
];

function hermite(n, x) { if (n === 0) return 1; if (n === 1) return 2 * x; let h0 = 1, h1 = 2 * x, hn = 0; for (let k = 2; k <= n; k++) { hn = 2 * x * h1 - 2 * (k - 1) * h0; h0 = h1; h1 = hn; } return hn; }
function factorial(n) { let f = 1; for (let i = 2; i <= n; i++) f *= i; return f; }
function makeInitial() { return {}; }
function step() {}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const padX = 40, padY = 24; const W = w - 2 * padX, H = h - 2 * padY; const baseY = padY + H;
  const Emax = 9.5 * p.omega; const Y = (E) => baseY - (E / Emax) * H * 0.85;
  // parabolic potential
  ctx.strokeStyle = 'hsl(var(--muted-foreground) / 0.6)'; ctx.lineWidth = 1.5; ctx.beginPath();
  for (let i = 0; i <= NX; i++) { const x = i / NX; const dx = (x - 0.5) * 6; const V = 0.5 * p.omega * p.omega * dx * dx * 0.05; ctx.lineTo(padX + x * W, Y(V)); } ctx.stroke();
  // level ladder
  if (p.showLevels) { for (let n = 0; n <= 8; n++) { const En = (n + 0.5) * p.omega; const y = Y(En); ctx.strokeStyle = n === p.n ? '#22d3ee' : 'hsl(var(--muted-foreground) / 0.25)'; ctx.lineWidth = n === p.n ? 2 : 1; ctx.setLineDash(n === p.n ? [] : [3, 3]); ctx.beginPath(); ctx.moveTo(padX + W * 0.15, y); ctx.lineTo(padX + W * 0.85, y); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = n === p.n ? '#22d3ee' : 'hsl(var(--muted-foreground))'; ctx.font = '9px monospace'; ctx.fillText(`E=${En.toFixed(1)}`, padX + W * 0.86, y + 3); } }
  // eigenfunction
  const n = p.n; const En = (n + 0.5) * p.omega; const yE = Y(En); const norm = 1 / Math.sqrt(Math.sqrt(Math.PI) * (2 ** n) * factorial(n));
  ctx.strokeStyle = '#f97316'; ctx.lineWidth = 2; ctx.beginPath();
  for (let i = 0; i <= NX; i++) { const x = i / NX; const xi = (x - 0.5) * 5; const psi = norm * hermite(n, xi) * Math.exp(-xi * xi / 2); ctx.lineTo(padX + x * W, yE - psi * H * 0.06); } ctx.stroke();
  // |psi|^2
  ctx.fillStyle = '#22d3ee33'; ctx.beginPath(); ctx.moveTo(padX + W * 0.15, yE);
  for (let i = 0; i <= NX; i++) { const x = i / NX; const xi = (x - 0.5) * 5; const psi = norm * hermite(n, xi) * Math.exp(-xi * xi / 2); ctx.lineTo(padX + x * W, yE - psi * psi * H * 0.04); } ctx.lineTo(padX + W * 0.85, yE); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'hsl(var(--muted-foreground))'; ctx.font = '10px monospace'; ctx.fillText('x →', padX + W - 20, baseY + 14);
}
function computeStats(s, p) { const En = (p.n + 0.5) * p.omega; return { 'n': p.n, 'E_n': En.toFixed(3), 'E₀ (ZPE)': (0.5 * p.omega).toFixed(3), 'Spacing': p.omega.toFixed(2), 'ω': p.omega.toFixed(2) }; }

export default function QuantumHO() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ n: 0, omega: 3, showLevels: true });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats, resetKey: `${params.n}|${params.omega}|${params.showLevels}` });
  return (
    <SimLayout title="Quantum Harmonic Oscillator" configName="quantum-ho" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="quantum-ho" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Eₙ = (n+½)ℏω — evenly spaced, with zero-point energy ½ℏω (n=0). Eigenfunctions are Hermite–Gaussians Hₙ(ξ)e^(−ξ²/2). The parabola is V(x)=½mω²x². No zero-energy state exists.</div>} />
  );
}