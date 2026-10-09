import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

// Two-loop circuit: V1 — R1 — node A — R2 — node B — R3 — ground; V2 — R4 — node B
const schema = [
  { key: 'V1', label: 'Source V1 (V)', min: 1, max: 12, step: 0.5, type: 'range' },
  { key: 'V2', label: 'Source V2 (V)', min: 1, max: 12, step: 0.5, type: 'range' },
  { key: 'R1', label: 'R1 (Ω)', min: 10, max: 500, step: 10, type: 'range' },
  { key: 'R2', label: 'R2 (Ω)', min: 10, max: 500, step: 10, type: 'range' },
  { key: 'R3', label: 'R3 (Ω)', min: 10, max: 500, step: 10, type: 'range' },
  { key: 'R4', label: 'R4 (Ω)', min: 10, max: 500, step: 10, type: 'range' },
];
function makeInitial() { return {}; }
function step() {}
function solve(p) {
  // Node A, B voltages via nodal analysis (ground = 0)
  // KCL at A: (V1 - VA)/R1 = VA/R3 + (VA - VB)/R2
  // KCL at B: (V2 - VB)/R4 = (VB - VA)/R2 + VB/R3... simplified 2-loop:
  // Actually: Loop1: V1 - I1*R1 - (I1-I2)*R2 = 0
  //          Loop2: V2 - I2*R4 - (I2-I1)*R2 - I2*R3 = 0
  const { V1, V2, R1, R2, R3, R4 } = p;
  // Matrix: [R1+R2, -R2] [I1] = [V1]
  //        [-R2, R2+R3+R4] [I2] = [V2]
  const a = R1 + R2, b = -R2, c = -R2, d = R2 + R3 + R4;
  const det = a * d - b * c;
  const I1 = (V1 * d - V2 * b) / det;
  const I2 = (a * V2 - c * V1) / det;
  const I_R2 = I1 - I2;
  return { I1, I2, I_R2, VA: V1 - I1 * R1, VB: I2 * R3, VAB: (I1 - I2) * R2 };
}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const r = solve(p);
  // Draw two-loop circuit
  const mx = 60, my = 60, lw = w - 120, lh = h - 120;
  ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 2;
  // Outer rectangle
  ctx.strokeRect(mx, my, lw, lh);
  // R1 (top-left segment)
  ctx.fillStyle = '#f97316'; ctx.font = '11px monospace'; ctx.textAlign = 'center';
  ctx.fillText(`R1=${p.R1}Ω`, mx + lw * 0.15, my - 8);
  // R2 (middle vertical)
  ctx.fillText(`R2=${p.R2}Ω`, mx + lw * 0.5, my + lh * 0.5 - 8);
  // R3 (bottom-right)
  ctx.fillText(`R3=${p.R3}Ω`, mx + lw * 0.85, my + lh + 16);
  // R4 (right vertical)
  ctx.fillText(`R4=${p.R4}Ω`, mx + lw + 8, my + lh * 0.5);
  // V1, V2
  ctx.fillStyle = '#fde047'; ctx.font = 'bold 12px monospace';
  ctx.fillText(`V1=${p.V1}V`, mx + lw * 0.15, my + lh + 16);
  ctx.fillText(`V2=${p.V2}V`, mx + lw + 8, my + lh * 0.75);
  // Current labels
  ctx.fillStyle = '#22d3ee'; ctx.font = 'bold 12px monospace';
  ctx.fillText(`I1=${r.I1.toFixed(3)}A`, mx + lw * 0.15, my + 20);
  ctx.fillText(`I2=${r.I2.toFixed(3)}A`, mx + lw * 0.85, my + 20);
  ctx.fillText(`I_R2=${r.I_R2.toFixed(3)}A`, mx + lw * 0.5, my + lh * 0.5 + 20);
  // Current flow arrows
  const arrowDir = (I) => I >= 0 ? 1 : -1;
  ctx.fillStyle = 'rgba(34,211,238,0.6)';
  for (let i = 0; i < 3; i++) {
    const px = mx + lw * (0.3 + i * 0.2) + arrowDir(r.I1) * 8;
    ctx.beginPath(); ctx.moveTo(px, my); ctx.lineTo(px - arrowDir(r.I1) * 6, my - 4); ctx.lineTo(px - arrowDir(r.I1) * 6, my + 4); ctx.closePath(); ctx.fill();
  }
}
function computeStats(s, p) {
  const r = solve(p);
  const power = p.V1 * r.I1 + p.V2 * r.I2;
  return { 'I1 (loop1)': r.I1.toFixed(4) + ' A', 'I2 (loop2)': r.I2.toFixed(4) + ' A', 'I through R2': r.I_R2.toFixed(4) + ' A', 'Total power': power.toFixed(3) + ' W' };
}
export default function KirchhoffLaw() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ V1: 5, V2: 3, R1: 100, R2: 200, R3: 150, R4: 100 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats });
  return (
    <SimLayout title="Kirchhoff's Laws Solver" configName="kirchhoff" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="kirchhoff" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Two-loop circuit solved by KVL. Loop 1: V1→R1→R2. Loop 2: V2→R4→R2→R3. Adjust sources/resistors to see currents update in real time.</div>} />
  );
}