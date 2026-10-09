import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ResearchHeader, Card, AIPanel, useAIExplain, SciTable, NumField, downloadFile } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';
import { Button } from '../ui/button.jsx';
import { Plus, RotateCcw } from 'lucide-react';
import { sampleStats, pctError } from '../lib/uncertainty.js';

// Electromagnetic Induction — induced EMF from magnet moving through coil.
// Unique: magnet falling through coil animation, EMF vs time plot, Faraday's law.
export default function VLEMImsim() {
  const [turns, setTurns] = useState(100);
  const [magnetSpeed, setMagnetSpeed] = useState(2);
  const [magnetStrength, setMagnetStrength] = useState(1.0);
  const [trials, setTrials] = useState([]);
  const canvasRef = useRef(null);
  const tRef = useRef(0);
  const { explain, explaining, output } = useAIExplain();

  // Faraday: EMF = -N dΦ/dt. For a dipole magnet through a coil:
  // Φ(t) ∝ μ / (1 + (vt/d)²)^(3/2), EMF peaks when magnet is near coil.
  const emfMax = useMemo(() => turns * magnetStrength * magnetSpeed * 0.01, [turns, magnetStrength, magnetSpeed]);

  // EMF vs time data
  const emfData = useMemo(() => {
    const pts = [];
    for (let t = -2; t <= 2; t += 0.02) {
      const x = magnetSpeed * t;
      const flux = magnetStrength / Math.pow(1 + x * x, 1.5);
      const dFluxDt = -3 * magnetStrength * magnetSpeed * x / Math.pow(1 + x * x, 2.5);
      const emf = -turns * dFluxDt * 0.01;
      pts.push({ t: t * 1000, emf, flux });
    }
    return pts;
  }, [turns, magnetSpeed, magnetStrength]);

  // Animation
  useEffect(() => {
    let raf;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const cv = canvasRef.current; if (!cv) return;
      const ctx = cv.getContext('2d');
      const w = cv.width, h = cv.height;
      ctx.fillStyle = 'hsl(222 47% 6%)'; ctx.fillRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2;
      // coil
      ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2;
      for (let i = 0; i < 8; i++) {
        ctx.beginPath(); ctx.ellipse(cx, cy - 30 + i * 8, 25, 6, 0, 0, Math.PI * 2); ctx.stroke();
      }
      // magnet position
      const t = tRef.current % 4 - 2;
      const mx = cx + magnetSpeed * t * 60;
      // magnet (dipole: red/blue)
      ctx.fillStyle = '#ef4444'; ctx.fillRect(mx - 10, cy - 20, 10, 40);
      ctx.fillStyle = '#3b82f6'; ctx.fillRect(mx, cy - 20, 10, 40);
      ctx.fillStyle = '#fff'; ctx.font = '8px monospace'; ctx.textAlign = 'center';
      ctx.fillText('N', mx - 5, cy + 2); ctx.fillText('S', mx + 5, cy + 2);
      // EMF indicator
      const x = magnetSpeed * t;
      const dFluxDt = -3 * magnetStrength * magnetSpeed * x / Math.pow(1 + x * x, 2.5);
      const emf = -turns * dFluxDt * 0.01;
      const emfH = Math.max(-60, Math.min(60, emf * 1000));
      ctx.strokeStyle = '#eab308'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(cx + 50, cy); ctx.lineTo(cx + 50, cy - emfH); ctx.stroke();
      ctx.fillStyle = '#eab308'; ctx.fillText('EMF', cx + 65, cy - emfH / 2);
      tRef.current += 0.016;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [turns, magnetSpeed, magnetStrength]);

  const takeTrial = () => {
    const emf = emfMax * (1 + (Math.random() - 0.5) * 0.05);
    setTrials((t) => [...t, { speed: magnetSpeed, turns, emfMax: emf, emfTheory: emfMax }]);
  };

  const emfValues = trials.map((t) => t.emfMax);
  const stats = useMemo(() => sampleStats(emfValues), [emfValues]);
  const pctErr = stats.n ? pctError(stats.mean, emfMax) : 0;

  return (
    <div className="space-y-4">
      <ResearchHeader title="Electromagnetic Induction" subtitle="Demonstrate Faraday's law: EMF = −N dΦ/dt. A magnet moving through a coil induces an EMF proportional to the rate of flux change."
        onExplain={() => explain(`EM induction: ${trials.length} trials. EMF_max = ${stats.mean?.toFixed(4) ?? '—'} V vs theory ${emfMax.toFixed(4)} (${pctErr.toFixed(2)}% error). N=${turns}, v=${magnetSpeed}m/s.`)} explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[280px_1fr_300px]">
        <Card title="Apparatus">
          <NumField label="Coil turns N" value={turns} onChange={setTurns} min={10} max={500} step={10} />
          <NumField label="Magnet speed" value={magnetSpeed} onChange={setMagnetSpeed} min={0.5} max={10} step={0.5} unit="m/s" />
          <NumField label="Magnet strength" value={magnetStrength} onChange={setMagnetStrength} min={0.1} max={5} step={0.1} unit="T·m³" />
          <div className="mt-3 flex gap-2"><Button size="sm" onClick={takeTrial}><Plus className="size-3.5" />Measure EMF</Button><Button size="sm" variant="outline" onClick={() => setTrials([])}><RotateCcw className="size-3.5" /></Button></div>
          <div className="mt-2 text-xs text-muted-foreground">EMF_max = <span className="font-mono text-cyan-j">{emfMax.toFixed(4)} V</span></div>
        </Card>
        <div className="space-y-3">
          <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden" style={{ height: 220 }}>
            <canvas ref={canvasRef} className="w-full h-full" />
          </div>
          <Card title="EMF vs Time">
            <SciPlot type="line" data={emfData} xKey="t" series={[{ key: 'emf', label: 'EMF (V)', color: '#eab308' }, { key: 'flux', label: 'Φ (Wb)', color: '#22d3ee' }]} xLabel="t (ms)" yLabel="EMF / Φ" height={180} exportName="emf-vs-time" />
          </Card>
        </div>
        <div className="space-y-3">
          {trials.length > 0 && <Card title={`Trials (${trials.length})`}><SciTable headers={['#', 'v (m/s)', 'N', 'EMF (V)']} rows={trials.map((t, i) => [i + 1, t.speed, t.turns, t.emfMax.toFixed(4)])} /></Card>}
          {stats.n > 0 && <Card title="Result"><div className="text-xs space-y-1"><div>EMF (measured) = <span className="font-mono text-cyan-j">{stats.mean.toFixed(4)} V</span></div><div>% error = {pctErr.toFixed(2)}%</div></div></Card>}
          <Button size="sm" variant="outline" onClick={() => downloadFile(JSON.stringify({ turns, magnetSpeed, magnetStrength, trials, emfData }, null, 2), 'emi.json', 'application/json')}>Export JSON</Button>
        </div>
      </div>
      <AIPanel output={output} />
    </div>
  );
}