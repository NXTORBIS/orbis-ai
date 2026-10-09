import React, { useEffect, useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';
import { Button } from '../ui/button.jsx';

const schema = [
  { key: 'contourLevels', label: 'Equipotential lines', min: 4, max: 16, step: 1, type: 'range' },
  { key: 'addSign', label: 'Added charge', type: 'select', options: [{ value: '1', label: 'Positive +1' }, { value: '-1', label: 'Negative −1' }, { value: '2', label: 'Positive +2' }, { value: '-2', label: 'Negative −2' }] },
];
function makeInitial() { return { charges: [{ x: 0.4, y: 0.5, q: 1 }, { x: 0.6, y: 0.5, q: -1 }], probe: { x: 0.5, y: 0.5 } }; }
function step() {}
function Vat(charges, x, y) { let V = 0; for (const c of charges) { const dx = x - c.x, dy = y - c.y; V += c.q * 0.06 / Math.sqrt(dx * dx + dy * dy + 1e-4); } return V; }
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const gw = 100, gh = 70, cw = w / gw, ch = h / gh;
  const grid = [];
  let vmax = 0.01;
  for (let j = 0; j < gh; j++) { grid[j] = []; for (let i = 0; i < gw; i++) { const x = (i + 0.5) / gw, y = (j + 0.5) / gh; const V = Vat(s.charges, x, y); grid[j][i] = V; if (Math.abs(V) > vmax) vmax = Math.abs(V); } }
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) { const v = grid[j][i] / vmax; ctx.fillStyle = v > 0 ? `rgba(249,115,22,${0.04 + 0.35 * v})` : `rgba(34,211,238,${0.04 + 0.35 * -v})`; ctx.fillRect(i * cw, j * ch, cw + 1, ch + 1); }
  const levels = Math.round(p.contourLevels);
  for (let lv = 1; lv <= levels; lv++) {
    const target = (lv / levels) * vmax * 0.8;
    ctx.strokeStyle = lv % 2 === 0 ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    for (let j = 0; j < gh - 1; j++) for (let i = 0; i < gw - 1; i++) {
      const a = grid[j][i] > target, b = grid[j][i + 1] > target, c2 = grid[j + 1][i] > target, d = grid[j + 1][i + 1] > target;
      const n = (a ? 1 : 0) + (b ? 1 : 0) + (c2 ? 1 : 0) + (d ? 1 : 0);
      if (n === 0 || n === 4) continue;
      ctx.beginPath(); ctx.arc((i + 0.5) * cw, (j + 0.5) * ch, 0.5, 0, Math.PI * 2); ctx.stroke();
    }
  }
  for (const c of s.charges) { const px = c.x * w, py = c.y * h; ctx.fillStyle = c.q > 0 ? '#f97316' : '#22d3ee'; ctx.beginPath(); ctx.arc(px, py, 13, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = 'white'; ctx.font = 'bold 13px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(c.q > 0 ? '+' : '−', px, py); }
  const ppx = s.probe.x * w, ppy = s.probe.y * h; ctx.strokeStyle = '#fde047'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(ppx, ppy, 8, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = '#fde047'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'left'; ctx.fillText(`V=${Vat(s.charges, s.probe.x, s.probe.y).toFixed(3)}`, ppx + 12, ppy);
}
function computeStats(s) {
  const V = Vat(s.charges, s.probe.x, s.probe.y);
  return { 'Charges': s.charges.length, 'V at probe': V.toFixed(4), 'V max': '—', 'Equipotentials': 'contour lines' };
}
export default function ElectricPotential() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ contourLevels: 8, addSign: '1' });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats });
  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const toN = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
    const down = (e) => { e.preventDefault(); const [x, y] = toN(e); const st = sim.stateRef.current; if (e.shiftKey) { st.probe = { x, y }; return; } let near = -1, bd = 0.05; st.charges.forEach((c, i) => { const d = Math.hypot(c.x - x, c.y - y); if (d < bd) { bd = d; near = i; } }); if (near >= 0) st.drag = near; else st.charges.push({ x, y, q: parseFloat(params.addSign) }); };
    const move = (e) => { const st = sim.stateRef.current; if (st.drag >= 0) { const [x, y] = toN(e); st.charges[st.drag].x = x; st.charges[st.drag].y = y; } };
    const up = () => { sim.stateRef.current.drag = -1; };
    const ctxmenu = (e) => { e.preventDefault(); const [x, y] = toN(e); const st = sim.stateRef.current; let near = -1, bd = 0.05; st.charges.forEach((c, i) => { const d = Math.hypot(c.x - x, c.y - y); if (d < bd) { bd = d; near = i; } }); if (near >= 0) st.charges.splice(near, 1); };
    cv.addEventListener('mousedown', down); cv.addEventListener('mousemove', move); window.addEventListener('mouseup', up); cv.addEventListener('contextmenu', ctxmenu);
    return () => { cv.removeEventListener('mousedown', down); cv.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); cv.removeEventListener('contextmenu', ctxmenu); };
  }, [params.addSign]);
  return (
    <SimLayout title="Electric Potential Simulator" configName="electric-potential" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      exportBar={<div className="flex gap-2 flex-wrap items-center"><Button size="sm" variant="outline" onClick={() => { sim.stateRef.current.charges = []; }}>Clear</Button><ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="electric-potential" /></div>}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Click to add charge · drag to move · right-click to remove · Shift+click to move V probe.</div>} />
  );
}