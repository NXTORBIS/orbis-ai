// Numerical Optimisation — gradient descent, Newton, on Rosenbrock & quadratics
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { CanvasStage, stageBg } from '../ui.jsx';
import { ResearchHeader, Card, NumField, SciTable, AIPanel, useAIExplain } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';

const FUNCS = {
  'Rosenbrock': {
    f: (x, y) => (1 - x) ** 2 + 100 * (y - x * x) ** 2,
    grad: (x, y) => [-2 * (1 - x) - 400 * x * (y - x * x), 200 * (y - x * x)],
    hess: (x, y) => [[2 + 1200 * x * x - 400 * y, -400 * x], [-400 * x, 200]],
    min: [1, 1], start: [-1.5, 1.5],
    range: [-2, 2, -1, 3],
  },
  'Quadratic bowl': {
    f: (x, y) => 0.5 * (x * x + 10 * y * y),
    grad: (x, y) => [x, 10 * y],
    hess: (x, y) => [[1, 0], [0, 10]],
    min: [0, 0], start: [2, 2],
    range: [-3, 3, -3, 3],
  },
  'Booth': {
    f: (x, y) => (x + 2 * y - 7) ** 2 + (2 * x + y - 5) ** 2,
    grad: (x, y) => [2 * (x + 2 * y - 7) + 4 * (2 * x + y - 5), 4 * (x + 2 * y - 7) + 2 * (2 * x + y - 5)],
    hess: (x, y) => [[10, 8], [8, 10]],
    min: [1, 3], start: [3, -2],
    range: [-4, 4, -4, 4],
  },
};

function solve2x2(A, b) { const det = A[0][0] * A[1][1] - A[0][1] * A[1][0]; return [(A[1][1] * b[0] - A[0][1] * b[1]) / det, (A[0][0] * b[1] - A[1][0] * b[0]) / det]; }

export default function NumericalOptimizationSim() {
  const [funcKey, setFuncKey] = useState('Rosenbrock');
  const [method, setMethod] = useState('gd');
  const [lr, setLr] = useState(0.001);
  const [nIters, setNIters] = useState(200);
  const canvasRef = useRef(null);
  const { explain, explaining, output } = useAIExplain();
  const fn = FUNCS[funcKey];

  const { trajectory, convergence, finalVal, finalPoint } = useMemo(() => {
    let [x, y] = fn.start;
    const traj = [{ x, y, f: fn.f(x, y) }];
    const conv = [{ i: 0, f: fn.f(x, y) }];
    for (let i = 0; i < nIters; i++) {
      const [gx, gy] = fn.grad(x, y);
      if (method === 'gd') { x -= lr * gx; y -= lr * gy; }
      else if (method === 'momentum') { const v = [0, 0]; v[0] = 0.9 * v[0] - lr * gx; v[1] = 0.9 * v[1] - lr * gy; x += v[0]; y += v[1]; }
      else if (method === 'newton') {
        const H = fn.hess(x, y);
        const [dx, dy] = solve2x2(H, [gx, gy]);
        x -= dx; y -= dy;
      }
      traj.push({ x, y, f: fn.f(x, y) });
      conv.push({ i: i + 1, f: fn.f(x, y) });
    }
    return { trajectory: traj, convergence: conv, finalVal: fn.f(x, y), finalPoint: [x, y] };
  }, [funcKey, method, lr, nIters]);

  // Draw contour + trajectory
  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const ctx = cv.getContext('2d');
    const w = cv.width, h = cv.height;
    stageBg(ctx, w, h);
    const [xMin, xMax, yMin, yMax] = fn.range;
    const pad = 20;
    const W = w - 2 * pad, H = h - 2 * pad;
    const X = (x) => pad + ((x - xMin) / (xMax - xMin)) * W;
    const Y = (y) => pad + H - ((y - yMin) / (yMax - yMin)) * H;
    // contour via sampling
    const levels = [0.1, 0.5, 1, 5, 20, 100, 500];
    const nx = 120, ny = 80;
    const grid = new Array(ny * nx);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const x = xMin + (xMax - xMin) * i / (nx - 1), y = yMin + (yMax - yMin) * j / (ny - 1);
      grid[j * nx + i] = Math.log10(1 + fn.f(x, y));
    }
    // color map
    let minG = Infinity, maxG = -Infinity;
    for (const g of grid) { minG = Math.min(minG, g); maxG = Math.max(maxG, g); }
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const v = (grid[j * nx + i] - minG) / (maxG - minG);
      const r = Math.floor(20 + v * 30), g = Math.floor(20 + (1 - v) * 40), b = Math.floor(40 + v * 60);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(X(xMin + (xMax - xMin) * i / (nx - 1)) - 1, Y(yMin + (yMax - yMin) * j / (ny - 1)) - 1, W / nx + 2, H / ny + 2);
    }
    // trajectory
    ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2;
    ctx.beginPath();
    trajectory.forEach((p, i) => { if (i === 0) ctx.moveTo(X(p.x), Y(p.y)); else ctx.lineTo(X(p.x), Y(p.y)); });
    ctx.stroke();
    // start
    ctx.fillStyle = '#f97316'; ctx.beginPath(); ctx.arc(X(fn.start[0]), Y(fn.start[1]), 5, 0, 7); ctx.fill();
    // minimum
    ctx.fillStyle = '#22c55e'; ctx.beginPath(); ctx.arc(X(fn.min[0]), Y(fn.min[1]), 5, 0, 7); ctx.fill();
  }, [trajectory, funcKey, fn]);

  return (
    <div className="space-y-4">
      <ResearchHeader title="Numerical Optimisation — Gradient Descent & Newton"
        subtitle="Minimise a function by following its gradient. Gradient descent (O(h) convergence) vs Newton's method (quadratic, uses Hessian). The Rosenbrock valley is a classic stress test."
        onExplain={() => explain(`Optimising ${funcKey} with ${method === 'gd' ? `gradient descent (lr=${lr})` : method === 'momentum' ? 'momentum' : "Newton's method"}. After ${nIters} iterations: f=${finalVal.toExponential(4)} at (${finalPoint[0].toFixed(4)}, ${finalPoint[1].toFixed(4)}). True minimum at (${fn.min[0]}, ${fn.min[1]}). ${funcKey === 'Rosenbrock' ? 'The narrow curved valley makes gradient descent zigzag — Newton follows the valley directly.' : method === 'newton' ? "Newton converges in few iterations on quadratic functions." : 'Gradient descent converges linearly; Newton quadratically.'}`)}
        explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card title="Settings">
          <label className="block text-sm"><span className="text-muted-foreground">Function</span>
            <select value={funcKey} onChange={(e) => setFuncKey(e.target.value)} className="mt-1 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm">
              {Object.keys(FUNCS).map((k) => <option key={k} className="bg-background">{k}</option>)}
            </select>
          </label>
          <label className="block text-sm mt-2"><span className="text-muted-foreground">Method</span>
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="mt-1 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm">
              <option value="gd" className="bg-background">Gradient descent</option>
              <option value="momentum" className="bg-background">Momentum</option>
              <option value="newton" className="bg-background">Newton</option>
            </select>
          </label>
          {method !== 'newton' && <div className="mt-2"><NumField label="learning rate" value={lr} onChange={setLr} min={0.0001} max={0.1} step={0.0001} /></div>}
          <div className="mt-2"><NumField label="iterations" value={nIters} onChange={setNIters} min={10} max={2000} step={10} /></div>
        </Card>
        <div className="space-y-3">
          <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden" style={{ height: 320 }}>
            <CanvasStage ref={canvasRef} />
          </div>
          <div className="text-xs text-muted-foreground flex gap-4">
            <span className="text-orange-400">● start</span>
            <span className="text-cyan-j">● trajectory</span>
            <span className="text-emerald-400">● minimum</span>
          </div>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <SciPlot type="line" data={convergence} xKey="i" log="semi-logy"
          series={[{ key: 'f', label: 'f(xₙ)', color: '#f97316' }]}
          xLabel="iteration" yLabel="f" height={180} exportName="optim-convergence" />
        <SciTable headers={['Metric', 'Value']} rows={[
          ['Method', method === 'gd' ? 'Gradient descent' : method === 'momentum' ? 'Momentum' : "Newton"],
          ['Final f', finalVal.toExponential(4)],
          ['Final point', `(${finalPoint[0].toFixed(4)}, ${finalPoint[1].toFixed(4)})`],
          ['True min', `(${fn.min[0]}, ${fn.min[1]})`],
          ['Iterations', nIters],
        ]} />
      </div>
      <AIPanel output={output} />
    </div>
  );
}