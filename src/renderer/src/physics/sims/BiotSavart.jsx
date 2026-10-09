import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, LiveGraph, stageBg } from '../ui.jsx';

const MU0 = 4 * Math.PI * 1e-7;
const schema = [
  { key: 'I', label: 'Current I (A)', min: 0.5, max: 10, step: 0.5, type: 'range' },
  { key: 'shape', label: 'Wire shape', type: 'select', options: [{ value: 'straight', label: 'Straight wire' }, { value: 'loop', label: 'Circular loop' }, { value: 'square', label: 'Square loop' }] },
  { key: 'radius', label: 'Loop radius (m)', min: 0.05, max: 0.3, step: 0.01, type: 'range' },
];
function makeInitial() { return {}; }
function step() {}
// Biot-Savart: dB = μ0/4π · I dl × r̂ / r²
function BatPoint(p, px, py) {
  const I = p.I, R = p.radius;
  const segments = 200;
  let bx = 0, by = 0;
  if (p.shape === 'straight') {
    // Straight wire along y-axis at x=0.5, from y=0 to y=1
    for (let i = 0; i < segments; i++) {
      const sy = i / segments, sy2 = (i + 1) / segments;
      const my = (sy + sy2) / 2;
      const dlx = 0, dly = (sy2 - sy);
      const rx = px - 0.5, ry = py - my;
      const r = Math.sqrt(rx * rx + ry * ry + 1e-6);
      const cross_x = dly * 0 - dly * rx / r * 0; // dl × r̂ z-component → for 2D, B is out of page
      // B from straight wire is perpendicular to plane — show |B| as magnitude
      bx += MU0 / (4 * Math.PI) * I * dly * rx / (r * r * r);
      by += MU0 / (4 * Math.PI) * I * (-dly) * 0 / (r * r * r);
    }
  } else if (p.shape === 'loop') {
    for (let i = 0; i < segments; i++) {
      const a1 = (i / segments) * Math.PI * 2, a2 = ((i + 1) / segments) * Math.PI * 2;
      const am = (a1 + a2) / 2;
      const dlx = -Math.sin(am) * R * (a2 - a1), dly = Math.cos(am) * R * (a2 - a1);
      const sx = 0.5 + Math.cos(am) * R, sy = 0.5 + Math.sin(am) * R;
      const rx = px - sx, ry = py - sy;
      const r = Math.sqrt(rx * rx + ry * ry + 1e-6);
      bx += MU0 / (4 * Math.PI) * I * (dly * 0 - dlx * ry / r) / (r * r);
      by += MU0 / (4 * Math.PI) * I * (dlx * 0 - dly * (-rx) / r) / (r * r);
    }
  } else {
    // Square loop
    const s = R;
    const corners = [[0.5 - s, 0.5 - s], [0.5 + s, 0.5 - s], [0.5 + s, 0.5 + s], [0.5 - s, 0.5 + s]];
    for (let e = 0; e < 4; e++) {
      const [x1, y1] = corners[e], [x2, y2] = corners[(e + 1) % 4];
      for (let i = 0; i < segments / 4; i++) {
        const t1 = i / (segments / 4), t2 = (i + 1) / (segments / 4);
        const mx = x1 + (x2 - x1) * (t1 + t2) / 2, my = y1 + (y2 - y1) * (t1 + t2) / 2;
        const dlx = (x2 - x1) * (t2 - t1), dly = (y2 - y1) * (t2 - t1);
        const rx = px - mx, ry = py - my;
        const r = Math.sqrt(rx * rx + ry * ry + 1e-6);
        bx += MU0 / (4 * Math.PI) * I * (dly * 0 - dlx * ry / r) / (r * r);
        by += MU0 / (4 * Math.PI) * I * (dlx * 0 - dly * (-rx) / r) / (r * r);
      }
    }
  }
  return [bx * 1e6, by * 1e6]; // scale for display
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  // Wire
  ctx.strokeStyle = '#f97316'; ctx.lineWidth = 3;
  if (p.shape === 'straight') { ctx.beginPath(); ctx.moveTo(w * 0.5, 0); ctx.lineTo(w * 0.5, h); ctx.stroke(); }
  else if (p.shape === 'loop') { ctx.beginPath(); ctx.ellipse(w * 0.5, h * 0.5, p.radius * w, p.radius * h, 0, 0, Math.PI * 2); ctx.stroke(); }
  else { const s2 = p.radius * w; ctx.beginPath(); ctx.rect(w * 0.5 - s2, h * 0.5 - s2, s2 * 2, s2 * 2); ctx.stroke(); }
  // B field arrows
  const N = 16;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = (i + 0.5) / N, y = (j + 0.5) / N;
    const [bx, by] = BatPoint(p, x, y);
    const mag = Math.hypot(bx, by);
    if (mag < 1e-4) continue;
    const len = Math.min(1 / (N * 1.5), mag * 0.5) * w;
    const px = x * w, py = y * h, ang = Math.atan2(by, bx);
    ctx.strokeStyle = `hsl(${Math.min(200, 120 + mag * 500)} 80% 60%)`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(ang) * len, py + Math.sin(ang) * len); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '10px monospace'; ctx.textAlign = 'left';
  ctx.fillText('dB = μ₀/4π · I dl×r̂/r²', 12, h - 16);
}
function computeStats(s, p) {
  const [bx, by] = BatPoint(p, 0.5, 0.8);
  return { 'I': p.I.toFixed(1) + ' A', 'Shape': p.shape, 'R': p.radius.toFixed(2) + ' m', '|B| at (0.5,0.8)': Math.hypot(bx, by).toExponential(2) };
}
export default function BiotSavart() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ I: 2, shape: 'loop', radius: 0.12 });
  const graphData = [];
  for (let r = 0.02; r <= 0.4; r += 0.01) {
    const [bx, by] = BatPoint({ ...params, shape: 'straight' }, 0.5 + r, 0.5);
    graphData.push({ r: +r.toFixed(2), B: +Math.hypot(bx, by).toFixed(4) });
  }
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats });
  return (
    <SimLayout title="Biot–Savart Law" configName="biot-savart" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      graph={<div><div className="text-xs text-muted-foreground mb-1">|B| vs distance from straight wire (B ∝ 1/r)</div><LiveGraph data={graphData} series={[{ key: 'B', color: '#22d3ee' }]} xKey="r" height={150} /></div>}
      exportBar={<ExportBar graphData={graphData} config={params} canvasRef={canvasRef} name="biot-savart" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Numerical integration of dB = μ₀/4π · I dl×r̂/r² over 200 current elements. Straight wire: B ∝ 1/r. Loop: dipole-like field at center.</div>} />
  );
}