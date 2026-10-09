// Quantum Gates — dedicated explorer for X, Y, Z, H, S, T gates.
// Shows each gate's matrix, its rotation axis on the Bloch sphere, and the
// effect of applying it to |0⟩. Focus: gate identity and rotation geometry.
import React, { useEffect, useRef, useState } from 'react';
import { QState, GATES, applySingle, probs } from '../lib/qsim.js';
import { CanvasStage, stageBg, StatGrid, ExportBar } from '../ui.jsx';
import { Button } from '../ui/button.jsx';

const GATE_INFO = {
  X: { axis: 'x', angle: 'π', desc: 'Bit flip |0⟩↔|1⟩. Rotation π about x.' },
  Y: { axis: 'y', angle: 'π', desc: 'Bit+phase flip. Rotation π about y.' },
  Z: { axis: 'z', angle: 'π', desc: 'Phase flip |1⟩→−|1⟩. Rotation π about z.' },
  H: { axis: '[1,1,1]/√3', angle: 'π', desc: 'Hadamard: creates superposition. Rotation π about (x+y+z)/√3.' },
  S: { axis: 'z', angle: 'π/2', desc: 'Phase gate: |1⟩→i|1⟩. Rotation π/2 about z.' },
  T: { axis: 'z', angle: 'π/4', desc: 'π/8 gate: |1⟩→e^{iπ/4}|1⟩. Rotation π/4 about z.' },
};

function bloch(st) { const a = [st.re[0], st.im[0]], b = [st.re[1], st.im[1]]; const br = b[0], bi = b[1]; const x = 2 * (a[0] * br + a[1] * (-bi)); const y = 2 * (a[1] * br - a[0] * (-bi)); const z = a[0] * a[0] + a[1] * a[1] - (br * br + bi * bi); return [x, y, z]; }
function project(x, y, z, cx, cy, R) { const T = 0.5; return [cx + x * R, cy - (z * Math.cos(T) - y * Math.sin(T)) * R, cy - (z * Math.sin(T) + y * Math.cos(T)) * R]; }

export default function QuantumGates() {
  const canvasRef = useRef(null);
  const [gate, setGate] = useState('H');
  const stateRef = useRef(new QState(1));
  const [applied, setApplied] = useState([]);

  const apply = (g) => { applySingle(stateRef.current, 0, GATES[g]); setApplied((a) => [...a, g]); };
  const reset = () => { stateRef.current = new QState(1); setApplied([]); };

  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return; const ctx = cv.getContext('2d'); const w = cv.width, h = cv.height;
    stageBg(ctx, w, h); const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.3;
    ctx.strokeStyle = 'hsl(var(--border))'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'hsl(var(--border) / 0.5)'; ctx.beginPath(); ctx.ellipse(cx, cy, R, R * Math.sin(0.5), 0, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.ellipse(cx, cy, R * Math.sin(0.5), R, 0, 0, Math.PI * 2); ctx.stroke();
    const ax = (x, y, z, label, color) => { const [px, , py] = project(x, y, z, cx, cy, R); ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(px, py); ctx.stroke(); ctx.fillStyle = color; ctx.font = '11px monospace'; ctx.fillText(label, px + 4, py); };
    ax(1, 0, 0, 'x', '#22d3ee'); ax(0, 1, 0, 'y', '#f97316'); ax(0, 0, 1, '|0⟩', '#84cc16'); ax(0, 0, -1, '|1⟩', '#a855f7');
    // rotation axis for selected gate
    const gi = GATE_INFO[gate]; const axisColor = '#fbbf24';
    if (gi.axis === 'x') ax(1.2, 0, 0, '', axisColor); else if (gi.axis === 'y') ax(0, 1.2, 0, '', axisColor); else if (gi.axis === 'z') ax(0, 0, 1.3, '', axisColor);
    const [bx, by, bz] = bloch(stateRef.current); const [px, , py] = project(bx, by, bz, cx, cy, R);
    ctx.strokeStyle = '#f43f5e'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(px, py); ctx.stroke();
    ctx.fillStyle = '#f43f5e'; ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.fill();
  });

  const M = GATES[gate]; const fmt = (m) => `(${m[0].toFixed(2)}${m[1] >= 0 ? '+' : ''}${m[1].toFixed(2)}i)`;
  const matrixStr = `[[${fmt(M[0][0])}, ${fmt(M[0][1])}], [${fmt(M[1][0])}, ${fmt(M[1][1])}]]`;
  const p = probs(stateRef.current);
  const stats = { 'Gate': gate, 'Axis': GATE_INFO[gate].axis, 'Angle': GATE_INFO[gate].angle, 'P(0)': p[0].toFixed(3), 'P(1)': p[1].toFixed(3) };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <div className="space-y-3">
        <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden" style={{ height: 340 }}><CanvasStage ref={canvasRef} /></div>
        <div className="flex flex-wrap gap-2">{Object.keys(GATE_INFO).map((g) => <Button key={g} size="sm" variant={g === gate ? 'default' : 'outline'} onClick={() => setGate(g)}>{g}</Button>)}</div>
        <div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => apply(gate)}>Apply {gate}</Button><Button size="sm" variant="ghost" onClick={reset}>Reset</Button></div>
        <div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">{GATE_INFO[gate].desc}</div>
      </div>
      <div className="space-y-3">
        <StatGrid stats={stats} />
        <div className="rounded-xl border border-border/60 bg-card/40 p-3"><div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Matrix</div><div className="font-mono text-xs break-all">{matrixStr}</div></div>
        <div className="rounded-xl border border-border/60 bg-card/40 p-3"><div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Applied sequence</div><div className="font-mono text-xs break-all">{applied.length ? applied.join(' → ') : 'none yet'}</div></div>
        <ExportBar graphData={[]} config={{ gate, sequence: applied }} canvasRef={canvasRef} name="quantum-gates" />
      </div>
    </div>
  );
}