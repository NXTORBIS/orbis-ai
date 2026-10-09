import React, { useEffect, useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';
import { Button } from '../ui/button.jsx';

const schema = [
  { key: 'linesPerCharge', label: 'Lines per charge', min: 4, max: 16, step: 1, type: 'range' },
  { key: 'showNulls', label: 'Show null points', type: 'toggle' },
  { key: 'addSign', label: 'Added charge', type: 'select', options: [{ value: '1', label: 'Positive +1' }, { value: '-1', label: 'Negative −1' }] },
];
function makeInitial() { return { charges: [{ x: 0.3, y: 0.35, q: 1 }, { x: 0.7, y: 0.35, q: 1 }, { x: 0.3, y: 0.65, q: -1 }, { x: 0.7, y: 0.65, q: -1 }], drag: -1 }; }
function step() {}
function fieldAt(charges, x, y) { let ex = 0, ey = 0; for (const c of charges) { const dx = x - c.x, dy = y - c.y; const r2 = dx * dx + dy * dy + 1e-5; const r = Math.sqrt(r2); const k = c.q * 0.004; ex += k * dx / (r2 * r); ey += k * dy / (r2 * r); } return [ex, ey]; }
function traceLine(charges, sx, sy, sign) {
  const pts = [{ x: sx, y: sy }]; let x = sx, y = sy;
  for (let i = 0; i < 300; i++) {
    const [ex, ey] = fieldAt(charges, x, y); const mag = Math.hypot(ex, ey);
    if (mag < 1e-9) break;
    x += sign * ex / mag * 0.006; y += sign * ey / mag * 0.006;
    if (x < -0.05 || x > 1.05 || y < -0.05 || y > 1.05) break;
    pts.push({ x, y });
  }
  return pts;
}
function findNulls(charges) {
  const nulls = [];
  for (let j = 0; j < 40; j++) for (let i = 0; i < 40; i++) {
    const x = (i + 0.5) / 40, y = (j + 0.5) / 40;
    const [ex, ey] = fieldAt(charges, x, y);
    if (Math.hypot(ex, ey) < 5e-5) nulls.push({ x, y });
  }
  return nulls;
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const nLines = Math.round(p.linesPerCharge);
  for (const c of s.charges) {
    for (let i = 0; i < nLines; i++) {
      const ang = (i / nLines) * Math.PI * 2;
      const sx = c.x + Math.cos(ang) * 0.012, sy = c.y + Math.sin(ang) * 0.012;
      const pts = traceLine(s.charges, sx, sy, c.q > 0 ? 1 : -1);
      ctx.strokeStyle = c.q > 0 ? 'rgba(249,115,22,0.4)' : 'rgba(34,211,238,0.4)'; ctx.lineWidth = 1;
      ctx.beginPath(); pts.forEach((pt, i2) => { const px = pt.x * w, py = pt.y * h; if (i2 === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); }); ctx.stroke();
    }
  }
  if (p.showNulls) { const nulls = findNulls(s.charges); for (const n of nulls) { ctx.fillStyle = '#fde047'; ctx.beginPath(); ctx.arc(n.x * w, n.y * h, 5, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1; ctx.stroke(); } }
  for (const c of s.charges) { const px = c.x * w, py = c.y * h; ctx.fillStyle = c.q > 0 ? '#f97316' : '#22d3ee'; ctx.beginPath(); ctx.arc(px, py, 12, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = 'white'; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(c.q > 0 ? '+' : '−', px, py); }
}
function computeStats(s) { return { 'Charges': s.charges.length, 'Net Q': s.charges.reduce((a, c) => a + c.q, 0).toFixed(1), 'Field lines': 'traced', 'Null points': p_showNulls(s) }; }
function p_showNulls(s) { return findNulls(s.charges).length; }
export default function MultichargeSystem() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ linesPerCharge: 8, showNulls: true, addSign: '1' });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats });
  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const toN = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
    const down = (e) => { e.preventDefault(); const [x, y] = toN(e); const st = sim.stateRef.current; let near = -1, bd = 0.05; st.charges.forEach((c, i) => { const d = Math.hypot(c.x - x, c.y - y); if (d < bd) { bd = d; near = i; } }); if (near >= 0) st.drag = near; else st.charges.push({ x, y, q: parseFloat(params.addSign) }); };
    const move = (e) => { const st = sim.stateRef.current; if (st.drag >= 0) { const [x, y] = toN(e); st.charges[st.drag].x = x; st.charges[st.drag].y = y; } };
    const up = () => { sim.stateRef.current.drag = -1; };
    const ctxmenu = (e) => { e.preventDefault(); const [x, y] = toN(e); const st = sim.stateRef.current; let near = -1, bd = 0.05; st.charges.forEach((c, i) => { const d = Math.hypot(c.x - x, c.y - y); if (d < bd) { bd = d; near = i; } }); if (near >= 0) st.charges.splice(near, 1); };
    cv.addEventListener('mousedown', down); cv.addEventListener('mousemove', move); window.addEventListener('mouseup', up); cv.addEventListener('contextmenu', ctxmenu);
    return () => { cv.removeEventListener('mousedown', down); cv.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); cv.removeEventListener('contextmenu', ctxmenu); };
  }, [params.addSign]);
  return (
    <SimLayout title="Multiple Charge Superposition" configName="multicharge" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      exportBar={<div className="flex gap-2 flex-wrap items-center"><Button size="sm" variant="outline" onClick={() => { sim.stateRef.current.charges = []; }}>Clear</Button><ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="multicharge" /></div>}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Field lines traced by vector integration. Yellow dots mark null points where E = 0. Click to add · drag to move · right-click to remove.</div>} />
  );
}