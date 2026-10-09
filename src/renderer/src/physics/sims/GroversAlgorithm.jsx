// Grover's Algorithm — dedicated simulator with iteration visualization.
// Searches an unsorted database of N items in √N queries. Shows the
// amplitude amplification iteration-by-iteration.
import React, { useState, useEffect, useRef } from 'react';
import { CanvasStage, stageBg } from '../ui.jsx';
import { QState, GATES, applySingle, applyDiagonal, probs } from '../lib/qsim.js';
import { ResearchHeader, Card } from '../research.jsx';
import { Button } from '../ui/button.jsx';

const N = 8;

export default function GroversAlgorithm() {
  const canvasRef = useRef(null);
  const [marked, setMarked] = useState(5);
  const [iters, setIters] = useState(2);
  const [ampHistory, setAmpHistory] = useState([]);

  const runIteration = (k) => {
    const st = new QState(3);
    [0, 1, 2].forEach((q) => applySingle(st, q, GATES.H));
    for (let i = 0; i < k; i++) {
      applyDiagonal(st, (idx) => idx === marked ? [-1, 0] : [1, 0]);
      [0, 1, 2].forEach((q) => applySingle(st, q, GATES.H));
      applyDiagonal(st, (idx) => idx === 0 ? [1, 0] : [-1, 0]);
      [0, 1, 2].forEach((q) => applySingle(st, q, GATES.H));
    }
    return probs(st);
  };

  const run = () => {
    const history = [];
    for (let k = 0; k <= Math.min(iters, 5); k++) history.push({ k, probs: runIteration(k) });
    setAmpHistory(history);
  };
  useEffect(() => { run(); }, [marked, iters]);

  useEffect(() => {
    const cv = canvasRef.current; if (!cv || !ampHistory.length) return;
    const ctx = cv.getContext('2d'); const w = cv.width, h = cv.height; stageBg(ctx, w, h);
    const padX = 40, padY = 24; const W = w - 2 * padX, H = h - 2 * padY;
    const barW = W / N;
    const last = ampHistory[ampHistory.length - 1];
    for (let i = 0; i < N; i++) { const bh = last.probs[i] * H * 0.85; ctx.fillStyle = i === marked ? '#f43f5e' : '#22d3ee'; ctx.fillRect(padX + i * barW + 2, h - padY - bh, barW - 4, bh); ctx.fillStyle = 'hsl(var(--muted-foreground))'; ctx.font = '9px monospace'; ctx.textAlign = 'center'; ctx.fillText(i.toString(2).padStart(3, '0'), padX + i * barW + barW / 2, h - 6); }
    ctx.textAlign = 'left';
  }, [ampHistory, marked]);

  const optimal = Math.round(Math.PI / 4 * Math.sqrt(N));
  const final = ampHistory[ampHistory.length - 1];
  const successProb = final ? final.probs[marked] : 0;

  return (
    <div className="space-y-4">
      <ResearchHeader title="Grover's Algorithm (√N Search)" subtitle="Search an unsorted database of N=8 items in √N ≈ 2.2 queries. Watch amplitude amplification boost the marked state." />
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-muted-foreground">Marked state:</label>
        <select value={marked} onChange={(e) => setMarked(+e.target.value)} className="rounded-md border border-input bg-transparent px-2 py-1 text-sm">{Array.from({ length: 8 }, (_, i) => <option key={i} value={i} className="bg-background">|{i.toString(2).padStart(3, '0')}⟩</option>)}</select>
        <label className="text-xs text-muted-foreground ml-2">Iterations:</label>
        <input type="range" min={0} max={5} step={1} value={iters} onChange={(e) => setIters(+e.target.value)} className="w-32 accent-cyan-500" />
        <span className="font-mono text-xs">{iters}</span>
        <Button size="sm" onClick={run}>Run</Button>
      </div>
      <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden" style={{ height: 200 }}><CanvasStage ref={canvasRef} /></div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Amplification progress">
          <div className="space-y-1 text-xs font-mono">
            {ampHistory.map((h) => <div key={h.k} className="flex justify-between"><span className="text-muted-foreground">iter {h.k}:</span><span>P(marked)={(h.probs[marked] * 100).toFixed(1)}%</span></div>)}
          </div>
        </Card>
        <Card title="Result">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Optimal iterations:</span><span className="font-mono">⌊π/4·√8⌉ = {optimal}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Success probability:</span><span className="font-mono text-cyan-j">{(successProb * 100).toFixed(1)}%</span></div>
            <p className="mt-2 text-xs text-muted-foreground">Each iteration: oracle (flip marked) + diffusion (inversion about the mean). After ~√N iterations the marked state's amplitude peaks. Over-iterating causes it to decrease again.</p>
          </div>
        </Card>
      </div>
    </div>
  );
}