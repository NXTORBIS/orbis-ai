import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, LiveGraph, stageBg } from '../ui.jsx';
import { Button } from '../ui/button.jsx';

const schema = [
  { key: 'q', label: 'Charge q', min: -3, max: 3, step: 0.5, type: 'range' },
  { key: 'arrows', label: 'Arrow count', min: 12, max: 36, step: 2, type: 'range' },
];
function makeInitial() { return {}; }
function step() {}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const cx = w / 2, cy = h / 2, scale = Math.min(w, h) * 0.42;
  const N = Math.round(p.arrows);
  for (let ring = 0; ring < 3; ring++) {
    const rr = scale * (0.3 + ring * 0.3);
    const count = Math.max(6, Math.round(N * (0.5 + ring * 0.3)));
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2;
      const px = cx + Math.cos(ang) * rr, py = cy + Math.sin(ang) * rr;
      const dx = Math.cos(ang), dy = Math.sin(ang);
      const sign = p.q >= 0 ? 1 : -1;
      const len = 14 * Math.abs(p.q) * sign * (1 - ring * 0.2);
      if (Math.abs(len) < 0.5) continue;
      const ex = px + dx * len, ey = py + dy * len;
      ctx.strokeStyle = p.q > 0 ? `rgba(249,115,22,${0.5 + 0.3 * (1 - ring * 0.25)})` : `rgba(34,211,238,${0.5 + 0.3 * (1 - ring * 0.25)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(ex, ey); ctx.stroke();
      const ah = 4;
      ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex - dx * ah + dy * ah * 0.6, ey - dy * ah - dx * ah * 0.6); ctx.lineTo(ex - dx * ah - dy * ah * 0.6, ey - dy * ah + dx * ah * 0.6); ctx.closePath(); ctx.fillStyle = ctx.strokeStyle; ctx.fill();
    }
  }
  for (let r = 20; r < scale; r += 25) { ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); }
  ctx.fillStyle = p.q > 0 ? '#f97316' : '#22d3ee'; ctx.beginPath(); ctx.arc(cx, cy, 16, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'white'; ctx.font = 'bold 16px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(p.q > 0 ? '+' : '−', cx, cy);
  ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '11px monospace'; ctx.textAlign = 'left'; ctx.fillText(`|E| ∝ 1/r²`, 12, h - 16);
}
function sample(s, p, t) {
  const pts = [];
  for (let r = 0.1; r <= 2; r += 0.05) pts.push({ r: +r.toFixed(2), E: +(Math.abs(p.q) / (r * r)).toFixed(4) });
  return null;
}
function computeStats(s, p) {
  const E_at_1 = Math.abs(p.q) / 1;
  const E_at_2 = Math.abs(p.q) / 4;
  return { 'q': p.q.toFixed(1), '|E| at r=1': E_at_1.toFixed(3), '|E| at r=2': E_at_2.toFixed(3), 'Ratio (1/r²)': (E_at_1 / E_at_2).toFixed(1) + '×' };
}
export default function PointCharges() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ q: 1, arrows: 24 });
  const graphData = [];
  for (let r = 0.15; r <= 2; r += 0.03) graphData.push({ r: +r.toFixed(2), E: Math.abs(params.q) / (r * r) });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats });
  return (
    <SimLayout title="Point Charge Coulomb Field" configName="point-charges" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      graph={<div><div className="text-xs text-muted-foreground mb-1">|E| vs r — inverse-square law</div><LiveGraph data={graphData} series={[{ key: 'E', color: '#f97316' }]} xKey="r" height={150} /></div>}
      exportBar={<ExportBar graphData={graphData} config={params} canvasRef={canvasRef} name="point-charges" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Single point charge: E = kq/r². The plot confirms the 1/r² falloff.</div>} />
  );
}