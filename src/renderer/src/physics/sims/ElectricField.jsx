import React, { useEffect, useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';
import { Button } from '../ui/button.jsx';

const schema = [
  { key: 'arrowDensity', label: 'Arrow density', min: 8, max: 26, step: 1, type: 'range' },
  { key: 'showPotential', label: 'Potential heatmap', type: 'toggle' },
  { key: 'addSign', label: 'Added charge', type: 'select', options: [{ value: '1', label: 'Positive +1' }, { value: '-1', label: 'Negative −1' }, { value: '2', label: 'Positive +2' }, { value: '-2', label: 'Negative −2' }] },
];

function makeInitial() { return { charges: [{ x: 0.35, y: 0.5, q: 1 }, { x: 0.65, y: 0.5, q: -1 }], drag: -1 }; }
function step() {}
function fieldAt(charges, x, y) {
  let ex = 0, ey = 0;
  for (const c of charges) { const dx = x - c.x, dy = y - c.y; const r2 = dx * dx + dy * dy + 1e-4; const r = Math.sqrt(r2); const k = c.q * 0.06; ex += k * dx / (r2 * r); ey += k * dy / (r2 * r); }
  return [ex, ey];
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  if (p.showPotential) {
    const gw = 90, gh = 64, cw = w / gw, ch = h / gh;
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      const x = (i + 0.5) / gw, y = (j + 0.5) / gh; let V = 0;
      for (const c of s.charges) { const dx = x - c.x, dy = y - c.y; V += c.q * 0.06 / Math.sqrt(dx * dx + dy * dy + 1e-4); }
      const v = Math.tanh(V * 2);
      ctx.fillStyle = v > 0 ? `rgba(249,115,22,${0.05 + 0.25 * v})` : `rgba(34,211,238,${0.05 + 0.25 * -v})`;
      ctx.fillRect(i * cw, j * ch, cw + 1, ch + 1);
    }
  }
  const N = Math.round(p.arrowDensity);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = (i + 0.5) / N, y = (j + 0.5) / N;
    const [ex, ey] = fieldAt(s.charges, x, y); const mag = Math.sqrt(ex * ex + ey * ey);
    if (mag < 1e-5) continue;
    const len = Math.min(1 / (N * 1.6), mag * 0.018) * w;
    const px = x * w, py = y * h, ang = Math.atan2(ey, ex);
    ctx.strokeStyle = `hsl(${Math.min(190, 40 + mag * 700)} 90% 60%)`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(ang) * len, py + Math.sin(ang) * len); ctx.stroke();
  }
  for (const c of s.charges) {
    const px = c.x * w, py = c.y * h;
    ctx.fillStyle = c.q > 0 ? '#f97316' : '#22d3ee';
    ctx.beginPath(); ctx.arc(px, py, 13, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'white'; ctx.font = 'bold 13px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(c.q > 0 ? '+' : '−', px, py);
  }
}
function computeStats(s) {
  const pos = s.charges.filter((c) => c.q > 0).reduce((a, c) => a + c.q, 0);
  const neg = s.charges.filter((c) => c.q < 0).reduce((a, c) => a - c.q, 0);
  const [ex, ey] = fieldAt(s.charges, 0.5, 0.5);
  return { 'Charges': s.charges.length, 'Net +Q': pos.toFixed(1), 'Net −Q': neg.toFixed(1), '|E| centre': Math.hypot(ex, ey).toFixed(3) };
}

export default function ElectricField() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ arrowDensity: 16, showPotential: false, addSign: '1' });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats });
  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const toNorm = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
    const down = (e) => { e.preventDefault(); const [x, y] = toNorm(e); const st = sim.stateRef.current; let near = -1, bd = 0.05; st.charges.forEach((c, i) => { const d = Math.hypot(c.x - x, c.y - y); if (d < bd) { bd = d; near = i; } }); if (near >= 0) st.drag = near; else st.charges.push({ x, y, q: parseFloat(params.addSign) }); };
    const move = (e) => { const st = sim.stateRef.current; if (st.drag >= 0) { const [x, y] = toNorm(e); st.charges[st.drag].x = x; st.charges[st.drag].y = y; } };
    const up = () => { sim.stateRef.current.drag = -1; };
    const ctxmenu = (e) => { e.preventDefault(); const [x, y] = toNorm(e); const st = sim.stateRef.current; let near = -1, bd = 0.05; st.charges.forEach((c, i) => { const d = Math.hypot(c.x - x, c.y - y); if (d < bd) { bd = d; near = i; } }); if (near >= 0) st.charges.splice(near, 1); };
    cv.addEventListener('mousedown', down); cv.addEventListener('mousemove', move); window.addEventListener('mouseup', up); cv.addEventListener('contextmenu', ctxmenu);
    return () => { cv.removeEventListener('mousedown', down); cv.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); cv.removeEventListener('contextmenu', ctxmenu); };
  }, [params.addSign]);
  return (
    <SimLayout title="Electric Field Simulator" configName="electric-field" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      exportBar={<div className="flex gap-2 flex-wrap items-center"><Button size="sm" variant="outline" onClick={() => { sim.stateRef.current.charges = []; }}>Clear charges</Button><ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="electric-field" /></div>}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Drag charges to move · click empty space to add · right-click to remove.</div>} />
  );
}