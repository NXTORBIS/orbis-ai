// Computational physics lab — real numerical methods
import React, { useEffect, useRef, useState } from 'react';
import { CanvasStage, stageBg, StatGrid } from '../ui.jsx';
import { rk4, fft, nextPow2 } from '../lib/math.js';
import { Button } from '../ui/button.jsx';

const TABS = ['ODE Solver', 'Numerical Integration', 'Root Finding', 'FFT Spectrum'];

export default function CompPhysics() {
  const [tab, setTab] = useState(0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {TABS.map((t, i) => <button key={t} onClick={() => setTab(i)} className={`rounded-full px-3 py-1.5 text-xs font-medium ${i === tab ? 'bg-cyan-j text-background' : 'bg-card/40 text-muted-foreground'}`}>{t}</button>)}
      </div>
      {tab === 0 && <ODETab />} {tab === 1 && <IntTab />} {tab === 2 && <RootTab />} {tab === 3 && <FFTTab />}
    </div>
  );
}

function Plot({ draw, height = 240 }) {
  const ref = useRef(null);
  useEffect(() => { const cv = ref.current; if (!cv) return; const ctx = cv.getContext('2d'); draw(ctx, cv.width, cv.height); }, [draw]);
  return <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden" style={{ height }}><CanvasStage ref={ref} /></div>;
}

// ── ODE: harmonic oscillator y'' = -ω² y, analytic = cos(ωt) ──
function ODETab() {
  const [method, setMethod] = useState('RK4');
  const [dt, setDt] = useState(0.1);
  const [steps, setSteps] = useState(200);
  const [omega, setOmega] = useState(1);
  const { series, err } = compute();
  function compute() {
    const f = (t, y) => [y[1], -omega * omega * y[0]];
    const methods = {
      Euler: (y, t, h) => { const k = f(t, y); return [y[0] + h * k[0], y[1] + h * k[1]]; },
      'Improved Euler': (y, t, h) => { const k1 = f(t, y); const p = [y[0] + h * k1[0], y[1] + h * k1[1]]; const k2 = f(t + h, p); return [y[0] + h * (k1[0] + k2[0]) / 2, y[1] + h * (k1[1] + k2[1]) / 2]; },
      RK4: (y, t, h) => { const y2 = rk4(f, t, y, h); return [y2[0], y2[1]]; },
    };
    let y = [1, 0]; const ser = [{ t: 0, num: 1, ana: 1 }]; let maxErr = 0;
    for (let i = 1; i <= steps; i++) { y = methods[method](y, (i - 1) * dt, dt); const t = i * dt; const ana = Math.cos(omega * t); ser.push({ t, num: y[0], ana }); maxErr = Math.max(maxErr, Math.abs(y[0] - ana)); }
    return { series: ser, err: maxErr };
  }
  const draw = (ctx, w, h) => {
    stageBg(ctx, w, h); const padX = 30, padY = 20; const W = w - 2 * padX, H = h - 2 * padY;
    const max = Math.max(...series.map((s) => Math.max(Math.abs(s.num), Math.abs(s.ana))), 1);
    const Y = (v) => padY + H / 2 - (v / max) * H / 2 * 0.9;
    ctx.strokeStyle = 'hsl(var(--border) / 0.4)'; ctx.beginPath(); ctx.moveTo(padX, padY + H / 2); ctx.lineTo(padX + W, padY + H / 2); ctx.stroke();
    ctx.strokeStyle = '#f97316'; ctx.lineWidth = 2; ctx.beginPath(); series.forEach((s, i) => { const x = padX + (i / (series.length - 1)) * W; if (i === 0) ctx.moveTo(x, Y(s.ana)); else ctx.lineTo(x, Y(s.ana)); }); ctx.stroke();
    ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 1.5; ctx.beginPath(); series.forEach((s, i) => { const x = padX + (i / (series.length - 1)) * W; if (i === 0) ctx.moveTo(x, Y(s.num)); else ctx.lineTo(x, Y(s.num)); }); ctx.stroke();
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={method} onChange={(e) => setMethod(e.target.value)} className="rounded-md border border-input bg-transparent px-2 py-1 text-sm">{['Euler', 'Improved Euler', 'RK4'].map((m) => <option key={m} className="bg-background">{m}</option>)}</select>
        <label className="text-xs text-muted-foreground">Δt</label><input type="range" min={0.01} max={0.5} step={0.01} value={dt} onChange={(e) => setDt(+e.target.value)} className="accent-cyan-500" /><span className="font-mono text-xs w-10">{dt.toFixed(2)}</span>
        <label className="text-xs text-muted-foreground">steps</label><input type="range" min={50} max={1000} step={50} value={steps} onChange={(e) => setSteps(+e.target.value)} className="accent-cyan-500" /><span className="font-mono text-xs w-10">{steps}</span>
        <label className="text-xs text-muted-foreground">ω</label><input type="range" min={0.5} max={5} step={0.1} value={omega} onChange={(e) => setOmega(+e.target.value)} className="accent-cyan-500" /><span className="font-mono text-xs w-10">{omega.toFixed(1)}</span>
      </div>
      <Plot draw={draw} />
      <StatGrid stats={{ 'Method': method, 'Max |error|': err.toFixed(6), 'Δt': dt.toFixed(3), 'Steps': steps, 'ω': omega.toFixed(1), 'System': "y''=−ω²y" }} />
      <div className="text-xs text-muted-foreground">Orange = analytic cos(ωt), cyan = numerical. Watch Euler drift while RK4 stays on the curve.</div>
    </div>
  );
}

// ── Numerical integration: Simpson vs exact ──
function IntTab() {
  const [n, setN] = useState(20);
  const f = (x) => Math.sin(x) * Math.exp(-x * 0.2);
  const exact = (Math.exp(-Math.PI * 0.2) * (-Math.sin(Math.PI) - 0.2 * Math.cos(Math.PI)) + 0.2) / 1.04; // ∫₀^π sin x e^{-0.2x} dx
  const a = 0, b = Math.PI, h = (b - a) / n;
  let simp = f(a) + f(b);
  for (let i = 1; i < n; i++) simp += (i % 2 ? 4 : 2) * f(a + i * h);
  simp = simp * h / 3;
  const draw = (ctx, w, h) => {
    stageBg(ctx, w, h); const padX = 30, padY = 20; const W = w - 2 * padX, H = h - 2 * padY;
    const maxF = 1; const X = (x) => padX + (x / b) * W; const Y = (v) => padY + H - (v / maxF) * H * 0.9;
    ctx.fillStyle = '#22d3ee44'; ctx.beginPath(); ctx.moveTo(X(a), Y(0));
    for (let i = 0; i <= 100; i++) { const x = a + (b - a) * i / 100; ctx.lineTo(X(x), Y(f(x))); } ctx.lineTo(X(b), Y(0)); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#f97316'; ctx.lineWidth = 2; ctx.beginPath(); for (let i = 0; i <= 100; i++) { const x = a + (b - a) * i / 100; if (i === 0) ctx.moveTo(X(x), Y(f(x))); else ctx.lineTo(X(x), Y(f(x))); } ctx.stroke();
    ctx.strokeStyle = 'hsl(var(--muted-foreground) / 0.5)'; ctx.setLineDash([3, 3]); for (let i = 0; i <= n; i++) { const x = a + i * h; ctx.beginPath(); ctx.moveTo(X(x), Y(0)); ctx.lineTo(X(x), Y(f(x))); ctx.stroke(); } ctx.setLineDash([]);
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2"><label className="text-xs text-muted-foreground">panels n</label><input type="range" min={2} max={200} step={2} value={n} onChange={(e) => setN(+e.target.value)} className="accent-cyan-500" /><span className="font-mono text-xs w-10">{n}</span></div>
      <Plot draw={draw} />
      <StatGrid stats={{ 'Simpson': simp.toFixed(8), 'Exact': exact.toFixed(8), 'Error': Math.abs(simp - exact).toExponential(2), 'f(x)': 'sin(x)·e^{−0.2x}', '[a,b]': '[0, π]' }} />
    </div>
  );
}

// ── Root finding: Newton vs bisection on f(x)=x³−2 ──
function RootTab() {
  const [method, setMethod] = useState('Newton');
  const [x0, setX0] = useState(1);
  const f = (x) => x * x * x - 2, fp = (x) => 3 * x * x;
  const iters = [];
  if (method === 'Newton') { let x = x0; for (let i = 0; i < 12 && Math.abs(f(x)) > 1e-12; i++) { iters.push({ i, x, fx: f(x) }); x = x - f(x) / fp(x); } iters.push({ i: iters.length, x, fx: f(x) }); }
  else { let lo = 0, hi = 2; for (let i = 0; i < 40 && hi - lo > 1e-12; i++) { const m = (lo + hi) / 2; iters.push({ i, x: m, fx: f(m) }); if (f(m) > 0) hi = m; else lo = m; } }
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2"><select value={method} onChange={(e) => setMethod(e.target.value)} className="rounded-md border border-input bg-transparent px-2 py-1 text-sm">{['Newton', 'Bisection'].map((m) => <option key={m} className="bg-background">{m}</option>)}</select>
        {method === 'Newton' && <><label className="text-xs text-muted-foreground">x₀</label><input type="range" min={0.1} max={3} step={0.1} value={x0} onChange={(e) => setX0(+e.target.value)} className="accent-cyan-500" /><span className="font-mono text-xs w-10">{x0.toFixed(1)}</span></>}</div>
      <div className="rounded-xl border border-border/60 bg-card/40 p-3 max-h-56 overflow-auto">
        <table className="text-xs font-mono w-full"><thead><tr className="text-muted-foreground text-left"><th className="py-1">iter</th><th>x</th><th>f(x)</th></tr></thead>
          <tbody>{iters.map((r) => <tr key={r.i}><td className="py-0.5">{r.i}</td><td>{r.x.toFixed(10)}</td><td>{r.fx.toExponential(3)}</td></tr>)}</tbody></table>
      </div>
      <StatGrid stats={{ 'Root': iters[iters.length - 1].x.toFixed(12), '√2': Math.SQRT2 ** 3 ? (2 ** (1 / 3)).toFixed(12) : '', 'f(x)': 'x³−2', 'Iters': iters.length }} />
    </div>
  );
}

// ── FFT spectrum of a sum of sines ──
function FFTTab() {
  const [f1, setF1] = useState(5);
  const [f2, setF2] = useState(13);
  const N = nextPow2(256);
  const re = new Array(N), im = new Array(N).fill(0);
  for (let i = 0; i < N; i++) { re[i] = Math.sin(2 * Math.PI * f1 * i / N) + 0.6 * Math.sin(2 * Math.PI * f2 * i / N); }
  const sig = re.slice();
  fft(re, im);
  const mag = re.map((v, i) => Math.hypot(v, im[i]));
  const draw = (ctx, w, h) => {
    stageBg(ctx, w, h); const padX = 30, padY = 20; const W = w - 2 * padX, H = h - 2 * padY;
    // signal
    ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 1.5; ctx.beginPath();
    for (let i = 0; i < N; i++) { const x = padX + (i / (N - 1)) * W; const y = padY + H / 2 - sig[i] / 3 * H * 0.4; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.stroke();
    // spectrum (first half)
    ctx.strokeStyle = '#f97316'; ctx.lineWidth = 2; const half = N / 2; const maxM = Math.max(...mag.slice(0, half));
    for (let i = 0; i < half; i++) { const bh = (mag[i] / maxM) * H * 0.4; const x = padX + (i / (half - 1)) * W; ctx.beginPath(); ctx.moveTo(x, padY + H); ctx.lineTo(x, padY + H - bh); ctx.stroke(); }
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2"><label className="text-xs text-muted-foreground">f₁</label><input type="range" min={1} max={40} step={1} value={f1} onChange={(e) => setF1(+e.target.value)} className="accent-cyan-500" /><span className="font-mono text-xs w-8">{f1}</span>
        <label className="text-xs text-muted-foreground">f₂</label><input type="range" min={1} max={40} step={1} value={f2} onChange={(e) => setF2(+e.target.value)} className="accent-cyan-500" /><span className="font-mono text-xs w-8">{f2}</span></div>
      <Plot draw={draw} />
      <StatGrid stats={{ 'f₁': f1, 'f₂': f2, 'N': N, 'Peaks at': `${f1}, ${f2}`, 'Method': 'Radix-2 Cooley–Tukey' }} />
    </div>
  );
}