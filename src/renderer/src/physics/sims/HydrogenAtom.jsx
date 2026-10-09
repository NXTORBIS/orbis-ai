// Hydrogen Atom — Coulomb potential energy levels Eₙ = −13.6/n² eV and
// radial wavefunctions Rₙₗ(r). Shows the Balmer series transitions and the
// iconic 1s, 2s, 2p orbital radial profiles.
import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

const NR = 200;
const schema = [
  { key: 'n', label: 'Principal quantum number n', min: 1, max: 4, step: 1, type: 'range' },
  { key: 'l', label: 'Orbital angular momentum l', min: 0, max: 3, step: 1, type: 'range' },
  { key: 'showSpectrum', label: 'Show Balmer series', type: 'toggle' },
];

function factorial(n) { let f = 1; for (let i = 2; i <= n; i++) f *= i; return f; }
function laguerre(n, l, x) { const a = 2 * l + 1; let L = 0; for (let k = 0; k <= n - l - 1; k++) { L += (k % 2 ? -1 : 1) * factorial(n + l) * Math.pow(x, k) / (factorial(k) * factorial(n - l - 1 - k) * factorial(a + k)); } return L; }
function radial(n, l, r) { // R_nl(r) in atomic units, r in units of a₀
  const rho = 2 * r / n; const norm = Math.sqrt(4 * factorial(n - l - 1) / (n * n * n * factorial(n + l) * 2)) * Math.pow(2 / n, 1.5);
  return norm * Math.exp(-r / n) * Math.pow(rho, l) * laguerre(n, l, rho);
}
function makeInitial() { return {}; }
function step() {}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const padX = 40, padY = 24; const W = w - 2 * padX, H = h - 2 * padY; const baseY = padY + H;
  const l = Math.min(p.l, p.n - 1);
  // radial wavefunction
  let maxR = 0; const vals = []; for (let i = 0; i <= NR; i++) { const r = (i / NR) * 20; const R = radial(p.n, l, r); vals.push(R); maxR = Math.max(maxR, Math.abs(R)); } maxR = Math.max(maxR, 1e-9);
  ctx.strokeStyle = '#f97316'; ctx.lineWidth = 2; ctx.beginPath();
  for (let i = 0; i <= NR; i++) { const r = (i / NR) * 20; const x = padX + (i / NR) * W; const y = baseY - (vals[i] / maxR) * H * 0.4; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.stroke();
  // |R|^2 * r^2 (radial probability)
  ctx.fillStyle = '#22d3ee44'; ctx.beginPath(); ctx.moveTo(padX, baseY);
  for (let i = 0; i <= NR; i++) { const r = (i / NR) * 20; const x = padX + (i / NR) * W; const prob = (vals[i] * vals[i]) * r * r / (maxR * maxR); ctx.lineTo(x, baseY - prob * H * 0.5); } ctx.lineTo(padX + W, baseY); ctx.closePath(); ctx.fill();
  // Balmer spectrum
  if (p.showSpectrum) {
    const sY = padY + 10; ctx.fillStyle = 'hsl(var(--muted-foreground))'; ctx.font = '9px monospace'; ctx.fillText('Balmer series:', padX, sY);
    for (let m = 3; m <= 6; m++) { const En = -13.6 / (m * m); const E2 = -13.6 / 4; const dE = E2 - En; const lambda = 1240 / dE; const sx = padX + W * 0.5 + (m - 3) * W * 0.1; ctx.fillStyle = `hsl(${200 + m * 20} 90% 60%)`; ctx.fillRect(sx, sY + 8, 6, 20); ctx.fillStyle = 'hsl(var(--muted-foreground))'; ctx.fillText(`${lambda.toFixed(0)}nm`, sx - 8, sY + 38); }
  }
  ctx.fillStyle = 'hsl(var(--muted-foreground))'; ctx.font = '10px monospace'; ctx.fillText('r (a₀) →', padX + W - 40, baseY + 14);
}
function computeStats(s, p) { const l = Math.min(p.l, p.n - 1); const En = -13.6 / (p.n * p.n); return { 'n': p.n, 'l': l, 'E_n (eV)': En.toFixed(3), 'Orbital': `${p.n}${['s', 'p', 'd', 'f'][l]}`, 'Degeneracy': p.n * p.n }; }

export default function HydrogenAtom() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ n: 1, l: 0, showSpectrum: true });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats, resetKey: `${params.n}|${params.l}|${params.showSpectrum}` });
  return (
    <SimLayout title="Hydrogen Atom (Coulomb Spectrum)" configName="hydrogen-atom" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="hydrogen-atom" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Eₙ = −13.6/n² eV — the Coulomb spectrum. Radial wavefunctions Rₙₗ(r) are associated Laguerre polynomials. The Balmer series (n→2 transitions) gives visible spectral lines. Each n has n² degeneracy.</div>} />
  );
}