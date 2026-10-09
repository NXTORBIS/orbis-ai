import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ResearchHeader, Card, AIPanel, useAIExplain, SciTable, NumField, downloadFile } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';
import { Button } from '../ui/button.jsx';
import { Plus, RotateCcw } from 'lucide-react';
import { sampleStats, pctError } from '../lib/uncertainty.js';

// Resonance Tube — speed of sound from standing waves.
// Unique: tube with water level, antinode/node markers, resonance lengths.
export default function VLResonanceTubeSim() {
  const [freq, setFreq] = useState(512);
  const [temperature, setTemperature] = useState(20);
  const [trials, setTrials] = useState([]);
  const canvasRef = useRef(null);
  const { explain, explaining, output } = useAIExplain();

  // Speed of sound: v = 331.3 + 0.606·T (m/s)
  const vTheory = useMemo(() => 331.3 + 0.606 * temperature, [temperature]);
  // First resonance: L₁ = λ/4 = v/(4f); second: L₂ = 3λ/4
  const L1 = useMemo(() => vTheory / (4 * freq), [vTheory, freq]);
  const L2 = useMemo(() => 3 * vTheory / (4 * freq), [vTheory, freq]);

  // Tube animation
  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const ctx = cv.getContext('2d');
    const w = cv.width, h = cv.height;
    ctx.fillStyle = 'hsl(222 47% 6%)'; ctx.fillRect(0, 0, w, h);
    // tube
    const tx = 60, tw = 80, tTop = 20, tBot = h - 20;
    ctx.strokeStyle = '#64748b'; ctx.lineWidth = 3; ctx.beginPath();
    ctx.moveTo(tx, tTop); ctx.lineTo(tx, tBot); ctx.moveTo(tx + tw, tTop); ctx.lineTo(tx + tw, tBot); ctx.stroke();
    // water level (at first resonance)
    const waterY = tBot - L1 * 200;
    ctx.fillStyle = 'hsl(210 80% 50% / 0.4)'; ctx.fillRect(tx + 2, waterY, tw - 4, tBot - waterY);
    ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(tx, waterY); ctx.lineTo(tx + tw, waterY); ctx.stroke();
    // standing wave (first harmonic)
    ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2; ctx.beginPath();
    for (let y = tTop; y <= waterY; y += 1) {
      const x = tx + tw / 2 + 25 * Math.sin(Math.PI * (y - tTop) / (waterY - tTop)) * Math.cos(2 * Math.PI * freq * 0.001 * (Date.now() / 1000));
      if (y === tTop) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // tuning fork
    ctx.strokeStyle = '#f97316'; ctx.lineWidth = 3; ctx.beginPath();
    ctx.moveTo(tx + tw / 2, tTop - 15); ctx.lineTo(tx + tw / 2, tTop); ctx.stroke();
    ctx.fillStyle = '#f97316'; ctx.font = '10px monospace'; ctx.textAlign = 'center';
    ctx.fillText(`${freq}Hz`, tx + tw / 2, tTop - 20);
    // labels
    ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
    ctx.fillText(`L₁ = ${L1.toFixed(4)} m`, tx + tw + 10, waterY + 4);
    ctx.fillText(`v = ${vTheory.toFixed(2)} m/s`, tx + tw + 10, tBot - 10);
  }, [freq, L1, vTheory]);

  const takeTrial = () => {
    const L = L1 * (1 + (Math.random() - 0.5) * 0.03);
    const v = 4 * freq * L;
    setTrials((t) => [...t, { freq, L, v }]);
  };

  const vValues = trials.map((t) => t.v);
  const stats = useMemo(() => sampleStats(vValues), [vValues]);
  const pctErr = stats.n ? pctError(stats.mean, vTheory) : 0;

  return (
    <div className="space-y-4">
      <ResearchHeader title="Resonance Tube" subtitle="Measure the speed of sound using standing waves in air. First resonance: L = λ/4 = v/(4f)."
        onExplain={() => explain(`Resonance tube: ${trials.length} trials at f=${freq}Hz, T=${temperature}°C. v = ${stats.mean?.toFixed(2) ?? '—'} m/s vs theory ${vTheory.toFixed(2)} (${pctErr.toFixed(2)}% error).`)} explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[280px_1fr_300px]">
        <Card title="Apparatus">
          <NumField label="Frequency f" value={freq} onChange={setFreq} min={200} max={2000} step={10} unit="Hz" />
          <NumField label="Temperature" value={temperature} onChange={setTemperature} min={0} max={40} step={1} unit="°C" />
          <div className="mt-3 flex gap-2"><Button size="sm" onClick={takeTrial}><Plus className="size-3.5" />Measure L</Button><Button size="sm" variant="outline" onClick={() => setTrials([])}><RotateCcw className="size-3.5" /></Button></div>
          <div className="mt-2 text-xs text-muted-foreground">L₁ (theory) = <span className="font-mono text-cyan-j">{L1.toFixed(4)} m</span></div>
          <div className="text-xs text-muted-foreground">L₂ = <span className="font-mono">{L2.toFixed(4)} m</span></div>
        </Card>
        <div className="space-y-3">
          <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden" style={{ height: 300 }}>
            <canvas ref={canvasRef} className="w-full h-full" />
          </div>
          {stats.n > 0 && <Card title="Result"><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{[['Mean v', stats.mean.toFixed(2) + ' m/s'], ['Std Dev', stats.sd.toFixed(2)], ['% Error', pctErr.toFixed(2) + '%']].map(([k, v]) => <div key={k} className="rounded-lg border border-border/50 bg-card/30 px-2.5 py-1.5"><div className="text-[10px] uppercase text-muted-foreground">{k}</div><div className="font-mono text-sm">{v}</div></div>)}</div></Card>}
        </div>
        <div className="space-y-3">
          {trials.length > 0 && <Card title={`Trials (${trials.length})`}><SciTable headers={['#', 'f (Hz)', 'L (m)', 'v (m/s)']} rows={trials.map((t, i) => [i + 1, t.freq, t.L.toFixed(4), t.v.toFixed(2)])} /></Card>}
          <Button size="sm" variant="outline" onClick={() => downloadFile(JSON.stringify({ freq, temperature, trials }, null, 2), 'resonance-tube.json', 'application/json')}>Export JSON</Button>
        </div>
      </div>
      <AIPanel output={output} />
    </div>
  );
}