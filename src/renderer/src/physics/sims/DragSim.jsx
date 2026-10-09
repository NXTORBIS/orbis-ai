import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';
import { ResearchHeader, AIPanel, useAIExplain, Card } from '../research.jsx';

// Drag on a falling sphere: F_drag = -b v (linear, Stokes) or -c v² (quadratic).
// Terminal velocity when mg = F_drag.
// Stokes: v_t = mg / b = (2/9) r² g (ρ_obj - ρ_fluid) / μ  (low Re)
// Quadratic: v_t = sqrt(2mg / (ρ_fluid C_d A))
const schema = [
  { key: 'mass', label: 'Mass m (g)', min: 1, max: 500, step: 1, type: 'range' },
  { key: 'b', label: 'Linear drag b (kg/s)', min: 0.001, max: 2, step: 0.001, type: 'range' },
  { key: 'c', label: 'Quadratic c (kg/m)', min: 0.0001, max: 0.5, step: 0.0001, type: 'range' },
  { key: 'g', label: 'Gravity g (m/s²)', min: 1.6, max: 24.8, step: 0.1, type: 'range' },
  { key: 'mode', label: 'Drag law', type: 'select', options: [{ value: 'linear', label: 'Linear (Stokes)' }, { value: 'quadratic', label: 'Quadratic' }, { value: 'both', label: 'Compare both' }] },
];

function makeInitial() { return { y: 0, vLin: 0, vQuad: 0, hist: [] }; }

function step(s, dt, p) {
  const m = p.mass * 1e-3;
  const g = p.g;
  // linear: dv/dt = g - (b/m) v
  s.vLin += (g - (p.b / m) * s.vLin) * dt;
  // quadratic: dv/dt = g - (c/m) v²
  s.vQuad += (g - (p.c / m) * s.vQuad * Math.abs(s.vQuad)) * dt;
  s.y += s.vLin * dt * 0.3;
  s.hist.push({ t: +dt * s.hist.length, vLin: s.vLin, vQuad: s.vQuad });
  if (s.hist.length > 200) s.hist.shift();
}

function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  // falling spheres
  const drawSphere = (x, v, color) => {
    const y = (s.y % h);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();
    // velocity arrow
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + Math.min(60, v * 5)); ctx.stroke();
  };
  const mode = p.mode;
  if (mode === 'linear' || mode === 'both') drawSphere(w * 0.3, s.vLin, '#22d3ee');
  if (mode === 'quadratic' || mode === 'both') drawSphere(w * 0.7, s.vQuad, '#f97316');
  // velocity history
  ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1;
  const baseY = h - 40;
  ctx.beginPath(); ctx.moveTo(0, baseY); ctx.lineTo(w, baseY); ctx.stroke();
  if (s.hist.length > 2) {
    ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    s.hist.forEach((pt, i) => { const x = (i / s.hist.length) * w; const y = baseY - pt.vLin * 3; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.stroke();
    ctx.strokeStyle = '#f97316';
    ctx.beginPath();
    s.hist.forEach((pt, i) => { const x = (i / s.hist.length) * w; const y = baseY - pt.vQuad * 3; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.stroke();
  }
  ctx.fillStyle = '#fff'; ctx.font = '10px monospace';
  ctx.fillText('velocity history', 4, h - 4);
}

function computeStats(s, p) {
  const m = p.mass * 1e-3;
  const vT_lin = (m * p.g) / p.b;
  const vT_quad = Math.sqrt((2 * m * p.g) / p.c);
  return {
    'v (linear)': s.vLin.toFixed(2) + ' m/s',
    'v (quadratic)': s.vQuad.toFixed(2) + ' m/s',
    'v_term (linear)': vT_lin.toFixed(2) + ' m/s',
    'v_term (quadratic)': vT_quad.toFixed(2) + ' m/s',
    'Re regime': p.b > 0.1 ? 'low Re (Stokes)' : 'high Re (quadratic)',
    'Drag law': p.mode,
  };
}

export default function DragSim() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ mass: 50, b: 0.05, c: 0.01, g: 9.81, mode: 'both' });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats, resetKey: `${params.mass}-${params.b}-${params.c}-${params.mode}` });
  const { explain, explaining, output } = useAIExplain();
  return (
    <div className="space-y-3">
      <ResearchHeader title="Drag — Linear & Quadratic" subtitle="Drag opposes motion. Linear (Stokes) drag F = bv dominates at low Re (tiny/slow in viscous fluid). Quadratic F = cv² dominates at high Re (most everyday motion). Terminal velocity when mg = F_drag." onExplain={() => explain(`Drag: m=${params.mass}g, mode=${params.mode}. ${sim.stats}`)} explaining={explaining} />
      <SimLayout title="Drag" configName="drag" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
        controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
        stats={<StatGrid stats={sim.stats} />}
        exportBar={<ExportBar graphData={sim.hist || []} config={params} canvasRef={canvasRef} name="drag" />}
        extra={<Card><p className="text-xs text-muted-foreground">Cyan = linear (Stokes) drag, orange = quadratic. Both accelerate toward their terminal velocity. Stokes drag is exact for a sphere at very low Re; quadratic drag matches everyday experience (cars, skydivers).</p></Card>} />
      <AIPanel output={output} />
    </div>
  );
}