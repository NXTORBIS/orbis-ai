// Thermal Expansion — linear & volumetric expansion of a solid rod.
// ΔL = α L₀ ΔT. The rod grows as temperature rises; a live ΔL(T) plot
// shows the linear relationship and the expansion coefficient α.
import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';

const schema = [
  { key: 'alpha', label: 'α (×10⁻⁶ /K)', min: 1, max: 100, step: 1, type: 'range' },
  { key: 'T', label: 'Temperature (°C)', min: -50, max: 500, step: 5, type: 'range' },
  { key: 'Tref', label: 'Reference T₀ (°C)', min: -50, max: 100, step: 5, type: 'range' },
];

function makeInitial(p) { return { t: 0, samples: [] }; }
function step(s, dt, p) { s.t += dt; if (Math.floor(s.t * 5) % 2 === 0) { s.samples.push({ T: p.T, dL: p.alpha * 1e-6 * 100 * (p.T - p.Tref) }); if (s.samples.length > 80) s.samples.shift(); } }
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const a = p.alpha * 1e-6; const L0 = 100; const dL = a * L0 * (p.T - p.Tref); const L = L0 + dL;
  // rod
  const rodY = h * 0.35, rodH = 40; const scaleX = (w - 80) / 200;
  const rodX = 40, rodW = L * scaleX;
  // reference outline
  ctx.strokeStyle = 'hsl(var(--muted-foreground))'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.strokeRect(rodX, rodY, L0 * scaleX, rodH); ctx.setLineDash([]);
  // expanded rod — colour by temperature
  const hue = Math.max(0, 240 - (p.T + 50) * 0.4);
  ctx.fillStyle = `hsl(${hue} 85% 55%)`; ctx.fillRect(rodX, rodY, rodW, rodH);
  ctx.strokeStyle = 'white'; ctx.lineWidth = 1; ctx.strokeRect(rodX, rodY, rodW, rodH);
  // ruler marks
  ctx.fillStyle = 'hsl(var(--muted-foreground))'; ctx.font = '10px monospace';
  for (let i = 0; i <= 10; i++) { const tx = rodX + (i / 10) * L0 * scaleX; ctx.fillRect(tx, rodY + rodH + 2, 1, 5); ctx.fillText(`${i * 10}`, tx - 6, rodY + rodH + 18); }
  // expansion indicator
  ctx.strokeStyle = '#f43f5e'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(rodX + L0 * scaleX, rodY - 14); ctx.lineTo(rodX + rodW, rodY - 14); ctx.stroke();
  ctx.fillStyle = '#f43f5e'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center'; ctx.fillText(`ΔL = ${dL.toFixed(2)}`, rodX + (L0 * scaleX + rodW) / 2, rodY - 18); ctx.textAlign = 'left';
  // ΔL vs T plot
  const pX = 16, pY = h - 100, pW = w - 32, pH = 80;
  ctx.strokeStyle = 'hsl(var(--border))'; ctx.strokeRect(pX, pY, pW, pH);
  const Tmin = -50, Tmax = 500, dLmax = p.alpha * 1e-6 * 100 * (Tmax - p.Tref), dLmin = p.alpha * 1e-6 * 100 * (Tmin - p.Tref);
  const X = (T) => pX + ((T - Tmin) / (Tmax - Tmin)) * pW;
  const Y = (d) => pY + pH - ((d - dLmin) / (dLmax - dLmin + 1e-9)) * pH;
  ctx.strokeStyle = '#f97316'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(X(Tmin), Y(dLmin)); ctx.lineTo(X(Tmax), Y(dLmax)); ctx.stroke();
  ctx.fillStyle = '#22d3ee'; ctx.beginPath(); ctx.arc(X(p.T), Y(dL), 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'hsl(var(--muted-foreground))'; ctx.font = '10px monospace'; ctx.fillText('T (°C) →', pX + pW - 50, pY + pH + 14); ctx.fillText('ΔL ↑', pX, pY - 4);
}
function computeStats(s, p) { const a = p.alpha * 1e-6; const dL = a * 100 * (p.T - p.Tref); const strain = a * (p.T - p.Tref); return { 'α': `${p.alpha}e-6/K`, 'ΔT': (p.T - p.Tref).toFixed(0), 'ΔL': dL.toFixed(3), 'ε (strain)': strain.toExponential(3), 'L/L₀': (1 + strain).toFixed(5) }; }

export default function ThermalExpansion() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ alpha: 23, T: 200, Tref: 20 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats, resetKey: `${params.alpha}|${params.T}|${params.Tref}` });
  return (
    <SimLayout title="Thermal Expansion (Linear)" configName="thermal-expansion" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="thermal-expansion" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Linear expansion: ΔL = α L₀ ΔT. The dashed outline is L₀ at T₀; the filled rod grows with T. The red arrow shows ΔL. The plot tracks ΔL(T) along the theoretical line.</div>} />
  );
}