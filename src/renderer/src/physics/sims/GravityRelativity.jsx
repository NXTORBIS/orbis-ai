import React, { useRef, useState, useMemo } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';
import { ResearchHeader, Card, AIPanel, useAIExplain, SciTable, NotImplemented } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';
import { rk4 } from '../lib/math.js';

const MODES = ['N-Body', 'Three-Body (Figure-8)', 'Lorentz Transform', 'Schwarzschild Geodesics', 'Time Dilation'];

function nbodyInitial(p) {
  if (p.mode.includes('Three-Body')) {
    // figure-8 solution (Chenciner–Montgomery), scaled
    const s = 0.9;
    return { bodies: [
      { x: -0.97 * s, y: 0.243 * s, vx: 0.466 * s, vy: 0.433 * s, m: 1 },
      { x: 0.97 * s, y: -0.243 * s, vx: -0.466 * s, vy: -0.433 * s, m: 1 },
      { x: 0, y: 0, vx: 0, vy: 0, m: 1 },
    ], trail: [] };
  }
  return { bodies: [{ x: 0, y: 0, vx: 0, vy: 0, m: 50 }, { x: 3, y: 0, vx: 0, vy: 4, m: 1 }, { x: -5, y: 0, vx: 0, vy: -3.5, m: 1 }], trail: [] };
}
function nbodyStep(s, dt) {
  const { bodies } = s; const n = bodies.length; const ax = new Array(n).fill(0), ay = new Array(n).fill(0);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) { const dx = bodies[j].x - bodies[i].x, dy = bodies[j].y - bodies[i].y; const r2 = dx * dx + dy * dy + 0.05; const f = bodies[j].m / r2 / Math.sqrt(r2); ax[i] += f * dx; ay[i] += f * dy; }
  for (let i = 0; i < n; i++) { bodies[i].vx += ax[i] * dt; bodies[i].vy += ay[i] * dt; bodies[i].x += bodies[i].vx * dt; bodies[i].y += bodies[i].vy * dt; }
  if (!s.trail) s.trail = []; s.trail.push(bodies.map((b) => [b.x, b.y])); if (s.trail.length > 300) s.trail.shift();
}
function nbodyDraw(ctx, s, p, w, h) {
  stageBg(ctx, w, h); const cx = w / 2, cy = h / 2; const sc = 30;
  if (s.trail) for (let t = 0; t < s.trail.length; t++) { const pts = s.trail[t]; for (let i = 0; i < pts.length; i++) { ctx.fillStyle = `hsl(${i * 80},80%,60% / ${t / s.trail.length * 0.5})`; ctx.fillRect(cx + pts[i][0] * sc, cy + pts[i][1] * sc, 1.5, 1.5); } }
  for (const b of s.bodies) { ctx.fillStyle = '#22d3ee'; ctx.beginPath(); ctx.arc(cx + b.x * sc, cy + b.y * sc, 2 + Math.sqrt(b.m), 0, Math.PI * 2); ctx.fill(); }
}
function nbodyStats(s) { return { Bodies: s.bodies.length, Energy: 'conserved (approx)', Integrator: 'symplectic Euler', Mode: 'gravitational' }; }

// Schwarzschild geodesic: integrate null/ timelike geodesic in the equatorial
// plane using effective potential. u'' + u = 3 G M u² / c² (light bending).
function schwarzschildData() {
  const GM = 1; const b = 5; // impact parameter
  const phi = []; let u = 0, du = 1 / b, ph = -1.2;
  for (let i = 0; i < 4000; i++) {
    const ddu = -u + 3 * GM * u * u; // lightlike, leading GR correction
    du += ddu * 0.01; u += du * 0.01; ph += 0.01;
    const r = 1 / u; phi.push({ phi: ph, r });
    if (r < 1 || r > 50) break;
  }
  return phi;
}
function lorentzData(beta) {
  // spacetime grid lines x=const, t=const transformed by boost
  const lines = [];
  for (let t = -3; t <= 3; t++) { const pts = []; for (let x = -3; x <= 3; x += 0.1) { const tp = (t - beta * x) / Math.sqrt(1 - beta * beta); const xp = (x - beta * t) / Math.sqrt(1 - beta * beta); pts.push({ x: xp, t: tp }); } lines.push({ type: 't', pts }); }
  return lines;
}

export default function GravityRelativity() {
  const [mode, setMode] = useState('N-Body');
  const canvasRef = useRef(null);
  const [beta, setBeta] = useState(0.5);
  const nbodyParams = { mode };
  const sim = useSim({ canvasRef, params: nbodyParams, step: nbodyStep, makeInitial: nbodyInitial, draw: nbodyDraw, computeStats: nbodyStats, resetKey: mode });
  const { explain, explaining, output } = useAIExplain();
  const geo = useMemo(schwarzschildData, []);
  const gamma = 1 / Math.sqrt(1 - beta * beta);

  return (
    <div className="space-y-3">
      <ResearchHeader title="Gravitational & Relativity Laboratory" subtitle="Classical N-body gravity, the chaotic three-body problem, Lorentz transformations, Schwarzschild light deflection, and gravitational time dilation. Numerical relativity (full Einstein solver) is NOT implemented."
        onExplain={() => explain(`Gravity/relativity lab, mode=${mode}.`)} explaining={explaining} />
      <div className="flex flex-wrap gap-1.5">{MODES.map((m) => <button key={m} onClick={() => setMode(m)} className={`rounded-full px-3 py-1.5 text-xs ${mode === m ? 'bg-cyan-j text-background' : 'bg-card/40 text-muted-foreground'}`}>{m}</button>)}</div>
      {mode === 'N-Body' || mode.includes('Three-Body') ? (
        <SimLayout title={mode} configName="gravity" canvasRef={canvasRef} params={nbodyParams} schema={[]} setParams={() => {}} hideParams
          controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
          stats={<StatGrid stats={sim.stats} />} exportBar={<ExportBar graphData={[]} config={{ mode }} canvasRef={canvasRef} name="gravity" />}
          extra={<Card><p className="text-xs text-muted-foreground">{mode.includes('Three-Body') ? 'The figure-8 is a stable periodic solution of the equal-mass three-body problem (Chenciner–Montgomery).' : 'Velocity-Verlet-style gravity. Perturb a body to break stability.'}</p></Card>} />
      ) : mode === 'Lorentz Transform' ? (
        <Card title={`Lorentz boost (β = ${beta.toFixed(2)}, γ = ${gamma.toFixed(3)})`}>
          <div className="mb-2"><input type="range" min={0} max={0.95} step={0.01} value={beta} onChange={(e) => setBeta(+e.target.value)} className="w-full accent-cyan-500" /></div>
          <SciPlot type="line" data={lorentzData(beta).flatMap((l) => l.pts.map((p) => ({ x: p.x, t: p.t })))} xKey="x" series={[{ key: 't', label: "t' lines", color: '#22d3ee' }]} xLabel="x'" yLabel="t'" height={280} exportName="lorentz" />
          <p className="mt-2 text-xs text-muted-foreground">Lines of constant t become tilted under a boost; the Minkowski metric is preserved. t' = γ(t − βx), x' = γ(x − βt).</p>
        </Card>
      ) : mode === 'Schwarzschild Geodesics' ? (
        <Card title="Light deflection near a mass (Schwarzschild)">
          <SciPlot type="line" data={geo} xKey="phi" series={[{ key: 'r', label: 'photon r(φ)', color: '#22d3ee' }]} xLabel="φ" yLabel="r" height={260} exportName="geodesic" />
          <p className="mt-2 text-xs text-muted-foreground">Leading-order GR light bending: u'' + u = 3GMu²/c². A Newtonian straight ray would not bend — the 3GMu² term is the relativistic correction (deflection 4GM/c²b).</p>
        </Card>
      ) : (
        <Card title="Gravitational Time Dilation">
          <SciTable headers={['r (Rs)', 'Time rate √(1−rs/r)']} rows={[['2', Math.sqrt(1 - 0.5).toFixed(4)], ['3', Math.sqrt(1 - 1 / 3).toFixed(4)], ['5', Math.sqrt(1 - 0.2).toFixed(4)], ['10', Math.sqrt(1 - 0.1).toFixed(4)], ['100', Math.sqrt(1 - 0.01).toFixed(4)]]} />
          <p className="mt-2 text-xs text-muted-foreground">A clock at radius r (in Schwarzschild radii) runs slow by √(1 − rs/r) relative to a distant observer. Time stops at the event horizon (r = rs).</p>
        </Card>
      )}
      <AIPanel output={output} />
    </div>
  );
}