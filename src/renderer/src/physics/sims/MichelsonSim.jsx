import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, LiveGraph, stageBg } from '../ui.jsx';

const schema = [
  { key: 'armDelta', label: 'Arm length diff ΔL (µm)', min: 0, max: 5, step: 0.01, type: 'range' },
  { key: 'wavelength', label: 'Wavelength λ (nm)', min: 400, max: 700, step: 10, type: 'range' },
];
function makeInitial() { return { t: 0 }; }
function step(s, dt) { s.t += dt; }
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const cx = w * 0.3, cy = h / 2;
  const armLen = w * 0.35, armDelta = p.armDelta * 1e-6, lambda = p.wavelength * 1e-9;
  // Beam splitter
  ctx.strokeStyle = '#a855f7'; ctx.lineWidth = 2; ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.PI / 4);
  ctx.strokeRect(-20, -3, 40, 6); ctx.restore();
  ctx.fillStyle = '#a855f7'; ctx.font = '9px monospace'; ctx.textAlign = 'center'; ctx.fillText('BS', cx, cy - 28);
  // Source
  ctx.fillStyle = '#fde047'; ctx.fillRect(cx - armLen - 30, cy - 8, 20, 16);
  ctx.fillText('Source', cx - armLen - 20, cy + 25);
  // Input beam
  ctx.strokeStyle = `rgba(253,224,71,0.6)`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(cx - armLen - 10, cy); ctx.lineTo(cx, cy); ctx.stroke();
  // Arm 1 (horizontal)
  const m1x = cx + armLen, m1y = cy;
  ctx.strokeStyle = `rgba(253,224,71,0.5)`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(m1x, m1y); ctx.stroke();
  // Mirror 1
  ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(m1x, m1y - 15); ctx.lineTo(m1x, m1y + 15); ctx.stroke();
  ctx.fillStyle = '#22d3ee'; ctx.font = '9px monospace'; ctx.textAlign = 'center'; ctx.fillText('M1', m1x, m1y + 30);
  // Arm 2 (vertical, with delta)
  const m2x = cx, m2y = cy - armLen - armDelta * 1e6 * 0.1;
  ctx.strokeStyle = `rgba(253,224,71,0.5)`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(m2x, m2y); ctx.stroke();
  ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(m2x - 15, m2y); ctx.lineTo(m2x + 15, m2y); ctx.stroke();
  ctx.fillText('M2', m2x + 25, m2y);
  // Detector
  ctx.fillStyle = '#f97316'; ctx.fillRect(cx - 8, cy + armLen * 0.6, 16, 20);
  ctx.fillText('Detector', cx, cy + armLen * 0.6 + 35);
  ctx.strokeStyle = `rgba(253,224,71,0.4)`; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + armLen * 0.6); ctx.stroke();
  // Fringes
  const phaseDiff = 2 * 2 * Math.PI * armDelta / lambda;
  const intensity = (1 + Math.cos(phaseDiff)) / 2;
  ctx.fillStyle = `rgba(253,224,71,${intensity})`; ctx.fillRect(cx - 8, cy + armLen * 0.6, 16, 20);
  // Info
  ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '10px monospace'; ctx.textAlign = 'left';
  ctx.fillText(`ΔL = ${p.armDelta.toFixed(2)} µm, λ = ${p.wavelength} nm`, 12, h - 16);
  const fringeShift = 2 * armDelta / lambda * 1e6;
  ctx.fillText(`Fringe shift = 2ΔL/λ = ${fringeShift.toFixed(2)} fringes`, 12, h - 32);
}
function sample(s, p, t) { const phaseDiff = 2 * 2 * Math.PI * (p.armDelta * 1e-6) / (p.wavelength * 1e-9); return { t: +t.toFixed(3), I: +((1 + Math.cos(phaseDiff)) / 2).toFixed(4) }; }
function computeStats(s, p) { const fringeShift = 2 * p.armDelta * 1e-6 / (p.wavelength * 1e-9); return { 'ΔL': p.armDelta.toFixed(2) + ' µm', 'λ': p.wavelength + ' nm', 'Fringe shift': fringeShift.toFixed(2), 'Phase': (2 * 2 * Math.PI * p.armDelta * 1e-6 / (p.wavelength * 1e-9) % (2 * Math.PI)).toFixed(2) + ' rad' }; }
export default function MichelsonSim() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ armDelta: 0, wavelength: 550 });
  const graphData = [];
  for (let d = 0; d <= 5; d += 0.02) { const phase = 2 * 2 * Math.PI * d * 1e-6 / (params.wavelength * 1e-9); graphData.push({ delta: +d.toFixed(2), I: +((1 + Math.cos(phase)) / 2).toFixed(4) }); }
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, sample, computeStats });
  return (
    <SimLayout title="Michelson Interferometer" configName="michelson" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      graph={<div><div className="text-xs text-muted-foreground mb-1">Detector intensity vs arm difference (fringes)</div><LiveGraph data={graphData} series={[{ key: 'I', color: '#fde047' }]} xKey="delta" height={150} /></div>}
      exportBar={<ExportBar graphData={graphData} config={params} canvasRef={canvasRef} name="michelson" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Beam splitter divides light into two arms; mirrors reflect it back; recombination produces interference. Moving one mirror by λ/2 shifts one fringe. Δm = 2ΔL/λ. LIGO uses this to detect gravitational waves.</div>} />
  );
}