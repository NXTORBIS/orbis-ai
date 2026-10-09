import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';
import { ResearchHeader, AIPanel, useAIExplain, Card } from '../research.jsx';
import { rk4 } from '../lib/math.js';

// Charged-particle plasma physics via the Lorentz force F = q(E + v×B).
// Modes: cyclotron motion, E×B drift, magnetic mirror, plasma oscillation.
const MODES = ['Cyclotron', 'E×B Drift', 'Magnetic Mirror', 'Plasma Oscillation'];
const schema = [
  { key: 'mode', label: 'Scenario', type: 'select', options: MODES.map((m) => ({ value: m, label: m })) },
  { key: 'B', label: 'B field (z)', min: -2, max: 2, step: 0.05, type: 'range' },
  { key: 'E', label: 'E field (x)', min: -2, max: 2, step: 0.05, type: 'range' },
  { key: 'q', label: 'Charge q', min: -2, max: 2, step: 0.1, type: 'range' },
  { key: 'v0', label: 'Initial speed', min: 0, max: 3, step: 0.1, type: 'range' },
];

function fields(x, y, p) {
  let E = [p.E, 0, 0], B = [0, 0, p.B];
  if (p.mode === 'Magnetic Mirror') { const Bz = 0.3 + 1.7 * Math.abs(x) / 4; B = [0, 0, Bz]; } // B stronger away from centre
  return { E, B };
}
function makeInitial(p) {
  const n = p.mode === 'Plasma Oscillation' ? 40 : 1;
  const s = { x: new Float64Array(n * 3), v: new Float64Array(n * 3), n, trail: [] };
  if (p.mode === 'Plasma Oscillation') { for (let i = 0; i < n; i++) { s.x[3 * i] = (i - n / 2) * 0.15; s.v[3 * i] = 0; } }
  else { s.v[0] = p.v0; s.v[1] = 0.3; }
  return s;
}
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function step(s, dt, p) {
  const { n, x, v } = s;
  for (let i = 0; i < n; i++) {
    const idx = 3 * i;
    const f = (t, y) => {
      const pos = y.slice(0, 3), vel = y.slice(3, 6);
      const { E, B } = fields(pos[0], pos[1], p);
      // plasma oscillation: each particle feels a restoring force from a uniform ion background
      let fx = p.q * (E[0] + vel[1] * B[2] - vel[2] * B[1]);
      let fy = p.q * (E[1] + vel[2] * B[0] - vel[0] * B[2]);
      let fz = p.q * (E[2] + vel[0] * B[1] - vel[1] * B[0]);
      if (p.mode === 'Plasma Oscillation') { const k = 4; fx -= k * pos[0]; }
      return [vel[0], vel[1], vel[2], fx, fy, fz];
    };
    const y = rk4(f, 0, [x[idx], x[idx + 1], x[idx + 2], v[idx], v[idx + 1], v[idx + 2]], dt);
    for (let k = 0; k < 3; k++) { x[idx + k] = y[k]; v[idx + k] = y[3 + k]; }
  }
  if (n === 1) { s.trail.push([x[0], x[1]]); if (s.trail.length > 600) s.trail.shift(); }
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h); const cx = w / 2, cy = h / 2; const sc = 40;
  // field indicators
  if (p.B) { ctx.fillStyle = 'hsl(var(--muted-foreground) / 0.3)'; ctx.font = '14px monospace'; for (let gx = 40; gx < w; gx += 60) for (let gy = 40; gy < h; gy += 60) { ctx.fillText(p.B > 0 ? '⊙' : '⊗', gx, gy); } }
  if (p.E) { ctx.strokeStyle = 'hsl(249 84% 67% / 0.4)'; for (let gx = 30; gx < w; gx += 60) { ctx.beginPath(); ctx.moveTo(gx, h / 2); ctx.lineTo(gx + p.E * 20, h / 2); ctx.stroke(); } }
  // trail
  if (s.trail.length > 1) { ctx.strokeStyle = 'hsl(var(--cyan) / 0.5)'; ctx.beginPath(); for (let i = 0; i < s.trail.length; i++) { const px = cx + s.trail[i][0] * sc, py = cy + s.trail[i][1] * sc; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.stroke(); }
  // particles
  ctx.fillStyle = '#22d3ee';
  for (let i = 0; i < s.n; i++) { ctx.beginPath(); ctx.arc(cx + s.x[3 * i] * sc, cy + s.x[3 * i + 1] * sc, 4, 0, Math.PI * 2); ctx.fill(); }
}
function computeStats(s, p) {
  if (p.mode === 'Cyclotron') { const wc = Math.abs(p.q * p.B); return { 'ω_c (cyclotron)': wc.toFixed(3), 'r_L (Larmor)': (p.v0 / Math.max(1e-6, wc)).toFixed(3), 'T (period)': (2 * Math.PI / Math.max(1e-6, wc)).toFixed(3), 'q': p.q, 'B': p.B }; }
  if (p.mode === 'E×B Drift') { const vd = p.E / Math.max(1e-6, p.B); return { 'v_E (E×B drift)': vd.toFixed(3), 'direction': 'E×B̂', 'ω_c': Math.abs(p.q * p.B).toFixed(3), 'E': p.E, 'B': p.B }; }
  if (p.mode === 'Magnetic Mirror') return { 'B(z)': '0.3 + 1.7|z|/4', 'μ (adiabatic)': 'invariant', 'Mirror ratio': 'R = B_max/B_min', 'Note': 'v⊥ grows where B grows' };
  return { 'ω_p (plasma freq)': Math.sqrt(4).toFixed(3), 'Mode': 'cold-plasma oscillation', 'Particles': s.n };
}

export default function PlasmaLab() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ mode: 'Cyclotron', B: 1, E: 0, q: 1, v0: 1 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats, resetKey: params.mode });
  const { explain, explaining, output } = useAIExplain();
  return (
    <div className="space-y-3">
      <ResearchHeader title="Plasma Physics Laboratory" subtitle="Charged particles in electromagnetic fields via the Lorentz force F = q(E + v×B). Cyclotron motion, E×B drift, magnetic mirror and plasma oscillation — integrated with RK4."
        onExplain={() => explain(`Plasma lab mode=${params.mode}: ${JSON.stringify(sim.stats)}`)} explaining={explaining} />
      <SimLayout title="Plasma Physics" configName="plasma" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
        controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
        stats={<StatGrid stats={sim.stats} />}
        exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="plasma" />}
        extra={<Card><p className="text-xs text-muted-foreground">⊙/⊗ mark the B field direction; arrows show E. Cyclotron frequency ω_c = qB/m. E×B drift is independent of charge — both species drift together.</p></Card>} />
      <AIPanel output={output} />
    </div>
  );
}