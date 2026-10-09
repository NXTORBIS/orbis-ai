import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, LiveGraph, stageBg } from '../ui.jsx';

const schema = [
  { key: 'Vp', label: 'Primary voltage Vp (V)', min: 1, max: 24, step: 0.5, type: 'range' },
  { key: 'Np', label: 'Primary turns Np', min: 10, max: 200, step: 5, type: 'range' },
  { key: 'Ns', label: 'Secondary turns Ns', min: 5, max: 400, step: 5, type: 'range' },
  { key: 'freq', label: 'Frequency (Hz)', min: 10, max: 200, step: 5, type: 'range' },
];
function makeInitial() { return { phase: 0 }; }
function step(s, dt, p) { s.phase += 2 * Math.PI * p.freq * dt; }
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const cx = w / 2, cy = h / 2;
  ctx.fillStyle = 'rgba(120,120,140,0.3)'; ctx.strokeStyle = 'rgba(180,180,200,0.5)'; ctx.lineWidth = 1;
  ctx.fillRect(cx - 15, cy - 60, 30, 120); ctx.strokeRect(cx - 15, cy - 60, 30, 120);
  ctx.fillRect(cx - 60, cy - 60, 120, 15); ctx.strokeRect(cx - 60, cy - 60, 120, 15);
  ctx.fillRect(cx - 60, cy + 45, 120, 15); ctx.strokeRect(cx - 60, cy + 45, 120, 15);
  ctx.strokeStyle = '#f97316'; ctx.lineWidth = 2;
  for (let i = 0; i < Math.min(p.Np / 5, 12); i++) {
    ctx.beginPath(); ctx.ellipse(cx - 40, cy - 45 + i * 8, 18, 4, 0, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2;
  for (let i = 0; i < Math.min(p.Ns / 5, 12); i++) {
    ctx.beginPath(); ctx.ellipse(cx + 40, cy - 45 + i * 8, 18, 4, 0, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.strokeStyle = '#fde047'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(cx - 90, cy, 12, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx - 90, cy, 6, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#f97316'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
  ctx.fillText('Np=' + p.Np, cx - 40, cy - 70);
  ctx.fillStyle = '#22d3ee'; ctx.fillText('Ns=' + p.Ns, cx + 40, cy - 70);
  const Vs = p.Vp * p.Ns / p.Np;
  ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '10px monospace'; ctx.textAlign = 'left';
  ctx.fillText('Vp = ' + p.Vp + ' V  ->  Vs = ' + Vs.toFixed(1) + ' V', 12, h - 16);
  ctx.fillText('Turns ratio: ' + p.Ns + '/' + p.Np + ' = ' + (p.Ns / p.Np).toFixed(2), 12, h - 32);
}
function sample(s, p, t) {
  const Vp_inst = p.Vp * Math.sin(s.phase);
  const Vs_inst = Vp_inst * p.Ns / p.Np;
  return { t: +t.toFixed(3), Vp: +Vp_inst.toFixed(3), Vs: +Vs_inst.toFixed(3) };
}
function computeStats(s, p) {
  const ratio = p.Ns / p.Np;
  const Vs = p.Vp * ratio;
  return { 'Turns ratio': ratio.toFixed(3), 'Vp': p.Vp.toFixed(1) + ' V', 'Vs': Vs.toFixed(1) + ' V', 'Ip/Is': ratio.toFixed(3) };
}
export default function TransformerSim() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ Vp: 12, Np: 100, Ns: 50, freq: 50 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, sample, computeStats });
  return (
    <SimLayout title="Transformer Simulator" configName="transformer" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      graph={<div><div className="text-xs text-muted-foreground mb-1">Primary (orange) and Secondary (cyan) voltage</div><LiveGraph data={sim.graphData} series={[{ key: 'Vp', color: '#f97316' }, { key: 'Vs', color: '#22d3ee' }]} height={150} /></div>}
      exportBar={<ExportBar graphData={sim.graphData} config={params} canvasRef={canvasRef} name="transformer" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Vs/Vp = Ns/Np. Step-up (Ns greater than Np) or step-down (Ns less than Np). Power conserved: Vp times Ip = Vs times Is. The iron core couples flux between coils.</div>} />
  );
}