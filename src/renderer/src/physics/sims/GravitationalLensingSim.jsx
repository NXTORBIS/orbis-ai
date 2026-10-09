import React, { useState, useMemo, useRef } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';
import { ResearchHeader, Card, AIPanel, useAIExplain, SciTable, NumField } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';

const schema = [
  { key: 'M', label: 'Lens mass (M☉)', min: 1, max: 1000, step: 10, type: 'range' },
  { key: 'b', label: 'Impact parameter b', min: 20, max: 150, step: 5, type: 'range' },
];

function makeInitial(p) {
  return { x: 300, y: p.b, vx: -3, vy: 0, trail: [] };
}

function step(s, dt, p) {
  const r = Math.sqrt(s.x * s.x + s.y * s.y);
  if (r < 5) return;
  // GR light deflection: a = -2GM/r² * (1 + ...) leading order 4GM/c²b
  const GM = p.M * 0.0015; // scaled
  const r2 = r * r;
  const r3 = r2 * r;
  const factor = -(2 * GM) / r2 - (3 * GM * p.b * p.b) / (r2 * r2);
  s.vx += factor * s.x * dt;
  s.vy += factor * s.y * dt;
  s.x += s.vx * dt;
  s.y += s.vy * dt;
  s.trail.push([s.x, s.y]);
  if (s.trail.length > 500) s.trail.shift();
}

function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const cx = w / 2, cy = h / 2;
  // lens (mass)
  ctx.fillStyle = '#f97316';
  ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();
  // Einstein ring
  const GM = p.M * 0.0015;
  const thetaE = Math.sqrt(4 * GM * 100); // Einstein radius (scaled)
  ctx.strokeStyle = '#22d3ee55'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, thetaE, 0, Math.PI * 2); ctx.stroke();
  // source (undeflected path)
  ctx.strokeStyle = '#ffffff22'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(cx + 300, cy + p.b); ctx.lineTo(cx - 300, cy + p.b); ctx.stroke();
  ctx.setLineDash([]);
  // deflected light ray
  ctx.strokeStyle = '#fde047'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < s.trail.length; i++) {
    const x = cx + s.trail[i][0], y = cy + s.trail[i][1];
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  // photon
  ctx.fillStyle = '#fde047';
  ctx.beginPath(); ctx.arc(cx + s.x, cy + s.y, 3, 0, Math.PI * 2); ctx.fill();
}

function computeStats(s, p) {
  const GM = p.M * 0.0015;
  const thetaE = Math.sqrt(4 * GM * 100);
  const deflection = 4 * GM / p.b;
  return { 'M': p.M + ' M☉', 'b': p.b, 'θ_E': thetaE.toFixed(1), 'α': deflection.toFixed(4) + ' rad' };
}

export default function GravitationalLensingSim() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ M: 100, b: 50 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats, resetKey: `${params.M}|${params.b}` });
  const { explain, explaining, output } = useAIExplain();

  const magnificationData = useMemo(() => {
    const out = [];
    const GM = params.M * 0.0015;
    const thetaE = Math.sqrt(4 * GM * 100);
    for (let u = 0.01; u <= 3; u += 0.02) {
      const mu = (u * u + 2) / (u * Math.sqrt(u * u + 4));
      out.push({ u: +u.toFixed(2), mu: +mu.toFixed(3) });
    }
    return out;
  }, [params.M]);

  return (
    <div className="space-y-3">
      <ResearchHeader title="Gravitational Lensing" subtitle="Light deflection by a massive object. The Einstein ring (cyan) forms when source, lens, and observer are aligned. Magnification μ = (u²+2)/(u√(u²+4))."
        onExplain={() => explain(`Lensing: M=${params.M} M☉, b=${params.b}. Einstein radius θ_E=${sim.stats['θ_E']}, deflection α=${sim.stats['α']}. When u→0, magnification diverges (Einstein ring).`)} explaining={explaining} />
      <SimLayout title="Light Deflection" configName="lensing" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
        controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
        stats={<StatGrid stats={sim.stats} />}
        graph={<SciPlot type="line" data={magnificationData} xKey="u" series={[{ key: 'mu', label: 'μ', color: '#22d3ee' }]} xLabel="u (θ/θ_E)" yLabel="magnification μ" height={160} exportName="lensing-mag" />}
        exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="lensing" />} />
      <AIPanel output={output} />
    </div>
  );
}