import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ResearchHeader, Card, AIPanel, useAIExplain, SciTable, NumField, downloadFile } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';
import { Button } from '../ui/button.jsx';
import { Plus, RotateCcw } from 'lucide-react';
import { sampleStats, pctError } from '../lib/uncertainty.js';

// Simple Pendulum — measure g from period. Unique: live oscillation canvas,
// photogate-style period measurement with realistic timing uncertainty.
export default function VLPendulumSim() {
  const [L, setL] = useState(1.0);
  const [amplitude, setAmplitude] = useState(10);
  const [trials, setTrials] = useState([]);
  const canvasRef = useRef(null);
  const tRef = useRef(0);
  const { explain, explaining, output } = useAIExplain();

  const g = 9.81;
  const TTheory = useMemo(() => 2 * Math.PI * Math.sqrt(L / g), [L]);
  const gTheory = g;

  // Live pendulum animation
  useEffect(() => {
    let raf;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const cv = canvasRef.current; if (!cv) return;
      const ctx = cv.getContext('2d');
      const w = cv.width, h = cv.height;
      ctx.fillStyle = 'hsl(222 47% 6%)'; ctx.fillRect(0, 0, w, h);
      const cx = w / 2, cy = 40;
      const ampRad = amplitude * Math.PI / 180;
      const omega = Math.sqrt(g / L);
      const angle = ampRad * Math.cos(omega * tRef.current);
      const px = cx + Math.sin(angle) * (h - 100);
      const py = cy + Math.cos(angle) * (h - 100);
      // pivot
      ctx.fillStyle = '#64748b'; ctx.fillRect(cx - 30, cy - 4, 60, 6);
      // string
      ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(px, py); ctx.stroke();
      // arc trace
      ctx.strokeStyle = 'hsl(var(--cyan) / 0.2)'; ctx.lineWidth = 1; ctx.beginPath();
      for (let a = -ampRad; a <= ampRad; a += 0.05) {
        const tx = cx + Math.sin(a) * (h - 100), ty = cy + Math.cos(a) * (h - 100);
        if (a === -ampRad) ctx.moveTo(tx, ty); else ctx.lineTo(tx, ty);
      }
      ctx.stroke();
      // bob
      ctx.fillStyle = '#22d3ee'; ctx.beginPath(); ctx.arc(px, py, 12, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#0891b2'; ctx.lineWidth = 2; ctx.stroke();
      // angle indicator
      ctx.strokeStyle = 'hsl(var(--cyan) / 0.4)'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + 60); ctx.stroke(); ctx.setLineDash([]);
      tRef.current += 0.016;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [L, amplitude]);

  const takeTrial = () => {
    // Photogate timing: ±0.5% random uncertainty
    const T = TTheory * (1 + (Math.random() - 0.5) * 0.01);
    setTrials((t) => [...t, { T, L }]);
  };

  const gValues = useMemo(() => trials.map((t) => 4 * Math.PI * Math.PI * t.L / (t.T * t.T)), [trials]);
  const stats = useMemo(() => sampleStats(gValues), [gValues]);
  const pctErr = stats.n ? pctError(stats.mean, gTheory) : 0;

  const plotData = useMemo(() => {
    const pts = [];
    for (let len = 0.2; len <= 2.0; len += 0.05) pts.push({ L: len, T: 2 * Math.PI * Math.sqrt(len / g), Tsq: 4 * Math.PI * Math.PI * len / g });
    return pts;
  }, []);

  return (
    <div className="space-y-4">
      <ResearchHeader title="Simple Pendulum" subtitle="Measure g from a pendulum's period. Adjust length, take timing measurements, extract g = 4π²L/T²."
        onExplain={() => explain(`Simple pendulum: ${trials.length} trials at L=${L}m. Mean g = ${stats.mean?.toFixed(4) ?? '—'} m/s² vs theoretical 9.81 (${pctErr.toFixed(2)}% error).`)} explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[280px_1fr_300px]">
        <Card title="Apparatus">
          <NumField label="Length L" value={L} onChange={setL} min={0.2} max={2} step={0.05} unit="m" />
          <NumField label="Amplitude" value={amplitude} onChange={setAmplitude} min={2} max={30} step={1} unit="°" />
          <div className="mt-3 flex gap-2"><Button size="sm" onClick={takeTrial}><Plus className="size-3.5" />Time period</Button><Button size="sm" variant="outline" onClick={() => setTrials([])}><RotateCcw className="size-3.5" /></Button></div>
          <div className="mt-2 text-xs text-muted-foreground">T (theory) = <span className="font-mono text-cyan-j">{TTheory.toFixed(4)} s</span></div>
        </Card>
        <div className="space-y-3">
          <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden" style={{ height: 300 }}>
            <canvas ref={canvasRef} className="w-full h-full" />
          </div>
          {stats.n > 0 && (
            <Card title="Analysis">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[['Mean g', stats.mean.toFixed(4)], ['Std Dev', stats.sd.toFixed(4)], ['Std of Mean', stats.sdm.toFixed(4)], ['% Error', pctErr.toFixed(2) + '%']].map(([k, v]) => (
                  <div key={k} className="rounded-lg border border-border/50 bg-card/30 px-2.5 py-1.5"><div className="text-[10px] uppercase text-muted-foreground">{k}</div><div className="font-mono text-sm">{v}</div></div>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">g = <span className="font-mono">{stats.mean.toFixed(4)} ± {stats.sdm.toFixed(4)}</span> m/s². {pctErr < 2 ? 'Excellent agreement.' : pctErr < 5 ? 'Good agreement.' : 'Check timing precision.'}</p>
            </Card>
          )}
        </div>
        <div className="space-y-3">
          {trials.length > 0 && <Card title={`Trials (${trials.length})`}><SciTable headers={['#', 'T (s)', 'g (m/s²)']} rows={trials.map((t, i) => [i + 1, t.T.toFixed(4), (4 * Math.PI * Math.PI * t.L / (t.T * t.T)).toFixed(4)])} /></Card>}
          <Card title="T² vs L (theory)"><SciPlot type="line" data={plotData} xKey="L" series={[{ key: 'Tsq', label: 'T² (s²)', color: '#22d3ee' }]} xLabel="L (m)" yLabel="T² (s²)" height={160} exportName="pendulum-T2-vs-L" /></Card>
          <Button size="sm" variant="outline" onClick={() => downloadFile(JSON.stringify({ trials, gMeasured: stats.mean, gTheory }, null, 2), 'pendulum.json', 'application/json')}>Export JSON</Button>
        </div>
      </div>
      <AIPanel output={output} />
    </div>
  );
}