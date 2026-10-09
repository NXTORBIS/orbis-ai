import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ResearchHeader, Card, AIPanel, useAIExplain, SciTable, NumField, downloadFile } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';
import { Button } from '../ui/button.jsx';
import { Plus, RotateCcw } from 'lucide-react';
import { sampleStats, pctError } from '../lib/uncertainty.js';

// SHM — measure spring constant k from period. T = 2π√(m/k).
// Unique: spring oscillation canvas, period vs mass plot, k extraction from T²-vs-m slope.
export default function VLSHMSim() {
  const [k, setK] = useState(50);
  const [mass, setMass] = useState(0.5);
  const [amplitude, setAmplitude] = useState(0.1);
  const [trials, setTrials] = useState([]);
  const canvasRef = useRef(null);
  const tRef = useRef(0);
  const { explain, explaining, output } = useAIExplain();

  const TTheory = useMemo(() => 2 * Math.PI * Math.sqrt(mass / k), [mass, k]);

  // Spring animation
  useEffect(() => {
    let raf;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const cv = canvasRef.current; if (!cv) return;
      const ctx = cv.getContext('2d');
      const w = cv.width, h = cv.height;
      ctx.fillStyle = 'hsl(222 47% 6%)'; ctx.fillRect(0, 0, w, h);
      const cx = w / 2;
      const omega = Math.sqrt(k / mass);
      const x = amplitude * Math.cos(omega * tRef.current) * 200;
      // support
      ctx.fillStyle = '#64748b'; ctx.fillRect(cx - 40, 10, 80, 6);
      // spring (zigzag)
      ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 2; ctx.beginPath();
      const topY = 16, massY = h / 2 + x;
      const coils = 12, segH = (massY - topY) / coils;
      ctx.moveTo(cx, topY);
      for (let i = 0; i < coils; i++) {
        const y = topY + (i + 0.5) * segH;
        ctx.lineTo(cx + (i % 2 === 0 ? 20 : -20), y);
      }
      ctx.lineTo(cx, massY); ctx.stroke();
      // mass block
      ctx.fillStyle = '#22d3ee'; ctx.fillRect(cx - 25, massY, 50, 30);
      ctx.strokeStyle = '#0891b2'; ctx.lineWidth = 2; ctx.strokeRect(cx - 25, massY, 50, 30);
      ctx.fillStyle = '#fff'; ctx.font = '10px monospace'; ctx.textAlign = 'center'; ctx.fillText(`${mass}kg`, cx, massY + 18);
      // equilibrium line
      ctx.strokeStyle = 'hsl(var(--cyan) / 0.3)'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(cx - 40, h / 2 + 15); ctx.lineTo(cx + 40, h / 2 + 15); ctx.stroke(); ctx.setLineDash([]);
      tRef.current += 0.016;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [k, mass, amplitude]);

  const takeTrial = () => {
    const T = TTheory * (1 + (Math.random() - 0.5) * 0.02);
    setTrials((t) => [...t, { m: mass, T }]);
  };

  // k from slope of T² vs m: T² = (4π²/k)·m → k = 4π²/slope
  const fit = useMemo(() => {
    if (trials.length < 2) return null;
    const data = trials.map((t) => ({ m: t.m, T2: t.T * t.T }));
    const n = data.length;
    const sx = data.reduce((s, d) => s + d.m, 0);
    const sy = data.reduce((s, d) => s + d.T2, 0);
    const sxx = data.reduce((s, d) => s + d.m * d.m, 0);
    const sxy = data.reduce((s, d) => s + d.m * d.T2, 0);
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    return { slope, k: 4 * Math.PI * Math.PI / slope };
  }, [trials]);

  const pctErr = fit ? pctError(fit.k, k) : 0;
  const plotData = trials.map((t) => ({ m: t.m, T2: t.T * t.T }));

  return (
    <div className="space-y-4">
      <ResearchHeader title="Simple Harmonic Motion" subtitle="Measure spring constant k from the SHM period. T = 2π√(m/k); plot T² vs m, extract k from slope = 4π²/k."
        onExplain={() => explain(`SHM spring: ${trials.length} trials. k from T²-vs-m slope = ${fit?.k.toFixed(4) ?? '—'} N/m vs actual ${k} (${pctErr.toFixed(2)}% error).`)} explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[280px_1fr_300px]">
        <Card title="Apparatus">
          <NumField label="Spring constant k" value={k} onChange={setK} min={10} max={200} step={5} unit="N/m" />
          <NumField label="Mass m" value={mass} onChange={setMass} min={0.1} max={2} step={0.1} unit="kg" />
          <NumField label="Amplitude" value={amplitude} onChange={setAmplitude} min={0.02} max={0.2} step={0.01} unit="m" />
          <div className="mt-3 flex gap-2"><Button size="sm" onClick={takeTrial}><Plus className="size-3.5" />Time period</Button><Button size="sm" variant="outline" onClick={() => setTrials([])}><RotateCcw className="size-3.5" /></Button></div>
          <div className="mt-2 text-xs text-muted-foreground">T (theory) = <span className="font-mono text-cyan-j">{TTheory.toFixed(4)} s</span></div>
        </Card>
        <div className="space-y-3">
          <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden" style={{ height: 280 }}>
            <canvas ref={canvasRef} className="w-full h-full" />
          </div>
          {fit && <Card title="T² vs Mass"><SciPlot type="scatter" data={plotData} xKey="m" series={[{ key: 'T2', label: 'T² (s²)', color: '#22d3ee' }]} xLabel="m (kg)" yLabel="T² (s²)" height={180} exportName="T2-vs-m" /></Card>}
        </div>
        <div className="space-y-3">
          {trials.length > 0 && <Card title={`Trials (${trials.length})`}><SciTable headers={['#', 'm (kg)', 'T (s)', 'T² (s²)']} rows={trials.map((t, i) => [i + 1, t.m.toFixed(2), t.T.toFixed(4), (t.T * t.T).toFixed(4)])} /></Card>}
          {fit && <Card title="Result"><div className="text-xs space-y-1"><div>Slope = <span className="font-mono">{fit.slope.toFixed(6)}</span></div><div>k = 4π²/slope = <span className="font-mono text-cyan-j">{fit.k.toFixed(4)} N/m</span></div><div>% error = {pctErr.toFixed(2)}%</div></div></Card>}
          <Button size="sm" variant="outline" onClick={() => downloadFile(JSON.stringify({ k, trials, fit }, null, 2), 'shm.json', 'application/json')}>Export JSON</Button>
        </div>
      </div>
      <AIPanel output={output} />
    </div>
  );
}