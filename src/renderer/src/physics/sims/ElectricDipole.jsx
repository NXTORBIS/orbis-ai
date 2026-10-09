import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, LiveGraph, stageBg } from '../ui.jsx';

const schema = [
  { key: 'q', label: 'Charge |q|', min: 0.5, max: 3, step: 0.5, type: 'range' },
  { key: 'd', label: 'Separation d', min: 0.05, max: 0.3, step: 0.01, type: 'range' },
  { key: 'linesPerCharge', label: 'Field lines', min: 8, max: 24, step: 2, type: 'range' },
];
function makeInitial() { return {}; }
function step() {}
function fieldAt(q, d, x, y) {
  const px = d / 2;
  const dx1 = x - px, dy1 = y - 0.5, r1 = Math.sqrt(dx1 * dx1 + dy1 * dy1 + 1e-6);
  const dx2 = x + px, dy2 = y - 0.5, r2 = Math.sqrt(dx2 * dx2 + dy2 * dy2 + 1e-6);
  const ex = q * dx1 / (r1 * r1 * r1) - q * dx2 / (r2 * r2 * r2);
  const ey = q * dy1 / (r1 * r1 * r1) - q * dy2 / (r2 * r2 * r2);
  return [ex * 0.01, ey * 0.01];
}
function traceLine(q, d, sx, sy, sign) {
  const pts = [{ x: sx, y: sy }];
  let x = sx, y = sy;
  const step = 0.005;
  for (let i = 0; i < 400; i++) {
    const [ex, ey] = fieldAt(q, d, x, y);
    const mag = Math.hypot(ex, ey);
    if (mag < 1e-8) break;
    x += sign * ex / mag * step;
    y += sign * ey / mag * step;
    if (x < -0.1 || x > 1.1 || y < -0.1 || y > 1.1) break;
    pts.push({ x, y });
  }
  return pts;
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const q = p.q, d = p.d;
  const nLines = Math.round(p.linesPerCharge);
  for (let i = 0; i < nLines; i++) {
    const ang = (i / nLines) * Math.PI * 2;
    const sx = d / 2 + Math.cos(ang) * 0.015, sy = 0.5 + Math.sin(ang) * 0.015;
    const pts = traceLine(q, d, sx, sy, 1);
    ctx.strokeStyle = 'rgba(249,115,22,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); pts.forEach((pt, i2) => { const px = pt.x * w, py = pt.y * h; if (i2 === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); }); ctx.stroke();
    const sx2 = -d / 2 + Math.cos(ang) * 0.015, sy2 = 0.5 + Math.sin(ang) * 0.015;
    const pts2 = traceLine(q, d, sx2, sy2, -1);
    ctx.strokeStyle = 'rgba(34,211,238,0.5)';
    ctx.beginPath(); pts2.forEach((pt, i2) => { const px = pt.x * w, py = pt.y * h; if (i2 === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); }); ctx.stroke();
  }
  const cx = w / 2, cy = h / 2;
  ctx.fillStyle = '#f97316'; ctx.beginPath(); ctx.arc((d / 2) * w, 0.5 * h, 12, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#22d3ee'; ctx.beginPath(); ctx.arc((-d / 2) * w, 0.5 * h, 12, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'white'; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('+', (d / 2) * w, 0.5 * h); ctx.fillText('−', (-d / 2) * w, 0.5 * h);
  ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo((-d / 2) * w, 0.5 * h); ctx.lineTo((d / 2) * w, 0.5 * h); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '10px monospace'; ctx.textAlign = 'left';
  ctx.fillText(`p = qd = ${(q * d).toFixed(3)}`, 12, h - 16);
}
function computeStats(s, p) {
  const dipoleMoment = p.q * p.d;
  return { '|q|': p.q.toFixed(1), 'd': p.d.toFixed(2), 'p = qd': dipoleMoment.toFixed(3), 'Far-field': '1/r³ falloff' };
}
export default function ElectricDipole() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ q: 1, d: 0.15, linesPerCharge: 16 });
  const graphData = [];
  for (let r = 0.2; r <= 3; r += 0.05) {
    const E_dipole = 2 * params.q * params.d / Math.pow(r, 3);
    graphData.push({ r: +r.toFixed(2), dipole: +E_dipole.toFixed(5), point: +(params.q / (r * r)).toFixed(5) });
  }
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats });
  return (
    <SimLayout title="Electric Dipole Field" configName="electric-dipole" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      graph={<div><div className="text-xs text-muted-foreground mb-1">Far-field: dipole 1/r³ vs point 1/r²</div><LiveGraph data={graphData} series={[{ key: 'dipole', color: '#f97316' }, { key: 'point', color: '#64748b' }]} xKey="r" height={150} /></div>}
      exportBar={<ExportBar graphData={graphData} config={params} canvasRef={canvasRef} name="electric-dipole" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Dipole field lines traced by RK1 integration. Far-field falls as 1/r³, faster than a single charge's 1/r².</div>} />
  );
}