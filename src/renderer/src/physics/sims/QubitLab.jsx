// Quantum qubit lab — real SU(2) gates + Bloch sphere
import React, { useEffect, useRef, useState, useReducer } from 'react';
import { QState, GATES, applySingle, probs } from '../lib/qsim.js';
import { CanvasStage, stageBg, StatGrid, ExportBar } from '../ui.jsx';
import { Button } from '../ui/button.jsx';

const GATE_LIST = ['H', 'X', 'Y', 'Z', 'S', 'T'];
// Bloch vector from single-qubit state |ψ>=α|0>+β|1>
function bloch(st) {
  const a = [st.re[0], st.im[0]], b = [st.re[1], st.im[1]];
  // ⟨σ⟩: x=2Re(α*β), y=2Im(α*β)? Actually x=2Re(α* conj β)... use standard: x=2Re(α* β*), y=-2Im(α* β*)? 
  // Standard: x = 2 Re(α β*), y = 2 Im(α β*), z = |α|²-|β|². Let me use α* conj(β):
  const br = b[0], bi = b[1];
  const x = 2 * (a[0] * br + a[1] * (-bi)); // Re(α β*)
  const y = 2 * (a[1] * br - a[0] * (-bi)); // Im(α β*) -> using α*β* ... 
  const z = a[0] * a[0] + a[1] * a[1] - (br * br + bi * bi);
  return [x, y, z];
}
function project(x, y, z, cx, cy, R) { const T = 0.5; return [cx + x * R, cy - (z * Math.cos(T) - y * Math.sin(T)) * R, cy - (z * Math.sin(T) + y * Math.cos(T)) * R]; }

export default function QubitLab() {
  const canvasRef = useRef(null);
  const stateRef = useRef(new QState(1));
  const [, force] = useReducer((x) => x + 1, 0);
  const [history, setHistory] = useState(['|0⟩']);

  const apply = (g) => { applySingle(stateRef.current, 0, GATES[g]); setHistory((h) => [...h, g]); force(); };
  const reset = () => { stateRef.current = new QState(1); setHistory(['|0⟩']); force(); };
  const measure = () => {
    const p = probs(stateRef.current); const r = Math.random() < p[1] ? 1 : 0;
    const re = r ? 0 : 1, im = 0; stateRef.current.re = Float64Array.from([re, im]); stateRef.current.im = Float64Array.from([0, 0]);
    setHistory((h) => [...h, `M→${r}`]); force();
  };

  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const ctx = cv.getContext('2d'); const w = cv.width, h = cv.height;
    stageBg(ctx, w, h); const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.32;
    // sphere
    ctx.strokeStyle = 'hsl(var(--border))'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'hsl(var(--border) / 0.5)'; ctx.beginPath(); ctx.ellipse(cx, cy, R, R * Math.sin(0.5), 0, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(cx, cy, R * Math.sin(0.5), R, 0, 0, Math.PI * 2); ctx.stroke();
    // axes
    const ax = (x, y, z, label, color) => { const [px, , py] = project(x, y, z, cx, cy, R); ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(px, py); ctx.stroke(); ctx.fillStyle = color; ctx.font = '12px monospace'; ctx.fillText(label, px + 4, py); };
    ax(1, 0, 0, 'x', '#22d3ee'); ax(0, 1, 0, 'y', '#f97316'); ax(0, 0, 1, '|0⟩', '#84cc16');
    ax(-1, 0, 0, '', '#22d3ee44'); ax(0, -1, 0, '', '#f9731644'); ax(0, 0, -1, '|1⟩', '#a855f7');
    // vector
    const [bx, by, bz] = bloch(stateRef.current);
    const [px, , py] = project(bx, by, bz, cx, cy, R);
    ctx.strokeStyle = '#f43f5e'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(px, py); ctx.stroke();
    ctx.fillStyle = '#f43f5e'; ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.fill();
  });

  const a = stateRef.current.re[0], ai = stateRef.current.im[0], b = stateRef.current.re[1], bi = stateRef.current.im[1];
  const p0 = a * a + ai * ai, p1 = b * b + bi * bi;
  const fmt = (r, i) => `${r.toFixed(3)}${i >= 0 ? '+' : '−'}${Math.abs(i).toFixed(3)}i`;
  const stats = { 'α (|0⟩)': fmt(a, ai), 'β (|1⟩)': fmt(b, bi), 'P(0)': p0.toFixed(3), 'P(1)': p1.toFixed(3), '|ψ⟩': history[history.length - 1] };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <div className="space-y-3">
        <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden" style={{ height: 380 }}><CanvasStage ref={canvasRef} /></div>
        <div className="flex flex-wrap gap-2">
          {GATE_LIST.map((g) => <Button key={g} size="sm" variant="outline" onClick={() => apply(g)}>{g}</Button>)}
          <Button size="sm" variant="secondary" onClick={measure}>Measure</Button>
          <Button size="sm" variant="ghost" onClick={reset}>Reset</Button>
        </div>
        <div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">Apply gates to a single qubit and watch its state vector move on the Bloch sphere. Real SU(2) unitaries.</div>
      </div>
      <div className="space-y-3">
        <StatGrid stats={stats} />
        <div className="rounded-xl border border-border/60 bg-card/40 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Gate history</div>
          <div className="font-mono text-xs break-all">{history.join(' → ')}</div>
        </div>
        <ExportBar graphData={[]} config={{ gates: history }} canvasRef={canvasRef} name="qubit-lab" />
      </div>
    </div>
  );
}