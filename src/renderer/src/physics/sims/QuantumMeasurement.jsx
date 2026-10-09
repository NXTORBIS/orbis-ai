// Quantum Measurement — repeated measurements of a superposition state
// demonstrate the Born rule: outcomes occur with probability |cₙ|², and
// measurement collapses the state. Shows a histogram of outcomes converging.
import React, { useRef, useState } from 'react';
import { useSim } from '../useSim.js';
import { TransportBar, StatGrid, ExportBar, SimLayout, stageBg } from '../ui.jsx';
import { Button } from '../ui/button.jsx';

const schema = [
  { key: 'c1', label: 'Amplitude c₁ (n=1)', min: 0, max: 1, step: 0.05, type: 'range' },
  { key: 'c2', label: 'Amplitude c₂ (n=2)', min: 0, max: 1, step: 0.05, type: 'range' },
  { key: 'c3', label: 'Amplitude c₃ (n=3)', min: 0, max: 1, step: 0.05, type: 'range' },
];

function makeInitial(p) { return { outcomes: [0, 0, 0], lastResult: null, collapsed: null, total: 0 }; }
function step() {}
function measure(p) { let norm = 0; for (let n = 1; n <= 3; n++) norm += (p['c' + n] || 0) ** 2; norm = Math.sqrt(norm) || 1; const r = Math.random(); let cum = 0; for (let n = 1; n <= 3; n++) { cum += ((p['c' + n] || 0) / norm) ** 2; if (r < cum) return n; } return 3; }
function draw(ctx, s, p, w, h) {
  stageBg(ctx, w, h);
  const padX = 40, padY = 30; const W = w - 2 * padX, H = h - 2 * padY; const baseY = padY + H;
  let norm = 0; for (let n = 1; n <= 3; n++) norm += (p['c' + n] || 0) ** 2; norm = Math.sqrt(norm) || 1;
  // theoretical probabilities
  const probs = [0, 0, 0]; for (let n = 1; n <= 3; n++) probs[n - 1] = ((p['c' + n] || 0) / norm) ** 2;
  // histogram
  const maxC = Math.max(...s.outcomes, s.total * Math.max(...probs), 1); const bw = W / 3;
  for (let n = 0; n < 3; n++) {
    const bh = (s.outcomes[n] / maxC) * H * 0.75;
    ctx.fillStyle = s.lastResult === n + 1 ? '#f43f5e' : '#22d3ee'; ctx.fillRect(padX + n * bw + 8, baseY - bh, bw - 16, bh);
    // theoretical line
    const thY = baseY - (s.total * probs[n] / maxC) * H * 0.75;
    ctx.strokeStyle = '#f97316'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(padX + n * bw + 4, thY); ctx.lineTo(padX + (n + 1) * bw - 4, thY); ctx.stroke();
    ctx.fillStyle = 'hsl(var(--muted-foreground))'; ctx.font = '11px monospace'; ctx.textAlign = 'center'; ctx.fillText(`n=${n + 1}`, padX + n * bw + bw / 2, baseY + 16); ctx.textAlign = 'left';
    ctx.fillText(`${s.outcomes[n]}`, padX + n * bw + bw / 2 - 10, baseY - bh - 4);
  }
  ctx.fillStyle = '#f97316'; ctx.font = '10px monospace'; ctx.fillText('— theoretical |cₙ|²', padX + W - 100, padY + 14);
  if (s.lastResult) { ctx.fillStyle = '#f43f5e'; ctx.font = 'bold 13px monospace'; ctx.textAlign = 'center'; ctx.fillText(`Last: n=${s.lastResult}`, padX + W / 2, padY + 14); ctx.textAlign = 'left'; }
}
function computeStats(s, p) { let norm = 0; for (let n = 1; n <= 3; n++) norm += (p['c' + n] || 0) ** 2; norm = Math.sqrt(norm) || 1; return { 'Total': s.total, 'P(n=1)': (((p.c1 || 0) / norm) ** 2).toFixed(3), 'P(n=2)': (((p.c2 || 0) / norm) ** 2).toFixed(3), 'P(n=3)': (((p.c3 || 0) / norm) ** 2).toFixed(3), 'Last': s.lastResult || '—' }; }

export default function QuantumMeasurement() {
  const canvasRef = useRef(null);
  const [params, setParams] = useState({ c1: 0.6, c2: 0.8, c3: 0 });
  const sim = useSim({ canvasRef, params, step, makeInitial, draw, computeStats, resetKey: `${params.c1}|${params.c2}|${params.c3}` });
  const doMeasure = () => { const r = measure(params); const st = sim.stateRef.current; st.outcomes[r - 1]++; st.total++; st.lastResult = r; if (sim.statsFnRef?.current) { /* force redraw */ } };
  const batchMeasure = () => { const st = sim.stateRef.current; for (let i = 0; i < 100; i++) { const r = measure(params); st.outcomes[r - 1]++; st.total++; } st.lastResult = null; };
  return (
    <SimLayout title="Quantum Measurement (Born Rule)" configName="quantum-measurement" canvasRef={canvasRef} params={params} schema={schema} setParams={setParams}
      controls={<div className="flex items-center gap-2 flex-wrap rounded-xl border border-border/60 bg-card/40 px-3 py-2"><Button size="sm" onClick={doMeasure}>Measure once</Button><Button size="sm" variant="outline" onClick={batchMeasure}>Measure 100×</Button><Button size="sm" variant="outline" onClick={() => { const st = sim.stateRef.current; st.outcomes = [0, 0, 0]; st.total = 0; st.lastResult = null; }}>Reset stats</Button><span className="text-xs text-muted-foreground ml-auto font-mono">N = {sim.stateRef.current?.total || 0}</span></div>}
      stats={<StatGrid stats={sim.stats} />}
      exportBar={<ExportBar graphData={[]} config={params} canvasRef={canvasRef} name="quantum-measurement" />}
      extra={<div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Measurement collapses the superposition to one eigenstate. The Born rule: outcome n occurs with probability |cₙ|². The histogram (cyan) converges to the theoretical probabilities (orange lines) over many measurements. Each measurement is random and irreversible.</div>} />
  );
}