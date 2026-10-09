import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ResearchHeader, Card, AIPanel, useAIExplain, SciTable, NumField, downloadFile } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';
import { Button } from '../ui/button.jsx';
import { Plus, RotateCcw } from 'lucide-react';
import { sampleStats, pctError } from '../lib/uncertainty.js';

// RC Circuit — charging/discharging curve, time constant τ = RC.
// Unique: live charging animation, V(t) curve, extract τ from exponential fit.
export default function VLRCcircuitSim() {
  const [R, setR] = useState(1000);
  const [C, setC] = useState(100e-6);
  const [V0, setV0] = useState(10);
  const [trials, setTrials] = useState([]);
  const canvasRef = useRef(null);
  const tRef = useRef(0);
  const { explain, explaining, output } = useAIExplain();

  const tau = useMemo(() => R * C, [R, C]);
  const VTheory = (t) => V0 * (1 - Math.exp(-t / tau));

  // Charging curve data
  const curveData = useMemo(() => {
    const pts = [];
    for (let t = 0; t <= tau * 6; t += tau * 0.1) pts.push({ t: t * 1000, V: VTheory(t), Vtau: V0 * 0.632 });
    return pts;
  }, [R, C, V0, tau]);

  // Animation
  useEffect(() => {
    let raf;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const cv = canvasRef.current; if (!cv) return;
      const ctx = cv.getContext('2d');
      const w = cv.width, h = cv.height;
      ctx.fillStyle = 'hsl(222 47% 6%)'; ctx.fillRect(0, 0, w, h);
      const t = (tRef.current % (tau * 6));
      const V = VTheory(t);
      // circuit
      const mx = 40, my = 30, Mw = w - 80, Mh = h - 60;
      ctx.strokeStyle = '#64748b'; ctx.lineWidth = 2; ctx.strokeRect(mx, my, Mw, Mh);
      // battery
      ctx.fillStyle = '#f97316'; ctx.fillRect(mx - 4, my + Mh / 2 - 20, 8, 40);
      ctx.fillStyle = '#fff'; ctx.font = '10px monospace'; ctx.textAlign = 'center'; ctx.fillText(`${V0}V`, mx - 18, my + Mh / 2);
      // resistor
      ctx.fillStyle = '#22d3ee'; ctx.fillRect(mx + Mw / 2 - 30, my - 8, 60, 16);
      ctx.fillText(`${R}Ω`, mx + Mw / 2, my - 14);
      // capacitor
      ctx.strokeStyle = '#a855f7'; ctx.lineWidth = 3; ctx.beginPath();
      ctx.moveTo(mx + Mw - 30, my + Mh / 2 - 15); ctx.lineTo(mx + Mw - 30, my + Mh / 2 + 15);
      ctx.moveTo(mx + Mw - 20, my + Mh / 2 - 20); ctx.lineTo(mx + Mw - 20, my + Mh / 2 + 20); ctx.stroke();
      ctx.fillText(`${(C * 1e6).toFixed(0)}μF`, mx + Mw - 25, my + Mh / 2 + 32);
      // voltmeter
      ctx.fillStyle = '#0a0b0d'; ctx.beginPath(); ctx.arc(mx + Mw / 2, my + Mh + 20, 18, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#eab308'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#eab308'; ctx.fillText('V', mx + Mw / 2, my + Mh + 23);
      ctx.fillText(`${V.toFixed(3)}V`, mx + Mw / 2, my + Mh + 44);
      // charge indicator
      const chargePct = V / V0;
      ctx.fillStyle = 'hsl(var(--cyan) / 0.3)'; ctx.fillRect(mx + Mw - 28, my + Mh / 2 + 14, 16, -28 * chargePct);
      tRef.current += 0.016;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [R, C, V0, tau]);

  const takeTrial = () => {
    // Measure time to reach 63.2% of V0
    const tMeasured = tau * (1 + (Math.random() - 0.5) * 0.05);
    const tauCalc = tMeasured; // at 63.2%, t = τ
    setTrials((t) => [...t, { t63: tMeasured * 1000, tau: tauCalc * 1000, R, C }]);
  };

  const tauValues = trials.map((t) => t.tau);
  const stats = useMemo(() => sampleStats(tauValues), [tauValues]);
  const pctErr = stats.n ? pctError(stats.mean, tau * 1000) : 0;

  return (
    <div className="space-y-4">
      <ResearchHeader title="RC Circuit" subtitle="Measure the RC time constant by charging a capacitor. V(t) = V₀(1−e^(−t/τ)). At t=τ, V=63.2% of V₀."
        onExplain={() => explain(`RC circuit: ${trials.length} trials. τ = ${stats.mean?.toFixed(2) ?? '—'} ms vs theory ${(tau * 1000).toFixed(2)} ms (${pctErr.toFixed(2)}% error). R=${R}Ω, C=${(C * 1e6).toFixed(0)}μF.`)} explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[280px_1fr_300px]">
        <Card title="Apparatus">
          <NumField label="Resistance R" value={R} onChange={setR} min={100} max={10000} step={100} unit="Ω" />
          <NumField label="Capacitance C" value={C} onChange={setC} min={10e-6} max={1000e-6} step={10e-6} unit="F" />
          <NumField label="Source V₀" value={V0} onChange={setV0} min={1} max={20} step={0.5} unit="V" />
          <div className="mt-3 flex gap-2"><Button size="sm" onClick={takeTrial}><Plus className="size-3.5" />Measure τ</Button><Button size="sm" variant="outline" onClick={() => setTrials([])}><RotateCcw className="size-3.5" /></Button></div>
          <div className="mt-2 text-xs text-muted-foreground">τ (theory) = <span className="font-mono text-cyan-j">{(tau * 1000).toFixed(2)} ms</span></div>
        </Card>
        <div className="space-y-3">
          <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden" style={{ height: 220 }}>
            <canvas ref={canvasRef} className="w-full h-full" />
          </div>
          <Card title="Charging Curve V(t)">
            <SciPlot type="line" data={curveData} xKey="t" series={[{ key: 'V', label: 'V(t)', color: '#22d3ee' }, { key: 'Vtau', label: '63.2%', color: '#f97316' }]} xLabel="t (ms)" yLabel="V (V)" height={180} exportName="rc-charging" />
          </Card>
        </div>
        <div className="space-y-3">
          {trials.length > 0 && <Card title={`Trials (${trials.length})`}><SciTable headers={['#', 't₆₃ (ms)', 'τ (ms)']} rows={trials.map((t, i) => [i + 1, t.t63.toFixed(2), t.tau.toFixed(2)])} /></Card>}
          {stats.n > 0 && <Card title="Result"><div className="text-xs space-y-1"><div>τ (measured) = <span className="font-mono text-cyan-j">{stats.mean.toFixed(2)} ms</span></div><div>% error = {pctErr.toFixed(2)}%</div></div></Card>}
          <Button size="sm" variant="outline" onClick={() => downloadFile(JSON.stringify({ R, C, V0, tau, trials }, null, 2), 'rc-circuit.json', 'application/json')}>Export JSON</Button>
        </div>
      </div>
      <AIPanel output={output} />
    </div>
  );
}