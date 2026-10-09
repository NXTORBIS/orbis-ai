// Quantum Fourier Transform — dedicated QFT simulator on 3 qubits.
// Shows the QFT of a basis state, the uniform-amplitude output with phases
// carrying the information, and the inverse QFT recovering the input.
import React, { useState, useEffect, useRef } from 'react';
import { CanvasStage, stageBg } from '../ui.jsx';
import { QState, GATES, applySingle, probs, qftCircuit, runCircuit } from '../lib/qsim.js';
import { ResearchHeader, Card, SciTable } from '../research.jsx';
import { Button } from '../ui/button.jsx';

export default function QuantumFourierTransform() {
  const canvasRef = useRef(null);
  const [input, setInput] = useState(5);
  const [mode, setMode] = useState('qft');
  const [result, setResult] = useState(null);

  const run = () => {
    const st = new QState(3);
    if (input & 1) applySingle(st, 0, GATES.X);
    if (input & 2) applySingle(st, 1, GATES.X);
    if (input & 4) applySingle(st, 2, GATES.X);
    const before = probs(st).slice();
    const ins = qftCircuit(3, [0, 1, 2], mode === 'iqft');
    runCircuit(ins, 3, st);
    const after = probs(st);
    const phases = []; for (let i = 0; i < 8; i++) { const amp = Math.atan2(st.im[i], st.re[i]); phases.push(amp); }
    setResult({ before, after, phases });
  };
  useEffect(() => { run(); }, [input, mode]);

  useEffect(() => {
    const cv = canvasRef.current; if (!cv || !result) return;
    const ctx = cv.getContext('2d'); const w = cv.width, h = cv.height; stageBg(ctx, w, h);
    const padX = 40, padY = 24; const W = w - 2 * padX, H = h - 2 * padY; const barW = W / 8;
    for (let i = 0; i < 8; i++) { const bh = result.after[i] * H * 0.85; ctx.fillStyle = '#22d3ee'; ctx.fillRect(padX + i * barW + 2, h - padY - bh, barW - 4, bh); ctx.fillStyle = 'hsl(var(--muted-foreground))'; ctx.font = '9px monospace'; ctx.textAlign = 'center'; ctx.fillText(i.toString(2).padStart(3, '0'), padX + i * barW + barW / 2, h - 6); }
    ctx.textAlign = 'left';
  }, [result]);

  const phaseRows = result ? result.phases.map((ph, i) => [i.toString(2).padStart(3, '0'), result.after[i].toFixed(4), (ph * 180 / Math.PI).toFixed(1) + '°']) : [];

  return (
    <div className="space-y-4">
      <ResearchHeader title="Quantum Fourier Transform (3 qubits)" subtitle="The QFT maps computational basis to the frequency domain. Probabilities become uniform, but phases encode the input. Inverse QFT recovers it." />
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-muted-foreground">Input |x⟩:</label>
        <select value={input} onChange={(e) => setInput(+e.target.value)} className="rounded-md border border-input bg-transparent px-2 py-1 text-sm">{Array.from({ length: 8 }, (_, i) => <option key={i} value={i} className="bg-background">|{i.toString(2).padStart(3, '0')}⟩</option>)}</select>
        {['qft', 'iqft'].map((m) => <Button key={m} size="sm" variant={mode === m ? 'default' : 'outline'} onClick={() => setMode(m)}>{m === 'qft' ? 'QFT' : 'Inverse QFT'}</Button>)}
        <Button size="sm" onClick={run}>Run</Button>
      </div>
      <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden" style={{ height: 200 }}><CanvasStage ref={canvasRef} /></div>
      {result && <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Output amplitudes & phases"><SciTable headers={['Basis', 'P', 'Phase']} rows={phaseRows} /></Card>
        <Card title="What the QFT does"><p className="text-xs text-muted-foreground">QFT|x⟩ = (1/√N) Σ_k exp(2πijk/N)|k⟩. The output has UNIFORM probabilities (all 1/8) — the information is entirely in the PHASES. That is why you must measure in a rotated basis or apply inverse QFT to read it back. The QFT is the quantum analogue of the discrete Fourier transform.</p></Card>
      </div>}
    </div>
  );
}