import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, LiveGraph, stageBg } from '../ui.jsx';

const schema = [
  { key: 'V0', label: 'Battery voltage V', min: 1, max: 12, step: 0.5, type: 'range' },
  { key: 'R', label: 'Resistance R', min: 100, max: 5000, step: 100, type: 'range' },
  { key: 'C', label: 'Capacitance C (µF)', min: 10, max: 500, step: 10, type: 'range' },
  { key: 'plateGap', label: 'Plate gap d', min: 0.2, max: 0.6, step: 0.02, type: 'range' },
];
function makeInitial() { return { mode: 'charging', t: 0 }; }
function step(s, dt, p) {
  if (!s.mode) s.mode = 'charging';
  s.t += dt;
  const tau = (p.R * p.C * 1e-6);
  if (s.t > 6 * tau) { s.mode = s.mode === 'charging' ? 'discharging' : 'charging'; s.t = 0; }
}
function Qfrac(s, p) {
  const tau = p.R * p.C * 1e-6;
  return s.mode === 'charging' ? 1 - Math.exp(-s.t / tau) : Math.exp(-s.t / tau);
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const cx = w / 2, cy = h / 2;
  const plateW = w * 0.3, gap = p.plateGap * 80;
  const q = Qfrac(s, p);
  // Plates
  ctx.fillStyle = `rgba(249,115,22,${0.3 + 0.5 * q})`; ctx.fillRect(cx - plateW / 2, cy - gap / 2 - 8, plateW, 6);
  ctx.fillStyle = `rgba(34,211,238,${0.3 + 0.5 * q})`; ctx.fillRect(cx - plateW / 2, cy + gap / 2 + 2, plateW, 6);
  // Charges on plates
  for (let i = 0; i < 12; i++) {
    const px = cx - plateW / 2 + (i + 0.5) * plateW / 12;
    ctx.fillStyle = '#f97316'; ctx.font = '10px monospace'; ctx.textAlign = 'center'; ctx.fillText('+', px, cy - gap / 2 - 14);
    ctx.fillStyle = '#22d3ee'; ctx.fillText('−', px, cy + gap / 2 + 18);
  }
  // E field arrows between plates
  for (let i = 0; i < 6; i++) {
    const px = cx - plateW / 2 + (i + 0.5) * plateW / 6;
    ctx.strokeStyle = `rgba(255,255,255,${0.2 + 0.4 * q})`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px, cy - gap / 2); ctx.lineTo(px, cy + gap / 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(px - 3, cy + gap / 2 - 5); ctx.lineTo(px, cy + gap / 2); ctx.lineTo(px + 3, cy + gap / 2 - 5); ctx.stroke();
  }
  // Circuit wires
  ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx - plateW / 2, cy - gap / 2 - 5); ctx.lineTo(cx - plateW / 2 - 40, cy - gap / 2 - 5); ctx.lineTo(cx - plateW / 2 - 40, cy + gap / 2 + 5); ctx.lineTo(cx - plateW / 2, cy + gap / 2 + 5); ctx.stroke();
  // Battery
  ctx.strokeStyle = '#fde047'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx - plateW / 2 - 55, cy - 12); ctx.lineTo(cx - plateW / 2 - 25, cy - 12); ctx.moveTo(cx - plateW / 2 - 50, cy - 6); ctx.lineTo(cx - plateW / 2 - 30, cy - 6); ctx.moveTo(cx - plateW / 2 - 55, cy + 6); ctx.lineTo(cx - plateW / 2 - 25, cy + 6); ctx.moveTo(cx - plateW / 2 - 50, cy + 12); ctx.lineTo(cx - plateW / 2 - 30, cy + 12); ctx.stroke();
  ctx.fillStyle = '#fde047'; ctx.font = '10px monospace'; ctx.textAlign = 'center'; ctx.fillText(`${p.V0}V`, cx - plateW / 2 - 40, cy + 28);
  ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '10px monospace'; ctx.textAlign = 'left';
  ctx.fillText(`Q/Q₀ = ${(q * 100).toFixed(1)}%  [${s.mode}]`, 12, h - 16);
}
function sample(s, p, t) {
  const tau = p.R * p.C * 1e-6;
  const q = Qfrac(s, p) * p.C * 1e-6 * p.V0;
  const v = Qfrac(s, p) * p.V0;
  const u = 0.5 * p.C * 1e-6 * v * v;
  return { t: +t.toFixed(3), Q: +q.toExponential(2), V: +v.toFixed(3), U: +u.toExponential(2) };
}
function computeStats(s, p) {
  const tau = p.R * p.C * 1e-6;
  const q = Qfrac(s, p);
  return { 'τ = RC': `${(tau * 1000).toFixed(1)} ms`, 'Q/Q₀': `${(q * 100).toFixed(1)}%`, 'V_C': `${(q * p.V0).toFixed(2)} V`, 'U = ½CV²': `${(0.5 * p.C * 1e-6 * (q * p.V0) ** 2).toExponential(2)} J` };
}
export default function CapacitorSim() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ V0: 5, R: 1000, C: 100, plateGap: 0.4 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, sample, computeStats });
  return (
    <SimLayout title="Capacitor & RC Charging" configName="capacitor-rc" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      graph={<div><div className="text-xs text-muted-foreground mb-1">Q(t), V(t) — exponential charging/discharging</div><LiveGraph data={sim.graphData} series={[{ key: 'V', color: '#f97316' }]} height={150} /></div>}
      exportBar={<ExportBar graphData={sim.graphData} config={params} canvasRef={canvasRef} name="capacitor-rc" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">RC circuit: Q(t) = CV(1−e^(−t/RC)). Auto-cycles between charging and discharging. τ = RC sets the time constant.</div>} />
  );
}