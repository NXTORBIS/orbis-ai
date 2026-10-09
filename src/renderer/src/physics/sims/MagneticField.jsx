import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

const schema = [
  { key: 'mode', label: 'Source type', type: 'select', options: [{ value: 'bar', label: 'Bar magnet' }, { value: 'loop', label: 'Current loop' }, { value: 'straight', label: 'Straight wire' }] },
  { key: 'strength', label: 'Field strength', min: 0.5, max: 3, step: 0.1, type: 'range' },
  { key: 'lines', label: 'Field lines', min: 10, max: 30, step: 2, type: 'range' },
];
function makeInitial() { return { probe: { x: 0.5, y: 0.5 } }; }
function step() {}
function Bat(mode, strength, x, y) {
  if (mode === 'bar') {
    const px1 = 0.42, py1 = 0.5, px2 = 0.58, py2 = 0.5;
    const dx1 = x - px1, dy1 = y - py1, r1 = Math.sqrt(dx1 * dx1 + dy1 * dy1 + 1e-4);
    const dx2 = x - px2, dy2 = y - py2, r2 = Math.sqrt(dx2 * dx2 + dy2 * dy2 + 1e-4);
    const bx = strength * 0.003 * (dx1 / (r1 * r1 * r1) - dx2 / (r2 * r2 * r2));
    const by = strength * 0.003 * (dy1 / (r1 * r1 * r1) - dy2 / (r2 * r2 * r2));
    return [bx, by];
  }
  if (mode === 'loop') {
    // Loop at center, radius 0.1, axis horizontal
    const cx = 0.5, cy = 0.5, R = 0.1;
    const dx = x - cx, dy = y - cy;
    const r = Math.sqrt(dx * dx + dy * dy + 1e-4);
    const r2d = Math.sqrt(dx * dx + dy * dy + 1e-4);
    // Approximate: dipole-like field
    const bx = strength * 0.002 * (2 * dx * dx - dy * dy) / (r * r * r * r + 1e-4);
    const by = strength * 0.002 * 3 * dx * dy / (r * r * r * r + 1e-4);
    return [bx, by];
  }
  // Straight wire (vertical, at x=0.5), current up
  const dx = x - 0.5;
  const r = Math.abs(dx) + 1e-4;
  return [0, strength * 0.004 / r * (dx > 0 ? -1 : 1) * 0]; // B is into/out of page for straight wire
  // For 2D viz, show B magnitude as field perpendicular — simplified
}
function traceLine(mode, strength, sx, sy, sign) {
  const pts = [{ x: sx, y: sy }]; let x = sx, y = sy;
  for (let i = 0; i < 300; i++) {
    const [bx, by] = Bat(mode, strength, x, y);
    const mag = Math.hypot(bx, by);
    if (mag < 1e-9) break;
    x += sign * bx / mag * 0.005; y += sign * by / mag * 0.005;
    if (x < -0.05 || x > 1.05 || y < -0.05 || y > 1.05) break;
    pts.push({ x, y });
  }
  return pts;
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const nLines = Math.round(p.lines);
  if (p.mode === 'straight') {
    // Straight wire: B circles around wire (shown as circles)
    ctx.strokeStyle = '#f97316'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(w * 0.5, 0); ctx.lineTo(w * 0.5, h); ctx.stroke();
    ctx.fillStyle = '#fde047'; ctx.font = '14px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('⊙', w * 0.5, h / 2);
    for (let r = 20; r < w * 0.4; r += 25) {
      ctx.strokeStyle = `rgba(34,211,238,${0.5 - r / (w * 0.8)})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(w * 0.5, h / 2, r, 0, Math.PI * 2); ctx.stroke();
      // Direction arrows
      for (let a = 0; a < 4; a++) {
        const ang = a * Math.PI / 2 + 0.3;
        const ax = w * 0.5 + Math.cos(ang) * r, ay = h / 2 + Math.sin(ang) * r;
        ctx.fillStyle = `rgba(34,211,238,${0.6 - r / (w * 0.8)})`;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax - 4, ay - 4); ctx.lineTo(ax + 2, ay - 2); ctx.closePath(); ctx.fill();
      }
    }
  } else {
    // Bar magnet or loop: trace field lines
    const starts = [];
    if (p.mode === 'bar') {
      for (let i = 0; i < nLines; i++) { const ang = (i / nLines) * Math.PI * 2; starts.push({ x: 0.42 + Math.cos(ang) * 0.01, y: 0.5 + Math.sin(ang) * 0.01, sign: 1 }); }
      for (let i = 0; i < nLines; i++) { const ang = (i / nLines) * Math.PI * 2; starts.push({ x: 0.58 + Math.cos(ang) * 0.01, y: 0.5 + Math.sin(ang) * 0.01, sign: -1 }); }
    } else {
      for (let i = 0; i < nLines; i++) { const ang = (i / nLines) * Math.PI * 2; starts.push({ x: 0.5 + Math.cos(ang) * 0.12, y: 0.5 + Math.sin(ang) * 0.12, sign: 1 }); }
    }
    for (const st of starts) {
      const pts = traceLine(p.mode, p.strength, st.x, st.y, st.sign);
      ctx.strokeStyle = 'rgba(34,211,238,0.4)'; ctx.lineWidth = 1;
      ctx.beginPath(); pts.forEach((pt, i2) => { const px = pt.x * w, py = pt.y * h; if (i2 === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); }); ctx.stroke();
    }
    if (p.mode === 'bar') {
      ctx.fillStyle = '#ef4444'; ctx.fillRect(0.42 * w - 16, 0.5 * h - 10, 16, 20);
      ctx.fillStyle = '#3b82f6'; ctx.fillRect(0.58 * w, 0.5 * h - 10, 16, 20);
      ctx.fillStyle = 'white'; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('N', 0.42 * w - 8, 0.5 * h); ctx.fillText('S', 0.58 * w + 8, 0.5 * h);
    } else {
      ctx.strokeStyle = '#f97316'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(0.5 * w, 0.5 * h, 0.12 * w, 0.12 * w, 0, 0, Math.PI * 2); ctx.stroke();
    }
  }
}
function computeStats(s, p) {
  const [bx, by] = Bat(p.mode, p.strength, s.probe.x, s.probe.y);
  return { 'Source': p.mode, 'Strength': p.strength.toFixed(1), '|B| at probe': Math.hypot(bx, by).toExponential(2), 'Lines': p.lines };
}
export default function MagneticField() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ mode: 'bar', strength: 1.5, lines: 18 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats });
  return (
    <SimLayout title="Magnetic Field Visualizer" configName="magnetic-field" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="magnetic-field" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Field lines traced by integration. Bar magnet: dipole pattern from N to S. Current loop: dipole-like field. Straight wire: circular field (right-hand rule).</div>} />
  );
}