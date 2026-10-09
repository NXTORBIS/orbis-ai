import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Brain, Play, RotateCcw } from 'lucide-react';
import LabShell from '../parts/LabShell.jsx';

// Linear regression with gradient descent — train on a scatter plot, watch the line fit.
const SAMPLE_DATA = [
  [1, 2], [2, 4], [3, 5], [4, 8], [5, 9], [6, 12], [7, 14], [8, 15], [9, 18], [10, 20],
];

export default function AILab() {
  const [data, setData] = useState(SAMPLE_DATA);
  const [lr, setLr] = useState(0.01);
  const [epochs, setEpochs] = useState(100);
  const [w, setW] = useState(0);
  const [b, setB] = useState(0);
  const [loss, setLoss] = useState(0);
  const [running, setRunning] = useState(false);
  const [points, setPoints] = useState([]);
  const canvasRef = useRef(null);

  const train = () => {
    setRunning(true);
    let cw = w, cb = b;
    const n = data.length;
    for (let e = 0; e < epochs; e++) {
      let dw = 0, db = 0, l = 0;
      for (const [x, y] of data) {
        const pred = cw * x + cb;
        const err = pred - y;
        dw += (2 / n) * err * x;
        db += (2 / n) * err;
        l += err * err;
      }
      cw -= lr * dw;
      cb -= lr * db;
    }
    setW(cw); setB(cb); setLoss(data.reduce((s, [x, y]) => s + (cw * x + cb - y) ** 2, 0) / n);
    setRunning(false);
  };

  const reset = () => { setW(0); setB(0); setLoss(0); };

  const predict = (x) => w * x + b;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    // grid
    ctx.strokeStyle = 'hsl(222 20% 20%)'; ctx.lineWidth = 0.5;
    for (let i = 0; i <= 10; i++) { ctx.beginPath(); ctx.moveTo((i / 10) * W, 0); ctx.lineTo((i / 10) * W, H); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, (i / 10) * H); ctx.lineTo(W, (i / 10) * H); ctx.stroke(); }
    // data points
    ctx.fillStyle = 'hsl(189 100% 50%)';
    data.forEach(([x, y]) => {
      const px = (x / 22) * W, py = H - (y / 22) * H;
      ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill();
    });
    // regression line
    if (w || b) {
      ctx.strokeStyle = 'hsl(38 100% 50%)'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, H - (predict(0) / 22) * H);
      ctx.lineTo(W, H - (predict(22) / 22) * H);
      ctx.stroke();
    }
  }, [data, w, b]);

  const addPoint = (e) => {
    const rect = e.target.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 22;
    const y = 22 - ((e.clientY - rect.top) / rect.height) * 22;
    setData((d) => [...d, [Math.round(x * 10) / 10, Math.round(y * 10) / 10]]);
  };

  return (
    <LabShell icon={Brain} title="AI & Machine Learning" description="Linear regression with gradient descent — click to add data points, train, and watch the line fit.">
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="rounded-lg border border-border bg-card p-4">
          <canvas ref={canvasRef} width={500} height={400} onClick={addPoint} className="w-full cursor-crosshair rounded" />
          <div className="mt-2 text-[10px] text-muted-foreground">Click on the plot to add data points.</div>
        </div>
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="mb-2 text-xs font-semibold">Hyperparameters</div>
            <label className="block text-[10px] text-muted-foreground">Learning rate: <span className="font-mono-j text-cyan-j">{lr}</span></label>
            <input type="range" min="0.001" max="0.1" step="0.001" value={lr} onChange={(e) => setLr(+e.target.value)} className="w-full" />
            <label className="mt-2 block text-[10px] text-muted-foreground">Epochs: <span className="font-mono-j text-cyan-j">{epochs}</span></label>
            <input type="range" min="10" max="1000" step="10" value={epochs} onChange={(e) => setEpochs(+e.target.value)} className="w-full" />
          </div>
          <div className="flex gap-2">
            <button onClick={train} disabled={running} className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-cyan-j px-3 py-1.5 text-xs font-semibold text-background hover:bg-cyan-j/90 disabled:opacity-50"><Play className="size-3.5" /> Train</button>
            <button onClick={reset} aria-label="Start again" title="Start again" className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs hover:border-cyan-j/40"><RotateCcw className="size-3.5" /></button>
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="text-[10px] font-semibold text-muted-foreground">MODEL</div>
            <div className="mt-1 font-mono-j text-sm">y = <span className="text-cyan-j">{w.toFixed(3)}</span>x + <span className="text-cyan-j">{b.toFixed(3)}</span></div>
            <div className="mt-2 text-xs">Loss (MSE): <span className="font-mono-j font-bold text-amber-400">{loss.toFixed(4)}</span></div>
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="text-[10px] font-semibold text-muted-foreground">PREDICT</div>
            <PredictLine predict={predict} />
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="text-[10px] font-semibold text-muted-foreground">DATA ({data.length} points)</div>
            <button onClick={() => setData(SAMPLE_DATA)} className="mt-1 text-[11px] text-cyan-j hover:underline">Reset to sample</button>
            <button onClick={() => setData([])} className="ml-2 text-[11px] text-red-400 hover:underline">Clear all</button>
          </div>
        </div>
      </div>
    </LabShell>
  );
}

function PredictLine({ predict }) {
  const [x, setX] = useState(5);
  return (
    <div className="mt-1 flex items-center gap-2">
      <input type="number" value={x} onChange={(e) => setX(+e.target.value)} className="w-16 rounded border border-border bg-background px-2 py-1 font-mono-j text-xs" />
      <span className="text-xs text-muted-foreground">→</span>
      <span className="font-mono-j text-sm font-bold text-cyan-j">{predict(x).toFixed(2)}</span>
    </div>
  );
}