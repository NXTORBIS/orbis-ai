// Finite Potential Well — solves the transcendental equations for bound
// states of a square well of depth V₀ and width a. Shows the even/odd parity
// solutions, wavefunction leakage into the classically forbidden region,
// and the number of supported bound states.
import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

const NX = 300;
const schema = [
  { key: 'V0', label: 'Well depth V₀', min: 10, max: 200, step: 5, type: 'range' },
  { key: 'width', label: 'Well width a', min: 0.1, max: 0.6, step: 0.02, type: 'range' },
  { key: 'stateIdx', label: 'Bound state index', min: 0, max: 5, step: 1, type: 'range' },
];

// Solve for bound state energies of a finite square well.
// Even: k tan(ka) = κ; Odd: −k cot(ka) = κ; where k² + κ² = 2mV₀/ℏ² (m=ℏ=1)
function findBoundStates(V0, a) {
  const kmax = Math.sqrt(2 * V0); const states = [];
  // even states: k tan(ka) = sqrt(kmax² - k²)
  for (let i = 0; i < 60; i++) {
    const ka = (i + 0.5) * Math.PI / 2 + 0.001; const k = ka / a;
    if (k > kmax) break;
    const lhs = k * Math.tan(ka); const rhs = Math.sqrt(kmax * kmax - k * k);
    // check sign crossing via bisection on ka
  }
  // Bisection approach: scan ka in (0, kmax*a)
  const kaMax = kmax * a;
  const evenRoots = []; const oddRoots = [];
  const fEven = (ka) => { const k = ka / a; if (k >= kmax) return 0; return k * Math.tan(ka) - Math.sqrt(kmax * kmax - k * k); };
  const fOdd = (ka) => { const k = ka / a; if (k >= kmax) return 0; return -k / Math.tan(ka) - Math.sqrt(kmax * kmax - k * k); };
  const scan = (f, roots, lo, hi, n) => {
    let prev = f(lo); for (let i = 1; i <= n; i++) { const x = lo + (hi - lo) * i / n; const v = f(x); if (prev * v < 0 && Math.abs(prev) < 1e6 && Math.abs(v) < 1e6) { // bisect
      let a1 = x - (hi - lo) / n, b1 = x; for (let b = 0; b < 40; b++) { const m = (a1 + b1) / 2; const fm = f(m); if (prev * fm < 0) b1 = m; else { a1 = m; prev = fm; } } roots.push((a1 + b1) / 2);
    } prev = v; }
  };
  scan(fEven, evenRoots, 0.01, Math.min(kaMax, Math.PI / 2 - 0.01), 200);
  scan(fOdd, oddRoots, 0.01, Math.min(kaMax, Math.PI - 0.01), 200);
  // merge and sort
  const all = []; for (const ka of evenRoots) { const k = ka / a; const E = -0.5 * (kmax * kmax - k * k); all.push({ E, ka, parity: 'even' }); }
  for (const ka of oddRoots) { const k = ka / a; const E = -0.5 * (kmax * kmax - k * k); all.push({ E, ka, parity: 'odd' }); }
  all.sort((a, b) => b.E - a.E); return all;
}
function makeInitial() { return {}; }
function step() {}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const padX = 40, padY = 24; const W = w - 2 * padX, H = h - 2 * padY; const baseY = padY + H;
  const states = findBoundStates(p.V0, p.width);
  const Vmax = p.V0 * 1.2;
  const Y = (E) => baseY - ((E + Vmax) / Vmax) * H * 0.85;
  // well
  const cx = 0.5; const halfW = p.width / 2;
  ctx.strokeStyle = 'hsl(var(--muted-foreground))'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(padX, Y(-p.V0)); ctx.lineTo(padX + (cx - halfW) * W, Y(-p.V0)); ctx.lineTo(padX + (cx - halfW) * W, Y(0)); ctx.lineTo(padX + (cx + halfW) * W, Y(0)); ctx.lineTo(padX + (cx + halfW) * W, Y(-p.V0)); ctx.lineTo(padX + W, Y(-p.V0)); ctx.stroke();
  // energy levels
  for (let i = 0; i < states.length; i++) {
    const y = Y(states[i].E); ctx.strokeStyle = i === p.stateIdx ? '#22d3ee' : 'hsl(var(--muted-foreground) / 0.4)'; ctx.lineWidth = i === p.stateIdx ? 2 : 1; ctx.setLineDash(i === p.stateIdx ? [] : [3, 3]);
    ctx.beginPath(); ctx.moveTo(padX, y); ctx.lineTo(padX + W, y); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = i === p.stateIdx ? '#22d3ee' : 'hsl(var(--muted-foreground))'; ctx.font = '9px monospace'; ctx.fillText(`E=${states[i].E.toFixed(2)}`, padX + W + 2, y + 3);
  }
  // selected wavefunction
  if (states[p.stateIdx]) {
    const st = states[p.stateIdx]; const k = st.ka / p.width; const kappa = Math.sqrt(2 * p.V0 - k * k); const yE = Y(st.E);
    ctx.strokeStyle = '#f97316'; ctx.lineWidth = 2; ctx.beginPath();
    for (let i = 0; i <= NX; i++) { const x = i / NX; let psi; const dx = x - cx;
      if (Math.abs(dx) < halfW) { psi = st.parity === 'even' ? Math.cos(k * dx) : Math.sin(k * dx); }
      else { const sgn = dx > 0 ? 1 : (st.parity === 'even' ? 1 : -1); psi = sgn * Math.exp(-kappa * (Math.abs(dx) - halfW)); }
      ctx.lineTo(padX + x * W, yE - psi * H * 0.1);
    } ctx.stroke();
  }
  ctx.fillStyle = 'hsl(var(--muted-foreground))'; ctx.font = '10px monospace'; ctx.fillText('x →', padX + W - 20, baseY + 14);
}
function computeStats(s, p) { const states = findBoundStates(p.V0, p.width); const st = states[p.stateIdx]; return { 'Bound states': states.length, 'Selected E': st ? st.E.toFixed(3) : 'none', 'Parity': st ? st.parity : '-', 'V₀': p.V0.toFixed(1), 'a': p.width.toFixed(2) }; }

export default function FiniteWell() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ V0: 80, width: 0.3, stateIdx: 0 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats, resetKey: `${params.V0}|${params.width}|${params.stateIdx}` });
  return (
    <SimLayout title="Finite Potential Well (Bound States)" configName="finite-well" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="finite-well" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Bound states solved from the transcendental equations k·tan(ka)=κ (even) and −k·cot(ka)=κ (odd). The wavefunction leaks into the walls (exponential decay). Fewer states than the infinite well.</div>} />
  );
}