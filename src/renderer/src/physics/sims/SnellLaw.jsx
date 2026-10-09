import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, LiveGraph, stageBg } from '../ui.jsx';

const schema = [
  { key: 'n1', label: 'Index n1', min: 1, max: 2.5, step: 0.05, type: 'range' },
  { key: 'n2', label: 'Index n2', min: 1, max: 2.5, step: 0.05, type: 'range' },
];
function makeInitial() { return {}; }
function step() {}
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const cx = w / 2, cy = h / 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(40, cy); ctx.lineTo(w - 40, cy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(40, 40); ctx.lineTo(40, h - 40); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '10px monospace'; ctx.textAlign = 'center';
  ctx.fillText('sin theta1', w - 50, cy + 15); ctx.fillText('sin theta2', 30, 50);
  const slope = p.n1 / p.n2;
  ctx.strokeStyle = '#a855f7'; ctx.lineWidth = 2.5;
  ctx.beginPath();
  const plotW = w - 80, plotH = h - 80;
  for (let i = 0; i <= 100; i++) {
    const sin1 = i / 100;
    const sin2 = Math.min(1, slope * sin1);
    const px = 40 + sin1 * plotW, py = cy + plotH / 2 - sin2 * plotH / 2;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();
  if (p.n1 > p.n2) {
    const tirStart = p.n2 / p.n1;
    ctx.fillStyle = 'rgba(239,68,68,0.15)'; ctx.fillRect(40 + tirStart * plotW, 40, plotW - tirStart * plotW, h - 80);
    ctx.fillStyle = '#ef4444'; ctx.font = '10px monospace'; ctx.textAlign = 'left';
    ctx.fillText('TIR', 40 + tirStart * plotW + 5, 55);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(40, cy + plotH / 2); ctx.lineTo(40 + plotW, cy - plotH / 2); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '10px monospace'; ctx.textAlign = 'left';
  ctx.fillText('slope = n1/n2 = ' + slope.toFixed(3), 50, 30);
  if (p.n1 > p.n2) { const tc = Math.asin(p.n2 / p.n1) * 180 / Math.PI; ctx.fillText('Critical angle = ' + tc.toFixed(1) + ' deg', 50, 46); }
}
function computeStats(s, p) {
  const slope = p.n1 / p.n2;
  const critical = p.n1 > p.n2 ? Math.asin(p.n2 / p.n1) * 180 / Math.PI : null;
  return { 'n1/n2': slope.toFixed(3), 'Critical': critical ? critical.toFixed(1) + ' deg' : 'none', 'TIR': p.n1 > p.n2 ? 'yes' : 'no', 'Plot': 'sin1 vs sin2' };
}
export default function SnellLaw() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ n1: 1.5, n2: 1.0 });
  const graphData = [];
  for (let i = 0; i <= 100; i++) { const sin1 = i / 100; const sin2 = Math.min(1, params.n1 / params.n2 * sin1); graphData.push({ sin1: +sin1.toFixed(2), sin2: +sin2.toFixed(3) }); }
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats });
  return (
    <SimLayout title="Snell's Law Plot" configName="snell-law" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<TransportBar playing={sim.playing} onToggle={() => sim.setPlaying(!sim.playing)} onStep={sim.stepOnce} onReset={sim.reset} speed={sim.speed} onSpeed={sim.setSpeed} t={sim.t} />}
      stats={<StatGrid stats={sim.stats} />}
      graph={<div><div className="text-xs text-muted-foreground mb-1">sin(theta1) vs sin(theta2) - straight line, slope = n1/n2</div><LiveGraph data={graphData} series={[{ key: 'sin2', color: '#a855f7' }]} xKey="sin1" height={150} /></div>}
      exportBar={<ExportBar graphData={graphData} config={params} canvasRef={canvasRef} name="snell-law" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Snell's law: n1 sin(theta1) = n2 sin(theta2). Plotting sin vs sin gives a straight line with slope n1/n2. When n1 greater than n2, past the critical angle the line hits sin = 1 and TIR begins (red region).</div>} />
  );
}