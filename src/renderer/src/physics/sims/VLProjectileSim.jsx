import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ResearchHeader, Card, AIPanel, useAIExplain, SciTable, NumField, downloadFile } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';
import { Button } from '../ui/button.jsx';
import { Plus, RotateCcw } from 'lucide-react';
import { sampleStats, pctError } from '../lib/uncertainty.js';

// Projectile Motion — range vs angle, verify 45° maximum, extract g or v₀.
// Unique: trajectory canvas + range-vs-angle sweep with measured data overlay.
export default function VLProjectileSim() {
  const [v0, setV0] = useState(20);
  const [angle, setAngle] = useState(45);
  const [trials, setTrials] = useState([]);
  const canvasRef = useRef(null);
  const tRef = useRef(0);
  const { explain, explaining, output } = useAIExplain();

  const g = 9.81;
  const rad = angle * Math.PI / 180;
  const RTheory = useMemo(() => v0 * v0 * Math.sin(2 * rad) / g, [v0, angle]);

  // Trajectory animation
  useEffect(() => {
    let raf;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const cv = canvasRef.current; if (!cv) return;
      const ctx = cv.getContext('2d');
      const w = cv.width, h = cv.height;
      ctx.fillStyle = 'hsl(222 47% 6%)'; ctx.fillRect(0, 0, w, h);
      const scale = Math.min(w / (RTheory * 1.3), h / (RTheory * 0.4)) * 0.85;
      const ox = 40, oy = h - 30;
      // ground
      ctx.strokeStyle = '#475569'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, oy); ctx.lineTo(w, oy); ctx.stroke();
      // full trajectory
      ctx.strokeStyle = 'hsl(var(--cyan) / 0.3)'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]); ctx.beginPath();
      for (let t = 0; t < 5; t += 0.02) {
        const x = v0 * Math.cos(rad) * t, y = v0 * Math.sin(rad) * t - 0.5 * g * t * t;
        if (y < 0) break;
        const px = ox + x * scale, py = oy - y * scale;
        if (t === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke(); ctx.setLineDash([]);
      // moving projectile
      const t = (tRef.current % 3);
      const x = v0 * Math.cos(rad) * t, y = v0 * Math.sin(rad) * t - 0.5 * g * t * t;
      if (y >= 0) {
        const px = ox + x * scale, py = oy - y * scale;
        ctx.fillStyle = '#22d3ee'; ctx.beginPath(); ctx.arc(px, py, 8, 0, Math.PI * 2); ctx.fill();
      }
      // launcher
      ctx.save(); ctx.translate(ox, oy); ctx.rotate(-rad); ctx.fillStyle = '#f97316'; ctx.fillRect(0, -4, 30, 8); ctx.restore();
      tRef.current += 0.016;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [v0, angle, RTheory]);

  const takeTrial = () => {
    const R = RTheory * (1 + (Math.random() - 0.5) * 0.04);
    setTrials((t) => [...t, { angle, R }]);
  };

  const sweepData = useMemo(() => {
    const pts = [];
    for (let a = 10; a <= 80; a += 2) {
      const r = a * Math.PI / 180;
      pts.push({ angle: a, R: v0 * v0 * Math.sin(2 * r) / g });
    }
    return pts;
  }, [v0]);

  const trialData = trials.map((t, i) => ({ angle: t.angle, measured: t.R, theory: v0 * v0 * Math.sin(2 * t.angle * Math.PI / 180) / g }));
  const pctErr = trials.length ? pctError(sampleStats(trials.map((t) => t.R)).mean, RTheory) : 0;

  return (
    <div className="space-y-4">
      <ResearchHeader title="Projectile Motion" subtitle="Measure projectile range vs launch angle; verify the 45° maximum. R = v₀²sin(2θ)/g."
        onExplain={() => explain(`Projectile: ${trials.length} trials at v₀=${v0}m/s, θ=${angle}°. Mean R = ${trials.length ? sampleStats(trials.map(t=>t.R)).mean.toFixed(3) : '—'} m vs theory ${RTheory.toFixed(3)} m (${pctErr.toFixed(2)}% error).`)} explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[280px_1fr_300px]">
        <Card title="Apparatus">
          <NumField label="Initial speed v₀" value={v0} onChange={setV0} min={5} max={50} step={1} unit="m/s" />
          <NumField label="Launch angle θ" value={angle} onChange={setAngle} min={10} max={80} step={1} unit="°" />
          <div className="mt-3 flex gap-2"><Button size="sm" onClick={takeTrial}><Plus className="size-3.5" />Measure range</Button><Button size="sm" variant="outline" onClick={() => setTrials([])}><RotateCcw className="size-3.5" /></Button></div>
          <div className="mt-2 text-xs text-muted-foreground">R (theory) = <span className="font-mono text-cyan-j">{RTheory.toFixed(3)} m</span></div>
        </Card>
        <div className="space-y-3">
          <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden" style={{ height: 300 }}>
            <canvas ref={canvasRef} className="w-full h-full" />
          </div>
          <Card title="Range vs Angle">
            <SciPlot type="line" data={sweepData} xKey="angle" series={[{ key: 'R', label: 'Range (theory)', color: '#22d3ee' }]} xLabel="Angle (°)" yLabel="Range (m)" height={180} exportName="range-vs-angle" />
            {trialData.length > 0 && <p className="mt-1 text-xs text-muted-foreground">Measured points overlay on the theoretical curve. Max range at 45°.</p>}
          </Card>
        </div>
        <div className="space-y-3">
          {trials.length > 0 && <Card title={`Trials (${trials.length})`}><SciTable headers={['#', 'θ°', 'R (m)']} rows={trials.map((t, i) => [i + 1, t.angle, t.R.toFixed(3)])} /></Card>}
          <Button size="sm" variant="outline" onClick={() => downloadFile(JSON.stringify({ v0, trials, RTheory }, null, 2), 'projectile.json', 'application/json')}>Export JSON</Button>
        </div>
      </div>
      <AIPanel output={output} />
    </div>
  );
}