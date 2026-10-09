import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';
import { ResearchHeader, AIPanel, useAIExplain, Card } from '../research.jsx';

// 2D potential-flow velocity field: superposition of sources, sinks & vortices.
// User places singularities on the canvas; streamlines are integrated with RK2.
const schema = [
  { key: 'sourceStrength', label: 'Source strength', min: -3, max: 3, step: 0.1, type: 'range' },
  { key: 'vortexStrength', label: 'Vortex strength', min: -3, max: 3, step: 0.1, type: 'range' },
  { key: 'uniformFlow', label: 'Uniform flow U', min: 0, max: 2, step: 0.05, type: 'range' },
  { key: 'density', label: 'Streamline count', min: 20, max: 120, step: 5, type: 'range' },
];

function makeInitial(p) {
  return { sources: [{ x: -0.3, y: 0, q: p.sourceStrength }, { x: 0.3, y: 0, q: -p.sourceStrength }],
           vortices: [{ x: 0, y: 0.2, gamma: p.vortexStrength }] };
}

function velocity(x, y, state, p) {
  let u = p.uniformFlow, v = 0;
  for (const s of state.sources) {
    const dx = x - s.x, dy = y - s.y, r2 = dx * dx + dy * dy + 0.001;
    u += (s.q * dx) / (2 * Math.PI * r2);
    v += (s.q * dy) / (2 * Math.PI * r2);
  }
  for (const vt of state.vortices) {
    const dx = x - vt.x, dy = y - vt.y, r2 = dx * dx + dy * dy + 0.001;
    u -= (vt.gamma * dy) / (2 * Math.PI * r2);
    v += (vt.gamma * dx) / (2 * Math.PI * r2);
  }
  return [u, v];
}

function step(s) {} // static field — no time evolution needed

function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const scale = Math.min(w, h) * 0.42, cx = w / 2, cy = h / 2;
  const toScreen = (x, y) => [cx + x * scale, cy - y * scale];
  // integrate streamlines via RK2
  const n = Math.floor(p.density);
  for (let k = 0; k < n; k++) {
    const ang = (k / n) * 2 * Math.PI;
    let x = 1.6 * Math.cos(ang), y = 1.6 * Math.sin(ang);
    ctx.beginPath();
    const [sx0, sy0] = toScreen(x, y);
    ctx.moveTo(sx0, sy0);
    for (let i = 0; i < 300; i++) {
      const [u1, v1] = velocity(x, y, s, p);
      const xm = x + 0.01 * u1, ym = y + 0.01 * v1;
      const [u2, v2] = velocity(xm, ym, s, p);
      const dx = 0.01 * 0.5 * (u1 + u2), dy = 0.01 * 0.5 * (v1 + v2);
      x += dx; y += dy;
      if (Math.abs(x) > 2 || Math.abs(y) > 2) break;
      const [px, py] = toScreen(x, y);
      ctx.lineTo(px, py);
    }
    const speed = Math.hypot(...velocity(x, y, s, p));
    ctx.strokeStyle = `hsla(${190 - speed * 40}, 80%, 60%, 0.6)`;
    ctx.lineWidth = 1; ctx.stroke();
  }
  // draw singularities
  for (const src of s.sources) {
    const [px, py] = toScreen(src.x, src.y);
    ctx.fillStyle = src.q > 0 ? '#22d3ee' : '#f97316';
    ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill();
  }
  for (const vt of s.vortices) {
    const [px, py] = toScreen(vt.x, vt.y);
    ctx.fillStyle = '#a855f7'; ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill();
  }
}

function computeStats(s, p) {
  const [u, v] = velocity(0, 0, s, p);
  return { 'Field type': 'Potential flow', 'Sources': s.sources.length, 'Vortices': s.vortices.length, 'U∞': p.uniformFlow.toFixed(2), '|v| at origin': Math.hypot(u, v).toFixed(3), 'Streamlines': Math.floor(p.density) };
}

export default function FluidFlowSim() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ sourceStrength: 1.5, vortexStrength: 1, uniformFlow: 0.5, density: 60 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats, resetKey: `${params.sourceStrength}-${params.vortexStrength}` });
  const { explain, explaining, output } = useAIExplain();
  return (
    <div className="space-y-3">
      <ResearchHeader title="Fluid Flow — 2D Velocity Field" subtitle="Potential-flow superposition of sources (cyan), sinks (orange) and vortices (purple). Streamlines integrated with RK2 from the boundary." onExplain={() => explain(`Fluid flow: ${sim.stats}`)} explaining={explaining} />
      <SimLayout title="Fluid Flow" configName="fluid-flow" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
        controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
        stats={<StatGrid stats={sim.stats} />}
        exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="fluid-flow" />}
        extra={<Card><p className="text-xs text-muted-foreground">Cyan = source, orange = sink, purple = vortex. Streamline colour reflects local speed (blue→hot). This is inviscid, irrotational potential flow — valid far from boundaries.</p></Card>} />
      <AIPanel output={output} />
    </div>
  );
}