import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg, CanvasStage } from '../ui.jsx';
import { ResearchHeader, AIPanel, useAIExplain, Card } from '../research.jsx';

// Archimedes' principle: buoyant force = weight of displaced fluid.
// Block of density ρ_obj in fluid of density ρ_fluid. Floats if ρ_obj < ρ_fluid.
const schema = [
  { key: 'rhoObj', label: 'Object density (kg/m³)', min: 100, max: 3000, step: 10, type: 'range' },
  { key: 'rhoFluid', label: 'Fluid density (kg/m³)', min: 500, max: 14000, step: 10, type: 'range' },
  { key: 'size', label: 'Block size', min: 0.5, max: 2, step: 0.05, type: 'range' },
  { key: 'g', label: 'Gravity g', min: 1.6, max: 24.8, step: 0.1, type: 'range' },
];

function makeInitial() {
  return { y: 1.5, vy: 0, settled: false };
}

function step(s, dt, p) {
  // fraction submerged determines buoyancy
  const blockH = p.size * 0.3; // in normalized units (0..1 fluid depth)
  const fluidTop = 0.5; // fluid surface at y=0.5 in canvas coords (y down)
  const blockTop = s.y;
  const blockBot = s.y + blockH;
  let submerged = 0;
  if (blockBot > fluidTop) submerged = Math.min(blockH, blockBot - fluidTop);
  const fracSub = submerged / blockH;
  const buoyAcc = p.rhoFluid * fracSub * p.g / p.rhoObj;
  const netAcc = buoyAcc - p.g;
  s.vy += netAcc * dt * 0.5; // damped
  s.y += s.vy * dt;
  if (s.y < fluidTop - blockH) { s.y = fluidTop - blockH; s.vy = 0; }
  // settle on floor
  if (s.y + blockH > 1.0) { s.y = 1.0 - blockH; s.vy = 0; }
  s.vy *= 0.96; // drag
}

function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const fluidTop = h * 0.5;
  // sky
  ctx.fillStyle = 'rgba(30,40,60,0.4)'; ctx.fillRect(0, 0, w, fluidTop);
  // fluid
  const grad = ctx.createLinearGradient(0, fluidTop, 0, h);
  grad.addColorStop(0, 'rgba(34,211,238,0.4)');
  grad.addColorStop(1, 'rgba(20,80,160,0.6)');
  ctx.fillStyle = grad; ctx.fillRect(0, fluidTop, w, h - fluidTop);
  ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, fluidTop); ctx.lineTo(w, fluidTop); ctx.stroke();
  // block
  const bw = p.size * w * 0.12, bh = p.size * h * 0.18;
  const bx = w / 2 - bw / 2, by = s.y * h;
  const floats = p.rhoObj < p.rhoFluid;
  ctx.fillStyle = floats ? '#f59e0b' : '#ef4444';
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect(bx, by, bw, bh);
  // force arrows
  const cx = bx + bw / 2;
  // gravity (down)
  ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx, by + bh / 2); ctx.lineTo(cx, by + bh / 2 + 30); ctx.stroke();
  // arrowhead
  ctx.beginPath(); ctx.moveTo(cx, by + bh / 2 + 30); ctx.lineTo(cx - 4, by + bh / 2 + 24); ctx.lineTo(cx + 4, by + bh / 2 + 24); ctx.fill();
  // buoyancy (up)
  const blockBot = by + bh;
  const submerged = Math.max(0, Math.min(bh, blockBot - fluidTop));
  const frac = submerged / bh;
  ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2;
  const buoLen = 30 * frac * (p.rhoFluid / p.rhoObj);
  ctx.beginPath(); ctx.moveTo(cx, blockBot - bh / 2); ctx.lineTo(cx, blockBot - bh / 2 - buoLen); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx, blockBot - bh / 2 - buoLen); ctx.lineTo(cx - 4, blockBot - bh / 2 - buoLen + 6); ctx.lineTo(cx + 4, blockBot - bh / 2 - buoLen + 6); ctx.fill();
  // labels
  ctx.fillStyle = '#fff'; ctx.font = '11px monospace';
  ctx.fillText(`mg (red, down)`, cx + 10, by + bh / 2 + 20);
  ctx.fillText(`F_b (cyan, up)`, cx + 10, blockBot - bh / 2 - buoLen + 4);
}

function computeStats(s, p) {
  const blockH = p.size * 0.3;
  const submerged = Math.max(0, Math.min(blockH, (s.y + blockH) - 0.5));
  const frac = submerged / blockH;
  const floats = p.rhoObj < p.rhoFluid;
  return {
    'ρ_obj / ρ_fluid': (p.rhoObj / p.rhoFluid).toFixed(3),
    'Floats?': floats ? 'Yes' : 'No (sinks)',
    'Fraction submerged': frac.toFixed(3),
    'F_buoy (rel)': (p.rhoFluid * frac / p.rhoObj).toFixed(3),
    'F_gravity (rel)': '1.000',
    'Equilibrium': floats ? 'partially submerged' : 'on floor',
  };
}

export default function BuoyancySim() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ rhoObj: 600, rhoFluid: 1000, size: 1, g: 9.81 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats, resetKey: `${params.rhoObj}-${params.rhoFluid}-${params.size}` });
  const { explain, explaining, output } = useAIExplain();
  return (
    <div className="space-y-3">
      <ResearchHeader title="Buoyancy — Archimedes' Principle" subtitle="Buoyant force equals the weight of displaced fluid. Object floats when ρ_obj < ρ_fluid; fraction submerged = ρ_obj/ρ_fluid." onExplain={() => explain(`Buoyancy: ρ_obj=${params.rhoObj}, ρ_fluid=${params.rhoFluid}. ${sim.stats}`)} explaining={explaining} />
      <SimLayout title="Buoyancy" configName="buoyancy" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
        controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
        stats={<StatGrid stats={sim.stats} />}
        exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="buoyancy" />}
        extra={<Card><p className="text-xs text-muted-foreground">Orange block floats (ρ_obj &lt; ρ_fluid); red block sinks. Cyan arrow = buoyancy (up), red = gravity (down). At equilibrium, fraction submerged = ρ_obj / ρ_fluid.</p></Card>} />
      <AIPanel output={output} />
    </div>
  );
}