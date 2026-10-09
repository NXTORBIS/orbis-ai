import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';
import { Button } from '../ui/button.jsx';

const EPS0 = 1; // normalised
const schema = [
  { key: 'radius', label: 'Gaussian radius', min: 0.08, max: 0.45, step: 0.01, type: 'range' },
  { key: 'addSign', label: 'Added charge', type: 'select', options: [{ value: '1', label: 'Positive +1' }, { value: '-1', label: 'Negative −1' }, { value: '2', label: 'Positive +2' }, { value: '-2', label: 'Negative −2' }] },
];
function makeInitial() { return { charges: [{ x: 0.5, y: 0.5, q: 2 }, { x: 0.3, y: 0.3, q: -1 }], cx: 0.5, cy: 0.5 }; }
function step() {}
function fieldAt(charges, x, y) { let ex = 0, ey = 0; for (const c of charges) { const dx = x - c.x, dy = y - c.y; const r2 = dx * dx + dy * dy + 1e-5; const r = Math.sqrt(r2); const k = c.q * 0.004; ex += k * dx / (r2 * r); ey += k * dy / (r2 * r); } return [ex, ey]; }
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const cx = s.cx * w, cy = s.cy * h, R = p.radius * Math.min(w, h);
  // Gaussian surface
  ctx.strokeStyle = '#fde047'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  // Flux arrows through surface
  const N = 36;
  for (let i = 0; i < N; i++) {
    const ang = (i / N) * Math.PI * 2;
    const px = s.cx + Math.cos(ang) * p.radius, py = s.cy + Math.sin(ang) * p.radius;
    const [ex, ey] = fieldAt(s.charges, px, py);
    const mag = Math.hypot(ex, ey);
    if (mag < 1e-7) continue;
    const dotN = (ex * Math.cos(ang) + ey * Math.sin(ang)) / mag;
    const len = 12 * Math.abs(dotN) * Math.min(1, mag * 200);
    const sign = dotN > 0 ? 1 : -1;
    const ax = px * w + Math.cos(ang) * len * sign, ay = py * h + Math.sin(ang) * len * sign;
    ctx.strokeStyle = dotN > 0 ? 'rgba(249,115,22,0.7)' : 'rgba(34,211,238,0.7)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(px * w, py * h); ctx.lineTo(ax, ay); ctx.stroke();
  }
  // Charges
  for (const c of s.charges) {
    const inside = Math.hypot(c.x - s.cx, c.y - s.cy) < p.radius;
    ctx.fillStyle = c.q > 0 ? '#f97316' : '#22d3ee';
    ctx.beginPath(); ctx.arc(c.x * w, c.y * h, inside ? 14 : 10, 0, Math.PI * 2); ctx.fill();
    if (!inside) { ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1; ctx.stroke(); }
    ctx.fillStyle = 'white'; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(c.q > 0 ? '+' : '−', c.x * w, c.y * h);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '10px monospace'; ctx.textAlign = 'left';
  const Qenc = s.charges.filter((c) => Math.hypot(c.x - s.cx, c.y - s.cy) < p.radius).reduce((a, c) => a + c.q, 0);
  ctx.fillText(`Φ = Q_enc/ε₀ = ${Qenc.toFixed(1)}/ε₀`, 12, h - 16);
}
function computeStats(s, p) {
  const Qenc = s.charges.filter((c) => Math.hypot(c.x - s.cx, c.y - s.cy) < p.radius).reduce((a, c) => a + c.q, 0);
  const Qtotal = s.charges.reduce((a, c) => a + c.q, 0);
  return { 'Q enclosed': Qenc.toFixed(1), 'Q total': Qtotal.toFixed(1), 'Φ = Q/ε₀': Qenc.toFixed(1), 'External flux': '0 (net)' };
}
export default function GaussLaw() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ radius: 0.2, addSign: '1' });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats });
  return (
    <SimLayout title="Gauss's Law Simulator" configName="gauss-law" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      exportBar={<div className="flex gap-2 flex-wrap items-center"><Button size="sm" variant="outline" onClick={() => { sim.stateRef.current.charges = []; }}>Clear</Button><ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="gauss-law" /></div>}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Yellow dashed circle = Gaussian surface. Orange arrows = outward flux, cyan = inward. Only enclosed charges contribute to net flux. Click to add charges · drag surface center by moving charges.</div>} />
  );
}